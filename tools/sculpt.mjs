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
const ER = 8, EW = Math.ceil((WORLD.maxX - WORLD.minX) / ER) + 1, EH = Math.ceil((WORLD.maxZ - WORLD.minZ) / ER) + 1;
const BASE = C.base === 'sanoozi' ? 0 : 8;                         // the flat base sits at 8 m; heights below are absolute
const dh = new Float32Array(EW * EH), paint = new Uint8Array(EW * EH);
const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const gauss = (d, r) => Math.exp(-0.6931 * (d / r) * (d / r));    // 1 at the centre, 0.5 at r
const cellX = i => WORLD.minX + i * ER, cellZ = j => WORLD.minZ + j * ER;
function distToLine(pts, x, z) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)));
  }
  return pts.length === 1 ? Math.hypot(x - pts[0][0], z - pts[0][1]) : best;
}
// every feature is applied as "raise the land toward a target": max() for hills so
// overlapping peaks merge into a range, min() for cuts
const each = fn => { for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) fn(i, j, cellX(i), cellZ(j)); };
for (const p of C.peaks || []) each((i, j, x, z) => { const k = j * EW + i, want = (p.h - BASE) * gauss(Math.hypot(x - p.x, z - p.z), p.r); if (want > dh[k]) dh[k] = want; });
for (const r of C.ridges || []) each((i, j, x, z) => { const k = j * EW + i, want = (r.h - BASE) * gauss(distToLine(r.pts, x, z), r.r); if (want > dh[k]) dh[k] = want; });
for (const p of C.plateaus || []) each((i, j, x, z) => { const k = j * EW + i, d = Math.hypot(x - p.x, z - p.z), want = (p.h - BASE) * (1 - sm((d - p.r) / (p.edge || 80))); if (want > dh[k]) dh[k] = want; });
for (const v of C.valleys || []) each((i, j, x, z) => { const k = j * EW + i, f = gauss(distToLine(v.pts, x, z), v.r); dh[k] += v.d * f; });
for (const b of C.bowls || []) each((i, j, x, z) => { const k = j * EW + i, f = gauss(Math.hypot(x - b.x, z - b.z), b.r); dh[k] += b.d * f; });
for (const p of C.paint || []) each((i, j, x, z) => { if (distToLine(p.pts, x, z) <= p.r) paint[j * EW + i] = p.color | 0; });

// gzip + base64, the same codec citydoc.js uses
async function gz(bytes) { const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
const b64 = u8 => Buffer.from(u8).toString('base64');
const UNIT = 10;                                                   // decimetres: ±3 276 m
const cm = new Int16Array(dh.length); for (let i = 0; i < dh.length; i++) cm[i] = Math.max(-32000, Math.min(32000, Math.round(dh[i] * UNIT)));
const touched = dh.some(v => v !== 0) || paint.some(v => v !== 0);
const terrain = touched ? { n: dh.length, unit: UNIT, dh: b64(await gz(new Uint8Array(cm.buffer))), paint: b64(await gz(paint)) } : null;
const doc = { v: 2, t: Date.now(), base: C.base || 'flat', autofill: false, roads: C.roads || [], terrain, objects: C.objects || [] };
writeFileSync(outPath, JSON.stringify(doc, null, 1));
let hi = -1e9; for (const v of dh) hi = Math.max(hi, v);
console.log(`wrote ${outPath}: ${(C.peaks || []).length} peaks, ${(C.ridges || []).length} ridges, ${(C.roads || []).length} roads, ${(C.objects || []).length} objects, highest ${Math.round(hi + BASE)} m`);
