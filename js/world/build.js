// world/build.js — turns the spec + terrain into meshes: the land in tiles,
// the sea, every road as a ribbon with junction plates, kerb lines, the sand,
// the pier, and a forest that covers everything that isn't something else.
// Trees are instanced per 300 m chunk (near) with a merged cone forest behind
// (far), so only what's close costs anything. Buildings go through chunks.js.

import * as THREE from 'three';
import { WORLD, ROAD_TYPES, DISTRICTS, COAST, CANYON } from './spec.js';
import { vnoise } from '../terrain.js';
import { Districts } from './districts.js';
import { EditLayer } from './edits.js';
import { CityAtlas, Chunks, GlowLayer } from './chunks.js';
import { Q } from '../quality.js';

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
    if (this.doc.autofill !== false) this.buildForest();          // the auto forest belongs to the old auto-filled world
    this.buildBeachAndPier();
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
    const T = this.T, cell = 14;
    const w = Math.ceil((WORLD.maxX - WORLD.minX) / cell), h = Math.ceil((WORLD.maxZ - WORLD.minZ) / cell);
    const pos = new Float32Array((w + 1) * (h + 1) * 3), col = new Float32Array((w + 1) * (h + 1) * 3);
    const cGrass = new THREE.Color(0x4e7a3f), cDark = new THREE.Color(0x35592c), cRock = new THREE.Color(0x8a7a66), cSnow = new THREE.Color(0xe8e6e0);
    const cSand = new THREE.Color(0xd9c78f), cRed = new THREE.Color(0xb5613f), cFloor = new THREE.Color(0x9a7a5a), cCity = new THREE.Color(0x6c6f74);
    const tmp = new THREE.Color();
    const cLush = new THREE.Color(0x3f7a3a), cDirt = new THREE.Color(0x7a6244), cGrey = new THREE.Color(0x7d7468);
    // paint wins; otherwise the land colours itself: grass with a slow drift between
    // types, dirt on the slopes, rock where it's steep, red rock where it's been dug
    // deep, snow up high, sand at the water
    this.terrainColor = (x, z, y, out = tmp) => {
      const n = vnoise(x * 0.03, z * 0.03), n2 = vnoise(x * 0.006 + 3.1, z * 0.006 + 1.7);
      const pt = T.paintAt(x, z);
      if (pt && PAINT[pt]) return out.copy(PAINT[pt]).lerp(cDark, n * 0.22);
      let c = out.copy(cGrass).lerp(cLush, n2).lerp(cDark, n * 0.35);
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
      const snowLine = 210 + n2 * 70;
      if (y > snowLine) c.lerp(cSnow, sm((y - snowLine) / 45) * (1 - s * 0.7));
      if (y < 1.5) c.copy(cSand); else if (y < 4.5) c.lerp(cSand, 1 - (y - 1.5) / 3);
      return c;
    };
    let i = 0;
    for (let j = 0; j <= h; j++) for (let k = 0; k <= w; k++) {
      const x = WORLD.minX + k * cell, z = WORLD.minZ + j * cell;
      const y = T.height(x, z);
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
    const TILE = 72, mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTexture() });
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
      const ti = new Uint32Array(cw * chh * 6);
      let qq = 0;
      for (let j = 0; j < chh; j++) for (let k = 0; k < cw; k++) {
        const a = j * (cw + 1) + k;
        ti[qq++] = a; ti[qq++] = a + cw + 1; ti[qq++] = a + 1; ti[qq++] = a + 1; ti[qq++] = a + cw + 1; ti[qq++] = a + cw + 2;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      g.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(tn, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
      g.setIndex(new THREE.BufferAttribute(ti, 1));
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
        const i = j * (cw + 1) + k, y = T.height(vx, vz);
        pos.setY(i, y); const c = this.terrainColor(vx, vz, y); col.setXYZ(i, c.r, c.g, c.b); touched = true;
      }
      if (touched) { pos.needsUpdate = true; col.needsUpdate = true; tile.geometry.computeVertexNormals(); tile.geometry.computeBoundingSphere(); }
    }
  }

  buildWater() {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000),
      new THREE.MeshLambertMaterial({ color: this.sky === 'night' ? 0x0b1626 : 0x2b6b8a, transparent: true, opacity: 0.92 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.0, -1400);
    this.group.add(sea);
    this.sea = sea;
  }

  // ------------------------------------------------------------------ roads
  // a road is a slab: a deck, a skirt down each side (to the ground when it's at
  // grade, a 1.6 m edge when it's a bridge), a kerb along paved edges, and
  // pillars wherever the deck is well above the land
  buildRoads() {
    const T = this.T;
    const paved = new THREE.Color(0x4a4f58), gravel = new THREE.Color(0x9a8664), sand = new THREE.Color(0xe0cf98), pier = new THREE.Color(0x8a6e4e);
    const concrete = new THREE.Color(0x8d8a82), pillarC = new THREE.Color(0x77746e), kerbC = new THREE.Color(0xb3b0a8);
    const pos = [], col = [], idx = [];
    const V = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);                 // a,b,c,d counter-clockwise seen from the outside
    for (const r of T.roads) {
      const hw = r.T.w / 2, step = 6;
      const n = Math.max(2, Math.ceil(r.L / step) + 1);
      const c = r.T.surf === 'gravel' ? gravel : r.T.surf === 'sand' ? sand : r.type === 'pier' ? pier : paved;
      const kerbed = r.T.surf === 'road' && r.type !== 'pier', skirted = r.type !== 'sand';
      let prev = null, sincePillar = 0;
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1)) * r.L;
        const p = T.pointAt(r, s), ry = T.roadY(r, s), y = ry + 0.08;
        const nx = p.tz, nz = -p.tx;
        const shade = 1 - 0.15 * vnoise(p.x * 0.05, p.z * 0.05);
        const cs = c.clone().multiplyScalar(shade);
        const L = [p.x + nx * hw, p.z + nz * hw], R = [p.x - nx * hw, p.z - nz * hw];
        const landL = T.land(L[0], L[1]), landR = T.land(R[0], R[1]), landC = T.land(p.x, p.z);
        const cur = {
          dl: V(L[0], y, L[1], cs), dr: V(R[0], y, R[1], cs),                                       // deck edges
          sl: V(L[0], Math.max(landL - 0.4, y - 1.6), L[1], concrete), sr: V(R[0], Math.max(landR - 0.4, y - 1.6), R[1], concrete),   // skirt bottoms
          kl: kerbed ? [V(L[0], y + 0.3, L[1], kerbC), V(L[0] - nx * 0.55, y + 0.3, L[1] - nz * 0.55, kerbC), V(L[0] - nx * 0.55, y, L[1] - nz * 0.55, kerbC)] : null,
          kr: kerbed ? [V(R[0], y + 0.3, R[1], kerbC), V(R[0] + nx * 0.55, y + 0.3, R[1] + nz * 0.55, kerbC), V(R[0] + nx * 0.55, y, R[1] + nz * 0.55, kerbC)] : null,
        };
        if (prev) {
          quad(prev.dl, cur.dl, cur.dr, prev.dr);                                                   // deck (faces up)
          if (skirted) { quad(prev.sl, cur.sl, cur.dl, prev.dl); quad(prev.dr, cur.dr, cur.sr, prev.sr); }   // skirts (face out)
          if (kerbed) {
            quad(prev.kl[0], cur.kl[0], cur.kl[1], prev.kl[1]); quad(prev.kl[1], cur.kl[1], cur.kl[2], prev.kl[2]);   // left kerb: top, inner face
            quad(prev.kr[1], cur.kr[1], cur.kr[0], prev.kr[0]); quad(prev.kr[2], cur.kr[2], cur.kr[1], prev.kr[1]);   // right kerb
            // the kerb's outer face is the skirt's top edge; the skirt starts at deck height so it reads as one slab
          }
        }
        // pillars under a bridge, every 24 m
        sincePillar += prev ? step : 0;
        if (ry - landC > 3 && sincePillar >= 24 && r.type !== 'pier') {
          sincePillar = 0;
          for (const side of [-0.45, 0.45]) {
            const cx = p.x + nx * hw * side, cz = p.z + nz * hw * side, hwid = 0.9, bottom = T.land(cx, cz) - 1.5;
            const a = [cx + nx * hwid + p.tx * hwid, cz + nz * hwid + p.tz * hwid], b = [cx - nx * hwid + p.tx * hwid, cz - nz * hwid + p.tz * hwid];
            const d = [cx - nx * hwid - p.tx * hwid, cz - nz * hwid - p.tz * hwid], e = [cx + nx * hwid - p.tx * hwid, cz + nz * hwid - p.tz * hwid];
            const corners = [a, b, d, e], top = [], bot = [];
            for (const [qx, qz] of corners) { top.push(V(qx, ry - 0.3, qz, pillarC)); bot.push(V(qx, bottom, qz, pillarC)); }
            for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; quad(bot[k], bot[k2], top[k2], top[k]); quad(top[k], top[k2], bot[k2], bot[k]); }
          }
        }
        prev = cur;
      }
      // junction plates: a disc at every polyline vertex so crossings don't show seams
      for (const [x, z] of r.pts) {
        const y = T.height(x, z) + 0.09;
        const base2 = pos.length / 3, segs = 14;
        pos.push(x, y, z); col.push(c.r, c.g, c.b);
        for (let k = 0; k <= segs; k++) {
          const a = k / segs * Math.PI * 2;
          pos.push(x + Math.cos(a) * hw, T.height(x + Math.cos(a) * hw * 0.9, z + Math.sin(a) * hw * 0.9) + 0.09, z + Math.sin(a) * hw);
          col.push(c.r, c.g, c.b);
          if (k < segs) idx.push(base2, base2 + 1 + k, base2 + 2 + k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
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
    const T = this.T, CH = 300, spacing = 17;
    const kinds = [
      { trunk: new THREE.CylinderGeometry(0.28, 0.42, 5.5, 5), leaf: new THREE.ConeGeometry(3.2, 9, 6), leafY: 9.5, tc: 0x5c4632, lc: 0x2f5a35 },   // pine
      { trunk: new THREE.CylinderGeometry(0.3, 0.45, 4, 5), leaf: new THREE.IcosahedronGeometry(3.6, 0), leafY: 6.5, tc: 0x6a5238, lc: 0x4f8a3a },   // broadleaf
      { trunk: new THREE.CylinderGeometry(0.22, 0.32, 7, 5), leaf: new THREE.ConeGeometry(3.4, 2.2, 6), leafY: 8.2, tc: 0x8a7355, lc: 0x4f8a4a },    // palm-ish
      { trunk: new THREE.CylinderGeometry(0.3, 0.45, 4.5, 5), leaf: new THREE.IcosahedronGeometry(3.2, 0), leafY: 6.4, tc: 0x6a5238, lc: 0xc9742f },  // autumn
    ];
    // one geometry per kind: trunk + crown, vertex-coloured, so a tree is one draw
    const treeGeo = kinds.map(k => mergeColoured([[k.trunk, 2.2, k.tc], [k.leaf, k.leafY, k.lc]]));
    const farCone = new THREE.ConeGeometry(3.4, 9, 5);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    const keep = 0.28 + (1 - Q.treeDensity) * 0.72;      // hash threshold: LOW thins the forest
    let total = 0;
    const farPool = new Map();
    for (let cz = WORLD.minZ; cz < WORLD.maxZ; cz += CH) for (let cx = WORLD.minX; cx < WORLD.maxX; cx += CH) {
      const spots = [[], [], [], []];
      for (let z = cz; z < cz + CH; z += spacing) for (let x = cx; x < cx + CH; x += spacing) {
        const jx = x + (hash2(x, z) - 0.5) * spacing * 0.9, jz = z + (hash2(z, x) - 0.5) * spacing * 0.9;
        const r = hash2(jx * 0.37, jz * 0.53);
        if (r < keep) continue;
        const y = T.height(jx, jz);
        if (y < 3.5) continue;                                              // water / sand
        if (T.districtAt(jx, jz)) continue;
        const nr = T.nearestRoad(jx, jz);
        if (nr && nr.d < nr.road.T.w / 2 + 7) continue;
        if (T.canyonCarve(jx, jz) < -8) continue;                           // canyon walls and floor
        if (y > 380) continue;                                              // treeline
        // which forest: palms low near the coast, autumn mid, broadleaf, pines up high
        const coastal = jz < -1200 ? 1 : 0;
        let kind = coastal && r < 0.7 ? 2 : y > 150 ? 0 : (hash2(jx * 0.011, jz * 0.011) < 0.5 ? 1 : (r < 0.55 ? 3 : 0));
        if (y > 260) kind = 0;
        spots[kind].push([jx, y, jz, 0.75 + r * 0.6, r * 6.28]);
      }
      const near = new THREE.Group();
      const fk = Math.floor((cx - WORLD.minX) / 600) * 1000 + Math.floor((cz - WORLD.minZ) / 600);   // far crowns pool per 600 m
      if (!farPool.has(fk)) farPool.set(fk, { cx: WORLD.minX + (Math.floor((cx - WORLD.minX) / 600) + 0.5) * 600, cz: WORLD.minZ + (Math.floor((cz - WORLD.minZ) / 600) + 0.5) * 600, spots: [] });
      const far = farPool.get(fk).spots;
      let any = false;
      for (let k = 0; k < 4; k++) {
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
// non-indexed, vertex-coloured geometry
function mergeColoured(parts) {
  const pos = [], nrm = [], col = [];
  const c = new THREE.Color(), P = new THREE.Vector3(), N = new THREE.Vector3();
  for (const [g0, yOff, colour, x = 0, y = 0, z = 0, s = 1] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position, n = g.attributes.normal;
    c.set(colour);
    for (let i = 0; i < p.count; i++) {
      P.fromBufferAttribute(p, i);
      pos.push(x + P.x * s, y + (P.y + yOff) * s, z + P.z * s);
      N.fromBufferAttribute(n, i); nrm.push(N.x, N.y, N.z);
      col.push(c.r, c.g, c.b);
    }
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
