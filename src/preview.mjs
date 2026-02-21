#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Parse args: node src/preview.mjs [file.gp] [--tracks 0,2] [port]
let gpFile = null;
let port = 3000;
let defaultTracks = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tracks' && args[i + 1]) {
    defaultTracks = args[++i].split(',').map(Number);
  } else if (/^\d+$/.test(args[i])) {
    port = parseInt(args[i], 10);
  } else if (!args[i].startsWith('--')) {
    gpFile = args[i];
  }
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.sf2': 'application/octet-stream',
  '.gp': 'application/octet-stream',
  '.gp5': 'application/octet-stream',
  '.gpx': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let filePath;

  // API: serve GP file info
  if (url.pathname === '/api/file-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      file: gpFile ? path.basename(gpFile) : null,
      tracks: defaultTracks,
    }));
    return;
  }

  // API: serve the GP file bytes
  if (url.pathname === '/api/file' && gpFile) {
    const data = fs.readFileSync(gpFile);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(data);
    return;
  }

  // Static files
  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = path.join(PROJECT_ROOT, 'preview', 'index.html');
  } else {
    // Serve from project root (allows access to node_modules)
    filePath = path.join(PROJECT_ROOT, url.pathname);
  }

  // Security: prevent directory traversal
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);

  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
  res.end(data);
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`gp-tab-video preview server`);
  console.log(`  URL: ${url}`);
  if (gpFile) {
    console.log(`  File: ${path.basename(gpFile)} (auto-loads in browser)`);
  } else {
    console.log(`  No file specified -- drag and drop in browser`);
  }
  console.log(`\nUsage: node src/preview.mjs [file.gp] [port]`);

  // Open browser
  import('child_process').then(({ exec }) => {
    exec(`open "${url}"`);
  });
});
