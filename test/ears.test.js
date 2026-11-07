// Runs the real VAD, transcription queue, released app handlers and voice parser.
// Audio, permission, clock and network are deterministic mocks; no device/API use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const earsSource = fs.readFileSync(new URL('../public/ears.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const voiceSource = fs.readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const handler = name => {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert(match, `actual app handler ${name} must exist`);
  return match[0];
};
const commandConstants = voiceSource.match(/^const (?:DONE|REPEAT|SKIP|REDO|WAKE|BARE) = .*;$/gm);
assert.equal(commandConstants?.length, 6, 'exercise all actual command expressions');
const commandHandler = voiceSource.match(/  handle\(text\) \{[\s\S]*?\n  \}/)?.[0].replace('  handle(text)', 'function handle(text)');
assert(commandHandler, 'actual voice parser must exist');
const flush = () => new Promise(resolve => setImmediate(resolve));

function clock() {
  let now = 5000, id = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimer(fn, delay) { const key = ++id; pending.set(key, { fn, at: now + delay }); return key; },
    clearTimer(key) { pending.delete(key); },
    size: () => pending.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]); now = next[1].at; next[1].fn(); await flush();
      }
      now = end; await flush();
    },
  };
}

function fixture(t, mode = 'guide', options = {}) {
  const timers = clock();
  const S = { mode, fields: [{ label: 'Name', answer: '', done: false }], i: 0, epoch: 1, lang: 'en', awaitQ: 0 };
  const processors = [], requests = [], answers = [], streams = [], permissions = [], said = [];
  let disconnects = 0, finishes = 0, nexts = 0, resumes = 0, fallbacks = 0;
  const makeStream = () => {
    const track = { stops: 0, stop() { this.stops++; } };
    const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream;
  };
  if (options.shared) S.mic = makeStream();
  const node = () => ({ connect(next) { return next; }, disconnect() { disconnects++; } });
  const ctx = { sampleRate: 16000, destination: {}, resume() { resumes++; return Promise.resolve(); },
    createMediaStreamSource() { if (options.failGraph) throw Error('audio graph failed'); return node(); },
    createScriptProcessor() { const proc = node(); processors.push(proc); return proc; },
    createGain() { return { ...node(), gain: { value: 1 } }; },
  };
  const voice = { ctx, onCommand: null, echo: () => false, stop() {}, earcon() {}, heard: true,
    unlock() {}, hear() { return { stop: async () => '' }; }, listen() { fallbacks++; } };
  const context = { S, voice, AbortController, app: { dataset: {} }, talk: { live: null, auto: 0 },
    URLSearchParams, location: { search: '' }, performance: { now: timers.now },
    navigator: { audioSession: { type: 'playback' }, mediaDevices: { async getUserMedia() {
      const stream = makeStream();
      if (options.deferPermission) await new Promise(resolve => permissions.push(resolve));
      return stream;
    } } },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch(url, init) {
      assert.equal(url, '/api/hear');
      const payload = JSON.parse(init.body); assert(payload.audio.length > 44);
      return new Promise(resolve => requests.push({ payload, resolve, signal: init.signal }));
    },
    setTimeout: timers.setTimer, clearTimeout: timers.clearTimer,
    setCue() {}, showHeard() {}, buzz() {}, $: () => ({ dataset: {}, setAttribute() {} }),
    t: () => ({ heardNothing: 'nothing heard', noEars: 'hold to ask', noMic: 'no mic' }),
    say(text) { said.push(text); return Promise.resolve(); }, answer: text => answers.push(text),
    finishWriting() { finishes++; }, redo() {}, repeat() {}, skip() {},
    readback: { hide() {} }, next() { nexts++; },
  };
  vm.createContext(context);
  vm.runInContext(earsSource + '\n' + commandConstants.join('\n') + '\n' + commandHandler
    + '\nvoice.handle=handle;\n'
    + ['onVoiceCommand', 'startEars', 'awaitQuestion', 'gotQuestion', 'talkStart', 'talkEnd', 'talkDone', 'keep'].map(handler).join('\n'), context);
  const feed = (level, proc = processors[0]) => proc.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) } });
  const phrase = (proc = processors[0]) => {
    for (let i = 0; i < 3; i++) feed(.1, proc);
    for (let i = 0; i < 6; i++) feed(0, proc);
  };
  const respond = async (index, text) => { requests[index].resolve({ ok: true, json: async () => ({ text }) }); await flush(); };
  const extraEars = [];
  const createEars = (overrides = {}) => {
    const ears = context.makeEars({ ctx, ignore: () => false, lang: () => 'en', onText() {}, ...overrides });
    extraEars.push(ears); return ears;
  };
  t.after(async () => {
    S.ears?.stop(); S.earsPending?.stop(); extraEars.forEach(ears => ears.stop());
    context.clearTimeout(context.talk.auto); await flush();
  });
  return { context, S, timers, processors, requests, answers, streams, permissions, said,
    phrase, feed, respond, ctx, createEars, makeStream,
    finishes: () => finishes, nexts: () => nexts, disconnects: () => disconnects,
    resumes: () => resumes, fallbacks: () => fallbacks };
}

test('writing completion captured before readback cannot Keep that later readback', async t => {
  const f = fixture(t, 'write'); await f.context.startEars(); f.phrase();
  f.S.mode = 'confirm'; await f.respond(0, 'finished');
  assert.equal(f.S.fields[0].done, false); assert.equal(f.nexts(), 0); assert.equal(f.finishes(), 0);
});

for (const change of ['epoch', 'field', 'index', 'lang', 'ptt']) {
  test(`pending audio is invalidated by a changed ${change}`, async t => {
    const f = fixture(t, 'write'); await f.context.startEars(); f.phrase();
    if (change === 'epoch') f.S.epoch++;
    if (change === 'field') f.S.fields = [{ label: 'Phone', done: false }];
    if (change === 'index') f.S.i++;
    if (change === 'lang') f.S.lang = 'es';
    if (change === 'ptt') f.S.earsPttGeneration = 2; // app owner's PTT hooks own this counter
    await f.respond(0, 'finished'); assert.equal(f.finishes(), 0);
  });
}

test('state is captured at speech onset, before the rest of its audio arrives', async t => {
  const f = fixture(t, 'write'); await f.context.startEars(); f.feed(.1); f.S.mode = 'confirm';
  for (let i = 0; i < 2; i++) f.feed(.1);
  for (let i = 0; i < 6; i++) f.feed(0);
  assert.equal(f.requests.length, 0); assert.equal(f.S.fields[0].done, false);
});

test('wake and already-captured follow-up are transcribed in capture order', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase(); f.phrase();
  assert.equal(f.requests.length, 1);
  await f.respond(0, 'Nib'); assert.equal(f.requests.length, 2);
  await f.respond(1, 'Where is the phone number?');
  assert.deepEqual(f.answers, ['Where is the phone number?']); assert.equal(f.S.awaitQ, 0);
});

test('a timely captured question survives the 8-second listening timer while ASR is pending', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase();
  await f.timers.advance(100); f.phrase(); await f.respond(0, 'Nib');
  await f.timers.advance(8100);
  assert(f.S.awaitQ, 'must retain the follow-up even after its listening deadline');
  assert.deepEqual(f.said, []);
  await f.respond(1, 'What does this field mean?');
  assert.deepEqual(f.answers, ['What does this field mean?']); assert.equal(f.S.awaitQ, 0);
});

test('a question started near the deadline is retained while its audio is still being captured', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase(); await f.respond(0, 'Nib');
  await f.timers.advance(7900); f.feed(.1); await f.timers.advance(200);
  assert(f.S.awaitQ, 'speech onset, rather than upload time, owns the listening deadline');
  f.feed(.1); f.feed(.1); for (let i = 0; i < 6; i++) f.feed(0);
  await f.respond(1, 'Where do I write?'); assert.deepEqual(f.answers, ['Where do I write?']);
});

test('wake and question in one phrase still bypass the separate follow-up window', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase();
  await f.respond(0, 'Hey Nib, what does this mean?');
  assert.deepEqual(f.answers, ['what does this mean?']); assert.equal(f.S.awaitQ, 0);
});

test('silence still ends the wake window; a later unrelated phrase is not its question', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase(); await f.respond(0, 'Nib');
  await f.timers.advance(8001);
  assert.equal(f.S.awaitQ, 0); assert.deepEqual(f.said, ['nothing heard']);
  f.phrase(); await f.respond(1, 'Where is the phone?'); assert.deepEqual(f.answers, []);
});

test('a stalled question cannot extend the wake wait indefinitely', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase(); f.phrase(); await f.respond(0, 'Nib');
  await f.timers.advance(18001);
  assert.equal(f.S.awaitQ, 0); assert.equal(f.requests[1].signal.aborted, true);
  await f.respond(1, 'late question'); assert.deepEqual(f.answers, []);
});

test('wake response arriving after a new session cannot open a question window', async t => {
  const f = fixture(t); await f.context.startEars(); f.phrase(); f.S.epoch++;
  await f.respond(0, 'Nib'); assert.equal(f.S.awaitQ, 0); assert.deepEqual(f.answers, []);
});

test('pending and active app startup reuse one microphone and processor', async t => {
  const f = fixture(t, 'guide', { deferPermission: true });
  const first = f.context.startEars(), second = f.context.startEars();
  assert.equal(f.streams.length, 1); f.permissions[0]();
  const [a, b] = await Promise.all([first, second]); assert.equal(a, b);
  await f.context.startEars(); assert.equal(f.streams.length, 1); assert.equal(f.processors.length, 1);
  f.phrase(); assert.equal(f.requests.length, 1);
});

test('shared camera audio is reused, its tracks survive listener stop, and iOS stays play-and-record', async t => {
  const f = fixture(t, 'guide', { shared: true }); await f.context.startEars();
  assert.equal(f.streams.length, 1); assert.equal(f.S.ears.stream, f.S.mic);
  assert.equal(f.context.navigator.audioSession.type, 'play-and-record'); assert.equal(f.context.voice.micOpen, true);
  assert.equal(f.resumes(), 1); f.S.ears.stop();
  assert.equal(f.streams[0].track.stops, 0); assert.equal(f.disconnects(), 3);
});

test('audio graph failure disconnects safely without stopping borrowed camera tracks', async t => {
  const f = fixture(t, 'guide', { shared: true, failGraph: true });
  assert.equal(await f.context.startEars(), null);
  assert.equal(f.streams[0].track.stops, 0); assert.equal(f.fallbacks(), 1);
});

test('stop releases owned audio, invalidates old callbacks and rejects late transcripts', async t => {
  const f = fixture(t, 'write'); await f.context.startEars(); f.phrase();
  const callback = f.processors[0].onaudioprocess; f.S.ears.stop();
  assert.equal(f.streams[0].track.stops, 1); assert.equal(f.disconnects(), 3);
  assert.equal(f.processors[0].onaudioprocess, null); assert.equal(f.S.ears.stream, null);
  callback({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(.1) } });
  await f.respond(0, 'finished'); assert.equal(f.finishes(), 0); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].signal.aborted, true);
});

test('permission resolving after stop releases owned tracks and never installs a processor', async t => {
  const f = fixture(t, 'write', { deferPermission: true });
  const pending = f.context.startEars(); f.S.earsPending.stop(); f.permissions[0]();
  assert.equal(await pending, null); assert.equal(f.streams[0].track.stops, 1);
  assert.equal(f.processors.length, 0); assert.equal(f.S.ears, null); assert.equal(f.fallbacks(), 0);
});

test('restart after stop works and successful custom ears retire browser recognition', async t => {
  const f = fixture(t); let aborted = 0; f.context.voice.rec = { abort() { aborted++; } };
  await f.context.startEars(); assert.equal(aborted, 1); assert.equal(f.context.voice.rec, null);
  f.S.ears.stop(); await f.context.startEars();
  assert.equal(f.streams.length, 2); assert.equal(f.streams[0].track.stops, 1); assert(f.S.ears.stream);
});

test('bounded queue retains the earliest follow-up and never reorders overflow', async t => {
  const f = fixture(t); const delivered = [], dropped = [];
  const ears = f.createEars({ onText: text => delivered.push(text), maxQueued: 2, onDrop: why => dropped.push(why) });
  const first = ears.start(), same = ears.start(); assert.equal(first, same); await first;
  for (let i = 0; i < 8; i++) f.phrase();
  assert.equal(f.requests.length, 1); assert.equal(dropped.length, 5);
  for (let i = 0; i < 3; i++) await f.respond(i, String(i));
  assert.deepEqual(delivered, ['0', '1', '2']); assert.equal(f.requests.length, 3);
});

test('deadline frees an abort-ignoring hung request and suppresses its late result', async t => {
  const f = fixture(t); const delivered = [], dropped = [];
  const ears = f.createEars({ onText: text => delivered.push(text), onDrop: why => dropped.push(why), requestTimeoutMs: 1234 });
  await ears.start(); f.phrase(); f.phrase(); await f.timers.advance(1234);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[0].signal.aborted, true);
  await f.respond(1, 'current'); await f.respond(0, 'stale');
  assert.deepEqual(delivered, ['current']); assert.deepEqual(dropped, ['transcription-timeout']);
  assert.equal(f.timers.size(), 0);
});

test('deadline also covers a hung response body', async t => {
  const f = fixture(t); const delivered = [];
  const ears = f.createEars({ onText: text => delivered.push(text), requestTimeoutMs: 2000 });
  await ears.start(); f.phrase(); f.phrase(); let release;
  f.requests[0].resolve({ ok: true, json: () => new Promise(resolve => { release = resolve; }) }); await flush();
  await f.timers.advance(2000); assert.equal(f.requests.length, 2);
  await f.respond(1, 'current'); release({ text: 'stale body' }); await flush();
  assert.deepEqual(delivered, ['current']); assert.equal(f.timers.size(), 0);
});

test('stop cancels its timer, request and queue without draining discarded audio', async t => {
  const f = fixture(t); const delivered = [];
  const ears = f.createEars({ onText: text => delivered.push(text) });
  await ears.start(); f.phrase(); f.phrase(); assert.equal(f.timers.size(), 1);
  ears.stop(); await flush(); assert.equal(f.timers.size(), 0); assert.equal(ears.busy, false);
  await f.respond(0, 'stale'); assert.deepEqual(delivered, []); assert.equal(f.requests.length, 1);
});

test('current completion still finishes writing, and fresh confirmation can Keep', async t => {
  const f = fixture(t, 'write'); await f.context.startEars(); f.phrase(); await f.respond(0, 'finished');
  assert.equal(f.finishes(), 1); assert.equal(f.S.fields[0].done, false);
  f.S.mode = 'confirm'; f.phrase(); await f.respond(1, 'done');
  assert.equal(f.S.fields[0].done, true); assert.equal(f.nexts(), 1);
});


test('actual upstream PTT start and end invalidate an earlier in-flight phrase', async t => {
  const f = fixture(t, 'write'); await f.context.startEars(); f.phrase();
  f.context.talkStart(); assert.equal(f.S.earsPttGeneration, 1);
  await f.context.talkEnd(); assert.equal(f.S.earsPttGeneration, 2);
  await f.respond(0, 'finished'); assert.equal(f.finishes(), 0);
});
