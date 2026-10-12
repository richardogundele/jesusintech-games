import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M } from './materials.js';

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

const PROFILES = {
  super: {
    h: 1.16, wheelR: 0.36, hlY: 0.56, tlY: 0.78,
    body: [[-0.5, 0.3], [-0.5, 0.8], [-0.45, 0.9], [-0.22, 0.95], [0.22, 0.88], [0.38, 0.7], [0.47, 0.57], [0.5, 0.42], [0.49, 0.26], [0.42, 0.18], [-0.44, 0.18]],
    glass: [[-0.25, 0.92], [-0.12, 1.15], [0.03, 1.16], [0.25, 0.86]],
    glassW: 0.76, axles: [0.31, -0.3],
  },
  suv: {
    h: 1.84, wheelR: 0.45, hlY: 0.92, tlY: 1.0,
    body: [[-0.5, 0.45], [-0.5, 1.1], [-0.46, 1.17], [0.2, 1.15], [0.33, 1.08], [0.5, 1.02], [0.5, 0.5], [0.47, 0.34], [-0.47, 0.34]],
    glass: [[-0.47, 1.12], [-0.44, 1.76], [0.12, 1.78], [0.28, 1.12]],
    glassW: 0.86, axles: [0.32, -0.31], roof: [-0.45, 0.13, 1.78],
  },
  box: {
    h: 1.97, wheelR: 0.43, hlY: 0.98, tlY: 1.0,
    body: [[-0.5, 0.5], [-0.5, 1.16], [0.4, 1.16], [0.5, 1.07], [0.5, 0.5], [0.48, 0.37], [-0.48, 0.37]],
    glass: [[-0.49, 1.13], [-0.48, 1.86], [0.26, 1.86], [0.3, 1.13]],
    glassW: 0.88, axles: [0.31, -0.31], roof: [-0.49, 0.27, 1.86], spare: true,
  },
};

function wheel(r, accentRim) {
  const g = new THREE.Group();
  const w = r * 0.8;
  const tire = mesh(new THREE.CylinderGeometry(r, r, w, 22), M.tire);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const rimMat = accentRim ? M.darkRim : M.rim;
  for (const side of [-1, 1]) {
    const rim = mesh(new THREE.CylinderGeometry(r * 0.68, r * 0.68, 0.02, 20), rimMat, { cast: false });
    rim.rotation.z = Math.PI / 2;
    rim.position.x = side * (w / 2 + 0.005);
    g.add(rim);
    for (let i = 0; i < 5; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.03, r * 1.25, r * 0.16), M.chrome, { cast: false });
      spoke.position.x = side * (w / 2 + 0.02);
      spoke.rotation.x = (i / 5) * Math.PI;
      g.add(spoke);
    }
    const hub = mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.04, 12), M.trim, { cast: false });
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * (w / 2 + 0.03);
    g.add(hub);
  }
  return g;
}

export function buildCar(spec) {
  const P = PROFILES[spec.type];
  const { L, W } = spec.dims;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const scaleX = (pts) => pts.map(([x, y]) => [x * L, y]);
  const paint = M.paint(spec.color);
  body.add(mesh(sideExtrude(scaleX(P.body), W, 0.08), paint));
  const glass = mesh(sideExtrude(scaleX(P.glass), W * P.glassW, 0.05), M.glass);
  body.add(glass);

  if (P.roof) {
    const [a, b, y] = P.roof;
    const roof = mesh(new THREE.BoxGeometry(W * P.glassW + 0.06, 0.07, (b - a) * L), paint);
    roof.position.set(0, y + 0.03, ((a + b) / 2) * L);
    body.add(roof);
  }

  // lower trim / diffuser
  const trim = mesh(new THREE.BoxGeometry(W * 0.98, 0.1, L * 0.92), spec.accent ? M.paint(spec.accent) : M.trim);
  trim.position.y = P.body.at(-1)[1] + 0.04;
  body.add(trim);

  // lights
  for (const s of [-1, 1]) {
    const hl = mesh(new THREE.BoxGeometry(W * 0.22, 0.06, 0.1), M.headlight, { cast: false });
    hl.position.set(s * W * 0.32, P.hlY, L / 2 - 0.02);
    body.add(hl);
    const mirror = mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), paint);
    mirror.position.set(s * (W / 2 + 0.06), P.glass[3][1] + 0.08, L * (P.glass[3][0] - 0.05));
    body.add(mirror);
  }
  const tl = mesh(new THREE.BoxGeometry(W * 0.86, 0.05, 0.08), M.taillight, { cast: false });
  tl.position.set(0, P.tlY, -L / 2 - 0.03);
  body.add(tl);

  if (spec.type === 'suv') {
    const grille = mesh(new THREE.BoxGeometry(W * 0.36, 0.42, 0.06), M.chrome);
    grille.position.set(0, 0.74, L / 2 + 0.03);
    body.add(grille);
  }
  if (P.spare) {
    const spare = wheel(P.wheelR * 0.95, true);
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0, 1.0, -L / 2 - 0.2);
    body.add(spare);
  }

  // wheels
  const wheels = [];
  const [fa, ra] = P.axles;
  for (const [ax, front] of [[fa, true], [ra, false]]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (W / 2 - P.wheelR * 0.38), P.wheelR, ax * L);
      const w = wheel(P.wheelR, spec.type !== 'suv');
      pivot.add(w);
      root.add(pivot);
      wheels.push({ pivot, spin: w, front });
    }
  }

  root.add(blobShadow(W * 1.5, L * 1.25));
  return { root, body, wheels, wheelR: P.wheelR, radius: Math.max(L, W) * 0.48, length: L, width: W, height: P.h };
}

// ---------- jets ----------

export function buildJet(spec) {
  const root = new THREE.Group();
  const white = M.hull;
  const stripe = new THREE.MeshPhysicalMaterial({ color: spec.stripe, metalness: 0.6, roughness: 0.3, clearcoat: 1 });

  // fuselage (lathe around Y, then laid along Z)
  const prof = [[0, -16.5], [0.35, -16.2], [0.75, -14.5], [1.15, -11], [1.3, -6], [1.3, 9], [1.22, 12.5], [0.95, 14.6], [0.5, 16.1], [0.05, 16.6]];
  const fus = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  fus.rotateX(Math.PI / 2);
  const fuselage = mesh(fus, white);
  fuselage.position.y = 2.6;
  root.add(fuselage);

  // cockpit glass + cabin windows
  const cockpit = mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, { cast: false });
  cockpit.scale.set(1.13, 0.55, 1.4);
  cockpit.position.set(0, 3.0, 13.6);
  root.add(cockpit);
  const winGeo = new THREE.BoxGeometry(0.05, 0.34, 0.42);
  const wins = new THREE.InstancedMesh(winGeo, M.glass, 22);
  const tmp = new THREE.Object3D();
  let k = 0;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      tmp.position.set(s * 1.28, 2.85, -6 + i * 1.65);
      tmp.updateMatrix();
      wins.setMatrixAt(k++, tmp.matrix);
    }
  }
  root.add(wins);
  for (const s of [-1, 1]) {
    const st = mesh(new THREE.BoxGeometry(0.04, 0.22, 27), stripe, { cast: false });
    st.position.set(s * 1.3, 2.3, -1);
    root.add(st);
  }

  // wings
  const wingPts = [[0, 3.2], [0, -2.5], [14.5, -8.2], [15.2, -8.2], [15.2, -6.6], [3, 1]];
  const wingGeo = planExtrude(wingPts, 0.28, 0.05);
  for (const s of [-1, 1]) {
    const w = mesh(wingGeo, white);
    w.scale.x = s;
    w.position.set(0, 1.8, 0.5);
    w.rotation.z = s * 0.07;
    root.add(w);
    const winglet = mesh(new THREE.BoxGeometry(0.15, 2.0, 1.6), stripe);
    winglet.position.set(s * 15.3, 3.6, -7.0);
    winglet.rotation.x = -0.35;
    root.add(winglet);
  }

  // engines
  for (const s of [-1, 1]) {
    const nac = mesh(new THREE.CylinderGeometry(0.8, 0.68, 4.8, 18), white);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 2.75, 3.3, -9.2);
    root.add(nac);
    const intake = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 18), M.trim, { cast: false });
    intake.rotation.x = Math.PI / 2;
    intake.position.set(s * 2.75, 3.3, -6.78);
    root.add(intake);
    const pylon = mesh(new THREE.BoxGeometry(1.4, 0.25, 2.2), white);
    pylon.position.set(s * 1.9, 3.1, -9.2);
    root.add(pylon);
  }

  // tail: fin + T stabiliser
  const fin = new THREE.Shape();
  fin.moveTo(-16.0, 3.3); fin.lineTo(-11.5, 3.3); fin.lineTo(-14.2, 8.6); fin.lineTo(-16.3, 8.6); fin.lineTo(-16.6, 3.3);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.3, bevelEnabled: false });
  finGeo.translate(0, 0, -0.15);
  finGeo.rotateY(-Math.PI / 2);
  root.add(mesh(finGeo, stripe));
  const stab = mesh(planExtrude([[0, -13.6], [0, -15.6], [5.2, -17.2], [5.2, -16.0]], 0.22), white);
  const stab2 = stab.clone();
  stab2.scale.x = -1;
  stab.position.y = stab2.position.y = 8.5;
  root.add(stab, stab2);

  // gear
  for (const [x, z] of [[0, 12], [-2.2, -1.5], [2.2, -1.5]]) {
    const leg = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4), M.lamp);
    leg.position.set(x, 1.0, z);
    const tire = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), M.tire);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, 0.42, z);
    root.add(leg, tire);
  }

  root.userData.blob = blobShadow(30, 34, 0.35);
  root.add(root.userData.blob);
  return root;
}

// ---------- yacht ----------

export function buildYacht(L = 50, W = 9, accent = 0x14213d) {
  const root = new THREE.Group();
  const plan = (s) => [[-L / 2 * s, -W / 2 * s], [L * 0.22 * s, -W / 2 * s], [L * 0.42 * s, -W * 0.3 * s], [L / 2 * s, 0], [L * 0.42 * s, W * 0.3 * s], [L * 0.22 * s, W / 2 * s], [-L / 2 * s, W / 2 * s]];
  const navy = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.2, clearcoat: 1 });
  const lower = mesh(planExtrude(plan(1), 1.6), navy);
  lower.position.y = -1.4;
  const upper = mesh(planExtrude(plan(1), 2.4), M.hull);
  upper.position.y = 0.2;
  root.add(lower, upper);
  const deck = mesh(planExtrude(plan(0.97), 0.1), M.wood, { cast: false });
  deck.position.y = 2.6;
  root.add(deck);
  let y = 2.7;
  for (const [s, off] of [[0.72, -0.08], [0.55, -0.12], [0.36, -0.14]]) {
    const g = mesh(planExtrude(plan(s * 0.97), 1.9), M.glass);
    g.position.set(off * L, y, 0);
    const slab = mesh(planExtrude(plan(s), 0.35), M.hull);
    slab.position.set(off * L, y + 1.9, 0);
    root.add(g, slab);
    y += 2.25;
  }
  const mast = mesh(new THREE.CylinderGeometry(0.15, 0.2, 4), M.hull);
  mast.position.set(-0.16 * L, y + 2, 0);
  root.add(mast);
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
function makePalmGeos() {
  const trunkParts = [];
  let y = 0, x = 0;
  for (let i = 0; i < 7; i++) {
    const g = new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 1.35, 7);
    g.translate(x, y + 0.67, 0);
    trunkParts.push(g);
    y += 1.3;
    x += 0.06 * i;
  }
  const leafParts = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.PlaneGeometry(0.9, 4.2, 1, 6);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + 2.1) / 4.2;
      pos.setZ(v, -t * t * 1.6);
      pos.setX(v, pos.getX(v) * (1 - t * 0.7));
    }
    g.translate(0, 2.1, 0);
    g.rotateX(-1.15);
    g.rotateY((i / 8) * Math.PI * 2);
    g.translate(x, y, 0);
    leafParts.push(g);
  }
  palmGeos = { trunk: mergeGeometries(trunkParts), leaves: mergeGeometries(leafParts) };
  palmGeos.leaves.computeVertexNormals();
}

export function palms(positions) {
  if (!palmGeos) makePalmGeos();
  const g = new THREE.Group();
  const trunk = new THREE.InstancedMesh(palmGeos.trunk, M.palmTrunk, positions.length);
  const leaves = new THREE.InstancedMesh(palmGeos.leaves, M.palmLeaf, positions.length);
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
