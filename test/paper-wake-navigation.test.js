import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('../public/app.js'), speech = read('../public/voice.js');
const fn = name => { const m = app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`)); assert(m, name); return m[0]; };
const methods = ['echoSnapshot', 'echo', 'wake', 'navigation', 'handle'].map(name => {
  const m = speech.match(new RegExp(`  ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\},`)); assert(m, name); return m[0];
});
const constants = speech.match(/^const (?:DONE|REPEAT|SKIP|REDO|WAKE|BARE) = .*;$/gm); assert.equal(constants.length, 6);
function fixture(mode) {
  const actions = [], says = []; let options, stops = 0, factories = 0;
  const S = { mode, epoch: 1, lang: 'en', fields: [{ label: 'Name', kind: 'text', done: false }], i: 0, awaitQ: 0 };
  const nodes = new Map(); const $ = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, textContent: '', setAttribute() {}, classList: { add() {}, remove() {} } });
    return nodes.get(key);
  };
  const voice = { ctx: { resume: () => Promise.resolve() }, speaking: false, endedAt: -10000, recent: [],
    unlock() {}, earcon() {}, prefetch() {}, heard: true,
    stop() { stops++; }, say(text) { says.push(text); return Promise.resolve(); },
    listen() { actions.push({ type: 'browser-fallback' }); }, hear() { throw Error('custom ears should handle wake'); },
  };
  const context = { S, voice, app: { dataset: {} }, talk: { live: null, auto: 0 },
    location: { search: '', assign(path) { actions.push({ type: 'navigate', path }); } }, URLSearchParams,
    navigator: {}, performance: { now: () => 5000 }, $,
    setTimeout: () => 1, clearTimeout() {}, renderSessionContext() {}, setCue() {}, showHeard() {}, buzz() {},
    t: () => ({ noCamera: 'camera unavailable', noMic: 'no microphone', noEars: 'no listener', heardNothing: 'nothing heard', here: label => `At ${label}`, left: n => `${n} left` }),
    say(text) { says.push(text); return Promise.resolve(); },
    api(path, body) { actions.push({ type: 'model-request', question: body.question, path }); return new Promise(() => {}); },
    snapshot: () => 'test-image', speakErr() {},
    finishWriting() { actions.push({ type: 'finish-writing' }); }, keep() { actions.push({ type: 'keep' }); },
    redo() { actions.push({ type: 'call-redo' }); }, repeat() { actions.push({ type: 'call-repeat' }); },
    skip() { actions.push({ type: 'call-skip' }); }, back() { actions.push({ type: 'call-back' }); },
    abortFind() { actions.push({ type: 'cancel-find' }); }, act() {},
    stayAwake() {}, warmVoice() {}, cameraFail() {},
    setMode(mode) { S.mode = mode; }, startCamera: async () => { throw Object.assign(Error('blocked'), { name: 'NotAllowedError' }); },
    readForm() { actions.push({ type: 'read-form' }); },
    makeEars(config) { factories++; options = config; const api = { stream: {}, busy: false, hasPending: () => false,
      start: () => Promise.resolve(api), stop() { api.stream = null; } }; return api; },
  };
  vm.createContext(context);
  vm.runInContext(constants.join('\n') + '\nObject.assign(voice, {\n' + methods.join('\n') + '\n});\n'
    + ['begin', 'onVoiceCommand', 'startEars', 'awaitQuestion', 'gotQuestion', 'talkStart', 'talkEnd', 'talkDone', 'answer', 'localAnswer'].map(fn).join('\n'), context);
  const capture = () => options.onCapture();
  const deliver = (text, token = capture()) => {
    if (!options.ignore() && options.isCurrent(token)) options.onText(text, token);
  };
  return { context, S, actions, says, capture, deliver, stops: () => stops, factories: () => factories };
}

test('a bare wake followed by Home navigates before it can become a model question', async () => {
  for (const mode of ['reading', 'reveal', 'checkin', 'guide', 'write', 'check', 'confirm', 'idle', 'done', 'find']) {
    for (const wake of ['Nib', 'Hey Nib']) {
      const f = fixture(mode); await f.context.startEars(); f.deliver(wake); f.deliver('Home');
      assert.deepEqual(f.actions.map(x => x.type), ['navigate'], `${mode}: ${wake}`);
      assert.equal(f.actions[0].path, './'); assert.equal(f.S.awaitQ, 0); assert.equal(f.S.ears, null);
    }
  }
});

test('all other exact destinations work during a listening window', async () => {
  for (const [phrase, route] of [['around me', './around.html'], ['memory', './memory.html']]) {
    const f = fixture('guide'); await f.context.startEars(); f.deliver('Nib'); f.deliver(phrase);
    assert.deepEqual(f.actions, [{ type: 'navigate', path: route }]);
  }
});

test('inline addressed navigation remains global inside an existing question window', async () => {
  const f = fixture('confirm'); await f.context.startEars(); f.deliver('Nib'); f.deliver('Hey Nib, home');
  assert.deepEqual(f.actions, [{ type: 'navigate', path: './' }]);
});

test('global navigation remains valid across a same-session field/mode transition', async () => {
  const f = fixture('write'); await f.context.startEars(); const token = f.capture();
  f.S.mode = 'confirm'; f.S.fields[0] = { label: 'Next', kind: 'text' };
  f.deliver('Hey Nib, home', token);
  assert.deepEqual(f.actions, [{ type: 'navigate', path: './' }]); assert.deepEqual(f.says, []);
});

test('a genuine follow-up question still reaches the ordinary answer handler', async () => {
  const f = fixture('guide'); await f.context.startEars(); f.deliver('Nib'); f.deliver('What does this mean?');
  assert.deepEqual(f.actions, [{ type: 'model-request', question: 'What does this mean?', path: '/api/ask' }]);
});

test('mentioning a mode in a content question does not change pages', async () => {
  const f = fixture('guide'); await f.context.startEars(); f.deliver('Nib'); f.deliver('What does this paper say?');
  assert.deepEqual(f.actions, [{ type: 'model-request', question: 'What does this paper say?', path: '/api/ask' }]);
});

test('relative completion from writing cannot confirm a later readback', async () => {
  const f = fixture('write'); await f.context.startEars(); const token = f.capture(); f.S.mode = 'confirm';
  f.deliver('done', token); assert.deepEqual(f.actions, []);
});

test('an old session token cannot navigate the current page', async () => {
  const f = fixture('guide'); await f.context.startEars(); const token = f.capture(); f.S.epoch++;
  f.deliver('Hey Nib, home', token); assert.deepEqual(f.actions, []);
});

test('assistant echo is rejected before global navigation', async () => {
  const f = fixture('guide'); await f.context.startEars();
  f.context.voice.speaking = true; f.context.voice.recent = ['Hey Nib, home']; const token = f.capture();
  f.context.voice.speaking = false; f.context.voice.recent = [];
  f.deliver('Hey Nib, home', token); assert.deepEqual(f.actions, []);
});

test('the controller whitelist still rejects arbitrary parser output', async () => {
  const f = fixture('guide'); await f.context.startEars(); f.context.voice.navigation = () => 'https://example.com';
  f.deliver('anything'); assert.deepEqual(f.actions, []);
});
