// world/citydoc.js — the city as a document: which base terrain ('flat' = a
// blank plain to shape, 'sanoozi' = the hand-drawn coast/mountain/canyon), the
// roads (null = the hand-drawn ones in spec.js), the terrain edits (height
// deltas + paint, gzipped), and everything placed with the map maker. Lives in
// assets/city/sanoozi.json in the repo; while you edit, a draft goes to
// localStorage on every change and to the local save server when one is
// running (tools/serve.mjs). On GitHub Pages there is no server, so EXPORT
// hands you the file.

import { ROADS } from './spec.js';

export const DOC_NAME = ((typeof location !== 'undefined' && new URLSearchParams(location.search).get('doc')) || 'sanoozi').replace(/[^a-z0-9_-]/gi, '') || 'sanoozi';
export const CITY_URL = `assets/city/${DOC_NAME}.json`;
const DRAFT_KEY = 'cruise.city.draft' + (DOC_NAME === 'sanoozi' ? '' : ':' + DOC_NAME);
export const DOC_V = 2;

export function emptyDoc() { return { v: DOC_V, t: 0, base: 'flat', autofill: false, roads: [], objects: [], terrain: null }; }

export async function loadCityDoc() {
  let doc = emptyDoc();
  try { const r = await fetch(CITY_URL, { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if ((j.v || 1) >= DOC_V) doc = { ...doc, ...j }; } } catch {}
  let draft = null;
  try { const s = localStorage.getItem(DRAFT_KEY); if (s) draft = JSON.parse(s); } catch {}
  if (draft && (draft.v || 1) >= DOC_V && (draft.t || 0) > (doc.t || 0)) { doc = { ...emptyDoc(), ...draft }; doc.isDraft = true; }
  doc.objects = doc.objects || [];
  doc.terrainData = await decodeTerrain(doc.terrain);
  return doc;
}

export function roadsFor(doc) { return doc && doc.roads ? doc.roads : ROADS; }

// ---------------------------------------------------------------- terrain codec
// dh as centimetres in Int16, paint as bytes, both gzipped and base64'd — a
// blank grid is a few hundred bytes, a sculpted one a few hundred KB
async function gz(bytes, mode) {
  const cs = mode === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const w = cs.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

export async function encodeTerrain(td) {
  if (!td || !td.touched) return null;
  const n = td.dh.length, cm = new Int16Array(n);
  for (let i = 0; i < n; i++) cm[i] = Math.max(-32000, Math.min(32000, Math.round(td.dh[i] * 100)));
  const dh = b64(await gz(new Uint8Array(cm.buffer), 'gzip'));
  const paint = b64(await gz(td.paint, 'gzip'));
  return { n, dh, paint };
}
export async function decodeTerrain(t) {
  if (!t || !t.dh) return null;
  try {
    const cmBytes = await gz(unb64(t.dh), 'gunzip'), cm = new Int16Array(cmBytes.buffer, cmBytes.byteOffset, cmBytes.byteLength / 2);
    const dh = new Float32Array(cm.length); for (let i = 0; i < cm.length; i++) dh[i] = cm[i] / 100;
    const paint = await gz(unb64(t.paint), 'gunzip');
    return { dh, paint: new Uint8Array(paint), touched: true };
  } catch (e) { console.warn('terrain data', e); return null; }
}

// a clean copy for storage: no runtime fields
export async function serialize(doc) {
  if (doc.terrainDirty || (doc.terrainData && doc.terrainData.touched && !doc.terrain)) { doc.terrain = await encodeTerrain(doc.terrainData); doc.terrainDirty = false; }
  return JSON.stringify({ v: DOC_V, t: doc.t, base: doc.base || 'flat', autofill: doc.autofill === true, roads: doc.roads, terrain: doc.terrain,
    objects: doc.objects.map(o => { const { _cell, ...rest } = o; return rest; }) });
}

let serverOk = null;
export async function saveCityDoc(doc) {
  doc.t = Date.now();
  const body = await serialize(doc);
  try { localStorage.setItem(DRAFT_KEY, body); } catch {}
  if (serverOk === false) return { local: true, server: false };
  try {
    const r = await fetch('/save?doc=' + DOC_NAME, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    serverOk = r.ok;
    if (r.ok) { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
    return { local: true, server: r.ok };
  } catch { serverOk = false; return { local: true, server: false }; }
}
export async function probeServer() {
  try { const r = await fetch('/save', { method: 'GET', cache: 'no-store' }); serverOk = r.ok; } catch { serverOk = false; }
  return serverOk;
}
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

export async function exportCityDoc(doc) {
  const blob = new Blob([await serialize(doc)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = DOC_NAME + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function importCityDoc() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return resolve(null); try { const j = JSON.parse(await f.text()); const d = { ...emptyDoc(), ...j }; d.terrainData = await decodeTerrain(d.terrain); resolve(d); } catch { resolve(null); } };
    inp.click();
  });
}
