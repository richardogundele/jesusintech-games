#!/usr/bin/env node
// Fetches a regular elevation grid for a region (tools/regions.mjs) from the public opentopodata.org
// EU-DEM 25 m dataset and writes scratch/osm/<region>/elevation.json. Free, no key, 100 locations
// per request, 1 request / second, 1000 / day. tools/region-data.mjs reads this file and bakes the
// grid into region.json; the game samples it for the hills (world.heightAt / world.gradeAt).
//
//   node tools/elevation-fetch.mjs <region> [--step 100] [--force]
//
// Step is in metres; the grid is (2*half)/step + 1 points each way. 100 m -> 2601 points for a
// 5 km square, 27 requests, ~30 seconds. Built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, originOf } from './regions.mjs';

const argv = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; } else pos.push(a); }
const R = REGIONS[pos[0]];
if (!R) { console.error(`usage: node tools/elevation-fetch.mjs <${Object.keys(REGIONS).join('|')}> [--step 100] [--force]`); process.exit(2); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt.out || path.join(REPO, 'scratch/osm', R.id));
fs.mkdirSync(OUT, { recursive: true });
const FILE = path.join(OUT, 'elevation.json');
if (fs.existsSync(FILE) && !opt.force) { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); console.log(`${R.id}: cached (${j.nx} x ${j.nz} = ${j.heights.length} samples, step ${j.step} m)`); process.exit(0); }

const STEP = Math.max(50, parseInt(opt.step, 10) || 100);
const O = originOf(R);
const half = R.half, nx = Math.round((2 * half) / STEP) + 1, nz = nx;
// A margin of STEP past the OSM bounds so bilinear sampling at the edges is still inside the grid.
const points = []; // [lat, lon] in the grid's row-major order (z slow, x fast)
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = -half + i * STEP, z = -half + j * STEP;
  const lat = O.lat0 - z / O.mPerDegLat, lon = O.lon0 + x / O.mPerDegLon;
  points.push([lat, lon]);
}
console.log(`${R.id}: ${nx} x ${nz} = ${points.length} samples, step ${STEP} m, ${Math.ceil(points.length / 100)} requests`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heights = new Array(points.length).fill(null);
let wait = 1100; // keep under the 1 req / sec limit
for (let start = 0; start < points.length; start += 100) {
  const batch = points.slice(start, start + 100), locs = batch.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join('|');
  let attempt = 0, ok = false;
  while (attempt < 8 && !ok) {
    attempt++;
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${locs}`, { signal: ctl.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (res.status === 429) { console.log(`${R.id}: ${start}/${points.length} rate-limited, waiting ${wait / 1000}s`); await sleep(wait); wait = Math.min(wait + 500, 5000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      const j = JSON.parse(text);
      if (j.status !== 'OK') throw new Error(j.error || text.slice(0, 160));
      j.results.forEach((r, i) => { heights[start + i] = r.elevation; });
      ok = true;
      process.stdout.write(`${R.id}: ${start + batch.length}/${points.length}\r`);
    } catch (e) {
      console.log(`${R.id}: ${start}/${points.length} attempt ${attempt} failed: ${String(e.message || e).slice(0, 120)}`);
      await sleep(Math.min(wait * attempt, 8000));
    }
  }
  if (!ok) { console.error(`${R.id}: giving up at ${start}; wrote nothing`); process.exit(1); }
  await sleep(wait);
}

// Fill the few nulls the API sometimes returns for sea or out-of-coverage points with their 4-neighbour mean.
let nulls = heights.reduce((n, h) => n + (h == null ? 1 : 0), 0);
for (let pass = 0; pass < 4 && nulls; pass++) {
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (heights[k] != null) continue;
    const n = []; if (i > 0 && heights[k - 1] != null) n.push(heights[k - 1]); if (i < nx - 1 && heights[k + 1] != null) n.push(heights[k + 1]); if (j > 0 && heights[k - nx] != null) n.push(heights[k - nx]); if (j < nz - 1 && heights[k + nx] != null) n.push(heights[k + nx]);
    if (n.length) heights[k] = n.reduce((s, v) => s + v, 0) / n.length;
  }
  nulls = heights.reduce((n, h) => n + (h == null ? 1 : 0), 0);
}
if (nulls) { const mean = heights.filter((h) => h != null).reduce((s, v) => s + v, 0) / (heights.length - nulls); for (let i = 0; i < heights.length; i++) if (heights[i] == null) heights[i] = mean; }

const minH = Math.min(...heights), maxH = Math.max(...heights);
const grid = { source: 'opentopodata.org eudem25m (EU-DEM v1.1, Copernicus)', fetched: null, region: R.id,
  origin: O, x0: -half, z0: -half, step: STEP, nx, nz, min: +minH.toFixed(2), max: +maxH.toFixed(2),
  heights: heights.map((h) => +h.toFixed(2)) };
fs.writeFileSync(FILE, JSON.stringify(grid));
console.log(`\n${R.id}: wrote ${FILE} (${(fs.statSync(FILE).size / 1e6).toFixed(2)} MB), min ${grid.min} m, max ${grid.max} m, range ${(grid.max - grid.min).toFixed(1)} m`);
