// Home hub: three cards for sighted and VoiceOver users, plus a spoken menu for
// everyone else. The first tap anywhere off a card speaks the menu and opens Nib's ears.
import { voice } from './voice.js';
import { makeEars, MIC } from './ears.js';

const MENU = 'Welcome to Nib. Say Paper to fill in a form, Around me to hear what\'s around you, or Memory to build a place you remember. Or tap a card.';
const ROUTES = [
  // Order matters: "remember", "around" and "help" beat the loose "read".
  [/memory|remember/, 'memory.html', 'Opening Memory.'],
  [/around|whats around|whos here|look/, 'around.html', 'Opening Around me.'],
  [/paper|form|read/, 'paper.html', 'Opening Paper.'],
];
const live = document.getElementById('live');
let ears = null, leaving = false;

voice.init();
voice.onCaption = text => { live.textContent = text; };

function go(href, line) {
  if (leaving) return;
  leaving = true;
  voice.unlock(); // a key press may be the first gesture
  ears?.stop();
  // ponytail: a 2.5 s cap so a stuck voice can never strand the person on the hub.
  Promise.race([voice.say(line), new Promise(r => setTimeout(r, 2500))]).then(() => { location.href = href; });
}

// One heard phrase to a destination. Returns what it did, for tests.
function handle(text) {
  if (voice.echo(text)) return 'echo';
  const t = String(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  for (const [re, href, line] of ROUTES) if (re.test(t)) { go(href, line); return href; }
  if (/help|what can|options/.test(t)) { voice.say(MENU); return 'menu'; }
  return null;
}

function start() {
  voice.micOpen = true;
  voice.unlock(); // inside the tap, before any await (iOS)
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
  voice.say(MENU);
  if (ears || !navigator.mediaDevices?.getUserMedia) return;
  ears = makeEars({ ctx: voice.ctx, lang: () => 'en', ignore: () => false, onText: handle });
  navigator.mediaDevices.getUserMedia({ audio: MIC })
    .then(stream => ears.start(stream))
    .catch(() => { ears = null; voice.micOpen = false; voice.say('I can\'t hear you without the microphone. Tap a card instead.'); });
}

// Taps on cards stay plain links, so VoiceOver swipes and double-taps work as usual.
document.addEventListener('click', e => { if (!e.target.closest('a')) start(); });
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const route = ROUTES[{ 1: 2, 2: 1, 3: 0 }[e.key]];
  if (route) go(route[1], route[2]);
  else if (e.key === 'Enter' && !e.target.closest('a, button')) start();
});

window.nibHome = { handle };
