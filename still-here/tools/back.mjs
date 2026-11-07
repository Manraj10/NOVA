// node tools/back.mjs STRIP.jpg OUT.png "memory" -> runs the pass-2 call and saves the result
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { back } from '../lib/ai.js';
for (const f of ['.env', '../nib/.env']) if (!process.env.OPENROUTER_KEY && existsSync(f)) process.loadEnvFile(f);
const [, , inp, out, memory] = process.argv;
const t = performance.now();
const { image } = await back({ strip: 'data:image/jpeg;base64,' + readFileSync(inp).toString('base64'), memory });
writeFileSync(out, Buffer.from(image.split(',')[1], 'base64'));
console.log('back', ((performance.now() - t) / 1000).toFixed(1) + 's', image.slice(5, 20));
