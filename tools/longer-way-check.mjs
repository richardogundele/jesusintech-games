#!/usr/bin/env node
// Can a test in Driving City that is running early be taken a longer way round? lessons.js watchClock
// asks test-routes.js longerWay for one when, in its last five minutes, the examiner expects the test
// to end before 14: the route as it stands from a point ahead of the car, with one more estate
// junction to go round.
// This asks it where watchClock would, on the stretch after the last pull-up of each area's tests
// (seeds 1-6, at the start, the middle and the end of that stretch), for a minute and a half more.
//
//   node tools/longer-way-check.mjs [area,area...] [--add 1.5] [--seeds 1-6] [-v]
//
// Every longer way it returns is checked again from outside: it must begin along the old route's
// line, be a fair line to drive (routeShape), add what was asked for within the band, and end where
// the test ends. Not every place has one -- a stretch of dual carriageway has no side street to take,
// and the last 300 m before a centre often has none that comes back -- and the test then just ends when
// it ends, so "none" is not a failure. The check fails if a way it returns breaks a rule, or if fewer
// than half the places asked have one: the search has then stopped finding what the streets offer
// (it finds one at about four places in five).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { autoPool } from '../src/kent/auto-pool.js';
import { generateTest, shiftedPool, estimateMinutes, longerWay, routeShape, sameLine } from '../src/kent/test-routes.js';
import { KENT_AREAS, idxAtS } from '../src/kent/lesson-routes.js';
import { REGIONS } from './regions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const only = argv[0] && !argv[0].startsWith('-') ? argv[0].split(',') : null, aim = +opt('add', 1.5), verbose = argv.includes('-v');
const [s0, s1] = opt('seeds', '1-6').split('-').map(Number);
const net = new RoadNet(JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/city/region.json'), 'utf8')));
// as lessons.js has them: where an event's own business ends, and a place with nothing going on at it
const endOf = (e) => (e.kind === 'rb' ? e.exitS + 8 : e.kind === 'diverge' ? e.s + 110 : e.kind === 'stop' ? e.s + 30 : e.kind === 'pullright' ? e.stopS + 40 : (e.lineS ?? e.s) + 12);
const clearAt = (route, at) => { const p = route.pts[idxAtS(route.pts, at)]; return !p.rb && !p.man && !p.park && !route.events.some((e) => Math.max(endOf(e), e.exitS ?? 0, e.endS ?? 0) > at - 8 && Math.min(e.s, e.lineS ?? e.s, e.entryS ?? e.s) < at + 30); };
let asked = 0, found = 0, bad = 0, ms = 0;
for (const a of net.data.areas) {
  if (only && !only.includes(a.id)) continue;
  const tc = net.testCentres.find((t) => t.area === a.id);
  const pool = KENT_AREAS[a.id] ? shiftedPool(KENT_AREAS[a.id], [a.x, a.z], { key: a.id, world: 'city', tc }) : autoPool(net, tc, { key: a.id, world: 'city', bounds: a.box, timeK: REGIONS[a.id]?.timeK });
  const row = [];
  for (let seed = s0; seed <= (s1 || s0); seed++) {
    let gen; try { gen = generateTest(net, pool, seed); } catch { row.push(`#${seed} no route`); continue; }
    const { route, spec, meta } = gen, K = meta.timeK, L = route.length;
    const sLast = Math.max(0, ...route.events.filter((e) => e.kind === 'stop' || e.kind === 'pullright').map(endOf));
    const viaS = route.viaXZ.map((P) => { let best = 0, bd = Infinity; for (const q of route.pts) { const d = (q.x - P.x) ** 2 + (q.z - P.z) ** 2; if (d < bd) { bd = d; best = q.s; } } return best; });
    const out = [];
    for (const f of [0, 0.5, 1]) {
      // the first clear place at or after this point of the stretch, as watchClock looks 80 m ahead of the car
      let at = sLast + 80 + f * Math.max(0, L - 320 - (sLast + 80)), ok = false;
      for (let k = 0; k < 20 && at < L - 150; k++, at += 15) if (clearAt(route, at)) { ok = true; break; }
      if (!ok) { out.push('-'); continue; }
      asked++;
      const vias = spec.vias.filter((v, i) => viaS[i] > at + 10), add = [aim - 0.8, aim, aim + 1];
      const t0 = performance.now();
      const w = longerWay(net, route, spec, { at, vias, add, timeK: K, box: a.box, seed, keepLast: Math.min(meta.lastVias || 0, vias.length) });
      ms += performance.now() - t0;
      if (!w.r) { out.push(w.why === 'line' ? 'line' : 'none'); continue; }
      found++;
      // the rules again, from outside
      const why = [];
      const added = estimateMinutes(w.r, 0, true) * K - estimateMinutes(route, w.at) * K;
      if (Math.abs(added - w.added) > 0.01 || added < add[0] - 1e-9 || added > add[2] + 1e-9) why.push(`adds ${added.toFixed(2)} min, said ${w.added.toFixed(2)}, asked ${add[0].toFixed(1)}-${add[2].toFixed(1)}`);
      if (!sameLine(route.pts, w.at, w.r)) why.push('begins off the old line');
      why.push(...routeShape(net, w.r));
      const endA = route.pts[route.pts.length - 1], endB = w.r.pts[w.r.pts.length - 1];
      // (the same place, or the other kerb of the same road: a test may come back to its centre from either side)
      if (spec.end !== 'baypark' && Math.hypot(endA.x - endB.x, endA.z - endB.z) > 9) why.push(`ends ${Math.hypot(endA.x - endB.x, endA.z - endB.z).toFixed(0)} m from where the test ends`);
      if (!w.vias.includes(w.via) || vias.some((v) => !w.vias.includes(v))) why.push('lost a via');
      if (why.length) { bad++; console.log(`FAIL ${a.id}#${seed} at ${Math.round(w.at)} m via ${w.via}: ${why.join('; ')}`); }
      out.push(`+${w.added.toFixed(1)}${why.length ? '!' : ''}`);
      if (verbose) { const n = net.nodes.get(w.via), names = [...new Set(n.ways.map((r) => r.way.name).filter(Boolean))]; console.log(`   ${a.id}#${seed} at ${Math.round(w.at)} of ${Math.round(L)} m: +${w.added.toFixed(2)} min, ${Math.round(w.r.length - (L - w.at))} m more, round ${names.join(' / ') || `node ${w.via}`}`); }
    }
    row.push(`#${seed} ${out.join(' ')}`);
  }
  console.log(`${a.name.padEnd(13)} ${row.join('   ')}`);
}
const share = asked ? found / asked : 0;
console.log(`${found} of ${asked} places have a longer way (${Math.round(share * 100)}%), ${(ms / Math.max(1, asked)).toFixed(0)} ms a search${bad ? `; ${bad} BREAK A RULE` : ''}`);
if (!bad && share < 0.5) console.log('FAIL: fewer than half the places asked have a longer way');
process.exit(bad || share < 0.5 ? 1 : 0);
