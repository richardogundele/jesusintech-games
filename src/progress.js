// Progress: what you own, what you have driven, purchases and repairs.
// Everything flows through emit(event, data); main.js reports what happened in the world.
import { state, save, addFunds, today, shortMoney } from './state.js';
import { CARS, JETS, STARTER_CARS, STARTER_JETS } from './catalog.js';

let notify = () => {};
/** fn({ title, amount, kind }) is called for every reward, purchase and milestone. */
export function onNotify(fn) { notify = fn; }

// ---------- ownership ----------
// a written-off car isn't yours until you re-buy it from the dealer
export const ownsCar = (id) => (STARTER_CARS.includes(id) || state.owned.cars.some((c) => c.id === id)) && !state.cars.writtenOff.includes(id);
export const isWrittenOff = (id) => state.cars.writtenOff.includes(id);
export const carCondition = (id) => (id && id !== 'learner' ? (state.cars.condition[id] ?? 100) : 100);
export const ownsJet = (id) => STARTER_JETS.includes(id) || state.owned.jets.includes(id);
export const ownedJetIds = () => Object.keys(JETS).filter(ownsJet);
/** Bought cars that live in this world (delivered to the home you were at when you bought them). */
export const boughtCarsIn = (worldId) => state.owned.cars.filter((c) => c.world === worldId).map((c) => c.id);

// ---------- events ----------
let dirty = false;
/** what happened in the world: the distance and top-speed stats come from here */
export function emit(evt, data) {
  const s = state.stats;
  if (evt === 'km') { s.km += data; dirty = true; }
  if (evt === 'speed' && data > s.topKmh) { s.topKmh = Math.round(data); dirty = true; }
}

/** Call every frame; batches saves for the high-frequency stats. */
let saveTimer = 0;
export function tick(dt) {
  saveTimer += dt;
  if (dirty && saveTimer > 4) { save(); dirty = false; saveTimer = 0; }
}

export function buyCar(id, homeId) {
  const c = CARS[id];
  if (!c?.price || ownsCar(id) || !spend(c.price, `Bought ${c.maker} ${c.model}`)) return false;
  const off = state.cars.writtenOff.indexOf(id);
  if (off >= 0) state.cars.writtenOff.splice(off, 1);
  state.cars.condition[id] = 100; // fresh off the forecourt
  if (!state.owned.cars.some((x) => x.id === id)) state.owned.cars.push({ id, world: homeId });
  save();
  notify({ kind: 'buy', title: `${c.maker} ${c.model} delivered`, amount: -c.price });
  return true;
}
// ---------- crash damage ----------
const WRITEOFF = 11; // m/s into something solid ~ 25 mph: the car is a write-off
/**
 * Apply a crash to the car you were driving. `sev` is the impact speed (m/s). Deducts a repair bill
 * scaled by the car's value and severity (2-15%); a hard hit (>= WRITEOFF) or wearing the condition
 * down to 0 writes it off — undrivable until re-bought from the dealer. The learner's instruction
 * car (id 'learner', or any car with no list value) is insured and can't be written off: you pay the
 * excess. Returns { cost, writeOff, condition, insured, car }.
 */
export function damageCar(id, sev) {
  const c = CARS[id], price = c?.price || 0;
  if (!id || id === 'learner' || !price) { // the instructor's Polo: insured, excess only
    const excess = Math.min(5000, Math.round(400 + sev * 250));
    addFunds(-Math.min(excess, Math.max(0, state.balance)), 'Insurance excess (crash)');
    save();
    return { cost: excess, writeOff: false, condition: 100, insured: true, car: 'the instruction car' };
  }
  const was = state.cars.condition[id] ?? 100;
  const condition = Math.max(0, was - Math.round(sev * 4.5));
  const writeOff = sev >= WRITEOFF || condition <= 0;
  // a write-off's real cost is losing the car (you re-buy it); on top of that just a tow fee, not the
  // whole value again. A repair is a share of the value by how hard you hit.
  const cost = Math.round(price * (writeOff ? 0.05 : Math.min(0.15, Math.max(0.02, sev / 30))));
  addFunds(-Math.min(cost, Math.max(0, state.balance)), writeOff ? `Wrote off ${c.maker} ${c.model} (tow)` : `Crash repairs: ${c.maker} ${c.model}`);
  if (writeOff) { state.cars.condition[id] = 0; if (!state.cars.writtenOff.includes(id)) state.cars.writtenOff.push(id); }
  else state.cars.condition[id] = condition;
  save();
  return { cost, writeOff, condition: writeOff ? 0 : condition, insured: false, car: `${c.maker} ${c.model}` };
}
/** Repair a damaged (not written-off) car: 40 % of value scaled by how much condition is missing. */
export function repairCar(id) {
  const c = CARS[id]; if (!c?.price) return false;
  const cond = state.cars.condition[id] ?? 100;
  if (cond >= 100 || state.cars.writtenOff.includes(id)) return false;
  const cost = Math.max(1, Math.round(c.price * ((100 - cond) / 100) * 0.4));
  if (!spend(cost, `Repaired ${c.maker} ${c.model}`)) return false;
  state.cars.condition[id] = 100;
  save();
  notify({ kind: 'buy', title: `${c.maker} ${c.model} repaired`, amount: -cost });
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
