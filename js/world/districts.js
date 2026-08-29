// world/districts.js — what fills the plateaus. Towers downtown, sheds on the
// water, houses on the winding streets, a grandstand at the speedway, hangars
// at the airfield. Everything wears signage. Footprints are hand-placed per
// block; houses sit along their streets. Nothing generates a layout.
//
// Nothing here is a Mesh: every wall, roof, sign, lamp and pavement is pushed
// into the chunk merger (chunks.js) and comes out as one mesh per 300 m cell.

import * as THREE from 'three';
import { DISTRICTS, ROADS, ROAD_TYPES } from './spec.js';
import { STRIP } from './chunks.js';
import { Q } from '../quality.js';

function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }

const ADS = ['OOZI COLA', 'DRIFT KING TYRES', 'MOTEL OO', 'NITRO+', 'BOARDWALK BURGERS', 'CANYON GOLD', 'PIER 9', 'SPEEDWAY SUNDAY',
  'RENT-A-KART', 'OO AIR', 'HACHI GARAGE', 'BIG SLICK OIL', 'SAN OOZI FM', 'THE LOOKOUT', 'DOCKS DINER', 'MEGA MUSHROOM', 'RIM EXPRESS'];
const PAL = ['#ff9a5c', '#7ea6ff', '#ffd98a', '#ff6b8f', '#6fe3a0', '#f0ece0', '#ffe066'];

export class Districts {
  constructor(T, group, night, chunks, glow) {
    this.T = T; this.group = group; this.night = night; this.chunks = chunks; this.glow = glow;
    this.walls = [];                                     // [cx, cz, w, d] for collisions
    this.cone = new THREE.ConeGeometry(1, 1, 4);
    this.cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    this.lampG = new THREE.CylinderGeometry(0.12, 0.16, 7, 5);
    this.M = new THREE.Matrix4();
    for (const d of DISTRICTS) {
      if (d.fill === 'towers') this.downtown(d);
      else if (d.fill === 'harbor' || d.fill === 'docks') this.sheds(d);
      else if (d.fill === 'houses') this.houses(d);
      else if (d.fill === 'speedway') this.speedway(d);
      else if (d.fill === 'airfield') this.airfield(d);
      else if (d.fill === 'beach') this.beach(d);
    }
  }

  // a building: a box on the ground, facade strip by kind, a dark roof
  block(x, z, w, d, h, color, opts = {}) {
    const y = this.T.height(x, z) - 0.5;
    const strip = opts.windows === false ? (opts.shed ? STRIP.shed : STRIP.plain) : (h > 70 ? STRIP.glass : STRIP.windows);
    this.chunks.box(x, y, z, w, h + 0.5, d, opts.yaw || 0, color, { strip, far: h > 12, topColor: opts.roofColor ?? 0x3a3d44 });
    this.walls.push([x, z, w, d]);
  }

  billboard(x, z, y, w, h, yaw, text) {
    const bg = PAL[Math.floor(hash2(text.length, text.charCodeAt(0)) * PAL.length)];
    this.chunks.sign(x, y, z, w, h, yaw, text, bg);
    if (this.night && Q.billboardLights) { const glow = new THREE.PointLight(0xfff0d0, 0.6, 30); glow.position.set(x + Math.sin(yaw) * 2, y, z + Math.cos(yaw) * 2); this.group.add(glow); }
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
    this.landmark = { x: 0, z: -910 };
    this.streetDressing(d);
  }

  // pavements and lamps along every street inside a district
  streetDressing(d) {
    const T = this.T, C = this.chunks;
    const pav = 0x9da2a8, lampC = 0x4a4d54;
    for (const r of T.roads) {
      if (r.type !== 'street' && r.type !== 'blvd') continue;
      const inside = p => p.x >= d.x0 && p.x <= d.x1 && p.z >= d.z0 && p.z <= d.z1;
      let prev = null;
      for (let s = 0; s <= r.L; s += 8) {
        const p = T.pointAt(r, s);
        const y = T.roadY(r, s) + 0.16;
        const cur = inside(p) ? { p, y } : null;
        if (prev && cur) {
          for (const side of [-1, 1]) {
            const o1 = side * (r.T.w / 2 + 0.2), o2 = side * (r.T.w / 2 + 4.5);
            const a = [prev.p.x + prev.p.tz * o1, prev.y, prev.p.z - prev.p.tx * o1], b = [prev.p.x + prev.p.tz * o2, prev.y, prev.p.z - prev.p.tx * o2];
            const c = [cur.p.x + cur.p.tz * o2, cur.y, cur.p.z - cur.p.tx * o2], dd = [cur.p.x + cur.p.tz * o1, cur.y, cur.p.z - cur.p.tx * o1];
            C.quad(a, b, c, dd, pav);
          }
        }
        if (cur && s % 48 === 0) for (const side of [-1, 1]) {
          const x = p.x + p.tz * side * (r.T.w / 2 + 2.4), z = p.z - p.tx * side * (r.T.w / 2 + 2.4);
          const yg = T.height(x, z), yaw = Math.atan2(p.tx, p.tz);
          this.M.makeTranslation(x, yg + 3.5, z);
          C.mesh(this.lampG, this.M, lampC);
          C.box(x, yg + 6.9, z, 1.4, 0.22, 0.5, yaw, 0xffffff, { strip: STRIP.lamp, ao: false, far: false, top: false });
          if (this.glow) this.glow.lamp(x, yg + 6.9, z, 0xffd9a0, 9, yg);
        }
        prev = cur;
      }
    }
  }

  square(x, z) {
    const y = this.T.height(x, z), C = this.chunks;
    this.M.makeRotationX(-Math.PI / 2).setPosition(x, y + 0.12, z);
    C.mesh(new THREE.CircleGeometry(48, 24), this.M, 0xbcb4a6);
    this.M.makeScale(1.3, 34, 1.3).setPosition(x, y + 17, z);
    C.mesh(this.cyl, this.M, 0x3a3d44);
    for (let k = 0; k < 4; k++) this.billboard(x + Math.sin(k * Math.PI / 2) * 3.2, z + Math.cos(k * Math.PI / 2) * 3.2, y + 30, 14, 6, k * Math.PI / 2, 'SAN OOZI');
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
      this.block(x, z, w, dd, h, [0x9a9280, 0x6f8496, 0x8a5f4c, 0x4a5a6c][(i + j) % 4], { windows: false, shed: true, roofColor: 0x2f3238 });
      if ((i + j) % 2 === 0) this.billboard(x, z + dd / 2 + 0.3, this.T.height(x, z) + h * 0.6, 20, 7, 0, ADS[(i * 5 + j) % ADS.length]);
    }
    // cranes at the docks
    if (long) for (let i = 0; i < 4; i++) {
      const x = d.x0 + 150 + i * 400, z = d.z0 + 40;
      const y = this.T.height(x, z), red = 0xd94f4f;
      for (const s of [-1, 1]) this.chunks.box(x + s * 12, y, z, 2, 40, 2, 0, red, { ao: false, far: true });
      this.chunks.box(x, y + 38.5, z - 20, 3, 3, 80, 0, red, { ao: false, far: true });
      this.chunks.box(x, y + 38.5, z, 28, 3, 3, 0, red, { ao: false, far: true });
    }
  }

  // ------------------------------------------------------------- houses
  // along every street inside the district, set back from the kerb, both sides
  houses(d) {
    this.streetDressing(d);
    const cols = [0xf0ece0, 0xe9c9a0, 0xc9d8e6, 0xd9a6a0, 0xa9c9a0, 0xf2e6c8];
    const roofs = [0x8a5f4c, 0x4a5a6c, 0x6a4f3a];
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
          this.chunks.box(x, y - 0.3, z, w, h + 0.3, dd, yaw, cols[Math.floor(hash2(x * 3, z * 7) * cols.length)], { strip: STRIP.windows, floorH: h / 2 + 0.16, far: false });
          const rc = roofs[Math.floor(hash2(x, z + 9) * 3)], rr = Math.max(w, dd) * 0.72;
          this.M.makeRotationY(yaw + Math.PI / 4).scale(new THREE.Vector3(rr, 3.2, rr)).setPosition(x, y + h + 1.6, z);
          this.chunks.mesh(this.cone, this.M, rc);
          this.walls.push([x, z, w, dd]);
        }
      }
    }
  }

  speedway(d) {
    // an oval track venue: the road ring itself is drawn as a paved loop plus a grandstand
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2, y = this.T.height(cx, cz);
    this.block(cx - 320, cz, 40, 260, 22, 0x6f8496, { windows: false, roofColor: 0xd94f4f });
    this.billboard(cx - 320 + 20.3, cz, y + 26, 60, 10, Math.PI / 2, 'OOZI SPEEDWAY');
  }

  airfield(d) {
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    for (let i = 0; i < 3; i++) this.block(d.x0 + 120 + i * 140, d.z1 - 90, 90, 60, 16, 0x9a9280, { windows: false, shed: true, roofColor: 0x4a4d54 });
    this.block(cx, d.z0 + 80, 14, 14, 30, 0xf0ece0, { windows: true });
    this.billboard(cx, d.z0 + 80 - 7.3, this.T.height(cx, d.z0 + 80) + 33, 18, 6, Math.PI, 'OO AIR');
  }

  beach(d) {
    // huts along the boardwalk, umbrellas on the sand
    for (let x = d.x0 + 80; x < d.x1 - 60; x += 120) {
      const z = -1440; const y = this.T.height(x, z);
      const c = [0xff9a5c, 0x7ea6ff, 0x6fe3a0, 0xffe066][Math.floor(hash2(x, 1) * 4)];
      this.chunks.box(x, y, z, 10, 5, 8, 0, c, { far: false });
      this.walls.push([x, z, 10, 8]);
      if (hash2(x, 2) > 0.4) this.billboard(x, z - 4.2, y + 7.5, 10, 4, Math.PI, ADS[Math.floor(hash2(x, 3) * ADS.length)]);
    }
    const um = new THREE.ConeGeometry(2.6, 1.2, 8), pole = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 4);
    for (let i = 0; i < 90; i++) {
      const x = d.x0 + 120 + hash2(i, 5) * (d.x1 - d.x0 - 240), z = -1560 - hash2(i, 6) * 120;
      const y = this.T.height(x, z); if (y < 1) continue;
      this.M.makeTranslation(x, y + 2.6, z); this.chunks.mesh(um, this.M, PAL[i % PAL.length]);
      this.M.makeTranslation(x, y + 1.3, z); this.chunks.mesh(pole, this.M, 0xe8e4d8);
    }
  }
}
