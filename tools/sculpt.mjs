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
//   "paint":    [{ "pts": [[x,z],...], "r": 120, "color": 8 }],        // 1 grass 2 lush 3 dry 4 meadow 5 alpine 6 sand 7 dirt 8 rock 9 asphalt 10 snow 11 red rock 12 water
//   "roads":    [{ "type": "hill", "name": "ANGELES CREST", "pts": [[x,z],...] }],
//   "objects":  [{ "k": "lamp", "x": 0, "z": 0, "r": 0, "s": 1, "seed": 1 }]
// }
import { readFileSync, writeFileSync } from 'node:fs';
import { WORLD } from '../js/world/spec.js';

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
// flat regions first (the mountains stay out of the city and the lowland), then raises, then cuts
const regionsSorted = (C.regions || []).slice().sort((a, b) => (a.flat ? 0 : a.h != null ? 1 : 2) - (b.flat ? 0 : b.h != null ? 1 : 2));
for (const rg of regionsSorted) {
  const m = rasterPoly(rg.pts), D = insideDist(m), edge = rg.edge || 60;
  for (let k = 0; k < m.length; k++) { if (!m[k]) continue; const f = sm(D[k] / edge); if (rg.flat) dh[k] *= 1 - f; if (rg.h != null) { const want = (rg.h - BASE) * f; if (want > dh[k]) dh[k] = want; } if (rg.d != null) dh[k] += rg.d * f; }
}
for (const p of C.paintPolys || []) { const m = rasterPoly(p.pts); for (let k = 0; k < m.length; k++) if (m[k]) paint[k] = p.color | 0; }

// forests: scatter tree pieces within r of a line — "forests": [{ "pts", "r", "kinds": ["pine"], "spacing": 12 }]
// (dressing, not layout: the line is hand-drawn, the trees just fill it; ERASE FOLIAGE removes them)
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const objects = (C.objects || []).slice();
function landAt(x, z) { const i = Math.round((x - WORLD.minX) / ER), j = Math.round((z - WORLD.minZ) / ER); return BASE + (dh[Math.max(0, Math.min(EH - 1, j)) * EW + Math.max(0, Math.min(EW - 1, i))] || 0); }
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
const doc = { v: 2, t: Date.now(), base: C.base || 'flat', autofill: false, roads: C.roads || [], terrain, objects, zones: C.zones || [] };
writeFileSync(outPath, JSON.stringify(doc, null, 1));
let hi = -1e9; for (const v of dh) hi = Math.max(hi, v);
console.log(`wrote ${outPath}: ${(C.peaks || []).length} peaks, ${(C.ridges || []).length} ridges, ${(C.roads || []).length} roads, ${objects.length} objects, highest ${Math.round(hi + BASE)} m`);
