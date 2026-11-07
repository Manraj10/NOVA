import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const file = fileURLToPath(new URL('../public/voice.js', import.meta.url));

test('Trace and Paper share one destination; observed ASR spellings remain valid', () => {
  const { voice } = loadVoice(file);
  for (const prefix of ['', 'Hey Nib, ', 'Hey, Mib, ', 'Hey Ned, ']) {
    for (const [phrase, route] of [['Trace','paper'],['Paper','paper'],['peeper','paper'],['a round me','around'],['memories','memory']]) {
      assert.equal(voice.navigation(prefix + phrase), route, prefix + phrase);
    }
  }
});

test('fuzzy mode choices are retained without turning ordinary content into departures', () => {
  const { voice } = loadVoice(file);
  for (const [phrase, route] of [['payper','paper'],['trase','paper'],['memori','memory'],['hom','home']]) {
    assert.equal(voice.navigation(phrase,{modeChoice:true}),route,phrase);
    assert.equal(voice.navigation(`Hey Nib, open ${phrase}`),route,phrase);
  }
  for (const word of ['water','later','some','come','hope','dome','memo']) {
    assert.equal(voice.navigation(word),null,word);
    assert.equal(voice.navigation('Hey Nib, '+word),null,word);
  }
  assert.equal(voice.navigation('water',{modeChoice:true}),'paper');
  assert.equal(voice.navigation('some',{modeChoice:true}),'home');
  for (const phrase of ['go back','Hey Nib, go back','what does paper say','where is water','we are home']) {
    assert.equal(voice.navigation(phrase),null,phrase);
  }
});

test('polite requests to open a mode are navigation rather than Memory edits', () => {
  const { voice } = loadVoice(file), actions = [];
  voice.onCommand = (...args) => actions.push(args);
  for (const prefix of ['', 'Hey Nib, ', 'Hey, Mib, ']) {
    for (const [phrase, route] of [['can you open Around me','around'], ['could you please open a round me','around'],
      ['would you switch to Memory please','memory'], ['please can you take me to Trace','paper'], ['will you go home','home']]) {
      assert.equal(voice.navigation(prefix + phrase),route,prefix+phrase);
      voice.handle(prefix+phrase);assert.deepEqual(actions.at(-1),['nav',route]);
    }
  }
  for (const phrase of ['can you describe around me','what can memory do','could you read the paper on the table','can you open the paper envelope']) {
    assert.equal(voice.navigation(phrase),null,phrase);
  }
});
