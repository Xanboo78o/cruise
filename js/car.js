// car.js — arcade-sim drift physics.
// Bicycle model: two tires (front/rear), slip angles, a simplified Pacejka curve,
// longitudinal weight transfer, and a friction circle at the rear so throttle
// breaks traction. That combination is what makes a drift *hold* instead of snap.
// Engine torque goes through real gear ratios, so the box actually matters.

const G = 9.81;
const SUB = 1 / 240;           // physics substep — a spinning car needs the resolution
const MAX_YAW_RATE = 3.4;      // rad/s. ~195 deg/s is already a full-on spin

export const PRESETS = {
  silhouette: {
    label: 'SILHOUETTE', blurb: 'RWD coupe. The one to learn on.',
    mass: 1280, lf: 1.28, lr: 1.36, h: 0.52, izz: 1750,
    torque: 320, redline: 7600, brake: 12200, cd: 0.62,
    muF: 1.42, muR: 1.30, maxSteer: 0.62,
    gears: [3.6, 2.2, 1.55, 1.18, 0.95, 0.8], reverse: 3.4, finalDrive: 3.7,
    body: { w: 1.86, l: 4.42, hood: 0.66, roof: 1.24, color: 0xd94f4f, cabin: 0x1b2230, wheel: 0.34 },
  },
  kei: {
    label: 'KEI', blurb: 'Tiny and slow. Momentum is everything.',
    mass: 780, lf: 1.02, lr: 1.08, h: 0.56, izz: 900,
    torque: 92, redline: 8200, brake: 8200, cd: 0.80,
    muF: 1.30, muR: 1.14, maxSteer: 0.70,
    gears: [3.9, 2.35, 1.6, 1.2, 0.95], reverse: 3.6, finalDrive: 4.3,
    body: { w: 1.62, l: 3.30, hood: 0.72, roof: 1.42, color: 0xf0e4c4, cabin: 0x223040, wheel: 0.30 },
  },
  gt: {
    label: 'GT', blurb: 'Fast and planted. Best for brake-point drills.',
    mass: 1420, lf: 1.35, lr: 1.42, h: 0.46, izz: 2100,
    torque: 480, redline: 8000, brake: 15800, cd: 0.68,
    muF: 1.58, muR: 1.50, maxSteer: 0.54,
    gears: [3.2, 2.05, 1.5, 1.16, 0.94, 0.78], reverse: 3.1, finalDrive: 3.45,
    body: { w: 1.94, l: 4.62, hood: 0.60, roof: 1.14, color: 0x2f6fd0, cabin: 0x141a26, wheel: 0.35 },
  },
};

// Simplified Pacejka magic formula. Peaks near 8 deg of slip, then falls away —
// that fall-off is the whole reason a car can sit sideways at a steady angle.
const TB = 8.4, TC = 1.62, TD = 1.0, TE = 0.96;
function tireForce(alpha) {
  const b = TB * alpha;
  return TD * Math.sin(TC * Math.atan(b - TE * (b - Math.atan(b))));
}

export class Car {
  constructor(preset = 'silhouette') {
    this.setPreset(preset);
    this.reset(0, 0, 0);
  }

  setPreset(name) {
    this.presetName = name;
    this.p = PRESETS[name];
    this.L = this.p.lf + this.p.lr;
  }

  reset(x, z, yaw, y = 0) {
    this.x = x; this.z = z; this.y = y; this.yaw = yaw;
    this.vx = 0; this.vz = 0;          // world velocity
    this.r = 0;                        // yaw rate (+ = nose swings right)
    this.u = 0; this.v = 0;            // body-frame velocity (long, lateral+right)
    this.ax = 0; this.ay = 0; this.axTire = 0;
    this.steer = 0;                    // actual road-wheel angle, rad
    this.slipF = 0; this.slipR = 0;
    this.rearSlide = 0;                // rear tire scrub speed — drives smoke/marks
    this.frontSlide = 0;
    this.gear = 1; this.rpm = 900; this.engineLoad = 0;
    this.pitch = 0; this.roll = 0; this.wheelSpin = 0;
    this.odo = 0; this.spun = false;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get driftAngle() {                   // degrees between where it points and where it goes
    if (this.speed < 1.5) return 0;
    return Math.atan2(this.v, Math.abs(this.u)) * 180 / Math.PI;
  }

  // inp: {throttle, brake, steer, handbrake}. surf: {grip, drag, accel}.
  // stability: 0 = raw, 1 = forgiving.
  step(dt, inp, surf, stability = 0.35) {
    dt = Math.min(dt, 0.05);
    this.updateSteer(dt, inp, stability);
    this.updateGearbox(this.u);
    const n = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.integrate(h, inp, surf, stability);
    this.finish(dt, inp);
  }

  updateSteer(dt, inp, stability) {
    const p = this.p, speed = this.speed;
    const speedEase = 1 - 0.56 * Math.min(speed / 42, 1);   // less lock at speed
    let target = inp.steer * p.maxSteer * speedEase;
    // countersteer help: when the rear is out, let the wheels reach into the slide
    if (stability > 0 && Math.abs(this.slipR) > 0.14 && speed > 4) {
      const need = -Math.sign(this.slipR) * Math.min(Math.abs(this.slipR), 0.55);
      const w = 0.34 * stability * Math.min(Math.abs(this.slipR) / 0.4, 1);
      target += (need - target) * w;
    }
    // Winding lock ON is deliberate; unwinding and catching a slide are quick.
    // A single fast rate makes the keyboard a switch, a single slow one means you
    // can never catch anything.
    const diff = target - this.steer;
    const unwinding = Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer);
    const rate = (unwinding ? 9.0 : 4.2 + 2.5 * Math.abs(diff)) * dt;
    this.steer += Math.max(-rate, Math.min(rate, diff));
  }

  integrate(h, inp, surf, stability) {
    const p = this.p;
    let u = this.u, v = this.v;
    const speed = Math.hypot(u, v);
    const d = this.steer;

    // --- longitudinal weight transfer, from tire force only (not the rotating-frame term)
    const wt = Math.max(-0.42, Math.min(0.42, this.axTire * p.h / (this.L * G)));
    const FzF = p.mass * G * (p.lr / this.L - wt);
    const FzR = p.mass * G * (p.lf / this.L + wt);

    const muF = p.muF * surf.grip;
    const muR = p.muR * surf.grip * (inp.handbrake > 0.5 ? 0.42 : 1);

    // --- slip angles. clamp the denominator so it doesn't explode at walking pace
    const uc = Math.max(Math.abs(u), 2.2);
    this.slipF = Math.atan2(v + this.r * p.lf, uc) - d;
    this.slipR = Math.atan2(v - this.r * p.lr, uc);

    let FyF = -muF * FzF * tireForce(this.slipF);
    let FyR = -muR * FzR * tireForce(this.slipR);

    // --- drivetrain: torque x gear x final drive / wheel radius
    let drive = 0;
    if (inp.throttle > 0.01 && inp.brake < 0.9) {
      const ratio = u < -0.4 && this.gear === 1 ? -p.reverse : p.gears[this.gear - 1];
      const rev = Math.min(this.rpm / p.redline, 1.06);
      const curve = 0.62 + 0.66 * rev - 0.32 * rev * rev;    // fat midrange, soft top end
      drive = inp.throttle * p.torque * curve * Math.abs(ratio) * p.finalDrive / p.body.wheel;
      drive *= surf.accel;
      if (u < -0.4) drive = 0;                              // rolling backwards: brake first, then go
    }
    let brakeF = 0;
    if (inp.brake > 0.01) {
      if (u > 0.5) brakeF = -inp.brake * p.brake;
      else drive = -inp.brake * p.torque * p.reverse * p.finalDrive / p.body.wheel * 0.8;  // reverse
    }
    if (inp.handbrake > 0.5 && u > 0.5) brakeF -= p.brake * 0.34;

    // --- friction circle at the rear: drive spends grip first, lateral gets the rest.
    // This is the power-oversteer knob — stomp it mid-corner and the tail steps out.
    const FxR = drive + brakeF * 0.42;
    const capR = Math.max(1, muR * FzR);
    const usedR = Math.abs(FxR);
    let spin = 0;
    if (usedR > capR * 0.98) { FyR *= 0.12; spin = Math.min((usedR / capR - 1) * 2, 1); }
    else FyR *= Math.sqrt(Math.max(0, 1 - (usedR / capR) ** 2));
    const FxF = brakeF * 0.58;
    const capF = Math.max(1, muF * FzF);
    if (Math.abs(FxF) < capF) FyF *= Math.sqrt(Math.max(0, 1 - (FxF / capF) ** 2));
    else FyF *= 0.15;
    this.wheelSpin = spin;

    // --- sum forces in body frame
    let Fx = FxR + FxF * Math.cos(d) - FyF * Math.sin(d);
    let Fy = FyR + FyF * Math.cos(d);
    this.axTire = Fx / p.mass;                       // feeds next substep's weight transfer
    Fx -= p.cd * surf.drag * u * Math.abs(u);        // aero
    Fx -= 14 * surf.drag * u;                        // rolling
    if (surf.slope) Fx -= p.mass * G * surf.slope;   // gravity down a gradient
    Fy -= 3.2 * v;                                   // scrub damping, kills jitter

    let torque = p.lf * FyF * Math.cos(d) - p.lr * FyR;
    torque -= this.r * (150 + 700 * stability);      // yaw damping = the stability slider
    // a car past ~100 deg of slip is a spinning top, not a drift — bleed it down hard
    if (Math.abs(this.r) > 2.0) torque -= this.r * (Math.abs(this.r) - 2.0) * 900;

    // --- integrate
    const du = Fx / p.mass + this.r * v;
    const dv = Fy / p.mass - this.r * u;
    u += du * h; v += dv * h;
    this.r += (torque / p.izz) * h;
    this.r = Math.max(-MAX_YAW_RATE, Math.min(MAX_YAW_RATE, this.r));

    // creep-to-stop: below walking pace kill the sideways slop so it parks cleanly
    if (speed < 3) {
      const k = 1 - Math.min(speed / 3, 1);
      const f = Math.min(h * 12, 1);
      v *= 1 - 0.9 * k * f;
      this.r *= 1 - 0.85 * k * f;
      if (speed < 0.25 && inp.throttle < 0.02 && inp.brake < 0.02) { u = 0; v = 0; this.r = 0; }
    }

    this.ax = du; this.ay = dv;
    this.u = u; this.v = v;
    this.yaw += this.r * h;
    this.vx = u * Math.sin(this.yaw) + v * Math.cos(this.yaw);
    this.vz = u * Math.cos(this.yaw) - v * Math.sin(this.yaw);
    this.x += this.vx * h;
    this.z += this.vz * h;
  }

  finish(dt, inp) {
    this.odo += Math.abs(this.u) * dt;
    // body attitude — pure cosmetics, but it sells the weight
    const tPitch = Math.max(-0.09, Math.min(0.09, -this.ax * 0.006));
    const tRoll = Math.max(-0.11, Math.min(0.11, this.ay * 0.007));
    this.pitch += (tPitch - this.pitch) * Math.min(dt * 9, 1);
    this.roll += (tRoll - this.roll) * Math.min(dt * 9, 1);
    // how hard each end is scrubbing — smoke, marks and sound all read from these
    const speed = this.speed;
    this.rearSlide = Math.abs(Math.sin(this.slipR)) * Math.min(speed, 40) +
      (inp.handbrake > 0.5 && speed > 3 ? 6 : 0) + this.wheelSpin * Math.min(speed * 0.6, 10);
    this.frontSlide = Math.abs(Math.sin(this.slipF)) * Math.min(speed, 40);
    this.engineLoad = inp.throttle;
    this.spun = Math.abs(this.driftAngle) > 100 && speed > 4;
  }

  updateGearbox(u) {
    const p = this.p, sp = Math.abs(u);
    if (u < -0.4) { this.gear = 1; this.rpm = Math.max(900, this.rpmFor(sp, 0) * 0.9); return; }
    let g = 0;
    for (let i = 0; i < p.gears.length; i++) {
      g = i;
      if (this.rpmFor(sp, i) < p.redline * 0.94) break;
    }
    // don't hunt: hold the current gear while it still pulls
    const cur = this.gear - 1;
    if (g < cur && this.rpmFor(sp, cur) > p.redline * 0.42) g = cur;
    this.gear = g + 1;
    this.rpm = Math.max(900, Math.min(p.redline * 1.02, this.rpmFor(sp, g)));
  }

  rpmFor(sp, gearIdx) {
    const p = this.p;
    return (sp / (p.body.wheel * 2 * Math.PI)) * p.gears[gearIdx] * p.finalDrive * 60;
  }

  // world-space position of a wheel contact patch (for skid marks / smoke)
  wheelPos(front, right) {
    const p = this.p;
    const along = front ? p.lf * 0.92 : -p.lr * 0.92;
    const side = (right ? 1 : -1) * p.body.w * 0.44;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { x: this.x + along * s + side * c, z: this.z + along * c - side * s };
  }
}
