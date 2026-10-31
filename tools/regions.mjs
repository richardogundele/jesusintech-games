// The real-map regions: one per city, centred on its DVSA driving test centre. tools/osm-fetch.mjs
// pulls the OpenStreetMap extract for a region, tools/region-data.mjs bakes it into
// public/assets/<id>/region.json, and src/worlds/region.js builds the world from that. Kent has its
// own, older pipeline (tools/kent-data.mjs) and is not listed here.
//
// Local metres: x east, z south of the origin (the test centre). `half` is the half-size of the
// fetched square, and `detail` (default 2500) how far out every building is kept in full: beyond it
// region-data.mjs drops half the plain houses and coarsens the rest, so a map wide enough to reach a
// city's ring road costs far less than its area. The jet centre sits on empty land south of the real
// roads (see region-data.mjs).
//
// `ready` is the gate the game reads: an entry is here as soon as the fetch tools need it, but the
// city only appears in the game -- as a world you can build and a place the jets fly to -- once its
// region.json is baked and has passed lanes-check and testgen-check. Without the gate, adding a
// region here would put a destination in the jet picker that loads a file that does not exist yet.

export const REGIONS = {
  london: {
    id: 'london', ready: true, name: 'London', place: 'Mill Hill',
    centre: { lat: 51.6101, lon: -0.2472 }, half: 2500,
    testCentre: { name: 'Mill Hill (London)', lat: 51.6101, lon: -0.2472, address: 'Unit 9, Grannard Business Centre, Bunns Lane, Mill Hill, London NW7 2DQ' },
    far: [['Birmingham', -160000, -125000], ['Manchester', -200000, -250000], ['Kent', 95000, 60000], ['Central London', 7000, 13000], ['Watford', -15000, -5000], ['Barnet', 4500, -2500], ['Edgware', -2500, 1500], ['Hendon', 1500, 3500], ['Finchley', 5500, 2500]],
  },
  birmingham: {
    id: 'birmingham', ready: true, name: 'Birmingham', place: 'Kings Heath',
    centre: { lat: 52.4063, lon: -1.8880 }, half: 2500,
    testCentre: { name: 'Birmingham (Kings Heath)', lat: 52.4063, lon: -1.8880, address: '955 Alcester Road South, Kings Heath, Birmingham B14 5JA' },
    far: [['London', 160000, 125000], ['Manchester', -40000, -120000], ['City Centre', 1500, -7500], ['Solihull', 8000, -3000], ['Kings Heath', 500, -2500], ['Redditch', -2000, 15000], ['Stirchley', -2500, -3500], ['Hall Green', 3500, -2500]],
  },
  manchester: {
    id: 'manchester', ready: true, name: 'Manchester', place: 'West Didsbury',
    // 4 km out, not 2.5: its two multi-lane roundabouts are 2.3 km from the centre, and on the
    // smaller square their approaches were clipped, so every seed drove the same single route.
    centre: { lat: 53.4252, lon: -2.2584 }, half: 4000,
    testCentre: { name: 'Manchester (West Didsbury)', lat: 53.4252, lon: -2.2584, address: 'Unit 11, Christie Fields Office Park, Christie Way, West Didsbury, Manchester M21 7QY' },
    far: [['London', 200000, 250000], ['Birmingham', 40000, 120000], ['City Centre', 1500, -5500], ['Stockport', 7000, 2500], ['Didsbury', 1500, 1200], ['Chorlton', -2500, -1500], ['Sale', -5500, 1500], ['Wythenshawe', -1500, 5500]],
  },
  // ---- the seven added for the public release. Every centre below is the DVSA car practical test
  // centre as gov.uk's "Find your nearest driving test centre" lists it, with the coordinates taken
  // from that result's own map link, checked on 2026-10-31. `far` is left off: the destination signs
  // are worked out from these coordinates by farOf() instead of being written out by hand.
  burgesshill: {
    // There is no test centre in Brighton or Hove. A Brighton candidate tests at Burgess Hill, so
    // this is Brighton's centre in the only sense that matters -- and the roads are Sussex A-roads
    // and a market town, not the seafront.
    id: 'burgesshill', name: 'Burgess Hill', place: 'Burgess Hill',
    centre: { lat: 50.951335, lon: -0.152148 }, half: 4000,
    testCentre: { name: 'Burgess Hill', lat: 50.951335, lon: -0.152148, address: 'Off Charles Avenue, Victoria Industrial Estate, Burgess Hill RH15 9AG' },
  },
  coventry: {
    id: 'coventry', name: 'Coventry', place: 'Bayton Road',
    centre: { lat: 52.464282, lon: -1.475741 }, half: 4000,
    testCentre: { name: 'Coventry', lat: 52.464282, lon: -1.475741, address: 'Bayton Road Industrial Estate, 42 Bayton Road, Coventry CV7 9EJ' },
  },
  miltonkeynes: {
    // DVSA calls it Bletchley; it is the only test centre in Milton Keynes
    id: 'miltonkeynes', name: 'Milton Keynes', place: 'Bletchley',
    centre: { lat: 51.993933, lon: -0.742398 }, half: 4000,
    testCentre: { name: 'Bletchley', lat: 51.993933, lon: -0.742398, address: 'Block 4, Government Buildings, Wilton Hostel, Wilton Avenue, Bletchley MK3 6DH' },
  },
  stoke: {
    id: 'stoke', name: 'Stoke-on-Trent', place: 'Cobridge',
    centre: { lat: 53.040335, lon: -2.188050 }, half: 4000,
    testCentre: { name: 'Stoke on Trent (Cobridge)', lat: 53.040335, lon: -2.188050, address: '8 Elder Road, Cobridge, Stoke-on-Trent ST6 2HE' },
  },
  warrington: {
    id: 'warrington', name: 'Warrington', place: 'Orford',
    centre: { lat: 53.409965, lon: -2.579280 }, half: 4000,
    testCentre: { name: 'Warrington', lat: 53.409965, lon: -2.579280, address: 'Orford Day Centre, Festival Avenue, Warrington WA2 9EP' },
  },
  leeds: {
    // Horsforth of the three Leeds centres: the A65 and the outer ring road are in reach of it
    id: 'leeds', name: 'Leeds', place: 'Horsforth',
    centre: { lat: 53.839962, lon: -1.621766 }, half: 4000,
    testCentre: { name: 'Horsforth', lat: 53.839962, lon: -1.621766, address: 'Room 013 Woodside House, 261 Low Lane, Horsforth, Leeds LS18 5NY' },
  },
  liverpool: {
    id: 'liverpool', name: 'Liverpool', place: 'Norris Green',
    centre: { lat: 53.444053, lon: -2.930239 }, half: 4000,
    testCentre: { name: 'Norris Green (Liverpool)', lat: 53.444053, lon: -2.930239, address: 'Falklands Approach, Parthenon Drive, Norris Green, Liverpool L11 5BR' },
  },
};

/** metres per degree at a latitude (WGS84 series) */
export function metresPerDegree(lat) {
  const p = (lat * Math.PI) / 180;
  return {
    mPerDegLat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    mPerDegLon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}
/** the projection origin of a region, as kent-data.mjs writes it */
export function originOf(R) {
  const m = metresPerDegree(R.centre.lat);
  return { lat0: R.centre.lat, lon0: R.centre.lon, mPerDegLat: +m.mPerDegLat.toFixed(3), mPerDegLon: +m.mPerDegLon.toFixed(3) };
}
export const projector = (O) => (lat, lon) => [(lon - O.lon0) * O.mPerDegLon, -(lat - O.lat0) * O.mPerDegLat];
// Kent is not a region, but it is a place the signs point to (its own pipeline, tools/kent-data.mjs)
const KENT = { lat: 51.342, lon: 1.346 };
/**
 * The destination signs for a region: every other city, where it really is, in this region's local
 * metres. A region with its own hand-written `far` list (the first three, which also name their
 * neighbourhoods) keeps it; the rest get this, so a new city needs no guessed coordinates.
 */
export function farOf(R) {
  if (R.far) return R.far;
  const O = originOf(R), to = projector(O);
  const others = Object.values(REGIONS).filter((X) => X.id !== R.id).map((X) => [X.name, X.centre]);
  return [...others, ['Kent', KENT]].map(([name, c]) => { const [x, z] = to(c.lat, c.lon); return [name, Math.round(x), Math.round(z)]; });
}
/** the fetched square as an Overpass bbox string "s,w,n,e" */
export function bboxOf(R) {
  const O = originOf(R), dLat = R.half / O.mPerDegLat, dLon = R.half / O.mPerDegLon;
  return `${(R.centre.lat - dLat).toFixed(5)},${(R.centre.lon - dLon).toFixed(5)},${(R.centre.lat + dLat).toFixed(5)},${(R.centre.lon + dLon).toFixed(5)}`;
}
