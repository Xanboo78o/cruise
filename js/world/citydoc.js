// world/citydoc.js — the city as a document: the roads (null = the hand-drawn
// ones in spec.js) and everything placed with the city tool. Lives in
// assets/city/sanoozi.json in the repo; while you edit, a draft goes to
// localStorage on every change and to the local save server when one is
// running (tools/serve.mjs). On GitHub Pages there is no server, so EXPORT
// hands you the file.

import { ROADS } from './spec.js';

export const CITY_URL = 'assets/city/sanoozi.json';
const DRAFT_KEY = 'cruise.city.draft';

export function emptyDoc() { return { v: 1, t: 0, autofill: true, roads: null, objects: [] }; }

export async function loadCityDoc() {
  let doc = emptyDoc();
  try { const r = await fetch(CITY_URL, { cache: 'no-store' }); if (r.ok) doc = { ...doc, ...(await r.json()) }; } catch {}
  let draft = null;
  try { const s = localStorage.getItem(DRAFT_KEY); if (s) draft = JSON.parse(s); } catch {}
  if (draft && (draft.t || 0) > (doc.t || 0)) { doc = { ...emptyDoc(), ...draft }; doc.isDraft = true; }
  doc.objects = doc.objects || [];
  return doc;
}

export function roadsFor(doc) { return doc && doc.roads ? doc.roads : ROADS; }

// a clean copy for storage: no runtime fields
export function serialize(doc) {
  return JSON.stringify({ v: 1, t: doc.t, autofill: doc.autofill !== false, roads: doc.roads,
    objects: doc.objects.map(o => { const { _cell, ...rest } = o; return rest; }) });
}

let serverOk = null;
export async function saveCityDoc(doc) {
  doc.t = Date.now();
  const body = serialize(doc);
  try { localStorage.setItem(DRAFT_KEY, body); } catch {}
  if (serverOk === false) return { local: true, server: false };
  try {
    const r = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
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

export function exportCityDoc(doc) {
  const blob = new Blob([serialize(doc)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sanoozi.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function importCityDoc() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return resolve(null); try { resolve({ ...emptyDoc(), ...JSON.parse(await f.text()) }); } catch { resolve(null); } };
    inp.click();
  });
}
