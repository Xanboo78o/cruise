// world/cops.js — cause chaos and the COPs come. Chaos builds from bouncing
// Oo, shunting traffic and clipping props; over the line, a cop car in the
// traffic switches its lights on and chases. Lose it (300 m for ten seconds)
// or get pulled — it touches you under 20 mph, you stop for three seconds and
// pay a fine. Nobody's hurt. It's a game they play too.

import { Car } from '../car.js';
import { PRESETS } from '../presets.js';
import { AUTO_AIDS } from '../driver.js';

export class Cops {
  constructor(T, env) {
    this.T = T; this.env = env;
    this.chaos = 0;                 // 0..100
    this.chase = null;              // { car, mesh, t, lostT, pullT }
    this.cool = 0;
    this.pulled = 0;                // seconds left standing still
    this.fine = 0;
  }

  // call for each naughty thing: kind = 'oo' | 'traffic' | 'prop' | 'speed'
  add(kind, amount = 1) {
    if (this.chase || this.cool > 0) return;
    this.chaos = Math.min(100, this.chaos + ({ oo: 6, traffic: 14, prop: 3, speed: 2 }[kind] || 2) * amount);
  }

  // spawn the chaser somewhere behind the player on the nearest road
  start(player) {
    const nr = this.T.nearestRoad(player.x, player.z);
    const back = nr ? this.T.pointAt(nr.road, Math.max(0, Math.min(nr.road.L, nr.s - 90))) : { x: player.x - 90, z: player.z, tx: 0, tz: 1 };
    const car = new Car('cop', PRESETS);
    car.reset(back.x, back.z, Math.atan2(player.x - back.x, player.z - back.z), this.T.height(back.x, back.z) + 0.3);
    for (let i = 0; i < 40; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, this.env, AUTO_AIDS);
    car.shieldT = 1e9;                                       // the law is immune to your items
    this.chase = { car, mesh: null, t: 0, lostT: 0, siren: 0 };
    if (this.onStart) this.onStart(this.chase);
  }

  update(dt, player) {
    this.cool = Math.max(0, this.cool - dt);
    this.pulled = Math.max(0, this.pulled - dt);
    if (!this.chase) {
      this.chaos = Math.max(0, this.chaos - dt * 2.5);      // it blows over
      if (this.chaos >= 100 && this.cool <= 0) this.start(player);
      return null;
    }
    const ch = this.chase, c = ch.car;
    ch.t += dt; ch.siren += dt;
    // pursuit: aim at where you'll be
    const lead = 0.9;
    const tx = player.x + player.vx * lead, tz = player.z + player.vz * lead;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const right = dx * cy - dz * sy, fwd = dx * sy + dz * cy;
    const alpha = Math.atan2(right, Math.max(fwd, 1));
    let steer = Math.max(-1, Math.min(1, (2 * Math.sin(alpha) / Math.max(4, d)) * (c.p.lf + c.p.lr) / c.maxSteerNow(c.speed) * 1.3));
    if (fwd < 0 && d < 40) steer = Math.sign(right || 1);    // it's behind me: swing round
    const want = Math.min(c.p.vMax, player.speed + 8 + Math.min(20, d * 0.1));
    const dv = want - c.speed;
    const inp = { steer, throttle: dv > 0 ? Math.min(1, 0.4 + dv * 0.3) : 0, brake: dv < -3 ? Math.min(1, -dv * 0.2) : 0, handbrake: 0 };
    c.step(dt, inp, this.env, AUTO_AIDS);
    // losing them
    ch.lostT = d > 300 ? ch.lostT + dt : 0;
    if (ch.lostT > 10 || ch.t > 150) { this.end('lost'); return { event: 'lost' }; }
    // pulled: contact under 20 mph while they're on you
    if (d < 6 && player.speed < 9 && c.speed < 9 && ch.t > 4) {
      this.fine = 250 + Math.round(this.chaos * 3);
      this.pulled = 3;
      this.end('pulled');
      return { event: 'pulled', fine: this.fine };
    }
    return null;
  }

  end(how) {
    if (this.onEnd) this.onEnd(this.chase, how);
    this.chase = null; this.chaos = 0; this.cool = 25;
  }

  get car() { return this.chase ? this.chase.car : null; }
}
