// The examiner that never clocks off: once you're driving anywhere in the game (not in a set
// lesson), this watches for the faults that don't need a planned route — speed, collisions, the
// gearbox — flashes each one as it happens, keeps a running tally, and gives a DVSA-style verdict
// when you pull over and get out. A lesson (LessonRun) marks the full route-based DL25 instead.

import { gearFor } from './pedals.js';

const SEV = { minor: 'Driving fault', serious: 'Serious fault', dangerous: 'Dangerous fault' };
const MPH = 1 / 1.609344;

export class FreeExam {
  constructor(hooks) { this.hooks = hooks; this.reset(); }
  reset() {
    this.t = 0; this.dist = 0; this.faults = []; this.cool = {}; this.timers = {}; this.lastStalls = null; this.lastGrinds = null; this.ccool = {}; this.ctimers = {};
    this.lightAlong = new Map(); // signal head -> last distance to its stop line (to catch the crossing)
    this.lane = null; this.lastSignal = { dir: null, t: -99 };
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

  /** call every frame while free-driving a car (mode 'car', no lesson running); ctx: { indicator } */
  update(dt, car, world, res, ctx = {}) {
    this.t += dt;
    this.dist += Math.abs(car.vF) * dt;
    this.redLights(car, world);
    this.laneDiscipline(car, world, ctx.indicator);
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
  /** call every frame while free-driving a manual: gentle guidance on gears and the engine */
  coach(dt, car) {
    const d = car.drive;
    if (!d || d.kind !== 'manual' || !d.engineOn || typeof d.gear !== 'number') return;
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
