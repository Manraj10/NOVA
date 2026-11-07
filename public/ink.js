// New visible ink evidence, NOT a writing-finished or intent detector.
// Geometry belongs to the page movement guard; this only compares one armed ROI.
const MAX_PIXELS = 192 * 96, MIN_SIDE = 32, MAX_SIDE = MAX_PIXELS / MIN_SIDE, MARGIN = 5;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function regionOf(r) {
  if (!r || !['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(r[k]))) return null;
  const { x0, y0, x1, y1 } = r;
  return x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x1 > x0 && y1 > y0
    ? { x0, y0, x1, y1 } : null;
}

function browserReader() {
  let canvas, context;
  return (src, r, w, h) => {
    if (!canvas) {
      canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) throw Error('No image reader');
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.drawImage(src.img, r.x0 * src.w, r.y0 * src.h, (r.x1 - r.x0) * src.w,
      (r.y1 - r.y0) * src.h, 0, 0, w, h);
    return context.getImageData(0, 0, w, h);
  };
}

function grayOf(frame, w, h) {
  if (frame?.width !== w || frame?.height !== h || frame?.data?.length !== w * h * 4) throw Error('Unreadable frame');
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const p = 4 * i, values = [frame.data[p], frame.data[p + 1], frame.data[p + 2], frame.data[p + 3]];
    if (!values.every(v => Number.isFinite(v) && v >= 0 && v <= 255) || values[3] < 240) throw Error('Invalid pixels');
    gray[i] = 0.299 * values[0] + 0.587 * values[1] + 0.114 * values[2];
  }
  return gray;
}

// A thin dark stroke has brighter pixels on BOTH sides in at least one direction.
// A lighting ramp or a single shadow edge has no such opposing bright sides.
function ridges(gray, w, h) {
  const out = new Float32Array(gray.length);
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    const p = y * w + x;
    let best = 0;
    for (const [dx, dy] of DIRS) {
      const step = dy * w + dx;
      const left = (gray[p - 3 * step] + gray[p - 4 * step]) / 2;
      const right = (gray[p + 3 * step] + gray[p + 4 * step]) / 2;
      const surround = Math.min(left, right);
      best = Math.max(best, (surround - gray[p]) / Math.max(50, surround));
    }
    out[p] = Math.max(0, best);
  }
  return out;
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function referenceDetails(gray, ridge, w, h) {
  const printed = new Uint8Array(gray.length), anchors = [];
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    const p = y * w + x;
    if (ridge[p] < 0.12) continue;
    if (anchors.length < 256 && (x + y) % 2 === 0) anchors.push(p);
    // Do not rediscover printed lines because exposure or sampling changed slightly.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) printed[p + dy * w + dx] = 1;
  }
  return { printed, anchors };
}

function referenceMoved(ref, current) {
  if (ref.anchors.length < 8) return false; // A blank crop is not a page tracker.
  const similarity = (dx, dy) => {
    let sum = 0;
    for (const p of ref.anchors) {
      const x = p % ref.width, y = Math.floor(p / ref.width);
      if (x + dx < MARGIN || y + dy < MARGIN || x + dx >= ref.width - MARGIN || y + dy >= ref.height - MARGIN) continue;
      sum += Math.min(ref.ridge[p], current[p + dy * ref.width + dx]);
    }
    return sum / ref.anchors.length;
  };
  const still = similarity(0, 0);
  let best = still;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) best = Math.max(best, similarity(dx, dy));
  const original = ref.anchors.reduce((sum, p) => sum + ref.ridge[p], 0) / ref.anchors.length;
  return best > still + 0.13 && best > still * 1.35 || still < original * 0.45;
}

function changedStroke(ref, gray, ridge) {
  const { width: w, height: h } = ref, offsets = [];
  for (let p = 0; p < gray.length; p += 3) offsets.push(gray[p] - ref.gray[p]);
  const exposure = median(offsets), dark = new Uint8Array(gray.length);
  let darkCount = 0;
  for (let p = 0; p < gray.length; p++) if (ref.gray[p] + exposure - gray[p] > 28 && !ref.printed[p]) { dark[p] = 1; darkCount++; }
  if (darkCount / gray.length > 0.3) return { uncertain: true, reason: 'lighting-or-obstruction' };
  const stride = w + 1, sums = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += dark[y * w + x]; sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row; }
  }
  // A shadow can have thin high-contrast boundary arcs. Reject a frame containing
  // a broad newly dark interior too, rather than mistaking those arcs for pen ink.
  // Dense/broad real marks may also take this conservative manual-only path.
  for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) {
    if (!dark[y * w + x]) continue;
    const x0 = x - 4, y0 = y - 4, x1 = x + 5, y1 = y + 5;
    const density = (sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]) / 81;
    if (density > 0.72) return { uncertain: true, reason: 'lighting-or-obstruction' };
  }
  const mask = new Uint8Array(gray.length);
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    const p = y * w + x;
    if (!dark[p] || ref.printed[p] || ridge[p] < 0.18 || ridge[p] - ref.ridge[p] < 0.12) continue;
    // A short-axis enlargement can make a 3-camera-pixel pen stroke 4-5
    // analysis pixels thick. A 15px neighborhood retains that narrow stroke
    // while rejecting broad dark areas; clamp the neighborhood at crop edges.
    const x0 = Math.max(0, x - 7), y0 = Math.max(0, y - 7), x1 = Math.min(w, x + 8), y1 = Math.min(h, y + 8);
    const density = (sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
    if (density < 0.38) mask[p] = 1;
  }
  // Isolated dark noise is not a stroke; require connected spatial support.
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let best = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0, tail = 1, x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = p + dy * w + dx;
        if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h || !mask[n] || visited[n]) continue;
        visited[n] = 1; queue[tail++] = n;
      }
    }
    if (tail >= 8 && Math.max(x1 - x0, y1 - y0) >= 5 && tail > best.length) best = Array.from(queue.subarray(0, tail));
  }
  const evidence = new Uint8Array(mask.length);
  for (const p of best) evidence[p] = 1;
  return { mask: evidence, count: best.length, score: Math.min(1, best.length / 32) };
}

/**
 * arm(src, region) captures a clear crop BEFORE writing; returns false on failure.
 * changed() reports NEW VISIBLE INK, never "the person is finished". A caller must
 * still obtain explicit completion/readback confirmation. A pause is not consent.
 *
 * handVisible MUST mean a hand covers this ROI, not that any hand is detected:
 * the pointing hand may remain elsewhere on the page. Pass true conservatively
 * when coverage is unknown; no baseline is learned while the ROI is covered.
 * arm() has no coverage argument: call it only with a clear, stationary ROI.
 * Pass the SAME region to arm/changed and the coverage check. Prefer the caller's
 * expanded handwriting/readback crop, including space above a blank line: ink
 * outside the supplied crop cannot be detected. There is no hidden ROI padding.
 * Long thin fields retain horizontal detail under a <=18,432-pixel area budget;
 * a minimum 32-pixel analysis side prevents their height collapsing to 4 pixels.
 * This can enlarge the short axis; it cannot recover missing camera detail.
 * Native crops under 12 pixels in either direction remain manual-only.
 *
 * Use the separate whole-page movement guard too. Blank crops have no registration
 * anchors, and this does not solve arbitrary camera motion, blur or pen colours.
 * ready:false means use the manual path; rearm-* requires a new clear capture.
 * score is bounded stroke support, NOT a calibrated probability or accuracy claim.
 *
 * Optional readFrame(src, region, width, height) returns RGBA ImageData of that crop.
 * Synchronous injection and a monotonic clock permit Node tests without any DOM.
 */
export function makeInk({ readFrame = browserReader(), now = () => performance.now(), clock = now,
  intervalMs = 100, settleMs = 300, confirmMs = 180, maxAgeMs = 120000, staleMs = 1500 } = {}) {
  let ref = null, pending = null, clearSince = null, lastCheck = -Infinity;
  let lastMediaTime = null, lastMediaAdvance = 0, last = { inked: false, score: 0, ready: false, reason: 'not-armed' };
  const result = (ready, reason, score = 0, inked = false) => (last = { inked, score, ready, reason });
  const invalidate = reason => { ref = null; pending = null; return result(false, reason); };
  const read = (src, r) => {
    if (!src?.img || !Number.isFinite(src.w) || !Number.isFinite(src.h) || src.w < 32 || src.h < 32) throw Error('Missing source');
    const sw = (r.x1 - r.x0) * src.w, sh = (r.y1 - r.y0) * src.h;
    if (sw < 12 || sh < 12) throw Error('Crop too small');
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (sw * sh)), MAX_SIDE / Math.max(sw, sh));
    let width = Math.max(MIN_SIDE, Math.round(sw * scale)), height = Math.max(MIN_SIDE, Math.round(sh * scale));
    // A minimum short side may exceed the area budget. Reduce only the long side,
    // rather than shrinking the short side back into an unusable comparison.
    if (width * height > MAX_PIXELS) {
      if (width >= height) width = Math.floor(MAX_PIXELS / height);
      else height = Math.floor(MAX_PIXELS / width);
    }
    const gray = grayOf(readFrame(src, r, width, height), width, height);
    const brightness = median(Array.from(gray).filter((_, i) => i % 4 === 0));
    if (brightness < 55) throw Error('Crop too dark');
    return { width, height, gray, ridge: ridges(gray, width, height) };
  };
  return {
    arm(src, region) {
      ref = null; pending = null; lastCheck = -Infinity;
      const r = regionOf(region), time = clock();
      if (!r || !Number.isFinite(time)) { result(false, 'rearm-invalid-input'); return false; }
      try {
        const frame = read(src, r);
        ref = { ...frame, ...referenceDetails(frame.gray, frame.ridge, frame.width, frame.height),
          region: r, img: src.img, stream: src.img.srcObject ?? null, w: src.w, h: src.h, at: time };
        clearSince = time; lastMediaAdvance = time;
        lastMediaTime = Number.isFinite(src.img.currentTime) ? src.img.currentTime : null;
        result(true, 'armed'); return true;
      } catch { result(false, 'rearm-unreadable-frame'); return false; }
    },
    changed(src, region, handVisible = false) {
      if (!ref) return result(false, last.reason.startsWith('rearm-') ? last.reason : 'not-armed');
      const r = regionOf(region), time = clock();
      if (!Number.isFinite(time) || time < ref.at || time - ref.at > maxAgeMs) return invalidate('rearm-stale-reference');
      if (!r || Object.keys(r).some(k => Math.abs(r[k] - ref.region[k]) > 1e-6)) return invalidate('rearm-region-changed');
      if (!src?.img || src.img !== ref.img || (src.img.srcObject ?? null) !== ref.stream || src.w !== ref.w || src.h !== ref.h)
        return invalidate('rearm-source-changed');
      if (Number.isFinite(src.img.currentTime)) {
        if (lastMediaTime === null || src.img.currentTime > lastMediaTime) { lastMediaAdvance = time; lastMediaTime = src.img.currentTime; }
        if (time - lastMediaAdvance > staleMs) return invalidate('rearm-stale-frame');
      }
      if (handVisible) { pending = null; clearSince = null; return result(false, 'roi-covered'); }
      if (clearSince === null) clearSince = time;
      if (time - clearSince < settleMs) return result(false, 'waiting-for-clear-frame');
      if (time - lastCheck < intervalMs) return last;
      lastCheck = time;
      let frame;
      try { frame = read(src, r); } catch { return invalidate('rearm-unreadable-frame'); }
      if (referenceMoved(ref, frame.ridge)) return invalidate('rearm-motion-or-blur');
      const stroke = changedStroke(ref, frame.gray, frame.ridge);
      if (stroke.uncertain) { pending = null; return result(false, stroke.reason); }
      if (!stroke.count) { pending = null; return result(true, 'no-new-ink'); }
      let overlap = 0;
      if (pending) for (let p = 0; p < stroke.mask.length; p++) if (stroke.mask[p] && pending.mask[p]) overlap++;
      if (!pending || time - pending.lastAt > 1000 || overlap / Math.min(stroke.count, pending.count) < 0.5)
        pending = { mask: stroke.mask, count: stroke.count, at: time, lastAt: time };
      else { pending.mask = stroke.mask; pending.count = stroke.count; pending.lastAt = time; }
      return result(true, time - pending.at >= confirmMs ? 'new-ink-visible' : 'confirming-visible-ink', stroke.score, time - pending.at >= confirmMs);
    },
  };
}
