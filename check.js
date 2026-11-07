// Real-key check: runs a real model on a webcam-style photo of a 17-field clinic form and on two
// handwriting crops, then says whether a guided finger would land on every blank.
//   npm run check                                    the key and model in .env
//   npm run check -- google/gemini-3.8-flash anthropic/claude-opus-5.5    compare OpenRouter models
// Each run costs a few cents of API credit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ai from './lib/ai.js';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch { /* no .env: use the shell's env */ }

const img = f => `data:image/jpeg;base64,${readFileSync(new URL(`./check/${f}`, import.meta.url)).toString('base64')}`;
const key = JSON.parse(readFileSync(new URL('./check/answers.json', import.meta.url), 'utf8'));
const p = ai.provider();
if (!p) { console.log('No key found. Put OPENROUTER_KEY=... in nib/.env first.'); process.exit(1); }

// Same anchor as public/draw.js: where Nib puts the finger.
const anchor = f => (f.kind === 'checkbox' ? { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 } : { x: f.x0 + Math.min(0.01, (f.x1 - f.x0) * 0.08), y: (f.y0 + f.y1) / 2 });

function score(fields) {
  const left = [...fields], misses = [];
  for (const t of key.fields) {
    const ta = anchor(t);
    const near = left.map((f, i) => ({ i, a: anchor(f) })).map(o => ({ ...o, dx: (o.a.x - ta.x) * key.aspect / key.cm, dy: (o.a.y - ta.y) / key.cm }))
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0];
    // On target: on the right line, and from 1 cm before the line's start to 3 cm into it.
    const ok = near && Math.abs(near.dy) <= Math.max((t.y1 - t.y0) / key.cm / 2, 0.45) + 0.15 && near.dx >= -1 && near.dx <= (t.kind === 'checkbox' ? 0.6 : 3);
    if (ok) left.splice(near.i, 1); else misses.push(`${t.label}${near ? ` (${near.dx.toFixed(1)} cm across, ${near.dy.toFixed(1)} cm down)` : ''}`);
  }
  return { hit: key.fields.length - misses.length, misses, extra: left.map(f => f.label) };
}

const models = process.argv.slice(2);
for (const model of models.length ? models : [null]) {
  if (model) { if (p !== 'openrouter') { console.log('Model names only apply to an OpenRouter key.'); break; } process.env.OPENROUTER_MODEL = model; }
  const name = model || `${p}${p === 'openrouter' ? ` (${process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash'})` : ''}`;
  console.log(`\n${name}`);
  try {
    let t = performance.now();
    const form = await ai.parseForm({ image: img('form.jpg'), lang: 'en' });
    const s = score(form.fields);
    console.log(`  form:  ${s.hit}/${key.fields.length} blanks on target in ${((performance.now() - t) / 1000).toFixed(1)} s`);
    if (s.misses.length) console.log(`         missed: ${s.misses.join('; ')}`);
    if (s.extra.length) console.log(`         extra (should be none, the office-use box must be skipped): ${s.extra.join(', ')}`);
    t = performance.now();
    const [a, b] = await Promise.all([
      ai.readField({ image: img('last-name.jpg'), label: 'Last name', kind: 'text', lang: 'en' }),
      ai.readField({ image: img('no-box.jpg'), label: 'Allergies to medication: No', kind: 'checkbox', lang: 'en' }),
    ]);
    const good = a.text.trim().toLowerCase() === 'kim' && b.text === 'checked';
    console.log(`  read:  "${a.text}" and "${b.text}" (want "Kim" and "checked") in ${((performance.now() - t) / 1000).toFixed(1)} s  ${good ? 'ok' : 'WRONG'}`);
    console.log(`  ${s.hit >= key.fields.length - 1 && good ? 'GOOD TO DEMO' : 'NOT GOOD ENOUGH: try another model'}`);
  } catch (e) {
    console.log(`  failed: ${e.message}`);
  }
}
