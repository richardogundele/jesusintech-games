// "Name this sign": Highway Code signs drawn by src/signs.js, four answers each. The instructor asks one
// at red lights in lessons (never on a test, and it isn't marked), and the phone can drill ten at home.
import { signTexture } from './signs.js';

// the meanings in plain Highway Code words (the sign list's names carry drawing notes)
const BANK = [
  ['speed_20', 'Maximum speed 20 mph'], ['speed_30', 'Maximum speed 30 mph'], ['speed_40', 'Maximum speed 40 mph'], ['speed_50', 'Maximum speed 50 mph'],
  ['speed_60', 'Maximum speed 60 mph'], ['speed_70', 'Maximum speed 70 mph'], ['speed_nsl', 'National speed limit applies'], ['zone_20', 'Start of a 20 mph zone'],
  ['stop', 'Stop and give way'], ['give_way', 'Give way to traffic on the major road'], ['no_entry', 'No entry for vehicular traffic'], ['one_way', 'One-way traffic'],
  ['ahead_only', 'Ahead only'], ['turn_left', 'Turn left'], ['keep_left', 'Keep left'], ['no_right_turn', 'No right turn'], ['no_left_turn', 'No left turn'],
  ['no_u_turn', 'No U-turns'], ['mini_roundabout', 'Mini-roundabout: give way to traffic from the right'], ['roundabout_ahead', 'Roundabout ahead'],
  ['crossroads', 'Crossroads ahead'], ['t_junction', 'T-junction ahead'], ['side_road', 'Side road ahead'], ['bend_right', 'Bend to the right'],
  ['double_bend', 'Double bend, first to the left'], ['dual_carriageway_ends', 'Dual carriageway ends'], ['road_narrows_both', 'Road narrows on both sides'],
  ['traffic_signals_ahead', 'Traffic signals ahead'], ['zebra_crossing_ahead', 'Zebra crossing ahead'], ['pedestrians_in_road', 'Pedestrians in the road ahead'],
  ['school_children', 'Children going to or from school'], ['road_humps', 'Road humps ahead'], ['slippery_road', 'Slippery road'], ['two_way_traffic', 'Two-way traffic straight ahead'],
];

/** one question: { title, q, a: [right, wrong, wrong, wrong], img } (img a data URL, or null if it can't be drawn) */
export function signQuestion(rnd = Math.random) {
  const [id, right] = BANK[Math.floor(rnd() * BANK.length)];
  const others = BANK.filter(([k]) => k !== id).map(([, n]) => n);
  const wrong = [];
  while (wrong.length < 3) { const n = others[Math.floor(rnd() * others.length)]; if (!wrong.includes(n)) wrong.push(n); }
  let img = null;
  try { img = signTexture(id)?.image?.toDataURL?.() || null; } catch { img = null; }
  return { title: 'Name this sign', q: 'What does this sign mean?', a: [right, ...wrong], img };
}
