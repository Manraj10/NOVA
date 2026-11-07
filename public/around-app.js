// Around me: the camera faces where the person faces; every couple of seconds one frame goes to
// /api/around, and around.js turns it into short spoken news: what's in the way first, then new
// people, then doors and things. Tap the screen, press the button, or say "what's around me".
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';
import { makeAround } from './around.js';

const $ = id => document.getElementById(id);
const video = $('video');
const PHONE = matchMedia('(pointer: coarse)').matches;
const around = makeAround({ hfov: PHONE ? 50 : 60 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let heading = null, running = false, lastErrorSaid = 0;

voice.init();
voice.onCaption = (text, cue) => { $('caption').textContent = text; $('caption').classList.toggle('warn', /^Watch out/.test(text)); };

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
    video.srcObject = new MediaStream(stream.getVideoTracks());
    await video.play();
    if (stream.getAudioTracks().length) startEars(new MediaStream(stream.getAudioTracks()));
  } catch {
    $('start').hidden = false;
    return voice.say("I can't open the camera. Allow the camera for this site, then tap again.");
  }
  await askOrient;
  running = true;
  await voice.say("Around me is on. Turn slowly, and I'll tell you what's new.");
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
        const t = text.toLowerCase();
        if (/around|who('?s| is) (here|there|near)|what do you see|describe/.test(t)) tellAll();
        else if (/^(stop|pause|quiet)\b/.test(t)) { running = false; voice.say('Paused. Say "start" to go on.'); }
        else if (/^(start|go|resume|continue)\b/.test(t) && !running) { running = true; voice.say('Going on.'); loop(); }
      },
    }).start(mic);
  } catch { voice.micOpen = false; }
}

function snap() {
  const w = 768, h = Math.round(w * video.videoHeight / video.videoWidth) || 576;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

async function frame() {
  const h = heading;
  const r = await fetch('api/around', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: snap(), lang: 'en' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  chips(j.items || []);
  return around.update(j.items || [], h);
}

const queue = [];
async function speakQueue() {
  if (speakQueue.busy) return;
  speakQueue.busy = true;
  while (queue.length) {
    const { text, at } = queue.shift();
    if (Date.now() - at < 7000) await voice.say(text); // old news isn't news
  }
  speakQueue.busy = false;
}

async function loop() {
  while (running) {
    const t0 = performance.now();
    try {
      const { say, hazard } = await frame();
      if (hazard) {
        queue.length = 0;
        voice.stop();
        voice.beep(330, 0.22, 0.22); // a low warning tone before the words
        await sleep(240);
        await voice.say(say[0], { cue: true }); // instantly, in whichever voice is ready
        say.shift();
      }
      for (const text of say) queue.push({ text, at: Date.now() });
      speakQueue();
    } catch {
      if (Date.now() - lastErrorSaid > 20000) { lastErrorSaid = Date.now(); voice.say("I can't reach my eyes right now. Check the internet. I'll keep trying."); }
      await sleep(2000);
    }
    $('count').textContent = countText();
    await sleep(Math.max(300, 1500 - (performance.now() - t0)));
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
    c.append(Object.assign(document.createElement('small'), { textContent: `${i.steps} step${i.steps === 1 ? '' : 's'}` }));
    box.append(c);
  });
}

function tellAll() {
  queue.length = 0;
  voice.stop();
  voice.say(around.summary(heading));
}

$('start').addEventListener('click', start);
$('ask').addEventListener('click', e => { e.stopPropagation(); tellAll(); });
// Blind-friendly: the whole picture is a button too.
video.addEventListener('click', tellAll);
window.nibAround = { around, get heading() { return heading; } };
