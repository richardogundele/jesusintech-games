import * as THREE from 'three';

// UK road-marking patterns (TSRGD 2016 diagram numbers, sizes from signs.json) and the small
// geometry kit roads.js draws them with. Everything here is pure geometry: no materials, no
// assets, so it runs under node for triangle counts and tests.
//
// Conventions (same as the rest of the game): x east, z south, y up; a way's frames run in the
// way's point order; `leftOf((dx,dz)) = (dz,-dx)`; lateral offsets are positive on the LEFT of the
// frame direction. Marks along a way are laid from an anchor (a junction, a run start) so a
// warning line always ends with a full mark at the give-way line.

export const LW = 3.65;            // standard lane
export const LW_RING_SMALL = 3.5;  // circulating lane on rings under 12 m (widened for easier driving)
export const PAVE_W = 2.0;         // pavement
export const KERB_W = 0.15;
export const KERB_H = 0.13;
export const Y_ROAD = 0.02;
export const Y_MARK = 0.03;
export const Y_DECAL = 0.032;
export const Y_PAVE = KERB_H;

export const leftOf = (dx, dz) => [dz, -dx];

/** speed band as a string key the sign tables use */
export function band(limit) {
  const l = limit || 30;
  if (l <= 20) return '20';
  if (l <= 30) return '30';
  if (l <= 40) return '40';
  if (l <= 50) return '50';
  if (l <= 60) return '60';
  return '70';
}
/** 6 m module up to 40 mph, 9 m above (TSM5) */
export const moduleFor = (limit) => ((limit || 30) <= 40 ? 6 : 9);

// pattern = { mark, gap, w } in metres
export const PATTERNS = {
  centre_line_1008: { mark: 2, gap: 4, w: 0.1 },
  centre_line_1008_1: { mark: 3, gap: 6, w: 0.1 },
  hazard_warning_1004: { mark: 4, gap: 2, w: 0.1 },
  hazard_warning_1004_1: { mark: 6, gap: 3, w: 0.1 },
  lane_line_1005: { mark: 1, gap: 5, w: 0.1 },
  lane_line_1005_1: { mark: 2, gap: 7, w: 0.1 },
  edge_line_1009A: { mark: 0.6, gap: 0.3, w: 0.1 },
  edge_broken_1010: { mark: 1, gap: 1, w: 0.1 },
  give_way_1003A: { mark: 0.6, gap: 0.3, w: 0.2, lines: 2, between: 0.3 },
  roundabout_give_way_1003_1: { mark: 1, gap: 1, w: 0.2 },
  mini_roundabout_give_way_1003_3: { mark: 0.7, gap: 0.3, w: 0.5 },
  zebra_give_way: { mark: 0.5, gap: 0.5, w: 0.2 },
  stop_line_1002_1: { w: 0.4 },
  stop_line_1001: { w: 0.3 },
  double_yellow_1018_1: { w: 0.075, between: 0.075 },
  zigzag_1001: { markLen: 2, w: 0.1, n: 8, amp: 0.15 },
};

/** centre line for a speed limit: 1008 short module, 1008.1 long module */
export const centrePattern = (limit, wide = false) => ({ ...(moduleFor(limit) === 6 ? PATTERNS.centre_line_1008 : PATTERNS.centre_line_1008_1), w: wide ? 0.15 : 0.1 });
/** hazard warning line (bends, junction approaches, roundabout approaches) */
export const hazardPattern = (limit, wide = false) => ({ ...(moduleFor(limit) === 6 ? PATTERNS.hazard_warning_1004 : PATTERNS.hazard_warning_1004_1), w: wide || (limit || 30) >= 70 ? 0.15 : 0.1 });
/** lane line between lanes of the same direction */
export const lanePattern = (limit) => ({ ...(moduleFor(limit) === 6 ? PATTERNS.lane_line_1005 : PATTERNS.lane_line_1005_1), w: (limit || 30) >= 70 ? 0.15 : 0.1 });
/** edge line width (1012.1): 0.1 single carriageway, 0.15 duals, 0.2 nearside on 70 mph duals */
export const edgeWidth = (limit, dual = false, nearside = false) => (dual ? (nearside && (limit || 30) >= 70 ? 0.2 : 0.15) : (limit || 30) >= 70 ? 0.15 : 0.1);
/** how far before a hazard the warning line replaces the centre line */
export const hazardReach = (limit) => ((limit || 30) <= 40 ? 100 : 150);
/** lane arrow length by band (1038) */
export const arrowLength = (limit) => ((limit || 30) <= 40 ? 4 : (limit || 30) <= 60 ? 6 : 9);
/** worded-marking height by band (1024 / 1035) */
export const wordHeight = (limit) => ((limit || 30) <= 40 ? 1.6 : 2.8);

/**
 * Mark intervals of a dash pattern inside [s0, s1], laid out from `anchor` in both directions so
 * the mark nearest the anchor touches it. Returns [[a, b], ...] sorted by a.
 */
export function marks(s0, s1, pat, anchor = s0) {
  const out = [];
  if (s1 - s0 < 0.05) return out;
  const mod = pat.mark + pat.gap;
  // forward from the anchor
  let k = Math.max(0, Math.floor((s0 - anchor) / mod));
  for (let a = anchor + k * mod; a < s1; a += mod) {
    const b = a + pat.mark;
    if (b <= s0) continue;
    out.push([Math.max(a, s0), Math.min(b, s1)]);
  }
  // backward from the anchor
  k = Math.max(0, Math.floor((anchor - s1) / mod));
  for (let b = anchor - k * mod; b > s0; b -= mod) {
    const a = b - pat.mark;
    if (a >= s1) continue;
    out.push([Math.max(a, s0), Math.min(b, s1)]);
  }
  out.sort((p, q) => p[0] - q[0]);
  return out.filter((m) => m[1] - m[0] > 0.04);
}

/** [s0,s1] intervals minus a list of cut intervals (both sorted or not) */
export function subtract(intervals, cuts) {
  if (!cuts.length) return intervals;
  const out = [];
  for (let [a, b] of intervals) {
    const parts = [[a, b]];
    for (const [c0, c1] of cuts) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const [p0, p1] = parts[i];
        if (c1 <= p0 || c0 >= p1) continue;
        parts.splice(i, 1);
        if (c0 > p0) parts.push([p0, c0]);
        if (c1 < p1) parts.push([c1, p1]);
      }
    }
    for (const p of parts) if (p[1] - p[0] > 0.05) out.push(p);
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** merge overlapping intervals */
export function union(intervals) {
  const s = intervals.filter((i) => i[1] > i[0]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push([i[0], i[1]]);
  }
  return out;
}

// ---------- geometry batch: one BufferGeometry per material per tile ----------

/**
 * Accumulates triangles in flat arrays, then builds a single indexed BufferGeometry. Flat ground
 * pieces get an up normal; boxes and walls get face normals. UVs are world xz by default so the
 * asphalt and paving textures tile at a real size and continue across tile seams.
 */
export class GeoBatch {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.n = 0; }
  get triangles() { return this.idx.length / 3; }
  get empty() { return this.idx.length === 0; }
  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
    return this.n++;
  }
  /** flat triangle (points [x, z]); winding is fixed so the normal points up */
  tri(p, q, r, y, uvf = null) {
    const cy = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
    if (Math.abs(cy) < 1e-7) return;
    if (cy < 0) [q, r] = [r, q];
    const U = (pt) => (uvf ? uvf(pt) : pt);
    const a = U(p), b = U(q), c = U(r);
    const i = this.vert(p[0], y, p[1], 0, 1, 0, a[0], a[1]);
    const j = this.vert(q[0], y, q[1], 0, 1, 0, b[0], b[1]);
    const k = this.vert(r[0], y, r[1], 0, 1, 0, c[0], c[1]);
    this.idx.push(i, j, k);
  }
  /** flat quad from four corners going round (points [x, z]) */
  quad(p0, p1, p2, p3, y, uvf = null) {
    this.tri(p0, p1, p2, y, uvf);
    this.tri(p0, p2, p3, y, uvf);
  }
  /** flat polygon (any simple shape, points [x, z]); n <= 4 drawn directly, else ear-clipped */
  poly(pts, y, uvf = null) {
    if (pts.length < 3) return;
    if (pts.length === 3) return this.tri(pts[0], pts[1], pts[2], y, uvf);
    if (pts.length === 4) return this.quad(pts[0], pts[1], pts[2], pts[3], y, uvf);
    const v2 = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch { tris = []; }
    for (const [a, b, c] of tris) this.tri(pts[a], pts[b], pts[c], y, uvf);
  }
  /** fan from a centre (convex shapes: discs, teardrops) */
  fan(c, ring, y, uvf = null, closed = false) {
    const n = ring.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) this.tri(c, ring[i], ring[(i + 1) % n], y, uvf);
  }
  /** disc */
  disc(cx, cz, r, y, segs = 32, uvf = null) {
    const ring = [];
    for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    this.fan([cx, cz], ring, y, uvf, true);
  }
  /** annulus sector: angles in radians, a0 -> a1 going the positive way */
  ring(cx, cz, r0, r1, a0, a1, y, segs = null, uvf = null) {
    const span = a1 - a0;
    const n = segs || Math.max(2, Math.ceil(Math.abs(span) / (Math.PI / 24)));
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (span * i) / n, t1 = a0 + (span * (i + 1)) / n;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      this.quad([cx + c0 * r0, cz + s0 * r0], [cx + c1 * r0, cz + s1 * r0], [cx + c1 * r1, cz + s1 * r1], [cx + c0 * r1, cz + s0 * r1], y, uvf);
    }
  }
  /**
   * Vertical wall along a 2-D polyline from y0 to y1. `facing` = +1 faces the left of the
   * polyline direction, -1 the right (lighting only; culling is off for walls' twin faces).
   */
  wall(pts, y0, y1, facing = 1, uvScale = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 1e-4) continue;
      const nx = (dz / L) * facing, nz = (-dx / L) * facing;
      const u0 = pts[i][2] ?? 0, u1 = pts[i + 1][2] ?? L;
      const a0 = this.vert(ax, y0, az, nx, 0, nz, u0 * uvScale, 0);
      const a1 = this.vert(bx, y0, bz, nx, 0, nz, u1 * uvScale, 0);
      const b1 = this.vert(bx, y1, bz, nx, 0, nz, u1 * uvScale, (y1 - y0) * uvScale);
      const b0 = this.vert(ax, y1, az, nx, 0, nz, u0 * uvScale, (y1 - y0) * uvScale);
      // winding so the face normal agrees with `facing`
      if (facing > 0) this.idx.push(a0, b1, a1, a0, b0, b1);
      else this.idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  /** oriented box: centre (cx, cz), bottom y0, size w (across) x h x d (along yaw), yaw as atan2(dx, dz) */
  box(cx, y0, cz, w, h, d, yaw = 0) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const X = (lx, lz) => [cx + lx * cy + lz * sy, cz - lx * sy + lz * cy];
    const hw = w / 2, hd = d / 2, y1 = y0 + h;
    const corners = [X(-hw, -hd), X(hw, -hd), X(hw, hd), X(-hw, hd)];
    // top
    this.quad(corners[0], corners[1], corners[2], corners[3], y1);
    // sides: the corners go round (-,-) (+,-) (+,+) (-,+) in the box frame, so the outward
    // normal of edge a->b is leftOf(b - a); (i0, i2, i1) is the winding that faces that way
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 1e-6) continue;
      const nx = ez / L, nz = -ex / L;
      const i0 = this.vert(a[0], y0, a[1], nx, 0, nz, 0, 0), i1 = this.vert(b[0], y0, b[1], nx, 0, nz, L, 0);
      const i2 = this.vert(b[0], y1, b[1], nx, 0, nz, L, h), i3 = this.vert(a[0], y1, a[1], nx, 0, nz, 0, h);
      this.idx.push(i0, i2, i1, i0, i3, i2);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- frames along a way ----------
// frame = { x, z, tx, tz (unit tangent), nx, nz (unit left normal), mx, mz (miter-scaled left
// normal for constant-width offsets), s (arc length), hwL, hwR (half widths left / right) }

/** index i with frames[i].s <= s < frames[i+1].s (clamped) */
export function frameIndex(frames, s) {
  let lo = 0, hi = frames.length - 2;
  if (s <= frames[0].s) return 0;
  if (s >= frames[hi + 1].s) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].s <= s) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** interpolated frame at arc length s (clamped to the way) */
export function frameAt(frames, s) {
  const i = frameIndex(frames, s);
  const a = frames[i], b = frames[Math.min(frames.length - 1, i + 1)];
  const span = b.s - a.s;
  const t = span > 1e-6 ? Math.min(1, Math.max(0, (s - a.s) / span)) : 0;
  let nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  return {
    x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    tx: -nz, tz: nx, nx, nz, mx: nx, mz: nz, // n = leftOf(t) = (tz, -tx), so t = (-nz, nx)
    s, hwL: a.hwL + (b.hwL - a.hwL) * t, hwR: a.hwR + (b.hwR - a.hwR) * t,
  };
}

/** point at lateral offset o (left positive) of a frame, using the miter normal */
export const offsetPt = (f, o) => [f.x + f.mx * o, f.z + f.mz * o];
const resolveOff = (o, f) => (typeof o === 'function' ? o(f) : o);

/**
 * Ribbon between two lateral offsets over consecutive frames. keep(i) decides per frame pair
 * (tile clipping, cuts); uvf maps [x, z] to uv (default world xz).
 */
export function ribbon(batch, frames, o0, o1, y, keep = null, uvf = null) {
  for (let i = 0; i < frames.length - 1; i++) {
    if (keep && !keep(i)) continue;
    const a = frames[i], b = frames[i + 1];
    batch.quad(offsetPt(a, resolveOff(o0, a)), offsetPt(b, resolveOff(o0, b)), offsetPt(b, resolveOff(o1, b)), offsetPt(a, resolveOff(o1, a)), y, uvf);
  }
}

/**
 * Ribbon over exact arc-length runs [[a, b], ...]: the quads start and end precisely at the run
 * ends (trims at junctions, fillet tangent points) instead of at the nearest frame.
 * inBox(x, z) drops quads with both samples outside the tile.
 */
export function ribbonRuns(batch, frames, o0, o1, y, runs, uvf = null, inBox = null) {
  for (const [a, b] of runs) {
    if (b - a < 0.02) continue;
    const S = samplesBetween(frames, a, b);
    for (let i = 0; i < S.length - 1; i++) {
      const f0 = S[i], f1 = S[i + 1];
      if (inBox && !inBox(f0.x, f0.z) && !inBox(f1.x, f1.z)) continue;
      batch.quad(offsetPt(f0, resolveOff(o0, f0)), offsetPt(f1, resolveOff(o0, f1)), offsetPt(f1, resolveOff(o1, f1)), offsetPt(f0, resolveOff(o1, f0)), y, uvf);
    }
  }
}

/** split an interval of a way into the pieces inside [0, len]; a closed ring wraps round */
export function wrapInterval(lo, hi, len, closed = false) {
  if (hi - lo >= len) return [[0, len]];
  if (!closed) return lo < hi ? [[Math.max(0, lo), Math.min(len, hi)]].filter((p) => p[1] - p[0] > 0.02) : [];
  const span = hi - lo;
  lo = ((lo % len) + len) % len;
  hi = lo + span;
  return hi <= len ? [[lo, hi]] : [[lo, len], [0, hi - len]];
}

/** samples along [a, b]: the frames strictly inside plus the two ends */
export function samplesBetween(frames, a, b) {
  const out = [frameAt(frames, a)];
  const i0 = frameIndex(frames, a), i1 = frameIndex(frames, b);
  for (let i = i0 + 1; i <= i1; i++) if (frames[i].s > a && frames[i].s < b) out.push(frames[i]);
  out.push(frameAt(frames, b));
  return out;
}

/** a strip of width w centred on lateral offset `off` from arc length a to b (follows the curve) */
export function stripAlong(batch, frames, a, b, off, w, y, uvf = null) {
  const S = samplesBetween(frames, a, b);
  for (let i = 0; i < S.length - 1; i++) {
    const f0 = S[i], f1 = S[i + 1];
    const c0 = resolveOff(off, f0), c1 = resolveOff(off, f1);
    batch.quad(offsetPt(f0, c0 + w / 2), offsetPt(f1, c1 + w / 2), offsetPt(f1, c1 - w / 2), offsetPt(f0, c0 - w / 2), y, uvf);
  }
}

/** dashes of a pattern along the way between s0 and s1, laid from `anchor`; test(mid s) can skip marks */
export function dashesAlong(batch, frames, s0, s1, pat, off, anchor, y, test = null) {
  for (const [a, b] of marks(s0, s1, pat, anchor)) {
    if (test && !test((a + b) / 2)) continue;
    stripAlong(batch, frames, a, b, off, pat.w, y);
  }
}

/** a bar across the way at arc length s between lateral offsets o0 and o1, `w` deep along the way */
export function transverse(batch, frames, s, o0, o1, w, y) {
  const f = frameAt(frames, s);
  const a = offsetPt(f, o0), b = offsetPt(f, o1);
  const hx = f.tx * w / 2, hz = f.tz * w / 2;
  batch.quad([a[0] - hx, a[1] - hz], [b[0] - hx, b[1] - hz], [b[0] + hx, b[1] + hz], [a[0] + hx, a[1] + hz], y);
}

/** broken bar across the way (give-way lines): marks laid from o0 towards o1 */
export function transverseDashes(batch, frames, s, o0, o1, w, mark, gap, y) {
  const f = frameAt(frames, s);
  const dir = Math.sign(o1 - o0) || 1, span = Math.abs(o1 - o0);
  const hx = f.tx * w / 2, hz = f.tz * w / 2;
  for (let d = 0; d < span - 0.05; d += mark + gap) {
    const e = Math.min(span, d + mark);
    const a = offsetPt(f, o0 + dir * d), b = offsetPt(f, o0 + dir * e);
    batch.quad([a[0] - hx, a[1] - hz], [b[0] - hx, b[1] - hz], [b[0] + hx, b[1] + hz], [a[0] + hx, a[1] + hz], y);
  }
}

/**
 * Zig-zag (1001.3/1001.4): n marks of `len` along the way starting at s0 in direction dir (+1/-1),
 * zig-zagging about lateral offset `off` with amplitude `amp`, then the 0.6 x 0.2 terminal bar.
 */
export function zigzag(batch, frames, s0, dir, off, amp, y, n = 8, len = 2, w = 0.1) {
  for (let i = 0; i < n; i++) {
    const a = s0 + dir * i * len, b = s0 + dir * (i + 1) * len;
    const oa = off + (i % 2 ? amp : -amp), ob = off + (i % 2 ? -amp : amp);
    const fa = frameAt(frames, a), fb = frameAt(frames, b);
    const pa = offsetPt(fa, oa), pb = offsetPt(fb, ob);
    const dx = pb[0] - pa[0], dz = pb[1] - pa[1], L = Math.hypot(dx, dz) || 1;
    const nx = (dz / L) * w / 2, nz = (-dx / L) * w / 2;
    batch.quad([pa[0] + nx, pa[1] + nz], [pb[0] + nx, pb[1] + nz], [pb[0] - nx, pb[1] - nz], [pa[0] - nx, pa[1] - nz], y);
  }
  transverse(batch, frames, s0 + dir * n * len, off - 0.3, off + 0.3, 0.2, y);
}

/**
 * Hatching (1040) between two edge polylines given as functions of t in [0, 1]:
 * L(t), R(t) -> [x, z]. 45 degree strokes `w` wide every `spacing` metres, plus the boundary
 * lines when `boundary` is set ({ w, solid: true } or a dash pattern).
 */
export function hatch(batch, L, R, length, y, { spacing = 3, w = 0.15, boundary = null, steps = 48 } = {}) {
  // boundary lines along each edge
  if (boundary) {
    for (const E of [L, R]) {
      const pts = [];
      for (let i = 0; i <= steps; i++) pts.push(E(i / steps));
      strokePolyline(batch, pts, boundary.w || 0.15, y, boundary.solid === false ? boundary : null);
    }
  }
  // diagonals: from the left edge at t to the right edge at t + (local width) along
  for (let s = spacing * 0.5; s < length; s += spacing) {
    const t0 = s / length;
    const a = L(t0), r0 = R(t0);
    const width = Math.hypot(r0[0] - a[0], r0[1] - a[1]);
    if (width < 0.5) continue;
    const t1 = Math.min(1, (s + width) / length);
    const b = R(t1);
    strokeSeg(batch, a, b, w, y);
  }
}

/** chevrons (1042) between two edge polylines: V shapes with the apex upstream (toward the driver) */
export function chevrons(batch, L, R, length, y, { spacing = 6, stroke = 0.45, upstreamSign = 1, arm = 3.0 } = {}) {
  for (let s = spacing * 0.6; s < length - 0.5; s += spacing) {
    const ta = s / length, tb = Math.min(1, Math.max(0, (s + upstreamSign * arm) / length));
    const l = L(ta), r = R(ta);
    const apex = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
    const width = Math.hypot(r[0] - l[0], r[1] - l[1]);
    if (width < 1.2) continue;
    strokeSeg(batch, apex, L(tb), stroke, y);
    strokeSeg(batch, apex, R(tb), stroke, y);
  }
}

/** a stroke `w` wide from a to b (points [x, z]) */
export function strokeSeg(batch, a, b, w, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 1e-4) return;
  const nx = (dz / L) * w / 2, nz = (-dx / L) * w / 2;
  batch.quad([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz], y);
}

/** stroke along a polyline (solid, or dashed when pat = { mark, gap }) */
export function strokePolyline(batch, pts, w, y, pat = null) {
  if (!pat) { for (let i = 0; i < pts.length - 1; i++) strokeSeg(batch, pts[i], pts[i + 1], w, y); return; }
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = 0;
    while (d < L) {
      const phase = (s + d) % (pat.mark + pat.gap);
      if (phase < pat.mark) {
        const e = Math.min(L, d + (pat.mark - phase));
        strokeSeg(batch, [a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L], [a[0] + (b[0] - a[0]) * e / L, a[1] + (b[1] - a[1]) * e / L], w, y);
        d = e;
      } else d += (pat.mark + pat.gap) - phase;
    }
    s += L;
  }
}

/**
 * Curved arrow (mini-roundabout 1003.4, ring guidance): arc of radius r from angle a0 over `span`
 * radians (sign gives the direction), w wide, with a triangular head. Angles are atan2(z, x).
 */
export function curvedArrow(batch, cx, cz, r, a0, span, w, y, head = 0.9) {
  const dir = Math.sign(span) || 1;
  const headA = head / r;
  const shaft = span - dir * headA;
  const n = Math.max(3, Math.ceil(Math.abs(shaft) / (Math.PI / 30)));
  const P = (rad, a) => [cx + Math.cos(a) * rad, cz + Math.sin(a) * rad];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (shaft * i) / n, t1 = a0 + (shaft * (i + 1)) / n;
    batch.quad(P(r + w / 2, t0), P(r + w / 2, t1), P(r - w / 2, t1), P(r - w / 2, t0), y);
  }
  const at = a0 + shaft, tip = a0 + span;
  batch.poly([P(r, tip), P(r + w * 1.6, at), P(r + w * 0.5, at + dir * headA * 0.25), P(r - w * 0.5, at + dir * headA * 0.25), P(r - w * 1.6, at)], y);
}

/**
 * Lane arrow outline (1038) in lane coordinates: u across (right positive), v along travel
 * (0 = tail, len = tip). Used when no decal material is available. kinds: ahead, left, right,
 * ahead_left, ahead_right, left_right.
 */
export function arrowPolygon(kind = 'ahead', len = 4) {
  const headL = len <= 4 ? 1.6 : 2.4, stemT = 0.15, stemH = 0.3;
  const tHead = len - headL;
  if (kind === 'ahead') {
    return [[-stemT / 2, 0], [stemT / 2, 0], [stemH / 2, tHead], [0.3, tHead], [0, len], [-0.3, tHead], [-stemH / 2, tHead]];
  }
  if (kind === 'left' || kind === 'right') {
    const s = kind === 'left' ? -1 : 1;
    const top = len - 0.3, bar = 0.3, hl = 1.0, hw = 0.75;
    // stem up, then a bar out to the right ending in a head; the left arrow is its mirror
    const right = [[-stemT / 2, 0], [stemT / 2, 0], [stemH / 2, top - bar], [0.45, top - bar], [0.45, top - bar - (hw - bar) / 2], [0.45 + hl, top - bar / 2], [0.45, top + (hw - bar) / 2], [0.45, top], [-stemH / 2, top]];
    return s < 0 ? right.map(([u, v]) => [-u, v]) : right;
  }
  if (kind === 'ahead_left' || kind === 'ahead_right') {
    const s = kind === 'ahead_left' ? -1 : 1;
    const base = arrowPolygon('ahead', len);
    const bar = 0.26, top = tHead - 0.6, hl = 0.9, hw = 0.7;
    const branch = [[s * stemH / 2, top - bar], [s * 0.4, top - bar], [s * 0.4, top - bar - (hw - bar) / 2], [s * (0.4 + hl), top - bar / 2], [s * 0.4, top + (hw - bar) / 2], [s * 0.4, top], [s * stemH / 2, top]];
    return { parts: [base, branch] };
  }
  if (kind === 'left_right') {
    const top = len - 0.35, bar = 0.3, hl = 1.0, hw = 0.75;
    const parts = [[[-stemT / 2, 0], [stemT / 2, 0], [stemH / 2, top], [-stemH / 2, top]]];
    for (const s of [-1, 1]) parts.push([[0, top - bar], [s * 0.5, top - bar], [s * 0.5, top - bar - (hw - bar) / 2], [s * (0.5 + hl), top - bar / 2], [s * 0.5, top + (hw - bar) / 2], [s * 0.5, top], [0, top]]);
    return { parts };
  }
  return arrowPolygon('ahead', len);
}

/** place a lane-coordinate polygon (u right, v forward) at a world point with forward (fx, fz) */
export function placePolygon(batch, poly, x, z, fx, fz, y) {
  const parts = poly.parts || [poly];
  const rx = -fz, rz = fx; // right of travel
  for (const part of parts) batch.poly(part.map(([u, v]) => [x + rx * u + fx * v, z + rz * u + fz * v]), y);
}
