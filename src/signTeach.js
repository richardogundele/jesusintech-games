// The sign pop-ups: drive past a sign and a card says what it is and what to do about it.
//
// The signs are the real assemblies the placer planned for the road network (kent/signs-place.js),
// so the card appears for the sign you can actually see out of the windscreen. Each sign is
// explained once every few minutes, one card at a time, and never during the real test - an
// examiner does not teach.
import { SIGNS } from './signdata.js';
import { signTexture } from './signs.js';

/** What each sign means and what a learner should do about it. Plain words, Highway Code sense. */
export const MEANINGS = {
  speed_20: 'Maximum 20 mph. A limit, not a target: in a 20 you are among people, so expect someone to step out.',
  speed_30: 'Maximum 30 mph. Street lights without a sign also mean 30, so in a town assume 30 unless told otherwise.',
  speed_40: 'Maximum 40 mph. Usually the edge of a town: still houses and side roads, so keep scanning.',
  speed_50: 'Maximum 50 mph. Look well ahead; at this speed you cover 22 metres every second.',
  speed_60: 'Maximum 60 mph. The most a single-carriageway road ever allows; it is often too fast for the bends.',
  speed_70: 'Maximum 70 mph. Only on dual carriageways and motorways.',
  speed_nsl: 'National speed limit applies: 60 mph on a single-carriageway road, 70 on a dual carriageway. It is the top of the range, not what the road always allows.',
  speed_repeater: 'A repeater: a small reminder of the limit you are already in.',
  zone_20: 'You are entering a 20 mph zone. The whole area is 20 until a sign ends it; expect humps and narrow bits.',
  zone_20_end_675A: 'End of the 20 zone. The limit shown now applies.',
  zone_20_end_675B: 'End of the 20 zone: national speed limit from here.',
  stop: 'STOP. You must stop completely at the line, every time, even if the road looks clear, then go only when it is safe.',
  give_way: 'GIVE WAY. Slow right down and be ready to stop at the broken line. Traffic on the road ahead has priority; you go only when you will not make anyone slow or swerve.',
  no_entry: 'No entry. You must not drive in here: it is one way towards you.',
  one_way: 'One-way street. Traffic all goes this way; you may use either lane, and look left as well as right when you emerge.',
  ahead_only: 'Ahead only. You must go straight on here: no turning.',
  turn_left: 'Turn left. You must turn left at this junction.',
  turn_right: 'Turn right. You must turn right at this junction.',
  roundabout_island_turn_left: 'Keep left round the island. Give way to traffic already circulating from your right.',
  turn_left_ahead: 'Turn left ahead. Get into position: mirrors, signal, then the turn.',
  keep_left: 'Keep left of this sign. Usually an island or a refuge in the road.',
  keep_left_bollard: 'Keep left of the bollard. It marks an island in the middle of the road.',
  no_right_turn: 'No right turn here. Carry on and turn later, or go round.',
  no_left_turn: 'No left turn here.',
  no_u_turn: 'No U-turns. Find somewhere safe and legal to turn round instead.',
  mini_roundabout: 'Mini-roundabout. Treat it like a roundabout: give way to traffic from your right and go round the painted disc, not over it.',
  pass_either_side: 'Pass either side to reach the same place. Pick a side early and stay in it.',
  roundabout_ahead: 'Roundabout ahead. Decide your exit now, check your mirrors, get into the right lane and be ready to give way to the right.',
  crossroads: 'Crossroads ahead. Traffic can come from the right, the left and straight across: slow down and look all ways.',
  t_junction: 'T-junction ahead. The road ends: you will have to turn left or right and give way.',
  side_road: 'A side road joins ahead. Watch for anything pulling out of it, and anything waiting to turn into it.',
  staggered_junction: 'Staggered junction ahead: two side roads, one each side, not quite opposite each other.',
  bend_right: 'Bend ahead. Brake before the bend, not in it, and look as far round it as you can.',
  double_bend: 'Double bend ahead. Get your speed right before the first one; the second comes quickly.',
  dual_carriageway_ends: 'Dual carriageway ends. Two-way traffic from here, so there will be cars coming towards you.',
  dual_carriageway_ahead: 'Dual carriageway ahead. You will join a road with a central reservation; build your speed on the slip road.',
  road_narrows_both: 'Road narrows on both sides. Be ready to hold back for anything coming the other way.',
  road_narrows_right: 'Road narrows on one side. Check your position; the other lane may have to give way.',
  traffic_signals_ahead: 'Traffic lights ahead. Be ready to stop; a green light now may be red by the time you reach it.',
  zebra_crossing_ahead: 'Zebra crossing ahead. If anyone is waiting at it, or on it, you stop and let them cross.',
  pedestrians_in_road: 'Pedestrians in the road ahead; there is no pavement. Slow down and give them room.',
  school_children: 'Children going to or from school. Slow down and expect someone small to appear between parked cars.',
  cyclists: 'Cyclists crossing or joining. Give them at least a car door of room when you pass.',
  road_humps: 'Road humps ahead. Slow down well before each one; it is kinder to the car and to you.',
  slippery_road: 'Slippery road. Ease off, no sudden steering or braking.',
  two_way_traffic: 'Two-way traffic ahead. Keep left; there will be cars coming towards you.',
  give_way_ahead: 'A give way or stop line is coming up at the distance shown. Start slowing now.',
  reduce_speed_now: 'Reduce speed now. The hazard the warning sign showed is right here.',
  distance_plate: 'The distance to the hazard on the sign above it.',
  dual_carriageway_plate: 'The road you are joining is a dual carriageway.',
  school_plate: 'There is a school here.',
  chevron_board: 'Sharp bend: the road turns the way the chevrons point. Slow right down before it.',
  ads_map_roundabout_primary: 'Advance direction sign for the roundabout ahead: the map shows each exit. Find yours now and get in lane for it.',
  ads_map_roundabout_nonprimary: 'The roundabout ahead, drawn as a map: find your exit and get in lane.',
  ads_stack: 'Advance direction sign: the places each turn leads to. Decide early, then mirrors and signal.',
  ads_dedicated_lane: 'Lane destinations ahead: each lane goes somewhere different. Get into the lane for your destination early.',
  flag_direction: 'A direction sign at the junction itself: this is where you turn.',
  countdown_markers: 'Countdown markers: three bars, two, one, then the exit. Signal and move into the exit lane.',
  motorway_ads: 'Motorway junction ahead, on blue. Make sure you are allowed on it and get in lane.',
  motorway_patch_on_primary: 'The blue panel means that route leads to the motorway.',
  route_confirmatory: 'Confirmation of the road you are now on and how far the next towns are.',
  tourist_canterbury_cathedral: 'Brown signs point to places visitors go: Canterbury Cathedral this way.',
  tourist_herne_bay_pier: 'Brown signs point to places visitors go: Herne Bay Pier this way.',
  town_entry: 'You are entering the town. Expect a 30 limit from here, and people.',
};

const AHEAD_MIN = 6, AHEAD_MAX = 42, LATERAL = 10;
const SHOW_MS = 6000, AGAIN_S = 180, SCAN_EVERY = 0.4;

export class SignTeacher {
  constructor(hud) {
    this.hud = hud;
    this.seen = new Map();   // sign id -> game time it was last explained
    this.t = 0;
    this.scanT = 0;
    this.showing = null;
    this.until = 0;
  }

  /** every frame from the car: finds the nearest sign you are about to pass and explains it */
  update(dt, car, world, on) {
    this.t += dt;
    if (!on || !car || !world?.signsBuilder) return;
    if (this.showing && this.t > this.until) this.showing = null;
    this.scanT += dt;
    if (this.scanT < SCAN_EVERY || this.showing) return;
    this.scanT = 0;
    const list = world.signsBuilder.planned();
    if (!list?.length) return;
    const dx = Math.sin(car.heading), dz = Math.cos(car.heading); // the car's forward
    let best = null, bestD = Infinity;
    for (const c of list) {
      if (c.exempt || !c.faces?.length) continue;
      const rx = c.x - car.pos.x, rz = c.z - car.pos.z;
      const ahead = rx * dx + rz * dz;
      if (ahead < AHEAD_MIN || ahead > AHEAD_MAX || ahead >= bestD) continue;
      const lateral = rx * dz - rz * dx;
      if (Math.abs(lateral) > LATERAL) continue;
      // a face is for us if it looks back down the road we are driving along it
      const along = Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz;
      const face = c.faces.find((f) => (f.facing ?? 1) * along > 0.7 && MEANINGS[f.sign]);
      if (!face) continue;
      const last = this.seen.get(face.sign);
      if (last != null && this.t - last < AGAIN_S) continue;
      best = { c, face }; bestD = ahead;
    }
    if (!best) return;
    const { face } = best;
    const entry = SIGNS[face.sign];
    let image = null;
    try { image = signTexture(face.sign, face.opts || face.o || {})?.image || null; } catch { image = null; }
    this.seen.set(face.sign, this.t);
    this.showing = face.sign;
    this.until = this.t + SHOW_MS / 1000;
    this.hud.signPop({ image, name: entry?.name || face.sign, text: MEANINGS[face.sign] }, SHOW_MS);
  }
}
