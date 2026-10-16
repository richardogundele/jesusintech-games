// Driving lesson routes on the real Kent roads: where each lesson starts and the junctions it goes
// through, turned into a lane path with the events LessonRun marks (net.route + net.lanePath), plus
// the extra things a lesson needs that a traffic car doesn't: stop lines where roads.js paints them,
// pull-ups part way round (some behind a parked car, for the angled start), pulling up on the right
// and reversing, and a forward bay park at the Herne Bay test centre. Pure data and maths (no
// three.js scene work), so node can drive it (tools/lesson-check.mjs, tools/net-check.mjs).
//
// Conventions as net.js: metres, x east, z south, a heading h travels along (sin h, cos h), the
// driver's left is (cos h, -sin h); lateral offsets are + to the left of travel.

import { netView, _internals } from './roads.js';

const { nodeInfo } = _internals;
const hyp = Math.hypot;
const LW = 3.65;

// ---------- the test centres ----------
/** which test centre a lesson starts from */
export const CENTRES = {
  herne: { name: 'Herne Bay', match: /herne/i },
  canterbury: { name: 'Canterbury', match: /canterbury/i },
};
export function centreOf(net, key) { return net.testCentres.find((t) => CENTRES[key].match.test(t.name)) || net.testCentres[0]; }

/**
 * The test centre as scenery.js builds it: a 26 x 12 m brick box with its long side along the
 * nearest road and, if the road is more than 30 m away, a 40 x 20 m car park between the two with
 * eleven bays (2.6 m apart, 5 m deep) along the building side. u runs along the road, n points
 * from the building towards the road. Keep in step with scenery.js (landmarks, testCentre).
 */
export function testCentreLayout(net, tc) {
  const hit = net.nearest(tc.x, tc.z, 120);
  const roadYaw = hit ? Math.atan2(hit.dir[0], hit.dir[1]) : 0;
  const toRoad = hit ? [hit.px - tc.x, hit.pz - tc.z] : [0, 1];
  const yaw = roadYaw + Math.PI / 2, c = Math.cos(yaw), s = Math.sin(yaw);
  const nz = [s, c], sgn = Math.sign(nz[0] * toRoad[0] + nz[1] * toRoad[1]) || 1;
  const n = [nz[0] * sgn, nz[1] * sgn], u = [c, -s];
  const out = { tc, hit, u, n, yaw, roadDist: hit ? hit.dist : 0, lot: null, bays: [] };
  if (hit && hit.dist > 30) {
    const lx = tc.x + n[0] * 17.5, lz = tc.z + n[1] * 17.5;
    out.lot = { x: lx, z: lz, w: 40, d: 20 }; // w along u, d along n
    const head = Math.atan2(-n[0], -n[1]); // nose in, towards the building
    for (let i = 0; i < 11; i++) {
      const o = -13 + i * 2.6;
      out.bays.push({ x: lx + u[0] * o - n[0] * 4, z: lz + u[1] * o - n[1] * 4, o, heading: head, w: 2.4, l: 5 });
    }
  }
  /** local (u, n) offsets from the lot centre (or the centre itself) to world x, z */
  const base = out.lot || { x: tc.x, z: tc.z };
  out.at = (uo, no) => ({ x: base.x + u[0] * uo + n[0] * no, z: base.z + u[1] * uo + n[1] * no });
  out.local = (x, z) => ({ u: (x - base.x) * u[0] + (z - base.z) * u[1], n: (x - base.x) * n[0] + (z - base.z) * n[1] });
  /** inside the car park (with the verge between it and the road) */
  out.inLot = (x, z) => { if (!out.lot) return false; const l = out.local(x, z); return Math.abs(l.u) < out.lot.w / 2 + 1 && l.n > -out.lot.d / 2 - 1 && l.n < out.roadDist - 17.5 - 2.5; };
  return out;
}

// ---------- routes ----------
/**
 * spec: { centre, start: { x, z, heading? }, vias: [node id | { x, z }], to: node id | { x, z },
 *   end: 'pullup' | 'baypark', bayFrom: where on the road (m along it) the route hands over to the
 *   car park, stops: number of pull-ups part way, angled: true to make one an angled start,
 *   pullRight: true for the pull up on the right and reverse, or manoeuvre: 'either' to pick the bay
 *   park or the pull up on the right per run (then pullUpAt is where the run ends instead) }
 * Returns { pts, events, length, start, layout, route } with pts carrying { x, z, s, way, lane, rb,
 * road, man?, park?, off? } and the events net.lanePath gives, plus lineS on lights and zebras,
 * 'stop' / 'pullright' events, and a 'baypark' end with the bay.
 */
export function buildKentRoute(net, spec, { rnd = Math.random } = {}) {
  // the test's one manoeuvre: a bay park at the end, or the pull up on the right and an ordinary pull-up
  if (spec.manoeuvre === 'either') spec = rnd() < 0.5 ? { ...spec, manoeuvre: 'baypark', pullRight: false } : { ...spec, manoeuvre: 'pullright', end: 'pullup', to: spec.pullUpAt, pullRight: true };
  const tc = centreOf(net, spec.centre || 'herne');
  const layout = testCentreLayout(net, tc);
  let to = spec.to;
  if (spec.end === 'baypark' && layout.lot) {
    // finish on the road short of the car park entrance, travelling with the car park on the left
    const lane = layout.roadDist - 17.5; // road centreline n offset from the lot centre
    to = layout.at(spec.bayFrom ?? 38, lane); // bayFrom: + is up the road on the side we come from
  }
  const route = net.route({ x: spec.start.x, z: spec.start.z, maxD: 30 }, to, { via: spec.vias || [], noUturn: !!spec.noUturn, avoid: spec.avoid || [] });
  if (!route) throw new Error(`no route for ${spec.id || 'lesson'}`);
  const lp = net.lanePath(route, { end: spec.end === 'baypark' ? 'pullup' : spec.end || 'pullup' });
  const pts = lp.pts;
  let events = lp.events.filter((e) => e.kind !== 'pullup' || spec.end !== 'baypark');
  fixLines(net, pts, events);
  events = dedupe(events);
  const viaXZ = (spec.vias || []).map((v) => (typeof v === 'number' ? { x: net.nodes.get(v).x, z: net.nodes.get(v).z } : v));
  const out = { pts, events, length: lp.length, start: lp.start, layout, route, tc, viaXZ, spec }; // spec as resolved (the manoeuvre picked)
  if (spec.end === 'baypark' && layout.lot) addBayPark(out, layout, rnd);
  // part-way pull-ups and the pull up on the right: on quiet, straight stretches of town road
  const used = [];
  if (spec.pullRight) addPullRight(out, used, rnd);
  const nStops = spec.stops ?? 0;
  for (let k = 0; k < nStops; k++) addStop(out, used, rnd, { angled: spec.angled && k === 0, frac: (k + 1) / (nStops + 1) });
  out.events.sort((a, b) => a.s - b.s);
  return out;
}

/** index of the last path point at or before arc length s (binary search) */
export function idxAtS(pts, s) {
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].s <= s) lo = m; else hi = m - 1; }
  return lo;
}
const yawAt = (pts, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return Math.atan2(b.x - a.x, b.z - a.z); };

/**
 * Stop lines where roads.js paints them: at a junction the arm's line distance back from the node
 * (as traffic.js stops its cars), at a signal crossing 3.4 m before its centre, and the give-way line
 * 3 m before a zebra's stripes. Lights groups get `lineS`; zebras get `lineS` and the crossing key.
 */
function fixLines(net, pts, events) {
  const view = netView(net);
  for (const e of events) {
    if (e.kind === 'lights') {
      if (e.crossing) { e.lineS = e.s + 1.1; continue; }
      const node = net.nodes.get(e.node);
      if (!node) { e.lineS = e.s; continue; }
      const j = idxAtS(pts, e.s - 3), here = pts[j]?.way, tx = pts[Math.min(pts.length - 1, j + 1)].x - pts[j].x, tz = pts[Math.min(pts.length - 1, j + 1)].z - pts[j].z;
      let dist = 0, best = -2;
      for (const a of nodeInfo(view, e.node)?.arms || []) { if (a.way.id !== here) continue; const dot = -(a.ax * tx + a.az * tz); if (dot > best && a.lineDist) { best = dot; dist = a.lineDist; } }
      if (!dist) { let hw = 3; for (const r of node.ways) if (r.way.id !== here && !r.way.rb) hw = Math.max(hw, r.way.halfW); dist = hw + 1; }
      // where the path passes the node
      let nodeS = e.s + 2, bd = Infinity;
      for (let i = idxAtS(pts, e.s - 10); i < pts.length && pts[i].s <= e.s + 12; i++) { const d = hyp(pts[i].x - node.x, pts[i].z - node.z); if (d < bd) { bd = d; nodeS = pts[i].s; } }
      e.lineS = Math.max(0, nodeS - dist);
    } else if (e.kind === 'zebra') e.lineS = e.s + 1.5;
  }
}
/** one decision per set of lights (OSM splits big junctions over several signal nodes) and per zebra */
function dedupe(events) {
  const out = [];
  for (const e of events) {
    if (e.kind === 'lights' && out.some((o) => o.kind === 'lights' && o.group === e.group && e.s - o.s < 90)) continue;
    if (e.kind === 'zebra' && out.some((o) => o.kind === 'zebra' && o.key === e.key && e.s - o.s < 40)) continue;
    out.push(e);
  }
  return out;
}

/** a stretch [s0, s1] with nothing else going on: no junction, crossing, ring or lane change within `pad` m, a town road */
function quietAt(out, s0, s1, pad = 45, used = []) {
  const { pts, events } = out;
  if (s0 < 120 || s1 > out.length - 120) return false;
  if (events.some((e) => e.kind !== 'bend' && (e.lineS ?? e.entryS ?? e.s) > s0 - pad && (e.exitS ?? e.s) < s1 + pad)) return false;
  if (used.some(([a, b]) => s0 < b + 150 && s1 > a - 150)) return false;
  for (let i = idxAtS(pts, s0); i < pts.length && pts[i].s <= s1; i++) {
    const r = pts[i].road; if (!r || r.rb || r.dual || r.nsl || r.limit > 30 || r.lanes > 1 || pts[i].rb || pts[i].man || pts[i].park) return false;
    if (i > 3 && i < pts.length - 4) { // straight: under 12 degrees over 6 m
      let d = yawAt(pts, i + 3) - yawAt(pts, i - 3); d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.21) return false;
    }
    const w = wayAt(out, i); if (!w || w.oneway) return false;
  }
  return true;
}
const wayAt = (out, i) => out.route.ways.find((r) => r.way.id === out.pts[i].way)?.way;
/** pick a quiet stretch of `len` m somewhere around fraction `frac` of the route */
function pickStretch(out, len, used, frac, rnd, wayOk = null) {
  const L = out.length, tries = [];
  for (let k = 0; k < 60; k++) tries.push(L * Math.min(0.9, Math.max(0.08, frac + (rnd() - 0.5) * 0.5)));
  for (let s = 140; s < L - 140; s += 25) tries.push(s);
  for (const s0 of tries) if (quietAt(out, s0, s0 + len, 45, used) && (!wayOk || wayOk(wayAt(out, idxAtS(out.pts, s0 + len / 2))))) return s0;
  return null;
}
/** shift path points sideways (+ = left) by off(s) between s0 and s1, marking them as a manoeuvre */
function shift(pts, s0, s1, off, tag) {
  const base = pts.map((p) => ({ x: p.x, z: p.z }));
  for (let i = idxAtS(pts, s0); i < pts.length && pts[i].s <= s1; i++) {
    const h = yawAt(base, i), o = off(pts[i].s);
    pts[i].x = base[i].x + Math.cos(h) * o; pts[i].z = base[i].z - Math.sin(h) * o;
    pts[i].off = o;
    if (tag) pts[i][tag] = true;
  }
}
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A pull-up part way: "pull up on the left at the next safe place", then move off again. The path
 * eases 0.45 m towards the kerb for the stop. An angled start puts a parked car 7 m ahead of the
 * stopping point and swings the path out round it.
 */
function addStop(out, used, rnd, { angled = false, frac = 0.5 } = {}) {
  const len = angled ? 60 : 40, s0 = pickStretch(out, len, used, frac, rnd);
  if (s0 == null) return;
  used.push([s0, s0 + len]);
  const sStop = s0 + 18, pts = out.pts;
  // lane centre to kerb, less half a car and a hand's width: where a careful driver stops
  const w = wayAt(out, idxAtS(pts, sStop)), room = w ? Math.max(0, w.halfW - Math.abs(netLaneOff(w)) - 1.15) : 0.4;
  const kerb = Math.min(0.6, room);
  const e = { kind: 'stop', s: sStop, angled, text: angled ? 'Pull up on the left, just behind the parked car, please.' : 'Pull up on the left at the next safe place, please.' };
  if (!angled) shift(pts, s0, s0 + len, (s) => kerb * Math.min(ease((s - s0) / 14), ease((s0 + len - s) / 12)), 'man');
  else {
    // the parked car: nose 7 m past where we stop, tight to the kerb; the way out swings 2.3 m right round it
    const iP = idxAtS(pts, sStop + 9.5), h = yawAt(pts, iP), off = kerb + 0.15;
    e.parked = { x: pts[iP].x + Math.cos(h) * off, z: pts[iP].z - Math.sin(h) * off, heading: h };
    shift(pts, s0, s0 + len, (s) => (s < sStop ? kerb * ease((s - s0) / 14) : s < sStop + 1 ? kerb : s < sStop + 13 ? kerb + (-2.3 - kerb) * ease((s - sStop - 1) / 6) : -2.3 * (1 - ease((s - sStop - 13) / 22))), 'man');
  }
  out.events.push(e);
}
function netLaneOff(w) { return w.oneway ? 0 : w.halfW / 2; }

/**
 * Pull up on the right and reverse about two car lengths (DVSA manoeuvre): across to the right-hand
 * kerb over 25 m, stop, reverse 8 m, then back to the left over 30 m. Needs a quiet two-way street.
 */
function addPullRight(out, used, rnd) {
  const len = 110, s0 = pickStretch(out, len, used, 0.55, rnd, (w) => w.cls === 'residential' || w.cls === 'unclassified') ?? pickStretch(out, len, used, 0.55, rnd);
  if (s0 == null) return;
  used.push([s0, s0 + len]);
  const pts = out.pts, w = wayAt(out, idxAtS(pts, s0 + 40));
  const right = -(w.halfW + w.halfW / 2 - 1.15); // from my lane centre to 0.3 m off the far kerb
  const sA = s0 + 20, sStop = sA + 40;
  // back across to the left fairly briskly once moving, so a car coming the other way has room
  shift(pts, s0, s0 + len, (s) => (s < sA + 28 ? right * ease((s - sA) / 28) : s < sStop + 2 ? right : right * (1 - ease((s - sStop - 2) / 14))), 'man');
  out.events.push({ kind: 'pullright', s: sA, stopS: sStop, reverse: 8.5, text: 'Pull up on the right-hand side of the road when it is safe, please.' });
}

/**
 * The end of the test at Herne Bay: off the road into the car park, along the aisle and forward
 * into a free bay. The tail is a polyline with rounded corners, resampled every 0.75 m.
 */
function addBayPark(out, layout, rnd) {
  const { pts, events } = out;
  const last = pts[pts.length - 1];
  const lastL = layout.local(last.x, last.z), lane = lastL.n; // the road lane we arrive in
  // travel along +u or -u?
  const pv = pts[Math.max(0, pts.length - 6)], du = (last.x - pv.x) * layout.u[0] + (last.z - pv.z) * layout.u[1], dirU = du >= 0 ? 1 : -1;
  // a bay well inside the car park (the eyesight car takes one near the end)
  const pick = layout.bays.filter((b) => b.o * dirU > -6 && b.o * dirU < 8);
  const bay = pick[Math.floor(rnd() * pick.length)] || layout.bays[5];
  const entryU = -16 * dirU, aisleN = 3.2, bayN = -4;
  const corners = [
    [lastL.u, lane], [entryU - 5 * dirU, lane], [entryU + 2 * dirU, aisleN + 1.5], [entryU + 6 * dirU, aisleN], [bay.o - 5.8 * dirU, aisleN], [bay.o, aisleN - 5.6], [bay.o, bayN],
  ].map(([uo, no]) => layout.at(uo, no));
  const raw = roundCorners(corners, [0, 4, 4, 3, 5.4, 0, 0]);
  const s0 = last.s;
  let s = s0, prev = last;
  const meta = { way: last.way, lane: 1, rb: null, road: { lanes: 1, limit: 10, nsl: false, dual: false, rb: null } };
  const tail = [];
  for (let k = 1; k < raw.length; k++) {
    const a = raw[k - 1], b = raw[k], L = hyp(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.75));
    for (let j = 1; j <= n; j++) {
      const x = a.x + ((b.x - a.x) * j) / n, z = a.z + ((b.z - a.z) * j) / n;
      s += hyp(x - prev.x, z - prev.z);
      prev = { x, z, s, ...meta, park: layout.inLot(x, z) || k > 1 };
      tail.push(prev);
    }
  }
  pts.push(...tail);
  out.length = s;
  events.push({ kind: 'baypark', s, bay, entryS: s0 + 6, text: 'At the end of the road, turn left into the test centre car park, and drive forward into a bay, please.' });
  out.bay = bay;
}
/** a polyline with each inner corner replaced by a quadratic curve of the given radius */
function roundCorners(P, R) {
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1], r = R[i] || 0;
    const la = hyp(b.x - a.x, b.z - a.z), lc = hyp(c.x - b.x, c.z - b.z);
    if (!r || la < 0.1 || lc < 0.1) { out.push(b); continue; }
    const rr = Math.min(r, la * 0.5, lc * 0.5);
    const A = { x: b.x + ((a.x - b.x) * rr) / la, z: b.z + ((a.z - b.z) * rr) / la }, C = { x: b.x + ((c.x - b.x) * rr) / lc, z: b.z + ((c.z - b.z) * rr) / lc };
    out.push(A);
    for (let k = 1; k < 8; k++) { const t = k / 8, u = 1 - t; out.push({ x: u * u * A.x + 2 * u * t * b.x + t * t * C.x, z: u * u * A.z + 2 * u * t * b.z + t * t * C.z }); }
    out.push(C);
  }
  out.push(P[P.length - 1]);
  return out;
}

// ---------- the lessons' routes ----------
// Starts are kerbside points on the road outside the test centre; vias are graph node ids (they
// can't snap to the wrong carriageway) or points on two-way roads. Lengths are what net.route gives.
const HB_EAST = { x: 3335, z: -4743.2 };  // The Boulevard, eastbound kerb, west of the centre
const HB_WEST = { x: 3425, z: -4746.2 };  // The Boulevard, westbound kerb, east of the centre
const CT_NW = { x: -815, z: 5060 };     // New Dover Road, north-west bound kerb, by the Canterbury centre
export const KENT_ROUTES = {
  // The Boulevard to its turning circle and back, then Margate Road and Reculver Road
  moveoff: { centre: 'herne', start: HB_EAST, vias: [5105, { x: 3300, z: -4746 }, 4495], to: { x: 3420, z: -5200 }, stops: 3, angled: true },
  // the gearbox lessons: The Boulevard (pull-ups for clutch control, the stall drill, P R N D), then
  // Margate Road and Reculver Road
  clutch: { centre: 'herne', start: HB_EAST, vias: [5105, { x: 3300, z: -4746 }, 4495], to: { x: 3420, z: -5200 }, stops: 3 },
  autocontrols: { centre: 'herne', start: HB_EAST, vias: [5105, { x: 3300, z: -4746 }, 4495], to: { x: 3420, z: -5200 }, stops: 2 },
  // gears: Reculver Road, Mickleburgh Hill, the A299 link road up to 40, the Eddington rings (change down,
  // block change), the A299 at 70 in fifth, off at Margate Road and back to the centre
  gears: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 4495, 4403, 121, 466, 469, 1723], to: { x: 3420, z: -4743.5 } },
  // the Herne Bay town grid: King's Road, Beach Street, Hanover Street, Brunswick Square, Station Road
  junctions: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 996, 997, 1000, 1274, 2612, 2613, 1179, 999], to: { x: 2048, z: -5650 } },
  // Altira, the Margate Road rings, the A299 link road, Eddington C and B, Greenhill, Sea Street
  roundabouts: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 4403, 121, 4066, 4214, 4217, 3300, 4224], to: { x: 975.9, z: -5500.1 } }, // ends on Sea Street
  // King's Road zebras, the Station Road crossings, Dolphin Street, the Central Parade zebras
  crossings: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 996, 1085, 1179, 1177, 4849, 4848, 4683, 1721], to: { x: 2330, z: -5891 } },
  // the A299 link road, the three Eddington roundabouts, on to the A299 at 70, off at Margate Road
  dual: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 4403, 121, 466, 469, 1723], to: { x: 3420, z: -4743.5 } },
  // Reculver Road: pull up on the right and reverse; then back to the centre and a bay
  manoeuvres: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 4495, 1089, 947, 5119, 4495], end: 'baypark', bayFrom: 38, pullRight: true },
  // the Herne Bay test: A299 both ways, Eddington, Greenhill, Sea Street, the town, Beltinge, Mickleburgh Hill
  // the Canterbury test: St George's Place lights, the ring road clockwise (St George's, Rhodaus Town,
  // Wincheap, Rheims Way, the London Road roundabout), St Peter's Place, Kingsmead, the A28 Sturry Road
  // dual carriageway, the three-lane Northgate and Chaucer roundabouts, back down New Dover Road.
  // (The A2 has no junction to turn at inside the map: its next ones, Bridge and Harbledown, are off it.)
  'mock-canterbury': { centre: 'canterbury', start: CT_NW, vias: [41, 209, 384, 185, 502, 453, 3572, 100, 223, { x: -177, z: 3440 }, 224, 99, 96, 198, 42, 4289, 4290], to: { x: -800, z: 5068 }, stops: 2, angled: true, pullRight: true },
  // the Herne Bay test: Reculver Road and Beltinge, Central Parade's zebras, the town's 20 mph streets,
  // King's Road, Sea Street and its lights, the Greenhill roundabout, the A2990, Eddington B and A, the
  // A299 at 70, off at Margate Road. One manoeuvre, picked on the day: the bay park at the end, or
  // pulling up on the right.
  mock: { centre: 'herne', start: HB_EAST, vias: [{ x: 3300, z: -4746 }, 4495, 1089, 947, 1721, 4683, 4848, 2453, 2713, 1177, 1000, 997, 1085, 1179, 4230, 4224, 3300, 4218, 4216, 128, 466, 469, 1723], end: 'baypark', bayFrom: 38, stops: 2, angled: true, manoeuvre: 'either', pullUpAt: { x: 3420, z: -4743.5 } },
};
