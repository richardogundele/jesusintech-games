import * as THREE from 'three';
import { drapeGeometry } from '../worlds/terrain.js';
import {
  LW, LW_RING_SMALL, PAVE_W, KERB_W, KERB_H, Y_ROAD, Y_MARK, Y_DECAL, Y_PAVE,
  PATTERNS, centrePattern, hazardPattern, lanePattern, edgeWidth, hazardReach, arrowLength, wordHeight,
  GeoBatch, frameAt, frameIndex, offsetPt, ribbon, ribbonRuns, wrapInterval, samplesBetween, stripAlong, dashesAlong, transverse, transverseDashes,
  zigzag, hatch, chevrons, strokeSeg, strokePolyline, curvedArrow, arrowPolygon, placePolygon, subtract, union, marks,
} from './markings.js';

// Road geometry for the Kent world, one 500 m tile at a time. Ways from region.json become
// ribbons (frames with miter normals, world-space UVs), junction nodes get a patch disc and
// bell-mouth fillets, and the UK markings are laid on top as geometry: centre / hazard / lane /
// edge lines, give-way and stop lines, zig-zags and zebras, double yellows, hatching and
// chevrons. Roundabouts get ring lane lines, a kerbed island, splitter islands and entry lines.
// Everything is merged into one mesh per material per tile; decals (arrows, words) are quads
// with a material from `mats.decal(id, opts)` (src/signs.js) or a plain white shape when that
// is missing. Far tiles get asphalt only.
//
// Conventions: x east, z south, left-hand traffic, leftOf((dx,dz)) = (dz,-dx). A way's frames
// run in its point order; offsets are positive on the left. For an arm leaving a node along
// the way in direction `dir` (+1 / -1), the approaching driver's nearside half is the side
// `-dir` of the way frame (the way's left when dir = -1, its right when dir = +1).

export const TILE = 500;
export const OVERLAP = 15;

const RANK = { trunk: 7, trunk_link: 6, primary: 6, primary_link: 5, secondary: 5, secondary_link: 4, tertiary: 4, tertiary_link: 3, unclassified: 3, residential: 2, living_street: 1, service: 0 };
const TOWN_CENTRE_R = 350;   // double yellows this close to a town's place point
const FLARE_LEN = 40;        // roundabout approach widening
const GORE_LEN = 60;         // slip-road taper
const DEG = Math.PI / 180;

export const tileKey = (tx, tz) => `${tx},${tz}`;
export function tileBounds(tx, tz) {
  return { tx, tz, x0: tx * TILE, z0: tz * TILE, x1: (tx + 1) * TILE, z1: (tz + 1) * TILE, cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE };
}

// ---------- net view: accept a RoadNet (net.js) or the raw region.json ----------

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const wayIdOf = (e) => (e && typeof e === 'object' ? (e.way && typeof e.way === 'object' ? e.way.id : e.way ?? e.id) : e);

/** Normalised, cached view of the network with the per-way geometry and per-node analysis. */
export function netView(net) {
  if (net.__kentRoads) return net.__kentRoads;
  const data = net.data ?? net.region ?? net;
  const wayList = net.ways instanceof Map ? [...net.ways.values()] : Array.isArray(net.ways) ? net.ways : Array.isArray(data.ways) ? data.ways : [];
  const ways = new Map(wayList.map((w) => [w.id, w]));
  const nodes = new Map();
  const nodeSrc = net.nodes instanceof Map ? [...net.nodes.entries()] : Object.entries(net.nodes ?? data.nodes ?? {});
  for (const [k, n] of nodeSrc) {
    const id = typeof k === 'number' ? k : Number(k);
    nodes.set(id, {
      id, x: n.x, z: n.z, wayIds: (n.ways || []).map(wayIdOf).filter((w) => ways.has(w)),
      signals: !!n.signals, crossing: n.crossing || null, giveWay: !!n.giveWay, stop: !!n.stop, mini: !!n.mini, levelCrossing: !!n.levelCrossing,
    });
  }
  // every node shared by two ways is a junction even if the data forgot to list it
  const seen = new Map();
  for (const w of ways.values()) for (const id of w.nodes || []) {
    if (!id) continue; // 0 / null marks a plain vertex
    if (!seen.has(id)) seen.set(id, [w.id]); else seen.get(id).push(w.id);
  }
  for (const [id, list] of seen) {
    if (list.length < 2) continue;
    const n = nodes.get(id);
    if (!n) {
      const w = ways.get(list[0]), i = w.nodes.indexOf(id);
      nodes.set(id, { id, x: w.pts[i][0], z: w.pts[i][1], wayIds: list, signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false });
    } else for (const wid of list) if (!n.wayIds.includes(wid)) n.wayIds.push(wid);
  }
  const pick = (k) => (Array.isArray(net[k]) ? net[k] : net[k] instanceof Map ? [...net[k].values()] : Array.isArray(data[k]) ? data[k] : []);
  const rbs = pick('roundabouts');
  const ringWayRb = new Map(), ringNodeRb = new Map();
  for (const rb of rbs) {
    for (const wid of rb.ringWays || []) ringWayRb.set(wid, rb);
    for (const nid of rb.ringNodes || []) ringNodeRb.set(nid, rb);
  }
  for (const w of ways.values()) {
    const rbId = w.rb ?? (w.roundabout ? 'rb' : null);
    if (rbId && !ringWayRb.has(w.id)) {
      const rb = rbs.find((r) => r.id === rbId);
      if (rb) ringWayRb.set(w.id, rb);
    }
    const rb = ringWayRb.get(w.id);
    if (rb) for (const nid of w.nodes || []) ringNodeRb.set(nid, rb);
  }
  const view = {
    net, data, ways, nodes, rbs, ringWayRb, ringNodeRb,
    minis: pick('minis'), crossings: pick('crossings'), signals: pick('signals'), places: pick('places'),
    calming: pick('calming'), // speed humps, cushions and tables, each pinned to a way at arc length s
    bounds: net.bounds ?? data.bounds ?? null,
    desc: new Map(), prep: new Map(), info: new Map(), index: new Map(),
  };
  buildIndex(view);
  net.__kentRoads = view;
  return view;
}

/** per-way descriptor with defaults for anything the data left out */
function descOf(view, way) {
  let d = view.desc.get(way.id);
  if (d) return d;
  const cls = way.cls || way.class || 'residential';
  const rank = RANK[cls] ?? 2;
  const rb = view.ringWayRb.get(way.id) || null;
  const oneway = !!way.oneway || !!rb;
  const lanesF = Math.max(1, num(way.lanesF ?? way.lanes_fwd, 1));
  const lanesB = oneway ? 0 : Math.max(0, num(way.lanesB ?? way.lanes_bwd, 1));
  const limit = num(way.limit ?? way.maxspeed_mph, way.nsl ? (oneway && way.dual ? 70 : 60) : 30);
  let width = num(way.width ?? way.width_m, 0);
  if (rb) {
    const lanes = Math.max(1, num(rb.lanes, 1)), laneW = num(rb.r, 20) < 12 ? LW_RING_SMALL : LW;
    width = lanes === 1 ? (num(rb.r, 20) < 12 ? 6.0 : 7.0) : lanes * laneW;
  } else if (!width) {
    if (oneway) width = lanesF * LW + (way.link ? 0.4 : 0);
    else if (lanesF + lanesB > 2) width = (lanesF + lanesB) * LW;
    else width = cls === 'service' ? 5.0 : cls === 'residential' || cls === 'living_street' ? 6.0 : cls === 'unclassified' ? 6.5 : 7.3;
  }
  let pave = way.pave != null ? !!way.pave : (!way.rural && rank <= 4 && !oneway) || (way.rural === false);
  if (cls === 'service' || way.link || limit >= 50 || (oneway && way.dual && limit >= 50)) pave = false;
  d = {
    id: way.id, cls, rank, oneway, lanesF, lanesB, limit, nsl: !!way.nsl, width, hw: width / 2,
    pave, rural: way.rural != null ? !!way.rural : !pave, rb, dual: !!way.dual && oneway && !way.link && !rb, link: !!way.link,
    bridge: !!way.bridge, tunnel: !!way.tunnel, layer: num(way.layer, 0), name: way.name || null, ref: way.ref || null,
    turnLanes: Array.isArray(way.turnLanes ?? way.turn_lanes) ? (way.turnLanes ?? way.turn_lanes) : null,
    mat: roadSurface(way, cls, limit, pave),
    centreLine: !oneway && (rank >= 4 || width >= 6.5),
    edgeLines: !oneway && !pave && rank >= 3,
  };
  // the lanes a driver in each direction has, and the lateral position of the centre line
  d.fwdW = oneway ? width : (width * lanesF) / (lanesF + lanesB);
  d.centreOff = d.hw - d.fwdW;
  view.desc.set(way.id, d);
  return d;
}

function buildIndex(view) {
  const add = (key, kind, item) => {
    let cell = view.index.get(key);
    if (!cell) view.index.set(key, (cell = { ways: new Set(), nodes: new Set(), rbs: new Set(), minis: [], crossings: [], signals: [] }));
    if (kind === 'ways' || kind === 'nodes' || kind === 'rbs') cell[kind].add(item); else cell[kind].push(item);
  };
  for (const w of view.ways.values()) {
    if (!w.pts || w.pts.length < 2) continue;
    const pad = descOf(view, w).hw + 3 + OVERLAP;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
      const x0 = Math.floor((Math.min(ax, bx) - pad) / TILE), x1 = Math.floor((Math.max(ax, bx) + pad) / TILE);
      const z0 = Math.floor((Math.min(az, bz) - pad) / TILE), z1 = Math.floor((Math.max(az, bz) + pad) / TILE);
      for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) add(tileKey(tx, tz), 'ways', w);
    }
  }
  const at = (x, z) => tileKey(Math.floor(x / TILE), Math.floor(z / TILE));
  for (const n of view.nodes.values()) add(at(n.x, n.z), 'nodes', n.id);
  for (const rb of view.rbs) add(at(rb.x, rb.z), 'rbs', rb);
  for (const m of view.minis) add(at(m.x, m.z), 'minis', m);
  for (const c of view.crossings) add(at(c.x, c.z), 'crossings', c);
  for (const s of view.signals) add(at(s.x, s.z), 'signals', s);
}

// ---------- node analysis ----------

const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
/** unit direction of a way leaving its vertex i in direction dir (+1 towards higher indices) */
function wayDirAt(way, i, dir) {
  const j = Math.max(0, Math.min(way.pts.length - 1, i + dir));
  const [ax, az] = way.pts[i], [bx, bz] = way.pts[j];
  return norm(bx - ax, bz - az);
}

/** fillet radius by road character: tight in town, generous on rural A-roads */
const filletRadius = (d) => (d.cls === 'service' ? 4 : d.pave ? 6 : d.rank >= 5 ? 10 : 8);

/**
 * Everything the builders need to know about a node: its arms (way, direction, geometry),
 * which arms give way, the patch radius, the bell-mouth fillets between adjacent arms, how far
 * each arm's pavement and ribbon are trimmed, and special roles (ring node, merge gore).
 */
function nodeInfo(view, id) {
  let info = view.info.get(id);
  if (info) return info;
  const node = view.nodes.get(id);
  const arms = [];
  for (const wid of node.wayIds) {
    const way = view.ways.get(wid);
    if (!way || !way.nodes) continue;
    const d = descOf(view, way);
    for (let i = 0; i < way.nodes.length; i++) {
      if (way.nodes[i] !== id) continue;
      for (const dir of [-1, 1]) {
        const j = i + dir;
        if (j < 0 || j >= way.pts.length) continue;
        const [ax, az] = wayDirAt(way, i, dir);
        arms.push({ way, d, dir, idx: i, ax, az, bearing: Math.atan2(az, ax), hw: d.hw, rank: d.rank, pave: d.pave, rf: filletRadius(d), key: `${way.id}:${dir}`, minor: false, ring: !!d.rb, link: d.link, trim: 0, cap: false, paveCut: { 1: 0, '-1': 0 }, edgeCut: { 1: 0, '-1': 0 } });
      }
    }
  }
  arms.sort((p, q) => p.bearing - q.bearing);
  const ring = view.ringNodeRb.get(id) || null;
  const degree = arms.length;
  let kind = degree <= 1 ? 'end' : degree === 2 ? 'via' : 'junction';
  const maxHw = Math.max(0, ...arms.map((a) => a.hw));
  const top = arms.reduce((best, a) => (!best || a.rank > best.rank ? a : best), null);
  const matKey = top ? top.d.mat : 'asphalt';
  if (kind === 'via') {
    const [p, q] = arms;
    if (p.d.mat !== q.d.mat || Math.abs(p.hw - q.hw) > 0.6) kind = 'step';
  }
  info = { id, x: node.x, z: node.z, node, arms, degree, kind, ring, R: 0, matKey, fillets: [], gore: null, signals: node.signals, stop: node.stop, mini: node.mini, majors: [], minors: [] };
  view.info.set(id, info);
  if (ring) return info; // roundabout arm nodes are handled by the roundabout builder

  if (kind === 'junction' || kind === 'step') {
    // priority: lower class gives way; equal class: ways that end here give way to the through road,
    // and if everything ends here the straightest pair is the major road
    const maxRank = Math.max(...arms.map((a) => a.rank));
    const through = new Set(arms.filter((a) => arms.some((b) => b !== a && b.way === a.way)).map((a) => a.way));
    const byRank = arms.filter((a) => a.rank === maxRank);
    let majors = byRank.filter((a) => through.has(a.way));
    if (new Set(majors.map((a) => a.way)).size > 1) {
      // two through roads of the same class crossing: the wider / faster one has priority
      const score = (w) => { const q = descOf(view, w); return q.width * 100 + q.limit; };
      const best = [...new Set(majors.map((a) => a.way))].sort((p, q) => score(q) - score(p))[0];
      majors = majors.filter((a) => a.way === best);
    }
    if (!majors.length) {
      let best = null, bestDot = 2;
      for (const a of byRank) for (const b of byRank) if (a !== b) { const dot = a.ax * b.ax + a.az * b.az; if (dot < bestDot) { bestDot = dot; best = [a, b]; } }
      majors = best || byRank.slice(0, 1);
    }
    const majorSet = new Set(majors);
    for (const a of arms) a.minor = !majorSet.has(a);
    info.majors = majors;
    info.minors = arms.filter((a) => a.minor);
    // a slip road joining or leaving a one-way main carriageway: no give-way line, a gore instead
    const link = arms.find((a) => a.link && a.d.oneway);
    const main = arms.find((a) => !a.link && a.d.oneway && a.minor === false);
    if (link && main && degree <= 4) {
      const kindG = link.dir === -1 ? 'merge' : 'diverge';
      info.gore = { link, kindG, mainWay: main.way };
      link.minor = false;
      info.minors = arms.filter((a) => a.minor);
    }
    // patch radius from the major road (a wide minor approach would otherwise bulge into the major's
    // pavement); at a slip-road nose the patch is just the main carriageway so nothing bulges
    info.R = (kind === 'step' ? maxHw : Math.max(...majors.map((a) => a.hw))) + (kind === 'step' ? 0.3 : info.gore ? 0 : 0.6);
    // ribbon trim: the chord of a same-material arm sits on the patch circle; other materials stop
    // just outside it and get a cap in the junction material
    for (const a of arms) {
      if (a.d.mat === matKey) { a.trim = Math.sqrt(Math.max(0, info.R * info.R - a.hw * a.hw)); a.cap = false; }
      else { a.trim = info.R + 0.1; a.cap = true; }
    }
    // bell-mouth fillets between angular neighbours (not at a slip-road nose: the gore does that)
    if (kind === 'junction' && !info.gore) {
      for (let i = 0; i < arms.length; i++) {
        const A = arms[i], B = arms[(i + 1) % arms.length];
        if (A === B) continue;
        const f = fillet(info, A, B);
        if (!f) continue;
        info.fillets.push(f);
        A.paveCut[f.sideA * A.dir] = Math.max(A.paveCut[f.sideA * A.dir], f.tA);
        B.paveCut[f.sideB * B.dir] = Math.max(B.paveCut[f.sideB * B.dir], f.tB);
      }
    }
    // edge lines break only on the side a road joins (the far side of a T runs through)
    for (const a of arms) for (const s of [1, -1]) a.edgeCut[s] = a.paveCut[s] > 0 || a.minor ? Math.max(a.paveCut[s], info.R + 0.5) : 0;
    // give-way / stop line distance along each minor arm: where it meets the major's edge
    for (const a of info.minors) {
      const m = majors[0];
      const sin = m ? Math.abs(a.ax * m.az - a.az * m.ax) : 1;
      a.lineDist = (m ? m.hw : maxHw) / Math.max(0.5, sin) + 0.3;
    }
    if (info.signals) for (const a of arms) {
      const other = Math.max(0, ...arms.filter((b) => b !== a && b.way !== a.way).map((b) => b.hw));
      a.lineDist = Math.max(a.lineDist || 0, other + 1.0);
    }
  }
  return info;
}

/** bell-mouth between adjacent arms A and B: corner C, arc centre O, tangent points, distances along each arm */
function fillet(info, A, B) {
  const ax = A.ax, az = A.az, bx = B.ax, bz = B.az;
  const dot = ax * bx + az * bz;
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (theta < 20 * DEG || theta > 160 * DEG) return null;
  const nax = az, naz = -ax, nbx = bz, nbz = -bx;         // leftOf
  const sA = Math.sign(bx * nax + bz * naz) || 1, sB = Math.sign(ax * nbx + az * nbz) || 1;
  const wx = nbx * sB * B.hw - nax * sA * A.hw, wz = nbz * sB * B.hw - naz * sA * A.hw;
  const det = -ax * bz + bx * az;
  if (Math.abs(det) < 1e-6) return null;
  const t = (wx * -bz + bx * wz) / det;
  const Cx = info.x + nax * sA * A.hw + ax * t, Cz = info.z + naz * sA * A.hw + az * t;
  let rf = Math.min(A.rf, B.rf);
  let l = rf / Math.tan(theta / 2);
  if (l > 25) { l = 25; rf = l * Math.tan(theta / 2); }
  const TAx = Cx + ax * l, TAz = Cz + az * l, TBx = Cx + bx * l, TBz = Cz + bz * l;
  const [mx, mz] = norm(ax + bx, az + bz);
  const Ox = Cx + mx * rf / Math.sin(theta / 2), Oz = Cz + mz * rf / Math.sin(theta / 2);
  const tA = (TAx - info.x) * ax + (TAz - info.z) * az, tB = (TBx - info.x) * bx + (TBz - info.z) * bz;
  if (tA < 0.5 || tB < 0.5) return null;
  return { A, B, C: [Cx, Cz], O: [Ox, Oz], TA: [TAx, TAz], TB: [TBx, TBz], rf, tA, tB, sideA: sA, sideB: sB, pave: A.pave || B.pave };
}

// ---------- per-way geometry ----------

/** round an interior polyline corner: returns arc points (excluding the ends' straight parts) */
function cornerArc(P0, V, P1, maxT = 4) {
  const [d0x, d0z] = norm(V[0] - P0[0], V[1] - P0[1]);
  const [d1x, d1z] = norm(P1[0] - V[0], P1[1] - V[1]);
  const dot = Math.max(-1, Math.min(1, d0x * d1x + d0z * d1z));
  const theta = Math.acos(dot);
  if (theta < 1.5 * DEG || theta > 150 * DEG) return null;
  const L0 = Math.hypot(V[0] - P0[0], V[1] - P0[1]), L1 = Math.hypot(P1[0] - V[0], P1[1] - V[1]);
  const t = Math.min(maxT, 0.45 * L0, 0.45 * L1);
  if (t < 0.3) return null;
  const r = t / Math.tan(theta / 2);
  const left = d1x * d0z - d1z * d0x > 0 ? 1 : -1;   // turn towards leftOf(d0) = (d0z, -d0x)?
  const nx = d0z * left, nz = -d0x * left;
  const Ax = V[0] - d0x * t, Az = V[1] - d0z * t;
  const Cx = Ax + nx * r, Cz = Az + nz * r;
  const n = Math.max(2, Math.ceil(theta / Math.min(5 * DEG, 2 / r)));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const phi = (theta * k) / n;
    pts.push([Cx - nx * r * Math.cos(phi) + d0x * r * Math.sin(phi), Cz - nz * r * Math.cos(phi) + d0z * r * Math.sin(phi)]);
  }
  return pts;
}

/** the neighbour way's direction through a two-way 'via' node, in the sense of travel out of `way` at its end `end` (0 | last) */
function viaContinuation(view, way, end) {
  const id = way.nodes[end];
  const n = view.nodes.get(id);
  if (!n || n.wayIds.length !== 2 || view.ringNodeRb.has(id)) return null; // arms meet a ring square on, not blended
  const other = view.ways.get(n.wayIds.find((w) => w !== way.id));
  if (!other || !other.pts) return null;
  const j = other.nodes.indexOf(id);
  if (j < 0) return null;
  // the direction of travel through the node, in this way's point order: arriving at our start,
  // or leaving from our end (so both ways compute the same bisector tangent at the join)
  if (end === 0) return (j === 0 ? wayDirAt(other, 0, 1) : wayDirAt(other, j, -1)).map((v) => -v);
  return j === 0 ? wayDirAt(other, 0, 1) : wayDirAt(other, j, -1);
}

/**
 * Frames along a way: corners rounded (except at junctions), straights sampled every 6 m,
 * curves every ~2 m, tangent/normal/miter per frame, arc length, half widths (flared near
 * roundabouts), the arc length of every node on the way and the cut lists the markings use.
 */
function prepWay(view, way) {
  let p = view.prep.get(way.id);
  if (p) return p;
  const d = descOf(view, way);
  const pts = way.pts;
  const nodeIds = way.nodes || [];
  const isJunctionVertex = (i) => {
    const n = view.nodes.get(nodeIds[i]);
    return n && (n.wayIds.length > 1 || view.ringNodeRb.has(nodeIds[i]));
  };
  // 1. rounded polyline with vertex markers
  const samples = []; // [x, z, vertexIndex | -1]
  samples.push([pts[0][0], pts[0][1], 0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const arc = isJunctionVertex(i) ? null : cornerArc(pts[i - 1], pts[i], pts[i + 1]);
    if (!arc) { samples.push([pts[i][0], pts[i][1], i]); continue; }
    const mid = arc.length >> 1;
    arc.forEach((q, k) => samples.push([q[0], q[1], k === mid ? i : -1]));
  }
  samples.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts.length - 1]);
  // 2. subdivide long straights
  const dense = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    dense.push(a);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(L / 6);
    for (let k = 1; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, -1]);
  }
  dense.push(samples[samples.length - 1]);
  // 3. frames
  const frames = [];
  let s = 0;
  const endDir0 = viaContinuation(view, way, 0), endDir1 = viaContinuation(view, way, nodeIds.length - 1);
  for (let i = 0; i < dense.length; i++) {
    const [x, z] = dense[i];
    if (i > 0) s += Math.hypot(x - dense[i - 1][0], z - dense[i - 1][1]);
    let tin, tout;
    if (i > 0) tin = norm(x - dense[i - 1][0], z - dense[i - 1][1]);
    if (i < dense.length - 1) tout = norm(dense[i + 1][0] - x, dense[i + 1][1] - z);
    if (!tin) tin = endDir0 || tout;
    if (!tout) tout = endDir1 || tin;
    const [tx, tz] = norm(tin[0] + tout[0], tin[1] + tout[1]);
    const nx = tz, nz = -tx;
    // miter: offset along the bisector normal, scaled so the ribbon keeps its width round the corner
    const nin = [tin[1], -tin[0]], nout = [tout[1], -tout[0]];
    const dot = nin[0] * nout[0] + nin[1] * nout[1];
    const scale = Math.min(1.5, 1 / Math.max(0.3, Math.sqrt((1 + dot) / 2)));
    frames.push({ x, z, tx, tz, nx, nz, mx: nx * scale, mz: nz * scale, s, hwL: d.hw, hwR: d.hw, v: dense[i][2] });
  }
  const len = s;
  // 4. arc length of each node on the way
  const nodeS = new Map();
  for (const f of frames) if (f.v >= 0 && nodeIds[f.v] != null && view.nodes.has(nodeIds[f.v])) nodeS.set(nodeIds[f.v], f.s);
  p = { way, d, frames, len, nodeS, cuts: null, ringArms: [], closed: nodeIds.length > 2 && nodeIds[0] === nodeIds[nodeIds.length - 1] };
  view.prep.set(way.id, p);
  // 5. flares into roundabouts (two-way arms of multi-lane rings)
  if (!d.rb) for (const [nid, sN] of nodeS) {
    const rb = view.ringNodeRb.get(nid);
    if (!rb) continue;
    const arm = ringArm(view, rb, way, nid);
    if (!arm) continue;
    p.ringArms.push(arm);
    if (d.oneway || !arm.splitter) continue;
    const E = arm.entryLanes * 3.1 + arm.wMax - d.hw, X = Math.max(0, LW + arm.wMax - d.hw);
    for (const f of frames) {
      const u = Math.abs(f.s - sN) / FLARE_LEN;
      if (u >= 1) continue;
      const ramp = 1 - u;
      if (arm.dir === -1) { f.hwL += E * ramp; f.hwR += X * ramp; } else { f.hwR += E * ramp; f.hwL += X * ramp; }
    }
  }
  return p;
}

/** arc length on a prepared way nearest to a point (projection on the frames) */
function sNearest(p, x, z) {
  const F = p.frames;
  let best = Infinity, bs = 0;
  for (let i = 0; i < F.length - 1; i++) {
    const a = F[i], b = F[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const dd = (px - x) ** 2 + (pz - z) ** 2;
    if (dd < best) { best = dd; bs = a.s + (b.s - a.s) * t; }
  }
  return { s: bs, dist: Math.sqrt(best) };
}

/** the roundabout arm record for a way meeting a ring at node nid (trim at the ring circle, splitter sizing, lanes) */
function ringArm(view, rb, way, nid) {
  const node = view.nodes.get(nid);
  if (!node) return null;
  const d = descOf(view, way);
  const i = way.nodes.indexOf(nid);
  if (i < 0) return null;
  const dir = i === 0 ? 1 : i === way.nodes.length - 1 ? -1 : 0;
  if (!dir) return null;
  const [ax, az] = wayDirAt(way, i, dir);
  const r = num(rb.r, 15), lanes = Math.max(1, num(rb.lanes, 1));
  // walk the arm's polyline out of the ring: the ribbon starts where the centreline crosses r + 0.3
  const R = r + 0.3;
  let trim = 0, acc = 0;
  for (let k = i; k + dir >= 0 && k + dir < way.pts.length; k += dir) {
    const [x0, z0] = way.pts[k], [x1, z1] = way.pts[k + dir];
    const d0 = Math.hypot(x0 - rb.x, z0 - rb.z), d1 = Math.hypot(x1 - rb.x, z1 - rb.z), L = Math.hypot(x1 - x0, z1 - z0);
    if (d0 >= R) { trim = acc; break; }
    if (d1 >= R) { trim = acc + L * ((R - d0) / Math.max(1e-6, d1 - d0)); break; }
    acc += L;
    trim = acc;
    if (acc > 30) break;
  }
  trim = Math.min(25, Math.max(0, trim));
  const data = (rb.arms || []).find((a) => a.node === nid) || null;
  // when this arm's own OSM-derived lane count isn't found (a node the roundabout's precomputed
  // arm list doesn't match), fall back to the approach road's own real lane count instead of
  // silently assuming one lane - a genuinely two- or three-lane approach was losing its lane
  // arrows and dividing lines entirely because of this.
  // The arm's entryLanes is the max over every way the bake merged into that arm, so a one-lane
  // side road beside a two-lane slip inherits 2: clamp to what THIS way really has.
  const ownLanes = Math.max(1, d.oneway ? d.lanesF : dir === 1 ? d.lanesB : d.lanesF);
  const entryLanes = Math.max(1, Math.min(ownLanes, num(data?.entryLanes, ownLanes)));
  // the flare is painted with exactly as many lanes as the approach road really has. It used to be
  // forced up to the ring's lane count, which put a dividing line and two or three lane arrows on
  // every one-lane street that happened to meet a two-lane roundabout.
  const markLanes = entryLanes;
  const splitter = !d.oneway && (entryLanes >= 2 || r >= 12) && r >= 7;
  const ghost = !d.oneway && !splitter && r >= 7;
  const wMax = splitter ? (r >= 18 ? 1.6 : 1.2) : ghost ? 0.8 : 0;
  const Ls = Math.max(8, Math.min(25, 0.9 * r));
  const sN = prepWay(view, way).nodeS.get(nid) ?? 0;
  const bearing = (Math.atan2(ax, -az) / DEG + 360) % 360; // clockwise from north
  const ringPave = (rb.ringWays || []).some((id) => { const w = view.ways.get(id); return w && descOf(view, w).pave; });
  return { rb, way, d, node, nid, dir, ax, az, bearing, trim, ringPave, entryLanes, markLanes, exitLanes: Math.max(1, num(data?.exitLanes, 1)), splitter, ghost, wMax, Ls, sN, data, lanes, isEntry: !d.oneway || dir === -1, isExit: !d.oneway || dir === 1 };
}

/**
 * Cut lists for a way (arc-length intervals where a feature is NOT drawn): asphalt at junction
 * patches, centre line at minor-arm mouths / crossings / roundabout approaches, edge lines and
 * pavements at bell mouths, kerbs at dropped crossings. Also the hazard anchors (junctions,
 * crossings, bends) that switch the centre line to the warning pattern.
 */
function wayCuts(view, p) {
  if (p.cuts) return p.cuts;
  const { d, nodeS, frames, len } = p;
  const c = { asphalt: [], centre: [], edge: { 1: [], '-1': [] }, pave: { 1: [], '-1': [] }, kerb: { 1: [], '-1': [] }, yellow: [], hazards: [], lines: [], caps: [], humps: [] };
  const span = (s, dir, t) => (dir > 0 ? [s, s + t] : [s - t, s]);
  for (const [nid, s] of nodeS) {
    if (view.ringNodeRb.has(nid)) {
      const arm = p.ringArms.find((a) => a.nid === nid);
      if (!arm) continue;
      const t = arm.trim;
      c.asphalt.push([s - t, s + t]);
      c.centre.push(span(s, arm.dir, arm.trim + (arm.wMax ? arm.Ls + 1.5 : 1)));
      // a paved ring has its own kerb and pavement arcs: the arm's run up to the ring's outer edge
      const tp = arm.ringPave ? Math.max(0, t - 0.3) : t + 2;
      for (const side of [1, -1]) { c.pave[side].push(span(s, arm.dir, tp)); c.kerb[side].push(span(s, arm.dir, tp)); c.edge[side].push(span(s, arm.dir, t + 2)); }
      c.yellow.push(span(s, arm.dir, FLARE_LEN));
      c.hazards.push({ s, reach: hazardReach(d.limit) });
      continue;
    }
    const info = nodeInfo(view, nid);
    if (info.kind === 'end' || info.kind === 'via') {
      if (info.node.mini) { /* a mini on a via node: treated below */ }
      else continue;
    }
    for (const a of info.arms) {
      if (a.way !== p.way) continue;
      if (info.kind === 'junction' || info.kind === 'step') {
        c.asphalt.push(span(s, a.dir, a.trim));
        for (const side of [1, -1]) {
          if (a.paveCut[side] > 0) { c.pave[side].push(span(s, a.dir, a.paveCut[side])); c.kerb[side].push(span(s, a.dir, a.paveCut[side])); }
          if (a.edgeCut[side] > 0) c.edge[side].push(span(s, a.dir, a.edgeCut[side]));
        }
        c.yellow.push(span(s, a.dir, info.R + 2));
      }
      if (info.kind === 'junction' && !info.node.mini) {
        if (a.minor && a.lineDist) {
          c.centre.push(span(s, a.dir, a.lineDist + 0.3));
          c.lines.push({ s, dir: a.dir, dist: a.lineDist, stop: info.stop || info.signals, info, arm: a });
        } else if (info.signals && a.lineDist) {
          c.centre.push(span(s, a.dir, a.lineDist + 0.3));
          c.lines.push({ s, dir: a.dir, dist: a.lineDist, stop: true, info, arm: a });
        } else if (!a.minor && info.minors.length) c.hazards.push({ s, reach: hazardReach(d.limit) });
        if (info.gore && info.gore.mainWay === p.way) {
          const g = info.gore;
          c.edge[1].push(g.kindG === 'merge' ? [s - GORE_LEN - 5, s + 5] : [s - 5, s + GORE_LEN + 5]);
        }
      }
    }
    if (info.node.mini) {
      const Rm = Math.max(...info.arms.map((a) => a.hw)) + 2.0;
      c.centre.push([s - Rm - 1, s + Rm + 1]);
      c.yellow.push([s - Rm - 4, s + Rm + 4]);
      c.hazards.push({ s, reach: hazardReach(d.limit) });
    }
  }
  // speed humps on this way: a raised band of darker tarmac with a white chevron either side, the
  // way British humps are marked. Drawn here so the terrain drape carries them over the hills.
  for (const cm of view.calming) {
    if (cm.way !== p.way.id) continue;
    const s = num(cm.s, null) != null ? num(cm.s, 0) : sNearest(p, cm.x, cm.z).s;
    if (s < 1 || s > p.way.len - 1) continue;
    cm.__s = s;
    c.humps.push({ s, kind: cm.kind });
    c.hazards.push({ s, reach: hazardReach(d.limit) });
  }
  // crossings on this way
  for (const cr of view.crossings) {
    if (cr.way !== p.way.id) continue;
    const s = num(cr.s, null) != null && Math.abs(num(cr.s, 0) - sNearest(p, cr.x, cr.z).s) < 3 ? cr.s : sNearest(p, cr.x, cr.z).s;
    const t = cr.type || 'uncontrolled';
    cr.__s = s;
    if (t === 'zebra' || t === 'pelican' || t === 'puffin' || t === 'toucan' || t === 'signals') {
      const reach = 3.0 + 16 + 0.8;
      c.centre.push([s - reach, s + reach]);
      c.yellow.push([s - reach, s + reach]);
      c.hazards.push({ s, reach: hazardReach(d.limit) });
    }
    if (t !== 'unmarked' && t !== 'island') for (const side of [1, -1]) c.kerb[side].push([s - 1.8, s + 1.8]);
  }
  // signal stop lines mapped on the approach (OSM puts the node on the line)
  for (const sg of view.signals) {
    if (!sg.ways || !sg.ways.includes(p.way.id)) continue;
    if (nodeS.has(sg.node) && nodeInfo(view, sg.node).kind === 'junction') continue;
    const s = sNearest(p, sg.x, sg.z).s;
    let bestJ = null, bestD = 75;
    for (const [nid, sj] of nodeS) {
      const info = nodeInfo(view, nid);
      if ((info.kind === 'junction' || info.ring) && Math.abs(sj - s) < bestD) { bestD = Math.abs(sj - s); bestJ = sj; }
    }
    const dir = bestJ == null ? 0 : Math.sign(bestJ - s) || 1;   // approach direction of travel
    c.lines.push({ s, dir: -dir, dist: 0, stop: true, signalVia: true, approach: dir });
    c.centre.push(dir ? [Math.min(s, bestJ) - 0.5, Math.max(s, bestJ) + 0.5] : [s - 1, s + 1]);
    c.hazards.push({ s, reach: hazardReach(d.limit) });
  }
  // bends: warning line where the radius is tight for the limit (TSM5 visibility rule, simplified)
  const limitR = d.limit <= 30 ? 60 : d.limit <= 40 ? 90 : d.limit <= 50 ? 130 : 180;
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1], b = frames[i], q = frames[i + 1];
    const ang = Math.acos(Math.max(-1, Math.min(1, (b.x - a.x) * (q.x - b.x) + (b.z - a.z) * (q.z - b.z)) / (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(q.x - b.x, q.z - b.z) || 1)));
    const r = ang > 1e-4 ? Math.hypot(q.x - a.x, q.z - a.z) / 2 / Math.sin(ang / 2) : Infinity;
    if (r < limitR) c.hazards.push({ s: b.s, reach: 40 });
  }
  // town centre: double yellows (both kerbs) on paved roads near a town's place point
  if (d.pave && d.rank >= 3 && !d.rb && !d.oneway && view.places.length) {
    const towns = view.places.filter((pl) => num(pl.r, 0) >= 900);
    let run = null;
    for (const f of frames) {
      const near = towns.some((pl) => (f.x - pl.x) ** 2 + (f.z - pl.z) ** 2 < TOWN_CENTRE_R * TOWN_CENTRE_R);
      if (near && !run) run = [f.s, f.s];
      if (near && run) run[1] = f.s;
      if (!near && run) { c.yellowRuns = c.yellowRuns || []; c.yellowRuns.push(run); run = null; }
    }
    if (run) { c.yellowRuns = c.yellowRuns || []; c.yellowRuns.push(run); }
  }
  for (const k of ['asphalt', 'centre', 'yellow']) c[k] = union(c[k]);
  for (const side of [1, -1]) for (const k of ['edge', 'pave', 'kerb']) c[k][side] = union(c[k][side]);
  void len;
  p.cuts = c;
  return c;
}

// ---------- materials ----------

/**
 * The shared materials a Kent road tile is drawn with. `pbr` is assets.js's pbr(); `decal(id, opts)`
 * should return a material from src/signs.js's markingTexture (see decalQuad); `planting(spots)`
 * may return an Object3D of shrubs for big roundabout islands (assets.js instanced()).
 */
/**
 * Which surface a road is made of. OSM's `surface` tag wins where it exists; otherwise the class
 * decides, because in Britain you can tell a motorway from a country lane by the tarmac alone.
 * Everything used to come out as one grey asphalt, so every road looked like every other road.
 */
function roadSurface(way, cls, limit, pave) {
  const s = (way.surface || '').toLowerCase();
  if (s === 'sett' || s === 'cobblestone' || s === 'paving_stones') return 'settsTop';
  if (s === 'gravel' || s === 'fine_gravel' || s === 'compacted' || s === 'unpaved' || s === 'dirt' || s === 'ground') return 'gravelTop';
  if (s === 'concrete' || s === 'concrete:plates') return 'concreteTop';
  if (cls === 'service') return 'asphaltDark';                 // closes, yards, car park aisles
  if (cls === 'motorway' || cls === 'trunk' || cls === 'motorway_link' || cls === 'trunk_link') return 'trunkTop';
  if (!pave && limit >= 50) return 'laneTop';                  // unlit road out of town: a country lane
  if (cls === 'residential' || cls === 'living_street') return 'streetTop'; // a side street: older tarmac
  return 'asphalt';                                            // the through roads: clean
}

export function makeRoadMaterials({ pbr, decal = null, planting = null } = {}) {
  const tex = (name, color, extra = {}) => {
    const m = pbr(name, { repeat: [1, 1], color, roughness: 1, ...extra });
    for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].repeat.set(1 / 4, 1 / 4);
    return m;
  };
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
  const asphalt = tex('clean_asphalt', 0x8c8c8c);
  const asphaltDark = tex('clean_asphalt', 0x6f6e6c);
  return {
    asphalt, asphaltDark,
    // A road's surface says what kind of road it is before you read a single sign. Everything used
    // to be this one grey asphalt, so a country lane, a high street and a motorway looked identical.
    // The spread is deliberately wide: a 10% tint reads as "the same road in different light", and
    // the whole point is that you can tell them apart at a glance.
    trunkTop: tex('clean_asphalt', 0xb5b7b8),      // motorway and trunk: pale, newly surfaced
    // The patched set carries metre-wide tar-filled cracks at this UV scale. On a country lane that
    // is the character; on a street in town it just read as filth, so side streets take the clean
    // set a few shades down. The tiers still differ by tone, which is what tells them apart.
    streetTop: tex('clean_asphalt', 0x76756f),     // side streets and closes: older, greyer tarmac
    laneTop: tex('asphalt_02', 0x6b6760),          // country lane: the worn, patched set
    settsTop: tex('rectangular_paving', 0x8d8075), // setts and cobbles
    gravelTop: tex('leafy_grass', 0xb0a083),       // gravel and unsurfaced tracks
    concreteTop: tex('clean_asphalt', 0xc8c6c0),   // concrete carriageway: pale slabs
    // a UK footway is grey tarmac or grey slabs. The paving set is brown brick, which made every
    // pavement in Kent look like a muddy driveway.
    paving: tex('clean_asphalt', 0xb4b0a8),
    // the dressed streets of the authored city get block paving, as a high street does
    pavingBlock: tex('rectangular_paving', 0xd6cbb8),
    grass: tex('leafy_grass', 0x8fab74),
    white: flat(0xf2f2ee),
    yellow: flat(0xe8c23a),
    kerb: new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.25, roughness: 0.6 }), // dull galvanised, not glaring chrome-white
    concrete: new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.85 }),
    decal, planting,
  };
}

/** Plain-colour stand-ins so tiles build under node or before the PBR sets load. */
export function flatRoadMaterials() {
  const m = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, ...extra });
  return { asphalt: m(0x555555), asphaltDark: m(0x444444),
    trunkTop: m(0x767778), streetTop: m(0x55544f), laneTop: m(0x474338), settsTop: m(0x5e564d), gravelTop: m(0x79705c), concreteTop: m(0x8a8882),
    paving: m(0xbbb6ad), pavingBlock: m(0xb9ab98), grass: m(0x6f9a52), white: m(0xf2f2ee), yellow: m(0xe8c23a), kerb: m(0xa9a59c), barrier: m(0xc4c8cc), concrete: m(0xb9b5ad), decal: null, planting: null };
}

/**
 * The diagonals of a painted median (1040), between a dual carriageway's offside edge line and the
 * opposing carriageway's: 150 mm strokes at 45 degrees, 3 m apart. They are anchored to the way's
 * own start, so every tile the way crosses picks the same strokes and none is drawn twice.
 * `median` is the gap sampled along the way by the net; a sample of 0 means no partner there.
 */
function medianHatch(W, frames, median, runs, wr, keepS) {
  const SPACING = 3, STROKE = 0.15;
  const widthAt = (s) => {
    const ss = median.s, hi = ss.length - 1;
    let i = 0;
    while (i < hi && ss[i + 1] < s) i++;
    const j = Math.min(hi, i + 1), span = ss[j] - ss[i];
    const wa = median.w[i], wb = median.w[j];
    if (!(wa > 0) || !(wb > 0)) return 0; // don't hatch across the end of the median
    return wa + (wb - wa) * (span > 1e-6 ? Math.min(1, Math.max(0, (s - ss[i]) / span)) : 0);
  };
  // the edge lines sit inset inside each ribbon, so a stroke has to reach past our own edge to them
  const nearOff = (f) => -(f.hwR - 0.225 - wr / 2);
  for (const [a, c] of runs) {
    for (let s = Math.ceil(a / SPACING) * SPACING; s < c; s += SPACING) {
      const mw = widthAt(s);
      if (mw <= 0 || !keepS(s)) continue;
      const reach = mw + 0.45 + wr, s1 = s + reach; // 45 degrees: as far along as it is across
      if (s1 > c) continue;
      const f0 = frameAt(frames, s), f1 = frameAt(frames, s1);
      strokeSeg(W, offsetPt(f0, nearOff(f0)), offsetPt(f1, nearOff(f1) - reach), STROKE, Y_MARK);
    }
  }
}

// ---------- the tile builder ----------

/**
 * Build the road geometry of one tile.
 * tile: { tx, tz } (bounds are derived). Returns { group, colliders, roads, stats, dispose() }:
 * colliders = [{ cx, cz, w, d, yaw, carOnly }] for Colliders.obb; roads = minimap polylines
 * [{ points: Vector3[], width, closed }] clipped to the tile; stats = { tris, byMat, ms }.
 */
export function buildRoadTile(net, tile, { lod = 'near', mats, materials, groundY = null } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  mats = mats || materials || flatRoadMaterials();
  const view = netView(net);
  const b = tileBounds(tile.tx, tile.tz);
  const near = lod === 'near';
  const cell = view.index.get(tileKey(b.tx, b.tz)) || { ways: new Set(), nodes: new Set(), rbs: new Set(), minis: [], crossings: [], signals: [] };
  const X0 = b.x0 - OVERLAP, X1 = b.x1 + OVERLAP, Z0 = b.z0 - OVERLAP, Z1 = b.z1 + OVERLAP;
  const inBox = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
  const inTile = (x, z) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;
  const uvWorld = (p) => p; // world xz: the PBR maps repeat 1/4 per metre

  const B = {};
  const batch = (k) => B[k] || (B[k] = new GeoBatch());
  const decals = new Map(); // material -> GeoBatch
  const colliders = [];
  const roads = [];
  const extraObjects = [];

  const obb = (cx, cz, w, d, yaw, carOnly = true, src = null) => colliders.push({ cx, cz, w, d, yaw, carOnly, src });
  /** colliders along a polyline of [x, z] points, chunked so each box stays short; src = ids of the ways it belongs to */
  const obbAlong = (pts, w, carOnly = true, src = null, chunk = 12) => {
    let i = 0;
    while (i < pts.length - 1) {
      let j = i, L = 0;
      while (j < pts.length - 1 && L < chunk) { L += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j++; }
      const a = pts[i], c = pts[j];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len > 0.5) obb((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, w, len, Math.atan2(dx, dz), carOnly, src);
      i = j;
    }
  };
  /** kerb L-profile over exact runs at lateral offset e on side `side` (+1 left): vertical face toward the road and a 0.15 top */
  const kerbRuns = (frames, e, side, runs) => {
    const K = batch('kerb');
    const o0 = (f) => (typeof e === 'function' ? e(f) : e) * side, o1 = (f) => ((typeof e === 'function' ? e(f) : e) + KERB_W) * side;
    ribbonRuns(K, frames, side > 0 ? o1 : o0, side > 0 ? o0 : o1, KERB_H, runs, null, inBox);
    for (const [a, b] of runs) {
      const S = samplesBetween(frames, a, b);
      for (let i = 0; i < S.length - 1; i++) {
        if (!inBox(S[i].x, S[i].z) && !inBox(S[i + 1].x, S[i + 1].z)) continue;
        K.wall([offsetPt(S[i], o0(S[i])), offsetPt(S[i + 1], o0(S[i + 1]))], Y_ROAD, KERB_H, -side);
      }
    }
  };
  const runsFor = (p, cuts) => subtract([[0, p.len]], cuts);
  const inBoxS = (frames) => (s) => { const f = frameAt(frames, s); return inBox(f.x, f.z); };

  /** a decal quad (arrow, word) at a point with a forward direction; falls back to white geometry */
  const decalQuad = (id, opts, x, z, fx, fz, defaultW, defaultH, fallback = null) => {
    const mat = mats.decal ? safeDecal(mats.decal, id, opts) : null;
    if (!mat) { if (fallback) fallback(); return; }
    const ud = (mat.map && mat.map.userData) || mat.userData || {};
    const w = ud.wMm ? ud.wMm / 1000 : ud.wM || defaultW, h = ud.hMm ? ud.hMm / 1000 : ud.hM || defaultH;
    const box = ud.box || { u0: 0, v0: 0, u1: 1, v1: 1 };
    let D = decals.get(mat);
    if (!D) decals.set(mat, (D = new GeoBatch()));
    const rx = -fz, rz = fx;
    const P = (u, v) => [x + rx * u * w + fx * v * h, z + rz * u * w + fz * v * h];
    const uv = (u, v) => [box.u0 + (box.u1 - box.u0) * (u + 0.5), box.v0 + (box.v1 - box.v0) * (v + 0.5)];
    const p00 = P(-0.5, -0.5), p10 = P(0.5, -0.5), p11 = P(0.5, 0.5), p01 = P(-0.5, 0.5);
    const i0 = D.vert(p00[0], Y_DECAL, p00[1], 0, 1, 0, ...uv(-0.5, -0.5)), i1 = D.vert(p10[0], Y_DECAL, p10[1], 0, 1, 0, ...uv(0.5, -0.5));
    const i2 = D.vert(p11[0], Y_DECAL, p11[1], 0, 1, 0, ...uv(0.5, 0.5)), i3 = D.vert(p01[0], Y_DECAL, p01[1], 0, 1, 0, ...uv(-0.5, 0.5));
    // winding: (p00, p10, p11) faces up when the cross product's y is positive
    const cy = (p10[1] - p00[1]) * (p11[0] - p00[0]) - (p10[0] - p00[0]) * (p11[1] - p00[1]);
    if (cy > 0) D.idx.push(i0, i1, i2, i0, i2, i3); else D.idx.push(i0, i2, i1, i0, i3, i2);
  };
  const laneArrow = (kind, limit, x, z, fx, fz) => {
    const len = arrowLength(limit);
    decalQuad('lane_arrow_1038', { kind, arrow: kind, length: len * 1000 }, x, z, fx, fz, kind === 'ahead' ? 0.6 : 1.3, len,
      () => placePolygon(batch('white'), arrowPolygon(kind, len), x - fx * len / 2, z - fz * len / 2, fx, fz, Y_MARK));
  };
  const wordDecal = (id, text, limit, x, z, fx, fz) => {
    const h = wordHeight(limit);
    decalQuad(id, { text, lines: [text], height: h * 1000 }, x, z, fx, fz, Math.max(1.2, 0.55 * text.length), h);
  };

  // ---- flyovers: who drew which vertices ----
  // Every batch is a flat list of vertices in the order they were pushed, so a marker at the head
  // of each way's (or junction's) drawing says which way owns the vertices from here to the next
  // marker. Once the tile is drawn, each owner's vertices are lifted by its deck height - a bridge
  // way to its deck, an approach road up its ramp, the road beneath not at all. Done by ownership
  // rather than by position because at the crossing itself both carriageways contain the point.
  const marks = [];
  const snapshot = () => { const m = new Map(); for (const gb of Object.values(B)) m.set(gb, gb.n); for (const gb of decals.values()) m.set(gb, gb.n); return m; };
  const mark = (owner) => marks.push({ owner, at: snapshot() });

  // ---- ways: ribbons, lines, pavements, kerbs ----
  const wayPreps = [];
  for (const way of cell.ways) {
    if (!way.pts || way.pts.length < 2) continue;
    const p = prepWay(view, way);
    mark({ p });
    const { d, frames } = p;
    if (d.rb || way.synthetic && d.rb) continue; // the circulatory carriageway comes from the roundabout record
    wayPreps.push(p);
    const cuts = wayCuts(view, p);
    const A = batch(d.mat);
    ribbonRuns(A, frames, (f) => f.hwL, (f) => -f.hwR, Y_ROAD, runsFor(p, cuts.asphalt), uvWorld, inBox);
    // minimap polyline (tile only, every ~8 m)
    let run = [], last = -99;
    const flush = () => { if (run.length > 1) roads.push({ points: run, width: d.width, closed: false }); run = []; };
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!inTile(f.x, f.z)) { flush(); continue; }
      if (f.s - last >= 8 || i === frames.length - 1) { run.push(new THREE.Vector3(f.x, 0, f.z)); last = f.s; }
    }
    flush();
    if (!near) continue;

    const W = batch('white');
    const keepS = inBoxS(frames);
    const hazardIntervals = union(cuts.hazards.map((h) => [h.s - h.reach, h.s + h.reach]));
    // ---- speed humps: a raised band of darker tarmac, chevroned white at each edge ----
    // The band is laid 7 cm proud of the carriageway. Because the whole tile is draped onto the
    // terrain afterwards, that 7 cm rides the hills with everything else.
    for (const h of cuts.humps) {
      if (!keepS(h.s)) continue;
      const halfLen = h.kind === 'table' ? 3.2 : 1.6;    // a table is a long flat-topped one
      const top = h.kind === 'cushion' ? 0.06 : 0.07;
      const hw = h.kind === 'cushion' ? Math.min(d.hw, 0.9) : d.hw;  // cushions leave a gap each side
      ribbonRuns(batch('concreteTop'), frames, -hw, hw, Y_ROAD + top, [[h.s - halfLen, h.s + halfLen]]);
      // the white chevrons that warn you it is there
      for (const e of [-1, 1]) transverse(W, frames, h.s + e * halfLen * 0.72, -hw, hw, 0.36, Y_ROAD + top + 0.004);
    }
    // centre line: hazard pattern near junctions / crossings / bends, else the normal broken line
    if (d.centreLine && !d.rb) {
      const wide = d.width >= 10 || d.lanesF + d.lanesB >= 3;
      const runs = subtract([[0, p.len]], cuts.centre);
      for (const [a, c] of runs) {
        const haz = hazardIntervals.map((h) => [Math.max(a, h[0]), Math.min(c, h[1])]).filter((h) => h[1] > h[0]);
        const normal = subtract([[a, c]], haz);
        for (const [h0, h1] of haz) {
          const anchor = cuts.hazards.reduce((best, h) => (Math.abs(h.s - (h0 + h1) / 2) < Math.abs(best - (h0 + h1) / 2) ? h.s : best), h0);
          dashesAlong(W, frames, h0, h1, hazardPattern(d.limit, wide), d.centreOff, anchor <= h1 && anchor >= h0 ? anchor : h0, Y_MARK, keepS);
        }
        for (const [n0, n1] of normal) dashesAlong(W, frames, n0, n1, centrePattern(d.limit, wide), d.centreOff, n0, Y_MARK, keepS);
      }
      // extra forward lanes on a two-way road (2+1): lane lines on the forward side
      for (let k = 1; k < d.lanesF; k++) {
        const o = d.hw - (d.fwdW * k) / d.lanesF;
        for (const [a, c] of subtract([[0, p.len]], cuts.centre)) dashesAlong(W, frames, a, c, lanePattern(d.limit), o, a, Y_MARK, keepS);
      }
    }
    // one-way carriageways: lane lines between lanes, edge lines on duals / slips
    if (d.oneway && !d.rb) {
      const laneW = d.width / d.lanesF;
      for (let k = 1; k < d.lanesF; k++) {
        const o = d.hw - laneW * k;
        for (const [a, c] of subtract([[0, p.len]], cuts.asphalt)) dashesAlong(W, frames, a, c, lanePattern(d.limit), o, a, Y_MARK, keepS);
      }
      if (d.dual || d.link || d.limit >= 50) {
        const wl = edgeWidth(d.limit, true, true), wr = edgeWidth(d.limit, true, false);
        const edgeRuns = subtract([[0, p.len]], union([...cuts.asphalt, ...cuts.edge[-1]]));
        for (const [a, c] of subtract([[0, p.len]], union([...cuts.asphalt, ...cuts.edge[1]]))) stripAlong(W, frames, a, c, (f) => f.hwL - 0.225 - wl / 2, wl, Y_MARK);
        for (const [a, c] of edgeRuns) stripAlong(W, frames, a, c, (f) => -(f.hwR - 0.225 - wr / 2), wr, Y_MARK);
        // painted median (1040): 45 degree diagonals filling the strip between this way's offside
        // edge line and the opposing carriageway's. Those two solid lines are already its boundaries,
        // so only the diagonals are missing. Drawn over the same runs as the offside edge line, which
        // stops it at junction mouths where right-turners cross.
        if (way.median) medianHatch(W, frames, way.median, edgeRuns, wr, keepS);
      }
    }
    // rural single carriageway: edge lines
    if (d.edgeLines) {
      const we = edgeWidth(d.limit, false);
      for (const side of [1, -1]) {
        const cutsS = union([...cuts.asphalt, ...cuts.edge[side]]);
        for (const [a, c] of subtract([[0, p.len]], cutsS)) stripAlong(W, frames, a, c, (f) => side * ((side > 0 ? f.hwL : f.hwR) - 0.225 - we / 2), we, Y_MARK);
      }
    }
    // pavements + kerbs
    if (d.pave && !d.rb) {
      const P = batch(way.dress === 'high-street' ? 'pavingBlock' : 'paving'); // side streets keep tarmac footways
      for (const side of [1, -1]) {
        const hw = (f) => (side > 0 ? f.hwL : f.hwR);
        const paveRuns = runsFor(p, cuts.pave[side]);
        const o0 = (f) => side * (hw(f) + KERB_W), o1 = (f) => side * (hw(f) + KERB_W + PAVE_W);
        ribbonRuns(P, frames, side > 0 ? o1 : o0, side > 0 ? o0 : o1, Y_PAVE, paveRuns, uvWorld, inBox);
        for (const [a, c] of paveRuns) {
          const S = samplesBetween(frames, a, c);
          for (let i = 0; i < S.length - 1; i++) {
            if (!inBox(S[i].x, S[i].z) && !inBox(S[i + 1].x, S[i + 1].z)) continue;
            P.wall([offsetPt(S[i], o1(S[i])), offsetPt(S[i + 1], o1(S[i + 1]))], 0, Y_PAVE, side);
          }
        }
        kerbRuns(frames, hw, side, runsFor(p, cuts.kerb[side]));
      }
    }
    // double yellows at both kerbs through the town centre
    if (cuts.yellowRuns) {
      const Yb = batch('yellow');
      const yw = PATTERNS.double_yellow_1018_1.w, gap = PATTERNS.double_yellow_1018_1.between;
      for (const [a, c] of subtract(cuts.yellowRuns, cuts.yellow)) for (const side of [1, -1]) for (const k of [0, 1]) {
        stripAlong(Yb, frames, a, c, (f) => side * ((side > 0 ? f.hwL : f.hwR) - 0.3 - k * (yw + gap)), yw, Y_MARK);
      }
    }
    // bridges: parapets; tunnels: cutting walls
    if (d.bridge || d.tunnel) {
      const C = batch('concrete');
      const off = d.hw + (d.pave && !d.tunnel ? PAVE_W + KERB_W + 0.05 : 0.15);
      const h = d.tunnel ? 2.4 : 1.1, th = 0.3;
      for (const side of [1, -1]) {
        const pts = [];
        for (let i = 0; i < frames.length - 1; i++) {
          const f0 = frames[i], f1 = frames[i + 1];
          if (!inBox(f0.x, f0.z) && !inBox(f1.x, f1.z)) continue;
          const a = offsetPt(f0, side * (off + th / 2)), c = offsetPt(f1, side * (off + th / 2));
          const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
          C.box((a[0] + c[0]) / 2, 0, (a[1] + c[1]) / 2, th, h, L + 0.05, Math.atan2(dx, dz));
          if (!pts.length) pts.push(a);
          pts.push(c);
        }
        obbAlong(pts, th, false, [way.id]);
      }
    }
  }

  // ---- junction nodes: patch, fillets, give-way / stop lines, minis, dead ends ----
  mark(null);
  // a point inside a roundabout's circulating carriageway (the ring owns its own kerb + footways):
  // a junction fillet that sweeps in here would lay raised kerb and pavement across the lane
  const inRing = (x, z) => { const rbg = view.net?.rbGrid; if (!rbg) return false; for (const rb of rbg.near(x, z, 16)) if ((x - rb.x) ** 2 + (z - rb.z) ** 2 < (rb.r + 1) ** 2) return true; return false; };
  for (const nid of cell.nodes) {
    const info = nodeInfo(view, nid);
    mark({ nid });
    if (info.ring) continue;
    const J = batch(info.matKey);
    if (info.kind === 'junction' || info.kind === 'step') {
      J.disc(info.x, info.z, info.R, Y_ROAD, info.R > 6 ? 48 : 32, uvWorld);
      for (const a of info.arms) if (a.cap) capFill(J, info, a, uvWorld);
      for (const f of info.fillets) {
        const arc = filletArc(f);
        J.fan(f.C, arc, Y_ROAD, uvWorld);
        if (!near || !f.pave) continue;
        if (inRing(f.TA[0], f.TA[1]) || inRing(f.TB[0], f.TB[1]) || inRing(f.O[0], f.O[1])) continue; // don't lay a bell-mouth kerb inside a roundabout
        // kerb round the bell mouth and the pavement behind it
        const K = batch('kerb');
        strokeTop(K, arc, KERB_W, KERB_H, 1);
        K.wall(arc, Y_ROAD, KERB_H, -1);
        K.wall(arc.slice().reverse(), Y_ROAD, KERB_H, -1);
        if (f.rf > 2.6) {
          const P = batch('paving');
          const a0 = Math.atan2(f.TA[1] - f.O[1], f.TA[0] - f.O[0]), a1raw = Math.atan2(f.TB[1] - f.O[1], f.TB[0] - f.O[0]);
          let da = a1raw - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          P.ring(f.O[0], f.O[1], Math.max(0.2, f.rf - KERB_W - PAVE_W), f.rf - KERB_W, a0, a0 + da, Y_PAVE, null, uvWorld);
        }
      }
    }
    if (info.kind === 'end') {
      const a = info.arms[0];
      // a real cul-de-sac on a minor road gets its usual turning-circle disc; a map-edge cut (any
      // class - an A-road runs off the fetched bbox just as often as a lane) gets one too, so the
      // tarmac ends in a clean round cap instead of a hard perpendicular slice into the grass.
      const cul = a && (a.d.cls === 'residential' || a.d.cls === 'unclassified' || a.d.cls === 'service');
      if (a && a.d.pave && (cul || info.node.edge)) J.disc(info.x, info.z, a.d.width * 0.8, Y_ROAD - 0.001, 28, uvWorld);
    }
    if (!near) continue;
    const W = batch('white');
    // give-way / stop lines on the minor arms (and every arm at signals)
    for (const a of info.arms) {
      const p = prepWay(view, a.way);
      const cuts = wayCuts(view, p);
      for (const ln of cuts.lines) {
        if (ln.info !== info || ln.arm !== a) continue;
        drawStopLine(W, p, ln.s, ln.dir, ln.dist, ln.stop, a.d, info.gore);
        if (!ln.stop && !info.gore) giveWayTriangle(W, p, ln.s, ln.dir, ln.dist, a.d);
        if (ln.stop && info.stop && !info.signals) {
          const f = frameAt(p.frames, ln.s + ln.dir * (ln.dist + 3.2));
          const o = -ln.dir * (a.d.oneway ? 0 : (ln.dir === -1 ? f.hwL : f.hwR) / 2);
          const pt = offsetPt(f, o);
          wordDecal('stop_word_1022', 'STOP', a.d.limit, pt[0], pt[1], -ln.dir * f.tx, -ln.dir * f.tz);
        }
        // lane arrows at signalised stop lines when OSM gives turn lanes (forward direction only)
        if (info.signals && a.d.turnLanes && ln.dir === -1) laneArrowsFor(p, a.d, ln.s - ln.dist, 1, a.d.turnLanes, laneArrow);
      }
    }
    // slip-road gore: taper fill, boundary, chevrons, broken edge line on the main
    if (info.gore) drawGore(view, info, batch, inBox, uvWorld);
    // mini-roundabout: white dome, three arrows, 1003.3 give-way marks on every arm
    if (info.node.mini) drawMini(view, info, batch, laneArrow, wordDecal, uvWorld);
  }
  // signal stop lines on 'via' nodes (the node sits on the line, before the junction)
  mark(null);
  if (near) for (const p of wayPreps) {
    mark({ p });
    const cuts = wayCuts(view, p);
    for (const ln of cuts.lines) {
      if (!ln.signalVia) continue;
      const f = frameAt(p.frames, ln.s);
      if (!inTile(f.x, f.z)) continue;
      const W = batch('white');
      const dirT = ln.approach || 1;   // direction of travel over the line
      if (p.d.oneway) transverse(W, p.frames, ln.s, -f.hwR + 0.1, f.hwL - 0.1, PATTERNS.stop_line_1001.w, Y_MARK);
      else transverse(W, p.frames, ln.s, 0, dirT > 0 ? f.hwL - 0.1 : -(f.hwR - 0.1), PATTERNS.stop_line_1001.w, Y_MARK);
      if (p.d.turnLanes && dirT > 0) laneArrowsFor(p, p.d, ln.s, 1, p.d.turnLanes, laneArrow);
    }
  }

  // ---- crossings ----
  if (near) for (const cr of cell.crossings) {
    const way = view.ways.get(cr.way);
    if (!way || !way.pts) continue;
    const p = prepWay(view, way);
    wayCuts(view, p);
    const s = cr.__s ?? sNearest(p, cr.x, cr.z).s;
    drawCrossing(batch('white'), p, s, cr.type || 'uncontrolled');
  }

  // ---- roundabouts whose centre is in this tile ----
  mark(null);
  for (const rb of cell.rbs) drawRoundabout(view, rb, { batch, near, obb, laneArrow, wordDecal, uvWorld, mats, extraObjects, roads, groundY });

  // ---- dual carriageway reservations + barriers ----
  for (const p of wayPreps) {
    mark({ p });
    if (!p.d.dual) continue;
    const partner = findPartner(view, cell, p);
    if (!partner || partner.way.id < p.way.id) continue;
    drawReservation(p, partner, { batch, near, inBox, obbAlong: (pts, w, carOnly) => obbAlong(pts, w, carOnly, [p.way.id, partner.way.id]), uvWorld, trunk: p.d.cls === 'trunk' });
  }
  // Bridges are drawn at grade for now, so a parapet or reservation barrier can lie across a road
  // that really passes under or over it: drop any such box that overlaps another way's carriageway.
  const crossesOtherWay = (c) => {
    const ax = Math.sin(c.yaw), az = Math.cos(c.yaw);
    for (const w of cell.ways) {
      if (c.src.includes(w.id) || !w.pts) continue;
      const q = descOf(view, w), lim = q.hw + c.w / 2 + 0.3;
      for (let t = -c.d / 2; t <= c.d / 2 + 1e-6; t += Math.min(2, c.d / 2 || 1)) {
        const x = c.cx + ax * t, z = c.cz + az * t;
        for (let i = 0; i < w.pts.length - 1; i++) {
          const [x0, z0] = w.pts[i], [x1, z1] = w.pts[i + 1];
          if (x < Math.min(x0, x1) - lim || x > Math.max(x0, x1) + lim || z < Math.min(z0, z1) - lim || z > Math.max(z0, z1) + lim) continue;
          const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
          const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2)) : 0;
          if ((x0 + dx * u - x) ** 2 + (z0 + dz * u - z) ** 2 < lim * lim) return true;
        }
      }
    }
    return false;
  };
  for (let i = colliders.length - 1; i >= 0; i--) {
    const c = colliders[i];
    if (c.src && crossesOtherWay(c)) colliders.splice(i, 1);
    else delete c.src;
  }

  // ---- flyovers: lift each owner's vertices to its deck ----
  mark(null);
  const nodeDeck = view.net?.nodeDeck;
  for (let k = 0; k < marks.length - 1; k++) {
    const { owner, at } = marks[k], next = marks[k + 1].at;
    if (!owner) continue;
    const p = owner.p, nd = owner.nid != null && nodeDeck ? nodeDeck.get(owner.nid) || 0 : 0;
    if (p && !p.way.hasDeck) continue;
    if (!p && !nd) continue;
    for (const [gb, from] of at) {
      const to = next.get(gb) ?? gb.n;
      for (let i = from; i < to; i++) {
        const x = gb.pos[i * 3], z = gb.pos[i * 3 + 2];
        gb.pos[i * 3 + 1] += p ? view.net.deckAt(p.way, sNearest(p, x, z).s) : nd;
      }
    }
    // batches born after this marker belong wholly to it until the next marker
    for (const [gb, to] of next) if (!at.has(gb)) {
      for (let i = 0; i < to; i++) {
        const x = gb.pos[i * 3], z = gb.pos[i * 3 + 2];
        gb.pos[i * 3 + 1] += p ? view.net.deckAt(p.way, sNearest(p, x, z).s) : nd;
      }
    }
  }

  // ---- meshes ----
  // On a region with real hills, every ground-hugging piece (tarmac, markings, kerbs, pavement,
  // decals) is laid onto the terrain here. The ribbons are already sampled every 6 m along the way
  // (see the densify step above), so they follow the slope without being tessellated first; the
  // junction and roundabout caps are the only big flat spans, so they get split to 8 m edges.
  const drape = groundY
    ? (g) => drapeGeometry(g, groundY, Infinity)
    : (g) => g;
  const group = new THREE.Group();
  group.name = `roads ${b.tx},${b.tz} ${lod}`;
  const geos = [];
  const byMat = {};
  let tris = 0;
  for (const [k, gb] of Object.entries(B)) {
    if (gb.empty) continue;
    const mat = mats[k] || mats.asphalt;
    const g = drape(gb.geometry());
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = k === 'barrier' || k === 'concrete' || k === 'kerb';
    m.name = k;
    group.add(m);
    byMat[k] = gb.triangles;
    tris += gb.triangles;
  }
  for (const [mat, gb] of decals) {
    if (gb.empty) continue;
    const g = drape(gb.geometry());
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = 'decal';
    group.add(m);
    byMat.decal = (byMat.decal || 0) + gb.triangles;
    tris += gb.triangles;
  }
  for (const o of extraObjects) group.add(o);
  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  return {
    group, colliders, roads, stats: { tris, byMat, ms, ways: wayPreps.length },
    dispose() {
      for (const g of geos) g.dispose();
      for (const o of extraObjects) o.traverse?.((c) => { if (c.isInstancedMesh) c.dispose(); });
      group.clear();
    },
  };
}

/** a builder entry for tiles.js's TileManager */
export function roadsBuilder(net, mats) {
  return { name: 'roads', build: (tile, lod) => buildRoadTile(net, tile, { lod, mats }) };
}

/**
 * The roads builder for the Kent world. Pass `pbr` (assets.js) for the real PBR asphalt/paving,
 * `decal(id, opts)` for signs.js marking decals and `planting(spots)` for island shrubs, or a ready
 * `mats` from makeRoadMaterials(). With `colliders` the builder registers its own oriented boxes
 * (and removes them on dispose), so the TileManager then needs no colliders of its own.
 */
export function makeRoadBuilder({ net, colliders = null, mats = null, pbr = null, decal = null, planting = null, groundY = null } = {}) {
  let m = mats;
  const materials = () => {
    if (m) return m;
    if (!pbr) console.warn('[kent roads] makeRoadBuilder: no pbr/mats given, using flat colours (pass pbr from assets.js)');
    return (m = pbr ? makeRoadMaterials({ pbr, decal, planting }) : flatRoadMaterials());
  };
  return {
    name: 'roads',
    get mats() { return materials(); },
    build(tile, lod) {
      const part = buildRoadTile(net, tile, { lod, mats: materials(), groundY });
      if (!colliders) return part;
      const handles = part.colliders.map((c) => colliders.obb(c.cx, c.cz, c.w, c.d, c.yaw || 0, c.carOnly !== false));
      const inner = part.dispose;
      return { ...part, colliders: [], obbs: part.colliders, dispose() { for (const h of handles) colliders.remove(h); inner(); } };
    },
  };
}

function safeDecal(fn, id, opts) {
  try { return fn(id, opts) || null; } catch { return null; }
}

// ---------- pieces ----------

/** asphalt between a different-material arm's trimmed end and the patch circle */
function capFill(J, info, a, uvWorld) {
  const hw = a.hw, R = info.R;
  const tIn = Math.sqrt(Math.max(0, R * R - hw * hw));
  const nx = a.az, nz = -a.ax;
  const P = (t, o) => [info.x + a.ax * t + nx * o, info.z + a.az * t + nz * o];
  const phi = Math.atan2(hw, Math.max(0.01, tIn));
  const pts = [P(a.trim, hw), P(a.trim, -hw)];
  const n = 8;
  for (let k = 0; k <= n; k++) {
    const ang = -phi + (2 * phi * k) / n;
    pts.push(P(R * Math.cos(ang), R * Math.sin(ang)));
  }
  J.poly(pts, Y_ROAD, uvWorld);
}

/** points along a fillet's kerb arc from TA to TB (the short way round O) */
function filletArc(f) {
  const a0 = Math.atan2(f.TA[1] - f.O[1], f.TA[0] - f.O[0]);
  let da = Math.atan2(f.TB[1] - f.O[1], f.TB[0] - f.O[0]) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(3, Math.ceil(Math.abs(da) / (8 * DEG)));
  const pts = [];
  for (let k = 0; k <= n; k++) { const ang = a0 + (da * k) / n; pts.push([f.O[0] + Math.cos(ang) * f.rf, f.O[1] + Math.sin(ang) * f.rf]); }
  return pts;
}

/** a flat strip of width w along a polyline at height y, offset to one side (kerb tops on arcs) */
function strokeTop(batch, pts, w, y, side) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = (dz / L) * side, nz = (-dx / L) * side;
    batch.quad(a, c, [c[0] + nx * w, c[1] + nz * w], [a[0] + nx * w, a[1] + nz * w], y);
  }
}

/** give-way (1003A, two broken lines) or stop line (1002.1 / 1001) across the approach half of an arm */
function drawStopLine(W, p, sNode, dir, dist, stop, d, gore) {
  if (gore) return;
  const s = sNode + dir * dist;
  const f = frameAt(p.frames, s);
  const entryHw = dir === -1 ? f.hwL : f.hwR, exitHw = dir === -1 ? f.hwR : f.hwL;
  const sign = -dir;                       // the approaching driver's nearside is this side of the frame
  if (d.oneway && dir === 1) return;       // a one-way exit arm: nothing to give way to
  const o0 = d.oneway ? dir * exitHw : 0, o1 = sign * (entryHw - 0.1);
  if (stop) {
    transverse(W, p.frames, s, o0, o1, PATTERNS.stop_line_1002_1.w, Y_MARK);
  } else {
    const g = PATTERNS.give_way_1003A;
    transverseDashes(W, p.frames, s + dir * (g.w / 2), o0 + (o1 > o0 ? 0.1 : -0.1), o1, g.w, g.mark, g.gap, Y_MARK);
    transverseDashes(W, p.frames, s + dir * (g.w * 1.5 + g.between), o0 + (o1 > o0 ? 0.1 : -0.1), o1, g.w, g.mark, g.gap, Y_MARK);
  }
  // 1009A continues the major road's edge across the exit half
  if (!d.oneway) transverseDashes(W, p.frames, s, 0, dir * (exitHw - 0.1), 0.1, PATTERNS.edge_line_1009A.mark, PATTERNS.edge_line_1009A.gap, Y_MARK);
}

/** 1023A triangle: 3.75 long, 1.25 base towards the line, 0.15 sides, 0.6 solid band, centred in the approach lane */
function giveWayTriangle(W, p, sNode, dir, dist, d) {
  // base towards the give-way line, apex pointing back at the approaching driver (like the sign)
  const base = sNode + dir * (dist + 2.4 + 3.75), apex = sNode + dir * (dist + 2.4);
  const fb = frameAt(p.frames, base), fa = frameAt(p.frames, apex);
  const entryHw = dir === -1 ? fb.hwL : fb.hwR;
  const lane = d.oneway ? 0 : -dir * entryHw / 2;
  const bl = offsetPt(fb, lane + 0.625), br = offsetPt(fb, lane - 0.625), ap = offsetPt(fa, lane);
  strokeSeg(W, bl, ap, 0.15, Y_MARK);
  strokeSeg(W, br, ap, 0.15, Y_MARK);
  const fb2 = frameAt(p.frames, base + dir * 0.6);
  W.quad(bl, br, offsetPt(fb2, lane - 0.625 + 0.1), offsetPt(fb2, lane + 0.625 - 0.1), Y_MARK);
}

/** lane arrows from OSM turn:lanes, two per lane before a stop line at sLine (approach travelling in dirT) */
function laneArrowsFor(p, d, sLine, dirT, turnLanes, laneArrow) {
  const lanes = turnLanes.length;
  const laneW = d.fwdW / lanes;
  for (let k = 0; k < lanes; k++) {
    const turns = turnLanes[k] || [];
    const has = (t) => turns.includes(t);
    const kind = has('left') && has('right') ? 'left_right' : has('left') && (has('through') || !turns.length) ? 'ahead_left' : has('right') && (has('through') || !turns.length) ? 'ahead_right' : has('left') ? 'left' : has('right') ? 'right' : 'ahead';
    const o = d.hw - laneW * (k + 0.5);   // forward lanes count from the way's left edge
    for (const back of [8, 30]) {
      const f = frameAt(p.frames, sLine - dirT * back);
      const pt = offsetPt(f, o);
      laneArrow(kind, d.limit, pt[0], pt[1], dirT * f.tx, dirT * f.tz);
    }
  }
}

/** zebra / signal crossing markings across a way at arc length s */
function drawCrossing(W, p, s, type) {
  const F = p.frames, f = frameAt(F, s), d = p.d;
  const depth = 2.8, Z = PATTERNS.zigzag_1001;
  const signal = type === 'pelican' || type === 'puffin' || type === 'toucan' || type === 'signals';
  if (type !== 'zebra' && !signal) return;
  if (type === 'zebra') {
    // stripes run along the road, laid across it at 1.2 m pitch
    for (let o = -f.hwR + 0.6; o < f.hwL - 0.3; o += 1.2) stripAlong(W, F, s - depth / 2, s + depth / 2, o, 0.6, Y_MARK);
  } else {
    for (const side of [-1, 1]) transverse(W, F, s + side * depth / 2, -f.hwR + 0.1, f.hwL - 0.1, 0.1, Y_MARK);
  }
  const lineOff = depth / 2 + (type === 'zebra' ? 1.6 : 2.0);
  for (const dirT of d.oneway ? [1] : [1, -1]) {
    // give-way / stop line across the approach half (driver's left of travel is the frame's left for dirT = +1)
    const sl = s - dirT * lineOff;
    const o1 = dirT > 0 ? f.hwL - 0.1 : -(f.hwR - 0.1);
    if (type === 'zebra') transverseDashes(W, F, sl, d.oneway ? -(f.hwR - 0.1) : 0, o1, PATTERNS.zebra_give_way.w, 0.5, 0.5, Y_MARK);
    else transverse(W, F, sl, d.oneway ? -(f.hwR - 0.1) : 0, o1, PATTERNS.stop_line_1001.w, Y_MARK);
  }
  // zig-zags on both kerbs (and the centre on wide roads), both approaches, from the line outward
  const offs = [f.hwL - 0.4, -(f.hwR - 0.4)];
  if (d.width > 6 && !d.oneway) offs.push(d.centreOff);
  for (const o of offs) for (const dirZ of [-1, 1]) {
    const s0 = s + dirZ * lineOff;
    if (s0 + dirZ * Z.n * Z.markLen < 0 || s0 + dirZ * Z.n * Z.markLen > p.len) continue;
    zigzag(W, F, s0, dirZ, o, Z.amp, Y_MARK, Z.n, Z.markLen, Z.w);
  }
}

/** slip-road taper between the link's offside edge and the main carriageway's nearside edge */
function drawGore(view, info, batch, inBox, uvWorld) {
  const { link, kindG, mainWay } = info.gore;
  const pl = prepWay(view, link.way), pm = prepWay(view, mainWay);
  const sL = pl.nodeS.get(info.id), sM = pm.nodeS.get(info.id);
  if (sL == null || sM == null) return;
  const mainTrack = edgeTrack(pm, sM, kindG === 'merge' ? -1 : 1, 1, GORE_LEN + 10, 2);
  const L = [], M = [];
  for (let t = 0; t <= GORE_LEN; t += 3) {
    const f = frameAt(pl.frames, sL + link.dir * t);
    const pt = offsetPt(f, -f.hwR);
    const q = nearestOn(mainTrack, pt[0], pt[1]);
    if (!q || q.dist > 14) break;
    L.push(pt); M.push([q.x, q.z]);
  }
  if (L.length < 2) return;
  const A = batch(info.matKey), W = batch('white');
  for (let i = 0; i < L.length - 1; i++) A.quad(L[i], L[i + 1], M[i + 1], M[i], Y_ROAD, uvWorld);
  const len = (L.length - 1) * 3;
  const at = (arr) => (t) => { const k = Math.min(arr.length - 1, Math.max(0, t * (arr.length - 1))); const i = Math.floor(k), u = k - i; const a = arr[i], b = arr[Math.min(arr.length - 1, i + 1)]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
  // boundary lines inset into the gore, chevrons with the apex towards the driver
  const inset = (E, O, k) => (t) => { const e = E(t), o = O(t); const dx = o[0] - e[0], dz = o[1] - e[1], d = Math.hypot(dx, dz) || 1; return [e[0] + dx / d * k, e[1] + dz / d * k]; };
  const Lf = at(L), Mf = at(M);
  hatch(W, inset(Lf, Mf, 0.15), inset(Mf, Lf, 0.15), len, Y_MARK, { spacing: 1e9, w: 0.15, boundary: { w: 0.2, solid: true }, steps: L.length * 2 });
  chevrons(W, inset(Lf, Mf, 0.5), inset(Mf, Lf, 0.5), len, Y_MARK, { spacing: 6, stroke: 0.45, upstreamSign: kindG === 'merge' ? -1 : 1 });
  // 1010 broken edge line along the main carriageway across the gore instead of the solid edge line
  const Mi = M.map((q, i) => { const l = L[i]; const dx = l[0] - q[0], dz = l[1] - q[1], dd = Math.hypot(dx, dz) || 1; return [q[0] + dx / dd * 0.3, q[1] + dz / dd * 0.3]; });
  strokePolyline(W, Mi, 0.2, Y_MARK, PATTERNS.edge_broken_1010);
  void inBox;
}

/** samples [{x, z, t}] along an edge of a way from s0 in direction dir on side (+1 left) */
function edgeTrack(p, s0, dir, side, maxLen, step = 2) {
  const out = [];
  for (let t = 0; t <= maxLen; t += step) {
    const s = s0 + dir * t;
    if (s < 0 || s > p.len) break;
    const f = frameAt(p.frames, s);
    const pt = offsetPt(f, side * (side > 0 ? f.hwL : f.hwR));
    out.push({ x: pt[0], z: pt[1], t, tx: f.tx, tz: f.tz });
  }
  return out;
}
function nearestOn(track, x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    const px = a.x + dx * u, pz = a.z + dz * u;
    const dd = (px - x) ** 2 + (pz - z) ** 2;
    if (dd < bd) { bd = dd; best = { x: px, z: pz, t: a.t + (b.t - a.t) * u, tx: a.tx, tz: a.tz, i }; }
  }
  if (best) best.dist = Math.sqrt(bd);
  return best;
}

/** mini-roundabout: patch, white dome, three clockwise arrows, 1003.3 marks on every arm, SLOW on the approaches */
function drawMini(view, info, batch, laneArrow, wordDecal, uvWorld) {
  const Rm = Math.max(...info.arms.map((a) => a.hw)) + 2.0;
  const J = batch(info.matKey), W = batch('white');
  J.disc(info.x, info.z, Rm, Y_ROAD, 36, uvWorld);
  const rDisc = 1.6;
  W.disc(info.x, info.z, rDisc, 0.1, 28);
  const ring = [];
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; ring.push([info.x + Math.cos(a) * rDisc, info.z + Math.sin(a) * rDisc]); }
  W.wall(ring, Y_ROAD, 0.1, -1);
  // three arrows on a 6 m circle, clockwise on the map (atan2(z, x) increasing)
  for (let k = 0; k < 3; k++) curvedArrow(W, info.x, info.z, 3.0, k * (2 * Math.PI / 3) + 0.3, 3.0 / 3.0, 0.3, Y_MARK, 0.8);
  const g = PATTERNS.mini_roundabout_give_way_1003_3;
  for (const a of info.arms) {
    const p = prepWay(view, a.way);
    const sN = p.nodeS.get(info.id);
    if (sN == null) continue;
    const s = sN + a.dir * (Rm + 0.3);
    const f = frameAt(p.frames, s);
    const entryHw = a.dir === -1 ? f.hwL : f.hwR;
    if (a.d.oneway && a.dir === 1) continue;
    transverseDashes(W, p.frames, s, a.d.oneway ? a.dir * (a.dir === -1 ? f.hwR : f.hwL) : 0, -a.dir * (entryHw - 0.1), g.w, g.mark, g.gap, Y_MARK);
    // SLOW on the approach lane
    const fs = frameAt(p.frames, sN + a.dir * (Rm + 14));
    if (Math.abs(fs.s - sN) > Rm + 10) {
      const o = a.d.oneway ? 0 : -a.dir * entryHw / 2;
      const pt = offsetPt(fs, o);
      wordDecal('slow_1024', 'SLOW', a.d.limit, pt[0], pt[1], -a.dir * fs.tx, -a.dir * fs.tz);
    }
  }
  void laneArrow;
}

/**
 * A roundabout from its record: the OSM ring line is the OUTER edge of the circulatory carriageway,
 * which is the annulus [island, r] (net.js puts ring lane k at r - (k - 0.5) * laneW). Draws the
 * annulus, concentric lane lines, the kerbed central island, the outer kerb and pavement arcs
 * between the arms, the arm caps, entry give-way lines, splitter islands with hatching, approach
 * lane lines, lane arrows and destinations. Arm ribbons were trimmed at r + 0.3 by wayCuts().
 */
function drawRoundabout(view, rb, { batch, near, obb, laneArrow, wordDecal, uvWorld, mats, extraObjects, roads, groundY = null }) {
  const cx = rb.x, cz = rb.z, r = num(rb.r, 15), lanes = Math.max(1, num(rb.lanes, 1));
  const laneW = num(rb.laneW, r < 12 ? LW_RING_SMALL : LW);
  const island = Math.max(1.5, Math.min(r - 3, num(rb.island, r - lanes * laneW)));
  const limit = num(rb.limit, 30);
  const TAU = Math.PI * 2;
  const ringWays = (rb.ringWays || []).map((id) => view.ways.get(id)).filter(Boolean);
  const matKey = ringWays.length ? descOf(view, ringWays[0]).mat : 'asphalt';
  const paveRing = ringWays.some((w) => descOf(view, w).pave);
  const segs = Math.max(48, Math.round(r * 4));
  const P = (rad, a) => [cx + Math.cos(a) * rad, cz + Math.sin(a) * rad];
  const angleOf = (q) => Math.atan2(q[1] - cz, q[0] - cx);
  const arcPts = (rad, a0, a1) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (TAU / segs))); const out = []; for (let k = 0; k <= n; k++) out.push(P(rad, a0 + ((a1 - a0) * k) / n)); return out; };
  // ---- carriageway + island (both lods) ----
  batch(matKey).ring(cx, cz, island, r, 0, TAU, Y_ROAD, segs, uvWorld);
  const mid = (island + r) / 2, circle = [];
  for (let k = 0; k < 24; k++) { const q = P(mid, (k / 24) * TAU); circle.push(new THREE.Vector3(q[0], 0, q[1])); }
  roads.push({ points: circle, width: r - island, closed: true });
  batch('grass').disc(cx, cz, island, 0.14, segs, uvWorld);
  if (island >= 2) obb(cx, cz, island * 1.4, island * 1.4, 0, true);
  if (near) {
    const K = batch('kerb');
    K.ring(cx, cz, island - KERB_W, island, 0, TAU, KERB_H + 0.02, segs);
    K.wall(arcPts(island, 0, TAU), Y_ROAD, KERB_H + 0.02, 1);
    if (island >= 8 && mats.planting) {
      const spots = [];
      const n = Math.max(6, Math.round(island));
      // the island is draped on the hill, so the shrubs are planted on the ground under each one
      const gAt = (x, z) => (groundY ? groundY(x, z) : 0);
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + island * 0.37; const sx = cx + Math.cos(a) * island * 0.55, sz = cz + Math.sin(a) * island * 0.55; spots.push({ x: sx, z: sz, y: 0.14 + gAt(sx, sz), scale: 0.9 + 0.3 * ((i * 7) % 3) / 3, rot: a }); }
      spots.push({ x: cx, z: cz, y: 0.14 + gAt(cx, cz), scale: 1.3, rot: 0 });
      const o = mats.planting(spots);
      if (o) extraObjects.push(o);
    }
  }
  if (!near) return;
  const W = batch('white');
  // ---- circulating lane lines: 1004 pattern on concentric circles ----
  for (let k = 1; k < lanes; k++) {
    const rk = r - k * laneW, pat = hazardPattern(limit);
    for (const [m0, m1] of marks(0, TAU * rk, pat, 0)) W.ring(cx, cz, rk - pat.w / 2, rk + pat.w / 2, m0 / rk, m1 / rk, Y_MARK, 3);
  }
  // ---- arms ----
  const arms = [];
  const seen = new Set();
  const nodeIds = new Set([...(rb.ringNodes || []), ...(rb.arms || []).map((a) => a.node)]);
  for (const w of ringWays) for (const nid of w.nodes || []) if (nid) nodeIds.add(nid);
  for (const nid of nodeIds) {
    const node = view.nodes.get(nid);
    if (!node) continue;
    for (const wid of node.wayIds) {
      const w = view.ways.get(wid);
      if (!w || view.ringWayRb.get(wid) || !w.pts || seen.has(`${wid}:${nid}`)) continue;
      seen.add(`${wid}:${nid}`);
      const ap = prepWay(view, w);
      const arm = ap.ringArms.find((a) => a.nid === nid);
      if (arm) arms.push({ ...arm, p: ap });
    }
  }
  // angular footprint of each arm on the ring (kerb: the road; pavement band: road + pavements)
  const kerbCuts = [], paveCuts = [];
  const sense = rb.sense || 1;
  const armGeom = new Map();
  for (const a of arms) {
    const fe = frameAt(a.p.frames, a.sN + a.dir * a.trim);
    const cl = offsetPt(fe, fe.hwL), cr = offsetPt(fe, -fe.hwR);
    const leftCorner = a.dir === -1 ? cr : cl, rightCorner = a.dir === -1 ? cl : cr; // the arm's own left / right
    const nx = a.az, nz = -a.ax; // leftOf(arm)
    const cut = (pad, list) => {
      const l = [leftCorner[0] + nx * pad, leftCorner[1] + nz * pad], rr = [rightCorner[0] - nx * pad, rightCorner[1] - nz * pad];
      const a0 = angleOf(rr);
      let da = angleOf(l) - a0; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      const margin = 0.25 / r;
      list.push(...wrapInterval(Math.min(a0, a0 + da) - margin, Math.max(a0, a0 + da) + margin, TAU, true));
    };
    cut(0, kerbCuts);
    cut(a.d.pave ? KERB_W + PAVE_W : 0, paveCuts);
    armGeom.set(a, { fe, cl, cr, leftCorner, rightCorner });
  }
  const kerbRuns = subtract([[0, TAU]], union(kerbCuts)), paveRuns = subtract([[0, TAU]], union(paveCuts));
  const K = batch('kerb');
  for (const [a0, a1] of kerbRuns) { K.ring(cx, cz, r, r + KERB_W, a0, a1, KERB_H); K.wall(arcPts(r, a0, a1), Y_ROAD, KERB_H, -1); }
  if (paveRing) for (const [a0, a1] of paveRuns) batch('paving').ring(cx, cz, r + KERB_W, r + KERB_W + PAVE_W, a0, a1, Y_PAVE, null, uvWorld);
  for (const a of arms) {
    const { p, d, dir, sN, trim } = a;
    const { fe, leftCorner, rightCorner } = armGeom.get(a);
    // cap between the arm's trimmed end and the ring's outer edge
    const aR = angleOf(rightCorner);
    let da = angleOf(leftCorner) - aR; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    batch(matKey).poly([rightCorner, ...arcPts(r, aR, aR + da), leftCorner], Y_ROAD, uvWorld);
    if (!a.isEntry) continue;
    // entry give-way line 1003.1 along the ring's outer edge across the entry half
    const entryHw = dir === -1 ? fe.hwL : fe.hwR;
    const E = offsetPt(fe, -dir * entryHw);
    const aN = angleOf([a.node.x, a.node.z]);
    let dE = angleOf(E) - aN; while (dE > Math.PI) dE -= TAU; while (dE < -Math.PI) dE += TAU;
    const g = PATTERNS.roundabout_give_way_1003_1;
    const w = limit >= 50 ? 0.3 : g.w, rl = r - w / 2 - 0.05;
    const e0 = Math.min(aN, aN + dE), e1 = Math.max(aN, aN + dE);
    for (const [m0, m1] of marks(e0 * rl, e1 * rl, { mark: g.mark, gap: g.gap, w }, aN * rl)) W.ring(cx, cz, rl - w / 2, rl + w / 2, m0 / rl, m1 / rl, Y_MARK, 2);
    // splitter island / ghost island on two-way arms
    const entrySign = -dir;
    if (a.wMax > 0) {
      const s0 = sN + dir * (trim + 0.6), Ls = a.Ls;
      const wH = (t) => a.wMax * Math.max(0, 1 - t);
      const Lf = (t) => offsetPt(frameAt(p.frames, s0 + dir * t * Ls), wH(t)), Rf = (t) => offsetPt(frameAt(p.frames, s0 + dir * t * Ls), -wH(t));
      hatch(W, Lf, Rf, Ls, Y_MARK, { spacing: 2.0, w: 0.15, boundary: { w: 0.15, solid: true }, steps: 24 });
      if (a.splitter) {
        const Kb = batch('kerb'), Pb = batch('paving');
        const outline = [];
        const n = 12;
        const sk = (k) => 0.4 + ((Ls * 0.72 - 0.4) * k) / n;
        for (let k = 0; k <= n; k++) outline.push(offsetPt(frameAt(p.frames, s0 + dir * sk(k)), Math.max(0.05, wH(sk(k) / Ls) - 0.45)));
        for (let k = n; k >= 0; k--) outline.push(offsetPt(frameAt(p.frames, s0 + dir * sk(k)), -Math.max(0.05, wH(sk(k) / Ls) - 0.45)));
        Pb.poly(outline, KERB_H + 0.01, uvWorld);
        const loop = [...outline, outline[0]];
        Kb.wall(loop, Y_ROAD, KERB_H + 0.01, 1);
        Kb.wall(loop.slice().reverse(), Y_ROAD, KERB_H + 0.01, 1);
        const fm = frameAt(p.frames, s0 + dir * Ls * 0.33);
        obb(fm.x, fm.z, Math.max(0.6, 2 * (a.wMax - 0.45) * 0.8), Ls * 0.6, Math.atan2(dir * fm.tx, dir * fm.tz), true);
      }
      // lane lines between the entry lanes over the flare
      if (a.markLanes >= 2) {
        const sLine = sN + dir * trim, sFar = sN + dir * FLARE_LEN;
        for (let k = 1; k < a.markLanes; k++) {
          const off = (f) => {
            const t = Math.abs(f.s - s0) / Ls;
            const inner = wH(Math.min(1, Math.max(0, t))) + 0.3;
            const hw = dir === -1 ? f.hwL : f.hwR;
            return entrySign * (inner + ((hw - inner) * k) / a.markLanes);
          };
          dashesAlong(W, p.frames, Math.min(sLine, sFar), Math.max(sLine, sFar), hazardPattern(limit), off, sLine, Y_MARK);
        }
      }
    }
    // lane arrows and destinations on 2-3 lane entries (arrow farther, legend nearer the line)
    if (a.markLanes >= 2) {
      const kinds = a.markLanes === 2 ? ['ahead_left', 'ahead_right'] : ['ahead_left', 'ahead', 'right'];
      const sLine = sN + dir * trim;
      const dests = exitDestinations(rb, a, sense);
      const laneCentre = (back, k) => {
        const f = frameAt(p.frames, sLine + dir * back);
        const hw = dir === -1 ? f.hwL : f.hwR;
        const inner = a.wMax ? a.wMax * Math.max(0, 1 - (back - trim - 0.6) / a.Ls) + 0.3 : 0;
        // lane 0 = nearside (kerb side): one-way counts from the way's left edge, two-way from the kerb inward
        const o = d.oneway ? hw - (hw * 2 * (k + 0.5)) / a.markLanes : entrySign * (inner + ((hw - inner) * (a.markLanes - k - 0.5)) / a.markLanes);
        return { f, pt: offsetPt(f, o) };
      };
      for (let k = 0; k < a.markLanes; k++) {
        for (const back of [20, 50]) {
          const { f, pt } = laneCentre(back, k);
          laneArrow(kinds[k] || 'ahead', limit, pt[0], pt[1], -dir * f.tx, -dir * f.tz);
        }
        const text = dests[k];
        if (text) {
          const { f, pt } = laneCentre(12, k);
          wordDecal('lane_destination_1035', text, limit, pt[0], pt[1], -dir * f.tx, -dir * f.tz);
        }
      }
    }
  }
  // dual arms: hatched gore between an entry-only and exit-only way meeting the ring at neighbouring nodes
  for (const a of arms) {
    if (!a.d.oneway || a.dir !== -1) continue;
    const exit = arms.find((x) => x !== a && x.d.oneway && x.dir === 1 && Math.hypot(x.node.x - a.node.x, x.node.z - a.node.z) < 30 && (x.d.ref || x.d.name) === (a.d.ref || a.d.name));
    if (!exit) continue;
    const entryTrack = edgeTrack(a.p, a.sN - a.trim, -1, -1, 32, 2), exitTrack = edgeTrack(exit.p, exit.sN + exit.trim, 1, -1, 40, 2);
    const L = [], R = [];
    for (const e of entryTrack) {
      const q = nearestOn(exitTrack, e.x, e.z);
      if (!q || q.dist > 14 || q.dist < 0.3) break;
      L.push([e.x, e.z]); R.push([q.x, q.z]);
    }
    if (L.length < 3) continue;
    const at = (arr) => (t) => { const k = Math.min(arr.length - 1, Math.max(0, t * (arr.length - 1))); const i = Math.floor(k), u = k - i; const p0 = arr[i], p1 = arr[Math.min(arr.length - 1, i + 1)]; return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u]; };
    hatch(W, at(L), at(R), (L.length - 1) * 2, Y_MARK, { spacing: 2.0, w: 0.15, boundary: { w: 0.15, solid: true }, steps: L.length * 2 });
  }
}

/** destination words for the entry lanes of an arm: first exit on the left lane, the far exit on the right */
function exitDestinations(rb, arm, sense) {
  const list = (rb.arms || []).filter((x) => x.exit !== false && x.node !== arm.nid && x.dest);
  if (!list.length || !arm.data) return [];
  const rel = (x) => (((x.bearing - arm.data.bearing) * sense) % 360 + 360) % 360;
  const exits = list.map((x) => ({ x, rel: rel(x) })).filter((e) => e.rel > 15 && e.rel < 345).sort((p, q) => p.rel - q.rel);
  if (!exits.length) return [];
  const clean = (t) => String(t).toUpperCase().replace(/[^A-Z0-9' ]/g, '').slice(0, 10);
  const first = clean(exits[0].x.dest), last = clean(exits[exits.length - 1].x.dest);
  if (arm.entryLanes === 2) return [first, last !== first ? last : null];
  const mid = exits[Math.floor(exits.length / 2)];
  return [first, mid ? clean(mid.x.dest) : null, last !== first ? last : null];
}

/** the opposite carriageway of a dual one-way way, if it is in this tile cell */
function findPartner(view, cell, p) {
  const d = p.d;
  const key = d.ref || d.name;
  if (!key) return null;
  const mid = p.frames[Math.floor(p.frames.length / 2)];
  let best = null, bd = 30;
  for (const w of cell.ways) {
    if (w === p.way) continue;
    const q = descOf(view, w);
    if (!q.dual || (q.ref || q.name) !== key) continue;
    const qp = prepWay(view, w);
    const near = sNearest(qp, mid.x, mid.z);
    if (near.dist > 30 || near.dist < 3) continue;
    const f = frameAt(qp.frames, near.s);
    if (f.tx * mid.tx + f.tz * mid.tz > -0.3) continue;            // must run the other way
    if ((f.x - mid.x) * mid.nx + (f.z - mid.z) * mid.nz > 0) continue; // and lie on our right
    if (near.dist < bd) { bd = near.dist; best = qp; }
  }
  return best;
}

/** grass central reservation between two carriageways' offside edges, with kerbs and a steel barrier on trunk roads */
function drawReservation(p, partner, { batch, near, inBox, obbAlong, uvWorld, trunk }) {
  const track = edgeTrack(partner, 0, 1, -1, partner.len, 3);
  const G = batch('grass');
  const A = [], Bp = [], mids = [];
  let run = [];
  const flush = () => {
    if (run.length < 2) { run = []; return; }
    for (let i = 0; i < run.length - 1; i++) {
      const [a0, b0] = run[i], [a1, b1] = run[i + 1];
      G.quad(a0, a1, b1, b0, 0.05, uvWorld);
    }
    if (near) {
      const K = batch('kerb');
      const ea = run.map((r) => r[0]), eb = run.map((r) => r[1]);
      K.wall(ea, Y_ROAD, 0.1, -1); strokeTop(K, ea, KERB_W, 0.1, -1);
      K.wall(eb, Y_ROAD, 0.1, 1); strokeTop(K, eb, KERB_W, 0.1, 1);
      const gapOK = run.every((r) => Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) >= 1.5);
      if (trunk && gapOK) {
        const Bm = batch('barrier');
        const m = run.map((r) => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2]);
        for (let i = 0; i < m.length - 1; i++) {
          const dx = m[i + 1][0] - m[i][0], dz = m[i + 1][1] - m[i][1], L = Math.hypot(dx, dz);
          // a slim Armco rail at ~0.6 m with thin posts behind it, not a chunky elevated beam
          Bm.box((m[i][0] + m[i + 1][0]) / 2, 0.5, (m[i][1] + m[i + 1][1]) / 2, 0.12, 0.26, L + 0.02, Math.atan2(dx, dz));
          for (let t = 1.6; t < L; t += 3.2) Bm.box(m[i][0] + dx * t / L, 0, m[i][1] + dz * t / L, 0.08, 0.6, 0.08, Math.atan2(dx, dz));
        }
        obbAlong(m, 0.5, true);
      }
    }
    run = [];
  };
  for (const f of p.frames) {
    if (!inBox(f.x, f.z)) { flush(); continue; }
    const a = offsetPt(f, -f.hwR);
    const q = nearestOn(track, a[0], a[1]);
    const ok = q && q.dist < 32 && q.dist > 0.4 && (q.tx * f.tx + q.tz * f.tz) < -0.3 && ((q.x - f.x) * f.nx + (q.z - f.z) * f.nz) < 0;
    if (!ok) { flush(); continue; }
    run.push([a, [q.x, q.z]]);
  }
  flush();
  void A; void Bp; void mids;
}

/** internals for node tests (tools/ and the lab); not part of the tile API */
export const _internals = { descOf, prepWay, nodeInfo, wayCuts, findPartner, ringArm };
