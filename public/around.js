// "Around me": turns a stream of camera frames into short spoken news about what's NEW around a blind
// person as they turn: "Watch out: chair, 2 steps ahead.", "One person spotted, to your right.",
// "Two more people, ahead." It keeps a small world list so turning back never repeats old news.
// With a compass heading, things are placed by bearing all the way round; without one, by recent
// sightings in the frame. ponytail: English only for now; Paper mode carries the 4 languages.

const BUCKET = { person: 14, door: 30, stairs: 30, obstacle: 22, furniture: 22 }; // same thing if within ± this many degrees
const words = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
const steps = n => `about ${words(n)} step${n === 1 ? '' : 's'}`; // a guess from one camera, said as one
const side = x => (x < 0.35 ? 'to your left' : x > 0.65 ? 'to your right' : 'ahead');
const angle = d => ((d % 360) + 360) % 360;
const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function makeAround({ hfov = 60 } = {}) {
  const world = []; // { kind, label, bearing|null, x, steps, at }
  const warned = new Map(); // label -> time of the last in-path warning
  let crowd = { n: 0, at: 0 }; // no compass: the most people seen in one frame lately

  const bearingOf = (heading, x) => (heading == null ? null : angle(heading + (x - 0.5) * hfov));
  function known(kind, bearing, x, now, seen) {
    return seen.find(w => w.kind === kind && (bearing != null && w.bearing != null
      ? gap(w.bearing, bearing) <= BUCKET[kind]
      : Math.abs(w.x - x) < 0.15 && now - w.at < 12000));
  }

  return {
    world,
    // items: [{kind,label,x 0-1,steps,inPath}] from /api/around; heading in degrees or null.
    update(items, heading, now = Date.now()) {
      const say = [];
      let hazard = false;
      // 1. Anything in the path, within 3 steps: always first, repeated at most every 6 s.
      for (const i of items.filter(i => i.inPath && i.steps <= 3).sort((a, b) => a.steps - b.steps).slice(0, 1)) {
        if (!warned.has(i.label) || now - warned.get(i.label) > 6000) {
          warned.set(i.label, now);
          hazard = true;
          say.push(`Watch out: ${i.label}, ${steps(i.steps)} ahead.`);
        }
      }
      // 2. New people, counted together.
      const fresh = [], seen = world.slice(); // match against earlier frames only: two people side by side are two people
      for (const i of items) {
        const b = bearingOf(heading, i.x), old = known(i.kind, b, i.x, now, seen);
        if (old) { Object.assign(old, { steps: i.steps, at: now, x: i.x, bearing: b ?? old.bearing }); continue; }
        const w = { kind: i.kind, label: i.label, bearing: b, x: i.x, steps: i.steps, at: now };
        world.push(w);
        fresh.push(w);
      }
      let people = fresh.filter(w => w.kind === 'person');
      if (heading == null) {
        // No compass: the same people come back into view as the phone sweeps, so only a bigger crowd is news.
        const inView = items.filter(i => i.kind === 'person');
        const recent = now - crowd.at < 30000 ? crowd.n : 0;
        people = inView.length > recent ? inView.slice(recent).map(i => ({ x: i.x })) : [];
        if (inView.length >= recent) crowd = { n: inView.length, at: now };
        else crowd.at = now;
        const extra = world.filter(w => w.kind === 'person').length - Math.max(recent, inView.length);
        if (extra > 0) for (const w of world.filter(w => w.kind === 'person').slice(0, extra)) world.splice(world.indexOf(w), 1); // keep the count honest
      }
      if (people.length) {
        const before = heading == null ? crowd.n - people.length : world.filter(w => w.kind === 'person').length - people.length;
        const where = side(people.reduce((a, p) => a + p.x, 0) / people.length);
        const n = people.length;
        say.push(before === 0
          ? `${n === 1 ? 'One person' : `${words(n)} people`} spotted, ${where}.`.replace(/^\w/, c => c.toUpperCase())
          : `${n === 1 ? 'Another person' : `${words(n)} more people`}, ${where}.`.replace(/^\w/, c => c.toUpperCase()));
      }
      // 3. New doors and stairs (always worth saying), then at most one other new thing per frame.
      const things = fresh.filter(w => w.kind !== 'person' && !items.some(i => i.inPath && i.label === w.label && hazard));
      const order = ['stairs', 'door', 'obstacle', 'furniture'];
      things.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.steps - b.steps);
      for (const w of things.filter(w => w.kind === 'stairs' || w.kind === 'door').concat(things.filter(w => w.kind !== 'stairs' && w.kind !== 'door').slice(0, 1))) {
        say.push(`${w.label.replace(/^\w/, c => c.toUpperCase())}, ${side(w.x)}, ${steps(w.steps)}.`);
      }
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
        const key = w.kind === 'person' ? 'person' : w.label.toLowerCase();
        const g = groups.get(key) || { n: 0, w, places: new Set() };
        g.n++; const p = where(w); if (p) g.places.add(p);
        groups.set(key, g);
      }
      const parts = [...groups.entries()].sort(([a], [b]) => (a === 'person' ? -1 : b === 'person' ? 1 : 0)).slice(0, 6).map(([key, g]) => {
        const name = key === 'person' ? (g.n === 1 ? 'one person' : `${words(g.n)} people`) : g.n === 1 ? `a ${key}` : `${words(g.n)} ${key}s`;
        return g.places.size ? `${name} ${[...g.places].join(' and ')}` : name;
      });
      return `Around you: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
    },
  };
}
