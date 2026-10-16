#!/usr/bin/env node
// Every element id the game code looks up ($('…') or getElementById('…')) must exist in index.html
// (or be made by the code itself, as an id="…" in a template). A missing one throws when the HUD is
// built and the game never loads, and neither vite build nor the lesson harness would notice.
//   node tools/dom-check.mjs        exits 1 if an id is missing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const have = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const files = ['src/main.js', 'src/hud.js', 'src/phone.js', 'src/devtest.js'];
for (const f of files) for (const m of fs.readFileSync(path.join(REPO, f), 'utf8').matchAll(/id="([^"$]+)"/g)) have.add(m[1]); // made in templates
let missing = 0, n = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(REPO, f), 'utf8');
  for (const m of src.matchAll(/(?:\$|getElementById)\('([^']+)'\)/g)) {
    n++;
    if (!have.has(m[1])) { console.log(`FAIL ${f}: #${m[1]} is not in index.html`); missing++; }
  }
}
console.log(missing ? `\n${missing} missing id(s)` : `ok   all ${n} element lookups find their id`);
process.exit(missing ? 1 : 0);
