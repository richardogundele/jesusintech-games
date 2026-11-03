// Driving City: the real streets round several driving test centres set side by side in one map and
// joined by link roads (tools/driving-city.mjs, baked by tools/city-merge.mjs into
// public/assets/city/region.json, ODbL). One world: Herne Bay and its coast across the top, home on its
// own estate beside Guildford with the jet park and the garage, and every area's test centre with its
// eyesight car. It streams in 500 m tiles like Kent and the cities (roads, scenery, signs, parked cars),
// with one set of lights and one stream of traffic for the whole map. Left-hand traffic, mph. x = east, z = south.
import * as THREE from 'three';
import { setupSky, UK_GOLDEN, Colliders } from './common.js';
import { makeTerrain } from './terrain.js';
import { hdri, pbr, instanced } from '../assets.js';
import { macroVary } from '../kent/surface.js';
import { markingTexture } from '../signs.js';
import { buildJet, buildCar, buildPedestrian } from '../models.js';
import { JETS, STARTER_JETS, TRAFFIC } from '../catalog.js';
import { state } from '../state.js';
import { label } from '../materials.js';
import { RoadNet } from '../kent/net.js';
import { TileManager } from '../kent/tiles.js';
import { makeRoadBuilder, makeRoadMaterials } from '../kent/roads.js';
import { makeSceneryBuilder } from '../kent/scenery.js';
import { makeParkedBuilder } from '../kent/parked-build.js';
import { makeSignBuilder } from '../kent/signs-place.js';
import { buildKentHouse } from '../kent/house.js';
import { buildAirfield } from '../kent/airfield.js';
import { SignalSystem } from '../kent/signals.js';
import { KentTraffic } from '../kent/traffic.js';
import { testCentreLayout } from '../kent/lesson-routes.js';

// main.js hands the house its hooks (toasts, the phone, quizzes) before the world is built
let hooks = {};
export function setCityHooks(h) { hooks = h; }

/** a test centre's short name: "Manchester (West Didsbury)" -> "Manchester", "Herne Bay Multi-Purpose Test Centre" -> "Herne Bay" */
export const centreName = (tc) => tc.name.replace(/\s*\(.*\)/, '').replace(/\s*(Multi-Purpose\s*)?(Driving\s*)?Test Centre$/i, '');

export function buildCity(renderer, { data }) {
  if (!data) throw new Error('Driving City data missing (public/assets/city/region.json: npm run city)');
  const net = new RoadNet(data);
  const terrain = makeTerrain(data);
  const heightAt = (x, z, prevY = null) => { const t = terrain.heightAt(x, z); return t + net.deckNear(x, z, prevY, t); };
  const gradeAt = (x, z, heading, prevY = null) => { const dx = Math.sin(heading), dz = Math.cos(heading); return (heightAt(x + dx, z + dz, prevY) - heightAt(x - dx, z - dz, prevY)) / 2; };
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, { ...UK_GOLDEN, hdri: hdri('monaco'), sunAzimuth: 182 });
  const colliders = new Colliders();
  const tickers = [];
  const interactions = [];

  // the land is the terrain grid's own triangles with Herne Bay's sea cut out, and a slow variation on
  // the grass so the fields between the areas don't read as one printed sheet
  const scenery = makeSceneryBuilder({ net, tickers, colliders, scene, groundY: terrain.has ? terrain.heightAt : null });
  const land = new THREE.Mesh(
    terrain.has ? terrain.landGeometry(0.12, 1200, scenery.inSea) : scenery.landGeometry(-0.05),
    macroVary(pbr('leafy_grass', { repeat: [1, 1], color: 0x6f9450 }), { scale: 31, amount: 0.16, warm: 0.05 }),
  );
  land.receiveShadow = true;
  scene.add(land);

  const decals = new Map();
  const decal = (id, opts) => {
    const key = `${id}|${JSON.stringify(opts)}`;
    if (!decals.has(key)) decals.set(key, new THREE.MeshStandardMaterial({ map: markingTexture(id, opts), transparent: true, alphaTest: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    return decals.get(key);
  };
  const mats = makeRoadMaterials({ pbr, decal, planting: (spots) => instanced('shrub_01', spots, { maxDist: 600 }) });
  const groundY = terrain.has ? terrain.heightAt : null;
  const roads = makeRoadBuilder({ net, colliders, mats, groundY });
  const signs = makeSignBuilder({ net, colliders, groundY });
  tickers.push((t) => signs.tick(t)); // Belisha beacons blink
  const parked = makeParkedBuilder({ net, buildCar, bodies: TRAFFIC, colliders, groundY });
  const tiles = new TileManager({ net, scene, builders: [roads, scenery, signs, parked], near: 1000, far: 2500, dropAt: 3200, budgetMs: 4 });
  const signals = new SignalSystem({ net, signsBuilder: signs });
  const traffic = new KentTraffic({ net, scene, signals, bodies: TRAFFIC, buildCar, buildPedestrian, maxCars: 80, maxPeds: 55, groundY: heightAt, gradeAt });

  // home: the house and its garage, and the private jet park beside it
  const house = buildKentHouse({ scene, colliders, tickers, origin: data.home, interactions, hooks, materials: { pbr }, driveEnd: 44 });
  const bought = state.owned.jets.filter((id) => !STARTER_JETS.includes(id));
  const air = buildAirfield({ scene, colliders, tickers, origin: data.airfield, JETS, STARTER_JETS, buildJet, ownedJets: bought, materials: { pbr } });

  // every area's test centre: its name over it, and the eyesight check's parked car (main.js builds it)
  const centres = data.testCentres.map((tc) => {
    const L = testCentreLayout(net, tc);
    let eye = null;
    if (L.bays.length) { const b = L.bays[L.bays.length - 1]; eye = { x: b.x, z: b.z, heading: b.heading }; }
    else if (L.hit) { const h = L.hit, off = h.way.halfW + 6; eye = { x: h.px - L.n[0] * off, z: h.pz - L.n[1] * off, heading: Math.atan2(h.dir[0], h.dir[1]) }; }
    const sign = label(`${centreName(tc)} driving test centre`, { size: 1.3, sub: 'DVSA' });
    sign.position.set(tc.x, heightAt(tc.x, tc.z) + 9, tc.z); scene.add(sign);
    return { tc, area: tc.area, eye };
  });
  const eyesight = centres.filter((c) => c.eye).map((c) => ({ centre: c.area, ...c.eye }));

  const areas = data.areas || [];
  const landmarks = [
    { x: data.home.x, z: data.home.z, color: '#e8c77a', name: 'Home' },
    { x: air.jetPark.x, z: air.jetPark.z, color: '#9ad7ff', name: 'Jets' },
    ...centres.map((c) => ({ x: c.tc.x, z: c.tc.z, color: '#c9f7a5', name: `${centreName(c.tc)} test centre` })),
    ...areas.map((a) => ({ x: (a.box.minX + a.box.maxX) / 2, z: (a.box.minZ + a.box.maxZ) / 2, color: '#ffffff', name: a.name })),
  ];
  const rbs = [...net.roundabouts.values()].map((rb) => ({ name: rb.id, x: rb.x, z: rb.z, lane: rb.laneRadius(1), outer: rb.r, sense: rb.sense }));
  /** the area a point is in (or nearest to): its id and name */
  const areaAt = (x, z) => {
    let best = null, bd = Infinity;
    for (const a of areas) {
      const dx = Math.max(a.box.minX - x, 0, x - a.box.maxX), dz = Math.max(a.box.minZ - z, 0, z - a.box.maxZ), d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = a; }
    }
    return best && { id: best.id, name: best.name, inside: bd === 0 };
  };

  const player = { x: house.spawn.x, z: house.spawn.z, r: 0 };
  let last = 0;
  return {
    id: 'city', name: 'DRIVING CITY', units: 'mph', scene, env, colliders, tickers, interactions, net, tiles, house, air,
    signals, signsBuilder: signs, trafficSystem: traffic, rbs, rbSenseSign: rbs.every((r) => r.sense === rbs[0]?.sense) ? rbs[0]?.sense ?? 1 : 1,
    get roads() { return tiles.roadsNear(); },
    bounds: data.bounds,
    tick(t) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      tiles.update(this.player?.x ?? player.x, this.player?.z ?? player.z, dt);
      signals.update(dt);
      for (const f of tickers) f(t);
    },
    spawn: house.spawn, garage: house.garage, slots: house.slots, learnerAt: house.learnerAt,
    eyesight, centres, areas, areaAt,
    terminal: air.terminal, jetPark: air.jetPark, runway: air.runway, addJet: air.addJet,
    landmarks,
    place(x, z, y = 0) {
      const h = house.place(x, z, y) || air.place(x, z)?.replace('Kent Jet Centre', 'Home Jet Park');
      if (h) return h;
      const c = centres.find((k) => Math.hypot(x - k.tc.x, z - k.tc.z) < 60);
      if (c) return `${centreName(c.tc)} test centre`;
      return net.placeAt(x, z) || areaAt(x, z)?.name;
    },
    addressAt: (x, z) => net.addressAt?.(x, z),
    indoors: (x, z) => house.indoors(x, z),
    floorY: (x, z, yPrev) => (house.indoors(x, z) ? house.floorY(x, z, yPrev) : heightAt(x, z, yPrev)),
    heightAt, gradeAt, terrain, terrainRange: terrain.range,
    speedLimitAt: (x, z) => net.limitAt(x, z),
    nslAt: (x, z) => net.nslAt(x, z),
    signalHeads: () => signals.heads,
    player,
  };
}
