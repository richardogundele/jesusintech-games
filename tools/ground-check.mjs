#!/usr/bin/env node
// Proves the world's OBJECTS stand on the terrain: lamps, trees, hedges, and the big landmarks.
//
//   node tools/ground-check.mjs [region]        (default kent)
//
// drape-check proves the road surfaces follow the hills. This is its twin for everything that is NOT
// draped but planted at a point: street lamps, trees, hedges, the cathedral, the clock tower. The bug
// it guards against is an object built at a fixed y (0, or 3.3 for a sign) in a world that has hills:
// on a +22 m hill that object is 22 m underground, on low ground it floats. It happened when Kent got
// terrain (lamps, hedges, level-crossing posts, the cathedral, the test-centre sign all vanished).
//
// It builds REAL scenery tiles, and for every instanced lamp / tree / hedge compares the base of the
// instance with heightAt under it. Landmarks are checked by raycasting down onto them: a cathedral
// buried in a hill hits at a fraction of its height.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RoadNet } from '../src/kent/net.js';
import { makeTerrain } from '../src/worlds/terrain.js';
import { makeSceneryBuilder, TILE } from '../src/kent/scenery.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || 'kent';
const region = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets', id, 'region.json'), 'utf8'));
const net = new RoadNet(region);
const T = makeTerrain(region);
if (!T.has) { console.error(`${id} has no terrain`); process.exit(2); }
const scenery = makeSceneryBuilder({ net, groundY: T.heightAt });

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// tiles: the hilliest, the lowest, and the ones holding the big landmarks and a test centre
const tileOf = (x, z) => ({ tx: Math.floor(x / TILE), tz: Math.floor(z / TILE) });
const picks = new Map();
const add = (t, why) => { const k = `${t.tx},${t.tz}`; if (!picks.has(k)) picks.set(k, { ...t, why: [] }); picks.get(k).why.push(why); };
const cand = [];
for (const b of region.buildings) { const t = tileOf(b.pts[0][0], b.pts[0][1]); cand.push({ ...t, h: T.heightAt((t.tx + 0.5) * TILE, (t.tz + 0.5) * TILE) }); }
cand.sort((a, b) => a.h - b.h);
add(cand[0], `lowest ${cand[0].h.toFixed(1)} m`);
add(cand[cand.length - 1], `highest ${cand[cand.length - 1].h.toFixed(1)} m`);
for (const l of region.landmarks || []) {
  if (/^canterbury cathedral$/i.test(l.name || '')) add(tileOf(l.x, l.z), 'cathedral');
  if (/clock tower/i.test(l.name || '') && /historic|attraction/.test(l.cat || '')) add(tileOf(l.x, l.z), `clock tower ${l.name}`);
}
for (const t of region.testCentres || []) add(tileOf(t.x, t.z), `test centre ${t.name.split(' ')[0]}`);

const identify = (o) => {
  const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox, tris = (g.index ? g.index.count / 3 : g.attributes.position.count / 3) | 0;
  const h = bb.max.y - bb.min.y;
  if (tris === 32 && Math.abs(h - 8) < 0.2) return 'lamp';
  if (tris === 894) return 'tree';
  // the hedge material is textured (0x5b7f3a) in the game and a plain green fallback (0x3f6b2e) with no assets, as here in Node
  if (tris === 12 && Math.abs(bb.max.x - bb.min.x - 1) < 0.01 && Math.abs(h - 1) < 0.01 && o.material?.color && ['5b7f3a', '3f6b2e'].includes(o.material.color.getHexString())) return 'hedge';
  return null;
};

const V = new THREE.Vector3(), Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
const stat = { lamp: { n: 0, worst: 0 }, tree: { n: 0, worst: 0 }, hedge: { n: 0, buried: 0, floating: 0 } };
const rc = new THREE.Raycaster(); rc.far = 400;

for (const p of picks.values()) {
  const part = scenery.build({ tx: p.tx, tz: p.tz }, 'near');
  const grp = part.group; grp.updateMatrixWorld(true);
  grp.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const k = identify(o); if (!k) return;
    const bb = o.geometry.boundingBox;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, Mx); Mx.decompose(V, Q, S);
      const base = V.y + bb.min.y * S.y, ground = T.heightAt(V.x, V.z), dev = base - ground;
      const s = stat[k]; s.n++;
      if (k === 'hedge') { if (dev < -3) s.buried++; if (dev > 0.5) s.floating++; }
      else s.worst = Math.max(s.worst, Math.abs(dev));
    }
  });
  // landmarks: raycast down onto the tile's big non-instanced meshes at each landmark of interest
  const meshes = []; grp.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
  for (const l of region.landmarks || []) {
    const isCath = /^canterbury cathedral$/i.test(l.name || ''), isClock = /clock tower/i.test(l.name || '') && /historic|attraction/.test(l.cat || '');
    if (!(isCath || isClock)) continue;
    const t = tileOf(l.x, l.z); if (t.tx !== p.tx || t.tz !== p.tz) continue;
    const ground = T.heightAt(l.x, l.z);
    rc.set(new THREE.Vector3(l.x + (isCath ? 16 : 0), ground + 150, l.z), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(meshes, false)[0];
    const need = isCath ? 70 : 23.5; // Bell Harry is 72 m, the tower tops out at 24.3: a landmark sunk into its hill reads several metres less
    ok(hit && hit.point.y - ground > need, `${l.name}: stands ${hit ? (hit.point.y - ground).toFixed(1) : 'nothing'} m above its ground (needs > ${need})`);
  }
  console.log(`tile ${String(p.tx).padStart(3)},${String(p.tz).padStart(3)} (${p.why.join(', ')})`);
  part.dispose?.();
}

console.log('');
ok(stat.lamp.n > 20, `checked ${stat.lamp.n} street lamps`);
ok(stat.lamp.worst < 0.05, `every lamp stands on the ground (worst ${stat.lamp.worst.toFixed(3)} m off)`);
ok(stat.tree.n > 20, `checked ${stat.tree.n} trees`);
ok(stat.tree.worst < 0.05, `every tree stands on the ground (worst ${stat.tree.worst.toFixed(3)} m off)`);
ok(stat.hedge.n >= 10, `checked ${stat.hedge.n} hedges`); // a flat city has few hedges in the probed tiles
ok(stat.hedge.buried === 0 && stat.hedge.floating === 0, `no hedge buried over 3 m or floating over 0.5 m (${stat.hedge.buried} buried, ${stat.hedge.floating} floating)`);
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall ground checks passed');
process.exit(fails ? 1 : 0);
