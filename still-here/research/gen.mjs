// Gate test: can OpenRouter image models turn one room photo + a spoken memory into a seamless 2:1
// equirectangular 360 panorama? Saves each result and prints size, time and a seam score.
import { readFileSync, writeFileSync } from 'node:fs';
process.loadEnvFile('C:/Users/manra/Documents/nova-hackathon/nib/.env');
const here = 'C:/Users/manra/AppData/Local/Temp/claude/26aa7d86870bfa79/0d6d82d1-e13c-43c4-a708-3d1a3bf1f72f/scratchpad/pano/';
const photo = 'data:image/jpeg;base64,' + readFileSync(here + 'src/kitchen.jpg').toString('base64');
const memory = "My grandmother's kitchen, late afternoon in winter. She is making bread, the radio is on, the window light is warm and orange.";
const prompt = `Create a single seamless 360-degree equirectangular panorama (exactly 2:1 aspect ratio, full sphere, left and right edges must join seamlessly, horizon at the vertical center) of the room in this photo, as if standing in the middle of it. Keep the room in the photo recognizable and continue it all the way around, inventing the unseen walls consistently. Apply this memory: ${memory} No text, no borders, no people's faces.`;
const models = process.argv.slice(2);
await Promise.all(models.map(async model => {
  const t = performance.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_KEY}` },
      body: JSON.stringify({ model, modalities: ['image', 'text'], image_config: { aspect_ratio: '21:9' },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: photo } }] }] }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) return console.log(model, r.status, ((performance.now() - t) / 1000).toFixed(1) + 's', 'NO IMAGE', (j.error?.message || JSON.stringify(j).slice(0, 200)));
    const [, mime, b64] = /^data:(image\/\w+);base64,(.*)$/.exec(url);
    const file = here + model.replace(/\W+/g, '_') + '.' + mime.split('/')[1];
    writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(model, r.status, ((performance.now() - t) / 1000).toFixed(1) + 's', file.split('/').pop());
  } catch (e) { console.log(model, 'ERROR', e.message); }
}));
