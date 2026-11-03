// Driving City: one map made of the real streets round several driving test centres, set side by side
// and joined by link roads. tools/city-merge.mjs reads each area's baked region.json
// (public/assets/<id>/region.json), moves it to its place here and writes public/assets/city/region.json,
// which the game builds like any other region.
//
// City metres: x east, z south, as everywhere else. `at` is where the area's own origin (its test centre;
// Kent's is its own map origin) lands in the city; `crop` (the area's own metres) keeps only part of an
// area, and `drop` leaves out ways. Each link joins one road leaving area `a` on `side` to the nearest
// matching road leaving `b` on `bSide` (default the opposite side). Areas sit 1.5 km apart, edge to edge.
//
// The middle of the city is kept for Guildford, home, once its map is fetched and baked
// (tools/regions.mjs, osm-fetch.mjs, region-data.mjs): Kent above it, Leeds and Manchester either side,
// Birmingham and Coventry below. Until then the learner car and the jet centre are at Birmingham.

const CITY_SQUARE = { minX: -3980, maxX: 3980, minZ: -3980, maxZ: 3980 }; // the 4 km fetches, without the jet-centre land south of them

export const CITY = {
  id: 'city', name: 'Driving City',
  home: 'birmingham',
  areas: [
    // Herne Bay and its coast, Swalecliffe to Reculver; Canterbury, Maypole and the cliff-top house left out.
    // Its 40 generated test routes keep inside x 594..3469, z -5901..-3363, so this has 760 m to spare.
    { id: 'kent', name: 'Herne Bay', at: [-2400, -2880], crop: { minX: -3200, maxX: 8000, minZ: -7300, maxZ: -2600 },
      drop: (w) => w.id === 9000000001 || w.id === 9000000002 }, // Home Drive and Jet Centre Road: the house and the jets are going to Guildford
    { id: 'leeds', name: 'Leeds', at: [-9460, 0], crop: CITY_SQUARE },
    { id: 'manchester', name: 'Manchester', at: [9460, 0], crop: CITY_SQUARE },
    { id: 'birmingham', name: 'Birmingham', at: [-4500, 7960], crop: { minX: -2480, maxX: 2480, minZ: -2480, maxZ: 2480 } },
    { id: 'coventry', name: 'Coventry', at: [3500, 9460], crop: CITY_SQUARE },
  ],
  links: [
    { a: 'kent', side: 'W', b: 'leeds', bSide: 'N' },
    { a: 'kent', side: 'E', b: 'manchester', bSide: 'N' },
    { a: 'leeds', side: 'S', b: 'birmingham', bSide: 'W' },
    { a: 'manchester', side: 'S', b: 'coventry', bSide: 'E' },
    { a: 'birmingham', side: 'E', b: 'coventry' },
  ],
};
