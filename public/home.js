// One home menu, using the SAME exact navigation parser as Paper and Around.
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';

const ABOUT = "I'm Nib. I can read a paper form with you and guide your finger to every blank, tell you who and what is around you, or rebuild a room you remember so your family can step inside. Say Trace, Around me, or Memory.";
const MENU = 'You are on Nib Home. Say Trace for paper, Around me, or Memory. Say help to hear these choices again, or tap a card.';
const MEMORY_PENDING = 'Memory is being connected. You are still on Nib Home. Choose Trace or Around me for now.';
const memoryReady = document.documentElement?.dataset.memoryReady === 'true';
const ROUTES = {
  paper: ['paper.html', 'Opening Trace.'],
  around: ['around.html', 'Opening Around me.'],
  memory: ['memory.html', 'Opening Memory.'],
};
const live = document.getElementById('live');
const listen = document.getElementById('listen');
let ears = null, mic = null, starting = null, pendingEars = null, leaving = false, generation = 0;
let autoAttempted = false, resumeOnReturn = false, pageHidden = false;
let wakeUntil = 0, wakeAt = 0, captureSequence = 0, wakeAfter = 0;
const stoppedTracks = new WeakSet();
const releaseStream = stream => { for (const track of stream?.getTracks() || []) {
  if (!stoppedTracks.has(track)) { stoppedTracks.add(track); try { track.stop(); } catch { /* already ended */ } }
} };
const releaseMic = () => { releaseStream(mic); mic = null; };
const state = (message, listening = false, announce = false) => {
  live.setAttribute?.('aria-live', announce ? 'polite' : 'off');
  live.textContent = message;
  listen.setAttribute('aria-pressed', String(listening));
  listen.textContent = listening ? 'Listening · say a mode' : 'Talk to Nib';
};
voice.init();
voice.prefetch([MENU, ABOUT, MEMORY_PENDING, ...Object.values(ROUTES).map(route => route[1])]);
voice.onCaption = text => { live.textContent = text; };

function go(destination) {
  if (leaving) return;
  if (destination === 'home') { voice.say(MENU); return; }
  if (!Object.hasOwn(ROUTES, destination)) return;
  if (destination === 'memory' && !memoryReady) { state(MEMORY_PENDING, !!ears?.stream); voice.say(MEMORY_PENDING); return; }
  const [href, line] = ROUTES[destination];
  resumeOnReturn = !!ears?.stream;
  leaving = true; generation++; wakeUntil = 0;
  ears?.stop(); pendingEars?.stop(); pendingEars = null; releaseMic(); voice.micOpen = false;
  state(line);
  voice.unlock();
  // A broken speech callback must never strand someone on Home.
  const owner = generation;
  Promise.race([voice.say(line), new Promise(resolve => setTimeout(resolve, 2500))])
    .then(() => { if (leaving && generation === owner) location.href = href; });
}

function handle(text, echoContext, token) {
  if (leaving) return null;
  const wake = voice.wake?.(text);
  const destination = voice.navigation?.(text, { modeChoice: true });
  const phrase = String(wake?.rest ?? text ?? '').trim().toLowerCase().replace(/[,.!?。！？]+$/g, '').replace(/\s+/g, ' ');
  const help = /^(help|options|repeat|what can you do|what can i say|what are my options)$/.test(phrase);
  const quiet = /^(stop|quiet|pause|stop speaking|be quiet)$/.test(phrase);
  // Once a wake has been acknowledged, a fresh precise command must work
  // through the short acoustic tail of the interrupted menu.
  const followup = token?.owner === generation && token.sequence > wakeAfter
    && token.capturedAt >= wakeAt && token.capturedAt < wakeUntil && (destination || help || quiet);
  if (!followup && voice.echo(text, echoContext)) return 'echo';
  if (quiet) {
    wakeUntil = 0; voice.stop({ resumeEars: false });
    state('Speech stopped. Still listening for Nib or a mode.', !!ears?.stream);
    return 'quiet';
  }
  if (wake && !wake.rest) {
    voice.stop({ resumeEars: false });
    // FIFO transcription can deliver the wake only AFTER the user has already
    // spoken the next phrase. Order follow-ups by capture, not ASR delivery.
    wakeAt = token?.capturedAt ?? performance.now(); wakeUntil = performance.now() + 8000;
    wakeAfter = token?.sequence ?? captureSequence;
    state('I’m listening. Say Trace, Around me, Memory, or help.', !!ears?.stream);
    voice.earcon(true);
    return 'listening';
  }
  if (destination) { wakeUntil = 0; go(destination); return destination; }
  if (help || wake) { wakeUntil = 0; voice.say(MENU); return 'menu'; }
  // Siri-like: anything said right after "Nib" gets a friendly answer, never silence.
  if (performance.now() < wakeUntil) { wakeUntil = 0; voice.say(ABOUT); return 'about'; }
  return null;
}

// One startup promise for automatic arrival, taps and retries. Automatic audio
// waits for microphone permission; a real tap also unlocks audio synchronously.
function start({ automatic = false } = {}) {
  if (leaving) return Promise.resolve();
  if (!automatic) {
    try { voice.unlock(); Promise.resolve(voice.ctx?.resume?.()).catch(() => {}); } catch { /* retry below */ }
  }
  if (starting) return starting;
  if (ears?.stream) {
    state('Listening. Say Trace, Around me, Memory, or help.', true);
    if (!automatic) voice.say(MENU);
    return Promise.resolve();
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    voice.micOpen = false;
    state('Voice input is unavailable here. Choose a mode below, or use keys 1, 2, or 3.');
    return Promise.resolve();
  }
  const owner = generation;
  state('Connecting the microphone. Allow access if your browser asks.');
  let pending, acquired = null, candidate = null, resumeTimer;
  const current = () => !leaving && owner === generation;
  pending = (async () => {
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: MIC });
      if (!current()) { releaseStream(acquired); return; }
      mic = acquired; voice.micOpen = true;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
      voice.unlock();
      const audio = voice.ctx;
      if (!audio) throw Object.assign(new Error('Audio unavailable'), { audioBlocked: true });
      await Promise.race([
        Promise.resolve().then(() => audio.resume?.()).catch(() => {}),
        new Promise(resolve => { resumeTimer = setTimeout(resolve, 800); }),
      ]);
      clearTimeout(resumeTimer);
      if (!current()) { releaseStream(acquired); return; }
      if (audio.state !== 'running') throw Object.assign(new Error('Audio blocked'), { audioBlocked: true });
      candidate = makeEars({
        ctx: audio, lang: () => 'en', ignore: () => leaving,
        onCapture: () => ({ owner, echo: voice.echoSnapshot(), sequence: ++captureSequence, capturedAt: performance.now() }),
        isCurrent: token => !leaving && token?.owner === generation,
        onText: (text, token) => handle(text, token.echo, token),
      });
      pendingEars = candidate;
      await candidate.start(acquired);
      if (!current()) { candidate.stop(); releaseStream(acquired); return; }
      ears = candidate;
      state('Listening. Say Trace, Around me, Memory, or help.', true);
      voice.say(MENU); // only after permission, running audio and the same listener
    } catch (error) {
      candidate?.stop(); releaseStream(acquired);
      if (mic === acquired) mic = null;
      if (current()) {
        ears = null; voice.micOpen = false;
        if (error?.audioBlocked) voice.unlocked = false; // a real tap must retry the silent speech unlock
        const message = error?.audioBlocked
          ? 'Tap Talk to Nib to enable audio and voice, or choose a mode below.'
          : 'Voice input could not start. Tap Talk to Nib to try again, or choose a mode below.';
        const canSpeak = !automatic && voice.ctx?.state === 'running';
        state(message, false, !canSpeak);
        if (canSpeak) voice.say(message, { system: true });
      }
    } finally {
      clearTimeout(resumeTimer);
      if (pendingEars === candidate) pendingEars = null;
      if (starting === pending) starting = null;
    }
  })();
  starting = pending;
  return pending;
}
function autoStart() {
  if (autoAttempted || leaving || document.hidden || new URLSearchParams(location.search).has('bot')) return;
  autoAttempted = true;
  return start({ automatic: true });
}

// Opened by voice ("Hey Nib, go home") there's no tap: start as soon as iPhone allows sound.
(async () => {
  try {
    const mic = await voice.autoUnlock(MIC);
    if (!mic) return;
    try { await start(); } finally { mic.getTracks().forEach(t => t.stop()); }
  } catch { /* no permission yet: a tap starts Home */ }
})();

// Plain anchors retain normal VoiceOver and keyboard navigation.
document.addEventListener('click', event => { if (!event.target.closest('a')) start(); });
document.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest('input, textarea, select, [contenteditable]')) return;
  const destination = { 1: 'paper', 2: 'around', 3: 'memory' }[event.key];
  if (destination) { event.preventDefault(); go(destination); }
  else if (event.key === 'Enter' && !event.target.closest('a, button')) start();
});
addEventListener('pagehide', () => {
  resumeOnReturn ||= !!ears?.stream;
  pageHidden = true; leaving = true; generation++; wakeUntil = 0;
  ears?.stop(); pendingEars?.stop(); ears = null; pendingEars = null; starting = null;
  releaseMic(); voice.micOpen = false;
  voice.stop({ resumeEars: false });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari only */ }
});
addEventListener('pageshow', event => {
  if (!event.persisted || !pageHidden) return;
  const resume = resumeOnReturn;
  pageHidden = false; resumeOnReturn = false; leaving = false; generation++; wakeUntil = 0;
  ears = null; pendingEars = null; starting = null; releaseMic(); voice.micOpen = false;
  state('You are back on Nib Home. Tap Talk to Nib, choose a mode, or use keys 1, 2, or 3.');
  if (resume) { autoAttempted = false; autoStart(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoStart(); });
window.nibHome = { handle };

// Microphone capture may permit audio on arrival, including a voice-led mode switch.
// Browsers that require a gesture keep the same tap/keyboard/card fallback.
autoStart();
