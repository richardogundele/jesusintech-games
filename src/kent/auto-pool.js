// A test-route pool for ANY test centre, read off the road network instead of written by hand.
//
// Kent's two pools in test-routes.js were authored: an examiner's-eye list of the big road, the
// estates and the way home, every via a hand-picked node, then swept with the autopilot. That does
// not scale to 350 centres. This builds the same shape of pool from the map around a centre:
//   mains  the big-road parts: two junction nodes 350-900 m apart on a dual carriageway or 40+ road,
//          and the entry/exit of every multi-lane roundabout (validateRoute demands one of each)
//   loops  the estates: residential junctions clustered on a 350 m grid, each cell an estate the
//          router picks a junction inside, so one estate drives differently from test to test
// generateTest then assembles, routes, lane-paths and validates exactly as it does for Kent, so a
// route here passes the same fairness checks (two roundabouts, left and right turns, emerging, a
// crossing or lights, 14-16 minutes) or is rejected. Pure data and maths: node runs it
// (tools/testgen-check.mjs).

import { testCentreLayout } from './lesson-routes.js';

const BIG = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const ESTATE = new Set(['residential', 'unclassified', 'living_street', 'tertiary']);

/**
 * autoPool(net, tc, { key, world, radius }) -> a pool generateTest accepts in place of a POOLS key.
 * tc: the test centre { name, x, z } (net.testCentres[0] for a city region).
 */
export function autoPool(net, tc, { key = 'auto', world = null, radius = 2200 } = {}) {
  const layout = testCentreLayout(net, tc);
  const hit = layout.hit;
  if (!hit) throw new Error(`${tc.name}: no road within 120 m of the test centre`);
  const near = (x, z) => Math.hypot(x - tc.x, z - tc.z) <= radius;
  const nodeOf = (id) => net.nodes.get(id);

  // ---- where the test starts and ends: on the centre's road, pulled up just along from it ----
  const start = { x: hit.px, z: hit.pz };
  const w0 = hit.way, ahead = w0.len - hit.s > hit.s ? 1 : -1; // the longer way along the road
  const sPull = Math.max(8, Math.min(w0.len - 8, hit.s + ahead * 55));
  const pp = net.pointAt(w0, sPull);
  const pullUpAt = { x: pp[0], z: pp[1] };

  // ---- mains: the big roads ----
  const mains = {};
  const groups = new Map(); // road name/ref -> ways
  for (const w of net.ways.values()) {
    if (!BIG.has(w.cls) || w.rb || w.link) continue;
    if (!(w.dual || w.limit >= 40)) continue;
    if (!w.pts.some((p) => near(p[0], p[1]))) continue;
    const k = w.ref || w.name; if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  let mi = 0;
  for (const [name, ways] of groups) {
    // the junction nodes on this road, in a line; take the pair 350-900 m apart nearest the centre
    const nodes = [];
    for (const w of ways) w.nodes.forEach((id, i) => { const n = id && nodeOf(id); if (n && n.kind === 'junction' && !n.rb && near(n.x, n.z)) nodes.push({ id, x: n.x, z: n.z, s: w.cum[i], w }); });
    if (nodes.length < 2) continue;
    let best = null;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const A = nodes[a], Bn = nodes[b], d = Math.hypot(A.x - Bn.x, A.z - Bn.z);
      if (d < 350 || d > 900) continue;
      const dc = Math.hypot((A.x + Bn.x) / 2 - tc.x, (A.z + Bn.z) / 2 - tc.z);
      if (!best || dc < best.dc) best = { a: A.id, b: Bn.id, dc };
    }
    if (!best) continue;
    mains[`main${mi++}`] = { name: `the ${name}`, vias: [best.a, best.b], rev: true };
    if (mi >= 8) break;
  }
  // every multi-lane roundabout: in by one arm, out by another (the router drives the ring between)
  for (const rb of net.roundabouts.values()) {
    if ((rb.lanes || 1) < 2 || !near(rb.x, rb.z)) continue;
    const ins = rb.arms.filter((a) => a.entry && nodeOf(a.node)), outs = rb.arms.filter((a) => a.exit && nodeOf(a.exitNode ?? a.node));
    if (ins.length < 2 || outs.length < 2) continue;
    // pick an entry and an exit that are not the same arm, roughly across the ring
    const a = ins[0], b = outs.find((o) => (o.exitNode ?? o.node) !== a.node && Math.abs(((o.bearing - a.bearing + 540) % 360) - 180) < 110) || outs.find((o) => (o.exitNode ?? o.node) !== a.node);
    if (!b) continue;
    mains[`rb${mi++}`] = { name: `the ${rb.name || 'roundabout'}`, vias: [a.node, b.exitNode ?? b.node], kind: 'ring' };
  }

  // ---- loops: the estates, residential junctions on a 350 m grid ----
  const CELL = 350;
  const cells = new Map();
  for (const n of net.nodes.values()) {
    if (n.kind !== 'junction' || n.rb || !near(n.x, n.z)) continue;
    if (Math.hypot(n.x - tc.x, n.z - tc.z) < 120) continue; // not the centre's own doorstep
    const ws = n.ways.map((r) => r.way);
    if (ws.length < 2 || !ws.every((w) => ESTATE.has(w.cls) && !w.rb && !w.link)) continue;
    if (ws.filter((w) => w.cls === 'tertiary').length === ws.length) continue; // a tertiary-only junction is a main road, not an estate
    if (n.arms().filter((a) => a.legal).length < 3) continue; // a real junction, not a bend
    const k = `${Math.floor((n.x - tc.x) / CELL)},${Math.floor((n.z - tc.z) / CELL)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push({ id: n.id, x: n.x, z: n.z, names: ws.map((w) => w.name).filter(Boolean) });
  }
  const loops = {};
  const cellList = [...cells.entries()].filter(([, v]) => v.length >= 3)
    .map(([k, v]) => ({ k, v, d: Math.hypot(v.reduce((s, q) => s + q.x, 0) / v.length - tc.x, v.reduce((s, q) => s + q.z, 0) / v.length - tc.z) }))
    .sort((a, b) => a.d - b.d).slice(0, 24);
  cellList.forEach(({ k, v }, i) => {
    const names = [...new Set(v.flatMap((q) => q.names))].slice(0, 3);
    const pick = v.sort((a, b) => Math.hypot(a.x - tc.x, a.z - tc.z) - Math.hypot(b.x - tc.x, b.z - tc.z)).slice(0, 8).map((q) => q.id);
    loops[`est${i}`] = { name: names.length ? names.join(', ') : `estate ${i + 1}`, pick, area: k };
  });

  const multiLaneRbs = Object.keys(mains).filter((k) => k.startsWith('rb')).length;
  return {
    key, world, tc, auto: true,
    // no multi-lane ring in reach: judge the route on its lights instead (DT1: roundabouts where available)
    relaxRb: multiLaneRbs === 0,
    name: (tc.name || 'the test centre').replace(/\s*\(.*\)\s*$/, ''),
    start, pullUpAt, bay: !!layout.lot, first: [], last: [], avoid: [],
    mains, loops, homes: {},
    timeK: 1.0, quick: [1.0, 0.03, 2.4], window: [13.8, 16.2],
    stats: { mains: Object.keys(mains).length, loops: Object.keys(loops).length, multiLaneRbs },
  };
}
