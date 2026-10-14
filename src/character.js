import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The player as a person, not a robot: a smooth body generated around the Soldier's Mixamo skeleton
// (so its Idle / Walk / Run animations drive it), with two outfits you can switch in the phone:
// a camouflage military uniform (combat jacket, trousers bloused into boots, belt, beret) and
// jeans with a crew-neck sweatshirt and white trainers. Everything is built in the skeleton's bind
// space: centimetres, Z up, facing +Y, the character's left at -X (a T-pose, 183 cm tall).

// camo patterns: [base, blob colours...]
export const CAMO = {
  Woodland: [0x8a8158, 0x4a5a2e, 0x5b4630, 0x23231e],
  Desert: [0xc9b48a, 0xa88c5f, 0x8b7350, 0x6f5d44],
  Multicam: [0xa39573, 0x7c7a55, 0x6b5c45, 0xc8bc9a],
  Urban: [0x9a9c9e, 0x6d7073, 0x3d3f42, 0xd2d3d4],
};
export const LOOKS = {
  outfit: { 'Military uniform': 0x4a5a2e, 'Jeans & sweatshirt': 0x2d5fb0 },
  camo: Object.fromEntries(Object.entries(CAMO).map(([k, v]) => [k, v[1]])),
  top: { 'Royal blue': 0x2d5fb0, Navy: 0x1d2b4a, 'Sky blue': 0x6d9fd6, Black: 0x17181b, Grey: 0x8a8d92, White: 0xeceae4, Burgundy: 0x6e1f2c },
  jeans: { 'Dark denim': 0x24395c, 'Mid denim': 0x355a8a, 'Light denim': 0x7d9cc0, Black: 0x1c1d21 },
  skin: { 'Deep brown': 0x4a2c1a, Brown: 0x6b4429, 'Medium brown': 0x8d5a3a, Tan: 0xb07a52, Light: 0xe0b896 },
};
export const DEFAULT_LOOK = { outfit: 'Military uniform', camo: 'Woodland', top: 'Royal blue', jeans: 'Dark denim', skin: 'Brown' };

// ---------- fabric textures (canvas, so nothing to download) ----------
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** grey-scale fleece knit; the material colour tints it */
const fleeceTex = () => canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 4) {
    const v = 200 + Math.random() * 40;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 3, 2);
  }
});
/** denim twill: diagonal weave, slight fading, with a side seam at u = 0.25 / 0.75 */
const denimTex = () => canvasTex(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, w, h);
  for (let i = -h; i < w; i += 3) {
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
  }
  for (let k = 0; k < 900; k++) { // slubs and fading
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 1);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let k = 0; k < 2; k++) ctx.fillRect(w * (0.25 + k * 0.5) - 3, 0, 6, h);         // side seams
  ctx.fillStyle = 'rgba(220,170,90,0.55)';                                               // contrast stitching
  for (let k = 0; k < 2; k++) for (let y = 0; y < h; y += 10) ctx.fillRect(w * (0.25 + k * 0.5) + 4, y, 1.5, 6);
});
/** tileable camouflage: irregular blobs in three colours over a base */
const camoCache = new Map();
function camoTex(name) {
  if (camoCache.has(name)) return camoCache.get(name);
  const cols = CAMO[name] || CAMO.Woodland;
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const t = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = hex(cols[0]); ctx.fillRect(0, 0, w, h);
    const blob = (cx, cy, r, col) => {
      ctx.fillStyle = hex(col);
      const n = 9, pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2, rr = r * (0.55 + Math.random() * 0.7);
        return [Math.cos(a) * rr * 1.5, Math.sin(a) * rr];
      });
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { // wrap so the pattern tiles
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x + ox, cy + y + oy) : ctx.moveTo(cx + x + ox, cy + y + oy)));
        ctx.closePath(); ctx.fill();
      }
    };
    for (let k = 0; k < 26; k++) blob(Math.random() * w, Math.random() * h, 26 + Math.random() * 30, cols[1]);
    for (let k = 0; k < 22; k++) blob(Math.random() * w, Math.random() * h, 18 + Math.random() * 22, cols[2]);
    for (let k = 0; k < 20; k++) blob(Math.random() * w, Math.random() * h, 7 + Math.random() * 10, cols[3]);
    for (let y = 0; y < h; y += 2) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; ctx.fillRect(0, y, w, 1); } // ripstop weave
  });
  camoCache.set(name, t);
  return t;
}

/** rib knit for cuffs, hem and collar */
const ribTex = () => canvasTex(128, 32, (ctx, w, h) => {
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 4) { ctx.fillStyle = '#ebebeb'; ctx.fillRect(x, 0, 2, h); }
});

// ---------- geometry: elliptical tubes swept through rings, each ring skinned to bones ----------
/**
 * rings: [{ c: [x,y,z], a, b, u?: [x,y,z], v?: [x,y,z], w: [[bone, weight], ...] }]
 * a = half-size along u, b = half-size along v. If u/v are omitted they're derived from the path.
 */
function tube(rings, bones, { seg = 24, capStart = false, capEnd = false, vScale = 10, power = 2 } = {}) {
  const pos = [], uv = [], si = [], sw = [], idx = [];
  const n = rings.length;
  let len = 0;
  let outward = true; // winding must face out whichever way the path and section axes run
  const C = rings.map((r) => new THREE.Vector3(...r.c));
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    const dir = new THREE.Vector3().subVectors(C[Math.min(n - 1, i + 1)], C[Math.max(0, i - 1)]).normalize();
    let U = r.u ? new THREE.Vector3(...r.u) : null, Vv = r.v ? new THREE.Vector3(...r.v) : null;
    if (!U) {
      const ref = Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      U = new THREE.Vector3().crossVectors(dir, ref).normalize();
    }
    if (!Vv) Vv = new THREE.Vector3().crossVectors(U, dir).normalize();
    if (i === 0) outward = new THREE.Vector3().crossVectors(U, Vv).dot(dir) > 0;
    if (i > 0) len += C[i].distanceTo(C[i - 1]);
    const ids = r.w.map(([b]) => bones[b]), ws = r.w.map(([, w]) => w);
    const tot = ws.reduce((s, x) => s + x, 0);
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      // superellipse: power > 2 squares the section off (shoulders, hips)
      const ex = Math.sign(ct) * Math.abs(ct) ** (2 / power), ey = Math.sign(st) * Math.abs(st) ** (2 / power);
      const p = C[i].clone().addScaledVector(U, r.a * ex).addScaledVector(Vv, r.b * ey);
      pos.push(p.x, p.y, p.z);
      uv.push(k / seg, len / vScale);
      si.push(ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0, ids[3] ?? 0);
      sw.push((ws[0] ?? 0) / tot, (ws[1] ?? 0) / tot, (ws[2] ?? 0) / tot, (ws[3] ?? 0) / tot);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k, b = a + 1, c = a + seg + 1, d = c + 1;
    if (outward) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const cap = (i, flip) => {
    const centre = pos.length / 3;
    const r = rings[i];
    pos.push(...r.c); uv.push(0.5, 0.5);
    const ids = r.w.map(([b]) => bones[b]), ws = r.w.map(([, w]) => w), tot = ws.reduce((s, x) => s + x, 0);
    si.push(ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0, ids[3] ?? 0);
    sw.push((ws[0] ?? 0) / tot, (ws[1] ?? 0) / tot, (ws[2] ?? 0) / tot, (ws[3] ?? 0) / tot);
    for (let k = 0; k < seg; k++) {
      const a = i * (seg + 1) + k, b = a + 1;
      if (flip === outward) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** ellipsoid (optionally only the part above a tilted plane: for hair) skinned to one bone */
function ellipsoid(c, r, bone, { seg = 28, rows = 20, keep = null, deform = null } = {}) {
  const pos = [], uv = [], idx = [];
  const map = new Map();
  for (let j = 0; j <= rows; j++) {
    const phi = (j / rows) * Math.PI;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      let x = Math.sin(phi) * Math.cos(th), y = Math.sin(phi) * Math.sin(th), z = Math.cos(phi);
      if (keep && !keep(x, y, z)) continue;
      if (deform) [x, y, z] = deform(x, y, z);
      const p = [c[0] + x * r[0], c[1] + y * r[1], c[2] + z * r[2]];
      map.set(j * (seg + 1) + k, pos.length / 3);
      pos.push(...p);
      uv.push(k / seg, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) for (let k = 0; k < seg; k++) {
    const a = j * (seg + 1) + k, b = a + 1, cc = a + seg + 1, d = cc + 1;
    if ([a, b, cc, d].every((q) => map.has(q))) idx.push(map.get(a), map.get(cc), map.get(b), map.get(b), map.get(cc), map.get(d));
  }
  const n = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n).fill(0).flatMap(() => [bone, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Build the body + both outfits as one SkinnedMesh bound to `skel` (the Soldier's skeleton).
 * Returns { mesh, setLook(look) }. Add the mesh as a sibling of the original skinned mesh.
 */
export function buildCasualBody(skel, bindMatrix, look = DEFAULT_LOOK) {
  const B = {};
  skel.bones.forEach((b, i) => { B[b.name.replace('mixamorig', '').replace(':', '')] = i; });
  const parts = {
    skin: [], lip: [], hair: [], sclera: [], dark: [],
    top: [], rib: [], jeans: [], shoe: [], sole: [],                         // jeans & sweatshirt
    camoTop: [], camoTrim: [], camoPants: [], boot: [], bootSole: [], belt: [], beret: [], badge: [], // uniform
  };
  const T = (z, a, b, y, w) => ({ c: [0, y, z], a, b, u: [1, 0, 0], v: [0, 1, 0], w });
  const grow = (rings, d) => rings.map((r) => ({ ...r, a: r.a + d, b: r.b + d }));

  // ---- torso shapes (shared by both outfits) ----
  const seat = [
    T(86, 13.5, 10.5, -1.5, [['Hips', 1]]),
    T(92, 16.2, 12.0, -1.8, [['Hips', 1]]),
    T(98, 16.8, 12.2, -1.2, [['Hips', 1]]),
    T(104, 16.3, 11.6, -0.8, [['Hips', 0.75], ['Spine', 0.25]]),
  ];
  const chest = [
    T(104, 17.0, 12.4, -0.7, [['Hips', 0.7], ['Spine', 0.3]]),
    T(112, 16.0, 11.8, -0.6, [['Spine', 1]]),
    T(121, 16.8, 12.3, -1.3, [['Spine', 0.5], ['Spine1', 0.5]]),
    T(131, 18.4, 12.8, -2.4, [['Spine1', 0.5], ['Spine2', 0.5]]),
    T(140, 19.4, 12.6, -3.6, [['Spine2', 1]]),
    T(146, 19.2, 11.8, -4.4, [['Spine2', 1]]),
    T(150, 16.6, 10.0, -5.0, [['Spine2', 0.8], ['Neck', 0.2]]),
    T(152.5, 9.0, 7.8, -5.4, [['Spine2', 0.5], ['Neck', 0.5]]),
  ];
  // jeans & sweatshirt
  parts.jeans.push(tube(seat, B, { capStart: true, power: 2.4, seg: 32 }));
  parts.rib.push(tube([T(100.5, 17.4, 12.9, -0.9, [['Hips', 0.85], ['Spine', 0.15]]), T(104.5, 17.3, 12.6, -0.7, [['Hips', 0.7], ['Spine', 0.3]])], B, { power: 2.4, seg: 32, vScale: 4 }));
  parts.top.push(tube(chest, B, { power: 2.7, seg: 32 }));
  parts.rib.push(tube([T(151.5, 8.8, 7.8, -5.4, [['Spine2', 0.5], ['Neck', 0.5]]), T(154.0, 7.4, 6.8, -5.5, [['Neck', 1]])], B, { seg: 28, vScale: 3 }));
  // uniform: trousers to the waist, a webbing belt, the combat jacket tucked in, a shirt collar, chest pockets
  parts.camoPants.push(tube(seat, B, { capStart: true, power: 2.4, seg: 32, vScale: 30 }));
  parts.belt.push(tube([T(99.2, 17.2, 12.7, -1.0, [['Hips', 1]]), T(103.4, 16.9, 12.3, -0.8, [['Hips', 0.8], ['Spine', 0.2]])], B, { power: 2.4, seg: 32 }));
  parts.badge.push(tube([{ c: [0, 12.0, 100.2], a: 2.6, b: 0.5, u: [1, 0, 0], v: [0, 1, 0], w: [['Hips', 1]] }, { c: [0, 12.0, 102.4], a: 2.6, b: 0.5, u: [1, 0, 0], v: [0, 1, 0], w: [['Hips', 1]] }], B, { seg: 12, power: 6, capStart: true, capEnd: true })); // buckle
  parts.camoTop.push(tube(grow(chest, 0.5).map((r, i) => (i === 0 ? { ...r, c: [0, r.c[1], 102.6] } : r)), B, { power: 2.7, seg: 32, vScale: 30 }));
  parts.camoTrim.push(tube([ // shirt collar, turned out
    T(150.8, 10.4, 9.0, -5.3, [['Spine2', 0.6], ['Neck', 0.4]]),
    T(153.6, 9.0, 8.0, -5.4, [['Neck', 1]]),
    T(155.2, 7.6, 7.0, -5.5, [['Neck', 1]]),
  ], B, { seg: 28, vScale: 30 }));
  for (const s of [-1, 1]) {
    const P = (z, y) => ({ c: [s * 8.0, y, z], a: 3.5, b: 0.55, u: [1, 0, 0], v: [0, 1, 0], w: [['Spine1', 0.4], ['Spine2', 0.6]] });
    parts.camoTrim.push(tube([P(131, 10.2), P(139.5, 9.4)], B, { seg: 12, power: 6, capStart: true, capEnd: true, vScale: 30 }));
  }
  parts.skin.push(tube([ // neck
    T(151, 6.0, 6.0, -5.2, [['Neck', 1]]),
    T(157, 5.6, 5.8, -4.6, [['Neck', 0.5], ['Head', 0.5]]),
    T(161, 5.8, 6.2, -3.6, [['Head', 1]]),
  ], B, { seg: 20 }));

  // ---- arms (T-pose along x): sleeves with cuffs, skin hands ----
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'Left' : 'Right';
    const y = -5.8, z = 147.9;
    const A = (x, a, b, w, dy = 0, dz = 0) => ({ c: [s * x, y + dy, z + dz], a, b, u: [0, 1, 0], v: [0, 0, 1], w });
    const sleeve = [
      A(11, 6.2, 5.8, [['Spine2', 0.7], [`${side}Shoulder`, 0.3]], 0, -3.0),
      A(17, 6.4, 6.3, [[`${side}Shoulder`, 0.5], [`${side}Arm`, 0.5]], 0, -1.6),
      A(23, 6.0, 6.0, [[`${side}Arm`, 1]], 0, -0.4),
      A(32, 5.5, 5.6, [[`${side}Arm`, 1]]),
      A(40, 5.1, 5.1, [[`${side}Arm`, 0.75], [`${side}ForeArm`, 0.25]]),
      A(45, 5.0, 4.9, [[`${side}Arm`, 0.3], [`${side}ForeArm`, 0.7]]),
      A(52, 4.8, 4.6, [[`${side}ForeArm`, 1]]),
      A(61, 4.3, 4.1, [[`${side}ForeArm`, 1]]),
    ];
    parts.top.push(tube(sleeve, B, { seg: 22 }));
    parts.rib.push(tube([A(60.5, 4.3, 4.2, [[`${side}ForeArm`, 1]]), A(65.5, 3.9, 3.7, [[`${side}ForeArm`, 0.7], [`${side}Hand`, 0.3]])], B, { seg: 22, vScale: 3 }));
    parts.camoTop.push(tube(grow(sleeve, 0.35), B, { seg: 22, vScale: 30 }));
    parts.camoTrim.push(tube([A(60.5, 4.8, 4.6, [[`${side}ForeArm`, 1]]), A(64.8, 4.6, 4.4, [[`${side}ForeArm`, 0.75], [`${side}Hand`, 0.25]])], B, { seg: 22, vScale: 30 }));
    parts.camoTrim.push(tube([A(20, 3.0, 0.45, [[`${side}Arm`, 1]], 0, 5.9), A(27, 2.9, 0.45, [[`${side}Arm`, 1]], 0, 5.6)], B, { seg: 10, power: 6, capStart: true, capEnd: true, vScale: 30 })); // sleeve patch, flat on the arm
    parts.skin.push(tube([ // wrist and a relaxed, closed hand
      A(64, 3.2, 2.9, [[`${side}ForeArm`, 0.7], [`${side}Hand`, 0.3]]),
      A(68, 3.4, 2.5, [[`${side}Hand`, 1]]),
      A(73, 4.4, 2.3, [[`${side}Hand`, 1]], -0.4),
      A(79, 4.6, 2.1, [[`${side}Hand`, 1]], -0.6),
      A(83, 4.3, 1.9, [[`${side}Hand`, 0.6], [`${side}HandMiddle1`, 0.4]], -0.8, -0.3),
      A(87, 3.6, 1.6, [[`${side}HandMiddle1`, 0.5], [`${side}HandMiddle2`, 0.5]], -0.8, -0.7),
      A(90, 2.4, 1.2, [[`${side}HandMiddle2`, 1]], -0.8, -1.0),
    ], B, { seg: 18, capEnd: true }));
    parts.skin.push(tube([ // thumb
      { c: [s * 71, -4.6, 146.4], a: 1.5, b: 1.5, w: [[`${side}HandThumb1`, 1]] },
      { c: [s * 75.3, -2.5, 144.3], a: 1.3, b: 1.3, w: [[`${side}HandThumb1`, 0.5], [`${side}HandThumb2`, 0.5]] },
      { c: [s * 78.6, -1.2, 142.6], a: 1.0, b: 1.0, w: [[`${side}HandThumb2`, 1]] },
    ], B, { seg: 10, capEnd: true }));
  }

  // ---- legs ----
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'Left' : 'Right';
    const L = (z, a, b, w, dy = 0, dx = 0) => ({ c: [s * (9.8 + dx), 0.4 + dy, z], a, b, u: [1, 0, 0], v: [0, 1, 0], w });
    const thigh = [
      L(104, 9.0, 10.0, [['Hips', 0.6], [`${side}UpLeg`, 0.4]], -0.8, -0.6),
      L(96, 9.2, 10.4, [['Hips', 0.25], [`${side}UpLeg`, 0.75]], -0.8, -0.3),
      L(86, 8.4, 9.4, [[`${side}UpLeg`, 1]], -0.4),
      L(72, 7.2, 8.0, [[`${side}UpLeg`, 1]], 0.2),
      L(62, 6.4, 7.0, [[`${side}UpLeg`, 0.65], [`${side}Leg`, 0.35]], 0.8),
      L(55, 6.2, 6.8, [[`${side}UpLeg`, 0.2], [`${side}Leg`, 0.8]], 1.0),
      L(44, 6.0, 6.6, [[`${side}Leg`, 1]], 0.4),
    ];
    // jeans: straight leg to a slightly stacked hem
    parts.jeans.push(tube([...thigh,
      L(30, 5.7, 6.2, [[`${side}Leg`, 1]], -0.4),
      L(19, 5.8, 6.3, [[`${side}Leg`, 0.85], [`${side}Foot`, 0.15]], -0.9),
      L(13.5, 6.2, 6.8, [[`${side}Leg`, 0.6], [`${side}Foot`, 0.4]], -1.2),
    ], B, { seg: 24, vScale: 12 }));
    // combat trousers: a little looser, bloused over the boot tops, cargo pockets on the thighs
    parts.camoPants.push(tube([...grow(thigh, 0.5),
      L(34, 6.4, 6.9, [[`${side}Leg`, 1]], -0.4),
      L(27, 6.9, 7.4, [[`${side}Leg`, 0.9], [`${side}Foot`, 0.1]], -0.6),
      L(23.5, 6.0, 6.4, [[`${side}Leg`, 0.8], [`${side}Foot`, 0.2]], -0.7),
    ], B, { seg: 24, vScale: 30 }));
    const Pk = (z) => ({ c: [s * (9.8 + 8.6), 0.6, z], a: 4.2, b: 1.2, u: [0, 1, 0], v: [1, 0, 0], w: [[`${side}UpLeg`, 1]] });
    parts.camoTrim.push(tube([Pk(80), Pk(68)], B, { seg: 12, power: 6, capStart: true, capEnd: true, vScale: 30 }));
    // trainer: a rounded box swept from heel to toe, white upper over a grey sole
    const F = (y, a, zc, h, w) => ({ c: [s * (9.9 + y * 0.12), y, zc], a, b: h, u: [1, 0, 0], v: [0, 0, 1], w });
    parts.shoe.push(tube([
      F(-10.5, 4.0, 6.0, 4.6, [[`${side}Foot`, 1]]),
      F(-8.5, 4.8, 6.6, 5.6, [[`${side}Foot`, 1]]),
      F(-3, 5.0, 6.8, 6.2, [[`${side}Foot`, 1]]),
      F(3, 5.2, 5.6, 5.0, [[`${side}Foot`, 0.8], [`${side}ToeBase`, 0.2]]),
      F(9, 5.2, 4.2, 3.6, [[`${side}Foot`, 0.4], [`${side}ToeBase`, 0.6]]),
      F(14, 4.8, 3.6, 3.0, [[`${side}ToeBase`, 1]]),
      F(17.5, 3.6, 3.4, 2.6, [[`${side}ToeBase`, 1]]),
    ], B, { seg: 20, capStart: true, capEnd: true, power: 3 }));
    parts.sole.push(tube([
      F(-11, 4.4, 1.1, 1.1, [[`${side}Foot`, 1]]),
      F(-3, 5.3, 1.1, 1.1, [[`${side}Foot`, 1]]),
      F(9, 5.5, 1.1, 1.1, [[`${side}Foot`, 0.4], [`${side}ToeBase`, 0.6]]),
      F(18, 3.9, 1.1, 1.1, [[`${side}ToeBase`, 1]]),
    ], B, { seg: 16, capStart: true, capEnd: true, power: 4 }));
    // combat boot: a shaft up the shin, a chunky foot, a deep lugged sole
    parts.boot.push(tube([
      L(26, 5.6, 6.0, [[`${side}Leg`, 0.85], [`${side}Foot`, 0.15]], -0.8),
      L(18, 5.4, 5.8, [[`${side}Leg`, 0.6], [`${side}Foot`, 0.4]], -1.2),
      L(11, 5.6, 6.4, [[`${side}Foot`, 1]], -1.6),
    ], B, { seg: 22, capStart: true }));
    parts.boot.push(tube([
      F(-11, 4.3, 6.2, 5.0, [[`${side}Foot`, 1]]),
      F(-8.5, 5.2, 7.0, 6.2, [[`${side}Foot`, 1]]),
      F(-2, 5.4, 7.0, 6.6, [[`${side}Foot`, 1]]),
      F(4, 5.6, 5.8, 5.4, [[`${side}Foot`, 0.8], [`${side}ToeBase`, 0.2]]),
      F(10, 5.6, 4.6, 4.0, [[`${side}Foot`, 0.4], [`${side}ToeBase`, 0.6]]),
      F(15, 5.2, 4.2, 3.4, [[`${side}ToeBase`, 1]]),
      F(18.4, 3.9, 4.0, 3.0, [[`${side}ToeBase`, 1]]),
    ], B, { seg: 20, capStart: true, capEnd: true, power: 3 }));
    parts.bootSole.push(tube([
      F(-11.6, 4.7, 1.4, 1.4, [[`${side}Foot`, 1]]),
      F(-3, 5.7, 1.4, 1.4, [[`${side}Foot`, 1]]),
      F(10, 5.9, 1.4, 1.4, [[`${side}Foot`, 0.4], [`${side}ToeBase`, 0.6]]),
      F(19, 4.2, 1.4, 1.4, [[`${side}ToeBase`, 1]]),
    ], B, { seg: 16, capStart: true, capEnd: true, power: 4 }));
  }

  // ---- head: a jaw that narrows, a small nose, lips, eyes with whites, ears, brows, short hair ----
  const H = [0, -3.2, 170.5], HR = [7.9, 9.7, 11.6];
  const jaw = (x, y, z) => (z < 0 ? [x * (1 - 0.24 * -z), y * (1 - 0.06 * -z), z] : [x, y, z * (1 - 0.04 * Math.max(0, -y))]);
  parts.skin.push(ellipsoid(H, HR, B.Head, { seg: 32, rows: 24, deform: jaw }));
  const front = (z) => H[1] + HR[1] * Math.sqrt(Math.max(0, 1 - ((z - H[2]) / HR[2]) ** 2)) * (z < H[2] ? 1 - 0.06 * ((H[2] - z) / HR[2]) : 1);
  parts.skin.push(ellipsoid([0, front(168.6) + 0.5, 168.6], [1.05, 1.5, 2.1], B.Head, { seg: 12, rows: 10 })); // nose
  parts.skin.push(ellipsoid([0, front(166.4) + 0.4, 166.4], [1.6, 0.9, 0.8], B.Head, { seg: 12, rows: 8 }));  // nose tip / nostrils
  parts.lip.push(ellipsoid([0, front(163.6) + 0.15, 163.6], [2.5, 0.75, 0.62], B.Head, { seg: 16, rows: 8 }));  // lips
  for (const s of [-1, 1]) {
    parts.skin.push(ellipsoid([s * 8.0, -3.6, 170], [1.0, 2.2, 3.2], B.Head, { seg: 12, rows: 10 })); // ears
    parts.sclera.push(ellipsoid([s * 3.1, front(171.3) - 0.55, 171.3], [1.25, 0.5, 0.72], B.Head, { seg: 12, rows: 8 }));
    parts.dark.push(ellipsoid([s * 3.1, front(171.3) - 0.2, 171.3], [0.62, 0.32, 0.62], B.Head, { seg: 10, rows: 8 })); // irises
    parts.hair.push(ellipsoid([s * 3.2, front(173.6) - 0.15, 173.6], [1.9, 0.45, 0.42], B.Head, { seg: 10, rows: 6 })); // brows
  }
  parts.hair.push(ellipsoid([H[0], H[1] - 0.3, H[2] + 0.4], [HR[0] * 1.06, HR[1] * 1.05, HR[2] * 1.05], B.Head,
    { keep: (x, y, z) => z > 0.05 - (y < 0 ? 0.55 * -y : -0.15 * y) && !(y > 0.55 && z < 0.55) }));
  // beret: a band that hugs the head, a soft crown that balloons over and droops to the right
  const Rb = (z, a, b, dx = 0) => ({ c: [dx, H[1] - 0.4, z], a, b, u: [1, 0, 0], v: [0, 1, 0], w: [['Head', 1]] });
  parts.beret.push(tube([
    Rb(176.4, 7.3, 8.9),
    Rb(178.0, 8.6, 10.0, -0.6),
    Rb(180.0, 9.6, 10.8, -1.4),
    Rb(182.2, 8.8, 9.8, -1.8),
    Rb(183.7, 5.6, 6.4, -1.4),
    Rb(184.3, 1.2, 1.4, -1.0),
  ], B, { seg: 32, capStart: true, capEnd: true }));
  parts.badge.push(ellipsoid([-3.0, H[1] - 0.4 + 10.2, 178.4], [1.2, 0.5, 1.5], B.Head, { seg: 10, rows: 8 }));

  // ---- materials ----
  const mats = {
    skin: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    lip: new THREE.MeshStandardMaterial({ roughness: 0.45 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.95 }),
    sclera: new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.15 }),
    top: new THREE.MeshStandardMaterial({ map: fleeceTex(), roughness: 0.92 }),
    rib: new THREE.MeshStandardMaterial({ map: ribTex(), roughness: 0.9 }),
    jeans: new THREE.MeshStandardMaterial({ map: denimTex(), roughness: 0.85 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.55 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.8 }),
    camoTop: new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    camoTrim: new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    camoPants: new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.45, metalness: 0.05 }),
    bootSole: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x3b3a2c, roughness: 0.85 }),
    beret: new THREE.MeshStandardMaterial({ color: 0x2f3b24, roughness: 0.95 }),
    badge: new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 }),
  };
  mats.top.map.repeat.set(3, 1.2);
  mats.rib.map.repeat.set(10, 1);
  const order = Object.keys(parts).filter((k) => parts[k].length);
  const geo = mergeGeometries(order.map((k) => mergeGeometries(parts[k])), true);
  const mesh = new THREE.SkinnedMesh(geo, order.map((k) => mats[k]));
  mesh.name = 'player_body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.bind(skel, bindMatrix);

  const CASUAL = ['top', 'rib', 'jeans', 'shoe', 'sole'];
  const UNIFORM = ['camoTop', 'camoTrim', 'camoPants', 'boot', 'bootSole', 'belt', 'beret', 'badge'];
  const setLook = (l) => {
    const pick = (table, key, fallback) => table[key] ?? table[fallback];
    const military = (l.outfit ?? DEFAULT_LOOK.outfit) === 'Military uniform';
    for (const k of CASUAL) mats[k].visible = !military;
    for (const k of UNIFORM) mats[k].visible = military;
    const camo = CAMO[l.camo] ? l.camo : DEFAULT_LOOK.camo;
    const tex = camoTex(camo);
    for (const k of ['camoTop', 'camoTrim', 'camoPants']) { mats[k].map = tex; mats[k].needsUpdate = true; }
    mats.camoTrim.color.setScalar(0.85);
    mats.boot.color.set(camo === 'Desert' ? 0x8a6a45 : 0x1c1b19);
    mats.beret.color.set(camo === 'Desert' ? 0x5b1a20 : camo === 'Urban' ? 0x1b1d22 : 0x2f3b24);
    mats.top.color.set(pick(LOOKS.top, l.top, DEFAULT_LOOK.top));
    mats.rib.color.set(pick(LOOKS.top, l.top, DEFAULT_LOOK.top)).multiplyScalar(0.88);
    mats.jeans.color.set(pick(LOOKS.jeans, l.jeans, DEFAULT_LOOK.jeans));
    const skin = pick(LOOKS.skin, l.skin, DEFAULT_LOOK.skin);
    mats.skin.color.set(skin);
    mats.lip.color.set(skin).multiplyScalar(0.72);
  };
  setLook(look);
  return { mesh, setLook };
}
