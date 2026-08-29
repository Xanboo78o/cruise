// tools/serve.mjs [port=8137] — the game's local server WITH a save endpoint for
// the city tool: POST /save writes assets/city/sanoozi.json. Plain static files
// otherwise, no caching. Run from anywhere: it serves the repo this file is in.
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.argv[2] || 8137);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.md': 'text/markdown', '.txt': 'text/plain' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/save') {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"server":true}'); }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const doc = JSON.parse(body);
          const name = (url.searchParams.get('doc') || 'sanoozi').replace(/[^a-z0-9_-]/gi, '') || 'sanoozi';
          await writeFile(join(ROOT, `assets/city/${name}.json`), JSON.stringify(doc, null, 1));
          console.log(new Date().toISOString().slice(11, 19), name, 'saved', doc.objects?.length ?? 0, 'objects,', doc.roads ? doc.roads.length + ' roads' : 'spec roads');
          res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
        } catch (e) { res.writeHead(400); res.end(String(e)); }
      });
      return;
    }
  }
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(301, { location: p + '/' }); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-length': data.length });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log(`cruise + city tool on http://localhost:${PORT}/  (POST /save → assets/city/sanoozi.json)`));
