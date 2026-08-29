// tools/shot.mjs <url> <out.png> [waitSec=40] — real-time headless screenshot over CDP.
// (--virtual-time-budget never converges with the full world; this waits real seconds.)
// e.g. node tools/shot.mjs "http://localhost:8137/?t=sanoozi&mode=cruise&go=1&nodrone=1&at=-130,-1100,0" shot.png 75
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, waitS = '40'] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 100), stamp = Date.now();
const ch = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--window-size=1280,720', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-1000/shot-profile-' + port + '-' + stamp, '--disk-cache-size=1', '--disable-application-cache', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const logs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')); });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+waitS * 1000);
const r = await send('Page.captureScreenshot', { format: 'png' });
const ev = await send('Runtime.evaluate', { expression: "(document.getElementById('stats')||{}).textContent + ' | crash: ' + (document.getElementById('crash')||{}).textContent", returnByValue: true });
console.log('stats:', ev.result?.result?.value);
for (const l of logs.slice(0, 12)) console.log(l);
// draw-call breakdown: hide each bucket, render, diff
const bd = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const C = window.CRUISE; if (!C || !C.renderer || !C.world) return 'no world';
  const r = C.renderer, s = C.scene, cam = C.camera, W = C.world;
  const buckets = {
    traffic: () => (C.traffic ? C.traffic.list.map(f => f.mesh) : []),
    player: () => [C.carMesh],
    forestNear: () => (W.chunks || []).map(g => g.near),
    forestFar: () => (W.farChunks || []).map(g => g.far),
    terrain: () => W.terrainTiles || [],
    city: () => (W.city && W.city.meshes) || [],
    peds: () => C.peds ? [C.peds.group] : [],
  };
  const render = () => { r.render(s, cam); return r.info.render.calls; };
  const all = render(); const out = { all, tris: r.info.render.triangles };
  for (const [k, get] of Object.entries(buckets)) { const objs = get().filter(Boolean); const was = objs.map(o => o.visible); objs.forEach(o => o.visible = false); out[k] = all - render(); objs.forEach((o, i) => o.visible = was[i]); }
  // and whatever is left: per top-level scene object
  const rest = [];
  for (const o of s.children) { if (!o.visible) continue; o.visible = false; const d = all - render(); o.visible = true; if (d > 0) rest.push([d, o.type + ':' + (o.name || '') + '(' + o.children.length + ')']); }
  rest.sort((a, b) => b[0] - a[0]); out.top = rest.slice(0, 14);
  return JSON.stringify(out);
})()` });
console.log('draw calls:', bd.result?.result?.value);
const sm = await send('Runtime.evaluate', { returnByValue: true, expression: "(() => { const s = window.CRUISE && window.CRUISE.smoke; if (!s) return 'no smoke'; let n = 0; for (const l of s.life) if (l > 0) n++; return 'smoke alive ' + n + '/' + s.max; })()" });
console.log(sm.result?.result?.value);
writeFileSync(out, Buffer.from(r.result.data, 'base64'));
console.log('wrote', out);
ch.kill('SIGKILL');
await sleep(300); try { (await import('node:fs')).rmSync('/tmp/claude-1000/shot-profile-' + port + '-' + stamp, { recursive: true, force: true }); } catch {}
process.exit(0);
