import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setupSky, buildRoad, buildingBlocks, streetLamps, Colliders, broadleafTrees } from './common.js';
import { M, waterMaterial, label, facadeMaterial } from '../materials.js';
import { palms, mesh } from '../models.js';
import { hdri, pbr } from '../assets.js';

// Singapore: Marina Bay. Marina Bay Sands and its SkyPark across the water from the CBD skyline,
// the Supertrees and domes of Gardens by the Bay, the Singapore Flyer, the Esplanade "durians",
// a loop road round the bay (left-hand traffic) and an expressway east to Changi.
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, z) => new THREE.Vector3(x, 0, z);

const BAY = { r: 220 };          // the water
const LOOP = 272;                // the bayfront loop road radius
const MBS = { x: 0, z: 350 };    // Marina Bay Sands (south shore, facing the CBD to the north)

function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

export function buildSingapore(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    hdri: hdri('monaco'), sunAzimuth: 15, exposure: 1.0, envIntensity: 0.9,
    sunColor: 0xffe9cf, sunIntensity: 3.2, fogDensity: 0.00032,
  });
  const colliders = new Colliders();
  const tickers = [];

  // ---- water: the bay and the Singapore Strait ----
  const water = waterMaterial(0x0f5064);
  tickers.push((t) => water.userData.tick(t));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  sea.receiveShadow = true;
  scene.add(sea);

  // ---- land with the bay cut out ----
  const shape = new THREE.Shape();
  shape.moveTo(-1100, -1000); shape.lineTo(1800, -1000); shape.lineTo(1800, 760); shape.lineTo(700, 760);
  shape.quadraticCurveTo(300, 820, -200, 760); shape.lineTo(-1100, 760); shape.lineTo(-1100, -1000);
  const hole = new THREE.Path();
  hole.absarc(0, 0, BAY.r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const landGeo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, curveSegments: 64 });
  landGeo.rotateX(Math.PI / 2); // shape y -> world z, extrude down
  const uv = landGeo.attributes.uv, p = landGeo.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
  const grass = pbr('leafy_grass', { repeat: [1, 1], color: 0x8fbf6a });
  const land = new THREE.Mesh(landGeo, [grass, new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.9 })]);
  land.receiveShadow = true;
  scene.add(land);
  // granite promenade round the water's edge
  const prom = new THREE.Mesh(new THREE.RingGeometry(BAY.r, BAY.r + 26, 96), pbr('granite_tile', { repeat: [60, 4], color: 0xe6e1d8 }));
  prom.rotation.x = -Math.PI / 2;
  prom.position.y = 0.02;
  prom.receiveShadow = true;
  scene.add(prom);
  const railing = new THREE.Mesh(new THREE.TorusGeometry(BAY.r + 0.4, 0.05, 4, 160), M.lamp);
  railing.rotation.x = Math.PI / 2;
  railing.position.y = 1.05;
  scene.add(railing);

  // ---- roads: bayfront loop + East Coast Parkway to Changi ----
  const loopPts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; loopPts.push(V(Math.cos(a) * LOOP, Math.sin(a) * LOOP)); }
  const loopCurve = new THREE.CatmullRomCurve3(loopPts, true);
  const loop = buildRoad(loopCurve, { closed: true, width: 16, curbs: false, step: 3 });
  const ecpCurve = new THREE.LineCurve3(V(LOOP + 4, 0), V(1430, 0));
  const ecp = buildRoad(ecpCurve, { width: 24, lanes: 4, curbs: false, step: 5, y: 0.028 });
  const roads = [loop, ecp];
  roads.forEach((r) => scene.add(r.mesh));
  scene.add(streetLamps(loop.points, 10, 8, M.lamp));
  // rain trees along the expressway (Singapore is a garden city)
  const palmSpots = [];
  for (let x = 330; x < 1400; x += 26) palmSpots.push([x, 18], [x, -18]);
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; palmSpots.push([Math.cos(a) * (LOOP + 14), Math.sin(a) * (LOOP + 14)]); }

  // ---- Marina Bay Sands ----
  const mbsMat = facadeMaterial({ winSize: [1.6, 3.2], winColor: 0x2e4a5e, amount: 0.92, roughness: 0.25, metalness: 0.6 });
  mbsMat.color.set(0xe9edf0);
  const H = 194;
  const towerShape = new THREE.Shape();
  // section through a tower: one straight leg, one gently curving leg that leans in
  towerShape.moveTo(-30, 0);
  towerShape.lineTo(30, 0);
  towerShape.quadraticCurveTo(14, H * 0.55, 18, H);
  towerShape.lineTo(-20, H);
  towerShape.lineTo(-30, 0);
  const towerGeo = new THREE.ExtrudeGeometry(towerShape, { depth: 32, bevelEnabled: false, curveSegments: 16 });
  towerGeo.translate(0, 0, -16);
  towerGeo.rotateY(Math.PI / 2); // section plane faces along the row
  const mbs = new THREE.Group();
  for (const x of [-95, 0, 95]) {
    const t = mesh(towerGeo, mbsMat);
    t.position.set(x, 0, 0);
    mbs.add(t);
    colliders.box(MBS.x + x, MBS.z, 34, 62);
  }
  // the SkyPark: a 340 m "ship" across all three towers, cantilevered at the east end
  const ship = new THREE.Shape();
  ship.moveTo(-150, -15);
  ship.lineTo(150, -17);
  ship.quadraticCurveTo(205, -10, 222, 0);
  ship.quadraticCurveTo(205, 10, 150, 17);
  ship.lineTo(-150, 15);
  ship.quadraticCurveTo(-170, 0, -150, -15);
  const shipGeo = new THREE.ExtrudeGeometry(ship, { depth: 9, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, curveSegments: 18 });
  shipGeo.rotateX(Math.PI / 2);
  const hull = mesh(shipGeo, new THREE.MeshPhysicalMaterial({ color: 0xf2f4f5, roughness: 0.35, clearcoat: 0.5 }));
  hull.position.y = H + 9;
  mbs.add(hull);
  // infinity pool along the bay-facing edge, glowing blue
  const pool = mesh(new THREE.BoxGeometry(150, 0.5, 9), new THREE.MeshPhysicalMaterial({ color: 0x2fc6e0, emissive: 0x0e6f86, emissiveIntensity: 0.8, roughness: 0.04, clearcoat: 1 }), { cast: false });
  pool.position.set(-50, H + 9.3, -10);
  mbs.add(pool);
  mbs.position.set(MBS.x, 0, MBS.z);
  scene.add(mbs);
  // podium (shoppes) between the towers and the water
  const podMat = facadeMaterial({ winSize: [3.2, 5], winColor: 0x1e3342, amount: 0.95, roughness: 0.2, metalness: 0.6 });
  podMat.color.set(0xdfe5e8);
  const podium = mesh(new THREE.BoxGeometry(300, 16, 26), podMat, { receive: true });
  podium.position.set(MBS.x, 8, MBS.z - 40);
  scene.add(podium);
  colliders.box(MBS.x, MBS.z - 40, 300, 26);
  const mbsLabel = label('Marina Bay Sands', { size: 4.2, sub: 'SkyPark · infinity pool' });
  mbsLabel.position.set(MBS.x, H + 46, MBS.z);
  scene.add(mbsLabel);

  // ---- ArtScience Museum: a white lotus at the water's edge ----
  const lotus = new THREE.Group();
  const petalShape = new THREE.Shape();
  petalShape.moveTo(-5, 0); petalShape.quadraticCurveTo(-7, 18, 0, 34); petalShape.quadraticCurveTo(7, 18, 5, 0); petalShape.lineTo(-5, 0);
  const petalGeo = new THREE.ExtrudeGeometry(petalShape, { depth: 2.5, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, curveSegments: 12 });
  const petalMat = new THREE.MeshPhysicalMaterial({ color: 0xf6f6f2, roughness: 0.3, clearcoat: 0.6 });
  for (let i = 0; i < 10; i++) {
    const petal = mesh(petalGeo, petalMat);
    const a = (i / 10) * Math.PI * 2;
    const holder = new THREE.Group();
    petal.rotation.x = -0.55 - (i % 2) * 0.2; // splay outward
    holder.add(petal);
    holder.rotation.y = a;
    lotus.add(holder);
  }
  const lotusBase = mesh(new THREE.CylinderGeometry(9, 12, 10, 24), petalMat);
  lotusBase.position.y = 5;
  lotus.add(lotusBase);
  lotus.position.set(-205, 0, 120);
  lotus.scale.setScalar(0.9);
  scene.add(lotus);
  colliders.box(-205, 120, 22, 22);

  // ---- Gardens by the Bay: Supertrees, the skyway, two glass domes ----
  const gardensC = { x: 140, z: 560 };
  const vertical = canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4d3a2c'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = pick(['#2f6b33', '#3f8a3a', '#6aa84f', '#8e3f7d', '#c2457f', '#d07b2f', '#2b5a2b']);
      ctx.beginPath(); ctx.arc(rand(0, w), rand(0, h), rand(3, 9), 0, Math.PI * 2); ctx.fill();
    }
  }, [3, 4]);
  const lattice = canvasTex(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#a55a2a'; ctx.lineWidth = 5;
    for (let x = -64; x < w + 64; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 32, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 32, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, h - 4); ctx.lineTo(w, h - 4); ctx.stroke();
  }, [6, 1]);
  const trunkMat = new THREE.MeshStandardMaterial({ map: vertical, roughness: 0.95 });
  const canopyMat = new THREE.MeshStandardMaterial({ map: lattice, color: 0xd9a27a, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.35, emissive: 0x6a2a7a, emissiveIntensity: 0.08 });
  const trees = [];
  const treeSpots = [[0, 0, 50], [36, 12, 44], [-30, 24, 42], [12, 44, 38], [-46, -12, 30], [52, -26, 28], [-12, -42, 32], [70, 34, 26], [-70, 30, 25], [28, -60, 27], [-40, 66, 26], [80, -70, 24]];
  for (const [dx, dz, h] of treeSpots) {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(2.6, 3.6, h, 18, 1, true), trunkMat);
    trunk.position.y = h / 2;
    const canopy = mesh(new THREE.CylinderGeometry(h * 0.3, 2.8, 9, 28, 1, true), canopyMat);
    canopy.position.y = h + 4.5;
    g.add(trunk, canopy);
    g.position.set(gardensC.x + dx, 0, gardensC.z + dz);
    scene.add(g);
    colliders.box(gardensC.x + dx, gardensC.z + dz, 7, 7);
    trees.push(g);
  }
  // OCBC Skyway: a curving walkway between the tallest trees
  const skyPts = [[0, 0], [36, 12], [12, 44], [-30, 24], [0, 0]].map(([x, z]) => new THREE.Vector3(gardensC.x + x, 22, gardensC.z + z));
  const skyway = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(skyPts, false), 80, 1.1, 6, false), new THREE.MeshStandardMaterial({ color: 0xd9d6cf, metalness: 0.4, roughness: 0.4 }));
  scene.add(skyway);
  const domeTex = canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(190,225,235,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }, [6, 2]);
  const domeMat = new THREE.MeshPhysicalMaterial({ map: domeTex, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.2, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  for (const [x, z, sx, sz, sy] of [[-170, 520, 90, 60, 38], [-150, 640, 70, 50, 52]]) {
    const dome = mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, { cast: false });
    dome.scale.set(sx / 2, sy, sz / 2);
    dome.position.set(x, 0, z);
    scene.add(dome);
    // the gardens inside
    const inner = mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 1, flatShading: true }));
    inner.scale.set(sx * 0.3, sy * 0.45, sz * 0.3);
    inner.position.set(x, 0, z);
    scene.add(inner);
    colliders.box(x, z, sx, sz);
  }
  const gardensLabel = label('Gardens by the Bay', { size: 3, sub: 'Supertree Grove' });
  gardensLabel.position.set(gardensC.x, 78, gardensC.z);
  scene.add(gardensLabel);

  // ---- Singapore Flyer ----
  const flyer = new THREE.Group();
  const R = 75, hub = 88;
  const wheel = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.6, roughness: 0.3 });
  wheel.add(mesh(new THREE.TorusGeometry(R, 1.1, 8, 120), steel));
  wheel.add(mesh(new THREE.TorusGeometry(R - 6, 0.6, 6, 120), steel));
  const spokeG = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.18, 0.18, R, 4);
    g.translate(0, R / 2, 0);
    g.rotateZ(a);
    spokeG.push(g);
  }
  wheel.add(mesh(mergeGeometries(spokeG), steel, { cast: false }));
  const capsuleG = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const g = new THREE.CapsuleGeometry(2.2, 5, 4, 10);
    g.rotateZ(Math.PI / 2);
    g.translate(Math.cos(a) * (R + 3), Math.sin(a) * (R + 3), 0);
    capsuleG.push(g);
  }
  const capsules = mesh(mergeGeometries(capsuleG), new THREE.MeshPhysicalMaterial({ color: 0x9fd3e6, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }), { cast: false });
  wheel.add(capsules);
  wheel.position.y = hub;
  flyer.add(wheel);
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.CylinderGeometry(1.4, 2.2, hub * 1.08, 8), steel);
    leg.position.set(s * 18, hub / 2, 4);
    leg.rotation.z = s * 0.2;
    flyer.add(leg);
  }
  const terminalBldg = mesh(new THREE.BoxGeometry(90, 14, 40), podMat, { receive: true });
  terminalBldg.position.set(0, 7, 30);
  flyer.add(terminalBldg);
  flyer.position.set(240, 0, -330);
  flyer.rotation.y = Math.atan2(240, -330) + Math.PI / 2; // face the bay
  scene.add(flyer);
  colliders.box(240, -330, 70, 70);
  tickers.push((t) => { wheel.rotation.z = t * 0.012; });
  const flyerLabel = label('Singapore Flyer', { size: 3 });
  flyerLabel.position.set(240, hub + R + 14, -330);
  scene.add(flyerLabel);

  // ---- Esplanade "durians" on the north shore ----
  const spikes = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8e8a80'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4b4842';
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.lineTo(x + 8, y); ctx.lineTo(x + 16, y + 14); ctx.fill(); }
  }, [10, 5]);
  const durianMat = new THREE.MeshStandardMaterial({ map: spikes, roughness: 0.6, metalness: 0.4 });
  for (const [x, z, s] of [[-120, -300, 34], [-60, -318, 26]]) {
    const d = mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), durianMat);
    d.scale.set(s, s * 0.7, s * 0.75);
    d.position.set(x, 0, z);
    scene.add(d);
    colliders.box(x, z, s * 1.8, s * 1.4);
  }

  // ---- the CBD skyline across the water (north and west) ----
  const tones = ['#6f93a8', '#88a7b8', '#4f7389', '#a9bcc6', '#5f8597', '#7c98a4', '#3e6377', '#c3cdd2'];
  const blocks = [];
  const roadClear = (x, z) => Math.abs(Math.hypot(x, z) - LOOP) < 30 || (x > 200 && Math.abs(z) < 34);
  const reserved = (x, z) => Math.hypot(x - 240, z + 330) < 70 || Math.hypot(x + 90, z + 310) < 60 || Math.hypot(x - MBS.x, z - MBS.z) < 200 || Math.hypot(x - gardensC.x, z - gardensC.z) < 230;
  let n = 0;
  while (blocks.length < 95 && n++ < 5000) {
    const a = rand(Math.PI * 0.95, Math.PI * 1.85), r = rand(320, 820);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (roadClear(x, z) || reserved(x, z)) continue;
    const near = r < 520;
    const w = rand(24, 40), d = rand(24, 40);
    const h = near ? (Math.random() < 0.25 ? rand(230, 300) : rand(110, 210)) : rand(60, 170);
    if (blocks.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 14 && Math.abs(b.z - z) < (b.d + d) / 2 + 14)) continue;
    blocks.push({ x, z, w, d, h, color: pick(tones) });
    if (Math.random() < 0.35) blocks.push({ x, z, y: h, w: w * 0.55, d: d * 0.55, h: rand(10, 36), color: pick(tones) });
    colliders.box(x, z, w, d);
  }
  // lower-rise everywhere else on the island so the horizon reads as a city
  n = 0;
  let low = 0;
  while (low < 110 && n++ < 6000) {
    const x = rand(-1000, 1300), z = rand(-950, 700);
    const r = Math.hypot(x, z);
    if (r < 330 || roadClear(x, z) || reserved(x, z) || (x > 1300 && z > -700) || (x > 260 && Math.abs(z) < 60)) continue;
    const w = rand(24, 40), d = rand(24, 40), h = rand(30, 90);
    if (blocks.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 8 && Math.abs(b.z - z) < (b.d + d) / 2 + 8)) continue;
    blocks.push({ x, z, w, d, h, color: pick(['#d9cfbf', '#cbbfae', '#b7c1c6', '#e2d8c8', '#a9b7a8']) });
    colliders.box(x, z, w, d);
    low++;
  }
  scene.add(buildingBlocks(blocks, { winSize: [1.8, 3.4], winColor: 0x22404f, amount: 0.92, roughness: 0.3, metalness: 0.45 }));

  scene.add(palms(palmSpots));
  // a few round towers with crowns among the boxes, so the skyline isn't all slabs
  const glass = facadeMaterial({ winSize: [1.4, 3.4], winColor: 0x1f3d4d, amount: 0.95, roughness: 0.15, metalness: 0.7 });
  glass.color.set(0x9fb8c6);
  for (const [x, z, r, h] of [[-330, -330, 20, 285], [-420, -210, 17, 245], [-250, -420, 18, 262], [-470, -380, 15, 220]]) {
    if (blocks.some((b) => Math.abs(b.x - x) < b.w / 2 + r + 4 && Math.abs(b.z - z) < b.d / 2 + r + 4)) continue;
    const t = mesh(new THREE.CylinderGeometry(r * 0.86, r, h, 28), glass);
    t.position.set(x, h / 2, z);
    scene.add(t);
    const crown = mesh(new THREE.ConeGeometry(r * 0.86, r * 1.6, 28), new THREE.MeshStandardMaterial({ color: 0xd9dee2, metalness: 0.8, roughness: 0.25 }));
    crown.position.set(x, h + r * 0.8, z);
    scene.add(crown);
    colliders.box(x, z, r * 2, r * 2);
  }
  // rain trees: parks round the bay, the gardens, along the roads
  const rainSpots = [];
  let tt = 0;
  while (rainSpots.length < 520 && tt++ < 9000) {
    const x = rand(-900, 1400), z = rand(-900, 740);
    const r = Math.hypot(x, z);
    if (r < BAY.r + 30 || Math.abs(r - LOOP) < 14 || (x > 270 && Math.abs(z) < 16) || Math.hypot(x - MBS.x, z - MBS.z) < 130 || Math.hypot(x - 240, z + 330) < 70) continue;
    if (blocks.some((b) => Math.abs(b.x - x) < b.w / 2 + 4 && Math.abs(b.z - z) < b.d / 2 + 4)) continue;
    if (x > 1380 || Math.hypot(x - gardensC.x, z - gardensC.z) < 95) continue;
    if (Math.hypot(x + 160, z - 580) < 90) continue; // the domes
    rainSpots.push({ x, z, s: rand(1.2, 1.9), sx: rand(1.6, 2.4) }); // broad, umbrella-like
  }
  scene.add(broadleafTrees(rainSpots, { leaf: [0.28, 0.45, 0.24] }));

  // ---- Changi: private jet terminal + runway ----
  const runway = buildRoad(new THREE.LineCurve3(V(1500, -640), V(1500, 260)), { width: 44, curbs: false, y: 0.035, step: 6 });
  scene.add(runway.mesh);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 140), new THREE.MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.9 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(1445, 0.025, -60);
  apron.receiveShadow = true;
  scene.add(apron);
  const termMat = facadeMaterial({ winSize: [2.4, 5], winColor: 0x1c2e3b, amount: 0.95, roughness: 0.3, metalness: 0.5 });
  termMat.color.set(0xe6e1d6);
  const term = mesh(new THREE.BoxGeometry(26, 12, 70), termMat, { receive: true });
  term.position.set(1410, 6, -90);
  scene.add(term);
  colliders.box(1410, -90, 26, 70);
  const termLabel = label('Changi Jet Centre', { size: 1.6, sub: 'Jets to Monaco and Dubai' });
  termLabel.position.set(1430, 14, -20);
  scene.add(termLabel);
  const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(1425, 0.2, -20);
  scene.add(ring);
  tickers.push((t) => ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06));

  // the hotel drop-off on the south side of the loop, below the towers
  const drop = new THREE.Mesh(new THREE.PlaneGeometry(120, 16), pbr('granite_tile', { repeat: [30, 4], color: 0xd9d4ca }));
  drop.rotation.x = -Math.PI / 2;
  drop.position.set(0, 0.03, LOOP + 16);
  scene.add(drop);

  const sense = (curve, dir) => ({ curve, closed: true, offset: -4, dir, count: 6, speed: [12, 16] });
  return {
    id: 'singapore',
    name: 'SINGAPORE',
    scene, env, colliders, roads,
    bounds: { minX: -900, maxX: 1600, minZ: -900, maxZ: 740 },
    tick: (t) => tickers.forEach((f) => f(t)),
    // Singapore drives on the left: negative offset = left of each car's direction of travel
    life: {
      cars: [sense(loopCurve, 1), sense(loopCurve, -1), { curve: ecpCurve, closed: false, offset: -4, dir: 1, count: 3, speed: [20, 26] }, { curve: ecpCurve, closed: false, offset: -4, dir: -1, count: 3, speed: [20, 26] }],
      peds: [
        { curve: new THREE.CatmullRomCurve3(Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return V(Math.cos(a) * (BAY.r + 8), Math.sin(a) * (BAY.r + 8)); }), true), closed: true, offset: 0, count: 26 },
      ],
    },
    // arrive at the promenade below Marina Bay Sands, looking across the water at the skyline
    spawn: { x: 10, z: BAY.r + 12, heading: Math.PI },
    garage: [
      { id: 'cullinan', x: -24, z: LOOP + 16, heading: Math.PI / 2 },
      { id: 'revuelto', x: 24, z: LOOP + 16, heading: Math.PI / 2 },
    ],
    terminal: { x: 1425, z: -20, r: 7 },
    runway: { x: 1500, z0: -560, z1: 240 },
    landmarks: [
      { x: MBS.x, z: MBS.z, color: '#e8c77a', name: 'Marina Bay Sands' },
      { x: gardensC.x, z: gardensC.z, color: '#7ed37a', name: 'Gardens' },
      { x: 240, z: -330, color: '#35aee2', name: 'Flyer' },
      { x: 1425, z: -20, color: '#ffffff', name: 'Jets' },
    ],
    place(x, z) {
      const r = Math.hypot(x, z);
      if (x > 1300) return 'Changi Jet Centre';
      if (Math.hypot(x - gardensC.x, z - gardensC.z) < 200) return 'Gardens by the Bay';
      if (Math.hypot(x - MBS.x, z - MBS.z) < 170) return 'Marina Bay Sands';
      if (Math.hypot(x - 240, z + 330) < 110) return 'Singapore Flyer';
      if (r < BAY.r + 30) return 'Marina Bay Promenade';
      if (x > 280) return 'East Coast Parkway';
      if (z < 0 && x < 0) return 'Raffles Place';
      return 'Marina Bay';
    },
  };
}
