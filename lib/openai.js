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
  // NVIDIA's API catalog (build.nvidia.com keys). Its vision models don't reliably honor JSON schemas,
  // so it asks for plain JSON with the schema in the prompt, and allows room for 30 fields.
  nvidia: {
    name: 'NVIDIA',
    key: () => process.env.NVIDIA_API_KEY,
    url: () => `${process.env.NIB_NVIDIA_BASE || 'https://integrate.api.nvidia.com'}/v1/chat/completions`,
    models: () => [process.env.NVIDIA_MODEL, 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'google/gemma-4-31b-it'],
    plainOnly: true,
    extraPlain: { max_tokens: 4096, temperature: 0.2 },
  },
};

// Some models wrap JSON in a code fence or a sentence even when asked not to.
function parseJson(raw) {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, ''); // reasoning models may think out loud first
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : JSON.parse(text);
}

export async function generate({ prompt, image, schema, via = 'openai' }) {
  const v = VIA[via];
  const models = [...new Set(v.models().filter(Boolean))];
  // Every model with the strict schema first, then the first model once more asking for plain JSON.
  const tries = v.plainOnly ? models.map(m => [m, false]) : [...models.map(m => [m, true]), ...models.map(m => [m, false])];
  const skip = new Set(); // dead, busy, slow or out-of-credit models are not asked twice
  let last = '', broke = false, busy = false, slow = false, offline = false;
  for (const [model, strict] of tries) {
    if (skip.has(model)) continue;
    const content = [{ type: 'text', text: strict ? prompt : `${prompt}\nReply with only a JSON object that matches this JSON Schema, no other text:\n${JSON.stringify(schema)}` }];
    if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}`, ...(v.plainOnly ? {} : { detail: 'high' }) } });
    let r;
    try {
      r = await fetch(v.url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${v.key()}`, 'x-title': 'Nib' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        ...(strict ? { response_format: { type: 'json_schema', json_schema: { name: 'nib', schema, strict: true } }, ...v.extra } : v.extraPlain || {}),
      }),
      signal: AbortSignal.timeout(Number(process.env.NIB_TIMEOUT_MS) || 45000),
      });
    } catch (e) {
      if (e.name === 'TimeoutError') slow = true; else offline = true;
      skip.add(model);
      last = `${model}: ${e.name}`;
      console.warn(`[nib] ${v.name} ${model} ${e.name}, trying the next option`);
      continue;
    }
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || `${r.status}`;
    if (r.status === 401) throw fail(`${v.name} rejected the API key. Check the key in nib/.env.`, 502);
    // 402: no credit for THIS route. A free model can still answer on a retry, so keep going.
    if (r.status === 402) { broke = true; skip.add(model); last = `${model}: out of credits`; continue; }
    if (r.status === 429 || r.status === 408 || r.status >= 500) {
      if (r.status === 429) busy = true;
      skip.add(model);
      last = `${model}: ${msg}`;
      console.warn(`[nib] ${v.name} ${model} ${r.status}, trying the next option: ${msg}`);
      continue;
    }
    // Unknown model, no host that takes images or schemas, or a rejected schema: try the next option.
    if (r.status === 400 || r.status === 404 || j.error?.code === 'model_not_found') {
      if (r.status === 404 || j.error?.code === 'model_not_found' || /not a valid model|model.*(not found|does not exist)/i.test(msg)) skip.add(model);
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
  if (broke) throw fail(`${v.name} says this key is out of credits.`, 502);
  if (busy) throw fail(`${v.name} is rate-limiting this key. Wait a few seconds and try again.`, 429);
  if (slow) throw fail('Reading took too long. Try again.', 504);
  if (offline) throw fail(`Could not reach ${v.name}. Check the internet connection.`, 504);
  throw fail(`${v.name} error: ${last}`, 502);
}
