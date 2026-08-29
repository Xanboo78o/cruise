// tools/populate.mjs [doc=assets/city/sanoozi.json] — buildings and street lamps
// along the streets Adam drew. Nothing here invents layout: every building sits
// on a lot beside one of his streets, facing it, and what it is follows how dense
// his network is right there — a tight grid gets towers, shops and apartments, a
// loop of cul-de-sacs gets houses, the hill gets cabins, the water gets beach
// houses, the red mesa gets nothing. No lot may touch a deck, a junction, a
// bridge, water, a cliff or another lot. A handful of landmarks (school, church,
// hospital, gas stations, water tower, lighthouse…) take the first lot that fits.
// Everything it places is tagged b:1, so running it again replaces its own work
// and leaves Adam's hand-placed pieces alone.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { WorldTerrain } from '../js/world/terrain.js';
import { WORLD } from '../js/world/spec.js';

const [docPath = 'assets/city/sanoozi.json'] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
if (doc.terrain && doc.terrain.dh) {
  const unit = doc.terrain.unit || 100;
  const q = new Int16Array(gunzipSync(Buffer.from(doc.terrain.dh, 'base64')).buffer);
  const dh = new Float32Array(q.length); for (let i = 0; i < q.length; i++) dh[i] = q[i] / unit;
  doc.terrainData = { dh, paint: new Uint8Array(gunzipSync(Buffer.from(doc.terrain.paint, 'base64'))), touched: true };
}
const T = new WorldTerrain(doc.roads, doc);
const SH = WorldTerrain.SH;

// the catalogue's footprints, read from the source (pieces.js imports three, which node can't resolve)
const FP = {};
for (const m of readFileSync(new URL('../js/world/pieces.js', import.meta.url), 'utf8').matchAll(/R\('([a-z0-9]+)', '([a-z]+)', '[^']*', (\[[0-9.]+, [0-9.]+\]|null)/g)) FP[m[1]] = m[3] === 'null' ? null : JSON.parse(m[3]);

let seed = 78;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = list => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + rnd() * (b - a);
const weighted = table => { let t = 0; for (const [, w] of table) t += w; let r = rnd() * t; for (const [k, w] of table) { r -= w; if (r <= 0) return k; } return table[table.length - 1][0]; };

// ------------------------------------------------------------ how urban is it here
// metres of street within 200 m of a point, on a 40 m grid (an integral image)
const DG = 40, DW = Math.ceil((WORLD.maxX - WORLD.minX) / DG) + 2, DH = Math.ceil((WORLD.maxZ - WORLD.minZ) / DG) + 2;
const dens = new Float32Array(DW * DH);
const URBAN_TYPES = new Set(['street', 'blvd', 'highway', 'coast']);
for (const r of T.roads) if (URBAN_TYPES.has(r.type)) for (let s = 0; s < r.L; s += 8) { const p = T.pointAt(r, s); const i = Math.floor((p.x - WORLD.minX) / DG), j = Math.floor((p.z - WORLD.minZ) / DG); if (i >= 0 && j >= 0 && i < DW && j < DH) dens[j * DW + i] += 8; }
const integ = new Float64Array((DW + 1) * (DH + 1));
for (let j = 1; j <= DH; j++) for (let i = 1; i <= DW; i++) integ[j * (DW + 1) + i] = dens[(j - 1) * DW + (i - 1)] + integ[(j - 1) * (DW + 1) + i] + integ[j * (DW + 1) + i - 1] - integ[(j - 1) * (DW + 1) + i - 1];
function urbanAt(x, z) {
  const R = 5, ci = Math.floor((x - WORLD.minX) / DG), cj = Math.floor((z - WORLD.minZ) / DG);
  const i0 = Math.max(0, ci - R), i1 = Math.min(DW, ci + R + 1), j0 = Math.max(0, cj - R), j1 = Math.min(DH, cj + R + 1);
  return integ[j1 * (DW + 1) + i1] - integ[j0 * (DW + 1) + i1] - integ[j1 * (DW + 1) + i0] + integ[j0 * (DW + 1) + i0];
}
// water within 300 m?
const RING = [];
for (let k = 0; k < 12; k++) RING.push([Math.cos(k / 12 * Math.PI * 2), Math.sin(k / 12 * Math.PI * 2)]);
// a real shore (the sea, a lake) — a creek is a couple of samples wide and doesn't count
const coastalAt = (x, z) => { let n = 0; for (const [cx, cz] of RING) { if (T.land(x + cx * 150, z + cz * 150) < 0.5) n++; if (T.land(x + cx * 300, z + cz * 300) < 0.5) n++; } return n >= 4; };
// the thresholds come from the network itself: the densest 15 % of street length is downtown,
// the next 25 % midtown, the next 40 % suburb, the rest rural
const samples = [];
for (const r of T.roads) if (r.type === 'street' || r.type === 'blvd') for (let s = 0; s < r.L; s += 10) { const p = T.pointAt(r, s); samples.push(urbanAt(p.x, p.z)); }
samples.sort((a, b) => b - a);
const Q_DOWN = samples[Math.floor(samples.length * 0.15)], Q_MID = samples[Math.floor(samples.length * 0.40)], Q_SUB = samples[Math.floor(samples.length * 0.80)];
console.log(`urban density quantiles (m of street within 200 m): downtown ≥ ${Q_DOWN | 0}, midtown ≥ ${Q_MID | 0}, suburb ≥ ${Q_SUB | 0}`);
function districtAt(x, z) {
  if (T.paintAt(x, z) === 11) return 'canyon';
  const y = T.land(x, z), u = urbanAt(x, z);
  if (y < 0.5) return 'water';
  if (y > 100) return 'hill';
  if (y < 16 && coastalAt(x, z)) return 'coast';
  return u >= Q_DOWN ? 'downtown' : u >= Q_MID ? 'midtown' : u >= Q_SUB ? 'suburb' : 'rural';
}

// ------------------------------------------------------------ what goes where
// table: [recipe, weight]; gap: metres between lots; setback: deck edge → front face;
// scale range; chance a lot is used at all; maxSlope for the ground under it
const HOUSES = [['bungalow', 4], ['cottage', 4], ['twostorey', 4], ['lhouse', 3], ['ranch', 3], ['splitlevel', 2], ['duplex', 2], ['garagefront', 3], ['villa', 2], ['modern', 2], ['victorian', 2], ['courtyard', 1], ['townhouse', 2], ['mansion', 0.5], ['tinyhouse', 0.5], ['adobe', 1]];
const D = {
  downtown: { table: [['tower15', 3], ['tower25', 2], ['tower40', 1], ['podium', 2], ['office4', 3], ['apartments6', 4], ['hotel', 1], ['parkinggarage', 1], ['bank', 1], ['cinema', 1], ['shoprow', 3], ['cornerstore', 2], ['arcade', 1]],
              gap: [2, 5], setback: [4, 6], scale: [0.95, 1.1], chance: 0.97, maxSlope: 0.3 },
  midtown:  { table: [['apartments6', 3], ['office4', 2], ['shoprow', 4], ['cornerstore', 3], ['townhouse', 3], ['rowhouse', 3], ['diner', 1], ['bar', 1], ['tyreshop', 1], ['carwash', 1], ['drivethru', 1], ['motel', 0.7], ['dealership', 0.5], ['busstation', 0.3]],
              gap: [3, 8], setback: [4, 7], scale: [0.9, 1.1], chance: 0.94, maxSlope: 0.32 },
  suburb:   { table: HOUSES, gap: [6, 14], setback: [9, 15], scale: [0.85, 1.15], chance: 0.9, maxSlope: 0.34 },
  rural:    { table: [['farmhouse', 3], ['ranch', 3], ['mobile', 2], ['cabin', 2], ['cottage', 2], ['warehouse', 1], ['diner', 0.5], ['motel', 0.5]],
              gap: [60, 220], setback: [12, 30], scale: [0.9, 1.15], chance: 0.8, maxSlope: 0.3 },
  hill:     { table: [['cabin', 4], ['aframe', 3], ['hillside', 3], ['tinyhouse', 1], ['cottage', 1]],
              gap: [90, 260], setback: [8, 16], scale: [0.9, 1.15], chance: 0.55, maxSlope: 0.42 },
  coast:    { table: [['stilts', 4], ['surfshop', 1], ['bar', 1], ['villa', 2], ['hut', 1], ['modern', 1], ['bungalow', 1]],
              gap: [6, 16], setback: [7, 12], scale: [0.9, 1.1], chance: 0.9, maxSlope: 0.3 },
};
// palette indices that suit a recipe (see PALETTE in pieces.js)
const COLOURS = {
  house: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], tower: [12, 13, 15, 8, 2], shop: [0, 1, 3, 6, 7, 8, 9, 10, 11, 14], brick: [16, 18, 20, 3], shed: [14, 12, 16, 17],
};
const colourFor = k => /tower|podium|office|hotel|apartments|parkinggarage|hospital/.test(k) ? pick(COLOURS.tower) : /townhouse|rowhouse|bar|factory|firestation|church|bank/.test(k) ? pick(COLOURS.brick) : /warehouse|hangar|tyreshop|busstation/.test(k) ? pick(COLOURS.shed) : /shop|store|diner|drivethru|motel|arcade|surfshop|dealership|carwash|cinema/.test(k) ? pick(COLOURS.shop) : pick(COLOURS.house);
const NAMES = {
  cornerstore: ['OOZI MART', 'OOBI FOODS', 'OODI DRUGS', 'OOLI LIQUOR', 'ZI MINI MART', 'CREST GROCERY', 'THE OO STORE', 'SQUARE MARKET'],
  diner: ['CANYON DINER', 'OOPI\'S', 'CREST DINER', 'ROUTE 78', 'MOM\'S', 'DIVOT DINER'], motel: ['MOTEL OO', 'CREST MOTEL', 'SEA VIEW', 'THE SLEEPY OO'],
  bar: ['THE DRIFT', 'OODI\'S', 'SLIP ANGLE', 'THE APEX', 'BOUNCE BAR'], drivethru: ['ZI BURGER', 'OO-BURGER', 'SPEEDWAY SUBS', 'TACO OOPI'],
  gasstation: ['BIG SLICK', 'OOZI GAS', 'DIVOT FUEL', 'CREST STOP'], hotel: ['HOTEL OO', 'GRAND OOZI', 'THE CREST'], arcade: ['PIER 9 ARCADE', 'OO ARCADE'],
  cinema: ['NOW SHOWING · MEGA MUSHROOM', 'NOW SHOWING · DRIFT KING 2', 'NOW SHOWING · THE OO'], dealership: ['HACHI MOTORS', 'OOZI AUTO', 'DRIFT KING MOTORS'],
};

// ------------------------------------------------------------ placing
const placed = [], grid = new Map(), GC = 50;
const aabb = (x, z, w, d, yaw) => { const cw = Math.abs(Math.cos(yaw)), sw = Math.abs(Math.sin(yaw)); return [x, z, w * cw + d * sw, w * sw + d * cw]; };
const gkeys = ([x, z, w, d]) => { const out = []; for (let j = Math.floor((z - d / 2 - WORLD.minZ) / GC); j <= Math.floor((z + d / 2 - WORLD.minZ) / GC); j++) for (let i = Math.floor((x - w / 2 - WORLD.minX) / GC); i <= Math.floor((x + w / 2 - WORLD.minX) / GC); i++) out.push(i * 10000 + j); return out; };
const overlaps = (a, b, m) => Math.abs(a[0] - b[0]) < (a[2] + b[2]) / 2 + m && Math.abs(a[1] - b[1]) < (a[3] + b[3]) / 2 + m;
function clashes(box, margin = 2) { for (const k of gkeys(box)) { const l = grid.get(k); if (l) for (const o of l) if (overlaps(box, o, margin)) return true; } return false; }
function remember(box) { for (const k of gkeys(box)) { let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(box); } }
// the four corners of a rotated lot (w across the front, d deep), a little expanded
function corners(x, z, w, d, yaw, m = 2) { const sy = Math.sin(yaw), cy = Math.cos(yaw), out = []; for (const [lx, lz] of [[-w / 2 - m, -d / 2 - m], [w / 2 + m, -d / 2 - m], [w / 2 + m, d / 2 + m], [-w / 2 - m, d / 2 + m]]) out.push([x + lx * cy + lz * sy, z - lx * sy + lz * cy]); return out; }
// can a lot go here? no deck under any corner, no water, no cliff, no canyon, no other lot
function fits(x, z, w, d, yaw, maxSlope) {
  if (T.paintAt(x, z) === 11 || T.land(x, z) < 3 || T.slopeAt(x, z) > maxSlope) return false;
  for (const [cx, cz] of [[x, z], ...corners(x, z, w, d, yaw)]) {
    if (T.land(cx, cz) < 2.5) return false;
    const n = T.nearestRoad(cx, cz); if (n && n.d < n.road.T.w / 2 + 2.5) return false;
  }
  return !clashes(aabb(x, z, w, d, yaw));
}
function place(k, x, z, yaw, sc, extra = {}) {
  const fp = FP[k], w = fp[0] * sc, d = fp[1] * sc;
  const o = { k, x: Math.round(x), z: Math.round(z), r: Math.round(yaw * 180 / Math.PI), s: +sc.toFixed(2), c: colourFor(k), seed: Math.floor(rnd() * 100000), b: 1, ...extra };
  if (NAMES[k]) o.text = pick(NAMES[k]);
  placed.push(o); remember(aabb(x, z, w, d, yaw));
  return o;
}
// where the junctions are along a road (its own ends and every road that ends on it)
const junctionsOf = new Map();
for (const r of T.roads) junctionsOf.set(r, [0, r.L]);
for (const j of T.junctions) if (j.o !== j.r) junctionsOf.get(j.o).push(j.s);
const nearJunction = (r, s, clear) => junctionsOf.get(r).some(js => Math.abs(js - s) < clear);
// keep Adam's own pieces; drop what this tool placed last time
const keep = (doc.objects || []).filter(o => !o.b);
for (const o of keep) if (FP[o.k]) { const fp = FP[o.k], s = o.s || 1; remember(aabb(o.x, o.z, fp[0] * s, fp[1] * s, (o.r || 0) * Math.PI / 180)); }
const BUILDABLE = new Set(['street', 'blvd', 'coast', 'highway', 'hill']);
const roads = T.roads.filter(r => BUILDABLE.has(r.type));

// ---- landmarks first: the first lot that fits, once each
const LANDMARKS = [
  ['school', ['suburb', 'midtown']], ['church', ['suburb', 'midtown']], ['hospital', ['midtown', 'downtown']], ['police', ['midtown', 'downtown']], ['firestation', ['midtown', 'suburb']],
  ['gasstation', ['rural', 'suburb']], ['gasstation', ['midtown', 'rural']], ['gasstation', ['suburb', 'coast']], ['watertower', ['hill', 'rural']], ['mast', ['hill']],
  ['lighthouse', ['coast']], ['mall', ['midtown', 'suburb']], ['stadium', ['suburb', 'rural']], ['drivein', ['rural', 'suburb']], ['dealership', ['midtown']], ['factory', ['rural', 'midtown']], ['busstation', ['downtown', 'midtown']],
];
const landmarksDone = [];
for (const [k, wants] of LANDMARKS) {
  const fp = FP[k]; if (!fp) continue;
  const order = roads.slice().sort(() => rnd() - 0.5);
  let done = false;
  for (const r of order) {
    if (done) break;
    const hw = r.T.w / 2;
    for (let s = 30; s < r.L - 30 && !done; s += 24) for (const side of [1, -1]) {
      const p = T.pointAt(r, s), nx = p.tz * side, nz = -p.tx * side;
      const dist = districtAt(p.x + nx * (hw + 30), p.z + nz * (hw + 30));
      if (!wants.includes(dist) || T.isBridge(r, s) || nearJunction(r, s, fp[0] / 2 + 16)) continue;
      const setback = k === 'lighthouse' || k === 'mast' ? 20 : 8, cx = p.x + nx * (hw + setback + fp[1] / 2), cz = p.z + nz * (hw + setback + fp[1] / 2);
      const yaw = Math.atan2(-nx, -nz);
      if (!fits(cx, cz, fp[0], fp[1], yaw, 0.28)) continue;
      place(k, cx, cz, yaw, 1); landmarksDone.push(k + '@' + dist); done = true; break;
    }
  }
}
console.log('landmarks:', landmarksDone.join(' '));

// ---- every street, both sides, lot by lot
const counts = {};
for (const r of roads) {
  const hw = r.T.w / 2;
  for (const side of [1, -1]) {
    let s = between(8, 30);
    while (s < r.L - 8) {
      const p = T.pointAt(r, s), nx = p.tz * side, nz = -p.tx * side;
      const dist = districtAt(p.x + nx * (hw + 22), p.z + nz * (hw + 22)), spec = D[dist];
      if (!spec) { s += 40; continue; }
      const k = weighted(spec.table), fp = FP[k], sc = +between(spec.scale[0], spec.scale[1]).toFixed(2);
      const w = fp[0] * sc, dep = fp[1] * sc, gap = between(spec.gap[0], spec.gap[1]), setback = between(spec.setback[0], spec.setback[1]);
      // the lot's centre: the building's own front is +z in its frame, so it turns to face the road
      const cx = p.x + nx * (hw + setback + dep / 2), cz = p.z + nz * (hw + setback + dep / 2), yaw = Math.atan2(-nx, -nz);
      const ok = rnd() < spec.chance && !T.isBridge(r, s) && !nearJunction(r, s, w / 2 + 12) && fits(cx, cz, w, dep, yaw, spec.maxSlope);
      if (ok) { const kk = dist === 'hill' && T.slopeAt(cx, cz) > 0.3 ? 'hillside' : k; place(kk === 'hillside' && !FP.hillside ? k : kk, cx, cz, yaw, sc); counts[dist] = (counts[dist] || 0) + 1; s += w + gap; }
      else s += Math.max(8, w * 0.45);
    }
  }
}
console.log('buildings by district:', JSON.stringify(counts));

// ---- street lamps where it's a town: every 36 m, alternating sides, the arm over the kerb
let lamps = 0;
for (const r of roads) {
  if (r.type === 'hill') continue;
  const hw = r.T.w / 2; let side = 1;
  for (let s = 18; s < r.L - 10; s += 36, side = -side) {
    const p = T.pointAt(r, s), nx = p.tz * side, nz = -p.tx * side;
    const dist = districtAt(p.x + nx * (hw + 20), p.z + nz * (hw + 20));
    if (dist !== 'downtown' && dist !== 'midtown' && !(dist === 'coast' && rnd() < 0.5)) continue;
    if (T.isBridge(r, s) || nearJunction(r, s, 12)) continue;
    const x = p.x + nx * (hw + 1.4), z = p.z + nz * (hw + 1.4);
    if (clashes([x, z, 1, 1], 1.5)) continue;
    placed.push({ k: 'lamp', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(Math.atan2(nz, -nx) * 180 / Math.PI), s: 1, seed: Math.floor(rnd() * 1000), b: 1 }); lamps++;
  }
}
console.log('lamps:', lamps);

doc.objects = [...keep, ...placed];
doc.t = Date.now();
delete doc.terrainData;
writeFileSync(docPath, JSON.stringify(doc, null, 1));
console.log(`wrote ${docPath}: ${keep.length} kept + ${placed.length} placed (${placed.length - lamps} buildings)`);
