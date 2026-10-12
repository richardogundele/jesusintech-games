import * as THREE from 'three';
import { setupSky, buildRoad, distToRoads, buildingBlocks, roofs, streetLamps, Colliders } from './common.js';
import { M, waterMaterial, groundTexture, label, facadeMaterial } from '../materials.js';
import { buildYacht, buildJet, palms, planExtrude, mesh } from '../models.js';
import { JETS } from '../catalog.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);

export function buildMonaco(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    elevation: 14, azimuth: 60, turbidity: 5, rayleigh: 1.4,
    fog: 0xe9c99a, fogNear: 260, fogFar: 1600, sunColor: 0xffc98a, sunIntensity: 4.6, hemi: [0x9fbfe8, 0x6b5a44, 0.35],
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

  const quay = mesh(new THREE.BoxGeometry(840, 4, 480), M.stone, { receive: true });
  quay.position.set(0, -2.02, -180);
  scene.add(quay);
  const paveTex = groundTexture('#b9a88c', 255, 30000);
  paveTex.repeat.set(70, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(840, 480), new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.95 }));
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
  scene.add(streetLamps(roads[0].points, 10, 14, M.lamp));

  // ---- harbour: piers, yachts, breakwater ----
  const piers = [];
  for (const x of [-180, -120, -60, 0, 60, 120, 180]) {
    const p = mesh(new THREE.BoxGeometry(5, 1, 70), M.wood, { receive: true });
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
  const breakwater = mesh(new THREE.BoxGeometry(520, 3, 10), M.stone, { receive: true });
  breakwater.position.set(-40, 0, 205);
  scene.add(breakwater);
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
  const hill = new THREE.MeshStandardMaterial({ color: 0x8f8a6a, roughness: 1 });
  for (let i = 0; i < 10; i++) {
    const z = -250 - i * 26;
    const h = (i + 1) * 7;
    const t = mesh(new THREE.BoxGeometry(860, h, 28), hill, { receive: true, cast: false });
    t.position.set(0, h / 2, z);
    scene.add(t);
  }
  // Maritime Alps behind the city: soft, overlapping ridges that fade into the haze
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x6f7a5c, roughness: 1 });
  const ridge = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [x, z, r, h, d] of [[-620, -720, 380, 260, 220], [-180, -800, 460, 340, 260], [300, -760, 420, 300, 240], [760, -680, 360, 230, 220], [-1000, -520, 360, 190, 260], [1050, -480, 380, 200, 260], [40, -640, 300, 170, 160]]) {
    const m = mesh(ridge, mountMat, { cast: false });
    m.scale.set(r, h, d);
    m.position.set(x, -4, z);
    scene.add(m);
  }

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
  scene.add(buildingBlocks(blocks, { winSize: [2.8, 3.2], winColor: 0x22303d, amount: 0.85 }));
  scene.add(roofs(blocks.filter((_, i) => i % 3 === 0), M.terracotta));

  // ---- Casino de Monte-Carlo ----
  const casino = new THREE.Group();
  const stoneFacade = facadeMaterial({ winSize: [4.2, 6], winColor: 0x2a2116, amount: 0.75, roughness: 0.7 });
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
  const vWhite = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.6 });
  const box = (w, h, d, x, y, z, mat = vWhite) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat, { receive: true });
    m.position.set(x, y, z);
    villa.add(m);
    return m;
  };
  box(34, 0.6, 46, 0, 0.3, 0, M.stone);          // podium
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
  const drive = new THREE.Mesh(new THREE.PlaneGeometry(26, 44), new THREE.MeshStandardMaterial({ color: 0xbfb4a0, roughness: 0.8 }));
  drive.rotation.x = -Math.PI / 2;
  drive.position.set(-305, 0.02, -38);
  drive.receiveShadow = true;
  scene.add(drive);

  // ---- Private terminal + runway ----
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.9 });
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
  const parked = [];
  [['g700', 368, -55], ['global7500', 372, -100]].forEach(([id, x, z]) => {
    const j = buildJet(JETS[id]);
    j.position.set(x, 0, z);
    j.rotation.y = -Math.PI / 2;
    scene.add(j);
    parked.push(j);
    colliders.box(x, z, 34, 30);
  });
  // gold marker ring at the terminal trigger
  const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(300, 0.2, -42);
  scene.add(ring);
  tickers.push((t) => { ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });

  scene.add(palms(palmSpots));
  const harbourLabel = label('Port Hercule', { size: 2 });
  harbourLabel.position.set(0, 22, 120);
  scene.add(harbourLabel);

  return {
    id: 'monaco',
    name: 'MONACO',
    scene, env, colliders, roads,
    bounds: { minX: -405, maxX: 405, minZ: -234, maxZ: 57 },
    tick: (t) => tickers.forEach((f) => f(t)),
    spawn: { x: -292, z: -34, heading: -Math.PI / 2 },
    garage: [
      { id: 'revuelto', x: -308, z: -24, heading: Math.PI / 2 },
      { id: 'sf90', x: -308, z: -36, heading: Math.PI / 2 },
      { id: 'cullinan', x: -308, z: -50, heading: Math.PI / 2 },
    ],
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
