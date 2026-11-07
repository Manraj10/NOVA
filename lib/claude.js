// Claude provider, through Anthropic's official SDK.
import Anthropic from '@anthropic-ai/sdk';
import { fail } from './ai.js';

let client;
const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';
// Reading the whole form deserves more thought; reading one field or answering a question needs speed.
const EFFORT = { parse: 'medium', read: 'low', ask: 'low' };

export async function generate({ job, prompt, image, schema }) {
  // baseURL is pinned so a stray ANTHROPIC_BASE_URL in the shell can't reroute the calls.
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.NIB_ANTHROPIC_BASE || 'https://api.anthropic.com',
    maxRetries: 1,
    timeout: 45_000,
  });
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } });
  content.push({ type: 'text', text: prompt });

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL(),
      max_tokens: 16000,
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT[job] || 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw fail('Claude rejected the API key. Check ANTHROPIC_API_KEY in nib/.env.', 502);
    if (e instanceof Anthropic.RateLimitError) throw fail('Claude is rate-limiting this key. Wait a few seconds and try again.', 429);
    if (e instanceof Anthropic.APIConnectionError) throw fail('Could not reach Claude. Check the internet connection.', 504);
    if (e instanceof Anthropic.APIError) throw fail(`Claude error: ${e.message}`, 502);
    throw e;
  }

  if (response.stop_reason === 'refusal') throw fail('The reader declined this image. Try another photo.', 502);
  if (response.stop_reason === 'max_tokens') throw fail('The form reader ran out of room. Try a closer photo.', 502);
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch { throw fail('Claude sent back something unreadable. Try again.', 502); }
}
