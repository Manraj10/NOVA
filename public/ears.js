// Nib's own ears: the mic opens once (inside the start tap) and stays open; a small voice-activity
// detector cuts each spoken phrase; /api/hear turns it into words. This works in every browser,
// including iPhone Safari (its recognizer can't restart without a tap) and Brave (it has none).

const FRAME = 2048;
export const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export function makeEars({ ctx, ignore, onText, lang }) {
  let floor = 0.01, live = false, loud = 0, quietMs = 0, chunks = [], pre = [], busy = 0;
  const rate = ctx.sampleRate, frameMs = (FRAME / rate) * 1000;

  // 16 kHz mono 16-bit WAV, base64: small enough to send every phrase.
  function wav(parts) {
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

  async function send(parts) {
    busy++;
    try {
      const r = await fetch('/api/hear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: wav(parts), lang: lang() }) });
      if (r.ok) { const { text } = await r.json(); if (text) onText(text); }
    } catch { /* offline: the Ask button still works */ } finally { busy--; }
  }

  function frame(x) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length), copy = Float32Array.from(x);
    if (ignore()) { live = false; loud = 0; chunks = []; pre = []; return; } // Nib's own voice, never a command
    const on = rms > Math.max(0.015, floor * 3);
    if (!live) {
      floor = on ? floor : floor * 0.95 + rms * 0.05;
      pre.push(copy);
      if (pre.length > Math.ceil(350 / frameMs)) pre.shift(); // keep the start of the first word
      loud = on ? loud + 1 : 0;
      if (loud >= 2) { live = true; quietMs = 0; chunks = [...pre]; pre = []; }
      return;
    }
    chunks.push(copy);
    quietMs = on ? 0 : quietMs + frameMs;
    const ms = chunks.length * frameMs;
    if (quietMs > 650 || ms > 7000) {
      live = false; loud = 0;
      const parts = chunks; chunks = [];
      if (ms - quietMs > 250) send(parts); // a cough or a click is not a phrase
    }
  }

  return {
    get busy() { return busy > 0 || live; },
    // stream: the mic captured together with the camera (one iOS capture session), or ask for one.
    async start(stream) {
      stream ||= await navigator.mediaDevices.getUserMedia({ audio: MIC });
      const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(FRAME, 1, 1), mute = ctx.createGain();
      mute.gain.value = 0; // processing only runs when connected to the output; send it nothing
      proc.onaudioprocess = e => frame(e.inputBuffer.getChannelData(0));
      src.connect(proc).connect(mute).connect(ctx.destination);
      this.stream = stream;
      return this;
    },
  };
}
