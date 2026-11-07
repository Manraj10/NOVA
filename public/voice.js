// Nib's voice: spoken instructions, short spoken direction cues, and distance beeps.

export const TAGS = { en: 'en-US', es: 'es-US', hi: 'hi-IN', zh: 'zh-CN' };

const WORDS = {
  en: { up: 'up', down: 'down', left: 'left', right: 'right', near: { up: 'a little up', down: 'a little down', left: 'a little left', right: 'a little right' } },
  es: { up: 'arriba', down: 'abajo', left: 'izquierda', right: 'derecha', near: { up: 'un poco más arriba', down: 'un poco más abajo', left: 'un poco a la izquierda', right: 'un poco a la derecha' } },
  hi: { up: 'ऊपर', down: 'नीचे', left: 'बाएँ', right: 'दाएँ', near: { up: 'थोड़ा ऊपर', down: 'थोड़ा नीचे', left: 'थोड़ा बाएँ', right: 'थोड़ा दाएँ' } },
  zh: { up: '往上', down: '往下', left: '往左', right: '往右', near: { up: '稍微往上', down: '稍微往下', left: '稍微往左', right: '稍微往右' } },
};

// The mic is always on in a room full of talking people (and a presenter), so a bare command
// counts only when it is the whole phrase: "done" works, "okay so done with that" does not.
const DONE = /^((i'?m )?(done|finished)|next|listo|terminé|siguiente|हो गया|अगला|好了|完成|下一个)$/;
const REPEAT = /^(repeat( that)?|say (that|it) again|repite|otra vez|दोबारा|फिर से|再说一遍|重复)$/;
const SKIP = /^(skip( it| this( one)?)?|saltar|छोड़ो|跳过)$/;
const REDO = /^(redo|that'?s wrong|wrong|rehacer|दोबारा लिखो|重写)$/;
// Only a START address wakes Nib: "Nib", "Nib, <question>" and "Hey Nib, <question>".
// Accept recognizer spellings (Mib, Nim, Ned, Nid all happened live) and joined "HeyNib", never an embedded mention or "Nibbles".
// The name as phones actually transcribe it (all seen live): nib, neb, nip, nim, mib, ned, nid, knib…
// and run together with "hey": "HeNeB", "Hennip", "Heynib".
const NAME = '(?:k?n+[iey]+[bp]+[esh]?|n[iey]+d|n[iy]m|m[iy]b|knob)';
const HEY = '(?:hey|hay|hei|hen|he|hai)';
// With "Hey" in front, anything may follow. A bare name must be addressed ("Nib." / "Nib, what's this?"),
// so a presenter saying "Nib reads the form…" in the pitch doesn't trigger it.
const WAKE = new RegExp(`^(?:${HEY}[\\s,]*|(?:hi|ok|okay)[\\s,]+)${NAME}(?=$|[\\s,.:!?;。！？])|^${NAME}(?=$|[,.:!?;。！？])`);
const BARE = new RegExp(`^(?:${HEY}[\\s,]*|(?:hi|ok|okay)[\\s,]+)?${NAME}$`);
// Best built-in voices first: iPhone Premium/Enhanced downloads, then Edge/Chrome neural voices.
const RANK = [/premium/i, /enhanced/i, /natural|neural/i, /online|google/i, /ava|zoe|samantha|aria|jenny|siri/i];
const score = v => { const k = RANK.findIndex(r => r.test(v.name)); return k < 0 ? RANK.length : k; };

// iOS: audioSession "playback" blocks the mic, so while Nib's ears are open (micOpen) it stays "play-and-record".
export const voice = {
  lang: 'en',
  speaking: false,
  kind: '',
  endedAt: 0,
  muted: false,
  voices: [],
  // The natural voice (/api/speak). Off in robot test runs so they stay offline and free.
  cloud: !new URLSearchParams(location.search).has('bot'),
  clips: new Map(), // [request language, exact text] -> { done, pcm, rate, p }
  seq: 0,
  wordTimers: [],
  finishCurrent: null,
  onCaption: () => {},

  init() {
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
    // Every mode uses the same ears. A later transcription failure must be
    // audible even when that service (or the paid speech service) is down.
    if (!this.hearingFailureListener && window.addEventListener) {
      this.voicePageActive = true;
      this.hearingFailureListener = event => {
        if (!this.voicePageActive || document.hidden) return;
        const reason = event.detail?.reason;
        if (!['transcription-failed', 'transcription-timeout', 'queue-full'].includes(reason)) return;
        const now = performance.now();
        if (Number.isFinite(this.lastHearingWarning) && now - this.lastHearingWarning < 30000) return;
        this.lastHearingWarning = now;
        const line = reason === 'queue-full'
          ? 'I missed that. Please wait a moment, then try again.'
          : "Voice input isn't working right now. Please try again in a moment, or use the on-screen controls.";
        this.say(line, { system: true });
      };
      window.addEventListener('nib:voice-drop', this.hearingFailureListener);
      window.addEventListener('pagehide', () => { this.voicePageActive = false; });
      window.addEventListener('pageshow', () => { this.voicePageActive = true; });
    }
  },

  // Audio and speech only start after a user gesture.
  unlock() {
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume?.();
    try { if (navigator.audioSession) navigator.audioSession.type = this.micOpen ? 'play-and-record' : 'playback'; } catch { /* Safari 16.4+ only */ }
    if (!this.unlocked) {
      // iOS only lets speech start from inside a tap: speak a silent line now, before any await.
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      this.unlocked = true;
    }
  },

  pick() {
    const tag = TAGS[this.lang].toLowerCase();
    const same = this.voices.filter(v => v.lang?.replace('_', '-').toLowerCase().startsWith(tag.slice(0, 2)));
    const off = v => (v.lang.replace('_', '-').toLowerCase() === tag ? 0 : 0.5); // exact accent wins ties
    return [...same].sort((x, y) => score(x) + off(x) - score(y) - off(y))[0] || null;
  },

  // A soft line ("Next: Phone number.") gets ~1 s to land, then directions may cut in. Hard lines
  // ("Stop. Write your name here.") always finish.
  busy() { return this.speaking && this.kind === 'say' && !(this.soft && performance.now() - this.startedAt > 900); },

  // Fetch (once) the natural-voice clip for a line. entry.pcm stays null if the voice is off,
  // failed, or changed a word; then the built-in voice speaks that line.
  clip(text) {
    const lang = this.lang, key = JSON.stringify([lang, text]);
    let e = this.clips.get(key);
    if (e) return e;
    const fallback = !this.cloud || text.trim().length > 400;
    e = { done: fallback, pcm: null, rate: 24000 };
    e.p = fallback ? Promise.resolve() : fetch('/api/speak', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }),
    }).then(async r => {
      if (r.status === 503) this.cloud = false; // no key on the server: stop asking
      if (!r.ok) return;
      const j = await r.json();
      const bytes = Uint8Array.from(atob(j.pcm), c => c.charCodeAt(0));
      const i16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
      e.pcm = Float32Array.from(i16, v => v / 32768);
      e.rate = j.rate || 24000;
    }).catch(() => {}).finally(() => {
      e.done = true;
      if (!e.pcm) setTimeout(() => { if (this.clips.get(key) === e) this.clips.delete(key); }, 30000); // retry later
    });
    this.clips.set(key, e);
    return e;
  },

  // Warm the lines Nib is about to say, four at a time, so guidance never waits on the network.
  prefetch(texts) {
    if (!this.cloud) return;
    const lang = this.lang;
    const q = [...new Set(texts.filter(Boolean))].filter(t => !this.clips.has(JSON.stringify([lang, t])));
    // Do not fetch an old-language warm-up queue using a newly selected language.
    const next = () => { const t = q.shift(); if (t && this.lang === lang) this.clip(t).p.then(next); };
    for (let k = 0; k < 4; k++) next();
  },

  // Stop whatever is speaking, in either voice.
  stop({ resumeEars = true } = {}) {
    this.seq++;
    const finish = this.finishCurrent;
    this.finishCurrent = null;
    this.current = null;
    this.speaking = false;
    this.kind = '';
    this.soft = false;
    this.endedAt = performance.now();
    speechSynthesis.cancel();
    const source = this.source;
    this.source = null;
    try { source?.stop(); } catch { /* already stopped */ }
    this.wordTimers.forEach(clearTimeout);
    this.wordTimers = [];
    finish?.(); // settle the cancelled say immediately, even if fetch never returns
    if (resumeEars) this.ears?.resume();
  },

  // cue: short direction words. They never cut off a full instruction.
  // The natural voice speaks if its clip is ready (cues) or arrives within 1.5 s (instructions);
  // otherwise the built-in voice says it, so a slow network never leaves the person in silence.
  say(text, { cue = false, soft = false, system = false } = {}) {
    if (!text) return Promise.resolve();
    if (cue && this.busy()) return Promise.resolve();
    this.onCaption(text, cue);
    if (!cue) this.listeningUi(false); // the reply has started: the listening orb goes away, like Siri
    this.recent = [...(this.recent || []).slice(-5), text]; // for echo()
    this.stop({ resumeEars: false });
    const my = this.seq, token = {};
    this.current = token;
    this.speaking = true;
    this.kind = cue ? 'cue' : 'say';
    this.soft = !cue && soft;
    this.startedAt = performance.now();
    this.ears?.pause();
    return new Promise(resolve => {
      let done = false, timer, waitTimer;
      const end = (cancelled = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(waitTimer);
        if (this.current === token && this.seq === my) {
          speechSynthesis.cancel(); // watchdog completion also stops system audio
          const source = this.source;
          this.source = null;
          // Includes watchdog completion: never reopen ears while PCM continues.
          try { source?.stop(); } catch { /* already ended */ }
          this.wordTimers.forEach(clearTimeout);
          this.wordTimers = [];
          this.finishCurrent = null;
          this.current = null;
          this.speaking = false; this.kind = ''; this.endedAt = performance.now();
          if (!cancelled && !cue) this.onEnd?.();
          if (!cancelled) this.ears?.resume();
        }
        resolve();
      };
      // ponytail: some browsers never fire onend, so a length-based timeout backs it up
      const watchdog = ms => { clearTimeout(timer); timer = setTimeout(() => end(), ms); };
      this.finishCurrent = () => end(true);
      watchdog(4000 + text.length * 110);
      // Failure/status speech must not make another request to a failed service.
      // Keep all normal cancellation, echo and completion guards around it.
      const e = system ? { done: true, pcm: null } : this.clip(text);
      const go = () => {
        if (done || this.seq !== my || this.current !== token) return end(true);
        if (e.pcm && this.ctx?.state === 'running') {
          // PCM has a known duration. Text-length estimates are only for system
          // speech, whose browsers sometimes omit their completion event.
          watchdog(e.pcm.length / e.rate * 1000 + 1500);
          this.playClip(e, text, cue, () => end());
        } else this.speakBuiltIn(text, cue, () => end());
      };
      if (e.done || cue || !this.cloud) go();
      else Promise.race([e.p, new Promise(r => { waitTimer = setTimeout(r, 1500); })]).then(go);
    });
  },

  playClip(e, text, cue, end) {
    const c = this.ctx, buf = c.createBuffer(1, e.pcm.length, e.rate);
    buf.copyToChannel(e.pcm, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.onended = end;
    this.source = src;
    src.start();
    // Word-by-word captions: a clip has no word events, so pace the words across its length.
    if (!cue) for (const m of text.matchAll(/\S+/g)) {
      this.wordTimers.push(setTimeout(() => this.onWord?.(m.index), (m.index / text.length) * buf.duration * 920));
    }
  },

  speakBuiltIn(text, cue, end) {
    const my = this.seq, token = this.current;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = TAGS[this.lang];
    const v = this.pick();
    if (v) u.voice = v;
    u.rate = cue ? 1.3 : 1.05;
    if (!cue) u.onboundary = ev => { if (this.seq === my && this.current === token) this.onWord?.(ev.charIndex); };
    u.onend = end;
    u.onerror = end;
    speechSynthesis.speak(u);
  },

  cueWord(dir, near) {
    const w = WORDS[this.lang] || WORDS.en;
    return near ? w.near[dir] : w[dir];
  },

  // pan: -1 (target is to the left) to 1 (right). With earbuds you can hear where the target is.
  beep(freq = 660, dur = 0.05, vol = 0.1, pan = 0) {
    const c = this.ctx;
    if (!c || this.muted) return;
    if (c.state !== 'running') { c.resume?.(); return; }
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o.connect(g);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); out = out.connect(p); }
    out.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  chime() {
    this.beep(880, 0.12, 0.16);
    setTimeout(() => this.beep(1320, 0.2, 0.14), 110);
  },

  // Listening on: a rising pair. Listening off: the same pair falling.
  // Listening on/off, on every page: a soft rising (or falling) chime, and a glowing "Listening" orb so
  // anyone can see Nib heard its name. Every page already calls earcon(true/false) at those moments.
  earcon(up) {
    const notes = up ? [523, 659, 784] : [784, 659, 523];
    notes.forEach((f, k) => setTimeout(() => this.beep(f, 0.11, 0.12), k * 70));
    this.listeningUi(up);
  },

  listeningUi(on) {
    if (typeof document === 'undefined' || !document.body) return;
    let orb = document.getElementById('nibListening');
    if (!orb) {
      const css = document.createElement('style');
      css.textContent = `#nibListening{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translate(-50%,20px) scale(.9);z-index:9999;display:flex;align-items:center;gap:12px;padding:14px 22px 14px 14px;border-radius:999px;background:rgba(20,20,22,.78);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:1px solid rgba(255,255,255,.16);color:#fff;font:600 19px -apple-system,Inter,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .2s,transform .3s cubic-bezier(.32,.72,0,1)}
#nibListening.on{opacity:1;transform:translate(-50%,0) scale(1)}
#nibListening i{width:34px;height:34px;border-radius:50%;background:conic-gradient(from var(--a,0deg),#FFD60A,#FF9F0A,#30D158,#64D2FF,#BF5AF2,#FFD60A);animation:nibspin 1.2s linear infinite,nibpulse 1s ease-in-out infinite alternate;box-shadow:0 0 24px rgba(255,214,10,.6)}
@keyframes nibspin{to{transform:rotate(360deg)}}@keyframes nibpulse{from{scale:.86}to{scale:1.08}}
@media (prefers-reduced-motion:reduce){#nibListening i{animation:none}}`;
      document.head.append(css);
      orb = Object.assign(document.createElement('div'), { id: 'nibListening' });
      orb.setAttribute('aria-hidden', 'true'); // the chime and the spoken reply carry it for VoiceOver users
      orb.append(document.createElement('i'), Object.assign(document.createElement('span'), { textContent: 'Listening…' }));
      document.body.append(orb);
    }
    clearTimeout(this.orbTimer);
    orb.classList.toggle('on', !!on);
    if (on) this.orbTimer = setTimeout(() => orb.classList.remove('on'), 9000); // never stuck on
  },

  heard: !!(window.SpeechRecognition || window.webkitSpeechRecognition),

  // Always-on ears: short commands ("done", "repeat", "skip"), and the wake phrase
  // "Nib, <question>" for hands-free questions. Chrome sends this audio to Google for recognition.
  listen(onCommand) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    this.onCommand = onCommand;
    this.rec?.abort?.();
    const rec = new SR();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = TAGS[this.lang];
    rec.onresult = e => {
      // Ignore our own voice: anything heard while speaking, or right after.
      if (this.speaking || performance.now() - this.endedAt < 700) return;
      this.handle(e.results[e.results.length - 1][0].transcript);
    };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.rec = null; this.deaf = true; } };
    rec.onend = () => { if (this.rec === rec) try { rec.start(); } catch { /* already running */ } };
    try { rec.start(); } catch { /* already running */ }
  },

  // iPhone: an open mic moves all sound to the quiet earpiece, so the ears are half-duplex there:
  // they close before Nib speaks or beeps and reopen once it is quiet. If iOS refuses to reopen
  // them without a tap (deaf), hold-to-ask still works.
  halfDuplex(allowed) {
    this.ears = {
      pause: () => {
        const r = this.rec;
        if (!r) return;
        this.rec = null;
        try { r.abort(); } catch { /* already stopped */ }
        try { if (navigator.audioSession) navigator.audioSession.type = this.micOpen ? 'play-and-record' : 'playback'; } catch { /* Safari only */ }
      },
      resume: () => setTimeout(() => {
        if (!this.rec && !this.deaf && !this.speaking && this.onCommand && allowed()) this.listen(this.onCommand);
      }, 350),
    };
  },

  // One heard phrase, from the browser recognizer or Nib's own ears (ears.js), to a command.
  // True when the ears only heard Nib's own recent words coming back through the speaker.
  echoSnapshot() {
    // Server transcription may finish long after playback. Preserve the acoustic
    // context at speech onset, including a copy before later lines replace it.
    return Object.freeze({
      active: this.speaking || performance.now() - this.endedAt <= 700,
      talking: !!this.speaking, // still mid-line when this phrase began (not just in the tail after it)
      recent: Object.freeze([...(this.recent || [])]),
    });
  },

  echo(text, captured) {
    const context = captured || this.echoSnapshot();
    // Recent words are not a permanent command blacklist: a genuine "done"
    // begun after playback's tail must work, however fast or slow ASR returns.
    if (!context.active) return false;
    // A bare wake phrase may interrupt playback by opening a question window.
    // A full wake+command still must not repeat words from our own speaker.
    const low = String(text || '').trim().toLowerCase();
    const bare = low.replace(/[.,!?。！？"']/g, '').trim();
    if (captured && BARE.test(bare)) return false;
    const n = s => String(s).toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
    const h = n(text);
    // A one-word mode name right after Nib's menu ("Say Paper, …" → "Paper") is the person answering, not
    // the speaker bleeding back, unless Nib was still mid-line. Other words in the tail (like "done")
    // stay echo, because acting on them can't be undone.
    if (captured && !h.includes(' ') && context.talking === false && this.navigation(h)) return false;
    return !!h && context.recent.some(line => n(line).includes(h));
  },

  wake(text) {
    const said = String(text || '').trim(), low = said.toLowerCase();
    const match = WAKE.exec(low);
    return match ? { rest: said.slice(match[0].length).replace(/^[\s,.:!?;。！？]+/, '').trim() } : null;
  },

  // Shared by Paper, Around and the home hub. Only a whole destination name,
  // optionally introduced by the existing wake phrase, can change pages.
  navigation(text, { modeChoice = false } = {}) {
    const low = String(text || '').trim().toLowerCase();
    const wake = WAKE.exec(low);
    const phrase = (wake ? low.slice(wake[0].length).replace(/^[\s,.:!?;。！？]+/, '') : low)
      .replace(/^[\s,.!?。！？"']+|[\s,.!?。！？"']+$/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
    const explicitMode = /^(please )?(go back to|go to|go|open|take me to|take me|switch to|back to)( the)? /.test(phrase);
    const destination = phrase
      // People say "go home", "open Paper", "take me to Memory", "Around me mode, please": still one whole command.
      .replace(/^(please )?(go back to|go to|go|open|take me to|take me|switch to|back to)( the)? /, '')
      .replace(/( mode| page| screen)?( please)?$/, '');
    // Observed aliases work everywhere. Fuzzy choices remain enabled on Home
    // and after a navigation verb, without rerouting ordinary room answers.
    // "Back" remains a local previous-field/question action.
    const routes = { trace: 'paper', paper: 'paper', peeper: 'paper', 'around me': 'around',
      'a round me': 'around', around: 'around', memory: 'memory', memories: 'memory', home: 'home', menu: 'home' };
    if (Object.hasOwn(routes, destination)) return routes[destination];
    if (!(modeChoice || explicitMode) || !destination || /[^a-z ]/.test(destination) || destination.split(' ').length > 3) return null;
    const lev = (a, b) => {
      const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
      for (let j = 1; j <= b.length; j++) d[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return d[a.length][b.length];
    };
    const close = [...new Set(['trace', 'paper', 'memory', 'around me', 'home']
      .filter(k => lev(destination, k) <= (k.length >= 5 ? 2 : 1)).map(k => routes[k]))];
    return close.length === 1 ? close[0] : null;
  },

  handle(text) {
    const onCommand = this.onCommand;
    const said = String(text || '').trim(), low = said.toLowerCase();
    if (!onCommand || !said) return;
    const destination = this.navigation?.(said);
    if (destination) return onCommand('nav', destination);
    const bare = low.replace(/[.!?。！？]+$/g, '').trim();
    if (BARE.test(bare)) return onCommand('ask', '');
    const wake = WAKE.exec(low);
    if (wake) return onCommand('ask', said.slice(wake[0].length).replace(/^[\s,.:!?;。！？]+/, '').trim());
    if (DONE.test(bare)) onCommand('done');
    else if (REPEAT.test(bare)) onCommand('repeat');
    else if (SKIP.test(bare)) onCommand('skip');
    else if (REDO.test(bare)) onCommand('redo');
  },

  // Push-to-talk: pause the always-on ears, capture one whole question, then resume.
  // Returns { stop } where stop() resolves to the transcript.
  hear(onWords, onPhrase) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const resume = this.rec;
    this.rec = null;
    resume?.abort?.();
    this.stop({ resumeEars: false });
    this.speaking = false;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = TAGS[this.lang];
    let final = '', interim = '', ended;
    const done = new Promise(r => { ended = r; });
    rec.onresult = e => {
      interim = '';
      let gotFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { final += e.results[i][0].transcript; gotFinal = true; }
        else interim += e.results[i][0].transcript;
      }
      onWords(`${final} ${interim}`.trim());
      if (gotFinal && onPhrase) onPhrase(); // hands-free mode ends after one phrase
    };
    rec.onerror = e => { this.hearError = e.error; ended(); };
    rec.onend = () => ended();
    try { rec.start(); } catch { ended(); }
    return {
      stop: async () => {
        try { rec.stop(); } catch { /* already stopped */ }
        await Promise.race([done, new Promise(r => setTimeout(r, 1500))]);
        try { if (navigator.audioSession) navigator.audioSession.type = this.micOpen ? 'play-and-record' : 'playback'; } catch { /* Safari only */ }
        this.ctx?.resume?.(); // the mic can suspend audio on iOS
        if (resume && this.onCommand) this.listen(this.onCommand); // only if the browser recognizer was the ears
        return `${final} ${interim}`.trim();
      },
    };
  },
};
