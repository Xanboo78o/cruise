// props.js — things in the city you can hit. Cones, boxes, tyres, barrels:
// discs on the ground with mass, friction and a little spin. A car shoves them,
// they slide and tumble, they bounce off walls and each other. Rendered as one
// instanced mesh per type from the Kenney GLBs, so a few hundred cost nothing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

export const PROP_TYPES = {
  cone:  { file: 'cone',        scale: 1.7,  mass: 3,   r: 0.42, h: 0.0, mu: 0.6, restitution: 0.25, tumble: 1.0, color: null },
  box:   { file: 'box',         scale: 1.6,  mass: 12,  r: 0.58, h: 0.0, mu: 0.5, restitution: 0.15, tumble: 0.7, color: null },
  tire:  { file: 'debris-tire', scale: 1.9,  mass: 9,   r: 0.56, h: 0.0, mu: 0.45, restitution: 0.45, tumble: 1.2, color: null },
  barrel:{ file: 'box',         scale: 2.0,  mass: 30,  r: 0.7,  h: 0.0, mu: 0.55, restitution: 0.2, tumble: 0.4, color: 0x3d6fb5 },
};

export class Props {
  // spawns: [{type, x, z, yaw?}], walls: [[cx, cz, w, d]] axis-aligned boxes to bounce off
  constructor(scene, heightAt, spawns, walls = []) {
    this.scene = scene; this.heightAt = heightAt; this.walls = walls;
    this.list = spawns.map((s, i) => ({
      id: i, type: PROP_TYPES[s.type], kind: s.type,
      x: s.x, z: s.z, x0: s.x, z0: s.z, y: 0, vx: 0, vz: 0, vy: 0,
      yaw: s.yaw ?? Math.random() * 6.28, spin: 0, tilt: 0, tiltAxis: Math.random() * 6.28, tiltV: 0,
      asleep: true,
    }));
    this.group = new THREE.Group();
    scene.add(this.group);
    this.inst = {};
    this.dummy = new THREE.Object3D();
    for (const kind of Object.keys(PROP_TYPES)) this.loadType(kind);
  }

  loadType(kind) {
    const t = PROP_TYPES[kind];
    const items = this.list.filter(p => p.kind === kind);
    if (!items.length) return;
    loader.load(`assets/models/${t.file}.glb`, g => {
      let geo = null, mat = null;
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(n => { if (n.isMesh && !geo) { geo = n.geometry.clone(); geo.applyMatrix4(n.matrixWorld); mat = n.material.clone(); } });
      if (!geo) return;
      geo.scale(t.scale, t.scale, t.scale);
      if (t.color != null) { mat.color.setHex(t.color); mat.map = null; }
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      this.inst[kind] = { im, items };
      this.syncMeshes(kind);
    });
  }

  // the physics: cars push props, props slide with friction, bounce off walls
  step(dt, cars) {
    const G = 9.81;
    for (const p of this.list) {
      const t = p.type;
      // --- cars
      for (const c of cars) {
        const rc = 0.5 * Math.max(c.p.track + 0.3, 0.6 * (c.p.lf + c.p.lr)) * (c.mega ? 1.5 : 1);
        const dx = p.x - c.x, dz = p.z - c.z;
        const d2 = dx * dx + dz * dz, rr = rc + t.r;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        // push the prop out of the car and give it the car's velocity along the normal (+ a bit)
        p.x = c.x + nx * rr; p.z = c.z + nz * rr;
        const vn = (c.vx - p.vx) * nx + (c.vz - p.vz) * nz;
        if (vn > 0) {
          const k = 1 + t.restitution;
          p.vx += nx * vn * k + (Math.random() - 0.5) * 1.2;
          p.vz += nz * vn * k + (Math.random() - 0.5) * 1.2;
          p.vy = Math.min(6, vn * 0.35 * t.tumble);
          p.spin += (Math.random() - 0.5) * vn * 1.5;
          p.tiltV += vn * 0.25 * t.tumble;
          p.tiltAxis = Math.atan2(nx, nz) + (Math.random() - 0.5);
          p.asleep = false;
          // heavy props push back a little
          if (t.mass > 20) { const k2 = t.mass / (t.mass + c.massNow); c.vx -= nx * vn * k2 * 0.4; c.vz -= nz * vn * k2 * 0.4; c.syncBody(); }
        }
      }
      if (p.asleep) continue;
      // --- motion
      p.vy -= G * dt;
      p.y += p.vy * dt;
      if (p.y < 0) { p.y = 0; if (p.vy < -1) p.vy = -p.vy * 0.3; else p.vy = 0; }
      const onGround = p.y <= 0.001;
      if (onGround) {
        const sp = Math.hypot(p.vx, p.vz);
        const dec = t.mu * G * dt;
        if (sp <= dec) { p.vx = 0; p.vz = 0; } else { p.vx -= p.vx / sp * dec; p.vz -= p.vz / sp * dec; }
        p.spin *= 1 - Math.min(1, dt * 2.5);
        p.tiltV -= p.tilt * 12 * dt; p.tiltV *= 1 - Math.min(1, dt * 4);   // rights itself
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.yaw += p.spin * dt;
      p.tilt = Math.max(-1.4, Math.min(1.4, p.tilt + p.tiltV * dt));
      // --- walls
      for (const [cx, cz, w, d] of this.walls) {
        const hx = w / 2 + t.r, hz = d / 2 + t.r;
        const dx = p.x - cx, dz = p.z - cz;
        if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue;
        const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
        if (ox < oz) { p.x = cx + Math.sign(dx || 1) * hx; p.vx = -p.vx * t.restitution; }
        else { p.z = cz + Math.sign(dz || 1) * hz; p.vz = -p.vz * t.restitution; }
      }
      if (Math.hypot(p.vx, p.vz) < 0.05 && onGround && Math.abs(p.tiltV) < 0.05) { p.vx = 0; p.vz = 0; p.asleep = true; }
    }
    // --- prop vs prop (cheap: only awake ones, against everything)
    const awake = this.list.filter(p => !p.asleep);
    for (const a of awake) {
      for (const b of this.list) {
        if (a === b) continue;
        const dx = b.x - a.x, dz = b.z - a.z, rr = a.type.r + b.type.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, ov = rr - d;
        const ma = a.type.mass, mb = b.type.mass, mt = ma + mb;
        a.x -= nx * ov * (mb / mt); a.z -= nz * ov * (mb / mt);
        b.x += nx * ov * (ma / mt); b.z += nz * ov * (ma / mt);
        const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vn > 0) {
          const j = vn / (1 / ma + 1 / mb) * 1.2;
          a.vx -= j * nx / ma; a.vz -= j * nz / ma;
          b.vx += j * nx / mb; b.vz += j * nz / mb;
          b.asleep = false; b.spin += (Math.random() - 0.5) * vn; b.tiltV += vn * 0.2 * b.type.tumble;
        }
      }
    }
  }

  syncMeshes(kind) {
    const e = this.inst[kind];
    if (!e) return;
    const d = this.dummy;
    e.items.forEach((p, i) => {
      d.position.set(p.x, this.heightAt(p.x, p.z) + p.y, p.z);
      d.rotation.set(0, p.yaw, 0);
      d.rotateOnWorldAxis(new THREE.Vector3(Math.cos(p.tiltAxis), 0, -Math.sin(p.tiltAxis)), p.tilt);
      d.updateMatrix();
      e.im.setMatrixAt(i, d.matrix);
    });
    e.im.instanceMatrix.needsUpdate = true;
  }

  sync() { for (const kind of Object.keys(this.inst)) this.syncMeshes(kind); }

  reset() {
    for (const p of this.list) { p.x = p.x0; p.z = p.z0; p.y = 0; p.vx = p.vz = p.vy = 0; p.tilt = 0; p.tiltV = 0; p.spin = 0; p.asleep = true; }
    this.sync();
  }

  dispose() { this.scene.remove(this.group); }
}
