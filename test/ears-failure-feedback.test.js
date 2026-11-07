// Actual VAD/queue module; deterministic audio, clock and HTTP mocks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/ears.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(t, options = {}) {
  let processor, generation = 1, sequence = 0, ignored = false, timerId = 0, now = 0;
  const timers = new Map(), requests = [], events = [], texts = [], drops = [];
  const node = () => ({ connect(next) { return next; }, disconnect() {} });
  const ctx = { sampleRate: 16000, destination: {}, createMediaStreamSource: node,
    createScriptProcessor() { processor = node(); return processor; },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
  };
  const sandbox = { AbortController,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch(url, init) {
      assert.equal(url, '/api/hear');
      return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: init.signal }));
    },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  if (options.browser !== false) Object.assign(sandbox, {
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent(event) { events.push({ type: event.type, detail: plain(event.detail) }); },
  });
  vm.createContext(sandbox);
  vm.runInContext(source + '\nglobalThis.createEars = makeEars;', sandbox);
  const config = { ctx, lang: () => 'en', ignore: () => ignored,
    onCapture: () => ({ generation, sequence: ++sequence, privateText: 'private-token-must-not-leak' }),
    isCurrent: token => token.generation === generation,
    onText: (text, token) => texts.push({ text, sequence: token.sequence }),
    maxQueued: options.maxQueued || 4, requestTimeoutMs: 1000,
  };
  if (options.custom) config.onDrop = (...args) => drops.push(args);
  const ears = sandbox.createEars(config), stream = { getTracks: () => [] };
  await ears.start(stream);
  t.after(async () => { ears.stop(); await flush(); assert.equal(timers.size, 0); });
  const phrase = () => {
    for (const level of [.1, .1, .1, 0, 0, 0, 0, 0, 0])
      processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) } });
  };
  const respond = async (index, status = 200, text = '') => {
    requests[index].resolve({ ok: status >= 200 && status < 300, status,
      json: async () => ({ text, error: 'private-provider-message-must-not-leak' }) });
    await flush();
  };
  const advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await flush();
  };
  return { sandbox, ears, stream, requests, events, texts, drops, phrase, respond, advance,
    stale() { generation++; }, ignore() { ignored = true; } };
}

for (const status of [402, 502]) test(`HTTP ${status} emits one sanitized default event and keeps future speech retryable`, async t => {
  const f = await fixture(t);
  f.phrase(); await f.respond(0, status);
  assert.deepEqual(f.events, [{ type: 'nib:voice-drop', detail: { reason: 'transcription-failed', status } }]);
  assert.equal(f.ears.stream, f.stream);
  assert.deepEqual(f.texts, []);
  f.phrase(); await f.respond(1, 200, 'Nib, what is this?');
  assert.deepEqual(f.texts, [{ text: 'Nib, what is this?', sequence: 2 }]);
  assert.equal(f.events.length, 1);
});

test('network error emits sanitized reason without error message or invented HTTP status', async t => {
  const f = await fixture(t); f.phrase();
  f.requests[0].reject(new TypeError('private-network-message-must-not-leak')); await flush();
  assert.deepEqual(f.events, [{ type: 'nib:voice-drop', detail: { reason: 'transcription-failed' } }]);
  f.phrase(); await f.respond(1, 200, 'repeat');
  assert.deepEqual(f.texts, [{ text: 'repeat', sequence: 2 }]);
});

test('timeout emits once, releases the queue, and rejects an old late response', async t => {
  const f = await fixture(t); f.phrase(); f.phrase();
  await f.advance(1000);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[0].signal.aborted, true);
  assert.deepEqual(f.events, [{ type: 'nib:voice-drop', detail: { reason: 'transcription-timeout' } }]);
  await f.respond(0, 200, 'old done'); await f.respond(1, 200, 'current');
  assert.deepEqual(f.texts, [{ text: 'current', sequence: 2 }]);
});

test('timeout also covers a stalled response body without exposing its late text', async t => {
  const f = await fixture(t); f.phrase(); let body;
  f.requests[0].resolve({ ok: true, status: 200, json: () => new Promise(resolve => { body = resolve; }) });
  await flush(); await f.advance(1000);
  assert.equal(f.events[0].detail.reason, 'transcription-timeout');
  body({ text: 'late done' }); await flush(); assert.deepEqual(f.texts, []);
});

for (const change of ['stale', 'ignore']) test(`${change} onset context suppresses a failed response and its feedback`, async t => {
  const f = await fixture(t); f.phrase(); f[change](); await f.respond(0, 402);
  assert.deepEqual(f.events, []); assert.deepEqual(f.texts, []);
});

test('stop cancels request, queue and timeout; old failure never reaches the next cycle', async t => {
  const f = await fixture(t); f.phrase(); f.phrase(); f.ears.stop(); await flush();
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.ears.stream, null);
  await f.respond(0, 402); await f.advance(1000);
  assert.equal(f.requests.length, 1); assert.deepEqual(f.events, []);
  await f.ears.start(f.stream); f.phrase(); await f.respond(1, 200, 'new');
  assert.deepEqual(f.texts, [{ text: 'new', sequence: 3 }]);
});

test('an AbortError is quiet and does not prevent a later phrase', async t => {
  const f = await fixture(t); f.phrase();
  f.requests[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); await flush();
  assert.deepEqual(f.events, []);
  f.phrase(); await f.respond(1, 200, 'home');
  assert.equal(f.texts[0].text, 'home');
});

test('successful empty transcript emits neither words nor failure', async t => {
  const f = await fixture(t); f.phrase(); await f.respond(0, 200, '');
  assert.deepEqual(f.events, []); assert.deepEqual(f.texts, []);
});

test('explicit custom onDrop receives one callback and safe optional status, without default event', async t => {
  const f = await fixture(t, { custom: true }); f.phrase(); await f.respond(0, 402);
  assert.equal(f.drops.length, 1); assert.equal(f.drops[0][0], 'transcription-failed');
  assert.equal(f.drops[0][1].sequence, 1); assert.deepEqual(plain(f.drops[0][2]), { status: 402 });
  assert.deepEqual(f.events, []);
  f.phrase(); f.stale(); await f.respond(1, 502);
  assert.equal(f.drops.length, 1, 'obsolete context must not notify a custom handler either');
});

test('bounded queue keeps earliest phrases and reports each newest overflow once to a custom handler', async t => {
  const f = await fixture(t, { custom: true, maxQueued: 2 });
  for (let i = 0; i < 6; i++) f.phrase();
  assert.equal(f.requests.length, 1); assert.equal(f.drops.length, 3);
  assert.deepEqual(f.drops.map(args => args[0]), ['queue-full', 'queue-full', 'queue-full']);
  for (let i = 0; i < 3; i++) await f.respond(i, 200, `phrase ${i + 1}`);
  assert.deepEqual(f.texts.map(value => value.sequence), [1, 2, 3]);
  assert.equal(f.requests.length, 3); assert.deepEqual(f.events, []);
});

test('default queue-full event is sanitized and does not evict the pending follow-up', async t => {
  const f = await fixture(t, { maxQueued: 2 });
  for (let i = 0; i < 4; i++) f.phrase();
  assert.deepEqual(f.events, [{ type: 'nib:voice-drop', detail: { reason: 'queue-full' } }]);
  for (let i = 0; i < 3; i++) await f.respond(i, 200, `phrase ${i + 1}`);
  assert.deepEqual(f.texts.map(value => value.sequence), [1, 2, 3]);
});

test('out-of-range HTTP-like status is excluded from shared feedback', async t => {
  const f = await fixture(t); f.phrase(); await f.respond(0, 999);
  assert.deepEqual(f.events, [{ type: 'nib:voice-drop', detail: { reason: 'transcription-failed' } }]);
});

test('nonbrowser hosts without event constructors or dispatch stay usable after a failure', async t => {
  const f = await fixture(t, { browser: false }); f.phrase(); await f.respond(0, 402);
  f.phrase(); await f.respond(1, 200, 'repeat');
  assert.deepEqual(f.texts, [{ text: 'repeat', sequence: 2 }]);
});

test('a partial event host cannot break the transcription pump', async t => {
  const f = await fixture(t); f.sandbox.dispatchEvent = () => { throw new Error('event host failed'); };
  f.phrase(); await f.respond(0, 502); f.phrase(); await f.respond(1, 200, 'repeat');
  assert.equal(f.texts[0].text, 'repeat');
});
