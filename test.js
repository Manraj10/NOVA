// Self-check: fakes each provider's API locally and runs Nib's three AI jobs through it.
// Proves request shapes and response parsing without spending real keys.  Run: node test.js
import http from 'node:http';
import assert from 'node:assert/strict';

const seen = [];
const PARSE = { title: 'Clinic form', fields: [{ label: 'Full name', kind: 'text', box_2d: [180, 330, 220, 920], say: 'Write your full name.', hint: '' }, { label: 'Bad', kind: 'weird', box_2d: [1, 2], say: '', hint: '' }] };
const READ = { text: 'Alex Kim', legible: true, spoken: 'You wrote Alex Kim.' };
const ASK = { say: 'Skipping it.', action: 'skip', field: -1, lang: 'en' };
const REVIEW = { summary: 'One place is still empty.', missing: [{ label: 'Initials', kind: 'text', box_2d: [700, 100, 740, 400], say: 'Write your initials.', hint: '' }] };
const FIND = { say: 'The total is $24.50.', action: 'find', field: -1, lang: 'en', box_2d: [800, 600, 850, 900] };
const LOST = { say: "I don't see a moon on this page.", action: 'find', field: -1, lang: 'en', box_2d: [] };
const pick = body => (body.includes('close-up') ? READ : body.includes('finished filling in') ? REVIEW
  : body.includes('where is the total') ? FIND : body.includes('where is the moon') ? LOST : body.includes('just said') ? ASK : PARSE);

let rejectSchemas = false; // a route that refuses response_format, to prove the plain-JSON retry
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const b = JSON.parse(body);
  seen.push({ url: req.url, headers: req.headers, body: b });
  let answer = JSON.stringify(pick(body));
  res.setHeader('content-type', 'application/json');
  if (req.url.includes('dead-model')) { res.statusCode = 404; return res.end('{"error":{"message":"not found"}}'); }
  if (b.model === 'dead-model' || (rejectSchemas && b.response_format)) { res.statusCode = 400; return res.end('{"error":{"message":"dead-model is not a valid model ID"}}'); }
  if (b.model === 'fenced-model') answer = `Here it is:\n\`\`\`json\n${answer}\n\`\`\``;
  if (req.url.startsWith('/v1beta/models/')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
  if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  if (req.url.startsWith('/v1/messages')) return res.end(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
    content: [{ type: 'text', text: answer }], usage: { input_tokens: 1, output_tokens: 1 },
  }));
  res.statusCode = 404;
  res.end('{}');
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, { NIB_GEMINI_BASE: base, NIB_OPENAI_BASE: base, NIB_ANTHROPIC_BASE: base, NIB_OPENROUTER_BASE: base });
const KEYS = ['OPENROUTER_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const only = key => { for (const k of KEYS) delete process.env[k]; process.env[key] = 'test-key'; };

const ai = await import('./lib/ai.js');
const IMG = 'data:image/jpeg;base64,/9j/AAAA';
const fields = [{ label: 'Full name', kind: 'text', done: false }];

for (const [p, key] of [['openrouter', 'OPENROUTER_KEY'], ['gemini', 'GEMINI_API_KEY'], ['claude', 'ANTHROPIC_API_KEY'], ['openai', 'OPENAI_API_KEY']]) {
  only(key);
  assert.equal(ai.provider(), p);
  seen.length = 0;

  const form = await ai.parseForm({ image: IMG, lang: 'en' });
  assert.equal(form.title, 'Clinic form');
  assert.equal(form.fields.length, 1, `${p}: malformed field dropped`);
  assert.deepEqual([form.fields[0].x0, form.fields[0].y0, form.fields[0].x1, form.fields[0].y1], [0.33, 0.18, 0.92, 0.22]);

  const read = await ai.readField({ image: IMG, label: 'Full name', kind: 'text', lang: 'en' });
  assert.equal(read.text, 'Alex Kim');

  const answer = await ai.ask({ question: 'skip this one', image: IMG, fields, current: 0, mode: 'guide', lang: 'en' });
  assert.equal(answer.action, 'skip');

  const req = seen[0];
  if (p === 'gemini') {
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    const s = req.body.generationConfig.responseSchema;
    assert.equal(s.type, 'OBJECT');
    assert.ok(!('additionalProperties' in s), 'gemini schema stripped');
    assert.equal(req.body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
  }
  if (p === 'claude') {
    assert.ok(req.headers['x-api-key'] === 'test-key' || req.headers.authorization === 'Bearer test-key', 'claude key sent');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.fallbacks, 'default');
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.equal(req.body.output_config.effort, 'medium');
    assert.equal(req.body.messages[0].content[0].source.type, 'base64');
  }
  if (p === 'openai') {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(req.body.response_format.json_schema.strict, true);
    assert.ok(req.body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  }
  if (p === 'openrouter') {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(req.body.model, 'google/gemini-3.8-flash');
    assert.equal(req.body.provider.require_parameters, true);
    assert.equal(req.body.response_format.json_schema.strict, true);
  }
  console.log(`ok  ${p}: parse, read and ask round-trip`);
}

// OpenRouter: the hacker guide's other key name, a bad model name, fenced JSON, and a route that rejects schemas.
only('OPENROUTER_API_KEY');
assert.equal(ai.provider(), 'openrouter');
process.env.OPENROUTER_MODEL = 'dead-model';
seen.length = 0;
assert.equal((await ai.parseForm({ image: IMG })).fields.length, 1);
assert.deepEqual(seen.map(s => s.body.model), ['dead-model', 'google/gemini-3.8-flash']);
process.env.OPENROUTER_MODEL = 'fenced-model';
assert.equal((await ai.parseForm({ image: IMG })).fields.length, 1);
rejectSchemas = true;
seen.length = 0;
assert.equal((await ai.parseForm({ image: IMG })).fields.length, 1);
assert.ok(!seen.at(-1).body.response_format && seen.at(-1).body.messages[0].content[0].text.includes('JSON Schema'), 'plain-JSON retry');
rejectSchemas = false;
delete process.env.OPENROUTER_MODEL;
console.log('ok  openrouter: other key name, bad model, fenced JSON, schema-less retry');

// "Where is…" comes back with a box to guide the finger to; a find with no usable box is only spoken.
// The final check returns places the first read missed.
only('GEMINI_API_KEY');
const spot = await ai.ask({ question: 'where is the total', image: IMG, fields: [], current: -1, mode: 'idle', lang: 'en' });
assert.equal(spot.action, 'find');
assert.deepEqual(spot.box, { x0: 0.6, y0: 0.8, x1: 0.9, y1: 0.85 });
const lost = await ai.ask({ question: 'where is the moon', image: IMG, fields: [], current: -1, mode: 'idle', lang: 'en' });
assert.equal(lost.action, 'none');
assert.equal(lost.box, null);
const rev = await ai.reviewForm({ image: IMG, fields: [{ label: 'Full name', done: true, answer: 'Alex Kim' }], lang: 'en' });
assert.equal(rev.missing.length, 1);
assert.equal(rev.missing[0].label, 'Initials');
assert.equal(rev.summary, 'One place is still empty.');
console.log('ok  find returns a box, a boxless find is spoken, review returns missed places');

// A retired Gemini model name falls through to the next one.
only('GEMINI_API_KEY');
process.env.GEMINI_MODEL = 'dead-model';
assert.equal((await ai.parseForm({ image: IMG })).fields.length, 1);
console.log('ok  gemini: retired model falls back');

// No key at all is a clear 503, not a crash.
delete process.env.GEMINI_API_KEY;
await assert.rejects(ai.parseForm({ image: IMG }), e => e.status === 503);
await assert.rejects(ai.ask({ question: '' }), e => e.status === 400);
console.log('ok  missing key and empty question fail cleanly');

server.close();
