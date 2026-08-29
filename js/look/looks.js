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

import { setFlat } from './materials.js';

export const LOOKS = ['real', 'rally', 'flat'];
export const LOOK_LABEL = { real: 'REAL', rally: 'ART OF RALLY', flat: 'FLAT' };

// same shape as SKIES in world.js, so it can be swapped straight in
export const RALLY_SKIES = {
  noon:   { top: 0x2e86c8, bot: 0x9fe0e6, sun: 0xfff6e2, fog: 0x9fe0e6, fogNear: 90, fogFar: 760,
            hemiSky: 0xa8e2ee, hemiGround: 0x7a8a52, dir: 0xfff3dc, dirI: 1.05, amb: 0.95, dirPos: [0.45, 0.85, 0.35] },
  sunset: { top: 0x3b2a6b, bot: 0xff8a52, sun: 0xffd9a0, fog: 0xf09a63, fogNear: 70, fogFar: 620,
            hemiSky: 0xffb488, hemiGround: 0x6b4838, dir: 0xffcf9e, dirI: 1.0, amb: 0.9, dirPos: [-0.55, 0.5, -0.9] },
  dawn:   { top: 0x2b4f86, bot: 0xf6c9c0, sun: 0xfff0d8, fog: 0xe8c3bd, fogNear: 80, fogFar: 700,
            hemiSky: 0xd8dcf0, hemiGround: 0x6a6250, dir: 0xffe6d2, dirI: 0.95, amb: 0.95, dirPos: [0.75, 0.5, 0.5] },
  night:  { top: 0x0a1030, bot: 0x243a72, sun: 0x9fb6e8, fog: 0x1c2a52, fogNear: 50, fogFar: 420,
            hemiSky: 0x5a72ad, hemiGround: 0x1e2440, dir: 0xa8bce8, dirI: 0.5, amb: 1.0, dirPos: [-0.4, 0.7, 0.6] },
};

// per-look renderer + scene settings
const CFG = {
  real:  { flat: false, env: 0.4,  exposure: 0.92, ambMul: 1,    sunMul: 1,    speed: 1,    camUp: 0,   camBack: 0,
           dof: { dofStart: 35, dofEnd: 420, dofAmount: 5.5, dofCurve: 1.0, dofMax: 40, dofBokeh: 3.2 } },
  // RALLY leans on the blur harder than REAL does. With flat colour there is no
  // surface detail for distance to eat, so depth has to come from somewhere —
  // and softening it is what stops a flat-shaded hill reading as a sticker on
  // the sky. Less bokeh though: a pastel palette has no highlights worth
  // spreading, and cranking it just makes the haze glow.
  rally: { flat: true,  env: 0.0,  exposure: 1.0,  ambMul: 1.05, sunMul: 0.85, speed: 0.45, camUp: 1.6, camBack: 3.5,
           dofOn: true,
           dof: { dofStart: 25, dofEnd: 300, dofAmount: 7.5, dofCurve: 0.9, dofMax: 48, dofBokeh: 1.4 } },
  flat:  { flat: true,  env: 0.4,  exposure: 0.92, ambMul: 1,    sunMul: 1,    speed: 1,    camUp: 0,   camBack: 0,
           dof: { dofStart: 35, dofEnd: 420, dofAmount: 5.5, dofCurve: 1.0, dofMax: 40, dofBokeh: 3.2 } },
};

export function cfgFor(look) { return CFG[look] || CFG.real; }

// Called on every track load and on every switch. `ctx` carries what the look
// is allowed to touch; nothing here builds geometry.
export function applyLook(look, ctx) {
  const c = cfgFor(look);
  const { renderer, scene, lights, rig, speedFeel, sky, dof } = ctx;

  setFlat(c.flat);
  renderer.toneMappingExposure = c.exposure;
  scene.environmentIntensity = c.env;

  if (lights) {
    lights.hemi.intensity = ctx.baseAmb * c.ambMul;
    lights.dir.intensity = ctx.baseSun * c.sunMul;
    // a soft key wants a soft edge; a hard one wants a crisp shadow
    lights.dir.shadow.radius = look === 'rally' ? 4 : 1;
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
}
