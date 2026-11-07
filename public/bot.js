// A robot finger that behaves like a blindfolded person: it hears only Nib's spoken words (never the
// screen), reacts after a human delay, keeps moving until told otherwise, overshoots, and wobbles.
// Practice mode only: open /?sim&bot. It measures how fast the voice gets a finger to each place,
// so changes to the guidance can be compared with numbers. Results: window.nibBot.
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SPEED = 0.11, SLOW = 0.04; // frame fractions per second: about 3.5 cm/s, then 1.2 cm/s when "a little"
const REACT = [350, 650]; // ms between hearing a word and acting on it
// Seeded, so before/after runs face the same start points and reaction times: /?sim&bot=3 is seed 3.
let seed = Number(new URLSearchParams(location.search).get('bot')) || 1;
const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = (a, b) => a + random() * (b - a);

export function startBot(S) {
  const stats = { fields: [], runs: 0 };
  window.nibBot = stats;
  let pos = { x: rand(0.2, 0.8), y: rand(0.2, 0.8) }, vel = { x: 0, y: 0 };
  let field = null, cues = 0, heard = [];

  addEventListener('nib:say', e => {
    const text = e.detail.text.toLowerCase();
    if (/^stop\b/.test(text)) return act(() => { vel = { x: 0, y: 0 }; });
    if (!e.detail.cue) return;
    const dir = Object.keys(DIRS).find(d => text.includes(d));
    if (!dir) return;
    cues++;
    heard.push(text);
    const v = /little/.test(text) ? SLOW : SPEED;
    act(() => { vel = { x: DIRS[dir][0] * v, y: DIRS[dir][1] * v }; });
  });
  const act = fn => setTimeout(fn, rand(...REACT));

  let last = performance.now(), writeSince = 0;
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const target = S.mode === 'guide' ? S.fields[S.i] : S.mode === 'find' ? S.find : null;
    if (target && target !== field?.target) {
      field = { target, label: target.label || 'find', t0: now };
      cues = 0;
      heard = [];
    }
    if (S.mode === 'write' && field?.target) {
      stats.fields.push({ label: field.label, seconds: +((now - field.t0) / 1000).toFixed(1), cues, words: heard.slice(0, 12).join(' / ') });
      field = { target: null };
      vel = { x: 0, y: 0 };
      writeSince = now;
    }
    // "Writes" for a moment, then says done (Space), like a person would.
    if (S.mode === 'write' && writeSince && now - writeSince > 1200) {
      writeSince = 0;
      dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    }
    // Confirms the readback like a person would.
    if (S.mode === 'confirm' && !S.botConfirming) {
      S.botConfirming = true;
      setTimeout(() => {
        S.botConfirming = false;
        dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
      }, 700);
    }
    if (S.mode === 'done' && !stats.finished) {
      stats.finished = true;
      const s = stats.fields.map(f => f.seconds);
      stats.mean = +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(1);
      stats.worst = Math.max(...s);
      console.log('[bot] done', JSON.stringify(stats));
    }
    // Move with a small human wobble, and keep the finger on the page.
    pos.x = Math.min(0.98, Math.max(0.02, pos.x + vel.x * dt + rand(-1, 1) * 0.0015));
    pos.y = Math.min(0.98, Math.max(0.02, pos.y + vel.y * dt + rand(-1, 1) * 0.0015));
    S.pointer = { ...pos };
  }, 33);
}
