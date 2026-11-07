# Nib · Memory

Mode 3 of Nib, a screen reader for the physical world. A person says a few words about a room they remember. Nib asks a question or two, builds the whole room around them in 360°, and tells them what's where. If something is wrong ("no, the radio was on the windowsill"), they say so and Nib changes it. Every detail is labeled **from your words** or **imagined by Nib**.

It's voice-first for blind people. The 3D view is for family and sighted friends standing with them. It's an imagined reconstruction from words, not a scan. No photo needed.

## How it works

1. **Listen.** Hold the yellow button and speak, or type. `/api/hear` transcribes it.
2. **Ask.** Nib asks one warm question out loud (`ask`, gemini-3.5-flash-lite). The answer joins the memory.
3. **Plan and paint at once.** The front of the room is painted straight from the words (`scene`, gemini-3.1-flash-image at 21:9, with a real-unedited-photo prompt). If it's slow, nano-banana-2.1 starts at 14 s and the first picture wins. Alongside, `spec` (gemini-3.8-flash) turns everything said into a scene plan: what's ahead, left, right and behind, and which details are the person's own. A second question is asked while it paints.
4. **Close the loop to 360°.** The front's right and left edge strips go on either side of a soft gap. `back` fills the gap with the rest of the room. Three tries run in parallel and the cleanest join wins. Both overlaps are cross-faded and the joins softened (`public/memory/pano.js`).
5. **Be honest.** `labels` tags each element as `memory` (from your words) or `invented` (imagined by Nib). It also writes the title, the line spoken on entry, and a 3-4 sentence description with directions ("in front of you… on your right… behind you…").
6. **Sound and depth.** `sound` (Lyria) makes the room's sound, placed at its source (the radio) in 3D audio. Depth Anything V2 runs in the browser on the wrapped loop, and three.js renders a depth-pushed sphere with a flat floor and ceiling (`room.js`).
7. **Correct by voice.** `fix` edits the front photo with the spoken change. The app recomposites it with the same back, re-runs depth and labels, and describes the room again.

Timing on the event key: about 25 s from the first answer to standing inside, and about 30 s for a spoken change.

## Files

- `public/memory/`: the whole front end (`index.html`, `app.js`, `pano.js`, `room.js`, `voice.js`, `style.css`) plus `hero/`, the pre-built example (opens instantly).
- `lib/memory.js`: the model handlers, each a plain `async ({...body}) => result`: `ask`, `spec`, `scene`, `back`, `labels`, `fix`, `sound`.
- `lib/hear.js`, `lib/speak.js`: copies of Nib's voice in and out (Nib's own work the same).
- `server.js`: dependency-free dev server. `api/index.js` + `vercel.json`: the same handler on Vercel.

Routes: `POST /api/memory/{ask,spec,scene,back,labels,fix,sound}`, `POST /api/hear`, `POST /api/speak`. Dev only: `/api/memory/bake`, plus `?bake` to save a finished room as the example.

To mount in Nib: copy `public/memory/` and `lib/memory.js`, then add `for (const n of ['ask','spec','scene','back','labels','fix','sound']) ROUTES['/api/memory/' + n] = memory[n]` to Nib's server.

## Run

`node server.js`, then open http://localhost:8795/memory/. It needs `OPENROUTER_KEY` in `.env`.

## 60-second demo

1. **(0-10 s)** "Some rooms only live in memory now. Nib's Memory mode lets you walk back into one, even if you can't see."
2. **(10-20 s)** A judge holds the yellow button and says a room: *"My grandmother's kitchen in Punjab, winter evening. She's making rotis, the radio is playing old songs, a neem tree outside the window."*
3. **(20-45 s)** Nib asks a question out loud. The judge answers. A second question comes while it builds.
4. **(45-55 s)** The room appears all the way around. Nib says what's where. Turn around: it's 360°. The radio plays from where the radio is.
5. **(55-60 s)** Say "no, the radio was on the windowsill." Nib changes it. Tap **Show what's real**: yellow is from your words, dashed is imagined by Nib.

If the network is slow, use **Try the example**.

Honest claims: imagined, not a scan. Photo-to-3D worlds exist (World Labs Marble, Genie 3). What's new here: voice-only input, a blind-first conversation, a spoken description you can correct, and labels that never pass off an invention as yours.
