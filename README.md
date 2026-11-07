# Nib

A screen reader for paper. Put a paper form under a camera and Nib reads it out loud, talks your fingertip to each blank ("left, down, stop, write your name here"), and reads back what you wrote. Hold the screen or the Space key to ask it anything, like "what does guarantor mean" or "skip this one". Works in English, Spanish, Hindi and Chinese.

## Run it

Needs Node 20 or newer and Chrome.

```bash
npm install
cp .env.example .env
npm start
```

Put one API key in `.env` (Gemini, Claude or OpenAI, any one works), then open http://localhost:8787.

- **Practice mode, no camera or key needed:** http://localhost:8787/?sim. The mouse is your fingertip. Tap Space when you finish a field, hold Space to ask a question.
- **Real mode:** a webcam looking straight down at a form taped to the table, about 40 cm up. Rest your index fingertip on the page and Nib guides it.

The camera only works on `localhost` or HTTPS, so a phone has to reach it through HTTPS (deploy it, or use the phone as a webcam for the laptop).

## How it works

- `lib/` sends one photo of the form to a vision model, which returns every field with its box, a label and a plain-words explanation. `lib/ai.js` holds the prompts; `gemini.js`, `claude.js` and `openai.js` are the three providers.
- `public/app.js` runs the flow: read the form, guide the finger, wait for writing, read the handwriting back, next field.
- MediaPipe hand tracking finds the fingertip in the browser, so guidance runs locally with no cloud round trip.
- `public/voice.js` does speech, the distance beeps and voice commands. `public/draw.js` draws the overlay. `public/sim.js` is the practice form.

## Test

```bash
node test.js
```

Fakes all three AI providers and checks the parse, read and ask routes.
