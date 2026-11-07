// Nib · Memory: say a room you remember; Nib asks a question or two, builds it all the way around you,
// tells you what's where, and changes it when you say it was different. Every detail is labeled
// "from your words" or "imagined by Nib". The 3D view is for the family; the voice is for everyone.
//
// Voice is Nib's own (../voice.js, ../ears.js): the ears stay open after the first tap. "Nib" alone opens a
// listening window; "Hey Nib, <words>" acts at once. Nib also opens the window itself right after it asks
// something. Whatever is said in a window goes to the step that is active: the memory, the answer to a
// question, or a change to the room. Short whole phrases are commands anywhere ("describe the room",
// "show what's real", "start over", "home", "paper", "around me").
import { voice } from '../voice.js';
import { makeEars } from '../ears.js';
import { load, shrink, stripInput, makeLoop, equirect } from './pano.js';
import { depthOf, makeRoom, warmDepth } from './room.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const sentences = t => String(t || '').match(/[^.!?]+[.!?]+[\s”’"]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
voice.init();
const ctx = () => { if (!voice.ctx) voice.unlock(); return voice.ctx; };

function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
const screen = () => document.querySelector('.screen.on')?.id;
// captions follow whatever Nib says, on the screen that is showing (not aria-live: the voice already says it)
voice.onCaption = text => { const el = { room: $('caption'), talk: $('question'), home: $('note1') }[screen()]; if (el) el.textContent = text; };

async function api(name, body) {
  const r = await fetch('/api/memory/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${name} failed`);
  return j;
}

// ---------- the fixed lines, made in the natural voice while the page loads ----------
const L = {
  greet: 'Memory. Tell me about a room you remember. Just start talking.',
  building: 'Got it. Building your room. It takes about half a minute.',
  confirm: 'Is that how you remember it? Tell me anything to change.',
  almost: 'Almost there.',
  added: 'Got it. I’ll add that.',
  changing: 'Okay. Changing the whole room. About twenty seconds.',
  done: 'Done.',
  fail: 'I couldn’t change it that time. Say it again.',
  broke: 'Something went wrong. Say try again.',
  over: 'Starting over. Tell me about a room you remember.',
  here: 'You’re already in Memory.',
  home: 'Going home.', paper: 'Opening Paper.', around: 'Opening Around me.',
  example: 'Opening the example.',
  fixExample: 'The example can’t be changed. Tell me your own room to try that.',
};
voice.prefetch(Object.values(L));

// ---------- ears: open after the first tap, then always on ----------
let ears = null, micDenied = false;
function startEars() {
  if (ears || micDenied) return;
  voice.unlock();
  voice.micOpen = true;
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
  ears = makeEars({
    ctx: voice.ctx, lang: () => 'en',
    ignore: () => false, // barge-in: listen while Nib talks; Nib's own words are dropped by the echo check
    onCapture: () => voice.echoSnapshot(),
    onText: (text, said) => { if (!voice.echo(text, said)) heard(text); },
  });
  ears.start().catch(() => {
    ears = null; micDenied = true; voice.micOpen = false;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }
    $('note1').textContent = 'The microphone is blocked. You can type instead.';
  });
}

// Like Around me: one tap anywhere (a VoiceOver double-tap works too) unlocks sound and opens the ears.
// After that, nothing needs a tap: Nib listens for the memory right away, and for "Nib" any time after.
function begin() {
  if (!$('start') || $('start').hidden) return;
  $('start').hidden = true;
  startEars();
  warmDepth().catch(() => {});
  voice.say(L.greet).then(() => { if (step === 'home' && !collected) openWindow(25000, false); });
}
addEventListener('click', begin, { capture: true }); // click (not pointerdown): iOS only unlocks audio on a real activation
if (params.has('bake')) $('start').hidden = true;

// ---------- one router for everything heard or typed ----------
let step = 'home';            // home | asking | building | room
let windowUntil = 0, collected = '', commitTimer = null;
const norm = t => String(t).toLowerCase().replace(/[.,!?"“”'’]/g, '').replace(/\s+/g, ' ').trim();

function openWindow(ms = 9000, cue = true) {
  windowUntil = performance.now() + ms;
  if (cue) voice.earcon(true);
}

// The ears hear "Nib" many ways; "hey" alone also opens a window, as Manraj asked.
const fixWake = t => t
  .replace(/^\s*(hey|hi|ok|okay|a|hay)[\s,]+(nim|neeb|nibe|nibh|knee|nieb|nibble|ned|need|nab|nick|nit|nibb?ed|nebb?|knib|nip|neb|nibs|knob|nib)\b[,.!?]*/i, 'Hey Nib, ')
  .replace(/^\s*(hey|hi|hay)( there)?[\s,.!?]*$/i, 'Nib')
  .replace(/^Hey Nib,\s*$/, 'Nib');

function heard(text, { typed = false } = {}) {
  text = fixWake(String(text || '').trim());
  if (!text) return;
  const nav = voice.navigation(text);
  if (nav) return go(nav);
  const wake = voice.wake(text);
  let words = text;
  if (wake) {
    if (!wake.rest) { voice.stop(); return openWindow(); }
    words = wake.rest;
  } else if (!typed && performance.now() > windowUntil && !collected) return; // not meant for Nib
  const cmd = command(norm(words));
  if (cmd) { collected = ''; windowUntil = 0; return cmd(); }
  if (typed) return commit(words);
  // speech arrives a phrase at a time: keep collecting until a short silence, then act on all of it
  collected = collected ? `${collected} ${words}` : words;
  windowUntil = performance.now() + 1800;
  clearTimeout(commitTimer);
  const check = () => { if (ears?.busy || performance.now() < windowUntil) commitTimer = setTimeout(check, 400); else { const t = collected; collected = ''; windowUntil = 0; commit(t); } };
  commitTimer = setTimeout(check, 1300);
}

function commit(text) {
  if (!text) return;
  if (step === 'home') return converse(text);
  if (step === 'room') return change(text);
  // said while the room is being built: kept, and applied to the whole room as soon as it's ready
  if (step === 'building') { later.push(text); bubble('you', text); voice.say(L.added); }
}
let later = [];

function command(t) {
  if (/^(stop|quiet|be quiet|pause|shh+|hush)$/.test(t)) return () => voice.stop();
  if (/^(start over|start again|new (memory|room)|begin again|restart)$/.test(t)) return startOver;
  if (/^(try again|again)$/.test(t) && retry) return () => retry();
  if (step === 'home' && /^(try|open|show me) the example$|^example$/.test(t)) return () => openExample();
  if (step !== 'room') return null;
  if (/^(describe( the room| it)?|what(s| is) (here|around me|in the room)|where am i|tell me again|repeat( that)?|say (that|it) again)$/.test(t)) return describeAgain;
  if (/^(show (me )?what(s| is) real|what(s| is) real|show (the )?labels)$/.test(t)) return () => real(true, true);
  if (/^hide (the )?labels$/.test(t)) return () => real(false);
  if (/^(mute|sound off|music off)$/.test(t)) return () => setMuted(true);
  if (/^(unmute|sound on|music on)$/.test(t)) return () => setMuted(false);
  return null;
}

function go(dest) {
  if (dest === 'memory') return voice.say(L.here);
  const url = { home: '../', paper: '../paper.html', around: '../around.html' }[dest];
  voice.say(L[dest]).then(() => { location.href = url; });
}

// The yellow button: talk now (stops Nib, opens a window); tap again to finish early.
function bindTalk(btn) {
  btn.addEventListener('click', () => {
    startEars();
    if (collected) { windowUntil = 0; return; } // finish now
    voice.stop();
    openWindow(10000);
  });
}
['mic1', 'mic2', 'mic3'].forEach(id => bindTalk($(id)));
// listening shows on the button; music ducks under Nib's voice and while you talk
setInterval(() => {
  const open = performance.now() < windowUntil || !!collected;
  for (const id of ['mic1', 'mic2', 'mic3']) { $(id).classList.toggle('live', open); $(id).setAttribute('aria-pressed', String(open)); }
  if (screen() === 'home' && open && !voice.speaking) $('note1').textContent = collected ? `“${collected}”` : 'Listening…';
  if (music) music.gain.gain.setTargetAtTime(muted ? 0 : voice.speaking || open ? 0.18 : 0.8, ctx().currentTime, 0.25);
}, 200);

$('typeForm').onsubmit = e => { e.preventDefault(); startEars(); const t = $('memory').value.trim(); $('memory').value = ''; heard(t, { typed: true }); };
$('memory').oninput = () => { $('build').disabled = $('memory').value.trim().length < 2; };
$('answerForm').onsubmit = e => { e.preventDefault(); const t = $('answer').value.trim(); $('answer').value = ''; if (t) heard(t, { typed: true }); };

// ---------- a short conversation, then the build ----------
let run = 0, retry = null;
function bubble(who, text) {
  const li = document.createElement('li');
  li.className = who;
  li.textContent = text;
  $('chat').append(li);
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return li;
}
function startOver() {
  run++; later = []; retry = null; collected = ''; current = null;
  soundTok++; music?.stop(); music = null; view?.tiltOff();
  step = 'home';
  show('home');
  voice.say(L.over).then(() => { if (step === 'home') openWindow(12000, false); });
}
$('talkBack').onclick = startOver;
$('leave').onclick = startOver;

async function converse(memory) {
  const me = ++run;
  retry = null; later = [];
  $('chat').innerHTML = ''; $('waitimg').hidden = true; $('clock').textContent = ''; $('answer').value = '';
  step = 'building';
  show('talk');
  bubble('you', memory);
  voice.say(L.building);
  build(memory, me);
}

const STEPS = [['spec', 'Listening back to what you said'], ['scene', 'Building the room in front of you'], ['back', 'Building the walls behind you'], ['labels', 'Marking what came from your words'], ['sound', 'Bringing back the sound'], ['depth', 'Giving it depth']];
function steps() {
  const li = bubble('nib', 'Building the room…');
  const head = document.createElement('span'); head.className = 'head';
  head.textContent = 'Building the room…';
  li.textContent = ''; li.append(head);
  const ol = document.createElement('ol'); ol.className = 'steps';
  ol.innerHTML = STEPS.map(([k, t]) => `<li data-k="${k}">${t}<span class="t"></span></li>`).join('');
  li.append(ol);
  const t0 = performance.now(), el = k => ol.querySelector(`[data-k="${k}"]`), secs = () => Math.round((performance.now() - t0) / 1000);
  return {
    t0, secs,
    tick: () => { head.textContent = `Building the room… ${secs()} s`; $('clock').textContent = `${secs()} s`; },
    finish: () => { head.textContent = `Built in ${secs()} s`; },
    go: k => { el(k).className = 'go'; },
    done: k => { const e = el(k); e.className = 'done'; e.querySelector('.t').textContent = secs() + ' s'; },
    bad: (k, msg) => { const e = el(k); e.className = 'bad'; e.querySelector('.t').textContent = msg; },
  };
}

async function build(memory, me) {
  step = 'building';
  const st = steps(), tick = setInterval(st.tick, 250);
  try {
    // the front is built straight from the words while the scene plan (what is where, which details are
    // theirs) is worked out alongside; the plan feeds the walls behind you, the labels and the sound
    const said = memory;
    const nudge = setTimeout(() => { if (me === run && step === 'building' && !voice.speaking) voice.say(L.almost); }, 17000);
    st.go('spec'); st.go('scene');
    const specP = api('spec', { memory }).catch(() => ({ memory: said, front_prompt: said, back_prompt: '', spoken: [], sound_prompt: said })).then(s => (st.done('spec'), s));
    const frontP = api('scene', { memory: said }).then(r => load(r.image));
    const front = await frontP;
    st.done('scene');
    if (me !== run) return clearInterval(tick);
    $('waitimg').src = front.src; $('waitimg').hidden = false;
    const frontJpg = shrink(front, 1600, 0.88);
    const spec = await specP;
    if (me !== run) return clearInterval(tick);
    st.go('labels');
    const labelsP = api('labels', { scene: frontJpg, spec }).then(r => (st.done('labels'), r)).catch(e => (st.bad('labels', 'skipped'), console.warn(e), null));
    st.go('sound');
    const soundP = api('sound', { memory: spec.sound_prompt }).then(r => (st.done('sound'), 'data:audio/mpeg;base64,' + r.audio)).catch(e => (st.bad('sound', 'skipped'), console.warn(e), null));
    // You step inside as soon as the front and its labels are ready. The walls behind you start as a soft
    // continuation of the front and fill in when painted (a few seconds later); then the room takes its depth.
    st.go('back');
    const backP = paintBack(front, spec);
    const lab = await labelsP;
    if (me !== run) return clearInterval(tick);
    const { loop: loop0, L: len, s, w } = makeLoop(front, await load(stripInput(front)));
    const room = {
      spec, front, back: null, frontJpg, pano: equirect(loop0), depth: null,
      title: lab?.title || spec.title || 'Your room', narration: lab?.narration || '', describe: lab?.describe || '',
      tags: tagsFrom(lab, { L: len, s, w }), faceU: (w / 2 - s) / len, sound: null,
    };
    clearTimeout(nudge);
    fillBehind(room, front, backP, st);
    soundP.then(snd => { if (!snd) return; room.sound = snd; if (current === room) startSound(room); else if (current?.spec === room.spec) { current.sound = snd; startSound(current); } });
    room.soundFrom = room.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || null;
    clearInterval(tick);
    if (me !== run) return;
    st.finish();
    window.__lastRoom = room;
    enter(room);
  } catch (e) {
    clearInterval(tick);
    console.warn(e);
    if (me !== run) return;
    retry = () => { retry = null; li.onclick = null; build(memory, ++run); };
    const broke = /balance|credit|402/i.test(e.message);
    const li = bubble('nib', broke ? 'Nib is out of picture credit right now. Say “try the example” to step into one I built earlier.' : `Something went wrong: ${e.message} Say “try again”, or tap here.`);
    li.tabIndex = 0; li.setAttribute('role', 'button'); li.style.cursor = 'pointer';
    li.onclick = () => retry?.();
    step = 'building';
    if (broke) { step = 'home'; voice.say('Nib is out of picture credit right now. Say try the example, and I’ll take you into one I built earlier.').then(() => openWindow(12000)); return; }
    voice.say(L.broke).then(() => openWindow(10000));
  }
}

// When the walls behind you are painted, swap them in; then give the whole room its depth.
function fillBehind(room, front, backP, st) {
  return backP.then(back => {
    st?.done('back');
    room.back = back;
    const { loop } = makeLoop(front, back);
    room.pano = equirect(loop);
    if (current === room) view.setPano(room.pano);
    st?.go('depth');
    return depthOf(loop);
  }).then(d => {
    st?.done('depth');
    room.depth = d;
    if (current === room) view.setDepth(d);
    if (params.has('bake')) bake(room);
  }).catch(e => { console.warn(e); st?.bad('back', 'failed'); });
}

// the walls behind you: one painting from the front's two edge strips (the joins are cross-faded in pano.js)
async function paintBack(front, spec) {
  return load((await api('back', { strip: stripInput(front), spec })).image);
}

// labels on the front picture -> positions around the loop; the walls behind you are honestly "imagined"
function tagsFrom(lab, { L: len, s, w }) {
  const tags = (lab?.elements || []).map(e => {
    const [y0, x0, y1, x1] = e.box_2d.map(v => v / 1000), x = (x0 + x1) / 2 * w;
    return { name: e.name, source: e.source, u: (((x - s) % len) + len) % len / len, vb: y0 + (y1 - y0) * 0.25 };
  });
  tags.push({ name: 'the walls behind you', source: 'invented', u: (w - s + (w - 2 * s) / 2) / len, vb: 0.3 });
  return tags;
}

// ---------- inside: the room, the sound, and Nib telling you what's where ----------
let view = null, music = null, shown = false, current = null;
// say lines in order; stops early if anything else speaks (voice.stop or a new say bumps voice.seq)
async function sayLines(lines) {
  for (const line of lines) {
    const seq = voice.seq;
    await voice.say(line);
    if (voice.seq !== seq + 1) return false; // say() bumps seq once; anything more means interrupted
  }
  return true;
}

async function enter(room, { changed = false } = {}) {
  current = room;
  step = 'room';
  ctx();
  show('room');
  view?.destroy();
  $('tags').innerHTML = '';
  view = makeRoom($('stage'), room);
  view.face(room.faceU ?? 0.5);
  if (tiltWanted) view.tiltOn();
  $('rtitle').textContent = room.title;
  $('stage').setAttribute('aria-label', `${room.title}. ${room.describe}`);
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
  await sleep(changed ? 100 : 900);
  if (current !== room) return;
  const lines = [...(changed ? [L.done] : room.narration ? [room.narration] : []), ...sentences(room.describe), L.confirm];
  if (later.length) { const t = later.join('. '); later = []; return change(t); }
  const finished = await sayLines(lines);
  if (finished && current === room && step === 'room') openWindow(10000);
}

function describeAgain() {
  if (!current) return;
  sayLines([...sentences(current.describe), L.confirm]).then(done => { if (done && step === 'room') openWindow(10000); });
}

let muted = false, soundTok = 0;
async function startSound(room) {
  const tok = ++soundTok;
  music?.stop(); music = null;
  $('mute').hidden = !room.sound;
  if (!room.sound) return;
  try {
    const c = ctx(), buf = await c.decodeAudioData(await (await fetch(room.sound)).arrayBuffer());
    if (tok !== soundTok || current !== room) return;
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
function setMuted(m) { muted = m; $('mute').setAttribute('aria-pressed', String(!muted)); $('mute').setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'); }
$('mute').onclick = () => setMuted(!muted);

function real(on, speak = false) {
  shown = on;
  $('room').classList.toggle('show-real', on);
  $('tags').inert = !on;
  $('real').setAttribute('aria-pressed', String(on));
  $('real').textContent = on ? 'Hide labels' : 'Show what’s real';
  $('legend').hidden = !on;
  if (!on) $('tagsheet').hidden = true;
  if (speak && on && current) {
    const mine = current.tags.filter(t => t.source === 'memory').map(t => t.name), made = current.tags.filter(t => t.source === 'invented' && t.name !== 'the walls behind you').map(t => t.name);
    voice.say(`From your words: ${mine.join(', ') || 'nothing I could point to'}. Imagined by Nib: ${made.slice(0, 5).join(', ') || 'nothing else'}, and the walls behind you.`);
  }
}
$('real').onclick = () => real(!shown, !shown);

const SRC = { memory: 'This came from your words.', invented: 'Imagined by Nib to fill the room. You didn’t say it.' };
let tagOpen = null;
function openTag(t, b) {
  tagOpen = { t, b };
  $('tagTitle').textContent = t.name[0].toUpperCase() + t.name.slice(1);
  $('tagSrc').textContent = SRC[t.source];
  $('tagsheet').hidden = false;
  $('tagsheet').querySelector('button').focus();
}
$('tagsheet').onclick = e => {
  const act = e.target.dataset?.act;
  if (!act || !tagOpen) return;
  const { t, b } = tagOpen;
  $('tagsheet').hidden = true;
  b.focus();
  if (act === 'keep') { b.classList.remove('wrong'); b.classList.add('kept'); return; }
  if (act === 'remove') return change(`Remove the ${t.name}.`);
  b.classList.add('wrong');
  voice.say(`What should the ${t.name} be?`).then(() => openWindow(12000));
};
$('stage').addEventListener('pointerdown', () => { $('tagsheet').hidden = true; });

// ---------- "No, the radio was by the window": change the room by voice ----------
let changing = false;
async function change(text) {
  const room = current;
  if (!room) return;
  if (changing) { later.push(text); return voice.say(L.added); } // one change at a time; the next follows
  if (!room.front) return voice.say(L.fixExample);
  changing = true;
  voice.say(L.changing);
  const t0 = performance.now(), tick = setInterval(() => { if (current === room) $('caption').textContent = `Changing the whole room: “${text}” · ${Math.round((performance.now() - t0) / 1000)} s`; }, 250);
  try {
    // the change goes into the plan and the front photo; then the walls behind you are rebuilt from the new
    // front, so a change of light, season or people reaches all 360 degrees, not just one spot
    const spec = { ...room.spec, memory: `${room.spec.memory} Change: ${text}`, spoken: [...(room.spec.spoken || []), text], back_prompt: `${room.spec.back_prompt || ''} Change: ${text}` };
    const r = await api('fix', { scene: room.frontJpg, correction: text, spec });
    const front = await load(r.image);
    const frontJpg = shrink(front, 1600, 0.88);
    const labP = api('labels', { scene: frontJpg, spec }).catch(() => null);
    const backP = paintBack(front, spec).catch(() => room.back);
    const lab = await labP;
    const { loop, L: len, s, w } = makeLoop(front, room.back || await load(stripInput(front)));
    clearInterval(tick);
    const next = {
      ...room, spec, front, frontJpg, pano: equirect(loop), depth: room.depth, clips: null,
      title: lab?.title || room.title, narration: lab?.narration || room.narration, describe: lab?.describe || '',
      tags: lab ? tagsFrom(lab, { L: len, s, w }) : room.tags,
    };
    next.soundFrom = next.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || room.soundFrom;
    changing = false;
    if (current !== room) return;
    window.__lastRoom = next;
    enter(next, { changed: true });
    fillBehind(next, front, backP);
  } catch (e) {
    clearInterval(tick);
    changing = false;
    console.warn(e);
    if (current !== room) return;
    voice.say(L.fail).then(() => openWindow(10000));
  }
}

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
// Its spoken lines are baked too: they go straight into Nib's voice cache, so nothing waits on the network.
function useClips(clips) {
  for (const [text, c] of Object.entries(clips || {})) {
    if (!c?.pcm) continue;
    const bytes = Uint8Array.from(atob(c.pcm), ch => ch.charCodeAt(0));
    const pcm = Float32Array.from(new Int16Array(bytes.buffer, 0, bytes.length >> 1), v => v / 32768);
    voice.clips.set(JSON.stringify([voice.lang, text]), { done: true, pcm, rate: c.rate || 24000, p: Promise.resolve() });
  }
}
const heroMeta = fetch('hero/meta.json').then(r => r.json()).then(m => (useClips(m.clips), m)).catch(() => null);
async function openExample() {
  startEars();
  $('example').textContent = 'Opening…';
  try {
    const meta = await heroMeta;
    if (!meta) throw new Error('no example');
    const toCanvas = img => { const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); return c; };
    const [pano, depthImg, front, back] = await Promise.all(['hero/pano.jpg', 'hero/depth.png', 'hero/front.jpg', 'hero/back.jpg'].map(u => load(u).catch(() => null)));
    const room = { ...meta, pano: toCanvas(pano), depth: depthImg && toCanvas(depthImg), sound: 'hero/sound.mp3', front, back, frontJpg: front && shrink(front, 1600, 0.88) };
    room.soundFrom = room.tags.find(t => t.name === meta.soundFromName) || null;
    run++; later = []; collected = '';
    enter(room);
  } catch (e) { console.warn(e); voice.say('The example isn’t ready yet.'); }
  $('example').textContent = 'Try the example';
}
$('example').onclick = openExample;

// dev only: ?bake saves a finished room as the example (Memory's standalone dev server writes it)
async function bake(room) {
  const lines = [room.narration, ...sentences(room.describe), L.confirm].filter(Boolean), clips = {};
  await Promise.all(lines.map(async t => { const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) }); if (r.ok) clips[t] = await r.json(); }));
  await api('bake', {
    pano: room.pano.toDataURL('image/jpeg', 0.9), depth: room.depth ? room.depth.toDataURL('image/png') : null,
    front: room.frontJpg, back: shrink(room.back, 1600, 0.88), sound: room.sound,
    meta: { title: room.title, narration: room.narration, describe: room.describe, spec: room.spec, clips, tags: room.tags.map(({ name, source, u, vb }) => ({ name, source, u, vb })), soundFromName: room.soundFrom?.name || '', faceU: room.faceU },
  });
  console.log('baked');
}
window.nibMemory = { heard, converse, build, enter, change, startOver, openExample, get step() { return step; }, get view() { return view; }, get room() { return current; } };
