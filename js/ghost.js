// ghost.js — your best lap, replayed as a translucent car, plus a pace car that
// drives the ideal line at whatever percentage you set. Chasing something is the
// fastest way to learn a line.

const KEY = 'cruise.best.v1';

export class LapRecorder {
  constructor() { this.frames = []; this.t = 0; this.acc = 0; }
  reset() { this.frames.length = 0; this.t = 0; this.acc = 0; }
  sample(dt, car) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 0.05) return;                 // 20 Hz is plenty for a ghost
    this.acc = 0;
    this.frames.push(this.t, car.x, car.y, car.z, car.yaw);
  }
}

export class GhostPlayer {
  constructor(frames) { this.frames = frames || []; }
  get valid() { return this.frames.length >= 10; }
  at(t) {
    const f = this.frames;
    if (f.length < 10) return null;
    const n = f.length / 5;
    let lo = 0, hi = n - 1;
    while (lo < hi) {                            // binary search on time
      const mid = (lo + hi) >> 1;
      if (f[mid * 5] < t) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const t0 = f[(i - 1) * 5], t1 = f[i * 5];
    const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const g = (o) => f[(i - 1) * 5 + o] + (f[i * 5 + o] - f[(i - 1) * 5 + o]) * a;
    let y0 = f[(i - 1) * 5 + 4], y1 = f[i * 5 + 4];
    let dy = y1 - y0;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return { x: g(1), y: g(2), z: g(3), yaw: y0 + dy * a, done: t > f[f.length - 5] };
  }
}

// Follows the solved line at a fraction of the profile speed. It never makes a
// mistake, which is the point — it's a moving reference, not a rival.
export class PaceCar {
  constructor(model, pace = 0.85) {
    this.m = model; this.pace = pace;
    this.s = 0; this.speed = 0; this.i = 0;
  }
  reset(s = 0) { this.s = s; this.speed = 6; }
  step(dt) {
    const m = this.m, n = m.line.length;
    const i = Math.floor((this.s / m.length) * n) % n;
    this.i = (i + n) % n;
    const target = m.profile.v[this.i] * this.pace;
    this.speed += Math.max(-26 * dt, Math.min(9 * dt, (target - this.speed) * 2.4 * dt + (target - this.speed) * 0.02));
    this.speed = Math.max(3, this.speed);
    this.s += this.speed * dt;
    if (this.s > m.length) this.s -= m.length;
    if (this.s < 0) this.s += m.length;
    const p = m.line[this.i];
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.yaw = Math.atan2(p.tx, p.tz);
    return this;
  }
}

export const Best = {
  load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  },
  save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode, fine */ }
  },
  get(track, carId) {
    const all = this.load();
    return all[`${track}|${carId}`] || null;
  },
  set(track, carId, time, frames) {
    const all = this.load();
    all[`${track}|${carId}`] = { time, frames };
    this.save(all);
  },
};
