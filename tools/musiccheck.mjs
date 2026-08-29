// tools/musiccheck.mjs [songId|all] [--wav] — render a song headlessly (chromium,
// OfflineAudioContext) and print the numbers: loudness per section, peak,
// clipping, band balance, tempo estimate, silences. --wav also saves a mono
// 22 kHz wav to concept/inbox/<id>.wav (via the dev server) and draws a
// spectrogram next to it, so the structure can be LOOKED at.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2), wantWav = args.includes('--wav');
const which = args.find(a => !a.startsWith('--')) || 'all';
const { SONGS } = await import('../js/songs.js');
const ids = which === 'all' ? Object.keys(SONGS) : [which];
const base = process.env.CRUISE_URL || 'http://localhost:8137';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(id) {
  const port = 9700 + Math.floor(Math.random() * 200), stamp = Date.now();
  const ch = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=900,600',
    `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-1000/mcheck-' + stamp, '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let mid = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++mid; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${base}/radio.html?check=${id}${wantWav ? '&wav=1' : ''}` });
  let rep = null;
  for (let i = 0; i < 1100; i++) { await sleep(500); const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__CHECK || null)', returnByValue: true }); const v = r.result?.result?.value; if (v && v !== 'null') { rep = JSON.parse(v); break; } }
  ch.kill('SIGKILL'); await sleep(200); try { execSync('rm -rf /tmp/claude-1000/mcheck-' + stamp); } catch {}
  for (const l of logs.slice(0, 5)) console.log('  ', l);
  return rep;
}

for (const id of ids) {
  const r = await run(id);
  if (!r) { console.log(`${id}: no result (timeout)`); continue; }
  if (r.error) { console.log(`${id}: ERROR ${r.error}`); continue; }
  const flags = [];
  if (r.rmsDb == null || r.sections.some(s => s.rms == null)) flags.push('NaN IN OUTPUT (a voice produced non-finite samples)');
  if (r.clipSamples > 50) flags.push(`CLIPPING ${r.clipSamples} samples`);
  if (r.peakDb > -0.3) flags.push('peak at ceiling');
  if (r.gaps > 0) flags.push(`${r.gaps} silence gap(s)`);
  const bpmOk = [r.bpmEst, ...r.bpmAlt].some(b => b != null && Math.abs(b - r.bpm) < 2.5) || (r.beatStrength ?? 0) >= 0.6;
  if (!bpmOk) flags.push(`tempo reads ${r.bpmEst} (alt ${r.bpmAlt.join('/')}) vs ${r.bpm}, beat strength ${r.beatStrength}`);
  const drops = r.sections.filter(s => /drop|chorus|ascent|B/.test(s.name)), quiet = r.sections.filter(s => /intro|break|outro|fountain/.test(s.name));
  if (drops.length && quiet.length) { const d = Math.max(...drops.map(s => s.rms)), q = Math.min(...quiet.map(s => s.rms)); if (d - q < 3) flags.push(`flat dynamics: loudest ${d} vs quietest ${q} dB`); }
  console.log(`\n=== ${SONGS[id].name} (${id}) · ${r.bpm} bpm · ${r.duration}s · rendered in ${(r.renderMs / 1000).toFixed(1)}s ===`);
  console.log(`peak ${r.peakDb} dBFS · rms ${r.rmsDb} dBFS · clip ${r.clipSamples} · dc ${r.dc} · tempo est ${r.bpmEst} (alt ${r.bpmAlt.join('/')}, beat ${r.beatStrength}) · silences ${r.gaps} (longest ${r.longestSilenceS}s)`);
  console.log('section     bars   rms    sub  low  mid  hi');
  const f2 = v => v == null ? ' NaN' : v.toFixed(2);
  for (const s of r.sections) console.log(`${s.name.padEnd(11)} ${String(s.bars).padStart(4)} ${String(s.rms).padStart(6)}   ${f2(s.sub)} ${f2(s.low)} ${f2(s.mid)} ${f2(s.hi)}`);
  console.log(flags.length ? 'FLAGS: ' + flags.join(' | ') : 'clean');
  if (wantWav && r.wav) {
    const wav = `concept/inbox/${id}.wav`;
    if (existsSync(wav)) {
      const png = `concept/inbox/${id}.spec.png`;
      try { execSync(`ffmpeg -y -loglevel error -i ${wav} -lavfi "showspectrumpic=s=1600x400:legend=0:scale=cbrt:fscale=log:color=magma" ${png}`); console.log('spectrogram', png); } catch (e) { console.log('ffmpeg failed', e.message); }
      try { console.log(execSync(`ffmpeg -i ${wav} -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|LRA:|Peak:" | tail -3`).toString().trim()); } catch {}
    } else console.log('wav not found:', r.wav);
  }
}
