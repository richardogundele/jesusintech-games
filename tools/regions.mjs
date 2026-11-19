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
//
// No entry is `ready` any more (Nov 2026). Every town below is an area of Driving City, which you
// drive to, so none of them is a world of its own or a place a jet flies to; London, Birmingham and
// Manchester were the last three still built standalone, and nothing had routed to them since the
// city absorbed them. The gate stays for whatever is added next: a map that is fetched and baked but
// not yet checked still must not appear in the game.
//
// `timeK` is how long a route really takes against auto-pool.js's estimate, measured over the
// completed runs of `node tools/lesson-check.mjs --gen auto --region <id>`. It defaults to 1; a city
// without a measured one plans slightly the wrong length of test, which is a reason to measure it
// before setting `ready`, not a reason to guess.
// Set in Driving City on 2026-11-19. The ratio is not one number for a town: it moves with the routes
// the multiplier itself lets in (London drove its old, short routes in 0.87 of the estimate, and the
// longer ones a lower multiplier chose in 1.05 of it), and one route's time moves about a minute
// either way with the traffic. So each value here is the one, of those tried either side of the
// measured ratio, whose six gate seeds all finish inside 13-17 minutes with the most room to spare:
// London 0.95, Manchester 0.96, Liverpool 0.91, Stoke 0.91, Leeds 1.015, Warrington 0.95, Coventry
// 0.98, Burgess Hill 0.97, Guildford 1.02. London, Leeds, Burgess Hill and Guildford were set again
// later the same day, once every set of lights ran in two stages and the examiner began bringing a
// late test back by a shorter way: quicker lights, give-way lines where a side road joins by a
// dogleg and crossing lines in their right places moved every town's times, and those four no
// longer fitted (Guildford's is also the whole-city drive's, which starts there).

export const REGIONS = {
  london: {
    id: 'london', timeK: 0.95, name: 'London', place: 'Mill Hill',
    centre: { lat: 51.6101, lon: -0.2472 }, half: 2500,
    testCentre: { name: 'Mill Hill (London)', lat: 51.6101, lon: -0.2472, address: 'Unit 9, Grannard Business Centre, Bunns Lane, Mill Hill, London NW7 2DQ' },
    far: [['Birmingham', -160000, -125000], ['Manchester', -200000, -250000], ['Kent', 95000, 60000], ['Central London', 7000, 13000], ['Watford', -15000, -5000], ['Barnet', 4500, -2500], ['Edgware', -2500, 1500], ['Hendon', 1500, 3500], ['Finchley', 5500, 2500]],
  },
  birmingham: {
    id: 'birmingham', timeK: 0.94, name: 'Birmingham', place: 'Kings Heath',
    centre: { lat: 52.4063, lon: -1.8880 }, half: 2500,
    testCentre: { name: 'Birmingham (Kings Heath)', lat: 52.4063, lon: -1.8880, address: '955 Alcester Road South, Kings Heath, Birmingham B14 5JA' },
    far: [['London', 160000, 125000], ['Manchester', -40000, -120000], ['City Centre', 1500, -7500], ['Solihull', 8000, -3000], ['Kings Heath', 500, -2500], ['Redditch', -2000, 15000], ['Stirchley', -2500, -3500], ['Hall Green', 3500, -2500]],
  },
  manchester: {
    id: 'manchester', timeK: 0.96, name: 'Manchester', place: 'West Didsbury',
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
    // There is no test centre in Brighton or Hove: gov.uk's finder returns Burgess Hill for central
    // Brighton and for Wilson Avenue. A Brighton candidate tests here, which is the only sense in
    // which this is Brighton. What its roads are actually like is what the variety report says after
    // the bake, not what anyone knows about Sussex.
    id: 'burgesshill', timeK: 0.97, name: 'Burgess Hill', place: 'Burgess Hill',
    centre: { lat: 50.951335, lon: -0.152148 }, half: 4000,
    testCentre: { name: 'Burgess Hill', lat: 50.951335, lon: -0.152148, address: 'Off Charles Avenue, Victoria Industrial Estate, Burgess Hill RH15 9AG' },
  },
  coventry: {
    id: 'coventry', timeK: 0.98, name: 'Coventry', place: 'Bayton Road',
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
    id: 'stoke', timeK: 0.91, name: 'Stoke-on-Trent', place: 'Cobridge',
    centre: { lat: 53.040335, lon: -2.188050 }, half: 4000,
    testCentre: { name: 'Stoke on Trent (Cobridge)', lat: 53.040335, lon: -2.188050, address: '8 Elder Road, Cobridge, Stoke-on-Trent ST6 2HE' },
  },
  warrington: {
    id: 'warrington', timeK: 0.95, name: 'Warrington', place: 'Orford',
    centre: { lat: 53.409965, lon: -2.579280 }, half: 4000,
    testCentre: { name: 'Warrington', lat: 53.409965, lon: -2.579280, address: 'Orford Day Centre, Festival Avenue, Warrington WA2 9EP' },
  },
  leeds: {
    // Horsforth of the three Leeds centres (the others are the Old Fire Station and Colton Mill);
    // which gives the better test routes is a question for the variety report, not for reputation
    id: 'leeds', timeK: 1.015, name: 'Leeds', place: 'Horsforth',
    centre: { lat: 53.839962, lon: -1.621766 }, half: 4000,
    testCentre: { name: 'Horsforth', lat: 53.839962, lon: -1.621766, address: 'Room 013 Woodside House, 261 Low Lane, Horsforth, Leeds LS18 5NY' },
  },
  liverpool: {
    id: 'liverpool', timeK: 0.91, name: 'Liverpool', place: 'Norris Green',
    centre: { lat: 53.444053, lon: -2.930239 }, half: 4000,
    testCentre: { name: 'Norris Green (Liverpool)', lat: 53.444053, lon: -2.930239, address: 'Falklands Approach, Parthenon Drive, Norris Green, Liverpool L11 5BR' },
  },
  guildford: {
    // home in Driving City. gov.uk's finder for GU1 4AA, 2026-11-03: car, lorry and bus, ADI parts 2 and 3;
    // the coordinates are that result's own map link. Not `ready`: it is part of the city, not a world of its own.
    // 3 km out, not 4: the public Overpass servers timed out on the 8 km square all afternoon (2026-11-03)
    id: 'guildford', timeK: 1.02, name: 'Guildford', place: 'Slyfield',
    centre: { lat: 51.2593018, lon: -0.56542965 }, half: 3000,
    testCentre: { name: 'Guildford', lat: 51.2593018, lon: -0.56542965, address: 'Slyfield Industrial Estate, Off Moorfield Road, Guildford GU1 1SA' },
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
