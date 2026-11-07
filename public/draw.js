// Everything drawn over the camera view: the scan, the spotlight, sonar rings, the sign-here flag,
// field outlines, the fingertip, and the finishing stamp.

const C = {
  carbon: '#1A1F4E',
  deep: '#10132F',
  flag: '#FFE14D',
  paper: '#F7F6F2',
  stamp: '#2FBF71',
  stampInk: '#17784A',
  marker: '#FF4FA3',
};
const SANS = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
const MONO = '"Atkinson Hyperlegible Mono", ui-monospace, monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ease = t => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const back = t => { t = Math.min(1, Math.max(0, t)); const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
// One overlay scale: 1 on a phone, about 1.3 on a laptop, about 1.65 on a 1080p projector.
// Guidance maths uses frame fractions, so this only changes how big things are drawn.
let u = 1;

export function fitOf(cw, ch, w, h) {
  const s = Math.min(cw / w, ch / h);
  return { s, ox: (cw - w * s) / 2, oy: (ch - h * s) / 2, w, h };
}

export function anchorOf(f) {
  if (f.kind === 'checkbox' || f.kind === 'button' || f.kind === 'find') return { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 };
  return { x: f.x0 + Math.min(0.01, (f.x1 - f.x0) * 0.08), y: (f.y0 + f.y1) / 2 };
}

function flagText(f) {
  if (f.kind === 'signature') return 'SIGN HERE';
  if (f.kind === 'checkbox') return 'CHECK HERE';
  if (f.kind === 'button') return 'TAP HERE';
  if (f.kind === 'find') return 'HERE';
  const t = f.label.toUpperCase();
  return t.length > 22 ? t.slice(0, 21) + '…' : t;
}

export function render(ctx, S, src, now) {
  const cw = ctx.canvas.clientWidth, ch = ctx.canvas.clientHeight;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, cw, ch);
  if (!src.w || !src.h) return;
  const fit = fitOf(cw, ch, src.w, src.h);
  S.fit = fit;
  const P = (x, y) => [fit.ox + x * src.w * fit.s, fit.oy + y * src.h * fit.s];
  const R = f => { const [x, y] = P(f.x0, f.y0), [x1, y1] = P(f.x1, f.y1); return { x, y, w: x1 - x, h: y1 - y }; };
  const still = reduceMotion.matches;
  const frame = { x: fit.ox, y: fit.oy, w: src.w * fit.s, h: src.h * fit.s };
  u = Math.min(2, Math.max(1, frame.h / 520));

  ctx.save();
  // The stamp lands with a short shake.
  const sa = S.mode === 'done' ? now - S.finishedAt - 220 : -1;
  if (!still && sa >= 0 && sa < 140) { const m = 8 * u * (1 - sa / 140); ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m); }

  try { ctx.drawImage(src.img, frame.x, frame.y, frame.w, frame.h); } catch { /* video not ready */ }

  const seeking = S.mode === 'guide' || S.mode === 'find';
  const active = S.mode === 'find' ? S.find : ['guide', 'write', 'check', 'confirm'].includes(S.mode) ? S.fields[S.i] : null;
  if (active) spotlight(ctx, S, R(active), frame, still, now);
  else S.hole = null;

  // The scan: loops while the AI reads, then one clean pass that "finds" each field.
  if (S.mode === 'reading') {
    const label = (S.reviewed ? 'FINAL CHECK' : 'READING THE PAGE') + (S.readT0 ? ` · ${((now - S.readT0) / 1000).toFixed(1)} s` : '');
    scan(ctx, frame, still ? 0.5 : (now % 1700) / 1700, label);
  }
  if (S.mode === 'reveal' && !still) {
    const p = (now - S.revealStart) / 1300;
    if (p <= 1) scan(ctx, frame, p);
  }

  // now (spotlit) / next (yellow badge) / later (light outline) / done (green stamp)
  const nextK = !active ? -1 : S.mode === 'find' ? S.i : S.fields.findIndex((f, k) => k > S.i && !f.done);
  S.fields.forEach((f, k) => {
    if (S.mode === 'reveal' && now < f.revealAt) return;
    const r = R(f);
    const pop = S.mode === 'reveal' && !still ? back((now - f.revealAt) / 380) : 1;
    ctx.save();
    if (pop < 1) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(0.8 + 0.2 * pop, 0.8 + 0.2 * pop);
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    }
    if (f === active) highlighter(ctx, r, still ? 1 : ease((now - S.sweepAt) / 480));
    else if (f.done && !f.skipped) doneField(ctx, f, r, now, still);
    else pending(ctx, r, k + 1, f.skipped, S.mode === 'reveal' ? Math.max(0, 1 - (now - f.revealAt) / 500) : 0, !!active, k === nextK);
    ctx.restore();
  });

  // During the reveal, a counter ticks up with each place found.
  if (S.mode === 'reveal') {
    const n = S.fields.filter(f => now >= f.revealAt).length;
    if (n !== S.foundN) { S.foundN = n; S.foundAt = now; }
    if (n > 0) chip(ctx, `${n} ${n === 1 ? 'PLACE' : 'PLACES'} FOUND`, frame.x + frame.w / 2, frame.y + 20 * u, still ? 1 : 1.25 - 0.25 * ease((now - S.foundAt) / 260));
  } else S.foundN = 0;

  if (S.mode === 'find' && active) { ctx.save(); highlighter(ctx, R(active), still ? 1 : ease((now - S.sweepAt) / 480)); ctx.restore(); }

  const A = active ? P(anchorOf(active).x, anchorOf(active).y) : null;
  const b = (now - S.burstAt) / 650;
  if (active) {
    const [ax, ay] = A;
    if (seeking) {
      sonar(ctx, S, ax, ay, now, still);
      if (S.tip && now - S.tipSeen < 500) guideLine(ctx, P(S.tip.x, S.tip.y), A, now, still);
    }
    // The flag swells from its point at the same moment as the chime and "Stop".
    const pop = !still && S.mode === 'write' && b >= 0 && b < 1 ? 0.22 * Math.sin(Math.min(1, b / 0.5) * Math.PI) * (1 - b) : 0;
    flag(ctx, S, flagText(active), ax, ay, still, pop);
  }
  // Plant the flag: two rings burst out from where the finger landed (the found spot after a "where is").
  if (S.burstPt && b >= 0 && b < 1 && !still) {
    const [bx, by] = P(S.burstPt.x, S.burstPt.y);
    ring(ctx, bx, by, (18 + ease(b) * 72) * u, 7 * u * (1 - b), C.flag, 1 - b);
    const b2 = b - 90 / 650;
    if (b2 > 0) ring(ctx, bx, by, (18 + ease(b2) * 132) * u, 5 * u * (1 - b2), C.flag, 0.8 * (1 - b2));
  }

  if (!S.sim && S.handPts?.length && now - (S.handAt || 0) < 300) S.handPts.forEach((h, i) => skeleton(ctx, h, P, i === S.pointerIdx));
  if (S.tip && now - S.tipSeen < 500 && S.mode !== 'done' && S.mode !== 'check') fingertip(ctx, S, P, now, still, A);

  if (S.mode === 'done' && S.fields.length) finishStamp(ctx, S, frame, now, still);
  ctx.restore();
}

// A ring with a dark under-stroke, so it reads on white paper and on a dark table.
function ring(ctx, x, y, r, w, color, a) {
  if (w <= 0 || a <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2);
  ctx.lineWidth = w + 4 * u;
  ctx.strokeStyle = 'rgba(8,10,30,.55)';
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

// A centred pill label, scaled about its own centre.
function chip(ctx, text, cx, top, scale) {
  ctx.save();
  ctx.font = `800 ${26 * u}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
  const w = ctx.measureText(text).width + 36 * u, h = 26 * u + 20 * u;
  ctx.translate(cx, top + h / 2);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(8,10,30,.45)';
  ctx.shadowBlur = 18 * u;
  ctx.fillStyle = C.flag;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.carbon;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

// The live hand: 21 tracked points, drawn faintly so the room can see it's really following the hand.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
// The hand Nib follows is drawn in flag yellow; any other hand (the pen hand) stays faint.
function skeleton(ctx, pts, P, pointer) {
  ctx.save();
  ctx.strokeStyle = pointer ? 'rgba(255,225,77,.85)' : 'rgba(247,246,242,.3)';
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const [x0, y0] = P(pts[a].x, pts[a].y), [x1, y1] = P(pts[b].x, pts[b].y);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.fillStyle = pointer ? 'rgba(255,225,77,.95)' : 'rgba(247,246,242,.45)';
  for (const p of pts) { const [x, y] = P(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, 2.5 * u, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function scan(ctx, frame, p, label) {
  const y = frame.y + p * frame.h;
  ctx.save();
  const g = ctx.createLinearGradient(0, y - 160 * u, 0, y);
  g.addColorStop(0, 'rgba(255,225,77,0)');
  g.addColorStop(1, 'rgba(255,225,77,.55)');
  ctx.fillStyle = g;
  ctx.fillRect(frame.x, y - 160 * u, frame.w, 160 * u);
  ctx.shadowColor = C.flag;
  ctx.shadowBlur = 24 * u;
  ctx.fillStyle = C.flag;
  ctx.fillRect(frame.x, y - 2.5 * u, frame.w, 5 * u);
  ctx.restore();
  if (!label) return;
  ctx.save();
  ctx.font = `700 ${14 * u}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.1em';
  const cw = ctx.measureText(label).width + 24 * u, x = frame.x + 16 * u, top = Math.max(frame.y + 6 * u, y - 38 * u);
  ctx.fillStyle = C.flag;
  ctx.beginPath();
  ctx.roundRect(x, top, cw, 28 * u, 14 * u);
  ctx.fill();
  ctx.fillStyle = C.carbon;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 12 * u, top + 14 * u + 1);
  ctx.restore();
}

// Dim everything except the field in play. The hole glides from field to field; four corner brackets
// frame it like a viewfinder and breathe slowly.
function spotlight(ctx, S, r, frame, still, now) {
  const pad = 20 * u;
  const target = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  if (!S.hole || still) S.hole = { ...target, a: still ? 1 : 0 };
  else for (const k of ['x', 'y', 'w', 'h']) S.hole[k] += (target[k] - S.hole[k]) * 0.16;
  S.hole.a = Math.min(1, S.hole.a + 0.06);
  const h = S.hole;
  ctx.save();
  ctx.fillStyle = `rgba(8,10,30,${0.62 * h.a})`;
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.w, frame.h);
  ctx.roundRect(h.x, h.y, h.w, h.h, 16 * u);
  ctx.fill('evenodd');
  ctx.strokeStyle = `rgba(255,225,77,${0.35 * h.a})`;
  ctx.lineWidth = u;
  ctx.beginPath();
  ctx.roundRect(h.x, h.y, h.w, h.h, 16 * u);
  ctx.stroke();
  const L = Math.min(28 * u, h.w / 3, h.h / 2), x0 = h.x, y0 = h.y, x1 = h.x + h.w, y1 = h.y + h.h;
  ctx.lineWidth = 4 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(255,225,77,${h.a})`;
  ctx.shadowColor = C.flag;
  ctx.shadowBlur = 14 * u * (still ? 1 : 0.75 + 0.25 * Math.sin(now / 420));
  ctx.beginPath();
  ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
  ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
  ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
  ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
  ctx.stroke();
  ctx.restore();
}

function highlighter(ctx, r, t) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,225,77,.92)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6 * u, r.y - 4 * u, (r.w + 12 * u) * t, r.h + 8 * u, 5 * u);
  ctx.fill();
}

// Carbon dashes vanish on a dimmed page, so while a spotlight is on the outlines switch to light ink.
function pending(ctx, r, n, skipped, flash, dim, next) {
  const box = () => { ctx.beginPath(); ctx.roundRect(r.x - 4 * u, r.y - 3 * u, r.w + 8 * u, r.h + 6 * u, 5 * u); };
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,225,77,${flash * 0.7})`;
    box();
    ctx.fill();
  }
  ctx.setLineDash([6 * u, 5 * u]);
  ctx.lineWidth = (next ? 3 : 2) * u;
  ctx.strokeStyle = dim ? `rgba(247,246,242,${skipped ? 0.3 : next ? 0.95 : 0.6})` : skipped ? 'rgba(26,31,78,.25)' : 'rgba(26,31,78,.62)';
  box();
  ctx.stroke();
  ctx.setLineDash([]);
  const rad = (next ? 12 : 10) * u, x = r.x - 17 * u, y = r.y + r.h / 2;
  ctx.fillStyle = next ? C.flag : skipped && !dim ? 'rgba(26,31,78,.3)' : C.carbon;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
  if (dim && !next) {
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = 'rgba(247,246,242,.6)';
    ctx.stroke();
  }
  ctx.fillStyle = next ? C.carbon : C.paper;
  ctx.font = `700 ${(next ? 13 : 11) * u}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

function doneField(ctx, f, r, now, still) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(47,191,113,.32)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6 * u, r.y - 4 * u, r.w + 12 * u, r.h + 8 * u, 5 * u);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const age = now - (f.doneAt || 0);
  const t = still ? 1 : back(age / 360);
  const cx = r.x + r.w + 18 * u, cy = r.y + r.h / 2, rad = 12 * u * t;
  if (rad < 0.5) return; // not stamped yet (the finish ripple re-pops checks top to bottom)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.fillStyle = C.stamp;
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = 'rgba(16,19,47,.9)';
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-rad * 0.42, 0);
  ctx.lineTo(-rad * 0.1, rad * 0.32);
  ctx.lineTo(rad * 0.45, -rad * 0.34);
  ctx.stroke();
  ctx.restore();
}

// Sonar: steady rings mark the target, and each beep sends a ring out, so the room can see the sound.
function sonar(ctx, S, ax, ay, now, still) {
  for (let k = 1; k <= 3; k++) ring(ctx, ax, ay, k * 30 * u, 2 * u, C.flag, 0.55 - k * 0.13);
  if (still) return;
  S.pulses = S.pulses.filter(p => now - p.t < 750);
  for (const p of S.pulses) {
    const q = (now - p.t) / 750;
    if (p.on) ring(ctx, ax, ay, (14 + ease(q) * 60) * u, 6 * u, C.flag, 1 - q);
    else ring(ctx, ax, ay, (14 + ease(q) * 130) * u, 3 * u, '#fff', 0.85 * (1 - q));
  }
}

// A dotted line from the fingertip that ends in an arrowhead just short of the flag.
function guideLine(ctx, [tx, ty], [ax, ay], now, still) {
  const ang = Math.atan2(ay - ty, ax - tx), L = Math.hypot(ax - tx, ay - ty);
  if (L < 60 * u) return;
  const hx = ax - Math.cos(ang) * 24 * u, hy = ay - Math.sin(ang) * 24 * u;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, 11 * u]);
  ctx.lineDashOffset = still ? 0 : -(now / 40) % (11 * u);
  for (const [w, c] of [[8 * u, 'rgba(8,10,30,.55)'], [4 * u, C.marker]]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-14 * u, -6 * u);
  ctx.lineTo(-14 * u, 6 * u);
  ctx.closePath();
  ctx.fillStyle = C.marker;
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = C.deep;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// The fingertip: pink when far, warming to flag yellow as it closes in. A dashed ring centred on the
// target passes through the finger and tightens as it closes in; on arrival a dial fills for the dwell.
function fingertip(ctx, S, P, now, still, A) {
  const [tx, ty] = P(S.tip.x, S.tip.y);
  const seeking = S.mode === 'guide' || S.mode === 'find';
  const c = seeking ? 1 - Math.min(1, S.prox ?? 1) : 0;
  const col = `rgb(255,${Math.round(79 + 146 * c)},${Math.round(163 - 86 * c)})`;
  const on = S.onTarget && seeking;
  ctx.save();
  S.trail.forEach((p, i) => {
    const [px, py] = P(p.x, p.y);
    ctx.globalAlpha = (i / S.trail.length) * 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, (3 + (i / S.trail.length) * 3) * u, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  if (seeking && A && !on) {
    const d = Math.hypot(tx - A[0], ty - A[1]);
    ctx.save();
    ctx.setLineDash([8 * u, 8 * u]);
    ctx.lineDashOffset = still ? 0 : -now / 30;
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(A[0], A[1], Math.min(260 * u, Math.max(30 * u, d)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.shadowColor = 'rgba(16,19,47,.5)';
  ctx.shadowBlur = 12 * u;
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = on ? C.carbon : col;
  ctx.fillStyle = on ? 'rgba(255,225,77,.6)' : 'rgba(255,255,255,.18)';
  ctx.beginPath();
  ctx.arc(tx, ty, (on && !still ? 19 + Math.sin(now / 80) * 2.5 : 19) * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The dwell dial shows progress, so it stays on even with reduced motion.
  if (on && S.arrivedSince) {
    const p = Math.min(1, (now - S.arrivedSince) / 450);
    ctx.lineWidth = 6 * u;
    ctx.strokeStyle = C.flag;
    ctx.beginPath();
    ctx.arc(tx, ty, 27 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.carbon;
    ctx.beginPath();
    ctx.arc(tx, ty, 27 * u, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(tx, ty, 5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The signature element: a sign-here tab that glides to the next place to write.
function flag(ctx, S, text, ax, ay, still, pop = 0) {
  ctx.save();
  ctx.font = `800 ${16 * u}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
  const tw = ctx.measureText(text).width;
  const h = 36 * u, tip = 16 * u, bodyW = tw + 28 * u, r = 6 * u;
  const roomLeft = ax - (bodyW + tip + 8 * u) > 4;
  const cw = ctx.canvas.clientWidth, ch = ctx.canvas.clientHeight;
  const clampX = v => Math.max(4, Math.min(cw - bodyW - 4, v)), clampY = v => Math.max(4, Math.min(ch - h - 6, v));
  const target = roomLeft ? { x: Math.max(4, ax - tip - 8 * u - bodyW), y: clampY(ay - h / 2), dir: 'right' } : { x: clampX(ax - bodyW / 2), y: clampY(ay + 24 * u + tip), dir: 'up' };
  if (!S.flag || still || S.flag.dir !== target.dir) S.flag = { ...target };
  else { S.flag.x += (target.x - S.flag.x) * 0.2; S.flag.y += (target.y - S.flag.y) * 0.2; }
  const { x, y, dir } = S.flag;
  const ux = Math.max(tip + r, Math.min(bodyW - tip - r, ax - x)); // the up-arrow still points at the blank after clamping
  if (pop) {
    const [px, py] = dir === 'right' ? [x + bodyW + tip, y + h / 2] : [x + ux, y - tip];
    ctx.translate(px, py);
    ctx.scale(1 + pop, 1 + pop);
    ctx.translate(-px, -py);
  }
  ctx.shadowColor = 'rgba(8,10,30,.45)';
  ctx.shadowBlur = 16 * u;
  ctx.shadowOffsetY = 5 * u;
  ctx.fillStyle = C.flag;
  ctx.beginPath();
  if (dir === 'right') {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bodyW, y);
    ctx.lineTo(x + bodyW + tip, y + h / 2);
    ctx.lineTo(x + bodyW, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  } else {
    ctx.moveTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + ux - tip * 0.7, y);
    ctx.lineTo(x + ux, y - tip);
    ctx.lineTo(x + ux + tip * 0.7, y);
    ctx.lineTo(x + bodyW - r, y);
    ctx.quadraticCurveTo(x + bodyW, y, x + bodyW, y + r);
    ctx.lineTo(x + bodyW, y + h - r);
    ctx.quadraticCurveTo(x + bodyW, y + h, x + bodyW - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.carbon;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 14 * u, y + h / 2 + 1);
  ctx.restore();
}

// The finish: a paper stamp slams onto the page. It only says COMPLETED INDEPENDENTLY when that is true:
// nothing skipped, nothing unclear, and the final check actually ran.
function finishStamp(ctx, S, frame, now, still) {
  const age = now - S.finishedAt;
  const filled = S.fields.filter(f => f.done && !f.skipped).length;
  const open = S.fields.filter(f => f.skipped || f.review || !f.done).length;
  const clean = !open && !S.reviewFailed;
  const ink = clean ? C.stampInk : C.carbon;
  ctx.save();
  ctx.fillStyle = `rgba(8,10,30,${0.5 * (still ? 1 : ease(age / 300))})`;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  const w = Math.min(frame.w * 0.8, 560 * u), h = w * 0.42, cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const t = age / 380, scale = still || t >= 1 ? 1 : 2.4 - 1.4 * back(t);
  const outline = () => { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.03); };
  ctx.translate(cx, cy);
  ctx.rotate(-0.1);
  // An ink ring spreads out from the stamp as it lands.
  const k = (age - 200) / 600;
  if (!still && k > 0 && k < 1) {
    ctx.save();
    ctx.scale(1 + 0.4 * ease(k), 1 + 0.4 * ease(k));
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.lineWidth = 6 * u * (1 - k);
    ctx.strokeStyle = ink;
    outline();
    ctx.stroke();
    ctx.restore();
  }
  ctx.scale(scale, scale);
  ctx.globalAlpha = still ? 1 : Math.min(1, age / 120);
  ctx.fillStyle = 'rgba(247,246,242,.96)';
  outline();
  ctx.fill();
  ctx.lineWidth = w * 0.014;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = w * 0.004;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + w * 0.02, -h / 2 + w * 0.02, w - w * 0.04, h - w * 0.04, w * 0.02);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${h * 0.3}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.04em';
  ctx.fillText(clean ? 'COMPLETED' : 'FINISHED', 0, -h * 0.17);
  ctx.font = `800 ${h * 0.15}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2em';
  ctx.fillText(clean ? 'INDEPENDENTLY' : S.reviewFailed && !open ? 'HAVE IT CHECKED' : `${open} TO CHECK`, 0, h * 0.1);
  ctx.font = `700 ${h * 0.1}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.1em';
  ctx.fillText(`${filled}/${S.fields.length} FILLED · ${S.elapsed || ''}`, 0, h * 0.32);
  ctx.restore();
}
