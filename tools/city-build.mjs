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
    this.places = [];
    this.marks = [];
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
        oneway, lanesF, lanesB, lanesSrc: 'tag', rb: null, dual: !!opts.dual, link: !!opts.link,
        bridge: !!opts.bridge, tunnel: !!opts.tunnel, layer: opts.layer ?? 0,
        width: opts.width ?? (oneway ? r1(lanesF * 3.65) : d.width),
        pave: opts.pave ?? d.pave, rural: opts.rural ?? !(opts.pave ?? d.pave),
        turnLanes: opts.turnLanes ?? null,
        pts: pts.map(([x, z]) => [r1(x), r1(z)]), nodes,
      });
    }
    for (const { x, z, what } of this.marks) {
      const id = this.at.get(`${Math.round(x * 2)},${Math.round(z * 2)}`);
      if (id != null) Object.assign(this.nodes.get(id), what);
      else console.warn(`no junction at ${x},${z} to mark`);
    }
  }

  /** mark the junction at (x, z) as signalised, a stop, a give way or a mini roundabout */
  mark(x, z, what) { this.marks.push({ x, z, what }); }

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
      roundabouts: [], minis: [], signals: [], crossings: [], calming: [], levelCrossings: [],
      railways: [], rivers: [], coastline: [], sea: null, buildings: [], landuse: [], landmarks: [],
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
for (let i = 0; i < GN; i++) C.road('residential', [[G0 + i * GS, G0], [G0 + i * GS, G1]], { name: `${NS[i]} Street`, limit: 20 });
for (let j = 0; j < GN; j++) {
  const z = G0 + j * GS;
  // the middle row is the high street: wider, 30, and it runs clear across the city
  if (j === (GN - 1) / 2) C.road('secondary', [[-HALF + 100, z], [HALF - 100, z]], { name: 'High Street', ref: 'A41', limit: 30 });
  else C.road('residential', [[G0, z], [G1, z]], { name: `${EW[j]} Road`, limit: 20 });
}
// signals where the high street meets the two busiest cross streets, give way elsewhere in the grid
for (const i of [2, 4]) C.mark(G0 + i * GS, 0, { signals: true });
for (const i of [1, 5]) C.mark(G0 + i * GS, G0 + 2 * GS, { giveWay: true });
C.place('City Centre', 0, 0, 620, 1);

// 2. The ring road: a 40 primary box round the centre, the first fast road a learner meets.
//    Its north side carries the points where the bypass halves come down to it.
const R = 1050;
C.road('primary', [[-R, -R], [-7, -R], [7, -R], [R, -R]], { name: 'Northern Way', ref: 'A1', limit: 40 });
C.road('primary', [[R, -R], [R, R]], { name: 'Eastern Way', ref: 'A1', limit: 40 });
C.road('primary', [[R, R], [-R, R]], { name: 'Southern Way', ref: 'A1', limit: 40 });
C.road('primary', [[-R, R], [-R, -R]], { name: 'Western Way', ref: 'A1', limit: 40 });
// the four gates joining the grid to the ring: planarising splits both at the crossings
C.road('tertiary', [[0, -R], [0, G0]], { name: 'North Gate', limit: 30 });
C.road('tertiary', [[0, G1], [0, R]], { name: 'South Gate', limit: 30 });
C.road('tertiary', [[-R, 0], [G0, 0]], { name: 'West Gate', limit: 30 });
C.road('tertiary', [[G1, 0], [R, 0]], { name: 'East Gate', limit: 30 });

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
// a feeder joining the suburb to the ring so it is not an island
C.road('tertiary', [[-290, R], [-290, R + 120]], { name: 'Southfield Road', limit: 30 });
C.place('Southfield', -100, R + 430, 700, 2);

// 4. The country edge: an unlit national-speed-limit lane out past the ring, hedges and bends
const lane = [];
for (let i = 0; i <= 14; i++) lane.push([R + i * 90, -300 + 150 * Math.sin(i / 3)]);
C.road('unclassified', lane, { name: 'Hollow Lane' });
C.place('Hollow End', R + 700, -200, 500, 3);

// 5. The bypass: a 70 dual carriageway running north off the ring, two halves 14 m apart
for (const side of [-7, 7]) {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push([side, -R - i * 160]);
  // the near half runs away from the city, the far half back towards it
  C.road('trunk', side < 0 ? pts : pts.slice().reverse(), { name: 'Northgate Bypass', ref: 'A2(M)', oneway: true, dual: true, lanesF: 2, limit: 70, width: 7.3 });
}

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
