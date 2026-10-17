import * as THREE from 'three';
import { buildMonaco } from './worlds/monaco.js';
import { buildDubai } from './worlds/dubai.js';
import { Car } from './vehicle.js';
import { buildPlayer, buildJet } from './models.js';
import { EngineAudio } from './audio.js';
import { Hud } from './hud.js';
import { state, save } from './state.js';
import { JETS, CITIES, otherCities, fuelStop, flightTime, talkFee, LEARNER, CARS, RADIO_STATION } from './catalog.js';
import { buildSingapore } from './worlds/singapore.js';
import { buildKent, setKentHooks } from './worlds/kent.js';
import * as P from './progress.js';
import { Phone } from './phone.js';
import { Songs } from './songs.js';
import { YtRadio } from './ytradio.js';
import { setupTrials, MEDAL_PAY } from './trials.js';
import { buildCabin } from './worlds/cabin.js';
import { buildArena } from './worlds/arena.js';
import { buildUK, lPlateTex, MPH } from './worlds/uk.js';
import { LESSONS, LessonRun, carefulDriver, TELL_ME, randomPlate, plateOptions, testDef } from './lessons.js';
import { KENT_ROUTES } from './kent/lesson-routes.js';
import { generateTest, signsOnRoute } from './kent/test-routes.js';
import { signQuestion } from './sign-quiz.js';
import { buildCar } from './models.js';
import { TRAFFIC } from './catalog.js';
import { loadAll, updateCulling } from './assets.js';
import { createPipeline } from './render.js';
import { Traffic } from './traffic.js';

// ---------- renderer ----------
const canvas = document.getElementById('game');
// the 3D game fills the top 90% of the screen; the controls dock sits in the bottom 10%
const GAME_VH = 0.9;
const viewW = () => window.innerWidth;
const viewH = () => Math.round(window.innerHeight * GAME_VH);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(viewW(), viewH());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(62, viewW() / viewH(), 0.3, 12000);
const pipeline = createPipeline(renderer, camera);
window.addEventListener('resize', () => {
  camera.aspect = viewW() / viewH();
  camera.updateProjectionMatrix();
  renderer.setSize(viewW(), viewH());
  pipeline.setSize(viewW(), viewH());
});
const mirrorCam = new THREE.PerspectiveCamera(42, 292 / 70, 0.3, 600);
const draw = () => {
  if (!renderer.domElement.width || !renderer.domElement.height) return; // minimised / zero-size window
  updateCulling(camera.position);
  pipeline.render(world.scene);
  // a real rear-view mirror in the learner car (its 2px frame is #mirror: 296 x 74 at top 16px, style.css)
  if (car?.drive && mode === 'car') {
    const w = 292, h = 70, x = (viewW() - w) / 2, yTop = 18;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    mirrorCam.position.set(car.pos.x + fx * 0.2, 1.25, car.pos.z + fz * 0.2);
    mirrorCam.lookAt(car.pos.x - fx * 30, 0.9, car.pos.z - fz * 30);
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, viewH() - yTop - h, w, h);
    renderer.setViewport(x, viewH() - yTop - h, w, h);
    car.model.root.visible = false;
    renderer.render(world.scene, mirrorCam);
    car.model.root.visible = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewW(), viewH());
    renderer.shadowMap.autoUpdate = auto;
  }
};

const hud = new Hud();
const audio = new EngineAudio();
const $ = (id) => document.getElementById(id);

// ---------- worlds ----------
const builders = { kent: buildKent, monaco: buildMonaco, dubai: buildDubai, arena: buildArena, uk: buildUK, singapore: buildSingapore };
const HOMES = ['kent', 'monaco', 'dubai']; // worlds you can live in: the save remembers the last one
const worlds = {};
function getWorld(id) {
  if (!worlds[id]) {
    const w = builders[id](renderer);
    w.cars = [];
    w.addCar = (carId, at, spec) => {
      const c = new Car(carId, at, spec);
      w.scene.add(c.model.root);
      w.cars.push(c);
      return c;
    };
    w.garage.forEach((g) => w.addCar(g.id, g));
    if (w.learnerAt) rebuildLearner(w);
    if (w.parked) addEyesightCar(w, { x: w.parked.x, z: w.parked.z, heading: 0 });
    for (const spot of w.eyesight || []) addEyesightCar(w, spot); // Kent: one at each test centre
    // cars bought from the phone fill the extra bays at this home
    P.boughtCarsIn(id).forEach((carId, i) => w.slots?.[i] && w.addCar(carId, w.slots[i]));
    w.traffic = w.trafficSystem || new Traffic(w.scene, w.life || {});
    w.interactions = w.interactions || [];
    w.trials = setupTrials(w, trialHooks);
    if (w.terminal) w.interactions.push({ ...w.terminal, car: true, label: () => `Fly to ${otherCities(w.id).map((c) => CITIES[c].name).join(' or ')}`, action: openJets });
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
let camShake = 0, crashCooldown = 0; // a jolt + a short mute so one bump doesn't spam the crash sound
let cutscene = null;
let controlsOpen = false; // the H card: the world waits while it's open

function toggleControls() {
  controlsOpen = hud.controls(!controlsOpen, { car: mode === 'car' ? car : null, trans: state.uk.trans });
}
hud.onControlsClose = () => { if (controlsOpen) toggleControls(); };
// the "goals today" chip opens the phone on Today
hud.onGoals = () => { if (mode === 'foot' || mode === 'car') { phone.tab = 'today'; togglePhone(); } };

function enterWorld(target, spawn) {
  if (lesson) lesson.cancel('Lesson stopped');
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
  if (HOMES.includes(world.id)) { state.world = world.id; save(); }
  snapCamera();
}

// ---------- input ----------
const keys = new Set();
const down = (...codes) => codes.some((c) => keys.has(c));
// the learner car's gearbox keys are one-shot presses, picked up by the next readInput()
const press = { shift: null, ignition: false, pbrakeToggle: false };
const learnerCar = () => mode === 'car' && car?.drive;
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  // H: the controls card (the world waits while it's open); H or Esc closes it
  if (e.code === 'KeyH' && (controlsOpen || mode === 'foot' || mode === 'car')) { toggleControls(); return; }
  if (controlsOpen) { if (e.code === 'Escape') toggleControls(); return; }
  if (learnerCar() && !window.__game?.autoDrive) {
    // Left Shift (held) is the clutch (readInput); 1-5 gears (1 is D in an automatic), R reverse, 0 neutral, 9 park, I engine, Space handbrake
    const g = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit0: 'N', Digit9: 'P', KeyR: 'R', Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad0: 'N', Numpad9: 'P' }[e.code];
    if (g != null) press.shift = car.drive.kind === 'auto' && typeof g === 'number' && g > 1 ? null : g;
    if (e.code === 'KeyI') press.ignition = true;
    if (e.code === 'Space') press.pbrakeToggle = true;
  }
  if ((e.code === 'KeyP' || e.code === 'Tab') && !e.repeat) { e.preventDefault(); togglePhone(); return; }
  if (mode === 'phone' || mode === 'result' || mode === 'quiz') { if (e.code === 'Escape' && mode !== 'quiz') mode === 'phone' ? togglePhone() : closeResult(); return; }
  if (e.code === 'KeyE') interact();
  if (mode === 'car' && (e.code === 'KeyZ' || e.code === 'KeyX')) {
    const dir = e.code === 'KeyZ' ? 'left' : 'right';
    drive.indicator = drive.indicator === dir ? null : dir;
    drive.turned = 0;
  }
  if (mode === 'car' && e.code === 'KeyQ') { drive.mirrorPressed = true; drive.mirrorFlash = 0.6; }
  if (e.code === 'KeyF' && mode === 'car') { // the radio is F in every car (R is reverse in the learner car)
    state.radio = !state.radio;
    save();
    hud.toast(state.radio ? 'Radio on · Dream Life FM' : 'Radio off', 1400);
  }
  if (mode === 'talk' && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) world.nextSlide(e.code === 'ArrowRight' ? 1 : -1);
  if (e.code === 'KeyC' && mode === 'car') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') { const m = audio.toggleMute(); songs.setMuted(m); ytradio.setMuted(m); hud.toast(m ? 'Sound off' : 'Sound on', 1200); }
  if (e.code === 'KeyN' && !e.repeat) { if (ytradio.on) ytradio.next(); else if (songs.available) songs.next(); }
  if (e.code === 'Escape' && mode === 'jets') closeJets();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  const learner = learnerCar();
  const out = {
    up: down('KeyW', 'ArrowUp'),
    down: down('KeyS', 'ArrowDown'),
    steer: (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0),
    brake: learner ? false : down('Space'), // the learner car's Space is the parking brake (a press, not a hold)
    run: down('ShiftLeft', 'ShiftRight'),
    clutch: learner ? down('ShiftLeft', 'ShiftRight') : false,
    shift: press.shift, ignition: press.ignition, pbrakeToggle: press.pbrakeToggle,
  };
  press.shift = null; press.ignition = false; press.pbrakeToggle = false;
  return out;
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
      if (c.drive) learnerHello(c);
      else hud.toast(`${c.spec.maker} ${c.spec.model} · ${c.spec.topSpeed} km/h top speed`, 2600);
    }
  } else if (mode === 'car') {
    if (car.speedKmh > 20) return hud.toast('Slow down to get out', 1400);
    const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading)); // driver's left
    player.pos.copy(car.pos).addScaledVector(side, car.model.width / 2 + 1.1);
    player.heading = car.heading;
    player.speed = 0;
    player.mesh.visible = true;
    car.park();
    if (car.drive) { car.drive.parkingBrake = true; car.drive.engineOn = false; car.drive.rpm = 0; car.drive.gear = car.drive.neutral; } // handbrake on, engine off, out of gear
    car = null;
    mode = 'foot';
    snapCamera();
  }
}

// ---------- jets ----------
let jetDest = null;
function openJets() {
  if (car) car.park();
  mode = 'jets';
  const from = world.id;
  const dests = otherCities(from);
  if (!dests.includes(jetDest)) jetDest = dests[0];
  const render = () => {
    $('jets-title').textContent = `Where to, Richard?`;
    $('jet-dest').innerHTML = dests.map((c) => `<button data-c="${c}" class="${c === jetDest ? 'on' : ''}">${CITIES[c].name}</button>`).join('');
    for (const b of $('jet-dest').children) b.onclick = () => { jetDest = b.dataset.c; render(); };
    const list = $('jet-list');
    list.innerHTML = '';
    for (const id of P.ownedJetIds()) {
      const j = JETS[id];
      const stop = fuelStop(j, from, jetDest);
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<div class="maker">${j.maker}</div><div class="model">${j.model}</div>
        <div class="spec">Range ${j.range} · Mach ${j.mach}<br>Up to ${j.seats} passengers${j.note ? `<br>${j.note}` : ''}</div>
        <div class="dest">${CITIES[from].name} → ${CITIES[jetDest].name} · ${flightTime(j, from, jetDest)}${stop ? `<br><span class="stop">Fuel stop in ${stop}</span>` : ' · nonstop'}</div>`;
      b.onclick = () => { closeJets(true); travel(id, jetDest); };
      list.appendChild(b);
    }
  };
  render();
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

async function travel(jetId, to) {
  const from = world;
  const route = { to, label: CITIES[to].name };
  const j = JETS[jetId];
  const time = flightTime(j, from.id, to);
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
  // build the destination now, while the card is up, so landing never stalls
  renderer.compile(getWorld(route.to).scene, camera);
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
  hud.toast(dest.id === 'kent' ? 'Chauffeured home to Beltinge. The sea is at the bottom of the garden.'
    : dest.id === 'monaco' ? 'Chauffeured to the villa in Monaco.'
    : dest.id === 'singapore' ? 'Welcome to Singapore. Marina Bay Sands is behind you, the skyline is across the water. Your cars are at the drop-off.'
    : `Chauffeured to your Dubai Hills mansion. The ${names} are waiting.`, 5200);
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
const homeId = () => (HOMES.includes(world.id) ? world.id : HOMES.includes(state.world) ? state.world : 'kent');

function refreshHudExtras() {
  hud.goals(P.dailyGoals()); // a "2/3 goals today" chip; fame lives in the phone
}

P.onNotify((r) => {
  hud.reward(r);
  if (r.kind === 'goal' || r.kind === 'win' || r.kind === 'bonus') audio.sfx('cash');
  if (r.kind === 'level') audio.sfx('level');
  refreshHudExtras();
});

// your own music: files from your computer, kept in this browser
const songs = new Songs({
  settings: state.songs,
  onTrack: (song, msg) => { if (song && ytradio?.on) ytradio.stop(); hud.toast(song ? `♪ ${song.title}` : msg || 'Music paused', 2600); save(); if (phone?.open && phone.tab === 'music') phone.render(); },
  onList: () => { if (phone?.open && phone.tab === 'music') phone.render(); },
});

// the Tribe Fuego YouTube radio: on while a song from it plays; your own songs and it take turns
const ytradio = new YtRadio({
  el: $('ytradio'), host: 'yt-host', station: RADIO_STATION,
  onState: (info) => { $('yt-title').textContent = info?.title || (ytradio.on ? 'Tuning in…' : ''); if (info) { if (songs.playing) songs.toggle(); hud.toast(`♪ ${info.title}`, 2600); } state.songs.yt = ytradio.on; save(); if (phone?.open && phone.tab === 'music') phone.render(); },
});

const phone = new Phone({
  homeId,
  songs,
  ytradio,
  crowdSize: () => worlds.arena?.crowdSize ?? 11_500,
  sfx: (k) => audio.sfx(k),
  close: () => togglePhone(),
  onCarBought(carId, home) {
    const w = worlds[home];
    if (!w) return;
    const i = P.boughtCarsIn(home).length - 1;
    if (w.slots?.[i]) w.addCar(carId, w.slots[i]);
  },
  onJetBought(jetId) { worlds.kent?.addJet(jetId); worlds.dubai?.addJet(jetId); },
  setLook: (l) => { player.mesh.userData.setLook?.(l); save(); },
  startLesson: (id) => startLesson(id),
  startTest: (centre, seed) => startTest(centre, seed),
  signDrill: () => signDrill(10),
  setTrans: (t) => setLearnerTrans(t),
  setLessonCar: (id) => setLessonCar(id),
  lessonCars: () => lessonCarList(),
  goUK: () => goUK(),
  inKent: () => world.id === 'kent',
  goHome: () => goHome(),
  inUK: () => world.id === 'uk',
  toast: (t, ms) => hud.toast(t, ms),
  save,
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

// ---------- driving lessons (Whitmore, England) ----------
let lesson = null;
const autoState = {};
const drive = { indicator: null, turned: 0, blink: 0, mirrorPressed: false, mirrorFlash: 0, trafficHit: false };

function addLPlates(c) {
  const mat = new THREE.MeshBasicMaterial({ map: lPlateTex() });
  for (const z of [1, -1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), mat);
    pl.position.set(0, 0.62, z * (c.model.length / 2 + 0.02));
    pl.rotation.y = z > 0 ? 0 : Math.PI;
    c.model.root.add(pl);
  }
}

// the automatic learner car wears a blue AUTO badge under its L plates
function addAutoBadge(c) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1d4fb8'; ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = '#fff'; ctx.font = '800 34px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AUTO', 64, 26);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const g = new THREE.Group();
  for (const z of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), mat);
    m.position.set(0.32 * z, 0.62, z * (c.model.length / 2 + 0.02));
    m.rotation.y = z > 0 ? 0 : Math.PI;
    g.add(m);
  }
  c.model.root.add(g);
  c.autoBadge = g;
  g.visible = c.trans === 'auto';
}
/** the car you learn in: your chosen car's looks, with calm learner handling so a test is still a test */
function lessonSpecFor(id) {
  if (!id || id === 'learner' || !CARS[id]) return LEARNER;
  const base = CARS[id];
  return { ...base, topSpeed: LEARNER.topSpeed, accel: LEARNER.accel, grip: LEARNER.grip, steer: LEARNER.steer };
}
/** (re)build a world's learner car from the chosen lesson car + gearbox, with L plates */
function rebuildLearner(w) {
  if (!w.learnerAt) return null;
  const i = w.cars.findIndex((c) => c.id === 'learner');
  if (i >= 0) { w.scene.remove(w.cars[i].model.root); w.cars.splice(i, 1); }
  const c = w.addCar('learner', w.learnerAt, { ...lessonSpecFor(state.uk.lessonCar), trans: state.uk.trans });
  addLPlates(c); addAutoBadge(c);
  return c;
}
/** the phone's "Learning in" choice: every learner car already built changes gearbox (and badge) */
function setLearnerTrans(t) {
  if (lesson && !window.__game?.autoQuiz) { hud.toast('Finish (or stop) this lesson before you change car', 2600); return; }
  state.uk.trans = t; save();
  for (const w of Object.values(worlds)) for (const c of w.cars) if (c.id === 'learner') { c.setTrans(t); if (c.autoBadge) c.autoBadge.visible = t === 'auto'; }
}
/** the phone's "Lesson car" choice: take lessons in any car you own (it wears L plates) */
function setLessonCar(id) {
  if (lesson && !window.__game?.autoQuiz) { hud.toast('Finish (or stop) this lesson before you change car', 2600); return; }
  state.uk.lessonCar = !id || id === 'learner' ? null : id; save();
  for (const w of Object.values(worlds)) rebuildLearner(w);
  const base = CARS[state.uk.lessonCar];
  hud.toast(`Lessons now in your ${base ? `${base.maker} ${base.model}` : 'VW Polo'}`, 2600);
}
/** every car you can take a lesson in: the free learner Polo plus the cars you own */
function lessonCarList() {
  const sel = state.uk.lessonCar || 'learner';
  return [{ id: 'learner', name: 'VW Polo', sel: sel === 'learner' },
    ...Object.keys(CARS).filter((id) => P.ownsCar(id)).map((id) => ({ id, name: `${CARS[id].maker} ${CARS[id].model}`, sel: sel === id }))];
}
/** getting into the learner car: which car and gearbox (the HUD's hints teach the keys, step by step) */
function learnerHello(c) {
  hud.toast(`${c.name} learner car · ${c.trans === 'manual' ? 'manual' : 'automatic'}`, 2600);
}

function updateIndicators(dt, dHeading) {
  if (drive.indicator !== drive.lastInd) { drive.lastInd = drive.indicator; drive.turned = 0; }
  if (drive.indicator) {
    // self-cancel once a real turn is done (net heading change, so small corrections don't count)
    drive.turned += Math.atan2(Math.sin(dHeading), Math.cos(dHeading));
    if (Math.abs(drive.turned) > 1.05 && Math.abs(car.steer) < 0.04) drive.indicator = null;
  }
  drive.blink += dt;
  const lit = drive.indicator && drive.blink % 0.8 < 0.4;
  if (drive.indicator && Math.floor((drive.blink - dt) / 0.4) !== Math.floor(drive.blink / 0.4)) audio.sfx(lit ? 'tick' : 'tock');
  hud.indicators(world.units === 'mph', drive.indicator, lit);
}

let voice = null;
function speak(text) {
  if (audio.muted || !('speechSynthesis' in window)) return;
  try {
    const synth = window.speechSynthesis;
    voice = voice || synth.getVoices().find((v) => /en-GB/i.test(v.lang)) || null;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = 'en-GB';
    u.rate = 1.02;
    synth.speak(u);
  } catch { /* no speech: the text panel is enough */ }
}

/** the dark blue car whose number plate the eyesight check reads; spot { x, z, heading, centre? } */
function addEyesightCar(w, spot) {
  const spec = { ...TRAFFIC[0], color: 0x1d2b44 };
  const m = buildCar(spec);
  m.root.position.set(spot.x, 0, spot.z);
  m.root.rotation.y = spot.heading; // nose into the bay, number plate facing the aisle
  w.scene.add(m.root);
  if (spot.heading) w.colliders.obb(spot.x, spot.z, 2.0, 4.8, spot.heading);
  else w.colliders.box(spot.x, spot.z, 2.0, 4.8);
  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = 512; plateCanvas.height = 112;
  const tex = new THREE.CanvasTexture(plateCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), new THREE.MeshBasicMaterial({ map: tex }));
  pl.position.set(0, 0.5, -(m.length / 2 + 0.02));
  pl.rotation.y = Math.PI;
  m.root.add(pl);
  const setPlate = (text) => {
    const ctx = plateCanvas.getContext('2d');
    ctx.fillStyle = '#f2d300'; ctx.fillRect(0, 0, 512, 112);
    ctx.fillStyle = '#111'; ctx.font = '800 84px "Arial Narrow", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 60);
    tex.needsUpdate = true;
    w.plate = text;
  };
  spot.setPlate = setPlate;
  // Whitmore has one eyesight car; in Kent, setPlate(text, centre) picks the test centre's
  const prev = w.setPlate;
  w.setPlate = (text, centre) => (spot.centre && centre && spot.centre !== centre && prev ? prev(text, centre) : setPlate(text));
  setPlate(randomPlate());
}

// multiple-choice modal for the eyesight check and show me / tell me. Resolves true if right.
function quiz({ title, q, a, plate = false, img = null }) {
  return new Promise((resolve) => {
    const order = a.map((_, i) => i).sort(() => Math.random() - 0.5);
    $('quiz-title').textContent = title;
    $('quiz-q').textContent = q;
    $('quiz-plate').innerHTML = img ? `<img src="${img}" alt="road sign">` : ''; // a road sign to name
    $('quiz-plate').classList.toggle('hidden', !img);
    const box = $('quiz-a');
    box.innerHTML = '';
    for (const i of order) {
      const b = document.createElement('button');
      b.textContent = a[i];
      if (plate) b.className = 'plate';
      b.onclick = () => done(i === 0);
      box.appendChild(b);
    }
    const back = mode;
    mode = 'quiz';
    $('quiz').classList.remove('hidden');
    function done(ok) {
      $('quiz').classList.add('hidden');
      mode = back;
      audio.sfx(ok ? 'cp' : 'spend');
      resolve(ok);
    }
    if (window.__game?.autoQuiz) setTimeout(() => done(true), 0);
  });
}

/** ten road signs to name, from the phone (study at home; not marked) */
async function signDrill(n = 10) {
  let right = 0;
  for (let i = 0; i < n; i++) if (await quiz({ ...signQuestion(), title: `Road signs · ${i + 1} of ${n}` })) right++;
  hud.toast(`Road signs: ${right} of ${n} right`, 3000);
}
const lessonHooks = {
  quiz: (item) => quiz(item),
  // at a red light in a lesson the instructor sometimes asks you to name a sign (not marked)
  signQuiz: () => quiz({ ...signQuestion(), title: 'While we wait at the lights · not marked' }).then((ok) => { hud.toast(ok ? 'Right!' : 'Not quite: look it up in the Highway Code.', 1800); return ok; }),
  estop(on) { $('estop').classList.toggle('hidden', !on); if (on) audio.sfx('go'); },
  say(text) { speak(text); },
  hud(info) { hud.lesson(info); },
  satnav(info) { hud.satnav(info); },
  // an angled start pulls up behind a parked car: a body and a box to steer round
  parkedCar(p) {
    const m = buildCar({ ...TRAFFIC[1 % TRAFFIC.length], color: 0x6b1f2a });
    m.root.position.set(p.x, 0, p.z);
    m.root.rotation.y = p.heading;
    world.scene.add(m.root);
    return { m, box: world.colliders.obb(p.x, p.z, 1.9, 4.5, p.heading) };
  },
  removeParked(h) { h.m.root.parent?.remove(h.m.root); world.colliders.remove(h.box); },
  flash(text) { hud.toast(text, 2600); audio.sfx('spend'); },
  cancelled(why) {
    lesson = null;
    hud.lesson(null);
    hud.satnav(null);
    $('estop').classList.add('hidden');
    if (why) hud.toast(why, 2600);
  },
  result(r) {
    const run = lesson;
    lesson = null;
    setTimeout(() => hud.lesson(null), 4000);
    const uk = state.uk;
    const rec = (uk.lessons[r.id] = uk.lessons[r.id] || { tries: 0, passed: false, best: null });
    const firstPass = r.passed && !rec.passed;
    rec.tries += 1;
    if (r.passed) { rec.passed = true; rec.best = rec.best == null ? r.counts.minor : Math.min(rec.best, r.counts.minor); }
    if (r.mock && !r.practice) uk.tests += 1;
    let reward = 0;
    if (firstPass && !r.practice) reward = r.mock ? 5_000_000 : 250_000;
    // the real UK rule: pass in an automatic, drive automatics only; pass in a manual, drive both
    let licenceNews = null;
    if (r.passed && r.mock && !r.practice) {
      if (r.trans === 'manual' && uk.licence !== 'full') { uk.licence = 'full'; licenceNews = 'Full UK driving licence (manual and automatic). Well done.'; }
      else if (r.trans === 'auto' && !uk.licence) { uk.licence = 'auto'; licenceNews = 'UK driving licence: automatic cars only. Pass in a manual to upgrade it.'; }
    }
    if (licenceNews) setTimeout(() => hud.reward({ kind: 'level', title: licenceNews }), 1500);
    // the test history (Kent tests only): what you need to see yourself improve
    if (r.mock && !r.practice && r.sheet) {
      const rows = {};
      for (const R of r.sheet.rows) if (R.d || R.s || R.x) rows[R.key] = [R.d, R.s, R.x];
      uk.history.push({ at: new Date().toISOString(), id: r.id, title: r.title, kind: r.generated ? 'test15' : 'mock', centre: r.generated?.centre || (r.id === 'mock-canterbury' ? 'canterbury' : 'herne'),
        trans: r.trans, seed: r.generated?.seed ?? null, passed: r.passed, minor: r.counts.minor, serious: r.counts.serious, dangerous: r.counts.dangerous, rows, main: r.brief?.main || '', minutes: +(r.time / 60).toFixed(1) });
      if (uk.history.length > 60) uk.history.splice(0, uk.history.length - 60);
    }
    save();
    if (reward) { addFundsUI(reward, r.mock ? 'Passed your UK driving test' : `Lesson passed: ${r.title}`); }
    if (r.passed) P.emit('lesson');
    $('res-name').textContent = r.mock ? `${r.title} · ${r.trans === 'manual' ? 'manual' : 'automatic'}` : `Lesson · ${r.title}`;
    $('res-medal').textContent = r.passed ? (r.mock ? (uk.licence === 'full' ? 'PASSED · FULL UK LICENCE' : 'PASSED · AUTOMATIC LICENCE') : 'PASSED') : 'NOT PASSED';
    $('res-medal').style.color = r.passed ? 'var(--green-soft)' : 'var(--red-soft)';
    // a generated test can be driven again on the same seed: offer it in the action row, not buried in the sheet
    const retry = $('res-retry');
    if (r.generated) { retry.dataset.retest = `${r.generated.centre}:${r.generated.seed}`; retry.classList.remove('hidden'); }
    else retry.classList.add('hidden');
    $('res-time').textContent = `${r.counts.minor}`;
    $('res-sub').innerHTML = `driving fault${r.counts.minor === 1 ? '' : 's'} · ${r.counts.serious} serious · ${r.counts.dangerous} dangerous${reward ? ` · +€${reward.toLocaleString('en-GB')}` : ''}${sheetHtml(r)}`;
    $('result').querySelector('.modal').classList.toggle('sheet', !!(r.sheet && r.mock));
    drawResultMap(r.map);
    prevMode = mode;
    mode = 'result';
    if (car) car.park();
    audio.sfx(r.passed ? 'medal' : 'spend');
    $('result').classList.remove('hidden');
    return run;
  },
};
// ---------- the examiner's marking sheet (DL25) on the result screen ----------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** tally strokes, the way an examiner marks driving faults: |||| then a fifth across them */
const tally = (n) => (n ? '<span class="tally">' + '<s>||||</s> '.repeat(Math.floor(n / 5)) + '|'.repeat(n % 5) + '</span>' : '');
function sheetHtml(r) {
  if (!r.sheet || !r.mock) { // lessons: the faults and the lesson's tasks; tests get the whole DL25
    const lines = r.lines.length ? r.lines.map((l) => `<div class="${l.sev}">${l.sev === 'minor' ? 'Driving fault' : l.sev === 'serious' ? 'Serious' : 'Dangerous'} · ${esc(l.cat)}${l.n > 1 ? ` ×${l.n}` : ''}</div>`).join('') : '<div>No faults at all. Textbook.</div>';
    const tasks = r.tasks ? `<div class="tasks">${Object.entries(r.tasks).map(([k, v]) => `<span class="${v ? 'done' : ''}">${v ? '✓' : '·'} ${{ up4: 'Up to fourth', down: 'Changed down for a junction', block: 'Block change', start: 'Started the engine', bite: 'Found the bite', biteDown: 'Clutch down at the bite', stall: 'Stalled on purpose', recover: 'Recovered the stall', astart: 'Started the engine', select: 'Selected D', creep: 'Creep control', reverse: 'Reversed in R', select2: 'Back into D', secureP: 'Parked: handbrake and P' }[k] || k}</span>`).join('')}</div>` : '';
    return `<div class="faults">${lines}</div>${tasks}`;
  }
  const S = r.sheet, B = r.brief || { improve: [] };
  const rows = S.rows.map((R) => `<tr class="${R.d || R.s || R.x ? 'hit' : ''}"><td>${esc(R.label)}${Object.keys(R.subs).length ? `<small>${Object.entries(R.subs).map(([k, n]) => `${k}${n > 1 ? ' ×' + n : ''}`).join(' · ')}</small>` : ''}</td><td>${tally(R.d)}</td><td class="s">${R.s ? (R.habitual ? 'S*' : 'S'.repeat(R.s)) : ''}</td><td class="x">${R.x ? 'D'.repeat(R.x) : ''}</td></tr>`).join('');
  const improve = B.improve.map((i) => `<div class="imp"><b>${esc(i.row)}</b>${i.s || i.x ? ` <em>${i.x ? 'dangerous' : 'serious'}</em>` : ''} <span>${i.d ? `${i.d} driving fault${i.d === 1 ? '' : 's'}` : ''}</span>
      ${i.where.map((w) => `<div class="where">${esc(w)}</div>`).join('')}<div class="why">${esc(i.why)}</div><div class="tip">Practise: ${esc(i.tip)}</div>${i.lesson ? `<button class="mini" data-lesson="${i.lesson}">Book: ${esc(i.lessonTitle)}</button>` : ''}</div>`).join('');
  const g = r.generated;
  return `<div class="dl25">
      <div class="verdict">${esc(B.spoken || B.verdict || '')}</div>
      ${g ? `<div class="route">${esc(g.centreName)} · seed ${g.seed} · ${g.manoeuvre === 'baypark' ? 'forward bay park' : 'pull up on the right and reverse'} · independent driving by ${g.indep.mode === 'signs' ? `signs for ${esc(g.indep.target)}` : 'sat nav'} · ${(r.time / 60).toFixed(1)} min · ${esc(g.stretches.join(', '))}</div>` : ''}
      ${g ? '<div class="map-panel"><canvas id="res-map" width="360" height="200"></canvas><div class="map-legend"><span class="start">Start</span><span class="d">Driving</span><span class="s">Serious / dangerous</span></div></div>' : '<canvas id="res-map" width="360" height="200"></canvas>'}
      <table><thead><tr><th>DL25</th><th>Driving faults</th><th>S</th><th>D</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="total">Total driving faults <b>${S.total}</b> · serious <b>${S.serious}</b> · dangerous <b>${S.dangerous}</b> · ${S.passed ? 'PASS' : 'FAIL'} (15 or fewer driving faults, no serious or dangerous)</div>
      ${S.habitual.length ? `<div class="note">S* ${esc(S.habitual.join(', '))}: four or more driving faults of the same kind. Examiners can mark a fault repeated like that as serious (DT1: a fault can "by constant repetition, be regarded as serious").</div>` : ''}
      ${improve ? `<h4>What to improve</h4>${improve}` : '<h4>Nothing to improve today</h4>'}
      ${r.signs?.length ? `<h4>Signs on your route</h4><div class="signs">${r.signs.map((x) => `<span>${esc(x.sign)}${x.n > 1 ? ` ×${x.n}` : ''}</span>`).join('')}</div>` : ''}
    </div>`;
}
/** the route with a dot where each fault happened (amber driving, red serious, purple dangerous) */
function drawResultMap(map) {
  const cv = document.getElementById('res-map'); if (!cv || !map?.pts?.length) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of map.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const k = Math.min((W - 24) / Math.max(1, x1 - x0), (H - 24) / Math.max(1, z1 - z0)), ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
  const P = (x, z) => [ox + (x - x0) * k, oz + (z - z0) * k];
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(53,174,226,0.9)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
  map.pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke();
  const [sx, sz] = P(...map.pts[0]); ctx.fillStyle = '#e8c77a'; ctx.beginPath(); ctx.arc(sx, sz, 5, 0, Math.PI * 2); ctx.fill();
  // dots match the table: amber driving fault, red serious or dangerous (--amber / --red)
  for (const f of map.faults) { const [a, b] = P(f.x, f.z); ctx.fillStyle = f.sev === 'minor' ? '#ffb340' : '#ff453a'; ctx.beginPath(); ctx.arc(a, b, f.sev === 'minor' ? 4 : 6, 0, Math.PI * 2); ctx.fill(); }
}
$('result').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.retest) { const [c, sd] = b.dataset.retest.split(':'); closeResult(); startTest(c, +sd); }
  if (b.dataset.lesson) { closeResult(); startLesson(b.dataset.lesson); }
});
function addFundsUI(amount, title) {
  state.balance += amount;
  state.log.push({ amount, reason: title, at: new Date().toISOString() });
  save();
  hud.reward({ kind: 'win', title, amount });
}

async function goUK() {
  if (world.id === 'uk') return;
  mode = 'cutscene';
  if (car) { car.park(); car = null; }
  hud.show(false);
  await fade(1);
  enterWorld('uk');
  renderer.compile(world.scene, camera);
  hud.show(true);
  await fade(0);
  hud.toast('Whitmore, England. Your instructor is at the test centre. Open the phone (P) to start a lesson.', 6000);
}
async function goHome() {
  mode = 'cutscene';
  if (car) { car.park(); car = null; }
  hud.show(false);
  await fade(1);
  enterWorld(state.world in builders && state.world !== 'uk' ? state.world : 'kent');
  hud.show(true);
  await fade(0);
}
/** fill the Kent tiles round a point while the screen is faded (the lesson starts somewhere the player isn't) */
async function warmTiles(x, z, ms = 1500) {
  if (!world.tiles) return;
  world.player = { x, z, r: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { world.tiles.update(x, z, 0.016); await wait(0); }
}
async function goKent() {
  mode = 'cutscene';
  if (car) { car.park(); car = null; }
  hud.show(false);
  await fade(1);
  enterWorld('kent');
  renderer.compile(world.scene, camera);
  hud.show(true);
  await fade(0);
}
/**
 * A 15-minute driving test from a test centre ('herne' | 'canterbury' | 'any') on a route made from a
 * seed (a new one each time, or the seed of a test you want to retry).
 */
function startTest(centre = 'any', seed = null) {
  if (centre === 'any') centre = Math.random() < 0.5 ? 'herne' : 'canterbury';
  const w = getWorld('kent');
  seed = seed ?? (Math.floor(Math.random() * 1e9) >>> 0);
  let gen;
  try { gen = generateTest(w.net, centre, seed); } catch (err) { hud.toast(`Couldn't plan a test route there (${err.message}). Try again.`, 4000); return; }
  gen.signs = signsOnRoute(w.net, gen.route);
  return startLesson(testDef(gen));
}
async function startLesson(id) {
  const def = typeof id === 'object' ? id : LESSONS.find((l) => l.id === id);
  // Kent lessons start at their test centre; the Whitmore ones are practice in the made-up town
  const where = def.world === 'kent' ? 'kent' : 'uk';
  if (world.id !== where) await (where === 'kent' ? goKent() : goUK());
  if (lesson) lesson.cancel();
  const learner = world.cars.find((c) => c.id === 'learner') || rebuildLearner(world);
  if (car && car !== learner) car.park();
  car = learner;
  mode = 'car';
  player.mesh.visible = false;
  camMode = 0;
  drive.indicator = null;
  for (const k in autoState) delete autoState[k];
  const kent = where === 'kent', centre = kent ? def.centre || KENT_ROUTES[def.route].centre : null;
  // the gearbox you're learning in (the clutch and gears lessons are always in the manual)
  learner.setTrans(def.trans || state.uk.trans);
  if (learner.autoBadge) learner.autoBadge.visible = learner.trans === 'auto';
  if (kent && !window.__game?.autoQuiz) { hud.show(false); await fade(1); }
  const pre = [];
  if (def.checks) {
    // the real test opens with an eyesight check (read a number plate about 20 m away) and a tell me question
    const spot = kent ? world.eyesight.find((e) => e.centre === centre) : { x: world.parked.x, z: world.parked.z, heading: 0 };
    world.setPlate?.(randomPlate(), centre);
    player.mesh.visible = true;
    car = null;
    mode = 'foot';
    // stand 20 m behind the car (and a step to its left), looking at its number plate
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading), lx = Math.cos(spot.heading), lz = -Math.sin(spot.heading);
    player.pos.set(spot.x - fx * 22 + lx, 0, spot.z - fz * 22 + lz);
    player.heading = spot.heading;
    if (kent) await warmTiles(player.pos.x, player.pos.z, window.__game?.autoQuiz ? 0 : 1500); // the player is there now, so the frame loop streams the same tiles
    snapCamera();
    camera.position.set(spot.x - fx * 21 + lx, 1.7, spot.z - fz * 21 + lz);
    camera.lookAt(spot.x, 0.6, spot.z);
    if (kent) { hud.show(true); await fade(0); }
    draw();
    const eyes = await quiz({ title: 'Eyesight check', q: `Read the number plate on the dark blue car ${centre === 'canterbury' ? 'parked in front of the test centre' : 'in the bay ahead'} (about 20 metres away). Which is it?`, a: plateOptions(world.plate), plate: true });
    if (!eyes) {
      $('res-name').textContent = 'Driving test result';
      $('res-medal').textContent = 'NOT PASSED · EYESIGHT';
      $('res-medal').style.color = '#ff8a7a';
      $('res-time').textContent = '-';
      $('res-sub').innerHTML = "You couldn't read the number plate, so the test can't go ahead. On the real test you'd get a second try with a different car.";
      prevMode = 'foot';
      mode = 'result';
      $('result').classList.remove('hidden');
      return;
    }
    const tm = TELL_ME[Math.floor(Math.random() * TELL_ME.length)];
    if (!(await quiz({ title: 'Tell me', ...tm }))) pre.push('Show me/tell me: tell me question');
    if (kent && !window.__game?.autoQuiz) { hud.show(false); await fade(1); }
    car = learner;
    mode = 'car';
    player.mesh.visible = false;
  }
  lesson = new LessonRun(world, def, lessonHooks);
  pre.forEach((cat) => lesson.fault('minor', cat));
  const st = lesson.route.start;
  car.pos.set(st.x, 0, st.z);
  car.heading = st.heading;
  car.park();
  car.prepare({ engineOn: !def.engineOff, parkingBrake: true }); // handbrake on, out of gear (the clutch lessons start with the engine off)
  snapCamera();
  if (kent) {
    lesson.waiting = true; // the lesson clock doesn't run while the tiles fill in behind the fade
    await warmTiles(st.x, st.z, window.__game?.autoQuiz ? 0 : 1500);
    lesson.waiting = false;
    if (!window.__game?.autoQuiz) { hud.show(true); await fade(0); }
    hud.toast(`${centre === 'canterbury' ? 'Canterbury' : 'Herne Bay'} driving test centre · ${car.trans === 'manual' ? 'manual' : 'automatic'}. Z and X are the indicators, Q checks your mirrors.`, 4000);
  }
}

// ---------- the learner gearbox: dashboard, sounds, messages ----------
const fb = { stalls: 0, grinds: 0, crank: 0, msgT: -1, car: null };
function driveFeedback(c) {
  const d = c.drive;
  if (fb.car !== c) { fb.car = c; fb.stalls = d.stalls; fb.grinds = d.grinds; fb.msgT = d.msg?.t ?? -1; }
  if (d.stalls !== fb.stalls) { fb.stalls = d.stalls; audio.sfx('stall'); }
  if (d.grinds !== fb.grinds) { fb.grinds = d.grinds; audio.sfx('grind'); }
  if (d.crank > 0 && fb.crank <= 0) audio.sfx('crank');
  fb.crank = d.crank;
  // the stall itself is on the dashboard (warning) and in the hint, so no third copy as a toast
  if (d.msg && d.msg.t !== fb.msgT) { fb.msgT = d.msg.t; if (!/^Stalled/.test(d.msg.text)) hud.toast(d.msg.text, 2600); }
  hud.drivetrain(c);
}

// ---------- sound ----------
let musicKey = '';
function updateSoundscape() {
  if (!audio.ctx) return;
  let track = null, level = 1;
  if (world.id === 'arena') { track = 'arena'; level = arenaMusic; }
  else if (mode === 'car' && state.radio) { track = 'radio'; level = 0.9; }
  if (songs.playing || ytradio.on) track = null; // your own songs and the YouTube radio outrank the synthesised radio and the arena anthem
  const key = `${track}:${level}`;
  if (key !== musicKey) { musicKey = key; audio.music.play(track, level); }
  const p = car ? car.pos : player.pos;
  const kind = world.id === 'monaco' ? 'coast'
    : world.id === 'dubai' ? (world.indoors?.(p.x, p.z) ? 'indoor' : 'city')
    : world.id === 'cabin' ? 'indoor' : world.id === 'kent' ? (world.indoors?.(p.x, p.z) ? 'indoor' : p.z < -5500 ? 'coast' : 'city')
    : world.id === 'uk' || world.id === 'singapore' ? 'city' : 'none';
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
  const ty = car ? 0 : target.y; // upstairs at home
  if (world.indoors?.(target.x, target.z)) {
    // tighter camera inside so it stays within the rooms
    desired.copy(target).addScaledVector(f, -2.7).setY(ty + 2.2);
    look.copy(target).addScaledVector(f, 3).setY(ty + 1.5);
    return { fov: 68 };
  }
  desired.copy(target).addScaledVector(f, -4.6).setY(ty + 2.5);
  look.copy(target).addScaledVector(f, 2).setY(ty + 1.45);
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
  if (camShake > 0.002) {
    const a = camShake * 0.28;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
    camShake *= Math.exp(-dt * 7);
  }
  camera.fov += (r.fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
  camera.lookAt(look);
}

// ---------- on foot ----------
function updateFoot(dt, input) {
  const turn = -input.steer;
  player.heading += turn * 2.6 * dt;
  // walk 1.9 m/s, Shift to run at 5.8 m/s (the speeds the animations were captured at)
  const target = (input.up ? 1 : 0) * (input.run ? 5.8 : 1.9) - (input.down ? 1.2 : 0);
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
  // stairs at home: follow the floor height
  if (world.floorY) player.pos.y += (world.floorY(player.pos.x, player.pos.z, player.pos.y) - player.pos.y) * Math.min(1, dt * 12);
  else player.pos.y = 0;
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
  if (state.songs.yt) ytradio.start(); // carry on where your music left off
  else if (state.songs.on && songs.available) songs.start();
  $('title').classList.add('hidden');
  enterWorld(state.world in builders ? state.world : 'kent');
  hud.show(true);
  refreshHudExtras();
  const hello = { kent: 'Welcome home to Kent.', monaco: 'Welcome to the villa in Monaco.', dubai: 'Welcome to Dubai Hills.' }[world.id] || 'Welcome back.';
  hud.toast(`${hello} Press P for your phone: today's goals are waiting.`, 5000);
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
  if (mode === 'phone' || mode === 'result' || mode === 'quiz' || controlsOpen) return; // the phone (and modals, the controls card) pause the world
  elapsed += dt;
  world.tick(elapsed);
  P.tick(dt);
  updateSoundscape();
  if (world.trials?.active && mode !== 'car') world.trials.cancel('Time trial cancelled');
  if (lesson && mode !== 'car') lesson.cancel('Lesson stopped: you got out of the car');
  if (mode !== 'car') { drive.indicator = null; hud.indicators(false); hud.mirror(false); hud.limit(null); }
  const obstacle = mode === 'car' ? { x: car.pos.x, z: car.pos.z, r: car.model.radius * 0.6, heading: car.heading, L: car.model.length, W: car.model.width }
    : mode === 'foot' ? { x: player.pos.x, z: player.pos.z, r: 0.5 } : null;
  world.traffic?.update(dt, obstacle, camera.position);
  world.player = obstacle;
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
    hud.update({ world, x: player.pos.x, z: player.pos.z, car: null, balance: state.balance, prompt: currentPrompt(), mode, trans: state.uk.trans });
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
      if (lesson && window.__game?.autoDrive) {
        const o = carefulDriver(lesson, car, autoState, window.__game.badDriver);
        Object.assign(input, o.input);
        drive.indicator = o.indicator;
        if (o.mirror) drive.mirrorPressed = true;
      }
      const prevHeading = car.heading;
      const res = car.update(dt, input, world);
      updateIndicators(dt, car.heading - prevHeading);
      // a real hit: a crunch and a camera jolt, scaled by how hard you hit (with a short cooldown)
      crashCooldown = Math.max(0, crashCooldown - dt);
      if (res.impact > 3.5 && crashCooldown <= 0) { audio.sfx('crash'); camShake = Math.min(1.1, res.impact * 0.11); crashCooldown = 0.4; }
      if (lesson) {
        lesson.update(dt, car, { indicator: drive.indicator, mirrorPressed: drive.mirrorPressed, hit: res.hit || drive.trafficHit });
      }
      drive.mirrorPressed = false;
      drive.trafficHit = false;
      P.emit('km', (Math.abs(car.vF) * dt) / 1000);
      P.emit('speed', car.speedKmh);
      // a traffic car that drives into the learner is its driver's fault, not a fault on the lesson
      if (world.traffic?.collide(car)) { car.sync(0); drive.trafficHit = world.traffic.lastHit?.blame !== 'other'; }
      audio.update(car, car.drive ? car.drive.throttle : input.up ? 1 : 0);
      if (car.drive) driveFeedback(car); else hud.drivetrain(null);
    } else {
      if (world.id === 'cabin') audio.jet(0.22); else audio.update(null, 0);
      hud.drivetrain(null);
      if (mode === 'foot') updateFoot(dt, input);
    }
    updateCamera(dt);
    const p = car ? car.pos : player.pos;
    world.env.follow(p);
    hud.update({ world, x: p.x, z: p.z, car, balance: state.balance, prompt: mode === 'jets' ? '' : currentPrompt(), mode, gas: input.up, trans: state.uk.trans });
    hud.minimap(world, p.x, p.z, car ? car.heading : player.heading, world.cars.filter((c) => c !== car), world.trials?.marks() || [], lesson?.path());
    const inLearner = mode === 'car' && !!car?.drive; // the rear-view mirror is the learner car's
    hud.limit(world.units === 'mph' ? world.speedLimitAt(p.x, p.z) : null, world.units === 'mph' && world.nslAt?.(p.x, p.z));
    hud.mirror(inLearner, drive.mirrorFlash > 0);
    drive.mirrorFlash -= dt;
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
player.mesh = buildPlayer(state.look);
setKentHooks({
  toast: (t, ms) => hud.toast(t, ms),
  openPhone: (tab) => { if (mode !== 'phone') togglePhone(); phone.tab = tab; phone.render(); },
  quiz: (item) => quiz(item),
  logWin: (id) => P.logWin(id),
  sfx: (k) => audio.sfx(k),
});
getWorld('kent'); // home first; the other cities build on demand (travel compiles them during the flight)
world = getWorld(state.world in builders ? state.world : 'monaco');
renderer.compile(world.scene, camera);
startBtn.disabled = false;
startBtn.textContent = 'Enter';
frame();

// debug handle for testing in the console
window.__game = {
  get world() { return world; }, get car() { return car; }, get mode() { return mode; }, player, keys, camera, pipeline, renderer,
  state, P, phone, audio, songs, ytradio, worlds, togglePhone, interact, enterWorld, hud, startLesson, startTest, setLearnerTrans, setLessonCar, goUK, goHome,
  get lesson() { return lesson; }, drive, autoDrive: false,
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
if (import.meta.env.DEV) import('./devtest.js');
