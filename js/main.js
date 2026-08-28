// main.js — glue. Fixed-step physics for every car on track, lap timing, race
// state, aids, cameras, menu.

import * as THREE from 'three';
import { Car } from './car.js';
import { PRESETS, CAR_ORDER, TIERS } from './presets.js';
import { TrackModel } from './track.js';
import { TRACKS, TRACK_ORDER } from './tracks.js';
import { World, applyLighting, makeSky } from './world.js';
import { buildCar, updateCarMesh, setCarOpacity, setHeadlights, placeStaticCar } from './carmesh.js';
import { SkidMarks, Smoke } from './fx.js';
import { CameraRig, MODE_LABEL } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { LapRecorder, GhostPlayer, PaceCar, Best } from './ghost.js';
import { Audio } from './audio.js';
import { buildCity, cityProps, cityWalls } from './city.js';
import { Props } from './props.js';
import { FreeRoam } from './world/freeroam.js';
import { autoDrive, AUTO_AIDS } from './driver.js';
import { Items, ITEM_INFO } from './items.js';
import { Bots } from './bots.js';
import { Race, collideCars } from './race.js';
import { Screens } from './menu.js';

const SKY_CYCLE = ['sunset', 'noon', 'dawn', 'night'];
const MS = 2.23694;

const S = {
  track: 'harbor', carId: 'hachi', unitMph: true,
  stability: 0.7, showLine: true, showBoards: true,
  ghostOn: true, paceOn: false, pace: 0.85, auto: false, frozen: false,
  hudOn: true, vertical: false, skyIdx: 0, skyChosen: false, running: false,
  mode: 'race', bots: 7, laps: 3, shorts: false, paused: false, grid: 'mixed',
};
let attract = false;                      // a race plays behind the title screen
let cfg = { mode: 'race', bots: 7, laps: 3 };   // what the loaded track is running (attract overrides S)

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 5000);
const rig = new CameraRig(camera);
const input = new Input(renderer.domElement);
const hud = new HUD(document.getElementById('hud'));
const audio = new Audio();

const car = new Car(S.carId, PRESETS);
let carMesh, ghostMesh, paceMesh, world, model, skyMesh, lights;
let skid, smoke, items = null, bots = null, race = null, props = null;
const modelCache = new Map();

// the road under the wheels, plus whatever someone spilled on it
const env = {
  terrain: null,
  surfaceAt: (x, z) => {
    const s = model.surfaceAt(x, z);
    if (items) { const k = items.slickAt(x, z); if (k < 1) return { ...s, grip: s.grip * k }; }
    return s;
  },
};

// ---------------------------------------------------------------- world setup
function getModel(id) {
  if (modelCache.has(id)) return modelCache.get(id);
  const m = id === 'sanoozi' ? new FreeRoam() : id === 'city' ? buildCity() : new TrackModel(TRACKS[id]);
  modelCache.set(id, m);
  return m;
}

function clearScene() {
  if (world) world.dispose();
  if (items) items.dispose();
  if (props) props.dispose();
  for (const o of [...scene.children]) scene.remove(o);
  scene.children.length = 0;
  items = null; bots = null; race = null; props = null;
}

function loadTrack(id, opts = {}) {
  S.track = id;
  cfg = { mode: S.mode, bots: S.bots, laps: S.laps, ...opts };
  clearScene();
  model = getModel(id);
  env.terrain = model.terrain;
  if (!S.skyChosen) S.skyIdx = Math.max(0, SKY_CYCLE.indexOf(model.def.sky));
  const skyKey = SKY_CYCLE[S.skyIdx] || model.def.sky;
  skyMesh = makeSky(scene, skyKey);
  lights = applyLighting(scene, skyKey);
  world = model.buildWorld ? model.buildWorld(scene, skyKey) : new World(model, scene, { sky: skyKey });
  world.setAids(S.showLine, S.showBoards);
  skid = new SkidMarks(scene);
  smoke = new Smoke(scene);

  car.setPreset(S.carId);
  carMesh = buildCar(car.p, { lights: true });
  scene.add(carMesh);
  ghostMesh = buildCar(car.p, { tint: 0x9fb4ff });
  setCarOpacity(ghostMesh, 0.32);
  ghostMesh.visible = false;
  scene.add(ghostMesh);
  paceMesh = buildCar(car.p, { tint: 0xf5c145 });
  setCarOpacity(paceMesh, 0.55);
  paceMesh.visible = false;
  scene.add(paceMesh);
  setHeadlights(carMesh, skyKey === 'night');

  rig.setTrackCams(model);
  hud.prepareMap(model);
  pace = new PaceCar(model, S.pace);
  loadBest();

  if (cfg.mode === 'race') startRace();
  else startCruise();
  S.running = true;
}

// CRUISE: the open city, things to hit, a bit of traffic, no clock
function startCruise() {
  resetCar(true);
  if (model.def.id === 'sanoozi') { S.showLine = false; S.showBoards = false; return; }   // the world; dressing comes in later phases
  if (model.def.id === 'city') {
    props = new Props(scene, (x, z) => model.heightAt(x, z), cityProps(), cityWalls());
    bots = new Bots(model, 5, S.carId, { pace: [0.45, 0.62], items: false });
    for (const b of bots.list) { b.mesh = buildCar(PRESETS[b.id]); scene.add(b.mesh); }
    // scatter the traffic round the circuit so it isn't a queue at the start
    bots.list.forEach((b, i) => {
      const p = model.sampleAtDistance((i + 1) * model.length / (bots.list.length + 1));
      b.car.reset(p.x, p.z, Math.atan2(p.tx, p.tz), model.heightAt(p.x, p.z));
    });
    S.showLine = false; S.showBoards = false; world.setAids(false, false);
  }
}

// ------------------------------------------------------------------- race
function startRace() {
  if (bots) for (const b of bots.list) if (b.mesh) scene.remove(b.mesh);
  if (items) items.dispose();
  items = new Items(model, scene);
  const pool = S.grid === 'equal' ? CAR_ORDER.filter(id => PRESETS[id].tier === PRESETS[S.carId].tier && id !== S.carId) : null;
  bots = new Bots(model, cfg.bots, S.carId, { pool });
  for (const b of bots.list) { b.mesh = buildCar(PRESETS[b.id]); scene.add(b.mesh); }
  race = new Race(model, [{ car, name: car.p.label, isPlayer: true }, ...bots.list.map(b => ({ car: b.car, name: b.name }))], cfg.laps);
  race.grid();
  // settle everyone on their springs
  for (let i = 0; i < 90; i++) {
    car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, S.stability);
    bots.step(1 / 120, env, [], () => 0, null, null, true);
  }
  car.item = null; car.boostT = 0; car.stunT = 0; car.shieldT = 0; car.megaT = 0;
  started = false; rec.reset(); skid.clear(); smoke.clear();
  hud.toast('', 1);
}

const allCars = () => bots ? [car, ...bots.cars] : [car];
const progOf = (c) => race ? race.progOf(c) : model.samples[model.nearest(c.x, c.z).i].s;

// ------------------------------------------------------------------- timing (cruise)
let lap = 0, bestTime = null, bestFrames = null, lastLap = null;
let sectorTimes = [null, null, null], bestSectors = [null, null, null];
let sectorIdx = 0, prevDist = 0, started = false, distTravelled = 0;
const rec = new LapRecorder();
let ghost = null, pace = null;
let driftHold = 0, driftTotal = 0, bestHold = 0, stuckT = 0, wasLanding = false, airToast = false;
let time = 0;

function loadBest() {
  const b = Best.get(S.track, S.carId);
  bestTime = b ? b.time : null;
  bestFrames = b ? b.frames : null;
  ghost = bestFrames ? new GhostPlayer(bestFrames) : null;
  bestSectors = [null, null, null];
}

function resetCar(toStart) {
  const m = model;
  let p;
  if (m.spawn) {
    // the open world: drop at the spawn point (or back onto the nearest road)
    const sp = toStart ? m.spawn() : (() => { const nr = m.nearest(car.x, car.z); return { x: nr.p.x, z: nr.p.z, yaw: Math.atan2(nr.p.tx, nr.p.tz) }; })();
    car.reset(sp.x, sp.z, sp.yaw, m.heightAt(sp.x, sp.z) + 0.3);
    for (let i = 0; i < 90; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, S.stability);
    started = false; rec.reset(); driftHold = 0; stuckT = 0;
    return;
  }
  if (toStart) {
    const i = Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length;
    p = m.samples[i];
  } else {
    const nr = m.nearest(car.x, car.z);
    p = m.samples[nr.i];
  }
  const yaw = Math.atan2(p.tx, p.tz);
  car.reset(p.x, p.z, yaw, model.heightAt(p.x, p.z));
  for (let i = 0; i < 90; i++) car.step(1 / 120, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, S.stability);
  lap = 0; started = false; prevDist = p.s; distTravelled = 0;
  sectorTimes = [null, null, null]; sectorIdx = 0;
  rec.reset();
  if (pace) pace.reset(p.s);
  driftHold = 0; stuckT = 0;
}

// in a race, "back on track" means the nearest point of the road, facing forwards, with a shove
function rescue() {
  const nr = model.nearest(car.x, car.z);
  const p = model.samples[nr.i];
  const lat = Math.max(-model.halfWidth * 0.6, Math.min(model.halfWidth * 0.6, nr.lat));
  const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
  car.reset(x, z, Math.atan2(p.tx, p.tz), model.heightAt(x, z));
  car.shieldT = Math.max(car.shieldT, 1.5);
}

function onLapDone(t) {
  sectorTimes[2] = t - (sectorTimes[0] || 0) - (sectorTimes[1] || 0);
  lastLap = t;
  const improved = bestTime == null || t < bestTime;
  if (improved) {
    bestTime = t;
    bestFrames = rec.frames.slice();
    ghost = new GhostPlayer(bestFrames);
    Best.set(S.track, S.carId, t, bestFrames);
    bestSectors = sectorTimes.slice();
    hud.toast(`NEW BEST  ${t.toFixed(3)}`);
  } else {
    hud.toast(`LAP  ${t.toFixed(3)}   (+${(t - bestTime).toFixed(3)})`);
  }
  sectorTimes = [null, null, null];
  sectorIdx = 0;
  rec.reset();
}

function updateTiming(dt) {
  if (!model.samples.length) return;                       // the open world has no lap
  const nr = model.nearest(car.x, car.z);
  const d = model.samples[nr.i].s;
  let step = d - prevDist;
  if (step > model.length * 0.5) step -= model.length;
  if (step < -model.length * 0.5) step += model.length;
  prevDist = d;
  distTravelled += step;

  if (!model.closed) {
    if (!started && d > 4 && car.speed > 1) { started = true; rec.reset(); }
    if (started) {
      rec.sample(dt, car);
      if (d > model.length - 8) { onLapDone(rec.t); started = false; }
    }
    return;
  }
  const startS = model.samples[Math.floor((model.def.startIndex || 0) * model.samples.length) % model.samples.length].s;
  const before = ((prevDist - step) - startS + model.length) % model.length;
  const after = (d - startS + model.length) % model.length;
  if (started && step > 0 && before > model.length * 0.75 && after < model.length * 0.25) {
    if (rec.t > 5) onLapDone(rec.t);
    else rec.reset();
  }
  if (!started && car.speed > 1) { started = true; rec.reset(); }
  if (started) {
    rec.sample(dt, car);
    const frac = after / model.length;
    const want = frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2;
    if (want !== sectorIdx && want > sectorIdx) {
      sectorTimes[sectorIdx] = rec.t - (sectorTimes[0] || 0) - (sectorIdx > 1 ? (sectorTimes[1] || 0) : 0);
      sectorIdx = want;
    }
  }
}

// ----------------------------------------------------------------- main loop
let acc = 0, last = performance.now() / 1000, attractT = 0;
const STEP = 1 / 120;
let itemHeld = false;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  let dt = Math.min(now - last, 0.1);
  last = now;
  screens.update(dt);
  if (!S.running || (screens.active && !attract) || S.paused) {
    if (screens.current === 'car' || screens.current === 'track') screens.renderShowcase(renderer, camera.aspect);
    else renderer.render(scene, camera);
    input.endFrame();
    return;
  }
  time += dt;

  const autoNow = S.auto || attract;
  if (!screens.active) handleKeys();
  const raw = input.read();
  const holding = race && race.state === 'countdown';
  let inp = autoNow ? autoDrive(car, model, S.pace) : raw;
  if (DBG_INPUT) inp = { ...inp, ...DBG_INPUT };            // ?steer=1&thr=1: hold an input (screenshots)
  if (holding) inp = { throttle: 0, brake: 1, steer: raw.steer, handbrake: 0 };
  if (car.stunT > 0) inp = { ...inp, throttle: 0 };

  // item: E / Shift / pad X — edge-triggered
  const itemBtn = input.keys.has('e') || input.keys.has('shift') || !!(input.pad && ((input.pad.buttons[2] && input.pad.buttons[2].pressed) || (input.pad.buttons[4] && input.pad.buttons[4].pressed)));
  if (itemBtn && !itemHeld && items && car.item && !holding) {
    const used = items.use(car, allCars(), progOf);
    if (used) hud.toast(ITEM_INFO[used].label, 700);
  }
  itemHeld = itemBtn;
  if (autoNow && items && car.item && race && race.started && Math.random() < dt * 0.6) items.use(car, allCars(), progOf);
  // the attract race never ends: a few seconds after the flag, another grid
  if (attract && race && race.state === 'finished') { attractT += dt; if (attractT > 5) { attractT = 0; startRace(); } }

  if (!S.frozen) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      car.step(STEP, inp, env, autoNow ? AUTO_AIDS : S.stability);
      if (model.collide) model.collide(car);
      if (bots) {
        bots.step(STEP, env, allCars(), progOf, race ? race.progOf(car) : null, items, holding);
        if (model.collide) for (const c of bots.cars) model.collide(c);
        collideCars(allCars(), (a, b, j) => { if ((a === car || b === car) && j > 400) { rig.kick(Math.min(1, j / 6000)); input.rumble(Math.min(1, j / 5000), 0.4, 140); } });
      }
      if (props) props.step(STEP, allCars());
      acc -= STEP; steps++;
    }
    if (race) {
      race.update(dt);
      if (race.lastEvent === 'go') { hud.toast('', 1); race.lastEvent = null; }
      if (race.lastEvent === 'finish') { race.lastEvent = null; }
      const st = race.standings();
      items.update(dt, st.map((e, i) => ({ car: e.car, rank01: st.length > 1 ? i / (st.length - 1) : 0.5 })));
    } else updateTiming(dt);

    const ang = Math.abs(car.driftAngle);
    if (ang > 12 && car.speed > 8 && !car.spun) { driftHold += dt; driftTotal += dt; }
    else { if (driftHold > bestHold) bestHold = driftHold; driftHold = 0; }

    const off = model.surfaceAt(car.x, car.z);
    stuckT = (car.speed < 1.2 && !holding) ? stuckT + dt : 0;
    if (autoNow && (stuckT > 2.5 || off.grip < 0.5 && car.speed < 3)) { race ? rescue() : resetCar(false); }
  }

  const surf = model.surfaceAt(car.x, car.z);
  updateCarMesh(carMesh, car, dt, inp.brake > 0.05 || inp.handbrake > 0.5, time);
  if (bots) for (const b of bots.list) updateCarMesh(b.mesh, b.car, dt, b.out.brake > 0.05, time);
  if (props) props.sync();
  emitFx(dt, surf);
  // pad feedback: a shove on landing, a buzz under boost
  if (car.landing > 0.4 && !wasLanding) input.rumble(0.7, 0.3, 160);
  if (car.boostT > 0 && Math.random() < dt * 4) input.rumble(0.15, 0.6, 90);
  if (input.padJustConnected) { input.padJustConnected = false; hud.toast('🎮 ' + (input.padName || 'CONTROLLER'), 1600); }

  ghostMesh.visible = !race && S.ghostOn && ghost && ghost.valid && started;
  if (ghostMesh.visible) {
    const g = ghost.at(rec.t);
    if (g) placeStaticCar(ghostMesh, g.x, g.y, g.z, g.yaw);
    else ghostMesh.visible = false;
  }
  paceMesh.visible = !race && S.paceOn && model.closed;
  if (paceMesh.visible && !S.frozen) {
    pace.pace = S.pace;
    pace.step(dt);
    placeStaticCar(paceMesh, pace.x, model.heightAt(pace.x, pace.z), pace.z, pace.yaw);
  }

  if (car.landing > 0.25 && !wasLanding) rig.kick(car.landing * 0.7);
  wasLanding = car.landing > 0.25;
  if (car.airborne && car.airTime > 0.35 && !airToast) airToast = true;
  if (!car.airborne && airToast) { airToast = false; if (car.bestAir > 0.6) hud.toast('AIR  ' + car.bestAir.toFixed(2) + 's', 1200); }
  rig.update(dt, car, input.mouse);
  if (world.update) world.update(camera.position.x, camera.position.z);
  if (skyMesh) skyMesh.position.copy(camera.position);
  if (lights) {
    lights.dir.position.set(camera.position.x + lights.sky.dirPos[0] * 220,
      camera.position.y + lights.sky.dirPos[1] * 220, camera.position.z + lights.sky.dirPos[2] * 220);
    lights.dir.target.position.set(car.x, car.y, car.z);
    lights.dir.target.updateMatrixWorld();
  }
  smoke.update(dt);
  audio.update(car, surf);

  const me = race ? race.player : null;
  const gDelta = !race && ghost && ghost.valid && started ? deltaToGhost() : null;
  hud.update(dt, {
    speedDisplay: car.speed * (S.unitMph ? MS : 3.6),
    unit: S.unitMph ? 'MPH' : 'KM/H',
    gear: car.gear, reverse: car.reversing,
    rpm: car.rpm / car.p.redline,
    lap: race ? (race.started ? race.t - me.lapStart : null) : (started ? rec.t : lastLap),
    best: race ? me.best : bestTime, delta: gDelta,
    sectors: race ? [] : sectorTimes.map((t, i) => ({
      t, state: i === sectorIdx ? 'live' : (t != null && bestSectors[i] != null && t <= bestSectors[i]) ? 'good' : t != null ? 'ok' : '',
    })),
    trackName: model.def.name, carName: car.p.label,
    aids: aidsLabel(),
    driftAngle: car.driftAngle, driftHold, grip: Math.min(Math.max(0, car.scrub - 0.05) / 0.5, 1), air: car.airborne,
    driftCharge: car.driftCharge, driftLevel: car.driftLevel, boost: car.boostT > 0, stunned: car.stunT > 0, bump: car.bumpT > 0.3,
    throttle: inp.throttle, brake: inp.brake, steer: inp.steer,
    carX: car.x, carZ: car.z, carYaw: car.yaw,
    ghost: ghostMesh.visible ? ghostMesh.position : null,
    pace: paceMesh.visible ? pace : null,
    others: bots ? bots.cars : null,
    item: car.item ? ITEM_INFO[car.item] : null,
    race: race ? { state: race.state, countdown: race.countdown, t: race.t, pos: me.pos, total: race.entrants.length,
                   lap: me.lap, laps: race.laps, standings: race.state === 'finished' ? race.standings() : null } : null,
    padHint: input.usingPad ? '🎮' : '',
  });

  if (screens.current === 'car' || screens.current === 'track') screens.renderShowcase(renderer, camera.aspect);
  else renderer.render(scene, camera);
  input.endFrame();
}

function deltaToGhost() {
  const g = ghost.frames;
  if (!g || g.length < 10) return null;
  let bestI = 0, bestD = 1e9;
  for (let i = 0; i < g.length; i += 5) {
    const d = (g[i + 1] - car.x) ** 2 + (g[i + 3] - car.z) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestD > 900) return null;
  return rec.t - g[bestI];
}

function emitFx(dt, surf) {
  const list = bots ? [car, ...bots.cars] : [car];
  for (const c of list) {
    const sf = c === car ? surf : model.surfaceAt(c.x, c.z);
    const marks = sf.grip > 0.75;
    for (let i = 0; i < 4; i++) {
      const pw = c.wheels[i];
      const slide = pw.contact ? pw.slide : 0;
      const key = c.presetName + i + (c === car ? 'p' : 'b' + list.indexOf(c));
      const inten = Math.min(Math.max(slide - 3.5, 0) / 12, 1) * Math.min(1, Math.max(0, (c.speed - 3) / 8));
      if (marks) skid.addPoint(key, pw.x, pw.ground, pw.z, Math.cos(c.yaw), -Math.sin(c.yaw), inten, 0.16);
      if (inten > 0.3 && Math.random() < inten * 0.45) {
        const col = marks ? [0.88, 0.88, 0.9] : [0.78, 0.68, 0.5];
        smoke.emit(pw.x, pw.ground, pw.z, -c.vx * 0.2, -c.vz * 0.2, inten * 0.6, col);
      }
    }
    if (c.speed > 6 && sf.grip < 0.7 && Math.random() < 0.3) smoke.emit(c.x, c.y, c.z, -c.vx * 0.1, -c.vz * 0.1, 0.4, [0.74, 0.64, 0.47]);
  }
}

function aidsLabel() {
  const bits = [];
  if (race) bits.push('RACE');
  if (S.showLine) bits.push('LINE');
  if (S.showBoards) bits.push('BOARDS');
  if (!race && S.ghostOn && ghost && ghost.valid) bits.push('GHOST');
  if (!race && S.paceOn) bits.push('PACE ' + Math.round(S.pace * 100) + '%');
  if (S.auto) bits.push('AUTO');
  if (S.frozen) bits.push('FROZEN');
  bits.push('AIDS ' + Math.round(S.stability * 100) + '%');
  bits.push(MODE_LABEL[rig.mode]);
  return bits.join(' · ');
}

// --------------------------------------------------------------------- keys
function handleKeys() {
  if (input.tapped('c') || input.padTapped('y')) { rig.cycle(input.keys.has('shift') ? -1 : 1); hud.toast('CAM · ' + MODE_LABEL[rig.mode], 1200); }
  if (input.padTapped('back')) { S.hudOn = !S.hudOn; document.body.classList.toggle('nohud', !S.hudOn); }
  if (input.padTapped('start')) openMenu();
  if (input.tapped('h')) { S.hudOn = !S.hudOn; document.body.classList.toggle('nohud', !S.hudOn); }
  if (input.tapped('v')) { S.vertical = !S.vertical; document.body.classList.toggle('vertical', S.vertical); resize(); }
  if (input.tapped('l')) { S.showLine = !S.showLine; world.setAids(S.showLine, S.showBoards); hud.toast('LINE ' + (S.showLine ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('b')) { S.showBoards = !S.showBoards; world.setAids(S.showLine, S.showBoards); hud.toast('BRAKE BOARDS ' + (S.showBoards ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('g')) { S.ghostOn = !S.ghostOn; hud.toast('GHOST ' + (S.ghostOn ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('p') && !race) { S.paceOn = !S.paceOn; if (S.paceOn) pace.reset(model.nearest(car.x, car.z).p.s + 40); hud.toast('PACE CAR ' + (S.paceOn ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('[')) { S.pace = Math.max(0.4, S.pace - 0.05); hud.toast('PACE ' + Math.round(S.pace * 100) + '%', 900); }
  if (input.tapped(']')) { S.pace = Math.min(1.05, S.pace + 0.05); hud.toast('PACE ' + Math.round(S.pace * 100) + '%', 900); }
  if (input.tapped(',')) { S.stability = Math.max(0, S.stability - 0.1); hud.toast('AIDS ' + Math.round(S.stability * 100) + '%', 1000); }
  if (input.tapped('.')) { S.stability = Math.min(1, S.stability + 0.1); hud.toast('AIDS ' + Math.round(S.stability * 100) + '%', 1000); }
  if (input.tapped('z')) { S.auto = !S.auto; hud.toast(S.auto ? 'AUTOPILOT — sit back' : 'AUTOPILOT OFF', 1400); }
  if (input.tapped('f')) { S.frozen = !S.frozen; if (S.frozen) rig.mode = 'orbit'; hud.toast(S.frozen ? 'FROZEN — drag to orbit' : 'ROLLING', 1200); }
  if (input.tapped('r')) { if (race && race.state === 'finished') startRace(); else if (race) rescue(); else resetCar(false); }
  if (input.tapped('t') && props) props.reset();
  if (input.tapped('t')) { if (race) startRace(); else resetCar(true); }
  if (input.tapped('x')) { skid.clear(); smoke.clear(); hud.toast('MARKS CLEARED', 900); }
  if (input.tapped('n')) { S.skyIdx = (S.skyIdx + 1) % SKY_CYCLE.length; S.skyChosen = true; reloadSky(); }
  if (input.tapped('m')) hud.toast('SOUND ' + (audio.toggle() ? 'ON' : 'OFF'), 900);
  if (input.tapped('u')) { S.unitMph = !S.unitMph; }
  if (input.tapped('escape') || input.tapped('tab')) openMenu();
  if (S.shorts && input.tapped('z')) S.auto = true;         // shorts stays on autopilot
}

function reloadSky() {
  const keep = { line: S.showLine, boards: S.showBoards };
  loadTrack(S.track);
  world.setAids(keep.line, keep.boards);
  hud.toast(SKY_CYCLE[S.skyIdx].toUpperCase(), 1100);
}

// ------------------------------------------------------------------- screens
const screens = new Screens({
  input, S, PRESETS, CAR_ORDER, TIERS, TRACKS, TRACK_ORDER, getModel, renderer,
  onGo: () => go(),
});

function openMenu() {
  S.paused = true;
  attract = false;
  screens.show('mode');
}

// the title screen has a race running behind it
function startAttract() {
  attract = true;
  S.paused = false;
  const pick = TRACK_ORDER[Math.floor(Math.random() * TRACK_ORDER.length)];
  const savedCar = S.carId, savedTrack = S.track;
  S.carId = CAR_ORDER[Math.floor(Math.random() * CAR_ORDER.length)];
  loadTrack(pick, { mode: 'race', bots: 7, laps: 3 });
  S.carId = savedCar; S.track = savedTrack;                 // the attract race is not your choice
  car.setPreset(S.carId);
  rig.mode = 'tv';
  document.body.classList.add('nohud');
  screens.show('title');
  audio.start();
}

function go() {
  attract = false;
  S.paused = false;
  S.auto = S.shorts;
  S.hudOn = !S.shorts;
  S.vertical = S.shorts;
  if (S.shorts) { S.showLine = false; S.showBoards = false; }
  document.body.classList.toggle('nohud', !S.hudOn);
  document.body.classList.toggle('vertical', S.vertical);
  loadTrack(S.track);
  rig.mode = S.shorts ? 'tv' : 'chase';
  resize();
  audio.start();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  if (S.vertical) {
    const vh = h, vw = Math.min(w, Math.round(h * 9 / 16));
    renderer.setSize(vw, vh);
    camera.aspect = vw / vh;
  } else {
    renderer.setSize(w, h);
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ?t=harbor&c=gt&mode=race&bots=7&laps=3&sky=3&go=1&shorts=1 — bookmarkable
const q = new URLSearchParams(location.search);
const DBG_INPUT = (q.has('steer') || q.has('thr')) ? { steer: +(q.get('steer') || 0), throttle: +(q.get('thr') || 0), brake: 0, handbrake: 0 } : null;
if (q.has('t')) S.track = q.get('t');
if (q.has('c')) S.carId = q.get('c');
if (q.has('sky')) { S.skyIdx = +q.get('sky'); S.skyChosen = true; }
if (q.has('pace')) S.pace = +q.get('pace');
if (q.has('grip')) S.stability = +q.get('grip');
if (q.has('mode')) S.mode = q.get('mode');
if (q.has('bots')) S.bots = +q.get('bots');
if (q.has('laps')) S.laps = +q.get('laps');
if (q.has('grid')) S.grid = q.get('grid');
resize();
if (q.has('go') || q.has('shorts')) {
  S.shorts = q.has('shorts');
  if (S.shorts) S.mode = 'race';
  go();
  if (q.has('cam')) rig.mode = q.get('cam');
  if (q.has('auto')) S.auto = true;
  if (q.has('cd') && race) race.countdown = +q.get('cd');    // short lights for screenshots
} else if (q.has('screen')) {
  startAttract();
  screens.show(q.get('screen'));
} else {
  startAttract();
}
frame();
window.CRUISE = { S, car, screens, get model() { return model; }, get race() { return race; }, get bots() { return bots; } };
