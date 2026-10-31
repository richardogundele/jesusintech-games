#!/usr/bin/env node
// Applies the bake-time corrections to an EXISTING region.json when the raw OSM extract is not to
// hand for a full rebake (Kent's is not kept in the repo):
//   - an untagged roundabout gets exactly as many lanes as its widest approach (LANE_RULE in
//     kent-data.mjs / region-data.mjs), and its ring ways follow;
//   - a dead end within 1.5 m of another road is joined to it (snapLooseEnds in the bake tools);
//   - the unnamed service roads that are the only tarmac between two streets are laid in from
//     tools/kent-service-links.json, because the fetch tool drops every unnamed service way.
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
const nodes = R.nodes;
let nextId = Math.max(...Object.keys(nodes).map(Number)) + 1;
const CELL = 20, key = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
const newNode = (x, z) => { const id = nextId++; nodes[id] = { x: r1(x), z: r1(z), ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false }; return id; };

/** an index of every baked carriageway segment, rebuilt whenever the ways change */
function segGrid() {
  const g = new Map();
  R.ways.forEach((w, wi) => { for (let i = 0; i < w.pts.length - 1; i++) { const a = w.pts[i], b = w.pts[i + 1]; for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / CELL); gz <= Math.floor(Math.max(a[1], b[1]) / CELL); gz++) { const k = `${gx}:${gz}`; if (!g.has(k)) g.set(k, []); g.get(k).push([wi, i]); } } });
  return g;
}
/** the nearest point on another road within `reach` metres of (x, z), as {w, i, t, q, d} */
function nearestRoad(grid, x, z, reach, skip) {
  let best = null; const G = Math.ceil(reach / CELL);
  for (let gx = -G; gx <= G; gx++) for (let gz = -G; gz <= G; gz++) for (const [wi, i] of grid.get(key(x + gx * CELL, z + gz * CELL)) || []) {
    const w = R.ways[wi]; if (w === skip) continue;
    const a = w.pts[i], b = w.pts[i + 1]; if (!a || !b) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(q[0] - x, q[1] - z);
    if (d < reach && (!best || d < best.d)) best = { w, i, t, q, d };
  }
  return best;
}
/** the node id where `hit` meets the road, splitting that road at the foot of the perpendicular */
function nodeOnRoad(hit) {
  const { w, i, t, q } = hit;
  const take = (j) => { let id = w.nodes[j]; if (!id) { id = newNode(w.pts[j][0], w.pts[j][1]); w.nodes[j] = id; nodes[id].ways.push(w.id); } return id; };
  if (t < 0.02 || Math.hypot(q[0] - w.pts[i][0], q[1] - w.pts[i][1]) < 1.5) return take(i);
  if (t > 0.98 || Math.hypot(q[0] - w.pts[i + 1][0], q[1] - w.pts[i + 1][1]) < 1.5) return take(i + 1);
  const id = newNode(q[0], q[1]);
  w.pts.splice(i + 1, 0, [r1(q[0]), r1(q[1])]);
  w.nodes.splice(i + 1, 0, id);
  nodes[id].ways.push(w.id);
  return id;
}

// ---------- the unnamed service roads that link two streets ----------
// tools/osm-fetch.mjs throws away every unnamed service way, so the back lanes that are the only
// tarmac between two streets were never in the extract this map was baked from. tools/service-links.mjs
// picks them back out of OpenStreetMap and commits them; this lays them in. Kent cannot be rebaked
// (tools/kent-data.mjs wants a coastline and sea polygon no fetch tool in the repo still produces),
// so this is where the fix lives.
const LINKS = path.join(REPO, 'tools/kent-service-links.json');
if (fs.existsSync(LINKS)) {
  const L = JSON.parse(fs.readFileSync(LINKS, 'utf8'));
  const sameMap = Math.abs(L.origin.lat0 - R.origin.lat0) < 1e-9 && Math.abs(L.origin.lon0 - R.origin.lon0) < 1e-9;
  if (!sameMap) notes.push(`${path.basename(LINKS)} is for another map (origin ${L.origin.lat0}, ${L.origin.lon0}); service links not applied`);
  else {
    const have = new Set(R.ways.map((w) => w.id)); // way ids in region.json ARE the OSM way ids
    const nodeFor = new Map(); // osm node id -> region node id, so two pieces share their junction
    let laid = 0, km = 0;
    for (const p of L.pieces) {
      const id = p.id ?? p.osm[0];
      if (have.has(id)) continue; // already laid: a second run has nothing to do
      const grid = segGrid();
      const ids = [], pts = [];
      for (let i = 0; i < p.nodes.length; i++) {
        const osmN = p.nodes[i], end = i === 0 || i === p.nodes.length - 1;
        if (nodeFor.has(osmN)) { const n = nodeFor.get(osmN); ids.push(n); pts.push([nodes[n].x, nodes[n].z]); continue; }
        // an end sits on a street: join it there, splitting that street at the exact point so the
        // two really share a node. Anything else is a shape point of the new lane.
        const hit = end ? nearestRoad(grid, p.pts[i][0], p.pts[i][1], 8) : null;
        const n = hit ? nodeOnRoad(hit) : newNode(p.pts[i][0], p.pts[i][1]);
        nodeFor.set(osmN, n);
        ids.push(n); pts.push([nodes[n].x, nodes[n].z]);
      }
      // the bake's own reading of a service way's tags (tools/kent-data.mjs section 1)
      const pave = p.sidewalk ? p.sidewalk !== 'no' : p.lit === 'yes';
      const lanesF = 1, lanesB = p.oneway ? 0 : 1;
      R.ways.push({
        id, name: null, ref: null, cls: 'service', limit: p.limitTag ?? 20, nsl: false, oneway: !!p.oneway,
        lanesF, lanesB, lanesSrc: 'derived', rb: null, dual: false, link: false,
        bridge: !!p.bridge, tunnel: !!p.tunnel, layer: p.layer || 0,
        width: r1(p.oneway ? lanesF * 3.65 : 5.0), pave, rural: !pave, turnLanes: null,
        pts: pts.map((q) => [r1(q[0]), r1(q[1])]), nodes: ids,
      });
      for (const n of new Set(ids)) if (!nodes[n].ways.includes(id)) nodes[n].ways.push(id);
      have.add(id);
      laid++; km += p.len / 1000;
      notes.push(`service link ${id}: ${p.len} m of ${p.ends.filter(Boolean).join(' to ') || 'back lane'}`);
    }
    if (laid) notes.push(`${laid} of ${L.pieces.length} service links laid in (${km.toFixed(2)} km; OSM of ${L.osm_base})`);
  }
}

/** which way the road is heading as it reaches a dead end, from its last few metres */
function outDir(w, end) {
  const p = w.pts, n = p.length;
  const a = end === 0 ? p[Math.min(2, n - 1)] : p[Math.max(0, n - 3)], b = end === 0 ? p[0] : p[n - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

/**
 * Join every dead end that `accept(gap, angle, sameName)` calls a slip rather than a cul-de-sac,
 * looking out to `reach` metres. `angle` is between the road's heading at the dead end and the
 * direction of the road it would join, so a close that merely passes close to its neighbours can
 * be told from a street that aims straight at one and stops short.
 */
function joinLooseEnds(reach, accept) {
  const arms = new Map(), wayOf = new Map();
  for (const w of R.ways) w.nodes.forEach((n, i) => { if (!n) return; arms.set(n, (arms.get(n) || 0) + (i > 0 && i < w.nodes.length - 1 ? 2 : 1)); if (!wayOf.has(n)) wayOf.set(n, []); wayOf.get(n).push(w); });
  const grid = new Map();
  R.ways.forEach((w, wi) => { for (let i = 0; i < w.pts.length - 1; i++) { const a = w.pts[i], b = w.pts[i + 1]; for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / CELL); gz <= Math.floor(Math.max(a[1], b[1]) / CELL); gz++) { const k = `${gx}:${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([wi, i]); } } });
  const G = Math.ceil(reach / CELL);
  let joined = 0;
  for (const [n, a] of arms) {
    if (a !== 1 || !nodes[n] || nodes[n].edge) continue;
    const w = wayOf.get(n)[0], end = w.nodes[0] === n ? 0 : w.nodes.length - 1;
    if (w.id >= 9000000000) continue; // gates
    const q0 = [nodes[n].x, nodes[n].z], u = outDir(w, end);
    let best = null;
    for (let gx = -G; gx <= G; gx++) for (let gz = -G; gz <= G; gz++) for (const [wi, i] of grid.get(key(q0[0] + gx * CELL, q0[1] + gz * CELL)) || []) {
      const o = R.ways[wi]; if (o === w) continue;
      // nothing opens onto a slip road, a ring or a dual carriageway out of nowhere, and a way
      // these two already share a node with is the far side of a join just made, not a new one
      if (o.link || o.dual || o.rb || o.cls === 'motorway' || o.cls === 'trunk') continue;
      if (o.nodes.some((m) => m && w.nodes.includes(m))) continue;
      const pa = o.pts[i], pb = o.pts[i + 1]; if (!pa || !pb) continue;
      const dx = pb[0] - pa[0], dz = pb[1] - pa[1], L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((q0[0] - pa[0]) * dx + (q0[1] - pa[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const q = [pa[0] + dx * t, pa[1] + dz * t], d = Math.hypot(q[0] - q0[0], q[1] - q0[1]);
      if (d > reach || (best && d >= best.d)) continue;
      const L = d || 1e-9, ang = (Math.acos(Math.max(-1, Math.min(1, (u[0] * (q[0] - q0[0]) + u[1] * (q[1] - q0[1])) / L))) * 180) / Math.PI;
      if (accept(d, ang, !!w.name && o.name === w.name)) best = { o, i, t, q, d, ang };
    }
    if (!best) continue;
    const { o, i, t, q } = best;
    let id, pt;
    const adopt = (j) => { id = o.nodes[j]; if (!id) { id = nextId++; o.nodes[j] = id; nodes[id] = { x: o.pts[j][0], z: o.pts[j][1], ways: [o.id] }; } return [...o.pts[j]]; };
    if (t < 0.02 || Math.hypot(q[0] - o.pts[i][0], q[1] - o.pts[i][1]) < 1.5) pt = adopt(i);
    else if (t > 0.98 || Math.hypot(q[0] - o.pts[i + 1][0], q[1] - o.pts[i + 1][1]) < 1.5) pt = adopt(i + 1);
    else { id = nextId++; const p = [r1(q[0]), r1(q[1])]; o.pts.splice(i + 1, 0, p); o.nodes.splice(i + 1, 0, id); nodes[id] = { x: p[0], z: p[1], ways: [o.id] }; pt = [...p]; }
    if (best.d <= 1.5) { w.pts[end] = pt; w.nodes[end] = id; delete nodes[n]; } // a slip: the end just moves onto the other road
    else {
      // a real missing length of road: lay it in as new carriageway rather than stretching the
      // last segment, with shape points every few metres as the rest of the bake has
      const steps = Math.max(1, Math.round(best.d / 4)), add = [], addN = [];
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        add.push(k === steps ? pt : [r1(q0[0] + (pt[0] - q0[0]) * f), r1(q0[1] + (pt[1] - q0[1]) * f)]);
        addN.push(k === steps ? id : null);
      }
      if (end === 0) { w.pts.unshift(...add.reverse()); w.nodes.unshift(...addN.reverse()); }
      else { w.pts.push(...add); w.nodes.push(...addN); }
    }
    if (!nodes[id].ways.includes(w.id)) nodes[id].ways.push(w.id);
    joined++;
    notes.push(`joined ${w.name || w.cls} to ${o.name || o.cls} at (${r1(q[0])}, ${r1(q[1])}), ${best.d.toFixed(2)} m at ${best.ang.toFixed(0)} deg`);
  }
  return joined;
}

// A dead end within a digitiser's slip of another road, whichever way it faces, then one that aims
// straight at a road it stops short of. The angle does the work: a close whose tip happens to sit
// 20 m from its own other arm is a real cul-de-sac and faces sideways, while a street cut in two
// aims at its other half. Two halves of one street reach further than two different streets do.
// Closing one gap can bring the next dead end within reach, so run to convergence; that is what
// keeps a second run of this tool with nothing to do.
let snapped = 0;
for (let pass = 0; pass < 8; pass++) {
  const n = joinLooseEnds(1.5, (d) => d <= 1.5)
    + joinLooseEnds(25, (d, ang, same) => (same ? ang < 30 && d <= 25 : ang < 40 && d <= 12));
  snapped += n;
  if (!n) break;
}

fs.writeFileSync(file, JSON.stringify(R));
console.log(`${path.relative(REPO, file)}: ${notes.length ? notes.join('\n  ') : 'nothing to change'}`);
