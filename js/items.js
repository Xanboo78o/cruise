// items.js — boxes on the road, five things they can give you, and what those
// things do to whoever they're aimed at. Nothing here breaks a car: a zap stops
// you for a moment, a slick takes your grip, mega makes you the bully.

import * as THREE from 'three';

export const ITEM_INFO = {
  boost:  { label: 'NITRO',  icon: '⚡', color: 0x66c8ff, blurb: 'go' },
  slick:  { label: 'SLICK',  icon: '🛢', color: 0x222428, blurb: 'drop it behind you' },
  zap:    { label: 'ZAP',    icon: '⚡', color: 0xffe066, blurb: 'hits the car ahead' },
  shield: { label: 'SHIELD', icon: '🛡', color: 0x6fe3a0, blurb: 'nothing touches you' },
  mega:   { label: 'MEGA',   icon: '🍄', color: 0xff6b3d, blurb: 'you are the bully now' },
};
const TYPES = Object.keys(ITEM_INFO);

// what you get depends a little on where you are: leaders get bullied, the back gets rockets
function roll(rank01) {
  const r = Math.random();
  if (rank01 < 0.34) return r < 0.35 ? 'slick' : r < 0.6 ? 'shield' : r < 0.8 ? 'zap' : r < 0.92 ? 'boost' : 'mega';
  if (rank01 < 0.67) return r < 0.3 ? 'boost' : r < 0.55 ? 'zap' : r < 0.75 ? 'slick' : r < 0.9 ? 'shield' : 'mega';
  return r < 0.4 ? 'boost' : r < 0.65 ? 'zap' : r < 0.85 ? 'mega' : 'shield';
}

export class Items {
  constructor(model, scene) {
    this.model = model; this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.boxes = [];
    this.puddles = [];
    this.t = 0;
    this.place();
  }

  place() {
    const m = this.model, hw = m.halfWidth;
    const geo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
    const edges = new THREE.EdgesGeometry(geo);
    const step = 150, lanes = [-hw * 0.55, 0, hw * 0.55];
    // measured from the start line, not from s=0: at s=0 the first row landed
    // in the middle of the grid and everyone collected an item during the lights
    const startS = m.samples[Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length].s;
    for (let d0 = 130; d0 < m.length - 130; d0 += step) {
      const s = m.sampleAtDistance((startS + d0) % m.length);
      for (const lane of lanes) {
        const x = s.x + s.nx * lane, z = s.z + s.nz * lane;
        const y = m.heightAt(x, z) + 1.6;
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd98a }));
        mesh.add(line);
        mesh.position.set(x, y, z);
        this.group.add(mesh);
        this.boxes.push({ x, y, z, mesh, t: 0, phase: Math.random() * 6.28 });
      }
    }
  }

  // cars: [{car, rank01}] — rank01 0 = leader, 1 = last
  update(dt, cars) {
    this.t += dt;
    for (const b of this.boxes) {
      if (b.t > 0) { b.t -= dt; b.mesh.visible = b.t <= 0; if (b.t > 0) continue; }
      b.mesh.rotation.y += dt * 1.6; b.mesh.rotation.x += dt * 0.7;
      b.mesh.position.y = b.y + Math.sin(this.t * 2.2 + b.phase) * 0.25;
      const hue = (this.t * 0.15 + b.phase) % 1;
      b.mesh.material.color.setHSL(hue, 0.7, 0.75);
      for (const e of cars) {
        const c = e.car;
        if (c.item || c.itemCooldown > 0) continue;
        const dx = c.x - b.x, dz = c.z - b.z;
        if (dx * dx + dz * dz < 3.4 * 3.4) {
          c.item = roll(e.rank01 ?? 0.5);
          c.itemCooldown = 0.6;
          b.t = 7; b.mesh.visible = false;
          break;
        }
      }
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.t -= dt;
      p.mesh.material.opacity = Math.min(0.75, p.t * 0.5);
      if (p.t <= 0) { this.group.remove(p.mesh); this.puddles.splice(i, 1); }
    }
  }

  // grip multiplier for a point on the road (slicks)
  slickAt(x, z) {
    for (const p of this.puddles) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r) return 0.22;
    }
    return 1;
  }

  // fire whatever the car is holding. cars: all cars; progOf(car) = race progress
  use(car, cars, progOf) {
    const kind = car.item;
    if (!kind) return null;
    car.item = null;
    car.itemCooldown = 1.0;
    switch (kind) {
      case 'boost': car.boostT = Math.max(car.boostT, 2.4); break;
      case 'shield': car.shieldT = 7; break;
      case 'mega': car.megaT = 8; car.shieldT = Math.max(car.shieldT, 0.5); break;
      case 'slick': {
        const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
        const x = car.x - s * 4.5, z = car.z - c * 4.5;
        const r = 3.4;
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 16),
          new THREE.MeshBasicMaterial({ color: 0x15171c, transparent: true, opacity: 0.75, depthWrite: false }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, this.model.heightAt(x, z) + 0.12, z);
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.puddles.push({ x, z, r, t: 16, mesh });
        break;
      }
      case 'zap': {
        // the nearest car ahead on the road, within 110 m, that isn't shielded
        const me = progOf(car);
        let best = null, bestD = 110;
        for (const o of cars) {
          if (o === car || o.shieldT > 0) continue;
          let d = progOf(o) - me;
          if (this.model.closed && d < -this.model.length / 2) d += this.model.length;
          if (d > 0.5 && d < bestD) { bestD = d; best = o; }
        }
        if (best) { best.stunT = 1.7; best.r += (Math.random() < 0.5 ? -1 : 1) * 2.2; best.bumpT = 0.5; }
        else car.boostT = Math.max(car.boostT, 1.0);          // nobody ahead: a little kick for trying
        break;
      }
    }
    return kind;
  }

  clear() {
    for (const p of this.puddles) this.group.remove(p.mesh);
    this.puddles.length = 0;
    for (const b of this.boxes) { b.t = 0; b.mesh.visible = true; }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
