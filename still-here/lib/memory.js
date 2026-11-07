// Memory mode: every model call, through the OpenRouter key. The key never leaves the server.
// Each export is a plain async handler ({...body}) => result, so Nib's server can mount them as /api/memory/<name>.
//   ask:    what was said so far -> one warm follow-up question
//   spec:   everything said -> one scene plan (what is where, which details are the person's own)
//   scene:  scene plan -> the front of the room, text only (wide 21:9 photo)
//   back:   the front's two edge strips -> the rest of the room, so the loop closes at 360 degrees
//   labels: front photo + plan -> each element 'memory' (from your words) or 'invented' (imagined), plus title, entry line, spoken description
//   fix:    front photo + a spoken correction -> the edited front
//   sound:  sound prompt -> a short Lyria clip of what the room sounded like

export const fail = (message, status) => Object.assign(new Error(message), { status });
const API = 'https://openrouter.ai/api/v1/chat/completions';
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function key() {
  const k = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (!k) throw fail('The server has no OPENROUTER_KEY yet.', 503);
  return k;
}

async function call(body, ms) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key()}`, 'x-title': 'Still Here' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (body.stream) {
    if (!r.ok) throw fail(`The model said ${r.status}.`, 502);
    return r;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw fail(`The model said: ${j.error?.message || r.status}`, 502);
  return j;
}

function image(v, what) {
  if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 4e6) throw fail(`Send ${what} as an image data URL.`, 400);
  return { type: 'image_url', image_url: { url: v } };
}

const IMAGE_MODELS = ['google/gemini-3.1-flash-image', 'google/gemini-nano-banana-2.1'];
// Image models swing from 9 s to 45 s under load: if the first hasn't answered in 14 s (or fails),
// start the second as well and take whichever picture arrives first.
async function paint(content) {
  const t0 = Date.now();
  const one = async model => {
    const j = await call({ model, modalities: ['image', 'text'], image_config: { aspect_ratio: '21:9' }, messages: [{ role: 'user', content }] }, 55000 - (Date.now() - t0));
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw fail('The painter sent back no picture.', 502);
    console.log('paint', model, ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return { image: url };
  };
  const first = one(IMAGE_MODELS[0]);
  const backup = new Promise((ok, no) => {
    const t = setTimeout(ok, 14000);
    first.then(() => { clearTimeout(t); no(fail('not needed', 500)); }, () => { clearTimeout(t); ok(); });
  }).then(() => one(IMAGE_MODELS[1]));
  return Promise.any([first, backup]).catch(e => { throw e.errors?.[0] || e; });
}

const REAL = `It must look like an ordinary, real, unedited photograph of a real room, taken on a full-frame camera with a 14mm lens at natural exposure: true-to-life colors, real daylight or lamp light only, soft natural shadows, slight sensor grain, real materials with wear, scuffs, dust and everyday clutter, slightly imperfect framing. NOT cinematic, NOT golden-hour glow, NOT HDR, NOT dramatic lighting, NOT a 3D render, NOT illustration, NOT oversaturated, no lens flare, no bloom, no haze. People may appear, doing ordinary things, with soft unidentifiable faces. No text, no borders, no captions.`;

const parse = j => {
  try { return JSON.parse(String(j.choices?.[0]?.message?.content ?? '').replace(/^\s*```(json)?|```\s*$/g, '')); }
  catch { throw fail('The model sent back something unreadable.', 502); }
};
const list = (v, n, max = 80) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(typeof x === 'string' ? x : x?.name ?? JSON.stringify(x), max)).filter(Boolean);
const said = (memory, answers) => [str(memory, 1500), ...list(answers, 4, 500)].filter(Boolean).join(' ');

// One warm follow-up question by voice, about what matters for a room. Empty when we know enough.
export async function ask({ memory, answers = [], asked = [] } = {}) {
  const m = said(memory, answers);
  if (!m) throw fail('Tell me about the room first.', 400);
  const j = await call({
    model: 'google/gemini-3.5-flash-lite', temperature: 0.4, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `A person (who may be blind) is describing a room from their memory so we can rebuild it around them. Everything they have said so far: "${m}"
Ask ONE short, warm, spoken question (under 14 words) about the most important thing still missing to build the room: the time of day, who else was there, what was behind them, or what they could hear. Do not ask about something they already said.${list(asked, 4, 200).length ? ` You already asked: ${JSON.stringify(list(asked, 4, 200))}. Ask about something different.` : ''} Plain words, kind, no "please describe". Reply JSON {"question":""}.` }],
  }, 12000);
  return { question: str(parse(j).question, 140) || 'What could you hear in that room?' };
}

// Everything the person said, merged into one scene plan: where things are, and which details are theirs.
export async function spec({ memory, answers = [] } = {}) {
  const m = said(memory, answers);
  if (m.length < 4) throw fail('Tell me about the room first.', 400);
  const j = await call({
    model: 'google/gemini-3.8-flash', reasoning: { effort: 'low' }, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `A person described a room from their memory, in their own words: "${m}"
Plan this room so it can be photographed all the way around, as if they stand in the middle of it. Keep their details exactly; add only plain, ordinary, believable things that fit the time and place.
Reply JSON:
{"title": "2-5 words, like \\"Grandma's kitchen\\"",
 "room": "type of room, place, era",
 "time": "time of day and season",
 "light": "where the light comes from, plainly",
 "spoken": ["every concrete detail the PERSON said, 2-6 words each"],
 "ahead": ["what is in front of them"], "left": ["on their left"], "right": ["on their right"], "behind": ["behind them"],
 "people": ["who is there and what they are doing"],
 "sounds": ["what can be heard"],
 "front_prompt": "one paragraph describing the view facing ahead, from the far left wall across to the far right wall, with every spoken detail placed",
 "back_prompt": "one paragraph describing only what is behind them (no people)",
 "sound_prompt": "one sentence for a sound designer: the music or ambient sound of this room"}` }],
  }, 20000);
  const o = parse(j);
  return {
    title: str(o.title, 60), room: str(o.room, 160), time: str(o.time, 120), light: str(o.light, 200),
    spoken: list(o.spoken, 16), ahead: list(o.ahead, 10), left: list(o.left, 10), right: list(o.right, 10), behind: list(o.behind, 10),
    people: list(o.people, 6, 120), sounds: list(o.sounds, 6), memory: m,
    front_prompt: str(o.front_prompt, 1500) || m, back_prompt: str(o.back_prompt, 1000), sound_prompt: str(o.sound_prompt, 400) || m,
  };
}

const specText = s => typeof s === 'object' && s ? s : { memory: str(s, 1500), front_prompt: str(s, 1500), back_prompt: '', spoken: [] };

export async function scene({ spec: sp, memory } = {}) {
  const s = specText(sp || memory);
  if (!s.front_prompt) throw fail('Tell me about the room first.', 400);
  return paint([{ type: 'text', text: `One wide, eye-level photograph of a room someone remembers. ${str(s.room, 160)}. ${str(s.time, 120)}. Light: ${str(s.light, 200)}.
The view: ${str(s.front_prompt, 1500)}
${list(s.spoken, 16).length ? `These details must be clearly visible: ${list(s.spoken, 16).join('; ')}.
` : ''}Camera at standing eye height in the middle of the room, level horizon at the vertical center, very wide field of view, the walls continuing past both edges, the floor visible at the bottom and the ceiling at the top. Fill anything not described with plain, ordinary things that fit, nothing decorative or staged.
${REAL}` }]);
}

export async function back({ strip, spec: sp, memory } = {}) {
  const s = specText(sp || memory);
  return paint([
    { type: 'text', text: `This image is one wide eye-level view of a room with a flat gray gap in the middle. The left part and the right part are real pieces of the same room. Fill the gray gap with the rest of this room so the whole image is one continuous seamless photograph, as if turning around inside it: same light, same exposure, same color, same grain, same floor, same ceiling height, same horizon line, same era. What is there: ${str(s.back_prompt, 1000) || 'plain, ordinary things a real room has (a door, a window, a cupboard, a shelf)'}. ${s.memory ? `The memory: ${str(s.memory, 800)}` : ''}
Keep the left and right parts exactly as they are, pixel for pixel. Do not repeat any person or object that appears in the left or right part: the gap is a different stretch of the room, with no people in it. Nothing staged or decorative. It must look like a real, unedited photograph, not a render: no glow, no HDR, no extra drama. No text, no borders.` },
    image(strip, 'the strip image'),
  ]);
}

// A spoken correction ("no, the radio was by the window"): edit the front photo, keep everything else.
export async function fix({ scene: sc, correction, spec: sp } = {}) {
  const c = str(correction, 400);
  if (!c) throw fail('Say what to change.', 400);
  return paint([
    { type: 'text', text: `Edit this photograph of a remembered room. The person who remembers it says: "${c}".
Make exactly that change and nothing else. Keep the camera, framing, size, light, colors, grain, every other object and person, and both left and right edges exactly as they are.${sp?.room ? ` The room: ${str(sp.room, 160)}.` : ''}
${REAL}` },
    image(sc, 'the scene'),
  ]);
}

// Honesty labels against the scene plan: "memory" = from the person's words, "invented" = imagined by Nib.
// Also the line spoken on entering, and a short spoken description with directions, for a blind listener.
export async function labels({ scene: sc, spec: sp, memory } = {}) {
  const s = specText(sp || memory);
  const j = await call({
    model: 'google/gemini-3.8-flash', reasoning: { effort: 'low' }, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [
      { type: 'text', text: `This picture was generated from a person's spoken memory of a room. What they actually said: "${str(s.memory, 1500)}". The concrete details they said: ${JSON.stringify(list(s.spoken, 16))}.
The picture is the view facing ahead (its left third is on their left, its right third on their right). Behind them (not in the picture) is: ${JSON.stringify(list(s.behind, 10))}; if what they said names something behind them, that wins.
1. List up to 12 distinct visible elements in the picture. For each: name (2-4 plain words, lowercase), source ("memory" ONLY if it matches something the person said, even loosely; "invented" if the painter added it), box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid. Be strict: anything they did not say is "invented".
2. "title": 2-5 words naming the room (like "Grandma's kitchen").
3. "narration": one gentle sentence, under 16 words, in second person, as they step inside, using only what they said.
4. "describe": 3 or 4 short spoken sentences for a blind listener, saying what is where using "in front of you", "on your left", "on your right", "behind you", leading with the things they said, then "I added" for the main imagined things. Plain words, warm, no colors-only details.
5. "sound_from": the name of the element in your list that makes the room's sound (radio, kettle, window with rain), or "".
Reply JSON {"title":"","narration":"","describe":"","sound_from":"","elements":[...]}.` },
      image(sc, 'the scene'),
    ] }],
  }, 40000);
  const out = parse(j);
  const SOURCES = ['memory', 'invented'];
  const elements = (Array.isArray(out.elements) ? out.elements : []).slice(0, 14).flatMap(e => {
    const b = Array.isArray(e?.box_2d) ? e.box_2d.map(Number) : [];
    if (b.length !== 4 || b.some(n => !Number.isFinite(n))) return [];
    return [{ name: str(e.name, 40), source: SOURCES.includes(e.source) ? e.source : 'invented', box_2d: b.map(n => Math.max(0, Math.min(1000, n))) }];
  });
  return { title: str(out.title, 60) || str(s.title, 60), narration: str(out.narration, 160), describe: str(out.describe, 600), sound_from: str(out.sound_from, 40), elements };
}

export async function sound(args = {}) {
  try { return await soundOnce(args); } catch { return soundOnce(args); } // Lyria sometimes sends nothing; one retry
}
async function soundOnce({ memory } = {}) {
  const m = str(memory, 800);
  if (!m) throw fail('Tell me the memory first.', 400);
  const r = await call({
    model: 'google/lyria-3-clip-preview', stream: true, modalities: ['text', 'audio'], audio: { format: 'mp3' },
    messages: [{ role: 'user', content: `The quiet sound of a remembered room, as if you were standing inside it: ${m}
If the memory has a radio, music or singing, make that music, soft and a little distant. Otherwise make gentle, warm ambient room sound and soft instrumental music that fits the time and place. Calm, nostalgic, no lyrics.` }],
  }, 55000);
  const parts = [], dec = new TextDecoder();
  let buf = '';
  for await (const c of r.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try { const a = JSON.parse(line.slice(5)).choices?.[0]?.delta?.audio; if (a?.data) parts.push(a.data); } catch { /* keep-alive */ }
    }
  }
  const audio = Buffer.concat(parts.map(p => Buffer.from(p, 'base64'))).toString('base64');
  if (audio.length < 2000) throw fail('No sound came back.', 502);
  return { audio };
}
