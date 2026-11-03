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

/**
 * area.rejoin: [{ way, at: [x, z], onto }] -- end `way` at its point nearest `at` with a T onto `onto` (at
 * the foot of the perpendicular, a new node there), dropping the rest of it towards the junction the two
 * share. For a junction OpenStreetMap draws as two roads converging for tens of metres: their
 * carriageways overlap, and traffic going opposite ways on them meets head on and can never pass.
 */
function rejoin(d, fixes = []) {
  let maxNode = 0; for (const id of Object.keys(d.nodes)) maxNode = Math.max(maxNode, +id);
  for (const f of fixes) {
    const w = d.ways.find((x) => x.id === f.way), J = d.ways.find((x) => x.id === f.onto);
    if (!w || !J) throw new Error(`rejoin: no way ${!w ? f.way : f.onto}`);
    let k = 0; w.pts.forEach((p, i) => { if (hypot(p[0] - f.at[0], p[1] - f.at[1]) < hypot(w.pts[k][0] - f.at[0], w.pts[k][1] - f.at[1])) k = i; });
    const tailEnd = J.nodes.includes(w.nodes[w.nodes.length - 1]); // the end the two already share
    if (!tailEnd && !J.nodes.includes(w.nodes[0])) throw new Error(`rejoin: ways ${f.way} and ${f.onto} share no end`);
    let best = null;
    for (let i = 0; i < J.pts.length - 1; i++) {
      const a = J.pts[i], b = J.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0.05, Math.min(0.95, ((w.pts[k][0] - a[0]) * dx + (w.pts[k][1] - a[1]) * dz) / L2)), q = [+(a[0] + dx * t).toFixed(1), +(a[1] + dz * t).toFixed(1)];
      const dd = hypot(q[0] - w.pts[k][0], q[1] - w.pts[k][1]);
      if (!best || dd < best.dd) best = { i, q, dd };
    }
    const id = ++maxNode;
    d.nodes[id] = { x: best.q[0], z: best.q[1], ways: [J.id, w.id], signals: false, crossing: null, giveWay: true, stop: false, mini: false, levelCrossing: false };
    J.pts.splice(best.i + 1, 0, best.q); J.nodes.splice(best.i + 1, 0, id);
    if (tailEnd) { w.pts = [...w.pts.slice(0, k + 1), best.q]; w.nodes = [...w.nodes.slice(0, k + 1), id]; }
    else { w.pts = [best.q, ...w.pts.slice(k)]; w.nodes = [id, ...w.nodes.slice(k)]; }
    console.log(`  rejoined ${w.name || w.id} onto ${J.name || J.id} at (${best.q}), ${best.dd.toFixed(0)} m from its point at (${w.pts[tailEnd ? w.pts.length - 2 : 1]})`);
  }
}

/** one area, cropped and renumbered (still in its own metres; moved at the end) */
function prepare(area, d, k) {
  rejoin(d, area.rejoin);
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

/**
 * No road ends at the edge of an area. The crop cut every street that ran on past the box; a link road
 * carries a few of them on to the next area, and the rest stopped dead at a No Entry sign in a field.
 * Now each one runs on out to a ring road round the outside of its area, OUTER m beyond the box, and
 * meets it at a T. The ring is split wherever a link road leaves the area (it never crosses one), and
 * each piece runs only from the first street it serves to the last, so none of it wanders off along an
 * empty side (into the sea off Herne Bay). A piece with one street on it, or with only one-way streets
 * all going the same way, carries on to the link road beside it and meets that at a T instead. Where a
 * street is one-way out of the area at the end of a piece, the ring takes its traffic on one way as far
 * as a street that leads back in, so no stretch of it is a trap. Two street ends within MERGE m of each
 * other (the two halves of one road, mostly) become one end, so their junctions are not a metre apart;
 * a street whose way out would run alongside a link road leaving next to it meets that link road at a T.
 * Every new way is marked `outer`: a test or lesson route never leaves its area along one, and town
 * traffic keeps to the town (kent/traffic.js).
 */
const OUTER = 60, MERGE = 10, GAP = 25, CLEAR = 40;
function outerRoads(A, ways, nodes, linkWays) {
  const b = A.box, W = b.maxX - b.minX, H = b.maxZ - b.minZ, R = OUTER, q = (Math.PI * R) / 2, P = 2 * W + 2 * H + 4 * q;
  const off = { N: 0, E: W + q, S: W + H + 2 * q, W: 2 * W + H + 3 * q };
  const wrap = (p) => ((p % P) + P) % P;
  // the ring's point at perimeter position p, its direction of travel (p increasing: clockwise on the map) and outward normal
  const ringAt = (p0) => {
    let p = wrap(p0);
    const arc = (cx, cz, a0) => { const a = a0 + p / R; return { x: cx + R * Math.cos(a), z: cz + R * Math.sin(a), t: [-Math.sin(a), Math.cos(a)] }; };
    let r;
    if (p < W) r = { x: b.minX + p, z: b.minZ - R, t: [1, 0] };
    else if ((p -= W) < q) r = arc(b.maxX, b.minZ, -Math.PI / 2);
    else if ((p -= q) < H) r = { x: b.maxX + R, z: b.minZ + p, t: [0, 1] };
    else if ((p -= H) < q) r = arc(b.maxX, b.maxZ, 0);
    else if ((p -= q) < W) r = { x: b.maxX - p, z: b.maxZ + R, t: [-1, 0] };
    else if ((p -= W) < q) r = arc(b.minX, b.maxZ, Math.PI / 2);
    else if ((p -= q) < H) r = { x: b.minX - R, z: b.maxZ - p, t: [0, -1] };
    else { p -= H; r = arc(b.minX, b.minZ, Math.PI); }
    r.n = [r.t[1], -r.t[0]];
    return r;
  };
  // the perimeter position of a point on the box (a street end the crop made)
  const boxP = (x, z) => {
    const d = { N: z - b.minZ, S: b.maxZ - z, W: x - b.minX, E: b.maxX - x };
    const side = Object.keys(d).reduce((m, k) => (d[k] < d[m] ? k : m), 'N');
    const c = (v, L) => Math.max(0, Math.min(L, v));
    return off[side] + (side === 'N' ? c(x - b.minX, W) : side === 'E' ? c(z - b.minZ, H) : side === 'S' ? c(b.maxX - x, W) : c(b.maxZ - z, H));
  };
  const ring = []; for (let p = 0; p < P; p += 5) ring.push({ ...ringAt(p), p });
  const byId = new Map(ways.map((w) => [w.id, w]));

  // ---- the street ends ----
  let ends = [];
  const NORMAL = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  // (and a street whose OpenStreetMap end is within a few metres of the edge, heading out: it reads the same)
  const nearEdge = (n) => Math.min(n.x - b.minX, b.maxX - n.x, n.z - b.minZ, b.maxZ - n.z) < 10;
  for (const [id, n] of A.nodes) {
    if (!(n.edge || nearEdge(n)) || n.ways.length !== 1) continue;
    const w = byId.get(n.ways[0]); if (!w || w.rb || (w.nodes[0] !== id && w.nodes[w.nodes.length - 1] !== id)) continue;
    const atStart = w.nodes[0] === id, e = atStart ? w.pts[0] : w.pts[w.pts.length - 1];
    // the way the street leaves: from the first point back along it at least a metre away (the crop can leave a 0 m last step)
    let f = null; for (let k = 1; k < w.pts.length && !f; k++) { const q = w.pts[atStart ? k : w.pts.length - 1 - k]; if (hypot(q[0] - e[0], q[1] - e[1]) > 1) f = q; }
    if (!f) f = atStart ? w.pts[w.pts.length - 1] : w.pts[0];
    const l = hypot(e[0] - f[0], e[1] - f[1]) || 1;
    // traffic on a one-way street either comes out here ('in' to the ring) or goes in ('out' of it)
    const kind = w.oneway ? (atStart ? 'out' : 'in') : 'both';
    const dd = { N: n.z - b.minZ, S: b.maxZ - n.z, W: n.x - b.minX, E: b.maxX - n.x }, side = Object.keys(dd).reduce((m, k) => (dd[k] < dd[m] ? k : m), 'N');
    if (!n.edge && ((e[0] - f[0]) * NORMAL[side][0] + (e[1] - f[1]) * NORMAL[side][1]) / l < 0.3) continue; // (a close that only happens to stop near the edge)
    ends.push({ id, n, w, rank: RANK[w.cls] ?? 3, kind, p: boxP(n.x, n.z), out: [(e[0] - f[0]) / l, (e[1] - f[1]) / l], normal: NORMAL[side] });
  }
  ends.sort((u, v) => u.p - v.p);
  // two ends a few metres apart are one end: the second street is bent onto the first's end node
  let merged = 0;
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i];
    for (let j = i + 1; j < ends.length && ends[j].p - a.p < MERGE * 2; j++) {
      const c = ends[j];
      if (c.w === a.w || hypot(c.n.x - a.n.x, c.n.z - a.n.z) > MERGE) continue;
      const k = c.w.nodes[0] === c.id ? 0 : c.w.nodes.length - 1, k2 = k ? k - 1 : 1;
      c.w.pts[k] = [a.n.x, a.n.z]; c.w.nodes[k] = a.id; a.n.ways.push(c.w.id); nodes.delete(c.id); A.nodes.delete(c.id);
      // (a bare point the end now sits on is dropped, so the street has no 0 m step)
      if (c.w.pts.length > 2 && !c.w.nodes[k2] && hypot(c.w.pts[k2][0] - a.n.x, c.w.pts[k2][1] - a.n.z) < 1) { c.w.pts.splice(k2, 1); c.w.nodes.splice(k2, 1); }
      a.kind = a.kind === c.kind ? a.kind : 'both';
      if (c.rank > a.rank) { a.w = c.w; a.rank = c.rank; } // the connector is the bigger road's
      ends.splice(j--, 1); merged++;
    }
  }
  // Each street carries straight on out of the area, unless that would take it across or into its
  // neighbour's (two streets leaving at a slant towards each other): then both leave square to the edge.
  const lead = (e, d) => [[e.n.x, e.n.z], [e.n.x + d[0] * 30, e.n.z + d[1] * 30]];
  const segDist = (s, t) => {
    const pd = (p, a, c) => { const dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return hypot(a[0] + dx * u - p[0], a[1] + dz * u - p[1]); };
    return cross(s, t) ? 0 : Math.min(pd(s[0], ...t), pd(s[1], ...t), pd(t[0], ...s), pd(t[1], ...s));
  };
  for (const e of ends) e.dep = e.out[0] * e.normal[0] + e.out[1] * e.normal[1] > 0.3 ? e.out : e.normal;
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i], c = ends[(i + 1) % ends.length];
    if (a === c || hypot(a.n.x - c.n.x, a.n.z - c.n.z) > 60) continue;
    if (segDist(lead(a, a.dep), lead(c, c.dep)) < (a.w.width + c.w.width) / 2 + 1.5) { a.dep = a.normal; c.dep = c.normal; }
  }

  // ---- where the link roads leave (or pass) the area: the ring is cut there and never crosses them ----
  const signed0 = (d) => { d = wrap(d); return d > P / 2 ? d - P : d; };
  const segX = (a, c, d, e) => {
    const r = [c[0] - a[0], c[1] - a[1]], s = [e[0] - d[0], e[1] - d[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((d[0] - a[0]) * s[1] - (d[1] - a[1]) * s[0]) / den, u = ((d[0] - a[0]) * r[1] - (d[1] - a[1]) * r[0]) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
  };
  const cuts = [];
  for (const w of linkWays) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], c = w.pts[i + 1];
      if (Math.max(a[0], c[0]) < b.minX - R - 5 || Math.min(a[0], c[0]) > b.maxX + R + 5 || Math.max(a[1], c[1]) < b.minZ - R - 5 || Math.min(a[1], c[1]) > b.maxZ + R + 5) continue;
      for (let k = 0; k < ring.length; k++) {
        const r0 = ring[k], r1 = ring[(k + 1) % ring.length], x = segX([r0.x, r0.z], [r1.x, r1.z], a, c);
        if (!x) continue;
        const pr = r0.p + x.t * (k + 1 < ring.length ? r1.p - r0.p : P - r0.p);
        // where it leaves the box: its own end node if it starts at one of this area's street ends
        const endN = [w.nodes[0], w.nodes[w.nodes.length - 1]].map((id) => A.nodes.get(id)).find((n) => n && (Math.abs(n.x - b.minX) < 2 || Math.abs(n.x - b.maxX) < 2 || Math.abs(n.z - b.minZ) < 2 || Math.abs(n.z - b.maxZ) < 2));
        if (cuts.some((C) => C.w === w && Math.abs(signed0(C.pr - pr)) < 2)) continue; // (a ring sample landing on it twice)
        cuts.push({ w, i, t: x.u, at: [a[0] + (c[0] - a[0]) * x.u, a[1] + (c[1] - a[1]) * x.u], pr: wrap(pr), pb: endN ? boxP(endN.x, endN.z) : wrap(pr) });
      }
    }
  }
  if (!cuts.length) throw new Error(`${A.id}: no link road leaves the area`);
  cuts.sort((u, v) => u.pb - v.pb);

  // ---- each stretch of the edge between two cuts: its street ends, their places on the ring ----
  const signed = signed0;
  const out = [], tees = new Map(); // link way -> [{ i, t, at, node }]
  let joined = 0, extended = 0, oneways = 0, teed = 0;
  const node = (x, z) => newNode(nodes, x, z);
  const props = (w) => ({ name: w.name, ref: w.ref, cls: (RANK[w.cls] ?? 9) >= 5 ? 'tertiary' : w.cls, limit: Math.min(w.limit || 30, 40), nsl: false, oneway: false, lanesF: w.lanesF || 1, lanesB: w.oneway ? 0 : w.lanesB || 1,
    lanesSrc: 'derived', rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: w.width, pave: false, rural: true, turnLanes: null, synthetic: true, outer: 'join' });
  const RING = { name: `${A.name} Ring Road`, ref: null, cls: 'tertiary', limit: 40, nsl: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived', rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 7.3, pave: false, rural: true, turnLanes: null, synthetic: true, outer: 'ring' };
  const add = (p, pts, ids) => { const way = { id: wayId(-1), ...p, pts: pts.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]), nodes: ids }; for (const id of ids) if (id) nodes.get(id).ways.push(way.id); out.push(way); return way; };
  const bez = (P0, d0, P3, d3, k) => {
    const P1 = [P0[0] + d0[0] * k, P0[1] + d0[1] * k], P2 = [P3[0] - d3[0] * k, P3[1] - d3[1] * k], L = hypot(P3[0] - P0[0], P3[1] - P0[1]), n = Math.max(3, Math.ceil(L / 6)), pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u ** 3 * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t ** 3 * P3[0], u ** 3 * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t ** 3 * P3[1]]); }
    return pts;
  };
  for (let c = 0; c < cuts.length; c++) {
    const L = cuts[c], Rt = cuts[(c + 1) % cuts.length];
    const span = cuts.length === 1 ? P : wrap(Rt.pb - L.pb);
    const g = ends.filter((e) => { const u = wrap(e.p - L.pb); return u > 0 && u < span; }).map((e) => ({ ...e, u: wrap(e.p - L.pb) })).sort((x, y) => x.u - y.u);
    if (!g.length) continue;
    // on the ring, clear of where the two link roads cross it
    const lo = signed(L.pr - L.pb) + CLEAR, hi = span + signed(Rt.pr - Rt.pb) - CLEAR;
    // where each street meets the ring; `ext`: the piece carries on to the link road at that end (L or R)
    let ext = null;
    const plan = () => {
      const k = g.length, allIn = g.every((e) => e.kind === 'in'), allOut = g.every((e) => e.kind === 'out');
      // carry on to a link road at the end nearer the last street (one street; or all one way, one way)
      ext = k === 1 || allIn || allOut ? (g[0].u - lo <= hi - g[k - 1].u ? 'L' : 'R') : null;
      // the two end streets turn into the ring along it (the anchor a ring's width along), the rest meet it square
      g.forEach((e, i) => { e.end = (i === 0 && ext !== 'L') || (i === k - 1 && ext !== 'R'); e.first = i === 0; e.a = Math.max(lo, Math.min(hi, e.u + (e.end ? (i === 0 ? R : -R) : 0))); });
      for (let i = 1; i < k; i++) g[i].a = Math.max(g[i].a, g[i - 1].a + GAP);
      g[k - 1].a = Math.min(g[k - 1].a, hi);
      for (let i = k - 2; i >= 0; i--) g[i].a = Math.min(g[i].a, g[i + 1].a - GAP);
      for (const e of g) {
        const r = ringAt(L.pb + e.a);
        e.r = r; e.pts = bez([e.n.x, e.n.z], e.dep, [r.x, r.z], e.end ? (e.first ? r.t : [-r.t[0], -r.t[1]]) : r.n, e.end ? R * 0.55 : R * 0.4);
      }
    };
    // A street whose way out to the ring would run alongside a link road leaving next to it (or that has no
    // room on the ring at all: one between the two halves of a dual link) meets that link road at a T instead.
    const clash = (e) => {
      if (e.a < lo - 1 || e.a > hi + 1) return near(e, [L.w, Rt.w]);
      for (const w of linkWays) for (const p of e.pts) for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], c2 = w.pts[i + 1];
        if (Math.abs(a[0] - p[0]) > 60 && Math.abs(c2[0] - p[0]) > 60) continue;
        if (segDist([p, p], [a, c2]) < (w.width + e.w.width) / 2 + 1) return w;
      }
      return null;
    };
    const near = (e, list) => list.reduce((best, w) => { const d = Math.min(...w.pts.map((p) => hypot(p[0] - e.n.x, p[1] - e.n.z))); return !best || d < best.d ? { w, d } : best; }, null).w;
    const teeOnto = (e, w) => {
      const M = [e.n.x + e.dep[0] * 30, e.n.z + e.dep[1] * 30];
      let best = null;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], c2 = w.pts[i + 1], dx = c2[0] - a[0], dz = c2[1] - a[1], L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0.05, Math.min(0.95, ((M[0] - a[0]) * dx + (M[1] - a[1]) * dz) / L2)), at = [a[0] + dx * t, a[1] + dz * t], dd = hypot(at[0] - M[0], at[1] - M[1]);
        if (!best || dd < best.dd) best = { i, t, at, dd };
      }
      const id = node(best.at[0], best.at[1]); let list = tees.get(w); if (!list) tees.set(w, (list = [])); list.push({ i: best.i, t: best.t, at: best.at, node: id });
      const to = [best.at[0] - e.n.x, best.at[1] - e.n.z], tl = hypot(...to) || 1;
      const pts = bez([e.n.x, e.n.z], e.dep, best.at, [to[0] / tl, to[1] / tl], tl * 0.35), ids = [e.id, ...pts.slice(1, -1).map(() => 0), id];
      const p = props(e.w);
      if (e.kind === 'both') add(p, pts, ids); else if (e.kind === 'in') add({ ...p, oneway: true }, pts, ids); else add({ ...p, oneway: true }, pts.slice().reverse(), ids.slice().reverse());
      e.n.edge = false; joined++; teed++;
    };
    for (let iter = 0; iter < 4 && g.length; iter++) {
      plan();
      const bad = g.map((e) => [e, clash(e)]).filter(([, w]) => w);
      if (!bad.length) break;
      for (const [e, w] of bad) { teeOnto(e, w); g.splice(g.indexOf(e), 1); }
    }
    if (!g.length) continue;
    const k = g.length;
    if (g[0].a < lo - 1 || g[k - 1].a > hi + 1) console.warn(`  ${A.id}: ${k} street ends squeezed into ${Math.round(hi - lo)} m of ring at p ${Math.round(L.pb)}`);
    // the chain along the ring: its nodes (street junctions, and the link road at an extended end)
    const chain = g.map((e) => ({ u: e.a, kind: e.kind, e, end: e.end }));
    // (a piece either side of the same link road meets it at the same node: a crossroads)
    const cutAt = (C, u) => {
      if (!C.node) { C.node = node(C.at[0], C.at[1]); let list = tees.get(C.w); if (!list) tees.set(C.w, (list = [])); list.push({ i: C.i, t: C.t, at: C.at, node: C.node }); }
      return { u, kind: 'both', id: C.node, link: true };
    };
    if (ext === 'L') chain.unshift(cutAt(L, signed(L.pr - L.pb)));
    if (ext === 'R') chain.push(cutAt(Rt, span + signed(Rt.pr - Rt.pb)));
    if (ext) extended++;
    for (const h of chain) if (!h.id) { const r = ringAt(L.pb + h.u); h.id = node(r.x, r.z); }
    // which way each stretch of the chain runs: one way from an end street that only comes out, until a street leads back in
    const dir = new Array(chain.length - 1).fill(0);
    for (let i = 0; i < chain.length - 1 && chain[i].kind === 'in'; i++) dir[i] = 1;
    for (let i = chain.length - 1; i > 0 && chain[i].kind === 'in'; i--) dir[i - 1] = dir[i - 1] === 1 ? 1 : -1;
    // ring points between two chain nodes, every 10 m (a link road end is the exact point the link crosses)
    const along = (h0, h1) => {
      const pts = []; for (let u = h0.u; u < h1.u - 2; u += 10) { const r = ringAt(L.pb + u); pts.push([r.x, r.z]); }
      const r = ringAt(L.pb + h1.u); pts.push([r.x, r.z]);
      const exact = (h) => [nodes.get(h.id).x, nodes.get(h.id).z];
      if (h0.link) pts[0] = exact(h0);
      if (h1.link) pts[pts.length - 1] = exact(h1);
      return pts;
    };
    // stretches with the same direction are one way (road)
    for (let i = 0; i < chain.length - 1;) {
      let j = i + 1; while (j < chain.length - 1 && dir[j] === dir[i]) j++;
      let pts = [], ids = [];
      for (let m = i; m < j; m++) {
        const seg = along(chain[m], chain[m + 1]);
        if (m === i) { pts.push(...seg); ids.push(chain[m].id, ...seg.slice(1, -1).map(() => 0), chain[m + 1].id); }
        else { pts.push(...seg.slice(1)); ids.push(...seg.slice(1, -1).map(() => 0), chain[m + 1].id); }
      }
      if (dir[i] === -1) { pts.reverse(); ids.reverse(); }
      if (dir[i]) oneways++;
      add({ ...RING, oneway: !!dir[i], lanesB: dir[i] ? 0 : 1 }, pts, ids);
      i = j;
    }
    // each street on to its node on the ring: square to it, or (at an end of the chain) turning along it
    for (const h of chain) {
      if (h.link) continue;
      const e = h.e, pts = e.pts, ids = [e.id, ...pts.slice(1, -1).map(() => 0), h.id];
      const p = props(e.w);
      if (e.kind === 'both') add(p, pts, ids);
      else if (e.kind === 'in') add({ ...p, oneway: true }, pts, ids);
      else add({ ...p, oneway: true }, pts.slice().reverse(), ids.slice().reverse());
      e.n.edge = false; joined++;
    }
  }
  // the link roads get a node where a ring piece meets them
  for (const [w, list] of tees) {
    list.sort((x, y) => y.i - x.i || y.t - x.t); // from the far end, so the indexes still to come stay put
    for (const t of list) { w.pts.splice(t.i + 1, 0, [+t.at[0].toFixed(2), +t.at[1].toFixed(2)]); w.nodes.splice(t.i + 1, 0, t.node); nodes.get(t.node).ways.push(w.id); }
  }
  const left = [...A.nodes.values()].filter((n) => n.edge && n.ways.length === 1).length;
  return { ways: out, note: `${ends.length + merged} street ends (${merged} merged into a neighbour), ${joined} joined (${teed} straight on to a link road beside them), ${extended} ring pieces carried on to a link road, ${oneways} one-way stretches, ${left} left` };
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
 * them, and they get private roads to the nearest quiet street (estateRoads), as kent-data.mjs gave
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
  // the house faces south: its drive leaves the gate 42 m south of it (house.js driveEnd), and the jet
  // park's gate is at its origin + (-120, 50); `junction` is where the two private roads meet
  const junction = cfg.junction ? [A.ox + cfg.junction[0], A.oz + cfg.junction[1]] : null;
  return { home, airfield, zones, junction, homeGate: [home.x, home.z + 42], jetGate: [airfield.x - 120, airfield.z + 50] };
}
let nextNodeId = 50_000_000; // nodes the bake adds itself (drive gates and joins), clear of every area's range
const newNode = (nodes, x, z) => { const id = nextNodeId++; nodes.set(id, { x: +x.toFixed(2), z: +z.toFixed(2), ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false }); return id; };
const privateRoad = (name, pts, ids, nodes) => {
  const way = { id: wayId(-1), name, ref: null, cls: 'service', limit: 20, nsl: false, oneway: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived', rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0,
    width: 5.0, pave: false, rural: false, turnLanes: null, pts: pts.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]), nodes: ids, synthetic: true };
  for (const id of ids) if (id) nodes.get(id).ways.push(way.id);
  return way;
};
/**
 * A straight private road from node `from` (at point `at`) to the nearest quiet two-way street it can reach
 * without crossing a link road or running through the estate, joined at the foot of the perpendicular. A
 * street end the crop left at an area's edge stops being one (no cap, no No Entry sign: the road goes on).
 */
function addDrive(name, at, from, ways, nodes, avoid) {
  const cands = [];
  for (const w of ways) {
    const r = RANK[w.cls] ?? 3;
    if (w.oneway || w.rb || (w.synthetic && w.outer !== 'ring') || w.link || r < 2 || r > 5) continue;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dz) / L2)), q = [a[0] + dx * t, a[1] + dz * t], d = hypot(q[0] - at[0], q[1] - at[1]);
      if (d < 900) cands.push({ w, i, q, d });
    }
  }
  cands.sort((p, q) => p.d - q.d);
  const best = cands.find((c) => { const seg = [at, c.q]; return !avoid.lines.some((l) => cross(l, seg)) && [0.25, 0.5, 0.75].every((f) => !avoid.inside(at[0] + (c.q[0] - at[0]) * f, at[1] + (c.q[1] - at[1]) * f)); });
  if (!best) throw new Error(`${name}: no street within 900 m of (${at}) reachable without crossing a link or the estate`);
  const { w, i, q } = best;
  let join;
  if (hypot(q[0] - w.pts[i][0], q[1] - w.pts[i][1]) < 1.5) join = w.nodes[i] || (w.nodes[i] = newNode(nodes, ...w.pts[i]));
  else if (hypot(q[0] - w.pts[i + 1][0], q[1] - w.pts[i + 1][1]) < 1.5) join = w.nodes[i + 1] || (w.nodes[i + 1] = newNode(nodes, ...w.pts[i + 1]));
  else { join = newNode(nodes, q[0], q[1]); w.pts.splice(i + 1, 0, [+q[0].toFixed(2), +q[1].toFixed(2)]); w.nodes.splice(i + 1, 0, join); }
  const jn = nodes.get(join);
  if (!jn.ways.includes(w.id)) jn.ways.push(w.id);
  jn.edge = false;
  return { drive: privateRoad(name, [at, q], [from, join], nodes), to: w.name || w.cls, m: Math.round(best.d) };
}
/**
 * The estate's roads: the Home Drive straight south out of the house's gate (it faces that way: a drive
 * leaving the gate at a slant ran back past the house, through the garden), the Jet Centre Road from the
 * jet park's gate to it at the junction, and from there one road on to the nearest quiet street.
 */
function estateRoads(E, ways, nodes, avoid) {
  const J = E.junction || [E.homeGate[0], E.homeGate[1] + 300];
  const g1 = newNode(nodes, ...E.homeGate), g2 = newNode(nodes, ...E.jetGate), j = newNode(nodes, ...J);
  // each gate is in its site's south fence: both roads leave it heading south, the jet park's turning across
  // to the junction once it is level with it (run straight along the fence, it was a wall for 100 m)
  const bend = [E.jetGate[0], J[1]];
  const roads = [privateRoad('Home Drive', [E.homeGate, J], [g1, j], nodes), privateRoad('Jet Centre Road', [E.jetGate, bend, J], [g2, 0, j], nodes)];
  const out = addDrive('Home Drive', J, j, ways, nodes, avoid);
  return { roads: [...roads, out.drive], note: `Home Drive ${Math.round(hypot(J[0] - E.homeGate[0], J[1] - E.homeGate[1]))} m south from the gate, Jet Centre Road ${Math.round(lengthOf(roads[1].pts))} m to it, then ${out.m} m on to ${out.to}` };
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
const outer = [...areas.values()].map((A) => ({ A, ...outerRoads(A, A.ways, nodes, links.flatMap((l) => l.ways)) }));
ways.push(...outer.flatMap((o) => o.ways));
const inEstate = (x, z) => !!E && E.zones.some((f) => f.dist(x, z) <= 0);
// (the private roads may not cross a link road or a ring road, nor run through the house or the jet park themselves)
const estateAvoid = { lines: [...linkCtx.built, ...outer.flatMap((o) => o.ways.map((w) => w.pts))], inside: (x, z) => !!E && hypot(x - E.home.x, z - E.home.z) < 100 };
const estateNet = E ? estateRoads(E, ways, nodes, estateAvoid) : null;
if (estateNet) ways.push(...estateNet.roads);
for (const A of areas.values()) A.buildings = A.buildings.filter((b) => !b.pts.some((p) => inEstate(p[0], p[1])));
// a building kept for its centre that pokes out past the crop into a ring road, or a street's way out to one, is left out
{
  const G = 20, grid = new Map(), at = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  for (const w of outer.flatMap((o) => o.ways)) for (let i = 0; i < w.pts.length - 1; i++) {
    const a = w.pts[i], c = w.pts[i + 1], L = hypot(c[0] - a[0], c[1] - a[1]) || 1;
    for (let t = 0; t <= L; t += 1.5) { const p = [a[0] + ((c[0] - a[0]) * t) / L, a[1] + ((c[1] - a[1]) * t) / L, w.width / 2 + 1.5], k = at(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  }
  const segD = (p, a, c) => { const dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return hypot(a[0] + dx * u - p[0], a[1] + dz * u - p[1]); };
  const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const inTheWay = (b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let i = Math.floor((x0 - 10) / G); i <= Math.floor((x1 + 10) / G); i++) for (let j = Math.floor((z0 - 10) / G); j <= Math.floor((z1 + 10) / G); j++)
      for (const p of grid.get(`${i},${j}`) || []) if (inside(p, b.pts) || b.pts.some((q, k) => segD(p, q, b.pts[(k + 1) % b.pts.length]) < p[2])) return true;
    return false;
  };
  let gone = 0;
  for (const A of areas.values()) A.buildings = A.buildings.filter((b) => { const hit = inTheWay(b); if (hit) gone++; return !hit; });
  console.log(`  ${gone} buildings at the edge of an area left out: in the way of a ring road or a way out to one`);
}
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
  // a junction's own light plan (driving-city.mjs `signals`), by its group name in the city
  signalPlans: Object.fromEntries(CITY.areas.flatMap((a) => Object.entries(a.signals || {}).map(([k, v]) => [`${a.id}:${k}`, v]))),
  home: E ? E.home : home.home || null, airfield: E ? E.airfield : home.airfield,
  terrain: terrain(areas, bounds, E ? E.zones : []),
};
const file = path.join(ROOT, 'public/assets/city/region.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${CITY.name}: ${areas.size} areas, ${ways.length} ways, ${nodes.size} nodes, ${out.roundabouts.length} rings, ${out.signals.length} signal nodes, ${out.testCentres.length} test centres, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
for (const A of areas.values()) console.log(`  ${A.name.padEnd(12)} at ${A.ox},${A.oz}  ${A.ways.length} ways, ${A.testCentres.map((t) => t.name).join(', ')}`);
for (const l of links) console.log(`  link (${l.kind}) ${l.from} -> ${l.to}: ${l.km.toFixed(2)} km`);
for (const o of outer) console.log(`  ${o.A.name} Ring Road: ${o.note}`);
if (E) console.log(`  home at ${E.home.x},${E.home.z}, jets at ${E.airfield.x},${E.airfield.z}; ${estateNet.note}`);
