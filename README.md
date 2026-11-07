# Nib

**A screen reader for the physical world.** One voice-first app for blind and low-vision people, with three modes you open by saying "Hey Nib".

**Live:** https://nibreads.vercel.app. It works best on a phone in Safari or Chrome. Allow the microphone and camera.

| Mode | What it does |
| --- | --- |
| **Trace** | Point the phone at a paper form. Nib reads it, then talks your fingertip to each blank ("a little left, down, stop, write your name here") and reads back what you wrote. |
| **Around me** | Hold the phone at chest height and turn. Nib says where you are ("You're in a classroom with three people") and counts people and obstacles in steps. It beeps faster as you get close, flashes a stairs alarm, and answers questions like "Is there an empty chair?". |
| **Memory** | Describe a room you remember. Nib builds a 360° room you can look around, marks what came from your words and what it imagined, plays sound that fits, and changes it when you say "make it dark outside". |

## Talking to Nib

- **"Hey Nib"** (or just "Nib") anywhere. Nib stops talking, chimes and shows a listening orb.
- **"Hey Nib, open Trace / Around me / Memory"** or **"Hey Nib, go home"**. Each page starts listening by itself, with no tap.
- Then ask anything: "Where is the signature?", "What's around me?", "Make the walls blue."
- Ordinary talk near the phone is ignored. The screen stays awake while Nib is open.

## How it works

- **Ears:** the mic stays open in the browser. A small voice detector cuts each phrase and sends it to Gemini 3.5 Flash Lite for transcription (`public/ears.js`, `lib/hear.js`). The wake word tolerates common mishearings ("Hey Ned", "Hey Mib").
- **Voice:** gpt-audio-mini reads every line in a warm voice. Each clip is checked against the script, so a voice that changes a word (or any number) falls back to the built-in voice (`lib/speak.js`, `public/voice.js`).
- **Trace:** Gemini 3.8 Flash finds every field on the form. MediaPipe hand tracking finds your fingertip on the phone, so guidance needs no round trip to the cloud (`public/app.js`, `lib/ai.js`).
- **Around me:** an on-device object detector (MediaPipe EfficientDet-Lite0) runs about 10 times a second for people, furniture and distance. Every few seconds the cloud adds the place, doors, stairs and answers to questions (`public/around*.js`, `public/eyes.js`).
- **Memory:** Gemini turns the spoken memory into a scene, Gemini 3.1 Flash Image paints the 360° panorama, Lyria adds music when you name some, and three.js puts you inside it (`public/memory/`, `lib/memory.js`).
- A dependency-free Node server (`server.js`) serves it locally and on Vercel (`api/index.js`).

## Run it locally

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env   # add OPENROUTER_KEY=...
npm start              # http://localhost:8787
```

- Practice mode with no camera or key: http://localhost:8787/paper.html?sim (the mouse is your fingertip).
- Never commit `.env`.

## Test

```bash
npm test
```

There are 600 tests, and they need no key: every AI call is faked. `npm run check` runs a real-model accuracy check on sample forms and spends credit.
