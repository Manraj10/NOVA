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
// Wake: "Nib" on its own opens listening; "Hey Nib, <question>" asks straight away. A presenter
// saying "Nib reads the form..." mid-sentence does nothing. Recognizers spell a made-up name many ways.
// ("Hey, Mib, help." happened on the live site.)
const WAKE = /^(hey|hi|hay|ok|okay)[\s,]+(nib|nibb|nibs|nibbs|knib|nip|neb|nim|mib|neeb|nibe|nieb|nibh|knob)\b/;
const BARE = /^((hey|hi|hay|ok|okay) )?(nib|nibb|nibs|nibbs|knib|nip|neb|nim|mib|neeb|nibe|nieb|nibh|knob)$/;
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
  say(text, { cue = false, soft = false } = {}) {
    if (!text) return Promise.resolve();
    if (cue && this.busy()) return Promise.resolve();
    this.onCaption(text, cue);
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
      const e = this.clip(text);
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
  earcon(up) {
    this.beep(up ? 620 : 930, 0.07, 0.13);
    setTimeout(() => this.beep(up ? 930 : 620, 0.09, 0.13), 85);
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
    return !!h && context.recent.some(line => n(line).includes(h));
  },

  wake(text) {
    const said = String(text || '').trim(), low = said.toLowerCase();
    const bare = low.replace(/[.,!?。！？"']/g, '').trim();
    if (BARE.test(bare)) return { rest: '' };
    const match = WAKE.exec(low);
    return match ? { rest: said.slice(match[0].length).replace(/^[\s,.!?]+/, '') } : null;
  },

  // Shared by Paper, Around and the home hub. Only a whole destination name,
  // optionally introduced by the existing wake phrase, can change pages.
  navigation(text) {
    const low = String(text || '').trim().toLowerCase();
    const wake = WAKE.exec(low);
    const destination = (wake ? low.slice(wake[0].length) : low)
      .replace(/^[\s,.!?。！？"']+|[\s,.!?。！？"']+$/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim()
      // People say "go home", "open Paper", "take me to Memory", "Around me mode, please": still one whole command.
      .replace(/^(please )?(go back to|go to|go|open|take me to|take me|switch to|back to)( the)? /, '')
      .replace(/( mode| page| screen)?( please)?$/, '');
    const routes = { paper: 'paper', 'around me': 'around', around: 'around', memory: 'memory', home: 'home', back: 'home', menu: 'home' };
    return Object.hasOwn(routes, destination) ? routes[destination] : null;
  },

  handle(text) {
    const onCommand = this.onCommand;
    const said = String(text || '').trim(), low = said.toLowerCase();
    if (!onCommand || !said) return;
    const destination = this.navigation?.(said);
    if (destination) return onCommand('nav', destination);
    const bare = low.replace(/[.,!?。！？"']/g, '').trim();
    if (BARE.test(bare)) return onCommand('ask', '');
    const wake = WAKE.exec(low);
    if (wake) return onCommand('ask', said.slice(wake[0].length).replace(/^[\s,.!?]+/, ''));
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
