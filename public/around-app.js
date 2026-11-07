// Around me: the camera faces where the person faces. On-device eyes (eyes.js, MediaPipe) spot people
// and furniture ~10 times a second, so that news is instant; cloud looks (/api/around, ~2-4 s each)
// add doors, stairs, walls and the scene. around.js turns both into short spoken news: what's in the
// way first, then new people, then doors and things. Every news line is made in the natural voice while the page
// loads (allLines), so it plays the instant it's seen. Tap the screen, press the button, or say
// "what's around me" / "what's going on".
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';
import { makeAround, allLines, placeLine, crowdLine } from './around.js';
import { makeEyes, LOCAL_NAMES } from './eyes.js';

const $ = id => document.getElementById(id);
const video = $('video');
const PHONE = matchMedia('(pointer: coarse)').matches;
const around = makeAround({ hfov: PHONE ? 50 : 60 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let heading = null, running = false, lastErrorSaid = 0, scene = '', lens = 'main', gen = 0, fov = PHONE ? 50 : 60, eyes = null, seen = [];
let place = '', placeVote = '', lastStairs = -1e9;
// Load the on-device detector while the start screen is up (7 MB, cached after the first visit).
const eyesReady = makeEyes().then(e => (eyes = e)).catch(() => null);

voice.init();
voice.onCaption = text => { $('caption').textContent = text; $('caption').classList.toggle('warn', /^Watch out/.test(text)); };
// Make every news line in the natural voice now, before the first look: speech is then instant.
const START = "Around me. Hold your phone at chest height and turn slowly. Say Nib, then ask me anything. Or say stop, or home.";
const LOOK = 'Let me look.';
// Three warm-up queues of four (12 at a time): all 153 lines are ready about 15 s after the page opens.
const LINES = [START, LOOK, ...allLines()];
const warmVoice = () => { for (let k = 0; k < 3; k++) voice.prefetch(LINES.filter((_, i) => i % 3 === k)); }; // after Start, not on every page view

// Compass: iPhone gives webkitCompassHeading after permission; others give absolute alpha.
function onOrient(e) {
  if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
}

async function start(auto = false) {
  if (running) return;
  // Everything that needs the tap happens before the first await.
  voice.unlock();
  warmVoice();
  const askOrient = auto ? Promise.resolve('auto') : window.DeviceOrientationEvent?.requestPermission?.().catch(() => 'denied'); // must start inside the tap
  addEventListener('deviceorientationabsolute', onOrient);
  addEventListener('deviceorientation', onOrient);
  $('start').hidden = true;
  try {
    const tall = PHONE && innerHeight > innerWidth;
    const video_ = { facingMode: { ideal: 'environment' }, width: { ideal: tall ? 1440 : 1920 }, height: { ideal: tall ? 1920 : 1440 } };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: MIC }); }
    catch { stream = await navigator.mediaDevices.getUserMedia({ video: video_ }); }
    const mic = stream.getAudioTracks().length ? new MediaStream(stream.getAudioTracks()) : null;
    let track = stream.getVideoTracks()[0];
    // 0.5x: the ultra-wide lens sees a room the way a person does. iPhone Safari lists it as its own
    // camera ("Back Ultra Wide Camera") once permission is granted; other phones may offer zoom instead.
    try {
      const wide = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'videoinput' && /ultra ?wide|0\.5/i.test(d.label));
      if (wide && track.getSettings().deviceId !== wide.deviceId) {
        const s2 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: wide.deviceId }, width: video_.width, height: video_.height } });
        track.stop();
        track = s2.getVideoTracks()[0];
        lens = 'ultra wide';
      } else {
        const zoom = track.getCapabilities?.().zoom;
        if (zoom && zoom.min < 1) { await track.applyConstraints({ advanced: [{ zoom: zoom.min }] }); lens = `zoom ${zoom.min}`; }
      }
    } catch { /* keep the main lens */ }
    fov = lens === 'main' ? (PHONE ? 50 : 60) : (PHONE ? 85 : 100);
    around.hfov = fov;
    video.srcObject = new MediaStream([track]);
    await video.play();
    if (mic) startEars(mic);
  } catch {
    $('start').hidden = false;
    return voice.say("I can't open the camera. Allow the camera for this site, then tap again.");
  }
  const orient = await askOrient;
  running = true;
  // The first look starts while the welcome plays; its news waits in the queue until the welcome ends.
  speakQueue.busy = true;
  voice.say(orient === 'denied' ? `${START} The compass is off, so I'll describe only what's in front of you.` : START).then(() => { speakQueue.busy = false; speakQueue(); });
  loop(++gen);
  eyesReady.then(() => requestAnimationFrame(watch));
}

// ---------- instant news from the on-device eyes ----------
let lastNews = 0;
function watch(now) {
  if (!running) { requestAnimationFrame(watch); return; }
  const items = eyes?.see(video, now, fov);
  if (items) proximity(items, now);
  if (items) {
    seen = items;
    drawBoxes(items);
    if (now - lastNews > 300) { lastNews = now; news(around.update(items, heading)); }
  }
  requestAnimationFrame(watch);
}

async function startEars(mic) {
  try {
    voice.micOpen = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
    earsRef = await makeEars({
      ctx: voice.ctx, lang: () => 'en',
      ignore: () => false, // barge-in: listen while Nib talks, and drop Nib's own words with the snapshot below
      onCapture: () => voice.echoSnapshot(), // what Nib was saying when this phrase began
      onText: (text, said) => {
        if (voice.echo(text, said)) return; // Nib hearing itself through the speaker
        // "Nib" opens an 8 s window; "Hey Nib, <words>" acts at once. Commands always win over questions:
        // "Hey Nib, go home" goes home, it doesn't ask the camera about "go home".
        const wake = voice.wake(text), windowOpen = askUntil > performance.now();
        if (wake && !wake.rest) { askUntil = performance.now() + 8000; queue.length = 0; voice.stop(); voice.earcon(true); return; }
        const words = wake ? wake.rest : text;
        if (command(words)) { askUntil = 0; return; }
        if (wake || windowOpen) { askUntil = 0; askAbout(words); }
        // anything else, said without "Nib", is ordinary talk in the room: ignored
      },
    }).start(mic);
  } catch { voice.micOpen = false; }
}

// Whole short phrases only, so news like "two people ahead" or a stray word never acts. True if handled.
function command(words) {
  const t = String(words).toLowerCase().replace(/[.,!?"']/g, '').replace(/\s+/g, ' ').trim();
  const go = (line, url) => { running = false; gen++; queue.length = 0; voice.stop(); voice.say(line).then(() => { location.href = url; }); };
  const nav = voice.navigation(t);
  if (nav === 'home') go('Going home.', './');
  else if (nav === 'paper') go('Opening Trace.', 'paper.html');
  else if (nav === 'memory') go('Opening Memory.', 'memory/');
  else if (nav === 'around') voice.say("You're in Around me.");
  else if (/^(stop|pause|quiet|be quiet)$/.test(t)) { running = false; gen++; queue.length = 0; voice.stop(); voice.say('Paused. Say Nib, start, to go on.'); }
  else if (/^(start|resume|continue|go on)$/.test(t)) { if (!running) { running = true; voice.say('Going on.'); loop(++gen); } }
  else if (/^(whats|what is) going on|^(describe|what do you see)/.test(t)) tellScene();
  else if (/^(whats|what is) around( me)?$|^who(s| is) (here|around|near)( me)?$/.test(t)) tellAll();
  else if (/^(help|what can i say)$/.test(t)) voice.say("Say Nib, then ask anything about what's in front of you. Or say what's around me, what's going on, stop, start, or home.");
  else return false;
  return true;
}

// Small frames: about 2-4 s per look instead of 3-8 s at full size, and people still count right.
function snap() {
  const w = 512, h = Math.round(w * video.videoHeight / video.videoWidth) || 384;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

async function look() {
  const h = heading;
  if (!video.videoWidth) { await sleep(300); return { say: [], hazard: false }; }
  const r = await fetch('api/around', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: snap(), lang: 'en' }), signal: AbortSignal.timeout(9000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  if (j.scene) scene = j.scene;
  whereAmI(j);
  const stairs = (j.items || []).find(i => (i.name === 'stairs' || i.name === 'step') && i.steps <= 4);
  if (stairs) stairsAlarm(stairs);
  const extra = (j.items || []).filter(i => !eyes || !LOCAL_NAMES.has(i.name)); // the eyes own people and furniture
  chips(extra);
  return around.update(extra, h);
}

// News waits in a short queue. Old news is dropped (the person has turned since): hazards after 4 s,
// other news after 10 s, so a burst of lines from the first look is still heard.
const queue = [];
async function speakQueue() {
  if (speakQueue.busy) return;
  speakQueue.busy = true;
  while (queue.length) {
    const { text, at, urgent } = queue.shift();
    if (Date.now() - at < (urgent ? 4000 : 10000)) await voice.say(text);
  }
  speakQueue.busy = false;
}

// ---------- where you are ----------
// The first look says where you are and how many people are near; after that, only a change of place
// that two looks in a row agree on ("Now you're in a hallway.").
function whereAmI(j) {
  if (!j.place) return;
  const people = Math.max(around.people(), (j.items || []).filter(i => i.kind === 'person').length, seen.filter(i => i.kind === 'person').length);
  if (!place) { place = j.place; queue.unshift({ text: placeLine(place, false), at: Date.now() }, { text: crowdLine(people), at: Date.now() }); speakQueue(); return; } // two pre-made lines, both instant
  if (j.place === place) { placeVote = ''; return; }
  if (placeVote !== j.place) { placeVote = j.place; return; }
  place = j.place; placeVote = '';
  queue.push({ text: placeLine(place, true), at: Date.now() }, { text: crowdLine(people), at: Date.now() });
  speakQueue();
}

// ---------- the proximity alarm ----------
// Something in your path within about two steps: beeps from its side, faster as you get closer, a red
// edge pulsing on screen, and a buzz where the phone allows. Silent the moment the way is clear.
let alarmAt = 0;
function proximity(items, now) {
  const near = items.filter(i => i.inPath && i.steps <= 2).sort((a, b) => a.steps - b.steps)[0];
  const edge = document.getElementById('edge');
  if (!near) { edge?.style.setProperty('--near', '0'); return; }
  const every = near.steps <= 1 ? 160 : 380;
  edge?.style.setProperty('--near', near.steps <= 1 ? '1' : '0.55');
  if (now - alarmAt < every) return;
  alarmAt = now;
  voice.beep(near.steps <= 1 ? 1180 : 880, 0.06, voice.speaking ? 0.06 : 0.12, (near.x - 0.5) * 2);
  navigator.vibrate?.(near.steps <= 1 ? 60 : 30);
}

// ---------- the stairs alarm ----------
// Stairs are the one thing that must never be missed: three falling tones, an orange flash, and the
// warning said first, at most every 12 s.
function stairsAlarm(s) {
  const now = Date.now();
  if (now - lastStairs < 12000) return;
  lastStairs = now;
  queue.length = 0;
  voice.stop();
  [988, 784, 587].forEach((f, k) => setTimeout(() => voice.beep(f, 0.12, 0.2, (s.x - 0.5) * 2), k * 140));
  navigator.vibrate?.([80, 60, 80, 60, 160]);
  const edge = document.getElementById('edge');
  edge?.classList.add('stairs');
  setTimeout(() => edge?.classList.remove('stairs'), 1600);
  queue.push({ text: `Watch out: ${s.name}, about ${['one', 'two', 'three', 'four'][Math.max(1, Math.min(4, s.steps)) - 1]} step${s.steps === 1 ? '' : 's'} ahead.`.replace('four steps', 'four steps'), at: now + 450, urgent: true });
  setTimeout(speakQueue, 450);
}

// One place where news becomes speech, for both the eyes and the cloud.
function news({ say, hazard }) {
  if (hazard) {
    // In the way: cut whatever is playing, warn with a low tone, then say it first.
    queue.length = 0;
    voice.stop();
    voice.beep(330, 0.22, 0.22);
    queue.push({ text: say.shift(), at: Date.now() + 250, urgent: true });
  }
  if (asking && !hazard) return; // an answer is playing; only a hazard may cut in
  for (const text of say) queue.push({ text, at: Date.now() });
  if (say.length || hazard) speakQueue();
  $('count').textContent = countText();
}

async function loop(my) {
  while (running && my === gen) { // a stop/start never leaves two loops running
    try {
      const result = await look();
      if (my !== gen) return;
      news(result);
    } catch {
      if (Date.now() - lastErrorSaid > 20000) { lastErrorSaid = Date.now(); voice.say("I can't reach my eyes right now. Check the internet. I'll keep trying."); }
      await sleep(2000);
    }
    // The phone's own eyes do the live work; the cloud only adds where you are, doors, stairs and the scene.
    // ponytail: every 5 s to save API credit; faster costs more and adds little.
    await sleep(eyes ? 5000 : 2500);
  }
}

function countText() {
  const people = around.world.filter(w => w.kind === 'person').length, things = around.world.length - people;
  return !around.world.length ? 'Nothing yet' : `${people} ${people === 1 ? 'person' : 'people'} · ${things} ${things === 1 ? 'thing' : 'things'}`;
}

function chips(items) {
  const box = $('chips');
  for (const c of box.children) c.classList.add('old');
  setTimeout(() => [...box.querySelectorAll('.old')].forEach(c => c.remove()), 700);
  items.slice(0, 8).forEach((i, k) => {
    const c = document.createElement('div');
    c.className = `chip ${i.inPath && i.steps <= 3 ? 'hazard' : i.kind}`;
    c.style.left = `${Math.min(88, Math.max(12, i.x * 100))}%`;
    c.style.top = `${30 + (k % 4) * 7}%`;
    c.textContent = i.label;
    c.append(Object.assign(document.createElement('small'), { textContent: `~${i.steps} step${i.steps === 1 ? '' : 's'}` }));
    box.append(c);
  });
}

// Live boxes around what the eyes see, mapped onto the contained video picture.
function drawBoxes(items) {
  const c = $('boxes'), r = video.getBoundingClientRect(), W = video.videoWidth, H = video.videoHeight;
  if (!c || !W) return;
  const dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const s = Math.min(r.width / W, r.height / H), ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  g.font = '600 14px -apple-system, Inter, system-ui, sans-serif';
  for (const i of items) {
    const b = i.box, x = ox + b.originX * s, y = oy + b.originY * s, w = b.width * s, h = b.height * s;
    const color = i.inPath ? '#FF453A' : i.kind === 'person' ? '#FFD60A' : '#FFFFFF';
    g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.roundRect(x, y, w, h, 12); g.stroke();
    const text = `${i.name} · ~${i.steps} step${i.steps === 1 ? '' : 's'}`, tw = g.measureText(text).width + 16;
    g.fillStyle = color; g.beginPath(); g.roundRect(x, Math.max(0, y - 26), tw, 24, 12); g.fill();
    g.fillStyle = i.inPath ? '#fff' : '#000'; g.fillText(text, x + 8, Math.max(17, y - 9));
  }
}

// A question about what's in front of you: a fresh look and a short spoken answer.
let askUntil = 0, asking = false;
async function askAbout(question) {
  if (asking || !question.trim()) return;
  asking = true;
  queue.length = 0;
  voice.stop();
  voice.earcon(false);
  const looking = voice.say(LOOK);
  try {
    const r = await fetch('api/around-ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: snap(), question, lang: 'en' }), signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => ({}));
    await looking;
    await voice.say(r.ok && j.say ? j.say : "I couldn't look just now. Ask me again.");
  } catch { await looking; await voice.say("I couldn't look just now. Ask me again."); }
  asking = false;
}

function tellAll() {
  queue.length = 0;
  voice.stop();
  voice.say(around.summary(heading));
}

function tellScene() {
  queue.length = 0;
  voice.stop();
  voice.say(scene ? `Right now: ${scene.replace(/^\w/, c => c.toLowerCase())}` : "I'm still looking. Turn slowly.");
}

$('start').addEventListener('click', () => start());

// Opened by voice ("Hey Nib, open Around me") there is no tap to start with. iPhone allows sound once
// the page is capturing the mic, so try to start straight away; if the browser still holds audio back,
// the "tap anywhere" screen stays as it was.
async function autoStart() {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: MIC });
    voice.unlock();
    await Promise.race([voice.ctx?.resume?.(), sleep(800)]);
    const ok = voice.ctx?.state === 'running';
    probe.getTracks().forEach(t => t.stop());
    if (ok && !running) start(true);
  } catch { /* no permission yet or no audio without a tap: the start screen handles it */ }
}
autoStart();
// The button and the picture: what's going on right now, then everything seen so far.
$('ask').addEventListener('click', e => {
  e.stopPropagation();
  queue.length = 0;
  voice.stop();
  voice.say(`${scene ? `Right now: ${scene.replace(/^\w/, c => c.toLowerCase()).replace(/\.?$/, '.')} ` : ''}${around.summary(heading)}`);
});
$('go')?.focus(); // VoiceOver lands on "Tap anywhere to start"
// A tap after an automatic start also turns the compass on (iPhone only asks for it inside a tap).
video.addEventListener('click', () => { window.DeviceOrientationEvent?.requestPermission?.().catch(() => {}); tellAll(); });
let earsRef = null; // the live listener, so the camera lifecycle can stop it when the page is left
window.nibAround = { get ears() { return earsRef; }, ask: askAbout, around, get heading() { return heading; }, get scene() { return scene; }, get lens() { return lens; }, get eyes() { return !!eyes; }, get seen() { return seen; } };
