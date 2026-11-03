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
    // each map's own house drive and jet-centre road: the city's home is the estate (estate() below)
    if (w.synthetic && /^(Home Drive|Jet Centre Road)$/.test(w.name)) continue;
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
  // A crop can leave streets that only reached the rest through what was cut (Herne Bay's estates that
  // joined it by the roads south): an island nobody can drive to. Keep the area's largest network, as
  // region-data.mjs does at the edge of its own fetch.
  {
    const parent = new Map(), find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    for (const w of ways) { const ns = w.nodes.filter(Boolean); for (const n of ns) if (!parent.has(n)) parent.set(n, n); for (let i = 1; i < ns.length; i++) parent.set(find(ns[i]), find(ns[0])); }
    const root = (w) => find(w.nodes.find(Boolean)), size = new Map();
    for (const w of ways) size.set(root(w), (size.get(root(w)) || 0) + w.pts.length);
    let main = null; for (const [r, n] of size) if (main == null || n > size.get(main)) main = r;
    const before = ways.length, gone = new Set();
    for (let i = ways.length - 1; i >= 0; i--) if (root(ways[i]) !== main) { gone.add(ways[i].id); ways.splice(i, 1); }
    const used = new Set(ways.flatMap((w) => w.nodes));
    for (const n of [...nodes.keys()]) if (!used.has(n)) nodes.delete(n);
    for (const [wid, ps] of pieces) pieces.set(wid, ps.filter((p) => !gone.has(p.id)));
    if (gone.size) console.log(`  ${area.id}: ${gone.size} of ${before} ways were islands once cropped, left out`);
  }
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

/** a smooth road from end x to end y: carry straight on along each road as it leaves its area (no kink
 * at the join), then a cubic curve between. A road that leaves at a slant gets a shorter lead, so it turns
 * out across the country sooner instead of running along the edge of the area. */
function curve(x, nx, y, ny) {
  const P0 = [x.n.x, x.n.z], P3 = [y.n.x, y.n.z], D = hypot(P3[0] - P0[0], P3[1] - P0[1]);
  const lead = (o, s) => D * 0.4 * Math.max(0.3, Math.min(1, o[0] * s[0] + o[1] * s[1]));
  const la = lead(x.out, nx), lb = lead(y.out, ny);
  const P1 = [P0[0] + x.out[0] * la, P0[1] + x.out[1] * la], P2 = [P3[0] + y.out[0] * lb, P3[1] + y.out[1] * lb];
  const n = Math.max(2, Math.ceil(D / 12)), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([+(u ** 3 * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t ** 3 * P3[0]).toFixed(2), +(u ** 3 * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t ** 3 * P3[1]).toFixed(2)]);
  }
  return pts;
}
const lengthOf = (pts) => pts.slice(1).reduce((s, q, i) => s + hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
/** do two polylines cross? */
function cross(a, b) {
  const ccw = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) {
    const d1 = ccw(a[i], a[i + 1], b[j]), d2 = ccw(a[i], a[i + 1], b[j + 1]), d3 = ccw(b[j], b[j + 1], a[i]), d4 = ccw(b[j], b[j + 1], a[i + 1]);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}

/**
 * The road between two areas. Where a dual carriageway leaves both on the facing sides (the A299 out of
 * Herne Bay, Manchester's A34), the link is a dual too: each half carries on one way to the other area's
 * half going the same way, keeping left, so the two never cross. Otherwise it joins the best two-way
 * roads with a 60 mph single carriageway. Side: the edge of `a` the road leaves by; `bSide`, of `b`.
 */
function link(L, areas, ctx) {
  const A = areas.get(L.a), Bz = areas.get(L.b);
  const opp = L.bSide || { N: 'S', S: 'N', E: 'W', W: 'E' }[L.side];
  const normal = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const nA = normal[L.side], nB = normal[opp];
  const onSide = (X, side, n) => (side === 'E' ? Math.abs(n.x - X.box.maxX) : side === 'W' ? Math.abs(n.x - X.box.minX) : side === 'N' ? Math.abs(n.z - X.box.minZ) : Math.abs(n.z - X.box.maxZ)) < 2;
  const byId = (X) => X.byId || (X.byId = new Map(X.ways.map((w) => [w.id, w])));
  // every road end on this side: which way it points out of the area, and for a one-way road whether
  // its traffic is leaving (the edge is its last node) or arriving (its first)
  const ends = (X, side) => {
    const out = [];
    for (const [id, n] of X.nodes) {
      if (!n.edge || n.ways.length !== 1 || !onSide(X, side, n)) continue;
      const w = byId(X).get(n.ways[0]);
      if (!w || w.rb || w.link || (RANK[w.cls] ?? 3) < 4) continue;
      const atStart = w.nodes[0] === id, p = atStart ? w.pts[0] : w.pts[w.pts.length - 1], q = atStart ? w.pts[1] : w.pts[w.pts.length - 2];
      const l = hypot(p[0] - q[0], p[1] - q[1]) || 1;
      out.push({ id, n, w, rank: RANK[w.cls] ?? 3, leaving: w.oneway ? !atStart : null, out: [(p[0] - q[0]) / l, (p[1] - q[1]) / l] });
    }
    return out;
  };
  const ea = ends(A, L.side), eb = ends(Bz, opp);
  // a dual: a leaving half and an arriving half of a major road, within 60 m of each other, the same road
  const duals = (E) => {
    const out = [];
    for (const o of E) for (const i of E) {
      if (o.leaving !== true || i.leaving !== false || o.rank < 6 || i.rank < 6) continue;
      if (hypot(o.n.x - i.n.x, o.n.z - i.n.z) > 60 || (o.w.ref || o.w.name) !== (i.w.ref || i.w.name)) continue;
      out.push({ o, i, x: (o.n.x + i.n.x) / 2, z: (o.n.z + i.n.z) / 2, rank: Math.min(o.rank, i.rank) });
    }
    return out;
  };
  const score = (a, b) => hypot(b.x - a.x, b.z - a.z) - 300 * Math.min(a.rank, b.rank) - 100 * (a.rank + b.rank);
  const base = { nsl: true, lanesSrc: 'derived', rb: null, link: false, bridge: false, tunnel: false, layer: 0, pave: false, rural: true, turnLanes: null, synthetic: true };
  const join = (x, y, pts, props) => {
    const way = { id: wayId(-1), name: L.name || `${A.name} Road`, ref: L.ref || null, ...base, ...props, pts, nodes: pts.map((_, i) => (i === 0 ? x.id : i === pts.length - 1 ? y.id : 0)) };
    x.n.edge = false; y.n.edge = false; x.n.ways.push(way.id); y.n.ways.push(way.id);
    return way;
  };
  // A link may not cut through a third area, the home estate, or another link (two roads crossing with
  // no junction): the best-scoring pair whose road keeps clear of all three is taken.
  const inner = [...areas.values()].map((X) => ({ minX: X.box.minX + 2, maxX: X.box.maxX - 2, minZ: X.box.minZ + 2, maxZ: X.box.maxZ - 2 }));
  const clear = (pts) => pts.every(([x, z], k) => k < 3 || k > pts.length - 4 || (!inner.some((b) => inBox(x, z, b)) && !ctx.zones.some((f) => f.dist(x, z) <= 30)))
    && !ctx.built.some((b) => cross(b, pts));
  const byScore = (list) => list.sort((p, q) => p.sc - q.sc);
  const da = L.single ? [] : duals(ea), db = L.single ? [] : duals(eb);
  for (const { a, b } of byScore(da.flatMap((a) => db.map((b) => ({ a, b, sc: score(a, b) }))))) {
    const there = curve(a.o, nA, b.i, nB), back = curve(b.o, nB, a.i, nA);
    if (cross(there, back) || !clear(there) || !clear(back)) continue;
    const cls = (RANK[a.o.w.cls] >= RANK[b.o.w.cls] ? b.o.w : a.o.w).cls, lanes = Math.max(1, Math.min(a.o.w.lanesF, b.i.w.lanesF, b.o.w.lanesF, a.i.w.lanesF));
    const props = (w1, w2) => ({ cls, limit: 70, oneway: true, dual: true, lanesF: lanes, lanesB: 0, width: Math.max(w1.width, w2.width) });
    const ways = [join(a.o, b.i, there, props(a.o.w, b.i.w)), join(b.o, a.i, back, props(b.o.w, a.i.w))];
    ctx.built.push(there, back);
    return { ways, kind: `dual ${cls}`, from: `${a.o.w.ref || a.o.w.name} (${L.a})`, to: `${b.o.w.ref || b.o.w.name} (${L.b})`, km: lengthOf(there) / 1000 };
  }
  const sa = ea.filter((e) => e.leaving === null), sb = eb.filter((e) => e.leaving === null);
  let pick = null;
  for (const c of byScore(sa.flatMap((x) => sb.map((y) => ({ x, y, sc: score({ ...x.n, rank: x.rank }, { ...y.n, rank: y.rank }) }))))) {
    const pts = curve(c.x, nA, c.y, nB);
    if (clear(pts)) { pick = { ...c, pts }; break; }
  }
  if (!pick) throw new Error(`link ${L.a} ${L.side} -> ${L.b} ${opp}: no road leaving ${L.a} that side reaches one leaving ${L.b} without crossing an area, the estate or another link`);
  const { x, y, pts } = pick;
  ctx.built.push(pts);
  const way = join(x, y, pts, { cls: 'primary', limit: 60, oneway: false, dual: false, lanesF: 1, lanesB: 1, width: Math.max(7.3, x.w.width, y.w.width) });
  return { ways: [way], kind: 'single', from: `${x.w.name || x.w.cls} (${L.a})`, to: `${y.w.name || y.w.cls} (${L.b})`, km: lengthOf(pts) / 1000 };
}

/** one height grid for the whole city: the areas' own hills, and a smooth fill (0 at the city's edge) between */
function terrain(areas, bounds, flat = []) {
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
  // the house and the jet park are built level, at height 0: their ground is held at 0, and for 300 m
  // round it the hills are let go, so the fill below eases them down to it
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i, d = Math.min(Infinity, ...flat.map((f) => f.dist(x, z)));
    if (d <= 0) { h[k] = 0; fixed[k] = 1; } else if (d < 300) fixed[k] = 0;
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

/**
 * Home: the house and, beside it, the jet park, at points in an area's own metres (CITY.home). Each is
 * built level by house.js / airfield.js, so their ground is flattened (terrain), nothing is built on
 * them, and each gate gets a private service road to the nearest quiet street, as kent-data.mjs gave
 * Beltinge its Home Drive and Maypole its Jet Centre Road.
 */
function estate(cfg, areas) {
  const A = areas.get(cfg.area);
  const home = { x: A.ox + cfg.house[0], z: A.oz + cfg.house[1] }, airfield = { x: A.ox + cfg.jets[0], z: A.oz + cfg.jets[1] };
  // airfield.js: the fenced site x -230..+45, z -920..+50 of its origin, the approach strip x +-40, z -1320..-920
  const rects = [
    { minX: airfield.x - 230, maxX: airfield.x + 45, minZ: airfield.z - 920, maxZ: airfield.z + 50 },
    { minX: airfield.x - 40, maxX: airfield.x + 40, minZ: airfield.z - 1320, maxZ: airfield.z - 920 },
  ];
  const rectDist = (r, x, z) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
  const zones = [
    { dist: (x, z) => hypot(x - home.x, z - home.z) - 120 }, // the house, its garden and the garage court
    ...rects.map((r) => ({ dist: (x, z) => rectDist(r, x, z) - 40 })),
  ];
  return { home, airfield, zones, gates: [['Home Drive', [home.x, home.z + 42]], ['Jet Centre Road', [airfield.x - 120, airfield.z + 50]]] };
}
let nextNodeId = 50_000_000; // nodes the bake adds itself (drive gates and joins), clear of every area's range
/** a two-point private road from a gate to the foot of the perpendicular on the nearest quiet two-way street */
function addDrive(name, gate, ways, nodes) {
  let best = null;
  for (const w of ways) {
    const r = RANK[w.cls] ?? 3;
    if (w.oneway || w.rb || w.synthetic || w.link || r < 2 || r > 5) continue;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((gate[0] - a[0]) * dx + (gate[1] - a[1]) * dz) / L2)), q = [a[0] + dx * t, a[1] + dz * t], d = hypot(q[0] - gate[0], q[1] - gate[1]);
      if (!best || d < best.d) best = { w, i, t, q, d };
    }
  }
  if (!best || best.d > 900) throw new Error(`${name}: no street within 900 m of its gate (${gate})`);
  const { w, i, q } = best, node = (x, z) => { const id = nextNodeId++; nodes.set(id, { x: +x.toFixed(2), z: +z.toFixed(2), ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false }); return id; };
  let join;
  if (hypot(q[0] - w.pts[i][0], q[1] - w.pts[i][1]) < 1.5) join = w.nodes[i] || (w.nodes[i] = node(...w.pts[i]));
  else if (hypot(q[0] - w.pts[i + 1][0], q[1] - w.pts[i + 1][1]) < 1.5) join = w.nodes[i + 1] || (w.nodes[i + 1] = node(...w.pts[i + 1]));
  else { join = node(q[0], q[1]); w.pts.splice(i + 1, 0, [+q[0].toFixed(2), +q[1].toFixed(2)]); w.nodes.splice(i + 1, 0, join); }
  if (!nodes.get(join).ways.includes(w.id)) nodes.get(join).ways.push(w.id);
  const g = node(gate[0], gate[1]);
  const drive = { id: wayId(-1), name, ref: null, cls: 'service', limit: 20, nsl: false, oneway: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived', rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0,
    width: 5.0, pave: false, rural: false, turnLanes: null, pts: [[gate[0], gate[1]], [+q[0].toFixed(2), +q[1].toFixed(2)]], nodes: [g, join], synthetic: true };
  nodes.get(g).ways.push(drive.id); nodes.get(join).ways.push(drive.id);
  return { drive, to: w.name || w.cls, m: Math.round(best.d) };
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
const E = CITY.home.house ? estate(CITY.home, areas) : null;
const linkCtx = { zones: E ? E.zones : [], built: [] };
const links = CITY.links.map((L) => link(L, areas, linkCtx));
const all = (k) => [...areas.values()].flatMap((A) => A[k]);
const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
for (const A of areas.values()) { box.minX = Math.min(box.minX, A.box.minX); box.maxX = Math.max(box.maxX, A.box.maxX); box.minZ = Math.min(box.minZ, A.box.minZ); box.maxZ = Math.max(box.maxZ, A.box.maxZ); }
const bounds = { minX: box.minX - 1500, maxX: box.maxX + 1500, minZ: box.minZ - 1500, maxZ: box.maxZ + 1500 };
const home = areas.get(CITY.home.area);
const ways = [...all('ways'), ...links.flatMap((l) => l.ways)];
const inEstate = (x, z) => !!E && E.zones.some((f) => f.dist(x, z) <= 0);
const drives = E ? E.gates.map(([name, gate]) => addDrive(name, gate, ways, nodes)) : [];
for (const d of drives) ways.push(d.drive);
for (const A of areas.values()) A.buildings = A.buildings.filter((b) => !b.pts.some((p) => inEstate(p[0], p[1])));
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
  buildings: all('buildings'), landuse: [...all('landuse'), ...countryside(areas, bounds)].filter((l) => !inEstate(...centroid(l.pts))), landmarks: all('landmarks'),
  // each area is a place in its own right, so the signs at a link road name the next area
  places: [...[...areas.values()].map((A) => ({ name: A.name, x: (A.box.minX + A.box.maxX) / 2, z: (A.box.minZ + A.box.maxZ) / 2, r: Math.round(hypot(A.box.maxX - A.box.minX, A.box.maxZ - A.box.minZ) / 2 + 200), rank: 1 })), ...all('places').filter((p) => !CITY.areas.some((a) => a.name === p.name))],
  testCentres: all('testCentres'),
  home: E ? E.home : home.home || null, airfield: E ? E.airfield : home.airfield,
  terrain: terrain(areas, bounds, E ? E.zones : []),
};
const file = path.join(ROOT, 'public/assets/city/region.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${CITY.name}: ${areas.size} areas, ${ways.length} ways, ${nodes.size} nodes, ${out.roundabouts.length} rings, ${out.signals.length} signal nodes, ${out.testCentres.length} test centres, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
for (const A of areas.values()) console.log(`  ${A.name.padEnd(12)} at ${A.ox},${A.oz}  ${A.ways.length} ways, ${A.testCentres.map((t) => t.name).join(', ')}`);
for (const l of links) console.log(`  link (${l.kind}) ${l.from} -> ${l.to}: ${l.km.toFixed(2)} km`);
if (E) console.log(`  home at ${E.home.x},${E.home.z}, jets at ${E.airfield.x},${E.airfield.z}; ${drives.map((d) => `${d.drive.name} ${d.m} m to ${d.to}`).join(', ')}`);
