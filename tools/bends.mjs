// tools/bends.mjs [doc] — how tight are the roads? Min radius per road type from
// the splined centreline (curvature from tangent change per metre), and the ten
// tightest bends anywhere. So "a hairpin at 40" has a number.
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
const byType = {}, all = [];
// heading change over a 30 m window (hairpins are 15-25 m radius over 40-80 m; polyline corners
// between 10 m segments would read as 2 m circles, so don't look at three points)
const W = 30, step = 3;
for (const r of T.roads) {
  const n = Math.floor(r.L / step);
  for (let i = 0; i + W / step < n; i++) {
    const a = T.pointAt(r, i * step), c = T.pointAt(r, i * step + W), b = T.pointAt(r, i * step + W / 2);
    let da = Math.atan2(c.tx, c.tz) - Math.atan2(a.tx, a.tz); da = Math.atan2(Math.sin(da), Math.cos(da));
    const R = Math.abs(da) > 1e-4 ? W / Math.abs(da) : 1e9;
    if (R < 400) { const rec = { R, type: r.type, name: r.name || r.type + ' #' + r.idx, x: b.x, z: b.z, s: i * step, deg: Math.abs(da) * 180 / Math.PI }; all.push(rec); (byType[r.type] ||= []).push(rec); }
  }
}
all.sort((a, b) => a.R - b.R);
console.log('tightest bends anywhere (radius m, road, at):');
const seen = new Set();
for (const b of all) { const k = b.name + ':' + Math.round(b.s / 40); if (seen.has(k)) continue; seen.add(k); console.log(`  R ${b.R.toFixed(0).padStart(3)} m (${b.deg.toFixed(0)}° in 30 m)  ${b.name.padEnd(22)} ?at=${b.x.toFixed(0)},${b.z.toFixed(0)}`); if (seen.size >= 12) break; }
console.log('min radius by type:');
for (const [t, list] of Object.entries(byType)) { list.sort((a, b) => a.R - b.R); const w = T.roads.find(r => r.type === t).T.w; console.log(`  ${t.padEnd(8)} w ${w} m  min R ${list[0].R.toFixed(0)} m  · 10th ${(list[Math.min(9, list.length - 1)].R).toFixed(0)} m  · windows R<25 m: ${list.filter(b => b.R < 25).length}  R<40 m: ${list.filter(b => b.R < 40).length}`); }
