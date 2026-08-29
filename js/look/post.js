// post.js — the frame, finished. The scene renders into one HDR target and a
// single full-screen pass turns it into the picture: distance blur, bloom,
// tone mapping, a light grade, a vignette, the sRGB encode. That is the whole
// stack — this is the standard way a frame is finished, not a filter. The
// dashcam filters Adam scrapped are not in here and are not coming back.
//
// Why a target at all: three.js skips tone mapping when it renders into a
// render target, so the old distance-blur path (scene → target → quad) was
// shipping HIGH with NO tone mapping while LOW had ACES — the same sunset was
// two different pictures. Doing the tone map here, once, in the pass, makes
// every quality level agree. It also means the buffer is linear HDR, so bloom
// has real brightness to work with instead of clipped white.
//
// Cost, by level (quality.js): LOW = one full-screen pass at render scale,
// no MSAA, no bloom, no blur — the Chromebook rule stays "one pass". MED adds
// 4× MSAA on the target. HIGH adds bloom (three quarter-res passes) and the
// distance blur.

import * as THREE from 'three';

export const DOF_KNOBS = {
  dofStart:  ['sharp until (m)', 0, 600, 5, 35],
  dofEnd:    ['fully soft at (m)', 50, 3000, 25, 420],
  dofAmount: ['softness at that range', 0, 12, 0.1, 5.5],
  dofCurve:  ['falloff', 0.3, 3, 0.05, 1.0],
  dofMax:    ['ceiling (px)', 1, 60, 0.5, 40],
  dofBokeh:  ['highlight spread', 0, 8, 0.1, 3.2],
};
export const POST_KNOBS = {
  bloom:       ['bloom', 0, 1.5, 0.02, 0.28],
  bloomThresh: ['bloom from (linear)', 0.2, 4, 0.05, 1.15],
  saturation:  ['saturation', 0, 2, 0.02, 1.12],
  contrast:    ['contrast', 0.5, 1.6, 0.02, 1.04],
  lift:        ['shadow lift', -0.1, 0.2, 0.005, 0.0],
  vignette:    ['vignette', 0, 1, 0.02, 0.22],
};

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// bright pass: what's above the threshold, with a soft knee so a highlight
// doesn't switch on like a light
const BRIGHT = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform float uThresh;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh * 0.6, uThresh * 1.4, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

// 9-tap gaussian, one axis per pass
const BLUR = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uDir;
void main() {
  vec3 acc = texture2D(tColor, vUv).rgb * 0.2270270270;
  acc += texture2D(tColor, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  acc += texture2D(tColor, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  acc += texture2D(tColor, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  acc += texture2D(tColor, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(acc, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2  uTexel;
uniform float uNear, uFar;
uniform float uStart, uEnd, uAmount, uCurve, uMax, uBokeh;
uniform float uDof, uBloom, uExposure, uSat, uContrast, uLift, uVig;

float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

// three's ACES fit, so the picture is the one the direct path always gave
vec3 rrtOdt_(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces_(vec3 color) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = IN * color; color = rrtOdt_(color); color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }

const int N = 12;
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  // ---- distance blur (dof.js, unchanged in spirit: near = one tap and out)
  if (uDof > 0.5) {
    float z = dist(vUv);
    float t = max((z - uStart) / max(uEnd - uStart, 1.0), 0.0);
    t = pow(t, uCurve);
    float r = min(t * uAmount, uMax);
    if (r >= 0.35) {
      float lod = log2(max(1.0, r * 0.3));
      float cw = 1.0 + uBokeh * dot(col, vec3(0.299, 0.587, 0.114));
      vec3 acc = col * cw;
      float w = cw;
      for (int i = 0; i < N; i++) {
        float a = float(i) * 0.5236;
        float ring = i < 6 ? 1.0 : 0.55;
        vec2 off = vec2(cos(a), sin(a)) * ring * r * uTexel;
        vec2 uv = clamp(vUv + off, 0.0005, 0.9995);
        float zs = dist(uv);
        float ok = step(z - 2.0, zs);
        vec3 sm = texture2D(tColor, uv, lod).rgb;
        float bw = 1.0 + uBokeh * dot(sm, vec3(0.299, 0.587, 0.114));
        acc += sm * bw * ok;
        w += bw * ok;
      }
      col = acc / w;
    }
  }
  // ---- bloom: added in linear, before the tone map, like light
  if (uBloom > 0.0) col += texture2D(tBloom, vUv).rgb * uBloom;
  // ---- tone map
  col = aces_(col);
  // ---- grade: a lift for the shadows, contrast about mid grey, saturation
  col = col + uLift * (1.0 - col);
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  // ---- vignette: a soft one, wide, so it's a frame not a tunnel
  vec2 q = vUv - 0.5;
  float v = 1.0 - uVig * smoothstep(0.25, 0.95, dot(q, q) * 2.6);
  col *= v;
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}
`;

export class Post {
  // q: the quality profile (quality.js) — msaa / bloom / dof gates come from it
  constructor(renderer, q = {}) {
    this.renderer = renderer;
    this.on = true;                                        // ?post=0 turns the whole pass off (direct render, like before)
    this.enabled = false;                                  // the distance blur (the old dof.enabled — key 4, looks, the panel)
    this.bloomOn = q.bloom !== false;
    this.msaa = q.antialias ? 4 : 0;
    // debug switches, for pinning a black frame on one feature: ?msaa=0 ?hdr=0 ?mips=0
    const qs = new URLSearchParams(location.search);
    if (qs.has('msaa')) this.msaa = +qs.get('msaa');
    // a half-float target needs a float-renderable context; without one, fall back to 8-bit (bloom loses headroom, nothing breaks)
    const gl = renderer.getContext();
    const hdrOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const hdr = qs.get('hdr') !== '0' && hdrOk, mips = qs.get('mips') !== '0';
    this.v = Object.fromEntries([...Object.entries(DOF_KNOBS), ...Object.entries(POST_KNOBS)].map(([k, d]) => [k, d[4]]));
    this.w = 1; this.h = 1;

    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      // mipmapped on purpose: the blur biases its taps up the chain as the radius grows
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthTexture: depth, stencilBuffer: false, samples: this.msaa,
    });
    this.rt.texture.generateMipmaps = mips;
    const small = () => new THREE.WebGLRenderTarget(1, 1, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.b0 = small(); this.b1 = small();
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    this.black = black;

    this.u = {
      tColor: { value: this.rt.texture }, tDepth: { value: depth }, tBloom: { value: black },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.3 }, uFar: { value: 1000 },
      uStart: { value: this.v.dofStart }, uEnd: { value: this.v.dofEnd }, uAmount: { value: this.v.dofAmount },
      uCurve: { value: this.v.dofCurve }, uMax: { value: this.v.dofMax }, uBokeh: { value: this.v.dofBokeh },
      uDof: { value: 0 }, uBloom: { value: 0 }, uExposure: { value: 1 },
      uSat: { value: this.v.saturation }, uContrast: { value: this.v.contrast }, uLift: { value: this.v.lift }, uVig: { value: this.v.vignette },
    };
    this.uBright = { tColor: { value: this.rt.texture }, uThresh: { value: this.v.bloomThresh } };
    this.uBlur = { tColor: { value: null }, uDir: { value: new THREE.Vector2() } };
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mComposite = mat(FRAG, this.u);
    this.mBright = mat(BRIGHT, this.uBright);
    this.mBlur = mat(BLUR, this.uBlur);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mComposite);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.setSize(innerWidth, innerHeight);
  }

  set(k, val) {
    this.v[k] = val;
    if (k in DOF_KNOBS) { const u = this.u['u' + k.slice(3)]; if (u) u.value = val; return; }
    if (k === 'bloomThresh') this.uBright.uThresh.value = val;
    else if (k === 'saturation') this.u.uSat.value = val;
    else if (k === 'contrast') this.u.uContrast.value = val;
    else if (k === 'lift') this.u.uLift.value = val;
    else if (k === 'vignette') this.u.uVig.value = val;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    const r = this.renderer, pr = r.getPixelRatio();
    const iw = Math.max(2, Math.round(w * pr)), ih = Math.max(2, Math.round(h * pr));
    this.rt.setSize(iw, ih);
    this.u.uTexel.value.set(1 / iw, 1 / ih);
    const bw = Math.max(2, Math.round(iw / 4)), bh = Math.max(2, Math.round(ih / 4));
    this.b0.setSize(bw, bh); this.b1.setSize(bw, bh);
    this.bTexel = new THREE.Vector2(1 / bw, 1 / bh);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera) {
    const r = this.renderer;
    // the stats read renderer.info after the frame: count the whole frame, not just the last quad
    r.info.autoReset = false; r.info.reset();
    if (!this.on) { r.setRenderTarget(null); r.render(scene, camera); return; }
    // three skips tone mapping into a target; the composite does it with this exposure
    this.u.uExposure.value = r.toneMappingExposure;
    this.u.uNear.value = camera.near; this.u.uFar.value = camera.far;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    const bloom = this.bloomOn && this.v.bloom > 0;
    if (bloom) {
      this.pass(this.mBright, this.b0);
      this.uBlur.tColor.value = this.b0.texture; this.uBlur.uDir.value.set(this.bTexel.x, 0); this.pass(this.mBlur, this.b1);
      this.uBlur.tColor.value = this.b1.texture; this.uBlur.uDir.value.set(0, this.bTexel.y); this.pass(this.mBlur, this.b0);
      this.u.tBloom.value = this.b0.texture; this.u.uBloom.value = this.v.bloom;
    } else { this.u.tBloom.value = this.black; this.u.uBloom.value = 0; }
    this.u.uDof.value = this.enabled ? 1 : 0;
    this.pass(this.mComposite, null);
  }
}
