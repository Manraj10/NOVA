// Actual app handlers; deferred API replies and DOM/audio are mocked. No network.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const handler = name => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert(match, `actual ${name} handler must exist`);
  return match[0];
};

function fixture() {
  const requests = [], actions = [], spoken = [], errors = [], captions = [], cues = [];
  const S = { epoch: 1, mode: 'write', fields: [{ label: 'Name', kind: 'text', done: false },
    { label: 'Phone', kind: 'number', done: false }], i: 0, lang: 'en', sim: null, awaitQ: 0, awaitQContext: null };
  const context = { S, app: { dataset: {} }, talk: { live: null, auto: 0 },
    voice: { stop() {}, earcon() {} }, performance: { now: () => 5000 },
    $: () => ({ setAttribute() {} }), renderSessionContext() {},
    showHeard(text) { captions.push(text); }, setCue(cue) { cues.push(cue); }, buzz() {},
    setTimeout() { return 1; }, clearTimeout() {},
    snapshot() { return 'test-image'; },
    api(path, payload) {
      assert.equal(path, '/api/ask');
      return new Promise((resolve, reject) => requests.push({ payload, resolve, reject }));
    },
    say(text) { spoken.push(text); return Promise.resolve(); },
    t: () => ({ offline: 'practice is offline', left: n => `${n} left`, here: label => `At ${label}` }),
    speakErr(error) { errors.push(error); },
    finishWriting() { actions.push({ action: 'done' }); },
    keep() { actions.push({ action: 'keep' }); }, redo() { actions.push({ action: 'redo' }); },
    repeat() { actions.push({ action: 'repeat' }); }, skip() { actions.push({ action: 'skip' }); },
    back() { actions.push({ action: 'back' }); }, abortFind() { actions.push({ action: 'cancel' }); },
    goTo(field) { actions.push({ action: 'goto', field }); },
    goFind(out) { actions.push(out); }, again() { actions.push({ action: 'reread' }); },
    setLang(lang) { S.lang = lang; }, readForm() { actions.push({ action: 'readForm' }); },
  };
  vm.createContext(context);
  vm.runInContext(['answer', 'localAnswer', 'act', 'talkDone', 'awaitQuestion'].map(handler).join('\n'), context);
  const reply = async (index, label = 'Phone') => requests[index].resolve({ action: 'find', label, box: { x0: .2, y0: .3, x1: .7, y1: .4 } });
  return { context, S, requests, actions, spoken, errors, captions, cues, reply };
}

test('the latest valid model response still acts and ends its own thinking UI', async () => {
  const f = fixture(), pending = f.context.answer('where is phone');
  assert.equal(f.context.app.dataset.talk, 'thinking');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].payload.image, 'test-image');
  assert.equal(f.requests[0].payload.current, 0); assert.equal(f.requests[0].payload.lang, 'en');
  await f.reply(0); await pending;
  assert.deepEqual(f.actions.map(x => x.label), ['Phone']);
  assert.equal(f.context.app.dataset.talk, undefined); assert.deepEqual(f.errors, []);
});

test('reversed responses cannot replace the newer answer in the same unchanged session', async () => {
  const f = fixture(), old = f.context.answer('where is name'), newer = f.context.answer('where is phone');
  await f.reply(1, 'Phone'); await newer;
  await f.reply(0, 'Name'); await old;
  assert.deepEqual(f.actions.map(x => x.label), ['Phone']); assert.equal(f.S.lastQ, 'where is phone');
});

test('an older response cannot clear a newer question that is still thinking', async () => {
  const f = fixture(), old = f.context.answer('first question'), newer = f.context.answer('second question');
  const before = f.cues.length; await f.reply(0, 'old'); await old;
  assert.equal(f.context.app.dataset.talk, 'thinking'); assert.equal(f.cues.length, before);
  assert.deepEqual(f.actions, []); await f.reply(1, 'new'); await newer;
  assert.deepEqual(f.actions.map(x => x.label), ['new']);
});

for (const change of ['epoch', 'field identity', 'index', 'mode', 'language', 'PTT generation']) {
  test(`a changed ${change} invalidates the response before action or UI cleanup`, async () => {
    const f = fixture(), pending = f.context.answer('explain this place');
    if (change === 'epoch') f.S.epoch++;
    if (change === 'field identity') f.S.fields[0] = { ...f.S.fields[0] };
    if (change === 'index') { f.S.fields[1] = f.S.fields[0]; f.S.i = 1; }
    if (change === 'mode') f.S.mode = 'confirm';
    if (change === 'language') f.S.lang = 'es';
    if (change === 'PTT generation') f.S.earsPttGeneration = 1;
    const before = f.cues.length;
    await f.reply(0); await pending;
    assert.deepEqual(f.actions, []); assert.deepEqual(f.errors, []);
    assert.equal(f.context.app.dataset.talk, 'thinking'); assert.equal(f.cues.length, before);
  });
}

test('a newer local command supersedes an older model request without changing fields', async () => {
  const f = fixture(), old = f.context.answer('explain this');
  await f.context.answer('repeat'); assert.equal(f.requests.length, 1);
  assert.deepEqual(f.actions.map(x => x.action), ['repeat']);
  await f.reply(0, 'stale'); await old;
  assert.deepEqual(f.actions.map(x => x.action), ['repeat']);
});

test('a newer practice hit supersedes the older model request without another request', async () => {
  const f = fixture(), old = f.context.answer('old question');
  f.S.sim = { find: () => ({ label: 'Practice phone', box: { x0: .1, y0: .2, x1: .6, y1: .3 } }) };
  await f.context.answer('where is phone'); assert.equal(f.requests.length, 1);
  await f.reply(0, 'stale'); await old;
  assert.deepEqual(f.actions.map(x => x.label), ['Practice phone']);
});

test('opening a real bare-wake follow-up window protects it from an older model reply', async () => {
  const f = fixture(), pending = f.context.answer('first question');
  f.context.awaitQuestion(); const waiting = f.S.awaitQContext, before = f.cues.length;
  await f.reply(0, 'stale'); await pending;
  assert.deepEqual(f.actions, []); assert.equal(f.context.app.dataset.talk, 'listening');
  assert.equal(f.S.awaitQContext, waiting); assert(f.S.awaitQ); assert.equal(f.cues.length, before);
});

test('a stale failure cannot clear or speak over the newer thinking question', async () => {
  const f = fixture(), old = f.context.answer('first question'), newer = f.context.answer('second question');
  const before = f.cues.length; f.requests[0].reject(Error('old failure')); await old;
  assert.equal(f.context.app.dataset.talk, 'thinking'); assert.equal(f.cues.length, before);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.spoken, []);
  await f.reply(1, 'new'); await newer; assert.deepEqual(f.actions.map(x => x.label), ['new']);
});

test('a stale failure cannot clear or speak over a newly opened wake window', async () => {
  const f = fixture(), pending = f.context.answer('first question'); f.context.awaitQuestion();
  f.requests[0].reject(Error('old failure')); await pending;
  assert.equal(f.context.app.dataset.talk, 'listening'); assert.deepEqual(f.errors, []); assert.deepEqual(f.spoken, []);
});

test('a failure from the previous field is silent even if no newer question has started', async () => {
  const f = fixture(), pending = f.context.answer('explain this'); f.S.i = 1;
  const before = f.cues.length; f.requests[0].reject(Error('old field failure')); await pending;
  assert.equal(f.context.app.dataset.talk, 'thinking'); assert.equal(f.cues.length, before);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.actions, []);
});

test('the current request still reports its failure and clears its own UI', async () => {
  const f = fixture(), pending = f.context.answer('explain this'); const error = Error('current failure');
  f.requests[0].reject(error); await pending;
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0], error);
  assert.equal(f.context.app.dataset.talk, undefined); assert.deepEqual(f.actions, []);
});

test('practice offline fallback remains available for the current failed request', async () => {
  const f = fixture(); f.S.sim = { find: () => null }; const pending = f.context.answer('explain this');
  f.requests[0].reject(Error('Form reading is off')); await pending;
  assert.deepEqual(f.spoken, ['practice is offline']); assert.deepEqual(f.errors, []);
  assert.equal(f.context.app.dataset.talk, undefined);
});

test('a stale practice failure cannot announce the offline fallback after a newer local answer', async () => {
  const f = fixture(); f.S.sim = { find: () => null }; const pending = f.context.answer('explain this');
  await f.context.answer('repeat'); f.requests[0].reject(Error('Form reading is off')); await pending;
  assert.deepEqual(f.actions.map(x => x.action), ['repeat']); assert.deepEqual(f.spoken, []);
});
