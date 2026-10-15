import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { label } from '../materials.js';

// Building kit for the Kent set pieces (house.js, airfield.js): the mansion's B / C / plane /
// wallZ / wallX helpers, but every static box lands in a per-material batch that flush()
// merges into one mesh, so a furnished house is a few dozen draw calls instead of a few hundred.
//
// Node-safe on purpose: nothing here touches the DOM or assets.js at import time, so the
// tools/house-check.mjs script can build the set pieces headless. Textures come in through
// `pbr` (assets.js's pbr) when the game passes it; without it everything is flat colour.

/** label() needs a canvas; in node it throws, and the sprite is simply skipped. */
export function tryLabel(text, opts) {
  try { return label(text, opts); } catch { return null; }
}

/** A canvas texture, or null where there is no document (node). */
export function canvasTex(w, h, draw, { repeat = null } = {}) {
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    return t;
  } catch { return null; }
}

// BoxGeometry lays its 24 vertices out four per face: +x, -x, +y, -y, +z, -z.
// Scale each face's UVs by its real size so a texture tiles per metre whatever the box size.
export function boxGeo(w, h, d, k = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (k) {
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const uv = g.attributes.uv;
    for (let i = 0; i < 24; i++) {
      const [fu, fv] = dims[i >> 2];
      uv.setXY(i, uv.getX(i) * fu * k, uv.getY(i) * fv * k);
    }
  }
  return g;
}

/** Flat plane (w along x, d along z), UVs tiled per metre, lying on the ground. */
export function planeGeo(w, d, k = 0) {
  const g = new THREE.PlaneGeometry(w, d);
  if (k) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * k, uv.getY(i) * d * k);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Solid wall runs between door gaps: gaps = [[a, b, doorHeight?], ...]. */
export function segs(a0, a1, gaps) {
  const out = [];
  let cur = a0;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) { if (a > cur) out.push([cur, a]); cur = Math.max(cur, b); }
  if (a1 > cur) out.push([cur, a1]);
  return out;
}

/**
 * makeKit({ group, colliders, origin, pbr }) -> helpers that build into `group` (positioned at
 * origin) and add colliders in WORLD coordinates. Register materials with mat(key, material,
 * { k, cast }) then build with B / C / plane / wallZ / wallX, and call flush() once at the end.
 */
export function makeKit({ group, colliders, origin, pbr = null }) {
  const O = origin;
  const mats = new Map();   // key -> { material, k, cast }
  const batches = new Map(); // key -> geometries

  const std = (color, roughness = 0.7, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  /** PBR set from assets.js when available (tiles once per 1/k metres), else a flat colour. */
  const tex = (name, color, { roughness = 0.9, ...opts } = {}) => (pbr ? pbr(name, { repeat: [1, 1], color, ...opts }) : std(color, roughness));

  const mat = (key, material, { k = 0.5, cast = true } = {}) => { mats.set(key, { material, k, cast }); return material; };
  const get = (key) => {
    const m = mats.get(key);
    if (!m) throw new Error(`kit: unknown material '${key}'`);
    return m;
  };
  const push = (key, geo) => {
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(geo);
  };

  // box with its BASE at y; optional collider (world coords); rx/ry/rz rotate about its own centre
  const B = (w, h, d, x, y, z, key, { collide = false, carOnly = false, pad = 0, rx = 0, ry = 0, rz = 0 } = {}) => {
    const g = boxGeo(w, h, d, get(key).k);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y + h / 2, z);
    push(key, g);
    if (collide) colliders.box(O.x + x, O.z + z, Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d, Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d, pad, carOnly);
  };
  const C = (rTop, rBot, h, x, y, z, key, seg = 20, { collide = false, carOnly = false } = {}) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    g.translate(x, y + h / 2, z);
    push(key, g);
    if (collide) colliders.box(O.x + x, O.z + z, Math.max(rTop, rBot) * 2, Math.max(rTop, rBot) * 2, 0, carOnly);
  };
  const S = (r, x, y, z, key, w = 10, h = 7) => { const g = new THREE.SphereGeometry(r, w, h); g.translate(x, y, z); push(key, g); };
  const plane = (w, d, x, y, z, key) => { const g = planeGeo(w, d, get(key).k); g.translate(x, y, z); push(key, g); };
  /** any geometry into a batch (already positioned) */
  const raw = (geo, key) => push(key, geo);

  // walls with door gaps and a lintel over each gap; gaps = [[a, b, doorH?]]; collide: false for
  // upstairs walls that sit over a ground-floor wall (the 2D colliders are shared)
  const wallZ = (z, x0, x1, h, key, gaps = [], { dh = 2.2, y0 = 0, t = 0.4, collide = true } = {}) => {
    for (const [a, b] of segs(x0, x1, gaps)) B(b - a, h, t, (a + b) / 2, y0, z, key, { collide });
    for (const [a, b, d = dh] of gaps) if (h > d) B(b - a, h - d, t, (a + b) / 2, y0 + d, z, key);
  };
  const wallX = (x, z0, z1, h, key, gaps = [], { dh = 2.2, y0 = 0, t = 0.4, collide = true } = {}) => {
    for (const [a, b] of segs(z0, z1, gaps)) B(t, h, b - a, x, y0, (a + b) / 2, key, { collide });
    for (const [a, b, d = dh] of gaps) if (h > d) B(t, h - d, b - a, x, y0 + d, (a + b) / 2, key);
  };

  /** a mesh of its own (animated or special material); position it yourself */
  const solo = (geo, material, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast && !material.transparent;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  /** merge every batch into one mesh per material */
  const flush = () => {
    const out = [];
    for (const [key, list] of batches) {
      const { material, cast } = get(key);
      const geo = list.length === 1 ? list[0] : mergeGeometries(list);
      if (!geo) throw new Error(`kit: could not merge batch '${key}'`);
      const m = new THREE.Mesh(geo, material);
      m.name = `batch:${key}`;
      m.castShadow = cast && !material.transparent;
      m.receiveShadow = true;
      group.add(m);
      out.push(m);
    }
    batches.clear();
    return out;
  };

  return { std, tex, mat, B, C, S, plane, raw, wallZ, wallX, solo, flush, O };
}
