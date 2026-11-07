// OpenAI provider (REST, Chat Completions with strict JSON schema output).
import { fail } from './ai.js';

const BASE = () => process.env.NIB_OPENAI_BASE || 'https://api.openai.com';
// ponytail: unverified newest name first, documented base model as the 404 fallback
const MODELS = () => [...new Set([process.env.OPENAI_MODEL, 'gpt-5.2', 'gpt-5'].filter(Boolean))];

export async function generate({ prompt, image, schema }) {
  const content = [{ type: 'text', text: prompt }];
  if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}`, detail: 'high' } });
  let last = '';
  for (const model of MODELS()) {
    const r = await fetch(`${BASE()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_schema', json_schema: { name: 'nib', schema, strict: true } },
      }),
      signal: AbortSignal.timeout(45000),
    }).catch(e => { throw fail(e.name === 'TimeoutError' ? 'Reading took too long. Try again.' : 'Could not reach OpenAI. Check the internet connection.', 504); });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || j.error?.code === 'model_not_found') { last = j.error?.message || `model ${model} not found`; continue; }
    if (r.status === 429) throw fail('OpenAI is rate-limiting this key. Wait a few seconds and try again.', 429);
    if (r.status === 401) throw fail('OpenAI rejected the API key. Check OPENAI_API_KEY in nib/.env.', 502);
    if (!r.ok) throw fail(`OpenAI error: ${j.error?.message || r.status}`, 502);
    const msg = j.choices?.[0]?.message;
    if (msg?.refusal) throw fail('The reader declined this image. Try another photo.', 502);
    try { return JSON.parse(msg?.content || ''); } catch { throw fail('OpenAI sent back something unreadable. Try again.', 502); }
  }
  throw fail(`OpenAI error: ${last}`, 502);
}
