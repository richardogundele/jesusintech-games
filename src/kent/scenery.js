import * as THREE from 'three';
import { facadeMaterial, waterMaterial, worldMappedMaterial } from '../materials.js';
import { drapeGeometry } from '../worlds/terrain.js';
import { PAVE_W, KERB_W } from './markings.js';

// Kent scenery: everything in a tile that is not road, sign or traffic. Buildings from OSM
// footprints, fields, hedges, trees, lamps, railways, the sea and cliffs, and a few landmarks.
// Each tile builds into its own group and disposes cleanly, so tiles can stream in and out.
// Coordinates: x east, z south, y up, metres. Conventions follow DESIGN.md sections 0 and 4.

// assets.js reads import.meta.env when it loads, which only exists under Vite. Load it lazily so
// the geometry side of this module also runs under plain node (the fixture check); without it,
// plain colours stand in for the Poly Haven textures and the lamp model.
let A = null;
import('../assets.js').then((m) => { A = m; }).catch(() => {});

export const TILE = 500;
// Herne Bay's seafront is a sea-level promenade; from Beltinge east the land stands on a clay
// cliff. The sea floor steps down between these x values so the two join without a wall.
const CLIFF_X0 = 2400, CLIFF_X1 = 2700;
const SEA_SHELF = -0.3, SEA_DEEP = -18;
const BEACH_W = 25, SEA_WALL_H = 1.5;
const LAMP_EVERY = 34, HEDGE_LEN = 7, PAVE = 2.0;
const FRONT_W = 5.4, FRONT_H = 6; // the canvas fronts are drawn for a 5.4 x 6 m face
const MAX_TREES = { near: 1400, far: 700 };

export const seaLevelAt = (x) => (x <= CLIFF_X0 ? SEA_SHELF : x >= CLIFF_X1 ? SEA_DEEP : SEA_SHELF + ((SEA_DEEP - SEA_SHELF) * (x - CLIFF_X0)) / (CLIFF_X1 - CLIFF_X0));

// ---------- small maths ----------
const hasDOM = typeof document !== 'undefined';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const tileSeed = (tx, tz) => ((tx * 73856093) ^ (tz * 19349663) ^ 0x9e3779b9) >>> 0;
const tileKey = (tx, tz) => `${tx},${tz}`;
const hash2 = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };

function signedArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
/** clockwise in (x, z) so wall quads built in order face outward */
const ensureCW = (poly) => (signedArea(poly) > 0 ? poly.slice().reverse() : poly);
function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}
function bboxOf(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, z0, x1, z1 };
}
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Sutherland-Hodgman clip of a polygon to an axis-aligned rectangle. */
function clipRect(poly, r) {
  const half = (pts, inside, cut) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(cut(a, b)); out.push(b); } else if (ia) out.push(cut(a, b));
    }
    return out;
  };
  const lerpX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpZ = (a, b, z) => [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z];
  let p = half(poly, (q) => q[0] >= r.x0, (a, b) => lerpX(a, b, r.x0));
  if (p.length) p = half(p, (q) => q[0] <= r.x1, (a, b) => lerpX(a, b, r.x1));
  if (p.length) p = half(p, (q) => q[1] >= r.z0, (a, b) => lerpZ(a, b, r.z0));
  if (p.length) p = half(p, (q) => q[1] <= r.z1, (a, b) => lerpZ(a, b, r.z1));
  return p.length >= 3 ? p : null;
}
/** Polyline clipped to a rectangle: an array of sub-polylines (Liang-Barsky per segment). */
function clipPolyline(pts, r) {
  const out = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dz, a[1] - r.z0], [dz, r.z1 - a[1]]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    const A = [a[0] + dx * t0, a[1] + dz * t0], B = [a[0] + dx * t1, a[1] + dz * t1];
    if (cur && t0 === 0) cur.push(B);
    else { cur = [A, B]; out.push(cur); }
    if (t1 < 1) cur = null;
  }
  return out.filter((l) => l.length >= 2);
}
/** Minimum-area oriented box of a footprint: { cx, cz, w, d, yaw } with yaw = three.js rotation.y. */
function obbFit(poly) {
  let best = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ux = dx / L, uz = dz / L, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of poly) {
      const u = p[0] * ux + p[1] * uz, v = p[0] * vx + p[1] * vz;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) { const c = centroid(poly); return { cx: c[0], cz: c[1], w: 1, d: 1, yaw: 0, area: 1 }; }
  const { ux, uz, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  // local +x -> (ux, uz), local +z -> (-uz, ux)  (rotation.y = yaw)
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, w: u1 - u0, d: v1 - v0, yaw: Math.atan2(-uz, ux), area: best.area };
}
/** Inset a clockwise polygon by d (miter joins). null when the result folds over itself. */
function insetPoly(poly, d) {
  const n = poly.length, out = [];
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    nrm.push([ez / L, -ex / L]); // inward for clockwise
  }
  for (let i = 0; i < n; i++) {
    const n1 = nrm[(i + n - 1) % n], n2 = nrm[i];
    const k = d / Math.max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([poly[i][0] + (n1[0] + n2[0]) * k, poly[i][1] + (n1[1] + n2[1]) * k]);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = out[i], e = out[(i + 1) % n];
    if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 0) return null; // an edge flipped
  }
  return Math.abs(signedArea(out)) > 0.15 * Math.abs(signedArea(poly)) ? out : null;
}
const toV2 = (poly) => poly.map((p) => new THREE.Vector2(p[0], p[1]));

// ---------- a merged-geometry builder (flat normals, optional uv / colour) ----------
class GB {
  constructor({ uv = true, color = true } = {}) { this.p = []; this.n = []; this.uv = []; this.c = []; this.hasUV = uv; this.hasColor = color; }
  get tris() { return this.p.length / 9; }
  tri(a, b, c, col, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    if (this.hasUV) { const p = ua || [0, 0], q = ub || [0, 0], r = uc || [0, 0]; this.uv.push(p[0], p[1], q[0], q[1], r[0], r[1]); }
    if (this.hasColor) { const r = col.r, g = col.g, bb = col.b; this.c.push(r, g, bb, r, g, bb, r, g, bb); }
  }
  quad(a, b, c, d, col, uvs) { this.tri(a, b, c, col, uvs?.[0], uvs?.[1], uvs?.[2]); this.tri(a, c, d, col, uvs?.[0], uvs?.[2], uvs?.[3]); }
  /** box with its base at y0; yaw = rotation.y; local x spans w, local z spans d */
  box(cx, y0, cz, w, h, d, yaw, col, { top = true } = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, ly, lz) => [cx + lx * c + lz * s, y0 + ly, cz - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    this.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), col);
    this.quad(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), col);
    this.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), col);
    this.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), col);
    if (top) this.quad(P(-hw, h, -hd), P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), col);
  }
  /** walls of a clockwise footprint from y0 to y0 + h */
  walls(poly, y0, h, col) {
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + h, b[1]], [a[0], y0 + h, a[1]], col);
    }
  }
  /** flat cap over a footprint at height y, facing up */
  cap(poly, y, col) {
    const tris = THREE.ShapeUtils.triangulateShape(toV2(poly), []);
    for (const [i, j, k] of tris) {
      const a = [poly[i][0], y, poly[i][1]], b = [poly[j][0], y, poly[j][1]], c = [poly[k][0], y, poly[k][1]];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny >= 0) this.tri(a, b, c, col); else this.tri(a, c, b, col);
    }
  }
  /** hipped roof: slopes from the eaves outline up to an inset ridge polygon */
  hip(poly, yEaves, roofH, inset, col) {
    let q = null, d = inset;
    for (let k = 0; k < 3 && !q; k++, d /= 2) q = insetPoly(poly, d);
    if (!q) { this.cap(poly, yEaves, col); return; }
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], c = q[(i + 1) % n], e = q[i];
      this.quad([a[0], yEaves, a[1]], [b[0], yEaves, b[1]], [c[0], yEaves + roofH, c[1]], [e[0], yEaves + roofH, e[1]], col);
    }
    this.cap(q, yEaves + roofH, col);
  }
  /** flat ribbon between two parallel offsets of a polyline, y per point */
  ribbon(pts, off0, off1, yAt, col, seaward = 1) {
    const L = pts.length;
    if (L < 2) return;
    const side = [];
    for (let i = 0; i < L; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(L - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
      side.push([(dz / m) * seaward, (-dx / m) * seaward]); // right of travel, flipped when the sea is on the left
    }
    for (let i = 0; i < L - 1; i++) {
      const p = pts[i], q = pts[i + 1], sp = side[i], sq = side[i + 1];
      const y0 = yAt(p[0]), y1 = yAt(q[0]);
      const a = [p[0] + sp[0] * off0, y0, p[1] + sp[1] * off0], b = [q[0] + sq[0] * off0, y1, q[1] + sq[1] * off0];
      const c = [q[0] + sq[0] * off1, y1, q[1] + sq[1] * off1], d = [p[0] + sp[0] * off1, y0, p[1] + sp[1] * off1];
      // keep the quad facing up whichever way the offsets go
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny >= 0) this.quad(a, b, c, d, col); else this.quad(a, d, c, b, col);
    }
  }
  /** vertical strip along a polyline at a lateral offset, between two heights (functions of x) */
  wall(pts, off, yTop, yBot, col, seaward = 1, lean = 0) {
    const L = pts.length;
    if (L < 2) return;
    const side = [];
    for (let i = 0; i < L; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(L - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
      side.push([(dz / m) * seaward, (-dx / m) * seaward]);
    }
    for (let i = 0; i < L - 1; i++) {
      const p = pts[i], q = pts[i + 1], sp = side[i], sq = side[i + 1];
      const a = [p[0] + sp[0] * (off + lean), yBot(p[0]), p[1] + sp[1] * (off + lean)], b = [q[0] + sq[0] * (off + lean), yBot(q[0]), q[1] + sq[1] * (off + lean)];
      const c = [q[0] + sq[0] * off, yTop(q[0]), q[1] + sq[1] * off], d = [p[0] + sp[0] * off, yTop(p[0]), p[1] + sp[1] * off];
      // face the sea: normal should point along `side`
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (nx * sp[0] + nz * sp[1] >= 0) this.quad(a, b, c, d, col); else this.quad(a, d, c, b, col);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.hasUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- canvas textures (copied from uk.js so this module does not reach into its internals) ----------
function canvas(w, h, draw) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function bricks(ctx, x0, y0, w, h, base, scale = 1) {
  const bw = 22 * scale, bh = 7.5 * scale;
  ctx.fillStyle = '#b9b0a2';
  ctx.fillRect(x0, y0, w, h);
  const [r, g, b] = base;
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    for (let x = x0 - ((row % 2) * bw) / 2; x < x0 + w; x += bw) {
      const k = rnd(-18, 18);
      ctx.fillStyle = `rgb(${r + k},${g + k * 0.7},${b + k * 0.5})`;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
}
const BRICKS = [[150, 70, 52], [128, 64, 48], [168, 98, 66], [112, 58, 46]];
function sash(ctx, x, y, w, h) {
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#5a6b7c'); g.addColorStop(0.5, '#2a3542'); g.addColorStop(1, '#4b5a68');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(x, y + h / 2 - 3, w, 6);
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillStyle = '#d8d2c4';
  ctx.fillRect(x - 8, y + h + 4, w + 16, 8); // sill
}
/** A terraced house front, 512 x 576 px for a 5.4 x 6 m face, drawn at (ox, oy). */
function houseFront(ctx, ox, oy, base, door) {
  const w = 512, h = 576;
  ctx.save(); ctx.translate(ox, oy);
  bricks(ctx, 0, 0, w, h, base, 1.0);
  sash(ctx, 70, 70, 130, 170);
  sash(ctx, 310, 70, 130, 170);
  ctx.fillStyle = '#efece4'; // bay window
  ctx.fillRect(30, 300, 250, 230);
  sash(ctx, 50, 330, 64, 170); sash(ctx, 124, 330, 64, 170); sash(ctx, 198, 330, 64, 170);
  ctx.fillStyle = '#efece4'; // door + fanlight
  ctx.fillRect(320, 300, 150, 276);
  ctx.fillStyle = door;
  ctx.fillRect(338, 360, 114, 216);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(352, 380, 86, 80); ctx.strokeRect(352, 476, 86, 80);
  ctx.fillStyle = '#c9a25a';
  ctx.beginPath(); ctx.arc(440, 470, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a4756';
  ctx.fillRect(338, 316, 114, 36);
  ctx.fillStyle = '#d8d2c4';
  ctx.fillRect(0, 286, w, 10); // string course
  ctx.restore();
}
function shopFront(ctx, ox, oy, base, fascia, name, ink = '#ffffff') {
  const w = 512;
  ctx.save(); ctx.translate(ox, oy);
  bricks(ctx, 0, 0, w, 576, base, 1.0);
  sash(ctx, 70, 60, 130, 160);
  sash(ctx, 310, 60, 130, 160);
  ctx.fillStyle = fascia;
  ctx.fillRect(0, 280, w, 64);
  ctx.fillStyle = ink;
  ctx.font = '700 40px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, 313, w - 30);
  ctx.fillStyle = fascia;
  ctx.fillRect(0, 344, w, 232);
  const g = ctx.createLinearGradient(0, 360, 0, 560);
  g.addColorStop(0, '#2c3a46'); g.addColorStop(1, '#55697a');
  ctx.fillStyle = g;
  ctx.fillRect(22, 362, 300, 196);
  ctx.fillRect(352, 362, 136, 214);
  ctx.fillStyle = 'rgba(255,230,180,0.35)'; // warm shop lights
  ctx.fillRect(22, 362, 300, 50);
  ctx.restore();
}
function plateTex(text) {
  return canvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#111'; ctx.font = '700 64px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4, w - 40);
  });
}
function fasciaTex(text, bg, ink) {
  return canvas(1024, 192, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink; ctx.font = '800 120px Helvetica Neue, Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 6, w - 60);
  });
}
function clockTex() {
  return canvas(256, 256, (ctx) => {
    ctx.fillStyle = '#f4efe2'; ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#2a2622';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.fillRect(128 + Math.cos(a) * 100 - 4, 128 + Math.sin(a) * 100 - 4, 8, 8); }
    ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + 50, 128 - 40); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 - 20, 128 - 80); ctx.stroke();
  });
}
const SHOPS = [['Bakery', '#3b2a1a', '#f3e6c8'], ['Post Office', '#c8102e'], ['Pharmacy', '#0f6b4f'], ['The Ship Inn', '#1d2b22', '#d8b25a'],
  ['Fish & Chips', '#1f4e8c'], ['Barbers', '#222222'], ['Café Rosa', '#7a1f2b'], ['Newsagent', '#2b4a6f'], ['Charity Shop', '#5a2a6a'], ['Estate Agents', '#0b0d12', '#e8c77a']];
const DOORS = ['#1f3a5f', '#7a1f2b', '#2f5d3a', '#111111', '#e9e1cf', '#2b6f8a'];
const ATLAS = { cols: 4, rows: 4, houses: 6, shops: SHOPS.length };
/** One atlas with six house fronts and ten shop fronts, so every front in a tile is one draw call. */
function frontsAtlas() {
  return canvas(512 * ATLAS.cols, 576 * ATLAS.rows, (ctx) => {
    for (let i = 0; i < ATLAS.houses; i++) houseFront(ctx, (i % ATLAS.cols) * 512, Math.floor(i / ATLAS.cols) * 576, BRICKS[i % BRICKS.length], DOORS[i]);
    SHOPS.forEach(([name, fascia, ink], j) => {
      const k = ATLAS.houses + j;
      shopFront(ctx, (k % ATLAS.cols) * 512, Math.floor(k / ATLAS.cols) * 576, BRICKS[(j + 1) % BRICKS.length], fascia, name, ink);
    });
  });
}
function brickTexture() {
  const t = canvas(256, 256, (ctx, w, h) => bricks(ctx, 0, 0, w, h, [200, 196, 190], 1.2));
  if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const BRANDS = [
  ['tesco', '#00539f', '#ffffff'], ['sainsbury', '#f06c00', '#ffffff'], ['aldi', '#00457c', '#ffffff'], ['lidl', '#fff200', '#0050aa'],
  ['morrisons', '#00703c', '#ffd200'], ['co-op', '#00b1e7', '#ffffff'], ['co-operative', '#00b1e7', '#ffffff'], ['m&s', '#0f3d2e', '#ffffff'],
  ['marks', '#0f3d2e', '#ffffff'], ['waitrose', '#6ab023', '#ffffff'], ['asda', '#78be20', '#ffffff'], ['spar', '#d31f26', '#ffffff'],
  ['iceland', '#d6001c', '#ffffff'], ['esso', '#cf142b', '#ffffff'], ['bp', '#009a44', '#ffe600'], ['shell', '#dd1d21', '#fbce07'],
  ['jet', '#0033a0', '#ffd100'], ['valero', '#2b5797', '#ffffff'], ['texaco', '#d91f26', '#ffffff'], ['gulf', '#f26522', '#1a2b6d'],
];
function brandColours(name) {
  const n = (name || '').toLowerCase();
  const hit = BRANDS.find(([k]) => n.includes(k));
  return hit ? { bg: hit[1], ink: hit[2] } : { bg: '#2b2b2b', ink: '#ffffff' };
}

// ---------- shared materials and geometries (made once, never disposed per tile) ----------
let S = null;
function shared() {
  if (S) return S;
  const tryPbr = (name, opts, fallback) => { try { return A.pbr(name, opts); } catch { return new THREE.MeshStandardMaterial({ color: fallback, roughness: 1 }); } };
  // real surfaces where the sets exist (a node run has none; it falls back to flat colour)
  const set = (name) => { try { return A.texSet?.(name) || null; } catch { return null; } };
  const plaster = set('painted_plaster_wall'), tiles = set('clay_roof_tiles_02'), leaf = set('leafy_grass');
  const brick = facadeMaterial({ winSize: [2.2, 2.9], amount: 0.8, roughness: 0.92, frame: 0xf2efe8, texScale: 0.5 });
  const brickTex = brickTexture();
  if (brickTex) brick.map = brickTex; // the facade shader maps it in world space
  // rendered walls: flats, shops and the non-brick houses get a plaster texture instead of a flat
  // fill, so a street of them stops reading as painted boxes
  const plain = facadeMaterial({ winSize: [2.4, 3.0], amount: 0.85, roughness: 0.85, frame: 0xe8e4dc, tex: plaster, texScale: 0.35 });
  const walls = facadeMaterial({ winSize: [2.2, 2.9], amount: 0.75, roughness: 0.9, frame: 0xf2efe8, tex: plaster, texScale: 0.35 });
  walls.vertexColors = true;
  const atlas = frontsAtlas();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  // gable prism: base 1 x 1 at y 0, ridge at y 1 along local z
  const gb = new GB({ uv: false, color: false });
  const w = new THREE.Color(1, 1, 1);
  gb.quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5], w);
  gb.quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [0, 1, 0.5], [0, 1, -0.5], w);
  gb.tri([-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 1, 0.5], w);
  gb.tri([0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 1, -0.5], w);
  const gable = gb.build();
  // A broadleaf tree: a trunk that forks, and a crown of seven overlapping lobes at one level of
  // subdivision, jittered so the silhouette is ragged rather than three balls on a stick. The old
  // three-blob crown was the single thing that most made the world read as a tech demo. Still one
  // geometry, still instanced, ~560 triangles.
  const tg = new GB({ uv: false, color: true });
  const trunkCol = new THREE.Color(0x4e3b2a), crownCol = new THREE.Color(0x4a6e34), crownLight = new THREE.Color(0x5e8540);
  const addGeo = (geo, col) => { const p = geo.toNonIndexed().attributes.position; for (let i = 0; i < p.count; i += 3) tg.tri([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], col); };
  addGeo(new THREE.CylinderGeometry(0.16, 0.34, 3.6, 7, 1, true).translate(0, 1.8, 0), trunkCol);
  addGeo(new THREE.CylinderGeometry(0.08, 0.15, 2.2, 5, 1, true).rotateZ(0.5).translate(0.55, 4.0, 0.2), trunkCol);
  addGeo(new THREE.CylinderGeometry(0.08, 0.15, 2.0, 5, 1, true).rotateZ(-0.45).rotateY(1.2).translate(-0.45, 4.1, -0.3), trunkCol);
  const lobes = [[0, 5.6, 0, 2.3], [1.5, 5.0, 0.6, 1.7], [-1.4, 5.2, -0.4, 1.8], [0.4, 4.4, -1.5, 1.6], [-0.6, 4.6, 1.5, 1.5], [0.9, 6.8, -0.3, 1.5], [-0.9, 6.5, 0.7, 1.4]];
  lobes.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { // ragged edge: push each vertex in or out a little
      const j = 0.82 + 0.3 * Math.abs(Math.sin(k * 12.9898 + i * 78.233));
      p.setXYZ(k, p.getX(k) * j, p.getY(k) * (0.9 + 0.15 * j), p.getZ(k) * j);
    }
    addGeo(g.translate(x, y, z), i % 3 === 0 ? crownLight : crownCol);
  });
  const tree = tg.build();
  // street lamp: tapered post, short arm, lantern (about 36 triangles)
  const lg = new GB({ uv: false, color: true });
  const postCol = new THREE.Color(0x4f5459), lanternCol = new THREE.Color(0xf1ead2);
  const post = new THREE.CylinderGeometry(0.06, 0.11, 8, 6, 1, true).translate(0, 4, 0).toNonIndexed();
  const pp = post.attributes.position;
  for (let i = 0; i < pp.count; i += 3) lg.tri([pp.getX(i), pp.getY(i), pp.getZ(i)], [pp.getX(i + 1), pp.getY(i + 1), pp.getZ(i + 1)], [pp.getX(i + 2), pp.getY(i + 2), pp.getZ(i + 2)], postCol);
  lg.box(0, 7.75, 0.7, 0.1, 0.1, 1.4, 0, postCol);
  lg.box(0, 7.6, 1.35, 0.42, 0.26, 0.3, 0, lanternCol);
  const lamp = lg.build();
  const sleeper = new THREE.BoxGeometry(2.5, 0.14, 0.24);
  sleeper.translate(0, 0.07, 0);
  S = {
    brick, plain, walls,
    front: new THREE.MeshStandardMaterial({ map: atlas, color: atlas ? 0xffffff : 0xb98a6e, roughness: 0.9 }),
    // roof tiles and hedge leaf mapped in world space: these geometries carry no UVs, and the
    // per-building roof tint still multiplies through on the merged hips
    roof: tiles ? worldMappedMaterial(tiles, { scale: 0.45, vertexColors: true, roughness: 0.85 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 }),
    roofInst: tiles ? worldMappedMaterial(tiles, { scale: 0.45, roughness: 0.85 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    chimney: new THREE.MeshStandardMaterial({ color: 0x8a5a48, roughness: 0.95 }),
    hedge: leaf ? worldMappedMaterial(leaf, { scale: 0.6, color: 0x5b7f3a, roughness: 1 }) : new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 1 }),
    tree: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.5, roughness: 0.5 }),
    // no polygonOffset: at grazing angles it would push fields through the asphalt 2 cm above them;
    // the world's ground plane should sit a few cm below y 0 so the fields clear it by height alone
    field: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0.2 }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0x5c5347, roughness: 1 }),
    misc: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, flatShading: true }),
    deck: tryPbr('wood_floor_deck', { repeat: [1, 1], color: 0x8d8579 }, 0x8d8579),
    beach: tryPbr('coast_sand_01', { repeat: [1, 1], color: 0xbdb3a1 }, 0xb7ad9c),
    cliff: new THREE.MeshStandardMaterial({ color: 0x8c7b63, roughness: 1, flatShading: true }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.9 }),
    sign: new THREE.MeshStandardMaterial({ color: 0x8a8d91, metalness: 0.6, roughness: 0.4 }),
    geoBox: unitBox, geoGable: gable, geoTree: tree, geoLamp: lamp, geoSleeper: sleeper,
  };
  return S;
}

// per-kind wall colours; the facade shader paints windows over them
const KIND_COLOURS = {
  house: [0x9a4a36, 0x8f4a3c, 0xa8664a, 0xb98a6e, 0xe3d7bf, 0xd9c7a3, 0xc8b89a],
  terrace: [0x9a4a36, 0x8f4a3c, 0xa8664a, 0xb98a6e, 0xe3d7bf],
  flats: [0xc9b9a0, 0xb0a08c, 0xd8d0c0, 0xa9977f],
  shop: [0xc9b9a0, 0xa4573d, 0xe1d6c0, 0x8f6b5a, 0x9a4a36],
  industrial: [0x8d97a0, 0x6f7f8c, 0xb5bcc2, 0x9aa39e],
  church: [0xa89f8c, 0x9b9484],
  other: [0xb9b0a2, 0xa89f90, 0xc4b9a8],
};
const ROOF_COLOURS = [0x3c4148, 0x4a4e55, 0x8a4a3a, 0x7a4336, 0x55504a];
const FIELD = {
  residential: { col: [0x7f9a62], y: 0 }, industrial: { col: [0x9ea3a0], y: 0 }, retail: { col: [0xa5a9a3], y: 0 },
  farmland: { col: [0xc9b36a, 0x9bb968, 0xb5a85c, 0xa7b76a], y: 1 }, grass: { col: [0x8fbf6a, 0x86b562], y: 2 },
  wood: { col: [0x3e6b2f], y: 3 }, beach: { col: [0xc8bda2], y: 4 }, water: { col: [0x3f6f8c], y: 4 },
};

/**
 * Scenery builder for the tile manager. `net` is the RoadNet (its `data` is region.json),
 * `colliders` the world's Colliders (buildings and the coast are registered there and removed on
 * dispose), `tickers` gets the water animation. Optional: `scene` (statics are added to it; else add
 * `builder.statics` yourself), `fieldY` (fields sit this far above the ground plane), `lampModel`
 * (a MODEL_NAMES entry to instance instead of the cheap procedural lamp).
 */
export function makeSceneryBuilder({ net, tickers = [], colliders = null, scene = null, fieldY = 0.004, lampModel = null, ground = false, groundY = null } = {}) {
  const data = net?.data || {};
  // ground-hugging sheets (landuse fields, railway ballast) are laid onto the hill like the roads;
  // they are big flat polygons, so unlike the 6 m road ribbons they must be split first
  const drapeGeo = (geo, maxEdge = 8) => (groundY ? drapeGeometry(geo, groundY, maxEdge) : geo);
  const WAYS = net?.ways instanceof Map ? [...net.ways.values()] : data.ways || [];
  const NODES = data.nodes || {};
  const bounds = data.bounds || { minX: -3200, maxX: 8000, minZ: -7300, maxZ: 6600 };
  // keep-clear zones: house.js builds the home, airfield.js the jet centre (fenced site plus the
  // approach strip north of the runway). Nothing placed here may land inside them.
  const home = data.home || { x: 4150, z: -5920 };
  const af = data.airfield || { x: 3870, z: -2326 };
  // roundabouts own their own island (drawRoundabout plants it): keep scenery — trees above all —
  // off the whole footprint so nothing overhangs the circulating lanes (a repeated complaint).
  const rbClear = (net?.roundabouts instanceof Map ? [...net.roundabouts.values()] : []).map((rb) => ({ x: rb.x, z: rb.z, r2: (rb.r + 6) ** 2 }));
  const inRoundabout = (x, z) => { for (const rb of rbClear) if ((x - rb.x) ** 2 + (z - rb.z) ** 2 < rb.r2) return true; return false; };
  const excluded = (x, z) => Math.hypot(x - home.x, z - home.z) < 70
    || (x >= af.x - 230 && x <= af.x + 45 && z >= af.z - 920 && z <= af.z + 50)
    || (x >= af.x - 40 && x <= af.x + 40 && z >= af.z - 1320 && z < af.z - 920)
    || inRoundabout(x, z);
  const halfW = (w) => w.halfW ?? (w.width ?? (w.cls === 'residential' || w.cls === 'living_street' ? 6 : 7.3)) / 2;
  const nearestRoad = (x, z, d) => { try { return net?.nearest?.(x, z, d) || null; } catch { return null; } };
  /** does a collider box (w across, d along yaw) cover any part of a carriageway? */
  const obbOnRoad = (o) => {
    if (!net?.grid) return false;
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw), hw = o.w / 2, hd = o.d / 2, R = Math.hypot(hw, hd) + 12;
    const local = (x, z) => [(x - o.cx) * c - (z - o.cz) * s, (x - o.cx) * s + (z - o.cz) * c]; // across, along
    for (const { way, i } of net.grid.near(o.cx, o.cz, R)) {
      if (way.cls === 'service') continue;
      const a = local(way.pts[i][0], way.pts[i][1]), b = local(way.pts[i + 1][0], way.pts[i + 1][1]), n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
      for (let k = 0; k <= n; k++) {
        const u = a[0] + ((b[0] - a[0]) * k) / n, v = a[1] + ((b[1] - a[1]) * k) / n;
        if (Math.hypot(Math.max(0, Math.abs(u) - hw), Math.max(0, Math.abs(v) - hd)) < way.halfW - 0.3) return true;
      }
    }
    return false;
  };

  // ---- index everything by tile once, so a tile build only touches what overlaps it ----
  const idx = { buildings: new Map(), landuse: new Map(), ways: new Map(), rails: new Map(), crossings: new Map(), landmarks: new Map(), coast: new Map() };
  const put = (map, tx, tz, item) => { const k = tileKey(tx, tz); if (!map.has(k)) map.set(k, []); map.get(k).push(item); };
  const putBox = (map, bb, item, pad = 0) => {
    for (let tx = Math.floor((bb.x0 - pad) / TILE); tx <= Math.floor((bb.x1 + pad) / TILE); tx++)
      for (let tz = Math.floor((bb.z0 - pad) / TILE); tz <= Math.floor((bb.z1 + pad) / TILE); tz++) put(map, tx, tz, item);
  };

  // buildings: pre-fit the box, decide the roof, pick colours by a stable hash
  const buildings = (data.buildings || []).map((b, i) => {
    const poly = ensureCW(b.pts.length > 3 && b.pts[0][0] === b.pts[b.pts.length - 1][0] && b.pts[0][1] === b.pts[b.pts.length - 1][1] ? b.pts.slice(0, -1) : b.pts);
    const area = Math.abs(signedArea(poly));
    const obb = obbFit(poly);
    const c = centroid(poly);
    const kind = KIND_COLOURS[b.kind] ? b.kind : 'other';
    const h = clamp(b.h || 6.5, 2.5, 120);
    const rect = poly.length === 4 || area / Math.max(1, obb.area) >= 0.9;
    const small = area < 220 && h <= 8.5;
    const pitched = kind === 'house' || kind === 'terrace' || kind === 'church' || (kind === 'other' && small && area > 12);
    const r = hash2(c[0] * 0.37, c[1] * 0.91);
    const cols = KIND_COLOURS[kind];
    return { i, poly, area, obb, cx: c[0], cz: c[1], kind, h, rect, pitched, name: b.name || null,
      col: cols[Math.floor(r * cols.length)], roofCol: ROOF_COLOURS[Math.floor(hash2(c[1], c[0]) * ROOF_COLOURS.length)],
      skip: excluded(c[0], c[1]) || poly.some((p) => excluded(p[0], p[1])), sign: null,
      rad: Math.hypot(obb.w, obb.d) / 2 };
  });
  for (const b of buildings) put(idx.buildings, Math.floor(b.cx / TILE), Math.floor(b.cz / TILE), b);
  const nearBuildings = (x, z, r) => {
    const out = [];
    for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) for (let tz = Math.floor((z - r) / TILE); tz <= Math.floor((z + r) / TILE); tz++) {
      for (const b of idx.buildings.get(tileKey(tx, tz)) || []) if (Math.hypot(b.cx - x, b.cz - z) <= r) out.push(b);
    }
    return out;
  };
  const buildingAt = (x, z, r = 40) => {
    let best = null, bd = r;
    for (const b of nearBuildings(x, z, r)) {
      if (pointInPoly(b.poly, x, z)) return b;
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  for (const lu of data.landuse || []) if (FIELD[lu.kind] && lu.pts?.length >= 3) putBox(idx.landuse, bboxOf(lu.pts), { kind: lu.kind, pts: lu.pts, bb: bboxOf(lu.pts) });
  for (const w of WAYS) {
    if (!w.pts || w.pts.length < 2) continue;
    // arc length and junction points along the way, for hedge and lamp gaps
    const cum = [0];
    for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    const junctions = [];
    (w.nodes || []).forEach((id, i) => { const nd = NODES[id]; if (nd && nd.ways && nd.ways.length >= 2 && i > 0 && i < w.pts.length - 1) junctions.push(cum[i]); });
    const way = { w, cum, len: cum[cum.length - 1], junctions, halfW: halfW(w) };
    if (way.len < 4) continue;
    for (let i = 0; i < w.pts.length - 1; i++) putBox(idx.ways, bboxOf([w.pts[i], w.pts[i + 1]]), way, 25); // houses sit up to ~18 m off their street
  }
  // de-duplicate the way index (a way touches a tile through many segments)
  for (const [k, list] of idx.ways) idx.ways.set(k, [...new Set(list)]);
  for (const r of data.railways || []) {
    if (!r.pts || r.pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const rail = { pts: r.pts, cum, len: cum[cum.length - 1] };
    for (let i = 0; i < r.pts.length - 1; i++) putBox(idx.rails, bboxOf([r.pts[i], r.pts[i + 1]]), rail, 6);
  }
  for (const [k, list] of idx.rails) idx.rails.set(k, [...new Set(list)]);
  for (const c of data.levelCrossings || []) put(idx.crossings, Math.floor(c.x / TILE), Math.floor(c.z / TILE), c);

  // ---- landmarks: decide what gets a bespoke model, and clear OSM footprints it replaces ----
  const landmarks = [];
  const KEEP = []; // keep-clear circles round bespoke landmarks (procedural houses stay out too)
  const clear = (x, z, r) => { KEEP.push({ x, z, r }); for (const b of nearBuildings(x, z, r)) b.skip = true; };
  const addLm = (lm) => { landmarks.push(lm); put(idx.landmarks, Math.floor(lm.x / TILE), Math.floor(lm.z / TILE), lm); };
  for (const tc of data.testCentres || []) { clear(tc.x, tc.z, 32); addLm({ type: 'testCentre', x: tc.x, z: tc.z, name: tc.name }); }
  for (const lm of data.landmarks || []) {
    const name = lm.name || '', cat = lm.cat || lm.category || '';
    if (cat === 'cathedral') { clear(lm.x, lm.z, 110); addLm({ type: 'cathedral', x: lm.x, z: lm.z, name }); }
    else if (/clock tower/i.test(name) && /attraction|historic/.test(cat)) { clear(lm.x, lm.z, 8); addLm({ type: 'clock', x: lm.x, z: lm.z, name }); }
    else if (/reculver towers/i.test(name)) { clear(lm.x, lm.z, 40); addLm({ type: 'reculver', x: lm.x, z: lm.z, name }); }
    else if (cat === 'pier' && /^herne bay pier$/i.test(name)) addLm({ type: 'pier', x: lm.x, z: lm.z, name });
    else if (cat === 'pier' && /pier head|remains of the end/i.test(name)) addLm({ type: 'pierHead', x: lm.x, z: lm.z, name });
    else if (cat === 'pier' && /neptune/i.test(name)) addLm({ type: 'harbourArm', x: lm.x, z: lm.z, name });
    else if (cat === 'fuel') { clear(lm.x, lm.z, 14); addLm({ type: 'fuel', x: lm.x, z: lm.z, name: lm.brand || name || 'Petrol' }); }
    else if (cat === 'supermarket') {
      const b = buildingAt(lm.x, lm.z, 45);
      const brand = lm.brand || name || 'Supermarket';
      if (b) { b.sign = brand; b.kind = 'shop'; b.pitched = false; if (b.h < 6) b.h = 6.5; KEEP.push({ x: b.cx, z: b.cz, r: b.rad + 10 }); }
      else { KEEP.push({ x: lm.x, z: lm.z, r: 40 }); addLm({ type: 'supermarket', x: lm.x, z: lm.z, name: brand }); }
    }
  }

  // ---- the coast: which side is the sea, and the pieces per tile ----
  const seaPoly = data.sea && data.sea.length >= 3 ? data.sea : null;
  const coast = (data.coastline || []).filter((p) => Array.isArray(p) && p.length === 2);
  let seaward = 1; // +1: the sea is on the right of the coastline's direction of travel
  if (seaPoly && coast.length > 2) {
    let votes = 0;
    for (let i = 0; i < coast.length - 1; i += Math.max(1, Math.floor(coast.length / 40))) {
      const a = coast[i], b = coast[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
      const px = (a[0] + b[0]) / 2 + (dz / m) * 30, pz = (a[1] + b[1]) / 2 - (dx / m) * 30; // 30 m to the right
      votes += pointInPoly(seaPoly, px, pz) ? 1 : -1;
    }
    seaward = votes >= 0 ? 1 : -1;
  }
  for (let i = 0; i < coast.length - 1; i++) putBox(idx.coast, bboxOf([coast[i], coast[i + 1]]), [coast[i], coast[i + 1]], 1);
  const coastZAt = (x) => {
    for (let i = 0; i < coast.length - 1; i++) {
      const a = coast[i], b = coast[i + 1];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
    return null;
  };
  const inSea = (x, z) => !!seaPoly && pointInPoly(seaPoly, x, z);
  // the sea lies to -z (north) of the coast on this stretch; used for things that must face it
  const seaDir = (() => { const i = Math.floor(coast.length / 2); if (coast.length < 2) return [0, -1]; const a = coast[i - 1], b = coast[i], dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1; return [(dz / m) * seaward, (-dx / m) * seaward]; })();

  // ---- statics: sea, cliff, beach, sea wall. Built on first use, added to `statics` ----
  const statics = new THREE.Group();
  statics.name = 'kent-scenery-statics';
  if (scene) scene.add(statics);
  let staticsBuilt = false, water = null;
  function buildStatics() {
    if (staticsBuilt || !seaPoly) return;
    staticsBuilt = true;
    const M = shared();
    const R = { x0: bounds.minX - 1500, z0: bounds.minZ - 3000, x1: bounds.maxX + 1500, z1: bounds.maxZ + 1500 };
    const seaClip = clipRect(seaPoly, R);
    if (!seaClip) return;
    water = waterMaterial(0x1e5c73);
    tickers.push((t) => water.userData.tick(t));
    const sb = bboxOf(seaClip);
    // deep water under everything seaward of the cliffs
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(sb.x1 - sb.x0, sb.z1 - sb.z0), water);
    deep.rotation.x = -Math.PI / 2;
    deep.position.set((sb.x0 + sb.x1) / 2, SEA_DEEP, (sb.z0 + sb.z1) / 2);
    statics.add(deep);
    // the sea-level shelf off the promenade, west of the cliffs
    const shelfPoly = clipRect(seaClip, { ...R, x1: CLIFF_X0 });
    if (shelfPoly) {
      const g = new GB({ uv: false, color: false });
      g.cap(shelfPoly, SEA_SHELF, new THREE.Color(1, 1, 1));
      statics.add(new THREE.Mesh(g.build(), water));
    }
    // and a ramp down to the deep water where the cliffs begin
    if (sb.x1 > CLIFF_X0) {
      const zs = coast.filter((p) => p[0] >= CLIFF_X0 - 80 && p[0] <= CLIFF_X1 + 80).map((p) => p[1]);
      const zLand = zs.length ? (seaDir[1] < 0 ? Math.max(...zs) + 30 : Math.min(...zs) - 30) : (seaDir[1] < 0 ? sb.z1 : sb.z0);
      const zFar = seaDir[1] < 0 ? sb.z0 : sb.z1;
      const cols = 12, g = new GB({ uv: false, color: false }), w = new THREE.Color(1, 1, 1);
      for (let i = 0; i < cols; i++) {
        const xa = CLIFF_X0 + ((CLIFF_X1 - CLIFF_X0) * i) / cols, xb = CLIFF_X0 + ((CLIFF_X1 - CLIFF_X0) * (i + 1)) / cols;
        const a = [xa, seaLevelAt(xa), zLand], b = [xb, seaLevelAt(xb), zLand], c = [xb, seaLevelAt(xb), zFar], d = [xa, seaLevelAt(xa), zFar];
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        if (ny >= 0) g.quad(a, b, c, d, w); else g.quad(a, d, c, b, w);
      }
      statics.add(new THREE.Mesh(g.build(), water));
    }
    // beach, sea wall and cliff along the coast inside the region
    const strip = coast.filter((p) => p[0] >= bounds.minX - 200 && p[0] <= bounds.maxX + 200);
    if (strip.length > 1) {
      const white = new THREE.Color(1, 1, 1);
      const beach = new GB({ uv: true, color: false });
      beach.ribbon(strip, 0.3, BEACH_W, (x) => seaLevelAt(x) + 0.12, white, seaward);
      const bg = beach.build();
      const uv = bg.attributes.uv, p = bg.attributes.position;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
      const beachMesh = new THREE.Mesh(bg, M.beach);
      beachMesh.receiveShadow = true;
      statics.add(beachMesh);
      const west = strip.filter((q) => q[0] <= CLIFF_X0 + 5), east = strip.filter((q) => q[0] >= CLIFF_X0 - 5);
      if (west.length > 1) {
        const wall = new GB({ uv: false, color: false });
        wall.wall(west, 0.6, () => SEA_WALL_H, () => SEA_SHELF - 0.2, white, seaward);          // seaward face
        wall.wall(west, 0, () => SEA_WALL_H, () => 0, white, -seaward);                        // landward face
        wall.ribbon(west, 0, 0.6, () => SEA_WALL_H, white, seaward);                           // coping
        const m = new THREE.Mesh(wall.build(), M.concrete);
        m.castShadow = m.receiveShadow = true;
        statics.add(m);
      }
      if (east.length > 1) {
        const cliff = new GB({ uv: false, color: false });
        cliff.wall(east, 0, () => 0, (x) => seaLevelAt(x) - 0.6, white, seaward, 2.5);
        const m = new THREE.Mesh(cliff.build(), M.cliff);
        m.castShadow = m.receiveShadow = true;
        statics.add(m);
      }
    }
    if (ground) {
      const lg = landGeometry(0);
      if (lg) { const m = new THREE.Mesh(lg, (() => { try { return A.pbr('leafy_grass', { repeat: [1, 1], color: 0x9fbf86 }); } catch { return new THREE.MeshStandardMaterial({ color: 0x8fb46e, roughness: 1 }); } })()); m.receiveShadow = true; statics.add(m); }
    }
  }
  /** The region's land as one flat geometry (the rectangle minus the sea), for the world's ground plane. */
  function landGeometry(y = 0) {
    const R = { x0: bounds.minX - 500, z0: bounds.minZ - 500, x1: bounds.maxX + 500, z1: bounds.maxZ + 500 };
    const rect = [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1]];
    if (!seaPoly) { const g = new GB({ uv: true, color: false }); g.cap(rect, y, new THREE.Color(1, 1, 1)); return g.build(); }
    const strip = coast.filter((p) => p[0] >= R.x0 - 50 && p[0] <= R.x1 + 50);
    if (strip.length < 2) return null;
    // the land polygon: the coast chain, closed round the landward edge of the rectangle
    const landSouth = seaDir[1] < 0;
    const poly = [[strip[0][0] < strip[strip.length - 1][0] ? R.x0 : R.x1, strip[0][1]], ...strip.map((p) => [clamp(p[0], R.x0, R.x1), clamp(p[1], R.z0, R.z1)])];
    const lastX = poly[poly.length - 1][0] < poly[0][0] ? R.x0 : R.x1;
    poly.push([lastX, poly[poly.length - 1][1]]);
    const zEdge = landSouth ? R.z1 : R.z0;
    poly.push([lastX, zEdge], [poly[0][0], zEdge]);
    const g = new GB({ uv: true, color: false });
    g.cap(poly, y, new THREE.Color(1, 1, 1));
    const geo = g.build();
    const uv = geo.attributes.uv, p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
    return geo;
  }

  // ---- procedural houses: OSM only has buildings near main roads, so the side streets get rows
  // of houses here. Each way's houses are a pure function of that way (seeded by its id, cached),
  // so tiles agree on the seams whatever order they build in; a tile shows the ones centred in it.
  const places = (data.places || []).filter((p) => p.r > 0);
  const placeAt = (x, z) => { let best = null; for (const p of places) if (Math.hypot(x - p.x, z - p.z) <= p.r && (!best || p.r < best.r)) best = p; return best; };
  const landuseAt = (x, z) => {
    let best = null, ba = Infinity;
    for (const lu of idx.landuse.get(tileKey(Math.floor(x / TILE), Math.floor(z / TILE))) || []) {
      const a = (lu.bb.x1 - lu.bb.x0) * (lu.bb.z1 - lu.bb.z0);
      if (a < ba && x >= lu.bb.x0 && x <= lu.bb.x1 && z >= lu.bb.z0 && z <= lu.bb.z1 && pointInPoly(lu.pts, x, z)) { best = lu.kind; ba = a; }
    }
    return best;
  };
  const osmGrid = new Map();
  const osmBig = []; // the few large footprints are checked directly so the grid search stays small
  for (const b of buildings) {
    if (b.rad > 40) { osmBig.push(b); continue; }
    const k = `${Math.floor(b.cx / 50)},${Math.floor(b.cz / 50)}`; if (!osmGrid.has(k)) osmGrid.set(k, []); osmGrid.get(k).push(b);
  }
  /** an OSM building within 25 m of (x, z), or close enough to touch a house of radius rad */
  const osmNear = (x, z, rad) => {
    for (const b of osmBig) if (Math.hypot(b.cx - x, b.cz - z) - b.rad < rad + 3) return true;
    const R = 25 + 40, g0x = Math.floor((x - R) / 50), g1x = Math.floor((x + R) / 50), g0z = Math.floor((z - R) / 50), g1z = Math.floor((z + R) / 50);
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) for (const b of osmGrid.get(`${gx},${gz}`) || []) {
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d < 25 || d - b.rad < rad + 3) return true;
    }
    return false;
  };
  // a fine 20 m grid of road segments: "is another street nearer than mine?" is asked a lot
  const SEG = 20, segGrid = new Map();
  for (const w of WAYS) {
    if (!w.pts) continue;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / SEG); gx <= Math.floor(Math.max(a[0], b[0]) / SEG); gx++)
        for (let gz = Math.floor(Math.min(a[1], b[1]) / SEG); gz <= Math.floor(Math.max(a[1], b[1]) / SEG); gz++) {
          const k = `${gx},${gz}`; if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push([w, a, b]);
        }
    }
  }
  /** true when a road other than `w` comes within d of (x, z) */
  const otherRoadWithin = (x, z, d, w) => {
    for (let gx = Math.floor((x - d) / SEG); gx <= Math.floor((x + d) / SEG); gx++) for (let gz = Math.floor((z - d) / SEG); gz <= Math.floor((z + d) / SEG); gz++) {
      for (const [o, a, b] of segGrid.get(`${gx},${gz}`) || []) if (o !== w && o.id !== w.id && segDist(x, z, a, b) < d) return true;
    }
    return false;
  };
  const ANY = { id: NaN };
  const roadWithin = (x, z, d) => otherRoadWithin(x, z, d, ANY); // any road centreline within d
  const NO_HOUSES = new Set(['farmland', 'wood', 'grass', 'industrial', 'retail', 'water', 'beach']);
  const a299 = [];
  for (const w of WAYS) if (w.ref === 'A299' && w.pts) for (let i = 0; i < w.pts.length - 1; i++) a299.push([w.pts[i], w.pts[i + 1]]);
  const segDist = (x, z, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
  };
  const distA299 = (x, z) => { let d = Infinity; for (const [a, b] of a299) d = Math.min(d, segDist(x, z, a, b)); return d; };
  /** every tile the circle (x, z, r) touches */
  const tilesAround = (x, z, r) => { const out = []; for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) for (let tz = Math.floor((z - r) / TILE); tz <= Math.floor((z + r) / TILE); tz++) out.push(tileKey(tx, tz)); return out; };
  const nearRail = (x, z, r) => {
    for (const k of tilesAround(x, z, r)) for (const rail of idx.rails.get(k) || []) {
      for (let i = 0; i < rail.pts.length - 1; i++) if (segDist(x, z, rail.pts[i], rail.pts[i + 1]) < r) return true;
    }
    return false;
  };
  /** within r of the coastline (sea wall or cliff edge) */
  const nearCoast = (x, z, r) => {
    for (const k of tilesAround(x, z, r)) for (const [a, b] of idx.coast.get(k) || []) if (segDist(x, z, a, b) < r) return true;
    return false;
  };
  const INTERWAR = new Set(['Beltinge', 'Greenhill', 'Hillborough', 'Studd Hill', 'Hampton', 'Bishopstone', 'Swalecliffe', 'Herne', 'Herne Common', 'Broomfield', 'Eddington', 'Chestfield', 'Hunters Forstal', 'Thanington', 'Wincheap', 'Harbledown']);
  /** Period by place: Victorian/Edwardian terraces in the Herne Bay seafront grid and inner
   * Canterbury, 1930s semis and post-war bungalows in the suburbs, modern estates by the A299. */
  function styleAt(x, z) {
    const pl = placeAt(x, z);
    const name = pl?.name || '';
    if (name === 'Herne Bay' && Math.hypot(x - 1750, z + 5700) < 950) return 'victorian';
    if (name === 'Canterbury' && Math.hypot(x - pl.x, z - pl.z) < 1300) return 'victorian';
    if (name !== 'Beltinge' && name !== 'Greenhill' && distA299(x, z) < 450) return 'modern';
    if (INTERWAR.has(name) || name === 'Herne Bay' || name === 'Canterbury') return 'interwar';
    return 'village';
  }
  const PAL = {
    brick: [0x9a4a36, 0x8f4a3c, 0xa8664a, 0x7f3f30],
    stucco: [0xeee8da, 0xe8dcc0, 0xd9e3e0, 0xf0e0d0, 0xdfe6ea],
    render: [0xe8dfc8, 0xc9c4b8, 0xf0ece2, 0xd8cdb4],
    modern: [0xc9a77c, 0xb4643f, 0xd8c3a0, 0xbf8b62, 0xeeeae2],
  };
  const pickc = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const rr = (r, a, b) => a + r() * (b - a);
  /** one plot's worth: a terrace row, a pair of semis, a detached house or a bungalow */
  function makeUnit(style, r) {
    const roofCol = pickc(r, ROOF_COLOURS);
    if (style === 'victorian') {
      const n = 3 + Math.floor(r() * 6), each = rr(r, 5.0, 5.7), tall = r() < 0.2;
      const painted = r() < 0.35;
      return { kind: 'terrace', w: n * each, n, d: rr(r, 9.5, 11), h: tall ? rr(r, 9.8, 10.8) : rr(r, 7.2, 8.4), setback: rr(r, 4, 4.8), gap: rr(r, 1.2, 2.4), drive: false,
        col: pickc(r, painted ? PAL.stucco : PAL.brick), roofCol, edge: r() < 0.8 ? 'wall' : 'hedge', wallCol: painted ? 0xe8e2d4 : 0x8f4a3c };
    }
    if (style === 'interwar') {
      if (r() < 0.35) return { kind: 'house', w: rr(r, 9, 11), n: 1, d: rr(r, 9, 10.5), h: rr(r, 3.2, 3.6), setback: rr(r, 6.5, 8), gap: rr(r, 3.4, 4.5), drive: true, col: pickc(r, PAL.render), roofCol, edge: r() < 0.6 ? 'hedge' : 'wall', wallCol: 0xd8d2c4 };
      const half = rr(r, 6.2, 7);
      return { kind: 'house', w: 2 * half, n: 2, d: rr(r, 8.5, 9.5), h: rr(r, 6.5, 7.1), setback: rr(r, 6, 8), gap: rr(r, 3.4, 4.4), drive: true, col: pickc(r, r() < 0.7 ? PAL.render : PAL.brick), roofCol, edge: r() < 0.6 ? 'hedge' : 'wall', wallCol: 0xa8664a };
    }
    if (style === 'modern') {
      if (r() < 0.3) { const each = rr(r, 4.8, 5.4); return { kind: 'terrace', w: 3 * each, n: 3, d: rr(r, 8.5, 9.5), h: rr(r, 6.4, 7), setback: rr(r, 5, 6), gap: rr(r, 3, 3.6), drive: true, col: pickc(r, PAL.modern), roofCol, edge: r() < 0.6 ? 'none' : 'hedge', wallCol: 0xc9a77c }; }
      return { kind: 'house', w: rr(r, 7.5, 9), n: 1, d: rr(r, 8, 9.5), h: rr(r, 6.2, 6.8), setback: rr(r, 5, 6), gap: rr(r, 2.8, 3.6), drive: true, col: pickc(r, PAL.modern), roofCol, edge: r() < 0.6 ? 'none' : 'hedge', wallCol: 0xc9a77c };
    }
    if (r() < 0.4) return { kind: 'house', w: rr(r, 9, 12), n: 1, d: rr(r, 8.5, 10.5), h: rr(r, 3.2, 3.7), setback: rr(r, 6.5, 8), gap: rr(r, 5, 8), drive: true, col: pickc(r, PAL.render), roofCol, edge: 'hedge', wallCol: 0xd8d2c4 };
    return { kind: 'house', w: rr(r, 8, 11), n: 1, d: rr(r, 8, 10), h: rr(r, 6.3, 7), setback: rr(r, 6.5, 8), gap: rr(r, 5, 8), drive: true, col: pickc(r, r() < 0.5 ? PAL.brick : PAL.render), roofCol, edge: r() < 0.5 ? 'hedge' : 'wall', wallCol: 0x9a4a36 };
  }
  const PROC_CLS = new Set(['residential', 'living_street', 'unclassified']);
  const procCache = new Map();
  /** corners plus points every ~3 m along each edge (long terraces must not straddle a street) */
  const edgeSamples = (poly) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  };
  const obbCorners = (cx, cz, ux, uz, nx, nz, hw, hd) => [[cx - ux * hw - nx * hd, cz - uz * hw - nz * hd], [cx + ux * hw - nx * hd, cz + uz * hw - nz * hd], [cx + ux * hw + nx * hd, cz + uz * hw + nz * hd], [cx - ux * hw + nx * hd, cz - uz * hw + nz * hd]];
  const sepAxis = (A, B) => {
    // two convex quads overlap unless some edge normal separates them (SAT)
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4], ax = b[1] - a[1], az = a[0] - b[0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A) { const v = p[0] * ax + p[1] * az; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
      for (const p of B) { const v = p[0] * ax + p[1] * az; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      const m = 0.3 * Math.hypot(ax, az); // keep 0.3 m of air between neighbours
      if (a1 + m <= b0 || b1 + m <= a0) return true;
    }
    return false;
  };
  function procForWay(way) {
    const w = way.w;
    if (procCache.has(w.id)) return procCache.get(w.id);
    const out = [];
    procCache.set(w.id, out);
    if (!PROC_CLS.has(w.cls) || w.rb || w.dual || w.link || w.bridge || w.tunnel || way.len < 30) return out;
    const mid = pointAt(way, way.len / 2);
    if (w.cls === 'unclassified' && !placeAt(mid.x, mid.z)) return out;
    const style = styleAt(mid.x, mid.z);
    const J = 14 + way.halfW;
    const gaps = way.junctions.map((s) => [s - J, s + J]);
    const nIds = w.nodes || [];
    const endShared = (i) => { const nd = NODES[nIds[i]]; return nd && nd.ways && nd.ways.length >= 2; };
    gaps.push([-Infinity, nIds.length && endShared(0) ? J : 6], [way.len - (nIds.length && endShared(nIds.length - 1) ? J : 6), Infinity]);
    const blocked = (s0, s1) => gaps.some(([a, b]) => s1 > a && s0 < b);
    const pave = w.pave ? KERB_W + PAVE_W : 0.8;
    const ownDist = (x, z) => { let d = Infinity; for (let i = 0; i < w.pts.length - 1; i++) d = Math.min(d, segDist(x, z, w.pts[i], w.pts[i + 1])); return d; };
    // corners and side midpoints must belong to this street (no other road is nearer, so houses of
    // different streets never meet) and stay off its own pavement where it loops back behind them
    const owned = (poly) => edgeSamples(poly).every(([x, z]) => {
      const d0 = ownDist(x, z);
      if (d0 < way.halfW + pave + 0.3) return false;
      return !otherRoadWithin(x, z, d0 + 1.5, w); // a 1.5 m margin past the halfway line between streets
    });
    for (const side of [1, -1]) {
      const r = mulberry32((Math.imul(w.id % 2147483647, 2654435761) ^ (side > 0 ? 0x5bd1e995 : 0x1b873593)) >>> 0);
      let s = 0, guard = 0;
      while (s < way.len && guard++ < 4000) {
        const u = makeUnit(style, r);
        if (blocked(s, s + u.w)) { const g = gaps.find(([a, b]) => s + u.w > a && s < b); s = Math.max(s + 2, g[1] + 0.5); continue; }
        if (s + u.w > way.len) break;
        const p0 = pointAt(way, s), p1 = pointAt(way, s + u.w), pm = pointAt(way, s + u.w / 2);
        let ux = p1.x - p0.x, uz = p1.z - p0.z;
        const L = Math.hypot(ux, uz) || 1;
        ux /= L; uz /= L;
        if (L < u.w * 0.92) { s += 3; continue; } // too tight a bend for a straight frontage
        const nx = uz * side, nz = -ux * side; // away from the road (driver's left for side 1)
        const front = way.halfW + Math.max(pave, u.setback);
        const off = front + u.d / 2;
        const cx = pm.x + nx * off, cz = pm.z + nz * off;
        const poly = obbCorners(cx, cz, ux, uz, nx, nz, u.w / 2, u.d / 2);
        const rad = Math.hypot(u.w, u.d) / 2;
        const ok = !poly.some(([x, z]) => excluded(x, z) || inSea(x, z)) && !nearCoast(cx, cz, rad + 12)
          && !KEEP.some((k) => Math.hypot(cx - k.x, cz - k.z) < k.r + rad)
          && (() => { const lu = landuseAt(cx, cz); return lu ? !NO_HOUSES.has(lu) : !!placeAt(cx, cz); })()
          && !nearRail(cx, cz, rad + 6)
          && !osmNear(cx, cz, rad)
          && !out.some((q) => Math.abs(q.cx - cx) < q.rad + rad && Math.abs(q.cz - cz) < q.rad + rad && !sepAxis(q.poly, poly))
          && owned(poly);
        if (!ok) { s += 3; continue; }
        const yaw = Math.atan2(-uz, ux); // local x along the street
        const rec = {
          proc: true, way: w.id, side, style, poly: ensureCW(poly), area: u.w * u.d, obb: { cx, cz, w: u.w, d: u.d, yaw }, cx, cz, kind: u.kind, h: u.h, rect: true, pitched: true,
          name: null, col: u.col, roofCol: u.roofCol, skip: false, sign: null, rad, n: u.n,
          front: { nx: -nx, nz: -nz, len: u.w, cx: cx - nx * u.d / 2, cz: cz - nz * u.d / 2 },
          extras: [],
        };
        // front boundary just behind the pavement (clear of sign posts at edge + 2.3 m): a wall or
        // hedge per house with a gate gap (rural lanes already get the field hedgerow there)
        if (u.edge !== 'none' && !w.rural) {
          const bo = way.halfW + pave + 0.7, each = u.w / u.n;
          for (let k = 0; k < u.n; k++) {
            const sc = s + (k + 0.5) * each, q = pointAt(way, sc);
            const len = each - 1.1;
            if (len < 1.5) continue;
            const wall = u.edge === 'wall';
            rec.extras.push({ type: wall ? 'wall' : 'hedge', x: q.x + nx * bo - ux * 0.45, z: q.z + nz * bo - uz * 0.45, w: len, h: wall ? 0.7 : 1.05, d: wall ? 0.28 : 0.7, yaw, col: wall ? u.wallCol : 0x3f6b2e });
          }
        }
        // a drive in the gap beside the house, from the pavement to halfway down the side
        if (u.drive && u.gap >= 2.8 && !blocked(s + u.w, s + u.w + u.gap)) {
          const dw = Math.min(3, u.gap - 0.4), sc = s + u.w + u.gap / 2, q = pointAt(way, sc);
          const d0 = way.halfW + pave, d1 = front + u.d * 0.6;
          rec.extras.push({ type: 'drive', x: q.x + nx * (d0 + d1) / 2, z: q.z + nz * (d0 + d1) / 2, w: dw, h: 0.05, d: d1 - d0, yaw, col: 0xb7b2aa });
        }
        out.push(rec);
        s += u.w + u.gap;
      }
    }
    return out;
  }
  const PROC_CAP = 250;
  /** procedural houses centred in this tile, the same set for near and far, capped by a stable hash */
  function procForTile(tile) {
    const ways = idx.ways.get(tileKey(tile.tx, tile.tz)) || [];
    const list = [];
    for (const way of ways) for (const h of procForWay(way)) if (h.cx >= tile.x0 && h.cx < tile.x1 && h.cz >= tile.z0 && h.cz < tile.z1) list.push(h);
    if (list.length > PROC_CAP) { list.sort((a, b) => hash2(a.cx, a.cz) - hash2(b.cx, b.cz)); list.length = PROC_CAP; }
    return list;
  }

  // ---- colliders: register through the world's Colliders and remember what to take back ----
  // Colliders keeps a cell grid and has remove(box): keep the box each add() returns and hand it
  // back on dispose, so the grid forgets streamed-out tiles. An older Colliders without remove()
  // gets the fallback: note what was appended (by identity) and filter it out of its arrays.
  function colliderScope() {
    const list = [];
    if (!colliders) return { list, add(cx, cz, w, d, yaw, carOnly = false) { list.push({ cx, cz, w, d, yaw, carOnly }); }, remove() {} };
    if (typeof colliders.remove === 'function') {
      const boxes = [];
      return {
        list,
        add(cx, cz, w, d, yaw, carOnly = false) {
          list.push({ cx, cz, w, d, yaw, carOnly });
          let b;
          if (typeof colliders.obb === 'function') b = colliders.obb(cx, cz, w, d, yaw, carOnly);
          else { const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); b = colliders.box(cx, cz, w * c + d * s, w * s + d * c, 0, carOnly); }
          if (b) boxes.push(b);
        },
        remove() { for (const b of boxes) colliders.remove(b); boxes.length = 0; },
      };
    }
    const tagged = [];
    return {
      list,
      add(cx, cz, w, d, yaw, carOnly = false) {
        list.push({ cx, cz, w, d, yaw, carOnly });
        const arrays = Object.keys(colliders).filter((k) => Array.isArray(colliders[k]));
        const before = arrays.map((k) => colliders[k].length);
        if (typeof colliders.obb === 'function') colliders.obb(cx, cz, w, d, yaw, carOnly);
        else {
          // no oriented boxes yet: the footprint's axis-aligned bounds
          const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
          colliders.box(cx, cz, w * c + d * s, w * s + d * c, 0, carOnly);
        }
        for (const k of Object.keys(colliders)) {
          if (!Array.isArray(colliders[k])) continue;
          const i = arrays.indexOf(k), from = i < 0 ? 0 : before[i];
          for (let j = from; j < colliders[k].length; j++) tagged.push([k, colliders[k][j]]);
        }
      },
      remove() {
        if (!tagged.length) return;
        const sets = new Map();
        for (const [k, o] of tagged) { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(o); }
        for (const [k, set] of sets) {
          const arr = colliders[k];
          if (!Array.isArray(arr)) continue;
          let w = 0;
          for (let i = 0; i < arr.length; i++) if (!set.has(arr[i])) arr[w++] = arr[i];
          arr.length = w;
        }
        tagged.length = 0;
      },
    };
  }

  // ---- building pieces ----
  function buildBuildings(list, tile, lod, rng, M, out, cs) {
    const near = lod === 'near';
    // On a hill a building is planted whole, never draped: per-vertex would shear its roof by a
    // couple of metres across a 1-in-6 street. Its base is the LOWEST of its footprint corners, so
    // no corner is ever left hanging in the air (the high side just sits a little into the slope).
    const baseY = !groundY ? () => 0 : (b) => {
      const o = b.obb, c = Math.cos(o.yaw), s = Math.sin(o.yaw), hw = o.w / 2, hd = o.d / 2;
      let lo = Infinity;
      for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        lo = Math.min(lo, groundY(o.cx + ox * c + oz * s, o.cz - ox * s + oz * c));
      }
      return lo;
    };
    const boxesBrick = [], boxesPlain = [], gables = [], chimneys = [], hedges = [];
    const walls = new GB({ uv: true, color: true });
    const roofs = new GB({ uv: false, color: true });
    const fronts = new GB({ uv: true, color: false });
    const col = new THREE.Color();
    const counts = {};
    for (const b of list) {
      if (b.skip) continue;
      const gy = baseY(b);
      if (b.proc) {
        counts.proc = (counts.proc || 0) + 1;
        // far tiles: the box only; near: roof, front, garden edge and drive go through the usual paths below
        if (!near) { boxesBrick.push({ x: b.obb.cx, y: gy, z: b.obb.cz, w: b.obb.w, d: b.obb.d, h: b.h, yaw: b.obb.yaw, col: b.col }); continue; }
        for (const e of b.extras) {
          if (e.type === 'hedge') hedges.push({ x: e.x, y: gy, z: e.z, len: e.w, h: e.h, wd: e.d, yaw: e.yaw + Math.PI / 2, t: hash2(e.x, e.z) });
          else (e.type === 'wall' ? boxesBrick : boxesPlain).push({ x: e.x, y: gy, z: e.z, w: e.w, d: e.d, h: e.h, yaw: e.yaw, col: e.col });
          if (e.type !== 'drive') cs.add(e.x, e.z, e.w, e.d, e.yaw);
        }
      } else counts[b.kind] = (counts[b.kind] || 0) + 1;
      const roofH = clamp(Math.min(b.obb.w, b.obb.d) * 0.45, 2.2, b.kind === 'church' ? 5 : 3.5);
      if (b.rect) {
        const o = b.obb;
        (b.kind === 'flats' || b.kind === 'industrial' || (b.kind === 'other' && !b.pitched) ? boxesPlain : boxesBrick).push({ x: o.cx, y: gy, z: o.cz, w: o.w, d: o.d, h: b.h, yaw: o.yaw, col: b.col });
        if (b.pitched) {
          // ridge along the long side
          const long = o.w >= o.d;
          gables.push({ x: o.cx, z: o.cz, y: gy + b.h, w: (long ? o.d : o.w) + 0.5, d: (long ? o.w : o.d) + 0.4, h: roofH, yaw: o.yaw + (long ? Math.PI / 2 : 0), col: b.roofCol });
          if (near && b.kind !== 'church' && rng() < 0.6) {
            const L = (long ? o.w : o.d) / 2 - 0.8, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
            const lx = long ? L * (rng() < 0.5 ? 1 : -1) : 0.4, lz = long ? 0.4 : L * (rng() < 0.5 ? 1 : -1);
            chimneys.push({ x: o.cx + lx * c + lz * s, z: o.cz - lx * s + lz * c, y: gy + b.h + roofH * 0.7, yaw: o.yaw });
          }
          if (b.kind === 'church' && b.area > 150) {
            // a square tower at one end, twice the nave height
            const c = Math.cos(o.yaw), s = Math.sin(o.yaw), L = (long ? o.w : o.d) / 2 - 3;
            const lx = long ? -L : 0, lz = long ? 0 : -L;
            boxesBrick.push({ x: o.cx + lx * c + lz * s, y: gy, z: o.cz - lx * s + lz * c, w: 6, d: 6, h: b.h * 2.4, yaw: o.yaw, col: b.col });
          }
        }
        if (near) cs.add(o.cx, o.cz, o.w, o.d, o.yaw);
      } else {
        col.set(b.col);
        walls.walls(b.poly, gy, gy + b.h, col);
        if (b.pitched) roofs.hip(b.poly, gy + b.h, roofH, clamp(Math.min(b.obb.w, b.obb.d) * 0.4, 1.2, 4), col.set(b.roofCol));
        else walls.cap(b.poly, gy + b.h, col);
        // the box round an L-shaped or rambling footprint can reach over a road: no invisible wall there
        if (near && !obbOnRoad(b.obb)) cs.add(b.obb.cx, b.obb.cz, b.obb.w, b.obb.d, b.obb.yaw);
      }
      if (near && !b.sign && (b.kind === 'house' || b.kind === 'terrace' || b.kind === 'shop') && b.h <= 12) addFront(b, fronts, rng, gy);
      if (near && b.sign && hasDOM) addSign(b, out, M);
    }
    const inst = (items, geo, mat, { color = true, cast = true } = {}) => {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      const o = new THREE.Object3D();
      items.forEach((it, i) => {
        o.position.set(it.x, it.y || 0, it.z);
        o.rotation.set(0, it.yaw || 0, 0);
        o.scale.set(it.w ?? it.s ?? 1, it.h ?? it.s ?? 1, it.d ?? it.s ?? 1);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        if (color && it.col != null) im.setColorAt(i, col.set(it.col));
      });
      im.castShadow = cast;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.add(im);
      return im;
    };
    inst(boxesBrick, M.geoBox, M.brick);
    inst(boxesPlain, M.geoBox, M.plain);
    inst(gables, M.geoGable, M.roofInst);
    if (chimneys.length) inst(chimneys.map((c) => ({ ...c, w: 0.7, h: 1.4, d: 1.2 })), M.geoBox, M.chimney, { color: false });
    const merged = (gb, mat, cast = true) => { if (!gb.tris) return; const m = new THREE.Mesh(gb.build(), mat); m.castShadow = cast; m.receiveShadow = true; m.geometry.userData.owned = true; out.add(m); };
    merged(walls, M.walls);
    merged(roofs, M.roof);
    merged(fronts, M.front, false);
    return { counts, hedges };
  }
  /** a canvas front on the face that looks at the nearest road */
  function addFront(b, fronts, rng, gy = 0) {
    let face = b.front || null; // procedural houses know which face looks at their street
    const hit = face ? null : nearestRoad(b.cx, b.cz, 60);
    if (!face && !hit) return;
    const tx = hit ? hit.px - b.cx : 0, tz = hit ? hit.pz - b.cz : 0;
    if (face) { /* known */ } else if (b.rect) {
      const o = b.obb, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      // the four outward normals with their face length and half-extent
      const cands = [[c, -s, o.d, o.w / 2], [-c, s, o.d, o.w / 2], [s, c, o.w, o.d / 2], [-s, -c, o.w, o.d / 2]];
      let best = -Infinity;
      for (const [nx, nz, len, hd] of cands) { const d = nx * tx + nz * tz; if (d > best) { best = d; face = { nx, nz, len, cx: o.cx + nx * hd, cz: o.cz + nz * hd }; } }
      if (best <= 0) return;
    } else {
      // the longest edge whose outward normal looks towards the road
      let best = 0;
      for (let i = 0, n = b.poly.length; i < n; i++) {
        const a = b.poly[i], q = b.poly[(i + 1) % n], ex = q[0] - a[0], ez = q[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 3) continue;
        const nx = -ez / L, nz = ex / L; // outward for clockwise
        const mx = (a[0] + q[0]) / 2, mz = (a[1] + q[1]) / 2;
        const dot = (nx * (hit.px - mx) + nz * (hit.pz - mz)) / Math.max(1, Math.hypot(hit.px - mx, hit.pz - mz));
        if (dot > 0.6 && L > best) { best = L; face = { nx, nz, len: L, cx: mx, cz: mz }; }
      }
      if (!face) return;
    }
    const shop = b.kind === 'shop';
    const units = b.n || Math.max(1, Math.round(face.len / FRONT_W)), unitW = face.len / units;
    const hgt = b.h > 7.5 ? FRONT_H : b.h, crop = b.h < 5 ? b.h / FRONT_H : 1;
    const ux = face.nz, uz = -face.nx; // along the face
    const white = new THREE.Color(1, 1, 1);
    for (let k = 0; k < units; k++) {
      const cell = shop ? ATLAS.houses + Math.floor(rng() * ATLAS.shops) : Math.floor(rng() * ATLAS.houses);
      const u0 = (cell % ATLAS.cols) / ATLAS.cols, v0 = 1 - (Math.floor(cell / ATLAS.cols) + 1) / ATLAS.rows;
      const du = 1 / ATLAS.cols, dv = crop / ATLAS.rows;
      const off = -face.len / 2 + (k + 0.5) * unitW;
      const cx = face.cx + ux * off + face.nx * 0.03, cz = face.cz + uz * off + face.nz * 0.03;
      const hw = unitW / 2;
      // seen from the road the texture must read left to right: left end is at -u
      const a = [cx - ux * hw, gy, cz - uz * hw], bb = [cx + ux * hw, gy, cz + uz * hw], c = [cx + ux * hw, gy + hgt, cz + uz * hw], d = [cx - ux * hw, gy + hgt, cz - uz * hw];
      fronts.quad(a, bb, c, d, white, [[u0, v0], [u0 + du, v0], [u0 + du, v0 + dv], [u0, v0 + dv]]);
    }
  }
  /** brand fascia on a supermarket's road-facing side */
  function addSign(b, out, M) {
    const hit = nearestRoad(b.cx, b.cz, 90);
    const o = b.obb, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    const tx = hit ? hit.px - b.cx : seaDir[0], tz = hit ? hit.pz - b.cz : seaDir[1];
    const cands = [[c, -s, o.d, o.w / 2], [-c, s, o.d, o.w / 2], [s, c, o.w, o.d / 2], [-s, -c, o.w, o.d / 2]];
    let face = null, best = -Infinity;
    for (const [nx, nz, len, hd] of cands) { const d = nx * tx + nz * tz; if (d > best) { best = d; face = { nx, nz, len, hd }; } }
    const { bg, ink } = brandColours(b.sign);
    const tex = fasciaTex(b.sign, bg, ink);
    const w = clamp(face.len * 0.6, 6, 24), h = w * 192 / 1024;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
    m.position.set(o.cx + face.nx * (face.hd + 0.08), Math.max(3.2, b.h - h / 2 - 0.4), o.cz + face.nz * (face.hd + 0.08));
    m.rotation.y = Math.atan2(face.nx, face.nz);
    m.geometry.userData.owned = true;
    m.material.userData.owned = true;
    out.add(m);
  }

  // ---- fields ----
  function buildFields(tile, lod, out, M) {
    const list = idx.landuse.get(tileKey(tile.tx, tile.tz)) || [];
    if (!list.length) return 0;
    const g = new GB({ uv: false, color: true });
    const col = new THREE.Color();
    const rect = { x0: tile.x0, z0: tile.z0, x1: tile.x1, z1: tile.z1 };
    let n = 0;
    list.forEach((lu, i) => {
      const f = FIELD[lu.kind];
      const poly = clipRect(lu.pts, rect);
      if (!poly || Math.abs(signedArea(poly)) < 4) return;
      col.set(f.col[(i + Math.floor(hash2(lu.bb.x0, lu.bb.z0) * 7)) % f.col.length]);
      g.cap(poly, fieldY + f.y * 0.003, col); // kinds stack by priority, all below the asphalt at 0.02
      n++;
    });
    if (!g.tris) return 0;
    const m = new THREE.Mesh(drapeGeo(g.build()), M.field);
    m.receiveShadow = true;
    m.geometry.userData.owned = true;
    out.add(m);
    return n;
  }

  // ---- trees ----
  function buildTrees(tile, lod, rng, out, M, bList) {
    const near = lod === 'near';
    const key = tileKey(tile.tx, tile.tz);
    const lus = idx.landuse.get(key) || [];
    const spots = [];
    const cap = MAX_TREES[lod];
    const bGrid = new Map();
    for (const b of bList) { const k = `${Math.floor(b.cx / 50)},${Math.floor(b.cz / 50)}`; if (!bGrid.has(k)) bGrid.set(k, []); bGrid.get(k).push(b); }
    const nearBuilding = (x, z, pad) => {
      for (let gx = Math.floor((x - 25) / 50); gx <= Math.floor((x + 25) / 50); gx++) for (let gz = Math.floor((z - 25) / 50); gz <= Math.floor((z + 25) / 50); gz++) {
        for (const b of bGrid.get(`${gx},${gz}`) || []) if (Math.hypot(b.cx - x, b.cz - z) < b.rad + pad) return true;
      }
      return false;
    };
    const inside = (x, z) => x >= tile.x0 && x < tile.x1 && z >= tile.z0 && z < tile.z1;
    const add = (x, z, s) => { if (spots.length < cap && !excluded(x, z)) spots.push({ x, y: groundY ? groundY(x, z) : 0, z, s, r: rng() * 6.28 }); };
    // woods: a jittered grid, both lods
    const sp = near ? 9 : 14;
    for (const lu of lus) {
      if (lu.kind !== 'wood') continue;
      const x0 = Math.max(tile.x0, lu.bb.x0), x1 = Math.min(tile.x1, lu.bb.x1), z0 = Math.max(tile.z0, lu.bb.z0), z1 = Math.min(tile.z1, lu.bb.z1);
      for (let x = x0 + sp / 2; x < x1; x += sp) for (let z = z0 + sp / 2; z < z1; z += sp) {
        const px = x + (rng() - 0.5) * sp * 0.8, pz = z + (rng() - 0.5) * sp * 0.8;
        if (!inside(px, pz) || !pointInPoly(lu.pts, px, pz)) continue;
        if (roadWithin(px, pz, 6)) continue;
        add(px, pz, 0.9 + rng() * 0.5);
      }
    }
    if (!near) return finish();
    // field edges: a tree now and then along farmland and grass boundaries
    for (const lu of lus) {
      if (lu.kind !== 'farmland' && lu.kind !== 'grass') continue;
      const poly = lu.pts, n = poly.length;
      const cw = signedArea(poly) < 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 6) continue;
        const inx = (cw ? ez : -ez) / L, inz = (cw ? -ex : ex) / L;
        for (let s = 11; s < L; s += 22) {
          if (rng() > 0.45) continue;
          const t = s / L, px = a[0] + ex * t + inx * 3, pz = a[1] + ez * t + inz * 3;
          if (!inside(px, pz) || roadWithin(px, pz, 9) || nearBuilding(px, pz, 2)) continue;
          add(px, pz, 0.8 + rng() * 0.6);
        }
      }
    }
    // gardens: scattered through residential areas, clear of roads and houses
    for (const lu of lus) {
      if (lu.kind !== 'residential') continue;
      const x0 = Math.max(tile.x0, lu.bb.x0), x1 = Math.min(tile.x1, lu.bb.x1), z0 = Math.max(tile.z0, lu.bb.z0), z1 = Math.min(tile.z1, lu.bb.z1);
      const n = Math.floor(((x1 - x0) * (z1 - z0)) / 700);
      for (let k = 0; k < n; k++) {
        const px = x0 + rng() * (x1 - x0), pz = z0 + rng() * (z1 - z0);
        if (!pointInPoly(lu.pts, px, pz) || roadWithin(px, pz, 12) || nearBuilding(px, pz, 2.5)) continue;
        add(px, pz, 0.7 + rng() * 0.5);
      }
    }
    // no landuse at all: open countryside with trees kept away from roads and buildings
    if (!lus.length) {
      for (let k = 0; k < 110; k++) {
        const px = tile.x0 + rng() * TILE, pz = tile.z0 + rng() * TILE;
        if (roadWithin(px, pz, 20) || nearBuilding(px, pz, 4) || inSea(px, pz)) continue;
        add(px, pz, 0.8 + rng() * 0.6);
      }
    }
    return finish();
    function finish() {
      if (!spots.length) return 0;
      const im = new THREE.InstancedMesh(M.geoTree, M.tree, spots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
      spots.forEach((p, i) => {
        q.setFromAxisAngle(up, p.r);
        sc.setScalar(p.s);
        m.compose(new THREE.Vector3(p.x, p.y || 0, p.z), q, sc);
        im.setMatrixAt(i, m);
        im.setColorAt(i, c.setHSL(0.27 + (rng() - 0.5) * 0.06, 0.1 + rng() * 0.1, 0.5 + (rng() - 0.5) * 0.16).multiplyScalar(1.9));
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      out.add(im);
      return spots.length;
    }
  }

  // ---- along the ways: hedges on rural roads, lamps on paved streets ----
  const pointAt = (way, s) => {
    const { w, cum } = way;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = w.pts[i - 1], b = w.pts[i], L = cum[i] - cum[i - 1] || 1, t = clamp((s - cum[i - 1]) / L, 0, 1);
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
  };
  function buildWayside(tile, lod, rng, out, M, extraHedges = []) {
    const ways = idx.ways.get(tileKey(tile.tx, tile.tz)) || [];
    const inside = (x, z) => x >= tile.x0 && x < tile.x1 && z >= tile.z0 && z < tile.z1;
    const hedges = [...extraHedges], lamps = [];
    for (const way of ways) {
      const w = way.w;
      const nearJ = (s, d) => way.junctions.some((j) => Math.abs(j - s) < d);
      if (w.rural && !w.rb && lod === 'near') {
        for (const side of [1, -1]) {
          let s = 9 + rng() * 4;
          while (s + 2 < way.len - 9) {
            if (rng() < 0.05) { s += 5; continue; } // a field gate
            const len = Math.min(HEDGE_LEN, way.len - 9 - s);
            const mid = s + len / 2;
            if (!nearJ(mid, 14 + way.halfW)) {
              const p = pointAt(way, mid);
              const nx = p.dz * side, nz = -p.dx * side; // driver's left for side = 1
              const off = way.halfW + 1.4 + (rng() - 0.5) * 0.3;
              const x = p.x + nx * off, z = p.z + nz * off;
              if (inside(x, z) && !excluded(x, z)) hedges.push({ x, z, len: len + 0.3, h: 1.3 + rng() * 0.7, wd: 1.3 + rng() * 0.5, yaw: Math.atan2(p.dx, p.dz), t: rng() });
            }
            s += len;
          }
        }
      }
      if (w.pave && !w.rb && lod === 'near') {
        let k = Math.floor(hash2(w.id || 0, 3) * 2);
        for (let s = 17; s < way.len - 8; s += LAMP_EVERY, k++) {
          if (nearJ(s, 7)) continue;
          const side = k % 2 ? -1 : 1;
          const p = pointAt(way, s);
          const nx = p.dz * side, nz = -p.dx * side;
          const off = way.halfW + PAVE - 0.4;
          const x = p.x + nx * off, z = p.z + nz * off;
          if (!inside(x, z) || excluded(x, z)) continue;
          lamps.push({ x, z, rot: Math.atan2(-nx, -nz) }); // the arm reaches over the road
        }
      }
    }
    const col = new THREE.Color();
    if (hedges.length) {
      const im = new THREE.InstancedMesh(M.geoBox, M.hedge, hedges.length);
      const o = new THREE.Object3D();
      hedges.forEach((h, i) => {
        o.position.set(h.x, 0, h.z); o.rotation.set(0, h.yaw, 0); o.scale.set(h.wd, h.h, h.len); o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        im.setColorAt(i, col.setHSL(0.26 + h.t * 0.04, 0.45, 0.28 + h.t * 0.08).multiplyScalar(1.8));
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      out.add(im);
    }
    if (lamps.length) {
      let done = false;
      if (lampModel && A) {
        try { out.add(A.instanced(lampModel, lamps, { chunk: 600 })); done = true; } catch { done = false; }
      }
      if (!done) {
        const im = new THREE.InstancedMesh(M.geoLamp, M.lamp, lamps.length);
        const o = new THREE.Object3D();
        lamps.forEach((l, i) => { o.position.set(l.x, 0, l.z); o.rotation.set(0, l.rot, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
        im.castShadow = true;
        im.computeBoundingSphere();
        out.add(im);
      }
    }
    return { hedges: hedges.length, lamps: lamps.length };
  }

  // ---- railways and level crossings ----
  function buildRails(tile, lod, out, M, cs) {
    const rails = idx.rails.get(tileKey(tile.tx, tile.tz)) || [];
    if (!rails.length) return { rails: 0, sleepers: 0, crossings: 0 };
    const rect = { x0: tile.x0 - 2, z0: tile.z0 - 2, x1: tile.x1 + 2, z1: tile.z1 + 2 };
    const g = new GB({ uv: false, color: true });
    const ballast = new THREE.Color(0x7d766c), steel = new THREE.Color(0x8e8f92);
    let sleepers = 0;
    const sleeperSpots = [];
    for (const r of rails) {
      for (const piece of clipPolyline(r.pts, rect)) {
        g.ribbon(piece, -1.9, 1.9, () => 0.03, ballast);
        for (const off of [-0.72, 0.72]) g.ribbon(piece, off - 0.04, off + 0.04, () => 0.2, steel);
      }
      if (lod !== 'near') continue;
      for (let s = 0.4; s < r.len; s += 0.75) {
        let i = 1;
        while (i < r.cum.length - 1 && r.cum[i] < s) i++;
        const a = r.pts[i - 1], b = r.pts[i], L = r.cum[i] - r.cum[i - 1] || 1, t = (s - r.cum[i - 1]) / L;
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (x < tile.x0 || x >= tile.x1 || z < tile.z0 || z >= tile.z1) continue;
        sleeperSpots.push({ x, z, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) }); // local z along the track, the 2.5 m side across it
      }
    }
    if (g.tris) { const m = new THREE.Mesh(drapeGeo(g.build()), M.rail); m.receiveShadow = true; m.geometry.userData.owned = true; out.add(m); }
    if (sleeperSpots.length) {
      const im = new THREE.InstancedMesh(M.geoSleeper, M.sleeper, sleeperSpots.length);
      const o = new THREE.Object3D();
      sleeperSpots.forEach((p, i) => { o.position.set(p.x, 0.03, p.z); o.rotation.set(0, p.yaw, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.add(im);
      sleepers = sleeperSpots.length;
    }
    // level crossings: a striped boom on a post each side of the road, kept raised (static)
    let crossings = 0;
    if (lod === 'near') {
      const cg = new GB({ uv: false, color: true });
      const red = new THREE.Color(0xd42020), white = new THREE.Color(0xf4f4f0), post = new THREE.Color(0x3a3d42);
      for (const c of idx.crossings.get(tileKey(tile.tx, tile.tz)) || []) {
        if (c.barrier === 'none') continue;
        const hit = nearestRoad(c.x, c.z, 20);
        if (!hit) continue;
        const [dx, dz] = hit.dir || [1, 0];
        const hw = hit.way ? halfW(hit.way) : 3.65;
        for (const dir of [1, -1]) {
          // the boom stands on the driver's left of its approach, 4.5 m before the rails
          const ax = dx * dir, az = dz * dir;
          const lx = az, lz = -ax;
          const px = c.x - ax * 4.5 + lx * (hw + 0.8), pz = c.z - az * 4.5 + lz * (hw + 0.8);
          cg.box(px, 0, pz, 0.35, 1.2, 0.35, 0, post);
          const boomL = Math.min(5.5, hw + 1.2);
          for (let s = 0; s < boomL; s += 0.9) cg.box(px, 1.0 + s, pz, 0.16, Math.min(0.9, boomL - s), 0.12, 0, Math.floor(s / 0.9) % 2 ? white : red);
          cs.add(px, pz, 0.5, 0.5, 0);
        }
        crossings++;
      }
      if (cg.tris) { const m = new THREE.Mesh(cg.build(), M.misc); m.castShadow = true; m.geometry.userData.owned = true; out.add(m); }
    }
    return { rails: rails.length, sleepers, crossings };
  }

  // ---- landmarks ----
  function buildLandmarks(tile, lod, out, M, cs) {
    const list = idx.landmarks.get(tileKey(tile.tx, tile.tz)) || [];
    const near = lod === 'near';
    const g = new GB({ uv: false, color: true });
    const stone = new THREE.Color(0xd9d0bd), flint = new THREE.Color(0x6e6a60), brick = new THREE.Color(0x8f4a3c), white = new THREE.Color(0xf2efe8), dark = new THREE.Color(0x2b2e33);
    const deck = new GB({ uv: true, color: false });
    let n = 0;
    for (const lm of list) {
      n++;
      const hit = nearestRoad(lm.x, lm.z, 120);
      const roadYaw = hit ? Math.atan2(hit.dir[0], hit.dir[1]) : 0;
      const toRoad = hit ? [hit.px - lm.x, hit.pz - lm.z] : [0, 1];
      if (lm.type === 'testCentre') {
        // brick box with its long side along the road, the sign facing it, bays in front.
        // The whole site (building, car park, bay lines) is planted at the ground height of its
        // centre: it is the first thing you see in every city, so it must not float or sink.
        const ly = groundY ? groundY(lm.x, lm.z) : 0;
        g.box(lm.x, ly, lm.z, 26, 4.2, 12, roadYaw + Math.PI / 2, brick);
        g.box(lm.x, ly + 4.2, lm.z, 26.6, 0.3, 12.6, roadYaw + Math.PI / 2, dark);
        cs.add(lm.x, lm.z, 26, 12, roadYaw + Math.PI / 2);
        const c = Math.cos(roadYaw + Math.PI / 2), s = Math.sin(roadYaw + Math.PI / 2);
        // which of the two long faces looks at the road
        const nz = [s, c], sgn = Math.sign(nz[0] * toRoad[0] + nz[1] * toRoad[1]) || 1;
        const fx = lm.x + nz[0] * sgn * 6.05, fz = lm.z + nz[1] * sgn * 6.05;
        // Kent's two centres by name; a city region's centre is "Mill Hill (London)" etc.
        const city = /canterbury/i.test(lm.name) ? 'Canterbury' : /herne/i.test(lm.name) ? 'Herne Bay' : (lm.name || 'DVSA').replace(/\s*\(.*\)\s*$/, '');
        if (hasDOM) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.4), new THREE.MeshStandardMaterial({ map: plateTex(`${city} Driving Test Centre`), roughness: 0.6 }));
          sign.position.set(fx, 3.3, fz);
          sign.rotation.y = Math.atan2(nz[0] * sgn, nz[1] * sgn);
          sign.geometry.userData.owned = true; sign.material.userData.owned = true;
          out.add(sign);
        }
        if (hit && hit.dist > 30) {
          // a small car park between the building and the road, 12 bays facing the building
          const lx = lm.x + nz[0] * sgn * 17.5, lz = lm.z + nz[1] * sgn * 17.5;
          g.box(lx, ly + 0.01, lz, 40, 0.006, 20, roadYaw + Math.PI / 2, new THREE.Color(0x55575a));
          for (let i = 0; i < 12; i++) {
            const o = -14.3 + i * 2.6;
            g.box(lx + c * o - nz[0] * sgn * 4, ly + 0.02, lz - s * o - nz[1] * sgn * 4, 0.1, 0.01, 5, roadYaw + Math.PI / 2, white);
          }
        }
      } else if (lm.type === 'cathedral') {
        // nave + quire, two transepts, Bell Harry over the crossing, twin west towers (east-west axis)
        const yaw = 0;
        g.box(lm.x, 0, lm.z, 160, 22, 24, yaw, stone);
        g.box(lm.x, 0, lm.z, 60, 14, 1.2, yaw, stone); // buttress line
        const roofs = new GB({ uv: false, color: true });
        roofs.hip([[lm.x - 80.5, lm.z - 12.5], [lm.x + 80.5, lm.z - 12.5], [lm.x + 80.5, lm.z + 12.5], [lm.x - 80.5, lm.z + 12.5]].reverse(), 22, 9, 11.5, new THREE.Color(0x5a5d63));
        for (const ox of [-10, 42]) {
          g.box(lm.x + ox, 0, lm.z, 16, 22, 60, yaw, stone);
          roofs.hip([[lm.x + ox - 8.2, lm.z - 30.2], [lm.x + ox + 8.2, lm.z - 30.2], [lm.x + ox + 8.2, lm.z + 30.2], [lm.x + ox - 8.2, lm.z + 30.2]].reverse(), 22, 7, 7.8, new THREE.Color(0x5a5d63));
        }
        g.box(lm.x + 16, 0, lm.z, 14, 72, 14, yaw, stone);
        for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) g.box(lm.x + 16 + dx, 72, lm.z + dz, 2, 8, 2, yaw, stone);
        for (const dz of [-9, 9]) { g.box(lm.x - 74, 0, lm.z + dz, 10, 48, 10, yaw, stone); for (const [dx, ddz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) g.box(lm.x - 74 + dx, 48, lm.z + dz + ddz, 1.6, 6, 1.6, yaw, stone); }
        for (const [cx, cz, w, d] of [[lm.x, lm.z, 160, 24], [lm.x - 10, lm.z, 16, 60], [lm.x + 42, lm.z, 16, 60]]) cs.add(cx, cz, w, d, 0);
        if (roofs.tris) { const m = new THREE.Mesh(roofs.build(), M.roof); m.castShadow = m.receiveShadow = true; m.geometry.userData.owned = true; out.add(m); }
      } else if (lm.type === 'clock') {
        g.box(lm.x, 0, lm.z, 4.6, 1.2, 4.6, 0, stone);
        g.box(lm.x, 1.2, lm.z, 3.6, 14, 3.6, 0, new THREE.Color(0xcfc5ae));
        g.box(lm.x, 15.2, lm.z, 4.2, 0.6, 4.2, 0, stone);
        g.box(lm.x, 15.8, lm.z, 3.2, 5, 3.2, 0, new THREE.Color(0xcfc5ae));
        g.box(lm.x, 20.8, lm.z, 3.8, 0.5, 3.8, 0, stone);
        g.box(lm.x, 21.3, lm.z, 2, 1.6, 2, 0, stone);
        g.box(lm.x, 22.9, lm.z, 0.3, 1.4, 0.3, 0, dark);
        cs.add(lm.x, lm.z, 4.6, 4.6, 0);
        if (near && hasDOM) {
          const tex = clockTex();
          for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const f = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
            f.position.set(lm.x + nx * 1.62, 18.3, lm.z + nz * 1.62);
            f.rotation.y = Math.atan2(nx, nz);
            f.geometry.userData.owned = true; f.material.userData.owned = true;
            out.add(f);
          }
        }
      } else if (lm.type === 'reculver') {
        // two square towers joined by the west front, low ruin walls behind
        for (const ox of [-8, 8]) { g.box(lm.x + ox, 0, lm.z, 6.5, 20, 6.5, 0, flint); g.box(lm.x + ox, 20, lm.z, 7.1, 0.7, 7.1, 0, stone); cs.add(lm.x + ox, lm.z, 6.5, 6.5, 0); }
        g.box(lm.x, 0, lm.z, 10, 9, 1.6, 0, flint);
        for (const [ox, oz, w, d] of [[-12, 12, 1.2, 22], [12, 12, 1.2, 22], [0, 22, 24, 1.2]]) { g.box(lm.x + ox, 0, lm.z + oz, w, 1.1, d, 0, flint); cs.add(lm.x + ox, lm.z + oz, w, d, 0); }
      } else if (lm.type === 'pier') {
        // deck on piles from the promenade 300 m out to sea, a pavilion at each end
        const zc = coastZAt(lm.x) ?? lm.z;
        const dirZ = seaDir[1] < 0 ? -1 : 1;
        const z0 = zc + 2 * -dirZ, z1 = zc + 300 * dirZ, zm = (z0 + z1) / 2;
        deck.box(lm.x, 0.9, zm, 9, 0.35, 302, 0, white, { top: true });
        for (let z = z0 + 5 * dirZ; Math.abs(z - z0) < 300; z += 10 * dirZ) for (const ox of [-3.6, 3.6]) g.box(lm.x + ox, -0.6, z, 0.5, 1.6, 0.5, 0, dark);
        for (const ox of [-4.4, 4.4]) { g.box(lm.x + ox, 1.25, zm, 0.08, 1.0, 302, 0, dark); g.box(lm.x + ox, 2.2, zm, 0.12, 0.08, 302, 0, white); }
        g.box(lm.x, 1.25, z0 + 10 * dirZ, 12, 5, 14, 0, white);
        g.box(lm.x, 1.25, z1 - 8 * dirZ, 8, 4, 10, 0, white);
        cs.add(lm.x, z0 + 10 * dirZ, 12, 14, 0);
        cs.add(lm.x, z1 - 8 * dirZ, 8, 10, 0);
      } else if (lm.type === 'pierHead') {
        deck.box(lm.x, 0.8, lm.z, 40, 0.5, 30, 0, white);
        for (let i = 0; i < 12; i++) g.box(lm.x - 16 + (i % 4) * 10.6, -0.6, lm.z - 10 + Math.floor(i / 4) * 10, 0.7, 1.5, 0.7, 0, dark);
      } else if (lm.type === 'harbourArm') {
        // a concrete arm from the shore out to the landmark, with a short return
        const zc = coastZAt(lm.x) ?? lm.z;
        const len = Math.abs(zc - lm.z) + 20, zm = (zc + lm.z) / 2;
        g.box(lm.x, -0.6, zm, 8, 2.6, len, 0, new THREE.Color(0xc9c3b8));
        g.box(lm.x + 18, -0.6, lm.z, 44, 2.6, 8, 0, new THREE.Color(0xc9c3b8));
        cs.add(lm.x, zm, 8, len, 0); cs.add(lm.x + 18, lm.z, 44, 8, 0);
      } else if (lm.type === 'fuel') {
        // canopy on four columns over two pump islands, a kiosk behind, brand colour on the fascia
        const { bg } = brandColours(lm.name);
        const fascia = new THREE.Color(bg);
        const yaw = roadYaw, c = Math.cos(yaw), s = Math.sin(yaw);
        const P = (lx, lz) => [lm.x + lx * c + lz * s, lm.z - lx * s + lz * c];
        const fy = groundY ? groundY(lm.x, lm.z) : 0; // the forecourt is one flat slab on the hill
        for (const [lx, lz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) { const [x, z] = P(lx, lz); g.box(x, fy, z, 0.5, 4.6, 0.5, yaw, white); cs.add(x, z, 0.6, 0.6, yaw); }
        g.box(lm.x, fy + 4.6, lm.z, 17, 0.5, 10, yaw, white);
        g.box(lm.x, fy + 4.5, lm.z, 17.4, 0.7, 10.4, yaw, fascia, { top: false });
        for (const lz of [-2.2, 2.2]) {
          const [x, z] = P(0, lz);
          g.box(x, fy, z, 9, 0.15, 1.4, yaw, new THREE.Color(0xd5d2cb));
          for (const lx of [-2.5, 2.5]) { const [px, pz] = P(lx, lz); g.box(px, fy + 0.15, pz, 0.9, 1.6, 0.6, yaw, new THREE.Color(0xe8e8e4)); cs.add(px, pz, 1.0, 0.8, yaw); }
        }
        const [kx, kz] = P(0, -12);
        g.box(kx, fy, kz, 11, 3.6, 7, yaw, new THREE.Color(0xd8d3c8));
        g.box(kx, fy + 3.6, kz, 11.4, 0.4, 7.4, yaw, fascia);
        cs.add(kx, kz, 11, 7, yaw);
      } else if (lm.type === 'supermarket') {
        const yaw = roadYaw;
        const sy = groundY ? groundY(lm.x, lm.z) : 0;
        g.box(lm.x, sy, lm.z, 44, 7, 30, yaw, new THREE.Color(0xd0c8b8));
        cs.add(lm.x, lm.z, 44, 30, yaw);
        if (near && hasDOM) {
          const { bg, ink } = brandColours(lm.name);
          const tex = fasciaTex(lm.name, bg, ink);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.75), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
          const nx = Math.sin(yaw) * (toRoad[0] * Math.sin(yaw) + toRoad[1] * Math.cos(yaw) >= 0 ? 1 : -1), nz = Math.cos(yaw) * (toRoad[0] * Math.sin(yaw) + toRoad[1] * Math.cos(yaw) >= 0 ? 1 : -1);
          m.position.set(lm.x + nx * 15.1, sy + 4.6, lm.z + nz * 15.1);
          m.rotation.y = Math.atan2(nx, nz);
          m.geometry.userData.owned = true; m.material.userData.owned = true;
          out.add(m);
        }
      }
    }
    if (g.tris) { const m = new THREE.Mesh(g.build(), M.stone); m.castShadow = m.receiveShadow = true; m.geometry.userData.owned = true; out.add(m); }
    if (deck.tris) {
      const dg = deck.build();
      const uv = dg.attributes.uv, p = dg.attributes.position;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2, p.getZ(i) / 2);
      const m = new THREE.Mesh(dg, M.deck); m.castShadow = m.receiveShadow = true; m.geometry.userData.owned = true; out.add(m);
    }
    return n;
  }

  // ---- the coast inside a tile: colliders only (the geometry is static) ----
  function coastColliders(tile, cs) {
    const segs = idx.coast.get(tileKey(tile.tx, tile.tz)) || [];
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const yaw = Math.atan2(dx, dz) + Math.PI / 2; // local x along the segment
      if (typeof colliders?.obb !== 'function' && Math.min(Math.abs(dx), Math.abs(dz)) > 4) continue; // a fat axis box would block the promenade
      cs.add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L, 1.2, yaw);
    }
    return segs.length;
  }

  // ---- tile build ----
  function build(t, lod = 'near') {
    const tx = t.tx ?? Math.floor(t.x0 / TILE), tz = t.tz ?? Math.floor(t.z0 / TILE);
    const tile = { tx, tz, x0: t.x0 ?? tx * TILE, z0: t.z0 ?? tz * TILE, x1: t.x1 ?? (tx + 1) * TILE, z1: t.z1 ?? (tz + 1) * TILE };
    const group = new THREE.Group();
    group.name = `scenery ${tx},${tz} ${lod}`;
    const cs = colliderScope();
    const result = { group, colliders: cs.list, stats: {}, dispose };
    const key = tileKey(tx, tz);
    buildStatics();
    // nothing but water here (and no pier head): skip the whole tile
    const corners = [[tile.x0, tile.z0], [tile.x1, tile.z0], [tile.x0, tile.z1], [tile.x1, tile.z1], [(tile.x0 + tile.x1) / 2, (tile.z0 + tile.z1) / 2]];
    const allSea = seaPoly && corners.every(([x, z]) => inSea(x, z)) && !idx.coast.has(key);
    if (allSea && !idx.landmarks.has(key)) { result.stats.sea = true; return result; }
    const M = shared();
    const rng = mulberry32(tileSeed(tile.tx, tile.tz));
    const bList = (idx.buildings.get(key) || []);
    const st = result.stats;
    const proc = procForTile(tile);
    const all = proc.length ? bList.concat(proc) : bList;
    const bb = buildBuildings(all, tile, lod, rng, M, group, cs);
    st.buildings = bb.counts;
    st.fields = buildFields(tile, lod, group, M);
    st.trees = buildTrees(tile, lod, rng, group, M, all);
    Object.assign(st, buildWayside(tile, lod, rng, group, M, bb.hedges));
    st.hedges -= bb.hedges.length;
    st.gardenHedges = bb.hedges.length;
    Object.assign(st, buildRails(tile, lod, group, M, cs));
    st.landmarks = buildLandmarks(tile, lod, group, M, cs);
    if (lod === 'near') st.coast = coastColliders(tile, cs);
    function dispose() {
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry?.userData?.owned) o.geometry.dispose();
        if (o.material?.userData?.owned) { o.material.map?.dispose(); o.material.dispose(); }
      });
      group.removeFromParent();
      cs.remove();
    }
    return result;
  }

  return {
    build,
    statics,
    landGeometry,
    seaLevelAt,
    /** how many buildings, landmarks etc. the index holds (for checks) */
    /** every procedural house generated so far (for checks) */
    _procHouses: () => [...procCache.values()].flat(),
    counts: { buildings: buildings.length, skipped: buildings.filter((b) => b.skip).length, landmarks: landmarks.length, ways: WAYS.length, coast: coast.length },
    dispose() {
      statics.traverse((o) => { o.geometry?.dispose?.(); });
      statics.removeFromParent();
      statics.clear();
      if (water) water.dispose();
      if (S) {
        for (const m of Object.values(S)) { if (m?.isMaterial) { m.map?.dispose(); m.dispose(); } else if (m?.isBufferGeometry) m.dispose(); }
        S = null;
      }
      staticsBuilt = false;
    },
  };
}
