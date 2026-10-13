import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './common.js';
import { hdri } from '../assets.js';
import { mesh } from '../models.js';
import { buildCrowdAtlas, crowdImpostors, crowd3D } from '../crowd.js';

// JesusInTech Live: a 10,000-seat arena. Stage faces +z; the crowd fills a seating bowl and a standing pit.
// Brand: black #050607, white, cyan #35AEE2.

const CYAN = 0x35aee2;

export const SLIDES = [
  { kicker: 'JesusInTech Live · Dubai', title: 'The Dream Life', sub: 'Richard Ogundele' },
  { kicker: 'Why we are here', title: 'Use AI to create opportunity.', sub: 'Build with purpose.' },
  { kicker: 'Three pillars', title: 'Opportunity. Protection. Faith.', sub: 'Practical AI, guarding what makes us human, character first.' },
  { kicker: 'Remember this', title: 'Faith does not remove the work.', sub: '' },
  { kicker: 'AIOS', title: 'Build the system behind your next move.', sub: 'aios.jesusintech.com' },
  { kicker: 'Proof', title: '1,000+ people taught.', sub: '3 offers from 30+ interviews. Your turn.' },
  { kicker: 'Start today', title: 'Start with the right pathway.', sub: 'jesusintech.com' },
];

function slideCanvas() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 820;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (i) => {
    const s = SLIDES[i];
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 2048, 820);
    g.addColorStop(0, '#050607'); g.addColorStop(1, '#0b1820');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2048, 820);
    ctx.fillStyle = '#35aee2'; ctx.fillRect(140, 150, 120, 10);
    ctx.font = '600 44px Helvetica Neue, Arial'; ctx.fillStyle = '#35aee2';
    ctx.fillText(s.kicker.toUpperCase(), 140, 120);
    ctx.fillStyle = '#ffffff';
    let size = 150;
    ctx.font = `800 ${size}px Helvetica Neue, Arial`;
    while (ctx.measureText(s.title).width > 1780 && size > 70) { size -= 6; ctx.font = `800 ${size}px Helvetica Neue, Arial`; }
    // wrap to two lines if needed
    const words = s.title.split(' ');
    let lines = [s.title];
    if (ctx.measureText(s.title).width > 1780) {
      lines = ['', ''];
      for (const w of words) { const l = lines[0] ? 1 : 0; if (ctx.measureText(lines[0] + ' ' + w).width < 1700 && !lines[1]) lines[0] = (lines[0] + ' ' + w).trim(); else lines[1] = (lines[1] + ' ' + w).trim(); }
    }
    lines.forEach((l, k) => ctx.fillText(l, 140, 360 + k * (size * 1.05)));
    if (s.sub) { ctx.font = '500 56px Helvetica Neue, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(s.sub, 140, 360 + lines.length * size * 1.05 + 40); }
    ctx.font = '700 34px Helvetica Neue, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('JESUSINTECH', 1720, 760);
    ctx.fillText(`${i + 1} / ${SLIDES.length}`, 140, 760);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

export function buildArena(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020305);
  scene.fog = new THREE.FogExp2(0x06090d, 0.006);
  scene.environment = hdri('dubai');
  scene.environmentIntensity = 0.12;
  const colliders = new Colliders();
  const tickers = [];
  scene.add(new THREE.HemisphereLight(0x2a3a4a, 0x000000, 0.5));

  // ---- stage + catwalk ----
  const gloss = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0f, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2.2), toneMapped: false });
  const stage = mesh(new THREE.BoxGeometry(28, 1.5, 12), gloss, { receive: true });
  stage.position.set(0, -0.75, 0);
  const walk = mesh(new THREE.BoxGeometry(4, 1.5, 6.5), gloss, { receive: true });
  walk.position.set(0, -0.75, 9.2);
  scene.add(stage, walk);
  for (const [w, x, z] of [[28, 0, 6.02], [4, 0, 12.47]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.04), led);
    strip.position.set(x, -0.08, z);
    scene.add(strip);
  }
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 6.5), led);
    side.position.set(s * 2.02, -0.08, 9.2);
    scene.add(side);
    for (const x of [5, 9]) { const mon = mesh(new THREE.BoxGeometry(0.9, 0.35, 0.55), gloss); mon.position.set(s * x, 0.17, 5.4); mon.rotation.x = -0.4; scene.add(mon); }
  }
  // keep the player on the stage + catwalk
  colliders.box(-7.85, 9.3, 11.7, 6.6);
  colliders.box(7.85, 9.3, 11.7, 6.6);
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.9 }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(0, 0.02, 9.5);
  scene.add(mark);

  // ---- LED screen with slides ----
  const slides = slideCanvas();
  slides.draw(0);
  const screenMat = new THREE.MeshBasicMaterial({ map: slides.tex, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25) });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), screenMat);
  screen.position.set(0, 8.2, -6.4);
  const frame = mesh(new THREE.BoxGeometry(31, 13, 0.4), gloss);
  frame.position.set(0, 8.2, -6.7);
  scene.add(frame, screen);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.2), screenMat);
    side.position.set(s * 24, 9, 2);
    side.rotation.y = -s * 0.5;
    scene.add(side);
  }

  // ---- floor, seating bowl ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 160), new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.5, 60);
  scene.add(floor);
  const rows = 44, a0 = -1.25, a1 = 1.25;
  const bowlParts = [];
  for (let i = 0; i < rows; i++) {
    const r = 34 + i * 1.0, y = -1.5 + i * 0.52;
    const tread = new THREE.RingGeometry(r, r + 1.0, 64, 1, -Math.PI / 2 - a1, a1 - a0); // arc toward +z after rotation
    tread.rotateX(-Math.PI / 2);
    tread.translate(0, y + 0.52, 0);
    bowlParts.push(tread);
  }
  const bowl = new THREE.Mesh(mergeGeometries(bowlParts), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9, side: THREE.DoubleSide }));
  scene.add(bowl);

  // ---- the crowd ----
  const spots = [];
  for (let i = 0; i < rows; i++) {
    const r = 34.5 + i * 1.0, y = -1.5 + (i + 1) * 0.52;
    const n = Math.floor(((a1 - a0) * r) / 0.62);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k + 0.5) * ((a1 - a0) / n);
      spots.push([Math.sin(a) * r, y, Math.cos(a) * r, a]);
    }
  }
  for (let i = 0; i < 1600; i++) { // standing pit in front of the stage
    const x = (Math.random() - 0.5) * 50, z = 14 + Math.random() * 18;
    if (Math.abs(x) < 3 && z < 13.5) continue;
    spots.push([x, -1.5, z, Math.atan2(x, z) * 0.3]);
  }
  // real people: a few in full 3D up front, everyone else as impostors rendered from the same models
  const faceStage = (x, z) => Math.atan2(-x, -(z - 2));
  const people = spots.map(([x, y, z]) => ({ x, y, z, face: faceStage(x, z), prefer: y < -1 ? 'michelle' : null }));
  const front = people.filter((p) => p.y < -1 && p.z < 16.5 && Math.abs(p.x) < 13).slice(0, 24);
  const frontSet = new Set(front);
  const atlas = buildCrowdAtlas(renderer);
  const impostors = crowdImpostors(atlas, people.filter((p) => !frontSet.has(p)), { light: 0.85 });
  // soft wash from the stage over the audience, like house lights at a show
  const wash = new THREE.DirectionalLight(0xffe7cc, 1.1);
  wash.position.set(0, 18, -4);
  wash.target.position.set(0, 0, 40);
  scene.add(wash, wash.target);
  scene.add(impostors);
  const near = crowd3D(front);
  scene.add(near);
  // phone lights
  const phones = [];
  spots.forEach(([x, y, z], i) => { if (i % 17 === 0) phones.push(x, y + 1.75, z); });
  const phoneGeo = new THREE.BufferGeometry();
  phoneGeo.setAttribute('position', new THREE.Float32BufferAttribute(phones, 3));
  const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.4, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const phoneMat = new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.6, 1.8), size: 0.14, map: dot, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  scene.add(new THREE.Points(phoneGeo, phoneMat));

  // ---- truss, spots, moving beams ----
  const truss = mesh(new THREE.BoxGeometry(34, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.8, roughness: 0.4 }));
  truss.position.set(0, 17, 4);
  scene.add(truss);
  const key = new THREE.SpotLight(0xfff2e0, 900, 60, 0.32, 0.5, 1.2);
  key.position.set(0, 16.5, 16);
  key.target.position.set(0, 1, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  for (const s of [-1, 1]) {
    const fill = new THREE.SpotLight(0xbfe6ff, 500, 60, 0.4, 0.6, 1.2);
    fill.position.set(s * 14, 16.5, 6);
    fill.target.position.set(0, 1, 6);
    scene.add(fill, fill.target);
  }
  const beamTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const ctx = cv.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(cv);
  })();
  const beams = [];
  const beamColors = [CYAN, 0xffffff, 0x8a5cff, CYAN, 0xffffff, 0x8a5cff, CYAN, 0xffffff];
  beamColors.forEach((col, i) => {
    const geoB = new THREE.ConeGeometry(1.7, 46, 20, 1, true);
    geoB.translate(0, -23, 0);
    const m = new THREE.Mesh(geoB, new THREE.MeshBasicMaterial({ color: col, map: beamTex, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const pivot = new THREE.Group();
    pivot.position.set(-15 + i * (30 / 7), 16.6, 4);
    pivot.add(m);
    scene.add(pivot);
    beams.push({ pivot, i });
  });

  // ---- state + animation ----
  const state = { slide: 0, excite: 0.35, talking: false, ovation: 0, t: 0 };
  let lastT = 0;
  tickers.push((t) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    state.t = t;
    impostors.material.uniforms.uTime.value = t;
    near.userData.update(dt, state.excite);
    if (state.ovation > 0) state.ovation = Math.max(0, state.ovation - 1 / 60);
    const target = state.ovation > 0 ? 1.6 : state.talking ? 0.55 : 0.35;
    state.excite += (target - state.excite) * 0.03;
    impostors.material.uniforms.uExcite.value = state.excite;
    phoneMat.opacity = 0.55 + Math.sin(t * 3) * 0.2;
    beams.forEach(({ pivot, i }) => {
      pivot.rotation.x = -0.75 + Math.sin(t * 0.5 + i) * 0.35; // tip toward the crowd (+z)
      pivot.rotation.z = Math.sin(t * 0.37 + i * 1.7) * 0.5;
    });
    mark.material.opacity = state.talking ? 0.15 : 0.6 + Math.sin(t * 3) * 0.3;
  });

  const shots = [
    { p: [0, 22, 62], l: [0, 6, 0], fov: 52 },
    { p: [4.2, 1.4, 13.4], l: [0, 1.5, 9.5], fov: 38 },
    { p: [12, 3, 13], l: [0, 1.5, 9], fov: 42 },
    { p: [1.1, 2.1, 7.6], l: [0, 2, 40], fov: 62 },
    { p: [-26, 9, 30], l: [0, 2.5, 8], fov: 45 },
  ];

  return {
    id: 'arena',
    name: 'DUBAI ARENA',
    scene,
    env: { follow() {}, sunDir: new THREE.Vector3(0, 1, 0) },
    colliders,
    roads: [], landmarks: [],
    bounds: { minX: -13.6, maxX: 13.6, minZ: -5.6, maxZ: 12.2 },
    tick: (t) => tickers.forEach((f) => f(t)),
    spawn: { x: -11, z: -3, heading: Math.PI / 2 },
    garage: [], life: {},
    interactions: [],
    stageMark: { x: 0, z: 9.5 },
    exit: { x: -12.5, z: -4.8 },
    crowdSize: spots.length,
    atlas,
    place: () => (state.talking ? 'Live on stage' : 'JesusInTech Live'),
    // talk controls
    startTalk() { state.talking = true; state.slide = 0; slides.draw(0); state.ovation = 1.2; },
    nextSlide(d) {
      state.slide = THREE.MathUtils.clamp(state.slide + d, 0, SLIDES.length - 1);
      slides.draw(state.slide);
      state.excite = Math.max(state.excite, 0.9);
    },
    endTalk() { state.talking = false; state.ovation = 6; },
    get excite() { return state.excite; },
    get slide() { return state.slide; },
    talkCamera(t) {
      const i = Math.floor(t / 5.5) % shots.length;
      const s = shots[i];
      const drift = (t % 5.5) / 5.5;
      return { pos: new THREE.Vector3(s.p[0] + drift * 1.5, s.p[1] + drift * 0.4, s.p[2] - drift * 1.2), look: new THREE.Vector3(...s.l), fov: s.fov };
    },
  };
}
