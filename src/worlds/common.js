import * as THREE from 'three';
import { curbTexture, facadeMaterial } from '../materials.js';
import { pbr, instanced } from '../assets.js';

// ---------- sky, sun, environment ----------

/** Find the sun in an equirect HDR: brightest pixel -> world direction (before rotation). */
function findSun(tex) {
  const { data, width, height } = tex.image;
  const half = data instanceof Uint16Array;
  const val = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  const horizon = [0, 0, 0];
  let hn = 0;
  for (let y = 0; y < height / 2; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = val(i) * 0.2126 + val(i + 1) * 0.7152 + val(i + 2) * 0.0722;
      if (l > best) { best = l; bx = x; by = y; }
      if (y > height / 2 - 40 && y < height / 2 - 4 && x % 16 === 0) {
        horizon[0] += val(i); horizon[1] += val(i + 1); horizon[2] += val(i + 2); hn++;
      }
    }
  }
  // flipY: data row 0 is the top of the image (v = 1)
  const u = (bx + 0.5) / width, v = 1 - (by + 0.5) / height;
  const lat = (v - 0.5) * Math.PI, lon = (u - 0.5) * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));
  return { dir, horizon: new THREE.Color(horizon[0] / hn, horizon[1] / hn, horizon[2] / hn) };
}

/**
 * Photographed HDR sky as background + image-based lighting, with a directional sun
 * aimed at the sun in the image so shadows match. rotation (deg) spins the sky.
 */
export function setupSky(scene, renderer, { hdri, rotation = 0, sunAzimuth = null, exposure = 1, envIntensity = 1, sunColor = 0xfff1dc, sunIntensity = 3.2, fogDensity = 0.0009, fogTint = 1 }) {
  const found = findSun(hdri);
  // sunAzimuth (deg, 0 = +z, 90 = +x) spins the whole sky so its real sun lands where we want it
  let rot = THREE.MathUtils.degToRad(rotation);
  if (sunAzimuth != null) rot = THREE.MathUtils.degToRad(sunAzimuth) - Math.atan2(found.dir.x, found.dir.z);
  scene.background = hdri;
  scene.environment = hdri;
  scene.backgroundRotation.set(0, rot, 0);
  scene.environmentRotation.set(0, rot, 0);
  scene.backgroundIntensity = exposure;
  scene.environmentIntensity = envIntensity;

  const { dir, horizon } = found;
  const sunDir = dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).normalize();
  if (sunDir.y < 0.12) sunDir.y = 0.12; // keep shadows a sensible length
  sunDir.normalize();

  // fog matches the sky at the horizon so distant hills melt into it
  const fogColor = horizon.clone().multiplyScalar(exposure * fogTint);
  const max = Math.max(fogColor.r, fogColor.g, fogColor.b);
  if (max > 1) fogColor.multiplyScalar(1 / max);
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);

  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 600;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  return {
    sun, sunDir,
    follow(target) {
      sun.position.copy(target).addScaledVector(sunDir, 250);
      sun.target.position.copy(target);
    },
  };
}

// ---------- roads ----------

/**
 * Builds a road ribbon along a curve: PBR asphalt, painted lines as separate strips, optional curbs.
 * Returns the mesh plus sampled centre points (minimap, keeping buildings off the road).
 */
export function buildRoad(curve, { width = 14, lanes = 2, closed = false, y = 0.03, curbs = true, step = 2, lines = true } = {}) {
  const length = curve.getLength();
  const n = Math.max(8, Math.floor(length / step));
  const pts = curve.getSpacedPoints(n);
  if (closed) pts.pop();
  const count = closed ? pts.length + 1 : pts.length;

  // frame (point, normal, distance) along the road
  const frames = [];
  let dist = 0;
  for (let i = 0; i < count; i++) {
    const p = pts[i % pts.length];
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const a = !closed && i === 0 ? p : prev;
    const b = !closed && i === count - 1 ? p : next;
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    if (i > 0) dist += p.distanceTo(pts[(i - 1) % pts.length]);
    frames.push({ p, n: new THREE.Vector3(-t.z, 0, t.x), d: dist });
  }

  /** ribbon between two lateral offsets; keep(d) can drop segments (for dashes) */
  function ribbon(o0, o1, yy, uvScale, keep = () => true) {
    if (o0 < o1) [o0, o1] = [o1, o0]; // keep winding facing up
    const pos = [], uv = [], idx = [];
    let v = 0;
    for (let i = 0; i < frames.length; i++) {
      const { p, n, d } = frames[i];
      const A = p.clone().addScaledVector(n, o0), B = p.clone().addScaledVector(n, o1);
      pos.push(A.x, yy, A.z, B.x, yy, B.z);
      uv.push(0, d * uvScale, Math.abs(o1 - o0) * uvScale, d * uvScale);
      if (i < frames.length - 1 && keep((d + frames[i + 1].d) / 2)) {
        const k = v * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
      v++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const group = new THREE.Group();
  const road = new THREE.Mesh(ribbon(width / 2, -width / 2, y, 1 / 5), roadMaterial());
  road.receiveShadow = true;
  group.add(road);

  if (lines) {
    const parts = [];
    const edge = width / 2 - 0.45;
    parts.push(ribbon(edge, edge - 0.15, y + 0.01, 1), ribbon(-edge, -edge + 0.15, y + 0.01, 1));
    const dash = (d) => d % 9 < 3.5;
    for (let i = 1; i < lanes; i++) {
      const o = -width / 2 + 0.6 + ((width - 1.2) * i) / lanes;
      if (lanes > 2 && i === lanes / 2) continue;
      parts.push(ribbon(o - 0.07, o + 0.07, y + 0.01, 1, dash));
    }
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const g of parts) { const m = new THREE.Mesh(g, white); m.receiveShadow = true; group.add(m); }
    if (lanes > 2) {
      const yellow = new THREE.MeshStandardMaterial({ color: 0xd9a933, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      for (const o of [-0.2, 0.2]) { const m = new THREE.Mesh(ribbon(o - 0.07, o + 0.07, y + 0.01, 1), yellow); m.receiveShadow = true; group.add(m); }
    }
  }

  if (curbs) {
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    curbMat.map.repeat.set(1, 1);
    for (const s of [1, -1]) {
      const g = ribbon(s * width / 2, s * (width / 2 + 1.0), y + 0.04, 1 / 3);
      const c = new THREE.Mesh(g, curbMat);
      c.receiveShadow = true;
      group.add(c);
    }
  }
  return { mesh: group, points: pts, width, closed };
}

let _roadMat = null;
function roadMaterial() {
  if (!_roadMat) {
    _roadMat = pbr('clean_asphalt', { repeat: [1, 1], color: 0x55575a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    _roadMat.normalScale.set(0.6, 0.6);
    _roadMat.roughnessMap = null; // matte asphalt: don't mirror the bright sky
    _roadMat.roughness = 0.88;
    _roadMat.envMapIntensity = 0.55;
  }
  return _roadMat;
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
export function buildingBlocks(blocks, { brighten = 1, ...matOpts } = {}) {
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
    mesh.setColorAt(i, c.set(b.color).multiplyScalar(brighten));
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

// ---------- street-level building detail ----------

function instancedBoxes(items, material, { cast = true } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, material, items.length);
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    o.scale.set(it.w, it.h, it.d);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    if (it.color != null) im.setColorAt(i, c.set(it.color));
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/**
 * Cornices, floor ledges, glass shopfronts and awnings for box buildings.
 * Shopfronts/awnings only on street-level blocks (y = 0); the awning goes on the side facing the nearest road.
 */
export function buildingDetails(blocks, roads, { floor = 3.2, awningColors = [0x7a1f2b, 0x1f3a5f, 0x2f5d3a, 0xe9e1cf, 0x2b2b2b] } = {}) {
  const ledges = [], cornices = [], shops = [], awnings = [], stripes = [];
  for (const b of blocks) {
    const base = b.y || 0;
    cornices.push({ x: b.x, y: base + b.h - 0.1, z: b.z, w: b.w + 0.7, h: 0.55, d: b.d + 0.7 });
    for (let fy = floor * 2; fy < b.h - 1.5; fy += floor * (b.h > 40 ? 2 : 1)) {
      ledges.push({ x: b.x, y: base + fy - 0.12, z: b.z, w: b.w + 0.35, h: 0.16, d: b.d + 0.35 });
    }
    if (base > 0 || !roads) continue;
    shops.push({ x: b.x, y: 0, z: b.z, w: b.w + 0.14, h: 3.0, d: b.d + 0.14 });
    ledges.push({ x: b.x, y: 3.0, z: b.z, w: b.w + 0.5, h: 0.35, d: b.d + 0.5 }); // shop fascia
    // which side faces the street?
    let best = null, bd = Infinity;
    for (const r of roads) for (const p of r.points) {
      const d = (p.x - b.x) ** 2 + (p.z - b.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    const dx = best.x - b.x, dz = best.z - b.z;
    const alongX = Math.abs(dx) > Math.abs(dz);
    const s = alongX ? Math.sign(dx) : Math.sign(dz);
    const faceLen = alongX ? b.d : b.w;
    const n = Math.max(1, Math.floor(faceLen / 4.2));
    const color = awningColors[Math.floor(Math.abs(b.x * 7 + b.z * 13)) % awningColors.length];
    for (let k = 0; k < n; k++) {
      const off = -faceLen / 2 + (k + 0.5) * (faceLen / n);
      const w = (faceLen / n) * 0.82;
      // sloped down toward the street, hung just under the shop fascia
      const item = alongX
        ? { x: b.x + s * (b.w / 2 + 0.85), y: 2.55, z: b.z + off, w: 1.9, h: 0.06, d: w, rz: -0.38 * s, color }
        : { x: b.x + off, y: 2.55, z: b.z + s * (b.d / 2 + 0.85), w, h: 0.06, d: 1.9, rx: 0.38 * s, color };
      awnings.push(item);
      const valance = alongX
        ? { x: b.x + s * (b.w / 2 + 1.72), y: 1.98, z: b.z + off, w: 0.04, h: 0.32, d: w, color }
        : { x: b.x + off, y: 1.98, z: b.z + s * (b.d / 2 + 1.72), w, h: 0.32, d: 0.04, color };
      stripes.push(valance);
    }
  }
  const stone = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a232b, roughness: 0.05, metalness: 0.5, clearcoat: 1, emissive: 0x6b4a26, emissiveIntensity: 0.35 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.add(instancedBoxes(cornices, stone), instancedBoxes(ledges, stone), instancedBoxes(shops, glass, { cast: false }), instancedBoxes(awnings, canvas), instancedBoxes(stripes, canvas, { cast: false }));
  return g;
}
