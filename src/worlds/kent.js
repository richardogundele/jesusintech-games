// Kent: Herne Bay, Canterbury and the roads between them at 1:1, built from OpenStreetMap
// (data © OpenStreetMap contributors, ODbL: public/assets/kent/ATTRIBUTION.txt). Richard's home is on
// the Beltinge cliff top, his jets fly from Maypole Airfield. The world streams in 500 m tiles around
// the player: roads and markings (kent/roads.js), buildings / trees / sea (kent/scenery.js), signs
// (kent/signs-place.js). Traffic lights run in kent/signals.js and live traffic and pedestrians in
// kent/traffic.js. Left-hand traffic, mph. x = east, z = south.
import * as THREE from 'three';
import { setupSky, UK_OVERCAST, Colliders } from './common.js';
import { makeTerrain } from './terrain.js';
import { hdri, pbr, misc, instanced } from '../assets.js';
import { markingTexture } from '../signs.js';
import { buildJet, buildCar, buildPedestrian } from '../models.js';
import { JETS, STARTER_JETS, TRAFFIC } from '../catalog.js';
import { state } from '../state.js';
import { RoadNet } from '../kent/net.js';
import { TileManager } from '../kent/tiles.js';
import { makeRoadBuilder, makeRoadMaterials } from '../kent/roads.js';
import { makeSceneryBuilder } from '../kent/scenery.js';
import { makeSignBuilder } from '../kent/signs-place.js';
import { buildKentHouse } from '../kent/house.js';
import { buildAirfield } from '../kent/airfield.js';
import { SignalSystem } from '../kent/signals.js';
import { KentTraffic } from '../kent/traffic.js';
import { CENTRES, centreOf, testCentreLayout } from '../kent/lesson-routes.js';

// main.js hands the house its hooks (toasts, the phone, quizzes) before the world is built
let hooks = {};
export function setKentHooks(h) { hooks = h; }

export function buildKent(renderer) {
  const data = misc('kentRegion');
  if (!data) throw new Error('Kent region data missing (public/assets/kent/region.json)');
  const net = new RoadNet(data);
  const terrain = makeTerrain(data); // real EU-DEM hills (0 around home/airfield/coast); flat if absent
  // ground height = terrain + a flyover deck under the point (Kent's A299 slip roads are bridges)
  const heightAt = (x, z, prevY = null) => { const t = terrain.heightAt(x, z); return t + net.deckNear(x, z, prevY, t); };
  const gradeAt = (x, z, heading, prevY = null) => { const dx = Math.sin(heading), dz = Math.cos(heading); return (heightAt(x + dx, z + dz, prevY) - heightAt(x - dx, z - dz, prevY)) / 2; };
  const scene = new THREE.Scene();
  // afternoon sun in the south-west (azimuth 0 = +z = south here)
  const env = setupSky(scene, renderer, { ...UK_OVERCAST, sunAzimuth: 330 });
  const colliders = new Colliders();
  const tickers = [];
  const interactions = [];

  // ground: the land plate (the sea polygon is cut out so the water shows), fields sit just above it
  const scenery = makeSceneryBuilder({ net, tickers, colliders, scene, groundY: terrain.has ? terrain.heightAt : null });
  // with hills the land is the terrain grid's own triangles (draped roads agree with it exactly),
  // but the sea polygon is still cut out so the water shows; flat Kent keeps the old single plate
  const land = new THREE.Mesh(
    terrain.has ? terrain.landGeometry(0.12, 1200, scenery.inSea) : scenery.landGeometry(-0.05),
    pbr('leafy_grass', { repeat: [1, 1], color: 0x6f9450 }),
  );
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
  const roads = makeRoadBuilder({ net, colliders, mats, groundY: terrain.has ? terrain.heightAt : null });
  // fog is 90 % thick at 1.4 km, so full detail to 1 km and bare roads to 2.5 km is plenty
  const signs = makeSignBuilder({ net, colliders, groundY: terrain.has ? terrain.heightAt : null });
  tickers.push((t) => signs.tick(t)); // Belisha beacons blink
  const tiles = new TileManager({ net, scene, builders: [roads, scenery, signs], near: 1000, far: 2500, dropAt: 3200, budgetMs: 4 });
  // every set of lights in the region keeps time; the heads the sign tiles build show it
  const signals = new SignalSystem({ net, signsBuilder: signs });
  // live traffic: main.js picks this up as world.traffic (update / collide like the other worlds')
  const traffic = new KentTraffic({ net, scene, signals, bodies: TRAFFIC, buildCar, buildPedestrian, maxCars: 80, maxPeds: 55, groundY: heightAt, gradeAt });

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

  // rings as LessonRun.rbConflict reads them: name = the ring id traffic cars report in lane.rb,
  // lane = the outer lane's radius (its arc maths); every Kent ring circulates clockwise (sense +1)
  const rbs = [...net.roundabouts.values()].map((rb) => ({ name: rb.id, x: rb.x, z: rb.z, lane: rb.laneRadius(1), outer: rb.r, sense: rb.sense }));

  // the eyesight check's parked car at each test centre (main.js builds it): Herne Bay's in the end
  // bay of the car park, nose in; Canterbury's on the forecourt in front of the building, along the road
  const eyesight = Object.keys(CENTRES).map((key) => {
    const L = testCentreLayout(net, centreOf(net, key));
    if (L.bays.length) { const b = L.bays[L.bays.length - 1]; return { centre: key, x: b.x, z: b.z, heading: b.heading }; }
    const h = L.hit, off = h.way.halfW + 6; // L.n points from the building to the road
    return { centre: key, x: h.px - L.n[0] * off, z: h.pz - L.n[1] * off, heading: Math.atan2(h.dir[0], h.dir[1]) };
  });

  const player = { x: data.home.x, z: data.home.z + 38, r: 0 };
  let last = 0;
  return {
    id: 'kent', name: 'KENT', units: 'mph', scene, env, colliders, tickers, interactions, net, tiles, house, air,
    signals, trafficSystem: traffic, rbs, rbSenseSign: rbs.every((r) => r.sense === rbs[0]?.sense) ? rbs[0]?.sense ?? 1 : 1,
    get roads() { return tiles.roadsNear(); },
    bounds: data.bounds,
    tick(t) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      tiles.update(this.player?.x ?? player.x, this.player?.z ?? player.z, dt);
      signals.update(dt);
      for (const f of tickers) f(t);
    },
    spawn: house.spawn,
    garage: house.garage,
    slots: house.slots,
    learnerAt: house.learnerAt,
    eyesight,
    terminal: air.terminal, jetPark: air.jetPark, runway: air.runway, addJet: air.addJet,
    landmarks,
    place(x, z, y = 0) { return house.place(x, z, y) || air.place(x, z) || net.placeAt(x, z); },
    indoors: (x, z) => house.indoors(x, z),
    floorY: (x, z, yPrev) => house.indoors(x, z) ? house.floorY(x, z, yPrev) : heightAt(x, z, yPrev),
    heightAt, gradeAt, // real EU-DEM hills + the flyovers' decks
    speedLimitAt: (x, z) => net.limitAt(x, z),
    nslAt: (x, z) => net.nslAt(x, z),
    signalHeads: () => signals.heads, // live heads ({x, z, heading, state}) for the free-drive examiner
    player,
  };
}
