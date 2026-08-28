// world/districts.js — what fills the plateaus. Towers downtown, sheds on the
// water, houses on the winding streets, a grandstand at the speedway, hangars
// at the airfield. Everything wears signage. Footprints are hand-placed per
// block; houses sit along their streets. Nothing generates a layout.

import * as THREE from 'three';
import { DISTRICTS, ROADS, ROAD_TYPES } from './spec.js';
import { vnoise } from '../terrain.js';

function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }

const ADS = ['OOZI COLA', 'DRIFT KING TYRES', 'MOTEL OO', 'NITRO+', 'BOARDWALK BURGERS', 'CANYON GOLD', 'PIER 9', 'SPEEDWAY SUNDAY',
  'RENT-A-KART', 'OO AIR', 'HACHI GARAGE', 'BIG SLICK OIL', 'SAN OOZI FM', 'THE LOOKOUT', 'DOCKS DINER', 'MEGA MUSHROOM', 'RIM EXPRESS'];
const PAL = ['#ff9a5c', '#7ea6ff', '#ffd98a', '#ff6b8f', '#6fe3a0', '#f0ece0', '#ffe066'];

// a billboard texture: a coloured panel with a word on it, Kenney-flat
function adTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 108, 256, 20);
  g.fillStyle = fg; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = text.split(' ');
  if (words.length > 1 && text.length > 11) { g.fillText(words[0], 128, 46); g.fillText(words.slice(1).join(' '), 128, 82); }
  else g.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// windows: a repeating grid; lit at night
function windowTex(night) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = night ? '#141821' : '#8d93a0'; g.fillRect(0, 0, 64, 64);
  for (let y = 4; y < 64; y += 10) for (let x = 4; x < 64; x += 9) {
    const lit = Math.random() < (night ? 0.4 : 0.15);
    g.fillStyle = night ? (lit ? '#ffd98a' : '#0d1017') : (lit ? '#cfd8e6' : '#5d6675');
    g.fillRect(x, y, 6, 6);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Districts {
  constructor(T, group, night) {
    this.T = T; this.group = group; this.night = night;
    this.walls = [];                                     // [cx, cz, w, d] for collisions
    this.win = windowTex(night);
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.adCache = new Map();
    for (const d of DISTRICTS) {
      if (d.fill === 'towers') this.downtown(d);
      else if (d.fill === 'harbor' || d.fill === 'docks') this.sheds(d);
      else if (d.fill === 'houses') this.houses(d);
      else if (d.fill === 'speedway') this.speedway(d);
      else if (d.fill === 'airfield') this.airfield(d);
      else if (d.fill === 'beach') this.beach(d);
    }
  }

  block(x, z, w, d, h, color, opts = {}) {
    const y = this.T.height(x, z);
    const mat = new THREE.MeshLambertMaterial({ color, map: opts.windows ? this.win.clone() : null });
    if (opts.windows) { mat.map.needsUpdate = true; mat.map.repeat.set(Math.max(1, w / 18), Math.max(1, h / 22)); if (this.night) { mat.emissive = new THREE.Color(0xffc98a); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.45; } }
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(x, y + h / 2 - 0.5, z); m.scale.set(w, h + 1, d);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    if (opts.roof !== false) {
      const cap = new THREE.Mesh(this.box, new THREE.MeshLambertMaterial({ color: opts.roofColor ?? 0x3a3d44 }));
      cap.position.set(x, y + h + 0.3, z); cap.scale.set(w + 0.8, 0.8, d + 0.8); cap.castShadow = true;
      this.group.add(cap);
    }
    this.walls.push([x, z, w, d]);
    return m;
  }

  billboard(x, z, y, w, h, yaw, text) {
    const key = text;
    if (!this.adCache.has(key)) {
      const bg = PAL[Math.floor(hash2(text.length, text.charCodeAt(0)) * PAL.length)];
      this.adCache.set(key, new THREE.MeshBasicMaterial({ map: adTexture(text, bg, '#151820') }));
    }
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.adCache.get(key));
    b.position.set(x, y, z); b.rotation.y = yaw;
    this.group.add(b);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
    back.position.set(x - Math.sin(yaw) * 0.2, y, z - Math.cos(yaw) * 0.2); back.rotation.y = yaw;
    this.group.add(back);
    if (this.night) { const glow = new THREE.PointLight(0xfff0d0, 0.6, 30); glow.position.set(x + Math.sin(yaw) * 2, y, z + Math.cos(yaw) * 2); this.group.add(glow); }
  }

  // ------------------------------------------------------------- downtown
  // the grid is 260 m; each block gets 2-4 towers by hand-picked pattern
  downtown(d) {
    const ax = [-390, -130, 130, 390], az = [-1280, -1040, -780, -520];
    const patterns = [
      [[0.3, 0.3, 60, 60, 120], [0.72, 0.32, 44, 44, 70], [0.35, 0.72, 50, 40, 46], [0.74, 0.74, 40, 40, 90]],
      [[0.5, 0.5, 90, 90, 160]],
      [[0.28, 0.5, 46, 110, 64], [0.74, 0.3, 40, 40, 110], [0.74, 0.74, 40, 40, 38]],
      [[0.3, 0.3, 40, 40, 80], [0.7, 0.3, 40, 40, 80], [0.3, 0.7, 40, 40, 52], [0.7, 0.7, 40, 40, 140]],
    ];
    let n = 0;
    for (let i = 0; i < ax.length - 1; i++) for (let j = 0; j < az.length - 1; j++) {
      const x0 = ax[i] + 14, x1 = ax[i + 1] - 14, z0 = az[j] + 14, z1 = az[j + 1] - 14;
      const pat = patterns[(i * 3 + j * 5 + n) % patterns.length];
      // the square: an empty block in the middle
      if (i === 1 && j === 1) { this.square(0, -780 + 130); continue; }
      const central = Math.abs(ax[i] + 130) < 200 && j >= 1 && j <= 2 ? 1.35 : 1;
      for (const [fx, fz, w, dd, h] of pat) {
        const x = x0 + (x1 - x0) * fx, z = z0 + (z1 - z0) * fz;
        const hh = h * central * (0.85 + hash2(x, z) * 0.3);
        const tone = [0x8c8f96, 0x6f8496, 0x9a9280, 0x7a8ca0][(n + i + j) % 4];
        this.block(x, z, w, dd, hh, tone, { windows: true });
        // a billboard on the roof of the tall ones, a sign on the street face of the low ones
        const ad = ADS[(n * 7 + i + j * 3) % ADS.length];
        if (hh > 90) this.billboard(x, z + dd / 2 + 0.3, this.T.height(x, z) + hh + 6, 22, 9, 0, ad);
        else this.billboard(x, z - dd / 2 - 0.3, this.T.height(x, z) + Math.min(hh, 14), 16, 6, Math.PI, ad);
        n++;
      }
    }
    // a big rotating sign in the middle of the square
    this.landmark = { x: 0, z: -910 };
    this.streetDressing(d);
  }

  // pavements, lamps and parked cars along every street inside a district
  streetDressing(d) {
    const T = this.T;
    const pav = new THREE.MeshLambertMaterial({ color: 0x9da2a8 });
    const lampM = new THREE.MeshLambertMaterial({ color: 0x4a4d54 });
    const headM = new THREE.MeshBasicMaterial({ color: this.night ? 0xffe0a0 : 0x9fa4ad });
    const lampG = new THREE.CylinderGeometry(0.12, 0.16, 7, 5), headG = new THREE.BoxGeometry(1.4, 0.22, 0.5);
    const poles = [];
    for (const r of T.roads) {
      if (r.type !== 'street' && r.type !== 'blvd') continue;
      const pos = [], idx = [];
      for (let s = 0; s <= r.L; s += 8) {
        const p = T.pointAt(r, s);
        if (p.x < d.x0 || p.x > d.x1 || p.z < d.z0 || p.z > d.z1) continue;
        for (const side of [-1, 1]) {
          const o1 = side * (r.T.w / 2 + 0.2), o2 = side * (r.T.w / 2 + 4.5);
          const y = T.roadY(r, s) + 0.16;
          const q = pos.length / 3;
          pos.push(p.x + p.tz * o1, y, p.z - p.tx * o1, p.x + p.tz * o2, y, p.z - p.tx * o2);
          if (s + 8 <= r.L) { const nxt = T.pointAt(r, s + 8); if (nxt.x >= d.x0 && nxt.x <= d.x1 && nxt.z >= d.z0 && nxt.z <= d.z1) idx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1); }
        }
        if (s % 48 === 0) for (const side of [-1, 1]) poles.push([p.x + p.tz * side * (r.T.w / 2 + 2.4), p.z - p.tx * side * (r.T.w / 2 + 2.4), Math.atan2(p.tx, p.tz)]);
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, pav); m.receiveShadow = true; this.group.add(m);
      }
    }
    if (poles.length) {
      const pi = new THREE.InstancedMesh(lampG, lampM, poles.length), hi = new THREE.InstancedMesh(headG, headM, poles.length);
      const dm = new THREE.Object3D();
      poles.forEach(([x, z, yaw], i) => {
        const y = T.height(x, z);
        dm.position.set(x, y + 3.5, z); dm.rotation.set(0, 0, 0); dm.updateMatrix(); pi.setMatrixAt(i, dm.matrix);
        dm.position.set(x, y + 7.0, z); dm.rotation.set(0, yaw, 0); dm.updateMatrix(); hi.setMatrixAt(i, dm.matrix);
      });
      pi.castShadow = true; pi.frustumCulled = hi.frustumCulled = false;
      this.group.add(pi, hi);
    }
  }

  square(x, z) {
    const y = this.T.height(x, z);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(48, 24), new THREE.MeshLambertMaterial({ color: 0xbcb4a6 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(x, y + 0.12, z); plaza.receiveShadow = true;
    this.group.add(plaza);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 34, 8), new THREE.MeshLambertMaterial({ color: 0x3a3d44 }));
    post.position.set(x, y + 17, z); post.castShadow = true; this.group.add(post);
    for (let k = 0; k < 4; k++) this.billboard(x + Math.sin(k * Math.PI / 2) * 3.2, z + Math.cos(k * Math.PI / 2) * 3.2, y + 30, 14, 6, k * Math.PI / 2, 'SAN OOZI');
    this.squareSign = post;
  }

  // ------------------------------------------------------------- sheds
  sheds(d) {
    const long = d.fill === 'docks';
    const cols = long ? 5 : 4, rows = 2;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = d.x0 + 90 + (d.x1 - d.x0 - 180) * (i / (cols - 1));
      const z = d.z0 + 60 + (d.z1 - d.z0 - 120) * (j / (rows - 1)) + (long ? 0 : 20);
      // don't sit on a road
      const nr = this.T.nearestRoad(x, z); if (nr && nr.d < nr.road.T.w / 2 + 30) continue;
      const w = long ? 90 : 60, dd = long ? 40 : 46, h = 12 + hash2(x, z) * 8;
      this.block(x, z, w, dd, h, [0x9a9280, 0x6f8496, 0x8a5f4c, 0x4a5a6c][(i + j) % 4], { windows: false, roofColor: 0x2f3238 });
      if ((i + j) % 2 === 0) this.billboard(x, z + dd / 2 + 0.3, this.T.height(x, z) + h * 0.6, 20, 7, 0, ADS[(i * 5 + j) % ADS.length]);
    }
    // cranes at the docks
    if (long) for (let i = 0; i < 4; i++) {
      const x = d.x0 + 150 + i * 400, z = d.z0 + 40;
      const y = this.T.height(x, z);
      const legM = new THREE.MeshLambertMaterial({ color: 0xd94f4f });
      for (const s of [-1, 1]) { const leg = new THREE.Mesh(this.box, legM); leg.position.set(x + s * 12, y + 20, z); leg.scale.set(2, 40, 2); this.group.add(leg); }
      const beam = new THREE.Mesh(this.box, legM); beam.position.set(x, y + 40, z - 20); beam.scale.set(3, 3, 80); this.group.add(beam);
      const top = new THREE.Mesh(this.box, legM); top.position.set(x, y + 40, z); top.scale.set(28, 3, 3); this.group.add(top);
    }
  }

  // ------------------------------------------------------------- houses
  // along every street inside the district, set back from the kerb, both sides
  houses(d) {
    this.streetDressing(d);
    const cols = [0xf0ece0, 0xe9c9a0, 0xc9d8e6, 0xd9a6a0, 0xa9c9a0, 0xf2e6c8];
    for (const r of this.T.roads) {
      if (r.type !== 'street') continue;
      for (let s = 30; s < r.L - 30; s += 34) {
        const p = this.T.pointAt(r, s);
        for (const side of [-1, 1]) {
          const off = r.T.w / 2 + 14 + hash2(s, side) * 6;
          const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
          if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
          const nr = this.T.nearestRoad(x, z); if (nr && nr.d < nr.road.T.w / 2 + 9) continue;
          const w = 12 + hash2(x, z) * 8, dd = 10 + hash2(z, x) * 6, h = 5 + hash2(x + 1, z) * 4;
          const yaw = Math.atan2(p.tx, p.tz);
          const y = this.T.height(x, z);
          const m = new THREE.Mesh(this.box, new THREE.MeshLambertMaterial({ color: cols[Math.floor(hash2(x * 3, z * 7) * cols.length)] }));
          m.position.set(x, y + h / 2, z); m.scale.set(w, h, dd); m.rotation.y = yaw; m.castShadow = true;
          this.group.add(m);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, dd) * 0.72, 3.2, 4), new THREE.MeshLambertMaterial({ color: [0x8a5f4c, 0x4a5a6c, 0x6a4f3a][Math.floor(hash2(x, z + 9) * 3)], flatShading: true }));
          roof.position.set(x, y + h + 1.6, z); roof.rotation.y = yaw + Math.PI / 4; roof.castShadow = true;
          this.group.add(roof);
          this.walls.push([x, z, w, dd]);
        }
      }
    }
  }

  speedway(d) {
    // an oval track venue: the road ring itself is drawn as a paved loop plus a grandstand
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2, y = this.T.height(cx, cz);
    const stand = this.block(cx - 320, cz, 40, 260, 22, 0x6f8496, { windows: false, roofColor: 0xd94f4f });
    this.billboard(cx - 320 + 20.3, cz, y + 26, 60, 10, Math.PI / 2, 'OOZI SPEEDWAY');
  }

  airfield(d) {
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    for (let i = 0; i < 3; i++) this.block(d.x0 + 120 + i * 140, d.z1 - 90, 90, 60, 16, 0x9a9280, { windows: false, roofColor: 0x4a4d54 });
    const tower = this.block(cx, d.z0 + 80, 14, 14, 30, 0xf0ece0, { windows: true });
    this.billboard(cx, d.z0 + 80 - 7.3, this.T.height(cx, d.z0 + 80) + 33, 18, 6, Math.PI, 'OO AIR');
  }

  beach(d) {
    // huts along the boardwalk, umbrellas on the sand
    for (let x = d.x0 + 80; x < d.x1 - 60; x += 120) {
      const z = -1440; const y = this.T.height(x, z);
      const hut = new THREE.Mesh(this.box, new THREE.MeshLambertMaterial({ color: [0xff9a5c, 0x7ea6ff, 0x6fe3a0, 0xffe066][Math.floor(hash2(x, 1) * 4)] }));
      hut.position.set(x, y + 2.5, z); hut.scale.set(10, 5, 8); hut.castShadow = true; this.group.add(hut);
      this.walls.push([x, z, 10, 8]);
      if (hash2(x, 2) > 0.4) this.billboard(x, z - 4.2, y + 7.5, 10, 4, Math.PI, ADS[Math.floor(hash2(x, 3) * ADS.length)]);
    }
    const um = new THREE.ConeGeometry(2.6, 1.2, 8), pole = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 4);
    for (let i = 0; i < 90; i++) {
      const x = d.x0 + 120 + hash2(i, 5) * (d.x1 - d.x0 - 240), z = -1560 - hash2(i, 6) * 120;
      const y = this.T.height(x, z); if (y < 1) continue;
      const u = new THREE.Mesh(um, new THREE.MeshLambertMaterial({ color: PAL[i % PAL.length].replace('#', '0x') * 1, flatShading: true }));
      u.position.set(x, y + 2.6, z); this.group.add(u);
      const p = new THREE.Mesh(pole, new THREE.MeshLambertMaterial({ color: 0xe8e4d8 })); p.position.set(x, y + 1.3, z); this.group.add(p);
    }
  }
}
