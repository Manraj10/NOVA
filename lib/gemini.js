// Gemini provider (REST). Boxes on a 0-1000 grid are native to this model family.
import { fail } from './ai.js';

const BASE = () => process.env.NIB_GEMINI_BASE || 'https://generativelanguage.googleapis.com';
// ponytail: a retired model name (404) falls through to the next instead of failing on stage
const MODELS = () => [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest'].filter(Boolean))];

// Gemini's responseSchema is an OpenAPI subset: upper-case types, no additionalProperties.
function toGemini(s) {
  if (Array.isArray(s)) return s.map(toGemini);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    out[k] = k === 'type' ? String(v).toUpperCase() : k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, d]) => [p, toGemini(d)])) : toGemini(v);
  }
  return out;
}

export async function generate({ prompt, image, schema }) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  let last = '';
  for (const model of MODELS()) {
    const r = await fetch(`${BASE()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGemini(schema), temperature: 0 },
      }),
      signal: AbortSignal.timeout(45000),
    }).catch(e => { throw fail(e.name === 'TimeoutError' ? 'Reading took too long. Try again.' : 'Could not reach Gemini. Check the internet connection.', 504); });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) { last = j.error?.message || `model ${model} not found`; continue; }
    if (r.status === 429) throw fail('Gemini is rate-limiting this key. Wait a few seconds and try again.', 429);
    if (r.status === 401 || r.status === 403) throw fail('Gemini rejected the API key. Check GEMINI_API_KEY in nib/.env.', 502);
    if (!r.ok) throw fail(`Gemini error: ${j.error?.message || r.status}`, 502);
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    try { return JSON.parse(text); } catch { throw fail('Gemini sent back something unreadable. Try again.', 502); }
  }
  throw fail(`Gemini error: ${last}`, 502);
}
