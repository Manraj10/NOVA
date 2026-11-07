// Around me narrator: hazards first, people counted once as you turn, nothing repeated when you turn back,
// and every sentence it can say is in allLines() so the natural voice can make it ahead of time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAround, allLines } from '../public/around.js';

test('turning around: chair warning, then one person, then two more, and turning back is quiet', () => {
  const a = makeAround({ hfov: 60 });
  let t = 0;
  const r1 = a.update([{ kind: 'furniture', name: 'chair', label: 'wooden chair', x: 0.5, steps: 3, inPath: true }], 0, t += 3000);
  assert.deepEqual(r1.say, ['Watch out: chair, about three steps ahead.']);
  assert.equal(r1.hazard, true);
  const r2 = a.update([{ kind: 'person', name: 'person', label: 'man sitting', x: 0.8, steps: 4, inPath: false }], 60, t += 3000);
  assert.deepEqual(r2.say, ['One person on your right.']);
  const r3 = a.update([{ kind: 'person', name: 'person', label: 'woman standing', x: 0.45, steps: 3, inPath: false }, { kind: 'person', name: 'person', label: 'man standing', x: 0.55, steps: 3, inPath: false }], 160, t += 3000);
  assert.deepEqual(r3.say, ['Two more people ahead.']);
  const r4 = a.update([{ kind: 'person', name: 'person', label: 'man sitting', x: 0.8, steps: 4, inPath: false }], 62, t += 3000);
  assert.deepEqual(r4.say, []);
  assert.match(a.summary(0), /^Around you: three people .* and a chair ahead\.$/);
});

test('no compass: the same crowd seen again is not news, a bigger one is; doors always said', () => {
  const a = makeAround();
  const r1 = a.update([{ kind: 'door', name: 'door', label: 'open door', x: 0.2, steps: 5, inPath: false }, { kind: 'person', name: 'person', label: 'person', x: 0.7, steps: 2, inPath: false }], null, 1000);
  assert.deepEqual(r1.say, ['One person on your right.', 'Door on your left.']);
  assert.deepEqual(a.update([{ kind: 'person', name: 'person', label: 'person', x: 0.3, steps: 2, inPath: false }], null, 20000).say, []);
  assert.deepEqual(a.update([1, 2, 3].map(k => ({ kind: 'person', name: 'person', label: 'p', x: k / 4, steps: 3, inPath: false })), null, 23000).say, ['Two more people ahead.']);
  assert.equal(a.world.filter(w => w.kind === 'person').length, 3);
  assert.equal(makeAround().summary(null), "I haven't seen anything yet. Turn slowly so the camera can look around.");
});

test('every sentence update() can produce is in allLines()', () => {
  const lines = new Set(allLines()), a = makeAround({ hfov: 60 });
  let t = 0, said = [];
  for (let k = 0; k < 40; k++) {
    const items = [{ kind: k % 3 ? 'furniture' : 'person', name: ['chair', 'table', 'person', 'door', 'thing'][k % 5], label: 'x', x: (k * 37 % 100) / 100, steps: 1 + (k % 6), inPath: k % 4 === 0 }];
    said = said.concat(a.update(items, (k * 47) % 360, t += 3000).say);
  }
  assert.ok(said.length > 5);
  for (const s of said) assert.ok(lines.has(s), `not prefetched: ${s}`);
  assert.ok(lines.size < 200, 'small enough to make ahead of time');
});
