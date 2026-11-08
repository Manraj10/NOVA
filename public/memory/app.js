// Nib · Memory: say a room you remember; Nib builds it all the way around you (no questions: it reads the
// place, era and culture from the clues in your words),
// tells you what's where, and changes it when you say it was different. Every detail is labeled
// "from your words" or "imagined by Nib". The 3D view is for the family; the voice is for everyone.
//
// Voice is Nib's own (../voice.js, ../ears.js): the ears stay open after the first tap. "Nib" alone opens a
// listening window; "Hey Nib, <words>" acts at once. Nib also opens the window itself right after it asks
// something. Whatever is said in a window goes to the step that is active: the memory, something to add
// while it builds, or a change to the room. Short whole phrases are commands anywhere ("describe the room",
// "show what's real", "start over", "home", "paper", "around me").
import { voice } from '../voice.js';
import { makeEars, MIC } from '../ears.js';
import { load, shrink, stripInput, makeLoop, equirect, placeholderBack } from './pano.js';
import { depthOf, makeRoom, warmDepth } from './room.js';
import { ambience, MUSIC } from './ambience.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const sentences = t => String(t || '').match(/[^.!?]+[.!?]+[\s”’"]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
voice.init();
const ctx = () => { if (!voice.ctx) voice.unlock(); return voice.ctx; };

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $(id).querySelector('[data-focus]')?.focus({ preventScroll: true });
}
const screen = () => document.querySelector('.screen.on')?.id;
// captions follow whatever Nib says, on the screen that is showing (not aria-live: the voice already says it)
voice.onCaption = text => { const el = { room: $('caption'), talk: $('question'), home: $('note1') }[screen()]; if (el) el.textContent = text; };

async function api(name, body) {
  // Leave room for the server's bounded model calls and image fallback. Sound
  // can retry once on the local server; it does not block entering the room.
  const ms = ({ ask: 22000, spec: 30000, scene: 70000, back: 70000, fix: 70000, labels: 50000, sound: 125000 })[name] || 30000;
  const controller = new AbortController();
  let timer;
  const operation = (async () => {
    const r = await fetch('/api/memory/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${name} failed`);
    return j;
  })();
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${name} took too long. Please try again.`);
      error.name = 'TimeoutError';
      reject(error); // settle even when the transport or response body ignores abort
      controller.abort();
    }, ms);
  });
  try { return await Promise.race([operation, deadline]); }
  finally { clearTimeout(timer); }
}

async function loadFrontImage(src) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The picture arrived but could not open. Please try again.')), 15000);
  });
  try { return await Promise.race([load(src), deadline]); }
  finally { clearTimeout(timer); }
}

// ---------- the fixed lines, made in the natural voice while the page loads ----------
const L = {
  greet: 'Memory. Tell me about a room you remember. Just start talking.',
  building: 'Got it. Building your room. It can take a minute or more. You can say Home or start over.',
  confirm: 'Is that how you remember it? Tell me anything to change.',
  almost: 'I’m still building your room. You can say Home or start over any time.',
  added: 'Got it. I’ll add that.',
  glad: 'I’m glad. Look around as long as you like. Say Nib if you want to change anything.',
  what: 'What should be different?',
  noMic: 'I can’t hear you. Allow the microphone for this page, then tap the screen. You can also type.',
  changing: 'Okay. Changing the whole room. About twenty seconds.',
  done: 'Done.',
  fail: 'I couldn’t change it that time. Say it again.',
  broke: 'I couldn’t finish the room. Say try again or Home.',
  over: 'Starting over. Tell me about a room you remember.',
  here: 'You’re already in Memory.',
  home: 'Going home.', paper: 'Opening Trace.', around: 'Opening Around me.',
  example: 'Opening the example.',
  fixExample: 'The example can’t be changed. Tell me your own room to try that.',
};
voice.prefetch(Object.values(L));

// ---------- ears: open after the first tap, then always on ----------
let ears = null, micDenied = false, autoMic = null, leaving = false, listeningPaused = false, listenGeneration = 0, captureSequence = 0;
const captureContext = () => ({ generation: listenGeneration, run, step, room: current, lang: voice.lang || 'en',
  sequence: ++captureSequence, capturedAt: performance.now(), echo: voice.echoSnapshot() });
const sessionCurrent = token => !!token && !leaving && !listeningPaused
  && token.generation === listenGeneration && token.lang === (voice.lang || 'en');
const contextCurrent = token => sessionCurrent(token) && token.run === run && token.step === step && token.room === current;
// One build keeps its sid when an image is replaced. Never transfer a correction
// into another memory or an example with no proven logical target.
const sameContentTarget = token => contextCurrent(token) || (sessionCurrent(token) && token.run === run
  && step === 'room' && current?.sid === token.run
  && (token.step === 'building' || (token.step === 'room' && token.room?.sid === current.sid)));
const currentTarget = token => ({ ...token, run, step, room: current });
function startEars() {
  if (ears || micDenied || leaving || listeningPaused) return;
  voice.unlock();
  voice.micOpen = true;
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
  const owner = listenGeneration;
  const candidate = makeEars({
    ctx: voice.ctx, lang: () => 'en',
    ignore: () => leaving || listeningPaused,
    onCapture: captureContext,
    isCurrent: sessionCurrent,
    onText: (text, token) => { if (sessionCurrent(token) && !voice.echo(text, token.echo)) heard(text, { token }); },
  });
  ears = candidate;
  candidate.start(autoMic || undefined).then(() => {
    if (owner !== listenGeneration || leaving || listeningPaused) candidate.stop();
  }).catch(() => {
    if (ears !== candidate || owner !== listenGeneration || leaving || listeningPaused) return;
    // Ears borrows this stream; Memory must retire it when graph setup fails.
    autoMic?.getTracks().forEach(t => t.stop()); autoMic = null;
    ears = null; micDenied = true; voice.micOpen = false;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }
    voice.say(L.noMic);
    setTimeout(() => { micDenied = false; }, 4000); // a later tap may ask again
  });
}

// Like Around me: one tap anywhere (a VoiceOver double-tap works too) unlocks sound and opens the ears.
// After that, nothing needs a tap: Nib listens for the memory right away, and for "Nib" any time after.
let greeted = false;
function begin() {
  if (!$('start') || $('start').hidden) return;
  if (leaving) return;
  listeningPaused = false;
  if (greeted) {
    $('start').hidden = true;
    startEars();
    voice.say(step === 'room' ? 'Back in the room. Say Nib any time.' : 'I’m listening. Say Nib any time.');
    return;
  }
  greeted = true;
  $('start').hidden = true;
  $('home').inert = false;
  $('home').querySelector('[data-focus]')?.focus({ preventScroll: true });
  startEars();
  warmDepth().catch(() => {});
  openWindow(30000, false);
  const greeting = captureContext();
  voice.say(L.greet).then(() => { if (contextCurrent(greeting) && step === 'home' && !collected) openWindow(25000); });
}
addEventListener('click', begin, { capture: true }); // click (not pointerdown): iOS only unlocks audio on a real activation
// Opened by voice ("Hey Nib, open Memory") there's no tap. Like Around me: if the mic is already allowed and
// sound can start, begin right away; otherwise the "Tap anywhere" screen stays.
async function autoStart() {
  if (params.has('bake') || document.hidden) return;
  const owner = listenGeneration;
  try {
    const mic = await voice.autoUnlock(MIC);
    if (!mic) return;
    if (owner !== listenGeneration || leaving || listeningPaused || document.hidden || $('start').hidden) {
      mic.getTracks().forEach(t => t.stop());
      if (!ears && !autoMic) voice.micOpen = false; // A late unlock must not leave a false capture flag, or mute a newer owner.
      return;
    }
    autoMic = mic; // kept live: stopping it would let iPhone silence the sound again
    begin();
  } catch { /* no permission yet, or no sound without a tap: the start screen handles it */ }
}
autoStart();
$('go').focus({ preventScroll: true }); // VoiceOver lands on "Tap anywhere to start"
if (params.has('bake')) { $('start').hidden = true; $('home').inert = false; }

// Leaving (Home, another app, the lock screen): the mic closes and Nib goes quiet. Coming back shows the
// start screen again, because iPhone needs one tap before sound and the mic can come back.
function pause() {
  listeningPaused = true; listenGeneration++;
  if ($('start').hidden === false) return;
  clearCollection();
  voice.stop({ resumeEars: false });
  ears?.stop(); ears = null;
  autoMic?.getTracks().forEach(t => t.stop()); autoMic = null;
  voice.micOpen = false;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }
  if (music) music.gain.gain.value = 0;
  windowUntil = 0; collected = ''; orb = false; voice.listeningUi?.(false);
}
function resume() {
  if (!$('start').hidden) return;
  $('go').textContent = 'Tap anywhere to continue';
  $('start').hidden = false;
  $('go').focus({ preventScroll: true });
}
addEventListener('pagehide', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else if (!ears && greeted) resume(); });
addEventListener('pageshow', e => { if (e.persisted && greeted) resume(); });

// ---------- one router for everything heard or typed ----------
let step = 'home';            // home | asking | building | room
let windowUntil = 0, freeUntil = 0, collected = '', commitTimer = null, windowContext = null, collectionContext = null;
const norm = t => String(t).toLowerCase().replace(/[.,!?"“”'’]/g, '').replace(/\s+/g, ' ').trim();

// cue: the rising chime and the "Listening…" orb (voice.earcon). Windows opened just before Nib speaks (so you
// can talk over it) stay silent; voice.say hides the orb when a reply starts.
let orb = false;
function clearCollection() {
  clearTimeout(commitTimer); commitTimer = null;
  closeWindow(); windowContext = null; collected = ''; collectionContext = null;
}

// Command-only windows never admit room edits. Free windows follow a wake, a tap, or a direct question.
function openWindow(ms = 9000, cue = true, free = true, onset = null) {
  if (leaving || listeningPaused) return;
  // ASR delivery may lag the next phrase's capture: preserve capture order.
  if (onset || !sameContentTarget(windowContext)) {
    const context = onset || captureContext();
    windowContext = { ...context, after: context.sequence, from: context.capturedAt };
  }
  windowUntil = performance.now() + ms;
  freeUntil = free ? windowUntil : 0;
  if (cue && !orb) { voice.earcon(true); orb = true; }
}
function closeWindow() {
  windowUntil = 0; freeUntil = 0;
  if (!orb) return;
  orb = false;
  if (voice.speaking) voice.listeningUi?.(false); else voice.earcon(false);
}

// The ears hear "Nib" many ways. A bare "hey" is NOT a wake word: in a busy room people say it all the time.
// Nib still listens by itself right after it asks or describes something.
const fixWake = t => t
  .replace(/^\s*(hey|hi|hay|ok|okay)[\s,]+(nib|nibb|nibs|nim|mib|neeb|nibe|nibh|nieb|knib|neb|ned|nid|nip)\b[,.!?]*/i, 'Hey Nib, ')
  .replace(/^Hey Nib,\s*$/, 'Nib');

// In the room, a sentence that is plainly an edit ("make it darker", "can you add a radio") counts any time,
// with or without "Hey Nib". Other talk near the phone (the presenter, the judges) never changes the room.
const EDIT = /^(?:(?:no|ok|okay|yes|yeah|good job|great job|nice job|looks good|thats good|good|nice|great|but|and|so|actually|also|um|uh|hmm|wait|now|then|just|can you|could you|would you|please)[\s,]+)*(?:make (?:it|the|there|everything|this)|change (?:it|the|that)|add (?:a|an|the|some|more)|remove (?:the|that)|take out the|get rid of|replace the|swap the|paint the|fix it|fix the|i want (?:it|the|there|you to (?:make|change|add|remove|fix))|id like (?:it|the|there)|i would like (?:it|the|there)|there should be|it should be|let there be)\b/;
function heard(text, { typed = false, token = null, at } = {}) {
  if (leaving || listeningPaused) return;
  token ||= captureContext();
  if (Number.isFinite(at)) token = { ...token, capturedAt: Math.min(at, performance.now()) };
  if (!sessionCurrent(token)) return;
  text = fixWake(String(text || '').trim());
  if (!text) return;
  const nav = voice.navigation(text);
  if (nav) return go(nav);
  const wake = voice.wake(text);
  let words = wake ? wake.rest : text;
  const inWindow = sameContentTarget(windowContext) && token.sequence > windowContext.after
    && token.capturedAt >= windowContext.from && token.capturedAt <= windowUntil
    && performance.now() <= windowUntil + 10000;
  const inFreeWindow = inWindow && freeUntil > 0 && token.capturedAt <= freeUntil
    && performance.now() <= freeUntil + 10000;
  // Exact global controls are safe in the current scene even after an image/step
  // transition. Relative content is still bound to its original memory.
  if (/^(help|options|what can i say|what can you do|what are my options|stop|quiet|be quiet|pause|shh+|hush|status|progress|how (much )?long( .*)?|is it (ready|done)( yet)?|are you done( yet)?)$/.test(norm(words))) {
    clearCollection(); voice.stop({ resumeEars: false });
    const control = command(norm(words));
    return control ? control() : voice.say(step === 'building' ? L.almost : step === 'room' ? 'Your room is ready. Say describe the room or tell me a change.' : L.greet, { system: true });
  }
  if (wake && !wake.rest) {
    clearCollection(); voice.stop({ resumeEars: false });
    return openWindow(9000, true, true, currentTarget(token));
  }
  if (!contextCurrent(token)) {
    if (sameContentTarget(token) && transferableChange(words) && (wake || typed || inWindow)) token = currentTarget(token);
    else {
      if (wake) repeatAfterTransition(token);
      return;
    }
  }
  if (wake) {
    // Acknowledgement starts when the recognized address arrives, before the
    // silence timer or a generation result can make the app feel unresponsive.
    voice.stop({ resumeEars: false });
    if (!orb) { voice.earcon(true); orb = true; }
  } else if (!typed && !inWindow && !(step === 'room' && EDIT.test(norm(words)))) {
    if (voice.speaking && /^(stop|quiet|be quiet|pause|shh+|hush)$/.test(norm(words))) { voice.stop(); openWindow(); }
    return; // not meant for Nib
  }
  const cmd = command(norm(words));
  if (cmd) { clearCollection(); return cmd(); }
  if (typed) return commit(words, token);
  // Use speech onset, with the same bounded ASR grace as the command window.
  if (!wake && !collected && step !== 'home' && !inFreeWindow && !(step === 'room' && EDIT.test(norm(words)))) return;
  // speech arrives a phrase at a time: keep collecting until a short silence, then act on all of it
  if (!collectionContext || !sameContentTarget(collectionContext)) {
    collected = ''; collectionContext = token;
  }
  collected = collected ? `${collected} ${words}` : words;
  openWindow(1800, false, true, sameContentTarget(windowContext) ? null : token);
  clearTimeout(commitTimer);
  const owner = collectionContext;
  const check = () => {
    if (collectionContext !== owner) return;
    if (!contextCurrent(owner) && !(sameContentTarget(owner) && transferableChange(collected))) {
      clearCollection();
      if (sessionCurrent(owner)) repeatAfterTransition(owner);
      return;
    }
    const now = performance.now();
    if (now < windowUntil || (ears?.busy && now < windowUntil + 10000)) commitTimer = setTimeout(check, 400);
    else { const text = collected; clearCollection(); commit(text, owner); }
  };
  commitTimer = setTimeout(check, 1300);
}

const isQuestion = text => /\?\s*$/.test(text) || /^(what|where|when|why|how|who|which|can|could|would|should|do|does|did|is|are|am|has|have|will)\b/i.test(text.trim());
const isChange = text => /^(?:please\s+)?(?:add|remove|delete|replace|change|make|move|put|turn|set|paint|take away|swap|include)\b/i.test(text.trim())
  || /^(?:no[,\s]+)?(?:the|that|this|it)\b[\s\S]*\b(?:was|were|should be|used to be|belongs|needs to be)\b/i.test(text.trim());
const transferableChange = text => !isQuestion(text) && isChange(text)
  && !/\b(it|this|that|these|those|them|here|there|one)\b/i.test(text);
function repeatAfterTransition(token) {
  clearCollection(); voice.stop({ resumeEars: false });
  openWindow(9000, true, true, currentTarget(token));
  voice.say('I heard you. Please repeat the change for this room.', { system: true });
}
function commit(text, token = captureContext()) {
  if (!text || !sessionCurrent(token)) return;
  if (!contextCurrent(token)) {
    if (sameContentTarget(token) && transferableChange(text)) token = currentTarget(token);
    else return repeatAfterTransition(token);
  }
  if (step === 'home') return converse(text);
  if (step === 'room' && (EDIT.test(norm(text)) || (!isQuestion(text) && isChange(text)))) return change(text);
  // said while the room is being built: kept, and applied to the whole room as soon as it's ready
  if (step === 'building' && !isQuestion(text) && isChange(text)) { later.push(text); bubble('you', text); return voice.say(L.added); }
  return voice.say(step === 'building'
    ? 'I’m building your room. To add a detail, say add, followed by what you remember. Questions will not change the room.'
    : 'What should be different? Say change, add, move, or remove, followed by the detail. You can also say describe the room.');
}
let later = [];

function sayAndListen(text, ms, cue = true, free = true) {
  const owner = captureContext();
  return voice.say(text).then(() => { if (contextCurrent(owner)) openWindow(ms, cue, free); });
}

function command(t) {
  if (/^(stop|quiet|be quiet|pause|shh+|hush)$/.test(t)) return () => voice.stop();
  if (/^(start over|start again|new (memory|room)|begin again|restart)$/.test(t)) return startOver;
  if (/^(try again|again)$/.test(t) && retry) return () => retry();
  if (step === 'home' && /^(try|open|show me) the example$|^example$/.test(t)) return () => openExample();
  if (/^(help|options|what can i say|what can you do|what are my options)$/.test(t)) return () => voice.say(step === 'building'
    ? 'I’m building your room. Say add a detail, how long is left, stop, start over, or home.'
    : 'Say describe the room, show what’s real, change a detail, start over, or home.');
  if (step === 'building' && /^(is it (ready|done)( yet)?|how (much )?long( .*)?|are you done( yet)?|whats happening|what is happening|status|progress|when (will|is|can)( .*)?)$/.test(t)) return () => voice.say(retry ? L.broke : L.almost);
  if (step !== 'room') return null;
  if (/^(yes|yeah|yep|yup|yes it is|thats (right|it)|perfect|correct|exactly|thanks|thank you|ok|okay|good|great|nice|beautiful|wow|its perfect)$/.test(t)) return () => voice.say(L.glad);
  if (/^(no|nope|not quite|not really|thats wrong|wrong|its wrong)$/.test(t)) return () => sayAndListen(L.what, 14000);
  if (/^(describe( the room| it)?|what(s| is) (here|around me|in the room)|where am i|tell me again|repeat( that)?|say (that|it) again)$/.test(t)) return describeAgain;
  if (/^(show (me )?what(s| is) real|what(s| is) real|show (the )?labels)$/.test(t)) return () => real(true, true);
  if (/^hide (the )?labels$/.test(t)) return () => real(false);
  if (/^(mute|sound off|music off)$/.test(t)) return () => setMuted(true);
  if (/^(unmute|sound on|music on)$/.test(t)) return () => setMuted(false);
  return null;
}

function go(dest) {
  if (leaving) return;
  if (dest === 'memory') return voice.say(L.here);
  const routes = { home: '../', paper: '../paper.html', around: '../around.html' };
  if (!Object.hasOwn(routes, dest)) return;
  const url = routes[dest];
  leaving = true; listeningPaused = true; listenGeneration++; run++; changeTok++; soundTok++;
  clearCollection(); later = []; retry = null; changing = false; current = null; step = 'leaving';
  ears?.stop(); ears = null;
  autoMic?.getTracks().forEach(t => t.stop()); autoMic = null;
  voice.micOpen = false;
  music?.stop(); music = null; view?.tiltOff();
  voice.stop({ resumeEars: false });
  Promise.race([voice.say(L[dest]), new Promise(resolve => setTimeout(resolve, 2500))])
    .then(() => { location.href = url; });
}

// The yellow button: talk now (stops Nib, opens a window); tap again to finish early.
function bindTalk(btn) {
  btn.addEventListener('click', () => {
    startEars();
    if (collected) { windowUntil = performance.now(); return; } // finish now
    voice.stop();
    openWindow(10000);
  });
}
['mic1', 'mic2', 'mic3'].forEach(id => bindTalk($(id)));
// listening shows on the button; music ducks under Nib's voice and while you talk
setInterval(() => {
  const open = performance.now() < windowUntil || !!collected;
  if (!open && orb && !ears?.busy) closeWindow();
  for (const id of ['mic1', 'mic2', 'mic3']) { $(id).classList.toggle('live', open); $(id).setAttribute('aria-pressed', String(open)); }
  if (screen() === 'home' && open && !voice.speaking && ears) $('note1').textContent = collected ? `“${collected}”` : 'Listening…';
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
  if (leaving || listeningPaused) return;
  clearCollection();
  run++; later = []; retry = null; collected = ''; current = null; changing = false; changeTok++;
  soundTok++; music?.stop(); music = null; view?.tiltOff(); view?.destroy(); view = null;
  step = 'home';
  show('home');
  const owner = captureContext();
  voice.say(L.over).then(() => { if (contextCurrent(owner)) openWindow(12000); });
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

const STEPS = [['spec', 'Planning from your words'], ['scene', 'Building the room in front of you'], ['back', 'Building the walls behind you'], ['labels', 'Marking what came from your words'], ['sound', 'Bringing back the sound'], ['depth', 'Giving it depth']];
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
    fail: () => {
      head.textContent = 'Build stopped. Say try again or Home.';
      $('clock').textContent = 'Build stopped';
      for (const e of ol.querySelectorAll('.go')) { e.className = 'bad'; e.querySelector('.t').textContent = 'not finished'; }
    },
    go: k => { el(k).className = 'go'; },
    done: k => { const e = el(k); e.className = 'done'; e.querySelector('.t').textContent = secs() + ' s'; },
    bad: (k, msg) => { const e = el(k); e.className = 'bad'; e.querySelector('.t').textContent = msg; },
  };
}

async function build(memory, me) {
  step = 'building';
  let nudge, stage = 'scene';
  const st = steps(), tick = setInterval(() => {
    if (me !== run || leaving) { clearInterval(tick); return; }
    st.tick();
  }, 250);
  try {
    // the front is built straight from the words while the scene plan (what is where, which details are
    // theirs) is worked out alongside; the plan feeds the walls behind you, the labels and the sound
    const said = memory;
    const progress = () => {
      if (me !== run || step !== 'building' || leaving || listeningPaused || document.hidden) return;
      // A progress update must not take the floor from a question or correction.
      if (!voice.speaking && !collected && performance.now() >= windowUntil) voice.say({
        scene: 'I’m still drawing your room. You can say Home or start over.',
        image: 'The picture has arrived. I’m opening it now.',
        spec: 'The picture is ready. I’m matching it with the details you described.',
        labels: 'The picture is ready. I’m adding its spoken description.',
      }[stage]);
      nudge = setTimeout(progress, 20000);
    };
    nudge = setTimeout(progress, 17000);
    st.go('spec'); st.go('scene');
    const specP = api('spec', { memory }).catch(() => ({ memory: said, front_prompt: said, back_prompt: '', spoken: [], sound_prompt: said })).then(s => { if (me === run) st.done('spec'); return s; });
    const frontP = api('scene', { memory: said }).then(r => { if (me !== run) return null; stage = 'image'; return loadFrontImage(r.image); });
    const front = await frontP;
    if (me !== run) return clearInterval(tick);
    st.done('scene');
    $('waitimg').src = front.src; $('waitimg').hidden = false;
    const frontJpg = shrink(front, 1600, 0.88);
    stage = 'spec';
    const spec = await specP;
    if (me !== run) return clearInterval(tick);
    stage = 'labels'; st.go('labels');
    const labelsP = api('labels', { scene: frontJpg, spec }).then(r => { if (me === run) st.done('labels'); return r; }).catch(e => { if (me === run) st.bad('labels', 'skipped'); console.warn(e); return null; });
    st.go('sound');
    const wantsMusic = MUSIC.test(spec.memory || said);
    const soundP = (wantsMusic ? api('sound', { spec }) : Promise.resolve(null)).then(r => { if (me === run) st.done('sound'); return r ? 'data:audio/mpeg;base64,' + r.audio : null; }).catch(e => { if (me === run) st.bad('sound', 'skipped'); console.warn(e); return null; });
    // You step inside as soon as the front and its labels are ready. The walls behind you start as a soft
    // continuation of the front and fill in when painted (a few seconds later); then the room takes its depth.
    st.go('back');
    const backP = paintBack(front, spec);
    const lab = await labelsP;
    if (me !== run) return clearInterval(tick);
    const { loop: loop0, L: len, s, w } = makeLoop(front, placeholderBack(front));
    const room = {
      spec, front, back: null, frontJpg, pano: equirect(loop0), depth: null,
      title: lab?.title || spec.title || 'Your room',
      narration: lab?.narration || (!lab ? 'Your room is ready, but its spoken description was unavailable. You can describe a change or start over.' : ''),
      describe: lab?.describe || '',
      tags: tagsFrom(lab, { L: len, s, w }), faceU: (w / 2 - s) / len, sound: null, sid: me,
      ambient: [spec.memory || said, spec.room, spec.time, ...(spec.sounds || [])].filter(Boolean).join(' '),
    };
    clearTimeout(nudge);
    fillBehind(room, front, backP, st);
    soundP.then(snd => { if (!snd) return; room.sound = snd; if (current === room) startSound(room); else if (current?.sid === room.sid) { current.sound = snd; startSound(current); } });
    room.soundFrom = room.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || null;
    clearInterval(tick);
    if (me !== run) return;
    st.finish();
    window.__lastRoom = room;
    enter(room);
  } catch (e) {
    clearInterval(tick); clearTimeout(nudge);
    console.warn(e);
    if (me !== run) return;
    st.fail();
    retry = () => { retry = null; li.onclick = null; li.onkeydown = null; build(memory, ++run); };
    const broke = /balance|credit|402/i.test(e.message);
    const li = bubble('nib', broke ? 'Nib is out of picture credit right now. Say “try the example” to step into one I built earlier.' : `I couldn’t finish the room: ${e.message} Say “try again” or “Home”, or tap here.`);
    li.tabIndex = 0; li.setAttribute('role', 'button'); li.style.cursor = 'pointer';
    li.onclick = () => retry?.();
    li.onkeydown = e => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.onclick?.(); } };
    step = 'building';
    if (broke) {
      step = 'home';
      if (!listeningPaused && !leaving && !document.hidden) sayAndListen('Nib is out of picture credit right now. Say try the example, and I’ll take you into one I built earlier.', 12000);
      return;
    }
    if (!listeningPaused && !leaving && !document.hidden) sayAndListen(L.broke, 10000, true, false);
  } finally {
    clearInterval(tick); clearTimeout(nudge);
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

function prepareRoomEntry(room) {
  const sameMemory = room?.sid === run && (step === 'building' || (step === 'room' && current?.sid === room.sid));
  // A wake window is intent, not content. Keep its onset identity for queued ASR;
  // only an explicit named correction may carry collected text into this memory.
  const keepWindow = sameMemory && sameContentTarget(windowContext);
  const keepCollection = sameMemory && sameContentTarget(collectionContext) && transferableChange(collected);
  if (!keepCollection) { clearTimeout(commitTimer); commitTimer = null; collected = ''; collectionContext = null; }
  if (!keepWindow) { closeWindow(); windowContext = null; }
  later = sameMemory ? later.filter(transferableChange) : [];
}

async function enter(room, { changed = false } = {}) {
  if (leaving) return;
  prepareRoomEntry(room);
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
  if (!changed || !music || !room.sound) await startSound(room); // the room's own sound follows each change
  else placeSound(room);
  await sleep(changed ? 100 : 900);
  if (current !== room || step !== 'room' || leaving || listeningPaused) return;
  const lines = [...(changed ? [L.done] : room.narration ? [room.narration] : []), ...sentences(room.describe)];
  if (later.length) { const t = later.join('. '); later = []; return change(t); }
  if (await sayLines(lines) && current === room && step === 'room') confirmAndListen();
}

function describeAgain() {
  if (!current) return;
  const room = current;
  sayLines(sentences(room.describe)).then(done => { if (done && current === room) confirmAndListen(); });
}
function confirmAndListen() {
  if (leaving || listeningPaused || step !== 'room') return;
  const owner = captureContext();
  openWindow(16000, false);
  voice.say(L.confirm).then(() => { if (contextCurrent(owner) && !collected) openWindow(14000); }); // a change said over the question keeps its own 1.8 s commit // Nib asked, so a current answer counts.
}

let muted = false, soundTok = 0;
async function startSound(room) {
  const tok = ++soundTok;
  music?.stop(); music = null;
  $('mute').hidden = !room.sound && !room.ambient;
  if (!room.sound && !room.ambient) return;
  try {
    const c = ctx(), gain = c.createGain(), pan = c.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.2; pan.rolloffFactor = 0.8;
    gain.gain.value = 0;
    pan.connect(gain).connect(c.destination);
    let stop;
    if (room.sound) {
      const buf = await c.decodeAudioData(await (await fetch(room.sound)).arrayBuffer());
      if (tok !== soundTok || current !== room) return;
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true; src.connect(pan); src.start();
      stop = () => { try { src.stop(); } catch { } };
    } else {
      const amb = ambience(c, room.ambient); // the room's own sound, all around you
      amb.out.connect(pan);
      stop = amb.stop;
    }
    music = { stop, gain, pan };
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
function setMuted(m) { muted = m; $('mute').setAttribute('aria-pressed', String(!muted)); }
$('mute').onclick = () => setMuted(!muted);

function real(on, speak = false) {
  shown = on;
  $('room').classList.toggle('show-real', on);
  $('tags').inert = !on;
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
  sayAndListen(`What should the ${t.name} be?`, 12000);
};
$('stage').addEventListener('pointerdown', () => { $('tagsheet').hidden = true; });

// ---------- "No, the radio was by the window": change the room by voice ----------
let changing = false, changeTok = 0;
async function change(text) {
  const room = current;
  if (!room) return;
  if (changing) { later.push(text); return voice.say(L.added); } // one change at a time; the next follows
  if (!room.front) return voice.say(L.fixExample);
  changing = true;
  const tok = ++changeTok;
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
    const soundP = MUSIC.test(text) && !room.sound ? api('sound', { spec }).then(r => 'data:audio/mpeg;base64,' + r.audio).catch(() => null) : Promise.resolve(null);
    const backP = paintBack(front, spec).catch(() => room.back);
    const lab = await labP;
    const { loop, L: len, s, w } = makeLoop(front, placeholderBack(front));
    clearInterval(tick);
    const next = {
      ...room, spec, front, frontJpg, pano: equirect(loop), depth: room.depth, clips: null, ambient: `${room.ambient || ''} ${text}`,
      title: lab?.title || room.title, narration: lab?.narration || room.narration, describe: lab?.describe || '',
      tags: lab ? tagsFrom(lab, { L: len, s, w }) : room.tags,
    };
    next.soundFrom = next.tags.find(t => lab?.sound_from && t.name === lab.sound_from) || room.soundFrom;
    changing = false;
    if (current !== room) return;
    window.__lastRoom = next;
    soundP.then(snd => { if (!snd) return; next.sound = snd; if (current === next) startSound(next); });
    enter(next, { changed: true });
    fillBehind(next, front, backP);
  } catch (e) {
    clearInterval(tick);
    if (tok !== changeTok) return;
    changing = false; later = [];
    console.warn(e);
    if (current !== room) return;
    sayAndListen(L.fail, 10000);
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
  if (leaving || listeningPaused) return;
  const owner = captureContext();
  startEars();
  $('example').textContent = 'Opening…';
  try {
    const meta = await heroMeta;
    if (!meta) throw new Error('no example');
    const toCanvas = img => { const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); return c; };
    const [pano, depthImg, front, back] = await Promise.all(['hero/pano.jpg', 'hero/depth.png', 'hero/front.jpg', 'hero/back.jpg'].map(u => load(u).catch(() => null)));
    if (!contextCurrent(owner)) return;
    const room = { ...meta, pano: toCanvas(pano), depth: depthImg && toCanvas(depthImg), sound: 'hero/sound.mp3', front, back, frontJpg: front && shrink(front, 1600, 0.88) };
    room.soundFrom = room.tags.find(t => t.name === meta.soundFromName) || null;
    run++; later = []; collected = ''; changing = false; changeTok++;
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
