// world/birds.js — flocks over the hills. A handful of loose Vs wheeling at
// 40-80 m, dark against the sky, wings beating in the vertex shader. One
// instanced mesh, one draw call, ~60 matrices a frame. They follow the ground
// (a flock over the range stays over the range) and hop back near the player
// when they've drifted off. Pure dressing — nothing collides with a bird.

import * as THREE from 'three';

function hash(n) { const h = Math.sin(n * 127.1) * 43758.5453; return h - Math.floor(h); }

export class Birds {
  constructor(group, T, q = {}) {
    this.T = T;
    const nFlocks = q.pbr ? 7 : 4, per = 9;
    this.flocks = [];
    for (let i = 0; i < nFlocks; i++) {
      const n = 6 + Math.floor(hash(i * 3.1) * (per - 5));
      this.flocks.push({ x: 0, z: 0, y: 60, a: hash(i * 7.7) * 6.28, alt: 38 + hash(i * 1.3) * 45, speed: 7 + hash(i * 2.9) * 5,
        seed: i, n, offs: Array.from({ length: n }, (_, k) => ({ back: 2.2 * Math.ceil(k / 2) + hash(k + i) * 0.8, side: (k % 2 ? 1 : -1) * (1.6 * Math.ceil(k / 2) + hash(k * 3 + i)), bob: hash(k * 5 + i) * 6.28 })),
        placed: false });
    }
    const total = this.flocks.reduce((s, f) => s + f.n, 0);
    // a V: two thin wings meeting at the body
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.28, -0.75, 0.04, -0.3, -0.12, 0, -0.14,
      0, 0, 0.28, 0.12, 0, -0.14, 0.75, 0.04, -0.3,
    ], 3));
    g.computeVertexNormals();
    this.time = { value: 0 };
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c2030, side: THREE.DoubleSide, fog: true });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        // the wing tips beat: phase per bird, amplitude with distance from the body
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = float(gl_InstanceID) * 1.37;
          #else
            float ph = 0.0;
          #endif
          transformed.y += sin(uTime * 9.0 + ph) * 0.42 * abs(position.x);`);
    };
    mat.customProgramCacheKey = () => 'birds';
    this.mesh = new THREE.InstancedMesh(g, mat, total);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.d = new THREE.Object3D();
    this.t0 = performance.now();
    this.last = this.t0;
  }

  // put a flock somewhere 200-450 m from (px, pz), heading roughly across the player's view
  place(f, px, pz) {
    const a = hash(f.seed * 11 + this.last * 0.001) * 6.28, r = 200 + hash(f.seed * 13 + this.last * 0.0013) * 250;
    f.x = px + Math.cos(a) * r; f.z = pz + Math.sin(a) * r;
    f.a = a + Math.PI / 2 + (hash(f.seed) - 0.5) * 1.2;
    f.y = Math.max(0, this.T.height(f.x, f.z)) + f.alt;
    f.placed = true;
  }

  update(px, pz) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t = (now - this.t0) / 1000;
    this.time.value = t;
    let i = 0;
    for (const f of this.flocks) {
      if (!f.placed || Math.hypot(f.x - px, f.z - pz) > 600) this.place(f, px, pz);
      // a slow wandering turn, and the ground kept under them
      f.a += Math.sin(t * 0.17 + f.seed * 2.1) * 0.25 * dt;
      f.x += Math.sin(f.a) * f.speed * dt; f.z += Math.cos(f.a) * f.speed * dt;
      const want = Math.max(0, this.T.height(f.x, f.z)) + f.alt;
      f.y += (want - f.y) * Math.min(1, dt * 0.6);
      const sa = Math.sin(f.a), ca = Math.cos(f.a);
      for (const o of f.offs) {
        // behind and beside the leader, in the flock's frame; a gentle bob
        const bx = f.x - sa * o.back + ca * o.side, bz = f.z - ca * o.back - sa * o.side;
        const by = f.y + Math.sin(t * 1.3 + o.bob) * 1.2;
        this.d.position.set(bx, by, bz);
        this.d.rotation.set(0, f.a, 0);
        this.d.updateMatrix();
        this.mesh.setMatrixAt(i++, this.d.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
