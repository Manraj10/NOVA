// Runs the real review(), finish(), next() and iou from public/app.js against Codex's failure cases.
const assert = require('assert');
const src = require('fs').readFileSync(process.argv[2], 'utf8');
const grab = re => src.match(re)[0];
const en = eval(`(${src.match(/ {2}en: (\{[\s\S]*?\n {2}\}),\n {2}es:/)[1]})`);
const code = [
  grab(/const iou = \(a, b\) => \{[\s\S]*?\n\};/),
  grab(/async function review\(\) \{[\s\S]*?\n\}/),
  grab(/function finish\(\) \{[\s\S]*?\n\}/),
  grab(/function next\(\) \{[\s\S]*?\n\}/),
].join('\n');
let S, spoken, activated, apiImpl;
const t = () => en, say = s => { spoken = s; return Promise.resolve(); };
const activate = (i, first, intro) => { activated = { i, intro }; S.i = i; S.mode = 'guide'; };
const setMode = m => { S.mode = m; }, setCue = () => {}, renderLists = () => {}, buzz = () => {};
let clear = true;
const handAway = async () => clear, snapshot = () => 'img', wait = () => Promise.resolve();
const api = async (path, body) => apiImpl(path, body);
eval(`${code}\nglobalThis.review = review;`);
const box = (y) => ({ x0: 0.3, y0: y, x1: 0.8, y1: y + 0.04 });
const fields = () => [{ label: 'Name', done: true, answer: 'Alex', ...box(0.2) }, { label: 'Phone', done: true, answer: '412', ...box(0.3) }, { label: 'Date', done: true, skipped: true, ...box(0.4) }];
(async () => {
  // Codex repro 1: the review call fails. It must NOT say "hand it in".
  S = { fields: fields(), i: 1, startedAt: 0, sim: false }; apiImpl = async () => { throw new Error('network'); };
  await review();
  assert.equal(S.mode, 'done'); assert.match(spoken, /couldn't check the whole page/); assert.doesNotMatch(spoken, /hand the form in\./);
  console.log(`ok  failed check: "${spoken}"`);
  // Codex repro 2: the review says "Phone" (already filled) is empty. It must reopen Phone, not finish.
  S = { fields: fields(), i: 1, startedAt: 0, sim: false }; apiImpl = async () => ({ missing: [{ label: 'Phone', ...box(0.3) }] });
  await review();
  assert.equal(activated.i, 1); assert.equal(S.fields[1].done, false); assert.match(activated.intro, /Phone still looks empty/);
  console.log(`ok  reopened: "${activated.intro}"`);
  // A skipped field reported empty stays skipped; nothing else missing, so it finishes, no hand-in (a skip exists).
  S = { fields: fields(), i: 1, startedAt: 0, sim: false }; apiImpl = async () => ({ missing: [{ label: 'Date', ...box(0.4) }] });
  await review();
  assert.equal(S.mode, 'done'); assert.equal(S.fields[2].skipped, true); assert.match(spoken, /You skipped Date/);
  console.log('ok  explicit skips stay skipped');
  // A genuinely new blank is appended and guided to.
  S = { fields: fields(), i: 1, startedAt: 0, sim: false }; apiImpl = async () => ({ missing: [{ label: 'Initials', ...box(0.6) }] });
  await review();
  assert.equal(S.fields.length, 4); assert.equal(activated.i, 3); assert.match(activated.intro, /One more place: Initials/);
  console.log('ok  new blank appended and guided to');
  // Clean review: hand it in.
  S = { fields: fields().slice(0, 2), i: 1, startedAt: 0, sim: false }; apiImpl = async () => ({ missing: [] });
  await review();
  assert.match(spoken, /You can hand the form in\./);
  console.log('ok  clean check says hand it in');
  // Codex: a page still covered by a hand is not checked, so no hand-in line.
  clear = false; S = { fields: fields().slice(0, 2), i: 1, startedAt: 0, sim: false }; apiImpl = async () => ({ missing: [] });
  await review();
  assert.doesNotMatch(spoken, /You can hand the form in./); assert.match(spoken, /couldn't check the whole page/);
  console.log('ok  a covered page is never called checked');
  clear = true;
})().catch(e => { console.error(e); process.exit(1); });
