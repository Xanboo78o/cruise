// tools/worldcheck.mjs [doc=assets/city/sanoozi.json] [out.png] — load the city
// document headless (the same WorldTerrain the game uses) and report what a
// drive would show: road ends that don't reach another road, junctions where
// two decks meet at different heights, and every place the 14 m terrain mesh
// (rebuilt here exactly as build.js triangulates it) pokes up through a deck.
// Writes a map PNG: height shaded, roads by type, dangling ends as red dots,
// clipping spots in magenta.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, deflateSync } from 'node:zlib';
import { WorldTerrain } from '../js/world/terrain.js';
import { WORLD } from '../js/world/spec.js';

const [docPath = 'assets/city/sanoozi.json', outPng = null] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
if (doc.terrain && doc.terrain.dh) {
  const unit = doc.terrain.unit || 100;
  const q = new Int16Array(gunzipSync(Buffer.from(doc.terrain.dh, 'base64')).buffer);
  const dh = new Float32Array(q.length); for (let i = 0; i < q.length; i++) dh[i] = q[i] / unit;
  doc.terrainData = { dh, paint: new Uint8Array(gunzipSync(Buffer.from(doc.terrain.paint, 'base64'))), touched: true };
}
const T = new WorldTerrain(doc.roads, doc);
const roads = T.roads;
console.log(`${docPath}: ${roads.length} roads, base ${doc.base}`);

// ------------------------------------------------------------- connectivity
// nearest point on any OTHER road to (x, z)
function nearestOther(x, z, self) {
  let best = { d: 1e9 };
  for (const o of roads) {
    if (o === self) continue;
    for (const g of o.seg) {
      const dx = g.x2 - g.x1, dz = g.z2 - g.z1, l2 = g.l * g.l || 1;
      let t = ((x - g.x1) * dx + (z - g.z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
      const px = g.x1 + dx * t, pz = g.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { d, road: o, s: g.s0 + t * g.l, x: px, z: pz };
    }
  }
  return best;
}
const dangling = [], joined = [], mismatched = [];
for (const r of roads) {
  const closed = Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 3;
  if (closed) continue;
  for (const end of [0, 1]) {
    const p = T.pointAt(r, end ? r.L : 0), n = nearestOther(p.x, p.z, r);
    const rec = { road: r, end, x: p.x, z: p.z, d: n.d, other: n.road, s: n.s };
    if (n.d > n.road.T.w / 2 + 1) dangling.push(rec);
    else {
      joined.push(rec);
      const dy = T.roadY(r, end ? r.L : 0) - T.roadY(n.road, n.s);
      if (Math.abs(dy) > 0.25) mismatched.push({ ...rec, dy });
    }
  }
}
// deck continuity: no road may step more than its grade allows between samples, and a ring road must close flush
let steps = 0, worstStep = 0, stepAt = null;
for (const r of roads) { const g = T.gMax(r) * r.step * 1.6 + 0.3;
  for (let i = 1; i < r.ys.length; i++) { const d = Math.abs(r.ys[i] - r.ys[i - 1]); if (d > g) { steps++; if (d > worstStep) { worstStep = d; stepAt = r; } } }
  if (Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 3) { const d = Math.abs(r.ys[0] - r.ys[r.ys.length - 1]); if (d > 0.3) { steps++; if (d > worstStep) { worstStep = d; stepAt = r; } } } }
console.log(`deck steps beyond grade (incl. ring seams): ${steps}${steps ? ' — worst ' + worstStep.toFixed(1) + ' m on ' + (stepAt.name || stepAt.type + ' #' + stepAt.idx) : ''}`);
dangling.sort((a, b) => a.d - b.d);
console.log(`road ends: ${joined.length} joined, ${dangling.length} dangling (nearest other road: ${dangling.slice(0, 12).map(d => Math.round(d.d)).join(' ')}${dangling.length > 12 ? ' …' : ''} m)`);
const buckets = [0, 0, 0, 0];
for (const d of dangling) buckets[d.d < 30 ? 0 : d.d < 80 ? 1 : d.d < 200 ? 2 : 3]++;
console.log(`  dangling by gap: <30 m ${buckets[0]}, 30-80 ${buckets[1]}, 80-200 ${buckets[2]}, >200 ${buckets[3]}`);
console.log(`junction height mismatches > 0.25 m: ${mismatched.length}${mismatched.length ? ' — worst ' + mismatched.map(m => Math.abs(m.dy)).sort((a, b) => b - a).slice(0, 8).map(v => v.toFixed(1)).join(' ') + ' m' : ''}`);
const nm = r => r.name || r.type + ' #' + r.idx;
for (const m of mismatched.slice().sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy)).slice(0, 6)) console.log(`  ${nm(m.road)} end${m.end} at ${Math.round(m.x)},${Math.round(m.z)} → ${nm(m.other)}: deck ${T.roadY(m.road, m.end ? m.road.L : 0).toFixed(0)} vs ${T.roadY(m.other, m.s).toFixed(0)} (land ${T.land(m.x, m.z).toFixed(0)})`);
for (const d of dangling.slice(0, 30)) console.log(`  dangling: ${nm(d.road)} end${d.end} at ${Math.round(d.x)},${Math.round(d.z)} land ${T.land(d.x, d.z).toFixed(0)} → ${nm(d.other)} ${Math.round(d.d)} m away (land ${T.land(d.other ? T.pointAt(d.other, d.s).x : 0, d.other ? T.pointAt(d.other, d.s).z : 0).toFixed(0)})`);

// ----------------------------------------------------------- the mesh vs the deck
// the terrain mesh as build.js makes it: T's land grid, triangles dropped where
// any vertex is inside an at-grade road corridor (the road's shoulder strip is
// the ground there). meshY returns -Infinity where there is no terrain.
console.time('mesh');
T.buildMesh();
console.timeEnd('mesh');
const cell = WorldTerrain.CELL, w = T.mw, h = T.mh;
let dropped = 0; for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) { const W = w + 1, f = (a, b) => T.mFlag[(j + b) * W + k + a]; if (f(0, 0) || f(0, 1) || f(1, 0)) dropped++; if (f(1, 0) || f(0, 1) || f(1, 1)) dropped++; }
// every dropped triangle must lie under some road's shoulder band (hw + 36 m of a centreline, at-grade) — else it's a hole to the sea
const within = (x, z, extra) => { const gx = Math.floor((x - T.g.x0) / T.g.cell), gz = Math.floor((z - T.g.z0) / T.g.cell); if (gx < 0 || gz < 0 || gx >= T.g.w || gz >= T.g.h) return false;
  for (const [ri, si] of T.g.cells[gz * T.g.w + gx]) { const r = T.roads[ri]; if (r.type === 'sand' || r.type === 'pier') continue; const g = r.seg[si], dx = g.x2 - g.x1, dz = g.z2 - g.z1, l2 = g.l * g.l || 1; let t = ((x - g.x1) * dx + (z - g.z1) * dz) / l2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(x - (g.x1 + dx * t), z - (g.z1 + dz * t)); if (d <= r.T.w / 2 + extra) return true; } return false; };   // the band is drawn on bridge steps too (under the mesh)
let holes = 0, holeAt = [];
for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) { const W = w + 1, f = (a, b) => T.mFlag[(j + b) * W + k + a];
  for (const tri of [[[0, 0], [0, 1], [1, 0]], [[1, 0], [0, 1], [1, 1]]]) { if (!tri.some(([a, b]) => f(a, b))) continue;
    for (const [a, b] of [...tri, [tri.reduce((u, t) => u + t[0], 0) / 3, tri.reduce((u, t) => u + t[1], 0) / 3]]) { const x = WORLD.minX + (k + a) * cell, z = WORLD.minZ + (j + b) * cell; if (!within(x, z, 36)) { holes++; if (holeAt.length < 6) holeAt.push([Math.round(x), Math.round(z)]); } } } }
console.log(`dropped-triangle points NOT under any road's shoulder band (holes): ${holes}${holes ? ' e.g. ' + JSON.stringify(holeAt) : ''}`);
console.log(`terrain triangles dropped for road corridors: ${dropped} of ${w * h * 2} (${(100 * dropped / (w * h * 2)).toFixed(1)} %)`);
function meshY(x, z) {
  const fx = (x - WORLD.minX) / cell, fz = (z - WORLD.minZ) / cell;
  const k = Math.max(0, Math.min(w - 1, Math.floor(fx))), j = Math.max(0, Math.min(h - 1, Math.floor(fz)));
  const u = fx - k, v = fz - j, W = w + 1, F = T.mFlag;
  const first = u + v <= 1;
  if (first ? (F[j * W + k] || F[(j + 1) * W + k] || F[j * W + k + 1]) : (F[j * W + k + 1] || F[(j + 1) * W + k] || F[(j + 1) * W + k + 1])) return -Infinity;
  return T.meshY(x, z);
}
const clips = []; let deckSamples = 0, clipSamples = 0, worst = 0, gapSamples = 0;
const perRoad = [];
for (const r of roads) {
  if (r.type === 'sand' || r.type === 'pier') continue;
  const hw = r.T.w / 2; let rc = 0, rn = 0, rw = 0;
  for (let s = 0; s <= r.L; s += 3) {
    const p = T.pointAt(r, s), ry = T.roadY(r, s), deck = ry + 0.08;
    const nx = p.tz, nz = -p.tx;
    for (let lat = -hw + 1; lat <= hw - 1; lat += 2) {
      const x = p.x + nx * lat, z = p.z + nz * lat;
      const m = meshY(x, z), over = m - deck;
      deckSamples++; rn++;
      if (over > 0.05) { clipSamples++; rc++; if (over > rw) rw = over; if (over > worst) worst = over; if (over > 0.3 && clips.length < 4000) clips.push([x, z, over]); }
      if (over > -1e9 && over < -0.6 && Math.abs(lat) > hw - 2.5 && !T.isBridge(r, s)) gapSamples++;
    }
  }
  if (rc) perRoad.push({ r, rc, rn, rw });
}
perRoad.sort((a, b) => b.rc - a.rc);
// beside the deck: the shoulder is T.height (what the strip draws) — the mesh must not rise above it within SH either
let shClip = 0, shN = 0;
for (const r of roads) { if (r.type === 'sand' || r.type === 'pier') continue; const hw = r.T.w / 2;
  for (let s = 0; s <= r.L; s += 6) { if (T.isBridge(r, s)) continue; const p = T.pointAt(r, s), nx = p.tz, nz = -p.tx;
    for (const o of [1, 4, 8, 12, 15]) for (const sd of [1, -1]) { const x = p.x + nx * sd * (hw + o), z = p.z + nz * sd * (hw + o); shN++; if (meshY(x, z) > T.height(x, z) + 0.05) shClip++; } } }
console.log(`terrain mesh above a shoulder (within SH): ${shClip} of ${shN}`);
console.log(`terrain mesh above a deck: ${clipSamples} of ${deckSamples} deck samples (${(100 * clipSamples / deckSamples).toFixed(2)} %), worst +${worst.toFixed(1)} m, roads affected ${perRoad.length}; see-under gaps at deck edges (not bridges): ${gapSamples}`);
for (const p of perRoad.slice(0, 8)) console.log(`  ${p.r.name || p.r.type + ' #' + p.r.idx}: ${p.rc}/${p.rn} samples, worst +${p.rw.toFixed(1)} m`);

// ------------------------------------------------------------------ canyon
// anything below the sea inland (the base plain is 8 m): a hole that fills with water
let wet = 0, cells = 0, lowest = 1e9, lowAt = null;
for (let j = 0; j <= h; j += 2) for (let k = 0; k <= w; k += 2) { const x = WORLD.minX + k * cell, z = WORLD.minZ + j * cell; const y = T.land(x, z); cells++; if (y < 0.5) { wet++; } if (y < lowest) { lowest = y; lowAt = [x, z]; } }
console.log(`land below the water line: ${wet} of ${cells} samples (${(100 * wet / cells).toFixed(1)} %), lowest ${lowest.toFixed(0)} m at ${lowAt}`);

// -------------------------------------------------------------- buildings
{
  const FP = {}; for (const m of readFileSync(new URL('../js/world/pieces.js', import.meta.url), 'utf8').matchAll(/R\('([a-z0-9]+)', '([a-z]+)', '[^']*', (\[[0-9.]+, [0-9.]+\]|null)/g)) FP[m[1]] = m[3] === 'null' ? null : JSON.parse(m[3]);
  const bld = (doc.objects || []).filter(o => FP[o.k]); let onDeck = 0, wet = 0, cliff = 0, canyon = 0, overlap = 0;
  const boxes = bld.map(o => { const fp = FP[o.k], s = o.s || 1, r = (o.r || 0) * Math.PI / 180, cw = Math.abs(Math.cos(r)), sw = Math.abs(Math.sin(r)); return [o.x, o.z, fp[0] * s * cw + fp[1] * s * sw, fp[0] * s * sw + fp[1] * s * cw]; });
  for (let a = 0; a < bld.length; a++) {
    const o = bld[a], fp = FP[o.k], s = o.s || 1, r = (o.r || 0) * Math.PI / 180, sy = Math.sin(r), cy = Math.cos(r);
    for (const [lx, lz] of [[0, 0], [-fp[0] * s / 2, -fp[1] * s / 2], [fp[0] * s / 2, -fp[1] * s / 2], [fp[0] * s / 2, fp[1] * s / 2], [-fp[0] * s / 2, fp[1] * s / 2]]) {
      const x = o.x + lx * cy + lz * sy, z = o.z - lx * sy + lz * cy, n = T.nearestRoad(x, z);
      if (n && n.d < n.road.T.w / 2 + 0.5) { onDeck++; break; }
    }
    if (T.land(o.x, o.z) < 2) wet++; if (T.slopeAt(o.x, o.z) > 0.5) cliff++; if (T.paintAt(o.x, o.z) === 11) canyon++;
    for (let b = a + 1; b < bld.length; b++) { const p = boxes[a], q = boxes[b]; if (Math.abs(p[0] - q[0]) < (p[2] + q[2]) / 2 - 1 && Math.abs(p[1] - q[1]) < (p[3] + q[3]) / 2 - 1) { overlap++; break; } }
  }
  console.log(`buildings: ${bld.length}; corners on a deck: ${onDeck}, in water: ${wet}, on a cliff: ${cliff}, on the mesa: ${canyon}, overlapping another: ${overlap}; lamps: ${(doc.objects || []).filter(o => o.k === 'lamp').length}`);
}
// --------------------------------------------------------------- objects
if (doc.objects && doc.objects.length) {
  let sunk = 0, floating = 0;
  for (const o of doc.objects) { const m = meshY(o.x, o.z); if (m === -Infinity) continue; const d = m - T.height(o.x, o.z); if (d > 0.8) sunk++; else if (d < -0.8) floating++; }
  console.log(`objects: ${doc.objects.length}; base buried > 0.8 m by the mesh: ${sunk}, floating > 0.8 m: ${floating}`);
}

// ------------------------------------------------------------------- PNG
if (outPng) {
  const S = 4, PW = Math.ceil((WORLD.maxX - WORLD.minX) / S), PH = Math.ceil((WORLD.maxZ - WORLD.minZ) / S);
  const img = new Uint8Array(PW * PH * 3);
  const px = (x, z) => [Math.round((x - WORLD.minX) / S), Math.round((WORLD.maxZ - z) / S)];
  const put = (i, j, r, g, b) => { if (i < 0 || j < 0 || i >= PW || j >= PH) return; const k = (j * PW + i) * 3; img[k] = r; img[k + 1] = g; img[k + 2] = b; };
  for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
    const x = WORLD.minX + i * S, z = WORLD.maxZ - j * S, y = T.land(x, z);
    let r, g, b;
    if (y < 0.5) { r = 40; g = 90; b = 140; }
    else { const t = Math.min(1, (y - 0.5) / 450); r = 80 + 140 * t; g = 130 + 90 * t; b = 60 + 150 * t; }
    // slope shading
    const sl = T.land(x + S, z) - y; const sh = Math.max(0.6, Math.min(1.3, 1 + sl * 0.15));
    put(i, j, Math.min(255, r * sh), Math.min(255, g * sh), Math.min(255, b * sh));
  }
  const line = (x1, z1, x2, z2, c, wpx = 1) => { const [a, b] = px(x1, z1), [d, e] = px(x2, z2); const n = Math.max(1, Math.ceil(Math.hypot(d - a, e - b))); for (let k = 0; k <= n; k++) { const i = Math.round(a + (d - a) * k / n), j = Math.round(b + (e - b) * k / n); for (let u = -wpx; u <= wpx; u++) for (let v = -wpx; v <= wpx; v++) put(i + u, j + v, ...c); } };
  const COL = { hill: [40, 200, 40], street: [40, 80, 255], blvd: [0, 0, 160], highway: [0, 0, 0], coast: [0, 150, 200], canyon: [200, 120, 0], gravel: [150, 110, 60] };
  for (const r of roads) for (const g of r.seg) line(g.x1, g.z1, g.x2, g.z2, COL[r.type] || [255, 255, 255], r.T.w > 24 ? 2 : 1);
  const dot = (x, z, c, rad) => { const [a, b] = px(x, z); for (let u = -rad; u <= rad; u++) for (let v = -rad; v <= rad; v++) if (u * u + v * v <= rad * rad) put(a + u, b + v, ...c); };
  for (const [x, z] of clips) dot(x, z, [255, 0, 255], 2);
  for (const d of dangling) dot(d.x, d.z, [255, 0, 0], 4);
  for (const m of mismatched) dot(m.x, m.z, [255, 200, 0], 3);
  // PNG encode
  const raw = Buffer.alloc((PW * 3 + 1) * PH);
  for (let j = 0; j < PH; j++) { raw[j * (PW * 3 + 1)] = 0; Buffer.from(img.buffer, j * PW * 3, PW * 3).copy(raw, j * (PW * 3 + 1) + 1); }
  const crcTable = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(outPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log(`wrote ${outPng} (${PW}x${PH}, ${S} m/px; red = dangling end, yellow = junction step, magenta = mesh through deck)`);
}
