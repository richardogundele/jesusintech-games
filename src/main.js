import * as THREE from 'three';
import { buildMonaco } from './worlds/monaco.js';
import { buildDubai } from './worlds/dubai.js';
import { Car } from './vehicle.js';
import { buildPlayer, buildJet } from './models.js';
import { EngineAudio } from './audio.js';
import { Hud } from './hud.js';
import { state, save } from './state.js';
import { JETS, ROUTES, flightTime, fameLevel, talkFee } from './catalog.js';
import * as P from './progress.js';
import { Phone } from './phone.js';
import { setupTrials, MEDAL_PAY } from './trials.js';
import { buildCabin } from './worlds/cabin.js';
import { buildArena } from './worlds/arena.js';
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
const draw = () => {
  if (!renderer.domElement.width || !renderer.domElement.height) return; // minimised / zero-size window
  updateCulling(camera.position);
  pipeline.render(world.scene);
};

const hud = new Hud();
const audio = new EngineAudio();
const $ = (id) => document.getElementById(id);

// ---------- worlds ----------
const builders = { monaco: buildMonaco, dubai: buildDubai, arena: buildArena };
const worlds = {};
function getWorld(id) {
  if (!worlds[id]) {
    const w = builders[id](renderer);
    w.cars = [];
    w.addCar = (carId, at) => {
      const c = new Car(carId, at);
      w.scene.add(c.model.root);
      w.cars.push(c);
      return c;
    };
    w.garage.forEach((g) => w.addCar(g.id, g));
    // cars bought from the phone fill the extra bays at this home
    P.boughtCarsIn(id).forEach((carId, i) => w.slots?.[i] && w.addCar(carId, w.slots[i]));
    w.traffic = new Traffic(w.scene, w.life || {});
    w.interactions = w.interactions || [];
    w.trials = setupTrials(w, trialHooks);
    if (w.terminal) w.interactions.push({ ...w.terminal, car: true, label: () => `Choose a jet to ${ROUTES[w.id].label}`, action: openJets });
    if (w.jetPark) w.interactions.push({ ...w.jetPark, car: true, label: () => `Open the jet park (${P.ownedJetIds().length} aircraft)`, action: openJets });
    if (w.arenaDoor) w.interactions.push({ ...w.arenaDoor, car: true, label: () => 'Enter Dubai Arena', action: enterArena });
    if (w.exit) w.interactions.push({ ...w.exit, r: 1.6, label: () => 'Leave the arena', action: leaveArena });
    if (w.stageMark) w.interactions.push({ ...w.stageMark, r: 1.2, label: () => 'Start your talk', action: startTalk });
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

function enterWorld(target, spawn) {
  world = typeof target === 'string' ? getWorld(target) : target;
  world.scene.add(player.mesh);
  camera.near = world.near ?? 0.3; // tight interiors need a closer clipping plane
  camera.updateProjectionMatrix();
  const s = spawn || world.spawn;
  player.pos.set(s.x, 0, s.z);
  player.heading = s.heading;
  player.speed = 0;
  player.mesh.visible = true;
  car = null;
  mode = 'foot';
  if (world.id === 'monaco' || world.id === 'dubai') { state.world = world.id; save(); }
  snapCamera();
}

// ---------- input ----------
const keys = new Set();
const down = (...codes) => codes.some((c) => keys.has(c));
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if ((e.code === 'KeyP' || e.code === 'Tab') && !e.repeat) { e.preventDefault(); togglePhone(); return; }
  if (mode === 'phone' || mode === 'result') { if (e.code === 'Escape') mode === 'phone' ? togglePhone() : closeResult(); return; }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyR' && mode === 'car') {
    state.radio = !state.radio;
    save();
    hud.toast(state.radio ? 'Radio on · Dream Life FM' : 'Radio off', 1400);
  }
  if (mode === 'talk' && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) world.nextSlide(e.code === 'ArrowRight' ? 1 : -1);
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

function nearIt(it, pos, extra) {
  return Math.hypot(pos.x - it.x, pos.z - it.z) < it.r + extra;
}
function activeInteraction() {
  const list = world.interactions || [];
  if (mode === 'foot') return list.find((it) => nearIt(it, player.pos, 2));
  if (mode === 'car') return list.find((it) => it.car && nearIt(it, car.pos, 4));
  return null;
}

function currentPrompt() {
  if (mode === 'talk') return `<kbd>←</kbd><kbd>→</kbd> Change slide · <kbd>E</kbd> Finish your talk`;
  const it = activeInteraction();
  if (it) return `<kbd>E</kbd> ${it.label()}`;
  if (mode === 'foot') {
    const c = nearestCar(4.5);
    if (c) return `<kbd>E</kbd> Drive the ${c.name}`;
  }
  return '';
}

function interact() {
  if (mode === 'talk') return finishTalk();
  const it = activeInteraction();
  if (it && (mode !== 'car' || car.speedKmh < 40)) {
    if (car) car.park();
    return it.action();
  }
  if (mode === 'foot') {
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
  for (const id of P.ownedJetIds()) {
    const j = JETS[id];
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<div class="maker">${j.maker}</div><div class="model">${j.model}</div>
      <div class="spec">Range ${j.range} · Mach ${j.mach}<br>Up to ${j.seats} passengers${j.note ? `<br>${j.note}` : ''}</div>
      <div class="dest">${world.name.charAt(0) + world.name.slice(1).toLowerCase()} → ${route.label} · ${flightTime(j)}</div>`;
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

let flight = null;
const titleCase = (n) => n.charAt(0) + n.slice(1).toLowerCase();

async function travel(jetId) {
  const from = world;
  const route = ROUTES[from.id];
  const j = JETS[jetId];
  const time = flightTime(j);
  if (car) car.park();
  car = null;
  mode = 'cutscene';
  player.mesh.visible = false;
  hud.show(false);

  await runCutscene(takeoff(from, jetId));
  await fade(1);
  $('card-eyebrow').textContent = 'Wheels up';
  $('card-title').textContent = `${from.name} → ${route.label.toUpperCase()}`;
  $('card-sub').textContent = `${j.maker} ${j.model} · ${time}`;
  $('card').classList.remove('hidden');
  await wait(300);
  // build the cabin for this jet while the card is up
  const cabin = buildCabin(renderer, j, { fromName: titleCase(from.name), toName: route.label, time });
  cabin.cars = [];
  cabin.traffic = null;
  cabin.interactions.push({ ...cabin.mySeat, r: 0.9, label: () => `Take your seat and land in ${route.label}`, action: land });
  renderer.compile(cabin.scene, camera);
  flight = { jetId, to: route.to, cabin };
  await wait(1500);
  $('card').classList.add('hidden');
  enterWorld(cabin);
  hud.show(true);
  await fade(0);
  hud.toast(`Cruising at 45,000 ft in your ${j.model}. Have a walk around, then take your seat to land.`, 5500);
}

async function land() {
  if (!flight) return;
  const { jetId, to } = flight;
  mode = 'cutscene';
  hud.show(false);
  await fade(1);
  const dest = getWorld(to);
  world = dest;
  dest.scene.add(player.mesh);
  player.mesh.visible = false;
  const landed = runCutscene(landing(dest, jetId));
  await fade(0);
  await landed;
  await fade(1);
  audio.jet(0);
  flight = null;
  P.recordFlight();
  enterWorld(dest.id);
  hud.show(true);
  await fade(0);
  const names = dest.cars.map((c) => c.spec.maker).join(' and the ');
  hud.toast(dest.id === 'monaco' ? 'Chauffeured home to the villa. Welcome back.' : `Chauffeured to your Dubai Hills mansion. The ${names} are waiting.`, 4200);
}

// ---------- the arena ----------
let talkT = 0;
async function enterArena() {
  mode = 'cutscene';
  if (car) { car.park(); car = null; }
  await fade(1);
  enterWorld('arena');
  arenaMusic = 0.4;
  await fade(0);
  hud.toast('Backstage at Dubai Arena. Thousands are waiting. Walk out to the glowing mark on the catwalk.', 5000);
}
async function leaveArena() {
  mode = 'cutscene';
  await fade(1);
  enterWorld('dubai', { x: 238, z: -560, heading: -Math.PI / 2 });
  await fade(0);
}
function startTalk() {
  mode = 'talk';
  talkT = 0;
  player.pos.set(world.stageMark.x, 0, world.stageMark.z);
  player.heading = 0; // face the crowd
  player.speed = 0;
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = 0;
  world.startTalk();
  arenaMusic = 1;
  setTimeout(() => { if (mode === 'talk') arenaMusic = 0.12; }, 7000);
  hud.toast('You are live. Use the arrow keys to move through your slides.', 3500);
}
function finishTalk() {
  world.endTalk();
  mode = 'foot';
  const reached = world.crowdSize;
  const fee = talkFee(state.reached, reached);
  P.recordTalk(reached, fee);
  arenaMusic = 1;
  setTimeout(() => { if (world.id === 'arena') arenaMusic = 0.4; }, 14000);
  snapCamera();
  hud.toast(`Standing ovation. ${reached.toLocaleString('en-GB')} people heard you tonight · ${state.reached.toLocaleString('en-GB')} reached so far.`, 6000);
  hud.reward({ kind: 'talk', title: 'Speaking fee', amount: fee });
  audio.sfx('cash');
}

// ---------- the reward loop ----------
let lastPlace = '';
let hudSlow = 0;
let arenaMusic = 0;
let prevMode = 'foot';
const homeId = () => (world.id === 'monaco' || world.id === 'dubai' ? world.id : state.world);

function refreshHudExtras() {
  hud.goals(P.dailyGoals(), state.streak.count);
  const f = fameLevel(state.reached);
  hud.fame(`${f.title} · ${state.reached.toLocaleString('en-GB')} reached`);
}

P.onNotify((r) => {
  hud.reward(r);
  if (r.kind === 'goal' || r.kind === 'win' || r.kind === 'bonus') audio.sfx('cash');
  if (r.kind === 'level') audio.sfx('level');
  refreshHudExtras();
});

const phone = new Phone({
  homeId,
  crowdSize: () => worlds.arena?.crowdSize ?? 11_500,
  sfx: (k) => audio.sfx(k),
  close: () => togglePhone(),
  onCarBought(carId, home) {
    const w = worlds[home];
    if (!w) return;
    const i = P.boughtCarsIn(home).length - 1;
    if (w.slots?.[i]) w.addCar(carId, w.slots[i]);
  },
  onJetBought(jetId) { worlds.dubai?.addJet(jetId); },
});

function togglePhone() {
  if (mode === 'phone') {
    phone.show(false);
    mode = prevMode;
    hud.show(true);
    return;
  }
  if (!['foot', 'car', 'jets'].includes(mode)) return;
  if (mode === 'jets') closeJets();
  prevMode = mode;
  mode = 'phone';
  phone.show(true);
}

const trialHooks = {
  getCar: () => car,
  toast: (t, ms) => hud.toast(t, ms),
  beep: (k) => audio.sfx(k),
  hud: (html) => hud.trial(html),
  snap: () => snapCamera(),
  result(r) {
    const medal = r.medal ? r.medal.toUpperCase() : 'NO MEDAL';
    $('res-name').textContent = r.name;
    $('res-medal').textContent = medal;
    $('res-medal').style.color = { gold: '#ffd36b', silver: '#d9dde3', bronze: '#d08a52' }[r.medal] || 'var(--muted)';
    $('res-time').textContent = r.time;
    const m = r.medals, f = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    $('res-sub').innerHTML = `${r.pb ? (r.prev ? `New personal best (was ${r.prev})` : 'First time set') : 'Personal best stands'} · +€${r.pay.toLocaleString('en-GB')}<br>
      Gold ${f(m.gold)} · Silver ${f(m.silver)} · Bronze ${f(m.bronze)}`;
    prevMode = mode;
    mode = 'result';
    if (car) car.park();
    $('result').classList.remove('hidden');
  },
};
function closeResult() {
  if (mode !== 'result') return;
  $('result').classList.add('hidden');
  mode = prevMode;
}
$('res-ok').onclick = closeResult;

// ---------- sound ----------
let musicKey = '';
function updateSoundscape() {
  if (!audio.ctx) return;
  let track = null, level = 1;
  if (world.id === 'arena') { track = 'arena'; level = arenaMusic; }
  else if (mode === 'car' && state.radio) { track = 'radio'; level = 0.9; }
  const key = `${track}:${level}`;
  if (key !== musicKey) { musicKey = key; audio.music.play(track, level); }
  const p = car ? car.pos : player.pos;
  const kind = world.id === 'monaco' ? 'coast'
    : world.id === 'dubai' ? (world.indoors?.(p.x, p.z) ? 'indoor' : 'city')
    : world.id === 'cabin' ? 'indoor' : 'none';
  audio.ambience.set(kind, mode === 'car');
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
  if (world.cameraRig) {
    const r = world.cameraRig;
    desired.copy(target).addScaledVector(f, -r.dist).setY(r.height);
    look.copy(target).addScaledVector(f, 3).setY(r.look);
    return { fov: r.fov };
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
  refreshHudExtras();
  hud.toast(`${world.id === 'monaco' ? 'Welcome home.' : 'Welcome home to Dubai Hills.'} Press P for your phone: today's goals are waiting.`, 5000);
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
  if (mode === 'phone' || mode === 'result') return; // the phone pauses the world
  elapsed += dt;
  world.tick(elapsed);
  P.tick(dt);
  updateSoundscape();
  if (world.trials?.active && mode !== 'car') world.trials.cancel('Time trial cancelled');
  const obstacle = mode === 'car' ? { x: car.pos.x, z: car.pos.z, r: car.model.radius * 0.6 }
    : mode === 'foot' ? { x: player.pos.x, z: player.pos.z, r: 0.5 } : null;
  world.traffic?.update(dt, obstacle, camera.position);
  audio.crowd(world.id === 'arena' ? world.excite : 0);
  const input = readInput();

  if (mode === 'menu') {
    updateMenuCamera(dt);
  } else if (mode === 'talk') {
    talkT += dt;
    const shot = world.talkCamera(talkT);
    camera.position.copy(shot.pos);
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(shot.look);
    player.mesh.userData.animate(0, dt);
    hud.update({ world, x: player.pos.x, z: player.pos.z, car: null, balance: state.balance, prompt: currentPrompt(), mode });
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
      if (world.trials?.update(dt, car)) { input.up = false; input.down = false; input.brake = true; }
      car.update(dt, input, world);
      P.emit('km', (Math.abs(car.vF) * dt) / 1000);
      P.emit('speed', car.speedKmh);
      if (world.traffic?.collide(car)) car.sync(0);
      audio.update(car, input.up ? 1 : 0);
    } else {
      if (world.id === 'cabin') audio.jet(0.22); else audio.update(null, 0);
      if (mode === 'foot') updateFoot(dt, input);
    }
    updateCamera(dt);
    const p = car ? car.pos : player.pos;
    world.env.follow(p);
    hud.update({ world, x: p.x, z: p.z, car, balance: state.balance, prompt: mode === 'jets' ? '' : currentPrompt(), mode });
    hud.minimap(world, p.x, p.z, car ? car.heading : player.heading, world.cars.filter((c) => c !== car), world.trials?.marks() || []);
    const place = world.place(p.x, p.z);
    if (place !== lastPlace) { lastPlace = place; P.emit('place', place); }
    hudSlow -= dt;
    if (hudSlow <= 0) { hudSlow = 0.5; refreshHudExtras(); }
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
  state, P, phone, audio, worlds, togglePhone, interact, enterWorld, hud,
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
