// terrain.js — one height field, used by BOTH the visual mesh and the physics.
// If these two ever disagree the car floats or sinks, so there is exactly one
// function and everything asks it.

// deterministic value noise — same world every reload
function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (hash2(xi, zi) * (1 - u) + hash2(xi + 1, zi) * u) * (1 - v) +
         (hash2(xi, zi + 1) * (1 - u) + hash2(xi + 1, zi + 1) * u) * v;
}

export class Terrain {
  constructor(model, opts = {}) {
    this.m = model;
    this.rough = opts.rough ?? 0.35;          // how lumpy the land off the road is
    const s = model.samples;
    this.first = s[0];
    this.last = s[s.length - 1];
    const dz = (this.last.z - this.first.z) || 1;
    this.grade = (this.last.y - this.first.y) / dz;
  }

  // Ground height at any point in the world. On the road this is exactly the
  // road surface; off it, it relaxes out to the hillside over ~150 m.
  height(x, z, near) {
    const m = this.m;
    const nr = near || m.nearest(x, z);
    const road = nr.y ?? nr.p.y;
    const d = Math.abs(nr.lat) - m.halfWidth;
    if (d <= 0) return road;                                      // on the tarmac
    // kerb: a 5 cm rise over 1.3 m. Then the verge eases down 20 cm over 6 m
    // and rises gently — a shoulder you can use, not a ditch that eats a wheel.
    const kerb = 0.05 * Math.min(d / 1.3, 1);
    const verge = road + kerb - 0.20 * Math.min(Math.max(0, d - 1.3) / 6, 1) + Math.min(d, 12) * 0.012;
    if (d < 12) return verge;
    // beyond the verge the land fades toward the hillside, and the hills fade in
    const e = d - 12;
    const fade = Math.min(1, e / 40); const sm = fade * fade * (3 - 2 * fade);
    const hill = this.first.y + (z - this.first.z) * this.grade;
    const blend = Math.min(1, Math.max(0, (d - 14) / 150));
    let y = verge * (1 - blend) + hill * blend;
    y += vnoise(x * 0.012, z * 0.012) * Math.min(d * 0.55, 26) * this.rough * sm;
    y += vnoise(x * 0.06, z * 0.06) * Math.min(d * 0.08, 2.2) * sm;
    return y;
  }

  // Surface normal, by sampling. Used for gravity down a slope and for sitting
  // the car on the camber of whatever it's parked on.
  normal(x, z, out = {}) {
    const e = 1.4;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    const nx = (hL - hR) / (2 * e), nz = (hD - hU) / (2 * e);
    const inv = 1 / Math.hypot(nx, 1, nz);
    out.x = nx * inv; out.y = inv; out.z = nz * inv;
    return out;
  }

  // Small-scale roughness the tyres actually feel — tarmac is nearly smooth,
  // grass shakes your teeth out. Added on top of height() for the wheels only.
  bump(x, z, surf) {
    const amp = surf.bump ?? 0;
    if (!amp) return 0;
    return (vnoise(x * 1.35, z * 1.35) - 0.5) * amp +
           (vnoise(x * 4.1, z * 4.1) - 0.5) * amp * 0.45;
  }
}

// The city is flat, so its version is trivial — but it has to exist so the car
// doesn't care which world it's driving in.
export class FlatTerrain {
  constructor(y = 0) { this.y = y; }
  height() { return this.y; }
  normal(x, z, out = {}) { out.x = 0; out.y = 1; out.z = 0; return out; }
  bump(x, z, surf) {
    const amp = surf.bump ?? 0;
    if (!amp) return 0;
    return (vnoise(x * 1.35, z * 1.35) - 0.5) * amp;
  }
}
