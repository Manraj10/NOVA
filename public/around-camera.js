// Owns camera/microphone tracks, never creates a speech recognizer. Track settings
// verify device selection; optical FOV and iPhone behavior require device testing.
// Camera controls: https://www.w3.org/TR/image-capture/
const wideName = s => /ultra[\s-]*wide|0[.,]5\s*[x×]?/i.test(s || '') && !/front|facetime/i.test(s || '');
const abort = () => Object.assign(new Error('Camera operation superseded.'), { name: 'AbortError' });
const live = track => !!track && track.readyState === 'live';
const settings = track => { try { return track?.getSettings?.() || {}; } catch { return {}; } };
const capabilities = track => { try { return track?.getCapabilities?.() || {}; } catch { return {}; } };

export function makeAroundCamera({ video, phone = false, portrait = () => innerHeight > innerWidth,
  mediaDevices = navigator.mediaDevices, createStream = tracks => new MediaStream(tracks),
  audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, onChange = () => {} } = {}) {
  let generation = 0, active = null, pending = null, operation = null;
  const stopTrack = (session, track) => { session.owned.delete(track); try { track.stop(); } catch { /* ended */ } };
  const release = session => { if (session) for (const track of [...session.owned]) stopTrack(session, track); };
  const own = (session, stream) => { for (const track of stream.getTracks()) session.owned.add(track); return stream; };
  const check = session => { if (session.generation !== generation || session !== operation) throw abort(); };
  const size = () => phone && portrait() ? { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 } }
    : { width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } };
  const info = session => {
    if (!session) return null;
    const s = settings(session.track), zoom = Number.isFinite(s.zoom) ? s.zoom : null;
    return { lens: session.lens, verifiedDevice: session.verifiedDevice, deviceId: s.deviceId || null,
      zoom, width: s.width || null, height: s.height || null, facingMode: s.facingMode || null,
      audioLive: !!session.mic?.getAudioTracks().some(live),
      torchSupported: capabilities(session.track).torch === true, torch: typeof s.torch === 'boolean' ? s.torch : null,
      fieldOfViewKnown: false };
  };
  const request = async (session, constraints) => {
    const stream = own(session, await mediaDevices.getUserMedia(constraints));
    check(session); return stream;
  };
  const videoOnly = async (session, id) => {
    const stream = await request(session, { video: { ...size(), ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } }) }, audio: false });
    const track = stream.getVideoTracks()[0];
    for (const extra of stream.getTracks()) if (extra !== track) stopTrack(session, extra);
    if (!live(track)) throw new Error('No live video track.');
    return track;
  };
  const tune = async session => {
    const track = session.track, caps = capabilities(track), advanced = [];
    for (const name of ['focusMode', 'exposureMode', 'whiteBalanceMode'])
      if (Array.isArray(caps[name]) && caps[name].includes('continuous')) advanced.push({ [name]: 'continuous' });
    const min = caps.zoom?.min;
    if (Number.isFinite(min) && min > 0 && (!Number.isFinite(settings(track).zoom) || settings(track).zoom > min)) advanced.push({ zoom: min });
    // One unsupported optional mode must not prevent the remaining controls.
    for (const constraint of advanced) {
      try { await track.applyConstraints({ advanced: [constraint] }); } catch { /* optional camera control */ }
      check(session);
    }
    const zoom = settings(track).zoom;
    if (session.lens !== 'ultra wide' && Number.isFinite(zoom) && zoom < 1 && Number.isFinite(min)
      && Math.abs(zoom - min) <= Math.max(.01, (caps.zoom?.step || 0) / 2)) session.lens = `zoom ${zoom}×`;
  };
  const select = async session => {
    // Permission is granted before enumerating: browsers otherwise hide labels.
    let devices = [];
    try { devices = await mediaDevices.enumerateDevices(); } catch { /* enumeration unavailable */ }
    check(session);
    const wide = devices.find(d => d.kind === 'videoinput' && d.deviceId && wideName(d.label));
    const initialId = settings(session.track).deviceId;
    if (wide && initialId === wide.deviceId) { session.lens = 'ultra wide'; session.verifiedDevice = true; }
    else if (wide) {
      // Release the old video source before switching for exclusive-camera phones;
      // its audio tracks remain open and will be reused by the same ears.
      stopTrack(session, session.track);
      let selected;
      try {
        selected = await videoOnly(session, wide.deviceId);
        if (settings(selected).deviceId !== wide.deviceId) throw new Error('Requested camera was not confirmed.');
        session.track = selected; session.lens = 'ultra wide'; session.verifiedDevice = true;
      } catch (error) {
        if (selected) stopTrack(session, selected);
        check(session);
        session.track = await videoOnly(session, initialId);
        session.lens = 'main';
      }
    }
    if (settings(session.track).facingMode === 'user') { session.lens = 'front'; session.verifiedDevice = false; }
    await tune(session);
  };
  const acquire = async session => {
    const previous = active;
    const preservedAudio = previous?.mic?.getAudioTracks().filter(live) || [];
    let stream;
    try { stream = await request(session, { video: { ...size(), facingMode: { ideal: 'environment' } }, audio: preservedAudio.length ? false : audio }); }
    catch (error) {
      check(session);
      if (preservedAudio.length || audio === false) throw error;
      stream = await request(session, { video: { ...size(), facingMode: { ideal: 'environment' } }, audio: false });
    }
    session.track = stream.getVideoTracks()[0];
    if (!live(session.track)) throw new Error('No live camera track.');
    const newAudio = stream.getAudioTracks().filter(live);
    session.mic = preservedAudio.length ? previous.mic : newAudio.length ? createStream(newAudio) : null;
    await select(session); check(session);
    const display = createStream([session.track]);
    video.srcObject = display;
    await video.play(); check(session);
    // Commit only after playback succeeds. Transfer ownership of preserved audio
    // before releasing the previous session; never stop the microphone on a lens change.
    for (const track of preservedAudio) { previous.owned.delete(track); session.owned.add(track); }
    active = session; if (previous) release(previous);
    try { onChange(info(session)); } catch { /* a status label must not stop capture */ }
    return { ...info(session), micStream: session.mic };
  };
  const api = {
    get info() { return info(active); },
    get micStream() { return active?.mic || null; },
    get track() { return active?.track || null; },
    get live() { return live(active?.track); },
    start() {
      if (pending) return pending;
      if (live(active?.track) && active.mic && !active.mic.getAudioTracks().some(live)) api.suspend();
      if (live(active?.track)) return api.recover();
      const session = { generation, owned: new Set(), track: null, mic: null, lens: 'main', verifiedDevice: false, torchQueue: Promise.resolve(), torchQueued: 0 };
      operation = session;
      let promise;
      promise = acquire(session).catch(error => {
        release(session);
        if (video.srcObject?.getVideoTracks?.().includes(session.track)) video.srcObject = null;
        throw error;
      }).finally(() => { if (pending === promise) pending = null; });
      pending = promise; return promise;
    },
    async recover() {
      if (active?.mic && !active.mic.getAudioTracks().some(live)) api.suspend();
      if (!live(active?.track)) return api.start();
      const session = active, token = generation;
      try { await session.track.applyConstraints(size()); } catch { /* keep supported capture size */ }
      if (generation !== token || active !== session) throw abort();
      await video.play();
      if (generation !== token || active !== session) throw abort();
      try { onChange(info(session)); } catch { /* status callback only */ }
      return { ...info(session), micStream: session.mic };
    },
    // Background suspension retains a live microphone for the existing listener.
    suspend() {
      generation++; const old = operation; operation = null; pending = null;
      if (old && old !== active) release(old);
      if (active?.track) stopTrack(active, active.track);
      video.pause?.(); video.srcObject = null;
    },
    stop() {
      generation++; const old = operation; operation = null; pending = null;
      if (old && old !== active) release(old);
      release(active); active = null;
      video.pause?.(); video.srcObject = null;
    },
    async setTorch(enabled) {
      const session = active, token = generation;
      const unavailable = { supported: false, enabled: null, verified: false };
      if (typeof enabled !== 'boolean' || !live(session?.track) || capabilities(session.track).torch !== true || session.torchQueued >= 2) return unavailable;
      session.torchQueued++;
      const task = session.torchQueue.catch(() => {}).then(async () => {
        if (generation !== token || active !== session || !live(session.track)) return unavailable;
        try { await session.track.applyConstraints({ advanced: [{ torch: enabled }] }); } catch { return unavailable; }
        if (generation !== token || active !== session) return unavailable;
        const actual = settings(session.track).torch;
        return { supported: true, enabled: typeof actual === 'boolean' ? actual : null, verified: actual === enabled };
      }).finally(() => { session.torchQueued--; });
      session.torchQueue = task; return task;
    },
  };
  return api;
}
