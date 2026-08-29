// world.js — builds the three.js scene for a TrackModel: terrain cut around the
// road, the road ribbon itself, kerbs, barriers, props, and the practice overlays
// (racing line coloured by throttle/brake, plus brake-point boards).

import * as THREE from 'three';

export const SKIES = {
  sunset: { top: 0x2a3a6b, bot: 0xff9a5c, sun: 0xffd9a0, fog: 0xf2b183, fogNear: 300, fogFar: 1600,
            hemiSky: 0xffc39a, hemiGround: 0x4a3a2e, dir: 0xffd0a0, dirI: 1.4, amb: 0.40, dirPos: [-0.5, 0.17, -1] },
  dawn:   { top: 0x1d3f66, bot: 0xf0c8b0, sun: 0xfff0d0, fog: 0xcfd8e0, fogNear: 300, fogFar: 1500,
            hemiSky: 0xbcd4f0, hemiGround: 0x4a4438, dir: 0xffe8cc, dirI: 1.15, amb: 0.42, dirPos: [0.8, 0.2, 0.4] },
  noon:   { top: 0x3f7fd0, bot: 0xbfe0f5, sun: 0xffffff, fog: 0xcfe6f5, fogNear: 400, fogFar: 2400,
            hemiSky: 0xcfe6ff, hemiGround: 0x5a6a4a, dir: 0xffffff, dirI: 1.25, amb: 0.48, dirPos: [0.4, 0.9, 0.3] },
  night:  { top: 0x020308, bot: 0x0a0e1c, sun: 0x8fa6d8, fog: 0x04060c, fogNear: 60, fogFar: 520,
            hemiSky: 0x1a2236, hemiGround: 0x06080d, dir: 0x9fb0d8, dirI: 0.14, amb: 0.16, dirPos: [-0.4, 0.7, 0.6] },
};

// A look can swap the whole palette out from under makeSky/applyLighting/
// skyForHour without any of them knowing about it.
let PALETTE = SKIES;
export function usePalette(p) { PALETTE = p || SKIES; }


import { vnoise } from './terrain.js';
function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function makeSky(scene, key) {
  const s = PALETTE[key] || PALETTE.sunset;
  const geo = new THREE.SphereGeometry(4000, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(s.top) }, bot: { value: new THREE.Color(s.bot) },
                sun: { value: new THREE.Color(s.sun) }, sunDir: { value: new THREE.Vector3(...s.dirPos).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top, bot, sun; uniform vec3 sunDir;
      void main(){
        float h = clamp(vP.y * 1.4 + 0.22, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(h, 0.75));
        float d = max(dot(normalize(vP), normalize(sunDir)), 0.0);
        c += sun * pow(d, 26.0) * 0.9 + sun * pow(d, 3.0) * 0.13;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

// blend two sky presets by t — the live day uses this every frame
function lerpCol(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
export function skyForHour(hour) {
  // 0 night → 5 dawn → 8 noon(ish) → 17 sunset → 20 night
  const H = ((hour % 24) + 24) % 24;
  const stops = [[0, 'night'], [5, 'night'], [6.5, 'dawn'], [9, 'noon'], [16, 'noon'], [18.5, 'sunset'], [20.5, 'night'], [24, 'night']];
  let i = 0; while (i < stops.length - 2 && H >= stops[i + 1][0]) i++;
  const [h0, a] = stops[i], [h1, b] = stops[i + 1];
  const t = h1 > h0 ? (H - h0) / (h1 - h0) : 0;
  const A = PALETTE[a], B = PALETTE[b];
  const mix = (k) => lerpCol(A[k], B[k], t);
  return { top: mix('top'), bot: mix('bot'), sun: mix('sun'), fog: mix('fog'),
    fogNear: A.fogNear + (B.fogNear - A.fogNear) * t, fogFar: A.fogFar + (B.fogFar - A.fogFar) * t,
    hemiSky: mix('hemiSky'), hemiGround: mix('hemiGround'), dir: mix('dir'), dirI: A.dirI + (B.dirI - A.dirI) * t, amb: A.amb + (B.amb - A.amb) * t,
    dirPos: [0, 1, 2].map(k => A.dirPos[k] + (B.dirPos[k] - A.dirPos[k]) * t), night: t < 0.5 ? a === 'night' : b === 'night' };
}
// The world's surfaces are MeshStandard now, not MeshLambert. Lambert is pure
// diffuse with no energy conservation, so the same lights come out darker under
// a real BRDF. Two gains, not one: hemisphere light is AMBIENT and ambient is
// the enemy of contrast, so the sun gets the lift and the ambient is pulled back.
export const PBR_AMB = 0.85;
export const PBR_SUN = 2.1;

export function tintSky(skyMesh, lights, scene, s) {
  const u = skyMesh.material.uniforms;
  u.top.value.set(s.top); u.bot.value.set(s.bot); u.sun.value.set(s.sun); u.sunDir.value.set(...s.dirPos).normalize();
  scene.fog.color.set(s.fog); scene.fog.near = s.fogNear; scene.fog.far = s.fogFar;
  lights.hemi.color.set(s.hemiSky); lights.hemi.groundColor.set(s.hemiGround); lights.hemi.intensity = s.amb * 2.2 * PBR_AMB;
  lights.dir.color.set(s.dir); lights.dir.intensity = s.dirI * PBR_SUN;
  lights.sky = { ...lights.sky, dirPos: s.dirPos };
}

export function applyLighting(scene, key) {
  const s = PALETTE[key] || PALETTE.sunset;
  scene.fog = new THREE.Fog(s.fog, s.fogNear, s.fogFar);
  const hemi = new THREE.HemisphereLight(s.hemiSky, s.hemiGround, s.amb * 2.2 * PBR_AMB);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(s.dir, s.dirI * PBR_SUN);
  dir.position.set(s.dirPos[0] * 300, s.dirPos[1] * 300, s.dirPos[2] * 300);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  const d = 150;
  dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
  dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
  dir.shadow.camera.far = 900; dir.shadow.bias = -0.0016;
  scene.add(dir);
  scene.add(dir.target);
  return { hemi, dir, sky: s };
}

// DoubleSide throughout: these ribbons are built from both edge directions and
// half of them wind backwards, which is invisible on FrontSide.
const MAT = {
  road:   () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  line:   () => new THREE.MeshBasicMaterial({ color: 0xf0ece0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  kerb:   () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  terra:  () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  ideal:  () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
};

// A ribbon between two lateral offsets along the centreline.
function ribbon(samples, closed, from, to, yOff, colorFn) {
  const n = samples.length;
  const pos = [], col = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const a = typeof from === 'function' ? from(i) : from;
    const b = typeof to === 'function' ? to(i) : to;
    pos.push(p.x + p.nx * a, p.y + yOff, p.z + p.nz * a);
    pos.push(p.x + p.nx * b, p.y + yOff, p.z + p.nz * b);
    const c = colorFn(i);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class World {
  constructor(model, scene, opts = {}) {
    this.model = model;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.skyKey = opts.sky || model.def.sky || 'sunset';
    this.build();
  }

  build() {
    const m = this.model, s = m.samples, closed = m.closed, hw = m.halfWidth;
    this.buildTerrain();

    // --- asphalt, with a bit of tonal noise so it isn't a flat slab
    const base = new THREE.Color(0x565d68), dark = new THREE.Color(0x40454e);
    const road = new THREE.Mesh(ribbon(s, closed, -hw, hw, 0.06, i => {
      const t = vnoise(s[i].x * 0.08, s[i].z * 0.08);
      return base.clone().lerp(dark, t * 0.8);
    }), MAT.road());
    road.receiveShadow = true;
    this.group.add(road);

    // --- edge lines
    const white = new THREE.Color(0xe8e5dc);
    for (const sign of [-1, 1]) {
      const edge = new THREE.Mesh(ribbon(s, closed, sign * (hw - 0.45), sign * (hw - 0.1), 0.09, () => white), MAT.line());
      this.group.add(edge);
    }
    // --- centre dashes: one quad every 12 m
    const dashPos = [], dashIdx = [];
    const spacing = Math.max(1, Math.round(6 / (m.length / s.length)));
    for (let i = 0; i < s.length; i += spacing * 2) {
      const a = s[i], b = s[Math.min(i + spacing, s.length - 1)];
      if (!b) break;
      const q = dashPos.length / 3;
      dashPos.push(a.x + a.nx * 0.18, a.y + 0.09, a.z + a.nz * 0.18, a.x - a.nx * 0.18, a.y + 0.09, a.z - a.nz * 0.18,
                   b.x + b.nx * 0.18, b.y + 0.09, b.z + b.nz * 0.18, b.x - b.nx * 0.18, b.y + 0.09, b.z - b.nz * 0.18);
      dashIdx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dashPos, 3));
    dg.setIndex(dashIdx);
    this.group.add(new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0xd8cf9a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })));

    this.buildKerbs();
    this.buildFeatures();
    this.buildStartLine();
    this.buildProps();
    this.buildIdealLine();
    this.buildBrakeBoards();
  }

  // Terrain follows the road's height near the road and relaxes to the hillside
  // further out, so a 110 m descent still sits in a mountain instead of a hole.
  buildTerrain() {
    const m = this.model, b = m.bounds, T = m.terrain;
    const pad = 340, cell = 7;
    const x0 = b.minX - pad, z0 = b.minZ - pad;
    const w = Math.ceil((b.maxX + pad - x0) / cell), h = Math.ceil((b.maxZ + pad - z0) / cell);
    const pos = [], col = [], idx = [];
    const grass = new THREE.Color(this.skyKey === 'dawn' ? 0x6f6a4e : 0x6e9455);
    const rock = new THREE.Color(0x7d7362);
    const sand = new THREE.Color(0xbca878);
    const dirt = new THREE.Color(0x8b7355);
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        const nr = m.nearest(x, z);
        const d = Math.max(0, Math.abs(nr.lat) - m.halfWidth);
        pos.push(x, T.height(x, z, nr), z);            // same field the wheels stand on
        const t = vnoise(x * 0.03, z * 0.03);
        let c = grass.clone().lerp(dirt, t * 0.32);
        if (d < 18) c.lerp(sand, 0.35);
        if (this.skyKey === 'dawn') c.lerp(rock, 0.35 + t * 0.4);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = j * (w + 1) + i;
        idx.push(a, a + w + 1, a + 1, a + 1, a + w + 1, a + w + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, MAT.terra());
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrain = mesh;

    // A backing plate far below and far out: without it you can see past the
    // edge of the terrain to open sky, which on a mountain track is most of the
    // frame whenever the camera looks downhill.
    let minY = 1e9;
    for (const s of m.samples) minY = Math.min(minY, s.y);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshLambertMaterial({ color: grass.clone().lerp(dirt, 0.45) })
    );
    back.rotation.x = -Math.PI / 2;
    back.position.set((b.minX + b.maxX) / 2, minY - 26, (b.minZ + b.maxZ) / 2);
    this.group.add(back);
  }

  // Kickers get a solid face under the lip and a stripe on the ramp; tunnels
  // get walls and a roof. Both are dressing — the height field is the physics.
  buildFeatures() {
    const m = this.model, hw = m.halfWidth;
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2d33, side: THREE.DoubleSide });
    const stripe = new THREE.MeshBasicMaterial({ color: 0xf5c145, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    for (const j of m.jumps) {
      const lip = m.sampleAtDistance(j.at - 0.5), base = m.sampleAtDistance(j.at - j.len);
      const yBase = base.y;
      // vertical face at the lip, full width
      const q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.Float32BufferAttribute([
        lip.x + lip.nx * (hw + 1.3), lip.y, lip.z + lip.nz * (hw + 1.3),
        lip.x - lip.nx * (hw + 1.3), lip.y, lip.z - lip.nz * (hw + 1.3),
        lip.x + lip.nx * (hw + 1.3), yBase - 0.5, lip.z + lip.nz * (hw + 1.3),
        lip.x - lip.nx * (hw + 1.3), yBase - 0.5, lip.z - lip.nz * (hw + 1.3)], 3));
      q.setIndex([0, 2, 1, 1, 2, 3]);
      q.computeVertexNormals();
      this.group.add(new THREE.Mesh(q, dark));
      // side skirts along the ramp so it reads as a built thing
      for (const side of [-1, 1]) {
        const pos = [], idx = [];
        const n = 8;
        for (let i = 0; i <= n; i++) {
          const s = m.sampleAtDistance(j.at - j.len + (j.len - 0.5) * i / n);
          const ox = s.nx * side * (hw + 1.3), oz = s.nz * side * (hw + 1.3);
          pos.push(s.x + ox, s.y + 0.05, s.z + oz, s.x + ox, yBase - 0.5, s.z + oz);
          if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx); g.computeVertexNormals();
        this.group.add(new THREE.Mesh(g, dark));
      }
      // chevrons on the ramp surface
      for (let k = 1; k <= 3; k++) {
        const s = m.sampleAtDistance(j.at - j.len * (0.25 * k));
        const band = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.6, 1.2), stripe);
        band.position.set(s.x, s.y + 0.12, s.z);
        band.rotation.set(-Math.PI / 2 + Math.atan(s.grade), Math.atan2(s.tx, s.tz), 0, 'YXZ');
        this.group.add(band);
      }
    }
    const wallM = new THREE.MeshLambertMaterial({ color: 0x4a4f5a, side: THREE.DoubleSide });
    const roofM = new THREE.MeshLambertMaterial({ color: 0x33363e, side: THREE.DoubleSide });
    for (const u of m.tunnels) {
      const n = Math.max(6, Math.round(u.len / 6));
      const pos = [], idx = [], rpos = [], ridx = [];
      const H = 7.5;
      for (let i = 0; i <= n; i++) {
        const s = m.sampleAtDistance((u.at + u.len * i / n) % m.length);
        for (const side of [-1, 1]) {
          const ox = s.nx * side * (hw + 0.8), oz = s.nz * side * (hw + 0.8);
          pos.push(s.x + ox, s.y - 0.5, s.z + oz, s.x + ox, s.y + H, s.z + oz);
        }
        rpos.push(s.x + s.nx * (hw + 1.2), s.y + H, s.z + s.nz * (hw + 1.2), s.x - s.nx * (hw + 1.2), s.y + H, s.z - s.nz * (hw + 1.2));
        if (i < n) {
          const a = i * 4;
          idx.push(a, a + 1, a + 4, a + 4, a + 1, a + 5, a + 2, a + 6, a + 3, a + 6, a + 7, a + 3);
          const r = i * 2; ridx.push(r, r + 2, r + 1, r + 2, r + 3, r + 1);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3)); rg.setIndex(ridx); rg.computeVertexNormals();
      const walls = new THREE.Mesh(g, wallM), roof = new THREE.Mesh(rg, roofM);
      walls.castShadow = roof.castShadow = true;
      this.group.add(walls, roof);
      // a few lights down the middle so it isn't a cave
      for (let i = 1; i < n; i += 2) {
        const s = m.sampleAtDistance((u.at + u.len * i / n) % m.length);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
        lamp.position.set(s.x, s.y + H - 0.3, s.z);
        lamp.rotation.y = Math.atan2(s.tx, s.tz);
        this.group.add(lamp);
      }
    }
  }

  // Kerbs only where it actually bends, on the inside and outside of the corner.
  buildKerbs() {
    const m = this.model, s = m.samples, hw = m.halfWidth;
    const red = new THREE.Color(0xc4453a), white = new THREE.Color(0xe9e4d8);
    const pos = [], col = [], idx = [];
    let stripe = 0;
    for (let i = 0; i < s.length - 1; i++) {
      const k = Math.abs(s[i].k);
      if (k < 0.006) { stripe = 0; continue; }             // radius > ~165 m: no kerb
      const sign = Math.sign(s[i].k);
      stripe++;
      const c = (stripe >> 1) % 2 ? red : white;
      for (const side of [sign, -sign]) {
        const a = s[i], b = s[i + 1];
        const o1 = side * hw, o2 = side * (hw + 1.25);
        const q = pos.length / 3;
        pos.push(a.x + a.nx * o1, a.y + 0.07, a.z + a.nz * o1, a.x + a.nx * o2, a.y + 0.12, a.z + a.nz * o2,
                 b.x + b.nx * o1, b.y + 0.07, b.z + b.nz * o1, b.x + b.nx * o2, b.y + 0.12, b.z + b.nz * o2);
        for (let v = 0; v < 4; v++) col.push(c.r, c.g, c.b);
        idx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, MAT.kerb()));
  }

  buildStartLine() {
    const m = this.model;
    const i = Math.floor((m.def.startIndex || 0) * m.samples.length);
    const p = m.samples[i % m.samples.length];
    this.startSample = i % m.samples.length;
    const cw = (m.halfWidth * 2) / 10;                 // 10 checkers across, 2 rows
    const cp = [], cc = [], ci = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 10; col++) {
        const a = -m.halfWidth + col * cw, b = a + cw;
        const z0 = (row - 1) * 1.1, z1 = z0 + 1.1;
        const q = cp.length / 3;
        for (const [lat, along] of [[a, z0], [b, z0], [a, z1], [b, z1]]) {
          cp.push(p.x + p.nx * lat + p.tx * along, p.y + 0.1, p.z + p.nz * lat + p.tz * along);
          const v = (row + col) % 2 ? 0.06 : 0.94;
          cc.push(v, v, v);
        }
        ci.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setIndex(ci);
    this.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    // gantry
    const post = new THREE.BoxGeometry(0.5, 6, 0.5);
    const mat = new THREE.MeshLambertMaterial({ color: 0xdad3c4 });
    for (const side of [-1, 1]) {
      const mp = new THREE.Mesh(post, mat);
      mp.position.set(p.x + p.nx * side * (m.halfWidth + 1.6), p.y + 3, p.z + p.nz * side * (m.halfWidth + 1.6));
      mp.castShadow = true;
      this.group.add(mp);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(m.halfWidth * 2 + 4, 1.1, 0.6), mat);
    beam.position.set(p.x, p.y + 6.2, p.z);
    beam.rotation.y = Math.atan2(p.tx, p.tz);
    beam.castShadow = true;
    this.group.add(beam);
  }

  buildProps() {
    const m = this.model, s = m.samples, hw = m.halfWidth;
    const kind = (m.def.props && m.def.props.trees) || 'palm';
    const count = Math.floor(s.length / 5);
    // trees
    const trunkG = new THREE.CylinderGeometry(0.16, 0.24, kind === 'palm' ? 5.2 : 3.4, 5);
    const trunkM = new THREE.MeshLambertMaterial({ color: kind === 'palm' ? 0x8a7355 : 0x5c4632 });
    const leafG = kind === 'palm'
      ? new THREE.ConeGeometry(2.6, 1.6, 6)
      : new THREE.ConeGeometry(2.0, 5.5, 6);
    const leafM = new THREE.MeshLambertMaterial({ color: kind === 'palm' ? 0x4f8a4a : 0x35543a, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, count);
    const leaves = new THREE.InstancedMesh(leafG, leafM, count);
    trunks.castShadow = leaves.castShadow = true;
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < s.length && n < count; i += 5) {
      const p = s[i];
      const r = hash2(p.x * 0.7, p.z * 0.7);
      if (r < 0.45) continue;
      const side = r > 0.72 ? 1 : -1;
      const off = hw + 12 + r * 26;
      const x = p.x + p.nx * side * off, z = p.z + p.nz * side * off;
      const y = p.y - 0.4 + (r - 0.5) * 1.2;
      const sc = 0.8 + r * 0.6;
      dummy.position.set(x, y + (kind === 'palm' ? 2.6 : 1.7) * sc, z);
      dummy.scale.setScalar(sc);
      dummy.rotation.set(0, r * 6.28, (r - 0.5) * 0.14);
      dummy.updateMatrix();
      trunks.setMatrixAt(n, dummy.matrix);
      dummy.position.y = y + (kind === 'palm' ? 5.4 : 4.4) * sc;
      dummy.updateMatrix();
      leaves.setMatrixAt(n, dummy.matrix);
      n++;
    }
    trunks.count = leaves.count = n;
    this.group.add(trunks, leaves);

    // barriers on the outside of quick corners
    const bt = (m.def.props && m.def.props.barrier) || 'tire';
    const bg = bt === 'rock' ? new THREE.DodecahedronGeometry(1.5, 0) : new THREE.CylinderGeometry(0.62, 0.62, 0.7, 8);
    const bm = new THREE.MeshLambertMaterial({ color: bt === 'rock' ? 0x6d6357 : 0x22242a, flatShading: true });
    const barr = new THREE.InstancedMesh(bg, bm, 900);
    barr.castShadow = true;
    let bn = 0;
    for (let i = 0; i < s.length && bn < 900; i += 2) {
      const k = Math.abs(s[i].k);
      if (k < 0.012) continue;
      const side = -Math.sign(s[i].k);
      const p = s[i];
      const off = hw + 11;
      dummy.position.set(p.x + p.nx * side * off, p.y + (bt === 'rock' ? 0.4 : 0.35), p.z + p.nz * side * off);
      dummy.rotation.set(0, hash2(p.x, p.z) * 6.28, 0);
      dummy.scale.setScalar(bt === 'rock' ? 0.7 + hash2(p.z, p.x) * 0.8 : 1);
      dummy.updateMatrix();
      barr.setMatrixAt(bn++, dummy.matrix);
    }
    barr.count = bn;
    this.group.add(barr);
  }

  // The practice line: where to be, coloured by what the pedals should be doing.
  buildIdealLine() {
    const m = this.model, line = m.line, prof = m.profile;
    const green = new THREE.Color(0x36d97a), amber = new THREE.Color(0xf5c145), red = new THREE.Color(0xe8483a);
    const pos = [], col = [], idx = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const c = prof.state[i] === 2 ? red : prof.state[i] === 0 ? green : amber;
      pos.push(p.x + p.nx * 0.55, p.y + 0.14, p.z + p.nz * 0.55);
      pos.push(p.x - p.nx * 0.55, p.y + 0.14, p.z - p.nz * 0.55);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const segs = m.closed ? line.length : line.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = ((i + 1) % line.length) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, MAT.ideal());
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.idealLine = mesh;
  }

  // Boards at 100/50/25 m before each braking point, like the real ones.
  buildBrakeBoards() {
    const m = this.model, prof = m.profile;
    this.boards = new THREE.Group();
    const panel = new THREE.BoxGeometry(1.7, 1.2, 0.12);
    const post = new THREE.BoxGeometry(0.14, 1.5, 0.14);
    const postM = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const cols = { 100: 0x2f6fd0, 50: 0xf5c145, 25: 0xe8483a };
    for (const b of prof.brakes) {
      if (b.entry - b.exit < 7) continue;                 // only real braking zones
      for (const d of [100, 50, 25]) {
        const at = b.dist - d;
        if (!m.closed && at < 0) continue;
        const p = m.sampleAtDistance((at + m.length) % m.length);
        const side = 1;
        const px = p.x + p.nx * side * (m.halfWidth + 2.6), pz = p.z + p.nz * side * (m.halfWidth + 2.6);
        const mp = new THREE.Mesh(post, postM);
        mp.position.set(px, p.y + 0.75, pz);
        const mb = new THREE.Mesh(panel, new THREE.MeshLambertMaterial({ color: cols[d] }));
        mb.position.set(px, p.y + 2.0, pz);
        mb.rotation.y = -Math.atan2(p.tx, p.tz);
        mb.castShadow = true;
        this.boards.add(mp, mb);
      }
    }
    this.group.add(this.boards);
  }

  setAids(showLine, showBoards) {
    if (this.idealLine) this.idealLine.visible = showLine;
    if (this.boards) this.boards.visible = showBoards;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => mm.dispose());
    });
  }
}
