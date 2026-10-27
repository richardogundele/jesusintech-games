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
  welcomed: false, // the first-run toast has been shown
  // driving lessons and tests: licence false | 'auto' (passed in an automatic) | 'full' (passed in a manual);
  // trans: the gearbox you learn in; history: your driving tests (newest last); hints: key hints seen per gearbox
  // paint: a hex colour for your car (null = the car's own colour); plate: your registration (set on first run)
  uk: { lessons: {}, licence: false, tests: 0, trans: 'manual', lessonCar: null, history: [], hints: {}, paint: null, plate: '' },
  // career: every finished drive banks into this, for the overall driver rating (see careerRating)
  career: { drives: 0, passes: 0, fails: 0, minor: 0, serious: 0, dangerous: 0, km: 0, cleanDrives: 0, last10: [] },
  // crash damage: condition 0-100 per car id, and the car ids you wrote off (undrivable until re-bought)
  cars: { condition: {}, writtenOff: [] },
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
  for (const k of ['owned', 'stats', 'best', 'daily', 'streak', 'wins', 'uk', 'look', 'songs', 'career', 'cars']) {
    out[k] = { ...d[k], ...(saved[k] && typeof saved[k] === 'object' ? saved[k] : {}) };
  }
  out.cars.condition = out.cars.condition && typeof out.cars.condition === 'object' ? out.cars.condition : {};
  out.cars.writtenOff = Array.isArray(out.cars.writtenOff) ? out.cars.writtenOff : [];
  out.career.last10 = Array.isArray(out.career.last10) ? out.career.last10.slice(-10) : [];
  out.owned.cars = Array.isArray(out.owned.cars) ? out.owned.cars : [];
  out.owned.jets = Array.isArray(out.owned.jets) ? out.owned.jets : [];
  out.log = Array.isArray(out.log) ? out.log : [];
  if ((saved.lookV || 0) < 2) { out.look.outfit = 'Realistic soldier'; out.lookV = 2; } // Richard chose the realistic soldier (2026-10-14)
  if ((saved.homeV || 0) < 1) { out.world = 'kent'; out.homeV = 1; } // home moved to Kent (2026-10-15)
  // the driving school (2026-10-16): the old boolean licence was won in the old automatic-only car, and a
  // pass in an automatic gives an automatic-only licence (real UK rule), so true becomes 'auto'
  const uk = out.uk;
  if (uk.licence === true) uk.licence = 'auto';
  if (uk.licence !== 'auto' && uk.licence !== 'full') uk.licence = false;
  uk.trans = uk.trans === 'auto' ? 'auto' : 'manual';
  uk.history = Array.isArray(uk.history) ? uk.history.slice(-60) : [];
  // the lessons went (2026-10-26): there are mock tests and the real test now. Every test driven
  // before that was a practice of the same format, so it reads as a mock
  for (const t of uk.history) if (t.kind !== 'real') t.kind = 'mock';
  uk.hints = uk.hints && typeof uk.hints === 'object' ? uk.hints : {};
  uk.paint = Number.isInteger(uk.paint) ? uk.paint : null;
  uk.plate = typeof uk.plate === 'string' ? uk.plate : '';
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

// ---------- overall driver score (a persistent career tally and a derived rating) ----------

/** Bank a finished drive into state.career. r is a FreeExam.result() or LessonRun result. */
export function recordDrive(r) {
  const c = state.career;
  const minor = r.minor ?? r.counts?.minor ?? 0;
  const serious = r.serious ?? r.counts?.serious ?? 0;
  const dangerous = r.dangerous ?? r.counts?.dangerous ?? 0;
  const km = (r.dist || 0) / 1000;
  c.drives += 1;
  if (r.passed) c.passes += 1; else c.fails += 1;
  c.minor += minor; c.serious += serious; c.dangerous += dangerous; c.km += km;
  if (!minor && !serious && !dangerous && km > 0.3) c.cleanDrives += 1;
  c.last10.push({ passed: !!r.passed, minor, serious, dangerous, km: +km.toFixed(2), t: Date.now() });
  if (c.last10.length > 10) c.last10.shift();
  save();
}

/** The driver rating: 0..100 and a letter. DVSA-flavoured but simple. */
export function careerRating() {
  const c = state.career;
  if (!c.drives) return { score: null, grade: null, passRate: null, hint: 'Drive to be scored' };
  // base + bonuses - penalties, each capped so one bad drive doesn't ruin a long record
  const passRate = c.passes / c.drives;
  const minorPerDrive = c.minor / c.drives;
  const seriousRate = c.serious / c.drives, dangerousRate = c.dangerous / c.drives;
  let score = 100;
  score -= Math.min(40, minorPerDrive * 4); // one minor per drive on average = -4
  score -= Math.min(45, seriousRate * 60);  // one serious per drive = -60 (capped)
  score -= Math.min(60, dangerousRate * 90);
  score += Math.min(10, c.km / 10);          // up to +10 for the first 100 km driven
  score += Math.min(10, (passRate - 0.5) * 20); // -10..+10 around a 50 % pass rate
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, passRate, minorPerDrive: +minorPerDrive.toFixed(2), km: +c.km.toFixed(1), drives: c.drives, passes: c.passes };
}
