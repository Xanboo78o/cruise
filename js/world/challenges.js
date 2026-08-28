// world/challenges.js — the things scattered through San Oozi that aren't
// races. Speed traps, drift zones, stunt jumps, collectible figurines, photo
// spots. Each one is a place with a rule; the world draws its marker, the
// player trips it, progress.js keeps the score. Hand-placed, every one.

import * as THREE from 'three';

export const CHALLENGES = [
  // speed traps: a camera on a post; score = speed through it
  { id: 'trapRing', kind: 'trap', name: 'RING CAMERA', x: 600, z: 260, dir: [1, 0], medal: [90, 110, 130, 150] },
  { id: 'trapRim', kind: 'trap', name: 'RIM CAMERA', x: 60, z: 900, dir: [0, 1], medal: [80, 100, 120, 140] },
  { id: 'trapCoast', kind: 'trap', name: 'SEAWALL CAMERA', x: -150, z: -1630, dir: [1, 0], medal: [85, 105, 125, 145] },
  { id: 'trapBlvd', kind: 'trap', name: 'BOULEVARD CAMERA', x: -300, z: -780, dir: [1, 0], medal: [70, 90, 110, 130] },
  { id: 'trapRunway', kind: 'trap', name: 'RUNWAY CAMERA', x: 2350, z: 700, dir: [1, 0], medal: [100, 120, 140, 160] },
  // drift zones: from a to b along a road; score = sum of angle * speed while sideways
  { id: 'driftHarbor', kind: 'drift', name: 'HARBOR FRONT DRIFT', a: [-560, -1280], b: [560, -1280], medal: [800, 1600, 2600, 4000] },
  { id: 'driftTouge', kind: 'drift', name: 'TOUGE DRIFT', a: [-1000, 800], b: [-1250, 1300], medal: [1200, 2400, 3600, 5000] },
  { id: 'driftDocks', kind: 'drift', name: 'DOCKS DRIFT', a: [1100, -1600], b: [1950, -1600], medal: [900, 1800, 2800, 4200] },
  { id: 'driftBeach', kind: 'drift', name: 'SAND DRIFT', a: [-2150, -1600], b: [-650, -1680], medal: [1000, 2000, 3200, 4600] },
  // stunt jumps: a ramp; score = air distance in metres
  { id: 'jumpPier', kind: 'jump', name: 'PIER END', x: -1400, z: -1990, dir: [0, -1], w: 12, h: 3.6, len: 26, medal: [20, 35, 50, 70] },
  { id: 'jumpRim', kind: 'jump', name: 'CANYON RIM', x: 470, z: 1160, dir: [-1, 0], w: 14, h: 4.5, len: 30, medal: [30, 50, 70, 95] },
  { id: 'jumpDowntown', kind: 'jump', name: 'CAR PARK ROOF', x: 250, z: -1160, dir: [0, 1], w: 12, h: 5.0, len: 34, medal: [25, 40, 60, 80] },
  { id: 'jumpDocks', kind: 'jump', name: 'DOCK CRANE', x: 1400, z: -1520, dir: [1, 0], w: 12, h: 3.2, len: 24, medal: [18, 30, 45, 60] },
  { id: 'jumpAir', kind: 'jump', name: 'RUNWAY KICKER', x: 2500, z: 1000, dir: [-1, 0], w: 16, h: 4.0, len: 32, medal: [30, 50, 75, 100] },
  // photo spots: stop inside the circle and look; one medal, one photo
  { id: 'photoLookout', kind: 'photo', name: 'THE LOOKOUT', x: -1550, z: 1640, r: 18 },
  { id: 'photoPier', kind: 'photo', name: 'PIER END', x: -1400, z: -1960, r: 12 },
  { id: 'photoCanyon', kind: 'photo', name: 'CANYON TOP', x: 300, z: 2100, r: 16 },
  { id: 'photoSquare', kind: 'photo', name: 'OOZI SQUARE', x: 0, z: -910, r: 16 },
  { id: 'photoCampfire', kind: 'photo', name: 'CAMPFIRE', x: -2500, z: -650, r: 14 },
  { id: 'photoCliffs', kind: 'photo', name: 'WEST CLIFFS', x: -2700, z: -1360, r: 14 },
];

// figurines: thirty little Oo statues to find. Some on roads, most not.
export const FIGURINES = [
  [-1550, 1660], [-1400, -2010], [300, 2120], [-2500, -640], [-2700, -1340], [0, -910], [40, -1240], [-380, -520],
  [560, -1040], [1250, -1520], [1900, -1480], [2350, -150], [2300, 850], [2700, 1010], [860, 790], [1080, 640],
  [-1200, -580], [-950, -1150], [1200, -980], [880, -780], [-1700, -1600], [1750, -1600], [-2100, -600], [-2800, 150],
  [-1650, 880], [-1600, 1200], [120, 1700], [640, 520], [2650, -800], [-1400, -1470],
];

export class ChallengeWorld {
  constructor(T, scene, progress) {
    this.T = T; this.scene = scene; this.progress = progress;
    this.group = new THREE.Group(); scene.add(this.group);
    this.live = { drift: null, jump: null };
    this.figs = [];
    this.build();
  }

  build() {
    const T = this.T;
    const post = new THREE.CylinderGeometry(0.14, 0.18, 5, 6), postM = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
    const camG = new THREE.BoxGeometry(0.8, 0.5, 0.9), camM = new THREE.MeshLambertMaterial({ color: 0xe8e4d8 });
    const flash = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    for (const c of CHALLENGES) {
      if (c.kind === 'trap') {
        const y = T.height(c.x, c.z);
        const side = c.dir[0] ? [0, 1] : [1, 0];
        const nr = T.nearestRoad(c.x, c.z); const hw = nr ? nr.road.T.w / 2 + 2 : 12;
        const p = new THREE.Mesh(post, postM); p.position.set(c.x + side[0] * hw, y + 2.5, c.z + side[1] * hw); this.group.add(p);
        const cam = new THREE.Mesh(camG, camM); cam.position.set(c.x + side[0] * hw, y + 5.1, c.z + side[1] * hw); cam.rotation.y = Math.atan2(-side[0], -side[1]); this.group.add(cam);
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), flash); lens.position.copy(cam.position); lens.position.x -= side[0] * 0.5; lens.position.z -= side[1] * 0.5; this.group.add(lens);
        c.lens = lens; c.flashT = 0;
        // the line on the road
        const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.8), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6 }));
        line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(c.dir[0], c.dir[1]); line.position.set(c.x, y + 0.14, c.z); this.group.add(line);
      } else if (c.kind === 'drift') {
        // painted start and end gates
        for (const [x, z] of [c.a, c.b]) {
          const y = T.height(x, z); const nr = T.nearestRoad(x, z); const hw = nr ? nr.road.T.w / 2 : 11;
          const g = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.2), new THREE.MeshBasicMaterial({ color: 0x59b8ff, transparent: true, opacity: 0.55 }));
          g.rotation.x = -Math.PI / 2; g.rotation.z = nr ? Math.atan2(nr.tx, nr.tz) : 0; g.position.set(x, y + 0.14, z); this.group.add(g);
        }
      } else if (c.kind === 'jump') {
        // a ramp: a wedge of the given height and length pointing along dir, with chevrons
        const y = T.height(c.x, c.z);
        const geo = new THREE.BufferGeometry();
        const [dx, dz] = c.dir, nx = dz, nz = -dx, w = c.w / 2;
        const v = [];
        const P = (a, b, h) => v.push(c.x + dx * a + nx * b, y + h, c.z + dz * a + nz * b);
        P(0, -w, 0); P(0, w, 0); P(c.len, -w, c.h); P(c.len, w, c.h);       // deck 0..3
        P(c.len, -w, 0); P(c.len, w, 0);                                     // base back 4,5
        geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        geo.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 0, 4, 2, 1, 3, 5]);
        geo.computeVertexNormals();
        const ramp = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3a3d44, side: THREE.DoubleSide })); ramp.castShadow = true; this.group.add(ramp);
        for (let k = 1; k <= 3; k++) {
          const band = new THREE.Mesh(new THREE.PlaneGeometry(c.w * 0.8, 1), new THREE.MeshBasicMaterial({ color: 0xf5c145, side: THREE.DoubleSide }));
          const a = c.len * k / 4, hh = c.h * k / 4;
          band.position.set(c.x + dx * a, y + hh + 0.06, c.z + dz * a);
          band.rotation.set(-Math.PI / 2 + Math.atan(c.h / c.len), Math.atan2(dx, dz), 0, 'YXZ');
          this.group.add(band);
        }
        c.y0 = y;
      } else if (c.kind === 'photo') {
        const y = T.height(c.x, c.z);
        const ring = new THREE.Mesh(new THREE.RingGeometry(c.r - 0.5, c.r, 40), new THREE.MeshBasicMaterial({ color: 0xff6b8f, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, y + 0.15, c.z); this.group.add(ring);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 5), postM); post.position.set(c.x, y + 1.1, c.z); this.group.add(post);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.08), new THREE.MeshBasicMaterial({ color: 0xff6b8f })); sign.position.set(c.x, y + 2.5, c.z); this.group.add(sign);
      }
    }
    // figurines: a little gold Oo (a cone + sphere) on a plinth
    const figG = new THREE.Group();
    const gold = new THREE.MeshLambertMaterial({ color: 0xffd25a, emissive: 0x4a3600 });
    FIGURINES.forEach(([x, z], i) => {
      if (this.progress.has('fig', i)) return;
      const y = T.height(x, z);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 8), gold); body.position.y = 1.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), gold); head.position.y = 2.1;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.5, 8), postM); plinth.position.y = 0.25;
      g.add(plinth, body, head); g.position.set(x, y, z);
      g.userData = { i, x, z };
      this.group.add(g); this.figs.push(g);
    });
    this.t = 0;
  }

  // trip everything the player is doing right now. Returns an event or null.
  update(dt, car, cam) {
    this.t += dt;
    let ev = null;
    for (const f of this.figs) { f.rotation.y = this.t * 1.5; f.position.y = this.T.height(f.userData.x, f.userData.z) + Math.sin(this.t * 3 + f.userData.i) * 0.15; }
    // figurines
    for (let i = this.figs.length - 1; i >= 0; i--) {
      const f = this.figs[i];
      if ((car.x - f.userData.x) ** 2 + (car.z - f.userData.z) ** 2 < 3.2 * 3.2) {
        this.progress.collect('fig', f.userData.i);
        this.group.remove(f); this.figs.splice(i, 1);
        ev = { kind: 'fig', name: 'FIGURINE ' + this.progress.count('fig') + ' / ' + FIGURINES.length, cash: 150 };
      }
    }
    for (const c of CHALLENGES) {
      if (c.kind === 'trap') {
        // crossing the line in the trap's direction
        const along = (car.x - c.x) * c.dir[0] + (car.z - c.z) * c.dir[1];
        const side = Math.abs((car.x - c.x) * c.dir[1] - (car.z - c.z) * c.dir[0]);
        if (c.prevAlong != null && c.prevAlong < 0 && along >= 0 && side < 16 && car.speed > 4) {
          const mph = car.speed * 2.237;
          const medal = this.progress.medalFor(c, mph);
          this.progress.result(c.id, mph, medal);
          c.flashT = 0.4;
          ev = { kind: 'trap', name: c.name, value: mph.toFixed(0) + ' MPH', medal, cash: medal * 120 };
        }
        c.prevAlong = along;
        if (c.flashT > 0) { c.flashT -= dt; c.lens.material.color.setHex(Math.sin(this.t * 60) > 0 ? 0xffffff : 0xffe066); } else c.lens.material.color.setHex(0xffe066);
      } else if (c.kind === 'drift') {
        const da = Math.hypot(car.x - c.a[0], car.z - c.a[1]), db = Math.hypot(car.x - c.b[0], car.z - c.b[1]);
        if (!this.live.drift && da < 14 && car.speed > 6) this.live.drift = { c, score: 0, t: 0 };
        if (this.live.drift && this.live.drift.c === c) {
          const L = this.live.drift; L.t += dt;
          const ang = Math.abs(car.driftAngle);
          if (ang > 12 && car.speed > 6) L.score += ang * car.speed * dt * 0.12;
          if (db < 14 || L.t > 60) {
            const medal = this.progress.medalFor(c, L.score);
            this.progress.result(c.id, L.score, medal);
            ev = { kind: 'drift', name: c.name, value: L.score.toFixed(0) + ' PTS', medal, cash: medal * 150 };
            this.live.drift = null;
          }
        }
      } else if (c.kind === 'jump') {
        // airborne after the lip, heading roughly along dir
        const [dx, dz] = c.dir;
        const along = (car.x - c.x) * dx + (car.z - c.z) * dz, side = Math.abs((car.x - c.x) * dz - (car.z - c.z) * dx);
        const fwd = Math.sin(car.yaw) * dx + Math.cos(car.yaw) * dz;
        if (!this.live.jump && car.airborne && along > c.len - 2 && along < c.len + 8 && side < c.w && fwd > 0.6) this.live.jump = { c, x0: car.x, z0: car.z };
        if (this.live.jump && this.live.jump.c === c && !car.airborne) {
          const d = Math.hypot(car.x - this.live.jump.x0, car.z - this.live.jump.z0);
          const medal = this.progress.medalFor(c, d);
          this.progress.result(c.id, d, medal);
          ev = { kind: 'jump', name: c.name, value: d.toFixed(0) + ' M', medal, cash: medal * 200 };
          this.live.jump = null;
        }
      } else if (c.kind === 'photo') {
        const d = Math.hypot(car.x - c.x, car.z - c.z);
        if (d < c.r && car.speed < 0.8) {
          c.still = (c.still || 0) + dt;
          if (c.still > 1.2 && !this.progress.has('photo', c.id)) {
            this.progress.collect('photo', c.id);
            this.progress.result(c.id, 1, 4);
            ev = { kind: 'photo', name: c.name, value: 'PHOTO', medal: 4, cash: 300 };
          }
        } else c.still = 0;
      }
    }
    return ev;
  }

  // the ramps are real: the wheels need to feel them
  heightAdd(x, z) {
    for (const c of CHALLENGES) {
      if (c.kind !== 'jump') continue;
      const [dx, dz] = c.dir;
      const along = (x - c.x) * dx + (z - c.z) * dz, side = Math.abs((x - c.x) * dz - (z - c.z) * dx);
      if (along >= 0 && along <= c.len && side <= c.w / 2) return c.h * Math.pow(along / c.len, 1.6);
    }
    return 0;
  }

  dispose() { this.scene.remove(this.group); }
}
