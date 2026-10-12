import * as THREE from 'three';
import { buildCar, buildPedestrian } from './models.js';
import { TRAFFIC } from './catalog.js';

// Ambient life: cars that follow lanes (right-hand traffic) and people strolling pavements.
// A lane = { curve, closed, offset (m, + = right of the curve's direction), dir (+1 along / -1 against), count, speed: [min, max] }

const tmpP = new THREE.Vector3();
const tmpT = new THREE.Vector3();

function laneFrame(lane, u) {
  const len = lane.len;
  let s = ((u % len) + len) % len;
  if (!lane.closed) s = THREE.MathUtils.clamp(u, 0, len);
  const t = s / len;
  lane.curve.getPointAt(t, tmpP);
  lane.curve.getTangentAt(t, tmpT);
  tmpT.y = 0;
  tmpT.normalize();
  // right of the travel direction (travel = tangent * dir); our convention: right of +z is -x
  const fx = tmpT.x * lane.dir, fz = tmpT.z * lane.dir;
  const rx = -fz, rz = fx;
  return { x: tmpP.x + rx * lane.offset, z: tmpP.z + rz * lane.offset, heading: Math.atan2(fx, fz) };
}

export class Traffic {
  constructor(scene, { cars = [], peds = [] } = {}) {
    this.scene = scene;
    this.cars = [];
    this.peds = [];
    for (const lane of cars) {
      lane.len = lane.curve.getLength();
      for (let i = 0; i < lane.count; i++) {
        const type = TRAFFIC[Math.floor(Math.random() * TRAFFIC.length)];
        const spec = { ...type, color: type.colors[Math.floor(Math.random() * type.colors.length)] };
        const model = buildCar(spec);
        scene.add(model.root);
        const target = lane.speed[0] + Math.random() * (lane.speed[1] - lane.speed[0]);
        this.cars.push({ lane, model, u: (i / lane.count) * lane.len + Math.random() * 8, v: target, target, stun: 0, x: 0, z: 0, heading: 0, radius: model.radius });
      }
    }
    for (const lane of peds) {
      lane.len = lane.curve.getLength();
      for (let i = 0; i < lane.count; i++) {
        const mesh = buildPedestrian(i);
        scene.add(mesh);
        this.peds.push({ lane, mesh, u: Math.random() * lane.len, v: 1.15 + Math.random() * 0.35, dir: Math.random() < 0.5 ? 1 : -1, x: 0, z: 0 });
      }
    }
    this.update(0, null, new THREE.Vector3());
  }

  /** obstacle: {x, z, r} for the player (on foot or in a car); camPos for distance culling */
  update(dt, obstacle, camPos) {
    // ---- cars ----
    const byLane = new Map();
    for (const c of this.cars) { if (!byLane.has(c.lane)) byLane.set(c.lane, []); byLane.get(c.lane).push(c); }
    for (const [lane, list] of byLane) {
      list.sort((a, b) => (a.u - b.u) * lane.dir); // in travel order
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const ahead = list[(i + 1) % list.length];
        let gap = ahead === c ? Infinity : (ahead.u - c.u) * lane.dir;
        if (gap <= 0) gap += lane.closed ? lane.len : Infinity;
        // player in our path?
        if (obstacle) {
          const f = laneFrame(lane, c.u);
          const fx = Math.sin(f.heading), fz = Math.cos(f.heading);
          const dx = obstacle.x - f.x, dz = obstacle.z - f.z;
          const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          if (along > 0 && along < 32 && side < 2.6 + obstacle.r) gap = Math.min(gap, along - obstacle.r);
        }
        const safe = Math.max(0, (gap - 9) * 0.9);
        let want = Math.min(c.target, safe);
        if (c.stun > 0) { c.stun -= dt; want = 0; }
        const dv = want - c.v;
        c.v += THREE.MathUtils.clamp(dv, -9 * dt, 2.6 * dt);
        c.v = Math.max(0, c.v);
        c.u += c.v * dt * lane.dir;
        if (!lane.closed && (c.u > lane.len || c.u < 0)) c.u = lane.dir > 0 ? 0 : lane.len; // wrap at the far end
      }
    }
    for (const c of this.cars) {
      const f = laneFrame(c.lane, c.u);
      c.x = f.x; c.z = f.z; c.heading = f.heading;
      const { root, wheels, wheelR } = c.model;
      const near = !camPos || Math.hypot(c.x - camPos.x, c.z - camPos.z) < 420;
      root.visible = near;
      if (!near) continue;
      root.position.set(c.x, 0, c.z);
      root.rotation.y = c.heading;
      for (const w of wheels) w.spin.rotation.x += (w.spinSign ?? 1) * (c.v / wheelR) * dt;
    }
    // ---- pedestrians ----
    for (const p of this.peds) {
      const lane = p.lane;
      let v = p.v;
      if (obstacle) {
        const dx = obstacle.x - p.x, dz = obstacle.z - p.z;
        const h = p.mesh.rotation.y;
        const along = dx * Math.sin(h) + dz * Math.cos(h);
        if (along > 0 && along < 2.2 && Math.hypot(dx, dz) < 2.2 + obstacle.r) v = 0;
      }
      p.u += v * dt * p.dir;
      if (!lane.closed && (p.u > lane.len || p.u < 0)) { p.dir *= -1; p.u = THREE.MathUtils.clamp(p.u, 0, lane.len); }
      const f = laneFrame({ ...lane, dir: 1 }, p.u); // pavement side is fixed; only the facing flips
      if (p.dir < 0) f.heading += Math.PI;
      p.x = f.x; p.z = f.z;
      const near = !camPos || Math.hypot(p.x - camPos.x, p.z - camPos.z) < 160;
      p.mesh.visible = near;
      if (!near) continue;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = f.heading;
      p.mesh.userData.animate(v, dt);
    }
  }

  /** Bump the player's car out of any traffic car and stop that car briefly. Returns true on impact. */
  collide(car) {
    let hit = false;
    for (const c of this.cars) {
      if (!c.model.root.visible) continue;
      const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
      const d = Math.hypot(dx, dz), min = (car.model.radius + c.radius) * 0.62;
      if (d > 0 && d < min) {
        const nx = dx / d, nz = dz / d;
        car.pos.x += nx * (min - d);
        car.pos.z += nz * (min - d);
        const into = car.vel.x * nx + car.vel.y * nz;
        if (into < 0) { car.vel.x -= nx * into * 1.3; car.vel.y -= nz * into * 1.3; car.vel.multiplyScalar(0.7); }
        c.v = 0;
        c.stun = 2.5;
        hit = true;
      }
    }
    return hit;
  }
}
