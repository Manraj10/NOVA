# Nib

A screen reader for paper. Put a paper form under a camera and Nib reads it out loud, talks your fingertip to each blank ("left, down, stop, write your name here"), and reads back what you wrote. Hold the screen or the Space key to ask it anything, like "what does guarantor mean" or "skip this one". Works in English, Spanish, Hindi and Chinese.

Built before NOVA. The rules allow pre-existing code as long as we say so during judging, so say it in the pitch.

## Run it

Needs Node 20 or newer and Chrome.

```bash
npm install
cp .env.example .env
npm start
```

Put the OpenRouter key NOVA emails us into `.env` as `OPENROUTER_KEY=...` (a Gemini, Claude or OpenAI key works too), then open http://localhost:8787.

- **Practice mode, no camera or key needed:** http://localhost:8787/?sim. The mouse is your fingertip. Tap Space when you finish a field, hold Space to ask a question.
- **Robot finger test:** http://localhost:8787/?sim&bot=1 runs a simulated blindfolded user that only hears Nib's words, reacts like a person, and overshoots. Press Space, and `window.nibBot` reports seconds and spoken directions per field. Use the same seed number to compare guidance changes.
- **Real mode:** a webcam looking straight down at a form taped to the table, about 40 cm up. Rest your index fingertip on the page and Nib guides it.

Never commit `.env`. OpenRouter scans GitHub and kills any key it finds, and the event key may only power Nib itself, not a coding agent.

## Check a real key first

```bash
npm run check
```

Sends a webcam-style photo of a 17-field clinic form and two handwriting crops to the real model, then prints how many blanks a guided finger would land on and whether it read the writing right. It ends with GOOD TO DEMO or NOT GOOD ENOUGH. To compare OpenRouter models:

```bash
npm run check -- google/gemini-3.8-flash anthropic/claude-opus-5.5
```

Then put the winner in `.env` as `OPENROUTER_MODEL=...`.

## Setting up the camera

- On screen the page must look upright and not mirrored, the way you'd read it. If it doesn't, fix it in the camera app; Nib's "left" and "right" follow the picture.
- If a finger sits on the blank but Nib never says "stop", open http://localhost:8787/?tol=1.5 to widen the target.
- Voice: say "done", "repeat" or "skip" on their own, or "Hey Nib, ..." to ask hands-free. Talking near the mic in full sentences won't trigger anything.

## How it works

- `lib/` sends one photo of the form to a vision model, which returns every field with its box, a label and a plain-words explanation. `lib/ai.js` holds the prompts; `openai.js` (OpenAI and OpenRouter), `gemini.js` and `claude.js` are the providers.
- `public/app.js` runs the flow: read the form, guide the finger, wait for writing, read the handwriting back, next field.
- MediaPipe hand tracking finds the fingertip in the browser, so guidance runs locally with no cloud round trip.
- `public/voice.js` does speech, the distance beeps and voice commands. `public/draw.js` draws the overlay. `public/sim.js` is the practice form.

## Test

```bash
npm test
```

Fakes every AI provider and checks the parse, read and ask routes, model fallbacks, and messy JSON replies. No key needed.
