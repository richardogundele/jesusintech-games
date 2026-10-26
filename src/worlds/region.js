// A city on the real map: the OpenStreetMap streets around its DVSA driving test centre
// (tools/osm-fetch.mjs -> tools/region-data.mjs -> public/assets/<id>/region.json, ODbL), streamed in
// 500 m tiles exactly as Kent is: roads and markings (kent/roads.js), buildings / trees (kent/scenery.js),
// signs (kent/signs-place.js), working lights (kent/signals.js), live traffic (kent/traffic.js). The
// jet centre stands on open land south of the streets; your learner car waits at the test centre.
// Left-hand traffic, mph. x = east, z = south.
import * as THREE from 'three';
import { setupSky, UK_DAY, Colliders } from './common.js';
import { hdri, pbr, instanced } from '../assets.js';
import { markingTexture } from '../signs.js';
import { buildJet, buildCar, buildPedestrian, mesh } from '../models.js';
import { JETS, STARTER_JETS, TRAFFIC } from '../catalog.js';
import { state } from '../state.js';
import { label } from '../materials.js';
import { RoadNet } from '../kent/net.js';
import { TileManager } from '../kent/tiles.js';
import { makeRoadBuilder, makeRoadMaterials } from '../kent/roads.js';
import { makeSceneryBuilder } from '../kent/scenery.js';
import { makeSignBuilder } from '../kent/signs-place.js';
import { buildAirfield } from '../kent/airfield.js';
import { SignalSystem } from '../kent/signals.js';
import { KentTraffic } from '../kent/traffic.js';
import { testCentreLayout } from '../kent/lesson-routes.js';
import { makeTerrain } from './terrain.js';

/** buildRegion(renderer, { id, name, data, arena }) — data is the baked region.json */
export function buildRegion(renderer, { id, name, data, arena = false }) {
  if (!data) throw new Error(`${name} region data missing (public/assets/${id}/region.json)`);
  const net = new RoadNet(data);
  const terrain = makeTerrain(data);
  // the ground plus the deck of a flyover under the point (see net.deckNear for how prevY decides)
  const heightAt = (x, z, prevY = null) => { const t = terrain.heightAt(x, z); return t + net.deckNear(x, z, prevY, t); };
  const gradeAt = (x, z, heading, prevY = null) => {
    const dx = Math.sin(heading), dz = Math.cos(heading);
    return (heightAt(x + dx, z + dz, prevY) - heightAt(x - dx, z - dz, prevY)) / 2;
  };
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, { ...UK_DAY, hdri: hdri('monaco'), sunAzimuth: 182 });
  const colliders = new Colliders();
  const tickers = [];
  const interactions = [];

  // ground: on a region with hills this is the terrain grid's own triangles, built from the same
  // planar interpolation heightAt uses, so the grass can never poke through the tarmac (the road
  // surface sits only 2 cm up). Flat regions keep the old single plate.
  const scenery = makeSceneryBuilder({ net, tickers, colliders, scene, groundY: terrain.has ? terrain.heightAt : null });
  const land = new THREE.Mesh(
    terrain.has ? terrain.landGeometry(0.12) : scenery.landGeometry(-0.05),
    pbr('leafy_grass', { repeat: [1, 1], color: 0x6f9450 }),
  );
  land.receiveShadow = true;
  scene.add(land);

  // painted arrows / words come from the sign renderer, one material per decal
  const decals = new Map();
  const decal = (did, opts) => {
    const key = `${did}|${JSON.stringify(opts)}`;
    if (!decals.has(key)) decals.set(key, new THREE.MeshStandardMaterial({ map: markingTexture(did, opts), transparent: true, alphaTest: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    return decals.get(key);
  };
  const mats = makeRoadMaterials({ pbr, decal, planting: (spots) => instanced('shrub_01', spots, { maxDist: 600 }) });
  const roads = makeRoadBuilder({ net, colliders, mats, groundY: terrain.has ? terrain.heightAt : null });
  const signs = makeSignBuilder({ net, colliders, groundY: terrain.has ? terrain.heightAt : null });
  tickers.push((t) => signs.tick(t)); // Belisha beacons blink
  const tiles = new TileManager({ net, scene, builders: [roads, scenery, signs], near: 1000, far: 2500, dropAt: 3200, budgetMs: 4 });
  const signals = new SignalSystem({ net, signsBuilder: signs });
  const traffic = new KentTraffic({
    net, scene, signals, bodies: TRAFFIC, buildCar, buildPedestrian,
    maxCars: 80, maxPeds: 55, // busier roads
    groundY: heightAt, gradeAt, // deck-aware: traffic rides the flyovers too
  });

  // the jet centre: the city's gateway, on the open land south of the real streets
  const bought = state.owned.jets.filter((jid) => !STARTER_JETS.includes(jid));
  const air = buildAirfield({ scene, colliders, tickers, origin: data.airfield, JETS, STARTER_JETS, buildJet, ownedJets: bought, materials: { pbr } });
  const airLabel = label(`${name} Jet Centre`, { size: 1.6, sub: 'Fly or drive to the other cities' });
  airLabel.position.set(air.terminal.x, 12, air.terminal.z); scene.add(airLabel);

  // the test centre: scenery.js builds the building and its car park. The learner car waits in the end
  // bay (or on the forecourt when the building fronts the road); bought cars fill the other bays.
  const tc = data.testCentres[0];
  const L = testCentreLayout(net, tc);
  let learnerAt, slots = [];
  if (L.bays.length) {
    learnerAt = L.bays[L.bays.length - 1];
    slots = L.bays.slice(0, -1).reverse().slice(0, 6);
  } else if (L.hit) {
    const h = L.hit, off = h.way.halfW + 6, head = Math.atan2(h.dir[0], h.dir[1]); // L.n points from the building to the road
    learnerAt = { x: h.px - L.n[0] * off, z: h.pz - L.n[1] * off, heading: head };
    slots = [1, 2, 3].map((k) => ({ x: learnerAt.x - h.dir[0] * 7 * k, z: learnerAt.z - h.dir[1] * 7 * k, heading: head }));
  } else learnerAt = { x: tc.x + 20, z: tc.z, heading: 0 };
  const tcLabel = label(tc.name.replace(/\s*\(.*\)/, '') + ' driving test centre', { size: 1.3, sub: 'DVSA · your learner car is parked here' });
  tcLabel.position.set(tc.x, 9, tc.z); scene.add(tcLabel);

  // the arena (JesusInTech Live) lives in London, east of the jet centre
  let arenaDoor = null;
  if (arena) {
    const ax = data.airfield.x + 300, az = data.airfield.z - 200;
    const body = mesh(new THREE.CylinderGeometry(70, 74, 22, 48), new THREE.MeshPhysicalMaterial({ color: 0xe6e9ec, metalness: 0.5, roughness: 0.3 }), { receive: true });
    body.position.set(ax, 11, az); scene.add(body); colliders.box(ax, az, 150, 150);
    const roof = mesh(new THREE.SphereGeometry(70, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 0.6, roughness: 0.3 }));
    roof.scale.set(1, 0.22, 1); roof.position.set(ax, 22, az); scene.add(roof);
    const sign = label('London Arena', { size: 3.2, sub: 'JesusInTech Live' }); sign.position.set(ax, 44, az); scene.add(sign);
    arenaDoor = { x: ax - 76, z: az, r: 6 };
    const ring = mesh(new THREE.TorusGeometry(4, 0.18, 8, 48), new THREE.MeshStandardMaterial({ color: 0x35aee2, emissive: 0x35aee2, emissiveIntensity: 1.4 }), { cast: false });
    ring.rotation.x = -Math.PI / 2; ring.position.set(arenaDoor.x, 0.2, arenaDoor.z); scene.add(ring);
    tickers.push((t) => { ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); });
  }

  // minimap landmarks: the test centre, the jets, the arena and the named districts
  const districts = (data.places || []).filter((p) => !p.far && p.rank <= 2).slice(0, 6);
  const landmarks = [
    { x: tc.x, z: tc.z, color: '#c9f7a5', name: 'Test centre' },
    { x: air.jetPark.x, z: air.jetPark.z, color: '#9ad7ff', name: 'Jets' },
    ...(arenaDoor ? [{ x: arenaDoor.x, z: arenaDoor.z, color: '#35aee2', name: 'Arena' }] : []),
    ...districts.map((p) => ({ x: p.x, z: p.z, color: '#ffffff', name: p.name })),
  ];

  // rings as LessonRun.rbConflict reads them (every UK ring circulates clockwise, sense +1)
  const rbs = [...net.roundabouts.values()].map((rb) => ({ name: rb.id, x: rb.x, z: rb.z, lane: rb.laneRadius(1), outer: rb.r, sense: rb.sense }));

  // you arrive at the terminal; your cars wait in its car park, the learner at the test centre
  const spawn = { x: air.entrance.x, z: air.entrance.z - 6, heading: Math.PI };
  const garage = ['revuelto', 'cullinan', 'tesla', 'lexus'].map((cid, i) => ({ id: cid, ...air.carPark[i] }));
  const player = { x: spawn.x, z: spawn.z, r: 0 };
  let last = 0;
  return {
    id, name: name.toUpperCase(), units: 'mph', scene, env, colliders, tickers, interactions, net, tiles, air,
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
    spawn, garage, slots, learnerAt, testCentre: tc,
    terminal: air.terminal, jetPark: air.jetPark, runway: air.runway, addJet: air.addJet,
    arenaDoor,
    landmarks,
    place(x, z) {
      const a = air.place(x, z); if (a) return a.replace('Kent Jet Centre', `${name} Jet Centre`);
      if (arenaDoor && Math.hypot(x - arenaDoor.x - 76, z - arenaDoor.z) < 150) return 'London Arena';
      if (Math.hypot(x - tc.x, z - tc.z) < 60) return tc.name.replace(/\s*\(.*\)/, '') + ' test centre';
      return net.placeAt(x, z);
    },
    /** the real postal address nearest a point, straight from OpenStreetMap */
    addressAt: (x, z) => net.addressAt(x, z),
    speedLimitAt: (x, z) => net.limitAt(x, z),
    nslAt: (x, z) => net.nslAt(x, z),
    signalHeads: () => signals.heads, // live heads for the free-drive examiner
    laneAt: null,
    // The real hills. The road surfaces are draped onto this same grid (makeRoadBuilder's groundY)
    // and the land is built from its own triangles, so the car, the tarmac and the grass agree.
    // hills plus flyover decks; prevY tells a flyover from the road beneath (net.deckNear)
    heightAt, gradeAt,
    floorY: (x, z, yPrev) => heightAt(x, z, yPrev),
    terrain,
    terrainRange: terrain.range,
    player,
  };
}
