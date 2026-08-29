// tools/probe.mjs <url> <waitSec> <outPrefix> <expr...> — load the page, then for
// each JS expression: evaluate it in the page (async ok), print the result, wait
// a second and screenshot <outPrefix>-<i>.png. For "what is actually on screen".
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
const [url, waitS, prefix, ...exprs] = process.argv.slice(2);
const port = 9500 + Math.floor(Math.random() * 200), stamp = Date.now();
const ch = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--window-size=1280,720',
  `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-1000/probe-' + stamp, '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+waitS * 1000);
let i = 0;
for (const ex of exprs) {
  const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true });
  console.log(`[${i}] ${ex.slice(0, 80)}\n    → ${JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.result)}`);
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${prefix}-${i}.png`, Buffer.from(shot.result.data, 'base64'));
  i++;
}
for (const l of logs.slice(0, 6)) console.log(l);
ch.kill('SIGKILL'); await sleep(300); try { rmSync('/tmp/claude-1000/probe-' + stamp, { recursive: true, force: true }); } catch {}
process.exit(0);
