#!/usr/bin/env node
// Checks src/kent/net.js against public/assets/kent/region.json: nearest() accuracy, the Herne Bay
// to Canterbury test-centre route, a lane path along it, roundabout exit decisions at the junctions
// the test routes use, speed limits at known spots, and the driving lessons' lane paths (no U-turns,
// rings driven round, never more than 0.5 m off the carriageway). Exits 1 if anything fails.
//
//   node tools/net-check.mjs [path/to/region.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, 'public/assets/kent/region.json');
const t0 = Date.now();
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const net = new RoadNet(data);
console.log(`region.json ${(fs.statSync(file).size / 1e6).toFixed(2)} MB, net built in ${Date.now() - t0} ms: ${net.ways.size} ways, ${net.nodes.size} nodes, ${net.links.length} links, ${net.roundabouts.size} roundabouts`);

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
// deterministic pseudo-random so a failure can be reproduced
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ---------- 1. nearest() on 1,000 random on-road points ----------
{
  const ways = [...net.ways.values()].filter((w) => w.len > 8);
  let bad = 0, worst = 0, wrongWay = 0; const tn = Date.now();
  for (let i = 0; i < 1000; i++) {
    const w = ways[Math.floor(rnd() * ways.length)], s = 3 + rnd() * (w.len - 6);
    const p = net.pointAt(w, s), d = net.dirAt(w, s), off = rnd() * 0.3;
    const x = p[0] + d[1] * off, z = p[1] - d[0] * off; // a little to the left of the centreline
    const h = net.nearest(x, z);
    if (!h || h.dist > 0.5) { bad++; worst = Math.max(worst, h ? h.dist : 99); continue; }
    if (h.way !== w && Math.hypot(h.px - p[0], h.pz - p[1]) > 0.5) wrongWay++; // another way may share the spot (junction patches, overlaps)
    worst = Math.max(worst, h.dist);
  }
  check(bad === 0 && wrongWay === 0, `nearest(): 1000 random on-road points, ${bad} with dist >= 0.5 m, ${wrongWay} on the wrong way, worst ${worst.toFixed(3)} m, ${Date.now() - tn} ms`);
}

// ---------- 2. the Herne Bay -> Canterbury test-centre route ----------
const HB = { x: 3383, z: -4779 }, CT = { x: -808, z: 5032 };
let route = null, lp = null;
{
  const tr = Date.now();
  route = net.route(HB, CT);
  const km = route ? route.length / 1000 : 0;
  const names = []; if (route) for (const r of route.ways) { const n = [r.way.ref, r.way.name].filter(Boolean).join(' ') || r.way.cls; if (names[names.length - 1] !== n) names.push(n); }
  console.log(`route Herne Bay TC -> Canterbury TC: ${route ? km.toFixed(2) + ' km, ' + route.ways.length + ' legs, ' + route.nodes.length + ' nodes' : 'none'} (${Date.now() - tr} ms)`);
  console.log('  roads: ' + names.join(' > '));
  const viaA291 = names.some((n) => /A291/.test(n)) && names.some((n) => /A28\b/.test(n));
  const viaA299 = names.some((n) => /A299/.test(n)) && names.some((n) => /A28\b/.test(n));
  check(!!route && km >= 12 && km <= 18, `route exists and is 12-18 km (${km.toFixed(2)} km)`);
  check(viaA291 || viaA299, `route uses the A291/A28 or A299/A28 (${viaA291 ? 'A291/A28' : viaA299 ? 'A299/A28' : 'neither'})`);
  const back = net.route(CT, HB);
  check(!!back && back.length / 1000 >= 12 && back.length / 1000 <= 18, `return route exists and is 12-18 km (${back ? (back.length / 1000).toFixed(2) : '-'} km)`);
}

// ---------- 3. lanePath along it ----------
if (route) {
  const tl = Date.now();
  lp = net.lanePath(route, { end: 'pullup' });
  let mono = true, nan = false, gap = 0;
  for (let i = 0; i < lp.pts.length; i++) {
    const p = lp.pts[i]; if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.s)) nan = true;
    if (i) { if (p.s <= lp.pts[i - 1].s) mono = false; gap = Math.max(gap, Math.hypot(p.x - lp.pts[i - 1].x, p.z - lp.pts[i - 1].z)); }
  }
  console.log(`lanePath: ${lp.pts.length} points, ${lp.length.toFixed(1)} m, ${lp.events.length} events, max gap ${gap.toFixed(2)} m, start heading ${(lp.start.heading * 180 / Math.PI).toFixed(0)} deg (${Date.now() - tl} ms)`);
  check(mono, 'lanePath s is strictly monotonic');
  check(!nan, 'lanePath has no NaN');
  check(gap <= 2, `lanePath consecutive points <= 2 m apart (max ${gap.toFixed(2)})`);
  check(Math.abs(lp.length - route.length) < route.length * 0.08, `lanePath length within 8% of the route length (${lp.length.toFixed(0)} vs ${route.length.toFixed(0)})`);
  const kinds = new Set(lp.events.map((e) => e.kind));
  check(lp.events.some((e) => e.kind === 'rb'), `events include roundabouts (kinds: ${[...kinds].join(', ')})`);
  check(lp.events.every((e) => Number.isFinite(e.s)), 'every event has a finite s');
  console.log('  first 20 events:');
  for (const e of lp.events.slice(0, 20)) console.log(`    ${e.s.toFixed(0).padStart(6)} m ${e.kind.padEnd(10)} ${e.dir ? e.dir.padEnd(5) : '     '} ${e.exit != null ? 'exit ' + e.exit + ' lanes ' + e.approachLane + '/' + e.ringLane + '/' + e.exitLane + ' ' : ''}${e.lineS != null ? 'line ' + e.lineS.toFixed(0) + ' ' : ''}${e.group ? e.group + ' ' : ''}${e.text || ''}`);
  // every point carries the road descriptor the marker reads
  check(lp.pts.every((p) => p.road && Number.isFinite(p.road.limit) && Number.isFinite(p.road.lanes)), 'every path point has road { lanes, limit }');
  check(lp.pts.some((p) => p.rb), 'some path points are on a ring (pt.rb set)');
}

// ---------- 4. roundabout exit decisions ----------
{
  const want = [
    ['Eddington C (A291 / The Links / Herne Relief Rd / A299 link)', 'rb-176864791'], ['Eddington B (A291 / A2990 / A299 slips)', 'rb-176864790'], ['Eddington A (A291 / B2205 / A299 off-slip)', 'rb-4549121'],
    ['Greenhill (A2990 / B2205 / Greenhill Rd)', 'rb-176864793'], ['Margate Road interchange, north', 'rb-4547886'], ["St George's (Canterbury)", 'rb-192954700'],
  ];
  for (const [label, id] of want) {
    const rb = net.roundabouts.get(id);
    if (!rb) { check(false, `${label}: ${id} missing`); continue; }
    console.log(`\n${label}: ${rb.name} r ${rb.r} lanes ${rb.lanes} (${rb.lanesSrc}) island ${rb.island} sense ${rb.sense} limit ${rb.limit} arms ${rb.arms.length}`);
    for (const a of rb.arms) console.log(`  arm ${String(a.bearing).padStart(5)}°  ${a.entry ? 'in ' : '   '}${a.exit ? 'out' : '   '} lanes ${a.entryLanes}/${a.exitLanes}  ${[a.refs.join('/'), a.names.join(' | ')].filter(Boolean).join(' ')}  -> ${a.dest}`);
    let ok = true;
    const nExits = rb.arms.filter((a) => a.exit).length;
    for (const inArm of rb.arms.filter((a) => a.entry)) {
      const row = [];
      for (const outArm of rb.arms.filter((a) => a.exit)) {
        const d = net.rbExitIndex(rb, inArm, outArm);
        row.push(`${outArm.bearing}°: ${d.exit}${d.dir === 'left' ? 'L' : d.dir === 'right' ? 'R' : 'A'} ${d.approachLane}/${d.ringLane}/${d.exitLane}`);
        if (!(d.exit >= 1 && d.exit <= nExits) || !['left', 'none', 'right'].includes(d.dir) || d.approachLane < 1 || d.approachLane > Math.max(1, inArm.entryLanes) || d.ringLane < 1 || d.ringLane > rb.lanes || d.exitLane < 1 || d.exitLane > Math.max(1, outArm.exitLanes)) ok = false;
        // a left turn never wants the right-hand lane; a right turn on a 2-lane entry wants it
        if (d.dir === 'left' && d.approachLane > 1 && inArm.entryLanes <= 2) ok = false;
        if (d.dir === 'right' && inArm.entryLanes === 2 && d.approachLane !== 2) ok = false;
      }
      // exit numbers must increase in circulation order
      const seq = net.rbArmsFrom(rb, inArm).filter((a) => a.exit).map((a) => net.rbExitIndex(rb, inArm, a).exit);
      if (seq.some((v, i) => i && v !== seq[i - 1] + 1)) ok = false;
      console.log(`  from ${String(inArm.bearing).padStart(5)}° (${inArm.entryLanes} lane${inArm.entryLanes === 1 ? '' : 's'}): ${row.join(' | ')}`);
    }
    check(ok, `${label}: exit numbers 1..${nExits} in order, dirs sane, lanes within bounds`);
  }
}

// ---------- 5. speed limits ----------
{
  const mid = (w) => net.pointAt(w, w.len / 2);
  const a299 = [...net.ways.values()].find((w) => w.ref === 'A299' && w.cls === 'trunk' && w.oneway && !w.link && w.len > 300);
  const mick = [...net.ways.values()].find((w) => w.name === 'Mickleburgh Hill');
  const grid = [...net.ways.values()].find((w) => ['William Street', 'Mortimer Street', 'Beach Street', 'Gordon Road'].includes(w.name) && w.limit === 20) || [...net.ways.values()].find((w) => w.cls === 'residential' && w.limit === 20 && net.placeOf(w.pts[0][0], w.pts[0][1])?.name === 'Herne Bay');
  for (const [label, w, lim, nsl] of [['A299 Thanet Way', a299, 70, true], ['Mickleburgh Hill', mick, 30, false], [`Herne Bay town grid (${grid?.name})`, grid, 20, false]]) {
    if (!w) { check(false, `${label}: way not found`); continue; }
    const p = mid(w), got = net.limitAt(p[0], p[1]), gotNsl = net.nslAt(p[0], p[1]);
    check(got === lim && gotNsl === nsl, `limitAt ${label}: ${got} mph nsl ${gotNsl} (want ${lim}, ${nsl}); placeAt = "${net.placeAt(p[0], p[1])}"`);
  }
  const rb = net.roundabouts.get('rb-176864793');
  if (rb) check(net.rbAt(rb.x + rb.r - 1, rb.z) === rb && net.limitAt(rb.x + rb.r - 1, rb.z) === rb.limit, `rbAt/limitAt on the Greenhill ring: ${rb.limit} mph`);
  check(net.placeAt(net.home.x, net.home.z).length > 0, `placeAt(home) = "${net.placeAt(net.home.x, net.home.z)}"; placeAt(airfield) = "${net.placeAt(net.airfield.x, net.airfield.z)}"`);
}

// ---------- 6. destinations and a short town route ----------
{
  const rb = net.roundabouts.get('rb-176864793');
  if (rb) { const a = rb.arms.find((x) => x.refs.includes('A2990') && x.bearing < 180); if (a) { const node = net.nodes.get(a.exitNode), way = net.ways.get(a.exitWays[0]), arm = node.arms().find((x) => x.way === way); console.log(`destinations(Greenhill, A2990 east) = ${JSON.stringify(net.destinations(node.id, arm))}`); } }
  const short = net.route({ x: 1839, z: -5880 }, { x: 3383, z: -4779 }); // Clock Tower to the test centre
  check(!!short && short.length < 6000, `town route Clock Tower -> test centre: ${short ? (short.length / 1000).toFixed(2) + ' km' : 'none'}`);
  if (short) { const p = net.lanePath(short); check(p.pts.length > 100 && p.events.length > 2, `its lanePath: ${p.pts.length} pts, ${p.events.length} events: ${p.events.map((e) => e.kind).join(',')}`); }
}

// ---------- 7. the synthetic access roads, home and airfield, landuse ----------
{
  check(data.home.x === 4150 && data.home.z === -5920 && data.airfield.x === 3870 && data.airfield.z === -2326, `home (${data.home.x}, ${data.home.z}) and airfield (${data.airfield.x}, ${data.airfield.z}) match DESIGN.md`);
  const drive = net.nearest(4150, -5878, 10), jet = net.nearest(3750, -2276, 10);
  check(!!drive && drive.way.name === 'Home Drive' && drive.dist < 0.5, `nearest(home gate) is Home Drive (${drive ? drive.way.name + ' ' + drive.dist.toFixed(2) + ' m' : 'none'})`);
  check(!!jet && jet.way.name === 'Jet Centre Road' && jet.dist < 0.5, `nearest(airfield gate) is Jet Centre Road (${jet ? jet.way.name + ' ' + jet.dist.toFixed(2) + ' m' : 'none'})`);
  const r = net.route({ x: 4150, z: -5880 }, { x: 3752, z: -2277 });
  check(!!r && r.length > 4000 && r.length < 12000, `route home gate -> jet centre gate: ${r ? (r.length / 1000).toFixed(2) + ' km' : 'none'}`);
  if (r) {
    const p = net.lanePath(r); let mono = true, gap = 0;
    for (let i = 1; i < p.pts.length; i++) { if (p.pts[i].s <= p.pts[i - 1].s) mono = false; gap = Math.max(gap, Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].z - p.pts[i - 1].z)); }
    check(mono && gap <= 2 && p.pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.z)), `its lanePath is monotonic, gap <= 2 m (${gap.toFixed(2)}), finite; starts on ${net.ways.get(p.pts[0].way).name}, ends on ${net.ways.get(p.pts[p.pts.length - 1].way).name}; events: ${p.events.map((e) => e.kind).join(',')}`);
  }
  check((data.landuse || []).length > 0, `landuse has ${(data.landuse || []).length} polygons`);
  check((data.landmarks || []).some((l) => l.brand), `landmarks carry brand (${data.landmarks.filter((l) => l.brand).length} with brand)`);
}

// ---------- 8. the driving lesson routes (src/kent/lesson-routes.js) ----------
{
  const { buildKentRoute, KENT_ROUTES } = await import('../src/kent/lesson-routes.js');
  const seg = (ax, az, bx, bz, x, z) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; let t = L2 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
  // how far a point is outside every carriageway near it (ring carriageways are the annulus island..r)
  const excess = (x, z) => {
    let best = Infinity;
    for (const { way, i } of net.grid.near(x, z, 25)) {
      if (way.rb) { const rb = net.roundabouts.get(way.rb), R = Math.hypot(x - rb.x, z - rb.z); best = Math.min(best, R > rb.r ? R - rb.r : R < rb.island ? rb.island - R : 0); continue; }
      const a = way.pts[i], b = way.pts[i + 1]; best = Math.min(best, seg(a[0], a[1], b[0], b[1], x, z) - way.halfW);
    }
    return best;
  };
  let sd = 5; const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  for (const [id, spec] of Object.entries(KENT_ROUTES)) {
    let r = null; try { r = buildKentRoute(net, { ...spec, id }, { rnd }); } catch (e) { check(false, `lesson ${id}: ${e.message}`); continue; }
    const uturns = r.route.ways.filter((w, k) => k && w.way === r.route.ways[k - 1].way && w.dir !== r.route.ways[k - 1].dir).length;
    let island = 0, off = 0, worst = 0;
    for (const p of r.pts) {
      if (p.man || p.park) continue; // pull-ups and the car park leave the lane on purpose
      if (p.rb) { const rb = net.roundabouts.get(p.rb), R = Math.hypot(p.x - rb.x, p.z - rb.z); if (R < rb.island - 0.3) island++; continue; }
      const e = excess(p.x, p.z); if (e > 0.5) { off++; worst = Math.max(worst, e); }
    }
    const kinds = {}; for (const e of r.events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    check(uturns === 0 && island === 0 && off === 0, `lesson ${id}: ${(r.length / 1000).toFixed(2)} km, ${uturns} U-turns, ${island} points over a ring's island, ${off} points > 0.5 m off the carriageway${off ? ` (worst ${worst.toFixed(2)} m)` : ''}; ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }
}

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
