// Exercise the actual native recognizer callback and shared wake/command parser.
// All browser, audio and network surfaces are inert mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const file = fileURLToPath(new URL('../public/voice.js', import.meta.url));

async function fixture() {
  const h = loadVoice(file), commands = [];
  await h.advance(1000); // Outside the initial echo tail.
  h.voice.listen((...args) => commands.push(args));
  return { ...h, commands, rec: h.recognizers.at(-1) };
}

const bareWakes = ['Nib', 'Hey Nib', 'HeyNib', ' NIB! ', 'Hey, Nib?', 'Nib,',
  'Hay Mib', 'Nim', 'Hey Ned', 'Nid', 'Neeb', 'Nibe', 'Nieb', 'Nibh'];
for (const phase of ['speaking', 'tail']) {
  test(`native ${phase}: exact bare wake spellings open a fresh question window`, async () => {
    const h = await fixture();
    h.voice.speaking = phase === 'speaking';
    h.voice.endedAt = phase === 'tail' ? h.now - 699 : 0;
    for (const phrase of bareWakes) {
      h.rec.emit(phrase);
      assert.deepEqual(h.commands.at(-1), ['ask', ''], phrase);
    }
    assert.equal(h.commands.length, bareWakes.length);
    assert.equal(h.recognizers.length, 1, 'wake does not construct another recognizer');
    assert.equal(h.requests.length, 0, 'wake never calls a service');
  });

  test(`native ${phase}: inline questions, navigation and relative actions remain echo-blocked`, async () => {
    const h = await fixture();
    h.voice.speaking = phase === 'speaking';
    h.voice.endedAt = phase === 'tail' ? h.now : 0;
    for (const phrase of ['Hey Nib, what is this?', 'Nib, done', 'HeyNib open memory',
      'Hey Mib, go home', 'home', 'paper', 'Done', 'Keep', 'Next', 'Skip', 'Redo', 'Repeat']) {
      h.rec.emit(phrase);
    }
    assert.deepEqual(h.commands, []);
  });
}

test('native busy: quoted, embedded and lookalike names never become a bare wake', async () => {
  const h = await fixture(); h.voice.speaking = true;
  for (const phrase of ['"Nib"', "'Nib'", 'Say Nib', 'The presenter says Hey Nib',
    'Nib reads forms', 'Hey Nibbles', 'Nibbles', 'Nibhttps://example.com', 'Nib/open memory']) {
    h.rec.emit(phrase);
  }
  assert.deepEqual(h.commands, []);
});

test('native callback can deliver bare wake while actual system speech remains pending', async () => {
  const h = await fixture();
  const speech = h.voice.say('Write your name here.', { system: true });
  assert.equal(h.voice.speaking, true);
  h.rec.emit('Hey Nib');
  assert.deepEqual(h.commands, [['ask', '']]);
  h.voice.stop(); await speech;
  assert.equal(h.voice.speaking, false);
  assert.equal(h.requests.length, 0);
});

test('late results from a replaced recognizer cannot reach either command callback', async () => {
  const h = await fixture(), currentCommands = [];
  h.voice.listen((...args) => currentCommands.push(args));
  const current = h.recognizers.at(-1);
  h.rec.emit('Done');
  h.voice.speaking = true;
  h.rec.emit('Hey Nib');
  assert.deepEqual(h.commands, []);
  assert.deepEqual(currentCommands, []);
  current.emit('Hey Nib');
  assert.deepEqual(currentCommands, [['ask', '']]);
});

test('late results after the recognizer is retired remain ignored', async () => {
  const h = await fixture();
  h.voice.rec = null;
  h.rec.emit('Done');
  h.voice.speaking = true; h.rec.emit('Nib');
  assert.deepEqual(h.commands, []);
});

test('quiet native recognition retains whole commands, inline questions and navigation', async () => {
  const h = await fixture();
  h.voice.endedAt = h.now - 700; // Existing echo boundary remains exclusive.
  for (const phrase of ['Done', 'Repeat', 'Skip', 'Redo', 'Hey Nib, What is this?',
    'Nib, open memory', 'Nib']) h.rec.emit(phrase);
  assert.deepEqual(h.commands, [['done'], ['repeat'], ['skip'], ['redo'],
    ['ask', 'What is this?'], ['nav', 'memory'], ['ask', '']]);
});
