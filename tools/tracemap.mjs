// tools/tracemap.mjs <image-under-repo> [out.json] — run tools/trace.html on a
// sketch in headless chromium (the local server must be up on 8137) and write
// what it found: roads, the Crest, canyon roads, lakes, sea, zones, lowland,
// canyon — all in the picture's own pixels.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
const [imgPath, outPath = imgPath.replace(/\.[a-z]+$/i, '') + '.trace.json'] = process.argv.slice(2);
if (!imgPath) { console.error('usage: node tools/tracemap.mjs concept/map.jpeg [out.json]'); process.exit(1); }
const port = 9700 + Math.floor(Math.random() * 100), stamp = Date.now();
const ch = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--window-size=800,600', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-1000/trace-' + stamp, '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:8137/tools/trace.html' });
await sleep(1500);
const t0 = Date.now();
const boxes = process.env.BOXES ? JSON.parse(process.env.BOXES) : null;
const r = await send('Runtime.evaluate', { expression: `traceMap(${JSON.stringify('/' + imgPath)}, { boxes: ${JSON.stringify(boxes)} }).then(r => JSON.stringify(r))`, awaitPromise: true, returnByValue: true, timeout: 600000 });
if (typeof r.result?.result?.value !== 'string') { console.error('trace failed', JSON.stringify(r.result?.exceptionDetails || r.result || r).slice(0, 1200)); process.exit(1); }
const res = JSON.parse(r.result.result.value);
if (res.debug) { writeFileSync(outPath.replace(/\.json$/, '.debug.png'), Buffer.from(res.debug.split(',')[1], 'base64')); delete res.debug; }
writeFileSync(outPath, JSON.stringify(res));
const L = a => a ? a.length : 0;
if (res.boxes) console.log('boxes:', JSON.stringify(res.boxes));
console.log(`traced in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outPath}: ${L(res.roads)} road lines, ${L(res.crest)} crest lines, ${L(res.rivers)} river lines, ${L(res.lakes)} lakes, ${L(res.sea)} sea, ${L(res.zones)} zones, ${L(res.lowland)} lowland, ${L(res.canyon)} canyon; pixels ${JSON.stringify(res.counts)}`);
ch.kill('SIGKILL'); await sleep(300); try { rmSync('/tmp/claude-1000/trace-' + stamp, { recursive: true, force: true }); } catch {}
process.exit(0);
