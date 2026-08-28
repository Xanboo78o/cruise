// hud.js — timing, telemetry and the minimap. All of it hides with H, because
// half the point of this thing is clean footage.

const fmt = t => {
  if (t == null || !isFinite(t)) return '--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(3);
};
const fmtDelta = d => (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(3);

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = {};
    for (const id of ['speed', 'unit', 'gear', 'rpmBar', 'lapTime', 'bestTime', 'delta', 'sectors',
                      'trackName', 'carName', 'aids', 'toast', 'driftAngle', 'driftHold', 'driftBar',
                      'gripBar', 'padHint', 'countdown', 'racePanel', 'racePos', 'raceTotal', 'raceLap', 'raceLaps',
                      'itemSlot', 'itemIcon', 'itemName', 'results', 'resultsTitle', 'resultsList']) {
      this.el[id] = root.querySelector('#' + id);
    }
    this.map = root.querySelector('#minimap');
    this.mapCtx = this.map.getContext('2d');
    this.trace = root.querySelector('#trace');
    this.traceCtx = this.trace.getContext('2d');
    this.history = [];
    this.toastT = 0;
    this.mapPath = null;
  }

  prepareMap(model) {
    const b = model.bounds, pad = 14;
    const w = this.map.width, h = this.map.height;
    const sx = (w - pad * 2) / (b.maxX - b.minX || 1);
    const sz = (h - pad * 2) / (b.maxZ - b.minZ || 1);
    const s = Math.min(sx, sz);
    this.mapT = {
      s, ox: pad + (w - pad * 2 - (b.maxX - b.minX) * s) / 2 - b.minX * s,
      oz: pad + (h - pad * 2 - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s, h,
    };
    this.model = model;
    // bake the track outline once
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const px = p => this.mapT.ox + p.x * this.mapT.s;
    const pz = p => this.mapT.h - (this.mapT.oz + p.z * this.mapT.s);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = Math.max(3, model.halfWidth * 2 * this.mapT.s);
    g.beginPath();
    model.samples.forEach((p, i) => i ? g.lineTo(px(p), pz(p)) : g.moveTo(px(p), pz(p)));
    if (model.closed) g.closePath();
    g.stroke();
    // ideal line, coloured by pedal state
    const cols = ['#36d97a', '#f5c145', '#e8483a'];
    g.lineWidth = 2;
    for (let i = 0; i < model.line.length - 1; i++) {
      g.strokeStyle = cols[model.profile.state[i]];
      g.beginPath();
      g.moveTo(px(model.line[i]), pz(model.line[i]));
      g.lineTo(px(model.line[i + 1]), pz(model.line[i + 1]));
      g.stroke();
    }
    this.mapPath = c;
  }

  toast(msg, ms = 2200) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastT = ms / 1000;
  }

  update(dt, s) {
    const e = this.el;
    e.speed.textContent = Math.round(s.speedDisplay);
    e.unit.textContent = s.unit;
    e.gear.textContent = s.reverse ? 'R' : s.gear;
    e.rpmBar.style.transform = `scaleX(${Math.min(s.rpm, 1)})`;
    e.rpmBar.classList.toggle('red', s.rpm > 0.93);
    e.lapTime.textContent = fmt(s.lap);
    e.bestTime.textContent = s.best ? fmt(s.best) : '--.---';
    if (s.delta == null) { e.delta.textContent = ''; e.delta.className = 'delta'; }
    else {
      e.delta.textContent = fmtDelta(s.delta);
      e.delta.className = 'delta ' + (s.delta <= 0 ? 'good' : 'bad');
    }
    e.sectors.innerHTML = s.sectors.map(x =>
      `<span class="${x.state}">${x.t == null ? '--.--' : x.t.toFixed(2)}</span>`).join('');
    e.trackName.textContent = s.trackName;
    e.carName.textContent = s.carName;
    e.aids.textContent = s.aids;
    e.padHint.textContent = s.padHint || '';

    const ang = Math.abs(s.driftAngle);
    e.driftAngle.textContent = ang.toFixed(0) + '°';
    // the drift bar is the turbo charge: fills while sliding, colour = level
    const charge = Math.min((s.driftCharge || 0) / 2.4, 1);
    e.driftBar.style.transform = `scaleX(${charge > 0 ? charge : Math.min(ang / 60, 1) * 0.3})`;
    e.driftBar.className = 'lv' + (s.driftLevel || 0);
    e.driftHold.textContent = s.driftLevel ? 'TURBO ' + '•'.repeat(s.driftLevel) : (s.driftHold > 0.4 ? s.driftHold.toFixed(1) + 's' : '');
    this.root.classList.toggle('boost', !!s.boost);
    this.root.classList.toggle('stunned', !!s.stunned);
    if (s.bump && !this.bumped) { this.root.classList.add('bump'); setTimeout(() => this.root.classList.remove('bump'), 320); }
    this.bumped = !!s.bump;

    // race
    const r = s.race;
    e.racePanel.style.display = r ? 'flex' : 'none';
    if (r) {
      e.racePos.textContent = 'P' + r.pos; e.raceTotal.textContent = '/' + r.total;
      e.raceLap.textContent = Math.min(r.lap + 1, r.laps); e.raceLaps.textContent = '/' + r.laps;
      if (r.state === 'countdown') {
        const n = Math.ceil(r.countdown);
        const txt = r.countdown > 3 ? '' : String(n);
        e.countdown.textContent = txt; e.countdown.className = txt ? 'show' : '';
      } else if (r.state === 'racing' && r.t < 1.1) {
        e.countdown.textContent = 'GO'; e.countdown.className = 'show go';
      } else e.countdown.className = '';
      if (r.state === 'finished') {
        e.results.classList.add('show');
        e.resultsTitle.textContent = r.pos === 1 ? 'P1 · YOU' : 'P' + r.pos;
        e.resultsList.innerHTML = r.standings.map(x =>
          `<li class="${x.isPlayer ? 'me' : ''}"><b>P${x.pos}</b>${x.name}<span>${x.time != null ? x.time.toFixed(2) : '…'}</span></li>`).join('');
      } else e.results.classList.remove('show');
    } else { e.countdown.className = ''; e.results.classList.remove('show'); }
    e.itemSlot.classList.toggle('has', !!s.item);
    if (s.item) { e.itemIcon.textContent = s.item.icon; e.itemName.textContent = s.item.label; }
    e.gripBar.style.transform = `scaleX(${Math.min(s.grip, 1)})`;
    this.root.classList.toggle('air', !!s.air);

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) e.toast.classList.remove('show');
    }

    this.history.push([s.throttle, s.brake, s.steer, Math.min(ang / 60, 1)]);
    if (this.history.length > 360) this.history.shift();
    this.drawTrace();
    this.drawMap(s);
  }

  drawTrace() {
    const c = this.traceCtx, w = this.trace.width, h = this.trace.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(10,12,18,0.42)';
    c.fillRect(0, 0, w, h);
    const n = this.history.length;
    if (n < 2) return;
    const series = [
      { i: 0, col: '#36d97a' },       // throttle
      { i: 1, col: '#e8483a' },       // brake
      { i: 3, col: '#59b8ff' },       // drift angle
    ];
    for (const s of series) {
      c.strokeStyle = s.col;
      c.lineWidth = 1.6;
      c.beginPath();
      for (let k = 0; k < n; k++) {
        const x = (k / (n - 1)) * w;
        const y = h - 2 - this.history[k][s.i] * (h - 4);
        k ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
    // steering, drawn from the middle
    c.strokeStyle = 'rgba(230,230,240,0.55)';
    c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1)) * w;
      const y = h / 2 + this.history[k][2] * (h / 2 - 3);      // screen-right is up; sim-right is the mirror
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }

  drawMap(s) {
    if (!this.mapPath) return;
    const c = this.mapCtx, w = this.map.width, h = this.map.height;
    c.clearRect(0, 0, w, h);
    c.drawImage(this.mapPath, 0, 0);
    const T = this.mapT;
    const P = (x, z) => [T.ox + x * T.s, T.h - (T.oz + z * T.s)];
    if (s.ghost) {
      const [gx, gy] = P(s.ghost.x, s.ghost.z);
      c.fillStyle = 'rgba(150,170,255,0.85)';
      c.beginPath(); c.arc(gx, gy, 3, 0, 7); c.fill();
    }
    if (s.pace) {
      const [px, py] = P(s.pace.x, s.pace.z);
      c.fillStyle = 'rgba(255,220,120,0.9)';
      c.beginPath(); c.arc(px, py, 3, 0, 7); c.fill();
    }
    if (s.others) for (const o of s.others) {
      const [ox, oy] = P(o.x, o.z);
      c.fillStyle = 'rgba(255,120,120,0.9)';
      c.beginPath(); c.arc(ox, oy, 2.6, 0, 7); c.fill();
    }
    const [x, y] = P(s.carX, s.carZ);
    c.save();
    c.translate(x, y);
    c.rotate(-s.carYaw + Math.PI);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, -5); c.lineTo(3.4, 4); c.lineTo(-3.4, 4);
    c.closePath(); c.fill();
    c.restore();
  }
}
