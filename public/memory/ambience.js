// The room's own quiet sound, made on the phone, for memories with no music in them. Lyria (the music model)
// turns every prompt into music, even "no music", so a room nobody said had music gets this instead:
// soft room tone, plus rain, a fan, cooking or a clock when the words mention them. Free, instant, never a song.

const has = (text, re) => re.test(text);

// fill a buffer with a noise recipe; seconds long, looped
function noise(c, seconds, fill) {
  const n = Math.round(c.sampleRate * seconds), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  fill(d, c.sampleRate);
  return buf;
}
const white = d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
const brown = d => { let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } };
const crackle = d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0; };
const ticks = (d, rate) => { for (let s = 0; s < d.length / rate; s++) for (let k = 0; k < 220; k++) d[s * rate + k] = (Math.random() * 2 - 1) * Math.exp(-k / 30); };

// text: everything the person said plus the scene plan. Returns { out, stop } where out is a GainNode to connect.
export function ambience(c, text = '') {
  const t = String(text).toLowerCase(), out = c.createGain(), stops = [];
  const layer = (buf, gain, filter) => {
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.loop = true; g.gain.value = gain;
    let node = src;
    if (filter) { const f = c.createBiquadFilter(); Object.assign(f, { type: filter.type }); f.frequency.value = filter.f; f.Q.value = filter.q || 0.7; node = node.connect(f); }
    node.connect(g).connect(out);
    src.start(0, Math.random() * buf.duration);
    stops.push(() => { try { src.stop(); } catch { } });
    return g;
  };
  // the room itself: a low, quiet air
  layer(noise(c, 6, brown), 0.35, { type: 'lowpass', f: 420 });
  if (has(t, /rain|monsoon|storm|drizzl|pouring|thunder|wet/)) layer(noise(c, 5, white), 0.07, { type: 'bandpass', f: 2600, q: 0.5 });
  if (has(t, /\bfan\b|ceiling fan|cooler|air ?condition|\bac\b|heater|radiator|hum/)) {
    const g = layer(noise(c, 4, white), 0.05, { type: 'lowpass', f: 700 });
    const lfo = c.createOscillator(), depth = c.createGain(); // the blades: a slow pulse in the hum
    lfo.frequency.value = 4.5; depth.gain.value = 0.02; lfo.connect(depth).connect(g.gain); lfo.start();
    stops.push(() => { try { lfo.stop(); } catch { } });
  }
  if (has(t, /fire|stove|chulha|hearth|tawa|sizzl|fry|frying|cook|kettle|boil|fireplace|wood|coal|comal|oven/)) layer(noise(c, 7, crackle), 0.5, { type: 'highpass', f: 1800 });
  if (has(t, /clock|ticking|tick/)) layer(noise(c, 4, ticks), 0.18, { type: 'bandpass', f: 3200, q: 2 });
  return { out, stop: () => stops.forEach(s => s()) };
}

export const MUSIC = /\b(radio|music|song|songs|sing|singing|sang|singer|record player|records?|gramophone|radiogram|tape|cassette|piano|guitar|harmonium|tabla|violin|band|hymn|bhajan|qawwali|ghazal|dance|dancing)\b/i;
