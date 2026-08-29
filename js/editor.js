// editor.js — the MAP MAKER. B in the city (or maker.html): the car stops, the
// camera comes off it, and a panel opens on the left: ~100 pieces to place,
// terrain brushes to sculpt and paint the ground, and a road tool that draws
// curved roads point by point with draggable handles. Everything autosaves
// (localStorage, and the file when tools/serve.mjs is running); APPLY ROADS
// rebuilds the world with the roads cut into the sculpted land.

import * as THREE from 'three';
import { PIECES, CATS, PALETTE, buildPiece, footprint, BY_ID } from './world/pieces.js';
import { Chunks } from './world/chunks.js';
import { ROAD_TYPES, ROADS } from './world/spec.js';
import { PAINT, PAINT_NAMES } from './world/build.js';
import { resample } from './track.js';
import { saveCityDoc, exportCityDoc, importCityDoc, clearDraft, probeServer } from './world/citydoc.js';

const ROAD_COL = { highway: 0xf5c145, blvd: 0xffd98a, street: 0xd8d4cc, hill: 0xff9a5c, coast: 0x7ed3ff, gravel: 0xc9a36a, canyon: 0xff6b3d, mine: 0xffe066, pier: 0xffffff, sand: 0xf7e7b0 };
const ROAD_ORDER = ['street', 'blvd', 'highway', 'hill', 'coast', 'gravel', 'canyon', 'mine', 'pier', 'sand'];
const BRUSHES = [['raise', 'RAISE'], ['lower', 'LOWER'], ['flatten', 'FLATTEN'], ['smooth', 'SMOOTH'], ['paint', 'PAINT']];
const hex = c => '#' + c.toString(16).padStart(6, '0');
const spline = pts => pts.length > 2 ? resample(pts.map(([x, z]) => ({ x, z, y: 0 })), false, 4).map(p => [p.x, p.z]) : pts;

export class Editor {
  // ctx: { scene, camera, renderer, input, hud, car, doc, getModel, getWorld, rebuild, maker }
  constructor(ctx) {
    this.ctx = ctx; this.doc = ctx.doc; this.active = false; this.maker = !!ctx.maker;
    this.tool = 'place'; this.cat = 'houses'; this.piece = PIECES[0];
    this.rot = 0; this.scale = 1; this.colorIdx = null; this.seed = 1; this.text = null; this.snap = false;
    this.brush = { kind: 'raise', r: 30, amount: 1, color: 3 };
    this.target = new THREE.Vector3(); this.orbit = { yaw: 0, pitch: 0.75, dist: 140 };
    this.cursor = null; this.hover = null; this.selected = null; this.hoverRoad = -1; this.roadSel = -1; this.hoverHandle = -1;
    this.roadType = 'street'; this.roadPts = []; this.roadsDirty = false;
    this.undoStack = []; this.terrainUndo = [];
    this.mouse = { x: 0, y: 0, orbit: false, pan: false, place: false, brush: false, dragHandle: -1, dragObj: null, lastPlace: null };
    this.helpers = new THREE.Group();
    this.ghost = null; this.ghostKey = ''; this.ghostMat = null;
    const edge = c => new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: c, depthTest: false }));
    this.hoverBox = edge(0xffe066); this.selBox = edge(0x6fe3a0);
    this.hoverBox.visible = this.selBox.visible = false; this.hoverBox.renderOrder = this.selBox.renderOrder = 20;
    const rib = c => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 15; m.visible = false; return m; };
    this.roadPreview = rib(0xffffff); this.roadHover = rib(0xff4040); this.roadSelRib = rib(0x6fe3a0);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; this.ring.renderOrder = 21;
    this.handles = new THREE.Group(); this.handleGeo = new THREE.SphereGeometry(1, 10, 8);
    this.handleMat = new THREE.MeshBasicMaterial({ color: 0xffe066, depthTest: false }); this.handleHotMat = new THREE.MeshBasicMaterial({ color: 0xff6b8f, depthTest: false });
    this.helpers.add(this.hoverBox, this.selBox, this.roadPreview, this.roadHover, this.roadSelRib, this.ring, this.handles);
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
    this.ctx.hud.toast((this.maker ? 'MAP MAKER' : 'CITY TOOL') + ' — click to place · right-drag orbit · wheel zoom · ' + (this.maker ? 'DRIVE HERE to test' : 'B/ESC exit'), 3200);
    this.refreshStatus();
  }
  exit() {
    if (!this.active) return;
    this.active = false; this.roadPts = []; this.selected = null; this.hover = null; this.roadSel = -1; this.rebuildHandles();
    this.ghostDrop(); for (const m of [this.hoverBox, this.selBox, this.roadPreview, this.roadHover, this.roadSelRib, this.ring]) m.visible = false;
    document.body.classList.remove('editing');
    this.root.classList.remove('on');
    this.ctx.camera.fov = 62; this.ctx.camera.updateProjectionMatrix();
    this.flushSave();
  }
  // drop the car where the camera is looking and drive it
  driveHere() {
    const t = this.target, y = this.ctx.getModel().heightAt(t.x, t.z);
    this.ctx.car.reset(t.x, t.z, this.orbit.yaw + Math.PI, y + 0.6);
    this.exit();
    this.ctx.hud.toast('DRIVE — B brings the maker back', 2000);
  }
  attach() { if (this.helpers.parent !== this.ctx.scene) this.ctx.scene.add(this.helpers); }
  onWorldRebuilt() { this.attach(); this.ghostDrop(); this.roadsDirty = false; this.roadSel = -1; this.rebuildHandles(); this.refreshStatus(); }
  get edits() { const w = this.ctx.getWorld(); return w && w.edits; }
  get atlas() { const w = this.ctx.getWorld(); return w && w.atlas; }
  get T() { const w = this.ctx.getWorld(); return w && w.T; }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.active) return;
    const k = this.ctx.input.keys, cam = this.ctx.camera;
    const spd = (k.has('shift') ? 2.2 : 1) * (0.9 * this.orbit.dist + 20) * dt;
    const fx = Math.sin(this.orbit.yaw), fz = Math.cos(this.orbit.yaw);        // camera sits at +(fx,fz) from the target
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
    if (this.mouse.brush && this.cursor && this.tool === 'terrain') this.strokeStep(dt);
    if (this.mouse.dragObj && this.dragDirty) { this.dragDirty = false; this.edits.touch(this.mouse.dragObj); this.edits.flush(); }
    if (this.ghostDirty) this.ghostBuild();
    this.updateHelpers();
  }

  // where on the ground is the mouse: march the ray down onto the height field
  pick(clientX, clientY) {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, m = this.ctx.getModel(), h = (x, z) => m.heightAt(x, z);
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
    if (this.snap && this.tool === 'place') { p.x = Math.round(p.x / 2) * 2; p.z = Math.round(p.z / 2) * 2; }
    const moved = !this.cursor || Math.hypot(p.x - this.cursor.x, p.z - this.cursor.z) > 0.25;
    this.cursor = p;
    if (moved && this.tool === 'place') this.ghostDirty = true;
    if (this.mouse.dragHandle >= 0 && this.roadSel >= 0) { this.doc.roads[this.roadSel].pts[this.mouse.dragHandle] = [Math.round(p.x), Math.round(p.z)]; this.roadsDirty = true; this.placeHandles(); }
    if (this.mouse.dragObj) { const ob = this.mouse.dragObj; if (Math.hypot(ob.x - p.x, ob.z - p.z) > 0.2) { ob.x = +p.x.toFixed(1); ob.z = +p.z.toFixed(1); this.dragDirty = true; } }
    // what's under the cursor
    this.hover = null; this.hoverRoad = -1; this.hoverHandle = -1;
    if (this.tool === 'road') {
      if (this.roadSel >= 0) { const pts = this.doc.roads[this.roadSel].pts; let bd = 6; pts.forEach(([x, z], i) => { const dd = Math.hypot(x - p.x, z - p.z); if (dd < bd) { bd = dd; this.hoverHandle = i; } }); }
      if (this.hoverHandle < 0 && this.T) { const n = this.T.nearestRoad(p.x, p.z); if (n && n.d < n.road.T.w / 2 + 3) this.hoverRoad = n.road.idx; }
    } else if (this.tool !== 'terrain') {
      let best = null, bd = 1e9;
      for (const ob of this.doc.objects) {
        const fp = footprint(ob); const rad = fp ? Math.max(fp[2], fp[3]) / 2 + 1 : 3.5;
        const dd = Math.hypot(ob.x - p.x, ob.z - p.z);
        if (dd < rad && dd < bd) { bd = dd; best = ob; }
      }
      this.hover = best;
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
    const road = this.tool === 'road', terrain = this.tool === 'terrain';
    if (this.hover && !road && !terrain) this.boxFor(this.hover, this.hoverBox); else this.hoverBox.visible = false;
    if (this.selected && !terrain) this.boxFor(this.selected, this.selBox); else this.selBox.visible = false;
    if (road) {
      const pts = this.cursor && this.roadPts.length ? [...this.roadPts, [this.cursor.x, this.cursor.z]] : this.roadPts;
      this.ribbon(this.roadPreview, spline(pts), ROAD_TYPES[this.roadType].w, ROAD_COL[this.roadType]); this.roadPreview.visible = pts.length > 1;
      if (this.roadSel >= 0 && this.doc.roads[this.roadSel]) { const r = this.doc.roads[this.roadSel]; this.ribbon(this.roadSelRib, spline(r.pts), ROAD_TYPES[r.type].w + 2, 0x6fe3a0); this.roadSelRib.visible = true; } else this.roadSelRib.visible = false;
      if (this.hoverRoad >= 0 && this.hoverRoad !== this.roadSel && !this.roadPts.length) { const r = this.T.roads[this.hoverRoad]; this.ribbon(this.roadHover, r.pts.length > 2 ? spline(r.pts) : r.pts, r.T.w + 4, 0xff4040); this.roadHover.visible = true; }
      else this.roadHover.visible = false;
      this.handles.children.forEach((h, i) => h.material = i === this.hoverHandle || i === this.mouse.dragHandle ? this.handleHotMat : this.handleMat);
    } else { this.roadPreview.visible = this.roadHover.visible = this.roadSelRib.visible = false; }
    this.handles.visible = road;
    if (terrain && this.cursor) { const y = this.ctx.getModel().heightAt(this.cursor.x, this.cursor.z); this.ring.position.set(this.cursor.x, y + 0.4, this.cursor.z); this.ring.scale.setScalar(this.brush.r); this.ring.visible = true; this.ring.material.color.set(this.brush.kind === 'paint' ? (PAINT[this.brush.color] || new THREE.Color(0xffffff)) : 0xffe066); }
    else this.ring.visible = false;
  }
  // a flat ribbon along points, lifted off the ground
  ribbon(mesh, pts, w, color) {
    mesh.material.color.set(color);
    const pos = [], idx = [], m = this.ctx.getModel(), h = (x, z) => m.heightAt(x, z);
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
  rebuildHandles() {
    while (this.handles.children.length) this.handles.remove(this.handles.children[0]);
    if (this.roadSel < 0 || !this.doc.roads || !this.doc.roads[this.roadSel]) return;
    for (const _ of this.doc.roads[this.roadSel].pts) { const h = new THREE.Mesh(this.handleGeo, this.handleMat); h.renderOrder = 22; this.handles.add(h); }
    this.placeHandles();
  }
  placeHandles() {
    const r = this.roadSel >= 0 && this.doc.roads && this.doc.roads[this.roadSel]; if (!r) return;
    const m = this.ctx.getModel(), s = Math.max(1.5, this.orbit.dist * 0.012);
    r.pts.forEach(([x, z], i) => { const h = this.handles.children[i]; if (!h) return; h.position.set(x, m.heightAt(x, z) + 1.5, z); h.scale.setScalar(s); });
  }

  // ------------------------------------------------------------------ terrain strokes
  strokeStart() {
    if (!this.cursor || !this.T) return;
    const T = this.T;
    this.terrainUndo.push({ dh: T.dh.slice(), paint: T.paint.slice(), empty: T.dhEmpty });
    if (this.terrainUndo.length > 8) this.terrainUndo.shift();
    this.brush.target = T.land(this.cursor.x, this.cursor.z);
    this.mouse.brush = true; this.strokeStep(1 / 60);
  }
  strokeStep(dt) {
    const b = this.brush, c = this.cursor, T = this.T, w = this.ctx.getWorld();
    if (!T || !w) return;
    const amt = b.kind === 'raise' || b.kind === 'lower' ? b.amount * 9 * dt : b.kind === 'paint' ? 1 : Math.min(1, b.amount * 4 * dt);
    T.brush(c.x, c.z, b.r, b.kind, amt, { target: b.target, color: b.color });
    w.terrainRefresh(c.x, c.z, b.r + 12);
    this.doc.terrainDirty = true;
  }
  strokeEnd() { if (!this.mouse.brush) return; this.mouse.brush = false; this.save(); }
  undoTerrain() {
    const u = this.terrainUndo.pop(); if (!u || !this.T) return false;
    this.T.dh.set(u.dh); this.T.paint.set(u.paint); this.T.dhEmpty = u.empty;
    const w = this.ctx.getWorld(); if (w) for (const t of w.terrainTiles) w.terrainRefresh(t.geometry.boundingSphere ? t.geometry.boundingSphere.center.x : 0, t.geometry.boundingSphere ? t.geometry.boundingSphere.center.z : 0, 2000);
    this.doc.terrainDirty = true; this.save(); return true;
  }

  // ------------------------------------------------------------------ edits
  pushUndo() {
    this.undoStack.push({ objects: this.doc.objects.map(o => { const { _cell, ...r } = o; return r; }), roads: this.doc.roads ? JSON.parse(JSON.stringify(this.doc.roads)) : null });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }
  undo() {
    if (this.tool === 'terrain' && this.undoTerrain()) { this.ctx.hud.toast('UNDO · terrain', 700); return; }
    const u = this.undoStack.pop(); if (!u) { this.ctx.hud.toast('NOTHING TO UNDO', 900); return; }
    const roadsChanged = JSON.stringify(u.roads) !== JSON.stringify(this.doc.roads);
    this.doc.objects = u.objects; this.doc.roads = u.roads;
    this.selected = null; this.hover = null;
    if (this.edits) this.edits.load(this.doc.objects);
    if (roadsChanged) { this.roadsDirty = true; this.rebuildHandles(); }
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
    this.doc.roads.splice(idx, 1); this.roadsDirty = true; this.roadSel = -1; this.rebuildHandles(); this.save();
    this.ctx.hud.toast('ROAD REMOVED' + (r.name ? ' · ' + r.name : '') + ' — APPLY ROADS', 2200); this.refreshStatus();
  }
  roadSelect(idx) { this.ownRoads(); this.roadSel = idx; this.rebuildHandles(); this.refreshStatus(); }
  roadInsertPoint(p) {
    const r = this.doc.roads[this.roadSel]; if (!r) return;
    let bi = 0, bd = 1e9;
    for (let i = 0; i < r.pts.length - 1; i++) { const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1]; const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1; let t = ((p.x - x1) * dx + (p.z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(p.x - (x1 + dx * t), p.z - (z1 + dz * t)); if (d < bd) { bd = d; bi = i; } }
    this.pushUndo(); r.pts.splice(bi + 1, 0, [Math.round(p.x), Math.round(p.z)]); this.roadsDirty = true; this.rebuildHandles(); this.save();
  }
  roadRemovePoint(i) {
    const r = this.doc.roads[this.roadSel]; if (!r || r.pts.length <= 2) { this.ctx.hud.toast('A ROAD NEEDS TWO POINTS — Del the road instead', 1400); return; }
    this.pushUndo(); r.pts.splice(i, 1); this.roadsDirty = true; this.rebuildHandles(); this.save();
  }
  roadSetType(t) {
    const r = this.doc.roads && this.doc.roads[this.roadSel]; if (!r) return;
    this.pushUndo(); r.type = t; this.roadsDirty = true; this.save(); this.refreshStatus();
  }
  applyRoads() { this.flushSave().then(() => { this.ctx.hud.toast('REBUILDING THE WORLD…', 2500); setTimeout(() => this.ctx.rebuild(), 60); }); }

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
      if (this.tool === 'terrain') { this.strokeStart(); return; }
      if (this.tool === 'road') {
        if (!this.cursor) return;
        if (this.hoverHandle >= 0) { this.pushUndo(); this.mouse.dragHandle = this.hoverHandle; return; }
        if (!this.roadPts.length && this.hoverRoad >= 0) {
          if (e.shiftKey) { if (this.hoverRoad === this.roadSel) this.roadInsertPoint(this.cursor); else this.roadDelete(this.hoverRoad); }
          else this.roadSelect(this.hoverRoad);
          return;
        }
        if (this.roadSel >= 0 && !this.roadPts.length) { this.roadSel = -1; this.rebuildHandles(); }
        this.roadPts.push([this.cursor.x, this.cursor.z]);
        return;
      }
      if (this.tool === 'select' || (this.hover && e.shiftKey) || (this.hover && this.hover === this.selected)) {
        this.selected = this.hover; this.refreshStatus();
        if (this.selected) { this.pushUndo(); this.mouse.dragObj = this.selected; }
        return;
      }
      if (this.tool === 'place') { this.place(); this.mouse.place = true; this.mouse.lastPlace = { ...this.cursor }; }
    });
    addEventListener('pointerup', () => {
      if (this.mouse.dragHandle >= 0) { this.mouse.dragHandle = -1; this.save(); }
      if (this.mouse.dragObj) { this.mouse.dragObj = null; this.save(); }
      this.strokeEnd();
      this.mouse.orbit = false; this.mouse.pan = false; this.mouse.place = false;
    });
    addEventListener('pointermove', e => {
      if (!this.active) return;
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.mouse.orbit) { this.orbit.yaw -= dx * 0.006; this.orbit.pitch = Math.max(0.12, Math.min(1.5, this.orbit.pitch + dy * 0.005)); }
      else if (this.mouse.pan) { const s = this.orbit.dist * 0.0018, fx = Math.sin(this.orbit.yaw), fz = Math.cos(this.orbit.yaw); this.target.x += (-dx * fz + dy * fx) * s; this.target.z += (dx * fx + dy * fz) * s; }
      else if (this.mouse.place && e.shiftKey && this.tool === 'place') {
        // shift-drag: a brush — keep placing every few metres (trees, lamps, fences)
        this.updateCursor();
        if (this.cursor && this.mouse.lastPlace && Math.hypot(this.cursor.x - this.mouse.lastPlace.x, this.cursor.z - this.mouse.lastPlace.z) > this.brushSpacing()) { this.place(); this.mouse.lastPlace = { ...this.cursor }; }
      }
    });
    el.addEventListener('wheel', e => {
      if (!this.active) return;
      if (e.ctrlKey) { e.preventDefault(); const d = e.deltaY > 0 ? -5 : 5; if (this.selected) this.changeSel(o => o.r = ((o.r || 0) + d + 360) % 360); else { this.rot = (this.rot + d + 360) % 360; this.ghostDirty = true; } this.refreshStatus(); return; }
      if (e.shiftKey || this.tool === 'terrain' && e.altKey) { this.brush.r = Math.max(4, Math.min(400, this.brush.r * (e.deltaY > 0 ? 0.87 : 1.15))); this.refreshStatus(); return; }
      this.orbit.dist = Math.max(12, Math.min(2500, this.orbit.dist * (1 + e.deltaY * 0.0012)));
      this.placeHandles();
    }, { passive: false });
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
      this.ctx.input.pressed.delete(k);                                 // the game must not see the keys the maker eats
      if (k === 'escape') { e.preventDefault(); if (this.roadPts.length) this.roadPts = []; else if (this.roadSel >= 0) { this.roadSel = -1; this.rebuildHandles(); } else if (this.selected) this.selected = null; else if (!this.maker) this.exit(); }
      else if (k === 'r') { const d = e.shiftKey ? -15 : 15; if (this.selected) this.changeSel(o => o.r = ((o.r || 0) + d + 360) % 360); else { this.rot = (this.rot + d + 360) % 360; this.ghostDirty = true; } }
      else if (k === 't') { const r = Math.floor(Math.random() * 24) * 15; if (this.selected) this.changeSel(o => o.r = r); else { this.rot = r; this.ghostDirty = true; } }
      else if (k === 'v') { const c = Math.floor(Math.random() * PALETTE.length), s = Math.floor(Math.random() * 100000); if (this.selected) this.changeSel(o => { o.c = c; o.seed = s; }); else { this.colorIdx = c; this.seed = s; this.ghostDirty = true; } this.refreshSwatches(); }
      else if (k === 'c') { const next = this.colorIdx == null ? 0 : (this.colorIdx + 1) % (PALETTE.length + 1); const c = next === PALETTE.length ? null : next; if (this.selected) this.changeSel(o => { if (c == null) delete o.c; else o.c = c; }); else { this.colorIdx = c; this.ghostDirty = true; } this.refreshSwatches(); }
      else if (k === '[' || k === ']') { const f = k === '[' ? 0.9 : 1.1; if (this.tool === 'terrain') this.brush.r = Math.max(4, Math.min(400, this.brush.r * (k === '[' ? 0.85 : 1.18))); else if (this.selected) this.changeSel(o => o.s = +Math.max(0.3, Math.min(4, (o.s || 1) * f)).toFixed(2)); else { this.scale = +Math.max(0.3, Math.min(4, this.scale * f)).toFixed(2); this.ghostDirty = true; } }
      else if (k === '-' || k === '=') { this.brush.amount = +Math.max(0.1, Math.min(4, this.brush.amount * (k === '-' ? 0.8 : 1.25))).toFixed(2); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (this.tool === 'road') { if (this.roadPts.length) this.roadPts.pop(); else if (this.hoverHandle >= 0) this.roadRemovePoint(this.hoverHandle); else if (this.roadSel >= 0 && this.hoverRoad === this.roadSel) this.roadDelete(this.roadSel); else if (this.hoverRoad >= 0) this.roadDelete(this.hoverRoad); } else if (this.tool !== 'terrain') this.removeObj(this.selected || this.hover); }
      else if (k === 'enter') { if (this.tool === 'road') this.roadFinish(); }
      else if (k === 'x') { this.setTool(this.tool === 'select' ? 'place' : 'select'); }
      else if (k === 'g') { this.snap = !this.snap; this.ctx.hud.toast('SNAP ' + (this.snap ? 'ON · 2 m' : 'OFF'), 900); }
      else if (k === 'h') { this.root.classList.toggle('hidden'); }
      else if (k === 'f') { this.target.set(this.ctx.car.x, 0, this.ctx.car.z); }
      else if (k === 'n') { const t = prompt('Sign text', this.text || ''); if (t != null) { this.text = t.trim() || null; if (this.selected) this.changeSel(o => { if (this.text) o.text = this.text; else delete o.text; }); this.ghostDirty = true; } }
      else if (k === 'z') { this.undo(); }
      else if (/^[1-8]$/.test(k)) { this.setCat(CATS[+k - 1][0]); }
      else if (k === 'tab') { e.preventDefault(); if (this.tool === 'terrain') { const i = BRUSHES.findIndex(b => b[0] === this.brush.kind); this.brush.kind = BRUSHES[(i + 1) % BRUSHES.length][0]; this.refreshList(); } else { const list = PIECES.filter(p => p.cat === this.cat); const i = list.indexOf(this.piece); this.setPiece(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]); } }
      this.refreshStatus();
    });
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
    const root = document.createElement('div'); root.id = 'cityTool'; this.root = root;
    root.innerHTML = `
      <div class="ctHead"><b>${this.maker ? 'MAP MAKER' : 'CITY TOOL'}</b><span id="ctStatus"></span></div>
      <div class="ctTabs" id="ctTabs"></div>
      <div class="ctList" id="ctList"></div>
      <div class="ctSwatches" id="ctSwatches"></div>
      <div class="ctRow" id="ctReadout"></div>
      <div class="ctBtns">
        <button data-act="drive">${this.maker ? 'DRIVE HERE · B' : 'DRIVE HERE'}</button><button data-act="select">SELECT · X</button><button data-act="apply">APPLY ROADS</button><button data-act="undo">UNDO · Ctrl+Z</button>
        <button data-act="base">BASE</button><button data-act="autofill">OLD DISTRICTS</button><button data-act="export">EXPORT</button><button data-act="import">IMPORT</button>
        <button data-act="reset">RESET DRAFT</button>${this.maker ? '' : '<button data-act="exit">EXIT · B</button>'}
      </div>
      <div class="ctHint">click place · shift-drag brush · drag a selected piece to move it · right-drag orbit · middle-drag pan · wheel zoom · ctrl+wheel rotate 5° · WASD move · Q/E turn · R rotate · T random · V reroll · C colour · [ ] size · N sign text · Del remove · G snap · H hide · 1-8 tabs · Tab next<br>TERRAIN: drag to sculpt · [ ] or shift+wheel radius · - = strength · ROADS: click points, Enter finishes; click a road to select, drag its handles, shift-click to add a point, Del on a handle removes it</div>`;
    document.body.appendChild(root);
    root.addEventListener('pointerdown', e => e.stopPropagation());
    root.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    const tabs = root.querySelector('#ctTabs');
    for (const [id, name] of CATS) { const b = document.createElement('button'); b.textContent = name; b.dataset.cat = id; b.onclick = () => this.setCat(id); tabs.appendChild(b); }
    root.querySelector('.ctBtns').addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.act; if (!a) return;
      if (a === 'drive') this.driveHere();
      else if (a === 'select') this.setTool(this.tool === 'select' ? 'place' : 'select');
      else if (a === 'apply') this.applyRoads();
      else if (a === 'undo') this.undo();
      else if (a === 'base') { if (confirm(this.doc.base === 'flat' ? 'Switch the base terrain to the old San Oozi coast/mountain/canyon? (your sculpting stays on top)' : 'Switch the base terrain to a flat plain?')) { this.doc.base = this.doc.base === 'flat' ? 'sanoozi' : 'flat'; this.flushSave().then(() => this.ctx.rebuild()); } }
      else if (a === 'autofill') { this.doc.autofill = this.doc.autofill !== true; this.flushSave().then(() => this.ctx.rebuild()); }
      else if (a === 'export') exportCityDoc(this.doc);
      else if (a === 'import') importCityDoc().then(d => { if (!d) return; this.pushUndo(); Object.assign(this.doc, { objects: d.objects || [], roads: d.roads || [], base: d.base || 'flat', autofill: d.autofill === true, terrain: d.terrain, terrainData: d.terrainData, terrainDirty: false }); this.flushSave().then(() => this.ctx.rebuild()); });
      else if (a === 'reset') { if (confirm('Drop the local draft and reload the world from the file?')) { clearDraft(); location.reload(); } }
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
      for (const t of ROAD_ORDER) { const b = document.createElement('button'); b.textContent = `${ROAD_TYPES[t].name.toUpperCase()} · ${ROAD_TYPES[t].w} m`; b.style.borderLeftColor = hex(ROAD_COL[t]); b.dataset.road = t; b.onclick = () => { if (this.roadSel >= 0) this.roadSetType(t); this.roadType = t; if (this.tool !== 'road') this.setTool('road'); this.refreshList(); }; list.appendChild(b); }
      this.setTool('road');
    } else if (id === 'terrain') {
      for (const [k, name] of BRUSHES) { const b = document.createElement('button'); b.textContent = name; b.dataset.brush = k; b.onclick = () => { this.brush.kind = k; this.refreshList(); this.refreshStatus(); }; list.appendChild(b); }
      PAINT_NAMES.forEach((name, i) => { if (!i) return; const b = document.createElement('button'); b.textContent = name; b.dataset.paint = i; b.style.borderLeftColor = hex(PAINT[i].getHex()); b.onclick = () => { this.brush.kind = 'paint'; this.brush.color = i; this.refreshList(); this.refreshStatus(); }; list.appendChild(b); });
      this.setTool('terrain');
    } else {
      for (const p of PIECES.filter(p => p.cat === id)) { const b = document.createElement('button'); b.textContent = p.name; b.dataset.piece = p.id; b.onclick = () => this.setPiece(p); list.appendChild(b); }
      if (this.tool === 'road' || this.tool === 'terrain') this.setTool('place');
      if (this.piece.cat !== id) this.setPiece(PIECES.find(p => p.cat === id));
    }
    this.refreshList();
  }
  setPiece(p) { this.piece = p; if (this.tool !== 'place') this.setTool('place'); this.ghostDirty = true; this.refreshList(); this.refreshStatus(); }
  refreshList() {
    this.root.querySelectorAll('#ctList button').forEach(b => b.classList.toggle('on',
      b.dataset.piece ? b.dataset.piece === this.piece.id : b.dataset.road ? b.dataset.road === (this.roadSel >= 0 && this.doc.roads[this.roadSel] ? this.doc.roads[this.roadSel].type : this.roadType)
        : b.dataset.brush ? b.dataset.brush === this.brush.kind : b.dataset.paint ? (this.brush.kind === 'paint' && +b.dataset.paint === this.brush.color) : false));
  }
  refreshSwatches() { this.root.querySelectorAll('#ctSwatches button').forEach(b => b.classList.toggle('on', (b.dataset.c === '' && this.colorIdx == null) || (b.dataset.c !== '' && +b.dataset.c === this.colorIdx))); }
  refreshStatus() {
    const st = this.root.querySelector('#ctStatus'), ro = this.root.querySelector('#ctReadout');
    if (!st) return;
    st.textContent = `${this.doc.objects.length} placed · ${this.doc.roads ? this.doc.roads.length + ' roads' : 'spec roads'} · ${this.doc.base === 'flat' ? 'flat base' : 'san oozi base'} · ${this.status.saved}${this.status.server === false ? ' (no server)' : ''}${this.roadsDirty ? ' · ROADS NEED APPLY' : ''}`;
    const sel = this.selected, b = this.brush;
    ro.textContent = this.tool === 'terrain' ? `${b.kind.toUpperCase()}${b.kind === 'paint' ? ' · ' + PAINT_NAMES[b.color] : ''} · radius ${Math.round(b.r)} m · strength ${b.amount} · drag on the ground`
      : sel ? `SELECTED ${BY_ID[sel.k]?.name || sel.k} · rot ${sel.r || 0}° · size ${sel.s || 1} · drag to move · R/V/C/[ ]/N edit · Del remove`
      : this.tool === 'road' ? (this.roadSel >= 0 ? `ROAD ${this.doc.roads[this.roadSel]?.name || '#' + this.roadSel} · ${ROAD_TYPES[this.doc.roads[this.roadSel]?.type]?.name} · drag handles · shift-click adds a point · Del on a handle removes it · pick a type to change it · ESC deselect`
        : `ROAD · ${ROAD_TYPES[this.roadType].name} · click points (3+ = a curve) · ENTER finish · click a road to select it · shift-click a road removes it`)
      : this.tool === 'select' ? 'SELECT · click an object · drag to move'
      : `${this.piece.name} · rot ${this.rot}° · size ${this.scale}${this.colorIdx != null ? ' · colour ' + this.colorIdx : ' · colour auto'}${this.text ? ' · "' + this.text + '"' : ''}${this.snap ? ' · SNAP' : ''}`;
    this.root.querySelectorAll('.ctBtns button[data-act=autofill]').forEach(b => b.classList.toggle('on', this.doc.autofill === true));
    this.root.querySelectorAll('.ctBtns button[data-act=base]').forEach(b => b.textContent = this.doc.base === 'flat' ? 'BASE: FLAT' : 'BASE: SAN OOZI');
    this.root.querySelectorAll('.ctBtns button[data-act=apply]').forEach(b => b.classList.toggle('warn', this.roadsDirty));
  }
}
