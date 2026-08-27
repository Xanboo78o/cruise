// driver.js — the autopilot. Pure pursuit for steering, and a proper
// look-down-the-road brake solver for speed: for every point in the next 200 m
// it asks "how fast can I be here and still make that?" and takes the minimum.
// Used by AUTOPILOT, by the pace car, and by tools/sim.mjs.

export function autoDrive(car, model, pace = 0.85, out = {}) {
  const n = model.line.length;
  const spacing = model.length / n;
  const nr = model.nearest(car.x, car.z);
  const speed = car.speed;

  // --- how far off the line are we? A long way off means recover first.
  const li = nr.i;
  const lp = model.line[li];
  const off = (car.x - lp.x) * lp.nx + (car.z - lp.z) * lp.nz;
  const lost = Math.abs(off) > model.halfWidth * 1.6;

  // --- pure pursuit. Off the line, aim CLOSER, not further: a distant target
  // makes the correction weaker exactly when it needs to be stronger, which is
  // how it used to drive off into the scenery and never come back.
  let look = Math.max(6, Math.min(42, 6.5 + speed * 0.75));
  if (lost) look = Math.max(5, Math.min(look, Math.abs(off) * 0.7));
  const ai = (li + Math.max(1, Math.round(look / spacing))) % n;
  const t = model.line[ai];
  const dx = t.x - car.x, dz = t.z - car.z;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const right = dx * cy - dz * sy, fwd = dx * sy + dz * cy;
  const dist = Math.max(2, Math.hypot(dx, dz));
  const alpha = Math.atan2(right, fwd);
  const ease = 1 - 0.56 * Math.min(speed / 42, 1);
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
    const ang = car.driftAngle;
    if (Math.abs(ang) > 8 && speed > 6) {
      const counter = Math.sign(ang) * Math.min(Math.abs(ang) * Math.PI / 180, 0.5) * 0.5;
      delta += counter;
    }
    steer = delta / (car.p.maxSteer * ease);
    steer -= car.r * 0.09;                                  // settle the yaw oscillation
    steer = Math.max(-0.92, Math.min(0.92, steer));
  }

  // --- speed: the tightest constraint anywhere in the next 200 m wins
  const aBrake = 5.6;                                       // lift early; this is a cruise, not a qualy lap
  // the profile is a property of the track; this car may have less grip than it
  // assumes, so scale the whole target by how much rubber it actually has
  const aLatCar = 9.81 * (car.p.muF + car.p.muR) * 0.5 * 0.94;
  const gripScale = Math.min(1.05, Math.sqrt(aLatCar / (model.def.profile?.aLat ?? 12.4)));
  pace *= gripScale;
  let target = model.profile.v[li] * pace;
  const horizon = Math.min(n - 1, Math.round(200 / spacing));
  for (let k = 1; k <= horizon; k++) {
    const j = (li + k) % n;
    if (!model.closed && j < li) break;
    const d = k * spacing;
    const vj = model.profile.v[j] * pace;
    const allow = Math.sqrt(vj * vj + 2 * aBrake * d);
    if (allow < target) target = allow;
  }
  target *= 0.97;
  if (lost) target = Math.min(target, 14);
  if (spun) target = Math.min(target, 9);
  // scrubbing sideways? ease off until it hooks back up
  if (Math.abs(car.driftAngle) > 30) target = Math.min(target, speed * 0.92);

  const dv = target - speed;
  let throttle = dv > 0.2 ? Math.min(1, 0.25 + dv * 0.34) : 0;
  let brake = dv < -0.6 ? Math.min(1, (-dv - 0.6) * 0.34) : 0;
  // Brake in a straight line. Braking mid-corner unloads the rear and, on a car
  // set up to oversteer, that's a spin every time — which is exactly how this
  // used to end up in the barriers on corner entry.
  brake *= 1 - 0.65 * Math.min(Math.abs(steer), 1);
  if (Math.abs(car.driftAngle) > 12 && speed > 6) { brake = 0; throttle = Math.min(throttle, 0.2); }
  out.steer = steer;
  out.throttle = throttle;
  out.brake = brake;
  out.handbrake = 0;
  out.target = target;
  out.off = off;
  return out;
}
