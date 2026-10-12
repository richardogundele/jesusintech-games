import * as THREE from 'three';
import { buildMonaco } from './worlds/monaco.js';
import { buildDubai } from './worlds/dubai.js';
import { Car } from './vehicle.js';
import { buildPlayer, buildJet } from './models.js';
import { EngineAudio } from './audio.js';
import { Hud } from './hud.js';
import { state, save } from './state.js';
import { JETS, ROUTES } from './catalog.js';
import { loadAll, updateCulling } from './assets.js';
import { createPipeline } from './render.js';
import { Traffic } from './traffic.js';

// ---------- renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 12000);
const pipeline = createPipeline(renderer, camera);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  pipeline.setSize(window.innerWidth, window.innerHeight);
});
const draw = () => { updateCulling(camera.position); pipeline.render(world.scene); };

const hud = new Hud();
const audio = new EngineAudio();
const $ = (id) => document.getElementById(id);

// ---------- worlds ----------
const builders = { monaco: buildMonaco, dubai: buildDubai };
const worlds = {};
function getWorld(id) {
  if (!worlds[id]) {
    const w = builders[id](renderer);
    w.cars = w.garage.map((g) => {
      const c = new Car(g.id, g);
      w.scene.add(c.model.root);
      return c;
    });
    w.traffic = new Traffic(w.scene, w.life);
    worlds[id] = w;
  }
  return worlds[id];
}

// ---------- player ----------
const player = { mesh: null, pos: new THREE.Vector3(), heading: 0, speed: 0 };
let world = null;
let mode = 'menu'; // menu | foot | car | jets | cutscene
let car = null;
let camMode = 0;
let cutscene = null;

function enterWorld(id) {
  world = getWorld(id);
  world.scene.add(player.mesh);
  const s = world.spawn;
  player.pos.set(s.x, 0, s.z);
  player.heading = s.heading;
  player.speed = 0;
  player.mesh.visible = true;
  car = null;
  mode = 'foot';
  state.world = id;
  save();
  snapCamera();
}

// ---------- input ----------
const keys = new Set();
const down = (...codes) => codes.some((c) => keys.has(c));
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyC' && mode === 'car') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on', 1200);
  if (e.code === 'Escape' && mode === 'jets') closeJets();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  return {
    up: down('KeyW', 'ArrowUp'),
    down: down('KeyS', 'ArrowDown'),
    steer: (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0),
    brake: down('Space'),
    run: down('ShiftLeft', 'ShiftRight'),
  };
}

// ---------- interactions ----------
function nearestCar(maxDist) {
  let best = null, bd = maxDist;
  for (const c of world.cars) {
    const d = c.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function nearTerminal(pos, extra = 0) {
  const t = world.terminal;
  return Math.hypot(pos.x - t.x, pos.z - t.z) < t.r + extra;
}

function currentPrompt() {
  const dest = ROUTES[world.id].label;
  if (mode === 'foot') {
    if (nearTerminal(player.pos, 2)) return `<kbd>E</kbd> Fly to ${dest}`;
    const c = nearestCar(4.5);
    if (c) return `<kbd>E</kbd> Drive the ${c.name}`;
  }
  if (mode === 'car' && nearTerminal(car.pos, 4)) return `<kbd>E</kbd> Fly to ${dest}`;
  return '';
}

function interact() {
  if (mode === 'foot') {
    if (nearTerminal(player.pos, 2)) return openJets();
    const c = nearestCar(4.5);
    if (c) {
      car = c;
      mode = 'car';
      player.mesh.visible = false;
      camMode = 0;
      snapCamera();
      hud.toast(`${c.spec.maker} ${c.spec.model} · ${c.spec.topSpeed} km/h top speed`, 2600);
    }
  } else if (mode === 'car') {
    if (nearTerminal(car.pos, 4) && car.speedKmh < 40) return openJets();
    if (car.speedKmh > 20) return hud.toast('Slow down to get out', 1400);
    const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading)); // driver's left
    player.pos.copy(car.pos).addScaledVector(side, car.model.width / 2 + 1.1);
    player.heading = car.heading;
    player.speed = 0;
    player.mesh.visible = true;
    car.park();
    car = null;
    mode = 'foot';
    snapCamera();
  }
}

// ---------- jets ----------
function openJets() {
  const route = ROUTES[world.id];
  if (car) car.park();
  mode = 'jets';
  $('jets-title').textContent = `Choose your jet to ${route.label}`;
  const list = $('jet-list');
  list.innerHTML = '';
  for (const [id, j] of Object.entries(JETS)) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<div class="maker">${j.maker}</div><div class="model">${j.model}</div>
      <div class="spec">Range ${j.range}<br>${j.speed}<br>${j.seats}</div>
      <div class="dest">${world.name.charAt(0) + world.name.slice(1).toLowerCase()} → ${route.label} · ${route.time}</div>`;
    b.onclick = () => { closeJets(true); travel(id); };
    list.appendChild(b);
  }
  $('jets').classList.remove('hidden');
}
function closeJets(keepMode) {
  $('jets').classList.add('hidden');
  if (!keepMode) mode = car ? 'car' : 'foot';
}
$('jets-cancel').onclick = () => closeJets();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fade = async (to) => { $('fade').style.opacity = to; await wait(850); };
function runCutscene(cs) {
  return new Promise((resolve) => { cutscene = { ...cs, t: 0, resolve }; });
}

function takeoff(w, jetId) {
  const jet = buildJet(JETS[jetId]);
  const { x, z0 } = w.runway;
  jet.position.set(x, 0, z0);
  w.scene.add(jet);
  return {
    dur: 9,
    update(t) {
      const z = z0 + 5 * t * t;
      const air = Math.max(0, t - 5);
      jet.position.set(x, air * air * 2.4, z);
      jet.rotation.x = -Math.min(0.2, air * 0.16);
      jet.userData.blob.visible = jet.position.y < 0.5;
      audio.jet(Math.min(1, 0.45 + t / 5));
      if (t < 4.6) {
        // tracking shot alongside the jet, slightly ahead of the nose
        camera.position.set(x - 38, 3, z + 30);
        camera.fov = 42;
      } else {
        camera.position.set(x - 18, Math.max(2.5, jet.position.y - 2), z - 52);
        camera.fov = 58;
      }
      camera.updateProjectionMatrix();
      camera.lookAt(jet.position.x, jet.position.y + 3, jet.position.z + 8);
      w.env.follow(jet.position);
    },
    end() { w.scene.remove(jet); },
  };
}

function landing(w, jetId) {
  const jet = buildJet(JETS[jetId]);
  const { x, z0 } = w.runway;
  const zTD = z0 + 30;
  w.scene.add(jet);
  const cam = new THREE.Vector3(x - 46, 5, zTD + 70);
  return {
    dur: 8,
    update(t) {
      let z, y, pitch;
      if (t < 4.5) {
        const k = 1 - t / 4.5;
        z = zTD - 380 * k;
        y = 90 * k * k;
        pitch = -0.07;
      } else {
        const u = Math.min(3.5, t - 4.5);
        z = zTD + 84 * u - 12 * u * u;
        y = 0;
        pitch = -0.07 * Math.max(0, 1 - u * 1.5);
      }
      jet.position.set(x, y, z);
      jet.rotation.x = pitch;
      jet.userData.blob.visible = y < 0.5;
      audio.jet(Math.max(0.15, 0.8 - t * 0.08));
      camera.position.copy(cam);
      camera.fov = 45;
      camera.updateProjectionMatrix();
      camera.lookAt(jet.position.x, jet.position.y + 3, jet.position.z);
      w.env.follow(jet.position);
    },
    end() { w.scene.remove(jet); },
  };
}

async function travel(jetId) {
  const from = world;
  const route = ROUTES[from.id];
  const j = JETS[jetId];
  if (car) car.park();
  car = null;
  mode = 'cutscene';
  player.mesh.visible = false;
  hud.show(false);

  await runCutscene(takeoff(from, jetId));
  await fade(1);
  $('card-eyebrow').textContent = 'Wheels up';
  $('card-title').textContent = `${from.name} → ${route.label.toUpperCase()}`;
  $('card-sub').textContent = `${j.maker} ${j.model} · ${route.time}`;
  $('card').classList.remove('hidden');
  await wait(400);
  const to = getWorld(route.to); // build while the screen is black
  world = to;
  to.scene.add(player.mesh);
  await wait(2200);
  $('card').classList.add('hidden');
  const landed = runCutscene(landing(to, jetId));
  await fade(0);
  await landed;
  await fade(1);
  audio.jet(0);
  enterWorld(to.id);
  hud.show(true);
  await fade(0);
  const names = to.cars.map((c) => c.spec.maker).join(' and the ');
  hud.toast(to.id === 'monaco' ? 'Chauffeured home to the villa. Welcome back.' : `Chauffeured to your Dubai Hills mansion. The ${names} are waiting.`, 4200);
}

// ---------- camera ----------
let camYaw = 0;
const desired = new THREE.Vector3();
const look = new THREE.Vector3();

function camRig() {
  // key off `car`, not `mode`: the jet picker can open while you're still in the car
  const target = car ? car.pos : player.pos;
  const f = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  if (car) {
    const m = car.model;
    const v = Math.abs(car.vF);
    if (camMode === 2) {
      const hf = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
      desired.copy(target).addScaledVector(hf, -0.4).setY(m.height * 0.92);
      look.copy(target).addScaledVector(hf, 30).setY(m.height * 0.8);
      return { fov: 72 + Math.min(14, v * 0.12), snap: true };
    }
    const far = camMode === 1;
    const dist = (far ? m.length * 2.6 + 5 : m.length * 1.0 + 2.3) + v * 0.012;
    const height = far ? m.height + 3.4 : m.height + 1.05;
    desired.copy(target).addScaledVector(f, -dist).setY(height);
    look.copy(target).addScaledVector(f, 4).setY(m.height * 0.6);
    return { fov: 58 + Math.min(12, v * 0.12) };
  }
  if (world.indoors?.(target.x, target.z)) {
    // tighter camera inside so it stays within the rooms
    desired.copy(target).addScaledVector(f, -2.7).setY(2.2);
    look.copy(target).addScaledVector(f, 3).setY(1.5);
    return { fov: 68 };
  }
  desired.copy(target).addScaledVector(f, -4.6).setY(2.5);
  look.copy(target).addScaledVector(f, 2).setY(1.45);
  return { fov: 58 };
}

function snapCamera() {
  camYaw = car ? car.heading : player.heading;
  const r = camRig();
  camera.position.copy(desired);
  camera.fov = r.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
}

function updateCamera(dt) {
  const heading = car ? car.heading : player.heading;
  let diff = heading - camYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camYaw += diff * Math.min(1, dt * (car ? 3.2 : 5));
  const r = camRig();
  if (r.snap) camera.position.copy(desired);
  else camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
  camera.fov += (r.fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
  camera.lookAt(look);
}

// ---------- on foot ----------
function updateFoot(dt, input) {
  const turn = -input.steer;
  player.heading += turn * 2.6 * dt;
  const target = (input.up ? 1 : 0) * (input.run ? 8.5 : 4.2) - (input.down ? 2.2 : 0);
  player.speed += (target - player.speed) * Math.min(1, dt * 8);
  player.pos.x += Math.sin(player.heading) * player.speed * dt;
  player.pos.z += Math.cos(player.heading) * player.speed * dt;
  world.colliders.resolve(player.pos, 0.45);
  for (const c of world.cars) {
    const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz), r = c.model.radius * 0.75;
    if (d < r && d > 0) { player.pos.x += (dx / d) * (r - d); player.pos.z += (dz / d) * (r - d); }
  }
  const b = world.bounds;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, b.minX, b.maxX);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, b.minZ, b.maxZ);
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;
  player.mesh.userData.animate(Math.abs(player.speed), dt);
}

// ---------- menu ----------
let menuT = 0;
function updateMenuCamera(dt) {
  menuT += dt * 0.05;
  camera.position.set(Math.sin(menuT) * 320, 70, 60 + Math.cos(menuT) * 260);
  camera.fov = 55;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 10, -60);
  world.env.follow(new THREE.Vector3(0, 0, 0));
}

$('start').onclick = () => {
  audio.start();
  $('title').classList.add('hidden');
  enterWorld(state.world in builders ? state.world : 'monaco');
  hud.show(true);
  hud.toast(world.id === 'monaco' ? 'Welcome home. Your cars are on the driveway.' : 'Welcome home to Dubai Hills.', 4000);
};

// ---------- loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!window.__game?.paused) step(dt);
  draw();
}

function step(dt) {
  elapsed += dt;
  world.tick(elapsed);
  const obstacle = mode === 'car' ? { x: car.pos.x, z: car.pos.z, r: car.model.radius * 0.6 }
    : mode === 'foot' ? { x: player.pos.x, z: player.pos.z, r: 0.5 } : null;
  world.traffic.update(dt, obstacle, camera.position);
  const input = readInput();

  if (mode === 'menu') {
    updateMenuCamera(dt);
  } else if (mode === 'cutscene') {
    if (cutscene) {
      cutscene.t += dt;
      cutscene.update(Math.min(cutscene.t, cutscene.dur));
      if (cutscene.t >= cutscene.dur) {
        const cs = cutscene;
        cutscene = null;
        cs.end();
        cs.resolve();
      }
    }
  } else {
    if (mode === 'car') {
      car.update(dt, input, world);
      if (world.traffic.collide(car)) car.sync(0);
      audio.update(car, input.up ? 1 : 0);
    } else {
      audio.update(null, 0);
      if (mode === 'foot') updateFoot(dt, input);
    }
    updateCamera(dt);
    const p = car ? car.pos : player.pos;
    world.env.follow(p);
    hud.update({ world, x: p.x, z: p.z, car, balance: state.balance, prompt: mode === 'jets' ? '' : currentPrompt(), mode });
    hud.minimap(world, p.x, p.z, car ? car.heading : player.heading, world.cars.filter((c) => c !== car));
  }
}

// load every asset (skies, textures, models) before building any world
const startBtn = $('start');
startBtn.disabled = true;
startBtn.textContent = 'Loading 0%';
await loadAll(renderer, (p) => { startBtn.textContent = `Loading ${Math.round(p * 100)}%`; });
player.mesh = buildPlayer();
getWorld('monaco');
getWorld('dubai'); // build both up front so the flight never waits on a build
world = getWorld(state.world in builders ? state.world : 'monaco');
renderer.compile(world.scene, camera);
startBtn.disabled = false;
startBtn.textContent = 'Enter';
frame();

// debug handle for testing in the console
window.__game = {
  get world() { return world; }, get car() { return car; }, get mode() { return mode; }, player, keys, camera, pipeline, renderer,
  // dev: render the current frame and save it to shots/<name>.jpg via the Vite dev server
  async shot(name = 'live', w = 1280, h = 800) {
    const prev = renderer.getSize(new THREE.Vector2());
    renderer.setSize(w, h, false);
    pipeline.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
    const url = renderer.domElement.toDataURL('image/jpeg', 0.88);
    renderer.setSize(prev.x, prev.y, false);
    pipeline.setSize(prev.x, prev.y);
    camera.aspect = prev.x / prev.y;
    camera.updateProjectionMatrix();
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return name;
  },
  // advance the simulation by `seconds` at 60 Hz, then render once (works even when the tab is hidden)
  advance(seconds) {
    for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60);
    draw();
  },
};
