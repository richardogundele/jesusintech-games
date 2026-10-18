// The reward loop: daily goals, streaks, real-life wins, purchases, fame.
// Everything flows through emit(event, data); main.js reports what happened in the world.
import { state, save, addFunds, today, shortMoney } from './state.js';
import { CARS, JETS, STARTER_CARS, STARTER_JETS, WINS, GIVING, fameLevel } from './catalog.js';

let notify = () => {};
/** fn({ title, amount, kind }) is called for every reward, purchase and milestone. */
export function onNotify(fn) { notify = fn; }

// ---------- ownership ----------
export const ownsCar = (id) => STARTER_CARS.includes(id) || state.owned.cars.some((c) => c.id === id);
export const ownsJet = (id) => STARTER_JETS.includes(id) || state.owned.jets.includes(id);
export const ownedJetIds = () => Object.keys(JETS).filter(ownsJet);
/** Bought cars that live in this world (delivered to the home you were at when you bought them). */
export const boughtCarsIn = (worldId) => state.owned.cars.filter((c) => c.world === worldId).map((c) => c.id);

// ---------- daily goals ----------
// The first goal is always a real-life one, so the game nudges the real day too.
const REAL = [
  { id: 'win', text: 'Log a real-life win', evt: 'win', target: 1 },
  { id: 'win2', text: 'Log 2 real-life wins', evt: 'win', target: 2 },
  { id: 'win3', text: 'Log 3 real-life wins', evt: 'win', target: 3 },
];
const PLAY = [
  { id: 'drive5', text: 'Drive 5 km', evt: 'km', target: 5, unit: 'km' },
  { id: 'drive12', text: 'Drive 12 km', evt: 'km', target: 12, unit: 'km' },
  { id: 'speed250', text: 'Hit 250 km/h', evt: 'speed', test: (v) => v >= 250 },
  { id: 'speed320', text: 'Hit 320 km/h', evt: 'speed', test: (v) => v >= 320 },
  { id: 'fly', text: 'Fly to another city', evt: 'fly' },
  { id: 'gardens', text: 'Walk through Manchester city centre', evt: 'place', test: (p) => p === 'Manchester city centre' },
  { id: 'talk', text: 'Give a talk at the London Arena', evt: 'talk' },
  { id: 'trial', text: 'Finish a time trial', evt: 'trial' },
  { id: 'gold', text: 'Win gold in a time trial', evt: 'trial', test: (m) => m === 'gold' },
  { id: 'casino', text: 'Visit the Bullring in Birmingham', evt: 'place', test: (p) => p === 'Birmingham city centre' },
  { id: 'downtown', text: 'Drive a motorway leg to another city', evt: 'roadtrip' },
  { id: 'give', text: 'Fund a giving project', evt: 'give' },
  { id: 'jetpark', text: 'Visit your Kent jet park', evt: 'place', test: (p) => p === 'Jet Park' },
  { id: 'lesson', text: 'Pass a UK driving lesson', evt: 'lesson' },
];
const ALL = Object.fromEntries([...REAL, ...PLAY].map((g) => [g.id, g]));
export const GOAL_REWARD = 500_000;
export const ALL_DONE_BONUS = 2_000_000;

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return today(d);
}

/** Roll today's goals if the date changed; also breaks a streak you missed a day of. */
export function ensureDaily() {
  const t = today();
  if (state.daily.date === t) return;
  const rnd = seeded(t);
  const real = REAL[Math.floor(rnd() * REAL.length)];
  const pool = [...PLAY];
  const picks = [];
  while (picks.length < 2) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  // don't ask for two of the same thing
  if (picks[0].evt === picks[1].evt) picks[1] = pool.find((g) => g.evt !== picks[0].evt);
  state.daily = { date: t, goals: [real, ...picks].map((g) => ({ id: g.id, progress: 0, done: false })), bonus: false };
  if (state.streak.last !== t && state.streak.last !== yesterday()) state.streak.count = 0;
  save();
}

export const streakMultiplier = () => 1 + Math.min(state.streak.count, 10) * 0.1;

export function dailyGoals() {
  ensureDaily();
  return state.daily.goals.map((g) => {
    const def = ALL[g.id];
    const target = def.target || 1;
    const shown = def.unit ? `${Math.min(target, g.progress).toFixed(1)} / ${target} ${def.unit}` : target > 1 ? `${Math.min(target, g.progress)} / ${target}` : '';
    return { ...g, text: def.text, shown };
  });
}

// ---------- events ----------
let dirty = false;
export function emit(evt, data) {
  ensureDaily();
  const s = state.stats;
  if (evt === 'km') { s.km += data; dirty = true; }
  if (evt === 'speed' && data > s.topKmh) { s.topKmh = Math.round(data); dirty = true; }
  for (const g of state.daily.goals) {
    const def = ALL[g.id];
    if (g.done || def.evt !== evt) continue;
    if (def.test && !def.test(data)) continue;
    g.progress += evt === 'km' ? data : 1;
    if (g.progress >= (def.target || 1)) completeGoal(g, def);
  }
}

function completeGoal(g, def) {
  g.done = true;
  const amount = Math.round(GOAL_REWARD * streakMultiplier());
  addFunds(amount, `Daily goal: ${def.text}`);
  notify({ kind: 'goal', title: `Daily goal done · ${def.text}`, amount });
  if (!state.daily.bonus && state.daily.goals.every((x) => x.done)) {
    state.daily.bonus = true;
    const t = today();
    if (state.streak.last !== t) {
      state.streak.count = state.streak.last === yesterday() ? state.streak.count + 1 : 1;
      state.streak.last = t;
    }
    const bonus = Math.round(ALL_DONE_BONUS * streakMultiplier());
    addFunds(bonus, 'All daily goals done');
    setTimeout(() => notify({ kind: 'bonus', title: `All three done · ${state.streak.count}-day streak`, amount: bonus }), 1800);
  }
  save();
}

/** Call every frame; batches saves for the high-frequency stats. */
let saveTimer = 0;
export function tick(dt) {
  saveTimer += dt;
  if (dirty && saveTimer > 4) { save(); dirty = false; saveTimer = 0; }
}

// ---------- real-life wins ----------
export function winsToday() {
  if (state.wins.date !== today()) state.wins = { date: today(), counts: {} };
  return state.wins.counts;
}
export const WIN_CAP = 3;
export function logWin(id) {
  const w = WINS.find((x) => x.id === id);
  const counts = winsToday();
  if (!w || (counts[id] || 0) >= WIN_CAP) return false;
  counts[id] = (counts[id] || 0) + 1;
  addFunds(w.amount, `Real win: ${w.label}`);
  notify({ kind: 'win', title: w.label, amount: w.amount });
  emit('win');
  save();
  return true;
}

// ---------- spending ----------
function spend(price, reason) {
  if (state.balance < price) return false;
  addFunds(-price, reason);
  return true;
}
/** Buy a car; it's delivered to `homeId` (your Kent home). */
export function buyCar(id, homeId) {
  const c = CARS[id];
  if (!c?.price || ownsCar(id) || !spend(c.price, `Bought ${c.maker} ${c.model}`)) return false;
  state.owned.cars.push({ id, world: homeId });
  save();
  notify({ kind: 'buy', title: `${c.maker} ${c.model} delivered to your home in Kent`, amount: -c.price });
  return true;
}
export function buyJet(id) {
  const j = JETS[id];
  if (!j?.price || ownsJet(id) || !spend(j.price, `Bought ${j.maker} ${j.model}`)) return false;
  state.owned.jets.push(id);
  save();
  notify({ kind: 'buy', title: `${j.maker} ${j.model} is waiting at your Kent jet park`, amount: -j.price });
  return true;
}
export function give(id) {
  const g = GIVING.find((x) => x.id === id);
  if (!g || !spend(g.price, `Gave: ${g.label}`)) return false;
  state.stats.impact += g.impact;
  save();
  notify({ kind: 'give', title: `${g.label} · ${g.impact.toLocaleString('en-GB')} lives`, amount: -g.price });
  emit('give');
  return true;
}

// ---------- the stage ----------
/** Record a finished talk; returns the fee. Notifies level-ups. */
export function recordTalk(crowd, fee) {
  const before = fameLevel(state.reached).level;
  state.reached += crowd;
  state.stats.talks += 1;
  addFunds(fee, `Speaking fee · ${crowd.toLocaleString('en-GB')} people`);
  const after = fameLevel(state.reached);
  emit('talk');
  if (after.level > before) setTimeout(() => notify({ kind: 'level', title: `You're now a ${after.title}. Your speaking fee just went up.` }), 3500);
  save();
}

export function recordFlight() {
  state.stats.flights += 1;
  emit('fly');
  save();
}

export function netWorth() {
  const cars = state.owned.cars.reduce((s, c) => s + (CARS[c.id]?.price || 0), 0);
  const jets = state.owned.jets.reduce((s, id) => s + (JETS[id]?.price || 0), 0);
  return state.balance + cars + jets;
}
export { shortMoney };
