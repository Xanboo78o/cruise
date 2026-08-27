// world.js — builds the three.js scene for a TrackModel: terrain cut around the
// road, the road ribbon itself, kerbs, barriers, props, and the practice overlays
// (racing line coloured by throttle/brake, plus brake-point boards).

import * as THREE from 'three';

export const SKIES = {
  sunset: { top: 0x2a3a6b, bot: 0xff9a5c, sun: 0xffd9a0, fog: 0xf2b183, fogNear: 240, fogFar: 900,
            hemiSky: 0xffc39a, hemiGround: 0x4a3a2e, dir: 0xffd0a0, dirI: 1.35, amb: 0.30, dirPos: [-0.5, 0.35, -1] },
  dawn:   { top: 0x1d3f66, bot: 0xf0c8b0, sun: 0xfff0d0, fog: 0xcfd8e0, fogNear: 300, fogFar: 1500,
            hemiSky: 0xbcd4f0, hemiGround: 0x4a4438, dir: 0xffe8cc, dirI: 1.15, amb: 0.42, dirPos: [0.8, 0.45, 0.4] },
  noon:   { top: 0x3f7fd0, bot: 0xbfe0f5, sun: 0xffffff, fog: 0xcfe6f5, fogNear: 350, fogFar: 1700,
            hemiSky: 0xcfe6ff, hemiGround: 0x5a6a4a, dir: 0xffffff, dirI: 1.25, amb: 0.48, dirPos: [0.4, 0.9, 0.3] },
  night:  { top: 0x070a16, bot: 0x1b2340, sun: 0x9fb6e8, fog: 0x121a2e, fogNear: 120, fogFar: 780,
            hemiSky: 0x3a4a72, hemiGround: 0x141824, dir: 0xa8bce8, dirI: 0.5, amb: 0.42, dirPos: [-0.4, 0.7, 0.6] },
};

// deterministic hash noise — same world every reload
function hash2(x, z) {
  let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (hash2(xi, zi) * (1 - u) + hash2(xi + 1, zi) * u) * (1 - v) +
         (hash2(xi, zi + 1) * (1 - u) + hash2(xi + 1, zi + 1) * u) * v;
}

export function makeSky(scene, key) {
  const s = SKIES[key] || SKIES.sunset;
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

export function applyLighting(scene, key) {
  const s = SKIES[key] || SKIES.sunset;
  scene.fog = new THREE.Fog(s.fog, s.fogNear, s.fogFar);
  const hemi = new THREE.HemisphereLight(s.hemiSky, s.hemiGround, s.amb * 2.2);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(s.dir, s.dirI);
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
  ideal:  () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
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
    const base = new THREE.Color(0x474d57), dark = new THREE.Color(0x353a43);
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
    this.buildStartLine();
    this.buildProps();
    this.buildIdealLine();
    this.buildBrakeBoards();
  }

  // Terrain follows the road's height near the road and relaxes to the hillside
  // further out, so a 110 m descent still sits in a mountain instead of a hole.
  buildTerrain() {
    const m = this.model, b = m.bounds;
    const pad = 260, cell = 7;
    const x0 = b.minX - pad, z0 = b.minZ - pad;
    const w = Math.ceil((b.maxX + pad - x0) / cell), h = Math.ceil((b.maxZ + pad - z0) / cell);
    const pos = [], col = [], idx = [];
    const grass = new THREE.Color(this.skyKey === 'dawn' ? 0x6f6a4e : 0x6e9455);
    const rock = new THREE.Color(0x7d7362);
    const sand = new THREE.Color(0xbca878);
    const dirt = new THREE.Color(0x8b7355);
    // global hillside: a plane through the road's start and end elevation
    const first = m.samples[0], last = m.samples[m.samples.length - 1];
    const dz = (last.z - first.z) || 1;
    const grade = (last.y - first.y) / dz;
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        const nr = m.nearest(x, z);
        const d = Math.max(0, nr.dist - m.halfWidth);
        const hill = first.y + (z - first.z) * grade;
        const blend = Math.min(1, Math.max(0, (d - 14) / 150));
        let y = nr.p.y * (1 - blend) + hill * blend;
        y += vnoise(x * 0.012, z * 0.012) * Math.min(d * 0.55, 26) * (this.skyKey === 'dawn' ? 1.0 : 0.35);
        y += vnoise(x * 0.06, z * 0.06) * Math.min(d * 0.08, 2.2);
        if (d < 12) y = nr.p.y - 0.35 + d * 0.02;     // flat verge right beside the road
        pos.push(x, y, z);
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
        pos.push(a.x + a.nx * o1, a.y + 0.08, a.z + a.nz * o1, a.x + a.nx * o2, a.y + 0.16, a.z + a.nz * o2,
                 b.x + b.nx * o1, b.y + 0.08, b.z + b.nz * o1, b.x + b.nx * o2, b.y + 0.16, b.z + b.nz * o2);
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
