import * as THREE from 'three';
import { PAVE_W, KERB_W, Y_PAVE } from './markings.js';
import { netView, _internals } from './roads.js';

const { nodeInfo } = _internals;

// Live traffic for the Kent world: cars that drive real routes over the RoadNet and people on the
// pavements. A car spawns on a lane 150-700 m from the player (never in sight), takes net.route to
// a junction 1-3 km away and drives net.lanePath's lane-centre polyline: its position rides the
// polyline (eased up to half a metre towards the kerb to pass oncoming traffic in a squeeze) and it
// faces a pursuit point 1.5 m + 0.1 s ahead, so it can't leave its lane. Speed is the road's limit
// less 0-5 mph (capped by the class of road, as net.js routes), slowed for bends and rings and for
// whatever is ahead:
//   - the car in front, the player, anyone on the carriageway: anything whose body reaches into the
//     strip mine sweeps along my path (follow the leader),
//   - a car whose path crosses or pinches mine and gets there first (crossing traffic at junctions),
//   - lights (SignalSystem.isStop at the stop line), roundabout entries (a gap on the ring to the
//     right, the same arc test as LessonRun.rbConflict), give-way lines when something on the main
//     road is within 30 m (or 5.5 s) of the junction, and zebras with someone on or waiting at them.
//     The player's car counts at ring entries and give-way lines too (its speed and heading come
//     from the obstacle main.js passes each frame: { x, z, r, heading, L, W }), and is a box, not a
//     circle, when a car checks its path.
// Two cars that still end up nose to nose sort it out like drivers do: whoever can get past goes,
// else one backs off a couple of metres; a car nose to nose with the player's stopped car backs off
// too. No car moves deeper into another, except one caught in a gridlock (a ring of cars each waiting
// for the next) for 25 s: it squeezes past at walking pace for 5 s, which can show as two bodies
// overlapping for a moment. Cars past 900 m, at the end of their route or stuck (not waiting at a
// line) for 120 s are recycled once out of sight; one parked at the end of its route for 20 s goes
// even in sight. Pedestrians stroll the pavements of the streets round the player and sometimes cross
// at zebras and signal-controlled crossings (pressing the button, waiting for red).
//
// Same face as src/traffic.js's Traffic, so main.js treats them alike: update(dt, obstacle, camPos),
// collide(car) (boxes; lastHit.blame says whether the player drove into the car or it into them),
// `cars` and `peds`. A car: { pos, x, z, v, heading, r, radius, lane: { rb }, u, mesh,
// model, stunned }; lane.rb is the roundabout id once the car is past the give-way line onto the
// ring and u is then its ring angle as a fraction of a turn in circulation order (u = s, metres
// along its path, elsewhere). Meshes come from the bodies / buildCar / buildPedestrian the world
// passes in (models.js needs Vite, so node tests pass stand-ins). The per-frame code creates no objects; spawning
// (a route and its lane path) is the only heavy work and is rate limited.
//
// Conventions: x east, z south, a heading h travels along (sin h, cos h), left-hand traffic.

const MPH = 0.44704;
const TAU = Math.PI * 2;
// realistic cruising speeds by class (mph), as net.js routes with: a 60 mph lane is not a 60 mph road
const CRUISE = { trunk: 70, trunk_link: 50, primary: 50, primary_link: 40, secondary: 45, secondary_link: 40, tertiary: 35, unclassified: 28, residential: 22, living_street: 10, service: 10 };
const A_LAT = 2.6;        // m/s2 sideways in bends and on rings
const PLAN_BRAKE = 2.0;   // m/s2 to slow for bends and lower limits ahead
const STOP_BRAKE = 3.5;   // m/s2 to stop at a line
const FOLLOW_BRAKE = 5;   // m/s2 at most behind a car
const ACCEL = 2.4, MAX_BRAKE = 9;
const GAP = 1.6;          // bumper to bumper in a queue (m)
const NUDGE = 0.5;        // how far a driver eases left to pass oncoming traffic in a squeeze (m)
const SPAWN_MIN = 150, SPAWN_MAX = 700, DESPAWN = 900, UNSEEN = 120, HIDE = 420, STUCK = 120;
const PED_MIN = 60, PED_MAX = 350, PED_DROP = 450, PED_HIDE = 160;
const SIGNAL_CROSSINGS = new Set(['pelican', 'puffin', 'toucan', 'signals']);
const PAVE_OFF = KERB_W + PAVE_W / 2; // pavement centre beyond the carriageway edge
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// not Math.hypot: V8 allocates for its arguments on every call, and this runs hundreds of times a frame
const len = (x, z) => Math.sqrt(x * x + z * z);
const paveOk = (w) => !!w.pave && !w.rb && w.cls !== 'service' && !w.link && w.limit < 50;

// scratch frame for a point on a way (no allocation)
const F = { x: 0, z: 0, dx: 1, dz: 0, i: 0 };
function wayFrame(way, s, hint) {
  const cum = way.cum, pts = way.pts, last = cum.length - 2;
  let i = hint < 0 ? 0 : hint > last ? last : hint;
  while (i < last && cum[i + 1] < s) i++;
  while (i > 0 && cum[i] > s) i--;
  const a = pts[i], b = pts[i + 1], L = cum[i + 1] - cum[i];
  const t = L > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / L)) : 0;
  F.dx = L > 0 ? (b[0] - a[0]) / L : 1; F.dz = L > 0 ? (b[1] - a[1]) / L : 0;
  F.x = a[0] + (b[0] - a[0]) * t; F.z = a[1] + (b[1] - a[1]) * t; F.i = i;
  return F;
}

export class KentTraffic {
  /**
   * net: RoadNet, scene: THREE.Scene, signals: SignalSystem (or null), bodies: catalog TRAFFIC,
   * buildCar(spec) -> { root, wheels, wheelR, radius }, buildPedestrian(i) -> Object3D with
   * userData.animate(speed, dt). onEvent(kind, car, e) is a test hook ('line' when a car's front
   * crosses an event line, 'spawn' / 'despawn').
   */
  constructor({ net, scene, signals = null, maxCars = 45, maxPeds = 40, bodies = [], buildCar = null, buildPedestrian = null, rnd = Math.random, onEvent = null, groundY = null, gradeAt = null } = {}) {
    this.net = net; this.scene = scene; this.signals = signals;
    // on a region with hills the other traffic rides the slope too, or 45 cars hang in the air
    this.groundY = groundY; this.gradeAt = gradeAt;
    this.maxCars = maxCars; this.maxPeds = maxPeds;
    this.bodies = bodies; this.buildCar = buildCar; this.buildPedestrian = buildPedestrian;
    this.rnd = rnd; this.onEvent = onEvent;
    this.cars = []; this.peds = [];
    this.pool = []; this.pedPool = [];
    this.nextId = 1;
    this.P = { x: net.home?.x ?? 0, z: net.home?.z ?? 0 };
    this.spawnT = 0; this.pedT = 0;
    this.stats = { spawned: 0, despawned: 0, failed: 0, watchdog: 0, extended: 0, zebraCrossings: 0, signalCrossings: 0, zebraGaveUp: 0, signalGaveUp: 0, updateMs: 0, houseMs: 0 };
    // where a route may end: junctions off the rings (lanePath needs a ring's exit to draw it)
    this.destNodes = [...net.nodes.values()].filter((n) => n.kind === 'junction' && !n.rb && n.ways.some((r) => !r.way.rb && r.way.cls !== 'service'));
    // zebras and signal-controlled crossings, by the key lanePath names them with and by way
    this.crossings = new Map(); this.crossByWay = new Map();
    for (const c of net.data.crossings || []) {
      const zebra = c.type === 'zebra';
      if (!zebra && !SIGNAL_CROSSINGS.has(c.type)) continue;
      const way = net.ways.get(c.way); if (!way || way.rb) continue;
      const key = String(c.node || Math.round(c.x) + ':' + Math.round(c.z));
      const rec = { key, zebra, group: zebra ? null : `x-${key}`, x: c.x, z: c.z, way, s: c.s, busy: 0 };
      this.crossings.set(key, rec);
      let a = this.crossByWay.get(way.id); if (!a) this.crossByWay.set(way.id, (a = [])); a.push(rec);
    }
    this.touched = []; // crossings someone was at this frame
    this.me = { x: null, z: null, fx: 0, fz: 1, v: 0 }; // the player's car, for the give-way rules
    this.ext = 0;      // scratch: #onPath's along-path half-extent of what it found
    this.view = netView(net); // roads.js's junction geometry (where it paints the stop lines)
    this.cache = { kx: NaN, kz: NaN, cars: [], carCum: null, peds: [], pedCum: null };
    this.boxes = [...net.ways.values()].map((way) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of way.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
      return { way, x0, z0, x1, z1 };
    });
  }

  // ---------- the frame ----------
  /** obstacle: { x, z, r } for the player (on foot or in a car) or null; camPos: where the camera is */
  update(dt, obstacle, camPos) {
    const t0 = now();
    const P = obstacle || camPos;
    if (P) { this.P.x = P.x; this.P.z = P.z; }
    // the player's car as the give-way rules see it: where it is going and how fast (from the last frame)
    const me = this.me;
    if (obstacle && dt > 0 && me.x != null) {
      const vx = (obstacle.x - me.x) / dt, vz = (obstacle.z - me.z) / dt, v = len(vx, vz);
      me.v += (v - me.v) * Math.min(1, dt * 10);
      if (v > 0.3) { me.fx = vx / v; me.fz = vz / v; }
    } else if (!obstacle) me.v = 0;
    me.x = obstacle ? obstacle.x : null; me.z = obstacle ? obstacle.z : null;
    if (obstacle?.L) { me.L = obstacle.L; me.W = obstacle.W; me.hx = Math.sin(obstacle.heading); me.hz = Math.cos(obstacle.heading); }
    if (dt > 0) {
      this.#peds(dt);
      for (let i = 0; i < this.cars.length; i++) this.cars[i].want = this.#plan(this.cars[i], obstacle);
      for (let i = 0; i < this.cars.length; i++) this.#move(this.cars[i], dt);
    }
    this.#meshes(dt, camPos || this.P);
    const t1 = now();
    this.stats.updateMs = t1 - t0;
    if (dt > 0) this.#housekeep(dt);
    this.stats.houseMs = now() - t1;
  }

  /** is anyone on, or waiting at, this crossing? (a node id or the crossing key) */
  crossingBusy(node) { const r = this.crossings.get(String(node)); return !!r && r.busy > 0; }

  /**
   * Bump the player's car out of any traffic car and stop that car briefly. Returns true on impact.
   * Boxes, not circles: two cars passing in neighbouring lanes 2.7 m apart are not touching.
   */
  collide(car) {
    let hit = false;
    this.lastHit = null; // { blame: 'player' | 'other' }: who drove into whom, for the driving lessons
    const L = car.model.length ?? 4.4, W = car.model.width ?? 1.8, fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of this.cars) {
      if (!c.mesh || !c.mesh.visible || c.ghost > 0) continue; // a car squeezing out of a gridlock passes through
      const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
      if (dx * dx + dz * dz > 49) continue;
      // separating axes of the two boxes: the least overlap and the axis it's on
      let depth = Infinity, ax = 0, az = 0;
      for (let a = 0; a < 4; a++) {
        const ux = a === 0 ? fx : a === 1 ? fz : a === 2 ? c.fx : c.fz, uz = a === 0 ? fz : a === 1 ? -fx : a === 2 ? c.fz : -c.fx;
        const ra = (L / 2) * Math.abs(fx * ux + fz * uz) + (W / 2) * Math.abs(fz * ux - fx * uz);
        const rb = (c.L / 2) * Math.abs(c.fx * ux + c.fz * uz) + (c.W / 2) * Math.abs(c.fz * ux - c.fx * uz);
        const o = ra + rb - Math.abs(dx * ux + dz * uz);
        if (o <= 0) { depth = 0; break; }
        if (o < depth) { depth = o; const sg = dx * ux + dz * uz >= 0 ? 1 : -1; ax = ux * sg; az = uz * sg; }
      }
      if (depth <= 0) continue;
      if (this.#layerAt(car.pos.x, car.pos.z, fx, fz) !== this.#layerAt(c.x, c.z, c.fx, c.fz)) continue; // one of us is on a bridge over the other
      // who drove into whom: the player, if it was moving and ran into something in front of it, or
      // closed on it faster than it closed on the player; a faster car coming from beside or behind
      // (an overtaker cutting in, a merge) or anything hitting a car standing still is the other driver
      const d = Math.hypot(dx, dz) || 1, ux = -dx / d, uz = -dz / d; // from the player to the traffic car
      const mine = car.vel.x * ux + car.vel.y * uz, theirs = -c.v * (c.fx * ux + c.fz * uz), ahead = -(dx * fx + dz * fz);
      const vMe = Math.hypot(car.vel.x, car.vel.y);
      const player = vMe > 0.3 && (ahead > L / 2 || c.v < vMe + 1) && mine > 0.3 && mine >= theirs - 0.5;
      if (!this.lastHit || this.lastHit.blame !== 'player') this.lastHit = { blame: player ? 'player' : 'other', id: c.id };
      car.pos.x += ax * depth;
      car.pos.z += az * depth;
      const into = car.vel.x * ax + car.vel.y * az;
      if (into < 0) { car.vel.x -= ax * into * 1.3; car.vel.y -= az * into * 1.3; car.vel.multiplyScalar(0.7); }
      c.v = 0;
      c.stun = 2.5;
      hit = true;
    }
    return hit;
  }

  // ---------- cars: what speed do I want? ----------
  #plan(A, obstacle) {
    const v = A.v, s = A.s, n = A.n;
    let want = Math.min(A.vcap[A.idx], A.vcap[Math.min(n - 1, A.idx + 1)]);
    const look = Math.min(130, 18 + (v * v) / 6 + A.L);
    const front = s + A.L / 2;
    let freeD = Infinity, held = false, blockId = 0, nudge = 0, firstGroup = null;
    A.minorNode = 0;
    // the route's lines: lights, ring entries, give-ways, zebras
    for (let k = A.evI; k < A.ev.length; k++) {
      const e = A.ev[k];
      if (e.s > s + look) break;
      const d = e.s - front;
      let stop = false;
      switch (e.kind) {
        case 'lights': {
          if (!this.signals) break;
          // one junction, one decision: only the first stop line of a group counts (OSM splits big
          // junctions over several signal nodes, each with a line for the same lights)
          if (A.lastGroup === e.group && e.s - A.lastGroupS < 90) break; // already through its first line
          if (e.group === firstGroup) break;
          firstGroup = e.group;
          if (e.go) break; // committed on amber
          if (!this.signals.isStop(e.group, e.yaw, d, v)) { // green, or amber and too close to stop: go
            if (this.signals.stateFor(e.group, e.yaw) === 'amber') e.go = true; // and keep going
            break;
          }
          if ((v * v) / 16 > d + 0.5 && this.signals.stateFor(e.group, e.yaw) === 'red') break; // already at the line when it went red
          stop = true;
          break;
        }
        case 'rb': {
          want = Math.min(want, Math.sqrt(36 + 5 * Math.max(0, d))); // about 13 mph at the line
          if (d < 30) {
            A.minorNode = e.node;
            if (!e.go) { if (this.#ringBusy(A, e)) stop = true; else if (d < 1.5 && v > 1) e.go = true; }
          }
          break;
        }
        case 'emerge': case 'cross': case 'mini': {
          if (e.signalled) break; // the lights decide
          want = Math.min(want, Math.sqrt(16 + 4 * Math.max(0, d))); // creep up to the line
          if (d < 30) {
            A.minorNode = e.node;
            if (!e.go) { if (this.#majorBusy(A, e, e.kind === 'mini' ? 15 : 30)) stop = true; else if (d < 1 && v > 0.5) e.go = true; }
          }
          break;
        }
        case 'right': { // wait in the junction for a gap in the oncoming traffic (Highway Code 180)
          if (e.signalled) break;
          if (d < 25) {
            want = Math.min(want, Math.sqrt(25 + 4 * Math.max(0, d)));
            A.minorNode = e.node;
            if (!e.go) { if (this.#majorBusy(A, e, 30, e.yaw)) stop = true; else if (d < 1 && v > 0.5) e.go = true; }
          }
          break;
        }
        case 'zebra':
          if (e.rec && e.rec.busy > 0 && (v * v) / 12 < d + 0.5) stop = true;
          break;
      }
      if (stop) {
        want = Math.min(want, Math.sqrt(2 * STOP_BRAKE * Math.max(0, d - 0.3)));
        held = true;
        if (d < freeD) freeD = d;
      }
    }
    // other cars: on my path ahead (follow), or crossing it ahead and getting there first (yield).
    // A car caught in a ring of cars all waiting for each other for 25 s (a gridlock the rules
    // above can't untie) squeezes past for a few seconds: in sight, a jam that never clears is worse.
    const cars = this.cars, reach = (look + 6) * (look + 6);
    if (A.ghost <= 0 && A.stopT > 25 && !A.held && A.blockId > 0 && this.#gridlocked(A)) { A.ghost = 5; this.stats.squeezed = (this.stats.squeezed || 0) + 1; }
    for (let b = 0; b < cars.length && !(A.ghost > 0); b++) {
      const B = cars[b]; if (B === A) continue;
      const dx = B.x - A.x, dz = B.z - A.z, d2 = dx * dx + dz * dz;
      if (d2 > reach) continue;
      if (dx * A.fx + dz * A.fz < -3) continue; // behind me: it's their job to look
      const cosR = A.fx * B.fx + A.fz * B.fz;
      // oncoming and close on my right (a narrow road, a bend): ease over towards the kerb to pass
      if (cosR < -0.5 && d2 < 196) {
        const lat = dx * A.fz - dz * A.fx, room = (A.W + B.W) / 2 + 0.9; // lat > 0: on my left
        if (lat < 0 && -lat < room) nudge = Math.max(nudge, Math.min(NUDGE, room + lat));
      }
      // in my way if its body reaches into the strip my body sweeps along my path (a car alongside
      // in the next lane is not)
      const chord = Math.sqrt(d2);
      const arc = this.#onPath(A, B.x, B.z, B.fx, B.fz, B.L / 2, B.W / 2, 0.15, chord, s + look + 3);
      if (arc >= 0) {
        // two cars each waiting for the other (a squeeze on a bend, a turn across a junction mouth):
        // whoever can actually get past the other's body without touching it goes; both can, lower id
        if (B.blockId === A.id && A.blockId === B.id && v < 0.3 && B.v < 0.3 && A.stopT > 1.5) {
          if (this.#clearPast(A, B) && (A.id < B.id || !this.#clearPast(B, A))) continue;
          // neither can: after a few seconds the higher id backs off a couple of metres to let the other by
          // (or the lower id, if the other has someone right behind it)
          if (A.stopT > 4 && (A.id > B.id || B.noRoom) && !A.noRoom && A.backUp <= 0 && !this.#clearPast(B, A)) A.backUp = 2.5;
        }
        const g = arc - s - A.L / 2 - this.ext - GAP;
        const was = want;
        want = follow(want, g, Math.max(0, B.v * cosR), v);
        if (want < was) blockId = B.id;
        if (g < freeD) freeD = g;
        continue;
      }
      if (chord < 70) {
        const dA = this.#yieldTo(A, B, look);
        if (dA >= 0) {
          const g = dA - A.L / 2 - 2.5, was = want;
          want = Math.min(want, Math.sqrt(2 * FOLLOW_BRAKE * Math.max(0, g)));
          if (want < was) blockId = B.id;
          if (g < freeD) freeD = g;
        }
      }
    }
    // the player, and anyone walking on the carriageway
    if (obstacle && !(A.ghost > 0)) {
      const dx = obstacle.x - A.x, dz = obstacle.z - A.z, d2 = dx * dx + dz * dz;
      if (d2 < reach) {
        // the player's car as its box when main.js says which way it faces (a circle is too fat side-on)
        const box = obstacle.heading != null && obstacle.L, ofx = box ? Math.sin(obstacle.heading) : 1, ofz = box ? Math.cos(obstacle.heading) : 0;
        // oncoming and on my right, close: ease over to pass it, as with another car (and squeeze by with less room)
        const oncoming = box && A.fx * ofx + A.fz * ofz < -0.5;
        if (oncoming && d2 < 196) {
          const lat = dx * A.fz - dz * A.fx, room = (A.W + obstacle.W) / 2 + 0.9;
          if (lat < 0 && -lat < room) nudge = Math.max(nudge, Math.min(NUDGE, room + lat));
        }
        const arc = this.#onPath(A, obstacle.x, obstacle.z, ofx, ofz, box ? obstacle.L / 2 : obstacle.r, box ? obstacle.W / 2 : obstacle.r, oncoming ? 0.1 : 0.4, Math.sqrt(d2), s + look + 3);
        if (arc >= 0) {
          const g = arc - s - A.L / 2 - (box ? this.ext : obstacle.r) - GAP; want = follow(want, g, 0, v); if (g < freeD) freeD = g;
          // nose to nose with the player's stopped car (it's pulling out, or we've met in a narrow
          // place): after a few seconds back off a couple of metres to give it room, as a driver would
          const me = this.me;
          if (v < 0.3 && A.stopT > 4 && me.v < 0.3 && obstacle.heading != null && A.fx * Math.sin(obstacle.heading) + A.fz * Math.cos(obstacle.heading) < -0.5 && g < 8 && A.backUp <= 0 && !A.noRoom) A.backUp = 2.5;
          // and if neither of us can move for 25 s (someone behind each of us), squeeze past like a gridlock
          // (not when following it: a queue behind the player at a red light is just a queue)
          if (v < 0.3 && A.stopT > 25 && me.v < 0.3 && !A.held && g < 8 && obstacle.heading != null && A.fx * Math.sin(obstacle.heading) + A.fz * Math.cos(obstacle.heading) < 0.5) { A.ghost = 5; this.stats.squeezed = (this.stats.squeezed || 0) + 1; }
        }
      }
    }
    for (let p = 0; p < this.peds.length; p++) {
      const q = this.peds[p]; if (!q.inRoad) continue;
      const dx = q.x - A.x, dz = q.z - A.z, d2 = dx * dx + dz * dz;
      if (d2 > reach) continue;
      const arc = this.#onPath(A, q.x, q.z, 1, 0, 0.4, 0.4, 0.4, Math.sqrt(d2), s + look + 3);
      if (arc >= 0) { const g = arc - s - A.L / 2 - 0.4 - 1.2; want = follow(want, g, 0, v); if (g < freeD) freeD = g; }
    }
    if (A.stun > 0) want = 0;
    if (A.ghost > 0) want = Math.min(want, 3); // squeezing past: walking pace
    A.held = held; A.freeD = freeD; A.blockId = blockId; A.nudgeT = nudge;
    return want;
  }

  /** position and heading from s: on the polyline, facing a pursuit point just ahead, eased kerbwards */
  #pose(A, dt) {
    const n = A.n, ps = A.ps, px = A.px, pz = A.pz, i = A.idx;
    const L = ps[i + 1] - ps[i], t = L > 0 ? Math.min(1, (A.s - ps[i]) / L) : 0;
    A.x = px[i] + (px[i + 1] - px[i]) * t; A.z = pz[i] + (pz[i + 1] - pz[i]) * t;
    // the pursuit point is close (1.5 m + 0.1 s): the body follows the bend instead of snapping round
    // at the points, and a longer look would swing the nose across the next lane on tight bends
    const target = A.s + 1.5 + 0.1 * A.v;
    let j = Math.max(A.aim, i + 1);
    while (j < n - 1 && ps[j] < target) j++;
    A.aim = j;
    const hx = px[j] - A.x, hz = pz[j] - A.z;
    if (hx * hx + hz * hz > 0.04) { A.heading = Math.atan2(hx, hz); A.fx = Math.sin(A.heading); A.fz = Math.cos(A.heading); }
    // the sideways ease towards the kerb, at a walking pace, off the lane centre to the left
    const dn = A.nudgeT - A.nudge, rate = 0.8 * dt;
    A.nudge += dn > rate ? rate : dn < -rate ? -rate : dn;
    if (A.nudge) { A.x += A.fz * A.nudge; A.z -= A.fx * A.nudge; }
  }
  /** does A's new box overlap some car more than its old box (at ox, oz facing ofx, ofz) did? Its id, else 0 (any: any overlap at all) */
  #worse(A, ox, oz, ofx, ofz, any = false) {
    const cars = this.cars;
    for (let b = 0; b < cars.length; b++) {
      const B = cars[b];
      if (B === A || Math.abs(B.x - A.x) > 7 || Math.abs(B.z - A.z) > 7) continue;
      const next = boxDepth(A.x, A.z, A.fx, A.fz, A.L, A.W, B);
      if (next > 0 && (any || next > boxDepth(ox, oz, ofx, ofz, A.L, A.W, B) + 1e-4)) return B.id;
    }
    return 0;
  }
  /** is A's box touching the player's car? */
  #overPlayer(A) {
    const me = this.me;
    if (me.x == null || !me.L || Math.abs(me.x - A.x) > 7 || Math.abs(me.z - A.z) > 7) return false;
    return boxDepth(A.x, A.z, A.fx, A.fz, A.L, A.W, { x: me.x, z: me.z, fx: me.hx, fz: me.hz, L: me.L, W: me.W }) > 0;
  }
  /** can A drive the next 10 m of its path without its box touching B's box where B stands? */
  #clearPast(A, B) {
    const ps = A.ps, px = A.px, pz = A.pz, n = A.n;
    let i = A.idx;
    for (let d = 0.5; d <= 10; d += 0.75) {
      const s = A.s + d;
      while (i < n - 2 && ps[i + 1] <= s) i++;
      if (s > ps[n - 1]) break;
      const t = Math.min(1, (s - ps[i]) / ((ps[i + 1] - ps[i]) || 1));
      const x = px[i] + (px[i + 1] - px[i]) * t, z = pz[i] + (pz[i + 1] - pz[i]) * t;
      const j = Math.min(n - 1, i + 2), k = Math.max(0, i - 1);
      let fx = px[j] - px[k], fz = pz[j] - pz[k]; const fl = len(fx, fz) || 1; fx /= fl; fz /= fl;
      if (boxDepth(x, z, fx, fz, A.L, A.W, B) > 0) return false;
    }
    return true;
  }
  /**
   * Does a body (centre x, z, facing bfx, bfz, half length hl, half width hw) reach into the strip
   * my body sweeps along my path ahead? Measured at each path point against the path's direction
   * there, so a car I'll pass alongside once round a corner isn't "in my way" now. Returns the arc
   * length of the first such point (and its half-extent along my path in this.ext), else -1.
   */
  #onPath(A, x, z, bfx, bfz, hl, hw, margin, chord, maxS) {
    const ps = A.ps, px = A.px, pz = A.pz, n = A.n, half = A.W / 2 + margin, big = half + hl + hw;
    // the path is never shorter than the straight line, so start where it could first come close
    let i = this.#idxAt(A, A.s + Math.max(0, chord - big - 2));
    if (i <= A.idx) i = A.idx + 1;
    for (; i < n; i++) {
      if (ps[i] > maxS) return -1;
      const dx = px[i] - x, dz = pz[i] - z, d2 = dx * dx + dz * dz;
      if (d2 >= big * big) continue;
      const j = i + 1 < n ? i + 1 : i, k = i - 1;
      let tx = px[j] - px[k], tz = pz[j] - pz[k]; const tl = len(tx, tz) || 1; tx /= tl; tz /= tl;
      const c = Math.abs(tx * bfx + tz * bfz), sn = Math.abs(tx * bfz - tz * bfx);
      const thr = half + hl * sn + hw * c;
      if (d2 < thr * thr) { this.ext = hl * c + hw * sn; return ps[i]; }
    }
    return -1;
  }
  #idxAt(A, s) {
    const ps = A.ps; let lo = A.idx, hi = A.n - 1;
    if (s <= ps[lo]) return lo;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ps[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }
  /**
   * Do A's and B's paths cross in the next ~40 m, and does B get there first? Returns how far
   * along A the crossing is if A should wait, else -1. B held short of the crossing (lights, a
   * give-way, a queue) makes no claim; a tie goes to the lower id so two cars never both wait.
   */
  #yieldTo(A, B, look) {
    // my path every 1.5 m against theirs every 3 m: anything that brings the two lane centres within
    // 2.2 m is a conflict (crossing, merging, or a carriageway split that pinches two lanes together)
    const DA = Math.min(look, 40), DB = 40, R2 = 4.84;
    const n = A.n, m = B.n;
    for (let i = A.idx + 1; i < n && A.ps[i] - A.s <= DA; i++) {
      const ax = A.px[i], az = A.pz[i];
      const ex = ax - B.x, ez = az - B.z;
      if (ex * ex + ez * ez > (DB + 4) * (DB + 4)) continue;
      for (let j = B.idx + 1; j < m && B.ps[j] - B.s <= DB; j += 2) {
        const dx = B.px[j] - ax, dz = B.pz[j] - az;
        if (dx * dx + dz * dz >= R2) continue;
        const dA = A.ps[i] - A.s, dB = B.ps[j] - B.s;
        if (dB - B.L / 2 > B.freeD + 1) return -1;
        if (B.v < 0.5 && B.stopT > 3) return -1; // parked up or stuck: it isn't coming
        const tA = dA / Math.max(A.v, 2), tB = dB / Math.max(B.v, 2);
        return tA > tB + 0.25 || (tA >= tB - 0.25 && A.id > B.id) ? dA : -1;
      }
    }
    return -1;
  }
  /** a car on the ring coming round to my entry (the gap test LessonRun.rbConflict makes) */
  #ringBusy(A, e) {
    const rb = e.rb, cars = this.cars;
    for (let b = 0; b < cars.length; b++) {
      const B = cars[b];
      if (B === A || B.lane.rb !== rb.id) continue;
      if (B.v < 0.3 && B.blockId === A.id) continue; // stopped for my nose: it can't come until I go
      const th = Math.atan2(B.z - rb.z, B.x - rb.x), R = len(B.x - rb.x, B.z - rb.z);
      let d = (e.thE - th) * rb.sense; d = ((d % TAU) + TAU) % TAU; // how far round it has to come to reach me
      const arc = d * R;
      if ((TAU - d) * R < B.L / 2 + 3) return true; // just past my entry, still across it
      if (B.v < 0.3 && arc > B.L / 2 + 2) continue; // queued round the ring, not coming: I can go in front
      if (arc < Math.max(12, B.v * 3.2)) return true;
    }
    // the player's car on the ring has priority too (it isn't in this.cars)
    const me = this.me;
    if (me.x != null && me.v > 1) {
      const R = len(me.x - rb.x, me.z - rb.z);
      if (R < rb.r + 0.5 && R > (rb.island ?? 0) - 0.5) {
        let d = (e.thE - Math.atan2(me.z - rb.z, me.x - rb.x)) * rb.sense; d = ((d % TAU) + TAU) % TAU;
        if ((TAU - d) * R < 5 || d * R < Math.max(12, me.v * 3.2)) return true;
      }
    }
    return false;
  }
  /**
   * Something on the main road coming to this junction (moving, within r m or 5.5 s, not itself
   * giving way here). With `yaw`, only traffic coming the other way counts (a right turn's view).
   */
  #majorBusy(A, e, r, yaw = null) {
    if (this.#busyAt(A, e, e.nx, e.nz, e.node, r, yaw)) return true;
    // a second junction this one line also answers for (net.js merges the pair when there is no room
    // to wait between them): its main road has to be clear as well
    return !!e.node2 && this.#busyAt(A, e, e.nx2, e.nz2, e.node2, r, yaw);
  }
  #busyAt(A, e, nx, nz, nodeId, r, yaw) {
    const ox = yaw == null ? 0 : Math.sin(yaw), oz = yaw == null ? 0 : Math.cos(yaw);
    const cars = this.cars, r2 = r * r;
    for (let b = 0; b < cars.length; b++) {
      const B = cars[b];
      if (B === A || B.minorNode === nodeId) continue;
      if (B.v < 0.3 && B.blockId === A.id) continue; // it's waiting for me to get my nose out of its way
      if (yaw != null && B.fx * ox + B.fz * oz > -0.5) continue; // not oncoming
      const dx = nx - B.x, dz = nz - B.z, d2 = dx * dx + dz * dz, rr = B.v * 5.5; // or within 5.5 s
      if (d2 > r2 && d2 > rr * rr) continue;
      if ((B.v < 1.5 || B.held) && d2 > 144) continue; // stopped or held away from the mouth: not coming
      if (B.v < 0.3 && B.stopT > 3 && d2 > 16) continue; // standing in a queue on the main road, not coming (else a queue across the mouth never lets anyone out)

      if (dx * B.fx + dz * B.fz < -2) continue; // past the junction, going away
      return true;
    }
    // the player coming along the main road (not behind me on my own road, nor waiting at this junction)
    const me = this.me;
    if (me.x != null && me.v > 1.5 && A.fx * me.fx + A.fz * me.fz < 0.7 && (yaw == null || me.fx * ox + me.fz * oz <= -0.5)) {
      const dx = nx - me.x, dz = nz - me.z, d2 = dx * dx + dz * dz, rr = me.v * 5.5;
      if ((d2 <= r2 || d2 <= rr * rr) && dx * me.fx + dz * me.fz > -2) return true;
    }
    return false;
  }

  // ---------- cars: move ----------
  #move(A, dt) {
    const dv = A.want - A.v;
    A.v += dv > ACCEL * dt ? ACCEL * dt : dv < -MAX_BRAKE * dt ? -MAX_BRAKE * dt : dv;
    if (A.v < 0) A.v = 0;
    if (A.stun > 0) A.stun -= dt;
    A.stunned = A.stun > 0;
    const n = A.n, ps = A.ps;
    // where I am now, to come back to if the move would push me into someone
    const os = A.s, oi = A.idx, oa = A.aim, ox = A.x, oz = A.z, oh = A.heading, ofx = A.fx, ofz = A.fz, on = A.nudge;
    let back = 0;
    if (A.backUp > 0 && dt > 0) { // reversing out of a jam, slowly
      back = Math.min(A.backUp, 0.8 * dt, A.s);
      A.s -= back; A.v = 0;
      while (A.idx > 0 && ps[A.idx] > A.s) A.idx--;
      A.aim = A.idx + 1;
    }
    if (A.v > 1) A.noRoom = false;
    A.s = Math.min(A.s + A.v * dt, ps[n - 1]);
    while (A.idx < n - 2 && ps[A.idx + 1] <= A.s) A.idx++;
    this.#pose(A, dt);
    // last resort: never move deeper into another car's box (the rules above should keep clear anyway)
    // squeezing: carry on until clear of every car and the player, then back to the normal rules
    if (A.ghost > 0) A.ghost = this.#worse(A, A.x, A.z, A.fx, A.fz, true) || this.#overPlayer(A) ? Math.max(A.ghost, 0.5) : A.ghost - dt;
    const bumped = dt > 0 && (A.v > 0 || back > 0) && !(A.ghost > 0) ? this.#worse(A, ox, oz, ofx, ofz) : 0;
    if (bumped) {
      A.s = os; A.idx = oi; A.aim = oa; A.x = ox; A.z = oz; A.heading = oh; A.fx = ofx; A.fz = ofz; A.nudge = on; A.v = 0;
      A.freeD = 0; A.blockId = bumped; // so others know I'm going nowhere, and who for
      if (back > 0) { A.backUp = 0; A.noRoom = true; } // no room behind
    } else if (back > 0) {
      A.backUp -= back;
      while (A.evI > 0 && A.ev[A.evI - 1].s > A.s + A.L / 2) A.ev[--A.evI].go = false; // back behind a line: look again
    }
    const i = A.idx;
    // lines the front has crossed
    const front = A.s + A.L / 2;
    while (A.evI < A.ev.length && A.ev[A.evI].s <= front) {
      const e = A.ev[A.evI++];
      if (e.kind === 'lights' && !(A.lastGroup === e.group && e.s - A.lastGroupS < 90)) { A.lastGroup = e.group; A.lastGroupS = e.s; }
      if (this.onEvent) this.onEvent('line', A, e);
    }
    // on a ring: its id and where round it I am (fraction of a turn in circulation order)
    const rb = A.rbArr[i];
    if (rb) { A.lane.rb = rb.id; const u = (Math.atan2(A.z - rb.z, A.x - rb.x) * rb.sense) / TAU; A.u = u - Math.floor(u); }
    else { A.lane.rb = null; A.u = A.s; }
    A.pos.set(A.x, 0, A.z);
    if (A.v < 0.3) { if (!A.held) A.stopT += dt; } else if (A.v > 1) A.stopT = 0; // waiting at a line is not being stuck
  }

  #meshes(dt, cam) {
    for (const c of this.cars) {
      const m = c.mesh; if (!m) continue;
      const near = len(c.x - cam.x, c.z - cam.z) < HIDE;
      m.visible = near;
      if (!near) continue;
      // its own last height goes in, so a car on a flyover stays up and one beneath stays down
      m.position.set(c.x, this.groundY ? this.groundY(c.x, c.z, m.position.y) : 0, c.z);
      m.rotation.y = c.heading;
      if (this.gradeAt) {
        // YXZ so pitch turns about the car's own (already yawed) axis: nose up on a climb
        m.rotation.order = 'YXZ';
        m.rotation.x = -Math.atan(this.gradeAt(c.x, c.z, c.heading, m.position.y));
      }
      const { wheels, wheelR } = c.model;
      if (wheels) for (const w of wheels) w.spin.rotation.x += (w.spinSign ?? 1) * (c.v / (wheelR || 0.35)) * dt;
    }
    for (const p of this.peds) {
      const m = p.mesh; if (!m) continue;
      const near = len(p.x - cam.x, p.z - cam.z) < PED_HIDE;
      m.visible = near;
      if (!near) continue;
      const out = this.#pushOut(p.x, p.z), px = out ? out.x : p.x, pz = out ? out.z : p.z;
      m.position.set(px, (this.groundY ? this.groundY(px, pz, m.position.y) : 0) + (p.inRoad ? 0.02 : Y_PAVE), pz);
      m.rotation.y = p.heading;
      m.userData.animate?.(p.speed, dt);
    }
  }

  // ---------- spawning and recycling ----------
  #housekeep(dt) {
    const P = this.P, cars = this.cars;
    let heavy = false;
    for (let i = cars.length - 1; i >= 0; i--) {
      const A = cars[i], d = len(A.x - P.x, A.z - P.z);
      const end = A.s >= A.ps[A.n - 1] - 0.5;
      const jammed = A.stopT > 30 && A.noRoom && A.blockId && this.#byId(A.blockId)?.blockId === A.id; // nose to nose, no way back
      // a car that has reached the end of its route parks in the lane: in sight of the player it gets
      // a new destination (below); if that fails it goes after 20 s rather than block the road for good
      if (d > DESPAWN || (d > UNSEEN && (end || A.stopT > STUCK || jammed)) || (A.s >= A.ps[A.n - 1] - 4 && A.stopT > 20)) {
        if (!end && (A.stopT > STUCK || jammed) && d <= DESPAWN) this.stats.watchdog++;
        this.#despawn(i, d);
        continue;
      }
      // nearly home and the player is about: carry on somewhere new rather than vanish in sight
      if (!heavy && !A.extTried && A.s > A.ps[A.n - 1] - 120 && d < 400) { A.extTried = true; heavy = true; if (this.#extend(A)) this.stats.extended++; }
    }
    this.spawnT -= dt;
    if (!heavy && cars.length < this.maxCars && this.spawnT <= 0) { this.spawnT = 0.06; this.#refreshCache(); this.#spawnCar(); }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (len(p.x - P.x, p.z - P.z) > PED_DROP && p.state === 'walk') { if (p.mesh) p.mesh.visible = false; this.peds.splice(i, 1); this.pedPool.push(p); }
    }
    this.pedT -= dt;
    if (this.peds.length < this.maxPeds && this.pedT <= 0) { this.pedT = 0.1; this.#refreshCache(); this.#spawnPed(); }
  }
  #byId(id) { for (const c of this.cars) if (c.id === id) return c; return null; }
  /** the layer (0 on the ground, 1 on a bridge...) of the road under a car going (fx, fz) at (x, z) */
  #layerAt(x, z, fx, fz) {
    let best = null, bd = Infinity;
    for (const { way, i } of this.net.grid.near(x, z, 12)) {
      const a = way.pts[i], b = way.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = len(dx, dz) || 1;
      if (Math.abs((dx * fx + dz * fz) / L) < 0.8) continue; // not the road this car is driving along
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (L * L))), d = len(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < bd && d < way.halfW + 2) { bd = d; best = way; }
    }
    return best ? best.layer || (best.bridge ? 1 : 0) : 0;
  }
  /** am I in a ring of stopped cars each waiting for the next? (a queue ends at someone waiting at a line: not a gridlock) */
  #gridlocked(A) {
    let B = A;
    for (let k = 0; k < 12; k++) {
      B = B.blockId > 0 ? this.#byId(B.blockId) : null;
      if (!B || B.v > 0.3 || B.held) return false;
      if (B === A) return true;
    }
    return false;
  }
  #despawn(i, d) {
    const A = this.cars[i];
    if (A.mesh) A.mesh.visible = false;
    A.lane.rb = null; A.v = 0;
    this.cars.splice(i, 1); this.pool.push(A);
    this.stats.despawned++;
    if (this.onEvent) this.onEvent('despawn', A, d);
  }
  /** ways round the player to spawn on (cars, people), refreshed when the player moves 250 m */
  #refreshCache() {
    const P = this.P, kx = Math.floor(P.x / 250), kz = Math.floor(P.z / 250);
    if (this.cache.kx === kx && this.cache.kz === kz) return;
    const R = SPAWN_MAX + 250, x0 = P.x - R, x1 = P.x + R, z0 = P.z - R, z1 = P.z + R;
    const cars = [], peds = [];
    for (const b of this.boxes) {
      if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
      const w = b.way;
      if (!w.rb && w.cls !== 'service' && w.len > 70) cars.push(w);
      if (paveOk(w)) peds.push(w);
    }
    const cum = (list) => { const a = new Float64Array(list.length); let t = 0; list.forEach((w, i) => { t += w.len; a[i] = t; }); return a; };
    this.cache = { kx, kz, cars, carCum: cum(cars), peds, pedCum: cum(peds) };
  }
  /** a random point on a random way of a list, weighted by length: [way, seg, s, x, z] */
  #pickOn(list, cum) {
    if (!list.length) return null;
    const r = this.rnd() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const w = list[lo], s = this.rnd() * w.len, f = wayFrame(w, s, 0);
    return [w, f.i, s, f.x, f.z];
  }
  #nearNode(w, s, m) { // within m of a junction or road end along this way?
    for (let k = 0; k < w.nodes.length; k++) {
      if (!w.nodes[k]) continue;
      const nd = this.net.nodes.get(w.nodes[k]);
      if (nd && nd.kind !== 'via' && Math.abs(w.cum[k] - s) < m) return true;
    }
    return s < m || s > w.len - m;
  }
  #carNear(x, z, r) {
    for (const c of this.cars) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && len(c.x - x, c.z - z) < r) return true;
    return false;
  }
  /** a junction 1-3 km from (x, z) and at least 1 km from the player, so most cars leave by the 900 m rule */
  #pickDest(x, z) {
    const list = this.destNodes, P = this.P;
    for (let k = 0; k < 40; k++) {
      const n = list[Math.floor(this.rnd() * list.length)];
      const d = len(n.x - x, n.z - z);
      if (d < 1000 || d > 3000 || len(n.x - P.x, n.z - P.z) < 1000) continue;
      return n;
    }
    return null;
  }
  #spawnCar() {
    const P = this.P, net = this.net;
    for (let tries = 0; tries < 12; tries++) {
      const pick = this.#pickOn(this.cache.cars, this.cache.carCum); if (!pick) return false;
      const [w, , s, x, z] = pick;
      const dp = len(x - P.x, z - P.z);
      if (dp < SPAWN_MIN || dp > SPAWN_MAX) continue;
      if (this.#nearNode(w, s, 30) || this.#carNear(x, z, 30)) continue;
      const dest = this.#pickDest(x, z); if (!dest) continue;
      // one route per call: they cost a few milliseconds
      let route = null;
      try { route = net.route({ x, z, maxD: 10 }, dest.id); } catch { route = null; }
      const lp = route && route.ways.length ? net.lanePath(route) : null;
      if (!lp || lp.pts.length < 30 || route.ways[0].way !== w || len(lp.pts[0].x - P.x, lp.pts[0].z - P.z) < SPAWN_MIN) { this.stats.failed++; return false; }
      const A = this.pool.pop() || this.#newCar();
      A.under = this.rnd() * 5;
      this.#setPath(A, lp, route, dest);
      // start at a speed that can still stop for the first line on the route (lights, a give-way)
      const first = A.ev.length ? A.ev[0].s - A.L / 2 : Infinity;
      A.v = Math.min(A.vcap[0] * 0.9, Math.sqrt(2 * STOP_BRAKE * Math.max(0, first - 3))); A.stun = 0; A.stopT = 0; A.extTried = false; A.lastGroup = null; A.lastGroupS = -1e9;
      A.held = false; A.freeD = Infinity; A.minorNode = 0; A.nudge = 0; A.nudgeT = 0; A.blockId = 0; A.backUp = 0; A.noRoom = false; A.ghost = 0;
      this.#move(A, 0);
      this.cars.push(A);
      this.stats.spawned++;
      if (this.onEvent) this.onEvent('spawn', A, dp);
      return true;
    }
    return false;
  }
  #newCar() {
    const bodies = this.bodies, body = bodies.length ? bodies[Math.floor(this.rnd() * bodies.length)] : { dims: { L: 4.6, W: 1.85 }, colors: [0x8a8f96] };
    const spec = { ...body, color: body.colors ? body.colors[Math.floor(this.rnd() * body.colors.length)] : 0x8a8f96 };
    const model = this.buildCar ? this.buildCar(spec) : null;
    const L = body.dims?.L ?? 4.6, W = body.dims?.W ?? 1.85, radius = model?.radius ?? len(L, W) / 2;
    if (model) { model.root.visible = false; this.scene.add(model.root); }
    return {
      id: this.nextId++, model, mesh: model ? model.root : null, L, W, r: radius, radius,
      pos: new THREE.Vector3(), x: 0, z: 0, heading: 0, fx: 0, fz: 1, v: 0, want: 0,
      lane: { rb: null }, u: 0, stun: 0, stunned: false, under: 0, ghost: 0,
      n: 0, px: null, pz: null, ps: null, vcap: null, rbArr: [], ev: [], evI: 0, s: 0, idx: 0, aim: 0,
      route: null, dest: null, held: false, freeD: Infinity, blockId: 0, nudge: 0, nudgeT: 0, backUp: 0, noRoom: false, minorNode: 0, lastGroup: null, lastGroupS: -1e9, stopT: 0, extTried: false,
    };
  }
  /** load a lane path into a car: typed arrays, the speed it may do at each point, its lines */
  #setPath(A, lp, route, dest) {
    const net = this.net, pts = lp.pts, n = pts.length;
    if (!A.px || A.px.length < n) { const cap = Math.ceil(n * 1.25); A.px = new Float32Array(cap); A.pz = new Float32Array(cap); A.ps = new Float32Array(cap); A.vcap = new Float32Array(cap); }
    A.n = n; A.route = route; A.dest = dest;
    const px = A.px, pz = A.pz, ps = A.ps, vcap = A.vcap;
    let lastWay = null, cls = null;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      px[i] = p.x; pz[i] = p.z; ps[i] = p.s;
      if (p.way !== lastWay) { lastWay = p.way; cls = net.ways.get(p.way)?.cls; }
      const lim = Math.min(p.road?.limit ?? 30, CRUISE[cls] ?? 30);
      vcap[i] = Math.max(4, (lim - A.under) * MPH);
    }
    // bends: heading change across +-3 m
    for (let i = 2; i < n - 2; i++) {
      const h1 = Math.atan2(px[i] - px[i - 2], pz[i] - pz[i - 2]), h2 = Math.atan2(px[i + 2] - px[i], pz[i + 2] - pz[i]);
      let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = TAU - dh;
      const k = dh / Math.max(1, ps[i + 2] - ps[i - 2]);
      if (k > 1e-4) vcap[i] = Math.min(vcap[i], Math.sqrt(A_LAT / k));
    }
    vcap[n - 1] = 0; // pull up at the end
    for (let i = n - 2; i >= 0; i--) vcap[i] = Math.min(vcap[i], Math.sqrt(vcap[i + 1] * vcap[i + 1] + 2 * PLAN_BRAKE * (ps[i + 1] - ps[i])));
    // the lines along the route
    const idxAt = (s) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ps[m] <= s) lo = m; else hi = m - 1; } return lo; };
    const yawAt = (s) => { const i = Math.max(1, Math.min(n - 2, idxAt(s))); return Math.atan2(px[i + 1] - px[i - 1], pz[i + 1] - pz[i - 1]); };
    const ev = [], lightNodes = new Set();
    for (const e of lp.events) if (e.kind === 'lights' && !e.crossing && e.node) lightNodes.add(e.node);
    // the path point nearest (x, z) within s0..s1
    const nearestS = (x, z, s0, s1) => { let best = -1, bd = Infinity; for (let i = idxAt(s0); i < n && ps[i] <= s1; i++) { const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2; if (d < bd) { bd = d; best = ps[i]; } } return best; };
    for (const e of lp.events) {
      if (e.kind === 'lights') {
        // stop lines where roads.js paints them, so the front stops on the paint: at a crossing 3.4 m
        // before its centre (the event is 4.5 m before it); at a junction the arm's line distance
        // back from the node (the cross road's half width + 1 m), measured from where the path passes it
        let line = e.s + 1.1;
        if (!e.crossing) {
          const node = net.nodes.get(e.node), here = pts[idxAt(e.s - 3)]?.way;
          let dist = 0;
          if (node) {
            const j = idxAt(e.s - 3), tx = px[Math.min(n - 1, j + 1)] - px[j], tz = pz[Math.min(n - 1, j + 1)] - pz[j];
            const info = nodeInfo(this.view, e.node);
            let best = -2; for (const a of info?.arms || []) { if (a.way.id !== here) continue; const dot = -(a.ax * tx + a.az * tz); if (dot > best && a.lineDist) { best = dot; dist = a.lineDist; } }
            if (!dist) { let hw = 3; for (const r of node.ways) if (r.way.id !== here && !r.way.rb) hw = Math.max(hw, r.way.halfW); dist = hw + 1; }
          }
          const nodeS = node ? nearestS(node.x, node.z, e.s - 10, e.s + 12) : e.s + 2;
          line = Math.max(0, (nodeS >= 0 ? nodeS : e.s + 2) - (dist || 4.5));
        }
        ev.push({ kind: 'lights', s: line, group: e.group, yaw: yawAt(line), node: e.node, go: false });
      } else if (e.kind === 'rb') {
        const rb = net.roundabouts.get(e.rb), node = net.nodes.get(e.node); if (!rb || !node) continue;
        // the give-way line is painted along the ring's outer edge: where the path first comes inside it
        let edge = e.entryS, wait = e.entryS;
        for (let i = idxAt(e.entryS - 14); i < n && ps[i] <= e.entryS + 10; i++) { const R = len(px[i] - rb.x, pz[i] - rb.z); if (R <= rb.r + 2.5 && wait === e.entryS) wait = ps[i]; if (R <= rb.r) { edge = ps[i]; break; } }
        // the front waits 2.5 m out from the ring's edge: the path comes in at a slant, and a car
        // whose nose is at the paint has a corner in the circulating lane
        ev.push({ kind: 'rb', s: Math.min(wait, edge - 0.8), ringS: edge + 1, rb, node: e.node, thE: Math.atan2(node.z - rb.z, node.x - rb.x), go: false });
      } else if (e.kind === 'emerge' || e.kind === 'cross' || e.kind === 'mini') {
        const node = net.nodes.get(e.node); if (!node) continue;
        // node2: a road we cross on the way in, too close to this one to wait between the two, so the
        // one line answers for both junctions and both have to be clear before we go
        const n2 = e.node2 ? net.nodes.get(e.node2) : null;
        ev.push({ kind: e.kind, s: e.kind === 'mini' ? e.s : (e.lineS ?? e.s - 4), node: e.node, nx: node.x, nz: node.z, node2: n2 ? e.node2 : 0, nx2: n2 ? n2.x : 0, nz2: n2 ? n2.z : 0, signalled: lightNodes.has(e.node) || node.signals, go: false });
      } else if (e.kind === 'turn' && e.dir === 'right') { // turning right across the oncoming lane
        const node = net.nodes.get(e.node); if (!node) continue;
        const line = Math.max(0, e.s - 4);
        ev.push({ kind: 'right', s: line, yaw: yawAt(line), node: e.node, nx: node.x, nz: node.z, signalled: lightNodes.has(e.node) || node.signals, go: false });
      } else if (e.kind === 'zebra') {
        const at = pts[idxAt(e.s + 4.5)]; let rec = null, bd = 144;
        if (at) for (const r of this.crossings.values()) { if (!r.zebra) continue; const d2 = (r.x - at.x) ** 2 + (r.z - at.z) ** 2; if (d2 < bd) { bd = d2; rec = r; } }
        ev.push({ kind: 'zebra', s: e.s + 1.5, rec, go: false }); // the give-way line, 3 m before the stripes' centre
      }
    }
    ev.sort((a, b) => a.s - b.s);
    A.ev = ev; A.evI = 0;
    // ring membership, from the give-way line on (the blend before it is still the approach)
    const rbArr = A.rbArr; rbArr.length = n; rbArr.fill(null);
    for (const e of ev) {
      if (e.kind !== 'rb') continue;
      const id = e.rb.id;
      let i = idxAt(e.s); const stop = Math.min(n, i + 30);
      while (i < stop && pts[i].rb !== id) i++; // the arc proper can start a point or two past the line
      for (; i < n && pts[i].rb === id; i++) if (ps[i] >= e.ringS && len(px[i] - e.rb.x, pz[i] - e.rb.z) <= e.rb.r + 1) rbArr[i] = e.rb;
    }
    A.s = 0; A.idx = 0; A.aim = 0;
    A.x = px[0]; A.z = pz[0];
    A.heading = Math.atan2(px[Math.min(n - 1, 3)] - px[0], pz[Math.min(n - 1, 3)] - pz[0]); A.fx = Math.sin(A.heading); A.fz = Math.cos(A.heading);
  }
  /**
   * Re-route from a junction the car has already passed, through its old destination, on to a new
   * one, and put the car back where it is on the new path. False if that can't be done cleanly.
   */
  #extend(A) {
    const net = this.net, route = A.route; if (!route || !A.dest) return false;
    let from = null, j = 0;
    for (const id of route.nodes) {
      const nd = net.nodes.get(id); if (!nd) continue;
      let best = -1, bd = 49;
      for (let i = j; i < A.n && A.ps[i] < A.s; i++) { const dx = A.px[i] - nd.x, dz = A.pz[i] - nd.z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = i; } }
      if (best < 0) break;
      j = best;
      if (!nd.rb && A.ps[best] < A.s - 15) from = nd;
    }
    if (!from) return false;
    const dest = this.#pickDest(A.dest.x, A.dest.z); if (!dest) return false;
    let r2 = null;
    try { r2 = net.route(from.id, dest.id, { via: [A.dest.id] }); } catch { r2 = null; }
    if (!r2) return false;
    for (let k = 0; k + 1 < r2.ways.length; k++) if (r2.ways[k].way === r2.ways[k + 1].way && r2.ways[k].dir !== r2.ways[k + 1].dir) return false; // a U-turn at the old destination
    const lp = net.lanePath(r2);
    let bi = -1, bd = 2.25;
    for (let i = 0; i < lp.pts.length - 1; i++) {
      const p = lp.pts[i], dx = p.x - A.x, dz = p.z - A.z, d2 = dx * dx + dz * dz;
      if (d2 >= bd) continue;
      const q = lp.pts[i + 1], hx = q.x - p.x, hz = q.z - p.z;
      if (hx * A.fx + hz * A.fz <= 0) continue; // the other way along the same road
      bd = d2; bi = i;
    }
    if (bi < 0) return false;
    const v = A.v, group = A.lastGroup, since = A.s - A.lastGroupS; // keep how far past its last lights it is
    this.#setPath(A, lp, r2, dest);
    A.s = lp.pts[bi].s; A.idx = bi; A.aim = bi + 1; A.v = v;
    A.lastGroup = group; A.lastGroupS = A.s - since;
    const front = A.s + A.L / 2;
    while (A.evI < A.ev.length && A.ev[A.evI].s <= front) A.evI++;
    this.#move(A, 0);
    return true;
  }

  // ---------- pedestrians ----------
  #peds(dt) {
    const peds = this.peds, touched = this.touched;
    for (let i = 0; i < touched.length; i++) touched[i].busy = 0; // people say they're there again every frame
    touched.length = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.state === 'walk') this.#walk(p, dt);
      else if (p.state === 'wait') this.#waitAt(p, dt);
      else this.#crossOver(p, dt);
    }
  }
  #walk(p, dt) {
    const w = p.way, s0 = p.s;
    p.s += p.v * dt * p.dir;
    if (p.s < 0 || p.s > w.len) this.#corner(p);
    else {
      const list = this.crossByWay.get(w.id);
      if (list) for (let k = 0; k < list.length; k++) {
        const rec = list[k];
        if ((s0 - rec.s) * (p.s - rec.s) > 0 || p.lastRec === rec) continue;
        p.lastRec = rec;
        if (this.rnd() < 0.5) { p.state = 'wait'; p.rec = rec; p.t = 0; p.s = rec.s; p.lat = p.side * p.off; break; }
      }
    }
    const f = wayFrame(p.way, p.s, p.i); p.i = f.i;
    this.#stepTo(p, f.x + f.dz * p.side * p.off, f.z - f.dx * p.side * p.off, dt, true);
  }
  /** move towards a target point at no more than a brisk walk (corners are cut, not jumped) */
  #stepTo(p, tx, tz, dt, face) {
    const dx = tx - p.x, dz = tz - p.z, d = len(dx, dz), max = Math.max(2.2, p.v * 2) * dt;
    if (d > 25) { p.x = tx; p.z = tz; p.speed = p.v; return; }
    const k = d > max ? max / d : 1;
    p.x += dx * k; p.z += dz * k;
    p.speed = dt > 0 ? (d * k) / dt : 0;
    if (face && d * k > 1e-4) p.heading = Math.atan2(dx, dz);
  }
  /** The player's car, as a box a person cannot stand inside: {x, z, hx, hz, L, W} or null. */
  #meBox() {
    const me = this.me;
    return me.x != null && me.L && me.hx != null ? me : null;
  }

  /** Nobody stands inside the player's car. Walking is timed exactly as it always was - the step
   *  along the pavement, the step across the road - and only where a person would END UP inside the
   *  bodywork are they moved the shortest way out of it, so they walk around the car and along it
   *  rather than through it. Keeping the timing untouched matters: people's steps feed the same
   *  random stream as the traffic, so halting them would reshuffle every car on the map. */
  #pushOut(x, z, pad = 0.42) {
    const me = this.#meBox();
    if (!me || Math.abs(me.x - x) > 7 || Math.abs(me.z - z) > 7) return null;
    const dx = x - me.x, dz = z - me.z;
    const f = dx * me.hx + dz * me.hz, t = dx * me.hz - dz * me.hx; // along the car, across it
    const hl = me.L / 2 + pad, hw = me.W / 2 + pad;
    const inF = hl - Math.abs(f), inT = hw - Math.abs(t);
    if (inF <= 0 || inT <= 0) return null; // outside it already
    // out the nearer face: sideways past the flank, or forwards/backwards past the nose or boot
    const F = inT <= inF ? f : Math.sign(f || 1) * hl;
    const T = inT <= inF ? Math.sign(t || 1) * hw : t;
    return { x: me.x + F * me.hx + T * me.hz, z: me.z + F * me.hz - T * me.hx };
  }

  #corner(p) {
    const w = p.way, atEnd = p.s > w.len, nid = w.nodes[atEnd ? w.nodes.length - 1 : 0];
    const node = nid ? this.net.nodes.get(nid) : null;
    let pick = null;
    if (node) {
      let count = 0;
      for (const r of node.ways) if (r.way !== w && paveOk(r.way)) count++;
      if (count) { let k = Math.floor(this.rnd() * count); for (const r of node.ways) if (r.way !== w && paveOk(r.way) && k-- === 0) { pick = r; break; } }
    }
    if (!pick) { p.dir = -p.dir; p.s = Math.max(0, Math.min(w.len, p.s)); return; } // a dead end: turn round
    const walkSide = p.side * p.dir, nw = pick.way;
    p.way = nw; p.i = Math.max(0, Math.min(pick.idx, nw.pts.length - 2)); p.s = nw.cum[pick.idx];
    p.dir = pick.idx === 0 ? 1 : pick.idx === nw.nodes.length - 1 ? -1 : this.rnd() < 0.5 ? 1 : -1;
    p.side = walkSide * p.dir; // stay on the same side of the walker
    p.off = nw.halfW + PAVE_OFF;
    p.lastRec = null;
  }
  #waitAt(p, dt) {
    const rec = p.rec, sig = this.signals;
    p.t += dt;
    if (rec.busy++ === 0) this.touched.push(rec);
    let go = false;
    if (rec.zebra) go = p.t > 0.8 && this.#zebraClear(rec);
    else if (sig) { sig.press(rec.group); go = sig.pedGreen(rec.group); }
    else go = p.t > 3;
    const f = wayFrame(rec.way, rec.s, p.i); p.i = f.i;
    this.#stepTo(p, f.x + f.dz * p.lat, f.z - f.dx * p.lat, dt, false);
    p.heading = Math.atan2(-f.dz * p.side, f.dx * p.side); // facing across the road
    if (go) { p.state = 'cross'; p.t = 0; if (rec.zebra) this.stats.zebraCrossings++; else this.stats.signalCrossings++; }
    else if (p.t > 45) { p.state = 'walk'; p.rec = null; this.stats[rec.zebra ? 'zebraGaveUp' : 'signalGaveUp']++; } // gave up
  }
  #crossOver(p, dt) {
    const rec = p.rec, sig = this.signals;
    if (rec.busy++ === 0) this.touched.push(rec);
    if (!rec.zebra && sig) sig.occupy(rec.group);
    p.lat -= p.side * p.v * 1.1 * dt;
    const f = wayFrame(rec.way, rec.s, p.i); p.i = f.i;
    p.x = f.x + f.dz * p.lat; p.z = f.z - f.dx * p.lat; p.speed = p.v * 1.1;
    p.heading = Math.atan2(-f.dz * p.side, f.dx * p.side);
    p.inRoad = Math.abs(p.lat) < rec.way.halfW + 0.3;
    if (p.lat * p.side <= -p.off) { // over: carry on along the far pavement
      p.side = -p.side; p.state = 'walk'; p.inRoad = false; p.dir = this.rnd() < 0.5 ? 1 : -1; p.rec = null;
    }
  }
  /**
   * Nothing to stop someone stepping onto the zebra: no car standing on the stripes, and nothing
   * coming that couldn't stop comfortably before them. A car waiting at its give-way line is giving
   * way, which is what the line is for, so it doesn't count: measured by distance alone it did, and
   * then the car waited for the pedestrian and the pedestrian waited for the car until one gave up.
   */
  #zebraClear(rec) {
    for (const B of this.cars) {
      const dx = rec.x - B.x, dz = rec.z - B.z, d2 = dx * dx + dz * dz;
      if (d2 > 3600) continue;
      const along = dx * B.fx + dz * B.fz, lat = Math.abs(dx * B.fz - dz * B.fx);
      if (lat < 4 && Math.abs(along) < B.L / 2 + 1.6) return false; // its body is over the stripes
      if (along <= 0) continue; // going away
      if (B.v > 0.5 && (B.v * B.v) / 10 > along - B.L / 2 - 5) return false; // coming, and too fast to stop
    }
    return true;
  }
  #spawnPed() {
    const P = this.P;
    for (let tries = 0; tries < 8; tries++) {
      // a third of people start near a crossing, walking towards it: that's where people cross
      const pick = this.rnd() < 0.33 ? this.#nearCrossing() : this.#pickOn(this.cache.peds, this.cache.pedCum); if (!pick) continue;
      const [w, seg, s, x, z] = pick;
      const dp = len(x - P.x, z - P.z);
      if (dp < PED_MIN || dp > PED_MAX) continue;
      const p = this.pedPool.pop() || this.#newPed();
      p.way = w; p.i = seg; p.s = s;
      p.dir = pick[5] || (this.rnd() < 0.5 ? 1 : -1); p.side = this.rnd() < 0.5 ? 1 : -1; p.off = w.halfW + PAVE_OFF;
      p.v = 1.15 + this.rnd() * 0.35; p.state = 'walk'; p.rec = null; p.lastRec = null; p.inRoad = false; p.t = 0;
      const f = wayFrame(w, p.s, p.i);
      p.x = f.x + f.dz * p.side * p.off; p.z = f.z - f.dx * p.side * p.off;
      p.heading = Math.atan2(f.dx * p.dir, f.dz * p.dir); p.speed = p.v;
      this.peds.push(p);
      return true;
    }
    return false;
  }
  /** a point on a pavement 5-25 m from a crossing in range of the player (same shape as #pickOn) */
  #nearCrossing() {
    const P = this.P;
    let rec = null, k = 0;
    for (const r of this.crossings.values()) { // reservoir pick among those in range
      const d = len(r.x - P.x, r.z - P.z);
      if (d < PED_MIN || d > PED_MAX || !paveOk(r.way)) continue;
      if (this.rnd() * ++k < 1) rec = r;
    }
    if (!rec) return null;
    const w = rec.way, s = Math.max(0, Math.min(w.len, rec.s + (this.rnd() < 0.5 ? -1 : 1) * (5 + this.rnd() * 20))), f = wayFrame(w, s, 0);
    return [w, f.i, s, f.x, f.z, rec.s > s ? 1 : -1];
  }
  #newPed() {
    const mesh = this.buildPedestrian ? this.buildPedestrian(this.pedPool.length + this.peds.length) : null;
    if (mesh) { mesh.visible = false; this.scene.add(mesh); }
    return { mesh, x: 0, z: 0, heading: 0, v: 1.3, speed: 0, way: null, i: 0, s: 0, dir: 1, side: 1, off: 4, state: 'walk', rec: null, lastRec: null, lat: 0, t: 0, inRoad: false };
  }

  dispose() {
    for (const c of [...this.cars, ...this.pool]) if (c.mesh) this.scene.remove(c.mesh);
    for (const p of [...this.peds, ...this.pedPool]) if (p.mesh) this.scene.remove(p.mesh);
    this.cars.length = 0; this.peds.length = 0; this.pool.length = 0; this.pedPool.length = 0;
  }
}

/** how far a box at (x, z) facing (fx, fz), L x W, overlaps car B's box (m, 0 if apart; 0.1 m grace a side) */
function boxDepth(x, z, fx, fz, L, W, B) {
  const ahl = L / 2 - 0.1, ahw = W / 2 - 0.1, bhl = B.L / 2 - 0.1, bhw = B.W / 2 - 0.1, dx = B.x - x, dz = B.z - z;
  let m = Infinity;
  for (let a = 0; a < 4; a++) {
    const ux = a === 0 ? fx : a === 1 ? fz : a === 2 ? B.fx : B.fz, uz = a === 0 ? fz : a === 1 ? -fx : a === 2 ? B.fz : -B.fx;
    const ra = ahl * Math.abs(fx * ux + fz * uz) + ahw * Math.abs(fz * ux - fx * uz);
    const rb = bhl * Math.abs(B.fx * ux + B.fz * uz) + bhw * Math.abs(B.fz * ux - B.fx * uz);
    const o = ra + rb - Math.abs(dx * ux + dz * uz);
    if (o <= 0) return 0;
    if (o < m) m = o;
  }
  return m;
}

/** the speed that keeps a safe gap g (m) to something ahead going lv m/s, when I'm doing v */
function follow(want, g, lv, v) {
  let w = Math.sqrt(2 * FOLLOW_BRAKE * Math.max(0, g));
  if (g < v * 1.5) w = Math.min(w, lv + Math.max(0, g - v * 0.9) * 0.4);
  return want < w ? want : w;
}
