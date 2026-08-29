// cockpit.js — the inside of the car. No HUD: the speedo is a real dial on a
// real dashboard, the map is a screen in the console, and your hands are on the
// wheel. Everything here hangs off the car mesh, so it rides the body's heave,
// pitch and roll for free — that shake is the physics, not an effect.
//
// Layout note (the one that catches everyone): the model's +x is the car's LEFT
// (the sim calls +x "right" and three.js puts it on the screen's left, see
// input.js). +z is forward. Local y = 0 is the ground at static ride height.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIAL } from './look/speed.js';

const TRIM = 0x3d434c;        // dark plastic
const TRIM2 = 0x2c3138;       // darker plastic
const FABRIC = 0x2c3138;      // seats
const METAL = 0x6a7078;
const BEZEL = 0x15181d;

// paint a geometry with one flat colour so a pile of parts can merge into one mesh
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const rad = d => d * Math.PI / 180;

export class Cockpit {
  // parent: the car mesh. Everything is a child of it, so the car's transform is ours.
  constructor(parent, preset, opts = {}) {
    this.p = preset;
    this.arms = opts.arms !== false;
    const k = preset.track / 1.56;                    // everything scales off track width
    const W = preset.track, L = preset.lf + preset.lr;
    this.k = k;
    // Cabin proportions are the whole job: sit too low and you see dashboard, sit
    // too close to the header and you're driving a letterbox. Real numbers for a
    // hatchback, scaled: beltline 1.0, roof 1.62, eye 1.20, header 0.25 m ahead.
    const roofH = 1.62 * k, sillH = 1.00 * k, floorY = 0.34 * k;
    const sx = 0.26 * W;                              // driver's side (+x is the car's left: LHD)
    const eyeY = 1.18 * k, eyeZ = -0.05 * L;
    const dashZ = 0.36 * L, dashTop = 0.98 * k, headerZ = 0.09 * L;
    this.sx = sx; this.eyeY = eyeY; this.roofH = roofH;

    this.group = new THREE.Group();
    this.group.renderOrder = 2;
    parent.add(this.group);

    // ---------------------------------------------------------------- shell
    // one merged mesh: floor, doors, roof, pillars, dash, console, seats
    const S = [];
    const put = (geo, col, x, y, z, rx = 0, ry = 0, rz = 0) => {
      if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz);
      geo.translate(x, y, z);
      S.push(paint(geo, col));
    };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

    const halfW = W * 0.52;
    put(B(W * 1.02, 0.06, L * 1.25), TRIM2, 0, floorY, -0.05 * L);                    // floor
    put(B(0.07, sillH - floorY, L * 1.05), TRIM, halfW, (floorY + sillH) / 2, -L * 0.05);   // door cards
    put(B(0.07, sillH - floorY, L * 1.05), TRIM, -halfW, (floorY + sillH) / 2, -L * 0.05);
    put(B(0.13, 0.08, L * 1.05), TRIM2, halfW, sillH, -L * 0.05);                     // window sills
    put(B(0.13, 0.08, L * 1.05), TRIM2, -halfW, sillH, -L * 0.05);
    put(B(W * 1.04, 0.06, L * 0.80), TRIM2, 0, roofH, headerZ - L * 0.40);            // roof
    put(B(W * 1.02, roofH - sillH, 0.07), TRIM2, 0, (sillH + roofH) / 2, headerZ - L * 0.80);  // rear bulkhead
    // A-pillars: sill to header, leaning BACK over the driver
    const pillarLen = Math.hypot(roofH - sillH, dashZ + 0.05 - headerZ);
    for (const sgn of [1, -1]) {
      const g = B(0.09, pillarLen, 0.10);
      put(g, TRIM2, sgn * halfW * 0.94, (sillH + roofH) / 2, (dashZ + 0.05 + headerZ) / 2,
          -Math.atan2(dashZ + 0.05 - headerZ, roofH - sillH));
    }
    put(B(W * 1.0, 0.10, 0.14), TRIM2, 0, roofH - 0.04, headerZ);                     // windscreen header

    // dash: a face, a top cowl that catches the sun, a lip underneath
    put(B(W * 1.0, 0.30 * k, 0.16), TRIM, 0, dashTop - 0.16 * k, dashZ);              // face
    put(B(W * 1.0, 0.05, 0.34), TRIM2, 0, dashTop, dashZ + 0.13, rad(-7));            // cowl, forward of the pod
    put(B(W * 1.0, 0.10, 0.10), TRIM2, 0, dashTop - 0.32 * k, dashZ - 0.03);          // lower lip
    // the bonnet: the real body's is back-facing from in here, so you'd see none of it
    put(B(W * 0.95, 0.05, L * 0.55), TRIM2, 0, dashTop - 0.06 * k, dashZ + L * 0.30, rad(-1.5));
    // binnacle hood over the dials
    put(B(0.50 * k, 0.05, 0.22), TRIM2, sx, dashTop + 0.15 * k, dashZ - 0.17, rad(-14));
    put(B(0.50 * k, 0.21 * k, 0.16), TRIM, sx, dashTop + 0.03 * k, dashZ + 0.02);      // pod body, BEHIND the cluster
    for (const sgn of [1, -1])                                                        // pod cheeks
      put(B(0.05, 0.18 * k, 0.22), TRIM2, sx + sgn * 0.235 * k, dashTop + 0.06 * k, dashZ - 0.15);
    // centre console between the seats
    put(B(0.26 * k, 0.34 * k, L * 0.55), TRIM, 0, floorY + 0.18 * k, L * 0.02);
    // steering column shroud
    const col = new THREE.CylinderGeometry(0.045 * k, 0.055 * k, 0.32 * k, 8);
    put(col, TRIM2, sx, 0.85 * k, dashZ - 0.24, rad(90 - 22));
    // seats: yours (behind the eye, you catch its edges) and the empty one beside you
    for (const sgn of [1, -1]) {
      const x = sgn * sx;
      put(B(0.46 * k, 0.10, 0.48 * k), FABRIC, x, floorY + 0.26 * k, -L * 0.14);      // base
      put(B(0.46 * k, 0.56 * k, 0.10), FABRIC, x, floorY + 0.58 * k, -L * 0.28, rad(-9)); // back
      put(B(0.22 * k, 0.17 * k, 0.09), FABRIC, x, floorY + 0.92 * k, -L * 0.31);      // headrest
    }
    // gear lever base + mirror
    put(B(0.15 * k, 0.05, 0.17 * k), TRIM2, 0, floorY + 0.36 * k, L * 0.04);
    put(B(0.28 * k, 0.09 * k, 0.04), BEZEL, 0, roofH - 0.13, headerZ + 0.06, rad(6));  // rear-view mirror

    const shell = new THREE.Mesh(mergeGeometries(S, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 }));
    shell.frustumCulled = false;
    this.group.add(shell);
    this.shell = shell;

    // ------------------------------------------------------------ the wheel
    // column tilted back; the wheel spins about the column axis
    this.wheelR = 0.185 * k;
    const wheelPos = new THREE.Vector3(sx, 0.80 * k, dashZ - 0.40);
    this.column = new THREE.Group();
    this.column.position.copy(wheelPos);
    this.column.rotation.x = rad(-(180 - 22));         // face the driver, tilted like a real column
    this.group.add(this.column);
    this.wheel = new THREE.Group();
    this.column.add(this.wheel);

    const R = this.wheelR, WP = [];
    const rim = new THREE.TorusGeometry(R, R * 0.16, 6, 20);
    WP.push(paint(rim, TRIM2));
    const hub = new THREE.CylinderGeometry(R * 0.30, R * 0.30, R * 0.20, 10);
    hub.rotateX(Math.PI / 2);
    WP.push(paint(hub, TRIM));
    for (const a of [rad(180), rad(300), rad(60)]) {   // three spokes, one down
      const sp = new THREE.BoxGeometry(R * 0.72, R * 0.16, R * 0.10);
      sp.translate(R * 0.5, 0, 0);
      sp.rotateZ(a);
      WP.push(paint(sp, TRIM));
    }
    const wm = new THREE.Mesh(mergeGeometries(WP, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    wm.frustumCulled = false;
    this.wheel.add(wm);

    // ------------------------------------------------------------- the dials
    // the faces are drawn once into a texture; the needles are real geometry, so
    // nothing uploads a canvas every frame
    this.dialW = 0.42 * k; this.dialH = 0.21 * k;
    this.dialCanvas = document.createElement('canvas');
    this.dialCanvas.width = 1024; this.dialCanvas.height = 512;
    this.vMax = Math.max(100, Math.ceil((preset.vMax * 2.23694 * DIAL) / 20) * 20);
    this.drawDialFace();
    const dialTex = new THREE.CanvasTexture(this.dialCanvas);
    dialTex.colorSpace = THREE.SRGBColorSpace;
    dialTex.anisotropy = 4;
    this.binnacle = new THREE.Group();
    this.binnacle.position.set(sx, dashTop - 0.01 * k, dashZ - 0.115);
    this.binnacle.rotation.set(rad(14), Math.PI, 0);    // faces the driver, tipped back
    this.group.add(this.binnacle);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(this.dialW, this.dialH),
      new THREE.MeshBasicMaterial({ map: dialTex, toneMapped: true }));
    face.frustumCulled = false;
    this.binnacle.add(face);

    // canvas pixels -> plane metres: the layout lives in drawDialFace and
    // everything that moves is placed from the same numbers
    const at = (cx, cy) => new THREE.Vector3((cx / 1024 - 0.5) * this.dialW, (0.5 - cy / 512) * this.dialH, 0.004);
    this.speedNeedle = this.makeNeedle(at(300, 256), this.dialH * 0.42, 0xe8483a);

    // the rev bar: a box that grows from its left end. No texture, no upload.
    const barW = (980 - 600) / 1024 * this.dialW, barH = 44 / 512 * this.dialH;
    const bg = new THREE.BoxGeometry(barW, barH, 0.004);
    bg.translate(barW / 2, 0, 0);
    this.revBar = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xf5c145 }));
    this.revBar.position.copy(at(600, 118));
    this.revBar.frustumCulled = false;
    this.binnacle.add(this.revBar);

    // the numbers sit in their own pocket to the right of the dial
    this.digitCanvas = document.createElement('canvas');
    this.digitCanvas.width = 256; this.digitCanvas.height = 96;
    this.digitTex = new THREE.CanvasTexture(this.digitCanvas);
    this.digitTex.colorSpace = THREE.SRGBColorSpace;
    const digits = new THREE.Mesh(new THREE.PlaneGeometry((980 - 600) / 1024 * this.dialW, 140 / 512 * this.dialH),
      new THREE.MeshBasicMaterial({ map: this.digitTex, transparent: true }));
    digits.position.copy(at(790, 262));
    digits.frustumCulled = false;
    this.binnacle.add(digits);
    this.digitT = 0;

    // ---------------------------------------------------------------- the GPS
    this.gpsCanvas = document.createElement('canvas');
    this.gpsCanvas.width = 256; this.gpsCanvas.height = 256;
    this.gpsTex = new THREE.CanvasTexture(this.gpsCanvas);
    this.gpsTex.colorSpace = THREE.SRGBColorSpace;
    const gs = 0.19 * k;
    this.gps = new THREE.Group();
    this.gps.position.set(-0.13 * W, dashTop - 0.12 * k, dashZ - 0.13);
    this.gps.rotation.set(rad(22), Math.PI - rad(14), 0);    // angled up and toward the driver
    this.group.add(this.gps);
    const gpsBez = new THREE.Mesh(new THREE.BoxGeometry(gs * 1.12, gs * 1.12, 0.012),
      new THREE.MeshStandardMaterial({ color: BEZEL, roughness: 0.6 }));
    gpsBez.position.z = -0.008;
    this.gps.add(gpsBez);
    const gpsScreen = new THREE.Mesh(new THREE.PlaneGeometry(gs, gs),
      new THREE.MeshBasicMaterial({ map: this.gpsTex }));
    gpsScreen.frustumCulled = false;
    this.gps.add(gpsScreen);
    this.gpsT = 0;

    // --------------------------------------------------------------- pedals
    const pedMat = new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.5, metalness: 0.4 });
    this.pedals = [];
    for (const [px, name] of [[sx - 0.10 * k, 'throttle'], [sx + 0.06 * k, 'brake']]) {
      const pivot = new THREE.Group();
      pivot.position.set(px, floorY + 0.22 * k, dashZ - 0.34);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.055 * k, 0.15 * k, 0.02), pedMat);
      p.position.y = -0.06 * k;
      pivot.add(p);
      this.group.add(pivot);
      this.pedals.push({ pivot, name });
    }

    // ----------------------------------------------------------------- arms
    if (this.arms) {
      const skin = new THREE.MeshStandardMaterial({ color: 0x74bf72, roughness: 0.85 });   // an Oo is green
      this.armParts = [];
      for (const sgn of [1, -1]) {
        const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036 * k, 0.030 * k, 1, 7), skin);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.070 * k, 0.105 * k, 0.070 * k), skin);
        for (const m of [fore, hand]) { m.frustumCulled = false; this.group.add(m); }
        // no shoulder, no elbow: a forearm that runs off the bottom of the frame
        // and a hand on the rim. A full arm swings a green pipe past the lens.
        this.armParts.push({
          s: sgn, fore, hand, len: 0.40 * k,
          anchor: new THREE.Vector3(sx + sgn * 0.22 * k, eyeY - 0.42 * k, eyeZ - 0.10 * k),
        });
      }
    }

    // ------------------------------------------------------------- the head
    // The camera sits here. A camera looks down its OWN -z, so the mount is
    // turned to face the car's nose and the look angles ride on top of that.
    this.mount = new THREE.Object3D();
    this.mount.position.set(sx, eyeY, eyeZ);
    this.mount.rotation.y = Math.PI;
    this.group.add(this.mount);
    this.head = new THREE.Object3D();
    this.mount.add(this.head);
    this.look = { yaw: 0, pitch: 0 };
    this.lean = { x: 0, y: 0, roll: 0, yaw: 0 };
    this.latG = 0; this.lonG = 0; this.lastSpeed = 0;

    // scratch
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._e = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.setVisible(false);
  }

  makeNeedle(pos, len, hex) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const geo = new THREE.BoxGeometry(len * 0.075, len, len * 0.05);
    geo.translate(0, len * 0.40, 0);                  // pivots near one end
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hex }));
    m.frustumCulled = false;
    g.add(m);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.11, len * 0.11, len * 0.06, 8),
      new THREE.MeshBasicMaterial({ color: 0x1a1d22 }));
    cap.rotation.x = Math.PI / 2;
    g.add(cap);
    this.binnacle.add(g);
    return g;
  }

  // the face: drawn once, then never again. One big speedo, because that is the
  // number you actually read at 90 mph, and a rev bar you read out of the corner
  // of your eye.
  drawDialFace() {
    const c = this.dialCanvas.getContext('2d');
    const W = this.dialCanvas.width, H = this.dialCanvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1b2028';
    c.beginPath(); c.roundRect(0, 0, W, H, 44); c.fill();
    c.strokeStyle = '#454e5a'; c.lineWidth = 8; c.stroke();

    // --- the speedo
    const cx = 300, cy = 256, r = 230, max = this.vMax, step = 20;
    c.save(); c.translate(cx, cy);
    c.fillStyle = '#0e1218'; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.strokeStyle = '#5d6875'; c.lineWidth = 5; c.stroke();
    const A0 = rad(-135), A1 = rad(135);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let v = 0; v <= max + 1e-6; v += step / 2) {
      const t = v / max, a = A0 + (A1 - A0) * t - rad(90);
      const co = Math.cos(a), si = Math.sin(a);
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      c.strokeStyle = major ? '#ffffff' : '#8b95a3';
      c.lineWidth = major ? 8 : 4;
      c.beginPath();
      c.moveTo(co * (r - 10), si * (r - 10));
      c.lineTo(co * (r - (major ? 40 : 25)), si * (r - (major ? 40 : 25)));
      c.stroke();
      if (major) {
        c.fillStyle = '#eef3fa';
        c.font = '700 40px ui-monospace, monospace';
        c.fillText(String(Math.round(v)), co * (r - 72), si * (r - 72));
      }
    }
    c.fillStyle = '#79838f';
    c.font = '700 28px ui-monospace, monospace';
    c.fillText(this.unit || 'MPH', 0, r * 0.52);
    c.restore();

    // --- the rev bar's track, with the last eighth in red
    const bx = 600, by = 96, bw = 380, bh = 44;
    c.fillStyle = '#0e1218';
    c.beginPath(); c.roundRect(bx - 6, by - 6, bw + 12, bh + 12, 10); c.fill();
    c.strokeStyle = '#5d6875'; c.lineWidth = 3; c.stroke();
    c.fillStyle = 'rgba(232,72,58,0.35)';
    c.fillRect(bx + bw * 0.875, by, bw * 0.125, bh);
    for (let i = 1; i < 8; i++) {
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillRect(bx + bw * i / 8 - 1, by, 2, bh);
    }
    c.fillStyle = '#79838f';
    c.font = '700 24px ui-monospace, monospace';
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('RPM  x1000', bx, by - 16);

    // --- the pocket the numbers live in
    c.fillStyle = '#0e1218';
    c.beginPath(); c.roundRect(bx - 6, 190, bw + 12, 146, 12); c.fill();
    c.strokeStyle = '#5d6875'; c.lineWidth = 3; c.stroke();
  }

  drawDigits(car, gearText, hour) {
    const c = this.digitCanvas.getContext('2d');
    const W = this.digitCanvas.width, H = this.digitCanvas.height;
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'middle';
    // the number, big
    c.textAlign = 'right';
    c.fillStyle = '#eef3fa';
    c.font = '700 62px ui-monospace, monospace';
    c.fillText(String(Math.round(this.speedShown)), 150, 38);
    c.fillStyle = '#79838f';
    c.font = '700 22px ui-monospace, monospace';
    c.textAlign = 'left';
    c.fillText(this.unit || 'MPH', 158, 44);
    // gear, and the time of day
    c.fillStyle = '#f5c145';
    c.font = '700 40px ui-monospace, monospace';
    c.textAlign = 'left';
    c.fillText(gearText, 10, 76);
    const hh = String(Math.floor(hour)).padStart(2, '0'), mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    c.fillStyle = '#79838f';
    c.font = '700 26px ui-monospace, monospace';
    c.textAlign = 'right';
    c.fillText(hh + ':' + mm, W - 10, 76);
    this.digitTex.needsUpdate = true;
  }

  // a heading-up window on the road network — the only "map" in the car
  drawGps(model, car) {
    const cv = this.gpsCanvas, c = cv.getContext('2d');
    const W = cv.width, H = cv.height, R = 320, sc = W / (R * 2);
    c.fillStyle = '#0b1a14'; c.fillRect(0, 0, W, H);
    // screen axes from the car's own: up is where the nose points
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const rx = -fz, rz = fx;                              // the driver's right, in world terms
    const P = (x, z) => {
      const dx = x - car.x, dz = z - car.z;
      return [W / 2 + (dx * rx + dz * rz) * sc, H / 2 - (dx * fx + dz * fz) * sc];
    };
    c.lineCap = 'round'; c.lineJoin = 'round';
    const COL = { highway: '#f5c145', blvd: '#ffd98a', street: '#cfd7e3', hill: '#ff9a5c', coast: '#7ed3ff',
                  gravel: '#c9a36a', canyon: '#ff6b3d', mine: '#ffe066', pier: '#ffffff', sand: '#f7e7b0' };
    if (model.roads) {
      for (const r of model.roads) {
        let near = false;
        for (const [x, z] of r.pts) if (Math.abs(x - car.x) < R + 250 && Math.abs(z - car.z) < R + 250) { near = true; break; }
        if (!near) continue;
        c.strokeStyle = COL[r.type] || '#cfd7e3';
        c.lineWidth = Math.max(2, (r.T ? r.T.w : 14) * sc * 0.85);
        c.beginPath();
        r.pts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? c.lineTo(a, b) : c.moveTo(a, b); });
        c.stroke();
      }
    } else if (model.samples) {
      c.strokeStyle = '#cfd7e3';
      c.lineWidth = Math.max(2, model.halfWidth * 2 * sc);
      c.beginPath();
      model.samples.forEach((p, i) => { const [a, b] = P(p.x, p.z); i ? c.lineTo(a, b) : c.moveTo(a, b); });
      if (model.closed) c.closePath();
      c.stroke();
    }
    if (this.gpsOthers) for (const o of this.gpsOthers) {
      const [a, b] = P(o.x, o.z);
      if (a < 0 || b < 0 || a > W || b > H) continue;
      c.fillStyle = 'rgba(255,120,120,0.9)';
      c.beginPath(); c.arc(a, b, 3, 0, 7); c.fill();
    }
    // you, always dead centre, always pointing up
    c.fillStyle = '#7ef5a5';
    c.beginPath(); c.moveTo(W / 2, H / 2 - 9); c.lineTo(W / 2 + 6, H / 2 + 7); c.lineTo(W / 2 - 6, H / 2 + 7); c.closePath(); c.fill();
    // a scale bar and where the road is called what
    c.fillStyle = 'rgba(8,14,11,0.75)'; c.fillRect(0, H - 26, W, 26);
    c.fillStyle = '#8fd0a8'; c.font = '600 15px ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText((this.roadName || 'SAN OOZI').toUpperCase().slice(0, 22), 8, H - 13);
    c.textAlign = 'right';
    c.fillText(Math.round(R * 2) + ' m', W - 8, H - 13);
    this.gpsTex.needsUpdate = true;
  }

  setVisible(on) {
    this.group.visible = on;
    this.on = on;
  }

  // ctx: { model, speedShown, unit, hour, others, mouse, pad, dt }
  update(dt, car, inp, ctx = {}) {
    if (!this.on) return;
    const k = this.k;
    this.speedShown = ctx.speedShown ?? car.speed * 2.23694;
    this.unit = ctx.unit || 'MPH';

    // ---- the wheel. inp.steer is in sim terms: + turns the car to its LEFT.
    const lock = 1.15;                                  // radians of wheel at full lock — about 66°
    const want = (car.steer / (this.p.maxSteer || 0.6)) * lock;
    this.wheelAngle = (this.wheelAngle ?? 0) + (want - (this.wheelAngle ?? 0)) * Math.min(1, dt * 14);
    this.wheel.rotation.z = this.wheelAngle;

    // ---- needles
    const sFrac = Math.min(1, Math.abs(this.speedShown) / this.vMax);
    const rFrac = Math.min(1, car.rpm / 8000);          // the bar reads to 8 x1000
    this.speedNeedle.rotation.z = -rad(-135 + 270 * sFrac);
    this.revBar.scale.x = Math.max(0.001, rFrac);
    this.revBar.material.color.setHex(rFrac > 0.875 ? 0xe8483a : 0xf5c145);

    // ---- pedals push down
    for (const p of this.pedals) {
      const v = p.name === 'throttle' ? inp.throttle : Math.max(inp.brake, inp.handbrake * 0.5);
      p.pivot.rotation.x = rad(-14) * v;
    }

    // ---- digits and the map, well below frame rate: nobody reads them at 60 Hz
    this.digitT -= dt;
    if (this.digitT <= 0) {
      this.digitT = 0.1;
      this.drawDigits(car, car.reversing ? 'R' : String(car.gear), ctx.hour ?? 12);
    }
    this.gpsT -= dt;
    if (this.gpsT <= 0 && ctx.model) {
      this.gpsT = 0.12;
      this.gpsOthers = ctx.others;
      this.roadName = ctx.roadName;
      this.drawGps(ctx.model, car);
    }

    // ---- the head: lean into what the car is doing, then free look on top
    const latA = car.u * car.r;                          // lateral acceleration, near enough
    const lonA = (car.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = car.speed;
    this.latG += (latA / 9.81 - this.latG) * Math.min(1, dt * 6);
    this.lonG += (Math.max(-25, Math.min(25, lonA)) / 9.81 - this.lonG) * Math.min(1, dt * 5);
    const lat = Math.max(-1.6, Math.min(1.6, this.latG));
    const lon = Math.max(-1.2, Math.min(1.2, this.lonG));
    // a body in a seat: pushed the other way from the corner, and it leans
    this.lean.x = -lat * 0.030 * k;
    this.lean.y = -Math.abs(lat) * 0.008 * k;
    this.lean.roll = lat * 0.055;
    this.lean.yaw = car.steer * 0.16 + -lat * 0.05;      // and you look where you're going

    // free look: drag the mouse, or the right stick
    const m = ctx.mouse;
    if (m && m.down) { this.look.yaw -= m.dx * 0.0032; this.look.pitch -= m.dy * 0.0026; }
    const pad = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (pad && pad.connected) {
      const ax = pad.axes[2] || 0, ay = pad.axes[3] || 0;
      if (Math.abs(ax) > 0.15) this.look.yaw -= ax * dt * 2.4;
      if (Math.abs(ay) > 0.15) this.look.pitch -= ay * dt * 1.6;
    }
    // it comes back to centre on its own, like a neck
    const back = Math.exp(-dt * 2.2);
    this.look.yaw *= back; this.look.pitch *= back;
    this.look.yaw = Math.max(-2.2, Math.min(2.2, this.look.yaw));
    this.look.pitch = Math.max(-0.7, Math.min(0.6, this.look.pitch));

    // road noise: the car already shakes, this is the head not being bolted to it
    const sp = Math.min(1, car.speed / 40);
    const t = ctx.time || 0;
    const bob = Math.sin(t * 21.3) * 0.0022 * sp + Math.sin(t * 13.7) * 0.0015 * sp;

    this.mount.position.set(this.sx + this.lean.x, this.eyeY + this.lean.y + bob, this.eyeZ);
    this.head.rotation.set(this.look.pitch, this.look.yaw + this.lean.yaw, this.lean.roll, 'YXZ');

    // ---- hands follow the rim, elbows work it out
    if (this.arms) this.updateArms();
  }

  updateArms() {
    this._q.copy(this.column.quaternion).multiply(this.wheel.quaternion);   // wheel -> cockpit
    for (const a of this.armParts) {
      const ang = a.s > 0 ? rad(-30) : rad(210);       // ten to two; + is the car's left
      const H = this._v.set(Math.cos(ang) * this.wheelR, Math.sin(ang) * this.wheelR, 0.05)
        .applyQuaternion(this._q).add(this.column.position).clone();
      // the forearm points back at where a shoulder would be, and stops short
      const back = this._w.subVectors(a.anchor, H);
      if (back.lengthSq() < 1e-6) back.set(0, -1, -1);
      back.normalize();
      this.segment(a.fore, this._e.copy(H).addScaledVector(back, a.len), H);
      a.hand.position.copy(H);
      a.hand.quaternion.copy(this._q);
      a.hand.rotateZ(ang);
    }
  }

  // a unit cylinder stretched between two points
  segment(mesh, from, to) {
    this._v.subVectors(to, from);
    const len = Math.max(0.01, this._v.length());
    mesh.position.copy(from).addScaledVector(this._v, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, this._v.divideScalar(len));
    mesh.scale.set(1, len, 1);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse(n => { if (n.geometry) n.geometry.dispose(); });
    this.gpsTex.dispose(); this.digitTex.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
