import fs from 'node:fs';
// Inject a `terrain` grid into the EXISTING public/assets/kent/region.json (no full rebake).
// Datum = home elevation, so the hand-built home sits at y=0. The grid is feathered to EXACTLY 0
// around the home, the airfield and the coast (all modelled at y=0) and at the grid edges, so only
// the open country and Canterbury get the real EU-DEM hills.
const REGION = 'public/assets/kent/region.json';
const ELEV = 'scratch/osm/kent/elevation.json';
const g = JSON.parse(fs.readFileSync(ELEV, 'utf8'));
const region = JSON.parse(fs.readFileSync(REGION, 'utf8'));
const { x0, z0, step, nx, nz, heights } = g;
const r1 = (v) => Math.round(v * 10) / 10;

// bilinear sample of the raw grid at a world point (clamped)
const sample = (x, z) => {
  const fx = (x - x0) / step, fz = (z - z0) / step;
  let i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
  const h = (a, b) => heights[b * nx + a];
  return (1 - u) * (1 - v) * h(i, j) + u * (1 - v) * h(i + 1, j) + (1 - u) * v * h(i, j + 1) + u * v * h(i + 1, j + 1);
};

const home = region.home, air = region.airfield, coast = region.coastline || [];
const datum = sample(home.x, home.z);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerpTo1 = (d, inR, outR) => smooth((d - inR) / (outR - inR)); // 0 inside inR, 1 beyond outR

// airfield keep-clear rect (from kent-data.mjs AIRFIELD_RECT) + margin
const aRect = { minX: air.x - 230, maxX: air.x + 45, minZ: air.z - 920, maxZ: air.z + 50 };
const distOutRect = (x, z, R) => {
  const dx = Math.max(R.minX - x, 0, x - R.maxX), dz = Math.max(R.minZ - z, 0, z - R.maxZ);
  return Math.hypot(dx, dz);
};
// nearest coastline point distance (383 pts, 7020 grid pts -> fine)
const coastDist = (x, z) => {
  let best = Infinity;
  for (const [cx, cz] of coast) { const d = (x - cx) ** 2 + (z - cz) ** 2; if (d < best) best = d; }
  return Math.sqrt(best);
};

const BORDER = 3; // cells of edge feather
const relH = new Array(heights.length);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
  const edgeF = smooth(Math.min(i, j, nx - 1 - i, nz - 1 - j) / BORDER);
  const homeF = lerpTo1(Math.hypot(x - home.x, z - home.z), 320, 620);
  const airF = lerpTo1(distOutRect(x, z, aRect), 140, 360);
  const coastF = lerpTo1(coastDist(x, z), 170, 400);
  const f = Math.min(edgeF, homeF, airF, coastF);
  relH[k] = r1((heights[k] - datum) * f);
}

const min = Math.min(...relH), max = Math.max(...relH);
region.terrain = { source: g.source, step, x0, z0, nx, nz, base: r1(datum), min: r1(min), max: r1(max), heights: relH };
fs.writeFileSync(REGION, JSON.stringify(region));

// sanity log
const tcRel = (region.testCentres || []).map((t) => `${t.name.split(' ')[0]} (${t.x},${t.z}) rel ${r1((sample(t.x, t.z) - datum))}m`);
console.log(`datum(home) = ${r1(datum)} m`);
console.log(`terrain rel min ${r1(min)}  max ${r1(max)}  range ${r1(max - min)} m`);
console.log(`home rel ${r1((sample(home.x, home.z) - datum))}m (feathered to 0), airfield rel ${r1((sample(air.x, air.z) - datum))}m (feathered to 0)`);
console.log('test centres (pre-feather rel): ' + tcRel.join(' | '));
console.log(`wrote ${REGION} (${(fs.statSync(REGION).size / 1e6).toFixed(2)} MB)`);
