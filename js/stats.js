// stats.js — the numbers that decide whether the Chromebook is happy: fps,
// frame ms, draw calls, triangles, physics ms, render ms. ?stats=1 shows it.

import { Q, gpuName } from './quality.js';

export class Stats {
  constructor(renderer) {
    this.renderer = renderer;
    this.el = document.createElement('div');
    this.el.id = 'stats';
    document.body.appendChild(this.el);
    this.frames = 0; this.t = 0; this.acc = 0;
    this.physT = 0; this.rendT = 0; this._p0 = 0; this._r0 = 0;
    this.worst = 0;
    this.gpu = gpuName().replace(/ANGLE \((.*)\)/, '$1').replace(/\(0x[0-9A-Fa-f]+\)|Direct3D.*|OpenGL.*|Vulkan.*/g, '').trim();
    this.el.textContent = 'stats…';
  }
  physBegin() { this._p0 = performance.now(); }
  physEnd() { this.physT += performance.now() - this._p0; }
  renderBegin() { this._r0 = performance.now(); }
  renderEnd() { this.rendT += performance.now() - this._r0; }

  // call once per frame with the frame's dt (seconds)
  update(dt) {
    this.frames++; this.acc += dt; this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.5) return;
    const info = this.renderer.info.render;
    const fps = this.frames / this.acc, ms = 1000 * this.acc / this.frames;
    const dpr = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE_Vector2());
    this.el.textContent =
      `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms (worst ${(this.worst * 1000).toFixed(0)})  ·  draw ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k` +
      `  ·  phys ${(this.physT / this.frames).toFixed(1)} ms  render ${(this.rendT / this.frames).toFixed(1)} ms` +
      `  ·  ${Q.name} ${Math.round(size.x * dpr)}×${Math.round(size.y * dpr)}  ·  ${this.gpu || 'gpu ?'}`;
    this.frames = 0; this.acc = 0; this.physT = 0; this.rendT = 0; this.worst = 0;
  }
}

// a tiny stand-in so this file doesn't need to import three for one vector
class THREE_Vector2 { constructor() { this.x = 0; this.y = 0; } set(x, y) { this.x = x; this.y = y; return this; } }
