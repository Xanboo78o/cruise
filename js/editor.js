// editor.js — the CITY TOOL. B in the city (or ?edit=1): the car stops, the
// camera comes off it, a panel of ~100 pieces opens on the left, and you build
// San Oozi by hand. Click to place, R rotates, V rerolls the look, [ ] scale,
// Delete removes, Ctrl+Z undoes. The ROADS tab draws roads point by point;
// APPLY rebuilds the world with them cut into the land. Everything autosaves
// (localStorage, and the file when tools/serve.mjs is running).

import * as THREE from 'three';
import { PIECES, CATS, PALETTE, buildPiece, footprint, BY_ID } from './world/pieces.js';
import { Chunks, GlowLayer } from './world/chunks.js';
import { ROAD_TYPES, ROADS } from './world/spec.js';
import { saveCityDoc, exportCityDoc, importCityDoc, clearDraft, probeServer } from './world/citydoc.js';

const ROAD_COL = { highway: 0xf5c145, blvd: 0xffd98a, street: 0xd8d4cc, hill: 0xff9a5c, coast: 0x7ed3ff, gravel: 0xc9a36a, canyon: 0xff6b3d, mine: 0xffe066, pier: 0xffffff, sand: 0xf7e7b0 };
const ROAD_ORDER = ['street', 'blvd', 'highway', 'hill', 'coast', 'gravel', 'canyon', 'mine', 'pier', 'sand'];
const hex = c => '#' + c.toString(16).padStart(6, '0');

export class Editor {
  // ctx: { scene, camera, renderer, input, hud, car, doc, getModel, getWorld, rebuild }
  constructor(ctx) {
    this.ctx = ctx; this.doc = ctx.doc; this.active = false;
    this.tool = 'place'; this.cat = 'houses'; this.piece = PIECES[0];
    this.rot = 0; this.scale = 1; this.colorIdx = null; this.seed = 1; this.text = null; this.snap = false;
    this.target = new THREE.Vector3(); this.orbit = { yaw: 0, pitch: 0.75, dist: 140 };
    this.cursor = null; this.hover = null; this.selected = null; this.hoverRoad = -1;
    this.roadType = 'street'; this.roadPts = []; this.roadsDirty = false;
    this.undoStack = [];
    this.mouse = { x: 0, y: 0, orbit: false, pan: false, place: false, lastPlace: null };
    this.helpers = new THREE.Group();
    this.ghost = null; this.ghostKey = ''; this.ghostMat = null;
    this.hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false }));
    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x6fe3a0, depthTest: false }));
    this.hoverBox.visible = this.selBox.visible = false; this.hoverBox.renderOrder = this.selBox.renderOrder = 20;
    this.roadPreview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.roadHover = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    this.roadPreview.renderOrder = this.roadHover.renderOrder = 15; this.roadPreview.visible = this.roadHover.visible = false;
    this.helpers.add(this.hoverBox, this.selBox, this.roadPreview, this.roadHover);
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.saveT = null; this.status = { server: null, saved: 'saved' };
    this.buildUI();
    this.bindMouse();
    this.bindKeys();
    probeServer().then(ok => { this.status.server = ok; this.refreshStatus(); });
  }

  // ------------------------------------------------------------------ in / out
  enter() {
    if (this.active) return;
    this.active = true;
    const car = this.ctx.car;
    this.target.set(car.x, this.ctx.getModel().heightAt(car.x, car.z), car.z);
    this.orbit.yaw = car.yaw + Math.PI; this.orbit.pitch = 0.75; this.orbit.dist = 140;
    this.attach();
    document.body.classList.add('editing');
    this.root.classList.add('on');
    this.ctx.hud.toast('CITY TOOL — click to place · right-drag orbit · wheel zoom · B/ESC exit', 3200);
    this.refreshStatus();
  }
  exit() {
    if (!this.active) return;
    this.active = false; this.roadPts = []; this.selected = null; this.hover = null;
    this.ghostDrop(); this.hoverBox.visible = this.selBox.visible = this.roadPreview.visible = this.roadHover.visible = false;
    document.body.classList.remove('editing');
    this.root.classList.remove('on');
    this.ctx.camera.fov = 62; this.ctx.camera.updateProjectionMatrix();
    this.flushSave();
  }
  attach() { if (this.helpers.parent !== this.ctx.scene) this.ctx.scene.add(this.helpers); }
  onWorldRebuilt() { this.attach(); this.ghostDrop(); this.roadsDirty = false; this.refreshStatus(); }
  get edits() { const w = this.ctx.getWorld(); return w && w.edits; }
  get atlas() { const w = this.ctx.getWorld(); return w && w.atlas; }
  get T() { const w = this.ctx.getWorld(); return w && w.T; }

  // ------------------------------------------------------------------ camera
  update(dt) {
    if (!this.active) return;
    const k = this.ctx.input.keys, cam = this.ctx.camera;
    const spd = (k.has('shift') ? 2.2 : 1) * (0.9 * this.orbit.dist + 20) * dt;
    const fx = Math.sin(this.orbit.yaw), fz = Math.cos(this.orbit.yaw);        // camera looks along -(fx,fz) → target
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) { mx -= fx; mz -= fz; }
    if (k.has('s') || k.has('arrowdown')) { mx += fx; mz += fz; }
    if (k.has('a') || k.has('arrowleft')) { mx -= fz; mz += fx; }
    if (k.has('d') || k.has('arrowright')) { mx += fz; mz -= fx; }
    if (mx || mz) { const l = Math.hypot(mx, mz); this.target.x += mx / l * spd; this.target.z += mz / l * spd; }
    if (k.has('q')) this.orbit.yaw += dt * 1.2;
    if (k.has('e')) this.orbit.yaw -= dt * 1.2;
    const model = this.ctx.getModel();
    this.target.y = model.heightAt(this.target.x, this.target.z);
    const o = this.orbit, cp = Math.cos(o.pitch);
    cam.position.set(this.target.x + Math.sin(o.yaw) * o.dist * cp, this.target.y + Math.sin(o.pitch) * o.dist + 2, this.target.z + Math.cos(o.yaw) * o.dist * cp);
    cam.lookAt(this.target);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.updateCursor();
    if (this.ghostDirty) this.ghostBuild();
    this.updateHelpers();
  }

  // where on the ground is the mouse: march the ray down onto the height field
  pick(clientX, clientY) {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, h = this.ctx.getModel().heightAt.bind(this.ctx.getModel());
    let t0 = 0, t1 = 0;
    const under = t => o.y + d.y * t < h(o.x + d.x * t, o.z + d.z * t);
    for (let t = 2; t < 3000; t += Math.max(2, t * 0.02)) { if (under(t)) { t1 = t; break; } t0 = t; }
    if (!t1) return null;
    for (let i = 0; i < 10; i++) { const tm = (t0 + t1) / 2; if (under(tm)) t1 = tm; else t0 = tm; }
    return { x: o.x + d.x * t1, z: o.z + d.z * t1 };
  }
  updateCursor() {
    const p = this.pick(this.mouse.x, this.mouse.y);
    if (!p) { this.cursor = null; return; }
    if (this.snap) { p.x = Math.round(p.x / 2) * 2; p.z = Math.round(p.z / 2) * 2; }
    const moved = !this.cursor || Math.hypot(p.x - this.cursor.x, p.z - this.cursor.z) > 0.25;
    this.cursor = p;
    if (moved && this.tool === 'place') this.ghostDirty = true;
    // what's under the cursor
    this.hover = null; this.hoverRoad = -1;
    if (this.tool !== 'road') {
      let best = null, bd = 1e9;
      for (const ob of this.doc.objects) {
        const fp = footprint(ob); const rad = fp ? Math.max(fp[2], fp[3]) / 2 + 1 : 3.5;
        const dd = Math.hypot(ob.x - p.x, ob.z - p.z);
        if (dd < rad && dd < bd) { bd = dd; best = ob; }
      }
      this.hover = best;
    } else if (this.T) {
      const n = this.T.nearestRoad(p.x, p.z);
      if (n && n.d < n.road.T.w / 2 + 3) this.hoverRoad = n.road.idx;
    }
  }

  // ------------------------------------------------------------------ ghost + helpers
  ghostDrop() { if (this.ghost) { for (const m of this.ghost) { this.helpers.remove(m); m.geometry.dispose(); } this.ghost = null; } this.ghostKey = ''; }
  ghostBuild() {
    this.ghostDirty = false;
    if (this.tool !== 'place' || !this.cursor || !this.atlas) { this.ghostDrop(); return; }
    const o = this.objAtCursor();
    const key = JSON.stringify(o);
    if (key === this.ghostKey) return;
    this.ghostDrop(); this.ghostKey = key;
    if (!this.ghostMat) { this.ghostMat = this.atlas.material.clone(); this.ghostMat.transparent = true; this.ghostMat.opacity = 0.55; this.ghostMat.depthWrite = false; }
    const C = new Chunks(this.helpers, this.atlas);
    try { buildPiece(C, null, this.T, o); } catch (e) { console.warn(e); }
    this.ghost = C.finish({ material: this.ghostMat });
    for (const m of this.ghost) m.renderOrder = 10;
  }
  objAtCursor() {
    const o = { k: this.piece.id, x: +this.cursor.x.toFixed(1), z: +this.cursor.z.toFixed(1), r: this.rot, s: +this.scale.toFixed(2), seed: this.seed };
    if (this.colorIdx != null) o.c = this.colorIdx;
    if (this.text) o.text = this.text;
    return o;
  }
  boxFor(ob, box) {
    const fp = footprint(ob), w = fp ? fp[2] : 4, d = fp ? fp[3] : 4;
    const y = this.ctx.getModel().heightAt(ob.x, ob.z);
    box.position.set(ob.x, y + 3, ob.z); box.scale.set(w + 1, 6, d + 1); box.visible = true;
  }
  updateHelpers() {
    if (this.hover && this.tool !== 'road') this.boxFor(this.hover, this.hoverBox); else this.hoverBox.visible = false;
    if (this.selected) this.boxFor(this.selected, this.selBox); else this.selBox.visible = false;
    if (this.tool === 'road') {
      const pts = this.cursor ? [...this.roadPts, [this.cursor.x, this.cursor.z]] : this.roadPts;
      this.ribbon(this.roadPreview, pts, ROAD_TYPES[this.roadType].w, ROAD_COL[this.roadType]); this.roadPreview.visible = pts.length > 1;
      if (this.hoverRoad >= 0 && !this.roadPts.length) { const r = this.T.roads[this.hoverRoad]; this.ribbon(this.roadHover, r.pts, r.T.w + 4, 0xff4040); this.roadHover.visible = true; }
      else this.roadHover.visible = false;
    } else { this.roadPreview.visible = this.roadHover.visible = false; }
  }
  // a flat ribbon along points, lifted off the ground
  ribbon(mesh, pts, w, color) {
    mesh.material.color.set(color);
    const pos = [], idx = [], h = this.ctx.getModel().heightAt.bind(this.ctx.getModel());
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      let tx = nx - px, tz = nz - pz; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const y = h(x, z) + 0.5;
      pos.push(x + tz * w / 2, y, z - tx * w / 2, x - tz * w / 2, y, z + tx * w / 2);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
    }
    mesh.geometry.dispose(); const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); mesh.geometry = g;
  }

  // ------------------------------------------------------------------ edits
  pushUndo() {
    this.undoStack.push({ objects: this.doc.objects.map(o => { const { _cell, ...r } = o; return r; }), roads: this.doc.roads ? JSON.parse(JSON.stringify(this.doc.roads)) : null });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }
  undo() {
    const u = this.undoStack.pop(); if (!u) { this.ctx.hud.toast('NOTHING TO UNDO', 900); return; }
    const roadsChanged = JSON.stringify(u.roads) !== JSON.stringify(this.doc.roads);
    this.doc.objects = u.objects; this.doc.roads = u.roads;
    this.selected = null; this.hover = null;
    if (this.edits) this.edits.load(this.doc.objects);
    if (roadsChanged) this.roadsDirty = true;
    this.save(); this.ctx.hud.toast('UNDO', 700);
  }
  place() {
    if (!this.cursor) return;
    const o = this.objAtCursor();
    this.pushUndo();
    this.doc.objects.push(o);
    if (this.edits) { this.edits.add(o); this.edits.flush(); }
    this.seed = (this.seed + 1) % 100000;
    if (this.piece.text) this.text = null;
    this.ghostKey = ''; this.ghostDirty = true;
    this.save();
  }
  removeObj(o) {
    if (!o) return;
    this.pushUndo();
    if (this.edits) { this.edits.remove(o); this.edits.flush(); }
    const i = this.doc.objects.indexOf(o); if (i >= 0) this.doc.objects.splice(i, 1);
    if (this.selected === o) this.selected = null; if (this.hover === o) this.hover = null;
    this.save();
  }
  changeSel(fn) {
    const o = this.selected; if (!o) return;
    this.pushUndo(); fn(o);
    if (this.edits) { this.edits.touch(o); this.edits.flush(); }
    this.save();
  }
  // roads: the doc takes its own copy of the spec roads the first time one changes
  ownRoads() { if (!this.doc.roads) this.doc.roads = ROADS.map(r => ({ type: r.type, pts: r.pts.map(p => [p[0], p[1]]), ...(r.name ? { name: r.name } : {}), ...(r.y != null ? { y: r.y } : {}) })); }
  roadFinish() {
    if (this.roadPts.length < 2) { this.roadPts = []; return; }
    this.pushUndo(); this.ownRoads();
    this.doc.roads.push({ type: this.roadType, pts: this.roadPts.map(p => [Math.round(p[0]), Math.round(p[1])]) });
    this.roadPts = []; this.roadsDirty = true; this.save();
    this.ctx.hud.toast('ROAD ADDED — APPLY ROADS to build it', 2200); this.refreshStatus();
  }
  roadDelete(idx) {
    if (idx < 0) return;
    this.pushUndo(); this.ownRoads();
    const r = this.doc.roads[idx]; if (!r) return;
    this.doc.roads.splice(idx, 1); this.roadsDirty = true; this.save();
    this.ctx.hud.toast('ROAD REMOVED' + (r.name ? ' · ' + r.name : '') + ' — APPLY ROADS', 2200); this.refreshStatus();
  }
  applyRoads() { this.flushSave(); this.ctx.hud.toast('REBUILDING THE CITY…', 2500); setTimeout(() => this.ctx.rebuild(), 60); }

  save() { this.status.saved = 'saving…'; this.refreshStatus(); clearTimeout(this.saveT); this.saveT = setTimeout(() => this.flushSave(), 700); }
  async flushSave() { clearTimeout(this.saveT); this.saveT = null; const r = await saveCityDoc(this.doc); this.status.server = r.server; this.status.saved = r.server ? 'saved to file' : 'saved locally'; this.refreshStatus(); }

  // ------------------------------------------------------------------ mouse
  bindMouse() {
    const el = this.ctx.renderer.domElement;
    el.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (!this.active) return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 2) { this.mouse.orbit = true; return; }
      if (e.button === 1) { this.mouse.pan = true; e.preventDefault(); return; }
      if (e.button !== 0) return;
      this.updateCursor();
      if (this.tool === 'road') {
        if (this.cursor) { if (!this.roadPts.length && this.hoverRoad >= 0 && e.shiftKey) { this.roadDelete(this.hoverRoad); return; } this.roadPts.push([this.cursor.x, this.cursor.z]); }
        return;
      }
      if (this.tool === 'select' || (this.hover && e.shiftKey)) { this.selected = this.hover; this.refreshStatus(); return; }
      if (this.tool === 'place') { this.place(); this.mouse.place = true; this.mouse.lastPlace = { ...this.cursor }; }
    });
    addEventListener('pointerup', e => { this.mouse.orbit = false; this.mouse.pan = false; this.mouse.place = false; });
    addEventListener('pointermove', e => {
      if (!this.active) return;
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.mouse.orbit) { this.orbit.yaw -= dx * 0.006; this.orbit.pitch = Math.max(0.12, Math.min(1.45, this.orbit.pitch + dy * 0.005)); }
      else if (this.mouse.pan) { const s = this.orbit.dist * 0.0018, fx = Math.sin(this.orbit.yaw), fz = Math.cos(this.orbit.yaw); this.target.x += (-dx * fz + dy * fx) * s; this.target.z += (dx * fx + dy * fz) * s; }
      else if (this.mouse.place && e.shiftKey && this.tool === 'place') {
        // shift-drag: a brush — keep placing every few metres (trees, lamps, fences)
        this.updateCursor();
        if (this.cursor && this.mouse.lastPlace && Math.hypot(this.cursor.x - this.mouse.lastPlace.x, this.cursor.z - this.mouse.lastPlace.z) > this.brushSpacing()) { this.place(); this.mouse.lastPlace = { ...this.cursor }; }
      }
    });
    el.addEventListener('wheel', e => { if (!this.active) return; this.orbit.dist = Math.max(12, Math.min(1500, this.orbit.dist * (1 + e.deltaY * 0.0012))); }, { passive: true });
  }
  brushSpacing() { const fp = this.piece.fp; return fp ? Math.max(fp[0], fp[1]) * this.scale + 1 : 7; }

  // ------------------------------------------------------------------ keys
  bindKeys() {
    addEventListener('keydown', e => {
      if (!this.active) return;
      const k = e.key.toLowerCase(), tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); this.undo(); }
        if (k === 's') { e.preventDefault(); this.flushSave(); }
        return;
      }
      this.ctx.input.pressed.delete(k);                                 // the game must not see the keys the tool eats
      if (k === 'escape') { e.preventDefault(); if (this.roadPts.length) this.roadPts = []; else if (this.selected) this.selected = null; else this.exit(); }
      else if (k === 'r') { const d = e.shiftKey ? -15 : 15; if (this.selected) this.changeSel(o => o.r = ((o.r || 0) + d + 360) % 360); else { this.rot = (this.rot + d + 360) % 360; this.ghostDirty = true; } }
      else if (k === 't') { const r = Math.floor(Math.random() * 24) * 15; if (this.selected) this.changeSel(o => o.r = r); else { this.rot = r; this.ghostDirty = true; } }
      else if (k === 'v') { const c = Math.floor(Math.random() * PALETTE.length), s = Math.floor(Math.random() * 100000); if (this.selected) this.changeSel(o => { o.c = c; o.seed = s; }); else { this.colorIdx = c; this.seed = s; this.ghostDirty = true; } this.refreshSwatches(); }
      else if (k === 'c') { const next = this.colorIdx == null ? 0 : (this.colorIdx + 1) % (PALETTE.length + 1); const c = next === PALETTE.length ? null : next; if (this.selected) this.changeSel(o => { if (c == null) delete o.c; else o.c = c; }); else { this.colorIdx = c; this.ghostDirty = true; } this.refreshSwatches(); }
      else if (k === '[' || k === ']') { const f = k === '[' ? 0.9 : 1.1; if (this.selected) this.changeSel(o => o.s = +Math.max(0.3, Math.min(4, (o.s || 1) * f)).toFixed(2)); else { this.scale = +Math.max(0.3, Math.min(4, this.scale * f)).toFixed(2); this.ghostDirty = true; } this.refreshStatus(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (this.tool === 'road') { if (this.roadPts.length) this.roadPts.pop(); else if (this.hoverRoad >= 0) this.roadDelete(this.hoverRoad); } else this.removeObj(this.selected || this.hover); }
      else if (k === 'enter') { if (this.tool === 'road') this.roadFinish(); }
      else if (k === 'x') { this.setTool(this.tool === 'select' ? 'place' : 'select'); }
      else if (k === 'g') { this.snap = !this.snap; this.ctx.hud.toast('SNAP ' + (this.snap ? 'ON · 2 m' : 'OFF'), 900); }
      else if (k === 'h') { this.root.classList.toggle('hidden'); }
      else if (k === 'f') { this.target.set(this.ctx.car.x, 0, this.ctx.car.z); }
      else if (k === 'n') { const t = prompt('Sign text', this.text || ''); if (t != null) { this.text = t.trim() || null; if (this.selected) this.changeSel(o => { if (this.text) o.text = this.text; else delete o.text; }); this.ghostDirty = true; } }
      else if (k === 'z') { this.undo(); }
      else if (/^[1-7]$/.test(k)) { this.setCat(CATS[+k - 1][0]); }
      else if (k === 'tab') { e.preventDefault(); const list = PIECES.filter(p => p.cat === this.cat); const i = list.indexOf(this.piece); this.setPiece(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]); }
    });
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
    const root = document.createElement('div'); root.id = 'cityTool'; this.root = root;
    root.innerHTML = `
      <div class="ctHead"><b>CITY TOOL</b><span id="ctStatus"></span></div>
      <div class="ctTabs" id="ctTabs"></div>
      <div class="ctList" id="ctList"></div>
      <div class="ctSwatches" id="ctSwatches"></div>
      <div class="ctRow" id="ctReadout"></div>
      <div class="ctBtns">
        <button data-act="select">SELECT · X</button><button data-act="apply">APPLY ROADS</button><button data-act="undo">UNDO · Ctrl+Z</button>
        <button data-act="autofill">AUTOFILL</button><button data-act="export">EXPORT</button><button data-act="import">IMPORT</button>
        <button data-act="reset">RESET DRAFT</button><button data-act="exit">EXIT · B</button>
      </div>
      <div class="ctHint">click place · shift-drag brush · right-drag orbit · wheel zoom · WASD move · Q/E turn · R rotate · T random · V reroll · C colour · [ ] size · N sign text · Del remove · G snap · H hide · 1-7 tabs · Tab next</div>`;
    document.body.appendChild(root);
    root.addEventListener('pointerdown', e => e.stopPropagation());
    root.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    const tabs = root.querySelector('#ctTabs');
    for (const [id, name] of CATS) { const b = document.createElement('button'); b.textContent = name; b.dataset.cat = id; b.onclick = () => this.setCat(id); tabs.appendChild(b); }
    root.querySelector('.ctBtns').addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.act; if (!a) return;
      if (a === 'select') this.setTool(this.tool === 'select' ? 'place' : 'select');
      else if (a === 'apply') this.applyRoads();
      else if (a === 'undo') this.undo();
      else if (a === 'autofill') { this.doc.autofill = this.doc.autofill === false; this.flushSave().then(() => this.ctx.rebuild()); }
      else if (a === 'export') exportCityDoc(this.doc);
      else if (a === 'import') importCityDoc().then(d => { if (!d) return; this.pushUndo(); this.doc.objects = d.objects || []; this.doc.roads = d.roads || null; this.doc.autofill = d.autofill !== false; this.flushSave().then(() => this.ctx.rebuild()); });
      else if (a === 'reset') { if (confirm('Drop the local draft and reload the city from the file?')) { clearDraft(); location.reload(); } }
      else if (a === 'exit') this.exit();
    });
    const sw = root.querySelector('#ctSwatches');
    const auto = document.createElement('button'); auto.textContent = 'AUTO'; auto.dataset.c = ''; auto.onclick = () => { this.colorIdx = null; this.ghostDirty = true; this.refreshSwatches(); }; sw.appendChild(auto);
    PALETTE.forEach((c, i) => { const b = document.createElement('button'); b.style.background = hex(c); b.dataset.c = i; b.title = hex(c); b.onclick = () => { if (this.selected) this.changeSel(o => o.c = i); this.colorIdx = i; this.ghostDirty = true; this.refreshSwatches(); }; sw.appendChild(b); });
    this.setCat('houses');
  }
  setTool(t) { this.tool = t; this.ghostDrop(); this.ghostDirty = true; this.roadPts = []; this.refreshStatus(); this.root.querySelectorAll('.ctBtns button[data-act=select]').forEach(b => b.classList.toggle('on', t === 'select')); }
  setCat(id) {
    this.cat = id;
    this.root.querySelectorAll('#ctTabs button').forEach(b => b.classList.toggle('on', b.dataset.cat === id));
    const list = this.root.querySelector('#ctList'); list.innerHTML = '';
    if (id === 'roads') {
      for (const t of ROAD_ORDER) { const b = document.createElement('button'); b.textContent = `${ROAD_TYPES[t].name.toUpperCase()} · ${ROAD_TYPES[t].w} m`; b.style.borderLeftColor = hex(ROAD_COL[t]); b.dataset.road = t; b.onclick = () => { this.roadType = t; this.setTool('road'); this.refreshList(); }; list.appendChild(b); }
      this.setTool('road');
    } else {
      for (const p of PIECES.filter(p => p.cat === id)) { const b = document.createElement('button'); b.textContent = p.name; b.dataset.piece = p.id; b.onclick = () => this.setPiece(p); list.appendChild(b); }
      if (this.tool === 'road') this.setTool('place');
      if (this.piece.cat !== id) this.setPiece(PIECES.find(p => p.cat === id));
    }
    this.refreshList();
  }
  setPiece(p) { this.piece = p; if (this.tool !== 'place') this.setTool('place'); this.ghostDirty = true; this.refreshList(); this.refreshStatus(); }
  refreshList() {
    this.root.querySelectorAll('#ctList button').forEach(b => b.classList.toggle('on', b.dataset.piece ? b.dataset.piece === this.piece.id : b.dataset.road === this.roadType));
  }
  refreshSwatches() { this.root.querySelectorAll('#ctSwatches button').forEach(b => b.classList.toggle('on', (b.dataset.c === '' && this.colorIdx == null) || (b.dataset.c !== '' && +b.dataset.c === this.colorIdx))); }
  refreshStatus() {
    const st = this.root.querySelector('#ctStatus'), ro = this.root.querySelector('#ctReadout');
    if (!st) return;
    st.textContent = `${this.doc.objects.length} placed · ${this.doc.roads ? this.doc.roads.length + ' roads' : 'spec roads'} · ${this.status.saved}${this.status.server === false ? ' (no server)' : ''}${this.roadsDirty ? ' · ROADS NEED APPLY' : ''}`;
    const sel = this.selected;
    ro.textContent = sel ? `SELECTED ${BY_ID[sel.k]?.name || sel.k} · rot ${sel.r || 0}° · size ${sel.s || 1} · R/V/C/[ ]/N edit · Del remove`
      : this.tool === 'road' ? `ROAD · ${ROAD_TYPES[this.roadType].name} · click points · ENTER finish · Backspace undo point · Shift-click or Del on a road removes it`
      : this.tool === 'select' ? 'SELECT · click an object'
      : `${this.piece.name} · rot ${this.rot}° · size ${this.scale}${this.colorIdx != null ? ' · colour ' + this.colorIdx : ' · colour auto'}${this.text ? ' · "' + this.text + '"' : ''}${this.snap ? ' · SNAP' : ''}`;
    this.root.querySelectorAll('.ctBtns button[data-act=autofill]').forEach(b => b.classList.toggle('on', this.doc.autofill !== false));
    this.root.querySelectorAll('.ctBtns button[data-act=apply]').forEach(b => b.classList.toggle('warn', this.roadsDirty));
  }
}
