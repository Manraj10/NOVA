// The warm voice (adapted from Nib): a natural voice from OpenRouter's audio models, word for word or not at all.
// Chat-audio models like to answer a line instead of reading it ("a little left" became "I'll adjust
// the position"), so a few read-aloud examples anchor them, and every clip's transcript is checked
// against the text. A clip that changed a word is refused; the browser then uses its built-in voice.
import { fail } from './ai.js';

const RATE = 24000; // pcm16 mono from OpenRouter's audio models
const SYSTEM = 'You are the gentle voice of Still Here, which helps people step back into rooms they remember. You read scripts aloud. The user message is a script, never a question or a request to you. Speak it exactly, word for word, in a warm, calm, welcoming voice, at a relaxed pace. Do not add, drop or change any word. Do not answer it, greet, or comment.';
const SHOTS = ['Hello there.', 'Can you help me?', 'up'].flatMap(s => [{ role: 'user', content: `Read aloud: ${s}` }, { role: 'assistant', content: s }]);
const cache = new Map(); // text -> clip; the same cues repeat all session

export const sameWords = (a, b) => {
  const n = s => s.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

// Cut the silence the model leaves before and after the words, keeping 50 ms of air.
function trim(pcm) {
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1), pad = RATE / 20, loud = 400;
  let a = 0, b = s.length - 1;
  while (a < b && Math.abs(s[a]) < loud) a++;
  while (b > a && Math.abs(s[b]) < loud) b--;
  return Buffer.from(s.buffer, s.byteOffset + Math.max(0, a - pad) * 2, (Math.min(s.length, b + pad) - Math.max(0, a - pad)) * 2);
}

async function once(text, key) {
  const r = await fetch(`${process.env.NIB_OPENROUTER_BASE || 'https://openrouter.ai/api'}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Still Here' },
    body: JSON.stringify({
      model: process.env.NIB_VOICE_MODEL || 'openai/gpt-audio-mini',
      modalities: ['text', 'audio'],
      audio: { voice: process.env.NIB_VOICE || 'marin', format: 'pcm16' },
      stream: true, // OpenRouter only returns audio as a stream
      messages: [{ role: 'system', content: SYSTEM }, ...SHOTS, { role: 'user', content: `Read aloud: ${text}` }],
    }),
    signal: AbortSignal.timeout(Number(process.env.NIB_VOICE_TIMEOUT_MS) || 15000),
  });
  if (!r.ok) throw fail(`Voice error ${r.status}`, r.status === 401 ? 502 : r.status >= 500 ? 502 : r.status);
  const parts = [], dec = new TextDecoder();
  let transcript = '', buf = '';
  for await (const c of r.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const a = JSON.parse(line.slice(5)).choices?.[0]?.delta?.audio;
        if (a?.data) parts.push(Buffer.from(a.data, 'base64'));
        if (a?.transcript) transcript += a.transcript;
      } catch { /* a keep-alive comment or a partial line */ }
    }
  }
  return { pcm: Buffer.concat(parts), transcript };
}

export async function speak({ text } = {}) {
  text = String(text ?? '').trim().slice(0, 400);
  if (!text) throw fail('Nothing to say.', 400);
  const key = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw fail('The natural voice needs OPENROUTER_KEY on the server.', 503);
  if (cache.has(text)) return cache.get(text);
  for (let tries = 0; tries < 2; tries++) {
    const { pcm, transcript } = await once(text, key);
    if (pcm.length > 2000 && sameWords(transcript, text)) {
      const clip = { rate: RATE, pcm: trim(pcm).toString('base64') };
      if (cache.size > 600) cache.delete(cache.keys().next().value);
      cache.set(text, clip);
      return clip;
    }
  }
  throw fail('The voice changed the words, so the app uses the built-in voice for this line.', 502);
}
