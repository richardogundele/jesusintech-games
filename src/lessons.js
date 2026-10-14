// UK driving lessons: one engine, lessons as data. A lesson is a route through Whitmore; the
// instructor gives directions from the route's events, and one fault monitor marks every run the
// way a DVSA examiner would: driving faults (minors), serious and dangerous faults.
// Pass = 15 or fewer driving faults and no serious or dangerous faults.
import * as THREE from 'three';
import { buildRoute, MPH, LANE } from './worlds/uk.js';

export const LESSONS = [
  {
    id: 'moveoff', title: 'Moving off and stopping', blurb: 'Mirrors, signal, move off, keep left, pull up at the kerb.',
    stops: ['TC', { x: -130, z: 0 }],
    intro: "Hi Richard, I'm Sarah, your instructor. Today: moving off and stopping. Check your mirrors with Q, signal right with X, then move off and keep to the left.",
  },
  {
    id: 'junctions', title: 'Junctions', blurb: 'Turning into side roads and emerging at give-way lines.',
    stops: ['TC', 'J1', 'CLT', 'J3', { x: 0, z: 90 }],
    intro: 'Junctions today. Mirrors, signal, then slow down before the turn. At the give-way lines, look both ways and only go when it is clear.',
  },
  {
    id: 'roundabouts', title: 'Roundabouts', blurb: 'Give way to traffic from the right; signal for your exit.',
    stops: [{ x: 0, z: 150 }, 'RB', 'J5', 'RVE', 'J4', 'RB', { x: 250, z: 0 }],
    intro: 'Roundabouts. Give way to traffic coming from your right. Signal left for the first exit, nothing for straight on, right for the third.',
  },
  {
    id: 'crossings', title: 'Crossings and lights', blurb: 'Zebra crossings, puffin lights and speed limits.',
    stops: ['TC', 'J1', 'RB', { x: 250, z: 0 }],
    intro: 'Pedestrian crossings and traffic lights. If someone is waiting at the zebra, stop and let them cross. Stop at a red light behind the white line.',
  },
  {
    id: 'mock', title: 'Mock driving test', blurb: 'The full route. Fifteen driving faults or fewer and no serious faults to pass.', mock: true,
    stops: ['TC', 'J1', 'CLT', 'J3', 'RB', 'J4', 'RVE', 'J5', 'RB', { x: -235, z: 0 }],
    intro: "Good morning. I'd like you to follow the road ahead unless traffic signs direct you otherwise. When I want you to turn, I'll ask you in good time. Move off when you're ready.",
  },
];

const SEV = { minor: 'Driving fault', serious: 'Serious fault', dangerous: 'Dangerous fault' };

export class LessonRun {
  /** hooks: { say(text), hud({ text, faults, mock }), result(sheet), cancelled(why) } */
  constructor(world, def, hooks) {
    this.world = world;
    this.def = def;
    this.hooks = hooks;
    this.route = buildRoute(def.stops);
    this.events = this.route.events.map((e) => ({ ...e }));
    this.faults = [];
    this.t = 0;
    this.s = 0;
    this.idx = 0;
    this.lat = 0;
    this.dist = 0;
    this.sig = [];        // { dir, s, t } samples while an indicator is on
    this.mirror = [];     // { s, t } mirror checks
    this.cool = {};
    this.timers = {};
    this.moved = false;
    this.stopT = 0;
    this.done = false;
    this.text = def.intro;
    this.say(def.intro);
    // emerging give-way lines: where the route crosses the mouth of the side road
    if (!def.mock) this.guide = guideLine(this.route.pts);
    if (this.guide) world.scene.add(this.guide);
  }

  say(text) {
    this.text = text;
    this.hooks.say(text);
  }

  fault(sev, cat, coolKey = cat, cooldown = 0) {
    if (cooldown && this.cool[coolKey] > this.t) return;
    if (cooldown) this.cool[coolKey] = this.t + cooldown;
    this.faults.push({ sev, cat, s: this.s, at: this.carPos && { x: +this.carPos.x.toFixed(1), z: +this.carPos.z.toFixed(1) }, extra: this.lastExtra });
    this.lastExtra = null;
    if (!this.def.mock) this.hooks.flash?.(`${SEV[sev]}: ${cat}`, sev);
  }

  /** time-based "condition held for n seconds" helper */
  held(key, cond, dt, secs) {
    this.timers[key] = cond ? (this.timers[key] || 0) + dt : 0;
    return this.timers[key] > secs;
  }

  track(car) {
    const pts = this.route.pts;
    let best = this.idx, bd = Infinity;
    const lo = Math.max(0, this.idx - 15), hi = Math.min(pts.length - 1, this.idx + 80);
    const scan = (a, b) => { for (let i = a; i <= b; i++) { const d = (pts[i].x - car.pos.x) ** 2 + (pts[i].z - car.pos.z) ** 2; if (d < bd) { bd = d; best = i; } } };
    scan(lo, hi);
    if (bd > 400) scan(0, pts.length - 1); // lost: search everywhere
    this.idx = best;
    const p = pts[best], q = pts[Math.min(pts.length - 1, best + 1)], o = pts[Math.max(0, best - 1)];
    let dx = q.x - o.x, dz = q.z - o.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const rx = car.pos.x - p.x, rz = car.pos.z - p.z;
    const along = rx * dx + rz * dz;
    this.s = THREE.MathUtils.clamp(p.s + along, 0, this.route.length);
    this.lat = rx * dz - rz * dx; // + = left of the lane centre (driver's left is (dz, -dx))
    this.dist = Math.sqrt(bd);
  }

  nearJunction(margin = 28) {
    return this.events.some((e) => ['turn', 'emerge', 'bend', 'rb'].includes(e.kind) && this.s > e.s - margin && this.s < e.s + (e.kind === 'rb' ? 75 : margin))
      || Math.hypot(this.carPos.x - this.world.rb.x, this.carPos.z - this.world.rb.z) < this.world.rb.outer + 6;
  }

  /** ctl: { indicator: 'left'|'right'|null, mirrorPressed: bool, hit: bool } */
  update(dt, car, ctl) {
    if (this.done) return;
    this.t += dt;
    this.carPos = car.pos;
    const prevS = this.s;
    this.track(car);
    const s = this.s, mph = Math.abs(car.vF) * MPH;
    if (ctl.indicator && (!this.sig.length || this.t - this.sig[this.sig.length - 1].t > 0.25)) this.sig.push({ dir: ctl.indicator, s, t: this.t });
    if (ctl.mirrorPressed) this.mirror.push({ s, t: this.t });
    const signalled = (dir, s0, s1) => this.sig.some((x) => x.dir === dir && x.s >= s0 && x.s <= s1);
    const anySignal = (s0, s1) => this.sig.find((x) => x.s >= s0 && x.s <= s1)?.dir;
    const mirrors = (s0, s1) => this.mirror.some((m) => m.s >= s0 && m.s <= s1);
    const crossed = (line) => prevS < line && s >= line;

    // ---- moving off ----
    if (!this.moved && mph > 2) {
      this.moved = true;
      if (!this.mirror.some((m) => this.t - m.t < 10)) this.fault('minor', 'Move off: safety (mirrors)');
      if (!this.sig.some((x) => x.dir === 'right' && this.t - x.t < 10)) this.fault('minor', 'Signals: necessary (moving off)');
    }

    // ---- events ----
    for (const e of this.events) {
      const lead = e.kind === 'pullup' ? 70 : e.kind === 'rb' ? 75 : 65;
      if (e.text && !e.said && s > e.s - lead && this.moved) { e.said = true; this.say(e.text); }
      if (['turn', 'emerge', 'rb'].includes(e.kind) && !e.marked && s > e.s + (e.kind === 'rb' ? 20 : 10)) {
        e.marked = true;
        const ref = e.s;
        const want = e.dir;
        if (want !== 'none' && !signalled(want, ref - 85, ref + 3)) this.fault('minor', 'Signals: necessary');
        const other = want === 'left' ? 'right' : want === 'right' ? 'left' : null;
        if (want === 'none' ? anySignal(ref - 60, ref) : signalled(other, ref - 60, ref + 1)) this.fault('minor', 'Signals: correctly');
        if (!mirrors(ref - 120, ref + 2)) this.fault('minor', 'Mirrors: change direction');
      }
      // emerging: you must slow right down (or stop) in the last 15 m to look properly
      if (e.kind === 'emerge' && !e.lineDone && s > e.lineS - 15 && s <= e.lineS) e.minMph = Math.min(e.minMph ?? Infinity, mph);
      if (e.kind === 'emerge' && !e.lineDone && crossed(e.lineS)) {
        e.lineDone = true;
        e.lineMph = mph;
        if ((e.minMph ?? mph) > 7) this.fault('serious', 'Junctions: observation (emerged without slowing to look)');
      }
      if (e.kind === 'rb' && !e.entryDone && crossed(e.entryS + 1.7)) {
        e.entryDone = true;
        if (mph > 16) this.fault('minor', 'Junctions: approach speed');
        if (this.rbConflict(car)) this.fault('serious', 'Junctions: observation (did not give way to the right)');
      }
      if (e.kind === 'lights' && !e.done && crossed(e.s)) {
        e.done = true;
        if (this.world.lights.state === 'red' || this.world.lights.state === 'redamber') this.fault('serious', 'Response to signals: traffic lights');
      }
      if (e.kind === 'zebra' && !e.done && crossed(e.s)) {
        e.done = true;
        if (this.world.zebra.busy) this.fault('serious', 'Pedestrian crossings');
      }
    }

    // ---- continuous marking ----
    const limit = this.world.speedLimitAt(car.pos.x, car.pos.z);
    if (this.held('fast', mph > limit + 2, dt, 1.5)) this.fault('minor', 'Speed', 'speed', 12);
    if (this.held('vfast', mph > limit + 10, dt, 1.0)) this.fault('serious', 'Speed (well over the limit)', 'vspeed', 15);
    const nearJ = this.nearJunction();
    const pullingUp = s > this.route.length - 60;
    if (!nearJ && this.dist < 8) {
      if (this.held('wide', this.lat < -1.5, dt, 2)) this.fault('minor', 'Positioning: normal driving', 'pos', 10);
      if (this.held('wrong', this.lat < -2.6, dt, 1.5)) this.fault('serious', 'Positioning: driving on the wrong side', 'pos2', 12);
      if (this.held('kerb', this.lat > 1.05, dt, 0.15)) this.fault('minor', 'Control: steering (hit the kerb)', 'kerb', 8);
      if (this.held('pave', this.lat > 1.9, dt, 0.3)) this.fault('serious', 'Control: steering (mounted the pavement)', 'pave', 10);
    }
    if (ctl.hit) this.fault('dangerous', 'Control: collision', 'hit', 5);
    for (const p of this.people()) {
      if (Math.hypot(p.x - car.pos.x, p.z - car.pos.z) < 1.6 && mph > 3) { this.lastExtra = { ped: [+p.x.toFixed(1), +p.z.toFixed(1)], kind: p.kind }; this.fault('dangerous', 'Pedestrian put at risk', 'ped', 6); }
    }
    const waitingAhead = this.events.some((e) => ['lights', 'zebra', 'emerge', 'rb'].includes(e.kind) && s > (e.lineS ?? e.entryS ?? e.s) - 45 && s < (e.lineS ?? e.entryS ?? e.s) + 4);
    if (this.held('slow', this.moved && !waitingAhead && !pullingUp && !nearJ && mph < Math.min(8, limit * 0.3), dt, 12)) this.fault('minor', 'Progress: undue hesitation', 'slow', 25);

    // ---- off route ----
    if (this.held('off', this.dist > 14, dt, 4) && !this.offSaid) {
      this.offSaid = true;
      this.say(this.def.mock ? "We've gone off the route. Turn round when it's safe and I'll take you back." : "We've gone off the route. Turn round when it's safe and follow the blue line.");
    }
    if (this.dist < 6) this.offSaid = false;

    // ---- pulling up at the end ----
    const end = this.events.find((e) => e.kind === 'pullup');
    if (s > end.s - 55 && this.dist < 10) {
      this.stopT = mph < 0.6 ? this.stopT + dt : 0;
      if (this.stopT > 1.2) this.finish(end);
    }
    this.hooks.hud({ text: this.text, faults: this.counts(), mock: !!this.def.mock, title: this.def.title });
  }

  people() {
    const list = [];
    for (const c of this.world.crossers || []) list.push({ x: c.mesh.position.x, z: c.mesh.position.z, kind: c.state });
    for (const p of this.world.traffic?.peds || []) list.push({ x: p.x, z: p.z, kind: 'pavement' });
    return list;
  }

  rbConflict(car, range = 18) {
    const rb = this.world.rb, sense = this.world.rbSenseSign;
    const th = Math.atan2(car.pos.z - rb.z, car.pos.x - rb.x);
    for (const c of this.world.traffic?.cars || []) {
      if (c.v < 1.5) continue;
      const ph = Math.atan2(c.z - rb.z, c.x - rb.x);
      let d = (th - ph) * sense;
      d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (d * rb.lane < range) return true;
    }
    return false;
  }

  counts() {
    const c = { minor: 0, serious: 0, dangerous: 0 };
    for (const f of this.faults) c[f.sev]++;
    return c;
  }

  finish(end) {
    if (!end.marked) {
      end.marked = true;
      if (!signalled(this.sig, 'left', end.s - 110)) this.fault('minor', 'Signals: necessary (pulling up)');
      if (!this.mirror.some((m) => m.s >= end.s - 120)) this.fault('minor', 'Mirrors: signalling (pulling up)');
      if (this.lat < -0.4) this.fault('minor', 'Positioning: too far from the kerb');
    }
    this.done = true;
    this.dispose();
    const c = this.counts();
    const passed = c.minor <= 15 && c.serious === 0 && c.dangerous === 0;
    const groups = {};
    for (const f of this.faults) {
      const k = `${f.sev}|${f.cat}`;
      groups[k] = (groups[k] || 0) + 1;
    }
    const lines = Object.entries(groups).map(([k, n]) => { const [sev, cat] = k.split('|'); return { sev, cat, n }; })
      .sort((a, b) => ['dangerous', 'serious', 'minor'].indexOf(a.sev) - ['dangerous', 'serious', 'minor'].indexOf(b.sev));
    const verdict = this.def.mock
      ? (passed ? "That's the end of your test. I'm pleased to tell you you've passed." : "That's the end of your test. I'm sorry to tell you that you haven't passed today.")
      : (passed ? 'Lovely. That was a good drive. Let me show you how it went.' : "That's the end of the lesson. We've got a few things to work on.");
    this.say(verdict);
    this.hooks.result({ id: this.def.id, title: this.def.title, mock: !!this.def.mock, passed, counts: c, lines, time: this.t });
  }

  cancel(why) {
    if (this.done) return;
    this.done = true;
    this.dispose();
    this.hooks.cancelled(why);
  }

  dispose() {
    if (this.guide) { this.world.scene.remove(this.guide); this.guide.geometry.dispose(); }
  }

  /** route as a few points for the minimap */
  path(step = 6) {
    const out = [];
    for (let i = this.idx; i < this.route.pts.length; i += step) out.push(this.route.pts[i]);
    return out;
  }
}

function signalled(sig, dir, s0) { return sig.some((x) => x.dir === dir && x.s >= s0); }

/** A soft blue line on the road along the lesson route. */
function guideLine(pts) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    pos.push(pts[i].x + dz * 0.18, 0.045, pts[i].z - dx * 0.18, pts[i].x - dz * 0.18, 0.045, pts[i].z + dx * 0.18);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35aee2).multiplyScalar(1.4), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 2;
  return m;
}

// ---------- dev: a careful driver, to prove a clean drive scores zero faults ----------
/**
 * Returns { input, indicator, mirror } for one frame. state is a scratch object kept by the caller.
 * Drives the lane, signals and checks mirrors before every event, stops for red, the zebra,
 * give-way lines and roundabout traffic, and pulls up at the end.
 */
export function carefulDriver(run, car, st, bad = null) {
  const o = careful(run, car, st, bad || {});
  if (bad?.noSignals) o.indicator = null;
  if (bad?.noMirrors) o.mirror = false;
  return o;
}
function careful(run, car, st, bad) {
  const pts = run.route.pts, s = run.s, v = car.vF, mph = Math.abs(v) * MPH;
  st.t = (st.t || 0) + 1 / 60;
  const out = { input: { up: false, down: false, brake: false, steer: 0, run: false }, indicator: null, mirror: false };
  if (!st.ready) {
    // mirrors, signal right, wait a moment, go
    st.ready = st.t > 1.5;
    if (st.t > 0.2 && !st.mirrored) { st.mirrored = true; out.mirror = true; }
    out.indicator = 'right';
    return out;
  }
  const limit = run.world.speedLimitAt(car.pos.x, car.pos.z);
  let want = ((limit - 3) * (bad.speed || 1)) / MPH;
  if (s < 25) out.indicator = 'right';
  for (const e of run.events) {
    const ref = e.kind === 'rb' ? e.entryS : e.s;
    const ahead = ref - s;
    if (['turn', 'emerge', 'rb', 'pullup'].includes(e.kind)) {
      if (ahead < 95 && ahead > 0 && !e.botMirror) { e.botMirror = true; out.mirror = true; }
      const dir = e.kind === 'pullup' ? 'left' : e.dir;
      if (dir && dir !== 'none' && ahead < 70 && ahead > (e.kind === 'pullup' ? -60 : -6)) out.indicator = dir;
    }
    if (['turn', 'emerge', 'bend'].includes(e.kind) && ahead < 30 && ahead > -10) want = Math.min(want, 11 / MPH);
    if (e.kind === 'rb' && ahead < 35 && s < e.entryS + 40) want = Math.min(want, 13 / MPH);
    if (e.kind === 'emerge' && !bad.noStops) {
      const toLine = e.lineS - s;
      if (toLine < 25 && toLine > 0 && !e.botStopped) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
      if (toLine < 3 && mph < 0.5) e.botStopped = true;
      if (e.botStopped && s < e.s + 6) want = Math.min(want, 7 / MPH);
    }
    if (e.kind === 'rb') {
      const toLine = e.entryS + 1.7 - s;
      if (toLine > -0.5 && toLine < 12 && run.rbConflict({ pos: posAtS(run, e.entryS + 1.7) }, 32)) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
    }
    if (!bad.runReds && ((e.kind === 'lights' && run.world.lights.state !== 'green') || (e.kind === 'zebra' && run.world.zebra.busy))) {
      const toLine = e.s - s;
      if (toLine > -0.5 && toLine < 35) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
    }
    if (e.kind === 'pullup') {
      const toEnd = e.s - 12 - s;
      if (toEnd < 40) want = Math.min(want, Math.max(0, toEnd) * 0.35);
    }
  }
  // steering: pure pursuit on the lane centre (slightly toward the kerb when pulling up)
  const look = Math.min(pts.length - 1, run.idx + 4 + Math.round(Math.abs(v) / 2.5));
  const p = pts[look];
  const want_h = Math.atan2(p.x - car.pos.x, p.z - car.pos.z);
  let d = want_h - car.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  out.input.steer = THREE.MathUtils.clamp(-d * 2.2, -1, 1);
  if (v < want - 0.4) out.input.up = true;
  else if (v > want + 0.6) out.input.down = true;
  if (want < 0.05 && v < 0.6) { out.input.up = false; out.input.down = false; out.input.brake = true; }
  return out;
}
function posAtS(run, s) {
  const p = run.route.pts.find((q) => q.s >= s) || run.route.pts[run.route.pts.length - 1];
  return { x: p.x, z: p.z };
}
export { LANE };
