// car.js — four wheels, four springs, four contact patches.
//
// The body is a sprung mass with heave, pitch and roll; each corner has a
// spring/damper standing on whatever the terrain height field says is under it.
// Load transfer isn't a formula any more — it falls out of the springs, which is
// why the car takes a moment to settle and why a crest unloads it.
//
// Each tyre gets its own slip angle AND slip ratio, so wheelspin, lockups and
// the way they eat into cornering grip are all emergent. Wheels leave the ground
// on crests, the car flies, and it lands on its springs.
//
// What is deliberately NOT modelled: crashing. Nothing breaks, nothing flips.

const G = 9.81;
const SUB = 1 / 300;          // physics substep
const REL = 0.4;              // tyre relaxation length, m

// Normalised combined-slip tyre curve. Peaks at 0.17 of combined slip (~10 deg
// of slip angle) and falls to 0.74 by a full slide — that fall-off is what lets
// a drift sit at a steady angle instead of snapping back or spinning.
const TB = 9.0, TC = 1.62, TE = 0.72;
function tyreCurve(s) {
  const b = TB * s;
  return Math.sin(TC * Math.atan(b - TE * (b - Math.atan(b))));
}

class Wheel {
  constructor(car, index) {
    const p = car.p;
    this.i = index;
    this.front = index < 2;
    this.right = index % 2 === 1;
    this.a = this.front ? p.lf : -p.lr;                  // longitudinal offset
    this.b = (this.right ? 1 : -1) * p.track * 0.5;      // lateral offset (+ = right)
    this.radius = this.front ? p.tyre.rf : p.tyre.rr;
    this.inertia = p.tyre.inertia * (this.radius / 0.34) ** 2;
    this.reset();
  }
  reset() {
    this.omega = 0; this.kappa = 0; this.sy = 0;
    this.load = 0; this.x = 0; this.z = 0; this.y = 0;
    this.disp = 0; this.dispV = 0; this.contact = true; this.gPrev = undefined;
    this.slide = 0; this.spin = 0; this.steer = 0; this.grip = 1;
  }
}

export class Car {
  constructor(preset, presets) {
    this.PRESETS = presets;
    this.setPreset(preset);
    this.reset(0, 0, 0);
  }

  setPreset(name) {
    this.presetName = name;
    this.p = this.PRESETS[name];
    const p = this.p;
    this.L = p.lf + p.lr;
    this.izz = p.mass * (this.L * this.L + p.track * p.track) / 12 * (p.inertiaScale ?? 1.15);
    this.ipitch = p.mass * this.L * this.L * 0.19;
    this.iroll = p.mass * p.track * p.track * 0.16;
    this.wheels = [0, 1, 2, 3].map(i => new Wheel(this, i));
    // static corner loads
    const fFront = p.lr / this.L, fRear = p.lf / this.L;
    for (const w of this.wheels) w.staticLoad = p.mass * G * (w.front ? fFront : fRear) * 0.5;
  }

  reset(x, z, yaw, y = 0) {
    this.x = x; this.z = z; this.y = y; this.yaw = yaw;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.r = 0; this.u = 0; this.v = 0;
    this.ax = 0; this.ay = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    this.steer = 0;
    this.gear = 1; this.rpm = this.p.idle; this.engineLoad = 0;
    this.rearSlide = 0; this.frontSlide = 0; this.wheelSpin = 0;
    this.airborne = false; this.airTime = 0; this.bestAir = 0; this.landing = 0;
    this.odo = 0; this.spun = false;
    this.slipR = 0; this.slipF = 0;
    for (const w of this.wheels) w.reset();
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get driftAngle() {
    if (this.speed < 1.5) return 0;
    return Math.atan2(this.v, Math.abs(this.u)) * 180 / Math.PI;
  }

  // env: { terrain, surfaceAt(x, z) }   inp: {throttle, brake, steer, handbrake}
  // aids: 0 = nothing, 1 = ABS + traction control + a firm hand on the yaw
  step(dt, inp, env, aids = 0.35) {
    dt = Math.min(dt, 0.05);
    this.updateSteer(dt, inp, aids);
    // surfaces are sampled once per frame, not per substep — they don't change
    // fast enough to matter and nearest() isn't free
    for (const w of this.wheels) {
      const wp = this.wheelWorld(w);
      w.surf = env.surfaceAt(wp.x, wp.z);
      w.grip = w.surf.grip;
    }
    const n = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.integrate(h, inp, env, aids);
    this.finish(dt, inp);
  }

  wheelWorld(w) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { x: this.x + w.a * s + w.b * c, z: this.z + w.a * c - w.b * s };
  }

  updateSteer(dt, inp, aids) {
    const p = this.p, speed = this.speed;
    const ease = 1 - (p.steerFalloff ?? 0.56) * Math.min(speed / 42, 1);
    let target = inp.steer * p.maxSteer * ease;
    if (aids > 0 && Math.abs(this.slipR) > 0.14 && speed > 4) {
      const need = -Math.sign(this.slipR) * Math.min(Math.abs(this.slipR), 0.55);
      target += (need - target) * 0.34 * aids * Math.min(Math.abs(this.slipR) / 0.4, 1);
    }
    const diff = target - this.steer;
    const unwinding = Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer);
    const rate = (unwinding ? 9.0 : 4.2 + 2.5 * Math.abs(diff)) * dt;
    this.steer += Math.max(-rate, Math.min(rate, diff));
  }

  integrate(h, inp, env, aids) {
    const p = this.p, T = env.terrain;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);

    // ---------------------------------------------------------- suspension
    let Fsum = 0, Mpitch = 0, Mroll = 0, contacts = 0;
    for (const w of this.wheels) {
      const wx = this.x + w.a * sy + w.b * cy;
      const wz = this.z + w.a * cy - w.b * sy;
      w.x = wx; w.z = wz;
      const gS = T.height(wx, wz);                         // smooth field: road + hills
      const gB = T.bump(wx, wz, w.surf);                    // tyre-scale texture
      const gV = w.gPrev === undefined ? 0 : (gS - w.gPrev) / h;
      w.gPrev = gS;
      w.ground = gS + gB;
      // displacement of this corner of the body from its static height
      const disp = (this.y + this.pitch * w.a + this.roll * w.b) - w.ground;
      w.disp = disp;
      // damper velocity from the body's own motion against the SMOOTH ground —
      // the micro-bumps only load the spring, or every pebble is a hammer blow
      w.dispV = this.vy + this.pitchV * w.a + this.rollV * w.b - gV;
      const k = w.front ? p.susp.kf : p.susp.kr;
      const c = (w.dispV < 0 ? (w.front ? p.susp.cf : p.susp.cr) : (w.front ? p.susp.cfr : p.susp.crr));
      let F = w.staticLoad - k * disp - c * w.dispV;
      // anti-roll bar
      const other = this.wheels[w.front ? (w.right ? 0 : 1) : (w.right ? 2 : 3)];
      F -= (w.front ? p.susp.arbF : p.susp.arbR) * (disp - other.disp);
      const travel = p.susp.travel;
      if (disp < -travel) F += k * 4 * (-travel - disp) - c * 3 * Math.min(w.dispV, 0);   // bump stop: progressive, well damped
      if (disp > travel + p.susp.droop) F = 0;         // fully drooped: in the air
      F = Math.max(0, Math.min(F, w.staticLoad * 6));
      w.load = F;
      w.contact = F > 1;
      if (w.contact) contacts++;
      Fsum += F;
      Mpitch += F * w.a;
      Mroll += F * w.b;
    }
    this.airborne = contacts === 0;

    // ------------------------------------------------------------- tyres
    // Ackermann: the inside wheel turns more, because it's on a tighter circle
    const tanD = Math.tan(this.steer);
    const turnR = Math.abs(tanD) > 1e-5 ? this.L / tanD : 1e7;
    for (const w of this.wheels) {
      if (!w.front) { w.steer = 0; continue; }
      const den = turnR - w.b;
      w.steer = Math.abs(den) < 0.35 ? Math.sign(den || 1) * 1.1 : Math.atan(this.L / den);
    }

    let Fx = 0, Fy = 0, Mz = 0;
    const drive = this.drivetrain(h, inp, aids);
    for (const w of this.wheels) {
      const vxw = this.u - this.r * w.b;
      const vyw = this.v + this.r * w.a;
      const d = w.steer;
      const cd = Math.cos(d), sd = Math.sin(d);
      const vLong = vxw * cd + vyw * sd;
      const vLat = -vxw * sd + vyw * cd;
      const vW = w.omega * w.radius;
      const ref = Math.max(Math.abs(vLong), 1.5);
      const refK = Math.max(Math.abs(vLong), Math.abs(vW), 1.0);   // keeps kappa in [-1, 1]

      // slip, with relaxation length so it can't oscillate at low speed
      const kRaw = (vW - vLong) / refK;
      const sRaw = Math.max(-3, Math.min(3, -vLat / ref));
      const lag = Math.min(1, Math.max(Math.abs(vLong), 2.5) * h / REL);
      w.kappa += (kRaw - w.kappa) * lag;
      w.sy += (sRaw - w.sy) * lag;

      let fx = 0, fy = 0;
      if (w.contact) {
        // load sensitivity: a tyre carrying twice the load doesn't make twice the grip
        const rel = w.load / (w.staticLoad || 1);
        const mu = (w.front ? p.tyre.muF : p.tyre.muR) * w.grip *
                   Math.max(0.62, Math.min(1.28, 1 - p.tyre.loadSens * (rel - 1)));
        const s = Math.hypot(w.kappa, w.sy);
        if (s > 1e-5) {
          const F = mu * w.load * tyreCurve(s);
          fx = F * (w.kappa / s);
          fy = F * (w.sy / s);
        }
      }
      w.fxTyre = fx;
      w.slide = Math.hypot(vLat, w.omega * w.radius - vLong) * (w.contact ? 1 : 0);

      // wheel spin: engine and brakes in, tyre reaction out
      const brakeT = drive.brake[w.i];
      let net = drive.torque[w.i] - fx * w.radius;
      let om = w.omega + (net / w.inertia) * h;
      if (brakeT > 0) {                                  // brake can stop a wheel, never reverse it
        const dOm = (brakeT / w.inertia) * h;
        om = Math.abs(om) <= dOm ? 0 : om - Math.sign(om) * dOm;
      }
      if (!w.contact) om += ((drive.torque[w.i]) / w.inertia) * h * 0.2;
      w.omega = Math.max(-260, Math.min(260, om));
      w.spin += w.omega * h;

      // back into body axes
      Fx += fx * cd - fy * sd;
      Fy += fx * sd + fy * cd;
      Mz += (fx * sd + fy * cd) * w.a - (fx * cd - fy * sd) * w.b;
    }
    this.slipF = Math.atan2(this.v + this.r * p.lf, Math.max(Math.abs(this.u), 2.2)) - this.steer;
    this.slipR = Math.atan2(this.v - this.r * p.lr, Math.max(Math.abs(this.u), 2.2));

    // ------------------------------------------------------------ resistance
    const speed = Math.hypot(this.u, this.v);
    const q = 0.5 * 1.225 * p.aero.cd * p.aero.area;
    Fx -= q * this.u * Math.abs(this.u);
    Fy -= q * 0.6 * this.v * Math.abs(this.v);
    if (!this.airborne) {
      const roll = p.tyre.rollRes * p.mass * G;        // Crr * weight, opposing motion
      Fx -= roll * Math.max(-1, Math.min(1, this.u * 0.5));
      Fy -= 2.4 * this.v;                                // sideways scrub damping
    }
    // downforce, split front/rear, straight onto the springs
    const df = q * speed * speed * p.aero.lift;
    if (df > 0) for (const w of this.wheels) w.load += df * (w.front ? p.aero.split : 1 - p.aero.split) * 0.5;

    const FxT = Fx, FyT = Fy;                         // what the ground actually pushes with

    // ------------------------------------------------------------- gravity
    if (this.airborne) {
      this.vy -= G * h;
    } else {
      const nrm = T.normal(this.x, this.z, this._n || (this._n = {}));
      const gx = G * nrm.y * nrm.x, gz = G * nrm.y * nrm.z;      // downhill pull
      Fx += p.mass * (gx * sy + gz * cy);
      Fy += p.mass * (gx * cy - gz * sy);
    }

    // ---------------------------------------------------------- integrate
    // artificial yaw damping = the driver aids. Scaled by inertia so a truck
    // and a kei car get the same time constant: ~1 s at full aids, none raw.
    let Mtot = Mz - this.r * this.izz * (0.05 + 0.9 * aids);
    if (this.airborne) Mtot = -this.r * this.izz * 0.05;
    if (Math.abs(this.r) > 2.2) Mtot -= this.r * (Math.abs(this.r) - 2.2) * 1100;

    const du = Fx / p.mass + this.r * this.v;
    const dv = Fy / p.mass - this.r * this.u;
    this.u += du * h;
    this.v += dv * h;
    this.r = Math.max(-3.4, Math.min(3.4, this.r + (Mtot / this.izz) * h));
    this.ax = du; this.ay = dv;

    if (speed < 2.4 && !this.airborne) {                // park cleanly
      const kk = 1 - Math.min(speed / 2.4, 1);
      const f = Math.min(h * 12, 1);
      this.v *= 1 - 0.85 * kk * f;
      this.r *= 1 - 0.8 * kk * f;
      if (speed < 0.2 && inp.throttle < 0.02 && inp.brake < 0.02) { this.u = 0; this.v = 0; this.r = 0; }
    }

    // body: heave, pitch, roll
    if (this.airborne) {
      this.y += this.vy * h;
      this.pitchV *= 1 - Math.min(h * 0.8, 1);
      this.rollV *= 1 - Math.min(h * 0.8, 1);
    } else {
      this.vy += (Fsum / p.mass - G) * h;
      this.vy = Math.max(-24, Math.min(24, this.vy));
      this.y += this.vy * h;
    }
    this.pitchV += ((Mpitch + FxT * p.cgH) / this.ipitch - this.pitchV * 2.2) * h;
    this.rollV += ((Mroll + FyT * p.cgH) / this.iroll - this.rollV * 2.4) * h;
    this.pitch += this.pitchV * h;
    this.roll += this.rollV * h;
    this.pitch = Math.max(-0.22, Math.min(0.22, this.pitch));
    this.roll = Math.max(-0.26, Math.min(0.26, this.roll));   // it will lean, it will not roll over

    // never sink through the ground: the bump stops do the work, this is the
    // backstop — measured under the CG, because on a slope the wheels sit at four
    // different heights and the highest one is not where the body is
    const minG = T.height(this.x, this.z) - p.susp.travel * 2 - 0.08;
    if (this.y < minG) {
      this.y = minG;
      if (this.vy < 0) { this.landing = Math.min(1, -this.vy / 9); this.vy *= -0.12; }
    }

    // ------------------------------------------------------------ position
    this.yaw += this.r * h;
    this.vx = this.u * Math.sin(this.yaw) + this.v * Math.cos(this.yaw);
    this.vz = this.u * Math.cos(this.yaw) - this.v * Math.sin(this.yaw);
    this.x += this.vx * h;
    this.z += this.vz * h;
  }

  // engine -> gearbox -> diff -> wheels, plus the brakes. Returns per-wheel torques.
  drivetrain(h, inp, aids) {
    const p = this.p;
    const torque = [0, 0, 0, 0], brake = [0, 0, 0, 0];
    const driven = p.drive === 'fwd' ? [0, 1] : p.drive === 'rwd' ? [2, 3] : [0, 1, 2, 3];

    // engine speed follows the driven wheels through the box
    let wsum = 0;
    for (const i of driven) wsum += this.wheels[i].omega;
    const wAvg = wsum / driven.length;
    const ratio = this.gearRatio();
    this.rpm = Math.max(p.idle, Math.min(p.redline * 1.03, Math.abs(wAvg * ratio) * 60 / (2 * Math.PI)));

    let thr = inp.throttle;
    // traction control: back off when a driven wheel is spinning up
    if (aids > 0) {
      let worst = 0;
      for (const i of driven) worst = Math.max(worst, this.wheels[i].kappa);
      if (worst > 0.22) thr *= Math.max(0, 1 - (worst - 0.22) * 3.4 * aids);
    }
    const rev = this.rpm / p.redline;
    const curve = Math.max(0, p.torque * (0.62 + 0.66 * rev - 0.32 * rev * rev));
    let engine = curve * thr;
    if (this.rpm > p.redline) engine *= 0.15;                     // limiter
    // overrun braking — with engine drag control when the aids are on, so an
    // unloaded inside wheel can't be locked by the engine alone
    let drag = p.engineBrake * (1 - thr) * rev;
    if (aids > 0) {
      let locking = 0;
      for (const i of driven) locking = Math.min(locking, this.wheels[i].kappa);
      if (locking < -0.15) drag *= Math.max(0.1, 1 - (-locking - 0.15) * 6 * aids);
    }
    engine -= drag;
    let axle = engine * ratio * p.efficiency;
    if (this.reversing) axle = -axle;

    // differential: an LSD feeds the slower wheel
    const split = p.drive === 'awd' ? [p.torqueSplit, p.torqueSplit, 1 - p.torqueSplit, 1 - p.torqueSplit] : null;
    for (const axleWheels of [[0, 1], [2, 3]]) {
      const [l, rr] = axleWheels;
      if (!driven.includes(l)) continue;
      const share = split ? split[l] : 1;
      const half = axle * share * 0.5;
      const dOm = this.wheels[l].omega - this.wheels[rr].omega;
      // LSD: reaches full lock at 2 rad/s of difference, lock scales with torque
      const lock = p.diffLock * (Math.abs(axle) * 0.6 + 120) * Math.min(1, Math.abs(dOm) / 2);
      torque[l] = half - Math.sign(dOm) * lock;
      torque[rr] = half + Math.sign(dOm) * lock;
    }

    // brakes, with optional ABS
    const bias = p.brakeBias;
    for (const w of this.wheels) {
      // EBD per corner: each wheel gets brake in proportion to the load it is
      // carrying right now, so an inside rear lifted by roll can't be locked
      const ebd = Math.min(1.1, Math.max(0.2, w.load / (w.staticLoad || 1)));
      let b = inp.brake * p.brakeTorque * (w.front ? bias : (1 - bias)) * 0.5 * ebd;
      if (!w.front) b += inp.handbrake * p.brakeTorque * 0.42;
      if (aids > 0 && w.kappa < -0.12 && Math.abs(this.u) > 3 && inp.handbrake < 0.5) {
        b *= Math.max(0.1, 1 - (-w.kappa - 0.12) * 7 * aids);              // ABS
      }
      brake[w.i] = b;
    }
    this.engineLoad = thr;
    return { torque, brake };
  }

  gearRatio() {
    const p = this.p;
    return (this.reversing ? -p.reverse : p.gears[this.gear - 1]) * p.finalDrive;
  }

  // Automatic box, picked from road speed. Hysteresis so it doesn't hunt.
  updateGearbox(inp) {
    const p = this.p, sp = Math.abs(this.u);
    this.reversing = this.u < -0.4 || (this.u < 0.4 && inp.brake > 0.3 && inp.throttle < 0.05 && this.wasReversing);
    this.wasReversing = this.reversing;
    if (this.reversing) { this.gear = 1; return; }
    const rpmAt = g => (sp / (p.tyre.rr * 2 * Math.PI)) * p.gears[g] * p.finalDrive * 60;
    let g = this.gear - 1;
    if (rpmAt(g) > p.redline * 0.95 && g < p.gears.length - 1) g++;
    else if (g > 0 && rpmAt(g - 1) < p.redline * 0.62) g--;
    this.gear = g + 1;
  }

  finish(dt, inp) {
    this.updateGearbox(inp);
    this.odo += Math.abs(this.u) * dt;
    const w = this.wheels;
    this.frontSlide = (w[0].slide + w[1].slide) * 0.5;
    this.rearSlide = (w[2].slide + w[3].slide) * 0.5;
    this.wheelSpin = Math.max(0, Math.max(w[2].kappa, w[3].kappa, w[0].kappa, w[1].kappa));
    this.spun = Math.abs(this.driftAngle) > 88 && this.speed > 5;
    if (this.airborne) { this.airTime += dt; }
    else { if (this.airTime > this.bestAir) this.bestAir = this.airTime; this.airTime = 0; }
    this.landing *= 1 - Math.min(dt * 6, 1);
  }

  // world position of a contact patch — kept for the FX code
  wheelPos(front, right) {
    const w = this.wheels[(front ? 0 : 2) + (right ? 1 : 0)];
    return { x: w.x, z: w.z, y: w.ground };
  }
}
