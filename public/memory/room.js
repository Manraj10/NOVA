// The room you stand in: a sphere around you, painted with the 360 memory, pushed in by estimated depth,
// with a flat floor and ceiling so a step forward feels like a step. Look by dragging or tilting the phone.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { BAND } from './pano.js';

let estimator, warming = null;
const lib = () => import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');
const make = async device => (await lib()).pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device, dtype: device === 'webgpu' ? 'fp16' : 'q8' });
// Load the depth model early (on the start tap), so it is ready the moment the room is painted.
export function warmDepth() {
  return (warming ||= (async () => {
    for (const device of ['webgpu', 'wasm']) {
      try { estimator = await make(device); return estimator; } catch (e) { console.warn('depth', device, e); }
    }
    warming = null;
    throw new Error('No depth model');
  })());
}
// Depth for the loop, wrapped so the 360 seam has no jump.
export async function depthOf(loop, onStatus = () => {}) {
  const { RawImage } = await lib();
  await warmDepth();
  onStatus();
  const run = async img => { try { return await estimator(img); } catch (e) { console.warn('depth run failed, retrying on wasm', e); estimator = await make('wasm'); return estimator(img); } };
  const L = loop.width, h = loop.height, pad = Math.round(L * 0.1);
  const c = Object.assign(document.createElement('canvas'), { width: L + 2 * pad, height: h }), x = c.getContext('2d');
  x.drawImage(loop, L - pad, 0, pad, h, 0, 0, pad, h);
  x.drawImage(loop, pad, 0);
  x.drawImage(loop, 0, 0, pad, h, L + pad, 0, pad, h);
  const { depth } = await run(await RawImage.fromCanvas(c));
  // crop the padding back off into a plain gray canvas we can save and reuse
  const k = depth.width / c.width, out = Object.assign(document.createElement('canvas'), { width: Math.round(L * k), height: depth.height });
  const id = out.getContext('2d').createImageData(out.width, out.height), x0 = Math.round(pad * k);
  for (let y = 0; y < out.height; y++) for (let i = 0; i < out.width; i++) {
    const v = depth.data[(y * depth.width + i + x0) * depth.channels], o = (y * out.width + i) * 4;
    id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
  }
  out.getContext('2d').putImageData(id, 0, 0);
  return out;
}

const R = 4, EYE = 1.55, CEIL = 1.35, PULL = 0.5;

export function makeRoom(host, { pano, depth, tags = [] }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 60);

  // depth sampler on the loop: 0 far .. 1 near; a gentle 3x3 average hides the model's noise
  // (the room can open before depth is ready: it starts as a plain round room and settles into shape)
  let dAt = () => 0.2, avg = 0.2;
  function useDepth(d) {
    if (!d) return;
    const dw = d.width, dh = d.height, dd = d.getContext('2d').getImageData(0, 0, dw, dh).data;
    dAt = (u, vb) => {
      let s = 0;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
        const i = ((Math.floor(u * dw) + a) % dw + dw) % dw, j = Math.max(0, Math.min(dh - 1, Math.floor(vb * dh) + b));
        s += dd[(j * dw + i) * 4];
      }
      return s / 49 / 255;
    };
    // the band's average depth, used toward the poles
    avg = 0; for (let i = 0; i < 64; i++) avg += dAt(i / 64, 0.5) / 64;
  }
  useDepth(depth);

  // direction (u around, v up) -> point in the room
  const point = (u, v, out = new THREE.Vector3()) => {
    const lon = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
    const vb = (1 - v - (1 - BAND) / 2) / BAND; // 0 top of the painting .. 1 bottom
    const inBand = Math.max(0, Math.min(1, vb)), edge = Math.min(1, Math.max(0, vb < 0 ? -vb * 3 : vb > 1 ? (vb - 1) * 3 : 0));
    const near = dAt(u, inBand) * (1 - edge) + avg * edge;
    let r = R * (1 - PULL * near);
    const sl = Math.sin(lat);
    if (sl < -0.05) r = Math.min(r, EYE / -sl);   // the floor
    if (sl > 0.05) r = Math.min(r, CEIL / sl);    // the ceiling
    return out.set(Math.sin(lon) * Math.cos(lat) * r, Math.sin(lat) * r, -Math.cos(lon) * Math.cos(lat) * r);
  };

  const segX = 512, segY = 256;
  const geo = new THREE.PlaneGeometry(1, 1, segX, segY), pos = geo.attributes.position, uv = geo.attributes.uv, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { point(uv.getX(i), uv.getY(i), p); pos.setXYZ(i, p.x, p.y, p.z); }
  const tex = new THREE.CanvasTexture(pano);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  scene.add(new THREE.Mesh(geo, mat));
  scene.fog = new THREE.Fog(0x120d09, 7, 16);

  // tags: u around the loop, vb down the painting
  const tagAt = t => point(t.u, 1 - ((1 - BAND) / 2 + t.vb * BAND)).multiplyScalar(0.96);
  const placed = tags.map(t => ({ ...t, p: tagAt(t) }));
  let morph = null; // { from, to, t } while the room settles into its new shape

  let yaw = 0, pitch = 0, drag = null, tilt = null, walk = new THREE.Vector2(), fade = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) { yaw = drag.yaw - (e.clientX - drag.x) * 0.006; pitch = Math.max(-1.3, Math.min(1.3, drag.pitch + (e.clientY - drag.y) * 0.006)); } });
  el.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('pointercancel', () => { drag = null; });
  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  function onTilt(e) {
    if (e.alpha == null) return;
    // portrait phone: beta ~90 when upright. Yaw follows the compass heading relative to where we started.
    const a = THREE.MathUtils.degToRad(e.alpha), b = THREE.MathUtils.degToRad(e.beta);
    if (!tilt) tilt = { a, yaw };
    yaw = tilt.yaw - (a - tilt.a);
    pitch = Math.max(-1.3, Math.min(1.3, b - Math.PI / 2));
  }

  const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 82 : 70; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();

  const v = new THREE.Vector3(), f = new THREE.Vector3(), s = new THREE.Vector3();
  let listener = null, last = performance.now(), alive = true;
  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fade = Math.min(1, fade + dt / 1.6); mat.opacity = fade * fade * (3 - 2 * fade);
    if (morph) {
      morph.t = Math.min(1, morph.t + dt / 1.4);
      const k = morph.t * morph.t * (3 - 2 * morph.t), a = pos.array;
      for (let i = 0; i < a.length; i++) a[i] = morph.from[i] + (morph.to[i] - morph.from[i]) * k;
      pos.needsUpdate = true;
      placed.forEach((t, i) => t.p.lerpVectors(morph.tagFrom[i], morph.tagTo[i], k));
      if (morph.t >= 1) { geo.computeBoundingSphere(); morph = null; }
    }
    f.set(-Math.sin(-yaw), 0, -Math.cos(-yaw)); s.set(Math.cos(-yaw), 0, -Math.sin(-yaw));
    let fw = walk.y, st = walk.x;
    if (keys.has('w') || keys.has('arrowup')) fw += 1;
    if (keys.has('s') || keys.has('arrowdown')) fw -= 1;
    if (keys.has('a') || keys.has('arrowleft')) st -= 1;
    if (keys.has('d') || keys.has('arrowright')) st += 1;
    camera.position.addScaledVector(f, fw * 0.9 * dt).addScaledVector(s, st * 0.9 * dt);
    camera.position.y = 0; camera.position.clampLength(0, 1.2);
    camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    for (const t of placed) {
      if (!t.el) continue;
      v.copy(t.p).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      t.el.style.visibility = vis ? '' : 'hidden';
      if (vis) t.el.style.transform = `translate(${(v.x + 1) / 2 * host.clientWidth}px, ${(1 - v.y) / 2 * host.clientHeight}px)`;
    }
    if (listener) { listener.positionX.value = camera.position.x; listener.positionZ.value = camera.position.z; const d = new THREE.Vector3(); camera.getWorldDirection(d); listener.forwardX.value = d.x; listener.forwardY.value = d.y; listener.forwardZ.value = d.z; }
  }
  requestAnimationFrame(frame);

  return {
    tags: placed,
    // the walls behind you were painted after the room opened: swap the picture in place
    setPano(canvas) { tex.image = canvas; tex.needsUpdate = true; },
    // depth arrived after the room opened: glide every wall and label to its real distance
    setDepth(d) {
      useDepth(d);
      const to = new Float32Array(pos.array.length), q = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { point(uv.getX(i), uv.getY(i), q); to[i * 3] = q.x; to[i * 3 + 1] = q.y; to[i * 3 + 2] = q.z; }
      morph = { from: Float32Array.from(pos.array), to, t: 0, tagFrom: placed.map(t => t.p.clone()), tagTo: placed.map(tagAt) };
    },
    walk,
    tiltOn() { addEventListener('deviceorientation', onTilt); },
    tiltOff() { removeEventListener('deviceorientation', onTilt); tilt = null; },
    face(u) { yaw = (u - 0.5) * Math.PI * 2; },
    hear(ctx) { listener = ctx.listener; },
    destroy() { alive = false; renderer.dispose(); geo.dispose(); tex.dispose(); el.remove(); removeEventListener('resize', resize); removeEventListener('deviceorientation', onTilt); },
  };
}
