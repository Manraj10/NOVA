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
    renderSessionContext() {}, setCue() {}, showHeard() {}, buzz() {}, $: () => ({ dataset: {}, setAttribute() {} }),
    t: () => ({ heardNothing: 'nothing heard', noEars: 'hold to ask', noMic: 'no mic' }),
    say(text) { said.push(text); return Promise.resolve(); }, answer: text => answers.push(text),
    finishWriting() { finishes++; }, redo() {}, repeat() {}, skip() {},
    readback: { hide() {} }, next() { nexts++; },
  };
  vm.createContext(context);
  vm.runInContext(earsSource + '\n' + commandConstants.join('\n') + '\n' + commandHandler
    + '\n'+voiceSource.match(/  wake\(text\) \{[\s\S]*?\n  \}/)[0].replace('  wake(text)', 'function wake(text)')+'\nvoice.wake=wake;voice.handle=handle;\n'
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



for(const changed of ['mode','field']) test(`a bare wake survives same-session ${changed} transition`,async t=>{const f=fixture(t,'guide');await f.context.startEars();f.phrase();if(changed==='mode')f.S.mode='write';else f.S.fields=[{label:'Other'}];await f.respond(0,'Hey Nib');assert(f.S.awaitQ);f.phrase();await f.respond(1,'Where is the phone?');assert.deepEqual(f.answers,['Where is the phone?']);});
test('stale inline wake question safely opens a fresh question window',async t=>{const f=fixture(t,'guide');await f.context.startEars();f.phrase();f.S.mode='write';await f.respond(0,'Hey Nib, what should I write here?');assert(f.S.awaitQ);assert.deepEqual(f.answers,[]);assert.deepEqual(f.said,['Please ask that again.']);});
for(const change of ['epoch','ptt','lang']) test(`wake is invalidated by changed ${change}`,async t=>{const f=fixture(t);await f.context.startEars();f.phrase();if(change==='epoch')f.S.epoch++;if(change==='ptt')f.S.earsPttGeneration=1;if(change==='lang')f.S.lang='es';if(change==='start')f.S.mode='start';await f.respond(0,'Hey Nib');assert.equal(f.S.awaitQ,0);});
for(const words of ['done','Hey Nib, done','Hey Nib, skip this one'])test(`stale ${words} cannot act on a newer field/mode`,async t=>{const f=fixture(t,'write');await f.context.startEars();f.phrase();f.S.mode='confirm';f.S.fields=[{label:'New field',done:false}];await f.respond(0,words);assert.equal(f.S.fields[0].done,false);assert.equal(f.finishes(),0);assert.equal(f.nexts(),0);assert.deepEqual(f.answers,[]);if(words.startsWith('Hey')){assert(f.S.awaitQ);assert.deepEqual(f.said,['Please ask that again.']);}else assert.equal(f.S.awaitQ,0);});
test('unchanged inline wake question is answered immediately',async t=>{const f=fixture(t);await f.context.startEars();f.phrase();await f.respond(0,'Hey Nib, where is the phone?');assert.deepEqual(f.answers,['where is the phone?']);});
test('unchanged Done still finishes writing',async t=>{const f=fixture(t,'write');await f.context.startEars();f.phrase();await f.respond(0,'done');assert.equal(f.finishes(),1);});

test('wake plus question queued before a field change opens a fresh window without applying its tail',async t=>{const f=fixture(t,'guide');await f.context.startEars();f.phrase();f.S.fields=[{label:'Phone',done:false}];await f.respond(0,'Hey Nib, what should I write?');assert(f.S.awaitQ);assert.deepEqual(f.answers,[]);assert.deepEqual(f.said,['Please ask that again.']);});
test('wake queued behind old audio still survives arrival while stale Done does not',async t=>{const f=fixture(t,'guide');await f.context.startEars();f.phrase();f.phrase();f.S.mode='write';await f.respond(0,'done');assert.equal(f.finishes(),0);assert.equal(f.requests.length,2);await f.respond(1,'Hey Nib');assert(f.S.awaitQ);});

// Startup/error now accepts global wake; relative field actions remain blocked.
test('same-session startup error accepts wake without applying Done to an old field', async t => {
  const f = fixture(t, 'guide'); await f.context.startEars(); f.phrase(); f.S.mode = 'start';
  await f.respond(0, 'Hey Nib'); assert(f.S.awaitQ);
  f.phrase(); await f.respond(1, 'done');
  assert.equal(f.finishes(), 0); assert.equal(f.nexts(), 0); assert.deepEqual(f.answers, []);
  assert.equal(f.S.fields[0].done, false);
});
