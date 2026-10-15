import * as THREE from 'three';
import { makeKit, tryLabel } from './kit.js';

// The Kent Jet Centre at Maypole Airfield. The real field is a grass strip; ours gets a
// 1,000 m paved runway 18/36 laid along +z (the takeoff and landing cutscenes in main.js
// run along +z from runway.z0, so z0 is the NORTH end), a taxiway to an apron on the west,
// Richard's jet park, a small glass terminal with a canopy, a windsock, a fence and a
// four-bay car park.
//
// Local coordinates relative to the layout centre, 380 m NORTH of `origin` (the OSM aerodrome
// point; see ZS): runway centreline x = 0, z -500..500; apron x -205..-60; terminal and car
// park around (-120, 372..404); entrance gate at (-120, 430), i.e. origin + (-120, 50). Nothing taller than an edge light sits within 50 m west of the
// centreline: the cutscene camera flies there. The first jet's nose is at x -70.

const ZS = -380;
const RW = { w: 45, half: 500 };
const APRON = { x0: -205, x1: -60, z0: -100, z1: 340 };
const NOSE1 = -70, NOSE2 = -128, ROW_Z0 = -90, GAP = 6;
const TERM = { x: -120, z: 372, w: 30, d: 14, h: 6.3 };

// 7-segment strokes in a digit box u -3..3 (right), v 0..9 (ahead of the pilot)
const SEG = { a: [0, 8.5, 6, 1], g: [0, 4.5, 6, 1], d: [0, 0.5, 6, 1], f: [-2.5, 6.5, 1, 5], b: [2.5, 6.5, 1, 5], e: [-2.5, 2.5, 1, 5], c: [2.5, 2.5, 1, 5] };
const DIGITS = { 1: 'bc', 8: 'abcdefg', 3: 'abcdg', 6: 'acdefg' };

/**
 * buildAirfield({ scene, colliders, tickers, origin, JETS, STARTER_JETS, buildJet, ownedJets, materials })
 * -> { terminal, jetPark, runway, addJet(id), label, entrance, carPark, place(x, z), bounds }
 * materials: { pbr } (assets.js's pbr) for textures; omit for flat colours (node check).
 */
export function buildAirfield({ scene, colliders, tickers, origin, JETS, STARTER_JETS, buildJet, ownedJets = [], materials = {} }) {
  const A = origin;
  // Maypole village sits right at the aerodrome point's south end (Maypole Road crosses the
  // centreline about 240 m south of it, the Hicks Forstal Road junction 370 m), while the
  // land to the north is open fields: the whole layout is centred ZS north of the point.
  const CTR = { x: A.x, z: A.z + ZS };
  const g = new THREE.Group();
  g.position.set(CTR.x, 0, CTR.z);
  scene.add(g);
  tickers = tickers || [];
  const kit = makeKit({ group: g, colliders, origin: A, pbr: materials.pbr || null });
  const { std, tex, mat, B, C, plane, raw, solo, flush } = kit;
  const paint = (color) => std(color, 0.7, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  mat('grass', tex('leafy_grass', 0x8fb476), { k: 0.08, cast: false });
  mat('runway', tex('clean_asphalt', 0x515255), { k: 0.25, cast: false });
  mat('asphalt', tex('clean_asphalt', 0x6b6c6f), { k: 0.25, cast: false });
  mat('concrete', tex('concrete_floor_02', 0xbab8b3), { k: 0.15, cast: false });
  mat('paving', tex('rectangular_paving', 0xd3cec3), { k: 0.5, cast: false });
  mat('white', paint(0xf2f2ee), { cast: false });
  mat('yellow', paint(0xe8c23a), { cast: false });
  mat('slab', std(0xf4f2ee, 0.6));
  mat('stone', tex('white_sandstone_blocks_02', 0xe3dac8), { k: 0.5 });
  mat('steel', std(0x15171a, 0.35, 0.6));
  mat('galv', std(0xb6babf, 0.4, 0.8));
  mat('fascia', std(0x1c1e22, 0.5, 0.3));
  mat('glass', new THREE.MeshPhysicalMaterial({ color: 0xa9c3d1, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false }), { cast: false });
  mat('mesh', new THREE.MeshStandardMaterial({ color: 0x8e949a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }), { cast: false });
  mat('walnut', tex('dark_wood', 0x8d6a4c), { k: 0.6 });
  mat('seat', std(0x2a2d33, 0.9));
  mat('orange', std(0xff6a00, 0.8));

  // ---------- ground: mown grass, the runway, taxiway, apron ----------
  plane(350, 1040, -75, 0.005, -40, 'grass');
  plane(RW.w, RW.half * 2, 0, 0.03, 0, 'runway');
  plane(37.5, 23, -41.25, 0.025, 71.5, 'asphalt');                       // taxiway to the apron
  plane(APRON.x1 - APRON.x0, APRON.z1 - APRON.z0, (APRON.x0 + APRON.x1) / 2, 0.02, (APRON.z0 + APRON.z1) / 2, 'concrete');
  plane(40, 25, TERM.x, 0.025, 352.5, 'paving');                         // forecourt between apron and terminal
  plane(30, 16, TERM.x, 0.025, 396, 'asphalt');                           // car park
  plane(8, 64, -138, 0.028, 372, 'asphalt');                              // service road car park -> apron
  plane(8, 28, TERM.x, 0.028, 418, 'asphalt');                            // stub to the entrance gate

  // ---------- runway markings (TSRGD-free zone: ICAO style) ----------
  const z0 = -RW.half, z1 = RW.half;
  for (let k = 0; k < 17; k++) B(0.9, 0.02, 30, 0, 0.03, -420 + k * 50, 'white');           // centreline
  for (const s of [-1, 1]) B(0.9, 0.02, RW.half * 2, s * 21.5, 0.03, 0, 'white');           // edge lines
  for (const [zEnd, dir] of [[z0, 1], [z1, -1]]) {
    for (let k = 0; k < 4; k++) for (const s of [-1, 1]) B(1.8, 0.02, 30, s * (3 + k * 4), 0.03, zEnd + dir * 21, 'white'); // threshold keys
    for (const s of [-1, 1]) for (const x of [9, 12.6]) B(1.8, 0.02, 22.5, s * x, 0.03, zEnd + dir * 150, 'white');     // touchdown zone
  }
  // runway numbers: 18 at the north end (read facing south), 36 at the south end
  const digits = (text, P, uDir, vDir) => {
    [...text].forEach((ch, i) => {
      const u0 = (i - (text.length - 1) / 2) * 8;
      for (const s of DIGITS[ch]) {
        const [su, sv, w, h] = SEG[s];
        const u = u0 + su, v = sv;
        const x = P[0] + uDir[0] * u + vDir[0] * v, z = P[1] + uDir[1] * u + vDir[1] * v;
        const alongX = Math.abs(uDir[0]) > 0.5;
        B(alongX ? w : h, 0.02, alongX ? h : w, x, 0.03, z, 'white');
      }
    });
  };
  digits('18', [0, z0 + 50], [-1, 0], [0, 1]);
  digits('36', [0, z1 - 50], [1, 0], [0, -1]);
  // taxiway centreline and holding point, apron edge line
  B(37.5, 0.02, 0.15, -41.25, 0.035, 71.5, 'yellow');
  for (const x of [-30.5, -29.5]) B(0.15, 0.02, 23, x, 0.035, 71.5, 'yellow');
  B(0.15, 0.02, APRON.z1 - APRON.z0, APRON.x1 + 0.3, 0.035, (APRON.z0 + APRON.z1) / 2, 'yellow');
  // car park bays, nose to the terminal
  for (let k = 0; k <= 4; k++) B(0.12, 0.02, 5, -125.6 + k * 2.8, 0.035, 393.5, 'white');
  B(11.3, 0.02, 0.12, TERM.x, 0.035, 391, 'white');

  // ---------- edge and threshold lights: one instanced mesh, white edges, green thresholds ----------
  const spots = [];
  for (let k = 0; k <= 16; k++) for (const s of [-1, 1]) spots.push([s * 23.5, -480 + k * 60, 0xffffff]);
  for (const zEnd of [z0, z1]) for (let k = 0; k <= 8; k++) spots.push([-20 + k * 5, zEnd, 0x22e07a]);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  spots.forEach(([x, z, c], i) => {
    o.position.set(x, 0.3, z); o.updateMatrix();
    lights.setMatrixAt(i, o.matrix);
    lights.setColorAt(i, col.set(c));
  });
  g.add(lights);
  for (const [x, z] of spots) C(0.04, 0.05, 0.3, x, 0, z, 'galv', 6);

  // ---------- the terminal: a glass box on a stone plinth, roof slab, canopy to the car park ----------
  const T = TERM;
  B(T.w + 0.4, 0.3, T.d + 0.4, T.x, 0, T.z, 'stone');
  B(T.w, T.h - 0.3, 0.08, T.x, 0.3, T.z - T.d / 2, 'glass');
  B(T.w, T.h - 0.3, 0.08, T.x, 0.3, T.z + T.d / 2, 'glass');
  B(0.08, T.h - 0.3, T.d, T.x - T.w / 2, 0.3, T.z, 'glass');
  B(0.08, T.h - 0.3, T.d, T.x + T.w / 2, 0.3, T.z, 'glass');
  for (let i = 0; i <= 10; i++) for (const s of [-1, 1]) B(0.14, T.h - 0.3, 0.2, T.x - T.w / 2 + i * 3, 0.3, T.z + s * T.d / 2, 'steel');
  for (let i = 0; i <= 5; i++) for (const s of [-1, 1]) B(0.3, T.h, 0.3, T.x - 12.5 + i * 5, 0, T.z + s * (T.d / 2 - 0.5), 'steel');
  B(T.w + 2, 0.5, T.d + 2, T.x, T.h, T.z, 'slab');
  B(T.w + 2.2, 0.9, 0.3, T.x, T.h - 0.9, T.z + T.d / 2 + 1, 'fascia');
  B(T.w + 2.2, 0.9, 0.3, T.x, T.h - 0.9, T.z - T.d / 2 - 1, 'fascia');
  colliders.box(CTR.x + T.x, CTR.z + T.z, T.w + 0.4, T.d + 0.4);
  // canopy over the drop-off on the car park side
  B(24, 0.3, 6, T.x, 5.4, T.z + T.d / 2 + 4, 'slab');
  B(24.2, 0.6, 0.25, T.x, 4.8, T.z + T.d / 2 + 7, 'fascia');
  for (const x of [T.x - 10, T.x - 3.4, T.x + 3.4, T.x + 10]) { B(0.25, 5.4, 0.25, x, 0, T.z + T.d / 2 + 6.5, 'steel'); colliders.box(CTR.x + x, CTR.z + T.z + T.d / 2 + 6.5, 0.3, 0.3); }
  // inside: a desk and a row of seats, seen through the glass
  B(4, 1.0, 0.8, T.x, 0.3, T.z, 'walnut');
  for (let i = 0; i < 6; i++) B(0.55, 0.45, 0.55, T.x - 8 + i * 1.2, 0.3, T.z - 4, 'seat');
  // name block at the gate
  B(5, 1.4, 0.3, T.x + 8, 0, 424, 'slab');
  B(5.1, 0.3, 0.35, T.x + 8, 1.4, 424, 'fascia');

  // ---------- fence round the field, open at both runway ends and the gate ----------
  const fence = [];
  const line = (x0, z0f, x1, z1f) => fence.push([x0, z0f, x1, z1f]);
  line(-230, -540, -230, 430);
  line(45, -540, 45, 430);
  line(-230, -540, -60, -540);
  line(-230, 430, -127, 430);
  line(-113, 430, -60, 430);
  const posts = [];
  for (const [x0, zA, x1, zB] of fence) {
    const len = Math.hypot(x1 - x0, zB - zA), alongX = Math.abs(x1 - x0) > 0;
    const cx = (x0 + x1) / 2, cz = (zA + zB) / 2;
    B(alongX ? len : 0.04, 0.04, alongX ? 0.04 : len, cx, 1.85, cz, 'galv');
    B(alongX ? len : 0.04, 0.04, alongX ? 0.04 : len, cx, 1.0, cz, 'galv');
    B(alongX ? len : 0.02, 1.8, alongX ? 0.02 : len, cx, 0.1, cz, 'mesh');
    colliders.box(CTR.x + cx, CTR.z + cz, alongX ? len : 0.3, alongX ? 0.3 : len);
    for (let s = 0; s <= len; s += 10) posts.push([x0 + (alongX ? s : 0), zA + (alongX ? 0 : s)]);
  }
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), std(0xb6babf, 0.4, 0.8), posts.length);
  posts.forEach(([x, z], i) => { o.position.set(x, 0.95, z); o.updateMatrix(); postMesh.setMatrixAt(i, o.matrix); });
  postMesh.castShadow = true;
  g.add(postMesh);

  // ---------- windsock, well clear of the camera lane ----------
  const WS = { x: -56, z: -130 };
  C(0.06, 0.09, 6, WS.x, 0, WS.z, 'galv', 8);
  colliders.box(CTR.x + WS.x, CTR.z + WS.z, 0.4, 0.4);
  const sock = new THREE.Group();
  sock.position.set(WS.x, 5.8, WS.z);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 10, 1, true), std(0xff6a00, 0.8, 0, { side: THREE.DoubleSide }));
  cone.geometry.rotateZ(-Math.PI / 2);
  cone.position.x = 1.3;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 16), std(0xf4f2ee, 0.8));
  band.rotation.y = Math.PI / 2;
  band.position.x = 0.2;
  sock.add(cone, band);
  g.add(sock);

  // ---------- the jet park: STARTER_JETS in a row facing the runway, bought jets behind ----------
  const park = (id, noseX, cursor) => {
    const j = JETS[id];
    const x = noseX - j.L / 2, z = cursor + j.span / 2;
    const jet = buildJet(j);
    jet.position.set(CTR.x + x, 0, CTR.z + z);
    jet.rotation.y = Math.PI / 2; // nose +x, towards the runway
    scene.add(jet);
    colliders.box(CTR.x + x, CTR.z + z, j.L, j.R * 2 + 0.6); // fuselage only: walk under the wings
    const tag = tryLabel(`${j.maker} ${j.model}`, { size: 0.9, sub: j.note || j.range });
    if (tag) { tag.position.set(CTR.x + x, j.R * 2 + j.L * 0.2 + 4, CTR.z + z); scene.add(tag); }
    return cursor + j.span + GAP;
  };
  let row1 = ROW_Z0;
  for (const id of STARTER_JETS) row1 = park(id, NOSE1, row1);
  let row2 = ROW_Z0;
  const addJet = (id) => { if (JETS[id]) row2 = park(id, NOSE2, row2); };
  ownedJets.forEach(addJet);
  const parkRing = solo(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  parkRing.rotation.x = -Math.PI / 2;
  parkRing.position.set(-55, 0.2, -72);
  const termRing = solo(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c77a, emissive: 0xe8c77a, emissiveIntensity: 1.2 }), { cast: false });
  termRing.rotation.x = -Math.PI / 2;
  termRing.position.set(T.x, 0.2, 389);

  const meshes = flush();

  const sign = tryLabel('Kent Jet Centre', { size: 2.2, sub: 'Jets to Monaco, Dubai and Singapore' });
  if (sign) { sign.position.set(CTR.x + T.x, 12, CTR.z + T.z); scene.add(sign); }
  const parkSign = tryLabel("Richard's Jet Park", { size: 3, sub: 'Your private fleet' });
  if (parkSign) { parkSign.position.set(CTR.x - 100, 30, CTR.z - 80); scene.add(parkSign); }

  tickers.push((t) => {
    sock.rotation.y = 0.5 + Math.sin(t * 0.7) * 0.35 + Math.sin(t * 2.3) * 0.08;
    sock.rotation.z = -0.25 + Math.sin(t * 1.9) * 0.1;
    const s = 1 + Math.sin(t * 3) * 0.06;
    parkRing.scale.setScalar(s);
    termRing.scale.setScalar(s);
  });

  const L = (x, z) => [x - CTR.x, z - CTR.z];
  return {
    group: g,
    meshes,
    terminal: { x: CTR.x + T.x, z: CTR.z + 389, r: 7 },
    jetPark: { x: CTR.x - 55, z: CTR.z - 72, r: 7 },
    runway: { x: CTR.x, z0: CTR.z + z0, z1: CTR.z + z1 },
    addJet,
    label: sign,
    entrance: { x: CTR.x + T.x, z: CTR.z + 430 },
    carPark: [0, 1, 2, 3].map((k) => ({ x: CTR.x - 124.2 + k * 2.8, z: CTR.z + 393.5, heading: Math.PI })),
    bounds: { minX: CTR.x - 231, maxX: CTR.x + 46, minZ: CTR.z - 541, maxZ: CTR.z + 431 },
    /** 'Jet Park' on the apron (the daily goal looks for that exact string), else the field */
    place(x, z) {
      const [lx, lz] = L(x, z);
      if (Math.abs(lx) <= RW.w / 2 + 2 && Math.abs(lz) <= RW.half) return 'Runway 18/36';
      if (lx >= APRON.x0 && lx <= APRON.x1 && lz >= APRON.z0 && lz <= APRON.z1) return 'Jet Park';
      if (lx > -230 && lx < 45 && lz > -540 && lz < 430) return 'Kent Jet Centre';
      return null;
    },
  };
}
