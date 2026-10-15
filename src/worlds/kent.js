// Kent: Herne Bay, Canterbury and the roads between them at 1:1, built from OpenStreetMap
// (data © OpenStreetMap contributors, ODbL: public/assets/kent/ATTRIBUTION.txt). Richard's home is on
// the Beltinge cliff top, his jets fly from Maypole Airfield. The world streams in 500 m tiles around
// the player: roads and markings (kent/roads.js), buildings / trees / sea (kent/scenery.js), signs
// (kent/signs-place.js). Left-hand traffic, mph. x = east, z = south.
import * as THREE from 'three';
import { setupSky, Colliders } from './common.js';
import { hdri, pbr, misc, instanced } from '../assets.js';
import { markingTexture } from '../signs.js';
import { buildJet } from '../models.js';
import { JETS, STARTER_JETS } from '../catalog.js';
import { state } from '../state.js';
import { RoadNet } from '../kent/net.js';
import { TileManager } from '../kent/tiles.js';
import { makeRoadBuilder, makeRoadMaterials } from '../kent/roads.js';
import { makeSceneryBuilder } from '../kent/scenery.js';
import { makeSignBuilder } from '../kent/signs-place.js';
import { buildKentHouse } from '../kent/house.js';
import { buildAirfield } from '../kent/airfield.js';

// main.js hands the house its hooks (toasts, the phone, quizzes) before the world is built
let hooks = {};
export function setKentHooks(h) { hooks = h; }

export function buildKent(renderer) {
  const data = misc('kentRegion');
  if (!data) throw new Error('Kent region data missing (public/assets/kent/region.json)');
  const net = new RoadNet(data);
  const scene = new THREE.Scene();
  // afternoon sun in the south-west (azimuth 0 = +z = south here)
  const env = setupSky(scene, renderer, {
    hdri: hdri('monaco'), sunAzimuth: 330, exposure: 0.95, envIntensity: 0.9,
    sunColor: 0xfff4e6, sunIntensity: 2.6, fogDensity: 0.0011, fogTint: 0.95,
  });
  const colliders = new Colliders();
  const tickers = [];
  const interactions = [];

  // ground: the land plate (the sea polygon is cut out so the water shows), fields sit just above it
  const scenery = makeSceneryBuilder({ net, tickers, colliders, scene });
  const land = new THREE.Mesh(scenery.landGeometry(-0.05), pbr('leafy_grass', { repeat: [1, 1], color: 0x6f9450 }));
  land.receiveShadow = true;
  scene.add(land);

  // painted arrows / words come from the sign renderer, one material per decal
  const decals = new Map();
  const decal = (id, opts) => {
    const key = `${id}|${JSON.stringify(opts)}`;
    if (!decals.has(key)) decals.set(key, new THREE.MeshStandardMaterial({ map: markingTexture(id, opts), transparent: true, alphaTest: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    return decals.get(key);
  };
  const mats = makeRoadMaterials({ pbr, decal, planting: (spots) => instanced('shrub_01', spots, { maxDist: 600 }) });
  const roads = makeRoadBuilder({ net, colliders, mats });
  // fog is 90 % thick at 1.4 km, so full detail to 1 km and bare roads to 2.5 km is plenty
  const signs = makeSignBuilder({ net, colliders });
  tickers.push((t) => signs.tick(t)); // Belisha beacons blink
  const tiles = new TileManager({ net, scene, builders: [roads, scenery, signs], near: 1000, far: 2500, dropAt: 3200, budgetMs: 4 });

  // home on the cliff top and the jet centre at Maypole
  const house = buildKentHouse({ scene, colliders, tickers, origin: data.home, interactions, hooks, materials: { pbr }, driveEnd: 44 }); // the synthetic "Home Drive" road takes over at the gate
  const bought = state.owned.jets.filter((id) => !STARTER_JETS.includes(id));
  const air = buildAirfield({ scene, colliders, tickers, origin: data.airfield, JETS, STARTER_JETS, buildJet, ownedJets: bought, materials: { pbr } });

  const landmarks = [
    { x: data.home.x, z: data.home.z, color: '#e8c77a', name: 'Home' },
    { x: air.jetPark.x, z: air.jetPark.z, color: '#9ad7ff', name: 'Jets' },
    ...data.testCentres.map((t) => ({ x: t.x, z: t.z, color: '#c9f7a5', name: /canterbury/i.test(t.name) ? 'Canterbury test centre' : 'Herne Bay test centre' })),
    ...data.landmarks.filter((l) => /cathedral|clock tower|reculver towers|^herne bay pier$/i.test(l.name || '')).map((l) => ({ x: l.x, z: l.z, color: '#ffffff', name: l.name })),
  ];

  const player = { x: data.home.x, z: data.home.z + 38, r: 0 };
  let last = 0;
  return {
    id: 'kent', name: 'KENT', units: 'mph', scene, env, colliders, tickers, interactions, net, tiles, house, air,
    get roads() { return tiles.roadsNear(); },
    bounds: data.bounds,
    tick(t) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      tiles.update(this.player?.x ?? player.x, this.player?.z ?? player.z, dt);
      for (const f of tickers) f(t);
    },
    spawn: house.spawn,
    garage: house.garage,
    slots: house.slots,
    learnerAt: house.learnerAt,
    terminal: air.terminal, jetPark: air.jetPark, runway: air.runway, addJet: air.addJet,
    landmarks,
    place(x, z, y = 0) { return house.place(x, z, y) || air.place(x, z) || net.placeAt(x, z); },
    indoors: (x, z) => house.indoors(x, z),
    floorY: (x, z, yPrev) => house.floorY(x, z, yPrev),
    speedLimitAt: (x, z) => net.limitAt(x, z),
    nslAt: (x, z) => net.nslAt(x, z),
    player,
  };
}
