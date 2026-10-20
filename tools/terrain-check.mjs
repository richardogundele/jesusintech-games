#!/usr/bin/env node
// Checks the terrain maths in src/worlds/terrain.js against a baked region, with no browser.
//
//   node tools/terrain-check.mjs [region]        (default london)
//
// The one that matters is #2: the drawn land and heightAt must agree, or grass pokes through the
// tarmac, which sits only ~2 cm above the ground.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { makeTerrain, tessellate, drapeGeometry } from '../src/worlds/terrain.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || 'london';
const region = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets', id, 'region.json'), 'utf8'));
const T = makeTerrain(region);
const g = region.terrain;
if (!g) { console.error(`${id} has no terrain grid`); process.exit(2); }

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// 1. the grid's own points must come back exactly
let worst = 0;
for (let j = 0; j < g.nz; j += 7) for (let i = 0; i < g.nx; i += 7) {
  const x = g.x0 + i * g.step, z = g.z0 + j * g.step;
  worst = Math.max(worst, Math.abs(T.heightAt(x, z) - g.heights[j * g.nx + i]));
}
ok(worst < 1e-6, `heightAt returns the grid's own heights at its own points (worst ${worst.toExponential(1)} m)`);

// 2. the drawn land must sit exactly on heightAt, including mid-cell
const land = T.landGeometry(0);
const pos = land.attributes.position;
let maxGap = 0;
for (let i = 0; i < pos.count; i++) maxGap = Math.max(maxGap, Math.abs(pos.getY(i) - T.heightAt(pos.getX(i), pos.getZ(i))));
ok(maxGap < 1e-4, `land mesh vertices sit on heightAt (worst ${maxGap.toExponential(1)} m, ${pos.count} verts)`);

// 2b. how far bilinear would have drifted on the cell diagonals - the trap we avoided
let diagWorst = 0;
for (let j = 0; j < g.nz - 1; j += 5) for (let i = 0; i < g.nx - 1; i += 5) {
  const h00 = g.heights[j * g.nx + i], h10 = g.heights[j * g.nx + i + 1], h01 = g.heights[(j + 1) * g.nx + i], h11 = g.heights[(j + 1) * g.nx + i + 1];
  for (const t of [0.25, 0.5, 0.75]) {
    const u = t, v = 1 - t;
    const planar = T.heightAt(g.x0 + (i + u) * g.step, g.z0 + (j + v) * g.step);
    const bil = (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
    diagWorst = Math.max(diagWorst, Math.abs(planar - bil));
  }
}
console.log(`     bilinear would have missed the drawn land by up to ${diagWorst.toFixed(3)} m on cell diagonals`);

// 3. tessellation bounds edge length
const quad = new THREE.PlaneGeometry(300, 12).rotateX(-Math.PI / 2);
const tess = tessellate(quad, 8);
const a = tess.attributes.position.array;
let longest = 0;
for (let o = 0; o < a.length; o += 9) for (let e = 0; e < 3; e++) {
  const p = o + e * 3, q = o + ((e + 1) % 3) * 3;
  longest = Math.max(longest, Math.hypot(a[p] - a[q], a[p + 1] - a[q + 1], a[p + 2] - a[q + 2]));
}
ok(longest <= 8.01, `tessellate bounds every edge to 8 m (longest ${longest.toFixed(2)} m; 2 tris -> ${a.length / 9})`);

// 4. a long road draped over the hill lands on the ground, keeping its 2 cm of tarmac
const road = new THREE.PlaneGeometry(400, 8).rotateX(-Math.PI / 2).translate(0, 0.02, -1200);
const draped = drapeGeometry(road, T.heightAt, 8);
const d = draped.attributes.position.array;
let maxErr = 0;
for (let i = 0; i < d.length; i += 3) maxErr = Math.max(maxErr, Math.abs((d[i + 1] - 0.02) - T.heightAt(d[i], d[i + 2])));
ok(maxErr < 1e-4, `draped road vertices land on the ground (worst ${maxErr.toExponential(1)} m)`);

// 5. what that same road would have done flat - the bug, measured
let chord = 0;
for (let s = -200; s <= 200; s += 5) chord = Math.max(chord, Math.abs(T.heightAt(s, -1200)));
console.log(`     undrapped, that 400 m road would float up to ${chord.toFixed(1)} m off the ground`);

ok(T.range > 20, `${id} has real hills (${T.range.toFixed(1)} m range)`);
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall terrain checks passed');
process.exit(fails ? 1 : 0);
