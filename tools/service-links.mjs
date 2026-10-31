#!/usr/bin/env node
// Picks out the unnamed service roads that carry a real connection between two Kent streets, and
// writes them to tools/kent-service-links.json for tools/region-fix.mjs to splice into an already
// baked region.json.
//
//   node tools/service-links.mjs [--fetch] [--region public/assets/kent/region.json]
//
// tools/osm-fetch.mjs drops every unnamed service way at fetch time (they are mostly driveways and
// car-park aisles), so the baker never sees them and a handful of genuine back links between
// streets went missing with them. Kent cannot be rebaked - tools/kent-data.mjs needs a coastline
// and sea polygon that no fetch tool in the repo produces any more - so the links are selected
// here, committed as data, and patched in.
//
// Only a LINK is taken: a chain of unnamed service ways that starts on one street and ends on a
// different one. A spur that dead-ends is left out however real it is, because the map already has
// all the dead ends it needs. Gates, bollards, bus-only and footpath links are left out too.
//
// --fetch pulls the two Overpass answers it reads (cached in scratch/osm/kent/raw/).
// Built-ins only. Data © OpenStreetMap contributors, ODbL 1.0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; } }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(REPO, 'scratch/osm/kent/raw');
const OUT = path.join(REPO, 'tools/kent-service-links.json');
const BBOX = '51.2607,1.0541,51.3856,1.2148'; // the Kent bounds of kent-data.mjs, in lat/lon
const UA = 'jesusintech-games/1.0 (driving-test game map bake; ogundelerichard27@gmail.com)';
const r1 = (v) => Math.round(v * 10) / 10;
/** an OSM maxspeed tag as mph, the same reading as osm-fetch.mjs */
const mph = (s) => { if (!s) return null; const m = String(s).match(/([\d.]+)\s*(mph)?/i); if (!m) return null; const v = parseFloat(m[1]); return m[2] ? v : Math.round(v / 1.609344); };

async function overpass(name, ql) {
  const file = path.join(RAW, `${name}.json`);
  if (!opt.fetch && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(RAW, { recursive: true });
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:240][bbox:${BBOX}];\n${ql}`);
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}: ${text.slice(0, 160)}`);
  fs.writeFileSync(file, text);
  const j = JSON.parse(text);
  console.log(`${name}: ${j.elements.length} elements`);
  return j;
}

const waysJ = await overpass('service_ways', 'way["highway"="service"];\nout geom;');
const barJ = await overpass('service_barriers', 'way["highway"="service"]->.s;\nnode(w.s)["barrier"];\nout body;');

const R = JSON.parse(fs.readFileSync(path.resolve(opt.region || path.join(REPO, 'public/assets/kent/region.json')), 'utf8'));
const O = R.origin, B = R.bounds;
const project = (lat, lon) => [(lon - O.lon0) * O.mPerDegLon, -(lat - O.lat0) * O.mPerDegLat];
const inBounds = (p) => p[0] >= B.minX && p[0] <= B.maxX && p[1] >= B.minZ && p[1] <= B.maxZ;

// ---------- what the game's own carriageway already covers ----------
const CELL = 20, grid = new Map(), key = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
for (const w of R.ways) for (let i = 0; i < w.pts.length - 1; i++) {
  const a = w.pts[i], b = w.pts[i + 1];
  for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++)
    for (let gz = Math.floor(Math.min(a[1], b[1]) / CELL); gz <= Math.floor(Math.max(a[1], b[1]) / CELL); gz++) {
      const k = `${gx}:${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([w, a, b]);
    }
}
/** the nearest baked road within `tol` metres of a point, or null */
function near(x, z, tol) {
  let best = null; const G = Math.ceil(tol / CELL);
  for (let gx = -G; gx <= G; gx++) for (let gz = -G; gz <= G; gz++) for (const [w, a, b] of grid.get(key(x + gx * CELL, z + gz * CELL)) || []) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
    if (d < tol && (!best || d < best.d)) best = { w, d };
  }
  return best;
}

// ---------- which service ways could be a public link at all ----------
// a sub-tagged service way is a car-park aisle, a driveway or a drive-through; a public footpath or
// bridleway carrying highway=service is a field path with a surface, not a street; and a way shut
// to cars - or open only to buses - is not a link a learner can drive.
const SUBTAG = new Set(['parking_aisle', 'driveway', 'drive-through', 'slipway', 'bus_stop', 'alley', 'emergency_access']);
const SHUT = new Set(['private', 'no', 'customers', 'delivery', 'permit']);
const FOOT = /^public_(footpath|bridleway)$/;
// a 5 mph limit is a site road - a caravan park, a depot, a hospital campus - not a public street:
// Cherry Blossom Drive's "link" to Reculver Lane is the internal road of the Blue Dolphin trailer park
const drivable = (t) => !t.name && !SUBTAG.has((t.service || '').split(';')[0]) && !SHUT.has(t.access)
  && !SHUT.has(t.motor_vehicle) && !SHUT.has(t.vehicle) && !FOOT.test(t.designation || '') && !t.prow_ref
  && !(mph(t.maxspeed) != null && mph(t.maxspeed) <= 10);
// a gate or a bollard across a link is the whole reason it is unnamed: an emergency or bus access
const BLOCK = new Set(['bollard', 'gate', 'lift_gate', 'swing_gate', 'block', 'bus_trap', 'cycle_barrier', 'motorcycle_barrier', 'stile', 'yes']);
const blocked = new Set(barJ.elements.filter((n) => BLOCK.has(n.tags?.barrier) && n.tags.access !== 'yes').map((n) => n.id));

const have = new Set(R.ways.map((w) => w.id)); // region.json way ids ARE the OSM way ids
const cand = new Map();
for (const e of waysJ.elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.length < 2 || !e.nodes) continue;
  if (!drivable(e.tags || {}) || have.has(e.id)) continue;
  const pts = e.geometry.map((p) => project(p.lat, p.lon));
  if (!pts.some(inBounds)) continue;
  cand.set(e.id, { e, pts, t: e.tags || {} });
}

// ---------- the graph the candidates form ----------
// OSM splits a way at every junction, so one back link between two streets is often two or three
// unnamed service ways in a row, sometimes with a driveway or a yard hanging off the middle. So
// rather than looking at whole ways, walk the node graph and look for the shortest run of tarmac
// from a point on one street to a point on another.
const adj = new Map(), at = new Map(); // node -> [{to, len, way}],  node -> [x, z]
const edge = (a, b, pa, pb, way) => {
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push({ to: b, len, way }); adj.get(b).push({ to: a, len, way });
  at.set(a, pa); at.set(b, pb);
};
for (const [id, c] of cand) for (let i = 0; i < c.e.nodes.length - 1; i++) edge(c.e.nodes[i], c.e.nodes[i + 1], c.pts[i], c.pts[i + 1], id);
// where the candidate tarmac meets a street the game already has
const portal = new Map();
for (const [n, p] of at) { const h = near(p[0], p[1], 8); if (h) portal.set(n, h.w); }

/** the cheapest run of candidate tarmac from `src` to every node, by metres */
function dijkstra(src) {
  const dist = new Map([[src, 0]]), prev = new Map(), q = [[0, src]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, n] = q.shift();
    if (d > (dist.get(n) ?? Infinity)) continue;
    for (const e of adj.get(n) || []) {
      if (blocked.has(e.to)) continue; // a gate or a bollard: not a run a learner can drive
      const nd = d + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, [n, e.way]); q.push([nd, e.to]); }
    }
  }
  return { dist, prev };
}

// ---------- components, and the links each one is missing ----------
const seen = new Set(), comps = [];
for (const n of adj.keys()) {
  if (seen.has(n)) continue;
  const part = [], stack = [n]; seen.add(n);
  while (stack.length) { const a = stack.pop(); part.push(a); for (const e of adj.get(a) || []) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } }
  comps.push(part);
}
const stat = { comps: comps.length, huge: 0, noPair: 0, covered: 0, deck: 0, spanned: 0, sliver: 0, keep: 0 };
const links = [], used = new Map(), endNodes = new Set(); // edge key -> candidate way; every street contact
const street = (w) => w.name || `#${w.id}`; // two halves of one street count as one end
for (const part of comps) {
  const ps = part.filter((n) => portal.has(n) && !blocked.has(n));
  if (new Set(ps.map((n) => street(portal.get(n)))).size < 2) { stat.noPair++; continue; }
  if (part.length > 400 || ps.length > 40) { stat.huge++; console.log(`skipped a ${part.length}-node service network with ${ps.length} street contacts near ${at.get(part[0]).map(r1)}`); continue; }
  // every pair of contacts, cheapest first, keeping only the ones that join streets this component
  // does not already join: the rest would lay a second strip of tarmac along the same back route
  const runs = [];
  for (const a of ps) {
    const { dist, prev } = dijkstra(a);
    for (const b of ps) {
      if (b <= a || !dist.has(b) || street(portal.get(a)) === street(portal.get(b))) continue;
      const nodes = [b]; let cur = b, ids = [];
      while (prev.has(cur)) { const [p, way] = prev.get(cur); ids.push(way); nodes.push(p); cur = p; }
      nodes.reverse(); ids = [...new Set(ids.reverse())];
      runs.push({ a, b, len: dist.get(b), nodes, ids });
    }
  }
  runs.sort((x, y) => x.len - y.len);
  const root = new Map(), find = (k) => { while (root.get(k) !== k) k = root.get(k); return k; };
  for (const n of ps) { const k = street(portal.get(n)); if (!root.has(k)) root.set(k, k); }
  for (const r of runs) {
    const ka = find(street(portal.get(r.a))), kb = find(street(portal.get(r.b)));
    if (ka === kb) { stat.spanned++; continue; }
    // under ten metres this is the junction itself drawn a few metres short, not a road: the loose
    // ends pass in region-fix.mjs is what closes those
    if (r.len < 10) { stat.sliver++; continue; }
    const pts = r.nodes.map((n) => at.get(n));
    if (pts.filter((p) => near(p[0], p[1], 6)).length / pts.length > 0.6) { stat.covered++; continue; } // already tarmac
    // an 8 m match to a road on another deck is a bridge overhead, not a junction
    const members = r.ids.map((i) => cand.get(i).t);
    const deck = (w) => (w.bridge ? 1 : w.tunnel ? -1 : 0) + (w.layer || 0);
    const mine = members.some((t) => t.bridge && t.bridge !== 'no') ? 1 : members.some((t) => t.tunnel && t.tunnel !== 'no') ? -1 : 0;
    if (deck(portal.get(r.a)) !== mine || deck(portal.get(r.b)) !== mine) { stat.deck++; continue; }
    root.set(ka, kb);
    stat.keep++;
    endNodes.add(r.a); endNodes.add(r.b);
    for (let i = 0; i < r.nodes.length - 1; i++) {
      const a = r.nodes[i], b = r.nodes[i + 1];
      used.set(a < b ? `${a}|${b}` : `${b}|${a}`, (adj.get(a) || []).find((e) => e.to === b).way);
    }
    links.push({ from: portal.get(r.a).name || portal.get(r.a).cls, to: portal.get(r.b).name || portal.get(r.b).cls, len: r1(r.len), osm: r.ids, at: pts[0].map(r1) });
  }
}

// ---------- the chosen runs, as carriageway to lay ----------
// Two runs out of one component can share a stretch - a back lane with three streets off it - so the
// chosen edges are pooled and then cut into the longest pieces that have no junction in the middle.
// Nothing is laid twice, and where two pieces do meet they share a node.
const sub = new Map();
for (const k of used.keys()) { const [a, b] = k.split('|').map(Number); if (!sub.has(a)) sub.set(a, []); if (!sub.has(b)) sub.set(b, []); sub.get(a).push(b); sub.get(b).push(a); }
const walked = new Set(), pieces = [];
const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// A street contact that ended one run and began the next has two edges of its own, so it would sit
// in the MIDDLE of a merged piece and never be joined to its street. Cut there as well.
const breaks = [...sub.keys()].filter((n) => sub.get(n).length !== 2 || endNodes.has(n));
for (const start of [...breaks, ...sub.keys()]) for (const first of sub.get(start)) {
  if (walked.has(ekey(start, first))) continue;
  const run = [start]; let prev = start, cur = first;
  for (;;) {
    walked.add(ekey(prev, cur)); run.push(cur);
    if (sub.get(cur).length !== 2 || endNodes.has(cur) || cur === start) break;
    const nxt = sub.get(cur).find((n) => n !== prev);
    if (nxt == null || walked.has(ekey(cur, nxt))) break;
    prev = cur; cur = nxt;
  }
  const ids = [...new Set(run.slice(1).map((n, i) => used.get(ekey(run[i], n))))];
  const members = ids.map((i) => cand.get(i).t);
  let L = 0; for (let i = 1; i < run.length; i++) L += Math.hypot(at.get(run[i])[0] - at.get(run[i - 1])[0], at.get(run[i])[1] - at.get(run[i - 1])[1]);
  // a piece is only laid one-way when it IS one tagged way, since a run stitched out of several is
  // not a single traffic direction. The walk can arrive at either end, so turn the piece round to
  // face the way OSM drew it rather than quietly dropping the restriction.
  const solo = ids.length === 1 ? cand.get(ids[0]).e : null;
  const oneway = !!solo && /^(yes|1|true)$/.test(solo.tags.oneway || '');
  if (oneway && solo.nodes.indexOf(run[0]) > solo.nodes.indexOf(run.at(-1))) run.reverse();
  // the tags the bake reads off a way, taken from whichever member posts one
  const tag = (k) => members.map((t) => t[k]).find((v) => v != null) ?? null;
  pieces.push({
    osm: ids, len: r1(L), oneway, surface: tag('surface'), lit: tag('lit'), sidewalk: tag('sidewalk'),
    limitTag: mph(tag('maxspeed')), bridge: members.some((t) => t.bridge && t.bridge !== 'no'), tunnel: members.some((t) => t.tunnel && t.tunnel !== 'no'),
    layer: members.map((t) => parseInt(t.layer, 10)).find((v) => Number.isFinite(v)) || 0,
    ends: [portal.get(run[0])?.name || portal.get(run[0])?.cls || null, portal.get(run.at(-1))?.name || portal.get(run.at(-1))?.cls || null],
    nodes: run, pts: run.map((n) => at.get(n).map(r1)),
  });
}
pieces.sort((x, y) => y.len - x.len);
// A way cut in two at a junction gives two pieces off one OSM id, so number the repeats the way the
// bake numbers the parts of a clipped way: the first keeps the OSM id, the rest go negative.
const seq = new Map();
for (const p of pieces) { const k = seq.get(p.osm[0]) || 0; seq.set(p.osm[0], k + 1); p.id = k === 0 ? p.osm[0] : -(p.osm[0] * 10 + k); }
links.sort((x, y) => y.len - x.len);
fs.writeFileSync(OUT, JSON.stringify({
  note: 'Unnamed OSM service ways that link two different Kent streets, for tools/region-fix.mjs. Written by tools/service-links.mjs.',
  osm_base: waysJ.osm3s?.timestamp_osm_base || null, bbox: BBOX, origin: O, links, pieces,
}, null, 1) + '\n');
console.log(stat);
console.log(`\n${links.length} street-to-street links, laid as ${pieces.length} pieces, ${(pieces.reduce((s, p) => s + p.len, 0) / 1000).toFixed(2)} km -> ${path.relative(REPO, OUT)}`);
for (const l of links) console.log(`  ${String(l.len).padStart(6)} m  ${l.from} -> ${l.to}  osm ${l.osm.join('+')}  @ ${l.at}`);
const shared = pieces.filter((p) => p.ends.some((e) => !e));
if (shared.length) console.log(`\n${shared.length} of the pieces meet another piece rather than a street at one end (a back lane with more than two streets off it)`);
