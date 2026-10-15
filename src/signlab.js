// Dev-only: eyeball every catalogue sign, six direction signs and the marking decals.
// /signlab.html            whole grid     ?cat=regulatory|warning|plate|direction|marking
// /signlab.html?only=speed_30&res=2       one sign large   ?band=60 changes the size band
// Not part of the production build (vite.config.js only bundles index.html).
import * as THREE from 'three';
import { SIGN_LIST, makeSign, makeMarking, signsReady } from './signs.js';

const q = new URLSearchParams(location.search);
const band = q.get('band') || '30';
const detail = Number(q.get('res')) || 1;
const only = q.get('only');
const cat = q.get('cat');

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // same as the game, so colours are judged as they will ship
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec2e6);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 600);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-25, 45, -35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
sun.shadow.camera.right = sun.shadow.camera.top = 60;
sun.shadow.camera.far = 200;
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x5c6b4a, 0.9));

const info = document.getElementById('info');
await signsReady();

// ---- what to show ----
// per-id options so every catalogue entry renders something sensible
const OPTS = {
  speed_repeater: { limit: '30' },
  countdown_markers: { bars: 3, status: 'primary' },
  chevron_board: { modules: 2, dir: 'left' },
  give_way_ahead: { plate: { lines: ['GIVE WAY', '50 yds'] } },
  roundabout_ahead: { plate: 'reduce_speed_now' },
  school_children: { plate: 'school_plate' },
  road_humps: { plate: { text: 'for 400 yds' } },
  keep_left_bollard: { mount: 'bollard' },
  town_entry: { name: 'HERNE BAY' },
  distance_plate: { text: '200 yds' },
  speed_nsl: { back: 'speed_30' },
};
const signEntries = SIGN_LIST.filter((s) => s.category !== 'marking');
const groups = {
  regulatory: signEntries.filter((s) => s.category === 'regulatory' || s.category === 'informatory'),
  warning: signEntries.filter((s) => s.category === 'warning'),
  plate: signEntries.filter((s) => s.category === 'plate'),
  direction: signEntries.filter((s) => s.category === 'direction'),
};
// six direction signs covering every type and status
const DIRECTIONS = [
  { type: 'map', status: 'primary', arms: [
    { bearing: 270, dest: ['Herne Bay'], route: '(A291)', routeStatus: 'nonprimary' },
    { bearing: 0, dest: ['Canterbury'], route: 'A28' },
    { bearing: 60, dest: ['Margate'], route: 'A28' },
    { bearing: 120, dest: ['Sturry'] }] },
  { type: 'map', status: 'nonprimary', arms: [
    { bearing: 270, dest: ['Whitstable'], patch: { route: '(A299)', status: 'primary' } },
    { bearing: 0, dest: ['Herne Bay'] },
    { bearing: 90, dest: ['Margate', 'Ramsgate'], route: 'A299', routeStatus: 'primary' }] },
  { type: 'stack', status: 'primary', arms: [
    { bearing: 270, dest: ['Whitstable'], route: 'A290', routeStatus: 'nonprimary' },
    { bearing: 0, dest: ['Canterbury'], route: 'A28' },
    { bearing: 90, dest: ['Herne Bay'], route: 'A291', routeStatus: 'nonprimary' }] },
  { type: 'lanes', status: 'primary', lanes: [
    { arrows: ['left'], dest: ['Herne Bay'], route: '(A291)' },
    { arrows: ['ahead'], dest: ['Canterbury'], route: 'A28' },
    { arrows: ['ahead'], dest: ['Canterbury'], route: 'A28' }] },
  { type: 'flag', status: 'nonprimary', dest: ['Herne Bay'], route: 'A291', distance: '3' },
  { type: 'stack', status: 'motorway', junction: '7', arms: [
    { bearing: 45, dest: ['London', 'Rochester'], route: 'M2' },
    { bearing: 0, dest: ['Dover', 'Canterbury'], route: 'A2', routeStatus: 'primary' }] },
];
const MARKINGS = [
  ['lane_arrow_1038', { kind: 'ahead' }], ['lane_arrow_1038', { kind: 'left' }], ['lane_arrow_1038', { kind: 'right' }],
  ['lane_arrow_1038', { kind: 'ahead_left' }], ['lane_arrow_1038', { kind: 'ahead_right' }], ['lane_arrow_1038', { kind: 'left_right' }],
  ['lane_arrow_1038', { kind: 'ahead', length: 6000 }], ['deflection_arrow_1014', {}], ['bifurcation_arrow_1039', {}],
  ['give_way_triangle_1023A', {}], ['slow_1024', {}], ['stop_word_1022', {}], ['keep_clear_1026', {}], ['no_entry_1046', {}],
  ['bus_lane_1049A_1048', {}], ['lane_destination_1035', { text: 'A28' }], ['lane_destination_1035', { text: 'HERNE BAY' }],
  ['cycle_symbol_1057', {}], ['speed_roundel_1065', { limit: '30' }], ['mini_roundabout_1003_4', {}], ['guidance_arrow_1038_1', {}],
  ['box_junction_1043', { wMm: 5000, hMm: 5000 }],
  ['zigzag_1001_4', { lengthM: 8 }], ['hatched_1040', { widthM: 3, lengthM: 9 }], ['chevron_1042', { lengthM: 8 }],
  ['centre_line_1008', { lengthM: 12 }], ['hazard_warning_1004', { lengthM: 12 }], ['lane_line_1005', { lengthM: 12 }],
  ['edge_line_1012_1', { lengthM: 12 }], ['double_yellow_1018_1', { lengthM: 12 }],
  ['give_way_1003A', { widthM: 5.4 }], ['roundabout_give_way_1003_1', { widthM: 6 }], ['zebra_crossing', { widthM: 6 }],
  ['stop_line_1002_1', { widthM: 3.5 }],
];

// ---- scene building ----
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x5f8a3f, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function tag(text, x, z, w = 2.6) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#fff'; ctx.font = '600 40px Helvetica Neue, Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48, 500);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(w, w * 96 / 512, 1);
  s.position.set(x, 0.3, z - 0.6);
  scene.add(s);
}
const placed = []; // { obj, box } for camera framing
function place(obj, x, z, label) {
  obj.position.set(x, 0, z);
  scene.add(obj);
  obj.updateMatrixWorld(true);
  placed.push({ obj, box: new THREE.Box3().setFromObject(obj) });
  if (label) tag(label, x, z);
}
function catalogueSign(entry, x, z) {
  const o = { id: entry.id, band, detail, ...(OPTS[entry.id] || {}) };
  let g;
  try { g = makeSign(o); } catch (e) { console.error(entry.id, e); return; }
  place(g, x, z, `${entry.id} · ${entry.diagram}`);
}
function gridRows(entries, cols, dx, z0, dz, fn) {
  entries.forEach((e, i) => fn(e, (i % cols - (Math.min(cols, entries.length) - 1) / 2) * dx, z0 + Math.floor(i / cols) * dz));
  return z0 + Math.ceil(entries.length / cols) * dz;
}

const ids = signEntries.map((s) => s.id);
if (only) {
  const entry = signEntries.find((s) => s.id === only);
  if (entry) catalogueSign(entry, 0, 0);
  else if (only.startsWith('dir')) place(makeSign({ direction: { ...DIRECTIONS[Number(only.slice(3)) || 0], band, detail } }), 0, 0, only);
  else if (only.startsWith('mark')) { const m = MARKINGS[Number(only.slice(4)) || 0]; place(makeMarking(m[0], { ...m[1], detail }), 0, 0, `${m[0]} ${JSON.stringify(m[1])}`); }
  else { // marking by id
    const m = MARKINGS.find((mm) => mm[0] === only);
    if (m) place(makeMarking(m[0], { ...m[1], detail }), 0, 0, m[0]);
  }
} else {
  let z = 0;
  const want = (k) => !cat || cat === k;
  if (want('regulatory')) z = gridRows(groups.regulatory, 10, 3.6, z, 7, catalogueSign);
  if (want('warning')) z = gridRows(groups.warning, 10, 3.6, z, 7, catalogueSign);
  if (want('plate')) z = gridRows(groups.plate, 10, 3.6, z, 7, catalogueSign);
  if (want('direction')) {
    z = gridRows(groups.direction, 6, 7, z, 9, catalogueSign);
    z = gridRows(DIRECTIONS, 3, 11, z, 9, (d, x, zz) => place(makeSign({ direction: { ...d, band, detail } }), x, zz, `${d.type} · ${d.status}`));
  }
  if (want('marking')) {
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(90, 46), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set(0, 0.002, z + 17);
    asphalt.receiveShadow = true;
    scene.add(asphalt);
    gridRows(MARKINGS, 12, 7, z + 3, 14, (m, x, zz) => place(makeMarking(m[0], { ...m[1], detail }), x, zz, `${m[0]}${m[1].kind ? ' ' + m[1].kind : m[1].text ? ' ' + m[1].text : ''}`));
  }
}

// ---- camera: frame everything from the front (signs face -z) ----
function frameAll() {
  const box = new THREE.Box3();
  placed.forEach((p) => box.union(p.box));
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z * 0.7) / 2;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * (only ? 1.15 : 1.05);
  const elevation = only ? 0.12 : 0.55; // look down more on the full grid so rows don't hide each other
  camera.position.set(centre.x, centre.y + dist * elevation, centre.z - dist * Math.cos(Math.asin(Math.min(1, elevation))));
  camera.lookAt(centre.x, centre.y - (only ? 0 : size.y * 0.1), centre.z);
}
frameAll();
function draw() { renderer.render(scene, camera); }
draw();
info.textContent = `${placed.length} objects · band ${band}${only ? ` · ${only}` : ''}\n?only=<id> ?cat=regulatory|warning|plate|direction|marking ?band=60 ?res=2`;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); draw(); });
let drag = null;
addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { // drag to pan, wheel to dolly: enough to inspect a sign
  if (!drag) return;
  const k = camera.position.distanceTo(new THREE.Vector3(0, 1, 0)) * 0.0015;
  camera.translateX(-(e.clientX - drag[0]) * k); camera.translateY((e.clientY - drag[1]) * k);
  drag = [e.clientX, e.clientY]; draw();
});
addEventListener('wheel', (e) => { camera.translateZ(e.deltaY * 0.02); draw(); });

window.__signLabReady = true;
window.__signLab = {
  ids, scene, camera, renderer, draw,
  // dev: render the current frame and save it to shots/<name>.jpg via the Vite dev server (as __game.shot does)
  async shot(name = 'signlab', w = 1280, h = 800) {
    const prev = renderer.getSize(new THREE.Vector2());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
    const url = renderer.domElement.toDataURL('image/jpeg', 0.88);
    renderer.setSize(prev.x, prev.y, false);
    camera.aspect = prev.x / prev.y;
    camera.updateProjectionMatrix();
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return name;
  },
};
