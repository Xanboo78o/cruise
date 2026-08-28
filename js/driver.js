// driver.js — the autopilot. Pure pursuit for steering, and a proper
// look-down-the-road brake solver for speed: for every point in the next 200 m
// it asks "how fast can I be here and still make that?" and takes the minimum.
// Used by AUTOPILOT, by the pace car, and by tools/sim.mjs.

export const AUTO_AIDS = 1.0;      // the robot gets ABS, TC and the full yaw hand

export function autoDrive(car, model, pace = 0.85, out = {}, lane = 0) {
  const n = model.line.length;
  const spacing = model.length / n;
  const nr = model.nearest(car.x, car.z);
  const speed = car.speed;

  // --- how far off the line are we? A long way off means recover first.
  const li = nr.i;
  const lp = model.line[li];
  const off = (car.x - lp.x) * lp.nx + (car.z - lp.z) * lp.nz - lane;
  const lost = Math.abs(off) > model.halfWidth * 1.6;

  // --- pure pursuit. Off the line, aim CLOSER, not further: a distant target
  // makes the correction weaker exactly when it needs to be stronger, which is
  // how it used to drive off into the scenery and never come back.
  let look = Math.max(6, Math.min(42, 6.5 + speed * 0.75));
  if (lost) look = Math.max(5, Math.min(look, Math.abs(off) * 0.7));
  const ai = (li + Math.max(1, Math.round(look / spacing))) % n;
  const t = model.line[ai];
  const dx = t.x + t.nx * lane - car.x, dz = t.z + t.nz * lane - car.z;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const right = dx * cy - dz * sy, fwd = dx * sy + dz * cy;
  const dist = Math.max(2, Math.hypot(dx, dz));
  const alpha = Math.atan2(right, fwd);
  const dMax = car.maxSteerNow(speed);                    // the car's own steering map
  let steer, spun = false;

  if (fwd < 2) {
    // The target is beside or behind us — a spin, or we drove off and turned
    // around. Pure pursuit reads sin(alpha) ~ 0 here and calmly steers straight
    // ahead into the scenery, so it doesn't get a vote: full lock, crawl round.
    steer = Math.sign(right || 1);
    spun = true;
  } else {
    const kappa = 2 * Math.sin(alpha) / dist;               // curvature to the point
    let delta = Math.atan(kappa * (car.p.lf + car.p.lr));   // road-wheel angle wanted
    // catch the slide: point the wheels where the car is actually going
    // Countersteer is mostly yaw-rate damping (below), not angle: an angle
    // term through rate-limited steering over-corrects and tank-slaps on exit.
    const ang = car.driftAngle;
    if (Math.abs(ang) > 10 && speed > 6) {
      const counter = Math.sign(ang) * Math.min(Math.abs(ang) * Math.PI / 180, 0.5) * 0.22 / (1 + speed / 50);
      delta += counter;
    }
    steer = delta / dMax;
    const pursuit = steer;
    // lane correction, scaled by speed: a fixed gain that is right at 30 mph
    // weaves the car at a full g at 80, and a weaving car cannot brake
    const laneGain = 0.06 * Math.min(1, 14 / Math.max(speed, 1));
    steer -= off * laneGain;                                // pure pursuit lags; this closes the gap
    // yaw-rate feedback against what the line wants: catches a pull (a locked
    // inside wheel, a bump, a gust of oversteer) before it becomes an angle
    const rWant = speed * model.line[li].k;               // what the road wants HERE, not 40 m on
    steer -= (car.r - rWant) * 0.24 / (1 + speed / 40);   // gentler hands at speed
    out.dbg = { pursuit, offTerm: -off * laneGain, yawTerm: -(car.r - rWant) * 0.24, rWant, alpha, dist };
    steer = Math.max(-1, Math.min(1, steer));           // the curvature cap does the rest
    steer = Math.max(-0.92, Math.min(0.92, steer));
  }

  // --- speed: the tightest constraint anywhere in the next 200 m wins.
  // Braking shares the tyre with cornering (friction circle), so on a curved
  // approach the car can only shed speed with what the corner leaves over —
  // and the solver has to know that, or a hairpin at the end of a bend arrives
  // 15 mph too fast every single time.
  // what this car can really pull: rubber, minus what body roll and load
  // sensitivity throw away. A tall narrow car on soft tyres is not a formula car.
  const ty = car.p.tyre;
  const muAvg = (ty.muF + ty.muR) * 0.5;
  const handling = 1 - ty.loadSens * 2.2 * (car.p.cgH / car.p.track);
  const aMax = 9.81 * muAvg * handling * 0.78;                             // usable, not theoretical
  const aLatCar = 9.81 * muAvg * handling * 0.94;
  const gripScale = Math.min(1.05, Math.sqrt(aLatCar / (model.def.profile?.aLat ?? 12.4)));
  pace *= gripScale;
  const brakeAt = (j) => {
    const vj = model.profile.v[j] * pace;
    const aLat = vj * vj * Math.abs(model.line[j].k);
    return Math.sqrt(Math.max(1.2, aMax * aMax - aLat * aLat)) * 0.62;   // brake early, arrive calm
  };
  let target = model.profile.v[li] * pace;
  const horizon = Math.min(n - 1, Math.round(220 / spacing));
  // walk the horizon backwards so each step uses the local braking capacity
  let vAllow = model.profile.v[(li + horizon) % n] * pace;
  for (let k = horizon - 1; k >= 0; k--) {
    const j = (li + k) % n;
    if (!model.closed && li + k >= n) { vAllow = 1e9; continue; }
    const vj = model.profile.v[j] * pace;
    vAllow = Math.min(vj, Math.sqrt(vAllow * vAllow + 2 * brakeAt(j) * spacing));
  }
  target = Math.min(target, vAllow);
  target *= 0.97;
  // the profile is for a car ON the line; off it, the corner is tighter than the plan
  target *= 1 - 0.3 * Math.min(1, Math.abs(off) / model.halfWidth);
  if (lost) target = Math.min(target, 14);
  if (spun) target = Math.min(target, 9);
  // scrubbing sideways? ease off until it hooks back up
  if (Math.abs(car.driftAngle) > 30) target = Math.min(target, speed * 0.92);

  const dv = target - speed;
  let throttle = dv > 0.2 ? Math.min(1, 0.25 + dv * 0.34) : 0;
  // Corner exit: feed it in. Going from a trailing throttle to the floor while
  // the car is still sideways is a tank-slapper every time.
  const ang = Math.abs(car.driftAngle);
  throttle = Math.min(throttle, Math.max(0.15, 1 - ang / 28));
  if (out.prevThrottle != null) throttle = Math.max(out.prevThrottle - 0.045, Math.min(throttle, out.prevThrottle + 0.03));
  out.prevThrottle = throttle;                               // no snap-lifts at 130 mph either
  let brake = dv < -0.6 ? Math.min(1, (-dv - 0.6) * 0.34) : 0;
  // Brake in a straight line. Braking mid-corner unloads the rear and, on a car
  // set up to oversteer, that's a spin every time — which is exactly how this
  // used to end up in the barriers on corner entry.
  // trail-brake with whatever the friction circle leaves over. Budget from the
  // corner the line is actually in, not from the yaw rate — a twitch on a
  // straight must not read as "cornering hard, no brakes for you"
  const aLatPlan = speed * speed * Math.abs(model.line[li].k);
  brake *= Math.sqrt(Math.max(0.04, 1 - (aLatPlan / aMax) ** 2));
  if (Math.abs(car.driftAngle) > 12 && speed > 6) { brake = 0; throttle = Math.min(throttle, 0.2); }
  // off the tarmac or recovering: no heroics, just get back on — and stay
  // gentle for a moment after rejoining, the car is still pointing wherever
  const offRoad = car.wheels[2].grip < 0.8 && car.wheels[3].grip < 0.8;
  out.rejoinT = offRoad ? 1.5 : Math.max(0, (out.rejoinT ?? 0) - 1 / 120);
  if (lost || spun || offRoad || out.rejoinT > 0) throttle = Math.min(throttle, 0.45);
  out.steer = steer;
  out.throttle = throttle;
  out.brake = brake;
  out.handbrake = 0;
  out.target = target;
  out.off = off;
  return out;
}
