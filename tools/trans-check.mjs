#!/usr/bin/env node
// Unit checks for the learner car's gearbox (src/vehicle.js Manual / Auto), on the real Car class
// with the model builder stubbed out (as tools/lesson-check.mjs does). 60 Hz, a flat empty world.
//   node tools/trans-check.mjs        exits 1 if any check fails
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(REPO, 'node_modules/.cache/lesson-check');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `trans-${process.pid}.mjs`);
await build({
  stdin: { contents: "export { Car, GEAR_K } from './src/vehicle.js'; export { LEARNER, CARS } from './src/catalog.js';", resolveDir: REPO, loader: 'js' },
  bundle: true, format: 'esm', platform: 'node', outfile: outFile, logLevel: 'error', external: ['three', 'three/*'],
  define: { 'import.meta.env': '{"BASE_URL":"/","DEV":true,"PROD":false,"MODE":"development"}' },
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /models\.js$/ }, () => ({ path: 'models', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: "import * as THREE from 'three'; export function buildCar(spec = {}) { const L = spec.dims?.L ?? 4.6, W = spec.dims?.W ?? 1.85; const root = new THREE.Group(), body = new THREE.Group(); root.add(body); return { root, body, wheels: [], wheelR: 0.33, length: L, width: W, height: 1.5, radius: Math.hypot(L, W) / 2 }; }", resolveDir: REPO, loader: 'js' }));
  } }],
});
const G = await import(pathToFileURL(outFile).href);
fs.unlinkSync(outFile);
const THREE = await import('three');
const { Car, LEARNER, CARS, GEAR_K } = G;

const MPH = 2.23694, dt = 1 / 60;
const world = { colliders: { resolve: () => new THREE.Vector3() }, bounds: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 } };
const make = (trans) => { const c = new Car('learner', { x: 0, z: 0, heading: 0 }, { ...LEARNER, trans }); c.prepare({ engineOn: true, parkingBrake: false }); return c; };
const run = (car, secs, input = {}, each = null) => { for (let i = 0; i < Math.round(secs / dt); i++) { const inp = { up: false, down: false, steer: 0, clutch: false, ...(typeof input === 'function' ? input(i * dt) : input) }; car.update(dt, inp, world); each?.(car); } };
const setSpeed = (car, v) => { car.vel.set(0, v); car.vF = v; };
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failed++; };

// 1. release the clutch in first with no throttle: it stalls
{
  const c = make('manual');
  run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 1 });
  run(c, 3);
  check('manual: clutch up in 1st without gas stalls', c.stalled && !c.engineOn, `stalled ${c.stalled}, ${(c.vF * MPH).toFixed(1)} mph, rpm ${c.rpm.toFixed(0)}`);
}
// 2. the same with the gas held as the clutch comes up: no stall, it pulls away
{
  const c = make('manual');
  run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 1 });
  run(c, 0.3, { clutch: true, up: true }); // gas first
  let minRpm = 1e9; run(c, 3, { up: true }, (k) => { minRpm = Math.min(minRpm, k.rpm); });
  check('manual: clutch up in 1st with gas moves off', !c.stalled && c.vF > 3, `${(c.vF * MPH).toFixed(1)} mph after 3 s, lowest rpm ${minRpm.toFixed(0)}`);
}
// 3. keyboard technique: hold W only while the clutch rises through the bite (tap, not stamp)
{
  const c = make('manual');
  run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 1 });
  run(c, 0.25, { clutch: true, up: true });
  run(c, 1.2, (t) => ({ up: t < 0.9 })); run(c, 2);
  check('manual: short gas, clutch up, then off the gas: keeps going in 1st', !c.stalled && c.vF > 0.8, `${(c.vF * MPH).toFixed(1)} mph, rpm ${c.rpm.toFixed(0)}`);
}
// 4. top speed in each gear (full throttle held in that gear)
const TARGET = { 1: [18, 22], 2: [32, 37], 3: [46, 52], 4: [60, 67], 5: [90, 130] };
for (const g of [1, 2, 3, 4, 5]) {
  const c = make('manual');
  run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: g });
  const v0 = (TARGET[g][0] * 0.6) / MPH; setSpeed(c, v0); c.drive.rpm = v0 * GEAR_K[g];
  let top = 0, rpmTop = 0; run(c, g === 5 ? 90 : 40, { up: true }, (k) => { if (k.vF > top) { top = k.vF; rpmTop = k.rpm; } });
  const mph = top * MPH;
  check(`manual: top speed in ${g}${['st', 'nd', 'rd', 'th', 'th'][g - 1]}`, mph >= TARGET[g][0] && mph <= TARGET[g][1], `${mph.toFixed(1)} mph at ${rpmTop.toFixed(0)} rpm (want ${TARGET[g].join('-')})`);
}
// 5. engine braking: off the gas in 3rd at 30 mph slows the car faster than coasting in neutral
{
  const decel = (gear, clutch) => {
    const c = make('manual'); run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: gear });
    const v0 = 30 / MPH; setSpeed(c, v0); c.drive.rpm = v0 * (GEAR_K[gear] || 0) || 800; c.drive.pedal = clutch ? 1 : 0; c.drive.locked = !clutch;
    run(c, 2, { clutch }); return (v0 - c.vF) / 2;
  };
  const inGear = decel(3, false), coast = decel('N', false);
  check('manual: engine braking in 3rd', inGear > coast * 1.6 && inGear > 0.5, `${inGear.toFixed(2)} m/s2 in 3rd vs ${coast.toFixed(2)} in neutral`);
}
// 6. no gear change without the clutch: it grinds and stays in gear
{
  const c = make('manual');
  run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 1 }); run(c, 0.3, { clutch: true, up: true }); run(c, 2, { up: true });
  const g0 = c.gear, n0 = c.drive.grinds;
  run(c, dt, { up: true, shift: 2 });
  check('manual: no gear change without the clutch', c.gear === g0 && c.drive.grinds === n0 + 1, `gear ${c.gear}, grinds ${c.drive.grinds}`);
  run(c, 0.2, { clutch: true }); run(c, dt, { clutch: true, shift: 2 });
  check('manual: change with the clutch down', c.gear === 2, `gear ${c.gear}`);
  // reverse is refused while rolling forward
  run(c, dt, { clutch: true, shift: 'R' });
  check('manual: reverse refused while moving', c.gear === 2, `gear ${c.gear} at ${(c.vF * MPH).toFixed(1)} mph`);
}
// 7. braking to a stop in gear without the clutch stalls; with the clutch down it doesn't
for (const clutch of [false, true]) {
  const c = make('manual'); run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 2 });
  const v0 = 15 / MPH; setSpeed(c, v0); c.drive.rpm = v0 * GEAR_K[2]; c.drive.pedal = 0; c.drive.locked = true;
  run(c, 4, (t) => ({ down: true, clutch: clutch && c.vF < 3.5 }));
  check(`manual: brake to a stop in 2nd ${clutch ? 'with' : 'without'} the clutch ${clutch ? "doesn't stall" : 'stalls'}`, c.stalled === !clutch && Math.abs(c.vF) < 0.05, `stalled ${c.stalled}`);
}
// 8. restart rules: not in gear with the clutch up
{
  const c = make('manual'); run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 1 }); run(c, 3);
  run(c, dt, { ignition: true }); run(c, 1);
  const refused = !c.engineOn;
  run(c, 0.2, { clutch: true }); run(c, dt, { clutch: true, ignition: true }); run(c, 1, { clutch: true });
  check('manual: restart only with the clutch down or in neutral', refused && c.engineOn && !c.stalled, `refused in gear ${refused}, running after ${c.engineOn}`);
}
// 9. labouring and over-revving flags
{
  const c = make('manual'); run(c, 0.3, { clutch: true }); run(c, dt, { clutch: true, shift: 5 });
  const v0 = 15 / MPH; setSpeed(c, v0); c.drive.rpm = v0 * GEAR_K[5]; c.drive.pedal = 0; c.drive.locked = true;
  let lab = 0; run(c, 1.5, { up: true }, (k) => { if (k.flags.labouring) lab++; });
  const d = make('manual'); run(d, 0.3, { clutch: true }); run(d, dt, { clutch: true, shift: 1 });
  const v1 = 17 / MPH; setSpeed(d, v1); d.drive.rpm = v1 * GEAR_K[1]; d.drive.pedal = 0; d.drive.locked = true;
  let over = 0; run(d, 2, { up: true }, (k) => { if (k.flags.overRev) over++; });
  check('manual: labouring in 5th at 15 mph, over-revving in 1st', lab > 30 && over > 30, `labouring ${lab} frames, over-rev ${over} frames`);
}
// 10. automatic: D creeps at 3-4 mph off the brake; the handbrake holds it; S doesn't reverse; R creeps back
{
  const c = make('auto'); run(c, dt, { shift: 'D' }); run(c, 12);
  check('auto: D creeps at 3-4 mph', c.vF * MPH > 3 && c.vF * MPH < 4.2, `${(c.vF * MPH).toFixed(2)} mph`);
  const h = make('auto'); h.drive.parkingBrake = true; run(h, dt, { shift: 'D' }); run(h, 5);
  check('auto: handbrake on, it does not creep', Math.abs(h.vF) < 0.01, `${(h.vF * MPH).toFixed(2)} mph`);
  const s = make('auto'); run(s, dt, { shift: 'D' }); run(s, 3, { down: true });
  check("auto: S at a standstill in D doesn't reverse", Math.abs(s.vF) < 0.01, `${(s.vF * MPH).toFixed(2)} mph`);
  const r = make('auto'); run(r, dt, { shift: 'R' }); run(r, 10);
  check('auto: R creeps backwards', r.vF * MPH < -2.5 && r.vF * MPH > -4.2, `${(r.vF * MPH).toFixed(2)} mph`);
  const p = make('auto'); run(p, 5, { up: true });
  check('auto: P holds it', Math.abs(p.vF) < 0.01 && p.gear === 'P', `${(p.vF * MPH).toFixed(2)} mph`);
  const a = make('auto'); run(a, dt, { shift: 'D' }); let t60 = null; run(a, 25, { up: true }, (k) => { if (t60 == null && k.vF * MPH >= 60) t60 = a.drive.t; });
  check('auto: pulls to 60 mph', t60 != null && t60 < 16, `0-60 in ${t60?.toFixed(1)} s, ${(a.vF * MPH).toFixed(0)} mph after 25 s`);
}
// 11. arcade cars are untouched: S at a standstill reverses, Space drifts
{
  const c = new Car('revuelto', { x: 0, z: 0, heading: 0 }, CARS.revuelto);
  run(c, 1, { down: true });
  check('arcade car: no gearbox, S reverses as before', !c.drive && c.vF < -1 && c.trans === 'auto' && c.gear === 'D', `${(c.vF * MPH).toFixed(1)} mph`);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks ok');
process.exit(failed ? 1 : 0);
