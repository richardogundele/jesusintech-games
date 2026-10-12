// Saved progress. Lives in this browser only.
// addFunds() is the hook for the "real-life wins unlock rewards" idea; nothing calls it yet.
const KEY = 'dreamlife.v1';
const DEFAULTS = { balance: 50_000_000, world: 'monaco', log: [] };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
}

export function addFunds(amount, reason = '') {
  state.balance += amount;
  state.log.push({ amount, reason, at: new Date().toISOString() });
  save();
}

export function formatMoney(n) {
  return '€' + Math.round(n).toLocaleString('en-GB');
}
