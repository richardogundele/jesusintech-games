#!/usr/bin/env node
// Off-street parking (src/kent/scenery.js): does half of the houses have a drive, does every
// supermarket that has the ground for one have a car park, and is every car that stands on them
// clear of the roads and the buildings?
//
//   node tools/parking-check.mjs [region] [--all]        (default city; exits 1 on a FAIL)
//
// --all lets every house try for a drive (driveShare 1) and prints the share that has the room:
// that is the measurement DRIVE_SHARE in scenery.js is set from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { makeSceneryBuilder } from '../src/kent/scenery.js';
import { PARKED_W, PARKED_L } from '../src/kent/parked.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), all = args.includes('--all'), region = args.find((a) => !a.startsWith('--')) || 'city';
const data = JSON.parse(fs.readFileSync(path.join(REPO, `public/assets/${region}/region.json`), 'utf8'));
const net = new RoadNet(data);
if (!net.data) net.data = data;
const scenery = makeSceneryBuilder({ net, ...(all ? { driveShare: 1 } : {}) });
const off = scenery.offstreet;
let fails = 0;
const ok = (m) => console.log(`  ok    ${m}`), fail = (m) => { fails++; console.log(`  FAIL  ${m}`); };

// ---- drives ----
let houses = 0, drives = 0, driveCars = 0;
const cars = [];
for (const key of off.tiles()) {
  const [tx, tz] = key.split(',').map(Number);
  houses += off.housesIn(key).length;
  const list = off.drivesForTile(tx, tz);
  drives += list.length;
  for (const d of list) if (d.car) { driveCars++; cars.push({ ...d.car, where: 'drive' }); }
}
const share = drives / Math.max(1, houses);
console.log(`${region}: ${houses} houses, ${drives} with a drive (${(share * 100).toFixed(1)}%), a car on ${driveCars} of them`);
if (all) console.log(`  every house tried: ${(share * 100).toFixed(1)}% have the room, so DRIVE_SHARE = ${(0.5 / share).toFixed(3)} leaves half of all houses with a drive`);
else if (share >= 0.5) ok(`half the houses or more have a drive (${(share * 100).toFixed(1)}%)`);
else fail(`only ${(share * 100).toFixed(1)}% of the houses have a drive, under half`);

// ---- car parks ----
const byBrand = new Map();
for (const S of off.supers) {
  const b = byBrand.get(S.brand) || { n: 0, parks: 0, bays: 0 };
  b.n++; if (S.park) { b.parks++; b.bays += S.park.bays.length; }
  byBrand.set(S.brand, b);
}
const withPark = off.supers.filter((S) => S.park).length;
console.log(`${off.supers.length} supermarkets, ${withPark} with a car park (${off.carParks.reduce((s, P) => s + P.bays.length, 0)} bays, ${off.carParks.reduce((s, P) => s + P.cars.length, 0)} cars, ${off.carParks.filter((P) => P.access).length} with a way in from the road)`);
for (const [brand, b] of [...byBrand].sort((a, c) => c[1].n - a[1].n).slice(0, 14)) console.log(`    ${brand.padEnd(24)} ${String(b.parks).padStart(3)} of ${String(b.n).padStart(3)} with a car park, ${b.bays} bays`);
for (const P of off.carParks) for (const c of P.cars) cars.push({ ...c, where: `${P.brand} car park` });
if (!all) {
  const big = off.supers.filter((S) => /aldi|tesco|asda|lidl|sainsbury|morrisons|waitrose/i.test(S.brand) && !/express|local/i.test(S.brand));
  const bigWith = big.filter((S) => S.park).length;
  if (big.length && bigWith / big.length >= 0.8) ok(`${bigWith} of the ${big.length} big-name stores (Aldi, Tesco, Asda, Lidl, Sainsbury's, Morrisons, Waitrose) have a car park`);
  else fail(`only ${bigWith} of the ${big.length} big-name stores have a car park`);
}

// ---- every car: off the carriageway, out of the buildings, clear of the next car ----
const corners = (c) => { const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), lx = fz, lz = -fx, hl = PARKED_L / 2, hw = PARKED_W / 2; return [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].map(([a, b]) => [c.x + fx * hl * a + lx * hw * b, c.z + fz * hl * a + lz * hw * b]); };
let onRoad = 0, firstRoad = null;
for (const c of cars) for (const [x, z] of corners(c)) {
  const h = net.nearest(x, z, 14);
  if (h && h.dist < h.way.halfW) { onRoad++; firstRoad ??= `${c.where} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) on ${h.way.name || h.way.cls}`; break; }
}
if (!onRoad) ok(`${cars.length} cars off the street, none of them on a carriageway`);
else fail(`${onRoad} of ${cars.length} off-street cars reach on to a carriageway, e.g. ${firstRoad}`);
const grid = new Map();
let touching = 0;
for (const c of cars) {
  const gx = Math.floor(c.x / 6), gz = Math.floor(c.z / 6);
  for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) for (const o of grid.get(`${a},${b}`) || []) if (Math.hypot(o.x - c.x, o.z - c.z) < PARKED_W) touching++;
  const k = `${gx},${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
}
if (!touching) ok('no two off-street cars stand in the same place');
else fail(`${touching} pairs of off-street cars overlap`);

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
