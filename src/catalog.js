// Real names, real-ish numbers.
// topSpeed in km/h, accel in m/s^2 (roughly 0-100 time), grip = lateral grip, mass feel via steerResponse.

export const CARS = {
  revuelto: {
    gltf: 'car_revuelto', fit: { yaw: 0, wheels: /^Wheel_[FB][LR]$/, paint: /^Body$/ },
    loft: 'revuelto',
    price: 450_000, maker: 'Lamborghini', model: 'Revuelto', type: 'super',
    color: 0x9fd13a, topSpeed: 350, accel: 11.5, grip: 7.5, steer: 0.62, engine: 'v12',
    dims: { L: 4.95, W: 2.05 },
  },
  f458: {
    // real scanned model in local dev only (licence unconfirmed); a lofted body on the public site
    price: 230_000, maker: 'Ferrari', model: '458 Italia', type: 'super', loft: 'revuelto', ...(import.meta.env.PROD ? {} : { gltf: 'ferrari' }),
    color: 0xa30b12, topSpeed: 325, accel: 11.5, grip: 8, steer: 0.64, engine: 'v8',
    dims: { L: 4.53, W: 1.94 },
  },
  cullinan: {
    gltf: 'car_cullinan', fit: { yaw: 0, wheels: /^wheel_[fr][lr]$/, paint: /^colored$/, tint: true }, // its paint is baked red: tint it
    loft: 'cullinan',
    price: 360_000, maker: 'Rolls-Royce', model: 'Cullinan', type: 'suv',
    color: 0x16181d, topSpeed: 250, accel: 6.5, grip: 6, steer: 0.55, engine: 'v12soft',
    dims: { L: 5.34, W: 2.16 },
  },
  chiron: {
    gltf: 'car_chiron', fit: { yaw: -Math.PI / 2, wheels: /^Wheel-[FB][LR]$/, paint: /^Body$/ },
    loft: 'chiron',
    price: 3_200_000, maker: 'Bugatti', model: 'Chiron Sport', type: 'super',
    color: 0x1d4fb8, accent: 0x0b0d12, topSpeed: 420, accel: 12.5, grip: 7.2, steer: 0.58, engine: 'w16',
    dims: { L: 4.54, W: 2.04 },
  },
  g63: {
    gltf: 'car_g63', fit: { yaw: 0, wheels: /^(front|back)_tyre/, split: true, paint: /^jeep__paint$/ }, // GLTFLoader turns spaces in node names into underscores
    loft: 'g63',
    price: 180_000, maker: 'Mercedes-AMG', model: 'G 63', type: 'box',
    color: 0x15161a, topSpeed: 220, accel: 7, grip: 5.5, steer: 0.56, engine: 'v8',
    dims: { L: 4.87, W: 1.98 },
  },
  // ---- everyday cars you own: good for driving lessons (an L-plated learner, not a taxi) ----
  tesla: {
    loft: 'tesla',
    price: 90_000, maker: 'Tesla', model: 'Model S', type: 'sedan',
    color: 0xeceff3, topSpeed: 250, accel: 9, grip: 6.6, steer: 0.58, engine: 'i4',
    dims: { L: 4.97, W: 1.96 },
  },
  lexus: {
    loft: 'lexus',
    price: 48_000, maker: 'Lexus', model: 'ES 300h', type: 'sedan',
    color: 0xb9bec6, topSpeed: 200, accel: 6, grip: 6, steer: 0.56, engine: 'i4',
    dims: { L: 4.98, W: 1.87 },
  },
  // ---- for sale at the dealer (bought cars are delivered to whichever home you're at) ----
  urus: {
    loft: 'cullinan', price: 260_000,
    maker: 'Lamborghini', model: 'Urus SE', type: 'suv',
    color: 0xf2c200, topSpeed: 312, accel: 9, grip: 6.5, steer: 0.58, engine: 'v8',
    dims: { L: 5.12, W: 2.02 },
  },
  spectre: {
    loft: 'sedan', price: 450_000,
    maker: 'Rolls-Royce', model: 'Spectre', type: 'sedan',
    color: 0x2a3a5c, topSpeed: 250, accel: 7, grip: 6, steer: 0.55, engine: 'v12soft',
    dims: { L: 5.45, W: 2.08 },
  },
  batur: {
    loft: 'sedan', price: 2_000_000,
    maker: 'Bentley', model: 'Batur', type: 'sedan',
    color: 0x1f4d36, topSpeed: 336, accel: 9.5, grip: 7, steer: 0.58, engine: 'w16',
    dims: { L: 4.95, W: 1.97 },
  },
  w1: {
    loft: 'revuelto', price: 2_100_000,
    maker: 'McLaren', model: 'W1', type: 'super',
    color: 0xff7a00, topSpeed: 350, accel: 13, grip: 8.2, steer: 0.64, engine: 'v8',
    dims: { L: 4.92, W: 2.08 },
  },
  jesko: {
    loft: 'revuelto', price: 3_000_000,
    maker: 'Koenigsegg', model: 'Jesko Absolut', type: 'super',
    color: 0xf3f3f1, accent: 0x0b0d12, topSpeed: 440, accel: 12.5, grip: 7.6, steer: 0.6, engine: 'v8',
    dims: { L: 4.61, W: 2.03 },
  },
  tourbillon: {
    loft: 'chiron', price: 3_800_000,
    maker: 'Bugatti', model: 'Tourbillon', type: 'super',
    color: 0xbfc5cc, accent: 0x1d4fb8, topSpeed: 445, accel: 13.5, grip: 7.6, steer: 0.6, engine: 'w16',
    dims: { L: 4.67, W: 2.04 },
  },
};
// the driving-school car in Whitmore (not for sale, so it isn't in CARS)
export const LEARNER = {
  gltf: 'car_polo', fit: { yaw: Math.PI / 2, wheels: /^wheel_sto/ },
  loft: 'sedan', maker: 'Volkswagen', model: 'Polo (learner)', type: 'sedan',
  color: 0xf2f2f0, topSpeed: 187, accel: 4.4, grip: 7.5, steer: 0.66, engine: 'i4',
  dims: { L: 4.07, W: 1.75 },
};
// the fleet you started with: always yours
export const STARTER_CARS = ['revuelto', 'f458', 'cullinan', 'chiron', 'g63', 'tesla', 'lexus'];

// unbranded traffic: body shape + paint picked at random
export const TRAFFIC = [
  { loft: 'sedan', dims: { L: 4.9, W: 1.88 }, colors: [0x111316, 0xe8e8e6, 0x6b7177, 0x1d2b44, 0x3b3f44], topSpeed: 200, accel: 6, grip: 6, steer: 0.55, engine: 'v8', type: 'sedan' },
  { loft: 'cullinan', dims: { L: 5.2, W: 2.05 }, colors: [0x0e0f12, 0xf0efea, 0x2b2f35], topSpeed: 220, accel: 6, grip: 6, steer: 0.55, engine: 'v8', type: 'suv' },
  { loft: 'g63', dims: { L: 4.87, W: 1.98 }, colors: [0x0e0f12, 0xffffff, 0x4a4d52], topSpeed: 200, accel: 6, grip: 5.5, steer: 0.55, engine: 'v8', type: 'box' },
  { loft: 'revuelto', dims: { L: 4.7, W: 2.0 }, colors: [0xf2c200, 0xffffff, 0x0b0b0c, 0x1c4fb0, 0xa30b12, 0x2f7d3a], topSpeed: 300, accel: 10, grip: 8, steer: 0.6, engine: 'v8', type: 'super' },
];

// Real dimensions (m), cruise Mach, range. engines: rear2 | rear3 | wing2. tail: T | cross | low.
export const JETS = {
  g700: { maker: 'Gulfstream', model: 'G700', L: 33.5, span: 31.4, R: 1.45, engines: 'rear2', tail: 'T', win: 10, winW: 0.62, winH: 0.46, stripe: 0xc9a24a, mach: 0.925, range: '7,750 nm', seats: 19 },
  g650er: { maker: 'Gulfstream', model: 'G650ER', L: 30.4, span: 30.4, R: 1.4, engines: 'rear2', tail: 'T', win: 8, winW: 0.6, winH: 0.45, stripe: 0x1b2a44, mach: 0.925, range: '7,500 nm', seats: 19 },
  global7500: { maker: 'Bombardier', model: 'Global 7500', L: 33.8, span: 31.7, R: 1.45, engines: 'rear2', tail: 'T', win: 14, winW: 0.36, winH: 0.42, stripe: 0x14161b, mach: 0.925, range: '7,700 nm', seats: 19 },
  global6500: { maker: 'Bombardier', model: 'Global 6500', L: 30.7, span: 28.7, R: 1.42, engines: 'rear2', tail: 'T', win: 12, winW: 0.36, winH: 0.42, stripe: 0x7a1f2b, mach: 0.9, range: '6,600 nm', seats: 17 },
  falcon10x: { maker: 'Dassault', model: 'Falcon 10X', L: 33.4, span: 33.6, R: 1.55, engines: 'rear2', tail: 'cross', win: 19, winW: 0.4, winH: 0.4, stripe: 0x111111, mach: 0.925, range: '7,500 nm', seats: 16 },
  falcon8x: { maker: 'Dassault', model: 'Falcon 8X', L: 24.5, span: 26.3, R: 1.3, engines: 'rear3', tail: 'cross', win: 14, winW: 0.34, winH: 0.4, stripe: 0x8a6d3b, mach: 0.9, range: '6,450 nm', seats: 16 },
  challenger650: { maker: 'Bombardier', model: 'Challenger 650', L: 20.9, span: 19.6, R: 1.25, engines: 'rear2', tail: 'T', win: 6, winW: 0.4, winH: 0.46, stripe: 0x2b4e8c, mach: 0.85, range: '4,000 nm', seats: 12 },
  praetor600: { maker: 'Embraer', model: 'Praetor 600', L: 20.7, span: 21.5, R: 1.2, engines: 'rear2', tail: 'T', win: 6, winW: 0.4, winH: 0.46, stripe: 0x3a6b8f, mach: 0.83, range: '4,018 nm', seats: 12 },
  longitude: { maker: 'Cessna', model: 'Citation Longitude', L: 22.3, span: 20.7, R: 1.2, engines: 'rear2', tail: 'T', win: 6, winW: 0.42, winH: 0.46, stripe: 0x8c1c1c, mach: 0.84, range: '3,500 nm', seats: 12 },
  bbj: { maker: 'Boeing', model: 'BBJ 737 MAX 7', L: 35.6, span: 35.9, R: 1.9, engines: 'wing2', tail: 'low', win: 16, winW: 0.28, winH: 0.38, stripe: 0x0d2340, mach: 0.79, range: '7,000 nm', seats: 19 },
  acj220: { maker: 'Airbus', model: 'ACJ TwoTwenty', L: 35.0, span: 35.1, R: 1.75, engines: 'wing2', tail: 'low', win: 15, winW: 0.32, winH: 0.4, stripe: 0x35aee2, tailColor: 0x050607, mach: 0.82, range: '5,650 nm', seats: 18, note: 'JesusInTech livery' },
  // ---- for sale (list prices, roughly) ----
  phenom300e: { price: 10_500_000, maker: 'Embraer', model: 'Phenom 300E', L: 15.9, span: 16.2, R: 0.92, engines: 'rear2', tail: 'T', win: 5, winW: 0.42, winH: 0.44, stripe: 0x2c5aa0, mach: 0.78, range: '2,010 nm', seats: 10 },
  pc24: { price: 11_000_000, maker: 'Pilatus', model: 'PC-24', L: 16.9, span: 17.0, R: 0.95, engines: 'rear2', tail: 'T', win: 7, winW: 0.38, winH: 0.42, stripe: 0xb01c2e, mach: 0.63, range: '2,000 nm', seats: 10 },
  g800: { price: 72_000_000, maker: 'Gulfstream', model: 'G800', L: 33.5, span: 31.4, R: 1.45, engines: 'rear2', tail: 'T', win: 10, winW: 0.62, winH: 0.46, stripe: 0x2a2a2a, mach: 0.925, range: '8,000 nm', seats: 19 },
  global8000: { price: 78_000_000, maker: 'Bombardier', model: 'Global 8000', L: 33.8, span: 31.7, R: 1.45, engines: 'rear2', tail: 'T', win: 14, winW: 0.36, winH: 0.42, stripe: 0x8a6d3b, mach: 0.94, range: '8,000 nm', seats: 19, note: 'Fastest business jet' },
  acj350: { price: 340_000_000, maker: 'Airbus', model: 'ACJ350', L: 66.8, span: 64.75, R: 2.98, engines: 'wing2', tail: 'low', win: 34, winW: 0.32, winH: 0.42, stripe: 0x35aee2, tailColor: 0x050607, mach: 0.85, range: '10,800 nm', seats: 25, note: 'The flagship' },
};
export const STARTER_JETS = ['g700', 'g650er', 'global7500', 'global6500', 'falcon10x', 'falcon8x', 'challenger650', 'praetor600', 'longitude', 'bbj', 'acj220'];

// ---- the reward loop ----
// Real-life wins, honour system. Up to 3 per category per day.
export const WINS = [
  { id: 'client', label: 'Closed a client or Agents deal', amount: 3_000_000 },
  { id: 'gig', label: 'Booked a speaking gig', amount: 2_000_000 },
  { id: 'aios', label: 'New AIOS student or sale', amount: 1_000_000 },
  { id: 'ship', label: 'Shipped a build (SPath, Agents, AIOS)', amount: 750_000 },
  { id: 'book', label: 'Wrote for the book', amount: 500_000 },
  { id: 'post', label: 'Posted content', amount: 300_000 },
  { id: 'train', label: 'Trained or worked out', amount: 200_000 },
  { id: 'quiet', label: 'Quiet time with God', amount: 200_000 },
];

// Giving: repeatable, adds to "lives impacted"
export const GIVING = [
  { id: 'scholar', label: '100 AIOS scholarships', price: 5_000_000, impact: 100 },
  { id: 'lab', label: 'AI lab for a church in Lagos', price: 15_000_000, impact: 2_000 },
  { id: 'wells', label: 'Clean water wells for a region', price: 25_000_000, impact: 20_000 },
  { id: 'school', label: 'Build a school', price: 40_000_000, impact: 5_000 },
];

// Fame comes from people reached on stage. It raises your speaking fee.
export const FAME = [
  { at: 0, title: 'New Voice' },
  { at: 5_000, title: 'Speaker' },
  { at: 25_000, title: 'Keynote Speaker' },
  { at: 75_000, title: 'Headliner' },
  { at: 200_000, title: 'Global Voice' },
  { at: 500_000, title: 'Movement Leader' },
  { at: 1_000_000, title: 'Household Name' },
];
export function fameLevel(reached) {
  let i = 0;
  while (i + 1 < FAME.length && reached >= FAME[i + 1].at) i++;
  return { level: i, ...FAME[i], next: FAME[i + 1] || null };
}
export const talkFee = (reached, crowd) => 250_000 + fameLevel(reached).level * 250_000 + crowd * 20;

// The UK cities you can fly or drive between, and great-circle distances (km)
export const CITIES = { kent: { name: 'Kent' }, london: { name: 'London' }, birmingham: { name: 'Birmingham' }, manchester: { name: 'Manchester' } };
// great-circle km; Kent flights measured from Manston. Every hop is short: no fuel stops in the UK.
const KM = { 'kent-london': 95, 'birmingham-kent': 250, 'kent-manchester': 345, 'birmingham-london': 165, 'london-manchester': 265, 'birmingham-manchester': 115 };
const STOPS = {};
// the motorway you take by road, and the miles (the drive is compressed but the signs are real)
export const ROADS_BETWEEN = {
  'kent-london': { road: 'M20 · M25', miles: 70 }, 'birmingham-kent': { road: 'M20 · M25 · M40', miles: 170 }, 'kent-manchester': { road: 'M25 · M1 · M6', miles: 250 },
  'birmingham-london': { road: 'M40', miles: 120 }, 'london-manchester': { road: 'M1 · M6', miles: 200 }, 'birmingham-manchester': { road: 'M6', miles: 85 },
};
export const roadBetween = (a, b) => ROADS_BETWEEN[[a, b].sort().join('-')];
const key = (a, b) => [a, b].sort().join('-');
export const otherCities = (from) => Object.keys(CITIES).filter((c) => c !== from);
/** null if the jet can make it nonstop, else where it refuels */
export function fuelStop(jet, from, to) {
  const rangeKm = parseFloat(String(jet.range).replace(/,/g, '')) * 1.852;
  return rangeKm < KM[key(from, to)] * 1.05 ? STOPS[key(from, to)] : null;
}
export function flightTime(jet, from = 'monaco', to = 'dubai') {
  const hours = KM[key(from, to)] / (jet.mach * 0.93 * 1062) + 0.35 + (fuelStop(jet, from, to) ? 1.1 : 0);
  const mins = Math.round((hours * 60) / 5) * 5;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

// Richard's radio station: a YouTube channel played through YouTube's own player (see ytradio.js)
export const RADIO_STATION = { name: 'Tribe Fuego', list: 'UU11Ojcr97zmdZilTkq-C1aw', url: 'https://www.youtube.com/@tribefuego', note: 'Jazz-gospel bass, 300+ videos' };
