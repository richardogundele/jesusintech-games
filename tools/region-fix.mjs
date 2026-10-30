#!/usr/bin/env node
// Applies the bake-time corrections to an EXISTING region.json when the raw OSM extract is not to
// hand for a full rebake (Kent's is not kept in the repo):
//   - an untagged roundabout gets exactly as many lanes as its widest approach (LANE_RULE in
//     kent-data.mjs / region-data.mjs), and its ring ways follow;
//   - a dead end within 1.5 m of another road is joined to it (snapLooseEnds in the bake tools).
// Idempotent. Writes the file in place.
//
//   node tools/region-fix.mjs [public/assets/kent/region.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(REPO, 'public/assets/kent/region.json'));
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const r1 = (v) => Math.round(v * 10) / 10;
const notes = [];

// ---------- roundabout lanes ----------
const wayById = new Map(R.ways.map((w) => [w.id, w]));
for (const rb of R.roundabouts) {
  if (rb.lanesSrc === 'tag') continue;
  // the same LANE_RULE as the bake tools: a small ring (r < 10) is one lane whatever feeds it
  const lanes = rb.r < 10 ? 1 : Math.max(1, Math.min(3, Math.max(0, ...rb.arms.map((a) => a.entryLanes || 0))));
  if (lanes === rb.lanes) continue;
  notes.push(`${rb.name}: ${rb.lanes} -> ${lanes} lanes (r ${rb.r} m, widest approach ${Math.max(0, ...rb.arms.map((a) => a.entryLanes || 0))})`);
  rb.lanes = lanes;
  rb.island = r1(Math.max(1.5, rb.r - lanes * rb.laneW));
  for (const id of rb.ringWays) { const w = wayById.get(id); if (w) { w.lanesF = lanes; w.width = r1(lanes * rb.laneW); } }
}

// ---------- loose ends ----------
const nodes = R.nodes, arms = new Map(), wayOf = new Map();
for (const w of R.ways) w.nodes.forEach((n, i) => { if (!n) return; arms.set(n, (arms.get(n) || 0) + (i > 0 && i < w.nodes.length - 1 ? 2 : 1)); if (!wayOf.has(n)) wayOf.set(n, []); wayOf.get(n).push(w); });
let nextId = Math.max(...Object.keys(nodes).map(Number)) + 1;
const CELL = 20, grid = new Map(), key = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
R.ways.forEach((w, wi) => { for (let i = 0; i < w.pts.length - 1; i++) { const a = w.pts[i], b = w.pts[i + 1]; for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / CELL); gz <= Math.floor(Math.max(a[1], b[1]) / CELL); gz++) { const k = `${gx}:${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([wi, i]); } } });
let snapped = 0;
for (const [n, a] of arms) {
  if (a !== 1 || nodes[n].edge) continue;
  const w = wayOf.get(n)[0], end = w.nodes[0] === n ? 0 : w.nodes.length - 1;
  if (w.id >= 9000000000) continue; // gates
  const q0 = [nodes[n].x, nodes[n].z];
  let best = null;
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const [wi, i] of grid.get(key(q0[0] + gx * CELL, q0[1] + gz * CELL)) || []) {
    const o = R.ways[wi]; if (o === w) continue;
    const pa = o.pts[i], pb = o.pts[i + 1], dx = pb[0] - pa[0], dz = pb[1] - pa[1], L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((q0[0] - pa[0]) * dx + (q0[1] - pa[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [pa[0] + dx * t, pa[1] + dz * t], d = Math.hypot(q[0] - q0[0], q[1] - q0[1]);
    if (d <= 1.5 && (!best || d < best.d)) best = { o, i, t, q, d };
  }
  if (!best) continue;
  const { o, i, t, q } = best;
  let id;
  const adopt = (j) => { id = o.nodes[j]; if (!id) { id = nextId++; o.nodes[j] = id; nodes[id] = { x: o.pts[j][0], z: o.pts[j][1], ways: [o.id] }; } w.pts[end] = [...o.pts[j]]; };
  if (t < 0.02 || Math.hypot(q[0] - o.pts[i][0], q[1] - o.pts[i][1]) < 1.5) adopt(i);
  else if (t > 0.98 || Math.hypot(q[0] - o.pts[i + 1][0], q[1] - o.pts[i + 1][1]) < 1.5) adopt(i + 1);
  else { id = nextId++; const pt = [r1(q[0]), r1(q[1])]; o.pts.splice(i + 1, 0, pt); o.nodes.splice(i + 1, 0, id); nodes[id] = { x: pt[0], z: pt[1], ways: [o.id] }; w.pts[end] = [...pt]; }
  // the dead end's node moves onto the other road: the old node is now unused
  w.nodes[end] = id;
  if (!nodes[id].ways.includes(w.id)) nodes[id].ways.push(w.id);
  if (!wayOf.get(n).some((x) => x !== w)) delete nodes[n];
  snapped++;
  notes.push(`joined ${w.name || w.cls} to ${o.name || o.cls} at (${r1(q[0])}, ${r1(q[1])}), ${best.d.toFixed(2)} m`);
}

fs.writeFileSync(file, JSON.stringify(R));
console.log(`${path.relative(REPO, file)}: ${notes.length ? notes.join('\n  ') : 'nothing to change'}`);
