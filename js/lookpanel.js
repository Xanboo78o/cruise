// lookpanel.js — LAB ONLY. Sliders for the speed feel, and an fps readout.
//
// This used to also drive a post-processing filter stack. That's gone: Adam
// looked at it and said scrap the filters, so they're out of the code rather
// than switched off. It's in git if it's ever wanted back — see the commit
// "strip it back to nothing and make the effects A/B-able one at a time".
//
// Backtick (`) opens and closes it. Not part of the real game.

import { SPEED_KNOBS } from './look/speed.js';
import { DOF_KNOBS, POST_KNOBS } from './look/post.js';

const CSS = `
#lookPanel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 280px; z-index: 60;
  background: rgba(8,10,16,0.93); backdrop-filter: blur(10px);
  border-left: 1px solid rgba(255,255,255,0.12);
  font: 11px/1.4 ui-monospace, monospace; color: #d8dbe4;
  overflow-y: auto; padding: 12px 14px 40px; display: none;
}
#lookPanel.show { display: block; }
#lookPanel h3 { margin: 0 0 2px; font-size: 12px; letter-spacing: 3px; color: #ffb06b; }
#lookPanel .sub { color: #7b8394; margin-bottom: 12px; font-size: 10px; }
#lookPanel .knob { margin-bottom: 9px; }
#lookPanel .knob label { display: flex; justify-content: space-between; gap: 8px; color: #99a1b2; }
#lookPanel .knob label b { color: #fff; font-weight: 600; }
#lookPanel .knob input { width: 100%; margin: 3px 0 0; accent-color: #ffb06b; }
#lookPanel .acts { display: flex; gap: 5px; margin: 14px 0 6px; }
#lookPanel .acts button {
  font: inherit; font-size: 10px; letter-spacing: 1px; cursor: pointer; color: #d8dbe4;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px; padding: 5px 9px;
}
#lookPanel .acts button:hover { background: rgba(255,176,107,0.22); }
#lookPanel .hint { color: #656d7e; font-size: 10px; margin-top: 10px; }
#lookPanel textarea {
  width: 100%; height: 80px; margin-top: 8px; font: inherit; font-size: 9px;
  background: rgba(0,0,0,0.45); color: #9fe8b4; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; padding: 6px; resize: vertical;
}
`;

const KEY = 'cruise.lab.speed';

export class LookPanel {
  constructor(speedFeel, dof) {
    this.speed = speedFeel;
    this.dof = dof;
    const saved = this.load();
    if (saved && speedFeel) {
      for (const [k, v] of Object.entries(saved.speed || {})) speedFeel.set(k, v);
      speedFeel.enabled = saved.enabled !== false;
    }
    if (saved && dof) {
      for (const [k, v] of Object.entries(saved.dof || {})) dof.set(k, v);
      dof.enabled = !!saved.dofOn;
    }

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'lookPanel';
    el.innerHTML = `
      <h3>SPEED FEEL <span id="lookFps" style="float:right;color:#9fe8b4">--</span></h3>
      <div class="sub">lab only &middot; \` to hide &middot; <b>=</b> on/off &middot; saved in this browser<br>
        nothing here changes the handling.</div>
      <div id="speedKnobs"></div>
      <h3 style="margin-top:16px">DISTANCE BLUR</h3>
      <div class="sub"><b>5</b> on/off</div>
      <div id="dofKnobs"></div>
      <h3 style="margin-top:16px">THE FRAME</h3>
      <div class="sub">bloom, grade, vignette &middot; the look sets these; move one and it sticks until you switch looks</div>
      <div id="postKnobs"></div>
      <div class="acts">
        <button data-act="dump">COPY VALUES</button>
        <button data-act="reset">RESET</button>
      </div>
      <textarea id="lookDump" readonly placeholder="COPY VALUES puts the settings here — paste them at me and I'll bake them in"></textarea>
      <div class="hint">Start with <b>starts biting at</b> / <b>fully unhinged at</b>; everything else scales between those two speeds.</div>
    `;
    document.body.appendChild(el);
    this.el = el;

    const wrap = el.querySelector('#speedKnobs');
    wrap.innerHTML = Object.entries(SPEED_KNOBS).map(([k, [label, min, max, step]]) => `
      <div class="knob">
        <label><span>${label}</span><b data-val="${k}"></b></label>
        <input type="range" data-knob="${k}" min="${min}" max="${max}" step="${step}">
      </div>`).join('');

    if (dof) {
      const dw = el.querySelector('#dofKnobs');
      dw.innerHTML = Object.entries(DOF_KNOBS).map(([k, [label, min, max, step]]) => `
        <div class="knob">
          <label><span>${label}</span><b data-dval="${k}"></b></label>
          <input type="range" data-dknob="${k}" min="${min}" max="${max}" step="${step}">
        </div>`).join('');
      const pw = el.querySelector('#postKnobs');
      pw.innerHTML = Object.entries(POST_KNOBS).map(([k, [label, min, max, step]]) => `
        <div class="knob">
          <label><span>${label}</span><b data-dval="${k}"></b></label>
          <input type="range" data-dknob="${k}" min="${min}" max="${max}" step="${step}">
        </div>`).join('');
      const KN = { ...DOF_KNOBS, ...POST_KNOBS };
      const show = k => el.querySelector(`[data-dval="${k}"]`).textContent =
        KN[k][3] >= 1 ? Math.round(dof.v[k]) : dof.v[k].toFixed(2);
      for (const k of Object.keys(KN)) {
        const inp = el.querySelector(`[data-dknob="${k}"]`);
        inp.value = dof.v[k]; show(k);
        inp.addEventListener('input', () => { dof.set(k, +inp.value); show(k); this.save(); });
      }
    }

    this.inputs = {};
    for (const k of Object.keys(SPEED_KNOBS)) {
      const inp = wrap.querySelector(`[data-knob="${k}"]`);
      this.inputs[k] = inp;
      inp.addEventListener('input', () => {
        speedFeel.set(k, +inp.value);
        this.syncOne(k);
        this.save();
      });
    }
    this.syncAll();

    el.addEventListener('click', e => {
      const a = e.target.dataset.act;
      if (a === 'reset') {
        for (const [k, d] of Object.entries(SPEED_KNOBS)) speedFeel.set(k, d[4]);
        this.syncAll(); this.save();
      }
      if (a === 'dump') {
        const t = el.querySelector('#lookDump');
        t.value = JSON.stringify({ enabled: speedFeel.enabled, speed: speedFeel.v,
          dofOn: dof ? dof.enabled : false, dof: dof ? dof.v : null }, null, 0);
        t.select();
        try { document.execCommand('copy'); } catch (_) {}
      }
    });
    el.addEventListener('keydown', e => e.stopPropagation());

    addEventListener('keydown', e => {
      if (e.key === '`' || e.key === '~') { e.preventDefault(); this.el.classList.toggle('show'); }
      if (e.key === '=') { speedFeel.enabled = !speedFeel.enabled; this.save(); }
    });

    if (new URLSearchParams(location.search).get('panel') === '1') el.classList.add('show');

    // the only number I still can't measure for him
    this.fpsEl = el.querySelector('#lookFps');
    let frames = 0, t0 = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      if (++frames >= 30) {
        const now = performance.now();
        window.__fps = Math.round(frames * 1000 / (now - t0));
        if (this.el.classList.contains('show')) this.fpsEl.textContent = window.__fps + ' fps';
        frames = 0; t0 = now;
      }
    };
    tick();
  }

  syncOne(k) {
    const v = this.speed.v[k];
    this.el.querySelector(`[data-val="${k}"]`).textContent =
      SPEED_KNOBS[k][3] >= 1 ? Math.round(v) : v.toFixed(2);
  }

  syncAll() {
    for (const k of Object.keys(SPEED_KNOBS)) {
      this.inputs[k].value = this.speed.v[k];
      this.syncOne(k);
    }
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify({ enabled: this.speed.enabled, speed: this.speed.v,
        dof: this.dof ? this.dof.v : null, dofOn: this.dof ? this.dof.enabled : false })); } catch (_) {} }
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } }
}
