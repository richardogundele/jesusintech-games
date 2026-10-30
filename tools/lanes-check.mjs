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
  const q0 = [nodes[n].x, nodes[n].z], own = new Set(wayOf.get(n).map((w) => w.id));
  let best = null;
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const [wi, i] of grid.get(key(q0[0] + gx * CELL, q0[1] + gz * CELL)) || []) {
    const o = ways[wi]; if (own.has(o.id)) continue;
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
