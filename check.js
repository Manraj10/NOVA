// Real-key check: runs a real model on a webcam-style photo of a 17-field clinic form and on two
// handwriting crops. A hit needs the correct field meaning, kind AND target row.
// This fixture check does not establish real-camera guidance or user outcomes.
//   npm run check                                    the key and model in .env
//   npm run check -- google/gemini-3.8-flash anthropic/claude-opus-5.5    compare OpenRouter models
//   npm run check -- --runs 5                        read the form 5 times: one lucky run proves nothing
// Each run costs a few cents of API credit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as ai from './lib/ai.js';

const img = f => `data:image/jpeg;base64,${readFileSync(new URL(`./check/${f}`, import.meta.url)).toString('base64')}`;
const key = JSON.parse(readFileSync(new URL('./check/answers.json', import.meta.url), 'utf8'));

// Same anchor as public/draw.js: where Nib puts the finger.
const anchor = f => (f.kind === 'checkbox' ? { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 } : { x: f.x0 + Math.min(0.01, (f.x1 - f.x0) * 0.08), y: (f.y0 + f.y1) / 2 });

// Explicit aliases for this English clinic fixture, never fuzzy substrings.
// Keep qualifiers: patient Phone and Contact phone are distinct, as are Yes/No.
const ALIASES = {
  'last name': ['surname', 'family name', 'patient last name'],
  'first name': ['given name', 'forename', 'patient first name'],
  'date of birth': ['dob', 'birth date', 'birthdate'],
  phone: ['phone number', 'telephone', 'telephone number', 'patient phone', 'patient phone number'],
  'street address': ['address', 'home address', 'patient address'],
  city: ['town', 'patient city'],
  state: ['province', 'state or province'],
  zip: ['zip code', 'postal code', 'postcode'],
  'insurance provider': ['insurance company', 'insurance carrier', 'insurer'],
  'policyholder name': ['policyholder', 'name of policyholder', 'policyholder s name', 'insured name'],
  'relationship to patient': ['relationship', 'policyholder relationship to patient'],
  yes: ['allergies to medication yes', 'medication allergies yes', 'drug allergies yes'],
  no: ['allergies to medication no', 'medication allergies no', 'drug allergies no'],
  'emergency contact': ['emergency contact name', 'name of emergency contact'],
  'contact phone': ['contact phone number', 'emergency contact phone', 'emergency contact phone number'],
  'patient signature': ['signature', 'signature of patient'],
  date: ['signature date', 'date signed', 'date of signature', 'today s date', 'today date'],
};
const labelOf = value => typeof value === 'string' ? value.normalize('NFC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
const validBox = f => f && ['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(f[k]))
  && f.x0 >= 0 && f.y0 >= 0 && f.x1 <= 1 && f.y1 <= 1 && f.x0 < f.x1 && f.y0 < f.y1;

// Pure/offline. Unknown wording is a miss until an explicit fixture alias is
// reviewed. An underline or neighboring valid box cannot prove field identity.
export function score(fields, fixture = key) {
  if (!Array.isArray(fixture?.fields) || !Number.isFinite(fixture.cm) || fixture.cm <= 0
      || !Number.isFinite(fixture.aspect) || fixture.aspect <= 0) throw new TypeError('Invalid scoring fixture');
  const records = Array.isArray(fields) ? fields : [];
  const truth = fixture.fields;
  const aliases = truth.map(t => new Set([t.label, ...(ALIASES[labelOf(t.label)] || []),
    ...(Array.isArray(t.aliases) ? t.aliases : [])].map(labelOf).filter(Boolean)));
  const edges = truth.map((t, ti) => records.flatMap((f, i) => {
    if (!validBox(t) || !validBox(f) || f.kind !== t.kind || !aliases[ti].has(labelOf(f.label))) return [];
    const ta = anchor(t), a = anchor(f);
    const dx = (a.x - ta.x) * fixture.aspect / fixture.cm, dy = (a.y - ta.y) / fixture.cm;
    // Target must stay on THIS truth row, with only0.15cm registration margin.
    const row = Math.abs(dy) <= (t.y1 - t.y0) / fixture.cm / 2 + 0.15;
    const across = t.kind === 'checkbox'
      ? Math.abs(dx) <= (t.x1 - t.x0) * fixture.aspect / fixture.cm / 2 + 0.15
      : dx >= -1 && dx <= 3;
    return row && across ? [{ truthIndex: ti, predictedIndex: i, dx, dy }] : [];
  }));
  const uses = new Map();
  edges.flat().forEach(e => uses.set(e.predictedIndex, (uses.get(e.predictedIndex) || 0) + 1));
  const ambiguous = [...uses].filter(([, count]) => count > 1).map(([i]) => i);
  const used = new Set(), matches = [], misses = [];
  truth.forEach((t, ti) => {
    const candidates = edges[ti].filter(e => uses.get(e.predictedIndex) === 1 && !used.has(e.predictedIndex))
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy) || a.predictedIndex - b.predictedIndex);
    if (candidates.length) {
      const match = candidates[0];
      used.add(match.predictedIndex);
      matches.push(match);
      return;
    }
    const named = records.filter(f => aliases[ti].has(labelOf(f?.label)));
    const typed = named.filter(f => f?.kind === t.kind);
    const reason = !named.length ? 'label missing' : !typed.length ? 'kind mismatch'
      : !typed.some(validBox) ? 'invalid box' : edges[ti].length ? 'ambiguous mapping' : 'wrong row or target';
    misses.push(`${t.label} (${reason})`);
  });
  const extra = records.filter((_, i) => !used.has(i)).map(f => typeof f?.label === 'string' ? f.label : '(unlabeled field)');
  return { hit: matches.length, misses, extra, matches, ambiguous,
    passed: truth.length > 0 && !misses.length && !extra.length && !ambiguous.length };
}

async function main() {
  try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch { /* no .env: use the shell's env */ }
  const p = ai.provider();
  if (!p) { console.log('No key found. Put OPENROUTER_KEY=... in nib/.env first.'); process.exitCode = 1; return; }
  const argv = process.argv.slice(2), ri = argv.indexOf('--runs');
  const RUNS = ri >= 0 ? Math.max(1, parseInt(argv.splice(ri, 2)[1], 10) || 1) : 1;
  const models = argv;
  for (const model of models.length ? models : [null]) {
    if (model) { if (p !== 'openrouter') { console.log('Model names only apply to an OpenRouter key.'); break; } process.env.OPENROUTER_MODEL = model; }
    const name = model || `${p}${p === 'openrouter' ? ` (${process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash'})` : ''}`;
    console.log(`\n${name}`);
    try {
      let t, worst = key.fields.length, cleanRuns = true;
      const hits = [], missed = {};
      for (let run = 0; run < RUNS; run++) {
        t = performance.now();
        const form = await ai.parseForm({ image: img('form.jpg'), lang: 'en' });
        const s = score(form.fields);
        hits.push(s.hit); worst = Math.min(worst, s.hit); cleanRuns &&= s.passed;
        for (const m of s.misses) { const k = m.replace(/ \(.*$/, ''); missed[k] = (missed[k] || 0) + 1; }
        console.log(`  form:  ${s.hit}/${key.fields.length} semantic + row matches in ${((performance.now() - t) / 1000).toFixed(1)} s`);
        if (s.misses.length) console.log(`         missed: ${s.misses.join('; ')}`);
        if (s.extra.length) console.log(`         extra (should be none, the office-use box must be skipped): ${s.extra.join(', ')}`);
      }
      if (RUNS > 1) console.log(`  over ${RUNS} runs: ${hits.join(', ')} of ${key.fields.length} (worst ${worst})${Object.keys(missed).length ? `; missed most: ${Object.entries(missed).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(', ')}` : ''}`);
      t = performance.now();
      const [a, b] = await Promise.all([
        ai.readField({ image: img('last-name.jpg'), label: 'Last name', kind: 'text', lang: 'en' }),
        ai.readField({ image: img('no-box.jpg'), label: 'Allergies to medication: No', kind: 'checkbox', lang: 'en' }),
      ]);
      const good = a.text.trim().toLowerCase() === 'kim' && b.text === 'checked';
      console.log(`  read:  "${a.text}" and "${b.text}" (want "Kim" and "checked") in ${((performance.now() - t) / 1000).toFixed(1)} s  ${good ? 'ok' : 'WRONG'}`);
      console.log(`  ${worst === key.fields.length && cleanRuns && good ? 'FIXTURE CHECK PASSED' : 'NOT GOOD ENOUGH: try another model'}${RUNS > 1 ? ' (judged on the worst run)' : ''}`);
    } catch (e) {
      console.log(`  failed: ${e.message}`);
    }
  }
}

// Importing this scorer in npm test must never load .env or spend API credit.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
