// world/build.js — turns the spec + terrain into meshes: the land in chunks,
// the sea, every road as a ribbon with junction plates, kerb lines, the sand,
// the pier, and a forest that covers everything that isn't something else.
// Trees are instanced per 300 m chunk so only the chunks near you draw.

import * as THREE from 'three';
import { WORLD, ROAD_TYPES, DISTRICTS, COAST, CANYON } from './spec.js';
import { vnoise } from '../terrain.js';
import { Districts } from './districts.js';

const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }

export class WorldBuilder {
  constructor(T, scene, opts = {}) {
    this.T = T; this.scene = scene; this.sky = opts.sky || 'noon';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = [];                                    // forest chunks: {cx, cz, mesh...}
    this.buildTerrain();
    this.buildWater();
    this.buildRoads();
    this.buildForest();
    this.buildBeachAndPier();
    this.districts = new Districts(T, this.group, this.sky === 'night');
    this.walls = this.districts.walls;
  }

  // ---------------------------------------------------------------- terrain
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
    const idx = new Uint32Array(w * h * 6);
    let q = 0;
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) {
      const a = j * (w + 1) + k;
      idx[q++] = a; idx[q++] = a + w + 1; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = a + w + 1; idx[q++] = a + w + 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrainMesh = mesh;
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
    const lpos = [], lidx = [];
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
        // edge lines on paved roads
        if (r.T.surf === 'road' && r.type !== 'pier') {
          for (const side of [-1, 1]) {
            const o1 = side * (hw - 0.5), o2 = side * (hw - 0.15);
            lpos.push(p.x + nx * o1, y + 0.02, p.z + nz * o1, p.x + nx * o2, y + 0.02, p.z + nz * o2);
          }
        }
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
    // edge lines as quads
    const lg = new THREE.BufferGeometry();
    const li = [];
    for (let i = 0; i + 3 < lpos.length / 3; i += 4) { li.push(i, i + 2, i + 1, i + 2, i + 3, i + 1); }
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3)); lg.setIndex(li);
    this.group.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0xe8e5dc, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
  }

  // ----------------------------------------------------------------- forest
  // trees on a jittered grid, everywhere that isn't road, water, sand, canyon
  // floor, district or above the treeline. Per chunk, so culling is free.
  buildForest() {
    const T = this.T, CH = 300, spacing = 17;
    const kinds = [
      { trunk: new THREE.CylinderGeometry(0.28, 0.42, 5.5, 5), leaf: new THREE.ConeGeometry(3.2, 9, 6), leafY: 9.5, tc: 0x5c4632, lc: 0x2f5a35 },   // pine
      { trunk: new THREE.CylinderGeometry(0.3, 0.45, 4, 5), leaf: new THREE.IcosahedronGeometry(3.6, 0), leafY: 6.5, tc: 0x6a5238, lc: 0x4f8a3a },   // broadleaf
      { trunk: new THREE.CylinderGeometry(0.22, 0.32, 7, 5), leaf: new THREE.ConeGeometry(3.4, 2.2, 6), leafY: 8.2, tc: 0x8a7355, lc: 0x4f8a4a },    // palm-ish
      { trunk: new THREE.CylinderGeometry(0.3, 0.45, 4.5, 5), leaf: new THREE.IcosahedronGeometry(3.2, 0), leafY: 6.4, tc: 0x6a5238, lc: 0xc9742f },  // autumn
    ];
    const mats = kinds.map(k => ({ t: new THREE.MeshLambertMaterial({ color: k.tc }), l: new THREE.MeshLambertMaterial({ color: k.lc, flatShading: true }) }));
    const dummy = new THREE.Object3D();
    let total = 0;
    for (let cz = WORLD.minZ; cz < WORLD.maxZ; cz += CH) for (let cx = WORLD.minX; cx < WORLD.maxX; cx += CH) {
      const spots = [[], [], [], []];
      for (let z = cz; z < cz + CH; z += spacing) for (let x = cx; x < cx + CH; x += spacing) {
        const jx = x + (hash2(x, z) - 0.5) * spacing * 0.9, jz = z + (hash2(z, x) - 0.5) * spacing * 0.9;
        const r = hash2(jx * 0.37, jz * 0.53);
        if (r < 0.28) continue;                                             // thin it a little
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
      for (let k = 0; k < 4; k++) {
        if (!spots[k].length) continue;
        const kd = kinds[k];
        const trunks = new THREE.InstancedMesh(kd.trunk, mats[k].t, spots[k].length);
        const leaves = new THREE.InstancedMesh(kd.leaf, mats[k].l, spots[k].length);
        spots[k].forEach(([x, y, z, s, rot], i) => {
          dummy.position.set(x, y + 2.2 * s, z); dummy.scale.setScalar(s); dummy.rotation.set(0, rot, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
          dummy.position.set(x, y + kd.leafY * s, z); dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
        });
        trunks.castShadow = leaves.castShadow = true;
        trunks.frustumCulled = leaves.frustumCulled = false;
        const grp = new THREE.Group(); grp.add(trunks, leaves);
        grp.userData = { cx: cx + CH / 2, cz: cz + CH / 2 };
        this.group.add(grp);
        this.chunks.push(grp);
        total += spots[k].length;
      }
    }
    this.treeCount = total;
  }

  buildBeachAndPier() {
    // the pier deck stands on legs
    const T = this.T;
    const pier = T.roads.find(r => r.type === 'pier');
    if (pier) {
      const legM = new THREE.MeshLambertMaterial({ color: 0x5c4632 });
      const legG = new THREE.CylinderGeometry(0.35, 0.35, 1, 6);
      for (let s = 20; s < pier.L; s += 14) {
        const p = T.pointAt(pier, s), y = T.roadY(pier, s);
        for (const side of [-1, 1]) {
          const x = p.x + p.tz * side * (pier.T.w / 2 - 0.6), z = p.z - p.tx * side * (pier.T.w / 2 - 0.6);
          const bottom = Math.min(-8, T.base(x, z) - 2);
          const leg = new THREE.Mesh(legG, legM);
          leg.scale.y = y - bottom; leg.position.set(x, (y + bottom) / 2, z);
          this.group.add(leg);
        }
      }
      // railings
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, pier.L), legM);
      const mid = T.pointAt(pier, pier.L / 2);
      for (const side of [-1, 1]) {
        const r2 = rail.clone();
        r2.position.set(mid.x + mid.tz * side * (pier.T.w / 2), T.roadY(pier, pier.L / 2) + 0.5, mid.z - mid.tx * side * (pier.T.w / 2));
        r2.rotation.y = Math.atan2(mid.tx, mid.tz);
        this.group.add(r2);
      }
    }
  }

  // draw only the forest chunks within reach of the camera
  update(camX, camZ, reach = 1100) {
    for (const g of this.chunks) {
      const dx = g.userData.cx - camX, dz = g.userData.cz - camZ;
      g.visible = dx * dx + dz * dz < reach * reach;
    }
  }

  setAids() {}
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
  }
}
