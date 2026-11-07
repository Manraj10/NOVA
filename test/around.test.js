// Around me narrator: hazards first, people counted once as you turn, nothing repeated when you turn back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAround } from '../public/around.js';

test('turning around: chair warning, then one person, then two more, and turning back is quiet', () => {
  const a = makeAround({ hfov: 60 });
  let t = 0;
  const r1 = a.update([{ kind: 'furniture', label: 'wooden chair', x: 0.5, steps: 3, inPath: true }], 0, t += 3000);
  assert.deepEqual(r1.say, ['Watch out: wooden chair, about three steps ahead.']);
  assert.equal(r1.hazard, true);
  const r2 = a.update([{ kind: 'person', label: 'man sitting', x: 0.8, steps: 4, inPath: false }], 60, t += 3000);
  assert.deepEqual(r2.say, ['One person spotted, to your right.']);
  const r3 = a.update([{ kind: 'person', label: 'woman standing', x: 0.45, steps: 3, inPath: false }, { kind: 'person', label: 'man standing', x: 0.55, steps: 3, inPath: false }], 160, t += 3000);
  assert.deepEqual(r3.say, ['Two more people, ahead.']);
  // Turn back to the start: the same chair and the first person are old news.
  const r4 = a.update([{ kind: 'person', label: 'man sitting', x: 0.8, steps: 4, inPath: false }], 62, t += 3000);
  assert.deepEqual(r4.say, []);
  assert.match(a.summary(0), /^Around you: three people .* and a wooden chair ahead\.$/);
});

test('no compass: dedupe by recent position, doors always said', () => {
  const a = makeAround();
  const r1 = a.update([{ kind: 'door', label: 'open door', x: 0.2, steps: 5, inPath: false }, { kind: 'person', label: 'person', x: 0.7, steps: 2, inPath: false }], null, 1000);
  assert.deepEqual(r1.say, ['One person spotted, to your right.', 'Open door, to your left, about five steps.']);
  assert.deepEqual(a.update([{ kind: 'door', label: 'open door', x: 0.22, steps: 4, inPath: false }], null, 4000).say, []);
  assert.equal(makeAround().summary(null), "I haven't seen anything yet. Turn slowly so the camera can look around.");
});
