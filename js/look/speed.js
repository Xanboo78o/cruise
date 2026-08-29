// speed.js — making 50 mph feel like a mistake.
//
// The rule here: NOTHING in this file changes how the car handles. Adam already
// told me the arcade build was "way too hard to control" once, and speed you
// can't survive isn't frightening, it's just irritating. So the danger is sold
// entirely by the presentation — where the camera is, how wide the lens is, how
// much of the frame is smeared — while the car underneath stays exactly as fair
// as it was.
//
// What actually reads as speed, roughly in order of how much it's worth:
//
//   1. Proximity to the ground. A camera at 3.5 m sees a landscape moving; the
//      same camera at 1.6 m sees the road GOING. The stock rig had the camera
//      pulling further out as you sped up, which is backwards.
//   2. Field of view. Wide lens = things enter at the edge and leave fast.
//   3. Shake, but high-frequency and small. Big slow shake reads as a bad road,
//      small fast shake reads as "this is at its limit".
//   4. Camera lag, so the car pulls away from you under power and settles back.
//   5. Roll on lateral load, so the smallest steering input throws the horizon.
//
// There was a screen-filter layer on top of this. Adam looked at it and said
// scrap it, so it is out of the code rather than switched off. What's left is
// all geometry and lens: where the camera is and how wide it sees.
//
// Everything is a knob because I can't feel it and he can.

export const SPEED_KNOBS = {
  onsetMph: ['starts biting at', 0, 120, 1, 18],
  fullMph:  ['fully unhinged at', 40, 220, 1, 90],
  fovGain:  ['fov kick', 0, 70, 1, 44],
  camDrop:  ['camera drops by', 0, 3.2, 0.05, 2.4],
  camPull:  ['camera pulls in by', -4, 8, 0.1, 5.0],
  camLag:   ['camera lag', 0, 1, 0.01, 0.5],
  shake:    ['shake', 0, 1, 0.01, 0.42],
  shakeRough:['shake off-road', 0, 3, 0.05, 1.8],
  roll:     ['roll into corners', 0, 2, 0.01, 0.95],
  steerKick:['steering kick', 0, 2, 0.01, 1.15],
  accelKick:['kick when accelerating', 0, 30, 0.5, 11],
  aidsFade: ['aids fade at speed', 0, 1, 0.01, 0],   // the only REAL danger. Off by default.
};

const MS = 2.23694;

// The speedo lied by being honest. The car covers ground properly quickly, but
// it had to read 130 before that registered as fast, and everything below 80
// felt like nothing was happening. So the dial is recalibrated: what used to
// read 80 now reads 50. The car moves at exactly the same speed it always did —
// the physics are untouched — but the number you look at now means something,
// and 50 is a speed you respect instead of a speed you ignore.
export const DIAL = 0.5;
export const dialMph = carSpeed => carSpeed * MS * DIAL;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

export class SpeedFeel {
  constructor() {
    this.enabled = false;   // off until he switches it on
    this.lookScale = 1;     // a look can turn the whole thing down (rally is poised, not scary)
    this.k = 0;                 // 0 = pottering, 1 = unhinged
    this.aidsMul = 1;           // read by the physics step, a frame behind — harmless
    this.roll = 0;
    this.kick = 0;
    this.lastSpeed = 0;
    this.v = { ...Object.fromEntries(Object.entries(SPEED_KNOBS).map(([n, d]) => [n, d[4]])) };
  }

  set(k, val) { this.v[k] = val; }

  // rig: CameraRig. car: Car. rough: 0 tarmac .. 1 gravel/grass
  update(dt, car, rig, inp, rough = 0) {
    if (!this.enabled) { this.relax(); rig.fovBoost = rig.drop = rig.pullIn = rig.shakeConst = rig.roll = 0; rig.lagScale = 1; return 1; }
    const v = this.v;
    const mph = dialMph(car.speed);   // knobs are in DIAL mph, the number on screen
    const kRaw = Math.max(0, Math.min(1, (mph - v.onsetMph) / Math.max(1, v.fullMph - v.onsetMph)));
    // NOT smoothstep: that is lazy in the first half, and the first half is
    // where real speed already frightens you. 30 on a bike is scary. ^0.62 has
    // most of the effect in by a third of the way up.
    const k = Math.pow(kRaw, 0.62);
    // ease so a brief lift doesn't snap the whole frame back
    this.k += (k - this.k) * Math.min(dt * 4.5, 1);
    const K = this.k * this.lookScale;

    // ---- accelerating is worse than merely going fast: a lens punch while the
    // car is still pulling, which decays the moment it stops
    const accel = (car.speed - this.lastSpeed) / Math.max(dt, 1e-4);
    this.lastSpeed = car.speed;
    const wantKick = Math.max(0, Math.min(1, accel / 12));
    this.kick += (wantKick - this.kick) * Math.min(dt * (wantKick > this.kick ? 9 : 3), 1);

    // ---- camera: down, in, and late
    rig.fovBoost = v.fovGain * K + v.accelKick * this.kick;
    rig.drop = v.camDrop * K;
    rig.pullIn = v.camPull * K;
    rig.lagScale = 1 - v.camLag * K * 0.75;

    // ---- shake: small and fast, worse off the tarmac
    rig.shakeConst = v.shake * K * (1 + rough * v.shakeRough) * 0.32;

    // ---- roll. Lateral acceleration banks the horizon, and the steering input
    // itself adds a kick on top, so a flick of the wheel throws the frame before
    // the car has actually done anything. That gap is the "one touch and you're
    // in heaven" feeling, and it costs no grip.
    const latG = (car.r * car.speed) / 9.81;
    const want = (-latG * 0.05 * v.roll - (inp ? inp.steer : 0) * 0.055 * v.steerKick) * (0.35 + 0.65 * K);
    this.roll += (want - this.roll) * Math.min(dt * 7, 1);
    rig.roll = this.roll;


    // ---- the only thing here that touches the car. Off unless he asks for it:
    // at full chat the stability assist quietly lets go of your hand.
    this.aidsMul = v.aidsFade > 0 ? 1 - v.aidsFade * K : 1;
    return this.aidsMul;
  }

  // menus, photo mode: settle everything back to rest
  relax() { this.k = 0; this.roll = 0; this.kick = 0; this.aidsMul = 1; }
}
