// carmesh.js — real bodies. Each car is a Kenney Car Kit GLB (CC0): a body node
// plus four named wheel nodes. We load once, clone per car, scale the body to
// the preset, and re-hang the wheels at the physics contact patches so each one
// rides its own suspension. Until the GLB arrives there's a plain box so the
// game never waits on the network.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();               // file -> Promise<Group>

function loadModel(file) {
  if (!cache.has(file)) {
    cache.set(file, new Promise((resolve, reject) => {
      loader.load(`assets/models/${file}.glb`, g => resolve(g.scene), undefined, reject);
    }));
  }
  return cache.get(file);
}

const WHEEL_NAMES = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];
// physics wheel order: 0 FL, 1 FR, 2 RL, 3 RR — and physics +b is the model's -x
// (the sim's "right" is the screen's left, see input.js), so front-left in the
// model is wheel 1 in the sim. Sounds backwards; it isn't.
const MODEL_TO_PHYS = { 'wheel-front-left': 1, 'wheel-front-right': 0, 'wheel-back-left': 3, 'wheel-back-right': 2 };

const flat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

function applyTint(root, tint, opacity) {
  root.traverse(n => {
    if (!n.isMesh) return;
    n.material = n.material.clone();
    if (tint != null) { n.material.color.setHex(tint); n.material.emissive?.setHex(tint); if (n.material.emissive) n.material.emissiveIntensity = 0.25; }
    if (opacity != null) { n.material.transparent = true; n.material.opacity = opacity; n.material.depthWrite = opacity > 0.9; }
  });
}

export function buildCar(preset, tint) {
  const g = new THREE.Group();
  const m = preset.model;
  const S = m.scale, sx = S * (m.stretchX ?? 1), sz = S * (m.stretchZ ?? 1);

  // placeholder until the GLB lands
  const box = new THREE.Mesh(new THREE.BoxGeometry(preset.track, 0.9, preset.lf + preset.lr), flat(0x444a55));
  box.position.y = 0.7;
  g.add(box);

  // wheel groups: the physics drives these; the model's wheel meshes get parented in
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    w.userData = { r: i < 2 ? preset.tyre.rf : preset.tyre.rr, spinner: null };
    g.add(w);
    wheels.push(w);
  }

  // headlight beams (night only) and brake lights
  const beams = [];
  const lights = [];
  const nose = preset.lf + 0.3, tail = -preset.lr - 0.3;
  for (const s of [-1, 1]) {
    const sl = new THREE.SpotLight(0xffe8c0, 0, 70, 0.52, 0.55, 1.1);
    sl.position.set(s * preset.track * 0.36, 0.7, nose);
    const tgt = new THREE.Object3D();
    tgt.position.set(s * preset.track * 0.36, -1.6, nose + 26);
    g.add(sl, tgt);
    sl.target = tgt;
    beams.push(sl);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.05), new THREE.MeshBasicMaterial({ color: 0x5a1512 }));
    t.position.set(s * preset.track * 0.36, 0.72, tail);
    g.add(t);
    lights.push(t);
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(preset.track * 1.35, m.len * 1.08),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  g.add(shadow);

  g.userData = { wheels, lights, beams, shadow, preset, tint, opacity: null, ready: false };

  loadModel(m.file).then(scene => {
    const root = scene.clone(true);
    // clone() shares materials with the cached scene and every other car —
    // give this car its own set FIRST, or a ghost's 30% opacity leaks onto
    // everyone's wheels (it did)
    root.traverse(n => {
      if (!n.isMesh) return;
      n.material = Array.isArray(n.material) ? n.material.map(mm => mm.clone()) : n.material.clone();
    });
    // pull the wheels out, keep the rest as the body
    for (const name of WHEEL_NAMES) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      node.parent.remove(node);
      const idx = MODEL_TO_PHYS[name];
      const phys = wheels[idx];
      node.position.set(0, 0, 0);
      node.rotation.set(0, 0, 0);
      // wheel scale: the physics radius, whatever the model's is
      const k = phys.userData.r / m.wheelR;
      node.scale.set(k, k, k);
      node.traverse(n => { if (n.isMesh) { n.castShadow = true; } });
      phys.add(node);
      phys.userData.spinner = node;
    }
    // body: uniform scale, stretched a little sideways to cover the track, and
    // lifted so its wheel arches sit around wheels at ride height
    root.scale.set(sx, S, sz);
    const arch = m.wheelR * S;                                  // where the model expects its wheel centre
    root.position.y = wheels[0].userData.r - arch;
    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; } });
    if (tint != null || g.userData.opacity != null) applyTint(root, tint, g.userData.opacity);
    g.remove(box);
    g.add(root);
    g.userData.body = root;
    g.userData.ready = true;
    if (g.userData.opacity != null) setCarOpacity(g, g.userData.opacity);
  }).catch(err => console.warn('model failed', m.file, err));

  return g;
}

// The body is drawn at the sprung-mass position and attitude; each wheel is
// dropped to where the physics says the ground is.
export function updateCarMesh(mesh, car, dt, braking) {
  const u = mesh.userData;
  mesh.position.set(car.x, car.y, car.z);
  mesh.rotation.set(-car.pitch, car.yaw, car.roll, 'YXZ');
  for (let i = 0; i < 4; i++) {
    const pw = car.wheels[i], w = u.wheels[i];
    const localY = w.userData.r - Math.max(-car.p.susp.travel * 1.6, Math.min(car.p.susp.travel * 1.05, pw.disp));
    w.position.set(pw.b, localY, pw.a);
    w.rotation.set(0, pw.steer, 0);
    if (w.userData.spinner) w.userData.spinner.rotation.x = pw.spin;
  }
  let gy = 0;
  for (const pw of car.wheels) gy += pw.ground;
  u.shadow.position.y = (gy / 4 - car.y) + 0.02;
  u.shadow.rotation.set(-Math.PI / 2 + car.pitch, 0, -car.roll);
  const lit = braking ? 0xff3b2f : 0x5a1512;
  for (const l of u.lights) l.material.color.setHex(lit);
}

export function setHeadlights(mesh, on) {
  for (const b of mesh.userData.beams || []) b.intensity = on ? 26 : 0;
}

export function setCarOpacity(mesh, o) {
  mesh.userData.opacity = o;
  mesh.traverse(n => {
    if (!n.material || n === mesh.userData.shadow) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) { m.transparent = true; m.opacity = o; m.depthWrite = o > 0.9; }
  });
}

// Ghost / pace body: no physics, so the wheels sit at rest height.
export function placeStaticCar(mesh, x, y, z, yaw) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(0, yaw, 0);
  const u = mesh.userData, p = u.preset;
  for (let i = 0; i < 4; i++) {
    const w = u.wheels[i];
    w.position.set((i % 2 ? 1 : -1) * p.track * 0.5, w.userData.r, i < 2 ? p.lf : -p.lr);
    w.rotation.set(0, 0, 0);
  }
  u.shadow.position.y = 0.02;
}
