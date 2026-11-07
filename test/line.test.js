// Stay on the line: a pen that drifts low gets "a little up" once, then tones; the end of the blank is said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // git may check files out with CRLF
const grab = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)) + 2);

test('drift low says "a little up", a straight line stays quiet, the end is announced', () => {
  const said = [], beeps = [];
  const S = { fields: [{ kind: 'text', x0: 0.2, x1: 0.6, y0: 0.40, y1: 0.43 }], i: 0, pointerIdx: 0, handPts: [], handAt: 0 };
  const voice = { speaking: false, beep: f => beeps.push(f), cueWord: (d, near) => (near ? `a little ${d}` : d) };
  const t = () => ({ lineEnd: 'End of the line.' });
  const pinching = h => h.pen;
  const say = text => said.push(text);
  const hand = (x, y) => { const h = []; h[4] = { x, y }; h[8] = { x, y }; h.pen = true; return h; };
  const run = new Function('S', 'voice', 't', 'pinching', 'say', `${grab('penPoint')}\n${grab('keepLine')}\nreturn keepLine;`)(S, voice, t, pinching, say);
  let now = 1000;
  const step = (x, y) => { now += 33; S.handAt = now; S.handPts = [{ pointer: true, 4: { x: 0.18, y: 0.415 }, 8: { x: 0.18, y: 0.415 } }, hand(x, y)]; run(now); };
  for (let k = 0; k < 30; k++) step(0.22 + k * 0.002, 0.415); // steady writing on the line
  assert.deepEqual(said, []);
  for (let k = 0; k < 40; k++) step(0.28 + k * 0.002, 0.415 + Math.min(k, 10) * 0.004); // sinks about a line
  assert.deepEqual(said, ['a little up']);
  assert.ok(beeps.length >= 1, 'tones keep going while off the line');
  for (let k = 0; k < 30; k++) step(0.36 + k * 0.009, 0.415); // back on the line, to the end
  assert.equal(said.at(-1), 'End of the line.');
});
