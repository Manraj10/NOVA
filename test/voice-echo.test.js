// Runs the real VAD, transcription queue, released app handlers and voice parser.
// Audio, permission, clock and network are deterministic mocks; no device/API use.
// These also run the actual capture-time voice echo methods.
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


const actualMethod = name => {
  const method = voiceSource.match(new RegExp(`  ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
  assert(method, `actual voice ${name} must exist`);
  return method.replace(`  ${name}(`, `function ${name}(`);
};
function realEcho(f) {
  vm.runInContext(actualMethod('echoSnapshot')+'\n'+actualMethod('echo')
    +'\nvoice.echoSnapshot=echoSnapshot;voice.echo=echo;',f.context);
}
function coach(f) {
  f.context.voice.speaking=true;
  f.context.voice.recent=['Stop. Write your name here. Say done, or tap, when you finish.'];
  f.context.voice.endedAt=0;
}

test('late ASR cannot turn coaching echo captured during playback into Done', async t => {
  const f=fixture(t,'write');realEcho(f);await f.context.startEars();coach(f);f.phrase();
  f.context.voice.speaking=false;f.context.voice.endedAt=f.timers.now();
  await f.timers.advance(1500);await f.respond(0,'done');assert.equal(f.finishes(),0);
});

test('audio begun in the acoustic tail remains echo even if transcription is late', async t => {
  const f=fixture(t,'write');realEcho(f);await f.context.startEars();coach(f);
  f.context.voice.speaking=false;f.context.voice.endedAt=f.timers.now();
  await f.timers.advance(400);f.phrase();await f.timers.advance(2000);await f.respond(0,'done');
  assert.equal(f.finishes(),0);
});

test('quiet genuine Done works after coaching even during later playback', async t => {
  const f=fixture(t,'write');realEcho(f);await f.context.startEars();coach(f);
  f.context.voice.speaking=false;f.context.voice.endedAt=f.timers.now();
  await f.timers.advance(701);f.phrase();
  f.context.voice.speaking=true;await f.respond(0,'done');assert.equal(f.finishes(),1);
});

test('echo decision retains onset text after the recent-speech list changes', async t => {
  const f=fixture(t,'write');realEcho(f);await f.context.startEars();coach(f);f.phrase();
  f.context.voice.recent.splice(0,1,'A later unrelated sentence.');
  f.context.voice.speaking=false;f.context.voice.endedAt=0;
  await f.timers.advance(1500);await f.respond(0,'done');assert.equal(f.finishes(),0);
});

test('bare Nib interrupts coaching and preserves an already-captured ordered question', async t => {
  const f=fixture(t);realEcho(f);await f.context.startEars();coach(f);
  f.context.voice.recent.push('Nib');f.phrase();f.phrase();
  await f.respond(0,'Nib');assert.equal(f.requests.length,2);
  await f.respond(1,'Where is the phone number?');
  assert.deepEqual(f.answers,['Where is the phone number?']);assert.equal(f.S.awaitQ,0);
});

test('explicit Hey Nib question interrupts playback even when matching recent text', async t => {
  const f=fixture(t);realEcho(f);await f.context.startEars();coach(f);
  f.context.voice.recent.push('Hey Nib, where is the total?');f.phrase();
  await f.respond(0,'Hey Nib, where is the total?');
  assert.deepEqual(f.answers,['where is the total?']);
});

test('capture snapshots are immutable and quiet snapshots do not blacklist old commands', () => {
  const f={context:{voice:{speaking:true,endedAt:0,recent:['say done']},performance:{now:()=>5000}}};
  vm.createContext(f.context);
  vm.runInContext(commandConstants.join('\n')+'\n'+actualMethod('echoSnapshot')+'\n'+actualMethod('echo')
    +'\nvoice.echoSnapshot=echoSnapshot;voice.echo=echo;',f.context);
  const captured=f.context.voice.echoSnapshot();assert(Object.isFrozen(captured));assert(Object.isFrozen(captured.recent));
  f.context.voice.speaking=false;
  assert.equal(f.context.voice.echo('done',captured),true);
  assert.equal(f.context.voice.echo('done',f.context.voice.echoSnapshot()),false);
});
