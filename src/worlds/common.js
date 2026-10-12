import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { roadTexture, curbTexture, facadeMaterial } from '../materials.js';

// ---------- sky, sun, environment ----------

export function setupSky(scene, renderer, { elevation, azimuth, turbidity = 6, rayleigh = 1.6, fog = 0xd9c7a8, fogNear = 180, fogFar = 1400, sunColor = 0xffe2b8, sunIntensity = 3.2, hemi = [0xbfd6ff, 0x8a7a60, 0.6] }) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity;
  u.rayleigh.value = rayleigh;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Environment map from the sky itself, so paint and glass reflect the real sky colours.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(10000);
  Object.keys(u).forEach((k) => (envSky.material.uniforms[k].value = u[k].value));
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 20000).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();

  scene.fog = new THREE.Fog(fog, fogNear, fogFar);

  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));

  return {
    sun, sunDir,
    follow(target) {
      sun.position.copy(target).addScaledVector(sunDir, 200);
      sun.target.position.copy(target);
    },
  };
}

// ---------- roads ----------

/**
 * Builds a road ribbon along a curve. Returns the mesh plus sampled centre points
 * (used for the minimap and for keeping buildings off the road).
 */
export function buildRoad(curve, { width = 14, lanes = 2, closed = false, y = 0.03, curbs = true, step = 2 } = {}) {
  const length = curve.getLength();
  const n = Math.max(8, Math.floor(length / step));
  const pts = curve.getSpacedPoints(n);
  if (closed) pts.pop();
  const count = closed ? pts.length + 1 : pts.length;

  const pos = [], uv = [], idx = [];
  const curbPos = [], curbUv = [], curbIdx = [];
  let dist = 0;
  const tex = roadTexture(lanes);
  const texLen = Math.min(width * 2.2, 26);

  for (let i = 0; i < count; i++) {
    const p = pts[i % pts.length];
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const a = !closed && i === 0 ? p : prev;
    const b = !closed && i === count - 1 ? p : next;
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const nrm = new THREE.Vector3(-t.z, 0, t.x);
    if (i > 0) dist += p.distanceTo(pts[(i - 1) % pts.length]);
    const L = p.clone().addScaledVector(nrm, width / 2);
    const R = p.clone().addScaledVector(nrm, -width / 2);
    pos.push(L.x, y, L.z, R.x, y, R.z);
    uv.push(0, dist / texLen, 1, dist / texLen);
    if (curbs) {
      for (const s of [1, -1]) {
        const inner = p.clone().addScaledVector(nrm, s * width / 2);
        const outer = p.clone().addScaledVector(nrm, s * (width / 2 + 1.0));
        curbPos.push(inner.x, y + 0.05, inner.z, outer.x, y + 0.05, outer.z);
        curbUv.push(0, dist / 3, 1, dist / 3);
      }
    }
    if (i < count - 1) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      if (curbs) {
        const c = i * 4;
        curbIdx.push(c, c + 4, c + 1, c + 1, c + 4, c + 5);
        curbIdx.push(c + 2, c + 3, c + 6, c + 3, c + 7, c + 6);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group();
  const road = new THREE.Mesh(geo, mat);
  road.receiveShadow = true;
  group.add(road);

  if (curbs) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(curbUv, 2));
    cg.setIndex(curbIdx);
    cg.computeVertexNormals();
    const curb = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    curb.receiveShadow = true;
    group.add(curb);
  }
  return { mesh: group, points: pts, width, closed };
}

export function distToRoads(x, z, roads) {
  let best = Infinity;
  for (const r of roads) {
    for (const p of r.points) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

// ---------- instanced buildings ----------

/**
 * blocks: [{x, z, w, d, h, y?, color}] -> one InstancedMesh (facade shader gives each one windows).
 */
export function buildingBlocks(blocks, matOpts) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, facadeMaterial(matOpts), blocks.length);
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  blocks.forEach((b, i) => {
    o.position.set(b.x, b.y || 0, b.z);
    o.rotation.set(0, 0, 0);
    o.scale.set(b.w, b.h, b.d);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c.set(b.color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Hipped terracotta roofs for a subset of blocks. */
export function roofs(blocks, material) {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, material, blocks.length);
  const o = new THREE.Object3D();
  blocks.forEach((b, i) => {
    o.position.set(b.x, (b.y || 0) + b.h, b.z);
    o.scale.set(b.w * 1.04, Math.min(b.w, b.d) * 0.28, b.d * 1.04);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.castShadow = true;
  return mesh;
}

/** Simple instanced street lamps along road points. */
export function streetLamps(points, offset, every, material, { double = false } = {}) {
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.6);
  const spots = [];
  for (let i = 0; i < points.length; i += every) {
    const p = points[i];
    const q = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(q, p).setY(0).normalize();
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const sides = double ? [0] : [1, -1];
    for (const s of sides) spots.push({ p: p.clone().addScaledVector(n, s * offset), n: n.clone().multiplyScalar(s || 1), both: double });
  }
  const poles = new THREE.InstancedMesh(poleGeo, material, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, material, spots.length * (double ? 2 : 1));
  const o = new THREE.Object3D();
  let h = 0;
  spots.forEach((s, i) => {
    o.position.copy(s.p); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix();
    poles.setMatrixAt(i, o.matrix);
    const dirs = s.both ? [1, -1] : [-1];
    for (const d of dirs) {
      o.position.copy(s.p).addScaledVector(s.n, d * 0.8).setY(7);
      o.lookAt(o.position.clone().add(s.n));
      o.updateMatrix();
      heads.setMatrixAt(h++, o.matrix);
    }
  });
  poles.castShadow = heads.castShadow = true;
  const g = new THREE.Group();
  g.add(poles, heads);
  return g;
}

// ---------- collisions ----------

export class Colliders {
  constructor() { this.boxes = []; }
  /** carOnly boxes block cars but let people walk through (e.g. the front door). */
  box(cx, cz, w, d, pad = 0, carOnly = false) {
    this.boxes.push({ minX: cx - w / 2 - pad, maxX: cx + w / 2 + pad, minZ: cz - d / 2 - pad, maxZ: cz + d / 2 + pad, carOnly });
  }
  /** Push a circle out of all boxes. Returns the summed push normal (zero if none). */
  resolve(pos, r, isCar = false) {
    const n = new THREE.Vector2();
    for (const b of this.boxes) {
      if (b.carOnly && !isCar) continue;
      if (pos.x < b.minX - r || pos.x > b.maxX + r || pos.z < b.minZ - r || pos.z > b.maxZ + r) continue;
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      let d = Math.hypot(dx, dz);
      if (d === 0) {
        // centre inside the box: push out along the shallowest axis
        const opts = [[pos.x - b.minX, -1, 0], [b.maxX - pos.x, 1, 0], [pos.z - b.minZ, 0, -1], [b.maxZ - pos.z, 0, 1]];
        opts.sort((a, c) => a[0] - c[0]);
        const [depth, ox, oz] = opts[0];
        pos.x += ox * (depth + r); pos.z += oz * (depth + r);
        n.x += ox; n.y += oz;
        continue;
      }
      if (d < r) {
        dx /= d; dz /= d;
        pos.x += dx * (r - d); pos.z += dz * (r - d);
        n.x += dx; n.y += dz;
      }
    }
    return n;
  }
}
