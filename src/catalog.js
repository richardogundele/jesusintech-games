// Real names, real-ish numbers. Private build only.
// topSpeed in km/h, accel in m/s^2 (roughly 0-100 time), grip = lateral grip, mass feel via steerResponse.

export const CARS = {
  revuelto: {
    maker: 'Lamborghini', model: 'Revuelto', type: 'super',
    color: 0x9fd13a, topSpeed: 350, accel: 11.5, grip: 7.5, steer: 0.62, engine: 'v12',
    dims: { L: 4.95, W: 2.05 },
  },
  sf90: {
    maker: 'Ferrari', model: 'SF90 Stradale', type: 'super',
    color: 0xc4111b, topSpeed: 340, accel: 12, grip: 8, steer: 0.64, engine: 'v8',
    dims: { L: 4.71, W: 1.97 },
  },
  cullinan: {
    maker: 'Rolls-Royce', model: 'Cullinan', type: 'suv',
    color: 0x16181d, topSpeed: 250, accel: 6.5, grip: 6, steer: 0.55, engine: 'v12soft',
    dims: { L: 5.34, W: 2.16 },
  },
  chiron: {
    maker: 'Bugatti', model: 'Chiron Sport', type: 'super',
    color: 0x1d4fb8, accent: 0x0b0d12, topSpeed: 420, accel: 12.5, grip: 7.2, steer: 0.58, engine: 'w16',
    dims: { L: 4.54, W: 2.04 },
  },
  g63: {
    maker: 'Mercedes-AMG', model: 'G 63', type: 'box',
    color: 0x2a2c30, topSpeed: 220, accel: 7, grip: 5.5, steer: 0.56, engine: 'v8',
    dims: { L: 4.87, W: 1.98 },
  },
};

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
