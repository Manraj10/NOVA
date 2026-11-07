# Nib: morning checklist (Sat Nov 7)

Check-in 10:00 at Tepper. Hacking 11:00 to 5:00. Judging 6:00 to 7:45 (5 min + 1 to 2 min Q&A).

## Before you leave (5 min, on the laptop)

1. Open a terminal in `Documents\nova-hackathon\nib` and run `npm start` (if it isn't already running). Open http://localhost:8787 on the laptop to check it loads.
2. Phone link (live as of 7:40 AM while the laptop stays awake and online): https://significance-cheapest-mood-mariah.trycloudflare.com
   If it stops loading, in another terminal run `cloudflared tunnel --protocol http2 --url http://localhost:8787`. It prints a new `https://...trycloudflare.com` link each time. Open that link on your iPhone.
   - If cloudflared fails (some Wi-Fi blocks it, which happened overnight), use practice mode on the laptop (`http://localhost:8787/paper.html?sim`) and retry the tunnel on the venue Wi-Fi.
3. On the phone: tap anywhere to start and allow the camera. Prop the phone about 30 to 40 cm above a printed form, pointing straight down.

## The physical test (what to try, in order)

1. Put the form under the camera and tap. Nib says it's reading, the edge glows, then it names the form and the number of places.
2. Rest ONE finger of your free hand on the page, pen down. Nib says "Got it" once it has your finger.
3. Follow the voice to the first blank. When it says stop, write, lift your hand, then tap the screen.
4. Nib reads your handwriting back. Tap to keep it, or hold the screen and say "redo".
5. Hold the screen and ask "where is the signature" (or anything on the page). It takes your finger there.
6. Push the paper about 2 cm while writing one answer. Nib should say the page moved, read it again, and keep your answers.
7. Finish the form. It checks the whole page once more before it says you can hand it in.

Tell me what went wrong in plain words (which step, what it said), and I'll fix it.

## At the event (11:00)

1. Open `nib\.env` and DELETE the line that starts with `OPENROUTER_MODEL=` (that was tonight's free test model).
2. Paste the NOVA event key after `OPENROUTER_KEY=` (never into any file git tracks, never into a chat).
3. Restart `npm start`, then run `npm run check` once (it spends a little credit) to confirm the event key reads the sample forms.
4. The event key is only for Nib itself, never for coding agents (event rule).

## If something breaks on stage

- Camera or Wi-Fi dies: open `/paper.html?sim` (practice mode). The mouse is the fingertip. Space finishes writing; hold Space to ask.
- Speech is silent on the iPhone: make sure the ringer switch is on and the volume is up, then tap Start again.
