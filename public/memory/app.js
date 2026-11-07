// Nib · Memory: say a room you remember; Nib asks a question or two, builds it all the way around you,
// tells you what's where, and changes it when you say it was different. Every detail is labeled
// "from your words" or "imagined by Nib". The 3D view is for the family; the voice is for everyone.
import { load, shrink, stripInput, edgeScore, makeLoop, equirect } from './pano.js';
import { depthOf, makeRoom } from './room.js';
import { micButton, say, sayAll, sentences, hush } from './voice.js';

const $ = id => document.getElementById(id);
let actx;
const ctx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
const params = new URLSearchParams(location.search);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }

async function api(name, body) {
  const r = await fetch(name.startsWith('/') ? name : '/api/memory/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${name} failed`);
  return j;
}

// ---------- 1. the memory, spoken or typed ----------
const memoryField = $('memory');
memoryField.oninput = () => { $('build').disabled = memoryField.value.trim().length < 4; };
const NOTE = { listening: 'Listening… let go (or tap) when you’re done.', hearing: 'Writing it down…', denied: 'The microphone is blocked. You can type instead.', idle: 'Hold to talk, or tap to start and again to stop.' };
micButton($('mic1'), ctx, { onText: t => converse(t), onState: s => { $('note1').textContent = NOTE[s]; } });
$('typeForm').onsubmit = e => { e.preventDefault(); const t = memoryField.value.trim(); if (t.length >= 4) converse(t); };
$('talkBack').onclick = () => { hush(); run++; show('home'); };

// ---------- 2. a short conversation, then the build ----------
let run = 0, answerWait = null;
function bubble(who, text) {
  const li = document.createElement('li');
  li.className = who;
  li.textContent = text;
  $('chat').append(li);
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return li;
}
// Nib asks out loud; resolves with the answer ('' if skipped or no answer in time)
function askAloud(question, wait = 60000) {
  bubble('nib', question);
  $('question').textContent = question;
  $('answerSheet').hidden = false;
  say(question, ctx);
  return new Promise(ok => {
    const t = setTimeout(() => done(''), wait);
    function done(v) { clearTimeout(t); answerWait = null; $('answerSheet').hidden = true; if (v) bubble('you', v); ok(v); }
    answerWait = done;
  });
}
const submitAnswer = () => { const v = $('answer').value.trim(); $('answer').value = ''; answerWait?.(v); };
$('answerForm').onsubmit = e => { e.preventDefault(); submitAnswer(); };
$('skip').onclick = () => { hush(); answerWait?.(''); };
micButton($('mic2'), ctx, { onText: t => answerWait?.(t) });

async function converse(memory) {
  ctx().resume();
  const me = ++run;
  memoryField.value = ''; memoryField.oninput();
  $('chat').innerHTML = ''; $('waitimg').hidden = true; $('clock').textContent = '';
  show('talk');
  bubble('you', memory);
  const answers = [];
  const q1 = await api('ask', { memory }).then(r => r.question).catch(() => 'What time of day is it in this memory?');
  if (me !== run) return;
  const a1 = await askAloud(q1);
  if (me !== run) return;
  if (a1) answers.push(a1);
  build(memory, answers, me, [q1]);
}

const STEPS = [['spec', 'Listening back to what you said'], ['scene', 'Building the room in front of you'], ['back', 'Building the walls behind you'], ['labels', 'Marking what came from your words'], ['sound', 'Bringing back the sound'], ['depth', 'Giving it depth']];
function steps() {
  const li = bubble('nib', 'Building your room.');
  const ol = document.createElement('ol'); ol.className = 'steps';
  ol.innerHTML = STEPS.map(([k, t]) => `<li data-k="${k}">${t}<span class="t"></span></li>`).join('');
  li.append(ol);
  const t0 = performance.now(), el = k => ol.querySelector(`[data-k="${k}"]`);
  return {
    t0,
    go: k => { el(k).className = 'go'; },
    done: k => { const e = el(k); e.className = 'done'; e.querySelector('.t').textContent = Math.round((performance.now() - t0) / 1000) + ' s'; },
    bad: (k, msg) => { const e = el(k); e.className = 'bad'; e.querySelector('.t').textContent = msg; },
  };
}

async function build(memory, answers, me, asked = []) {
  const st = steps(), tick = setInterval(() => { $('clock').textContent = Math.round((performance.now() - st.t0) / 1000) + ' s'; }, 250);
  try {
    // the front is built straight from the words while the scene plan (what is where, which details are
    // theirs) is worked out alongside; the plan feeds the walls behind you, the labels and the sound
    const said = [memory, ...answers].join(' ');
    st.go('spec'); st.go('scene');
    const specP = api('spec', { memory, answers }).catch(() => ({ memory: said, front_prompt: said, back_prompt: '', spoken: [], sound_prompt: said })).then(s => (st.done('spec'), s));
    const frontP = api('scene', { memory: said }).then(r => load(r.image));
    // a second question while the room is built; its answer goes into the walls behind you and the sound
    const a2P = api('ask', { memory, answers, asked }).then(r => me === run ? askAloud(r.question, 25000) : '').catch(() => '');
    const front = await frontP;
    st.done('scene');
    if (me !== run) return;
    $('waitimg').src = front.src; $('waitimg').hidden = false;
    const frontJpg = shrink(front, 1600, 0.88);
    const spec = await specP;
    // the second answer belongs in the plan before the labels and the spoken description are written
    const a2 = await a2P;
    if (a2) { answers.push(a2); spec.memory = `${spec.memory} ${a2}`; spec.spoken = [...(spec.spoken || []), a2]; spec.back_prompt = `${spec.back_prompt} ${a2}`; spec.sound_prompt = `${spec.sound_prompt} ${a2}`; }
    st.go('labels');
    const labelsP = api('labels', { scene: frontJpg, spec }).then(r => (st.done('labels'), r)).catch(e => (st.bad('labels', 'skipped'), console.warn(e), null));
    st.go('sound');
    const soundP = api('sound', { memory: spec.sound_prompt }).then(r => (st.done('sound'), 'data:audio/mpeg;base64,' + r.audio)).catch(e => (st.bad('sound', 'skipped'), console.warn(e), null));
    st.go('back');
    const back = await paintBack(front, spec);
    st.done('back');
    if (me !== run) return;
    const { loop, L, s, w } = makeLoop(front, back);
    st.go('depth');
    let depth = null;
    try { depth = await depthOf(loop); st.done('depth'); } catch (e) { console.warn(e); st.bad('depth', 'flat'); }
    const lab = await labelsP;
    const room = {
      spec, front, back, frontJpg, pano: equirect(loop), depth, layout: { L, s, w },
      title: lab?.title || spec.title || 'Your room', narration: lab?.narration || '', describe: lab?.describe || '',
      tags: tagsFrom(lab, { L, s, w }), faceU: (w / 2 - s) / L, sound: await soundP,
    };
    room.soundFrom = room.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || null;
    clearInterval(tick);
    if (me !== run) return;
    $('clock').textContent = Math.round((performance.now() - st.t0) / 1000) + ' s';
    window.__lastRoom = room;
    if (params.has('bake')) bake(room);
    enter(room);
  } catch (e) {
    clearInterval(tick);
    console.warn(e);
    const li = bubble('nib', `Something went wrong: ${e.message} Tap here to try again.`);
    li.tabIndex = 0; li.style.cursor = 'pointer';
    li.onclick = () => build(memory, answers, me, asked);
    say('Something went wrong. Tap the message to try again.', ctx);
  }
}

// three tries in parallel; keep the one whose fill meets its edge strips most cleanly. Take what has
// arrived 4 s after the first good one, so one slow try can't hold the room hostage.
async function paintBack(front, spec) {
  const strip = stripInput(front), backs = [];
  await new Promise(ok => {
    let left = 3;
    for (let i = 0; i < 3; i++) api('back', { strip, spec }).then(r => load(r.image)).then(b => { backs.push(b); if (backs.length === 1) setTimeout(ok, 4000); }).catch(console.warn).finally(() => { if (--left === 0) ok(); });
  });
  if (!backs.length) throw new Error('The walls behind you could not be built.');
  return backs.map(b => [b, edgeScore(b, front.width, front.height)]).sort((a, b) => a[1] - b[1])[0][0];
}

// labels on the front picture -> positions around the loop; the walls behind you are honestly "imagined"
function tagsFrom(lab, { L, s, w }) {
  const tags = (lab?.elements || []).map(e => {
    const [y0, x0, y1, x1] = e.box_2d.map(v => v / 1000), x = (x0 + x1) / 2 * w;
    return { name: e.name, source: e.source, u: (((x - s) % L) + L) % L / L, vb: y0 + (y1 - y0) * 0.25 };
  });
  tags.push({ name: 'the walls behind you', source: 'invented', u: (w - s + (w - 2 * s) / 2) / L, vb: 0.3 });
  return tags;
}

// ---------- 3. inside: the room, the sound, and Nib telling you what's where ----------
let view = null, music = null, shown = false, current = null;
const CONFIRM = 'Is that how you remember it? Hold the yellow button and tell me anything to change.';
async function enter(room, { changed = false } = {}) {
  current = room;
  ctx().resume();
  show('room');
  view?.destroy();
  $('tags').innerHTML = '';
  view = makeRoom($('stage'), room);
  view.face(room.faceU ?? 0.5);
  if (tiltWanted) view.tiltOn();
  $('rtitle').textContent = room.title;
  for (const t of view.tags) {
    const b = document.createElement('button');
    b.className = `tag ${t.source}`;
    b.innerHTML = '<b></b>';
    b.firstChild.textContent = t.name;
    b.setAttribute('aria-label', `${t.name}, ${t.source === 'memory' ? 'from your words' : 'imagined by Nib'}`);
    b.onclick = () => openTag(t, b);
    $('tags').append(b);
    t.el = b;
  }
  real(shown);
  if (!changed || !music) await startSound(room);
  else placeSound(room);
  const lines = [...(changed ? ['Done.'] : room.narration ? [room.narration] : []), ...sentences(room.describe), CONFIRM];
  $('caption').textContent = '';
  $('caption').setAttribute('aria-live', 'off'); // the voice already says it; captions are for reading along
  await sleep(changed ? 200 : 1200);
  if (current !== room) return;
  if (music) music.gain.gain.setTargetAtTime(0.25, ctx().currentTime, 0.3);
  const done = await sayAll(lines, ctx, room.clips || {}, i => { if (current === room) $('caption').textContent = lines[i]; });
  if (done && current === room) $('caption').textContent = 'Hold the yellow button to change anything.';
  if (music && current === room) music.gain.gain.setTargetAtTime(muted ? 0 : 0.85, ctx().currentTime, 0.8);
}

let muted = false;
async function startSound(room) {
  music?.stop(); music = null;
  if (!room.sound) { $('mute').hidden = true; return; }
  $('mute').hidden = false;
  try {
    const c = ctx(), buf = await c.decodeAudioData(await (await fetch(room.sound)).arrayBuffer());
    const src = c.createBufferSource(), gain = c.createGain(), pan = c.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.2; pan.rolloffFactor = 0.8;
    src.buffer = buf; src.loop = true; gain.gain.value = 0;
    src.connect(pan).connect(gain).connect(c.destination);
    src.start();
    music = { stop: () => { try { src.stop(); } catch { } }, gain, pan };
    placeSound(room);
    $('mute').setAttribute('aria-pressed', String(!muted));
  } catch (e) { console.warn('sound', e); }
}
// the sound comes from its source (the radio) if we know it; otherwise from all around you
function placeSound(room) {
  if (!music) return;
  const at = room.soundFrom && view.tags.find(t => t.name === room.soundFrom.name)?.p;
  const p = music.pan;
  if (at) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; view.hear(ctx()); }
  else { p.positionX.value = 0; p.positionY.value = 0; p.positionZ.value = 0; p.panningModel = 'equalpower'; }
}

function real(on) {
  shown = on;
  $('room').classList.toggle('show-real', on);
  $('real').setAttribute('aria-pressed', String(on));
  $('real').textContent = on ? 'Hide labels' : 'Show what’s real';
  $('legend').hidden = !on;
  if (!on) $('tagsheet').hidden = true;
}
$('real').onclick = () => {
  real(!shown);
  if (shown && current) {
    const mine = current.tags.filter(t => t.source === 'memory').map(t => t.name), made = current.tags.filter(t => t.source === 'invented' && t.name !== 'the walls behind you').map(t => t.name);
    say(`From your words: ${mine.join(', ') || 'nothing I could point to'}. Imagined by Nib: ${made.slice(0, 5).join(', ') || 'nothing else'}, and the walls behind you.`, ctx);
  }
};

const SRC = { memory: 'This came from your words.', invented: 'Imagined by Nib to fill the room. You didn’t say it.' };
let tagOpen = null;
function openTag(t, b) {
  tagOpen = { t, b };
  $('tagTitle').textContent = t.name[0].toUpperCase() + t.name.slice(1);
  $('tagSrc').textContent = SRC[t.source];
  $('tagsheet').hidden = false;
}
$('tagsheet').onclick = e => {
  const act = e.target.dataset?.act;
  if (!act || !tagOpen) return;
  const { t, b } = tagOpen;
  $('tagsheet').hidden = true;
  if (act === 'keep') { b.classList.remove('wrong'); b.classList.add('kept'); return; }
  if (act === 'remove') return change(`Remove the ${t.name}.`);
  b.classList.add('wrong');
  say(`What should the ${t.name} be? Hold the yellow button and tell me.`, ctx);
};
$('stage').addEventListener('pointerdown', () => { $('tagsheet').hidden = true; });

// ---------- 4. "No, the radio was by the window": change the room by voice ----------
let changing = false;
micButton($('mic3'), ctx, { onText: t => change(t), onState: s => { if (s === 'listening') { hush(); $('caption').textContent = 'Listening…'; } } });
async function change(text) {
  const room = current;
  if (!room || changing) return;
  if (!room.front || !room.back) { $('caption').textContent = 'This example can’t be changed. Build your own room to try it.'; return say($('caption').textContent, ctx); }
  changing = true;
  $('caption').textContent = `Changing it: “${text}”`;
  say('Okay. Changing it now.', ctx);
  try {
    const r = await api('fix', { scene: room.frontJpg, correction: text, spec: room.spec });
    const front = await load(r.image);
    const spec = { ...room.spec, memory: `${room.spec.memory} Correction: ${text}`, spoken: [...(room.spec.spoken || []), text] };
    const frontJpg = shrink(front, 1600, 0.88);
    const { loop, L, s, w } = makeLoop(front, room.back);
    const [depth, lab] = await Promise.all([depthOf(loop).catch(() => null), api('labels', { scene: frontJpg, spec }).catch(() => null)]);
    const next = {
      ...room, spec, front, frontJpg, pano: equirect(loop), depth, layout: { L, s, w }, clips: null,
      title: lab?.title || room.title, narration: lab?.narration || room.narration, describe: lab?.describe || '',
      tags: lab ? tagsFrom(lab, { L, s, w }) : room.tags,
    };
    next.soundFrom = next.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || room.soundFrom;
    window.__lastRoom = next;
    changing = false;
    enter(next, { changed: true });
  } catch (e) {
    changing = false;
    console.warn(e);
    $('caption').textContent = 'I couldn’t change it that time. Hold the button and try again.';
    say($('caption').textContent, ctx);
  }
}

$('leave').onclick = () => { hush(); music?.stop(); music = null; view?.tiltOff(); current = null; run++; show('home'); };
$('mute').onclick = () => {
  muted = !muted;
  music?.gain.gain.setTargetAtTime(muted ? 0 : 0.85, ctx().currentTime, 0.2);
  $('mute').setAttribute('aria-pressed', String(!muted));
};
let tiltWanted = false;
function tiltOn(on) { tiltWanted = on; $('tilt').setAttribute('aria-pressed', String(on)); if (view) on ? view.tiltOn() : view.tiltOff(); }
$('tilt').onclick = async () => {
  if (!tiltWanted && typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
  }
  tiltOn(!tiltWanted);
};
// the walking stick: drag the knob, walk that way
{
  const st = $('stick'), knob = st.firstChild;
  let id = null;
  const move = e => {
    const r = st.getBoundingClientRect(), dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2), m = Math.min(1, Math.hypot(dx, dy)) / (Math.hypot(dx, dy) || 1);
    knob.style.transform = `translate(${dx * m * 18}px, ${dy * m * 18}px)`;
    view?.walk.set(dx * m, -dy * m);
  };
  st.addEventListener('pointerdown', e => { id = e.pointerId; st.setPointerCapture(id); move(e); });
  st.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
  const end = () => { id = null; knob.style.transform = ''; view?.walk.set(0, 0); };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
}

// ---------- the example, baked ahead of time so it opens instantly ----------
$('example').onclick = async () => {
  ctx().resume();
  $('example').textContent = 'Opening…';
  try {
    const meta = await (await fetch('hero/meta.json')).json();
    const toCanvas = img => { const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); return c; };
    const [pano, depthImg, front, back] = await Promise.all(['hero/pano.jpg', 'hero/depth.png', 'hero/front.jpg', 'hero/back.jpg'].map(u => load(u).catch(() => null)));
    const room = { ...meta, pano: toCanvas(pano), depth: depthImg && toCanvas(depthImg), sound: 'hero/sound.mp3', front, back, frontJpg: front && shrink(front, 1600, 0.88) };
    room.soundFrom = room.tags.find(t => t.name === meta.soundFromName) || null;
    run++;
    enter(room);
  } catch (e) { console.warn(e); say('The example isn’t ready yet.', ctx); }
  $('example').textContent = 'Try the example';
};

// dev only: ?bake saves a finished room as the example (the local server writes it to public/memory/hero)
async function bake(room) {
  const lines = [room.narration, ...sentences(room.describe), CONFIRM].filter(Boolean), clips = {};
  await Promise.all(lines.map(async t => { const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) }); if (r.ok) clips[t] = await r.json(); }));
  await api('bake', {
    pano: room.pano.toDataURL('image/jpeg', 0.9),
    depth: room.depth ? room.depth.toDataURL('image/png') : null,
    front: room.frontJpg,
    back: shrink(room.back, 1600, 0.88),
    sound: room.sound,
    narrationClip: null,
    meta: { title: room.title, narration: room.narration, describe: room.describe, spec: room.spec, clips, tags: room.tags.map(({ name, source, u, vb }) => ({ name, source, u, vb })), soundFromName: room.soundFrom?.name || '', faceU: room.faceU },
  });
  console.log('baked');
}
window.nibMemory = { converse, build, enter, change, bake, get view() { return view; }, get room() { return current; } };
