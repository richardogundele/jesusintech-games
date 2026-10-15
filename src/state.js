// Saved progress. Lives in this browser only.
// Older saves only had { balance, world, log, reached }: every nested field below gets
// filled in on load, so nothing you already had is lost or reset.
const KEY = 'dreamlife.v1';
const DEFAULTS = () => ({
  balance: 50_000_000,
  world: 'kent',
  log: [],
  reached: 0,
  owned: { cars: [], jets: [] },       // bought after launch; the starting fleet is always yours
  stats: { km: 0, topKmh: 0, talks: 0, flights: 0, trials: 0, impact: 0 },
  best: {},                            // time trial id -> best seconds
  daily: { date: '', goals: [], bonus: false },
  streak: { count: 0, last: '' },      // days in a row with all three daily goals done
  wins: { date: '', counts: {} },      // real-life wins logged today, per category
  radio: false,
  uk: { lessons: {}, licence: false, tests: 0 }, // driving lessons in Whitmore
  look: { outfit: 'Realistic soldier', camo: 'Woodland', top: 'Royal blue', jeans: 'Dark denim', skin: 'Brown' }, // what you're wearing
  lookV: 2, // bump to move existing saves onto a new default outfit once
  homeV: 1, // bump to move existing saves to a new home once
  songs: { on: false, shuffle: false, volume: 0.8, last: null, yt: false }, // your own music (the files live in IndexedDB) and the YouTube radio
});

function load() {
  const d = DEFAULTS();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* corrupt: start fresh */ }
  const out = { ...d, ...saved };
  for (const k of ['owned', 'stats', 'best', 'daily', 'streak', 'wins', 'uk', 'look', 'songs']) {
    out[k] = { ...d[k], ...(saved[k] && typeof saved[k] === 'object' ? saved[k] : {}) };
  }
  out.owned.cars = Array.isArray(out.owned.cars) ? out.owned.cars : [];
  out.owned.jets = Array.isArray(out.owned.jets) ? out.owned.jets : [];
  out.log = Array.isArray(out.log) ? out.log : [];
  if ((saved.lookV || 0) < 2) { out.look.outfit = 'Realistic soldier'; out.lookV = 2; } // Richard chose the realistic soldier (2026-10-14)
  if ((saved.homeV || 0) < 1) { out.world = 'kent'; out.homeV = 1; } // home moved to Kent (2026-10-15)
  return out;
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
}

export function addFunds(amount, reason = '') {
  state.balance += amount;
  state.log.push({ amount, reason, at: new Date().toISOString() });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  save();
}

export function formatMoney(n) {
  return '€' + Math.round(n).toLocaleString('en-GB');
}

export function shortMoney(n) {
  if (n >= 1e9) return `€${+(n / 1e9).toFixed(2)}bn`;
  if (n >= 1e6) return `€${+(n / 1e6).toFixed(1)}m`;
  if (n >= 1e3) return `€${Math.round(n / 1e3)}k`;
  return `€${n}`;
}

/** Local calendar date, so "today" means your today. */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
