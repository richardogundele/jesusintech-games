// Road signs for the Kent world: where they stand and the meshes for one 500 m tile at a time.
// The plan (every post, beacon, bollard and signal head in the region) is worked out once from the
// RoadNet on the first near tile, then each tile builds the assemblies whose anchor falls inside it,
// so a sign on a seam belongs to exactly one tile. Faces come from src/signs.js (cached textures)
// and are instanced per texture; posts, sign backs, bollards, beacons and signal heads are one
// draw call each per tile. Far tiles get nothing: a sign is unreadable past a few hundred metres.
//
// Siting rules (TSM chapters 3/4/7, simplified): posts stand 0.6 m outside the carriageway edge,
// or 0.6 m behind the footway where the road has one (the widths roads.js draws), face the traffic
// they are for, never stand on asphalt (ribbons, junction patches, bell mouths, ring annuli) or in
// a building, and two signs on the same side of a road stay 8 m apart: the lesser one is mounted
// back to back on the other's post when they face opposite ways, otherwise dropped.
//
// Conventions: x east, z south, left-hand traffic, leftOf((dx,dz)) = (dz,-dx), a heading h travels
// along (sin h, cos h). A face group's front looks along -z (signs.js), so rotation.y = the heading
// of the traffic reading it.
import * as THREE from 'three';
import { signTexture, directionSignTexture, signSize, signPlacement, signFace } from '../signs.js';
import { netView, _internals, TILE, tileKey } from './roads.js';
import { PAVE_W, KERB_W, band as bandOf, frameAt, frameIndex } from './markings.js';
import { GridIndex } from './net.js';

const { descOf, prepWay, nodeInfo, ringArm } = _internals;
const DEG = Math.PI / 180;
const hypot = Math.hypot;
const norm180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360; // 0 = north (-z), clockwise
const isA = (ref) => /^A\d/.test(ref || '');
const isAB = (ref) => /^[AB]\d/.test(ref || '');
const ZONE_CLS = new Set(['residential', 'unclassified', 'living_street']);
const NO_SIGNS = new Set(['service', 'living_street']);
const SIGNAL_CROSSINGS = new Set(['pelican', 'puffin', 'toucan', 'signals']);
const MILE = 1609.34;

// ---------- shared meshes and materials (module level: every tile reuses them) ----------
let shared = null;
function sharedParts() {
  if (shared) return shared;
  const post = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); // unit diameter and height, scaled per post
  post.translate(0, 0.5, 0);
  // Belisha pole: alternating black and white bands as vertex colours (no canvas needed)
  const poleParts = [], bands = 10;
  for (let i = 0; i < bands; i++) {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1 / bands, 8, 1, true);
    g.translate(0, (i + 0.5) / bands, 0);
    const c = i % 2 ? [0.06, 0.06, 0.06] : [0.95, 0.95, 0.95], n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(c).flat(), 3));
    poleParts.push(g);
  }
  const lamp = new THREE.CircleGeometry(0.1, 14);
  lamp.rotateY(Math.PI); // faces -z like a sign face
  shared = {
    post, pole: mergeSimple(poleParts),
    globe: new THREE.SphereGeometry(0.2, 14, 10),
    housing: new THREE.BoxGeometry(0.34, 1.0, 0.24),
    lamp,
    bollard: new THREE.CylinderGeometry(0.16, 0.16, 1.0, 16).translate(0, 0.5, 0),
    bollardBand: new THREE.CylinderGeometry(0.162, 0.162, 0.1, 16).translate(0, 0.05, 0),
    postMat: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.45, metalness: 0.6 }),
    poleMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    // amber globes glow on their own; the builder's tick() blinks them
    globeMat: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 2.2, roughness: 0.4 }),
    housingMat: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }),
    lampMat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    bollardMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xfff6dc, emissiveIntensity: 0.35 }),
    bandMat: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  };
  return shared;
}
/** concatenate non-indexed / indexed geometries with the same attributes (position, normal, color) */
function mergeSimple(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geos[0].attributes)) {
    const size = geos[0].attributes[name].itemSize, arr = [];
    for (const g of geos) if (g.attributes[name]) arr.push(...g.attributes[name].array);
    out.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  return out;
}

// face geometry + material per texture and size, taken from signs.js's own signFace()
const faceCache = new Map();
function faceOf(tex, sizeMm) {
  const key = `${tex.uuid}|${sizeMm || 0}`;
  let f = faceCache.get(key);
  if (!f) {
    const g = signFace(tex, sizeMm), [front, back] = g.children;
    f = { key, geo: front.geometry, mat: front.material, backMat: back.material, wM: g.userData.wM, hM: g.userData.hM };
    faceCache.set(key, f);
  }
  return f;
}

// lamp colours: lit, and the dark lens when off
const LAMP = { red: new THREE.Color(0xff2a1a), amber: new THREE.Color(0xffa21a), green: new THREE.Color(0x2aff7a), off: new THREE.Color(0x1d1d1d) };
const ASPECTS = { red: [1, 0, 0], amber: [0, 1, 0], green: [0, 0, 1], redamber: [1, 1, 0], off: [0, 0, 0] };

/**
 * The signs builder. `colliders` is the world's Colliders (posts are registered there and removed
 * on dispose). `heads` lists the signal heads of the built near tiles: { x, z, y, heading, group
 * (signal group id, as net.lanePath events name it), node, kind, object, state, setState(state) }
 * with state 'red' | 'amber' | 'green' | 'redamber' | 'off'; they start green.
 */
export function makeSignBuilder({ net, colliders = null, groundY = null } = {}) {
  // every post, sign face, bollard, beacon and signal head stands on the ground; on a flat world
  // this is 0 and the maths below is unchanged
  const gy = groundY || (() => 0);
  const view = netView(net);
  let plan = null;
  const heads = [];
  // a broken plan must not be retried (and hitch) on every tile: fall back to no signs
  const safePlan = () => {
    try { return makePlan(net, view); } catch (e) {
      console.warn('[kent signs] plan failed, no signs this session', e);
      return { all: [], byTile: new Map(), clear: () => false, stats: { failed: String(e) } };
    }
  };
  const builder = {
    name: 'signs',
    heads,
    build(tile, lod) {
      if (lod !== 'near') return { group: new THREE.Group(), dispose() {}, stats: { signs: 0 } };
      if (!plan) plan = safePlan();
      return buildTile(tile, plan.byTile.get(tileKey(tile.tx, tile.tz)) || [], { clear: plan.clear, colliders, heads });
    },
    /** blink the Belisha globes (call from a world ticker with seconds) */
    tick(t) { if (shared) shared.globeMat.emissiveIntensity = Math.sin(t * Math.PI * 1.2) > 0 ? 2.4 : 0.15; },
    /** the planned assemblies (debug / tests): all, or one tile's */
    /** the plan's road / junction / building test (tests check built posts with it) */
    clearAt(x, z) { if (!plan) plan = safePlan(); return plan.clear(x, z); },
    planned(tile) { if (!plan) plan = safePlan(); return tile ? plan.byTile.get(tileKey(tile.tx, tile.tz)) || [] : plan.all; },
    get planStats() { return plan ? plan.stats : null; },
    dispose() { heads.length = 0; },
  };
  return builder;
}

// ============================================================================================
// the plan: every assembly in the region, once
// ============================================================================================

function makePlan(net, view) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const D = (w) => descOf(view, w);
  const P = (w) => prepWay(view, w);
  const cands = [];
  let seq = 0;

  // ---- junction patches and bell mouths, for the asphalt test ----
  const juncGrid = new GridIndex(50);
  for (const n of view.nodes.values()) {
    if (n.wayIds.length < 2 || view.ringNodeRb.has(n.id)) continue;
    const info = nodeInfo(view, n.id);
    if (info.R > 0 || info.fillets.length) juncGrid.insert(n.x - 30, n.z - 30, n.x + 30, n.z + 30, info);
  }

  // ---- geometry helpers ----
  /** interpolated roads.js frame nearest the net point at arc length s (net and frame arc lengths drift a little at rounded corners) */
  function frameNear(way, s) {
    const F = P(way).frames, [x, z] = net.pointAt(way, s);
    const i0 = frameIndex(F, s);
    let best = Infinity, bs = s;
    for (let i = Math.max(0, i0 - 40); i < Math.min(F.length - 1, i0 + 40); i++) {
      const a = F[i], b = F[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
      const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
      if (d < best) { best = d; bs = a.s + (b.s - a.s) * t; }
    }
    return frameAt(F, bs);
  }
  /** half width of a way's ribbon near a point, flares into roundabouts included */
  function hwNear(way, x, z) {
    const d = D(way); let hw = d.hw;
    for (const a of P(way).ringArms) {
      if (!a.splitter || hypot(x - a.node.x, z - a.node.z) > 45) continue;
      hw = Math.max(hw, a.entryLanes * 3.1 + a.wMax, d.hw + Math.max(0, 3.65 + a.wMax - d.hw));
    }
    return hw;
  }
  const inTri = (x, z, A, B, C) => {
    const s1 = (B[0] - A[0]) * (z - A[1]) - (B[1] - A[1]) * (x - A[0]);
    const s2 = (C[0] - B[0]) * (z - B[1]) - (C[1] - B[1]) * (x - B[0]);
    const s3 = (A[0] - C[0]) * (z - C[1]) - (A[1] - C[1]) * (x - C[0]);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  const inPoly = (x, z, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  /** true when (x, z) is off every road surface (with 0.4 m to spare) and outside buildings */
  function clear(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    for (const { way, i } of net.grid.near(x, z, 25)) {
      if (way.rb) continue; // ring ways: the annulus test below
      const a = way.pts[i], b = way.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
      if (hypot(x - a[0] - dx * t, z - a[1] - dz * t) < hwNear(way, x, z) + 0.4) return false;
    }
    for (const rb of net.rbGrid.near(x, z, 1)) {
      const d = hypot(x - rb.x, z - rb.z), inner = rb.r - rb.lanes * rb.laneW;
      if (d > inner - 0.4 && d < rb.r + 0.4) return false;
    }
    for (const info of juncGrid.near(x, z, 1)) {
      if (hypot(x - info.x, z - info.z) < info.R + 0.4) return false;
      for (const f of info.fillets) if (inTri(x, z, f.C, f.TA, f.TB) && hypot(x - f.O[0], z - f.O[1]) > f.rf - 0.4) return false;
    }
    for (const b of net.buildingsNear(x, z, 12)) {
      const [x0, z0, x1, z1] = b.box;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && inPoly(x, z, b.pts)) return false;
    }
    return true;
  }
  /** a post just outside a bell-mouth kerb arc instead of on the asphalt inside it */
  function offFillet(x, z, extra) {
    for (const info of juncGrid.near(x, z, 1)) for (const f of info.fillets) {
      if (!inTri(x, z, f.C, f.TA, f.TB) || hypot(x - f.O[0], z - f.O[1]) <= f.rf - 0.4) continue;
      const dx = x - f.O[0], dz = z - f.O[1], L = hypot(dx, dz) || 1, r = Math.max(0.3, f.rf - extra - 0.6);
      return [f.O[0] + (dx / L) * r, f.O[1] + (dz / L) * r];
    }
    return null;
  }
  /**
   * Post site beside a way at net arc length s for traffic travelling tdir (+1 along the points),
   * on its left (side +1) or right (-1). Returns null if no clear spot within 3 m of the ideal one.
   */
  function site(way, s, tdir, side) {
    s = Math.max(0.5, Math.min(way.len - 0.5, s));
    const f = frameNear(way, s), d = D(way), wside = side * tdir;
    const hw = wside > 0 ? f.hwL : f.hwR, pave = d.pave && !d.rb ? KERB_W + PAVE_W : 0;
    const ox = f.nx * wside, oz = f.nz * wside, tx = f.tx * tdir, tz = f.tz * tdir;
    const e = hw + pave;
    const at = (x, z) => ({ x, z, ox, oz, tx, tz, yaw: Math.atan2(tx, tz), urban: !!d.pave, wayId: way.id, wside });
    // at a junction the ideal spot can fall inside a bell mouth: stand on its corner instead
    const x0 = f.x + ox * (e + 0.6), z0 = f.z + oz * (e + 0.6), moved = offFillet(x0, z0, pave);
    if (moved && clear(moved[0], moved[1])) return at(moved[0], moved[1]);
    for (const push of [0, 1, 2, 3]) {
      const x = f.x + ox * (e + 0.6 + push), z = f.z + oz * (e + 0.6 + push);
      if (clear(x, z)) return at(x, z);
    }
    return null;
  }
  /**
   * Walk D metres from (way, s) in direction dir (+1 along the points), crossing nodes onto the
   * same road (ref, then name, then the straightest arm). flow = -1 when the traffic we sign for
   * travels back towards the start (signs before a hazard), +1 when it travels with the walk.
   * Stops at roundabouts and dead ends (null).
   */
  function along(way, s, dir, Dm, flow) {
    let rem = Dm;
    for (let guard = 0; guard < 40; guard++) {
      const end = dir > 0 ? way.len : 0, avail = Math.abs(end - s);
      if (rem <= avail) return { way, s: s + dir * rem, dir };
      rem -= avail;
      const nid = way.nodes[dir > 0 ? way.nodes.length - 1 : 0], node = nid ? net.nodes.get(nid) : null;
      if (!node || node.rb) return null;
      const dv = net.dirAt(way, dir > 0 ? way.len - 0.1 : 0.1), inH = bearingOf(dv[0] * dir, dv[1] * dir);
      let best = null, bestScore = -Infinity;
      for (const a of node.arms()) {
        if (a.way === way || a.way.rb) continue;
        if (a.way.oneway && a.dir * flow !== 1) continue; // the signed traffic must be allowed along it
        const turn = Math.abs(norm180(a.bearing - inH));
        let score = -turn;
        if (way.ref && a.way.ref === way.ref) score += 200; else if (way.name && a.way.name === way.name) score += 150;
        if (turn > 60 && score < 100) continue;
        if (score > bestScore) { bestScore = score; best = a; }
      }
      if (!best) return null;
      way = best.way; dir = best.dir; s = way.cum[best.idx];
    }
    return null;
  }
  /** site for a sign D metres before a node on the arm (way, dir) leaving it, for traffic approaching the node */
  function before(way, idx, dir, Dm, side = 1) {
    const r = along(way, way.cum[idx], dir, Dm, -1);
    return r ? site(r.way, r.s, -r.dir, side) : null;
  }
  const add = (kind, prio, at, faces, extra = {}) => {
    if (!at) return null;
    const c = { id: seq++, kind, prio, ...at, faces, ...extra };
    cands.push(c);
    return c;
  };
  const face = (facing, spec) => ({ facing, ...spec });
  const legalTravel = (way, tdir) => !way.oneway || tdir === 1;

  // ---------- speed limits ----------
  const limKey = (w) => (w.nsl ? 'nsl' : w.limit);
  const speedId = (w) => {
    const k = limKey(w);
    if (k === 'nsl') return 'speed_nsl';
    if (k === 20 && ZONE_CLS.has(w.cls)) return 'zone_20';
    return [20, 30, 40, 50, 60, 70].includes(k) ? `speed_${k}` : null;
  };
  const bandW = (w) => (w.nsl ? (w.oneway && w.dual ? '70' : '60') : bandOf(w.limit));
  const signable = (w) => !w.rb && !NO_SIGNS.has(w.cls) && (w.nsl || w.limit >= 20) && speedId(w);
  const speedFace = (facing, w, fromW) => face(facing, { sign: speedId(w), band: bandW(fromW || w), opts: { dual: !!w.dual } });
  /**
   * Terminal signs where arm (way, dir) starts at a node, t metres in: the front faces traffic
   * entering the arm (its new limit), the back faces traffic leaving it (backWay's limit, if any).
   * Both sides of a two-way road; the nearside only on a one-way one.
   */
  function terminal(way, idx, dir, t, backWay, prio = 8) {
    t = Math.min(t, way.len * 0.45);
    const s = way.cum[idx] + dir * t;
    const inLegal = legalTravel(way, dir), outLegal = legalTravel(way, -dir);
    const front = inLegal ? speedFace(1, way, backWay) : null;
    let back = outLegal && backWay && signable(backWay) ? speedFace(-1, backWay, way) : null;
    if (back && front && front.sign === 'zone_20') back = null;
    if (!back && front && front.sign === 'zone_20' && outLegal) back = face(-1, { sign: 'zone_20_end_675A' });
    const sides = way.oneway ? [inLegal ? 1 : -1] : [1, -1];
    for (const side of sides) {
      const faces = [front, back].filter(Boolean);
      if (faces.length) add('speed', prio, site(way, s, dir, side), faces, { tag: faces[0].sign });
    }
  }
  for (const node of net.nodes.values()) {
    if (node.ways.length < 2) continue;
    if (node.rb) { // roundabout exits: the arm's limit against the ring's
      const rb = net.roundabouts.get(node.rb);
      for (const a of node.arms()) {
        if (a.way.rb || !signable(a.way) || !legalTravel(a.way, a.dir)) continue;
        const ring = rb.limit || 30;
        if (limKey(a.way) === ring || (a.way.nsl && ring >= 60)) continue;
        const ra = ringArm(view, rb, a.way, node.id);
        terminal(a.way, a.idx, a.dir, (ra ? ra.trim : rb.r * 0.5) + 6, null);
      }
      continue;
    }
    const arms = node.arms().filter((a) => !a.way.rb);
    if (arms.length === 2) { // a limit change along a road
      const [A, B] = arms;
      if (A.way === B.way || !signable(A.way) || !signable(B.way) || limKey(A.way) === limKey(B.way)) continue;
      // the posts stand on the faster road's side of the change, a metre in
      const [hi, lo] = (A.way.nsl ? 99 : A.way.limit) >= (B.way.nsl ? 99 : B.way.limit) ? [A, B] : [B, A];
      terminal(hi.way, hi.idx, hi.dir, 1, lo.way);
      continue;
    }
    if (arms.length < 3) continue;
    const info = nodeInfo(view, node.id);
    if (!info.majors?.length) continue;
    const major = info.majors[0].way;
    for (const a of info.minors) { // side roads with their own limit
      if (!signable(a.way) || limKey(a.way) === limKey(major)) continue;
      const near = Math.max(a.paveCut[1] || 0, a.paveCut[-1] || 0);
      terminal(a.way, a.idx, a.dir, Math.max((a.lineDist || 4) + 6, near + 2, 10), null);
    }
    // the main road changing limit at the junction itself
    const majWays = [...new Set(info.majors.map((a) => a.way))];
    if (majWays.length === 2 && signable(majWays[0]) && signable(majWays[1]) && limKey(majWays[0]) !== limKey(majWays[1])) {
      const [hi, lo] = info.majors.slice().sort((p, q) => (q.way.nsl ? 99 : q.way.limit) - (p.way.nsl ? 99 : p.way.limit));
      if (hi.way !== lo.way) terminal(hi.way, hi.idx, hi.dir, Math.max(10, (hi.paveCut[1] || 0) + 2, (hi.paveCut[-1] || 0) + 2), lo.way);
    }
  }
  // repeaters: rural 40 / 50 roads, one every ~300 m each way, staggered
  for (const w of net.ways.values()) {
    if (w.rb || w.link || w.nsl || (w.limit !== 40 && w.limit !== 50) || D(w).pave || w.len < 300) continue;
    for (const tdir of [1, -1]) {
      if (!legalTravel(w, tdir)) continue;
      for (let k = tdir > 0 ? 150 : 300; k < w.len - 100; k += 300) {
        const s = tdir > 0 ? k : w.len - k;
        add('repeater', 2, site(w, s, tdir, 1), [face(1, { sign: 'speed_repeater', band: bandOf(w.limit), opts: { limit: String(w.limit) } })], { tag: 'speed_repeater' });
      }
    }
  }

  // ---------- give way / stop ----------
  /** OSM puts the stop tag on a vertex a few metres up the side road, not on the junction */
  const stopNear = (way, idx, dir) => {
    for (let j = idx + dir; j >= 0 && j < way.nodes.length && Math.abs(way.cum[j] - way.cum[idx]) <= 30; j += dir) {
      if (way.nodes[j] && net.nodes.get(way.nodes[j])?.stop) return true;
    }
    return false;
  };
  for (const n of view.nodes.values()) {
    const node = net.nodes.get(n.id);
    if (!node || node.rb || node.signals || node.mini || node.ways.length < 2) continue;
    const info = nodeInfo(view, n.id);
    const flagged = node.giveWay || node.stop;
    if (info.kind !== 'junction' || !info.minors.length) continue;
    const majorRank = Math.max(...info.majors.map((a) => a.rank));
    for (const a of info.minors) {
      if (!legalTravel(a.way, -a.dir)) continue; // nobody approaches the junction this way
      if (!flagged && (a.rank < 2 || majorRank < 3 || a.d.link)) continue;
      // 2.5 m before the line on the approaching driver's nearside (site() moves it onto the bell-mouth corner)
      const t = Math.min(a.way.len - 1, (a.lineDist || 4) + 2.5);
      const id = node.stop || stopNear(a.way, a.idx, a.dir) ? 'stop' : 'give_way';
      add(id, id === 'stop' ? 11 : 10, site(a.way, a.way.cum[a.idx] + a.dir * t, -a.dir, 1), [face(1, { sign: id, band: bandW(a.way) })], { tag: id });
    }
  }
  // OSM give-way / stop flags on a vertex just before a junction: face the junction they belong to
  for (const node of net.nodes.values()) {
    if (!(node.giveWay || node.stop) || node.ways.length !== 1 || node.rb) continue;
    for (const a of node.arms()) {
      if (!legalTravel(a.way, a.dir)) continue;
      let j = a.idx; for (;;) { j += a.dir; if (j < 0 || j >= a.way.nodes.length) { j = -1; break; } if (a.way.nodes[j]) break; }
      if (j < 0 || Math.abs(a.way.cum[j] - a.way.cum[a.idx]) > 30) continue;
      const nx = net.nodes.get(a.way.nodes[j]); if (!nx || (nx.ways.length < 2 && !nx.rb)) continue;
      const id = node.stop ? 'stop' : 'give_way';
      add(id, id === 'stop' ? 11 : 10, site(a.way, a.way.cum[a.idx], a.dir, 1), [face(1, { sign: id, band: bandW(a.way) })], { tag: id });
    }
  }

  // ---------- roundabouts ----------
  for (const rb of net.roundabouts.values()) {
    for (const arm of rb.arms) {
      if (!arm.entry) continue;
      const way = net.ways.get(arm.entryWays?.[0]); if (!way) continue;
      const idx = way.nodes.indexOf(arm.node);
      if (idx !== 0 && idx !== way.nodes.length - 1) continue;
      const dir = idx === 0 ? 1 : -1, b = bandW(way), rural = D(way).rural, limit = way.nsl ? 60 : way.limit;
      // 510 roundabout ahead on fast or rural approaches
      if (rural || limit >= 40) {
        const dist = signPlacement('roundabout_ahead', b).distanceBefore || 45;
        add('roundabout_ahead', 6, before(way, idx, dir, dist), [face(1, { sign: 'roundabout_ahead', band: b })], { tag: 'roundabout_ahead' });
      }
      // map-type ADS on A/B approaches and at every multi-lane roundabout
      if (isAB(way.ref) || rb.lanes >= 2) {
        const dist = limit >= 50 ? 150 : limit >= 40 ? 125 : 100;
        add('ads', 7, before(way, idx, dir, dist), [face(1, { direction: () => mapSpec(rb, arm, way, b) })], { tag: 'ads_map', wide: true });
      }
      // give way at the entry of a proper roundabout (minis have their own sign)
      const ra = ringArm(view, rb, way, arm.node);
      if (rb.r >= 12 && ra) {
        add('give_way', 10, site(way, way.cum[idx] + dir * (ra.trim + 2.5), -dir, 1), [face(1, { sign: 'give_way', band: b })], { tag: 'give_way' });
      }
      // keep-left bollard on the splitter island's approach nose, where roads.js ends the island
      if (ra && ra.splitter && (arm.entryLanes || ra.entryLanes) >= 2) {
        const F = P(way).frames, f = frameAt(F, ra.sN + dir * (ra.trim + 0.6 + ra.Ls * 0.72 - 0.35));
        const tx = -dir * f.tx, tz = -dir * f.tz;
        add('bollard', 9, { x: f.x, z: f.z, tx, tz, yaw: Math.atan2(tx, tz), wayId: way.id, wside: 0 }, [face(1, { sign: 'keep_left_bollard', band: b })], { tag: 'keep_left_bollard', exempt: true });
      }
    }
  }
  /** map ADS spec, built when the tile is: destinations need a graph search */
  function mapSpec(rb, inArm, way, b) {
    const H = (inArm.bearing + 180) % 360;
    const primary = isA(way.ref) || rb.arms.some((a) => a.exit && a.refs.some(isA));
    const status = primary ? 'primary' : 'nonprimary';
    const arms = [];
    for (const a of rb.arms) {
      if (!a.exit || a === inArm) continue;
      const rel = ((a.bearing - H) % 360 + 360) % 360;
      if (arms.some((o) => Math.abs(norm180(o.bearing - rel)) < 22)) continue; // a second arm on top of another would overprint it
      const ref = a.refs[0] || null;
      const dest = exitDest(a);
      const text = dest.length || ref;
      const rs = ref ? (isA(ref) && (a.cls === 'trunk' || a.cls === 'primary') ? 'primary' : 'nonprimary') : 'nonprimary';
      arms.push({ bearing: Math.round(rel), dest, route: ref || undefined, routeStatus: text ? rs : undefined });
    }
    return { type: 'map', status, band: b, arms };
  }
  function exitDest(a) {
    const nid = a.exitNode ?? a.node, node = net.nodes.get(nid), w = net.ways.get(a.exitWays?.[0]);
    let names = [];
    if (node && w) {
      const arm = node.arms().find((x) => x.way === w && legalTravel(w, x.dir));
      if (arm) { try { names = net.destinations(nid, arm, 2); } catch { names = []; } }
    }
    if (!names.length && a.dest) names = [a.dest];
    if (!names.length && a.names[0]) names = [a.names[0]];
    return names.slice(0, 2);
  }
  // mini-roundabouts: 611.1 about 30 m before, on every approach
  for (const m of net.data.minis || []) {
    const node = net.nodes.get(m.node); if (!node) continue;
    for (const a of node.arms()) {
      if (a.way.rb || !legalTravel(a.way, -a.dir)) continue;
      const b = bandW(a.way);
      add('mini', 8, before(a.way, a.idx, a.dir, 30), [face(1, { sign: 'mini_roundabout', band: b })], { tag: 'mini_roundabout' });
    }
  }

  // ---------- bends ----------
  for (const w of net.ways.values()) {
    if (w.rb || w.link || D(w).pave || w.len < 60) continue;
    const limit = w.nsl ? 60 : w.limit; if (limit < 40) continue;
    const step = 5, n = Math.floor(w.len / step), rad = [];
    for (let k = 0; k <= n; k++) {
      const s = k * step, a = net.dirAt(w, Math.max(0, s - 15)), c = net.dirAt(w, Math.min(w.len, s + 15));
      const turn = norm180(bearingOf(c[0], c[1]) - bearingOf(a[0], a[1])); // + = right along the points
      const span = Math.min(w.len, s + 15) - Math.max(0, s - 15);
      rad.push({ s, turn, R: Math.abs(turn) > 0.5 ? span / (Math.abs(turn) * DEG) : Infinity });
    }
    for (let k = 0; k < rad.length;) {
      if (rad[k].R >= 80) { k++; continue; }
      const sign = Math.sign(rad[k].turn); let j = k, min = rad[k];
      while (j + 1 < rad.length && rad[j + 1].R < 80 && Math.sign(rad[j + 1].turn) === sign) { j++; if (rad[j].R < min.R) min = rad[j]; }
      const sA = rad[k].s, sB = rad[j].s; k = j + 1;
      const h0 = net.dirAt(w, Math.max(0, sA - 10)), h1 = net.dirAt(w, Math.min(w.len, sB + 10));
      const total = norm180(bearingOf(h1[0], h1[1]) - bearingOf(h0[0], h0[1]));
      if (Math.abs(total) < 35) continue; // a kink, not a bend
      // a junction inside the bend makes it a junction to sign, not a bend
      if (w.nodes.some((nid, i) => nid && net.nodes.get(nid)?.ways.length > 1 && w.cum[i] > sA - 20 && w.cum[i] < sB + 20 && i > 0 && i < w.nodes.length - 1)) continue;
      const b = bandW(w), warn = { 40: 60, 50: 80, 60: 100, 70: 120 }[b] || 60;
      for (const tdir of [1, -1]) {
        if (!legalTravel(w, tdir)) continue;
        const turnDir = sign * tdir > 0 ? 'right' : 'left';
        const sEntry = tdir > 0 ? sA : sB;
        const r = along(w, sEntry, -tdir, warn, -1);
        if (r) add('bend', 5, site(r.way, r.s, -r.dir, 1), [face(1, { sign: `bend_${turnDir}`, band: b })], { tag: 'bend' });
        if (min.R < 50) { // chevrons on the outside of a sharp bend (the far side for a left-hander), facing the driver
          const h = signSize('chevron_board', b), modules = b === '40' ? 2 : 3;
          const spots = sB - sA > 40 ? [min.s - tdir * 12, min.s + tdir * 12] : [min.s];
          for (const s of spots) {
            add('chevron', 6, site(w, s, tdir, turnDir === 'left' ? -1 : 1), [face(1, { sign: 'chevron_board', band: b, size: h, opts: { modules, dir: turnDir, height: h } })], { tag: 'chevron_board', lower: 1.0, mergeKey: `chev${h}${modules}` });
          }
        }
      }
    }
  }

  // ---------- crossings: Belisha beacons and signal heads ----------
  const crossingNodes = new Set();
  for (const c of net.data.crossings || []) {
    const way = net.ways.get(c.way); if (!way || way.rb) continue;
    if (c.type === 'zebra') {
      const f = frameNear(way, c.s);
      for (const ws of [1, -1]) {
        const hw = ws > 0 ? f.hwL : f.hwR, x = f.x + f.nx * ws * (hw + 0.6), z = f.z + f.nz * ws * (hw + 0.6);
        if (clear(x, z)) add('beacon', 9, { x, z, tx: f.tx, tz: f.tz, yaw: Math.atan2(f.tx, f.tz), wayId: way.id, wside: ws }, [], { tag: 'belisha', exempt: true });
      }
    } else if (SIGNAL_CROSSINGS.has(c.type)) {
      if (c.node) crossingNodes.add(c.node);
      const group = `x-${c.node || Math.round(c.x) + ':' + Math.round(c.z)}`;
      for (const tdir of [1, -1]) {
        if (!legalTravel(way, tdir)) continue;
        add('head', 9, siteKerb(way, c.s - tdir * 3.5, tdir), [], { tag: 'signal_head', exempt: true, group, node: c.node || null, hkind: 'crossing' });
      }
    }
  }
  /** a site at the kerb (0.6 m outside the edge, on the footway if any) for heads */
  function siteKerb(way, s, tdir) {
    s = Math.max(0.5, Math.min(way.len - 0.5, s));
    const f = frameNear(way, s), hw = tdir > 0 ? f.hwL : f.hwR, ox = f.nx * tdir, oz = f.nz * tdir;
    const tx = f.tx * tdir, tz = f.tz * tdir;
    for (const push of [0, 1, 2]) {
      const x = f.x + ox * (hw + 0.6 + push), z = f.z + oz * (hw + 0.6 + push);
      if (clear(x, z)) return { x, z, ox, oz, tx, tz, yaw: Math.atan2(tx, tz), wayId: way.id, wside: tdir };
    }
    return null;
  }
  for (const node of net.nodes.values()) {
    if (!node.signals || node.rb || crossingNodes.has(node.id)) continue;
    const group = net.signalGroup.get(node.id) || `j-${node.id}`;
    const info = node.ways.length >= 2 ? nodeInfo(view, node.id) : null;
    for (const a of node.arms()) {
      if (a.way.rb || !legalTravel(a.way, -a.dir)) continue;
      const ra = info?.arms.find((x) => x.way === a.way && x.dir === a.dir);
      const t = info && info.kind === 'junction' ? (ra?.lineDist || ra?.hw || 4) + 1.5 : 1.5;
      add('head', 9, siteKerb(a.way, a.way.cum[a.idx] + a.dir * t, -a.dir), [], { tag: 'signal_head', exempt: true, group, node: node.id, hkind: 'junction' });
    }
  }

  // ---------- dual carriageways ----------
  const realDual = (w) => w.oneway && w.dual && !w.link && (w.nsl || w.limit >= 50);
  for (const node of net.nodes.values()) {
    if (node.rb || node.ways.length < 2) continue;
    const arms = node.arms().filter((a) => !a.way.rb);
    // single becomes dual: 818.1 on the single road; dual becomes single: 520 on the dual
    const out = arms.find((a) => realDual(a.way) && a.dir === 1), inc = arms.find((a) => realDual(a.way) && a.dir === -1);
    for (const s of arms.filter((a) => !a.way.oneway && !a.way.dual && !a.way.link && signable(a.way))) {
      if (out && Math.abs(norm180(out.bearing - (s.bearing + 180))) < 50) {
        const b = bandW(s.way);
        add('dual_ahead', 4, before(s.way, s.idx, s.dir, 400), [face(1, { sign: 'dual_carriageway_ahead', band: b, opts: { miles: '¼' } })], { tag: 'dual_carriageway_ahead' });
      }
      if (inc && Math.abs(norm180(inc.bearing - (s.bearing + 180))) < 50) {
        const b = bandW(inc.way), dist = signPlacement('dual_carriageway_ends', b).distanceBefore || 150;
        add('dual_ends', 6, before(inc.way, inc.idx, inc.dir, dist), [face(1, { sign: 'dual_carriageway_ends', band: b })], { tag: 'dual_carriageway_ends' });
      }
    }
    // slip roads off and onto the trunk dual carriageways
    if (arms.length < 3) continue;
    const info = nodeInfo(view, node.id);
    if (!info.gore) continue;
    const main = info.gore.mainWay;
    if (!main.ref || !(main.cls === 'trunk' || realDual(main))) continue;
    const link = info.gore.link;
    const netArm = (w, dir) => node.arms().find((a) => a.way === w && a.dir === dir);
    if (info.gore.kindG === 'diverge') {
      const app = node.arms().find((a) => a.way === main && a.dir === -1) || node.arms().find((a) => !a.way.link && a.way.oneway && a.dir === -1 && a.way.ref === main.ref);
      const cont = node.arms().find((a) => !a.way.link && a.way.oneway && a.dir === 1 && a.way.ref === main.ref);
      if (!app) continue;
      // a lay-by or a loop that rejoins the same road is not an exit
      const { end } = slipEnd(netArm(link.way, link.dir) || { way: link.way, dir: link.dir });
      if (end && !end.rb && end.arms().some((a) => !a.way.link && a.way.ref === main.ref)) continue;
      if (main.cls === 'trunk') [300, 200, 100].forEach((yd, i) => {
        add('countdown', 7, before(app.way, app.idx, app.dir, yd * 0.9144), [face(1, { sign: 'countdown_markers', size: 1200, opts: { bars: 3 - i, status: 'primary' } })], { tag: 'countdown_markers', lower: 0.9 });
      });
      if (/^A(299|2)\b/.test(main.ref)) {
        const slipArm = netArm(link.way, link.dir);
        let at = null;
        for (const dist of [500, 400, 320]) if ((at = before(app.way, app.idx, app.dir, dist))) break;
        add('ads', 7, at, [face(1, { direction: () => exitSpec(node, main, cont, slipArm, bandW(main)) })], { tag: 'ads_exit', wide: true });
      }
    } else if (info.gore.kindG === 'merge') {
      const cont = node.arms().find((a) => !a.way.link && a.way.oneway && a.dir === 1 && a.way.ref === main.ref);
      if (!cont) continue;
      const r = along(cont.way, cont.way.cum[cont.idx], cont.dir, 200, 1);
      if (r) add('confirm', 5, site(r.way, r.s, r.dir, 1), [face(1, { direction: () => confirmSpec(node, cont, main.ref, bandW(main)) })], { tag: 'route_confirmatory', wide: true });
    }
  }
  function exitSpec(node, main, cont, slipArm, b) {
    const ahead = cont ? (() => { try { return net.destinations(node.id, cont, 2); } catch { return []; } })() : [];
    const slip = slipTarget(slipArm, main);
    const own = slip.dest.filter((n) => !ahead.includes(n)); // the slip's own places, not the main road's again
    return { type: 'stack', status: 'primary', band: b, arms: [
      { bearing: 0, dest: ahead, route: main.ref },
      { bearing: 315, dest: (own.length ? own : slip.dest).slice(0, 2), route: slip.ref || undefined, routeStatus: slip.ref && !isA(slip.ref) ? 'nonprimary' : undefined },
    ] };
  }
  /** the node where a chain of slip-road ways ends, and the last of them */
  function slipEnd(slipArm) {
    let way = slipArm.way, dir = slipArm.dir, end = null;
    for (let guard = 0; guard < 10; guard++) {
      const nid = way.nodes[dir > 0 ? way.nodes.length - 1 : 0];
      end = nid ? net.nodes.get(nid) : null;
      if (!end || end.rb) break;
      const next = end.arms().find((a) => a.way !== way && a.way.link && legalTravel(a.way, a.dir));
      if (!next) break;
      way = next.way; dir = next.dir;
    }
    return { end, way };
  }
  /** where an off-slip leads: the local road at its far end (a roundabout's exits or a junction's arms) */
  function slipTarget(slipArm, main) {
    const out = [];
    let ref = null;
    if (!slipArm) return { dest: out, ref };
    const { end, way } = slipEnd(slipArm);
    if (!end) return { dest: out, ref };
    const push = (names) => { for (const nm of names) if (nm && !out.includes(nm)) out.push(nm); };
    if (end.rb) {
      for (const a of net.roundabouts.get(end.rb)?.arms || []) {
        if (!a.exit || a.refs.includes(main.ref) || /link/.test(a.cls || '')) continue;
        ref = ref || a.refs[0] || null;
        push(exitDest(a));
      }
    } else {
      for (const a of end.arms()) {
        if (a.way.link || a.way.rb || a.way.ref === main.ref || !legalTravel(a.way, a.dir)) continue;
        ref = ref || a.way.ref || null;
        try { push(net.destinations(end.id, a, 1)); } catch { /* no places that way */ }
      }
    }
    if (!out.length && way.name) out.push(way.name);
    return { dest: out, ref };
  }
  function confirmSpec(node, arm, ref, b) {
    let names = [];
    try { names = net.destinations(node.id, arm, 2); } catch { names = []; }
    const dest = names.map((nm) => {
      const p = net.places.find((q) => q.name === nm);
      return [nm, p ? String(Math.max(1, Math.round((hypot(p.x - node.x, p.z - node.z) * 1.15) / MILE))) : ''];
    });
    return { type: 'confirm', status: 'primary', band: b, route: ref, dest };
  }

  // ---------- town entry ----------
  const towns = net.placesIn.filter((p) => (p.rank ?? 2) <= 2 && p.r > 0);
  for (const place of towns) {
    const done = [];
    for (const w of net.ways.values()) {
      if (!isAB(w.ref) || w.link || w.rb || (w.dual && w.nsl)) continue;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1];
        const d0 = hypot(a[0] - place.x, a[1] - place.z) - place.r, d1 = hypot(b[0] - place.x, b[1] - place.z) - place.r;
        if ((d0 > 0) === (d1 > 0)) continue;
        const t = d0 / (d0 - d1), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const tdir = d0 > 0 ? 1 : -1; // inward
        if (!legalTravel(w, tdir)) continue;
        // suburbs inside a bigger town get no welcome
        if (towns.some((o) => o !== place && (o.rank ?? 2) < (place.rank ?? 2) && hypot(x - o.x, z - o.z) < o.r)) continue;
        if (done.some((p) => hypot(p[0] - x, p[1] - z) < 250)) continue;
        done.push([x, z]);
        const s = w.cum[i] + t * (w.cum[i + 1] - w.cum[i]) + tdir * 5;
        add('town', 5, site(w, s, tdir, 1), [face(1, { sign: 'town_entry', band: bandW(w), opts: { name: place.name } })], { tag: 'town_entry', wide: true });
      }
    }
  }

  // ---------- brown tourist signs ----------
  const TOURIST = [{ name: 'Herne Bay Pier', symbol: 'pier' }, { name: 'Reculver Towers', symbol: null }, { name: 'Canterbury Cathedral', symbol: 'cathedral' }];
  const abJunctions = [...net.nodes.values()].filter((n) => !n.rb && n.ways.length >= 2 && n.arms().filter((a) => !a.way.rb).length >= 3 && n.arms().filter((a) => isAB(a.way.ref)).length >= 2);
  for (const T of TOURIST) {
    const lm = net.landmarks.find((l) => l.name === T.name); if (!lm) continue;
    const picked = [];
    const byDist = abJunctions.map((n) => ({ n, d: hypot(n.x - lm.x, n.z - lm.z) })).filter((e) => e.d < 4000).sort((p, q) => p.d - q.d);
    for (const { n } of byDist) {
      if (picked.length >= 2) break;
      if (picked.some((p) => hypot(p.x - n.x, p.z - n.z) < 250)) continue;
      const toLm = bearingOf(lm.x - n.x, lm.z - n.z);
      const arms = n.arms().filter((a) => !a.way.rb && legalTravel(a.way, a.dir) && !NO_SIGNS.has(a.way.cls));
      const go = arms.reduce((b, a) => (!b || Math.abs(norm180(a.bearing - toLm)) < Math.abs(norm180(b.bearing - toLm)) ? a : b), null);
      if (!go || Math.abs(norm180(go.bearing - toLm)) > 60) continue;
      // an A/B approach for which the landmark road is a real left or right turn
      const app = n.arms().find((a) => a !== go && isAB(a.way.ref) && legalTravel(a.way, -a.dir) && Math.abs(norm180(go.bearing - (a.bearing + 180))) > 30);
      if (!app) continue;
      const turn = norm180(go.bearing - (app.bearing + 180)), b = bandW(app.way);
      const miles = hypot(lm.x - n.x, lm.z - n.z) / MILE;
      const spec = { type: 'flag', status: 'tourist', band: b, dest: [T.name], dir: turn < 0 ? 'left' : 'right', distance: miles >= 0.25 ? (miles < 1 ? String(Math.round(miles * 4) / 4).replace('0.25', '¼').replace('0.5', '½').replace('0.75', '¾') : String(Math.round(miles))) : undefined };
      if (T.symbol) spec.symbol = T.symbol;
      const at = before(app.way, app.idx, app.dir, 35);
      if (add('tourist', 4, at, [face(1, { direction: () => spec })], { tag: 'tourist', wide: true })) picked.push(n);
    }
  }

  // ---------- resolve: 8 m apart on a side, back to back where possible ----------
  const order = cands.map((c, i) => [c, i]).sort((p, q) => q[0].prio - p[0].prio || p[1] - q[1]).map((e) => e[0]);
  const keptGrid = new GridIndex(16), kept = [];
  const sideKey = (c) => { const n = net.nearest(c.x, c.z, 40); return n ? `${n.way.id}:${n.side}` : 'none'; };
  let merged = 0, dropped = 0;
  for (const c of order) {
    if (c.exempt) { // street furniture, not signs: only true duplicates go
      if (keptGrid.near(c.x, c.z, 3).some((k) => k.kind === c.kind && hypot(k.x - c.x, k.z - c.z) < 2.5 && Math.cos(k.yaw - c.yaw) > 0.7)) { dropped++; continue; }
    } else {
      c.side = sideKey(c);
      let skip = false;
      for (const k of keptGrid.near(c.x, c.z, 8)) {
        if (k.exempt) { if (hypot(k.x - c.x, k.z - c.z) < 1.5) { skip = true; break; } continue; }
        const d = hypot(k.x - c.x, k.z - c.z);
        if (d >= 8 || (d >= 2.5 && k.side !== c.side)) continue;
        // opposite facing, one face each, same mounting: hang it on the back of the kept post
        const opposite = Math.cos(k.yaw - c.yaw) < -0.85;
        const mk = (o) => o.mergeKey || (o.wide ? null : 'narrow');
        if (opposite && !c.exempt && !k.exempt && c.faces.length === 1 && k.faces.every((f) => f.facing === 1) && mk(c) && mk(c) === mk(k)) {
          k.faces.push({ ...c.faces[0], facing: -1 });
          k.lower = Math.max(k.lower || 0, c.lower || 0) || undefined;
          merged++;
        } else dropped++;
        skip = true; break;
      }
      if (skip) continue;
    }
    kept.push(c);
    keptGrid.insert(c.x, c.z, c.x, c.z, c);
  }
  const byTile = new Map();
  for (const c of kept) {
    const key = tileKey(Math.floor(c.x / TILE), Math.floor(c.z / TILE));
    let a = byTile.get(key); if (!a) byTile.set(key, (a = [])); a.push(c);
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { all: kept, byTile, clear, stats: { candidates: cands.length, kept: kept.length, merged, dropped, ms: Math.round(t1 - t0) } };
}

// ============================================================================================
// one tile's meshes
// ============================================================================================

function texFor(f) {
  if (f.direction) {
    const spec = f.direction();
    return { tex: directionSignTexture(spec), sizeMm: undefined };
  }
  const opts = f.opts || {};
  return { tex: signTexture(f.sign, opts), sizeMm: f.size || signSize(f.sign, f.band || '30', opts) };
}

function buildTile(tile, list, { clear, colliders, heads }) {
  const S = sharedParts();
  const group = new THREE.Group();
  group.name = `signs ${tile.key || tileKey(tile.tx, tile.tz)}`;
  const faces = new Map(); // face key -> { face, matrices: [] }
  const backs = []; // [face, matrix]
  const posts = []; // [x, z, h, d]
  const bollards = [], beacons = [], headList = [];
  const handles = [];
  const byType = {};
  let dropped = 0;
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const mat = (x, y, z, yaw) => new THREE.Matrix4().compose(new THREE.Vector3(x, y + gy(x, z), z), q.setFromAxisAngle(up, yaw), one);
  const addFace = (F, x, y, z, yaw) => {
    // signFace's front is the ShapeGeometry turned half round; its back sits 3 mm behind with the same turn
    const fx = x - 0.04 * Math.sin(yaw), fz = z - 0.04 * Math.cos(yaw);
    let b = faces.get(F.key); if (!b) faces.set(F.key, (b = { face: F, matrices: [] }));
    b.matrices.push(mat(fx, y, fz, yaw + Math.PI));
    backs.push([F, mat(fx + 0.003 * Math.sin(yaw), y, fz + 0.003 * Math.cos(yaw), yaw + Math.PI)]);
  };
  const collide = (x, z, w, d, yaw) => { if (colliders) { const h = colliders.obb(x, z, w, d, yaw, false); if (h) handles.push(h); } };
  const count = (tag) => { byType[tag] = (byType[tag] || 0) + 1; };

  for (const c of list) {
    if (c.kind === 'beacon') { beacons.push(c); collide(c.x, c.z, 0.3, 0.3, c.yaw); count('belisha'); continue; }
    if (c.kind === 'head') { headList.push(c); collide(c.x, c.z, 0.35, 0.35, c.yaw); count('signal_head'); continue; }
    let built;
    try { built = c.faces.map((f) => ({ f, ...texFor(f) })).map((e) => ({ ...e, F: faceOf(e.tex, e.sizeMm) })); } catch (e) { console.warn('[kent signs]', c.tag, e); continue; }
    if (c.kind === 'bollard') {
      bollards.push(c);
      const F = built[0].F;
      addFaceBollard(F, c);
      collide(c.x, c.z, 0.4, 0.4, c.yaw);
      count(c.tag);
      continue;
    }
    // stacks per facing, bottom up; wide faces stand on two posts
    const wMax = Math.max(...built.map((e) => e.F.wM));
    const wide = wMax > 1.2;
    const off = wide ? wMax / 2 - 0.25 : 0;
    let cx = c.x + (c.ox || 0) * off, cz = c.z + (c.oz || 0) * off;
    const postAt = (x, z) => (wide ? [[x - (c.ox || 0) * off, z - (c.oz || 0) * off], [x + (c.ox || 0) * off, z + (c.oz || 0) * off]] : [[x, z]]);
    if (wide && !postAt(cx, cz).every(([x, z]) => clear(x, z))) {
      // the far post lands on something (a bell mouth, a building): one more metre out, else leave it out
      cx += (c.ox || 0); cz += (c.oz || 0);
      if (!postAt(cx, cz).every(([x, z]) => clear(x, z))) { dropped++; continue; }
    }
    const lower = c.lower ?? (c.urban ? 2.1 : 1.5);
    let top = 0;
    for (const facing of [1, -1]) {
      let y = lower;
      for (const e of built.filter((b) => (b.f.facing || 1) === facing)) {
        addFace(e.F, cx, y + e.F.hM / 2, cz, facing > 0 ? c.yaw : c.yaw + Math.PI);
        y += e.F.hM + 0.05;
        top = Math.max(top, y - 0.05);
      }
    }
    for (const [x, z] of postAt(cx, cz)) { posts.push([x, z, top - 0.02, 0.076]); collide(x, z, 0.25, 0.25, c.yaw); }
    count(c.tag);
    for (const e of built.slice(1)) if (e.f.sign && e.f.sign !== c.tag) count(e.f.sign);
  }

  function addFaceBollard(F, c) {
    // the keep-left disc on the bollard's front at 0.7 m (makeSign's bollard), no grey back
    const fx = c.x - 0.165 * Math.sin(c.yaw), fz = c.z - 0.165 * Math.cos(c.yaw);
    let b = faces.get(F.key); if (!b) faces.set(F.key, (b = { face: F, matrices: [] }));
    b.matrices.push(mat(fx, 0.7, fz, c.yaw + Math.PI));
  }

  // ---- meshes ----
  const meshes = [];
  const inst = (geo, material, matrices, shadow = true) => {
    if (!matrices.length) return null;
    const m = new THREE.InstancedMesh(geo, material, matrices.length);
    matrices.forEach((M, i) => m.setMatrixAt(i, M));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = shadow;
    m.computeBoundingSphere();
    group.add(m); meshes.push(m);
    return m;
  };
  for (const { face, matrices } of faces.values()) inst(face.geo, face.mat, matrices);
  // all sign backs in one merged mesh (they share the grey material)
  if (backs.length) {
    const backGeo = mergeTransformed(backs.map(([F, M]) => [F.geo, M]));
    const m = new THREE.Mesh(backGeo, backs[0][0].backMat);
    m.castShadow = true;
    group.add(m); meshes.push(m);
    m.userData.ownGeometry = true;
  }
  for (const c of headList) posts.push([c.x, c.z, 2.5, 0.11]); // signal poles share the post mesh
  inst(S.post, S.postMat, posts.map(([x, z, h, d]) => new THREE.Matrix4().compose(new THREE.Vector3(x, gy(x, z), z), q.identity(), new THREE.Vector3(d, h, d))));
  inst(S.bollard, S.bollardMat, bollards.map((c) => mat(c.x, 0, c.z, c.yaw)));
  inst(S.bollardBand, S.bandMat, bollards.map((c) => mat(c.x, 0, c.z, c.yaw)));
  inst(S.pole, S.poleMat, beacons.map((c) => new THREE.Matrix4().compose(new THREE.Vector3(c.x, gy(c.x, c.z), c.z), q.identity(), new THREE.Vector3(0.12, 2.6, 0.12))));
  inst(S.globe, S.globeMat, beacons.map((c) => mat(c.x, 2.8, c.z, 0)), false);

  // ---- signal heads: pole, housing, and every lamp of the tile in one instanced mesh ----
  const tileHeads = [];
  if (headList.length) {
    inst(S.housing, S.housingMat, headList.map((c) => mat(c.x, 3.0, c.z, c.yaw)));
    const lampMs = [];
    headList.forEach((c) => {
      const sx = Math.sin(c.yaw), cz = Math.cos(c.yaw);
      for (const y of [3.32, 3.0, 2.68]) lampMs.push(mat(c.x - 0.125 * sx, y, c.z - 0.125 * cz, c.yaw));
    });
    const lamps = inst(S.lamp, S.lampMat, lampMs, false);
    const setColours = (k, state) => {
      const on = ASPECTS[state] || ASPECTS.off;
      lamps.setColorAt(3 * k, on[0] ? LAMP.red : LAMP.off);
      lamps.setColorAt(3 * k + 1, on[1] ? LAMP.amber : LAMP.off);
      lamps.setColorAt(3 * k + 2, on[2] ? LAMP.green : LAMP.off);
      lamps.instanceColor.needsUpdate = true;
    };
    headList.forEach((c, k) => {
      const object = new THREE.Object3D();
      object.position.set(c.x, 3.0 + gy(c.x, c.z), c.z); object.rotation.y = c.yaw;
      group.add(object);
      const h = {
        x: c.x, z: c.z, y: 3.0 + gy(c.x, c.z), heading: c.yaw, group: c.group, node: c.node, kind: c.hkind, object, state: 'green',
        setState(state) { if (!ASPECTS[state] || state === h.state) return; h.state = state; setColours(k, state); },
      };
      setColours(k, 'green');
      tileHeads.push(h);
    });
    heads.push(...tileHeads);
  }

  return {
    group,
    stats: { signs: list.length, dropped, byType, drawCalls: meshes.length, tris: 0 },
    dispose() {
      if (colliders) for (const h of handles) colliders.remove(h);
      for (const h of tileHeads) { const i = heads.indexOf(h); if (i >= 0) heads.splice(i, 1); }
      for (const m of meshes) {
        if (m.isInstancedMesh) m.dispose();
        if (m.userData.ownGeometry) m.geometry.dispose();
      }
      group.clear();
    },
  };
}

/** one indexed geometry from [geometry, matrix] pairs (position + normal only: the backs are plain grey) */
function mergeTransformed(pairs) {
  let nv = 0, ni = 0;
  for (const [g] of pairs) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const [g, M] of pairs) {
    const P = g.attributes.position, N = g.attributes.normal;
    nm.getNormalMatrix(M);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M); pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
