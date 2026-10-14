import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Everything from Poly Haven (CC0). Raw downloads live in assets-src/ (not served);
// models here were simplified + meshopt/webp compressed with gltf-transform.
const BASE = `${import.meta.env.BASE_URL}assets`; // the game lives at jesusintech.com/games/
const HDRIS = {
  monaco: 'ph/hdri/kloofendal_48d_partly_cloudy_puresky_4k.hdr',
  dubai: 'ph/hdri/kloofendal_43d_clear_puresky_4k.hdr',
};
const TEXTURES = ['clean_asphalt', 'asphalt_02', 'rectangular_paving', 'marble_01', 'painted_plaster_wall', 'clay_roof_tiles_02',
  'white_sandstone_blocks_02', 'coast_sand_01', 'leafy_grass', 'wood_floor_deck', 'granite_tile', 'dark_wood', 'concrete_floor_02'];
export const MODEL_NAMES = ['lamp_lo', 'shrub2_lo', 'island_tree_01', 'island_tree_02', 'island_tree_03', 'shrub_01', 'shrub_02', 'shrub_04', 'potted_plant_01', 'potted_plant_02',
  'coastal_cliff_01', 'coastal_cliff_02', 'mountainside', 'coast_rocks_01', 'coast_rocks_02', 'boulder_01', 'street_lamp_01',
  'modern_arm_chair_01', 'sofa_03', 'modern_coffee_table_01', 'outdoor_table_chair_set_01'];

const store = { hdri: {}, tex: {}, model: {}, gltf: {}, misc: {} };
// full glTFs (keep animations / named parts): three.js example models, see README credits
// The Ferrari model's licence is unconfirmed, so it only loads in local dev; the public build
// gives the 458 a lofted body instead (see CARS.f458) and the files are stripped from dist.
export const REAL_FERRARI = !import.meta.env.PROD;
const GLTFS = { ...(REAL_FERRARI ? { ferrari: 'models/ferrari.glb' } : {}), soldier: 'models/soldier.glb', cesiumman: 'models/cesiumman.glb', michelle: 'models/michelle.glb' };
let renderer = null;

export async function loadAll(r, onProgress = () => {}) {
  renderer = r;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const hdrLoader = new RGBELoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  gltfLoader.setDRACOLoader(draco);

  const jobs = [];
  for (const [k, p] of Object.entries(HDRIS)) {
    jobs.push(hdrLoader.loadAsync(`${BASE}/${p}`).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      store.hdri[k] = t;
    }));
  }
  for (const name of TEXTURES) {
    const set = (store.tex[name] = {});
    for (const ch of ['diff', 'nor', 'arm']) {
      jobs.push(texLoader.loadAsync(`${BASE}/ph/tex/${name}/${ch}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (ch === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        set[ch] = t;
      }));
    }
  }
  for (const name of MODEL_NAMES) {
    jobs.push(gltfLoader.loadAsync(`${BASE}/models/${name}.glb`).then((g) => { store.model[name] = g.scene; }));
  }
  for (const [k, p] of Object.entries(GLTFS)) {
    jobs.push(gltfLoader.loadAsync(`${BASE}/${p}`).then((g) => { store.gltf[k] = g; }));
  }
  if (REAL_FERRARI) jobs.push(texLoader.loadAsync(`${BASE}/models/ferrari_ao.png`).then((t) => { store.misc.ferrariAO = t; }));
  jobs.push(loadMixamo(manager));
  await Promise.all(jobs);
}

export const hdri = (k) => store.hdri[k];

/** PBR material from a Poly Haven texture set. repeat = tiles per UV unit. */
export function pbr(name, { repeat = [1, 1], color = 0xffffff, ...opts } = {}) {
  const s = store.tex[name];
  const clone = (t) => {
    const c = t.clone();
    c.repeat.set(...repeat);
    c.needsUpdate = true;
    return c;
  };
  const arm = clone(s.arm);
  return new THREE.MeshStandardMaterial({
    color,
    map: clone(s.diff),
    normalMap: clone(s.nor),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    metalness: 1, // the arm map's blue channel decides (0 for all of these)
    roughness: 1,
    ...opts,
  });
}

/** Raw texture set (for custom shaders that tile in world space). */
export const texSet = (name) => store.tex[name];

/** A fresh copy of a model's scene graph. */
export function model(name) {
  const m = store.model[name].clone(true);
  m.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      fixFoliage(o.material);
    }
  });
  return m;
}

function fixFoliage(mat) {
  // leaves: cut-out alpha (no sorting flicker), visible from both sides
  if (mat.map && (mat.transparent || mat.alphaTest > 0 || /leaf|leaves|alpha/i.test(mat.name))) {
    mat.transparent = false;
    mat.alphaTest = 0.45;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = true;
  }
}

// distance culling for chunked instances (updated once per frame from main.js)
const cullCells = [];
export function updateCulling(cameraPos) {
  for (const c of cullCells) {
    const d = c.center.distanceTo(cameraPos);
    const vis = d < c.maxDist + c.radius;
    for (const m of c.meshes) m.visible = vis;
  }
}

/**
 * Instanced copies of a model, split into spatial chunks so the camera and the
 * shadow camera can skip whole chunks, plus optional distance culling.
 * placements: [{x, y?, z, rot?, scale?}]
 */
export function instanced(name, placements, { shadows = true, chunk = 120, maxDist = Infinity } = {}) {
  const group = new THREE.Group();
  const src = store.model[name];
  src.updateMatrixWorld(true);
  const tmp = new THREE.Object3D();
  const m = new THREE.Matrix4();
  const cells = new Map();
  for (const p of placements) {
    const key = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  for (const list of cells.values()) {
    const meshes = [];
    src.traverse((o) => {
      if (!o.isMesh) return;
      // meshopt-quantized geometry keeps its scale/offset on the node, so fold the node
      // transform into each instance matrix rather than into the (integer) vertex data
      fixFoliage(o.material);
      const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      list.forEach((p, i) => {
        tmp.position.set(p.x, p.y || 0, p.z);
        tmp.rotation.set(0, p.rot ?? 0, 0);
        tmp.scale.setScalar(p.scale ?? 1);
        tmp.updateMatrix();
        im.setMatrixAt(i, m.multiplyMatrices(tmp.matrix, o.matrixWorld));
      });
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      meshes.push(im);
    });
    if (maxDist < Infinity && meshes.length) {
      const sphere = meshes[0].boundingSphere;
      cullCells.push({ center: sphere.center.clone(), radius: sphere.radius, maxDist, meshes });
    }
  }
  return group;
}

/** Material of a model's first mesh (to reuse its scanned textures on cheap geometry). */
export function modelMaterial(name) {
  let mat = null;
  store.model[name].traverse((o) => { if (!mat && o.isMesh) mat = o.material; });
  return mat;
}

/** Bounding box size of a model (metres), to scale things sensibly. */
export function modelSize(name) {
  return new THREE.Box3().setFromObject(store.model[name]).getSize(new THREE.Vector3());
}

/** A full glTF: { scene (fresh clone, skinning-safe), animations }. */
export function gltf(name) {
  const g = store.gltf[name];
  return { scene: cloneSkinned(g.scene), animations: g.animations };
}
export const misc = (k) => store.misc[k];

/**
 * Optional: your own Mixamo character. Drop these into public/assets/character/
 *   character.fbx (T-pose, "With Skin"), idle.fbx, walk.fbx, run.fbx ("Without Skin", walk/run "In Place")
 * If they're missing, the game uses the built-in soldier. See CHARACTER.md.
 */
async function loadMixamo(manager) {
  const base = `${BASE}/character`;
  const exists = async (f) => {
    try {
      const r = await fetch(`${base}/${f}`, { method: 'HEAD' });
      return r.ok && !(r.headers.get('content-type') || '').includes('text/html'); // dev server falls back to index.html
    } catch { return false; }
  };
  if (!(await exists('character.fbx'))) return;
  const loader = new FBXLoader(manager);
  const model = await loader.loadAsync(`${base}/character.fbx`);
  const clips = {};
  for (const name of ['idle', 'walk', 'run']) {
    if (!(await exists(`${name}.fbx`))) continue;
    const a = await loader.loadAsync(`${base}/${name}.fbx`);
    if (a.animations[0]) { clips[name] = a.animations[0]; clips[name].name = name; }
  }
  if (!clips.idle && model.animations[0]) clips.idle = model.animations[0];
  store.misc.mixamo = { model, clips };
}
