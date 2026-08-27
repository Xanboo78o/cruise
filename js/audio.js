// audio.js — optional. Drop CC0 loops into assets/audio/ with the names below and
// they wire themselves up; with nothing there the game just runs silent. See
// assets/audio/README.md for where to get them.

const FILES = {
  engine: ['engine-loop.ogg', 'engine-loop.wav', 'engine-loop.mp3'],
  squeal: ['tire-squeal.ogg', 'tire-squeal.wav', 'tire-squeal.mp3'],
  wind:   ['wind-loop.ogg', 'wind-loop.wav', 'wind-loop.mp3'],
  gravel: ['gravel-loop.ogg', 'gravel-loop.wav', 'gravel-loop.mp3'],
};

export class Audio {
  constructor() { this.ready = false; this.enabled = true; this.loops = {}; this.missing = []; }

  async start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    for (const [name, list] of Object.entries(FILES)) {
      const buf = await this.tryLoad(list);
      if (!buf) { this.missing.push(name); continue; }
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = buf; src.loop = true; gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      this.loops[name] = { src, gain };
    }
    this.ready = Object.keys(this.loops).length > 0;
  }

  async tryLoad(names) {
    for (const n of names) {
      try {
        const res = await fetch('assets/audio/' + n);
        if (!res.ok) continue;
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* try the next extension */ }
    }
    return null;
  }

  set(name, gain, rate) {
    const l = this.loops[name];
    if (!l) return;
    const t = this.ctx.currentTime;
    l.gain.gain.setTargetAtTime(this.enabled ? gain : 0, t, 0.05);
    if (rate) l.src.playbackRate.setTargetAtTime(rate, t, 0.05);
  }

  update(car, surf) {
    if (!this.ready) return;
    const p = car.p;
    const rpmN = Math.min(car.rpm / p.redline, 1.1);
    this.set('engine', 0.16 + car.engineLoad * 0.2, 0.55 + rpmN * 1.25);
    this.set('squeal', Math.min(Math.max(car.rearSlide - 4, 0) / 22, 1) * 0.5);
    this.set('wind', Math.min(car.speed / 60, 1) * 0.28, 0.9 + car.speed / 120);
    this.set('gravel', surf && surf.grip < 0.7 && car.speed > 3 ? 0.34 : 0);
  }

  toggle() { this.enabled = !this.enabled; return this.enabled; }
}
