// main.js — glue. Fixed-step physics, lap timing, aids, cameras, menu.

import * as THREE from 'three';
import { Car, PRESETS } from './car.js';
import { TrackModel } from './track.js';
import { TRACKS, TRACK_ORDER } from './tracks.js';
import { World, applyLighting, makeSky } from './world.js';
import { buildCar, updateCarMesh, setCarOpacity, setHeadlights } from './carmesh.js';
import { SkidMarks, Smoke } from './fx.js';
import { CameraRig, MODE_LABEL } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { LapRecorder, GhostPlayer, PaceCar, Best } from './ghost.js';
import { Audio } from './audio.js';
import { buildCity } from './city.js';
import { autoDrive } from './driver.js';

const SKY_CYCLE = ['sunset', 'noon', 'dawn', 'night'];
const MS = 2.23694;

const S = {
  track: 'harbor', carId: 'silhouette', unitMph: true,
  stability: 0.35, showLine: true, showBoards: true,
  ghostOn: true, paceOn: false, pace: 0.85, auto: false, frozen: false,
  hudOn: true, vertical: false, skyIdx: 0, skyChosen: false, running: false,
};

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 5000);
const rig = new CameraRig(camera);
const input = new Input(renderer.domElement);
const hud = new HUD(document.getElementById('hud'));
const audio = new Audio();

const car = new Car(S.carId);
let carMesh, ghostMesh, paceMesh, world, model, skyMesh, lights;
let skid, smoke;
const modelCache = new Map();

// ---------------------------------------------------------------- world setup
function getModel(id) {
  if (modelCache.has(id)) return modelCache.get(id);
  const m = id === 'city' ? buildCity() : new TrackModel(TRACKS[id]);
  modelCache.set(id, m);
  return m;
}

function clearScene() {
  if (world) world.dispose();
  if (skid) scene.remove(skid.mesh);
  if (smoke) scene.remove(smoke.points);
  for (const o of [...scene.children]) scene.remove(o);
  scene.children.length = 0;
}

function loadTrack(id) {
  S.track = id;
  clearScene();
  model = getModel(id);
  if (!S.skyChosen) S.skyIdx = Math.max(0, SKY_CYCLE.indexOf(model.def.sky));
  const skyKey = SKY_CYCLE[S.skyIdx] || model.def.sky;
  skyMesh = makeSky(scene, skyKey);
  lights = applyLighting(scene, skyKey);
  world = model.buildWorld
    ? model.buildWorld(scene, skyKey)
    : new World(model, scene, { sky: skyKey });
  world.setAids(S.showLine, S.showBoards);
  skid = new SkidMarks(scene);
  smoke = new Smoke(scene);

  carMesh = buildCar(car.p);
  scene.add(carMesh);
  ghostMesh = buildCar(car.p, 0x9fb4ff);
  setCarOpacity(ghostMesh, 0.32);
  ghostMesh.visible = false;
  scene.add(ghostMesh);
  paceMesh = buildCar(car.p, 0xf5c145);
  setCarOpacity(paceMesh, 0.55);
  paceMesh.visible = false;
  scene.add(paceMesh);

  setHeadlights(carMesh, skyKey === 'night');
  rig.setTrackCams(model);
  hud.prepareMap(model);
  pace = new PaceCar(model, S.pace);
  loadBest();
  resetCar(true);
}

// ------------------------------------------------------------------- timing
let lap = 0, bestTime = null, bestFrames = null, lastLap = null;
let sectorTimes = [null, null, null], bestSectors = [null, null, null];
let sectorIdx = 0, prevDist = 0, started = false, distTravelled = 0;
const rec = new LapRecorder();
let ghost = null, pace = null;
let driftHold = 0, driftTotal = 0, bestHold = 0, stuckT = 0;

function loadBest() {
  const b = Best.get(S.track, S.carId);
  bestTime = b ? b.time : null;
  bestFrames = b ? b.frames : null;
  ghost = bestFrames ? new GhostPlayer(bestFrames) : null;
  bestSectors = [null, null, null];
}

function resetCar(toStart) {
  const m = model;
  let p, yaw;
  if (toStart) {
    const i = Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length;
    p = m.samples[i];
  } else {
    const nr = m.nearest(car.x, car.z);
    p = m.samples[nr.i];
  }
  yaw = Math.atan2(p.tx, p.tz);
  car.reset(p.x, p.z, yaw, p.y);
  car.y = p.y;
  lap = 0; started = false; prevDist = p.s; distTravelled = 0;
  sectorTimes = [null, null, null]; sectorIdx = 0;
  rec.reset();
  if (pace) pace.reset(p.s);
  driftHold = 0; stuckT = 0;
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
  // closed: crossing the start line forwards
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
    if (want !== sectorIdx && want > sectorIdx) {          // S3 is closed out by the lap itself
      sectorTimes[sectorIdx] = rec.t - (sectorTimes[0] || 0) - (sectorIdx > 1 ? (sectorTimes[1] || 0) : 0);
      sectorIdx = want;
    }
  }
}

// ----------------------------------------------------------------- main loop
let acc = 0, last = performance.now() / 1000;
const STEP = 1 / 120;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  let dt = Math.min(now - last, 0.1);
  last = now;
  if (!S.running) { renderer.render(scene, camera); input.endFrame(); return; }

  handleKeys();
  const raw = input.read();
  const inp = S.auto ? autoDrive(car, model, S.pace) : raw;

  if (!S.frozen) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      const nr = model.nearest(car.x, car.z);
      const surf = model.surfaceAt(car.x, car.z, nr);
      car.step(STEP, inp, surf, S.stability);
      if (model.collide) model.collide(car);
      car.y = model.heightAt(car.x, car.z, model.nearest(car.x, car.z));
      acc -= STEP; steps++;
    }
    updateTiming(dt);

    // drift bookkeeping — no score, just a clock that runs while you're sideways
    const ang = Math.abs(car.driftAngle);
    if (ang > 12 && car.speed > 8 && !car.spun) { driftHold += dt; driftTotal += dt; }
    else { if (driftHold > bestHold) bestHold = driftHold; driftHold = 0; }

    // stuck / off in the weeds
    const off = model.surfaceAt(car.x, car.z);
    stuckT = (car.speed < 1.2 && !S.frozen) ? stuckT + dt : 0;
    if (S.auto && (stuckT > 2.5 || off.grip < 0.5 && car.speed < 3)) { resetCar(false); }
  }

  const nr = model.nearest(car.x, car.z);
  const surf = model.surfaceAt(car.x, car.z, nr);
  updateCarMesh(carMesh, car, dt, inp.brake > 0.05 || inp.handbrake > 0.5);
  emitFx(dt, surf);

  // ghost + pace car
  ghostMesh.visible = S.ghostOn && ghost && ghost.valid && started;
  if (ghostMesh.visible) {
    const g = ghost.at(rec.t);
    if (g) { ghostMesh.position.set(g.x, g.y, g.z); ghostMesh.rotation.set(0, g.yaw, 0); }
    else ghostMesh.visible = false;
  }
  paceMesh.visible = S.paceOn && model.closed;
  if (paceMesh.visible && !S.frozen) {
    pace.pace = S.pace;
    pace.step(dt);
    paceMesh.position.set(pace.x, pace.y, pace.z);
    paceMesh.rotation.set(0, pace.yaw, 0);
  }

  rig.update(dt, car, input.mouse);
  if (skyMesh) skyMesh.position.copy(camera.position);
  if (lights) {
    lights.dir.position.set(camera.position.x + lights.sky.dirPos[0] * 220,
      camera.position.y + lights.sky.dirPos[1] * 220, camera.position.z + lights.sky.dirPos[2] * 220);
    lights.dir.target.position.set(car.x, car.y, car.z);
    lights.dir.target.updateMatrixWorld();
  }
  smoke.update(dt);
  audio.update(car, surf);

  const gDelta = ghost && ghost.valid && started ? deltaToGhost() : null;
  hud.update(dt, {
    speedDisplay: car.speed * (S.unitMph ? MS : 3.6),
    unit: S.unitMph ? 'MPH' : 'KM/H',
    gear: car.gear, reverse: car.u < -0.4,
    rpm: car.rpm / car.p.redline,
    lap: started ? rec.t : lastLap, best: bestTime, delta: gDelta,
    sectors: sectorTimes.map((t, i) => ({
      t, state: i === sectorIdx ? 'live' : (t != null && bestSectors[i] != null && t <= bestSectors[i]) ? 'good' : t != null ? 'ok' : '',
    })),
    trackName: model.def.name, carName: car.p.label,
    aids: aidsLabel(),
    driftAngle: car.driftAngle, driftHold, grip: Math.min(car.rearSlide / 22, 1),
    throttle: inp.throttle, brake: inp.brake, steer: inp.steer,
    carX: car.x, carZ: car.z, carYaw: car.yaw,
    ghost: ghostMesh.visible ? ghostMesh.position : null,
    pace: paceMesh.visible ? pace : null,
    padHint: input.usingPad ? '🎮' : '',
  });

  renderer.render(scene, camera);
  input.endFrame();
}

function deltaToGhost() {
  // where was the ghost when it had covered the same distance?
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
  const marks = surf.grip > 0.75;
  for (const [front, right] of [[false, false], [false, true], [true, false], [true, true]]) {
    const w = car.wheelPos(front, right);
    const slide = front ? car.frontSlide : car.rearSlide;
    const key = (front ? 'f' : 'r') + (right ? 'R' : 'L');
    const inten = Math.min(Math.max(slide - 3.2, 0) / 11, 1);
    const y = model.heightAt(w.x, w.z);
    if (marks) skid.addPoint(key, w.x, y, w.z, Math.cos(car.yaw), -Math.sin(car.yaw), inten, 0.16);
    if (inten > 0.22 && Math.random() < inten * 0.9) {
      const col = marks ? [0.88, 0.88, 0.9] : [0.78, 0.68, 0.5];
      smoke.emit(w.x, y, w.z, -car.vx * 0.2, -car.vz * 0.2, inten, col);
    }
  }
  if (car.speed > 6 && surf.grip < 0.7 && Math.random() < 0.5) {
    smoke.emit(car.x, car.y, car.z, -car.vx * 0.1, -car.vz * 0.1, 0.4, [0.74, 0.64, 0.47]);
  }
}

function aidsLabel() {
  const bits = [];
  if (S.showLine) bits.push('LINE');
  if (S.showBoards) bits.push('BOARDS');
  if (S.ghostOn && ghost && ghost.valid) bits.push('GHOST');
  if (S.paceOn) bits.push('PACE ' + Math.round(S.pace * 100) + '%');
  if (S.auto) bits.push('AUTO');
  if (S.frozen) bits.push('FROZEN');
  bits.push('GRIP ' + Math.round(S.stability * 100) + '%');
  bits.push(MODE_LABEL[rig.mode]);
  return bits.join(' · ');
}

// --------------------------------------------------------------------- keys
function handleKeys() {
  if (input.tapped('c')) { rig.cycle(input.keys.has('shift') ? -1 : 1); hud.toast('CAM · ' + MODE_LABEL[rig.mode], 1200); }
  if (input.tapped('h')) { S.hudOn = !S.hudOn; document.body.classList.toggle('nohud', !S.hudOn); }
  if (input.tapped('v')) { S.vertical = !S.vertical; document.body.classList.toggle('vertical', S.vertical); resize(); }
  if (input.tapped('l')) { S.showLine = !S.showLine; world.setAids(S.showLine, S.showBoards); hud.toast('LINE ' + (S.showLine ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('b')) { S.showBoards = !S.showBoards; world.setAids(S.showLine, S.showBoards); hud.toast('BRAKE BOARDS ' + (S.showBoards ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('g')) { S.ghostOn = !S.ghostOn; hud.toast('GHOST ' + (S.ghostOn ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('p')) { S.paceOn = !S.paceOn; if (S.paceOn) pace.reset(model.nearest(car.x, car.z).p.s + 40); hud.toast('PACE CAR ' + (S.paceOn ? 'ON' : 'OFF'), 1000); }
  if (input.tapped('[')) { S.pace = Math.max(0.4, S.pace - 0.05); hud.toast('PACE ' + Math.round(S.pace * 100) + '%', 900); }
  if (input.tapped(']')) { S.pace = Math.min(1.05, S.pace + 0.05); hud.toast('PACE ' + Math.round(S.pace * 100) + '%', 900); }
  if (input.tapped(',')) { S.stability = Math.max(0, S.stability - 0.1); hud.toast('GRIP ASSIST ' + Math.round(S.stability * 100) + '%', 1000); }
  if (input.tapped('.')) { S.stability = Math.min(1, S.stability + 0.1); hud.toast('GRIP ASSIST ' + Math.round(S.stability * 100) + '%', 1000); }
  if (input.tapped('z')) { S.auto = !S.auto; hud.toast(S.auto ? 'AUTOPILOT — sit back' : 'AUTOPILOT OFF', 1400); }
  if (input.tapped('f')) { S.frozen = !S.frozen; if (S.frozen) rig.mode = 'orbit'; hud.toast(S.frozen ? 'FROZEN — drag to orbit' : 'ROLLING', 1200); }
  if (input.tapped('r')) resetCar(false);
  if (input.tapped('t')) resetCar(true);
  if (input.tapped('x')) { skid.clear(); smoke.clear(); hud.toast('MARKS CLEARED', 900); }
  if (input.tapped('n')) { S.skyIdx = (S.skyIdx + 1) % SKY_CYCLE.length; S.skyChosen = true; reloadSky(); }
  if (input.tapped('m')) hud.toast('SOUND ' + (audio.toggle() ? 'ON' : 'OFF'), 900);
  if (input.tapped('u')) { S.unitMph = !S.unitMph; }
  if (input.tapped('escape') || input.tapped('tab')) openMenu();
}

function reloadSky() {
  const keep = { line: S.showLine, boards: S.showBoards };
  loadTrack(S.track);
  world.setAids(keep.line, keep.boards);
  hud.toast(SKY_CYCLE[S.skyIdx].toUpperCase(), 1100);
}

// --------------------------------------------------------------------- menu
const menu = document.getElementById('menu');
function openMenu() { S.running = false; menu.classList.remove('hidden'); }
function closeMenu() { menu.classList.add('hidden'); S.running = true; last = performance.now() / 1000; audio.start(); }

function buildMenu() {
  const tw = document.getElementById('trackList');
  const ids = [...TRACK_ORDER, 'city'];
  tw.innerHTML = ids.map(id => {
    const d = id === 'city' ? { name: 'THE CITY', blurb: 'free roam · 30 blocks · a street circuit through it' } : TRACKS[id];
    return `<button class="card ${id === S.track ? 'sel' : ''}" data-track="${id}">
      <b>${d.name}</b><span>${d.blurb}</span></button>`;
  }).join('');
  tw.onclick = e => {
    const b = e.target.closest('[data-track]');
    if (!b) return;
    S.track = b.dataset.track;
    buildMenu();
  };
  const cw = document.getElementById('carList');
  cw.innerHTML = Object.entries(PRESETS).map(([id, p]) =>
    `<button class="card ${id === S.carId ? 'sel' : ''}" data-car="${id}"><b>${p.label}</b><span>${p.blurb}</span></button>`).join('');
  cw.onclick = e => {
    const b = e.target.closest('[data-car]');
    if (!b) return;
    S.carId = b.dataset.car;
    buildMenu();
  };
  const sky = document.getElementById('skyList');
  sky.innerHTML = SKY_CYCLE.map((k, i) =>
    `<button class="chip ${i === S.skyIdx ? 'sel' : ''}" data-sky="${i}">${k.toUpperCase()}</button>`).join('');
  sky.onclick = e => {
    const b = e.target.closest('[data-sky]');
    if (!b) return;
    S.skyIdx = +b.dataset.sky;
    S.skyChosen = true;
    buildMenu();
  };
}

document.getElementById('drive').onclick = () => {
  car.setPreset(S.carId);
  loadTrack(S.track);
  closeMenu();
};
document.getElementById('shorts').onclick = () => {
  car.setPreset(S.carId);
  loadTrack(S.track);
  S.auto = true; S.hudOn = false; S.vertical = true; S.showLine = false; S.showBoards = false;
  document.body.classList.add('nohud', 'vertical');
  world.setAids(false, false);
  rig.mode = 'tv';
  closeMenu();
  resize();
  hud.toast('', 1);
};

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

// ?t=harbor&c=gt&sky=3&go=1&shorts=1 — bookmarkable, and how the screenshot
// tool gets in without a click.
const q = new URLSearchParams(location.search);
if (q.has('t')) S.track = q.get('t');
if (q.has('c')) S.carId = q.get('c');
if (q.has('sky')) { S.skyIdx = +q.get('sky'); S.skyChosen = true; }
if (q.has('pace')) S.pace = +q.get('pace');
if (q.has('grip')) S.stability = +q.get('grip');
buildMenu();
resize();
if (q.has('go') || q.has('shorts')) {
  car.setPreset(S.carId);
  loadTrack(S.track);
  if (q.has('shorts')) {
    S.auto = true; S.hudOn = false; S.vertical = true; S.showLine = false; S.showBoards = false;
    document.body.classList.add('nohud', 'vertical');
    world.setAids(false, false);
    rig.mode = 'tv';
    resize();
  }
  if (q.has('cam')) rig.mode = q.get('cam');
  if (q.has('auto')) S.auto = true;
  closeMenu();
}
frame();
window.CRUISE = { S, car, get model() { return model; } };
