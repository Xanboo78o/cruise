// track.js — turns a hand-drawn list of control points into a drivable track:
// a resampled centerline, a solved racing line, a speed profile (where to brake),
// and a lookup grid so the car can ask "what am I standing on?" in O(1).

import { Terrain } from './terrain.js';

const G = 9.81;

// Centripetal Catmull-Rom (Barry-Goldman form). The uniform version cusps and
// overshoots wherever a 40 m straight meets a 10 m corner step — which is every
// corner entry on these tracks. Centripetal parameterisation just doesn't.
function crPoint(p0, p1, p2, p3, t) {
  const knot = (a, b, prev) => prev + Math.max(1e-4, Math.hypot(b.x - a.x, b.z - a.z)) ** 0.5;
  const t0 = 0, t1 = knot(p0, p1, t0), t2 = knot(p1, p2, t1), t3 = knot(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => {
    const d = tb - ta || 1e-6, w = (tb - tt) / d, v = (tt - ta) / d;
    return { x: a.x * w + b.x * v, z: a.z * w + b.z * v, y: (a.y || 0) * w + (b.y || 0) * v };
  };
  const A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
  const B1 = mix(A1, A2, t0, t2), B2 = mix(A2, A3, t1, t3);
  return mix(B1, B2, t1, t2);
}

// Resample control points into evenly spaced samples (~`spacing` metres apart).
export function resample(pts, closed, spacing = 2) {
  const n = pts.length;
  const at = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const dense = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const approx = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(6, Math.ceil(approx / spacing) * 3);
    for (let s = 0; s < steps; s++) dense.push(crPoint(p0, p1, p2, p3, s / steps));
  }
  if (!closed) dense.push({ ...at(n - 1), y: at(n - 1).y || 0 });

  // walk the dense polyline and drop a sample every `spacing` metres
  const out = [];
  let carry = 0;
  out.push({ ...dense[0] });
  for (let i = 1; i < dense.length + (closed ? 1 : 0); i++) {
    const a = dense[(i - 1) % dense.length], b = dense[i % dense.length];
    let seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  if (closed && out.length > 1) {
    // second pass: the loop rarely divides evenly by `spacing`, and the leftover
    // stub at the seam shows up later as a fake 1 m radius corner. Re-walk the
    // polyline with a spacing that divides the total length exactly.
    let total = 0;
    for (let i = 0; i < out.length; i++) {
      const b = out[(i + 1) % out.length];
      total += Math.hypot(b.x - out[i].x, b.z - out[i].z);
    }
    const exact = total / Math.round(total / spacing);
    const even = [{ ...out[0] }];
    let carry = 0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-6) continue;
      let d = exact - carry;
      while (d <= seg) {
        const t = d / seg;
        even.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t });
        d += exact;
      }
      carry = seg - (d - exact);
    }
    const f = even[0], l = even[even.length - 1];
    if (even.length > 2 && Math.hypot(f.x - l.x, f.z - l.z) < exact * 0.5) even.pop();
    return even;
  }
  return out;
}

// Tangent / normal / curvature for every sample.
export function differentiate(s, closed) {
  const n = s.length;
  const at = i => s[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n; i++) {
    const a = at(i - 1), b = s[i], c = at(i + 1);
    const tx = c.x - a.x, tz = c.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    b.tx = tx / len; b.tz = tz / len;
    b.nx = b.tz; b.nz = -b.tx;                 // right-hand normal
    // Menger curvature over a 6 m baseline. Exact for a circular arc at any
    // spacing, and it ignores the metre-scale wobble a 2 m stencil trips on.
    const e = at(i - 3), f = at(i + 3);
    const d1 = Math.hypot(b.x - e.x, b.z - e.z), d2 = Math.hypot(f.x - b.x, f.z - b.z), d3 = Math.hypot(f.x - e.x, f.z - e.z);
    const area = (b.x - e.x) * (f.z - e.z) - (f.x - e.x) * (b.z - e.z);
    b.k = (d1 * d2 * d3) > 1e-6 ? -(2 * area) / (d1 * d2 * d3) : 0;  // signed: + = turning right (matches yaw rate)
    b.grade = (f.y - e.y) / (d3 || 1);
  }
  let dist = 0;
  for (let i = 0; i < n; i++) {
    s[i].s = dist;
    const c = at(i + 1);
    dist += Math.hypot(c.x - s[i].x, c.z - s[i].z);
  }
  return dist;
}

// Iterative curvature minimisation inside the track corridor.
// Not a true optimal line, but it cuts apexes the way you'd want to drive it —
// which is exactly what it's for: something to chase and compare against.
export function solveLine(center, halfWidth, closed, margin = 1.6, iters = 900) {
  const n = center.length;
  const lat = new Float32Array(n);
  const lim = Math.max(0.2, halfWidth - margin);
  const at = i => (i + n) % n;
  const pt = i => {
    const c = center[at(i)];
    return { x: c.x + c.nx * lat[at(i)], z: c.z + c.nz * lat[at(i)] };
  };
  for (let it = 0; it < iters; it++) {
    const relax = 0.28 * (1 - it / iters) + 0.06;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = pt(i - 1), b = pt(i), c = pt(i + 1);
      const mx = (a.x + c.x) / 2 - b.x, mz = (a.z + c.z) / 2 - b.z;   // pull toward the chord
      const cen = center[i];
      lat[i] += (mx * cen.nx + mz * cen.nz) * relax;
      lat[i] = Math.max(-lim, Math.min(lim, lat[i]));
    }
  }
  const line = [];
  for (let i = 0; i < n; i++) {
    const c = center[i];
    line.push({ x: c.x + c.nx * lat[i], z: c.z + c.nz * lat[i], y: c.y, lat: lat[i] });
  }
  differentiate(line, closed);
  return line;
}

// Forward/backward passes give the fastest speed you could carry everywhere,
// and the moment the two disagree is a braking point.
export function speedProfile(line, closed, opts = {}) {
  const aLat = opts.aLat ?? 16;          // m/s^2 of cornering grip — arcade rubber
  const aBrake = opts.aBrake ?? 16;
  const aAccel = opts.aAccel ?? 9;
  const vMax = opts.vMax ?? 78;
  const n = line.length;
  const v = new Float32Array(n);
  const ks = new Float32Array(n);            // 5-tap smoothing: a driver doesn't
  for (let i = 0; i < n; i++) {              // react to one metre of extra bend
    let sum = 0;
    for (let o = -2; o <= 2; o++) sum += Math.abs(line[(i + o + n) % n].k);
    ks[i] = sum / 5;
  }
  for (let i = 0; i < n; i++) v[i] = Math.min(vMax, ks[i] > 1e-5 ? Math.sqrt(aLat / ks[i]) : vMax);
  const ds = i => {
    const a = line[i], b = line[(i + 1) % n];
    return Math.hypot(b.x - a.x, b.z - a.z) || 0.01;
  };
  const passes = closed ? 3 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = n - 2; i >= (closed ? -n + 1 : 0); i--) {   // backward: braking
      const j = (i + n) % n, k = (i + 1 + n) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[k] * v[k] + 2 * aBrake * ds(j)));
    }
    for (let i = 1; i < (closed ? 2 * n : n); i++) {         // forward: power
      const j = (i + n) % n, k = (i - 1 + n) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[k] * v[k] + 2 * aAccel * ds(k)));
    }
  }
  // state per sample: 0 power, 1 hold, 2 brake
  const state = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const nx = v[(i + 1) % n];
    const dv = (nx - v[i]) / ds(i);
    state[i] = dv < -0.06 ? 2 : dv > 0.05 ? 0 : 1;
  }
  // brake points = first sample of each braking run
  const brakes = [];
  for (let i = 0; i < n; i++) {
    const prev = state[(i - 1 + n) % n];
    if (state[i] === 2 && prev !== 2) {
      let j = i, minV = v[i];
      for (let c = 0; c < n; c++) { const q = (i + c) % n; if (state[q] !== 2) break; j = q; minV = v[q]; }
      brakes.push({ i, apex: j, entry: v[i], exit: minV, dist: line[i].s });
    }
  }
  return { v, state, brakes };
}

const SURFACES = {
  road:   { grip: 1.00, drag: 1.00, accel: 1.00, bump: 0.003, name: 'road' },
  kerb:   { grip: 0.92, drag: 1.05, accel: 0.95, bump: 0.04,  name: 'kerb' },
  gravel: { grip: 0.62, drag: 1.9,  accel: 0.55, bump: 0.06,  name: 'gravel' },
  grass:  { grip: 0.50, drag: 2.6,  accel: 0.40, bump: 0.12,  name: 'grass' },
};
export { SURFACES };

export class TrackModel {
  constructor(def) {
    this.def = def;
    this.closed = def.closed !== false;
    this.halfWidth = def.width / 2;
    // layouts are drawn at a comfortable size and scaled up here: arcade speeds
    // want long straights and big radii, and the width has to grow with them
    const sc = def.scale ?? 1, ysc = def.yScale ?? 1;
    const pts = def.pts.map(q => ({ x: q.x * sc, z: q.z * sc, y: (q.y || 0) * ysc }));
    this.samples = resample(pts, this.closed, 2);
    this.length = differentiate(this.samples, this.closed);
    this.line = solveLine(this.samples, this.halfWidth, this.closed, def.lineMargin ?? 1.8);
    this.profile = speedProfile(this.line, this.closed, def.profile);
    this.buildGrid();
    this.startIndex = def.startIndex ?? 0;
    this.terrain = new Terrain(this, { rough: def.rough ?? 0.35 });
  }

  buildGrid() {
    const s = this.samples;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of s) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = this.halfWidth + 40;
    this.g = { x0: minX - pad, z0: minZ - pad, cell: 4 };
    this.g.w = Math.ceil((maxX + pad - this.g.x0) / this.g.cell) + 1;
    this.g.h = Math.ceil((maxZ + pad - this.g.z0) / this.g.cell) + 1;
    this.bounds = { minX, maxX, minZ, maxZ };
    const idx = new Int32Array(this.g.w * this.g.h);
    // seed each cell with the nearest sample by brute force over a coarse stride,
    // then refine locally — plenty fast at load, exact enough at 4 m cells
    const stride = Math.max(1, Math.floor(s.length / 260));
    for (let gz = 0; gz < this.g.h; gz++) {
      for (let gx = 0; gx < this.g.w; gx++) {
        const px = this.g.x0 + (gx + 0.5) * this.g.cell;
        const pz = this.g.z0 + (gz + 0.5) * this.g.cell;
        let best = 0, bestD = 1e18;
        for (let i = 0; i < s.length; i += stride) {
          const d = (s[i].x - px) ** 2 + (s[i].z - pz) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
        for (let i = best - stride; i <= best + stride; i++) {
          const j = (i + s.length) % s.length;
          const d = (s[j].x - px) ** 2 + (s[j].z - pz) ** 2;
          if (d < bestD) { bestD = d; best = j; }
        }
        idx[gz * this.g.w + gx] = best;
      }
    }
    this.g.idx = idx;
  }

  // nearest centerline sample + signed lateral offset (+ = right of travel)
  nearest(x, z) {
    const gx = Math.max(0, Math.min(this.g.w - 1, Math.floor((x - this.g.x0) / this.g.cell)));
    const gz = Math.max(0, Math.min(this.g.h - 1, Math.floor((z - this.g.z0) / this.g.cell)));
    const seed = this.g.idx[gz * this.g.w + gx];
    const s = this.samples;
    let best = seed, bestD = 1e18;
    for (let i = seed - 6; i <= seed + 6; i++) {
      const j = (i + s.length) % s.length;
      const d = (s[j].x - x) ** 2 + (s[j].z - z) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    const p = s[best];
    const lat = (x - p.x) * p.nx + (z - p.z) * p.nz;
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    // height interpolated along the road, not snapped to the nearest 2 m sample —
    // a snapped road is a staircase, and at speed a staircase is a launch ramp
    return { i: best, lat, along, y: p.y + p.grade * along, dist: Math.sqrt(bestD), p };
  }

  surfaceAt(x, z, near) {
    const nr = near || this.nearest(x, z);
    const a = Math.abs(nr.lat);
    const hw = this.halfWidth;
    let surf;
    if (a <= hw) surf = SURFACES.road;
    else if (a <= hw + 1.3) surf = SURFACES.kerb;
    else if (a <= hw + 9) surf = SURFACES.gravel;
    else surf = SURFACES.grass;
    return { ...surf, slope: -nr.p.grade, near: nr };
  }

  heightAt(x, z, near) {
    return this.terrain.height(x, z, near);
  }

  sampleAtDistance(d) {
    const s = this.samples;
    const i = Math.round((d / this.length) * s.length) % s.length;
    return s[(i + s.length) % s.length];
  }
}
