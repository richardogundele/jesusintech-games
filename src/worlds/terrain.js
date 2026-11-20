import * as THREE from 'three';
import { groundHeight } from './ground.js';

// The real hills under a region: the EU-DEM 25 m grid baked into region.json by
// tools/region-data.mjs, plus everything needed to put the world on top of it.
//
// The one rule that makes this work: THE GROUND IS TRIANGLES, AND EVERYTHING USES THE SAME ONES.
// heightAt is planar-per-triangle on the grid's own anti-diagonal split, and landGeometry builds
// that exact triangulation. A bilinear heightAt would disagree with the drawn land by ~0.15 m on
// the cell diagonals, which is twice the height the tarmac sits above the grass — you would see
// grass poking through the road. Planar means the car, the land and the draped roads agree exactly.
//
// Cell (i, j) with corners h00 h10 h01 h11 splits on the anti-diagonal (u + v = 1):
//     h00 ---- h10        lower triangle: h00 h10 h01   (u + v <= 1)
//      |  \     |         upper triangle: h11 h10 h01   (u + v >  1)
//     h01 ---- h11

/** makeTerrain(data) -> { heightAt, gradeAt, landGeometry, range, has } */
export function makeTerrain(data) {
  const T = data && data.terrain;
  if (!T) {
    // no grid (Kent, the motorway, the arena): dead flat, and every caller stays on its old path
    const zero = () => 0;
    return { has: false, heightAt: zero, gradeAt: zero, landGeometry: () => null, range: 0 };
  }
  const { x0, z0, step, nx, nz } = T;
  const x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;

  // ground height at a world point (ground.js, shared with the road network's bridge decks)
  const heightAt = groundHeight(T);

  /** rise per metre along `heading` — what the drivetrain turns into gravity */
  function gradeAt(x, z, heading) {
    const dx = Math.sin(heading), dz = Math.cos(heading);
    return (heightAt(x + dx, z + dz) - heightAt(x - dx, z - dz)) / 2;
  }

  /**
   * The land as the grid's own triangles, so it agrees with heightAt everywhere.
   * `drop` sinks it slightly below the roads to absorb tessellation error (the tarmac sits ~0.02 m
   * up, so a small drop keeps grass from poking through on a slope).
   * Outside the grid it stays at 0, which matches heightAt's clamp.
   */
  function landGeometry(drop = 0.12, pad = 1200, skip = null) {
    const px0 = x0 - pad, pz0 = z0 - pad, px1 = x1 + pad, pz1 = z1 + pad;
    // one ring of padding quads round the grid keeps the ground going out to the jet centre
    const xs = [px0, ...Array.from({ length: nx }, (_, i) => x0 + i * step), px1];
    const zs = [pz0, ...Array.from({ length: nz }, (_, j) => z0 + j * step), pz1];
    const W = xs.length, H = zs.length;
    const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = xs[i], z = zs[j];
      pos[k * 3] = x; pos[k * 3 + 1] = heightAt(x, z) - drop; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let n = 0;
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
      // a region with a coast cuts quads whose centre is in the sea, so the water shows through
      if (skip && skip((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)) continue;
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      // the SAME anti-diagonal split heightAt uses: (a,b,c) then (d,c,b)
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = d; idx[n++] = b; idx[n++] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  return { has: true, heightAt, gradeAt, landGeometry, range: T.max - T.min };
}

// ---------- putting built geometry onto the ground ----------

/**
 * Split any triangle whose edges are longer than `maxEdge`, so a long straight road picks up
 * the hill between its ends instead of cutting through it as a chord.
 * A 300 m street whose grade goes 0.02 -> 0.10 misses by about 6 m undrapped; at 8 m edges it
 * tracks the ground to a few centimetres. Operates on a non-indexed geometry and returns one.
 */
export function tessellate(geom, maxEdge = 8, maxTris = 200000) {
  if (!Number.isFinite(maxEdge)) return geom; // Infinity = caller says the mesh is already dense
  let g = geom.index ? geom.toNonIndexed() : geom;
  const max2 = maxEdge * maxEdge;
  const names = Object.keys(g.attributes);
  // Each pass halves only the worst edge of each offending triangle, so a 300 m edge needs ~6
  // passes and the thin slivers it leaves need a few more. Run until nothing is over length.
  for (let pass = 0; pass < 16; pass++) {
    if (g.attributes.position.array.length / 9 > maxTris) break;
    const src = g.attributes.position.array;
    const tris = src.length / 9;
    // which triangles need splitting, and on which edge
    const split = new Int8Array(tris);
    let need = 0;
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      let worst = -1, worstD = max2;
      for (let e = 0; e < 3; e++) {
        const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
        const dx = src[a] - src[b], dy = src[a + 1] - src[b + 1], dz = src[a + 2] - src[b + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d > worstD) { worstD = d; worst = e; }
      }
      split[t] = worst;
      if (worst >= 0) need++;
    }
    if (!need) break;
    // each split triangle becomes two, cut at the midpoint of its longest edge
    const out = {};
    for (const name of names) {
      const a = g.attributes[name], it = a.itemSize;
      out[name] = { src: a.array, itemSize: it, dst: new Float32Array((tris + need) * 3 * it), n: 0 };
    }
    const push = (o, t, v) => { // copy vertex v of triangle t
      const s = (t * 3 + v) * o.itemSize;
      for (let c = 0; c < o.itemSize; c++) o.dst[o.n++] = o.src[s + c];
    };
    const pushMid = (o, t, v0, v1) => {
      const s0 = (t * 3 + v0) * o.itemSize, s1 = (t * 3 + v1) * o.itemSize;
      for (let c = 0; c < o.itemSize; c++) o.dst[o.n++] = (o.src[s0 + c] + o.src[s1 + c]) / 2;
    };
    for (let t = 0; t < tris; t++) {
      const e = split[t];
      for (const name of names) {
        const o = out[name];
        if (e < 0) { push(o, t, 0); push(o, t, 1); push(o, t, 2); continue; }
        const a = e, b = (e + 1) % 3, c = (e + 2) % 3;
        push(o, t, a); pushMid(o, t, a, b); push(o, t, c);   // a, m, c
        pushMid(o, t, a, b); push(o, t, b); push(o, t, c);   // m, b, c
      }
    }
    const next = new THREE.BufferGeometry();
    for (const name of names) next.setAttribute(name, new THREE.BufferAttribute(out[name].dst, out[name].itemSize));
    if (g !== geom) g.dispose();
    g = next;
  }
  return g;
}

/**
 * Cut every triangle along the folds of the ground it lies across, so each piece sits on one flat
 * triangle of the land. The ground is planar inside a grid triangle and bent only along the grid's
 * lines and each cell's anti-diagonal (ground.js), so a piece cut there and lifted by the ground
 * height at its corners lies exactly its own small height above the ground, all over.
 *
 * Without this a triangle that spans a fold is a chord across it: under the ground where the land
 * is a ridge, over it where it is a valley. Roads were sampled every 6 m and left at that, and over
 * the 100 m grid of Driving City between 1.1% and 3.8% of a town's road-surface triangles were more
 * than a centimetre off their own height, the worst 40 cm: the land came up through the tarmac on
 * the hills (269 triangles in the third of Leeds's tiles that were measured), and paint laid 1 cm
 * above the tarmac from triangles of its own could go under it.
 *
 * grid: { x0, z0, step, nx, nz } (heightAt.grid). Takes an indexed or a plain geometry and returns an
 * indexed one; a vertex made on an edge two triangles share is shared by them, so a ribbon stays one
 * smooth surface. Every attribute is interpolated.
 */
export function splitOnFolds(geom, grid) {
  const { x0, z0, step, nx, nz } = grid;
  const names = Object.keys(geom.attributes), pos = geom.attributes.position.array, nv0 = geom.attributes.position.count;
  const index = geom.index ? geom.index.array : null, nt = index ? index.length / 3 : nv0 / 3;
  // grid coordinates of every vertex: u along x, v along z, in cells
  const gu = new Float64Array(nv0), gv = new Float64Array(nv0);
  for (let i = 0; i < nv0; i++) { gu[i] = (pos[i * 3] - x0) / step; gv[i] = (pos[i * 3 + 2] - z0) / step; }
  const eu = [], ev = []; // ... and of the vertices made here
  const U = (i) => (i < nv0 ? gu[i] : eu[i - nv0]), V = (i) => (i < nv0 ? gv[i] : ev[i - nv0]);
  const added = names.map((n) => ({ src: geom.attributes[n].array, size: geom.attributes[n].itemSize, out: [] }));
  let nv = nv0;
  const made = new Map(); // "a|b|family|line" -> the vertex where edge a-b crosses that line
  const cross = (a, b, da, db, fam, c) => {
    const lo = a < b ? a : b, hi = a < b ? b : a, key = `${lo}|${hi}|${fam}|${c}`;
    let m = made.get(key);
    if (m !== undefined) return m;
    const t = da / (da - db); // from a towards b
    for (const A of added) for (let k = 0; k < A.size; k++) {
      const pa = a < nv0 ? A.src[a * A.size + k] : A.out[(a - nv0) * A.size + k], pb = b < nv0 ? A.src[b * A.size + k] : A.out[(b - nv0) * A.size + k];
      A.out.push(pa + (pb - pa) * t);
    }
    eu.push(U(a) + (U(b) - U(a)) * t); ev.push(V(a) + (V(b) - V(a)) * t);
    m = nv++;
    made.set(key, m);
    return m;
  };
  const EPS = 1e-6;
  const F = [(i) => U(i), (i) => V(i), (i) => U(i) + V(i)]; // the three families of fold: u = c, v = c, u + v = c
  const hiLine = [nx - 1, nz - 1, nx + nz - 2];
  const idx = [];
  let polys = [], next = [];
  for (let t = 0; t < nt; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    // the lines of each family that pass strictly between this triangle's corners
    let any = false;
    const range = [];
    for (let f = 0; f < 3; f++) {
      const fa = F[f](a), fb = F[f](b), fc = F[f](c), lo = Math.min(fa, fb, fc), hi = Math.max(fa, fb, fc);
      const c0 = Math.max(0, Math.floor(lo + EPS) + 1), c1 = Math.min(hiLine[f], Math.ceil(hi - EPS) - 1);
      range.push(c0, c1);
      if (c1 >= c0) any = true;
    }
    if (!any) { idx.push(a, b, c); continue; }
    polys.length = 0; polys.push([a, b, c]);
    for (let f = 0; f < 3; f++) for (let line = range[f * 2]; line <= range[f * 2 + 1]; line++) {
      next.length = 0;
      for (const poly of polys) {
        const n = poly.length, d = new Array(n);
        let neg = false, plus = false;
        for (let i = 0; i < n; i++) { d[i] = F[f](poly[i]) - line; if (d[i] < -EPS) neg = true; else if (d[i] > EPS) plus = true; }
        if (!neg || !plus) { next.push(poly); continue; }
        const A = [], B = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, di = d[i], dj = d[j];
          if (di <= EPS) A.push(poly[i]);
          if (di >= -EPS) B.push(poly[i]);
          if ((di < -EPS && dj > EPS) || (di > EPS && dj < -EPS)) { const m = cross(poly[i], poly[j], di, dj, f, line); A.push(m); B.push(m); }
        }
        if (A.length >= 3) next.push(A);
        if (B.length >= 3) next.push(B);
      }
      const swap = polys; polys = next.slice(); next = swap;
    }
    for (const poly of polys) for (let k = 1; k < poly.length - 1; k++) idx.push(poly[0], poly[k], poly[k + 1]);
  }
  if (nv === nv0) return geom; // nothing lay across a fold
  const out = new THREE.BufferGeometry();
  names.forEach((n, i) => {
    const A = added[i], arr = new Float32Array(nv * A.size);
    arr.set(A.src.subarray ? A.src.subarray(0, nv0 * A.size) : A.src.slice(0, nv0 * A.size));
    arr.set(A.out, nv0 * A.size);
    out.setAttribute(n, new THREE.BufferAttribute(arr, A.size));
  });
  out.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  return out;
}

/**
 * Lay a ground-hugging geometry (tarmac, markings, kerbs, pavement) onto the hill: every vertex
 * keeps its own small height above the road surface and gains the ground height at its x,z.
 * Where the height function says where the ground folds (heightAt.grid), the geometry is cut along
 * the folds first and so lies exactly on the land; otherwise it is tessellated to `maxEdge` so that
 * long triangles follow the slope. Returns the geometry to use.
 */
export function drapeGeometry(geom, groundY, maxEdge = 8) {
  const g = groundY.grid ? splitOnFolds(geom, groundY.grid) : tessellate(geom, maxEdge);
  const pos = g.attributes.position, a = pos.array;
  for (let i = 0; i < a.length; i += 3) a[i + 1] += groundY(a[i], a[i + 2]);
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
