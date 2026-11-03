// node tools/city-merge.mjs: bake Driving City (tools/driving-city.mjs) into public/assets/city/region.json.
//
// Each area's baked region.json is cropped (optionally), moved to its place, and given its own node-id
// range: region-data.mjs numbers nodes from 1 in every region, so they would collide. Kent keeps its own
// ids, because its hand-made test pools (kent/test-routes.js) name Kent nodes. Way ids are OSM ids and
// stay as they are; a way cut by a crop, a synthetic way, and the link roads get fresh negative ids.
// Every record that names a node or a way (rings, lights, crossings, calming, level crossings) is
// carried across with it. The hills are one grid over the whole city: each area's own heights inside
// it, and a smooth fill across the country between, so a link road climbs gently from one to the next.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY } from './driving-city.mjs';
import { groundHeight } from '../src/worlds/ground.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/assets/${id}/region.json`), 'utf8'));
const hypot = Math.hypot;
const RANK = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 3, living_street: 2, service: 1 };

let nextWayId = -3_000_000_000; // fresh ids for cut pieces and link roads, clear of anything OSM or a bake uses
const usedWays = new Set();
const wayId = (id) => { if (id > 0 && !usedWays.has(id)) { usedWays.add(id); return id; } const n = nextWayId--; usedWays.add(n); return n; };

/** [t0, t1] of segment a->b inside box C (Liang-Barsky), or null */
function clipSeg(a, b, C) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - C.minX], [dx, C.maxX - a[0]], [-dz, a[1] - C.minZ], [dz, C.maxZ - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}
const inBox = (x, z, C) => x >= C.minX && x <= C.maxX && z >= C.minZ && z <= C.maxZ;

/** the parts of a polyline inside C: [{pts, idx}] where idx[k] is the source index of pts[k], or -1 for a cut point */
function clipLine(pts, C) {
  if (pts.every((p) => inBox(p[0], p[1], C))) return [{ pts, idx: pts.map((_, i) => i), whole: true }];
  const out = []; let cur = inBox(pts[0][0], pts[0][1], C) ? { pts: [pts[0]], idx: [0] } : null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], r = clipSeg(a, b, C);
    if (!r) continue;
    const at = (t) => [+(a[0] + (b[0] - a[0]) * t).toFixed(2), +(a[1] + (b[1] - a[1]) * t).toFixed(2)];
    if (r[0] > 0) cur = { pts: [at(r[0])], idx: [-1] };
    if (r[1] < 1) { cur.pts.push(at(r[1])); cur.idx.push(-1); out.push(cur); cur = null; }
    else { cur.pts.push(b); cur.idx.push(i); }
  }
  if (cur) out.push(cur);
  // a sliver a metre long at a corner of the box is no road
  return out.filter((p) => p.pts.length >= 2 && p.pts.slice(1).reduce((s, q, k) => s + hypot(q[0] - p.pts[k][0], q[1] - p.pts[k][1]), 0) > 1);
}
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };

/** one area, cropped and renumbered (still in its own metres; moved at the end) */
function prepare(area, d, k) {
  const B = d.bounds, C = area.crop || B;
  const base = area.id === 'kent' ? 0 : (k + 1) * 1_000_000;
  let maxNode = 0; for (const id of Object.keys(d.nodes)) maxNode = Math.max(maxNode, +id);
  const nodes = new Map(); // new id -> record
  const nid = (old) => (old ? base + old : 0);
  const ways = [], pieces = new Map(); // source way id -> [{id, nodes}]
  for (const w of d.ways) {
    if (area.drop?.(w)) continue;
    const parts = clipLine(w.pts, C);
    for (const part of parts) {
      const pn = part.idx.map((i) => (i >= 0 ? nid(w.nodes[i]) : base + ++maxNode));
      // cut points are new end nodes on the box: a road that now ends at the edge of this area
      part.idx.forEach((i, j) => { if (i < 0) nodes.set(pn[j], { x: part.pts[j][0], z: part.pts[j][1], ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false, edge: true }); });
      const id = part.whole ? wayId(w.id) : wayId(-1);
      ways.push({ ...w, id, pts: part.pts, nodes: pn });
      let a = pieces.get(w.id); if (!a) pieces.set(w.id, (a = [])); a.push({ id, nodes: pn, pts: part.pts });
    }
  }
  for (const w of ways) for (const n of w.nodes) if (n && !nodes.has(n)) { const src = d.nodes[n - base]; if (src) nodes.set(n, { ...src, ways: [] }); }
  for (const w of ways) for (const n of w.nodes) if (n) nodes.get(n).ways.push(w.id);
  const kept = (old) => nodes.has(nid(old));
  const pieceAt = (wid, newNode) => (pieces.get(wid) || []).find((p) => p.nodes.includes(newNode))?.id ?? null;
  const sAlong = (pts, j) => { let s = 0; for (let i = 1; i <= j; i++) s += hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
  const pieceNear = (wid, x, z) => {
    let best = null, bd = Infinity;
    for (const p of pieces.get(wid) || []) for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], tx = b[0] - a[0], tz = b[1] - a[1], L2 = tx * tx + tz * tz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * tx + (z - a[1]) * tz) / L2)), d2 = (a[0] + tx * t - x) ** 2 + (a[1] + tz * t - z) ** 2;
      if (d2 < bd) { bd = d2; best = { id: p.id, s: sAlong(p.pts, i) + Math.sqrt(L2) * t }; }
    }
    return best;
  };
  const roundabouts = (d.roundabouts || []).filter((rb) => rb.ringNodes.every(kept)).map((rb) => ({
    ...rb, ringNodes: rb.ringNodes.map(nid), ringWays: rb.ringWays.map((w) => pieces.get(w)?.[0]?.id ?? w),
    arms: rb.arms.map((a) => ({ ...a, node: nid(a.node), exitNode: nid(a.exitNode),
      entryWays: (a.entryWays || []).map((w) => pieceAt(w, nid(a.node)) ?? pieceAt(w, nid(a.exitNode))).filter(Boolean),
      exitWays: (a.exitWays || []).map((w) => pieceAt(w, nid(a.exitNode)) ?? pieceAt(w, nid(a.node))).filter(Boolean) })),
  }));
  const ringIds = new Set(roundabouts.map((rb) => rb.id));
  for (const w of ways) if (w.rb && !ringIds.has(w.rb)) w.rb = null; // (a ring the crop cut through is not kept: none should be)
  const onNode = (r) => kept(r.node);
  const out = {
    ways, nodes,
    roundabouts,
    minis: (d.minis || []).filter(onNode).map((m) => ({ ...m, node: nid(m.node) })),
    signals: (d.signals || []).filter(onNode).map((s) => ({ ...s, node: nid(s.node), ways: s.ways.map((w) => pieceAt(w, nid(s.node))).filter(Boolean), junction: `${area.id}:${s.junction}` })),
    crossings: (d.crossings || []).filter(onNode).map((c) => {
      const id = pieceAt(c.way, nid(c.node)); if (!id) return null;
      const p = pieces.get(c.way).find((q) => q.id === id);
      return { ...c, node: nid(c.node), way: id, s: +sAlong(p.pts, p.nodes.indexOf(nid(c.node))).toFixed(1) };
    }).filter(Boolean),
    calming: (d.calming || []).filter((c) => inBox(c.x, c.z, C)).map((c) => { const p = pieceNear(c.way, c.x, c.z); return p && { ...c, way: p.id, s: +p.s.toFixed(1) }; }).filter(Boolean),
    levelCrossings: (d.levelCrossings || []).filter(onNode).map((c) => ({ ...c, node: nid(c.node), way: pieceAt(c.way, nid(c.node)) })).filter((c) => c.way),
    railways: (d.railways || []).flatMap((r) => clipLine(r.pts, C).map((p) => ({ ...r, pts: p.pts }))),
    rivers: (d.rivers || []).flatMap((r) => clipLine(r.pts, C).map((p) => ({ ...r, pts: p.pts }))),
    coastline: d.coastline || [], sea: d.sea || [],
    buildings: (d.buildings || []).filter((b) => inBox(...centroid(b.pts), C)),
    landuse: (d.landuse || []).filter((l) => inBox(...centroid(l.pts), C)),
    landmarks: (d.landmarks || []).filter((l) => inBox(l.x, l.z, C)),
    places: (d.places || []).filter((p) => !p.far && inBox(p.x, p.z, C)),
    testCentres: (d.testCentres || []).filter((t) => inBox(t.x, t.z, C)).map((t) => ({ ...t, area: area.id })),
    crop: C, terrain: d.terrain, home: d.home, airfield: d.airfield,
  };
  return out;
}

/** move every coordinate in an area by (ox, oz) */
function shift(A, ox, oz) {
  const P = (p) => [+(p[0] + ox).toFixed(2), +(p[1] + oz).toFixed(2)];
  const XZ = (r) => r && { ...r, x: +(r.x + ox).toFixed(2), z: +(r.z + oz).toFixed(2) };
  for (const w of A.ways) w.pts = w.pts.map(P);
  for (const n of A.nodes.values()) { n.x = +(n.x + ox).toFixed(2); n.z = +(n.z + oz).toFixed(2); }
  A.roundabouts = A.roundabouts.map(XZ); A.minis = A.minis.map(XZ); A.signals = A.signals.map(XZ); A.crossings = A.crossings.map(XZ);
  A.calming = A.calming.map(XZ); A.levelCrossings = A.levelCrossings.map(XZ); A.landmarks = A.landmarks.map(XZ); A.places = A.places.map(XZ); A.testCentres = A.testCentres.map(XZ);
  for (const k of ['railways', 'rivers', 'buildings', 'landuse']) A[k] = A[k].map((r) => ({ ...r, pts: r.pts.map(P), ...(r.box ? { box: [r.box[0] + ox, r.box[1] + oz, r.box[2] + ox, r.box[3] + oz] } : {}) }));
  A.coastline = A.coastline.map(P); A.sea = A.sea.map(P);
  A.home = XZ(A.home); A.airfield = XZ(A.airfield);
  A.box = { minX: A.crop.minX + ox, maxX: A.crop.maxX + ox, minZ: A.crop.minZ + oz, maxZ: A.crop.maxZ + oz };
  A.ox = ox; A.oz = oz;
}

/** a road between two areas: from the best road leaving `a` on `side` to the best leaving `b` on the far side */
function link(L, areas, nodes) {
  const A = areas.get(L.a), Bz = areas.get(L.b);
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[L.side];
  const normal = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const onSide = (X, side, n) => (side === 'E' ? Math.abs(n.x - X.box.maxX) : side === 'W' ? Math.abs(n.x - X.box.minX) : side === 'N' ? Math.abs(n.z - X.box.minZ) : Math.abs(n.z - X.box.maxZ)) < 2;
  const ends = (X, side) => {
    const out = [];
    for (const [id, n] of X.nodes) {
      if (!n.edge || n.ways.length !== 1 || !onSide(X, side, n)) continue;
      const w = X.ways.find((q) => q.id === n.ways[0]);
      if (!w || w.oneway || w.rb || w.link || (RANK[w.cls] ?? 3) < 4) continue;
      const atStart = w.nodes[0] === id, p = atStart ? w.pts[0] : w.pts[w.pts.length - 1], q = atStart ? w.pts[1] : w.pts[w.pts.length - 2];
      const l = hypot(p[0] - q[0], p[1] - q[1]) || 1;
      out.push({ id, n, w, out: [(p[0] - q[0]) / l, (p[1] - q[1]) / l] });
    }
    return out;
  };
  const ea = ends(A, L.side), eb = ends(Bz, opp);
  if (!ea.length || !eb.length) throw new Error(`link ${L.a} ${L.side} -> ${L.b}: no two-way road leaves ${!ea.length ? L.a : L.b} on that side`);
  const nrm = normal[L.side];
  let best = null;
  for (const x of ea) for (const y of eb) {
    const dx = y.n.x - x.n.x, dz = y.n.z - x.n.z, across = Math.abs(dx * nrm[1] - dz * nrm[0]);
    const score = across - 300 * Math.min(RANK[x.w.cls], RANK[y.w.cls]) - 100 * (RANK[x.w.cls] + RANK[y.w.cls]);
    if (!best || score < best.score) best = { x, y, score };
  }
  const { x, y } = best;
  // carry straight on along each road as it leaves its area (no kink at the join), then a smooth curve
  // between. A road that leaves at a slant gets a shorter lead, so it turns out across the country
  // sooner instead of running along the edge of the area.
  const P0 = [x.n.x, x.n.z], P3 = [y.n.x, y.n.z], D = hypot(P3[0] - P0[0], P3[1] - P0[1]);
  const lead = (o, s) => D * 0.4 * Math.max(0.3, Math.min(1, o[0] * s[0] + o[1] * s[1]));
  const la = lead(x.out, nrm), lb = lead(y.out, [-nrm[0], -nrm[1]]);
  const P1 = [P0[0] + x.out[0] * la, P0[1] + x.out[1] * la], P2 = [P3[0] + y.out[0] * lb, P3[1] + y.out[1] * lb];
  const n = Math.max(2, Math.ceil(D / 12)), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([+(u ** 3 * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t ** 3 * P3[0]).toFixed(2), +(u ** 3 * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t ** 3 * P3[1]).toFixed(2)]);
  }
  const way = {
    id: wayId(-1), name: L.name || `${A.name} Road`, ref: L.ref || null, cls: 'primary', limit: 60, nsl: true, oneway: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived',
    rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: Math.max(7.3, x.w.width, y.w.width), pave: false, rural: true, turnLanes: null,
    pts, nodes: pts.map((_, i) => (i === 0 ? x.id : i === pts.length - 1 ? y.id : 0)), synthetic: true,
  };
  x.n.edge = false; y.n.edge = false; x.n.ways.push(way.id); y.n.ways.push(way.id);
  return { way, from: `${x.w.name || x.w.cls} (${L.a})`, to: `${y.w.name || y.w.cls} (${L.b})`, km: way.pts.slice(1).reduce((s, q, i) => s + hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0) / 1000 };
}

/** one height grid for the whole city: the areas' own hills, and a smooth fill (0 at the city's edge) between */
function terrain(areas, bounds) {
  const step = 100, x0 = Math.floor(bounds.minX / step) * step, z0 = Math.floor(bounds.minZ / step) * step;
  const nx = Math.ceil((bounds.maxX - x0) / step) + 1, nz = Math.ceil((bounds.maxZ - z0) / step) + 1;
  const h = new Float64Array(nx * nz), fixed = new Uint8Array(nx * nz);
  for (const A of areas.values()) {
    if (!A.terrain) continue;
    const at = groundHeight(A.terrain), T = A.terrain;
    const tx0 = T.x0 + A.ox, tz0 = T.z0 + A.oz, tx1 = tx0 + (T.nx - 1) * T.step, tz1 = tz0 + (T.nz - 1) * T.step;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      if (x < tx0 || x > tx1 || z < tz0 || z > tz1 || !inBox(x, z, A.box)) continue;
      h[j * nx + i] = at(x - A.ox, z - A.oz); fixed[j * nx + i] = 1;
    }
  }
  // between the areas: relax towards the average of the neighbours (a soap film across the gaps)
  for (let it = 0; it < 800; it++) for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i; if (fixed[k]) continue;
    h[k] = (h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx]) / 4;
  }
  let min = Infinity, max = -Infinity; for (const v of h) { if (v < min) min = v; if (v > max) max = v; }
  return { source: 'the areas\' own EU-DEM grids, joined by tools/city-merge.mjs', step, x0, z0, nx, nz, base: 0, min: +min.toFixed(1), max: +max.toFixed(1), heights: [...h].map((v) => +v.toFixed(1)) };
}

/**
 * The country between the areas: a patchwork of fields (farmland, pasture, the odd wood) on a jittered
 * 250 m grid whose corners are shared, so the fields tile with no gaps. Only cells wholly outside every
 * area are laid; inside, the area's own OpenStreetMap landuse stands, which stops dead at the edge of its
 * fetch and left a straight seam of bare grass against the open land.
 */
function countryside(areas, bounds) {
  let seed = 20261103;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const S = 250, x0 = bounds.minX, z0 = bounds.minZ, nx = Math.ceil((bounds.maxX - x0) / S), nz = Math.ceil((bounds.maxZ - z0) / S);
  const corner = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const edge = i === 0 || j === 0 || i === nx || j === nz;
    corner.push([+(x0 + i * S + (edge ? 0 : (rnd() - 0.5) * 90)).toFixed(1), +(z0 + j * S + (edge ? 0 : (rnd() - 0.5) * 90)).toFixed(1)]);
  }
  const at = (i, j) => corner[j * (nx + 1) + i];
  const boxes = [...areas.values()].map((A) => A.box);
  // keep the part of a polygon on the outer side of one edge of a box (Sutherland-Hodgman, one plane)
  const clipOut = (pts, b, side) => {
    const keep = { E: (p) => p[0] >= b.maxX, W: (p) => p[0] <= b.minX, S: (p) => p[1] >= b.maxZ, N: (p) => p[1] <= b.minZ }[side];
    const cut = (p, q) => {
      const t = side === 'E' ? (b.maxX - p[0]) / (q[0] - p[0]) : side === 'W' ? (b.minX - p[0]) / (q[0] - p[0]) : side === 'S' ? (b.maxZ - p[1]) / (q[1] - p[1]) : (b.minZ - p[1]) / (q[1] - p[1]);
      return [+(p[0] + (q[0] - p[0]) * t).toFixed(1), +(p[1] + (q[1] - p[1]) * t).toFixed(1)];
    };
    const out = [];
    pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length]; if (keep(p)) { out.push(p); if (!keep(q)) out.push(cut(p, q)); } else if (keep(q)) out.push(cut(p, q)); });
    return out.length >= 3 ? out : null;
  };
  const out = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let pts = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    const hits = boxes.filter((b) => pts.some((p) => inBox(p[0], p[1], b)));
    if (hits.length > 1) continue;
    if (hits.length) {
      // straddling one edge of an area: lay only the part outside it (at a corner of the box, nothing)
      const b = hits[0], cx = pts.reduce((s, p) => s + p[0], 0) / 4, cz = pts.reduce((s, p) => s + p[1], 0) / 4;
      const sides = [cx > b.maxX - S && 'E', cx < b.minX + S && 'W', cz > b.maxZ - S && 'S', cz < b.minZ + S && 'N'].filter(Boolean);
      if (sides.length !== 1 || !(pts = clipOut(pts, b, sides[0]))) continue;
    }
    const r = rnd();
    out.push({ kind: r < 0.7 ? 'farmland' : r < 0.92 ? 'grass' : 'wood', pts });
  }
  return out;
}

// ---------- bake ----------
const areas = new Map();
CITY.areas.forEach((area, k) => {
  const d = read(area.id);
  const A = prepare(area, d, k);
  A.name = area.name; A.id = area.id; A.origin = d.origin; A.attribution = d.attribution;
  shift(A, area.at[0], area.at[1]);
  areas.set(area.id, A);
});
const nodes = new Map();
for (const A of areas.values()) for (const [id, n] of A.nodes) { if (nodes.has(id)) throw new Error(`node id ${id} in two areas`); nodes.set(id, n); }
const links = CITY.links.map((L) => link(L, areas, nodes));
const all = (k) => [...areas.values()].flatMap((A) => A[k]);
const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
for (const A of areas.values()) { box.minX = Math.min(box.minX, A.box.minX); box.maxX = Math.max(box.maxX, A.box.maxX); box.minZ = Math.min(box.minZ, A.box.minZ); box.maxZ = Math.max(box.maxZ, A.box.maxZ); }
const bounds = { minX: box.minX - 1500, maxX: box.maxX + 1500, minZ: box.minZ - 1500, maxZ: box.maxZ + 1500 };
const home = areas.get(CITY.home);
const ways = [...all('ways'), ...links.map((l) => l.way)];
const out = {
  attribution: [...new Set([...areas.values()].map((A) => A.attribution))].join(' | '),
  osm_base: 'per area, see each area\'s own region.json',
  region: CITY.id, name: CITY.name,
  idNote: 'node ids: each area\'s own (from its region.json) plus a million per area, Kent unchanged; way ids are OSM way ids (negative = cut at a crop, synthetic, or a Driving City link road)',
  origin: home.origin,
  bounds,
  areas: [...areas.values()].map((A) => ({ id: A.id, name: A.name, x: A.ox, z: A.oz, box: A.box })),
  ways,
  nodes: Object.fromEntries([...nodes].map(([id, n]) => [id, n])),
  roundabouts: all('roundabouts'), minis: all('minis'), signals: all('signals'), crossings: all('crossings'), calming: all('calming'),
  levelCrossings: all('levelCrossings'), railways: all('railways'), rivers: all('rivers'),
  coastline: all('coastline'), sea: all('sea'),
  buildings: all('buildings'), landuse: [...all('landuse'), ...countryside(areas, bounds)], landmarks: all('landmarks'),
  // each area is a place in its own right, so the signs at a link road name the next area
  places: [...[...areas.values()].map((A) => ({ name: A.name, x: (A.box.minX + A.box.maxX) / 2, z: (A.box.minZ + A.box.maxZ) / 2, r: Math.max(A.box.maxX - A.box.minX, A.box.maxZ - A.box.minZ) / 2, rank: 1 })), ...all('places').filter((p) => !CITY.areas.some((a) => a.name === p.name))],
  testCentres: all('testCentres'),
  home: home.home || null, airfield: home.airfield,
  terrain: terrain(areas, bounds),
};
const file = path.join(ROOT, 'public/assets/city/region.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${CITY.name}: ${areas.size} areas, ${ways.length} ways, ${nodes.size} nodes, ${out.roundabouts.length} rings, ${out.signals.length} signal nodes, ${out.testCentres.length} test centres, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
for (const A of areas.values()) console.log(`  ${A.name.padEnd(12)} at ${A.ox},${A.oz}  ${A.ways.length} ways, ${A.testCentres.map((t) => t.name).join(', ')}`);
for (const l of links) console.log(`  link ${l.from} -> ${l.to}: ${l.km.toFixed(2)} km`);
