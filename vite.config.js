import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// dev only: POST a JPEG data URL to /__shot?name=foo and it is saved to shots/foo.jpg
// (lets automated checks capture frames even when no window is visible)
const shotSaver = {
  name: 'shot-saver',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'live').replace(/[^a-z0-9_-]/gi, '');
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
      req.on('end', () => {
        const b64 = body.replace(/^data:image\/\w+;base64,/, '');
        const dir = path.join(server.config.root, 'shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.jpg`), Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
};

// dev only: POST raw bytes to /__save?name=foo.glb and they are written to assets-src/inbox/foo.glb
// (lets the browser hand over files it fetched, e.g. Sketchfab downloads, without Chrome's download pipeline)
const fileInbox = {
  name: 'file-inbox',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'file.bin').replace(/[^a-z0-9._-]/gi, '');
      const chunks = []; let n = 0;
      req.on('data', (c) => { chunks.push(c); n += c.length; if (n > 200e6) req.destroy(); });
      req.on('end', () => {
        const dir = path.join(server.config.root, 'assets-src', 'inbox');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
        res.writeHead(200, cors); res.end(String(n));
      });
    });
  },
};

const OUT = 'dist'; // published at the root of games.jesusintech.com

// build only: keep the Ferrari model (licence unconfirmed) off the public site
const stripPrivate = {
  name: 'strip-private',
  apply: 'build',
  closeBundle() {
    for (const f of ['assets/models/ferrari.glb', 'assets/models/ferrari_ao.png']) fs.rmSync(path.join(OUT, f), { force: true });
  },
};

export default defineConfig(({ command, isPreview }) => ({
  // production is served from the root of games.jesusintech.com
  base: '/',
  plugins: [shotSaver, fileInbox, stripPrivate],
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2022', // top-level await while assets load
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: 'index.html' } },
  },
}));
