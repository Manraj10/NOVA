// Local microphone framing and ordered server transcription. Requires getUserMedia
// and ScriptProcessor support; browser/audio-route behavior still needs device testing.
// stop() releases the recording chain and invalidates all pending callbacks.

const FRAME = 2048;
export const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// The shared voice layer can announce a failed phrase in every mode. Never
// expose its audio, onset token, or a provider's response/message in this event.
function reportDrop(reason, _token, details) {
  const detail = { reason };
  if (Number.isInteger(details?.status) && details.status >= 400 && details.status <= 599)
    detail.status = details.status;
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  try { globalThis.dispatchEvent(new CustomEvent('nib:voice-drop', { detail })); }
  catch { /* feedback must not break listening in a partial browser or test host */ }
}

export function makeEars({ ctx, ignore, onText, lang, onCapture = () => null,
  isCurrent = () => true, onDrop = reportDrop, maxQueued = 4,
  requestTimeoutMs = 10000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let floor = 0.01, live = false, loud = 0, quietMs = 0, chunks = [], pre = [], capture = null;
  const rate = ctx.sampleRate, frameMs = (FRAME / rate) * 1000;
  const limit = Math.min(8, Math.max(2, Math.floor(maxQueued) || 4));
  const timeoutMs = Math.min(30000, Math.max(1000, Number(requestTimeoutMs) || 10000));
  const newCycle = () => ({ queue: [], running: false, current: null, controller: null, cancel: null });
  let cycle = newCycle(), starting = null;
  let stream = null, ownsStream = false, src = null, proc = null, mute = null;
  const resetPhrase = () => { live = false; loud = 0; quietMs = 0; chunks = []; pre = []; capture = null; };
  const abortError = () => Object.assign(new Error('Listening was stopped.'), { name: 'AbortError' });
  const valid = (owner, token) => owner === cycle && !ignore() && isCurrent(token);

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

  // Only one request per listening cycle. Capture continues while it runs, so a
  // question spoken just after its wake word is queued rather than discarded.
  async function pump(owner) {
    if (owner.running) return;
    owner.running = true;
    try {
      while (owner === cycle && owner.queue.length) {
        const job = owner.queue.shift();
        if (!valid(owner, job.token)) continue;
        owner.current = job;
        const controller = new AbortController(); owner.controller = controller;
        let timer, timedOut = false, cancel;
        try {
          // Race the whole operation, including body parsing. Abort alone cannot
          // release this queue if a browser/polyfill ignores its signal.
          const interrupted = new Promise((_, reject) => {
            cancel = () => reject(abortError());
            timer = setTimer(() => {
              timedOut = true; controller.abort();
              reject(Object.assign(new Error('Transcription timed out.'), { name: 'TimeoutError' }));
            }, timeoutMs);
          });
          owner.cancel = cancel;
          const operation = (async () => {
            const r = await fetch('/api/hear', { method: 'POST', signal: controller.signal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ audio: wav(job.parts), lang: job.lang }) });
            if (!r.ok) throw Object.assign(new Error('Transcription failed.'), { status: r.status });
            const body = await r.json();
            return typeof body.text === 'string' ? body.text : '';
          })();
          const text = await Promise.race([operation, interrupted]);
          if (text && valid(owner, job.token)) onText(text, job.token);
        } catch (error) {
          if (valid(owner, job.token) && error?.name !== 'AbortError' && (timedOut || !controller.signal.aborted)) {
            const details = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
              ? { status: error.status } : undefined;
            onDrop(timedOut ? 'transcription-timeout' : 'transcription-failed', job.token, details);
          }
        } finally {
          if (timer !== undefined) clearTimer(timer);
          if (owner.controller === controller) owner.controller = null;
          if (owner.cancel === cancel) owner.cancel = null;
          if (owner.current === job) owner.current = null;
        }
      }
    } finally { owner.running = false; }
  }

  function enqueue(parts, captured) {
    if (!captured) return;
    const owner = cycle;
    // Bound pending audio, not the first follow-up to an in-flight wake request.
    // On overflow drop the newest phrase explicitly; never evict/reorder old ones.
    if (owner.queue.length >= limit) {
      if (valid(owner, captured.token)) onDrop('queue-full', captured.token);
      return;
    }
    owner.queue.push({ parts, token: captured.token, lang: captured.lang });
    pump(owner);
  }

  function frame(x) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length), copy = Float32Array.from(x);
    if (ignore()) { resetPhrase(); return; }
    const on = rms > Math.max(0.015, floor * 3);
    if (!live) {
      floor = on ? floor : floor * 0.95 + rms * 0.05;
      pre.push(copy);
      if (pre.length > Math.ceil(350 / frameMs)) pre.shift(); // keep the start of the first word
      if (on && !loud) {
        const value = onCapture();
        // Shallow copy/freeze: the app field reference is identity, not a field to freeze.
        capture = { token: value && typeof value === 'object' ? Object.freeze({ ...value }) : value, lang: lang() };
      }
      loud = on ? loud + 1 : 0;
      if (!on) capture = null;
      if (loud >= 2) { live = true; quietMs = 0; chunks = [...pre]; pre = []; }
      return;
    }
    chunks.push(copy);
    quietMs = on ? 0 : quietMs + frameMs;
    const ms = chunks.length * frameMs;
    if (quietMs > 650 || ms > 7000) {
      live = false; loud = 0;
      const parts = chunks, captured = capture; chunks = []; capture = null;
      if (ms - quietMs > 250) enqueue(parts, captured); // a cough or a click is not a phrase
    }
  }

  const api = {
    get busy() { return cycle.running || cycle.queue.length > 0 || live; },
    get stream() { return stream; },
    // Include speech being captured, queued audio and the in-flight response. The
    // app uses onset tokens to keep a timely wake follow-up alive during ASR.
    hasPending(test = () => true) {
      const tokens = [capture?.token, cycle.current?.token, ...cycle.queue.map(job => job.token)];
      return tokens.some(token => token && valid(cycle, token) && test(token));
    },
    // The camera's audio stream is borrowed. Only a stream opened here is ours
    // to stop; stopping shared tracks would silence the camera's capture session.
    start(sharedStream) {
      if (stream) return Promise.resolve(api);
      if (starting) return starting;
      const owner = cycle;
      let pending;
      pending = (async () => {
        const acquired = sharedStream || await navigator.mediaDevices.getUserMedia({ audio: MIC });
        if (owner !== cycle) {
          if (!sharedStream) acquired.getTracks().forEach(track => track.stop());
          throw abortError();
        }
        stream = acquired; ownsStream = !sharedStream;
        try {
          src = ctx.createMediaStreamSource(stream); proc = ctx.createScriptProcessor(FRAME, 1, 1); mute = ctx.createGain();
          mute.gain.value = 0;
          proc.onaudioprocess = e => { if (owner === cycle && stream) frame(e.inputBuffer.getChannelData(0)); };
          src.connect(proc).connect(mute).connect(ctx.destination);
          return api;
        } catch (error) { api.stop(); throw error; }
      })().finally(() => { if (starting === pending) starting = null; });
      starting = pending;
      return pending;
    },
    stop() {
      const previous = cycle;
      cycle = newCycle();
      previous.queue.length = 0; previous.controller?.abort(); previous.cancel?.();
      resetPhrase(); floor = 0.01; starting = null;
      if (proc) proc.onaudioprocess = null;
      for (const node of [src, proc, mute]) { try { node?.disconnect(); } catch { /* already disconnected */ } }
      if (ownsStream) stream?.getTracks().forEach(track => track.stop());
      stream = null; ownsStream = false; src = null; proc = null; mute = null;
    },
  };
  return api;
}
