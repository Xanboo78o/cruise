// input.js — keyboard + gamepad. Analog triggers/stick when a pad is plugged in,
// otherwise the keys feed the same 0..1 channels.

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
    addEventListener('gamepadconnected', e => { this.padName = e.gamepad.id.slice(0, 24); });
  }

  tapped(k) {
    if (this.pressed.has(k)) { this.pressed.delete(k); return true; }
    return false;
  }
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  read() {
    const k = this.keys;
    let throttle = (k.has('w') || k.has('arrowup')) ? 1 : 0;
    let brake = (k.has('s') || k.has('arrowdown')) ? 1 : 0;
    let steer = ((k.has('d') || k.has('arrowright')) ? 1 : 0) - ((k.has('a') || k.has('arrowleft')) ? 1 : 0);
    let handbrake = k.has(' ') ? 1 : 0;
    let usingPad = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      const hb = (p.buttons[0] && p.buttons[0].pressed) || (p.buttons[5] && p.buttons[5].pressed) ? 1 : 0;
      if (Math.abs(ax) > 0.08 || rt > 0.03 || lt > 0.03 || hb) usingPad = true;
      if (usingPad) {
        const dz = 0.08;
        steer = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
        throttle = rt; brake = lt; handbrake = hb;
        this.pad = p;
      }
      break;
    }
    this.usingPad = usingPad;
    return { throttle, brake, steer, handbrake };
  }
}
