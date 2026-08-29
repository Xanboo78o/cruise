// world/oo.js — the Oo. Eight hundred of them, each with a name, a shape, a
// home, a job, a car and a favourite race. Indestructible, which is why the
// whole planet is motorsport-mad. Deterministic from a seed, so Boo Zimble
// lives in the same house every time you visit.

import { DISTRICTS, ROADS, ROAD_TYPES } from './spec.js';
import { RACES } from './races.js';
import { CAR_ORDER } from '../presets.js';

export const VARIANTS = ['oobi', 'oodi', 'ooli', 'oopi', 'oozi'];

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const FIRST = ['Boo', 'Ozz', 'Pim', 'Zib', 'Loo', 'Dodo', 'Kip', 'Mo', 'Noo', 'Pib', 'Quo', 'Roz', 'Soo', 'Tib', 'Ubo', 'Vim', 'Wob', 'Yoo', 'Zam', 'Obi', 'Ooli', 'Ekko', 'Fizz', 'Gub', 'Hoop', 'Izzo', 'Jub', 'Kloo', 'Lolo', 'Mib', 'Nim', 'Oop', 'Pozz', 'Rimi', 'Sib', 'Tozz', 'Umi', 'Voo', 'Wizz', 'Zoob'];
const LAST = ['Zimble', 'Pitkin', 'Oozer', 'Bonk', 'Wobblet', 'Gloop', 'Skidmore', 'Driftwood', 'Honk', 'Fumble', 'Bibble', 'Tumbler', 'Clutch', 'Redline', 'Apex', 'Kerb', 'Tarmac', 'Nitro', 'Slipstream', 'Hairpin', 'Undercut', 'Overbake', 'Bounce', 'Squeak', 'Muffler', 'Chicane', 'Podium', 'Grid', 'Pitlane', 'Lockup'];
const JOBS = { downtown: ['office Oo', 'barista', 'sign painter', 'tyre fitter', 'DJ'], harbor: ['harbourmaster', 'net mender', 'crane Oo', 'fish counter'], docks: ['crane Oo', 'box stacker', 'forklift ace', 'night watch'], beach: ['lifeguard', 'ice cream Oo', 'umbrella guy', 'surf coach'], speedway: ['marshal', 'tyre changer', 'burger flipper', 'flag waver'], airfield: ['tower Oo', 'baggage Oo', 'pilot', 'plane washer'], mine: ['digger', 'lamp lighter', 'cart pusher'], subW: ['gardener', 'postie', 'dog walker'], subE: ['gardener', 'postie', 'dog walker'] };

export class Population {
  constructor(T, count = 800, seed = 78) {
    this.T = T;
    const rnd = mulberry(seed);
    const homesIn = DISTRICTS.filter(d => d.fill === 'houses' || d.fill === 'towers');
    const worksIn = DISTRICTS.filter(d => ['towers', 'harbor', 'docks', 'beach', 'speedway', 'airfield', 'mine'].includes(d.fill));
    // candidate spots: beside streets inside a district, off the tarmac
    const spotsFor = (d) => {
      const out = [];
      for (const r of T.roads) {
        if (r.type !== 'street' && r.type !== 'blvd') continue;
        for (let s = 20; s < r.L; s += 26) {
          const p = T.pointAt(r, s);
          for (const side of [-1, 1]) {
            const x = p.x + p.tz * side * (r.T.w / 2 + 6), z = p.z - p.tx * side * (r.T.w / 2 + 6);
            if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) out.push([x, z]);
          }
        }
      }
      return out;
    };
    const homeSpots = homesIn.map(d => ({ d, spots: spotsFor(d) })).filter(h => h.spots.length);
    const workSpots = worksIn.map(d => ({ d, spots: spotsFor(d) })).filter(w => w.spots.length);
    // a blank world (the map maker): everyone lives and works at the square until there are streets
    if (!homeSpots.length) homeSpots.push({ d: { id: 'downtown' }, spots: [[0, -820]] });
    if (!workSpots.length) workSpots.push({ d: { id: 'downtown' }, spots: [[40, -820]] });
    const used = new Set();
    this.list = [];
    for (let i = 0; i < count; i++) {
      let name; do { name = FIRST[Math.floor(rnd() * FIRST.length)] + ' ' + LAST[Math.floor(rnd() * LAST.length)]; if (used.has(name)) name += ' ' + ['II', 'III', 'Jr', 'Sr', 'IV'][Math.floor(rnd() * 5)]; } while (used.has(name)); used.add(name);
      const h = homeSpots[Math.floor(rnd() * homeSpots.length)], home = h.spots[Math.floor(rnd() * h.spots.length)];
      const w = workSpots[Math.floor(rnd() * workSpots.length)], work = w.spots[Math.floor(rnd() * w.spots.length)];
      const jobs = JOBS[w.d.id] || JOBS.downtown;
      this.list.push({
        id: i, name, variant: VARIANTS[Math.floor(rnd() * VARIANTS.length)],
        home: { district: h.d.id, x: home[0], z: home[1] }, work: { district: w.d.id, x: work[0], z: work[1] },
        job: jobs[Math.floor(rnd() * jobs.length)],
        car: CAR_ORDER[Math.floor(rnd() * CAR_ORDER.length)],
        race: RACES[Math.floor(rnd() * RACES.length)].id,
        shift: [6 + Math.floor(rnd() * 4), 15 + Math.floor(rnd() * 5)],  // start 6-9, end 15-19
        fan: rnd() < 0.55, pace: 0.8 + rnd() * 0.4, tint: rnd(),
      });
    }
  }

  // where an Oo is at a given hour (0-24). Returns {state, x, z, dir}
  whereIs(a, hour, raceGate) {
    const [s0, s1] = a.shift;
    const H = ((hour % 24) + 24) % 24;
    const between = (x0, z0, x1, z1, t) => ({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dir: Math.atan2(x1 - x0, z1 - z0) });
    if (H >= s0 - 1 && H < s0) return { state: 'commute', ...between(a.home.x, a.home.z, a.work.x, a.work.z, H - (s0 - 1)) };
    if (H >= s0 && H < s1) return { state: 'work', x: a.work.x, z: a.work.z, dir: 0 };
    if (H >= s1 && H < s1 + 1) return { state: 'commute', ...between(a.work.x, a.work.z, a.home.x, a.home.z, H - s1) };
    if (a.fan && raceGate && H >= s1 + 1 && H < 23) return { state: 'race', x: raceGate[0], z: raceGate[1], dir: 0 };
    return { state: 'home', x: a.home.x, z: a.home.z, dir: 0 };
  }

  // everyone within `radius` of a point right now
  near(x, z, radius, hour, raceGate) {
    const out = [], r2 = radius * radius;
    for (const a of this.list) {
      const w = this.whereIs(a, hour, raceGate);
      const dx = w.x - x, dz = w.z - z;
      if (dx * dx + dz * dz < r2) out.push({ a, ...w });
    }
    return out;
  }

  fansOf(raceId) { return this.list.filter(a => a.fan && a.race === raceId); }
}
