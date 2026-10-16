// The careful driver's feet for the learner car's gearbox. The route pilots in lessons.js decide a
// target speed (`want`, m/s) or reversing; these press the same keys a player would (W, S, Left Shift,
// 1-5 / R / 0 / 9, I, Space), so a clean autopilot run is a run a keyboard can do. Bad variants:
// stall (moves off with no gas), wrongGear (never changes up), coast (clutch down into junctions),
// handbrake (moves off with it on).
import { GEAR_K } from './vehicle.js';

const MPH = 2.23694, dt = 1 / 60;
const UP_AT = [0, 10, 17, 27, 38];     // mph: change up from gear k at UP_AT[k]
const DOWN_AT = [0, 0, 7, 13, 23, 34]; // mph: change down from gear k below DOWN_AT[k]
/** the gear for a speed, with a gap between the up and down points so it doesn't hunt */
export function gearFor(v, g) {
  const mph = Math.abs(v) * MPH; let t = typeof g === 'number' ? g : 1;
  while (t < 5 && mph >= UP_AT[t]) t++;
  while (t > 1 && mph < DOWN_AT[t]) t--;
  return t;
}
/** where a stopped car should be secured with the handbrake: a pull-up, the end, a drill */
function atPullUp(run) {
  const s = run.s;
  return !!run.drill || s > run.route.length - 70 || run.events.some((e) => (e.kind === 'stop' && Math.abs(e.s - s) < 30) || (e.kind === 'baypark' && s > e.s - 30));
}
const JUNCTION_KINDS = ['turn', 'emerge', 'rb', 'mini', 'cross'];
const controls = (o) => ({ up: false, down: false, steer: o.input.steer, brake: false, run: false, clutch: false, shift: null, ignition: false, pbrakeToggle: false });

export function pedalsManual(run, car, st, o, bad) {
  const c = feetManual(run, car, st, o, bad), d = car.drive, K = GEAR_K[d.gear] || 0;
  // never brake against an engaged clutch at low revs: that stalls it. Clutch first, brake next frame.
  if (c.down && d.engineOn && K && d.engaged > 0.05 && Math.abs(car.vF * K) < 1300 && !(run.drill === 'stall')) { c.clutch = true; c.down = false; c.up = false; }
  return c;
}
function feetManual(run, car, st, o, bad) {
  const d = car.drive, v = car.vF, c = controls(o);
  const P = st.ped || (st.ped = { hold: 0, released: false, shiftTo: null, stalls: d.stalls, badStall: false, pbDone: false, wasMoved: run.moved });
  const pedalDown = d.pedal >= 0.8, setPB = (on) => { if (d.parkingBrake !== on) c.pbrakeToggle = true; };
  const shiftTo = (g) => { if (d.gear === g) return true; c.clutch = true; if (pedalDown) c.shift = g; return false; };
  const rpmAt = (g) => Math.abs(v * (GEAR_K[g] || 0));
  if (run.moved && !P.wasMoved) P.badStall = false; // each move-off, the stalling driver stalls once
  P.wasMoved = run.moved;
  if (d.stalls !== P.stalls) { P.stalls = d.stalls; P.badStall = true; P.released = false; }
  const drill = run.drill;
  // engine off (stalled, or a lesson that starts with it off): footbrake, clutch down, neutral, the key
  if (!d.engineOn) {
    c.down = true; c.clutch = true; P.released = false;
    if (pedalDown && d.gear !== 'N') c.shift = 'N';
    if (pedalDown && d.crank <= 0 && drill !== 'stall') { c.ignition = true; setPB(true); }
    return c;
  }
  // the clutch control drills (LessonRun.drill)
  if (drill === 'bite') { // handbrake on, first, a little gas, clutch up to the bite, then back down
    setPB(true);
    if (!shiftTo(1)) return c;
    if (d.engaged > 0.25) P.bit = true;
    c.clutch = !!P.bit || d.rpm < 1300; c.up = !P.bit && d.rpm < 1600;
    return c;
  }
  if (drill === 'stall') { setPB(true); if (!shiftTo(1)) return c; return c; } // clutch up with no gas
  if (drill) { c.down = true; c.clutch = d.gear !== 'N'; return c; } // listening: stopped and secure
  P.bit = false;
  const want = Math.max(0, o.want ?? 0);

  // reversing (the pull up on the right): R, then the clutch at the bite for a slow walking pace
  if (o.reverse) {
    P.hold = 0;
    if (v > 0.3) { c.down = true; c.clutch = rpmAt(d.gear) < 1500; return c; }
    if (d.gear !== 'R') { c.down = true; shiftTo('R'); return c; }
    setPB(false);
    if (v < -1.4) { c.down = true; c.clutch = true; P.revGo = false; return c; }
    // as moving off: a little gas first, then the clutch up; if the revs die (something behind), clutch down again
    if (!P.revGo) { c.clutch = true; c.up = true; if (d.rpm > 1500) P.revGo = true; return c; }
    c.clutch = false; c.up = d.rpm < 1600;
    if (d.engaged > 0.2 && d.rpm < 900) { c.clutch = true; P.revGo = false; }
    return c;
  }
  // stopping and stopped (a target under walking pace is a stop: first gear can't go that slowly)
  if (want < 0.6 || (want < 1 && Math.abs(v) < 0.3)) {
    P.released = false; P.shiftTo = null;
    if (Math.abs(v) > 0.05) { P.hold = 0; c.down = true; c.clutch = d.gear !== 'N' && rpmAt(d.gear) < 1500; return c; }
    P.hold += dt;
    const secure = atPullUp(run) ? P.hold > 0.4 : P.hold > 6;
    if (secure) setPB(true);
    if (secure && d.parkingBrake) { if (d.gear !== 'N') { c.clutch = true; c.down = true; if (pedalDown) c.shift = 'N'; } return c; } // handbrake on, neutral, feet off
    c.down = !d.parkingBrake; c.clutch = d.gear !== 'N';
    return c;
  }
  P.hold = 0;
  // moving off, or crawling slower than first gear can idle
  if (Math.abs(v) < 1.0) {
    if (d.gear !== 1) { c.down = Math.abs(v) < 0.3; shiftTo(1); P.released = false; return c; }
    const noGas = bad.stall && !P.badStall;
    if (P.retry > 2) { P.waitT = (P.waitT || 0) + dt; c.clutch = true; c.down = true; if (P.waitT < 3) return c; P.retry = 0; P.waitT = 0; }
    if (!P.released && d.pedal > 0.6 && d.rpm < 1700 && !noGas) { c.clutch = true; c.up = true; c.down = !d.parkingBrake; return c; } // gas first
    P.released = true;
    c.up = noGas ? false : d.rpm < 2300;
    // the revs are dying (something in the way, too little gas): clutch back down before it stalls, and try again
    if (!noGas && d.engaged > 0.2 && d.rpm < 950) { c.clutch = true; P.released = false; P.retry = (P.retry || 0) + 1; }
    const holdPB = bad.handbrake && !P.pbDone;
    if (d.pedal < 0.7 && !holdPB) setPB(false); // at the bite: handbrake off
    if (bad.handbrake && Math.abs(v) > 0.6) P.pbDone = true;
    if (v > want + 0.6 && d.engaged > 0.9) { c.up = false; if (d.rpm > 1000) c.down = true; } // crawling: a touch of brake, never below idle
    return c;
  }
  if (bad.handbrake) P.pbDone = true;
  setPB(false);
  P.released = false; P.retry = 0;
  // driving: the gear for the speed, changed with the clutch; slowing to a stop: clutch down before it stalls
  const g = typeof d.gear === 'number' ? d.gear : 1;
  let tg = bad.wrongGear ? 1 : gearFor(v, g);
  const stopping = want < 3 && want < v - 1;
  if (stopping && typeof d.gear === 'number') tg = g; // brake in the gear you're in, then the clutch
  const rolling = stopping && rpmAt(g) < 1500;
  if (d.gear === 'N' || d.gear === 'R') tg = gearFor(v, 1);
  const coast = bad.coast && Math.abs(v) * MPH > 9 && run.events.some((e) => { const at = (e.lineS ?? e.entryS ?? e.s) - run.s; return JUNCTION_KINDS.includes(e.kind) && at < 70 && at > -5; });
  if (P.shiftTo == null && tg !== d.gear && !rolling && !coast) P.shiftTo = tg;
  if (P.shiftTo != null) { // clutch down, change, then let it up (the next frames)
    c.clutch = true;
    if (pedalDown) { c.shift = P.shiftTo; P.shiftTo = null; }
    c.down = v > want + 0.6;
    return c;
  }
  if (rolling || coast) { c.clutch = true; c.down = v > want + 0.6 || (coast && v > want - 0.5); return c; }
  c.up = d.engaged > 0.95 && v < want - 0.4;
  c.down = v > want + 0.6;
  if (c.down && rpmAt(g) < 1500) c.clutch = true;
  return c;
}

export function pedalsAuto(run, car, st, o, bad) {
  const d = car.drive, v = car.vF, c = controls(o);
  const P = st.ped || (st.ped = { hold: 0, pbDone: false });
  const setPB = (on) => { if (d.parkingBrake !== on) c.pbrakeToggle = true; };
  const drill = run.drill;
  if (!d.engineOn) { c.down = true; if (d.gear !== 'P' && d.gear !== 'N') c.shift = 'P'; else if (d.crank <= 0) c.ignition = true; return c; }
  // the automatic controls drills (LessonRun.drill)
  if (drill === 'select') { c.down = true; if (d.gear !== 'D') c.shift = 'D'; return c; }
  if (drill === 'creep') { setPB(false); if (d.gear !== 'D') { c.down = true; c.shift = 'D'; } c.down = v > 1.9; return c; } // off the brake, no gas
  if (drill === 'secureP') { c.down = true; setPB(true); if (d.parkingBrake && d.gear !== 'P') c.shift = 'P'; return c; }
  if (drill === 'reverse') { setPB(false); if (d.gear !== 'R') { c.down = true; if (v < 0.3) c.shift = 'R'; return c; } c.down = v < -1.3; return c; }
  if (drill) { c.down = true; return c; }
  if (o.reverse) {
    P.hold = 0;
    if (v > 0.3 || d.gear !== 'R') { c.down = true; if (v < 0.3) c.shift = 'R'; return c; }
    setPB(false);
    c.down = v < -0.95; // hold the creep back to walking pace: the reversing steering is tuned for about 1 m/s
    return c;
  }
  const want = Math.max(0, o.want ?? 0);
  if (want < 0.05 || (want < 0.3 && Math.abs(v) < 0.3)) {
    if (Math.abs(v) > 0.05) { P.hold = 0; c.down = true; return c; }
    P.hold += dt;
    const end = run.s > run.route.length - 70, secure = atPullUp(run) ? P.hold > 0.4 : P.hold > 6;
    if (secure) setPB(true);
    if (secure && d.parkingBrake) { const to = end ? 'P' : 'N'; if (d.gear !== to) { c.down = true; c.shift = to; } return c; }
    c.down = !d.parkingBrake || d.gear === 'D';
    return c;
  }
  P.hold = 0;
  if (d.gear !== 'D') { c.down = true; if (v > -0.8) c.shift = 'D'; return c; }
  if (!(bad.handbrake && !P.pbDone)) setPB(false);
  if (bad.handbrake && Math.abs(v) > 0.6) P.pbDone = true;
  c.up = v < want - 0.4;
  c.down = v > want + 0.6;
  return c;
}
