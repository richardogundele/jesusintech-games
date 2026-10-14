import * as THREE from 'three';
import { buildCar } from './models.js';
import { CARS } from './catalog.js';

const fwd = new THREE.Vector2();
const right = new THREE.Vector2();
const probe = new THREE.Vector3();

/**
 * Arcade car: velocity is a world-space vector, decomposed every frame into forward
 * and lateral parts. Lateral grip bleeds off sideways slip; the handbrake drops grip,
 * which is what lets the car drift.
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
    this.sync(0);
  }

  get name() { return `${this.spec.maker} ${this.spec.model}`; }
  get speedKmh() { return Math.abs(this.vF) * 3.6; }

  update(dt, input, world) {
    const s = this.spec;
    const top = s.topSpeed / 3.6;
    fwd.set(Math.sin(this.heading), Math.cos(this.heading));
    right.set(Math.cos(this.heading), -Math.sin(this.heading));
    let vF = this.vel.dot(fwd);
    let vR = this.vel.dot(right);
    const prevVF = vF;

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

    // steering: less lock at speed so it stays controllable at 300 km/h
    const speedFactor = 1 - 0.6 * Math.min(1, Math.abs(vF) / 70);
    const target = input.steer * s.steer * speedFactor;
    this.steer += (target - this.steer) * Math.min(1, dt * 8);

    // lateral grip
    const grip = input.brake ? s.grip * 0.12 : s.grip;
    vR *= Math.exp(-grip * dt);

    this.vel.set(fwd.x * vF + right.x * vR, fwd.y * vF + right.y * vR);

    // yaw (positive steer = right = heading decreases)
    let yaw = (vF / this.wheelbase) * Math.tan(this.steer);
    // cap yaw by what the tyres can hold (lateral accel = v * yaw)
    const maxYaw = (s.grip * 3) / Math.max(4, Math.abs(vF));
    yaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
    if (input.brake && Math.abs(vF) > 8) yaw *= 1.6;
    this.heading -= yaw * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // collisions: two circles (front + rear) against the world boxes
    const r = this.model.width * 0.55;
    let hit = false;
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
          this.vel.addScaledVector(n, -into * 1.35);
          this.vel.multiplyScalar(0.82);
          hit = Math.abs(into) > 4;
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
    return { hit };
  }

  park() {
    this.vel.set(0, 0);
    this.vF = 0;
    this.steer = 0;
    this.accelSmoothed = 0;
    this.slip = 0;
    this.sync(0);
  }

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
