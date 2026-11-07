// No model calls: importing check.js exposes only the pure fixture scorer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { score } from '../check.js';

const fixture = JSON.parse(readFileSync(new URL('../check/answers.json', import.meta.url), 'utf8'));
const fields = () => structuredClone(fixture.fields);

test('all17 correct labels, kinds and rows pass regardless of output order', () => {
  const predicted = fields().reverse(), before = JSON.stringify(predicted);
  const result = score(predicted);
  assert.equal(result.hit, 17);
  assert.equal(result.passed, true);
  assert.deepEqual(result.misses, []);
  assert.deepEqual(result.extra, []);
  assert.equal(new Set(result.matches.map(m => m.predictedIndex)).size, 17);
  assert.equal(JSON.stringify(predicted), before, 'scoring cannot mutate predictions');
});

test('a permutation of labels on otherwise perfect anchors cannot score17/17', () => {
  const predicted = fields();
  [predicted[0].label, predicted[1].label] = [predicted[1].label, predicted[0].label];
  const result = score(predicted);
  assert.equal(result.hit, 15);
  assert.equal(result.passed, false);
  assert.equal(result.extra.length, 2);
  assert.match(result.misses.join('; '), /Last name.*wrong row or target/);
  assert.match(result.misses.join('; '), /First name.*wrong row or target/);
});

test('same-column neighboring rows swapped geometrically fail semantic row identity', () => {
  const predicted = fields();
  for (const key of ['y0', 'y1']) [predicted[8][key], predicted[9][key]] = [predicted[9][key], predicted[8][key]];
  const result = score(predicted);
  assert.equal(result.hit, 15);
  assert.equal(result.passed, false);
  assert.match(result.misses.join('; '), /Insurance provider.*wrong row/);
  assert.match(result.misses.join('; '), /Policyholder name.*wrong row/);
});

test('wrong field kind fails even with the right label and exact target', () => {
  const predicted = fields();
  predicted[2].kind = 'text';
  const result = score(predicted);
  assert.equal(result.hit, 16);
  assert.equal(result.passed, false);
  assert.deepEqual(result.misses, ['Date of birth (kind mismatch)']);
});

test('a missing field cannot be replaced by an unrelated nearest anchor', () => {
  const predicted = fields();
  predicted.splice(0, 1);
  const result = score(predicted);
  assert.equal(result.hit, 16);
  assert.equal(result.passed, false);
  assert.deepEqual(result.misses, ['Last name (label missing)']);
});

test('a duplicate prediction remains extra and cannot make a clean pass', () => {
  const predicted = fields();
  predicted.push({ ...predicted[0] });
  const result = score(predicted);
  assert.equal(result.hit, 17);
  assert.equal(result.passed, false);
  assert.deepEqual(result.extra, ['Last name']);
});

test('duplicate labels cannot impersonate two different fields', () => {
  const predicted = fields();
  predicted[1].label = 'Last name';
  const result = score(predicted);
  assert.equal(result.hit, 16);
  assert.equal(result.passed, false);
  assert.match(result.misses.join('; '), /First name \(label missing\)/);
});

test('explicit aliases and conservative label formatting pass', () => {
  const predicted = fields();
  predicted[0].label = '  SURNAME: ';
  predicted[2].label = 'DOB';
  predicted[3].label = 'Patient phone number';
  predicted[7].label = 'Postal code';
  predicted[11].label = 'Allergies to medication: Yes';
  predicted[12].label = 'Allergies to medication: No';
  predicted[14].label = 'Emergency contact phone number';
  predicted[15].label = 'Signature of patient';
  assert.equal(score(predicted).passed, true);
});

test('Phone and Contact phone, and Yes and No, stay distinct', () => {
  for (const [a, b] of [[3, 14], [11, 12]]) {
    const predicted = fields();
    [predicted[a].label, predicted[b].label] = [predicted[b].label, predicted[a].label];
    const result = score(predicted);
    assert.equal(result.hit, 15);
    assert.equal(result.passed, false);
  }
});

test('unreviewed qualifiers or combined Yes/No labels do not fuzzy-match', () => {
  const predicted = fields();
  predicted[0].label = 'Not the last name';
  predicted[11].label = 'Yes / No';
  assert.equal(score(predicted).hit, 15);
});

test('invalid/out-of-bounds boxes never get partial geometric credit', () => {
  const predicted = fields();
  predicted[0].x0 = -0.001;
  predicted[1].y1 = NaN;
  predicted[2].x1 = predicted[2].x0;
  const result = score(predicted);
  assert.equal(result.hit, 14);
  assert.equal(result.passed, false);
  assert.ok(result.misses.every(m => m.endsWith('(invalid box)')));
});

test('one prediction cannot satisfy ambiguous overlapping truth fields', () => {
  const box = { label: 'Date', kind: 'date', x0: .3, y0: .3, x1: .5, y1: .33 };
  const truth = { cm: fixture.cm, aspect: fixture.aspect, fields: [{ ...box }, { ...box }] };
  const result = score([{ ...box }], truth);
  assert.equal(result.hit, 0);
  assert.equal(result.passed, false);
  assert.deepEqual(result.ambiguous, [0]);
});

test('empty predictions yield misses, never a perfect empty score', () => {
  assert.equal(score([]).hit, 0);
  assert.equal(score([]).misses.length, 17);
  assert.equal(score(null).passed, false);
  assert.equal(score([], { ...fixture, fields: [] }).passed, false);
});
