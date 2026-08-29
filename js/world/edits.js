// world/edits.js — the layer of everything Adam placed with the city tool. Same
// chunk merger as the districts, but per 300 m cell it can be rebuilt on its
// own: place a house, only that cell's mesh is remade. Keeps the collision
// footprints and the lamp heads for the real lights.

import { Chunks, GlowLayer, CH } from './chunks.js';
import { WORLD } from './spec.js';
import { buildPiece, footprint } from './pieces.js';
import { Q } from '../quality.js';

export class EditLayer {
  constructor(group, atlas, T) {
    this.group = group; this.atlas = atlas; this.T = T;
    this.objects = [];
    this.cells = new Map();                                // key -> { objs: Set, C, G, walls: [] }
    this.dirty = new Set();
    this.night = false;
    this._walls = null; this._lamps = null;
  }
  key(o) { return Math.floor((o.x - WORLD.minX) / CH) * 1000 + Math.floor((o.z - WORLD.minZ) / CH); }
  cell(key) { let c = this.cells.get(key); if (!c) { c = { objs: new Set(), C: null, G: null, walls: [] }; this.cells.set(key, c); } return c; }

  load(objects) {
    for (const c of this.cells.values()) this.disposeCell(c);
    this.cells.clear(); this.objects = [...objects];                  // our own list: the document owns the real one
    for (const o of objects) { const k = this.key(o); this.cell(k).objs.add(o); o._cell = k; this.dirty.add(k); }
    this.flush();
  }
  add(o) { this.objects.push(o); const k = this.key(o); this.cell(k).objs.add(o); o._cell = k; this.dirty.add(k); }
  remove(o) { const i = this.objects.indexOf(o); if (i >= 0) this.objects.splice(i, 1); const c = this.cells.get(o._cell); if (c) { c.objs.delete(o); this.dirty.add(o._cell); } }
  // objects within r of (x, z), from this cell and its neighbours
  near(x, z, r) {
    const out = [], ci = Math.floor((x - WORLD.minX) / CH), cj = Math.floor((z - WORLD.minZ) / CH), n = Math.ceil(r / CH);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) { const c = this.cells.get(i * 1000 + j); if (!c) continue; for (const o of c.objs) if (Math.hypot(o.x - x, o.z - z) <= r) out.push(o); }
    return out;
  }
  removeWhere(list, pred) { const gone = []; for (const o of list) if (pred(o)) { this.remove(o); gone.push(o); } return gone; }
  touch(o) { const k = this.key(o); if (k !== o._cell) { const c = this.cells.get(o._cell); if (c) { c.objs.delete(o); this.dirty.add(o._cell); } this.cell(k).objs.add(o); o._cell = k; } this.dirty.add(k); }

  disposeCell(c) {
    for (const L of [c.C, c.G]) if (L) for (const m of L.meshes) { this.group.remove(m); m.geometry.dispose(); }
    if (c.G && c.G.material) c.G.material.dispose();
    c.C = null; c.G = null; c.walls = [];
  }

  flush() {
    if (!this.dirty.size) return;
    for (const k of this.dirty) {
      const c = this.cells.get(k); if (!c) continue;
      this.disposeCell(c);
      if (!c.objs.size) continue;
      const C = new Chunks(this.group, this.atlas), G = new GlowLayer(this.group);
      for (const o of c.objs) { try { buildPiece(C, G, this.T, o, Q.pbr); } catch (e) { console.warn('piece', o.k, e); } const fp = footprint(o); if (fp) c.walls.push(fp); }
      C.finish({ shadows: Q.shadows }); G.finish(); G.setNight(this.night);
      c.C = C; c.G = G;
    }
    this.dirty.clear();
    this._walls = null; this._lamps = null; this._chimneys = null;
  }

  get walls() { if (!this._walls) { this._walls = []; for (const c of this.cells.values()) this._walls.push(...c.walls); } return this._walls; }
  get lamps() { if (!this._lamps) { this._lamps = []; for (const c of this.cells.values()) if (c.G) this._lamps.push(...c.G.lamps); } return this._lamps; }
  get chimneys() { if (!this._chimneys) { this._chimneys = []; for (const c of this.cells.values()) if (c.C) this._chimneys.push(...c.C.chimneys); } return this._chimneys; }

  setNight(n) { this.night = n; for (const c of this.cells.values()) if (c.G) c.G.setNight(n); }
  update(camX, camZ, near, far) {
    for (const c of this.cells.values()) { if (c.C) c.C.update(camX, camZ, near, far); if (c.G) c.G.update(camX, camZ, near); }
  }
  dispose() { for (const c of this.cells.values()) this.disposeCell(c); this.cells.clear(); }
}
