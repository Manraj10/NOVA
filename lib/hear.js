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
        // Don't prime the model with the name: told "Nib may be spoken", it heard "Nib" in beeps and noise,
        // so the app woke up when nobody called it. The spelling hint only applies to real speech.
        { type: 'text', text: `Transcribe the human speech in this audio exactly, word for word, in its original language (probably ${{ es: 'Spanish', hi: 'Hindi', zh: 'Chinese' }[lang] || 'English'}). Output only the transcript. If there is no clearly spoken human word (only beeps, tones, music, noise, breathing or silence), output exactly [none] and nothing else. Never guess words. Spelling: if a person clearly says the made-up name that sounds like "nib", write it as Nib.` },
        { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
      ] }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(`Listening failed: ${j.error?.message || r.status}`, 502);
  let text = String(j.choices?.[0]?.message?.content ?? '').replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 2000); // a spoken memory can run long; Memory records up to 40 s
  // "[none]", "<noise>", "(silence)", "*beep*": not words, so nothing was said.
  if (/^[[<(*].*[\]>)*]$/.test(text) || /^(none|noise|silence|music|beep(s|ing)?|inaudible|no speech)\.?$/i.test(text)) text = '';
  return { text };
}
