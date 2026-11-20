#!/usr/bin/env node
// Is the road what you see when you look at the road? Builds the real road tiles and the real scenery
// tiles of Driving City and asks, of the surfaces themselves:
//
//   1. lies on the land   every ground-hugging triangle (tarmac, paint, kerb tops, footways) is its own
//                         small height above the terrain all over, not only at its corners: a triangle
//                         laid across a fold of the ground dips under it on a ridge, and the land
//                         comes up through the road (terrain.js splitOnFolds)
//   2. nothing on top     nothing the scenery draws solid lies over a carriageway triangle: a railway's
//                         rails and sleepers across a road, a slab standing on its edge; and nothing
//                         it makes solid to drive into (a petrol station's columns and pumps, a
//                         stand-in store) reaches into a road that is not a service road; and
//                         nothing it stands up (a wall, a fence, a hedge, a post, a trunk) has its
//                         foot in one
//   2b. no taller than it is   no wall the scenery builds reaches higher above the ground than the
//                         building under it is tall (the walls of every building drawn from its
//                         outline were once taller than the building by the height of the hill)
//   2c. raised roads      a road on a deck or a ramp takes everything of itself up with it: no
//                         tarmac left on the ground under its own deck (a junction's patch, a
//                         roundabout), no lip where two raised surfaces meet (a flat junction
//                         against a sloping arm), and nothing of the walls and parapets that hold
//                         it up standing in a carriageway at its own height
//   3. painted, in order  what the scenery and the roads lay flat on the land (fields, car park and
//                         drive surfaces, ballast, the coat under a junction's mouth) writes no depth
//                         and is drawn before everything else, and nothing else is (surface.js UNDERLAY):
//                         that, not height, is what keeps a field from showing through a road
//   4. junction mouths    the band each arm should cover on its way in to a junction is covered:
//                         no bare ground between a side road's end and the corners cut for it
//
//   node tools/road-surface-check.mjs [area,area...] [--every 6] [--all] [-v]
//
// It samples one tile in six of each area by default (about two minutes); --all builds every tile.
// Before any of this was looked for, the same questions found the land through the road at 800
// triangles in Leeds, a field or a car park over the carriageway at 0.3 to 2.6% of the carriageway
// triangles of every town, track across a road in 574 places and a hole in the mouth of seven
// junctions in ten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { makeTerrain } from '../src/worlds/terrain.js';
import { buildRoadTile, TILE, flatRoadMaterials, netView, _internals } from '../src/kent/roads.js';
import { makeSceneryBuilder } from '../src/kent/scenery.js';
import { UNDERLAY } from '../src/kent/surface.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const only = argv[0] && !argv[0].startsWith('-') ? argv[0].split(',') : null, every = argv.includes('--all') ? 1 : +opt('every', 6), verbose = argv.includes('-v');
const region = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/city/region.json'), 'utf8'));
const net = new RoadNet(region), T = makeTerrain(region), H = T.heightAt, view = netView(net), { nodeInfo } = _internals;
const mats = flatRoadMaterials();
const scenery = makeSceneryBuilder({ net, groundY: H });
const TARMAC = new Set(['asphalt', 'asphaltDark', 'trunkTop', 'streetTop', 'laneTop', 'settsTop', 'gravelTop', 'concreteTop']);
const COVER = new Set([...TARMAC, 'paving', 'pavingBlock', 'kerb', 'grass', 'concrete', 'apron']); // anything the road builder lays down
const BARY = []; { const n = 5; for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const k = n - i - j; if (i === n || j === n || k === n) continue; BARY.push([i / n, j / n, k / n]); } }
const CELL = 4, key = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);

/** every triangle of a group's own meshes that lies flat near the ground: [ax, ay, az, bx, by, bz, cx, cy, cz, mesh] */
function flats(group, keep, anyHeight = false) {
  const out = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !keep(o)) return;
    const m = o.matrixWorld.elements;
    if (!(m[0] === 1 && m[5] === 1 && m[10] === 1 && m[12] === 0 && m[13] === 0 && m[14] === 0 && m[1] === 0 && m[4] === 0)) return; // a placed object, not tile geometry in world space
    const g = o.geometry, a = g.attributes.position.array, ix = g.index ? g.index.array : null, nt = ix ? ix.length / 3 : a.length / 9;
    for (let t = 0; t < nt; t++) {
      const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2;
      const ax = a[i0 * 3], ay = a[i0 * 3 + 1], az = a[i0 * 3 + 2], bx = a[i1 * 3], by = a[i1 * 3 + 1], bz = a[i1 * 3 + 2], cx = a[i2 * 3], cy = a[i2 * 3 + 1], cz = a[i2 * 3 + 2];
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9 || Math.abs(ny) / nl < 0.7) continue; // a wall
      const oa = ay - H(ax, az), ob = by - H(bx, bz), oc = cy - H(cx, cz);
      if (!anyHeight && (Math.max(oa, ob, oc) > 0.6 || Math.min(oa, ob, oc) < -0.6)) continue; // a deck, a roof, a totem's top
      out.push([ax, ay, az, bx, by, bz, cx, cy, cz, o, oa, ob, oc]);
    }
  });
  return out;
}
function hash(tris) {
  const h = new Map();
  for (const t of tris) {
    const x0 = Math.floor(Math.min(t[0], t[3], t[6]) / CELL), x1 = Math.floor(Math.max(t[0], t[3], t[6]) / CELL), z0 = Math.floor(Math.min(t[2], t[5], t[8]) / CELL), z1 = Math.floor(Math.max(t[2], t[5], t[8]) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 100003 + j; let a = h.get(k); if (!a) h.set(k, (a = [])); a.push(t); }
  }
  return h;
}
/** the height of triangle t over (x, z), or null when (x, z) is outside it */
function yAt(t, x, z) {
  const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]); if (Math.abs(d) < 1e-12) return null;
  const u = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d, v = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d, w = 1 - u - v;
  return u < -1e-9 || v < -1e-9 || w < -1e-9 ? null : u * t[1] + v * t[4] + w * t[7];
}
const wayAt = (x, z) => { const h = net.nearest(x, z, 40); return h ? `${h.way.name || h.way.ref || h.way.id}` : '?'; };

/** how far a solid box (centre, w across, d along yaw) reaches into a carriageway that is on the ground and not a service road */
function intoRoad(o) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw), hw = o.w / 2, hd = o.d / 2;
  let worst = 0;
  for (const { way, i } of net.grid.near(o.cx, o.cz, Math.hypot(hw, hd) + 14)) {
    if (way.cls === 'service' || way.hasDeck) continue;
    const a = way.pts[i], b = way.pts[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
    for (let k = 0; k <= n; k++) {
      const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n, u = (x - o.cx) * c - (z - o.cz) * s, v = (x - o.cx) * s + (z - o.cz) * c;
      const into = way.halfW - Math.hypot(Math.max(0, Math.abs(u) - hw), Math.max(0, Math.abs(v) - hd));
      if (into > worst) { worst = into; intoRoad.way = way; }
    }
  }
  return worst;
}
// ---- what stands in a through road ----
const LOW = 2, DEEP = 0.5; // below 2 m is where a car is; half a metre in is past any kerb's worth of doubt
const NEARC = 8, nk = (x, z) => Math.floor(x / NEARC) * 100003 + Math.floor(z / NEARC), NEAR = new Set();
let maxHW = 0;
for (const w of net.ways.values()) {
  if (w.cls === 'service') continue;
  maxHW = Math.max(maxHW, w.halfW);
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const a = w.pts[i], b = w.pts[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4) + 1;
    for (let k = 0; k <= n; k++) {
      const cx = Math.floor((a[0] + ((b[0] - a[0]) * k) / n) / NEARC), cz = Math.floor((a[1] + ((b[1] - a[1]) * k) / n) / NEARC);
      for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++) NEAR.add((cx + p) * 100003 + cz + q); // every point within 16 m of the line, and some beyond
    }
  }
}
/** how deep a point is inside the carriageway of a road that is not a service road and is on the ground there (0: in none) */
function depthIn(x, z) {
  if (!NEAR.has(nk(x, z))) return 0;
  let worst = 0;
  for (const { way, i } of net.grid.near(x, z, maxHW + 1)) {
    if (way.cls === 'service') continue;
    const a = way.pts[i], b = way.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
    const into = way.halfW - Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z);
    if (into <= worst) continue;
    if (way.hasDeck && net.deckAt(way, way.cum[i] + Math.sqrt(L2) * u) > 1) continue; // up on its deck there: what stands on the ground beneath is not in it
    worst = into; depthIn.way = way;
  }
  return worst;
}
// ---- the building under a point, for how tall a wall there may be ----
const BC = 64, bk = (cx, cz) => cx * 100003 + cz, BGRID = new Map();
for (const b of region.buildings || []) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const e = { pts: b.pts, h: Math.max(2.5, Math.min(120, b.h || 6.5)) * (b.kind === 'church' ? 2.4 : 1), x0: x0 - 3, x1: x1 + 3, z0: z0 - 3, z1: z1 + 3 };
  for (let cx = Math.floor(e.x0 / BC); cx <= Math.floor(e.x1 / BC); cx++) for (let cz = Math.floor(e.z0 / BC); cz <= Math.floor(e.z1 / BC); cz++) { const k = bk(cx, cz); let l = BGRID.get(k); if (!l) BGRID.set(k, (l = [])); l.push(e); }
}
/** the tallest a wall at (x, z) may stand: the height of the tallest building whose outline is within 3 m (0 if there is none) */
function tallestAt(x, z) {
  let best = 0;
  for (const e of BGRID.get(bk(Math.floor(x / BC), Math.floor(z / BC))) || []) {
    if (e.h <= best || x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) continue;
    let near = false, inside = false;
    for (let i = 0, n = e.pts.length, j = n - 1; i < n; j = i++) {
      const a = e.pts[i], b = e.pts[j], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
      if (Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z) < 3) { near = true; break; }
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    if (near || inside) best = e.h;
  }
  return best;
}
const TALL = 12, ROOF = 8; // a wall is looked at above 12 m; a roof, a chimney and the fall of the ground under a building are worth 8 m
const tot = { tiles: 0, surf: 0, off: 0, worstOff: 0, land: 0, road: 0, over: 0, overService: 0, sleepers: 0, solid: 0, upright: 0, tall: 0, order: 0, junctions: 0, holed: 0, holeM2: 0, ms: 0, raised: 0, left: 0, lips: 0, worstLip: 0, struct: 0, inWay: 0 };
const notes = [];
for (const a of region.areas) {
  if (only && !only.includes(a.id)) continue;
  const b = a.box, st = { tiles: 0, surf: 0, off: 0, worstOff: 0, land: 0, road: 0, over: 0, overService: 0, sleepers: 0, solid: 0, upright: 0, tall: 0, order: 0, junctions: 0, holed: 0, holeM2: 0, ms: 0, raised: 0, left: 0, lips: 0, worstLip: 0, struct: 0, inWay: 0 };
  let n = 0;
  for (let tx = Math.floor(b.minX / TILE); tx <= Math.floor(b.maxX / TILE); tx++) for (let tz = Math.floor(b.minZ / TILE); tz <= Math.floor(b.maxZ / TILE); tz++) {
    if (n++ % every) continue;
    const t0 = performance.now();
    const part = buildRoadTile(net, { tx, tz }, { lod: 'near', mats, groundY: H });
    if (!part?.group) continue;
    const sc = scenery.build({ tx, tz }, 'near');
    st.ms += performance.now() - t0; st.tiles++;

    // 1. every ground-hugging road surface is its own height above the terrain, all over
    const surf = flats(part.group, (o) => !!o.name);
    for (const t of surf) {
      st.surf++;
      let dev = 0, low = Infinity;
      for (const [u, v, w] of BARY) {
        const x = t[0] * u + t[3] * v + t[6] * w, z = t[2] * u + t[5] * v + t[8] * w, y = t[1] * u + t[4] * v + t[7] * w, h = H(x, z);
        dev = Math.max(dev, Math.abs(y - h - (t[10] * u + t[11] * v + t[12] * w)));
        low = Math.min(low, y - (h - 0.12)); // the land is drawn 0.12 m under the terrain
      }
      if (dev > 0.005) { st.off++; if (dev > st.worstOff) { st.worstOff = dev; if (notes.length < 40) notes.push(`${a.id}: a ${t[9].name} triangle ${dev.toFixed(3)} m off its own height at (${t[0].toFixed(0)}, ${t[2].toFixed(0)}) ${wayAt(t[0], t[2])}`); } }
      if (low < 0) st.land++;
    }

    // 2. nothing solid from the scenery over the carriageway
    const road = surf.filter((t) => TARMAC.has(t[9].name)), hr = hash(road);
    // (not the rails set flush in the road at a level crossing: those are meant to be seen on it, and carry paint's depth bias to say so)
    const solid = flats(sc.group, (o) => o.material && o.material.depthWrite !== false && !o.material.polygonOffset && !!o.geometry.attributes.color);
    const hs = hash(solid);
    for (const t of road) {
      st.road++;
      let worst = 0;
      for (const [u, v, w] of BARY) {
        const x = t[0] * u + t[3] * v + t[6] * w, z = t[2] * u + t[5] * v + t[8] * w, y = t[1] * u + t[4] * v + t[7] * w;
        for (const q of hs.get(key(x, z)) || []) { const ys = yAt(q, x, z); if (ys != null && ys - y > worst) worst = ys - y; }
      }
      if (worst > 0.0005 && net.nearest(t[0], t[2], 40)?.way.cls === 'service') st.overService++; // a service road's own tarmac: counted apart
      else if (worst > 0.0005) { st.over++; if (notes.length < 40) notes.push(`${a.id}: scenery ${worst.toFixed(2)} m above the tarmac at (${t[0].toFixed(0)}, ${t[2].toFixed(0)}) ${wayAt(t[0], t[2])}`); }
    }
    // (sleepers are instances: one that sits on a carriageway)
    const onRoad = (x, z) => (hr.get(key(x, z)) || []).some((q) => yAt(q, x, z) != null);
    // (what the road shows at a point is tarmac: the highest thing the road builder laid there, not a footway laid over a turning head's edge)
    const hcAll = hash(flats(part.group, (o) => COVER.has(o.name)));
    const tarmacOnTop = (x, z) => { let top = -Infinity, name = null; for (const q of hcAll.get(key(x, z)) || []) { const y = yAt(q, x, z); if (y != null && y > top) { top = y; name = q[9].name; } } return TARMAC.has(name); };
    sc.group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (Math.abs(bb.max.x - bb.min.x - 2.5) > 0.01 || Math.abs(bb.max.y - bb.min.y - 0.14) > 0.01) return; // not the sleeper
      const e = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) if (onRoad(e[i * 16 + 12], e[i * 16 + 14])) st.sleepers++;
    });

    // (and what it makes solid: a box more than 0.5 m into a through road)
    for (const o of sc.colliders || []) {
      const into = intoRoad(o);
      if (into > 0.5) { const w = intoRoad.way; st.solid++; if (notes.length < 400) notes.push(`${a.id}: something solid ${o.w.toFixed(1)} x ${o.d.toFixed(1)} m stands ${into.toFixed(1)} m into ${w.name || w.ref || w.id} (${w.cls}, ${(w.halfW * 2).toFixed(1)} m wide${into > w.halfW - 0.05 ? ', right across its centre line' : ''}) at (${o.cx.toFixed(0)}, ${o.cz.toFixed(0)})`); }
    }

    // (and what it stands up in one: a wall, a fence panel, a hedge, a box, a post with its foot in a
    // through road; and 2b, no wall taller than the building under it)
    const places = new Set(), flag = (o, x, z, what) => {
      const k = `${o.id}|${Math.floor(x / 4)}|${Math.floor(z / 4)}`;
      if (places.has(k)) return; places.add(k); st.upright++;
      const w = depthIn.way;
      if (notes.length < 400) notes.push(`${a.id}: ${what} stands ${depthIn(x, z).toFixed(1)} m into ${w.name || w.ref || w.id} (${w.cls}) at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    };
    const tallPlaces = new Set();
    sc.group.updateMatrixWorld(true);
    sc.group.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.depthWrite === false || o.material.transparent) return;
      const g = o.geometry, P = g.attributes.position; if (!P) return;
      const building = o.name === 'walls'; // the walls of the buildings drawn from their outlines (a cathedral, a clock tower and a cliff are as tall as they are)
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, dims = `${(bb.max.x - bb.min.x).toFixed(1)} x ${(bb.max.y - bb.min.y).toFixed(1)} x ${(bb.max.z - bb.min.z).toFixed(1)}`;
      if (o.isInstancedMesh) {
        const e = o.instanceMatrix.array, pa = P.array, nv = P.count, R = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        const unit = nv === 24 && Math.abs(bb.max.x - bb.min.x - 1) < 1e-6 && Math.abs(bb.max.z - bb.min.z - 1) < 1e-6; // the unit box every building, wall and hedge is an instance of
        for (let i = 0; i < o.count; i++) {
          const m = i * 16, ox = e[m + 12], oy = e[m + 13], oz = e[m + 14], sx = Math.hypot(e[m], e[m + 2]), sz = Math.hypot(e[m + 8], e[m + 10]);
          if (R * Math.max(sx, sz) < 16 - maxHW && !NEAR.has(nk(ox, oz))) continue;
          const gy = H(ox, oz);
          if (unit) {
            if (oy + bb.min.y * e[m + 5] - gy >= LOW) continue; // its foot is above a car
            const lx = (bb.min.x + bb.max.x) / 2, lz = (bb.min.z + bb.max.z) / 2;
            const box = { cx: ox + e[m] * lx + e[m + 8] * lz, cz: oz + e[m + 2] * lx + e[m + 10] * lz, w: sx, d: sz, yaw: Math.atan2(-e[m + 2], e[m]) };
            const into = intoRoad(box);
            if (into > DEEP) { depthIn.way = intoRoad.way; const k = `${o.id}|${i}`; if (!places.has(k)) { places.add(k); st.upright++; const w = intoRoad.way; if (notes.length < 400) notes.push(`${a.id}: a box ${sx.toFixed(1)} x ${(e[m + 5]).toFixed(1)} x ${sz.toFixed(1)} m (${o.material.name || o.name || 'instanced'}) stands ${into.toFixed(1)} m into ${w.name || w.ref || w.id} (${w.cls}) at (${box.cx.toFixed(0)}, ${box.cz.toFixed(0)})`); } }
            continue;
          }
          for (let v = 0; v < nv; v++) {
            const x = pa[v * 3], y = pa[v * 3 + 1], z = pa[v * 3 + 2], wy = e[m + 1] * x + e[m + 5] * y + e[m + 9] * z + oy;
            if (wy - gy >= LOW) continue;
            const wx = e[m] * x + e[m + 4] * y + e[m + 8] * z + ox, wz = e[m + 2] * x + e[m + 6] * y + e[m + 10] * z + oz;
            if (depthIn(wx, wz) > DEEP) { flag(o, wx, wz, `something instanced (${o.material.name || o.name || 'mesh'}, ${dims} m)`); break; }
          }
          // (a post or a trunk whose foot is on tarmac the centre lines do not tell of: the mouth of a junction)
          if (oy + bb.min.y * e[m + 5] - gy < 0.5 && tarmacOnTop(ox, oz)) { const k = `${o.id}|${Math.floor(ox / 4)}|${Math.floor(oz / 4)}`; if (!places.has(k)) { places.add(k); st.upright++; if (notes.length < 400) notes.push(`${a.id}: something instanced (${dims} m) has its foot on the tarmac at (${ox.toFixed(0)}, ${oz.toFixed(0)}) ${wayAt(ox, oz)}`); } }
        }
        return;
      }
      const mw = o.matrixWorld.elements;
      if (!(mw[0] === 1 && mw[5] === 1 && mw[10] === 1 && mw[12] === 0 && mw[13] === 0 && mw[14] === 0 && mw[1] === 0 && mw[4] === 0)) return; // a placed object (a shop's sign), not tile geometry in world space
      const pa = P.array, ix = g.index ? g.index.array : null, nt = ix ? ix.length / 3 : pa.length / 9, V = [0, 0, 0];
      for (let t = 0; t < nt; t++) {
        for (let c = 0; c < 3; c++) V[c] = (ix ? ix[t * 3 + c] : t * 3 + c) * 3;
        const ax = pa[V[0]], ay = pa[V[0] + 1], az = pa[V[0] + 2], bx = pa[V[1]], by = pa[V[1] + 1], bz = pa[V[1] + 2], cx = pa[V[2]], cy = pa[V[2] + 1], cz = pa[V[2] + 2];
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9 || Math.abs(ny) / nl >= 0.7) continue; // flat: looked at above
        const pts = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]].map(([x, y, z]) => [x, z, y - H(x, z)]);
        // 2b. a wall's top above 12 m: there is a building that tall under it
        for (const [x, z, up] of pts) {
          if (!building || up <= TALL) continue;
          const may = tallestAt(x, z);
          if (up > may + ROOF) { const k = `${o.id}|${Math.floor(x / 4)}|${Math.floor(z / 4)}`; if (!tallPlaces.has(k)) { tallPlaces.add(k); st.tall++; if (notes.length < 400) notes.push(`${a.id}: a wall reaches ${up.toFixed(1)} m above the ground at (${x.toFixed(0)}, ${z.toFixed(0)}), where the tallest building on the map is ${may.toFixed(1)} m`); } }
        }
        // its foot in a through road: along each edge that is low at both ends
        for (let c = 0; c < 3; c++) {
          const p = pts[c], q = pts[(c + 1) % 3];
          if (p[2] >= LOW || q[2] >= LOW) continue;
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < NEARC && !NEAR.has(nk(p[0], p[1])) && !NEAR.has(nk(q[0], q[1]))) continue;
          const n = Math.max(1, Math.ceil(L));
          for (let k = 0; k <= n; k++) { const x = p[0] + ((q[0] - p[0]) * k) / n, z = p[1] + ((q[1] - p[1]) * k) / n; if (depthIn(x, z) > DEEP) flag(o, x, z, `something upright (${o.material.name || o.name || 'mesh'})`); }
        }
      }
    });

    // 2c. raised roads
    {
      const up = flats(part.group, (o) => TARMAC.has(o.name), true), hu = hash(up);
      const at = (x, z) => { const out = []; for (const q of hu.get(key(x, z)) || []) { const y = yAt(q, x, z); if (y != null) out.push(y - H(x, z)); } return out; }; // heights of tarmac above the land at a point
      // the ways' own heights at a point: [deck there, way] for every way whose width the point is in
      const waysAt = (x, z) => { const out = []; for (const { way, i } of net.grid.near(x, z, maxHW + 1)) { const p = way.pts[i], q = way.pts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz, u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / L2)) : 0; if (Math.hypot(p[0] + dx * u - x, p[1] + dz * u - z) < way.halfW) out.push(way.hasDeck ? net.deckAt(way, way.cum[i] + Math.sqrt(L2) * u) : 0); } return out; };
      const leftCells = new Set(), lipCells = new Set();
      for (const t of up) {
        const mx = (t[0] + t[3] + t[6]) / 3, mz = (t[2] + t[5] + t[8]) / 3, h = (t[10] + t[11] + t[12]) / 3;
        if (h > 0.6) st.raised++;
        // left behind: on the ground, where every road it could belong to is more than 1.5 m up
        if (h < 0.6) { const ws = waysAt(mx, mz); if (ws.length && ws.every((d) => d > 1.5)) { const k = key(mx, mz); if (!leftCells.has(k)) { leftCells.add(k); st.left++; if (notes.length < 400) notes.push(`${a.id}: tarmac left on the ground under a road ${Math.min(...ws).toFixed(1)} m up at (${mx.toFixed(0)}, ${mz.toFixed(0)}) ${wayAt(mx, mz)}`); } } continue; }
        // a lip: just past an edge of a raised piece, another piece of tarmac between 4 cm and 1.5 m higher or lower
        for (const [i, j, o] of [[0, 3, 6], [3, 6, 0], [6, 0, 3]]) {
          const dx = t[j] - t[i], dz = t[j + 2] - t[i + 2], L = Math.hypot(dx, dz); if (L < 0.05) continue;
          let nx = dz / L, nz = -dx / L; if ((t[o] - t[i]) * nx + (t[o + 2] - t[i + 2]) * nz > 0) { nx = -nx; nz = -nz; }
          const ex = (t[i] + t[j]) / 2, ez = (t[i + 2] + t[j + 2]) / 2, ey = (t[i + 1] + t[j + 1]) / 2 - H(ex, ez);
          for (const y of at(ex + nx * 0.1, ez + nz * 0.1)) { const d = Math.abs(y - ey); if (d > 0.04 && d < 1.5) { st.worstLip = Math.max(st.worstLip, d); const k = key(ex, ez); if (!lipCells.has(k)) { lipCells.add(k); st.lips++; if (notes.length < 400) notes.push(`${a.id}: a lip of ${d.toFixed(2)} m between two raised pieces of road at (${ex.toFixed(0)}, ${ez.toFixed(0)}) ${wayAt(ex, ez)}`); } } }
        }
      }
      // the structure under a raised road: none of it inside a carriageway at that carriageway's height
      const inCells = new Set();
      const hcAll2 = hash(flats(part.group, (o) => COVER.has(o.name), true));
      part.group.traverse((o) => {
        if (!o.isMesh || o.name !== 'deck') return;
        const p = o.geometry.attributes.position;
        st.struct += (o.geometry.index ? o.geometry.index.count : p.count) / 3;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), z = p.getZ(i), y = p.getY(i) - H(x, z);
          // standing up out of a carriageway: the highest thing the road builder laid under it is tarmac, less than 1.2 m below (a wall whose top is level with the road is the face of a step, counted with the lips; a parapet at the back of a footway stands on the footway)
          const on = (px, pz) => { let top = -Infinity, name = null; for (const q of hcAll2.get(key(px, pz)) || []) { const yy = yAt(q, px, pz); if (yy == null) continue; const s = yy - H(px, pz); if (s < y - 0.15 && s > top) { top = s; name = q[9].name; } } return TARMAC.has(name) && y - top < 1.2; };
          if (on(x, z) && on(x + 0.4, z) && on(x - 0.4, z) && on(x, z + 0.4) && on(x, z - 0.4)) { const k = key(x, z); if (!inCells.has(k)) { inCells.add(k); st.inWay++; if (notes.length < 400) notes.push(`${a.id}: part of a raised road's wall or parapet stands in the carriageway at (${x.toFixed(0)}, ${z.toFixed(0)}), ${y.toFixed(1)} m up, ${wayAt(x, z)}`); } }
        }
      });
    }

    // 3. painted on the land, in order: no depth written and drawn first; everything else the other way
    for (const grp of [part.group, sc.group]) grp.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const painted = o.material.depthWrite === false && !o.material.transparent, early = o.renderOrder < 0;
      if (painted !== early || (early && !Object.values(UNDERLAY).includes(o.renderOrder))) { st.order++; if (notes.length < 40) notes.push(`${a.id}: mesh "${o.name || o.material.type}" in tile ${tx},${tz} has depthWrite ${o.material.depthWrite} and renderOrder ${o.renderOrder}`); }
    });

    // 4. junction mouths: each arm's own width, from the node out to where its corners end
    const hc = hcAll;
    const covered = (x, z) => (hc.get(key(x, z)) || []).some((q) => yAt(q, x, z) != null);
    for (const node of net.nodes.values()) {
      if (node.x < tx * TILE + 30 || node.x >= (tx + 1) * TILE - 30 || node.z < tz * TILE + 30 || node.z >= (tz + 1) * TILE - 30) continue; // its whole mouth in this tile
      const info = nodeInfo(view, node.id);
      if (!info || info.kind !== 'junction' || info.ring || info.gore || info.arms.some((q) => q.way.hasDeck)) continue;
      st.junctions++;
      let miss = 0;
      for (const arm of info.arms) {
        const tEnd = Math.max(arm.trim + 0.3, ...info.fillets.filter((f) => f.A === arm || f.B === arm).map((f) => (f.A === arm ? f.tA : f.tB)));
        const nx = arm.az, nz = -arm.ax, hw = arm.hw - 0.15;
        for (let t = 0.2; t <= tEnd; t += 0.25) for (let o = -hw; o <= hw + 1e-9; o += 0.25) if (!covered(info.x + arm.ax * t + nx * o, info.z + arm.az * t + nz * o)) miss++;
      }
      if (miss * 0.0625 >= 0.1) { st.holed++; st.holeM2 += miss * 0.0625; }
    }
    part.dispose?.(); sc.dispose?.();
  }
  for (const k of Object.keys(tot)) tot[k] = k === 'worstOff' || k === 'worstLip' ? Math.max(tot[k], st[k]) : tot[k] + st[k];
  console.log(`${a.name.padEnd(13)} ${String(st.tiles).padStart(3)} tiles | ${String(st.surf).padStart(7)} surfaces, off their height ${st.off}, land through ${st.land} | ${String(st.road).padStart(6)} carriageway, scenery over ${st.over}, sleepers on ${st.sleepers}, solid in ${st.solid}, upright in ${st.upright}, too tall ${st.tall} | raised ${st.raised}, left under ${st.left}, lips ${st.lips}, structure ${Math.round(st.struct)} (in the way ${st.inWay}) | order ${st.order ? st.order + ' WRONG' : 'ok'} | ${String(st.junctions).padStart(4)} junctions, a hole in ${st.holed} (${st.holeM2.toFixed(1)} m2)`);
}
if (verbose || tot.off || tot.over || tot.order || tot.solid || tot.upright || tot.tall || tot.left || tot.lips || tot.inWay) for (const l of notes) console.log('   ' + l);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
console.log('');
ok(tot.tiles > 0 && tot.surf > 10000, `${tot.tiles} tiles built, roads and scenery, ${Math.round(tot.ms / Math.max(1, tot.tiles))} ms each`);
ok(tot.off === 0, `every ground-hugging road surface lies its own height above the land, to 5 mm (${tot.off} of ${tot.surf} do not${tot.off ? `, the worst by ${tot.worstOff.toFixed(3)} m` : ''})`);
ok(tot.land === 0, `the land comes through no road surface (${tot.land})`);
ok(tot.over === 0 && tot.sleepers === 0, `nothing solid from the scenery lies on a carriageway (${tot.over} of ${tot.road} carriageway triangles under something, ${tot.sleepers} sleepers on a road)`);
ok(tot.solid === 0, `nothing the scenery makes solid stands in a through road (${tot.solid} boxes more than 0.5 m in)`);
// Ceilings, not zeros, for what is still left on 2026-11-20, set at that day's whole-city rates so a
// run passes as it stands and fails if any of it gets worse (the junction-mouth check's way). They are
// rates for the whole city: one town on its own can be over them. What each was before it was worked on:
// things standing in through roads 114 in two towns; lips 2.3% of raised road; walls in a lane 173.
const perTiles = (n) => (100 * n) / Math.max(1, tot.tiles), pct = (n, of) => (100 * n) / Math.max(1, of);
ok(perTiles(tot.upright) <= 1.0, `few things the scenery stands up have their foot in a through road: ${tot.upright} places more than ${DEEP} m in, below ${LOW} m (${perTiles(tot.upright).toFixed(2)} per 100 tiles; 1.0 passes, it was 114 in Guildford and Herne Bay alone)`);
ok(tot.tall === 0, `no wall reaches higher than the building under it (${tot.tall} places more than ${ROOF} m over the tallest building there)`);
ok(pct(tot.left, tot.raised) <= 0.04, `a raised road takes itself up: tarmac left on the ground under its own deck at ${tot.left} places (${pct(tot.left, tot.raised).toFixed(3)}% of ${tot.raised} raised carriageway triangles; 0.04% passes, it was every roundabout and junction on a deck)`);
ok(pct(tot.lips, tot.raised) <= 1.6, `raised surfaces meet level: a lip of 4 cm or more between two of them at ${tot.lips} places (${pct(tot.lips, tot.raised).toFixed(2)}% of the raised carriageway triangles${tot.lips ? `, the worst ${tot.worstLip.toFixed(2)} m` : ''}; 1.6% passes, it was 2.3%)`);
ok(pct(tot.inWay, tot.struct) <= 0.02, `the walls and parapets under a raised road keep out of the carriageways: ${tot.inWay} places in one (${pct(tot.inWay, tot.struct).toFixed(3)}% of ${Math.round(tot.struct)} triangles of structure; 0.02% passes)`);
ok(tot.order === 0, `what is painted on the land writes no depth and is drawn first, and nothing else is (${tot.order} meshes out of order)`);
const share = tot.junctions ? tot.holed / tot.junctions : 0;
ok(share < 0.06, `junction mouths are covered: 0.1 m2 or more of bare ground at ${tot.holed} of ${tot.junctions} junctions (${(100 * share).toFixed(1)}%, ${tot.holeM2.toFixed(0)} m2 in all; under 6% passes, it was 70%)`);
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall road surface checks passed');
process.exit(fails ? 1 : 0);
