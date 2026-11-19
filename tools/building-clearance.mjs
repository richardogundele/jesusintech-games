// Hold OSM building footprints clear of the roads. Used by tools/city-merge.mjs.
//
// A footprint is traced off imagery and a road is a centreline with a width the game chooses, so
// the two overlap: the terrace on Fir Tree Road, Bellfields put a corner 1.75 m from the centreline
// of a street laid 7 m wide, which left a lane narrower than a car and no footway on that side.
// Procedural houses are tested against the roads when they are planted (scenery.js); OSM ones were
// not, and scenery.js instead takes the collider off any whose box reaches a carriageway, so the
// wall was drawn in the lane and driven through.
//
// Each footprint is cut back along the kerb, never moved: a cut can only take ground away, so it
// cannot push a house into its neighbour. The carriageway is always cleared. The footway is cleared
// where a wall is more than FOOTWAY_SLOP into it; less than that is how far imagery sits from
// survey anyway, and cutting it would shave thousands of terraces that look right. A footprint a
// road runs through the middle of, or one cut down to a sliver, is left out.
import { laidWidth } from '../src/kent/net.js';
import { PAVE_W, KERB_W } from '../src/kent/markings.js';

export const FOOTWAY_SLOP = 0.5;
const MARGIN = 0.1;        // region.json keeps one decimal place: stay that far behind the line
const MIN_AREA = 12;       // m2: under this a remnant is a shed-sized stub, not the building it was
const MIN_SHARE = 0.35;    // of the footprint it started as
const CELL = 60;

/** the half-width the game lays, and where the back of the footway is (roads.js descOf) */
export function corridorOf(w) {
  const hw = laidWidth(w) / 2;
  const limit = w.limit || (w.pave ? 30 : 60);
  const pave = !!w.pave && !(w.cls === 'service' || w.link || limit >= 50);
  return { hw, back: hw + (pave ? KERB_W + PAVE_W : 0) };
}
/** roads a building is held clear of: not a ring (scenery.js keeps those clear itself), not a
 *  bridge, tunnel or anything on a layer (a building under a viaduct is right), not a yard */
const counts = (w) => !w.rb && !w.bridge && !w.tunnel && !(w.layer || 0) && w.cls !== 'service' && !w.link && w.pts && w.pts.length > 1;

const areaOf = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return Math.abs(a) / 2; };
const inPoly = (P, x, z) => {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** closest points of segments p1p2 and q1q2: [distance, point on p, point on q] */
function closest(p1, p2, q1, q2) {
  const ux = p2[0] - p1[0], uz = p2[1] - p1[1], vx = q2[0] - q1[0], vz = q2[1] - q1[1], wx = p1[0] - q1[0], wz = p1[1] - q1[1];
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-12) { sN = 0; sD = 1; tN = e; tD = c; } else {
    sN = b * e - c * d; tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  const s = Math.abs(sN) < 1e-12 ? 0 : sN / sD, t = Math.abs(tN) < 1e-12 || !tD ? 0 : tN / tD;
  const P = [p1[0] + s * ux, p1[1] + s * uz], Q = [q1[0] + t * vx, q1[1] + t * vz];
  return [Math.hypot(P[0] - Q[0], P[1] - Q[1]), P, Q];
}
/** the part of polygon P with (x - o) . n >= 0 */
function cut(P, o, n) {
  const out = [], side = (p) => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], da = side(a), db = side(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05; });
}

/**
 * ways and buildings as region.json holds them. Returns the buildings to keep (cut ones are new
 * objects with their box redone) and what was done.
 */
export function clearBuildings(ways, buildings) {
  const grid = new Map();
  for (const w of ways) {
    if (!counts(w)) continue;
    const c = corridorOf(w);
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1], seg = { a, b, hw: c.hw, back: c.back };
      for (let gx = Math.floor((Math.min(a[0], b[0]) - c.back) / CELL); gx <= Math.floor((Math.max(a[0], b[0]) + c.back) / CELL); gx++)
        for (let gz = Math.floor((Math.min(a[1], b[1]) - c.back) / CELL); gz <= Math.floor((Math.max(a[1], b[1]) + c.back) / CELL); gz++) {
          const k = gx + ':' + gz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
    }
  }
  /** the worst breach of polygon P: how far the kerb line has to be from which road point, facing which way */
  const breach = (P, segs, centre) => {
    let worst = null;
    for (const s of segs) {
      let d = Infinity, onRoad = null, onWall = null;
      if (inPoly(P, s.a[0], s.a[1]) || inPoly(P, s.b[0], s.b[1])) d = 0;
      else for (let k = 0; k < P.length; k++) {
        const [dd, q, p] = closest(s.a, s.b, P[k], P[(k + 1) % P.length]);
        if (dd < d) { d = dd; onRoad = q; onWall = p; }
      }
      const line = s.back - d > FOOTWAY_SLOP ? s.back : d < s.hw ? s.hw : 0;
      if (!line) continue;
      const depth = line - d;
      if (worst && depth <= worst.depth) continue;
      let n, o;
      if (d > 0.05) { n = [(onWall[0] - onRoad[0]) / d, (onWall[1] - onRoad[1]) / d]; o = onRoad; }
      else {
        // the centreline is inside the footprint: keep the side most of the building is on
        const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
        n = [-(s.b[1] - s.a[1]) / L, (s.b[0] - s.a[0]) / L]; o = s.a;
        const side = (centre[0] - o[0]) * n[0] + (centre[1] - o[1]) * n[1];
        if (Math.abs(side) < 1) return { through: true, depth: Infinity };
        if (side < 0) n = [-n[0], -n[1]];
      }
      worst = { depth, o: [o[0] + n[0] * (line + MARGIN), o[1] + n[1] * (line + MARGIN)], n };
    }
    return worst;
  };
  const out = [], stat = { cut: 0, through: 0, sliver: 0, left: 0, m2: 0, lost: [] };
  for (const b of buildings) {
    let P = b.pts;
    if (P.length > 3 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
    for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; cx += p[0]; cz += p[1]; }
    const centre = [cx / P.length, cz / P.length];
    const segs = new Set();
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) for (const s of grid.get(gx + ':' + gz) || []) segs.add(s);
    if (!segs.size) { out.push(b); continue; }
    const before = areaOf(P);
    let Q = P, gone = null, touched = false;
    for (let pass = 0; pass < 12; pass++) {
      const w = breach(Q, segs, centre);
      if (!w) break;
      if (w.through) { gone = 'through'; break; }
      Q = cut(Q, w.o, w.n); touched = true;
      if (Q.length < 3 || areaOf(Q) < Math.max(MIN_AREA, before * MIN_SHARE)) { gone = 'sliver'; break; }
      if (pass === 11) stat.left++;
    }
    if (gone) { stat[gone]++; stat.m2 += before; stat.lost.push({ why: gone, m2: Math.round(before), at: [+centre[0].toFixed(1), +centre[1].toFixed(1)], name: b.name || null }); continue; }
    if (!touched) { out.push(b); continue; }
    Q = Q.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]);
    stat.cut++; stat.m2 += before - areaOf(Q);
    const nb = { ...b, pts: Q };
    if (b.box) nb.box = [Math.min(...Q.map((p) => p[0])), Math.min(...Q.map((p) => p[1])), Math.max(...Q.map((p) => p[0])), Math.max(...Q.map((p) => p[1]))];
    out.push(nb);
  }
  return { buildings: out, stat };
}
