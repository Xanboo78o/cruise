// Drive every track with the autopilot, no browser. Checks the car can get
// round, how close it stays to the road, and what it laps in.
import { TrackModel } from '../js/track.js';
import { TRACKS, TRACK_ORDER } from '../js/tracks.js';
import { Car, PRESETS } from '../js/car.js';
import { autoDrive } from '../js/driver.js';

const MS = 2.23694;
const pace = +(process.argv[2] || 0.9);

for (const id of TRACK_ORDER) {
  const m = new TrackModel(TRACKS[id]);
  for (const carId of Object.keys(PRESETS)) {
    const car = new Car(carId);
    const s0 = m.samples[Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length];
    car.reset(s0.x, s0.z, Math.atan2(s0.tx, s0.tz), s0.y);
    const dt = 1 / 120;
    let t = 0, prev = s0.s, dist = 0, laps = [], lapT = 0, offT = 0, worstLat = 0, maxSlip = 0, spins = 0;
    const limit = m.closed ? 240 : 200;
    while (t < limit) {
      const nr = m.nearest(car.x, car.z);
      const surf = m.surfaceAt(car.x, car.z, nr);
      car.step(dt, autoDrive(car, m, pace), surf, 0.35);
      car.y = nr.p.y;
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
      ` | peak slip ${maxSlip.toFixed(0)}deg spins ${spins}`);
  }
}
