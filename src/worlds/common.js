import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { curbTexture, facadeMaterial, label } from '../materials.js';
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
 * A soft grey overcast sky as an equirect canvas texture: a gentle zenith->horizon gradient
 * (CIE overcast is brighter overhead) with faint low-frequency mottling so it isn't a dead flat
 * grey. Used as BOTH background and environment, so reflections pick up the same grey, not a sun.
 */
function overcastSky(zenith, horizon) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const g = ctx.createLinearGradient(0, 0, 0, h);   // y=0 is the zenith (top), y=h/2 the horizon
  g.addColorStop(0, hex(zenith));
  g.addColorStop(0.5, hex(horizon));
  g.addColorStop(1, hex(horizon));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // faint broad cloud mottling in the upper half, so the grey breathes a little
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w, y = Math.random() * h * 0.5, r = 60 + Math.random() * 200;
    const a = (Math.random() - 0.5) * 0.06;
    ctx.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(120,124,130,${-a})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sky + image-based lighting + a directional sun.
 * Default: a photographed HDR sky with the sun aimed at the brightest pixel so shadows match.
 * overcast:true instead paints a soft grey British sky (no HDR, no findSun) with a weak, diffuse
 * sun placed from sunAzimuth/sunElevation - the overcast UK look the game ships with.
 */
export function setupSky(scene, renderer, {
  hdri, rotation = 0, sunAzimuth = null, exposure = 1, envIntensity = 1,
  sunColor = 0xfff1dc, sunIntensity = 3.2, fogDensity = 0.0009, fogTint = 1,
  overcast = false, sunElevation = 46, skyZenith = 0xccd1d6, skyHorizon = 0xbec1c4,
  sunElevationDeg = null, shadowFar = 600,
}) {
  let sunDir, horizon;
  if (overcast) {
    const sky = overcastSky(skyZenith, skyHorizon);
    scene.background = sky;
    scene.environment = sky;               // grey IBL -> glass/paint reflect the grey sky, not a sun
    scene.backgroundRotation.set(0, 0, 0);
    scene.environmentRotation.set(0, 0, 0);
    scene.backgroundIntensity = exposure;
    scene.environmentIntensity = envIntensity;
    const az = THREE.MathUtils.degToRad(sunAzimuth ?? 0), el = THREE.MathUtils.degToRad(sunElevation);
    sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    horizon = new THREE.Color(skyHorizon);
  } else {
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
    sunDir = found.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).normalize();
    if (sunElevationDeg != null) {
      // golden-hour override: keep the HDRI's real azimuth (so the background's own glow still
      // lines up) but force a low elevation for long shadows - the photo's sun is far lower than
      // any "partly cloudy" HDR actually carries.
      const horizLen = Math.hypot(sunDir.x, sunDir.z) || 1;
      const el = THREE.MathUtils.degToRad(sunElevationDeg);
      sunDir.set((sunDir.x / horizLen) * Math.cos(el), Math.sin(el), (sunDir.z / horizLen) * Math.cos(el));
    }
    if (sunDir.y < 0.12) sunDir.y = 0.12; // keep shadows a sensible length
    sunDir.normalize();
    horizon = found.horizon.clone().multiplyScalar(exposure * fogTint);
    const max = Math.max(horizon.r, horizon.g, horizon.b);
    if (max > 1) horizon.multiplyScalar(1 / max);
  }

  // fog matches the sky at the horizon so distant tiles melt into it (no seam)
  scene.fog = new THREE.FogExp2(horizon.clone(), fogDensity);

  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = shadowFar;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = overcast ? 4 : 1; // softer contact shadows under a diffuse sky
  scene.add(sun, sun.target);

  return {
    sun, sunDir,
    follow(target) {
      sun.position.copy(target).addScaledVector(sunDir, 250);
      sun.target.position.copy(target);
    },
  };
}

/**
 * The daylight UK sky the game drives under: the partly-cloudy HDR (shared with the cabin, so it
 * costs no extra download) with a warm sun and thin haze. Callers spread it and add sunAzimuth.
 * A learner wants to see the road, the signs and the shadows, and a grey lid over everything made
 * every street read the same; UK_OVERCAST below is kept for the dull-day look.
 */
export const UK_DAY = {
  exposure: 1.0,
  envIntensity: 0.9,
  sunColor: 0xfff2dc,
  sunIntensity: 3.0,
  fogDensity: 0.0009,
};

/**
 * Low, warm, long-shadow light - the look of a real high street photographed in late-afternoon
 * sun: a low amber sun (sunElevationDeg overrides the HDRI's own, much higher, sun), stronger
 * contrast between lit and shadowed walls, and thin golden haze instead of the flat grey of
 * UK_OVERCAST. Callers spread it and add their own sunAzimuth to choose which street face lights up.
 */
export const UK_GOLDEN = {
  exposure: 1.0,
  envIntensity: 0.85,
  sunColor: 0xffb26b,
  sunIntensity: 3.6,
  fogDensity: 0.0011,
  fogTint: 1.15,
  sunElevationDeg: 19,
  shadowFar: 750,
};

/** The overcast-UK sky preset. Callers spread it and add their own sunAzimuth. */
export const UK_OVERCAST = {
  overcast: true,
  exposure: 1.0,
  envIntensity: 1.15,
  sunColor: 0xe3e6ea,
  sunIntensity: 1.9,
  fogDensity: 0.0016,
  sunElevation: 46,
  skyZenith: 0xccd1d6,
  skyHorizon: 0xbec1c4,
};

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
      pos.push(A.x, A.y + yy, A.z, B.x, B.y + yy, B.z); // follow the curve's height, so roads can climb hills
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
  constructor() { this.boxes = []; this.cell = 100; this.grid = new Map(); this.big = []; this._n = 0; }
  /** carOnly boxes block cars but let people walk through (e.g. the front door). */
  box(cx, cz, w, d, pad = 0, carOnly = false) {
    return this._insert({ minX: cx - w / 2 - pad, maxX: cx + w / 2 + pad, minZ: cz - d / 2 - pad, maxZ: cz + d / 2 + pad, carOnly });
  }
  /**
   * Oriented box: centre (cx, cz), w across, d along the yaw direction (sin yaw, cos yaw), i.e. the
   * same convention as a BoxGeometry(w, h, d) rotated by yaw. Returns the box (pass it to remove()).
   */
  obb(cx, cz, w, d, yaw = 0, carOnly = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
    const ex = Math.abs(hw * c) + Math.abs(hd * s), ez = Math.abs(hw * s) + Math.abs(hd * c);
    return this._insert({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, carOnly, obb: true, cx, cz, hw, hd, c, s });
  }
  /** index by 100 m cells so resolve() only looks at the boxes around the probe (streamed worlds add thousands) */
  _insert(b) {
    b.id = this._n++;
    this.boxes.push(b);
    const x0 = Math.floor(b.minX / this.cell), x1 = Math.floor(b.maxX / this.cell), z0 = Math.floor(b.minZ / this.cell), z1 = Math.floor(b.maxZ / this.cell);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) { b.cells = null; this.big.push(b); return b; }
    b.cells = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = `${x},${z}`;
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(b);
      b.cells.push(k);
    }
    return b;
  }
  /** Drop a box added by box() or obb() (tiles that stream out). */
  remove(b) {
    if (!b || b.dead) return;
    b.dead = true;
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
    if (!b.cells) { const j = this.big.indexOf(b); if (j >= 0) this.big.splice(j, 1); return; }
    for (const k of b.cells) {
      const list = this.grid.get(k);
      if (!list) continue;
      const j = list.indexOf(b);
      if (j >= 0) list.splice(j, 1);
      if (!list.length) this.grid.delete(k);
    }
  }
  /** boxes whose cells the probe touches, in insertion order (same result as scanning everything) */
  _candidates(pos, r) {
    const x0 = Math.floor((pos.x - r) / this.cell), x1 = Math.floor((pos.x + r) / this.cell), z0 = Math.floor((pos.z - r) / this.cell), z1 = Math.floor((pos.z + r) / this.cell);
    if (x0 === x1 && z0 === z1 && !this.big.length) return this.grid.get(`${x0},${z0}`) || [];
    const seen = new Set(), out = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const list = this.grid.get(`${x},${z}`);
      if (list) for (const b of list) if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    }
    for (const b of this.big) out.push(b);
    return out.sort((a, b) => a.id - b.id);
  }
  /** Push a circle out of all boxes. Returns the summed push normal (zero if none). */
  resolve(pos, r, isCar = false) {
    const n = new THREE.Vector2();
    for (const b of this._candidates(pos, r)) {
      if (b.carOnly && !isCar) continue;
      if (pos.x < b.minX - r || pos.x > b.maxX + r || pos.z < b.minZ - r || pos.z > b.maxZ + r) continue;
      if (b.obb) {
        // work in the box's own frame: across = (c, -s), along = (s, c)
        const dx0 = pos.x - b.cx, dz0 = pos.z - b.cz;
        const lx = dx0 * b.c - dz0 * b.s, lz = dx0 * b.s + dz0 * b.c;
        if (Math.abs(lx) > b.hw + r || Math.abs(lz) > b.hd + r) continue;
        const qx = Math.max(-b.hw, Math.min(lx, b.hw)), qz = Math.max(-b.hd, Math.min(lz, b.hd));
        let px = lx - qx, pz = lz - qz;
        let d = Math.hypot(px, pz);
        if (d === 0) {
          const opts = [[lx + b.hw, -1, 0], [b.hw - lx, 1, 0], [lz + b.hd, 0, -1], [b.hd - lz, 0, 1]];
          opts.sort((a, c) => a[0] - c[0]);
          const [depth, ox, oz] = opts[0];
          px = ox; pz = oz; d = -depth; // push by depth + r along (ox, oz)
        } else { px /= d; pz /= d; }
        if (d < r) {
          const push = r - d;
          const wx = px * b.c + pz * b.s, wz = -px * b.s + pz * b.c;
          pos.x += wx * push; pos.z += wz * push;
          n.x += wx; n.y += wz;
        }
        continue;
      }
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

// ---------- jet parks ----------

/** Lay jets out in a row along +z, noses pointing -x (toward a runway on the west side). */
export function jetRow(ids, JETS, x0, z0, gap = 7) {
  let cursor = z0;
  return ids.map((id) => {
    const j = JETS[id];
    const item = { id, x: x0 + j.L / 2, z: cursor + j.span / 2, rot: -Math.PI / 2 };
    cursor += j.span + gap;
    return item;
  });
}

/** Park jets with nameplates; fuselage-only colliders so you can walk under the wings. */
export function parkJets(scene, colliders, items, JETS, buildJet, { labels = true } = {}) {
  for (const it of items) {
    const spec = JETS[it.id];
    const jet = buildJet(spec);
    jet.position.set(it.x, 0, it.z);
    jet.rotation.y = it.rot;
    scene.add(jet);
    const along = Math.abs(Math.sin(it.rot)) > 0.5; // fuselage along x
    colliders.box(it.x, it.z, along ? spec.L : spec.R * 2 + 0.6, along ? spec.R * 2 + 0.6 : spec.L);
    if (labels) {
      const tag = label(`${spec.maker} ${spec.model}`, { size: 0.9, sub: spec.note || spec.range });
      tag.position.set(it.x, spec.R * 2 + spec.L * 0.2 + 4, it.z);
      scene.add(tag);
    }
  }
}

/** Instanced broadleaf trees (two meshes for any number of trees). spots: [{x, z, s?, r?}] */
export function broadleafTrees(spots, { leaf = [0.27, 0.38, 0.26], trunk = 0x5a4632 } = {}) {
  const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 7);
  trunkG.translate(0, 1.6, 0);
  const blobs = [[0, 5.2, 0, 2.6], [1.3, 4.4, 0.5, 1.9], [-1.2, 4.6, -0.4, 2.0], [0.2, 6.4, -0.6, 1.7]].map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  const crownG = mergeGeometries(blobs);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: trunk, roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(up, p.r ?? Math.random() * 6.28);
    sc.set(p.sx ?? p.s ?? 1, p.s ?? 1, p.sx ?? p.s ?? 1);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, sc);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, c.setHSL(leaf[0] + (Math.random() - 0.5) * 0.06, leaf[1], leaf[2] + (Math.random() - 0.5) * 0.1));
  });
  const g = new THREE.Group();
  for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im); }
  return g;
}

// ---------- architecture: break up the boxes ----------
const rnd = (a, b) => a + Math.random() * (b - a);

function railingTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  ctx.fillStyle = '#1e2420';
  ctx.fillRect(0, 0, 128, 7);       // top rail
  ctx.fillRect(0, 54, 128, 6);      // bottom rail
  for (let x = 2; x < 128; x += 10) ctx.fillRect(x, 0, 3, 64); // balusters
  ctx.beginPath(); ctx.lineWidth = 3; ctx.strokeStyle = '#1e2420';
  for (let x = 0; x < 128; x += 20) { ctx.moveTo(x, 54); ctx.quadraticCurveTo(x + 10, 30, x + 20, 54); }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** which horizontal axis + sign a block's street face points along */
function streetFace(b, roads, fallback = { axis: 'z', s: 1 }) {
  if (!roads || (b.y || 0) > 0) return fallback;
  let best = null, bd = Infinity;
  for (const r of roads) for (const p of r.points) {
    const d = (p.x - b.x) ** 2 + (p.z - b.z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  const dx = best.x - b.x, dz = best.z - b.z;
  return Math.abs(dx) > Math.abs(dz) ? { axis: 'x', s: Math.sign(dx) } : { axis: 'z', s: Math.sign(dz) };
}

/**
 * Riviera detailing for low/mid-rise blocks: balconies with iron railings on the street face,
 * stone quoins, a mix of slate mansard roofs with dormers, roof terraces with parasols, and a few
 * corner turrets with domes. Returns { group, hipped } (hipped = blocks that want terracotta roofs).
 * win = the facade material's window grid [w, h] so balconies line up with the painted windows.
 */
export function rivieraDetails(blocks, roads, { win = [2.8, 3.2], seaward = { axis: 'z', s: 1 } } = {}) {
  const slabs = [], quoins = [], parapets = [], planters = [], dormers = [], dormerWin = [];
  const railG = [], mansardG = [], turretG = [], domeG = [], poleG = [], shadeG = [];
  const hipped = [];
  const turretColors = [];
  for (const b of blocks) {
    if (b.h >= 60) continue; // towers keep their own look
    const base = b.y || 0, top = base + b.h;
    // ---- quoins: pale stone strips at the four corners ----
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) quoins.push({ x: b.x + sx * b.w / 2, y: base, z: b.z + sz * b.d / 2, w: 0.55, h: b.h, d: 0.55 });
    // ---- balconies on the street (or sea) face, lined up with the window grid ----
    const f = streetFace(b, roads, seaward);
    const along = f.axis === 'z' ? 'x' : 'z';
    const faceC = f.axis === 'z' ? b.z + f.s * b.d / 2 : b.x + f.s * b.w / 2;
    const span = along === 'x' ? b.w : b.d, centre = along === 'x' ? b.x : b.z;
    const style = b.attic ? 'none' : Math.random() < 0.45 ? 'french' : Math.random() < 0.6 ? 'continuous' : 'none';
    if (style !== 'none') {
      const n0 = Math.ceil((Math.max(base, 2.4) / win[1]) - 0.28 + 1e-3), n1 = Math.floor((top - 0.6) / win[1] - 0.86);
      for (let n = Math.max(n0, 1); n <= n1; n++) {
        if (style === 'continuous' && n % 2) continue;
        const y = (n + 0.28) * win[1];
        const depth = style === 'french' ? 0.55 : 1.2;
        const segs = [];
        if (style === 'french') {
          for (let k = Math.ceil((centre - span / 2 + 1) / win[0] - 0.5); (k + 0.5) * win[0] < centre + span / 2 - 1; k++) segs.push([(k + 0.5) * win[0], win[0] * 0.55]);
        } else segs.push([centre, span - 1.2]);
        for (const [c, w] of segs) {
          const out = faceC + f.s * depth / 2;
          slabs.push(f.axis === 'z' ? { x: c, y: y - 0.2, z: out, w, h: 0.2, d: depth } : { x: out, y: y - 0.2, z: c, w: depth, h: 0.2, d: w });
          const rail = new THREE.PlaneGeometry(w, 1.0);
          const uv = rail.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / 1.3);
          if (f.axis === 'x') rail.rotateY(Math.PI / 2);
          const edge = faceC + f.s * depth;
          rail.translate(f.axis === 'z' ? c : edge, y + 0.5, f.axis === 'z' ? edge : c);
          railG.push(rail);
        }
      }
    }
    // ---- roofline ----
    const roll = Math.random();
    if (b.hasAttic) continue; // its setback storey carries the roof
    if (b.attic || b.h < 9) { hipped.push(b); continue; }
    if (roll < 0.3) hipped.push(b);
    else if (roll < 0.58) {
      // slate mansard with dormers
      const g = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.7, Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(b.w + 0.4, 3.4, b.d + 0.4);
      g.translate(b.x, top + 1.7, b.z);
      mansardG.push(g);
      for (const [axis, s] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
        const len = axis === 'z' ? b.w : b.d;
        const nD = Math.max(1, Math.floor(len / 4.2));
        for (let k = 0; k < nD; k++) {
          const o = -len / 2 + (k + 0.5) * (len / nD);
          const inset = (axis === 'z' ? b.d : b.w) / 2 - 0.55;
          const p = axis === 'z' ? { x: b.x + o, z: b.z + s * inset } : { x: b.x + s * inset, z: b.z + o };
          dormers.push({ x: p.x, y: top + 0.35, z: p.z, w: axis === 'z' ? 1.3 : 1.1, h: 1.7, d: axis === 'z' ? 1.1 : 1.3 });
          const wp = axis === 'z' ? { x: p.x, z: p.z + s * 0.56 } : { x: p.x + s * 0.56, z: p.z };
          dormerWin.push({ x: wp.x, y: top + 0.6, z: wp.z, w: axis === 'z' ? 0.7 : 0.05, h: 1.0, d: axis === 'z' ? 0.05 : 0.7 });
        }
      }
    } else {
      // flat roof terrace: parapet, planters, a parasol or two
      const t = 0.25, ph = 0.9;
      parapets.push({ x: b.x, y: top, z: b.z + b.d / 2 - t / 2, w: b.w, h: ph, d: t }, { x: b.x, y: top, z: b.z - b.d / 2 + t / 2, w: b.w, h: ph, d: t },
        { x: b.x + b.w / 2 - t / 2, y: top, z: b.z, w: t, h: ph, d: b.d }, { x: b.x - b.w / 2 + t / 2, y: top, z: b.z, w: t, h: ph, d: b.d });
      for (let k = 0; k < 3; k++) planters.push({ x: b.x + rnd(-b.w / 2 + 1.5, b.w / 2 - 1.5), y: top, z: b.z + rnd(-b.d / 2 + 1.5, b.d / 2 - 1.5), w: 1.2, h: 1.1, d: 1.2 });
      if (b.w > 10) {
        for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) {
          const px = b.x + rnd(-b.w / 4, b.w / 4), pz = b.z + rnd(-b.d / 4, b.d / 4);
          poleG.push(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5).translate(px, top + 1.2, pz));
          shadeG.push(new THREE.ConeGeometry(1.6, 0.6, 8, 1, true).translate(px, top + 2.5, pz));
        }
      }
    }
    // ---- a corner turret now and then on street-front buildings ----
    if (!base && b.h > 14 && b.h < 40 && Math.random() < 0.14) {
      const cx = b.x + (Math.random() < 0.5 ? -1 : 1) * b.w / 2, cz = b.z + (Math.random() < 0.5 ? -1 : 1) * b.d / 2;
      const th = b.h + 3;
      turretG.push(new THREE.CylinderGeometry(2.5, 2.5, th, 20).translate(cx, th / 2, cz));
      turretColors.push(b.color);
      domeG.push(new THREE.SphereGeometry(2.7, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1).translate(cx, th, cz));
      domeG.push(new THREE.ConeGeometry(0.25, 2.2, 6).translate(cx, th + 4.2, cz));
    }
  }
  const stone = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.8 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.75, metalness: 0.15, flatShading: true });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.2, metalness: 0.5 });
  const green = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 });
  const rail = new THREE.MeshStandardMaterial({ map: railingTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0xffffff });
  const copper = new THREE.MeshStandardMaterial({ color: 0x5f9c86, roughness: 0.5, metalness: 0.4 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.9, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const merged = (list, mat, cast = true) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); };
  if (slabs.length) g.add(instancedBoxes(slabs, stone));
  g.add(instancedBoxes(quoins, stone));
  if (parapets.length) g.add(instancedBoxes(parapets, stone));
  if (planters.length) g.add(instancedBoxes(planters, green));
  if (dormers.length) { g.add(instancedBoxes(dormers, white)); g.add(instancedBoxes(dormerWin, dark, { cast: false })); }
  merged(railG, rail, false);
  merged(mansardG, slate);
  merged(domeG, copper);
  merged(poleG, white, false);
  merged(shadeG, canvasMat);
  if (turretG.length) {
    const tm = facadeMaterial({ winSize: [1.6, 3.2], winColor: 0x1a2530, amount: 0.8, roughness: 0.85 });
    tm.vertexColors = true;
    turretG.forEach((geo, i) => {
      const c = new THREE.Color(turretColors[i]).multiplyScalar(1.25);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let k = 0; k < col.length; k += 3) col.set([c.r, c.g, c.b], k);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    });
    merged(turretG, tm);
  }
  return { group: g, hipped };
}

/** A tower whose square floor plates rotate as it rises (Cayan Tower style). */
function twistedTower(w, h, turn, floors = 24) {
  const pos = [], idx = [];
  for (let i = 0; i <= floors; i++) {
    const y = (i / floors) * h, a = (i / floors) * turn;
    for (let k = 0; k < 4; k++) {
      const ang = a + Math.PI / 4 + (k * Math.PI) / 2;
      pos.push(Math.cos(ang) * w * Math.SQRT1_2, y, Math.sin(ang) * w * Math.SQRT1_2);
    }
  }
  for (let i = 0; i < floors; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = a + 4, d = b + 4;
    idx.push(a, c, b, b, c, d);
  }
  const top = floors * 4;
  idx.push(top, top + 2, top + 1, top, top + 3, top + 2);
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo = geo.toNonIndexed(); // flat facets so the window grid reads per face
  geo.computeVertexNormals();
  return geo;
}

/**
 * Modern towers for a skyline: each spec { x, z, w, d, h, color } becomes one of: stepped setbacks,
 * a round tower with a crown, a twisting tower, or a tapered tower with a spire; front-row towers sit
 * on a podium. Returns a group (setbacks are instanced boxes, the rest merged with vertex colours).
 */
export function modernTowers(specs, matOpts) {
  const boxes = [], shapes = [], colors = [], metal = [];
  for (const t of specs) {
    const kind = t.kind || (t.h < 110 ? 'setback' : ['setback', 'round', 'twist', 'taper', 'setback'][Math.floor(Math.random() * 5)]);
    if (t.podium) boxes.push({ x: t.x, z: t.z, w: t.w * 1.3, d: t.d * 1.3, h: rnd(10, 16), color: t.color });
    if (kind === 'setback') {
      const tiers = t.h > 160 ? 3 : 2;
      let y = 0, w = t.w, d = t.d;
      for (let i = 0; i < tiers; i++) {
        const h = i === tiers - 1 ? t.h - y : t.h * (i === 0 ? 0.55 : 0.28);
        boxes.push({ x: t.x, z: t.z, y, w, d, h, color: t.color });
        y += h; w *= 0.78; d *= 0.78;
      }
      if (Math.random() < 0.5) metal.push(new THREE.CylinderGeometry(0.4, 0.9, t.h * 0.12, 6).translate(t.x, t.h + t.h * 0.06, t.z));
    } else if (kind === 'round') {
      const r = Math.min(t.w, t.d) / 2;
      shapes.push(new THREE.CylinderGeometry(r * 0.9, r, t.h, 28).translate(t.x, t.h / 2, t.z)); colors.push(t.color);
      shapes.push(new THREE.CylinderGeometry(r * 0.55, r * 0.9, t.h * 0.07, 28).translate(t.x, t.h * 1.035, t.z)); colors.push(t.color);
      metal.push(new THREE.CylinderGeometry(0.3, 0.6, t.h * 0.15, 6).translate(t.x, t.h * 1.07 + t.h * 0.075, t.z));
    } else if (kind === 'twist') {
      shapes.push(twistedTower(Math.min(t.w, t.d), t.h, rnd(0.9, 1.6) * (Math.random() < 0.5 ? 1 : -1)).translate(t.x, 0, t.z)); colors.push(t.color);
    } else {
      const g = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.62, Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(t.w, t.h, t.d);
      shapes.push(g.translate(t.x, t.h / 2, t.z)); colors.push(t.color);
      metal.push(new THREE.ConeGeometry(Math.min(t.w, t.d) * 0.2, t.h * 0.22, 8).translate(t.x, t.h * 1.11, t.z));
    }
  }
  const group = new THREE.Group();
  group.add(buildingBlocks(boxes, matOpts));
  if (shapes.length) {
    const mat = facadeMaterial(matOpts);
    mat.vertexColors = true;
    shapes.forEach((geo, i) => {
      const g2 = geo.index ? geo.toNonIndexed() : geo;
      shapes[i] = g2;
      g2.deleteAttribute('uv');
      const c = new THREE.Color(colors[i]);
      const col = new Float32Array(g2.attributes.position.count * 3);
      for (let k = 0; k < col.length; k += 3) col.set([c.r, c.g, c.b], k);
      g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (g2.attributes.normal == null) g2.computeVertexNormals();
    });
    const m = new THREE.Mesh(mergeGeometries(shapes), mat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  if (metal.length) {
    const m = new THREE.Mesh(mergeGeometries(metal.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; })), new THREE.MeshStandardMaterial({ color: 0xdfe4e8, metalness: 0.9, roughness: 0.2 }));
    m.castShadow = true;
    group.add(m);
  }
  return group;
}
