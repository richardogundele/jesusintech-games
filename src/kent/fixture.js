// Dev-only stand-in for public/assets/kent/region.json (same shape, DESIGN.md section 1) so the
// road builder can be exercised before the real Kent data exists: a High Street with a zebra, a
// signalised crossroads with turn lanes, a mini-roundabout and a service yard; a two-lane
// roundabout with four arms; a rural lane with a bend and a give-way side road; a dual
// carriageway (A299 style) with an exit slip and a merge slip; a short bridge. Not shipped.

const W = [];
const N = {};
let plainId = -1; // ids for vertices that are not junction nodes (must not appear in `nodes`)
const node = (id, x, z, tags = {}) => { N[id] = { x, z, ways: [], signals: false, crossing: null, giveWay: false, stop: false, mini: false, levelCrossing: false, ...tags }; return id; };
const P = () => plainId--;
const way = (id, props, pts, nodes) => {
  const w = {
    id, name: null, ref: null, cls: 'residential', limit: 30, nsl: false, oneway: false, lanesF: 1, lanesB: 1, lanesSrc: 'derived', rb: null, dual: false, link: false,
    bridge: false, tunnel: false, layer: 0, width: 6.0, pave: true, rural: false, turnLanes: null, ...props, pts, nodes,
  };
  W.push(w);
  for (const n of nodes) if (N[n]) N[n].ways.push(id);
  return w;
};

// ---- the two-lane roundabout: 32-point ring, clockwise on the map (atan2(z, x) increasing) ----
const RB = { x: 450, z: 250, r: 16 };
const ringPts = [], ringNodes = [];
for (let i = 0; i < 32; i++) {
  const a = (i / 32) * Math.PI * 2;
  ringPts.push([+(RB.x + Math.cos(a) * RB.r).toFixed(2), +(RB.z + Math.sin(a) * RB.r).toFixed(2)]);
  ringNodes.push(1000 + i);
}
ringPts.push(ringPts[0]); ringNodes.push(1000);
for (let i = 0; i < 32; i++) node(1000 + i, ringPts[i][0], ringPts[i][1]);
way(900, { name: 'Fixtown Roundabout', cls: 'secondary', limit: 30, oneway: true, lanesF: 2, lanesB: 0, rb: 'rb-1', width: 7.3, pave: true }, ringPts, ringNodes);
// arm nodes: 1000 east, 1008 south, 1016 west, 1024 north

// ---- High Street (A123, 30, pavements) west arm of the roundabout ----
node(1, -200, 250); node(13, 30, 250); node(2, 100, 250); node(3, 180, 250, { crossing: 'zebra' }); node(4, 250, 250, { signals: true }); node(5, 350, 250, { mini: true });
way(100, { name: 'High Street', ref: 'A123', cls: 'secondary', limit: 30, width: 7.3, pave: true },
  [[-200, 250], [30, 250], [100, 250], [180, 250], [250, 250], [350, 250], [434, 250]], [1, 13, 2, 3, 4, 5, 1016]);
// service yard off the High Street
node(14, 30, 180);
way(105, { name: 'Market Yard', cls: 'service', limit: 10, width: 5.0, pave: false }, [[30, 250], [30, 180]], [13, 14]);
// Church Road: residential T from the south with a bend
node(7, 130, 500);
way(101, { name: 'Church Road', cls: 'residential', limit: 20, width: 6.0, pave: true }, [[100, 250], [100, 400], [130, 500]], [2, P(), 7]);
// Park Road through the signalised crossroads; the southern approach has two forward lanes with turn arrows
node(9, 250, 50); node(10, 250, 450);
way(102, { name: 'Park Road', cls: 'tertiary', limit: 30, width: 6.5, pave: true }, [[250, 250], [250, 50]], [4, 9]);
way(103, { name: 'Park Road', cls: 'tertiary', limit: 30, width: 10.0, lanesF: 2, lanesB: 1, pave: true, turnLanes: [['left'], ['through', 'right']] }, [[250, 450], [250, 250]], [10, 4]);
// Mill Lane north from the mini-roundabout, ending where the exit slip arrives
node(11, 350, 60);
way(104, { name: 'Mill Lane', cls: 'residential', limit: 20, width: 6.0, pave: true }, [[350, 250], [350, 60]], [5, 11]);
// Station Road: north arm, with a pelican crossing, up to the slip road start
node(29, 450, 120, { crossing: 'signals' }); node(15, 450, -40);
way(106, { name: 'Station Road', cls: 'tertiary', limit: 30, width: 7.3, pave: true }, [[450, 234], [450, 120], [450, -40]], [1024, 29, 15]);

// ---- Thanet Way: dual carriageway, 70, two one-way ways 12 m apart ----
// Left-hand traffic: heading east your left is north, so the eastbound carriageway is the northern
// one. The slips hang off the westbound (southern) carriageway's nearside, towards the town.
node(21, -250, -106); node(22, 750, -106);
way(109, { name: 'Thanet Way', ref: 'A299', cls: 'trunk', limit: 70, nsl: true, oneway: true, lanesF: 2, lanesB: 0, dual: true, width: 7.3, pave: false, rural: true },
  [[-250, -106], [750, -106]], [21, 22]);
node(19, 750, -94); node(30, 560, -94); node(31, 120, -94); node(20, -250, -94);
way(110, { name: 'Thanet Way', ref: 'A299', cls: 'trunk', limit: 70, nsl: true, oneway: true, lanesF: 2, lanesB: 0, dual: true, width: 7.3, pave: false, rural: true },
  [[750, -94], [560, -94], [120, -94], [-250, -94]], [19, 30, 31, 20]);
// exit slip off the westbound carriageway: a gentle taper, then it curls south to Station Road
way(107, { name: 'Station Road Link', cls: 'trunk_link', limit: 40, oneway: true, lanesF: 1, lanesB: 0, link: true, width: 4.0, pave: false, rural: true },
  [[560, -94], [510, -89], [480, -80], [460, -66], [452, -54], [450, -40]], [30, P(), P(), P(), P(), 15]);
// merge slip from Mill Lane onto the westbound carriageway, arriving at a shallow angle
way(108, { name: 'Mill Lane Link', cls: 'trunk_link', limit: 40, oneway: true, lanesF: 1, lanesB: 0, link: true, width: 4.0, pave: false, rural: true },
  [[350, 60], [335, 10], [305, -40], [265, -72], [210, -88], [120, -94]], [11, P(), P(), P(), P(), 31]);

// ---- Marsh Lane: rural south arm with a bend and a give-way side road ----
node(24, 480, 520); node(23, 600, 700);
way(111, { name: 'Marsh Lane', cls: 'unclassified', limit: 60, nsl: true, width: 6.5, pave: false, rural: true },
  [[450, 266], [450, 400], [480, 520], [560, 600], [600, 700]], [1008, P(), 24, P(), 23]);
node(25, 700, 520);
way(112, { name: 'Field Lane', cls: 'unclassified', limit: 60, nsl: true, width: 5.5, pave: false, rural: true }, [[480, 520], [700, 520]], [24, 25]);

// ---- Kent Road: east arm, rural 40 with a short bridge ----
node(27, 600, 250); node(28, 680, 250); node(26, 750, 250);
way(113, { name: 'Kent Road', cls: 'tertiary', limit: 40, width: 7.3, pave: false, rural: true }, [[466, 250], [600, 250]], [1000, 27]);
way(114, { name: 'Kent Road', cls: 'tertiary', limit: 40, width: 7.3, pave: false, rural: true, bridge: true, layer: 1 }, [[600, 250], [680, 250]], [27, 28]);
way(115, { name: 'Kent Road', cls: 'tertiary', limit: 40, width: 7.3, pave: false, rural: true }, [[680, 250], [750, 250]], [28, 26]);

export const FIXTURE = {
  attribution: 'fixture (not OSM)',
  origin: { lat0: 51.32, lon0: 1.1, mPerDegLat: 111254.358, mPerDegLon: 69713.686 },
  bounds: { minX: -400, maxX: 900, minZ: -300, maxZ: 800 },
  ways: W,
  nodes: N,
  roundabouts: [{
    id: 'rb-1', name: 'Fixtown Roundabout', x: RB.x, z: RB.z, r: RB.r, lanes: 2, lanesSrc: 'tag', island: RB.r - 3.65, sense: 1, limit: 30, signals: false, mini: false,
    ringWays: [900], ringNodes: ringNodes.slice(0, 32),
    arms: [
      { bearing: 90, node: 1000, entry: true, exit: true, entryWays: [113], exitWays: [113], entryLanes: 1, exitLanes: 1, names: ['Kent Road'], refs: [], dest: 'Reculver' },
      { bearing: 180, node: 1008, entry: true, exit: true, entryWays: [111], exitWays: [111], entryLanes: 1, exitLanes: 1, names: ['Marsh Lane'], refs: [], dest: 'Marsh' },
      { bearing: 270, node: 1016, entry: true, exit: true, entryWays: [100], exitWays: [100], entryLanes: 2, exitLanes: 1, names: ['High Street'], refs: ['A123'], dest: 'Fixtown' },
      { bearing: 0, node: 1024, entry: true, exit: true, entryWays: [106], exitWays: [106], entryLanes: 2, exitLanes: 1, names: ['Station Road'], refs: [], dest: 'A299' },
    ],
  }],
  minis: [{ node: 5, x: 350, z: 250, arms: 3, sense: 1 }],
  signals: [{ node: 4, x: 250, z: 250, ways: [100, 102, 103], junction: 'j-4' }],
  crossings: [
    { node: 3, x: 180, z: 250, type: 'zebra', way: 100, s: 380 },
    { node: 29, x: 450, z: 120, type: 'pelican', way: 106, s: 114 },
  ],
  levelCrossings: [],
  railways: [],
  rivers: [],
  coastline: [],
  sea: [],
  buildings: [],
  landuse: [],
  landmarks: [],
  places: [{ name: 'Fixtown', x: 200, z: 250, r: 1000 }],
  testCentres: [],
  home: { x: 0, z: 0 },
  airfield: { x: 0, z: 0 },
};
