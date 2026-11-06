// Dependency-free static file server for the playground (local use only).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

http.createServer((req, res) => {
  let url;
  let urlPath;
  try {
    url = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(url.pathname);
  } catch (error) {
    res.writeHead(400).end('Bad request');
    return;
  }
  const filePath = path.join(ROOT, urlPath);
  // Only serve files inside web/, excluding the server script itself.
  if ((filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) || filePath === __filename) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || (!stat.isFile() && !stat.isDirectory())) {
      res.writeHead(404).end('Not found');
      return;
    }
    if (stat.isDirectory() && !url.pathname.endsWith('/')) {
      res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(target, (readError, data) => {
      if (readError) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PEGM playground: http://localhost:${PORT}`);
});
