// Real names, real-ish numbers. Private build only.
// topSpeed in km/h, accel in m/s^2 (roughly 0-100 time), grip = lateral grip, mass feel via steerResponse.

export const CARS = {
  revuelto: {
    loft: 'revuelto',
    maker: 'Lamborghini', model: 'Revuelto', type: 'super',
    color: 0x9fd13a, topSpeed: 350, accel: 11.5, grip: 7.5, steer: 0.62, engine: 'v12',
    dims: { L: 4.95, W: 2.05 },
  },
  f458: {
    maker: 'Ferrari', model: '458 Italia', type: 'super', gltf: 'ferrari',
    color: 0xa30b12, topSpeed: 325, accel: 11.5, grip: 8, steer: 0.64, engine: 'v8',
    dims: { L: 4.53, W: 1.94 },
  },
  cullinan: {
    loft: 'cullinan',
    maker: 'Rolls-Royce', model: 'Cullinan', type: 'suv',
    color: 0x16181d, topSpeed: 250, accel: 6.5, grip: 6, steer: 0.55, engine: 'v12soft',
    dims: { L: 5.34, W: 2.16 },
  },
  chiron: {
    loft: 'chiron',
    maker: 'Bugatti', model: 'Chiron Sport', type: 'super',
    color: 0x1d4fb8, accent: 0x0b0d12, topSpeed: 420, accel: 12.5, grip: 7.2, steer: 0.58, engine: 'w16',
    dims: { L: 4.54, W: 2.04 },
  },
  g63: {
    loft: 'g63',
    maker: 'Mercedes-AMG', model: 'G 63', type: 'box',
    color: 0x15161a, topSpeed: 220, accel: 7, grip: 5.5, steer: 0.56, engine: 'v8',
    dims: { L: 4.87, W: 1.98 },
  },
};

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
};

// Nice/Monaco <-> Dubai is about 5,200 km
export function flightTime(jet) {
  const hours = 5200 / (jet.mach * 0.93 * 1062) + 0.35;
  const h = Math.floor(hours), m = Math.round((hours - h) * 60 / 5) * 5;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export const ROUTES = {
  monaco: { to: 'dubai', label: 'Dubai', time: '6h 05m' },
  dubai: { to: 'monaco', label: 'Monaco', time: '6h 50m' },
};
