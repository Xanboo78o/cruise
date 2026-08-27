// tracks.js — hand-drawn layouts. Every corner below is a radius and a pair of
// angles I picked on purpose; `arc` just saves me doing the trigonometry by hand.
// Nothing here is generated at runtime.

// Points along a circular corner. cx/cz = centre, r = radius, a0/a1 = degrees
// (0 = +x, 90 = +z). y0/y1 = elevation across the corner.
function arc(cx, cz, r, a0, a1, y0 = 0, y1 = y0, steps = 0) {
  if (!steps) steps = Math.max(4, Math.round(Math.abs(a1 - a0) / 30));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (a0 + (a1 - a0) * t) * Math.PI / 180;
    out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), y: y0 + (y1 - y0) * t });
  }
  return out;
}
const p = (x, z, y = 0) => ({ x, z, y });

// ---------------------------------------------------------------------------
// HARBOR LOOP — the main circuit. Long straight, one fast ess complex, a big
// 75 m sweeper you can hold sideways all the way through, one slow 2nd-gear
// right, and a flowing run back. Gentle elevation so there's a blind crest.
// ---------------------------------------------------------------------------
const harbor = {
  id: 'harbor',
  name: 'HARBOR LOOP',
  blurb: '1.2 km · flowing · the sweeper at T4 is the one',
  closed: true,
  width: 12,
  startIndex: 0.06,
  sky: 'sunset',
  pts: [
    // main straight, uphill, heading north
    p(-180, -92, 0.5), p(-180, -40, 1.6), p(-180, 10, 3.0), p(-180, 60, 4.4), p(-180, 100, 5.2),
    // T1 — fast right, 70 m radius, over the crest
    ...arc(-110, 100, 70, 180, 90, 5.6, 4.8).slice(1),
    // top esses — long-wavelength flicks, flat out in anything small
    p(-70, 177, 4.4), p(-30, 180, 4.0), p(10, 174, 3.4), p(50, 162, 2.6), p(90, 155, 1.8),
    // T4 — the 75 m sweeper, downhill on entry
    ...arc(90, 80, 75, 90, 0, 1.6, 0.2).slice(1),
    // east straight, dropping
    p(166, 40, -0.6), p(163, 0, -1.4),
    // T5 — slow 26 m right at the end of the straight. The brake-point corner.
    ...arc(139, -40, 26, 0, -90, -2.2, -2.6).slice(1),
    // bottom run home: gentle S, then a mild chicane
    p(102, -74, -2.6), p(66, -86, -2.4), p(34, -92, -2.2), p(6, -110, -1.8),
    p(-26, -116, -1.4), p(-58, -122, -1.0), p(-92, -136, -0.6),
    // final corner — 60 m right onto the main straight
    ...arc(-120, -92, 60, -90, -180, -0.4, 0.5).slice(1, -1),   // last point == pts[0]
  ],
  props: { trees: 'palm', barrier: 'tire', crowd: true },
};

// ---------------------------------------------------------------------------
// CANYON PASS — point to point, 110 m of descent, six switchbacks. Built for
// brake points: every hairpin arrives at the end of a downhill straight.
// ---------------------------------------------------------------------------
const canyon = {
  id: 'canyon',
  name: 'CANYON PASS',
  blurb: '2.0 km · point to point · 110 m down, six hairpins',
  closed: false,
  width: 11,
  startIndex: 0,
  sky: 'dawn',
  profile: { vMax: 46, aLat: 11.4 },      // mountain road, not a runway
  pts: [
    p(-190, 258, 112), p(-120, 252, 108), p(-50, 262, 102), p(20, 252, 96), p(84, 250, 92),
    ...arc(100, 228, 22, 90, -90, 91, 87).slice(1),          // hairpin 1 (east)
    p(74, 202, 85), p(10, 212, 81), p(-56, 200, 77), p(-104, 208, 74),
    ...arc(-120, 184, 22, 90, 270, 73, 69).slice(1),          // hairpin 2 (west)
    p(-96, 160, 67), p(-30, 170, 63), p(36, 158, 59), p(88, 164, 56),
    ...arc(104, 140, 22, 90, -90, 55, 51).slice(1),           // hairpin 3 (east)
    p(80, 114, 49), p(16, 124, 45), p(-50, 112, 41), p(-108, 118, 38),
    ...arc(-124, 94, 22, 90, 270, 37, 33).slice(1),           // hairpin 4 (west)
    p(-100, 70, 31), p(-36, 80, 27), p(30, 68, 23), p(92, 74, 20),
    ...arc(108, 50, 22, 90, -90, 19, 15).slice(1),            // hairpin 5 (east)
    p(84, 24, 13), p(20, 34, 10), p(-46, 22, 7), p(-110, 28, 5),
    ...arc(-126, 4, 22, 90, 270, 4, 2).slice(1),              // hairpin 6 (west)
    p(-100, -20, 1), p(-30, -12, 0), p(40, -22, -1), p(120, -14, -1), p(190, -24, -1),
  ],
  props: { trees: 'pine', barrier: 'rock', crowd: false },
};

// ---------------------------------------------------------------------------
// SEAWALL — short, wide, low-speed. Deliberately easy: a warm-up loop where
// every corner can be taken sideways without much commitment.
// ---------------------------------------------------------------------------
const seawall = {
  id: 'seawall',
  name: 'SEAWALL',
  blurb: '600 m · wide and slow · the warm-up',
  closed: true,
  width: 15,
  startIndex: 0.08,
  sky: 'noon',
  profile: { vMax: 40, aLat: 12.0 },
  pts: [
    p(-90, -20, 0), p(-90, 14, 0), p(-90, 50, 0),
    ...arc(-50, 50, 40, 180, 90).slice(1),            // -> (-50, 90)
    p(-4, 96, 0), p(40, 90, 0),
    ...arc(40, 50, 40, 90, 0).slice(1),               // -> (80, 50)
    p(80, 20, 0), p(80, -10, 0),
    ...arc(44, -10, 36, 0, -90).slice(1),             // -> (44, -46)
    p(10, -50, 0), p(-30, -44, 0), p(-64, -46, 0),
    ...arc(-64, -20, 26, -90, -180).slice(1, -1),     // last point == pts[0]
  ],
  props: { trees: 'palm', barrier: 'block', crowd: false },
};

export const TRACKS = { harbor, canyon, seawall };
export const TRACK_ORDER = ['harbor', 'canyon', 'seawall'];
