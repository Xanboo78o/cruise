// world/build.js — turns the spec + terrain into meshes: the land in tiles,
// the sea, every road as a ribbon with junction plates, kerb lines, the sand,
// the pier, and a forest that covers everything that isn't something else.
// Trees are instanced per 300 m chunk (near) with a merged cone forest behind
// (far), so only what's close costs anything. Buildings go through chunks.js.

import * as THREE from 'three';
import { WORLD, ROAD_TYPES, DISTRICTS, COAST, CANYON } from './spec.js';
import { terrainSurface, roadSurface } from '../look/materials.js';   // LOOK: materials only
import { vnoise } from '../terrain.js';
import { Districts } from './districts.js';
import { EditLayer } from './edits.js';
import { CityAtlas, Chunks, GlowLayer } from './chunks.js';
import { footprint } from './pieces.js';
import { Q } from '../quality.js';
import { Water } from './water.js';
import { Birds } from './birds.js';

const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// the map maker's paint: index → ground colour (0 = none = the automatic rules)
export const PAINT = [null,
  new THREE.Color(0x4e7a3f), new THREE.Color(0x3f7a3a), new THREE.Color(0x9a9a4a), new THREE.Color(0x7fa24a), new THREE.Color(0x6a8a5a),
  new THREE.Color(0xd9c78f), new THREE.Color(0x8a6a4a), new THREE.Color(0x8a7a66), new THREE.Color(0x4a4f58), new THREE.Color(0xe8e6e0), new THREE.Color(0xb5613f), new THREE.Color(0x2b6b8a)];
export const PAINT_NAMES = ['AUTO', 'GRASS', 'LUSH GRASS', 'DRY GRASS', 'MEADOW', 'ALPINE GRASS', 'SAND', 'DIRT', 'ROCK', 'ASPHALT', 'SNOW', 'RED ROCK', 'WATER'];

// a seamless bit of ground grain so the land reads: periodic value noise,
// four octaves, tiled every 16 m by world-space UVs, ±8 % around 0.93
let groundTex = null;
function groundTexture() {
  if (groundTex) return groundTex;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const lat = (n, seed) => { const a = new Float32Array(n * n); for (let i = 0; i < n * n; i++) { const h = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; a[i] = h - Math.floor(h); } return a; };
  const sample = (a, n, u, v) => { const x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (p, q) => a[((q % n + n) % n) * n + ((p % n + n) % n)];
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy; };
  const oct = [[8, 1, 0.45], [16, 2, 0.28], [32, 3, 0.17], [128, 4, 0.10]].map(([n, sd, w]) => [lat(n, sd), n, w]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0; for (const [a, n, w] of oct) v += (sample(a, n, x / N, y / N) - 0.5) * w;
    const k = Math.round(255 * (0.93 + v * 0.16)), i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, k)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  groundTex = new THREE.CanvasTexture(c);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.anisotropy = 2;
  return groundTex;
}
function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }

export class WorldBuilder {
  constructor(T, scene, opts = {}) {
    this.T = T; this.scene = scene; this.sky = opts.sky || 'noon';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = [];                                    // forest chunks: {cx, cz, near, far}
    this.atlas = new CityAtlas();
    this.city = new Chunks(this.group, this.atlas);
    this.glow = new GlowLayer(this.group);
    this.doc = opts.doc || { autofill: true, objects: [] };
    this.buildTerrain();
    this.buildWater();
    this.buildRoads();
    this.farChunks = [];
    if (this.doc.autofill !== false || this.doc.forest) this.buildForest();   // the base forest: instanced, everywhere the land is free
    this.buildBeachAndPier();
    this.birds = new Birds(this.group, T, Q);                   // flocks over the hills, one draw call
    // the old auto-filled districts, until the city tool has replaced them
    this.districts = this.doc.autofill !== false ? new Districts(T, this.group, this.sky === 'night', this.city, this.glow) : { walls: [] };
    this.city.finish({ shadows: Q.shadows });
    this.glow.finish();
    // everything placed by hand
    this.edits = new EditLayer(this.group, this.atlas, T);
    this.edits.load(this.doc.objects || []);
    // four real lights that hop between the nearest lamps to the player
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 42, 2); l.visible = false; this.group.add(l); this.lights.push(l); }
    this.lightT = 0;
    this.setNight(this.sky === 'night');
  }

  setNight(n) {
    this.night = n;
    this.atlas.setNight(n); this.glow.setNight(n); this.edits.setNight(n);
    for (const l of this.lights) l.visible = n;
  }
  get walls() { return this._wallsFor === this.edits.walls ? this._walls : (this._wallsFor = this.edits.walls, this._walls = [...this.districts.walls, ...this.edits.walls]); }
  // the nearest chimneys to (px, pz), re-picked every half second; main puffs smoke out of them
  nearChimneys(px, pz, dt) {
    this.chimT = (this.chimT || 0) - dt; if (this.chimT > 0 && this._chim) return this._chim;
    this.chimT = 0.5;
    const all = this.edits.chimneys, best = [];
    for (const c of all) { const d = (c[0] - px) ** 2 + (c[2] - pz) ** 2; if (d > 200 * 200) continue; if (best.length < 14 || d < best[13].d) { best.push({ d, c }); best.sort((a, b) => a.d - b.d); if (best.length > 14) best.pop(); } }
    return (this._chim = best.map(b => b.c));
  }

  // the real lights: the four nearest lamp heads to (px, pz)
  updateLights(px, pz, dt) {
    this.lightT -= dt; if (this.lightT > 0 || !this.night) return;
    this.lightT = 0.2;
    const lamps = this.edits.lamps.length ? [...this.glow.lamps, ...this.edits.lamps] : this.glow.lamps; if (!lamps.length) return;
    const best = [];
    for (const l of lamps) { const d = (l[0] - px) ** 2 + (l[2] - pz) ** 2; if (best.length < 4 || d < best[3].d) { best.push({ d, l }); best.sort((a, b) => a.d - b.d); if (best.length > 4) best.pop(); } }
    this.lights.forEach((L, i) => { const b = best[i]; if (!b) { L.intensity = 0; return; } L.position.set(b.l[0], b.l[1] - 0.4, b.l[2]); L.intensity = 900; });
  }

  // ---------------------------------------------------------------- terrain
  // one height grid, coloured, split into tiles so the far side of the world
  // is frustum-culled instead of drawn every frame
  buildTerrain() {
    const T = this.T, cell = T.constructor.CELL;
    const w = Math.ceil((WORLD.maxX - WORLD.minX) / cell), h = Math.ceil((WORLD.maxZ - WORLD.minZ) / cell);
    const pos = new Float32Array((w + 1) * (h + 1) * 3), col = new Float32Array((w + 1) * (h + 1) * 3);
    const cGrass = new THREE.Color(0x5c9048), cDark = new THREE.Color(0x3f6a34), cRock = new THREE.Color(0x8a7a66), cSnow = new THREE.Color(0xe8e6e0);
    const cSand = new THREE.Color(0xd9c78f), cRed = new THREE.Color(0xb5613f), cFloor = new THREE.Color(0x9a7a5a), cCity = new THREE.Color(0x6c6f74);
    const tmp = new THREE.Color();
    const cLush = new THREE.Color(0x4a9044), cDirt = new THREE.Color(0x8a7050), cGrey = new THREE.Color(0x857c70), cField = new THREE.Color(0xa8a854);
    // paint wins; otherwise the land colours itself: grass with a slow drift between
    // types, dirt on the slopes, rock where it's steep, red rock where it's been dug
    // deep, snow up high, sand at the water
    this.terrainColor = (x, z, y, out = tmp) => {
      const n = vnoise(x * 0.03, z * 0.03), n2 = vnoise(x * 0.006 + 3.1, z * 0.006 + 1.7);
      const pt = T.paintAt(x, z);
      if (pt && PAINT[pt]) return out.copy(PAINT[pt]).lerp(cDark, n * 0.22);
      let c = out.copy(cGrass).lerp(cLush, n2).lerp(cDark, n * 0.35);
      // fields: big patches of drier, yellower grass — art of rally's patchwork — with a hard-ish edge
      const n3 = vnoise(x * 0.0045 + 9.2, z * 0.0045 + 5.7);
      if (n3 > 0.6) c.lerp(cField, sm((n3 - 0.6) / 0.08) * 0.85);
      if (!T.flat) {
        const carve = T.canyonCarve(x, z);
        if (carve < -1) c = out.copy(carve < -T.constructor.depth ? cFloor : cRed).lerp(cFloor, sm((-carve - 40) / 45)).lerp(cRed, n * 0.3);
        const d = T.districtAt(x, z);
        if (d && d.fill === 'beach') c = out.copy(cSand).lerp(cGrass, sm((z - d.z0 - 200) / 120));
        else if (d && (d.fill === 'towers' || d.fill === 'harbor' || d.fill === 'docks')) c = out.copy(cCity).lerp(cGrass, 0.35);
        else if (d && d.fill === 'houses') c = out.copy(cGrass).lerp(cSand, 0.15);
      }
      const s = T.slopeAt(x, z), dug = T.dhEmpty ? 0 : T.dhAt(x, z);
      if (s > 0.22) c.lerp(cDirt, sm((s - 0.22) / 0.2));
      if (s > 0.42) c.lerp(cGrey, sm((s - 0.42) / 0.22));
      if (dug < -3) c.lerp(dug < -25 ? cRed : cRock, sm((-dug - 3) / 14) * (0.5 + 0.5 * s));
      const snowLine = 1500 + n2 * 300;                       // Angeles-Crest scale: snow on the high peaks only
      if (y > snowLine) c.lerp(cSnow, sm((y - snowLine) / 45) * (1 - s * 0.7));
      if (y < 1.5) c.copy(cSand); else if (y < 4.5) c.lerp(cSand, 1 - (y - 1.5) / 3);
      return c;
    };
    T.buildMesh();                                              // the drawn ground: land() on this very grid, road corridors flagged
    const my = T.my, flag = T.mFlag;
    let i = 0;
    for (let j = 0; j <= h; j++) for (let k = 0; k <= w; k++) {
      const x = WORLD.minX + k * cell, z = WORLD.minZ + j * cell;
      const y = my[i];
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const c = this.terrainColor(x, z, y);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      i++;
    }
    // normals on the whole grid first, so tile edges don't show a seam
    const full = new THREE.BufferGeometry();
    full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const fidx = new Uint32Array(w * h * 6);
    let q = 0;
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) {
      const a = j * (w + 1) + k;
      fidx[q++] = a; fidx[q++] = a + w + 1; fidx[q++] = a + 1; fidx[q++] = a + 1; fidx[q++] = a + w + 1; fidx[q++] = a + w + 2;
    }
    full.setIndex(new THREE.BufferAttribute(fidx, 1));
    full.computeVertexNormals();
    const nrm = full.attributes.normal.array;
    full.dispose();
    // tiles of TILE×TILE cells (≈1 km): ~30 draw calls at most, half of them culled
    const TILE = 72, mat = Q.pbr
      ? terrainSurface('dirt', 'cliff', { vertexColors: true })   // scanned, flat below / rock on the steep
      : new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTexture() });
    this.terrainTiles = [];
    for (let tj = 0; tj < h; tj += TILE) for (let tk = 0; tk < w; tk += TILE) {
      const cw = Math.min(TILE, w - tk), chh = Math.min(TILE, h - tj);
      const tp = new Float32Array((cw + 1) * (chh + 1) * 3), tc = new Float32Array((cw + 1) * (chh + 1) * 3), tn = new Float32Array((cw + 1) * (chh + 1) * 3), tuv = new Float32Array((cw + 1) * (chh + 1) * 2);
      let m = 0;
      for (let j = 0; j <= chh; j++) for (let k = 0; k <= cw; k++) {
        const src = ((tj + j) * (w + 1) + (tk + k)) * 3;
        tuv[(m / 3) * 2] = pos[src] / 16; tuv[(m / 3) * 2 + 1] = pos[src + 2] / 16;
        tp[m] = pos[src]; tp[m + 1] = pos[src + 1]; tp[m + 2] = pos[src + 2];
        tc[m] = col[src]; tc[m + 1] = col[src + 1]; tc[m + 2] = col[src + 2];
        tn[m] = nrm[src]; tn[m + 1] = nrm[src + 1]; tn[m + 2] = nrm[src + 2];
        m += 3;
      }
      // no terrain within SH of an at-grade deck: a road draws its own ground there
      // (its shoulder strip), so the coarse mesh can never poke up through a slab
      const ti = new Uint32Array(cw * chh * 6);
      let qq = 0;
      const F = (j, k) => flag[(tj + j) * (w + 1) + (tk + k)];
      for (let j = 0; j < chh; j++) for (let k = 0; k < cw; k++) {
        const a = j * (cw + 1) + k, f00 = F(j, k), f10 = F(j, k + 1), f01 = F(j + 1, k), f11 = F(j + 1, k + 1);
        if (!(f00 || f01 || f10)) { ti[qq++] = a; ti[qq++] = a + cw + 1; ti[qq++] = a + 1; }
        if (!(f10 || f01 || f11)) { ti[qq++] = a + 1; ti[qq++] = a + cw + 1; ti[qq++] = a + cw + 2; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      g.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(tn, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
      g.setIndex(new THREE.BufferAttribute(ti.subarray(0, qq), 1));
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.userData = { tk, tj, cw, chh, cell };
      this.group.add(mesh);
      this.terrainTiles.push(mesh);
    }
    this.terrainMesh = this.terrainTiles[0];
    this.terrainCell = cell;
  }

  // the map maker sculpted or painted within r of (x, z): move the tile vertices there
  terrainRefresh(x, z, r) {
    const T = this.T, cell = this.terrainCell;
    for (const tile of this.terrainTiles) {
      const { tk, tj, cw, chh } = tile.userData;
      const x0 = WORLD.minX + tk * cell, z0 = WORLD.minZ + tj * cell, x1 = x0 + cw * cell, z1 = z0 + chh * cell;
      if (x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1) continue;
      const pos = tile.geometry.attributes.position, col = tile.geometry.attributes.color;
      let touched = false;
      for (let j = 0; j <= chh; j++) for (let k = 0; k <= cw; k++) {
        const vx = x0 + k * cell, vz = z0 + j * cell;
        if (Math.abs(vx - x) > r + cell || Math.abs(vz - z) > r + cell) continue;
        const i = j * (cw + 1) + k, y = T.land(vx, vz); T.meshSet(tk + k, tj + j, y);
        pos.setY(i, y); const c = this.terrainColor(vx, vz, y); col.setXYZ(i, c.r, c.g, c.b); touched = true;
      }
      if (touched) { pos.needsUpdate = true; col.needsUpdate = true; tile.geometry.computeVertexNormals(); tile.geometry.computeBoundingSphere(); }
    }
  }

  buildWater() {
    this.water = new Water(this.T, this.group, Q);              // shore-aware shader plane (water.js)
    this.sea = this.water.mesh;
  }

  // ------------------------------------------------------------------ roads
  // a road is a slab: a deck, a skirt down each side (to the ground when it's at
  // grade, a 1.6 m edge when it's a bridge), a kerb along paved edges, and
  // pillars wherever the deck is well above the land
  buildRoads() {
    const T = this.T, SH = T.constructor.SH;
    // vertex colours are TONE only now — the road material (look/materials.js roadSurface) supplies the surface
    // from aRoad = (lat, along, half width, kind): 0 paved 1 gravel 2 sand 3 pier 4 kerb 5 concrete 6 ground
    const paved = new THREE.Color(0xc8ccd2), gravel = new THREE.Color(0xa8967a), sand = new THREE.Color(0xe0cf98), pier = new THREE.Color(0xa08668);
    const concrete = new THREE.Color(0xb0aca4), pillarC = new THREE.Color(0x9c9890), kerbC = new THREE.Color(0xd8d4cc);
    const KIND = { road: 0, gravel: 1, sand: 2 };
    const pos = [], col = [], uv = [], idx = [], road = [];
    const V = (x, y, z, c, lat = 0, along = 0, hw = 0, kind = 6) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); uv.push(x / 16, z / 16); road.push(lat, along, hw, kind); return pos.length / 3 - 1; };
    // a,b,c,d are given CLOCKWISE seen from the outside (the deck from above, a skirt from the road's side),
    // so the triangles are emitted reversed: normals point up/out and the mesh renders FrontSide
    const quad = (a, b, c, d) => idx.push(a, c, b, a, d, c);
    // the shoulder: the road's own ground out to SH m (the cut wall, the embankment —
    // exactly what the wheels get from T.height), then a cover band to 36 m that lies
    // just under the terrain mesh. The mesh has no triangles within SH of an at-grade
    // deck, so this is the only ground there and nothing can poke up through a slab.
    const OUT = [0, 4, 9, 16, 26, 36];                                        // from the deck edge itself: no slot under an unkerbed edge
    const gc = new THREE.Color();
    for (const r of T.roads) {
      const hw = r.T.w / 2, step = 6;
      const n = Math.max(2, Math.ceil(r.L / step) + 1);
      const c = r.T.surf === 'gravel' ? gravel : r.T.surf === 'sand' ? sand : r.type === 'pier' ? pier : paved;
      const kerbed = r.T.surf === 'road' && r.type !== 'pier', skirted = r.type !== 'sand', shouldered = r.type !== 'sand' && r.type !== 'pier';
      const K = r.type === 'pier' ? 3 : (KIND[r.T.surf] ?? 0), lineHw = r.T.surf === 'road' && r.type !== 'pier' ? hw : 0;   // markings on paved decks only
      let prev = null, sincePillar = 0;
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1)) * r.L;
        const p = T.pointAt(r, s), ry = T.roadY(r, s), y = ry + 0.08, bridge = T.isBridge(r, s);
        const nx = p.tz, nz = -p.tx;
        const shade = 1 - 0.15 * vnoise(p.x * 0.05, p.z * 0.05);
        const cs = c.clone().multiplyScalar(shade);
        const L = [p.x + nx * hw, p.z + nz * hw], R = [p.x - nx * hw, p.z - nz * hw];
        const skirtY = bridge ? y - 1.6 : y - 1.2;                                                   // a 1.6 m slab edge on a bridge; buried in the shoulder otherwise
        const cur = {
          dl: V(L[0], y, L[1], cs, hw, s, lineHw, K), dr: V(R[0], y, R[1], cs, -hw, s, lineHw, K),                                       // deck edges
          sl: V(L[0], skirtY, L[1], concrete, 0, 0, 0, 5), sr: V(R[0], skirtY, R[1], concrete, 0, 0, 0, 5),
          kl: kerbed ? [V(L[0], y + 0.3, L[1], kerbC, 0, 0, 0, 4), V(L[0] - nx * 0.55, y + 0.3, L[1] - nz * 0.55, kerbC, 0, 0, 0, 4), V(L[0] - nx * 0.55, y, L[1] - nz * 0.55, kerbC, 0, 0, 0, 4)] : null,
          kr: kerbed ? [V(R[0], y + 0.3, R[1], kerbC, 0, 0, 0, 4), V(R[0] + nx * 0.55, y + 0.3, R[1] + nz * 0.55, kerbC, 0, 0, 0, 4), V(R[0] + nx * 0.55, y, R[1] + nz * 0.55, kerbC, 0, 0, 0, 4)] : null,
          shl: null, shr: null,
        };
        if (shouldered) {
          cur.shl = []; cur.shr = [];
          for (const o of OUT) {
            const under = bridge ? 0.05 : o > SH ? 0.4 : 0;                                          // the cover band sits well under the mesh (0.05 z-fought on steep ground: a torn look)
            const lx = p.x + nx * (hw + o), lz = p.z + nz * (hw + o), rx = p.x - nx * (hw + o), rz = p.z - nz * (hw + o);
            const ly = T.height(lx, lz) - under, ryy = T.height(rx, rz) - under;
            cur.shl.push(V(lx, ly, lz, this.terrainColor(lx, lz, ly, gc)));
            cur.shr.push(V(rx, ryy, rz, this.terrainColor(rx, rz, ryy, gc)));
          }
        }
        if (prev) {
          quad(prev.dl, cur.dl, cur.dr, prev.dr);                                                   // deck (faces up)
          if (skirted) { quad(prev.sl, cur.sl, cur.dl, prev.dl); quad(prev.dr, cur.dr, cur.sr, prev.sr); }   // skirts (face out)
          if (kerbed) {
            quad(prev.kl[0], cur.kl[0], cur.kl[1], prev.kl[1]); quad(prev.kl[1], cur.kl[1], cur.kl[2], prev.kl[2]);   // left kerb: top, inner face
            quad(prev.kr[1], cur.kr[1], cur.kr[0], prev.kr[0]); quad(prev.kr[2], cur.kr[2], cur.kr[1], prev.kr[1]);   // right kerb
          }
          if (shouldered) for (let k = 0; k < OUT.length - 1; k++) {                                // shoulders (face up, like the deck)
            quad(prev.shl[k + 1], cur.shl[k + 1], cur.shl[k], prev.shl[k]);
            quad(prev.shr[k], cur.shr[k], cur.shr[k + 1], prev.shr[k + 1]);
          }
        }
        // one pier under a bridge every 40 m
        sincePillar += prev ? step : 0;
        if (bridge && sincePillar >= 40 && r.type !== 'pier') {
          sincePillar = 0;
          const cx = p.x, cz = p.z, hwid = Math.min(3, hw * 0.4), bottom = T.meshY(cx, cz) - 1.5;
          const a = [cx + nx * hwid + p.tx * hwid, cz + nz * hwid + p.tz * hwid], b = [cx - nx * hwid + p.tx * hwid, cz - nz * hwid + p.tz * hwid];
          const d = [cx - nx * hwid - p.tx * hwid, cz - nz * hwid - p.tz * hwid], e = [cx + nx * hwid - p.tx * hwid, cz + nz * hwid - p.tz * hwid];
          // each face gets its own four vertices, both windings: shared vertices with opposite windings
          // averaged to a zero normal and the piers rendered black
          const corners = [a, b, d, e];
          for (let k = 0; k < 4; k++) {
            const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 4];
            for (const flip of [false, true]) {
              const b1 = V(x1, bottom, z1, pillarC, 0, 0, 0, 5), b2 = V(x2, bottom, z2, pillarC, 0, 0, 0, 5);
              const t2 = V(x2, ry - 0.3, z2, pillarC, 0, 0, 0, 5), t1 = V(x1, ry - 0.3, z1, pillarC, 0, 0, 0, 5);
              if (flip) quad(t1, t2, b2, b1); else quad(b1, b2, t2, t1);
            }
          }
        }
        prev = cur;
      }
      // end caps: the terrain is cut away for hw + SH around a road END too, so a fan of
      // cover (just under the deck, the shoulder, then the mesh) closes the hole at a dead end
      if (shouldered) for (const end of [0, 1]) {
        const p = T.pointAt(r, end ? r.L : 0), cx = p.x, cz = p.z, base2 = pos.length / 3, spokes = 16, rings = [hw, hw + 16, hw + 36];
        const yc = T.height(cx, cz) - 0.05; pos.push(cx, yc, cz); col.push(gc.r, gc.g, gc.b); uv.push(cx / 16, cz / 16); road.push(0, 0, 0, 6);
        for (let ri = 0; ri < rings.length; ri++) for (let k = 0; k < spokes; k++) {
          const a = k / spokes * Math.PI * 2, x = cx + Math.cos(a) * rings[ri], z = cz + Math.sin(a) * rings[ri], y = T.height(x, z) - 0.05;
          this.terrainColor(x, z, y, gc); pos.push(x, y, z); col.push(gc.r, gc.g, gc.b); uv.push(x / 16, z / 16); road.push(0, 0, 0, 6);
        }
        for (let k = 0; k < spokes; k++) { const k2 = (k + 1) % spokes; idx.push(base2, base2 + 1 + k2, base2 + 1 + k); }
        for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < spokes; k++) { const k2 = (k + 1) % spokes, i0 = base2 + 1 + ri * spokes, i1 = i0 + spokes; quad(i0 + k, i0 + k2, i1 + k2, i1 + k); }
      }
      // junction plates: a disc at every polyline vertex so crossings don't show seams
      const shadeAt = (x, z) => 1 - 0.15 * vnoise(x * 0.05, z * 0.05);                             // the deck's own mottling, so a plate is invisible on it
      for (const [x, z] of r.pts) {
        const y = T.height(x, z) + 0.09;
        const base2 = pos.length / 3, segs = 14;
        let sh = shadeAt(x, z);
        pos.push(x, y, z); col.push(c.r * sh, c.g * sh, c.b * sh); uv.push(x / 16, z / 16); road.push(0, 0, 0, K);   // a plate: the deck's surface, no markings
        for (let k = 0; k <= segs; k++) {
          const a = k / segs * Math.PI * 2, px = x + Math.cos(a) * hw, pz = z + Math.sin(a) * hw;
          pos.push(px, T.height(x + Math.cos(a) * hw * 0.9, z + Math.sin(a) * hw * 0.9) + 0.09, pz);
          sh = shadeAt(px, pz); col.push(c.r * sh, c.g * sh, c.b * sh); uv.push(px / 16, pz / 16); road.push(0, 0, 0, K);
          if (k < segs) idx.push(base2, base2 + 2 + k, base2 + 1 + k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 4));
    g.setIndex(idx); g.computeVertexNormals();
    // one material reads aRoad and draws asphalt + markings, kerb, concrete, or the terrain's own ground
    const mesh = new THREE.Mesh(g, roadSurface({ pbr: Q.pbr, noise: groundTexture() }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.roadMesh = mesh;
  }

  // ----------------------------------------------------------------- forest
  // trees on a jittered grid, everywhere that isn't road, water, sand, canyon
  // floor, district or above the treeline. Per chunk: an instanced full tree
  // (trunk + crown merged, one draw call per kind) near, and a merged static
  // crown-only forest far. Both frustum-culled.
  buildForest() {
    const T = this.T, CH = 300, spacing = 17, docWorld = this.doc.autofill === false;
    // the doc world: the forest thins where the streets are dense (gardens, not woods,
    // between houses), keeps off every lot, the red mesa and the steep walls
    let urbanAt = () => 0, lotAt = () => false;
    if (docWorld) {
      const DG = 40, DW = Math.ceil((WORLD.maxX - WORLD.minX) / DG) + 2, DH = Math.ceil((WORLD.maxZ - WORLD.minZ) / DG) + 2, dens = new Float32Array(DW * DH);
      for (const r of T.roads) if (r.type === 'street' || r.type === 'blvd' || r.type === 'highway' || r.type === 'coast') for (let s = 0; s < r.L; s += 8) { const p = T.pointAt(r, s), i = Math.floor((p.x - WORLD.minX) / DG), j = Math.floor((p.z - WORLD.minZ) / DG); if (i >= 0 && j >= 0 && i < DW && j < DH) dens[j * DW + i] += 8; }
      const integ = new Float64Array((DW + 1) * (DH + 1));
      for (let j = 1; j <= DH; j++) for (let i = 1; i <= DW; i++) integ[j * (DW + 1) + i] = dens[(j - 1) * DW + (i - 1)] + integ[(j - 1) * (DW + 1) + i] + integ[j * (DW + 1) + i - 1] - integ[(j - 1) * (DW + 1) + i - 1];
      urbanAt = (x, z) => { const R = 5, ci = Math.floor((x - WORLD.minX) / DG), cj = Math.floor((z - WORLD.minZ) / DG), i0 = Math.max(0, ci - R), i1 = Math.min(DW, ci + R + 1), j0 = Math.max(0, cj - R), j1 = Math.min(DH, cj + R + 1); return integ[j1 * (DW + 1) + i1] - integ[j0 * (DW + 1) + i1] - integ[j1 * (DW + 1) + i0] + integ[j0 * (DW + 1) + i0]; };
      const LG = 10, LW = Math.ceil((WORLD.maxX - WORLD.minX) / LG) + 1, LH = Math.ceil((WORLD.maxZ - WORLD.minZ) / LG) + 1, lots = new Uint8Array(LW * LH);
      for (const o of this.doc.objects || []) { const fp = footprint(o); if (!fp) continue; const m = 5, i0 = Math.max(0, Math.floor((fp[0] - fp[2] / 2 - m - WORLD.minX) / LG)), i1 = Math.min(LW - 1, Math.ceil((fp[0] + fp[2] / 2 + m - WORLD.minX) / LG)), j0 = Math.max(0, Math.floor((fp[1] - fp[3] / 2 - m - WORLD.minZ) / LG)), j1 = Math.min(LH - 1, Math.ceil((fp[1] + fp[3] / 2 + m - WORLD.minZ) / LG)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lots[j * LW + i] = 1; }
      lotAt = (x, z) => { const i = Math.floor((x - WORLD.minX) / LG), j = Math.floor((z - WORLD.minZ) / LG); return i >= 0 && j >= 0 && i < LW && j < LH && lots[j * LW + i] === 1; };
    }
    const ring = []; for (let k = 0; k < 8; k++) ring.push([Math.cos(k * Math.PI / 4) * 220, Math.sin(k * Math.PI / 4) * 220]);
    // a tree is ONE merged geometry per kind (trunk + crown parts), vertex-coloured,
    // the crown shaded darker toward its foot so it reads as a mass with an underside
    const cyl = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 5), cone = (r, h) => new THREE.ConeGeometry(r, h, 7), ico = r => new THREE.IcosahedronGeometry(r, 0);
    const kinds = [
      { lc: 0x3f7a3f, leafY: 9.5, parts: [[cyl(0.3, 0.48, 8), 2.5, 0x5c4632], [cone(3.6, 5.5), 4.6, 0x2f6236], [cone(2.9, 5), 7.6, 0x3a7a40], [cone(2.0, 4.6), 10.4, 0x4a8f48]] },   // pine: three tiers
      { lc: 0x5a9a44, leafY: 6.5, parts: [[cyl(0.32, 0.5, 7), 2, 0x6a5238], [ico(3.6), 6.4, 0x4f8a3a], [ico(2.6), 8.3, 0x62a04a], [ico(2.2), 6.9, 0x56943f, 2.3, 0, 0.8], [ico(2.0), 6.6, 0x4a8438, -2.2, 0, -0.6]] },   // broadleaf: a cluster
      { lc: 0x58a052, leafY: 8.2, parts: [[cyl(0.22, 0.34, 9.5), 3.3, 0x8a7355], [cone(3.8, 1.6), 8.0, 0x4f8a4a], [cone(2.6, 2.4), 8.3, 0x62a052], [ico(0.8), 8.4, 0x8a7a40]] },   // palm-ish: a flat crown
      { lc: 0xd08038, leafY: 6.4, parts: [[cyl(0.32, 0.5, 7), 2, 0x6a5238], [ico(3.3), 6.2, 0xc9742f], [ico(2.4), 8.0, 0xe09a3c], [ico(2.1), 6.6, 0xb8602a, 2.2, 0, 0.6], [ico(1.9), 6.4, 0xd48a34, -2.1, 0, -0.9]] },   // autumn
      { lc: 0x2c5a34, leafY: 11.5, parts: [[cyl(0.3, 0.5, 9.5), 3.2, 0x4a3a2a], [cone(3.6, 6.5), 5.6, 0x21422a], [cone(2.9, 6), 9.0, 0x2a5232], [cone(1.9, 5.5), 12.2, 0x34633a]] },   // dark pine, up high
    ];
    const treeGeo = kinds.map(k => mergeColoured(k.parts.map(([g, y, c, x = 0, _z = 0, z = 0]) => [g, y, c, x, 0, z, 1]), true));
    const farCone = new THREE.ConeGeometry(3.4, 9, 5);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // the wind: every instanced tree leans and sways from about 1.5 m up, phased by where it
    // stands so a hillside moves as a crowd, not a chorus line. Vertex-only — the tree's
    // own geometry never changes, so it costs nothing on the CPU.
    this.wind = { value: 0 };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.wind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 wp0 = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 wp0 = vec3(0.0);
          #endif
          float hgt = max(0.0, position.y - 1.5);
          float ph = uTime * 1.1 + wp0.x * 0.13 + wp0.z * 0.17;
          float sw = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.7)) * 0.02 * hgt;
          transformed.x += sw; transformed.z += sw * 0.6;`);
    };
    mat.customProgramCacheKey = () => 'forestwind';
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    const keep = 0.28 + (1 - Q.treeDensity) * 0.72;      // hash threshold: LOW thins the forest
    let total = 0;
    const farPool = new Map();
    for (let cz = WORLD.minZ; cz < WORLD.maxZ; cz += CH) for (let cx = WORLD.minX; cx < WORLD.maxX; cx += CH) {
      const spots = [[], [], [], [], []];
      for (let z = cz; z < cz + CH; z += spacing) for (let x = cx; x < cx + CH; x += spacing) {
        const jx = x + (hash2(x, z) - 0.5) * spacing * 0.9, jz = z + (hash2(z, x) - 0.5) * spacing * 0.9;
        const r = hash2(jx * 0.37, jz * 0.53);
        if (r < keep) continue;
        const y = T.height(jx, jz);
        if (y < 3.5) continue;                                              // water / sand
        if (T.districtAt(jx, jz)) continue;
        const nr = T.nearestRoad(jx, jz);
        if (nr && nr.d < nr.road.T.w / 2 + (docWorld ? 10 : 7)) continue;
        if (T.canyonCarve(jx, jz) < -8) continue;                           // canyon walls and floor
        if (y > 380) continue;                                              // treeline
        let kind;
        if (docWorld) {
          if (T.paintAt(jx, jz) === 11 || lotAt(jx, jz)) continue;          // the red mesa, somebody's lot
          const slope = T.slopeAt(jx, jz); if (slope > 0.55) continue;     // a wall, not a hillside
          const u = Math.min(1, urbanAt(jx, jz) / 2600);                    // in town: gardens, not woods
          if (hash2(jz * 0.71, jx * 0.29) < 0.9 * Math.pow(u, 0.6)) continue;
          const coastal = y < 14 && ring.filter(([ox, oz]) => T.land(jx + ox, jz + oz) < 0.5).length >= 3;   // a shore, not a creek
          if (coastal) kind = r < 0.7 ? 2 : 1;
          else if (y > 200) kind = 4;
          else if (y > 110 || slope > 0.3) kind = r < 0.8 ? 0 : 4;
          else kind = r < 0.45 ? 1 : r < 0.72 ? 3 : 0;
        } else {
          // the old world: palms low near the coast, autumn mid, broadleaf, pines up high
          const coastal = jz < -1200 ? 1 : 0;
          kind = coastal && r < 0.7 ? 2 : y > 150 ? 0 : (hash2(jx * 0.011, jz * 0.011) < 0.5 ? 1 : (r < 0.55 ? 3 : 0));
          if (y > 260) kind = 0;
        }
        spots[kind].push([jx, y, jz, 0.75 + r * 0.6, r * 6.28]);
      }
      const near = new THREE.Group();
      const fk = Math.floor((cx - WORLD.minX) / 600) * 1000 + Math.floor((cz - WORLD.minZ) / 600);   // far crowns pool per 600 m
      if (!farPool.has(fk)) farPool.set(fk, { cx: WORLD.minX + (Math.floor((cx - WORLD.minX) / 600) + 0.5) * 600, cz: WORLD.minZ + (Math.floor((cz - WORLD.minZ) / 600) + 0.5) * 600, spots: [] });
      const far = farPool.get(fk).spots;
      let any = false;
      for (let k = 0; k < kinds.length; k++) {
        if (!spots[k].length) continue;
        any = true;
        const im = new THREE.InstancedMesh(treeGeo[k], mat, spots[k].length);
        spots[k].forEach(([x, y, z, s, rot], i) => {
          dummy.position.set(x, y, z); dummy.scale.setScalar(s); dummy.rotation.set(0, rot, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
          im.setColorAt(i, tint.setScalar(0.85 + hash2(x, z) * 0.3));
          far.push([x, y + kinds[k].leafY * s * 0.6, z, s, kinds[k].lc]);
        });
        im.castShadow = Q.shadows;
        im.computeBoundingSphere();
        near.add(im);
        total += spots[k].length;
      }
      if (!any) continue;
      this.group.add(near);
      this.chunks.push({ cx: cx + CH / 2, cz: cz + CH / 2, near });
    }
    // the far forest: one static mesh of crowns per 600 m, no instancing overhead
    this.farChunks = [];
    for (const f of farPool.values()) {
      if (!f.spots.length) continue;
      const farMesh = new THREE.Mesh(mergeColoured(f.spots.map(([x, y, z, s, lc]) => [farCone, 0, lc, x, y, z, s])), mat);
      this.group.add(farMesh);
      this.farChunks.push({ cx: f.cx, cz: f.cz, far: farMesh });
    }
    this.treeCount = total;
  }

  buildBeachAndPier() {
    // the pier deck stands on legs
    const T = this.T, C = this.city;
    const pier = T.roads.find(r => r.type === 'pier');
    if (pier) {
      const wood = 0x5c4632;
      const legG = new THREE.CylinderGeometry(0.35, 0.35, 1, 6);
      const M = new THREE.Matrix4();
      for (let s = 20; s < pier.L; s += 14) {
        const p = T.pointAt(pier, s), y = T.roadY(pier, s);
        for (const side of [-1, 1]) {
          const x = p.x + p.tz * side * (pier.T.w / 2 - 0.6), z = p.z - p.tx * side * (pier.T.w / 2 - 0.6);
          const bottom = Math.min(-8, T.base(x, z) - 2);
          M.makeScale(1, y - bottom, 1).setPosition(x, (y + bottom) / 2, z);
          C.mesh(legG, M, wood);
        }
      }
      // railings
      const mid = T.pointAt(pier, pier.L / 2), yaw = Math.atan2(mid.tx, mid.tz);
      for (const side of [-1, 1]) {
        C.box(mid.x + mid.tz * side * (pier.T.w / 2), T.roadY(pier, pier.L / 2), mid.z - mid.tx * side * (pier.T.w / 2), 0.12, 1, pier.L, yaw, wood, { ao: false, far: false });
      }
    }
  }

  // draw only what's within reach: near trees, far crowns, near/far city cells
  update(camX, camZ) {
    const nr = Q.forestReach, fr = Q.forestFar;
    if (this.wind) this.wind.value = performance.now() / 1000;
    if (this.birds) this.birds.update(camX, camZ);
    for (const g of this.chunks) g.near.visible = Math.hypot(g.cx - camX, g.cz - camZ) < nr;
    for (const g of this.farChunks) { const d = Math.hypot(g.cx - camX, g.cz - camZ); g.far.visible = d >= nr - 200 && d < fr; }
    this.city.update(camX, camZ, Q.chunkNear, Q.chunkFar);
    this.glow.update(camX, camZ, Q.chunkNear);
    this.edits.update(camX, camZ, Q.chunkNear, Q.chunkFar);
  }

  setAids() {}
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.atlas.tex.dispose(); this.atlas.glow.dispose();
  }
}

// merge [geometry, yOffset, colour, x?, y?, z?, scale?] parts into one
// non-indexed, vertex-coloured geometry. shade: darken each part toward its own
// foot (0.7 → 1.08 over its height) — a crown with an underside, for free
function mergeColoured(parts, shade = false) {
  const pos = [], nrm = [], col = [];
  const c = new THREE.Color(), P = new THREE.Vector3(), N = new THREE.Vector3();
  for (const [g0, yOff, colour, x = 0, y = 0, z = 0, s = 1] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position, n = g.attributes.normal;
    c.set(colour);
    let y0 = 1e9, y1 = -1e9;
    if (shade) for (let i = 0; i < p.count; i++) { const py = p.getY(i); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    for (let i = 0; i < p.count; i++) {
      P.fromBufferAttribute(p, i);
      pos.push(x + P.x * s, y + (P.y + yOff) * s, z + P.z * s);
      N.fromBufferAttribute(n, i); nrm.push(N.x, N.y, N.z);
      const k = shade && y1 > y0 ? 0.7 + 0.38 * (P.y - y0) / (y1 - y0) : 1;
      col.push(c.r * k, c.g * k, c.b * k);
    }
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
