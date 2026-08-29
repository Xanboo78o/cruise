// materials.js — the look Claude's surface library.
//
// CITY-PLAN.md: "the look Claude owns materials, textures, lighting,
// sky/fog." This is that. Geometry stays the world Claude's; nothing in here
// builds a vertex.
//
// TRIPLANAR, not UV. None of the world geometry has a uv attribute — it is
// position + vertex colour — and the city is mid-rebuild, so any UV I relied on
// today would be gone tomorrow. Triplanar projects the texture from the three
// world axes and blends by the surface normal: it needs no UVs at all, it tiles
// in real metres, and it survives the geometry being rewritten underneath it.
// When the road slabs land with proper metre UVs, `uv: true` on that surface
// switches it over and everything else carries on.
//
// Textures are ambientCG CC0 — scanned from real materials, per Adam's
// "stock, not generated" rule. 512px, because the game renders at 360p behind
// the dashcam shader and anything larger is bytes nobody sees.

import * as THREE from 'three';

const DIR = './assets/textures/';
const loader = new THREE.TextureLoader();
const cache = new Map();
let anisotropy = 4;

export function setAnisotropy(n) { anisotropy = n; }

// Every material handed out, so a look can reach back and change all of them.
const ALL = [];
let flat = false;

// art of rally has no surface noise at all — every face is a flat colour and the
// shape does the work. Dropping the maps leaves tint x vertex colour, which IS
// that look, and it's reversible, so the two are one keypress apart.
const NOOP = () => {};
export function setFlat(on) {
  if (on === flat) return;
  flat = on;
  for (const m of ALL) applyFlat_(m, on);
  for (const m of ROADS) applyRoadFlat_(m, on);
}
function applyFlat_(m, on) {
  // the terrain facets in flat mode: art of rally's ground is low-poly on purpose
  if (m.userData.terrain) { m.flatShading = on; m.needsUpdate = true; }
  if (on) {
    m.userData.maps = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap };
    m.map = m.normalMap = m.roughnessMap = null;
    m.roughness = 1; m.metalness = 0;
    // and the projection shader has to go with them: it samples roughnessMap
    // and normalMap by name, and with the maps gone those uniforms do not
    // exist, so it fails to compile and the material renders black
    m.onBeforeCompile = NOOP;
  } else {
    if (m.userData.maps) Object.assign(m, m.userData.maps);
    if (m.userData.pbr) { m.roughness = m.userData.pbr.r; m.metalness = m.userData.pbr.m; }
    m.onBeforeCompile = m.userData.obc || NOOP;
  }
  m.needsUpdate = true;
}
export const isFlat = () => flat;
// the road keeps its own shader in flat mode (the markings live there): it just stops reading textures
const ROADS = [];
function applyRoadFlat_(m, on) { m.userData.tri.uFlat.value = on ? 1 : 0; }
let lines = 1;
export function setLines(k) { lines = k; for (const m of ROADS) m.userData.tri.uLines.value = k; }
function track(m) {
  m.userData.pbr = { r: m.roughness, m: m.metalness };
  m.userData.obc = m.onBeforeCompile;
  ALL.push(m);
  if (flat) applyFlat_(m, true);
  return m;
}

// PAINTED, not scanned: the KART look wants clean surfaces. A scan is photo
// noise at every frequency; Mario Kart's textures are soft, saturated, and only
// carry the big shapes. So when stylize is on, every colour map is downsampled,
// blurred, saturated a touch; a normal map is halved toward flat. Decided once
// at load (the look at start-up) — the cache key carries it.
let stylize = false;
export function setStylize(on) { stylize = !!on; }
function paint(img, kind) {
  const N = kind === 'color' ? 256 : 128;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const half = document.createElement('canvas'); half.width = half.height = N / 2;
  const gh = half.getContext('2d'); gh.imageSmoothingEnabled = true; gh.imageSmoothingQuality = 'high';
  gh.drawImage(img, 0, 0, N / 2, N / 2);                     // down to a quarter of the pixels: the noise goes
  if (kind === 'color') g.filter = 'saturate(1.22) contrast(0.9) brightness(1.06)';
  g.drawImage(half, 0, 0, N, N);                              // back up, soft
  g.filter = 'none';
  if (kind === 'normal') { g.globalAlpha = 0.55; g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, N, N); g.globalAlpha = 1; }
  return c;
}
function tex(name, kind, srgb) {
  const key = name + '/' + kind + (stylize ? '/paint' : '');
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(DIR + name + '/' + kind + '.jpg', stylize && kind !== 'rough' ? tt => { tt.image = paint(tt.image, kind); tt.needsUpdate = true; } : undefined);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  // triplanar samples the map itself, so the colour-space conversion is done in
  // my shader, not three's chunk — keep the data linear here and decode there
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, t);
  return t;
}

// tile = metres one texture repeat covers in the world.
// tint multiplies the map, so one scanned asphalt can be a dozen shades of road.
export const SURFACES = {
  road:      { tex: 'asphalt',      tile: 6,   rough: 0.92, tint: 0xb8b8b8 },
  roadOld:   { tex: 'asphaltold',   tile: 7,   rough: 0.95, tint: 0xa8a8a8 },
  kerb:      { tex: 'concrete',     tile: 2.5, rough: 0.88, tint: 0xd8d5cc },
  pavement:  { tex: 'pavement',     tile: 3,   rough: 0.9,  tint: 0xc4c2ba },
  concrete:  { tex: 'concreterough',tile: 4,   rough: 0.9,  tint: 0xbdbab2 },
  grass:     { tex: 'grass',        tile: 3.5, rough: 1.0,  tint: 0x8fa06a },
  dirt:      { tex: 'grounddry',    tile: 4,   rough: 1.0,  tint: 0xb0a184 },
  gravel:    { tex: 'gravel',       tile: 2.5, rough: 1.0,  tint: 0xa8a49c },
  sand:      { tex: 'sand',         tile: 5,   rough: 1.0,  tint: 0xe0cfa8 },
  canyon:    { tex: 'rock',         tile: 12,  rough: 0.95, tint: 0xc98d5e },  // red sandstone
  cliff:     { tex: 'rockgrey',     tile: 10,  rough: 0.95, tint: 0xa9a49c },
  brick:     { tex: 'bricks',       tile: 3,   rough: 0.95, tint: 0xb08876 },
  timber:    { tex: 'planks',       tile: 2.5, rough: 0.9,  tint: 0xa08c72 },
  metal:     { tex: 'metal',        tile: 3,   rough: 0.55, metal: 0.7, tint: 0xb9bec4 },
  metalRust: { tex: 'metalrust',    tile: 3,   rough: 0.8,  metal: 0.4, tint: 0xb08a70 },
  rubber:    { tex: 'rubber',       tile: 1.2, rough: 0.95, tint: 0x5a5a5e },
  roof:      { tex: 'roof',         tile: 3,   rough: 0.9,  tint: 0x9a9a9e },
};

// ------------------------------------------------- projection, by cost
// Triplanar is 3 texture reads per map. On a wall that is the price of not
// having UVs; on a full-screen terrain with colour + normal + roughness it is
// 9-15 reads a pixel and it took the world from renderable to not. So the
// projection is chosen per surface, cheapest that is still correct:
//
//   planar    1 read  — anything that lies flat: road, pavement, ground
//   biplanar  2 reads — terrain: flat from above, sides from whichever of X/Z
//                       the face points along. Cliffs read right, no smear.
//   triplanar 3 reads — walls, rocks, props: genuinely arbitrary normals
const TRI_PARS = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNrm;
uniform float uTile;
uniform float uNrmAmt;
vec2 sideUv(vec3 p, vec3 n) { return abs(n.x) > abs(n.z) ? p.zy : p.xy; }
vec4 triSample(sampler2D s, vec3 p, vec3 b, float sc) {
  return texture2D(s, p.zy * sc) * b.x
       + texture2D(s, p.xz * sc) * b.y
       + texture2D(s, p.xy * sc) * b.z;
}
vec3 triBlend(vec3 n) {
  vec3 b = pow(abs(n), vec3(4.0));
  return b / max(b.x + b.y + b.z, 1e-4);
}
`;

// which projection each surface wants
const MODE = {
  road: 'planar', roadOld: 'planar', pavement: 'planar', kerb: 'planar',
  grass: 'planar', dirt: 'planar', gravel: 'planar', sand: 'planar',
};

export function surface(name, extra = {}) {
  const s = SURFACES[name];
  if (!s) throw new Error('no surface ' + name);
  const useUv = !!s.uv;
  const m = new THREE.MeshStandardMaterial({
    color: extra.tint ?? s.tint ?? 0xffffff,
    roughness: s.rough ?? 0.9,
    metalness: s.metal ?? 0.0,
    vertexColors: !!extra.vertexColors,
    side: extra.side ?? THREE.FrontSide,
    map: tex(s.tex, 'color', useUv),
    normalMap: tex(s.tex, 'normal', false),
    roughnessMap: tex(s.tex, 'rough', false),
  });
  const tile = extra.tile ?? s.tile;
  if (useUv) {                                   // metre UVs, once the slabs land
    for (const t of [m.map, m.normalMap, m.roughnessMap]) t.repeat.set(1 / tile, 1 / tile);
    return m;
  }
  const mode = extra.mode ?? MODE[name] ?? 'triplanar';
  const P = mode === 'planar';
  const rd = (samp) => P ? `texture2D(${samp}, vWPos.xz * uTile)`
                         : `triSample(${samp}, vWPos, triB, uTile)`;
  m.userData.tri = { uTile: { value: 1 / tile }, uNrmAmt: { value: extra.normalScale ?? 1 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.tri);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n' +
        'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        'vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TRI_PARS)
      // colour: decode sRGB here, because three's map_fragment chunk is the very
      // thing being replaced and its conversion goes with it
      .replace('#include <map_fragment>', `
        vec3 triB = triBlend(vWNrm);
        diffuseColor *= vec4(pow(${rd('map')}.rgb, vec3(2.2)), 1.0);
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * ${rd('roughnessMap')}.g;
      `)
      // whiteout blend: swizzle each plane's tangent normal into world space and
      // add, rather than averaging, or every slope goes flat
      .replace('#include <normal_fragment_maps>', P ? `
        {
          vec3 tn = texture2D(normalMap, vWPos.xz * uTile).xyz * 2.0 - 1.0;
          vec3 wn = normalize(vec3(vWNrm.x + tn.x, vWNrm.y, vWNrm.z + tn.y));
          normal = normalize(mix(normal, wn, uNrmAmt));
        }
      ` : `
        {
          vec3 nx = texture2D(normalMap, vWPos.zy * uTile).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(normalMap, vWPos.xz * uTile).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(normalMap, vWPos.xy * uTile).xyz * 2.0 - 1.0;
          nx = vec3(nx.xy + vWNrm.zy, abs(nx.z) * vWNrm.x);
          ny = vec3(ny.xy + vWNrm.xz, abs(ny.z) * vWNrm.y);
          nz = vec3(nz.xy + vWNrm.xy, abs(nz.z) * vWNrm.z);
          vec3 wn = normalize(nx.zyx * triB.x + ny.xzy * triB.y + nz.xyz * triB.z);
          normal = normalize(mix(normal, wn, uNrmAmt));
        }
      `);
  };
  // three keys its program cache on this; without it every surface shares one
  m.customProgramCacheKey = () => 'tri' + name + mode + (extra.vertexColors ? 'vc' : '') + (flat ? 'f' : '');
  return track(m);
}

// Buildings ask for the same handful of surfaces thousands of times. surface()
// builds a new material (and a new shader program) every call, so anything in a
// loop must go through here instead.
const shared_ = new Map();
export function shared(name, extra) {
  const key = name + (extra ? JSON.stringify(extra) : '');
  if (!shared_.has(key)) shared_.set(key, surface(name, extra || {}));
  return shared_.get(key);
}

// Terrain wants two surfaces, not one: flat ground where it lies down, rock
// where it stands up. The world Claude's vertex colours already carry the HUE
// (grass, canyon red, sand, snow), so these only have to supply detail — but a
// cliff with dirt smeared down it reads as a bug, and a canyon is most of this
// map. Blend is by world normal, so it costs no extra geometry and no UVs.
export function terrainSurface(flatName, steepName, extra = {}) {
  const f = SURFACES[flatName], st = SURFACES[steepName];
  const m = new THREE.MeshStandardMaterial({
    color: extra.tint ?? 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: extra.vertexColors !== false,
    flatShading: flat,
    map: tex(f.tex, 'color', false),
    roughnessMap: tex(f.tex, 'rough', false),
    // no normalMap on purpose: the terrain is the whole screen, and a normal
    // map here costs more reads than everything else in the frame put together
    // for detail that is gone by the time the dashcam shader has had it
  });
  const u = {
    uTile: { value: 1 / (extra.flatTile ?? f.tile) },
    uNrmAmt: { value: extra.normalScale ?? 0.7 },
    uTile2: { value: 1 / (extra.steepTile ?? st.tile) },
    uMap2: { value: tex(st.tex, 'color', false) },
    uRough2: { value: tex(st.tex, 'rough', false) },
    uSteep: { value: new THREE.Vector2(extra.steepFrom ?? 0.62, extra.steepTo ?? 0.88) },
  };
  m.userData.tri = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n' +
        'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        'vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TRI_PARS +
        'uniform sampler2D uMap2;\nuniform sampler2D uRough2;\nuniform float uTile2;\nuniform vec2 uSteep;\n')
      // biplanar: flat from above, steep from whichever of X/Z the face points
      // along. Two reads instead of six, and a cliff still reads as rock.
      .replace('#include <map_fragment>', `
        float steep = 1.0 - smoothstep(uSteep.x, uSteep.y, abs(vWNrm.y));
        vec2 uvFlat = vWPos.xz * uTile;
        vec2 uvSide = sideUv(vWPos, vWNrm) * uTile2;
        vec3 triC = mix(texture2D(map, uvFlat).rgb, texture2D(uMap2, uvSide).rgb, steep);
        diffuseColor *= vec4(pow(triC, vec3(2.2)), 1.0);
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * mix(
          texture2D(roughnessMap, uvFlat).g,
          texture2D(uRough2,      uvSide).g, steep);
      `);
  };
  m.customProgramCacheKey = () => 'terr' + flatName + steepName + (flat ? 'f' : '');
  m.userData.terrain = true;
  return track(m);
}

// ------------------------------------------------------------------ the road
// One material for the whole road mesh (build.js): deck, kerbs, skirts, piers,
// shoulders. Each vertex carries aRoad = (lat m from the centreline, metres
// along, half width, kind) and the shader decides what it is looking at:
//   kind 0 paved  1 gravel  2 sand  3 pier planks  4 kerb  5 concrete  6 ground
// Paved decks with a half width get their markings HERE, in the fragment, from
// lat/along — no extra geometry, nothing to z-fight, crisp at any distance
// (fwidth anti-aliases the edges). A half width of 0 means "no lines" (junction
// plates). The shoulder (kind 6) draws the SAME ground as the terrain mesh, so
// the cut and the embankment beside a road match the land they meet instead of
// wearing asphalt.
const ROAD_PARS = /* glsl */`
varying vec4 vRoad;
uniform sampler2D uAsphaltMap, uAsphaltRough, uGround, uCliff, uGravel, uSand, uPlank, uConcrete;
uniform float uTileGround, uTileCliff, uTileGravel, uTileSand, uTilePlank, uTileConcrete;
uniform vec3 uAsphalt, uLine, uLineY, uKerb, uConcreteTint;
uniform float uLines, uFlat;
uniform vec4 uFlatGain;
float band(float u, float a, float b, float w) { return smoothstep(a - w, a + w, u) * (1.0 - smoothstep(b - w, b + w, u)); }
`;
export function roadSurface(opts = {}) {
  const pbr = opts.pbr !== false, noise = opts.noise || null;
  const M = pbr ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial;
  // every surface is a plain uniform sampler (no `map` slot: nothing here uses three's uv/map plumbing).
  // GAINS are linear multipliers applied AFTER the sRGB decode — a Color would be gamma'd twice
  // and the asphalt went black for an hour that way
  const m = new M({ vertexColors: true, side: THREE.FrontSide, ...(pbr ? { roughness: 0.92, metalness: 0 } : {}) });
  const G = (r, g, b) => new THREE.Vector3(r, g, b);
  const gain = pbr ? { asphalt: G(1.55, 1.6, 1.8), kerb: G(1.5, 1.5, 1.55), concrete: G(1.7, 1.7, 1.7) }
                   : { asphalt: G(0.17, 0.175, 0.2), kerb: G(0.6, 0.6, 0.62), concrete: G(0.7, 0.7, 0.7) };
  const g = n => pbr ? tex(SURFACES[n].tex, 'color', false) : noise;
  const u = {
    uAsphaltMap: { value: g('road') }, uAsphaltRough: { value: pbr ? tex('asphalt', 'rough', false) : noise },
    uGround: { value: g('dirt') }, uCliff: { value: g('cliff') }, uGravel: { value: g('gravel') }, uSand: { value: g('sand') }, uPlank: { value: g('timber') }, uConcrete: { value: g('concrete') },
    uTileGround: { value: 1 / SURFACES.dirt.tile }, uTileCliff: { value: 1 / SURFACES.cliff.tile }, uTileGravel: { value: 1 / SURFACES.gravel.tile }, uTileSand: { value: 1 / SURFACES.sand.tile },
    uTilePlank: { value: 1 / SURFACES.timber.tile }, uTileConcrete: { value: 1 / SURFACES.concrete.tile }, uTile: { value: 1 / SURFACES.road.tile },
    uAsphalt: { value: gain.asphalt }, uLine: { value: new THREE.Color(0xf2efe6) }, uLineY: { value: new THREE.Color(0xf0c24a) },
    uKerb: { value: gain.kerb }, uConcreteTint: { value: gain.concrete }, uLines: { value: lines },
    uNrmAmt: { value: 0.5 }, uFlat: { value: flat ? 1 : 0 },
    // flat mode: no texture, the vertex tone × a per-kind level (art of rally tarmac is a mid grey)
    uFlatGain: { value: new THREE.Vector4(0.22, 1.0, 1.0, 0.7) },    // asphalt, gravel/sand/planks, ground, kerb+concrete
  };
  m.userData.tri = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRoad = aRoad;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform float uTile;\nuniform float uNrmAmt;\nvec2 sideUv(vec3 p, vec3 n) { return abs(n.x) > abs(n.z) ? p.zy : p.xy; }\n' + ROAD_PARS)
      .replace('#include <map_fragment>', `
        int kind = int(vRoad.w + 0.5);
        vec2 uvP = vWPos.xz;
        vec3 base, gainK = vec3(1.0);
        if (uFlat > 0.5) { base = vec3(1.0); gainK = vec3(kind == 0 ? uFlatGain.x : (kind == 4 || kind == 5) ? uFlatGain.w : kind == 6 ? uFlatGain.z : uFlatGain.y); }
        else if (kind == 0) { base = texture2D(uAsphaltMap, uvP * uTile).rgb; gainK = uAsphalt; }
        else if (kind == 1) base = texture2D(uGravel, uvP * uTileGravel).rgb;
        else if (kind == 2) base = texture2D(uSand, uvP * uTileSand).rgb;
        else if (kind == 3) base = texture2D(uPlank, uvP * uTilePlank).rgb;
        else if (kind == 4) { base = texture2D(uConcrete, uvP * uTileConcrete).rgb; gainK = uKerb; }
        else if (kind == 5) { base = texture2D(uConcrete, sideUv(vWPos, vWNrm) * uTileConcrete).rgb; gainK = uConcreteTint; }
        else {
          // the shoulder: flat ground from above, rock where the cut wall stands up — the terrain's own rule
          float steep = 1.0 - smoothstep(0.62, 0.88, abs(vWNrm.y));
          base = mix(texture2D(uGround, uvP * uTileGround).rgb, texture2D(uCliff, sideUv(vWPos, vWNrm) * uTileCliff).rgb, steep);
        }
        diffuseColor *= vec4(pow(base, vec3(2.2)) * gainK, 1.0);   // decode the scan, THEN the gain
      `)
      // markings go on AFTER the vertex colour, or the asphalt tone would darken them
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        if (kind == 0 && vRoad.z > 0.5 && uLines > 0.01) {
          float hw = vRoad.z, u = abs(vRoad.x) / hw, w = fwidth(u) * 0.9 + 0.002;
          float lw = 0.16 / hw;                                          // a 16 cm line, in u
          float edge = band(u, 0.90 - lw, 0.90, w);                      // solid edge lines
          float wide = step(11.5, hw);                                   // 4 lanes: boulevards, expressways
          float dash = step(fract(vRoad.y / 12.0), 0.5);                 // 6 m on, 6 m off
          float dashS = step(fract(vRoad.y / 9.0), 0.55);
          float centreY = mix(band(u, 0.0, lw * 0.9, w) * dashS,          // 2 lanes: a dashed yellow centre
                              band(u, lw * 0.35, lw * 1.35, w), wide);   // 4 lanes: a double yellow
          float lane = wide * band(u, 0.5 - lw * 0.5, 0.5 + lw * 0.5, w) * dash;
          float white = max(edge, lane), yellow = centreY * (1.0 - white);
          diffuseColor.rgb = mix(diffuseColor.rgb, uLine, white * 0.92 * uLines);
          diffuseColor.rgb = mix(diffuseColor.rgb, uLineY, yellow * 0.9 * uLines);
        }
      `)
      .replace('#include <roughnessmap_fragment>', pbr ? `
        float roughnessFactor = roughness;
        if (kind == 0 && uFlat < 0.5) roughnessFactor *= texture2D(uAsphaltRough, uvP * uTile).g;
      ` : '#include <roughnessmap_fragment>');
  };
  m.customProgramCacheKey = () => 'road' + (pbr ? 'p' : 'l');
  ROADS.push(m);
  return m;
}

// A tiny environment so metal and wet asphalt have something to reflect. Three
// lights and no envMap makes every metal read as black plastic.
export function skyEnvironment(renderer, top = 0x9dc3f0, horizon = 0xdfe6ee, ground = 0x4a4238) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  grad.addColorStop(0, hex(top));
  grad.addColorStop(0.5, hex(horizon));
  grad.addColorStop(0.52, hex(ground));
  grad.addColorStop(1, hex(ground));
  g.fillStyle = grad; g.fillRect(0, 0, 64, 32);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(t).texture;
  pmrem.dispose(); t.dispose();
  return env;
}
