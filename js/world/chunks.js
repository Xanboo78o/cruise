// world/chunks.js — the Chromebook renderer. Everything static a district
// puts in the world (towers, houses, sheds, signs, lamps, pavements, huts, pier
// legs) is pushed here as raw triangles, and per 300 m cell it comes out as ONE
// mesh with ONE material: vertex colours for tone, one facade atlas for windows
// and shopfronts, one glow atlas for what's lit at night. Three thousand
// different buildings cost the same number of draw calls as thirty.
//
// Two meshes per cell: NEAR (everything) and FAR (the big masses only), and
// update() shows one, the other, or neither by distance. Nothing here is
// instanced — instancing wants identical copies, and the city is built to
// never have two.

import * as THREE from 'three';
import { WORLD } from './spec.js';
import { Q } from '../quality.js';

export const CH = 300;                                     // cell size (m)
const STRIP_M = 12;                                        // one atlas width of facade = 12 m
const AW = 1024, AH = 2048, SH = 128;                      // atlas size, strip height
export const STRIP = { plain: 0, windows: 1, glass: 2, shop: 3, brick: 4, shed: 5, lamp: 6, roof: 7 };
function hash(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }

// ------------------------------------------------------------------ atlas
// Bottom half (v 0..0.5): eight full-width facade strips — u repeats, v stays in
// its strip. Top half: 32 slots of 256×128 for signs, drawn on demand.
export class CityAtlas {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = AW; this.c.height = AH;
    this.gc = document.createElement('canvas'); this.gc.width = AW; this.gc.height = AH;
    this.g = this.c.getContext('2d'); this.gg = this.gc.getContext('2d');
    this.g.fillStyle = '#ffffff'; this.g.fillRect(0, 0, AW, AH);
    this.gg.fillStyle = '#000000'; this.gg.fillRect(0, 0, AW, AH);
    this.drawStrips();
    this.ads = new Map(); this.adN = 0;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.wrapS = THREE.RepeatWrapping; this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.glow = new THREE.CanvasTexture(this.gc);
    this.glow.wrapS = THREE.RepeatWrapping; this.glow.wrapT = THREE.ClampToEdgeWrapping;
    this.glow.colorSpace = THREE.SRGBColorSpace;
    // MED/HIGH: a real BRDF so walls take the sky's light and the sun's; LOW keeps Lambert (cheaper per pixel)
    this.material = Q.pbr
      ? new THREE.MeshStandardMaterial({ vertexColors: true, map: this.tex, emissiveMap: this.glow, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.86, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex, emissiveMap: this.glow, emissive: 0xffffff, emissiveIntensity: 0 });
  }
  setNight(n) { this.material.emissiveIntensity = n ? 0.85 : 0; }

  // strip i lives in canvas rows [AH-(i+1)*SH, AH-i*SH): v in [i/16, (i+1)/16)
  stripV(i) { const pad = 2 / AH; return [i * SH / AH + pad, (i + 1) * SH / AH - pad]; }
  stripTop(i) { return AH - (i + 1) * SH; }

  drawStrips() {
    const g = this.g, gg = this.gg, ppm = AW / STRIP_M;    // px per metre across; a strip is one 3.3 m floor tall
    const rect = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    // 1 windows: white wall (tone from the vertex colour), punched windows every 1.5 m
    {
      const y0 = this.stripTop(STRIP.windows);
      for (let i = 0; i < 8; i++) {
        const x = i * 1.5 * ppm + 0.3 * ppm, w = 0.9 * ppm, y = y0 + 0.5 * SH / 3.3, h = 1.6 * SH / 3.3;
        rect(g, x, y, w, h, '#4a525e'); rect(g, x + 3, y + 3, w - 6, h * 0.45, '#7d8898');
        if (hash(i, 1) < 0.3) rect(gg, x, y, w, h, hash(i, 2) < 0.5 ? '#d9b070' : '#9fb0d0');
      }
    }
    // 2 glass: curtain wall — mullions every 1.5 m and a spandrel band
    {
      const y0 = this.stripTop(STRIP.glass);
      rect(g, 0, y0, AW, SH, '#8fa2b8');
      rect(g, 0, y0 + SH * 0.72, AW, SH * 0.28, '#e8e8e4');
      for (let i = 0; i < 8; i++) { rect(g, i * 1.5 * ppm, y0, 4, SH, '#3a3f48'); if (hash(i, 3) < 0.28) rect(gg, i * 1.5 * ppm + 4, y0, 1.5 * ppm - 8, SH * 0.7, '#d8c090'); }
    }
    // 3 shop: a ground floor — glass front, a door every 6 m, an awning band
    {
      const y0 = this.stripTop(STRIP.shop);
      rect(g, 0, y0 + SH * 0.15, AW, SH * 0.85, '#3d4550');                          // frame
      for (let i = 0; i < 2; i++) {
        const x = i * 6 * ppm;
        rect(g, x + 0.2 * ppm, y0 + SH * 0.2, 3.6 * ppm, SH * 0.75, '#9fb3c8');       // window
        rect(gg, x + 0.2 * ppm, y0 + SH * 0.2, 3.6 * ppm, SH * 0.75, '#fff2c8');
        rect(g, x + 4.2 * ppm, y0 + SH * 0.25, 1.1 * ppm, SH * 0.75, '#6a4f3a');      // door
        rect(g, x + 5.6 * ppm, y0 + SH * 0.2, 0.3 * ppm, SH * 0.75, '#3d4550');
      }
      rect(g, 0, y0, AW, SH * 0.15, '#c8503c'); for (let x = 0; x < AW; x += 40) rect(g, x, y0, 20, SH * 0.15, '#eadfcd');   // awning stripes
    }
    // 4 brick: courses plus small windows
    {
      const y0 = this.stripTop(STRIP.brick);
      rect(g, 0, y0, AW, SH, '#d9c9b8');
      for (let y = y0; y < y0 + SH; y += 8) for (let x = ((y / 8) % 2) * 10; x < AW; x += 20) rect(g, x, y, 18, 6, '#b89a86');
      for (let i = 0; i < 6; i++) { const x = i * 2 * ppm + 0.5 * ppm; rect(g, x, y0 + 30, ppm * 0.9, 70, '#3d4550'); if (hash(i, 4) < 0.4) rect(gg, x, y0 + 30, ppm * 0.9, 70, '#ffd98a'); }
    }
    // 5 shed: corrugated
    {
      const y0 = this.stripTop(STRIP.shed);
      for (let x = 0; x < AW; x += 12) rect(g, x, y0, 6, SH, '#dcdcd8');
    }
    // 6 lamp: pure white in the map, warm white in the glow — a lit lamp head
    rect(gg, 0, this.stripTop(STRIP.lamp), AW, SH, '#ffe0a0');
    // 7 roof: a faint grid of gravel/plant
    { const y0 = this.stripTop(STRIP.roof); rect(g, 0, y0, AW, SH, '#e6e6e6'); for (let i = 0; i < 40; i++) rect(g, hash(i, 5) * AW, y0 + hash(i, 6) * SH, 6, 6, '#c0c0c0'); }
  }

  // a sign: a coloured panel with a word on it, into the next free slot; returns its uv rect
  ad(text, bg, fg = '#151820') {
    if (this.ads.has(text)) return this.ads.get(text);
    const k = this.adN++ % 32, col = k % 4, row = Math.floor(k / 4);
    const x = col * 256, y = row * 128;
    for (const ctx of [this.g, this.gg]) {
      ctx.fillStyle = bg; ctx.fillRect(x, y, 256, 128);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y + 108, 256, 20);
      ctx.fillStyle = fg; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const words = text.split(' ');
      if (words.length > 1 && text.length > 11) { ctx.fillText(words[0], x + 128, y + 46); ctx.fillText(words.slice(1).join(' '), x + 128, y + 82); }
      else ctx.fillText(text, x + 128, y + 64);
    }
    const pad = 2;
    const uv = [(x + pad) / AW, 1 - (y + 128 - pad) / AH, (x + 256 - pad) / AW, 1 - (y + pad) / AH];   // u0 v0 u1 v1
    this.ads.set(text, uv);
    this.tex.needsUpdate = true; this.glow.needsUpdate = true;
    return uv;
  }
}

// ------------------------------------------------------------------ cells
class Acc {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  vert(x, y, z, nx, ny, nz, r, g, b, u, v) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(r, g, b); this.uv.push(u, v); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

export class Chunks {
  constructor(group, atlas) {
    this.group = group; this.atlas = atlas;
    this.cells = new Map();
    this.meshes = [];
    this._c = new THREE.Color();
    this.chimneys = [];                                    // [x, y, z] of every chimney top, for the smoke
  }

  cell(x, z, far) {
    const i = Math.floor((x - WORLD.minX) / CH), j = Math.floor((z - WORLD.minZ) / CH);
    const key = i * 1000 + j;
    let c = this.cells.get(key);
    if (!c) { c = { near: new Acc(), far: new Acc(), cx: WORLD.minX + (i + 0.5) * CH, cz: WORLD.minZ + (j + 0.5) * CH }; this.cells.set(key, c); }
    return far ? [c.near, c.far] : [c.near];
  }

  // a box standing on y0, yawed about its centre. Sides are banded per floor
  // and mapped to a facade strip; the top is plain. AO darkens the foot.
  // o: {strip, floorH, far, ao, uOff, top, topColor}
  box(x, y0, z, w, h, d, yaw, color, o = {}) {
    const strip = o.strip ?? STRIP.plain, floorH = o.floorH || 3.3, far = o.far ?? (h > 12);
    const c = this._c.set(color);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const R = (lx, lz) => [x + lx * cy + lz * sy, z - lx * sy + lz * cy];
    const [v0, v1] = this.atlas.stripV(strip);
    const plainU = 0.5, plainV = (v0 + v1) / 2;
    const uOff = o.uOff ?? hash(x, z) * 7;
    const ao = o.ao !== false;
    const aoAt = yy => ao ? 0.7 + 0.3 * Math.min(1, yy / 4) : 1;
    const nb = strip === STRIP.plain ? 1 : Math.max(1, Math.round(h / floorH));
    const bh = h / nb;
    // four sides: [ax, az, bx, bz] local from a→b, outward normal
    const sides = [
      [-w / 2, -d / 2, w / 2, -d / 2, 0, -1],
      [w / 2, -d / 2, w / 2, d / 2, 1, 0],
      [w / 2, d / 2, -w / 2, d / 2, 0, 1],
      [-w / 2, d / 2, -w / 2, -d / 2, -1, 0],
    ];
    for (const acc of this.cell(x, z, far)) {
      let uAlong = uOff;
      for (const [ax, az, bx, bz, nx, nz] of sides) {
        const len = Math.hypot(bx - ax, bz - az);
        const [pax, paz] = R(ax, az), [pbx, pbz] = R(bx, bz);
        const wnx = nx * cy + nz * sy, wnz = -nx * sy + nz * cy;
        const u0 = strip === STRIP.plain ? plainU : uAlong / STRIP_M, u1 = strip === STRIP.plain ? plainU : (uAlong + len) / STRIP_M;
        for (let b = 0; b < nb; b++) {
          const ya = y0 + b * bh, yb = ya + bh;
          const ka = aoAt(b * bh), kb = aoAt((b + 1) * bh);
          const base = acc.n;
          const va = strip === STRIP.plain ? plainV : v0, vb = strip === STRIP.plain ? plainV : v1;
          acc.vert(pax, ya, paz, wnx, 0, wnz, c.r * ka, c.g * ka, c.b * ka, u0, va);
          acc.vert(pbx, ya, pbz, wnx, 0, wnz, c.r * ka, c.g * ka, c.b * ka, u1, va);
          acc.vert(pbx, yb, pbz, wnx, 0, wnz, c.r * kb, c.g * kb, c.b * kb, u1, vb);
          acc.vert(pax, yb, paz, wnx, 0, wnz, c.r * kb, c.g * kb, c.b * kb, u0, vb);
          acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);   // outward: (a,c,b),(a,d,c)
        }
        uAlong += len;
      }
      if (o.top !== false) {
        const tc = o.topColor != null ? new THREE.Color(o.topColor) : c;
        const [rv0, rv1] = this.atlas.stripV(STRIP.roof);
        const base = acc.n, yt = y0 + h;
        const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        corners.forEach(([lx, lz], i) => { const [px, pz] = R(lx, lz); acc.vert(px, yt, pz, 0, 1, 0, tc.r, tc.g, tc.b, i === 1 || i === 2 ? w / STRIP_M : 0, i >= 2 ? rv1 : rv0); });
        acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }

  // any BufferGeometry, transformed by a matrix, in one colour (plain strip)
  mesh(geom, matrix, color, o = {}) {
    const c = this._c.set(color);
    const strip = o.strip ?? STRIP.plain;
    const [v0, v1] = this.atlas.stripV(strip);
    const u = 0.5, v = (v0 + v1) / 2;
    const p = geom.attributes.position, n = geom.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    const cx = matrix.elements[12], cz = matrix.elements[14];
    for (const acc of this.cell(cx, cz, o.far === true)) {
      const base = acc.n;
      for (let i = 0; i < p.count; i++) {
        P.fromBufferAttribute(p, i).applyMatrix4(matrix);
        if (n) N.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); else N.set(0, 1, 0);
        acc.vert(P.x, P.y, P.z, N.x, N.y, N.z, c.r, c.g, c.b, u, v);
      }
      if (geom.index) { const ix = geom.index.array; for (let i = 0; i < ix.length; i++) acc.idx.push(base + ix[i]); }
      else for (let i = 0; i < p.count; i++) acc.idx.push(base + i);
    }
  }

  // a flat quad a→b→c→d (counter-clockwise seen from above), one colour
  quad(a, b, c, d, color, o = {}) {
    const col = this._c.set(color);
    const [v0, v1] = this.atlas.stripV(o.strip ?? STRIP.plain);
    const u = 0.5, v = (v0 + v1) / 2;
    // (b-a)×(d-a): if it points down, the quad was given clockwise-from-above
    // and the winding is reversed so it still faces up
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const down = ny < 0;
    if (down) { nx = -nx; ny = -ny; nz = -nz; }
    const mx = (a[0] + c[0]) / 2, mz = (a[2] + c[2]) / 2;
    for (const acc of this.cell(mx, mz, o.far === true)) {
      const base = acc.n;
      for (const p of [a, b, c, d]) acc.vert(p[0], p[1], p[2], nx, ny, nz, col.r, col.g, col.b, u, v);
      if (down) acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // a triangle, both sides (roof gables, wedges): one colour
  tri(a, b, c, color, o = {}) {
    const col = this._c.set(color);
    const [v0, v1] = this.atlas.stripV(o.strip ?? STRIP.plain);
    const u = 0.5, v = (v0 + v1) / 2;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const mx = (a[0] + b[0] + c[0]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
    for (const acc of this.cell(mx, mz, o.far === true)) {
      const base = acc.n;
      for (const p of [a, b, c]) acc.vert(p[0], p[1], p[2], nx, ny, nz, col.r, col.g, col.b, u, v);
      for (const p of [a, b, c]) acc.vert(p[0], p[1], p[2], -nx, -ny, -nz, col.r, col.g, col.b, u, v);
      acc.idx.push(base, base + 1, base + 2, base + 3, base + 5, base + 4);
    }
  }

  // a sign panel (w×h, centred at y) facing `yaw`, with a backing board
  sign(x, y, z, w, h, yaw, text, bg, o = {}) {
    const [u0, v0, u1, v1] = this.atlas.ad(text, bg);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const hx = cy * w / 2, hz = -sy * w / 2;                 // half-width along the panel
    for (const acc of this.cell(x, z, o.far === true)) {
      const base = acc.n;
      acc.vert(x - hx, y - h / 2, z - hz, sy, 0, cy, 1, 1, 1, u0, v0);
      acc.vert(x + hx, y - h / 2, z + hz, sy, 0, cy, 1, 1, 1, u1, v0);
      acc.vert(x + hx, y + h / 2, z + hz, sy, 0, cy, 1, 1, 1, u1, v1);
      acc.vert(x - hx, y + h / 2, z - hz, sy, 0, cy, 1, 1, 1, u0, v1);
      acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.box(x - sy * 0.25, y - (h + 0.4) / 2, z - cy * 0.25, w + 0.4, h + 0.4, 0.3, yaw, 0x2a2d33, { ao: false, far: false });
  }

  finish(opts = {}) {
    const mat = opts.material || this.atlas.material;
    for (const c of this.cells.values()) {
      for (const which of ['near', 'far']) {
        const acc = c[which]; if (!acc.idx.length) continue;
        const m = new THREE.Mesh(acc.geometry(), mat);
        m.castShadow = !!opts.shadows; m.receiveShadow = true;
        m.userData = { cx: c.cx, cz: c.cz, which };
        this.group.add(m);
        this.meshes.push(m);
        c[which + 'Mesh'] = m;
      }
      c.near = c.far = null;                                 // the arrays are big; let them go
    }
    this.cells = null;
    return this.meshes;
  }

  // one mesh per cell at a time: near, far, or nothing
  update(camX, camZ, near, far) {
    const margin = CH * 0.71;
    for (const m of this.meshes) {
      const d = Math.hypot(m.userData.cx - camX, m.userData.cz - camZ) - margin;
      m.visible = m.userData.which === 'near' ? d < near : (d >= near && d < far);
    }
  }
}

// ------------------------------------------------------------------ glow
// What lights do at night without being lights: an additive layer of pools on
// the ground and faint cones under every lamp, vertex-coloured (bright at the
// source, black at the edge — additive black is nothing), one mesh per cell.
// Mind: blending happens AFTER tone mapping and sRGB encoding, so a 0.05 here
// lands as ~0.2 on screen and every overlapping layer adds another. Keep k small.
// Visible at night only. The four nearest lamps to the player get real
// PointLights on top (see build.js), so the car and the road really light up.
export class GlowLayer {
  constructor(group) {
    this.group = group;
    this.cells = new Map(); this.meshes = [];
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    this._c = new THREE.Color();
    this.lamps = [];                                       // [x, y, z] of every light head, for the real lights
  }
  acc(x, z) {
    const i = Math.floor((x - WORLD.minX) / CH), j = Math.floor((z - WORLD.minZ) / CH), key = i * 1000 + j;
    let c = this.cells.get(key);
    if (!c) { c = { a: new Acc(), cx: WORLD.minX + (i + 0.5) * CH, cz: WORLD.minZ + (j + 0.5) * CH }; this.cells.set(key, c); }
    return c.a;
  }
  // a pool of light on the ground: a fan, centre `k` bright → rim black
  pool(x, y, z, r, color, k = 0.2, segs = 14) {
    const c = this._c.set(color), a = this.acc(x, z), base = a.n;
    a.vert(x, y, z, 0, 1, 0, c.r * k, c.g * k, c.b * k, 0.5, 0.5);
    for (let i = 0; i <= segs; i++) { const t = i / segs * Math.PI * 2; a.vert(x + Math.cos(t) * r, y, z + Math.sin(t) * r, 0, 1, 0, 0, 0, 0, 0.5, 0.5); }
    for (let i = 0; i < segs; i++) a.idx.push(base, base + 2 + i, base + 1 + i);
  }
  // a cone of light from a head down to the ground, faint
  cone(x, yTop, z, yBase, rBase, color, k = 0.035, segs = 10) {
    const c = this._c.set(color), a = this.acc(x, z), base = a.n;
    a.vert(x, yTop, z, 0, 1, 0, c.r * k, c.g * k, c.b * k, 0.5, 0.5);
    for (let i = 0; i <= segs; i++) { const t = i / segs * Math.PI * 2; a.vert(x + Math.cos(t) * rBase, yBase, z + Math.sin(t) * rBase, 0, 1, 0, 0, 0, 0, 0.5, 0.5); }
    // ONE winding, outside faces only: additive layers add up in encoded space, so a
    // double-sided cone would be four times as bright as it reads
    for (let i = 0; i < segs; i++) a.idx.push(base, base + 2 + i, base + 1 + i);
  }
  // a small bright blob (a bulb, a neon tube, a beacon): a camera-agnostic octahedron
  blob(x, y, z, r, color, k = 0.9) {
    const c = this._c.set(color), a = this.acc(x, z), base = a.n;
    a.vert(x, y, z, 0, 1, 0, c.r * k, c.g * k, c.b * k, 0.5, 0.5);
    const P = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
    for (const [dx, dy, dz] of P) a.vert(x + dx, y + dy, z + dz, 0, 1, 0, 0, 0, 0, 0.5, 0.5);
    const F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    for (const [p, q, s] of F) { a.idx.push(base + 1 + p, base + 1 + q, base + 1 + s); a.idx.push(base, base + 1 + p, base + 1 + q); a.idx.push(base, base + 1 + q, base + 1 + s); a.idx.push(base, base + 1 + s, base + 1 + p); }
  }
  lamp(x, yHead, z, color = 0xffd9a0, r = 9, yGround = null) {
    const yg = yGround ?? (yHead - 7);
    this.pool(x, yg + 0.06, z, r, color);
    this.cone(x, yHead, z, yg + 0.05, r * 0.8, color);
    this.lamps.push([x, yHead, z]);
  }
  finish() {
    for (const c of this.cells.values()) {
      if (!c.a.idx.length) continue;
      const m = new THREE.Mesh(c.a.geometry(), this.material);
      m.renderOrder = 2; m.userData = { cx: c.cx, cz: c.cz };
      this.group.add(m); this.meshes.push(m);
    }
    this.cells = null;
    this.setNight(false);
    return this.meshes;
  }
  setNight(n) { this.night = n; for (const m of this.meshes) m.visible = n; }
  update(camX, camZ, near) {
    if (!this.night) return;
    const margin = CH * 0.71;
    for (const m of this.meshes) m.visible = Math.hypot(m.userData.cx - camX, m.userData.cz - camZ) - margin < near;
  }
}
