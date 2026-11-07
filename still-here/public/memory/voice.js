// Voice in and out. In: hold (or tap) the mic, we record 16 kHz WAV and /api/hear writes the words.
// Out: /api/speak's warm voice, or the browser's own voice if that fails.

function wav(parts, rate) {
  const n = parts.reduce((a, p) => a + p.length, 0), src = new Float32Array(n);
  let o = 0;
  for (const p of parts) { src.set(p, o); o += p.length; }
  const k = rate / 16000, m = Math.floor(n / k), buf = new DataView(new ArrayBuffer(44 + m * 2));
  const str = (at, s) => [...s].forEach((c, i) => buf.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + m * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, 16000, true); buf.setUint32(28, 32000, true);
  buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, m * 2, true);
  for (let i = 0; i < m; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, src[Math.floor(i * k)])) * 32767, true);
  let bin = '';
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// iPhone: Web Audio obeys the silent switch unless the page says it plays media; while recording it must
// say play-and-record, and go back to playback after so the sound returns to the loudspeaker.
const session = type => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { } };
session('playback');

// A mic button: press and hold to talk, or tap once to start and again to stop. onText gets the words.
// The mic is opened for each recording and closed after it, so iOS never stays in call mode.
export function micButton(btn, ctx, { onText, onState = () => {} }) {
  let rec = null, down = 0, holding = false, starting = false;
  async function start() {
    if (rec || starting) return;
    starting = true;
    const c = ctx();
    c.resume();
    let stream;
    try {
      session('play-and-record');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { starting = false; session('playback'); onState('denied'); return; }
    await c.resume();
    const src = c.createMediaStreamSource(stream), proc = c.createScriptProcessor(4096, 1, 1), mute = c.createGain();
    mute.gain.value = 0;
    const parts = [];
    proc.onaudioprocess = e => { if (parts.length < 600) parts.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    src.connect(proc).connect(mute).connect(c.destination);
    rec = { parts, rate: c.sampleRate, stop: () => { src.disconnect(); proc.disconnect(); stream.getTracks().forEach(t => t.stop()); session('playback'); } };
    starting = false;
    btn.classList.add('live'); onState('listening');
    // released while the permission prompt was up, after a real hold: that was the whole phrase
    if (!holding && performance.now() - down > 450) stop();
  }
  async function stop() {
    if (!rec) return;
    const r = rec; rec = null; r.stop();
    btn.classList.remove('live');
    if (r.parts.length < 3) { onState('idle'); return; }
    onState('hearing');
    try {
      const res = await fetch('/api/hear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: wav(r.parts, r.rate) }) });
      const j = await res.json();
      if (res.ok && j.text) onText(j.text);
    } catch { /* typing still works */ }
    onState('idle');
  }
  const release = () => { if (holding && rec && performance.now() - down > 450) stop(); holding = false; };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); hush(); holding = true; down = performance.now(); rec ? stop() : start(); });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  return { stop };
}

// Speaking in the warm voice. Clips are fetched ahead so a run of sentences plays without gaps;
// hush() stops whatever is playing (the person started talking). The browser's voice is the fallback.
const clips = new Map();
let playing = null, turn = 0;
export function fetchClip(text) {
  if (!clips.has(text)) clips.set(text, fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    .then(r => r.ok ? r.json() : null).catch(() => null));
  return clips.get(text);
}
export function hush() {
  turn++;
  try { playing?.stop(); } catch { }
  playing = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
async function play(text, ctx, clip) {
  if (clip?.pcm) {
    const bin = atob(clip.pcm), n = bin.length >> 1, c = ctx(), buf = c.createBuffer(1, n, clip.rate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; ch[i] = v / 32768; }
    const s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination); s.start();
    playing = s;
    await new Promise(ok => { s.onended = ok; });
    return;
  }
  if (!('speechSynthesis' in window)) return;
  await new Promise(ok => { const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.onend = ok; u.onerror = ok; speechSynthesis.speak(u); setTimeout(ok, 12000); });
}
// lines: sentences to say in order; baked: { text: clip } already in hand; onLine(i) before each.
export async function sayAll(lines, ctx, baked = {}, onLine = () => {}) {
  hush();
  const me = turn, pending = lines.map(t => baked[t] ? Promise.resolve(baked[t]) : fetchClip(t));
  for (let i = 0; i < lines.length; i++) {
    const clip = await pending[i];
    if (me !== turn) return false;
    onLine(i);
    await play(lines[i], ctx, clip);
    if (me !== turn) return false;
  }
  return true;
}
export const say = (text, ctx, clip) => sayAll([text], ctx, clip ? { [text]: clip } : {});
export const sentences = t => String(t || '').match(/[^.!?]+[.!?]+[\s”’"]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
