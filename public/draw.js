// Everything drawn over the camera view, in Apple's AR language: a rounded viewfinder, a Live Text
// shimmer while the page is read, Live Text brackets on the blank in play, a callout naming it, a
// Measure-style reticle and dotted line for the fingertip, check badges, and an Apple Pay-style check
// at the finish.

const C = {
  tint: '#FFD60A',
  ink: '#1C1C1E',
  white: '#FFFFFF',
  green: '#30D158',
  orange: '#FF9F0A',
};
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ease = t => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
// A spring-like overshoot, the feel of Apple's interactive springs.
const back = t => { t = Math.min(1, Math.max(0, t)); const c = 1.4; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
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

function labelOf(f) {
  if (f.kind === 'signature') return 'Sign here';
  if (f.kind === 'checkbox') return 'Check here';
  if (f.kind === 'button') return 'Tap here';
  if (f.kind === 'find') return 'Here';
  return f.label.length > 26 ? f.label.slice(0, 25) + '…' : f.label;
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

  // The viewfinder: the live picture in a rounded frame with a hairline edge.
  const rad = 22 * u;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, rad);
  ctx.clip();
  try { ctx.drawImage(src.img, frame.x, frame.y, frame.w, frame.h); } catch { /* video not ready */ }
  ctx.restore();

  const seeking = S.mode === 'guide' || S.mode === 'find';
  const active = S.mode === 'find' ? S.find : ['guide', 'write', 'check', 'confirm'].includes(S.mode) ? S.fields[S.i] : null;
  if (active) spotlight(ctx, S, R(active), frame, rad, still, now);
  else S.hole = null;

  // Reading: a Live Text shimmer sweeps the page, with a status capsule and a live timer.
  if (S.mode === 'reading') {
    shimmer(ctx, frame, rad, still ? 0.5 : ((now - (S.readT0 || 0)) % 1900) / 1900);
    const label = (S.reviewed ? 'Final check' : 'Reading the page') + (S.readT0 ? ` · ${((now - S.readT0) / 1000).toFixed(1)} s` : '');
    capsule(ctx, label, frame.x + 16 * u, frame.y + 16 * u, 'left', 1);
  }
  if (S.mode === 'reveal' && !still) {
    const p = (now - S.revealStart) / 1300;
    if (p <= 1) shimmer(ctx, frame, rad, p);
  }

  // Blanks: the one in play has brackets; the next is marked; done ones carry a check.
  const nextK = !active ? -1 : S.mode === 'find' ? S.i : S.fields.findIndex((f, k) => k > S.i && !f.done);
  S.fields.forEach((f, k) => {
    if (f.stale || (S.mode === 'reveal' && now < f.revealAt)) return;
    const r = R(f);
    const pop = S.mode === 'reveal' && !still ? back((now - f.revealAt) / 420) : 1;
    ctx.save();
    if (pop < 1) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
      ctx.globalAlpha = Math.min(1, pop * 1.4);
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    }
    if (f === active) highlighter(ctx, r, still ? 1 : ease((now - S.sweepAt) / 480));
    else if (f.done && !f.skipped) doneField(ctx, f, r, now, still);
    else pending(ctx, r, k + 1, f.skipped, S.mode === 'reveal' ? Math.max(0, 1 - (now - f.revealAt) / 600) : 0, !!active, k === nextK);
    ctx.restore();
  });

  if (S.mode === 'reveal') {
    const n = S.fields.filter(f => now >= f.revealAt).length;
    if (n !== S.foundN) { S.foundN = n; S.foundAt = now; }
    if (n > 0) capsule(ctx, `${n} ${n === 1 ? 'place' : 'places'} found`, frame.x + frame.w / 2, frame.y + 16 * u, 'center', still ? 1 : 1.12 - 0.12 * ease((now - S.foundAt) / 300));
  } else S.foundN = 0;

  if (S.mode === 'find' && active) { ctx.save(); highlighter(ctx, R(active), still ? 1 : ease((now - S.sweepAt) / 480)); ctx.restore(); }

  const A = active ? P(anchorOf(active).x, anchorOf(active).y) : null;
  const b = (now - S.burstAt) / 700;
  if (active) {
    const [ax, ay] = A;
    if (seeking) {
      sonar(ctx, S, ax, ay, now, still);
      if (S.tip && now - S.tipSeen < 500) guideLine(ctx, P(S.tip.x, S.tip.y), A, now, still);
    }
    const pop = !still && S.mode === 'write' && b >= 0 && b < 1 ? 0.16 * Math.sin(Math.min(1, b / 0.45) * Math.PI) * (1 - b) : 0;
    callout(ctx, S, labelOf(active), ax, ay, R(active), still, pop);
  }
  // Arrival: two soft rings bloom from the spot the finger reached.
  if (S.burstPt && b >= 0 && b < 1 && !still) {
    const [bx, by] = P(S.burstPt.x, S.burstPt.y);
    ring(ctx, bx, by, (18 + ease(b) * 70) * u, 5 * u * (1 - b), C.tint, 1 - b);
    const b2 = b - 0.14;
    if (b2 > 0) ring(ctx, bx, by, (18 + ease(b2) * 120) * u, 3 * u * (1 - b2), C.white, 0.7 * (1 - b2));
  }

  if (!S.sim && S.handPts?.length && now - (S.handAt || 0) < 300) S.handPts.forEach((h, i) => skeleton(ctx, h, P, i === S.pointerIdx));
  if (S.tip && now - S.tipSeen < 500 && S.mode !== 'done' && S.mode !== 'check') reticle(ctx, S, P, now, still);

  if (S.mode === 'done' && S.fields.length) finishCard(ctx, S, frame, rad, now, still);

  // The viewfinder's hairline edge goes on last so nothing paints over it.
  ctx.beginPath();
  ctx.roundRect(frame.x + 0.5, frame.y + 0.5, frame.w - 1, frame.h - 1, rad);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.stroke();
}

// A ring with a soft dark under-stroke, so it reads on white paper and on a dark desk.
function ring(ctx, x, y, r, w, color, a) {
  if (w <= 0 || a <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2);
  ctx.lineWidth = w + 3 * u;
  ctx.strokeStyle = 'rgba(0,0,0,.28)';
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

// A glass status capsule: dark translucent fill, white text, soft shadow.
function capsule(ctx, text, x, top, align, scale) {
  ctx.save();
  ctx.font = `600 ${15 * u}px ${FONT}`;
  const w = ctx.measureText(text).width + 32 * u, h = 36 * u;
  const left = align === 'center' ? x - w / 2 : x;
  ctx.translate(left + w / 2, top + h / 2);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 18 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = 'rgba(28,28,30,.82)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.stroke();
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

// The live hand: drawn faintly so the room can see it's really following the hand.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
// The hand Nib follows is drawn in the tint; any other hand (the pen hand) stays faint.
function skeleton(ctx, pts, P, pointer) {
  ctx.save();
  ctx.strokeStyle = pointer ? 'rgba(255,214,10,.75)' : 'rgba(255,255,255,.28)';
  ctx.lineWidth = 2 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const [x0, y0] = P(pts[a].x, pts[a].y), [x1, y1] = P(pts[b].x, pts[b].y);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.fillStyle = pointer ? 'rgba(255,214,10,.95)' : 'rgba(255,255,255,.45)';
  for (const p of pts) { const [x, y] = P(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, 2.5 * u, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// Live Text shimmer: a soft diagonal band of light sweeping across the page.
function shimmer(ctx, frame, rad, p) {
  const span = frame.w + frame.h, x = frame.x - frame.h + p * span;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, rad);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  const g = ctx.createLinearGradient(x, frame.y, x + frame.h * 0.9, frame.y + frame.h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,.0)');
  g.addColorStop(0.5, 'rgba(255,255,255,.5)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  ctx.restore();
}

// Dim everything but the field in play; Live Text corner brackets frame it and breathe slowly.
function spotlight(ctx, S, r, frame, rad, still, now) {
  const pad = 14 * u;
  const target = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  if (!S.hole || still) S.hole = { ...target, a: still ? 1 : 0 };
  else for (const k of ['x', 'y', 'w', 'h']) S.hole[k] += (target[k] - S.hole[k]) * 0.2;
  S.hole.a = Math.min(1, S.hole.a + 0.07);
  const h = S.hole;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, rad);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${0.5 * h.a})`;
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.w, frame.h);
  ctx.roundRect(h.x, h.y, h.w, h.h, 12 * u);
  ctx.fill('evenodd');
  ctx.restore();
  // Brackets: four rounded corners, the shape Live Text and the code scanner use.
  const breathe = still ? 0 : Math.sin(now / 500) * 1.5 * u;
  const x0 = h.x - breathe, y0 = h.y - breathe, x1 = h.x + h.w + breathe, y1 = h.y + h.h + breathe;
  const L = Math.min(26 * u, h.w / 3, h.h / 2), c = Math.min(10 * u, L - 2);
  ctx.save();
  ctx.lineWidth = 4 * u;
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,214,10,${h.a})`;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 8 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + L); ctx.arcTo(x0, y0, x0 + L, y0, c); ctx.lineTo(x0 + L, y0);
  ctx.moveTo(x1 - L, y0); ctx.arcTo(x1, y0, x1, y0 + L, c); ctx.lineTo(x1, y0 + L);
  ctx.moveTo(x1, y1 - L); ctx.arcTo(x1, y1, x1 - L, y1, c); ctx.lineTo(x1 - L, y1);
  ctx.moveTo(x0 + L, y1); ctx.arcTo(x0, y1, x0, y1 - L, c); ctx.lineTo(x0, y1 - L);
  ctx.stroke();
  ctx.restore();
}

function highlighter(ctx, r, t) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,214,10,.62)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6 * u, r.y - 4 * u, (r.w + 12 * u) * t, r.h + 8 * u, 7 * u);
  ctx.fill();
}

// Places still to fill: a soft rounded outline (light on the dimmed page, dark on bright paper)
// and a numbered badge. The next one gets a yellow badge.
function pending(ctx, r, n, skipped, flash, dim, next) {
  const box = () => { ctx.beginPath(); ctx.roundRect(r.x - 5 * u, r.y - 4 * u, r.w + 10 * u, r.h + 8 * u, 7 * u); };
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,214,10,${flash * 0.5})`;
    box();
    ctx.fill();
  }
  ctx.lineWidth = (next ? 2 : 1.25) * u;
  ctx.strokeStyle = dim ? `rgba(255,255,255,${skipped ? 0.25 : next ? 0.9 : 0.5})` : skipped ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.38)';
  box();
  ctx.stroke();
  const rad = (next ? 11 : 9.5) * u, x = r.x - 18 * u, y = r.y + r.h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.3)';
  ctx.shadowBlur = 6 * u;
  ctx.fillStyle = next ? C.tint : skipped ? 'rgba(60,60,67,.6)' : 'rgba(28,28,30,.9)';
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = next ? C.ink : C.white;
  ctx.font = `600 ${(next ? 12.5 : 11) * u}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

// Done: a faint green wash and a checkmark.circle.fill badge with a white rim.
function doneField(ctx, f, r, now, still) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(48,209,88,.24)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6 * u, r.y - 4 * u, r.w + 12 * u, r.h + 8 * u, 7 * u);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const age = now - (f.doneAt || 0);
  const t = still ? 1 : back(age / 380);
  const cx = r.x + r.w + 18 * u, cy = r.y + r.h / 2, rad = 11 * u * t;
  if (rad < 0.5) return; // not yet: the finish re-pops checks top to bottom
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = 'rgba(0,0,0,.3)';
  ctx.shadowBlur = 6 * u;
  ctx.fillStyle = C.white;
  ctx.beginPath();
  ctx.arc(0, 0, rad + 2 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.green;
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2.6 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-rad * 0.42, rad * 0.02);
  ctx.lineTo(-rad * 0.1, rad * 0.34);
  ctx.lineTo(rad * 0.45, -rad * 0.32);
  ctx.stroke();
  ctx.restore();
}

// Sonar: faint steady rings at the target, and each beep sends a ring out, so the room sees the sound.
function sonar(ctx, S, ax, ay, now, still) {
  for (let k = 1; k <= 2; k++) ring(ctx, ax, ay, k * 34 * u, 1.5 * u, C.white, 0.42 - k * 0.12);
  if (still) return;
  S.pulses = S.pulses.filter(p => now - p.t < 750);
  for (const p of S.pulses) {
    const q = (now - p.t) / 750;
    ring(ctx, ax, ay, (14 + ease(q) * (p.on ? 60 : 120)) * u, (p.on ? 4 : 2.5) * u, p.on ? C.tint : C.white, (p.on ? 1 : 0.8) * (1 - q));
  }
}

// The Measure-app dotted line from the fingertip to the blank.
function guideLine(ctx, [tx, ty], [ax, ay], now, still) {
  const L = Math.hypot(ax - tx, ay - ty);
  if (L < 50 * u) return;
  const k = 1 - (22 * u) / L, ex = tx + (ax - tx) * k, ey = ty + (ay - ty) * k;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, 10 * u]);
  ctx.lineDashOffset = still ? 0 : -(now / 45) % (10 * u);
  for (const [w, c] of [[7 * u, 'rgba(0,0,0,.3)'], [4 * u, C.white]]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

// The fingertip as a Measure-style reticle: a white ring and dot; on target it turns yellow and the
// ring fills for the dwell (progress, so it stays on even with reduced motion).
function reticle(ctx, S, P, now, still) {
  const [tx, ty] = P(S.tip.x, S.tip.y);
  const seeking = S.mode === 'guide' || S.mode === 'find';
  const on = S.onTarget && seeking;
  ctx.save();
  S.trail.forEach((p, i) => {
    const [px, py] = P(p.x, p.y);
    ctx.globalAlpha = (i / S.trail.length) * 0.35;
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.arc(px, py, (1.5 + (i / S.trail.length) * 2.5) * u, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  const r = (on && !still ? 20 + Math.sin(now / 90) * 1.5 : 20) * u;
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 10 * u;
  ctx.fillStyle = on ? 'rgba(255,214,10,.22)' : 'rgba(255,255,255,.12)';
  ctx.beginPath();
  ctx.arc(tx, ty, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = on ? C.tint : C.white;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (on && S.arrivedSince) {
    const p = Math.min(1, (now - S.arrivedSince) / 450);
    ctx.lineWidth = 5 * u;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.arc(tx, ty, r + 7 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.tint;
    ctx.beginPath();
    ctx.arc(tx, ty, r + 7 * u, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = on ? C.tint : C.white;
  ctx.beginPath();
  ctx.arc(tx, ty, 4 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The callout: a white capsule naming the place, with a pointer to it. It sits above the blank when
// there's room, else below, and stays on the canvas.
function callout(ctx, S, text, ax, ay, r, still, pop = 0) {
  ctx.save();
  ctx.font = `600 ${17 * u}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const h = 40 * u, w = tw + 36 * u, tip = 9 * u, gap = 16 * u;
  const cw = ctx.canvas.clientWidth, ch = ctx.canvas.clientHeight;
  const above = r.y - gap - h - tip > 6;
  const tx = Math.max(6, Math.min(cw - w - 6, ax - 22 * u));
  const target = { x: tx, y: above ? r.y - gap - h - tip : Math.min(ch - h - 6, r.y + r.h + gap + tip), above };
  if (!S.flag || still || S.flag.above !== target.above) S.flag = { ...target };
  else { S.flag.x += (target.x - S.flag.x) * 0.22; S.flag.y += (target.y - S.flag.y) * 0.22; }
  const { x, y, above: up } = S.flag;
  const px = Math.max(x + h / 2, Math.min(x + w - h / 2, ax)); // the pointer still aims at the blank after clamping
  if (pop) {
    const oy = up ? y + h + tip : y - tip;
    ctx.translate(px, oy);
    ctx.scale(1 + pop, 1 + pop);
    ctx.translate(-px, -oy);
  }
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 20 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = C.white;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.moveTo(px - tip, up ? y + h - 1 : y + 1);
  ctx.lineTo(px, up ? y + h + tip : y - tip);
  ctx.lineTo(px + tip, up ? y + h - 1 : y + 1);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 18 * u, y + h / 2 + 1);
  ctx.restore();
}

// The finish, Apple Pay style: a glass card where the circle draws, then the check. It says
// Report the kept answers; completing the UI does not establish independent use.
function finishCard(ctx, S, frame, rad, now, still) {
  const age = still ? 5000 : now - S.finishedAt;
  const filled = S.fields.filter(f => f.done && !f.skipped).length;
  const open = S.fields.filter(f => f.skipped || f.review || f.stale || !f.done).length;
  const clean = !open && !S.reviewFailed;
  const col = clean ? C.green : C.orange;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, rad);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${0.5 * ease(age / 350)})`;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  ctx.restore();
  const w = Math.min(frame.w * 0.78, 420 * u), h = w * 0.78, cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const s = 0.9 + 0.1 * back(age / 450);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.globalAlpha = Math.min(1, age / 200);
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 50 * u;
  ctx.shadowOffsetY = 20 * u;
  ctx.fillStyle = 'rgba(28,28,30,.9)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 30 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.stroke();
  // circle draws, then the mark
  const R = h * 0.2, oy = -h * 0.14, k1 = ease((age - 150) / 450), k2 = ease((age - 550) / 300);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = R * 0.14;
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(0, oy, R, -Math.PI / 2, -Math.PI / 2 + k1 * Math.PI * 2);
  ctx.stroke();
  if (k1 >= 1) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(0, oy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = R * 0.17;
  ctx.beginPath();
  if (clean) {
    const pts = [[-R * 0.42, oy + R * 0.02], [-R * 0.1, oy + R * 0.34], [R * 0.46, oy - R * 0.3]];
    const seg = k2 * 2;
    ctx.moveTo(...pts[0]);
    if (seg > 0) ctx.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * Math.min(1, seg), pts[0][1] + (pts[1][1] - pts[0][1]) * Math.min(1, seg));
    if (seg > 1) ctx.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * (seg - 1), pts[1][1] + (pts[2][1] - pts[1][1]) * (seg - 1));
  } else if (k2 > 0) {
    ctx.moveTo(0, oy - R * 0.45);
    ctx.lineTo(0, oy - R * 0.45 + R * 0.6 * k2);
    ctx.moveTo(0, oy + R * 0.42);
    ctx.lineTo(0, oy + R * 0.43);
  }
  ctx.stroke();
  // words
  const t = ease((age - 450) / 400);
  ctx.globalAlpha = t;
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const title = clean ? 'Answers kept' : 'Review needed';
  ctx.font = `700 ${h * 0.11}px ${FONT}`;
  const fitK = Math.min(1, (w * 0.86) / ctx.measureText(title).width); // never wider than the card
  ctx.font = `700 ${h * 0.11 * fitK}px ${FONT}`;
  ctx.fillText(title, 0, h * 0.2 + (1 - t) * 8 * u);
  ctx.font = `500 ${h * 0.075}px ${FONT}`;
  ctx.fillStyle = 'rgba(235,235,245,.64)';
  const sub = clean ? `${filled} of ${S.fields.length} kept · ${S.elapsed || ''}` : S.reviewFailed && !open ? 'Final page check unavailable' : `${open} ${open === 1 ? 'place needs' : 'places need'} another look`;
  ctx.fillText(sub, 0, h * 0.34 + (1 - t) * 8 * u);
  ctx.restore();
}
