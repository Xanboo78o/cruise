// input.js — keyboard + gamepad. Analog triggers/stick when a pad is plugged in,
// otherwise the keys feed the same 0..1 channels.

const PAD_BUTTONS = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

export class Input {
  constructor(el) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { down: false, dx: 0, dy: 0, wheel: 0 };
    this.pad = null;
    this.padName = '';
    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      this.pressed.add(k);
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', () => { this.mouse.down = true; });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    addEventListener('mousemove', e => {
      if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    el.addEventListener('wheel', e => { this.mouse.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    addEventListener('gamepadconnected', e => { this.padName = e.gamepad.id.slice(0, 24); this.padJustConnected = true; });
  }

  tapped(k) {
    if (this.pressed.has(k)) { this.pressed.delete(k); return true; }
    return false;
  }
  // 'a', 'x', 'y', 'lb', 'rb', 'start', 'back', 'up'... — one event per press
  padTapped(name) { return this.tapped('pad:' + name); }

  // Xbox rumble, if the browser exposes it. strong/weak 0..1, ms.
  rumble(strong = 0.5, weak = 0.3, ms = 120) {
    const p = this.pad;
    const act = p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      else if (act.pulse) act.pulse(Math.max(strong, weak), ms);
    } catch { /* not every pad, not every browser */ }
  }
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  read() {
    const k = this.keys;
    let throttle = (k.has('w') || k.has('arrowup')) ? 1 : 0;
    let brake = (k.has('s') || k.has('arrowdown')) ? 1 : 0;
    // NOTE the sign: the physics body frame calls +x "right", but with Y up and
    // the camera looking down +z that side is on the LEFT of the screen. So D
    // (screen right) is -1 in the sim's terms. Every steer value past this point
    // is in sim terms; only this file and the HUD trace know about the screen.
    const want = ((k.has('a') || k.has('arrowleft')) ? 1 : 0) - ((k.has('d') || k.has('arrowright')) ? 1 : 0);
    // a key is a switch; a wheel isn't. Wind on over ~0.2 s, come off in ~0.08 s.
    const now = performance.now() / 1000, dt = Math.min(0.05, now - (this._t || now)); this._t = now;
    const cur = this._steer || 0;
    const rate = (want === 0 || Math.sign(want) !== Math.sign(cur)) ? 12 : 5;
    this._steer = cur + Math.max(-rate * dt, Math.min(rate * dt, want - cur));
    let steer = this._steer;
    let handbrake = k.has(' ') ? 1 : 0;
    let usingPad = false;

    // Xbox / standard mapping: LS steer, RT throttle, LT brake, A or RB drift,
    // X or LB item, Y camera, Start menu, Back hide HUD. Bumpers doubled so a
    // thumb never has to leave the stick.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.pad = p;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      const hb = (p.buttons[0] && p.buttons[0].pressed) || (p.buttons[5] && p.buttons[5].pressed) ? 1 : 0;
      if (Math.abs(ax) > 0.08 || rt > 0.03 || lt > 0.03 || hb) usingPad = true;
      if (usingPad) {
        const dz = 0.08;
        steer = Math.abs(ax) < dz ? 0 : -(ax - Math.sign(ax) * dz) / (1 - dz);   // same mirror as the keys
        throttle = rt; brake = lt; handbrake = hb;
      }
      // edge-detect the buttons so a press is one event, like a key tap
      const now = {};
      for (const [name, idx] of Object.entries(PAD_BUTTONS)) now[name] = !!(p.buttons[idx] && p.buttons[idx].pressed);
      for (const name in now) if (now[name] && !this._padPrev?.[name]) this.pressed.add('pad:' + name);
      this._padPrev = now;
      break;
    }
    this.usingPad = usingPad;
    return { throttle, brake, steer, handbrake };
  }
}
