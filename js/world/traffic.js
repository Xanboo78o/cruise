// world/traffic.js — cars on the road network with an Oo in each. A follower
// picks a road, drives it at the limit (a bit under, a bit over — it's the Oo),
// and at the end picks another road that starts nearby. They brake for whatever
// is in front and they never fight you for the racing line, because they don't
// know it exists. Real Cars on the real physics, so you can bump them.

import { Car } from '../car.js';
import { PRESETS } from '../presets.js';
import { AUTO_AIDS } from '../driver.js';

export class Traffic {
  // T: WorldTerrain; population: to name the drivers; count: how many at once
  constructor(T, population, count = 24) {
    this.T = T; this.pop = population; this.count = count;
    this.list = [];
    this.junctions = this.buildJunctions();
  }

  // which roads touch which: for each road end, the roads whose ends (or middles) are within 30 m
  buildJunctions() {
    const J = new Map();
    const T = this.T;
    for (const r of T.roads) {
      for (const end of [0, 1]) {
        const p = end ? T.pointAt(r, r.L) : T.pointAt(r, 0);
        const opts = [];
        for (const o of T.roads) {
          if (o === r || o.type === 'sand' || o.type === 'pier') continue;
          const n = this.nearestOn(o, p.x, p.z);
          if (n.d < 30) opts.push({ road: o, s: n.s });
        }
        J.set(r.idx + ':' + end, opts);
      }
    }
    return J;
  }

  nearestOn(road, x, z) {
    let best = { d: 1e9, s: 0 };
    for (const g of road.seg) {
      const dx = g.x2 - g.x1, dz = g.z2 - g.z1, l2 = g.l * g.l || 1;
      let t = ((x - g.x1) * dx + (z - g.z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
      const px = g.x1 + dx * t, pz = g.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { d, s: g.s0 + t * g.l };
    }
    return best;
  }

  // a new follower somewhere on a road near (x, z) but not too near
  spawnNear(x, z, env, exclude) {
    const roads = this.T.roads.filter(r => r.type !== 'sand' && r.type !== 'pier' && r.type !== 'mine' && r.type !== 'canyon');
    if (!roads.length) return null;
    for (let tries = 0; tries < 30; tries++) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      const s = Math.random() * r.L;
      const p = this.T.pointAt(r, s);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 120 || d > 700) continue;
      if (exclude && exclude.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 25)) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const lane = dir * (r.T.w * 0.25);                        // keep right (sim right = +lat)
      const oo = this.pop.list[Math.floor(Math.random() * this.pop.list.length)];
      const id = PRESETS[oo.car] ? oo.car : 'street';
      const car = new Car(id, PRESETS);
      const yaw = Math.atan2(p.tx * dir, p.tz * dir);
      car.reset(p.x + p.tz * lane, p.z - p.tx * lane, yaw, this.T.height(p.x, p.z) + 0.3);
      for (let i = 0; i < 40; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, AUTO_AIDS);
      return { car, road: r, s, dir, lane, oo, mesh: null, out: {}, want: 0.75 + Math.random() * 0.35 };
    }
    return null;
  }

  // keep the roads around the player populated
  populate(x, z, env, others) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (Math.hypot(f.car.x - x, f.car.z - z) > 900) { if (f.mesh && this.onRemove) this.onRemove(f); this.list.splice(i, 1); }
    }
    while (this.list.length < this.count) {
      const f = this.spawnNear(x, z, env, [...others, ...this.list.map(q => q.car)]);
      if (!f) break;
      this.list.push(f);
      if (this.onAdd) this.onAdd(f);
    }
  }

  step(dt, env, others) {
    const T = this.T;
    for (const f of this.list) {
      const c = f.car, r = f.road;
      // progress along the road from where the car actually is
      const n = this.nearestOn(r, c.x, c.z);
      f.s = n.s;
      const atEnd = f.dir > 0 ? f.s > r.L - 12 : f.s < 12;
      if (atEnd) {
        const opts = this.junctions.get(r.idx + ':' + (f.dir > 0 ? 1 : 0)) || [];
        if (opts.length) {
          const pick = opts[Math.floor(Math.random() * opts.length)];
          f.road = pick.road; f.s = pick.s;
          // which way along the new road? away from where we came from
          const p0 = T.pointAt(pick.road, Math.max(0, pick.s - 20)), p1 = T.pointAt(pick.road, Math.min(pick.road.L, pick.s + 20));
          const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
          f.dir = ((p1.x - p0.x) * fx + (p1.z - p0.z) * fz) >= 0 ? 1 : -1;
          f.lane = f.dir * (pick.road.T.w * 0.25);
        } else f.dir = -f.dir;                                  // dead end: turn round
      }
      // look-ahead target on the lane
      const look = 9 + c.speed * 0.9;
      const ts = Math.max(0, Math.min(f.road.L, f.s + f.dir * look));
      const p = T.pointAt(f.road, ts);
      const tx = p.x + p.tz * f.lane, tz = p.z - p.tx * f.lane;
      const dx = tx - c.x, dz = tz - c.z;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const right = dx * cy - dz * sy, fwd = dx * sy + dz * cy;
      const alpha = Math.atan2(right, Math.max(fwd, 1));
      let steer = Math.max(-1, Math.min(1, (2 * Math.sin(alpha) / Math.max(4, Math.hypot(dx, dz))) * (c.p.lf + c.p.lr) / c.maxSteerNow(c.speed) * 1.2));
      // speed: the limit, scaled by the driver's mood; slow for bends and for whoever is ahead
      let target = f.road.T.speed / 2.237 * f.want;
      const bend = Math.abs(alpha);
      target *= 1 - Math.min(0.6, bend * 1.4);
      for (const o of others) {
        if (o === c) continue;
        const ox = o.x - c.x, oz = o.z - c.z;
        const ahead = ox * sy + oz * cy, side = Math.abs(ox * cy - oz * sy);
        if (ahead > 0 && ahead < 14 + c.speed * 1.2 && side < 4) target = Math.min(target, Math.max(0, o.speed - 1) * (ahead < 8 ? 0 : 0.9));
      }
      for (const g of this.list) {
        if (g === f) continue; const o = g.car;
        const ox = o.x - c.x, oz = o.z - c.z;
        const ahead = ox * sy + oz * cy, side = Math.abs(ox * cy - oz * sy);
        if (ahead > 0 && ahead < 12 + c.speed * 1.1 && side < 3.5) target = Math.min(target, Math.max(0, o.speed - 0.5) * (ahead < 7 ? 0 : 0.9));
      }
      const dv = target - c.speed;
      const inp = { steer, throttle: dv > 0.3 ? Math.min(0.8, 0.2 + dv * 0.25) : 0, brake: dv < -1 ? Math.min(1, -dv * 0.3) : 0, handbrake: 0 };
      f.out = inp;
      c.step(dt, inp, env, AUTO_AIDS);
    }
  }

  get cars() { return this.list.map(f => f.car); }
}
