// Actual arrival handler and actual voice cancellation/seq; no network/audio hardware.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const arrive = source.match(/function arrive\([^\n]*\) \{[\s\S]*?\n\}/)?.[0]; assert(arrive);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const h = loadVoice(fileURLToPath(new URL('../public/voice.js', import.meta.url)));
  h.voice.init(); h.voice.ctx = new h.context.window.AudioContext();
  const field = { label: 'Name', say: 'Write your name.', hint: '' };
  const S = { epoch: 2, i: 0, mode: 'guide', fields: [field], sim: null, voicePaused: false };
  const app = { dataset: {} };
  Object.assign(h.context, { S, app, IOS: false, setMode: value => { S.mode = value; }, anchorOf: () => ({ x: .2, y: .3 }),
    buzz() {}, say: (...args) => h.voice.say(...args), t: () => ({ stop: 'Stop.', coach: 'Coaching.', ruler: 'Use a ruler.' }) });
  vm.runInContext(arrive, h.context);
  h.context.arrive(field);
  return { ...h, S, app, field };
}
test('normal coaching completion offers one ruler tip for the same field', async () => {
  const f = fixture(); f.finishSystem(); await flush();
  assert.deepEqual(f.system.map(x => x.text), ['Stop. Write your name. Coaching.', 'Use a ruler.']);
  assert.equal(f.S.rulerSaid, true);
});
for (const change of ['wake', 'stop', 'new speech', 'epoch', 'index', 'field', 'mode'])
test(`${change} invalidates the coaching continuation before its ruler tip`, async () => {
  const f = fixture();
  if (change === 'wake') { f.voice.stop(); f.app.dataset.talk = 'listening'; }
  if (change === 'stop') { f.voice.stop(); f.S.voicePaused = true; f.app.dataset.talk = 'paused'; }
  if (change === 'new speech') f.voice.say('New question.');
  if (change === 'epoch') f.S.epoch++;
  if (change === 'index') { f.S.fields.push(f.field); f.S.i = 1; }
  if (change === 'field') f.S.fields[0] = { ...f.field };
  if (change === 'mode') f.S.mode = 'confirm';
  if (!['wake', 'stop', 'new speech'].includes(change)) f.finishSystem();
  await flush(); assert(!f.system.some(x => x.text === 'Use a ruler.')); assert.notEqual(f.S.rulerSaid, true);
});
test('cancel then resume before the promise continuation still cannot replay the ruler', async () => {
  const f = fixture(); f.voice.stop(); f.S.voicePaused = true; f.S.voicePaused = false;
  await flush(); assert(!f.system.some(x => x.text === 'Use a ruler.'));
});
