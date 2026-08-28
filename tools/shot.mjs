// tools/shot.mjs <url> <out.png> [waitSec=40] — real-time headless screenshot over CDP.
// (--virtual-time-budget never converges with the full world; this waits real seconds.)
// e.g. node tools/shot.mjs "http://localhost:8137/?t=sanoozi&mode=cruise&go=1&nodrone=1&at=-130,-1100,0" shot.png 75
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, waitS = '40'] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 100);
const ch = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--window-size=1280,720', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-1000/shot-profile-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+waitS * 1000);
const r = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(r.result.data, 'base64'));
console.log('wrote', out);
ch.kill('SIGKILL'); process.exit(0);
