// menu.js — the screens. Title (with the attract race running behind it) →
// mode → car (a turntable of the real model, with stat bars) → track → go.
// Arrows / WASD / d-pad move, Enter / Space / A pick, Esc / B go back. Mouse works too.

import * as THREE from 'three';
import { Car } from './car.js';
import { FlatTerrain } from './terrain.js';
import { buildCar, placeStaticCar } from './carmesh.js';

const ORDER = ['title', 'mode', 'car', 'track'];

export class Screens {
  constructor(o) {
    this.o = o;                                   // { input, S, PRESETS, CAR_ORDER, TIERS, TRACKS, TRACK_ORDER, getModel, onGo, onBack }
    this.root = document.getElementById('screens');
    this.current = null;
    this.carIdx = Math.max(0, o.CAR_ORDER.indexOf(o.S.carId));
    this.trackIdx = Math.max(0, [...o.TRACK_ORDER, 'city'].indexOf(o.S.track));
    this.modeIdx = ['race', 'cruise', 'shorts'].indexOf(o.S.mode === 'cruise' ? 'cruise' : 'race');
    this.optRow = 0;                              // on the mode screen: 0 tiles, 1 bots, 2 laps
    this.stats = null;
    this.showcase = null;
    this.showCars = new Map();
    this.padPrev = {};
    this.t = 0;
    this.bindMouse();
  }

  // ------------------------------------------------------------ showcase
  ensureShowcase() {
    if (this.showcase) return;
    const sc = new THREE.Scene();
    sc.background = null;
    sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.1));
    const d = new THREE.DirectionalLight(0xfff0dc, 1.6);
    d.position.set(4, 7, 5); d.castShadow = true;
    d.shadow.mapSize.set(1024, 1024);
    d.shadow.camera.left = -6; d.shadow.camera.right = 6; d.shadow.camera.top = 6; d.shadow.camera.bottom = -6;
    sc.add(d);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshLambertMaterial({ color: 0x1b2030 }));
    disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true;
    sc.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.45, 64), new THREE.MeshBasicMaterial({ color: 0xffb06b }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
    sc.add(ring);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.showcase = { scene: sc, cam, turn: new THREE.Group(), ring, disc, diorama: null };
    sc.add(this.showcase.turn);
  }

  showcaseCar(id) {
    this.ensureShowcase();
    const { turn } = this.showcase;
    for (const c of turn.children) c.visible = false;
    if (this.showcase.diorama) this.showcase.diorama.visible = false;
    if (!this.showCars.has(id)) {
      const m = buildCar(this.o.PRESETS[id], { onReady: g => this.thumbnail(id, g) });
      placeStaticCar(m, 0, 0, 0, 0);
      turn.add(m);
      this.showCars.set(id, m);
    }
    this.showCars.get(id).visible = true;
    // the stage floor takes the class colour
    const tier = this.o.PRESETS[id].tier;
    const col = { cup: 0xe8e4d8, serious: 0x7ea6ff, fun: 0xffd98a, silly: 0xff8fb0 }[tier] || 0xffb06b;
    this.showcase.ring.material.color.setHex(col);
    document.getElementById('sCar').dataset.tier = tier;
  }

  // load every car once (in the background) so the grid fills in as they arrive
  warmGrid() {
    for (const id of this.o.CAR_ORDER) if (!this.showCars.has(id)) {
      const m = buildCar(this.o.PRESETS[id], { onReady: g => this.thumbnail(id, g) });
      placeStaticCar(m, 0, 0, 0, 0);
      m.visible = false;
      this.showcase.turn.add(m);
      this.showCars.set(id, m);
    }
  }

  // render one car into its grid cell: a 3/4 view, class-coloured floor
  thumbnail(id, mesh) {
    const cv = this.root.querySelector(`.thumb[data-car="${id}"] canvas`);
    const r = this.o.renderer;
    if (!cv || !r || !this.showcase) return;
    const { scene, turn, ring } = this.showcase;
    const W = 192, H = 144;
    const rt = this.rt || (this.rt = new THREE.WebGLRenderTarget(W, H));
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    const p = this.o.PRESETS[id], L = p.lf + p.lr, dist = 6.5 + L * 1.6;
    cam.position.set(dist * 0.7, 1.3 + L * 0.4, dist * 0.7); cam.lookAt(0, 0.5, 0);
    const vis = new Map();
    for (const c of turn.children) { vis.set(c, c.visible); c.visible = c === mesh; }
    const dio = this.showcase.diorama; const dv = dio ? dio.visible : false; if (dio) dio.visible = false;
    const rot = turn.rotation.y; turn.rotation.y = 0.6;
    const rc = ring.material.color.getHex();
    ring.material.color.setHex({ cup: 0xe8e4d8, serious: 0x7ea6ff, fun: 0xffd98a, silly: 0xff8fb0 }[p.tier] || 0xffb06b);
    const old = r.getRenderTarget();
    r.setRenderTarget(rt); r.setClearColor(0x0b0e16, 1); r.clear(); r.render(scene, cam); r.setRenderTarget(old);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const g = cv.getContext('2d'); cv.width = W; cv.height = H;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // GL is bottom-up
    g.putImageData(img, 0, 0);
    for (const [c, v] of vis) c.visible = v;
    if (dio) dio.visible = dv;
    turn.rotation.y = rot; ring.material.color.setHex(rc);
  }

  // a little 3D model of the track: the road as a ribbon, hills exaggerated
  showcaseTrack(id) {
    this.ensureShowcase();
    const { turn } = this.showcase;
    for (const c of turn.children) c.visible = false;
    if (this.showcase.diorama) { turn.remove(this.showcase.diorama); this.showcase.diorama.geometry.dispose(); }
    const m = this.o.getModel(id);
    const b = m.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) || 1;
    const k = 7.6 / span;
    let ylo = 1e9; for (const s of m.samples) ylo = Math.min(ylo, s.y);
    const pos = [], col = [], idx = [];
    const hw = Math.max(m.halfWidth * k, 0.09);
    const road = new THREE.Color(0x8a909c), hi = new THREE.Color(0xffb06b);
    const n = m.samples.length;
    for (let i = 0; i < n; i++) {
      const s = m.samples[i];
      const y = (s.y - ylo) * k * 2.2 + 0.05;
      pos.push((s.x - cx) * k + s.nx * hw, y, (s.z - cz) * k + s.nz * hw, (s.x - cx) * k - s.nx * hw, y, (s.z - cz) * k - s.nz * hw);
      const c = i < 6 ? hi : road;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n - 1 || m.closed) { const a = i * 2, bb = ((i + 1) % n) * 2; idx.push(a, bb, a + 1, bb, bb + 1, a + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x222630 }));
    mesh.castShadow = true;
    turn.add(mesh);
    this.showcase.diorama = mesh;
    this.showcase.ring.material.color.setHex(0xffb06b);
    const d = this.o.TRACKS[id];
    document.getElementById('trackBig').textContent = id === 'city' ? 'THE CITY' : d.name;
    let hi2 = -1e9; for (const s of m.samples) hi2 = Math.max(hi2, s.y);
    document.getElementById('trackFacts').textContent = `${(m.length / 1000).toFixed(1)} km · ${Math.round(hi2 - ylo)} m of elevation · ${m.jumps.length} kicker${m.jumps.length === 1 ? '' : 's'}${m.tunnels.length ? ' · tunnel' : ''}${m.whoops.length ? ' · whoops' : ''}`;
  }

  renderShowcase(renderer, aspect) {
    if (!this.showcase) return;
    const { scene, cam, turn } = this.showcase;
    cam.aspect = aspect; cam.updateProjectionMatrix();
    turn.rotation.y = this.t * (this.current === 'track' ? 0.25 : 0.55);
    this.showcase.ring.visible = this.showcase.disc.visible = this.current !== 'track';
    if (this.current === 'track') {
      cam.position.set(0, 11.5, 12.5); cam.lookAt(0, 2.3, 0);   // aim high so the ribbon sits low, clear of the GO button
    } else {
      const p = this.o.PRESETS[this.o.CAR_ORDER[this.carIdx]];
      const L = p.lf + p.lr;
      const dist = 7 + L * 1.7;
      cam.position.set(dist * 0.66, 1.5 + L * 0.42, dist * 0.75);
      cam.lookAt(0, 0.6, 0);
    }
    renderer.render(scene, cam);
  }

  // --------------------------------------------------------------- stats
  computeStats() {
    if (this.stats) return this.stats;
    const env = { terrain: new FlatTerrain(0), surfaceAt: () => ({ grip: 1, bump: 0 }) };
    const raw = {};
    for (const id of this.o.CAR_ORDER) {
      const p = this.o.PRESETS[id];
      const car = new Car(id, this.o.PRESETS);
      car.reset(0, 0, 0, 0);
      for (let i = 0; i < 30; i++) car.step(1 / 60, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, env, 0.5);
      let t = 0, t60 = 0;
      while (t < 14) { car.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, env, 0.5); t += 1 / 60; if (!t60 && car.speed * 2.237 >= 60) t60 = t; }
      const driveK = p.drive === 'rwd' ? 1 : p.drive === 'awd' ? 0.55 : 0.35;
      raw[id] = {
        speed: car.speed, accel: 1 / (t60 || 14), grip: (p.tyre.muF + p.tyre.muR) / 2,
        drift: driveK * (1.15 - (p.tyre.muR - p.tyre.muF) * 2) * (1 + p.cgH * 0.4),
        weight: p.mass,
      };
    }
    const keys = ['speed', 'accel', 'grip', 'drift', 'weight'];
    const norm = {};
    for (const k of keys) {
      const vals = this.o.CAR_ORDER.map(id => raw[id][k]);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      for (const id of this.o.CAR_ORDER) (norm[id] ??= {})[k] = hi > lo ? 0.12 + 0.88 * (raw[id][k] - lo) / (hi - lo) : 0.5;
    }
    this.stats = { raw, norm };
    return this.stats;
  }

  // ----------------------------------------------------------- navigation
  show(name) {
    this.current = name;
    // pick up whatever S says now (URL params, in-game changes) before drawing
    const ci = this.o.CAR_ORDER.indexOf(this.o.S.carId); if (ci >= 0) this.carIdx = ci;
    const ti = [...this.o.TRACK_ORDER, 'city'].indexOf(this.o.S.track); if (ti >= 0) this.trackIdx = ti;
    this.root.classList.add('on');
    for (const s of this.root.querySelectorAll('.screen')) s.classList.toggle('on', s.dataset.screen === name);
    if (name === 'mode') this.renderMode();
    if (name === 'car') { this.renderCar(); this.showcaseCar(this.o.CAR_ORDER[this.carIdx]); this.warmGrid(); }
    if (name === 'track') { this.renderTrack(); this.showcaseTrack([...this.o.TRACK_ORDER, 'city'][this.trackIdx]); }
    this.root.dataset.screen = name;
  }
  hide() { this.current = null; this.root.classList.remove('on'); }
  get active() { return this.current != null; }

  nav() {
    const inp = this.o.input;
    const k = key => inp.tapped(key);
    const n = { left: k('arrowleft') || k('a'), right: k('arrowright') || k('d'), up: k('arrowup') || k('w'), down: k('arrowdown') || k('s'),
                ok: k('enter') || k(' '), back: k('escape') || k('backspace') };
    // gamepad edges
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const cur = { left: b(14) || ax < -0.6, right: b(15) || ax > 0.6, up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, ok: b(0) || b(9), back: b(1) };
      for (const key in cur) { if (cur[key] && !this.padPrev[key]) n[key] = true; }
      this.padPrev = cur;
      break;
    }
    return n;
  }

  update(dt) {
    this.t += dt;
    if (!this.active) return;
    const n = this.nav();
    const S = this.o.S;
    switch (this.current) {
      case 'title':
        if (n.ok || n.left || n.right || n.up || n.down) this.show('mode');
        break;
      case 'mode': {
        const modes = ['race', 'cruise', 'shorts'];
        if (this.optRow === 0) {
          if (n.left) this.modeIdx = (this.modeIdx + 2) % 3;
          if (n.right) this.modeIdx = (this.modeIdx + 1) % 3;
          if (n.down && modes[this.modeIdx] === 'race') this.optRow = 1;
        } else if (this.optRow === 1) {
          const bl = [3, 5, 7, 11]; let i = bl.indexOf(S.bots);
          if (n.left) i = (i + 3) % 4; if (n.right) i = (i + 1) % 4; S.bots = bl[i];
          if (n.up) this.optRow = 0; if (n.down) this.optRow = 2;
        } else if (this.optRow === 2) {
          const ll = [1, 3, 5]; let i = ll.indexOf(S.laps);
          if (n.left) i = (i + 2) % 3; if (n.right) i = (i + 1) % 3; S.laps = ll[i];
          if (n.up) this.optRow = 1; if (n.down) this.optRow = 3;
        } else {
          if (n.left || n.right) S.grid = S.grid === 'equal' ? 'mixed' : 'equal';
          if (n.up) this.optRow = 2;
        }
        if (n.ok) { this.pickMode(modes[this.modeIdx]); }
        if (n.back) this.show('title');
        this.renderMode();
        break;
      }
      case 'car': {
        const N = this.o.CAR_ORDER.length, C = 4;
        if (n.left) this.carIdx = (this.carIdx + N - 1) % N;
        if (n.right) this.carIdx = (this.carIdx + 1) % N;
        if (n.up) this.carIdx = (this.carIdx - C + N) % N;
        if (n.down) this.carIdx = (this.carIdx + C) % N;
        if (n.left || n.right || n.up || n.down) { S.carId = this.o.CAR_ORDER[this.carIdx]; this.renderCar(); this.showcaseCar(S.carId); }
        if (n.ok) { if (S.mode === 'cruise') { S.track = 'city'; this.go(); } else this.show('track'); }
        if (n.back) this.show('mode');
        break;
      }
      case 'track': {
        const ids = [...this.o.TRACK_ORDER, 'city'];
        if (this.optRow === 0) {
          if (n.left) this.trackIdx = (this.trackIdx + ids.length - 1) % ids.length;
          if (n.right) this.trackIdx = (this.trackIdx + 1) % ids.length;
          if (n.down) this.optRow = 1;
          S.track = ids[this.trackIdx];
        } else {
          if (n.left) { S.skyIdx = (S.skyIdx + 3) % 4; S.skyChosen = true; }
          if (n.right) { S.skyIdx = (S.skyIdx + 1) % 4; S.skyChosen = true; }
          if (n.up) this.optRow = 0;
        }
        if (n.left || n.right || n.up || n.down) { this.renderTrack(); if (n.left || n.right) this.showcaseTrack(ids[this.trackIdx]); }
        if (n.ok) this.go();
        if (n.back) { this.optRow = 0; this.show('car'); }
        break;
      }
    }
  }

  pickMode(mode) {
    const S = this.o.S;
    S.mode = mode === 'cruise' ? 'cruise' : 'race';
    S.shorts = mode === 'shorts';
    this.optRow = 0;
    this.show('car');
  }

  go() {
    this.optRow = 0;
    this.hide();
    this.o.onGo();
  }

  // ------------------------------------------------------------ rendering
  renderMode() {
    const S = this.o.S;
    const modes = ['race', 'cruise', 'shorts'];
    const tiles = this.root.querySelectorAll('#sMode .tile');
    tiles.forEach((t, i) => t.classList.toggle('sel', i === this.modeIdx && this.optRow === 0));
    const opts = document.getElementById('modeOpts');
    opts.style.visibility = modes[this.modeIdx] === 'race' ? 'visible' : 'hidden';
    opts.querySelectorAll('[data-bots]').forEach(c => { c.classList.toggle('sel', +c.dataset.bots === S.bots); c.classList.toggle('focus', this.optRow === 1 && +c.dataset.bots === S.bots); });
    opts.querySelectorAll('[data-laps]').forEach(c => { c.classList.toggle('sel', +c.dataset.laps === S.laps); c.classList.toggle('focus', this.optRow === 2 && +c.dataset.laps === S.laps); });
    opts.querySelectorAll('[data-grid]').forEach(c => { c.classList.toggle('sel', c.dataset.grid === (S.grid || 'mixed')); c.classList.toggle('focus', this.optRow === 3 && c.dataset.grid === (S.grid || 'mixed')); });
    // pad glyphs in the hints when a pad is talking
    const pad = this.o.input.usingPad || this.o.input.pad;
    this.root.querySelectorAll('.nav').forEach(el => el.classList.toggle('pad', !!pad));
  }

  renderCar() {
    const id = this.o.CAR_ORDER[this.carIdx], p = this.o.PRESETS[id];
    const st = this.computeStats();
    document.getElementById('pickName').textContent = p.label;
    document.getElementById('pickTier').textContent = this.o.TIERS[p.tier] + ' · ' + p.drive.toUpperCase();
    document.getElementById('pickBlurb').textContent = p.blurb;
    document.getElementById('pickIdx').textContent = (this.carIdx + 1) + ' / ' + this.o.CAR_ORDER.length;
    const n = st.norm[id], r = st.raw[id];
    const rows = [
      ['SPEED', n.speed, (r.speed * 2.237).toFixed(0) + ' mph'],
      ['LAUNCH', n.accel, (1 / r.accel).toFixed(1) + ' s to 60'],
      ['GRIP', n.grip, r.grip.toFixed(2) + ' g'],
      ['DRIFT', n.drift, p.drive === 'rwd' ? 'rear-drive' : p.drive === 'awd' ? 'all-wheel' : 'front-drive'],
      ['WEIGHT', n.weight, r.weight + ' kg'],
    ];
    const statsEl = document.getElementById('pickStats');
    if (!statsEl.children.length) statsEl.innerHTML = rows.map(([k]) =>
      `<div class="stat"><label>${k}</label><div class="sbar"><span style="transform:scaleX(0)"></span></div><i></i></div>`).join('');
    rows.forEach(([k, v, txt], i) => { const el = statsEl.children[i]; el.querySelector('span').style.transform = `scaleX(${v.toFixed(3)})`; el.querySelector('i').textContent = txt; });
    // the grid: one thumbnail per car, filled in as the models arrive
    const grid = document.getElementById('carGrid');
    if (!grid.children.length) grid.innerHTML = this.o.CAR_ORDER.map((cid, i) =>
      `<button class="thumb ${this.o.PRESETS[cid].tier}" data-car="${cid}" data-i="${i}"><canvas width="192" height="144"></canvas><i>${this.o.PRESETS[cid].label}</i></button>`).join('');
    grid.querySelectorAll('.thumb').forEach((el, i) => el.classList.toggle('sel', i === this.carIdx));
  }

  renderTrack() {
    const S = this.o.S;
    const ids = [...this.o.TRACK_ORDER, 'city'];
    const wrap = document.getElementById('trackTiles');
    if (!wrap.children.length) {
      wrap.innerHTML = ids.map(id => {
        const d = id === 'city' ? { name: 'THE CITY', blurb: 'street circuit · free roam' } : this.o.TRACKS[id];
        return `<button class="tile" data-track="${id}"><canvas width="220" height="150"></canvas><b>${d.name}</b><span>${d.blurb}</span></button>`;
      }).join('');
    }
    const tiles = this.root.querySelectorAll('#sTrack .tile');
    tiles.forEach((t, i) => {
      t.classList.toggle('sel', i === this.trackIdx && this.optRow === 0);
      const cv = t.querySelector('canvas');
      if (cv && !cv.dataset.drawn) { this.drawOutline(cv, ids[i]); cv.dataset.drawn = '1'; }
    });
    document.querySelectorAll('#skyChips [data-sky]').forEach(c => {
      c.classList.toggle('sel', +c.dataset.sky === S.skyIdx);
      c.classList.toggle('focus', this.optRow === 1 && +c.dataset.sky === S.skyIdx);
    });
  }

  drawOutline(cv, id) {
    const m = this.o.getModel(id);
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 12;
    const b = m.bounds;
    const s = Math.min((w - pad * 2) / (b.maxX - b.minX || 1), (h - pad * 2) / (b.maxZ - b.minZ || 1));
    const ox = pad + (w - pad * 2 - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oz = pad + (h - pad * 2 - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
    const P = p => [ox + p.x * s, h - (oz + p.z * s)];
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(4, m.halfWidth * 2 * s);
    g.beginPath(); m.samples.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (m.closed) g.closePath(); g.stroke();
    g.strokeStyle = '#ffb06b'; g.lineWidth = 1.6;
    g.beginPath(); m.samples.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (m.closed) g.closePath(); g.stroke();
    const st = m.samples[Math.floor((m.def.startIndex || 0) * m.samples.length) % m.samples.length];
    const [sx, sy] = P(st); g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 3, 0, 7); g.fill();
  }

  bindMouse() {
    this.root.addEventListener('click', e => {
      const t = e.target.closest('[data-mode],[data-bots],[data-laps],[data-grid],[data-car],[data-track],[data-sky],[data-go],[data-back],[data-next],[data-prev]');
      if (!t) { if (this.current === 'title') this.show('mode'); return; }
      const S = this.o.S;
      if (t.dataset.mode) { this.modeIdx = ['race', 'cruise', 'shorts'].indexOf(t.dataset.mode); this.pickMode(t.dataset.mode); }
      else if (t.dataset.bots) { S.bots = +t.dataset.bots; this.renderMode(); }
      else if (t.dataset.laps) { S.laps = +t.dataset.laps; this.renderMode(); }
      else if (t.dataset.grid) { S.grid = t.dataset.grid; this.renderMode(); }
      else if (t.dataset.car != null) { this.carIdx = +t.dataset.i; S.carId = this.o.CAR_ORDER[this.carIdx]; this.renderCar(); this.showcaseCar(S.carId); }
      else if (t.dataset.prev != null) { const N = this.o.CAR_ORDER.length; this.carIdx = (this.carIdx + N - 1) % N; S.carId = this.o.CAR_ORDER[this.carIdx]; this.renderCar(); this.showcaseCar(S.carId); }
      else if (t.dataset.next != null) { const N = this.o.CAR_ORDER.length; this.carIdx = (this.carIdx + 1) % N; S.carId = this.o.CAR_ORDER[this.carIdx]; this.renderCar(); this.showcaseCar(S.carId); }
      else if (t.dataset.track) { const ids = [...this.o.TRACK_ORDER, 'city']; this.trackIdx = ids.indexOf(t.dataset.track); S.track = t.dataset.track; this.renderTrack(); this.showcaseTrack(t.dataset.track); }
      else if (t.dataset.sky) { S.skyIdx = +t.dataset.sky; S.skyChosen = true; this.renderTrack(); }
      else if (t.dataset.go != null) { if (this.current === 'car') { if (S.mode === 'cruise') { S.track = 'city'; this.go(); } else this.show('track'); } else this.go(); }
      else if (t.dataset.back != null) { const i = ORDER.indexOf(this.current); this.show(ORDER[Math.max(0, i - 1)]); }
    });
  }
}
