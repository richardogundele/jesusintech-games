import * as THREE from 'three';
import { setupSky, buildRoad, buildingBlocks, streetLamps, Colliders, parkJets, jetRow, modernTowers } from './common.js';
import { M, waterMaterial, groundTexture, label, facadeMaterial } from '../materials.js';
import { buildJet, palms, mesh } from '../models.js';
import { JETS, STARTER_JETS } from '../catalog.js';
import { state } from '../state.js';
import { buildMansion } from './mansion.js';
import { hdri, pbr } from '../assets.js';
import { buildBillboard, BILLBOARDS } from '../brandart.js';
import { cityLights, placeSigns } from '../cityroads.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);

export function buildDubai(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    hdri: hdri('dubai'), sunAzimuth: 140, exposure: 1.0, envIntensity: 0.75,
    sunColor: 0xfff4e4, sunIntensity: 3.4, fogDensity: 0.0006,
  });
  const colliders = new Colliders();
  const tickers = [];

  // ---- sea (Arabian Gulf, west) + desert ----
  const water = waterMaterial(0x167a8c);
  tickers.push((t) => water.userData.tick(t));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  scene.add(sea);
  const sandTex = groundTexture('#d8c08f', 200, 26000);
  sandTex.repeat.set(160, 160);
  const land = new THREE.Mesh(new THREE.BoxGeometry(2400, 4, 3000), new THREE.MeshStandardMaterial({ color: 0xd2b98a, roughness: 1 }));
  land.position.set(820, -2.01, 0);
  scene.add(land);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(2400, 3000), pbr('coast_sand_01', { repeat: [600, 750] }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(820, 0, 0);
  sand.receiveShadow = true;
  scene.add(sand);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(360, 1440), pbr('rectangular_paving', { repeat: [120, 480], color: 0xe2dccf }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.01, 0);
  plaza.receiveShadow = true;
  scene.add(plaza);
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xd9b980, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const d = mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), duneMat, { cast: false });
    d.scale.set(rand(80, 200), rand(14, 40), rand(60, 160));
    d.position.set(rand(800, 1700), -2, rand(-1300, 1300));
    scene.add(d);
  }

  // ---- Sheikh Zayed Road ----
  const szr = buildRoad(new THREE.LineCurve3(V(0, -720), V(0, 720)), { width: 44, lanes: 8, step: 6 });
  const spur = buildRoad(new THREE.CatmullRomCurve3([V(22, 600), V(110, 600), V(196, 600)]), { width: 14, curbs: false, y: 0.025 });
  const HOME = { x: 470, z: 20 };
  const homeRoad = buildRoad(new THREE.CatmullRomCurve3([V(22, HOME.z + 70), V(250, HOME.z + 70), V(HOME.x, HOME.z + 70)]), { width: 14, curbs: false, y: 0.025 });
  const roads = [szr, spur, homeRoad];
  roads.forEach((r) => scene.add(r.mesh));
  const median = mesh(new THREE.BoxGeometry(1.2, 1, 1440), M.stone);
  median.position.set(0, 0.5, 0);
  scene.add(median);
  colliders.box(0, 0, 1.2, 1440);
  scene.add(streetLamps(szr.points, 0, 6, M.lamp, { double: true }));

  // ---- towers ----
  const tones = ['#9fb3c4', '#c4ccd2', '#7f95a8', '#b8a88e', '#d6dadd', '#8aa0ad', '#a99c86'];
  const blocks = [];
  for (const side of [-1, 1]) {
    for (let z = -660; z <= 660; z += 44) {
      for (let row = 0; row < 3; row++) {
        if (side > 0 && row > 0 && z > 520) continue; // keep the airport spur open
        const x = side * (52 + row * 52 + rand(-4, 4));
        const front = row === 0;
        const w = rand(22, 32), d = rand(22, 32);
        const h = front ? rand(90, 300) : rand(50, 180);
        const bz = z + rand(-5, 5);
        if (side > 0 && Math.abs(bz - 600) < 26) continue;
        if (side > 0 && Math.abs(bz - (HOME.z + 70)) < 26) continue;
        if (side > 0 && Math.abs(bz + 560) < 26) continue; // arena road
        blocks.push({ x, z: bz, w, d, h, color: pick(tones), podium: front && Math.random() < 0.45 });
        colliders.box(x, bz, front ? w * 1.3 : w, front ? d * 1.3 : d);
      }
    }
  }
  // Sheikh Zayed Road's towers: setbacks, round towers with crowns, twisting towers, tapered spires, on podiums
  scene.add(modernTowers(blocks, { winSize: [1.8, 3.6], winColor: 0x24435a, amount: 0.92, roughness: 0.3, metalness: 0.45 }));

  // ---- Burj Khalifa (stepped, Y-plan setbacks approximated with hex tiers) ----
  const burjMat = facadeMaterial({ winSize: [1.4, 3.6], winColor: 0x3b5268, amount: 0.9, roughness: 0.25, metalness: 0.7 });
  burjMat.color.set(0xd5dde3);
  const burj = new THREE.Group();
  let y = 0;
  const tiers = [[34, 70], [29, 70], [25, 60], [21, 60], [18, 55], [15, 50], [12, 45], [9.5, 40], [7.5, 35], [5.5, 30], [4, 25]];
  tiers.forEach(([r, h]) => {
    const t = mesh(new THREE.CylinderGeometry(r * 0.94, r, h, 6), burjMat);
    t.position.y = y + h / 2;
    burj.add(t);
    y += h;
  });
  const spire = mesh(new THREE.ConeGeometry(2.6, 120, 8), M.chrome);
  spire.position.y = y + 60;
  burj.add(spire);
  burj.position.set(300, 0, -260);
  scene.add(burj);
  colliders.box(300, -260, 70, 70);
  const burjLabel = label('Burj Khalifa', { size: 4 });
  burjLabel.position.set(300, 120, -260);
  scene.add(burjLabel);
  const lake = mesh(new THREE.CylinderGeometry(55, 55, 0.3, 40), new THREE.MeshPhysicalMaterial({ color: 0x1f6f80, roughness: 0.05, clearcoat: 1 }), { cast: false, receive: true });
  lake.position.set(300, 0.05, -170);
  scene.add(lake);

  // ---- Burj Al Arab, out on its island ----
  const sail = new THREE.Shape();
  sail.moveTo(0, 0);
  sail.lineTo(46, 0);
  sail.quadraticCurveTo(44, 150, 2, 205);
  sail.lineTo(0, 205);
  sail.lineTo(0, 0);
  const sailGeo = new THREE.ExtrudeGeometry(sail, { depth: 34, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, curveSegments: 24 });
  sailGeo.translate(0, 0, -17);
  const bajMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.3, clearcoat: 0.6 });
  const baj = new THREE.Group();
  baj.add(mesh(sailGeo, bajMat));
  const mastGeo = mesh(new THREE.CylinderGeometry(1.4, 1.4, 230, 8), M.chrome);
  mastGeo.position.set(-4, 115, 0);
  baj.add(mastGeo);
  const island = mesh(new THREE.CylinderGeometry(40, 46, 4, 32), M.stone, { receive: true });
  island.position.set(20, 0, 0);
  baj.add(island);
  baj.position.set(-520, 0, 200);
  baj.rotation.y = 0.5;
  scene.add(baj);
  const bajLabel = label('Burj Al Arab', { size: 3 });
  bajLabel.position.set(-500, 230, 200);
  scene.add(bajLabel);

  // ---- palms on the beachfront and along the road ----
  const palmSpots = [];
  for (let z = -660; z <= 660; z += 18) palmSpots.push([30, z], [-30, z]);
  for (let z = -600; z <= 600; z += 30) palmSpots.push([-330, z]);

  // ---- Private jet terminal + runway ----
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 150), new THREE.MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.9 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(250, 0.02, 600);
  apron.receiveShadow = true;
  scene.add(apron);
  const runway = buildRoad(new THREE.LineCurve3(V(300, 160), V(300, 720)), { width: 40, curbs: false, y: 0.035, step: 5 });
  scene.add(runway.mesh);
  const termMat = facadeMaterial({ winSize: [2.4, 5], winColor: 0x1c2e3b, amount: 0.95, roughness: 0.3, metalness: 0.5 });
  termMat.color.set(0xe6e1d6);
  const term = mesh(new THREE.BoxGeometry(24, 12, 70), termMat, { receive: true });
  term.position.set(225, 6, 650);
  scene.add(term);
  colliders.box(225, 650, 24, 70);
  const termLabel = label('Private Jet Terminal', { size: 1.6, sub: 'Jets to Monaco and Singapore' });
  termLabel.position.set(198, 13, 600);
  scene.add(termLabel);
  // Richard's jet park: the whole fleet in a row along the east side of the runway
  const parkApron = new THREE.Mesh(new THREE.PlaneGeometry(140, 560), pbr('concrete_floor_02', { repeat: [28, 140], polygonOffset: true, polygonOffsetFactor: -1 }));
  parkApron.rotation.x = -Math.PI / 2;
  parkApron.position.set(395, 0.02, 450);
  parkApron.receiveShadow = true;
  scene.add(parkApron);
  parkJets(scene, colliders, jetRow(STARTER_JETS, JETS, 336, 175, 6), JETS, buildJet);
  // second row: jets you buy from the phone, parked as they arrive
  let rowCursor = 175;
  const addJet = (id) => {
    const j = JETS[id];
    parkJets(scene, colliders, [{ id, x: 388 + j.L / 2, z: rowCursor + j.span / 2, rot: -Math.PI / 2 }], JETS, buildJet);
    rowCursor += j.span + 6;
  };
  state.owned.jets.forEach(addJet);
  const parkSign = label("Richard's Jet Park", { size: 3, sub: 'Your private fleet' });
  parkSign.position.set(380, 30, 160);
  scene.add(parkSign);
  const parkRing = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  parkRing.rotation.x = -Math.PI / 2;
  parkRing.position.set(345, 0.2, 165);
  scene.add(parkRing);
  tickers.push((t) => { parkRing.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });

  // ---- Dubai Arena (JesusInTech Live) ----
  const ARENA = { x: 330, z: -560 };
  const arenaRoad = buildRoad(new THREE.CatmullRomCurve3([V(22, ARENA.z), V(150, ARENA.z), V(246, ARENA.z)]), { width: 14, curbs: false, y: 0.025 });
  scene.add(arenaRoad.mesh);
  roads.push(arenaRoad);
  const bandTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 4096; cv.height = 512;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#050607'; ctx.fillRect(0, 0, 4096, 512);
    ctx.font = '800 300px Helvetica Neue, Arial'; ctx.fillStyle = '#35aee2';
    ctx.fillText('JESUSINTECH LIVE  ·  TONIGHT  ·', 40, 380);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const arenaBody = mesh(new THREE.CylinderGeometry(70, 74, 30, 72, 1), facadeMaterial({ winSize: [3, 30], winColor: 0x1a2a38, amount: 0.9, roughness: 0.3, metalness: 0.5 }), { receive: true });
  arenaBody.material.color.set(0xd9dde0);
  arenaBody.scale.set(1, 1, 0.8);
  arenaBody.position.set(ARENA.x, 15, ARENA.z);
  bandTex.repeat.set(3, 1);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(70.8, 70.8, 11, 72, 1, true), new THREE.MeshBasicMaterial({ map: bandTex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
  band.scale.set(1, 1, 0.8);
  band.position.set(ARENA.x, 22, ARENA.z);
  const roofDome = mesh(new THREE.SphereGeometry(72, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8ebee, metalness: 0.6, roughness: 0.3 }));
  roofDome.scale.set(1, 0.18, 0.8);
  roofDome.position.set(ARENA.x, 30, ARENA.z);
  scene.add(arenaBody, band, roofDome);
  tickers.push((t) => { bandTex.offset.x = (t * 0.02) % 1; });
  colliders.box(ARENA.x, ARENA.z, 144, 118);
  const doors = mesh(new THREE.BoxGeometry(2, 9, 26), new THREE.MeshPhysicalMaterial({ color: 0x10161c, metalness: 0.6, roughness: 0.05 }));
  doors.position.set(ARENA.x - 73, 4.5, ARENA.z);
  scene.add(doors);
  const arenaSign = label('Dubai Arena', { size: 3.5, sub: 'JesusInTech Live' });
  arenaSign.position.set(ARENA.x, 46, ARENA.z);
  scene.add(arenaSign);
  const arenaRing = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0x35aee2, emissive: 0x35aee2, emissiveIntensity: 1.4 }), { cast: false });
  arenaRing.rotation.x = -Math.PI / 2;
  arenaRing.position.set(ARENA.x - 80, 0.2, ARENA.z);
  scene.add(arenaRing);
  tickers.push((t) => { arenaRing.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });
  const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(198, 0.2, 600);
  scene.add(ring);
  tickers.push((t) => { ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });

  // ---- brand billboards down Sheikh Zayed Road (the main boulevard, x≈0) ----
  const dubaiBoards = [
    { x: 34, z: -240, rot: -Math.PI / 2, i: 0, w: 18 },
    { x: -34, z: 40, rot: Math.PI / 2, i: 1, w: 18 },
    { x: 34, z: 300, rot: -Math.PI / 2, i: 4, w: 18 },
    { x: -34, z: -40, rot: Math.PI / 2, i: 2, w: 18 },
  ];
  for (const b of dubaiBoards) {
    const bb = buildBillboard({ width: b.w, spec: BILLBOARDS[b.i] });
    bb.position.set(b.x, 0, b.z);
    bb.rotation.y = b.rot;
    scene.add(bb);
    colliders.box(b.x, b.z, 3, b.w * 0.7);
  }

  // ---- road furniture down Sheikh Zayed Road: real signs + signalled crossings ----
  const dxLights = cityLights(scene, [
    { x: 26, z: 20, yaw: 0, offset: 0 }, { x: -26, z: -20, yaw: Math.PI, offset: 12 },
    { x: 26, z: 420, yaw: 0, offset: 6 }, { x: -26, z: 380, yaw: Math.PI, offset: 18 },
  ]);
  tickers.push((t) => dxLights.tick(t));
  placeSigns(scene, [
    { id: 'speed_60', x: 26, z: -140, yaw: Math.PI / 2 },
    { id: 'speed_60', x: -26, z: 200, yaw: -Math.PI / 2 },
    { id: 'traffic_signals_ahead', x: 26, z: -40, yaw: Math.PI / 2 },
    { id: 'roundabout_ahead', x: 26, z: 520, yaw: Math.PI / 2 },
    { id: 'no_u_turn', x: -26, z: -70, yaw: -Math.PI / 2 },
    { id: 'give_way', x: 60, z: 40, yaw: -Math.PI / 2 },
  ]);

  scene.add(palms(palmSpots));

  const mansion = buildMansion({ scene, colliders, tickers, origin: HOME });

  return {
    id: 'dubai',
    name: 'DUBAI',
    scene, env, colliders, roads,
    bounds: { minX: -320, maxX: 700, minZ: -700, maxZ: 700 },
    tick: (t) => tickers.forEach((f) => f(t)),
    life: (() => {
      const szr = new THREE.LineCurve3(V(0, -700), V(0, 700));
      return {
        cars: [4, 8.5, 13].flatMap((o) => [
          { curve: szr, closed: false, offset: o, dir: 1, count: 4, speed: [19, 27] },
          { curve: szr, closed: false, offset: o, dir: -1, count: 4, speed: [19, 27] },
        ]),
        peds: [
          { curve: szr, closed: false, offset: 27, count: 9 },
          { curve: szr, closed: false, offset: -27, count: 9 },
        ],
      };
    })(),
    spawn: mansion.spawn,
    garage: mansion.garage,
    indoors: (x, z) => mansion.indoors(x, z),
    terminal: { x: 198, z: 600, r: 7 },
    jetPark: { x: 345, z: 165, r: 7 },
    addJet,
    slots: [[-20, 27], [20, 27], [-8, 47], [8, 47], [-8, 59], [8, 59]].map(([x, z]) => ({ x: HOME.x + x, z: HOME.z + z, heading: 0 })),
    arenaDoor: { x: 250, z: -560, r: 7 },
    runway: { x: 300, z0: 170, z1: 710 },
    landmarks: [
      { x: HOME.x, z: HOME.z, color: '#e8c77a', name: 'Home' },
      { x: 250, z: -560, color: '#35aee2', name: 'Arena' },
      { x: 345, z: 165, color: '#ffffff', name: 'Jet Park' },
      { x: 300, z: -260, color: '#5f9c86', name: 'Burj' },
      { x: 198, z: 600, color: '#ffffff', name: 'Jets' },
    ],
    place(x, z) {
      const m = mansion.place(x, z);
      if (m) return m;
      if (x > 170 && z > 500) return 'Private Jet Terminal';
      if (x > 325 && x < 470 && z > 150 && z < 730) return 'Jet Park';
      if (Math.abs(x) < 30) return 'Sheikh Zayed Road';
      if (x > 200 && z < -100 && z > -420) return 'Downtown Dubai';
      if (x < -250) return 'Jumeirah Beach';
      return 'Dubai';
    },
  };
}
