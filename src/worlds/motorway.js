import * as THREE from 'three';
import { setupSky, buildRoad, UK_OVERCAST, Colliders } from './common.js';
import { label } from '../materials.js';
import { mesh } from '../models.js';
import { hdri, pbr, instanced } from '../assets.js';
import { placeSigns } from '../cityroads.js';
import { CITIES, signpost } from '../catalog.js';

// The motorway you drive between cities: a compressed leg of dual carriageway along +z, laid out
// the British way — you drive on the left, oncoming traffic is across the central reservation on
// your right, exits peel off to the left. Three marked lanes each way, gantries naming the cities,
// traffic both ways. The always-on examiner marks the drive (national limit 70, lane discipline)
// and it ends at the exit for your destination.
export const LEG = 4200; // metres of carriageway: a few minutes at 70 mph
const LANES = 3, LW = 3.65, HS = 3.3, RES = 4;
const W = LANES * LW + HS;              // one carriageway incl. hard shoulder (the drawn width)
const LANEW = (W - 1.2) / LANES;        // lane pitch as buildRoad draws the dividers
const OFF = RES / 2 + W / 2;            // carriageway centre from the median
const NB = -OFF, SB = OFF;              // northbound (+z) is the western carriageway; southbound the eastern
const laneX = (c, i, dir) => c + dir * (i - 1) * LANEW; // lane i (0 left .. 2 right) centre, dir = +1 for +z travel

export function buildMotorway(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, { ...UK_OVERCAST, sunAzimuth: 230 });
  const colliders = new Colliders();
  const tickers = [];
  const route = { to: 'london', from: 'kent' }; // set per trip by main.js

  // ---- land + the two carriageways ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, LEG + 1200), pbr('leafy_grass', { repeat: [200, 900], color: 0x97b57f }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, LEG / 2); ground.receiveShadow = true; scene.add(ground);
  const north = buildRoad(new THREE.LineCurve3(new THREE.Vector3(NB, 0, -200), new THREE.Vector3(NB, 0, LEG + 300)), { width: W, lanes: LANES, curbs: false, step: 6 });
  const south = buildRoad(new THREE.LineCurve3(new THREE.Vector3(SB, 0, LEG + 300), new THREE.Vector3(SB, 0, -200)), { width: W, lanes: LANES, curbs: false, step: 6 });
  scene.add(north.mesh, south.mesh);
  // central reservation: grass strip + steel barrier
  const median = new THREE.Mesh(new THREE.PlaneGeometry(RES, LEG + 500), pbr('leafy_grass', { repeat: [1, 300], color: 0x88a872 }));
  median.rotation.x = -Math.PI / 2; median.position.set(0, 0.04, LEG / 2); scene.add(median);
  const barrier = mesh(new THREE.BoxGeometry(0.2, 0.7, LEG + 500), new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.7, roughness: 0.35 }), { cast: false });
  barrier.position.set(0, 0.55, LEG / 2); scene.add(barrier);
  colliders.box(0, LEG / 2, 0.6, LEG + 500);
  for (const s of [1, -1]) colliders.box(s * (OFF + W / 2 + 1.2), LEG / 2, 1.2, LEG + 500); // verge fences
  const lamps = []; for (let z = 0; z <= LEG; z += 40) lamps.push({ x: 0, z, scale: 1.6, rot: 0 });
  scene.add(instanced('lamp_lo', lamps, { chunk: 60, maxDist: 320 }));
  const trees = []; for (let z = -100; z <= LEG + 200; z += 22) for (const s of [1, -1]) trees.push({ x: s * (OFF + W / 2 + 18 + Math.random() * 60), z: z + Math.random() * 10, rot: Math.random() * 6.28, scale: 1.2 + Math.random() * 0.9 });
  scene.add(instanced('island_tree_01', trees, { chunk: 100, maxDist: 420 }));

  // ---- signs on the northbound driver's left verge, facing the oncoming driver ----
  const vergeX = NB - W / 2 - 2.5;
  const signs = [];
  for (let z = 80; z < LEG - 400; z += 900) signs.push({ id: 'speed_nsl', x: vergeX, z, yaw: 0, band: '70' });
  for (const [z, id] of [[LEG - 300, 'countdown_markers'], [LEG - 200, 'countdown_markers'], [LEG - 100, 'countdown_markers']]) signs.push({ id, x: vergeX, z, yaw: 0, band: '70' });
  placeSigns(scene, signs);
  // gantries: a steel portal every ~1 km carrying the destinations (a label sprite keeps the text crisp)
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.75, roughness: 0.4 });
  const gantries = [];
  for (let z = 350; z < LEG; z += 1100) {
    const beam = mesh(new THREE.BoxGeometry(2 * (OFF + W / 2 + 3), 0.6, 0.6), gantryMat); beam.position.set(0, 7.2, z); scene.add(beam);
    for (const s of [1, -1]) { const leg = mesh(new THREE.BoxGeometry(0.5, 7.4, 0.5), gantryMat); leg.position.set(s * (OFF + W / 2 + 3), 3.7, z); scene.add(leg); colliders.box(s * (OFF + W / 2 + 3), z, 1, 1); }
    const g = label('', { size: 1.5 }); g.position.set(NB, 9.6, z); scene.add(g); gantries.push(g);
  }
  // the exit at the end: a slip road off to the LEFT of the northbound carriageway, with the destination board
  const exitZ = LEG - 40;
  const slipX0 = NB - W / 2 + 1;
  const slip = buildRoad(new THREE.CatmullRomCurve3([new THREE.Vector3(slipX0, 0, LEG - 420), new THREE.Vector3(slipX0 - 8, 0, LEG - 200), new THREE.Vector3(slipX0 - 26, 0, LEG + 60)]), { width: 8, curbs: false, y: 0.027, lines: false });
  scene.add(slip.mesh);
  let exitBoard = label('', { size: 1.8, sub: 'Exit' }); exitBoard.position.set(slipX0 - 14, 9, LEG - 160); scene.add(exitBoard);

  // the gantry/exit text is per trip: swap the label sprites
  const setRoute = (from, to) => {
    route.from = from; route.to = to;
    const dest = CITIES[to]?.name || to;
    const others = signpost(from, to);
    gantries.forEach((g, i) => { const miles = Math.max(2, Math.round(((LEG - g.position.z) / LEG) * 60)); const fresh = label(`${dest} ${miles}`, { size: 1.5, sub: others.join(' · ') }); fresh.position.copy(g.position); scene.remove(g); scene.add(fresh); gantries[i] = fresh; });
    const fresh = label(`${dest}`, { size: 1.8, sub: 'Exit · leave the motorway' }); fresh.position.copy(exitBoard.position); scene.remove(exitBoard); scene.add(fresh); exitBoard = fresh;
  };

  /** which lane you're in: { road: 'nb' | 'sb', lane: 0 (left) .. 2 (right), centred } or null off the carriageways */
  const laneAt = (x) => {
    for (const [road, c, dir] of [['nb', NB, 1], ['sb', SB, -1]]) {
      if (Math.abs(x - c) > W / 2 + 0.5) continue;
      // lane numbers rise to the driver's right: +x for northbound, -x for southbound
      const u = (dir * (x - c)) / LANEW + 1;
      const lane = Math.max(0, Math.min(LANES - 1, Math.round(u)));
      return { road, lane, centred: Math.abs(u - lane) < 0.3 };
    }
    return null;
  };

  return {
    id: 'motorway', name: 'MOTORWAY',
    scene, env, colliders,
    roads: [north, south],
    bounds: { minX: -400, maxX: 400, minZ: -220, maxZ: LEG + 320 },
    tick: (t) => tickers.forEach((f) => f(t)),
    life: {
      cars: [
        // offsets are "+ = right of the lane's direction", so lane 1 (left) is -LANEW on both carriageways
        { curve: new THREE.LineCurve3(new THREE.Vector3(NB, 0, -200), new THREE.Vector3(NB, 0, LEG + 300)), closed: false, offset: -LANEW, dir: 1, count: 10, speed: [24, 31] },
        { curve: new THREE.LineCurve3(new THREE.Vector3(NB, 0, -200), new THREE.Vector3(NB, 0, LEG + 300)), closed: false, offset: 0, dir: 1, count: 8, speed: [27, 33] },
        { curve: new THREE.LineCurve3(new THREE.Vector3(SB, 0, LEG + 300), new THREE.Vector3(SB, 0, -200)), closed: false, offset: -LANEW, dir: 1, count: 10, speed: [24, 31] },
        { curve: new THREE.LineCurve3(new THREE.Vector3(SB, 0, LEG + 300), new THREE.Vector3(SB, 0, -200)), closed: false, offset: 0, dir: 1, count: 8, speed: [27, 33] },
      ],
      peds: [],
    },
    // you join in lane 1 (the left lane of the northbound carriageway), already in your car
    spawn: { x: laneX(NB, 0, 1), z: 20, heading: 0 },
    start: { x: laneX(NB, 0, 1), z: 20, heading: 0 },
    exitZ,
    garage: [], slots: [], landmarks: [],
    route, setRoute, laneAt,
    speedLimitAt: () => 70,
    place(x, z) { return z > LEG - 450 ? `Exit for ${CITIES[route.to]?.name || ''}` : `${CITIES[route.from]?.name || ''} → ${CITIES[route.to]?.name || ''}`; },
  };
}
