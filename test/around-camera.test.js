import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { makeAroundCamera } from '../public/around-camera.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function track(kind, id, extra = {}) {
  const values = { deviceId: id, width: 1440, height: 1920, ...extra.settings }, calls = [], listeners = {};
  return { kind, label: extra.label || id, readyState: 'live', stops: 0, calls, listeners,
    getSettings: () => ({ ...values }), getCapabilities: () => extra.caps || {},
    addEventListener(name, fn) { listeners[name] = fn; },
    stop() { this.stops++; this.readyState = 'ended'; },
    async applyConstraints(c) { calls.push(c); if (extra.apply) return extra.apply(c, values);
      for (const [key, value] of Object.entries(c.advanced?.[0] || {})) values[key] = value;
      if (c.width) values.width = c.width.ideal; if (c.height) values.height = c.height.ideal;
    } };
}
const stream = tracks => ({ getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio') });
function fixture({ devices = [], script, base, portrait = true, playError = false } = {}) {
  const videoTrack = base || track('video', 'main'), mic = track('audio', 'mic');
  const requests = [], order = [], captures = [], video = { srcObject: null, pauses: 0, plays: 0,
    pause() { this.pauses++; }, async play() { this.plays++; if (playError) throw Error('play failed'); } };
  let tall = portrait;
  const steps = script ? [...script] : [stream([videoTrack, mic])];
  const mediaDevices = { async enumerateDevices() { order.push('enumerate'); return devices; },
    async getUserMedia(c) { order.push('capture'); requests.push(c); const next = steps.shift(); if (next instanceof Error) throw next;
      const value = await (typeof next === 'function' ? next(c) : next);
      if (!value) throw Error('unexpected capture'); captures.push(value); return value;
    } };
  const changes = [], options = { video, phone: true, portrait: () => tall, mediaDevices, createStream: stream, onChange: i => changes.push(i) };
  const camera = makeAroundCamera(options);
  return { camera, options, video, videoTrack, mic, requests, order, changes, captures, steps, setPortrait: value => { tall = value; } };
}

test('one initial camera+mic request preserves portrait ideals and concurrent startup', async () => {
  const f = fixture(), first = f.camera.start(), second = f.camera.start(); assert.equal(first, second);
  const capture = await first; assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].video.width.ideal, 1440); assert.equal(f.requests[0].video.height.ideal, 1920);
  assert.equal(f.requests[0].video.aspectRatio.ideal, 3 / 4); assert.equal(capture.micStream.getAudioTracks()[0], f.mic);
  assert.deepEqual(f.order, ['capture', 'enumerate']); assert.equal(f.video.srcObject.getTracks().length, 1);
});

test('ultra-wide selection requires confirmed device settings and keeps the original microphone', async () => {
  const main = track('video', 'main'), mic = track('audio', 'mic'), wide = track('video', 'wide');
  const f = fixture({ devices: [{ kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }], script: [stream([main, mic]), stream([wide])] });
  const capture = await f.camera.start();
  assert.equal(capture.lens, 'ultra wide'); assert.equal(capture.verifiedDevice, true);
  assert.equal(f.requests[1].video.deviceId.exact, 'wide'); assert.equal(f.requests[1].audio, false);
  assert.equal(main.readyState, 'ended'); assert.equal(mic.stops, 0); assert.equal(capture.micStream.getAudioTracks()[0], mic);
  assert.equal(capture.fieldOfViewKnown, false);
});

test('an already-selected ultra-wide device needs no second acquisition', async () => {
  const f = fixture({ base: track('video', 'wide'), devices: [{ kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }] });
  assert.equal((await f.camera.start()).verifiedDevice, true); assert.equal(f.requests.length, 1);
});

test('a front-facing camera cannot retain an ultra-wide confirmation from its label', async () => {
  const f = fixture({ base: track('video', 'wide', { settings: { facingMode: 'user' } }),
    devices: [{ kind: 'videoinput', deviceId: 'wide', label: 'Camera 0.5x' }] });
  const capture = await f.camera.start(); assert.equal(capture.lens, 'front'); assert.equal(capture.verifiedDevice, false);
});

test('ignored exact device selection is not mislabeled; rejected video is stopped and main reacquired', async () => {
  const main = track('video', 'main'), mic = track('audio', 'mic'), wrong = track('video', 'wrong'), fallback = track('video', 'main');
  const f = fixture({ devices: [{ kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }],
    script: [stream([main, mic]), stream([wrong]), stream([fallback])] });
  const capture = await f.camera.start(); assert.equal(capture.lens, 'main'); assert.equal(capture.verifiedDevice, false);
  assert.equal(wrong.readyState, 'ended'); assert.equal(mic.stops, 0); assert.equal(f.requests[2].video.deviceId.exact, 'main');
});

test('unavailable ultra-wide safely falls back to main video without acquiring another mic', async () => {
  const main = track('video', 'main'), mic = track('audio', 'mic'), fallback = track('video', 'main');
  const f = fixture({ devices: [{ kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }],
    script: [stream([main, mic]), Error('exclusive capture unavailable'), stream([fallback])] });
  assert.equal((await f.camera.start()).lens, 'main'); assert(f.requests.slice(1).every(r => r.audio === false)); assert.equal(mic.stops, 0);
});

test('minimum zoom and supported continuous modes are individually applied and checked', async () => {
  const main = track('video', 'main', { settings: { zoom: 1 }, caps: { zoom: { min: .5, max: 3, step: .1 },
    focusMode: ['manual', 'continuous'], exposureMode: ['continuous'], whiteBalanceMode: ['continuous'] },
    apply(c, values) { const [key, value] = Object.entries(c.advanced[0])[0]; if (key === 'focusMode') throw Error('optional focus failed'); values[key] = value; } });
  const f = fixture({ base: main }), capture = await f.camera.start();
  assert.equal(capture.lens, 'zoom 0.5×'); assert.equal(capture.verifiedDevice, false);
  assert.deepEqual(main.calls.map(c => Object.keys(c.advanced[0])[0]), ['focusMode', 'exposureMode', 'whiteBalanceMode', 'zoom']);
});

test('a silently ignored zoom constraint cannot claim 0.5×', async () => {
  const f = fixture({ base: track('video', 'main', { settings: { zoom: 1 }, caps: { zoom: { min: .5 } }, apply() {} }) });
  assert.equal((await f.camera.start()).lens, 'main');
});

test('audio denial can fall back to video, without retrying a superseded permission request', async () => {
  const video = track('video', 'main'); const f = fixture({ script: [Error('audio denied'), stream([video])] });
  const capture = await f.camera.start(); assert.equal(capture.micStream, null); assert.equal(f.requests[1].audio, false);
});

test('late initial permission after stop releases every acquired track without showing it', async () => {
  const later = deferred(), video = track('video', 'main'), mic = track('audio', 'mic'), f = fixture({ script: [later.promise] });
  const pending = f.camera.start(); f.camera.stop(); later.resolve(stream([video, mic]));
  await assert.rejects(pending, e => e.name === 'AbortError'); assert.equal(video.readyState, 'ended'); assert.equal(mic.readyState, 'ended');
  assert.equal(f.video.srcObject, null); assert.equal(f.changes.length, 0);
});

test('an old late permission cannot stop or replace a newer capture', async () => {
  const old = deferred(), stale = track('video', 'stale'), staleMic = track('audio', 'staleMic'), current = track('video', 'current'), currentMic = track('audio', 'currentMic');
  const f = fixture({ script: [old.promise, stream([current, currentMic])] });
  const first = f.camera.start(); f.camera.stop(); await f.camera.start(); old.resolve(stream([stale, staleMic]));
  await assert.rejects(first, e => e.name === 'AbortError'); assert.equal(current.readyState, 'live'); assert.equal(currentMic.readyState, 'live');
  assert.equal(f.camera.track, current); assert.equal(stale.readyState, 'ended');
});

test('playback failure cleans new camera and microphone tracks', async () => {
  const f = fixture({ playError: true }); await assert.rejects(f.camera.start(), /play failed/);
  assert.equal(f.videoTrack.readyState, 'ended'); assert.equal(f.mic.readyState, 'ended'); assert.equal(f.camera.live, false);
});

test('background video recovery preserves one live mic and uses a video-only capture', async () => {
  const f = fixture(); const first = await f.camera.start(); f.camera.suspend(); assert.equal(f.mic.stops, 0);
  const next = track('video', 'main'); f.steps.push(stream([next])); const second = await f.camera.recover();
  assert.equal(second.micStream, first.micStream); assert.equal(f.requests[1].audio, false); assert.equal(f.mic.stops, 0);
  f.camera.stop(); assert.equal(f.mic.readyState, 'ended'); assert.equal(next.readyState, 'ended');
});

test('orientation recovery updates portrait constraints without another stream or listener', async () => {
  const f = fixture(); await f.camera.start(); f.setPortrait(false); await f.camera.recover();
  assert.equal(f.requests.length, 1); assert.equal(f.videoTrack.calls.at(-1).width.ideal, 1920);
  assert.equal(f.videoTrack.calls.at(-1).height.ideal, 1440);
});

test('a dead microphone is replaced with a new combined capture instead of reusing a dead stream', async () => {
  const f = fixture(); await f.camera.start(); f.mic.stop();
  const video = track('video', 'replacement'), audio = track('audio', 'replacementMic'); f.steps.push(stream([video, audio]));
  const capture = await f.camera.recover();
  assert.notEqual(capture.micStream.getAudioTracks()[0], f.mic); assert.equal(capture.audioLive, true);
  assert.equal(typeof f.requests[1].audio, 'object'); assert.equal(f.videoTrack.readyState, 'ended');
});

test('retrying a live camera replays it without another permission request', async () => {
  const f = fixture(); await f.camera.start(); const before = f.video.plays;
  await f.camera.start(); assert.equal(f.video.plays, before + 1); assert.equal(f.requests.length, 1);
});

test('torch is capability gated, setting verified, and never applies after the camera is stopped', async () => {
  const f = fixture({ base: track('video', 'main', { caps: { torch: true }, settings: { torch: false } }) }); await f.camera.start();
  assert.deepEqual(await f.camera.setTorch(true), { supported: true, enabled: true, verified: true });
  assert.deepEqual(await f.camera.setTorch(false), { supported: true, enabled: false, verified: true });
  f.camera.stop(); assert.deepEqual(await f.camera.setTorch(true), { supported: false, enabled: null, verified: false });
  const no = fixture(); await no.camera.start(); assert.equal((await no.camera.setTorch(true)).supported, false);
});

test('a torch request with no returned setting does not claim success', async () => {
  const f = fixture({ base: track('video', 'main', { caps: { torch: true }, apply() {} }) }); await f.camera.start();
  assert.deepEqual(await f.camera.setTorch(true), { supported: true, enabled: null, verified: false });
});

// Run the actual startEars() + makeEars() and exposed getter alongside the
// released camera helpers. Only the media graph, permission and network are mocks.
function appFixture({ failFirst = false, deferStart = null } = {}) {
  const f = fixture(), events = {}, docEvents = {}, loops = [], listeners = [], processors = [], requests = [], nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: '', setAttribute() {}, focus() {} }); return nodes.get(id); };
  const source = fs.readFileSync(new URL('../public/around-app.js', import.meta.url), 'utf8');
  const handler = name => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
  const helpers = source.slice(source.indexOf('// Camera owns capture tracks;'), source.indexOf('// ---------- instant news'));
  const exposure = source.match(/let earsRef = null;[^\n]*\nwindow\.nibAround = .*;/)[0];
  const node = () => ({ connect(next) { return next; }, disconnect() {} });
  const audio = { sampleRate: 16000, destination: {}, createMediaStreamSource: node,
    createScriptProcessor() { const p = node(); processors.push(p); return p; }, createGain: () => ({ ...node(), gain: { value: 0 } }) };
  let starts = 0;
  const scope = { video: f.video, PHONE: true, running: false, gen: 0, lens: 'main', fov: 50, around: {}, queue: [], START: 'Around me.',
    voice: { ctx: audio, unlock() {}, say: async () => {}, stop() {}, earcon() {}, micOpen: false,
      echoSnapshot: () => ({}), echo: () => false, wake: () => null, navigation: () => null },
    warmVoice() {}, onOrient() {}, performance: { now: () => 5000 }, AbortController,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    makeAroundCamera: options => makeAroundCamera({ ...f.options, ...options, onChange: options.onChange }),
    $: get, document: { hidden: false, addEventListener(name, fn) { docEvents[name] = fn; } },
    window: {}, navigator: {}, location: { href: 'https://nib.test/around.html' }, addEventListener(name, fn) { events[name] = fn; }, setTimeout, clearTimeout,
    loop: n => loops.push(n), eyesReady: Promise.resolve(), requestAnimationFrame() {}, watch() {}, speakQueue() {},
    askAbout() {}, tellScene() {}, tellAll() {}, heading: null, scene: '', eyes: null, seen: [],
    fetch(url, init) { const response = deferred(); requests.push({ url, init, ...response }); return response.promise; },
  };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(new URL('../public/ears.js', import.meta.url), 'utf8').replace(/^export /gm, ''), scope);
  const actualMakeEars = scope.makeEars;
  scope.makeEars = options => {
    const ears = actualMakeEars(options), start = ears.start;
    ears.start = async mic => {
      starts++;
      if (failFirst && starts === 1) { ears.stop(); throw Error('audio graph unavailable'); }
      const started = await start(mic);
      if (deferStart) await deferStart.promise;
      return started;
    };
    listeners.push(ears); return ears;
  };
  vm.runInContext(handler('start') + '\n' + helpers + '\n' + handler('startEars') + '\n' + handler('command') + '\n'
    + exposure + '\nlet askUntil=0;this.beginCamera=start;this.cameraUnderTest=camera;this.readCameraBinding=()=>({bound:cameraBoundMic,ears:cameraEars});', scope);
  const phrase = (processor = processors.at(-1)) => {
    for (let i = 0; i < 3; i++) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(.1) } });
    for (let i = 0; i < 6; i++) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048) } });
  };
  return { ...f, scope, events, docEvents, listeners, loops, nodes, processors, requests, phrase,
    respond: async (index, text) => { requests[index].resolve({ ok: true, json: async () => ({ text }) }); await new Promise(resolve => setImmediate(resolve)); } };
}

test('actual app listener is retained, lens status is exposed, and pagehide stops capture and its queue', async () => {
  const f = appFixture(); const a = f.scope.beginCamera(), b = f.scope.beginCamera(); assert.equal(a, b); await a;
  assert.equal(f.listeners.length, 1); assert.equal(f.requests.length, 0); assert.equal(f.nodes.get('cameraLens').hidden, false);
  assert.equal(f.scope.window.nibAround.ears, f.listeners[0]); assert.equal(f.listeners[0].stream, f.scope.cameraUnderTest.micStream);
  f.events.pagehide(); assert.equal(f.listeners[0].stream, null); assert.equal(f.processors[0].onaudioprocess, null);
  assert.equal(f.mic.readyState, 'ended'); assert.equal(f.scope.running, false);
});

test('background stops the actual ears and restores exactly one listener on the retained microphone', async () => {
  const f = appFixture(); await f.scope.beginCamera(); const mic = f.scope.cameraUnderTest.micStream;
  f.scope.document.hidden = true; f.docEvents.visibilitychange();
  assert.equal(f.listeners[0].stream, null); assert.equal(f.mic.readyState, 'live');
  const next = track('video', 'main'); f.steps.push(stream([next]));
  f.scope.document.hidden = false; f.docEvents.visibilitychange(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.listeners.length, 2); assert.equal(f.listeners.filter(ears => ears.stream).length, 1);
  assert.equal(f.listeners[1].stream, mic); assert.equal(f.requests.length, 0); assert.equal(f.scope.running, true);
});

test('a pending actual ASR start command cannot restart scene loops while hidden or after restore', async () => {
  const f = appFixture(); await f.scope.beginCamera(); f.phrase(); assert.equal(f.requests.length, 1);
  f.scope.document.hidden = true; f.docEvents.visibilitychange();
  assert.equal(f.requests[0].init.signal.aborted, true); assert.equal(f.scope.running, false);
  await f.respond(0, 'start'); assert.equal(f.scope.running, false); assert.equal(f.loops.length, 1);
  f.steps.push(stream([track('video', 'main')])); f.scope.document.hidden = false; f.docEvents.visibilitychange();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.loops.length, 2); assert.equal(f.scope.running, true);
});

test('pagehide during permission cancels startup and late tracks cannot resume the app', async () => {
  const f = appFixture(), late = deferred(), video = track('video', 'late'), audio = track('audio', 'lateMic');
  f.steps.splice(0, 1, late.promise); const pending = f.scope.beginCamera(); f.events.pagehide(); late.resolve(stream([video, audio])); await pending;
  assert.equal(f.listeners.length, 0); assert.equal(f.loops.length, 0); assert.equal(video.readyState, 'ended'); assert.equal(audio.readyState, 'ended');
});

test('failed actual listener startup can retry the same mic without falsely binding it', async () => {
  const f = appFixture({ failFirst: true }); await f.scope.beginCamera();
  assert.equal(f.scope.readCameraBinding().bound, null); assert.equal(f.scope.readCameraBinding().ears, null);
  await f.scope.bindCameraMic(f.scope.cameraUnderTest.micStream, 0);
  assert.equal(f.listeners.length, 2); assert.equal(f.listeners.filter(ears => ears.stream).length, 1);
  assert.equal(f.scope.readCameraBinding().bound, f.scope.cameraUnderTest.micStream);
});

test('pagehide cancels pending actual listener startup and stops its late exposed controller', async () => {
  const later = deferred(), f = appFixture({ deferStart: later });
  const pending = f.scope.beginCamera(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.listeners.length, 1);
  f.events.pagehide(); later.resolve(); await pending;
  assert.equal(f.listeners[0].stream, null); assert.equal(f.processors[0].onaudioprocess, null);
  assert.equal(f.scope.readCameraBinding().bound, null); assert.equal(f.loops.length, 0); assert.equal(f.mic.readyState, 'ended');
});

test('overlapping same-mic binds share one actual listener startup', async () => {
  const later = deferred(), f = appFixture({ deferStart: later }), mic = stream([f.mic]);
  const a = f.scope.bindCameraMic(mic, 0), b = f.scope.bindCameraMic(mic, 0);
  assert.equal(f.listeners.length, 1); later.resolve(); await Promise.all([a, b]);
  assert.equal(f.listeners.length, 1); assert.equal(f.scope.readCameraBinding().ears, f.listeners[0]);
});
