// Test the honesty layer and the sound: (a) label each element of the memory panorama as from the photo,
// from the spoken memory, or invented, with boxes; (b) generate the radio's music with Lyria.
import { readFileSync, writeFileSync } from 'node:fs';
process.loadEnvFile('C:/Users/manra/Documents/nova-hackathon/nib/.env');
const here = 'C:/Users/manra/AppData/Local/Temp/claude/26aa7d86870bfa79/0d6d82d1-e13c-43c4-a708-3d1a3bf1f72f/scratchpad/pano/';
const b64 = f => readFileSync(here + f).toString('base64');
const memory = "My grandmother's kitchen, late afternoon in winter. She is making bread, the radio is on, the window light is warm and orange.";
const call = (body, ms = 120000) => fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });

const label = (async () => {
  const t = performance.now();
  const r = await call({ model: 'google/gemini-3.8-flash', reasoning: { effort: 'low' }, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
    { type: 'text', text: `Image 1 is a real photo of a room. Image 2 is a generated scene of that room after applying this spoken memory: "${memory}". List up to 14 distinct visible elements in IMAGE 2. For each give: name, source ("photo" if it clearly appears in image 1, "memory" if the spoken memory asked for it, "invented" if neither), and box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid of image 2. Reply JSON {"elements":[...]}.` },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64('src/kitchen.jpg') } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64('google_gemini_3_1_flash_image.png') } }] }] });
  const j = await r.json();
  const out = JSON.parse(j.choices[0].message.content.replace(/^```json|```$/g, ''));
  writeFileSync(here + 'labels.json', JSON.stringify(out, null, 1));
  console.log('labels', ((performance.now() - t) / 1000).toFixed(1) + 's');
  for (const e of out.elements) console.log('  ', e.source.padEnd(8), e.name, JSON.stringify(e.box_2d));
})().catch(e => console.log('labels ERROR', e.message));

const music = (async () => {
  const t = performance.now();
  const r = await call({ model: 'google/lyria-3-clip-preview', messages: [{ role: 'user', content: 'A short, gentle 1950s radio song playing softly in a warm farmhouse kitchen on a winter afternoon. Slightly crackly AM radio sound, instrumental.' }] }, 150000);
  const j = await r.json().catch(() => ({}));
  const m = j.choices?.[0]?.message;
  const audio = m?.audio?.data || m?.images?.[0]?.image_url?.url || null;
  console.log('music', r.status, ((performance.now() - t) / 1000).toFixed(1) + 's', audio ? `got ${Math.round(audio.length * 0.75 / 1024)} KB` : 'NO AUDIO ' + JSON.stringify(j).slice(0, 300));
  if (audio) writeFileSync(here + 'radio.bin', Buffer.from(audio.replace(/^data:[^,]+,/, ''), 'base64'));
})().catch(e => console.log('music ERROR', e.message));
await Promise.all([label, music]);
