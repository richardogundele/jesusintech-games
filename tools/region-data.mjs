#!/usr/bin/env node
// Builds public/assets/<region>/region.json for a real-map city (tools/regions.mjs) from the
// OpenStreetMap extract tools/osm-fetch.mjs wrote. The same bake as tools/kent-data.mjs (same
// node ids, rings, crossings, buildings, landuse) without Kent's house, coast and hand-listed places.
// Never touches the network.
//
//   node tools/region-data.mjs <region> [--osm scratch/osm/<region>] [--out public/assets/<region>] [--check]
//
// The jet centre stands on empty land south of the fetched streets (the bounds extend 1.1 km past
// them), joined to the nearest real road by a synthetic 'Jet Centre Road'.
// Built-ins only. Data is ODbL: ATTRIBUTION.txt goes next to the output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { REGIONS, originOf } from './regions.mjs';

// ---------- arguments ----------
const argv = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; } else pos.push(a); }
const R = REGIONS[pos[0]];
if (!R) { console.error(`usage: node tools/region-data.mjs <${Object.keys(REGIONS).join('|')}> [--osm dir] [--out dir] [--check]`); process.exit(2); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
opt.osm = opt.osm || path.join(REPO, 'scratch/osm', R.id);
const OUT = path.resolve(opt.out || path.join(REPO, 'public/assets', R.id));
const CHECK = !!opt.check;

const ORIGIN = originOf(R);
// the streets fill the fetched square (clipped 20 m in so every edge way ends cleanly); the land
// runs 1.1 km further south for the jet centre
const B = { minX: -R.half + 20, maxX: R.half - 20, minZ: -R.half + 20, maxZ: R.half + 1100 };
const HOME = null, AIRFIELD = { x: 0, z: R.half + 1000 };
const JET_GATE = [AIRFIELD.x - 120, AIRFIELD.z + 50], JET_JOIN = [AIRFIELD.x - 120, R.half - 80]; // Jet Centre Road: the gate to the nearest real road
const AIRFIELD_RECT = { minX: AIRFIELD.x - 230, maxX: AIRFIELD.x + 45, minZ: AIRFIELD.z - 920, maxZ: AIRFIELD.z + 50 }; // fenced field: no OSM buildings inside
const ATTR = '© OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright';

// ---------- small helpers ----------
const r1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const project = (lat, lon) => [(lon - ORIGIN.lon0) * ORIGIN.mPerDegLon, -(lat - ORIGIN.lat0) * ORIGIN.mPerDegLat];
const inBounds = (p) => p[0] >= B.minX && p[0] <= B.maxX && p[1] >= B.minZ && p[1] <= B.maxZ;
const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
const norm180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
const uniq = (a) => [...new Set(a.filter((v) => v != null && v !== ''))];
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const warn = [];

/** Liang-Barsky: the [t0,t1] part of segment a-b inside the bounds, or null */
function clipSeg(a, b) {
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - B.minX], [dx, B.maxX - a[0]], [-dz, a[1] - B.minZ], [dz, B.maxZ - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}
let edgeSeq = 0;
/** cut a polyline (with parallel node ids) into the pieces inside the bounds; cut ends get 'e<n>' node ids */
function clipLine(pts, nodes) {
  const pieces = []; let cur = null;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const close = () => { if (cur && cur.pts.length >= 2) pieces.push(cur); cur = null; };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], r = clipSeg(a, b);
    if (!r) { close(); continue; }
    const [t0, t1] = r;
    if (t0 > 1e-9 || !cur) { close(); cur = { pts: [], nodes: [], cutStart: t0 > 1e-9 }; if (t0 > 1e-9) { cur.pts.push(lerp(a, b, t0)); cur.nodes.push('e' + ++edgeSeq); } else { cur.pts.push(a); cur.nodes.push(nodes ? nodes[i] : 0); } }
    if (t1 < 1 - 1e-9) { cur.pts.push(lerp(a, b, t1)); cur.nodes.push('e' + ++edgeSeq); close(); }
    else { cur.pts.push(b); cur.nodes.push(nodes ? nodes[i + 1] : 0); }
  }
  close();
  return pieces;
}
/** Douglas-Peucker that never drops the indices in `keep` */
function simplify(pts, tol, keep) {
  const out = new Set([0, pts.length - 1, ...keep]);
  const dp = (i0, i1) => {
    if (i1 - i0 < 2) return;
    const a = pts[i0], b = pts[i1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    let best = -1, bestD = 0;
    for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / L; if (d > bestD) { bestD = d; best = i; } }
    if (bestD > tol) { out.add(best); dp(i0, best); dp(best, i1); }
  };
  const ks = [...out].sort((a, b) => a - b);
  for (let k = 0; k < ks.length - 1; k++) dp(ks[k], ks[k + 1]);
  return [...out].sort((a, b) => a - b);
}
/** Douglas-Peucker on a closed ring: anchor on the two points farthest apart so the ends never coincide */
function simplifyRing(pts, tol) {
  let far = 1, best = -1; for (let i = 1; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > best) { best = d; far = i; } }
  const keep = simplify(pts, tol, [far]);
  const tail = simplify([...pts.slice(far), pts[0]], tol, []).slice(1, -1).map((i) => i + far); // close the ring through pts[0]
  return [...new Set([...keep.filter((i) => i <= far), ...tail])].sort((a, b) => a - b);
}
/** split segments longer than maxSeg where the line bends at either end (> 3 degrees) */
function densify(pts, nodes, maxSeg = 12) {
  const turn = (i) => { if (i <= 0 || i >= pts.length - 1) return 0; const a = pts[i - 1], b = pts[i], c = pts[i + 1]; return Math.abs(norm180(bearingOf(c[0] - b[0], c[1] - b[1]) - bearingOf(b[0] - a[0], b[1] - a[1]))); };
  const P = [], N = [];
  for (let i = 0; i < pts.length - 1; i++) {
    P.push(pts[i]); N.push(nodes[i]);
    const L = dist(pts[i], pts[i + 1]);
    if (L > maxSeg && (turn(i) > 3 || turn(i + 1) > 3)) {
      const n = Math.ceil(L / maxSeg);
      for (let k = 1; k < n; k++) { const t = k / n; P.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]); N.push(0); }
    }
  }
  P.push(pts[pts.length - 1]); N.push(nodes[nodes.length - 1]);
  return [P, N];
}
/** Sutherland-Hodgman clip of a polygon to the bounds */
function clipPoly(poly) {
  let out = poly.slice();
  const edges = [[(p) => p[0] >= B.minX, (a, b) => { const t = (B.minX - a[0]) / (b[0] - a[0]); return [B.minX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= B.maxX, (a, b) => { const t = (B.maxX - a[0]) / (b[0] - a[0]); return [B.maxX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= B.minZ, (a, b) => { const t = (B.minZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, B.minZ]; }],
    [(p) => p[1] <= B.maxZ, (a, b) => { const t = (B.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, B.maxZ]; }]];
  for (const [inside, cross] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
const shoelace = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function centroid(pts) {
  const A = shoelace(pts); if (Math.abs(A) < 1e-6) { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
  let cx = 0, cz = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1]; cx += (a[0] + b[0]) * f; cz += (a[1] + b[1]) * f; }
  return [cx / (6 * A), cz / (6 * A)];
}
class UF { constructor() { this.p = new Map(); } find(a) { let r = a; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r); let c = a; while (this.p.has(c) && this.p.get(c) !== r) { const n = this.p.get(c); this.p.set(c, r); c = n; } if (!this.p.has(a)) this.p.set(a, r); return r; } union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); } }

// ---------- load ----------
const osm = path.resolve(opt.osm);
const roads = load(path.join(osm, 'roads.json')), rbsIn = load(path.join(osm, 'roundabouts.json')).roundabouts, feat = load(path.join(osm, 'features.json'));
const routes = opt.routes ? load(path.resolve(opt.routes)) : null;
const landmarksRaw = fs.existsSync(path.join(osm, 'raw/q3_landmarks.json')) ? load(path.join(osm, 'raw/q3_landmarks.json')).elements : [];
const bFiles = fs.existsSync(path.join(osm, 'raw')) ? fs.readdirSync(path.join(osm, 'raw')).filter((f) => /^q4.*buildings.*\.json$/.test(f)).map((f) => path.join(osm, 'raw', f)) : [];
if (!bFiles.length && fs.existsSync(path.join(osm, 'buildings.json'))) bFiles.push(path.join(osm, 'buildings.json'));
if (!bFiles.length) warn.push('no buildings file found (raw/q4*buildings*.json or buildings.json): buildings = []');

// ---------- 1. ways: filter, clip, piece ids ----------
const WIDTH = (w, limit, lanesF, lanesB) => {
  if (w.width_m) return w.width_m;
  if (w.oneway) return Math.max(1, lanesF) * 3.65;
  const total = lanesF + lanesB;
  if (total > 2) return total * 3.65;
  switch (w.class) {
    case 'residential': return limit <= 20 ? 6.0 : 6.5;
    case 'living_street': case 'service': return 5.0;
    case 'unclassified': return 6.0;
    case 'tertiary': return 6.5;
    default: return 7.3;
  }
};
const pieces = [];
for (const w of roads.ways) {
  if (w.class === 'service' && !w.name) continue;
  const parts = clipLine(w.pts, w.nodes);
  parts.forEach((part, k) => {
    const limitTag = w.maxspeed_mph && w.maxspeed_src === 'tag' ? w.maxspeed_mph : null;
    const lanesF = w.oneway ? Math.max(1, w.lanes_fwd || 1) : Math.max(1, w.lanes_fwd || 1), lanesB = w.oneway ? 0 : Math.max(1, w.lanes_bwd || 1);
    let pave;
    if (w.sidewalk) pave = w.sidewalk !== 'no';
    else if (w.lit === 'yes') pave = true; else if (w.lit === 'no') pave = false;
    else pave = ['residential', 'living_street'].includes(w.class) || (limitTag != null && limitTag <= 30 && w.class !== 'trunk');
    // Default limit when OSM posts none. A service road is a close, a driveway or a car park aisle:
    // it is never 60, and guessing 60 let you do 55 down a cul-de-sac with the examiner silent.
    const slow = w.class === 'service' || w.class === 'living_street';
    const limit = limitTag ?? (slow ? 20 : pave ? 30 : 60);
    // The NSL sign replaces the number on the HUD, so it must never contradict it: a road only
    // carries the national speed limit if the limit we actually use IS the national one. Tied to
    // `limit` rather than the tags, the sign and the roundel can never disagree.
    const nsl = (!!w.nsl || (limitTag == null && !pave && !slow)) && !slow && limit >= 60;
    let turnLanes = null;
    if (w.turn_lanes && (w.turn_lanes.all || w.turn_lanes.fwd)) turnLanes = (w.turn_lanes.all || w.turn_lanes.fwd).split('|').map((l) => l.split(';').map((t) => t.replace('slight_', '').replace('sharp_', '')));
    pieces.push({
      id: k === 0 ? w.id : -(w.id * 10 + k), osm: w.id, name: w.name || null, ref: w.ref || null, cls: w.class, limit, nsl, oneway: !!w.oneway || !!w.roundabout,
      lanesF, lanesB, lanesSrc: ['tag', 'half', 'oneway'].includes(w.lanes_src) ? 'tag' : 'derived', rb: null, dual: !!w.dual, link: !!w.link || /_link$/.test(w.class),
      bridge: !!w.bridge, tunnel: !!w.tunnel, layer: w.layer || 0, width: r1(WIDTH(w, limit, lanesF, lanesB)), pave, rural: !pave, turnLanes, surface: w.surface || null,
      pts: part.pts, nodes: part.nodes, roundabout: !!w.roundabout, limitTag, rawLen: 0,
    });
  });
}
// Synthetic access roads the world needs but OSM does not have: the house drive and the jet centre
// road. Each joins an existing way at a new node (the way is split there so the graph connects).
const synthNotes = [];
function addSynthetic(id, name, gate, join) {
  let best = null;
  for (const p of pieces) for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i], b = p.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((join[0] - a[0]) * dx + (join[1] - a[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + dx * t, a[1] + dz * t], d = dist(q, join);
    if (!best || d < best.d) best = { p, i, t, q, d };
  }
  if (!best || best.d > 1500) { warn.push(`${name}: no road within 1500 m of (${join}) to join; not added`); return; }
  if (best.d > 40) warn.push(`${name}: the requested join point (${join}) is ${Math.round(best.d)} m from the nearest road (${best.p.name || best.p.cls}); joined there instead`);
  const { p, i, t, q } = best;
  let joinId;
  if (t < 0.02 || dist(q, p.pts[i]) < 1.5) joinId = p.nodes[i];
  else if (t > 0.98 || dist(q, p.pts[i + 1]) < 1.5) joinId = p.nodes[i + 1];
  else { joinId = 'j' + id; p.pts.splice(i + 1, 0, [r1(q[0]), r1(q[1])]); p.nodes.splice(i + 1, 0, joinId); }
  pieces.push({ id, osm: null, name, ref: null, cls: 'service', limit: 20, nsl: false, oneway: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived', rb: null, dual: false, link: false,
    bridge: false, tunnel: false, layer: 0, width: 5.0, pave: false, rural: false, turnLanes: null, pts: [[r1(gate[0]), r1(gate[1])], [r1(q[0]), r1(q[1])]], nodes: ['g' + id, joinId], roundabout: false, limitTag: 20, rawLen: dist(gate, q), synthetic: true });
  synthNotes.push(`${name} (way ${id}): ${Math.round(dist(gate, q))} m from (${gate}) to ${p.name || p.cls} at (${r1(q[0])}, ${r1(q[1])}), ${best.d.toFixed(1)} m from the requested join point`);
}
addSynthetic(9000000002, 'Jet Centre Road', JET_GATE, JET_JOIN);
// ring membership from roundabouts.json (rings are one-way by definition)
const ringOf = new Map();
for (const rb of rbsIn) if (!rb.mini) for (const id of rb.ways) ringOf.set(id, rb.id);
for (const p of pieces) if (ringOf.has(p.osm)) { p.rb = ringOf.get(p.osm); p.oneway = true; }

// ---------- 2. graph nodes: shared, ends, tagged ----------
const tagSignals = new Set(feat.signals.map((s) => s.id)), tagGive = new Set(feat.give_ways.map((s) => s.id)), tagStop = new Set(feat.stops.map((s) => s.id));
const tagMini = new Set(feat.mini_roundabouts.map((s) => s.id)), tagLC = new Set(feat.level_crossings.filter((c) => c.type === 'level_crossing').map((c) => c.id));
const CROSS_TYPE = (c) => {
  const ref = (c.crossing_ref || '').split(';')[0];
  if (ref === 'zebra' || ref === 'tiger' || c.crossing === 'zebra' || c.type === 'zebra') return 'zebra';
  if (['pelican', 'puffin', 'toucan'].includes(ref)) return ref;
  if (c.type === 'signals' || c.crossing === 'traffic_signals') return 'signals';
  if (c.type === 'island' || ref === 'island') return 'island';
  if (c.type === 'uncontrolled-marked' || c.crossing === 'marked' || c.crossing === 'uncontrolled' || c.type === 'convenience') return 'uncontrolled';
  return 'unmarked';
};
const tagCross = new Map(feat.crossings.map((c) => [c.id, CROSS_TYPE(c)]));
const useCount = new Map();
for (const p of pieces) for (const n of new Set(p.nodes)) if (n) useCount.set(n, (useCount.get(n) || 0) + 1);
const isGraphNode = (n, idx, p) => !!n && (useCount.get(n) >= 2 || idx === 0 || idx === p.nodes.length - 1 || tagSignals.has(n) || tagGive.has(n) || tagStop.has(n) || tagMini.has(n) || tagLC.has(n) || tagCross.has(n));

// ---------- 3. drop graph islands ----------
const uf = new UF();
for (const p of pieces) { let first = null; p.nodes.forEach((n, i) => { if (!isGraphNode(n, i, p)) return; if (first == null) first = n; else uf.union(first, n); }); }
const compLen = new Map(), compOf = (p) => uf.find(p.nodes[0]);
for (const p of pieces) { let L = 0; for (let i = 1; i < p.pts.length; i++) L += dist(p.pts[i], p.pts[i - 1]); p.rawLen = L; compLen.set(compOf(p), (compLen.get(compOf(p)) || 0) + L); }
const mainComp = [...compLen.entries()].sort((a, b) => b[1] - a[1])[0][0];
const dropped = pieces.filter((p) => compOf(p) !== mainComp);
const kept = pieces.filter((p) => compOf(p) === mainComp);
const droppedKm = dropped.reduce((s, p) => s + p.rawLen, 0) / 1000;

// ---------- 4. simplify + densify, then renumber nodes ----------
const useKept = new Map();
for (const p of kept) for (const n of new Set(p.nodes)) if (n) useKept.set(n, (useKept.get(n) || 0) + 1);
const isGraphKept = (n, idx, p) => !!n && (useKept.get(n) >= 2 || idx === 0 || idx === p.nodes.length - 1 || tagSignals.has(n) || tagGive.has(n) || tagStop.has(n) || tagMini.has(n) || tagLC.has(n) || tagCross.has(n));
for (const p of kept) {
  const keep = []; p.nodes.forEach((n, i) => { if (isGraphKept(n, i, p)) keep.push(i); });
  const idx = simplify(p.pts, 0.5, keep);
  let pts = idx.map((i) => p.pts[i]), nodes = idx.map((i) => (isGraphKept(p.nodes[i], i, p) ? p.nodes[i] : 0));
  [pts, nodes] = densify(pts, nodes, 12);
  p.pts = pts.map((q) => [r1(q[0]), r1(q[1])]); p.nodes = nodes;
}
const nodeMap = new Map(); // osm/synthetic id -> small int
const allIds = []; for (const p of kept) for (const n of p.nodes) if (n && !nodeMap.has(n)) { nodeMap.set(n, 0); allIds.push(n); }
allIds.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : typeof a === 'number' ? -1 : typeof b === 'number' ? 1 : String(a).localeCompare(String(b))));
allIds.forEach((n, i) => nodeMap.set(n, i + 1));
const nodesOut = {};
for (const p of kept) {
  p.nodes = p.nodes.map((n) => (n ? nodeMap.get(n) : 0));
  p.nodes.forEach((n, i) => {
    if (!n) return;
    const osmId = allIds[n - 1];
    let nd = nodesOut[n];
    if (!nd) nd = nodesOut[n] = { x: p.pts[i][0], z: p.pts[i][1], ways: [], signals: tagSignals.has(osmId), crossing: tagCross.get(osmId) || null, giveWay: tagGive.has(osmId), stop: tagStop.has(osmId), mini: tagMini.has(osmId), levelCrossing: tagLC.has(osmId), ...(String(osmId).startsWith('e') ? { edge: true } : {}) }; // 'e' ids are cut ends at the region edge
    if (!nd.ways.includes(p.id)) nd.ways.push(p.id);
  });
}
const osmToNode = (id) => nodeMap.get(id) || 0;
const nodeXZ = (n) => [nodesOut[n].x, nodesOut[n].z];
const wayById = new Map(kept.map((p) => [p.id, p]));
const cumOf = (p) => { const c = [0]; for (let i = 1; i < p.pts.length; i++) c.push(c[i - 1] + dist(p.pts[i], p.pts[i - 1])); return c; };

// ---------- 5. roundabouts ----------
// Lower lanes thresholds: more small rings become 2-lane, and the tightest 1-lane rings stay 1 lane
const LANE_RULE = (tag, r, maxEntry) => (tag ? tag : maxEntry >= 3 ? 3 : (maxEntry >= 2 && r >= 8) || r >= 18 ? 2 : 1);
const roundabouts = [], stitched = [], skippedRb = [], demoted = [];
let synthSeq = 0;
for (const rb of rbsIn) {
  if (rb.mini) continue;
  const ringPieces = kept.filter((p) => p.rb === rb.id);
  if (!ringPieces.length) { skippedRb.push(rb.name); continue; }
  // chain the ring pieces head to tail (one-way, so direction is circulation)
  const byStart = new Map(ringPieces.map((p) => [p.nodes[0], p]));
  const chain = [ringPieces[0]]; const used = new Set([ringPieces[0]]);
  for (;;) { const last = chain[chain.length - 1], nx = byStart.get(last.nodes[last.nodes.length - 1]); if (!nx || used.has(nx)) break; chain.push(nx); used.add(nx); }
  let closed = chain[chain.length - 1].nodes.at(-1) === chain[0].nodes[0];
  const ringWayIds = chain.map((p) => p.id);
  let ringPts = []; chain.forEach((p, i) => ringPts.push(...(i ? p.pts.slice(1) : p.pts)));
  if (!closed) {
    // try to close through existing one-way pieces that stay close to the ring (a slip road sharing the ring)
    const endN = chain[chain.length - 1].nodes.at(-1), startN = chain[0].nodes[0], r0 = rb.radius_m, cx = rb.x, cz = rb.z;
    const near = (n) => Math.hypot(nodesOut[n].x - cx, nodesOut[n].z - cz) <= 1.3 * r0 + 3;
    let found = null; const q = [[endN, []]]; const seen = new Set([endN]);
    while (q.length && !found) {
      const [n, path] = q.shift(); if (path.length > 4) continue;
      for (const wid of nodesOut[n].ways) {
        const p = wayById.get(wid); if (p.rb) continue;
        const i = p.nodes.indexOf(n); if (i < 0) continue;
        const steps = p.oneway ? [1] : [1, -1];
        for (const d of steps) { let j = i; for (;;) { j += d; if (j < 0 || j >= p.nodes.length) { j = -1; break; } if (p.nodes[j]) break; } if (j < 0) continue;
          const m = p.nodes[j]; if (!near(m) || seen.has(m)) continue; seen.add(m);
          const np = [...path, { p, i, j }]; if (m === startN) { found = np; break; } q.push([m, np]); }
        if (found) break;
      }
    }
    if (found) {
      for (const st of found) { st.p.rb = rb.id; ringWayIds.push(st.p.id); const seg = st.p.pts.slice(Math.min(st.i, st.j), Math.max(st.i, st.j) + 1); if (st.j < st.i) seg.reverse(); ringPts.push(...seg.slice(1)); }
      stitched.push(`${rb.name} (${rb.id}): closed through ${found.map((s) => s.p.name || s.p.id).join(', ')}`);
    } else {
      // synthetic arc along the ring circle from the chain end to its start, in the chain's sense
      const c = centroid(ringPts.length > 2 ? ringPts : [[cx, cz]]), ctr = Math.hypot(c[0] - cx, c[1] - cz) < r0 ? c : [cx, cz];
      const rad = ringPts.reduce((s, p) => s + Math.hypot(p[0] - ctr[0], p[1] - ctr[1]), 0) / ringPts.length;
      const sense = Math.sign(shoelace([...ringPts, ctr])) || 1; // open chain closed through the centre keeps the circulation sign
      const a0 = Math.atan2(nodesOut[endN].z - ctr[1], nodesOut[endN].x - ctr[0]), a1 = Math.atan2(nodesOut[startN].z - ctr[1], nodesOut[startN].x - ctr[0]);
      let sweep = (a1 - a0) * sense; sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const n = Math.max(2, Math.round((sweep * rad) / 4)), pts = [nodeXZ(endN)], nodes = [endN];
      for (let k = 1; k < n; k++) { const a = a0 + sense * sweep * (k / n); pts.push([r1(ctr[0] + Math.cos(a) * rad), r1(ctr[1] + Math.sin(a) * rad)]); nodes.push(0); }
      pts.push(nodeXZ(startN)); nodes.push(startN);
      const tmpl = chain[0];
      const synth = { ...tmpl, id: -(parseInt(rb.id.replace(/\D/g, ''), 10) * 10 + 9), osm: null, name: rb.name, synthetic: true, pts, nodes, rawLen: sweep * rad, turnLanes: null };
      kept.push(synth); wayById.set(synth.id, synth); ringWayIds.push(synth.id);
      nodesOut[endN].ways.push(synth.id); nodesOut[startN].ways.push(synth.id);
      ringPts.push(...pts.slice(1, -1));
      stitched.push(`${rb.name} (${rb.id}): ring not closed in OSM, added a ${Math.round(sweep * rad)} m synthetic arc (way ${synth.id})`);
      synthSeq++;
    }
    closed = true;
  }
  // geometry from the closed loop
  const loop = ringPts[0][0] === ringPts.at(-1)[0] && ringPts[0][1] === ringPts.at(-1)[1] ? ringPts.slice(0, -1) : ringPts;
  const ctr = centroid(loop);
  const r = loop.reduce((s, p) => s + Math.hypot(p[0] - ctr[0], p[1] - ctr[1]), 0) / loop.length;
  const sense = shoelace(loop) > 0 ? 1 : -1;
  const ringNodes = []; for (const wid of ringWayIds) for (const n of wayById.get(wid).nodes) if (n && !ringNodes.includes(n)) ringNodes.push(n);
  // order ring nodes by circulation angle from the chain start
  const th0 = Math.atan2(nodesOut[ringNodes[0]].z - ctr[1], nodesOut[ringNodes[0]].x - ctr[0]);
  const phi = (n) => { let d = (Math.atan2(nodesOut[n].z - ctr[1], nodesOut[n].x - ctr[0]) - th0) * sense; d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return d; };
  ringNodes.sort((a, b) => phi(a) - phi(b));
  // arms: ways touching the ring that are not ring members
  const cands = [];
  for (const n of ringNodes) for (const wid of nodesOut[n].ways) {
    const p = wayById.get(wid); if (p.rb) continue;
    const i = p.nodes.indexOf(n), last = p.pts.length - 1;
    const outward = (dirn) => { let L = 0, j = i; while (L < 15 && j + dirn >= 0 && j + dirn <= last) { L += dist(p.pts[j], p.pts[j + dirn]); j += dirn; } return bearingOf(p.pts[j][0] - p.pts[i][0], p.pts[j][1] - p.pts[i][1]); };
    const base = { node: n, wayId: p.id, name: p.name, ref: p.ref, cls: p.cls, phi: phi(n), signed: !!p.turnLanes };
    if (i > 0) cands.push({ ...base, bearing: outward(-1), entry: true, exit: !p.oneway, entryLanes: p.lanesF, exitLanes: p.oneway ? 0 : p.lanesB });
    if (i < last) cands.push({ ...base, bearing: outward(1), entry: !p.oneway, exit: true, entryLanes: p.oneway ? 0 : p.lanesB, exitLanes: p.lanesF });
  }
  cands.sort((a, b) => a.phi - b.phi);
  const arms = [];
  const compatible = (A, c) => {
    if (A.cands.some((d) => d.node === c.node)) return true;
    const gap = Math.abs(norm180((c.phi - A.cands.at(-1).phi) * 180 / Math.PI)) * Math.PI / 180 * r;
    const db = Math.abs(norm180(c.bearing - A.bearing));
    const sameRoad = (c.ref && A.refs.includes(c.ref)) || (c.name && A.names.includes(c.name));
    const bothEntryOnly = c.entry && !c.exit && A.entry && !A.exit, bothExitOnly = c.exit && !c.entry && A.exit && !A.entry;
    if (bothEntryOnly || bothExitOnly) return false;
    return (gap <= 40 && db <= 50) || (sameRoad && gap <= 90 && db <= 75); // dual carriageways meet the ring up to ~70 degrees apart
  };
  const mean = (arr) => { let x = 0, z = 0; for (const b of arr) { x += Math.sin(b * Math.PI / 180); z += Math.cos(b * Math.PI / 180); } return bearingOf(x, -z); };
  for (const c of cands) {
    const A = arms.length ? arms[arms.length - 1] : null;
    if (A && compatible(A, c)) { A.cands.push(c); A.bearing = mean(A.cands.map((d) => d.bearing)); A.entry ||= c.entry; A.exit ||= c.exit; A.names = uniq([...A.names, c.name]); A.refs = uniq([...A.refs, c.ref]); continue; }
    arms.push({ cands: [c], bearing: c.bearing, entry: c.entry, exit: c.exit, names: uniq([c.name]), refs: uniq([c.ref]) });
  }
  if (arms.length > 1 && compatible(arms[arms.length - 1], arms[0].cands[0]) && arms[0].cands.every((c) => compatible(arms[arms.length - 1], c))) { const L = arms.pop(); arms[0].cands.unshift(...L.cands); arms[0].bearing = mean(arms[0].cands.map((d) => d.bearing)); arms[0].entry ||= L.entry; arms[0].exit ||= L.exit; arms[0].names = uniq([...L.names, ...arms[0].names]); arms[0].refs = uniq([...L.refs, ...arms[0].refs]); }
  const armsOut = arms.map((A) => {
    const ents = A.cands.filter((c) => c.entry), exs = A.cands.filter((c) => c.exit);
    const node = ents.length ? ents[0].node : exs[0].node, exitNode = exs.length ? exs[0].node : node;
    return { bearing: r1(A.bearing), node, exitNode, entry: ents.length > 0, exit: exs.length > 0, entryWays: uniq(ents.map((c) => c.wayId)), exitWays: uniq(exs.map((c) => c.wayId)),
      entryLanes: Math.max(0, ...ents.map((c) => c.entryLanes)) || 0, exitLanes: Math.max(0, ...exs.map((c) => c.exitLanes)) || 0, names: A.names, refs: A.refs, cls: A.cands.map((c) => c.cls).sort()[0], signed: ents.some((c) => c.signed), dest: null };
  }).sort((a, b) => a.bearing - b.bearing);
  if (armsOut.length < 2) { // a turning loop, not a junction: keep the ways as a plain one-way loop
    for (const id of ringWayIds) { const p = wayById.get(id); p.rb = null; }
    demoted.push(`${rb.name} (${rb.id}): ${armsOut.length} arm`);
    continue;
  }
  const maxEntry = Math.max(0, ...armsOut.map((a) => a.entryLanes));
  const ringTag = rb.lanes_src === 'tag' && rb.lanes ? rb.lanes : null;
  const lanes = LANE_RULE(ringTag, r, maxEntry);
  // Wider ring lanes (3.65 m is a UK main-road lane; a roundabout gets a touch more so a Chiron fits
  // comfortably alongside traffic). Small rings use a narrower lane but still wider than a city street.
  const laneW = r < 12 ? 3.5 : 4.0;
  const tagged = ringWayIds.map((id) => wayById.get(id)).filter((p) => p.limitTag);
  const limit = tagged.length ? Math.max(...tagged.map((p) => p.limitTag)) : Math.max(30, ...armsOut.flatMap((a) => a.entryWays.map((id) => wayById.get(id).limit)));
  for (const id of ringWayIds) { const p = wayById.get(id); p.limit = limit; p.nsl = false; p.lanesF = Math.max(p.lanesF, lanes); p.width = r1(lanes * laneW); }
  roundabouts.push({ id: rb.id, name: rb.name, x: r1(ctr[0]), z: r1(ctr[1]), r: r1(r), lanes, lanesSrc: ringTag ? 'tag' : 'estimate', laneW, island: r1(Math.max(1.5, r - lanes * laneW)),
    sense, limit, signals: !!rb.signals, mini: false, cls: rb.highest_class || 'tertiary', ringWays: ringWayIds, ringNodes, arms: armsOut, armDetailBearings: (rb.arm_detail || []).map((a) => a.bearing) });
}

// ---------- 6. minis, signals, crossings, level crossings ----------
const minis = [];
for (const m of feat.mini_roundabouts) {
  const n = osmToNode(m.id); if (!n) continue;
  let arms = 0; for (const wid of nodesOut[n].ways) { const p = wayById.get(wid); const i = p.nodes.indexOf(n); arms += i > 0 && i < p.nodes.length - 1 ? 2 : 1; }
  minis.push({ node: n, x: nodesOut[n].x, z: nodesOut[n].z, arms, sense: m.direction === 'anticlockwise' ? -1 : 1, name: m.name || null });
}
const sigNodes = feat.signals.map((s) => ({ s, n: osmToNode(s.id) })).filter((e) => e.n);
const suf = new UF();
for (let i = 0; i < sigNodes.length; i++) for (let j = i + 1; j < sigNodes.length; j++) {
  const a = sigNodes[i], b = sigNodes[j]; if (Math.hypot(a.s.x - b.s.x, a.s.z - b.s.z) > 45) continue;
  const wa = nodesOut[a.n].ways, wb = nodesOut[b.n].ways;
  let joined = wa.some((w) => wb.includes(w));
  if (!joined) { // their ways meet at a node within 45 m of both
    const touch = new Set(); for (const w of wa) for (const n of wayById.get(w).nodes) if (n) touch.add(n);
    for (const w of wb) for (const n of wayById.get(w).nodes) if (n && touch.has(n) && Math.hypot(nodesOut[n].x - a.s.x, nodesOut[n].z - a.s.z) <= 45 && Math.hypot(nodesOut[n].x - b.s.x, nodesOut[n].z - b.s.z) <= 45) { joined = true; break; }
  }
  if (joined) suf.union(a.n, b.n);
}
const groupMin = new Map(); for (const e of sigNodes) { const rt = suf.find(e.n); groupMin.set(rt, Math.min(groupMin.get(rt) ?? Infinity, e.n)); }
const signals = sigNodes.map((e) => ({ node: e.n, x: nodesOut[e.n].x, z: nodesOut[e.n].z, ways: nodesOut[e.n].ways.slice(), junction: 'j-' + groupMin.get(suf.find(e.n)) }));
// a quick way index for projecting off-road crossings
const net0 = { grid: null };
const tmpNet = new RoadNet({ ways: kept.map((p) => ({ ...p })), nodes: nodesOut, roundabouts: [], places: [], buildings: [], crossings: [], signals: [], bounds: B, origin: ORIGIN });
const crossings = [];
let crossProjected = 0, crossDropped = 0;
for (const c of feat.crossings) {
  if (!inBounds([c.x, c.z])) continue;
  const type = CROSS_TYPE(c), n = osmToNode(c.id);
  if (n) {
    const wid = nodesOut[n].ways.find((w) => c.ways.includes(wayById.get(w).osm)) ?? nodesOut[n].ways[0];
    const p = wayById.get(wid), cum = cumOf(p), i = p.nodes.indexOf(n);
    crossings.push({ node: n, x: nodesOut[n].x, z: nodesOut[n].z, type, way: wid, s: r1(cum[i]) });
  } else {
    const h = tmpNet.nearest(c.x, c.z, 15); if (!h) { crossDropped++; continue; }
    crossings.push({ node: 0, x: r1(h.px), z: r1(h.pz), type, way: h.way.id, s: r1(h.s) }); crossProjected++;
  }
}
// ---------- traffic calming: humps, cushions, tables ----------
// Same trick as the crossings above: a hump sits on a mid-way vertex, and simplify/renumber drops
// untagged mid-way nodes, so most of them have no node id by now. Project each onto the nearest
// carriageway instead and record how far along it sits, which is what the road builder needs.
const HUMP_KIND = { hump: 'hump', bump: 'hump', table: 'table', cushion: 'cushion', rumble_strip: 'rumble', dip: 'hump' };
const calming = [];
let calmProjected = 0, calmDropped = 0;
for (const c of feat.calming || []) {
  const kind = HUMP_KIND[c.kind];
  if (!kind || !inBounds([c.x, c.z])) continue;
  const n = osmToNode(c.id);
  if (n && nodesOut[n]) {
    const wid = nodesOut[n].ways.find((w) => (c.ways || []).includes(wayById.get(w).osm)) ?? nodesOut[n].ways[0];
    const p = wayById.get(wid), cum = cumOf(p), i = p.nodes.indexOf(n);
    calming.push({ x: nodesOut[n].x, z: nodesOut[n].z, kind, way: wid, s: r1(cum[i]) });
  } else {
    const h = tmpNet.nearest(c.x, c.z, 15);
    if (!h) { calmDropped++; continue; }
    calming.push({ x: r1(h.px), z: r1(h.pz), kind, way: h.way.id, s: r1(h.s) });
    calmProjected++;
  }
}

const levelCrossings = [];
for (const c of feat.level_crossings) {
  if (c.type !== 'level_crossing') continue; const n = osmToNode(c.id); if (!n) continue;
  const barrier = c.barrier === 'half' ? 'half' : ['double_half', 'full', 'yes'].includes(c.barrier) ? 'full' : 'none';
  levelCrossings.push({ node: n, x: nodesOut[n].x, z: nodesOut[n].z, barrier, way: nodesOut[n].ways[0] });
}

// ---------- 7. lines and polygons ----------
const lineOut = (list, tol) => { const out = []; for (const l of list) for (const part of clipLine(l.pts, null)) { const idx = simplify(part.pts, tol, []); if (idx.length >= 2) out.push({ name: l.name || null, pts: idx.map((i) => [r1(part.pts[i][0]), r1(part.pts[i][1])]) }); } return out; };
const railways = lineOut(feat.railways, 1.0), rivers = lineOut(feat.rivers, 1.5);
// inland cities: no coast, no sea
const coastParts = feat.coastline?.length ? clipLine(feat.coastline[0].pts, null).sort((a, b) => b.pts.length - a.pts.length) : [];
if (coastParts.length > 1) warn.push(`coastline clipped into ${coastParts.length} pieces; kept the longest`);
const coastline = coastParts.length ? simplify(coastParts[0].pts, 0.5, []).map((i) => [r1(coastParts[0].pts[i][0]), r1(coastParts[0].pts[i][1])]) : [];
const sea = feat.sea_polygon?.length >= 3 ? clipPoly(feat.sea_polygon).map((p) => [r1(p[0]), r1(p[1])]) : [];

// ---------- 8. buildings ----------
const KIND = (t) => {
  const b = t.building || 'yes';
  if (t.amenity === 'place_of_worship' || ['church', 'chapel', 'cathedral'].includes(b)) return 'church';
  if (['terrace'].includes(b)) return 'terrace';
  if (['apartments', 'dormitory'].includes(b)) return 'flats';
  if (['industrial', 'warehouse', 'factory', 'depot'].includes(b)) return 'industrial';
  if (['retail', 'commercial', 'supermarket', 'kiosk', 'office'].includes(b) || t.shop || ['restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'bank', 'pharmacy'].includes(t.amenity)) return 'shop';
  if (['house', 'detached', 'semidetached_house', 'bungalow', 'residential', 'cabin', 'semi'].includes(b)) return 'house';
  return 'other';
};
const buildingsById = new Map();
for (const f of bFiles) {
  const j = load(f);
  if (j.elements) for (const e of j.elements) { if (e.type === 'way' && e.geometry && !buildingsById.has(e.id)) buildingsById.set(e.id, { id: e.id, tags: e.tags || {}, pts: e.geometry.map((g) => project(g.lat, g.lon)) }); }
  else if (j.buildings) for (const b of j.buildings) if (!buildingsById.has(b.id)) buildingsById.set(b.id, { id: b.id, tags: { building: b.type, name: b.name, 'building:levels': b.levels, shop: b.shop, amenity: b.amenity }, pts: b.pts.map((p) => [p[0], p[1]]), h: b.height_m });
}
const buildings = []; let tinySkipped = 0, clearedHome = 0, clearedField = 0;
const inRect = (c, R) => c[0] >= R.minX && c[0] <= R.maxX && c[1] >= R.minZ && c[1] <= R.maxZ;
for (const b of buildingsById.values()) {
  let pts = b.pts; if (pts.length > 1 && dist(pts[0], pts.at(-1)) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) continue;
  const c = centroid(pts); if (!inBounds(c)) continue;
  // the house plot and the fenced airfield are built by the game, not OSM
  if (HOME && (Math.hypot(c[0] - HOME.x, c[1] - HOME.z) <= 70 || pts.some((p) => Math.hypot(p[0] - HOME.x, p[1] - HOME.z) <= 70))) { clearedHome++; continue; }
  if (inRect(c, AIRFIELD_RECT) || pts.some((p) => inRect(p, AIRFIELD_RECT))) { clearedField++; continue; }
  const area = Math.abs(shoelace(pts)); if (area < 8) { tinySkipped++; continue; }
  let tol = 0.3, idx = simplifyRing(pts, tol); while (idx.length > 24 && tol < 60) { tol *= 1.5; idx = simplifyRing(pts, tol); } // big stores and schools lose detail, never points
  const out = idx.map((i) => [r1(pts[i][0]), r1(pts[i][1])]);
  if (out.length < 3) continue;
  const t = b.tags, kind = KIND(t);
  const hTag = parseFloat(String(t.height || '').replace(/[^0-9.]/g, '')), levels = parseFloat(t['building:levels']);
  const h = hTag > 0 ? hTag : levels > 0 ? levels * 3.2 : b.h && t.building !== 'yes' ? b.h : ['house', 'terrace', 'flats'].includes(kind) ? (kind === 'flats' ? 9.6 : 6.5) : kind === 'shop' || kind === 'industrial' ? 9 : kind === 'church' ? 12 : t.building === 'garage' || t.building === 'garages' || t.building === 'shed' ? 2.8 : 6.5;
  buildings.push({ pts: out, h: r1(h), kind, name: t.name || null });
}

// ---------- 8b. landuse (optional: the cross-check agent's x2_landuse.json, Overpass JSON) ----------
const LAND_KIND = (t) => {
  const lu = t.landuse, nat = t.natural, le = t.leisure;
  if (nat === 'water' || ['reservoir', 'basin', 'pond'].includes(lu)) return 'water';
  if (['beach', 'shingle', 'sand', 'mud'].includes(nat)) return 'beach';
  if (['wood', 'forest'].includes(lu) || ['wood', 'scrub', 'heath'].includes(nat)) return 'wood';
  if (['farmland', 'farmyard', 'orchard', 'allotments', 'vineyard'].includes(lu)) return 'farmland';
  if (['grass', 'meadow', 'greenfield', 'recreation_ground', 'village_green', 'cemetery'].includes(lu) || ['park', 'pitch', 'garden', 'golf_course', 'playground', 'nature_reserve', 'common'].includes(le) || nat === 'grassland') return 'grass';
  if (lu === 'residential') return 'residential';
  if (['industrial', 'commercial', 'railway', 'construction', 'brownfield', 'landfill', 'quarry'].includes(lu)) return 'industrial';
  if (lu === 'retail') return 'retail';
  return null;
};
const landuse = []; let landuseFile = opt.landuse ? path.resolve(opt.landuse) : fs.existsSync(path.join(osm, 'raw', 'q5_landuse.json')) ? path.join(osm, 'raw', 'q5_landuse.json') : path.join(osm, '..', 'xcheck_data', 'x2_landuse.json');
if (fs.existsSync(landuseFile)) {
  const j = load(landuseFile); let skipped = 0;
  for (const e of j.elements || []) {
    if (e.type !== 'way' || !e.geometry) continue;
    const kind = LAND_KIND(e.tags || {}); if (!kind) { skipped++; continue; }
    let pts = e.geometry.map((g) => project(g.lat, g.lon)); if (pts.length > 1 && dist(pts[0], pts.at(-1)) < 0.01) pts = pts.slice(0, -1);
    if (pts.length < 3) continue;
    const clipped = clipPoly(pts); if (clipped.length < 3 || Math.abs(shoelace(clipped)) < 50) continue;
    const idx = simplifyRing(clipped, 3.0); if (idx.length < 3) continue;
    landuse.push({ kind, pts: idx.map((i) => [r1(clipped[i][0]), r1(clipped[i][1])]) });
  }
  if (skipped) warn.push(`landuse: ${skipped} ways with no usable landuse/natural/leisure tag skipped`);
} else warn.push(`no landuse file (${landuseFile}): landuse = []`);

// ---------- 9. landmarks, places, test centres ----------
// `brand` stays (scenery names supermarkets and petrol stations by it); `cat` is the category.
const landmarks = feat.landmarks.filter((l) => l.name && l.name !== 'None' && inBounds([l.x, l.z])).map((l) => ({ name: l.name, cat: l.category, x: r1(l.x), z: r1(l.z), brand: l.brand || l.operator || null }));
// Places: the OSM place nodes inside the square (suburbs, neighbourhoods; rank 1 town, 2 suburb,
// 3 neighbourhood) plus the region's hand-listed far places, which only serve destination labels on
// roads leaving the map.
const seenPlace = new Set();
const places = (feat.places || []).filter((p) => inBounds([p.x, p.z]) && !seenPlace.has(p.name) && seenPlace.add(p.name)).map((p) => ({ name: p.name, x: r1(p.x), z: r1(p.z), r: p.r || 500, rank: p.rank || 2 }));
const BIG = /^(london|birmingham|manchester|kent|central london|city centre)$/i;
const far = R.far.map(([name, x, z]) => ({ name, x, z, r: 0, rank: BIG.test(name) ? 1 : 2, far: true }));
const testCentres = (feat.test_centres || []).map((t) => ({ name: t.name, x: r1(t.x), z: r1(t.z), address: t.address }));

// ---------- 9b. built-up override: an untagged road inside a town is 30, not 60 ----------
// OSM often leaves maxspeed off a minor road entirely. Falling back to 60 is right on a country
// lane and badly wrong in a suburb, and in a learner's game wrong-fast is far more dangerous than
// wrong-slow. Where a way with no posted limit sits inside a named place, treat it as a restricted
// road: 30, and never the national speed limit.
const builtUp = places.filter((p) => p.rank <= 3 && p.r > 0);
const inTown = (x, z) => builtUp.some((p) => Math.hypot(x - p.x, z - p.z) <= p.r);
let deRural = 0;
for (const p of kept) {
  if (p.limitTag != null || p.cls === 'motorway' || p.link) continue;
  const mid = p.pts[Math.floor(p.pts.length / 2)];
  if (!inTown(mid[0], mid[1])) continue;
  if (p.limit > 30) { p.limit = 30; deRural++; }
  p.nsl = false;
  p.pave = true;
  p.rural = false;
}

// ---------- 10. assemble, destinations, write ----------
const waysOut = kept.map((p) => ({ id: p.id, name: p.name, ref: p.ref, cls: p.cls, limit: p.limit, nsl: p.nsl, oneway: p.oneway, lanesF: p.lanesF, lanesB: p.lanesB, lanesSrc: p.lanesSrc, rb: p.rb, dual: p.dual, link: p.link,
  bridge: p.bridge, tunnel: p.tunnel, layer: p.layer, width: p.width, pave: p.pave, rural: p.rural, turnLanes: p.turnLanes,
  ...(p.surface ? { surface: p.surface } : {}), ...(p.synthetic ? { synthetic: true } : {}), pts: p.pts, nodes: p.nodes }));
const region = {
  attribution: ATTR, osm_base: roads.osm_base, region: R.id, name: R.name, idNote: 'node ids are small integers assigned by tools/region-data.mjs, not OSM ids; way ids are OSM way ids (negative = a way cut at the region edge, or a synthetic ring arc)',
  origin: ORIGIN, bounds: B, ways: waysOut, nodes: nodesOut, roundabouts, minis, signals, crossings, calming, levelCrossings, railways, rivers, coastline, sea, buildings, landuse, landmarks, places: [...places, ...far], testCentres, home: HOME, airfield: AIRFIELD,
};
const net = new RoadNet(region);
for (const rb of roundabouts) for (const arm of rb.arms) {
  const wid = arm.exit ? arm.exitWays[0] : arm.entryWays[0], nid = arm.exit ? arm.exitNode : arm.node, way = net.ways.get(wid), node = net.nodes.get(nid);
  if (!way || !node) continue;
  const ref = node.ways.find((r) => r.way === way); if (!ref) continue;
  const dir = arm.exit ? (ref.idx === 0 ? 1 : -1) : (ref.idx === way.pts.length - 1 ? -1 : 1);
  const a = node.arms().find((x) => x.way === way && x.dir === dir) || { way, dir, idx: ref.idx, bearing: arm.bearing };
  arm.dest = net.destinations(node.id, a)[0] || [arm.refs[0], arm.names[0]].filter(Boolean).join(' ') || null;
}
for (const rb of roundabouts) delete rb.armDetailBearings;
// The test centre comes from a geocoded postcode, which lands on the road itself. Scenery builds
// the building and its car park at the point, so step it off the carriageway onto the emptier side.
const tcNotes = [];
for (const tc of testCentres) {
  const h = net.nearest(tc.x, tc.z, 120); if (!h) continue;
  const need = h.way.halfW + 30;
  if (h.dist >= need) continue;
  const nx = -h.dir[1], nz = h.dir[0]; // across the road
  // candidates either side and a little along the road; the spot must be clear of every other road
  // (the building is 26 x 12 m with a car park in front) and is scored by the buildings it would cover
  let best = null;
  for (const sgn of [1, -1]) for (const along of [0, 40, -40, 80, -80, 120, -120]) {
    const cx = h.px + h.dir[0] * along + nx * sgn * need, cz = h.pz + h.dir[1] * along + nz * sgn * need;
    const other = net.nearest(cx, cz, 60);
    const roadPenalty = !other || other.dist < 31 ? 1000 : 0; // > 30 m from every road gets the car park; < 60 m keeps it by one
    const count = buildings.filter((b) => b.pts.some((p) => Math.hypot(p[0] - cx, p[1] - cz) < 45)).length;
    const score = roadPenalty + count + Math.abs(along) / 40;
    if (!best || score < best.score) best = { cx, cz, score, along, sgn };
  }
  const nx2 = r1(best.cx), nz2 = r1(best.cz);
  tcNotes.push(`${tc.name}: moved ${Math.round(need)} m off ${h.way.name || h.way.cls}${best.along ? ` and ${best.along} m along it` : ''} from (${tc.x}, ${tc.z}) to (${nx2}, ${nz2})${best.score >= 1000 ? ' [no road-free spot: it will sit on a side road]' : ''}`);
  tc.x = nx2; tc.z = nz2;
}
const homeNote = null; // no home in a city region: you arrive at the jet centre

// ---------- 11. terrain: real hills from the OS-equivalent EU-DEM 25 m grid ----------
// Baked relative to the test centre's elevation so y=0 at the TC. The game samples this bilinearly
// for world.heightAt and world.gradeAt — hill starts and gravity work on the real streets.
let terrain = null;
const elevationFile = path.join(osm, 'elevation.json');
if (fs.existsSync(elevationFile)) {
  const g = load(elevationFile);
  // sample the TC's elevation on the grid, make that the datum
  const tc = testCentres[0] || { x: 0, z: 0 };
  const sample = (gx, gz) => {
    const fx = (gx - g.x0) / g.step, fz = (gz - g.z0) / g.step;
    const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(g.nz - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
    const h00 = g.heights[j * g.nx + i], h10 = g.heights[j * g.nx + (i + 1)], h01 = g.heights[(j + 1) * g.nx + i], h11 = g.heights[(j + 1) * g.nx + (i + 1)];
    return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
  };
  const base = sample(tc.x, tc.z);
  // Feather the elevation to 0 at the grid's edge so a road leaving the fetched square (the jet
  // centre road) doesn't feel a step. 5 cells (500 m) of smoothstep.
  const BORDER = 5;
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const relH = new Array(g.heights.length);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i, m = Math.min(i, j, g.nx - 1 - i, g.nz - 1 - j);
    relH[k] = r1((g.heights[k] - base) * smooth(m / BORDER));
  }
  terrain = { source: g.source, step: g.step, x0: g.x0, z0: g.z0, nx: g.nx, nz: g.nz, base: r1(base), min: r1(Math.min(...relH)), max: r1(Math.max(...relH)), heights: relH };
  region.terrain = terrain;
} else warn.push(`no elevation file (${elevationFile}): terrain = null (flat city)`);

// NaN guard before writing
const scan = (v, p) => { if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite number at ' + p); } else if (Array.isArray(v)) v.forEach((e, i) => scan(e, p + '[' + i + ']')); else if (v && typeof v === 'object') for (const k of Object.keys(v)) scan(v[k], p + '.' + k); };
scan(region, 'region');
fs.mkdirSync(OUT, { recursive: true });
const json = JSON.stringify(region);
fs.writeFileSync(path.join(OUT, 'region.json'), json);
fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.txt'), `region.json is derived from OpenStreetMap data.\n\n${ATTR}\nData © OpenStreetMap contributors, licensed under the Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright\nThis derived database is itself offered under ODbL 1.0. Extract date (osm_base): ${roads.osm_base}.\nBuilt by tools/region-data.mjs from an Overpass extract (tools/osm-fetch.mjs); no OSM ids are kept for nodes.\n`);
if (opt.scratch) { fs.mkdirSync(path.resolve(opt.scratch), { recursive: true }); fs.writeFileSync(path.join(path.resolve(opt.scratch), 'nodemap.json'), JSON.stringify(allIds)); }
console.log(`wrote ${path.join(OUT, 'region.json')} (${(json.length / 1e6).toFixed(2)} MB) and ATTRIBUTION.txt`);

// ---------- --check ----------
if (CHECK) {
  const km = {}; let total = 0;
  for (const w of net.ways.values()) { km[w.cls] = (km[w.cls] || 0) + w.len / 1000; total += w.len / 1000; }
  console.log('\n== counts');
  console.log(`ways ${waysOut.length} (${dropped.length} island ways dropped, ${droppedKm.toFixed(2)} km; ${skippedRb.length} roundabouts outside the region), nodes ${Object.keys(nodesOut).length} (junctions ${[...net.nodes.values()].filter((n) => n.kind === 'junction').length}, ends ${[...net.nodes.values()].filter((n) => n.kind === 'end').length}), roundabouts ${roundabouts.length}, minis ${minis.length}, signals ${signals.length} in ${new Set(signals.map((s) => s.junction)).size} groups, crossings ${crossings.length} (${crossProjected} projected from footways, ${crossDropped} dropped), calming ${calming.length} (${calmProjected} projected, ${calmDropped} dropped), level crossings ${levelCrossings.length}, railways ${railways.length}, rivers ${rivers.length}, coastline ${coastline.length} pts, sea ${sea.length} pts, buildings ${buildings.length} (${tinySkipped} tiny skipped, ${clearedHome} cleared at home, ${clearedField} cleared on the airfield), landuse ${landuse.length} (${Object.entries(landuse.reduce((m, l) => (m[l.kind] = (m[l.kind] || 0) + 1, m), {})).map(([k, v]) => k + ' ' + v).join(', ')}), landmarks ${landmarks.length} (${landmarks.filter((l) => l.brand).length} with brand), places ${places.length} + ${far.length} far, test centres ${testCentres.length}`);
  if (synthNotes.length) console.log('synthetic roads: ' + synthNotes.join('; '));
  console.log(`points ${waysOut.reduce((s, w) => s + w.pts.length, 0)}; total ${total.toFixed(1)} km; by class: ` + Object.entries(km).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
  console.log('\n== 12 biggest roundabouts (lanes, then radius)');
  for (const rb of roundabouts.slice().sort((a, b) => b.lanes - a.lanes || b.r - a.r).slice(0, 12)) {
    console.log(`${rb.name} [${rb.id}] x ${rb.x} z ${rb.z} r ${rb.r} lanes ${rb.lanes} (${rb.lanesSrc}) island ${rb.island} sense ${rb.sense} limit ${rb.limit} signals ${rb.signals} arms ${rb.arms.length}`);
    for (const a of rb.arms) console.log(`    ${String(a.bearing).padStart(5)}° ${a.entry ? 'in' : '  '}${a.exit ? '/out' : '    '} lanes ${a.entryLanes}/${a.exitLanes} ${[a.refs.join('/'), a.names.join(' | ')].filter(Boolean).join(' ')} -> ${a.dest}`);
  }
  console.log('\n== fixed points');
  for (const [label, p] of [['airfield', AIRFIELD], ...testCentres.map((t) => [t.name, t])]) {
    const h = net.nearest(p.x, p.z, 400);
    console.log(`${label} (${p.x}, ${p.z}): nearest road ${h ? `${h.way.ref || ''} ${h.way.name || h.way.cls} at ${h.dist.toFixed(1)} m (${h.way.limit} mph)` : 'none within 400 m'}; place ${net.placeAt(p.x, p.z)}`);
  }
  if (stitched.length) console.log('\n== stitched rings\n' + stitched.join('\n'));
  if (demoted.length) console.log('\n== rings demoted to plain one-way loops (fewer than 2 arms)\n' + demoted.join('\n'));
  if (homeNote) console.log('\n== home\n' + homeNote);
  if (tcNotes.length) console.log('\n== test centre\n' + tcNotes.join('\n'));
  if (warn.length) console.log('\n== warnings\n' + warn.join('\n'));
  console.log('\n== assertions');
  const fails = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
  // connectivity over the final graph
  const cuf = new UF(); for (const w of net.ways.values()) { let first = null; for (const n of w.nodes) { if (!n) continue; if (first == null) first = n; else cuf.union(first, n); } }
  const comps = new Set([...net.nodes.keys()].map((n) => cuf.find(n)));
  check(comps.size === 1, `one connected component (found ${comps.size})`);
  check(roundabouts.every((rb) => rb.arms.length >= 2), 'every roundabout has >= 2 arms' + roundabouts.filter((rb) => rb.arms.length < 2).map((rb) => ` [${rb.name}: ${rb.arms.length}]`).join(''));
  check(roundabouts.every((rb) => { const ws = rb.ringWays.map((id) => net.ways.get(id)); const byStart = new Map(ws.map((w) => [w.nodes[0], w])); let w = ws[0], n = 0; while (n < ws.length) { w = byStart.get(w.nodes.at(-1)); n++; if (!w) return false; } return w === ws[0]; }), 'every ring is closed (head-to-tail chain returns to its start)');
  check(roundabouts.every((rb) => rb.sense === 1), 'every ring circulates clockwise (sense 1)' + roundabouts.filter((rb) => rb.sense !== 1).map((rb) => ` [${rb.name}]`).join(''));
  check(waysOut.every((w) => w.pts.length >= 2 && w.pts.length === w.nodes.length), 'every way has >= 2 points and nodes[] the same length as pts[]');
  check(waysOut.every((w) => w.pts.every(inBounds)), 'every point inside the bounds');
  check(waysOut.every((w) => w.nodes[0] && w.nodes.at(-1)), 'every way end is a graph node');
  check(waysOut.every((w) => w.nodes.every((n) => !n || nodesOut[n])), 'every way node id exists in nodes');
  check(Object.values(nodesOut).every((n) => n.ways.every((id) => wayById.has(id))), 'every node way id exists');
  check(roundabouts.every((rb) => rb.ringNodes.every((n) => nodesOut[n]) && rb.arms.every((a) => nodesOut[a.node])), 'roundabout node references exist');
  check(!json.includes('NaN') && !json.includes('null,null'), 'no NaN in the output');
  check(json.length <= 6e6, `file <= 6 MB (${(json.length / 1e6).toFixed(2)} MB)`);
  check(buildings.every((b) => b.pts.length >= 3 && b.pts.length <= 24), 'building footprints have 3..24 points');
  for (const [id, name, gate] of [[9000000002, 'Jet Centre Road', JET_GATE]]) {
    const w = net.ways.get(id), end = w && net.nodes.get(w.nodes[0]), join = w && net.nodes.get(w.nodes.at(-1));
    check(!!w && w.name === name && w.cls === 'service' && w.limit === 20 && !w.oneway && end && end.kind === 'end' && join && join.kind === 'junction' && Math.hypot(w.pts[0][0] - gate[0], w.pts[0][1] - gate[1]) < 0.2, `${name} exists, starts at its gate and joins the network at a junction node`);
  }
  check(!buildings.some((b) => b.pts.some((p) => inRect(p, AIRFIELD_RECT))), 'no building footprint inside the airfield rectangle');
  check(testCentres.length === 1 && !!net.nearest(testCentres[0].x, testCentres[0].z, 120), `the test centre (${testCentres[0]?.x}, ${testCentres[0]?.z}) is within 120 m of a road`);
  check(landuse.length > 0 && landuse.every((l) => l.pts.length >= 3 && l.pts.every(inBounds)), `landuse has ${landuse.length} polygons inside the bounds`);
  const big = roundabouts.filter((rb) => rb.r >= 9 && rb.arms.length < 3);
  if (big.length) console.log(`note: ${big.length} roundabouts of r >= 9 m with fewer than 3 arms: ` + big.map((rb) => rb.name).join('; '));
  if (fails.length) { console.error(`\n${fails.length} assertion(s) failed`); process.exit(1); }
  console.log('\nall assertions passed');
}
