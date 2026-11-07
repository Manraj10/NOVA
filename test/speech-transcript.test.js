import test from 'node:test';
import assert from 'node:assert/strict';
import { sameWords } from '../lib/speak.js';

for (const [name, script, transcript] of [
  ['decimal point', 'Read 1.5', 'Read 15'],
  ['decimal comma', 'Read 1,5', 'Read 15'],
  ['negative sign', 'Wait -5', 'Wait 5'],
  ['spaced negative sign', 'Wait - 5', 'Wait 5'],
  ['positive sign', 'Write +5', 'Write 5'],
  ['leading decimal point', 'Write .5', 'Write 5'],
  ['leading decimal comma', 'Write ,5', 'Write 5'],
  ['space before decimal', 'Read 1 .5', 'Read 1 5'],
  ['space after decimal', 'Read 1. 5', 'Read 1 5'],
  ['spaced decimal versus compact decimal', 'Read 1.5', 'Read 1 .5'],
  ['spaced fraction', 'Read 1 / 2', 'Read 1 2'],
  ['spaced time separator', 'Meet at 1 : 30', 'Meet at 1 30'],
  ['percent sign', 'Write 5%', 'Write 5'],
  ['percent versus per mille', 'Write 5%', 'Write 5‰'],
  ['currency', 'Write $5', 'Write €5'],
  ['comparison direction', 'Check 5 < 10', 'Check 5 > 10'],
  ['parenthesized amount', 'Balance (5)', 'Balance 5'],
  ['Arabic decimal separator', 'Read ١٫٥', 'Read ١ ٥'],
  ['fullwidth negative sign', 'Wait －5', 'Wait 5'],
  ['en dash negative sign', 'Wait –5', 'Wait 5'],
  ['numeric letter boundary', 'Use A1', 'Use A 1'],
  ['scientific notation boundary', 'Read 1e-3', 'Read 1 e -3'],
  ['email punctuation', 'alex.rivera@example.com', 'alex/rivera@example,com'],
  ['unit denominator', 'Write 5 mg/ml', 'Write 5 mg ml'],
  ['fullwidth digit', 'Write ５', 'Write 5'],
  ['Roman numeral', 'Section Ⅰ', 'Section I'],
  ['acronym case', 'Contact US', 'Contact us'],
  ['zero width joiner', 'Use AB', 'Use A\u200dB'],
  ['Spanish accent', 'sí', 'si'],
  ['Spanish distinct letter', 'año', 'ano'],
  ['date separators', '04/12/2004', '04122004'],
  ['word boundary', 'Turn left', 'Turnleft'],
  ['negation', 'Do not write', 'Do write'],
]) {
  test(`changed ${name} is rejected`, () => assert.equal(sameWords(script, transcript), false));
}

for (const [name, script, transcript] of [
  ['spacing', 'A little left.', '  A  little\nleft. '],
  ['canonical Unicode accents', 'sí', 'si\u0301'],
  ['unchanged apostrophes', "You're here.", "  You're here. "],
  ['unchanged numeric values', 'Write -1.5, then 04/12/2004.', 'Write -1.5,\nthen 04/12/2004.'],
  ['Hindi combining marks', 'अब आप लिखें।', 'अब  आप लिखें।'],
  ['Chinese full stop', '请开始书写。', '请开始书写。'],
  ['unchanged Unicode symbols', 'Write −5% or €1,50.', 'Write −5% or €1,50.'],
  ['unchanged email', 'alex.rivera@example.com', 'alex.rivera@example.com'],
]) {
  test(`same words allow ${name}`, () => assert.equal(sameWords(script, transcript), true));
}

for (const [script, transcript] of [
  ['Hello, there!', 'hello there.'],
  ['A little left.', 'A little left'],
  ["You're here.", 'You’re here.'],
  ['अब आप लिखें।', 'अब आप लिखें'],
  ['请开始书写。', '请开始书写'],
]) {
  test(`unverified typography uses conservative fallback: ${JSON.stringify(transcript)}`, () => {
    assert.equal(sameWords(script, transcript), false);
  });
}

test('empty, punctuation-only and non-string transcripts are refused', () => {
  for (const input of ['', '...', null, {}, 0]) assert.equal(sameWords('up', input), false);
  assert.equal(sameWords('...', '...'), false);
  assert.equal(sameWords('', ''), false);
  assert.equal(sameWords('   ', '\n'), false);
  assert.equal(sameWords('↑', '↑'), false);
});
