import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setupSky, Colliders } from './common.js';
import { label } from '../materials.js';
import { buildPedestrian } from '../models.js';
import { hdri, pbr, instanced } from '../assets.js';

// Whitmore: a small English town for driving lessons. Left-hand traffic, mph, a single-lane
// roundabout, give-way T-junctions, a zebra crossing and a set of puffin lights.
// Heading convention (same as the cars): forward = (sin h, cos h); the driver's LEFT is (cos h, -sin h).

export const ROAD_W = 7.4;
export const LANE = ROAD_W / 4;            // lane centre, measured from the centre line
const PAVE = 2.5;                           // pavement width
const RB = { x: 0, z: 0, outer: 14, island: 6.5, lane: 10.4 };
export const MPH = 2.23694;                 // m/s -> mph

const V = (x, z) => new THREE.Vector2(x, z);
export const leftOf = (d) => V(d.y, -d.x);  // d = (dx, dz) unit vector

// ---- the network ----
export const NODES = {
  TC: { p: V(-275, 0), type: 'end' },
  WEND: { p: V(-305, 0), type: 'end' },
  J1: { p: V(-200, 0), type: 'T', minor: V(0, 1) },
  CLT: { p: V(-200, 200), type: 'bend' },
  J3: { p: V(0, 200), type: 'T', minor: V(-1, 0) },
  STN: { p: V(0, 262), type: 'end' },
  RB: { p: V(0, 0), type: 'rb' },
  J4: { p: V(0, -200), type: 'T', minor: V(0, 1) },
  RVW: { p: V(-130, -200), type: 'end' },
  RVE: { p: V(200, -200), type: 'bend' },
  J5: { p: V(200, 0), type: 'T', minor: V(0, -1) },
  EEND: { p: V(305, 0), type: 'end' },
};
export const ROADS = [
  { a: 'WEND', b: 'J1', limit: 30, name: 'High Street' },
  { a: 'J1', b: 'RB', limit: 30, name: 'High Street' },
  { a: 'RB', b: 'J5', limit: 30, name: 'High Street' },
  { a: 'J5', b: 'EEND', limit: 30, name: 'High Street' },
  { a: 'J1', b: 'CLT', limit: 20, name: 'Church Lane' },
  { a: 'CLT', b: 'J3', limit: 20, name: 'Park Road' },
  { a: 'RB', b: 'J3', limit: 30, name: 'Station Road' },
  { a: 'J3', b: 'STN', limit: 30, name: 'Station Road' },
  { a: 'RB', b: 'J4', limit: 30, name: 'Station Road' },
  { a: 'RVW', b: 'J4', limit: 40, name: 'Riverside Road' },
  { a: 'J4', b: 'RVE', limit: 40, name: 'Riverside Road' },
  { a: 'RVE', b: 'J5', limit: 40, name: 'Mill Road' },
];
export const ZEBRA = { x: -100, z: 0 };
export const LIGHTS = { x: 110, z: 0 };

/** Nearest road to a point: { road, dist, along } */
export function nearestRoad(x, z) {
  let best = null;
  for (const r of ROADS) {
    const a = NODES[r.a].p, b = NODES[r.b].p;
    const dx = b.x - a.x, dz = b.y - a.y, L2 = dx * dx + dz * dz;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.y) * dz) / L2, 0, 1);
    const d = Math.hypot(x - (a.x + dx * t), z - (a.y + dz * t));
    if (!best || d < best.dist) best = { road: r, dist: d };
  }
  return best;
}
export const speedLimitAt = (x, z) => (Math.hypot(x - RB.x, z - RB.z) < RB.outer + 2 ? 30 : nearestRoad(x, z).road.limit);

// ---------- routes: lane-centre polylines through the network, plus the events along them ----------
const ORD = ['first', 'second', 'third', 'fourth'];
/** The direction traffic circulates (sign of angle change), found from the rule "turn left to join". */
export function rbSense() {
  const dIn = V(0, -1); // arriving from the north arm, heading south
  const entry = V(-dIn.x * RB.lane, -dIn.y * RB.lane);
  const th = Math.atan2(entry.y, entry.x);
  const tangent = V(-Math.sin(th), Math.cos(th));
  return tangent.dot(leftOf(dIn)) > 0 ? 1 : -1;
}

/**
 * stops: node names or {x, z} points. Returns { pts: [{x,z,s}], length, events }.
 * events: { kind: 'turn'|'emerge'|'rb'|'bend'|'zebra'|'lights'|'pullup', s, dir, exit, text }
 */
export function buildRoute(stops) {
  const P = stops.map((n) => (typeof n === 'string' ? NODES[n].p.clone() : V(n.x, n.z)));
  const names = stops.map((n) => (typeof n === 'string' ? n : null));
  const dirs = [];
  for (let i = 0; i < P.length - 1; i++) dirs.push(P[i + 1].clone().sub(P[i]).normalize());
  const raw = [];
  const marks = []; // { idx in raw, event }
  const push = (v) => raw.push(v.clone());
  const sense = rbSense();
  push(P[0].clone().addScaledVector(leftOf(dirs[0]), LANE));
  for (let k = 1; k < P.length - 1; k++) {
    const dIn = dirs[k - 1], dOut = dirs[k], node = NODES[names[k]] || { type: 'via' };
    const c = P[k];
    if (node.type === 'rb') {
      const E = c.clone().addScaledVector(dIn, -RB.outer - 2).addScaledVector(leftOf(dIn), LANE);
      push(E);
      marks.push({ i: raw.length - 1, ev: { kind: 'rbEntry' } });
      const angOf = (v) => Math.atan2(v.y, v.x);
      const thIn = angOf(dIn.clone().multiplyScalar(-RB.lane).addScaledVector(leftOf(dIn), LANE));
      const thOut = angOf(dOut.clone().multiplyScalar(RB.lane).addScaledVector(leftOf(dOut), LANE));
      const sweep = (th) => { let d = (th - thIn) * sense; d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); return d; };
      // which exit is it? count the other arms we pass
      const arms = [V(0, 1), V(1, 0), V(0, -1), V(-1, 0)].filter((a) => a.dot(dIn) > -0.9);
      const order = arms.map((a) => sweep(angOf(a.clone().multiplyScalar(RB.lane).addScaledVector(leftOf(a), LANE)))).sort((a, b) => a - b);
      const total = sweep(thOut);
      const exit = order.findIndex((v) => Math.abs(v - total) < 1e-3) + 1;
      const n = Math.max(6, Math.round((total * RB.lane) / 1.5));
      const startIdx = raw.length;
      for (let j = 0; j <= n; j++) {
        const th = thIn + (sense * total * j) / n;
        push(V(c.x + Math.cos(th) * RB.lane, c.y + Math.sin(th) * RB.lane));
      }
      push(c.clone().addScaledVector(dOut, RB.outer + 2).addScaledVector(leftOf(dOut), LANE));
      const dirExit = exit === 1 ? 'left' : exit === order.length ? 'right' : 'none';
      marks.push({ i: startIdx, ev: { kind: 'rb', exit, dir: dirExit, text: `At the roundabout, take the ${ORD[exit - 1]} exit${exit === 2 && order.length === 3 ? ', straight ahead' : ''}.` } });
      continue;
    }
    const cross = dIn.x * dOut.y - dIn.y * dOut.x;
    if (Math.abs(cross) < 0.3) { push(c.clone().addScaledVector(leftOf(dIn), LANE)); continue; }
    const turnLeft = dOut.dot(leftOf(dIn)) > 0;
    const dir = turnLeft ? 'left' : 'right';
    const r = turnLeft ? 6 : 8;
    const A = c.clone().addScaledVector(dIn, -r).addScaledVector(leftOf(dIn), LANE);
    const B = c.clone().addScaledVector(dOut, r).addScaledVector(leftOf(dOut), LANE);
    const Q = c.clone().addScaledVector(leftOf(dIn), LANE).addScaledVector(leftOf(dOut), LANE);
    const startIdx = raw.length;
    for (let j = 0; j <= 8; j++) {
      const t = j / 8, u = 1 - t;
      push(V(u * u * A.x + 2 * u * t * Q.x + t * t * B.x, u * u * A.y + 2 * u * t * Q.y + t * t * B.y));
    }
    let ev;
    if (node.type === 'bend') ev = { kind: 'bend', dir, text: `Follow the road round to the ${dir}.` };
    else if (node.type === 'T' && node.minor.dot(dIn.clone().negate()) > 0.9) ev = { kind: 'emerge', dir, node: names[k], text: `At the end of the road, turn ${dir}.` };
    else ev = { kind: 'turn', dir, text: `Take the next road on the ${dir}.` };
    marks.push({ i: startIdx + 4, ev });
  }
  const last = P.length - 1;
  push(P[last].clone().addScaledVector(leftOf(dirs[last - 1]), LANE));

  // resample every ~1.5 m with cumulative distance
  const pts = [];
  const idxMap = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      const a = raw[i - 1], b = raw[i], L = a.distanceTo(b), n = Math.max(1, Math.round(L / 1.5));
      for (let j = 1; j <= n; j++) {
        const t = j / n;
        pts.push({ x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t, s: s + L * t });
      }
      s += L;
    } else pts.push({ x: raw[0].x, z: raw[0].y, s: 0 });
    idxMap[i] = pts.length - 1;
  }
  const events = [];
  let rbEntryS = null;
  for (const m of marks) {
    const sAt = pts[idxMap[m.i]].s;
    if (m.ev.kind === 'rbEntry') { rbEntryS = sAt; continue; }
    if (m.ev.kind === 'rb') { events.push({ ...m.ev, s: rbEntryS, entryS: rbEntryS }); continue; }
    const ev = { ...m.ev, s: sAt };
    if (ev.kind === 'emerge') {
      // the give-way line: where the lane crosses the mouth of the side road
      const nd = NODES[ev.node];
      const hit = pts.find((p) => p.s < sAt && p.s > sAt - 30 && (p.x - nd.p.x) * nd.minor.x + (p.z - nd.p.y) * nd.minor.y < ROAD_W / 2 + 0.6);
      ev.lineS = hit ? hit.s : sAt - 8;
    }
    events.push(ev);
  }
  // crossings the route passes over (stop line ~4.5 m before the stripes)
  for (const [kind, f] of [['zebra', ZEBRA], ['lights', LIGHTS]]) {
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (Math.abs(p.x - f.x) < 0.8 && Math.abs(p.z - f.z) < ROAD_W / 2) {
        events.push({ kind, s: p.s - 4.5 });
        i += 20;
      }
    }
  }
  events.push({ kind: 'pullup', s: s, text: 'Pull up on the left at a safe place, please.' });
  events.sort((a, b) => a.s - b.s);
  return { pts, length: s, events, start: { x: pts[0].x, z: pts[0].z, heading: Math.atan2(pts[3].x - pts[0].x, pts[3].z - pts[0].z) } };
}

// ---------- textures ----------
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function bricks(ctx, x0, y0, w, h, base, scale = 1) {
  const bw = 22 * scale, bh = 7.5 * scale;
  ctx.fillStyle = '#b9b0a2';
  ctx.fillRect(x0, y0, w, h);
  const [r, g, b] = base;
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    for (let x = x0 - (row % 2) * bw / 2; x < x0 + w; x += bw) {
      const k = rnd(-18, 18);
      ctx.fillStyle = `rgb(${r + k},${g + k * 0.7},${b + k * 0.5})`;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
}
const BRICKS = [[150, 70, 52], [128, 64, 48], [168, 98, 66], [112, 58, 46]];

function brickTexture(base) {
  const t = canvas(256, 256, (ctx, w, h) => bricks(ctx, 0, 0, w, h, base, 1.2));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

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

/** A terraced house front: 5.4 m x 6 m -> 512 x 576 px */
function houseFront(base, door) {
  return canvas(512, 576, (ctx, w, h) => {
    bricks(ctx, 0, 0, w, h, base, 1.0);
    sash(ctx, 70, 70, 130, 170);
    sash(ctx, 310, 70, 130, 170);
    // bay window
    ctx.fillStyle = '#efece4';
    ctx.fillRect(30, 300, 250, 230);
    sash(ctx, 50, 330, 64, 170); sash(ctx, 124, 330, 64, 170); sash(ctx, 198, 330, 64, 170);
    // door + fanlight
    ctx.fillStyle = '#efece4';
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
  });
}

function shopFront(base, fascia, name, ink = '#ffffff') {
  return canvas(512, 576, (ctx, w, h) => {
    bricks(ctx, 0, 0, w, h, base, 1.0);
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
  });
}

function roundel(text, { ring = '#d42020', fill = '#ffffff', ink = '#111111' } = {}) {
  return canvas(256, 256, (ctx) => {
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(128, 128, 96, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = '700 104px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 136);
  });
}
function giveWayTex() {
  return canvas(256, 256, (ctx) => {
    ctx.fillStyle = '#d42020';
    ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(248, 20); ctx.lineTo(128, 236); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(48, 44); ctx.lineTo(208, 44); ctx.lineTo(128, 188); ctx.closePath(); ctx.fill();
  });
}
function plateTex(text) {
  return canvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#111'; ctx.font = '700 64px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4, w - 40);
  });
}
export function lPlateTex() {
  return canvas(128, 128, (ctx) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#d61f1f'; ctx.fillRect(36, 18, 24, 90); ctx.fillRect(36, 84, 60, 24);
  });
}

// ---------- geometry helpers ----------
/** Box with UVs scaled to metres / tile so textures repeat at a real-world size. */
function boxUV(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * spans[f][0] / tile, uv.getY(i) * spans[f][1] / tile);
  }
  return g;
}
/** place geometry: rotate about y then translate */
function placed(g, x, y, z, rotY = 0) {
  g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}
/** Flat strip (on the ground) from a to b (Vector2), width w, at height y. Optional dashes. */
function strip(a, b, w, y) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.PlaneGeometry(w, L);
  g.rotateX(-Math.PI / 2);
  const m = a.clone().add(b).multiplyScalar(0.5);
  return placed(g, m.x, y, m.y, Math.atan2(d.x, d.y));
}

// ---------- the town ----------
export function buildUK(renderer) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, {
    hdri: hdri('monaco'), sunAzimuth: 200, exposure: 0.95, envIntensity: 0.9,
    sunColor: 0xfff4e6, sunIntensity: 2.6, fogDensity: 0.0016, fogTint: 0.95,
  });
  const colliders = new Colliders();
  const tickers = [];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1200), pbr('leafy_grass', { repeat: [220, 190], color: 0x9fbf86 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const asphalt = pbr('clean_asphalt', { repeat: [1, 1], color: 0x8c8c8c, roughness: 1 });
  const paving = pbr('rectangular_paving', { repeat: [1, 1], color: 0xc9c4ba });
  for (const m of [asphalt, paving]) for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].repeat.set(1 / 4, 1 / 4);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9 });

  const roadG = [], paveG = [], lineG = [], yellowG = [], kerbG = [];
  const P = (n) => NODES[n].p;
  const trimAt = (node, along) => {
    const n = NODES[node];
    if (n.type === 'rb') return RB.outer - 0.5;
    if (n.type === 'T') return Math.abs(n.minor.dot(along)) > 0.9 ? ROAD_W / 2 : 0; // minor stops at the major's edge
    if (n.type === 'bend') return -ROAD_W / 2; // run past the corner so the outer quadrant is covered
    return 0;
  };
  // world-space UVs for flat ground strips (so asphalt/paving tile at a real size)
  const worldUV = (g) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    return g;
  };
  /** the other road's outward direction at a node (for bends) */
  const otherAt = (nm, r) => {
    const o = ROADS.find((x) => x !== r && (x.a === nm || x.b === nm));
    const far = P(o.a === nm ? o.b : o.a);
    return far.clone().sub(P(nm)).normalize();
  };
  /** how much a pavement on side `sv` (unit vector from the road toward that side) is trimmed at node nm */
  const paveTrim = (nm, r, out, sv) => {
    const n = NODES[nm];
    if (n.type === 'rb') return RB.outer - 1;
    if (n.type === 'bend') return otherAt(nm, r).dot(sv) > 0.5 ? ROAD_W / 2 + PAVE : -(ROAD_W / 2 + PAVE);
    if (n.type === 'T') {
      if (Math.abs(n.minor.dot(out)) > 0.9) return ROAD_W / 2;   // the side road meets the major's pavement
      return n.minor.dot(sv) > 0.9 ? ROAD_W / 2 : 0;           // leave a gap for the side road
    }
    return 0;
  };
  for (const r of ROADS) {
    const a = P(r.a), b = P(r.b), d = b.clone().sub(a).normalize(), L = a.distanceTo(b);
    const t0 = trimAt(r.a, d), t1 = trimAt(r.b, d.clone().negate());
    const A = a.clone().addScaledVector(d, t0), B = b.clone().addScaledVector(d, -t1);
    roadG.push(worldUV(strip(A, B, ROAD_W, 0.02)));
    // dashed centre line (UK: 4 m line, 5 m gap in towns); longer warning lines near junctions
    const n = leftOf(d);
    for (let s = t0 + 3; s < L - t1 - 3; s += 9) {
      const p0 = a.clone().addScaledVector(d, s), p1 = a.clone().addScaledVector(d, Math.min(s + 4, L - t1 - 3));
      lineG.push(strip(p0, p1, 0.1, 0.035));
    }
    // pavements both sides, broken where a side road joins
    for (const side of [1, -1]) {
      const off = side * (ROAD_W / 2 + PAVE / 2);
      const gaps = [];
      for (const [nm, node] of Object.entries(NODES)) {
        if (node.type !== 'T' || nm === r.a || nm === r.b) continue;
        const rel = node.p.clone().sub(a), along = rel.dot(d), lat = rel.dot(n);
        if (Math.abs(lat) < 0.5 && along > 0 && along < L && node.minor.dot(n) * side > 0.9) gaps.push(along);
      }
      const sv = n.clone().multiplyScalar(side);
      const s0 = paveTrim(r.a, r, d, sv);
      const s1 = L - paveTrim(r.b, r, d.clone().negate(), sv);
      const cuts = [s0, ...gaps.flatMap((g) => [g - ROAD_W / 2, g + ROAD_W / 2]), s1].sort((x, y) => x - y);
      for (let i = 0; i < cuts.length - 1; i += 2) {
        if (cuts[i + 1] - cuts[i] < 0.5) continue;
        const p0 = a.clone().addScaledVector(d, cuts[i]).addScaledVector(n, off), p1 = a.clone().addScaledVector(d, cuts[i + 1]).addScaledVector(n, off);
        const len = cuts[i + 1] - cuts[i], m = p0.clone().add(p1).multiplyScalar(0.5);
        paveG.push(worldUV(placed(new THREE.BoxGeometry(PAVE, 0.13, len), m.x, 0.065, m.y, Math.atan2(d.x, d.y))));
        const k0 = a.clone().addScaledVector(d, cuts[i]).addScaledVector(n, side * (ROAD_W / 2 + 0.08)), k1 = a.clone().addScaledVector(d, cuts[i + 1]).addScaledVector(n, side * (ROAD_W / 2 + 0.08));
        const km = k0.clone().add(k1).multiplyScalar(0.5);
        kerbG.push(placed(new THREE.BoxGeometry(0.16, 0.15, len), km.x, 0.075, km.y, Math.atan2(d.x, d.y)));
      }
    }
  }
  // junction squares, bends and turning heads
  for (const node of Object.values(NODES)) {
    if (node.type === 'end') {
      const c = new THREE.CircleGeometry(ROAD_W * 0.9, 24);
      c.rotateX(-Math.PI / 2);
      roadG.push(worldUV(placed(c, node.p.x, 0.018, node.p.y)));
    }
  }
  // roundabout: asphalt ring, island, pavement arcs between the arms
  {
    const ring = new THREE.RingGeometry(RB.island, RB.outer, 64);
    ring.rotateX(-Math.PI / 2);
    roadG.push(worldUV(placed(ring, RB.x, 0.021, RB.z)));
    const island = new THREE.Mesh(new THREE.CylinderGeometry(RB.island, RB.island + 0.3, 0.35, 48), pbr('leafy_grass', { repeat: [3, 3], color: 0xa6c48a }));
    island.position.set(RB.x, 0.17, RB.z);
    island.receiveShadow = true;
    scene.add(island);
    const islandKerb = new THREE.Mesh(new THREE.TorusGeometry(RB.island + 0.15, 0.12, 6, 48), kerbMat);
    islandKerb.rotation.x = -Math.PI / 2;
    islandKerb.position.set(RB.x, 0.12, RB.z);
    scene.add(islandKerb);
    colliders.box(RB.x, RB.z, RB.island * 1.4, RB.island * 1.4, 0, true);
    const gapA = Math.atan2(ROAD_W / 2 + 0.3, RB.outer);
    for (let q = 0; q < 4; q++) {
      const a0 = q * Math.PI / 2 + gapA, len = Math.PI / 2 - gapA * 2;
      const arc = new THREE.RingGeometry(RB.outer, RB.outer + PAVE, 24, 1, a0, len);
      arc.rotateX(-Math.PI / 2);
      paveG.push(worldUV(placed(arc, RB.x, 0.13, RB.z)));
    }
    // give-way dashes at each entry
    for (const a of [V(0, 1), V(1, 0), V(0, -1), V(-1, 0)]) {
      const inLeft = leftOf(a.clone().negate());
      for (let t = 0.3; t < ROAD_W / 2; t += 0.9) {
        const p = a.clone().multiplyScalar(RB.outer + 0.3).addScaledVector(inLeft, t);
        lineG.push(strip(p, p.clone().addScaledVector(inLeft, 0.5), 0.3, 0.036));
      }
    }
  }
  // give-way markings at T-junction mouths: double dashes + a triangle
  for (const node of Object.values(NODES)) {
    if (node.type !== 'T') continue;
    const m = node.minor, inLeft = leftOf(m.clone().negate());
    for (const back of [ROAD_W / 2 + 0.4, ROAD_W / 2 + 0.9]) {
      for (let t = 0.3; t < ROAD_W / 2; t += 0.9) {
        const p = node.p.clone().addScaledVector(m, back).addScaledVector(inLeft, t);
        lineG.push(strip(p, p.clone().addScaledVector(inLeft, 0.5), 0.2, 0.036));
      }
    }
    const tri = new THREE.Shape([new THREE.Vector2(-0.7, 0), new THREE.Vector2(0.7, 0), new THREE.Vector2(0, 2.6)]);
    const tg = new THREE.ShapeGeometry(tri);
    tg.rotateX(-Math.PI / 2);
    const tp = node.p.clone().addScaledVector(m, ROAD_W / 2 + 8).addScaledVector(inLeft, LANE);
    lineG.push(placed(tg, tp.x, 0.036, tp.y, Math.atan2(-m.x, -m.y))); // apex toward the approaching driver
  }
  // double yellow lines along the High Street kerbs (no parking near the junctions)
  for (const side of [1, -1]) for (const off of [0, 0.2]) {
    yellowG.push(strip(V(-290, side * (ROAD_W / 2 - 0.25 - off)), V(-210, side * (ROAD_W / 2 - 0.25 - off)), 0.1, 0.034));
  }

  // ---- zebra crossing + Belisha beacons ----
  for (let k = -3; k <= 3; k++) {
    const g = new THREE.PlaneGeometry(3, 0.5);
    g.rotateX(-Math.PI / 2);
    lineG.push(placed(g, ZEBRA.x, 0.036, k * 1.0));
  }
  // zig-zags (simplified: dashed white lines along the kerbs near the crossing)
  for (const side of [1, -1]) for (const dir of [-1, 1]) for (let i = 0; i < 6; i++) {
    const x0 = ZEBRA.x + dir * (3 + i * 1.6), z0 = side * (ROAD_W / 2 - 0.5);
    lineG.push(strip(V(x0, z0), V(x0 + dir * 0.8, z0 + side * (i % 2 ? 0.3 : -0.3)), 0.12, 0.036));
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 2 });
  const poleStripes = new THREE.MeshStandardMaterial({ map: canvas(16, 128, (ctx) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f5f5f5'; ctx.fillRect(0, i * 16, 16, 16); } }) });
  for (const [x, z] of [[ZEBRA.x - 2, -(ROAD_W / 2 + 0.9)], [ZEBRA.x + 2, ROAD_W / 2 + 0.9]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), poleStripes);
    pole.position.set(x, 1.5, z);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), beaconMat);
    globe.position.set(x, 3.15, z);
    scene.add(pole, globe);
  }
  tickers.push((t) => { beaconMat.emissiveIntensity = Math.sin(t * Math.PI * 1.2) > 0 ? 2.4 : 0.15; });

  // ---- puffin lights: stop lines + two signal heads ----
  for (const [sx, zSide] of [[LIGHTS.x - 4, -1], [LIGHTS.x + 4, 1]]) {
    lineG.push(strip(V(sx, 0.1 * zSide), V(sx, zSide * (ROAD_W / 2 - 0.1)), 0.3, 0.036));
  }
  lineG.push(strip(V(LIGHTS.x - 1.2, -ROAD_W / 2), V(LIGHTS.x - 1.2, ROAD_W / 2), 0.12, 0.036));
  lineG.push(strip(V(LIGHTS.x + 1.2, -ROAD_W / 2), V(LIGHTS.x + 1.2, ROAD_W / 2), 0.12, 0.036));
  const lamp = (c) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0 });
  const heads = [];
  const housing = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  for (const [x, z, face] of [[LIGHTS.x - 4.6, -(ROAD_W / 2 + 0.8), -Math.PI / 2], [LIGHTS.x + 4.6, ROAD_W / 2 + 0.8, Math.PI / 2]]) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), housing);
    pole.position.y = 1.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.0, 0.25), housing);
    box.position.y = 3.3;
    g.add(pole, box);
    const mats = { red: lamp(0xff2a1a), amber: lamp(0xffa21a), green: lamp(0x2aff7a) };
    [['red', 3.62], ['amber', 3.3], ['green', 2.98]].forEach(([k, y]) => {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), mats[k]);
      l.position.set(0, y, 0.13);
      g.add(l);
    });
    g.position.set(x, 0, z);
    g.rotation.y = face;
    scene.add(g);
    heads.push(mats);
  }
  const lights = { state: 'green', t: 0 };
  const CYCLE = [['green', 16], ['amber', 3], ['red', 9], ['redamber', 2]];
  let ci = 0;
  tickers.push((t) => {
    const dt = Math.min(0.1, Math.max(0, t - (lights.lastT ?? t)));
    lights.lastT = t;
    lights.t += dt;
    // puffin: the red holds while anyone is still on the crossing
    const holding = lights.state === 'red' && lp.state === 'crossing';
    if (lights.t > CYCLE[ci][1] && !holding) { lights.t = 0; ci = (ci + 1) % CYCLE.length; lights.state = CYCLE[ci][0]; }
    for (const m of heads) {
      m.red.emissiveIntensity = lights.state === 'red' || lights.state === 'redamber' ? 3 : 0;
      m.amber.emissiveIntensity = lights.state === 'amber' || lights.state === 'redamber' ? 3 : 0;
      m.green.emissiveIntensity = lights.state === 'green' ? 3 : 0;
    }
  });

  // ---- houses and shops ----
  const houseMats = [], shopMats = [];
  const doors = ['#1f3a5f', '#7a1f2b', '#2f5d3a', '#111111', '#e9e1cf', '#2b6f8a'];
  for (let i = 0; i < 6; i++) houseMats.push(new THREE.MeshStandardMaterial({ map: houseFront(BRICKS[i % BRICKS.length], doors[i]), roughness: 0.9 }));
  const SHOPS = [['Whitmore Bakery', '#3b2a1a', '#f3e6c8'], ['Post Office', '#c8102e'], ['Pharmacy', '#0f6b4f'], ['The Kings Arms', '#1d2b22', '#d8b25a'],
    ['Fish & Chips', '#1f4e8c'], ['Barbers', '#222222'], ['Café Rosa', '#7a1f2b'], ['Newsagent', '#2b4a6f'], ['Charity Shop', '#5a2a6a'], ['Estate Agents', '#0b0d12', '#e8c77a']];
  for (const [name, fascia, ink] of SHOPS) shopMats.push(new THREE.MeshStandardMaterial({ map: shopFront(pick(BRICKS), fascia, name, ink), roughness: 0.85 }));
  const brickMat = new THREE.MeshStandardMaterial({ map: brickTexture(BRICKS[0]), roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.8 });
  const wallMat = new THREE.MeshStandardMaterial({ map: brickTexture(BRICKS[2]), roughness: 0.95 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 1 });
  const bodyG = [], roofG = [], frontG = houseMats.map(() => []), shopG = shopMats.map(() => []), wallG = [], hedgeG = [];

  const HW = 5.4, HD = 9, EAVES = 6;
  function terrace(a, b, side, { shops = false, skip = [] } = {}) {
    const d = b.clone().sub(a).normalize(), L = a.distanceTo(b), n = leftOf(d).multiplyScalar(side);
    const set = shops ? ROAD_W / 2 + PAVE + 0.2 : ROAD_W / 2 + PAVE + 3.2;
    const rot = Math.atan2(-n.x, -n.y); // local +z (the front) faces the road
    let run = null;
    const flush = () => {
      if (!run) return;
      const mid = (run.s0 + run.s1) / 2, len = run.s1 - run.s0;
      const c = a.clone().addScaledVector(d, mid).addScaledVector(n, set + HD / 2);
      // one roof prism per run, ridge along the street
      const sh = new THREE.Shape([new THREE.Vector2(-HD / 2 - 0.3, 0), new THREE.Vector2(HD / 2 + 0.3, 0), new THREE.Vector2(0, 3.4)]);
      const rg = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
      rg.translate(0, 0, -len / 2);
      rg.rotateY(Math.PI / 2);
      roofG.push(placed(rg, c.x, EAVES, c.y, rot));
      colliders.box(c.x, c.y, Math.abs(d.x) > 0.5 ? len : HD, Math.abs(d.x) > 0.5 ? HD : len);
      run = null;
    };
    for (let s = 6; s + HW < L - 6; s += HW) {
      const mid = s + HW / 2;
      if (skip.some(([s0, s1]) => mid > s0 && mid < s1)) { flush(); continue; }
      if (!run) run = { s0: s, s1: s };
      run.s1 = s + HW;
      const c = a.clone().addScaledVector(d, mid).addScaledVector(n, set + HD / 2);
      bodyG.push(placed(boxUV(HW, EAVES, HD, 2.2), c.x, EAVES / 2, c.y, rot));
      const f = new THREE.PlaneGeometry(HW, EAVES);
      f.translate(0, EAVES / 2, HD / 2 + 0.02);
      const list = shops ? shopG[Math.floor(Math.random() * shopG.length)] : frontG[Math.floor(Math.random() * frontG.length)];
      list.push(placed(f, c.x, 0, c.y, rot));
      if (Math.random() < 0.5) {
        const ch = boxUV(0.7, 1.4, 1.2, 2.2);
        ch.translate(HW / 2 - 0.4, EAVES + 2.9, 0);
        bodyG.push(placed(ch, c.x, 0, c.y, rot));
      }
      if (!shops) {
        // front garden wall + hedge
        const w = boxUV(HW - 1.2, 0.7, 0.25, 2.2);
        w.translate(-0.6, 0.35, HD / 2 + 2.9);
        wallG.push(placed(w, c.x, 0, c.y, rot));
        if (Math.random() < 0.6) {
          const h = new THREE.BoxGeometry(HW - 1.4, 1.1, 0.7);
          h.translate(-0.6, 0.55, HD / 2 + 2.3);
          hedgeG.push(placed(h, c.x, 0, c.y, rot));
        }
      }
    }
    flush();
  }
  const J = 16; // keep this clear of buildings around every junction
  for (const r of ROADS) {
    const a = P(r.a), b = P(r.b), d = b.clone().sub(a).normalize(), L = a.distanceTo(b);
    const skip = [[-1, J], [L - J, L + 1]];
    if (NODES[r.a].type === 'rb') skip[0][1] = RB.outer + 12;
    if (NODES[r.b].type === 'rb') skip[1][0] = L - RB.outer - 12;
    for (const [nm, node] of Object.entries(NODES)) {
      if (nm === r.a || nm === r.b) continue;
      const rel = node.p.clone().sub(a), along = rel.dot(d);
      if (Math.abs(rel.dot(leftOf(d))) < 1 && along > 0 && along < L) skip.push([along - J, along + J]);
    }
    for (const f of [ZEBRA, LIGHTS]) {
      const rel = V(f.x, f.z).sub(a), along = rel.dot(d);
      if (Math.abs(rel.dot(leftOf(d))) < 1 && along > 0 && along < L) skip.push([along - 7, along + 7]);
    }
    const highSt = r.name === 'High Street';
    for (const side of [1, -1]) {
      const sk = [...skip];
      if (r.a === 'WEND' && leftOf(d).y * side > 0) sk.push([0, 70]); // the test centre car park (north side)
      const shops = highSt && (r.a === 'J1' || r.a === 'RB');
      terrace(a, b, side, { shops, skip: sk });
    }
  }
  const addMerged = (list, mat, { cast = true } = {}) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    scene.add(m);
  };
  addMerged(roadG, asphalt, { cast: false });
  addMerged(paveG, paving, { cast: false });
  addMerged(lineG, white, { cast: false });
  addMerged(yellowG, yellow, { cast: false });
  addMerged(kerbG, kerbMat, { cast: false });
  addMerged(bodyG, brickMat);
  addMerged(roofG, roofMat);
  addMerged(wallG, wallMat);
  addMerged(hedgeG, hedgeMat);
  frontG.forEach((l, i) => addMerged(l, houseMats[i], { cast: false }));
  shopG.forEach((l, i) => addMerged(l, shopMats[i], { cast: false }));

  // ---- the test centre ----
  const tc = new THREE.Mesh(boxUV(26, 4.2, 12, 2.2), new THREE.MeshStandardMaterial({ map: brickTexture(BRICKS[1]), roughness: 0.95 }));
  tc.position.set(-285, 2.1, 34);
  tc.castShadow = tc.receiveShadow = true;
  scene.add(tc);
  colliders.box(-285, 34, 26, 12);
  const tcSign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.4), new THREE.MeshStandardMaterial({ map: plateTex('Whitmore Driving Test Centre'), roughness: 0.6 }));
  tcSign.position.set(-285, 3.4, 27.95);
  tcSign.rotation.y = Math.PI;
  scene.add(tcSign);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), asphalt);
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(-280, 0.017, 16);
  scene.add(lot);
  const tcLabel = label('Driving Test Centre', { size: 1.1, sub: 'Whitmore' });
  tcLabel.position.set(-285, 10, 34);
  scene.add(tcLabel);

  // ---- street furniture: lamps, signs ----
  const lampSpots = [];
  for (const r of ROADS) {
    const a = P(r.a), b = P(r.b), d = b.clone().sub(a).normalize(), L = a.distanceTo(b), n = leftOf(d);
    for (let s = 20; s < L - 20; s += 34) {
      const p = a.clone().addScaledVector(d, s).addScaledVector(n, ROAD_W / 2 + PAVE - 0.4);
      lampSpots.push({ x: p.x, z: p.y, rot: Math.atan2(-n.x, -n.y), scale: 1 });
    }
  }
  scene.add(instanced('street_lamp_01', lampSpots, { chunk: 120, maxDist: 280 }));
  const signPole = new THREE.MeshStandardMaterial({ color: 0x8a8d91, metalness: 0.6, roughness: 0.4 });
  const sign = (tex, x, z, faceHeading, y = 2.3, size = 0.75) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, y, 6), signPole);
    pole.position.y = y / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    face.position.y = y + size / 2 - 0.1;
    face.position.z = 0.05;
    g.add(pole, face);
    g.position.set(x, 0, z);
    g.rotation.y = faceHeading;
    scene.add(g);
    return g;
  };
  const limitTex = { 20: roundel('20'), 30: roundel('30'), 40: roundel('40') };
  // a limit sign at the start of every road, facing traffic entering it (on their left)
  for (const r of ROADS) {
    for (const [from, to] of [[r.a, r.b], [r.b, r.a]]) {
      const a = P(from), b = P(to), d = b.clone().sub(a).normalize();
      if (NODES[from].type === 'end') continue;
      const back = NODES[from].type === 'rb' ? RB.outer + 6 : 12;
      const p = a.clone().addScaledVector(d, back).addScaledVector(leftOf(d), ROAD_W / 2 + 0.6);
      sign(limitTex[r.limit], p.x, p.y, Math.atan2(-d.x, -d.y));
    }
  }
  const gw = giveWayTex();
  for (const node of Object.values(NODES)) {
    if (node.type !== 'T') continue;
    const m = node.minor, p = node.p.clone().addScaledVector(m, ROAD_W / 2 + 2).addScaledVector(leftOf(m.clone().negate()), ROAD_W / 2 + 0.6);
    const s = sign(gw, p.x, p.y, Math.atan2(m.x, m.y), 2.2, 0.9);
    s.children[1].geometry = new THREE.PlaneGeometry(0.9, 0.9);
    s.children[1].material.alphaTest = 0.5;
  }
  // street name plates at junctions
  for (const [x, z, name, rot] of [[-207, 7, 'Church Lane', 0], [-7, 207, 'Park Road', Math.PI / 2], [7, -207, 'Riverside Road', 0], [207, -7, 'Mill Road', Math.PI], [-20, -8, 'High Street', 0], [8, 22, 'Station Road', Math.PI / 2]]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: plateTex(name), side: THREE.DoubleSide }));
    pl.position.set(x, 1.1, z);
    pl.rotation.y = rot;
    scene.add(pl);
  }

  // ---- English trees: back gardens, verges and the fields around town ----
  {
    const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 7);
    trunkG.translate(0, 1.6, 0);
    const blobs = [[0, 5.2, 0, 2.6], [1.3, 4.4, 0.5, 1.9], [-1.2, 4.6, -0.4, 2.0], [0.2, 6.4, -0.6, 1.7]].map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
    const crownG = mergeGeometries(blobs);
    const spots = [];
    let tries = 0;
    while (spots.length < 420 && tries++ < 6000) {
      const x = rnd(-460, 460), z = rnd(-360, 420);
      if (nearestRoad(x, z).dist < 24 || Math.hypot(x, z) < 30 || (x < -255 && z > 0 && z < 50)) continue;
      // keep clear of the terraces (they sit 6-19 m off the road)
      spots.push({ x, z, s: rnd(0.8, 1.35), r: rnd(0, 6.28) });
    }
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }), spots.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x4a6e34, roughness: 0.95, flatShading: true }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
    spots.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r);
      sc.setScalar(p.s);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, sc);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, c.setHSL(0.27 + rnd(-0.03, 0.04), 0.38, 0.26 + rnd(-0.05, 0.06)));
    });
    for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  }

  // ---- people: zebra and puffin crossers, pavement strollers ----
  const zebra = { busy: false, peds: [] };
  function crosser(x, phase) {
    const mesh = buildPedestrian(Math.floor(Math.random() * 8));
    scene.add(mesh);
    return { mesh, x, state: 'idle', t: phase, z: -(ROAD_W / 2 + 1.2), dir: 1 };
  }
  const zp = crosser(ZEBRA.x, 6);
  const lp = crosser(LIGHTS.x + 1, 0);
  zebra.peds.push(zp);
  const stepCrosser = (c, dt, canGo) => {
    c.t -= dt;
    if (c.state === 'idle' && c.t <= 0) { c.state = 'waiting'; c.t = 2.2; }
    else if (c.state === 'waiting' && c.t <= 0 && canGo()) c.state = 'crossing';
    else if (c.state === 'crossing') {
      c.z += c.dir * 1.35 * dt;
      if (Math.abs(c.z) > ROAD_W / 2 + 1.2) { c.z = Math.sign(c.z) * (ROAD_W / 2 + 1.2); c.dir *= -1; c.state = 'idle'; c.t = 14 + Math.random() * 14; }
    }
    c.mesh.position.set(c.x + (c.state === 'idle' ? 2.5 : 0), 0.13, c.z);
    c.mesh.rotation.y = c.dir > 0 ? 0 : Math.PI;
    c.mesh.userData.animate(c.state === 'crossing' ? 1.35 : 0.01, dt);
  };
  let lastT = 0;
  tickers.push((t) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    // people don't step onto the zebra when a car is right on top of it
    const P = world.player;
    stepCrosser(zp, dt, () => !(P && Math.abs(P.x - ZEBRA.x) < 14 && Math.abs(P.z - ZEBRA.z) < 6));
    stepCrosser(lp, dt, () => lights.state === 'red' && lights.t < 3);
    zebra.busy = zp.state !== 'idle';
  });

  const L = (a, b, off, count) => ({ curve: new THREE.LineCurve3(new THREE.Vector3(a.x, 0, a.y), new THREE.Vector3(b.x, 0, b.y)), closed: false, offset: off, count });
  const peds = [
    L(V(-290, 0), V(-30, 0), ROAD_W / 2 + PAVE / 2, 5), L(V(-290, 0), V(-30, 0), -(ROAD_W / 2 + PAVE / 2), 4),
    L(V(30, 0), V(290, 0), ROAD_W / 2 + PAVE / 2, 4), L(V(30, 0), V(290, 0), -(ROAD_W / 2 + PAVE / 2), 4),
    L(V(-200, 20), V(-200, 180), ROAD_W / 2 + PAVE / 2, 2), L(V(0, 30), V(0, 180), -(ROAD_W / 2 + PAVE / 2), 2),
  ];
  // two cars going round the roundabout, in the direction the rule of the road gives
  const sense = rbSense();
  const circle = [];
  for (let i = 0; i < 24; i++) { const th = (sense * i * Math.PI * 2) / 24; circle.push(new THREE.Vector3(Math.cos(th) * RB.lane, 0, Math.sin(th) * RB.lane)); }
  const cars = [{ curve: new THREE.CatmullRomCurve3(circle, true), closed: true, offset: 0, dir: 1, count: 2, speed: [6.5, 8] }];

  const pos = new THREE.Vector3();
  const world = {
    id: 'uk',
    name: 'WHITMORE',
    units: 'mph',
    scene, env, colliders,
    roads: ROADS.map((r) => ({ points: [new THREE.Vector3(P(r.a).x, 0, P(r.a).y), new THREE.Vector3(P(r.b).x, 0, P(r.b).y)], width: ROAD_W, closed: false }))
      .concat([{ points: circle, width: 4, closed: true }]),
    bounds: { minX: -320, maxX: 320, minZ: -230, maxZ: 280 },
    tick: (t) => tickers.forEach((f) => f(t)),
    life: { cars, peds },
    spawn: { x: -279, z: 12, heading: Math.PI },
    garage: [],
    learnerAt: { x: -275, z: -LANE, heading: Math.PI / 2 },
    lights, zebra, crossers: [zp, lp],
    rb: RB, rbSenseSign: sense,
    landmarks: [
      { x: -285, z: 34, color: '#e8c77a', name: 'Test centre' },
      { x: 0, z: 0, color: '#ffffff', name: 'Roundabout' },
      { x: 0, z: 255, color: '#35aee2', name: 'Station' },
    ],
    place(x, z) {
      pos.set(x, 0, z);
      if (x < -255 && z > 5) return 'Driving Test Centre';
      if (Math.hypot(x, z) < 20) return 'The Roundabout';
      return nearestRoad(x, z).road.name;
    },
    speedLimitAt,
    player: null, // { x, z } of you or your car, set by the game each frame
  };
  return world;
}
