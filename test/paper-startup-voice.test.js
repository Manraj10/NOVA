// Actual startup, camera, ears and command handlers. All devices, models, audio
// and clocks are mocked. No permission dialogs or requests leave this process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('../public/app.js'), speech = read('../public/voice.js'), ears = read('../public/ears.js').replace(/^export /gm, '');
const fn = name => { const m = app.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`)); assert(m, name); return m[0]; };
const methods = ['echoSnapshot', 'echo', 'wake', 'navigation', 'handle'].map(name => {
  const m = speech.match(new RegExp(`  ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\},`)); assert(m, name); return m[0];
});
const constants = speech.match(/^const (?:DONE|REPEAT|SKIP|REDO|NAME|HEY|WAKE|BARE) = .*;$/gm);
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, initial = {}) {
  const flags = { ...initial }, media = [], pending = [], starts = [], configs = [], actions = [], says = [], processors = [], hears = [];
  let activeAudio = 0, maxAudio = 0, stopCalls = 0;
  class Stream {
    constructor(tracks = []) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(x => x.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(x => x.kind === 'video'); }
  }
  const track = kind => {
    if (kind === 'audio') { activeAudio++; maxAudio = Math.max(maxAudio, activeAudio); }
    return { kind, readyState: 'live', stop() { if (this.readyState !== 'ended') { this.readyState = 'ended'; if (kind === 'audio') activeAudio--; } }, getCapabilities: () => ({}) };
  };
  const node = () => ({ connect(next) { return next; }, disconnect() {} });
  const audio = { sampleRate: 16000, destination: {}, resume: () => Promise.resolve(),
    createMediaStreamSource: node, createGain: () => ({ ...node(), gain: { value: 1 } }),
    createScriptProcessor() { const n = node(); processors.push(n); return n; },
  };
  const S = { mode: 'start', epoch: 1, lang: 'en', fields: [], i: 0, sim: null };
  const nodes = new Map(); const $ = key => {
    if (!nodes.has(key)) nodes.set(key, { value: '', hidden: false, setAttribute() {}, classList: { add() {}, remove() {} } });
    return nodes.get(key);
  };
  const video = { srcObject: null, play() { return flags.deferPlay ? new Promise(resolve => pending.push({ kind: 'play', resolve })) : Promise.resolve(); } };
  const voice = { ctx: audio, speaking: false, endedAt: -10000, recent: [], heard: true, unlock() {}, earcon() {},
    stop() { stopCalls++; }, say() { return Promise.resolve(); }, listen() { actions.push('fallback'); },
    hear() { let resolve; const text = new Promise(yes => { resolve = yes; }); const live = { stop: () => text }; hears.push({ live, resolve }); return live; } };
  const context = { S, voice, video, PHONE: false, innerWidth: 1000, innerHeight: 800, MediaStream: Stream,
    URLSearchParams, AbortController, location: { search: '', assign(path) { actions.push('nav:' + path); } },
    app: { dataset: {} }, talk: { live: null, auto: 0 }, $, performance: { now: () => 5000 },
    navigator: { audioSession: {}, mediaDevices: { getUserMedia(options) {
      media.push(options);
      if (options.video && flags.denyCamera) return Promise.reject(Object.assign(Error('camera denied'), { name: 'NotAllowedError' }));
      const acquire = () => new Stream([...(options.audio ? [track('audio')] : []), ...(options.video ? [track('video')] : [])]);
      if ((options.video && flags.deferCamera) || (!options.video && flags.deferAudio)) {
        if (options.video) flags.deferCamera = false; else flags.deferAudio = false;
        return new Promise((resolve, reject) => pending.push({ kind: options.video ? 'camera' : 'audio', reject, resolve: () => resolve(acquire()) }));
      }
      return Promise.resolve(acquire());
    } } },
    setTimeout: () => 1, clearTimeout() {}, renderSessionContext() {}, setCue() {}, showHeard() {}, buzz() {},
    listCameras: async () => {}, stayAwake() {}, warmVoice() {}, cameraFail() { actions.push('camera-error'); },
    setMode(mode) { S.mode = mode; }, readForm: async () => { actions.push('read-form'); S.mode = 'guide'; S.epoch++; },
    again() { actions.push('reread'); },
    say(text, options) { says.push({ text, options }); return Promise.resolve(); }, t: () => ({ noCamera: 'camera unavailable', noEars: 'ears unavailable' }),
    snapshot: () => 'test', api() { throw Error('local control must not use a model'); }, speakErr(e) { actions.push('error:' + e.message); },
    finishWriting() { actions.push('finish'); }, keep() { actions.push('keep'); }, redo() {}, repeat() {}, skip() {}, back() {}, abortFind() {}, act(out) { actions.push('act:' + out.action); },
    penPoint() { throw Error('paused line guide must not inspect geometry'); },
    btoa: value => Buffer.from(value, 'binary').toString('base64'), fetch() { throw Error('no real transcription request expected'); },
    observedConfig: config => configs.push(config),
  };
  vm.createContext(context);
  vm.runInContext(ears + '\nconst originalMakeEars=makeEars; makeEars=options=>{observedConfig(options);return originalMakeEars(options);};\n'
    + constants.join('\n') + '\nObject.assign(voice,{\n' + methods.join('\n') + '\n});\n'
    + ['startCamera', 'begin', 'onVoiceCommand', 'startEars', 'awaitQuestion', 'gotQuestion', 'talkStart', 'talkEnd', 'talkDone', 'answer', 'localAnswer', 'keepLine'].map(fn).join('\n'), context);
  const originalBegin = context.begin;
  context.begin = (...args) => { const p = originalBegin(...args); starts.push(p); return p; };
  const capture = () => configs.at(-1).onCapture();
  const deliver = (text, token = capture()) => {
    const c = configs.at(-1);
    if (!c.ignore() && c.isCurrent(token)) c.onText(text, token);
  };
  t.after(async () => { S.cameraStarting?.cancel?.(); S.ears?.stop(); S.earsPending?.stop(); for (const x of S.mic?.getTracks() || []) x.stop(); await flush(); });
  return { context, S, flags, media, pending, starts, configs, actions, says, processors, hears, deliver, capture,
    activeAudio: () => activeAudio, maxAudio: () => maxAudio, stopCalls: () => stopCalls };
}

test('camera denial still starts one audio-only global controller after Start', async t => {
  const f = fixture(t, { denyCamera: true }); await f.context.begin(); await flush();
  assert.equal(f.S.mode, 'start'); assert(f.S.ears?.stream); assert.equal(f.activeAudio(), 1); assert.equal(f.maxAudio(), 1);
  f.deliver('Nib'); assert.equal(f.context.app.dataset.talk, 'listening');
  f.deliver('Help'); assert.match(f.says.at(-1).text, /camera is not ready/); assert.equal(f.says.at(-1).options.system, true);
  f.deliver('Hey Nib, home'); assert(f.actions.includes('nav:./')); assert.equal(f.activeAudio(), 0);
});

test('retry retires audio fallback before starting one combined camera capture', async t => {
  const f = fixture(t, { denyCamera: true }); await f.context.begin(); await flush();
  const fallback = f.S.ears; f.flags.denyCamera = false; f.deliver('Hey Nib, retry');
  await f.starts.at(-1); await flush();
  assert.equal(fallback.stream, null); assert(f.actions.includes('read-form')); assert.equal(f.S.mode, 'guide');
  assert(f.S.ears?.stream); assert.equal(f.S.ears.stream, f.S.mic); assert.equal(f.activeAudio(), 1); assert.equal(f.maxAudio(), 1);
});

test('repeated Start during pending permission opens only one camera capture', async t => {
  const f = fixture(t, { deferCamera: true }); const first = f.context.begin(); await f.context.begin();
  assert.equal(f.media.length, 1); f.pending[0].resolve(); await first; await flush(); assert.equal(f.maxAudio(), 1);
});

test('navigation cancels late camera permission before it can attach or start a listener', async t => {
  const f = fixture(t, { deferCamera: true }); const first = f.context.begin();
  f.context.onVoiceCommand('nav', 'home'); f.pending[0].resolve(); await first; await flush();
  assert.equal(f.activeAudio(), 0); assert.equal(f.context.video.srcObject, null);
  assert(!f.actions.includes('read-form')); assert.equal(f.configs.length, 0); assert.equal(f.S.cameraStarting, null);
});

test('navigation immediately releases camera tracks while video.play is still pending', async t => {
  const f = fixture(t, { deferPlay: true }); const first = f.context.begin(); await flush();
  assert.equal(f.activeAudio(), 1); f.context.onVoiceCommand('nav', 'home');
  assert.equal(f.activeAudio(), 0); assert.equal(f.context.video.srcObject, null);
  f.pending.find(x => x.kind === 'play').resolve(); await first; assert(!f.actions.includes('read-form'));
});

test('navigation rejects a late audio-only grant without resurrecting a controller', async t => {
  const f = fixture(t, { denyCamera: true, deferAudio: true }); await f.context.begin();
  f.context.onVoiceCommand('nav', 'home'); f.pending.find(x => x.kind === 'audio').resolve(); await flush();
  assert.equal(f.activeAudio(), 0); assert.equal(f.S.ears, null); assert.equal(f.processors.length, 0);
});

test('retry waits out an uncancellable audio permission before requesting another mic', async t => {
  const f = fixture(t, { denyCamera: true, deferAudio: true }); await f.context.begin();
  f.flags.denyCamera = false; const before = f.media.length; const retried = f.context.begin(); await flush();
  assert.equal(f.media.length, before, 'new camera request waits for old permission cleanup');
  f.pending.find(x => x.kind === 'audio').resolve(); await retried; await flush();
  assert.equal(f.maxAudio(), 1); assert(f.S.ears?.stream); assert.equal(f.S.ears.stream, f.S.mic);
});

test('startup does not accept relative Done or Keep as form completion', async t => {
  const f = fixture(t); await f.context.startEars(); f.deliver('done'); f.deliver('Hey Nib, done');
  assert(!f.actions.includes('finish')); assert(!f.actions.includes('keep'));
  assert.match(f.says.at(-1).text, /camera is not ready/);
});

test('generic inline wake interrupts speech before its question reaches the ordinary handler', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide'; f.S.fields = [{ label: 'Name' }];
  f.context.api = () => { assert(f.stopCalls() > 0); f.actions.push('question'); return new Promise(() => {}); };
  f.deliver('Nib, what does this mean?'); assert(f.actions.includes('question'));
});

test('pause survives talkDone and resume restores guidance without a loop rewrite', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide';
  f.deliver('Hey Nib, stop'); assert.equal(f.S.voicePaused, true); assert.equal(f.context.app.dataset.talk, 'paused');
  f.context.talkDone(); assert.equal(f.context.app.dataset.talk, 'paused'); f.context.keepLine(5000);
  f.deliver('resume'); assert.equal(f.S.voicePaused, false); assert.equal(f.context.app.dataset.talk, undefined); assert.equal(f.S.arrivedSince, 0);
});

test('stale retry cannot start a camera in a newer mode', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'idle'; const token = f.capture(); f.S.mode = 'start';
  const before = f.media.length; f.deliver('retry', token); await flush(); assert.equal(f.media.length, before);
});
test('stale resume cannot unpause a newer field or mode', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide'; f.S.voicePaused = true;
  const token = f.capture(); f.S.mode = 'write'; f.deliver('resume', token); assert.equal(f.S.voicePaused, true);
});
test('unknown startup conversation and field commands do not become form actions', async t => {
  const f = fixture(t); await f.context.startEars(); f.deliver('someone is talking about dinner'); f.deliver('done'); f.deliver('yes');
  assert.deepEqual(f.actions, []); assert.deepEqual(f.says, []);
});
test('an inline wake inside an open window is stripped exactly once', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide';
  const questions = []; f.context.api = (path, body) => { questions.push(body.question); return new Promise(() => {}); };
  f.deliver('Nib'); f.deliver('Hey Nib, what does this mean?'); assert.deepEqual(questions, ['what does this mean?']);
});
test('stop invalidates both a pending answer action and its late error', async t => {
  for (const failed of [false, true]) {
    const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide';
    let resolve, reject; f.context.api = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    f.deliver('Hey Nib, explain this'); f.deliver('stop');
    if (failed) reject(Error('old request')); else resolve({ action: 'skip' }); await flush();
    assert.equal(f.context.app.dataset.talk, 'paused'); assert.deepEqual(f.actions, []);
  }
});
test('the newer question wins when same-session model replies arrive in reverse order', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide'; const requests = [];
  f.context.api = () => new Promise(resolve => requests.push(resolve));
  f.deliver('Hey Nib, first question'); f.deliver('Hey Nib, second question');
  requests[1]({ action: 'newer' }); await flush(); requests[0]({ action: 'older' }); await flush();
  assert.deepEqual(f.actions, ['act:newer']);
});
test('navigation invalidates a pending model response before it can act', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'guide'; let resolve;
  f.context.api = () => new Promise(yes => { resolve = yes; });
  f.deliver('Hey Nib, explain this'); f.deliver('home'); resolve({ action: 'skip' }); await flush();
  assert.deepEqual(f.actions, ['nav:./']); assert.equal(f.activeAudio(), 0);
});

test('late microphone denial after navigation cannot announce failure or restart browser recognition', async t => {
  const f = fixture(t, { denyCamera: true, deferAudio: true }); await f.context.begin();
  f.context.onVoiceCommand('nav', 'home'); const before = f.says.length;
  f.pending.find(x => x.kind === 'audio').reject(Object.assign(Error('late denial'), { name: 'NotAllowedError' }));
  await flush();
  assert.deepEqual(f.actions, ['camera-error', 'nav:./']); assert.equal(f.says.length, before);
  assert.equal(f.S.ears, null); assert.equal(f.context.voice.micOpen, false);
});
test('a current microphone denial still enables the existing browser fallback', async t => {
  const f = fixture(t, { deferAudio: true }); const pending = f.context.startEars();
  f.pending[0].reject(Object.assign(Error('current denial'), { name: 'NotAllowedError' })); await pending;
  assert.deepEqual(f.actions, ['fallback']); assert.equal(f.says.at(-1).text, 'ears unavailable');
});
test('late denied fallback permission during retry cannot start a second recognizer', async t => {
  const f = fixture(t, { denyCamera: true, deferAudio: true }); await f.context.begin();
  f.flags.denyCamera = false; const retry = f.context.begin();
  f.pending.find(x => x.kind === 'audio').reject(Object.assign(Error('retired denial'), { name: 'NotAllowedError' }));
  await retry; await flush(); assert(!f.actions.includes('fallback')); assert(f.S.ears?.stream); assert.equal(f.maxAudio(), 1);
});

for (const [mode, words, expected] of [['write', 'done', 'finish'], ['confirm', 'keep', 'keep']])
test(`current PTT ${words} in ${mode} still acts after release`, async t => {
  const f = fixture(t); f.S.mode = mode; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const pending = f.context.talkEnd(); f.hears[0].resolve(words); await pending;
  assert.deepEqual(f.actions, [expected]);
});
for (const at of ['before release', 'after release']) test(`PTT Done from writing cannot Keep a newer readback: ${at}`, async t => {
  const f = fixture(t); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }]; f.context.talkStart();
  if (at === 'before release') f.S.mode = 'confirm';
  const pending = f.context.talkEnd(); if (at === 'after release') f.S.mode = 'confirm';
  f.hears[0].resolve('done'); await pending; assert.deepEqual(f.actions, []);
});
test('PTT from a previous field cannot act on a later field', async t => {
  const f = fixture(t); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }, { label: 'Phone' }];
  f.context.talkStart(); const pending = f.context.talkEnd(); f.S.i = 1; f.hears[0].resolve('done'); await pending;
  assert.deepEqual(f.actions, []);
});
test('a newer Ask stays thinking when an older PTT transcript arrives', async t => {
  const f = fixture(t); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const pending = f.context.talkEnd(); let resolve;
  f.context.api = () => new Promise(yes => { resolve = yes; }); f.context.onVoiceCommand('ask', 'new question');
  f.hears[0].resolve('done'); await pending;
  assert.equal(f.context.app.dataset.talk, 'thinking'); assert.deepEqual(f.actions, []);
  resolve({ action: 'newer' }); await flush(); assert.deepEqual(f.actions, ['act:newer']);
});
test('a newer bare-wake window survives an older PTT transcript', async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const pending = f.context.talkEnd(); f.context.onVoiceCommand('ask', '');
  const wake = f.S.awaitQContext; f.hears[0].resolve('done'); await pending;
  assert.equal(f.S.awaitQContext, wake); assert.equal(f.context.app.dataset.talk, 'listening'); assert.deepEqual(f.actions, []);
});
for (const action of ['stop', 'nav']) test(`${action} invalidates a late PTT transcript without changing its newer UI`, async t => {
  const f = fixture(t); await f.context.startEars(); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const pending = f.context.talkEnd();
  if (action === 'nav') f.context.onVoiceCommand('nav', 'home'); else f.S.paperControl('stop');
  f.hears[0].resolve('done'); await pending;
  assert.deepEqual(f.actions, action === 'nav' ? ['nav:./'] : []);
  if (action === 'stop') assert.equal(f.context.app.dataset.talk, 'paused');
});
test('exact current-session PTT navigation remains global across a field transition', async t => {
  const f = fixture(t); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const pending = f.context.talkEnd(); f.S.mode = 'confirm'; f.hears[0].resolve('Hey Nib, home'); await pending;
  assert.deepEqual(f.actions, ['nav:./']);
});
test('a newer PTT capture supersedes the old released transcript', async t => {
  const f = fixture(t); f.S.mode = 'write'; f.S.fields = [{ label: 'Name' }];
  f.context.talkStart(); const old = f.context.talkEnd(); f.context.talkStart();
  f.hears[0].resolve('done'); await old; assert.deepEqual(f.actions, []); assert.equal(f.context.app.dataset.talk, 'listening');
  const current = f.context.talkEnd(); f.hears[1].resolve('done'); await current; assert.deepEqual(f.actions, ['finish']);
});
