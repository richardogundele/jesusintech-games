#!/usr/bin/env node
// Headless check for the Kent house and the Kent Jet Centre: builds both into a plain
// THREE.Scene, prints mesh / triangle counts and the returned APIs, and asserts that every
// car and spawn position is near its origin and clear of the colliders, that every E prompt
// runs, and that the runway keeps the cutscene's camera lane and approach clear.
//
//   node tools/house-check.mjs
//
// common.js, catalog.js and models.js all pull in assets.js, which reads import.meta.env at
// load time and so cannot be imported here; this script carries a copy of the Colliders box
// logic, reads JETS / STARTER_JETS out of catalog.js as text, and stubs buildJet with boxes.
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKentHouse, HIGHWAY_CODE, NEWS } from '../src/kent/house.js';
import { buildAirfield } from '../src/kent/airfield.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? r1(v) : typeof v === 'function' ? `[fn ${v.name || 'anon'}]` : v && v.isObject3D ? `[${v.type}]` : v));

// ---- the Colliders box logic from src/worlds/common.js (same fields, same tests) ----
class Colliders {
  constructor() { this.boxes = []; }
  box(cx, cz, w, d, pad = 0, carOnly = false) {
    this.boxes.push({ minX: cx - w / 2 - pad, maxX: cx + w / 2 + pad, minZ: cz - d / 2 - pad, maxZ: cz + d / 2 + pad, carOnly });
  }
  /** boxes a circle of radius r at (x, z) would be pushed by */
  hits(x, z, r, isCar) {
    return this.boxes.filter((b) => !(b.carOnly && !isCar) && !(x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r));
  }
}

// ---- JETS / STARTER_JETS straight out of catalog.js (plain object literals) ----
function readJets() {
  const src = fs.readFileSync(path.join(ROOT, 'src/catalog.js'), 'utf8');
  const a = src.indexOf('export const JETS = {');
  const b = src.indexOf('export const STARTER_JETS');
  const c = src.indexOf(';', b);
  const code = src.slice(a, c + 1).replace(/export const /g, 'const ');
  return new Function(`${code}\nreturn { JETS, STARTER_JETS };`)();
}
const { JETS, STARTER_JETS } = readJets();

// stand-in for models.buildJet: fuselage, wings and a fin as boxes, so the colliders and the
// camera-lane check see something the right size (the real one is ~40 meshes per jet)
function stubJet(j) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial();
  const fus = new THREE.Mesh(new THREE.BoxGeometry(j.R * 2, j.R * 2, j.L), m);
  fus.position.y = j.R + 1;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(j.span, 0.3, j.L * 0.2), m);
  wing.position.y = j.R * 0.5 + 1;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, j.L * 0.2, j.L * 0.15), m);
  fin.position.set(0, j.R * 2 + j.L * 0.1 + 1, -j.L * 0.42);
  g.add(fus, wing, fin);
  return g;
}

function countScene(scene) {
  let meshes = 0, tris = 0, instanced = 0, lights = 0, sprites = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isLight) lights++;
    if (o.isSprite) sprites++;
    if (!o.isMesh) return;
    meshes++;
    const geo = o.geometry;
    const faces = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    if (o.isInstancedMesh) { instanced++; tris += faces * o.count; } else tris += faces;
  });
  return { meshes, instanced, tris: Math.round(tris), lights, sprites };
}

/** every vertex (instances expanded) through a callback, in world space */
function forEachVertex(scene, cb) {
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const mats = [];
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); mats.push(m.clone().premultiply(o.matrixWorld)); }
    else mats.push(o.matrixWorld);
    for (const mw of mats) for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mw); cb(v, o); }
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** a car at `at` is clear if neither probe circle (vehicle.js: +-0.28 L, r = 0.55 W) touches a box */
function carClear(colliders, at, L, W) {
  const fx = Math.sin(at.heading), fz = Math.cos(at.heading);
  const bad = [];
  for (const off of [L * 0.28, -L * 0.28]) {
    const px = at.x + fx * off, pz = at.z + fz * off;
    bad.push(...colliders.hits(px, pz, W * 0.55, true));
  }
  return bad;
}

// ================= the house =================
console.log('\n== Kent house ==');
const HOME = { x: 4150, z: -5920 }; // see the report: the DESIGN.md point is in the sea; this is on the cliff top
{
  const scene = new THREE.Scene();
  const colliders = new Colliders();
  const tickers = [];
  const interactions = [];
  const calls = [];
  const hooks = {
    toast: (t, ms) => calls.push(['toast', t, ms]),
    openPhone: (tab) => calls.push(['openPhone', tab]),
    quiz: (item) => { calls.push(['quiz', item.title, item.q]); return Promise.resolve(true); },
    logWin: (id) => { calls.push(['logWin', id]); return true; },
    sfx: (k) => calls.push(['sfx', k]),
  };
  const t0 = performance.now();
  const house = buildKentHouse({ scene, colliders, tickers, origin: HOME, interactions, hooks });
  const ms = performance.now() - t0;
  const counts = countScene(scene);
  console.log(`built in ${ms.toFixed(0)} ms: ${fmt(counts)}, colliders ${colliders.boxes.length}, tickers ${tickers.length}, interactions ${interactions.length}`);
  console.log('batches:', house.meshes.map((m) => m.name.replace('batch:', '')).join(', '));
  const api = { ...house };
  delete api.group; delete api.meshes; delete api.interactions;
  console.log('api:', fmt(api));

  ok(house.meshes.length <= 40, `house static geometry merged into ${house.meshes.length} draw calls (<= 40)`);
  ok(counts.meshes <= 60, `house scene has ${counts.meshes} meshes in total (<= 60)`);

  // positions near the origin and clear of the colliders
  const spots = [
    ['spawn', house.spawn, 'person'], ['learnerAt', house.learnerAt, 'car', 4.07, 1.75], ['parkedAt', house.parkedAt, 'car', 4.9, 1.88],
    ...house.garage.map((g) => [`garage ${g.id}`, g, 'car', 5.45, 2.16]),
    ...house.slots.map((s, i) => [`slot ${i}`, s, 'car', 5.45, 2.16]),
  ];
  for (const [name, at, kind, L, W] of spots) {
    const d = dist(at, HOME);
    ok(d <= 60, `${name} at (${r1(at.x)}, ${r1(at.z)}) h ${r1(at.heading)} is ${r1(d)} m from the origin (<= 60)`);
    const bad = kind === 'car' ? carClear(colliders, at, L, W) : colliders.hits(at.x, at.z, 0.45, false);
    ok(bad.length === 0, `${name} is clear of the colliders${bad.length ? `: ${fmt(bad.slice(0, 2))}` : ''}`);
  }
  ok(house.garage.length === 5 && ['revuelto', 'f458', 'cullinan', 'chiron', 'g63'].every((id) => house.garage.some((g) => g.id === id)), 'garage lists the five starter cars');
  ok(house.slots.length === 6, 'six purchase bays');
  // the eyesight check: main.js stands you 22 m north of the parked car looking +z at its plate
  const eye = { x: house.parkedAt.x + 1, z: house.parkedAt.z - 22 };
  ok(colliders.hits(eye.x, eye.z, 0.45, false).length === 0, `eyesight viewpoint (${r1(eye.x)}, ${r1(eye.z)}) is clear`);
  let losBlocked = 0;
  for (let k = 0.5; k < 22; k += 0.5) {
    const z = eye.z + k, x = eye.x - k / 22;
    if (colliders.hits(x, z, 0.2, false).length) losBlocked++;
  }
  ok(losBlocked === 0, 'line of sight from the viewpoint to the parked car is clear');
  ok(house.parkedAt.heading === 0, 'parked car heading 0 (nose +z, plate towards the house) as addEyesightCar assumes');
  ok(house.spawn.heading === Math.PI, 'spawn faces north, towards the house');

  // rooms
  const rooms = ['Garage', 'Gym', 'Hall', 'Study', 'Office', 'Lounge', 'Kitchen', 'Garden', 'Motor Court', 'Driveway'];
  const found = new Set();
  for (let lx = -30; lx <= 30; lx += 0.5) for (let lz = -31; lz <= 47; lz += 0.5) { const p = house.place(HOME.x + lx, HOME.z + lz); if (p) found.add(p); }
  ok(rooms.every((r) => found.has(r)), `place() names: ${[...found].join(', ')}`);
  ok(house.place(HOME.x + 3, HOME.z - 3, 3.3) === 'Bedroom' && house.place(HOME.x - 3, HOME.z + 3, 3.3) === 'Landing', 'place(x, z, y) names the upstairs rooms');
  ok(house.indoors(HOME.x, HOME.z) && !house.indoors(HOME.x, HOME.z + 20), 'indoors() covers the shell only');
  ok(house.floorY(HOME.x - 4.2, HOME.z + 6.2) < 0.2 && Math.abs(house.floorY(HOME.x - 4.2, HOME.z + 1.4) - 3.3) < 0.1 && house.floorY(HOME.x + 3, HOME.z - 3, 3.3) === 3.3 && house.floorY(HOME.x + 3, HOME.z - 3, 0) === 0, 'floorY() ramps up the stair and holds 3.3 upstairs');

  // every E prompt stands on a walkable spot and runs
  const labels = [];
  for (const it of interactions) {
    const lab = it.label();
    labels.push(lab);
    ok(colliders.hits(it.x, it.z, 0.45, false).length === 0, `prompt "${lab}" at (${r1(it.x - HOME.x)}, ${r1(it.z - HOME.z)}) local stands clear of the colliders`);
    ok(house.indoors(it.x, it.z) || it.car || /fire/i.test(lab), `prompt "${lab}" is indoors or outside by design`);
    it.action();
  }
  await new Promise((r) => setTimeout(r, 0)); // let the quiz promise settle
  ok(labels.length === 7, `${labels.length} prompts: ${labels.join(' | ')}`);
  ok(interactions[0].label() === 'Close the garage', 'garage prompt toggles its label');
  console.log('hook calls:', calls.map((c) => c.slice(0, 2).join(':')).join(', '));
  ok(calls.some((c) => c[0] === 'openPhone' && c[1] === 'wins'), 'laptop opens the wins tab');
  ok(calls.some((c) => c[0] === 'logWin' && c[1] === 'train'), 'gym logs the train win');
  ok(calls.some((c) => c[0] === 'quiz'), 'study runs a quiz item');
  ok(calls.filter((c) => c[0] === 'toast').length >= 5, 'TV, coffee, gym, fire and the quiz result all toast');
  ok(HIGHWAY_CODE.length === 8 && HIGHWAY_CODE.every((q) => q.a.length === 3 && q.title && q.q), '8 Highway Code items, 3 answers each');
  ok(NEWS.length === 5, '5 news lines');
  // tickers run
  for (const t of [0, 0.5, 1.0, 3.0]) tickers.forEach((f) => f(t));
  ok(true, 'tickers ran for t = 0..3 s');
  // nothing without hooks either
  const bare = [];
  buildKentHouse({ scene: new THREE.Scene(), colliders: new Colliders(), tickers: [], origin: HOME, interactions: bare });
  bare.forEach((it) => it.action());
  ok(true, 'prompts are safe with no hooks at all');
  const inside = house.bounds;
  ok(inside.minX < HOME.x - 30 && inside.maxZ > HOME.z + 42, `bounds ${fmt(inside)}`);
}

// ================= the airfield =================
console.log('\n== Kent Jet Centre ==');
const AIRFIELD = { x: 3870, z: -1946 };
{
  const scene = new THREE.Scene();
  const colliders = new Colliders();
  const tickers = [];
  const t0 = performance.now();
  const af = buildAirfield({ scene, colliders, tickers, origin: AIRFIELD, JETS, STARTER_JETS, buildJet: stubJet, ownedJets: ['phenom300e', 'acj350'] });
  const ms = performance.now() - t0;
  const counts = countScene(scene);
  console.log(`built in ${ms.toFixed(0)} ms: ${fmt(counts)} (jets are stubs: the real buildJet is ~40 meshes each), colliders ${colliders.boxes.length}, tickers ${tickers.length}`);
  console.log('batches:', af.meshes.map((m) => m.name.replace('batch:', '')).join(', '));
  const api = { ...af };
  delete api.group; delete api.meshes;
  console.log('api:', fmt(api));

  const rw = af.runway;
  ok(rw.z1 - rw.z0 >= 420 + 400, `runway ${r1(rw.z1 - rw.z0)} m long along +z (z0 ${r1(rw.z0)} north end, z1 ${r1(rw.z1)})`);
  ok(Math.abs(rw.x - AIRFIELD.x) < 1 && Math.abs(rw.z1 - (AIRFIELD.z + 120)) < 1, 'runway on the aerodrome point\'s centreline, laid 380 m north of it (clear of Maypole village)');
  for (const [name, p] of [['terminal', af.terminal], ['jetPark', af.jetPark], ['entrance', af.entrance]]) {
    ok(p.r === undefined || p.r === 7, `${name} ring r ${p.r ?? '-'}`);
    ok(colliders.hits(p.x, p.z, 0.45, false).length === 0, `${name} at local (${r1(p.x - AIRFIELD.x)}, ${r1(p.z - AIRFIELD.z)}) is walkable`);
  }
  for (const [i, bay] of af.carPark.entries()) ok(carClear(colliders, bay, 5.45, 2.16).length === 0, `car park bay ${i} clear`);
  // the camera lane: nothing taller than an edge light within 50 m WEST of the centreline (the
  // cutscene camera flies at x - 38 / x - 18 / x - 46), from the approach (z0 - 400) to the far
  // end; and nothing at all over the runway surface
  let tall = new Map(), onRunway = 0;
  forEachVertex(scene, (v, o) => {
    if (v.y > 1.2 && v.x > rw.x - 50 && v.x < rw.x + 24 && v.z > rw.z0 - 400 && v.z < rw.z1 + 20) tall.set(o.name || o.type, (tall.get(o.name || o.type) || 0) + 1);
    if (v.y > 0.6 && Math.abs(v.x - rw.x) < 24 && v.z > rw.z0 - 20 && v.z < rw.z1 + 20) onRunway++;
  });
  ok(tall.size === 0, `nothing tall within 50 m west of the centreline (${[...tall.keys()].join(', ') || 'clear'})`);
  ok(onRunway === 0, 'nothing stands on the runway itself');
  ok(af.place(rw.x, rw.z0 + 100) === 'Runway 18/36' && af.place(af.jetPark.x - 20, af.jetPark.z + 60) === 'Jet Park' && af.place(af.terminal.x, af.terminal.z) === 'Kent Jet Centre', 'place() names the runway, Jet Park and the centre');
  // the jets: all starters plus the two bought ones, parked west of the runway facing it
  const jets = [];
  scene.traverse((o) => { if (o.parent === scene && o.isGroup && o.children.length === 3) jets.push(o); });
  ok(jets.length === STARTER_JETS.length + 2, `${jets.length} jets parked (11 starters + 2 bought)`);
  ok(jets.every((j) => j.position.x < rw.x - 60 && Math.abs(j.rotation.y - Math.PI / 2) < 1e-6), 'every jet is west of the runway with its nose towards it');
  af.addJet('g800');
  ok(scene.children.filter((o) => o.isGroup && o.children.length === 3).length === jets.length + 1, 'addJet parks another');
  for (const t of [0, 1, 2]) tickers.forEach((f) => f(t));
  ok(true, 'tickers ran');
  const b = af.bounds;
  ok(b.maxX - b.minX < 300 && b.maxZ - b.minZ < 1000, `bounds ${fmt(b)}`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
