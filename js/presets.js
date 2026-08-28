// presets.js — the garage. Every car is authored in plain terms (mass, where the
// weight sits, how soft it is, how much rubber, what the engine does) and
// `build()` turns that into the spring rates, inertias and torques the physics
// wants. The mix is deliberate: some of these are serious tools, some of them
// are jokes, and the jokes drive exactly as badly as they look.
//
// Bodies are Kenney's CC0 Car Kit (assets/models). Wheelbase and tyre size come
// FROM the model at its chosen scale, so the wheels sit exactly in the arches;
// track is authored (Kenney tucks the wheels in) and the body is stretched a
// touch sideways to cover it.

const TAU = Math.PI * 2;

// model geometry at scale 1, straight out of the GLB node positions
const MODELS = {
  'hatchback-sports': { front: 0.81, back: 0.81, wheelR: 0.30, len: 2.85 },
  'sedan-sports':     { front: 0.66, back: 0.66, wheelR: 0.30, len: 2.55 },
  'sedan':            { front: 0.66, back: 0.66, wheelR: 0.30, len: 2.55 },
  'suv':              { front: 0.76, back: 0.56, wheelR: 0.30, len: 2.55 },
  'race':             { front: 0.64, back: 0.88, wheelR: 0.30, len: 2.56 },
  'race-future':      { front: 0.59, back: 0.93, wheelR: 0.30, len: 2.66 },
  'taxi':             { front: 0.76, back: 0.76, wheelR: 0.30, len: 2.75 },
  'truck':            { front: 0.86, back: 0.76, wheelR: 0.30, len: 2.95 },
  'van':              { front: 0.76, back: 0.76, wheelR: 0.30, len: 2.75 },
  'ambulance':        { front: 1.01, back: 0.91, wheelR: 0.30, len: 3.25 },
  'kart-oobi':        { front: 0.32, back: 0.36, wheelR: 0.21, len: 1.43 },
};

function build(o) {
  const mdl = MODELS[o.model.file];
  const S = o.model.scale;
  const lf = mdl.front * S * (o.model.stretchZ ?? 1), lr = mdl.back * S * (o.model.stretchZ ?? 1);
  const tyreR = mdl.wheelR * S * (o.model.wheelScale ?? 1);
  const mass = o.mass;
  const L = lf + lr;
  const fFront = lr / L;                                     // fraction of weight on the nose
  const mF = mass * fFront * 0.5, mR = mass * (1 - fFront) * 0.5;   // sprung mass per corner
  const wF = TAU * o.freq[0], wR = TAU * o.freq[1];          // ride frequency -> spring rate
  const kf = mF * wF * wF, kr = mR * wR * wR;
  const zeta = o.damping ?? 0.38;
  const cf = 2 * zeta * Math.sqrt(kf * mF), cr = 2 * zeta * Math.sqrt(kr * mR);
  // gearing was authored for a 0.33 m tyre; keep the same rpm-per-mph on whatever the model wears
  const finalDrive = o.finalDrive * (tyreR / 0.33);
  return {
    label: o.label, blurb: o.blurb, tier: o.tier,
    mass, lf, lr, track: o.track, cgH: o.cgH, inertiaScale: o.inertiaScale ?? 1.15,
    susp: {
      kf, kr, cf, cr, cfr: cf * 1.6, crr: cr * 1.6,          // rebound stiffer than bump, like a real damper
      arbF: kf * (o.arb?.[0] ?? 0.5), arbR: kr * (o.arb?.[1] ?? 0.3),
      travel: o.travel ?? 0.16,
      droop: o.droop ?? Math.max(0.06, (o.travel ?? 0.16) * 0.8),
    },
    tyre: {
      rf: tyreR, rr: tyreR, muF: o.grip[0], muR: o.grip[1],
      loadSens: o.loadSens ?? 0.12, rollRes: o.rollRes ?? 0.014, wheelInertia: o.wheelInertia,
      inertia: (o.wheelInertia ?? 1.2),
    },
    aero: { cd: o.cd, area: o.area, lift: o.lift ?? 0, split: o.aeroSplit ?? 0.4 },
    torque: o.torque, idle: o.idle ?? 900, redline: o.redline, engineBrake: o.engineBrake ?? 40,
    efficiency: o.efficiency ?? 0.88,
    gears: o.gears, reverse: o.reverse ?? o.gears[0] * 0.95, finalDrive,
    drive: o.drive, torqueSplit: o.torqueSplit ?? 0.4, diffLock: o.diffLock ?? 0.4,
    brakeTorque: o.brakeTorque ?? mass * 9.81 * tyreR * (o.brakeG ?? 1.25), brakeBias: o.brakeBias ?? 0.68,
    maxSteer: o.maxSteer, steerFalloff: o.steerFalloff ?? 0.56,
    model: { ...o.model, wheelR: mdl.wheelR, len: mdl.len * S * (o.model.stretchZ ?? 1) },
  };
}

export const PRESETS = {

  // ------------------------------------------------------- the serious ones
  hachi: build({
    label: 'HACHI', blurb: 'RWD drift hatch. Rotates on the throttle. The one to learn on.', tier: 'serious',
    model: { file: 'hatchback-sports', scale: 1.45, stretchX: 1.12 },
    mass: 1180, track: 1.56, cgH: 0.50,
    freq: [1.7, 1.8], damping: 0.42, arb: [0.55, 0.28], travel: 0.14,
    grip: [1.34, 1.28], cd: 0.36, area: 1.95, lift: 0.04,
    torque: 300, redline: 7600, gears: [3.6, 2.2, 1.55, 1.18, 0.95, 0.8], finalDrive: 3.9,
    drive: 'rwd', diffLock: 0.55, maxSteer: 0.60,
  }),

  gt: build({
    label: 'GT', blurb: 'Heavy, planted, repeatable. For brake-point drills.', tier: 'serious',
    model: { file: 'sedan-sports', scale: 1.7, stretchX: 1.12 },
    mass: 1560, track: 1.64, cgH: 0.46,
    freq: [1.9, 2.0], damping: 0.45, arb: [0.6, 0.35], travel: 0.12,
    grip: [1.52, 1.50], cd: 0.32, area: 2.05, lift: 0.14, aeroSplit: 0.38,
    torque: 520, redline: 7800, gears: [3.3, 2.1, 1.52, 1.18, 0.95, 0.78], finalDrive: 3.55,
    drive: 'rwd', diffLock: 0.5, maxSteer: 0.54,
  }),

  rally: build({
    label: 'RALLY', blurb: 'AWD, long-travel. Gravel is not a problem. Jumps are a feature.', tier: 'serious',
    model: { file: 'suv', scale: 1.7, stretchX: 1.1 },
    mass: 1330, track: 1.60, cgH: 0.56,
    freq: [1.4, 1.5], damping: 0.5, arb: [0.35, 0.2], travel: 0.26,
    grip: [1.30, 1.28], loadSens: 0.08, cd: 0.40, area: 2.2, lift: 0.03,
    torque: 420, redline: 7200, gears: [3.4, 2.15, 1.55, 1.2, 0.98, 0.82], finalDrive: 4.1,
    drive: 'awd', torqueSplit: 0.42, diffLock: 0.7, maxSteer: 0.62,
  }),

  formula: build({
    label: 'FORMULA', blurb: 'Open wheels, real downforce. Above 80 it grips like it is glued.', tier: 'serious',
    model: { file: 'race', scale: 1.75, stretchX: 1.0 },
    mass: 720, track: 1.62, cgH: 0.30,
    freq: [2.8, 2.9], damping: 0.55, arb: [0.7, 0.5], travel: 0.06,
    grip: [1.75, 1.72], loadSens: 0.10, cd: 0.9, area: 1.4, lift: 2.6, aeroSplit: 0.42,
    torque: 300, idle: 2500, redline: 12000, engineBrake: 60,
    gears: [2.9, 2.2, 1.8, 1.5, 1.3, 1.15, 1.02], finalDrive: 5.0,
    drive: 'rwd', diffLock: 0.6, brakeG: 2.2, brakeBias: 0.58, maxSteer: 0.40, steerFalloff: 0.7,
  }),

  super: build({
    label: 'HYPER', blurb: 'AWD, absurd. Point and squeeze. Not a drift car, and it knows it.', tier: 'serious',
    model: { file: 'race-future', scale: 1.75, stretchX: 1.05 },
    mass: 1480, track: 1.70, cgH: 0.40,
    freq: [2.1, 2.2], damping: 0.5, arb: [0.65, 0.45], travel: 0.10,
    grip: [1.62, 1.60], cd: 0.33, area: 2.0, lift: 0.5, aeroSplit: 0.4,
    torque: 780, redline: 8200, gears: [3.4, 2.2, 1.6, 1.25, 1.0, 0.82, 0.68], finalDrive: 3.5,
    drive: 'awd', torqueSplit: 0.32, diffLock: 0.6, maxSteer: 0.50,
  }),

  // --------------------------------------------------------- the fun ones
  muscle: build({
    label: 'MUSCLE', blurb: 'All torque, no manners. Tank-slappers on request.', tier: 'fun',
    model: { file: 'sedan', scale: 1.8, stretchX: 1.12 },
    mass: 1720, track: 1.60, cgH: 0.54,
    freq: [1.3, 1.25], damping: 0.28, arb: [0.4, 0.15], travel: 0.18,
    grip: [1.10, 1.07], loadSens: 0.16, cd: 0.42, area: 2.2,
    torque: 680, redline: 6200, engineBrake: 55, gears: [2.9, 1.9, 1.4, 1.0], finalDrive: 3.7,
    drive: 'rwd', diffLock: 0.3, brakeG: 0.95, brakeBias: 0.66, maxSteer: 0.52, steerFalloff: 0.5,
  }),

  kart: build({
    label: 'KART', blurb: 'Someone is driving it. No suspension, no mercy, all elbows.', tier: 'fun',
    model: { file: 'kart-oobi', scale: 1.4, stretchX: 1.0 },
    mass: 190, track: 1.0, cgH: 0.34,
    freq: [3.2, 3.2], damping: 0.6, arb: [0.6, 0.6], travel: 0.03, droop: 0.04,
    grip: [1.15, 1.36], loadSens: 0.06, cd: 0.8, area: 0.9, rollRes: 0.02, wheelInertia: 0.15,   // fat rears: a kart that oversteers at 40 mph is unstable, not fun
    torque: 34, idle: 1800, redline: 11000, engineBrake: 6, gears: [2.2, 1.5], finalDrive: 3.2,
    drive: 'rwd', diffLock: 1.0, brakeG: 1.3, brakeBias: 0.6, maxSteer: 0.42, steerFalloff: 0.45,
  }),

  taxi: build({
    label: 'TAXI', blurb: 'Front-drive, soft, and it has somewhere to be.', tier: 'fun',
    model: { file: 'taxi', scale: 1.55, stretchX: 1.1 },
    mass: 1240, track: 1.50, cgH: 0.56,
    freq: [1.35, 1.3], damping: 0.3, arb: [0.4, 0.15], travel: 0.18,
    grip: [1.16, 1.20], loadSens: 0.14, cd: 0.40, area: 2.2,
    torque: 190, redline: 6800, gears: [3.7, 2.2, 1.5, 1.1, 0.88], finalDrive: 4.2,
    drive: 'fwd', diffLock: 0.15, brakeBias: 0.7, maxSteer: 0.70, steerFalloff: 0.5,
  }),

  // -------------------------------------------------------- the silly ones
  truck: build({
    label: 'PICKUP', blurb: 'Lifted. Leans like a boat, jumps like a champion.', tier: 'silly',
    model: { file: 'truck', scale: 1.8, stretchX: 1.1 },
    mass: 2400, track: 1.72, cgH: 0.86,
    freq: [1.05, 1.0], damping: 0.30, arb: [0.25, 0.12], travel: 0.32,
    grip: [1.0, 1.05], loadSens: 0.14, cd: 0.55, area: 3.2, rollRes: 0.018, wheelInertia: 2.4,
    torque: 620, redline: 5600, engineBrake: 70, gears: [4.0, 2.5, 1.7, 1.2, 0.9], finalDrive: 4.1,
    drive: 'awd', torqueSplit: 0.45, diffLock: 0.5, brakeG: 1.0, brakeBias: 0.6, maxSteer: 0.50, steerFalloff: 0.5,
  }),

  limo: build({
    label: 'LIMO', blurb: 'Seven metres. Turning circle of a ship. Someone is in the back.', tier: 'silly',
    model: { file: 'sedan', scale: 1.8, stretchX: 1.1, stretchZ: 2.1 },
    mass: 2600, track: 1.60, cgH: 0.50,
    freq: [1.1, 1.05], damping: 0.36, arb: [0.4, 0.2], travel: 0.14,
    grip: [1.06, 1.10], loadSens: 0.12, cd: 0.40, area: 2.3,
    torque: 400, redline: 5800, gears: [3.2, 2.0, 1.4, 1.0], finalDrive: 3.4,
    drive: 'rwd', diffLock: 0.2, brakeG: 1.0, maxSteer: 0.42, steerFalloff: 0.6,
  }),

  ambulance: build({
    label: 'AMBULANCE', blurb: 'Two and a half tonnes, tall as a house. Everyone in the back is fine.', tier: 'silly',
    model: { file: 'ambulance', scale: 1.7, stretchX: 1.08 },
    mass: 2550, track: 1.70, cgH: 0.98,
    freq: [1.15, 1.05], damping: 0.28, arb: [0.3, 0.12], travel: 0.22,
    grip: [1.04, 1.08], loadSens: 0.16, cd: 0.6, area: 4.0, rollRes: 0.018, wheelInertia: 2.2,
    torque: 520, redline: 5200, engineBrake: 70, gears: [3.9, 2.4, 1.6, 1.15, 0.9], finalDrive: 4.0,
    drive: 'rwd', diffLock: 0.4, brakeG: 1.05, brakeBias: 0.62, maxSteer: 0.50, steerFalloff: 0.55,
  }),

  van: build({
    label: 'VAN', blurb: 'Front-drive, tall, absolutely full of boxes.', tier: 'silly',
    model: { file: 'van', scale: 1.65, stretchX: 1.08 },
    mass: 1500, track: 1.56, cgH: 0.80,
    freq: [1.25, 1.15], damping: 0.28, arb: [0.3, 0.1], travel: 0.20,
    grip: [1.08, 1.14], loadSens: 0.16, cd: 0.52, area: 3.0,
    torque: 210, redline: 6400, gears: [3.9, 2.3, 1.55, 1.1, 0.86], finalDrive: 4.3,
    drive: 'fwd', diffLock: 0.1, brakeBias: 0.7, maxSteer: 0.70, steerFalloff: 0.55,
  }),
};

export const CAR_ORDER = ['hachi', 'gt', 'rally', 'formula', 'super', 'muscle', 'kart', 'taxi', 'truck', 'limo', 'ambulance', 'van'];
export const TIERS = { serious: 'SERIOUS', fun: 'FUN', silly: 'SILLY' };
