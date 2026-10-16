/* Zero-dependency dev server for LEAKROOMS.
   Usage: npm run serve  →  http://localhost:8080/
   Serves the repo root. `/` resolves to index.html. `..` is rejected. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 8080;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/' || urlPath === '') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    fs.createReadStream(path.join(root, 'index.html')).pipe(res);
    return;
  }
  if (urlPath.split('/').includes('..')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  const file = path.normalize(path.join(root, urlPath));
  const base = root.endsWith(path.sep) ? root : root + path.sep;
  if (file !== root && !file.startsWith(base)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`leakrooms dev server → http://localhost:${port}/`));
