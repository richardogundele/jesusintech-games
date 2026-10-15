// Dev-only stand-in for region.json + RoadNet, so scenery.js can be exercised under node before
// the real data exists. Same shapes as DESIGN.md section 1 / 2, just a handful of everything:
// a town tile (0,0) with every building kind, a rural tile (1,1) with fields, a wood and hedges,
// a railway with a level crossing, a coastline that crosses the x 2400 cliff boundary with a sea
// tile north of it, and the landmarks the scenery builder knows how to draw.

const rect = (cx, cz, w, d) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
const rot = (pts, cx, cz, a) => pts.map(([x, z]) => [cx + (x - cx) * Math.cos(a) + (z - cz) * Math.sin(a), cz - (x - cx) * Math.sin(a) + (z - cz) * Math.cos(a)]);

export function makeFixtureData() {
  const buildings = [];
  // houses on the north side of the High Street (z 250), fronts to the road
  for (let i = 0; i < 12; i++) buildings.push({ pts: rect(40 + i * 7.2, 228, 6, 9), h: 6.5, kind: 'house', name: null });
  // a terrace and some semis, one of them turned a little
  buildings.push({ pts: rect(320, 227, 42, 9), h: 7, kind: 'terrace', name: null });
  buildings.push({ pts: rot(rect(400, 215, 11, 9), 400, 215, 0.3), h: 6.5, kind: 'house', name: null });
  // an L-shaped house and a bungalow
  buildings.push({ pts: [[90, 150], [104, 150], [104, 160], [98, 160], [98, 168], [90, 168]], h: 6.5, kind: 'house', name: null });
  buildings.push({ pts: rect(130, 160, 9, 8), h: 3.6, kind: 'house', name: null });
  // shops on the south side, a flats block, a shed, an industrial unit, a church
  for (let i = 0; i < 8; i++) buildings.push({ pts: rect(60 + i * 6.2, 267, 5.8, 11), h: 9, kind: 'shop', name: null });
  buildings.push({ pts: rect(430, 300, 22, 14), h: 12.8, kind: 'flats', name: 'Seaview Court' });
  buildings.push({ pts: rect(150, 420, 3, 3), h: 2.6, kind: 'other', name: null });
  buildings.push({ pts: rect(60, 430, 42, 26), h: 7.5, kind: 'industrial', name: 'Units 1-4' });
  buildings.push({ pts: rect(400, 120, 26, 12), h: 9, kind: 'church', name: 'St Martin' });
  // a pentagon 'other' and a big retail box that becomes the supermarket (landmark inside it)
  buildings.push({ pts: [[200, 100], [214, 96], [222, 108], [212, 120], [198, 114]], h: 5, kind: 'other', name: null });
  buildings.push({ pts: rect(400, 60, 44, 30), h: 7, kind: 'shop', name: 'Tesco' });
  // the test centre footprint: replaced by the bespoke box
  buildings.push({ pts: rect(470, 400, 20, 10), h: 4, kind: 'other', name: 'Herne Bay Test Centre' });
  // a farm and a coast-top house in the other tiles
  buildings.push({ pts: rect(720, 560, 18, 9), h: 6.5, kind: 'house', name: null });
  buildings.push({ pts: rect(2250, -830, 12, 9), h: 6.5, kind: 'house', name: null });
  // two that must be skipped: inside the home's 70 m keep-clear circle, and on the airfield site
  buildings.push({ pts: rect(2480, -800, 10, 8), h: 6.5, kind: 'house', name: 'home-zone' });
  buildings.push({ pts: rect(700, 0, 12, 8), h: 5, kind: 'other', name: 'airfield-zone' });

  const ways = [
    { id: 1, name: 'High Street', ref: null, cls: 'tertiary', limit: 30, nsl: false, oneway: false, lanesF: 1, lanesB: 1, rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 7.3, pave: true, rural: false,
      pts: [[-50, 250], [250, 250], [550, 250]], nodes: [101, 102, 103] },
    { id: 2, name: 'Station Road', ref: null, cls: 'residential', limit: 20, nsl: false, oneway: false, lanesF: 1, lanesB: 1, rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 6, pave: true, rural: false,
      pts: [[250, 0], [250, 250]], nodes: [104, 102] },
    { id: 3, name: 'Mill Lane', ref: null, cls: 'unclassified', limit: 60, nsl: true, oneway: false, lanesF: 1, lanesB: 1, rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 6.5, pave: false, rural: true,
      pts: [[250, 250], [250, 395], [252, 600], [260, 800]], nodes: [102, 105, 106, 107] },
    { id: 4, name: 'Farm Lane', ref: null, cls: 'unclassified', limit: 60, nsl: true, oneway: false, lanesF: 1, lanesB: 1, rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 6, pave: false, rural: true,
      pts: [[252, 600], [500, 610], [720, 600], [900, 620]], nodes: [106, 108, 109, 110] },
    { id: 5, name: 'Central Parade', ref: null, cls: 'tertiary', limit: 30, nsl: false, oneway: false, lanesF: 1, lanesB: 1, rb: null, dual: false, link: false, bridge: false, tunnel: false, layer: 0, width: 7.3, pave: true, rural: false,
      pts: [[1900, -820], [2300, -830], [2700, -840], [3100, -850]], nodes: [111, 112, 113, 114] },
  ];
  const nodes = {
    101: { x: -50, z: 250, ways: [1] }, 102: { x: 250, z: 250, ways: [1, 2, 3] }, 103: { x: 550, z: 250, ways: [1] }, 104: { x: 250, z: 0, ways: [2] },
    105: { x: 250, z: 395, ways: [3], levelCrossing: true }, 106: { x: 252, z: 600, ways: [3, 4] }, 107: { x: 260, z: 800, ways: [3] },
    108: { x: 500, z: 610, ways: [4] }, 109: { x: 720, z: 600, ways: [4] }, 110: { x: 900, z: 620, ways: [4] },
    111: { x: 1900, z: -820, ways: [5] }, 112: { x: 2300, z: -830, ways: [5] }, 113: { x: 2700, z: -840, ways: [5] }, 114: { x: 3100, z: -850, ways: [5] },
  };
  // the sea is north (-z) of this coast; it runs west -> east across the cliff boundary at x 2400
  const coastline = [[1800, -860], [2000, -868], [2150, -862], [2300, -875], [2400, -870], [2500, -890], [2650, -900], [2800, -905], [2950, -895], [3200, -900]];
  const sea = [...coastline, [3200, -3000], [1800, -3000]];
  return {
    attribution: 'fixture', origin: { lat0: 51.32, lon0: 1.1 },
    bounds: { minX: -500, maxX: 3500, minZ: -2000, maxZ: 1200 },
    ways, nodes, roundabouts: [], minis: [], signals: [], crossings: [],
    levelCrossings: [{ node: 105, x: 250, z: 395, barrier: 'half', way: 3 }],
    railways: [{ name: 'Chatham Main Line', pts: [[-60, 380], [200, 392], [250, 395], [560, 418]] }],
    rivers: [], coastline, sea, buildings,
    landuse: [
      { kind: 'residential', pts: [[0, 0], [500, 0], [500, 500], [0, 500]] },
      { kind: 'grass', pts: [[300, 20], [450, 20], [450, 120], [300, 120]] },
      { kind: 'farmland', pts: [[500, 500], [1000, 500], [1000, 1000], [500, 1000]] },
      { kind: 'wood', pts: [[600, 650], [750, 640], [760, 800], [620, 820]] },
      { kind: 'beach', pts: [[1900, -860], [2300, -872], [2300, -850], [1900, -840]] },
    ],
    landmarks: [
      { name: 'Tesco', cat: 'supermarket', brand: 'Tesco', x: 400, z: 60 },
      { name: 'Esso', cat: 'fuel', brand: 'Esso', x: 150, z: 320 },
      { name: 'Clock Tower', cat: 'tourism:attraction', x: 2150, z: -800 },
      { name: 'Herne Bay Pier', cat: 'pier', x: 2000, z: -850 },
      { name: 'Herne Bay Pier Head', cat: 'pier', x: 2050, z: -1250 },
      { name: "Neptune's Arm", cat: 'pier', x: 2300, z: -980 },
      { name: 'Reculver Towers', cat: 'historic:ruins', x: 2900, z: -855 },
      { name: 'Canterbury Cathedral', cat: 'cathedral', x: -250, z: 250 },
      { name: 'Aldi', cat: 'supermarket', brand: 'Aldi', x: 900, z: 300 },
    ],
    places: [{ name: 'Fixture', x: 250, z: 250, r: 600 }],
    testCentres: [{ name: 'Herne Bay driving test centre', x: 470, z: 400, address: 'Fixture Park' }],
    // keep-clear: 70 m round home; airfield site local x -230..45 / z -920..50 and approach strip z -1320..-920 / x -40..40
    home: { x: 2500, z: -820 }, airfield: { x: 800, z: 100 },
  };
}

/** The slice of the RoadNet API scenery.js uses, brute force over the fixture's ways. */
export function makeFixtureNet(data = makeFixtureData()) {
  const ways = new Map(data.ways.map((w) => [w.id, { ...w, halfW: w.width / 2 }]));
  return {
    data, ways,
    nodes: new Map(Object.entries(data.nodes).map(([id, n]) => [Number(id), n])),
    nearest(x, z, maxD = 60) {
      let best = null;
      for (const w of ways.values()) {
        for (let i = 0; i < w.pts.length - 1; i++) {
          const a = w.pts[i], b = w.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
          const px = a[0] + dx * t, pz = a[1] + dz * t, dist = Math.hypot(x - px, z - pz);
          if (dist <= maxD && (!best || dist < best.dist)) {
            const L = Math.sqrt(L2);
            best = { way: w, i, t, s: 0, dist, side: (dx * (z - pz) - dz * (x - px)) > 0 ? -1 : 1, px, pz, dir: [dx / L, dz / L] };
          }
        }
      }
      return best;
    },
  };
}
