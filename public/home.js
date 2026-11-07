// One home menu, using the SAME exact navigation parser as Paper and Around.
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';

const MENU = 'You are on Nib Home. Say Paper, Around me, or Memory. Say help to hear these choices again, or tap a card.';
const MEMORY_PENDING = 'Memory is being connected. You are still on Nib Home. Choose Paper or Around me for now.';
const memoryReady = document.documentElement?.dataset.memoryReady === 'true';
const ROUTES = {
  paper: ['paper.html', 'Opening Paper. When it loads, tap anywhere to start.'],
  around: ['around.html', 'Opening Around me. When it loads, tap anywhere to start.'],
  memory: ['memory.html', 'Opening Memory. When it loads, tap to speak or type.'],
};
const live = document.getElementById('live');
const listen = document.getElementById('listen');
let ears = null, mic = null, starting = null, leaving = false, generation = 0;
const releaseMic = () => { mic?.getTracks().forEach(track => track.stop()); mic = null; };
const state = (message, listening = false) => {
  live.textContent = message;
  listen.setAttribute('aria-pressed', String(listening));
  listen.textContent = listening ? 'Listening · say a mode' : 'Talk to Nib';
};
voice.init();
voice.prefetch([MENU, MEMORY_PENDING, ...Object.values(ROUTES).map(route => route[1])]);
voice.onCaption = text => { live.textContent = text; };

function go(destination) {
  if (leaving) return;
  if (destination === 'home') { voice.say(MENU); return; }
  if (!Object.hasOwn(ROUTES, destination)) return;
  if (destination === 'memory' && !memoryReady) { state(MEMORY_PENDING, !!ears?.stream); voice.say(MEMORY_PENDING); return; }
  const [href, line] = ROUTES[destination];
  leaving = true; generation++;
  ears?.stop(); releaseMic(); voice.micOpen = false;
  state(line);
  voice.unlock();
  // A broken speech callback must never strand someone on Home.
  Promise.race([voice.say(line), new Promise(resolve => setTimeout(resolve, 2500))])
    .then(() => { location.href = href; });
}

function handle(text, echoContext) {
  if (leaving) return null;
  if (voice.echo(text, echoContext)) return 'echo';
  const destination = voice.navigation?.(text);
  if (destination) { go(destination); return destination; }
  const phrase = String(text || '').trim().toLowerCase().replace(/[,.!?。！？]+$/g, '').replace(/\s+/g, ' ');
  if (/^(?:(?:hey|hi|okay|ok) nib[ ,]+)?(?:help|options|what can you do|what are my options)$/.test(phrase)) {
    voice.say(MENU); return 'menu';
  }
  return null;
}

function start() {
  if (leaving) return Promise.resolve();
  voice.unlock();
  voice.say(MENU);
  if (starting) return starting;
  if (ears?.stream) { state('Listening. Say Paper, Around me, Memory, or help.', true); return Promise.resolve(); }
  if (!navigator.mediaDevices?.getUserMedia) {
    voice.micOpen = false;
    state('Voice input is unavailable here. Choose a mode below, or use keys 1, 2, or 3.');
    return Promise.resolve();
  }
  const owner = generation;
  voice.micOpen = true;
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
  const candidate = makeEars({
    ctx: voice.ctx, lang: () => 'en', ignore: () => leaving,
    onCapture: () => ({ owner, echo: voice.echoSnapshot() }),
    isCurrent: token => !leaving && token?.owner === generation,
    onText: (text, token) => handle(text, token.echo),
  });
  let pending;
  pending = (async () => {
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: MIC });
      if (leaving || owner !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      mic = acquired;
      await candidate.start(mic);
      if (leaving || owner !== generation) { candidate.stop(); releaseMic(); return; }
      ears = candidate;
      state('Listening. Say Paper, Around me, Memory, or help.', true);
    } catch {
      candidate.stop(); releaseMic(); ears = null; voice.micOpen = false;
      state('Microphone unavailable. Choose a mode below, or use keys 1, 2, or 3.');
      if (!leaving) voice.say("I can't hear you without the microphone. Choose a mode below.");
    } finally { if (starting === pending) starting = null; }
  })();
  starting = pending;
  return pending;
}

// Plain anchors retain normal VoiceOver and keyboard navigation.
document.addEventListener('click', event => { if (!event.target.closest('a')) start(); });
document.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest('input, textarea, select, [contenteditable]')) return;
  const destination = { 1: 'paper', 2: 'around', 3: 'memory' }[event.key];
  if (destination) { event.preventDefault(); go(destination); }
  else if (event.key === 'Enter' && !event.target.closest('a, button')) start();
});
addEventListener('pagehide', () => {
  leaving = true; generation++;
  ears?.stop(); releaseMic(); voice.micOpen = false;
  voice.stop({ resumeEars: false });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari only */ }
});
addEventListener('pageshow', event => {
  if (!event.persisted) return;
  leaving = false; generation++; ears = null; starting = null; releaseMic(); voice.micOpen = false;
  state('You are back on Nib Home. Tap Talk to Nib, choose a mode, or use keys 1, 2, or 3.');
});
window.nibHome = { handle };
