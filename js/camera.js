// camera.js — the cameras. The chase cam sits behind where the car is *going*,
// not where it's pointing, which is what makes a drift read on screen.

import * as THREE from 'three';

export const MODES = ['chase', 'low', 'hood', 'drone', 'tv', 'orbit'];
export const MODE_LABEL = { chase: 'CHASE', low: 'LOW CHASE', hood: 'BUMPER', drone: 'DRONE', tv: 'TRACKSIDE', orbit: 'FREE ORBIT' };

const v = new THREE.Vector3(), look = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10);
    this.target = new THREE.Vector3();
    this.orbit = { yaw: 0, pitch: 0.4, dist: 16 };
    this.tvCams = [];
    this.tvIndex = 0;
    this.tvHold = 0;
    this.shake = 0;
    this.baseFov = 62;
  }

  setTrackCams(model) {
    // trackside cameras: one every ~120 m, set back from the outside of the road
    this.tvCams = [];
    if (!model || !model.samples) return;
    const s = model.samples, step = Math.max(20, Math.round(s.length / Math.max(4, Math.round(model.length / 120))));
    for (let i = 0; i < s.length; i += step) {
      const p = s[i];
      const side = p.k !== 0 ? -Math.sign(p.k) : (i % 2 ? 1 : -1);
      const off = model.halfWidth + 22;
      this.tvCams.push(new THREE.Vector3(p.x + p.nx * side * off, p.y + 7 + (i % 3) * 3, p.z + p.nz * side * off));
    }
  }

  cycle(dir = 1) {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + dir + MODES.length) % MODES.length];
    return this.mode;
  }

  kick(amount) { this.shake = Math.min(1, this.shake + amount); }

  update(dt, car, mouse) {
    const speed = car.speed;
    const heading = Math.atan2(car.vx, car.vz);
    const blend = Math.min(speed / 9, 1);
    // aim the rig between the nose direction and the travel direction
    let ang = car.yaw;
    if (blend > 0) {
      let diff = heading - car.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ang = car.yaw + diff * 0.72 * blend;
    }
    const b = car.p.body;

    switch (this.mode) {
      case 'chase':
      case 'low': {
        const high = this.mode === 'chase';
        const dist = (high ? 8.4 : 6.6) + Math.min(speed * 0.11, 3.2);
        const hgt = high ? 3.5 : 1.75;
        v.set(car.x - Math.sin(ang) * dist, car.y + hgt, car.z - Math.cos(ang) * dist);
        const k = 1 - Math.exp(-dt * (high ? 6.5 : 8.5));
        this.pos.lerp(v, k);
        look.set(car.x + Math.sin(ang) * 6, car.y + 1.1, car.z + Math.cos(ang) * 6);
        this.target.lerp(look, 1 - Math.exp(-dt * 9));
        break;
      }
      case 'hood': {
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        this.pos.set(car.x + fx * (b.l * 0.34), car.y + b.hood + 0.62, car.z + fz * (b.l * 0.34));
        this.target.set(car.x + fx * 30, car.y + b.hood + 0.5, car.z + fz * 30);
        break;
      }
      case 'drone': {
        const dist = 26, h = 17;
        v.set(car.x - Math.sin(ang) * dist * 0.5, car.y + h, car.z - Math.cos(ang) * dist * 0.5);
        this.pos.lerp(v, 1 - Math.exp(-dt * 1.6));
        this.target.lerp(look.set(car.x, car.y + 0.6, car.z), 1 - Math.exp(-dt * 4));
        break;
      }
      case 'tv': {
        this.tvHold -= dt;
        if (this.tvCams.length) {
          let best = this.tvIndex, bestD = 1e9;
          for (let i = 0; i < this.tvCams.length; i++) {
            const d = this.tvCams[i].distanceToSquared(look.set(car.x, car.y, car.z));
            if (d < bestD) { bestD = d; best = i; }
          }
          if (best !== this.tvIndex && this.tvHold <= 0) { this.tvIndex = best; this.tvHold = 1.1; }
          this.pos.copy(this.tvCams[this.tvIndex]);
        }
        this.target.lerp(look.set(car.x, car.y + 0.8, car.z), 1 - Math.exp(-dt * 7));
        break;
      }
      case 'orbit': {
        if (mouse && mouse.down) {
          this.orbit.yaw -= mouse.dx * 0.005;
          this.orbit.pitch = Math.max(-0.2, Math.min(1.35, this.orbit.pitch + mouse.dy * 0.004));
        }
        if (mouse) this.orbit.dist = Math.max(5, Math.min(90, this.orbit.dist * (1 + mouse.wheel * 0.001)));
        const d = this.orbit.dist, cp = Math.cos(this.orbit.pitch);
        this.pos.set(car.x - Math.sin(this.orbit.yaw) * d * cp, car.y + Math.sin(this.orbit.pitch) * d + 1.5,
                     car.z - Math.cos(this.orbit.yaw) * d * cp);
        this.target.lerp(look.set(car.x, car.y + 0.8, car.z), 1 - Math.exp(-dt * 8));
        break;
      }
    }

    this.cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.28;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.shake *= 1 - Math.min(dt * 4.5, 1);
    }
    this.cam.lookAt(this.target);
    const wantFov = this.mode === 'hood' ? 74 : this.baseFov + Math.min(speed * 0.30, 16);
    this.cam.fov += (wantFov - this.cam.fov) * Math.min(dt * 3.5, 1);
    this.cam.updateProjectionMatrix();
  }
}
