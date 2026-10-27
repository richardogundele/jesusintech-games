// Optional sign-in (Supabase): your progress follows you between browsers. Nothing here is needed
// to play; without an account the game saves in this browser only, as it always has.
//   saves  one row per player: the whole saved state, newest copy wins when you sign in
//   tests  one row per mock or real driving test
// The URL and publishable key are public by design; row level security keeps each player to their own rows.
import { createClient } from '@supabase/supabase-js';
import { state, save, replaceState, onSave } from './state.js';

const URL = 'https://ojjpbmnppauavrxmfdas.supabase.co';
const KEY = 'sb_publishable_tvRKUPtwprvM8DNANe01AA_DA7-WW4_';

const sb = createClient(URL, KEY);
let user = null;
let pushTimer = null;
const listeners = new Set();
const notify = () => { for (const f of listeners) f(user); };

/** the signed-in user (null when playing without an account) */
export const cloudUser = () => user;
/** watch sign-in and sign-out (the phone redraws its Profile tab) */
export const onCloud = (f) => { listeners.add(f); return () => listeners.delete(f); };

/** email a sign-in link (no password); the link brings you back here signed in */
export async function signIn(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'That does not look like an email address' };
  const { error } = await sb.auth.signInWithOtp({ email: e, options: { emailRedirectTo: location.origin + location.pathname } });
  return { error: error?.message || null };
}
export async function signOut() {
  await sb.auth.signOut();
  user = null;
  notify();
}

/** copy this browser's save to the cloud (a few seconds after each save, so a drive isn't a write storm) */
function schedulePush() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 3000);
}
async function push() {
  if (!user) return;
  const uk = state.uk;
  const { error } = await sb.from('saves').upsert({
    user_id: user.id, data: state, plate: uk.plate || null, paint: uk.paint ?? null, trans: uk.trans, licence: uk.licence || null,
    updated_at: new Date(state.savedAt || Date.now()).toISOString(),
  });
  if (error) console.warn('cloud save failed', error.message);
}

/** on sign-in: the newer of the cloud save and this browser's save wins */
async function pull() {
  const { data, error } = await sb.from('saves').select('data, updated_at').eq('user_id', user.id).maybeSingle();
  if (error) { console.warn('cloud load failed', error.message); return 'error'; }
  if (!data) { await push(); return 'pushed'; }
  const cloudAt = Date.parse(data.updated_at) || 0, localAt = state.savedAt || 0;
  if (cloudAt > localAt + 1000 && data.data && typeof data.data === 'object') {
    replaceState(data.data);
    return 'pulled';
  }
  await push();
  return 'pushed';
}

/** one row per driving test; t is the entry main.js puts in state.uk.history */
export async function recordTest(t) {
  if (!user) return;
  const { error } = await sb.from('tests').insert({
    user_id: user.id, taken_at: t.at, kind: t.kind, centre: t.centre, centre_name: t.centreName, trans: t.trans,
    passed: t.passed, minor: t.minor, serious: t.serious, dangerous: t.dangerous, main_fault: t.main || null, seed: t.seed, rows: t.rows,
  });
  if (error) console.warn('cloud test record failed', error.message);
}

/** start watching the session; hooks.onPulled runs when a newer cloud save replaced this browser's */
export function startCloud(hooks = {}) {
  onSave(schedulePush);
  sb.auth.onAuthStateChange(async (event, session) => {
    const was = user?.id;
    user = session?.user || null;
    if (user && user.id !== was) {
      const how = await pull();
      if (how === 'pulled') hooks.onPulled?.();
    }
    notify();
  });
}
