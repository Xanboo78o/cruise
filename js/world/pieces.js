// world/pieces.js — the catalogue for the city tool: ~100 things Adam can put
// down. Every piece is a recipe drawn with the chunk merger (chunks.js), so a
// thousand of them still cost one draw call per cell. A placed piece carries
// {x, z, r: yaw°, s: scale, c: colour index, seed, text?}; the recipe reads
// those, so two of the same piece rarely look the same.

import * as THREE from 'three';
import { STRIP } from './chunks.js';

export const PALETTE = [
  0xf0ece0, 0xe9c9a0, 0xc9d8e6, 0xd9a6a0, 0xa9c9a0, 0xf2e6c8, 0xffd98a, 0xff9a5c,
  0x7ea6ff, 0x6fe3a0, 0xff6b8f, 0xffe066, 0x8c8f96, 0x6f8496, 0x9a9280, 0x7a8ca0,
  0x8a5f4c, 0x4a5a6c, 0x6a4f3a, 0x3a3d44, 0xd94f4f, 0x2f5a35, 0x4f8a3a, 0xc9742f,
];
const ROOFS = [0x8a5f4c, 0x4a5a6c, 0x6a4f3a, 0x3a3d44, 0xd94f4f, 0x9a9280];
const DARK = 0x3a3d44, WOOD = 0x6a4f3a, STEEL = 0x8c8f96, GLASS = 0x7ea6ff, WHITE = 0xf0ece0, ASPHALT = 0x3f434a, GRASS = 0x4f8a3a;
function hash(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }

// shared geometries
const GEO = {
  cone4: new THREE.ConeGeometry(1, 1, 4), cone6: new THREE.ConeGeometry(1, 1, 6), cone8: new THREE.ConeGeometry(1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6), cyl8: new THREE.CylinderGeometry(1, 1, 1, 8), cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cylTaper: new THREE.CylinderGeometry(0.7, 1, 1, 6),
  ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1), sphere: new THREE.SphereGeometry(1, 8, 6),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  halfCyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, 0, Math.PI),
  disc: new THREE.CircleGeometry(1, 16), ring: new THREE.RingGeometry(0.7, 1, 16), box: new THREE.BoxGeometry(1, 1, 1),
};

// P: everything a recipe needs, in the piece's own frame (x right, z forward,
// yawed by o.r, scaled by o.s). y is local height above the ground at (o.x, o.z).
class P {
  constructor(C, G, T, o, seed) {
    this.C = C; this.G = G; this.T = T; this.o = o;
    this.x = o.x; this.z = o.z; this.yaw = (o.r || 0) * Math.PI / 180; this.s = o.s || 1;
    this.y0 = T.height(o.x, o.z);
    this.seed = seed;
    this.sy = Math.sin(this.yaw); this.cy = Math.cos(this.yaw);
    this.M = new THREE.Matrix4();
    this.col = o.c != null && PALETTE[o.c] != null ? PALETTE[o.c] : null;
    this.top = 0;                                   // highest point built so far (local m) — the detail pass puts chimneys/units on it
    this.front = null;                              // the box whose +z face is furthest forward: where the door goes
    this.walls = [];                                // every box: [lx, ly, lz, w, h, d]
  }
  rnd(i) { return hash(this.seed * 7.13 + i * 3.7, this.seed * 1.71 + i); }
  pick(list, i = 0) { return list[Math.floor(this.rnd(i) * list.length) % list.length]; }
  color(fallback) { return this.col ?? fallback; }
  // local → world
  W(lx, lz) { const s = this.s; return [this.x + (lx * this.cy + lz * this.sy) * s, this.z + (-lx * this.sy + lz * this.cy) * s]; }
  // a box: local centre (lx, lz), bottom at local ly, size w×h×d, own extra yaw
  box(lx, ly, lz, w, h, d, color, opts = {}) {
    const [wx, wz] = this.W(lx, lz), s = this.s;
    this.C.box(wx, this.y0 + ly * s, wz, w * s, h * s, d * s, this.yaw + (opts.yaw || 0), color, { far: opts.far ?? (h * s > 12), ...opts });
    if (!opts.yaw && !opts.detail) {
      this.top = Math.max(this.top, ly + h);
      if (h >= 2.6 && (!this.front || lz + d / 2 > this.front.z + 0.05 || (Math.abs(lz + d / 2 - this.front.z) <= 0.05 && w > this.front.w))) this.front = { x: lx, z: lz + d / 2, w, h: ly + h, y: ly };
      this.walls.push([lx, ly, lz, w, h, d]);
    }
  }
  // any geometry: local centre, scale (sx, sy, sz), own yaw, tilt about x
  mesh(geom, lx, ly, lz, sx, sy, sz, color, opts = {}) {
    const [wx, wz] = this.W(lx, lz), s = this.s;
    this.M.makeRotationY(this.yaw + (opts.yaw || 0));
    if (opts.tilt) this.M.multiply(new THREE.Matrix4().makeRotationX(opts.tilt));
    if (opts.roll) this.M.multiply(new THREE.Matrix4().makeRotationZ(opts.roll));
    this.M.scale(new THREE.Vector3(sx * s, sy * s, sz * s)).setPosition(wx, this.y0 + ly * s, wz);
    this.C.mesh(geom, this.M, color, opts);
    if (!opts.detail) this.top = Math.max(this.top, ly + sy * 0.5);
  }
  sign(lx, ly, lz, w, h, text, bg, yawOff = 0) {
    const [wx, wz] = this.W(lx, lz), s = this.s;
    this.C.sign(wx, this.y0 + ly * s, wz, w * s, h * s, this.yaw + yawOff, text, bg);
  }
  // a flat quad on the ground (local corners), slightly raised
  slab(lx, lz, w, d, color, ly = 0.05) {
    const s = this.s, c = [];
    for (const [ax, az] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) { const [wx, wz] = this.W(lx + ax, lz + az); c.push([wx, this.T.height(wx, wz) + ly * s, wz]); }
    this.C.quad(c[0], c[1], c[2], c[3], color);
  }
  // roofs
  hip(lx, ly, lz, w, d, h, color) { this.mesh(GEO.cone4, lx, ly, lz, Math.max(w, d) * 0.72, h, Math.max(w, d) * 0.72, color, { yaw: Math.PI / 4 }); }
  gable(lx, ly, lz, w, d, h, color, alongX = true) {
    // two sloped planes and two gable ends, ridge along x (or z)
    const s = this.s, y = this.y0 + ly * s, yt = y + h * s;
    const pts = alongX
      ? { a: [-w / 2, -d / 2], b: [w / 2, -d / 2], c: [w / 2, d / 2], d: [-w / 2, d / 2], r1: [-w / 2, 0], r2: [w / 2, 0] }
      : { a: [-w / 2, d / 2], b: [-w / 2, -d / 2], c: [w / 2, -d / 2], d: [w / 2, d / 2], r1: [0, d / 2], r2: [0, -d / 2] };
    const Wp = ([px, pz], yy) => { const [wx, wz] = this.W(lx + px, lz + pz); return [wx, yy, wz]; };
    const A = Wp(pts.a, y), B = Wp(pts.b, y), Cc = Wp(pts.c, y), D = Wp(pts.d, y), R1 = Wp(pts.r1, yt), R2 = Wp(pts.r2, yt);
    this.top = Math.max(this.top, ly + h);
    this.C.quad(A, B, R2, R1, color, { any: true }); this.C.quad(D, R1, R2, Cc, color, { any: true });
    this.C.tri(A, R1, D, color); this.C.tri(B, Cc, R2, color);
  }
  // a lamp: pole + head + glow, local position, height h
  lamp(lx, lz, h = 7, color = 0xffd9a0, r = 9, arm = 0) {
    const [wx, wz] = this.W(lx, lz), s = this.s, yg = this.T.height(wx, wz);
    this.M.makeScale(0.14 * s, h * s + 1, 0.14 * s).setPosition(wx, yg + (h * s - 1) / 2, wz);
    this.C.mesh(GEO.cyl6, this.M, 0x4a4d54);
    const [hx, hz] = this.W(lx + arm, lz);
    if (arm) this.box(lx + arm / 2, h - 0.15, lz, Math.abs(arm) + 0.2, 0.14, 0.14, 0x4a4d54, { ao: false, far: false, top: false });
    this.C.box(hx, yg + h * s - 0.1, hz, 1.2 * s, 0.24 * s, 0.5 * s, this.yaw, 0xffffff, { strip: STRIP.lamp, ao: false, far: false, top: false });
    if (this.G) this.G.lamp(hx, yg + h * s - 0.1, hz, color, r * s, this.T.height(hx, hz));
  }
  glowBlob(lx, ly, lz, r, color, k = 0.8) { if (!this.G) return; const [wx, wz] = this.W(lx, lz); this.G.blob(wx, this.y0 + ly * this.s, wz, r * this.s, color, k); this.G.lamps.push([wx, this.y0 + ly * this.s, wz]); }
  glowPool(lx, lz, r, color, k = 0.18) { if (!this.G) return; const [wx, wz] = this.W(lx, lz); this.G.pool(wx, this.T.height(wx, wz) + 0.06, wz, r * this.s, color, k); }
  // a tree: trunk + crown; kind: pine|broad|palm|autumn|cypress|dead|bush
  tree(lx, lz, kind, h = 1, color = null) {
    const s = h;
    const [wx, wz] = this.W(lx, lz), yg = this.T.height(wx, wz), S = this.s * s;
    const M = this.M, trunk = kind === 'palm' ? 0x8a7355 : 0x5c4632;
    const put = (g, y, sx, sy, sz, c, yaw = 0) => { M.makeRotationY(this.yaw + yaw).scale(new THREE.Vector3(sx * S, sy * S, sz * S)).setPosition(wx, yg + y * S, wz); this.C.mesh(g, M, c); };   // trees never count toward a building's top
    if (kind === 'pine') { put(GEO.cyl6, 1.6, 0.3, 6.4, 0.3, trunk); put(GEO.cone6, 8.5, 3.2, 9, 3.2, color ?? 0x2f5a35); put(GEO.cone6, 5, 3.9, 6, 3.9, color ?? 0x2a5030); }
    else if (kind === 'broad') { put(GEO.cyl6, 1.2, 0.34, 5.6, 0.34, trunk); put(GEO.ico, 6.4, 3.6, 3.4, 3.6, color ?? 0x4f8a3a); put(GEO.ico, 7.6, 2.4, 2.2, 2.4, color ?? 0x5a9a44, 0.7); }
    else if (kind === 'palm') { put(GEO.cylTaper, 3.2, 0.32, 9.6, 0.32, trunk); for (let i = 0; i < 6; i++) put(GEO.cone6, 8.2, 0.9, 4.2, 0.9, color ?? 0x4f8a4a, i * 1.05); }
    else if (kind === 'autumn') { put(GEO.cyl6, 1.2, 0.34, 5.6, 0.34, trunk); put(GEO.ico, 6.2, 3.2, 3.2, 3.2, color ?? 0xc9742f); }
    else if (kind === 'cypress') { put(GEO.cyl6, 0.2, 0.2, 3.6, 0.2, trunk); put(GEO.cone6, 7, 1.3, 12, 1.3, color ?? 0x2a4a2a); }
    else if (kind === 'dead') { put(GEO.cyl6, 2.2, 0.3, 7.6, 0.3, 0x4a3a2a); put(GEO.cylTaper, 6.5, 0.16, 3, 0.16, 0x4a3a2a, 0.5); }
    else if (kind === 'bush') { put(GEO.ico, 1, 1.6, 1.3, 1.6, color ?? 0x4f8a3a); put(GEO.ico, 1.2, 1.1, 1.0, 1.1, color ?? 0x5a9a44, 1.2); }
    else if (kind === 'cactus') { put(GEO.cyl8, 2, 0.45, 4, 0.45, 0x5a8a4a); put(GEO.cyl8, 2.6, 0.3, 1.8, 0.3, 0x5a8a4a); }
  }
  rock(lx, lz, r, color = 0x8a7a66, i = 0) {
    const [wx, wz] = this.W(lx, lz), yg = this.T.height(wx, wz), S = this.s;
    this.M.makeRotationY(this.yaw + this.rnd(i) * 6).scale(new THREE.Vector3(r * (0.8 + this.rnd(i + 1) * 0.5) * S, r * 0.65 * S, r * (0.8 + this.rnd(i + 2) * 0.5) * S)).setPosition(wx, yg + r * 0.25 * S, wz);
    this.C.mesh(this.rnd(i + 3) < 0.5 ? GEO.dodeca : GEO.ico1, this.M, color);
  }
  // a boxy car in a colour, parked
  car(lx, lz, color, yawOff = 0) {
    const c = color ?? this.pick([0xd94f4f, 0x7ea6ff, 0xf0ece0, 0x3a3d44, 0x6fe3a0, 0xffe066, 0x8c8f96], 4);
    this.box(lx, 0.35, lz, 1.8, 0.7, 4.2, c, { yaw: yawOff, ao: false, far: false, detail: true });
    this.box(lx, 1.0, lz - 0.2, 1.6, 0.6, 2.2, 0x2a2d33, { yaw: yawOff, ao: false, far: false, detail: true });
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
      const [gx, gz] = [wx * Math.cos(yawOff) + wz * Math.sin(yawOff), -wx * Math.sin(yawOff) + wz * Math.cos(yawOff)];
      this.mesh(GEO.cyl8, lx + gx, 0.3, lz + gz, 0.3, 0.2, 0.3, 0x1a1c20, { roll: Math.PI / 2, yaw: yawOff });
    }
  }
}

// ------------------------------------------------------------------ the catalogue
// { id, cat, name, fp: [w, d] footprint for collisions (null = walk-through), build(P) }
const R = (id, cat, name, fp, build, extra = {}) => ({ id, cat, name, fp, build, ...extra });
export const PIECES = [
  // ----------------------------------------------------------------- HOUSES
  R('bungalow', 'houses', 'BUNGALOW', [12, 9], P => { const c = P.color(0xf0ece0), rf = P.pick(ROOFS); P.box(0, 0, 0, 12, 3.6, 9, c, { strip: STRIP.windows, floorH: 3.6 }); P.hip(0, 3.6, 0, 12, 9, 2.6, rf); P.box(0, 0, 5.6, 5, 2.8, 2.2, c, { far: false }); P.box(0, 2.8, 5.6, 5.6, 0.3, 2.6, rf, { far: false }); }),
  R('cottage', 'houses', 'COTTAGE', [9, 8], P => { const c = P.color(0xe9c9a0); P.box(0, 0, 0, 9, 3.4, 8, c, { strip: STRIP.windows, floorH: 3.4 }); P.gable(0, 3.4, 0, 9.6, 8.6, 3.4, P.pick(ROOFS)); P.box(2.6, 3, 1.5, 0.8, 3.2, 0.8, 0x6a5040, { ao: false, far: false }); }),
  R('twostorey', 'houses', 'TWO-STOREY', [10, 9], P => { const c = P.color(0xc9d8e6); P.box(0, 0, 0, 10, 6.6, 9, c, { strip: STRIP.windows }); P.gable(0, 6.6, 0, 10.6, 9.6, 3, P.pick(ROOFS)); P.box(0, 0, 5.4, 2.4, 2.8, 1.8, WHITE, { far: false }); }),
  R('lhouse', 'houses', 'L-HOUSE', [14, 12], P => { const c = P.color(0xd9a6a0), rf = P.pick(ROOFS); P.box(-2, 0, 0, 10, 3.6, 8, c, { strip: STRIP.windows, floorH: 3.6 }); P.gable(-2, 3.6, 0, 10.6, 8.6, 2.8, rf); P.box(4, 0, 3, 6, 3.6, 10, c, { strip: STRIP.windows, floorH: 3.6 }); P.gable(4, 3.6, 3, 6.6, 10.6, 2.6, rf, false); }),
  R('ranch', 'houses', 'RANCH', [18, 9], P => { const c = P.color(0xf2e6c8), rf = P.pick(ROOFS); P.box(0, 0, 0, 18, 3.4, 9, c, { strip: STRIP.windows, floorH: 3.4 }); P.hip(0, 3.4, 0, 18, 9, 2.4, rf); P.box(7, 0, 5.5, 4, 2.6, 2, 0x9a9280, { far: false }); P.box(-3, 1.2, 4.9, 10, 0.2, 1.6, rf, { far: false }); }),
  R('splitlevel', 'houses', 'SPLIT-LEVEL', [12, 10], P => { const c = P.color(0xa9c9a0), rf = P.pick(ROOFS); P.box(-3, 0, 0, 6, 6.4, 10, c, { strip: STRIP.windows }); P.gable(-3, 6.4, 0, 6.6, 10.6, 2.4, rf, false); P.box(3, 0, 0, 6, 3.4, 10, c, { strip: STRIP.windows, floorH: 3.4 }); P.box(3, 3.4, 0, 6.4, 0.3, 10.4, rf, { far: false }); }),
  R('townhouse', 'houses', 'TOWNHOUSE', [7, 11], P => { const c = P.color(0x8a5f4c); P.box(0, 0, 0, 7, 9.6, 11, c, { strip: STRIP.brick, floorH: 3.2 }); P.box(0, 9.6, 0, 7.4, 0.5, 11.4, DARK, { far: false }); P.box(0, 0, 6, 2.2, 3, 1.4, WHITE, { far: false }); }),
  R('duplex', 'houses', 'DUPLEX', [16, 9], P => { const rf = P.pick(ROOFS); P.box(-4, 0, 0, 8, 6.4, 9, P.color(0xf0ece0), { strip: STRIP.windows }); P.box(4, 0, 0, 8, 6.4, 9, P.pick([0xe9c9a0, 0xc9d8e6, 0xd9a6a0], 1), { strip: STRIP.windows }); P.gable(0, 6.4, 0, 16.6, 9.6, 3, rf); }),
  R('aframe', 'houses', 'A-FRAME', [9, 10], P => { P.gable(0, 0.2, 0, 9, 10, 8, P.color(0x6a4f3a)); P.box(0, 0, 5.2, 4, 3, 0.4, 0x3a3d44, { far: false }); P.slab(0, 6.5, 6, 3, 0x9a9280, 0.3); }),
  R('cabin', 'houses', 'LOG CABIN', [8, 7], P => { P.box(0, 0, 0, 8, 3, 7, P.color(0x6a4f3a), { strip: STRIP.shed, far: false }); P.gable(0, 3, 0, 9, 8, 2.4, 0x4a3a2a); P.box(2.5, 2, -2, 0.8, 3, 0.8, 0x8c8f96, { ao: false, far: false }); }),
  R('stilts', 'houses', 'BEACH HOUSE', [11, 9], P => { const c = P.color(0x7ea6ff); for (const [x, z] of [[-4.5, -3.5], [4.5, -3.5], [-4.5, 3.5], [4.5, 3.5]]) P.box(x, 0, z, 0.5, 3, 0.5, WOOD, { ao: false, far: false }); P.box(0, 3, 0, 11, 3.4, 9, c, { strip: STRIP.windows, floorH: 3.4 }); P.hip(0, 6.4, 0, 11, 9, 2.2, P.pick(ROOFS)); P.slab(0, 6.5, 11, 4, WOOD, 3.1); }),
  R('villa', 'houses', 'VILLA', [16, 14], P => { const c = P.color(0xf0ece0); P.box(-2, 0, 0, 12, 3.6, 10, c, { strip: STRIP.glass, floorH: 3.6 }); P.box(2, 3.6, -1, 8, 3.4, 7, c, { strip: STRIP.glass, floorH: 3.4 }); P.slab(6, 4, 6, 4, 0x2b6b8a, 0.1); P.slab(6, 4, 7.6, 5.6, 0xe0d8c8, 0.05); }),
  R('garagefront', 'houses', 'GARAGE HOUSE', [13, 10], P => { const c = P.color(0xe9c9a0), rf = P.pick(ROOFS); P.box(-3, 0, 0, 7, 6.2, 10, c, { strip: STRIP.windows }); P.gable(-3, 6.2, 0, 7.6, 10.6, 2.6, rf, false); P.box(3.5, 0, 1, 6, 3.2, 8, c, { far: false }); P.box(3.5, 3.2, 1, 6.4, 0.3, 8.4, rf, { far: false }); P.box(3.5, 0, 5.05, 4.2, 2.4, 0.2, WHITE, { ao: false, far: false }); P.slab(3.5, 8, 4.5, 6, ASPHALT); }),
  R('mobile', 'houses', 'MOBILE HOME', [14, 5], P => { P.box(0, 0.5, 0, 14, 2.8, 4.6, P.color(0xc9d8e6), { strip: STRIP.windows, floorH: 2.8, far: false }); P.box(0, 3.3, 0, 14.4, 0.3, 5, 0x9a9280, { far: false }); P.box(-4, 0, 3, 3, 0.5, 1.5, WOOD, { far: false }); }),
  R('farmhouse', 'houses', 'FARMHOUSE + BARN', [30, 16], P => { const c = P.color(0xf0ece0); P.box(-8, 0, 0, 10, 6.4, 9, c, { strip: STRIP.windows }); P.gable(-8, 6.4, 0, 10.6, 9.6, 3.2, 0x4a5a6c); P.box(8, 0, 2, 12, 5, 10, 0xd94f4f, { strip: STRIP.shed }); P.gable(8, 5, 2, 12.8, 10.8, 4, 0x3a3d44, false); P.box(15, 0, -4, 3, 7, 3, 0x9a9280, { far: true }); }),
  R('mansion', 'houses', 'MANSION', [24, 14], P => { const c = P.color(0xf0ece0), rf = P.pick(ROOFS); P.box(0, 0, 0, 24, 7, 14, c, { strip: STRIP.windows, floorH: 3.5 }); P.hip(0, 7, 0, 24, 14, 3.6, rf); for (let i = -2; i <= 2; i++) P.mesh(GEO.cyl8, i * 2.4, 3.2, 7.6, 0.35, 6.4, 0.35, WHITE); P.box(0, 6.6, 7.6, 12, 0.6, 2, c, { far: false }); P.slab(0, 12, 14, 8, 0xbcb4a6); }),
  R('adobe', 'houses', 'ADOBE', [11, 9], P => { const c = P.color(0xe9c9a0); P.box(0, 0, 0, 11, 3.4, 9, c, { far: false }); P.box(3, 3.4, -1, 5, 2.8, 6, c, { far: false }); P.box(0, 3.4, 0, 11.4, 0.4, 9.4, c, { far: false }); for (let i = -2; i <= 2; i++) P.box(i * 2, 2.6, 4.6, 0.3, 0.3, 0.6, WOOD, { ao: false, far: false }); }),
  R('rowhouse', 'houses', 'ROW HOUSES ×3', [18, 10], P => { const cs = [P.color(0x8a5f4c), 0xd9a6a0, 0x9a9280]; for (let i = -1; i <= 1; i++) { P.box(i * 6, 0, 0, 5.8, 8.8 + P.rnd(i + 3) * 1.5, 10, cs[i + 1], { strip: STRIP.brick, floorH: 3 }); P.box(i * 6, 0, 5.4, 1.6, 2.6, 0.8, WHITE, { far: false }); } P.box(0, 9.5, 0, 18, 0.4, 10.4, DARK, { far: false }); }),
  R('tinyhouse', 'houses', 'TINY HOUSE', [5, 4], P => { P.box(0, 0, 0, 5, 2.8, 3.6, P.color(0x6fe3a0), { far: false }); P.gable(0, 2.8, 0, 5.4, 4, 1.8, DARK); }),
  R('hut', 'houses', 'HUT', [5, 5], P => { P.mesh(GEO.cyl8, 0, 1.3, 0, 2.4, 2.6, 2.4, P.color(0xe9c9a0)); P.mesh(GEO.cone8, 0, 3.8, 0, 3.2, 2.6, 3.2, 0x9a8a5a); }),
  R('modern', 'houses', 'MODERN BOX', [14, 11], P => { const c = P.color(0xf0ece0); P.box(-2, 0, 0, 10, 3.5, 9, c, { strip: STRIP.glass, floorH: 3.5 }); P.box(2.5, 3.5, -1.5, 9, 3.5, 7, DARK, { strip: STRIP.glass, floorH: 3.5 }); P.box(-4, 7, -1.5, 3, 0.6, 3, 0x9a9280, { far: false }); }),
  R('victorian', 'houses', 'VICTORIAN', [12, 11], P => { const c = P.color(0xc9d8e6), rf = P.pick(ROOFS); P.box(1, 0, 0, 10, 7, 10, c, { strip: STRIP.windows, floorH: 3.5 }); P.gable(1, 7, 0, 10.6, 10.6, 3.6, rf); P.mesh(GEO.cyl8, -4.5, 4.5, 4.5, 2.2, 9, 2.2, c); P.mesh(GEO.cone8, -4.5, 10.8, 4.5, 2.6, 3.6, 2.6, rf); P.box(2, 0, 5.6, 5, 2.8, 1.4, WHITE, { far: false }); }),
  R('hillside', 'houses', 'HILLSIDE HOUSE', [12, 10], P => { const c = P.color(0xf2e6c8); P.box(0, 0, 0, 12, 4.5, 10, 0x8c8f96, { far: false }); P.box(0, 4.5, 0, 12, 3.4, 10, c, { strip: STRIP.glass, floorH: 3.4 }); P.box(0, 7.9, 0, 12.6, 0.4, 10.6, DARK, { far: false }); P.slab(0, 7, 12, 4, WOOD, 4.6); }),
  R('courtyard', 'houses', 'COURTYARD HOUSE', [16, 14], P => { const c = P.color(0xe9c9a0), rf = P.pick(ROOFS); P.box(0, 0, -5, 16, 3.5, 4, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(-6, 0, 1, 4, 3.5, 8, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(6, 0, 1, 4, 3.5, 8, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(0, 3.5, -5, 16.4, 0.4, 4.4, rf, { far: false }); P.box(-6, 3.5, 1, 4.4, 0.4, 8.4, rf, { far: false }); P.box(6, 3.5, 1, 4.4, 0.4, 8.4, rf, { far: false }); P.slab(0, 1, 8, 8, 0xbcb4a6); P.tree(0, 1, 'broad', 0.5); }),

  // -------------------------------------------------------------- BUILDINGS
  R('cornerstore', 'buildings', 'CORNER STORE', [14, 12], P => { P.box(0, 0, 0, 14, 4, 12, P.color(0xd9a6a0), { strip: STRIP.shop, floorH: 4 }); P.box(0, 4, 0, 14.6, 0.5, 12.6, DARK, { far: false }); P.sign(0, 5.2, 6.4, 8, 2, P.o.text || 'OOZI MART', '#ffd98a'); }),
  R('shoprow', 'buildings', 'SHOP ROW', [24, 12], P => { const cs = [0xf0ece0, 0xffd98a, 0x7ea6ff, 0xd9a6a0]; for (let i = -1.5; i <= 1.5; i++) { P.box(i * 6, 0, 0, 5.9, 4 + (i % 2 ? 0.8 : 0), 12, cs[(i + 1.5) | 0], { strip: STRIP.shop, floorH: 4.8 }); P.sign(i * 6, 5.5, 6.3, 4.4, 1.4, P.pick(['CAFE', 'BARBER', 'PIZZA', 'BOOKS', 'TYRES', 'LAUNDRY', 'PHONES', 'TACOS'], i + 2), '#f0ece0'); } }),
  R('diner', 'buildings', 'DINER', [16, 9], P => { P.box(0, 0, 0, 16, 3.8, 9, 0xd94f4f, { strip: STRIP.shop, floorH: 3.8, far: false }); P.box(0, 3.8, 0, 16.6, 0.5, 9.6, STEEL, { far: false }); P.box(-9, 0, 0, 0.4, 8, 0.4, STEEL, { ao: false, far: false }); P.sign(-9, 7.2, 0, 5, 2.2, P.o.text || 'DINER', '#ffe066'); P.glowBlob(-9, 7.2, 0, 1.2, 0xff6b8f, 0.5); }),
  R('gasstation', 'buildings', 'GAS STATION', [26, 18], P => { P.slab(0, 0, 26, 18, ASPHALT); for (const [x, z] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) P.box(x, 0, z, 0.5, 5.5, 0.5, STEEL, { ao: false, far: false }); P.box(0, 5.5, 0, 20, 0.8, 14, P.color(0xd94f4f), { far: true }); for (const x of [-4, 4]) { P.box(x, 0, 0, 1, 1.8, 2.2, 0xf0ece0, { far: false }); P.glowPool(x, 0, 5, 0xfff0d0, 0.12); } P.box(0, 0, -11, 12, 3.6, 6, 0xf0ece0, { strip: STRIP.shop, floorH: 3.6 }); P.box(-12, 0, 8, 0.4, 9, 0.4, STEEL, { ao: false, far: false }); P.sign(-12, 8, 8, 4, 2.4, P.o.text || 'BIG SLICK', '#ff9a5c'); }),
  R('motel', 'buildings', 'MOTEL', [30, 20], P => { const c = P.color(0xf2e6c8); P.box(-5, 0, -7, 20, 6.6, 6, c, { strip: STRIP.windows }); P.box(10, 0, 0, 6, 6.6, 20, c, { strip: STRIP.windows }); P.box(-5, 6.6, -7, 20.6, 0.4, 6.6, DARK, { far: false }); P.box(10, 6.6, 0, 6.6, 0.4, 20.6, DARK, { far: false }); P.slab(-5, 4, 20, 14, ASPHALT); P.box(-14, 0, 6, 0.5, 11, 0.5, STEEL, { ao: false, far: false }); P.sign(-14, 9.5, 6, 6, 3, P.o.text || 'MOTEL OO', '#7ea6ff'); P.glowBlob(-14, 9.5, 6, 1.5, 0xff6b8f, 0.5); P.car(-9, 2, null, 0); P.car(-3, 2, null, 0); }),
  R('office4', 'buildings', 'OFFICE 4F', [20, 16], P => { P.box(0, 0, 0, 20, 14, 16, P.color(0x9a9280), { strip: STRIP.windows, floorH: 3.5 }); P.box(0, 14, 0, 20.4, 0.6, 16.4, DARK); P.box(0, 0, 8.4, 6, 3.4, 1.2, GLASS, { far: false }); }),
  R('apartments6', 'buildings', 'APARTMENTS 6F', [24, 14], P => { const c = P.color(0xe9c9a0); P.box(0, 0, 0, 24, 19, 14, c, { strip: STRIP.windows, floorH: 3.15 }); for (let f = 1; f < 6; f++) for (let i = -2; i <= 2; i++) P.box(i * 4.5, f * 3.15 - 0.1, 7.6, 3, 0.25, 1.4, 0xf0ece0, { ao: false, far: false }); P.box(0, 19, 0, 24.4, 0.5, 14.4, DARK); }),
  R('tower15', 'buildings', 'TOWER 15F', [26, 26], P => { P.box(0, 0, 0, 26, 50, 26, P.color(0x7a8ca0), { strip: STRIP.windows }); P.box(0, 50, 0, 8, 4, 8, DARK); }),
  R('tower25', 'buildings', 'GLASS TOWER 25F', [30, 30], P => { P.box(0, 0, 0, 30, 82, 30, P.color(0x6f8496), { strip: STRIP.glass }); P.box(0, 82, 0, 30.6, 1.2, 30.6, DARK); P.box(0, 83, 0, 1, 12, 1, STEEL, { ao: false }); P.glowBlob(0, 95, 0, 0.8, 0xff4040, 0.9); }),
  R('tower40', 'buildings', 'STEPPED TOWER 40F', [40, 40], P => { const c = P.color(0x8c8f96); P.box(0, 0, 0, 40, 46, 40, c, { strip: STRIP.glass }); P.box(0, 46, 0, 30, 46, 30, c, { strip: STRIP.glass }); P.box(0, 92, 0, 20, 40, 20, c, { strip: STRIP.glass }); P.box(0, 132, 0, 1.2, 18, 1.2, STEEL, { ao: false }); P.glowBlob(0, 150, 0, 1, 0xff4040, 0.9); }),
  R('podium', 'buildings', 'PODIUM TOWER', [40, 30], P => { P.box(0, 0, 0, 40, 12, 30, P.color(0x9a9280), { strip: STRIP.shop, floorH: 4 }); P.box(4, 12, 0, 18, 60, 18, P.color(0x7a8ca0), { strip: STRIP.glass }); P.box(4, 72, 0, 18.4, 1, 18.4, DARK); }),
  R('warehouse', 'buildings', 'WAREHOUSE', [40, 24], P => { P.box(0, 0, 0, 40, 9, 24, P.color(0x9a9280), { strip: STRIP.shed, roofColor: 0x4a4d54 }); for (let i = -1; i <= 1; i++) P.box(i * 12, 0, 12.1, 6, 5, 0.2, 0x3a3d44, { ao: false, far: false }); P.slab(0, 20, 40, 14, ASPHALT); }),
  R('hangar', 'buildings', 'HANGAR', [40, 30], P => { P.box(0, 0, 0, 40, 8, 30, P.color(0x8c8f96), { strip: STRIP.shed }); P.mesh(GEO.halfCyl, 0, 8, 0, 20, 30, 12, 0x9a9280, { roll: Math.PI / 2, tilt: 0 }); P.box(0, 0, 15.1, 26, 7, 0.2, 0x4a4d54, { ao: false, far: false }); }),
  R('factory', 'buildings', 'FACTORY', [36, 24], P => { P.box(0, 0, 0, 36, 12, 24, P.color(0x8a5f4c), { strip: STRIP.brick, floorH: 4 }); for (const x of [-10, 6]) { P.mesh(GEO.cyl8, x, 16, -6, 1.6, 32, 1.6, 0x6a4f3a); } P.box(0, 12, 0, 36.4, 0.5, 24.4, DARK); for (let i = -2; i <= 2; i++) P.gable(i * 7, 12.5, 0, 7, 24, 2.2, 0x9a9280, false); }),
  R('watertower', 'buildings', 'WATER TOWER', [8, 8], P => { for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) P.box(x, 0, z, 0.4, 14, 0.4, STEEL, { ao: false }); P.mesh(GEO.cyl12, 0, 17, 0, 4, 6, 4, P.color(0xf0ece0)); P.mesh(GEO.cone8, 0, 21.5, 0, 4.4, 3, 4.4, 0x4a5a6c); P.sign(0, 17, 4.1, 6, 2.4, P.o.text || 'SAN OOZI', '#f0ece0'); }),
  R('church', 'buildings', 'CHURCH', [14, 24], P => { const c = P.color(0xf0ece0); P.box(0, 0, 2, 12, 8, 20, c, { strip: STRIP.brick, floorH: 4 }); P.gable(0, 8, 2, 12.6, 20.6, 4, 0x4a5a6c, false); P.box(0, 0, -10, 6, 18, 6, c, { far: true }); P.mesh(GEO.cone4, 0, 21, -10, 4.4, 6, 4.4, 0x4a5a6c, { yaw: Math.PI / 4 }); P.box(0, 24, -10, 0.3, 2.4, 0.3, 0xffe066, { ao: false, far: false }); }),
  R('school', 'buildings', 'SCHOOL', [50, 40], P => { const c = P.color(0xe9c9a0); P.box(-10, 0, -12, 30, 7, 14, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(10, 0, -12, 10, 3.5, 14, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(-10, 7, -12, 30.4, 0.4, 14.4, DARK); P.slab(0, 10, 44, 24, GRASS); P.slab(0, 10, 38, 18, 0x4f7a3a, 0.08); P.box(-19, 0, 10, 0.3, 4, 0.3, WHITE, { ao: false, far: false }); P.box(19, 0, 10, 0.3, 4, 0.3, WHITE, { ao: false, far: false }); P.sign(-10, 8.6, -4.6, 10, 1.6, P.o.text || 'OOZI HIGH', '#f0ece0'); }),
  R('hospital', 'buildings', 'HOSPITAL', [40, 30], P => { const c = P.color(0xf0ece0); P.box(-14, 0, 0, 12, 24, 30, c, { strip: STRIP.windows, floorH: 3.4 }); P.box(14, 0, 0, 12, 24, 30, c, { strip: STRIP.windows, floorH: 3.4 }); P.box(0, 0, 0, 16, 14, 12, c, { strip: STRIP.windows, floorH: 3.5 }); P.box(0, 0, 8, 14, 4, 4, 0xd94f4f, { far: false }); P.sign(0, 15.5, 6.2, 10, 2.4, P.o.text || 'HOSPITAL', '#d94f4f'); P.glowBlob(0, 26, -14, 1.2, 0xff4040, 0.8); }),
  R('police', 'buildings', 'POLICE', [22, 16], P => { P.box(0, 0, 0, 22, 8, 16, P.color(0x7a8ca0), { strip: STRIP.windows, floorH: 4 }); P.box(0, 8, 0, 22.4, 0.5, 16.4, DARK); P.sign(0, 5.5, 8.3, 8, 2, 'POLICE', '#7ea6ff'); P.car(-6, 12, 0xf0ece0, 0); P.car(-1, 12, 0xf0ece0, 0); }),
  R('firestation', 'buildings', 'FIRE STATION', [22, 18], P => { P.box(0, 0, 0, 22, 8, 18, P.color(0x8a5f4c), { strip: STRIP.brick, floorH: 4 }); for (const x of [-6, 0, 6]) P.box(x, 0, 9.1, 4.4, 5, 0.2, 0xd94f4f, { ao: false, far: false }); P.box(0, 8, 0, 22.4, 0.5, 18.4, DARK); P.box(8, 8.5, -5, 3, 8, 3, 0x8a5f4c, { far: true }); }),
  R('dealership', 'buildings', 'DEALERSHIP', [40, 30], P => { P.box(0, 0, -8, 26, 6, 14, P.color(0xf0ece0), { strip: STRIP.glass, floorH: 6 }); P.box(0, 6, -8, 26.6, 0.6, 14.6, DARK); P.slab(0, 8, 40, 14, ASPHALT); for (let i = -3; i <= 3; i++) { P.car(i * 5, 8, null, 0); P.box(i * 5, 0, 15, 0.1, 7, 0.1, STEEL, { ao: false, far: false }); P.box(i * 5 + 0.6, 6, 15, 1.2, 0.8, 0.05, P.pick([0xd94f4f, 0xffe066, 0x7ea6ff], i + 4), { ao: false, far: false }); } P.box(-16, 0, -2, 0.5, 12, 0.5, STEEL, { ao: false }); P.sign(-16, 10, -2, 7, 3, P.o.text || 'HACHI MOTORS', '#ffe066'); }),
  R('tyreshop', 'buildings', 'TYRE SHOP', [16, 12], P => { P.box(0, 0, 0, 16, 5, 12, P.color(0x9a9280), { strip: STRIP.shed, far: false }); P.box(-3, 0, 6.1, 5, 4, 0.2, 0x3a3d44, { ao: false, far: false }); P.sign(4, 4, 6.3, 6, 1.8, 'DRIFT KING TYRES', '#ffd98a'); for (let i = 0; i < 4; i++) P.mesh(GEO.cyl12, 9.5, 0.3 + i * 0.5, 2 + (i % 2) * 0.1, 0.9, 0.45, 0.9, 0x1a1c20); }),
  R('carwash', 'buildings', 'CAR WASH', [14, 12], P => { P.box(-6.5, 0, 0, 1, 4.5, 12, P.color(0x7ea6ff), { far: false }); P.box(6.5, 0, 0, 1, 4.5, 12, P.color(0x7ea6ff), { far: false }); P.box(0, 4.5, 0, 14, 0.6, 12, DARK, { far: false }); P.slab(0, 0, 12, 12, ASPHALT); P.sign(0, 5.8, 0, 8, 1.8, 'CAR WASH', '#6fe3a0'); }),
  R('drivethru', 'buildings', 'DRIVE-THRU', [20, 16], P => { P.box(0, 0, -2, 14, 4.2, 10, P.color(0xffe066), { strip: STRIP.shop, floorH: 4.2, far: false }); P.box(0, 4.2, -2, 14.6, 0.5, 10.6, 0xd94f4f, { far: false }); P.slab(0, 0, 20, 16, ASPHALT, 0.04); P.box(-9, 0, 5, 0.4, 10, 0.4, STEEL, { ao: false }); P.sign(-9, 9, 5, 5, 3, P.o.text || 'BOARDWALK BURGERS', '#ff9a5c'); P.glowBlob(-9, 9, 5, 1.4, 0xffe066, 0.6); }),
  R('drivein', 'buildings', 'DRIVE-IN SCREEN', [30, 8], P => { P.box(0, 0, 0, 30, 2, 3, DARK, { far: true }); P.box(0, 2, 0, 30, 16, 1.2, 0xf0ece0, { ao: false, far: true }); P.box(0, 18, 0, 30.4, 0.6, 1.6, DARK, { far: true }); P.sign(0, 1, 2, 6, 1.6, 'OOZI DRIVE-IN', '#ff6b8f'); }),
  R('parkinggarage', 'buildings', 'PARKING GARAGE', [30, 24], P => { for (let f = 0; f < 4; f++) { P.box(0, f * 3.2, 0, 30, 0.5, 24, 0x9a9280, { ao: false, far: true }); for (const [x, z] of [[-13, -10], [13, -10], [-13, 10], [13, 10], [0, -10], [0, 10], [-13, 0], [13, 0]]) P.box(x, f * 3.2 + 0.5, z, 0.7, 2.7, 0.7, 0x8c8f96, { ao: false, far: false }); } P.box(0, 12.8, 0, 30, 0.5, 24, 0x9a9280, { far: true }); for (let i = -2; i <= 2; i++) P.car(i * 5, 8, null, 0); P.sign(0, 2.5, 12.3, 6, 1.4, 'PARK', '#7ea6ff'); }),
  R('stadium', 'buildings', 'STADIUM', [90, 70], P => { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rx = 40, rz = 30; const x = Math.cos(a) * rx, z = Math.sin(a) * rz; P.box(x, 0, z, 16, 16 + P.rnd(i) * 2, 10, P.color(0x8c8f96), { yaw: -a + Math.PI / 2, strip: STRIP.plain, far: true }); } P.slab(0, 0, 60, 40, GRASS, 0.06); for (const [x, z] of [[-44, -34], [44, -34], [-44, 34], [44, 34]]) { P.box(x, 0, z, 1.2, 36, 1.2, STEEL, { ao: false, far: true }); P.box(x, 36, z, 6, 2, 1, WHITE, { ao: false, far: true }); P.glowBlob(x, 37, z, 2.5, 0xffffff, 0.9); P.glowPool(x, z, 40, 0xffffff, 0.08); } P.sign(0, 17, -31, 20, 5, P.o.text || 'OOZI STADIUM', '#ffe066'); }),
  R('mall', 'buildings', 'MALL', [60, 40], P => { P.box(0, 0, 0, 60, 10, 40, P.color(0xe9c9a0), { far: true }); P.box(0, 0, 21, 16, 8, 4, GLASS, { strip: STRIP.glass, floorH: 4 }); P.box(0, 10, 0, 60.4, 0.6, 40.4, DARK); P.slab(0, 34, 60, 22, ASPHALT); for (let i = -5; i <= 5; i++) P.car(i * 5, 30, null, 0); P.sign(0, 8.5, 23.2, 14, 3, P.o.text || 'OOZI MALL', '#ff9a5c'); }),
  R('hotel', 'buildings', 'HOTEL', [30, 20], P => { P.box(0, 0, 0, 30, 36, 20, P.color(0xf0ece0), { strip: STRIP.windows, floorH: 3.3 }); P.box(0, 0, 11, 14, 5, 4, DARK, { far: false }); P.box(0, 36, 0, 30.4, 0.6, 20.4, DARK); P.sign(0, 38.5, 0, 16, 4, P.o.text || 'HOTEL OO', '#7ea6ff'); }),
  R('arcade', 'buildings', 'ARCADE', [18, 12], P => { P.box(0, 0, 0, 18, 6, 12, P.color(0xff6b8f), { strip: STRIP.shop, floorH: 6, far: false }); P.box(0, 6, 0, 18.6, 0.5, 12.6, DARK, { far: false }); P.sign(0, 5, 6.4, 12, 2.4, P.o.text || 'PIER 9 ARCADE', '#ffe066'); P.glowBlob(-5, 5, 6.6, 1, 0xff6b8f, 0.5); P.glowBlob(5, 5, 6.6, 1, 0x6fe3a0, 0.5); }),
  R('lighthouse', 'buildings', 'LIGHTHOUSE', [8, 8], P => { for (let i = 0; i < 5; i++) P.mesh(GEO.cyl12, 0, i * 5 + 2.5, 0, 3.2 - i * 0.3, 5, 3.2 - i * 0.3, i % 2 ? 0xd94f4f : 0xf0ece0); P.mesh(GEO.cyl12, 0, 27, 0, 2.2, 4, 2.2, GLASS); P.mesh(GEO.cone8, 0, 30.2, 0, 2.6, 2.4, 2.6, DARK); P.glowBlob(0, 27, 0, 3, 0xfff0c0, 0.9); }),
  R('mast', 'buildings', 'RADIO MAST', [4, 4], P => { P.box(0, 0, 0, 1.4, 60, 1.4, STEEL, { ao: false }); for (let i = 1; i < 6; i++) P.box(0, i * 10, 0, 4 - i * 0.5, 0.3, 4 - i * 0.5, STEEL, { ao: false, far: false }); P.glowBlob(0, 60.5, 0, 0.9, 0xff4040, 0.9); }),
  R('bank', 'buildings', 'BANK', [22, 16], P => { P.box(0, 0, 0, 22, 9, 16, P.color(0xf2e6c8), { far: true }); for (let i = -2; i <= 2; i++) P.mesh(GEO.cyl8, i * 4, 4.2, 8.6, 0.6, 8.4, 0.6, WHITE); P.box(0, 8.4, 8.6, 22, 1.4, 2, WHITE, { far: false }); P.sign(0, 6, 9.7, 8, 1.6, P.o.text || 'BANK OF OO', '#f0ece0'); }),
  R('cinema', 'buildings', 'CINEMA', [24, 20], P => { P.box(0, 0, 0, 24, 12, 20, P.color(0x7a8ca0), { far: true }); P.box(0, 5, 11, 18, 2.4, 3, 0xffe066, { ao: false, far: false }); P.sign(0, 6.2, 12.6, 16, 2.2, P.o.text || 'NOW SHOWING · MEGA MUSHROOM', '#ffe066'); P.glowBlob(-8, 6.2, 12.6, 1, 0xffe066, 0.6); P.glowBlob(8, 6.2, 12.6, 1, 0xffe066, 0.6); }),
  R('bar', 'buildings', 'BAR', [10, 8], P => { P.box(0, 0, 0, 10, 4, 8, P.color(0x6a4f3a), { strip: STRIP.brick, floorH: 4, far: false }); P.box(0, 4, 0, 10.4, 0.4, 8.4, DARK, { far: false }); P.sign(0, 3.2, 4.3, 5, 1.4, P.o.text || 'DOCKS DINER', '#ff6b8f'); P.glowBlob(3.5, 3.2, 4.4, 0.8, 0xff6b8f, 0.6); }),
  R('surfshop', 'buildings', 'SURF SHOP', [10, 8], P => { P.box(0, 0, 0, 10, 3.6, 8, P.color(0x6fe3a0), { strip: STRIP.shop, floorH: 3.6, far: false }); P.gable(0, 3.6, 0, 10.6, 8.6, 1.6, 0xffe066); P.box(4, 0, 4.6, 0.3, 2.2, 1.2, 0x7ea6ff, { ao: false, far: false }); P.sign(-1, 2.6, 4.3, 5, 1.2, 'SURF', '#7ea6ff'); }),
  R('busstation', 'buildings', 'BUS DEPOT', [30, 16], P => { P.box(0, 0, -5, 30, 5, 6, P.color(0x9a9280), { strip: STRIP.shed, far: false }); P.box(0, 5, 0, 30, 0.5, 16, DARK, { far: true }); for (const x of [-13, 0, 13]) P.box(x, 0, 7, 0.5, 5, 0.5, STEEL, { ao: false, far: false }); P.slab(0, 4, 30, 12, ASPHALT); P.sign(0, 3.8, -1.8, 8, 1.4, 'OOZI TRANSIT', '#7ea6ff'); }),

  // ----------------------------------------------------------------- LIGHTS
  R('lamp', 'lights', 'STREET LAMP', null, P => P.lamp(0, 0, 7, 0xffd9a0, 9, 1.6)),
  R('lamp2', 'lights', 'DOUBLE LAMP', null, P => { P.lamp(0, 0, 8, 0xffd9a0, 9, 1.8); P.lamp(0, 0, 8, 0xffd9a0, 9, -1.8); }),
  R('mast4', 'lights', 'HIGHWAY MAST', null, P => { P.mesh(GEO.cylTaper, 0, 9, 0, 0.3, 18, 0.3, 0x4a4d54); P.box(0, 17.8, 0, 3, 0.3, 3, 0x4a4d54, { ao: false, far: false }); for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) { P.box(x, 17.5, z, 0.8, 0.3, 0.8, 0xffffff, { strip: STRIP.lamp, ao: false, far: false, top: false }); } if (P.G) { const [wx, wz] = P.W(0, 0); P.G.lamp(wx, P.y0 + 17.5 * P.s, wz, 0xfff0d0, 22 * P.s, P.y0); } }),
  R('oldlamp', 'lights', 'OLD LAMP POST', null, P => { P.mesh(GEO.cyl6, 0, 2, 0, 0.12, 4, 0.12, 0x2a2d33); P.mesh(GEO.sphere, 0, 4.3, 0, 0.45, 0.6, 0.45, 0xffffff, { strip: STRIP.lamp }); P.glowBlob(0, 4.3, 0, 0.8, 0xffe6b0, 0.6); P.glowPool(0, 0, 6, 0xffe6b0, 0.14); if (P.G) { const [wx, wz] = P.W(0, 0); P.G.lamps.push([wx, P.y0 + 4.3, wz]); } }),
  R('floodlight', 'lights', 'FLOODLIGHT TOWER', [2, 2], P => { P.box(0, 0, 0, 1, 24, 1, STEEL, { ao: false }); P.box(0, 24, 0, 5, 1.6, 0.8, WHITE, { ao: false, far: true }); P.glowBlob(0, 24.8, 0, 2.2, 0xffffff, 0.9); P.glowPool(0, 14, 30, 0xffffff, 0.1); if (P.G) { const [wx, wz] = P.W(0, 0); P.G.lamps.push([wx, P.y0 + 24, wz]); } }),
  R('trafficlight', 'lights', 'TRAFFIC LIGHT', null, P => { P.mesh(GEO.cyl6, 0, 3, 0, 0.12, 6, 0.12, 0x4a4d54); P.box(2, 5.8, 0, 4.2, 0.12, 0.12, 0x4a4d54, { ao: false, far: false }); P.box(3.6, 4.4, 0, 0.4, 1.3, 0.4, 0x1a1c20, { ao: false, far: false }); P.glowBlob(3.6, 5.5, 0.25, 0.22, 0xff3030, 0.8); P.glowBlob(3.6, 5.05, 0.25, 0.22, 0xffd030, 0.25); P.glowBlob(3.6, 4.6, 0.25, 0.22, 0x30ff60, 0.25); }),
  R('neon', 'lights', 'NEON SIGN', null, P => { const c = P.pick([0xff6b8f, 0x6fe3a0, 0x7ea6ff, 0xffe066], 0); P.box(0, 0, 0, 0.3, 6, 0.3, STEEL, { ao: false, far: false }); P.sign(0, 6.5, 0, 6, 2.2, P.o.text || 'NITRO+', '#' + c.toString(16).padStart(6, '0')); P.glowBlob(-2.8, 6.5, 0.3, 0.5, c, 0.7); P.glowBlob(2.8, 6.5, 0.3, 0.5, c, 0.7); P.glowPool(0, 0, 5, c, 0.1); }, { text: true }),
  R('bollards', 'lights', 'BOLLARD LIGHTS', null, P => { for (let i = -2; i <= 2; i++) { P.mesh(GEO.cyl6, i * 3, 0.45, 0, 0.14, 0.9, 0.14, 0x4a4d54); P.glowBlob(i * 3, 0.85, 0, 0.3, 0xffe6b0, 0.6); P.glowPool(i * 3, 0, 2.2, 0xffe6b0, 0.12); } }),
  R('stringlights', 'lights', 'STRING LIGHTS', null, P => { P.mesh(GEO.cyl6, -6, 2, 0, 0.1, 4, 0.1, WOOD); P.mesh(GEO.cyl6, 6, 2, 0, 0.1, 4, 0.1, WOOD); P.box(0, 3.85, 0, 12, 0.04, 0.04, 0x1a1c20, { ao: false, far: false }); for (let i = -5; i <= 5; i++) P.glowBlob(i * 1.1, 3.7 - Math.abs(i) * 0.03 + 0.15 * Math.cos(i * 0.6), 0, 0.16, P.pick([0xffe066, 0xff6b8f, 0x6fe3a0, 0x7ea6ff], i + 6), 0.7); }),
  R('billboardlit', 'lights', 'LIT BILLBOARD', [2, 2], P => { P.box(0, 0, 0, 0.8, 9, 0.8, STEEL, { ao: false }); P.sign(0, 11, 0, 14, 5, P.o.text || 'OOZI COLA', '#ff9a5c'); for (const x of [-5, 0, 5]) P.glowBlob(x, 8.2, 0.6, 0.3, 0xfff0d0, 0.5); }, { text: true }),
  R('spotlight', 'lights', 'SPOTLIGHT', null, P => { P.box(0, 0, 0, 0.8, 0.6, 0.8, DARK, { ao: false, far: false }); P.mesh(GEO.cyl8, 0, 0.9, 0, 0.4, 0.6, 0.4, STEEL, { tilt: 0.6 }); if (P.G) { const [wx, wz] = P.W(0, 0); P.G.cone(wx, P.y0 + 0.9, wz, P.y0 + 60, 12, 0xfff0d0, 0.06, 8); } }),
  R('beacon', 'lights', 'BEACON', null, P => { P.mesh(GEO.cyl6, 0, 1.5, 0, 0.12, 3, 0.12, STEEL); P.glowBlob(0, 3.2, 0, 0.5, 0xff4040, 0.9); }),

  // ------------------------------------------------------------------ TREES
  R('pine', 'trees', 'PINE', null, P => P.tree(0, 0, 'pine', 0.8 + P.rnd(0) * 0.5)),
  R('tallpine', 'trees', 'TALL PINE', null, P => P.tree(0, 0, 'pine', 1.5 + P.rnd(0) * 0.5, 0x2a5030)),
  R('broadleaf', 'trees', 'BROADLEAF', null, P => P.tree(0, 0, 'broad', 0.8 + P.rnd(0) * 0.5)),
  R('oak', 'trees', 'BIG OAK', null, P => P.tree(0, 0, 'broad', 1.7 + P.rnd(0) * 0.4, 0x4a7a34)),
  R('palm', 'trees', 'PALM', null, P => P.tree(0, 0, 'palm', 0.8 + P.rnd(0) * 0.4)),
  R('tallpalm', 'trees', 'TALL PALM', null, P => P.tree(0, 0, 'palm', 1.5 + P.rnd(0) * 0.5)),
  R('autumn', 'trees', 'AUTUMN TREE', null, P => P.tree(0, 0, 'autumn', 0.8 + P.rnd(0) * 0.5, P.pick([0xc9742f, 0xd9a040, 0xb05030], 1))),
  R('bush', 'trees', 'BUSH', null, P => P.tree(0, 0, 'bush', 0.8 + P.rnd(0) * 0.6)),
  R('hedge', 'trees', 'HEDGE ROW', null, P => { for (let i = -3; i <= 3; i++) P.tree(i * 1.6, 0, 'bush', 0.9); }),
  R('deadtree', 'trees', 'DEAD TREE', null, P => P.tree(0, 0, 'dead', 0.8 + P.rnd(0) * 0.6)),
  R('cactus', 'trees', 'CACTUS', null, P => P.tree(0, 0, 'cactus', 0.7 + P.rnd(0) * 0.6)),
  R('cypress', 'trees', 'CYPRESS', null, P => P.tree(0, 0, 'cypress', 0.8 + P.rnd(0) * 0.5)),
  R('grassclump', 'trees', 'TALL GRASS', null, P => { const c = P.color(null) ?? P.pick([0x7fa24a, 0x9a9a4a, 0x6a8a3a, 0x8fb050], 0); for (let i = 0; i < 7; i++) P.mesh(GEO.cone6, (P.rnd(i) - 0.5) * 2.2, 0.45, (P.rnd(i + 7) - 0.5) * 2.2, 0.16, 0.9 + P.rnd(i + 3) * 0.7, 0.16, c, { tilt: (P.rnd(i + 5) - 0.5) * 0.5 }); }),
  R('flowers', 'trees', 'FLOWERS', null, P => { for (let i = 0; i < 6; i++) { const x = (P.rnd(i) - 0.5) * 2.4, z = (P.rnd(i + 9) - 0.5) * 2.4; P.mesh(GEO.cyl6, x, 0.2, z, 0.03, 0.4, 0.03, 0x4f8a3a); P.mesh(GEO.ico, x, 0.45, z, 0.14, 0.12, 0.14, P.pick([0xff6b8f, 0xffe066, 0xf0ece0, 0xff9a5c, 0x7ea6ff], i)); } }),
  R('shrub', 'trees', 'SHRUB', null, P => P.tree(0, 0, 'bush', 0.5 + P.rnd(0) * 0.4, P.pick([0x4f8a3a, 0x6a8a5a, 0x9a9a4a], 1))),
  R('grove', 'trees', 'GROVE ×5', null, P => { for (let i = 0; i < 5; i++) P.tree((P.rnd(i) - 0.5) * 14, (P.rnd(i + 9) - 0.5) * 14, P.pick(['pine', 'broad', 'autumn'], i), 0.8 + P.rnd(i + 3) * 0.6); }),

  // ------------------------------------------------------------------ ROCKS
  R('boulder', 'rocks', 'BOULDER', [4, 4], P => P.rock(0, 0, 2.2 + P.rnd(0))),
  R('boulders', 'rocks', 'BOULDER CLUSTER', [9, 9], P => { for (let i = 0; i < 5; i++) P.rock((P.rnd(i) - 0.5) * 8, (P.rnd(i + 5) - 0.5) * 8, 1 + P.rnd(i + 2) * 2, 0x8a7a66, i); }),
  R('flatrock', 'rocks', 'FLAT ROCK', [6, 5], P => { P.mesh(GEO.dodeca, 0, 0.5, 0, 3.2, 0.9, 2.6, 0x8a7a66); }),
  R('cliff', 'rocks', 'CLIFF BLOCK', [12, 8], P => { P.mesh(GEO.box, 0, 4, 0, 12, 9, 8, 0x8a7a66, { tilt: 0.05 }); P.mesh(GEO.dodeca, 3, 8.5, -1, 4, 2.5, 3, 0x9a8a76); }),
  R('redrock', 'rocks', 'CANYON ROCK', [8, 8], P => { P.rock(0, 0, 3.5, 0xb5613f, 0); P.rock(2, 2, 2, 0xc57050, 1); }),
  R('stonewall', 'rocks', 'STONE WALL', null, P => { P.box(0, 0, 0, 12, 1.2, 0.6, 0x8a7a66, { far: false }); for (let i = -5; i <= 5; i++) P.box(i * 1.1, 1.1, 0, 0.6, 0.3, 0.7, 0x9a8a76, { ao: false, far: false }); }),
  R('arch', 'rocks', 'ROCK ARCH', [14, 6], P => { P.mesh(GEO.dodeca, -5, 3, 0, 3, 6, 3, 0xb5613f); P.mesh(GEO.dodeca, 5, 3, 0, 3, 6, 3, 0xb5613f); P.mesh(GEO.box, 0, 7.5, 0, 13, 2.4, 3.6, 0xb5613f); }),
  R('pebbles', 'rocks', 'PEBBLES', null, P => { for (let i = 0; i < 9; i++) P.rock((P.rnd(i) - 0.5) * 6, (P.rnd(i + 9) - 0.5) * 6, 0.25 + P.rnd(i + 1) * 0.4, 0x9a8a76, i); }),

  // ------------------------------------------------------------------ PROPS
  R('parkedcar', 'props', 'PARKED CAR', [2, 4.4], P => P.car(0, 0, P.col, 0)),
  R('carrow', 'props', 'PARKED ROW ×4', [11, 4.6], P => { for (let i = -1.5; i <= 1.5; i++) P.car(i * 2.7, 0, null, 0); }),
  R('busstop', 'props', 'BUS STOP', [4, 2], P => { P.box(0, 0, 0, 0.12, 2.6, 0.12, STEEL, { ao: false, far: false }); P.box(0, 2.6, 0.6, 4, 0.12, 2, DARK, { ao: false, far: false }); P.box(0, 0.5, 1.4, 3.6, 0.12, 0.5, WOOD, { ao: false, far: false }); P.box(1.6, 0, 1.5, 0.12, 2.6, 0.12, STEEL, { ao: false, far: false }); P.box(-1.6, 0, 1.5, 0.12, 2.6, 0.12, STEEL, { ao: false, far: false }); P.sign(-1.9, 1.5, 0.2, 1.6, 0.8, 'BUS', '#ffe066', Math.PI / 2); }),
  R('bench', 'props', 'BENCH', null, P => { P.box(0, 0.45, 0, 1.8, 0.08, 0.5, WOOD, { ao: false, far: false }); P.box(0, 0.5, -0.28, 1.8, 0.5, 0.08, WOOD, { ao: false, far: false }); P.box(-0.8, 0, 0, 0.08, 0.45, 0.5, STEEL, { ao: false, far: false }); P.box(0.8, 0, 0, 0.08, 0.45, 0.5, STEEL, { ao: false, far: false }); }),
  R('bin', 'props', 'BIN', null, P => P.mesh(GEO.cyl8, 0, 0.5, 0, 0.35, 1, 0.35, P.pick([0x2f5a35, 0x3a3d44, 0x7ea6ff], 0))),
  R('hydrant', 'props', 'HYDRANT', null, P => { P.mesh(GEO.cyl8, 0, 0.4, 0, 0.18, 0.8, 0.18, 0xd94f4f); P.mesh(GEO.sphere, 0, 0.85, 0, 0.2, 0.15, 0.2, 0xd94f4f); }),
  R('fence', 'props', 'FENCE RUN', null, P => { P.box(0, 0.5, 0, 12, 0.08, 0.06, WHITE, { ao: false, far: false }); P.box(0, 1.0, 0, 12, 0.08, 0.06, WHITE, { ao: false, far: false }); for (let i = -6; i <= 6; i++) P.box(i * 1, 0, 0, 0.1, 1.3, 0.1, WHITE, { ao: false, far: false }); }),
  R('wall', 'props', 'WALL RUN', null, P => { P.box(0, 0, 0, 12, 2.2, 0.35, P.color(0x9a9280), { far: false }); P.box(0, 2.2, 0, 12.2, 0.2, 0.5, DARK, { ao: false, far: false }); }),
  R('signpost', 'props', 'SIGN POST', null, P => { P.box(0, 0, 0, 0.12, 3, 0.12, STEEL, { ao: false, far: false }); P.sign(0, 3.2, 0, 2.4, 0.9, P.o.text || 'OOZI BLVD', '#6fe3a0'); }, { text: true }),
  R('cones', 'props', 'CONE ROW', null, P => { for (let i = -2; i <= 2; i++) P.mesh(GEO.cone8, i * 2, 0.4, 0, 0.25, 0.8, 0.25, 0xff9a5c); }),
  R('tyrestack', 'props', 'TYRE STACK', [2, 2], P => { for (let i = 0; i < 4; i++) P.mesh(GEO.cyl12, 0, 0.25 + i * 0.5, 0, 0.9, 0.45, 0.9, 0x1a1c20); }),
  R('container', 'props', 'CONTAINER', [12, 3], P => P.box(0, 0, 0, 12, 2.6, 2.4, P.pick([0xd94f4f, 0x7ea6ff, 0x6fe3a0, 0xffe066, 0x9a9280], 0), { strip: STRIP.shed, far: false })),
  R('containers', 'props', 'CONTAINER STACK', [12, 8], P => { for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) P.box(0, i * 2.6, (j - 1) * 2.6, 12, 2.6, 2.4, P.pick([0xd94f4f, 0x7ea6ff, 0x6fe3a0, 0xffe066, 0x9a9280, 0x8a5f4c], i * 3 + j), { strip: STRIP.shed, far: true }); }),
  R('crane', 'props', 'DOCK CRANE', [30, 6], P => { const red = 0xd94f4f; for (const s of [-1, 1]) P.box(s * 12, 0, 0, 2, 40, 2, red, { ao: false, far: true }); P.box(0, 38.5, -20, 3, 3, 80, red, { ao: false, far: true }); P.box(0, 38.5, 0, 28, 3, 3, red, { ao: false, far: true }); }),
  R('boat', 'props', 'BOAT', [4, 10], P => { P.box(0, 0.2, 0, 3.2, 1.2, 9, P.color(0xf0ece0), { ao: false, far: false }); P.box(0, 1.4, -1, 2.4, 1.4, 3, 0x7ea6ff, { ao: false, far: false }); P.mesh(GEO.cyl6, 0, 4, 1, 0.08, 6, 0.08, WOOD); }),
  R('fountain', 'props', 'FOUNTAIN', [8, 8], P => { P.mesh(GEO.cyl12, 0, 0.3, 0, 4, 0.6, 4, 0xbcb4a6); P.mesh(GEO.cyl12, 0, 0.5, 0, 3.6, 0.4, 3.6, 0x2b6b8a); P.mesh(GEO.cyl8, 0, 1.2, 0, 0.5, 1.8, 0.5, 0xbcb4a6); P.mesh(GEO.cyl12, 0, 2.2, 0, 1.4, 0.3, 1.4, 0xbcb4a6); }),
  R('statue', 'props', 'STATUE', [3, 3], P => { P.box(0, 0, 0, 2.4, 1.4, 2.4, 0x9a9280, { ao: false, far: false }); P.mesh(GEO.cyl8, 0, 2.6, 0, 0.5, 2.4, 0.5, 0x6f8496); P.mesh(GEO.sphere, 0, 4.2, 0, 0.6, 0.7, 0.6, 0x6f8496); }),
  R('flagpole', 'props', 'FLAG POLE', null, P => { P.mesh(GEO.cyl6, 0, 5, 0, 0.08, 10, 0.08, WHITE); P.box(0.9, 8.6, 0, 1.8, 1.1, 0.04, P.pick([0xd94f4f, 0x7ea6ff, 0xffe066, 0x6fe3a0], 0), { ao: false, far: false }); }),
  R('picnic', 'props', 'PICNIC TABLE', null, P => { P.box(0, 0.75, 0, 1.8, 0.08, 0.8, WOOD, { ao: false, far: false }); P.box(0, 0.45, 0.7, 1.8, 0.06, 0.3, WOOD, { ao: false, far: false }); P.box(0, 0.45, -0.7, 1.8, 0.06, 0.3, WOOD, { ao: false, far: false }); P.box(-0.7, 0, 0, 0.08, 0.75, 0.8, WOOD, { ao: false, far: false }); P.box(0.7, 0, 0, 0.08, 0.75, 0.8, WOOD, { ao: false, far: false }); }),
  R('umbrellas', 'props', 'BEACH UMBRELLAS', null, P => { for (let i = 0; i < 4; i++) { const x = (P.rnd(i) - 0.5) * 8, z = (P.rnd(i + 4) - 0.5) * 8; P.mesh(GEO.cyl6, x, 1.3, z, 0.06, 2.6, 0.06, 0xe8e4d8); P.mesh(GEO.cone8, x, 2.6, z, 1.6, 0.8, 1.6, P.pick([0xff9a5c, 0x7ea6ff, 0xffd98a, 0xff6b8f, 0x6fe3a0], i)); } }),
  R('plaza', 'props', 'PLAZA SLAB', null, P => { P.slab(0, 0, 24, 24, 0xbcb4a6, 0.08); }),
  R('parkinglot', 'props', 'PARKING LOT', null, P => { P.slab(0, 0, 30, 18, ASPHALT, 0.06); for (let i = -5; i <= 5; i++) { P.box(i * 2.7, 0.07, -4.5, 0.12, 0.02, 5, WHITE, { ao: false, far: false, top: true }); P.box(i * 2.7, 0.07, 4.5, 0.12, 0.02, 5, WHITE, { ao: false, far: false, top: true }); } for (let i = -4; i <= 4; i += 2) if (P.rnd(i + 5) < 0.6) P.car(i * 2.7 + 1.35, -4.5, null, 0); }),
  R('pool', 'props', 'SWIMMING POOL', null, P => { P.slab(0, 0, 12, 7, 0xe0d8c8, 0.05); P.slab(0, 0, 10, 5, 0x2b6b8a, 0.08); }),
];

export const CATS = [
  ['houses', 'HOUSES'], ['buildings', 'BUILDINGS'], ['lights', 'LIGHTS'], ['trees', 'TREES'], ['rocks', 'ROCKS'], ['props', 'PROPS'], ['roads', 'ROADS'], ['terrain', 'TERRAIN'], ['foliage', 'FOLIAGE'],
];
export const BY_ID = Object.fromEntries(PIECES.map(p => [p.id, p]));

// ------------------------------------------------------------ the detail pass
// Adam, 2026-08-29: "make buildings so much more detailed and add little things".
// Every house and building gets, after its recipe: a real door with a step and a
// path to the street, drainpipes at the front corners, a chimney or rooftop
// units, and — seeded, so no two alike — yard and street clutter: bushes,
// a tree, a fence, a mailbox, a bin, a parked car, an AC unit, a dish, window
// boxes, benches and planters, a porch light for the night. All of it goes to
// the NEAR mesh only. `dense` (MED/HIGH) adds the expensive bits; LOW keeps the
// door, step, path, pipes and roof so the Chromebook keeps its frames.
const DETAIL = { detail: true, ao: false, far: false };
const PICKET = 0xf0ece0, PIPE = 0x4a4d54, TRIM = 0x3a3d44;
function dress(P, piece, dense) {
  const cat = piece.cat; if (cat !== 'houses' && cat !== 'buildings') return;
  const fp = piece.fp; if (!fp) return;
  const r = i => P.rnd(100 + i);
  const front = P.front; if (!front) return;
  const fz = front.z, fx = front.x, fw = front.w, lotD = fp[1] / 2, big = cat === 'buildings';
  const shopfront = piece.id === 'gasstation' || piece.id === 'carwash' || piece.id === 'parkinggarage' || piece.id === 'stadium' || piece.id === 'drivein' || piece.id === 'watertower' || piece.id === 'mast' || piece.id === 'lighthouse' || piece.id === 'crane';
  if (shopfront) return;
  // --- the door, its step, the path to the street, and a light over it
  const dx = fx + (r(1) - 0.5) * Math.max(0, fw - 3) * 0.6;
  const dw = big ? 2.2 : 1.05, dh = big ? 2.7 : 2.15;
  P.box(dx, 0.02, fz + 0.06, dw, dh, 0.12, big ? 0x2a3444 : P.pick([0x3a3d44, 0x6a4f3a, 0xd94f4f, 0x2f5a35, 0x7ea6ff], 2), DETAIL);
  P.box(dx, 0, fz + 0.5, dw + 0.9, 0.16, 0.9, 0x9a9280, DETAIL);
  if (lotD - fz > 1.2) P.slab(dx, (fz + lotD) / 2 + 0.6, 1.3, lotD - fz + 1.2, 0x9a9280, 0.04);
  P.box(dx, dh + 0.25, fz + 0.12, 0.35, 0.18, 0.24, 0xffffff, { ...DETAIL, strip: STRIP.lamp, top: false });
  P.glowBlob(dx, dh + 0.3, fz + 0.3, 0.45, 0xffe0a0, 0.5);
  // --- drainpipes down the front corners
  for (const sgn of [-1, 1]) P.box(fx + sgn * (fw / 2 - 0.12), 0, fz - 0.05, 0.14, front.h - 0.2, 0.14, PIPE, DETAIL);
  // --- the roof: a chimney on a house, units and a parapet on a building
  if (!big) {
    if (r(3) < 0.6) {
      const cx = fx + (r(4) - 0.5) * fw * 0.5, cz = fz - fp[1] * 0.35, cy = P.top - 2.2;
      P.box(cx, cy, cz, 0.8, 3.2, 0.8, P.pick([0x8a5f4c, 0x9a9280, 0x6a4f3a], 5), DETAIL);
      if (P.C.chimneys && r(5) < 0.7) { const [wx, wz] = P.W(cx, cz); P.C.chimneys.push([wx, P.y0 + (cy + 3.2) * P.s, wz]); }   // it smokes
    }
    if (dense && r(6) < 0.4) P.mesh(GEO.disc, fx + fw * 0.3, P.top - 1.2, fz - 1.5, 0.45, 0.45, 0.45, 0xd8d8d8, { ...DETAIL, tilt: -0.9 });   // a dish
    if (dense && r(7) < 0.5) for (const sgn of [-1, 1]) P.box(fx + sgn * fw * 0.28, 1.15, fz + 0.18, 1.2, 0.28, 0.3, P.pick([0x6a4f3a, 0x9a9280], 8), DETAIL), P.box(fx + sgn * fw * 0.28, 1.4, fz + 0.18, 1.1, 0.25, 0.26, P.pick([0xd94f4f, 0xff9a5c, 0xffe066, 0xff6b8f], 9), DETAIL);   // window boxes
  } else {
    const top = P.top, wall = P.walls.reduce((a, b) => (b[4] > a[4] ? b : a), P.walls[0]);   // the tallest box: its roof
    if (wall) {
      const [lx, , lz, w, , d] = wall, ry = wall[1] + wall[4];
      for (const [ox, oz, ww, dd] of [[0, d / 2 - 0.15, w, 0.3], [0, -d / 2 + 0.15, w, 0.3], [w / 2 - 0.15, 0, 0.3, d], [-w / 2 + 0.15, 0, 0.3, d]]) P.box(lx + ox, ry, lz + oz, ww, 0.6, dd, TRIM, DETAIL);   // parapet
      const nU = 1 + Math.floor(r(10) * (dense ? 3 : 1));
      for (let i = 0; i < nU; i++) P.box(lx + (r(11 + i) - 0.5) * (w - 4), ry, lz + (r(21 + i) - 0.5) * (d - 4), 1.6, 1.0 + r(31 + i) * 0.6, 1.3, 0x9a9280, DETAIL);
      if (dense && r(12) < 0.35 && w > 12) { P.mesh(GEO.cyl8, lx + w * 0.25, ry + 2.4, lz - d * 0.2, 1.4, 2.4, 1.4, 0x8a5f4c, DETAIL); for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) P.box(lx + w * 0.25 + ox, ry, lz - d * 0.2 + oz, 0.14, 1.3, 0.14, PIPE, DETAIL); }   // a water tank on legs
      if (top > 30 && r(13) < 0.7) P.box(lx, ry, lz, 0.3, 6 + r(14) * 6, 0.3, PIPE, DETAIL);   // an antenna
    }
    // an awning over the entrance
    if (r(15) < 0.6) P.box(dx, dh + 0.5, fz + 0.7, dw + 1.6, 0.16, 1.4, P.pick([0xd94f4f, 0x2f5a35, 0x3a3d44, 0xffe066], 16), DETAIL);
    // AC units on a side wall
    if (dense) for (let i = 0; i < 2 + Math.floor(r(17) * 2); i++) { const sgn = r(18 + i) < 0.5 ? -1 : 1; P.box(fx + sgn * (fw / 2 + 0.2), 1.6 + r(28 + i) * Math.max(1, front.h - 3), fz - 1.5 - r(38 + i) * (fp[1] - 3), 0.36, 0.6, 0.8, 0xbfbbb2, DETAIL); }
  }
  if (!dense) return;
  // --- the yard / the pavement in front
  const yard = fz + 1.6, side = r(20) < 0.5 ? -1 : 1;
  if (!big) {
    if (r(21) < 0.7) { P.tree(fx - fw / 2 + 1.0, yard, 'bush', 0.5 + r(22) * 0.4); P.tree(fx + fw / 2 - 1.0, yard, 'bush', 0.5 + r(23) * 0.4); }
    if (r(24) < 0.5) P.tree(side * (fp[0] / 2 + 2.2), (r(25) - 0.5) * fp[1] * 0.6, P.pick(['broad', 'pine', 'autumn'], 26), 0.75 + r(27) * 0.5);
    if (r(28) < 0.35 && lotD - fz > 3) {                                                    // a picket fence along the front, a gap at the path
      const fzz = lotD - 0.4;
      for (let x = -fp[0] / 2 + 0.5; x <= fp[0] / 2 - 0.5; x += 1.8) if (Math.abs(x - dx) > 1.3) P.box(x, 0, fzz, 0.12, 1.0, 0.12, PICKET, DETAIL);
      for (const [x0, x1] of [[-fp[0] / 2 + 0.5, dx - 1.3], [dx + 1.3, fp[0] / 2 - 0.5]]) if (x1 - x0 > 1) { P.box((x0 + x1) / 2, 0.45, fzz, x1 - x0, 0.08, 0.06, PICKET, DETAIL); P.box((x0 + x1) / 2, 0.8, fzz, x1 - x0, 0.08, 0.06, PICKET, DETAIL); }
    }
    if (r(29) < 0.6) { const mx = fp[0] / 2 - 0.8, mz = lotD - 0.6; P.box(mx, 0, mz, 0.08, 1.05, 0.08, PIPE, DETAIL); P.box(mx, 1.05, mz, 0.26, 0.24, 0.46, P.pick([0x3a3d44, 0xd94f4f, 0x7ea6ff], 30), DETAIL); }   // mailbox
    if (r(31) < 0.5) P.mesh(GEO.cyl8, -fp[0] / 2 + 0.7, 0.5, fz + 0.9, 0.32, 1.0, 0.32, P.pick([0x2f5a35, 0x3a3d44, 0x7ea6ff], 32), DETAIL);   // bin
    if (r(33) < 0.4) P.car(side * (fp[0] / 2 - 1.2), fz - fp[1] * 0.1 + 2.0, null, 0);                                               // in the drive
    if (r(34) < 0.4) P.box(-side * (fp[0] / 2 + 0.15), 1.0, fz - fp[1] * 0.4, 0.3, 0.55, 0.8, 0xbfbbb2, DETAIL);                    // an AC unit
  } else {
    if (r(35) < 0.7) { P.box(dx + dw + 1.2, 0.45, yard, 1.8, 0.08, 0.5, 0x6a4f3a, DETAIL); P.box(dx + dw + 1.2, 0.5, yard - 0.25, 1.8, 0.5, 0.08, 0x6a4f3a, DETAIL); for (const o of [-0.8, 0.8]) P.box(dx + dw + 1.2 + o, 0, yard, 0.08, 0.45, 0.45, PIPE, DETAIL); }   // bench
    if (r(36) < 0.6) P.mesh(GEO.cyl8, dx - dw - 0.9, 0.5, yard, 0.32, 1.0, 0.32, P.pick([0x2f5a35, 0x3a3d44], 37), DETAIL);         // bin
    if (r(38) < 0.7) for (const sgn of [-1, 1]) { const px = dx + sgn * (dw / 2 + 1.1); P.box(px, 0, fz + 0.9, 0.9, 0.6, 0.9, 0x9a9280, DETAIL); P.tree(px, fz + 0.9, 'bush', 0.35 + r(39) * 0.2); }   // planters
    if (r(40) < 0.5) P.tree(side * (fp[0] / 2 + 2.5), fz - 2, P.pick(['broad', 'cypress', 'palm'], 41), 0.8 + r(42) * 0.4);
    if (r(43) < 0.5) P.car(-side * (fp[0] / 2 + 2.0), fz - 3 - r(44) * 4, null, Math.PI / 2);                                       // parked at the side
  }
}

// build one placed object into a chunk merger (+ glow layer). o: {k, x, z, r, s, c, seed, text}
export function buildPiece(C, G, T, o, dense = true) {
  const piece = BY_ID[o.k]; if (!piece) return null;
  const P_ = new P(C, G, T, o, o.seed ?? 1);
  if (piece.fp) {
    const s = o.s || 1, w = piece.fp[0] * s, d = piece.fp[1] * s;
    let lo = P_.y0, hi = P_.y0;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]]) {
      const [wx, wz] = P_.W(lx / s, lz / s), y = T.height(wx, wz);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (hi - lo > 0.3) {
      P_.y0 = hi;
      C.box(o.x, lo - 0.8, o.z, w * 0.98, hi - lo + 0.8, d * 0.98, P_.yaw, 0x6e6a62, { ao: false, far: false, top: false });   // the foundation
    }
  }
  piece.build(P_);
  try { dress(P_, piece, dense); } catch (e) { console.warn('dress', o.k, e); }
  return piece;
}

// the collision box of a placed object, as [x, z, w, d] (axis-aligned; rotation widens it)
export function footprint(o) {
  const piece = BY_ID[o.k]; if (!piece || !piece.fp) return null;
  const s = o.s || 1, r = (o.r || 0) * Math.PI / 180;
  const w = piece.fp[0] * s, d = piece.fp[1] * s;
  const cw = Math.abs(Math.cos(r)), sw = Math.abs(Math.sin(r));
  return [o.x, o.z, w * cw + d * sw, w * sw + d * cw];
}
