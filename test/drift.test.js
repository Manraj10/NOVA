import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDrift } from '../public/drift.js';

// A rasterized form, independently transformed below. Its labels, blanks and
// boxes are image content, not the detector's feature coordinates or outputs.
const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','11011','10001'],
  Y:['10001','10001','01010','00100','00100','00100','00100'],
};

function blank(width = 240, height = 320, color = [243, 242, 238]) {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let p = 0; p < image.data.length; p += 4) image.data.set([...color, 255], p);
  return image;
}

function rectangle(image, x, y, width, height, color = [28, 31, 33]) {
  for (let j = Math.max(0, y); j < Math.min(image.height, y + height); j++) {
    for (let i = Math.max(0, x); i < Math.min(image.width, x + width); i++) {
      image.data.set([...color, 255], (j * image.width + i) * 4);
    }
  }
}

function text(image, message, x, y, scale = 2) {
  for (const letter of message) {
    const glyph = FONT[letter];
    if (glyph) glyph.forEach((row, j) => [...row].forEach((v, i) => {
      if (v === '1') rectangle(image, x + i * scale, y + j * scale, scale, scale);
    }));
    x += 6 * scale;
  }
}

function form() {
  const image = blank();
  text(image, 'SIGNUP FORM', 20, 22);
  for (const [label, y, end] of [['NAME', 70, 216], ['EMAIL', 130, 200], ['DAY', 190, 183]]) {
    text(image, label, 20, y);
    rectangle(image, 20, y + 41, end - 20, 2);
    rectangle(image, 20, y + 31, 2, 12);
    rectangle(image, end - 2, y + 31, 2, 12);
  }
  rectangle(image, 20, 264, 14, 2); rectangle(image, 20, 278, 14, 2);
  rectangle(image, 20, 264, 2, 16); rectangle(image, 32, 264, 2, 16);
  text(image, 'OPTIONAL', 43, 266);
  text(image, 'THANK YOU', 20, 300, 1);
  return image;
}

function sample(image, x, y, channel) {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return channel === 3 ? 255 : 242;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
  const dx = x - x0, dy = y - y0, at = (i, j) => image.data[(j * image.width + i) * 4 + channel];
  return at(x0, y0) * (1 - dx) * (1 - dy) + at(x1, y0) * dx * (1 - dy)
    + at(x0, y1) * (1 - dx) * dy + at(x1, y1) * dx * dy;
}

function transformed(image, { dx = 0, dy = 0, degrees = 0, scale = 1, gain = 1, offset = 0, noise = 0 } = {}) {
  const out = blank(image.width, image.height), theta = degrees * Math.PI / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta), cx = image.width / 2, cy = image.height / 2;
  let seed = 137;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const u = (x - cx - dx) / scale, v = (y - cy - dy) / scale;
    const sourceX = cos * u + sin * v + cx, sourceY = -sin * u + cos * v + cy;
    seed = (1664525 * seed + 1013904223) >>> 0;
    const jitter = ((seed / 2 ** 32) * 2 - 1) * noise;
    for (let c = 0; c < 3; c++) out.data[(y * image.width + x) * 4 + c] = sample(image, sourceX, sourceY, c) * gain + offset + jitter;
  }
  return out;
}

function source(image) { return { img: image, w: image.width, h: image.height }; }

function coveredBy(image, regions) {
  const out = transformed(image);
  for (const region of regions) {
    const x = Math.floor(region.x0 * out.width), y = Math.floor(region.y0 * out.height);
    rectangle(out, x, y, Math.ceil(region.x1 * out.width) - x,
      Math.ceil(region.y1 * out.height) - y, [181, 131, 102]);
  }
  return out;
}

function paperOnTexturedDesk(paper, dx = 0, dy = 0) {
  const desk = blank(400, 400);
  for (let y = 0; y < 400; y += 8) for (let x = 0; x < 400; x += 8) {
    const dark = ((x / 8) * 7 + (y / 8) * 11) % 3 === 0;
    rectangle(desk, x, y, 5, 5, dark ? [20, 40, 30] : [130, 110, 70]);
  }
  for (let y = 0; y < paper.height; y++) for (let x = 0; x < paper.width; x++) {
    const to = ((40 + dy + y) * desk.width + 80 + dx + x) * 4;
    desk.data.set(paper.data.subarray((y * paper.width + x) * 4, (y * paper.width + x + 1) * 4), to);
  }
  return desk;
}

function narrowPaperInLandscape(paper, dx = 0, dy = 0) {
  // Portrait paper fills 42% of a landscape photo's width, like check/form.jpg.
  const photo = blank(800, 450, [45, 40, 35]), paperWidth = 336, paperHeight = 414;
  for (let y = 0; y < paperHeight; y++) for (let x = 0; x < paperWidth; x++) {
    const p = ((18 + dy + y) * photo.width + 232 + dx + x) * 4;
    for (let c = 0; c < 3; c++) photo.data[p + c] = sample(paper,
      (x + 0.5) * paper.width / paperWidth - 0.5, (y + 0.5) * paper.height / paperHeight - 0.5, c);
  }
  return photo;
}

function fixture() {
  let clock = 0, reads = 0;
  const requested = [];
  const drift = makeDrift({
    now: () => clock,
    readFrame(src, width, height) {
      reads++; requested.push([width, height]);
      if (src.img.unreadable) throw Error('Camera unavailable');
      const out = blank(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++)
        out.data[(y * width + x) * 4 + c] = sample(src.img, (x + 0.5) * src.w / width - 0.5, (y + 0.5) * src.h / height - 0.5, c);
      return out;
    },
  });
  return { drift, requested, get reads() { return reads; },
    check(image, hand = false, elapsed = 400) { clock += elapsed; return drift.moved(source(image), hand); } };
}

test('an ordinary clear form captures and stays stable across new frames', () => {
  const f = fixture(), image = form();
  assert.equal(f.drift.capture(source(image)), true);
  assert.equal(f.drift.status, 'ready');
  for (let i = 0; i < 3; i++) assert.equal(f.check(transformed(image)), false);
  assert(f.requested.every(([w, h]) => Math.max(w, h) <= 320));
});

test('global exposure, contrast and modest sensor noise are not page movement', () => {
  const f = fixture(), image = form();
  assert(f.drift.capture(source(image)));
  for (const settings of [{ gain: 0.7, offset: 42 }, { gain: 1.1, offset: -12 }, { gain: 0.5, offset: 76, noise: 3 }, { noise: 4 }]) {
    for (let i = 0; i < 2; i++) assert.equal(f.check(transformed(image, settings)), false, JSON.stringify(settings));
    assert.equal(f.drift.status, 'ready');
  }
});

test('a small new handwritten answer, also under exposure change, is allowed', () => {
  const f = fixture(), image = form(), written = transformed(image);
  assert(f.drift.capture(source(image)));
  rectangle(written, 95, 95, 2, 13, [35, 55, 95]); rectangle(written, 95, 106, 18, 2, [35, 55, 95]);
  rectangle(written, 112, 99, 2, 9, [35, 55, 95]); rectangle(written, 118, 96, 2, 12, [35, 55, 95]);
  for (let i = 0; i < 3; i++) assert.equal(f.check(transformed(written, { gain: 0.8, offset: 26, noise: 2 })), false);
});

test('small subpixel camera jitter does not accumulate into an alarm', () => {
  const f = fixture(), image = form();
  assert(f.drift.capture(source(image)));
  for (const dx of [0.5, -0.5, 0.75, 0, -0.75, 0.5]) {
    assert.equal(f.check(transformed(image, { dx, dy: -dx / 2 })), false);
  }
});

test('smooth uneven illumination preserves local printed geometry', () => {
  const f = fixture(), image = form(), shaded = transformed(image);
  assert(f.drift.capture(source(image)));
  for (let y = 0; y < shaded.height; y++) for (let x = 0; x < shaded.width; x++) {
    const gain = 0.58 + 0.32 * x / shaded.width + 0.06 * y / shaded.height;
    for (let c = 0; c < 3; c++) {
      const p = (y * shaded.width + x) * 4 + c;
      shaded.data[p] = shaded.data[p] * gain + 15;
    }
  }
  for (let i = 0; i < 3; i++) assert.equal(f.check(shaded), false);
});

for (const [name, settings] of [
  ['translation', { dx: 12, dy: 8 }],
  ['smaller translation', { dx: 6 }],
  ['large translation outside the search window', { dx: 36, dy: -15 }],
  ['rotation', { degrees: 6 }],
  ['zoom', { scale: 1.10 }],
  ['zoom out', { scale: 0.90 }],
]) {
  test(`${name} in independently transformed form invalidates the old geometry`, () => {
    const f = fixture(), image = form(), changed = transformed(image, { ...settings, gain: 0.8, offset: 20 });
    assert(f.drift.capture(source(image)));
    assert.equal(f.check(changed), false, 'one suspicious clear frame is not enough');
    assert.equal(f.drift.status, 'suspect');
    assert.equal(f.check(changed), true);
    assert.equal(f.drift.status, 'moved');
    assert.equal(f.check(image), true, 'returning the page does not clear a latched alarm');
    assert.equal(f.drift.capture(source(changed)), true, 'a new parse can establish a new reference');
    assert.equal(f.check(changed), false);
  });
}

test('hand-visible frames skip image comparison and never update the reference', () => {
  const f = fixture(), image = form(), covered = transformed(image);
  assert(f.drift.capture(source(image)));
  rectangle(covered, 35, 45, 170, 240, [181, 131, 102]);
  const reads = f.reads;
  for (let i = 0; i < 4; i++) assert.equal(f.check(covered, true), false);
  assert.equal(f.reads, reads);
  assert.equal(f.drift.status, 'occluded');
  assert.equal(f.drift.verified, false, 'a false movement result alone does not permit guidance');
  assert.equal(f.check(image), false);
  assert.equal(f.drift.verified, true);
  const shifted = transformed(image, { dx: 12, dy: 8 });
  assert.equal(f.check(shifted, true), false);
  assert.equal(f.check(shifted), false);
  assert.equal(f.check(shifted), true, 'movement hidden by a hand is checked once the hand clears');
});

test('a localized visible hand allows verification of the remaining printed page', () => {
  const f = fixture(), image = form(), hands = [{ x0: 0.62, y0: 0.38, x1: 0.74, y1: 0.52 }];
  assert(f.drift.capture(source(image)));
  for (let i = 0; i < 3; i++) {
    assert.equal(f.check(coveredBy(image, hands), hands), false);
    assert.equal(f.drift.status, 'ready');
    assert.equal(f.drift.verified, true);
  }
});

test('paper translation is detected while the localized hand stays visible', () => {
  const f = fixture(), image = form(), hands = [{ x0: 0.62, y0: 0.38, x1: 0.74, y1: 0.52 }];
  assert(f.drift.capture(source(image)));
  const changed = coveredBy(transformed(image, { dx: 12, dy: 8 }), hands);
  assert.equal(f.check(changed, hands), false);
  assert.equal(f.drift.status, 'suspect');
  assert.equal(f.drift.verified, false, 'pause on the first mismatch');
  assert.equal(f.check(changed, hands), true);
  assert.equal(f.drift.status, 'moved');
});

test('broad occlusion pauses verification and resumes without another capture', () => {
  const f = fixture(), image = form(), hands = [{ x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }];
  assert(f.drift.capture(source(image)));
  const reads = f.reads;
  for (let i = 0; i < 3; i++) {
    assert.equal(f.check(coveredBy(image, hands), hands), false);
    assert.equal(f.drift.status, 'occluded');
    assert.equal(f.drift.verified, false);
  }
  assert.equal(f.reads, reads, 'no usable evidence remains to compare');
  assert.equal(f.check(image, [], 0), false, 'a clear frame is checked immediately');
  assert.equal(f.drift.status, 'ready');
  assert.equal(f.drift.verified, true);
});

test('a page moved during broad occlusion is checked against the retained reference', () => {
  const f = fixture(), image = form(), hands = [{ x0: 0, y0: 0, x1: 1, y1: 1 }];
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(coveredBy(image, hands), hands), false);
  assert.equal(f.drift.verified, false);
  const changed = transformed(image, { dx: 12, dy: 8 });
  assert.equal(f.check(changed, [], 0), false);
  assert.equal(f.drift.status, 'suspect');
  assert.equal(f.drift.verified, false);
  assert.equal(f.check(changed, []), true);
});

test('invalid hand bounds pause and can recover after a valid clear observation', () => {
  const f = fixture(), image = form();
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(image, [{ x0: NaN, y0: 0, x1: 1, y1: 1 }]), false);
  assert.equal(f.drift.status, 'occluded');
  assert.equal(f.drift.verified, false);
  assert.equal(f.check(image, []), false);
  assert.equal(f.drift.verified, true);
});

test('a document ROI detects moving paper despite a stationary textured background', () => {
  const f = fixture(), paper = form(), before = paperOnTexturedDesk(paper), changed = paperOnTexturedDesk(paper, 12, 8);
  const document = { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9 };
  assert(f.drift.capture(source(before), document));
  assert.equal(f.check(before), false);
  assert.equal(f.check(changed), false);
  assert.equal(f.drift.status, 'suspect');
  assert.equal(f.check(changed), true);
});

test('narrow portrait paper in a landscape camera view has enough ROI-relative evidence', () => {
  const document = { x0: 0.29, y0: 0.04, x1: 0.71, y1: 0.96 };
  const before = narrowPaperInLandscape(form()), shifted = narrowPaperInLandscape(form(), 16, 9);
  for (const region of [undefined, document]) {
    const f = fixture();
    assert(f.drift.capture(source(before), region), `capture with ${region ? 'paper ROI' : 'default frame'}`);
    assert.equal(f.check(before), false);
    assert.equal(f.drift.verified, true);
    assert.equal(f.check(transformed(before, { gain: 1.08 })), false);
    assert.equal(f.drift.verified, true);
    assert.equal(f.check(shifted), false);
    assert.equal(f.drift.status, 'suspect');
    assert.equal(f.check(shifted), true);
  }
});

test('invalid or textureless document ROI fails paused rather than falling back to the desk', () => {
  const f = fixture(), image = form();
  assert.equal(f.drift.capture(source(image), { x0: 0.8, y0: 0, x1: 0.2, y1: 1 }), false);
  assert.equal(f.drift.status, 'unavailable');
  assert.equal(f.drift.moved(source(image)), true);
  assert.equal(f.drift.capture(source(image), { x0: 0.80, y0: 0.75, x1: 1, y1: 0.95 }), false);
  assert.equal(f.drift.status, 'low-texture');
  assert.equal(f.drift.verified, false);
});

test('a transient changed frame is cleared by the next stable observation', () => {
  const f = fixture(), image = form(), shifted = transformed(image, { dx: 12 });
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(shifted), false);
  assert.equal(f.check(image), false);
  assert.equal(f.drift.status, 'ready');
  assert.equal(f.check(shifted), false);
  assert.equal(f.check(shifted), true);
});

test('checking is throttled, but missing source and dimension changes pause immediately', () => {
  const f = fixture(), image = form();
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(image, false, 0), false);
  const reads = f.reads;
  for (let i = 0; i < 20; i++) assert.equal(f.check(image, false, 5), false);
  assert.equal(f.reads, reads);
  assert.equal(f.drift.moved({ img: image, w: 0, h: 320 }, true), true);
  assert.equal(f.drift.status, 'unavailable');
  assert(f.drift.capture(source(image)));
  assert.equal(f.drift.moved({ img: image, w: 480, h: 640 }, true), true);
  assert.match(f.drift.reason, /dimensions changed/);
});

test('uncaptured, lost and unreadable frames fail paused until a successful capture', () => {
  const f = fixture(), image = form();
  assert.equal(f.drift.moved(source(image)), true);
  assert.equal(f.drift.capture(null), false);
  assert.equal(f.drift.status, 'unavailable');
  assert(f.drift.capture(source(image)));
  assert.equal(f.drift.moved(null), true);
  assert(f.drift.capture(source(image)));
  const unavailable = transformed(image); unavailable.unreadable = true;
  assert.equal(f.check(unavailable), true);
  assert.equal(f.drift.status, 'unavailable');
  assert.equal(f.drift.capture(source(unavailable)), false);
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(image), false);
});

test('low texture has an explicit unavailable guarantee, not a silent stable result', () => {
  const f = fixture(), image = form(), empty = blank();
  assert.equal(f.drift.capture(source(empty)), false);
  assert.equal(f.drift.status, 'low-texture');
  assert.equal(f.check(empty), true);
  assert(f.drift.capture(source(image)));
  assert.equal(f.check(empty), false);
  assert.equal(f.check(empty), true, 'loss of printed detail cannot verify old field geometry');
});
