// The 15-minute driving test: a different route every time from either test centre, built from a
// seed (stored with the result, so "retry this route" drives exactly the same one). A route is put
// together the way an examiner plans one: out from the centre, round an estate or two for the turns
// and the emerging, one stretch of big road (the multi-lane roundabout and the dual carriageway or
// 40+ road), and back by a set way home. The parts are named pieces of real road (the pools below:
// every via a graph node, the estates' junctions picked because centre -> junction -> centre makes a
// clean drive in and out, and the lot swept with the careful autopilot in tools/lesson-check.mjs
// --gen, with the junctions and roads where it kept coming to grief left out or avoided). They're
// visited in the order a drive round the centre meets them, either way round; net.route fills the
// roads in between and buildKentRoute lane-paths it. A route is kept only if it is a fair test: no
// U-turns, turning circles or cuts across a roundabout island, no long run of road driven twice the
// same way, two roundabouts or more (one multi-lane), a dual carriageway or 40+ road, left and right
// turns, emerging, a crossing or lights, and about 15 minutes of driving.
// Pure maths and data (no scene), so node can run it (tools/lesson-check.mjs --gen).
//
// The test follows DVSA's examiner guidance (DT1, section 14 "Test wordings",
// https://www.gov.uk/guidance/guidance-for-driving-examiners-carrying-out-driving-tests-dt1/14-test-wordings):
// independent driving is briefed with the car pulled up on the left, by sat nav or by following
// traffic signs (roughly one test in five), one manoeuvre, a normal stop and an angled start, and
// sometimes an emergency stop.
import { buildKentRoute, testCentreLayout, centreOf, idxAtS } from './lesson-routes.js';

/** a small seeded random number generator (mulberry32): the same seed, the same test */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const HB_EAST = { x: 3335, z: -4743.2 }, CT_NW = { x: -815, z: 5060 };
// Each pool: where the test starts (`first`: vias every route begins with, so it pulls away the
// way the car is parked: a point on The Boulevard at Herne Bay, node 40 on New Dover Road at
// Canterbury; `last`: vias every route ends with), avoid (roads the route may not use, by name or
// way id: where the careful driver or the traffic kept getting stuck or colliding in the --gen sweeps,
// and turning circles the router would use to turn round), timeK (the estimate against the careful
// driver's simulated minutes, averaged over the two gearboxes: a manual takes about half a minute
// more than the estimate, an automatic a little less), window (the minutes the estimate must land
// in, inside the 14-16 a test takes, so the simulated drive lands in 13-17 either way), quick
// (minutes from the bare route before the lane path is built: a * minutes at the limits + b *
// junctions + c, fitted on a thousand built routes from each centre, within a minute of
// estimateMinutes nine times in ten).
// mains: the big-road parts. A route takes one road part, and where the pool knows a multi-lane
// roundabout as a part of its own (auto-pool tags those `kind: 'ring'`, because the estates round a
// city centre may never meet one) it may take one of those as well, so a route can have both the
// fast road and the ring the examiner's checks ask for. homes:
// the way back to the centre, one per route, where it matters which way the car arrives.
// loops: estates and town streets. `vias`: driven in that order (`rev`: or the other way round);
// `pick`: one of these junctions inside the estate (`n`: more, in a random order), each vetted to make
// a clean drive in and out a different way, and the router finds its own way through the streets, so
// one estate drives differently from test to test.
// `at: 'last'`: the part ends near the centre, so nothing comes after it. `area`: estates that share
// streets; a route takes one estate from an area at most.
const POOLS = {
  // avoided at Herne Bay: Spenser Road and Mill View Road (emerging onto the A291, the careful driver
  // stalled or pulled out in front of traffic), King Edward Avenue and Dence Park (the queue to emerge
  // onto Mickleburgh Hill locked solid), way 176864792 (the slip road from Margate Road onto the A299
  // westbound: collisions merging); left out: Herne village (its mini roundabout locks solid), Reculver
  // Drive (a junction beside the Reculver Road zebra), Hillborough, Braid Drive
  herne: {
    name: 'Herne Bay', start: HB_EAST, timeK: 0.925, avoid: ['Spenser Road', 'King Edward Avenue', 'Dence Park', 'Mill View Road', 176864792], first: [{ x: 3300, z: -4746 }], last: [], pullUpAt: { x: 3420, z: -4743.5 }, bay: true, quick: [0.874, 0.0381, 1.552], window: [14.3, 15.7],
    mains: {
      a299home: { name: 'Eddington Junction and the A299 at 70 home', vias: [469, 1723], at: 'last' },
      greenhillW: { name: 'the A2990 to the Greenhill roundabout', vias: [4214, 4217] },
      greenhillE: { name: 'the Greenhill roundabout and the A2990 to Eddington', vias: [4218, 4216, 128] },
      relief: { name: 'Eddington Junction and the Herne Relief Road', vias: [5313, 5317], rev: true },
    },
    loops: {
      grange: { name: 'Grange Road, Glen Avenue and Landon Road', pick: [1882, 1382, 2557, 2563] },
      beltinge: { name: 'Reculver Road, Sea View Road and the Beltinge lights', vias: [1089, 947], rev: true, area: 'beltinge' },
      seaView: { name: 'Sea View Road, Beacon Avenue and Beacon Hill', pick: [1866, 1867, 2015, 1878, 2738], area: 'beltinge' },
      thundersland: { name: 'Thundersland Road, Mickleburgh Avenue and Herne Avenue', pick: [1359, 1372, 1373, 1361] },
      talmead: { name: 'Talmead Road and Viscount Square', pick: [3957, 3480] },
      broomfield: { name: 'Broomfield Road, Gorse Lane and The Meadows', pick: [145, 124, 141, 157] },
      hawefarm: { name: 'Hunters Forstal Road, Hawe Farm Way and Mill Lane', pick: [153, 113, 981, 985, 1264, 979, 1156] },
      kings: { name: "Queen's Roundabout, King's Road, South Road and Gosfield Road", pick: [995, 1003, 2008, 1739, 1738], area: 'victoria' },
      town: { name: "the town's 20 mph streets (Beach Street, William Street, Mortimer Street, Station Road)", pick: [1274, 997, 999, 1328, 1709, 1720, 4685, 1179, 2620, 3934] },
      victoria: { name: 'High Street, Fenoulhet Way and Cecil Park', pick: [1004, 2603, 2600, 3713], area: 'victoria' },
      eddington: { name: 'Eddington Lane, Eddington Way and Priory Lane', pick: [1174, 1072, 2468, 4824] },
      parkland: { name: 'the Thanet Way lights, Parkland Road and Flamingo Drive', pick: [2642, 4983, 4886] },
      greenhill: { name: 'Greenhill Road, Herne Drive and Poplar Drive', pick: [2180, 2179, 3406, 1996, 2178, 3398] },
      hampton: { name: 'Sea Street, Western Avenue and Hampton', pick: [4240, 1322, 1317, 2619, 4245] },
      parade: { name: 'the Central Parade zebras', vias: [1721, 4683, 4848], rev: true },
    },
  },
  // avoided at Canterbury: Stanmore Court (a turning circle), Nunnery Fields and Oaten Hill
  // (collisions, and pulling out in front of traffic at the Oaten Hill lights), way 4621741 (Old Dover
  // Road down to the Nackington Road lights: collisions in the queue); left out: Barton and Pilgrims
  // Way, the Ten Perch Road roundabouts, Oxford Road, a way home round the Dover Road roundabout (the
  // careful driver can't go all the way round one)
  canterbury: {
    name: 'Canterbury', start: CT_NW, timeK: 1.0, avoid: ['Upper Chantry Lane', 'Stanmore Court', 'Nunnery Fields', 'Oaten Hill', 4621741], first: [40], last: [1690], pullUpAt: { x: -800, z: 5068 }, bay: false, quick: [1.006, 0.027, 2.394], window: [14.3, 15.7],
    mains: {},
    // the way home: every route ends north-west bound on New Dover Road past 1690 (Ersham Road), so it
    // comes back from the south, never past the centre and round a turning circle
    homes: {
      stLawrence: { name: 'Old Dover Road and St Lawrence Road', vias: [4348, 2127] },
    },
    // area tags keep two loops that share a corridor (so share roads) out of the same route: the
    // Wincheap loops are 'sw', the ring/London ones 'west', the A28 ones 'north'
    loops: {
      ring: { name: 'the ring road: Rhodaus Town and Castle Street', vias: [384, 185], area: 'ring' },
      puckle: { name: 'South Canterbury Road, Puckle Lane, Cromwell Road and Ethelbert Road', pick: [2056, 2034, 4698], area: 'south' },
      thanington: { name: 'Wincheap, Thanington Road and St Nicholas Road', pick: [1300, 4871], area: 'sw' },
      hollowLane: { name: 'Wincheap, Hollow Lane and Homersham', pick: [1886, 1895], area: 'sw' },
      london: { name: 'Rheims Way and London Road', pick: [455, 490, 518], area: 'west' },
      stDunstans: { name: "St Dunstan's, Whitstable Road and Forty Acres Road", pick: [391, 80, 234, 459, 631, 237, 458], area: 'west' },
      hales: { name: "St Stephen's Road and Hales Place", pick: [17, 62, 79, 4768, 190], area: 'hales' },
      sturry: { name: 'the A28 Sturry Road and Vauxhall Road', pick: [295, 277, 498, 4796], area: 'north' },
      northgate: { name: 'Military Road and the three-lane Chaucer and Northgate roundabouts', pick: [204, 2956, 483, 485, 501], area: 'north' },
      stMartins: { name: "Longport, St Martin's Hill and Littlebourne Road", pick: [601, 3049, 2390, 217, 2400, 4191], area: 'east' },
    },
  },
};
export const TEST_CENTRES = Object.fromEntries(Object.entries(POOLS).map(([k, p]) => [k, p.name]));

const MPH = 2.23694;
/** minutes a careful driver takes (limit less 3 mph, slower round bends and rings, plus waits), calibrated on the full mocks */
export function estimateMinutes(route) {
  const pts = route.pts, n = pts.length, v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i]; let w = ((p.park ? 6 : p.road?.limit ?? 30) - 3) / MPH;
    if (p.rb) w = Math.min(w, 20 / MPH);
    if (p.man) w = Math.min(w, 14 / MPH);
    if (i > 1 && i < n - 2) {
      const a = pts[i - 2], b = pts[i + 2], h1 = Math.atan2(p.x - a.x, p.z - a.z), h2 = Math.atan2(b.x - p.x, b.z - p.z);
      let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh;
      const k = dh / Math.max(0.5, b.s - a.s); if (k > 1e-4) w = Math.min(w, Math.max(2.2, Math.sqrt(2.2 / k)));
    }
    v[i] = Math.max(1, w);
  }
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * 1.6 * (pts[i + 1].s - pts[i].s)));
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * 1.5 * (pts[i].s - pts[i - 1].s)));
  let t = 0;
  for (let i = 1; i < n; i++) t += (pts[i].s - pts[i - 1].s) / Math.max(1, (v[i] + v[i - 1]) / 2);
  const ev = route.events, count = (k) => ev.filter((e) => e.kind === k).length;
  t += 9 * count('stop') + 40 * count('pullright') + 35 * count('baypark') + 4 * (count('emerge') + count('cross') + count('rb') + count('mini')) + 8 * count('lights') + 20;
  return (t / 60) * 1.12;
}

/** the reasons a route isn't a fair test (empty = fine) */
export function validateRoute(net, route, { minMin = 14, maxMin = 16, timeK = 1, relaxRb = false } = {}) {
  const bad = [], pts = route.pts, ev = route.events;
  // U-turns: the same road back the way it came, or the path doubling back on itself (not round a ring)
  const ws = route.route.ways;
  for (let i = 1; i < ws.length; i++) if (ws[i].way === ws[i - 1].way && ws[i].dir === -ws[i - 1].dir && !ws[i].way.rb) { bad.push(`U-turn on ${ws[i].way.name || ws[i].way.id}`); break; }
  for (let i = 4; i < pts.length - 4; i++) {
    if (pts[i].rb || pts[i].park || pts[i].man) continue;
    const a = Math.atan2(pts[i].x - pts[i - 4].x, pts[i].z - pts[i - 4].z), b = Math.atan2(pts[i + 4].x - pts[i].x, pts[i + 4].z - pts[i].z);
    let d = Math.abs(a - b); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 2.6) { bad.push(`doubles back at ${Math.round(pts[i].s)} m`); break; }
  }
  // turning round in a cul-de-sac's turning circle: the same reversal, spread over a few car lengths
  if (!bad.length) for (let i = 1, j = 0, k = 0; i < pts.length - 1; i += 2) {
    const p = pts[i];
    while (pts[j].s < p.s - 16) j++;
    while (k < pts.length - 1 && pts[k].s < p.s + 16) k++;
    if (pts.slice(j, k + 1).some((q) => q.rb || q.park || q.man)) continue;
    const a = Math.atan2(p.x - pts[j].x, p.z - pts[j].z), b = Math.atan2(pts[k].x - p.x, pts[k].z - p.z);
    let d = Math.abs(a - b); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 2.6) { bad.push(`turns round at ${Math.round(p.s)} m`); break; }
  }
  // a long run of the same road twice the same way: going round in a circle
  for (let i = 0; i < ws.length && !bad.some((b) => b.startsWith('drives')); i++) for (let j = i + 2; j < ws.length; j++) {
    const a = ws[i], b = ws[j];
    if (a.way !== b.way || a.dir !== b.dir || a.way.rb) continue;
    const lo = Math.max(Math.min(a.s0, a.s1), Math.min(b.s0, b.s1)), hi = Math.min(Math.max(a.s0, a.s1), Math.max(b.s0, b.s1));
    if (hi - lo > 250) { bad.push(`drives ${a.way.name || a.way.ref || a.way.id} twice the same way`); break; }
  }
  // two pull-ups in one place (the second would stop on the angled start's parked car)
  const ups = ev.filter((e) => e.kind === 'stop' || e.kind === 'pullright').map((e) => pts.find((p) => p.s >= e.s) || pts[pts.length - 1]);
  if (ups.some((p, i) => ups.some((q, j) => j > i && Math.hypot(p.x - q.x, p.z - q.z) < 60))) bad.push('two pull-ups in one place');
  // across a roundabout's island
  for (const p of pts) { const rb = p.rb ? net.roundabouts.get(p.rb) : null; if (rb && rb.island && Math.hypot(p.x - rb.x, p.z - rb.z) < rb.island - 0.3) { bad.push(`crosses the island of ${rb.name}`); break; } }
  // Roundabouts "where available" (DT1): Kent has them, so a Kent test needs two with one multi-lane.
  // A centre with no multi-lane ring in reach (West Didsbury) is judged on its lights instead: at
  // least one roundabout or mini, and two signalled junctions.
  const rbs = ev.filter((e) => e.kind === 'rb'), minis = ev.filter((e) => e.kind === 'mini');
  if (relaxRb) {
    if (rbs.length + minis.length < 1) bad.push('no roundabout or mini');
    if (ev.filter((e) => e.kind === 'lights' && !e.crossing).length < 2) bad.push('fewer than two sets of lights');
  } else {
    if (rbs.length < 2) bad.push('fewer than two roundabouts');
    if (!rbs.some((e) => (net.roundabouts.get(e.rb)?.lanes || 1) >= 2)) bad.push('no multi-lane roundabout');
  }
  if (!pts.some((p) => p.road?.dual || p.road?.limit >= 40)) bad.push('no dual carriageway or 40+ road');
  const turns = ev.filter((e) => e.kind === 'turn' || e.kind === 'emerge');
  if (!turns.some((e) => e.dir === 'left')) bad.push('no left turn');
  if (!turns.some((e) => e.dir === 'right')) bad.push('no right turn');
  if (!ev.some((e) => e.kind === 'emerge')) bad.push('no emerging');
  if (!ev.some((e) => e.kind === 'zebra' || e.kind === 'lights')) bad.push('no crossing or lights');
  const mins = estimateMinutes(route) * timeK;
  if (mins < minMin || mins > maxMin) bad.push(`${mins.toFixed(1)} min`);
  return bad;
}

/** the signs a driver passes along a route, for the score sheet ("signs on your route") */
export function signsOnRoute(net, route) {
  const out = new Map(), add = (k, n = 1) => out.set(k, (out.get(k) || 0) + n);
  let lim = null, nsl = null;
  for (const p of route.pts) {
    const r = p.road; if (!r || p.park) continue;
    if (r.nsl && nsl !== true) { add('National speed limit'); nsl = true; lim = null; continue; }
    if (!r.nsl && r.limit !== lim) { if (lim != null || nsl) add(`${r.limit} mph limit`); lim = r.limit; nsl = false; }
  }
  const seen = new Set();
  for (const e of route.events) {
    const node = e.node ? net.nodes.get(e.node) : null;
    if (e.kind === 'rb') add(net.roundabouts.get(e.rb)?.mini ? 'Mini roundabout' : 'Roundabout');
    if (e.kind === 'mini') add('Mini roundabout');
    if (e.kind === 'lights') add(e.crossing ? 'Signal-controlled crossing' : 'Traffic lights');
    if (e.kind === 'zebra') add('Zebra crossing');
    if ((e.kind === 'emerge' || e.kind === 'cross') && node) add(node.stop ? 'STOP sign and line' : 'Give way sign and line');
    if (e.kind === 'merge') add('Slip road: merge');
    if (e.kind === 'diverge') add('Slip road: exit');
    if (e.kind === 'laneChange') add('Lane arrows');
    // a one-way street the other way (no entry) at a junction the route goes through
    if (node && !seen.has(node.id)) { seen.add(node.id); if (node.arms().some((a) => !a.legal)) add('No entry'); }
  }
  if (route.pts.some((p) => p.road?.dual)) add('Dual carriageway');
  const oneways = new Set(route.pts.filter((p) => { const w = net.ways.get(p.way); return w?.oneway && !w.rb && !w.link && !w.dual && (w.lanesF || 1) <= 2 && p.road?.limit <= 30; }).map((p) => p.way));
  if (oneways.size) add('One-way street', oneways.size);
  return [...out.entries()].map(([sign, n]) => ({ sign, n }));
}

/**
 * Following traffic signs (DT1): a destination the direction signs at a run of roundabouts all show
 * for the exit the route takes, with no other turns between them. Returns { target, s0, s1 } or null.
 */
export function signsStretch(net, route, sMin, sMax, home = null) {
  const ev = route.events.filter((e) => e.entryS == null || (e.entryS > sMin && e.entryS < sMax));
  const destAt = (e) => {
    const rb = net.roundabouts.get(e.rb); if (!rb) return [];
    const after = route.pts.find((p) => p.s > e.exitS + 10 && !p.rb); if (!after) return [];
    const a = rb.arms.find((x) => x.exit && (x.exitWays || []).includes(after.way)); if (!a) return [];
    const nid = a.exitNode ?? a.node, node = net.nodes.get(nid), w = net.ways.get(after.way);
    const arm = node?.arms().find((x) => x.way === w && (!w.oneway || x.dir > 0));
    let names = []; if (arm) { try { names = net.destinations(nid, arm, 2); } catch { names = []; } } // the same names the map signs print (signs-place.js exitDest)
    if (!names.length && a.dest) names = [a.dest];
    return names.slice(0, 2);
  };
  let best = null, run = null;
  for (const e of ev) {
    if (e.kind === 'turn' || e.kind === 'emerge' || e.kind === 'mini') { run = null; continue; }
    if (e.kind !== 'rb') continue;
    const names = destAt(e);
    if (run) { const keep = names.filter((n) => run.names.includes(n)); if (keep.length) { run.names = keep; run.list.push(e); } else run = null; }
    if (!run) run = { names, list: [e] };
    // one signed roundabout is enough if the signs carry on past it (a long run to the next junction)
    if (names.length && (!best || run.list.length > best.list.length)) best = { names: run.names.slice(), list: run.list.slice() };
  }
  if (!best) return null;
  const s0 = Math.max(sMin, best.list[0].entryS - 260), s1 = Math.min(sMax, best.list[best.list.length - 1].exitS + 600);
  const target = best.names.find((n) => n !== home) || best.names[0]; // "the signs for Beltinge", not for the town you're already in
  return s1 - s0 > 700 ? { target, s0, s1, rbs: best.list.length } : null;
}


// ---------- putting a route together ----------
const nodeXZ = (net, v) => (typeof v === 'number' ? net.nodes.get(v) : v);
// the bits of a pool that need the map (where each part lies round the centre, the ways to avoid), once per net
const PREP = new WeakMap();
function prepare(net, pool) {
  let byPool = PREP.get(net);
  if (!byPool) PREP.set(net, (byPool = new Map()));
  let p = byPool.get(pool);
  if (p) return p;
  const part = ([key, d]) => {
    const pts = (d.vias || d.pick).map((v) => nodeXZ(net, v)).filter(Boolean);
    const x = pts.reduce((a, q) => a + q.x, 0) / pts.length, z = pts.reduce((a, q) => a + q.z, 0) / pts.length;
    return { key, area: key, ...d, ang: Math.atan2(x - pool.start.x, z - pool.start.z) };
  };
  p = {
    mains: Object.entries(pool.mains || {}).map(part), loops: Object.entries(pool.loops).map(part),
    homes: Object.entries(pool.homes || {}).map(part).map((h) => ({ ...h, at: 'last' })),
    // roads the route must not use: by name (the way ids come from the map), or a way id for an unnamed one
    avoid: (pool.avoid || []).flatMap((nm) => (typeof nm === 'number' ? [nm] : [...net.ways.values()].filter((w) => w.name === nm).map((w) => w.id))),
  };
  byPool.set(pool, p);
  return p;
}
/** a part's vias on this route: its run of road (perhaps the other way round), or junctions picked inside the estate */
function partVias(part, rnd) {
  if (part.pick) { const a = part.pick.slice(), out = []; for (let k = 0; k < (part.n ?? 1) && a.length; k++) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; }
  return part.rev && rnd() < 0.5 ? part.vias.slice().reverse() : part.vias.slice();
}
/**
 * The parts in the order a drive round the centre meets them: by bearing from the centre, starting
 * just after the widest empty sector (so the route sweeps round instead of criss-crossing the town),
 * clockwise or anticlockwise; a part that ends by the centre goes last.
 */
function tourOrder(parts, sense) {
  const free = parts.filter((c) => c.part.at !== 'last').sort((a, b) => a.part.ang - b.part.ang), tail = parts.filter((c) => c.part.at === 'last');
  let cut = 0, gap = -1;
  for (let i = 0; i < free.length; i++) {
    const g = free.length === 1 ? 7 : (free[(i + 1) % free.length].part.ang - free[i].part.ang + 2 * Math.PI) % (2 * Math.PI);
    if (g > gap) { gap = g; cut = (i + 1) % free.length; }
  }
  const ring = [...free.slice(cut), ...free.slice(0, cut)];
  return [...(sense > 0 ? ring : ring.reverse()), ...tail];
}

// the work one test may take (draws, and full lane-path builds): the first phase keeps the seed's own
// big-road part, estate and way home; if that runs out, a fallback draws everything afresh (rarely
// needed, and slower), so a test always turns up
//
// The fallback is deep because a centre with few legal ways round needs it to be. Since the router
// refuses a junction that doubles back (MAX_JUNCTION_TURN in net.js), West Didsbury's legal routes
// are a good deal scarcer: its seeds that find a test at all take 69 to 1139 tries, and at 400 two
// of ten planned nothing. At 1600 it plans nine of ten, against eight before the router refused
// anything. Deepening it cannot change a test that already planned, since the draws come off the
// seed's own generator in a fixed order -- Kent, London and Birmingham never reach the fallback at
// all (their worst seeds take 74, 110 and 91 tries), so for them this is a no-op.
const MAX_TRIES = 120, MAX_BUILDS = 14, FALLBACK_TRIES = 1600, FALLBACK_BUILDS = 160;
// a leg between two parts that would take more than 7 minutes is no use to a 15-minute test (and
// searching the whole map for one that can't be driven is what makes a try slow)
const MAX_LEG = 420;
const QUICK_CAP = { trunk: 70, primary: 50, secondary: 45, tertiary: 35 };
/** a quick guess at the test's minutes from the bare route (pool.quick): the time at each road's limit, and its junctions */
function quickMinutes(r, [a, b, c]) {
  let t = 0;
  for (const w of r.ways) t += Math.abs(w.s1 - w.s0) / (Math.max(10, (w.way.rb ? 18 : Math.min(w.way.limit, QUICK_CAP[w.way.cls] ?? 30)) - 3) * 0.44704);
  return a * t / 60 + b * r.nodes.length + c;
}
/** what the bare route already shows it lacks (validateRoute checks it all again on the lane path) */
function bareMissing(net, r, relaxRb = false) {
  const rbs = new Set(r.ways.filter((w) => w.way.rb).map((w) => w.way.rb)), out = [];
  if (relaxRb) {
    const minis = r.nodes.filter((n) => net.nodes.get(n)?.mini).length;
    if (rbs.size + minis < 1) out.push('no roundabout or mini');
    if (r.nodes.filter((n) => net.nodes.get(n)?.signals).length < 2) out.push('fewer than two sets of lights');
  } else {
    if (rbs.size < 2) out.push('fewer than two roundabouts');
    if (![...rbs].some((id) => (net.roundabouts.get(id)?.lanes || 1) >= 2)) out.push('no multi-lane roundabout');
  }
  if (!r.ways.some((w) => w.way.dual || w.way.limit >= 40)) out.push('no dual carriageway or 40+ road');
  const LIT = /zebra|pelican|puffin|toucan|signals/;
  if (!r.nodes.some((n) => net.nodes.get(n)?.signals) && !r.ways.some((w) => (net.crossingsByWay.get(w.way.id) || []).some((c) => LIT.test(c.type) && c.s >= Math.min(w.s0, w.s1) && c.s <= Math.max(w.s0, w.s1)))) out.push('no crossing or lights');
  return out;
}

/**
 * A test from a centre and a seed: { spec, route, meta } or throws if no fair route turns up
 * (in practice one always does). meta: { seed, centre, stretches, manoeuvre, indep, minutes }.
 * Every choice comes from the seed, so the same seed always gives the same route.
 * opts: minMin / maxMin (the estimate's window, default pool.window), signsRate, and
 * log(attempt, parts, why, minutes, route, quickMinutes) to watch the tries (lesson-check --genwhy).
 *
 * The seed picks the big-road part, the way home and one estate first, evenly, and the tries that
 * follow keep them while they reshuffle the other estates, the junctions picked and the way round;
 * only when those run out does a try draw them afresh. So each big-road part and each estate turns
 * up about as often as any other, rather than the easiest to fit winning most tests.
 */
export function generateTest(net, centreKey, seed, opts = {}) {
  // a POOLS key (Kent, hand-authored) or a pool object from auto-pool.js (any centre, read off the map)
  const pool = typeof centreKey === 'string' ? POOLS[centreKey] : centreKey;
  if (!pool) throw new Error(`no test centre ${centreKey}`);
  if (typeof centreKey !== 'string') centreKey = pool.key || 'auto';
  const rnd = seeded(seed * 7919 + 17);
  const layout = testCentreLayout(net, pool.tc || centreOf(net, centreKey)), lot = !!layout.lot;
  const P = prepare(net, pool);
  const pickOne = (a) => a[Math.floor(rnd() * a.length)];
  const roadMains = P.mains.filter((m) => m.kind !== 'ring'), ringMains = P.mains.filter((m) => m.kind === 'ring');
  const mainPool = roadMains.length ? roadMains : P.mains;
  const main0 = mainPool.length ? pickOne(mainPool) : null, anchor0 = pickOne(P.loops), home0 = P.homes.length ? pickOne(P.homes) : null;
  const ring0 = ringMains.length ? pickOne(ringMains) : null;
  // within the 14-16 minute window, the part the pool aims for (pool.window): the careful driver's
  // simulated time scatters a minute or so either side of the estimate, a manual a little slower
  const minMin = opts.minMin ?? pool.window[0], maxMin = opts.maxMin ?? pool.window[1];
  const pad = 0.3; // a quick guess this close to the window is worth building
  // lean: one estate more or fewer than the draw says, after bare routes that came out too short or too long
  let last = null, builds = 0, lean = 0;
  const legs = new Map(); // the bare route's legs, via to via, shared by the tries (and the builds)
  let fallback = false;
  for (let attempt = 0; attempt < FALLBACK_TRIES && builds < FALLBACK_BUILDS; attempt++) {
    if (!fallback && (attempt >= MAX_TRIES || builds >= MAX_BUILDS)) fallback = true;
    const keep = (share) => !fallback && attempt < MAX_TRIES * share;
    const main = !main0 ? null : keep(0.6) ? main0 : pickOne(mainPool);
    // the ring part on about half the routes, and on every fallback try: a centre whose estates have
    // no multi-lane roundabout of their own can only meet one this way
    const ring = !ring0 ? null : fallback || rnd() < 0.5 ? (keep(0.6) ? ring0 : pickOne(ringMains)) : null;
    const anchor = keep(0.3) ? anchor0 : pickOne(P.loops);
    const home = !home0 ? null : keep(0.6) ? home0 : pickOne(P.homes);
    // one to four estates in all, no two from the same area (they'd share their streets)
    const u = rnd(), k = Math.max(1, Math.min(4, (u < 0.25 ? 1 : u < 0.65 ? 2 : u < 0.9 ? 3 : 4) + lean));
    const chosen = [anchor], queue = P.loops.filter((l) => l.area !== anchor.area);
    while (chosen.length < k && queue.length) { const part = queue.splice(Math.floor(rnd() * queue.length), 1)[0]; if (!chosen.some((c) => c.area === part.area)) chosen.push(part); }
    const sense = rnd() < 0.5 ? 1 : -1;
    const man = pool.bay && lot && rnd() < 0.5 ? 'baypark' : 'pullright';
    const stops = rnd() < 0.5 ? 2 : 1;
    const parts = tourOrder([...(main ? [main] : []), ...(ring && ring !== main ? [ring] : []), ...chosen, ...(home ? [home] : [])].map((part) => ({ part, vias: partVias(part, rnd) })), sense);
    const used = parts.map((c) => c.part.key);
    const vias = [...pool.first, ...parts.flatMap((c) => c.vias), ...(pool.last || [])].filter((v, i, a) => v !== a[i - 1]);
    const spec = { centre: centreKey, start: pool.start, vias, stops, angled: true, noUturn: true, avoid: P.avoid, ...(man === 'baypark' ? { end: 'baypark', bayFrom: 38 } : { to: pool.pullUpAt, pullRight: true }) };
    // cheap first: a quick guess at the minutes says too short or too long before the lane path is built
    // (ending where buildKentRoute will: short of the car park entrance for the bay park)
    const end = spec.to || layout.at(spec.bayFrom, layout.roadDist - 17.5);
    let r0 = null;
    try { r0 = net.route({ x: spec.start.x, z: spec.start.z, maxD: 30 }, end, { via: vias, noUturn: true, avoid: P.avoid, legs, maxLeg: MAX_LEG }); } catch { r0 = null; }
    const quick = r0 ? quickMinutes(r0, pool.quick) * pool.timeK : null;
    let bad = [], route = null, mins = quick ?? 0;
    if (!r0) bad = ['no route'];
    else if ((bad = bareMissing(net, r0, !!pool.relaxRb)).length) { /* missing a roundabout, the lights or a fast road */ }
    else if (mins < minMin - pad || mins > maxMin + pad) { bad = [`about ${mins.toFixed(1)} min`]; lean = Math.max(-2, Math.min(2, lean + (mins < minMin ? 1 : -1))); }
    else {
      builds++;
      try { route = buildKentRoute(net, { ...spec, id: 'test15' }, { rnd: seeded(seed), legs }); } catch (err) { bad = [String(err.message || err)]; }
      if (route) {
        bad = validateRoute(net, route, { timeK: pool.timeK, ...opts, minMin, maxMin, relaxRb: !!pool.relaxRb });
        if (!route.events.some((e) => e.kind === 'stop')) bad.push('no pull-up');
        // pulling up on the right is for a quiet road, not an A road
        const pr = route.events.find((e) => e.kind === 'pullright'), prWay = pr && net.ways.get(route.pts[idxAtS(route.pts, pr.s)].way);
        if (prWay && (prWay.cls === 'primary' || prWay.cls === 'trunk')) bad.push(`pull up on the right on ${prWay.name || prWay.ref}`);
        mins = estimateMinutes(route) * pool.timeK;
      }
    }
    opts.log?.(attempt, used, bad, mins, route || { length: 0, events: [] }, quick);
    if (!route || bad.length) { last = bad.join(', '); continue; }
    // independent driving from the first pull-up to about four-fifths of the way: signs one test in five (where they exist), else the sat nav
    const firstStop = route.events.find((e) => e.kind === 'stop');
    const s0 = firstStop.s + 5, s1 = Math.max(s0 + 1500, route.length * 0.8);
    // DVSA uses traffic signs on roughly one test in five; where the route has no signed stretch, the sat nav
    const signs = rnd() < (opts.signsRate ?? 0.3) ? signsStretch(net, route, s0, s1, pool.name) : null;
    const indep = signs ? { mode: 'signs', target: signs.target, s0, s1: signs.s1 } : { mode: 'satnav', s0, s1 };
    return { spec, route, meta: { seed, centre: centreKey, centreName: pool.name, world: pool.world || 'kent', stretches: parts.map((c) => c.part.name), manoeuvre: man, stops, indep, minutes: +mins.toFixed(1), attempts: attempt + 1, length: Math.round(route.length) } };
  }
  throw new Error(`no fair test route from ${pool.name} for seed ${seed} (last: ${last})`);
}
