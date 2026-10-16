// The 15-minute driving test: a different route every time from either test centre, built from a
// seed (stored with the result, so "retry this route" drives exactly the same one). A route strings
// together named stretches of real road (the pool below: every via is a graph node the full-length
// mocks already prove), with some stretches and some vias dropped at random, then net.route and
// lane-path it through buildKentRoute. A route is kept only if it is a fair test: no U-turns or
// cuts across a roundabout island, two roundabouts or more (one multi-lane), a dual carriageway or
// 40+ road, left and right turns, emerging, a crossing or lights, and about 15 minutes of driving.
// Pure maths and data (no scene), so node can run it (tools/lesson-check.mjs --gen).
//
// The test follows DVSA's examiner guidance (DT1, section 14 "Test wordings",
// https://www.gov.uk/guidance/guidance-for-driving-examiners-carrying-out-driving-tests-dt1/14-test-wordings):
// independent driving is briefed with the car pulled up on the left, by sat nav or by following
// traffic signs (roughly one test in five), one manoeuvre, a normal stop and an angled start, and
// sometimes an emergency stop.
import { buildKentRoute, testCentreLayout, centreOf } from './lesson-routes.js';

/** a small seeded random number generator (mulberry32): the same seed, the same test */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const HB_EAST = { x: 3335, z: -4743.2 }, CT_NW = { x: -815, z: 5060 };
// timeK: the estimate against the careful driver's simulated minutes (the full Canterbury mock's
// ring-road traffic needed more than its estimate; these shorter routes match it). Named stretches. `opt` stretches can be left out; vias inside a stretch (not its ends) can be dropped.
const POOLS = {
  herne: {
    name: 'Herne Bay', start: HB_EAST, timeK: 0.97, first: [{ x: 3300, z: -4746 }], pullUpAt: { x: 3420, z: -4743.5 }, bay: true,
    stretches: {
      reculver: { name: 'Reculver Road and Beltinge', vias: [4495, 1089, 947] },
      parade: { name: 'the Central Parade zebras', vias: [1721, 4683, 4848] },
      town: { name: "the 20 mph town streets (Dolphin Street, Beach Street, King's Road, Station Road)", vias: [2453, 2713, 1177, 1000, 997, 1085, 1179] },
      grid: { name: 'Brunswick Square and the town grid', vias: [996, 997, 1000, 1274, 2612, 2613, 1179] },
      sea: { name: 'the Sea Street lights and roundabout', vias: [4230, 4224, 3300] },
      greenhill: { name: 'the Greenhill roundabout and the A2990', vias: [4218, 4216, 128] },
      a299: { name: 'Eddington Junction and the A299 at 70', vias: [466, 469, 1723] },
      altira: { name: 'Altira and the Margate Road roundabouts', vias: [4403, 121] },
      eddington: { name: 'the Eddington Junction roundabouts to Greenhill', vias: [4066, 4214, 4217] },
      seaBack: { name: 'Greenhill Bridge Road and the Sea Street roundabout', vias: [3300, 4224] },
      a299short: { name: 'Eddington Junction and the A299 at 70', vias: [121, 466, 469, 1723] },
      altiraOnly: { name: 'the Altira roundabout on Margate Road', vias: [4403] },
      queens: { name: "Queen's Roundabout", vias: [5119] },
      // the side streets round the centre: turns, emerging, give-way lines
      // (pick: one or two of these junctions, in any order: the router finds its own way through the streets)
      cornwallis: { name: 'Cornwallis Avenue', pick: [2120, 2118, 2116, 2123] },
      grange: { name: 'Maritime Avenue and Grange Road', pick: [2108, 2559, 2556, 2555, 1382, 2557, 2107] },
      thundersland: { name: 'Thundersland Road and Elizabeth Way', pick: [1373, 1362, 1366, 1367, 1365] },
      talmead: { name: 'Talmead Road', pick: [3482, 4410, 4415, 4416] },
      kingedward: { name: 'King Edward Avenue and Landon Road', pick: [1881, 2573, 1880, 2555] },
      beltinge: { name: 'Reculver Road and the Beltinge lights', vias: [1089, 947] },
    },
    // orders that make geographic sense (each is a real drive the lesson routes already make, or its parts)
    templates: [
      [['reculver'], ['parade', 'opt'], ['sea'], ['greenhill'], ['a299']],
      [['reculver'], ['queens'], ['kingedward', 'opt'], ['thundersland', 'opt'], ['altiraOnly'], ['a299short']],
      [['reculver'], ['queens'], ['grange', 'opt'], ['talmead', 'opt'], ['altiraOnly'], ['a299short']],
      [['grange'], ['beltinge'], ['queens'], ['thundersland', 'opt'], ['altiraOnly'], ['a299short']],
      [['cornwallis'], ['beltinge'], ['queens'], ['talmead', 'opt'], ['altiraOnly'], ['a299short']],
      [['reculver'], ['grid', 'opt'], ['queens'], ['altiraOnly'], ['a299short']],
      [['sea'], ['greenhill'], ['a299']],
      [['altira'], ['eddington'], ['seaBack'], ['greenhill'], ['a299']],
      [['beltinge'], ['queens'], ['kingedward', 'opt'], ['altiraOnly'], ['a299short']],
      [['queens'], ['parade', 'opt'], ['sea'], ['greenhill'], ['a299']],
    ],
  },
  canterbury: {
    name: 'Canterbury', start: CT_NW, timeK: 1.0, avoid: ['Upper Chantry Lane'], first: [], pullUpAt: { x: -800, z: 5068 }, bay: false,
    stretches: {
      stgeorges: { name: "St George's Place and St George's Roundabout", vias: [41, 209] },
      ring: { name: 'the ring road: Rhodaus Town and Castle Street', vias: [384, 185] },
      rheims: { name: 'Rheims Way and the London Road roundabout', vias: [502, 453] },
      stpeters: { name: "St Peter's Place", vias: [3572] },
      kingsmead: { name: 'Kingsmead and the Northgate roundabout', vias: [100] },
      sturry: { name: 'the A28 Sturry Road dual carriageway', vias: [223, { x: -177, z: 3440 }, 224] },
      northgate: { name: 'the three-lane Northgate and Chaucer roundabouts', vias: [99, 96, 198] },
      newdover: { name: "St George's Roundabout and New Dover Road", vias: [42, 4289, 4290] },
      // the side streets home (off the ring road at Upper Bridge Street, not through the St George's Place
      // signal complex, where turning across the lights tangles with traffic): Dover Street, Oaten Hill,
      // Old Dover Road, then out of Ersham Road onto New Dover Road
      homeLoop: { name: 'Dover Street, Oaten Hill, Old Dover Road and Ersham Road', vias: [4279, 726, 460, 734, 1690], keep: true },
      homeNunnery: { name: 'Dover Street, Nunnery Fields and Old Dover Road', vias: [4279, 726, 460, 736, 2045, 1690], keep: true },
      ringBack: { name: "the ring road back: Castle Street and Rhodaus Town", vias: [185, 384] },
    },
    templates: [
      [['stgeorges'], ['ring'], ['stpeters', 'opt'], ['ringBack'], ['homeLoop']],
      [['stgeorges'], ['ring'], ['rheims', 'opt'], ['ringBack'], ['homeNunnery']],
      [['stgeorges'], ['ring'], ['kingsmead'], ['northgate'], ['homeLoop']],
      [['stgeorges'], ['ring'], ['stpeters'], ['kingsmead'], ['northgate'], ['homeLoop']],
      [['stgeorges'], ['ring'], ['rheims', 'opt'], ['ringBack'], ['homeLoop']],
    ],
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
export function validateRoute(net, route, { minMin = 14, maxMin = 16, timeK = 1 } = {}) {
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
  // across a roundabout's island
  for (const p of pts) { const rb = p.rb ? net.roundabouts.get(p.rb) : null; if (rb && rb.island && Math.hypot(p.x - rb.x, p.z - rb.z) < rb.island - 0.3) { bad.push(`crosses the island of ${rb.name}`); break; } }
  const rbs = ev.filter((e) => e.kind === 'rb');
  if (rbs.length < 2) bad.push('fewer than two roundabouts');
  if (!rbs.some((e) => (net.roundabouts.get(e.rb)?.lanes || 1) >= 2)) bad.push('no multi-lane roundabout');
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

/**
 * A test from a centre and a seed: { spec, route, meta } or throws if no fair route turns up
 * (in practice one does within a few tries). meta: { seed, centre, stretches, manoeuvre, indep, minutes }.
 */
export function generateTest(net, centreKey, seed, opts = {}) {
  const pool = POOLS[centreKey]; if (!pool) throw new Error(`no test centre ${centreKey}`);
  const rnd = seeded(seed * 7919 + 17);
  const lot = !!testCentreLayout(net, centreOf(net, centreKey)).lot;
  let last = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const tpl = pool.templates[Math.floor(rnd() * pool.templates.length)];
    const used = [], picked = [];
    for (const [key, opt] of tpl) {
      if (opt && rnd() < 0.5) continue;
      const st = pool.stretches[key];
      if (st.pick) { const a = st.pick.slice(), n = rnd() < 0.5 ? 2 : 1; for (let k = 0; k < n && a.length; k++) picked.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); }
      else picked.push(...st.vias.filter((x, i) => st.keep || i === 0 || i === st.vias.length - 1 || rnd() > 0.35));
      used.push(key);
    }
    const vias = [...pool.first, ...picked];
    const man = pool.bay && lot && rnd() < 0.5 ? 'baypark' : 'pullright';
    const stops = rnd() < 0.5 ? 2 : 1;
    // roads the route must not use (named: the way ids come from the map)
    const avoid = (pool.avoid || []).flatMap((nm) => [...net.ways.values()].filter((w) => w.name === nm).map((w) => w.id));
    const spec = { centre: centreKey, start: pool.start, vias, stops, angled: true, noUturn: true, avoid, ...(man === 'baypark' ? { end: 'baypark', bayFrom: 38 } : { to: pool.pullUpAt, pullRight: true }) };
    let route;
    try { route = buildKentRoute(net, { ...spec, id: 'test15' }, { rnd: seeded(seed) }); } catch (err) { last = String(err.message || err); opts.log?.(attempt, used, [last], 0, { length: 0, events: [] }); continue; }
    const bad = validateRoute(net, route, { timeK: pool.timeK, ...opts });
    if (!route.events.some((e) => e.kind === 'stop')) bad.push('no pull-up');
    opts.log?.(attempt, used, bad, estimateMinutes(route) * pool.timeK, route);
    if (bad.length) { last = bad.join(', '); continue; }
    // independent driving from the first pull-up to about four-fifths of the way: signs one test in five (where they exist), else the sat nav
    const firstStop = route.events.find((e) => e.kind === 'stop');
    const s0 = firstStop.s + 5, s1 = Math.max(s0 + 1500, route.length * 0.8);
    // DVSA uses traffic signs on roughly one test in five; where the route has no signed stretch, the sat nav
    const signs = rnd() < (opts.signsRate ?? 0.3) ? signsStretch(net, route, s0, s1, pool.name) : null;
    const indep = signs ? { mode: 'signs', target: signs.target, s0, s1: signs.s1 } : { mode: 'satnav', s0, s1 };
    const minutes = estimateMinutes(route) * pool.timeK;
    return { spec, route, meta: { seed, centre: centreKey, centreName: pool.name, stretches: used.map((k) => pool.stretches[k].name), manoeuvre: man, stops, indep, minutes: +minutes.toFixed(1), attempts: attempt + 1, length: Math.round(route.length) } };
  }
  throw new Error(`no fair test route from ${pool.name} for seed ${seed} (last: ${last})`);
}
