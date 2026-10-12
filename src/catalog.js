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

export const JETS = {
  g700: {
    maker: 'Gulfstream', model: 'G700', stripe: 0xc9a24a,
    range: '7,750 nm', speed: 'Mach 0.925', seats: 'Up to 19 passengers',
  },
  global7500: {
    maker: 'Bombardier', model: 'Global 7500', stripe: 0x14161b,
    range: '7,700 nm', speed: 'Mach 0.925', seats: 'Up to 19 passengers',
  },
};

export const ROUTES = {
  monaco: { to: 'dubai', label: 'Dubai', time: '6h 05m' },
  dubai: { to: 'monaco', label: 'Monaco', time: '6h 50m' },
};
