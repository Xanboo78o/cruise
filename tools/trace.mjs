// Timeline of one car on one track under the autopilot. Prints a line every
// half second and flags the first moment it leaves the road or spins, so a
// bad sim number can be turned into "T5, 41 mph, rear unloaded" in one run.
import { TrackModel } from '../js/track.js';
import { TRACKS } from '../js/tracks.js';
import { Car } from '../js/car.js';
import { PRESETS } from '../js/presets.js';
import { autoDrive, AUTO_AIDS } from '../js/driver.js';

const [carId = 'silhouette', trackId = 'harbor', pace = '0.9', secs = '60'] = process.argv.slice(2);
const MS = 2.23694;
const m = new TrackModel(TRACKS[trackId]);
const env = { terrain: m.terrain, surfaceAt: (x, z) => m.surfaceAt(x, z) };
const car = new Car(carId, PRESETS);
const s0 = m.samples[Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length];
car.reset(s0.x, s0.z, Math.atan2(s0.tx, s0.tz), m.heightAt(s0.x, s0.z));
for (let i = 0; i < 90; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, AUTO_AIDS);
const dt = 1 / 120;
let t = 0, wasOff = false, wasSpun = false, events = 0;
const o = {};
const line = (tag) => {
  const nr = m.nearest(car.x, car.z);
  const w = car.wheels;
  const R = Math.abs(m.samples[nr.i].k) > 1e-6 ? (1 / Math.abs(m.samples[nr.i].k)).toFixed(0) : 'str';
  console.log(`${tag.padEnd(5)} t=${t.toFixed(1).padStart(5)} s=${m.samples[nr.i].s.toFixed(0).padStart(5)}m R=${String(R).padStart(4)} ` +
    `lat=${nr.lat.toFixed(1).padStart(5)} spd=${(car.speed * MS).toFixed(0).padStart(3)} tgt=${((o.target || 0) * MS).toFixed(0).padStart(3)} ` +
    `st=${(o.steer || 0).toFixed(2).padStart(5)} thr=${(o.throttle || 0).toFixed(2)} brk=${(o.brake || 0).toFixed(2)} ` +
    `ang=${car.driftAngle.toFixed(0).padStart(4)} r=${car.r.toFixed(2).padStart(5)} g${car.gear} ` +
    `ld F=${(w[0].load + w[1].load).toFixed(0).padStart(5)} R=${(w[2].load + w[3].load).toFixed(0).padStart(5)} ` +
    `kR=${w[2].kappa.toFixed(2)},${w[3].kappa.toFixed(2)} syF=${w[0].sy.toFixed(2)} syR=${w[2].sy.toFixed(2)} ` +
    `pitch=${car.pitch.toFixed(2)} ${car.airborne ? 'AIR' : ''} ${w[0].surf?.name || ''}`);
};
while (t < +secs) {
  autoDrive(car, m, +pace, o);
  car.step(dt, o, env, AUTO_AIDS);
  t += dt;
  const nr = m.nearest(car.x, car.z);
  const off = Math.abs(nr.lat) > m.halfWidth;
  if (off && !wasOff && events++ < 12) line('OFF');
  if (car.spun && !wasSpun && events++ < 12) line('SPIN');
  wasOff = off; wasSpun = car.spun;
  if (Math.round(t * 120) % 60 === 0) line('');
}
