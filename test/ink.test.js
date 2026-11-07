import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInk } from '../public/ink.js';

const W = 160, H = 80, ROI = { x0: 0, y0: 0, x1: 1, y1: 1 };
function blank(value = 225) { return new Uint8ClampedArray(W * H).fill(value); }
function line(frame, x0, y0, x1, y1, value = 25, width = 2) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let n = 0; n <= steps; n++) {
    const x = Math.round(x0 + (x1 - x0) * n / Math.max(1, steps)), y = Math.round(y0 + (y1 - y0) * n / Math.max(1, steps));
    for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) frame[(y + dy) * W + x + dx] = value;
  }
  return frame;
}
function printed() {
  const frame = blank();
  line(frame, 12, 65, 145, 65, 45, 1);
  for (let x = 15; x < 65; x += 15) { line(frame, x, 12, x, 25, 45, 1); line(frame, x, 12, x + 8, 12, 45, 1); }
  return frame;
}
function writing(frame = blank()) {
  line(frame, 72, 32, 80, 48); line(frame, 80, 48, 89, 30); line(frame, 91, 47, 107, 35);
  return frame;
}
function harness(initial = blank(), options = {}) {
  let time = 0, pixels = initial, reads = 0;
  const src = { img: {}, w: W, h: H };
  const ink = makeInk({ clock: () => time, readFrame(_src, r, w, h) {
    reads++;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, Math.floor((r.x0 + (x + 0.5) / w * (r.x1 - r.x0)) * W));
      const sy = Math.min(H - 1, Math.floor((r.y0 + (y + 0.5) / h * (r.y1 - r.y0)) * H));
      const value = pixels[sy * W + sx], p = 4 * (y * w + x);
      data[p] = data[p + 1] = data[p + 2] = value; data[p + 3] = 255;
    }
    return { data, width: w, height: h };
  }, ...options });
  return { ink, src, set: frame => { pixels = frame; }, at: t => { time = t; }, reads: () => reads,
    sample(t, frame = pixels, covered = false, region = ROI) { time = t; pixels = frame; return ink.changed(src, region, covered); } };
}
function confirmed(h, pixels) { h.sample(400, pixels); return h.sample(650, pixels); }

test('new handwriting persists across clear samples; a single frame is not completion', () => {
  const h = harness(); assert.equal(h.ink.arm(h.src, ROI), true);
  const first = h.sample(400, writing());
  assert.equal(first.inked, false); assert.equal(first.reason, 'confirming-visible-ink');
  const next = h.sample(650);
  assert.equal(next.inked, true); assert.equal(next.ready, true); assert.ok(next.score > 0 && next.score <= 1);
});

test('unchanged blank or pre-existing printing is not new ink', () => {
  for (const image of [blank(), printed(), writing(printed())]) {
    const h = harness(image); assert.equal(h.ink.arm(h.src, ROI), true);
    assert.equal(confirmed(h, image).inked, false);
  }
  const h = harness(printed()); h.ink.arm(h.src, ROI);
  assert.equal(confirmed(h, writing(printed())).inked, true);
});

test('uniform exposure and graded lighting changes do not become strokes', () => {
  const base = printed();
  for (const transform of [(v) => v * 0.65 + 16, (v) => v * 1.05 + 10, (v, p) => v - 40 + (p % W) / W * 70]) {
    const h = harness(base); h.ink.arm(h.src, ROI);
    const changed = Uint8ClampedArray.from(base, transform);
    assert.equal(confirmed(h, changed).inked, false);
  }
});

test('new strokes remain detectable after a uniform exposure change', () => {
  const h = harness(printed()); h.ink.arm(h.src, ROI);
  const changed = Uint8ClampedArray.from(writing(printed()), v => v * 0.72 + 12);
  assert.equal(confirmed(h, changed).inked, true);
});

test('ROI coverage blocks sampling and resets persistence, without learning the hand', () => {
  const h = harness(); h.ink.arm(h.src, ROI);
  h.sample(400, writing()); const reads = h.reads();
  assert.equal(h.sample(650, writing(), true).reason, 'roi-covered');
  assert.equal(h.reads(), reads);
  assert.equal(h.sample(900, writing()).ready, false);
  assert.equal(h.sample(1250, writing()).inked, false);
  assert.equal(h.sample(1500, writing()).inked, true);
});

test('broad hard and soft hand shadows are not new thin ink', () => {
  for (const soft of [false, true]) {
    const shadow = blank();
    for (let y = 10; y < 70; y++) for (let x = 45; x < 110; x++) {
      const d = Math.hypot((x - 78) / 32, (y - 40) / 28);
      if (d < 1) shadow[y * W + x] = soft ? 225 - 110 * (1 - d) : 105;
    }
    const h = harness(); h.ink.arm(h.src, ROI);
    assert.equal(confirmed(h, shadow).inked, false);
  }
});

test('sensor noise and isolated dark pixels are not strokes', () => {
  const base = printed(), noise = Uint8ClampedArray.from(base, (v, p) => v + ((p * 17 + p * p * 13) % 17) - 8);
  const salt = base.slice();
  for (let y = 7; y < H - 7; y += 10) for (let x = 7; x < W - 7; x += 11) salt[y * W + x] = 0;
  for (const image of [noise, salt]) {
    const h = harness(base); h.ink.arm(h.src, ROI);
    assert.equal(confirmed(h, image).inked, false);
  }
});

test('printed detail translation or heavy blur requests rearm, not new ink', () => {
  const base = printed(), shifted = blank(), blurred = blank();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y >= 2) shifted[y * W + x] = base[(y - 2) * W + x];
    let sum = 0, count = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H) { sum += base[(y + dy) * W + x + dx]; count++; }
    blurred[y * W + x] = sum / count;
  }
  for (const image of [shifted, blurred]) {
    const h = harness(base); h.ink.arm(h.src, ROI);
    const out = h.sample(400, image);
    assert.equal(out.inked, false); assert.equal(out.ready, false); assert.equal(out.reason, 'rearm-motion-or-blur');
    assert.equal(h.sample(650, base).ready, false, 'invalid reference stays invalid until rearmed');
    h.at(700); assert.equal(h.ink.arm(h.src, ROI), true);
  }
});

test('region, source, dimensions and stale references invalidate the comparison', () => {
  for (const change of ['region', 'dimensions', 'source', 'age']) {
    const h = harness(); h.ink.arm(h.src, ROI);
    if (change === 'dimensions') h.src.w++;
    if (change === 'source') h.src.img = {};
    const region = change === 'region' ? { ...ROI, x0: 0.01 } : ROI;
    const out = h.sample(change === 'age' ? 120001 : 400, writing(), false, region);
    assert.equal(out.inked, false); assert.equal(out.ready, false); assert.match(out.reason, /^rearm-/);
  }
});

test('frozen video frames, unreadable pixels and unavailable canvas fail to manual', () => {
  const h = harness(); h.src.img.currentTime = 1; h.ink.arm(h.src, ROI);
  assert.equal(h.sample(1600, writing()).reason, 'rearm-stale-frame');
  const broken = makeInk({ clock: () => 0, readFrame: () => ({ width: W, height: H, data: [] }) });
  assert.equal(broken.arm({ img: {}, w: W, h: H }, ROI), false);
  assert.equal(broken.changed({ img: {}, w: W, h: H }, ROI).inked, false);
  assert.equal(makeInk().arm({ img: {}, w: W, h: H }, ROI), false, 'Node needs no DOM for unavailable/manual path');
});

test('sampling is throttled and never upsamples a crop beyond its bounded budget', () => {
  const h = harness(); h.ink.arm(h.src, ROI);
  h.sample(400, blank()); const reads = h.reads();
  h.sample(450, blank()); assert.equal(h.reads(), reads);
  let size;
  const ink = makeInk({ clock: () => 0, readFrame(_src, _r, w, h) {
    size = [w, h]; const data = new Uint8ClampedArray(w * h * 4).fill(225);
    for (let p = 3; p < data.length; p += 4) data[p] = 255;
    return { data, width: w, height: h };
  } });
  assert.equal(ink.arm({ img: {}, w: 4000, h: 3000 }, ROI), true);
  assert.ok(size[0] * size[1] <= 192 * 96);
  assert.ok(Math.min(...size) >= 32 && Math.max(...size) <= 576);
});

// Sample procedural full-resolution scenes at real camera dimensions, rather
// than assuming the field itself occupies a generous 160x80 frame.
function cameraHarness(w, h, region) {
  let time = 0, mode = 'baseline', size;
  const sw = (region.x1 - region.x0) * w, sh = (region.y1 - region.y0) * h;
  const src = { img: {}, w, h };
  const segmentDistance = (x, y, ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
  };
  const ink = makeInk({ clock: () => time, readFrame(_src, r, outW, outH) {
    size = [outW, outH];
    const data = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
      const fx = ((r.x0 + (x + 0.5) / outW * (r.x1 - r.x0)) - region.x0) / (region.x1 - region.x0);
      const fy = ((r.y0 + (y + 0.5) / outH * (r.y1 - r.y0)) - region.y0) / (region.y1 - region.y0);
      const px = fx * sw, py = fy * sh;
      let v = Math.abs(py - sh * 0.82) < 0.7 && fx > 0.05 && fx < 0.95 ? 45 : 225;
      if (mode === 'ink' && (segmentDistance(px, py, sw * 0.37, sh * 0.24, sw * 0.46, sh * 0.6) < 1.5
        || segmentDistance(px, py, sw * 0.46, sh * 0.6, sw * 0.63, sh * 0.25) < 1.5)) v = 25;
      if (mode === 'exposure') v = v * 0.7 + 14;
      if (mode === 'gradient') v += -30 + fx * 60;
      if (mode === 'shadow' && Math.hypot((fx - 0.5) / 0.2, (fy - 0.45) / 0.45) < 1) v *= 0.5;
      const p = 4 * (y * outW + x); data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
    }
    return { data, width: outW, height: outH };
  } });
  return { ink, src, size: () => size, sample(t, nextMode) { time = t; mode = nextMode; return ink.changed(src, region, false); } };
}

test('real camera aspect ratios retain new strokes in thin fields and checkboxes', () => {
  const cases = [
    [1920, 1080, { x0: 0.15, y0: 0.35, x1: 0.65, y1: 0.37 }], // 960x22, unexpanded blank
    [1920, 1080, { x0: 0.15, y0: 0.3, x1: 0.65, y1: 0.37 }], // 960x76, readback crop
    [1920, 1080, { x0: 0.1, y0: 0.3, x1: 0.12, y1: 0.335 }], // 38x38 checkbox
    [1080, 1920, { x0: 0.1, y0: 0.35, x1: 0.8, y1: 0.362 }], // 756x23, portrait blank
    [1080, 1920, { x0: 0.15, y0: 0.5, x1: 0.18, y1: 0.52 }], // 32x38 checkbox
  ];
  for (const [w, h, region] of cases) {
    const c = cameraHarness(w, h, region);
    assert.equal(c.ink.arm(c.src, region), true, `${w}x${h} arm ${JSON.stringify(region)}`);
    assert.equal(c.sample(400, 'baseline').inked, false);
    assert.equal(c.sample(700, 'ink').inked, false);
    const out = c.sample(1000, 'ink');
    assert.equal(out.inked, true, `${w}x${h} ${c.size()} ${out.reason}`);
    assert.ok(c.size()[0] * c.size()[1] <= 192 * 96);
    assert.ok(Math.min(...c.size()) >= 32);
  }
});

test('thin-field resolution does not turn exposure, gradients or broad shadows into ink', () => {
  const cases = [[1920, 1080, { x0: 0.15, y0: 0.35, x1: 0.65, y1: 0.37 }],
    [1080, 1920, { x0: 0.1, y0: 0.35, x1: 0.8, y1: 0.362 }]];
  for (const [w, h, region] of cases) for (const mode of ['exposure', 'gradient', 'shadow']) {
    const c = cameraHarness(w, h, region); c.ink.arm(c.src, region);
    c.sample(400, mode);
    assert.equal(c.sample(700, mode).inked, false, `${w}x${h} ${mode}`);
  }
});

test('native crops without enough camera pixels explicitly stay manual-only', () => {
  const c = cameraHarness(1920, 1080, { x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.305 });
  assert.equal(c.ink.arm(c.src, { x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.305 }), false);
  const out = c.sample(400, 'ink');
  assert.equal(out.ready, false); assert.equal(out.inked, false); assert.match(out.reason, /^rearm-/);
});
