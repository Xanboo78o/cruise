// city.js — the free-roam half. Hand-laid street grid, a hand-routed street
// circuit through it (so lap timing and the practice line still work), a
// skidpad out west for donuts, and buildings you can't drive through.

import * as THREE from 'three';
import { TrackModel, SURFACES } from './track.js';
import { SKIES } from './world.js';

const p = (x, z, y = 0) => ({ x, z, y });
function arc(cx, cz, r, a0, a1, steps = 4) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + (a1 - a0) * (i / steps)) * Math.PI / 180;
    out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), y: 0 });
  }
  return out;
}

// --- the street grid. [x1, z1, x2, z2, width]
const AV = 19, ST = 19, BLVD = 27;
const ROADS = [
  // north-south avenues
  [-240, -260, -240, 220, AV], [-120, -260, -120, 220, AV], [0, -260, 0, 220, AV],
  [120, -260, 120, 220, AV], [240, -260, 240, 220, AV],
  // east-west streets
  [-300, 160, 300, 160, ST], [-300, 40, 300, 40, ST], [-300, -80, 300, -80, BLVD],
  [-300, -200, 300, -200, ST],
  // waterfront loop out east, and the dock spur
  [300, -230, 300, 190, AV], [240, 190, 300, 190, ST], [240, -230, 300, -230, ST],
  [300, -30, 372, -30, ST], [372, -30, 372, 90, ST],
  // the diagonal — one street that isn't on the grid, for character
  [-240, 40, 60, -200, AV],
  // skidpad link
  [-372, -140, -240, -140, ST],
];
const PAD = { x: -372, z: -140, r: 58 };        // the donut pad

// --- buildings: [x, z, w, d, h, tone]  (tone 0 concrete, 1 brick, 2 glass, 3 shed)
const BUILDINGS = [
  // downtown block: x 0..120, z 40..160
  [40, 96, 46, 44, 74, 2], [96, 108, 34, 40, 96, 2], [44, 148, 40, 26, 52, 0], [98, 62, 32, 30, 62, 2],
  [16, 60, 26, 22, 34, 0],
  // block x -120..0, z 40..160
  [-96, 104, 42, 48, 44, 1], [-40, 100, 42, 40, 58, 0], [-92, 152, 36, 22, 30, 1], [-38, 152, 34, 22, 36, 1],
  [-96, 58, 40, 20, 26, 3],
  // block x -240..-120, z 40..160
  [-212, 108, 46, 52, 38, 1], [-152, 104, 44, 46, 30, 1], [-208, 154, 38, 20, 22, 3], [-150, 56, 42, 22, 26, 3],
  // block x 120..240, z 40..160
  [162, 100, 42, 48, 66, 2], [216, 108, 34, 44, 84, 2], [166, 152, 40, 22, 40, 0], [214, 56, 36, 24, 44, 0],
  // block x 0..120, z -80..40
  [42, -18, 46, 44, 40, 0], [98, -22, 34, 40, 54, 2], [46, -62, 42, 24, 28, 1], [98, -62, 34, 22, 32, 1],
  // block x -120..0, z -80..40
  [-46, -20, 44, 46, 34, 1], [-96, -26, 38, 36, 46, 0], [-44, -64, 40, 22, 24, 3],
  // block x 120..240, z -80..40
  [164, -20, 44, 46, 50, 0], [216, -24, 36, 40, 38, 1], [168, -64, 40, 22, 26, 3], [216, -64, 34, 22, 30, 1],
  // south blocks, z -200..-80 — lower, warehousey
  [44, -140, 48, 44, 20, 3], [100, -140, 36, 44, 24, 3], [166, -136, 46, 50, 22, 3], [220, -140, 34, 42, 18, 3],
  [-46, -140, 44, 40, 22, 3], [-100, -144, 36, 36, 26, 1],
  // north strip, z > 160
  [-212, 196, 48, 30, 26, 1], [-96, 196, 44, 30, 22, 3], [44, 196, 46, 30, 34, 0], [166, 196, 44, 30, 30, 0],
  [216, 196, 30, 26, 24, 1],
  // docks, east of the waterfront road
  [336, 120, 44, 56, 16, 3], [336, 40, 44, 60, 14, 3], [340, -120, 52, 70, 18, 3], [336, -196, 44, 44, 15, 3],
  // west edge
  [-300, 100, 40, 60, 28, 1], [-300, -20, 40, 60, 24, 1], [-296, -200, 44, 46, 20, 3],
];

// --- the street circuit: a hand-picked loop of streets, 16 m corner radii
const CIRCUIT = {
  id: 'city',
  name: 'THE CITY',
  blurb: 'free roam · street circuit · skidpad out west',
  closed: true,
  width: 15,
  startIndex: 0.05,
  sky: 'sunset',
  profile: { vMax: 44, aLat: 12.0 },
  pts: [
    p(0, -170), p(0, -100), p(0, 24),
    ...arc(16, 24, 16, 180, 90).slice(1),         // right onto the z=40 street
    p(60, 40), p(104, 40),
    ...arc(104, 56, 16, -90, 0).slice(1),         // left onto the x=120 avenue
    p(120, 100), p(120, 144),
    ...arc(136, 144, 16, 180, 90).slice(1),       // right onto the z=160 street
    p(180, 160), p(224, 160),
    ...arc(224, 144, 16, 90, 0).slice(1),         // right onto the x=240 avenue
    p(240, 100), p(240, -60), p(240, -184),
    ...arc(224, -184, 16, 0, -90).slice(1),       // right onto the z=-200 street
    p(180, -200), p(60, -200),
    ...arc(16, -184, 16, -90, -180).slice(1),     // right back onto x=0
  ],
};

const CITY_SURF = {
  road: SURFACES.road,
  walk: { grip: 0.74, drag: 1.5, accel: 0.7, name: 'pavement' },
  lot:  { grip: 0.62, drag: 1.7, accel: 0.6, name: 'lot' },
  grass: SURFACES.grass,
};

function distToSeg(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

class CityModel extends TrackModel {
  constructor() {
    super(CIRCUIT);
    this.city = { roads: ROADS, buildings: BUILDINGS, pad: PAD };
    this.bounds = { minX: -420, maxX: 400, minZ: -290, maxZ: 250 };
    this.buildMask();
  }

  // 3 m grid: 0 lot, 1 pavement, 2 road. Cheap to build, O(1) to read.
  buildMask() {
    const cell = 3, b = this.bounds;
    const w = Math.ceil((b.maxX - b.minX) / cell) + 1, h = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
    const m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = b.minX + i * cell, z = b.minZ + j * cell;
        let v = 0;
        for (const [x1, z1, x2, z2, rw] of ROADS) {
          const d = distToSeg(x, z, x1, z1, x2, z2);
          if (d <= rw / 2) { v = 2; break; }
          if (d <= rw / 2 + 4.5) v = Math.max(v, 1);
        }
        if (v < 2) {
          const dp = Math.hypot(x - PAD.x, z - PAD.z);
          if (dp <= PAD.r) v = 2;
          else if (dp <= PAD.r + 4) v = Math.max(v, 1);
        }
        m[j * w + i] = v;
      }
    }
    this.mask = { m, w, h, cell, x0: b.minX, z0: b.minZ };
  }

  maskAt(x, z) {
    const k = this.mask;
    const i = Math.round((x - k.x0) / k.cell), j = Math.round((z - k.z0) / k.cell);
    if (i < 0 || j < 0 || i >= k.w || j >= k.h) return 0;
    return k.m[j * k.w + i];
  }

  surfaceAt(x, z) {
    const v = this.maskAt(x, z);
    const s = v === 2 ? CITY_SURF.road : v === 1 ? CITY_SURF.walk : CITY_SURF.lot;
    return { ...s, slope: 0 };
  }

  heightAt() { return 0; }

  // push the car out of buildings — cheap AABB, no bounce, just a stop
  collide(car) {
    const r = 1.3;
    for (const [bx, bz, bw, bd] of BUILDINGS) {
      const hx = bw / 2 + r, hz = bd / 2 + r;
      const dx = car.x - bx, dz = car.z - bz;
      if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue;
      const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
      if (ox < oz) {
        car.x = bx + Math.sign(dx || 1) * hx;
        const nx = Math.sign(dx || 1);
        const vn = car.vx * nx;
        if (vn < 0) { car.vx -= vn * nx * 1.25; }
      } else {
        car.z = bz + Math.sign(dz || 1) * hz;
        const nz = Math.sign(dz || 1);
        const vn = car.vz * nz;
        if (vn < 0) { car.vz -= vn * nz * 1.25; }
      }
      // re-derive body-frame velocity after the shove
      car.u = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
      car.v = car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw);
      car.r *= 0.5;
      return true;
    }
    return false;
  }

  buildWorld(scene, skyKey) {
    return new CityWorld(this, scene, skyKey);
  }
}

// Two textures off one grid: the diffuse one (what the windows look like) and an
// emissive mask (only the lit ones). Without the mask, night is a black city.
function windowTextures(night) {
  const lit = [];
  for (let y = 4; y < 64; y += 10) for (let x = 4; x < 64; x += 9) lit.push([x, y, Math.random() < (night ? 0.42 : 0.16)]);
  const make = (bg, on, off) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 64, 64);
    for (const [x, y, isOn] of lit) { g.fillStyle = isOn ? on : off; g.fillRect(x, y, 6, 6); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return {
    map: night ? make('#141821', '#ffd98a', '#0d1017') : make('#8d93a0', '#cfd8e6', '#5d6675'),
    emissive: night ? make('#000000', '#ffd08a', '#000000') : null,
  };
}

class CityWorld {
  constructor(model, scene, skyKey) {
    this.model = model; this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const night = skyKey === 'night';
    this.night = night;
    this.build(skyKey);
  }

  build(skyKey) {
    const sky = SKIES[skyKey] || SKIES.sunset;
    const b = this.model.bounds;
    // ground: everything that isn't road
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(b.maxX - b.minX + 400, b.maxZ - b.minZ + 400),
      new THREE.MeshLambertMaterial({ color: this.night ? 0x1a1d24 : 0x4d5346 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, -0.06, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // water east of the docks
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 1400),
      new THREE.MeshLambertMaterial({ color: this.night ? 0x0b1626 : 0x2b6b8a }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(880, -0.4, -20);
    this.group.add(water);

    // pavement then asphalt on top, so junctions merge without any seam work
    this.group.add(this.roadMesh(4.5, 0.14, this.night ? 0x353a45 : 0x9aa0a8));
    this.group.add(this.roadMesh(0, 0.2, this.night ? 0x24272e : 0x545a64));
    this.padMesh();
    this.lanePaint();
    this.buildingMesh();
    this.streetProps();
    this.circuitAids();
  }

  roadMesh(expand, y, color) {
    const pos = [], idx = [];
    const push = (x1, z1, x2, z2, w) => {
      const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * (w / 2 + expand), nz = dx / l * (w / 2 + expand);
      const ex = dx / l * (w / 2 + expand), ez = dz / l * (w / 2 + expand);  // extend to fill junctions
      const q = pos.length / 3;
      pos.push(x1 + nx - ex, y, z1 + nz - ez, x1 - nx - ex, y, z1 - nz - ez,
               x2 + nx + ex, y, z2 + nz + ez, x2 - nx + ex, y, z2 - nz + ez);
      idx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
    };
    for (const r of ROADS) push(...r);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    m.receiveShadow = true;
    return m;
  }

  padMesh() {
    const g = new THREE.CircleGeometry(PAD.r, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: this.night ? 0x23262d : 0x4a4f58 }));
    m.position.set(PAD.x, 0.18, PAD.z);
    m.receiveShadow = true;
    this.group.add(m);
    // painted circles to aim at
    for (const r of [14, 26, 38]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r + 0.3, 60),
        new THREE.MeshBasicMaterial({ color: 0xe6e2d6, transparent: true, opacity: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(PAD.x, 0.22, PAD.z);
      this.group.add(ring);
    }
  }

  lanePaint() {
    const pos = [], idx = [];
    for (const [x1, z1, x2, z2, w] of ROADS) {
      const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l, nx = -uz * 0.16, nz = ux * 0.16;
      const dash = 7, gap = 7;
      for (let d = 12; d < l - 12; d += dash + gap) {
        const ax = x1 + ux * d, az = z1 + uz * d;
        const bx = x1 + ux * (d + dash), bz = z1 + uz * (d + dash);
        const q = pos.length / 3;
        pos.push(ax + nx, 0.23, az + nz, ax - nx, 0.23, az - nz, bx + nx, 0.23, bz + nz, bx - nx, 0.23, bz - nz);
        idx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd6cf9c, transparent: true, opacity: 0.45 })));
  }

  buildingMesh() {
    const tones = [0x8c8f96, 0x8a5f4c, 0x6f8496, 0x9a9280];
    const tex = windowTextures(this.night);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const capM = new THREE.MeshLambertMaterial({ color: this.night ? 0x2a2d33 : 0x53565c });
    // One mesh per building rather than one instanced batch: each needs its own
    // UV repeat or the windows come out the size of the rooms behind them.
    // A tile of the texture is 7 windows across by 6 up ~= 22 m x 24 m.
    for (const [x, z, w, d, h, tone] of BUILDINGS) {
      let mat;
      if (tone === 3) {
        mat = new THREE.MeshLambertMaterial({ color: tones[3] });
      } else {
        const map = tex.map.clone();
        map.needsUpdate = true;
        map.repeat.set(Math.max(1, w / 22), Math.max(1, h / 24));
        mat = new THREE.MeshLambertMaterial({ color: tones[tone], map });
        if (this.night) {
          const em = tex.emissive.clone();
          em.needsUpdate = true;
          em.repeat.copy(map.repeat);
          mat.emissive = new THREE.Color(0xffc98a);
          mat.emissiveMap = em;
          mat.emissiveIntensity = 0.62;
        }
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, h / 2, z);
      m.scale.set(w, h, d);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      const cap = new THREE.Mesh(geo, capM);
      cap.position.set(x, h + 0.5, z);
      cap.scale.set(w + 1.2, 1, d + 1.2);
      cap.castShadow = true;
      this.group.add(cap);
    }
  }

  streetProps() {
    const dummy = new THREE.Object3D();
    const poles = [], lamps = [];
    for (const [x1, z1, x2, z2, w] of ROADS) {
      const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
      for (let d = 24; d < l - 24; d += 52) {
        for (const side of [-1, 1]) {
          poles.push([x1 + ux * d + nx * side * (w / 2 + 3), z1 + uz * d + nz * side * (w / 2 + 3), side * -nx, side * -nz]);
        }
      }
    }
    const poleG = new THREE.CylinderGeometry(0.13, 0.16, 7, 5);
    const poleM = new THREE.MeshLambertMaterial({ color: 0x4a4d54 });
    const pi = new THREE.InstancedMesh(poleG, poleM, poles.length);
    const headG = new THREE.BoxGeometry(1.5, 0.22, 0.5);
    const headM = new THREE.MeshBasicMaterial({ color: this.night ? 0xffe0a0 : 0x9fa4ad });
    const hi = new THREE.InstancedMesh(headG, headM, poles.length);
    poles.forEach((p, i) => {
      dummy.position.set(p[0], 3.5, p[1]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pi.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p[0] + p[2] * 0.7, 7.0, p[1] + p[3] * 0.7);
      dummy.rotation.y = Math.atan2(p[2], p[3]);
      dummy.updateMatrix();
      hi.setMatrixAt(i, dummy.matrix);
    });
    pi.castShadow = true;
    this.group.add(pi, hi);

    if (this.night) {
      // cheap pools of light: additive discs under each lamp, no extra lights
      const pool = new THREE.CircleGeometry(9.5, 12);
      pool.rotateX(-Math.PI / 2);
      const pm = new THREE.MeshBasicMaterial({
        color: 0xffcf8a, transparent: true, opacity: 0.17,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const pool_i = new THREE.InstancedMesh(pool, pm, poles.length);
      poles.forEach((p, i) => {
        dummy.position.set(p[0] + p[2] * 3.5, 0.26, p[1] + p[3] * 3.5);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
        dummy.updateMatrix();
        pool_i.setMatrixAt(i, dummy.matrix);
      });
      pool_i.renderOrder = 2;
      this.group.add(pool_i);
    }

    // palms along the waterfront
    const n = 26;
    const tg = new THREE.CylinderGeometry(0.16, 0.26, 5.4, 5);
    const ti = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0x8a7355 }), n);
    const lg = new THREE.ConeGeometry(2.7, 1.7, 6);
    const li = new THREE.InstancedMesh(lg, new THREE.MeshLambertMaterial({ color: 0x4f8a4a, flatShading: true }), n);
    for (let i = 0; i < n; i++) {
      const z = -220 + i * 16.5;
      dummy.position.set(316, 2.7, z); dummy.rotation.set(0, i, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix(); ti.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 5.6; dummy.updateMatrix(); li.setMatrixAt(i, dummy.matrix);
    }
    ti.castShadow = li.castShadow = true;
    this.group.add(ti, li);

    // cones in a slalom down the middle of the skidpad link
    const cg = new THREE.ConeGeometry(0.34, 0.8, 6);
    const cm = new THREE.MeshLambertMaterial({ color: 0xe8622a });
    const ci = new THREE.InstancedMesh(cg, cm, 14);
    for (let i = 0; i < 14; i++) {
      dummy.position.set(-360 + i * 9, 0.6, -140 + (i % 2 ? 5 : -5));
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix();
      ci.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(ci);
  }

  circuitAids() {
    // reuse the track overlay: line + boards, drawn just above the asphalt
    const m = this.model;
    const green = new THREE.Color(0x36d97a), amber = new THREE.Color(0xf5c145), red = new THREE.Color(0xe8483a);
    const pos = [], col = [], idx = [];
    for (let i = 0; i < m.line.length; i++) {
      const q = m.line[i];
      const c = m.profile.state[i] === 2 ? red : m.profile.state[i] === 0 ? green : amber;
      pos.push(q.x + q.nx * 0.42, 0.26, q.z + q.nz * 0.42, q.x - q.nx * 0.42, 0.26, q.z - q.nz * 0.42);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < m.line.length; i++) {
      const a = i * 2, b = ((i + 1) % m.line.length) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.idealLine = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }));
    this.idealLine.renderOrder = 2;
    this.group.add(this.idealLine);

    this.boards = new THREE.Group();
    const post = new THREE.BoxGeometry(0.14, 1.5, 0.14);
    const panel = new THREE.BoxGeometry(1.7, 1.2, 0.12);
    const cols = { 100: 0x2f6fd0, 50: 0xf5c145, 25: 0xe8483a };
    for (const br of m.profile.brakes) {
      if (br.entry - br.exit < 7) continue;
      for (const d of [100, 50, 25]) {
        const s = m.sampleAtDistance((br.dist - d + m.length) % m.length);
        const px = s.x + s.nx * (m.halfWidth + 2.2), pz = s.z + s.nz * (m.halfWidth + 2.2);
        const mp = new THREE.Mesh(post, new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
        mp.position.set(px, 0.9, pz);
        const mb = new THREE.Mesh(panel, new THREE.MeshLambertMaterial({ color: cols[d] }));
        mb.position.set(px, 2.1, pz);
        mb.rotation.y = -Math.atan2(s.tx, s.tz);
        this.boards.add(mp, mb);
      }
    }
    this.group.add(this.boards);
  }

  setAids(line, boards) {
    if (this.idealLine) this.idealLine.visible = line;
    if (this.boards) this.boards.visible = boards;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}

export function buildCity() { return new CityModel(); }
