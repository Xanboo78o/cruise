// world/terrain.js — ONE height field for all of San Oozi. Mountain to the
// north, sea to the south, the canyon carved through, districts flattened to
// plateaus, and every road cut or filled into the land along its own line.
// The road mesh, the wheels and the trees all ask this.

import { WORLD, ROAD_TYPES, COAST, DISTRICTS, CANYON, ROADS } from './spec.js';
import { vnoise } from '../terrain.js';
import { resample } from '../track.js';

const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// distance from a point to a polyline; also the closest point and its t
function nearestOnPolyline(pts, x, z) {
  let best = { d2: 1e18 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
    const px = x1 + dx * t, pz = z1 + dz * t;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < best.d2) best = { d2, i, t, px, pz };
  }
  return best;
}

export class WorldTerrain {
  constructor() {
    this.roads = ROADS.map((r, idx) => ({ ...r, idx, T: ROAD_TYPES[r.type], seg: this.segments(r.pts) }));
    this.buildRoadGrid();
    this.bakeRoadHeights();
  }

  // every road is a smooth curve through its hand-placed points, not a
  // polygon: centripetal Catmull-Rom, densified to 4 m
  segments(rawPts) {
    const dense = rawPts.length > 2 ? resample(rawPts.map(([x, z]) => ({ x, z, y: 0 })), false, 4) : rawPts.map(([x, z]) => ({ x, z }));
    const pts = dense.map(p => [p.x, p.z]);
    const out = []; let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const l = Math.hypot(x2 - x1, z2 - z1);
      out.push({ x1, z1, x2, z2, l, s0: s });
      s += l;
    }
    return out;
  }

  // ---------------------------------------------------------------- base land
  // the lie of the land before anyone built on it
  base(x, z) {
    // distance north of the coast line (negative = at sea)
    const c = nearestOnPolyline(COAST, x, z);
    const seaward = (z - c.pz) < 0 && c.d2 > 0 ? -Math.sqrt(c.d2) : Math.sqrt(c.d2);
    // the coastal shelf: sea floor drops away, land rises gently inland
    let y;
    if (seaward < 0) y = -4 - Math.min(40, -seaward * 0.08);
    else y = 3 + Math.min(1, seaward / 60) * 6;
    // west coast is cliffs
    const cliff = sm((-1900 - x) / 700) * sm(seaward / 40) * 42;
    y += cliff;
    // foothills and the mountain
    const mtn = sm((z - 350) / 2100) * 440 * (1 - 0.3 * Math.abs(x) / 3000);
    y += mtn;
    // rolling land everywhere — small, so the forest reads as forest, not fields
    y += (vnoise(x * 0.0022 + 7.1, z * 0.0022) - 0.5) * 26 * sm(seaward / 200);
    y += (vnoise(x * 0.011, z * 0.011 + 3.3) - 0.5) * 6 * sm(seaward / 100);
    // ridge texture on the mountain
    y += (vnoise(x * 0.004, z * 0.004 + 11) - 0.5) * 90 * sm((z - 900) / 1200);
    // inland never dips into the sea: no accidental lakes
    if (seaward > 30) y = Math.max(y, 4 + Math.min(1, (seaward - 30) / 60) * 3);
    return y;
  }

  canyonCarve(x, z) {
    const cp = nearestOnPolyline(CANYON.path, x, z);
    const d = Math.sqrt(cp.d2);
    const seg = CANYON.path[cp.i], nxt = CANYON.path[cp.i + 1];
    const hw = lerp(seg[2], nxt[2], cp.t);
    if (d > hw + CANYON.wall) return 0;
    // full depth on the floor, walls rise over `wall` metres
    const k = d < hw ? 1 : 1 - sm((d - hw) / CANYON.wall);
    // the mouth opens out: depth fades over the last two legs so the floor
    // meets the land at the mine instead of ending in a pit
    const n = CANYON.path.length - 1;
    const along = (cp.i + cp.t) / n;
    const fade = 1 - sm((along - 0.55) / 0.45);
    return -CANYON.depth * k * fade;
  }

  districtAt(x, z) {
    for (const d of DISTRICTS) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d;
    return null;
  }

  // land with the canyon and the district plateaus, no roads yet
  land(x, z) {
    let y = this.base(x, z);
    const carve = this.canyonCarve(x, z);
    if (carve) y = Math.max(y + carve, 6);                 // the floor never goes under the sea
    for (const d of DISTRICTS) {
      if (d.y == null) continue;
      const m = 90;                                       // blend margin outside the rect
      if (x < d.x0 - m || x > d.x1 + m || z < d.z0 - m || z > d.z1 + m) continue;
      const ex = Math.max(0, Math.max(d.x0 - x, x - d.x1)), ez = Math.max(0, Math.max(d.z0 - z, z - d.z1));
      const k = 1 - sm(Math.hypot(ex, ez) / m);
      y = lerp(y, d.y + (vnoise(x * 0.01, z * 0.01) - 0.5) * 1.2, k);
    }
    return y;
  }

  // ------------------------------------------------------------ road heights
  // each road gets a height along its length: the land, low-passed so it
  // doesn't jitter, unless the road says otherwise (pier, canyon, trench)
  bakeRoadHeights() {
    for (const r of this.roads) {
      const step = 10;
      const L = r.seg.length ? r.seg[r.seg.length - 1].s0 + r.seg[r.seg.length - 1].l : 0;
      const n = Math.max(2, Math.ceil(L / step) + 1);
      const ys = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = this.pointAt(r, (i / (n - 1)) * L);
        if (typeof r.y === 'number') ys[i] = r.y;
        else if (r.y === 'trench') ys[i] = this.land(p.x, p.z) - 9;
        else ys[i] = this.land(p.x, p.z);
      }
      // grade clamp: a road climbs at most `gMax` — the land gets cut and
      // filled around it, which is what real roads do to hills
      const gMax = (r.type === 'canyon' || r.type === 'gravel') ? 0.10 : r.type === 'highway' ? 0.07 : 0.12;
      if (typeof r.y !== 'number') {
        for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i - 1] - gMax * step, Math.min(ys[i - 1] + gMax * step, ys[i]));
        for (let i = n - 2; i >= 0; i--) ys[i] = Math.max(ys[i + 1] - gMax * step, Math.min(ys[i + 1] + gMax * step, ys[i]));
      }
      // smooth: a wide box blur, twice
      for (let pass = 0; pass < 2; pass++) {
        const out = new Float32Array(n);
        const w = typeof r.y === 'number' ? 0 : 6;
        for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < n) { s += ys[j]; c++; } } out[i] = s / c; }
        ys.set(out);
      }
      r.ys = ys; r.L = L; r.step = L / (n - 1);
    }
  }

  pointAt(r, s) {
    let seg = r.seg[r.seg.length - 1];
    for (const g of r.seg) if (s <= g.s0 + g.l) { seg = g; break; }
    const t = seg.l > 0 ? Math.max(0, Math.min(1, (s - seg.s0) / seg.l)) : 0;
    return { x: seg.x1 + (seg.x2 - seg.x1) * t, z: seg.z1 + (seg.z2 - seg.z1) * t, tx: (seg.x2 - seg.x1) / (seg.l || 1), tz: (seg.z2 - seg.z1) / (seg.l || 1) };
  }

  roadY(r, s) {
    const i = Math.max(0, Math.min(r.ys.length - 1, s / r.step));
    const a = Math.floor(i), b = Math.min(r.ys.length - 1, a + 1), t = i - a;
    return r.ys[a] + (r.ys[b] - r.ys[a]) * t;
  }

  // ---------------------------------------------------------- spatial grid
  buildRoadGrid() {
    const cell = 120;
    this.g = { cell, x0: WORLD.minX, z0: WORLD.minZ };
    this.g.w = Math.ceil((WORLD.maxX - WORLD.minX) / cell) + 1;
    this.g.h = Math.ceil((WORLD.maxZ - WORLD.minZ) / cell) + 1;
    this.g.cells = new Array(this.g.w * this.g.h).fill(null).map(() => []);
    for (const r of this.roads) {
      const reach = r.T.w / 2 + r.T.cut + 40;
      for (let si = 0; si < r.seg.length; si++) {
        const g = r.seg[si];
        const minX = Math.min(g.x1, g.x2) - reach, maxX = Math.max(g.x1, g.x2) + reach;
        const minZ = Math.min(g.z1, g.z2) - reach, maxZ = Math.max(g.z1, g.z2) + reach;
        for (let gz = Math.floor((minZ - this.g.z0) / cell); gz <= Math.floor((maxZ - this.g.z0) / cell); gz++)
          for (let gx = Math.floor((minX - this.g.x0) / cell); gx <= Math.floor((maxX - this.g.x0) / cell); gx++)
            if (gx >= 0 && gz >= 0 && gx < this.g.w && gz < this.g.h) this.g.cells[gz * this.g.w + gx].push([r.idx, si]);
      }
    }
  }

  // nearest road to a point: { road, d, s, lat, x, z, tx, tz }
  nearestRoad(x, z) {
    const gx = Math.floor((x - this.g.x0) / this.g.cell), gz = Math.floor((z - this.g.z0) / this.g.cell);
    if (gx < 0 || gz < 0 || gx >= this.g.w || gz >= this.g.h) return null;
    let best = null;
    for (const [ri, si] of this.g.cells[gz * this.g.w + gx]) {
      const r = this.roads[ri], g = r.seg[si];
      const dx = g.x2 - g.x1, dz = g.z2 - g.z1, l2 = g.l * g.l || 1;
      let t = ((x - g.x1) * dx + (z - g.z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
      const px = g.x1 + dx * t, pz = g.z1 + dz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      // rank by distance beyond the road's own half width, so a wide road wins a tie
      const over = Math.sqrt(d2) - r.T.w / 2;
      if (!best || over < best.over) {
        const tx = dx / (g.l || 1), tz = dz / (g.l || 1);
        best = { road: r, over, d: Math.sqrt(d2), s: g.s0 + t * g.l, x: px, z: pz, tx, tz, nx: tz, nz: -tx, lat: (x - px) * tz + (z - pz) * -tx };
      }
    }
    return best;
  }

  // ----------------------------------------------------------- the answer
  height(x, z) {
    const land = this.land(x, z);
    const n = this.nearestRoad(x, z);
    if (!n) return land;
    const r = n.road, hw = r.T.w / 2, cut = r.T.cut;
    if (n.d > hw + cut) return land;
    const ry = this.roadY(r, n.s);
    if (r.type === 'pier') return n.d <= hw ? ry : land;    // a pier stands on legs, it doesn't shape the beach
    if (n.d <= hw) return ry;
    // shoulder: blends from the road's height to the land over `cut` metres,
    // with a small kerb lip so the edge reads
    const k = sm((n.d - hw) / cut);
    return lerp(ry + 0.06, land, k);
  }

  surfaceAt(x, z) {
    const n = this.nearestRoad(x, z);
    const land = this.districtAt(x, z);
    if (n && n.d <= n.road.T.w / 2) return { name: n.road.T.surf, road: n, grip: n.road.T.surf === 'gravel' ? 0.66 : n.road.T.surf === 'sand' ? 0.5 : 1, bump: n.road.T.surf === 'gravel' ? 0.05 : 0.003, drag: 1, accel: 1, slope: 0 };
    if (n && n.d <= n.road.T.w / 2 + 1.5) return { name: 'kerb', road: n, grip: 0.92, bump: 0.04, drag: 1.05, accel: 0.95, slope: 0 };
    if (land && land.fill === 'beach') return { name: 'sand', road: n, grip: 0.5, bump: 0.05, drag: 2.0, accel: 0.55, slope: 0 };
    if (this.base(x, z) < 0.5 && !this.canyonCarve(x, z)) return { name: 'water', road: n, grip: 0.2, bump: 0.02, drag: 6, accel: 0.2, slope: 0 };
    return { name: 'forest', road: n, grip: 0.5, bump: 0.12, drag: 2.6, accel: 0.4, slope: 0 };
  }
}
