// Driving City: one map made of the real streets round several driving test centres, set side by side
// and joined by link roads. tools/city-merge.mjs reads each area's baked region.json
// (public/assets/<id>/region.json), moves it to its place here and writes public/assets/city/region.json,
// which the game builds like any other region.
//
// City metres: x east, z south, as everywhere else. `at` is where the area's own origin (its test centre;
// Kent's is its own map origin) lands in the city; `crop` (the area's own metres) keeps only part of an
// area, and `drop` leaves out ways. Each link joins one road leaving area `a` on `side` to the nearest
// matching road leaving `b` on `bSide` (default the opposite side), keeping clear of other areas, the
// home estate and the other links. Areas sit 1.5 km apart, edge to edge.
//
// Guildford, home, is in the middle: Herne Bay above it, Leeds and Manchester either side, Birmingham and
// Coventry below. The house and its jet park are on open land just past Guildford's north-east corner,
// beyond Send Barns Lane, clear of the A3, which carries on east to Manchester as a dual carriageway.

const SQUARE = (h) => ({ minX: -h, maxX: h, minZ: -h, maxZ: h }); // a fetched square, without the jet-centre land region-data.mjs adds south of it

export const CITY = {
  id: 'city', name: 'Driving City',
  // home: the house and the jet park beside it, in the area's own metres (city-merge.mjs flattens their
  // ground and joins each gate to the nearest street)
  home: { area: 'guildford', house: [3150, -2650], jets: [3600, -2250] },
  areas: [
    // The old Woking Road meets the A320 in a V just north of the Slyfield roundabout, drawn 3-6 m from it for
    // 40 m: the two carriageways overlapped and cars met head on there, locking the roundabout below. It now
    // joins the A320 with a T where they are still 11 m apart.
    { id: 'guildford', name: 'Guildford', at: [0, 0], crop: SQUARE(2980), rejoin: [{ way: 243351216, at: [-541, -153], onto: 905183472 }] },
    // Herne Bay and its coast, Swalecliffe to Reculver; Canterbury, Maypole and the cliff-top house left out.
    // Its 40 generated test routes keep inside x 594..3469, z -5901..-3363, so this has 760 m to spare.
    { id: 'kent', name: 'Herne Bay', at: [-2400, -1880], crop: { minX: -3200, maxX: 8000, minZ: -7300, maxZ: -2600 } },
    { id: 'leeds', name: 'Leeds', at: [-8460, 0], crop: SQUARE(3980) },
    { id: 'manchester', name: 'Manchester', at: [8460, 0], crop: SQUARE(3980) },
    { id: 'birmingham', name: 'Birmingham', at: [-4500, 6960], crop: SQUARE(2480) },
    { id: 'coventry', name: 'Coventry', at: [3500, 8460], crop: SQUARE(3980) },
  ],
  links: [
    // from home to every area
    { a: 'guildford', side: 'N', b: 'kent' },
    { a: 'guildford', side: 'W', b: 'leeds' },
    { a: 'guildford', side: 'E', b: 'manchester' },
    { a: 'guildford', side: 'S', b: 'birmingham', bSide: 'N' },
    { a: 'guildford', side: 'S', b: 'coventry', bSide: 'N' },
    // and round the outside
    { a: 'kent', side: 'W', b: 'leeds', bSide: 'N' },
    { a: 'kent', side: 'E', b: 'manchester', bSide: 'N' },
    { a: 'leeds', side: 'S', b: 'birmingham', bSide: 'W' },
    { a: 'manchester', side: 'S', b: 'coventry', bSide: 'E' },
    { a: 'birmingham', side: 'E', b: 'coventry' },
  ],
};
