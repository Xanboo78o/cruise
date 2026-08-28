// world/routes.js — a race is a path through the road network. Given a list of
// waypoints (road name + distance, or a raw [x, z]), this walks the roads,
// samples the line every 2 m with the baked heights, and hands back something
// shaped like a TrackModel: samples, line, profile, nearest(), surfaceAt() —
// so the race, the bots, the boards and the ghost all work unchanged. Walls
// come from the route too: both edges, plus a plug across every side street.

import { differentiate, solveLine, speedProfile, SURFACES, resample } from '../track.js';

export class Route {
  // T: WorldTerrain. def: { id, name, blurb, closed, width, pts: [[x,z],...], laps, sky, walls: 'concrete'|'tyre'|'rock'|'timber' }
  constructor(T, def) {
    this.T = T; this.def = def;
    this.closed = !!def.closed;
    this.halfWidth = (def.width ?? 24) / 2;
    this.samples = this.trace(def.pts);
    this.length = differentiate(this.samples, this.closed);
    // heights along the route come from the roads, then a light smooth
    for (const s of this.samples) { const n = T.nearestRoad(s.x, s.z); s.y = n && n.d < n.road.T.w / 2 + 6 ? T.roadY(n.road, n.s) : T.height(s.x, s.z); }
    for (let pass = 0; pass < 2; pass++) {
      const ys = this.samples.map(s => s.y), n = ys.length;
      for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = this.closed ? (i + k + n) % n : i + k; if (j >= 0 && j < n) { a += ys[j]; c++; } } this.samples[i].y = a / c; }
    }
    this.length = differentiate(this.samples, this.closed);
    this.line = solveLine(this.samples, this.halfWidth, this.closed, 2.0);
    this.profile = speedProfile(this.line, this.closed, def.profile);
    this.jumps = []; this.whoops = []; this.tunnels = [];
    this.buildGrid();
    this.terrain = { height: (x, z) => this.heightAt(x, z), normal: (x, z, out = {}) => { const e = 1.6; const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z), hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e); const nx = (hL - hR) / (2 * e), nz = (hD - hU) / (2 * e), inv = 1 / Math.hypot(nx, 1, nz); out.x = nx * inv; out.y = inv; out.z = nz * inv; return out; }, bump: (x, z, surf) => (Math.sin(x * 1.35) * Math.cos(z * 1.35)) * (surf?.bump ?? 0) * 0.5 };
    this.startIndex = def.startIndex ?? 0.02;
  }

  // waypoints are [x, z]; between two waypoints we follow the nearest road's
  // own geometry when both sit on the same road, else a straight line
  trace(pts) {
    const T = this.T, out = [];
    const push = (x, z) => { const last = out[out.length - 1]; if (!last || Math.hypot(last.x - x, last.z - z) > 1.9) out.push({ x, z, y: 0 }); };
    const list = this.closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < list.length - 1; i++) {
      const [x1, z1] = list[i], [x2, z2] = list[i + 1];
      const a = T.nearestRoad(x1, z1), b = T.nearestRoad(x2, z2);
      if (a && b && a.road === b.road && Math.abs(a.s - b.s) > 2) {
        const r = a.road;
        const p0 = r.pts[0], pN = r.pts[r.pts.length - 1];
        const loop = Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 2;      // a ring road: go the short way round
        let from = a.s, to = b.s;
        if (loop) {
          const fwd = (to - from + r.L) % r.L, back = (from - to + r.L) % r.L;
          if (fwd <= back) { for (let s = 0; s <= fwd; s += 2) { const p = T.pointAt(r, (from + s) % r.L); push(p.x, p.z); } }
          else { for (let s = 0; s <= back; s += 2) { const p = T.pointAt(r, (from - s + r.L) % r.L); push(p.x, p.z); } }
        } else {
          const dir = Math.sign(to - from);
          for (let s = from; dir > 0 ? s <= to : s >= to; s += dir * 2) { const p = T.pointAt(r, s); push(p.x, p.z); }
        }
      } else {
        const L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(L / 2));
        for (let k = 0; k <= n; k++) push(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n);
      }
    }
    if (this.closed && out.length > 2) { const f = out[0], l = out[out.length - 1]; if (Math.hypot(f.x - l.x, f.z - l.z) < 3) out.pop(); }
    // junction corners: the trace jumps between roads at right angles; thin
    // it to every 12 m and spline it, so a corner becomes a corner
    let thin = out.filter((p, i) => i % 6 === 0 || (!this.closed && i === out.length - 1));
    if (this.closed && thin.length > 2) { const f = thin[0], l = thin[thin.length - 1]; if (Math.hypot(f.x - l.x, f.z - l.z) < 9) thin.pop(); }   // no seam stub
    return resample(thin, this.closed, 2);
  }

  buildGrid() {
    const s = this.samples;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of s) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pad = this.halfWidth + 60;
    this.g = { x0: minX - pad, z0: minZ - pad, cell: 6 };
    this.g.w = Math.ceil((maxX + pad - this.g.x0) / this.g.cell) + 1;
    this.g.h = Math.ceil((maxZ + pad - this.g.z0) / this.g.cell) + 1;
    this.bounds = { minX, maxX, minZ, maxZ };
    const idx = new Int32Array(this.g.w * this.g.h).fill(-1);
    // paint each sample into the cells around it (cheap, exact enough)
    const reach = Math.ceil(pad / this.g.cell);
    for (let i = 0; i < s.length; i++) {
      const gx = Math.floor((s[i].x - this.g.x0) / this.g.cell), gz = Math.floor((s[i].z - this.g.z0) / this.g.cell);
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
        const cx = gx + dx, cz = gz + dz; if (cx < 0 || cz < 0 || cx >= this.g.w || cz >= this.g.h) continue;
        const k = cz * this.g.w + cx;
        if (idx[k] < 0) idx[k] = i;
        else { const q = s[idx[k]]; const px = this.g.x0 + (cx + 0.5) * this.g.cell, pz = this.g.z0 + (cz + 0.5) * this.g.cell; if ((s[i].x - px) ** 2 + (s[i].z - pz) ** 2 < (q.x - px) ** 2 + (q.z - pz) ** 2) idx[k] = i; }
      }
    }
    this.g.idx = idx;
  }

  nearest(x, z) {
    const s = this.samples;
    const gx = Math.max(0, Math.min(this.g.w - 1, Math.floor((x - this.g.x0) / this.g.cell)));
    const gz = Math.max(0, Math.min(this.g.h - 1, Math.floor((z - this.g.z0) / this.g.cell)));
    let seed = this.g.idx[gz * this.g.w + gx]; if (seed < 0) seed = 0;
    let best = seed, bestD = 1e18;
    for (let i = seed - 8; i <= seed + 8; i++) { const j = this.closed ? (i + s.length) % s.length : Math.max(0, Math.min(s.length - 1, i)); const d = (s[j].x - x) ** 2 + (s[j].z - z) ** 2; if (d < bestD) { bestD = d; best = j; } }
    const p = s[best];
    const lat = (x - p.x) * p.nx + (z - p.z) * p.nz, along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    return { i: best, lat, along, y: p.y + p.grade * along, dist: Math.sqrt(bestD), p };
  }

  // on the route, it's the route's road; off it, it's the world
  heightAt(x, z, near) {
    const nr = near || this.nearest(x, z);
    if (Math.abs(nr.lat) <= this.halfWidth + 1.5 && nr.dist < this.halfWidth + 20) return nr.y;
    const wy = this.T.height(x, z);
    const k = Math.min(1, Math.max(0, (Math.abs(nr.lat) - this.halfWidth - 1.5) / 14));
    return nr.y * (1 - k) + wy * k;
  }
  surfaceAt(x, z, near) {
    const nr = near || this.nearest(x, z);
    const a = Math.abs(nr.lat), hw = this.halfWidth;
    const road = this.T.nearestRoad(x, z);
    const gravel = road && road.road.T.surf === 'gravel';
    if (a <= hw) return { ...(gravel ? SURFACES.gravel : SURFACES.road), slope: -nr.p.grade, near: nr };
    if (a <= hw + 1.3) return { ...SURFACES.kerb, slope: -nr.p.grade, near: nr };
    return { ...SURFACES.grass, slope: 0, near: nr };
  }
  sampleAtDistance(d) { const s = this.samples; const i = Math.round((d / this.length) * s.length) % s.length; return s[(i + s.length) % s.length]; }
}
