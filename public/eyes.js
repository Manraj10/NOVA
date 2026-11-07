// Nib's on-device eyes for Around me: MediaPipe's object detector (EfficientDet-Lite0) runs on the
// phone ~10 times a second, so people and furniture are spotted instantly, with no network round trip.
// The cloud model (/api/around) still adds what this can't see: doors, stairs, walls, and the scene.
// Distances are rough on purpose ("about N steps"): from where a thing meets the floor, with the phone
// held level at chest height, or from a person's height in the picture when their feet are cut off.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

// COCO classes worth saying to someone walking through a room, mapped to Around me's vocabulary.
export const COCO = {
  person: ['person', 'person'], chair: ['furniture', 'chair'], couch: ['furniture', 'couch'], bed: ['furniture', 'bed'],
  'dining table': ['furniture', 'table'], bench: ['furniture', 'bench'], 'potted plant': ['obstacle', 'plant'],
  backpack: ['obstacle', 'bag'], handbag: ['obstacle', 'bag'], suitcase: ['obstacle', 'bag'],
};
export const LOCAL_NAMES = new Set(Object.values(COCO).map(([, n]) => n));

const CHEST = 1.3, STEP = 0.7, TALL = 1.7; // metres: phone height, one step, a standing person

// Pure geometry, testable without a camera: detections in video pixels -> Around me items.
export function toItems(detections, W, H, hfovDeg) {
  const hf = (hfovDeg * Math.PI) / 180, vf = 2 * Math.atan(Math.tan(hf / 2) * (H / W));
  const fy = H / 2 / Math.tan(vf / 2);
  const out = [];
  for (const d of detections) {
    const cat = d.categories?.[0], map = cat && COCO[cat.categoryName];
    if (!map) continue;
    const b = d.boundingBox, [kind, name] = map;
    const x = (b.originX + b.width / 2) / W, bottom = b.originY + b.height;
    let metres;
    if (bottom < H * 0.97 && bottom > H / 2) metres = CHEST / Math.tan(Math.atan((bottom - H / 2) / fy)); // where it meets the floor
    else if (kind === 'person' && b.originY > H * 0.02) metres = (TALL * fy) / Math.max(1, b.height); // feet cut off: use height
    else metres = bottom >= H * 0.97 ? 0.8 : 6; // touching the bottom edge: right here; above the horizon: far
    const steps = Math.max(1, Math.min(15, Math.round(metres / STEP)));
    out.push({ kind, name, label: name, x: Math.min(1, Math.max(0, x)), steps, inPath: Math.abs(x - 0.5) < 0.17 && steps <= 3, box: b, score: cat.score });
  }
  return out;
}

// Only things seen in 3 of the last 4 detections count, so a one-frame flicker is never spoken.
export function makeSteady(frames = 4, need = 3) {
  const hist = [];
  return items => {
    hist.push(items);
    if (hist.length > frames) hist.shift();
    return items.filter(i => hist.filter(f => f.some(j => j.name === i.name && Math.abs(j.x - i.x) < 0.08)).length >= Math.min(need, hist.length));
  };
}

export async function makeEyes() {
  const { FilesetResolver, ObjectDetector } = await import(`${MP}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = delegate => ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', scoreThreshold: 0.42, maxResults: 12,
  });
  const detector = await make('GPU').catch(() => make('CPU'));
  const steady = makeSteady();
  let last = -1;
  return {
    // Call often; returns null when there's no new frame yet.
    see(video, now, hfov) {
      if (video.readyState < 2 || video.currentTime === last || !video.videoWidth) return null;
      last = video.currentTime;
      const r = detector.detectForVideo(video, now);
      return steady(toItems(r.detections || [], video.videoWidth, video.videoHeight, hfov));
    },
  };
}
