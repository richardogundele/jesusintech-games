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

const OUT = 'dist/games';

// build only: keep the Ferrari model (licence unconfirmed) off the public site
const stripPrivate = {
  name: 'strip-private',
  apply: 'build',
  closeBundle() {
    for (const f of ['assets/models/ferrari.glb', 'assets/models/ferrari_ao.png']) fs.rmSync(path.join(OUT, f), { force: true });
  },
};

export default defineConfig(({ command }) => ({
  // production is served from jesusintech.com/games/ (proxied), so build for that path
  base: command === 'build' ? '/games/' : '/',
  plugins: [shotSaver, stripPrivate],
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2022', // top-level await while assets load
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: 'index.html' } },
  },
}));
