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

// a puff that isn't a disc: a handful of soft blobs with a ragged edge
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blobs = [[64, 64, 40], [44, 52, 30], [84, 56, 28], [56, 84, 26], [80, 82, 24], [50, 40, 18], [90, 40, 16], [40, 76, 16]];
  for (const [x, y, r] of blobs) {
    const rad = g.createRadialGradient(x, y, 1, x, y, r);
    rad.addColorStop(0, 'rgba(255,255,255,0.55)');
    rad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Smoke and dust: one Points buffer, camera-facing puffs that spin, grow,
// rise, drift on a light wind and fade. Tyre smoke is cool grey and lifts;
// dust is the colour of the ground and hangs low and long.
export class Smoke {
  constructor(scene, max = 420) {
    this.max = max; this.head = 0;
    this.life = new Float32Array(max);
    this.span = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.kind = new Uint8Array(max);                       // 0 smoke, 1 dust
    this.peak = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(max), 1));
    g.setAttribute('rot', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: puffTexture() } }]),
      vertexShader: `attribute float size; attribute vec3 tint; attribute float alpha; attribute float rot;
        varying vec3 vT; varying float vA; varying float vR;
        #include <fog_pars_vertex>
        void main(){ vT = tint; vA = alpha; vR = rot;
          vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vT; varying float vA; varying float vR;
        #include <fog_pars_fragment>
        void main(){
          vec2 c = gl_PointCoord - 0.5; float s = sin(vR), k = cos(vR);
          vec2 uv = vec2(c.x * k - c.y * s, c.x * s + c.y * k) + 0.5;
          vec4 t = texture2D(map, uv);
          gl_FragColor = vec4(vT, t.a * vA);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.wind = [0.5, 0, 0.2];
  }

  // amount 0..1; kind 0 = tyre smoke, 1 = dust; vx/vz the car's velocity
  emit(x, y, z, vx, vz, amount, color = [0.84, 0.84, 0.88], kind = 0) {
    const n = Math.min(4, Math.ceil(amount * 3));
    const rot = this.geo.attributes.rot.array;
    for (let k = 0; k < n; k++) {
      const i = this.head;
      const dust = kind === 1;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.pos[i * 3 + 1] = y + (dust ? 0.25 : 0.2);
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      this.vel[i * 3] = vx * (dust ? 0.32 : 0.18) + (Math.random() - 0.5) * (dust ? 2.4 : 1.6);
      this.vel[i * 3 + 1] = dust ? 0.3 + Math.random() * 0.8 : 0.9 + Math.random() * 1.6;
      this.vel[i * 3 + 2] = vz * (dust ? 0.32 : 0.18) + (Math.random() - 0.5) * (dust ? 2.4 : 1.6);
      this.span[i] = dust ? 1.8 + Math.random() * 1.6 : 1.3 + Math.random() * 1.1;
      this.life[i] = this.span[i];
      this.size[i] = dust ? 1.6 + Math.random() * 1.6 : 1.2 + Math.random() * 1.2;
      this.grow[i] = dust ? 3.2 + Math.random() * 2 : 4.5 + Math.random() * 2.5;
      this.peak[i] = (dust ? 0.38 : 0.44) * Math.min(1, 0.5 + amount);
      const j = Math.random() * 0.08 - 0.04;
      this.tint[i * 3] = color[0] + j; this.tint[i * 3 + 1] = color[1] + j; this.tint[i * 3 + 2] = color[2] + j;
      this.kind[i] = kind;
      rot[i] = Math.random() * 6.283;
      this.head = (this.head + 1) % this.max;
    }
  }

  update(dt) {
    const a = this.geo.attributes.alpha.array, rot = this.geo.attributes.rot.array;
    const [wx, , wz] = this.wind;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { a[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.span[i];            // 0 born → 1 gone
      const dust = this.kind[i] === 1;
      this.pos[i * 3] += (this.vel[i * 3] + wx) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + wz) * dt;
      const drag = dust ? 1.6 : 1.1;
      this.vel[i * 3] *= 1 - dt * drag;
      this.vel[i * 3 + 2] *= 1 - dt * drag;
      this.vel[i * 3 + 1] = dust ? this.vel[i * 3 + 1] * (1 - dt * 1.4) : this.vel[i * 3 + 1] * (1 - dt * 0.5) + dt * 0.35;   // smoke keeps lifting
      this.size[i] += this.grow[i] * dt * (1 - t * 0.6);
      rot[i] += dt * (dust ? 0.25 : 0.5);
      // in fast, out slow: dust lingers, smoke thins
      const inA = Math.min(1, t / 0.08), outA = dust ? 1 - t : (1 - t) * (1 - t);
      a[i] = this.peak[i] * inA * outA;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.tint.needsUpdate = true;
    this.geo.attributes.rot.needsUpdate = true;
  }

  clear() { this.life.fill(0); }
}
