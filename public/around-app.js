// Around me: the camera faces where the person faces. Looks go to /api/around back to back (one in
// flight, ~2-4 s each), and around.js turns them into short spoken news: what's in the way first,
// then new people, then doors and things. Every news line is made in the natural voice while the page
// loads (allLines), so it plays the instant it's seen. Tap the screen, press the button, or say
// "what's around me" / "what's going on".
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';
import { makeAround, allLines } from './around.js';

const $ = id => document.getElementById(id);
const video = $('video');
const PHONE = matchMedia('(pointer: coarse)').matches;
const around = makeAround({ hfov: PHONE ? 50 : 60 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let heading = null, running = false, lastErrorSaid = 0, scene = '', sceneSaid = false, lens = 'main';

voice.init();
voice.onCaption = text => { $('caption').textContent = text; $('caption').classList.toggle('warn', /^Watch out/.test(text)); };
// Make every news line in the natural voice now, before the first look: speech is then instant.
const START = "Around me is on. Hold your phone at chest height and turn slowly.";
// Three warm-up queues of four (12 at a time): all 153 lines are ready about 15 s after the page opens.
const LINES = [START, ...allLines()];
for (let k = 0; k < 3; k++) voice.prefetch(LINES.filter((_, i) => i % 3 === k));

// Compass: iPhone gives webkitCompassHeading after permission; others give absolute alpha.
function onOrient(e) {
  if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
}

async function start() {
  if (running) return;
  // Everything that needs the tap happens before the first await.
  voice.unlock();
  const askOrient = window.DeviceOrientationEvent?.requestPermission?.().catch(() => 'denied');
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
    around.hfov = lens === 'main' ? (PHONE ? 50 : 60) : (PHONE ? 85 : 100);
    video.srcObject = new MediaStream([track]);
    await video.play();
    if (mic) startEars(mic);
  } catch {
    $('start').hidden = false;
    return voice.say("I can't open the camera. Allow the camera for this site, then tap again.");
  }
  await askOrient;
  running = true;
  voice.say(START);
  loop();
}

async function startEars(mic) {
  try {
    voice.micOpen = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
    await makeEars({
      ctx: voice.ctx, lang: () => 'en', ignore: () => false,
      onText: text => {
        if (voice.echo(text)) return;
        const t = text.toLowerCase().replace(/[.,!?]/g, '');
        if (/going on|happening|describe|what do you see|look/.test(t)) tellScene();
        else if (/around|who('?s| is) (here|there|near)|anyone|people/.test(t)) tellAll();
        else if (/^(stop|pause|quiet)\b/.test(t)) { running = false; voice.say('Paused. Say start to go on.'); }
        else if (/^(start|go|resume|continue)\b/.test(t) && !running) { running = true; voice.say('Going on.'); loop(); }
        else if (/\b(home|menu)\b/.test(t)) { voice.say('Going home.').then(() => { location.href = './'; }); }
        else if (/\b(paper|form)\b/.test(t)) { voice.say('Opening Paper.').then(() => { location.href = 'paper.html'; }); }
        else if (/\bmemory\b/.test(t)) { voice.say('Opening Memory.').then(() => { location.href = 'memory.html'; }); }
      },
    }).start(mic);
  } catch { voice.micOpen = false; }
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
  const r = await fetch('api/around', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: snap(), lang: 'en' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  if (j.scene) scene = j.scene;
  chips(j.items || []);
  return around.update(j.items || [], h);
}

// News waits in a short queue; anything older than 5 s is dropped, because the person has turned since.
const queue = [];
async function speakQueue() {
  if (speakQueue.busy) return;
  speakQueue.busy = true;
  while (queue.length) {
    const { text, at } = queue.shift();
    if (Date.now() - at < 5000) await voice.say(text);
  }
  speakQueue.busy = false;
}

async function loop() {
  while (running) {
    try {
      const { say, hazard } = await look();
      if (!sceneSaid && scene) { sceneSaid = true; queue.push({ text: scene, at: Date.now() }); }
      if (hazard) {
        // In the way: cut whatever is playing, warn with a low tone, then say it first.
        queue.length = 0;
        voice.stop();
        voice.beep(330, 0.22, 0.22);
        queue.push({ text: say.shift(), at: Date.now() + 250 });
      }
      for (const text of say) queue.push({ text, at: Date.now() });
      speakQueue();
    } catch {
      if (Date.now() - lastErrorSaid > 20000) { lastErrorSaid = Date.now(); voice.say("I can't reach my eyes right now. Check the internet. I'll keep trying."); }
      await sleep(2000);
    }
    $('count').textContent = countText();
    await sleep(150); // the next look starts right away; speech runs alongside
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

$('start').addEventListener('click', start);
// The button and the picture: what's going on right now, then everything seen so far.
$('ask').addEventListener('click', e => { e.stopPropagation(); tellScene(); setTimeout(() => queue.push({ text: around.summary(heading), at: Date.now() }) && speakQueue(), 50); });
video.addEventListener('click', tellAll);
window.nibAround = { around, get heading() { return heading; }, get scene() { return scene; }, get lens() { return lens; } };
