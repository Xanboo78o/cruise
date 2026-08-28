// world/freeroam.js — what main.js talks to when the "track" is the whole city.
// Same shape as a TrackModel where it matters (heightAt, surfaceAt, nearest,
// terrain, bounds, def), and a road-network minimap instead of a centreline.

import { WORLD, ROADS, ROAD_TYPES, DISTRICTS, POIS } from './spec.js';
import { WorldTerrain } from './terrain.js';
import { WorldBuilder } from './build.js';

export class FreeRoam {
  constructor() {
    this.T = new WorldTerrain();
    this.terrain = { height: (x, z) => this.heightAt(x, z), normal: (x, z, out = {}) => this.normal(x, z, out), bump: (x, z, surf) => this.bump(x, z, surf) };
    this.def = { id: 'sanoozi', name: 'SAN OOZI', sky: 'noon', startIndex: 0, closed: false, width: 30 };
    this.closed = false;
    this.halfWidth = 15;
    this.bounds = { minX: WORLD.minX, maxX: WORLD.maxX, minZ: WORLD.minZ, maxZ: WORLD.maxZ };
    this.length = 1;
    this.samples = [];                                   // nothing to lap
    this.line = []; this.profile = { v: [], state: [], brakes: [] };
    this.jumps = []; this.tunnels = []; this.whoops = [];
    this.roads = this.T.roads;
    this.pois = POIS;
    this.districts = DISTRICTS;
  }

  heightAt(x, z) { return this.T.height(x, z) + (this.ramps ? this.ramps.heightAdd(x, z) : 0); }
  surfaceAt(x, z) { return this.T.surfaceAt(x, z); }
  normal(x, z, out) {
    const e = 1.6;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z), hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    const nx = (hL - hR) / (2 * e), nz = (hD - hU) / (2 * e), inv = 1 / Math.hypot(nx, 1, nz);
    out.x = nx * inv; out.y = inv; out.z = nz * inv; return out;
  }
  bump(x, z, surf) {
    const amp = surf?.bump ?? 0; if (!amp) return 0;
    const s = Math.sin(x * 1.35) * Math.cos(z * 1.35);
    return s * amp * 0.5;
  }

  // "nearest" for the timing code and the driver: the nearest road, dressed
  // up as a centreline sample so nothing upstream has to know
  nearest(x, z) {
    const n = this.T.nearestRoad(x, z);
    if (!n) return { i: 0, lat: 0, along: 0, y: this.T.height(x, z), dist: 1e9, p: { x, z, y: 0, tx: 0, tz: 1, nx: 1, nz: 0, s: 0, k: 0, grade: 0 } };
    return { i: 0, lat: n.lat, along: 0, y: this.T.roadY(n.road, n.s), dist: n.d, road: n.road, s: n.s,
      p: { x: n.x, z: n.z, y: this.T.roadY(n.road, n.s), tx: n.tx, tz: n.tz, nx: n.nx, nz: n.nz, s: n.s, k: 0, grade: 0 } };
  }
  sampleAtDistance() { return { x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, s: 0 }; }

  // where you appear: Oozi Square, facing north
  spawn() {
    const p = POIS.find(q => q.id === 'square');
    return { x: p.x, z: p.z - 40, yaw: 0 };
  }

  buildWorld(scene, skyKey) {
    this.world = new WorldBuilder(this.T, scene, { sky: skyKey });
    return this.world;
  }

  // buildings stop you — a shove, no bounce, nothing breaks
  collide(car) {
    const walls = this.world && this.world.walls; if (!walls) return false;
    const r = 1.4;
    for (const [bx, bz, bw, bd] of walls) {
      const hx = bw / 2 + r, hz = bd / 2 + r;
      const dx = car.x - bx, dz = car.z - bz;
      if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue;
      const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
      if (ox < oz) { car.x = bx + Math.sign(dx || 1) * hx; const nx = Math.sign(dx || 1); const vn = car.vx * nx; if (vn < 0) car.vx -= vn * nx * 1.25; }
      else { car.z = bz + Math.sign(dz || 1) * hz; const nz = Math.sign(dz || 1); const vn = car.vz * nz; if (vn < 0) car.vz -= vn * nz * 1.25; }
      car.syncBody(); car.r *= 0.5; car.bumpT = Math.max(car.bumpT, 0.3);
      return true;
    }
    return false;
  }
}
