// A movement guard with conservative local relocation. An alarm pauses guidance;
// only a fresh, well-supported fit may move known boxes without another model read.
// A portrait page often fills under half a landscape webcam image. At 192 wide,
// its small print collapses into a handful of pixels; 320 preserves useful detail
// while retaining the same bounded patch count and search work.
const SIZE = 320, R = 5, SEARCH = 8, CELL = 20, LIMIT = 48;
const MIN_ANCHORS = 8, MATCH = 0.82, STILL = 0.88, SHIFT = 2;
const FULL_FRAME = { x0: 0, y0: 0, x1: 1, y1: 1 };

function normalizedRect(region) {
  if (!region || !['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(region[key]))) return null;
  const { x0, y0, x1, y1 } = region;
  return x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1
    ? { x0, y0, x1, y1 } : null;
}

function dimensions(src) {
  return src && src.img && Number.isFinite(src.w) && Number.isFinite(src.h)
    && src.w >= 32 && src.h >= 32 ? { w: src.w, h: src.h } : null;
}

function browserReader() {
  let canvas, context;
  return (src, w, h) => {
    if (!canvas) {
      canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) throw Error('No image reader');
    canvas.width = w; canvas.height = h;
    context.drawImage(src.img, 0, 0, w, h);
    return context.getImageData(0, 0, w, h);
  };
}

function grayFrame(frame, w, h) {
  if (!frame || frame.width !== w || frame.height !== h || frame.data?.length !== w * h * 4)
    throw Error('Unreadable frame');
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const r = frame.data[p], g = frame.data[p + 1], b = frame.data[p + 2];
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) throw Error('Invalid pixels');
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

function integral(gray, w, h) {
  const stride = w + 1, sum = new Float64Array(stride * (h + 1)), sq = new Float64Array(sum.length);
  for (let y = 0; y < h; y++) {
    let row = 0, rowSq = 0;
    for (let x = 0; x < w; x++) {
      const value = gray[y * w + x], p = (y + 1) * stride + x + 1;
      row += value; rowSq += value * value;
      sum[p] = sum[p - stride] + row; sq[p] = sq[p - stride] + rowSq;
    }
  }
  const area = (a, x, y) => {
    const x0 = x - R, y0 = y - R, x1 = x + R + 1, y1 = y + R + 1;
    return a[y1 * stride + x1] - a[y0 * stride + x1] - a[y1 * stride + x0] + a[y0 * stride + x0];
  };
  return { sum, sq, area };
}

function template(gray, w, x, y) {
  const values = [], n = (2 * R + 1) ** 2;
  let sum = 0, sq = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const value = gray[(y + dy) * w + x + dx];
    values.push(value); sum += value; sq += value * value;
  }
  const norm = Math.sqrt(Math.max(0, sq - sum * sum / n));
  if (norm / Math.sqrt(n) < 8) return null;
  return Float32Array.from(values, v => (v - sum / n) / norm);
}

function anchors(gray, w, h, region) {
  const gx = new Float32Array(gray.length), gy = new Float32Array(gray.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    gx[p] = gray[p + 1] - gray[p - 1]; gy[p] = gray[p + w] - gray[p - w];
  }
  const found = [], border = R + SEARCH + 2;
  // The complete patch/search support stays inside the caller's document ROI.
  // Desk texture outside that region must not become registration evidence.
  const x0 = Math.ceil(region.x0 * w) + border, y0 = Math.ceil(region.y0 * h) + border;
  const x1 = Math.floor(region.x1 * w) - border, y1 = Math.floor(region.y1 * h) - border;
  // One strong corner per cell spreads evidence across the printed page. A long
  // straight line alone is ambiguous and does not qualify as a corner.
  for (let top = y0; top < y1; top += CELL) {
    for (let left = x0; left < x1; left += CELL) {
      let best = null;
      for (let y = top; y < Math.min(top + CELL, y1); y += 2) {
        for (let x = left; x < Math.min(left + CELL, x1); x += 2) {
          let xx = 0, yy = 0, xy = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const p = (y + dy) * w + x + dx;
            xx += gx[p] ** 2; yy += gy[p] ** 2; xy += gx[p] * gy[p];
          }
          const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 50;
          if (score > 120 && (!best || score > best.score)) best = { x, y, score };
        }
      }
      if (best) {
        const patch = template(gray, w, best.x, best.y);
        if (patch) found.push({ ...best, patch });
      }
    }
  }
  // Keep spatial order when capping rather than taking only the title's text.
  if (found.length <= LIMIT) return found;
  return Array.from({ length: LIMIT }, (_, i) => found[Math.floor(i * found.length / LIMIT)]);
}

function spread(points, w, h) {
  if (points.length < MIN_ANCHORS) return false;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return Math.max(...xs) - Math.min(...xs) >= w * 0.3
    && Math.max(...ys) - Math.min(...ys) >= h * 0.3;
}

function unmasked(points, regions, w, h) {
  // Verify only current patches that clear the actual hand bounds plus 3px.
  // Motion-search candidates are separately masked at their candidate positions.
  const support = R + 3;
  return points.filter(p => !regions.some(r => p.x + support >= r.x0 * w
    && p.x - support <= r.x1 * w && p.y + support >= r.y0 * h && p.y - support <= r.y1 * h));
}

function correlation(anchor, gray, table, w, x, y) {
  const n = anchor.patch.length, sum = table.area(table.sum, x, y);
  const norm = Math.sqrt(Math.max(0, table.area(table.sq, x, y) - sum * sum / n));
  if (norm / Math.sqrt(n) < 5) return -1;
  let dot = 0, i = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
    dot += anchor.patch[i++] * gray[(y + dy) * w + x + dx];
  return Math.max(-1, Math.min(1, dot / norm));
}

function matches(points, gray, table, w, h, regions) {
  const out = [];
  for (const point of points) {
    const candidates = [];
    for (let dy = -SEARCH; dy <= SEARCH; dy++) for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      const x = point.x + dx, y = point.y + dy;
      if (x < R || y < R || x >= w - R || y >= h - R) continue;
      if (regions.some(r => x + R + 3 >= r.x0 * w && x - R - 3 <= r.x1 * w
        && y + R + 3 >= r.y0 * h && y - R - 3 <= r.y1 * h)) continue;
      candidates.push({ dx, dy, score: correlation(point, gray, table, w, x, y) });
    }
    candidates.sort((a, b) => b.score - a.score || a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2);
    const best = candidates[0];
    if (!best || best.score < MATCH) continue;
    const other = candidates.find(c => Math.hypot(c.dx - best.dx, c.dy - best.dy) > 2);
    if (other && best.score - other.score < 0.025) continue;
    out.push({ x: point.x, y: point.y, u: point.x + best.dx, v: point.y + best.dy });
  }
  return out;
}

function fit(points) {
  const n = points.length;
  if (n < 2) return null;
  const mean = key => points.reduce((s, p) => s + p[key], 0) / n;
  const x = mean('x'), y = mean('y'), u = mean('u'), v = mean('v');
  let den = 0, real = 0, imaginary = 0;
  for (const p of points) {
    const dx = p.x - x, dy = p.y - y, du = p.u - u, dv = p.v - v;
    den += dx * dx + dy * dy; real += dx * du + dy * dv; imaginary += dx * dv - dy * du;
  }
  if (den < 100) return null;
  const a = real / den, b = imaginary / den;
  return { a, b, tx: u - a * x + b * y, ty: v - b * x - a * y };
}

function registered(points, allCount, spreadW, spreadH) {
  let best = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 24) continue;
    const model = fit([points[i], points[j]]);
    if (!model) continue;
    const inliers = points.filter(p => Math.hypot(model.a * p.x - model.b * p.y + model.tx - p.u,
      model.b * p.x + model.a * p.y + model.ty - p.v) <= 1.5);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < Math.max(MIN_ANCHORS, allCount * 0.5) || !spread(best, spreadW, spreadH)) return null;
  const model = fit(best);
  const errors = best.map(p => Math.hypot(model.a * p.x - model.b * p.y + model.tx - p.u,
    model.b * p.x + model.a * p.y + model.ty - p.v));
  return { ...model, inliers: best.length, total: allCount,
    fraction: best.length / allCount, rms: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length),
    maxError: Math.max(...errors) };
}

/**
 * capture({img,w,h}, documentRegion?) from the FROZEN image sent for parsing,
 * before/at that request, never a fresh live frame after its response. The image
 * must show a clear, stationary page. Region is normalized {x0,y0,x1,y1} and must
 * contain distributed printed detail. It is not merely the union of blank boxes.
 * With no region the ENTIRE FRAME is used: stationary textured desks/backgrounds
 * may dominate that evidence. Supply document bounds or frame the paper tightly.
 * moved(src, handVisibleOrRegions) accepts the old Boolean or an array of current
 * normalized hand bounds. Bounds must cover all hands; extra padding is added here.
 * Arrays allow checking the exposed page during finger guidance.
 * TRUE is latched until successful recapture and means invalidate the old boxes.
 * FALSE DOES NOT MEAN VERIFIED. The caller MUST pause guidance unless status is
 * 'ready' (or verified is true). 'occluded' is recoverable: lift hands, then check
 * the SAME reference immediately; do not pay for another parse solely for a hand.
 * A first mismatch is 'suspect' and also pauses; the second clear mismatch latches.
 * Boolean true cannot localize a hand: it skips the frame and reports 'occluded'.
 * Optional synchronous readFrame(src,w,h) returns RGBA ImageData of that size.
 * now() is an injectable monotonic millisecond clock; neither option is needed in Chrome.
 */
export function makeDrift({ readFrame = browserReader(), now = () => performance.now(), intervalMs = 350 } = {}) {
  let reference = null, latched = true, state = 'uncaptured', reason = 'No reference frame';
  let lastCheck = -Infinity, suspect = 0, lastModel = null;
  const latch = (nextState, why) => { latched = true; state = nextState; reason = why; if (nextState !== 'moved') lastModel = null; return true; };
  const occluded = why => {
    state = 'occluded'; reason = why; suspect = 0; lastCheck = -Infinity; return false;
  };
  const read = src => {
    const dims = dimensions(src);
    if (!dims) throw Error('Missing source or dimensions');
    const scale = Math.min(1, SIZE / Math.max(dims.w, dims.h));
    const w = Math.round(dims.w * scale), h = Math.round(dims.h * scale);
    if (Math.min(w, h) < 32) throw Error('Source is too narrow');
    return { ...dims, width: w, height: h, gray: grayFrame(readFrame(src, w, h), w, h) };
  };
  // Return source-pixel affine coefficients, not analysis pixels or frame fractions.
  // Rounded analysis dimensions can have slightly different x/y scale factors.
  const trustworthy = model => {
    if (!model || model.fraction < 0.75 || model.rms > 0.65 || model.maxError > 1.25
      || Math.abs(Math.hypot(model.a, model.b) - 1) > 0.06
      || Math.abs(Math.atan2(model.b, model.a)) > 1.5 * Math.PI / 180) return null;
    const sx = reference.w / reference.width, sy = reference.h / reference.height;
    return Object.freeze({ xx: model.a, xy: -model.b * sx / sy,
      yx: model.b * sy / sx, yy: model.a, tx: model.tx * sx, ty: model.ty * sy,
      w: reference.w, h: reference.h, analysisScale: Math.max(sx, sy),
      inliers: model.inliers, fraction: model.fraction, rms: model.rms });
  };
  const relocation = (src, handRegions = []) => {
    if (!reference) return null;
    const dims = dimensions(src);
    if (!dims || dims.w !== reference.w || dims.h !== reference.h || !Array.isArray(handRegions)) return null;
    const regions = handRegions.map(normalizedRect);
    if (regions.some(r => !r)) return null;
    const { width: w, height: h, spreadW, spreadH } = reference;
    const points = unmasked(reference.points, regions, w, h);
    if (points.length < reference.points.length * 0.35 || !spread(points, spreadW, spreadH)) return null;
    try {
      const frame = read(src), table = integral(frame.gray, w, h);
      return trustworthy(registered(matches(points, frame.gray, table, w, h, regions), points.length, spreadW, spreadH));
    } catch { return null; }
  };
  return {
    // Refit the supplied frozen frame even after an alarm. The caller must compare
    // two fresh fits, map that exact final frame, and recapture before resuming.
    relocation,
    get lastModel() { return lastModel; },
    capture(src, documentRegion = FULL_FRAME, handRegions = []) {
      reference = null; suspect = 0; lastModel = null; lastCheck = -Infinity;
      try {
        const region = normalizedRect(documentRegion);
        if (!region) { latch('unavailable', 'Invalid document region'); return false; }
        const masks = Array.isArray(handRegions) ? handRegions.map(normalizedRect) : [null];
        if (masks.some(r => !r)) { latch('unavailable', 'Invalid capture hand bounds'); return false; }
        const frame = read(src), points = unmasked(anchors(frame.gray, frame.width, frame.height, region), masks, frame.width, frame.height);
        const spreadW = (region.x1 - region.x0) * frame.width, spreadH = (region.y1 - region.y0) * frame.height;
        if (!spread(points, spreadW, spreadH)) {
          latch('low-texture', 'Not enough distributed printed detail to check movement'); return false;
        }
        reference = { ...frame, points, region, spreadW, spreadH }; latched = false; state = 'ready'; reason = '';
        return true;
      } catch {
        latch('unavailable', 'Could not capture a readable camera frame'); return false;
      }
    },
    moved(src, handVisibleOrRegions = false) {
      if (latched) return true;
      const dims = dimensions(src);
      if (!dims) return latch('unavailable', 'Camera source or dimensions are missing');
      if (dims.w !== reference.w || dims.h !== reference.h)
        return latch('unavailable', 'Camera dimensions changed; re-read the form');
      if (handVisibleOrRegions === true) return occluded('Hand location unknown; lift hands to verify the page');
      let regions = [];
      if (Array.isArray(handVisibleOrRegions)) {
        regions = handVisibleOrRegions.map(normalizedRect);
        if (regions.some(r => !r)) return occluded('Hand bounds are invalid; clear the page to verify it');
      } else if (handVisibleOrRegions !== false) return occluded('Hand bounds are unavailable; clear the page to verify it');
      const { width: w, height: h, spreadW, spreadH } = reference;
      const points = unmasked(reference.points, regions, w, h);
      if (points.length < reference.points.length * 0.35 || !spread(points, spreadW, spreadH))
        return occluded('Not enough clear printed detail; lift hands to verify the page');
      const time = now();
      if (time - lastCheck < intervalMs) return false;
      lastCheck = time;
      let frame;
      try { frame = read(src); }
      catch { return latch('unavailable', 'Camera frame could not be read'); }
      const table = integral(frame.gray, w, h);
      const still = points.filter(p => correlation(p, frame.gray, table, w, p.x, p.y) >= STILL).length;
      let why = '';
      lastModel = null;
      if (still / points.length < 0.75) {
        const model = registered(matches(points, frame.gray, table, w, h, regions), points.length, spreadW, spreadH);
        if (model) {
          const scale = Math.hypot(model.a, model.b), angle = Math.abs(Math.atan2(model.b, model.a));
          const displacement = Math.hypot(model.a * w / 2 - model.b * h / 2 + model.tx - w / 2,
            model.b * w / 2 + model.a * h / 2 + model.ty - h / 2);
          if (displacement >= SHIFT || angle >= 2.5 * Math.PI / 180 || Math.abs(scale - 1) >= 0.035)
            { why = 'Printed page geometry changed'; lastModel = trustworthy(model); }
        } else why = 'Printed page position cannot be verified';
      }
      if (why) {
        state = 'suspect'; reason = why;
        if (++suspect >= 2) return latch('moved', why);
      } else { suspect = 0; state = 'ready'; reason = ''; }
      return false;
    },
    get status() { return state; },
    get reason() { return reason; },
    get verified() { return state === 'ready' && !latched; },
  };
}
