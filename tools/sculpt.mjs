// tools/sculpt.mjs <concept.json> [out=assets/city/sanoozi.json] — turn a marked
// map into the world. The concept file is what I transcribe from Adam's
// sketches: peaks, ridges, valleys, plateaus, paint, roads, pieces. Heights are
// metres above sea level (the flat base is at 8 m). It writes a v2 city
// document with the terrain gzipped, same as the maker saves.
//
// {
//   "base": "flat",
//   "peaks":    [{ "x": 0, "z": 1500, "h": 1800, "r": 900 }],          // a mountain: summit height h, r = radius to half height
//   "ridges":   [{ "pts": [[x,z],...], "h": 1400, "r": 400 }],         // a ridge line at height h, r wide (half height)
//   "valleys":  [{ "pts": [[x,z],...], "d": -60, "r": 150 }],          // a cut along a line, d below the surrounding land
//   "plateaus": [{ "x": 0, "z": 0, "h": 300, "r": 500, "edge": 80 }],  // flat top at h, soft edge
//   "bowls":    [{ "x": 0, "z": 0, "d": -40, "r": 200 }],              // a lake bed / crater
//   "trenches": [{ "pts": [[x,z],...], "floor": 10, "w": 48, "wall": 36, "mouth": [300, 0] }],   // a slot cut DOWN into whatever land is there: flat floor w wide at `floor` m, walls rising over `wall` m, the floor ramping up to the land over `mouth` m at each end (0 = a dead end)
//   "paint":    [{ "pts": [[x,z],...], "r": 120, "color": 8 }],        // 1 grass 2 lush 3 dry 4 meadow 5 alpine 6 sand 7 dirt 8 rock 9 asphalt 10 snow 11 red rock 12 water
//   "roads":    [{ "type": "hill", "name": "ANGELES CREST", "pts": [[x,z],...] }],
//   "objects":  [{ "k": "lamp", "x": 0, "z": 0, "r": 0, "s": 1, "seed": 1 }]
// }
// Every road end is then CONNECTED: snapped onto a road it nearly touches,
// extended to the road it was heading for, and any cluster left on its own is
// linked to the network — a drawing's loose ends become junctions.
import { readFileSync, writeFileSync } from 'node:fs';
import { WORLD, ROAD_TYPES } from '../js/world/spec.js';
import { resample } from '../js/track.js';

const [inPath, outPath = 'assets/city/sanoozi.json'] = process.argv.slice(2);
if (!inPath) { console.error('usage: node tools/sculpt.mjs concept.json [out.json]'); process.exit(1); }
const C = JSON.parse(readFileSync(inPath, 'utf8'));
// coordinates may be given in the PIXELS of the sketch: "px": { "w", "h" } maps the
// sketch (square, north up) onto the middle of the world at a uniform scale so
// the height of the drawing spans the world's 4 600 m
if (C.px) {
  const S = (WORLD.maxZ - WORLD.minZ) / C.px.h, ox = (WORLD.minX + WORLD.maxX) / 2 - C.px.w * S / 2;
  const cv = (x, z) => [Math.round(ox + x * S), Math.round(WORLD.maxZ - z * S)];
  const cvPts = pts => pts.map(([x, z]) => cv(x, z));
  const cvR = r => Math.round(r * S);
  for (const k of ['peaks', 'plateaus', 'bowls', 'objects']) for (const o of C[k] || []) { [o.x, o.z] = cv(o.x, o.z); if (o.r != null && k !== 'objects') o.r = cvR(o.r); if (o.edge) o.edge = cvR(o.edge); }
  for (const k of ['ridges', 'valleys', 'paint', 'roads', 'forests', 'zones', 'regions', 'paintPolys']) for (const o of C[k] || []) { o.pts = cvPts(o.pts); if (o.r != null) o.r = cvR(o.r); if (o.edge != null) o.edge = cvR(o.edge); }
  for (const o of C.trenches || []) o.pts = cvPts(o.pts);              // a trench's floor width, wall and mouth are metres already
  console.log(`sketch ${C.px.w}×${C.px.h} px → ${S.toFixed(2)} m/px`);
}
const ER = 8, EW = Math.ceil((WORLD.maxX - WORLD.minX) / ER) + 1, EH = Math.ceil((WORLD.maxZ - WORLD.minZ) / ER) + 1;
const BASE = C.base === 'sanoozi' ? 0 : 8;                         // the flat base sits at 8 m; heights below are absolute
const dh = new Float32Array(EW * EH), paint = new Uint8Array(EW * EH);
const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const gauss = (d, r) => Math.exp(-0.6931 * (d / r) * (d / r));    // 1 at the centre, 0.5 at r
const cellX = i => WORLD.minX + i * ER, cellZ = j => WORLD.minZ + j * ER;
function distToLine(pts, x, z, out = null) {
  let best = 1e9, bi = 0, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
    if (d < best) { best = d; bi = i; bt = t; }
  }
  if (out) { out.i = bi; out.t = bt; }
  return pts.length === 1 ? Math.hypot(x - pts[0][0], z - pts[0][1]) : best;
}
// a ridge may carry a height per point ("hs": [...]) — it tapers along its length
const ridgeH = (r, at) => r.hs ? r.hs[at.i] + (r.hs[Math.min(r.hs.length - 1, at.i + 1)] - r.hs[at.i]) * at.t : r.h;
// every feature is applied as "raise the land toward a target": max() for hills so
// overlapping peaks merge into a range, min() for cuts
const each = fn => { for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) fn(i, j, cellX(i), cellZ(j)); };
for (const p of C.peaks || []) each((i, j, x, z) => { const k = j * EW + i, want = (p.h - BASE) * gauss(Math.hypot(x - p.x, z - p.z), p.r); if (want > dh[k]) dh[k] = want; });
const _at = {};
for (const r of C.ridges || []) each((i, j, x, z) => { const k = j * EW + i, d = distToLine(r.pts, x, z, _at), want = (ridgeH(r, _at) - BASE) * gauss(d, r.r); if (want > dh[k]) dh[k] = want; });
for (const p of C.plateaus || []) each((i, j, x, z) => { const k = j * EW + i, d = Math.hypot(x - p.x, z - p.z), want = (p.h - BASE) * (1 - sm((d - p.r) / (p.edge || 80))); if (want > dh[k]) dh[k] = want; });
for (const v of C.valleys || []) each((i, j, x, z) => { const k = j * EW + i, f = gauss(distToLine(v.pts, x, z), v.r); dh[k] += v.d * f; });
for (const b of C.bowls || []) each((i, j, x, z) => { const k = j * EW + i, f = gauss(Math.hypot(x - b.x, z - b.z), b.r); dh[k] += b.d * f; });
for (const p of C.paint || []) each((i, j, x, z) => { if (distToLine(p.pts, x, z) <= p.r) paint[j * EW + i] = p.color | 0; });

// polygons: "regions": [{ "pts": [[x,z],...], "h": 130, "edge": 80 }] raises the inside to h with a soft edge (max);
// { "pts", "d": -30, "edge": 60 } lowers it by d (additive); "paintPolys": [{ "pts", "color" }]
function rasterPoly(pts) {
  const m = new Uint8Array(EW * EH), n = pts.length;
  for (let j = 0; j < EH; j++) {
    const z = cellZ(j), xs = [];
    for (let a = 0, b = n - 1; a < n; b = a++) { const [xa, za] = pts[a], [xb, zb] = pts[b]; if ((za > z) !== (zb > z)) xs.push(xa + (z - za) / (zb - za) * (xb - xa)); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil((xs[k] - WORLD.minX) / ER)), i1 = Math.min(EW - 1, Math.floor((xs[k + 1] - WORLD.minX) / ER)); for (let i = i0; i <= i1; i++) m[j * EW + i] = 1; }
  }
  return m;
}
// distance (in metres) from each inside cell to the nearest outside cell — two-pass chamfer
function insideDist(m) {
  const D = new Float32Array(EW * EH), BIG = 1e6;
  for (let k = 0; k < D.length; k++) D[k] = m[k] ? BIG : 0;
  for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) { const k = j * EW + i; if (!D[k]) continue; let v = D[k]; if (i) v = Math.min(v, D[k - 1] + 1); if (j) v = Math.min(v, D[k - EW] + 1); if (i && j) v = Math.min(v, D[k - EW - 1] + 1.414); if (i < EW - 1 && j) v = Math.min(v, D[k - EW + 1] + 1.414); D[k] = v; }
  for (let j = EH - 1; j >= 0; j--) for (let i = EW - 1; i >= 0; i--) { const k = j * EW + i; if (!D[k]) continue; let v = D[k]; if (i < EW - 1) v = Math.min(v, D[k + 1] + 1); if (j < EH - 1) v = Math.min(v, D[k + EW] + 1); if (i < EW - 1 && j < EH - 1) v = Math.min(v, D[k + EW + 1] + 1.414); if (i && j < EH - 1) v = Math.min(v, D[k + EW - 1] + 1.414); D[k] = v; }
  for (let k = 0; k < D.length; k++) D[k] *= ER;
  return D;
}
// how far every cell is from a road centreline (for regions that keep off the roads)
let roadDist = null;
function roadDistGrid() {
  if (roadDist) return roadDist;
  const m = new Uint8Array(EW * EH).fill(1);
  for (const r of C.roads || []) for (let i = 0; i < r.pts.length - 1; i++) {
    const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (ER / 2)));
    for (let k = 0; k <= n; k++) { const ci = Math.round((x1 + (x2 - x1) * k / n - WORLD.minX) / ER), cj = Math.round((z1 + (z2 - z1) * k / n - WORLD.minZ) / ER); if (ci >= 0 && cj >= 0 && ci < EW && cj < EH) m[cj * EW + ci] = 0; }
  }
  return roadDist = insideDist(m);
}
// flat regions first (the mountains stay out of the city and the lowland), then raises, then cuts
const regionsSorted = (C.regions || []).slice().sort((a, b) => (a.flat ? 0 : a.h != null ? 1 : 2) - (b.flat ? 0 : b.h != null ? 1 : 2));
for (const rg of regionsSorted) {
  const m = rasterPoly(rg.pts), D = insideDist(m), edge = rg.edge || 60, RD = rg.avoidRoads ? roadDistGrid() : null;
  for (let k = 0; k < m.length; k++) { if (!m[k]) continue; let f = sm(D[k] / edge); if (RD) f *= sm((RD[k] - rg.avoidRoads) / 30); if (rg.flat) dh[k] *= 1 - f; if (rg.h != null) { const want = (rg.h - BASE) * f; if (want > dh[k]) dh[k] = want; } if (rg.d != null) dh[k] += rg.d * f; }
}
for (const p of C.paintPolys || []) { const m = rasterPoly(p.pts); for (let k = 0; k < m.length; k++) if (m[k]) paint[k] = p.color | 0; }

// trenches: the canyon the way it used to be carved — a flat floor `w` wide at
// `floor` m, walls rising over `wall` m to whatever the land is, the depth fading
// to nothing over `mouth` m at an end that is open (so a road can drive in) and
// staying full at a dead end. Cut relative to the local land, as a min.
for (const t of C.trenches || []) {
  const pts = t.pts, hw = (t.w || 48) / 2, wall = t.wall || 36, floor = t.floor != null ? t.floor : 10, mouth = t.mouth || [300, 0];
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  // only the cells within reach of the line
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const reach = hw + wall + ER, i0 = Math.max(0, Math.floor((minX - reach - WORLD.minX) / ER)), i1 = Math.min(EW - 1, Math.ceil((maxX + reach - WORLD.minX) / ER));
  const j0 = Math.max(0, Math.floor((minZ - reach - WORLD.minZ) / ER)), j1 = Math.min(EH - 1, Math.ceil((maxZ + reach - WORLD.minZ) / ER));
  const at = {};
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = cellX(i), z = cellZ(j), d = distToLine(pts, x, z, at);
    if (d > hw + wall) continue;
    const s = cum[at.i] + (cum[at.i + 1] - cum[at.i]) * at.t;
    let fade = 1;
    if (mouth[0] > 0) fade = Math.min(fade, s / mouth[0]);
    if (mouth[1] > 0) fade = Math.min(fade, (L - s) / mouth[1]);
    fade = Math.max(0, Math.min(1, fade));
    const kWall = d <= hw ? 1 : 1 - sm((d - hw) / wall);
    const k = j * EW + i, land = BASE + dh[k], want = land - (land - floor) * fade * kWall;
    if (want < land) dh[k] = want - BASE;
  }
}

// forests: scatter tree pieces within r of a line — "forests": [{ "pts", "r", "kinds": ["pine"], "spacing": 12 }]
// (dressing, not layout: the line is hand-drawn, the trees just fill it; ERASE FOLIAGE removes them)
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const objects = (C.objects || []).slice();
function landAt(x, z) { const i = Math.round((x - WORLD.minX) / ER), j = Math.round((z - WORLD.minZ) / ER); return BASE + (dh[Math.max(0, Math.min(EH - 1, j)) * EW + Math.max(0, Math.min(EW - 1, i))] || 0); }

// ------------------------------------------------------------ connect the roads
// A traced drawing leaves loose ends: lines cut short of the junction they were
// heading for, corners that don't quite meet, a hill town nobody drew a road to.
// Three passes: (1) an end within SNAP of another road is joined to it (a T, or a
// corner if it lands near that road's end); (2) an end within REACH of a road that
// lies roughly AHEAD of it is extended to it; (3) whatever is still not part of the
// main network gets a link road from its closest point to the network's. Ends that
// would have to climb more than DY_MAX m to reach anything are left as dead ends —
// the bottom of a canyon does not get a viaduct out.
const SNAP = 60, REACH = 320, DY_MAX = 22;
const wOf = r => (ROAD_TYPES[r.type] || ROAD_TYPES.street).w;
const linkable = r => r.type !== 'sand' && r.type !== 'pier';
const closedRoad = r => r.pts.length > 2 && Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 3;
// the road as the game builds it: a centripetal Catmull-Rom through the points, every 4 m
// (a traced corner is cut by the spline — measuring against the raw polyline lands 10+ m off)
const splineCache = new WeakMap();
function splineOf(r) {
  let c = splineCache.get(r);
  if (!c || c.n !== r.pts.length || c.a !== r.pts[0][0] + ',' + r.pts[0][1] || c.b !== r.pts[r.pts.length - 1][0] + ',' + r.pts[r.pts.length - 1][1]) {
    const pts = r.pts.length > 2 ? resample(r.pts.map(([x, z]) => ({ x, z, y: 0 })), false, 4).map(p => [p.x, p.z]) : r.pts;
    c = { n: r.pts.length, a: r.pts[0][0] + ',' + r.pts[0][1], b: r.pts[r.pts.length - 1][0] + ',' + r.pts[r.pts.length - 1][1], pts };
    splineCache.set(r, c);
  }
  return c.pts;
}
function nearestOnRoad(r, x, z) {
  const pts = splineOf(r); let best = { d: 1e9 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
    const px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, i, t, x: px, z: pz };
  }
  return best;
}
// where the segment a→b first crosses another road (not `skip`), as { u, road, x, z } with u in (0, 1)
function firstCrossing(a, b, roads, skip) {
  let best = null;
  for (const o of roads) {
    if (skip.includes(o) || !linkable(o)) continue;
    const pts = splineOf(o);
    for (let i = 0; i < pts.length - 1; i++) {
      const [cx, cz] = pts[i], [dx, dz] = pts[i + 1];
      const s1x = b[0] - a[0], s1z = b[1] - a[1], s2x = dx - cx, s2z = dz - cz, den = -s2x * s1z + s1x * s2z;
      if (Math.abs(den) < 1e-9) continue;
      const s = (-s1z * (a[0] - cx) + s1x * (a[1] - cz)) / den, u = (s2x * (a[1] - cz) - s2z * (a[0] - cx)) / den;
      if (s > 0 && s < 1 && u > 0.02 && u < 0.98 && (!best || u < best.u)) best = { u, road: o, x: a[0] + s1x * u, z: a[1] + s1z * u };
    }
  }
  return best;
}
function connectRoads(roads) {
  const stats = { snapped: 0, extended: 0, linked: 0, dead: 0 };
  const endPt = (r, end) => end ? r.pts[r.pts.length - 1] : r.pts[0];
  const endDir = (r, end) => {                                   // the way the road is going as it leaves this end
    const pts = r.pts, n = pts.length, p = endPt(r, end); let q = p, k = end ? n - 2 : 1;
    while (k >= 0 && k < n && Math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]) < 25) k += end ? -1 : 1;
    q = pts[Math.max(0, Math.min(n - 1, k))];
    const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l];
  };
  const ends = []; for (const r of roads) if (linkable(r) && !closedRoad(r)) for (const end of [0, 1]) if (!r.open || r.open[end]) ends.push({ r, end, done: false });   // a canyon's dead end stays dead
  // a road that only takes joins at its open ends: the foot must land within 60 m of one
  const acceptsAt = (o, x, z) => !o.open || [0, 1].some(end => o.open[end] && Math.hypot(endPt(o, end)[0] - x, endPt(o, end)[1] - z) < 60);
  const touching = (r, end) => roads.some(o => o !== r && linkable(o) && nearestOnRoad(o, ...endPt(r, end)).d <= Math.max(2, wOf(o) / 2 - 4));   // well onto the deck; a near miss gets snapped to the centreline
  const endPasses = () => { for (const e of ends) if (!e.done && touching(e.r, e.end)) e.done = true;
  for (const [reach, ahead] of [[SNAP, false], [REACH, true], [320, false], [700, false]]) for (const e of ends) {
    if (e.done) continue;
    if (reach === 700 && e.r.type === 'street') continue;          // only the big roads reach that far for a junction
    const p = endPt(e.r, e.end), dir = endDir(e.r, e.end), hp = landAt(p[0], p[1]);
    const cands = [];
    for (const o of roads) {
      if (o === e.r || !linkable(o)) continue;
      const n = nearestOnRoad(o, p[0], p[1]); if (n.d > reach || !acceptsAt(o, n.x, n.z)) continue;
      const vx = (n.x - p[0]) / (n.d || 1), vz = (n.z - p[1]) / (n.d || 1), straight = vx * dir[0] + vz * dir[1];
      if (ahead && straight < 0.35) continue;                    // a long reach only to the road it was heading for
      const dy = Math.abs(landAt(n.x, n.z) - hp); if (dy > DY_MAX) continue;
      cands.push({ ...n, o, score: n.d + 60 * (1 - straight) + dy * 2 });
    }
    cands.sort((a, b) => a.score - b.score);
    let best = null, q = null, x = null;
    const other = endPt(e.r, e.end ? 0 : 1);
    for (const c of cands) {
      if (Math.hypot(c.x - other[0], c.z - other[1]) < 40) continue;   // never loop a road back onto its own other end
      // the foot: on the other road's centreline; at its end exactly if that's what we nearly hit
      let f = [Math.round(c.x), Math.round(c.z)];
      const oa = c.o.pts[0], ob = c.o.pts[c.o.pts.length - 1];
      if (Math.hypot(f[0] - oa[0], f[1] - oa[1]) < 10) f = oa.slice(); else if (Math.hypot(f[0] - ob[0], f[1] - ob[1]) < 10) f = ob.slice();
      const cr = firstCrossing(p, f, roads, [e.r, c.o]);          // something else in the way? join that instead — unless it can't take a junction there
      if (cr && !acceptsAt(cr.road, cr.x, cr.z)) continue;
      if (cr && Math.hypot(cr.x - other[0], cr.z - other[1]) < 40) continue;
      best = c; q = cr ? [Math.round(cr.x), Math.round(cr.z)] : f; x = cr; break;
    }
    if (!best) { if (process.env.SCULPT_DEBUG && reach === 320) console.log(`  ${e.r.name || e.r.type} end${e.end} ${p}: nothing within ${reach} m and ${DY_MAX} m of height`); continue; }
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 2) { e.done = true; continue; }
    if (e.end) e.r.pts.push(q); else e.r.pts.unshift(q);
    e.done = true; if (reach === SNAP) stats.snapped++; else stats.extended++;
    if (process.env.SCULPT_DEBUG) console.log(`  ${e.r.name || e.r.type} end${e.end} ${p} → ${best.o.name || best.o.type} at ${q} (${Math.round(best.d)} m${x ? ', crossing ' + (x.road.name || x.road.type) : ''})`);
  } };
  endPasses();
  // components: roads that touch (an end on another) are one network
  const comp = roads.map((_, i) => i), find = i => comp[i] === i ? i : (comp[i] = find(comp[i]));
  const union = (a, b) => { comp[find(a)] = find(b); };
  const touches = (a, b) => {
    for (const [r, o] of [[a, b], [b, a]]) for (const end of [0, 1]) if (nearestOnRoad(o, ...endPt(r, end)).d <= wOf(o) / 2 + 1) return true;
    return false;
  };
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) if (linkable(roads[i]) && linkable(roads[j]) && touches(roads[i], roads[j])) union(i, j);
  const sample = r => { const out = []; for (let i = 0; i < r.pts.length - 1; i++) { const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(L / 12)); for (let k = 0; k <= n; k++) out.push([x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n]); } return out; };
  for (let guard = 0; guard < 60; guard++) {
    const groups = new Map(); roads.forEach((r, i) => { if (!linkable(r)) return; const c = find(i); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(i); });
    if (groups.size <= 1) break;
    const main = [...groups.values()].sort((a, b) => b.length - a.length)[0], mainSet = new Set(main);
    const mainPts = main.flatMap(i => sample(roads[i]).map(p => [p[0], p[1], i]));
    // the stray clusters' closest pairs of points to the network, best first; take the first that works
    const pairs = [];
    for (const [c, idx] of groups) {
      if (mainSet.has(idx[0])) continue;
      for (const i of idx) for (const p of sample(roads[i])) {
        if (!acceptsAt(roads[i], p[0], p[1])) continue;
        for (const q of mainPts) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > 2500) continue;
          if (!acceptsAt(roads[q[2]], q[0], q[1])) continue;
          const dy = Math.abs(landAt(p[0], p[1]) - landAt(q[0], q[1]));
          pairs.push({ d, score: d + dy * 4, p, q, from: i, to: q[2], c });   // a climb costs, it doesn't forbid
        }
      }
    }
    pairs.sort((u, v) => u.score - v.score);
    let best = null, a = null, b = null, x = null;
    for (const pr of pairs.slice(0, 4000)) {
      const pa = [Math.round(pr.p[0]), Math.round(pr.p[1])], pb = [Math.round(pr.q[0]), Math.round(pr.q[1])];
      const cr = firstCrossing(pa, pb, roads, [roads[pr.from], roads[pr.to]]);
      if (cr && !acceptsAt(cr.road, cr.x, cr.z)) continue;
      best = pr; a = pa; b = cr ? [Math.round(cr.x), Math.round(cr.z)] : pb; x = cr; break;
    }
    if (!best) break;
    const link = { type: 'street', name: 'LINK ' + (stats.linked + 1), pts: [a, b] };
    roads.push(link); comp.push(roads.length - 1);
    union(roads.length - 1, best.from); union(roads.length - 1, x ? roads.indexOf(x.road) : best.to);
    stats.linked++;
    if (process.env.SCULPT_DEBUG) console.log(`  ${link.name}: ${roads[best.from].name || roads[best.from].type} ${a} → ${(x ? x.road : roads[best.to]).name || (x ? x.road : roads[best.to]).type} ${b} (${Math.round(best.d)} m)`);
  }
  endPasses();                                                    // the links are roads too: ends near them join now
  // tidy: a road extended later changes its spline, so an end that was on it may now sit a few metres off — re-seat it
  for (const e of ends) {
    if (!e.done) continue;
    const p = endPt(e.r, e.end); let best = null;
    for (const o of roads) { if (o === e.r || !linkable(o)) continue; const n = nearestOnRoad(o, p[0], p[1]); if (n.d < 30 && (!best || n.d < best.d) && acceptsAt(o, n.x, n.z)) best = { ...n, o }; }
    const other = endPt(e.r, e.end ? 0 : 1);
    if (best && best.d > 1.5 && Math.hypot(best.x - other[0], best.z - other[1]) >= 40) { const q = [Math.round(best.x), Math.round(best.z)]; if (e.end) e.r.pts[e.r.pts.length - 1] = q; else e.r.pts[0] = q; }
  }
  for (const e of ends) if (!e.done) stats.dead++;
  return stats;
}
if (C.roads && C.roads.length) { const st = connectRoads(C.roads); console.log(`roads connected: ${st.snapped} ends snapped, ${st.extended} extended, ${st.linked} link roads added, ${st.dead} dead ends kept (too high to reach anything)`); }
for (const f of C.forests || []) {
  const kinds = f.kinds || ['pine'], sp = f.spacing || 12, placed = [];
  for (let i = 0; i < f.pts.length - 1; i++) {
    const [x1, z1] = f.pts[i], [x2, z2] = f.pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1), n = Math.round(L * 2 * f.r / (sp * sp) * (f.density || 1));
    for (let k = 0; k < n; k++) {
      const t = rnd(), ox = (rnd() - 0.5) * 2 * f.r, oz = (rnd() - 0.5) * 2 * f.r;
      if (Math.hypot(ox, oz) > f.r) continue;
      const x = Math.round(x1 + (x2 - x1) * t + ox), z = Math.round(z1 + (z2 - z1) * t + oz);
      if (landAt(x, z) < 2) continue;
      if (C.roads && C.roads.some(r => distToLine(r.pts, x, z) < 16)) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < sp * 0.7)) continue;
      placed.push([x, z]);
      objects.push({ k: kinds[Math.floor(rnd() * kinds.length)], x, z, r: Math.floor(rnd() * 360), s: +(0.75 + rnd() * 0.6).toFixed(2), seed: Math.floor(rnd() * 100000), f: 1 });
    }
  }
}

// gzip + base64, the same codec citydoc.js uses
async function gz(bytes) { const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
const b64 = u8 => Buffer.from(u8).toString('base64');
const UNIT = 10;                                                   // decimetres: ±3 276 m
const cm = new Int16Array(dh.length); for (let i = 0; i < dh.length; i++) cm[i] = Math.max(-32000, Math.min(32000, Math.round(dh[i] * UNIT)));
const touched = dh.some(v => v !== 0) || paint.some(v => v !== 0);
const terrain = touched ? { n: dh.length, unit: UNIT, dh: b64(await gz(new Uint8Array(cm.buffer))), paint: b64(await gz(paint)) } : null;
const doc = { v: 2, t: Date.now(), base: C.base || 'flat', autofill: false, forest: C.forest !== false, roads: C.roads || [], terrain, objects, zones: C.zones || [] };   // forest: the instanced base forest grows over all the land
writeFileSync(outPath, JSON.stringify(doc, null, 1));
let hi = -1e9; for (const v of dh) hi = Math.max(hi, v);
console.log(`wrote ${outPath}: ${(C.peaks || []).length} peaks, ${(C.ridges || []).length} ridges, ${(C.roads || []).length} roads, ${objects.length} objects, highest ${Math.round(hi + BASE)} m`);
