// The actual shared voice module and parser, with inert browser/audio/network surfaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const file = fileURLToPath(new URL('../public/voice.js', import.meta.url));
function fixture() {
  const h = loadVoice(file);
  const commands = [];
  h.voice.onCommand = (...args) => commands.push(args);
  return { ...h, commands };
}

for (const name of ['Nib', 'Hey Nib', 'HeyNib']) {
  test(`${name} alone opens the question window`, () => {
    const h = fixture();
    assert.equal(h.voice.wake(name)?.rest, '');
    h.voice.handle(name);
    assert.deepEqual(h.commands, [['ask', '']]);
  });
  test(`${name} plus a question preserves the actual question text`, () => {
    const h = fixture(), phrase = `${name}, What is on the table?`;
    assert.equal(h.voice.wake(phrase)?.rest, 'What is on the table?');
    h.voice.handle(phrase);
    assert.deepEqual(h.commands, [['ask', 'What is on the table?']]);
  });
}

test('punctuation, case and whitespace variants still address the same shared wake parser', () => {
  const h = fixture();
  for (const phrase of [' NIB! ', 'hey  nib.', 'Hey, Nib?', 'Nib,', 'Hi Nib', 'Okay Nib']) {
    assert.equal(h.voice.wake(phrase)?.rest, '', phrase);
  }
  assert.equal(h.voice.wake('Nib: Read this label.')?.rest, 'Read this label.');
  assert.equal(h.voice.wake('Nib。请描述。')?.rest, '请描述。');
});

test('an explicit starting Nib invocation is a question, never an implicit relative action', () => {
  const h = fixture();
  h.voice.handle('Nib reads forms');
  h.voice.handle('Nib, done');
  assert.deepEqual(h.commands, [['ask', 'reads forms'], ['ask', 'done']]);
});

for (const [label, route] of [['paper', 'paper'], ['around me', 'around'], ['memory', 'memory'], ['home', 'home']]) {
  test(`only exact ${label} destinations navigate across optional invocation/verb variants`, () => {
    const h = fixture();
    for (const name of ['', 'Nib, ', 'Hey Nib, ', 'HeyNib ']) {
      for (const verb of ['', 'open ', 'go to ', 'switch to ']) {
        const phrase = `${name}${verb}${label}!`;
        assert.equal(h.voice.navigation(phrase), route, phrase);
        h.voice.handle(phrase);
        assert.deepEqual(h.commands.at(-1), ['nav', route]);
      }
    }
  });
}

test('embedded mentions, quoted mentions, URLs and Nibbles never wake', () => {
  const h = fixture();
  for (const phrase of ['Please tell Nib what is here', 'The presenter says Hey Nib, describe',
    'Say "Nib, open memory"', 'Readback: Nib, go to home', 'The word "Nib" is printed here',
    '"Nib"', "'Nib'", 'Nibbles, what is here?', 'Hey Nibbles, open memory',
    'Nibhttps://example.com', 'https://example.com/Nib', 'Nib/open memory']) {
    assert.equal(h.voice.wake(phrase), null, phrase);
    h.voice.handle(phrase);
  }
  assert.deepEqual(h.commands, []);
});

test('questions, surrounding words, prototype keys and URLs never become navigation', () => {
  const h = fixture();
  for (const phrase of ['what does paper on the table say', 'what is memory',
    'Nib, what is memory?', 'Hey Nib, explain paper', 'paper on the table',
    'go to memory and paper', 'open home now', 'we are home', 'Say paper',
    'Readback: home', 'Readback says "memory"', 'the word "paper"', "Say 'home'",
    '__proto__', 'constructor', 'toString', 'open __proto__',
    'https://example.com', '/memory/', 'memory/', 'Nib, https://example.com', 'Nib, open /memory/']) {
    assert.equal(h.voice.navigation(phrase), null, phrase);
  }
});

test('whole quoted destination retains the existing direct-command contract', () => {
  const h = fixture();
  assert.equal(h.voice.navigation('  "AROUND   ME."  '), 'around');
  assert.equal(h.voice.navigation("'paper'"), 'paper');
});

test('natural destination phrases added by the teammate remain valid with either wake prefix', () => {
  const h = fixture();
  for (const wake of ['', 'Nib, ', 'Hey Nib, ']) {
    for (const [phrase, route] of [['go home', 'home'], ['take me to Memory', 'memory'],
      ['Around me mode, please', 'around'], ['please open the Paper page', 'paper'],
      ['back to home', 'home'], ['switch to Around me', 'around']]) {
      assert.equal(h.voice.navigation(wake + phrase), route, wake + phrase);
    }
  }
});

test('back stays a local mode action rather than unexpectedly leaving Paper or Memory', () => {
  const h = fixture();
  for (const phrase of ['back', 'go back', 'Nib, back', 'Hey Nib, go back']) {
    assert.equal(h.voice.navigation(phrase), null, phrase);
  }
  h.voice.handle('Hey Nib, go back');
  assert.deepEqual(h.commands, [['ask', 'go back']]);
});

test('captured active assistant echo still blocks full wake commands and readback navigation', async () => {
  const h = fixture();
  for (const phrase of ['Nib, open memory', 'Hey Nib, switch to paper', 'home', 'done']) {
    h.voice.speaking = true; h.voice.recent = [phrase];
    const onset = h.voice.echoSnapshot();
    h.voice.speaking = false;
    await h.advance(1500);
    assert.equal(h.voice.echo(phrase, onset), true, phrase);
    if (!h.voice.echo(phrase, onset)) h.voice.handle(phrase);
  }
  assert.deepEqual(h.commands, []);
});

test('bare wake interruption exception remains limited to opening a question window', () => {
  const h = fixture();
  for (const phrase of ['Nib', 'Hey Nib', 'HeyNib']) {
    h.voice.speaking = true; h.voice.recent = [phrase];
    const onset = h.voice.echoSnapshot();
    assert.equal(h.voice.echo(phrase, onset), false);
    h.voice.handle(phrase);
    assert.deepEqual(h.commands.at(-1), ['ask', '']);
  }
});
