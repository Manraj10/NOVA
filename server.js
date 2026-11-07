// Nib dev server: serves public/ and the AI endpoints (parse, read, ask, review, speak, hear). No dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm, readField, ask, reviewForm, status, provider } from './lib/ai.js';
import { speak } from './lib/speak.js';
import { hear } from './lib/hear.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const pub = join(root, 'public');

// ponytail: 4-line .env reader instead of a dotenv dependency
const envFile = join(root, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const PORT = Number(process.env.PORT) || 8787;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon',
};
const ROUTES = { '/api/parse': parseForm, '/api/read': readField, '/api/ask': ask, '/api/review': reviewForm, '/api/speak': speak, '/api/hear': hear };

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel already parsed it
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 12e6) throw Object.assign(new Error('That photo is too large.'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Request body is not JSON.'), { status: 400 }); }
}

const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// One handler for both homes: this local server, and Vercel (api/index.js) in production.
export async function handler(req, res) {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/status') return json(res, 200, await status());
    if (ROUTES[pathname]) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
      return json(res, 200, await ROUTES[pathname](await readJson(req)));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const rel = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '') || 'index.html';
    const file = join(pub, rel);
    if (file !== pub && !file.startsWith(pub + sep)) return json(res, 403, { error: 'Forbidden.' });
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return json(res, 404, { error: 'Not found.' });
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : 'Something broke on the server.' });
  }
}

if (!process.env.VERCEL) http.createServer(handler).listen(PORT, () => {
  console.log(`Nib running at http://localhost:${PORT}`);
  console.log(`Practice mode:   http://localhost:${PORT}/?sim`);
  const p = provider();
  console.log(`Form reading:    ${p ? `on (${p})` : 'OFF: add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to .env'}`);
});
