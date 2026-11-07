// Chat Completions providers: OpenAI, and OpenRouter (the key NOVA hands every team), which speaks
// the same API. Strict JSON schema output, with a plain-JSON retry for routes that reject schemas.
import { fail } from './ai.js';

const VIA = {
  openai: {
    name: 'OpenAI',
    key: () => process.env.OPENAI_API_KEY,
    url: () => `${process.env.NIB_OPENAI_BASE || 'https://api.openai.com'}/v1/chat/completions`,
    // ponytail: unverified newest name first, documented base model as the fallback
    models: () => [process.env.OPENAI_MODEL, 'gpt-5.2', 'gpt-5'],
  },
  openrouter: {
    name: 'OpenRouter',
    key: () => process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY,
    url: () => `${process.env.NIB_OPENROUTER_BASE || 'https://openrouter.ai/api'}/v1/chat/completions`,
    // Gemini Flash is fast and trained on 0-1000 boxes; Claude Opus 5.5 placed 17/17 fields to the
    // millimeter in a blind test on a webcam-style photo, so it is the fallback.
    models: () => [process.env.OPENROUTER_MODEL, 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5'],
    extra: { provider: { require_parameters: true } }, // only route to hosts that honor the schema
  },
};

// Some models wrap JSON in a code fence or a sentence even when asked not to.
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : JSON.parse(text);
}

export async function generate({ prompt, image, schema, via = 'openai' }) {
  const v = VIA[via];
  const models = [...new Set(v.models().filter(Boolean))];
  // Every model with the strict schema first, then the first model once more asking for plain JSON.
  const tries = [...models.map(m => [m, true]), [models[0], false]];
  let last = '';
  for (const [model, strict] of tries) {
    const content = [{ type: 'text', text: strict ? prompt : `${prompt}\nReply with only a JSON object that matches this JSON Schema, no other text:\n${JSON.stringify(schema)}` }];
    if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}`, detail: 'high' } });
    const r = await fetch(v.url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${v.key()}`, 'x-title': 'Nib' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        ...(strict ? { response_format: { type: 'json_schema', json_schema: { name: 'nib', schema, strict: true } }, ...v.extra } : {}),
      }),
      signal: AbortSignal.timeout(45000),
    }).catch(e => { throw fail(e.name === 'TimeoutError' ? 'Reading took too long. Try again.' : `Could not reach ${v.name}. Check the internet connection.`, 504); });
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || `${r.status}`;
    if (r.status === 401) throw fail(`${v.name} rejected the API key. Check the key in nib/.env.`, 502);
    if (r.status === 402) throw fail(`${v.name} says this key is out of credits.`, 502);
    if (r.status === 429) throw fail(`${v.name} is rate-limiting this key. Wait a few seconds and try again.`, 429);
    // Unknown model, no host that takes images or schemas, or a rejected schema: try the next option.
    if (r.status === 400 || r.status === 404 || j.error?.code === 'model_not_found') {
      last = `${model}: ${msg}`;
      console.warn(`[nib] ${v.name} ${model}${strict ? '' : ' (plain JSON)'} failed, trying the next option: ${msg}`);
      continue;
    }
    if (!r.ok) throw fail(`${v.name} error: ${msg}`, 502);
    const out = j.choices?.[0]?.message;
    if (out?.refusal) throw fail('The reader declined this image. Try another photo.', 502);
    const text = typeof out?.content === 'string' ? out.content : (out?.content || []).map(p => p.text || '').join('');
    try { return parseJson(text); } catch { last = `${model}: unreadable reply`; }
  }
  throw fail(`${v.name} error: ${last}`, 502);
}
