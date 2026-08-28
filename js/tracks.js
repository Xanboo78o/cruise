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
  blurb: '2 km · flowing · the sweeper at T4 is the one',
  closed: true,
  width: 30, scale: 1.7, yScale: 1.4,
  startIndex: 0.06,
  sky: 'sunset',
  jumps: [{ atFrac: 0.10, len: 32, h: 3.0 }],            // on the main straight, lands with 150 m to spare
  whoops: [{ atFrac: 0.75, len: 120, count: 4, h: 0.38 }],
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
  blurb: '3.3 km · point to point · 110 m down, six hairpins',
  closed: false,
  width: 24, scale: 1.5, yScale: 1.0,
  startIndex: 0,
  sky: 'dawn',
  rough: 1.0,                              // it's a mountain, let it be one
  profile: { vMax: 62, aLat: 16 },        // mountain road, not a runway
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
  blurb: '1 km · huge and fast · rolling · the warm-up',
  closed: true,
  width: 34, scale: 1.8, yScale: 1.0,
  startIndex: 0.08,
  sky: 'noon',
  profile: { vMax: 66, aLat: 16 },
  pts: [
    p(-90, -20, 0), p(-90, 14, 1), p(-90, 50, 2.5),
    ...arc(-50, 50, 40, 180, 90, 3, 5).slice(1),      // -> (-50, 90), climbing
    p(-4, 96, 6), p(40, 90, 5),
    ...arc(40, 50, 40, 90, 0, 4, 1).slice(1),         // -> (80, 50), dropping
    p(80, 20, 0), p(80, -10, 0),
    ...arc(44, -10, 36, 0, -90, 0, 0).slice(1),       // -> (44, -46)
    p(10, -50, 0), p(-30, -44, 0), p(-64, -46, 0),
    ...arc(-64, -20, 26, -90, -180, 0, 0).slice(1, -1),
  ],
  props: { trees: 'palm', barrier: 'block', crowd: false },
};

// ---------------------------------------------------------------------------
// OVAL — two 120 m sweepers and two long straights. Slipstream, three-wide,
// no brake points to speak of. The one where the bots are fastest.
// ---------------------------------------------------------------------------
const oval = {
  id: 'oval',
  name: 'THE OVAL',
  blurb: '2.2 km · two sweepers · flat out',
  closed: true,
  width: 34, scale: 1.0,
  startIndex: 0.05,
  sky: 'noon',
  profile: { vMax: 80, aLat: 17 },
  jumps: [{ atFrac: 0.66, len: 32, h: 3.0 }],
  tunnels: [{ atFrac: 0.86, len: 110 }],
  pts: [
    p(-260, -130, 0), p(-100, -130, 3), p(60, -130, 3.5), p(260, -130, 0),
    ...arc(260, 0, 130, -90, 90, 0, 0, 8).slice(1),
    p(100, 130, 0), p(-40, 130, 4), p(-260, 130, 0),
    ...arc(-260, 0, 130, 90, 270, 0, 0, 8).slice(1, -1),
  ],
  props: { trees: 'palm', barrier: 'tire', crowd: true },
};

// ---------------------------------------------------------------------------
// TOUGE — a mountain pass that loops: climbs the east face through esses,
// hairpins at the summit, drops the west face. 60 m of height each way.
// ---------------------------------------------------------------------------
const touge = {
  id: 'touge',
  name: 'TOUGE',
  blurb: '2.6 km · up one face, down the other · the summit switchbacks',
  closed: true,
  width: 24, scale: 1.5, yScale: 1.0,
  startIndex: 0.02,
  sky: 'dawn',
  rough: 1.0,
  profile: { vMax: 62, aLat: 16 },
  jumps: [{ atFrac: 0.012, len: 20, h: 2.2 }],           // over the start line
  tunnels: [{ atFrac: 0.68, len: 100 }],
  pts: [
    // valley floor, heading north
    p(-40, -250, 0), p(-40, -205, 2), p(-30, -170, 6),
    // the climb: esses up the east face
    p(10, -110, 12), p(60, -70, 19), p(80, -10, 26), p(50, 40, 33), p(70, 90, 40), p(110, 130, 47), p(120, 180, 53),
    // the summit: three stacked hairpins
    ...arc(90, 200, 30, 0, 180, 55, 57).slice(1),          // left, now heading south at x=60
    p(60, 170, 58),
    ...arc(30, 160, 30, 0, -180, 58, 59).slice(1),         // right, now heading north at x=0
    p(0, 200, 60),
    ...arc(-30, 220, 30, 0, 180, 60, 58).slice(1),         // left, now heading south at x=-60
    p(-60, 180, 55), p(-80, 120, 50),
    // the descent: esses down the west face
    p(-90, 80, 46), p(-140, 40, 40), p(-190, -10, 32), p(-160, -70, 24), p(-200, -130, 16), p(-165, -190, 9), p(-150, -250, 4),
    ...arc(-95, -250, 55, 180, 360, 3, 0, 6).slice(1, -1),  // round the bottom, back onto the floor heading north
  ],
  props: { trees: 'pine', barrier: 'rock', crowd: false },
};

// ---------------------------------------------------------------------------
// AIRFIELD — runways and taxiways: three long straights joined by hairpins
// and one fast kink. Flat, huge, a brake-point clinic.
// ---------------------------------------------------------------------------
const airfield = {
  id: 'airfield',
  name: 'AIRFIELD',
  blurb: '3.3 km · four runways · three hairpins and a kink',
  closed: true,
  width: 36, scale: 1.0,
  startIndex: 0.04,
  sky: 'noon',
  profile: { vMax: 80, aLat: 16 },
  jumps: [{ atFrac: 0.12, len: 36, h: 3.2 }],
  whoops: [{ atFrac: 0.44, len: 140, count: 5, h: 0.42 }],
  pts: [
    p(-420, -160, 0), p(-100, -160, 0), p(240, -160, 0),
    ...arc(240, -100, 60, -90, 90, 0, 0, 6).slice(1),                    // hairpin 1 (east)
    p(100, -40, 0), p(-100, -40, 0), p(-240, -40, 0),
    ...arc(-300, 20, 60, -90, -270, 0, 0, 6).slice(1),                   // hairpin 2 (west, left)
    p(-100, 80, 0), p(60, 80, 0), p(130, 100, 0), p(200, 100, 0), p(270, 80, 0),   // the kink
    ...arc(330, 140, 60, -90, 90, 0, 0, 6).slice(1),                     // hairpin 3 (east)
    p(200, 200, 0), p(0, 200, 0), p(-200, 200, 0), p(-380, 200, 0),
    ...arc(-420, 20, 180, 90, 270, 0, 0, 8).slice(1, -1),                // the big left onto the main straight
  ],
  props: { trees: 'palm', barrier: 'block', crowd: false },
};

// ---------------------------------------------------------------------------
// DOCKS — tight, flat, 90-degree corners between the warehouses. Handbrake
// country. Short lap, lots of contact.
// ---------------------------------------------------------------------------
const docks = {
  id: 'docks',
  name: 'THE DOCKS',
  blurb: '1.3 km · square corners · handbrake country',
  closed: true,
  width: 26, scale: 1.4,
  startIndex: 0.05,
  sky: 'night',
  profile: { vMax: 52, aLat: 15 },
  jumps: [{ atFrac: 0.09, len: 22, h: 2.6 }],
  tunnels: [{ atFrac: 0.18, len: 70 }],
  pts: [
    p(-150, -90, 0), p(-60, -90, 4), p(40, -90, 0),
    ...arc(70, -60, 30, -90, 0).slice(1),                                // right
    p(100, 0, 0),
    ...arc(130, 0, 30, 180, 90).slice(1),                                // left
    p(170, 30, 0),
    ...arc(170, 60, 30, -90, 90).slice(1),                               // hairpin right
    p(140, 90, 0), p(60, 90, 0),
    ...arc(60, 120, 30, -90, -180).slice(1),                             // left
    p(30, 150, 0),
    ...arc(0, 150, 30, 0, 90).slice(1),                                  // right... into the top straight
    p(-60, 180, 0), p(-150, 180, 0),
    ...arc(-150, 150, 30, 90, 180).slice(1),                             // left
    p(-180, 100, 0), p(-180, 0, 0), p(-180, -60, 0),
    ...arc(-150, -60, 30, 180, 270).slice(1, -1),                        // final left onto the straight
  ],
  props: { trees: 'palm', barrier: 'block', crowd: false },
};

export const TRACKS = { harbor, canyon, seawall, oval, touge, airfield, docks };
export const TRACK_ORDER = ['harbor', 'seawall', 'oval', 'airfield', 'docks', 'touge', 'canyon'];
