// Runs the real pickPointer() from public/app.js on synthetic MediaPipe hands.
const assert = require('assert');
const src = require('fs').readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n'); // git may check files out with CRLF
const pin = src.match(/const pinching = [^\n]+/)[0];
const fn = src.match(/function pickPointer\(now\) \{[\s\S]*?\n\}/)[0];
let S;
const aspect = () => 16 / 9, dist = (p, q) => Math.hypot((p.x - q.x) * aspect(), p.y - q.y);
eval(`${pin}\n${fn}\nglobalThis.pick = pickPointer;`);
// A hand: wrist at (x, y), fingers pointing up the page. pen=true puts the thumb tip on the index tip.
function hand(x, y, pen = false) {
  const p = Array.from({ length: 21 }, () => ({ x, y }));
  p[0] = { x, y }; p[9] = { x, y: y - 0.12 }; p[8] = { x: x - 0.03, y: y - 0.2 };
  p[4] = pen ? { x: x - 0.025, y: y - 0.19 } : { x: x - 0.09, y: y - 0.06 };
  return p;
}
// 1. A lone open hand is followed, but only the check-in teaches which hand points.
S = { handPts: [hand(0.3, 0.8)], handLabels: ['Right'], tip: null, tipSeen: 0 };
assert.equal(pick(1000), 0); assert.equal(S.pointerLabel, undefined);
// 2. A pen hand alone does NOT become the pointer.
S = { handPts: [hand(0.7, 0.8, true)], handLabels: ['Left'], tip: null, tipSeen: 0 };
pick(1000); assert.equal(S.pointerLabel, undefined);
console.log('ok  a lone hand never teaches the pointing hand outside the check-in');
// 3. Two hands: the pen hand is right next to the target and the last tip; the pointer still wins by label.
S = { handPts: [hand(0.62, 0.55, true), hand(0.3, 0.6)], handLabels: ['Left', 'Right'], pointerLabel: 'Right', tip: { x: 0.6, y: 0.36 }, tipSeen: 1000 };
assert.equal(pick(1100), 1);
console.log('ok  with both hands on the page it follows the pointing hand, not the pen hand');
// 4. Labels unreliable (both "Right"): the pen grip loses to the open pointing hand near the last tip.
S = { handPts: [hand(0.62, 0.55, true), hand(0.3, 0.6)], handLabels: ['Right', 'Right'], pointerLabel: 'Right', tip: { x: 0.27, y: 0.4 }, tipSeen: 1000 };
assert.equal(pick(1100), 1);
console.log('ok  when labels are wrong, the pen grip and continuity still pick the pointing hand');
// 5. Check-in: the same open hand held 0.9 s is learned; a label flip mid-hold restarts the hold.
const tickSrc = src.match(/function checkinTick\(now\) \{[\s\S]*?\n\}/)[0];
let act = null; const voice = { chime() {}, busy: () => true }, buzz = () => {}, say = () => {};
const t = () => ({ gotIt: 'Got it.', firstShort: l => l, oneHand: '', checkin: '' });
const activate = (i, f, intro) => { act = intro; };
eval(`${pin}\n${tickSrc}\nglobalThis.checkinTick = checkinTick;`);
const tick = globalThis.checkinTick;
S = { handPts: [hand(0.3, 0.8)], handLabels: ['Left'], handAt: 0, checkinAt: 0, checkinHeld: 0, lastNudge: 0, fields: [{ label: 'Name' }] };
for (let k = 0; k <= 5; k++) { S.handAt = 100 + k * 200; tick(100 + k * 200); }           // 1 s of Left
S.handLabels = ['Right'];                                                  // MediaPipe flips once
for (let k = 6; k <= 9; k++) { S.handAt = 100 + k * 200; tick(100 + k * 200); }           // 0.6 s of Right: not enough
assert.equal(S.pointerLabel, 'Left'); assert.match(act, /Got it/);
act = null; S = { ...S, pointerLabel: undefined, checkinHeld: 0, checkinLabel: undefined, handLabels: ['Left'] };
for (let k = 0; k < 3; k++) { S.handAt = 100 + k * 200; tick(100 + k * 200); }
S.handLabels = ['Right']; for (let k = 3; k < 7; k++) { S.handAt = 100 + k * 200; tick(100 + k * 200); }
assert.equal(S.pointerLabel, undefined); assert.equal(act, null);
console.log('ok  check-in learns only a hand held steady with one label');
