// Pulls the real next() and finish() out of public/app.js and runs them with stand-ins.
const assert = require('assert');
const src = require('fs').readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n'); // git may check files out with CRLF
const grab = name => src.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0];
const en = eval(`(${src.match(/ {2}en: (\{[\s\S]*?\n {2}\}),\n {2}es:/)[1]})`);
let S, spoken, activated;
const t = () => en, say = s => { spoken = s; }, activate = n => { activated = n; S.i = n; };
const setMode = m => { S.mode = m; }, setCue = () => {}, renderLists = () => {}, buzz = () => {}, review = () => finish();
eval(`${grab('next')}\n${grab('finish')}\nglobalThis.next = next;`);
const mk = n => Array.from({ length: n }, (_, k) => ({ label: `F${k}`, done: false }));

S = { fields: mk(5), i: 4, startedAt: 0 }; S.fields[0].done = true; S.fields[4].done = true;
next(); assert.equal(activated, 1); console.log('ok  after a jump ahead, wraps back to the first untouched field');

S = { fields: mk(5), i: 1, startedAt: 0 }; S.fields[0].done = S.fields[1].done = true;
next(); assert.equal(activated, 2); console.log('ok  normal order still goes forward');

S = { fields: mk(3).map(f => ({ ...f, done: true })), i: 2, startedAt: 0 };
next(); assert.equal(S.mode, 'done'); assert.match(spoken, /You can hand the form in\./); console.log(`ok  clean finish: "${spoken}"`);

S = { fields: mk(4).map(f => ({ ...f, done: true })), i: 3, startedAt: 0 }; S.fields[1].skipped = true; S.fields[2].review = true;
next(); assert.doesNotMatch(spoken, /hand the form in/); assert.match(spoken, /skipped F1/); assert.match(spoken, /read F2 clearly/);
console.log(`ok  honest finish: "${spoken}"`);
