// Checkpoint time trials on the real road network. Medal times were set by driving them.
import * as THREE from 'three';
import { state, save, addFunds } from './state.js';
import { emit } from './progress.js';

export const MEDAL_PAY = { gold: 1_500_000, silver: 750_000, bronze: 300_000 };

// path(world) -> checkpoints (Vector3) ending at the finish; start = { x, z, heading }
const DEFS = {
  monaco: [{
    id: 'monaco-loop',
    name: 'Monte Carlo Grand Loop',
    path(w) { return loopFrom(w.roads[0].points, new THREE.Vector3(-226, 0, -24), 110, this); },
    radius: 11,
    medals: { gold: 28, silver: 33, bronze: 40 },
  }],
  dubai: [{
    id: 'dubai-szr',
    name: 'Sheikh Zayed Sprint',
    path() {
      const out = [];
      for (let z = 20; z >= -640; z -= 110) out.push(new THREE.Vector3(-18, 0, z));
      out.push(new THREE.Vector3(-18, 0, -650));
      return out;
    },
    start: { x: -18, z: 75, heading: Math.PI },
    radius: 16,
    medals: { gold: 12.5, silver: 14.5, bronze: 18 },
  }],
};

/** Closed loop: checkpoints every `gap` metres starting from the road point nearest `near`, back to the start. */
function loopFrom(points, near, gap, def) {
  let i0 = 0, bd = Infinity;
  points.forEach((p, i) => { const d = p.distanceTo(near); if (d < bd) { bd = d; i0 = i; } });
  const n = points.length, out = [];
  // start on the road, facing along it (a chord to the first checkpoint would cut the bend)
  const a = points[i0], b = points[(i0 + 2) % n];
  def.start = { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    const a = points[(i0 + k - 1) % n], b = points[(i0 + k) % n];
    acc += a.distanceTo(b);
    if (acc >= gap && k < n - 5) { out.push(b.clone()); acc = 0; }
  }
  out.push(points[i0].clone());
  return out;
}

export const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Adds the start markers + interactions to a world. Returns the runtime controller.
 * hooks: { getCar(), toast(text, ms), beep(kind), hud(text|null) }
 */
export function setupTrials(world, hooks) {
  const defs = DEFS[world.id] || [];
  const ctl = { active: null, update() {}, cancel() {}, marks: () => [] };
  if (!defs.length) return ctl;

  // brighter than white so the bloom pass makes it glow
  const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd36b).multiplyScalar(2.4), transparent: true, opacity: 0.9, depthWrite: false });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 48), gold);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 24, 1, true), beamMat);
  beam.position.y = 60;
  const marker = new THREE.Group();
  marker.add(ring, beam);
  marker.visible = false;
  world.scene.add(marker);

  for (const def of defs) {
    def.cps = def.path(world);
    if (!def.start) {
      const a = def.cps[def.cps.length - 1], b = def.cps[0];
      def.start = { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    def.length = def.cps.reduce((s, p, i) => s + p.distanceTo(i ? def.cps[i - 1] : new THREE.Vector3(def.start.x, 0, def.start.z)), 0);
    // start pad: chequered-gold ring on the road
    const pad = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.8, 48), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.8 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(def.start.x, 0.12, def.start.z);
    world.scene.add(pad);
    world.interactions.push({
      x: def.start.x, z: def.start.z, r: 6, car: true,
      label: () => `${hooks.getCar() ? 'Start' : 'Bring a car here for'} the ${def.name} time trial${state.best[def.id] ? ` · best ${fmtTime(state.best[def.id])}` : ''}`,
      action: () => start(def),
    });
    world.landmarks.push({ x: def.start.x, z: def.start.z, color: '#ffd36b', name: 'Race' });
  }

  function place(i) {
    const def = ctl.active.def;
    const p = def.cps[i];
    const prev = i ? def.cps[i - 1] : new THREE.Vector3(def.start.x, 0, def.start.z);
    marker.position.set(p.x, 0, p.z);
    ring.scale.setScalar(def.radius * 0.75);
    ring.position.y = def.radius * 0.75 + 0.3;
    ring.rotation.y = Math.atan2(p.x - prev.x, p.z - prev.z);
    beam.scale.set(def.radius * 0.5, 1, def.radius * 0.5);
    marker.visible = true;
  }

  function start(def) {
    const car = hooks.getCar();
    if (!car) return hooks.toast(`Drive a car to the gold ring to start the ${def.name}`, 3000);
    car.pos.set(def.start.x, 0, def.start.z);
    car.heading = def.start.heading;
    car.vel.set(0, 0);
    car.vF = 0;
    car.sync(0);
    ctl.active = { def, i: 0, t: 0, countdown: 3.0, lastBeep: 4, car };
    place(0);
    hooks.snap?.();
  }

  ctl.cancel = (why) => {
    if (!ctl.active) return;
    ctl.active = null;
    marker.visible = false;
    hooks.hud(null);
    if (why) hooks.toast(why, 2200);
  };

  /** Returns true while the countdown should hold the car still. */
  ctl.update = (dt, car) => {
    const a = ctl.active;
    if (!a) return false;
    if (car !== a.car) { ctl.cancel('Time trial cancelled'); return false; }
    ring.rotation.z += dt * 0.6;
    if (a.countdown > 0) {
      a.countdown -= dt;
      const n = Math.ceil(a.countdown);
      if (n < a.lastBeep) { a.lastBeep = n; hooks.beep(n > 0 ? 'count' : 'go'); }
      // the intro lives in the strip (a toast would sit on top of the big digits)
      hooks.hud(`${a.def.name}<small>${a.def.cps.length} checkpoints · gold under ${fmtTime(a.def.medals.gold)}</small><b>${n > 0 ? n : 'GO'}</b>`);
      return a.countdown > 0;
    }
    a.t += dt;
    const def = a.def;
    const p = def.cps[a.i];
    if (Math.hypot(car.pos.x - p.x, car.pos.z - p.z) < def.radius) {
      a.i++;
      if (a.i >= def.cps.length) { finish(a); return false; }
      hooks.beep('cp');
      place(a.i);
    }
    const best = state.best[def.id];
    hooks.hud(`${def.name}<span>${fmtTime(a.t)}</span><small>Checkpoint ${a.i + 1} / ${def.cps.length}${best ? ` · best ${fmtTime(best)}` : ''}</small>`);
    return false;
  };

  function finish(a) {
    const { def, t } = a;
    ctl.active = null;
    marker.visible = false;
    hooks.hud(null);
    const medal = t <= def.medals.gold ? 'gold' : t <= def.medals.silver ? 'silver' : t <= def.medals.bronze ? 'bronze' : null;
    const prev = state.best[def.id];
    const pb = !prev || t < prev;
    if (pb) state.best[def.id] = +t.toFixed(2);
    state.stats.trials += 1;
    save();
    const pay = medal ? MEDAL_PAY[medal] : 100_000;
    addFunds(pay, `${def.name}: ${medal || 'finished'}`);
    hooks.beep(medal ? 'medal' : 'cp');
    hooks.result({ name: def.name, time: fmtTime(t), medal, pay, pb, prev: prev ? fmtTime(prev) : null, medals: def.medals });
    emit('trial', medal);
  }

  ctl.marks = () => (ctl.active ? [{ x: marker.position.x, z: marker.position.z, color: '#ffd36b', name: '' }] : []);
  ctl.defs = defs;
  return ctl;
}
