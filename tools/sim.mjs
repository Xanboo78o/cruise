// Drive every track with the autopilot, no browser. Checks the car can get
// round, how close it stays to the road, and what it laps in.
import { TrackModel } from '../js/track.js';
import { TRACKS, TRACK_ORDER } from '../js/tracks.js';
import { Car } from '../js/car.js';
import { PRESETS, CAR_ORDER } from '../js/presets.js';
import { autoDrive, AUTO_AIDS } from '../js/driver.js';

const MS = 2.23694;
const pace = +(process.argv[2] === 'quick' ? 0.85 : (process.argv[2] || 0.85));
const QUICK = process.argv[2] === 'quick';           // every track x 4 cars, every car x seawall

const REP = ['hachi', 'gt', 'truck', 'kart'];
for (const id of (process.argv[4] ? [process.argv[4]] : TRACK_ORDER)) {
  const m = new TrackModel(TRACKS[id]);
  const env = { terrain: m.terrain, surfaceAt: (x, z) => m.surfaceAt(x, z) };
  const carsHere = process.argv[3] && !QUICK ? [process.argv[3]] : QUICK ? (id === 'seawall' ? CAR_ORDER : REP) : CAR_ORDER;
  for (const carId of carsHere) {
    const car = new Car(carId, PRESETS);
    const s0 = m.samples[Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length];
    car.reset(s0.x, s0.z, Math.atan2(s0.tx, s0.tz), m.heightAt(s0.x, s0.z));
    for (let i = 0; i < 90; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, 0.35);
    const dt = 1 / 120;
    let t = 0, prev = s0.s, dist = 0, laps = [], lapT = 0, offT = 0, worstLat = 0, maxSlip = 0, spins = 0, air = 0, stuck = 0, resets = 0;
    const limit = m.closed ? 240 : 200;
    while (t < limit) {
      const nr = m.nearest(car.x, car.z);
      const surf = m.surfaceAt(car.x, car.z, nr);
      car.step(dt, autoDrive(car, m, pace), env, AUTO_AIDS);
      if (car.airborne) air += dt;
      stuck = (car.speed < 1.5 || (surf.grip < 0.7 && Math.abs(nr.lat) > m.halfWidth + 12)) ? stuck + dt : 0;
      if (stuck > 2.5) {                                   // same rule as the game's autopilot
        const q = m.samples[nr.i];
        car.reset(q.x, q.z, Math.atan2(q.tx, q.tz), m.heightAt(q.x, q.z));
        for (let i = 0; i < 60; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, AUTO_AIDS);
        stuck = 0; resets++;
      }
      t += dt; lapT += dt;
      if (surf.grip < 0.9) offT += dt;
      worstLat = Math.max(worstLat, Math.abs(nr.lat));
      maxSlip = Math.max(maxSlip, Math.abs(car.driftAngle));
      if (car.spun) spins++;
      const d = m.samples[nr.i].s;
      let step = d - prev;
      if (step > m.length * 0.5) step -= m.length;
      if (step < -m.length * 0.5) step += m.length;
      prev = d; dist += step;
      if (m.closed && dist > m.length) { laps.push(lapT); lapT = 0; dist -= m.length; if (laps.length >= 3) break; }
      if (!m.closed && d > m.length - 10) { laps.push(lapT); break; }
    }
    const best = laps.length ? Math.min(...laps) : null;
    console.log(`${m.def.name.padEnd(12)} ${PRESETS[carId].label.padEnd(11)}` +
      ` laps ${laps.length}` +
      ` best ${best ? best.toFixed(2) + 's' : 'DNF'}` +
      ` | avg ${best ? (m.length / best * MS).toFixed(0) : '--'} mph` +
      ` | off-road ${(offT / t * 100).toFixed(1)}%` +
      ` | worst lateral ${worstLat.toFixed(1)}m (half-width ${m.halfWidth})` +
      ` | slip ${maxSlip.toFixed(0)} spins ${spins} air ${air.toFixed(1)}s resets ${resets}`);
  }
}
