#!/usr/bin/env node
// The whole-city mock: a drive from one town's test centre to a neighbour's, over the link road
// between them. city-routes-check.mjs asserts the opposite for an ordinary test (it must stay in
// its area), so this one is its mirror: every route here SHOULD leave its area, by exactly one
// link road, and arrive in the town it was aimed at.
//
// It plans, it does not drive. One of them is driven by
//   node tools/lesson-check.mjs --gen auto --region city --centre whole:guildford:kent --gseeds 1-2
//
//   node tools/whole-city-check.mjs [--seeds 1-3] [--window 26,42]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { wholeCityPool } from '../src/kent/auto-pool.js';
import { generateTest } from '../src/kent/test-routes.js';
import { CITY } from './driving-city.mjs';
import { REGIONS } from './regions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const [s0, s1] = arg('--seeds', '1-3').split('-').map(Number);
const WINDOW = arg('--window', '26,42').split(',').map(Number);

const net = new RoadNet(JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/city/region.json'), 'utf8')));
const areaOf = (id) => net.data.areas.find((a) => a.id === id);
const tcOf = (id) => net.testCentres.find((t) => t.area === id);

let planned = 0, failed = 0, wrong = 0;
const mins = [];
for (const l of CITY.links) {
  const A = areaOf(l.a), B = areaOf(l.b);
  if (!A || !B) continue;
  const pool = wholeCityPool(net, tcOf(l.a), tcOf(l.b), {
    idA: l.a, idB: l.b, boundsA: A.box, boundsB: B.box, timeK: REGIONS[l.a]?.timeK,
    nameA: A.name, nameB: B.name, window: WINDOW,
  });
  const out = [];
  for (let s = s0; s <= (s1 || s0); s++) {
    let gen;
    try { gen = generateTest(net, pool, s); } catch (e) {
      const why = /\(last: (.*)\)$/.exec(String(e.message))?.[1] || String(e.message);
      out.push(`#${s} none [${why.slice(0, 60)}]`); failed++; continue;
    }
    planned++; mins.push(gen.meta.minutes);
    // it must start in A and finish in B: that is the whole point of this route
    const p0 = gen.route.pts[0], pN = gen.route.pts[gen.route.pts.length - 1];
    const inBox = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
    const okEnds = inBox(p0, A.box) && inBox(pN, B.box);
    if (!okEnds) wrong++;
    out.push(`#${s} ${(gen.route.length / 1000).toFixed(1)}km ${gen.meta.minutes}min${okEnds ? '' : ' WRONG ENDS'}`);
  }
  console.log(`${`${A.name} -> ${B.name}`.padEnd(30)} ${out.join('   ')}`);
}
if (mins.length) {
  mins.sort((a, b) => a - b);
  console.log(`\n${planned} planned, ${failed} with no route, ${wrong} starting or ending in the wrong town`);
  console.log(`minutes: ${mins[0].toFixed(1)} shortest, ${mins[mins.length - 1].toFixed(1)} longest, ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)} average`);
} else console.log('nothing planned');
process.exit(wrong || !planned ? 1 : 0);
