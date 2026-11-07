import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs';
import { voice } from './voice.js';
import { render, anchorOf } from './draw.js';
import { makeSim } from './sim.js';

const $ = id => document.getElementById(id);
const app = $('app'), video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const wait = ms => new Promise(r => setTimeout(r, ms));
// Phone haptics. Browsers refuse vibration until the person has tapped the page once.
const buzz = p => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(p); };

// Everything Nib says, per language. Field instructions come from the form reader in the chosen language.
const T = {
  en: {
    hold: 'Hold the form still. Reading it now.',
    count: (title, n) => `${title}. I found ${n} ${n === 1 ? 'place' : 'places'} to fill.`,
    first: l => `First: ${l}. Rest one finger on the page, and I'll guide it.`,
    none: "I can't find any blanks. Slide the whole form under the camera, then tap to try again.",
    next: 'Next:',
    stop: 'Stop.',
    coach: 'Write just to the right of your finger. Say done, or tap, when you finish.',
    lift: 'Lift your hand so I can read it.',
    wrote: t => `You wrote ${t}.`,
    blank: 'That spot still looks empty.',
    all: n => `All done. ${n} ${n === 1 ? 'field' : 'fields'} filled. You can hand the form in.`,
    noHand: "I can't see your hand. Rest one finger on the page.",
    noCamera: 'Nib needs the camera to see the form. Allow camera access for this page, then reload.',
    askHint: 'Hold the screen to ask me anything.',
    listening: 'Listening…',
    heardNothing: "I didn't catch that. Hold and ask again.",
    noMic: 'Voice questions need Chrome, with the microphone allowed.',
    left: n => `${n} ${n === 1 ? 'place' : 'places'} left.`,
    here: l => `You're on ${l}.`,
    firstOne: 'This is the first one.',
    offline: 'I can answer that once a model key is added.',
  },
  es: {
    hold: 'Mantén el formulario quieto. Lo estoy leyendo.',
    count: (title, n) => `${title}. Encontré ${n} ${n === 1 ? 'espacio' : 'espacios'} por llenar.`,
    first: l => `Primero: ${l}. Apoya un dedo en la hoja y te guío.`,
    none: 'No encuentro espacios en blanco. Pon todo el formulario bajo la cámara y toca para intentar de nuevo.',
    next: 'Siguiente:',
    stop: 'Alto.',
    coach: 'Escribe justo a la derecha de tu dedo. Di listo, o toca, cuando termines.',
    lift: 'Levanta la mano para que pueda leerlo.',
    wrote: t => `Escribiste ${t}.`,
    blank: 'Ese espacio todavía parece vacío.',
    all: n => `Listo. ${n} campos llenos. Ya puedes entregar el formulario.`,
    noHand: 'No veo tu mano. Apoya un dedo en la hoja.',
    noCamera: 'Nib necesita la cámara para ver el formulario. Permite el acceso a la cámara y recarga la página.',
    askHint: 'Mantén presionada la pantalla para preguntarme lo que sea.',
    listening: 'Escuchando…',
    heardNothing: 'No te entendí. Mantén presionado y pregunta otra vez.',
    noMic: 'Las preguntas por voz necesitan Chrome con el micrófono permitido.',
    left: n => `Faltan ${n}.`,
    here: l => `Estás en ${l}.`,
    firstOne: 'Este es el primero.',
    offline: 'Puedo responder eso cuando se agregue una clave del modelo.',
  },
  hi: {
    hold: 'फ़ॉर्म को स्थिर रखिए। मैं इसे पढ़ रहा हूँ।',
    count: (title, n) => `${title}। भरने के लिए ${n} जगहें मिलीं।`,
    first: l => `पहले: ${l}। एक उंगली पन्ने पर रखिए, मैं रास्ता बताऊँगा।`,
    none: 'मुझे कोई खाली जगह नहीं दिखी। पूरा फ़ॉर्म कैमरे के नीचे रखिए और फिर टैप कीजिए।',
    next: 'अगला:',
    stop: 'रुकिए।',
    coach: 'अपनी उंगली के ठीक दाईं ओर लिखिए। पूरा होने पर हो गया बोलिए या टैप कीजिए।',
    lift: 'हाथ हटाइए ताकि मैं पढ़ सकूँ।',
    wrote: t => `आपने लिखा: ${t}।`,
    blank: 'वह जगह अभी भी खाली लगती है।',
    all: n => `हो गया। ${n} जगहें भरी गईं। अब आप फ़ॉर्म जमा कर सकते हैं।`,
    noHand: 'मुझे आपका हाथ नहीं दिख रहा। एक उंगली पन्ने पर रखिए।',
    noCamera: 'फ़ॉर्म देखने के लिए Nib को कैमरा चाहिए। कैमरे की अनुमति दीजिए और पेज फिर से खोलिए।',
    askHint: 'कुछ भी पूछने के लिए स्क्रीन दबाकर रखिए।',
    listening: 'सुन रहा हूँ…',
    heardNothing: 'मैं समझ नहीं पाया। दबाकर रखिए और फिर पूछिए।',
    noMic: 'आवाज़ से सवाल के लिए Chrome और माइक्रोफ़ोन की अनुमति चाहिए।',
    left: n => `${n} बाकी हैं।`,
    here: l => `आप ${l} पर हैं।`,
    firstOne: 'यह पहला है।',
    offline: 'मॉडल की कुंजी जुड़ने पर मैं इसका जवाब दे पाऊँगा।',
  },
  zh: {
    hold: '请把表格放稳，我正在读。',
    count: (title, n) => `${title}。我找到 ${n} 处要填写。`,
    first: l => `第一处：${l}。把一根手指放在纸上，我来引导你。`,
    none: '我没找到空白处。请把整张表放到摄像头下，然后点一下重试。',
    next: '下一处：',
    stop: '停。',
    coach: '在手指右边写。写完说好了，或者点一下。',
    lift: '请把手移开，让我看一下。',
    wrote: t => `你写的是：${t}。`,
    blank: '这里看起来还是空的。',
    all: n => `全部完成，填了 ${n} 处。可以交表了。`,
    noHand: '我看不到你的手。请把一根手指放在纸上。',
    noCamera: 'Nib 需要摄像头才能看到表格。请允许使用摄像头，然后刷新页面。',
    askHint: '按住屏幕就可以问我任何问题。',
    listening: '正在听…',
    heardNothing: '我没听清。按住屏幕再问一次。',
    noMic: '语音提问需要 Chrome，并允许使用麦克风。',
    left: n => `还剩 ${n} 处。`,
    here: l => `你现在在：${l}。`,
    firstOne: '这是第一处。',
    offline: '加上模型密钥后我就能回答这个问题。',
  },
};

const ACTION = { start: 'Start', reading: 'Reading…', reveal: 'Reading…', idle: 'Read the form', guide: 'Repeat', write: 'Done writing', check: 'Reading…', done: 'Read another form' };
const CUE = { up: '↑', down: '↓', left: '←', right: '→' };
const KIND = { text: 'Write', date: 'Date', number: 'Number', checkbox: 'Check', signature: 'Sign', button: 'Tap' };

const S = {
  sim: new URLSearchParams(location.search).has('sim') ? makeSim() : null,
  lang: T[store.get('nib.lang')] ? store.get('nib.lang') : 'en',
  mode: 'start',
  fields: [], i: 0, title: '',
  tip: null, tipSeen: 0, trail: [], handPts: [], pointer: null,
  onTarget: false, arrivedSince: 0, prox: 1,
  lastCue: 0, lastBeep: 0, lastNoHand: 0, cue: '', pulses: [],
  sweepAt: 0, burstAt: 0, revealStart: 0, flag: null, hole: null, fit: null,
  startedAt: 0, finishedAt: 0, elapsed: '',
  lastSay: '', words: [], wordAt: 0, wordK: -1, boundary: false,
};
const t = () => T[S.lang];

// ---------- voice and word-by-word captions ----------
voice.init();
voice.lang = S.lang;
voice.onCaption = (text, cue) => { if (!cue) showCaption(text); };
voice.onWord = i => {
  S.boundary = performance.now();
  S.wordK = -1;
  S.words.forEach((w, j) => { if (Number(w.dataset.at) <= i) S.wordK = j; });
  S.wordAt = S.boundary;
  S.shownK = S.wordK;
  S.words.forEach((w, j) => w.classList.toggle('said', j <= S.wordK));
};
voice.onEnd = () => { for (const w of S.words) w.classList.add('said'); S.words = []; };
const say = (text, opts) => { if (!opts?.cue) S.lastSay = text; return voice.say(text, opts); };

function showCaption(text) {
  const p = $('captionText');
  p.replaceChildren();
  let at = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part) {
      if (/^\s+$/.test(part)) p.append(part);
      else {
        const s = document.createElement('span');
        s.textContent = part;
        s.dataset.at = at;
        p.append(s);
      }
    }
    at += part.length;
  }
  S.words = [...p.querySelectorAll('span')];
  S.wordAt = performance.now();
  S.wordK = -1;
  S.shownK = -2;
  S.boundary = 0;
}

// Word events drive the highlight. If they stop coming (some voices never send them),
// keep lighting words at a speaking pace from the last one heard.
function tickWords(now) {
  if (!S.words.length || (S.boundary && now - S.boundary < 700)) return;
  const k = Math.max(S.wordK, Math.floor((now - S.wordAt) / 290) + (S.boundary ? S.wordK : 0));
  if (k === S.shownK) return;
  S.shownK = k;
  S.words.forEach((w, j) => w.classList.toggle('said', j <= k));
}

// ---------- hand tracking ----------
let hands = null, lastVideoTime = -1;
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

async function loadHands() {
  status('Loading hand tracking…');
  try {
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = delegate => HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 });
    hands = await make('GPU').catch(() => make('CPU'));
    status('Ready. Hand tracking is on.');
  } catch {
    status('Hand tracking could not load. Check the internet connection, then reload.');
  }
}

function trackHands(now) {
  if (S.sim || !hands || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const r = hands.detectForVideo(video, now);
  S.handPts = r.landmarks || [];
  if (!S.handPts.length) return;
  // While guiding, follow whichever index fingertip is closest to the target.
  const f = S.mode === 'guide' ? S.fields[S.i] : null;
  const a = f ? anchorOf(f) : null;
  const tips = S.handPts.map(h => h[8]);
  const tip = a ? tips.reduce((p, q) => (dist(q, a) < dist(p, a) ? q : p)) : tips[0];
  setTip(tip.x, tip.y, now);
}

function setTip(x, y, now) {
  S.tip = S.tip && now - S.tipSeen < 300 ? { x: S.tip.x + (x - S.tip.x) * 0.55, y: S.tip.y + (y - S.tip.y) * 0.55 } : { x, y };
  S.tipSeen = now;
  S.trail.push({ ...S.tip });
  if (S.trail.length > 16) S.trail.shift();
}

const aspect = () => { const s = source(); return s.w / s.h || 4 / 3; };
const dist = (p, q) => Math.hypot((p.x - q.x) * aspect(), p.y - q.y);

// ---------- frame source: camera or practice form ----------
function source() {
  if (S.sim) return { img: S.sim.canvas, w: S.sim.canvas.width, h: S.sim.canvas.height };
  return { img: video, w: video.videoWidth, h: video.videoHeight };
}

async function startCamera() {
  const id = $('camera').value;
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: id ? { deviceId: { exact: id }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
  });
  video.srcObject = stream;
  await video.play();
  await listCameras();
}

async function listCameras() {
  const sel = $('camera');
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const keep = sel.value;
    sel.replaceChildren(new Option('Default camera', ''), ...cams.map((c, k) => new Option(c.label || `Camera ${k + 1}`, c.deviceId)));
    sel.value = keep;
  } catch { /* no camera list on this browser */ }
}

// region is in frame fractions; crops get upscaled so small handwriting stays readable
function snapshot(region) {
  const { img, w, h } = source();
  const r = region || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const x0 = Math.max(0, r.x0) * w, y0 = Math.max(0, r.y0) * h;
  const sw = (Math.min(1, r.x1) * w) - x0, sh = (Math.min(1, r.y1) * h) - y0;
  const scale = region ? Math.min(2, 1200 / sw) : Math.min(1, 1600 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d').drawImage(img, x0, y0, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

async function api(path, payload) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status}).`);
  return j;
}

// ---------- the flow ----------
async function begin() {
  if (S.mode !== 'start') return;
  voice.unlock();
  voice.listen(onVoiceCommand);
  app.dataset.screen = 'run';
  if (!S.sim) {
    try { await startCamera(); } catch { setMode('start'); app.dataset.screen = 'start'; return say(t().noCamera); }
  }
  await readForm();
}

async function readForm() {
  setMode('reading');
  S.fields = [];
  S.title = '';
  renderLists();
  say(t().hold);
  await wait(900); // let the camera settle focus and exposure
  try {
    const out = S.sim ? await S.sim.parse(S.lang) : await api('/api/parse', { image: snapshot(), lang: S.lang });
    S.title = out.title || '';
    S.fields = (out.fields || []).map(f => ({ ...f, done: false }));
    if (!S.fields.length) { setMode('idle'); renderLists(); return say(t().none); }
    await reveal();
    activate(0, true);
  } catch (e) {
    setMode('idle');
    renderLists();
    say(e.message);
  }
}

// One clean scan pass that "finds" each field top to bottom, in sync with the side panel.
async function reveal() {
  const now = performance.now();
  S.revealStart = now;
  const ys = S.fields.map(f => f.y0), lo = Math.min(...ys), hi = Math.max(...ys);
  S.fields.forEach(f => { f.revealAt = now + 120 + ((f.y0 - lo) / ((hi - lo) || 1)) * 1150; });
  setMode('reveal');
  renderLists();
  $('docTitle').textContent = S.title;
  await Promise.all([say(t().count(S.title, S.fields.length)), wait(1700)]);
}

function activate(i, first = false) {
  S.i = i;
  S.arrivedSince = 0;
  S.sweepAt = performance.now();
  if (first) S.startedAt = performance.now();
  setMode('guide');
  renderLists();
  const f = S.fields[i];
  say(first ? `${t().first(f.label)} ${t().askHint}` : `${t().next} ${f.label}.`);
}

function guide(now) {
  const f = S.fields[S.i];
  if (!f) return;
  if (!S.tip || now - S.tipSeen > 400) {
    S.onTarget = false;
    S.prox = 1;
    setCue('');
    if (now - S.lastNoHand > 5000 && !voice.busy()) { S.lastNoHand = now; say(t().noHand, { cue: true }); }
    return;
  }
  const g = offset(f, S.tip);
  S.onTarget = g.inside;
  S.prox = Math.min(1, g.d / 0.55);
  setCue(g.inside ? 'on' : g.dir);
  pace(now, g);
  if (g.inside) {
    S.arrivedSince ||= now;
    if (now - S.arrivedSince > 450) arrive(f);
    return;
  }
  S.arrivedSince = 0;
  if (now - S.lastCue > 1100 && !voice.busy()) {
    S.lastCue = now;
    say(voice.cueWord(g.dir, g.near), { cue: true });
  }
}

// How far the fingertip is from where it should be, in units of frame height.
function offset(f, tip) {
  const k = aspect(), a = anchorOf(f);
  const dx = (a.x - tip.x) * k, dy = a.y - tip.y;
  const pointy = f.kind === 'checkbox' || f.kind === 'button';
  const tolX = pointy ? Math.max(((f.x1 - f.x0) * k) / 2, 0.02) : 0.04;
  const tolY = Math.max((f.y1 - f.y0) / 2, 0.02);
  const ex = Math.abs(dx) / tolX, ey = Math.abs(dy) / tolY;
  return {
    inside: ex <= 1 && ey <= 1,
    // Get onto the right row first, then slide along it.
    dir: ey >= ex ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right'),
    near: Math.max(ex, ey) < 3,
    d: Math.hypot(dx, dy),
    dx,
  };
}

// Parking-sensor beeps: faster and higher as the finger closes in, panned toward the target.
function pace(now, g) {
  if (voice.busy()) return;
  const d = Math.min(g.d, 0.6) / 0.6;
  const every = g.inside ? 90 : 140 + d * 560;
  if (now - S.lastBeep < every) return;
  S.lastBeep = now;
  voice.beep(g.inside ? 1100 : 440 + (1 - d) * 520, 0.045, 0.08, g.dx / 0.25);
  S.pulses.push({ t: now, on: g.inside });
  if (S.pulses.length > 8) S.pulses.shift();
  buzz(g.inside ? 25 : 12);
}

function arrive(f) {
  setMode('write');
  S.onTarget = false;
  S.burstAt = performance.now();
  voice.chime();
  buzz([40, 40, 80]);
  const coached = S.fields.some(x => x.done && !x.skipped);
  say(`${t().stop} ${f.say}${f.hint ? ` ${f.hint}` : ''}${coached ? '' : ` ${t().coach}`}`);
}

async function finishWriting() {
  if (S.mode !== 'write') return;
  const f = S.fields[S.i];
  setMode('check');
  if (S.sim) S.sim.write(f);
  else { say(t().lift); await handAway(f); }
  const image = snapshot(expand(f));
  readback.show(image, f.label);
  try {
    const out = S.sim ? (await wait(700), S.sim.read(f, S.lang)) : await api('/api/read', { image, label: f.label, kind: f.kind, lang: S.lang });
    const empty = !out.text || out.text === 'empty';
    if (empty) {
      readback.result('', false);
      setMode('write');
      return say(t().blank);
    }
    f.answer = out.text;
    f.legible = out.legible;
    f.done = true;
    f.doneAt = performance.now();
    readback.result(out.text, out.legible);
    renderLists();
    await say(out.spoken || t().wrote(f.answer));
  } catch (e) {
    readback.hide();
    setMode('write');
    return say(e.message);
  }
  readback.hide(900);
  next();
}

// Wait until no hand covers the field (or 5 s pass), so the photo shows the writing.
function handAway(f) {
  const r = expand(f);
  return new Promise(resolve => {
    const start = performance.now();
    let clearSince = 0;
    const tick = () => {
      const now = performance.now();
      const covering = now - S.tipSeen < 300 && S.handPts.some(h => h.some(p => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1));
      if (covering) clearSince = 0;
      else if (!clearSince) clearSince = now;
      if ((clearSince && now - clearSince > 600) || now - start > 5000) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// Handwriting sits above the line and spills past it, so read a generous crop.
function expand(f) {
  const h = f.y1 - f.y0;
  return { x0: f.x0 - 0.03, x1: f.x1 + 0.03, y0: f.y0 - Math.max(h, 0.05), y1: f.y1 + Math.max(h * 0.5, 0.02) };
}

function next() {
  const n = S.fields.findIndex((f, k) => k > S.i && !f.done);
  if (n === -1) return finish();
  activate(n);
}

function finish() {
  S.finishedAt = performance.now();
  const s = Math.round((S.finishedAt - S.startedAt) / 1000);
  S.elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  setMode('done');
  setCue('done');
  renderLists();
  buzz([60, 60, 60, 60, 160]);
  const filled = S.fields.filter(f => f.done && !f.skipped).length;
  say(t().all(filled));
}

function skip() {
  if (S.mode !== 'guide' && S.mode !== 'write') return;
  const f = S.fields[S.i];
  f.done = true;
  f.skipped = true;
  renderLists();
  next();
}

function repeat() { if (S.lastSay) say(S.lastSay); }

function again() {
  S.sim?.reset();
  $('docTitle').textContent = '';
  readForm();
}

function primary() {
  ({ start: begin, idle: readForm, guide: repeat, write: finishWriting, done: again })[S.mode]?.();
}

// Jump to any field to fill (or refill) it.
function goTo(k) {
  const f = S.fields[k];
  if (!f || ['start', 'reading', 'reveal', 'check'].includes(S.mode)) return;
  Object.assign(f, { done: false, skipped: false, answer: '' });
  readback.hide();
  activate(k);
}

function back() {
  const k = S.mode === 'done' ? S.fields.length - 1 : S.i - 1;
  if (k < 0) return say(t().firstOne);
  goTo(k);
}

function setLang(code) {
  if (!T[code]) return;
  S.lang = code;
  voice.lang = code;
  store.set('nib.lang', code);
  for (const o of document.querySelectorAll('[data-lang]')) o.setAttribute('aria-pressed', String(o.dataset.lang === code));
  if (voice.onCommand) voice.listen(voice.onCommand); // recognize speech in the new language
}

function onVoiceCommand(cmd, rest) {
  if (cmd === 'done') { if (S.mode === 'write') finishWriting(); }
  else if (cmd === 'repeat') repeat();
  else if (cmd === 'skip') skip();
  else if (cmd === 'ask') rest ? answer(rest) : talkStart({ auto: true });
}

// ---------- listening: hold to ask ----------
// Hold the screen (or Space, or the Ask button) and talk. Nib answers from the form itself,
// and can also act: skip, go back, jump to a field, switch language.
const talk = { live: null, auto: 0 };

function talkStart({ auto = false } = {}) {
  if (talk.live || S.mode === 'start') return;
  if (!voice.heard) return say(t().noMic);
  voice.unlock();
  talk.live = voice.hear(words => showHeard(words), auto ? () => talkEnd() : null);
  if (!talk.live) return;
  app.dataset.talk = 'listening';
  $('talk').setAttribute('aria-pressed', 'true');
  setCue('listen');
  showHeard('');
  voice.earcon(true);
  buzz(20);
  clearTimeout(talk.auto);
  if (auto) talk.auto = setTimeout(talkEnd, 7000); // the wake phrase has no button to let go of
}

async function talkEnd() {
  const live = talk.live;
  if (!live) return;
  talk.live = null;
  clearTimeout(talk.auto);
  $('talk').setAttribute('aria-pressed', 'false');
  voice.earcon(false);
  const q = await live.stop();
  if (!q) { talkDone(); return say(t().heardNothing); }
  await answer(q);
}

function talkDone() {
  delete app.dataset.talk;
  S.cue = null;
  setCue({ write: 'write', reading: 'wait', reveal: 'wait', check: 'wait', done: 'done' }[S.mode] || '');
}

function showHeard(text) {
  S.words = [];
  $('captionText').textContent = text ? `“${text}”` : t().listening;
}

async function answer(q) {
  app.dataset.talk = 'thinking';
  showHeard(q);
  setCue('think');
  if (localAnswer(q)) return;
  try {
    const out = await api('/api/ask', {
      question: q,
      image: S.mode === 'start' ? undefined : snapshot(),
      fields: S.fields.map(({ label, kind, done, answer: a }) => ({ label, kind, done, answer: a })),
      current: S.i,
      mode: S.mode,
      lang: S.lang,
    });
    talkDone();
    act(out);
  } catch (e) {
    talkDone();
    say(S.sim && /Form reading is off/.test(e.message) ? t().offline : e.message);
  }
}

// Plain commands answer instantly, with no model call.
function localAnswer(q) {
  const s = q.toLowerCase().trim().replace(/[.!?¿¡]+/g, '');
  const f = S.fields[S.i];
  const run = fn => { talkDone(); fn(); return true; };
  if (/^(i'?m )?(done|finished)$|^next$|^listo$|^terminé$/.test(s) && S.mode === 'write') return run(finishWriting);
  if (/^(repeat|again|say (that|it) again|repite|otra vez)$/.test(s)) return run(repeat);
  if (/^(skip|skip (this|it|this one)|saltar)$/.test(s)) return run(skip);
  if (/^(go )?back$|^previous( one)?$|^anterior$/.test(s)) return run(back);
  if (/how many (are )?(left|more)|cuántos faltan/.test(s) && S.fields.length) return run(() => say(t().left(S.fields.filter(x => !x.done).length)));
  if (/where am i|which (field|one)|what field|dónde estoy/.test(s) && f) return run(() => say(t().here(f.label)));
  return false;
}

function act(out) {
  switch (out.action) {
    case 'done': if (S.mode === 'write') return finishWriting(); break;
    case 'skip': if (S.mode === 'guide' || S.mode === 'write') return skip(); break;
    case 'back': return back();
    case 'goto': if (out.field >= 0 && out.field < S.fields.length) return goTo(out.field); break;
    case 'repeat': return repeat();
    case 'reread': return again();
    case 'language': setLang(out.lang); break;
  }
  return say(out.say);
}

// ---------- the handwriting card ----------
const readback = {
  timer: 0,
  show(image, label) {
    clearTimeout(this.timer);
    $('rbImg').src = image;
    $('rbLabel').textContent = label;
    $('rbText').textContent = '';
    $('readback').dataset.state = 'reading';
    $('readback').hidden = false;
  },
  result(text, legible) {
    const el = $('rbText');
    $('readback').dataset.state = text ? (legible ? 'ok' : 'unsure') : 'empty';
    el.textContent = '';
    if (!text) { el.textContent = 'Nothing written yet'; return; }
    [...text].forEach((ch, k) => setTimeout(() => { el.textContent += ch; }, k * 28));
  },
  hide(after = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { $('readback').hidden = true; }, after);
  },
};

// ---------- UI ----------
function setMode(m) {
  S.mode = m;
  app.dataset.mode = m;
  const btn = $('action');
  btn.textContent = ACTION[m];
  btn.disabled = m === 'reading' || m === 'reveal' || m === 'check';
  if (m === 'reading' || m === 'reveal' || m === 'check') setCue('wait');
  if (m === 'write') setCue('write');
}

function setCue(c) {
  if (c === S.cue) return;
  S.cue = c;
  $('cue').dataset.cue = c;
  $('cueGlyph').textContent = CUE[c] || { on: '●', write: '✎', done: '✓' }[c] || '';
  $('cueWord').textContent = CUE[c] ? voice.cueWord(c, false) : { on: 'here', write: 'write', done: 'done', listen: 'listening', think: 'thinking' }[c] || '';
}

function renderLists() {
  const state = (f, k) => (f.skipped ? 'skipped' : f.done ? 'done' : k === S.i && ['guide', 'write', 'check'].includes(S.mode) ? 'active' : 'todo');
  $('progress').replaceChildren(...S.fields.map((f, k) => {
    const li = document.createElement('li');
    li.dataset.state = state(f, k);
    li.title = `${k + 1}. ${f.label}`;
    return li;
  }));
  const doneCount = S.fields.filter(f => f.done).length;
  $('count').textContent = S.fields.length ? `${doneCount} of ${S.fields.length}` : '';

  $('panelTitle').textContent = S.title || (S.mode === 'reading' ? 'Reading the page…' : 'No form yet');
  $('fieldList').replaceChildren(...S.fields.map((f, k) => {
    const li = document.createElement('li');
    li.dataset.state = state(f, k);
    if (S.mode === 'reveal') li.style.animationDelay = `${Math.round(f.revealAt - S.revealStart)}ms`;
    else li.style.animation = 'none';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = f.done && !f.skipped ? '✓' : k + 1;
    const body = document.createElement('div');
    body.className = 'f-body';
    const label = document.createElement('span');
    label.className = 'f-label';
    label.textContent = f.label;
    const kind = document.createElement('span');
    kind.className = 'f-kind';
    kind.textContent = f.skipped ? 'Skipped' : KIND[f.kind] || 'Write';
    body.append(label, kind);
    if (f.answer) {
      const a = document.createElement('span');
      a.className = 'f-answer';
      a.textContent = f.answer;
      body.append(a);
    } else if (f.hint && li.dataset.state === 'active') {
      const h = document.createElement('span');
      h.className = 'f-hint';
      h.textContent = f.hint;
      body.append(h);
    }
    li.append(n, body);
    return li;
  }));
  $('fieldList').querySelector('[data-state="active"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const foot = $('panelFoot');
  if (S.mode === 'done') {
    const filled = S.fields.filter(f => f.done && !f.skipped).length;
    foot.innerHTML = '';
    const big = document.createElement('strong');
    big.textContent = S.elapsed;
    const small = document.createElement('span');
    small.textContent = `${filled} of ${S.fields.length} filled without help`;
    foot.append(big, small);
    foot.hidden = false;
  } else foot.hidden = true;
}

function status(text) { $('status').textContent = text; }

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(now) {
  requestAnimationFrame(loop);
  resize();
  if (S.sim && S.pointer) setTip(S.pointer.x, S.pointer.y, now);
  trackHands(now);
  if (S.mode === 'guide' && !app.dataset.talk) guide(now); // guidance pauses while you talk
  else S.prox = 1;
  $('cue').style.setProperty('--close', S.mode === 'guide' ? (1 - S.prox).toFixed(2) : 0);
  tickWords(now);
  render(ctx, S, source(), now);
}

// Practice mode: the pointer is the fingertip. A resting pointer is a resting finger, so it stays tracked.
canvas.addEventListener('pointermove', e => {
  if (!S.sim || !S.fit) return;
  const r = canvas.getBoundingClientRect(), { s, ox, oy, w, h } = S.fit;
  const x = (e.clientX - r.left - ox) / (w * s), y = (e.clientY - r.top - oy) / (h * s);
  S.pointer = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
});
canvas.addEventListener('pointerleave', () => { S.pointer = null; });

// With the camera, the whole picture is the button, for people who can't find one:
// tap = the main action, press and hold = ask a question.
const press = { timer: 0, talking: false };
$('stage').addEventListener('pointerdown', e => {
  if (S.sim || S.mode === 'start' || e.target.closest?.('button, a, select, aside, figure')) return;
  press.timer = setTimeout(() => { press.timer = 0; press.talking = true; talkStart(); }, 350);
});
addEventListener('pointerup', e => {
  if (press.talking) { press.talking = false; talkEnd(); }
  else if (press.timer) { clearTimeout(press.timer); press.timer = 0; if (e.target.closest?.('#stage')) primary(); }
});
addEventListener('pointercancel', () => {
  if (press.talking) { press.talking = false; talkEnd(); }
  clearTimeout(press.timer);
  press.timer = 0;
});
$('stage').addEventListener('contextmenu', e => e.preventDefault()); // long-press must not open a menu

// The Ask button: hold to talk, or tap once to start and once to stop.
const ask = { downAt: 0, endOnUp: false };
$('talk').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (talk.live) { ask.endOnUp = true; return; }
  ask.downAt = performance.now();
  talkStart();
});
$('talk').addEventListener('pointerup', () => {
  if (!talk.live) return;
  if (ask.endOnUp || performance.now() - ask.downAt > 450) { ask.endOnUp = false; talkEnd(); }
});
$('talk').addEventListener('click', e => { if (e.detail === 0) (talk.live ? talkEnd() : talkStart()); }); // keyboard

$('startBtn').addEventListener('click', begin);
$('action').addEventListener('click', primary);

for (const b of document.querySelectorAll('[data-lang]')) {
  b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
  b.addEventListener('click', () => setLang(b.dataset.lang));
}

// Keys: Space tap = main action, Space hold = ask. Enter = main action. R repeat, S skip, M mute beeps.
const space = { timer: 0, held: false };
addEventListener('keydown', e => {
  if (e.target.closest?.('button, a, select, input')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (e.repeat || space.timer || space.held) return;
    space.timer = setTimeout(() => { space.timer = 0; space.held = true; talkStart(); }, 280);
  } else if (k === 'enter') { e.preventDefault(); primary(); }
  else if (k === 'r') repeat();
  else if (k === 's') skip();
  else if (k === 'm') voice.muted = !voice.muted;
});
addEventListener('keyup', e => {
  if (e.key !== ' ') return;
  if (space.held) { space.held = false; talkEnd(); }
  else if (space.timer) { clearTimeout(space.timer); space.timer = 0; if (!e.target.closest?.('button, a, select, input')) primary(); }
});

// Which model reads the form, so nobody demos with reading switched off by accident.
fetch('/api/status').then(r => r.json()).then(s => {
  $('reader').textContent = s.reader ? `Form reading: ${s.reader}` : 'Form reading is off: add a model key to nib/.env';
  $('reader').dataset.on = s.reader ? 'true' : 'false';
}).catch(() => { $('reader').textContent = 'Server not reachable'; });

if (S.sim) {
  window.nib = S; // practice mode only: lets you poke at state from the console
  window.nibAsk = answer; // and type a question as if it were spoken
  app.dataset.sim = '';
  status('Practice mode: your pointer is the fingertip. Tap Space when you finish writing; hold Space to ask.');
  $('modeLink').href = './';
  $('modeLink').textContent = 'Use the camera instead';
} else {
  loadHands();
  if (!navigator.mediaDevices?.getUserMedia) status('This browser cannot open the camera. Use Chrome or Safari over https.');
}
setMode('start');
renderLists();
requestAnimationFrame(loop);
