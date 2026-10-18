// The examiner that never clocks off: once you're driving anywhere in the game (not in a set
// lesson), this watches for the faults that don't need a planned route — speed, collisions, the
// gearbox — flashes each one as it happens, keeps a running tally, and gives a DVSA-style verdict
// when you pull over and get out. A lesson (LessonRun) marks the full route-based DL25 instead.

import { gearFor } from './pedals.js';

const SEV = { minor: 'Driving fault', serious: 'Serious fault', dangerous: 'Dangerous fault' };
const MPH = 1 / 1.609344;

export class FreeExam {
  constructor(hooks) { this.hooks = hooks; this.reset(); }
  reset() { this.t = 0; this.dist = 0; this.faults = []; this.cool = {}; this.timers = {}; this.lastStalls = null; this.lastGrinds = null; this.ccool = {}; this.ctimers = {}; }

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

  /** call every frame while free-driving a car (mode 'car', no lesson running) */
  update(dt, car, world, res) {
    this.t += dt;
    this.dist += Math.abs(car.vF) * dt;
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
