#!/usr/bin/env node
// Is a region's fetched elevation grid complete? opentopodata allows 1000 requests a day and a
// region needs 66 of them, so a long fetch run can hit the quota partway. When it does the file is
// still written, and region-data bakes the gaps as sea level -- a silently flat city that every
// other check passes. Exits 1 on a short or holey grid.
//
//   node tools/elevation-check.mjs <region>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: elevation-check.mjs <region>'); process.exit(2); }

const file = path.join(REPO, 'scratch/osm', id, 'elevation.json');
if (!fs.existsSync(file)) {
  console.error(`${id}: no elevation.json -- run tools/elevation-fetch.mjs ${id}`);
  process.exit(1);
}

const e = JSON.parse(fs.readFileSync(file, 'utf8'));
const grid = e.grid ?? e.heights ?? e.z ?? e.data;
if (!grid) { console.error(`${id}: elevation.json has no sample grid`); process.exit(1); }
const flat = Array.isArray(grid[0]) ? grid.flat() : grid;
const want = (e.nx ?? 0) * (e.nz ?? 0);
const holes = flat.filter((v) => v == null || !Number.isFinite(v)).length;

if (!want || flat.length !== want || holes) {
  console.error(`${id}: elevation INCOMPLETE -- ${flat.length} of ${want || '?'} samples, ${holes} missing.`);
  console.error(`${id}: re-fetch before baking, or the city bakes flat.`);
  process.exit(1);
}
const lo = Math.min(...flat), hi = Math.max(...flat);
console.log(`  ok    elevation ${e.nx} x ${e.nz} = ${flat.length} samples, no gaps, ${lo.toFixed(1)}-${hi.toFixed(1)} m (range ${(hi - lo).toFixed(1)} m)`);
