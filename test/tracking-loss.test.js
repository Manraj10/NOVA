// Actual tracking + guidance handlers with synthetic landmarks and mocked I/O.
// This checks a timing regression, not real-camera accuracy or intended-user results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function handler(name) {
  const match = source.match(new RegExp(`function ${name}\\(now\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `actual ${name} handler is available`);
  return match[0];
}

function rig(mode = 'guide') {
  const S = { mode, sim: null, fields: [{ label: 'Name' }],
    tip: { x: .4, y: .4 }, tipSeen: 510, arrivedSince: 100,
    handPts: [[]], pointerIdx: 0, onTarget: true };
  let landmarks = [], arrivals = 0, observations = 0;
  const context = {
    S, video: { readyState: 4, currentTime: 2 }, lastVideoTime: 1,
    hands: { detectForVideo() { observations++; return { landmarks }; } },
    pickPointer: () => 0,
    setTip(x, y, now) { S.tip = { x, y }; S.tipSeen = now; },
    target: () => S.fields[0], offset: () => ({ inside: true, d: 0, m: 0 }),
    pace() {}, setCue() {}, say() {}, pageOk: () => true,
    t: () => ({ stop: 'stop' }), voice: { busy: () => false },
    arrive() { arrivals++; }, found() { arrivals++; },
  };
  vm.createContext(context);
  vm.runInContext(`${handler('trackHands')}\n${handler('guide')}`, context);
  return { S, context,
    frame(now, visible) {
      landmarks = visible ? [Array.from({ length: 21 }, () => ({ x: .4, y: .4 }))] : [];
      context.video.currentTime++;
      context.trackHands(now);
      context.guide(now);
    },
    arrivals: () => arrivals, observations: () => observations };
}

for (const mode of ['guide', 'find']) {
  test(`a fresh no-hand frame cannot finish a 50 ms-old ${mode} dwell`, () => {
    const r = rig(mode);
    r.frame(560, false);
    assert.equal(r.observations(), 1);
    assert.equal(r.arrivals(), 0);
    assert.equal(r.S.arrivedSince, 0);
    assert.equal(r.S.onTarget, false);
    assert.equal(r.S.pointerIdx, -1);
  });
}

test('a returning hand starts a new dwell and can still arrive normally', () => {
  const r = rig();
  r.frame(560, false);
  r.frame(580, true);
  assert.equal(r.arrivals(), 0, 'returning after loss must not inherit the old dwell');
  assert.equal(r.S.arrivedSince, 580);
  r.frame(1000, true);
  assert.equal(r.arrivals(), 0, '420 ms is shorter than a full new dwell');
  r.frame(1040, true);
  assert.equal(r.arrivals(), 1, 'a fresh visible tip can complete the new dwell');
});

test('tracking loss also pauses guidance within the first 400 ms of the clock', () => {
  const r = rig();
  r.S.tipSeen = 50;
  r.S.arrivedSince = 1;
  r.frame(100, false);
  assert.equal(r.arrivals(), 0);
  assert.equal(r.S.onTarget, false);
  assert.equal(r.S.arrivedSince, 0);
});

test('a continuously visible hand retains its current dwell', () => {
  const r = rig();
  r.frame(560, true);
  assert.equal(r.arrivals(), 1);
  assert.equal(r.S.arrivedSince, 100);
});

test('a repeated video frame is not mistaken for an empty tracking result', () => {
  const r = rig();
  r.context.video.currentTime = r.context.lastVideoTime;
  r.context.trackHands(560);
  assert.equal(r.observations(), 0);
  assert.equal(r.S.arrivedSince, 100);
  assert.equal(r.S.tipSeen, 510);
});
