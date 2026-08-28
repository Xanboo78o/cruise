// race.js — the grid, the lights, the laps, the order, and the bumping.

const G = 9.81;

export class Race {
  // entrants: [{car, name, isPlayer}]
  constructor(model, entrants, laps = 3) {
    this.model = model;
    this.entrants = entrants.map(e => ({ ...e, lap: 0, prevS: 0, prog: 0, finished: false, time: null, pos: 0, best: null, lapStart: 0 }));
    this.laps = model.closed ? laps : 1;
    this.state = 'countdown';
    this.countdown = 3.4;
    this.t = 0;
    this.startS = model.samples[Math.floor((model.def.startIndex || 0) * model.samples.length) % model.samples.length].s;
    this.results = [];
    this.lastEvent = null;
  }

  // two-by-two behind the line, player at the back — that's the point
  grid() {
    const m = this.model;
    const order = [...this.entrants.filter(e => !e.isPlayer), ...this.entrants.filter(e => e.isPlayer)];
    order.forEach((e, i) => {
      const back = 12 + i * 9;
      const lat = (i % 2 ? 1 : -1) * Math.min(4.5, m.halfWidth * 0.32);
      const d = (this.startS - back + m.length) % m.length;
      const p = m.sampleAtDistance(m.closed ? d : Math.max(4, this.startS - back));
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      e.car.reset(x, z, Math.atan2(p.tx, p.tz), m.heightAt(x, z));
      e.prevS = p.s; e.lap = 0; e.prog = 0; e.finished = false; e.time = null;
      e.pos = i + 1;                                         // grid order until the lights go out
    });
  }

  update(dt) {
    const m = this.model, L = m.length;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.state = 'racing'; this.t = 0; this.lastEvent = 'go'; }
      return;
    }
    this.t += dt;
    for (const e of this.entrants) {
      const c = e.car;
      const nr = m.nearest(c.x, c.z);
      const s = m.samples[nr.i].s;
      if (m.closed) {
        const before = (e.prevS - this.startS + L) % L, after = (s - this.startS + L) % L;
        let step = s - e.prevS;
        if (step > L / 2) step -= L;
        if (step < -L / 2) step += L;
        if (step > 0 && before > L * 0.75 && after < L * 0.25 && !e.finished) {
          e.lap++;
          const lt = this.t - e.lapStart; e.lapStart = this.t;
          if (e.lap > 1 && (e.best == null || lt < e.best)) e.best = lt;
          if (e.lap >= this.laps) { e.finished = true; e.time = this.t; this.results.push(e); if (e.isPlayer) this.lastEvent = 'finish'; }
        }
        e.prevS = s;
        e.prog = e.lap * L + after;
      } else {
        e.prog = s;
        if (!e.finished && s > L - 10) { e.finished = true; e.time = this.t; this.results.push(e); if (e.isPlayer) this.lastEvent = 'finish'; }
      }
    }
    // standings: finished by time, then by progress
    const order = [...this.entrants].sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
    order.forEach((e, i) => e.pos = i + 1);
    const player = this.entrants.find(e => e.isPlayer);
    if (player && player.finished && this.state === 'racing') this.state = 'finished';
  }

  get player() { return this.entrants.find(e => e.isPlayer); }
  progOf(car) { const e = this.entrants.find(x => x.car === car); return e ? e.prog : 0; }
  standings() { return [...this.entrants].sort((a, b) => a.pos - b.pos); }
  get started() { return this.state !== 'countdown'; }
}

// Cars as discs on the road plane. Overlap -> push apart by mass, exchange the
// normal velocity with a little bounce, kick the yaw. Mega cars are heavy and
// big; shielded cars don't get the yaw kick. Nobody breaks.
export function collideCars(cars, onBump) {
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    const a = cars[i];
    const ra = 0.5 * Math.max(a.p.track + 0.5, 0.66 * (a.p.lf + a.p.lr)) * (a.mega ? 1.5 : 1);
    for (let j = i + 1; j < n; j++) {
      const b = cars[j];
      const rb = 0.5 * Math.max(b.p.track + 0.5, 0.66 * (b.p.lf + b.p.lr)) * (b.mega ? 1.5 : 1);
      let dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz, rr = ra + rb;
      if (d2 >= rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      dx /= d; dz /= d;
      const overlap = rr - d;
      const ma = a.massNow, mb = b.massNow, mt = ma + mb;
      a.x -= dx * overlap * (mb / mt); a.z -= dz * overlap * (mb / mt);
      b.x += dx * overlap * (ma / mt); b.z += dz * overlap * (ma / mt);
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const vn = rvx * dx + rvz * dz;
      if (vn < 0) {
        const e = 0.35;
        const jimp = -(1 + e) * vn / (1 / ma + 1 / mb);
        a.vx -= jimp * dx / ma; a.vz -= jimp * dz / ma;
        b.vx += jimp * dx / mb; b.vz += jimp * dz / mb;
        // yaw kick from where on the car it hit
        const sa = Math.sin(a.yaw), ca = Math.cos(a.yaw);
        const sideA = dx * ca - dz * sa;                       // hit on a's right (+) or left (-)
        const alongA = dx * sa + dz * ca;                      // front (+) or rear (-)
        const kick = Math.min(2.2, Math.abs(jimp) / 900);
        if (a.shieldT <= 0) a.r += -Math.sign(sideA || 1) * Math.sign(alongA || 1) * kick * (mb / mt) * 1.4;
        if (b.shieldT <= 0) b.r += Math.sign(sideA || 1) * Math.sign(alongA || 1) * kick * (ma / mt) * 1.4;
        a.bumpT = Math.max(a.bumpT, 0.4); b.bumpT = Math.max(b.bumpT, 0.4);
        if (onBump) onBump(a, b, Math.abs(jimp));
      }
      a.syncBody(); b.syncBody();
    }
  }
}
