// bots.js — the grid. Each bot is a real Car on the same physics, driven by the
// autopilot with its own pace, its own lane, a bit of rubber-band, some
// elbows, and an itchy item finger.

import { Car } from './car.js';
import { PRESETS, CAR_ORDER } from './presets.js';
import { autoDrive, AUTO_AIDS } from './driver.js';

export class Bots {
  constructor(model, count, excludeId, opts = {}) {
    this.model = model;
    this.list = [];
    const pool = CAR_ORDER.filter(id => id !== excludeId).sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const id = pool[i % pool.length];
      const car = new Car(id, PRESETS);
      this.list.push({
        id, car, mesh: null, name: PRESETS[id].label,
        pace: 0.84 + Math.random() * 0.12,                // some are quick, some are Sunday drivers
        lane: (Math.random() - 0.5) * model.halfWidth * 0.8,
        laneWant: 0, laneT: 0,
        out: {}, itemT: 0, cap: 1, prog: 0,
      });
    }
    this.rubber = opts.rubber ?? 0.08;
  }

  // one physics step for every bot. cars: every car incl. the player, for avoidance.
  // progOf(car): progress along the race. playerProg: for rubber-banding.
  step(dt, env, allCars, progOf, playerProg, items, frozen) {
    const m = this.model, hw = m.halfWidth;
    for (const b of this.list) {
      const c = b.car;
      if (frozen) { c.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, AUTO_AIDS); continue; }

      // --- lane: drift toward a new lane every few seconds, and toward the
      // side with more room when someone is right ahead
      b.laneT -= dt;
      if (b.laneT <= 0) { b.laneT = 3 + Math.random() * 4; b.laneWant = (Math.random() - 0.5) * hw * 0.9; }
      let cap = 1;
      const myProg = progOf(c);
      for (const o of allCars) {
        if (o === c) continue;
        let ahead = progOf(o) - myProg;
        if (m.closed && ahead > m.length / 2) ahead -= m.length;
        if (m.closed && ahead < -m.length / 2) ahead += m.length;
        if (ahead < 1 || ahead > 26) continue;
        // lateral gap in the road frame
        const nr = m.nearest(o.x, o.z), nm = m.nearest(c.x, c.z);
        const gap = nr.lat - nm.lat;
        if (Math.abs(gap) < 3.2) {
          const closing = c.speed - o.speed;
          if (closing > 0 || ahead < 9) cap = Math.min(cap, ahead < 8 ? 0.35 : 0.7);
          // pick the side with more road
          const roomL = -hw + 2.5 - nr.lat, roomR = hw - 2.5 - nr.lat;
          b.laneWant = Math.abs(roomL) > Math.abs(roomR) ? nr.lat - 4.2 : nr.lat + 4.2;
          b.laneWant = Math.max(-hw + 2.5, Math.min(hw - 2.5, b.laneWant));
        }
      }
      b.lane += (b.laneWant - b.lane) * Math.min(1, dt * 1.2);

      // --- rubber-band: mild. Behind the player, a little quicker; ahead, a little lazier.
      let pace = b.pace;
      if (playerProg != null) {
        let gap = playerProg - myProg;
        if (m.closed && gap > m.length / 2) gap -= m.length;
        if (m.closed && gap < -m.length / 2) gap += m.length;
        pace += this.rubber * Math.max(-1, Math.min(1, gap / 120));
      }

      const o = autoDrive(c, m, pace, b.out, b.lane);
      o.throttle = Math.min(o.throttle, cap);
      if (c.stunT > 0) { o.throttle = 0; }
      c.step(dt, o, env, AUTO_AIDS);

      // --- items: hold it for a beat, then use it when it makes sense
      if (c.item) {
        b.itemT += dt;
        const ready = b.itemT > 1 + Math.random() * 2;
        let go = false;
        if (c.item === 'zap') go = ready && allCars.some(x => { if (x === c) return false; let d = progOf(x) - myProg; if (m.closed && d < -m.length / 2) d += m.length; return d > 2 && d < 100; });
        else if (c.item === 'slick') go = ready && allCars.some(x => { if (x === c) return false; let d = myProg - progOf(x); if (m.closed && d < -m.length / 2) d += m.length; return d > 3 && d < 45; });
        else go = ready;
        if (go && items) { items.use(c, allCars, progOf); b.itemT = 0; }
      } else b.itemT = 0;
    }
  }

  get cars() { return this.list.map(b => b.car); }
}
