// world/arrival.js — how you get here. A saucer comes in over the sea, crosses
// the city, hovers over Oozi Square and sets your car down. One planet of
// many. Twelve seconds, skippable, and it only plays the first time.

import * as THREE from 'three';

const v = new THREE.Vector3(), look = new THREE.Vector3();

export class Arrival {
  constructor(scene, T, drop, duration = 12) {
    this.scene = scene; this.T = T; this.drop = drop; this.duration = duration;
    this.t = 0; this.done = false;
    this.ship = this.buildShip();
    scene.add(this.ship);
    const d = drop;
    // the ship's path: far out to sea, over the harbour, to a hover above the square
    this.path = [
      new THREE.Vector3(d.x + 900, 260, d.z - 3200),
      new THREE.Vector3(d.x + 300, 180, d.z - 1500),
      new THREE.Vector3(d.x + 40, 110, d.z - 400),
      new THREE.Vector3(d.x, 48, d.z),
      new THREE.Vector3(d.x, 48, d.z),
      new THREE.Vector3(d.x - 200, 140, d.z + 900),
      new THREE.Vector3(d.x - 900, 400, d.z + 3000),
    ];
    this.curve = new THREE.CatmullRomCurve3(this.path, false, 'centripetal');
  }

  buildShip() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 12), new THREE.MeshLambertMaterial({ color: 0xc9ccd4 }));
    hull.scale.set(1, 0.32, 1); g.add(hull);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.6, 18, 10), new THREE.MeshLambertMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.8 }));
    dome.position.y = 2.2; g.add(dome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.5, 8, 36), new THREE.MeshLambertMaterial({ color: 0x3a3d44 }));
    ring.rotation.x = Math.PI / 2; g.add(ring);
    this.lamps = [];
    for (let i = 0; i < 12; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      const a = i / 12 * Math.PI * 2; l.position.set(Math.cos(a) * 9.2, -0.8, Math.sin(a) * 9.2); g.add(l); this.lamps.push(l);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 8, 48, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = -26; beam.visible = false; g.add(beam); this.beam = beam;
    const glow = new THREE.PointLight(0x9fe8ff, 2.5, 120); glow.position.y = -4; g.add(glow);
    return g;
  }

  // returns the car's position while it's being lowered (or null)
  update(dt, camera) {
    if (this.done) return null;
    this.t += dt;
    const t01 = Math.min(1, this.t / this.duration);
    // the ship: eases into the hover between 0.45 and 0.62, then leaves
    let u;
    if (t01 < 0.45) u = (t01 / 0.45) * 0.5;
    else if (t01 < 0.62) u = 0.5 + (t01 - 0.45) / 0.17 * 0.02;
    else u = 0.52 + (t01 - 0.62) / 0.38 * 0.48;
    this.curve.getPoint(Math.min(1, u), v);
    this.ship.position.copy(v);
    this.ship.rotation.y = this.t * 0.6;
    this.ship.rotation.z = Math.sin(this.t * 0.8) * 0.06;
    for (let i = 0; i < this.lamps.length; i++) this.lamps[i].material.color.setHex(((i + Math.floor(this.t * 8)) % 3) ? 0xffe066 : 0xffffff);
    // the drop: between 0.45 and 0.62 the beam is on and the car descends
    let carY = null;
    const gy = this.T.height(this.drop.x, this.drop.z);
    if (t01 >= 0.42 && t01 < 0.64) {
      this.beam.visible = true;
      const k = Math.max(0, Math.min(1, (t01 - 0.46) / 0.14));
      carY = gy + (1 - k * k) * 40 + 0.3;
    } else this.beam.visible = false;
    // the camera: a wide shot from the harbour front, rising, then round the square
    const d = this.drop;
    if (t01 < 0.4) {
      camera.position.set(d.x + 140, 70 + t01 * 60, d.z - 700 + t01 * 300);
      look.copy(this.ship.position);
    } else if (t01 < 0.7) {
      const a = (t01 - 0.4) / 0.3 * Math.PI * 0.9;
      camera.position.set(d.x + Math.cos(a) * 60, gy + 14, d.z + Math.sin(a) * 60 - 20);
      look.set(d.x, gy + 8 + (carY != null ? (carY - gy) * 0.4 : 0), d.z);
    } else {
      const k = (t01 - 0.7) / 0.3;
      camera.position.set(d.x - Math.sin(d.yaw) * (9 + (1 - k) * 30), gy + 3.5 + (1 - k) * 12, d.z - Math.cos(d.yaw) * (9 + (1 - k) * 30));
      look.set(d.x + Math.sin(d.yaw) * 6, gy + 1.1, d.z + Math.cos(d.yaw) * 6);
    }
    camera.lookAt(look);
    camera.fov = 62 + Math.sin(t01 * Math.PI) * 10; camera.updateProjectionMatrix();
    if (t01 >= 1) this.finish();
    return carY;
  }

  finish() { this.done = true; this.scene.remove(this.ship); }
  skip() { this.finish(); }
}
