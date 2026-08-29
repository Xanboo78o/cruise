// quality.js — ONE profile for everything that costs frames, picked once:
// ?quality=low|med|high beats what's remembered, which beats a guess from the
// machine. A school Chromebook lands on LOW and the game is built to be good
// there first; MED and HIGH only add on top.

export const LEVELS = {
  low:  { key: 'low',  name: 'LOW',  renderScale: 0.6, pixelRatioMax: 1,   antialias: false, shadows: false, shadowMap: 0,
          traffic: 8,  peds: 80,  bots: 6,  forestReach: 600,  forestFar: 1500, treeDensity: 0.6,  chunkNear: 450, chunkFar: 1200, billboardLights: false, smoke: 280, pbr: false, dof: false, bloom: false, aniso: 1 },
  med:  { key: 'med',  name: 'MED',  renderScale: 0.8, pixelRatioMax: 1.5, antialias: true,  shadows: true,  shadowMap: 1024,
          traffic: 16, peds: 160, bots: 11, forestReach: 900,  forestFar: 2000, treeDensity: 0.85, chunkNear: 650, chunkFar: 1700, billboardLights: false, smoke: 480, pbr: true,  dof: false, bloom: true,  aniso: 4 },
  high: { key: 'high', name: 'HIGH', renderScale: 1,   pixelRatioMax: 2,   antialias: true,  shadows: true,  shadowMap: 2048,
          traffic: 24, peds: 260, bots: 11, forestReach: 1100, forestFar: 2600, treeDensity: 1,    chunkNear: 900, chunkFar: 2400, billboardLights: true, smoke: 700, pbr: true,  dof: true,  bloom: true,  aniso: 8 },
};

export function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : (gl ? String(gl.getParameter(gl.RENDERER)) : '');
  } catch { return ''; }
}

function guess() {
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 2;
  const gpu = gpuName();
  const chromebook = /CrOS/.test(navigator.userAgent);
  const weak = /UHD (Graphics )?6[01]\d|HD Graphics [45]\d\d|Celeron|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu);
  if (chromebook || weak || mem <= 4 || cores <= 2) return 'low';
  if (mem <= 8 || /Intel|Iris/i.test(gpu)) return 'med';
  return 'high';
}

function pick() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && LEVELS[q]) { try { localStorage.setItem('cruise.quality', q); } catch {} return q; }
  try { const s = localStorage.getItem('cruise.quality'); if (s && LEVELS[s]) return s; } catch {}
  return guess();
}

export const QUALITY = pick();
export const Q = LEVELS[QUALITY];

export function setQuality(key) {
  if (!LEVELS[key]) return;
  try { localStorage.setItem('cruise.quality', key); } catch {}
  location.reload();
}
