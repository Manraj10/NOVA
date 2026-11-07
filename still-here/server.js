// Still Here dev server: serves public/ and the model endpoints. No dependencies.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scene, back, labels, ask, sound } from './lib/ai.js';
import { hear } from './lib/hear.js';
import { speak } from './lib/speak.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const pub = join(root, 'public');
for (const f of [join(root, '.env'), join(root, '../.env'), join(root, '../nib/.env')]) if (!process.env.VERCEL && !process.env.OPENROUTER_KEY && existsSync(f)) process.loadEnvFile(f);

const PORT = Number(process.env.PORT) || 8795;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.mp3': 'audio/mpeg',
};
// dev only: save a finished room as the instant example
async function bake({ pano, depth, sound, narrationClip, meta }) {
  if (process.env.VERCEL) throw Object.assign(new Error('Not here.'), { status: 404 });
  const dir = join(pub, 'hero'), b64 = (u, re) => { if (typeof u !== 'string' || !re.test(u)) throw Object.assign(new Error('bad bake'), { status: 400 }); return Buffer.from(u.split(',')[1], 'base64'); };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pano.jpg'), b64(pano, /^data:image\/jpeg;base64,/));
  if (depth) await writeFile(join(dir, 'depth.png'), b64(depth, /^data:image\/png;base64,/));
  if (sound) await writeFile(join(dir, 'sound.mp3'), b64(sound, /^data:audio\/mpeg;base64,/));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, narrationClip }));
  return { ok: true };
}
const ROUTES = { '/api/bake': bake,  '/api/scene': scene, '/api/back': back, '/api/labels': labels, '/api/ask': ask, '/api/sound': sound, '/api/hear': hear, '/api/speak': speak };

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel already parsed it
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 9e6) throw Object.assign(new Error('That photo is too large.'), { status: 413 });
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

if (!process.env.VERCEL) http.createServer(handler).listen(PORT, () => console.log(`Still Here at http://localhost:${PORT}`));
