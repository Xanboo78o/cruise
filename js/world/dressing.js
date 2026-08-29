// world/dressing.js — what a race adds to the city while it's on: walls down
// both edges in the district's material, a plug across every side street, a
// start gate with the race name on it, brake boards, the line overlay. All of
// it goes away when the race does.

import * as THREE from 'three';

import { shared } from '../look/materials.js';   // LOOK: materials only
const WALL_STYLE = {
  concrete: { h: 1.1, w: 0.5, col: 0xbfbbb2, stripe: 0xd94f4f, step: 4, surf: 'concrete' },
  tyre:     { h: 0.9, w: 0.8, col: 0x22242a, stripe: 0xe8e4d8, step: 1.4, surf: 'rubber' },
  rock:     { h: 1.4, w: 1.2, col: 0x7a6b5a, stripe: null, step: 3, surf: 'cliff' },
  timber:   { h: 1.2, w: 0.4, col: 0x6a4f3a, stripe: 0xf5c145, step: 3, surf: 'timber' },
};

export class RaceDressing {
  // route: Route; T: WorldTerrain; def: the race def
  constructor(route, T, scene, def) {
    this.route = route; this.T = T; this.scene = scene; this.def = def;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.style = WALL_STYLE[def.walls] || WALL_STYLE.concrete;
    this.buildWalls();
    this.buildPlugs();
    this.buildGate();
    this.buildBoards();
    this.buildLine();
    this.visibleAids = { line: true, boards: true };
  }

  // instanced wall segments along both edges, every `step` metres
  buildWalls() {
    const r = this.route, st = this.style, hw = r.halfWidth + 0.9;
    const n = Math.floor(r.length / st.step);
    const geo = st.stripe == null
      ? new THREE.DodecahedronGeometry(st.h * 0.8, 0)
      : new THREE.BoxGeometry(st.w, st.h, st.step * 0.98);
    const mat = shared(st.surf, { tint: st.col });
    const im = new THREE.InstancedMesh(geo, mat, n * 2);
    const d = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = i * st.step + st.step / 2;
      const p = r.sampleAtDistance(s);
      for (const side of [-1, 1]) {
        const x = p.x + p.nx * side * hw, z = p.z + p.nz * side * hw;
        d.position.set(x, p.y + st.h / 2, z);
        d.rotation.set(0, Math.atan2(p.tx, p.tz) + (st.stripe == null ? i * 1.7 : 0), 0);
        d.scale.setScalar(st.stripe == null ? 0.8 + ((i * 7 + side) % 5) * 0.12 : 1);
        d.updateMatrix(); im.setMatrixAt(k++, d.matrix);
      }
    }
    im.count = k; im.castShadow = true; im.frustumCulled = false;
    this.group.add(im);
    // a stripe on top every other block, so the walls read at speed
    if (st.stripe != null) {
      const sg = new THREE.BoxGeometry(st.w + 0.04, 0.12, st.step * 0.98);
      const sim = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: st.stripe }), n);
      let q = 0;
      for (let i = 0; i < n; i += 2) {
        const s = i * st.step + st.step / 2, p = r.sampleAtDistance(s);
        for (const side of [-1, 1]) {
          if (((i / 2) + (side > 0 ? 1 : 0)) % 2) continue;
          d.position.set(p.x + p.nx * side * hw, p.y + st.h + 0.06, p.z + p.nz * side * hw);
          d.rotation.set(0, Math.atan2(p.tx, p.tz), 0); d.scale.setScalar(1); d.updateMatrix(); sim.setMatrixAt(q++, d.matrix);
        }
      }
      sim.count = q; sim.frustumCulled = false;
      this.group.add(sim);
    }
  }

  // every road that touches the route but isn't part of it gets a wall across
  // its mouth, a little back from the route edge
  buildPlugs() {
    const r = this.route, T = this.T, st = this.style;
    const seen = new Set();
    const geo = new THREE.BoxGeometry(1, st.h + 0.3, st.w + 0.3);
    const mat = shared(st.surf, { tint: st.col });
    for (const road of T.roads) {
      for (let s = 0; s <= road.L; s += 6) {
        const p = T.pointAt(road, s);
        const nr = r.nearest(p.x, p.z);
        const onRoute = Math.abs(nr.lat) < r.halfWidth + 2 && nr.dist < r.halfWidth + 3;
        if (!onRoute) continue;
        // walk outward along this road from the route until we're clear of it
        for (const dir of [-1, 1]) {
          const key = road.idx + ':' + Math.round(s / 60) + ':' + dir;
          if (seen.has(key)) continue;
          let ss = s, out = null;
          for (let k = 0; k < 20; k++) {
            ss += dir * 6;
            if (ss < 0 || ss > road.L) break;
            const q = T.pointAt(road, ss);
            const n2 = r.nearest(q.x, q.z);
            if (Math.abs(n2.lat) > r.halfWidth + road.T.w / 2 + 4) { out = q; break; }
          }
          if (!out) continue;
          // is this road actually the route itself? then it's not a side street
          const along = Math.abs(out.tx * nr.p.tx + out.tz * nr.p.tz);
          if (along > 0.9 && Math.abs(r.nearest(out.x, out.z).lat) < r.halfWidth + 3) continue;
          seen.add(key);
          const m = new THREE.Mesh(geo, mat);
          m.position.set(out.x, T.height(out.x, out.z) + (st.h + 0.3) / 2, out.z);
          m.scale.x = road.T.w + 2;
          m.rotation.y = Math.atan2(out.tx, out.tz) + Math.PI / 2;
          m.castShadow = true;
          this.group.add(m);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(road.T.w * 0.7, 1.4), new THREE.MeshBasicMaterial({ color: 0xd94f4f, side: THREE.DoubleSide }));
          sign.position.copy(m.position); sign.position.y += st.h + 1.2; sign.rotation.y = m.rotation.y;
          this.group.add(sign);
        }
      }
    }
  }

  buildGate() {
    const r = this.route, i = Math.floor((r.startIndex || 0) * r.samples.length) % r.samples.length;
    const p = r.samples[i];
    this.startSample = i;
    const postM = new THREE.MeshStandardMaterial({ color: 0xdad3c4 });
    const hw = r.halfWidth + 1.8;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.5, 0.7), postM);
      post.position.set(p.x + p.nx * side * hw, p.y + 3.75, p.z + p.nz * side * hw); post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.7, 2.2, 0.8), postM);
    beam.position.set(p.x, p.y + 7.6, p.z); beam.rotation.y = Math.atan2(p.tx, p.tz); beam.castShadow = true;
    this.group.add(beam);
    // the name, both faces
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = '#151820'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#ffcf9a'; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.def.name, 256, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    for (const f of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.9), new THREE.MeshBasicMaterial({ map: tex }));
      face.position.set(p.x - p.tx * f * 0.42, p.y + 7.6, p.z - p.tz * f * 0.42);
      face.rotation.y = Math.atan2(p.tx, p.tz) + (f > 0 ? Math.PI : 0);
      this.group.add(face);
    }
    // the line on the ground
    const cw = (r.halfWidth * 2) / 10, cp = [], cc = [], ci = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 10; col++) {
      const a = -r.halfWidth + col * cw, b = a + cw, z0 = (row - 1) * 1.1, z1 = z0 + 1.1, q = cp.length / 3;
      for (const [lat, along] of [[a, z0], [b, z0], [a, z1], [b, z1]]) { cp.push(p.x + p.nx * lat + p.tx * along, p.y + 0.12, p.z + p.nz * lat + p.tz * along); const v = (row + col) % 2 ? 0.06 : 0.94; cc.push(v, v, v); }
      ci.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); gg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); gg.setIndex(ci);
    this.group.add(new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  buildBoards() {
    const r = this.route, prof = r.profile;
    this.boards = new THREE.Group();
    const panel = new THREE.BoxGeometry(1.7, 1.2, 0.12), post = new THREE.BoxGeometry(0.14, 1.5, 0.14);
    const postM = new THREE.MeshStandardMaterial({ color: 0x3a3a3a });
    const cols = { 100: 0x2f6fd0, 50: 0xf5c145, 25: 0xe8483a };
    for (const b of prof.brakes) {
      if (b.entry - b.exit < 7) continue;
      for (const d of [100, 50, 25]) {
        const at = b.dist - d; if (!r.closed && at < 0) continue;
        const p = r.sampleAtDistance((at + r.length) % r.length);
        const px = p.x + p.nx * (r.halfWidth + 2.6), pz = p.z + p.nz * (r.halfWidth + 2.6);
        const mp = new THREE.Mesh(post, postM); mp.position.set(px, p.y + 0.75, pz);
        const mb = new THREE.Mesh(panel, new THREE.MeshStandardMaterial({ color: cols[d] })); mb.position.set(px, p.y + 2.0, pz); mb.rotation.y = -Math.atan2(p.tx, p.tz);
        this.boards.add(mp, mb);
      }
    }
    this.group.add(this.boards);
  }

  buildLine() {
    const r = this.route, line = r.line, prof = r.profile;
    const green = new THREE.Color(0x36d97a), amber = new THREE.Color(0xf5c145), red = new THREE.Color(0xe8483a);
    const pos = [], col = [], idx = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i], c = prof.state[i] === 2 ? red : prof.state[i] === 0 ? green : amber;
      pos.push(p.x + p.nx * 0.45, p.y + 0.14, p.z + p.nz * 0.45, p.x - p.nx * 0.45, p.y + 0.14, p.z - p.nz * 0.45);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const segs = r.closed ? line.length : line.length - 1;
    for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % line.length) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    this.idealLine = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.idealLine.renderOrder = 2;
    this.group.add(this.idealLine);
  }

  setAids(line, boards) { if (this.idealLine) this.idealLine.visible = line; if (this.boards) this.boards.visible = boards; }
  dispose() { this.scene.remove(this.group); this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}
