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
/** the fetched square as an Overpass bbox string "s,w,n,e" */
export function bboxOf(R) {
  const O = originOf(R), dLat = R.half / O.mPerDegLat, dLon = R.half / O.mPerDegLon;
  return `${(R.centre.lat - dLat).toFixed(5)},${(R.centre.lon - dLon).toFixed(5)},${(R.centre.lat + dLat).toFixed(5)},${(R.centre.lon + dLon).toFixed(5)}`;
}
