// world/mapscreen.js — the map of San Oozi: terrain shaded from the height
// field (rendered once, cached), every road, the districts' names, a marker for
// every race, and you. Arrows / stick move between markers, Enter picks; the
// mouse works too. Picking a race hands it back to main, which does the rest.

import { WORLD, ROADS, ROAD_TYPES, DISTRICTS, POIS } from './spec.js';
import { RACES } from './races.js';

const KIND_ICON = { circuit: '🏁', sprint: '⚡', touge: '⛰', drift: '〰' };

export class MapScreen {
  constructor(o) {
    this.o = o;                                  // { T, input, S, onPick(race), onClose() }
    this.root = document.getElementById('mapScreen');
    this.cv = document.getElementById('mapCanvas');
    this.g = this.cv.getContext('2d');
    this.sel = 0;
    this.active = false;
    this.base = null;                            // the cached terrain render
    this.padPrev = {};
    this.t = 0;
    this.player = { x: 0, z: -800, yaw: 0 };
    this.cv.addEventListener('click', e => {
      const r = this.cv.getBoundingClientRect();
      const px = (e.clientX - r.left) * (this.cv.width / r.width), py = (e.clientY - r.top) * (this.cv.height / r.height);
      let best = -1, bd = 900;
      RACES.forEach((rc, i) => { const [a, b] = this.P(rc.gate[0], rc.gate[1]); const d = (a - px) ** 2 + (b - py) ** 2; if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { if (best === this.sel) this.pick(); else { this.sel = best; this.draw(); } }
    });
  }

  // world -> canvas. +x is screen-LEFT in the 3D view; the map matches that
  // (north up, east on the left) so the map and the windscreen agree
  P(x, z) {
    const W = this.cv.width, H = this.cv.height;
    return [W - (x - WORLD.minX) / (WORLD.maxX - WORLD.minX) * W, H - (z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ) * H];
  }

  renderBase() {
    const T = this.o.T, W = this.cv.width, H = this.cv.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    const step = 2;                              // sample every other pixel, it's a map
    for (let py = 0; py < H; py += step) for (let px = 0; px < W; px += step) {
      const x = WORLD.maxX - (px / W) * (WORLD.maxX - WORLD.minX), z = WORLD.maxZ - (py / H) * (WORLD.maxZ - WORLD.minZ);
      const y = T.height(x, z);
      let r, gg, b;
      if (y < 0.3) { r = 24; gg = 58; b = 96; }
      else { const t = Math.min(1, y / 460); r = 46 + 120 * t; gg = 92 + 40 * (1 - t) - 30 * t; b = 42 + 30 * t; if (y > 380) { r = gg = b = 150 + (y - 380) * 0.8; } }
      const d = T.districtAt(x, z);
      if (d && d.fill !== 'mine' && d.fill !== 'lookout') { r = r * 0.55 + 70; gg = gg * 0.55 + 70; b = b * 0.55 + 78; }
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) { const i = ((py + dy) * W + px + dx) * 4; img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    const col = { highway: '#f5c145', blvd: '#ffd98a', street: '#d8d4cc', hill: '#ff9a5c', coast: '#7ed3ff', gravel: '#c9a36a', canyon: '#ff6b3d', mine: '#ffe066', pier: '#ffffff', sand: '#f7e7b0' };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.o.T.roads) {
      g.strokeStyle = col[r.type]; g.lineWidth = Math.max(1.2, ROAD_TYPES[r.type].w / 9);
      g.beginPath(); r.pts.forEach(([x, z], i) => { const [a, b] = this.P(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '11px monospace'; g.textAlign = 'center';
    for (const d of DISTRICTS) { const [a, b] = this.P((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2); g.fillText(d.name, a, b); }
    this.base = c;
  }

  show() {
    this.active = true; this.sel = Math.max(0, this.sel);
    this.root.classList.add('on');
    if (!this.base) this.renderBase();
    this.draw();
  }
  hide() { this.active = false; this.root.classList.remove('on'); }

  setPlayer(x, z, yaw) { this.player = { x, z, yaw }; }

  draw() {
    const g = this.g, W = this.cv.width, H = this.cv.height;
    g.drawImage(this.base, 0, 0);
    // markers
    RACES.forEach((rc, i) => {
      const [a, b] = this.P(rc.gate[0], rc.gate[1]);
      const on = i === this.sel;
      g.beginPath(); g.arc(a, b, on ? 11 : 7, 0, 7);
      g.fillStyle = on ? '#ffb06b' : 'rgba(255,255,255,0.85)'; g.fill();
      g.lineWidth = 2; g.strokeStyle = '#151820'; g.stroke();
      g.fillStyle = '#151820'; g.font = (on ? 'bold 13px' : '10px') + ' monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(KIND_ICON[rc.kind] || '•', a, b + 1);
      if (on) { g.fillStyle = '#fff'; g.font = 'bold 13px monospace'; g.fillText(rc.name, a, b - 20); }
    });
    // the player
    const [px, py] = this.P(this.player.x, this.player.z);
    g.save(); g.translate(px, py); g.rotate(this.player.yaw + Math.PI);
    g.fillStyle = '#7dff9a'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill(); g.restore();
    // the card
    const rc = RACES[this.sel];
    const card = document.getElementById('mapCard');
    card.innerHTML = `<b>${rc.name}</b><span>${rc.kind.toUpperCase()} · ${rc.laps > 1 ? rc.laps + ' LAPS' : 'ONE RUN'} · ${rc.walls.toUpperCase()} WALLS</span><p>${rc.blurb}</p><i>ENTER / A · fly in</i>`;
  }

  nav() {
    const inp = this.o.input;
    const k = key => inp.tapped(key);
    const n = { left: k('arrowleft') || k('a'), right: k('arrowright') || k('d'), up: k('arrowup') || k('w'), down: k('arrowdown') || k('s'), ok: k('enter') || k(' '), back: k('escape') || k('m') || k('backspace') };
    if (inp.padTapped('a')) n.ok = true; if (inp.padTapped('b') || inp.padTapped('back')) n.back = true;
    if (inp.padTapped('left')) n.left = true; if (inp.padTapped('right')) n.right = true; if (inp.padTapped('up')) n.up = true; if (inp.padTapped('down')) n.down = true;
    return n;
  }

  // arrows pick the nearest marker in that direction
  move(dx, dz) {
    const cur = RACES[this.sel];
    let best = -1, bs = 1e18;
    RACES.forEach((rc, i) => {
      if (i === this.sel) return;
      const vx = rc.gate[0] - cur.gate[0], vz = rc.gate[1] - cur.gate[1];
      const dot = vx * dx + vz * dz; if (dot <= 0) return;
      const score = (vx * vx + vz * vz) / (dot * dot / (vx * vx + vz * vz + 1) + 0.15);
      if (score < bs) { bs = score; best = i; }
    });
    if (best >= 0) this.sel = best;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const n = this.nav();
    // east is on the LEFT of the map (see P), so left = +x
    if (n.left) this.move(1, 0); if (n.right) this.move(-1, 0); if (n.up) this.move(0, 1); if (n.down) this.move(0, -1);
    if (n.left || n.right || n.up || n.down) this.draw();
    if (n.ok) this.pick();
    if (n.back) { this.hide(); this.o.onClose && this.o.onClose(); }
  }

  pick() { const rc = RACES[this.sel]; this.hide(); this.o.onPick(rc); }
}
