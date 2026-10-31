#!/usr/bin/env node
// Can the game plan a fair 15-minute driving test from a city's test centre, with no hand-authored
// route pool? Builds the pool off the map (auto-pool.js) and runs generateTest for a few seeds.
//
//   node tools/testgen-check.mjs [<region>|all] [--seeds 6] [--quiet] [--radius 2200]
//
// A seed either returns a route (minutes, parts, manoeuvre) or throws with the last reason, which is
// the thing to read when a centre keeps failing: "no multi-lane roundabout" means the map around the
// centre has none, and no amount of searching will find one.
//
// "Fair" is not the same question as "varied". Every run also reports what the routes from a centre
// actually contain: how many different routes the seeds produced, how much of the pool they drew on,
// the kinds of road by the mile and the features reached. A centre that plans a fair test and sends
// every learner down the same street is the failure this part is here to show.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { autoPool } from '../src/kent/auto-pool.js';
import { generateTest, validateRoute } from '../src/kent/test-routes.js';
import { REGIONS } from './regions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const which = argv.find((a) => !a.startsWith('--')) || 'all';
const seeds = parseInt((argv.find((a) => a.startsWith('--seeds')) || '').split('=')[1] || argv[argv.indexOf('--seeds') + 1], 10) || 6;
const ids = which === 'all' ? Object.keys(REGIONS) : [which];
const QUIET = argv.includes('--quiet');
const RADIUS = +(argv[argv.indexOf('--radius') + 1]) || undefined;

/** ground height from the baked terrain grid, the same triangles src/worlds/terrain.js uses */
function sampler(T) {
  if (!T) return null;
  const { x0, z0, step, nx, nz, heights } = T, x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;
  const at = (i, j) => heights[j * nx + i];
  return (x, z) => {
    if (x < x0 || x > x1 || z < z0 || z > z1) return null;
    const fx = (x - x0) / step, fz = (z - z0) / step;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const u = fx - i, v = fz - j, h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
}

/** what one route is made of: km by kind of road, the steepest 20 m of it, and the features on it */
function profile(route, height) {
  const km = { dual: 0, limit40up: 0, nsl: 0, total: 0 }, pts = route.pts;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], d = (pts[i].s - a.s) / 1000, r = a.road || {};
    km.total += d;
    if (r.dual) km.dual += d;
    if ((r.limit || 0) >= 40) km.limit40up += d;
    if (r.nsl) km.nsl += d;
  }
  let grade = null;
  if (height) {
    const W = 20; // the steepest twenty metres, as a gradient a learner would feel
    let worst = 0, seen = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      let j = i; while (j < pts.length - 1 && pts[j].s - a.s < W) j++;
      if (pts[j].s - a.s < W / 2) break;
      const h0 = height(a.x, a.z), h1 = height(pts[j].x, pts[j].z);
      if (h0 == null || h1 == null) continue;
      seen = true;
      worst = Math.max(worst, Math.abs(h1 - h0) / (pts[j].s - a.s));
    }
    if (seen) grade = worst * 100;
  }
  const feat = {};
  for (const e of route.events) {
    const k = e.kind === 'turn' || e.kind === 'emerge' ? `${e.kind}-${e.dir || 'none'}` : e.kind;
    feat[k] = (feat[k] || 0) + 1;
  }
  return { km, grade, feat };
}
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };

let fails = 0;
for (const id of ids) {
  const region = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets', id, 'region.json'), 'utf8'));
  const net = new RoadNet(region);
  const tc = net.testCentres[0];
  const t0 = Date.now();
  let pool;
  try { pool = autoPool(net, tc, { key: id, world: id, ...(RADIUS ? { radius: RADIUS } : {}) }); } catch (e) { console.log(`${id}: pool FAILED: ${e.message}`); fails++; continue; }
  console.log(`\n== ${id} - ${pool.name}: ${pool.stats.mains} big-road parts (${pool.stats.multiLaneRbs} multi-lane roundabouts), ${pool.stats.loops} estates, bay park ${pool.bay ? 'yes' : 'no'} (pool in ${Date.now() - t0} ms)`);
  let ok = 0;
  const reasons = {};
  const height = sampler(region.terrain), profiles = [], shapes = new Set(), parts = new Set();
  for (let seed = 1; seed <= seeds; seed++) {
    const t1 = Date.now();
    try {
      const g = generateTest(net, pool, seed);
      const bad = validateRoute(net, g.route, { timeK: pool.timeK, minMin: pool.window[0], maxMin: pool.window[1] });
      ok++;
      profiles.push(profile(g.route, height));
      shapes.add(g.meta.stretches.join(' -> '));
      for (const st of g.meta.stretches) parts.add(st);
      if (!QUIET) {
        console.log(`  seed ${seed}: ${g.meta.minutes} min, ${(g.meta.length / 1000).toFixed(1)} km, ${g.meta.manoeuvre}, ${g.meta.attempts} tries, ${Date.now() - t1} ms${bad.length ? ' | revalidate: ' + bad.join(', ') : ''}`);
        console.log(`           ${g.meta.stretches.join(' -> ')}`);
      }
    } catch (e) {
      const m = String(e.message || e).replace(/^no fair test route from .* for seed \d+ \(last: /, '').replace(/\)$/, '');
      reasons[m] = (reasons[m] || 0) + 1;
      console.log(`  seed ${seed}: FAILED after ${Date.now() - t1} ms - ${m}`);
    }
  }
  console.log(`  ${ok}/${seeds} seeds produced a fair test${Object.keys(reasons).length ? '; failures: ' + Object.entries(reasons).map(([k, v]) => `${k} x${v}`).join('; ') : ''}`);
  if (ok < Math.ceil(seeds * 0.8)) fails++;
  if (profiles.length) {
    const poolParts = pool.stats.mains + pool.stats.loops;
    console.log(`  variety: ${shapes.size} different route${shapes.size === 1 ? '' : 's'} from ${ok} seeds, drawing on ${parts.size} of ${poolParts} parts in the pool`);
    const g = profiles.map((p) => p.grade).filter((v) => v != null);
    console.log(`  per route (median): ${median(profiles.map((p) => p.km.total)).toFixed(1)} km, dual carriageway ${median(profiles.map((p) => p.km.dual)).toFixed(1)} km, 40 mph or more ${median(profiles.map((p) => p.km.limit40up)).toFixed(1)} km, national limit ${median(profiles.map((p) => p.km.nsl)).toFixed(1)} km, steepest ${g.length ? median(g).toFixed(1) + '%' : 'no terrain grid'}`);
    const kinds = [...new Set(profiles.flatMap((p) => Object.keys(p.feat)))].sort();
    console.log(`  features (routes of ${ok} that have one): ` + kinds.map((k) => `${k} ${profiles.filter((p) => p.feat[k]).length}`).join(', '));
  }
}
console.log(fails ? `\n${fails} centre(s) below 80% success` : '\nall centres plan tests');
process.exit(fails ? 1 : 0);
