// Codex repro: a readback that comes back after the page was re-read must not enter confirm on the new page.
const assert = require('assert');
const src = require('fs').readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n'); // git may check files out with CRLF
const code = src.match(/async function finishWriting\(\) \{[\s\S]*?\n\}/)[0];
let S, spoken = [], release;
const t = () => ({ lift: 'Lift.', blank: 'Blank.', confirm: 'Keep?', unsure: '', wrote: a => `You wrote ${a}.` });
const say = x => { spoken.push(x); return Promise.resolve(); };
const setMode = m => { S.mode = m; }, setCue = () => {}, renderLists = () => {}, speakErr = () => {};
const readback = { show() {}, result() {}, hide() {} };
const snapshot = () => 'img', expand = f => f, handAway = async () => true, wait = () => Promise.resolve();
const api = () => new Promise(r => { release = r; });
eval(`${code}\nglobalThis.fw = finishWriting;`);
(async () => {
  S = { mode: 'write', i: 0, epoch: 1, sim: null, fields: [{ label: 'Name' }] };
  const run = fw();
  await new Promise(r => setTimeout(r, 10));
  S.epoch = 2; S.fields = [{ label: 'New field' }]; S.mode = 'guide'; // the page was re-read meanwhile
  release({ text: 'Alex Kim', legible: true, spoken: 'You wrote Alex Kim.' });
  await run;
  assert.equal(S.mode, 'guide');
  assert.equal(S.fields[0].answer, undefined);
  assert.ok(!spoken.some(x => /Alex/.test(x)));
  console.log('ok  a late readback after a re-read is dropped, not confirmed on the new page');
  // Same page, no re-read: it proposes normally.
  spoken = [];
  S = { mode: 'write', i: 0, epoch: 3, sim: null, fields: [{ label: 'Name' }] };
  const run2 = fw();
  await new Promise(r => setTimeout(r, 10));
  release({ text: 'Alex Kim', legible: true, spoken: 'You wrote Alex Kim.' });
  await run2;
  assert.equal(S.mode, 'confirm');
  assert.equal(S.fields[0].answer, 'Alex Kim');
  console.log('ok  an on-time readback still proposes the answer for confirmation');
})().catch(e => { console.error(e); process.exit(1); });
