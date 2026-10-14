import * as THREE from 'three';
import { setupSky, buildRoad, distToRoads, buildingBlocks, buildingDetails, roofs, streetLamps, Colliders, parkJets } from './common.js';
import { M, waterMaterial, groundTexture, label, facadeMaterial } from '../materials.js';
import { buildYacht, buildJet, palms, planExtrude, mesh, rocks, stonePines } from '../models.js';
import { JETS } from '../catalog.js';
import { hdri, pbr, texSet, instanced, model as modelOf, modelMaterial } from '../assets.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);

export function buildMonaco(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    hdri: hdri('monaco'), sunAzimuth: 70, exposure: 1.0, envIntensity: 1.0,
    sunColor: 0xfff0dc, sunIntensity: 3.6, fogDensity: 0.00045,
  });
  const colliders = new Colliders();
  const tickers = [];

  // ---- land, sea ----
  const water = waterMaterial(0x0d5574);
  tickers.push((t) => water.userData.tick(t));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  sea.receiveShadow = true;
  scene.add(sea);

  const quay = mesh(new THREE.BoxGeometry(840, 4, 480), pbr('white_sandstone_blocks_02', { repeat: [210, 1] }), { receive: true });
  quay.position.set(0, -2.02, -180);
  scene.add(quay);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(840, 480), pbr('concrete_floor_02', { repeat: [210, 120], color: 0xdedad3 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -180);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- roads ----
  const loop = new THREE.CatmullRomCurve3([
    V(-200, 40), V(-60, 43), V(60, 43), V(160, 40), V(212, 14), V(225, -40), V(205, -105), V(150, -140),
    V(60, -146), V(-40, -134), V(-120, -148), V(-200, -132), V(-232, -70), V(-226, 0),
  ], true, 'centripetal');
  const villaSpur = new THREE.CatmullRomCurve3([V(-229, -36), V(-260, -36), V(-296, -36)]);
  const airportSpur = new THREE.CatmullRomCurve3([V(224, -42), V(258, -42), V(296, -42)]);
  const roads = [
    buildRoad(loop, { closed: true, width: 15 }),
    buildRoad(villaSpur, { width: 10, curbs: false, y: 0.025 }),
    buildRoad(airportSpur, { width: 12, curbs: false, y: 0.025 }),
  ];
  roads.forEach((r) => scene.add(r.mesh));
  // Victorian lamps both sides of the circuit
  const lampSpots = [];
  const lp = roads[0].points;
  for (let i = 0; i < lp.length; i += 13) {
    const a = lp[i], b = lp[(i + 1) % lp.length];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const nrm = new THREE.Vector3(-t.z, 0, t.x);
    for (const sd of [1, -1]) lampSpots.push({ x: a.x + nrm.x * 9.6 * sd, z: a.z + nrm.z * 9.6 * sd, scale: 1.35, rot: Math.atan2(nrm.x, nrm.z) });
  }
  scene.add(instanced('lamp_lo', lampSpots, { chunk: 100, maxDist: 260 }));

  // ---- harbour: piers, yachts, breakwater ----
  const piers = [];
  const pierMat = pbr('wood_floor_deck', { repeat: [1, 14], color: 0x8d8579 });
  for (const x of [-180, -120, -60, 0, 60, 120, 180]) {
    const p = mesh(new THREE.BoxGeometry(5, 1, 70), pierMat, { receive: true });
    p.position.set(x, -0.2, 95);
    scene.add(p);
    piers.push(x);
  }
  const yachts = [];
  const accents = [0x14213d, 0x1c1c1c, 0x7a6a50, 0xffffff, 0x2d4f5c];
  for (let i = 0; i < piers.length - 1; i++) {
    const L = rand(38, 56);
    const y = buildYacht(L, rand(8, 10), pick(accents));
    y.position.set((piers[i] + piers[i + 1]) / 2, 0, 66 + L / 2 + rand(0, 8));
    scene.add(y);
    yachts.push(y);
  }
  for (let i = 0; i < 6; i++) {
    const L = rand(60, 95);
    const y = buildYacht(L, L * 0.17, pick(accents));
    y.position.set(rand(-600, 600), 0, rand(280, 650));
    y.rotation.y = rand(0, Math.PI * 2);
    scene.add(y);
    yachts.push(y);
  }
  tickers.push((t) => yachts.forEach((y, i) => {
    y.position.y = -0.15 + Math.sin(t * 0.8 + i) * 0.12;
    y.rotation.z = Math.sin(t * 0.6 + i * 1.7) * 0.012;
  }));
  const breakwater = mesh(new THREE.BoxGeometry(520, 2.2, 8), pbr('concrete_floor_02', { repeat: [65, 1] }), { receive: true });
  breakwater.position.set(-40, 0.2, 205);
  scene.add(breakwater);
  const rockSpots = [];
  for (let x = -296; x <= 218; x += 2.6) for (const z of [199.5, 210.5]) rockSpots.push({ x: x + rand(-1, 1), z: z + rand(-1.2, 1.2), y: -0.9 + rand(0, 0.5), rot: rand(0, 6.28), scale: rand(1.6, 2.4) });
  scene.add(rocks(rockSpots, modelMaterial('boulder_01')));
  const lighthouse = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = mesh(new THREE.CylinderGeometry(1.6, 1.8, 2.4, 14), i % 2 ? M.white : M.red);
    seg.position.y = 1.5 + i * 2.4;
    lighthouse.add(seg);
  }
  lighthouse.position.set(222, 0, 205);
  scene.add(lighthouse);

  // ---- promenade palms ----
  const palmSpots = [];
  for (let x = -260; x <= 210; x += 16) palmSpots.push([x, 55]);
  for (let x = -250; x <= 200; x += 22) palmSpots.push([x + 8, 26]);

  // ---- hillside terraces (scenery, not drivable) ----
  for (let i = 0; i < 10; i++) {
    const z = -250 - i * 26;
    const h = (i + 1) * 7;
    const wallMat = pbr('white_sandstone_blocks_02', { repeat: [215, h / 4], color: 0xd8cdb8 });
    const t = mesh(new THREE.BoxGeometry(860, h, 28), wallMat, { receive: true, cast: false });
    t.position.set(0, h / 2, z);
    scene.add(t);
  }
  // Maritime Alps behind the city: noise terrain, scrub green low down, bare limestone up high
  scene.add(mountains());

  // ---- city blocks ----
  const pastel = ['#efe2c8', '#f2d3b3', '#e9c39b', '#f5ead8', '#e8b48f', '#f3e6c9', '#dcc7a1', '#f0d9c4', '#f6efe2'];
  const reserved = [
    { minX: -400, maxX: -270, minZ: -110, maxZ: 60 },   // villa
    { minX: 250, maxX: 420, minZ: -420, maxZ: 60 },     // airport
    { minX: 5, maxX: 175, minZ: -240, maxZ: -150 },     // casino square
  ];
  const inReserved = (x, z) => reserved.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  const blocks = [];
  for (let x = -260; x <= 240; x += 24) {
    for (let z = -222; z <= 18; z += 24) {
      const bx = x + rand(-3, 3), bz = z + rand(-3, 3);
      const w = rand(12, 19), d = rand(12, 19);
      if (inReserved(bx, bz)) continue;
      if (distToRoads(bx, bz, roads) < Math.max(w, d) / 2 + 11) continue;
      blocks.push({ x: bx, z: bz, w, d, h: rand(10, 30), color: pick(pastel) });
      colliders.box(bx, bz, w, d);
    }
  }
  // hillside city, stepping up the terraces
  for (let x = -400; x <= 400; x += 22) {
    for (let i = 0; i < 10; i++) {
      if (Math.random() < 0.25) continue;
      const z = -250 - i * 26 + rand(-4, 4);
      if (x > 250 && x < 410 && i < 1) continue; // keep the runway end clear
      blocks.push({ x: x + rand(-4, 4), z, y: (i + 1) * 7, w: rand(12, 18), d: rand(12, 18), h: rand(12, 34), color: pick(pastel) });
    }
  }
  // a couple of towers (Monaco's skyline isn't all low-rise)
  blocks.push({ x: 205, z: -302, y: 21, w: 22, d: 22, h: 150, color: '#c9d3da' });
  blocks.push({ x: -160, z: -276, y: 14, w: 20, d: 18, h: 90, color: '#e3dccd' });
  scene.add(buildingBlocks(blocks, { winSize: [2.8, 3.2], winColor: 0x1a2530, amount: 0.92, tex: texSet('painted_plaster_wall'), texScale: 0.35, shutters: 0x4d6b54, brighten: 1.35 }));
  scene.add(roofs(blocks.filter((_, i) => i % 3 === 0), pbr('clay_roof_tiles_02', { repeat: [3, 2] })));
  scene.add(buildingDetails(blocks.filter((b) => b.h < 100), roads));

  // ---- Casino de Monte-Carlo ----
  const casino = new THREE.Group();
  const stoneFacade = facadeMaterial({ winSize: [4.2, 6], winColor: 0x2a2116, amount: 0.75, roughness: 0.7, tex: texSet('white_sandstone_blocks_02'), texScale: 0.25 });
  stoneFacade.color.set(0xe9dcc0);
  const main = mesh(new THREE.BoxGeometry(64, 17, 24), stoneFacade, { receive: true });
  main.position.y = 8.5;
  casino.add(main);
  for (const s of [-1, 1]) {
    const tower = mesh(new THREE.BoxGeometry(7, 28, 7), stoneFacade);
    tower.position.set(s * 20, 14, 10);
    const cap = mesh(new THREE.ConeGeometry(4.6, 8, 4), M.copper);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(s * 20, 32, 10);
    casino.add(tower, cap);
  }
  const dome = mesh(new THREE.SphereGeometry(8, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.copper);
  dome.position.y = 17;
  casino.add(dome);
  const portico = mesh(new THREE.BoxGeometry(22, 1.2, 6), M.copper);
  portico.position.set(0, 7, 14);
  casino.add(portico);
  casino.position.set(95, 0, -196);
  scene.add(casino);
  colliders.box(95, -196, 66, 26);
  const casinoLabel = label('Casino de Monte-Carlo', { size: 2.2 });
  casinoLabel.position.set(95, 46, -196);
  scene.add(casinoLabel);
  // Casino gardens
  const garden = mesh(new THREE.CylinderGeometry(9, 9, 0.4, 32), M.grass, { receive: true, cast: false });
  garden.position.set(95, 0.2, -166);
  const fountain = mesh(new THREE.CylinderGeometry(3, 3.4, 1.2, 24), M.stone);
  fountain.position.set(95, 0.6, -166);
  const fwater = mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 24), M.pool, { cast: false });
  fwater.position.set(95, 1.21, -166);
  scene.add(garden, fountain, fwater);
  colliders.box(95, -166, 18, 18);
  for (const a of [0, 1, 2, 3, 4, 5]) palmSpots.push([95 + Math.cos(a) * 13, -166 + Math.sin(a) * 13 - 4]);
  const hotel = mesh(new THREE.BoxGeometry(46, 22, 18), stoneFacade, { receive: true });
  hotel.position.set(30, 11, -196);
  scene.add(hotel);
  colliders.box(30, -196, 46, 18);
  const hotelLabel = label('Hôtel de Paris', { size: 1.4 });
  hotelLabel.position.set(30, 28, -196);
  scene.add(hotelLabel);

  // ---- Your villa ----
  const villa = new THREE.Group();
  const vWhite = pbr('painted_plaster_wall', { repeat: [3, 1.5], color: 0xfbf9f5 });
  const box = (w, h, d, x, y, z, mat = vWhite) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat, { receive: true });
    m.position.set(x, y, z);
    villa.add(m);
    return m;
  };
  box(34, 0.6, 46, 0, 0.3, 0, pbr('white_sandstone_blocks_02', { repeat: [8, 10] }));          // podium
  box(26, 5.2, 18, -4, 3.2, -10);                 // ground floor
  box(25.6, 4.6, 0.2, -4, 3.0, -0.9, M.villaGlass); // glass front
  box(30, 0.5, 22, -2, 6.05, -9);                 // cantilever slab
  box(20, 4.4, 14, -6, 8.5, -11);                 // first floor
  box(19.6, 3.8, 0.2, -6, 8.4, -3.9, M.villaGlass);
  box(23, 0.45, 17, -6, 10.9, -11);               // roof
  box(8, 4.2, 12, 12, 2.7, -12);                  // garage block
  box(7.4, 3.4, 0.2, 12, 2.3, -5.9, M.trim);      // garage door
  const pool = box(18, 0.2, 7, -4, 0.62, 13, M.pool);
  pool.castShadow = false;
  box(19, 0.5, 0.6, -4, 0.55, 16.8, M.stone);
  box(19, 0.5, 0.6, -4, 0.55, 9.2, M.stone);
  for (const x of [-12, -4, 4]) box(1.4, 0.35, 3, x, 0.78, 6.5, M.white); // loungers
  villa.position.set(-335, 0, -40);
  villa.rotation.y = Math.PI / 2; // facing east, toward the driveway
  scene.add(villa);
  colliders.box(-345, -40, 18, 34);
  const villaLabel = label("Richard's Villa", { size: 1.6, sub: 'Monte Carlo' });
  villaLabel.position.set(-340, 17, -40);
  scene.add(villaLabel);
  for (const [x, z] of [[-305, -62], [-305, -14], [-318, -66], [-318, -10], [-360, -68], [-360, -12]]) palmSpots.push([x, z]);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(126, 160), pbr('leafy_grass', { repeat: [40, 50], color: 0x9fc489 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(-337, 0.012, -38);
  lawn.receiveShadow = true;
  scene.add(lawn);
  const drive = new THREE.Mesh(new THREE.PlaneGeometry(26, 44), pbr('granite_tile', { repeat: [9, 15], polygonOffset: true, polygonOffsetFactor: -1 }));
  drive.rotation.x = -Math.PI / 2;
  drive.position.set(-305, 0.02, -38);
  drive.receiveShadow = true;
  scene.add(drive);

  // ---- Private terminal + runway ----
  const apronMat = pbr('concrete_floor_02', { repeat: [28, 30], polygonOffset: true, polygonOffsetFactor: -1 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(110, 120), apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(345, 0.02, -60);
  apron.receiveShadow = true;
  scene.add(apron);
  const runwayCurve = new THREE.LineCurve3(V(330, -232), V(330, 52));
  const runway = buildRoad(runwayCurve, { width: 34, lanes: 2, curbs: false, y: 0.035, step: 4 });
  scene.add(runway.mesh);
  const terminalMat = facadeMaterial({ winSize: [2.2, 4.5], winColor: 0x1b2833, amount: 0.95, metalness: 0.3, roughness: 0.4 });
  terminalMat.color.set(0xd8dde0);
  const terminal = mesh(new THREE.BoxGeometry(60, 10, 22), terminalMat, { receive: true });
  terminal.position.set(382, 5, -140);
  scene.add(terminal);
  colliders.box(382, -140, 60, 22);
  const termLabel = label('Private Terminal', { size: 1.6, sub: 'Jets to Dubai' });
  termLabel.position.set(300, 12, -42);
  scene.add(termLabel);
  parkJets(scene, colliders, [
    { id: 'g700', x: 368, z: -55, rot: -Math.PI / 2 },
    { id: 'global7500', x: 372, z: -100, rot: -Math.PI / 2 },
    { id: 'falcon8x', x: 376, z: -196, rot: -Math.PI / 2 },
    { id: 'praetor600', x: 372, z: 16, rot: -Math.PI / 2 },
  ], JETS, buildJet);
  // gold marker ring at the terminal trigger
  const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(300, 0.2, -42);
  scene.add(ring);
  tickers.push((t) => { ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });

  scene.add(palms(palmSpots));

  // ---- trees, hedges, planters ----
  const treeSpots = { island_tree_01: [], island_tree_02: [], island_tree_03: [] };
  const addTree = (x, z, y = 0, kind = pick(['island_tree_01', 'island_tree_02'])) =>
    treeSpots[kind].push({ x, z, y, rot: rand(0, 6.28), scale: rand(1.3, 1.9) });
  for (const [x, z] of [[76, -180], [114, -180], [66, -160], [124, -160], [5, -178], [52, -176]]) addTree(x, z);
  for (const [x, z] of [[-366, -72], [-366, -8], [-380, -40], [-320, -76], [-320, -4], [-352, -84]]) addTree(x, z);
  // pocket gardens between city blocks
  let tries = 0;
  while (tries++ < 900 && treeSpots.island_tree_01.length + treeSpots.island_tree_02.length < 45) {
    const x = rand(-255, 235), z = rand(-225, 20);
    if (inReserved(x, z) || distToRoads(x, z, roads) < 11) continue;
    if (colliders.boxes.some((b) => x > b.minX - 3 && x < b.maxX + 3 && z > b.minZ - 3 && z < b.maxZ + 3)) continue;
    addTree(x, z);
  }
  // stone pines all over the hillside terraces (cheap geometry, so there can be lots)
  const pines = [];
  for (let i = 0; i < 10; i++) for (let k = 0; k < 26; k++) pines.push({ x: rand(-420, 420), z: -250 - i * 26 + rand(-11, 11), y: (i + 1) * 7, rot: rand(0, 6.28), scale: rand(0.8, 1.25) });
  for (const [x, z] of [[-372, -80], [-390, -60], [-392, -20], [-374, 0]]) pines.push({ x, z, rot: rand(0, 6.28), scale: 1.2 });
  scene.add(stonePines(pines));
  for (let x = -250; x <= 200; x += 44) addTree(x + 19, 26, 0, 'island_tree_03');
  for (const [k, list] of Object.entries(treeSpots)) scene.add(instanced(k, list, { chunk: 80, maxDist: 320 }));
  const hedges = [];
  for (let z = -78; z <= -2; z += 6.2) hedges.push({ x: -386, z, rot: Math.PI / 2, scale: 0.9 });
  for (let x = -380; x <= -320; x += 6.2) { hedges.push({ x, z: -84, scale: 0.9 }); hedges.push({ x, z: 4, scale: 0.9 }); }
  for (let x = 70; x <= 120; x += 6.5) hedges.push({ x, z: -183.5, scale: 0.6 });
  scene.add(instanced('shrub2_lo', hedges, { chunk: 100, maxDist: 300 }));

  // ---- villa terrace: real furniture ----
  const place = (name, x, z, rot = 0, s = 1) => {
    const m = modelOf(name);
    m.position.set(x, 0.6, z);
    m.rotation.y = rot;
    m.scale.setScalar(s);
    villa.add(m);
  };
  place('sofa_03', 7, 3.2, 0);
  place('modern_arm_chair_01', 3.6, 5.6, Math.PI / 2);
  place('modern_arm_chair_01', 10.4, 5.6, -Math.PI / 2);
  place('modern_coffee_table_01', 7, 5.6, Math.PI / 2);
  place('outdoor_table_chair_set_01', 12.5, 12.5, 0.3);
  place('outdoor_table_chair_set_01', 12.5, 16, -0.2);
  for (const [x, z] of [[-16, 1], [-8.5, 1], [9.5, 1], [16, 1], [-16, 18], [16, 18]]) place(pick(['potted_plant_01', 'potted_plant_02']), x, z, rand(0, 6.28), 1.5);
  const harbourLabel = label('Port Hercule', { size: 2 });
  harbourLabel.position.set(0, 22, 120);
  scene.add(harbourLabel);

  return {
    id: 'monaco',
    name: 'MONACO',
    scene, env, colliders, roads,
    bounds: { minX: -405, maxX: 405, minZ: -234, maxZ: 57 },
    tick: (t) => tickers.forEach((f) => f(t)),
    life: {
      cars: [
        { curve: loop, closed: true, offset: 3.7, dir: 1, count: 7, speed: [11, 16] },
        { curve: loop, closed: true, offset: 3.7, dir: -1, count: 7, speed: [11, 16] },
      ],
      peds: [
        { curve: new THREE.LineCurve3(V(-250, 57.5), V(212, 57.5)), closed: false, offset: 0, count: 14 },
        { curve: loop, closed: true, offset: 10.4, count: 10 },
        { curve: loop, closed: true, offset: -10.4, count: 8 },
      ],
    },
    spawn: { x: -292, z: -34, heading: -Math.PI / 2 },
    garage: [
      { id: 'revuelto', x: -308, z: -24, heading: Math.PI / 2 },
      { id: 'f458', x: -308, z: -36, heading: Math.PI / 2 },
      { id: 'cullinan', x: -308, z: -50, heading: Math.PI / 2 },
    ],
    slots: [[-294, -22], [-294, -50], [-282, -22], [-282, -50], [-270, -22], [-270, -50]].map(([x, z]) => ({ x, z, heading: Math.PI / 2 })),
    terminal: { x: 300, z: -42, r: 7 },
    runway: { x: 330, z0: -225, z1: 50 },
    arrival: { x: 300, z: -30, heading: -Math.PI / 2 },
    landmarks: [
      { x: -335, z: -40, color: '#e8c77a', name: 'Villa' },
      { x: 95, z: -196, color: '#5f9c86', name: 'Casino' },
      { x: 300, z: -42, color: '#ffffff', name: 'Jets' },
    ],
    place(x, z) {
      if (x < -270) return 'Your Villa';
      if (x > 250) return 'Private Terminal';
      if (z < -150 && x > 0 && x < 180) return 'Casino Square';
      if (z < -150) return 'Monte Carlo Heights';
      if (z > 20) return 'Port Hercule';
      return 'Monte Carlo';
    },
  };
}

// ---------- terrain ----------
function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 6) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
}
function mountains() {
  const W = 4400, D = 1500, geo = new THREE.PlaneGeometry(W, D, 300, 110);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -480 - D / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const scrub = new THREE.Color(0x3f4a2a), olive = new THREE.Color(0x5d5c3e), rock = new THREE.Color(0x87827a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const back = THREE.MathUtils.smoothstep(-z, 480, 1250);          // 0 at the city edge -> 1 deep behind
    const ridge = 1 - Math.abs(fbm(x * 0.0016 + 3.1, z * 0.0016) * 2 - 1); // sharp ridgelines
    let h = back * (120 + 300 * ridge * ridge) + fbm(x * 0.008, z * 0.008) * 55 * back;
    h += THREE.MathUtils.smoothstep(Math.abs(x), 900, 2200) * 90 * back; // higher at the flanks
    pos.setY(i, h + 40 * (1 - back) - 8);
    const t = THREE.MathUtils.clamp((h - 230) / 320 + (fbm(x * 0.02, z * 0.02) - 0.5) * 0.6, 0, 1);
    c.copy(scrub).lerp(olive, Math.min(1, t * 1.8)).lerp(rock, Math.max(0, t * 1.6 - 0.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}
