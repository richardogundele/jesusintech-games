#!/usr/bin/env node
// Can the game plan a fair 15-minute driving test from a city's test centre, with no hand-authored
// route pool? Builds the pool off the map (auto-pool.js) and runs generateTest for a few seeds.
//
//   node tools/testgen-check.mjs [london|birmingham|manchester|all] [--seeds 6]
//
// A seed either returns a route (minutes, parts, manoeuvre) or throws with the last reason, which is
// the thing to read when a centre keeps failing: "no multi-lane roundabout" means the map around the
// centre has none, and no amount of searching will find one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { autoPool } from '../src/kent/auto-pool.js';
import { generateTest, validateRoute } from '../src/kent/test-routes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const which = argv.find((a) => !a.startsWith('--')) || 'all';
const seeds = parseInt((argv.find((a) => a.startsWith('--seeds')) || '').split('=')[1] || argv[argv.indexOf('--seeds') + 1], 10) || 6;
const ids = which === 'all' ? ['london', 'birmingham', 'manchester'] : [which];

let fails = 0;
for (const id of ids) {
  const region = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets', id, 'region.json'), 'utf8'));
  const net = new RoadNet(region);
  const tc = net.testCentres[0];
  const t0 = Date.now();
  let pool;
  try { pool = autoPool(net, tc, { key: id, world: id }); } catch (e) { console.log(`${id}: pool FAILED: ${e.message}`); fails++; continue; }
  console.log(`\n== ${id} - ${pool.name}: ${pool.stats.mains} big-road parts (${pool.stats.multiLaneRbs} multi-lane roundabouts), ${pool.stats.loops} estates, bay park ${pool.bay ? 'yes' : 'no'} (pool in ${Date.now() - t0} ms)`);
  let ok = 0;
  const reasons = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const t1 = Date.now();
    try {
      const g = generateTest(net, pool, seed);
      const bad = validateRoute(net, g.route, { timeK: pool.timeK, minMin: pool.window[0], maxMin: pool.window[1] });
      ok++;
      console.log(`  seed ${seed}: ${g.meta.minutes} min, ${(g.meta.length / 1000).toFixed(1)} km, ${g.meta.manoeuvre}, ${g.meta.attempts} tries, ${Date.now() - t1} ms${bad.length ? ' | revalidate: ' + bad.join(', ') : ''}`);
      console.log(`           ${g.meta.stretches.join(' -> ')}`);
    } catch (e) {
      const m = String(e.message || e).replace(/^no fair test route from .* for seed \d+ \(last: /, '').replace(/\)$/, '');
      reasons[m] = (reasons[m] || 0) + 1;
      console.log(`  seed ${seed}: FAILED after ${Date.now() - t1} ms - ${m}`);
    }
  }
  console.log(`  ${ok}/${seeds} seeds produced a fair test${Object.keys(reasons).length ? '; failures: ' + Object.entries(reasons).map(([k, v]) => `${k} x${v}`).join('; ') : ''}`);
  if (ok < Math.ceil(seeds * 0.8)) fails++;
}
console.log(fails ? `\n${fails} centre(s) below 80% success` : '\nall centres plan tests');
process.exit(fails ? 1 : 0);
