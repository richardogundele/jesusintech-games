#!/usr/bin/env node
// Drives the driving lessons headless with the careful autopilot, the way src/devtest.js does in the
// browser: the real LessonRun, carefulDriver and Car physics, with KentTraffic, SignalSystem and the
// RoadNet for Kent, and a stand-in Whitmore (its lights, zebra and puffin crossers). esbuild bundles
// the game modules with the Vite-only ones (assets, materials, models) stubbed out, so three.js runs
// without a GPU. Each run steps at 60 Hz in the same order as main.js step().
//
//   node tools/lesson-check.mjs [ids...] [--seeds 1,2,3] [--bad noSignals|noMirrors|speed|runReds|noStops|wrongLane]
//                               [--max 3600] [--lessons path/to/lessons.js] [--colliders] [--quiet] [--json out.json]
//                               [--trace] [--events] [--watch s0,s1] [--detour s] [--hash] [--said]
//                               [--trans manual|auto|none]   the learner car's gearbox (default manual; none = the old arcade car)
//                               [--peds]    how many people crossed, and how many gave up waiting
//   bad variants for the gearbox: stall, wrongGear, coast (manual only) and handbrake
//   --gen herne|canterbury|both [--gseeds 1-20]   generated 15-minute tests (src/kent/test-routes.js), one per
//                               route seed (the traffic uses the same seed); reports sim minutes against the 13-17 target
//   --gen auto --region london   the same, for a city: the pool comes from its baked map (auto-pool.js)
//                               rather than Kent's two authored ones, so a city's roads get driven
//   --colliders builds the Kent tiles along the route (scenery, roads, signs) and adds their colliders,
//   so the car can hit buildings, posts and barriers as in the browser (slower: tiles take a while)
//   ids: lesson ids (moveoff, junctions, ... mock, mock-canterbury, wm-moveoff ...), 'kent', 'whitmore' or 'all'
//
// Exits 1 if a careful run has a serious or dangerous fault or doesn't finish, or a bad run misses its fault.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const BOOL = ['--colliders', '--quiet', '--events', '--trace', '--hash', '--said', '--stalls', '--roads', '--talk', '--genwhy', '--peds'];
if (args.includes('--watch')) BOOL.push();
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BOOL.includes(args[i - 1])));

// ---------- bundle ----------
const STUB_NAMES = {
  'assets.js': ['MODEL_NAMES', 'REAL_FERRARI', 'loadAll', 'hdri', 'pbr', 'texSet', 'model', 'updateCulling', 'instanced', 'modelMaterial', 'modelSize', 'gltf', 'misc'],
  'materials.js': ['facadeMaterial', 'waterMaterial', 'worldMappedMaterial', 'roadTexture', 'groundTexture', 'curbTexture', 'label', 'M'],
  'models.js': ['blobShadow', 'buildCar', 'buildJet', 'buildYacht', 'buildPerson', 'palms', 'planExtrude', 'sideExtrude', 'mesh', 'rocks', 'stonePines', 'buildCasual', 'buildPlayer', 'buildPedestrian'],
};
const stubSource = (file) => `import * as THREE from 'three';
const any = () => { const g = new THREE.Group(); g.userData.animate = () => {}; return g; };
const mat = () => new THREE.MeshBasicMaterial();
${STUB_NAMES[file].map((n) => {
    if (n === 'buildCar') return `export function buildCar(spec = {}) { const L = spec.dims?.L ?? 4.6, W = spec.dims?.W ?? 1.85; const root = new THREE.Group(), body = new THREE.Group(); root.add(body); return { root, body, wheels: [], wheelR: 0.33, length: L, width: W, height: 1.5, radius: Math.hypot(L, W) / 2 }; }`;
    if (n === 'M') return 'export const M = new Proxy({}, { get: () => mat() });';
    if (n === 'MODEL_NAMES') return 'export const MODEL_NAMES = [];';
    if (n === 'REAL_FERRARI') return 'export const REAL_FERRARI = false;';
    if (n === 'misc' || n === 'hdri' || n === 'texSet' || n === 'gltf') return `export const ${n} = () => null;`;
    if (/Material|pbr|Texture|label/.test(n)) return `export const ${n} = () => mat();`;
    return `export const ${n} = (...a) => any(...a);`;
  }).join('\n')}`;
const swapLessons = opt('lessons') ? path.resolve(opt('lessons')) : null;
const entry = `
export * as lessons from './src/lessons.js';
export { Car } from './src/vehicle.js';
export { LEARNER, TRAFFIC } from './src/catalog.js';
export { RoadNet } from './src/kent/net.js';
export { KentTraffic } from './src/kent/traffic.js';
export { SignalSystem } from './src/kent/signals.js';
export { Colliders } from './src/worlds/common.js';
export { makeSceneryBuilder } from './src/kent/scenery.js';
export { makeRoadBuilder, makeRoadMaterials } from './src/kent/roads.js';
export { makeSignBuilder } from './src/kent/signs-place.js';
export * as uk from './src/worlds/uk.js';
export { CENTRES, centreOf, testCentreLayout } from './src/kent/lesson-routes.js';
export * as THREE from 'three';
export * as testRoutes from './src/kent/test-routes.js';
export { autoPool } from './src/kent/auto-pool.js';
export { makeTerrain } from './src/worlds/terrain.js';
export * as dl25 from './src/dl25.js';
`;
const outDir = path.join(REPO, 'node_modules/.cache/lesson-check');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `bundle-${process.pid}.mjs`);
await build({
  stdin: { contents: entry, resolveDir: REPO, loader: 'js' },
  bundle: true, format: 'esm', platform: 'node', outfile: outFile, logLevel: 'error',
  external: ['three', 'three/*'],
  define: { 'import.meta.env': '{"BASE_URL":"/","DEV":true,"PROD":false,"MODE":"development"}' },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /(assets|materials|models)\.js$/ }, (a) => ({ path: path.basename(a.path), namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSource(a.path), resolveDir: REPO, loader: 'js' }));
      if (swapLessons) {
        b.onResolve({ filter: /lessons\.js$/ }, (a) => (a.importer.endsWith('<stdin>') || a.resolveDir === REPO ? { path: swapLessons } : undefined));
        // the swapped file's own relative imports resolve against src/ (it is a copy of src/lessons.js)
        b.onResolve({ filter: /^\.\.?\// }, (a) => (a.importer === swapLessons ? { path: path.resolve(REPO, 'src', a.path) } : undefined));
      }
    },
  }],
});
const G = await import(pathToFileURL(outFile).href);
fs.unlinkSync(outFile);
const { THREE, lessons: Lmod, Car, LEARNER } = G;
const { LESSONS, LessonRun, carefulDriver } = Lmod;

// ---------- deterministic randomness ----------
let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
Math.random = rnd;

// ---------- worlds ----------
const MPH = 2.23694;
// Kent and the cities are the same world, built from the same region.json: only the file differs, so
// a city can be DRIVEN here and not merely planned by testgen-check.
const nets = {};
const regionFile = (id) => path.join(REPO, `public/assets/${id}/region.json`);
const hasRegion = (id) => !!id && fs.existsSync(regionFile(id));
function regionData(id) { return JSON.parse(fs.readFileSync(regionFile(id), 'utf8')); }
function regionNet(id) { if (!nets[id]) nets[id] = new G.RoadNet(regionData(id)); return nets[id]; }
function makeRegion(id) {
  const net = regionNet(id);
  const scene = new THREE.Scene();
  const signals = new G.SignalSystem({ net, rnd });
  // stand-in meshes: KentTraffic.collide only bumps cars whose mesh is showing
  const stubCar = (spec) => ({ root: new THREE.Group(), wheels: [], wheelR: 0.35, radius: Math.hypot(spec.dims?.L ?? 4.6, spec.dims?.W ?? 1.85) / 2 });
  const stubPed = () => { const g = new THREE.Group(); g.userData.animate = () => {}; return g; };
  // the same terrain and the same traffic settings the game builds (worlds/region.js, worlds/kent.js):
  // the hills change what a careful driver can do on them, and a thinner stream of traffic would be a
  // different test from the one the player drives
  const terrain = G.makeTerrain(regionData(id));
  const heightAt = (x, z, prevY = null) => { const t = terrain.heightAt(x, z); return t + net.deckNear(x, z, prevY, t); };
  const gradeAt = (x, z, heading, prevY = null) => {
    const dx = Math.sin(heading) * 3, dz = Math.cos(heading) * 3;
    return (heightAt(x + dx, z + dz, prevY) - heightAt(x - dx, z - dz, prevY)) / 2;
  };
  const traffic = new G.KentTraffic({ net, scene, signals, bodies: G.TRAFFIC, buildCar: stubCar, buildPedestrian: stubPed, rnd, maxCars: 80, maxPeds: 55, groundY: heightAt, gradeAt });
  const rbs = [...net.roundabouts.values()].map((rb) => ({ name: rb.id, x: rb.x, z: rb.z, lane: rb.laneRadius(1), outer: rb.r, sense: rb.sense }));
  const colliders = new G.Colliders();
  let last = 0;
  const w = {
    id, name: id.toUpperCase(), units: 'mph', scene, net, signals, trafficSystem: traffic, traffic, rbs, colliders,
    rbSenseSign: rbs.every((r) => r.sense === rbs[0]?.sense) ? rbs[0]?.sense ?? 1 : 1,
    bounds: net.bounds, cars: [],
    tick(t) { const dt = last ? Math.min(0.1, t - last) : 0; last = t; signals.update(dt); },
    speedLimitAt: (x, z) => net.limitAt(x, z), nslAt: (x, z) => net.nslAt(x, z),
    testCentres: net.testCentres,
  };
  return w;
}
function makeWhitmore() {
  const uk = G.uk, scene = new THREE.Scene();
  const ROAD_W = uk.ROAD_W, ZEBRA = uk.ZEBRA, LIGHTS = uk.LIGHTS;
  const lights = { state: 'green', t: 0 };
  const CYCLE = [['green', 16], ['amber', 3], ['red', 9], ['redamber', 2]];
  let ci = 0;
  const zebra = { busy: false, peds: [] };
  const crosser = (x, phase) => ({ mesh: new THREE.Object3D(), x, state: 'idle', t: phase, z: -(ROAD_W / 2 + 1.2), dir: 1 });
  const zp = crosser(ZEBRA.x, 6), lp = crosser(LIGHTS.x + 1, 0);
  const step = (c, dt, canGo) => {
    c.t -= dt;
    if (c.state === 'idle' && c.t <= 0) { c.state = 'waiting'; c.t = 2.2; }
    else if (c.state === 'waiting' && c.t <= 0 && canGo()) c.state = 'crossing';
    else if (c.state === 'crossing') { c.z += c.dir * 1.35 * dt; if (Math.abs(c.z) > ROAD_W / 2 + 1.2) { c.z = Math.sign(c.z) * (ROAD_W / 2 + 1.2); c.dir *= -1; c.state = 'idle'; c.t = 14 + Math.random() * 14; } }
    c.mesh.position.set(c.x + (c.state === 'idle' ? 2.5 : 0), 0.13, c.z);
  };
  let lastT = 0;
  const w = {
    id: 'uk', units: 'mph', scene, lights, zebra, crossers: [zp, lp], rb: uk.RBS.find((r) => r.town), rbs: uk.RBS, rbSenseSign: uk.rbSense(),
    traffic: { cars: [], peds: [], update() {}, collide() { return false; } },
    colliders: { resolve: () => new THREE.Vector3() }, bounds: { minX: -470, maxX: 1030, minZ: -470, maxZ: 290 }, cars: [],
    tick(t) {
      const dt = Math.min(0.1, Math.max(0, t - (lights.lastT ?? t))); lights.lastT = t; lights.t += dt;
      const holding = lights.state === 'red' && lp.state === 'crossing';
      if (lights.t > CYCLE[ci][1] && !holding) { lights.t = 0; ci = (ci + 1) % CYCLE.length; lights.state = CYCLE[ci][0]; }
      const dt2 = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
      const P = w.player;
      step(zp, dt2, () => !(P && Math.abs(P.x - ZEBRA.x) < 14 && Math.abs(P.z - ZEBRA.z) < 6));
      step(lp, dt2, () => lights.state === 'red' && lights.t < 3);
      zebra.busy = zp.state !== 'idle';
    },
    speedLimitAt: uk.speedLimitAt, nslAt: uk.nslAt,
    learnerAt: { x: -275, z: -uk.LANE, heading: Math.PI / 2 },
  };
  return w;
}

// ---------- --colliders: the buildings, kerbs, posts and barriers the tiles add, along the route ----------
let tileBuilders = null;
const tileParts = new Map(); // tile key -> collider boxes
function addWorldColliders(world, pts) {
  const net = world.net;
  if (!tileBuilders) {
    tileBuilders = [];
    const quiet = console.error; console.error = () => {}; // the sign builder can't draw its textures without a DOM; the posts still come
    try { tileBuilders.push(G.makeSceneryBuilder({ net, tickers: [], colliders: null })); } catch {}
    try { tileBuilders.push(G.makeRoadBuilder({ net, colliders: null, mats: G.makeRoadMaterials({ pbr: () => new THREE.MeshBasicMaterial(), decal: () => new THREE.MeshBasicMaterial(), planting: () => null }) })); } catch {}
    try { tileBuilders.push(G.makeSignBuilder({ net, colliders: null })); } catch {}
    console.error = quiet;
  }
  const want = new Set();
  for (let i = 0; i < pts.length; i += 20) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) want.add(`${Math.floor(pts[i].x / 500) + a},${Math.floor(pts[i].z / 500) + b}`);
  const quiet = [console.error, console.warn, console.log]; console.error = console.warn = console.log = () => {};
  for (const k of want) {
    if (!tileParts.has(k)) {
      const [tx, tz] = k.split(',').map(Number), tile = { tx, tz, x0: tx * 500, z0: tz * 500, x1: (tx + 1) * 500, z1: (tz + 1) * 500, key: k }, list = [];
      for (const b of tileBuilders) { try { const part = b.build(tile, 'near'); list.push(...(part?.colliders || part?.obbs || [])); part?.dispose?.(); } catch {} }
      tileParts.set(k, list);
    }
    for (const c of tileParts.get(k)) world.colliders.obb(c.cx, c.cz, c.w, c.d, c.yaw || 0, c.carOnly !== false);
  }
  [console.error, console.warn, console.log] = quiet;
  // and the eyesight cars main.js parks at the test centres
  for (const key of Object.keys(G.CENTRES)) {
    const L = G.testCentreLayout(net, G.centreOf(net, key));
    if (L.bays.length) { const b = L.bays[L.bays.length - 1]; world.colliders.obb(b.x, b.z, 2.0, 4.8, b.heading); }
    else { const h = L.hit, off = h.way.halfW + 6; world.colliders.obb(h.px - L.n[0] * off, h.pz - L.n[1] * off, 2.0, 4.8, Math.atan2(h.dir[0], h.dir[1])); }
  }
}

// ---------- one run ----------
const BAD = { noSignals: { noSignals: true }, noMirrors: { noMirrors: true }, speed: { speed: 1.3 }, runReds: { runReds: true }, noStops: { noStops: true }, wrongLane: { wrongLane: true },
  stall: { stall: true }, wrongGear: { wrongGear: true }, coast: { coast: true }, handbrake: { handbrake: true } };
const TRANS = opt('trans', 'manual');
// the fault each bad driver must be given
const WANT = { noSignals: /^Signals: necessary/, noMirrors: /^Mirrors|^Move off: safety/, speed: /^Speed/, runReds: /traffic lights|^Pedestrian crossings/, noStops: /emerged without slowing/, wrongLane: /lane discipline|wrong lane/,
  stall: /stalled/, wrongGear: /^Control: gears/, coast: /coasting/, handbrake: /parking brake/ };
async function runLesson(def, s0, bad = null, maxSec = 3600) {
  seed = s0;
  const regionId = def.world && hasRegion(def.world) ? def.world : !def.world && !def.stops ? 'kent' : null;
  const kent = !!regionId; // a real baked map (Kent or a city), not the stand-in Whitmore
  const world = kent ? makeRegion(regionId) : makeWhitmore();
  const trans = def.trans || (TRANS === 'none' ? null : TRANS);
  const car = new Car('learner', world.learnerAt || { x: 0, z: 0, heading: 0 }, trans ? { ...LEARNER, trans } : LEARNER);
  world.cars.push(car);
  const drive = { indicator: null, lastInd: null, turned: 0, mirrorPressed: false, trafficHit: false };
  let result = null, cancelled = null;
  const said = [];
  const hooks = {
    say: (t) => said.push(t), hud: () => {}, flash: () => {}, estop: () => {}, satnav: () => {},
    quiz: () => Promise.resolve(true), result: (r) => { result = r; }, cancelled: (why) => { cancelled = why || 'cancelled'; },
    parkedCar: (p) => world.colliders.obb?.(p.x, p.z, 1.9, 4.5, p.heading), // a body like the eyesight car's
  };
  const t0 = Date.now();
  const run = new LessonRun(world, def, hooks);
  if (kent && flag('colliders')) addWorldColliders(world, run.route.pts);
  if (bad?.runReds && kent) {
    const first = run.events.find((e) => e.kind === 'lights'), sig = world.signals, orig = sig.stateFor.bind(sig);
    if (first) sig.stateFor = (id, yaw) => (id === first.group && Math.abs(run.s - first.lineS) < 60 ? 'red' : orig(id, yaw));
  }
  if (flag('roads')) { // --roads: the roads the route uses, in order, with the length on each
    const out = []; let last = null;
    for (const p of run.route.pts) { const w = world.net.ways.get(p.way), n = p.rb ? `(rb ${p.rb})` : w ? [w.ref, w.name].filter(Boolean).join(' ') || `way ${w.id}` : '?'; if (n !== last?.n) { last = { n, s0: p.s, lim: p.road?.limit }; out.push(last); } last.s1 = p.s; }
    console.log('   ' + out.map((r) => `${r.n} ${Math.round(r.s1 - r.s0)}m@${r.lim}`).join(' > '));
  }
  if (flag('events')) for (const e of run.events) console.log(`   ${e.s.toFixed(0).padStart(6)} ${e.kind.padEnd(10)} ${(e.dir || '').padEnd(5)}${e.exit != null ? ` exit ${e.exit} lanes ${e.approachLane}/${e.ringLane}/${e.exitLane} ${e.rb} exitS ${e.exitS?.toFixed(0)} sigL ${e.signalLeftS?.toFixed(0)}` : ''}${e.lineS != null ? ` line ${e.lineS.toFixed(0)}` : ''}${e.group ? ' ' + e.group : ''}${e.stopS ? ' stopS ' + e.stopS.toFixed(0) : ''}${e.angled ? ' angled' : ''} ${e.text || ''}`);
  const nFault = { n: 0 };
  const st = run.route.start;
  car.pos.set(st.x, 0, st.z); car.heading = st.heading; car.park();
  car.prepare({ engineOn: !def.engineOff, parkingBrake: true }); // as main.js startLesson
  if (kent) { world.traffic.P.x = st.x; world.traffic.P.z = st.z; }
  const autoState = { debug: true };
  let prog = { s: -1, t: 0 }, stall = null;
  const stall0 = {};
  const watch = opt('watch') ? opt('watch').split(',').map(Number) : null;
  let lastWatch = -1;
  const dt = 1 / 60;
  const detourAt = opt('detour') ? +opt('detour') : null;
  let otherHits = 0; // frames a traffic car was driving into us (not marked)
  let detoured = null;
  let elapsed = 0, f = 0, maxLat = 0, trace = 7; // trace: a hash of the drive, to compare two versions of the code
  for (; f < maxSec * 60 && !result && !cancelled; f++) {
    if (run.waiting) { await null; await null; }
    elapsed += dt;
    world.tick(elapsed);
    const obstacle = { x: car.pos.x, z: car.pos.z, r: car.model.radius * 0.6, heading: car.heading, L: car.model.length, W: car.model.width };
    world.traffic.update(dt, obstacle, { x: car.pos.x, z: car.pos.z });
    world.player = obstacle;
    // --detour s: at s, put the car on a road off the route (as if it took a wrong turn) to test rerouting
    if (detourAt != null && !detoured && run.s > detourAt && run.moved && kent) {
      const used = new Set(run.route.route.ways.map((w) => w.way.id)), net = world.net;
      let pick = null;
      for (const { way } of net.grid.near(car.pos.x, car.pos.z, 120)) if (!used.has(way.id) && !way.rb && way.len > 80 && way.cls !== 'service' && !way.oneway) { pick = way; break; }
      if (pick) {
        const p = net.pointAt(pick, pick.len / 2), d = net.dirAt(pick, pick.len / 2);
        car.pos.set(p[0] + d[1] * 1.6, 0, p[1] - d[0] * 1.6); car.heading = Math.atan2(d[0], d[1]); car.park();
        detoured = { way: pick.name || pick.id, at: Math.round(run.s), len: Math.round(run.route.length) };
      }
    }
    const o = carefulDriver(run, car, autoState, bad);
    drive.indicator = o.indicator;
    if (o.mirror) drive.mirrorPressed = true;
    const prevHeading = car.heading;
    const res = car.update(dt, o.input, world);
    // main.js updateIndicators: self-cancel once a real turn is done
    if (drive.indicator !== drive.lastInd) { drive.lastInd = drive.indicator; drive.turned = 0; }
    if (drive.indicator) { const dh = car.heading - prevHeading; drive.turned += Math.atan2(Math.sin(dh), Math.cos(dh)); if (Math.abs(drive.turned) > 1.05 && Math.abs(car.steer) < 0.04) drive.indicator = null; }
    run.update(dt, car, { indicator: drive.indicator, mirrorPressed: drive.mirrorPressed, hit: res.hit || drive.trafficHit });
    drive.mirrorPressed = false; drive.trafficHit = false;
    if (car.drive && flag('stalls')) { // --stalls: say what the feet were doing when the engine died or a gear crunched
      const k = `${car.drive.stalls}/${car.drive.grinds}`;
      if (k !== (stall0.k ?? '0/0')) console.log(`   STALL/GRIND ${k} t ${elapsed.toFixed(1)} s ${run.s.toFixed(0)} gear ${car.gear} mph ${(car.vF * MPH).toFixed(1)} rpm ${car.rpm.toFixed(0)} pedal ${car.clutch.toFixed(2)} want ${((o.want ?? 0) * MPH).toFixed(1)} rev ${!!o.reverse} pb ${car.parkingBrake} moved ${run.moved} in ${JSON.stringify(o.input)}`);
      stall0.k = k;
    }
    const before = flag('trace') ? world.traffic.cars.map((c) => ({ c, x: c.x, z: c.z, v: c.v, held: c.held, ghost: c.ghost, block: c.blockId, ev: `${c.ev[c.evI]?.kind}@${((c.ev[c.evI]?.s ?? 0) - c.s).toFixed(0)}` })) : null;
    if (world.traffic.collide(car)) {
      car.sync(0); drive.trafficHit = world.traffic.lastHit?.blame !== 'other';
      if (!drive.trafficHit) otherHits++;
      if (before) for (const b of before) if (b.c.stun === 2.5) { const fx = Math.sin(car.heading), fz = Math.cos(car.heading), dx = b.x - car.pos.x, dz = b.z - car.pos.z; console.log(`   HIT t ${elapsed.toFixed(1)} s ${run.s.toFixed(0)} me (${car.pos.x.toFixed(1)},${car.pos.z.toFixed(1)}) h${Math.round(car.heading * 57.3)} mph ${(car.vF * MPH).toFixed(1)} | #${b.c.id} ahead ${(dx * fx + dz * fz).toFixed(1)} side ${(dx * fz - dz * fx).toFixed(1)} h${Math.round(b.c.heading * 57.3)} v${b.v.toFixed(1)} held ${b.held} ghost ${(b.ghost || 0).toFixed(1)} block ${b.block} ev ${b.ev} rb ${b.c.lane.rb} bot ${JSON.stringify(autoState.dbg && Object.fromEntries(Object.entries(autoState.dbg).map(([k, v]) => [k, typeof v === 'number' ? +(v * MPH).toFixed(1) : v])))}`); }
    }
    if (run.moved) maxLat = Math.max(maxLat, run.dist);
    if (f % 30 === 0) trace = (trace * 31 + Math.round(car.pos.x * 100) * 7 + Math.round(car.pos.z * 100) + (drive.indicator ? 3 : 0) + run.faults.length * 11) >>> 0;
    // stuck for two minutes: say why and stop the run
    if (Math.abs(run.s - prog.s) > 3) prog = { s: run.s, t: elapsed };
    else if (elapsed - prog.t > 120) {
      const d = autoState.dbg || {}, fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const near = world.traffic.cars.map((c) => ({ c, d: Math.hypot(c.x - car.pos.x, c.z - car.pos.z) })).filter((q) => q.d < 30).sort((a, b) => a.d - b.d).slice(0, 6)
        .map(({ c, d: dd }) => `#${c.id} ${dd.toFixed(1)}m ahead ${((c.x - car.pos.x) * fx + (c.z - car.pos.z) * fz).toFixed(1)} v${c.v.toFixed(1)} h${Math.round(c.heading * 57.3)} held ${c.held} block ${c.blockId} stopT ${c.stopT.toFixed(0)} ev ${c.ev[c.evI]?.kind}@${((c.ev[c.evI]?.s ?? 0) - c.s).toFixed(0)}`);
      const evs = run.events.filter((e) => (e.lineS ?? e.entryS ?? e.s) > run.s - 30 && (e.lineS ?? e.entryS ?? e.s) < run.s + 60).map((e) => `${e.kind}@${((e.lineS ?? e.entryS ?? e.s) - run.s).toFixed(0)}${e.group ? ' ' + e.group + ':' + world.signals?.stateFor(e.group, car.heading) : ''}${e.phase ? ' ' + e.phase : ''}${e.botGo ? ' go' : ''}`);
      // follow the queue ahead to whatever it is waiting for
      const byId = new Map(world.traffic.cars.map((c) => [c.id, c])), chain = [];
      let head = world.traffic.cars.filter((c) => (c.x - car.pos.x) * fx + (c.z - car.pos.z) * fz > 0).sort((a, b) => Math.hypot(a.x - car.pos.x, a.z - car.pos.z) - Math.hypot(b.x - car.pos.x, b.z - car.pos.z))[0];
      for (let k = 0; head && k < 20; k++) { chain.push(`#${head.id}(${head.x.toFixed(0)},${head.z.toFixed(0)}) v${head.v.toFixed(1)} held ${head.held} ghost ${(head.ghost || 0).toFixed(1)} ev ${head.ev[head.evI]?.kind}@${((head.ev[head.evI]?.s ?? 0) - head.s).toFixed(0)} end ${(head.ps[head.n - 1] - head.s).toFixed(0)}`); head = head.blockId > 0 ? byId.get(head.blockId) : null; if (head && chain.some((c) => c.startsWith(`#${head.id}(`))) { chain.push('(loop)'); break; } }
      stall = { chain, at: [+car.pos.x.toFixed(1), +car.pos.z.toFixed(1)], s: Math.round(run.s), moved: run.moved, want: { plan: +((d.plan ?? 0) * MPH).toFixed(1), events: +((d.events ?? 0) * MPH).toFixed(1), traffic: +((d.traffic ?? 0) * MPH).toFixed(1) }, events: evs, cars: near };
      break;
    }
    if (watch && run.s >= watch[0] && run.s <= watch[1] && Math.floor(elapsed * 2) !== lastWatch) {
      lastWatch = Math.floor(elapsed * 2);
      const d = autoState.dbg || {};
      const near = world.traffic.cars.map((c) => ({ id: c.id, d: Math.hypot(c.x - car.pos.x, c.z - car.pos.z), v: c.v, h: Math.round(c.heading * 57.3), held: c.held })).filter((c) => c.d < 40).map((c) => `#${c.id} ${c.d.toFixed(0)}m v${c.v.toFixed(1)} h${c.h}${c.held ? ' held' : ''}`);
      console.log(`   t ${elapsed.toFixed(1)} s ${run.s.toFixed(1)} mph ${(car.vF * MPH).toFixed(1)} lat ${run.lat.toFixed(2)} plan ${((d.plan ?? 0) * MPH).toFixed(1)} ev ${((d.events ?? 0) * MPH).toFixed(1)} tr ${((d.traffic ?? 0) * MPH).toFixed(1)} ind ${drive.indicator} moved ${run.moved}${car.drive ? ` gear ${car.gear} rpm ${car.rpm.toFixed(0)} clutch ${car.clutch.toFixed(2)} thr ${car.drive.throttle.toFixed(2)}` : ''} | ${near.join(', ')}`);
    }
    if (flag('trace') && run.faults.length > nFault.n) {
      for (const x of run.faults.slice(nFault.n)) if (x.extra?.ped) { const ps = (world.traffic.peds || []).map((q) => ({ d: Math.hypot(q.x - car.pos.x, q.z - car.pos.z), st: q.state, inRoad: q.inRoad, way: q.way?.id, lat: q.lat?.toFixed?.(2), x: q.x.toFixed(1), z: q.z.toFixed(1) })).sort((a, b) => a.d - b.d).slice(0, 2); console.log('   ped', JSON.stringify(ps), 'car heading', (car.heading * 57.3).toFixed(0), 'way', run.route.pts[run.idx].way); }
      for (const x of run.faults.slice(nFault.n)) console.log(`   FAULT t ${elapsed.toFixed(1)} s ${run.s.toFixed(0)} ${x.sev}:${x.cat} at (${car.pos.x.toFixed(1)}, ${car.pos.z.toFixed(1)}) mph ${(Math.abs(car.vF) * MPH).toFixed(1)} lat ${run.lat.toFixed(2)} lane ${run.route.pts[run.idx].lane} sigs ${JSON.stringify(run.sig.filter((q) => q.s > run.s - 120).map((q) => q.dir[0] + Math.round(q.s)).filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || i === a.length - 1))} mirrors ${JSON.stringify(run.mirror.filter((m) => m.s > run.s - 150).map((m) => Math.round(m.s)))}`);
      nFault.n = run.faults.length;
    }
  }
  return {
    id: def.id, seed: s0, trans: car.trans + (car.drive ? '' : ' (arcade)'), stalls: car.drive?.stalls ?? 0, grinds: car.drive?.grinds ?? 0, bad: bad ? Object.keys(bad)[0] : null, done: !!result, cancelled, passed: result?.passed ?? false,
    counts: result?.counts || run.counts(), faults: run.faults.map((x) => `${x.sev[0]}:${x.cat}@${Math.round(x.s)}${x.at ? ` (${x.at.x},${x.at.z})` : ''}`),
    trace, frames: f, otherHits, colliders: world.colliders.boxes?.length ?? 0, detoured, rerouted: said.filter((t) => /recalculated|take you back/.test(t)).length, satnav: said.filter((t) => t.startsWith('Sat nav')).length, simMin: +(elapsed / 60).toFixed(1), wallS: +((Date.now() - t0) / 1000).toFixed(1), length: Math.round(run.route.length), s: Math.round(run.s),
    said, tasks: result?.tasks,
    peds: world.traffic.stats, estop: run.estop?.state || 'none', maxDist: +maxLat.toFixed(1), stuckAt: result ? null : { x: +car.pos.x.toFixed(1), z: +car.pos.z.toFixed(1), text: run.text }, stall,
  };
}

// ---------- which ---------
const all = LESSONS;
let list = [];
for (const id of ids.length ? ids : ['all']) {
  if (id === 'all') list.push(...all);
  else if (id === 'kent') list.push(...all.filter((l) => l.world === 'kent'));
  else if (id === 'whitmore') list.push(...all.filter((l) => l.world !== 'kent'));
  else { const l = all.find((x) => x.id === id); if (!l) { console.error(`no lesson ${id}`); process.exit(2); } list.push(l); }
}
// a lesson for the other gearbox (clutch control in an automatic) is skipped
if (TRANS !== 'none') list = list.filter((l) => !l.trans || l.trans === TRANS);
const range = (t) => t.split(',').flatMap((x) => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const seeds = range(opt('seeds', '1'));
// generated tests: one def per route seed
const genRuns = [];
if (opt('gen')) {
  // --region <id> drives a city instead of Kent: the pool is read off its map by autoPool, exactly as
  // the game does on the way to a city test, so these runs exercise the city's own roads and traffic.
  const REG = opt('region') || null;
  if (REG && !hasRegion(REG)) { console.error(`no baked map at ${regionFile(REG)}`); process.exit(2); }
  const genNet = regionNet(REG || 'kent');
  const pools = REG ? [G.autoPool(genNet, genNet.testCentres[0], { key: REG, world: REG })] : opt('gen') === 'both' ? ['herne', 'canterbury'] : [opt('gen')];
  for (const centre of pools) for (const gs of range(opt('gseeds', '1-5'))) {
    try { const win = opt('genwin') ? opt('genwin').split(',').map(Number) : null;
    const gen = G.testRoutes.generateTest(genNet, centre, gs, flag('genwhy') || win || opt('signs') ? { ...(win ? { minMin: win[0], maxMin: win[1] } : {}), ...(opt('signs') ? { signsRate: +opt('signs') } : {}), log: !flag('genwhy') ? null : (k, used, why, mins, rt) => console.log(`   try ${k}: ${used.join(',')} ${mins.toFixed(1)} min ${(rt.length / 1000).toFixed(1)} km: ${why.join(', ') || 'OK'} | ${rt.events.filter((e) => ['turn', 'emerge', 'cross'].includes(e.kind)).map((e) => e.kind[0] + (e.dir || '')[0]).join('')}`) } : {}); gen.signs = G.testRoutes.signsOnRoute(genNet, gen.route); genRuns.push({ def: Lmod.testDef(gen), seed: gs, gen }); }
    catch (err) { console.log(`FAIL generate ${centre.key || centre} seed ${gs}: ${err.message}`); genRuns.push({ fail: true }); }
  }
  list = [];
}
const bad = opt('bad') ? BAD[opt('bad')] : null;
if (opt('bad') && !bad) { console.error(`bad variants: ${Object.keys(BAD).join(', ')}`); process.exit(2); }
const maxSec = +opt('max', 3600);
const out = [];
let failed = 0;
const jobs = genRuns.length ? genRuns.filter((g) => !g.fail).map((g) => [g.def, g.seed, g]) : list.flatMap((def) => seeds.map((s) => [def, s, null]));
failed += genRuns.filter((g) => g.fail).length;
for (const [def, s, gen] of jobs) {
  const r = await runLesson(def, s, bad, maxSec);
  if (gen) { const m = gen.gen.meta; r.id = `${m.centre}#${m.seed}`; console.log(`   route ${m.centreName} seed ${m.seed}: ${(m.length / 1000).toFixed(2)} km, est ${m.minutes} min, ${m.manoeuvre}, ${m.stops} pull-up(s), independent ${m.indep.mode}${m.indep.target ? ` (signs for ${m.indep.target})` : ''}, ${m.attempts} tr${m.attempts === 1 ? 'y' : 'ies'}; ${m.stretches.join(' / ')}`); if (!flag('quiet')) console.log(`   signs: ${gen.gen.signs.map((x) => `${x.sign}${x.n > 1 ? ' x' + x.n : ''}`).join(', ')}`); }
  out.push(r);
  const serious = r.counts.serious + r.counts.dangerous;
  const badKey = opt('bad'), hits = bad ? r.faults.filter((x) => WANT[badKey].test(x.replace(/^[a-z]:/, ''))).length : 0;
  let ok = bad ? hits > 0 : r.done && serious === 0;
  if (gen && !bad && (r.simMin < 13 || r.simMin > 17)) { ok = false; r.timeFail = true; }
  if (bad) r.matching = hits;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.trans.padEnd(6)} seed ${s}${r.bad ? ` bad ${r.bad}` : ''}: ${r.done ? (r.passed ? 'passed' : 'not passed') : r.cancelled ? `cancelled (${r.cancelled})` : `did not finish (s ${r.s} of ${r.length} m at ${JSON.stringify(r.stuckAt)})`}, ${r.counts.minor} minor ${r.counts.serious} serious ${r.counts.dangerous} dangerous, route ${(r.length / 1000).toFixed(2)} km, ${r.simMin} sim min, ${r.wallS} s wall, estop ${r.estop}${r.stalls || r.grinds ? `, STALLS ${r.stalls} grinds ${r.grinds}` : ''}${r.otherHits ? `, hit by traffic (${r.otherHits} frames)` : ''}${flag('colliders') ? `, ${r.colliders} colliders` : ''}${bad ? `, ${r.matching} matching ${opt('bad')} fault(s)` : ''}${flag('hash') ? `, trace ${r.trace} frames ${r.frames}` : ''}${r.timeFail ? ' (OUTSIDE 13-17 min)' : ''}`);
  if (!flag('quiet') && r.faults.length) console.log('      ' + r.faults.join('\n      '));
  if (flag('peds')) { const p = r.peds; console.log(`      crossed: zebra ${p.zebraCrossings} (gave up ${p.zebraGaveUp}), signals ${p.signalCrossings} (gave up ${p.signalGaveUp}); squeezed ${p.squeezed || 0}, watchdog ${p.watchdog}`); }
  if (r.stall) console.log('      STALL ' + JSON.stringify(r.stall, null, 0));
  if (flag('talk')) console.log('      SAID ' + r.said.map((t, i) => `${i}: ${t}`).join('\n      SAID ') + (r.tasks ? `\n      TASKS ${JSON.stringify(r.tasks)}` : ''));
  if (r.detoured || flag('said')) console.log(`      detour ${JSON.stringify(r.detoured)}, reroutes ${r.rerouted}, sat nav callouts ${r.satnav}`);
}
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(out, null, 1));
console.log(failed ? `\n${failed} run(s) FAILED` : '\nall runs ok');
process.exit(failed ? 1 : 0);
