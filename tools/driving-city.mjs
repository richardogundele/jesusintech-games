// Driving City: one map made of the real streets round several driving test centres, set side by side
// and joined by link roads. tools/city-merge.mjs reads each area's baked region.json
// (public/assets/<id>/region.json), moves it to its place here and writes public/assets/city/region.json,
// which the game builds like any other region.
//
// City metres: x east, z south, as everywhere else. `at` is where the area's own origin (its test centre)
// lands in the city; `crop` (the area's own metres) keeps only part of an area (default: its streets,
// without the jet-centre land region-data.mjs adds to the south). Each link joins one road leaving
// area `a` on side `side` to the nearest matching road leaving `b` on the opposite side.

export const CITY = {
  id: 'city', name: 'Driving City',
  home: 'birmingham', // where the learner car and the jet centre are, until Guildford is baked
  areas: [
    { id: 'birmingham', name: 'Birmingham', at: [0, 0] },
    { id: 'coventry', name: 'Coventry', at: [8000, 0] }, // 1.5 km of country between their edges
  ],
  links: [
    { a: 'birmingham', side: 'E', b: 'coventry' },
  ],
};
