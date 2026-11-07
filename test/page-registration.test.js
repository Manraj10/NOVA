import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDrift } from '../public/drift.js';

// Independently rasterized row labels/lines. These fixtures do not use the
// detector's anchor locations or output to construct their transformations.
function paper(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) { data[p] = 245; data[p + 1] = 242; data[p + 2] = 235; data[p + 3] = 255; }
  const rect = (x, y, w, h) => {
    for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++)
      for (let c = 0; c < 3; c++) data[(j * width + i) * 4 + c] = 25;
  };
  for (let row = 0; row < 6; row++) {
    const y = height * (.13 + row * .12);
    let seed = 613 + row * 73;
    for (let letter = 0; letter < 6; letter++) for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      if ((seed >>> 29) < 4) rect(width * .13 + letter * 20 + gx * 3, y + gy * 3, 3, 3);
    }
    rect(width * .13, y + 36, width * .68, 2);
    rect(width * .84, y + 2, 2, 24); rect(width * .87, y + 2, 2, 24);
    rect(width * .84, y + 2, width * .03, 2); rect(width * .84, y + 24, width * .03, 2);
  }
  return { width, height, data };
}
const ROI = { x0: .06, y0: .04, x1: .94, y1: .96 };
function moved(base, { dx = 0, dy = 0, degrees = 0, scale = 1, gain = 1, hands = [] } = {}) {
  const theta = degrees * Math.PI / 180, a = scale * Math.cos(theta), b = scale * Math.sin(theta);
  const cx = base.width / 2, cy = base.height / 2;
  return { base, width: base.width, height: base.height, a, b,
    tx: cx + dx - a * cx + b * cy, ty: cy + dy - b * cx - a * cy, gain, hands };
}
function bilinear(image, x, y, c) {
  if (x < 0 || y < 0 || x >= image.width - 1 || y >= image.height - 1) return c === 3 ? 255 : 242;
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top;
  const at = (u, v) => image.data[(v * image.width + u) * 4 + c];
  return at(left, top) * (1 - fx) * (1 - fy) + at(left + 1, top) * fx * (1 - fy)
    + at(left, top + 1) * (1 - fx) * fy + at(left + 1, top + 1) * fx * fy;
}
function readFrame(src, width, height) {
  const image = src.img, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + .5) * src.w / width - .5, py = (y + .5) * src.h / height - .5;
    const covered = image.hands?.some(r => px / src.w >= r.x0 && px / src.w <= r.x1 && py / src.h >= r.y0 && py / src.h <= r.y1);
    // Integrate each output pixel over its source footprint. Point sampling
    // would alias tiny printed strokes differently after a subpixel motion.
    for (let c = 0; c < 3; c++) {
      let sum=0;
      for(let sy=0;sy<3;sy++) for(let sx=0;sx<3;sx++) {
        const xx=px+((sx+.5)/3-.5)*src.w/width, yy=py+((sy+.5)/3-.5)*src.h/height;
        let u=xx,v=yy,base=image;
        if(image.base) {base=image.base;const det=image.a**2+image.b**2,tx=xx-image.tx,ty=yy-image.ty;u=(image.a*tx+image.b*ty)/det;v=(-image.b*tx+image.a*ty)/det;}
        sum+=bilinear(base,u,v,c);
      }
      data[(y*width+x)*4+c]=covered?[150,105,80][c]:sum/9*(image.gain||1);
    }
    data[(y * width + x) * 4 + 3] = 255;
  }
  return { data, width, height };
}
const source = img => ({ img, w: img.width, h: img.height });
const project = (m, x, y) => ({ x: m.xx * x + m.xy * y + m.tx, y: m.yx * x + m.yy * y + m.ty });
const truth = (m, x, y) => ({ x: m.a * x - m.b * y + m.tx, y: m.b * x + m.a * y + m.ty });
function assertMapping(model, expected, width, height, tolerance = 2.5) {
  assert(model, 'strict registration returned a source-pixel model');
  assert.equal(model.w, width); assert.equal(model.h, height);
  assert(model.inliers >= 8); assert(model.fraction >= .75); assert(model.rms <= .65);
  for (const [xn, yn] of [[.13, .13], [.87, .13], [.13, .75], [.87, .75]]) {
    const x = xn * width, y = yn * height, a = project(model, x, y), b = truth(expected, x, y);
    assert(Math.hypot(a.x - b.x, a.y - b.y) < tolerance, `source-pixel corner error ${Math.hypot(a.x - b.x, a.y - b.y)}`);
  }
}

const transforms = [
  [960, 720, 'translation', { dx: 12, dy: 8 }],
  [960, 720, 'modest zoom', { scale: 1.02 }],
  [720, 960, 'translation', { dx: 12, dy: 8 }],
  [720, 960, 'small rotation', { degrees: .8 }],
  // Rounding the analysis size gives unequal x/y scale factors here. This
  // catches the mistake of exposing analysis coefficients as source pixels.
  [1001, 731, 'translation', { dx: 12, dy: 8 }],
  [1001, 731, 'small rotation', { degrees: .8 }],
  [1001, 731, 'modest zoom', { scale: 1.02 }],
];
for (const [width, height, name, settings] of transforms) {
  test(`${width}x${height} ${name} exports correct source-pixel coefficients`, () => {
    const base = paper(width, height), changed = moved(base, settings), drift = makeDrift({ readFrame });
    assert(drift.capture(source(base), ROI));
    assertMapping(drift.relocation(source(changed), []), changed, width, height);
  });
}

test('some tiny-print transforms conservatively require a full reread', () => {
  // Safe refusal is a supported outcome: knowing the synthetic transform does
  // not entitle the implementation to return a model without enough evidence.
  for (const [width, height, settings] of [[960, 720, { degrees: .8 }], [720, 960, { scale: 1.02 }]]) {
    const base = paper(width, height), drift = makeDrift({ readFrame });
    assert(drift.capture(source(base), ROI));
    assert.equal(drift.relocation(source(moved(base, settings)), []), null);
  }
});

test('a latched alarm can refit an explicitly supplied frozen frame and recapture it', () => {
  const base = paper(960, 720), first = moved(base, { dx: 6, dy: 3 }), final = moved(base, { dx: 12, dy: 8 });
  let time = 0;
  const drift = makeDrift({ readFrame, now: () => time });
  assert(drift.capture(source(base), ROI));
  assert.equal(drift.moved(source(first)), false); time = 400; assert.equal(drift.moved(source(first)), true);
  assertMapping(drift.lastModel, first, 960, 720);
  const fittedFinal = drift.relocation(source(final), []);
  assertMapping(fittedFinal, final, 960, 720);
  assert(Math.abs(fittedFinal.tx - drift.lastModel.tx) > 2, 'fresh fit differs from the stale latched alarm');
  assert(drift.capture(source(final), ROI));
  assert.equal(drift.lastModel, null);
  assert.equal(drift.moved(source(final)), false); assert.equal(drift.verified, true);
});

test('hidden motion, invalid masks, changed dimensions and missing print do not yield a correction', () => {
  const base = paper(960, 720), drift = makeDrift({ readFrame });
  assert(drift.capture(source(base), ROI));
  const hands = [{ x0: .05, y0: .05, x1: .95, y1: .95 }], hidden = moved(base, { dx: 12, dy: 8, hands });
  assert.equal(drift.relocation(source(hidden), hands), null);
  assert.equal(drift.relocation(source(base), true), null);
  assert.equal(drift.relocation(source(base), [{ x0: NaN, y0: 0, x1: 1, y1: 1 }]), null);
  assert.equal(drift.relocation({ ...source(base), w: 1920 }, []), null);
  const blank = paper(960, 720); blank.data.fill(245);
  assert.equal(drift.relocation(source(blank), []), null);
  assert.equal(drift.relocation(source(moved(base, { dx: 50 })), []), null);
});

test('capture excludes supplied hand pixels from the new reference', () => {
  const base = paper(960, 720), hands = [{ x0: .35, y0: .27, x1: .53, y1: .57 }];
  const covered = moved(base, { hands }), drift = makeDrift({ readFrame });
  assert(drift.capture(source(covered), ROI, hands));
  assertMapping(drift.relocation(source(base), []), moved(base), 960, 720);
  assert.equal(drift.capture(source(covered), ROI, [{ x0: 1, y0: 0, x1: 0, y1: 1 }]), false);
});

test('a freshly recaptured translation round trip restores source points without accumulated scale', () => {
  const base = paper(960, 720), shifted = moved(base, { dx: 12, dy: 8 }), drift = makeDrift({ readFrame });
  assert(drift.capture(source(base), ROI));
  const forward = drift.relocation(source(shifted)); assert(forward);
  assert(drift.capture(source(shifted), ROI));
  const back = drift.relocation(source(base)); assert(back);
  for (const [x, y] of [[150, 100], [750, 500]]) {
    const q = project(forward, x, y), r = project(back, q.x, q.y);
    assert(Math.hypot(r.x - x, r.y - y) < 2);
  }
});
