// fx.js — the stuff that makes a slide feel like a slide: rubber on the road
// and smoke off the tyres. Both are fixed-size buffers, so they never allocate
// mid-drive and never grow without bound.

import * as THREE from 'three';

export class SkidMarks {
  constructor(scene, max = 5200) {
    this.max = max; this.head = 0; this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 12);
    this.idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4, o = i * 6;
      this.idx[o] = v; this.idx[o + 1] = v + 2; this.idx[o + 2] = v + 1;
      this.idx[o + 3] = v + 2; this.idx[o + 4] = v + 3; this.idx[o + 5] = v + 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.NormalBlending,
    }));
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = new Map();
  }

  // one call per wheel per frame; intensity 0..1
  addPoint(key, x, y, z, nx, nz, intensity, width = 0.3) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z, nx, nz, intensity });
    if (!prev || intensity <= 0.02) return;
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d < 0.25 || d > 12) return;
    const i = this.head;
    const p = i * 12, c = i * 12;
    const w = width;
    this.pos.set([
      prev.x + prev.nx * w, prev.y + 0.035, prev.z + prev.nz * w,
      prev.x - prev.nx * w, prev.y + 0.035, prev.z - prev.nz * w,
      x + nx * w, y + 0.035, z + nz * w,
      x - nx * w, y + 0.035, z - nz * w,
    ], p);
    const a0 = Math.min(prev.intensity, 1) * 0.9, a1 = Math.min(intensity, 1) * 0.9;
    // darker = heavier mark. The material is a flat 0.5 alpha; shade does the work.
    const s0 = 1 - a0, s1 = 1 - a1;
    this.col.set([s0 * 0.5, s0 * 0.5, s0 * 0.55, s0 * 0.5, s0 * 0.5, s0 * 0.55,
                  s1 * 0.5, s1 * 0.5, s1 * 0.55, s1 * 0.5, s1 * 0.5, s1 * 0.55], c);
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
    this.geo.setDrawRange(0, this.count * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.head = 0; this.count = 0;
    this.geo.setDrawRange(0, 0);
    this.last.clear();
  }
}

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  rad.addColorStop(0, 'rgba(255,255,255,0.95)');
  rad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Smoke {
  constructor(scene, max = 420) {
    this.max = max; this.head = 0;
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: puffTexture() } },
      vertexShader: `attribute float size; attribute vec3 tint; attribute float alpha;
        varying vec3 vT; varying float vA;
        void main(){ vT = tint; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vT; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vT, t.a * vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vz, amount, color = [0.86, 0.86, 0.88]) {
    const n = Math.min(4, Math.ceil(amount * 3));
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.5;
      this.pos[i * 3 + 1] = y + 0.16;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      this.vel[i * 3] = vx * 0.16 + (Math.random() - 0.5) * 1.6;
      this.vel[i * 3 + 1] = 0.7 + Math.random() * 1.5;
      this.vel[i * 3 + 2] = vz * 0.16 + (Math.random() - 0.5) * 1.6;
      this.life[i] = 1;
      this.size[i] = 1.1 + Math.random() * 1.3;
      this.tint[i * 3] = color[0]; this.tint[i * 3 + 1] = color[1]; this.tint[i * 3 + 2] = color[2];
      this.seed[i] = 0.5 + Math.random() * 0.9;
      this.head = (this.head + 1) % this.max;
    }
  }

  update(dt) {
    const a = this.geo.attributes.alpha.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { a[i] = 0; continue; }
      this.life[i] -= dt * (0.62 / this.seed[i]);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 1 - dt * 1.1;
      this.vel[i * 3 + 2] *= 1 - dt * 1.1;
      this.vel[i * 3 + 1] *= 1 - dt * 0.6;
      this.size[i] += dt * 5.5;
      a[i] = Math.max(0, this.life[i]) * 0.5;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.tint.needsUpdate = true;
  }

  clear() { this.life.fill(0); }
}
