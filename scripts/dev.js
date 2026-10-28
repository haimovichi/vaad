// Local preview of app/ in demo mode (no Supabase needed): npm run dev  ->  http://localhost:3000/index.html?demo=owner
// Copies data/db.json to app/demo-db.json (git-ignored, never deployed) and serves app/.
const http = require('http');
const fs = require('fs');
const path = require('path');
require('./build-app');

const root = path.join(__dirname, '..', 'app');
if (fs.existsSync(path.join(__dirname, '..', 'data', 'db.json'))) fs.copyFileSync(path.join(__dirname, '..', 'data', 'db.json'), path.join(root, 'demo-db.json'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(root, p === '/' ? 'index.html' : p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3000, '127.0.0.1', () => console.log('http://localhost:3000/index.html?demo=owner  (also demo=admin, demo=tenant)'));
