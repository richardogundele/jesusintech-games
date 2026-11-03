#!/usr/bin/env node
// Does every test route in Driving City stay inside its own area? The ring roads round the outside of
// each area (city-merge.mjs outerRoads) are faster than the town streets just inside the edge, and a
// route between two parts near the edge could leave the area along one. test-routes.js and
// lesson-routes.js keep routes off them; this plans each area's generated tests (and Herne Bay's
// hand-made pool) and says how far outside its box any route goes.
//
//   node tools/city-routes-check.mjs [--seeds 1-6]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { autoPool } from '../src/kent/auto-pool.js';
import { generateTest, shiftedPool } from '../src/kent/test-routes.js';
import { REGIONS } from './regions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), i = argv.indexOf('--seeds');
const [s0, s1] = (i >= 0 ? argv[i + 1] : '1-6').split('-').map(Number);
const net = new RoadNet(JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/city/region.json'), 'utf8')));
let bad = 0;
for (const a of net.data.areas) {
  const tc = net.testCentres.find((t) => t.area === a.id);
  const pool = a.id === 'kent' ? shiftedPool('herne', [a.x, a.z], { key: 'kent', world: 'city', tc }) : autoPool(net, tc, { key: a.id, world: 'city', bounds: a.box, timeK: REGIONS[a.id]?.timeK });
  const out = [];
  for (let s = s0; s <= (s1 || s0); s++) {
    let gen; try { gen = generateTest(net, pool, s); } catch (e) { out.push(`#${s} no route`); continue; }
    const b = a.box;
    const worst = Math.max(0, ...gen.route.pts.map((p) => Math.max(b.minX - p.x, p.x - b.maxX, b.minZ - p.z, p.z - b.maxZ)));
    const outer = new Set(gen.route.pts.map((p) => net.ways.get(p.way)).filter((w) => w?.outer).map((w) => w.name));
    if (worst > 0 || outer.size) { bad++; out.push(`#${s} OUTSIDE by ${worst.toFixed(0)} m${outer.size ? ` on ${[...outer].join(', ')}` : ''}`); }
    else out.push(`#${s} in (${(gen.route.length / 1000).toFixed(2)} km)`);
  }
  console.log(`${a.name.padEnd(11)} ${out.join('  ')}`);
}
console.log(bad ? `${bad} route(s) leave their area` : 'every route stays in its area');
process.exit(bad ? 1 : 0);
