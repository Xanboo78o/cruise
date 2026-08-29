// tools/trace2concept.mjs <trace.json> <out concept.json> — Adam's drawing, traced,
// becomes a concept: every blue line a street, the green band the Crest with a
// range shaped to it, black lines in the orange the canyon floor, hatching lakes,
// stripes the sea, red blobs weather zones. Heights are the only invention.
import { readFileSync, writeFileSync } from 'node:fs';
const [inPath, outPath] = process.argv.slice(2);
const T = JSON.parse(readFileSync(inPath, 'utf8'));
const W = T.px.w, H = T.px.h, cx = W / 2, cy = H / 2;
const len = p => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
const rnd = pts => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
// join line fragments end to end when their ends nearly touch (the tracer splits at junctions)
function join(lines, gap) {
  // greedy: always merge the closest pair of free ends first, until none is within `gap`
  const L = lines.map(l => l.slice());
  while (true) {
    let best = null;
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
      const A = L[a], B = L[b];
      // prefer the continuation that keeps going the same way (a spur off a junction scores worse)
      const dirOut = (P, atEnd) => { const n = P.length, i = atEnd ? n - 1 : 0, j = atEnd ? Math.max(0, n - 8) : Math.min(n - 1, 7); const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      const ends = [[A[A.length - 1], B[0], 0, dirOut(A, true), dirOut(B, false)], [A[A.length - 1], B[B.length - 1], 1, dirOut(A, true), dirOut(B, true).map(v => -v)],
                    [A[0], B[0], 2, dirOut(A, false), dirOut(B, false)], [A[0], B[B.length - 1], 3, dirOut(A, false), dirOut(B, true).map(v => -v)]];
      for (const [p, q, mode, u, v] of ends) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > gap) continue; const straight = u[0] * v[0] + u[1] * v[1]; const score = d + 80 * (1 - straight); if (!best || score < best.score) best = { d, score, a, b, mode }; }
    }
    if (!best) break;
    const A = L[best.a], B = L[best.b];
    const merged = best.mode === 0 ? A.concat(B.slice(1)) : best.mode === 1 ? A.concat(B.slice(0, -1).reverse()) : best.mode === 2 ? B.slice(1).reverse().concat(A) : B.slice(0, -1).concat(A);
    L[best.a] = merged; L.splice(best.b, 1);
  }
  return L;
}
const roads = [];
// the Crest: the green centreline(s), joined; the longest is the highway
const crest = join(T.crest || [], 130).sort((a, b) => len(b) - len(a)).filter(p => len(p) >= 120);
crest.forEach((p, i) => roads.push({ type: 'hill', name: i ? 'CREST SPUR' : 'ANGELES CREST', pts: rnd(p) }));
console.log('crest pieces (px):', (T.crest || []).map(p => Math.round(len(p))).join(' '), '→ joined:', crest.map(p => Math.round(len(p))).join(' '));
console.log('crest ends:', crest.map(p => `[${p[0].map(Math.round)}]→[${p[p.length - 1].map(Math.round)}]`).join('  '));
// blue: streets, fragments left as they are (they meet at the junctions they were cut at)
for (const p of join(T.roads || [], 6)) if (len(p) >= 30) roads.push({ type: 'street', pts: rnd(p) });   // fragments that touch end to end are one road
// rivers: black lines in the valleys — a shallow cut in the lowland; inside the
// canyon they are the DIVOTS: slot trenches two canyon roads wide, cut down into
// a low mesa, with a gravel road along each floor. The end nearest the streets
// is the mouth (the floor ramps up to the land there); the other end is a dead
// end. A long one is open at both ends.
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inCanyon = p => (T.canyon || []).some(poly => inPoly(p, poly));
const allRivers = T.rivers || [];
const rivers = join(allRivers.filter(p => !inCanyon(p[Math.floor(p.length / 2)])), 30).filter(p => len(p) >= 80);
const riverValleys = rivers.map(p => ({ pts: rnd(p), d: -16, r: 24 }));
const streetPtsPx = []; for (const p of T.roads || []) for (const q of p) streetPtsPx.push(q);
const distToStreets = p => { let b = 1e9; for (const q of streetPtsPx) b = Math.min(b, Math.hypot(p[0] - q[0], p[1] - q[1])); return b; };
const divots = join(allRivers.filter(p => inCanyon(p[Math.floor(p.length / 2)])), 60).filter(p => len(p) >= 120).sort((a, b) => len(b) - len(a));
const trenches = divots.map(p => {
  const dA = distToStreets(p[0]), dB = distToStreets(p[p.length - 1]), long = len(p) > 900;
  const pts = dA <= dB ? p : p.slice().reverse();                 // the mouth first
  return { pts: rnd(pts), floor: 10, w: 48, wall: 36, mouth: [300, long ? 300 : 0] };
});
trenches.forEach((t, i) => roads.push({ type: 'canyon', name: 'DIVOT ' + (i + 1), pts: t.pts.slice(), open: [true, t.mouth[1] > 0] }));   // joins only at an open end
console.log('divots (px):', divots.map(p => Math.round(len(p))).join(' '));
// the range: a ridge 100 px outside the Crest (away from the middle of the map), summits behind it
const ridges = [], peaks = [];
for (const p of crest.filter(p => len(p) >= 150)) {
  const rp = [], hs = [], total = len(p); let run = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if ((p[i][0] - cx) * nx + (p[i][1] - cy) * ny < 0) { nx = -nx; ny = -ny; }              // outward = away from the centre
    rp.push([Math.round(p[i][0] + nx * 100), Math.round(p[i][1] + ny * 100)]);
    // the range tapers over the last 560 px (1.4 km) at each end, so the Crest comes
    // down to the valley at ≤ 13 % — a faster taper leaves the road hanging in the air
    if (i) run += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    const endK = Math.min(1, Math.min(run, total - run) / 560);
    hs.push(Math.round(70 + (300 - 70) * endK));
    if (i % 6 === 3 && endK > 0.9) peaks.push({ x: Math.round(p[i][0] + nx * 150), z: Math.round(p[i][1] + ny * 150), h: 430 + ((i * 37) % 90), r: 90 });
  }
  ridges.push({ pts: rp, hs, h: 300, r: 170 });
}
const streetPts = []; for (const r of roads) if (r.type === 'street') for (const p of r.pts) streetPts.push(p);
const hull = pts => { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); };
const cityHull = streetPts.length > 10 ? hull(streetPts) : null;
const C = {
  _: 'built from ' + inPath + ' — every line is the traced centreline of what Adam drew',
  px: T.px, base: 'flat', peaks, ridges,
  regions: [
    ...(cityHull ? [{ pts: cityHull, flat: true, edge: 300 }] : []),
    ...(T.lowland || []).map(pts => ({ pts: rnd(pts), flat: true, edge: 60 })),
    ...(T.canyon || []).map(pts => ({ pts: rnd(pts), h: 64, edge: 100 })),   // a low mesa (the rim of the divots); streets climbing its 250 m side cut a bench
    ...(T.sea || []).map(pts => ({ pts: rnd(pts), d: -32, edge: 70, avoidRoads: 26 })),   // the water keeps off the streets: a road along the shore stays a shore road
    ...(T.lakes || []).map(pts => ({ pts: rnd(pts), d: -22, edge: 24, avoidRoads: 20 })),
  ],
  valleys: riverValleys,
  trenches,
  paintPolys: (T.canyon || []).map(pts => ({ pts: rnd(pts), color: 11 })),
  roads,
  forests: [
    ...crest.filter(p => len(p) >= 150).map(p => ({ pts: rnd(p), r: 110, kinds: ['pine', 'pine', 'tallpine'], spacing: 15 })),
    ...ridges.map(r => ({ pts: r.pts, r: 120, kinds: ['pine', 'tallpine'], spacing: 16 })),
    ...(T.lakes || []).map(pts => ({ pts: rnd(pts), r: 40, kinds: ['broadleaf', 'oak', 'bush'], spacing: 14 })),
  ],
  zones: (T.zones || []).map((pts, i) => ({ kind: 'weather', name: 'WEATHER ' + (i + 1), pts: rnd(pts) })),
  objects: [],
};
writeFileSync(outPath, JSON.stringify(C));
console.log(`${outPath}: ${roads.length} roads (${roads.filter(r => r.type === 'street').length} streets, ${crest.length} crest, ${rivers.length} rivers), ${C.regions.length} regions, ${C.zones.length} zones, ${peaks.length} summits`);
