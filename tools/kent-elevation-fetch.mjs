import fs from 'node:fs';
// Fetch EU-DEM 25 m elevation over Kent's drivable bounds, using Kent's exact projection origin
// (kent-data.mjs), and write scratch/osm/kent/elevation.json in the same shape the cities use.
const ORIGIN = { lat0: 51.32, lon0: 1.1, mPerDegLat: 111254.358, mPerDegLon: 69713.686 };
const OUT = process.argv[2] || 'scratch/osm/kent/elevation.json';
const X0 = -3350, Z0 = -6750, STEP = 150, NX = 78, NZ = 90; // covers x[-3350..8200], z[-6750..6600]
const pts = [];
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const x = X0 + i * STEP, z = Z0 + j * STEP;
  pts.push([ORIGIN.lat0 - z / ORIGIN.mPerDegLat, ORIGIN.lon0 + x / ORIGIN.mPerDegLon]);
}
console.log(`kent: ${NX}x${NZ}=${pts.length} pts, ${Math.ceil(pts.length / 100)} requests`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heights = new Array(pts.length).fill(null);
let wait = 1100;
for (let s = 0; s < pts.length; s += 100) {
  const batch = pts.slice(s, s + 100), locs = batch.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join('|');
  let ok = false;
  for (let att = 0; att < 8 && !ok; att++) {
    try {
      const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${locs}`);
      if (res.status === 429) { await sleep(wait); wait = Math.min(wait + 500, 5000); continue; }
      const j = await res.json(); if (j.status !== 'OK') throw new Error(j.error || 'bad');
      j.results.forEach((r, i) => { heights[s + i] = r.elevation; }); ok = true;
    } catch (e) { await sleep(Math.min(wait * att, 8000)); }
  }
  if (!ok) { console.error('giving up at', s); process.exit(1); }
  await sleep(wait); process.stdout.write(`${Math.min(s + 100, pts.length)}/${pts.length}\r`);
}
let nulls = heights.filter((h) => h == null).length;
for (let p = 0; p < 4 && nulls; p++) {
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i; if (heights[k] != null) continue;
    const n = []; if (i > 0 && heights[k - 1] != null) n.push(heights[k - 1]); if (i < NX - 1 && heights[k + 1] != null) n.push(heights[k + 1]); if (j > 0 && heights[k - NX] != null) n.push(heights[k - NX]); if (j < NZ - 1 && heights[k + NX] != null) n.push(heights[k + NX]);
    if (n.length) heights[k] = n.reduce((a, b) => a + b) / n.length;
  }
  nulls = heights.filter((h) => h == null).length;
}
const good = heights.filter((h) => h != null);
const mean = good.reduce((a, b) => a + b, 0) / good.length;
for (let i = 0; i < heights.length; i++) if (heights[i] == null) heights[i] = mean;
const grid = { source: 'opentopodata.org eudem25m (EU-DEM v1.1, Copernicus)', region: 'kent', origin: ORIGIN, x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ, min: +Math.min(...heights).toFixed(2), max: +Math.max(...heights).toFixed(2), heights: heights.map((h) => +h.toFixed(2)) };
fs.mkdirSync('scratch/osm/kent', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(grid));
console.log(`\nwrote ${OUT} min ${grid.min} max ${grid.max} range ${(grid.max - grid.min).toFixed(1)}m`);
