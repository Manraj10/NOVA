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
// "Hey Nib", not bare "Nib": a presenter says "Nib reads the form..." all through the pitch.
// Speech recognizers spell a made-up name many ways.
const WAKE = /^(hey|hi|ok|okay)[\s,]+(nib|nibb|knib|nip|neb|nibs)\b/;
const NICE = /natural|neural|online|google|samantha|aria|jenny|ava|siri/i;

export const voice = {
  lang: 'en',
  speaking: false,
  kind: '',
  endedAt: 0,
  muted: false,
  voices: [],
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
  },

  pick() {
    const tag = TAGS[this.lang].toLowerCase();
    const same = this.voices.filter(v => v.lang?.replace('_', '-').toLowerCase().startsWith(tag.slice(0, 2)));
    return same.find(v => v.lang.replace('_', '-').toLowerCase() === tag && NICE.test(v.name))
      || same.find(v => NICE.test(v.name)) || same.find(v => v.lang.replace('_', '-').toLowerCase() === tag) || same[0] || null;
  },

  busy() { return this.speaking && this.kind === 'say'; },

  // cue: short direction words. They never cut off a full instruction.
  say(text, { cue = false } = {}) {
    if (!text) return Promise.resolve();
    if (cue && this.busy()) return Promise.resolve();
    this.onCaption(text, cue);
    return new Promise(resolve => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = TAGS[this.lang];
      const v = this.pick();
      if (v) u.voice = v;
      u.rate = cue ? 1.2 : 1.02;
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.current === u) { this.speaking = false; this.kind = ''; this.endedAt = performance.now(); if (!cue) this.onEnd?.(); }
        resolve();
      };
      if (!cue) u.onboundary = e => { if (this.current === u) this.onWord?.(e.charIndex); };
      // ponytail: some browsers never fire onend, so a length-based timeout backs it up
      const timer = setTimeout(end, 1800 + text.length * 95);
      u.onend = end;
      u.onerror = end;
      this.current = u;
      this.speaking = true;
      this.kind = cue ? 'cue' : 'say';
      speechSynthesis.speak(u);
    });
  },

  cueWord(dir, near) {
    const w = WORDS[this.lang] || WORDS.en;
    return near ? w.near[dir] : w[dir];
  },

  // pan: -1 (target is to the left) to 1 (right). With earbuds you can hear where the target is.
  beep(freq = 660, dur = 0.05, vol = 0.1, pan = 0) {
    const c = this.ctx;
    if (!c || this.muted) return;
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
      const said = e.results[e.results.length - 1][0].transcript.trim();
      const low = said.toLowerCase();
      // Ignore our own voice: anything heard while speaking, or right after.
      if (this.speaking || performance.now() - this.endedAt < 700) return;
      const wake = WAKE.exec(low);
      if (wake) return onCommand('ask', said.slice(wake[0].length).replace(/^[\s,.!?]+/, ''));
      const bare = low.replace(/[.,!?。！？]/g, '').trim();
      if (DONE.test(bare)) onCommand('done');
      else if (REPEAT.test(bare)) onCommand('repeat');
      else if (SKIP.test(bare)) onCommand('skip');
    };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.rec = null; };
    rec.onend = () => { if (this.rec === rec) try { rec.start(); } catch { /* already running */ } };
    try { rec.start(); } catch { /* already running */ }
  },

  // Push-to-talk: pause the always-on ears, capture one whole question, then resume.
  // Returns { stop } where stop() resolves to the transcript.
  hear(onWords, onPhrase) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const resume = this.rec;
    this.rec = null;
    resume?.abort?.();
    speechSynthesis.cancel();
    this.speaking = false;
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
        if (this.onCommand) this.listen(this.onCommand);
        return `${final} ${interim}`.trim();
      },
    };
  },
};
