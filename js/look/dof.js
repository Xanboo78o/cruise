// dof.js — soft at distance. One effect, not a stack.
//
// The old post.js did eleven things and got scrapped. This does exactly one,
// because it was asked for by name: near stays sharp, far goes soft.
//
// It is depth-based, not a fog trick — fog changes an object's COLOUR with
// distance, which the scene already does, but it stays crisp. What reads as
// distance to an eye is losing detail, and that needs the depth buffer.
//
// Deliberately cheap: one target, one quad, and a blur that only takes its taps
// where the depth says it needs them, so near geometry (most of the screen when
// you are driving) costs one sample and exits.

import * as THREE from 'three';

export const DOF_KNOBS = {
  dofStart:  ['sharp until (m)', 0, 600, 5, 35],
  dofEnd:    ['fully soft at (m)', 50, 3000, 25, 420],
  dofAmount: ['softness at that range', 0, 12, 0.1, 5.5],
  dofCurve:  ['falloff', 0.3, 3, 0.05, 1.0],
  dofMax:    ['ceiling (px)', 1, 60, 0.5, 40],
  dofBokeh:  ['highlight spread', 0, 8, 0.1, 3.2],
};

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2  uTexel;
uniform float uNear, uFar;
uniform float uStart, uEnd, uAmount, uCurve, uMax, uBokeh;

// eye-space distance from the depth buffer
float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

// Twelve points on two rings, generated rather than held in an array: an
// indexed global array is asking for trouble on GLSL ES 1.00, and sin/cos of a
// loop constant costs nothing after unrolling.
const int N = 12;

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float z = dist(vUv);
  // NOT clamped to 1: 'fully soft at' is the distance where the softness figure
  // is reached, not a ceiling. Past it this keeps growing, so a hill 2 km out is
  // meaningfully softer than a fence 300 m out instead of both sitting at the
  // same blur — which is the thing that made it read as a filter rather than as
  // distance. uMax is only there to stop the tap pattern falling apart.
  float t = max((z - uStart) / max(uEnd - uStart, 1.0), 0.0);
  t = pow(t, uCurve);
  float r = min(t * uAmount, uMax);
  if (r < 0.35) { gl_FragColor = vec4(col, 1.0); return; }   // near: one tap and out

  // Twelve taps can't cover a 20 px circle without banding, so each tap reads
  // from a coarser mip as the radius grows. The disc gives the shape, the mip
  // fills in everything between the taps.
  // Less mip than before. A mip is an AVERAGE, and averaging pulls everything
  // toward the mean — which desaturates and flattens contrast, i.e. it looks
  // like haze. The disc has to do more of the work for this to read as glass.
  float lod = log2(max(1.0, r * 0.3));
  float cw = 1.0 + uBokeh * dot(col, vec3(0.299, 0.587, 0.114));
  vec3 acc = col * cw;
  float w = cw;
  for (int i = 0; i < N; i++) {
    float a = float(i) * 0.5236;                 // 30 degrees apart
    float ring = i < 6 ? 1.0 : 0.55;             // outer ring, then an inner one
    vec2 off = vec2(cos(a), sin(a)) * ring * r * uTexel;
    vec2 uv = clamp(vUv + off, 0.0005, 0.9995);
    // Only pull in samples at least as far away as this pixel. Without it a
    // blurred sky bleeds a halo over every roadside post in front of it.
    float zs = dist(uv);
    float ok = step(z - 2.0, zs);
    vec3 sm = texture2D(tColor, uv, lod).rgb;
    // BOKEH. This is the whole difference between blur and fog. A flat average
    // pulls every sample toward the mean, so bright things get dimmer and the
    // image goes milky — which is precisely what haze does, and why the last
    // version read as fog. Real defocus spreads a highlight into a DISC that
    // stays bright, so weight each sample by its own brightness and normalise.
    // Distant windows, headlights and sky-gaps through trees bloom instead of
    // washing out, and the eye reads glass rather than air.
    float bw = 1.0 + uBokeh * dot(sm, vec3(0.299, 0.587, 0.114));
    acc += sm * bw * ok;
    w += bw * ok;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}
`;

export class DistanceBlur {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    this.v = Object.fromEntries(Object.entries(DOF_KNOBS).map(([k, d]) => [k, d[4]]));
    this.w = 1; this.h = 1;

    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      // mipmapped on purpose: the shader biases its taps up the chain as the
      // blur radius grows, which is what keeps a big blur smooth
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      depthTexture: depth, stencilBuffer: false,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.texture.generateMipmaps = true;

    this.uniforms = {
      tColor: { value: this.rt.texture },
      tDepth: { value: depth },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.3 }, uFar: { value: 1000 },
      uStart: { value: this.v.dofStart }, uEnd: { value: this.v.dofEnd },
      uAmount: { value: this.v.dofAmount }, uCurve: { value: this.v.dofCurve },
      uMax: { value: this.v.dofMax }, uBokeh: { value: this.v.dofBokeh },
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG,
        uniforms: this.uniforms, depthTest: false, depthWrite: false })
    );
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.setSize(innerWidth, innerHeight);
  }

  set(k, val) {
    this.v[k] = val;
    const u = this.uniforms['u' + k.slice(3)];
    if (u) u.value = val;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const iw = Math.max(2, Math.round(w * dpr)), ih = Math.max(2, Math.round(h * dpr));
    this.rt.setSize(iw, ih);
    this.uniforms.uTexel.value.set(1 / iw, 1 / ih);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.qScene, this.qCam);
  }
}
