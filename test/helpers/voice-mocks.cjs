const fs = require('node:fs');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Browser/audio surfaces are inert. fetch NEVER reaches a network. Deliberately
// default to late responses surviving abort so generation guards can be tested.
function loadVoice(file, options = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), system = [], cloud = [], requests = [], recognizers = [], sessions = [];
  const timeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { at: now + Number(delay), fn }); return id; };
  const clear = id => timers.delete(id);
  const synth = { cancelCount: 0, getVoices: () => [{ name: 'Samantha', lang: 'en-US' }, { name: 'Spanish Natural', lang: 'es-US' }],
    addEventListener() {}, cancel() { this.cancelCount++; }, speak(u) { system.push(u); } };
  class Utterance { constructor(text) { this.text = text; } }
  class Recognition {
    constructor() { recognizers.push(this); this.started = false; }
    start() { this.started = true; }
    stop() { this.started = false; timeout(() => this.onend?.(), 0); }
    abort() { this.started = false; timeout(() => this.onend?.(), 0); }
    emit(text, final = true) {
      const result = [{ transcript: text }]; result.isFinal = final;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  const node = () => ({ connect() { return this; }, disconnect() {}, value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class AudioContext {
    constructor() { this.state = options.audioState || 'running'; this.destination = {}; }
    get currentTime() { return now / 1000; }
    resume() { if (options.resumeReject) return Promise.reject(new Error('Playback denied')); this.state = 'running'; return Promise.resolve(); }
    createGain() { return { ...node(), gain: node() }; }
    createStereoPanner() { return { ...node(), pan: node() }; }
    createOscillator() { return { ...node(), frequency: node(), start() {}, stop() {} }; }
    createBuffer(channels, length, sampleRate) { return { duration: length / sampleRate, sampleRate, length,
      getChannelData: () => new Float32Array(length), copyToChannel() {} }; }
    decodeAudioData() { return Promise.resolve(this.createBuffer(1, 2400, 24000)); }
    createBufferSource() {
      const context = this;
      return { ...node(), buffer: null, stopped: false,
        start() {
          cloud.push({ type: 'buffer-start', source: this, at: now, state: context.state });
          if (context.state === 'running' && !options.neverAudioEnd) timeout(() => this.onended?.(), Math.max(1, (this.buffer?.duration || .1) * 1000));
        },
        stop() { this.stopped = true; timeout(() => this.onended?.(), 0); } };
    }
  }
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.listeners = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    removeEventListener(name) { delete this.listeners[name]; }
    play() {
      if (options.playReject) return Promise.reject(new Error('NotAllowedError'));
      this.paused = false; cloud.push({ type: 'html-play', source: this, at: now });
      if (!options.neverAudioEnd) timeout(() => { this.onended?.(); this.listeners.ended?.(); }, 100);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    load() {}
  }
  const audioSession = {};
  Object.defineProperty(audioSession, 'type', { get: () => sessions.at(-1), set: value => sessions.push(value) });
  const context = { console, Buffer, Promise, Uint8Array, Int16Array, Float32Array, ArrayBuffer, TextDecoder, TextEncoder, URLSearchParams,
    location: { search: options.locationSearch ?? '?bot' },
    AbortController, AbortSignal, Response, Request, Headers, Blob, ReadableStream,
    URL: class extends URL { static createObjectURL() { return 'blob:mock-audio'; } static revokeObjectURL() {} },
    performance: { now: () => now }, setTimeout: timeout, clearTimeout: clear,
    atob: value => Buffer.from(value, 'base64').toString('binary'), btoa: value => Buffer.from(value, 'binary').toString('base64'),
    SpeechSynthesisUtterance: Utterance, speechSynthesis: synth, Audio,
    navigator: { userAgent: options.ios ? 'iPhone' : 'Chrome', platform: options.ios ? 'iPhone' : 'MacIntel', audioSession },
    document: { hidden: false, visibilityState: 'visible', addEventListener() {}, createElement: name => { if (name === 'audio') return new Audio(); throw Error(`Unexpected element ${name}`); } },
    window: { AudioContext, webkitAudioContext: AudioContext, SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition },
    fetch(url, request = {}) {
      const pending = deferred();
      requests.push({ url, request, ...pending });
      if (options.fetchHonorsAbort) request.signal?.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')));
      return pending.promise;
    },
  };
  const source = fs.readFileSync(file, 'utf8');
  if (/^\s*import\s/m.test(source)) throw Error('New head added imports: wire explicit local mocks before loading; no network module imports allowed.');
  vm.createContext(context);
  vm.runInContext(source.replace(/\bexport\s+(?=const|function|class)/g, '') + '\nglobalThis.voiceUnderTest = voice;', context, { filename: file });
  const voice = context.voiceUnderTest;
  return { voice, system, cloud, requests, recognizers, sessions, context,
    get now() { return now; }, get timerCount() { return timers.size; },
    finishSystem(index = system.length - 1) { system[index]?.onend?.(); },
    async advance(ms) {
      const until = now + ms;
      let count = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        if (++count > 1000) throw Error('Mock timer loop exceeded1000 callbacks');
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await Promise.resolve();
      }
      now = until; await Promise.resolve(); await Promise.resolve();
    },
    respond(index, payload, status = 200) { requests[index].resolve(new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })); },
  };
}

module.exports = { loadVoice, deferred };
