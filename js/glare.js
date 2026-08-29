// glare.js — the sun in your eyes. A low sun you're driving into is blinding:
// a soft white bloom on the screen where the sun is, a wash over everything,
// and the exposure drops like your eyes do. It's a DOM overlay, so it costs
// the GPU nothing — the compositor does it. Night: oncoming headlights do the
// same, smaller.

import * as THREE from 'three';

const sm = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export class Glare {
  constructor(renderer) {
    this.renderer = renderer;
    this.baseExposure = renderer.toneMappingExposure;
    this.el = document.createElement('div'); this.el.id = 'glare';
    this.wash = document.createElement('div'); this.wash.id = 'glareWash';
    document.body.append(this.wash, this.el);
    this.v = new THREE.Vector3(); this.fwd = new THREE.Vector3();
    this.k = 0;                                            // smoothed glare 0..1
  }

  // sunDir: [x,y,z] towards the sun; daylight 0..1; dt for the eye's adaptation
  update(camera, sunDir, daylight, dt) {
    const sun = this.v.set(sunDir[0], sunDir[1], sunDir[2]).normalize();
    camera.getWorldDirection(this.fwd);
    const facing = Math.max(0, this.fwd.dot(sun));
    const low = 1 - sm((sun.y - 0.12) / 0.45);           // blinding when the sun is low
    const above = sm((sun.y + 0.02) / 0.08);              // gone once it's set
    let want = Math.pow(facing, 4) * (0.25 + 0.75 * low) * above * daylight;
    // where on screen
    const p = this.v.copy(sun).multiplyScalar(1000).add(camera.position).project(camera);
    const onScreen = p.z < 1 && Math.abs(p.x) < 1.6 && Math.abs(p.y) < 1.6;
    if (!onScreen) want = 0;
    this.k += (want - this.k) * Math.min(1, dt * (want > this.k ? 9 : 2.5));   // fast in, slow out: eyes
    const k = this.k;
    if (k < 0.01) { this.el.style.opacity = 0; this.wash.style.opacity = 0; this.renderer.toneMappingExposure = this.baseExposure; return; }
    const sx = (p.x * 0.5 + 0.5) * 100, sy = (1 - (p.y * 0.5 + 0.5)) * 100;
    const size = 40 + 90 * k;
    this.el.style.opacity = Math.min(1, k * 1.4);
    this.el.style.background = `radial-gradient(circle at ${sx}% ${sy}%, rgba(255,250,235,${0.95 * k}) 0%, rgba(255,240,210,${0.55 * k}) ${size * 0.25}%, rgba(255,230,190,0) ${size}%)`;
    this.wash.style.opacity = 0.35 * k;
    this.renderer.toneMappingExposure = this.baseExposure * (1 - 0.45 * k);
  }
}
