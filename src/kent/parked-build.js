// The parked cars' bodies and colliders, one tile at a time, from the catalogue in kent/parked.js.
// A car built by models.js buildCar is thirty-odd meshes; a street has thirty cars and a tile has
// ten streets, so the bodies are instanced: each catalogue body (loft and colour) is built once,
// collapsed to one geometry per material, and drawn as that many InstancedMeshes per tile.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARKED_W, PARKED_L } from './parked.js';

/**
 * net: RoadNet (net.parked is the catalogue); buildCar(spec) -> { root }; bodies: the catalog's
 * TRAFFIC list; groundY(x, z) -> y for the hills, or null.
 */
export function makeParkedBuilder({ net, buildCar, bodies, groundY = null, colliders: world = null }) {
  const protos = new Map(); // key -> [{ geometry, material }]
  const specs = [];
  for (const b of bodies) for (const color of b.colors || [0x888888]) specs.push({ ...b, color });
  const proto = (k) => {
    const spec = specs[k % specs.length], key = `${spec.loft}-${spec.color}`;
    let p = protos.get(key);
    if (p) return p;
    p = [];
    protos.set(key, p);
    try {
      const car = buildCar(spec);
      const root = car.root;
      root.updateMatrixWorld(true);
      const byMat = new Map();
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.length === 1 || !g.groups?.length) {
          const m = mats[0];
          if (!byMat.has(m)) byMat.set(m, []);
          byMat.get(m).push(g.index ? g.toNonIndexed() : g);
        } else {
          // a shell drawn with a material array: split it by group so paint and glass stay apart
          const ni = g.index ? g.toNonIndexed() : g;
          for (const grp of g.groups) {
            const m = mats[grp.materialIndex] || mats[0];
            const part = new THREE.BufferGeometry();
            for (const name of Object.keys(ni.attributes)) {
              const a = ni.attributes[name], item = a.itemSize, arr = a.array.slice(grp.start * item, (grp.start + grp.count) * item);
              part.setAttribute(name, new THREE.BufferAttribute(arr, item));
            }
            if (!byMat.has(m)) byMat.set(m, []);
            byMat.get(m).push(part);
          }
        }
      });
      for (const [material, list] of byMat) {
        // every piece needs the same attributes for a merge: drop any a piece lacks
        const names = ['position', 'normal', 'color', 'uv'].filter((n) => list.every((g) => g.attributes[n]));
        for (const g of list) for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
        const merged = mergeGeometries(list, false);
        if (merged) p.push({ geometry: merged, material });
      }
      // the build's own meshes are not wanted in the scene
      root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    } catch (e) { console.warn('parked: could not build a body', e); }
    return p;
  };

  return {
    name: 'parked',
    build(tile, lod) {
      if (lod !== 'near' || !net.parked) return null;
      const cars = net.parked.inRect(tile.x0, tile.z0, tile.x1, tile.z1);
      if (!cars.length) return null;
      const group = new THREE.Group();
      const colliders = [];
      const byProto = new Map();
      for (const c of cars) {
        const k = (Math.abs(Math.round(c.x * 7 + c.z * 13)) + c.way) % specs.length;
        if (!byProto.has(k)) byProto.set(k, []);
        byProto.get(k).push(c);
        colliders.push({ cx: c.x, cz: c.z, w: PARKED_W, d: PARKED_L, yaw: c.yaw, carOnly: false });
      }
      const o = new THREE.Object3D();
      for (const [k, list] of byProto) {
        const parts = proto(k);
        for (const { geometry, material } of parts) {
          const im = new THREE.InstancedMesh(geometry, material, list.length);
          list.forEach((c, i) => {
            o.position.set(c.x, groundY ? groundY(c.x, c.z) : 0, c.z);
            o.rotation.set(0, c.yaw, 0);
            o.scale.setScalar(1);
            o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          });
          im.castShadow = true;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          group.add(im);
        }
      }
      // the world's collider set is kept here, not by the TileManager (kent.js's has none): a car
      // the learner can hit, and the traffic can be bumped off
      const handles = world ? colliders.map((c) => world.obb(c.cx, c.cz, c.w, c.d, c.yaw, false)).filter(Boolean) : [];
      return { group, colliders, dispose() { for (const m of group.children) m.dispose?.(); for (const h of handles) world.remove(h); } };
    },
  };
}
