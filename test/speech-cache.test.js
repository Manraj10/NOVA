// Inert transport: no key, external network, microphone or audio playback is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { speak } from '../lib/speak.js';

const requests = [];
let transcript = '', failOnce = false;
process.env.OPENROUTER_KEY = 'synthetic-test-key';
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  requests.push(body);
  const text = failOnce ? (failOnce = false, 'different content') : transcript;
  const pcm = Buffer.alloc(48000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 400 < 200 ? 6000 : -6000, i);
  const data = JSON.stringify({ choices: [{ delta: { audio: { data: pcm.toString('base64'), transcript: text } } }] });
  return new Response(`data: ${data}\n\ndata: [DONE]\n\n`, { status: 200 });
};

test('same script is separately generated and cached for each requested language', async () => {
  transcript = 'OK';
  const en = await speak({ text: 'OK', lang: 'en' });
  const es = await speak({ text: 'OK', lang: 'es' });
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /Read the script in English\./);
  assert.match(requests[1].messages[0].content, /Read the script in Spanish\./);
  assert.notEqual(en, es);
  assert.equal(await speak({ text: 'OK', lang: 'en' }), en);
  assert.equal(requests.length, 2);
});

test('changing configured voice/model does not reuse a previous clip', async () => {
  transcript = 'OK';
  const before = requests.length;
  process.env.NIB_VOICE = 'test-voice';
  await speak({ text: 'OK', lang: 'en' });
  process.env.NIB_VOICE_MODEL = 'test-model';
  await speak({ text: 'OK', lang: 'en' });
  assert.equal(requests.length, before + 2);
  delete process.env.NIB_VOICE;
  delete process.env.NIB_VOICE_MODEL;
});

test('changed decimal speech is refused after exactly two attempts and never cached', async () => {
  const before = requests.length;
  transcript = 'Read 15';
  await assert.rejects(speak({ text: 'Read 1.5', lang: 'en' }), e => e.status === 502);
  assert.equal(requests.length, before + 2);
  transcript = 'Read 1.5';
  const clip = await speak({ text: 'Read 1.5', lang: 'en' });
  assert.ok(clip.pcm.length > 1000);
  assert.equal(requests.length, before + 3, 'a rejected script is retried on a later valid request');
});

test('a changed first attempt is discarded and the second exact transcript is used', async () => {
  transcript = 'Lift both hands.';
  failOnce = true;
  const before = requests.length;
  const clip = await speak({ text: 'Lift both hands.', lang: 'en' });
  assert.ok(clip.pcm.length > 1000);
  assert.equal(requests.length, before + 2);
});

for (const [name, script, changed] of [
  ['leading decimal', 'Write .5', 'Write 5'],
  ['spaced decimal', 'Read 1 .5', 'Read 1 5'],
  ['percent', 'Write 5%', 'Write 5'],
  ['currency', 'Write $5', 'Write €5'],
  ['Unicode minus', 'Wait －5', 'Wait 5'],
  ['email', 'alex.rivera@example.com', 'alex/rivera@example,com'],
  ['numeric letter boundary', 'Use A1', 'Use A 1'],
  ['acronym case', 'Contact US', 'Contact us'],
]) {
  test(`server refuses changed ${name} twice, without caching the invalid clip`, async () => {
    const before = requests.length;
    transcript = changed;
    await assert.rejects(speak({ text: script, lang: 'en' }), e => e.status === 502);
    assert.equal(requests.length, before + 2);
    transcript = script;
    const clip = await speak({ text: script, lang: 'en' });
    assert.ok(clip.pcm.length > 1000);
    assert.equal(requests.length, before + 3, 'later exact speech must still be generated');
    assert.equal(await speak({ text: script, lang: 'en' }), clip);
    assert.equal(requests.length, before + 3, 'only the exact clip enters cache');
  });
}

test('canonical Unicode and whitespace equivalents pass the full transport', async () => {
  transcript = '  si\u0301\n';
  const before = requests.length;
  const clip = await speak({ text: 'sí', lang: 'es' });
  assert.ok(clip.pcm.length > 1000);
  assert.equal(requests.length, before + 1);
});

test('prose punctuation changes use system-voice fallback rather than broad token equivalence', async () => {
  transcript = 'Move up';
  const before = requests.length;
  await assert.rejects(speak({ text: 'Move up.', lang: 'en' }), e => e.status === 502);
  assert.equal(requests.length, before + 2);
});

// Long arrive/coaching instructions must never become a validated partial clip.
test('401-character script is refused before generation rather than silently truncated', async () => {
  const before = requests.length;
  await assert.rejects(speak({ text: 'x'.repeat(401), lang: 'en' }), e => e.status === 413);
  assert.equal(requests.length, before);
});
test('400-character script remains eligible and is validated in full', async () => {
  const before = requests.length; transcript = 'z'.repeat(400);
  await speak({ text: transcript, lang: 'en' });
  assert.equal(requests.length, before + 1);
  assert.ok(requests.at(-1).messages.at(-1).content.endsWith(transcript));
});
