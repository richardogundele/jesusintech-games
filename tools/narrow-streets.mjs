// Which side streets are narrow, measured from the houses on them. Used by tools/city-merge.mjs.
//
// The map seldom says how wide a street is: 1,159 km of the city's two-way side streets were baked at
// a default 6 m and 2,075 km at 6.5 m, and laidWidth then widened the tightest to 7 m. So every side
// street in the city came out the same, and there were no narrow streets to drive: 1.1 km in all
// were tagged 5.5 m or less. What a street's houses say is better evidence than its class. A terraced
// street whose fronts face each other 10 m apart has room for two footways and a carriageway about
// 5 m wide, no more, and in life it has no centre line and you give way to what is coming.
//
// Along each two-way side street, every SAMPLE m, a line is cast square to the street each way to the
// first building wall within REACH m. A living street is narrow by what it is. Another is narrow where at least BOTH_SHARE of its samples have
// a wall on both sides and the median gap between them is GAP_MAX m or less; it is then laid at that
// gap less two footways, kerbs and a margin, between MIN_W and MAX_W, and marked `narrow` (laidWidth
// leaves it as it is, roads.js draws no centre line).
import { PAVE_W, KERB_W } from '../src/kent/markings.js';

export const SAMPLE = 8, REACH = 14, BOTH_SHARE = 0.6, GAP_MAX = 13.5, MIN_W = 4.6, MAX_W = 5.5, END = 15, MARGIN = 0.6;
const MINOR = new Set(['residential', 'unclassified', 'living_street']);
const CELL = 40;

/** marks the narrow streets among `ways` (in place) and returns how many and how long */
export function findNarrow(ways, buildings) {
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const b of buildings) {
    const P = b.pts;
    for (let k = 0; k < P.length; k++) {
      const a = P[k], c = P[(k + 1) % P.length];
      for (let i = Math.floor(Math.min(a[0], c[0]) / CELL); i <= Math.floor(Math.max(a[0], c[0]) / CELL); i++) for (let j = Math.floor(Math.min(a[1], c[1]) / CELL); j <= Math.floor(Math.max(a[1], c[1]) / CELL); j++) {
        const kk = key(i, j); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push([a[0], a[1], c[0], c[1]]);
      }
    }
  }
  /** distance along the ray from (x, z) in direction (dx, dz) to the first building wall, within REACH */
  const cast = (x, z, dx, dz) => {
    let best = Infinity;
    const seen = new Set();
    for (let s = 0; s <= REACH; s += CELL / 2) {
      const px = x + dx * s, pz = z + dz * s, kk = key(Math.floor(px / CELL), Math.floor(pz / CELL));
      if (seen.has(kk)) continue; seen.add(kk);
      for (const [ax, az, cx, cz] of grid.get(kk) || []) {
        const ex = cx - ax, ez = cz - az, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
        if (t > 0.5 && t < best && u >= 0 && u <= 1) best = t;
      }
    }
    // the ray's end cell too
    const kk = key(Math.floor((x + dx * REACH) / CELL), Math.floor((z + dz * REACH) / CELL));
    if (!seen.has(kk)) for (const [ax, az, cx, cz] of grid.get(kk) || []) {
      const ex = cx - ax, ez = cz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0.5 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best <= REACH ? best : Infinity;
  };
  let n = 0, m = 0; const hist = {};
  const foot = 2 * (PAVE_W + KERB_W);
  for (const w of ways) {
    if (w.oneway || w.rb || w.link || w.bridge || w.tunnel || (w.layer || 0) || w.synthetic || !MINOR.has(w.cls) || !w.pts || w.pts.length < 2) continue;
    if ((w.lanesF || 1) + (w.lanesB || 1) > 2 || !(w.width <= 6.5)) continue;
    const cum = [0];
    for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    const len = cum[cum.length - 1];
    // a living street (a shared surface, a home zone) is narrow by what it is
    if (w.cls === 'living_street') { w.width = +Math.min(MAX_W, Math.max(MIN_W, w.width)).toFixed(1); w.narrow = true; n++; m += len; continue; }
    if (len < 2 * END + 3 * SAMPLE) continue;
    const gaps = []; let samples = 0, i = 1;
    for (let s = END; s <= len - END; s += SAMPLE) {
      while (i < cum.length - 1 && cum[i] < s) i++;
      const a = w.pts[i - 1], c = w.pts[i], L = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / L;
      const x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t, tx = (c[0] - a[0]) / L, tz = (c[1] - a[1]) / L;
      samples++;
      const dl = cast(x, z, tz, -tx), dr = cast(x, z, -tz, tx);
      if (dl < Infinity && dr < Infinity) gaps.push(dl + dr);
    }
    if (samples < 3 || gaps.length < BOTH_SHARE * samples) continue;
    gaps.sort((p, q) => p - q);
    const gap = gaps[gaps.length >> 1];
    hist[Math.floor(gap)] = (hist[Math.floor(gap)] || 0) + len / 1000;
    if (gap > GAP_MAX) continue;
    w.width = +Math.min(MAX_W, Math.max(MIN_W, gap - foot - MARGIN)).toFixed(1);
    w.narrow = true;
    n++; m += len;
  }
  return { n, km: m / 1000, hist };
}
