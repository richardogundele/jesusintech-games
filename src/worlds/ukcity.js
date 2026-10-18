import * as THREE from 'three';
import { setupSky, buildRoad, distToRoads, buildingBlocks, buildingDetails, Colliders, modernTowers, broadleafTrees } from './common.js';
import { M, label } from '../materials.js';
import { buildJet, mesh } from '../models.js';
import { JETS, STARTER_JETS } from '../catalog.js';
import { hdri, pbr, instanced } from '../assets.js';
import { buildAirfield } from '../kent/airfield.js';
import { cityLights, placeSigns } from '../cityroads.js';
import { buildBillboard, BILLBOARDS } from '../brandart.js';
import { brickTexture, BRICKS } from './uk.js';

// A British city you can fly or drive to: a ring road round a brick-built centre with a
// roundabout and four radial streets, a modern skyline, real UK signs and working lights,
// your cars waiting at the drop-off, and a proper airfield (Kent's module) for the jets.
// One builder, parameterised per city, so London, Birmingham and Manchester share the bones
// but differ in skyline, landmark and colour.

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);
const RING = 240;      // ring road radius
const RB = 22;         // central roundabout radius
const AIR = { x: 640, z: -40 }; // the airfield origin, east of the ring

export function buildUKCity(renderer, spec) {
  const { id, name, landmark, towers = [], skyline = 0x8d98a6, arena = false, ownedJets = [] } = spec;
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    hdri: hdri('monaco'), sunAzimuth: 205, exposure: 0.92, envIntensity: 0.8,
    sunColor: 0xfff3e2, sunIntensity: 2.6, fogDensity: 0.00075, fogTint: 0.9,
  });
  const colliders = new Colliders();
  const tickers = [];

  // ---- ground ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2000), pbr('leafy_grass', { repeat: [380, 320], color: 0x9fbb88 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const centre = new THREE.Mesh(new THREE.CircleGeometry(RING + 14, 96), pbr('rectangular_paving', { repeat: [120, 120], color: 0xc3bfb6 }));
  centre.rotation.x = -Math.PI / 2; centre.position.y = 0.012; centre.receiveShadow = true; scene.add(centre);

  // ---- roads: ring, central roundabout, four radials, and a link out to the airfield ----
  const ringPts = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return V(Math.cos(a) * RING, Math.sin(a) * RING); });
  const ring = buildRoad(new THREE.CatmullRomCurve3(ringPts, true, 'centripetal'), { closed: true, width: 14 });
  const rbPts = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return V(Math.cos(a) * RB, Math.sin(a) * RB); });
  const rbRoad = buildRoad(new THREE.CatmullRomCurve3(rbPts, true, 'centripetal'), { closed: true, width: 10, lanes: 2, lines: true }); // two marked lanes round the island
  const radials = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => buildRoad(new THREE.LineCurve3(V(dx * (RB + 2), dz * (RB + 2)), V(dx * (RING - 2), dz * (RING - 2))), { width: 12 }));
  const airLink = buildRoad(new THREE.CatmullRomCurve3([V(RING, 0), V(400, -10), V(AIR.x - 160, AIR.z + 440), V(AIR.x - 60, AIR.z + 470)]), { width: 12, curbs: false, y: 0.025 });
  const roads = [ring, rbRoad, ...radials, airLink];
  roads.forEach((r) => scene.add(r.mesh));
  // roundabout island
  const island = mesh(new THREE.CylinderGeometry(RB - 6, RB - 5.6, 0.5, 48), pbr('leafy_grass', { repeat: [3, 3], color: 0xa6c48a }), { receive: true, cast: false });
  island.position.y = 0.25; scene.add(island);
  colliders.box(0, 0, (RB - 6) * 1.4, (RB - 6) * 1.4);
  const mon = mesh(new THREE.CylinderGeometry(1.2, 1.6, 9, 12), M.stone); mon.position.y = 4.5; scene.add(mon);

  // ---- the brick centre: terraces and blocks in the four quadrants ----
  const brickCols = [0x9a5a44, 0x7e4a3a, 0xb0745a, 0x6e3e32, 0xa8705a, 0x8a5240];
  const blocks = [];
  for (let x = -RING + 20; x <= RING - 20; x += 26) {
    for (let z = -RING + 20; z <= RING - 20; z += 26) {
      const r = Math.hypot(x, z);
      if (r < RB + 24 || r > RING - 22) continue;
      const bx = x + rand(-3, 3), bz = z + rand(-3, 3), w = rand(11, 18), d = rand(11, 18);
      if (distToRoads(bx, bz, roads) < Math.max(w, d) / 2 + 9) continue;
      blocks.push({ x: bx, z: bz, w, d, h: rand(8, 22), color: pick(brickCols) });
      colliders.box(bx, bz, w, d);
    }
  }
  scene.add(buildingBlocks(blocks, { winSize: [1.7, 2.3], winColor: 0x1b222b, amount: 0.9, brighten: 1.12 }));
  scene.add(buildingDetails(blocks, roads, { floor: 3.1 }));
  // slate-ish flat roofs are the blocks' tops; a few pitched roofs on the smaller terraces
  const brick = new THREE.MeshStandardMaterial({ map: brickTexture(BRICKS[1]), roughness: 0.95 });
  for (const b of blocks.filter((b) => b.h < 12 && Math.random() < 0.5)) {
    const roof = mesh(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.62, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.85 }));
    roof.rotation.y = Math.PI / 4; roof.position.set(b.x, b.h + 1.6, b.z); scene.add(roof);
  }
  // ---- skyline: the city's towers beyond the ring ----
  const towerSpecs = towers.map((t) => ({ ...t, color: t.color ?? skyline }));
  if (towerSpecs.length) {
    scene.add(modernTowers(towerSpecs, { winSize: [2.6, 3.4], winColor: 0x1a2430, amount: 0.95, metalness: 0.35, roughness: 0.35 }));
    for (const t of towerSpecs) colliders.box(t.x, t.z, t.w, t.d);
  }
  const lm = label(landmark.name, { size: landmark.size ?? 2.6, sub: name });
  lm.position.set(landmark.x, landmark.y ?? 60, landmark.z); scene.add(lm);

  // ---- trees along the ring and in the quadrants ----
  const tree = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; tree.push({ x: Math.cos(a) * (RING + 12), z: Math.sin(a) * (RING + 12), rot: rand(0, 6.28), scale: rand(1.1, 1.6) }); }
  for (let i = 0; i < 60; i++) { const x = rand(-RING, RING), z = rand(-RING, RING); if (Math.hypot(x, z) < RING - 10 && distToRoads(x, z, roads) > 10 && !colliders.boxes.some((b) => x > b.minX - 2 && x < b.maxX + 2 && z > b.minZ - 2 && z < b.maxZ + 2)) tree.push({ x, z, rot: rand(0, 6.28), scale: rand(1, 1.5) }); }
  scene.add(instanced('island_tree_02', tree, { chunk: 80, maxDist: 320 }));
  // street lamps round the ring
  const lamps = ringPts.flatMap((p, i) => { const n = p.clone().normalize(); return [1, -1].map((s) => ({ x: p.x + n.x * 9 * s, z: p.z + n.z * 9 * s, scale: 1.3, rot: Math.atan2(n.x, n.z) })); });
  scene.add(instanced('lamp_lo', lamps, { chunk: 60, maxDist: 260 }));

  // ---- road furniture: lights at the roundabout approaches, real signs on the radials and ring ----
  const lights = cityLights(scene, [
    // signalled junctions on the ring where the east and west radials meet it (one head per direction)
    { x: RING + 8, z: 14, yaw: 0, offset: 0 }, { x: RING - 8, z: -14, yaw: Math.PI, offset: 12 },
    { x: -RING - 8, z: -14, yaw: Math.PI, offset: 6 }, { x: -RING + 8, z: 14, yaw: 0, offset: 18 },
    { x: RB + 30, z: 8, yaw: Math.PI / 2, offset: 0 }, { x: -(RB + 30), z: -8, yaw: -Math.PI / 2, offset: 12 },
    { x: 8, z: -(RB + 30), yaw: Math.PI, offset: 6 }, { x: -8, z: RB + 30, yaw: 0, offset: 18 },
    { x: RING - 60, z: 8, yaw: Math.PI / 2, offset: 3 }, { x: -(RING - 60), z: -8, yaw: -Math.PI / 2, offset: 15 },
  ]);
  tickers.push((t) => lights.tick(t));
  placeSigns(scene, [
    { id: 'roundabout_ahead', x: RB + 70, z: 8, yaw: Math.PI / 2 }, { id: 'roundabout_ahead', x: -(RB + 70), z: -8, yaw: -Math.PI / 2 },
    { id: 'roundabout_ahead', x: 8, z: -(RB + 70), yaw: Math.PI }, { id: 'roundabout_ahead', x: -8, z: RB + 70, yaw: 0 },
    { id: 'give_way', x: RB + 8, z: 8, yaw: Math.PI / 2 }, { id: 'give_way', x: -8, z: RB + 8, yaw: 0 },
    { id: 'speed_30', x: RING - 120, z: 8, yaw: Math.PI / 2 }, { id: 'speed_30', x: -(RING - 120), z: -8, yaw: -Math.PI / 2 },
    { id: 'speed_30', x: 8, z: -(RING - 120), yaw: Math.PI }, { id: 'speed_30', x: -8, z: RING - 120, yaw: 0 },
    { id: 'traffic_signals_ahead', x: RING - 110, z: 8, yaw: Math.PI / 2 }, { id: 'school_children', x: 8, z: -(RING - 150), yaw: Math.PI },
    { id: 'no_entry', x: 20, z: RING - 60, yaw: 0 }, { id: 'zebra_crossing_ahead', x: -(RING - 160), z: -8, yaw: -Math.PI / 2 },
    { id: 'speed_40', x: RING + 9, z: -40, yaw: Math.PI }, { id: 'keep_left_bollard', x: RB + 1.5, z: 6.5, yaw: Math.PI / 2 },
  ]);
  // brand billboards on the ring
  [[0, RING + 24, Math.PI, 1], [-RING - 24, 0, Math.PI / 2, 0], [RING + 24, 60, -Math.PI / 2, 4]].forEach(([x, z, rot, i]) => {
    const bb = buildBillboard({ width: 16, spec: BILLBOARDS[i] }); bb.position.set(x, 0, z); bb.rotation.y = rot; scene.add(bb); colliders.box(x, z, 4, 4);
  });

  // ---- the airfield: terminal, runway, jet park (Kent's module) ----
  const air = buildAirfield({ scene, colliders, tickers, origin: AIR, JETS, STARTER_JETS, buildJet, ownedJets, materials: { pbr } });
  const airLabel = label(`${name} Jet Centre`, { size: 1.6, sub: 'Fly or drive to the other cities' });
  airLabel.position.set(air.terminal.x, 12, air.terminal.z); scene.add(airLabel);

  // the arena (JesusInTech Live) lives in London
  let arenaDoor = null;
  if (arena) {
    const body = mesh(new THREE.CylinderGeometry(70, 74, 22, 48), new THREE.MeshPhysicalMaterial({ color: 0xe6e9ec, metalness: 0.5, roughness: 0.3 }), { receive: true });
    body.position.set(-RING - 200, 11, 160); scene.add(body); colliders.box(-RING - 200, 160, 150, 150);
    const roof = mesh(new THREE.SphereGeometry(70, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 0.6, roughness: 0.3 }));
    roof.scale.set(1, 0.22, 1); roof.position.set(-RING - 200, 22, 160); scene.add(roof);
    const sign = label('London Arena', { size: 3.2, sub: 'JesusInTech Live' }); sign.position.set(-RING - 200, 44, 160); scene.add(sign);
    arenaDoor = { x: -RING - 124, z: 160, r: 6 };
    const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0x35aee2, emissive: 0x35aee2, emissiveIntensity: 1.4 }), { cast: false });
    ring.rotation.x = -Math.PI / 2; ring.position.set(arenaDoor.x, 0.2, arenaDoor.z); scene.add(ring);
    tickers.push((t) => { ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });
    const arenaRoad = buildRoad(new THREE.CatmullRomCurve3([V(-RING, 0), V(-RING - 60, 60), V(-RING - 110, 160)]), { width: 12, curbs: false, y: 0.025 });
    scene.add(arenaRoad.mesh); roads.push(arenaRoad);
  }

  // ---- life: traffic on the ring and radials, people on the pavements ----
  const ringCurve = new THREE.CatmullRomCurve3(ringPts, true, 'centripetal');
  const life = {
    cars: [
      { curve: ringCurve, closed: true, offset: 3.6, dir: 1, count: 8, speed: [9, 13] },
      { curve: ringCurve, closed: true, offset: 3.6, dir: -1, count: 8, speed: [9, 13] },
    ],
    peds: [
      { curve: ringCurve, closed: true, offset: 10, count: 14 },
      { curve: new THREE.CatmullRomCurve3(Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return V(Math.cos(a) * (RB + 12), Math.sin(a) * (RB + 12)); }), true), closed: true, offset: 0, count: 8 },
    ],
  };

  // ---- you arrive at the terminal; your cars wait in the car park ----
  const spawn = { x: air.entrance.x, z: air.entrance.z - 6, heading: Math.PI };
  const garage = ['revuelto', 'cullinan', 'tesla', 'lexus'].map((cid, i) => ({ id: cid, ...air.carPark[i] }));

  return {
    id, name: name.toUpperCase(),
    scene, env, colliders, roads,
    bounds: { minX: -RING - 420, maxX: AIR.x + 60, minZ: -RING - 600, maxZ: RING + 480 },
    tick: (t) => tickers.forEach((f) => f(t)),
    life,
    spawn, garage, slots: [],
    terminal: air.terminal, jetPark: air.jetPark, runway: air.runway, addJet: air.addJet,
    arenaDoor,
    landmarks: [{ x: 0, z: 0, color: '#e8c77a', name: 'Centre' }, { x: air.terminal.x, z: air.terminal.z, color: '#ffffff', name: 'Jets' }, ...(arenaDoor ? [{ x: arenaDoor.x, z: arenaDoor.z, color: '#35aee2', name: 'Arena' }] : [])],
    speedLimitAt: (x, z) => (Math.hypot(x, z) > RING - 8 ? 40 : 30),
    place(x, z) {
      const a = air.place(x, z); if (a) return a.replace('Kent Jet Centre', `${name} Jet Centre`);
      const r = Math.hypot(x, z);
      if (arenaDoor && Math.hypot(x - arenaDoor.x, z - arenaDoor.z) < 150) return 'London Arena';
      if (r < RB + 30) return `${name} city centre`;
      if (r < RING - 8) return 'High Street';
      if (r < RING + 20) return 'Ring Road';
      return name;
    },
    signalHeads: () => lights.heads, // traffic stops at them; the examiner marks a red run
    laneAt: null, // city streets are one lane each way, so no lane-change marking here
  };
}
