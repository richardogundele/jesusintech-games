import * as THREE from 'three';

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
  const { x0, z0, step, nx, nz, heights } = T;
  const x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;
  const at = (i, j) => heights[j * nx + i];

  /** ground height at a world point; 0 outside the grid, so the jet centre past it stays flat */
  function heightAt(x, z) {
    if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
    const fx = (x - x0) / step, fz = (z - z0) / step;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= nx - 1) i = nx - 2; if (i < 0) i = 0;
    if (j >= nz - 1) j = nz - 2; if (j < 0) j = 0;
    const u = fx - i, v = fz - j;
    const h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
    // planar inside whichever triangle the point falls in
    return u + v <= 1
      ? h00 + u * (h10 - h00) + v * (h01 - h00)
      : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

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
  function landGeometry(drop = 0.12, pad = 1200) {
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
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      // the SAME anti-diagonal split heightAt uses: (a,b,c) then (d,c,b)
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = d; idx[n++] = b; idx[n++] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
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
 * Lay a ground-hugging geometry (tarmac, markings, kerbs, pavement) onto the hill: every vertex
 * keeps its own small height above the road surface and gains the ground height at its x,z.
 * Tessellates first so long triangles follow the slope. Returns the geometry to use.
 */
export function drapeGeometry(geom, groundY, maxEdge = 8) {
  const g = tessellate(geom, maxEdge);
  const pos = g.attributes.position, a = pos.array;
  for (let i = 0; i < a.length; i += 3) a[i + 1] += groundY(a[i], a[i + 2]);
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
