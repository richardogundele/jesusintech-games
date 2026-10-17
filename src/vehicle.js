import * as THREE from 'three';
import { buildCar } from './models.js';
import { CARS } from './catalog.js';

const fwd = new THREE.Vector2();
const right = new THREE.Vector2();
const probe = new THREE.Vector3();

// ---------- the learner car's gearbox ----------
// Only a car whose spec has `trans` ('manual' | 'auto') gets one: every other car keeps the arcade
// longitudinal code below untouched. Units: rpm, m/s, Nm, kg. A small petrol hatch (a Polo).
const IDLE = 800, STALL_RPM = 380, REDLINE = 6500;
const MASS = 1150, IE = 0.15;            // car mass; engine + flywheel inertia (kg m2)
const RPM2W = Math.PI / 30;               // rpm -> rad/s
// engine rpm per m/s of road speed in each gear (final drive included): redline in 1st is 20 mph,
// 2nd 35, 3rd 50, 4th 65, 5th 125 (it runs out of power at about 105)
export const GEAR_K = { R: -760, N: 0, 1: 727, 2: 415, 3: 291, 4: 224, 5: 116 };
const CLUTCH_NM = 240;                    // what a fully engaged clutch can carry
const FOOTBRAKE = 9, PBRAKE = 3;          // m/s2: a firm stop; a handbrake on the back wheels
const lerpTable = (t, x) => { if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); } return t[t.length - 1][1]; };
const TORQUE = [[0, 40], [800, 70], [1500, 95], [2500, 112], [4500, 112], [6000, 96], [7000, 78]];
const tFull = (rpm) => lerpTable(TORQUE, rpm);
const tFric = (rpm) => (rpm > 1 ? 8 + 0.0045 * rpm : 0); // pumping and friction: engine braking
/** clutch engagement from the pedal (1 = floored): free above 0.72, the bite between 0.72 and 0.2, home below.
 *  A wide, forgiving bite band so the biting point is easy to find and hold while learning. */
export const engagement = (p) => (p >= 0.72 ? 0 : p <= 0.2 ? 1 : ((t) => t * t * (3 - 2 * t))((0.72 - p) / 0.52));
/** rolling resistance and air drag as an acceleration (m/s2), against v */
const resist = (v) => (Math.abs(v) > 0.05 ? -Math.sign(v) * 0.15 : 0) - 0.00035 * v * Math.abs(v);
/** the throttle eases in and out, so a held W key is a squeeze, not a stamp */
const easeThrottle = (thr, input, dt) => { const t = input.throttle ?? (input.up ? 1 : 0); return t > thr ? Math.min(t, thr + 1.5 * dt) : Math.max(t, thr - 4 * dt); };
/** brakes only ever slow the car (to a standstill, never past it) */
function brakeTo(v, decel, dt) { const d = decel * dt; return Math.abs(v) <= d ? 0 : v - Math.sign(v) * d; }

class Drivetrain {
  constructor() {
    this.engineOn = false; this.stalled = false; this.parkingBrake = true; this.throttle = 0; this.rpm = 0;
    this.crank = 0; this.t = 0; this.stalls = 0; this.grinds = 0; this.msg = null;
    this.flags = { coasting: false, labouring: false, overRev: false, grind: false, stalledAt: null };
  }
  /** a message for the HUD (a refused gear, how to restart); main.js toasts each new one */
  say(text) { this.msg = { text, t: this.t }; }
  /** started at a lesson: running or not, handbrake on, out of gear */
  prepare({ engineOn = true, parkingBrake = true } = {}) {
    this.engineOn = engineOn; this.stalled = false; this.rpm = engineOn ? IDLE : 0; this.crank = 0;
    this.parkingBrake = parkingBrake; this.throttle = 0; this.locked = false; this.gear = this.neutral;
  }
  get clutch() { return 0; }
}

class Manual extends Drivetrain {
  constructor() { super(); this.kind = 'manual'; this.neutral = 'N'; this.gear = 'N'; this.pedal = 0; this.locked = false; }
  get clutch() { return this.pedal; }
  get engaged() { return engagement(this.pedal); }
  ignition(v) {
    if (this.crank > 0) return;
    if (this.engineOn) { if (Math.abs(v) < 1) { this.engineOn = false; this.keyOff = true; } return; }
    if (this.gear !== 'N' && this.pedal < 0.75) return this.say('Clutch down or select neutral before you start the engine');
    this.crank = 0.6; this.stalled = false;
  }
  select(g, v) {
    if (g === 'D') g = 1; // the auto's Drive key in a manual is first
    if (g === 'P') g = 'N';
    if (g === this.gear) return;
    if (this.pedal < 0.75) { this.flags.grind = true; this.grinds++; return this.say('Crunch! Clutch down (Shift) before you change gear'); }
    if (g === 'R' && v > 0.8) { this.flags.grind = true; this.grinds++; return this.say('Stop before you select reverse'); }
    if (typeof g === 'number' && v < -0.8) return this.say('Stop before you select a forward gear');
    this.gear = g; this.locked = false;
  }
  step(dt, input, v) {
    this.t += dt;
    this.flags.grind = false;
    if (input.pbrakeToggle) this.parkingBrake = !this.parkingBrake;
    if (input.ignition) this.ignition(v);
    if (input.shift != null) this.select(input.shift, v);
    // the pedal goes down fast; comes up at a steady rate, much slower through the wide bite so it's easy to hold
    if (input.clutch) this.pedal = Math.min(1, this.pedal + 7 * dt);
    else this.pedal = Math.max(0, this.pedal - (this.pedal > 0.2 && this.pedal < 0.72 ? 0.5 : 1.875) * dt);
    this.throttle = easeThrottle(this.throttle, input, dt);
    // engine torque: the idle control keeps it ticking over at about 800, but it can't pull the car on its own
    let Te;
    if (this.crank > 0) {
      this.crank -= dt; this.rpm += (250 - this.rpm) * Math.min(1, dt * 10); Te = 0;
      if (this.crank <= 0) { this.engineOn = true; this.rpm = Math.max(this.rpm, 1000); this.keyOff = false; }
    } else if (this.engineOn) {
      let thr = this.throttle;
      if (this.rpm < 1200) thr = Math.max(thr, Math.min(0.3, Math.max(0, 0.16 + (850 - this.rpm) * 0.0008)));
      if (this.rpm > REDLINE) thr = 0; // the rev limiter
      Te = thr * tFull(this.rpm) - tFric(this.rpm);
    } else Te = -(tFric(this.rpm) + (this.rpm > 30 ? 25 : 0)); // a dead engine: friction and compression
    const K = GEAR_K[this.gear] || 0, eng = this.engaged, a0 = resist(v);
    if (!K || eng <= 0) {
      // out of gear or clutch down: the engine spins on its own, the car rolls
      this.locked = false;
      this.rpm = Math.max(0, this.rpm + (Te / IE / RPM2W) * dt);
      v += a0 * dt;
    } else {
      const kw = K * RPM2W, Ic = MASS / (kw * kw), wc = v * K, Tcap = CLUTCH_NM * eng;
      const Text = (MASS * a0) / kw; // drag felt at the crank
      let done = false;
      if (this.locked && Math.abs(this.rpm - wc) < 200) {
        const alpha = (Te + Text) / (IE + Ic), Treq = Te - IE * alpha;
        if (Math.abs(Treq) <= Tcap) { this.rpm = wc + (alpha / RPM2W) * dt; v = this.rpm / K; done = true; }
      }
      if (!done) {
        const sg = Math.sign(this.rpm - wc) || Math.sign(Te) || 1, Tc = Tcap * sg;
        const rpmN = this.rpm + ((Te - Tc) / IE / RPM2W) * dt, vN = v + ((Tc * kw) / MASS + a0) * dt, wcN = vN * K;
        if (Math.sign(rpmN - wcN) !== sg && Math.sign(rpmN - wcN) !== 0) {
          // the plates have caught up: lock them together, sharing their momentum
          const w = (IE * rpmN + Ic * wcN) / (IE + Ic);
          this.rpm = w; v = w / K; this.locked = true;
        } else { this.rpm = rpmN; v = vN; this.locked = false; }
      }
    }
    // the brakes, then a locked engine follows the wheels down (brake to a stop in gear and it stalls)
    v = brakeTo(v, (input.down ? FOOTBRAKE : 0) + (this.parkingBrake ? PBRAKE : 0), dt);
    if (this.locked && K) this.rpm = v * K;
    this.rpm = Math.max(0, this.rpm);
    if (this.engineOn && this.crank <= 0 && this.rpm < STALL_RPM) {
      this.engineOn = false; this.stalled = true; this.stalls++; this.flags.stalledAt = this.t;
      this.say('Stalled. Clutch down, select neutral (0), then press I to restart');
    }
    const f = this.flags, moving = Math.abs(v) > 0.5, inGear = K !== 0 && eng > 0.9;
    f.coasting = moving && (this.gear === 'N' || this.pedal > 0.6);
    f.labouring = this.engineOn && inGear && moving && this.rpm < 1100 && this.throttle > 0.15;
    f.overRev = this.engineOn && this.rpm > 5800;
    return v;
  }
}

// a torque-converter automatic: P R N D, creeps at about 3.5 mph off the brake, never stalls
const AUTO_SHIFT = [0, 4.5, 8, 12, 17, 23]; // m/s where it changes up to gears 2..6
const AUTO_K = [600, 380, 270, 205, 160, 125];
class Auto extends Drivetrain {
  constructor() { super(); this.kind = 'auto'; this.neutral = 'P'; this.gear = 'P'; this.ratio = 1; }
  ignition(v) {
    if (this.crank > 0) return;
    if (this.engineOn) { if (Math.abs(v) < 1) { this.engineOn = false; this.keyOff = true; } return; }
    if (this.gear !== 'P' && this.gear !== 'N') return this.say('Select P (9) or N (0) before you start the engine');
    this.crank = 0.5; this.stalled = false;
  }
  select(g, v) {
    if (typeof g === 'number') g = 'D';
    if (g === this.gear) return;
    if (g === 'P' && Math.abs(v) > 0.5) return this.say('Stop before you select P');
    if (g === 'R' && v > 0.8) return this.say('Stop before you select reverse');
    if (g === 'D' && v < -0.8) return this.say('Stop before you select drive');
    this.gear = g;
  }
  step(dt, input, v) {
    this.t += dt;
    if (input.pbrakeToggle) this.parkingBrake = !this.parkingBrake;
    if (input.ignition) this.ignition(v);
    if (input.shift != null) this.select(input.shift, v);
    this.throttle = easeThrottle(this.throttle, input, dt);
    if (this.crank > 0) { this.crank -= dt; if (this.crank <= 0) { this.engineOn = true; this.rpm = 1000; this.keyOff = false; } }
    let a = resist(v);
    const dir = this.gear === 'D' ? 1 : this.gear === 'R' ? -1 : 0, run = this.engineOn && this.crank <= 0;
    if (run && dir) {
      const fwdV = dir * v;
      a += dir * 1.25 * Math.min(1, Math.max(0, (1.85 - fwdV) / 1.85)); // creep
      a += dir * this.throttle * Math.min(3.4, 42 / (Math.max(0, fwdV) + 4)) * (dir < 0 ? 0.6 : 1);
      if (this.throttle < 0.05 && fwdV > 1.85) a -= dir * 0.3; // a little engine braking
    }
    v += a * dt;
    v = brakeTo(v, (input.down ? FOOTBRAKE : 0) + (this.parkingBrake ? PBRAKE : 0) + (this.gear === 'P' ? 8 : 0), dt);
    // the rev counter: a six-speed shift pattern over a converter that slips at low speed
    let g = 0; while (g < 5 && Math.abs(v) > AUTO_SHIFT[g + 1] * (0.7 + this.throttle * 0.5)) g++;
    this.ratio = g + 1;
    const target = !run ? 0 : dir ? Math.max(IDLE - 80 * (dir !== 0) + this.throttle * 1600, Math.abs(v) * AUTO_K[g] + this.throttle * 300) : IDLE + this.throttle * 5000;
    this.rpm += (Math.min(REDLINE, target) - this.rpm) * Math.min(1, dt * (run ? 8 : 3));
    const f = this.flags;
    f.coasting = Math.abs(v) > 0.5 && this.gear === 'N'; f.labouring = false; f.overRev = false; f.grind = false;
    return v;
  }
}

/**
 * Arcade car: velocity is a world-space vector, decomposed every frame into forward
 * and lateral parts. Lateral grip bleeds off sideways slip; the handbrake drops grip,
 * which is what lets the car drift. A car with `spec.trans` drives through a real
 * gearbox instead (Manual / Auto above): its Space is a parking brake, not a drift button.
 */
export class Car {
  constructor(id, { x, z, heading }, spec = CARS[id]) {
    this.id = id;
    this.spec = spec;
    this.model = buildCar(this.spec);
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.vel = new THREE.Vector2();
    this.vF = 0;
    this.steer = 0;
    this.accelSmoothed = 0;
    this.wheelbase = this.model.length * 0.6;
    this.drive = spec.trans ? (spec.trans === 'manual' ? new Manual() : new Auto()) : null;
    this.sync(0);
  }

  get name() { return `${this.spec.maker} ${this.spec.model}`; }
  get speedKmh() { return Math.abs(this.vF) * 3.6; }
  // the gearbox, for the HUD, the lessons and the autopilot (arcade cars read as a plain automatic in D)
  get trans() { return this.drive ? this.drive.kind : 'auto'; }
  get gear() { return this.drive ? this.drive.gear : 'D'; }
  get rpm() { return this.drive ? this.drive.rpm : 0; }
  get clutch() { return this.drive ? this.drive.clutch : 0; }
  get stalled() { return !!this.drive?.stalled; }
  get engineOn() { return this.drive ? this.drive.engineOn : true; }
  get parkingBrake() { return !!this.drive?.parkingBrake; }
  get flags() { return this.drive ? this.drive.flags : { coasting: false, labouring: false, overRev: false, grind: false, stalledAt: null }; }
  /** swap the learner car between a manual and an automatic, keeping it parked and secured */
  setTrans(kind) {
    if (!this.drive || this.drive.kind === kind) return;
    const was = this.drive;
    this.drive = kind === 'manual' ? new Manual() : new Auto();
    this.drive.prepare({ engineOn: false, parkingBrake: true });
    this.drive.t = was.t;
  }

  update(dt, input, world) {
    const s = this.spec;
    const top = s.topSpeed / 3.6;
    fwd.set(Math.sin(this.heading), Math.cos(this.heading));
    right.set(Math.cos(this.heading), -Math.sin(this.heading));
    let vF = this.vel.dot(fwd);
    let vR = this.vel.dot(right);
    const prevVF = vF;
    const drift = !this.drive && input.brake; // the learner car's Space is its parking brake

    if (this.drive) vF = this.drive.step(dt, input, vF);
    else {
    // throttle / brake / reverse
    if (input.up) {
      if (vF < -0.5) vF += 24 * dt;
      else vF += s.accel * Math.max(0, 1 - (vF / top) ** 2) * dt;
    }
    if (input.down) {
      if (vF > 0.5) vF -= 26 * dt;
      else vF = Math.max(-14, vF - s.accel * 0.5 * dt);
    }
    if (!input.up && !input.down) {
      const coast = (1.4 + 0.00035 * vF * vF) * dt;
      vF = Math.abs(vF) <= coast ? 0 : vF - Math.sign(vF) * coast;
    }
    if (input.brake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 6 * dt);
    }

    // steering: less lock at speed so it stays controllable at 300 km/h.
    // Turn the wheel in gently (so keyboard steering isn't twitchy) and let it unwind a little quicker.
    const speedFactor = 1 - 0.6 * Math.min(1, Math.abs(vF) / 70);
    const target = input.steer * s.steer * speedFactor;
    const rate = Math.abs(target) > Math.abs(this.steer) ? 4 : 6.5;
    this.steer += (target - this.steer) * Math.min(1, dt * rate);

    // lateral grip
    const grip = drift ? s.grip * 0.12 : s.grip;
    vR *= Math.exp(-grip * dt);

    this.vel.set(fwd.x * vF + right.x * vR, fwd.y * vF + right.y * vR);

    // yaw (positive steer = right = heading decreases)
    let yaw = (vF / this.wheelbase) * Math.tan(this.steer);
    // cap yaw by what the tyres can hold (lateral accel = v * yaw)
    const maxYaw = (s.grip * 3) / Math.max(4, Math.abs(vF));
    yaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
    if (drift && Math.abs(vF) > 8) yaw *= 1.6;
    this.heading -= yaw * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // collisions: two circles (front + rear) against the world boxes
    const r = this.model.width * 0.55;
    let hit = false, impact = 0;
    for (const off of [this.model.length * 0.28, -this.model.length * 0.28]) {
      probe.set(this.pos.x + fwd.x * off, 0, this.pos.z + fwd.y * off);
      const before = probe.clone();
      const n = world.colliders.resolve(probe, r, true);
      if (n.lengthSq() > 0) {
        this.pos.x += probe.x - before.x;
        this.pos.z += probe.z - before.z;
        n.normalize();
        const into = this.vel.dot(n);
        if (into < 0) {
          const speed = Math.abs(into);
          // a real impact: cancel the speed going into the wall (no bounce) and bleed the rest —
          // a solid hit brings you to a near stop, a graze just scrubs some speed off
          this.vel.addScaledVector(n, -into);
          this.vel.multiplyScalar(speed > 3 ? 0.18 : 0.6);
          hit = speed > 4;
          impact = Math.max(impact, speed);
        }
      }
    }
    const b = world.bounds;
    if (this.pos.x < b.minX || this.pos.x > b.maxX) { this.pos.x = THREE.MathUtils.clamp(this.pos.x, b.minX, b.maxX); this.vel.x *= -0.3; }
    if (this.pos.z < b.minZ || this.pos.z > b.maxZ) { this.pos.z = THREE.MathUtils.clamp(this.pos.z, b.minZ, b.maxZ); this.vel.y *= -0.3; }

    this.vF = this.vel.dot(fwd);
    const accel = (this.vF - prevVF) / Math.max(dt, 1e-4);
    this.accelSmoothed += (accel - this.accelSmoothed) * Math.min(1, dt * 6);
    this.slip = Math.abs(vR);
    this.sync(dt);
    return { hit, impact };
  }

  park() {
    this.vel.set(0, 0);
    this.vF = 0;
    this.steer = 0;
    this.accelSmoothed = 0;
    this.slip = 0;
    if (this.drive) this.drive.locked = false; // a teleport: the engine isn't dragged to zero with the wheels
    this.sync(0);
  }
  /** at a lesson start: engine running (or not), handbrake on, in neutral / P */
  prepare(opts) { this.drive?.prepare(opts); }

  sync(dt) {
    const { root, body, wheels, wheelR } = this.model;
    root.position.copy(this.pos);
    root.rotation.y = this.heading;
    // body roll + pitch for weight transfer
    const roll = THREE.MathUtils.clamp(-this.steer * this.vF * 0.006, -0.06, 0.06);
    const pitch = THREE.MathUtils.clamp(-this.accelSmoothed * 0.004, -0.04, 0.04);
    body.rotation.z += (roll - body.rotation.z) * Math.min(1, dt * 6);
    body.rotation.x += (pitch - body.rotation.x) * Math.min(1, dt * 6);
    for (const w of wheels) {
      w.spin.rotation.x += (w.spinSign ?? 1) * (this.vF / wheelR) * dt;
      if (w.front) w.pivot.rotation.y = -this.steer;
    }
  }
}
