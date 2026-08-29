// world/water.js — the sea and the lakes. One plane at y = 0 with a shader that
// knows where the shore is: the land height is baked once into a texture over
// the whole world, so the water can be turquoise where it's shallow, deep blue
// where it's deep, and put a line of foam where the ground comes up to meet it.
// Ripples are two drifting layers of value noise turned into a normal; the sky
// reflects in it by fresnel; the sun glints. No textures, no reflection pass —
// the sky it reflects is the same three colours the sky dome is drawn with.
//
// Tuned by the same palette the sky uses (tint(s) each frame), so at night the
// water goes dark and the glint goes silver.

import * as THREE from 'three';
import { WORLD } from './spec.js';

const VERT = /* glsl */`
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vW;
uniform sampler2D uDepth;
uniform vec4 uBounds;          // minX, minZ, 1/width, 1/height
uniform float uTime, uDetail;
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHorizon, uShallow, uDeep, uFoam;
uniform float uNight;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// height field of the ripples: two layers drifting different ways
float ripple(vec2 p) {
  float h = vnoise(p * 0.11 + uTime * vec2(0.05, 0.02)) * 0.6
          + vnoise(p * 0.27 - uTime * vec2(0.04, 0.06)) * 0.3;
  if (uDetail > 0.5) h += vnoise(p * 0.8 + uTime * vec2(0.09, -0.05)) * 0.12;
  return h;
}
void main() {
  vec2 p = vW.xz;
  vec2 duv = vec2((vW.x - uBounds.x) * uBounds.z, (vW.z - uBounds.y) * uBounds.w);
  float depth = texture2D(uDepth, duv).r;                     // 0 at the shore → 1 at 16 m
  // normal from the ripple field
  float e = 1.5;
  float h0 = ripple(p), hx = ripple(p + vec2(e, 0.0)), hz = ripple(p + vec2(0.0, e));
  float far = smoothstep(150.0, 900.0, distance(cameraPosition, vW));
  float amp = mix(0.5, 1.1, depth) * (1.0 - 0.8 * far);      // calmer in the shallows, flat in the distance (no speckle)
  vec3 n = normalize(vec3(-(hx - h0) * amp, e * 0.9, -(hz - h0) * amp));
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(n, V), 0.0);
  float F = 0.03 + 0.6 * pow(1.0 - ndv, 5.0);
  // what the sky looks like from here, reflected
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0));
  float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 90.0);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.85, depth));
  // the ground shows through in the shallows: the plane is translucent there
  float alpha = mix(0.72, 0.97, smoothstep(0.0, 0.35, depth));
  vec3 col = mix(body, sky, F) + uSunCol * glint * (0.45 - 0.25 * uNight);
  // foam: a soft band at the shore, broken up and drifting
  float band = 1.0 - smoothstep(0.0, 0.05, depth);
  float fn = vnoise(p * 0.5 + uTime * vec2(0.12, 0.05)) * 0.6 + vnoise(p * 1.6 - uTime * 0.2) * 0.4;
  float foam = band * smoothstep(0.55, 0.9, fn + band * 0.25);
  col = mix(col, uFoam, foam * 0.9);
  alpha = max(alpha, foam);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

export class Water {
  // T: WorldTerrain (land(x, z)); group: where the mesh goes; q: quality profile
  constructor(T, group, q = {}) {
    const N = 1024, W = WORLD.maxX - WORLD.minX, H = WORLD.maxZ - WORLD.minZ;
    const data = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = WORLD.minX + (i + 0.5) / N * W, z = WORLD.minZ + (j + 0.5) / N * H;
      const d = -T.land(x, z) / 16;                            // metres under the surface, over 16
      data[j * N + i] = Math.round(Math.max(0, Math.min(1, d)) * 255);
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDepth: { value: null }, uBounds: { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, 1 / W, 1 / H) },
      uTime: { value: 0 }, uDetail: { value: q.pbr ? 1 : 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.9, 0.3) }, uSunCol: { value: new THREE.Color(0xfff2dc) },
      uSkyTop: { value: new THREE.Color(0x2f7fe0) }, uSkyHorizon: { value: new THREE.Color(0xbfe2f8) },
      uShallow: { value: new THREE.Color(0x3fb8b0) }, uDeep: { value: new THREE.Color(0x14507e) }, uFoam: { value: new THREE.Color(0xf4f8f6) },
      uNight: { value: 0 },
    }]);
    this.u.uDepth.value = tex;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, fog: true, transparent: true, depthWrite: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 0, -1400);
    mesh.renderOrder = 1;
    mesh.onBeforeRender = () => { this.u.uTime.value = performance.now() / 1000; };
    group.add(mesh);
    this.mesh = mesh;
    this.day = { shallow: new THREE.Color(0x3fb8b0), deep: new THREE.Color(0x14507e), foam: new THREE.Color(0xf4f8f6) };
    this.night = { shallow: new THREE.Color(0x0e2a3a), deep: new THREE.Color(0x050e1e), foam: new THREE.Color(0x8fa0b0) };
    this._c = new THREE.Color();
  }
  // the sky palette entry the dome is drawn with (skyForHour / a SKIES row)
  tint(s) {
    const u = this.u, k = s.dark ?? (s.night ? 1 : 0);
    u.uSkyTop.value.set(s.top); u.uSkyHorizon.value.set(s.fog); u.uSunCol.value.set(s.sun);
    u.uSunDir.value.set(...s.dirPos).normalize();
    u.uShallow.value.copy(this.day.shallow).lerp(this.night.shallow, k);
    u.uDeep.value.copy(this.day.deep).lerp(this.night.deep, k);
    u.uFoam.value.copy(this.day.foam).lerp(this.night.foam, k);
    u.uNight.value = k;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.u.uDepth.value.dispose(); }
}
