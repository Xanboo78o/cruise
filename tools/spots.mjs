// tools/spots.mjs [doc] — print a handful of camera spots on the real roads, one
// per road type plus the steepest hillside stretch and a bridge, as ?at=x,z,yaw
// (yaw in degrees, the convention main.js reads). For screenshot batches.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { WorldTerrain } from '../js/world/terrain.js';

const [docPath = 'assets/city/sanoozi.json'] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
if (doc.terrain && doc.terrain.dh) {
  const unit = doc.terrain.unit || 100;
  const q = new Int16Array(gunzipSync(Buffer.from(doc.terrain.dh, 'base64')).buffer);
  const dh = new Float32Array(q.length); for (let i = 0; i < q.length; i++) dh[i] = q[i] / unit;
  doc.terrainData = { dh, paint: new Uint8Array(gunzipSync(Buffer.from(doc.terrain.paint, 'base64'))), touched: true };
}
const T = new WorldTerrain(doc.roads, doc);
const objs = doc.objects || [];
const at = (r, s) => { const p = T.pointAt(r, s); return { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) * 180 / Math.PI, y: T.roadY(r, s), land: T.land(p.x, p.z), p }; };
const fmt = (o, why) => console.log(`${why.padEnd(28)} ?at=${o.x.toFixed(0)},${o.z.toFixed(0)},${o.yaw.toFixed(0)}   deck ${o.y.toFixed(1)} land ${o.land.toFixed(1)}`);

// one per type: the longest road of that type, a third of the way along
const byType = new Map();
for (const r of T.roads) { const k = r.type; if (!byType.has(k) || byType.get(k).L < r.L) byType.set(k, r); }
for (const [k, r] of byType) fmt(at(r, r.L / 3), `type ${k} (${r.name || '#' + r.idx})`);

// the busiest street (most buildings within 60 m of it)
let best = null;
for (const r of T.roads) {
  if (r.type !== 'street') continue;
  let n = 0;
  for (let s = 0; s < r.L; s += 12) { const p = T.pointAt(r, s); for (const o of objs) if (Math.abs(o.x - p.x) < 60 && Math.abs(o.z - p.z) < 60) n++; }
  const dens = n / Math.max(1, r.L);
  if (!best || dens > best.dens) best = { r, dens };
}
if (best) fmt(at(best.r, best.r.L / 2), 'downtown (densest street)');

// the steepest side slope beside a road (cut wall / embankment)
let steep = null;
for (const r of T.roads) for (let s = 10; s < r.L - 10; s += 8) {
  const p = T.pointAt(r, s), hw = r.T.w / 2;
  const nx = p.tz, nz = -p.tx;
  const dl = T.land(p.x + nx * (hw + 6), p.z + nz * (hw + 6)) - T.roadY(r, s), dr = T.land(p.x - nx * (hw + 6), p.z - nz * (hw + 6)) - T.roadY(r, s);
  const m = Math.max(Math.abs(dl), Math.abs(dr));
  if (!steep || m > steep.m) steep = { r, s, m, dl, dr };
}
if (steep) fmt(at(steep.r, steep.s), `steepest side (${steep.dl.toFixed(0)}/${steep.dr.toFixed(0)} m)`);

// a bridge
outer: for (const r of T.roads) for (let s = 0; s < r.L; s += 6) if (T.isBridge(r, s)) { fmt(at(r, Math.min(r.L, s + 30)), 'bridge'); break outer; }

// the house on the steepest ground (mesh relief across ~12 m)
let hs = null;
for (const o of objs) {
  if (!o.b) continue;
  let lo = 1e9, hi = -1e9;
  for (const [dx, dz] of [[-6, -5], [6, -5], [6, 5], [-6, 5], [0, 0]]) { const y = T.meshY(o.x + dx, o.z + dz); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  if (!hs || hi - lo > hs.rel) hs = { o, rel: hi - lo };
}
if (hs) { const n = T.nearestRoad(hs.o.x, hs.o.z); const p = n ? { x: n.x, z: n.z, yaw: Math.atan2(n.tx, n.tz) * 180 / Math.PI, y: T.roadY(n.road, n.s), land: T.land(n.x, n.z) } : null; if (p) fmt(p, `steepest lot (${hs.rel.toFixed(1)} m relief, ${hs.o.k})`); }

// shore: a road point nearest the water
let shore = null;
for (const r of T.roads) for (let s = 0; s < r.L; s += 10) { const p = T.pointAt(r, s); let wet = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (T.land(p.x + Math.cos(a) * 40, p.z + Math.sin(a) * 40) < 0.3) wet++; } if (wet >= 2 && (!shore || wet > shore.wet)) shore = { r, s, wet }; }
if (shore) fmt(at(shore.r, shore.s), 'shore');
console.log(`objects ${objs.length}, roads ${T.roads.length}`);
