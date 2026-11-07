// Runs the real setTip() One Euro filter from public/app.js on synthetic fingertip tracks.
const assert = require('assert');
const src = require('fs').readFileSync(process.argv[2], 'utf8');
const block = src.match(/const EURO = [\s\S]*?\nfunction setTip\(x, y, now\) \{[\s\S]*?\n\}/)[0];
let S = { trail: [] };
eval(`${block}\nglobalThis.setTip = setTip;`);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
// 1. Resting finger with ±0.6% jitter (about 2 mm): output should barely move.
S = { trail: [] };
const raw = [], out = [];
for (let i = 0; i < 90; i++) { const x = 0.5 + rnd() * 0.012, y = 0.5 + rnd() * 0.012; raw.push(x); setTip(x, y, 1000 + i * 33); out.push(S.tip.x); }
const sd = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
const r1 = sd(raw.slice(30)), r2 = sd(out.slice(30));
console.log(`resting: raw jitter ${(r1 * 100).toFixed(2)}%, filtered ${(r2 * 100).toFixed(2)}% (${(r1 / r2).toFixed(1)}x steadier)`);
assert.ok(r2 < r1 / 2.5, 'filter should cut resting jitter a lot');
// 2. Fast slide: 0.2 -> 0.8 of the frame in 0.5 s, then hold. Lag after the hold starts should be small.
S = { trail: [] };
let t = 5000;
for (let i = 0; i <= 15; i++, t += 33) setTip(0.2 + 0.6 * i / 15, 0.5, t);
for (let i = 0; i < 6; i++, t += 33) setTip(0.8, 0.5, t);
console.log(`fast slide: 200 ms after stopping, tip at ${S.tip.x.toFixed(3)} (target 0.800)`);
assert.ok(Math.abs(S.tip.x - 0.8) < 0.02, 'should catch up within ~2% of the frame in 200 ms');
console.log('ok  One Euro: steady at rest, quick when moving');
