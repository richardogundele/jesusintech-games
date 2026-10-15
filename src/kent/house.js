import * as THREE from 'three';
import { makeKit, tryLabel, canvasTex } from './kit.js';

// Richard's Kent home: a modern two-storey house on the Beltinge cliff top, Herne Bay.
// Glass to the sea on the north (-z), front door, double garage and a gravel motor court
// on the south (+z), hedges and gate piers to the road beyond.
//
// Local coordinates, relative to `origin` (x east, z south, y up):
//   shell x -13..12, z -7..7 (25 x 14 m). West wing (garage + gym) is single storey; the main
//   block (x -5..12) has the bedroom floor at y 3.3. Terrace z -16..-7, lawn to the cliff rail
//   at z -31, motor court z 8..34, drive z 34..driveEnd, gate at z 42.
//
// Upstairs walls sit exactly over ground-floor walls so the 2D colliders are shared; the stair
// is a ramp in floorY() for whoever lifts the player (main.js does not move y today).

// What the TV says when you watch the news. Short, the brand's own tone.
export const NEWS = [
  'Tonight: another mid-size firm hands its back office to JesusInTech Agents. The staff got their evenings back.',
  'Herne Bay man teaches a Lagos church to build with AI. Attendance up, excuses down.',
  'Three SPath Max members start sponsored roles this week. Recruiters reportedly confused.',
  'AIOS cohort ships its first automations. One student automated his own job and kept the salary.',
  'And the weather: bright over Herne Bay, scattered breakthroughs across Kent.',
];

const COFFEE = [
  'Flat white, two shots. Back to it.',
  'Kettle on. The sea is doing its thing out there.',
  'Espresso. Short, like a good meeting.',
];

// Show me / tell me style questions for the study. First answer is the right one.
export const HIGHWAY_CODE = [
  { title: 'Tell me', q: "Tell me how you'd check the power steering is working before starting a journey.", a: ['Gentle pressure on the wheel while starting the engine should give slight movement, and it should feel light once you move off.', 'Turn the wheel fully each way with the engine off; it should feel heavy.', 'Check the steering fluid is a bright green colour.'] },
  { title: 'Tell me', q: "Tell me how you'd know if there was a problem with your anti-lock braking system.", a: ['A warning light on the dashboard would stay on.', 'The brake pedal would feel lighter than usual.', 'The car would pull to the left under braking.'] },
  { title: 'Tell me', q: "Tell me how you'd check the handbrake is working.", a: ["Apply it fully: it shouldn't reach the end of its travel, and it should hold the car on a slope.", 'Pull it while driving at 20 mph and see if the car slows.', 'Press it with your foot until the warning light goes out.'] },
  { title: 'Tell me', q: "Tell me where the windscreen washer reservoir is and how you'd check its level.", a: ['Under the bonnet, the cap has a windscreen symbol. Check the level and top up with washer fluid.', 'Behind the number plate; top up with engine oil.', "Under the driver's seat; check that it's warm."] },
  { title: 'Show me', q: "Show me how you'd set the rear demister.", a: ['Press the rear demister button, the symbol is a rectangle with wavy arrows.', 'Turn the heater to cold and open the rear window.', 'Switch on the hazard lights.'] },
  { title: 'Show me', q: "Show me how you'd switch on the rear fog light.", a: ['Operate the fog light switch and check the warning light comes on; only use it when visibility is under 100 metres.', 'Flash the high beam three times.', 'Press the hazard button.'] },
  { title: 'Show me', q: "Show me how you'd clean the front windscreen.", a: ['Operate the front washer and wipers.', 'Open the window and reach round.', 'Turn on the air conditioning.'] },
  { title: 'Tell me', q: "Tell me how you'd check the direction indicators are working.", a: ['Switch on the hazard lights and walk round the car, or check each indicator in turn.', 'Sound the horn twice.', 'Look at the fuel gauge.'] },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * buildKentHouse({ scene, colliders, tickers, origin, interactions, hooks, materials, driveEnd })
 * hooks: { toast(text, ms), openPhone(tab), quiz(item), logWin(id), sfx(kind) }, all optional.
 * materials: { pbr } (assets.js's pbr) for real textures; omit for flat colours (node check).
 * driveEnd: local z where the drive stub ends (default 48); the road agent joins it there.
 */
export function buildKentHouse({ scene, colliders, tickers, origin, interactions, hooks = {}, materials = {}, driveEnd = 48 }) {
  const O = origin;
  const g = new THREE.Group();
  g.position.set(O.x, 0, O.z);
  scene.add(g);
  interactions = interactions || [];
  tickers = tickers || [];
  const kit = makeKit({ group: g, colliders, origin: O, pbr: materials.pbr || null });
  const { std, tex, mat, B, C, S, plane, raw, wallZ, wallX, solo, flush } = kit;
  const toast = (t, ms = 3200) => hooks.toast?.(t, ms);

  // ---------- palette: white render, travertine, oak, black steel, glass ----------
  mat('render', tex('painted_plaster_wall', 0xf1ede4), { k: 0.35 });
  mat('stone', tex('white_sandstone_blocks_02', 0xe3dac8), { k: 0.5 });
  mat('travertine', tex('marble_01', 0xe8dfcd, { envMapIntensity: 0.5 }), { k: 0.25, cast: false });
  mat('oak', tex('wood_floor_deck', 0xc9a26c), { k: 0.5 });
  mat('walnut', tex('dark_wood', 0x8d6a4c), { k: 0.6 });
  mat('concrete', tex('concrete_floor_02', 0xb9b6b0), { k: 0.4, cast: false });
  mat('paving', tex('rectangular_paving', 0xd6d0c4), { k: 0.5, cast: false });
  mat('gravel', tex('coast_sand_01', 0xb3ada2, { roughness: 1 }), { k: 0.6, cast: false });
  mat('asphalt', tex('clean_asphalt', 0x66676a), { k: 0.3, cast: false });
  mat('lawn', tex('leafy_grass', 0xa3c28a), { k: 0.14, cast: false });
  mat('white', std(0xf4f2ee, 0.6));
  mat('steel', std(0x15171a, 0.35, 0.6));
  mat('chrome', std(0xffffff, 0.08, 1));
  mat('glass', new THREE.MeshPhysicalMaterial({ color: 0xa9c3d1, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }), { cast: false });
  mat('tint', new THREE.MeshPhysicalMaterial({ color: 0x1a232b, roughness: 0.04, metalness: 0.5 }));
  mat('hedge', std(0x3b6b2d, 1));
  mat('leaf', std(0x4f8a3a, 1));
  mat('cream', std(0xe8dfd2, 0.9));
  mat('fabric', std(0x2a2d33, 0.95));
  mat('leather', std(0x2b1b14, 0.5));
  mat('rubber', std(0x2d2f33, 0.95), { cast: false });
  mat('led', new THREE.MeshBasicMaterial({ color: 0xffe6c0 }), { cast: false });
  mat('red', std(0xa8262b, 0.8));
  mat('navy', std(0x1f2f52, 0.8));
  mat('green', std(0x2f5d3a, 0.8));
  mat('paper', std(0xe9e2d2, 0.9));
  mat('water', new THREE.MeshPhysicalMaterial({ color: 0x3fb6c9, roughness: 0.05, clearcoat: 1, emissive: 0x0b4652, emissiveIntensity: 0.5 }), { cast: false });
  mat('charcoal', std(0x3a3b3e, 0.9));
  mat('gold', std(0xd0a94e, 0.22, 1));

  // ---------- grounds ----------
  plane(60, 73, 0, 0.012, 5.5, 'lawn');               // x -30..30, z -31..42
  plane(38, 26, 0, 0.02, 21, 'gravel');               // motor court x -19..19, z 8..34
  plane(7, driveEnd - 34, 0, 0.022, (34 + driveEnd) / 2, 'asphalt'); // drive to the road
  plane(25, 9, -0.5, 0.02, -11.5, 'paving');          // terrace x -13..12, z -16..-7
  // hedges round the plot, gate gap on the road side
  wallZ(42, -30, 30, 1.9, 'hedge', [[-5.1, 5.1, 9]], { t: 1.2 });
  wallX(-30, -31, 42, 1.9, 'hedge', [], { t: 1.2 });
  wallX(30, -31, 42, 1.9, 'hedge', [], { t: 1.2 });
  for (const s of [-1, 1]) {
    B(0.9, 2.2, 0.9, s * 4.6, 0, 42, 'stone', { collide: true });
    B(0.5, 0.2, 0.5, s * 4.6, 2.2, 42, 'led');
  }
  // cliff-top rail: steel posts, a glass panel, a top rail; nobody walks off the edge
  for (let x = -30; x <= 30; x += 2) B(0.08, 1.1, 0.08, x, 0, -31, 'steel');
  B(60, 1.0, 0.03, 0, 0.1, -31, 'glass');
  B(60, 0.06, 0.1, 0, 1.1, -31, 'steel');
  colliders.box(O.x, O.z - 31, 60.4, 0.4);
  // bay markings: six bays on the east of the court (bought cars), three on the west (starters)
  for (let k = 0; k <= 6; k++) B(5, 0.02, 0.12, 14.5, 0.03, 9.0 + k * 3.2, 'paper');
  for (let k = 0; k <= 3; k++) B(5, 0.02, 0.12, -15, 0.03, 9.2 + k * 3.6, 'paper');
  // the eyesight-check bay (nose to the road, plate towards the house)
  for (const x of [4.2, 6.8]) B(0.12, 0.02, 5.2, x, 0.03, 30.5, 'paper');
  B(2.72, 0.02, 0.12, 5.5, 0.03, 33.1, 'paper');

  // ---------- shell ----------
  const H = 3.0, F1 = 3.3, H1 = 2.8, ROOF = F1 + H1;
  plane(17, 14, 3.5, 0.02, 0, 'travertine');          // main block floor
  plane(8, 7, -9, 0.02, 3.5, 'concrete');             // garage
  plane(8, 7, -9, 0.02, -3.5, 'rubber');              // gym
  // south face: garage door opening (no collider: cars drive in) and the front door
  wallZ(7, -13, 12, H, 'render', [[-12.4, -5.6, 2.6], [-2.8, -1.2, 2.2]]);
  // north face is glass, sliding doors open to the terrace from the gym, lounge and kitchen
  wallZ(-7, -13, 12, H, 'glass', [[-10.5, -8.5, H], [-2.5, 0.5, H], [7, 9, H]]);
  wallZ(-7, -5, 12, H1, 'glass', [], { y0: F1, collide: false });
  for (let x = -12.5; x <= 11.5; x += 2.5) {
    if ([[-10.5, -8.5], [-2.5, 0.5], [7, 9]].some(([a, b]) => x > a && x < b)) continue;
    B(0.12, H, 0.2, x, 0, -7, 'steel');
    if (x > -5) B(0.12, H1, 0.2, x, F1, -7, 'steel');
  }
  B(17, 0.3, 0.2, 3.5, H, -7, 'steel');               // transom at the slab edge
  wallX(-13, -7, 7, H, 'render');
  wallX(12, -7, 7, H, 'render');
  wallX(12, -7, 7, H1, 'render', [], { y0: F1, collide: false });
  wallX(-5, -7, 7, H1, 'render', [], { y0: F1, collide: false }); // upstairs west wall, over the wing
  // partitions (x = const): wing | main, hall | study, study/lounge | office/kitchen
  wallX(-5, -7, 7, H, 'render', [[-5, -3.5]]);
  wallX(-1, 0, 7, H, 'render', [[2.6, 4.0]]);
  wallX(5, -7, 7, H, 'render', [[-5.5, -2.5], [2.6, 4.0]]);
  wallX(-1, 0, 7, H1, 'render', [[2.6, 4.0]], { y0: F1, collide: false });
  wallX(5, 0, 7, H1, 'render', [[2.6, 4.0]], { y0: F1, collide: false });
  // partitions (z = 0): south rooms | north rooms, with the doors
  wallZ(0, -13, 12, H, 'render', [[-8, -6.6], [-2.8, -1.4], [8.2, 9.6]]);
  wallZ(0, -5, 12, H1, 'render', [[-2.8, -1.4]], { y0: F1, collide: false });
  // first-floor slab with the stair well, oak upstairs, roofs
  B(17, 0.3, 8.3, 3.5, H, -2.85, 'white');            // z -7..1.3
  B(15.2, 0.3, 5.7, 4.4, H, 4.15, 'white');           // x -3.2..12, z 1.3..7
  plane(17, 8.3, 3.5, F1 + 0.01, -2.85, 'oak');
  plane(15.2, 5.7, 4.4, F1 + 0.01, 4.15, 'oak');
  B(17.6, 0.4, 14.6, 3.5, ROOF, 0, 'white');          // main roof
  B(17.8, 0.25, 14.8, 3.5, ROOF - 0.25, 0, 'steel');  // dark fascia under the roof edge
  B(8.4, 0.35, 14.4, -9, H, 0, 'white');              // wing roof
  for (const [w, d, x, z] of [[8.4, 0.3, -9, -7.05], [8.4, 0.3, -9, 7.05], [0.3, 14.4, -13.05, 0]]) B(w, 0.5, d, x, H + 0.35, z, 'render');
  // front door: oak pivot door swung open on its hinge at x -2.8, a canopy and a stone step
  const doorG = new THREE.BoxGeometry(1.5, 2.15, 0.08);
  doorG.translate(0.75, 1.075, 0);
  doorG.rotateY(1.15); // swung into the hall
  doorG.translate(-2.8, 0, 7.05);
  raw(doorG, 'oak');
  B(4.2, 0.22, 1.8, -2, 2.6, 7.9, 'white');
  B(0.12, 2.6, 0.12, -0.1, 0, 8.6, 'steel');
  B(3.2, 0.15, 1.2, -2, 0, 7.75, 'stone');
  // garage door: anthracite tilt-up on a top hinge; cosmetic, no collider
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-9, 2.6, 6.9);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(6.7, 2.55, 0.08), std(0x2c2e31, 0.5, 0.4));
  slab.position.y = -1.275;
  slab.castShadow = true;
  doorPivot.add(slab);
  for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.03, 0.1), std(0x1a1b1d, 0.6)); r.position.set(0, -0.3 - i * 0.62, 0.02); doorPivot.add(r); }
  g.add(doorPivot);
  let garageOpen = false;
  // address plate by the front door
  B(0.5, 0.18, 0.02, -4.3, 1.6, 7.22, 'gold');

  // ---------- hall and stair ----------
  B(0.4, 0.8, 1.2, -1.4, 0, 1.0, 'walnut', { collide: true });  // console table against the study wall
  B(0.03, 1.0, 1.4, -1.22, 1.1, 1.0, 'tint');                    // mirror
  S(0.22, -2.6, 2.6, 3.5, 'led');
  // straight flight along the garage wall, 17 steps up to the landing at z 1.3
  const STEPS = 17, RISE = F1 / STEPS, GOING = 5 / STEPS;
  for (let i = 0; i < STEPS; i++) B(1.1, 0.06, GOING + 0.02, -4.2, (i + 1) * RISE - 0.06, 6.3 - (i + 0.5) * GOING, 'oak');
  const pitch = Math.atan2(F1, 5);
  B(1.1, 0.22, 5.9, -4.2, F1 / 2 - 0.35, 3.8, 'white', { rx: pitch });   // stringer
  B(0.02, 1.0, 5.6, -3.5, F1 / 2 + 0.25, 3.8, 'glass', { rx: pitch });   // balustrade glass
  B(0.06, 0.05, 5.7, -3.5, F1 / 2 + 1.0, 3.8, 'oak', { rx: pitch });     // handrail
  // the two ramp colliders: the garage wall on the west (already there) and this on the open side
  colliders.box(O.x - 3.45, O.z + 4.05, 0.1, 5.5);
  B(0.02, 1.0, 5.7, -3.2, F1 + 0.1, 4.15, 'glass');                       // landing balustrade
  B(0.06, 0.05, 5.7, -3.2, F1 + 1.1, 4.15, 'oak');

  // ---------- lounge (sea view, sofa, TV) ----------
  B(0.45, 0.45, 2.6, -4.55, 0, -3.5, 'walnut', { collide: true });       // media unit under the TV
  const tv = solo(new THREE.BoxGeometry(0.04, 1.25, 2.2), new THREE.MeshBasicMaterial({ color: 0x0b1420 }), { cast: false });
  tv.position.set(-4.72, 1.55, -3.5);
  B(0.9, 0.42, 3.0, -1.3, 0, -3.5, 'cream', { collide: true });          // sofa seat
  B(0.35, 0.5, 3.0, -0.95, 0.42, -3.5, 'cream');                          // sofa back
  B(0.9, 0.5, 0.3, -1.3, 0.42, -2.1, 'cream');
  B(0.9, 0.5, 0.3, -1.3, 0.42, -4.9, 'cream');
  B(1.4, 0.42, 1.0, 2.2, 0, -3.5, 'cream', { collide: true });            // chaise by the glass
  B(0.6, 0.38, 1.1, -2.6, 0, -3.5, 'walnut', { collide: true });          // coffee table
  plane(4.4, 3.6, -1.8, 0.03, -3.5, 'fabric');                            // rug
  C(0.03, 0.03, 1.7, 3.6, 0, -5.8, 'steel', 6);
  S(0.25, 3.6, 1.75, -5.8, 'led');
  C(0.28, 0.24, 0.5, -4.3, 0, -6.3, 'stone', 12);
  S(0.5, -4.3, 0.95, -6.3, 'leaf');

  // ---------- kitchen (island) ----------
  B(3.2, 0.92, 1.2, 8.5, 0, -3.2, 'walnut', { collide: true });
  B(3.4, 0.05, 1.35, 8.5, 0.92, -3.2, 'travertine');
  for (let i = 0; i < 3; i++) C(0.18, 0.16, 0.7, 7.5 + i, 0, -2.2, 'steel', 10);
  B(0.62, 0.92, 5.5, 11.5, 0, -3.75, 'walnut', { collide: true });       // run along the east wall, z -6.5..-1
  B(0.7, 0.05, 5.6, 11.5, 0.92, -3.75, 'travertine');
  B(0.36, 0.8, 5.5, 11.6, 1.6, -3.75, 'walnut');                           // wall units
  B(0.3, 0.03, 5.5, 11.55, 1.58, -3.75, 'led');
  B(0.7, 2.3, 0.65, 11.45, 0, -0.6, 'steel', { collide: true });          // fridge column
  B(0.3, 0.38, 0.32, 11.5, 0.97, -4.6, 'chrome');                          // the coffee machine
  for (let i = 0; i < 3; i++) S(0.16, 7.6 + i * 0.9, 2.0, -3.2, 'led');

  // ---------- office (desk, laptop) ----------
  B(1.8, 0.04, 0.8, 8.5, 0.72, 3.0, 'walnut');
  for (const [dx, dz] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) B(0.05, 0.72, 0.05, 8.5 + dx, 0, 3.0 + dz, 'steel');
  colliders.box(O.x + 8.5, O.z + 3.0, 1.8, 0.8);
  B(0.34, 0.02, 0.24, 8.5, 0.76, 2.95, 'steel');                            // laptop base
  B(0.34, 0.22, 0.01, 8.5, 0.78, 2.83, 'tint', { rx: -0.3 });              // laptop screen
  B(0.5, 0.45, 0.5, 8.5, 0, 3.9, 'fabric');                                // chair seat
  B(0.5, 0.55, 0.08, 8.5, 0.45, 4.15, 'fabric');
  B(0.3, 2.2, 2.4, 11.65, 0, 3.5, 'walnut', { collide: true });           // shelving on the east wall
  for (let i = 0; i < 3; i++) B(0.28, 0.03, 2.3, 11.65, 0.6 + i * 0.6, 3.5, 'paper');
  B(1.2, 0.08, 0.8, 8.5, 0.03, 3.6, 'fabric');

  // ---------- gym (treadmill, rack of weights) ----------
  B(0.9, 0.18, 2.0, -10.5, 0, -4.5, 'charcoal');                           // treadmill deck
  B(0.6, 0.02, 1.6, -10.5, 0.18, -4.6, 'rubber');
  for (const s of [-1, 1]) B(0.06, 1.3, 0.06, -10.5 + s * 0.4, 0.18, -5.4, 'steel');
  B(0.9, 0.3, 0.2, -10.5, 1.35, -5.4, 'tint');                             // console, facing the sea
  colliders.box(O.x - 10.5, O.z - 4.9, 1.0, 1.2);
  B(1.8, 1.3, 0.5, -6.3, 0, -1.3, 'steel', { collide: true });            // dumbbell rack
  for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) {
    const x = -7.0 + i * 0.35, y = 0.4 + row * 0.6, z = -1.3;
    C(0.07, 0.07, 0.26, x, y, z, 'chrome', 8);
  }
  B(1.2, 0.45, 0.4, -8.3, 0, -1.5, 'leather', { collide: true });          // bench
  for (const s of [-1, 1]) B(0.1, 0.45, 0.4, -8.3 + s * 0.5, 0, -1.5, 'steel');
  C(0.14, 0.16, 0.26, -11.8, 0, -1.2, 'charcoal', 10);                     // kettlebell
  B(0.08, 0.9, 0.9, -12.75, 0.5, -1.0, 'tint');                            // mirror panel
  B(0.08, 0.9, 0.9, -12.75, 0.5, -4.0, 'tint');

  // ---------- study (bookshelf, the Highway Code on a stand) ----------
  B(5.2, 2.4, 0.35, 2, 0, 6.6, 'walnut', { collide: true });
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 0.25 + shelf * 0.45;
    B(5.0, 0.03, 0.33, 2, y, 6.6, 'paper');
    let x = -0.4;
    while (x < 4.3) {
      const w = 0.04 + Math.random() * 0.05, h = 0.22 + Math.random() * 0.14;
      B(w, h, 0.22, x + w / 2, y + 0.03, 6.58, pick(['red', 'navy', 'green', 'paper', 'walnut']));
      x += w + 0.01;
    }
  }
  B(0.9, 0.42, 0.9, 4.0, 0, 1.6, 'leather', { collide: true });            // reading chair
  B(0.9, 0.5, 0.2, 4.0, 0.42, 1.1, 'leather');
  C(0.03, 0.03, 1.5, 3.2, 0, 1.1, 'steel', 6);
  S(0.2, 3.2, 1.55, 1.1, 'led');
  // the book stand: oak post, sloped top, the Highway Code open on it
  C(0.06, 0.08, 1.05, 2, 0, 3.6, 'oak', 10);
  B(0.46, 0.03, 0.36, 2, 1.05, 3.6, 'oak', { rx: -0.45 });
  colliders.box(O.x + 2, O.z + 3.6, 0.5, 0.4);
  const coverTex = canvasTex(256, 352, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c8102e'; ctx.fillRect(0, 0, w, 96);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 26px Helvetica Neue, Arial'; ctx.textAlign = 'center';
    ctx.fillText('THE OFFICIAL', w / 2, 60);
    ctx.fillStyle = '#1b1b1b'; ctx.font = '800 44px Helvetica Neue, Arial';
    ctx.fillText('HIGHWAY', w / 2, 170); ctx.fillText('CODE', w / 2, 222);
    ctx.fillStyle = '#c8102e'; ctx.fillRect(40, 250, w - 80, 6);
  });
  const book = solo(new THREE.BoxGeometry(0.32, 0.025, 0.23), coverTex ? new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.85 }) : std(0xc8102e, 0.85));
  book.position.set(2, 1.11, 3.56);
  book.rotation.x = -0.45;

  // ---------- upstairs: bedroom with the sea view (scenery until the player can climb) ----------
  B(2.0, 0.55, 2.2, 3.5, F1, -4.0, 'cream');                               // bed
  B(2.1, 0.9, 0.12, 3.5, F1, -2.85, 'walnut');                              // headboard
  for (const s of [-1, 1]) B(0.5, 0.5, 0.5, 3.5 + s * 1.4, F1, -2.9, 'walnut');
  B(1.2, 0.45, 1.0, 9.5, F1, -5.5, 'cream');                                // chair by the glass
  B(0.6, 0.42, 0.6, -2.8, F1, -5.0, 'walnut');
  B(3.0, 2.2, 0.6, 2, F1, 6.4, 'walnut');                                   // dressing-room wardrobes
  B(2.2, 0.5, 1.6, 8.5, F1, 3.5, 'cream');                                  // guest bed
  // wet room block behind the bedroom (travertine box)
  B(3.0, H1, 2.6, 10.3, F1, -1.4, 'travertine');
  B(0.9, 0.55, 0.5, -3.6, F1, 0.6, 'walnut');                               // landing bench

  // ---------- garden: terrace furniture, hot tub, fire pit, planters ----------
  for (let i = 0; i < 3; i++) {
    B(0.8, 0.3, 2.0, 0.5 + i * 1.6, 0, -9.6, 'white');                       // loungers
    B(0.8, 0.45, 0.45, 0.5 + i * 1.6, 0.25, -8.85, 'white');
  }
  colliders.box(O.x + 2.1, O.z - 9.6, 4.0, 2.2);
  B(2.4, 0.74, 1.0, 6.5, 0, -11.5, 'walnut', { collide: true });            // outdoor table
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) B(0.45, 0.45, 0.45, 5.6 + i * 0.9, 0, -11.5 + s * 0.95, 'steel');
  C(1.35, 1.35, 0.9, 9.5, 0, -13.5, 'walnut', 28, { collide: true });       // hot tub
  C(1.15, 1.15, 0.05, 9.5, 0.86, -13.5, 'water', 28);
  for (let i = 0; i < 6; i++) {
    const x = -12 + i * 4.9;
    B(1.0, 0.6, 1.0, x, 0, -15.7, 'stone');
    S(0.55, x, 0.95, -15.7, 'leaf');
  }
  // fire pit: a concrete bowl in a ring of low seats, flames and a flickering light
  const FP = { x: -7, z: -12.5 };
  C(0.9, 0.75, 0.45, FP.x, 0, FP.z, 'charcoal', 24);
  C(0.7, 0.7, 0.1, FP.x, 0.45, FP.z, 'steel', 24);
  colliders.box(O.x + FP.x, O.z + FP.z, 1.9, 1.9);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    B(1.1, 0.42, 0.5, FP.x + Math.cos(a) * 2.1, 0, FP.z + Math.sin(a) * 2.1, 'cream', { ry: -a + Math.PI / 2 });
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 });
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 8), flameMat);
    const a = (i / 5) * Math.PI * 2;
    f.position.set(FP.x + Math.cos(a) * 0.3, 0.85, FP.z + Math.sin(a) * 0.3);
    g.add(f);
    flames.push(f);
  }
  const fire = new THREE.PointLight(0xff8a3a, 18, 12, 1.6);
  fire.position.set(FP.x, 1.3, FP.z);
  g.add(fire);

  // ---------- lights ----------
  const warm = (x, y, z, i, d) => { const l = new THREE.PointLight(0xffe0b0, i, d, 1.5); l.position.set(x, y, z); g.add(l); };
  warm(-2, 2.6, 3.5, 16, 12);   // hall and study
  warm(0, 2.7, -3.5, 22, 16);   // lounge
  warm(8.5, 2.7, 0, 20, 16);    // kitchen and office

  const meshes = flush();

  const sign = tryLabel("Richard's Kent Home", { size: 2, sub: 'Beltinge' });
  if (sign) { sign.position.set(O.x, 11, O.z); scene.add(sign); }

  // ---------- tickers: flames, garage door, the TV ----------
  let tvOn = 0, lastT = null;
  tickers.push((t) => {
    const dt = lastT == null ? 0 : Math.min(0.1, t - lastT);
    lastT = t;
    flames.forEach((f, i) => { f.scale.set(1, 0.8 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.7, 1); });
    fire.intensity = 16 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 2.5;
    const target = garageOpen ? Math.PI / 2 : 0;
    doorPivot.rotation.x += (target - doorPivot.rotation.x) * Math.min(1, dt * 2.2);
    if (tvOn > 0) { tvOn -= dt; tv.material.color.setHSL(0.58, 0.5, 0.22 + 0.12 * Math.sin(t * 7) * Math.sin(t * 3.1)); }
    else tv.material.color.set(0x0b1420);
  });

  // ---------- E prompts ----------
  const I = (lx, lz, r, lab, action, extra = {}) => interactions.push({ x: O.x + lx, z: O.z + lz, r, label: lab, action, ...extra });
  I(-9, 8.2, 3, () => (garageOpen ? 'Close the garage' : 'Open the garage'), () => {
    garageOpen = !garageOpen;
    hooks.sfx?.('tick');
  }, { car: true });
  let newsAt = Math.floor(Math.random() * NEWS.length);
  I(-1.6, -1.3, 1.8, () => 'Watch the news', () => {
    tvOn = 9;
    toast(NEWS[newsAt % NEWS.length], 5200);
    newsAt++;
  });
  I(8.5, -1.6, 1.6, () => 'Make a coffee', () => toast(pick(COFFEE), 2800));
  I(8.5, 4.4, 1.6, () => 'Open the laptop', () => {
    if (hooks.openPhone) hooks.openPhone('wins');
    else toast('Log your real wins on the phone (P).', 2800);
  });
  I(-10.5, -2.6, 1.8, () => 'Train for 30 minutes', () => {
    const logged = hooks.logWin ? hooks.logWin('train') : false;
    toast(logged ? 'Good session. Logged as a real win.' : 'Good session.', 2800);
  });
  I(2, 4.4, 1.6, () => 'Read the Highway Code', () => {
    const item = pick(HIGHWAY_CODE);
    if (!hooks.quiz) return toast(`${item.q} ${item.a[0]}`, 6000);
    Promise.resolve(hooks.quiz(item)).then((ok) => toast(ok ? 'Right. The examiner nods.' : `Not that one. ${item.a[0]}`, ok ? 2400 : 6000));
  });
  I(FP.x, FP.z + 2.8, 2.0, () => 'Sit by the fire', () => toast('Sea air, firelight, nothing urgent. A good place to think.', 4200));

  // ---------- api ----------
  const L = (x, z) => [x - O.x, z - O.z];
  const inShell = (lx, lz) => lx > -13 && lx < 12 && lz > -7 && lz < 7;
  const bays = (x, z0, n, pitch, heading) => Array.from({ length: n }, (_, k) => ({ x: O.x + x, z: O.z + z0 + k * pitch, heading }));
  return {
    group: g,
    meshes,
    interactions,
    indoors(x, z) { return inShell(...L(x, z)); },
    /** room names; pass y once the player can go upstairs */
    place(x, z, y = 0) {
      const [lx, lz] = L(x, z);
      if (inShell(lx, lz)) {
        if (y > 1.6 && lx > -5) {
          if (lz < 0) return 'Bedroom';
          return lx < -1 ? 'Landing' : lx < 5 ? 'Dressing Room' : 'Guest Room';
        }
        if (lx < -5) return lz > 0 ? 'Garage' : 'Gym';
        if (lz < 0) return lx < 5 ? 'Lounge' : 'Kitchen';
        return lx < -1 ? 'Hall' : lx < 5 ? 'Study' : 'Office';
      }
      if (lx > -30 && lx < 30 && lz > -31 && lz < 7) return 'Garden';
      if (lx > -19 && lx < 19 && lz >= 7 && lz < 34) return 'Motor Court';
      if (lx > -5 && lx < 5 && lz >= 34 && lz < driveEnd) return 'Driveway';
      if (lx > -31 && lx < 31 && lz > -32 && lz < 43) return "Richard's Kent Home";
      return null;
    },
    /** floor height under (x, z): 0, the stair ramp, or 3.3 upstairs (yPrev says which floor you came from) */
    floorY(x, z, yPrev = 0) {
      const [lx, lz] = L(x, z);
      if (lx > -4.9 && lx < -3.5 && lz > 1.0 && lz < 6.6) return F1 * THREE.MathUtils.clamp((6.3 - lz) / 5, 0, 1);
      if (yPrev > 1.6 && lx > -5 && lx < 12 && lz > -7 && lz < 7) return F1;
      return 0;
    },
    spawn: { x: O.x, z: O.z + 38, heading: Math.PI },
    garage: [
      { id: 'chiron', x: O.x - 10.6, z: O.z + 3.6, heading: Math.PI },
      { id: 'revuelto', x: O.x - 7.4, z: O.z + 3.6, heading: Math.PI },
      { id: 'f458', x: O.x - 15, z: O.z + 11, heading: -Math.PI / 2 },
      { id: 'cullinan', x: O.x - 15, z: O.z + 14.6, heading: -Math.PI / 2 },
      { id: 'g63', x: O.x - 15, z: O.z + 18.2, heading: -Math.PI / 2 },
    ],
    slots: bays(14.5, 10.6, 6, 3.2, Math.PI / 2),
    learnerAt: { x: O.x + 9.5, z: O.z + 29, heading: Math.PI },
    parkedAt: { x: O.x + 5.5, z: O.z + 30.5, heading: 0 },
    driveway: { x: O.x, z: O.z + 42 },
    driveEnd: { x: O.x, z: O.z + driveEnd },
    bounds: { minX: O.x - 31, maxX: O.x + 31, minZ: O.z - 32, maxZ: O.z + driveEnd },
    setGarage(open) { garageOpen = !!open; },
  };
}
