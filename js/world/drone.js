// world/drone.js — the FPV fly-through before a race. Twelve to fifteen
// seconds: rise off the gate, rip along the first stretch of the route low and
// fast, swing wide over a landmark corner, then dive back down onto the grid
// behind the player. Any button skips it.

import * as THREE from 'three';

const v = new THREE.Vector3(), look = new THREE.Vector3();

export class DroneIntro {
  // route: Route; gridPos: {x,y,z,yaw} where the player sits; T: terrain
  constructor(route, gridPos, T, duration = 13) {
    this.route = route; this.grid = gridPos; this.T = T; this.duration = duration;
    this.t = 0; this.done = false;
    this.keys = this.plan();
  }

  // camera keyframes along the route: [time01, position, lookAt]
  plan() {
    const r = this.route, L = r.length;
    const at = (frac, up, side = 0) => { const p = r.sampleAtDistance(((frac * L) % L + L) % L); return new THREE.Vector3(p.x + p.nx * side, p.y + up, p.z + p.nz * side); };
    const g = this.grid;
    const gridV = new THREE.Vector3(g.x, g.y, g.z);
    const keys = [];
    // 0: high above the gate, looking down the road
    keys.push([0.00, at(0.0, 60, -40), at(0.15, 10)]);
    // 1: dive to low and fast down the first stretch
    keys.push([0.18, at(0.06, 16, 4), at(0.16, 4)]);
    keys.push([0.42, at(0.26, 14, -4), at(0.36, 3)]);
    // 2: swing wide and high over a corner (the sharpest in the first half)
    let tight = 0.5, minR = 1e9;
    for (let f = 0.3; f < 0.7; f += 0.02) { const p = r.sampleAtDistance(f * L); const R = Math.abs(p.k) > 1e-6 ? 1 / Math.abs(p.k) : 1e9; if (R < minR) { minR = R; tight = f; } }
    keys.push([0.62, at(tight, 55, 50), at(tight + 0.03, 2)]);
    // 3: back over the gate and down onto the grid behind the player
    keys.push([0.86, at(0.0, 30, 30), gridV.clone().add(new THREE.Vector3(0, 2, 0))]);
    keys.push([1.00, new THREE.Vector3(g.x - Math.sin(g.yaw) * 9, g.y + 3.5, g.z - Math.cos(g.yaw) * 9), new THREE.Vector3(g.x + Math.sin(g.yaw) * 6, g.y + 1.1, g.z + Math.cos(g.yaw) * 6)]);
    return keys;
  }

  // Catmull-Rom through the keys for a smooth ride
  sample(t01, out, lookOut) {
    const k = this.keys;
    let i = 0; while (i < k.length - 2 && t01 > k[i + 1][0]) i++;
    const a = k[Math.max(0, i - 1)], b = k[i], c = k[Math.min(k.length - 1, i + 1)], d = k[Math.min(k.length - 1, i + 2)];
    const span = (c[0] - b[0]) || 1e-6, u = Math.max(0, Math.min(1, (t01 - b[0]) / span));
    const cr = (p0, p1, p2, p3, u, o) => {
      const u2 = u * u, u3 = u2 * u;
      o.x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
      o.y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
      o.z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3);
    };
    cr(a[1], b[1], c[1], d[1], u, out);
    cr(a[2], b[2], c[2], d[2], u, lookOut);
    // never below the ground — and never through a tower: downtown the floor is 30 m up
    const gy = this.T.height(out.x, out.z);
    const dist = this.T.districtAt(out.x, out.z);
    const floor = dist && dist.fill === 'towers' ? 30 : 2.5;
    if (out.y < gy + floor) out.y = gy + floor;
  }

  update(dt, camera) {
    if (this.done) return;
    this.t += dt;
    const t01 = Math.min(1, this.t / this.duration);
    // ease the ends, keep the middle quick
    const e = t01 < 0.1 ? t01 * t01 * 10 * 0.5 + 0 : t01 > 0.9 ? 1 - (1 - t01) * (1 - t01) * 10 * 0.5 : t01;
    this.sample(Math.max(0, Math.min(1, e)), v, look);
    camera.position.copy(v);
    camera.lookAt(look);
    camera.fov = 70 + Math.sin(t01 * Math.PI) * 14;
    camera.updateProjectionMatrix();
    if (t01 >= 1) this.done = true;
  }

  skip() { this.done = true; }
  get progress() { return Math.min(1, this.t / this.duration); }
}
