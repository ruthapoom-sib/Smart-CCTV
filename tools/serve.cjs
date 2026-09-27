// Local preview only. Serve public application files, never repository metadata.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function createServer() {
  return http.createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (name === '/') name = '/index.html';
    const allowed = /^\/(index\.html|styles\.css|(?:scripts|assets|vendor)\/[a-zA-Z0-9._/-]+)$/.test(name);
    const file = path.resolve(root, `.${name}`);
    if (!allowed || !file.startsWith(root + path.sep) || name.split('/').includes('..') || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end('Not found'); return; }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 8000);
  createServer().listen(port, '127.0.0.1', () => console.log(`CCTV preview: http://127.0.0.1:${port}`));
}
