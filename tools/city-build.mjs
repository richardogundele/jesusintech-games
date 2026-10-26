#!/usr/bin/env node
// Builds the fictional teaching city into public/assets/driveuk/region.json.
//
//   node tools/city-build.mjs [--out public/assets/driveuk]
//
// The real cities (tools/region-data.mjs) are whatever OpenStreetMap happens to contain, so a
// learner may never meet a box junction or a contraflow. This city is authored instead: every
// district is laid down deliberately so the set of roads, junctions and signs a learner has to
// meet is a decision rather than an accident. It emits the SAME schema the OSM pipeline does, so
// src/worlds/region.js, the road renderer, the traffic and the examiner all work unchanged.
//
// Local metres, x east, z south of the city centre. Left-hand traffic, mph.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') === false ? argv[++i] : true;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt.out || path.join(REPO, 'public/assets/driveuk'));

const r1 = (v) => Math.round(v * 10) / 10;

/** where segment a0-a1 crosses b0-b1, as the fraction along each; null if they miss or are parallel */
function segHit(a0, a1, b0, b1, eps) {
  const rx = a1[0] - a0[0], rz = a1[1] - a0[1], sx = b1[0] - b0[0], sz = b1[1] - b0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * sz - (b0[1] - a0[1]) * sx) / den;
  const u = ((b0[0] - a0[0]) * rz - (b0[1] - a0[1]) * rx) / den;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { t, u };
}

const push = (map, i, t) => { if (!map.has(i)) map.set(i, []); map.get(i).push(t); };

const DEG = 180 / Math.PI;
/** the engine's compass: 0 = north (-z), 90 = east (+x) */
const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * DEG) % 360 + 360) % 360;
/** the angle round a ring circle whose outward direction has this bearing */
const angleForBearing = (b) => Math.atan2(-Math.cos(b / DEG), Math.sin(b / DEG));

/** Road classes as the engine understands them, with the defaults a UK road of that class carries. */
const CLASS = {
  motorway:    { limit: 70, nsl: true,  pave: false, lanes: 3, width: 11.0 },
  trunk:       { limit: 70, nsl: true,  pave: false, lanes: 2, width: 7.3 },
  primary:     { limit: 40, nsl: false, pave: true,  lanes: 1, width: 7.3 },
  secondary:   { limit: 30, nsl: false, pave: true,  lanes: 1, width: 7.3 },
  tertiary:    { limit: 30, nsl: false, pave: true,  lanes: 1, width: 6.5 },
  unclassified:{ limit: 60, nsl: true,  pave: false, lanes: 1, width: 6.5 },
  residential: { limit: 30, nsl: false, pave: true,  lanes: 1, width: 7.0 },
  living_street:{ limit: 20, nsl: false, pave: true, lanes: 1, width: 6.0 },
  service:     { limit: 20, nsl: false, pave: true,  lanes: 1, width: 5.0 },
};

class City {
  constructor() {
    this.nodes = new Map();     // id -> record
    this.at = new Map();        // "x,z" -> id, so two roads meeting share one node
    this.roads = [];            // authored polylines, before planarising
    this.ways = [];
    this.nextNode = 1;
    this.nextWay = 1;
    this.nextRb = 1;
    this.places = [];
    this.landmarks = [];
    this.marks = [];
    this.rings = [];
    this.rbs = [];
    this.features = [];
    this.crossings = [];
    this.calming = [];
    this.minis = [];
  }

  /** the node at (x, z), creating it if this is the first road to reach the spot */
  node(x, z) {
    const key = `${Math.round(x * 2)},${Math.round(z * 2)}`; // snap to 0.5 m
    let id = this.at.get(key);
    if (id == null) {
      id = this.nextNode++;
      this.nodes.set(id, { x: r1(x), z: r1(z), ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false });
      this.at.set(key, id);
    }
    return id;
  }

  /** author a road along pts ([[x, z], ...]); opts override the class defaults */
  road(cls, pts, opts = {}) {
    const d = CLASS[cls];
    if (!d) throw new Error(`unknown class ${cls}`);
    if (pts.length < 2) throw new Error('a road needs two points');
    this.roads.push({ cls, d, pts: pts.map(([x, z]) => [x, z]), opts });
    return this.roads.length - 1;
  }

  /**
   * Split every road at the points where it crosses another, so the two share a node and the
   * engine sees a junction. Without this a street laid across another just passes through it:
   * the renderer draws a crossroads but no car can turn and no route can be found.
   * Roads on different layers (a bridge over a road) are left alone - they do not meet.
   */
  planarise() {
    const extra = this.roads.map(() => new Map()); // road index -> (segment index -> [t, ...])
    const eps = 1e-6;
    for (let a = 0; a < this.roads.length; a++) {
      for (let b = a + 1; b < this.roads.length; b++) {
        if ((this.roads[a].opts.layer ?? 0) !== (this.roads[b].opts.layer ?? 0)) continue;
        const A = this.roads[a].pts, B = this.roads[b].pts;
        for (let i = 0; i < A.length - 1; i++) {
          for (let j = 0; j < B.length - 1; j++) {
            const hit = segHit(A[i], A[i + 1], B[j], B[j + 1], eps);
            if (!hit) continue;
            if (hit.t > eps && hit.t < 1 - eps) push(extra[a], i, hit.t);
            if (hit.u > eps && hit.u < 1 - eps) push(extra[b], j, hit.u);
          }
        }
      }
    }
    for (let a = 0; a < this.roads.length; a++) {
      const A = this.roads[a].pts, cuts = extra[a];
      if (!cuts.size) continue;
      const out = [];
      for (let i = 0; i < A.length - 1; i++) {
        out.push(A[i]);
        for (const t of (cuts.get(i) || []).sort((p, q) => p - q)) {
          out.push([A[i][0] + (A[i + 1][0] - A[i][0]) * t, A[i][1] + (A[i + 1][1] - A[i][1]) * t]);
        }
      }
      out.push(A[A.length - 1]);
      this.roads[a].pts = out;
    }
  }

  /** turn the authored roads into ways and nodes */
  build() {
    this.planarise();
    // the rings are laid after planarising: they meet their arms exactly at a shared point, and a
    // ring must not be cut by anything that merely passes near it
    for (const ring of this.rings) {
      this.roads.push({ cls: ring.cls, d: CLASS[ring.cls], pts: ring.pts,
        opts: { name: ring.name, oneway: true, lanesF: ring.lanes, limit: ring.limit, pave: true, width: r1(ring.lanes * ring.laneW), rb: ring.id } });
      ring.wayIndex = this.roads.length - 1;
    }
    for (const { cls, d, pts, opts } of this.roads) {
      const id = this.nextWay++;
      const oneway = !!opts.oneway;
      const lanesF = opts.lanesF ?? d.lanes;
      const lanesB = oneway ? 0 : (opts.lanesB ?? d.lanes);
      const nodes = pts.map(([x, z]) => this.node(x, z));
      for (const n of nodes) { const rec = this.nodes.get(n); if (!rec.ways.includes(id)) rec.ways.push(id); }
      this.ways.push({
        id, name: opts.name ?? null, ref: opts.ref ?? null, cls,
        limit: opts.limit ?? d.limit, nsl: opts.nsl ?? (opts.limit ? false : d.nsl),
        oneway, lanesF, lanesB, lanesSrc: 'tag', rb: opts.rb ?? null, dual: !!opts.dual, link: !!opts.link,
        bridge: !!opts.bridge, tunnel: !!opts.tunnel, layer: opts.layer ?? 0,
        width: opts.width ?? (oneway ? r1(lanesF * 3.65) : d.width),
        pave: opts.pave ?? d.pave, rural: opts.rural ?? !(opts.pave ?? d.pave),
        turnLanes: opts.turnLanes ?? null,
        ...(opts.dress ? { dress: opts.dress } : {}), // how scenery.js dresses this street
        pts: pts.map(([x, z]) => [r1(x), r1(z)]), nodes,
      });
    }
    for (const { x, z, what } of this.marks) {
      const id = this.at.get(`${Math.round(x * 2)},${Math.round(z * 2)}`);
      if (id != null) Object.assign(this.nodes.get(id), what);
      else console.warn(`no junction at ${x},${z} to mark`);
    }
    this.#finishRoundabouts();
    this.#finishFeatures();
  }

  #wayOf(roadIndex) { return this.ways[roadIndex]; }

  /** fill in each roundabout's ring and arm records now the ways have ids */
  #finishRoundabouts() {
    for (const rb of this.rbs) {
      const ring = this.rings.find((r) => r.id === rb.id);
      const ringWay = this.#wayOf(ring.wayIndex);
      rb.ringWays = [ringWay.id];
      rb.ringNodes = [...new Set(ringWay.nodes)];
      rb.lanesSrc = 'tag';
      rb.island = r1(Math.max(1.5, rb.r - rb.lanes * rb.laneW));
      rb.sense = 1;          // UK: clockwise from above
      rb.signals = false;
      rb.mini = false;
      rb.arms = rb.arms.map((a) => {
        const w = this.#wayOf(a.wayIndex);
        const node = this.at.get(`${Math.round(a.at[0] * 2)},${Math.round(a.at[1] * 2)}`);
        return {
          bearing: r1(bearingOf(Math.cos(a.th), Math.sin(a.th))),
          node, exitNode: node, entry: true, exit: true,
          entryWays: [w.id], exitWays: [w.id], entryLanes: w.lanesF, exitLanes: w.lanesB || w.lanesF,
          names: w.name ? [w.name] : [], refs: w.ref ? [w.ref] : [], cls: w.cls, signed: false,
          dest: [w.ref, w.name].filter(Boolean).join(' ') || null,
        };
      });
      delete rb.laneW_;
    }
  }

  /** place the crossings and humps, which need a way id and a distance along it */
  #finishFeatures() {
    for (const f of this.features) {
      const w = this.ways.find((v) => v.name === f.name);
      if (!w) { console.warn(`no road named ${f.name} for a ${f.kind}`); continue; }
      let len = 0; const cum = [0];
      for (let i = 1; i < w.pts.length; i++) { len += Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]); cum.push(len); }
      const s = len * f.frac;
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const x = r1(w.pts[i - 1][0] + (w.pts[i][0] - w.pts[i - 1][0]) * t);
      const z = r1(w.pts[i - 1][1] + (w.pts[i][1] - w.pts[i - 1][1]) * t);
      if (f.kind === 'crossing') this.crossings.push({ node: w.nodes[i - 1], x, z, type: f.type, way: w.id, s: r1(s) });
      else this.calming.push({ x, z, kind: f.type, way: w.id, s: r1(s) });
    }
  }

  /** mark the junction at (x, z) as signalised, a stop, a give way or a mini roundabout */
  mark(x, z, what) { this.marks.push({ x, z, what }); }

  /**
   * A roundabout: a one-way ring with an arm per entry. Arms are given by the compass bearing of
   * the road leading away from the ring, and the ring runs in the UK sense (+1: clockwise from
   * above). Returns the outer end of each arm so the road beyond can be drawn from it.
   */
  roundabout({ x, z, r, lanes = 1, limit = 30, cls = 'primary', name, arms }) {
    const id = `rb${this.nextRb++}`;
    const laneW = lanes > 1 ? 4 : 5.5;
    const placed = arms.map((a) => {
      const th = angleForBearing(a.bearing);
      return { ...a, th, at: [x + Math.cos(th) * r, z + Math.sin(th) * r], end: [x + Math.cos(th) * (r + (a.len ?? 120)), z + Math.sin(th) * (r + (a.len ?? 120))] };
    }).sort((p, q) => p.th - q.th);

    // the ring, drawn through each arm's node in circulation order and closed back on itself
    const ring = [];
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i], b = placed[(i + 1) % placed.length];
      let sweep = b.th - a.th; if (sweep <= 0) sweep += Math.PI * 2;
      const steps = Math.max(2, Math.ceil(sweep / 0.25));
      for (let k = 0; k < steps; k++) { const t = a.th + sweep * (k / steps); ring.push([x + Math.cos(t) * r, z + Math.sin(t) * r]); }
    }
    ring.push(ring[0].slice()); // closed
    this.rings.push({ id, pts: ring, lanes, laneW, limit, cls, name });

    for (const a of placed) {
      this.road(a.cls ?? cls, [a.at, a.end], { name: a.name, ref: a.ref, limit: a.limit ?? limit, lanes: a.lanes, pave: true });
      a.wayIndex = this.roads.length - 1;
    }
    this.rbs.push({ id, name, x, z, r, lanes, laneW, limit, cls, arms: placed });
    return Object.fromEntries(placed.map((a) => [a.key ?? a.name, a.end]));
  }

  /** a pedestrian crossing a fraction of the way along the named road */
  crossing(name, frac, type = 'zebra') { this.features.push({ kind: 'crossing', name, frac, type }); }
  /** a speed hump or table a fraction of the way along the named road */
  hump(name, frac, kind = 'hump') { this.features.push({ kind: 'calming', name, frac, type: kind }); }

  place(name, x, z, r, rank) { this.places.push({ name, x: r1(x), z: r1(z), r, rank }); }

  json({ name, bounds, home, airfield, testCentre }) {
    const step = 100;
    const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
    // a gently rolling floor so the city is not a billiard table: two long wavelengths, no hills
    // steep enough to hide a junction or upset the drape
    const heights = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * step, z = bounds.minZ + j * step;
      heights.push(r1(3.2 * Math.sin(x / 900) * Math.cos(z / 1100) + 1.4 * Math.sin((x + z) / 520)));
    }
    return {
      attribution: 'Fictional road network authored for The Dream Life. No OpenStreetMap data.',
      region: 'driveuk', name, idNote: 'node ids are small integers assigned by tools/city-build.mjs',
      origin: { lat0: 52.5, lon0: -1.5, mPerDegLat: 111290, mPerDegLon: 67800 },
      bounds,
      ways: this.ways,
      nodes: Object.fromEntries(this.nodes),
      roundabouts: this.rbs, minis: this.minis, signals: [], crossings: this.crossings,
      calming: this.calming, levelCrossings: [],
      railways: [], rivers: [], coastline: [], sea: null, buildings: [], landuse: [],
      landmarks: this.landmarks,
      places: this.places,
      testCentres: [testCentre],
      home, airfield,
      terrain: { source: 'authored', step, x0: bounds.minX, z0: bounds.minZ, nx, nz, base: 28, min: Math.min(...heights), max: Math.max(...heights), heights },
    };
  }
}

// ---------- the city ----------

const C = new City();
const HALF = 1600;

// 1. The centre: a tight grid of two-way streets at 20, the sort of place that throws a give-way
//    junction at you every few seconds. Centred on 0 so the gates meet it square.
const GS = 160, GN = 7, G0 = -((GN - 1) / 2) * GS; // -480 .. 480 through 0
const NS = ['Albion', 'Bridge', 'Castle', 'Dover', 'Elm', 'Foundry', 'Granary'];
const EW = ['Kiln', 'Linden', 'Market', 'North', 'Orchard', 'Priory', 'Quay'];
const G1 = G0 + (GN - 1) * GS;
for (let i = 0; i < GN; i++) C.road('residential', [[G0 + i * GS, G0], [G0 + i * GS, G1]], { name: `${NS[i]} Street`, limit: 20, dress: 'terraced' });
for (let j = 0; j < GN; j++) {
  const z = G0 + j * GS;
  // the middle row is the high street: wider, 30, and it runs clear across the city
  if (j === (GN - 1) / 2) C.road('secondary', [[-HALF + 100, z], [HALF - 100, z]], { name: 'High Street', ref: 'A41', limit: 30, dress: 'high-street' });
  else C.road('residential', [[G0, z], [G1, z]], { name: `${EW[j]} Road`, limit: 20, dress: 'terraced' });
}
// signals where the high street meets the two busiest cross streets, give way elsewhere in the grid
for (const i of [2, 4]) C.mark(G0 + i * GS, 0, { signals: true });
for (const i of [1, 5]) C.mark(G0 + i * GS, G0 + 2 * GS, { giveWay: true });
C.place('City Centre', 0, 0, 950, 1); // r >= 900 makes it a town centre: double yellows on the paved roads round it

// 2. The ring road: a 40 primary box round the centre, the first fast road a learner meets, with
//    a roundabout at three of its corners-of-entry and a signalised crossroads at the fourth, so
//    both junction types turn up on the same lap.
const R = 1050, ARM = 130;
const rbN = C.roundabout({ x: 0, z: -R, r: 20, lanes: 2, limit: 40, name: 'Northgate Roundabout', arms: [
  { key: 'bypass', bearing: 0, name: 'Northgate Bypass', ref: 'A2(M)', cls: 'trunk', limit: 40, len: ARM },
  { key: 'east', bearing: 90, name: 'Northern Way', ref: 'A1', limit: 40, len: ARM },
  { key: 'gate', bearing: 180, name: 'North Gate', cls: 'tertiary', limit: 30, len: ARM },
  { key: 'west', bearing: 270, name: 'Northern Way', ref: 'A1', limit: 40, len: ARM },
] });
const rbE = C.roundabout({ x: R, z: 0, r: 18, lanes: 1, limit: 40, name: 'Eastgate Roundabout', arms: [
  { key: 'north', bearing: 0, name: 'Eastern Way', ref: 'A1', limit: 40, len: ARM },
  { key: 'lane', bearing: 90, name: 'Hollow Lane', cls: 'unclassified', len: ARM },
  { key: 'south', bearing: 180, name: 'Eastern Way', ref: 'A1', limit: 40, len: ARM },
  { key: 'gate', bearing: 270, name: 'East Gate', cls: 'tertiary', limit: 30, len: ARM },
] });
const rbS = C.roundabout({ x: 0, z: R, r: 22, lanes: 2, limit: 40, name: 'Southgate Roundabout', arms: [
  { key: 'gate', bearing: 0, name: 'South Gate', cls: 'tertiary', limit: 30, len: ARM },
  { key: 'east', bearing: 90, name: 'Southern Way', ref: 'A1', limit: 40, len: ARM },
  { key: 'suburb', bearing: 180, name: 'Southfield Road', cls: 'tertiary', limit: 30, len: ARM },
  { key: 'west', bearing: 270, name: 'Southern Way', ref: 'A1', limit: 40, len: ARM },
] });
// the ring between the roundabouts, and round to the signalised crossroads in the west
C.road('primary', [rbN.west, [-R, -R], [-R, 0]], { name: 'Northern Way', ref: 'A1', limit: 40 });
C.road('primary', [rbN.east, [R, -R], rbE.north], { name: 'Northern Way', ref: 'A1', limit: 40 });
C.road('primary', [rbE.south, [R, R], rbS.east], { name: 'Eastern Way', ref: 'A1', limit: 40 });
C.road('primary', [rbS.west, [-R, R], [-R, 0]], { name: 'Southern Way', ref: 'A1', limit: 40 });
// the gates joining the grid to the ring
C.road('tertiary', [rbN.gate, [0, G0]], { name: 'North Gate', limit: 30 });
C.road('tertiary', [[0, G1], rbS.gate], { name: 'South Gate', limit: 30 });
C.road('tertiary', [[-R, 0], [G0, 0]], { name: 'West Gate', limit: 30 });
C.road('tertiary', [[G1, 0], rbE.gate], { name: 'East Gate', limit: 30 });
C.mark(-R, 0, { signals: true }); // the one set of lights on the ring

// 3. The suburb: curving avenues and the closes off them, the quiet streets a test uses for
//    manoeuvres. The closes are laid straight across the avenues and planarising ties them in.
for (let k = 0; k < 4; k++) {
  const z = R + 200 + k * 150, pts = [];
  for (let i = 0; i <= 10; i++) pts.push([-700 + i * 150, z + 40 * Math.sin(i / 2.2 + k)]);
  C.road('residential', pts, { name: `${['Ashfield', 'Beechwood', 'Cedar', 'Dalegarth'][k]} Avenue`, limit: 20 });
}
for (let k = 0; k < 5; k++) {
  const x = -550 + k * 260;
  C.road('service', [[x, R + 120], [x, R + 200 + 3 * 150 + 90]], { name: `${['Alder', 'Birch', 'Chestnut', 'Damson', 'Elder'][k]} Close`, limit: 20, pave: true });
}
// the feeder from the southern roundabout down into the suburb
C.road('tertiary', [rbS.suburb, [0, R + 120], [-290, R + 160], [-290, R + 200]], { name: 'Southfield Road', limit: 30 });
C.place('Southfield', -100, R + 430, 700, 2);
// a mini roundabout where the suburb feeder meets the first avenue
C.mark(-290, R + 200, { mini: true });
C.minis.push({ node: null, x: -290, z: r1(R + 200), arms: 3, sense: 1, name: null });
// humps along the avenues: the quiet 20 streets a test uses for manoeuvres
for (const n of ['Ashfield Avenue', 'Beechwood Avenue', 'Cedar Avenue']) for (const f of [0.3, 0.55, 0.8]) C.hump(n, f, 'hump');

// 4. The country edge: an unlit national-speed-limit lane out past the ring, hedges and bends
const lane = [rbE.lane];
for (let i = 1; i <= 13; i++) lane.push([R + ARM + i * 90, 150 * Math.sin(i / 3)]);
C.road('unclassified', lane, { name: 'Hollow Lane' });
C.place('Hollow End', R + 900, 60, 500, 3);

// 5. The bypass: a 70 dual carriageway running north off the roundabout, two halves 14 m apart
for (const side of [-7, 7]) {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push([side, -R - ARM - i * 160]);
  pts.unshift([side, -R - ARM + 10]);
  // the near half runs away from the city, the far half back towards it
  C.road('trunk', side < 0 ? pts : pts.slice().reverse(), { name: 'Northgate Bypass', ref: 'A2(M)', oneway: true, dual: true, lanesF: 2, limit: 70, width: 7.3 });
}
// a lane bridging over the bypass: layer 1 so planarising leaves it alone and the deck is built
C.road('unclassified', [[-430, -R - 700], [-120, -R - 700], [120, -R - 700], [430, -R - 700]],
  { name: 'Rookery Lane', bridge: true, layer: 1, limit: 40 });

// 6. The old quarter: narrow one-way lanes west of the grid, the Canterbury end of the city
const Q = -760;
C.road('residential', [[Q, -300], [Q, -120], [Q + 40, 60], [Q, 240]], { name: 'Friars Lane', oneway: true, limit: 20, width: 4.6 });
C.road('residential', [[Q - 160, 240], [Q - 120, 60], [Q - 160, -120], [Q - 160, -300]], { name: 'Mint Yard', oneway: true, limit: 20, width: 4.6 });
C.road('residential', [[Q - 230, -300], [Q + 90, -300]], { name: 'Northgate Street', limit: 20, width: 5.2 });
C.road('residential', [[Q - 230, 240], [Q + 90, 240]], { name: 'Watling Street', limit: 20, width: 5.2 });
C.road('tertiary', [[G0, 0], [Q + 40, 60]], { name: 'West Gate', limit: 30 });
C.place('Old Quarter', Q - 60, -30, 400, 2);

// 7. Crossings: a zebra on the high street, a puffin by the centre, a school hump
C.crossing('High Street', 0.44, 'zebra');
C.crossing('High Street', 0.56, 'puffin');
C.crossing('Market Road', 0.5, 'zebra');
C.landmarks.push({ name: 'Drive UK Test Centre', cat: 'civic', x: 0, z: 620, brand: null });
C.landmarks.push({ name: 'City Hospital', cat: 'hospital', x: 620, z: -420, brand: null });

C.build();

const bounds = { minX: -HALF - 400, maxX: HALF + 900, minZ: -HALF - 900, maxZ: HALF + 900 };
const region = C.json({
  name: 'Drive UK',
  bounds,
  home: { x: -300, z: R + 700 },
  airfield: { x: 1200, z: 1200 },
  testCentre: { name: 'Drive UK Test Centre', x: 0, z: 620, address: 'South Gate, Drive UK' },
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'region.json'), JSON.stringify(region));
console.log(`${path.relative(REPO, path.join(OUT, 'region.json'))}: ${region.ways.length} ways, ${Object.keys(region.nodes).length} nodes, ${region.places.length} places`);
const junctions = [...C.nodes.values()].filter((n) => n.ways.length > 1).length;
console.log(`junctions ${junctions}, signalised ${[...C.nodes.values()].filter((n) => n.signals).length}, bounds ${bounds.minX}..${bounds.maxX} x ${bounds.minZ}..${bounds.maxZ}`);
console.log(`roundabouts ${region.roundabouts.length} (${region.roundabouts.map((r) => `${r.name} ${r.arms.length} arms, ${r.lanes} lane`).join('; ')})`);
console.log(`minis ${region.minis.length}, crossings ${region.crossings.length}, calming ${region.calming.length}, bridges ${region.ways.filter((w) => w.bridge).length}`);
const byCls = {}; for (const w of region.ways) byCls[w.cls] = (byCls[w.cls] || 0) + 1;
console.log('ways by class:', JSON.stringify(byCls));
