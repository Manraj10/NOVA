import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const file = fileURLToPath(new URL('../public/voice.js', import.meta.url));
const pcm = seconds => ({ pcm: Buffer.alloc(Math.round(24000 * seconds) * 2).toString('base64'), rate: 24000 });
function setup(options = {}) {
  const h = loadVoice(file, { locationSearch: '', ...options }); h.voice.init();
  h.voice.ctx = new h.context.window.AudioContext();
  return h;
}
async function warm(h, text, seconds = .2) {
  const index = h.requests.length, entry = h.voice.clip(text);
  h.respond(index, pcm(seconds)); await entry.p; return entry;
}

test('cache separates identical text by request language and reuses the correct entry', async () => {
  const h = setup(); h.voice.lang = 'en'; const en = await warm(h, 'OK');
  h.voice.lang = 'es'; const es = await warm(h, 'OK');
  assert.notEqual(en, es); assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests.map(r => JSON.parse(r.request.body).lang), ['en', 'es']);
  h.voice.lang = 'en'; assert.equal(h.voice.clip('OK'), en); assert.equal(h.requests.length, 2);
});

test('late old-language fetch stays under its original cache identity and never plays', async () => {
  const h = setup(); h.voice.lang = 'en'; const en = h.voice.clip('OK');
  h.voice.lang = 'es'; const es = h.voice.clip('OK');
  h.respond(1, pcm(.1)); await es.p; h.respond(0, pcm(.2)); await en.p;
  assert.equal(h.voice.clip('OK'), es); assert.equal(h.cloud.length, 0); assert.equal(h.system.length, 0);
  h.voice.lang = 'en'; assert.equal(h.voice.clip('OK'), en);
});

test('cancelled system boundaries cannot update the current caption', async () => {
  const h = setup({ locationSearch: '?bot' }), words = []; h.voice.onWord = n => words.push(n);
  const a = h.voice.say('First field.'), old = h.system[0];
  const b = h.voice.say('Second field.'), current = h.system[1];
  old.onboundary({ charIndex: 7 }); assert.deepEqual(words, []);
  current.onboundary({ charIndex: 3 }); assert.deepEqual(words, [3]);
  old.onend(); assert.equal(h.voice.speaking, true);
  current.onend(); await Promise.all([a, b]);
});

test('stop clears busy/current and settles a pending say immediately', async () => {
  const h = setup(); let resolved = false;
  const said = h.voice.say('Write your name.').then(() => { resolved = true; });
  h.voice.stop(); await said;
  assert.equal(resolved, true); assert.equal(h.voice.busy(), false); assert.equal(h.voice.current, null); assert.equal(h.voice.kind, '');
  h.respond(0, pcm(.2)); await h.advance(2000);
  assert.equal(h.cloud.length, 0); assert.equal(h.system.length, 0);
});

test('an uninterrupted long PCM remains busy until its measured duration ends', async () => {
  const h = setup(); await warm(h, 'OK', 10);
  let resolved = false, ended = 0, resumed = 0;
  h.voice.onEnd = () => ended++; h.voice.ears = { pause() {}, resume() { resumed++; } };
  const said = h.voice.say('OK').then(() => { resolved = true; });
  const source = h.cloud[0].source;
  await h.advance(4221);
  assert.equal(resolved, false); assert.equal(h.voice.speaking, true); assert.equal(source.stopped, false); assert.equal(resumed, 0);
  await h.advance(5780); await said;
  assert.equal(resolved, true); assert.equal(source.stopped, true); assert.equal(h.voice.busy(), false);
  assert.equal(ended, 1); assert.equal(resumed, 1);
});

test('missing PCM end event stops its source before completion and ears resume', async () => {
  const h = setup({ neverAudioEnd: true }); await warm(h, 'OK', 2);
  const order = [];
  h.voice.onEnd = () => order.push(['end', h.cloud[0].source.stopped]);
  h.voice.ears = { pause() {}, resume() { order.push(['resume', h.cloud[0].source.stopped]); } };
  const said = h.voice.say('OK'), source = h.cloud[0].source;
  await h.advance(3501); await said;
  assert.equal(source.stopped, true); assert.equal(h.voice.speaking, false);
  assert.deepEqual(order, [['end', true], ['resume', true]]);
  source.onended(); await h.advance(1); assert.equal(order.length, 2);
});

test('missing system end event cancels synthesis before ears resume', async () => {
  const h = setup({ locationSearch: '?bot' });
  const resumes = [];
  h.voice.ears = { pause() {}, resume() { resumes.push(h.context.speechSynthesis.cancelCount); } };
  const said = h.voice.say('Name.');
  const before = h.context.speechSynthesis.cancelCount;
  await h.advance(5000); await said;
  assert.equal(h.voice.busy(), false); assert.deepEqual(resumes, [before + 1]);
});

test('explicit stop cancels playing PCM and resumes only after stopping the source', async () => {
  const h = setup(); await warm(h, 'Current.', 4);
  const order = [];
  h.voice.ears = { pause() {}, resume() { order.push(h.cloud[0].source.stopped); } };
  const said = h.voice.say('Current.'), source = h.cloud[0].source;
  h.voice.stop(); await said;
  assert.equal(source.stopped, true); assert.equal(h.voice.speaking, false); assert.deepEqual(order, [true]);
  source.onended(); await h.advance(1); assert.deepEqual(order, [true]);
});

test('old PCM completion cannot clear a newer utterance or emit its completion', async () => {
  const h = setup(); await warm(h, 'A.', .2); await warm(h, 'B.', .4);
  let ended = 0; h.voice.onEnd = () => ended++;
  const a = h.voice.say('A.'), old = h.cloud[0].source;
  const b = h.voice.say('B.'), current = h.cloud[1].source;
  await a; old.onended(); await h.advance(1);
  assert.equal(h.voice.source, current); assert.equal(h.voice.speaking, true); assert.equal(ended, 0);
  await h.advance(400); await b; assert.equal(ended, 1);
});

test('slow cloud falls back once and a later response does not double-play', async () => {
  const h = setup(); const said = h.voice.say('Name.');
  await h.advance(1501); assert.equal(h.system.length, 1); assert.equal(h.system[0].text, 'Name.');
  h.respond(0, pcm(.3)); await h.advance(1);
  assert.equal(h.cloud.length, 0); assert.equal(h.system.length, 1);
  h.finishSystem(); await said; assert.equal(h.voice.busy(), false);
});

test('uncached directions use system speech immediately and never wait for fetch', async () => {
  const h = setup(); const said = h.voice.say('left', { cue: true });
  assert.equal(h.system.length, 1); assert.equal(h.system[0].text, 'left'); assert.equal(h.now, 0);
  h.finishSystem(); await said;
});

test('hard instructions still protect against cue interruption', async () => {
  const h = setup(); const said = h.voice.say('Stop. Write here.');
  await h.voice.say('left', { cue: true });
  assert.equal(h.requests.length, 1); assert.equal(h.system.length, 0);
  await h.advance(1501); assert.equal(h.system[0].text, 'Stop. Write here.');
  h.finishSystem(); await said;
});

test('PTT cancels pending speech without resuming browser ears during capture', async () => {
  const h = setup(); let resumed = 0;
  h.voice.ears = { pause() {}, resume() { resumed++; } };
  const said = h.voice.say('Old instruction.');
  const heard = h.voice.hear(() => {}); await said;
  assert(heard); assert.equal(h.voice.speaking, false); assert.equal(resumed, 0);
  h.respond(0, pcm(.2)); await h.advance(2000);
  assert.equal(h.cloud.length, 0); assert.equal(h.system.length, 0); assert.equal(resumed, 0);
  const stopped = heard.stop(); await h.advance(1); await stopped;
  assert.equal(h.sessions.at(-1), 'playback');
});

test('prefetch has no playback side effects and stops old-language queue expansion', async () => {
  const h = setup(); const captions = []; h.voice.onCaption = (...v) => captions.push(v);
  h.voice.prefetch(['A', 'B', 'C', 'D', 'E']); assert.equal(h.requests.length, 4);
  const entries = ['A', 'B', 'C', 'D'].map(text => h.voice.clips.get(JSON.stringify(['en', text])));
  h.voice.lang = 'es';
  for (let i = 0; i < 4; i++) h.respond(i, pcm(.1));
  await Promise.all(entries.map(e => e.p)); await h.advance(1);
  assert.equal(h.requests.length, 4); assert.equal(h.cloud.length, 0); assert.equal(h.system.length, 0);
  assert.equal(h.voice.busy(), false); assert.deepEqual(captions, []);
});

test('coaching does not permanently blacklist quiet done or Nib commands', async () => {
  const h = setup({ locationSearch: '?bot' }), commands = [];
  h.voice.onCommand = (...args) => commands.push(args);
  const coach = 'Write just to the right of your finger. Say done, or tap, when you finish.'; // actual218 T.en.coach
  const said = h.voice.say(coach);
  // As in startEars.onText: echo filtering precedes voice.handle().
  const heard = text => { if (!h.voice.echo(text)) h.voice.handle(text); };
  heard('done'); assert.equal(commands.length, 0, 'self-echo suppressed during coaching');
  h.finishSystem(); await said;
  await h.advance(500); heard('done'); assert.equal(commands.length, 0, 'short acoustic tail suppressed');
  await h.advance(201); heard('done'); heard('Nib');
  assert.equal(commands.length, 2); assert.equal(commands[0][0], 'done');
  assert.equal(commands[1][0], 'ask'); assert.equal(commands[1][1], '');
});

test('echo context expires after each later utterance settles, without feedback commands', async () => {
  const h = setup({ locationSearch: '?bot' });
  const said = h.voice.say('Nib can repeat that.');
  assert.equal(h.voice.echo('Nib'), true); assert.equal(h.voice.echo('repeat'), true);
  assert.equal(h.voice.echo('unrelated words'), false);
  h.finishSystem(); await said; await h.advance(701);
  assert.equal(h.voice.echo('Nib'), false); assert.equal(h.voice.echo('repeat'), false);
});

test('iOS unlock preserves play-and-record while the app microphone is open', () => {
  const h = setup({ ios: true });
  h.voice.micOpen = true;
  h.voice.unlock();
  assert.equal(h.sessions.at(-1), 'play-and-record');
  h.voice.micOpen = false;
  h.voice.unlock();
  assert.equal(h.sessions.at(-1), 'playback');
});

test('iOS half-duplex pause retains the app microphone audio session', () => {
  const h = setup({ ios: true });
  h.voice.halfDuplex(() => true);
  h.voice.micOpen = true;
  h.voice.rec = { abort() {} };
  h.voice.ears.pause();
  assert.equal(h.sessions.at(-1), 'play-and-record');
  h.voice.micOpen = false;
  h.voice.rec = { abort() {} };
  h.voice.ears.pause();
  assert.equal(h.sessions.at(-1), 'playback');
});

test('iOS PTT completion keeps play-and-record if the app microphone remains open', async () => {
  const h = setup({ ios: true });
  h.voice.micOpen = true;
  const heard = h.voice.hear(() => {});
  assert.ok(heard);
  const stopped = heard.stop();
  await h.advance(1);
  await stopped;
  assert.equal(h.sessions.at(-1), 'play-and-record');
});

test('iOS PTT completion restores playback when the app microphone is closed', async () => {
  const h = setup({ ios: true });
  h.voice.micOpen = false;
  const heard = h.voice.hear(() => {});
  assert.ok(heard);
  const stopped = heard.stop();
  await h.advance(1);
  await stopped;
  assert.equal(h.sessions.at(-1), 'playback');
});

test('long instructions use complete system speech without a cloud request', async () => {
  const h = setup(), text = 'Write the complete instruction. '.repeat(15);
  const promise = h.voice.say(text);
  assert.equal(h.requests.length, 0);
  assert.equal(h.system[0]?.text, text);
  h.finishSystem(); await promise;
});
