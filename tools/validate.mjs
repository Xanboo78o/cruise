// Layout check: length, tightest corner, self-intersection, and an ASCII map.
import { TRACKS, TRACK_ORDER } from '../js/tracks.js';
import { TrackModel } from '../js/track.js';

function segHit(a, b, c, d) {
  const s1x = b.x - a.x, s1z = b.z - a.z, s2x = d.x - c.x, s2z = d.z - c.z;
  const den = -s2x * s1z + s1x * s2z;
  if (Math.abs(den) < 1e-9) return false;
  const s = (-s1z * (a.x - c.x) + s1x * (a.z - c.z)) / den;
  const t = (s2x * (a.z - c.z) - s2z * (a.x - c.x)) / den;
  return s > 0 && s < 1 && t > 0 && t < 1;
}

for (const id of TRACK_ORDER) {
  const def = TRACKS[id];
  const t0 = Date.now();
  const m = new TrackModel(def);
  const s = m.samples, n = s.length;
  let minR = 1e9, minRat = 0;
  for (let i = 0; i < n; i++) { const r = Math.abs(s[i].k) > 1e-6 ? 1 / Math.abs(s[i].k) : 1e9; if (r < minR) { minR = r; minRat = s[i].s; } }
  let hits = 0, tooClose = 1e9, tcAt = null; const hitAt = [];
  const step = 3;
  for (let i = 0; i < n; i += step) {
    for (let j = i + 12; j < n; j += step) {
      const sep = def.closed ? Math.min(j - i, n - (j - i)) : j - i;
      if (sep < 12) continue;
      if (!def.closed && (i + step >= n || j + step >= n)) continue;   // no wrap on point-to-point
      const a = s[i], b = s[(i + step) % n], c = s[j], d = s[(j + step) % n];
      if (segHit(a, b, c, d)) { hits++; if (hits < 8) hitAt.push(`${Math.round(a.s)}m x ${Math.round(c.s)}m`); }
      const gap = Math.hypot(a.x - c.x, a.z - c.z) - def.width;
      if (gap < tooClose) { tooClose = gap; tcAt = [Math.round(a.s), Math.round(c.s)]; }
    }
  }
  const prof = m.profile;
  const vAvg = prof.v.reduce((a, b) => a + b, 0) / n;
  const lapT = m.length / vAvg;
  console.log(`\n=== ${def.name} (${id}) ===`);
  console.log(`length ${m.length.toFixed(0)} m | samples ${n} | build ${Date.now() - t0} ms`);
  console.log(`tightest radius ${minR.toFixed(1)} m at ${minRat.toFixed(0)} m | brake zones ${prof.brakes.length}`);
  console.log(`ideal-ish lap ${lapT.toFixed(1)} s | avg ${(vAvg * 2.237).toFixed(0)} mph | top ${(Math.max(...prof.v) * 2.237).toFixed(0)} mph | min ${(Math.min(...prof.v) * 2.237).toFixed(0)} mph`);
  console.log(`self-intersections ${hits} ${hitAt.join(', ')} | closest other-leg gap ${tooClose.toFixed(1)} m ${tooClose < 8 ? '<-- TIGHT ' + tcAt : ''}`);
  console.log('brake points (m -> entry mph -> min mph): ' +
    prof.brakes.map(b => `${b.dist.toFixed(0)}:${(b.entry * 2.237).toFixed(0)}->${(b.exit * 2.237).toFixed(0)}`).join('  '));

  const W = 78, H = 30;
  const bx = m.bounds, sx = (bx.maxX - bx.minX), sz = (bx.maxZ - bx.minZ);
  const sc = Math.min((W - 2) / sx, (H - 2) / sz);
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  const put = (x, z, ch) => {
    const gx = Math.round((x - bx.minX) * sc) + 1;
    const gy = H - 2 - Math.round((z - bx.minZ) * sc);
    if (gx >= 0 && gx < W && gy >= 0 && gy < H) grid[gy][gx] = ch;
  };
  for (let i = 0; i < n; i++) put(s[i].x, s[i].z, prof.state[i] === 2 ? '#' : prof.state[i] === 0 ? '.' : '-');
  for (const b of prof.brakes) put(m.line[b.i].x, m.line[b.i].z, 'B');
  put(s[0].x, s[0].z, 'S');
  console.log(grid.map(r => r.join('')).join('\n'));
}
console.log('\nlegend: . power   - hold   # braking   B brake point   S start');
