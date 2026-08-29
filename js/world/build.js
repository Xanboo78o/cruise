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
    this.buildTerrain();
    this.buildWater();
    this.buildRoads();
    this.buildForest();
    this.buildBeachAndPier();
    this.doc = opts.doc || { autofill: true, objects: [] };
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
    let i = 0;
    for (let j = 0; j <= h; j++) for (let k = 0; k <= w; k++) {
      const x = WORLD.minX + k * cell, z = WORLD.minZ + j * cell;
      const y = T.height(x, z);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const n = vnoise(x * 0.03, z * 0.03);
      let c = cGrass.clone().lerp(cDark, n * 0.6);
      const carve = T.canyonCarve(x, z);
      if (carve < -1) c = (carve < -T.constructor.depth ? cFloor : cRed).clone().lerp(cFloor, sm((-carve - 40) / 45)).lerp(cRed, n * 0.3);
      if (y > 240) c.lerp(cRock, sm((y - 240) / 120));
      if (y > 400) c.lerp(cSnow, sm((y - 400) / 60));
      const d = T.districtAt(x, z);
      if (d && d.fill === 'beach') c = cSand.clone().lerp(cGrass, sm((z - d.z0 - 200) / 120));
      else if (d && (d.fill === 'towers' || d.fill === 'harbor' || d.fill === 'docks')) c = cCity.clone().lerp(cGrass, 0.35);
      else if (d && d.fill === 'houses') c = cGrass.clone().lerp(cSand, 0.15);
      if (y < 1.5) c = cSand.clone();
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
    const TILE = 72, mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrainTiles = [];
    for (let tj = 0; tj < h; tj += TILE) for (let tk = 0; tk < w; tk += TILE) {
      const cw = Math.min(TILE, w - tk), chh = Math.min(TILE, h - tj);
      const tp = new Float32Array((cw + 1) * (chh + 1) * 3), tc = new Float32Array((cw + 1) * (chh + 1) * 3), tn = new Float32Array((cw + 1) * (chh + 1) * 3);
      let m = 0;
      for (let j = 0; j <= chh; j++) for (let k = 0; k <= cw; k++) {
        const src = ((tj + j) * (w + 1) + (tk + k)) * 3;
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
      g.setIndex(new THREE.BufferAttribute(ti, 1));
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.terrainTiles.push(mesh);
    }
    this.terrainMesh = this.terrainTiles[0];
  }

  buildWater() {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000),
      new THREE.MeshLambertMaterial({ color: this.sky === 'night' ? 0x0b1626 : 0x2b6b8a, transparent: true, opacity: 0.92 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.0, -1400);
    this.group.add(sea);
    this.sea = sea;
  }

  // ------------------------------------------------------------------ roads
  buildRoads() {
    const T = this.T;
    const paved = new THREE.Color(0x4a4f58), gravel = new THREE.Color(0x9a8664), sand = new THREE.Color(0xe0cf98), pier = new THREE.Color(0x8a6e4e);
    const pos = [], col = [], idx = [];
    for (const r of T.roads) {
      const hw = r.T.w / 2, step = 6;
      const n = Math.max(2, Math.ceil(r.L / step) + 1);
      const base = pos.length / 3;
      const c = r.T.surf === 'gravel' ? gravel : r.T.surf === 'sand' ? sand : r.type === 'pier' ? pier : paved;
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1)) * r.L;
        const p = T.pointAt(r, s), y = T.roadY(r, s) + 0.08;
        const nx = p.tz, nz = -p.tx;
        const shade = 1 - 0.15 * vnoise(p.x * 0.05, p.z * 0.05);
        pos.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
        col.push(c.r * shade, c.g * shade, c.b * shade, c.r * shade, c.g * shade, c.b * shade);
        if (i < n - 1) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
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
