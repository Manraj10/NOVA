// Nib's ears on the server: one short spoken phrase (16 kHz mono WAV) in, its words out.
// Browser speech recognizers can't be trusted here: iPhone Safari's won't restart without a tap,
// and Brave has none. A fast Gemini model transcribes in about a second.
import { fail } from './ai.js';

export async function hear({ audio, lang } = {}) {
  if (typeof audio !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(audio) || audio.length > 2e6) throw fail('Send the phrase as base64 WAV.', 400);
  const key = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw fail('Listening needs OPENROUTER_KEY in nib/.env.', 503);
  const r = await fetch(`${process.env.NIB_OPENROUTER_BASE || 'https://openrouter.ai/api'}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Nib' },
    body: JSON.stringify({
      model: process.env.NIB_HEAR_MODEL || 'google/gemini-3.5-flash-lite',
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Transcribe this audio exactly, word for word, in its original language (probably ${{ es: 'Spanish', hi: 'Hindi', zh: 'Chinese' }[lang] || 'English'}). Output only the transcript, nothing else. The assistant's name "Nib" may be spoken. If there is no clear speech, output nothing.` },
        { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
      ] }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(`Listening failed: ${j.error?.message || r.status}`, 502);
  const text = String(j.choices?.[0]?.message?.content ?? '').replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 300);
  return { text };
}
