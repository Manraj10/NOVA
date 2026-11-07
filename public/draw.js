// Everything drawn over the camera view: the scan, the spotlight, sonar rings, the sign-here flag,
// field outlines, the fingertip, and the finishing stamp.

const C = {
  carbon: '#1A1F4E',
  flag: '#FFE14D',
  paper: '#F7F6F2',
  stamp: '#2FBF71',
  stampInk: '#17784A',
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ease = t => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const back = t => { t = Math.min(1, Math.max(0, t)); const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

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
  ctx.clearRect(0, 0, cw, ch);
  if (!src.w || !src.h) return;
  const fit = fitOf(cw, ch, src.w, src.h);
  S.fit = fit;
  const P = (x, y) => [fit.ox + x * src.w * fit.s, fit.oy + y * src.h * fit.s];
  const R = f => { const [x, y] = P(f.x0, f.y0), [x1, y1] = P(f.x1, f.y1); return { x, y, w: x1 - x, h: y1 - y }; };
  const still = reduceMotion.matches;
  const frame = { x: fit.ox, y: fit.oy, w: src.w * fit.s, h: src.h * fit.s };

  try { ctx.drawImage(src.img, frame.x, frame.y, frame.w, frame.h); } catch { /* video not ready */ }

  const seeking = S.mode === 'guide' || S.mode === 'find';
  const active = S.mode === 'find' ? S.find : ['guide', 'write', 'check'].includes(S.mode) ? S.fields[S.i] : null;
  if (active) spotlight(ctx, S, R(active), frame, still);
  else S.hole = null;

  // The scan: loops while the AI reads, then one clean pass that "finds" each field.
  if (S.mode === 'reading') scan(ctx, frame, still ? 0.5 : (now % 1700) / 1700);
  if (S.mode === 'reveal' && !still) {
    const p = (now - S.revealStart) / 1300;
    if (p <= 1) scan(ctx, frame, p);
  }

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
    else pending(ctx, r, k + 1, f.skipped, S.mode === 'reveal' ? Math.max(0, 1 - (now - f.revealAt) / 500) : 0);
    ctx.restore();
  });

  if (S.mode === 'find' && active) highlighter(ctx, R(active), still ? 1 : ease((now - S.sweepAt) / 480));

  if (active) {
    const a = anchorOf(active);
    const [ax, ay] = P(a.x, a.y);
    const tipFresh = S.tip && now - S.tipSeen < 500;
    if (seeking) {
      sonar(ctx, S, ax, ay, now, still);
      if (tipFresh) guideLine(ctx, P(S.tip.x, S.tip.y), [ax, ay], now, still);
    }
    flag(ctx, S, flagText(active), ax, ay, still);
    const b = (now - S.burstAt) / 650;
    if (b >= 0 && b < 1 && !still) {
      ctx.save();
      ctx.strokeStyle = `rgba(26,31,78,${1 - b})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ax, ay, 18 + ease(b) * 56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (!S.sim && S.handPts?.length && now - (S.handAt || 0) < 300) S.handPts.forEach(h => skeleton(ctx, h, P));
  if (S.tip && now - S.tipSeen < 500 && S.mode !== 'done' && S.mode !== 'check') fingertip(ctx, S, P, now, still);

  if (S.mode === 'done' && S.fields.length) finishStamp(ctx, S, R, now, still);
}

// The live hand: 21 tracked points, drawn faintly so the room can see it's really following the hand.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
function skeleton(ctx, pts, P) {
  ctx.save();
  ctx.strokeStyle = 'rgba(247,246,242,.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const [x0, y0] = P(pts[a].x, pts[a].y), [x1, y1] = P(pts[b].x, pts[b].y);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(247,246,242,.7)';
  for (const p of pts) { const [x, y] = P(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function scan(ctx, frame, p) {
  const y = frame.y + p * frame.h;
  const g = ctx.createLinearGradient(0, y - 90, 0, y);
  g.addColorStop(0, 'rgba(255,225,77,0)');
  g.addColorStop(1, 'rgba(255,225,77,.5)');
  ctx.fillStyle = g;
  ctx.fillRect(frame.x, y - 90, frame.w, 90);
  ctx.fillStyle = C.flag;
  ctx.fillRect(frame.x, y - 2, frame.w, 3);
}

// Dim everything except the field in play. The hole glides from field to field.
function spotlight(ctx, S, r, frame, still) {
  const pad = 20;
  const target = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  if (!S.hole || still) S.hole = { ...target, a: still ? 1 : 0 };
  else for (const k of ['x', 'y', 'w', 'h']) S.hole[k] += (target[k] - S.hole[k]) * 0.16;
  S.hole.a = Math.min(1, S.hole.a + 0.06);
  const h = S.hole;
  ctx.save();
  ctx.fillStyle = `rgba(8,10,30,${0.5 * h.a})`;
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.w, frame.h);
  ctx.roundRect(h.x, h.y, h.w, h.h, 16);
  ctx.fill('evenodd');
  ctx.strokeStyle = `rgba(255,225,77,${0.9 * h.a})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(h.x, h.y, h.w, h.h, 16);
  ctx.stroke();
  ctx.restore();
}

function highlighter(ctx, r, t) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,225,77,.92)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6, r.y - 4, (r.w + 12) * t, r.h + 8, 5);
  ctx.fill();
}

function pending(ctx, r, n, skipped, flash) {
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,225,77,${flash * 0.7})`;
    ctx.beginPath();
    ctx.roundRect(r.x - 4, r.y - 3, r.w + 8, r.h + 6, 5);
    ctx.fill();
  }
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = skipped ? 'rgba(26,31,78,.25)' : 'rgba(26,31,78,.62)';
  ctx.beginPath();
  ctx.roundRect(r.x - 4, r.y - 3, r.w + 8, r.h + 6, 5);
  ctx.stroke();
  ctx.setLineDash([]);
  const x = r.x - 17, y = r.y + r.h / 2;
  ctx.fillStyle = skipped ? 'rgba(26,31,78,.3)' : C.carbon;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.paper;
  ctx.font = '700 11px "Atkinson Hyperlegible Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

function doneField(ctx, f, r, now, still) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(47,191,113,.22)';
  ctx.beginPath();
  ctx.roundRect(r.x - 6, r.y - 4, r.w + 12, r.h + 8, 5);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const age = now - (f.doneAt || 0);
  const t = still ? 1 : back(age / 360);
  const cx = r.x + r.w + 18, cy = r.y + r.h / 2, rad = 12 * t;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.fillStyle = C.stamp;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(rad, 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
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
  ctx.save();
  for (let k = 1; k <= 3; k++) {
    ctx.strokeStyle = `rgba(26,31,78,${0.26 - k * 0.06})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, ay, k * 30, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (!still) {
    S.pulses = S.pulses.filter(p => now - p.t < 750);
    for (const p of S.pulses) {
      const q = (now - p.t) / 750;
      ctx.strokeStyle = p.on ? `rgba(255,225,77,${1 - q})` : `rgba(26,31,78,${0.75 * (1 - q)})`;
      ctx.lineWidth = p.on ? 5 : 3;
      ctx.beginPath();
      ctx.arc(ax, ay, 14 + ease(q) * (p.on ? 60 : 130), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function guideLine(ctx, [tx, ty], [ax, ay], now, still) {
  ctx.save();
  ctx.strokeStyle = '#FF4FA3';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, 11]);
  ctx.lineDashOffset = still ? 0 : -(now / 40) % 11;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  ctx.restore();
}

// The fingertip: pink when far, warming to flag yellow as it closes in.
function fingertip(ctx, S, P, now, still) {
  const [tx, ty] = P(S.tip.x, S.tip.y);
  const c = S.mode === 'guide' || S.mode === 'find' ? 1 - Math.min(1, S.prox ?? 1) : 0;
  const col = `rgb(255,${Math.round(79 + 146 * c)},${Math.round(163 - 86 * c)})`;
  ctx.save();
  S.trail.forEach((p, i) => {
    const [px, py] = P(p.x, p.y);
    ctx.globalAlpha = (i / S.trail.length) * 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, 3 + (i / S.trail.length) * 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  const on = S.onTarget && (S.mode === 'guide' || S.mode === 'find');
  ctx.shadowColor = 'rgba(16,19,47,.5)';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 4;
  ctx.strokeStyle = on ? C.carbon : col;
  ctx.fillStyle = on ? 'rgba(255,225,77,.6)' : 'rgba(255,255,255,.18)';
  ctx.beginPath();
  ctx.arc(tx, ty, on && !still ? 19 + Math.sin(now / 80) * 2.5 : 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(tx, ty, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The signature element: a sign-here tab that glides to the next place to write.
function flag(ctx, S, text, ax, ay, still) {
  ctx.save();
  ctx.font = '800 16px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
  const tw = ctx.measureText(text).width;
  const h = 36, tip = 16, bodyW = tw + 28;
  const roomLeft = ax - (bodyW + tip + 8) > 4;
  const target = roomLeft ? { x: ax - tip - 8 - bodyW, y: ay - h / 2, dir: 'right' } : { x: ax - bodyW / 2, y: ay + 24 + tip, dir: 'up' };
  if (!S.flag || still || S.flag.dir !== target.dir) S.flag = { ...target };
  else { S.flag.x += (target.x - S.flag.x) * 0.2; S.flag.y += (target.y - S.flag.y) * 0.2; }
  const { x, y, dir } = S.flag;
  ctx.shadowColor = 'rgba(8,10,30,.45)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = C.flag;
  ctx.beginPath();
  if (dir === 'right') {
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + bodyW, y);
    ctx.lineTo(x + bodyW + tip, y + h / 2);
    ctx.lineTo(x + bodyW, y + h);
    ctx.lineTo(x + 6, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - 6);
    ctx.lineTo(x, y + 6);
    ctx.quadraticCurveTo(x, y, x + 6, y);
  } else {
    ctx.moveTo(x, y + 6);
    ctx.quadraticCurveTo(x, y, x + 6, y);
    ctx.lineTo(x + bodyW / 2 - tip * 0.7, y);
    ctx.lineTo(x + bodyW / 2, y - tip);
    ctx.lineTo(x + bodyW / 2 + tip * 0.7, y);
    ctx.lineTo(x + bodyW - 6, y);
    ctx.quadraticCurveTo(x + bodyW, y, x + bodyW, y + 6);
    ctx.lineTo(x + bodyW, y + h - 6);
    ctx.quadraticCurveTo(x + bodyW, y + h, x + bodyW - 6, y + h);
    ctx.lineTo(x + 6, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - 6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.carbon;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 14, y + h / 2 + 1);
  ctx.restore();
}

// The finish: a rubber stamp slams onto the page.
function finishStamp(ctx, S, R, now, still) {
  const rs = S.fields.map(R);
  const x0 = Math.min(...rs.map(r => r.x)), x1 = Math.max(...rs.map(r => r.x + r.w));
  const y0 = Math.min(...rs.map(r => r.y)), y1 = Math.max(...rs.map(r => r.y + r.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const age = now - S.finishedAt;
  const t = still ? 1 : ease(age / 340);
  const scale = 2.4 - 1.4 * t;
  const filled = S.fields.filter(f => f.done && !f.skipped).length;
  const w = Math.min(420, (x1 - x0) * 0.95), h = w * 0.36;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.13);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(1, age / 140) * 0.9;
  ctx.strokeStyle = C.stampInk;
  ctx.fillStyle = 'rgba(247,246,242,.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 9);
  ctx.stroke();
  ctx.fillStyle = C.stampInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.38)}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.08em';
  ctx.fillText('COMPLETED', 0, -h * 0.08);
  ctx.font = `700 ${Math.round(h * 0.13)}px "Atkinson Hyperlegible Mono", ui-monospace, monospace`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.14em';
  ctx.fillText(`INDEPENDENTLY · ${filled}/${S.fields.length} · ${S.elapsed || ''}`.toUpperCase(), 0, h * 0.27);
  ctx.restore();
}
