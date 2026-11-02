// Cars parked along the streets. One deterministic catalogue per way, seeded by the way's id, so
// that everything that has to agree about where a parked car is reads the same list: the tiles
// that draw the bodies and lay the colliders (parked-build.js), the lane paths that traffic and the
// learner's route bend round them (net.js lanePath), the examiner's clearance check (lessons.js)
// and the angled start, which pulls up behind one (lesson-routes.js).
//
// Where they go: the quiet two-way streets -- residential, living streets, unclassified -- with a
// lane each way, 7 m or wider, one side per street (the UK habit is both, but a street parked on
// both sides is a single-file street, and the traffic sim meets head-on). Never within 12 m of a
// junction, a mini roundabout or a crossing (24 m of a zebra's zigzags). Cars face the way the
// traffic on that side flows, tight to the kerb, in the clusters and gaps a real street has.
// (The 12 m in the first paragraph is the kerb the law keeps clear; the catalogue keeps 32, see on().)

const hypot = Math.hypot;
const KERB_IN = 1.0;   // a parked car's centre from the kerb (half a car plus a hand's width)
export const PARKED_W = 1.9, PARKED_L = 4.7;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const STREETS = { residential: [0.2, 0.42], living_street: [0.12, 0.3], unclassified: [0.08, 0.25] };

export class ParkedCatalogue {
  constructor(net) { this.net = net; this.cache = new Map(); this.enabled = !(typeof process !== 'undefined' && process.env?.NO_PARKED); } // NO_PARKED=1: a headless run without them, to tell their effect from everything else's

  /** does this street get parked cars at all? */
  eligible(w) {
    if (!this.enabled || !w || w.oneway || w.rb || w.link || !STREETS[w.cls]) return false;
    if ((w.lanesF || 1) !== 1 || (w.lanesB || 1) !== 1) return false;
    // 7 m and up (which is every residential street once net.js has widened the tight ones): a car
    // out round a parked one sits on the centre line, so it is the give-way at parked cars (traffic.js
    // and the bot) that keeps a meeting from being head on, not the width
    return w.halfW >= 3.45 && (w.limit || 30) <= 30 && w.len >= 36;
  }

  /** every parked car on a way, sorted by s: { s, len, side, x, z, yaw, lat }; side +1 is the kerb on
   *  the left of travel in the way's own direction, -1 the other kerb */
  on(way) {
    let list = this.cache.get(way.id);
    if (list) return list;
    list = [];
    this.cache.set(way.id, list);
    if (!this.eligible(way)) return list;
    const net = this.net, r = mulberry32(way.id * 2654435761 + 7);
    // one side for the whole road, not per OSM way: a road is several ways between its junctions,
    // and a side that swapped at each put the two directions' move-outs opposite each other, so
    // both gave way to both and eleven cars stood in a ring
    let sideKey = way.id;
    if (way.name) { sideKey = 0; for (let i = 0; i < way.name.length; i++) sideKey = (sideKey * 31 + way.name.charCodeAt(i)) >>> 0; }
    const side = mulberry32(sideKey * 2654435761 + 3)() < 0.5 ? 1 : -1;
    // thinned on a small map: the sim puts the same eighty cars on Driveuk's 56 ways as on Kent's
    // 4,216, and a street with that much through traffic is not one people park along (every
    // route there jammed solid at the first run of them)
    const dens = Math.min(1, net.ways.size / 500);
    const [lo, hi] = STREETS[way.cls], occ = (lo + r() * (hi - lo)) * dens;
    // the stretches nothing may park on
    const blocks = [];
    const block = (s, d) => blocks.push([s - d, s + d]);
    way.nodes.forEach((id, i) => {
      const n = net.nodes.get(id);
      if (!n) return;
      // (a node lists one entry per way through it, so two entries is a junction: a crossroads of
      // two through roads has exactly two)
      // 32 m from a junction: the path moves out over the 16 m before a run, and a car waiting short
      // of the run for oncoming traffic stops 1.5 m before that -- with 12 m it stopped in the
      // junction mouth, and Driveuk's grid locked up behind it
      if (i === 0 || i === way.nodes.length - 1 || n.ways.length >= 2 || n.mini || n.signals) block(way.cum[i], 32);
      if (n.crossing) block(way.cum[i], n.crossing === 'zebra' ? 36 : 24);
    });
    for (const c of net.crossingsByWay?.get(way.id) || []) block(c.s, c.type === 'zebra' ? 36 : 24);
    const blocked = (a, b) => blocks.some(([x, y]) => a < y && b > x);
    const lat = side * (way.halfW - KERB_IN);
    // in clusters of one to three with a clear 12 m or more between clusters: a car out round a
    // cluster is on the centre line for a few seconds, and meets the other way at the gaps, as a
    // real street works; one long run would be single file for its whole length
    let s = 2 + r() * 6, inCluster = 0, clusterMax = 1 + Math.floor(r() * 3);
    while (s + PARKED_L < way.len) {
      const len = PARKED_L + (r() - 0.5) * 0.8;
      if (!blocked(s, s + len)) {
        if (r() < occ) {
          const mid = s + len / 2, p = net.pointAt(way, mid), d = net.dirAt(way, mid);
          const x = p[0] + d[1] * lat, z = p[1] - d[0] * lat; // leftOf(d) = (dz, -dx)
          list.push({ way: way.id, s: mid, len, side, x, z, yaw: Math.atan2(d[0] * side, d[1] * side), lat });
          if (++inCluster >= clusterMax) { inCluster = 0; clusterMax = 1 + Math.floor(r() * 3); s += len + 12 + r() * 14; }
          else s += len + 0.5 + r() * 0.9;
          continue;
        }
        if (inCluster) { inCluster = 0; clusterMax = 1 + Math.floor(r() * 3); s += len + 12 + r() * 14; }
        else s += len + 1 + r() * 3;
      } else s += 1.5;
    }
    return list;
  }

  /** the cars a vehicle travelling `dir` along the way passes on its left, in travel order */
  passing(way, dir) {
    const list = this.on(way).filter((c) => c.side === dir);
    return dir > 0 ? list : list.slice().reverse();
  }

  /** runs of parked cars on one side, as [s0, s1] spans in the way's own s, clusters closer than
   *  `join` metres merged into one so a path bends out once round the lot */
  runs(way, dir, join = 7) {
    const out = [];
    for (const c of this.on(way)) {
      if (c.side !== dir) continue;
      const a = c.s - c.len / 2, b = c.s + c.len / 2, last = out[out.length - 1];
      if (last && a - last[1] < join) last[1] = b; else out.push([a, b]);
    }
    return out;
  }

  /** parked cars within r m of a point (cars on any street round it) */
  near(x, z, r) {
    const net = this.net, out = [], seen = new Set();
    const rings = Math.ceil((r + 6) / net.grid.cell);
    for (let k = 0; k <= rings; k++) {
      net.grid.ring(x, z, k, (items) => {
        for (const { way } of items) {
          if (seen.has(way.id)) continue;
          seen.add(way.id);
          for (const c of this.on(way)) if (hypot(c.x - x, c.z - z) <= r) out.push(c);
        }
      });
    }
    return out;
  }

  /** every parked car with its centre inside a rectangle (a tile) */
  inRect(minX, minZ, maxX, maxZ) {
    const out = [], seen = new Set(), net = this.net;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, half = Math.max(maxX - minX, maxZ - minZ) / 2;
    const rings = Math.ceil((half + 60) / net.grid.cell);
    for (let k = 0; k <= rings; k++) {
      net.grid.ring(cx, cz, k, (items) => {
        for (const { way } of items) {
          if (seen.has(way.id)) continue;
          seen.add(way.id);
          for (const c of this.on(way)) if (c.x >= minX && c.x < maxX && c.z >= minZ && c.z < maxZ) out.push(c);
        }
      });
    }
    return out;
  }
}
