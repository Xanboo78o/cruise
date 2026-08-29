// carmesh.js — real bodies. Each car is a Kenney Car Kit GLB (CC0): a body node
// plus four named wheel nodes. We load once, clone per car, scale the body to
// the preset, and re-hang the wheels at the physics contact patches so each one
// rides its own suspension. Until the GLB arrives there's a plain box so the
// game never waits on the network. Arcade state (nitro, shield, mega, zapped)
// gets its own little effects here too.

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

const flat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, ...o });

function applyTint(root, tint, opacity) {
  root.traverse(n => {
    if (!n.isMesh) return;
    if (tint != null) { n.material.color.setHex(tint); n.material.emissive?.setHex(tint); if (n.material.emissive) n.material.emissiveIntensity = 0.25; }
    if (opacity != null) { n.material.transparent = true; n.material.opacity = opacity; n.material.depthWrite = opacity > 0.9; }
  });
}

// opts: { tint, lights (headlight spots — player only, they're expensive) }
export function buildCar(preset, opts = {}) {
  const g = new THREE.Group();
  const m = preset.model;
  const S = m.scale, sx = S * (m.stretchX ?? 1), sz = S * (m.stretchZ ?? 1);
  const tint = opts.tint ?? null;

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

  const nose = preset.lf + 0.3, tail = -preset.lr - 0.3;
  const beams = [];
  const lights = [];
  for (const s of [-1, 1]) {
    if (opts.lights) {
      const sl = new THREE.SpotLight(0xffe8c0, 0, 70, 0.52, 0.55, 1.1);
      sl.position.set(s * preset.track * 0.36, 0.7, nose);
      const tgt = new THREE.Object3D();
      tgt.position.set(s * preset.track * 0.36, -1.6, nose + 26);
      g.add(sl, tgt);
      sl.target = tgt;
      beams.push(sl);
    }
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.05), new THREE.MeshBasicMaterial({ color: 0x5a1512 }));
    t.position.set(s * preset.track * 0.36, 0.72, tail);
    g.add(t);
    lights.push(t);
  }

  // --- arcade effects
  // nitro: two flames out the back
  const flameG = new THREE.ConeGeometry(0.28, 1.6, 7);
  flameG.rotateX(Math.PI / 2);
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(flameG, new THREE.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.set(s * preset.track * 0.28, 0.5, tail - 0.9);
    f.visible = false;
    g.add(f);
    flames.push(f);
  }
  // shield: a bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(preset.track, (preset.lf + preset.lr) * 0.62) * 1.05, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0x6fe3a0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  bubble.position.y = 0.9;
  bubble.visible = false;
  g.add(bubble);
  // zapped: a ring of sparks over the roof
  const zapRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 18), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  zapRing.rotation.x = Math.PI / 2;
  zapRing.position.y = 2.2;
  zapRing.visible = false;
  g.add(zapRing);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(preset.track * 1.35, m.len * 1.08),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  g.add(shadow);

  g.userData = { wheels, lights, beams, flames, bubble, zapRing, shadow, preset, tint, opacity: null, ready: false, megaK: 1 };

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
      const k = phys.userData.r / m.wheelR;                    // physics radius, whatever the model's is
      node.scale.set(k, k, k);
      node.traverse(n => { if (n.isMesh) n.castShadow = true; });
      phys.add(node);
      phys.userData.spinner = node;
    }
    // body: uniform scale, stretched a little sideways to cover the track, and
    // lifted so its wheel arches sit around wheels at ride height
    root.scale.set(sx, S, sz);
    const arch = m.wheelR * S;
    root.position.y = wheels[0].userData.r - arch;
    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; } });
    if (tint != null || g.userData.opacity != null) applyTint(root, tint, g.userData.opacity);
    g.remove(box);
    g.add(root);
    g.userData.body = root;
    g.userData.ready = true;
    if (g.userData.opacity != null) setCarOpacity(g, g.userData.opacity);
    if (opts.onReady) opts.onReady(g);
  }).catch(err => console.warn('model failed', m.file, err));

  return g;
}

// The body is drawn at the sprung-mass position and attitude; each wheel is
// dropped to where the physics says the ground is.
export function updateCarMesh(mesh, car, dt, braking, time = 0) {
  const u = mesh.userData;
  mesh.position.set(car.x, car.y, car.z);
  mesh.rotation.set(-car.pitch, car.yaw, car.roll, 'YXZ');
  // MEGA: the whole thing grows, wheels included
  const wantK = car.megaT > 0 ? 1.55 : 1;
  u.megaK += (wantK - u.megaK) * Math.min(1, dt * 6);
  mesh.scale.setScalar(u.megaK);
  for (let i = 0; i < 4; i++) {
    const pw = car.wheels[i], w = u.wheels[i];
    const localY = w.userData.r - Math.max(-car.p.susp.travel * 1.6, Math.min(car.p.susp.travel * 1.05, pw.disp));
    w.position.set(pw.b, localY, pw.a);
    w.rotation.set(0, pw.steer, 0);
    if (w.userData.spinner) w.userData.spinner.rotation.x = pw.spin;
  }
  let gy = 0;
  for (const pw of car.wheels) gy += pw.ground;
  u.shadow.position.y = (gy / 4 - car.y) / u.megaK + 0.02;
  u.shadow.rotation.set(-Math.PI / 2 + car.pitch, 0, -car.roll);
  const lit = braking ? 0xff3b2f : 0x5a1512;
  for (const l of u.lights) l.material.color.setHex(lit);

  // effects
  const boosting = car.boostT > 0 && car.speed > 2;
  for (const f of u.flames) {
    f.visible = boosting;
    if (boosting) {
      const fl = 0.8 + Math.sin(time * 60 + f.position.x * 9) * 0.25;
      f.scale.set(fl, fl, 1.1 + Math.min(car.boostT, 1.5) * 0.9 + Math.random() * 0.3);
      f.material.opacity = 0.55 + Math.random() * 0.35;
    }
  }
  u.bubble.visible = car.shieldT > 0;
  if (u.bubble.visible) {
    const pulse = 1 + Math.sin(time * 9) * 0.04;
    u.bubble.scale.setScalar(pulse);
    u.bubble.material.opacity = car.shieldT < 1 ? 0.22 * (0.4 + 0.6 * Math.abs(Math.sin(time * 18))) : 0.22;
  }
  u.zapRing.visible = car.stunT > 0;
  if (u.zapRing.visible) { u.zapRing.rotation.z = time * 12; u.zapRing.material.color.setHex(Math.sin(time * 40) > 0 ? 0xffe066 : 0xffffff); }
}

// the Oo behind the wheel: the character lifted out of a kart, sat in the cabin
const alienCache = new Map();
function loadAlien(variant) {
  if (!alienCache.has(variant)) alienCache.set(variant, new Promise(res => loader.load(`assets/models/kart-${variant}.glb`, g => {
    const node = g.scene.getObjectByName('character');
    if (!node) return res(null);
    node.updateMatrixWorld(true);
    let mesh = null;
    node.traverse(n => { if (n.isMesh && !mesh) { const geo = n.geometry.clone(); geo.applyMatrix4(n.matrixWorld); geo.computeBoundingBox(); const bb = geo.boundingBox; geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); const h = bb.max.y - bb.min.y; geo.scale(1 / h, 1 / h, 1 / h); mesh = new THREE.Mesh(geo, n.material.clone()); } });
    res(mesh);
  })));
  return alienCache.get(variant);
}
export function loadAlienMesh(variant) { return loadAlien(variant); }

// stickers: a strip on the roof with whatever you've earned
export function setStickers(mesh, list) {
  const u = mesh.userData;
  if (u.stickerMesh) { mesh.remove(u.stickerMesh); u.stickerMesh = null; }
  if (!list || !list.length) return;
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 64);
  const pal = ['#ff9a5c', '#7ea6ff', '#ffd98a', '#ff6b8f', '#6fe3a0', '#ffe066'];
  list.slice(0, 6).forEach((s, i) => {
    g.fillStyle = pal[i % pal.length]; g.beginPath(); g.roundRect(4 + i * 42, 8, 38, 48, 8); g.fill();
    g.fillStyle = '#151820'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = String(s).split(' ');
    g.fillText(w[0].slice(0, 6), 23 + i * 42, w.length > 1 ? 26 : 32); if (w.length > 1) g.fillText(w[1].slice(0, 6), 23 + i * 42, 42);
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const p = u.preset;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(p.track * 0.7, 1.3), Math.min(p.track * 0.7, 1.3) * 0.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  plane.rotation.x = -Math.PI / 2; plane.rotation.z = Math.PI / 2;
  plane.position.set(0, 0.4 + p.tyre.rf * 0.6 + 1.3, -p.lr * 0.3);
  plane.renderOrder = 3;
  mesh.add(plane); u.stickerMesh = plane;
}
export function setDriver(mesh, variant) {
  const u = mesh.userData;
  if (u.driver) { mesh.remove(u.driver); u.driver = null; }
  loadAlien(variant).then(proto => {
    if (!proto || u.driver) return;
    const p = u.preset;
    const d = proto.clone();
    const size = Math.min(1.35, Math.max(0.9, p.track * 0.62));
    d.scale.setScalar(size);
    d.position.set(p.track * -0.16, 0.42 + p.tyre.rf * 0.6, (p.lf - p.lr) * 0.5 - 0.1);   // driver's side, sat down
    d.castShadow = true;
    mesh.add(d);
    u.driver = d;
  });
}

export function setHeadlights(mesh, on) {
  for (const b of mesh.userData.beams || []) b.intensity = on ? 26 : 0;
}

export function setCarOpacity(mesh, o) {
  mesh.userData.opacity = o;
  mesh.traverse(n => {
    if (!n.material || n === mesh.userData.shadow) return;
    if (n === mesh.userData.bubble || mesh.userData.flames.includes(n)) return;
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
