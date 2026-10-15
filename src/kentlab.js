// Dev-only: look at Kent road tiles under the real sky. /kentlab.html?x=300&z=200
// Uses public/assets/kent/region.json when it exists, else the fixture network.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadAll, hdri, pbr, instanced, updateCulling } from './assets.js';
import { setupSky, Colliders } from './worlds/common.js';
import { makeRoadMaterials, makeRoadBuilder, netView } from './kent/roads.js';
import { TileManager } from './kent/tiles.js';
import { FIXTURE } from './kent/fixture.js';

const q = new URLSearchParams(location.search);
const info = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 8000);
await loadAll(renderer, (p) => (info.textContent = `loading ${Math.round(p * 100)}%`));
const env = setupSky(scene, renderer, { hdri: hdri('monaco'), sunAzimuth: 200, exposure: 0.95, envIntensity: 0.9, sunColor: 0xfff4e6, sunIntensity: 2.6, fogDensity: 0.0011, fogTint: 0.95 });

// ---- data: region.json if present, else the fixture ----
let data = FIXTURE, source = 'fixture';
try {
  const r = await fetch(`${import.meta.env.BASE_URL}assets/kent/region.json`);
  if (r.ok && (r.headers.get('content-type') || '').includes('json')) { data = await r.json(); source = 'region.json'; }
} catch { /* fixture */ }
let net = data;
try {
  const mod = await import('./kent/net.js');
  if (mod.RoadNet) { net = new mod.RoadNet(data); if (!net.data) net.data = data; source += ' + RoadNet'; }
} catch { /* raw data works too */ }
const view = netView(net);

// ---- materials: decals come from src/signs.js when it is there ----
let decal = null;
try {
  const signs = await import('./signs.js');
  if (signs.signsReady) await signs.signsReady();
  const cache = new Map();
  decal = (id, opts) => {
    const key = `${id}|${JSON.stringify(opts)}`;
    if (!cache.has(key)) {
      const tex = signs.markingTexture(id, opts);
      cache.set(key, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    }
    return cache.get(key);
  };
} catch (e) { console.warn('kentlab: no signs.js decals', e); }
const mats = makeRoadMaterials({ pbr, decal, planting: (spots) => instanced('shrub_01', spots, { maxDist: Infinity }) });

// ---- ground ----
const b = view.bounds || { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX + 2000, b.maxZ - b.minZ + 2000), pbr('leafy_grass', { repeat: [(b.maxX - b.minX + 2000) / 6, (b.maxZ - b.minZ + 2000) / 6], color: 0x9fbf86 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set((b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2);
ground.receiveShadow = true;
scene.add(ground);

// ---- tiles ----
const colliders = new Colliders();
const start = { x: Number(q.get('x')) || (source.startsWith('fixture') ? 300 : (data.home?.x ?? 0)), z: Number(q.get('z')) || (source.startsWith('fixture') ? 200 : (data.home?.z ?? 0)) };
const lodForce = q.get('lod');
const builder = makeRoadBuilder({ net, colliders, mats });
if (lodForce) { const inner = builder.build; builder.build = (tile, lod) => inner(tile, lodForce); }
const tiles = new TileManager({ net, scene, builders: [builder], near: Number(q.get('near')) || 900, far: Number(q.get('far')) || 1800, dropAt: 2600, budgetMs: 6 });

// ---- camera ----
const target = new THREE.Vector3(start.x, 0, start.z);
camera.position.set(start.x + 90, 70, start.z + 90);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.update();
const keys = {};
addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

let last = performance.now();
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  // WASD moves the orbit target (and so the streaming centre) in the camera's horizontal frame
  const f = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const v = (keys.shift ? 120 : 40) * dt;
  const mv = new THREE.Vector3();
  if (keys.w) mv.addScaledVector(f, v); if (keys.s) mv.addScaledVector(f, -v); if (keys.d) mv.addScaledVector(r, v); if (keys.a) mv.addScaledVector(r, -v);
  if (mv.lengthSq()) { controls.target.add(mv); camera.position.add(mv); }
  controls.update();
  tiles.update(controls.target.x, controls.target.z, dt);
  env.follow(controls.target);
  updateCulling(camera.position);
  renderer.render(scene, camera);
  const s = tiles.stats();
  const lb = s.lastBuild;
  info.textContent = `${source} · view ${controls.target.x.toFixed(0)}, ${controls.target.z.toFixed(0)}\ntiles near ${s.near} far ${s.far} pending ${s.pending} · ${s.tris.toLocaleString()} tris · ${colliders.boxes.length} colliders`
    + (lb ? `\nlast build ${lb.key} ${lb.lod} ${lb.ms.toFixed(1)} ms` + (lb.stats ? ` · ${lb.stats.tris.toLocaleString()} tris ${JSON.stringify(lb.stats.byMat)}` : '') : '');
  requestAnimationFrame(frame);
}
frame();

window.__kentLab = {
  scene, camera, renderer, tiles, controls, colliders, view, mats,
  // dev: render the current frame and save it to shots/<name>.jpg via the Vite dev server
  async shot(name = 'kent', w = 1280, h = 800) {
    const prev = renderer.getSize(new THREE.Vector2());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.88);
    renderer.setSize(prev.x, prev.y, false);
    camera.aspect = prev.x / prev.y;
    camera.updateProjectionMatrix();
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return name;
  },
  // move the view point (tiles follow) and aim the camera from a given offset
  look(x, z, dx = 60, dy = 40, dz = 60) {
    controls.target.set(x, 0, z);
    camera.position.set(x + dx, dy, z + dz);
    controls.update();
  },
};
