// tools/turn.mjs [car=hachi] [aids=0.35] — the car's cornering, measured. Speed is
// FORCED (the velocity is rescaled to the target every step, direction kept), so
// the yaw dynamics run but scrub can't bleed the speed away. Two numbers per
// speed: the radius at full stick, and the tightest radius the tyres will hold
// without the rear stepping out (rear slip < 6°, front < 10°) — the "room to spare".
// Adam: "I should be able to do a hairpin at 40 with room to spare" (40 on the
// dial = 80 real, DIAL 0.5). The world's hairpins: ~10 m centreline, 16-22 m wide.
import { Car } from '../js/car.js';
import { PRESETS } from '../js/presets.js';
const [carId = 'hachi', aidsArg = '0.35'] = process.argv.slice(2);
const aids = +aidsArg, MS = 2.23694;
const env = { terrain: { height: () => 0, bump: () => 0, normal: (x, z, o = {}) => { o.x = 0; o.y = 1; o.z = 0; return o; } },
  surfaceAt: () => ({ name: 'road', grip: 1, bump: 0.003, drag: 1, accel: 1, slope: 0 }) };
function run(v, steer, secs = 8) {
  const car = new Car(carId, PRESETS);
  car.reset(0, 0, 0, 0); car.vz = v;
  const dt = 1 / 120; let t = 0, rs = 0, n = 0, sF = 0, sR = 0, maxR = 0;
  while (t < secs) {
    car.step(dt, { throttle: 0.4, brake: 0, steer, handbrake: 0 }, env, aids);
    const sp = Math.hypot(car.vx, car.vz) || 1; car.vx *= v / sp; car.vz *= v / sp;   // forced speed
    t += dt;
    if (t > secs - 3) { rs += Math.abs(car.r); n++; sF += Math.abs(car.slipF || 0); sR += Math.abs(car.slipR || 0); maxR = Math.max(maxR, Math.abs(car.slipR || 0)); }
  }
  const r = rs / n, R = r > 1e-4 ? v / r : 1e9;
  return { R, g: v * v / R / 9.81, sF: sF / n * 57.3, sR: sR / n * 57.3, maxR: maxR * 57.3 };
}
console.log(`${carId} at aids ${aids} — speed forced, 8 s, last 3 s averaged`);
console.log(' real | dial |  FULL STICK: R m   g  slipF slipR |  GRIP-LIMITED: stick  R m    g');
for (const mph of [20, 30, 40, 60, 80, 100, 120]) {
  const v = mph / MS;
  const full = run(v, 1);
  // largest stick that still grips: bisect
  let lo = 0.02, hi = 1, best = null;
  for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2, o = run(v, mid, 6); if (o.maxR < 6 && o.sF < 10) { lo = mid; best = { ...o, stick: mid }; } else hi = mid; }
  console.log(` ${mph.toString().padStart(4)} | ${(mph * 0.5).toString().padStart(4)} |  ${full.R.toFixed(1).padStart(6)} ${full.g.toFixed(2).padStart(5)} ${full.sF.toFixed(0).padStart(5)}° ${full.sR.toFixed(0).padStart(4)}° |  ${best ? best.stick.toFixed(2) + '  ' + best.R.toFixed(1).padStart(6) + '  ' + best.g.toFixed(2) : 'none holds'}`);
}
