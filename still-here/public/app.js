// Still Here: photo + memory -> a 360 room you can stand in, every detail labeled by where it came from.
import { load, shrink, stripInput, edgeScore, makeLoop, equirect } from './pano.js';
import { depthOf, makeRoom } from './room.js';
import { micButton, say } from './voice.js';

const $ = id => document.getElementById(id);
let actx;
const ctx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
const params = new URLSearchParams(location.search);

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $('glow').hidden = id === 'room';
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));

async function api(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} failed`);
  return j;
}

// ---------- 1. the photo ----------
let photo = null; // data URL, shrunk
$('photo').onchange = async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  try { photo = shrink(await load(url)); } catch { alert('That photo could not be opened. Try a JPEG or PNG.'); return; }
  finally { URL.revokeObjectURL(url); }
  $('thumb').src = photo; $('waitimg').src = photo;
  show('tell');
  setTimeout(() => $('memory').focus({ preventScroll: true }), 400);
};

// ---------- 2. the memory ----------
const memory = $('memory');
memory.oninput = () => { $('build').disabled = memory.value.trim().length < 8; };
micButton($('mic1'), ctx, {
  onText: t => { memory.value = (memory.value.trim() + ' ' + t).trim(); memory.oninput(); },
  onState: s => { $('note1').textContent = { listening: 'Listening… let go when you’re done.', hearing: 'Writing it down…', denied: 'The microphone is blocked. You can type instead.', idle: 'Hold the circle and speak, or type.' }[s]; },
});

// ---------- 3. building, with one question back ----------
const STEPS = [['scene', 'Painting the room as you remember it'], ['back', 'Painting the walls behind you'], ['labels', 'Sorting what’s real from what’s imagined'], ['sound', 'Bringing back the sound'], ['depth', 'Giving it depth']];
function steps() {
  $('steps').innerHTML = STEPS.map(([k, t]) => `<li id="s-${k}">${t}<span class="t"></span></li>`).join('');
  const t0 = performance.now();
  return {
    t0,
    go: k => $('s-' + k).className = 'go',
    done: (k, t = performance.now()) => { const li = $('s-' + k); li.className = 'done'; li.querySelector('.t').textContent = Math.round((t - t0) / 1000) + ' s'; },
    bad: (k, msg) => { const li = $('s-' + k); li.className = 'bad'; li.querySelector('.t').textContent = msg; },
  };
}

let answerWait;
$('build').onclick = () => { ctx().resume(); build(photo, memory.value.trim()); };

async function build(photo, mem) {
  show('wait');
  $('enter').hidden = true;
  $('question').textContent = ' '; $('answerbox').hidden = $('send').parentElement.hidden = true;
  const st = steps(), tick = setInterval(() => { $('clock').textContent = `Building your room · ${Math.round((performance.now() - st.t0) / 1000)} s`; }, 250);
  // the question fills the wait; its answer feeds the walls behind you and the sound
  let answered;
  const answer = new Promise(ok => { answered = ok; });
  let replied = false;
  answerWait = v => { replied = true; answered(v); };
  api('ask', { memory: mem }).then(async ({ question }) => {
    if (replied) return;
    $('question').textContent = question;
    $('answerbox').hidden = $('send').parentElement.hidden = false;
    say(question, ctx);
  }).catch(() => answered(''));
  setTimeout(() => answered(''), 45000);

  try {
    st.go('scene');
    const sceneP = api('scene', { photo, memory: mem });
    const front = await load((await sceneP).image);
    st.done('scene');
    const frontJpg = shrink(front, 1600, 0.88);
    st.go('labels');
    const labelsP = api('labels', { photo, scene: frontJpg, memory: mem }).then(r => (st.done('labels'), r)).catch(e => (st.bad('labels', 'skipped'), console.warn(e), null));

    const extra = await Promise.race([answer, new Promise(ok => setTimeout(() => ok(''), 1500))]) || await answer;
    $('answerbox').hidden = $('send').parentElement.hidden = true;
    const full = extra ? `${mem} ${extra}` : mem;
    st.go('sound');
    const soundP = api('sound', { memory: full }).then(r => (st.done('sound'), 'data:audio/mpeg;base64,' + r.audio)).catch(e => (st.bad('sound', 'skipped'), console.warn(e), null));

    st.go('back');
    const strip = stripInput(front);
    // three tries in parallel; keep the one that meets its edges most cleanly
    // take what has arrived 4 s after the first good one, so one slow try can't hold the room hostage
    const backs = [];
    await new Promise(ok => {
      let left = 3;
      for (let i = 0; i < 3; i++) api('back', { strip, memory: full }).then(r => load(r.image)).then(b => { backs.push(b); if (backs.length === 1) setTimeout(ok, 4000); }).catch(console.warn).finally(() => { if (--left === 0) ok(); });
    });
    if (!backs.length) throw new Error('The walls behind you could not be painted. Try again.');
    const back = backs.map(b => [b, edgeScore(b, front.width, front.height)]).sort((a, b) => a[1] - b[1])[0][0];
    st.done('back'); window.__parts = { front, back, backs };
    const { loop, L, s, w } = makeLoop(front, back);
    const pano = equirect(loop);

    st.go('depth');
    let depth = null;
    try { depth = await depthOf(loop); st.done('depth'); } catch (e) { console.warn(e); st.bad('depth', 'flat'); }

    const lab = await labelsP;
    const room = {
      pano, depth, memory: full,
      title: lab?.title || 'Your room',
      narration: lab?.narration || '',
      tags: tagsFrom(lab, { L, s, w }),
      soundFrom: null,
      faceU: (w / 2 - s) / L,
      sound: await soundP,
    };
    room.soundFrom = room.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || null;
    clearInterval(tick);
    $('clock').textContent = `Ready in ${Math.round((performance.now() - st.t0) / 1000)} s`;
    $('question').textContent = room.title;
    $('enter').hidden = false;
    $('enter').onclick = () => enter(room);
    if (params.has('bake')) bake(room);
  } catch (e) {
    clearInterval(tick);
    $('question').textContent = 'Something went wrong.';
    $('clock').textContent = e.message;
    $('enter').hidden = false; $('enter').textContent = 'Try again'; $('enter').onclick = () => { $('enter').textContent = 'Step inside'; build(photo, mem); };
  }
}
const sendAnswer = () => {
  const v = $('answer').value.trim(); $('answer').value = '';
  $('answerbox').hidden = $('send').parentElement.hidden = true;
  $('question').textContent = v ? 'Thank you. I’ll add that.' : 'Okay. Almost there.';
  answerWait?.(v);
};
$('send').onclick = sendAnswer;
$('answer').onkeydown = e => { if (e.key === 'Enter') sendAnswer(); };
$('skip').onclick = () => answerWait?.('');
micButton($('mic2'), ctx, { onText: t => { $('answer').value = t; sendAnswer(); } });

// labels on the front painting -> positions around the loop; the walls behind you are honestly "imagined"
function tagsFrom(lab, { L, s, w }) {
  const tags = (lab?.elements || []).map(e => {
    const [y0, x0, y1, x1] = e.box_2d.map(v => v / 1000), x = (x0 + x1) / 2 * w;
    return { name: e.name, source: e.source, u: (((x - s) % L) + L) % L / L, vb: y0 + (y1 - y0) * 0.25 };
  });
  tags.push({ name: 'the walls behind you', source: 'invented', u: (w - s + (w - 2 * s) / 2) / L, vb: 0.3 });
  return tags;
}

// ---------- 4. inside ----------
let view = null, music = null, shown = false;
async function enter(room) {
  ctx().resume();
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') tiltOn(true); }).catch(() => {});
  else if (matchMedia('(hover: none)').matches && 'DeviceOrientationEvent' in window) tiltOn(true);
  show('room');
  view?.destroy();
  $('tags').innerHTML = '';
  view = makeRoom($('stage'), room);
  view.face(room.faceU ?? 0.5);
  $('rtitle').textContent = room.title;
  for (const t of view.tags) {
    const b = document.createElement('button');
    b.className = `tag ${t.source}`;
    b.innerHTML = `<b></b>`;
    b.firstChild.textContent = t.name;
    b.onclick = () => openSheet(t, b);
    $('tags').append(b);
    t.el = b;
  }
  real(false);
  // sound: placed at its source if we know it, else all around
  music?.stop(); music = null;
  if (room.sound) {
    try {
      const c = ctx(), buf = await c.decodeAudioData(await (await fetch(room.sound)).arrayBuffer());
      const src = c.createBufferSource(), gain = c.createGain();
      src.buffer = buf; src.loop = true; gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(0.9, c.currentTime + 3);
      if (room.soundFrom) {
        const p = c.createPanner(), at = view.tags.find(t => t === room.soundFrom || t.name === room.soundFrom.name)?.p;
        p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 0.8;
        if (at) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; }
        src.connect(p).connect(gain).connect(c.destination);
        view.hear(c);
      } else src.connect(gain).connect(c.destination);
      src.start();
      music = { stop: () => { try { src.stop(); } catch { } }, gain };
      $('mute').setAttribute('aria-pressed', 'true');
    } catch (e) { console.warn('sound', e); }
  }
  // one line, in the warm voice, as you arrive
  if (room.narration) {
    setTimeout(async () => {
      $('caption').textContent = room.narration; $('caption').classList.add('on');
      if (music) music.gain.gain.linearRampToValueAtTime(0.35, ctx().currentTime + 0.6);
      await say(room.narration, ctx, room.narrationClip);
      if (music) music.gain.gain.linearRampToValueAtTime(0.9, ctx().currentTime + 2);
      setTimeout(() => $('caption').classList.remove('on'), 1500);
    }, 1400);
  }
  setTimeout(() => { $('howto').style.opacity = 0; }, 7000);
}

function real(on) {
  shown = on;
  $('room').classList.toggle('show-real', on);
  $('real').setAttribute('aria-pressed', String(on));
  $('real').textContent = on ? 'Hide labels' : 'Show what’s real';
  $('legend').hidden = !on;
  if (!on) $('sheet').hidden = true;
}
$('real').onclick = () => real(!shown);

const SRC = { photo: 'This was in your photo.', memory: 'This came from what you remembered.', invented: 'Imagined to fill the room. It wasn’t in your photo or your words.' };
let sheetTag = null;
function openSheet(t, b) {
  sheetTag = { t, b };
  $('sheetTitle').textContent = t.name[0].toUpperCase() + t.name.slice(1);
  $('sheetSrc').textContent = SRC[t.source];
  $('sheet').hidden = false;
}
$('sheet').onclick = e => {
  const act = e.target.dataset?.act;
  if (!act || !sheetTag) return;
  const { b } = sheetTag;
  b.classList.remove('kept', 'wrong');
  b.classList.add({ keep: 'kept', remove: 'gone', wrong: 'wrong' }[act]);
  $('sheet').hidden = true;
};
$('stage').addEventListener('pointerdown', () => { $('sheet').hidden = true; });

$('leave').onclick = () => { music?.stop(); music = null; view?.tiltOff(); show(room0 ? 'home' : 'tell'); };
$('mute').onclick = () => {
  if (!music) return;
  const on = $('mute').getAttribute('aria-pressed') !== 'true';
  music.gain.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx().currentTime + 0.4);
  $('mute').setAttribute('aria-pressed', String(on));
};
function tiltOn(on) { $('tilt').setAttribute('aria-pressed', String(on)); if (view) on ? view.tiltOn() : view.tiltOff(); tiltWanted = on; }
let tiltWanted = false;
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
    knob.style.transform = `translate(${dx * m * 26}px, ${dy * m * 26}px)`;
    view?.walk.set(dx * m, -dy * m);
  };
  st.addEventListener('pointerdown', e => { id = e.pointerId; st.setPointerCapture(id); move(e); });
  st.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
  const end = () => { id = null; knob.style.transform = ''; view?.walk.set(0, 0); };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
}

// ---------- the example, baked ahead of time so it opens instantly ----------
let room0 = null;
$('example').onclick = async () => {
  ctx().resume();
  $('example').textContent = 'Opening…';
  try {
    const meta = await (await fetch('hero/meta.json')).json();
    const [pano, depthImg] = await Promise.all([load('hero/pano.jpg'), load('hero/depth.png')]);
    const toCanvas = img => { const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); return c; };
    room0 = { ...meta, pano: toCanvas(pano), depth: toCanvas(depthImg), sound: 'hero/sound.mp3' };
    room0.soundFrom = room0.tags.find(t => t.name === meta.soundFromName) || null;
    enter(room0);
  } catch (e) { alert('The example is not ready yet.'); console.warn(e); }
  $('example').textContent = 'Try the example';
};

// dev only: ?bake saves a finished room as the example (the local server writes it to public/hero)
async function bake(room) {
  const c = room.depth;
  await api('bake', {
    pano: room.pano.toDataURL('image/jpeg', 0.9),
    depth: c ? c.toDataURL('image/png') : null,
    sound: room.sound,
    narrationClip: room.narration ? await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: room.narration }) }).then(r => r.ok ? r.json() : null) : null,
    meta: { title: room.title, narration: room.narration, memory: room.memory, tags: room.tags.map(({ name, source, u, vb }) => ({ name, source, u, vb })), soundFromName: room.soundFrom?.name || '', faceU: room.faceU },
  });
  console.log('baked');
}
window.stillHere = { build, enter, bake, tagsFrom, get view() { return view; } };
