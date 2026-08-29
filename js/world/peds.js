// world/peds.js — the Oo on foot. The character models are lifted out of the
// Kenney karts (one per variant), drawn instanced within ~350 m of the camera.
// They stroll on the pavements, stand in a crowd at a race gate and bounce
// when you hit them — laughing, because nothing here can hurt them.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VARIANTS } from './oo.js';
import { Q } from '../quality.js';

const loader = new GLTFLoader();
const MAX = 260;

export class Peds {
  constructor(scene, population, T) {
    this.scene = scene; this.pop = population; this.T = T;
    this.group = new THREE.Group(); scene.add(this.group);
    this.inst = {};                                      // variant -> InstancedMesh
    this.geo = {};
    this.dummy = new THREE.Object3D();
    this.active = new Map();                             // alien id -> live state (bounced etc)
    this.t = 0;
    for (const v of VARIANTS) this.loadVariant(v);
  }

  loadVariant(v) {
    loader.load(`assets/models/kart-${v}.glb`, g => {
      const node = g.scene.getObjectByName('character');
      if (!node) return;
      let geo = null, mat = null;
      node.updateMatrixWorld(true);
      node.traverse(n => { if (n.isMesh && !geo) { geo = n.geometry.clone(); const m = new THREE.Matrix4().copy(n.matrixWorld); geo.applyMatrix4(m); mat = n.material.clone(); } });
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);   // feet on the ground
      const h = bb.max.y - bb.min.y;
      const k = 1.7 / h;                                                                    // 1.7 m tall
      geo.scale(k, k, k);
      const im = new THREE.InstancedMesh(geo, mat, MAX);
      im.count = 0; im.castShadow = Q.shadows; im.frustumCulled = false;
      this.group.add(im);
      this.inst[v] = im;
    });
  }

  // cars: for the bounce. hour: for where everyone is. gate: [x,z] of the live race, if any
  update(dt, camX, camZ, cars, hour, gate, focusRadius = 350) {
    this.t += dt;
    let near = this.pop.near(camX, camZ, focusRadius, hour, gate);
    // a crowd is a hundred and twenty, not four hundred
    let fans = 0; near = near.filter(e => e.state !== 'race' || fans++ < 120);
    if (near.length > Q.peds) near = near.slice(0, Q.peds);              // the Chromebook's crowd is smaller
    const counts = {};
    for (const v of VARIANTS) counts[v] = 0;
    const d = this.dummy;
    // crowd spots at the gate: along both sides, a few rows deep
    let gateN = 0;
    for (const e of near) {
      const a = e.a;
      let st = this.active.get(a.id);
      if (!st) { st = { x: e.x, z: e.z, vx: 0, vz: 0, vy: 0, y: 0, spin: 0, flat: 0, bounced: 0, seed: (a.id * 0.618) % 1 }; this.active.set(a.id, st); }
      // where they want to be
      let tx = e.x, tz = e.z, facing = e.dir;
      if (e.state === 'race' && gate) {
        const side = gateN % 2 ? 1 : -1, row = Math.floor(gateN / 2);
        tx = gate[0] + side * (16 + (row % 3) * 1.6) + Math.sin(a.id) * 0.8; tz = gate[1] - 30 + Math.floor(row / 3) * 2.2 + Math.cos(a.id * 3) * 0.8;
        facing = side > 0 ? -Math.PI / 2 : Math.PI / 2; gateN++;
      } else if (e.state === 'commute') {
        // walkers keep to the pavement: nudge off the nearest road
        const nr = this.T.nearestRoad(tx, tz);
        if (nr && nr.d < nr.road.T.w / 2 + 2.5) { const s = Math.sign(nr.lat || 1); tx = nr.x + nr.nx * s * (nr.road.T.w / 2 + 2.5); tz = nr.z + nr.nz * s * (nr.road.T.w / 2 + 2.5); }
      }
      // physics: bounced ones fly and tumble, everyone else eases to their spot
      if (st.bounced > 0) {
        st.bounced -= dt;
        st.vy -= 9.81 * dt; st.y += st.vy * dt;
        if (st.y < 0) { st.y = 0; st.vy = st.vy < -2 ? -st.vy * 0.4 : 0; st.vx *= 0.6; st.vz *= 0.6; }
        st.x += st.vx * dt; st.z += st.vz * dt; st.spin += 9 * dt;
        st.flat = st.bounced < 1.2 ? 1 - st.bounced / 1.2 : 0;
      } else {
        st.x += (tx - st.x) * Math.min(1, dt * 2.2); st.z += (tz - st.z) * Math.min(1, dt * 2.2);
        st.flat = 0; st.spin = 0;
      }
      // hit by a car? off you go
      for (const c of cars) {
        const rc = 0.5 * Math.max(c.p.track + 0.4, 0.6 * (c.p.lf + c.p.lr));
        const dx = st.x - c.x, dz = st.z - c.z, d2 = dx * dx + dz * dz;
        if (d2 < (rc + 0.5) ** 2 && st.bounced <= 0 && c.speed > 2) {
          const dd = Math.sqrt(d2) || 0.1, nx = dx / dd, nz = dz / dd;
          const vn = Math.max(2, (c.vx * nx + c.vz * nz) * 1.1);
          st.vx = nx * vn + c.vx * 0.3; st.vz = nz * vn + c.vz * 0.3; st.vy = 4 + Math.min(8, vn * 0.5);
          st.bounced = 2.6; st.spin = 0; c.bumpT = Math.max(c.bumpT, 0.2);
          if (this.onBounce) this.onBounce(a, c);
        }
      }
      const im = this.inst[a.variant]; if (!im || counts[a.variant] >= MAX) continue;
      const gy = this.T.height(st.x, st.z);
      const walking = e.state === 'commute' && st.bounced <= 0;
      const cheer = e.state === 'race' ? Math.max(0, Math.sin(this.t * 6 + a.id)) * 0.35 : 0;
      const bob = walking ? Math.abs(Math.sin(this.t * 8 + a.id)) * 0.12 : 0;
      d.position.set(st.x, gy + st.y + bob + cheer, st.z);
      d.rotation.set(st.flat * Math.PI / 2, facing + (walking ? Math.sin(this.t * 8 + a.id) * 0.1 : 0) + st.spin, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      im.setMatrixAt(counts[a.variant]++, d.matrix);
    }
    for (const v of VARIANTS) { const im = this.inst[v]; if (!im) continue; im.count = counts[v]; im.instanceMatrix.needsUpdate = true; }
    // forget the far ones
    if (this.active.size > 900) for (const [id, st] of this.active) if ((st.x - camX) ** 2 + (st.z - camZ) ** 2 > 600 * 600) this.active.delete(id);
  }

  dispose() { this.scene.remove(this.group); }
}
