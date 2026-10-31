// The Kent road network as pure data: lookups, routing, lane-centre paths and the events along
// them. No three.js here so node can test it (tools/net-check.mjs) and the data tool can reuse it.
//
// Conventions (DESIGN.md section 0): metres, x east, z south, left-hand traffic. A way's points
// run in its travel direction for one-way ways. Lane k >= 1 is counted from the nearside (left)
// edge; negative k means the opposite direction's lanes on a two-way way. leftOf((dx,dz)) = (dz,-dx).
// Ring sense: +1 means the position angle atan2(z - cz, x - cx) grows while circulating, which is
// clockwise seen from above (north up) and what UK left-hand traffic does; -1 would be the opposite.

export const LANE_OFF = 1.85; // lane centre offset from the centreline on a 7.3 m two-way road
export const LW = 3.65; // lane width on one-way carriageways
const DEG = 180 / Math.PI;
const RANK = { trunk: 8, trunk_link: 7, primary: 7, primary_link: 6, secondary: 6, secondary_link: 5, tertiary: 5, unclassified: 4, residential: 3, living_street: 2, service: 1 };
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const CRUISE = { trunk: 70, trunk_link: 50, primary: 50, primary_link: 40, secondary: 45, secondary_link: 40, tertiary: 35, unclassified: 28, residential: 22, living_street: 10, service: 10 }; // mph

const leftOf = (dx, dz) => [dz, -dx];
const norm180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
/** bearing in degrees, 0 = north (-z), clockwise, of the vector (dx, dz) */
const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * DEG) % 360 + 360) % 360;
const hypot = Math.hypot;
const nz = (v) => (Math.abs(v) < 1e-9 ? 0 : v);

// ---------- a uniform grid over items with bounding boxes (ways, buildings, colliders) ----------
export class GridIndex {
  constructor(cell = 100) { this.cell = cell; this.cells = new Map(); }
  key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  insert(minX, minZ, maxX, maxZ, item) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c), z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz); let a = this.cells.get(k); if (!a) this.cells.set(k, (a = [])); a.push(item);
    }
  }
  /** items whose box touches the query box (deduped) */
  query(minX, minZ, maxX, maxZ) {
    const c = this.cell, out = [], seen = new Set();
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c), z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.cells.get(this.key(ix, iz)); if (!a) continue;
      for (const it of a) if (!seen.has(it)) { seen.add(it); out.push(it); }
    }
    return out;
  }
  near(x, z, r) { return this.query(x - r, z - r, x + r, z + r); }
  /** cells at Chebyshev ring distance k around (x,z); k = 0 is the cell itself */
  ring(x, z, k, cb) {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let ix = cx - k; ix <= cx + k; ix++) for (let iz = cz - k; iz <= cz + k; iz++) {
      if (k > 0 && Math.abs(ix - cx) !== k && Math.abs(iz - cz) !== k) continue;
      const a = this.cells.get(this.key(ix, iz)); if (a) cb(a);
    }
  }
}

// ---------- tiny binary heap for Dijkstra ----------
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(cost, item) {
    const a = this.a; a.push([cost, item]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

/** nearest point on segment a-b to p: returns [t, px, pz] */
function projSeg(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [t, ax + dx * t, az + dz * t];
}

/** do segments a-b and c-d properly cross (strict straddle; shared endpoints do NOT count)? */
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => (rz - pz) * (qx - px) - (rx - px) * (qz - pz);
  const d1 = o(ax, az, bx, bz, cx, cz), d2 = o(ax, az, bx, bz, dx, dz);
  const d3 = o(cx, cz, dx, dz, ax, az), d4 = o(cx, cz, dx, dz, bx, bz);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

export class RoadNet {
  constructor(data) {
    this.data = data;
    this.bounds = data.bounds; this.origin = data.origin;
    this.places = data.places || []; this.landmarks = data.landmarks || [];
    this.home = data.home; this.airfield = data.airfield; this.testCentres = data.testCentres || [];
    this.ways = new Map(); this.nodes = new Map(); this.roundabouts = new Map();
    this.grid = new GridIndex(100);
    this.crossingsByWay = new Map();
    this.calmingByWay = new Map();
    this.#buildWays(); this.#buildNodes(); this.#widenThinDuals(); this.#buildMedians(); this.#buildRoundabouts(); this.#buildLinks(); this.#buildExtras(); this.#dressWays();
  }

  // ---------- construction ----------
  #buildWays() {
    for (const w of this.data.ways) {
      const n = w.pts.length, cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]);
      // give the tightest two-way streets a little more room: a learner kept drifting over the centre
      // line when turning. Aim for a comfortable ~3.4 m lane, but never widen a street by over 2.5 m
      // (pavements and procedural houses are drawn from halfW, so they move out with it).
      let width = w.width;
      if (!w.rb && !w.link) {
        if (!w.oneway && (RANK[w.cls] ?? 3) <= 4 && w.cls !== 'service') width = Math.min(w.width + 2.5, Math.max(w.width, 7));
        // closes, mews and yards bake at 5 m, which is under two car widths once the hedges go up
        else if (!w.oneway) width = Math.max(w.width, 6);
        // a one-way street is baked one lane wide. A dual carriageway keeps what it has: its two
        // halves sit about 6 m apart, so widening them would swallow the central reservation.
        else if (!w.dual) width = Math.min(w.width + 1.3, Math.max(w.width, 5));
      }
      const way = Object.assign({}, w, { cum, len: cum[n - 1], width, halfW: width / 2 });
      way.limit = w.limit || (w.pave ? 30 : 60);
      way.rank = RANK[w.cls] ?? 3;
      // OSM almost never gives a service road a maxspeed, and the fallback then hands every mews,
      // close and farm access the national speed limit. Nothing named Orchard Close is a 60 road,
      // and an examiner marking a learner for dawdling down one at 20 is worse than merely wrong.
      // Service roads that carry a real tag (5, 10, 20, 30 mph) keep it.
      if (w.cls === 'service' && way.nsl) { way.limit = 30; way.nsl = false; }
      this.ways.set(w.id, way);
      for (let i = 0; i < n - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        this.grid.insert(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { way, i });
      }
    }
  }
  #buildNodes() {
    for (const [id, nd] of Object.entries(this.data.nodes)) {
      this.nodes.set(+id, { id: +id, x: nd.x, z: nd.z, ways: [], signals: !!nd.signals, crossing: nd.crossing || null, giveWay: !!nd.giveWay, stop: !!nd.stop, mini: !!nd.mini, levelCrossing: !!nd.levelCrossing, edge: !!nd.edge, rb: null, kind: 'via' });
    }
    for (const way of this.ways.values()) {
      const last = way.nodes.length - 1;
      way.nodes.forEach((nid, idx) => {
        if (!nid) return; const node = this.nodes.get(nid); if (!node) return;
        node.ways.push({ way, idx, end: idx === 0 ? 'a' : idx === last ? 'b' : null });
        if (way.rb) node.rb = way.rb;
      });
    }
    const net = this;
    for (const node of this.nodes.values()) {
      const ends = node.ways.filter((r) => r.end).length;
      node.kind = node.ways.length >= 2 ? 'junction' : ends ? 'end' : 'via';
      // arms: ways leading away from the node, with the bearing of their first 15 m and whether a car may use them
      node.arms = function () {
        const out = [];
        for (const { way, idx } of this.ways) {
          if (idx > 0) out.push({ way, dir: -1, idx, bearing: net.#armBearing(way, idx, -1), legal: !way.oneway });
          if (idx < way.pts.length - 1) out.push({ way, dir: 1, idx, bearing: net.#armBearing(way, idx, 1), legal: true });
        }
        return out;
      };
    }
  }
  /**
   * OSM leaves `lanes` off most dual carriageway halves, and the fetch then assumes one lane purely
   * because the way is one-way (osm-fetch.mjs, lanes_src 'oneway'). That draws an A-road as a single
   * 3.65 m ribbon: an A-road you drive like a cycle lane. A trunk, primary or secondary road split
   * into halves is a major road whatever its limit, so give it two lanes wherever there is physically
   * room for the wider ribbon. Measured per way, so where the two halves close up at the end of a
   * dual section the lane simply drops, which is what the real road does.
   */
  #widenThinDuals() {
    const LANES = 2, NEED = (LANES * LW) / 2 + 1.0; // new half width, plus a margin to the next ribbon
    for (const w of this.ways.values()) {
      if (!w.oneway || !w.dual || w.rb || w.link || w.lanesF !== 1 || w.rank < 6 || w.limit < 30) continue;
      // anything meeting this way at a node may touch it; everything else has to stay clear
      const skip = new Set([w.id]);
      for (const nid of w.nodes) { const nd = nid && this.nodes.get(nid); if (nd) for (const r of nd.ways) skip.add(r.way.id); }
      let clear = Infinity;
      for (let i = 0; i < w.pts.length - 1 && clear >= NEED; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        const steps = Math.max(1, Math.ceil(hypot(b[0] - a[0], b[1] - a[1]) / 5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          clear = Math.min(clear, this.#clearanceAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, w, skip));
        }
      }
      if (clear < NEED) continue;
      w.lanesF = LANES; w.width = LANES * LW; w.halfW = w.width / 2;
    }
  }
  /**
   * Where a dual carriageway's two halves run within a few metres of each other there is no
   * reservation, just bare tarmac between the two offside edge lines, which reads as a wide road
   * with stray stripes down it. That strip is a painted median (1040) in reality, so measure its
   * width along the way and let the renderer hatch it. Only the lower-id way of the pair carries
   * the strip, so it gets drawn once. A gap over MAX is a kerbed or grassed reservation: left alone.
   */
  #buildMedians() {
    const MIN = 0.8, MAX = 3.2, STEP = 3, ENDS = 12;
    for (const w of this.ways.values()) {
      if (!w.oneway || !w.dual || w.rb || w.link || w.len < 2 * ENDS) continue;
      const ss = [], ws = [];
      let live = 0, tested = 0;
      for (let s = 0; ; s = Math.min(s + STEP, w.len)) {
        // the two halves run together at the ends of a dual section, so judge the middle only
        const end = s < ENDS || s > w.len - ENDS;
        const hit = end ? null : this.#medianAt(w, s);
        const ok = !!hit && hit.gap >= MIN && hit.gap <= MAX && w.id < hit.other.id;
        ss.push(s); ws.push(ok ? hit.gap : 0);
        if (!end) { tested++; if (ok) live++; }
        if (s >= w.len) break;
      }
      // the strip has to be narrow for most of the way to be a painted median at all. A proper
      // reservation that briefly pinches at a junction is still grass and a barrier, not paint.
      if (tested && live >= tested * 0.7) w.median = { s: ss, w: ws };
    }
  }
  /**
   * The opposing carriageway's gap at arc length s. The partner is the nearest dual way running the
   * other way on the driver's right. Ways that share a junction node are NOT excluded here: the two
   * halves of a dual carriageway meet at the junctions at each end, so excluding them would hide the
   * very way we are looking for.
   */
  #medianAt(w, s) {
    const p = this.pointAt(w, s), d = this.dirAt(w, s), l = leftOf(d[0], d[1]);
    const nx = -l[0], nz = -l[1];
    let best = null;
    for (let k = 0; k <= 2; k++) {
      this.grid.ring(p[0], p[1], k, (items) => {
        for (const { way: o, i } of items) {
          if (o === w || !o.oneway || !o.dual || o.rb || o.link || (o.layer || 0) !== (w.layer || 0)) continue;
          const a = o.pts[i], b = o.pts[i + 1];
          const L = hypot(b[0] - a[0], b[1] - a[1]) || 1;
          if ((d[0] * (b[0] - a[0]) + d[1] * (b[1] - a[1])) / L > -0.7) continue; // must run the other way
          const [, px, pz] = projSeg(a[0], a[1], b[0], b[1], p[0], p[1]);
          if ((px - p[0]) * nx + (pz - p[1]) * nz <= 0) continue; // and lie on the median side
          const gap = hypot(px - p[0], pz - p[1]) - w.halfW - o.halfW;
          if (!best || gap < best.gap) best = { gap, other: o };
        }
      });
    }
    return best;
  }
  /**
   * Which streets scenery.js dresses (trees, lamps with baskets, bays and railings, shop awnings).
   * The authored city tags its own ways; the real-map cities get the tags by rule, from where a
   * street sits in its town: the through roads of a town centre are a high street, the residential
   * streets near the centre are terraces, those further out are suburban. The radii are deliberate:
   * dressing roughly doubles a street's draw calls, so it stops where a town's heart does.
   */
  #dressWays() {
    const towns = this.placesIn.filter((p) => (p.rank ?? 2) <= 1 && p.r > 0);
    if (!towns.length) return;
    for (const way of this.ways.values()) {
      if (way.dress || !way.pave || way.rb || way.link || way.dual || way.len < 20) continue;
      const m = this.pointAt(way, way.len / 2);
      let town = null, d = Infinity;
      for (const t of towns) { const k = hypot(m[0] - t.x, m[1] - t.z); if (k < t.r && k < d) { town = t; d = k; } }
      if (!town) continue;
      const highStreet = /\bHigh Street\b/.test(way.name || '');
      if (!way.oneway && (way.rank >= 5 || highStreet) && (d < 350 || highStreet)) way.dress = 'high-street';
      else if (way.cls === 'residential' && d < 800) way.dress = 'terraced';
      else if (way.cls === 'residential' && d < 1800) way.dress = 'suburban';
    }
  }
  /** how much room is left at (x, z) before the nearest other carriageway's edge, on this way's layer */
  #clearanceAt(x, z, w, skip) {
    let best = Infinity;
    const layer = w.layer || 0;
    for (let k = 0, rings = Math.ceil(20 / this.grid.cell) + 1; k <= rings; k++) {
      this.grid.ring(x, z, k, (items) => {
        for (const { way: o, i } of items) {
          if (skip.has(o.id) || (o.layer || 0) !== layer) continue;
          const a = o.pts[i], b = o.pts[i + 1];
          const [, px, pz] = projSeg(a[0], a[1], b[0], b[1], x, z);
          best = Math.min(best, hypot(x - px, z - pz) - o.halfW);
        }
      });
    }
    return best;
  }
  /** bearing from pt idx of a way towards the point about 15 m further along in direction dir */
  #armBearing(way, idx, dir) {
    const s0 = way.cum[idx], s = Math.max(0, Math.min(way.len, s0 + dir * 15));
    const p = this.pointAt(way, s), q = way.pts[idx];
    if (Math.abs(s - s0) < 0.5) { const j = idx + dir; return bearingOf(way.pts[j][0] - q[0], way.pts[j][1] - q[1]); }
    return bearingOf(p[0] - q[0], p[1] - q[1]);
  }
  #buildRoundabouts() {
    // comfortable circulating width: the baked islands leave only ~3.6 m on single-lane rings, too
    // tight to steer round without clipping a kerb, so shrink the island to open the carriageway up
    const MIN_RING = 5.5;
    for (const r of this.data.roundabouts || []) {
      const rb = Object.assign({}, r);
      rb.arms = r.arms.map((a) => Object.assign({}, a)).sort((a, b) => a.bearing - b.bearing);
      // the arm lane counts were baked from the old one-lane duals, so an approach widened above
      // would run two lanes into a one-lane entry line. Take whichever is wider.
      const lanesOf = (ids) => (ids || []).reduce((m, id) => Math.max(m, this.ways.get(id)?.lanesF || 1), 1);
      for (const a of rb.arms) {
        a.entryLanes = Math.max(a.entryLanes || 1, lanesOf(a.entryWays));
        a.exitLanes = Math.max(a.exitLanes || 1, lanesOf(a.exitWays));
      }
      // An untagged ring has exactly as many lanes as its widest approach, decided HERE because the
      // dual-carriageway widening above is what makes some approaches two lanes. (The bake applies
      // the same rule to what it can see; a small ring, r < 10, stays one lane whatever feeds it.)
      let lanes = Math.max(1, r.lanes || 1);
      if (r.lanesSrc !== 'tag') {
        const widest = Math.max(1, ...rb.arms.filter((a) => a.entry).map((a) => a.entryLanes || 1));
        const want = r.r < 10 ? 1 : Math.min(3, widest);
        if (want !== lanes) {
          lanes = want; rb.lanes = want;
          const laneW = r.laneW || (r.r < 12 ? 3.0 : LW);
          rb.island = Math.max(1.5, r.r - lanes * laneW);
          for (const id of r.ringWays || []) { const w = this.ways.get(id); if (w) { w.lanesF = lanes; w.width = lanes * laneW; w.halfW = w.width / 2; } }
        }
      }
      let island = rb.island;
      if (lanes <= 1) { const want = Math.min(MIN_RING, r.r - 1.5); if (island == null || r.r - island < want) island = r.r - want; }
      rb.island = island;
      // a single-lane ring's lane IS the whole carriageway, so the driving line sits in its middle
      rb.laneW = lanes <= 1 && island != null ? Math.max(3.5, r.r - island) : (r.laneW || (r.r < 12 ? 3.0 : LW));
      rb.angleAt = (x, z) => Math.atan2(z - rb.z, x - rb.x);
      rb.pointAt = (ang, radius) => [rb.x + Math.cos(ang) * radius, rb.z + Math.sin(ang) * radius];
      rb.laneRadius = (k) => rb.r - (k - 0.5) * rb.laneW; // lane 1 = outer (nearside) lane
      rb.outer = rb.r;
      this.roundabouts.set(rb.id, rb);
      for (const nid of rb.ringNodes) { const n = this.nodes.get(nid); if (n) n.rb = rb.id; }
    }
    this.rbGrid = new GridIndex(250);
    for (const rb of this.roundabouts.values()) this.rbGrid.insert(rb.x - rb.r - 5, rb.z - rb.r - 5, rb.x + rb.r + 5, rb.z + rb.r + 5, rb);
  }
  // graph links: a way cut at its graph nodes. Travel a->b always, b->a only on two-way ways.
  #buildLinks() {
    this.links = []; this.out = new Map(); // node id -> [{ link, dir }]
    const add = (nid, link, dir) => { let a = this.out.get(nid); if (!a) this.out.set(nid, (a = [])); a.push({ link, dir }); };
    for (const way of this.ways.values()) {
      way.links = [];
      let i0 = 0;
      for (let i = 1; i < way.nodes.length; i++) {
        if (!way.nodes[i] && i < way.nodes.length - 1) continue;
        const a = way.nodes[i0], b = way.nodes[i];
        const link = { id: this.links.length, way, i0, i1: i, a, b, len: way.cum[i] - way.cum[i0] };
        this.links.push(link); way.links.push(link);
        if (a) add(a, link, 1); if (b && !way.oneway) add(b, link, -1);
        i0 = i;
      }
    }
  }
  // ---------- bridges: a deck height per way, and ramps on the roads that run up to one ----------
  // OSM says which ways are bridges and on which layer; it says nothing about height, so a layer is
  // DECK metres up (6 m clears a double-decker). A bridge way is flat at its deck for its whole
  // length; any other way that ends on a bridge's node climbs to that node's height over its last
  // RAMP metres, so the approach embankment is the road itself, not a cliff. A road that merely
  // passes beneath shares no node with the bridge and stays on the ground: that is the whole point.
  #buildDecks() {
    const DECK = 6;
    // A real flyover rises to cross over another road. A bridge over a river, rail or canal does
    // NOT (most OSM "bridge" ways are these, and on a flat map they would otherwise become 6 m
    // walls — the thing that made the roads feel un-smooth). So a bridge gets a deck ONLY where one
    // of its segments actually crosses a drivable way on a lower layer.
    const crossesLower = (w) => {
      const L = w.layer || 0;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        const cands = this.grid.query(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
        for (const { way: o, i: j } of cands) {
          if (o === w || (o.layer || 0) >= L || (o.bridge && !o.tunnel)) continue; // the road beneath must be at grade
          const c = o.pts[j], d = o.pts[j + 1];
          if (segCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return true;
        }
      }
      return false;
    };
    this.nodeDeck = new Map();
    // ramp length by class: a motorway or trunk climbs to the deck gently, a side street more steeply
    const rampLen = (w) => (/^(motorway|trunk)(_link)?$/.test(w.cls) ? 220 : /^(primary|secondary)(_link)?$/.test(w.cls) ? 160 : 110);
    // only a major road builds a real flyover deck: motorways, trunk and primary A-roads and their
    // slip roads. A minor road tagged `bridge` is a little span over a river, rail or canal that in
    // life is near-flat — decking it just put a 6 m hump on an ordinary street.
    const DECKS = /^(motorway|trunk|primary)(_link)?$/;
    const seeds = []; // the deck nodes: where the road surface is already up on a flyover
    for (const w of this.ways.values()) {
      w.deckH = DECKS.test(w.cls) && w.bridge && !w.tunnel && (w.layer || 0) > 0 && crossesLower(w) ? DECK * Math.min(3, w.layer) : 0;
      if (!w.deckH) continue;
      for (const nid of w.nodes) if (nid) {
        this.nodeDeck.set(nid, Math.max(this.nodeDeck.get(nid) || 0, w.deckH));
        seeds.push({ nid, h: w.deckH, ramp: rampLen(w) });
      }
    }
    // Spread each deck's height out along the road graph so the rise reaches the ground over a real
    // run of tarmac (rampLen), however many short ways the approach is split into. nodeH(node) is the
    // greatest height any deck can still give it; it falls linearly to 0 at rampLen metres away.
    const adj = new Map();
    const link2 = (nid, to, len) => { let a = adj.get(nid); if (!a) adj.set(nid, (a = [])); a.push({ to, len }); };
    for (const l of this.links) if (l.a && l.b) { link2(l.a, l.b, l.len); link2(l.b, l.a, l.len); }
    const nodeH = new Map();
    const heap = new Heap();
    for (const s of seeds) heap.push(0, s); // ordered by distance from the deck
    while (heap.size) {
      const [dist, s] = heap.pop();
      const h = s.h * (1 - dist / s.ramp);
      if (h <= (nodeH.get(s.nid) || 0)) continue;
      nodeH.set(s.nid, h);
      for (const e of adj.get(s.nid) || []) {
        const nd = dist + e.len, nh = s.h * (1 - nd / s.ramp);
        if (nh > 0 && nh > (nodeH.get(e.to) || 0)) heap.push(nd, { nid: e.to, h: s.h, ramp: s.ramp });
      }
    }
    // each way's deck height is nodeH sampled at its own graph nodes, linear by arc length between
    // them: deck ways read a flat 6 m, approach ways a gentle slope, and a boundary node agrees for
    // both ways that meet there, so there are no steps.
    const interp = (samples, s) => {
      if (s <= samples[0][0]) return samples[0][1];
      const last = samples[samples.length - 1];
      if (s >= last[0]) return last[1];
      for (let k = 1; k < samples.length; k++) if (s <= samples[k][0]) {
        const [s0, h0] = samples[k - 1], [s1, h1] = samples[k];
        return s1 === s0 ? h1 : h0 + (h1 - h0) * ((s - s0) / (s1 - s0));
      }
      return last[1];
    };
    for (const w of this.ways.values()) {
      const samples = [];
      for (let i = 0; i < w.nodes.length; i++) { const nid = w.nodes[i]; if (nid) samples.push([w.cum[i], w.deckH || nodeH.get(nid) || 0]); }
      if (!samples.length || samples.every((s) => s[1] <= 0)) { w.deck = null; w.hasDeck = false; continue; }
      w.deck = (s) => interp(samples, s);
      w.hasDeck = true;
    }
  }
  /** deck height (0 on the ground) at arc length s along a way */
  deckAt(way, s) { return way.deck ? way.deck(Math.max(0, Math.min(way.len, s))) : 0; }
  /**
   * The deck under a world point. Where a bridge crosses another road both carriageways contain
   * the point, so the caller passes its current height and the deck that keeps it closest wins:
   * a car on the flyover stays up, a car passing beneath stays down. With no prevY, the ground.
   */
  deckNear(x, z, prevY = null, terrainY = 0) {
    let best = 0, bestScore = Infinity;
    // Follow the road you are actually ON: score mostly by how near its centreline is (lateral
    // metres), so the car tracks its own carriageway's deck and never latches onto a parallel one.
    // Height-continuity only breaks ties between decks that overlap the SAME point — a stacked
    // junction, where the M1 beneath and the slip road over it share (x,z): the car that came up
    // onto the slip stays up, the one underneath stays down.
    for (const { way, i } of this.grid.near(x, z, 12)) {
      const a = way.pts[i], b = way.pts[i + 1];
      const [t, px, pz] = projSeg(a[0], a[1], b[0], b[1], x, z);
      const lat = hypot(x - px, z - pz);
      if (lat > way.halfW + 1.5) continue;
      const d = way.hasDeck ? this.deckAt(way, way.cum[i] + t * hypot(b[0] - a[0], b[1] - a[1])) : 0;
      const score = lat + (prevY == null ? 0 : 0.3 * Math.abs(terrainY + d - prevY));
      if (score < bestScore) { bestScore = score; best = d; }
    }
    // with no previous height prefer the ground, so static things placed by position stay beneath
    if (prevY == null) return 0;
    // ...but if nothing decked is here at all, best stays 0
    return best;
  }
  #buildExtras() {
    this.#buildDecks();
    for (const c of this.data.crossings || []) { let a = this.crossingsByWay.get(c.way); if (!a) this.crossingsByWay.set(c.way, (a = [])); a.push(c); }
    // speed humps, cushions and tables, by way, so the coach can see one coming
    for (const c of this.data.calming || []) { let a = this.calmingByWay.get(c.way); if (!a) this.calmingByWay.set(c.way, (a = [])); a.push(c); }
    this.signalGroup = new Map(); for (const s of this.data.signals || []) this.signalGroup.set(s.node, s.junction);
    this.buildingGrid = new GridIndex(100);
    for (const b of this.data.buildings || []) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const p of b.pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1]; }
      b.box = [minX, minZ, maxX, maxZ]; this.buildingGrid.insert(minX, minZ, maxX, maxZ, b);
    }
    this.placesIn = this.places.filter((p) => !p.far); this.placesFar = this.places.filter((p) => p.far);
    this.placeRank = new Map(this.places.map((p) => [p.name, p.rank ?? 2]));
  }

  // ---------- geometry helpers on a way ----------
  /** [x, z] on the centreline at arc length s */
  pointAt(way, s) {
    const i = this.segAt(way, s), t = this.#tAt(way, i, s), a = way.pts[i], b = way.pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  segAt(way, s) {
    const cum = way.cum; let lo = 0, hi = cum.length - 2;
    if (s <= 0) return 0; if (s >= way.len) return hi;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }
  #tAt(way, i, s) { const L = way.cum[i + 1] - way.cum[i]; return L > 0 ? Math.min(1, Math.max(0, (s - way.cum[i]) / L)) : 0; }
  dirAt(way, s) {
    const i = this.segAt(way, s), a = way.pts[i], b = way.pts[i + 1], L = hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  }
  laneWidth(way) { return way.oneway ? way.width / Math.max(1, way.lanesF) : way.halfW / Math.max(1, way.lanesF); }
  laneCount(way, dir = 1) { return dir > 0 ? way.lanesF : way.lanesB; }
  /**
   * Lateral offset (positive = left of the way direction) of lane k's centre. On a ring way the
   * carriageway is the annulus [island, r] with the OSM centreline at its outer edge (DESIGN.md
   * section 1: island = r - lanes * laneW), so ring lanes sit inside the centreline: lane 1 (outer)
   * at r - laneW/2, lane 2 at r - 1.5 laneW, matching the arcs lanePath draws.
   */
  laneOffset(way, k) {
    if (way.rb) { const rb = this.roundabouts.get(way.rb); if (rb) return -(k - 0.5) * rb.laneW * rb.sense; }
    if (way.oneway) return way.halfW - (k - 0.5) * this.laneWidth(way);
    if (k > 0) return way.halfW - (k - 0.5) * (way.halfW / Math.max(1, way.lanesF));
    return -(way.halfW - (-k - 0.5) * (way.halfW / Math.max(1, way.lanesB)));
  }
  laneCentre(way, k, s) {
    const p = this.pointAt(way, s), d = this.dirAt(way, s);
    const rb = way.rb ? this.roundabouts.get(way.rb) : null;
    if (rb) { // radial, so the point is on the ring lane circle whatever the polyline's local wobble
      const ang = rb.angleAt(p[0], p[1]), q = rb.pointAt(ang, rb.laneRadius(Math.max(1, k)));
      return { x: q[0], z: q[1], dir: d };
    }
    const off = this.laneOffset(way, k), n = leftOf(d[0], d[1]);
    return { x: p[0] + n[0] * off, z: p[1] + n[1] * off, dir: k < 0 ? [-d[0], -d[1]] : d };
  }

  // ---------- point lookups ----------
  nearest(x, z, maxD = 60) {
    let best = null;
    const rings = Math.ceil(maxD / this.grid.cell) + 1;
    for (let k = 0; k <= rings; k++) {
      this.grid.ring(x, z, k, (items) => {
        for (const { way, i } of items) {
          const a = way.pts[i], b = way.pts[i + 1];
          const [t, px, pz] = projSeg(a[0], a[1], b[0], b[1], x, z), d = hypot(x - px, z - pz);
          if (d < (best ? best.dist : maxD)) best = { way, i, t, px, pz, dist: d };
        }
      });
      // a hit closer than the inner edge of the next ring cannot be beaten
      if (best && best.dist <= k * this.grid.cell) break;
    }
    if (!best) return null;
    const { way, i, t } = best, a = way.pts[i], b = way.pts[i + 1], L = hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = leftOf(dir[0], dir[1]);
    best.s = way.cum[i] + t * L; best.dir = dir;
    best.side = ((x - best.px) * n[0] + (z - best.pz) * n[1]) >= 0 ? 1 : -1;
    return best;
  }
  rbAt(x, z, pad = 2) {
    for (const rb of this.rbGrid.near(x, z, 1)) if (hypot(x - rb.x, z - rb.z) <= rb.r + pad) return rb;
    return null;
  }
  limitAt(x, z) {
    const rb = this.rbAt(x, z); if (rb) return rb.limit;
    const n = this.nearest(x, z); return n ? n.way.limit : 30;
  }
  nslAt(x, z) {
    if (this.rbAt(x, z)) return false;
    const n = this.nearest(x, z); return n ? !!n.way.nsl : false;
  }
  /** the smallest place circle containing the point */
  placeOf(x, z) {
    let best = null;
    for (const p of this.placesIn) if (hypot(x - p.x, z - p.z) <= p.r && (!best || p.r < best.r)) best = p;
    return best;
  }
  placeAt(x, z) {
    const n = this.nearest(x, z, 60), place = this.placeOf(x, z), region = this.data.name || 'Kent';
    if (!n) return place ? place.name : region;
    const w = n.way;
    if (w.ref && w.name) return `${w.ref} ${w.name}`;
    if (w.ref) return place ? `${w.ref}, ${place.name}` : w.ref;
    if (w.name) return place ? `${w.name}, ${place.name}` : w.name;
    return place ? place.name : region;
  }
  buildingsNear(x, z, r) { return this.buildingGrid.near(x, z, r); }

  /**
   * The real postal address of the nearest building that has one, e.g. "157 Colindeep Lane, NW9 6DB".
   * Straight off OpenStreetMap's addr:housenumber / addr:street / addr:postcode, so these are the
   * actual house numbers and postcodes of the streets you are driving.
   */
  addressAt(x, z, r = 32) {
    let best = null, bd = r * r;
    for (const b of this.buildingGrid.near(x, z, r)) {
      if (!b.nr && !b.pc) continue;
      const bx = b.box, cx = Math.max(bx[0], Math.min(x, bx[2])), cz = Math.max(bx[1], Math.min(z, bx[3]));
      const d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return null;
    const line = [best.nr, best.st].filter(Boolean).join(' ');
    return { line: line || null, postcode: best.pc || null, name: best.name || null,
      text: [line || best.name, best.pc].filter(Boolean).join(', ') || null };
  }

  // ---------- roundabout policy ----------
  rbSense(rb) { return (typeof rb === 'string' ? this.roundabouts.get(rb) : rb).sense; }
  /** arms in circulation order starting just after `from` (an arm object or index) */
  rbArmsFrom(rb, from) {
    const arms = rb.arms, i0 = typeof from === 'number' ? from : arms.indexOf(from), n = arms.length, out = [];
    for (let k = 1; k <= n; k++) out.push(arms[((rb.sense > 0 ? i0 + k : i0 - k) % n + n) % n]);
    return out; // the last one is `from` itself (a full circle)
  }
  /**
   * Highway Code 184-190: count the exits passed, decide left/none/right and the lanes to use.
   * Exits up to and including straight ahead take the left-hand lane, exits past straight ahead the
   * right-hand lane; on a 3-lane approach the middle lane is for straight ahead when the lanes are signed.
   */
  rbExitIndex(rb, inArm, outArm, inLeg = null) {
    if (typeof rb === 'string') rb = this.roundabouts.get(rb);
    const approach = norm180(inArm.bearing + 180);
    const turnOf = (arm) => norm180(arm.bearing - approach);
    const order = this.rbArmsFrom(rb, inArm);
    let exit = 0, straightN = null, n = 0, straightTurn = 999;
    for (const arm of order) {
      if (!arm.exit) continue; n++;
      const t = Math.abs(turnOf(arm));
      if (t <= 35 && t < straightTurn && arm !== inArm) { straightTurn = t; straightN = n; }
      if (arm === outArm) exit = n;
    }
    if (!exit) { // arm not found as an exit: count by bearing as a fallback
      exit = order.filter((a) => a.exit).findIndex((a) => Math.abs(norm180(a.bearing - outArm.bearing)) < 1) + 1 || 1;
    }
    const turn = turnOf(outArm);
    const uTurn = Math.abs(turn) > 150 && outArm === inArm;
    const dir = uTurn ? 'right' : turn < -35 ? 'left' : turn > 35 ? 'right' : 'none';
    const pastStraight = straightN != null ? exit > straightN : turn > 35;
    // the arm's entryLanes is the max over every way merged into that arm (a 1-lane side road next
    // to a 2-lane slip inherits 2), so clamp to the lanes the road we are actually on really has -
    // the examiner must never demand lane 2 of a one-lane street
    const ownLanes = inLeg ? Math.max(1, this.laneCount(inLeg.way, inLeg.dir) || 1) : Infinity;
    const entryLanes = Math.max(1, Math.min(ownLanes, inArm.entryLanes || 1)), signed = !!inArm.signed;
    let approachLane = 1;
    if (entryLanes >= 3) approachLane = pastStraight || uTurn ? entryLanes : exit === straightN && signed ? 2 : 1;
    else if (entryLanes === 2) approachLane = pastStraight || uTurn ? 2 : 1;
    const ringLane = Math.max(1, Math.min(rb.lanes, approachLane));
    const exitLanes = Math.max(1, outArm.exitLanes || 1);
    const exitLane = Math.min(ringLane, exitLanes);
    return { exit, dir, approachLane, ringLane, exitLane, turn: Math.round(turn), straightExit: straightN, exits: n };
  }
  /** the arm whose entry (or exit) meets the ring at `nodeId`, else the arm nearest a bearing */
  rbArmAt(rb, nodeId, wayId, bearing) {
    let arm = rb.arms.find((a) => a.node === nodeId || a.exitNode === nodeId);
    if (!arm && wayId != null) arm = rb.arms.find((a) => a.entryWays.includes(wayId) || a.exitWays.includes(wayId));
    if (!arm && bearing != null) arm = rb.arms.reduce((b, a) => (Math.abs(norm180(a.bearing - bearing)) < Math.abs(norm180(b.bearing - bearing)) ? a : b));
    return arm;
  }

  // ---------- routing ----------
  /** realistic cruising speed in m/s: the limit, capped by what the class of road allows (a 60 mph lane is not a 60 mph road) */
  #speed(way) { return Math.max(5, Math.min(way.limit, CRUISE[way.cls] ?? 30)) * 0.44704; }
  #linkCost(link) { return link.len / this.#speed(link.way) + (link.way.cls === 'service' ? link.len * 0.3 : 0); }
  /** heading at the end (dir +1) or start (dir -1) of a link, travelling in dir */
  #linkOutHeading(link, dir) {
    const w = link.way, i = dir > 0 ? link.i1 : link.i0, j = dir > 0 ? link.i1 - 1 : link.i0 + 1;
    return bearingOf(w.pts[i][0] - w.pts[j][0], w.pts[i][1] - w.pts[j][1]);
  }
  #linkInHeading(link, dir) {
    const w = link.way, i = dir > 0 ? link.i0 : link.i1, j = dir > 0 ? link.i0 + 1 : link.i1 - 1;
    return bearingOf(w.pts[j][0] - w.pts[i][0], w.pts[j][1] - w.pts[i][1]);
  }
  #turnPenalty(fromLink, fromDir, toLink, toDir, node) {
    if (fromLink.way.rb || toLink.way.rb) return 0.5; // circulating / joining a ring: the ring sense does the rest
    if (fromLink.way === toLink.way) return 0;
    const turn = norm180(this.#linkInHeading(toLink, toDir) - this.#linkOutHeading(fromLink, fromDir));
    let pen = 1; // any junction costs a second
    if (turn > 30) pen += toLink.way.oneway && fromLink.way.oneway ? 2 : 8; // right turn across traffic
    else if (turn < -30) pen += 2;
    if (node && (node.giveWay || node.stop)) pen += 3;
    if (fromLink.way.rank > toLink.way.rank && !toLink.way.link) pen += 2; // leaving a bigger road
    return pen;
  }
  /** a point's position on the graph: the link under it and the arc lengths */
  #locate(p) {
    if (typeof p === 'number') { const n = this.nodes.get(p); if (!n) throw new Error(`no node ${p}`); return { node: n }; }
    const h = this.nearest(p.x, p.z, p.maxD || 120); if (!h) throw new Error(`no road near ${p.x},${p.z}`);
    const link = h.way.links.find((l) => h.i >= l.i0 && h.i < l.i1) || h.way.links[h.way.links.length - 1];
    return { link, s: h.s, way: h.way, hit: h };
  }
  /**
   * legs: an optional Map to remember legs in (the test generator tries many routes through the same
   * vias). Only for calls with the same avoid list and maxLeg; the legs in it are never changed.
   * maxLeg: give up on a leg that would take longer than this many seconds (no route).
   */
  route(from, to, { via = [], avoid = [], noUturn = false, legs = null, maxLeg = Infinity } = {}) {
    const stops = [from, ...via, to];
    const avoidSet = new Set(avoid), at = (p) => (typeof p === 'number' ? p : `${p.x},${p.z}`);
    let total = null, ban = null;
    for (let i = 0; i < stops.length - 1; i++) {
      // noUturn (the generated driving tests): a leg may not start back along the link the last one arrived on
      const banNow = noUturn ? ban : null;
      let leg;
      if (legs) {
        const key = `${at(stops[i])}>${at(stops[i + 1])}|${banNow ? banNow.link.id * 2 + (banNow.dir > 0 ? 1 : 0) : ''}`;
        leg = legs.get(key);
        if (leg === undefined) legs.set(key, (leg = this.#routeLeg(stops[i], stops[i + 1], avoidSet, banNow, maxLeg)));
      } else leg = this.#routeLeg(stops[i], stops[i + 1], avoidSet, banNow, maxLeg);
      if (leg) ban = leg.lastLink;
      if (!leg) return null;
      // copies: the merge below changes the route it builds, and a remembered leg must stay as it was
      if (!total) { total = { nodes: leg.nodes.slice(), ways: leg.ways.map((w) => ({ ...w })), length: leg.length, lastLink: leg.lastLink }; continue; }
      total.nodes.push(...leg.nodes.slice(1));
      const last = total.ways[total.ways.length - 1], first = leg.ways[0];
      const ways = leg.ways.map((w) => ({ ...w }));
      if (last && first && last.way === first.way && last.dir === first.dir && (first.dir > 0 ? first.s0 >= last.s1 - 1e-6 : first.s0 <= last.s1 + 1e-6)) { last.s1 = first.s1; total.ways.push(...ways.slice(1)); }
      else total.ways.push(...ways);
      total.length += leg.length;
      total.lastLink = leg.lastLink;
    }
    return total;
  }
  #routeLeg(from, to, avoid, ban = null, maxCost = Infinity) {
    const A = this.#locate(from), B = this.#locate(to);
    const heap = new Heap(), best = new Map(), prev = new Map(); // key = link.id * 2 + (dir > 0 ? 1 : 0)
    const key = (link, dir) => link.id * 2 + (dir > 0 ? 1 : 0);
    const push = (link, dir, cost, from) => { const k = key(link, dir); if (best.has(k) && best.get(k) <= cost) return; best.set(k, cost); prev.set(k, from); heap.push(cost, { link, dir }); };
    let bestEnd = null; // { cost, key, s }
    const endLink = B.link, endS = B.s;
    // same link, forward reach: direct
    if (A.link && B.link && A.link === B.link) {
      const w = A.link.way;
      if (B.s >= A.s || !w.oneway) {
        const dir = B.s >= A.s ? 1 : -1;
        return { nodes: [], ways: [{ way: w, dir, s0: A.s, s1: B.s }], length: Math.abs(B.s - A.s) };
      }
    }
    const tryEnd = (link, dir, costAtEntry, k) => {
      if (link !== endLink) return;
      const w = link.way, sEntry = dir > 0 ? w.cum[link.i0] : w.cum[link.i1];
      const ok = dir > 0 ? endS >= sEntry - 1e-6 : endS <= sEntry + 1e-6; if (!ok) return;
      const c = costAtEntry + Math.abs(endS - sEntry) / this.#speed(w);
      if (!bestEnd || c < bestEnd.cost) bestEnd = { cost: c, key: k, link, dir };
    };
    // seeds
    if (A.node) {
      for (const { link, dir } of this.out.get(A.node.id) || []) if (!avoid.has(link.way.id) && !(ban && ban.link === link && ban.dir === -dir)) { push(link, dir, this.#linkCost(link), null); tryEnd(link, dir, 0, null); }
      if (B.node && A.node === B.node) return { nodes: [A.node.id], ways: [], length: 0 };
    } else {
      const w = A.link.way, L = A.link;
      push(L, 1, (w.cum[L.i1] - A.s) / this.#speed(w), null);
      if (!w.oneway) push(L, -1, (A.s - w.cum[L.i0]) / this.#speed(w), null);
    }
    let found = null, capped = false;
    while (heap.size) {
      const [cost, { link, dir }] = heap.pop(); const k = key(link, dir);
      if (cost > maxCost) { capped = true; break; }
      if (best.get(k) < cost) continue;
      if (bestEnd && cost > bestEnd.cost) break;
      const nid = dir > 0 ? link.b : link.a, node = nid ? this.nodes.get(nid) : null;
      if (B.node && node === B.node) { found = { key: k, cost }; break; }
      if (!node) continue;
      for (const nx of this.out.get(nid) || []) {
        if (nx.link === link && nx.dir === -dir) continue; // no U-turns
        if (avoid.has(nx.link.way.id) || avoid.has(nid)) continue;
        const c = cost + this.#turnPenalty(link, dir, nx.link, nx.dir, node) + this.#linkCost(nx.link);
        push(nx.link, nx.dir, c, k);
        if (!B.node) tryEnd(nx.link, nx.dir, cost + this.#turnPenalty(link, dir, nx.link, nx.dir, node), k);
      }
    }
    // (cut short by maxCost, an end that costs more than it might not be the best one: no route, so a
    // capped search never gives a different route from an uncapped one)
    if (!found && bestEnd && !(capped && bestEnd.cost > maxCost)) found = { key: bestEnd.key, cost: bestEnd.cost, endLink: bestEnd.link, endDir: bestEnd.dir };
    if (!found) return null;
    // unwind
    const chain = [];
    if (found.endLink) chain.push({ link: found.endLink, dir: found.endDir, partialEnd: true });
    let k = found.key;
    while (k != null) { const link = this.links[k >> 1], dir = k & 1 ? 1 : -1; if (!(found.endLink && chain.length === 1 && chain[0].link === link && chain[0].dir === dir)) chain.push({ link, dir }); k = prev.get(k); }
    chain.reverse();
    const ways = [], nodes = [];
    let length = 0;
    chain.forEach((c, i) => {
      const w = c.link.way;
      let s0 = c.dir > 0 ? w.cum[c.link.i0] : w.cum[c.link.i1], s1 = c.dir > 0 ? w.cum[c.link.i1] : w.cum[c.link.i0];
      if (i === 0 && !A.node) s0 = A.s;
      if (i === chain.length - 1 && !B.node) s1 = endS;
      length += Math.abs(s1 - s0);
      const last = ways[ways.length - 1];
      // merge consecutive links of one way only while s keeps going the same way (a closed ring way wraps back to s 0)
      if (last && last.way === w && last.dir === c.dir && (c.dir > 0 ? s0 >= last.s1 - 1e-6 : s0 <= last.s1 + 1e-6)) last.s1 = s1; else ways.push({ way: w, dir: c.dir, s0, s1 });
      const startNode = c.dir > 0 ? c.link.a : c.link.b, endNode = c.dir > 0 ? c.link.b : c.link.a;
      if (i === 0 && startNode && A.node) nodes.push(startNode);
      if (endNode && !(i === chain.length - 1 && !B.node)) nodes.push(endNode);
    });
    const lc = chain[chain.length - 1];
    return { nodes, ways, length, lastLink: lc ? { link: lc.link, dir: lc.dir } : null };
  }

  // ---------- destinations for signs ----------
  /**
   * Follow the road from a node along an arm: same ref, else same name, else the straightest big
   * road; across roundabouts by the same rule. Returns the graph nodes passed with the distance so far.
   */
  followRoad(nodeId, arm, maxLen = 12000) {
    let node = this.nodes.get(nodeId), way = arm.way, dir = arm.dir, idx = arm.idx, len = 0;
    const visited = new Set([`${way.id}:${dir}`]), path = [];
    for (let guard = 0; guard < 400 && len < maxLen; guard++) {
      // walk this way to its next graph node
      let j = idx;
      for (;;) { j += dir; if (j < 0 || j >= way.nodes.length) return path; if (way.nodes[j]) break; }
      len += Math.abs(way.cum[j] - way.cum[idx]);
      const next = this.nodes.get(way.nodes[j]); path.push({ node: next, way, len, heading: this.#armBearing(way, j, -dir) + 180 });
      if (next.rb) { // cross a ring: take the exit arm with the same ref/name, else straight ahead
        const rb = this.roundabouts.get(next.rb); if (!rb) return path;
        const inArm = this.rbArmAt(rb, next.id, way.id, this.#armBearing(way, j, -dir));
        const cands = rb.arms.filter((a) => a.exit && a !== inArm);
        const same = cands.find((a) => (way.ref && a.refs.includes(way.ref)) || (way.name && a.names.includes(way.name)));
        const approach = norm180(inArm.bearing + 180);
        const pick = same || cands.reduce((b, a) => (b && Math.abs(norm180(b.bearing - approach)) <= Math.abs(norm180(a.bearing - approach)) ? b : a), null);
        if (!pick || !pick.exitWays.length) return path;
        const exitWay = this.ways.get(pick.exitWays[0]); if (!exitWay) return path;
        const exitNode = this.nodes.get(pick.exitNode ?? pick.node);
        const ref = exitNode.ways.find((r) => r.way === exitWay); if (!ref) return path;
        way = exitWay; idx = ref.idx; dir = ref.idx === 0 ? 1 : -1; node = exitNode;
        if (visited.has(`${way.id}:${dir}`)) return path; visited.add(`${way.id}:${dir}`);
        continue;
      }
      const inH = this.#armBearing(way, j, -dir) + 180;
      let bestArm = null, bestScore = -Infinity;
      for (const a of next.arms()) {
        if (!a.legal || (a.way === way && a.dir === -dir)) continue;
        const turn = Math.abs(norm180(a.bearing - inH));
        let score = -turn;
        if (way.ref && a.way.ref === way.ref) score += 200; else if (way.name && a.way.name === way.name && !way.ref) score += 150; else if (a.way.rank >= way.rank) score += 20 * (a.way.rank - way.rank);
        if (turn > 70 && score < 100) score -= 100;
        if (score > bestScore) { bestScore = score; bestArm = a; }
      }
      if (!bestArm || bestScore < -60) return path;
      way = bestArm.way; dir = bestArm.dir; idx = bestArm.idx; node = next;
      if (visited.has(`${way.id}:${dir}`)) return path; visited.add(`${way.id}:${dir}`);
    }
    return path;
  }
  /** far places (outside the region) in the direction a road leaves the map, nearest first; suburbs only if nothing better */
  farPlaces(x, z, heading, tol = 40) {
    const c = this.placesFar.map((p) => ({ p, d: Math.abs(norm180(bearingOf(p.x - x, p.z - z) - heading)), km: hypot(p.x - x, p.z - z) / 1000 })).filter((e) => e.d <= tol).sort((a, b) => a.km - b.km);
    const towns = c.filter((e) => (e.p.rank ?? 2) <= 2);
    return (towns.length ? towns : c).map((e) => e.p);
  }
  /**
   * Places reached by following an arm from a node: first the road itself (same ref/name), then a
   * directional search for anything else within reach. Up to 3 names, nearest first. A road with a
   * ref counts suburbs only where it ends and villages only where it passes through them; a town
   * whose circle already contains the start still counts once the road gets near its centre.
   */
  destinations(nodeId, arm, max = 3) {
    const start = this.nodes.get(typeof nodeId === 'number' ? nodeId : nodeId.id); if (!start) return [];
    if (!arm.idx && arm.idx !== 0) arm = start.arms().find((a) => a.way === arm.way && a.dir === arm.dir) || arm;
    const here = new Map(this.placesIn.filter((p) => hypot(start.x - p.x, start.z - p.z) <= p.r).map((p) => [p.name, p]));
    const found = new Map(); // name -> distance
    const consider = (x, z, len, way, last) => {
      for (const p of this.placesIn) {
        if (found.has(p.name)) continue;
        const d = hypot(x - p.x, z - p.z);
        if (here.has(p.name)) { if (d <= p.r * 0.45 && (p.rank ?? 2) <= 1) found.set(p.name, len); continue; }
        if (d > p.r) continue;
        if (way && way.ref && !last) { if ((p.rank ?? 2) >= 3) continue; if (p.rank === 2 && d > p.r * 0.5) continue; }
        found.set(p.name, len);
      }
    };
    const walk = this.followRoad(start.id, arm);
    walk.forEach((step, i) => {
      consider(step.node.x, step.node.z, step.len, step.way, i === walk.length - 1);
      if (step.node.edge) for (const p of this.farPlaces(step.node.x, step.node.z, step.heading)) if (!found.has(p.name)) found.set(p.name, step.len + 1000 + (p.rank || 5) * 10);
    });
    if (found.size < max) { // directional Dijkstra for the rest
      const heap = new Heap(), seen = new Map();
      heap.push(0, { node: start, len: 0, first: true, arm });
      while (heap.size && seen.size < 2500) {
        const [, cur] = heap.pop();
        if (seen.has(cur.node.id)) continue; seen.set(cur.node.id, cur.len);
        if (cur.len > 6000) break;
        if (!cur.first) consider(cur.node.x, cur.node.z, cur.len);
        for (const a of cur.first ? [arm] : cur.node.arms()) {
          if (!cur.first && !a.legal) continue; // the first arm is the caller's choice (entry-only arms look back along the approach)
          if (!cur.first && a.way.rb) continue; // don't circulate rings in the search; they're small
          const w = a.way; let j = a.idx; for (;;) { j += a.dir; if (j < 0 || j >= w.nodes.length) { j = -1; break; } if (w.nodes[j]) break; }
          if (j < 0) continue;
          const nx = this.nodes.get(w.nodes[j]); if (!nx || seen.has(nx.id)) continue;
          const off = Math.abs(norm180(bearingOf(nx.x - start.x, nx.z - start.z) - arm.bearing));
          if (off > 75 && hypot(nx.x - start.x, nx.z - start.z) > 150) continue;
          const len = cur.len + Math.abs(w.cum[j] - w.cum[a.idx]);
          heap.push(len + (6 - Math.min(6, w.rank)) * 60, { node: nx, len, first: false });
          if (nx.edge) for (const p of this.farPlaces(nx.x, nx.z, this.#armBearing(w, j, -a.dir) + 180)) if (!found.has(p.name)) found.set(p.name, len + 1000 + (p.rank || 5) * 10);
        }
      }
    }
    let names = [...found.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const town = names.find((n) => (this.placeRank.get(n) ?? 2) <= 1); // the first town leads, as on a real sign
    if (town && names[0] !== town) names = [town, ...names.filter((n) => n !== town)];
    names = names.slice(0, max);
    if (!names.length) { const w = arm.way; if (w.ref || w.name) names.push([w.ref, w.name].filter(Boolean).join(' ')); }
    return names;
  }

  // ---------- lane paths and their events ----------
  /**
   * Lane-centre polyline along a route with fillets at junctions, roundabout arcs at the ring lane
   * radius and lane changes as short diagonals; resampled every 1.5 m. `events` follow section 6 of
   * DESIGN.md so LessonRun can read them unchanged.
   */
  lanePath(route, { end = 'pullup', endText = null, signsTarget = null } = {}) {
    if (!route || !route.ways.length) return { pts: [], events: [], length: 0, start: null };
    // 1. pieces: route legs with the lane to use, split where a lane change is needed
    const legs = route.ways.map((r, legIdx) => ({ way: r.way, dir: r.dir, s0: r.s0, s1: r.s1, lane: 1, len: Math.abs(r.s1 - r.s0), legIdx }));
    const nodeBetween = (i) => { // graph node where leg i ends and leg i+1 starts
      const l = legs[i], nid = l.way.nodes[this.#idxAt(l.way, l.s1)];
      return nid ? this.nodes.get(nid) : null;
    };
    const rbInfo = []; // per ring run: { startLeg, endLeg, rb, entryNode, exitNode, decision }
    for (let i = 0; i < legs.length; i++) {
      if (!legs[i].way.rb) continue;
      const rb = this.roundabouts.get(legs[i].way.rb);
      let j = i; while (j + 1 < legs.length && legs[j + 1].way.rb === legs[i].way.rb) j++;
      const entryNode = i > 0 ? nodeBetween(i - 1) : null, exitNode = j < legs.length - 1 ? nodeBetween(j) : null;
      if (rb && entryNode && exitNode) {
        const inLeg = legs[i - 1], outLeg = legs[j + 1];
        const inArm = this.rbArmAt(rb, entryNode.id, inLeg.way.id, this.#legHeading(inLeg, 'end') + 180);
        const outArm = this.rbArmAt(rb, exitNode.id, outLeg.way.id, this.#legHeading(outLeg, 'start'));
        const decision = inArm && outArm ? this.rbExitIndex(rb, inArm, outArm, inLeg) : { exit: 1, dir: 'none', approachLane: 1, ringLane: 1, exitLane: 1 };
        rbInfo.push({ startLeg: i, endLeg: j, rb, entryNode, exitNode, inArm, outArm, decision, inLeg, outLeg });
        // approach lane: the leg before the ring; exit lane on the leg after
        inLeg.wantLane = decision.approachLane; outLeg.lane = Math.min(decision.exitLane, this.laneCount(outLeg.way, outLeg.dir) || 1);
        for (let k = i; k <= j; k++) legs[k].ringLane = decision.ringLane;
      }
      i = j;
    }
    // right turns off a multi-lane one-way carriageway want the right-hand lane; left exits (slips) the left
    for (let i = 0; i < legs.length - 1; i++) {
      const l = legs[i], n = legs[i + 1], node = nodeBetween(i);
      if (!node || l.way.rb || n.way.rb || l.wantLane) continue;
      const turn = norm180(this.#legHeading(n, 'start') - this.#legHeading(l, 'end'));
      const lanes = this.laneCount(l.way, l.dir) || 1;
      if (lanes >= 2 && turn > 35) l.wantLane = lanes;
      if (l.way.turnLanes && l.dir > 0 && l.way.oneway) { // OSM turn:lanes per forward lane
        const want = turn > 35 ? 'right' : turn < -35 ? 'left' : 'through';
        const k = l.way.turnLanes.findIndex((lane) => lane.includes(want)); if (k >= 0) l.wantLane = k + 1;
      }
    }
    // a short final leg before the junction is not enough road to change lane in: want the lane earlier,
    // back along the same carriageway, so the change happens ~120 m out
    for (let i = legs.length - 1; i >= 0; i--) {
      const want = legs[i].wantLane; if (!want || legs[i].propagated) continue;
      let need = 120 - legs[i].len, j = i - 1;
      while (need > 0 && j >= 0 && !legs[j].way.rb && !legs[j].wantLane && this.laneCount(legs[j].way, legs[j].dir) >= want) { legs[j].wantLane = want; legs[j].propagated = true; need -= legs[j].len; j--; }
      for (let k = j + 2; k <= i; k++) legs[k].lane = want; // already in the lane after the first leg of the chain
    }
    // never ask for a lane the way doesn't have (an OSM flare at a give-way line isn't drawn as a lane)
    for (const l of legs) if (l.wantLane && !l.way.rb) l.wantLane = Math.min(l.wantLane, Math.max(1, this.laneCount(l.way, l.dir) || 1));
    const pieces = [];
    for (const l of legs) {
      if (l.wantLane && l.wantLane !== l.lane && l.len > 30) {
        // change 120 m out on a long leg; on a short one as early as it can, so the change is done well before the junction
        const sChange = l.s0 + l.dir * (l.len >= 125 ? l.len - 120 : Math.max(5, l.len - 65));
        pieces.push({ ...l, s1: sChange, lane: l.lane });
        pieces.push({ ...l, s0: sChange, lane: l.wantLane, laneChangeFrom: l.lane });
      } else pieces.push({ ...l, lane: l.wantLane || l.lane });
    }
    // 2. raw points: lane points along each piece, ring arcs and lane-change diagonals. Corners are
    //    smoothed afterwards in one pass by arc length (2b), so a 1 m leg between two ways, a sharp
    //    vertex inside a way and a clean junction all get the same kind of fillet.
    const raw = [], marks = []; // marks: { pt: raw point, ... event seed }
    const push = (x, z, meta) => { const pt = { x, z, ...meta }; raw.push(pt); return pt; };
    const lanePt = (p, s) => {
      const c = this.laneCentre(p.way, p.dir > 0 ? p.lane : -p.lane, s);
      let x = this.splitExtra(p.way, s);
      if (p.endShift) { const to = Math.abs(p.s1 - s), u = Math.max(0, 1 - to / p.endShift.len); x += p.endShift.d * u * u * (3 - 2 * u); } // ease into the next road's lane before the join
      if (x) { c.x += c.dir[1] * x; c.z -= c.dir[0] * x; } // leftOf(dir) = (dz, -dx)
      return c;
    };
    const sampleS = (p, from, to) => { // way arc lengths from..to in travel direction, including vertices
      const out = [from], lo = Math.min(from, to), hi = Math.max(from, to);
      const idx = []; for (let i = 0; i < p.way.pts.length; i++) if (p.way.cum[i] > lo + 0.05 && p.way.cum[i] < hi - 0.05) idx.push(p.way.cum[i]);
      if (p.dir < 0) idx.reverse(); out.push(...idx, to); return out;
    };
    const bez = (A, Q, B, n) => { const out = []; for (let j = 1; j < n; j++) { const t = j / n, u = 1 - t; out.push([u * u * A[0] + 2 * u * t * Q[0] + t * t * B[0], u * u * A[1] + 2 * u * t * Q[1] + t * t * B[1]]); } return out; };
    const rbByLeg = new Map(); for (const info of rbInfo) for (let k = info.startLeg; k <= info.endLeg; k++) rbByLeg.set(k, info);
    let pi = 0;
    while (pi < pieces.length) {
      const p = pieces[pi];
      const info = rbByLeg.get(p.legIdx) || null;
      if (info && p.way.rb) {
        // ring run: replace the ring legs by an arc from the entry node angle to the exit node angle
        let pj = pi; while (pj + 1 < pieces.length && pieces[pj + 1].way.rb === p.way.rb) pj++;
        const rb = info.rb, lane = info.decision.ringLane, rad = rb.laneRadius(lane);
        const thE = rb.angleAt(info.entryNode.x, info.entryNode.z), thX = rb.angleAt(info.exitNode.x, info.exitNode.z);
        let sweep = (thX - thE) * rb.sense; sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); if (sweep < 0.05) sweep += 2 * Math.PI;
        const prevRaw = raw[raw.length - 1], prevPiece = pieces[pi - 1];
        // the approach was trimmed 6 m short of the ring node; its lane point at the node is the corner we blend through
        const Qin = prevPiece && prevPiece.cornerPt ? [prevPiece.cornerPt.x, prevPiece.cornerPt.z] : [info.entryNode.x, info.entryNode.z];
        const nextP = pieces[pj + 1];
        const sOut = nextP ? nextP.s0 + nextP.dir * Math.min(6, Math.abs(nextP.s1 - nextP.s0)) : null;
        const B = nextP ? lanePt(nextP, sOut) : null, Qout = nextP ? lanePt(nextP, nextP.s0) : null;
        const mark = { kind: 'rb', info, entryOffset: prevPiece ? prevPiece.ringTrim || 0 : 0 };
        // a straight line between the entry and exit lane points must clear the island (a tiny ring
        // like The Boulevard's turning circle is driven round, not across)
        const chordClear = rad * Math.cos(Math.min(Math.PI, sweep) / 2) > (rb.island ?? 0) + 1.2;
        if (sweep * rad < 14 && chordClear && prevRaw && B) {
          // entry and exit arms meet the ring within a car length: a plain corner, no arc
          const Q = [(Qin[0] + Qout.x) / 2, (Qin[1] + Qout.z) / 2];
          for (const q of bez([prevRaw.x, prevRaw.z], Q, [B.x, B.z], 9)) push(q[0], q[1], { way: p.way, lane, rb: rb.id, blend: true });
          marks.push({ ...mark, pt: prevRaw, exitPt: raw[raw.length - 1] });
          nextP.skipTo = sOut; pi = pj + 1; continue;
        }
        const lead = Math.min((rb.r < 8 ? 2.5 : 6) / rad, sweep / (rb.r < 8 ? 4 : 3)); // tiny rings: blend in late or the curve crosses the island
        const a0 = rb.pointAt(thE + rb.sense * lead, rad);
        if (prevRaw) for (const q of bez([prevRaw.x, prevRaw.z], Qin, a0, 5)) push(q[0], q[1], { way: p.way, lane, rb: rb.id, blend: true }); // blend from the approach lane into the ring lane
        const a0pt = push(a0[0], a0[1], { way: p.way, lane, rb: rb.id });
        const rbMark = { ...mark, pt: prevRaw || a0pt };
        marks.push(rbMark);
        const n = Math.max(6, Math.round((sweep - 2 * lead) * rad / 1.5));
        // the exit before ours: where the driver signals left for theirs (Highway Code 186)
        const exits = info.inArm ? this.rbArmsFrom(rb, info.inArm).filter((a) => a.exit) : [], before = exits[info.decision.exit - 2];
        let sweepP = null;
        if (before) { const nd = this.nodes.get(before.exitNode ?? before.node); if (nd) { sweepP = (rb.angleAt(nd.x, nd.z) - thE) * rb.sense; sweepP = ((sweepP % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); } }
        for (let j = 1; j <= n; j++) {
          const sw = lead + ((sweep - 2 * lead) * j) / n, th = thE + rb.sense * sw, q = rb.pointAt(th, rad);
          const pt = push(q[0], q[1], { way: pieces[pj].way, lane, rb: rb.id });
          if (sweepP != null && !rbMark.prevExitPt && sw >= sweepP) rbMark.prevExitPt = pt;
        }
        rbMark.exitPt = raw[raw.length - 1];
        if (nextP) { // blend out through the exit lane's corner point onto the exit lane, 6 m past the exit node
          const last = raw[raw.length - 1];
          for (const q of bez([last.x, last.z], [Qout.x, Qout.z], [B.x, B.z], 5)) push(q[0], q[1], { way: nextP.way, lane: nextP.lane, rb: null, blend: true });
          nextP.skipTo = sOut;
        }
        pi = pj + 1; continue;
      }
      // ordinary piece: lane points along the way; the join with the next piece is smoothed in 2b
      const next = pieces[pi + 1];
      const nodeOut = next && !next.way.rb ? this.#nodeAtS(p.way, p.s1) : null;
      const startS = p.skipTo ?? p.s0;
      let endS = p.s1;
      if (next && next.way.rb && !p.way.rb) { // approaching a ring: stop 6 m short of the give-way line and let the ring code blend in
        const trim = Math.min(6, Math.abs(p.s1 - startS) * 0.5);
        endS = p.s1 - p.dir * trim; p.cornerPt = lanePt(p, p.s1); p.ringTrim = trim;
      }
      if (next && nodeOut) { // a lane-offset change at the join (two-way to one-way, a lane jump) becomes a short diagonal
        const offA = (this.laneOffset(p.way, p.dir > 0 ? p.lane : -p.lane) + this.splitExtra(p.way, p.s1)) * p.dir, offB = (this.laneOffset(next.way, next.dir > 0 ? next.lane : -next.lane) + this.splitExtra(next.way, next.s0)) * next.dir;
        // (long and gentle on fast roads and where a slip road joins: a lane's width over a few car lengths)
        const fast = next.way.oneway && !next.way.link && (p.way.link || next.way.limit >= 50), run = fast ? 12 + Math.abs(offA - offB) * 12 : 3 + Math.abs(offA - offB) * 3;
        // a slip road joining a main carriageway: OSM joins the two centrelines, so ease across into the
        // main road's lane 1 along the end of the slip road (crossing to the lane and back is a wiggle)
        if (Math.abs(offA - offB) > 0.3 && !next.laneChangeFrom && fast && p.way.link && p.way.oneway && Math.abs(p.s1 - startS) > run) p.endShift = { d: offB - offA, len: run };
        else if (Math.abs(offA - offB) > 0.3 && !next.laneChangeFrom) next.skipTo = next.s0 + next.dir * Math.min(run, Math.abs(next.s1 - next.s0) * 0.5);
      }
      let ss = sampleS(p, startS, endS);
      let first = true;
      if (p.laneChangeFrom) { // short diagonal into the new lane: no way vertices inside it, or the path would double back
        const c0 = this.laneCentre(p.way, p.dir > 0 ? p.laneChangeFrom : -p.laneChangeFrom, startS);
        const c0pt = push(c0.x, c0.z, { way: p.way, dir: p.dir, lane: p.laneChangeFrom, rb: null, sWay: startS, pieceStart: true }); first = false;
        marks.push({ pt: c0pt, kind: 'laneChange', piece: p });
        const dEnd = startS + p.dir * Math.min(25, Math.abs(endS - startS) * 0.5);
        ss = [dEnd, ...ss.filter((s) => (p.dir > 0 ? s > dEnd + 0.05 : s < dEnd - 0.05))];
      }
      let lastPt = null;
      for (const s of ss) {
        const c = lanePt(p, s); lastPt = push(c.x, c.z, { way: p.way, dir: p.dir, lane: p.lane, rb: null, sWay: s, pieceStart: first }); first = false;
        // A junction the route drives straight through, in the middle of its own way: a bigger road
        // crossing here still has priority, so it needs a give-way line of its own. Without this the
        // only line is the next one the route turns at, which on a dual carriageway is the far
        // carriageway's, leaving a car correctly stopped there with its body across this one.
        if (s === startS || s === endS) continue;
        const thru = this.#thruNodeAt(p, s);
        if (thru) marks.push({ pt: lastPt, kind: 'junction', node: thru, inPiece: p, outPiece: p, thru: true });
      }
      if (lastPt && next && nodeOut) { lastPt.corner = true; marks.push({ pt: lastPt, kind: 'junction', node: nodeOut, inPiece: p, outPiece: next }); }
      pi++;
    }
    // 2b. drop the duplicate where two pieces meet at one node, then round off every sharp corner
    const replaced = new Map(); // removed raw point -> the point that stands in for it (marks follow it)
    const cleaned = [];
    // a piece's first point sits on the same node as the previous piece's last one, a few decimetres
    // off because the two ways' directions differ: keep only the first of the pair
    for (const pt of raw) { const q = cleaned[cleaned.length - 1]; if (q && hypot(pt.x - q.x, pt.z - q.z) < (pt.pieceStart && !q.rb && !q.blend ? 2.5 : 0.6)) { replaced.set(pt, q); if (pt.corner) q.corner = true; continue; } cleaned.push(pt); }
    const smooth = this.#smoothCorners(cleaned, replaced, bez);
    const ptOf = (pt) => { while (replaced.has(pt)) pt = replaced.get(pt); return pt; };
    // 3. resample every 1.5 m with cumulative s
    const pts = [], ptsIndex = new Map();
    let s = 0, carry = 0;
    const meta = (r) => ({ way: r.way.id, lane: r.lane, rb: r.rb, dir: r.dir, road: this.#roadMeta(r.way, r.rb, r.dir) });
    for (let i = 0; i < smooth.length; i++) {
      const r = smooth[i];
      if (i === 0) { pts.push({ x: r.x, z: r.z, s: 0, ...meta(r) }); ptsIndex.set(r, 0); continue; }
      const q = smooth[i - 1], L = hypot(r.x - q.x, r.z - q.z);
      if (L < 1e-6) { ptsIndex.set(r, pts.length - 1); continue; }
      let d = 1.5 - carry;
      while (d <= L) { const t = d / L; pts.push({ x: q.x + (r.x - q.x) * t, z: q.z + (r.z - q.z) * t, s: s + d, ...meta(t < 0.5 ? q : r) }); d += 1.5; }
      carry = L - (d - 1.5); s += L; ptsIndex.set(r, pts.length - 1);
      if (i === smooth.length - 1 && (pts[pts.length - 1].s < s - 0.3)) pts.push({ x: r.x, z: r.z, s, ...meta(r) });
    }
    const length = s;
    const sOf = (pt) => { const i = ptsIndex.get(ptOf(pt)); return pts[i == null ? pts.length - 1 : Math.min(i, pts.length - 1)].s; };
    // 4. events
    const events = [];
    const dirWord = (t) => (t < -25 ? 'left' : t > 25 ? 'right' : 'none');
    for (const m of marks) {
      if (m.kind === 'rb') {
        const { info } = m, d = info.decision, rb = info.rb;
        const entryS = sOf(m.pt) + (m.entryOffset || 0); // the approach was trimmed short of the give-way line
        const label = info.outArm ? [info.outArm.refs[0], info.outArm.dest || info.outArm.names[0]].filter(Boolean).join(' ') : '';
        const lastIn = pieces.filter((q) => q.legIdx === info.startLeg - 1).pop();
        const approachLane = Math.min(d.approachLane, lastIn ? lastIn.lane : info.inLeg.wantLane || info.inLeg.lane || 1); // the lane the path is in at the line
        const entryLanes = Math.min(info.inArm?.entryLanes || 1, Math.max(1, this.laneCount(info.inLeg.way, info.inLeg.dir) || 1));
        const laneText = entryLanes >= 2 ? ` Use the ${approachLane === 1 ? 'left-hand' : approachLane >= entryLanes ? 'right-hand' : 'middle'} lane.` : '';
        // exitS: where the path leaves the ring lane; signalLeftS: where it passes the exit before ours
        const exitS = m.exitPt ? sOf(m.exitPt) : entryS, signalLeftS = d.exit <= 1 ? entryS - 30 : m.prevExitPt ? sOf(m.prevExitPt) : Math.max(entryS, exitS - 15);
        events.push({ kind: 'rb', s: entryS, entryS, exitS, signalLeftS, exit: d.exit, dir: d.dir, approachLane, ringLane: d.ringLane, exitLane: d.exitLane, laneChangeS: Math.max(0, entryS - 120), node: info.entryNode.id, rb: rb.id, lanes: rb.lanes, text: `At the roundabout, take the ${ORD[d.exit - 1] || d.exit + 'th'} exit${label ? ', ' + label : ''}.${laneText}` });
        if (info.inLeg) for (const c of this.crossingsByWay.get(info.inLeg.way.id) || []) this.#crossingEvent(events, c, info.inLeg, pts, smooth, ptsIndex);
      } else if (m.kind === 'laneChange') {
        const p = m.piece, sC = sOf(m.pt), toRight = p.lane > p.laneChangeFrom;
        events.push({ kind: 'laneChange', s: sC, toLane: p.lane, by: sC + 40, dir: toRight ? 'right' : 'left', text: `Move into the ${toRight ? 'right' : 'left'}-hand lane.` });
      } else if (m.kind === 'junction') {
        events.push(...this.#junctionEvent(m, sOf(m.pt), pts));
      }
    }
    // crossings along every piece (zebra / signal-controlled)
    for (const p of pieces) for (const c of this.crossingsByWay.get(p.way.id) || []) this.#crossingEvent(events, c, p, pts, smooth, ptsIndex);
    // bends: heading change over 30 m windows between junctions
    this.#bendEvents(events, pts);
    if (signsTarget) events.push({ kind: 'signs', s: 0, target: signsTarget, text: `Follow the signs to ${signsTarget}.` });
    events.push({ kind: end, s: length, text: endText || (end === 'baypark' ? 'Park in a bay.' : 'Pull up on the left when it is safe.') });
    events.sort((a, b) => a.s - b.s);
    // OSM splits one junction into several nodes a few metres apart, each with its own fillet: merge
    // manoeuvre events within 25 m into one, classed by the strongest kind and the total heading change
    const MANOEUVRE = { emerge: 4, cross: 3, turn: 2, bend: 1 };
    // A road we only cross on our way through is a junction in its own right, so its give-way line
    // must not be folded into the next one below: that merge keeps the strongest kind's own line, and
    // it would be the far one, which is the whole bug. Where the next line stops us anyway, though,
    // two lines a few metres apart would only stop us twice at one junction. So it comes down to
    // where a car waiting at that next line would be standing:
    //   before the near edge of the road we cross  -> it never enters it: our line adds nothing, drop it
    //   past it, but not clear of the far edge     -> it stands ON that road: one decision, at OUR line
    //   clear of the far edge, by a car's length   -> it waits between the two: keep both lines
    const STOPS = { lights: 1, rb: 1, emerge: 1, cross: 1, mini: 1 };
    const lineOf = (e) => e.lineS ?? e.entryS ?? e.s; // a mini's s is already its line (node - 4)
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]; if (!e.thru) continue;
      const halfW = e.s - e.lineS - 0.6;               // the crossed road's half width, which set our line
      const next = events.find((q) => STOPS[q.kind] && q !== e && q.s > e.s && q.s - e.s < 25);
      if (!next) continue;
      const line = lineOf(next);
      if (line <= e.s - halfW) { events.splice(i, 1); continue; }
      if (line >= e.s + halfW + 0.5 + 4.6) continue;
      // one decision at our line, which now has two nodes to watch: ours and the one it was taken at.
      // Painted lines (lights, a ring's give-way) cannot be moved, so those keep both lines instead.
      if (next.kind !== 'emerge' && next.kind !== 'cross') continue;
      next.lineS = e.lineS; next.node2 = e.node;
      events.splice(i, 1);
    }
    const clusters = (e) => !!MANOEUVRE[e.kind] && !e.thru;
    const dirOf = (t) => (t < -25 ? 'left' : t > 25 ? 'right' : 'none');
    for (let i = 0; i < events.length; i++) {
      if (!clusters(events[i])) continue;
      const cluster = [events[i]];
      for (let k = i + 1; k < events.length; k++) { const e = events[k]; if (!clusters(e)) continue; if (e.s - cluster[cluster.length - 1].s >= 25) break; cluster.push(e); }
      if (cluster.length < 2) continue;
      const total = this.#turnAt(pts, cluster[0].s, 5, 18, cluster[cluster.length - 1].s);
      const keep = cluster.reduce((b, e) => (MANOEUVRE[e.kind] > MANOEUVRE[b.kind] ? e : b));
      keep.dir = dirOf(total); keep.s = cluster[0].s; if (keep.lineS == null) { const withLine = cluster.find((e) => e.lineS != null); if (withLine) keep.lineS = withLine.lineS; }
      if (keep.kind === 'cross' && keep.dir !== 'none') keep.kind = 'emerge';
      if (keep.kind === 'emerge') keep.text = keep.dir === 'none' ? 'Give way, then go straight ahead.' : `At the end of the road, turn ${keep.dir}.`;
      else if (keep.kind === 'turn') keep.text = `Take the next road on the ${keep.dir}.`;
      else if (keep.kind === 'bend') keep.text = `Follow the road round to the ${keep.dir}.`;
      const drop = (keep.kind === 'turn' || keep.kind === 'bend') && keep.dir === 'none' ? cluster : cluster.filter((e) => e !== keep);
      for (const e of drop) events.splice(events.indexOf(e), 1);
      i = events.indexOf(keep); if (i < 0) i = 0;
    }
    const p0 = pts[0], p3 = pts[Math.min(3, pts.length - 1)];
    const start = p0 ? { x: p0.x, z: p0.z, heading: Math.atan2(p3.x - p0.x, p3.z - p0.z) } : null;
    return { pts, events, length, start };
  }
  /**
   * Round off every sharp corner of a raw lane polyline with a quadratic Bezier, by arc length:
   * neighbouring sharp vertices (a 1 m leg between two ways, OSM's split junctions) form one corner,
   * the control point is where the incoming and outgoing lane lines cross, and the radius grows with
   * the turn (bigger at junction corners). Ring arcs and their blends are already smooth and are
   * left alone. Removed points are recorded in `replaced` so marks can follow them.
   */
  #smoothCorners(P, replaced, bez) {
    const n = P.length; if (n < 3) return P;
    const cum = new Float64Array(n); for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    const turnAt = (i) => norm180(bearingOf(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z) - bearingOf(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const clusters = [];
    for (let i = 1; i < n - 1; i++) {
      if (P[i].rb || P[i].blend || Math.abs(turnAt(i)) < 12) continue;
      const last = clusters[clusters.length - 1];
      if (last && cum[i] - cum[last.i1] < 5) last.i1 = i; else clusters.push({ i0: i, i1: i, rUsed: 0 });
    }
    if (!clusters.length) return P;
    const at = (s) => { // point on P at arc length s
      let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
      if (lo >= n - 1) return [P[n - 1].x, P[n - 1].z];
      const t = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1); return [P[lo].x + (P[lo + 1].x - P[lo].x) * t, P[lo].z + (P[lo + 1].z - P[lo].z) * t];
    };
    const out = []; let cursor = 0;
    clusters.forEach((c, k) => {
      const sA0 = cum[c.i0], sB0 = cum[c.i1];
      const inFrom = at(Math.max(0, sA0 - 4)), outTo = at(Math.min(cum[n - 1], sB0 + 4));
      const dIn = [P[c.i0].x - inFrom[0], P[c.i0].z - inFrom[1]], dOut = [outTo[0] - P[c.i1].x, outTo[1] - P[c.i1].z];
      const turn = Math.abs(norm180(bearingOf(dOut[0], dOut[1]) - bearingOf(dIn[0], dIn[1])));
      const corner = P.slice(c.i0, c.i1 + 1).some((p) => p.corner);
      let r = Math.min(corner ? 9 : 6, 1.5 + (turn / 90) * (corner ? 7 : 4.5));
      if (corner && turn < 35) r = Math.max(r, 14 - turn / 5); // a slight kink at a node (a slip road joining, a lane jump) is eased over a long stretch, not a tight knee
      if (corner && turn < 35 && P[c.i0].way?.link && !P[c.i1].way?.link) r = Math.max(r, 32); // a slip road tapers into the main carriageway
      if (!corner && turn < 25 && (P[c.i0].way?.limit >= 50 || P[c.i0].way?.link)) r = Math.max(r, 12); // a kink in the OSM line of a fast road isn't a corner
      // the fillet bulges 0.25 r sin(turn) towards the inside of the corner: keep that within the room
      // between the lane centre and the inside edge (the kerb on a left turn, the centre line on a right
      // turn off a two-way road), or a car on it mounts the kerb or meets oncoming traffic head on
      const inside = (dIn[0] * dOut[1] - dIn[1] * dOut[0]) < 0 ? 1 : -1; // +1: turning left
      const room = Math.min(this.#room(P[c.i0], inside), this.#room(P[c.i1], inside));
      const sinT = Math.sin(Math.min(turn, 179) / DEG);
      if (sinT > 0.05) r = Math.min(r, Math.max(0.5, (4 * room) / sinT));
      // never eat into the previous fillet, the next corner or the ends of the path
      const prevEnd = k ? cum[clusters[k - 1].i1] + clusters[k - 1].rUsed : 0, nextStart = k + 1 < clusters.length ? cum[clusters[k + 1].i0] : cum[n - 1];
      r = Math.max(0.5, Math.min(r, (sA0 - prevEnd) * 0.5, (nextStart - sB0) * 0.5));
      c.rUsed = r;
      const sA = sA0 - r, sB = sB0 + r, A = at(sA), B = at(sB);
      let Q = null; const den = dIn[0] * dOut[1] - dIn[1] * dOut[0];
      if (Math.abs(den) > 1e-6) { // where the two lane lines cross, if that is ahead of A and not absurdly far
        const t = ((B[0] - A[0]) * dOut[1] - (B[1] - A[1]) * dOut[0]) / den; Q = [A[0] + dIn[0] * t, A[1] + dIn[1] * t];
        if (t < 0 || hypot(Q[0] - A[0], Q[1] - A[1]) > 2.5 * r) Q = null;
      }
      if (!Q) { const m = P[(c.i0 + c.i1) >> 1]; Q = [m.x, m.z]; }
      while (cursor < n && cum[cursor] < sA - 1e-6) out.push(P[cursor++]);
      const mIn = P[c.i0], mOut = P[c.i1], nB = Math.max(4, Math.round(turn / 12));
      const Apt = { x: A[0], z: A[1], way: mIn.way, dir: mIn.dir, lane: mIn.lane, rb: null, blend: true }; out.push(Apt);
      const mid = bez(A, Q, B, nB).map((q, j) => (j < nB / 2 ? { x: q[0], z: q[1], way: mIn.way, dir: mIn.dir, lane: mIn.lane, rb: null, blend: true } : { x: q[0], z: q[1], way: mOut.way, dir: mOut.dir, lane: mOut.lane, rb: null, blend: true }));
      out.push(...mid, { x: B[0], z: B[1], way: mOut.way, dir: mOut.dir, lane: mOut.lane, rb: null, blend: true });
      const middle = mid[mid.length >> 1] || Apt;
      while (cursor < n && cum[cursor] <= sB + 1e-6) replaced.set(P[cursor++], middle);
    });
    while (cursor < n) out.push(P[cursor++]);
    return out;
  }
  /** lateral room (m) from a raw point's lane centre to the edge it must not cross on `side` (+1 left, -1 right) */
  #room(pt, side) {
    const w = pt.way; if (!w || pt.rb || pt.blend) return 4;
    const k = Math.max(1, pt.lane || 1), off = (pt.dir ?? 1) > 0 ? this.laneOffset(w, k) : -this.laneOffset(w, -k); // + = left of travel
    if (side > 0) return Math.max(0.3, w.halfW - off + 0.5);
    return Math.max(0.3, w.oneway ? off + w.halfW + 0.5 : off + 0.1);
  }
  /**
   * Where a two-way road splits into two one-way carriageways, OSM draws both carriageways from the
   * same node, so their centrelines (and lanes on them) touch there and only part as they go: two
   * cars passing there would meet head on. Push each lane left until the two are 2.8 m apart
   * (a car's width and a gap), staying on the drawn carriageway; 0 once they have parted.
   */
  splitExtra(way, s) {
    if (!way.oneway || way.rb) return 0;
    if (way.split === undefined) way.split = [this.#partnerAt(way, 0), this.#partnerAt(way, way.nodes.length - 1)];
    let extra = 0;
    for (const [k, sEnd] of [[0, 0], [1, way.len]]) {
      const pt = way.split[k]; if (!pt || Math.abs(s - sEnd) > 150) continue;
      const p = this.pointAt(way, s);
      let sep = Infinity; for (let i = 0; i < pt.pts.length - 1; i++) { const a = pt.pts[i], b = pt.pts[i + 1], r = projSeg(a[0], a[1], b[0], b[1], p[0], p[1]); sep = Math.min(sep, hypot(p[0] - r[1], p[1] - r[2])); }
      extra = Math.max(extra, (2.8 - sep) / 2);
    }
    return Math.max(0, Math.min(extra, way.halfW - 0.4));
  }
  /** the other carriageway of a split at a way's end vertex i: a one-way way the other way at the same node, with a two-way road there too */
  #partnerAt(way, i) {
    const nid = way.nodes[i]; const node = nid && this.nodes.get(nid); if (!node) return null;
    if (!node.ways.some((r) => !r.way.oneway && !r.way.rb)) return null;
    const j = i === 0 ? 1 : i - 1, out = i === 0; // my direction away from (or into) the node
    const myB = out ? bearingOf(way.pts[j][0] - way.pts[i][0], way.pts[j][1] - way.pts[i][1]) : bearingOf(way.pts[i][0] - way.pts[j][0], way.pts[i][1] - way.pts[j][1]);
    for (const r of node.ways) {
      const w = r.way; if (w === way || !w.oneway || w.rb || w.width > way.width * 1.6) continue;
      const end = r.idx === 0 ? 0 : r.idx === w.pts.length - 1 ? 1 : -1; if (end < 0 || (end === 0) === out) continue; // it must run the other way through the node
      const k = r.idx === 0 ? 1 : r.idx - 1;
      const b = end === 0 ? bearingOf(w.pts[k][0] - w.pts[r.idx][0], w.pts[k][1] - w.pts[r.idx][1]) : bearingOf(w.pts[r.idx][0] - w.pts[k][0], w.pts[r.idx][1] - w.pts[k][1]);
      if (Math.abs(norm180(b - myB)) > 140) return w;
    }
    return null;
  }
  /** what the lessons read off a path point: lanes the way of travel (against the way's direction on a two-way road, its backward lanes) */
  #roadMeta(way, rb, dir = 1) { return { lanes: dir < 0 && !way.oneway ? way.lanesB : way.lanesF, limit: way.limit, nsl: !!way.nsl, dual: !!way.dual || (way.oneway && way.lanesF >= 2), rb: rb || null }; }
  #idxAt(way, s) { // vertex index at arc length s (within 0.2 m), else -1
    const i = this.segAt(way, s); if (Math.abs(way.cum[i] - s) < 0.2) return i; if (Math.abs(way.cum[i + 1] - s) < 0.2) return i + 1; return -1;
  }
  #nodeAtS(way, s) { const i = this.#idxAt(way, s); return i >= 0 && way.nodes[i] ? this.nodes.get(way.nodes[i]) : null; }
  /**
   * The node at arc length s along a piece's own way, if the route passes straight through it and a
   * bigger road crosses there: the one case #junctionEvent never sees, because its marks are only
   * made where the route changes way. Lights, rings and minis decide for themselves, so they are
   * left alone; so is a node our own road merely bends at (no crossing road outranks us).
   */
  #thruNodeAt(piece, s) {
    const node = this.#nodeAtS(piece.way, s);
    if (!node || node.kind !== 'junction' || node.rb || node.mini || node.signals) return null;
    if (node.ways.length < 2) return null;
    const mine = piece.way;
    for (const r of node.ways) if (r.way !== mine && !r.way.rb && r.way.rank > mine.rank) return node;
    return null;
  }
  #legHeading(leg, where) { // bearing of travel at the start or end of a leg
    const sEnd = where === 'end' ? leg.s1 : leg.s0, back = where === 'end' ? -leg.dir * 6 : leg.dir * 6;
    const a = this.pointAt(leg.way, sEnd), b = this.pointAt(leg.way, Math.max(0, Math.min(leg.way.len, sEnd + back)));
    return where === 'end' ? bearingOf(a[0] - b[0], a[1] - b[1]) : bearingOf(b[0] - a[0], b[1] - a[1]);
  }
  /** heading change (degrees, right positive) of the resampled path across s, measured near..far metres either side */
  #turnAt(pts, s, near = 4, far = 14, s2 = s) {
    const at = (q) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].s < q) lo = m + 1; else hi = m; } return pts[Math.max(0, Math.min(pts.length - 1, lo))]; };
    const a = at(s - far), b = at(s - near), c = at(s2 + near), d = at(s2 + far);
    if (b.s - a.s < 2 || d.s - c.s < 2) return 0;
    return norm180(bearingOf(d.x - c.x, d.z - c.z) - bearingOf(b.x - a.x, b.z - a.z));
  }
  /**
   * What the driver has to do at a junction node: a mini, lights, a bend, a merge/diverge on a dual
   * carriageway, emerging from or crossing a bigger through road, or a plain turn. Priority comes from
   * the road classes at the node (a through road is two arms roughly opposite each other, both above
   * ours); OSM give-way/stop nodes count too. Staying on the same road (same ref or name) is never a turn.
   */
  #junctionEvent(m, s, pts) {
    const node = m.node, inW = m.inPiece.way, outW = m.outPiece.way, turn = this.#turnAt(pts, s, 5, 18), dir = (t) => (t < -25 ? 'left' : t > 25 ? 'right' : 'none');
    if (node.mini) return [{ kind: 'mini', s: s - 4, dir: dir(turn), node: node.id, text: `At the mini roundabout, ${dir(turn) === 'none' ? 'go straight ahead' : 'turn ' + dir(turn)}.` }];
    const evs = [];
    if (node.signals) evs.push({ kind: 'lights', s: s - 2, group: this.signalGroup.get(node.id) || `j-${node.id}`, node: node.id, text: null });
    const arms = node.arms().filter((a) => !(a.way === inW && a.dir === -m.inPiece.dir)); // every arm but the one we came in by
    let thruRank = 0, thruWays = [];
    for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i], b = arms[j], rk = Math.min(a.way.rank, b.way.rank);
      if (Math.abs(norm180(a.bearing - b.bearing)) > 140 && rk > inW.rank && rk > thruRank) { thruRank = rk; thruWays = [a.way, b.way]; }
    }
    // driving straight through on our own road: the only thing to decide is whether to give way to the
    // bigger road crossing here, so none of the turn, bend, merge and diverge wording below applies
    if (m.thru) {
      if (!thruRank || thruWays.includes(outW)) return evs;
      const major = thruWays.reduce((b, w) => (w.halfW > b.halfW ? w : b));
      return [{ kind: 'cross', s, dir: 'none', lineS: s - (major.halfW + 0.6), node: node.id, thru: true, text: 'Go straight on across the main road.' }];
    }
    const sameRoad = inW === outW || (inW.ref && inW.ref === outW.ref) || (!inW.ref && !outW.ref && inW.name && inW.name === outW.name);
    const myGiveWay = (node.giveWay || node.stop) && !node.rb;
    let e = null;
    if (inW.link && !outW.link && outW.oneway && (outW.lanesF >= 2 || outW.dual) && Math.abs(turn) < 45) e = { kind: 'merge', s, dir: 'right', endS: s + 80, node: node.id, text: 'Merge onto the carriageway.' };
    else if (!inW.link && outW.link && inW.oneway && (inW.lanesF >= 2 || inW.dual) && Math.abs(turn) < 45) e = { kind: 'diverge', s: s - 100, dir: 'left', lane: 1, node: node.id, text: 'Take the slip road on the left.' };
    else if (arms.length <= 1 && Math.abs(turn) >= 25) e = { kind: 'bend', s, dir: dir(turn), node: node.id, text: `Follow the road round to the ${dir(turn)}.` };
    else if (thruRank || myGiveWay) {
      const major = thruWays.length ? thruWays.reduce((b, w) => (w.halfW > b.halfW ? w : b)) : outW, lineS = s - (major.halfW + 0.6);
      if (thruRank && !thruWays.includes(outW) && Math.abs(turn) < 25) e = { kind: 'cross', s, dir: 'none', lineS, node: node.id, text: 'Go straight on across the main road.' };
      else if (Math.abs(turn) >= 25 || myGiveWay) e = { kind: 'emerge', s, dir: dir(turn), lineS, node: node.id, text: dir(turn) === 'none' ? 'Give way, then go straight ahead.' : `At the end of the road, turn ${dir(turn)}.` };
    } else if (sameRoad) {
      if (Math.abs(turn) >= 50) e = { kind: 'bend', s, dir: dir(turn), node: node.id, text: `Follow the road round to the ${dir(turn)}.` };
    } else if (Math.abs(turn) >= 25) e = { kind: 'turn', s, dir: dir(turn), node: node.id, text: `Take the next road on the ${dir(turn)}.` };
    if (e) evs.push(e);
    return evs; // lights and a turn can share a node
  }
  #crossingEvent(events, c, piece, pts, raw, ptsIndex) {
    const lo = Math.min(piece.s0, piece.s1), hi = Math.max(piece.s0, piece.s1);
    if (c.s < lo || c.s > hi) return;
    const kind = c.type === 'zebra' ? 'zebra' : ['pelican', 'puffin', 'toucan', 'signals'].includes(c.type) ? 'lights' : null;
    if (!kind) return;
    // s along the path: the raw point on this piece nearest the crossing's way arc length (this piece's
    // own points: a route back along the same road passes the crossing again, the other way)
    let best = null, bestD = Infinity;
    for (const r of raw) { if (r.way !== piece.way || r.sWay == null || (r.dir != null && r.dir !== piece.dir) || r.sWay < lo - 1 || r.sWay > hi + 1) continue; const d = Math.abs(r.sWay - c.s); if (d < bestD) { bestD = d; best = r; } }
    if (best == null || bestD > 40) return;
    const s = pts[Math.min(ptsIndex.get(best) ?? pts.length - 1, pts.length - 1)].s - (c.s - best.sWay) * piece.dir;
    if (events.some((e) => e.kind === kind && Math.abs(e.s - (s - 4.5)) < 5)) return;
    const key = String(c.node || Math.round(c.x) + ':' + Math.round(c.z)); // traffic.crossingBusy and the signal group use this name
    events.push({ kind, s: s - 4.5, node: c.node || null, key, x: c.x, z: c.z, group: kind === 'lights' ? `x-${key}` : undefined, crossing: c.type, text: null });
  }
  #bendEvents(events, pts) {
    const W = 20; // points = 30 m
    let lastS = -1e9;
    for (let i = W; i + W < pts.length; i += 4) {
      const a = pts[i - W], b = pts[i], c = pts[i + W];
      if (a.rb || b.rb || c.rb) continue;
      const h1 = bearingOf(b.x - a.x, b.z - a.z), h2 = bearingOf(c.x - b.x, c.z - b.z), turn = norm180(h2 - h1);
      if (Math.abs(turn) < 32) continue;
      if (events.some((e) => ['turn', 'emerge', 'cross', 'mini', 'rb', 'bend', 'merge', 'diverge'].includes(e.kind) && Math.abs(e.s - b.s) < 45)) continue;
      if (b.s - lastS < 60) continue;
      lastS = b.s;
      events.push({ kind: 'bend', s: a.s, dir: turn < 0 ? 'left' : 'right', text: null });
    }
  }
}

/** fetch region.json and build the network */
export async function loadRegion(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`region.json: ${res.status}`);
  return new RoadNet(await res.json());
}
