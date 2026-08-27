// carmesh.js — low-poly car built from boxes. Wheels steer and spin, the body
// leans on its springs, brake lights come on. Nothing fancy, reads great at 60.

import * as THREE from 'three';

const flat = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...opts });

export function buildCar(preset, colorOverride) {
  const b = preset.body;
  const g = new THREE.Group();
  const paint = flat(colorOverride ?? b.color);
  const dark = flat(0x1a1c22);
  const glass = flat(b.cabin, { transparent: true, opacity: 0.92 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.hood, b.l), paint);
  hull.position.y = b.hood / 2 + 0.28;
  hull.castShadow = true;
  g.add(hull);

  // nose and tail tapers
  const nose = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.9, b.hood * 0.62, b.l * 0.2), paint);
  nose.position.set(0, b.hood * 0.42 + 0.28, b.l * 0.5);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.95, b.hood * 0.7, b.l * 0.16), paint);
  tail.position.set(0, b.hood * 0.46 + 0.28, -b.l * 0.5);
  g.add(tail);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.86, b.roof - b.hood - 0.1, b.l * 0.42), glass);
  cabin.position.set(0, b.hood + (b.roof - b.hood) / 2 + 0.22, -b.l * 0.04);
  cabin.castShadow = true;
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, 0.12, b.l * 0.36), paint);
  roof.position.set(0, b.roof + 0.2, -b.l * 0.05);
  g.add(roof);

  // lights
  const head = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
  const tailM = new THREE.MeshBasicMaterial({ color: 0x5a1512 });
  const lights = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.22, 0.16, 0.1), head);
    h.position.set(sx * b.w * 0.3, b.hood * 0.62 + 0.28, b.l * 0.59);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.24, 0.14, 0.1), tailM.clone());
    t.position.set(sx * b.w * 0.32, b.hood * 0.66 + 0.28, -b.l * 0.58);
    g.add(t);
    lights.push(t);
  }
  // wing
  const wing = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 0.08, 0.34), dark);
  wing.position.set(0, b.roof * 0.86, -b.l * 0.54);
  g.add(wing);
  for (const sx of [-1, 1]) {
    const stay = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.16), dark);
    stay.position.set(sx * b.w * 0.34, b.roof * 0.74, -b.l * 0.54);
    g.add(stay);
  }

  // wheels
  const wr = b.wheel;
  const tireG = new THREE.CylinderGeometry(wr, wr, 0.26, 12);
  tireG.rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(wr * 0.56, wr * 0.56, 0.28, 6);
  rimG.rotateZ(Math.PI / 2);
  const tireM = flat(0x14161a);
  const rimM = flat(0xb9bcc4);
  const wheels = [];
  const layout = [[-1, 1], [1, 1], [-1, -1], [1, -1]];      // [side, front]
  for (const [sx, fz] of layout) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(tireG, tireM);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimG, rimM);
    w.add(tire, rim);
    w.position.set(sx * (b.w / 2 - 0.04), wr, fz > 0 ? preset.lf * 0.92 : -preset.lr * 0.92);
    w.userData = { front: fz > 0, side: sx, tire };
    g.add(w);
    wheels.push(w);
  }

  // headlights — off unless it's night, then they're the whole mood
  const beams = [];
  for (const sx of [-1, 1]) {
    const sl = new THREE.SpotLight(0xffe8c0, 0, 70, 0.52, 0.55, 1.1);
    sl.position.set(sx * b.w * 0.3, b.hood * 0.6 + 0.3, b.l * 0.5);
    const tgt = new THREE.Object3D();
    tgt.position.set(sx * b.w * 0.3, -1.6, b.l * 0.5 + 26);
    g.add(sl, tgt);
    sl.target = tgt;
    beams.push(sl);
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w * 1.5, b.l * 1.12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  g.add(shadow);

  g.userData = { wheels, lights, beams, shadow, body: g.children, preset };
  return g;
}

export function updateCarMesh(mesh, car, dt, braking) {
  const u = mesh.userData;
  mesh.position.set(car.x, car.y, car.z);
  mesh.rotation.set(car.pitch, car.yaw, car.roll, 'YXZ');
  const spin = (car.u / (car.p.body.wheel || 0.34)) * dt + car.wheelSpin * dt * 26;
  for (const w of u.wheels) {
    w.rotation.y = w.userData.front ? car.steer : 0;
    w.userData.tire.rotation.x += spin;
  }
  const lit = braking ? 0xff3b2f : 0x5a1512;
  for (const l of u.lights) l.material.color.setHex(lit);
}

export function setHeadlights(mesh, on) {
  for (const b of mesh.userData.beams || []) b.intensity = on ? 26 : 0;
  for (const l of mesh.userData.body || []) {
    if (l.material && l.material.color && l.material.color.getHex() === 0xfff2cc) l.material.color.setHex(on ? 0xffffff : 0xfff2cc);
  }
}

export function setCarOpacity(mesh, o) {
  mesh.traverse(n => {
    if (!n.material) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) { m.transparent = true; m.opacity = o; m.depthWrite = o > 0.9; }
  });
}
