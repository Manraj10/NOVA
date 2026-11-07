// Turning one wide painting of the front of a room into a closed 360-degree loop.
// Pass 2's input: the front's right strip | a soft blend | the front's left strip. The painter fills the
// middle with the rest of the room; we keep whichever of two tries joins its strips most cleanly, then
// cross-fade both overlaps so the loop has no seam.
export const S = 0.15;

export const load = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const free = (...cs) => cs.forEach(c => { c.width = c.height = 0; });

// A photo, shrunk so uploads stay small (Vercel caps a request at 4.5 MB).
export function shrink(img, max = 1280, q = 0.86) {
  const k = Math.min(1, max / Math.max(img.width, img.height)), c = canvas(Math.round(img.width * k), Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', q);
  free(c);
  return url;
}

export function stripInput(front) {
  const w = front.width, h = front.height, s = Math.round(w * S), c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
  // the gap: the two inner edge columns stretched toward each other, blurred by a tiny-canvas round trip
  const t = canvas(16, 24), tx = t.getContext('2d');
  tx.drawImage(front, w - 1, 0, 1, h, 0, 0, 8, 24);
  tx.drawImage(front, 0, 0, 1, h, 8, 0, 8, 24);
  x.imageSmoothingQuality = 'high';
  x.globalAlpha = 0.6; x.drawImage(t, s, 0, w - 2 * s, h); x.globalAlpha = 1;
  x.drawImage(front, w - s, 0, s, h, 0, 0, s, h);
  x.drawImage(front, 0, 0, s, h, w - s, 0, s, h);
  const url = c.toDataURL('image/jpeg', 0.9);
  free(c, t);
  return url;
}

// How hard the painter's fill meets each kept strip: lower is cleaner.
export function edgeScore(back, w, h) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.drawImage(back, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, s = Math.round(w * S);
  const jump = col => { let e = 0; for (let y = 0; y < h; y += 2) { const i = (y * w + col) * 4; e += Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2]); } return e / (h / 2) / 3; };
  return Math.max(jump(s - 1), jump(s), jump(s + 1)) + Math.max(jump(w - s - 1), jump(w - s), jump(w - s + 1));
}

// front + back -> one loop canvas (width L, the same height). Front column x sits at loop column x - s.
export function makeLoop(front, back) {
  const w = front.width, h = front.height, s = Math.round(w * S), L = 2 * w - 2 * s;
  const c = canvas(L, h), x = c.getContext('2d');
  const b = canvas(w, h); b.getContext('2d').drawImage(back, 0, 0, w, h);
  x.drawImage(front, s, 0, w - 2 * s, h, 0, 0, w - 2 * s, h);
  x.drawImage(b, s, 0, w - 2 * s, h, w - s, 0, w - 2 * s, h);
  // the two overlaps, each a left-to-right cross-fade
  const fade = (A, ax, B, bx, at) => {
    const o = canvas(s, h), ox = o.getContext('2d');
    ox.drawImage(B, bx, 0, s, h, 0, 0, s, h);
    const g = ox.createLinearGradient(0, 0, s, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ox.globalCompositeOperation = 'destination-in'; ox.fillStyle = g; ox.fillRect(0, 0, s, h);
    x.drawImage(A, ax, 0, s, h, at, 0, s, h);
    x.drawImage(o, at, 0);
    free(o);
  };
  fade(front, w - s, b, 0, w - 2 * s);      // end of the front into the start of the back
  fade(b, w - s, front, 0, L - s);          // end of the back into the start of the front (the wrap)
  // where the painter's fill meets its kept strips there can be a hard line: melt a band across each
  const melt = at => {
    const R = Math.round(w * 0.035), t = canvas(6, h), band = canvas(2 * R, h), bx = band.getContext('2d');
    t.getContext('2d').drawImage(c, at - R, 0, 2 * R, h, 0, 0, 6, h);
    bx.imageSmoothingQuality = 'high'; bx.drawImage(t, 0, 0, 2 * R, h);
    const g = bx.createLinearGradient(0, 0, 2 * R, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    bx.globalCompositeOperation = 'destination-in'; bx.fillStyle = g; bx.fillRect(0, 0, 2 * R, h);
    x.drawImage(band, at - R, 0);
    free(t, band);
  };
  melt(w - s); melt(L - s);
  free(b);
  return { loop: c, L, s, w, h };
}

// The loop in the middle of a 2:1 equirectangular canvas; ceiling and floor grown from its top and bottom rows.
export const BAND = 0.5; // the painting covers the middle half of the sphere's height (+-45 degrees)
export function equirect(loop) {
  const L = loop.width, h = loop.height, H = Math.round(L / 2), top = Math.round((H - h) / 2), c = canvas(L, H), x = c.getContext('2d');
  x.drawImage(loop, 0, top, L, h);
  const cap = (sy, dy, dh, flip) => {
    const k = Math.round(h * 0.12);
    x.drawImage(loop, 0, flip ? h - k : 0, L, k, 0, dy, L, dh); // stretch the edge rows outward
    const t = canvas(64, 4); t.getContext('2d').drawImage(loop, 0, flip ? h - k : 0, L, k, 0, 0, 64, 4);
    const m = canvas(L, dh), mx = m.getContext('2d');
    mx.imageSmoothingQuality = 'high'; mx.drawImage(t, 0, 0, L, dh);
    const g = mx.createLinearGradient(0, 0, 0, dh);
    g.addColorStop(flip ? 0 : 1, 'rgba(0,0,0,0)'); g.addColorStop(flip ? 1 : 0, 'rgba(0,0,0,1)');
    mx.globalCompositeOperation = 'destination-in'; mx.fillStyle = g; mx.fillRect(0, 0, L, dh);
    x.drawImage(m, 0, dy);
    free(m, t);
  };
  cap(0, 0, top, false);
  cap(0, top + h, H - top - h, true);
  return c;
}

// Until the walls behind you are painted: the front, mirrored, softened and dimmed. A mirror meets the
// front exactly at both edges, so the room is whole from the first second; the real walls fade in over it.
export function placeholderBack(front) {
  const w = front.width, h = front.height, c = canvas(w, h), x = c.getContext('2d');
  const t = canvas(Math.round(w / 10), Math.round(h / 10));
  t.getContext('2d').drawImage(front, 0, 0, t.width, t.height);
  x.imageSmoothingQuality = 'high';
  x.translate(w, 0); x.scale(-1, 1);
  x.drawImage(t, 0, 0, w, h);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, 0, w, h);
  free(t);
  return c;
}
