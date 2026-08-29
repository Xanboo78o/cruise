// looks.js — whole visual treatments, switchable while you drive.
//
//   1  REAL   — scanned textures, PBR, long view. What the texture pass built.
//   2  RALLY  — art of rally.
//   3  FLAT   — textures off, REAL's lighting. The control, so it's obvious
//               which half of RALLY is doing the work.
//
// art of rally is not "the same scene with a filter on". It is a different set
// of decisions, and copying it means copying the decisions:
//
//   * No surface detail. Every face is one flat colour and the SHAPE carries
//     the image. So the maps come off entirely — not turned down, off.
//   * No specular. Nothing in that game looks wet or shiny; it's all matte
//     paper. Environment reflections go to zero.
//   * The haze is the whole trick. Distance is a wall of colour and the hills
//     dissolve into the sky about a third of the way to the horizon. Our fog
//     sits at 400-2400 m, which is "clear day"; this wants 90-750.
//   * Soft, high, even light. Not the hard low sun of a photo — a big soft key
//     with a lot of coloured bounce, so shadows are gentle and everything keeps
//     its colour instead of going black.
//   * Saturated, harmonious palette, and the fog colour IS the sky colour, so
//     ground and air are the same family.
//   * The camera sits back and above. It's a poised game, not a scary one —
//     which is the opposite of the speed feel, so RALLY turns that down too.

import { setFlat, setLines } from './materials.js';

// Adam, 2026-08-29 (later): "undo the full art of rally change. just name the
// filter rally and let the user choose" — KART is the default again, RALLY is
// one of four, and you pick with 1-4 while driving (the pick is remembered).
export const LOOKS = ['kart', 'rally', 'real', 'flat'];
export const LOOK_LABEL = { kart: 'KART', rally: 'RALLY', real: 'REAL', flat: 'FLAT' };

// KART — the default. Mario Kart is stylised REALISM: the light is real (a warm
// sun, a blue sky fill, soft shadows, bloom on what's bright) and the surfaces
// are clean — painted, not scanned. Saturated but harmonious; the sky and the
// far haze are one family; the view goes a long way and only softens at the
// very back. Night is readable, not black.
export const KART_SKIES = {
  noon:   { top: 0x2f7fe0, bot: 0xbfe2f8, sun: 0xfff4dc, fog: 0xd3e8f6, fogNear: 700, fogFar: 3600,
            hemiSky: 0xbcd8ff, hemiGround: 0x8c8262, dir: 0xfff0d6, dirI: 1.2, amb: 0.8, dirPos: [0.45, 0.8, 0.35], clouds: 0.45 },
  sunset: { top: 0x352f6e, bot: 0xff9a5a, sun: 0xffc98a, fog: 0xf4b48a, fogNear: 500, fogFar: 2800,
            hemiSky: 0xffb890, hemiGround: 0x5a4a3c, dir: 0xffc48a, dirI: 1.25, amb: 0.58, dirPos: [-0.5, 0.2, -1], clouds: 0.5 },
  dawn:   { top: 0x2a4f8c, bot: 0xf5cbb8, sun: 0xfff0d6, fog: 0xdcdde8, fogNear: 500, fogFar: 3000,
            hemiSky: 0xc4d6f4, hemiGround: 0x5e5848, dir: 0xffe6cc, dirI: 1.1, amb: 0.62, dirPos: [0.8, 0.22, 0.4], clouds: 0.55 },
  night:  { top: 0x070c24, bot: 0x1c2c56, sun: 0xa8bce8, fog: 0x101a36, fogNear: 220, fogFar: 1500,
            hemiSky: 0x3a4c84, hemiGround: 0x141828, dir: 0xb0c4f0, dirI: 0.5, amb: 0.5, dirPos: [-0.4, 0.7, 0.6], clouds: 0.3 },
};

// same shape as SKIES in world.js, so it can be swapped straight in
// RALLY — art of rally as a filter. Pastel, harmonious, the fog IS the sky at
// the horizon, a low warm sun with long soft shadows, the ground faceted, no
// texture anywhere — the shapes do the work. The haze starts close (a few
// hundred metres, not a few kilometres) so the hills stack up in bands.
export const RALLY_SKIES = {
  noon:   { top: 0x3a8fc8, bot: 0xc9e9ec, sun: 0xfff3dc, fog: 0xbfe2e6, fogNear: 160, fogFar: 1500,
            hemiSky: 0xb8e0ea, hemiGround: 0x8c8a5a, dir: 0xfff0d0, dirI: 1.0, amb: 1.0, dirPos: [0.55, 0.55, 0.35], clouds: 0.32 },
  sunset: { top: 0x4a3a7e, bot: 0xffa070, sun: 0xffd6a0, fog: 0xf5a67c, fogNear: 120, fogFar: 1200,
            hemiSky: 0xffc2a0, hemiGround: 0x7a5848, dir: 0xffcf9e, dirI: 1.0, amb: 0.95, dirPos: [-0.55, 0.32, -0.9], clouds: 0.4 },
  dawn:   { top: 0x3a5f96, bot: 0xf8d2c8, sun: 0xfff0d8, fog: 0xeccac4, fogNear: 130, fogFar: 1300,
            hemiSky: 0xdcdff2, hemiGround: 0x7a7260, dir: 0xffe6d2, dirI: 0.95, amb: 0.95, dirPos: [0.75, 0.35, 0.5], clouds: 0.45 },
  night:  { top: 0x0e1638, bot: 0x2e3c78, sun: 0xb0c2ee, fog: 0x232e5c, fogNear: 100, fogFar: 900,
            hemiSky: 0x5670b0, hemiGround: 0x1c2038, dir: 0xb8caf4, dirI: 0.5, amb: 0.62, dirPos: [-0.4, 0.6, 0.6], clouds: 0.25 },
};

// per-look renderer + scene settings
const CFG = {
  kart:  { flat: false, env: 0.5,  exposure: 1.0,  ambMul: 1,    sunMul: 1,    speed: 0.85, camUp: 0.3, camBack: 0.5, shadowRadius: 3, stylize: true,
           dofOn: true,
           dof: { dofStart: 140, dofEnd: 1800, dofAmount: 3.0, dofCurve: 1.0, dofMax: 22, dofBokeh: 1.6 },
           post: { bloom: 0.3, bloomThresh: 1.1, saturation: 1.14, contrast: 1.05, lift: 0.0, vignette: 0.2 } },
  real:  { flat: false, env: 0.4,  exposure: 0.92, ambMul: 1,    sunMul: 1,    speed: 1,    camUp: 0,   camBack: 0,   shadowRadius: 1,
           dof: { dofStart: 35, dofEnd: 420, dofAmount: 5.5, dofCurve: 1.0, dofMax: 40, dofBokeh: 3.2 },
           post: { bloom: 0.18, bloomThresh: 1.3, saturation: 1.0, contrast: 1.0, lift: 0.0, vignette: 0.15 } },
  // RALLY leans on the blur harder than REAL does. With flat colour there is no
  // surface detail for distance to eat, so depth has to come from somewhere —
  // and softening it is what stops a flat-shaded hill reading as a sticker on
  // the sky. Less bokeh though: a pastel palette has no highlights worth
  // spreading, and cranking it just makes the haze glow.
  rally: { flat: true,  env: 0.0,  exposure: 1.0,  ambMul: 1.0,  sunMul: 0.9,  speed: 0.5,  camUp: 1.2, camBack: 2.5, shadowRadius: 5, lines: 0.55,
           dofOn: true,
           dof: { dofStart: 60, dofEnd: 900, dofAmount: 6.0, dofCurve: 0.95, dofMax: 40, dofBokeh: 1.2 },
           post: { bloom: 0.22, bloomThresh: 1.2, saturation: 1.08, contrast: 0.93, lift: 0.035, vignette: 0.3 } },
  flat:  { flat: true,  env: 0.4,  exposure: 0.92, ambMul: 1,    sunMul: 1,    speed: 1,    camUp: 0,   camBack: 0,   shadowRadius: 1,
           dof: { dofStart: 35, dofEnd: 420, dofAmount: 5.5, dofCurve: 1.0, dofMax: 40, dofBokeh: 3.2 },
           post: { bloom: 0.18, bloomThresh: 1.3, saturation: 1.0, contrast: 1.0, lift: 0.0, vignette: 0.15 } },
};
export const PALETTES = { rally: RALLY_SKIES, kart: KART_SKIES };

export function cfgFor(look) { return CFG[look] || CFG.real; }

// Called on every track load and on every switch. `ctx` carries what the look
// is allowed to touch; nothing here builds geometry.
export function applyLook(look, ctx) {
  const c = cfgFor(look);
  const { renderer, scene, lights, rig, speedFeel, sky, dof } = ctx;

  setFlat(c.flat);
  setLines(c.lines ?? 1);
  renderer.toneMappingExposure = c.exposure;
  scene.environmentIntensity = c.env;

  if (lights) {
    lights.hemi.intensity = ctx.baseAmb * c.ambMul;
    lights.dir.intensity = ctx.baseSun * c.sunMul;
    // a soft key wants a soft edge; a hard one wants a crisp shadow
    lights.dir.shadow.radius = c.shadowRadius ?? 1;
  }
  if (scene.fog && sky) {
    scene.fog.color.set(sky.fog);
    scene.fog.near = sky.fogNear;
    scene.fog.far = sky.fogFar;
  }
  if (rig) { rig.lookUp = c.camUp; rig.lookBack = c.camBack; }
  if (speedFeel) speedFeel.lookScale = c.speed;
  // the look owns the blur's TUNING; whether it's on is still his key 4,
  // except at the moment a look is chosen (see setLook)
  if (dof && c.dof) for (const [k, v] of Object.entries(c.dof)) dof.set(k, v);
  if (dof && c.post) for (const [k, v] of Object.entries(c.post)) dof.set(k, v);
}
