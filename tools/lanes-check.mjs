#!/usr/bin/env node
// Lane-count and connectivity sanity for a baked region.json. Exits 1 on any FAIL.
//
//   node tools/lanes-check.mjs [public/assets/kent/region.json] [--verbose]
//
// Connectivity: one component over the way graph; every dead end is a map edge, a gate, or a
// minor-road cul-de-sac (an A/B/tertiary road ending mid-map is reported); no two dead ends from
// different ways within 1.5 m of another road without sharing a node.
// Lanes: no residential/service/living street with more than two lanes in total; no ring with more
// lanes than its widest approach unless OSM tagged it; no way over 10 m wide carrying 1+1 lanes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), verbose = args.includes('--verbose');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(REPO, 'public/assets/kent/region.json'));
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const ways = R.ways, nodes = R.nodes;
let fails = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => { fails++; console.log(`  FAIL  ${msg}`); };
const warn = (msg) => console.log(`  warn  ${msg}`);

console.log(`${path.relative(REPO, file)}: ${ways.length} ways, ${Object.keys(nodes).length} nodes, ${R.roundabouts.length} roundabouts`);

// ---------- connectivity ----------
const parent = new Map(), find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
for (const id of Object.keys(nodes)) parent.set(+id, +id);
for (const w of ways) { const ns = w.nodes.filter(Boolean); for (let i = 1; i < ns.length; i++) parent.set(find(ns[i]), find(ns[0])); }
const comps = new Set([...parent.keys()].map(find));
if (comps.size === 1) ok('one connected component'); else fail(`${comps.size} connected components (every road should reach every other)`);

// Touching is not enough. Respecting the one-ways, every road must be drivable to AND from every
// other: one strongly connected component. Undirected alone passed a road you could drive into and
// never out of, which strands a learner or a traffic car for the rest of the test. city-merge.mjs
// drops and trims those; the towns' own region.json files are raw crops and still hold some.
{
  const fwd = new Map(), rev = new Map(), seen = new Set();
  const edge = (a, b) => { if (!fwd.has(a)) fwd.set(a, []); fwd.get(a).push(b); if (!rev.has(b)) rev.set(b, []); rev.get(b).push(a); };
  for (const w of ways) {
    const ns = w.nodes.filter(Boolean);
    for (const n of ns) seen.add(n);
    for (let i = 1; i < ns.length; i++) { edge(ns[i - 1], ns[i]); if (!w.oneway) edge(ns[i], ns[i - 1]); }
  }
  const order = [], vis = new Set();
  for (const s of seen) {
    if (vis.has(s)) continue;
    const st = [[s, 0]]; vis.add(s);
    while (st.length) {
      const t = st[st.length - 1], nb = fwd.get(t[0]) || [];
      if (t[1] < nb.length) { const n = nb[t[1]++]; if (!vis.has(n)) { vis.add(n); st.push([n, 0]); } }
      else { order.push(t[0]); st.pop(); }
    }
  }
  const comp = new Map();
  for (let i = order.length - 1, c = 0; i >= 0; i--) {
    const s = order[i]; if (comp.has(s)) continue;
    const st = [s]; comp.set(s, c);
    while (st.length) { const v = st.pop(); for (const n of rev.get(v) || []) if (!comp.has(n)) { comp.set(n, c); st.push(n); } }
    c++;
  }
  const size = new Map();
  for (const n of seen) size.set(comp.get(n), (size.get(comp.get(n)) || 0) + 1);
  const sccs = [...size.entries()].sort((a, b) => b[1] - a[1]);
  // Only the merged city is played (vite.config.js ships 'city' alone); a town's own region.json is
  // an input to tools/city-merge.mjs, which is where the crop and these drops happen. So this is a
  // failure for the merged world and a warning for a town on its own.
  const merged = Array.isArray(R.areas) && R.areas.length > 1;
  if (sccs.length === 1) ok(`one strongly connected component: every road drivable to and from every other (${seen.size} nodes)`);
  else {
    const stray = [...seen].filter((n) => comp.get(n) !== sccs[0][0]);
    const trap = stray.filter((n) => (rev.get(n) || []).some((p) => comp.get(p) === sccs[0][0]) && !(fwd.get(n) || []).some((p) => comp.get(p) === sccs[0][0]));
    const where = (n) => `(${nodes[n].x}, ${nodes[n].z})`;
    const msg = `${sccs.length} strongly connected components: ${stray.length} node(s) cannot be driven to and from the rest, ${trap.length} of them a one-way trap you cannot leave${trap.length ? ' -- ' + trap.slice(0, 5).map(where).join(', ') : ''}`;
    if (merged) fail(msg); else warn(`${msg} (a town on its own; city-merge.mjs drops these when it builds Driving City)`);
  }
}

const arms = new Map(); // node -> number of way-ends/throughs touching it
for (const w of ways) w.nodes.forEach((n, i) => { if (n) arms.set(n, (arms.get(n) || 0) + (i > 0 && i < w.nodes.length - 1 ? 2 : 1)); });
const MINOR = new Set(['residential', 'service', 'unclassified', 'living_street', 'track']);
const wayOf = new Map(); for (const w of ways) for (const n of w.nodes) if (n) { if (!wayOf.has(n)) wayOf.set(n, []); wayOf.get(n).push(w); }
const ends = [...arms.entries()].filter(([, a]) => a === 1).map(([n]) => n);
const edgeEnds = ends.filter((n) => nodes[n].edge), gateEnds = ends.filter((n) => wayOf.get(n).some((w) => w.id >= 9000000000));
const suspicious = ends.filter((n) => !nodes[n].edge && !wayOf.get(n).some((w) => w.id >= 9000000000) && wayOf.get(n).every((w) => !MINOR.has(w.cls)));
console.log(`  dead ends ${ends.length}: ${edgeEnds.length} map edge, ${gateEnds.length} gates, ${ends.length - edgeEnds.length - gateEnds.length - suspicious.length} minor-road culs-de-sac`);
if (suspicious.length) warn(`${suspicious.length} A/B/tertiary road(s) end mid-map: ` + suspicious.map((n) => `${wayOf.get(n)[0].name || wayOf.get(n)[0].cls} (${nodes[n].x}, ${nodes[n].z})`).join('; ')); else ok('every dead end is a map edge, a gate or a minor-road cul-de-sac');

// near-miss: a dead end within 1.5 m of another way's segment, not sharing a node with it
const CELL = 20, grid = new Map(), key = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
ways.forEach((w, wi) => { for (let i = 0; i < w.pts.length - 1; i++) { const a = w.pts[i], b = w.pts[i + 1]; for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / CELL); gz <= Math.floor(Math.max(a[1], b[1]) / CELL); gz++) { const k = `${gx}:${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([wi, i]); } } });
const near = [];
for (const n of ends) {
  if (nodes[n].edge) continue;
  // A way the dead end's own way ALREADY shares a node with is not a connectivity gap: the two are
  // joined at that node and the tip merely curls back near its neighbour. Warrington has two --
  // Liberty Close and Kinross Close are each a pair of parking-court spurs off one close, joined at
  // the root, tips 1.50 m and 0.43 m apart pointing 180 and 108 degrees AWAY from the gap.
  // snapLooseEnds declines them by this same rule (region-data.mjs:250), so flagging them asked the
  // baker for a join that would add nothing but a degenerate loop.
  const q0 = [nodes[n].x, nodes[n].z], own = new Set(wayOf.get(n).map((w) => w.id));
  const ownNodes = new Set(wayOf.get(n).flatMap((w) => w.nodes).filter(Boolean));
  let best = null;
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const [wi, i] of grid.get(key(q0[0] + gx * CELL, q0[1] + gz * CELL)) || []) {
    const o = ways[wi]; if (own.has(o.id)) continue;
    if (o.nodes.some((m) => m && ownNodes.has(m))) continue;
    const a = o.pts[i], b = o.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((q0[0] - a[0]) * dx + (q0[1] - a[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - q0[0], a[1] + dz * t - q0[1]);
    if (d <= 1.5 && (!best || d < best.d)) best = { o, d };
  }
  if (best) near.push(`${wayOf.get(n)[0].name || wayOf.get(n)[0].cls} ends ${best.d.toFixed(2)} m from ${best.o.name || best.o.cls} at (${q0[0]}, ${q0[1]})`);
}
if (near.length) fail(`${near.length} dead end(s) within 1.5 m of another road but not joined: ` + near.slice(0, 6).join('; ')); else ok('no unjoined near-miss dead ends (1.5 m)');

// ---------- lanes ----------
const fat = ways.filter((w) => ['residential', 'service', 'living_street'].includes(w.cls) && w.lanesF + w.lanesB > 2);
const fatGuess = fat.filter((w) => w.lanesSrc !== 'tag'), fatTagged = fat.filter((w) => w.lanesSrc === 'tag');
if (fatGuess.length) fail(`${fatGuess.length} residential/service way(s) GUESSED at more than two lanes: ` + fatGuess.slice(0, 6).map((w) => `${w.name || w.id} ${w.lanesF}+${w.lanesB}`).join('; ')); else ok('no residential or service road is guessed at more than 1+1 lanes');
if (fatTagged.length) warn(`${fatTagged.length} residential/service way(s) OSM-tagged with more than two lanes (kept as tagged): ` + fatTagged.slice(0, 6).map((w) => `${w.name || w.id} ${w.lanesF}+${w.lanesB}`).join('; '));
const wide = ways.filter((w) => !w.oneway && !w.rb && w.width >= 10 && w.lanesF + w.lanesB <= 2);
if (wide.length) warn(`${wide.length} two-way way(s) 10 m+ wide but 1+1 lanes (width and lanes disagree): ` + wide.slice(0, 5).map((w) => `${w.name || w.id} ${w.width} m`).join('; ')); else ok('width and lane count agree on every two-way road');
const inflated = R.roundabouts.filter((rb) => rb.lanesSrc !== 'tag' && rb.lanes > Math.max(1, ...rb.arms.map((a) => a.entryLanes || 0)));
if (inflated.length) fail(`${inflated.length} untagged ring(s) with more lanes than any approach: ` + inflated.map((rb) => `${rb.name} ${rb.lanes} lanes, widest approach ${Math.max(...rb.arms.map((a) => a.entryLanes || 0))}`).join('; ')); else ok('no untagged roundabout has more lanes than its widest approach');
for (const rb of R.roundabouts) for (const a of rb.arms) {
  // an approach way whose own lane count is below the arm's: the renderer and examiner now clamp,
  // but say so when it happens so the bake can be looked at
  for (const id of a.entryWays || []) { const w = ways.find((x) => x.id === id); if (w && !w.oneway && Math.max(w.lanesF, w.lanesB) < a.entryLanes && verbose) warn(`${rb.name}: arm ${a.bearing}° says ${a.entryLanes} lanes but ${w.name || w.id} has ${w.lanesF}+${w.lanesB}`); }
}
const derived = ways.filter((w) => w.lanesSrc === 'derived' && ['trunk', 'primary', 'secondary'].includes(w.cls));
if (derived.length) warn(`${derived.length} trunk/primary/secondary way(s) with no OSM lanes tag (assumed 1 each way)`);

console.log(fails ? `\n${fails} FAIL` : '\nall checks passed');
process.exit(fails ? 1 : 0);
