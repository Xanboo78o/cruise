// songs.js — the compositions. Every song is a chart: a key, a tempo, chord
// changes, and per-section parts (drum pattern strings and note events).
// Nothing is generated at play time; what is written here is what plays.
//
// Note events are [step, note|notes, lengthInSteps, velocity, extraOpts] inside
// a pattern of L steps (16 per bar). Drum strings: x hit, o soft, - ghost, . rest.

import { chord, midi } from './music.js';

// ------------------------------------------------------------ authoring tools
const X = (i, p, o = {}) => ({ i, p, ...o });                               // drum part
const N = (i, ev, L, o = {}) => ({ i, n: ev, L, ...o });                    // note part
const trp = (parts, semis) => parts.map(p => p.n ? { ...p, tr: (p.tr || 0) + semis } : p);

// fold a chord's notes into one octave starting at `lo`, sorted
function voice(sym, lo, extra = 0) {
  const raw = chord(sym, 4);
  const out = raw.map(n => { while (n < lo) n += 12; while (n >= lo + 12) n -= 12; return n; }).sort((a, b) => a - b);
  const uniq = [...new Set(out)];
  for (let i = 0; i < extra; i++) uniq.push(uniq[i] + 12);
  return uniq;
}
const root = (sym, oct) => chord(sym, oct)[0];
// chord tones spread over `span` octaves up from lo
function spread(sym, lo, span = 2) { const v = voice(sym, lo); const out = []; for (let o = 0; o < span; o++) for (const n of v) out.push(n + 12 * o); out.push(v[0] + 12 * span); return out; }

function rhythm(str) {                                   // 'x..x' → [{s, v}]
  const s = str.replace(/\|/g, ''); const out = [];
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '.' || c === ' ') continue; out.push({ s: i, v: c === 'x' ? 1 : c === 'X' ? 1.15 : c === 'o' ? 0.7 : 0.4 }); }
  for (let i = 0; i < out.length; i++) out[i].len = (i + 1 < out.length ? out[i + 1].s : s.length) - out[i].s;
  return out;
}
// chords comped to a rhythm, one chord per bar
function comp(inst, chords, rhy, lo, o = {}) {
  const ev = [], R = rhythm(rhy), extra = o.extra || 0;
  chords.forEach((sym, bar) => { const notes = voice(sym, lo, extra); for (const h of R) ev.push([bar * 16 + h.s, notes, o.len ?? Math.min(h.len, o.maxLen ?? 16), (o.vel ?? 0.8) * h.v, o.ev]); });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
// a bass line from chord roots: figure = [[step, interval, len, vel, extra]...] per bar
function bassline(inst, chords, figure, oct, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const r = root(sym, oct); for (const [s, iv, len, vel, ex] of figure) ev.push([bar * 16 + s, r + iv, len, vel ?? 0.85, ex]); });
  return N(inst, ev, 16 * chords.length, o);
}
// arpeggio: chord tones over `span` octaves, index pattern, one note per `stepLen`
function arp(inst, chords, lo, idx, stepLen, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const tones = spread(sym, lo, o.span ?? 2); for (let k = 0; k < idx.length; k++) { const s = k * stepLen; if (s >= 16) break; const n = tones[Math.min(idx[k], tones.length - 1)]; ev.push([bar * 16 + s, n, o.len ?? stepLen, (o.vel ?? 0.7) * (k % 4 === 0 ? 1 : 0.85)]); } });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
const line = (inst, L, ev, o = {}) => N(inst, ev.map(([s, n, len, v, ex]) => [s, Array.isArray(n) ? n.map(midi) : midi(n), len, v ?? 0.85, ex]), L, o);

// =============================================================================
// GROUP B — rally house. 90s house drums (clean, punchy, a garage shuffle in
// the hats), a bouncy bass on the offbeat eighths, a cowbell borrowed from
// phonk, and THE RIFF: Adam's "1,1,2,2,2,1,1,3,3,3 with the synth" — ten stabs
// on a dotted-eighth bounce across two bars, on a bright PlayStation-era
// pluck, in a major key. No distortion anywhere: the energy is the bounce.
// =============================================================================
// THE RIFF — the Gypsy Woman organ line, as close as memory allows: D minor,
// "Morse-code" staccato sixteenths, two on the tonic, three on the ♭6, two on
// the tonic, three on the 5th. One bar, one organ, single notes.
const RIFF_STEPS = [0, 1, 3, 4, 5, 8, 9, 11, 12, 13];
const RIFF_TOPN = ['D4', 'D4', 'Bb3', 'Bb3', 'Bb3', 'D4', 'D4', 'A3', 'A3', 'A3'].map(midi);
const RIFF_NOTES = RIFF_TOPN.map(n => [n]);
const RIFF_ROOT = ['D2', 'D2', 'Bb2', 'Bb2', 'Bb2', 'D2', 'D2', 'A2', 'A2', 'A2'].map(midi);
const RIFF_VEL = [1, 0.85, 1, 0.85, 0.9, 1, 0.85, 1, 0.85, 0.9];
const riffRootAt = st => { let r = RIFF_ROOT[0]; for (let i = 0; i < RIFF_STEPS.length; i++) if (RIFF_STEPS[i] <= st) r = RIFF_ROOT[i]; return r; };
const riffPluck = (o = {}) => N('m1', RIFF_STEPS.map((st, i) => [st, RIFF_NOTES[i], 1, (o.vel ?? 0.95) * RIFF_VEL[i], o.ev]), 16, o.part || {});
const riffTop = (o = {}) => N(o.inst || 'pluck', RIFF_STEPS.map((st, i) => [st, o.inst === 'lead' ? RIFF_TOPN[i] + (o.tr || 0) : [RIFF_TOPN[i] + (o.tr || 0)], 1, (o.vel ?? 0.8) * RIFF_VEL[i], o.ev]), 16, o.part || {});
// the riff over `bars` bars with the filter opening hit by hit — the build
const riffSweep = (bars, from, to, vel = 0.85) => {
  const ev = [], n = bars * RIFF_STEPS.length; let k = 0;
  for (let b1 = 0; b1 < bars; b1++) RIFF_STEPS.forEach((st, i) => { const u = k++ / n; ev.push([b1 * 16 + st, RIFF_NOTES[i], 1, vel * RIFF_VEL[i] * (0.7 + 0.3 * u), { cut: from * Math.pow(to / from, u) }]); });
  return N('m1', ev, bars * 16);
};
const BOUNCE_O = { cut: 1100, q: 2, fdec: 0.1 };
const bounce = (o = {}) => N('hbass', [2, 6, 10, 14].map(st => [st, riffRootAt(st), 1, o.vel ?? 0.9]), 16, { o: BOUNCE_O, ...(o.part || {}) });
const downSub = () => N('sub', [[0, midi('D2'), 2, 0.7]], 16);
const offOrgan = () => N('organ', [2, 6, 10, 14].map(st => [st, ['D4', 'F4', 'A4'].map(midi), 1, 0.7]), 16);
const DM = -3;                                              // the rest of the station follows the riff into D minor
const AB = ['Fm7', 'Dbmaj7', 'Abmaj7', 'Eb'];                // vi IV I V under the melody sections
const HOUSE_KICK = { f0: 180, f1: 50, sweep: 0.05, dec: 0.22, drive: 1.3, click: 0.6 };
const B8 = (bar7, bar8) => '................|'.repeat(6) + bar7 + '|' + bar8;   // an 8-bar string with only the last two bars filled
const gb = {
  kick: X('kick', 'x...x...x...x...', { o: HOUSE_KICK }),
  hatSoft: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.55, o: { dec: 0.045 } }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(3) + 'x...x...x...x...', { o: HOUSE_KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.9 }),
  snare: X('snare', '....x.......x...', { vel: 0.5, o: { dec: 0.14, tone: 195, snap: 0.8, body: 0.5 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.95, o: { dec: 0.045 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.9, o: { dec: 0.16 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.7, lvl: 0.25 }),
  rim: X('rim', '...x......x..x..', { vel: 0.5, lvl: 0.3 }),
  cowbell: X('cowbell', '......x.......x.|..........x.....', { vel: 0.7, lvl: 0.35, o: { dec: 0.2 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.45, lvl: 0.55 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  roll: X('snare', B8('........x...x...', 'x...x...x.x.xxxx'), { vel: 0.8, o: { dec: 0.12, snap: 1, body: 0.4 } }),
  riser: X('riser', 'x...............|'.repeat(7) + '................', { vel: 0.4, o: { dur: 60 / 124 * 32 } }),
  flutter: X('flutter', B8('................', '............x...'), { vel: 0.6, o: { dur: 0.7 } }),
  antilag: X('antilag', B8('..............x.', '................'), { vel: 0.7, o: { n: 4 } }),
  riff: riffPluck(), riffSoft: riffPluck({ vel: 0.38, ev: { cut: 900 } }), riffBuild: riffSweep(8, 700, 9000),
  riffHi: riffTop({ tr: 12, vel: 0.4, part: { lvl: 0.7 } }), riffLead: riffTop({ inst: 'lead', vel: 0.5, part: { lvl: 0.6 } }),
  bass: bounce(), sub: downSub(), organ: offOrgan(),
  pad: N('strings', [[0, [midi('D3'), midi('A3'), midi('D4')], 32, 0.5, { pad: true }]], 32, { lvl: 0.3 }),
  choir: comp('oo', ['Dm7', 'Bb'], 'x...............', 57, { len: 16, vel: 0.6, part: { lvl: 0.5, o: { a: 0.3, voices: 3 } } }),
  chops: N('oochop', [[0, 'Ab5', 2, 0.8], [3, 'Ab5', 2, 0.8], [6, 'Bb5', 3, 0.9, { glide: midi('Ab5') }], [21, 'C6', 2, 0.85], [24, 'C6', 3, 0.9, { glide: midi('Bb5') }]].map(e => [e[0], midi(e[1]), e[2], e[3], e[4]]), 32, { lvl: 0.4, tr: DM }),
};
const antilag = {
  id: 'antilag', station: 'groupb', name: 'ANTI-LAG', artist: 'Oo Motorsport Club', bpm: 124, key: 'Dm', swing: 0.14,
  duck: 0.45, duckRelease: 0.2, vinyl: 0.15, drumLevel: 0.92, drumDrive: 1.3,
  mix: { m1: { g: 0.7 }, pluck: { g: 0.6 }, hbass: { g: 0.72 }, sub: { g: 0.52 }, lead: { g: 0.4 }, oochop: { g: 0.55 } },
  sections: [
    { name: 'intro', bars: 8, parts: [gb.hatSoft, gb.shaker, gb.riffSoft, gb.sub] },
    { name: 'build', bars: 8, parts: [gb.kickIn, gb.clap, gb.hat, gb.ohat, gb.bass, gb.riffBuild, gb.riser, gb.roll, gb.antilag, gb.flutter] },
    { name: 'drop', bars: 16, drop: true, parts: [gb.crash, gb.kick, gb.clap, gb.snare, gb.hat, gb.ohat, gb.shaker, gb.rim, gb.bass, gb.sub, gb.riff, gb.riffHi, gb.cowbell] },
    { name: 'break', bars: 8, parts: [gb.hat, gb.organ, gb.pad, gb.choir, gb.chops, gb.riser, gb.roll, gb.flutter] },
    { name: 'drop2', bars: 24, drop: true, parts: [gb.crash, gb.kick, gb.clap, gb.snare, gb.hat, gb.ohat, gb.shaker, gb.rim, gb.ride, gb.bass, gb.sub, gb.riff, gb.riffHi, gb.riffLead, gb.cowbell, gb.chops] },
    { name: 'outro', bars: 8, fade: true, parts: [gb.kick, gb.hat, gb.bass, gb.riffSoft] },
  ],
};

// QUATTRO — the same palette a gear up: 140, the riff AND a melody (F minor
// over the A♭ chords — relative keys, the same notes, sadder on top).
const QM = [[0, 'F5', 2], [2, 'Ab5', 2], [4, 'C6', 4], [8, 'Bb5', 2], [10, 'Ab5', 2], [12, 'G5', 4],
  [16, 'F5', 2], [18, 'Ab5', 2], [20, 'Db6', 4], [24, 'C6', 2], [26, 'Bb5', 2], [28, 'Ab5', 4],
  [32, 'Ab5', 2], [34, 'C6', 2], [36, 'Eb6', 4], [40, 'Db6', 2], [42, 'C6', 2], [44, 'Bb5', 4],
  [48, 'C6', 2], [50, 'Bb5', 2], [52, 'G5', 4], [56, 'Bb5', 2], [58, 'C6', 2], [60, 'F5', 4]];
const qt = {
  ...gb,
  riser: X('riser', 'x...............|'.repeat(7) + '................', { vel: 0.4, o: { dur: 60 / 136 * 32 } }),
  mel: N('pluck', QM.map(([st, n, l]) => [st, [midi(n)], l, 0.9]), 64, { tr: DM }),
  melSoft: N('pluck', QM.map(([st, n, l]) => [st, [midi(n)], l, 0.6, { cut: 3000, floor: 900 }]), 64, { tr: DM }),
  melLead: N('lead', QM.map(([st, n, l]) => [st, midi(n), l, 0.6]), 64, { lvl: 0.5, tr: DM }),
  melChords: comp('pluck', AB, '..x...x...x...x.', 65, { len: 1, vel: 0.6, part: { lvl: 0.3, tr: DM } }),
  bassAB: bassline('hbass', AB, [[2, 0, 1, 0.9], [6, 0, 1, 0.9], [10, 0, 1, 0.9], [14, 0, 1, 0.9]], 2, { o: BOUNCE_O, tr: DM }),
  subAB: bassline('sub', AB, [[0, 0, 2, 0.7]], 2, { tr: DM }),
  padAB: comp('strings', AB, 'x...............', 60, { len: 16, vel: 0.5, part: { o: { pad: true }, tr: DM } }),
  choirAB: comp('oo', AB, 'x...............', 60, { len: 16, vel: 0.6, part: { lvl: 0.5, o: { a: 0.3, voices: 3 }, tr: DM } }),
};
const quattro = {
  id: 'quattro', station: 'groupb', name: 'QUATTRO', artist: 'Oo Motorsport Club', bpm: 136, key: 'Dm', swing: 0.12,
  duck: 0.5, duckRelease: 0.18, vinyl: 0.1, drumLevel: 0.95, drumDrive: 1.4,
  mix: { m1: { g: 0.7 }, pluck: { g: 0.68 }, hbass: { g: 0.72 }, sub: { g: 0.52 }, lead: { g: 0.42 }, oochop: { g: 0.55 } },
  sections: [
    { name: 'intro', bars: 8, parts: [qt.hat, qt.shaker, qt.melSoft, qt.padAB, qt.subAB] },
    { name: 'build', bars: 8, parts: [qt.kickIn, qt.clap, qt.hat, qt.ohat, qt.bass, qt.riffBuild, qt.riser, qt.roll, qt.antilag, qt.flutter] },
    { name: 'drop', bars: 24, drop: true, parts: [qt.crash, qt.kick, qt.clap, qt.snare, qt.hat, qt.ohat, qt.shaker, qt.rim, qt.bass, qt.sub, qt.riff, qt.riffHi, qt.cowbell] },
    { name: 'break', bars: 8, parts: [qt.hat, qt.melSoft, qt.padAB, qt.choirAB, qt.chops, qt.riser, qt.roll, qt.flutter] },
    { name: 'build2', bars: 8, parts: [qt.kickIn, qt.clap, qt.hat, qt.ohat, qt.bassAB, qt.mel, qt.padAB, qt.riser, qt.roll, qt.antilag, qt.flutter] },
    { name: 'drop2', bars: 16, drop: true, parts: [qt.crash, qt.kick, qt.clap, qt.snare, qt.hat, qt.ohat, qt.shaker, qt.rim, qt.bassAB, qt.subAB, qt.mel, qt.melLead, qt.melChords, qt.cowbell] },
    { name: 'drop3', bars: 16, drop: true, parts: [qt.kick, qt.clap, qt.snare, qt.hat, qt.ohat, qt.shaker, qt.rim, qt.ride, qt.bass, qt.sub, qt.riff, qt.riffHi, qt.riffLead, qt.cowbell, qt.chops] },
    { name: 'outro', bars: 8, fade: true, parts: [qt.kick, qt.hat, qt.bass, qt.riffSoft] },
  ],
};

// =============================================================================
// ROCKERS · OOZI SQUARE — the band on a Sunday. 118, C major, shuffled 16ths,
// slap bass, Rhodes on the quarters, organ skank on the offbeat, brass carries
// the motif in the chorus, steel drum on the bridge, and the last chorus goes
// up a step like a final lap.
// =============================================================================
const CA = ['Cmaj7', 'Am7', 'Dm7', 'G7'];
const CB = ['Fmaj7', 'G7', 'Em7', 'Am7', 'Fmaj7', 'G7', 'C6', 'C6'];
const CBR = ['Abmaj7', 'Bb7', 'Cmaj7', 'Cmaj7'];
const rk = {
  kick: X('kick', 'x.....x.x.....x.', { o: { f0: 150, f1: 52, dec: 0.3, drive: 1.2, click: 0.4 } }),
  kickB: X('kick', 'x.....x.x...x...', { vel: 1.08, o: { f0: 150, f1: 52, dec: 0.3, drive: 1.2, click: 0.4 } }),
  snare: X('snare', '....x..-....x.-.', { o: { dec: 0.17, tone: 200, snap: 0.8, body: 0.7 } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 1.0 }),
  hat16: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 1.0 }),
  ohat: X('ohat', '..............x.', { vel: 0.6, lvl: 0.3, o: { dec: 0.22 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.55, lvl: 0.4 }),
  shaker: X('shaker', 'o-o-o-o-o-o-o-o-', { vel: 0.7 }),
  congaLo: X('conga', 'x.......x....x..', { vel: 0.8 }),
  congaHi: X('conga', '...o..o.....o.o.', { vel: 0.7, o: { hi: true } }),
  rim: X('rim', '..x...x...x...x.', { vel: 0.5, lvl: 0.2 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  tomFill: X('tom', '................|................|................|........x.x.x.x.', { vel: 0.8, o: { f: 130 } }),
  slapA: bassline('slap', CA, [[0, 0, 3, 0.95], [3, 0, 1, 0.5], [6, 12, 1, 0.8, { pop: true }], [8, 7, 2, 0.8], [10, 0, 2, 0.75], [14, 12, 1, 0.85, { pop: true }]], 2),
  slapB: bassline('slap', CB, [[0, 0, 3, 0.95], [4, 0, 1, 0.5], [6, 12, 1, 0.85, { pop: true }], [8, 7, 2, 0.8], [11, 5, 1, 0.6], [12, 0, 2, 0.8], [14, 12, 1, 0.85, { pop: true }]], 2),
  slapBR: bassline('slap', CBR, [[0, 0, 4, 0.95], [6, 12, 1, 0.8, { pop: true }], [8, 7, 3, 0.8], [12, 0, 2, 0.8]], 2),
  rhodesA: comp('rhodes', CA, 'x...x...x...x...', 60, { len: 3, vel: 0.75 }),
  rhodesB: comp('rhodes', CB, 'x.....x.x.....x.', 60, { len: 3, vel: 0.85 }),
  rhodesBR: comp('rhodes', CBR, 'x.......x.......', 60, { len: 7, vel: 0.8 }),
  rhodesOut: comp('rhodes', ['C6', 'C6', 'Cmaj7', 'Cmaj7'], 'x...............', 60, { len: 16, vel: 0.7 }),
  organA: comp('organ', CA, '..x...x...x...x.', 64, { len: 1, vel: 0.7 }),
  organB: comp('organ', CB, '..x...x...x...x.', 64, { len: 1, vel: 0.8 }),
  guitarA: comp('guitar', CA, '..x...x...x...x.', 64, { len: 1, vel: 0.6, part: { lvl: 0.25, o: { strum: 0.01 } } }),
  guitarB: comp('guitar', CB, 'x.....x...x.....', 64, { len: 3, vel: 0.7, part: { lvl: 0.25, o: { strum: 0.018 } } }),
  // the San Oozi motif (3–5–1–6) as a horn line, call and answer over four bars
  brassCall: line('brass', 32, [[0, 'E4', 2, 0.9], [2, 'G4', 2, 0.9], [4, 'C5', 5, 1.0], [10, 'A4', 2, 0.85], [12, 'G4', 4, 0.9], [24, 'E4', 1, 0.7], [26, 'G4', 1, 0.75], [28, 'A4', 3, 0.85]], { every: 2, phase: 0 }),
  brassAns: line('brass', 32, [[0, 'D5', 2, 0.9], [2, 'C5', 2, 0.85], [4, 'B4', 5, 0.95], [10, 'A4', 2, 0.8], [12, 'G4', 2, 0.85], [14, 'E4', 4, 0.9], [22, 'G4', 2, 0.8], [24, 'A4', 2, 0.85], [26, 'B4', 2, 0.9], [28, 'C5', 4, 1.0]], { every: 2, phase: 1 }),
  brassHarm: line('brass', 32, [[0, 'C4', 2, 0.6], [2, 'E4', 2, 0.6], [4, 'G4', 5, 0.7], [10, 'F4', 2, 0.6], [12, 'E4', 4, 0.65]], { every: 2, phase: 0, lvl: 0.55 }),
  brassHitsA: comp('brass', CA, '..............x.', 60, { len: 2, vel: 0.6, part: { lvl: 0.6 } }),
  steel: arp('steel', CBR, 60, [0, 2, 4, 5, 4, 2, 1, 3], 2, { vel: 0.8, span: 2 }),
  stringsB: comp('strings', CB, 'x...............', 67, { len: 16, vel: 0.5, part: { lvl: 0.5 } }),
  stringsBR: comp('strings', CBR, 'x...............', 67, { len: 16, vel: 0.6 }),
  harpOut: arp('harp', ['C6', 'C6', 'Cmaj7', 'Cmaj7'], 60, [0, 1, 2, 3, 4, 5, 6, 7], 2, { vel: 0.5, span: 2 }),
};
const oozisquare = {
  id: 'oozisquare', station: 'rockers', name: 'OOZI SQUARE', artist: 'The Rockers', bpm: 118, key: 'C', swing: 0.3, human: 0.006,
  duck: 0.08, drumLevel: 0.66, mix: { rhodes: { g: 0.5 }, brass: { g: 0.46 }, slap: { g: 0.4 }, ride: { g: 0.45 } },
  sections: [
    { name: 'intro', bars: 4, parts: [rk.hat, rk.shaker, rk.rhodesA, rk.rim] },
    { name: 'A', bars: 16, parts: [rk.kick, rk.snare, rk.hat, rk.shaker, rk.congaLo, rk.rim, rk.slapA, rk.rhodesA, rk.organA, rk.brassHitsA] },
    { name: 'B', bars: 16, drop: true, parts: [rk.crash, rk.kickB, rk.snare, rk.hat16, rk.ohat, rk.ride, rk.shaker, rk.congaLo, rk.congaHi, rk.slapB, rk.rhodesB, rk.organB, rk.guitarB, rk.brassCall, rk.brassAns, rk.brassHarm, rk.stringsB] },
    { name: 'A2', bars: 8, parts: [rk.kick, rk.snare, rk.hat, rk.shaker, rk.congaLo, rk.congaHi, rk.slapA, rk.rhodesA, rk.organA, rk.guitarA, rk.tomFill] },
    { name: 'bridge', bars: 8, parts: [rk.kick, rk.snare, rk.hat, rk.shaker, rk.congaLo, rk.slapBR, rk.rhodesBR, rk.steel, rk.stringsBR, rk.tomFill] },
    { name: 'B2', bars: 16, drop: true, parts: [rk.crash, rk.kickB, rk.snare, rk.hat16, rk.ohat, rk.ride, rk.shaker, rk.congaLo, rk.congaHi, ...trp([rk.slapB, rk.rhodesB, rk.organB, rk.guitarB, rk.brassCall, rk.brassAns, rk.brassHarm, rk.stringsB], 2)] },
    { name: 'outro', bars: 4, fade: true, parts: [rk.shaker, ...trp([rk.rhodesOut, rk.harpOut], 2)] },
  ],
};

// =============================================================================
// JUMVAS · ASCEND — lo-fi indie that leaves the ground. 92, D major, drums that
// hit too hard for how soft everything else is, jangle guitar arpeggios through
// tape, and in the middle the fountain: a harp climbing over a bass stepping
// down (IV6 iii ii6 I6). Then the whole thing lifts a step for the ascent.
// =============================================================================
const DV = ['D', 'Bm', 'G', 'A'];
const DC = ['Dadd9', 'Bm7', 'Gmaj7', 'Asus4'];
const DF = ['G6', 'F#m7', 'Em6', 'D6'];
const jv = {
  kick: X('kick', 'x..x......x.....', { vel: 0.85, o: { f0: 150, f1: 55, dec: 0.32, drive: 2.0, click: 0.4 } }),
  kickHalf: X('kick', 'x...............', { vel: 0.75, o: { f0: 150, f1: 48, dec: 0.45, drive: 2.6, click: 0.35 } }),
  kickBig: X('kick', 'x..x......x...x.', { vel: 1.0, o: { f0: 150, f1: 52, dec: 0.36, drive: 2.4, click: 0.45 } }),
  snare: X('snare', '....x.......x...', { vel: 0.9, o: { dec: 0.26, tone: 175, snap: 1.05, body: 0.8 } }),
  snareHalf: X('snare', '........x.......', { vel: 0.8, o: { dec: 0.3, tone: 170, snap: 1.0, body: 0.8, gate: true } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.9, o: { dec: 0.05, hp: 6000 } }),
  hatG: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.7, lvl: 0.3, o: { dec: 0.05, hp: 6000 } }),
  ohat: X('ohat', '..............x.', { vel: 0.5, lvl: 0.35, o: { dec: 0.25 } }),
  rim: X('rim', '.......x......x.', { vel: 0.45, lvl: 0.2 }),
  shaker: X('shaker', '..x...x...x...x.', { vel: 0.55, lvl: 0.4 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.55 }),
  sub: bassline('sub', DV, [[0, 0, 6, 0.6], [10, 0, 4, 0.5, {}]], 2),
  subC: bassline('sub', DC, [[0, 0, 6, 0.75], [8, 0, 2, 0.5], [10, 0, 4, 0.65]], 2),
  subF: bassline('sub', DF, [[0, 0, 16, 0.5]], 2),
  guitarV: arp('guitar', DV, 50, [0, 1, 2, 3, 4, 3, 2, 1], 2, { vel: 0.7, span: 2 }),
  guitarC: comp('guitar', DC, 'x.....x.x.....x.', 52, { len: 4, vel: 0.85, extra: 2, part: { o: { strum: 0.022 } } }),
  guitarF: comp('guitar', DF, 'x.......x.......', 52, { len: 6, vel: 0.6, extra: 1, part: { lvl: 0.3, o: { strum: 0.03 } } }),
  harpIntro: arp('harp', DV, 62, [0, 1, 2, 3, 4, 5, 6, 7], 2, { vel: 0.55, span: 2 }),
  harpF: arp('harp', DF, 55, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9], 1, { vel: 0.85, span: 3 }),
  harpA: arp('harp', DC, 62, [0, 2, 4, 6, 4, 2, 0, 2], 2, { vel: 0.5, span: 2, part: { lvl: 0.4 } }),
  // the San Oozi motif (3–5–1–6) on bells, once every two bars
  bells: line('bell', 32, [[0, 'F#5', 4, 0.8], [4, 'A5', 4, 0.8], [8, 'D6', 6, 0.9], [14, 'B5', 2, 0.7], [16, 'A5', 8, 0.75]], { lvl: 0.45 }),
  bellsAsc: line('bell', 32, [[0, 'F#5', 4, 0.9], [4, 'A5', 4, 0.9], [8, 'D6', 6, 1.0], [14, 'B5', 2, 0.8], [16, 'A5', 4, 0.8], [20, 'B5', 4, 0.8], [24, 'D6', 8, 0.9]]),
  choirC: comp('oo', DC, 'x...............', 57, { len: 16, vel: 0.5, part: { lvl: 0.45, o: { a: 0.35, voices: 3 } } }),
  choirF: comp('oo', DF, 'x...............', 57, { len: 16, vel: 0.55, part: { o: { a: 0.4, voices: 4 } } }),
  choirLead: line('oo', 64, [[0, 'D5', 8, 0.6], [8, 'E5', 8, 0.6], [16, 'F#5', 16, 0.7], [32, 'G5', 8, 0.6], [40, 'A5', 24, 0.75]], { lvl: 0.55, o: { a: 0.5, voices: 3 } }),
  padC: comp('strings', DC, 'x...............', 62, { len: 16, vel: 0.45, part: { lvl: 0.6, o: { pad: true } } }),
  padF: comp('strings', DF, 'x...............', 62, { len: 16, vel: 0.5, part: { o: { pad: true } } }),
  rhodesV: comp('rhodes', DV, '..x.......x.....', 57, { len: 2, vel: 0.5, part: { lvl: 0.35 } }),
};
const ascend = {
  id: 'ascend', station: 'jumvas', name: 'ASCEND', artist: 'Jumvas', bpm: 92, key: 'D', swing: 0.2, human: 0.004,
  duck: 0.3, duckRelease: 0.2, vinyl: 0.4, tape: 0.7, drumLevel: 0.8,
  mix: { guitar: { g: 1.05, lp: 4600 }, harp: { g: 0.95 }, bell: { g: 0.7 }, oo: { g: 0.55 }, rhodes: { g: 0.6 } },
  sections: [
    { name: 'intro', bars: 4, parts: [jv.harpIntro, jv.shaker] },
    { name: 'verse', bars: 8, parts: [jv.kick, jv.snare, jv.hat, jv.hatG, jv.rim, jv.sub, jv.guitarV, jv.rhodesV] },
    { name: 'chorus', bars: 8, drop: true, parts: [jv.crash, jv.kickBig, jv.snare, jv.hat, jv.ohat, jv.shaker, jv.subC, jv.guitarC, jv.bells, jv.choirC, jv.harpA] },
    { name: 'fountain', bars: 8, parts: [jv.kickHalf, jv.snareHalf, jv.subF, jv.harpF, jv.guitarF, jv.choirF, jv.padF] },
    { name: 'verse2', bars: 8, parts: [jv.kick, jv.snare, jv.hat, jv.hatG, jv.rim, jv.sub, jv.guitarV, jv.rhodesV, jv.harpA] },
    { name: 'chorus2', bars: 8, hold: 'ascend', holdMax: 2, parts: [jv.kickBig, jv.snare, jv.hat, jv.ohat, jv.shaker, jv.subC, jv.guitarC, jv.bells, jv.choirC, jv.harpA, jv.padC] },
    { name: 'ascent', bars: 16, drop: true, parts: [jv.crash, jv.kickBig, jv.snare, jv.hat, jv.hatG, jv.ohat, jv.shaker, ...trp([jv.subC, jv.guitarC, jv.bellsAsc, jv.choirC, jv.choirLead, jv.harpA, jv.padC], 2)] },
    { name: 'outro', bars: 4, fade: true, parts: [...trp([jv.harpIntro], 2)] },
  ],
};

export const SONGS = { quattro, antilag, oozisquare, ascend };
export const STATIONS = [
  { id: 'groupb', name: 'GROUP B', tag: 'hardtekk · rally house', color: '#ff4d2e', songs: ['quattro', 'antilag'] },
  { id: 'rockers', name: 'ROCKERS', tag: 'the band at the meet', color: '#ffd23f', songs: ['oozisquare'] },
  { id: 'jumvas', name: 'JUMVAS', tag: 'lo-fi that leaves the ground', color: '#8ad7ff', songs: ['ascend'] },
];
