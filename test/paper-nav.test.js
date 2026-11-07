import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const voiceFile = fileURLToPath(new URL('../public/voice.js', import.meta.url));
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const handler = name => {
  const source = app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert(source, `actual ${name} handler exists`); return source[0];
};
function setup(options = {}) {
  const h = loadVoice(voiceFile, { locationSearch: '?bot', ...options });
  h.voice.init(); h.voice.ctx = new h.context.window.AudioContext();
  const events = [], destinations = [], actions = [];
  const track = { stop() { events.push('track-stop'); } };
  const shared = { getTracks: () => [track] };
  const S = { epoch: 4, mode: 'write', fields: [{ label: 'Name', done: false }], i: 0, lang: 'en',
    mic: shared, earsPttGeneration: 2, awaitQ: 8000, awaitQContext: {},
    ears: { stop() { events.push('ears-stop'); } }, earsPending: { stop() { events.push('pending-stop'); } } };
  const talk = { live: null, auto: h.context.setTimeout(() => actions.push('old-auto'), 8000) };
  Object.assign(h.context, { S, talk, finishWriting: () => actions.push('finish'), keep: () => actions.push('keep'),
    redo: () => actions.push('redo'), repeat: () => actions.push('repeat'), skip: () => actions.push('skip'),
    answer: text => actions.push(['ask', text]), talkStart: () => actions.push('listen') });
  h.context.location.assign = url => { destinations.push(url); events.push('navigate'); };
  vm.runInContext(handler('onVoiceCommand'), h.context);
  h.voice.onCommand = h.context.onVoiceCommand;
  return { ...h, S, talk, events, destinations, actions, shared };
}

for (const [phrase, route] of [['around me', './around.html'], ['memory', './memory.html'], ['home', './']]) {
  test(`whole phrase ${phrase} navigates to its fixed route`, () => {
    const f = setup(); f.voice.handle(phrase);
    assert.deepEqual(f.destinations, [route]); assert.equal(f.S.epoch, 5);
    assert.equal(f.S.mode, 'start'); assert.equal(f.S.earsPttGeneration, 3);
    assert.equal(f.voice.onCommand, null); assert.equal(f.S.awaitQ, 0);
    assert.equal(f.S.ears, null); assert.equal(f.S.earsPending, null); assert.equal(f.S.mic, null);
    assert(f.events.indexOf('ears-stop') < f.events.indexOf('navigate'));
    assert(f.events.indexOf('track-stop') < f.events.indexOf('navigate'));
  });
  test(`Hey Nib prefix routes ${phrase} without asking a model`, () => {
    const f = setup(); f.voice.handle(`Hey Nib, ${phrase}!`);
    assert.deepEqual(f.destinations, [route]); assert.deepEqual(f.actions, []);
  });
}

test('case, whitespace and surrounding punctuation are accepted without matching embedded speech', () => {
  const yes = setup(); yes.voice.handle('  "AROUND   ME."  '); assert.deepEqual(yes.destinations, ['./around.html']);
  for (const text of ['show me around me', 'my memory is good', 'we are going home', 'Say home',
    'You wrote memory.', 'readback: around me', 'home then memory', 'h.ome', 'mem.ory', 'around-me']) {
    const f = setup(); f.voice.handle(text); assert.deepEqual(f.destinations, [], text);
  }
});

test('questions with a wake prefix remain questions unless the entire tail names a destination', () => {
  const f = setup(); f.voice.handle('Hey Nib, what is around me?');
  assert.deepEqual(f.destinations, []); assert.deepEqual(f.actions, [['ask', 'what is around me?']]);
});

test('handler rejects arbitrary URLs and prototype keys before touching session or devices', () => {
  for (const target of ['https://example.com', '//example.com', 'javascript:alert(1)', '../memory.html', '__proto__', 'constructor', '', null, {}]) {
    const f = setup(); f.context.onVoiceCommand('nav', target);
    assert.deepEqual(f.destinations, []); assert.equal(f.S.epoch, 4); assert.deepEqual(f.events, []);
  }
});

test('navigation settles pending speech and late clips cannot play or restart warm-up requests', async () => {
  const f = setup({ locationSearch: '' });
  f.voice.prefetch(['warm one', 'warm two', 'warm three', 'warm four', 'warm five']);
  const speaking = f.voice.say('Write your name.');
  assert.equal(f.requests.length, 5);
  f.voice.handle('home'); await speaking;
  assert.equal(f.voice.speaking, false); assert.equal(f.voice.current, null);
  for (let i = 0; i < 5; i++) f.respond(i, { pcm: Buffer.alloc(4800).toString('base64'), rate: 24000 });
  await f.advance(10000);
  assert.equal(f.requests.length, 5); assert.equal(f.cloud.length, 0); assert.equal(f.system.length, 0);
  assert.deepEqual(f.actions, []);
});

test('navigation stops playback without scheduling browser ears to resume', async () => {
  const f = setup(); let resumed = 0;
  f.voice.ears = { pause() {}, resume() { resumed++; } };
  const said = f.voice.say('Write your name.'); const old = f.system[0];
  f.voice.handle('memory'); await said;
  old.onend?.(); await f.advance(1000);
  assert.equal(resumed, 0); assert.equal(f.voice.speaking, false); assert(f.context.speechSynthesis.cancelCount > 0);
});

test('navigation closes push-to-talk without reopening the old browser recognizer', async () => {
  const f = setup(); f.voice.listen(f.context.onVoiceCommand);
  f.talk.live = f.voice.hear(() => {});
  assert.equal(f.recognizers.length, 2);
  f.context.onVoiceCommand('nav', 'around'); await f.advance(2000);
  assert.equal(f.talk.live, null); assert.equal(f.voice.rec, null); assert.equal(f.recognizers.length, 2);
  assert(f.recognizers.every(r => !r.started));
});

test('actual ears queue is cancelled and a late Done cannot act after navigation', async () => {
  const f = setup(); const nodes = [], node = () => ({ connect(next) { return next; }, disconnect() {} });
  f.voice.ctx.sampleRate = 16000;
  f.voice.ctx.createMediaStreamSource = node;
  f.voice.ctx.createScriptProcessor = () => { const p = node(); nodes.push(p); return p; };
  f.context.navigator.mediaDevices = { getUserMedia() { throw Error('must reuse camera audio'); } };
  f.context.t = () => ({ noEars: 'no ears' }); f.context.say = () => Promise.resolve();
  f.context.location.search = ''; // exercise the real listener, not the robot opt-out
  vm.runInContext(fs.readFileSync(new URL('../public/ears.js', import.meta.url), 'utf8').replace(/^export /gm, '')
    + '\n' + handler('startEars'), f.context);
  f.S.ears = null; await f.context.startEars();
  const feed = level => nodes[0].onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) } });
  for (let i = 0; i < 3; i++) feed(.1); for (let i = 0; i < 6; i++) feed(0);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/api/hear');
  f.voice.handle('around me'); assert.equal(f.requests[0].request.signal.aborted, true);
  f.respond(0, { text: 'done' }); await f.advance(10000);
  f.context.onVoiceCommand('done'); f.voice.handle('done');
  assert.deepEqual(f.actions, []); assert.deepEqual(f.destinations, ['./around.html']);
});

test('captured assistant readback is rejected by the actual echo guard before nav parsing', async () => {
  const f = setup(); f.voice.speaking = true; f.voice.recent = ['You wrote home.'];
  const onset = f.voice.echoSnapshot(); f.voice.speaking = false; await f.advance(2000);
  if (!f.voice.echo('home', onset)) f.voice.handle('home');
  assert.deepEqual(f.destinations, []);
});

test('existing bare wake, completion and ordinary question commands retain their behavior', () => {
  const f = setup(); f.voice.handle('Nib'); f.voice.handle('done'); f.voice.handle('Hey Nib, what does this mean?');
  assert.deepEqual(f.destinations, []); assert.deepEqual(f.actions, ['listen', 'finish', ['ask', 'what does this mean?']]);
});

test('shared navigation parser includes exact Paper and Home commands with optional wake', () => {
  const f = setup();
  for (const [text, expected] of [['paper', 'paper'], ['Hey Nib, paper.', 'paper'], ['home', 'home'],
    ['Hey Nib, home!', 'home'], ['memory', 'memory'], ['around me', 'around']]) {
    assert.equal(f.voice.navigation(text), expected, text);
  }
  for (const text of ['paper on a table', 'what is paper?', 'Hey Nib, can you explain paper?',
    'we are home', 'Say paper', 'Readback: home', '__proto__', 'constructor']) {
    assert.equal(f.voice.navigation(text), null, text);
  }
});

test('Paper destination on the current Paper page is ignored without reloading or cancelling', () => {
  const f = setup(); f.voice.handle('paper');
  assert.deepEqual(f.destinations, []); assert.deepEqual(f.actions, []);
  assert.equal(f.S.epoch, 4); assert.deepEqual(f.events, []);
});
