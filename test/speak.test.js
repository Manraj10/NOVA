// The natural voice must say the line word for word or not at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let transcript = '';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const pcm = Buffer.alloc(24000 * 2); // one second of "speech"
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 400 < 200 ? 6000 : -6000, i);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm.toString('base64'), transcript } } }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => server.listen(0, r));
process.env.NIB_OPENROUTER_BASE = `http://localhost:${server.address().port}`;
process.env.OPENROUTER_KEY = 'test';
const { speak, sameWords } = await import('../lib/speak.js');

test('a clip that reads the line exactly is returned, then cached', async () => {
  transcript = 'Stop. Write your last name here.';
  const a = await speak({ text: 'Stop. Write your last name here.' });
  assert.equal(a.rate, 24000);
  assert.ok(a.pcm.length > 1000);
  transcript = 'something else entirely';
  assert.equal(await speak({ text: 'Stop. Write your last name here.' }), a);
});

test('a clip that changed the words is refused, so the built-in voice speaks it', async () => {
  transcript = "Understood. I'll adjust the position slightly to the left.";
  await assert.rejects(speak({ text: 'a little left' }), e => e.status === 502);
  await assert.rejects(speak({ text: '' }), e => e.status === 400);
  assert.ok(sameWords('Para. Escribe tu apellido aquí.', 'para escribe tu apellido aqui'));
  server.close();
});
