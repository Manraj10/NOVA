// On-device eyes: camera geometry gives sensible step counts, path detection, and flicker never speaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toItems, makeSteady } from '../public/eyes.js';

const det = (name, originX, originY, width, height, score = 0.8) => ({ categories: [{ categoryName: name, score }], boundingBox: { originX, originY, width, height } });

test('a chair low in the middle of the frame is close and in the path; a far person is not', () => {
  // 1440x1920 portrait frame, 85 degree ultra-wide.
  const items = toItems([
    det('chair', 600, 1300, 260, 520),   // bottom at 1820 of 1920: close, centered
    det('person', 100, 600, 180, 520),   // bottom at 1120: a few steps away, on the left
    det('cup', 700, 900, 40, 50),         // ignored: not something to walk into
  ], 1440, 1920, 85);
  assert.equal(items.length, 2);
  const chair = items.find(i => i.name === 'chair'), person = items.find(i => i.name === 'person');
  assert.ok(chair.steps <= 2, `chair steps ${chair.steps}`);
  assert.equal(chair.inPath, true);
  assert.ok(person.steps >= 3 && person.steps <= 10, `person steps ${person.steps}`);
  assert.equal(person.inPath, false);
  assert.ok(person.x < 0.35);
});

test('feet cut off: a person filling the frame height is near; something touching the bottom is right here', () => {
  const [near] = toItems([det('person', 500, 50, 500, 1870)], 1440, 1920, 85);
  assert.ok(near.steps <= 2, `steps ${near.steps}`);
  const [here] = toItems([det('dining table', 300, 1200, 800, 720)], 1440, 1920, 85);
  assert.equal(here.steps, 1);
  assert.equal(here.name, 'table');
});

test('only steady detections count: one flicker frame is never reported', () => {
  const steady = makeSteady();
  const chair = { name: 'chair', x: 0.5 }, ghost = { name: 'person', x: 0.2 };
  assert.deepEqual(steady([chair, ghost]).map(i => i.name), ['chair', 'person']); // first frame: nothing to compare yet
  assert.deepEqual(steady([chair]).map(i => i.name), ['chair']);
  assert.deepEqual(steady([chair]).map(i => i.name), ['chair']);
  assert.deepEqual(steady([chair, ghost]).map(i => i.name), ['chair']); // the person was seen in only 2 of 4 frames
});
