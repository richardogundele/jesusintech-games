import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M } from './materials.js';
import { gltf as loadGltf, misc, pbr } from './assets.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildCasualBody, DEFAULT_LOOK } from './character.js';

// ---------- helpers ----------

/** Side-profile shape (x = along car, y = height) extruded across the width, centred, forward = +Z. */
function sideExtrude(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // x -> +z (forward)
  return g;
}

/** Plan-view shape (x, zForward) extruded upward by height. */
function planExtrude(points, height, bevel = 0) {
  const shape = new THREE.Shape();
  points.forEach(([x, zf], i) => (i ? shape.lineTo(x, -zf) : shape.moveTo(x, -zf)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

function mesh(geo, mat, { cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

let blobTex = null;
export function blobShadow(w, l, opacity = 0.55) {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

// ---------- cars ----------

// Each car body is ONE smooth surface lofted through cross-sections along its length.
// Station: [zFrac (-0.5 rear .. 0.5 front), halfWidthFrac, bottomY, topY, topNarrow, beltY, roofY]
//   - topNarrow pulls the upper half in (tumblehome / greenhouse)
//   - glass = above beltY and below roofY (roofY null = glass all the way up, e.g. windscreen); beltY null = no glass
const LOFTS = {
  revuelto: {
    n: 3.2, nb: 7, wheelR: 0.37, axles: [0.31, -0.29], hl: [0.47, 0.6], tl: 0.86,
    st: [
      [-0.5, 0.84, 0.32, 0.8, 0.95, null, null], [-0.44, 0.98, 0.22, 0.92, 0.9, null, null], [-0.3, 1, 0.2, 0.99, 0.8, null, null],
      [-0.2, 1, 0.2, 1.06, 0.64, 0.86, 1.01], [-0.05, 0.99, 0.2, 1.14, 0.56, 0.85, 1.09], [0.07, 0.98, 0.2, 1.1, 0.58, 0.83, null],
      [0.17, 0.97, 0.2, 0.92, 0.66, 0.8, null], [0.25, 0.95, 0.2, 0.8, 0.86, null, null], [0.37, 0.93, 0.21, 0.67, 0.92, null, null],
      [0.46, 0.86, 0.24, 0.55, 0.95, null, null], [0.5, 0.7, 0.3, 0.44, 0.96, null, null],
    ],
  },
  chiron: {
    n: 2.6, nb: 6, wheelR: 0.37, axles: [0.31, -0.29], hl: [0.46, 0.62], tl: 0.9, twoTone: true,
    st: [
      [-0.5, 0.82, 0.34, 0.84, 0.95, null, null], [-0.43, 0.97, 0.24, 0.96, 0.88, null, null], [-0.28, 1, 0.21, 1.02, 0.76, null, null],
      [-0.18, 1, 0.21, 1.08, 0.62, 0.88, 1.03], [-0.04, 0.99, 0.21, 1.17, 0.55, 0.87, 1.11], [0.08, 0.98, 0.21, 1.12, 0.57, 0.85, null],
      [0.18, 0.96, 0.21, 0.94, 0.66, 0.82, null], [0.26, 0.94, 0.22, 0.82, 0.84, null, null], [0.38, 0.9, 0.23, 0.72, 0.9, null, null],
      [0.46, 0.82, 0.27, 0.62, 0.94, null, null], [0.5, 0.62, 0.34, 0.52, 0.96, null, null],
    ],
  },
  cullinan: {
    n: 4.2, nb: 8, wheelR: 0.46, axles: [0.32, -0.31], hl: [0.5, 0.96], tl: 1.1, grille: 'rolls',
    st: [
      [-0.5, 0.9, 0.46, 1.22, 0.92, null, null], [-0.47, 0.97, 0.38, 1.76, 0.86, 1.2, null], [-0.4, 1, 0.36, 1.84, 0.84, 1.19, 1.79],
      [0.02, 1, 0.36, 1.86, 0.84, 1.18, 1.81], [0.13, 1, 0.36, 1.82, 0.85, 1.17, 1.78], [0.23, 0.99, 0.36, 1.4, 0.88, 1.16, null],
      [0.3, 0.98, 0.36, 1.18, 0.93, null, null], [0.44, 0.97, 0.4, 1.12, 0.95, null, null], [0.5, 0.92, 0.46, 1.06, 0.96, null, null],
    ],
  },
  g63: {
    n: 9, nb: 10, wheelR: 0.44, axles: [0.31, -0.31], hl: [0.5, 1.0], tl: 1.05, grille: 'g', round: true, spare: true,
    st: [
      [-0.5, 0.97, 0.5, 1.84, 0.93, 1.18, 1.8], [-0.47, 1, 0.42, 1.93, 0.9, 1.17, 1.88], [0.16, 1, 0.42, 1.93, 0.9, 1.17, 1.88],
      [0.23, 1, 0.42, 1.87, 0.92, 1.17, null], [0.27, 1, 0.42, 1.2, 0.97, null, null], [0.47, 0.99, 0.45, 1.14, 0.98, null, null],
      [0.5, 0.97, 0.5, 1.08, 0.98, null, null],
    ],
  },
  sedan: {
    n: 3.0, nb: 6, wheelR: 0.36, axles: [0.31, -0.3], hl: [0.47, 0.78], tl: 0.98,
    st: [
      [-0.5, 0.86, 0.42, 0.94, 0.95, null, null], [-0.43, 0.98, 0.32, 1.05, 0.93, null, null], [-0.3, 1, 0.3, 1.08, 0.9, null, null],
      [-0.22, 1, 0.3, 1.38, 0.8, 1.0, null], [-0.1, 1, 0.3, 1.46, 0.76, 0.99, 1.41], [0.08, 1, 0.3, 1.46, 0.76, 0.98, 1.41],
      [0.21, 0.99, 0.3, 1.12, 0.84, 0.97, null], [0.3, 0.98, 0.3, 0.99, 0.92, null, null], [0.45, 0.94, 0.33, 0.91, 0.95, null, null],
      [0.5, 0.86, 0.38, 0.82, 0.96, null, null],
    ],
  },
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smooth body surface; returns geometry with groups 0 = paint, 1 = glass, and per-vertex colours for two-tone. */
function loftBody(def, L, W, { rings = 56, around = 40, accent = null, main = null } = {}) {
  const st = def.st;
  const pos = [], col = [], idx = [], isGlass = [];
  const cMain = new THREE.Color(main ?? 0xffffff), cAcc = new THREE.Color(accent ?? main ?? 0xffffff);
  for (let r = 0; r <= rings; r++) {
    const zf = -0.5 + r / rings;
    let k = 0;
    while (k < st.length - 2 && st[k + 1][0] < zf) k++;
    const a = st[Math.max(0, k - 1)], b = st[k], c = st[k + 1], d = st[Math.min(st.length - 1, k + 2)];
    const t = THREE.MathUtils.clamp((zf - b[0]) / (c[0] - b[0]), 0, 1);
    const P = (i) => catmull(a[i], b[i], c[i], d[i], t);
    const hw = P(1) * W / 2, y0 = P(2), y1 = P(3), tn = THREE.MathUtils.clamp(P(4), 0.3, 1);
    const near = t < 0.5 ? b : c;
    const belt = b[5] != null && c[5] != null ? b[5] + (c[5] - b[5]) * t : null;
    const roof = near[6];
    const mid = (y0 + y1) / 2, half = (y1 - y0) / 2;
    for (let i = 0; i < around; i++) {
      const th = (i / around) * Math.PI * 2;
      const cx = Math.cos(th), sy = Math.sin(th);
      const ex = sy < 0 ? def.nb : def.n;
      const px = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / ex);
      const py = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / ex);
      const narrow = sy > 0 ? 1 + (tn - 1) * Math.pow(sy, 1.3) : 1;
      const x = px * hw * narrow, y = mid + py * half, z = zf * L;
      pos.push(x, y, z);
      isGlass.push(belt != null && y > belt && (roof == null || y < roof) && sy > 0.05);
      const acc = def.twoTone && zf < 0.02 - 0.12 * Math.max(0, 1 - Math.abs(y - 0.75) * 2.2) && y < 0.98 && Math.abs(cx) > 0.25;
      const cc = acc ? cAcc : cMain;
      col.push(cc.r, cc.g, cc.b);
    }
  }
  const paintIdx = [], glassIdx = [];
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < around; i++) {
      const a = r * around + i, b = r * around + ((i + 1) % around);
      const c = a + around, d = b + around;
      const g1 = isGlass[a] && isGlass[b] && isGlass[c], g2 = isGlass[b] && isGlass[d] && isGlass[c];
      (g1 ? glassIdx : paintIdx).push(a, b, c);
      (g2 ? glassIdx : paintIdx).push(b, d, c);
    }
  }
  // end caps
  for (const [ring, flip] of [[0, true], [rings, false]]) {
    const base = ring * around;
    let cx = 0, cy = 0;
    for (let i = 0; i < around; i++) { cy += pos[(base + i) * 3 + 1]; }
    const ci = pos.length / 3;
    pos.push(cx, cy / around, pos[base * 3 + 2]);
    col.push(cMain.r, cMain.g, cMain.b);
    for (let i = 0; i < around; i++) {
      const a = base + i, b = base + ((i + 1) % around);
      if (flip) paintIdx.push(ci, b, a); else paintIdx.push(ci, a, b); // rear cap faces -z, front cap +z
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex([...paintIdx, ...glassIdx]);
  geo.addGroup(0, paintIdx.length, 0);
  geo.addGroup(paintIdx.length, glassIdx.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Proper wheel: rounded tyre, 10-spoke rim, brake disc and caliper. Axle along X.
 *  Parts are merged per material (4 draw calls per wheel) and the geometry is cached per size. */
const wheelCache = new Map();
const caliperMats = new Map();
function wheelGeos(r) {
  const key = r.toFixed(3);
  if (wheelCache.has(key)) return wheelCache.get(key);
  const tw = r * 0.72;
  const bake = (geo, { px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0 } = {}) => {
    const o = new THREE.Object3D();
    o.position.set(px, py, pz);
    o.rotation.set(rx, ry, rz);
    o.updateMatrix();
    return geo.applyMatrix4(o.matrix);
  };
  const tyreGeo = new THREE.TorusGeometry(r - tw * 0.28, tw * 0.42, 10, 28);
  tyreGeo.scale(1, 1, 0.95);
  const tyre = bake(tyreGeo, { ry: Math.PI / 2 });
  const dark = mergeGeometries([
    bake(new THREE.CylinderGeometry(r * 0.66, r * 0.66, tw * 0.9, 24, 1, true), { rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.03, 24), { rz: Math.PI / 2 }),
  ]);
  const rimParts = [];
  for (const side of [-1, 1]) {
    const x = side * tw * 0.42;
    for (let i = 0; i < 10; i++) rimParts.push(bake(new THREE.BoxGeometry(0.03, r * 0.6, i % 2 ? r * 0.07 : r * 0.11), { px: x, rx: (i / 10) * Math.PI }));
    rimParts.push(bake(new THREE.TorusGeometry(r * 0.64, 0.018, 6, 28), { px: x, ry: Math.PI / 2 }));
    rimParts.push(bake(new THREE.CylinderGeometry(r * 0.11, r * 0.11, 0.04, 14), { px: x + side * 0.01, rz: Math.PI / 2 }));
  }
  // strip uv/normal differences so everything merges cleanly
  const clean = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; };
  const rim = mergeGeometries(rimParts.map(clean));
  const caliper = new THREE.BoxGeometry(0.08, r * 0.32, r * 0.42).translate(0, r * 0.32, r * 0.18);
  const out = { tyre, dark: mergeGeometries([clean(dark)]), rim, caliper };
  wheelCache.set(key, out);
  return out;
}

function wheel(r, { rim = M.rim, caliper = 0xb3121b } = {}) {
  const geos = wheelGeos(r);
  if (!caliperMats.has(caliper)) caliperMats.set(caliper, new THREE.MeshStandardMaterial({ color: caliper, roughness: 0.4 }));
  const g = new THREE.Group();
  g.add(mesh(geos.tyre, M.tire));
  g.add(mesh(geos.dark, M.darkRim, { cast: false }));
  g.add(mesh(geos.rim, rim, { cast: false }));
  g.add(mesh(geos.caliper, caliperMats.get(caliper), { cast: false }));
  return g;
}

export function buildCar(spec) {
  if (spec.gltf) return buildGltfCar(spec);
  const def = LOFTS[spec.loft] || LOFTS.sedan;
  const { L, W } = spec.dims;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x020304, metalness: 0.1, roughness: 0.05, clearcoat: 1, envMapIntensity: 0.45 });
  const shell = mesh(loftBody(def, L, W, { main: spec.color, accent: spec.accent }), [paint, glass]);
  body.add(shell);

  const topAt = (zf) => {
    const st = def.st;
    let k = 0;
    while (k < st.length - 2 && st[k + 1][0] < zf) k++;
    const a = st[k], b = st[k + 1], t = THREE.MathUtils.clamp((zf - a[0]) / (b[0] - a[0]), 0, 1);
    return { y1: a[3] + (b[3] - a[3]) * t, hw: (a[1] + (b[1] - a[1]) * t) * W / 2, y0: a[2] + (b[2] - a[2]) * t };
  };
  // lights
  const front = topAt(def.hl[0]);
  for (const s of [-1, 1]) {
    if (def.round) {
      const hl = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 18), M.headlight, { cast: false });
      hl.rotation.x = Math.PI / 2;
      hl.position.set(s * W * 0.36, def.hl[1], L / 2 + 0.02);
      body.add(hl);
    } else {
      const hl = mesh(new THREE.BoxGeometry(W * 0.17, 0.035, 0.28), M.headlight, { cast: false });
      hl.position.set(s * front.hw * 0.6, front.y1 - 0.035, L * (def.hl[0] - 0.015));
      hl.rotation.x = -0.32;
      body.add(hl);
    }
    const mirror = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14), M.trim);
    const cab = def.st.find((x) => x[5] != null && x[6] == null && x[0] > 0) || def.st[Math.floor(def.st.length / 2)];
    mirror.position.set(s * (cab[1] * W / 2 + 0.08), (cab[5] ?? 1) + 0.06, L * (cab[0] - 0.02));
    body.add(mirror);
  }
  const rear = topAt(-0.49);
  const tl = mesh(new THREE.BoxGeometry(rear.hw * 1.75, 0.05, 0.06), M.taillight, { cast: false });
  tl.position.set(0, def.tl, -L / 2 + 0.02);
  body.add(tl);
  const diffuser = mesh(new THREE.BoxGeometry(W * 0.8, 0.14, 0.4), M.trim);
  diffuser.position.set(0, (def.st[0][2] + 0.05), -L / 2 + 0.25);
  body.add(diffuser);
  if (def.grille === 'rolls') {
    const gr = mesh(new THREE.BoxGeometry(W * 0.34, 0.42, 0.06), M.chrome);
    gr.position.set(0, 0.8, L / 2 + 0.02);
    body.add(gr);
  } else if (def.grille === 'g') {
    const gr = mesh(new THREE.BoxGeometry(W * 0.46, 0.34, 0.05), M.trim);
    gr.position.set(0, 0.86, L / 2 + 0.01);
    body.add(gr);
    for (let i = 0; i < 3; i++) {
      const slat = mesh(new THREE.BoxGeometry(W * 0.44, 0.03, 0.06), M.chrome, { cast: false });
      slat.position.set(0, 0.76 + i * 0.1, L / 2 + 0.03);
      body.add(slat);
    }
  } else if (spec.loft === 'chiron') {
    const gr = mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 24), M.chrome);
    gr.scale.set(1, 1.2, 0.4);
    gr.position.set(0, 0.42, L / 2 - 0.06);
    body.add(gr);
  }
  if (def.spare) {
    const sp = wheel(def.wheelR * 0.95);
    sp.rotation.y = Math.PI / 2;
    sp.position.set(0, 1.05, -L / 2 - 0.22);
    body.add(sp);
  }

  // wheels + dark arch liners
  const wheels = [];
  const liner = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9, side: THREE.DoubleSide });
  for (const [ax, frontAxle] of [[def.axles[0], true], [def.axles[1], false]]) {
    const at = topAt(ax);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (at.hw - def.wheelR * 0.3), def.wheelR, ax * L);
      const w = wheel(def.wheelR, { caliper: spec.caliper ?? (spec.type === 'super' ? 0xc0141c : 0x2a2a2a) });
      pivot.add(w);
      root.add(pivot);
      wheels.push({ pivot, spin: w, front: frontAxle });
      const arch = mesh(new THREE.TorusGeometry(def.wheelR + 0.07, 0.07, 6, 18, Math.PI), liner, { cast: false });
      arch.rotation.y = Math.PI / 2;
      arch.position.set(s * (at.hw * 0.985), def.wheelR + 0.02, ax * L);
      body.add(arch);
    }
  }

  root.add(blobShadow(W * 1.5, L * 1.22));
  const top = Math.max(...def.st.map((x) => x[3]));
  return { root, body, wheels, wheelR: def.wheelR, radius: Math.max(L, W) * 0.48, length: L, width: W, height: top };
}

// ---------- jets ----------

export function buildJet(spec) {
  const { L, span, R } = spec;
  const airliner = spec.engines === 'wing2';
  const yc = R + (airliner ? 1.15 : 0.95); // fuselage centre height
  const root = new THREE.Group();
  const white = M.hull;
  const stripe = new THREE.MeshPhysicalMaterial({ color: spec.stripe, metalness: 0.55, roughness: 0.3, clearcoat: 1 });
  const tailMat = spec.tailColor != null ? new THREE.MeshPhysicalMaterial({ color: spec.tailColor, metalness: 0.4, roughness: 0.3, clearcoat: 1 }) : stripe;
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.8, roughness: 0.35 });

  // fuselage: lathe through fractional profile (r of R, y of L), laid along +z
  const prof = [[0, -0.5], [0.16, -0.494], [0.4, -0.472], [0.66, -0.41], [0.88, -0.32], [0.99, -0.2], [1, -0.1], [1, 0.27], [0.97, 0.335], [0.87, 0.395], [0.68, 0.444], [0.4, 0.481], [0.12, 0.498], [0, 0.5]];
  const fus = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * R, y * L)), 36);
  fus.rotateX(Math.PI / 2);
  const fuselage = mesh(fus, white);
  fuselage.position.y = yc;
  root.add(fuselage);

  // cockpit windscreen band
  const cockpit = mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, { cast: false });
  cockpit.scale.set(R * 0.9, R * 0.42, R * 1.15);
  cockpit.position.set(0, yc + R * 0.18, L * 0.405);
  root.add(cockpit);

  // cabin windows (ovals)
  const winGeo = new THREE.CylinderGeometry(1, 1, 0.05, 18);
  winGeo.rotateZ(Math.PI / 2);
  const wins = new THREE.InstancedMesh(winGeo, M.glass, spec.win * 2);
  const o = new THREE.Object3D();
  const z0 = L * 0.27, z1 = L * (airliner ? -0.3 : -0.17);
  let k = 0;
  for (const s of [-1, 1]) for (let i = 0; i < spec.win; i++) {
    o.position.set(s * R * 0.985, yc + R * 0.14, z0 + (z1 - z0) * (i / Math.max(1, spec.win - 1)));
    o.scale.set(1, spec.winH / 2, spec.winW / 2);
    o.updateMatrix();
    wins.setMatrixAt(k++, o.matrix);
  }
  root.add(wins);
  // livery: cheatline + belly accent
  for (const s of [-1, 1]) {
    const st = mesh(new THREE.BoxGeometry(0.03, R * 0.12, L * 0.72), stripe, { cast: false });
    st.position.set(s * R * 0.99, yc - R * 0.22, -L * 0.02);
    root.add(st);
  }

  // wings (swept), winglets
  const sweep = airliner ? 0.47 : 0.55;
  const sh = span / 2 - R * 0.1, cr = L * (airliner ? 0.2 : 0.21), ct = L * 0.065;
  const zLE = L * (airliner ? 0.06 : 0.02);
  const tipLE = zLE - sh * Math.tan(sweep);
  const wingGeo = planExtrude([[0, zLE], [sh, tipLE], [sh, tipLE - ct], [0, zLE - cr]], airliner ? 0.38 : 0.28, 0.06);
  for (const s of [-1, 1]) {
    const w = mesh(wingGeo, white);
    w.scale.x = s;
    w.position.set(0, yc - R * 0.62, 0);
    w.rotation.z = s * 0.06;
    root.add(w);
    const winglet = mesh(new THREE.BoxGeometry(0.14, span * 0.07, ct * 0.85), tailMat);
    winglet.position.set(s * (sh + 0.05), yc - R * 0.62 + sh * 0.06 + span * 0.035, tipLE - ct * 0.5);
    winglet.rotation.set(-0.35, 0, s * 0.18);
    root.add(winglet);
  }

  // engines
  const nacelle = (nr, len, x, y, z) => {
    const g = new THREE.Group();
    const n = mesh(new THREE.CylinderGeometry(nr, nr * 0.82, len, 22), white);
    n.rotation.x = Math.PI / 2;
    const lip = mesh(new THREE.TorusGeometry(nr * 0.93, nr * 0.09, 8, 24), M.chrome, { cast: false });
    lip.position.z = len / 2;
    const fan = mesh(new THREE.CylinderGeometry(nr * 0.86, nr * 0.86, 0.05, 22), darkMetal, { cast: false });
    fan.rotation.x = Math.PI / 2;
    fan.position.z = len / 2 - 0.1;
    const exhaust = mesh(new THREE.CylinderGeometry(nr * 0.55, nr * 0.4, 0.5, 18), darkMetal);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = -len / 2 - 0.2;
    g.add(n, lip, fan, exhaust);
    g.position.set(x, y, z);
    root.add(g);
    return g;
  };
  if (airliner) {
    const nr = 1.0, len = 4.0;
    for (const s of [-1, 1]) {
      const x = s * sh * 0.34;
      const zAt = zLE - Math.abs(x) * Math.tan(sweep);
      nacelle(nr, len, x, yc - R * 0.62 - nr - 0.15, zAt + 1.2);
      const py = mesh(new THREE.BoxGeometry(0.35, 0.8, 2.8), white);
      py.position.set(x, yc - R * 0.62 - 0.45, zAt);
      root.add(py);
    }
  } else {
    const nr = R * 0.5, len = L * 0.14, ez = -L * 0.3;
    for (const s of [-1, 1]) {
      nacelle(nr, len, s * (R + nr + 0.12), yc + R * 0.38, ez);
      const py = mesh(new THREE.BoxGeometry(nr * 1.6, 0.22, len * 0.5), white);
      py.position.set(s * (R + 0.1), yc + R * 0.34, ez);
      root.add(py);
    }
    if (spec.engines === 'rear3') nacelle(nr * 0.95, len * 0.9, 0, yc + R * 0.95, -L * 0.37);
  }

  // tail fin
  const finH = L * (airliner ? 0.22 : 0.19);
  const fb = -L * 0.5 + L * 0.035, ff = -L * 0.5 + L * (airliner ? 0.2 : 0.18);
  const fin = new THREE.Shape();
  const finBase = yc + R * 0.55;
  fin.moveTo(fb, finBase); fin.lineTo(ff, finBase); fin.lineTo(fb + L * 0.06, finBase + finH); fin.lineTo(fb - L * 0.015, finBase + finH);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.32, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 });
  finGeo.translate(0, 0, -0.16);
  finGeo.rotateY(-Math.PI / 2);
  root.add(mesh(finGeo, tailMat));
  // horizontal stabiliser
  const stabSpan = span * (airliner ? 0.38 : 0.3);
  const stabY = spec.tail === 'T' ? finBase + finH - 0.1 : spec.tail === 'cross' ? finBase + finH * 0.42 : yc + R * 0.1;
  const stabZ = spec.tail === 'T' ? fb + L * 0.02 : spec.tail === 'cross' ? fb + L * 0.05 : -L * 0.42;
  const sc = L * 0.08;
  const stabGeo = planExtrude([[0, stabZ + sc * 0.5], [stabSpan / 2, stabZ - stabSpan * 0.32], [stabSpan / 2, stabZ - stabSpan * 0.32 - sc * 0.45], [0, stabZ - sc * 0.5]], 0.2);
  for (const s of [-1, 1]) {
    const st = mesh(stabGeo, white);
    st.scale.x = s;
    st.position.y = stabY;
    root.add(st);
  }

  // landing gear
  const mainX = airliner ? R * 1.5 : R * 1.15;
  for (const [x, z, front] of [[0, L * 0.37, true], [-mainX, zLE - cr * 0.62, false], [mainX, zLE - cr * 0.62, false]]) {
    const h = yc - R;
    const leg = mesh(new THREE.CylinderGeometry(0.09, 0.09, h), darkMetal);
    leg.position.set(x, h / 2 + 0.2, z);
    root.add(leg);
    for (const dx of front ? [-0.2, 0.2] : [-0.28, 0.28]) {
      const r = front ? 0.36 : (airliner ? 0.58 : 0.45);
      const tyre = mesh(new THREE.CylinderGeometry(r, r, 0.3, 16), M.tire);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(x + dx, r, z);
      root.add(tyre);
    }
  }
  root.userData.dims = { L, span, R, yc };
  root.userData.blob = blobShadow(span * 0.9, L * 1.05, 0.32);
  root.add(root.userData.blob);
  return root;
}

// ---------- yacht ----------

// Superyacht: lofted hull (raked bow, flared topsides, transom), three-tier superstructure
// with dark glass bands and overhanging roofs, teak decks, helipad, radar arch, jacuzzi.
const HULL = [ // [zFrac, halfBeamFrac, deckY, keelY]
  [-0.5, 0.86, 2.55, -0.25], [-0.42, 0.96, 2.6, -0.95], [-0.2, 1, 2.66, -1.45], [0.08, 0.99, 2.78, -1.55],
  [0.28, 0.9, 2.98, -1.45], [0.4, 0.66, 3.18, -1.05], [0.47, 0.34, 3.36, -0.2], [0.5, 0.04, 3.46, 1.2],
];
const yachtDeck = { mat: null };
function hullAt(zf) {
  let k = 0;
  while (k < HULL.length - 2 && HULL[k + 1][0] < zf) k++;
  const a = HULL[Math.max(0, k - 1)], b = HULL[k], c = HULL[k + 1], d = HULL[Math.min(HULL.length - 1, k + 2)];
  const t = THREE.MathUtils.clamp((zf - b[0]) / (c[0] - b[0]), 0, 1);
  return { hw: catmull(a[1], b[1], c[1], d[1], t), deck: catmull(a[2], b[2], c[2], d[2], t), keel: catmull(a[3], b[3], c[3], d[3], t) };
}

function yachtHull(L, W, hullColor, bootColor) {
  const rings = 40, around = 36;
  const pos = [], col = [], idx = [];
  const cHull = new THREE.Color(hullColor), cBoot = new THREE.Color(bootColor);
  for (let r = 0; r <= rings; r++) {
    const zf = -0.5 + r / rings;
    const { hw: hwf, deck, keel } = hullAt(zf);
    const hw = hwf * W / 2;
    const bow = THREE.MathUtils.smoothstep(zf, 0.28, 0.5);
    const ctrl = [[0, keel], [hw * 0.72, keel * 0.42], [hw * 0.94, 0.05], [hw * 1.0, deck * 0.62], [hw, deck], [0, deck + 0.12], [-hw, deck], [-hw * 1.0, deck * 0.62], [-hw * 0.94, 0.05], [-hw * 0.72, keel * 0.42]]
      .map(([x, y]) => new THREE.Vector3(x, y, 0));
    const ring = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal').getSpacedPoints(around);
    ring.pop();
    for (const p of ring) {
      const z = zf * L - bow * 1.4 * (deck - p.y) * 0.5; // raked stem: lower hull sits further aft
      pos.push(p.x, p.y, z);
      const c = p.y < 0.32 ? cBoot : cHull;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < around; i++) {
    const a = r * around + i, b = r * around + ((i + 1) % around), c = a + around, d = b + around;
    idx.push(a, b, c, b, d, c);
  }
  // transom cap (rear faces -z)
  const ci = pos.length / 3;
  let cy = 0;
  for (let i = 0; i < around; i++) cy += pos[i * 3 + 1];
  pos.push(0, cy / around, pos[2]);
  col.push(cHull.r, cHull.g, cHull.b);
  for (let i = 0; i < around; i++) idx.push(ci, (i + 1) % around, i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Deck-house plan: straight sides, elliptical nose. zb/zf = back/front, w = width. */
function deckHousePlan(zb, zf, w, nose = 0.55) {
  const pts = [];
  const nl = Math.min(w * nose, (zf - zb) * 0.5);
  pts.push([-w / 2, zb], [w / 2, zb], [w / 2, zf - nl]);
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push([Math.cos(a) * w / 2, zf - nl + Math.sin(a) * nl]);
  }
  pts.push([-w / 2, zf - nl]);
  return pts;
}

export function buildYacht(L = 50, W = 9, accent = 0x14213d) {
  const root = new THREE.Group();
  const yacht = new THREE.Group();
  yacht.position.y = -0.55; // waterline sits on the sea
  root.add(yacht);
  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
  const hullMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  const darkGlass = new THREE.MeshPhysicalMaterial({ color: 0x05080c, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 0.35 });
  if (!yachtDeck.mat) yachtDeck.mat = pbr('wood_floor_deck', { repeat: [2, 8], color: 0xc9b39a });
  const hullColor = accent === 0xffffff ? 0xf7f7f5 : (Math.random() < 0.35 ? accent : 0xf7f7f5);
  yacht.add(mesh(yachtHull(L, W, hullColor, accent === 0xffffff ? 0x1b2a40 : accent), hullMat));

  // teak main deck (aft half) + swim platform
  const aft = hullAt(-0.3);
  const teak = mesh(new THREE.BoxGeometry(aft.hw * W * 0.92, 0.08, L * 0.36), yachtDeck.mat, { cast: false });
  teak.position.set(0, aft.deck + 0.05, -L * 0.3);
  yacht.add(teak);
  const swim = mesh(new THREE.BoxGeometry(W * 0.78, 0.18, 2.2), yachtDeck.mat);
  swim.position.set(0, 0.45, -L / 2 - 0.9);
  yacht.add(swim);

  // hull windows
  const winGeo = new THREE.BoxGeometry(0.06, 0.42, 1.5);
  const hullWins = new THREE.InstancedMesh(winGeo, darkGlass, 16);
  const o = new THREE.Object3D();
  let k = 0;
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
    const zf = -0.3 + i * 0.07;
    const h = hullAt(zf);
    o.position.set(s * (h.hw * W / 2 * 0.995), 1.45, zf * L);
    o.updateMatrix();
    hullWins.setMatrixAt(k++, o.matrix);
  }
  yacht.add(hullWins);

  // three-tier superstructure: white base, long glass band, overhanging roof
  const tiers = [[-0.33, 0.27, 0.8], [-0.26, 0.17, 0.66], [-0.13, 0.07, 0.5]];
  let base = hullAt(0).deck - 0.05;
  tiers.forEach(([zb, zf, wf], t) => {
    const w = W * wf;
    const solid = mesh(planExtrude(deckHousePlan(zb * L, zf * L, w), 0.65), white);
    solid.position.y = base;
    const glass = mesh(planExtrude(deckHousePlan(zb * L + 0.2, zf * L - 0.15, w * 0.97), 1.55), darkGlass);
    glass.position.y = base + 0.65;
    const roof = mesh(planExtrude(deckHousePlan(zb * L - (t === 0 ? 3 : 2), zf * L + 0.35, w * 1.05), 0.26), white);
    roof.position.y = base + 2.2;
    yacht.add(solid, glass, roof);
    base += 2.46;
  });
  // sundeck: radar arch, domes, jacuzzi, loungers
  const archMat = white;
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.BoxGeometry(0.35, 2.6, 1.1), archMat);
    leg.position.set(s * W * 0.2, base + 1.1, -0.04 * L);
    leg.rotation.z = -s * 0.25;
    yacht.add(leg);
  }
  const bar = mesh(new THREE.BoxGeometry(W * 0.55, 0.35, 1.3), archMat);
  bar.position.set(0, base + 2.35, -0.04 * L);
  yacht.add(bar);
  for (const s of [-1, 1]) {
    const dome = mesh(new THREE.SphereGeometry(0.42, 14, 10), archMat);
    dome.position.set(s * 1.1, base + 2.85, -0.04 * L);
    yacht.add(dome);
  }
  const tub = mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.45, 24), white);
  tub.position.set(0, base + 0.22, -0.11 * L);
  const tubWater = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.05, 24), M.pool, { cast: false });
  tubWater.position.set(0, base + 0.46, -0.11 * L);
  yacht.add(tub, tubWater);
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const l = mesh(new THREE.BoxGeometry(0.75, 0.3, 1.9), white);
    l.position.set(s * (W * 0.32), hullAt(-0.3).deck + 0.2, -L * (0.4 - i * 0.07));
    yacht.add(l);
  }
  // foredeck helipad
  const fd = hullAt(0.36);
  const pad = mesh(new THREE.CylinderGeometry(Math.min(3.2, fd.hw * W * 0.42), Math.min(3.2, fd.hw * W * 0.42), 0.06, 32), M.trim, { cast: false });
  pad.position.set(0, fd.deck + 0.14, 0.33 * L);
  const ring = mesh(new THREE.TorusGeometry(Math.min(3.0, fd.hw * W * 0.4), 0.06, 6, 40), new THREE.MeshStandardMaterial({ color: 0xe8c22a, emissive: 0x3a3000 }), { cast: false });
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, fd.deck + 0.18, 0.33 * L);
  yacht.add(pad, ring);
  for (const [w, d, x] of [[0.18, 1.6, -0.45], [0.18, 1.6, 0.45], [0.9, 0.18, 0]]) {
    const hb = mesh(new THREE.BoxGeometry(w, 0.02, d), M.white, { cast: false });
    hb.position.set(x, fd.deck + 0.18, 0.33 * L);
    yacht.add(hb);
  }
  return root;
}

// ---------- person ----------

export function buildPerson() {
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = root) => {
    const m = mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const limb = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, -h / 2, 0);
    return g;
  };
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.11, 0.95, 0);
    root.add(hip);
    add(limb(0.16, 0.88, 0.18), M.suit, 0, 0, 0, hip);
    add(new THREE.BoxGeometry(0.16, 0.09, 0.3), M.shoe, 0, -0.9, 0.05, hip);
    legs.push(hip);
  }
  add(new THREE.BoxGeometry(0.46, 0.62, 0.26), M.suit, 0, 1.27, 0);
  add(new THREE.BoxGeometry(0.16, 0.42, 0.02), M.shirt, 0, 1.36, 0.135);
  add(new THREE.BoxGeometry(0.04, 0.3, 0.02), M.red, 0, 1.35, 0.15);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.3, 1.54, 0);
    root.add(sh);
    add(limb(0.13, 0.62, 0.15), M.suit, 0, 0, 0, sh);
    add(new THREE.BoxGeometry(0.1, 0.1, 0.1), M.skin, 0, -0.66, 0, sh);
    arms.push(sh);
  }
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), M.skin, 0, 1.62, 0);
  const head = add(new THREE.SphereGeometry(0.15, 18, 14), M.skin, 0, 1.79, 0);
  head.scale.set(0.95, 1.1, 1);
  const hair = add(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), M.hair, 0, 1.82, -0.01);
  hair.scale.set(0.97, 1, 1);
  root.add(blobShadow(0.9, 0.9, 0.5));

  let phase = 0;
  root.userData.animate = (speed, dt) => {
    phase += dt * speed * 2.2;
    const a = Math.min(1, speed / 4) * 0.6;
    legs[0].rotation.x = Math.sin(phase) * a;
    legs[1].rotation.x = -Math.sin(phase) * a;
    arms[0].rotation.x = -Math.sin(phase) * a * 0.8;
    arms[1].rotation.x = Math.sin(phase) * a * 0.8;
  };
  return root;
}

// ---------- palms (instanced) ----------

let palmGeos = null;
let palmMats = null;

function palmTextures() {
  const frond = document.createElement('canvas');
  frond.width = 256; frond.height = 1024;
  const f = frond.getContext('2d');
  f.clearRect(0, 0, 256, 1024);
  f.strokeStyle = '#6b6a2e';
  f.lineWidth = 6;
  f.beginPath(); f.moveTo(128, 1024); f.lineTo(128, 0); f.stroke();
  for (let y = 1010; y > 16; y -= 9) {
    const t = y / 1024; // 1 at base, 0 at tip
    const len = 34 + 90 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    for (const side of [-1, 1]) {
      const g = 75 + Math.random() * 45;
      f.fillStyle = `rgb(${45 + Math.random() * 30},${g + 35},${28 + Math.random() * 22})`;
      f.beginPath();
      f.moveTo(128, y + 4);
      f.quadraticCurveTo(128 + side * len * 0.55, y - 30, 128 + side * len, y - 52 - Math.random() * 10);
      f.quadraticCurveTo(128 + side * len * 0.5, y - 6, 128, y - 9);
      f.fill();
    }
  }
  const bark = document.createElement('canvas');
  bark.width = 64; bark.height = 256;
  const b = bark.getContext('2d');
  b.fillStyle = '#8a7356'; b.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    b.fillStyle = 'rgba(60,45,30,0.55)'; b.fillRect(0, y, 64, 4);
    b.fillStyle = 'rgba(190,170,140,0.35)'; b.fillRect(0, y + 5, 64, 3);
  }
  for (let i = 0; i < 400; i++) { b.fillStyle = `rgba(40,30,20,${Math.random() * 0.2})`; b.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
  const ft = new THREE.CanvasTexture(frond); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 8;
  const bt = new THREE.CanvasTexture(bark); bt.colorSpace = THREE.SRGBColorSpace; bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.repeat.set(1, 6);
  palmMats = {
    leaves: new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7 }),
    trunk: new THREE.MeshStandardMaterial({ map: bt, roughness: 0.95 }),
  };
}

function makePalmGeos() {
  // gently curved, tapered trunk
  const H = 9, segs = 14;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, H * 0.35, 0), new THREE.Vector3(0.75, H * 0.7, 0), new THREE.Vector3(1.3, H, 0)]);
  const trunk = new THREE.TubeGeometry(curve, segs, 0.22, 9, false);
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // taper: shrink toward the top around the curve centre
    const ring = Math.floor(i / 10) / segs;
    const c = curve.getPoint(Math.min(1, ring));
    const k = 1.15 - ring * 0.45;
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, pos.getY(i), c.z + (pos.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  const top = curve.getPoint(1);
  const leafParts = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(2.0, 4.8, 4, 10);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = (p.getY(v) + 2.4) / 4.8; // 0 base -> 1 tip
      const x = p.getX(v);
      p.setZ(v, -t * t * 2.2 + Math.abs(x) * 0.35); // droop + V fold
    }
    g.translate(0, 2.4, 0);
    const up = i < 4 ? -0.55 : -1.25 - Math.random() * 0.35; // a few young fronds point up
    g.rotateX(up);
    g.rotateY((i / n) * Math.PI * 2 + Math.random() * 0.3);
    g.translate(top.x, top.y, top.z);
    leafParts.push(g);
  }
  const leaves = mergeGeometries(leafParts);
  leaves.computeVertexNormals();
  palmGeos = { trunk, leaves };
}

export function palms(positions) {
  if (!palmGeos) makePalmGeos();
  if (!palmMats) palmTextures();
  const g = new THREE.Group();
  const trunk = new THREE.InstancedMesh(palmGeos.trunk, palmMats.trunk, positions.length);
  const leaves = new THREE.InstancedMesh(palmGeos.leaves, palmMats.leaves, positions.length);
  trunk.castShadow = leaves.castShadow = true;
  const o = new THREE.Object3D();
  positions.forEach(([x, z, y = 0], i) => {
    o.position.set(x, y, z);
    o.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.35;
    o.scale.setScalar(s);
    o.updateMatrix();
    trunk.setMatrixAt(i, o.matrix);
    leaves.setMatrixAt(i, o.matrix);
  });
  g.add(trunk, leaves);
  return g;
}

export { planExtrude, sideExtrude, mesh };

// ---------- cheap mass-placed scenery ----------

/** Low-poly rocks (~320 tris) wearing a scanned rock material. */
export function rocks(placements, material) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(x * 3.1 + z * 1.7) + 0.15 * Math.sin(y * 4.3 + x * 2.2) + 0.08 * Math.sin(z * 7.1);
    p.setXYZ(i, x * n * 1.25, y * n * 0.75, z * n);
  }
  geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, material, placements.length);
  const o = new THREE.Object3D();
  placements.forEach((q, i) => {
    o.position.set(q.x, q.y || 0, q.z);
    o.rotation.set(Math.random() * 0.4, q.rot ?? 0, Math.random() * 0.4);
    o.scale.setScalar(q.scale ?? 1);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.castShadow = im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/** Mediterranean stone pines: tall bare trunk, flat umbrella canopy (~600 tris). */
export function stonePines(placements) {
  const trunk = new THREE.CylinderGeometry(0.18, 0.32, 9, 7);
  trunk.translate(0, 4.5, 0);
  const parts = [];
  for (const [x, y, z, s] of [[0, 9.6, 0, 1], [1.6, 9.2, 0.8, 0.7], [-1.4, 9.3, -0.9, 0.75], [0.4, 9.1, -1.7, 0.6], [-0.6, 9.4, 1.6, 0.6]]) {
    const c = new THREE.IcosahedronGeometry(3.2 * s, 1);
    c.scale(1.25, 0.42, 1.25);
    c.translate(x, y, z);
    parts.push(c);
  }
  const canopy = mergeGeometries(parts);
  const cp = canopy.attributes.position;
  const colors = new Float32Array(cp.count * 3);
  const a = new THREE.Color(0x2f4a23), b = new THREE.Color(0x4f6b31), c = new THREE.Color();
  for (let i = 0; i < cp.count; i++) {
    cp.setY(i, cp.getY(i) + (Math.sin(cp.getX(i) * 2.3) + Math.cos(cp.getZ(i) * 1.9)) * 0.18);
    c.copy(a).lerp(b, THREE.MathUtils.clamp((cp.getY(i) - 8.6) / 2, 0, 1) * (0.6 + Math.random() * 0.4));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  canopy.computeVertexNormals();
  const g = new THREE.Group();
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x6b5442, roughness: 1 }), placements.length);
  const cm = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), placements.length);
  const o = new THREE.Object3D();
  placements.forEach((q, i) => {
    o.position.set(q.x, q.y || 0, q.z);
    o.rotation.set(0, q.rot ?? 0, (Math.random() - 0.5) * 0.12);
    o.scale.setScalar(q.scale ?? 1);
    o.updateMatrix();
    tm.setMatrixAt(i, o.matrix);
    cm.setMatrixAt(i, o.matrix);
  });
  tm.castShadow = cm.castShadow = true;
  tm.receiveShadow = cm.receiveShadow = true;
  tm.computeBoundingSphere();
  cm.computeBoundingSphere();
  g.add(tm, cm);
  return g;
}

// ---------- real glTF cars ----------

/** Ferrari 458 Italia (three.js example model). Same interface as the procedural cars. */
function buildGltfCar(spec) {
  const { scene } = loadGltf(spec.gltf);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI; // the model faces -z; ours face +z
  body.add(holder);
  holder.add(scene);

  const paint = new THREE.MeshPhysicalMaterial({ color: spec.color, metalness: 0.9, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1 });
  const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x111418, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.55, clearcoat: 1 });
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.name === 'body') o.material = paint;
    else if (/^rim_|^trim$/.test(o.name)) o.material = details;
    else if (o.name === 'glass') o.material = glass;
  });

  // wheels: put each wheel node under a pivot so the fronts can steer and all can spin
  const wheels = [];
  for (const [name, front] of [['wheel_fl', true], ['wheel_fr', true], ['wheel_rl', false], ['wheel_rr', false]]) {
    const w = scene.getObjectByName(name);
    if (!w) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(w.position);
    w.parent.add(pivot);
    pivot.add(w);
    w.position.set(0, 0, 0);
    // the pivot lives in the flipped model space, so spin runs the other way
    wheels.push({ pivot, spin: w, front, spinSign: -1 });
  }
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());

  // baked ambient-occlusion shadow that ships with the model
  const ao = new THREE.Mesh(
    new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
    new THREE.MeshBasicMaterial({ map: misc('ferrariAO'), blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, depthWrite: false })
  );
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = 0.02;
  ao.renderOrder = 2;
  root.add(ao);

  return { root, body, wheels, wheelR: 0.34, radius: Math.max(size.x, size.z) * 0.48, length: size.z, width: Math.min(size.x, spec.dims.W + 0.1), height: size.y };
}

// ---------- animated character (Mixamo, via the three.js examples) ----------

/** idle / walk / run blended by speed. Missing clips fall back to whatever exists. */
function locomotion(scene, clips) {
  const mixer = new THREE.AnimationMixer(scene);
  const pick = (k) => clips[k] || clips.walk || clips.idle || clips.run;
  const actions = { idle: mixer.clipAction(pick('idle')), walk: mixer.clipAction(pick('walk')), run: mixer.clipAction(pick('run')) };
  for (const a of new Set(Object.values(actions))) { a.play(); a.setEffectiveWeight(0); }
  actions.idle.setEffectiveWeight(1);
  const weights = { idle: 1, walk: 0, run: 0 };
  return (speed, dt) => {
    // blend by speed: idle < 0.3 m/s, walk around 1.5-4, run from ~6
    const target = speed < 0.3 ? { idle: 1, walk: 0, run: 0 }
      : speed < 5 ? { idle: 0, walk: 1, run: 0 }
      : { idle: 0, walk: Math.max(0, 1 - (speed - 5) / 2), run: Math.min(1, (speed - 5) / 2) };
    for (const k of Object.keys(weights)) {
      weights[k] += (target[k] - weights[k]) * Math.min(1, dt * 8);
      actions[k].setEffectiveWeight(weights[k]);
    }
    actions.walk.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 2.4);
    actions.run.timeScale = THREE.MathUtils.clamp(speed / 6.5, 0.7, 1.5);
    mixer.update(dt);
  };
}

/**
 * You, in jeans and a sweatshirt: the Soldier's skeleton and Idle/Walk/Run animations drive a body
 * generated in character.js; the armoured mesh is hidden. root.userData.setLook({ top, jeans, skin }).
 */
export function buildCasual(look = DEFAULT_LOOK) {
  const { scene, animations } = loadGltf('soldier');
  const root = new THREE.Group();
  scene.rotation.y = Math.PI; // model faces -z; ours face +z
  root.add(scene);
  let src = null;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (o.name === 'vanguard_Mesh') src = o;
    o.visible = false; // the armour and visor
  });
  const body = buildCasualBody(src.skeleton, src.bindMatrix, look);
  body.mesh.position.copy(src.position);
  body.mesh.quaternion.copy(src.quaternion);
  body.mesh.scale.copy(src.scale);
  src.parent.add(body.mesh);
  root.add(blobShadow(0.9, 0.9, 0.45));
  const clip = (n) => animations.find((a) => a.name === n);
  root.userData.animate = locomotion(scene, { idle: clip('Idle'), walk: clip('Walk'), run: clip('Run') });
  root.userData.setLook = body.setLook;
  return root;
}

/** The player: your Mixamo character if you've added one, otherwise you in jeans and a sweatshirt. */
export function buildPlayer(look) {
  const mx = misc('mixamo');
  if (!mx) return buildCasual(look);
  const scene = cloneSkinned(mx.model);
  const box = new THREE.Box3().setFromObject(scene);
  scene.scale.setScalar(1.8 / Math.max(0.01, box.max.y - box.min.y)); // normalise to 1.8 m (FBX is in cm)
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const toStd = (m) => new THREE.MeshStandardMaterial({ map: m.map || null, normalMap: m.normalMap || null, color: m.map ? 0xffffff : m.color, roughness: 0.65, transparent: m.transparent, alphaTest: m.alphaTest });
    o.material = Array.isArray(o.material) ? o.material.map(toStd) : toStd(o.material);
  });
  const root = new THREE.Group();
  root.add(scene);
  root.add(blobShadow(0.9, 0.9, 0.45));
  root.userData.animate = locomotion(scene, mx.clips);
  return root;
}

// ---------- pedestrians (Khronos "Cesium Man", CC-BY 4.0) ----------

const PED_TINTS = [0x1f2a40, 0xcbbd9f, 0xeeeeea, 0x1a1a1c, 0x6d727a, 0x7a3b32, 0x3e5a4a, 0xb9a48a];
const pedMats = new Map();
export function buildPedestrian(i = 0) {
  const { scene, animations } = loadGltf('cesiumman');
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(1.17); // 1.5 m model -> ~1.75 m
  holder.add(scene);
  root.add(holder);
  const tint = PED_TINTS[i % PED_TINTS.length];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const key = `${o.material.uuid}-${tint}`;
    // drop the logo-pattern texture: plain clothing colours read as people at street distance
    if (!pedMats.has(key)) pedMats.set(key, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.75 }));
    o.material = pedMats.get(key);
  });
  root.add(blobShadow(0.8, 0.8, 0.4));
  const mixer = new THREE.AnimationMixer(scene);
  const walk = mixer.clipAction(animations[0]);
  walk.play();
  walk.time = Math.random() * animations[0].duration;
  root.userData.animate = (speed, dt) => {
    walk.timeScale = speed / 1.3;
    mixer.update(dt);
  };
  return root;
}
