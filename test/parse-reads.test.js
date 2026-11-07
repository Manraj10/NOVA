// Long forms: two reads run at once and the fuller one wins; one failed read doesn't fail the parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const box = n => ({ label: `Field ${n}`, kind: 'text', box_2d: [100 + n * 10, 100, 105 + n * 10, 400], say: 'Write it.', hint: '' });
let replies = [];
const server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  const r = replies.shift();
  res.setHeader('content-type', 'application/json');
  if (r === 'fail') { res.statusCode = 400; return res.end('{"error":{"message":"bad request"}}'); }
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }));
});
await new Promise(r => server.listen(0, r));
process.env.NIB_OPENROUTER_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.OPENROUTER_KEY = 'test';
process.env.OPENROUTER_MODEL = 'only-model';
delete process.env.NIB_PARSE_READS;
const { parseForm } = await import('../lib/ai.js');
const image = 'data:image/jpeg;base64,AAAA';

test('the fuller of two reads wins, and up to 60 places survive', async () => {
  replies = [{ title: 'Short', fields: [box(1)] }, { title: 'Long', fields: Array.from({ length: 70 }, (_, n) => box(n)) }];
  const out = await parseForm({ image });
  assert.equal(out.title, 'Long');
  assert.equal(out.fields.length, 60);
});

test('one failed read still returns the other', async () => {
  replies = [{ title: 'Form', fields: [box(1), box(2)] }, 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'];
  const out = await parseForm({ image });
  assert.equal(out.fields.length, 2);
  server.close();
});
