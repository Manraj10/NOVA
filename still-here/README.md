# Still Here

Say a few words about a room you remember. In about 30-40 seconds you are standing inside it, all the way around. Every detail is labeled **from your words** or **imagined**.

It's for families rebuilding a room for a parent with dementia, or a home that's gone. The labels matter because a memory aid shouldn't quietly invent things.

It is an imagined reconstruction from your words, not a scan. No photo needed.

## How it works

1. **Front of the room.** Your words go to `google/gemini-3.1-flash-image` (21:9): every detail you mention, the rest filled in plainly. If it is slow (it swings from 9 s to 45 s under load), `gemini-nano-banana-2.1` starts after 14 s and the first picture wins.
2. **One question back.** While the front is painting, a warm voice asks one question ("What could you hear in that room?"). The answer goes into the back of the room and into the sound.
3. **Back of the room, so it closes at 360°.** The front's right and left edge strips go on either side of a soft gap. The painter fills the gap with the rest of the room. Three tries run in parallel and we keep the one whose edges join most cleanly. Then both overlaps are cross-faded into one loop (`public/pano.js`). On the test kitchen the wrap edge differs by 3.6 vs 4.3 between ordinary neighboring columns.
4. **Honesty labels.** `google/gemini-3.8-flash` tags each element in the painting as from your words or imagined, strictly (anything you did not say is imagined), with boxes. It also writes the room title and the line spoken as you enter.
5. **Sound.** `google/lyria-3-clip-preview` makes the room's sound (the radio, the rain). If a labeled element makes the sound, it plays from that spot in 3D.
6. **Depth.** Depth Anything V2 runs in the browser (WebGPU, falling back to WASM) on the wrapped loop. The sphere around you is pushed in by depth, with a flat floor and ceiling, so a step forward feels like a step (`public/room.js`).

Voice in and out reuse Nib's approach: `/api/hear` (gemini-3.5-flash-lite transcription) and `/api/speak` (gpt-audio-mini, voice "marin", checked word for word).

## Run it

```
node server.js
```

Then open http://localhost:8795. It needs `OPENROUTER_KEY` in `.env`. `?bake` saves a finished room as the "Try the example" room in `public/hero/`.

Deploy: `vercel deploy --prod` (static `public/`, one function in `api/index.js`). Add `OPENROUTER_KEY` in the Vercel dashboard.

## 60-second demo

1. **(0-10 s)** "Most of us have a room we can't go back to. Say what you remember, and Still Here puts you back inside it."
2. **(10-20 s)** Hand a judge the phone. They hold the big circle and say a room they remember: *"My grandmother's kitchen on a winter afternoon. She's baking bread and the radio is on."*
3. **(20-45 s)** While it builds, the app asks one question out loud. The judge answers. The steps tick off on screen.
4. **(45-55 s)** Tap **Step inside**. A voice says the line, the sound plays from the radio, and you turn all the way around. On a phone, move the phone to look.
5. **(55-60 s)** Tap **Show what's real**. Amber tags are from your words, dashed violet ones are imagined. "It never pretends. Anything it made up is labeled. Tap a tag to keep it, remove it or say it's wrong."

If the network is slow, use **Try the example**. It opens instantly.

Honest claims: it's an imagined reconstruction, not a scan. Photo-to-3D worlds already exist (World Labs Marble, Genie 3). What is ours: no photo, just your spoken memory, a question back, the sound, and labels that never pass off an invention as yours.
