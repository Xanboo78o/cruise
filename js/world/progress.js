// world/progress.js — what you've done and what you've got. Medals per
// challenge and race, cash, cars owned, stickers earned, figurines and photos
// found. Local for now (this browser); the email sign-in syncs it later.

import { CAR_ORDER, PRESETS } from '../presets.js';

const KEY = 'cruise.progress.v1';
export const MEDALS = ['', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

// a few cars cost money; most are yours from the start
export const PRICES = { super: 24000, formula: 18000, firetruck: 9000, garbage: 7000, limo: 8000, tractor: 3000 };

export class Progress {
  constructor() {
    this.data = { cash: 2500, medals: {}, best: {}, owned: {}, stickers: [], found: { fig: [], photo: [] }, races: 0, wins: 0 };
    this.load();
  }
  load() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) this.data = { ...this.data, ...d, found: { fig: [], photo: [], ...(d.found || {}) } }; } catch {} }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} if (this.onSave) this.onSave(this.data); }
  replace(data) { this.data = data; this.save(); }

  medalFor(c, value) { const m = c.medal; if (!m) return 4; let k = 0; for (let i = 0; i < 4; i++) if (value >= m[i]) k = i + 1; return k; }
  // record a result; returns true if it's a new best
  result(id, value, medal) {
    const d = this.data;
    const better = d.best[id] == null || value > d.best[id];
    if (better) d.best[id] = value;
    if ((d.medals[id] || 0) < medal) d.medals[id] = medal;
    this.save();
    return better;
  }
  earn(cash) { this.data.cash += cash; this.save(); }
  has(kind, id) { return this.data.found[kind].includes(id); }
  collect(kind, id) { if (!this.has(kind, id)) { this.data.found[kind].push(id); this.save(); } }
  count(kind) { return this.data.found[kind].length; }
  owns(carId) { return !(carId in PRICES) || !!this.data.owned[carId]; }
  buy(carId) { const p = PRICES[carId]; if (p == null || this.owns(carId)) return true; if (this.data.cash < p) return false; this.data.cash -= p; this.data.owned[carId] = true; this.save(); return true; }
  sticker(name) { if (!this.data.stickers.includes(name)) { this.data.stickers.push(name); this.save(); return true; } return false; }
  raceDone(pos, total) { this.data.races++; if (pos === 1) this.data.wins++; this.save(); }
  get medalCount() { let n = 0; for (const k in this.data.medals) n += this.data.medals[k]; return n; }
  get platinums() { let n = 0; for (const k in this.data.medals) if (this.data.medals[k] === 4) n++; return n; }
}
