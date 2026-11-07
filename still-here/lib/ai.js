// Every model call the app makes, through the event's OpenRouter key. The key never leaves the server.
//   scene:  spoken memory -> the front of the room as remembered (wide image)
//   back:   the front's two edge strips -> the rest of the room, so the loop closes at 360 degrees
//   labels: scene + memory -> every element tagged "from your words" or "imagined", plus a narration line
//   ask:    memory -> one warm question back
//   sound:  memory -> a short clip of what the room sounded like (Lyria)
//   hear / speak: voice in and out

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

export async function scene({ memory } = {}) {
  const m = str(memory, 1500);
  if (m.length < 4) throw fail('Tell me about the room first.', 400);
  return paint([{ type: 'text', text: `Someone is describing a room they remember, in their own words: "${m}"
Paint that room as one wide, eye-level, photorealistic photograph, as if they are standing in the middle of it inside the memory. Put every detail they mention in the room: the people, objects, light, time of day, season and era they describe. Fill everything they didn't mention with plain, believable things that fit the time and place. Camera at standing eye height, level horizon at the vertical center, wide field of view, the walls continuing past both edges, the floor visible at the bottom and the ceiling at the top. Warm, real, lived-in, natural light. People may appear but their faces should be soft and unidentifiable. No text, no borders, no captions.` }]);
}

export async function back({ strip, memory } = {}) {
  const m = str(memory, 1500);
  return paint([
    { type: 'text', text: `This image is one wide eye-level view of a room with a flat gray gap in the middle. The left part and the right part are real pieces of the same room. Fill the gray gap with the rest of this room so the whole image is one continuous seamless view, as if turning around inside it: same light, same floor, same ceiling height, same horizon line, same style and era. Continue the walls naturally; the far wall can have a window, a door, furniture or shelves that fit. The memory: ${m}
Keep the left and right parts exactly as they are, pixel for pixel. Do not repeat any person or object that appears in the left or right part: the gap is a different stretch of the room, with no people in it. No text, no borders.` },
    image(strip, 'the strip image'),
  ]);
}

export async function labels({ scene: sc, memory } = {}) {
  const m = str(memory, 1500);
  const j = await call({
    model: 'google/gemini-3.8-flash', reasoning: { effort: 'low' }, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [
      { type: 'text', text: `This picture was generated from a person's spoken memory of a room: "${m}".
List up to 12 distinct visible elements in the picture. For each give: name (2-4 plain words, lowercase), source ("memory" ONLY if the person's words asked for it, even loosely; "invented" if the painter added it on its own), and box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid of the picture. Be strict: anything the words did not mention is "invented".
Also give: "title": a 2-5 word name for this room (like "Grandma's kitchen"); "narration": one gentle sentence, under 16 words, spoken to the person as they step inside, in second person, using only what the memory says (like "This is your grandmother's kitchen, on a winter afternoon."); "sound_from": the name of the element in your list that would make the room's sound (a radio, a kettle, a window with rain), or "" if none.
Reply JSON {"title":"","narration":"","sound_from":"","elements":[...]}.` },
      image(sc, 'the scene'),
    ] }],
  }, 40000);
  let out;
  try { out = JSON.parse(String(j.choices?.[0]?.message?.content ?? '').replace(/^```(json)?|```$/g, '')); } catch { throw fail('The labeler sent back something unreadable.', 502); }
  const SOURCES = ['memory', 'invented'];
  const elements = (Array.isArray(out.elements) ? out.elements : []).slice(0, 14).flatMap(e => {
    const b = Array.isArray(e?.box_2d) ? e.box_2d.map(Number) : [];
    if (b.length !== 4 || b.some(n => !Number.isFinite(n))) return [];
    return [{ name: str(e.name, 40), source: SOURCES.includes(e.source) ? e.source : 'invented', box_2d: b.map(n => Math.max(0, Math.min(1000, n))) }];
  });
  return { title: str(out.title, 60), narration: str(out.narration, 160), sound_from: str(out.sound_from, 40), elements };
}

export async function ask({ memory } = {}) {
  const m = str(memory, 1500);
  if (!m) throw fail('Tell me the memory first.', 400);
  const j = await call({
    model: 'google/gemini-3.5-flash-lite', temperature: 0.4, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `Someone is describing a room from their memory so we can rebuild it around them: "${m}"
Ask them ONE short, warm question (under 14 words) about something they did not mention that would fill the rest of the room or its sound: what they could hear, who else was there, what was on the wall behind them, what it smelled like. Plain words, kind, no "please describe". Reply JSON {"question":""}.` }],
  }, 12000);
  let q = '';
  try { q = JSON.parse(String(j.choices?.[0]?.message?.content ?? '').replace(/^```(json)?|```$/g, '')).question; } catch { /* fall through */ }
  return { question: str(q, 140) || 'What could you hear in that room?' };
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
