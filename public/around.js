// "Around me": turns a stream of camera frames into short spoken news about what's NEW around a blind
// person as they turn: "Watch out: chair, about two steps ahead.", "One person on your right.",
// "Two more people ahead.", "Door on your left." Turning back never repeats old news.
// Every line is built from a fixed vocabulary (lib/ai.js AROUND_NAMES), so allLines() can list them all
// and the natural voice can make them before they're needed: news is spoken the moment it's seen.
// With a compass heading, things are placed by bearing all the way round; without one, the same
// people are not counted twice while the phone sweeps (only a bigger crowd is news).
// ponytail: English only; Paper mode carries the 4 languages.

export const NAMES = ['person', 'chair', 'table', 'desk', 'couch', 'bed', 'door', 'stairs', 'step', 'wall', 'bag', 'box', 'cart', 'shelf', 'counter', 'plant', 'trash can', 'bench', 'pole', 'thing'];
const BUCKET = { person: 14, door: 30, stairs: 30, obstacle: 22, furniture: 22 }; // same thing within ± degrees
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = n => WORD[n] || String(n);
const cap = s => s.replace(/^\w/, c => c.toUpperCase());
const side = x => (x < 0.35 ? 'on your left' : x > 0.65 ? 'on your right' : 'ahead');
const SIDES = ['on your left', 'ahead', 'on your right'];
const angle = d => ((d % 360) + 360) % 360;
const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const nameOf = i => (i.kind === 'person' ? 'person' : NAMES.includes(i.name) && i.name !== 'person' ? i.name : 'thing');

// The exact sentences, shared by update() and allLines().
const hazardLine = (name, steps) => `Watch out: ${name}, about ${word(steps)} step${steps === 1 ? '' : 's'} ahead.`;
const peopleLine = (n, where, more) => (more
  ? (n === 1 ? `Another person ${where}.` : `${cap(word(n))} more people ${where}.`)
  : `${cap(word(n))} ${n === 1 ? 'person' : 'people'} ${where}.`);
const thingLine = (name, where) => `${cap(name)} ${where}.`;

export function allLines() {
  const out = [];
  for (const n of NAMES) for (let s = 1; s <= 3; s++) out.push(hazardLine(n, s));
  for (let n = 1; n <= 6; n++) for (const w of SIDES) out.push(peopleLine(n, w, false), peopleLine(n, w, true));
  for (const n of NAMES) if (n !== 'person') for (const w of SIDES) out.push(thingLine(n, w));
  return out;
}

export function makeAround({ hfov = 60 } = {}) {
  let fov = hfov; // set again once the lens is known (ultra-wide sees much more)
  const world = []; // { kind, name, label, bearing|null, x, steps, at }
  const warned = new Map(); // name -> time of the last in-path warning
  let crowd = { n: 0, at: 0 }; // no compass: the most people seen in one frame lately

  const bearingOf = (heading, x) => (heading == null ? null : angle(heading + (x - 0.5) * fov));
  const known = (kind, name, bearing, x, now, seen) => seen.find(w => w.kind === kind && w.name === name && (bearing != null && w.bearing != null
    ? gap(w.bearing, bearing) <= BUCKET[kind]
    : Math.abs(w.x - x) < 0.15 && now - w.at < 12000));

  return {
    world,
    set hfov(v) { fov = v; },
    // items: [{kind,name,label,x 0-1,steps,inPath}] from /api/around; heading in degrees or null.
    update(items, heading, now = Date.now()) {
      for (let k = world.length - 1; k >= 0; k--) if (now - world[k].at > 25000) world.splice(k, 1); // may have moved
      const say = [];
      let hazard = false;
      // 1. The nearest thing in the path, within 3 steps: always first, at most every 10 s per kind of thing.
      const danger = items.filter(i => i.inPath && i.steps <= 3).sort((a, b) => a.steps - b.steps)[0];
      if (danger) {
        const n = nameOf(danger);
        if (!warned.has(n) || now - warned.get(n) > 10000) {
          warned.set(n, now);
          hazard = true;
          say.push(hazardLine(n, Math.max(1, Math.min(3, danger.steps))));
        }
      }
      // 2. Match against earlier frames only: two people side by side are two people.
      const fresh = [], seen = world.slice();
      for (const i of items) {
        const name = nameOf(i), b = bearingOf(heading, i.x), old = known(i.kind, name, b, i.x, now, seen);
        if (old) { Object.assign(old, { steps: i.steps, at: now, x: i.x, label: i.label, bearing: b ?? old.bearing }); continue; }
        const w = { kind: i.kind, name, label: i.label, bearing: b, x: i.x, steps: i.steps, at: now };
        world.push(w);
        fresh.push(w);
      }
      // 3. New people, counted together.
      let people = fresh.filter(w => w.kind === 'person'), before;
      if (heading == null) {
        const inView = items.filter(i => i.kind === 'person');
        const recent = now - crowd.at < 30000 ? crowd.n : 0;
        people = inView.length > recent ? inView.slice(recent) : [];
        before = recent;
        crowd = { n: Math.max(recent, inView.length), at: now };
        // keep the world's person count equal to the biggest crowd seen, not the sum of sightings
        let extra = world.filter(w => w.kind === 'person').length - crowd.n;
        for (let k = world.length - 1; k >= 0 && extra > 0; k--) if (world[k].kind === 'person') { world.splice(k, 1); extra--; }
      } else before = world.filter(w => w.kind === 'person').length - people.length;
      if (people.length) {
        const n = Math.min(6, people.length);
        say.push(peopleLine(n, side(people.reduce((a, p) => a + p.x, 0) / people.length), before > 0));
      }
      // 4. New doors and stairs always; then at most one other new thing per look.
      const things = fresh.filter(w => w.kind !== 'person' && !(hazard && w.name === nameOf(danger)));
      const key = w => (w.kind === 'stairs' || w.kind === 'door' ? 0 : 1);
      things.sort((a, b) => key(a) - key(b) || a.steps - b.steps);
      for (const w of things.filter(w => key(w) === 0).concat(things.filter(w => key(w) === 1).slice(0, 1))) say.push(thingLine(w.name, side(w.x)));
      return { say, hazard };
    },

    // "What's around me?": everything seen so far, placed relative to where the person faces now.
    summary(heading) {
      if (!world.length) return "I haven't seen anything yet. Turn slowly so the camera can look around.";
      const where = w => {
        if (heading == null || w.bearing == null) return '';
        const d = angle(w.bearing - heading);
        return d < 30 || d > 330 ? 'ahead' : d < 150 ? 'on your right' : d < 210 ? 'behind you' : 'on your left';
      };
      const groups = new Map();
      for (const w of world) {
        const g = groups.get(w.name) || { n: 0, places: new Set() };
        g.n++; const p = where(w); if (p) g.places.add(p);
        groups.set(w.name, g);
      }
      const plural = name => (name === 'stairs' ? 'stairs' : /(x|ch|sh)$/.test(name) ? `${name}es` : `${name}s`);
      const parts = [...groups.entries()].sort(([a], [b]) => (a === 'person' ? -1 : b === 'person' ? 1 : 0)).slice(0, 6).map(([name, g]) => {
        const label = name === 'person' ? (g.n === 1 ? 'one person' : `${word(g.n)} people`) : g.n === 1 ? `a ${name}` : `${word(g.n)} ${plural(name)}`;
        return g.places.size ? `${label} ${[...g.places].join(' and ')}` : label;
      });
      return `Around you: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
    },
  };
}
