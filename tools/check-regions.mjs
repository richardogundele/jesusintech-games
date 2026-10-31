#!/usr/bin/env node
// Runs tools/lanes-check.mjs over every baked map: Kent plus each entry in tools/regions.mjs that
// has a region.json. A region can be in that table before its map is fetched (see `ready`), so a
// missing file is listed and skipped rather than failing the run -- but a baked map is always
// checked, whether or not the game is showing it yet.
//
//   node tools/check-regions.mjs [--verbose]
//
// Exits 1 if any map fails. driveuk is the authored teaching city (tools/city-build.mjs), not a
// real-map region, and is not checked here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REGIONS } from './regions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);
const ids = ['kent', ...Object.keys(REGIONS)];
const missing = [];
let failed = 0;

for (const id of ids) {
  const file = path.join(REPO, 'public/assets', id, 'region.json');
  if (!fs.existsSync(file)) { missing.push(id); continue; }
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools/lanes-check.mjs'), file, ...extra], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (missing.length) console.log(`\nnot baked yet, skipped: ${missing.join(', ')}`);
if (failed) { console.log(`\n${failed} map(s) FAILED`); process.exit(1); }
