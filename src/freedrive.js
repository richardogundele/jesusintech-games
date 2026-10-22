// The examiner that never clocks off: once you're driving anywhere in the game (not in a set
// lesson), this watches for the faults that don't need a planned route — speed, collisions, the
// gearbox — flashes each one as it happens, keeps a running tally, and gives a DVSA-style verdict
// when you pull over and get out. A lesson (LessonRun) marks the full route-based DL25 instead.

import { gearFor } from './pedals.js';

// the streets signs-place.js puts a one-way plate and a No Entry on; keep the two in step, or the
// examiner marks a street the game never signed
const ONE_WAY_CLS = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary']);

const SEV = { minor: 'Driving fault', serious: 'Serious fault', dangerous: 'Dangerous fault' };
const MPH = 1 / 1.609344;

export class FreeExam {
  constructor(hooks) { this.hooks = hooks; this.reset(); }
  reset() {
    this.t = 0; this.dist = 0; this.faults = []; this.cool = {}; this.timers = {}; this.lastStalls = null; this.lastGrinds = null; this.ccool = {}; this.ctimers = {};
    this.lightAlong = new Map(); // signal head -> last distance to its stop line (to catch the crossing)
    this.lane = null; this.lastSignal = { dir: null, t: -99 };
    this.rollBack = 0; this.rollMarked = 0; // metres rolled back on a hill since you last moved off
    // the routines an instructor drills: MSM, MSPSL and POM. Everything here keys off when you
    // last actually looked (Q), so the order you do things in is what gets coached.
    this.mirrorAt = -99;        // when you last checked your mirrors
    this.indOn = null;          // the indicator as of last frame, to catch the moment it comes on
    this.indSeeded = false;     // an indicator already on when a drive starts is not a fresh signal
    this.wasStopped = true;
    this.movedOffAt = -99;
    this.taughtMirror = false;  // only mark a mirrors fault once you have been told the routine
    this.jnAt = -99; this.jn = null; // the junction ahead, looked up on a throttle
    this.wrongDist = 0; this.taughtOneWay = false; // metres driven against a one-way street
  }

  get counts() {
    const c = { minor: 0, serious: 0, dangerous: 0 };
    for (const f of this.faults) c[f.sev]++;
    return c;
  }
  fault(sev, cat, coolKey = cat, cooldown = 6) {
    if (this.cool[coolKey] > this.t) return;
    this.cool[coolKey] = this.t + cooldown;
    this.faults.push({ sev, cat, t: this.t });
    this.hooks.flash(`${SEV[sev]}: ${cat}`, sev);
  }
  held(key, cond, dt, secs) { this.timers[key] = cond ? (this.timers[key] || 0) + dt : 0; return this.timers[key] > secs; }

  /** call every frame while free-driving a car (mode 'car', no lesson running); ctx: { indicator, mirrorPressed } */
  update(dt, car, world, res, ctx = {}) {
    this.t += dt;
    this.dist += Math.abs(car.vF) * dt;
    if (ctx.mirrorPressed) this.mirrorAt = this.t;
    this.redLights(car, world);
    this.laneDiscipline(car, world, ctx.indicator);
    // hill starts: rolling back on an upslope. A little is a driving fault, a lot is serious.
    const grade = car.grade || 0;
    if (grade > 0.03 && car.vF < -0.15) this.rollBack += -car.vF * dt;
    else if (car.vF > 1) { this.rollBack = 0; this.rollMarked = 0; }
    if (this.rollBack > 1.5 && this.rollMarked < 2) { this.rollMarked = 2; this.fault('serious', 'Control: rolled back a long way on a hill start', 'rollback', 8); }
    else if (this.rollBack > 0.5 && this.rollMarked < 1) { this.rollMarked = 1; this.fault('minor', 'Control: rolled back on a hill start', 'rollback', 8); }
    const mph = car.speedKmh * MPH;
    // the limit at the car, or a sensible 30 where a world doesn't post one
    const limit = world.speedLimitAt?.(car.pos.x, car.pos.z) ?? 30;
    if (this.held('fast', mph > limit + 2, dt, 1.2)) this.fault('minor', `Speed (over ${Math.round(limit)})`, 'speed', 10);
    if (this.held('vfast', mph > limit + 10, dt, 0.8)) this.fault('serious', 'Speed (well over the limit)', 'vspeed', 12);
    // collisions (impact comes from the car's crash response)
    if (res?.impact > 6) this.fault('dangerous', 'Control: collision', 'crash', 3);
    else if (res?.hit || res?.impact > 3) this.fault('serious', 'Control: hit something', 'hit', 3);
    // the learner gearbox: stalling, crunching gears, over-revving
    const d = car.drive;
    if (d) {
      if (this.lastStalls != null && d.stalls > this.lastStalls) this.fault('minor', 'Control: stalled', 'stall', 2);
      this.lastStalls = d.stalls;
      if (this.lastGrinds != null && d.grinds > this.lastGrinds) this.fault('minor', 'Control: gears (crunched)', 'grind', 2);
      this.lastGrinds = d.grinds;
      if (this.held('rev', !!d.flags?.overRev, dt, 1.0)) this.fault('minor', 'Control: over-revving', 'rev', 8);
    }
  }
  // ---- traffic lights: crossing the stop line on red (or red+amber) is a serious fault ----
  redLights(car, world) {
    const heads = world.signalHeads?.();
    if (!heads) return;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), v = Math.abs(car.vF);
    for (const h of heads) {
      const ay = h.yaw ?? h.heading;
      if (ay == null) continue;
      let da = Math.abs(ay - car.heading) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
      const dx = h.x - car.pos.x, dz = h.z - car.pos.z;
      const along = dx * fx + dz * fz - 2, side = Math.abs(dx * fz - dz * fx);
      if (da > 0.7 || side > 8 || along > 80 || along < -30) { this.lightAlong.delete(h); continue; }
      const prev = this.lightAlong.get(h);
      if (prev != null && prev > 0 && along <= 0 && v > 0.8 && (h.state === 'red' || h.state === 'redamber')) {
        this.fault('serious', 'Response to signals: traffic lights (went through a red)', 'red', 6);
      }
      this.lightAlong.set(h, along);
    }
  }
  // ---- lane discipline: moving into another lane without indicating that way is a driving fault ----
  laneDiscipline(car, world, indicator) {
    if (indicator) this.lastSignal = { dir: indicator, t: this.t };
    const L = world.laneAt?.(car.pos.x, car.pos.z, car.heading);
    if (!L) { this.lane = null; return; }
    if (!L.centred) return; // only count a change once you're settled in the new lane
    const prev = this.lane;
    this.lane = { road: L.road, lane: L.lane };
    if (!prev || prev.road !== L.road || prev.lane === L.lane || Math.abs(car.vF) < 3) return;
    const dir = L.lane > prev.lane ? 'right' : 'left'; // lane numbers rise to the driver's right
    const signalled = this.lastSignal.dir === dir && this.t - this.lastSignal.t < 5;
    if (!signalled) this.fault('minor', `Signals: necessary (changed lane ${dir} without indicating)`, 'lanesig', 6);
  }

  // ---- the instructor: real-world manual coaching, told as tips, not marked as faults ----
  cHeld(key, cond, dt, secs) { this.ctimers[key] = cond ? (this.ctimers[key] || 0) + dt : 0; return this.ctimers[key] > secs; }
  tip(text, key = text, cooldown = 6) {
    if (this.ccool[key] > this.t) return;
    this.ccool[key] = this.t + cooldown;
    this.hooks.tip?.(text);
  }
  /**
   * The next junction you will reach along the road you are on, if it is close.
   * Cheap: one nearest() plus a walk of that way's own node list, throttled to 4 Hz.
   */
  junctionAhead(car, world) {
    if (this.t - this.jnAt < 0.25) return this.jn;
    this.jnAt = this.t;
    this.jn = null;
    const net = world && world.net;
    if (!net || !net.nearest) return null;
    const h = net.nearest(car.pos.x, car.pos.z, 18);
    if (!h) return null;
    const w = h.way;
    // travelling with the way's direction, or against it?
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const along = h.dir[0] * fx + h.dir[1] * fz >= 0 ? 1 : -1;
    for (let k = 0; k < w.nodes.length; k++) {
      const i = along > 0 ? k : w.nodes.length - 1 - k;
      const nid = w.nodes[i];
      if (!nid) continue;
      const ds = (w.cum[i] - h.s) * along;
      if (ds <= 3) continue;
      if (ds > 80) break;
      const node = net.nodes.get(nid);
      if (node && (node.kind === 'junction' || node.rb)) { this.jn = { dist: ds, node, rb: !!node.rb }; break; }
    }
    return this.jn;
  }

  /**
   * The routines, drilled the way an instructor drills them. These are tips, not marks, with one
   * exception: signalling without looking first is a real DL25 line (Mirrors: signalling), and it
   * is only ever marked AFTER you have been told the routine at least once.
   *   MSM    mirror, signal, manoeuvre        - every change of speed or direction
   *   MSPSL  mirror, signal, position, speed, look - approaching a junction
   *   POM    prepare, observe, move           - moving off
   */
  routines(dt, car, world, ctx = {}) {
    const mph = car.speedKmh * MPH, v = car.vF;
    const sinceMirror = this.t - this.mirrorAt;
    const fresh = sinceMirror < 4; // a check still counts as "just looked" for four seconds

    // ---- POM: moving off ----
    const stopped = Math.abs(v) < 0.4;
    if (this.wasStopped && v > 1.2) {
      this.wasStopped = false;
      this.movedOffAt = this.t;
      if (!fresh) {
        this.taughtMirror = true;
        this.tip('Moving off: mirrors, signal, then a blind spot check over your shoulder before you go. Q checks your mirrors.', 'pom', 14);
      }
    } else if (stopped) this.wasStopped = true;

    // ---- MSM: the mirror comes before the signal ----
    // Seed on the first frame: an indicator that was already on when the drive began (or when the
    // examiner reset) is not you signalling, and must not be marked as one.
    const ind = ctx.indicator || null;
    if (!this.indSeeded) { this.indSeeded = true; this.indOn = ind; }
    else if (ind && ind !== this.indOn) {
      if (!fresh) {
        if (this.taughtMirror) this.fault('minor', 'Mirrors: signalling (signalled without checking first)', 'mirrorsig', 10);
        this.taughtMirror = true;
        this.tip('Mirror first, then signal — mirror, signal, manoeuvre, every time.', 'msm', 10);
      }
    }
    this.indOn = ind;

    // ---- MSM: the mirror comes before slowing down ----
    if (this.cHeld('slowing', v > 4 && car.accelSmoothed < -2.2 && !fresh, dt, 0.5)) {
      this.taughtMirror = true;
      return this.tip('Check your mirror before you slow down — someone may be close behind.', 'msmslow', 12);
    }

    // ---- the wrong way down a one-way street ----
    // Only on the streets signs-place.js actually signs, and only once you have clearly committed:
    // 15 m of driving with the nose pointed against the flow. Without that a crossroads can snap
    // nearest() to the one-way road you are crossing at right angles and mark you for crossing it.
    const net = world && world.net;
    if (net && net.nearest && Math.abs(v) > 2) {
      const h = net.nearest(car.pos.x, car.pos.z, 12);
      const w2 = h && h.way;
      const signed = w2 && w2.oneway && !w2.rb && !w2.link && !w2.dual && !w2.nsl
        && w2.limit <= 40 && ONE_WAY_CLS.has(w2.cls) && w2.len >= 25;
      // the dot is against the way's own direction; the sign of vF handles driving in reverse
      const facing = signed ? (h.dir[0] * Math.sin(car.heading) + h.dir[1] * Math.cos(car.heading)) * Math.sign(v) : 0;
      if (signed && facing < -0.7) {
        this.wrongDist += Math.abs(v) * dt;
        if (this.wrongDist > 15) {
          this.wrongDist = 0;
          if (!this.taughtOneWay) {
            this.taughtOneWay = true;
            return this.tip('This is a one-way street and you are going against it. Turn around as soon as it is safe — look for the No Entry sign at the far end.', 'oneway', 25);
          }
          this.fault('serious', 'Response to signs: traffic signs (wrong way along a one-way street)', 'wrongway', 20);
        }
      } else this.wrongDist = 0;
    } else this.wrongDist = 0;

    // ---- the edge of the map ----
    // Richard drove the A299 for a mile looking for Manchester. The map ends; nothing said so.
    const B = world && world.bounds;
    if (B && Math.abs(v) > 3) {
      const toEdge = Math.min(car.pos.x - B.minX, B.maxX - car.pos.x, car.pos.z - B.minZ, B.maxZ - car.pos.z);
      if (toEdge < 160) return this.tip('The map ends just ahead. To drive to another city, go to the jet centre and pick "By road" at the terminal.', 'edge', 30);
    }

    // ---- a speed hump coming up ----
    // Humps are on the residential streets where most of the driving happens, so this is the tip a
    // learner meets most often. Only speaks if you are still carrying speed at it.
    if (net && net.calmingByWay && net.calmingByWay.size && mph > 22) {
      const h = net.nearest(car.pos.x, car.pos.z, 14);
      const list = h && net.calmingByWay.get(h.way.id);
      if (list) {
        const fwd = h.dir[0] * Math.sin(car.heading) + h.dir[1] * Math.cos(car.heading) >= 0 ? 1 : -1;
        for (const cm of list) {
          const ahead = (cm.s - h.s) * fwd;
          if (ahead > 4 && ahead < 45) {
            return this.tip(cm.kind === 'cushion'
              ? 'Speed cushions ahead — ease off and straddle them, you do not need to brake hard.'
              : 'Speed hump ahead — slow down before it, not on it.', 'hump', 14);
          }
        }
      }
    }

    // ---- MSPSL: approaching a junction ----
    const j = this.junctionAhead(car, world);
    if (j && mph > 6 && j.dist < 55) {
      if (j.rb) return this.tip('Roundabout coming up: mirror, signal for your exit, get into the right lane, and slow enough to give way to the right.', 'mspsl', 16);
      return this.tip('Junction ahead: Mirror, Signal, Position, Speed, Look. Look is the last thing you do, and the most important.', 'mspsl', 16);
    }
    return undefined;
  }

  /** call every frame while free-driving a manual: gentle guidance on gears and the engine */
  coach(dt, car, world = null, ctx = {}) {
    const d = car.drive;
    if (!d || !d.engineOn) return;
    // the routines come first: they apply in an automatic too
    if (world && this.routines(dt, car, world, ctx)) return;
    // stopped facing uphill: the hill-start routine (handbrake, bite, then release as it pulls)
    if (this.cHeld('hill', (car.grade || 0) > 0.03 && Math.abs(car.vF) < 0.3, dt, 1.2)) {
      return this.tip(d.kind === 'manual'
        ? 'Hill start: handbrake on (Space), first gear, a little gas (W), let the clutch (Shift) up to the bite — then Space off as the car tries to pull'
        : 'Hill start: hold it on the brake, select Drive, then move your foot to the gas — it won’t roll back', 'hill', 12);
    }
    if (d.kind !== 'manual' || typeof d.gear !== 'number') return;
    const g = d.gear, mph = car.speedKmh * MPH, ideal = gearFor(car.vF, g), f = d.flags || {};
    if (this.cHeld('rev', !!f.overRev, dt, 0.7)) return this.tip(`Change up to ${Math.min(5, g + 1)} — you're over-revving`, 'gear', 5);
    if (this.cHeld('lab', !!f.labouring, dt, 0.7)) return this.tip(`Change down to ${Math.max(1, g - 1)} — the engine's labouring`, 'gear', 5);
    if (this.cHeld('up', ideal > g && mph > 1, dt, 0.8)) return this.tip(`Ready for ${ideal}${ideal === 2 ? 'nd' : ideal === 3 ? 'rd' : 'th'} — ease off, clutch in, change up`, 'gear', 7);
    if (this.cHeld('down', ideal < g && mph > 1, dt, 0.8)) return this.tip(`Change down to ${ideal} for this speed`, 'gear', 7);
  }

  /** a DVSA-style verdict for the drive so far: a pass is <=15 driving faults and none serious/dangerous */
  result() {
    const c = this.counts;
    return { ...c, passed: c.serious === 0 && c.dangerous === 0 && c.minor <= 15, dist: this.dist, t: this.t, faults: this.faults };
  }
}
