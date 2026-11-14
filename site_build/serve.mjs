// Serves site/ and Ogonek's follow-up endpoint on one port. No npm packages.
//   node site_build/serve.mjs [port]        then open http://127.0.0.1:8080/
// Set GEMINI_API_KEY to enable follow-up answers; without it the page still works and says so.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer } from '../site/api/_core.mjs';

// Local key: GEMINI_API_KEY=... in the repo-root .env (gitignored). A real env var wins.
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}

const SITE = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export function serve(port = 8080, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/ogonek') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 20000) { res.writeHead(413).end(); return; } }
      let out;
      try { out = await answer(JSON.parse(body || '{}'), process.env.GEMINI_API_KEY); } catch (e) { out = { status: 400, body: { error: 'bad request' } }; }
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
      return;
    }
    try {
      let file = normalize(join(SITE, decodeURIComponent(url.pathname)));
      if (file !== SITE && !file.startsWith(SITE + sep)) { res.writeHead(403).end(); return; }
      const s = await stat(file).catch(() => null);
      if (s && s.isDirectory()) file = join(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(ok => server.listen(port, host, () => ok(server)));
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const port = Number(process.argv[2]) || 8080;
  serve(port).then(() => console.log(`Codex of Fire at http://127.0.0.1:${port}/` + (process.env.GEMINI_API_KEY ? '' : '  (no GEMINI_API_KEY: follow-up answers are off)')));
}
