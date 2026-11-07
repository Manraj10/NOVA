// Memory mode's server handlers, against a local stand-in for OpenRouter: no network, no key, no credit.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQ';
let seen = [], reply = () => ({});
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const b = JSON.parse(body);
  seen.push(b);
  const out = await reply(b);
  if (out.status) { res.writeHead(out.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'busy' } })); }
  if (out.sse) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(out.sse); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
});
await new Promise(r => server.listen(0, r));
after(() => server.close());
process.env.NIB_OPENROUTER_BASE = `http://localhost:${server.address().port}`;
process.env.OPENROUTER_KEY = 'test';
const { MEMORY_ROUTES, ask, spec, scene, back, labels, fix, sound } = await import('../lib/memory.js');

const text = content => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
const picture = url => ({ choices: [{ message: { images: [{ image_url: { url } }] } }] });
beforeEach(() => { seen = []; });

test('every route is mounted under /api/memory/ as a plain async handler', () => {
  assert.deepEqual(Object.keys(MEMORY_ROUTES).sort(), ['ask', 'back', 'fix', 'labels', 'scene', 'sound', 'spec'].map(n => '/api/memory/' + n));
  for (const fn of Object.values(MEMORY_ROUTES)) assert.equal(typeof fn, 'function');
});

test('ask: one question, never repeats one already asked, needs a memory', async () => {
  reply = () => text({ question: 'Who else was in the kitchen?' });
  assert.deepEqual(await ask({ memory: 'my grandmother’s kitchen', answers: ['winter evening'], asked: ['What time of day was it?'] }), { question: 'Who else was in the kitchen?' });
  const prompt = seen[0].messages[0].content;
  assert.match(prompt, /winter evening/);
  assert.match(prompt, /You already asked/);
  await assert.rejects(ask({ memory: '' }), e => e.status === 400);
  reply = () => text('not json');
  await assert.rejects(ask({ memory: 'a room' }), e => e.status === 502);
});

test('spec: merges every answer into one plan, keeps the person’s details, clamps lists', async () => {
  reply = () => text('```json\n' + JSON.stringify({ title: 'Grandma’s kitchen', spoken: ['rotis on the tawa', 'radio playing'], ahead: Array(30).fill('stove'), behind: ['steel almirah'], front_prompt: 'a kitchen', back_prompt: 'an almirah', sound_prompt: 'old songs' }) + '\n```');
  const s = await spec({ memory: 'grandma making rotis', answers: ['the radio was on'] });
  assert.equal(s.title, 'Grandma’s kitchen');
  assert.deepEqual(s.spoken, ['rotis on the tawa', 'radio playing']);
  assert.equal(s.ahead.length, 10);
  assert.match(s.memory, /radio was on/);
  await assert.rejects(spec({ memory: 'x' }), e => e.status === 400);
});

test('scene: text only, wide 21:9, real-photo prompt; a failing painter falls back to the second', async () => {
  reply = b => b.model === 'google/gemini-3.1-flash-image' ? { status: 503 } : picture(PNG);
  assert.deepEqual(await scene({ memory: 'my dad’s study with a typewriter' }), { image: PNG });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].image_config, { aspect_ratio: '21:9' });
  assert.equal(seen[0].messages[0].content.length, 1, 'no image goes in: dictation only');
  assert.match(seen[0].messages[0].content[0].text, /unedited photograph/);
  reply = () => ({ status: 500 });
  await assert.rejects(scene({ memory: 'a room' }), e => e.status === 502);
});

test('back and fix: send the picture, refuse bad input before calling anyone', async () => {
  reply = () => picture(PNG);
  assert.deepEqual(await back({ strip: JPG, spec: { memory: 'kitchen', back_prompt: 'a door' } }), { image: PNG });
  assert.equal(seen[0].messages[0].content[1].image_url.url, JPG);
  assert.deepEqual(await fix({ scene: JPG, correction: 'the radio was on the windowsill' }), { image: PNG });
  assert.match(seen[1].messages[0].content[0].text, /windowsill/);
  const before = seen.length;
  await assert.rejects(back({ strip: 'http://evil.example/x.png' }), e => e.status === 400);
  await assert.rejects(fix({ scene: JPG, correction: '' }), e => e.status === 400);
  assert.equal(seen.length, before);
});

test('labels: only "memory" or "invented", boxes clamped, broken boxes dropped, spoken description kept', async () => {
  reply = () => text({ title: 'Kitchen', narration: 'You step in.', describe: 'In front of you is the stove. Behind you, I added a door.', sound_from: 'radio', elements: [
    { name: 'radio', source: 'memory', box_2d: [100, 200, 300, 400] },
    { name: 'shelf', source: 'photo', box_2d: [-5, 0, 2000, 10] },
    { name: 'ghost', source: 'memory', box_2d: [1, 2] },
  ] });
  const l = await labels({ scene: JPG, spec: { memory: 'a radio', spoken: ['radio'], behind: [] } });
  assert.deepEqual(l.elements.map(e => [e.name, e.source]), [['radio', 'memory'], ['shelf', 'invented']]);
  assert.deepEqual(l.elements[1].box_2d, [0, 0, 1000, 10]);
  assert.match(l.describe, /In front of you/);
  assert.equal(l.sound_from, 'radio');
});

test('sound: collects the streamed mp3 and retries once when Lyria sends nothing', async () => {
  const mp3 = Buffer.alloc(4000, 7).toString('base64');
  let n = 0;
  reply = b => {
    assert.equal(b.stream, true);
    n++;
    return { sse: n === 1 ? 'data: [DONE]\n\n' : `: keep-alive\n\ndata: ${JSON.stringify({ choices: [{ delta: { audio: { data: mp3 } } }] })}\n\ndata: [DONE]\n\n` };
  };
  const s = await sound({ memory: 'old songs on the radio' });
  assert.equal(n, 2);
  assert.equal(Buffer.from(s.audio, 'base64').length, 4000);
});
