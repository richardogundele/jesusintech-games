// UK driving lessons: one engine, lessons as data. A lesson is a route on the real Kent roads round
// the Herne Bay and Canterbury test centres (kent/lesson-routes.js), or through Whitmore, the
// practice town; the instructor gives directions from the route's events, and one fault monitor
// marks every run the way a DVSA examiner would: driving faults (minors), serious and dangerous
// faults. Pass = 15 or fewer driving faults and no serious or dangerous faults.
//
// The two worlds answer the same questions differently: Whitmore has one set of lights, one zebra and
// named rings; Kent has SignalSystem groups (asked with the car's heading), KentTraffic's crossings
// (by key) and ring records by id, plus multi-lane roads, slip roads and the test's other parts.
// Whitmore's marking is left exactly as it was; everything Kent adds sits behind `this.kent`
// (kentEvent, kentPosition and the Kent careful driver, carefulKent).
import * as THREE from 'three';
import { buildRoute, MPH, LANE, LW, LOT, BAYS, inLot } from './worlds/uk.js';
import { buildKentRoute, KENT_ROUTES, idxAtS } from './kent/lesson-routes.js';
import { pedalsManual, pedalsAuto, gearFor } from './pedals.js';
import { seeded } from './kent/test-routes.js';
import { scoreSheet, debrief } from './dl25.js';

const BAY_X = BAYS[8].x;
// the last few metres of the test: left into the test centre, along the aisle, forward into a bay
const INTO_BAY = [
  { x: LOT.entryX, z: 0, off: 0, text: 'Turn left into the test centre car park, please.' },
  { x: LOT.entryX, z: 14, off: 0, ev: 'bend', text: '', r: 4 },
  { x: BAY_X, z: 14, off: 0, ev: 'bend', text: '', r: 4 },
  { x: BAY_X, z: 21.6 },
];

// The official car "show me, tell me" questions (gov.uk, "Car show me tell me vehicle safety questions",
// https://www.gov.uk/government/publications/car-show-me-tell-me-vehicle-safety-questions). The tell me
// question is asked before you drive, the show me question while you drive. The first answer is the
// right one (DVSA's, shortened); the others are wrong. A wrong answer is one driving fault.
export const TELL_ME = [
  { q: "Tell me how you'd check that the brakes are working before starting a journey.", a: ["Brakes shouldn't feel spongy or slack. Test them as you set off: the car shouldn't pull to one side.", 'Press the horn and listen.', 'Pump the pedal ten times with the engine off.', 'Check the brake fluid is warm.'] },
  { q: "Tell me where you'd find the information for the recommended tyre pressures for this car and how tyre pressures should be checked.", a: ["The manufacturer's guide. Use a reliable gauge, check and adjust them when the tyres are cold, don't forget the spare, and refit the valve caps.", 'On the speedometer; check them after a long drive while they are hot.', 'Any petrol pump: they are the same for every car.', 'On the number plate.'] },
  { q: 'Tell me how you make sure your head restraint is correctly adjusted so it provides the best protection in the event of a crash.', a: ['The rigid part of the head restraint should be at least as high as the eye or top of the ears, and as close to the back of the head as is comfortable.', 'As low as it will go, so you can see over it.', 'Level with your shoulders.', "Take it out: it blocks the rear view."] },
  { q: "Tell me how you'd check the tyres to ensure that they have sufficient tread depth and that their general condition is safe to use on the road.", a: ['No cuts or bulges, and at least 1.6 mm of tread across the central three-quarters of the tyre, all the way round.', 'At least 1 mm of tread anywhere on the tyre.', 'Kick them; if they feel firm they are fine.', 'Look for the tread-wear mark on the sidewall only.'] },
  { q: "Tell me how you'd check that the headlights and tail lights are working.", a: ["Turn on the switch (turn on the ignition if needed), then walk round the car (as this is a 'tell me' question, you don't need to physically check the lights).", 'Flash the main beam at another car.', 'Check the bulbs are warm after a drive.', "Look at the dashboard: if the warning light is off, they work."] },
  { q: "Tell me how you'd know if there was a problem with your anti-lock braking system.", a: ['A warning light will show if there is a problem with the anti-lock braking system.', 'The brake pedal goes hard.', 'The car pulls to the left when braking.', 'The handbrake light flashes.'] },
  { q: "Tell me how you'd check the direction indicators are working.", a: ["Turn on the hazard warning light switch and walk round the car (as this is a 'tell me' question, you don't need to physically check the lights).", 'Listen for the ticking only.', 'Ask the examiner.', 'Indicate and watch the dashboard arrow only.'] },
  { q: "Tell me how you'd check the brake lights are working on this car.", a: ['Use the reflections in windows or garage doors, or ask someone to help.', 'Press the brake pedal and look at the dashboard.', 'They come on with the headlights, so check those.', 'Pull the handbrake and look in the mirror.'] },
  { q: "Tell me how you'd check the power-assisted steering is working before starting a journey.", a: ['If the steering becomes heavy, the system may not be working properly. Gentle pressure on the wheel while starting the engine should give a slight movement, or turning it just after moving off should feel the assistance.', 'Turn the wheel full lock with the engine off.', 'Listen for a whistle from the engine.', 'Check the steering fluid is hot.'] },
  { q: "Tell me how you'd switch on the rear fog light(s) and explain when you'd use it/them.", a: ['Operate the switch (turn on dipped headlights and the ignition if needed), check the warning light, and use them when visibility drops below 100 metres.', 'Use them whenever it is dark.', 'Use them in light rain to be seen.', 'They come on with the main beam.'] },
  { q: 'Tell me how you switch your headlight from dipped to main beam and explain how you\'d know the main beam is on.', a: ['Operate the switch (with the ignition or engine on if needed) and check the main beam warning light.', 'Turn the fog lights on.', 'Flash the hazards.', 'The dashboard goes brighter.'] },
];
export const SHOW_ME = [
  { q: "When it's safe to do so, can you show me how you wash and clean the rear windscreen?", a: ['Operate the rear wiper and washer control.', 'Switch on the hazard lights.', 'Open the rear window.', 'Turn on the heated seats.'] },
  { q: "When it's safe to do so, can you show me how you wash and clean the front windscreen?", a: ['Operate the front washer and wiper control.', 'Switch on the rear demister.', 'Flash the headlights.', 'Open the sunroof.'] },
  { q: "When it's safe to do so, can you show me how you'd switch on your dipped headlights?", a: ['Operate the light switch to dipped beam (and turn it back off).', 'Flash the headlights twice.', 'Switch on the front fog lights.', 'Switch on the interior light.'] },
  { q: "When it's safe to do so, can you show me how you'd set the rear demister?", a: ['Operate the rear demister switch (and turn it back off).', 'Turn the heater to full.', 'Use the rear wiper.', 'Open the rear windows.'] },
  { q: "When it's safe to do so, can you show me how you'd operate the horn?", a: ['Press the horn (only where it is safe and appropriate).', 'Flash the headlights.', 'Wind the window down and shout.', 'Switch on the hazard lights.'] },
  { q: "When it's safe to do so, can you show me how you'd demist the front windscreen?", a: ['Set the fan and the heater to the front windscreen, with air conditioning on if the car has it.', 'Open the sunroof.', 'Use the rear wiper.', 'Turn the heater to the footwell only.'] },
  { q: "When it's safe to do so, can you show me how you'd open and close the side window?", a: ['Operate the window switch (or winder) to open it, then close it.', 'Open the door.', 'Switch on the air conditioning.', 'Press the central locking.'] },
];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export function randomPlate() {
  const L = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const yy = String(Math.floor(Math.random() * 20) + 51).padStart(2, '0'); // UK age identifier style
  return `${L()}${L()}${yy} ${L()}${L()}${L()}`;
}
/** four plates that look alike; the first is the real one */
export function plateOptions(real) {
  const out = [real];
  const swap = { O: 'D', D: 'O', E: 'F', F: 'E', B: '8', 8: 'B', S: '5', 5: 'S', M: 'N', N: 'M', V: 'Y', Y: 'V', 1: '7', 7: '1', 3: '8', H: 'M' };
  while (out.length < 4) {
    const chars = real.split('');
    for (let k = 0; k < 2; k++) {
      const i = Math.floor(Math.random() * chars.length);
      if (chars[i] === ' ') continue;
      chars[i] = swap[chars[i]] || LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    const c = chars.join('');
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

// DT1 section 14: the examiner's words at the start of the drive
const DT1_START = 'Throughout the drive continue ahead, unless traffic signs direct you otherwise. When I want you to turn left or right, I will tell you in plenty of time. Move off when you are ready, please.';
// Kent: the lessons keep the save ids they had in Whitmore. A lesson starts kerbside outside its
// test centre; `route` names its entry in KENT_ROUTES.
const KENT = [
  {
    id: 'moveoff', world: 'kent', route: 'moveoff', title: 'Moving off and stopping', blurb: 'The Boulevard by the Herne Bay test centre: mirrors, signal, move off, pull up on the left, an angled start.',
    intro: "Hi Richard, I'm Sarah, your instructor. We're outside the Herne Bay test centre on The Boulevard. Today: moving off and stopping. Check your mirrors with Q, signal right with X, then move off and keep to the left.",
  },
  // the gearbox lessons: only the ones for the car you're learning in are offered (def.trans)
  {
    id: 'clutch', world: 'kent', route: 'clutch', trans: 'manual', engineOff: true, title: 'Clutch control', blurb: 'The Boulevard: start the engine, find the biting point, move off and stop again and again, and a stall on purpose so you know how to recover.',
    intro: "Hi Richard, I'm Sarah. Today it's all about the clutch, here on The Boulevard. The engine's off and the handbrake's on.",
    drills: { start: ['start', 'bite', 'biteDown'], stop2: ['stall', 'recover'] },
  },
  {
    id: 'gears', world: 'kent', route: 'gears', trans: 'manual', title: 'Gears', blurb: 'Up through the gears on Reculver Road and the A299 link at the right speeds, down for the Eddington roundabouts, fifth on the Thanet Way.',
    intro: "Gears today. Change up as the engine note rises: second about 10 mph, third about 17, fourth about 27, fifth about 38. Change down for junctions and roundabouts: you can skip gears, fourth straight to second. Clutch down for every change.",
    tasks: ['up4', 'down', 'block'],
  },
  {
    id: 'autocontrols', world: 'kent', route: 'autocontrols', trans: 'auto', engineOff: true, title: 'Automatic controls', blurb: 'P, R, N and D, creeping at walking pace with just the brake, reversing a car length, and the handbrake at every stop.',
    intro: "Hi Richard, I'm Sarah. An automatic has no clutch: the lever does the work. P to park, R reverse, N neutral, D drive. In D it creeps forward on its own, so your right foot covers the brake.",
    drills: { start: ['astart', 'select', 'creep'], stop1: ['reverse', 'select2'], stop2: ['secureP', 'select2'] },
  },
  {
    id: 'junctions', world: 'kent', route: 'junctions', title: 'Junctions', blurb: 'Into Herne Bay: Mickleburgh Hill, then the town streets: turning into side roads and emerging at give-way lines.',
    intro: 'Junctions today. Mirrors, signal, then slow down before the turn. At the give-way lines, look both ways and only go when it is clear. We head into town down Mickleburgh Hill.',
  },
  {
    id: 'roundabouts', world: 'kent', route: 'roundabouts', title: 'Roundabouts', blurb: 'Altira, the Margate Road rings, the Eddington junction and the big Greenhill roundabout.',
    intro: 'Roundabouts. Give way to traffic coming from your right. Left signal for a left exit; for a right exit, the right-hand lane and a right signal; and always signal left once you pass the exit before yours.',
  },
  {
    id: 'crossings', world: 'kent', route: 'crossings', title: 'Crossings and lights', blurb: "The King's Road zebras, the Station Road lights and the zebras along Central Parade.",
    intro: 'Pedestrian crossings and traffic lights. If someone is on or waiting at a zebra, stop and let them cross. Stop at a red light behind the white line. The town is 20 mph.',
  },
  {
    id: 'dual', world: 'kent', route: 'dual', title: 'Dual carriageways', blurb: 'The A299 at 70: the three Eddington roundabouts, joining from the slip road, lane discipline, leaving at Margate Road.',
    intro: "Today: the Thanet Way. The white sign with a black bar means the national speed limit: 70 on a dual carriageway. Match the traffic's speed on the slip road, keep left unless you're overtaking, and mirrors and a signal before every lane change.",
  },
  {
    id: 'manoeuvres', world: 'kent', route: 'manoeuvres', title: 'Emergency stop and manoeuvres', blurb: 'Stop quickly when told, pull up on the right and reverse two car lengths, then park in a bay at the test centre.', estop: 1,
    intro: "Test skills today. At some point I'll say 'Stop!': brake firmly and quickly, like a child just ran out. Later I'll ask you to pull up on the right and reverse about two car lengths, and we'll finish by parking in a bay at the test centre. Mirrors before you reverse.",
  },
  {
    id: 'mock', world: 'kent', route: 'mock', title: 'Driving test: Herne Bay', blurb: 'The real format from the Herne Bay centre: eyesight check, show me/tell me, the A299, Eddington, Greenhill, the town, about 20 minutes on the sat nav, a manoeuvre, sometimes an emergency stop. 15 driving faults or fewer and no serious faults to pass.', mock: true,
    checks: true, estop: 1 / 7, independent: [0.22, 0.72], showMe: 0.78,
    intro: DT1_START,
  },
  {
    id: 'mock-canterbury', world: 'kent', route: 'mock-canterbury', title: 'Driving test: Canterbury', blurb: 'From 25 New Dover Road: the ring road, its three-lane roundabouts, St George\'s, the A28 Sturry Road, the sat nav, a manoeuvre, sometimes an emergency stop.', mock: true,
    checks: true, estop: 1 / 7, independent: [0.22, 0.72], showMe: 0.78,
    intro: DT1_START,
  },
];
const WHITMORE = [
  {
    id: 'wm-moveoff', world: 'uk', practice: true, title: 'Moving off and stopping', blurb: 'Mirrors, signal, move off, keep left, pull up at the kerb.',
    stops: ['TC', { x: -130, z: 0 }],
    intro: "Hi Richard, I'm Sarah, your instructor. Today: moving off and stopping. Check your mirrors with Q, signal right with X, then move off and keep to the left.",
  },
  {
    id: 'wm-junctions', world: 'uk', practice: true, title: 'Junctions', blurb: 'Turning into side roads and emerging at give-way lines.',
    stops: ['TC', 'J1', 'CLT', 'J3', { x: 0, z: 90 }],
    intro: 'Junctions today. Mirrors, signal, then slow down before the turn. At the give-way lines, look both ways and only go when it is clear.',
  },
  {
    id: 'wm-roundabouts', world: 'uk', practice: true, title: 'Roundabouts', blurb: 'Give way to traffic from the right; signal for your exit.',
    stops: [{ x: 0, z: 150 }, 'RB', 'J5', 'RVE', 'J4', 'RB', { x: 250, z: 0 }],
    intro: 'Roundabouts. Give way to traffic coming from your right. Signal left for the first exit, nothing for straight on, right for the third.',
  },
  {
    id: 'wm-crossings', world: 'uk', practice: true, title: 'Crossings and lights', blurb: 'Zebra crossings, puffin lights and speed limits.',
    stops: ['TC', 'J1', 'RB', { x: 250, z: 0 }],
    intro: 'Pedestrian crossings and traffic lights. If someone is waiting at the zebra, stop and let them cross. Stop at a red light behind the white line.',
  },
  {
    id: 'wm-dual', world: 'uk', practice: true, title: 'Dual carriageways and country roads', blurb: 'The A30 bypass at 70, Moor Lane at 60, two big roundabouts, lane discipline.',
    stops: ['TC', 'J1', 'RB', 'J4', 'RVW', 'RB2', 'RB3', 'MLN', 'EEND', { x: 160, z: 0 }],
    intro: "Today we're leaving town. The white sign with a black bar means the national speed limit: 70 on a dual carriageway, 60 on a single road. Keep to the left lane unless you're overtaking, and check your mirrors and signal before you change lanes.",
  },
  {
    id: 'wm-manoeuvres', world: 'uk', practice: true, title: 'Emergency stop and bay parking', blurb: 'Stop quickly and under control when told; finish inside a bay.',
    stops: ['TC', 'J1', 'CLT', 'J3', 'RB', ...INTO_BAY], end: 'baypark', estop: 1,
    intro: "Two test skills today. At some point I'll say 'Stop!': brake firmly and quickly, like a child just ran out. Then at the end we'll park in a bay at the test centre. Use your mirrors before you reverse.",
  },
  {
    id: 'wm-mock', world: 'uk', practice: true, title: 'Mock driving test', blurb: 'The real format: eyesight check, show me/tell me, independent driving on the sat nav, a manoeuvre, sometimes an emergency stop. 15 driving faults or fewer and no serious faults to pass.', mock: true,
    stops: ['TC', 'J1', 'CLT', 'J3', 'RB', 'J4', 'RVW', 'RB2', 'RB3', 'MLN', 'EEND', 'RB', ...INTO_BAY], end: 'baypark',
    checks: true, estop: 1 / 3, independent: [0.36, 0.66], showMe: 0.7,
    intro: "Good morning. I'd like you to follow the road ahead unless traffic signs direct you otherwise. When I want you to turn, I'll ask you in good time. Move off when you're ready.",
  },
];

export const LESSONS = [...KENT, ...WHITMORE];
/**
 * The def for a generated test (kent/test-routes.js generateTest). Both kinds are driven and marked
 * the same way, as a real mock is: `real` is the one that counts - it awards the licence, and the
 * examiner says nothing about a fault until the debrief. A mock flashes each fault as it happens.
 */
export function testDef(gen, kind = 'mock') {
  const m = gen.meta, real = kind === 'real';
  return {
    id: `test-${m.centre}`, world: m.world || 'kent', title: `${real ? 'Driving test' : 'Mock test'}: ${m.centreName}`, mock: true, real, checks: true, centre: m.centre,
    blurb: '15 minutes on a route made for this test.', generated: m, spec: gen.spec, seed: m.seed, indepSpec: m.indep, estop: 1 / 7, showMe: 0.55,
    intro: DT1_START, signs: gen.signs || null,
  };
}
/** lessons that make sense in this gearbox (the clutch and gears lessons are for a manual) */
export const lessonsFor = (trans) => LESSONS.filter((l) => !l.trans || l.trans === trans);

// Drills: lesson steps the instructor waits for while the car is stopped (or creeping). `pilot` tells
// the careful driver's feet what to do (pedals.js); `done` says when to move on.
const DRILLS = {
  start: { pilot: 'start', text: "First, start the engine. Clutch down (hold Shift), check it's in neutral (0), then press I.", done: (r, c) => c.engineOn },
  bite: { pilot: 'bite', text: "Now the biting point. Handbrake stays on. Clutch down, select first (1), a little gas (tap W), then let the clutch up slowly (let go of Shift). When the engine note drops and the car wants to pull, that's the bite.", done: (r, c) => c.engineOn && c.gear === 1 && c.parkingBrake && c.drive.engaged > 0.25 },
  biteDown: { pilot: 'hold', text: "That's the bite: feel it pulling against the handbrake? Clutch back down now (Shift) before it stalls.", done: (r, c) => c.clutch >= 0.8 || !c.engineOn },
  stall: { pilot: 'stall', text: "Before we go on, stall it on purpose so you know what to do. Handbrake on, first gear, then let the clutch up with no gas.", done: (r, c) => c.stalled },
  recover: { pilot: 'recover', text: "That's a stall. No panic: handbrake on, clutch down, select neutral (0), then press I to restart.", done: (r, c) => c.engineOn },
  astart: { pilot: 'start', text: "Foot on the brake (S), check the lever is in P, then press I to start the engine.", done: (r, c) => c.engineOn },
  select: { pilot: 'select', text: 'Keep your foot on the brake and select D (press 1). The handbrake stays on for now.', done: (r, c) => c.gear === 'D' },
  creep: { pilot: 'creep', text: 'Mirrors (Q), signal right (X), handbrake off (Space), then ease off the brake. No gas: let it creep at walking pace.', done: (r) => r.creepT > 3 },
  reverse: { pilot: 'reverse', text: 'Now reverse a car length. Foot on the brake, select R, handbrake off, look behind (Q), and let it creep back under the brake.', done: (r) => r.s < r.drillS - 4 },
  select2: { pilot: 'select', text: "Stop with the brake and select D again (1). Then move off when you're ready.", done: (r, c) => c.gear === 'D' && Math.abs(c.vF) < 0.2 },
  secureP: { pilot: 'secureP', text: 'This is how you park: foot on the brake, handbrake on (Space), then P (press 9).', done: (r, c) => c.parkingBrake && c.gear === 'P' },
};
const ORD_GEAR = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

const SEV = { minor: 'Driving fault', serious: 'Serious fault', dangerous: 'Dangerous fault' };

export class LessonRun {
  /** hooks: { say(text), hud({ text, faults, mock }), result(sheet), cancelled(why) } */
  constructor(world, def, hooks) {
    this.world = world;
    this.def = def;
    this.hooks = hooks;
    this.kent = !!world.net; // the real Kent roads; else Whitmore
    if (this.kent) {
      // a generated test (def.spec) rebuilds exactly from its seed; the lessons use their fixed routes
      this.route = buildKentRoute(world.net, { ...(def.spec || KENT_ROUTES[def.route]), id: def.id }, def.seed != null ? { rnd: seeded(def.seed) } : undefined);
      this.spec = this.route.spec; // with the manoeuvre picked for this run
      this.viaS = viaPositions(this.route);
    } else this.route = buildRoute(def.stops, { end: def.end || 'pullup' });
    this.lane = 1;
    this.dirChanges = 0;
    this.lastDir = 0;
    // emergency stop: on a clear straight stretch in town, some of the time
    // a generated test's choices (emergency stop, show me question) come from its seed too, so a retry is the same test
    const R = (this.rnd = def.seed != null ? seeded(def.seed + 99) : Math.random);
    const firstStop = this.kent ? this.route.events.find((e) => e.kind === 'stop') : null;
    if (def.estop && R() < def.estop) {
      const busy = (s) => this.route.events.some((e) => Math.abs((e.entryS ?? e.s) - s) < 50);
      if (this.kent) {
        // a quiet town road (20-40 mph, not a dual carriageway, ring, manoeuvre or the car park), anywhere along the route
        const town = (q) => q.road && !q.rb && !q.man && !q.park && !q.road.dual && !q.road.nsl && q.road.limit >= 20 && q.road.limit <= 40;
        const nearStop = (s) => this.route.events.some((e) => (e.kind === 'stop' || e.kind === 'pullright') && Math.abs(e.s - s) < 120);
        // (on a generated test, after a pull-up, where the examiner briefs it as DT1 says)
        const after = def.spec && firstStop ? firstStop.s + 150 : 260;
        const ok = this.route.pts.filter((q, i) => i % 10 === 0 && q.s > after && q.s < this.route.length - 200 && town(q) && !busy(q.s) && !busy(q.s + 40) && !nearStop(q.s));
        const p = ok[Math.floor(R() * ok.length)];
        if (p) this.estop = { s: p.s, state: 'armed' };
      } else {
        const p = this.route.pts.find((q) => q.s > 260 && q.road && !q.road.rural && q.road.limit >= 30 && !busy(q.s) && !busy(q.s + 40));
        if (p) this.estop = { s: p.s, state: 'armed' };
      }
    }
    if (def.independent) this.indep = def.independent.map((f) => f * this.route.length);
    // a generated test: independent driving from the first pull-up, by sat nav or following the signs for a place
    if (def.indepSpec) { this.indep = [def.indepSpec.s0, def.indepSpec.s1]; this.indepMode = def.indepSpec.mode; this.signsTarget = def.indepSpec.target || null; }
    if (def.showMe) this.showMeS = def.showMe * this.route.length;
    this.events = this.route.events.map((e) => ({ ...e }));
    if (this.kent) for (const e of this.events) e.text = dt1Text(e, !!def.mock);
    this.faults = [];
    this.t = 0;
    this.s = 0;
    this.idx = 0;
    this.lat = 0;
    this.dist = 0;
    this.sig = [];        // { dir, s, t } samples while an indicator is on
    this.mirror = [];     // { s, t } mirror checks
    this.cool = {};
    this.timers = {};
    this.moved = false;
    this.stopT = 0;
    this.done = false;
    this.text = def.intro;
    // the gearbox lessons' drills, the coach's line under the instructor's text, the gears lesson's tasks
    this.drillQ = (def.drills?.start || []).map((k) => ({ k, ...DRILLS[k] }));
    this.stopN = 0; this.creepT = 0; this.coachText = ''; this.ctl = null;
    this.tasks = def.tasks ? Object.fromEntries(def.tasks.map((k) => [k, false])) : null;
    this.say(this.drillQ.length ? `${def.intro} ${this.drillQ[0].text}` : def.intro);
    if (this.drillQ.length) this.drillQ[0].shown = true;
    // emerging give-way lines: where the route crosses the mouth of the side road
    if (!def.mock) this.guide = guideLine(this.route.pts, world.heightAt);
    if (this.guide) world.scene.add(this.guide);
    if (this.kent) {
      // each event remembers where the manoeuvre before it ended, so a signal still on from that one
      // (a left signal leaving one roundabout, a turn just before) isn't read as a signal for this one
      let prevEnd = 25; // the right signal for moving off
      for (const e of this.events) {
        e.prevEnd = prevEnd;
        if (MANOEUVRES.includes(e.kind)) prevEnd = endOf(e);
      }
      // the parked car an angled start pulls up behind
      for (const e of this.events) if (e.parked) e.parkedH = hooks.parkedCar?.(e.parked);
      this.satnav = { next: null, called: {} };
    }
  }

  say(text) {
    this.text = text;
    this.hooks.say(text);
  }

  get independent() { return this.indep && this.s > this.indep[0] && this.s < this.indep[1]; }
  /** the drill the instructor is waiting for, for the autopilot's feet (pedals.js), or null */
  get drill() { return this.drillQ?.[0]?.pilot ?? null; }

  fault(sev, cat, coolKey = cat, cooldown = 0) {
    if (cooldown && this.cool[coolKey] > this.t) return;
    if (cooldown) this.cool[coolKey] = this.t + cooldown;
    this.faults.push({ sev, cat, s: this.s, at: this.carPos && { x: +this.carPos.x.toFixed(1), z: +this.carPos.z.toFixed(1) }, extra: this.lastExtra });
    this.lastExtra = null;
    if (!this.def.real) this.hooks.flash?.(`${SEV[sev]}: ${cat}`, sev); // the real test keeps it for the debrief
    if (sev === 'dangerous' && this.isTest()) this.endNow = true; // a dangerous fault ends the test (handled next frame in update)
  }

  /** time-based "condition held for n seconds" helper */
  held(key, cond, dt, secs) {
    this.timers[key] = cond ? (this.timers[key] || 0) + dt : 0;
    return this.timers[key] > secs;
  }

  track(car) {
    const pts = this.route.pts;
    let best = this.idx, bd = Infinity;
    const lo = Math.max(0, this.idx - 15), hi = Math.min(pts.length - 1, this.idx + 80);
    const scan = (a, b) => { for (let i = a; i <= b; i++) { const d = (pts[i].x - car.pos.x) ** 2 + (pts[i].z - car.pos.z) ** 2; if (d < bd) { bd = d; best = i; } } };
    scan(lo, hi);
    if (bd > 400) scan(0, pts.length - 1); // lost: search everywhere
    this.idx = best;
    const p = pts[best], q = pts[Math.min(pts.length - 1, best + 1)], o = pts[Math.max(0, best - 1)];
    let dx = q.x - o.x, dz = q.z - o.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const rx = car.pos.x - p.x, rz = car.pos.z - p.z;
    const along = rx * dx + rz * dz;
    this.s = THREE.MathUtils.clamp(p.s + along, 0, this.route.length);
    this.lat = rx * dz - rz * dx; // + = left of the lane centre (driver's left is (dz, -dx))
    this.dist = Math.sqrt(bd);
  }

  nearJunction(margin = 28) {
    return this.events.some((e) => (this.kent ? NEAR_KENT : NEAR_WM).includes(e.kind) && this.s > e.s - margin && this.s < e.s + (e.kind === 'rb' ? 110 : margin))
      || this.world.rbs.some((rb) => Math.hypot(this.carPos.x - rb.x, this.carPos.z - rb.z) < rb.outer + 8);
  }

  /** ctl: { indicator: 'left'|'right'|null, mirrorPressed: bool, hit: bool } */
  update(dt, car, ctl) {
    if (this.done || this.waiting) return;
    if (this.endNow) { this.endOnDanger(car); return; } // a dangerous fault last frame: stop the test now
    this.t += dt;
    this.carPos = car.pos;
    const prevS = this.s;
    this.track(car);
    const s = this.s, mph = Math.abs(car.vF) * MPH;
    if (ctl.indicator && (!this.sig.length || this.t - this.sig[this.sig.length - 1].t > 0.25)) this.sig.push({ dir: ctl.indicator, s, t: this.t });
    if (ctl.mirrorPressed) this.mirror.push({ s, t: this.t });
    const signalled = (dir, s0, s1) => this.sig.some((x) => x.dir === dir && x.s >= s0 && x.s <= s1);
    const anySignal = (s0, s1) => this.sig.find((x) => x.s >= s0 && x.s <= s1)?.dir;
    const mirrors = (s0, s1) => this.mirror.some((m) => m.s >= s0 && m.s <= s1);
    const crossed = (line) => prevS < line && s >= line;

    // ---- moving off ----
    if (car.drive) this.drills(dt, car, mph);
    if (!this.moved && mph > 2 && car.vF > 0) { // forwards: creeping back in a drill isn't moving off
      this.moved = true; this.movedT = this.t;
      if (!this.mirror.some((m) => this.t - m.t < 10)) this.fault('minor', 'Move off: safety (mirrors)');
      // after an emergency stop you're already in the lane: mirrors yes, signal only if needed
      if (!this.afterStop && !this.sig.some((x) => x.dir === 'right' && this.t - x.t < 10)) this.fault('minor', 'Signals: necessary (moving off)');
    }

    // ---- events ----
    for (const e of this.events) {
      const lead = e.kind === 'pullup' ? 70 : e.kind === 'rb' ? 75 : 65;
      if (e.text && !e.said && s > e.s - lead && this.moved) {
        e.said = true;
        // independent driving: the sat nav gives the directions, not the examiner (in Kent the sat nav card speaks for itself)
        if (this.kent && this.independent) { if (TALK_ANYWAY.includes(e.kind)) this.say(e.text); }
        else this.say(this.independent && e.kind !== 'baypark' && e.kind !== 'pullup' ? `Sat nav: ${e.text.replace('At the', 'In 200 metres, at the').replace('Take the next', 'In 150 metres, take the next')}` : e.text);
      }
      if ((this.kent ? MARK_KENT : MARK_WM).includes(e.kind) && !e.marked && s > e.s + (e.kind === 'rb' ? 20 : 10)) {
        e.marked = true;
        const ref = e.s;
        const want = e.dir;
        // Kent: only look back as far as the end of the manoeuvre before (adjacent rings, turn after turn)
        const back = (d) => (this.kent ? Math.max(ref - d, e.prevEnd) : ref - d);
        if (want !== 'none' && !signalled(want, back(85), ref + 3)) this.fault('minor', 'Signals: necessary');
        const other = want === 'left' ? 'right' : want === 'right' ? 'left' : null;
        if (want === 'none' ? anySignal(back(60), ref) : signalled(other, back(60), ref + 1)) this.fault('minor', 'Signals: correctly');
        if (!mirrors(ref - 120, ref + 2)) this.fault('minor', 'Mirrors: change direction');
      }
      // emerging: you must slow right down (or stop) in the last 15 m to look properly
      const giveWay = e.kind === 'emerge' || (this.kent && e.kind === 'cross');
      if (giveWay && !e.lineDone && s > e.lineS - 15 && s <= e.lineS) e.minMph = Math.min(e.minMph ?? Infinity, mph);
      if (this.kent && giveWay && e.seenMajor == null && s > e.lineS - 4) e.seenMajor = this.majorBusy(e, car, 2.5, 35);
      if (this.kent && giveWay && e.stopSign == null) e.stopSign = !!this.world.net.nodes.get(e.node)?.stop;
      // automatic: told to stop (traffic on the main road as you reach the line), creeping over it is a control fault
      if (giveWay && car.drive?.kind === 'auto' && e.mustStop == null && s > e.lineS - 8 && this.kent) e.mustStop = this.majorBusy(e, car, 2.5, 35);
      if (giveWay && !e.lineDone && s > e.lineS - 8 && s <= e.lineS && mph < 0.5) e.stoppedAt = true;
      if (giveWay && !e.lineDone && crossed(e.lineS)) {
        e.lineDone = true;
        e.lineMph = mph;
        if (e.mustStop && !e.stoppedAt && mph > 2) this.fault('minor', 'Control: creep not controlled (crossed the give-way line)');
        if (e.stopSign && (e.minMph ?? mph) > 0.6) this.fault('serious', 'Response to signs and signals: traffic signs (did not stop at the STOP line)');
        if ((e.minMph ?? mph) > 7) this.fault('serious', 'Junctions: observation (emerged without slowing to look)');
        if (this.kent && this.majorBusy(e, car, 2.5, 35) && e.seenMajor) this.fault('serious', 'Junctions: observation (pulled out in front of traffic)');
      }
      // Kent: what was on the ring as the front reached the line (a car that pulls on in front of you after that isn't your fault)
      if (this.kent && e.kind === 'rb' && e.seenRing == null && s > e.entryS - 3) e.seenRing = this.rbConflict({ pos: posAtS(this, e.entryS + 1.7) }, 18, e.rb);
      if (e.kind === 'rb' && !e.entryDone && crossed(e.entryS + 1.7)) {
        e.entryDone = true;
        if (mph > 16) this.fault('minor', 'Junctions: approach speed');
        if (this.rbConflict(car, 18, this.kent ? e.rb : e.node) && (!this.kent || e.seenRing)) this.fault('serious', 'Junctions: observation (did not give way to the right)');
      }
      if (this.kent) { this.kentEvent(e, car, s, mph, dt, crossed, signalled, mirrors); continue; }
      if (e.kind === 'lights' && !e.done && crossed(e.s)) {
        e.done = true;
        if (this.world.lights.state === 'red' || this.world.lights.state === 'redamber') this.fault('serious', 'Response to signals: traffic lights');
      }
      if (e.kind === 'zebra' && !e.done && crossed(e.s)) {
        e.done = true;
        if (this.world.zebra.busy) this.fault('serious', 'Pedestrian crossings');
      }
    }

    // ---- continuous marking ----
    // Kent: the limit of the road the route is on (nearest() can't tell a bridge from the road under it)
    const limit = this.kent && this.dist < 6 ? this.route.pts[this.idx].road?.limit ?? this.world.speedLimitAt(car.pos.x, car.pos.z) : this.world.speedLimitAt(car.pos.x, car.pos.z);
    if (this.held('fast', mph > limit + 2, dt, 1.5)) this.fault('minor', 'Speed', 'speed', 12);
    if (this.held('vfast', mph > limit + 10, dt, 1.0)) this.fault('serious', 'Speed (well over the limit)', 'vspeed', 15);
    const nearJ = this.nearJunction();
    const pullingUp = s > this.route.length - 60;
    const here = this.route.pts[this.idx];
    const dual = here.road?.lanes === 2;
    const parkPhase = this.kent ? !!(here.park || this.route.layout?.inLot(car.pos.x, car.pos.z)) : inLot(car.pos.x, car.pos.z);
    if (this.kent) this.kentPosition(dt, car, here, nearJ, parkPhase);
    else if (dual && !nearJ && this.dist < 12) {
      // dual carriageway: lane 1 is the route; lane 2 is about one lane width to the right
      const lane = this.lat < -LW / 2 ? 2 : 1;
      if (lane !== this.lane) {
        const want = lane === 2 ? 'right' : 'left';
        if (!this.sig.some((x) => x.dir === want && this.t - x.t < 5)) this.fault('minor', 'Signals: necessary (changing lanes)', 'lanesig', 4);
        if (!this.mirror.some((m) => this.t - m.t < 8)) this.fault('minor', 'Mirrors: changing lanes', 'lanemir', 4);
        this.lane = lane;
      }
      if (this.held('lane2', lane === 2 && !this.slowAhead(car), dt, 15)) this.fault('minor', 'Positioning: lane discipline (keep left unless overtaking)', 'lanedisc', 20);
      if (this.held('kerb', this.lat > 1.05, dt, 0.2)) this.fault('minor', 'Control: steering (ran onto the edge line)', 'kerb', 8);
      if (this.held('pave', this.lat > 1.9, dt, 0.3)) this.fault('serious', 'Control: steering (left the carriageway)', 'pave', 10);
    } else if (!nearJ && !parkPhase && this.dist < 8) {
      this.lane = 1;
      if (this.held('wide', this.lat < -1.5, dt, 2)) this.fault('minor', 'Positioning: normal driving', 'pos', 10);
      if (this.held('wrong', this.lat < -2.6, dt, 1.5)) this.fault('serious', 'Positioning: driving on the wrong side', 'pos2', 12);
      if (this.held('kerb', this.lat > 1.05, dt, 0.15)) this.fault('minor', 'Control: steering (hit the kerb)', 'kerb', 8);
      if (this.held('pave', this.lat > 1.9, dt, 0.3)) this.fault('serious', 'Control: steering (mounted the pavement)', 'pave', 10);
    }
    // manoeuvre: count changes of direction and look before reversing
    if (parkPhase) {
      const d = car.vF > 0.3 ? 1 : car.vF < -0.3 ? -1 : 0;
      if (d && d !== this.lastDir) {
        if (this.lastDir) this.dirChanges++;
        if (d < 0 && !this.mirror.some((m) => this.t - m.t < 6)) this.fault('minor', 'Manoeuvres: observation (look before you reverse)', 'revobs', 6);
        this.lastDir = d;
      }
    }

    // ---- emergency stop ----
    const es = this.estop;
    if (es && es.state === 'armed' && s >= es.s && mph > 15) {
      Object.assign(es, { state: 'braking', t0: this.t, v0: mph });
      this.say('Stop!');
      this.hooks.estop?.(true);
    }
    if (es && es.state === 'braking') {
      if (!es.checked && this.t - es.t0 > 1.6) {
        es.checked = true;
        if (mph > es.v0 * 0.75) this.fault('serious', 'Control: emergency stop (too slow to react)');
      }
      if (mph < 0.5) {
        es.state = 'done';
        this.hooks.estop?.(false);
        this.say(this.def.mock ? 'Thank you. I will not ask you to do that exercise again. Drive on when you are ready.' : "Thank you. I won't ask you to do that again. Move off when you're ready.");
        this.moved = false;
        this.afterStop = true;
      } else if (this.t - es.t0 > 7) { es.state = 'done'; this.hooks.estop?.(false); this.fault('serious', 'Control: emergency stop (did not stop)'); }
    }

    // ---- name a sign at a red light (lessons only, not marked; main.js shows it) ----
    if (this.kent && !this.def.mock && this.hooks.signQuiz && this.moved && mph < 0.3 && this.t - (this.lastSignQ ?? -45) > 75
      && this.events.some((e) => e.kind === 'lights' && e.lineS - s > 0 && e.lineS - s < 25 && this.world.signals.stateFor(e.group, car.heading) === 'red')) {
      this.lastSignQ = this.t; this.waiting = true;
      this.hooks.signQuiz().then(() => { this.waiting = false; });
    }
    // ---- show me, while driving ----
    if (this.showMeS && !this.showMeDone && s > this.showMeS && mph > 8 && !nearJ) {
      this.showMeDone = true;
      this.waiting = true;
      const item = SHOW_ME[Math.floor(this.rnd() * SHOW_ME.length)];
      this.hooks.quiz({ title: 'Show me', ...item }).then((ok) => {
        this.waiting = false;
        if (!ok) this.fault('minor', 'Show me/tell me: show me question');
      });
    }
    if (car.drive) this.controlFaults(dt, car, mph, nearJ);
    if (ctl.hit) this.fault('dangerous', 'Control: collision', 'hit', 5);
    for (const p of this.people()) {
      const dp = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
      // Kent: someone crossing close in front, or anyone the car runs into at more than a crawl (KentTraffic's
      // pavement walkers cut across the mouths of side roads and can step against a car edging up to a line)
      if (this.kent ? (p.inRoad && dp < 1.6 && mph > 3) || (touching(car, p) && mph > 8) : dp < 1.6 && mph > 3) { this.lastExtra = { ped: [+p.x.toFixed(1), +p.z.toFixed(1)], kind: p.kind }; this.fault('dangerous', 'Pedestrian put at risk', 'ped', 6); }
    }
    const waitingAhead = this.events.some((e) => (this.kent ? WAIT_KENT : WAIT_WM).includes(e.kind) && s > (e.lineS ?? e.entryS ?? e.s) - 45 && s < (e.lineS ?? e.entryS ?? e.s) + 4)
      || (this.kent && (here.man || parkPhase || this.queued(car) || this.estop?.state === 'braking'));
    if (this.held('slow', this.moved && !waitingAhead && !pullingUp && !nearJ && mph < Math.min(8, limit * 0.3), dt, 12)) this.fault('minor', 'Progress: undue hesitation', 'slow', 25);

    // ---- no entry: the wrong way along a one-way street (only off the route: the route itself is legal) ----
    if (this.kent && this.dist > 4 && mph > 2) {
      const h = this.world.net.nearest(car.pos.x, car.pos.z, 8);
      if (h && h.way.oneway && !h.way.rb && h.dist < h.way.halfW && h.dir[0] * Math.sin(car.heading) + h.dir[1] * Math.cos(car.heading) < -0.5) this.fault('serious', 'Response to signs and signals: traffic signs (no entry: wrong way down a one-way street)', 'noentry', 30);
    }
    // ---- off route ----
    if (this.kent && this.dist < 6) this.goodS = s;
    if (this.held('off', this.dist > 14, dt, 4) && !this.offSaid) {
      this.offSaid = true;
      if (this.kent) this.reroute(car); // Kent: a new route from wherever we are
      else this.say(this.def.mock ? "We've gone off the route. Turn round when it's safe and I'll take you back." : "We've gone off the route. Turn round when it's safe and follow the blue line.");
    }
    if (this.dist < 6) this.offSaid = false;

    // ---- pulling up at the end ----
    const end = this.events.find((e) => e.kind === 'pullup' || e.kind === 'baypark');
    const nearEnd = end.kind === 'baypark' ? parkPhase && s > end.s - 25 : s > end.s - 55 && this.dist < 10;
    if (nearEnd && (!this.estop || this.estop.state !== 'braking')) {
      this.stopT = mph < 0.5 ? this.stopT + dt : 0;
      // the learner gearbox: secure the car (handbrake on) before the lesson ends; 6 s and it ends anyway, with a fault
      const secured = !car.drive || car.parkingBrake || this.stopT > 6;
      if (car.drive && this.stopT > 1 && !car.parkingBrake && !this.def.mock) this.coachText = 'Handbrake on (Space), please.';
      if (this.stopT > (end.kind === 'baypark' ? 1.6 : 1.2) && secured) {
        if (car.drive && !car.parkingBrake) this.fault('minor', 'Control: parking brake (not applied at the end)');
        this.finish(end, car);
      }
    }
    if (this.kent) this.satnavUpdate(car);
    this.hooks.hud({ text: this.text, coach: this.coachText, faults: this.counts(), mock: !!this.def.mock, title: this.independent ? 'Independent driving · follow the sat nav' : this.def.title });
  }

  // ---------- the learner gearbox: drills, control faults, coaching ----------
  /** move the drill queue on; a drill the driver skips by driving off is dropped */
  drills(dt, car, mph) {
    const step = this.drillQ[0];
    if (!step) return;
    if (!step.shown) { step.shown = true; this.drillS = this.s; this.creepT = 0; this.say(step.text); }
    if (step.k === 'creep' && mph > 1.5 && mph < 5.5 && car.drive.throttle < 0.05) this.creepT += dt;
    if (!['creep', 'reverse', 'select2'].includes(step.k) && mph > 4) { this.drillQ.length = 0; this.say("OK, we'll leave that one for now."); return; }
    if (step.done(this, car)) {
      this.drillQ.shift();
      if (this.tasks) this.tasks[step.k] = true;
      if (!this.drillQ.length) this.say(this.moved ? 'Good. Carry on along the road.' : "Good. Move off when you're ready: mirrors, signal, and away.");
    }
  }
  /** someone close by on the road: a stall here holds them up or puts them at risk */
  trafficNear(car, r) { return (this.world.traffic?.cars || []).some((c) => Math.hypot(c.x - car.pos.x, c.z - car.pos.z) < r); }
  /**
   * DVSA control faults for the gearbox (DT1 annex 6: coasting is "running on in neutral or with the
   * clutch depressed"; wrong gear; the parking brake), and the coach's tips in lessons (not tests).
   */
  controlFaults(dt, car, mph, nearJ) {
    const d = car.drive, f = d.flags, manual = d.kind === 'manual', mock = !!this.def.mock;
    this.trans = d.kind;
    const C = this.ctl || (this.ctl = { stalls: d.stalls, grinds: d.grinds, n: 0, keyOff: d.keyOff, gear: d.gear, said: {} });
    const coachSay = (key, text, every = 14) => { if (mock) return; if ((C.said[key] ?? -99) + every < this.t) { C.said[key] = this.t; this.hooks.say(text); } };
    let tip = '';
    // stalling: a driving fault; serious if it leaves you stuck in a junction with traffic about, or keeps happening
    if (d.stalls !== C.stalls) {
      C.stalls = d.stalls;
      if (this.drillQ.length) { if (this.drillQ[0].k !== 'stall' && this.drillQ[0].k !== 'recover') this.drillQ.unshift({ k: 'recover', ...DRILLS.recover }); }
      else {
        C.n++;
        const moveOff = !this.moved || this.t - (this.movedT ?? -99) < 5, blocking = nearJ && this.trafficNear(car, 40);
        const cat = moveOff ? 'Move off: control (stalled)' : blocking ? 'Control: clutch (stalled in a junction)' : 'Control: clutch (stalled)';
        this.fault(blocking || C.n >= 3 ? 'serious' : 'minor', cat);
        coachSay('stall', "You've stalled. Clutch down, neutral, then I to restart. A bit more gas and a slower clutch next time.", 4);
      }
    }
    if (d.grinds !== C.grinds) { C.grinds = d.grinds; this.fault('minor', 'Control: gears (changed gear without the clutch)', 'grind', 10); }
    if (manual) {
      // riding the clutch: held part way down while driving along
      if (this.held('ride', d.pedal > 0.12 && d.pedal < 0.88 && mph > 3, dt, 3)) this.fault('minor', 'Control: clutch (riding the clutch)', 'ride', 20);
      if (this.held('coastC', d.pedal > 0.6 && d.gear !== 'N' && mph > 10, dt, 3)) { this.fault('minor', 'Control: clutch (coasting with the clutch down)', 'coastC', 15); coachSay('coast', "Don't coast with the clutch down: find a gear and let the clutch up."); }
      if (this.held('lab', f.labouring, dt, 2)) this.fault('minor', 'Control: gears (wrong gear, engine labouring)', 'lab', 15);
      if (this.held('rev', f.overRev && d.engaged > 0.9 && d.gear !== 'N' && mph > 3, dt, 1.5)) this.fault('minor', 'Control: gears (wrong gear, over-revving)', 'rev', 15);
      const g = typeof d.gear === 'number' ? d.gear : null, best = gearFor(car.vF, g ?? 1);
      if (f.labouring && this.timers.lab > 0.7) { tip = `Engine labouring: change down to ${ORD_GEAR[best]}.`; coachSay('lab', `Change down to ${ORD_GEAR[best]}.`, 8); }
      else if (this.timers.rev > 0.5) { tip = `Too many revs: change up to ${ORD_GEAR[best]}.`; coachSay('rev', `Change up to ${ORD_GEAR[best]}.`, 8); }
      else if (this.def.tasks && g && best > g && d.rpm > 3300 && d.throttle > 0.3) tip = `Change up to ${ORD_GEAR[best]}.`;
      // the gears lesson's tasks
      if (this.tasks) {
        if (g >= 4) this.tasks.up4 = true;
        if (typeof C.gear === 'number' && g && g < C.gear) {
          if (C.gear - g >= 2) this.tasks.block = true;
          if (this.events.some((e) => ['rb', 'emerge', 'turn', 'mini', 'cross'].includes(e.kind) && (e.lineS ?? e.entryS ?? e.s) - this.s < 90 && (e.lineS ?? e.entryS ?? e.s) - this.s > -5)) this.tasks.down = true;
        }
      }
    }
    if (d.gear !== C.gear) C.gear = d.gear;
    if (this.held('coastN', d.gear === 'N' && mph > 10, dt, 3)) this.fault('minor', 'Control: gears (coasting in neutral)', 'coastN', 15);
    // the parking brake: moving with it on; secured at pull-ups and before switching off
    if (d.parkingBrake && mph > 1) { this.fault('minor', 'Control: parking brake (moving with it on)', 'pbmove', 30); tip = 'Handbrake still on! Press Space.'; }
    if (this.pulledUp) {
      if (mph < 0.5 && d.parkingBrake) this.pulledUp.secured = true;
      if (mph > 2) { if (!this.pulledUp.secured) this.fault('minor', 'Control: parking brake (not applied when you pulled up)'); this.pulledUp = null; }
    }
    if (d.keyOff && !C.keyOff && !d.parkingBrake) this.fault('minor', 'Control: parking brake (not applied before switching off)');
    C.keyOff = d.keyOff;
    if (d.kind === 'auto' && d.gear === 'D' && car.vF < -0.9) this.fault('minor', 'Control: rolled back', 'rollback', 10);
    // the coach's line (lessons only): what to do next with the controls
    if (!mock) {
      if (!d.engineOn) tip = d.stalled ? 'Stalled: clutch down, neutral (0), handbrake on, then I to restart.' : manual ? 'Engine off: clutch down (Shift), neutral (0), then I.' : 'Engine off: foot on the brake, P (9) or N (0), then I.';
      else if (!this.moved && mph < 0.5 && !this.drillQ.length) tip = manual ? 'Moving off: clutch down · first (1) · gentle gas (W) · find the bite · handbrake off (Space) · mirrors (Q) · signal (X) · clutch up gently'
        : 'Moving off: foot on the brake · D (1) · handbrake off (Space) · mirrors (Q) · signal (X) · ease off the brake';
      else if (this.pulledUp && !this.pulledUp.secured && mph < 0.5) tip = manual ? 'Pulled up: handbrake on (Space), then neutral (0).' : 'Pulled up: handbrake on (Space), then N (0).';
      else if (f.coasting && mph > 8) tip = manual ? 'Coasting: get it in gear and the clutch up.' : 'Coasting in N: select D.';
    }
    this.coachText = tip;
  }

  people() {
    if (this.kent) return (this.world.traffic?.peds || []).map((p) => ({ x: p.x, z: p.z, kind: p.inRoad ? 'in the road' : 'pavement', inRoad: p.inRoad }));
    const list = [];
    for (const c of this.world.crossers || []) list.push({ x: c.mesh.position.x, z: c.mesh.position.z, kind: c.state });
    for (const p of this.world.traffic?.peds || []) list.push({ x: p.x, z: p.z, kind: 'pavement' });
    return list;
  }

  /** a slower vehicle ahead in lane 1 (a reason to be in lane 2) */
  slowAhead(car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    return (this.world.traffic?.cars || []).some((c) => {
      const dx = c.x - car.pos.x, dz = c.z - car.pos.z, along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
      return along > 0 && along < 160 && Math.abs(lat - LW) < 2.2;
    });
  }

  rbConflict(car, range = 18, name = null) {
    // Whitmore names its rings; Kent passes the ring id and each record carries its own sense
    const rb = this.world.rbs.find((r) => r.name === name) || this.world.rb;
    if (!rb) return false;
    const sense = rb.sense ?? this.world.rbSenseSign;
    const th = Math.atan2(car.pos.z - rb.z, car.pos.x - rb.x);
    for (const c of this.world.traffic?.cars || []) {
      if (c.v < 1.5 || c.lane?.rb !== rb.name) continue;
      const ph = Math.atan2(c.z - rb.z, c.x - rb.x);
      let d = (th - ph) * sense;
      d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (d * rb.lane < range) return true;
    }
    return false;
  }

  // ---------- Kent ----------
  /** the lane the car is in on a multi-lane carriageway: the path's lane plus whole lanes sideways */
  carLane(here) {
    const n = Math.max(1, here.road?.lanes || 1);
    return Math.max(1, Math.min(n, (here.lane || 1) - Math.round(this.lat / this.laneW(here))));
  }
  laneW(here) {
    const w = this.world.net.ways.get(here.way);
    return !w ? LW : w.oneway ? w.width / Math.max(1, w.lanesF) : w.halfW / Math.max(1, (here.dir ?? 1) < 0 ? w.lanesB : w.lanesF);
  }
  /** Kent events: lights by signal group, zebras by who is there, roundabout lanes, slip roads, stops */
  kentEvent(e, car, s, mph, dt, crossed, signalled, mirrors) {
    const net = this.world.net, here = this.route.pts[this.idx];
    if (e.kind === 'lights' && !e.done && crossed(e.lineS - FRONT)) { // the front of the car over the stop line
      e.done = true;
      const st = this.world.signals.stateFor(e.group, car.heading);
      if (st === 'red' || st === 'redamber') this.fault('serious', 'Response to signals: traffic lights');
    }
    if (e.kind === 'zebra' && !e.done) {
      // someone on it, or waiting, while there was still room to stop: give way (people who step out
      // at the last moment are not the driver's fault)
      const busy = this.world.trafficSystem.crossingBusy(e.key), room = e.lineS - FRONT - s - (mph / MPH) ** 2 / 8;
      e.couldStop = busy && (e.couldStop || room > 1);
      if (crossed(e.lineS - FRONT)) { e.done = true; if (busy && e.couldStop) this.fault('serious', 'Pedestrian crossings'); }
    }
    if (e.kind === 'rb') {
      const rb = net.roundabouts.get(e.rb);
      // approach lane, over the last 25 m before the give-way line (where there is more than one)
      if (!e.apDone && s > e.entryS - 15 && s < e.entryS - 4 && here.road?.lanes >= 2 && !here.rb && this.dist < 6
        && this.held(`ap${e.entryS}`, this.carLane(here) !== e.approachLane, dt, 1)) { e.apDone = true; this.fault('minor', 'Junctions: positioning (wrong lane for the roundabout)'); }
      // on the ring: the lane the exit wants (Highway Code 186)
      if (rb && rb.lanes >= 2 && !e.ringDone && s > e.entryS + 4 && s < e.exitS - 3) {
        const R = Math.hypot(car.pos.x - rb.x, car.pos.z - rb.z), k = Math.max(1, Math.min(rb.lanes, Math.round((rb.r - R) / rb.laneW + 0.5)));
        if (this.held(`ring${e.entryS}`, k !== e.ringLane, dt, 1.2)) { e.ringDone = true; this.fault('minor', 'Positioning: lane discipline (on the roundabout)'); }
      }
      // leaving: the exit lane
      if (!e.exDone && s > e.exitS + 8 && s < e.exitS + 35 && here.road?.lanes >= 2 && !here.rb && this.dist < 6
        && this.held(`ex${e.entryS}`, this.carLane(here) !== Math.min(e.exitLane, here.road.lanes), dt, 1)) { e.exDone = true; this.fault('minor', 'Positioning: lane discipline (leaving the roundabout)'); }
      // past the exit before yours: mirrors and a left signal for your exit
      if (!e.exitSigDone && s > e.exitS + 6) {
        e.exitSigDone = true;
        if (e.exit >= 2 && !signalled('left', e.signalLeftS - 6, e.exitS + 4)) this.fault('minor', 'Signals: necessary (signal left for your exit)');
        if (e.exit >= 2 && !mirrors(e.signalLeftS - 16, e.exitS + 4)) this.fault('minor', 'Mirrors: change direction (leaving the roundabout)');
      }
    }
    if (e.kind === 'merge') {
      // joining from a slip road: signal, mirrors, match the traffic's speed, don't stop unless you must
      if (s > e.s - 150 && s < e.s && this.moved && !e.slipDone && this.held(`slip${e.s}`, mph < 1 && !this.mergeTraffic(e, car), dt, 2.5)) { e.slipDone = true; this.fault('minor', 'Progress: stopped on the slip road'); }
      if (!e.marked && crossed(e.s)) {
        e.marked = true;
        if (!signalled('right', e.s - 130, e.s + 5)) this.fault('minor', 'Signals: necessary (joining the carriageway)');
        if (!mirrors(e.s - 160, e.s + 5)) this.fault('minor', 'Mirrors: change direction (joining the carriageway)');
      }
      // up to speed once in the lane, 40 m on (OSM slips meet the main road at a slant, so the join itself is a bend)
      if (!e.speedDone && crossed(e.s + 40)) {
        e.speedDone = true;
        const lim = here.road?.limit || 70;
        if (lim >= 50 && mph < Math.min(35, lim - 25) && !this.mergeTraffic(e, car)) this.fault('minor', 'Progress: joining too slowly (match the speed of the traffic)');
      }
    }
    if (e.kind === 'diverge') {
      // leaving: in lane 1 in good time (e.s is 100 m before the slip road), signal left, mirrors
      const node = e.s + 100;
      if (!e.posDone && crossed(e.s + 30)) { e.posDone = true; if (here.road?.lanes >= 2 && this.dist < 6 && this.carLane(here) !== 1) this.fault('minor', 'Positioning: lane discipline (late for the slip road)'); }
      if (!e.marked && s > node + 6) {
        e.marked = true;
        if (!signalled('left', e.s - 60, node + 3)) this.fault('minor', 'Signals: necessary (leaving the carriageway)');
        if (!mirrors(e.s - 100, node + 3)) this.fault('minor', 'Mirrors: change direction (leaving the carriageway)');
      }
    }
    if (e.kind === 'stop' && !e.done) {
      // pull up on the left when asked, then move off again (an angled start from behind a parked car)
      if (s > e.s - 30 && s < e.s + 20 && mph < 0.5 && this.moved) e.stopT = (e.stopT || 0) + dt; else e.stopT = 0;
      if (e.stopT > 1.5) {
        e.done = true;
        if (!signalled('left', e.s - 120, s + 1)) this.fault('minor', 'Signals: necessary (pulling up)');
        if (!mirrors(e.s - 130, s + 1)) this.fault('minor', 'Mirrors: signalling (pulling up)');
        if (this.lat < -0.5) this.fault('minor', 'Positioning: too far from the kerb');
        this.say(this.def.mock ? this.testStopText(e) : e.angled ? "Thank you. Move off when you're ready. The car in front makes this an angled start, so look round to your right before you pull out." : "Thank you. Move off again when you're ready.");
        this.moved = false; this.afterStop = false;
        this.stopN++; this.pulledUp = { secured: false };
        const q = this.def.drills?.[`stop${this.stopN}`];
        if (q && car.drive) this.drillQ.push(...q.map((k) => ({ k, ...DRILLS[k] })));
      } else if (s > e.s + 25) { e.done = true; this.fault('minor', 'Control: pulling up (did not stop when asked)'); }
    }
    if (e.kind === 'pullright') {
      // pull up on the right, reverse about two car lengths, drive on (DVSA manoeuvre)
      if (!e.phase) {
        if (s > e.stopS - 15 && s < e.stopS + 25 && mph < 0.5 && this.moved) e.t = (e.t || 0) + dt; else e.t = 0;
        if (e.t > 1.5) {
          e.phase = 'stopped'; e.at = s;
          if (!signalled('right', e.s - 100, s + 1)) this.fault('minor', 'Signals: necessary (pulling up on the right)');
          if (!mirrors(e.s - 110, s + 1)) this.fault('minor', 'Mirrors: change direction');
          this.say(this.def.mock ? 'I would now like you to reverse for about two car lengths, keeping reasonably close to the kerb.' : 'Now reverse back about two car lengths, keeping reasonably close to the kerb.');
        } else if (s > e.stopS + 30) { e.phase = 'done'; this.fault('serious', 'Manoeuvres: control (did not pull up on the right)'); }
      } else if (e.phase === 'stopped' && car.vF < -0.3) {
        e.phase = 'reversing'; e.minS = s; e.t = 0;
        if (!this.mirror.some((m) => this.t - m.t < 6)) this.fault('minor', 'Manoeuvres: observation (look before you reverse)');
      } else if (e.phase === 'reversing') {
        e.minS = Math.min(e.minS, s);
        if (mph < 0.5) e.t += dt; else e.t = 0;
        if (e.t > 1.5 || car.vF > 0.5) {
          e.phase = 'done';
          const back = e.at - e.minS;
          if (back < 5 || back > 14) this.fault('minor', 'Manoeuvres: control (reverse about two car lengths)');
          if (Math.abs(this.lat) > 0.9) this.fault('minor', 'Manoeuvres: accuracy (keep close to the kerb)');
          this.say(this.def.mock ? 'Thank you. Drive on when you are ready, please.' : "Thank you. Drive on when you're ready.");
          this.moved = false; this.afterStop = true; // mirrors before moving off; a signal only if it helps someone
        }
      }
    }
  }
  /** lane discipline and keeping to the left on the Kent roads */
  kentPosition(dt, car, here, nearJ, parkPhase) {
    const r = here.road, w = this.world.net.ways.get(here.way);
    if (!r || !w || here.rb || here.park || parkPhase || this.dist > 8) { this.lane = null; return; }
    if (r.lanes >= 2 && w.oneway) {
      if (nearJ) return;
      // a multi-lane carriageway: which lane, and a change needs mirrors and a signal
      // the path renumbers its lanes where lanes are added or dropped; only a move across the lane
      // lines (or following the path's own lane change) is a lane change the driver makes
      const latLane = -Math.round(this.lat / this.laneW(here)), pathLane = here.lane || 1, lane = this.carLane(here);
      if (this.lane == null) { this.lane = lane; this.latLane = latLane; this.pathLane = pathLane; }
      const following = pathLane !== this.pathLane && this.events.some((e) => e.kind === 'laneChange' && e.toLane === pathLane && this.s > e.s - 5 && this.s < e.s + 45);
      const moved = lane !== this.lane && (latLane !== this.latLane || following);
      this.latLane = latLane; this.pathLane = pathLane;
      if (!moved) this.lane = lane;
      if (lane !== this.lane) {
        const want = lane > this.lane ? 'right' : 'left';
        if (!this.sig.some((x) => x.dir === want && this.t - x.t < 5)) this.fault('minor', 'Signals: necessary (changing lanes)', 'lanesig', 4);
        if (!this.mirror.some((m) => this.t - m.t < 8)) this.fault('minor', 'Mirrors: changing lanes', 'lanemir', 4);
        if (lane < this.lane && this.events.some((e) => e.kind === 'diverge' && this.s > e.s + 40 && this.s < e.s + 100)) this.fault('minor', 'Junctions: late lane change', 'latelane', 10);
        this.lane = lane;
      }
      if (this.held('lane2', lane > 1 && (here.lane || 1) === 1 && !this.slowAhead(car), dt, 15)) this.fault('minor', 'Positioning: lane discipline (keep left unless overtaking)', 'lanedisc', 20);
      const kerb = w.halfW - this.world.net.laneOffset(w, here.lane || 1) - (here.off || 0); // lane centre to the nearside edge
      if (lane === 1 && this.held('kerb', this.lat > kerb - 0.8, dt, 0.2)) this.fault('minor', 'Control: steering (ran onto the edge line)', 'kerb', 8);
      if (lane === 1 && this.held('pave', this.lat > kerb + 0.05, dt, 0.3)) this.fault('serious', 'Control: steering (left the carriageway)', 'pave', 10);
      return;
    }
    this.lane = null;
    if (nearJ || here.man) return;
    // one lane each way (or a one-lane one-way street): keep left of the centre line, off the kerb
    const k = here.lane || 1, off = w.halfW - (k - 0.5) * this.laneW(here); // lane centre from the centreline, + = left of travel
    const kerb = w.halfW - off - (here.off || 0);
    if (!w.oneway) {
      if (this.held('wide', this.lat < -(off - 0.35), dt, 2)) this.fault('minor', 'Positioning: normal driving', 'pos', 10);
      if (this.held('wrong', this.lat < -(off + 0.75), dt, 1.5)) this.fault('serious', 'Positioning: driving on the wrong side', 'pos2', 12);
    }
    if (this.held('kerb', this.lat > kerb - 0.8, dt, 0.15)) this.fault('minor', 'Control: steering (hit the kerb)', 'kerb', 8);
    if (this.held('pave', this.lat > kerb + 0.05, dt, 0.3)) this.fault('serious', 'Control: steering (mounted the pavement)', 'pave', 10);
  }
  /**
   * Traffic on the main road coming to this junction: moving, within r m (or `secs` s) of the node,
   * heading for it and not coming from behind me down my own road.
   */
  majorBusy(e, car, secs = 5.5, r = 45) {
    const node = this.world.net.nodes.get(e.node); if (!node) return false;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of this.world.traffic?.cars || []) {
      if (c.v < 1) continue;
      const dx = node.x - c.x, dz = node.z - c.z, d = Math.hypot(dx, dz);
      if (d > Math.max(r, c.v * secs) || d < 1) continue;
      if ((dx * c.fx + dz * c.fz) / d < 0.3) continue; // not heading for the junction
      if (c.fx * fx + c.fz * fz > 0.8 && (c.x - car.pos.x) * fx + (c.z - car.pos.z) * fz < 0) continue; // behind me, same way
      if (d / c.v < secs) return true;
    }
    return false;
  }
  /** traffic on the main carriageway near where the slip road joins it (a reason to wait or slow) */
  mergeTraffic(e, car) {
    const node = this.world.net.nodes.get(e.node), fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    if (!node) return false;
    return (this.world.traffic?.cars || []).some((c) => {
      const d = Math.hypot(c.x - node.x, c.z - node.z);
      return d < 90 && c.fx * fx + c.fz * fz > 0.7 && Math.hypot(c.x - car.pos.x, c.z - car.pos.z) > 3;
    });
  }
  /** a vehicle close ahead on my path going slowly or stopped (a queue), or one stopped across my nose: held up, not hesitating */
  queued(car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    return (this.world.traffic?.cars || []).some((c) => {
      const dx = c.x - car.pos.x, dz = c.z - car.pos.z, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      return (along > 0 && along < 25 && lat < 2.5 && c.v < 4) || (along > -1 && Math.hypot(dx, dz) < 8 && c.v < 1);
    }) || (this.world.traffic?.peds || []).some((p) => { // or waiting for someone crossing in front of the car
      const dx = p.x - car.pos.x, dz = p.z - car.pos.z, along = dx * fx + dz * fz;
      if (!(along > 0 && along < 9 && Math.abs(dx * fz - dz * fx) < 3.5)) return false;
      if (p.inRoad) return true;
      const h = this.world.net.nearest(p.x, p.z, 12); // on the carriageway (cutting across a junction mouth), not the pavement
      return !!h && h.dist < h.way.halfW;
    });
  }
  inKentBay(car, bay) {
    if (!bay) return false;
    const L = this.route.layout, l = L.local(car.pos.x, car.pos.z), b = L.local(bay.x, bay.z);
    return Math.abs(l.u - b.u) < 0.55 && Math.abs(l.n - b.n) < 0.9 && Math.abs(Math.cos(car.heading - bay.heading)) > 0.96;
  }
  /**
   * Off the route for 4 s: a new route from here through the via points not reached yet, to the same
   * end. Its arc lengths carry on from where we are, so the signal and mirror history still lines up;
   * events already passed are gone with the old path and never marked again.
   */
  reroute(car) {
    const sNow = this.goodS ?? this.s, net = this.world.net, oldLen = this.route.length;
    const vias = (this.spec.vias || []).filter((v, i) => this.viaS[i] > sNow + 10);
    let r = null;
    try { r = buildKentRoute(net, { ...this.spec, start: { x: car.pos.x, z: car.pos.z }, vias, stops: 0, angled: false, pullRight: false }); } catch { r = null; }
    if (!r || r.pts.length < 4) { this.say(this.def.mock ? "We've gone off the route. Turn round when it's safe and I'll take you back." : "We've gone off the route. Turn round when it's safe."); return; }
    for (const p of r.pts) p.s += sNow;
    for (const e of r.events) for (const k of ['s', 'lineS', 'entryS', 'exitS', 'signalLeftS', 'stopS', 'endS']) if (e[k] != null) e[k] += sNow;
    r.length += sNow;
    if (this.indep) { // keep the independent stretch ending as far from the end as it did
      const tail = oldLen - this.indep[1];
      this.indep = [this.independent ? sNow : Math.max(sNow, r.length - (oldLen - this.indep[0])), r.length - tail];
    }
    if (this.estop?.state === 'armed') this.estop = null; // the road it was planned on may not be on the new route
    for (const e of this.events) if (e.parkedH && !e.done) { this.hooks.removeParked?.(e.parkedH); e.parkedH = null; } // a pull-up we'll never reach
    this.route = { ...r, layout: this.route.layout };
    this.events = r.events.map((e) => ({ ...e, text: dt1Text(e, !!this.def.mock) }));
    let prevEnd = sNow;
    for (const e of this.events) { e.prevEnd = prevEnd; if (MANOEUVRES.includes(e.kind)) prevEnd = endOf(e); }
    this.viaS = viaPositions(this.route);
    this.spec = { ...this.spec, vias };
    this.idx = 0;
    this.track(car);
    if (this.guide) { this.world.scene.remove(this.guide); this.guide.geometry.dispose(); this.guide = guideLine(this.route.pts, this.world.heightAt); this.world.scene.add(this.guide); }
    this.satnav = { next: null, called: {} };
    this.say(this.independent ? (this.indepMode === 'signs' ? `That's fine. Follow the signs for ${this.signsTarget} again when you can.` : 'Sat nav: route recalculated.') : "That's fine, I'll take you back on to the route. Follow the road and I'll direct you.");
  }
  /**
   * The sat nav card during independent driving: the next manoeuvre, its arrow (a roundabout exit
   * number with the lane to use), the distance counting down and the road it leads to, with "In 300
   * yards" and "In 100 yards" spoken as it comes up.
   */
  satnavUpdate(car) {
    if (this.indep && !this.indepEnded && this.s > this.indep[1] && this.def.indepSpec) { this.indepEnded = true; this.say("Thank you, that's the end of the independent driving. I will direct you from now on."); }
    if (!this.independent || this.done) { if (this.satnav.shown) { this.satnav.shown = false; this.hooks.satnav?.(null); } return; }
    if (this.indepMode === 'signs') { this.satnav.shown = true; this.hooks.satnav?.({ arrow: 'signs', yards: null, text: `Follow the signs for ${this.signsTarget}`, road: '', lanes: null }); return; }
    const s = this.s, YD = 0.9144;
    const e = this.events.find((q) => SATNAV.includes(q.kind) && (q.lineS ?? q.entryS ?? q.s) > s - 2);
    if (!e) { this.hooks.satnav?.(null); return; }
    const at = e.kind === 'diverge' ? e.s + 100 : e.lineS ?? e.entryS ?? e.s, yards = Math.max(0, (at - s) / YD);
    const after = this.route.pts[idxAtS(this.route.pts, (e.exitS ?? at) + 30)];
    const way = after && this.world.net.ways.get(after.way), road = way ? [way.ref, way.name].filter(Boolean).join(' ') : '';
    const lanes = e.kind === 'rb' ? (e.approachLane > 1 ? 'Use the right-hand lane' : null) : null;
    const arrow = e.kind === 'rb' ? 'rb' : e.kind === 'merge' ? 'merge' : e.kind === 'diverge' ? 'left' : e.dir === 'left' ? 'left' : e.dir === 'right' ? 'right' : 'ahead';
    const what = e.kind === 'rb' ? `at the roundabout, take the ${ORDW[e.exit - 1] || e.exit + 'th'} exit` : e.kind === 'mini' ? `at the mini roundabout, ${e.dir === 'none' ? 'go straight on' : 'turn ' + e.dir}`
      : e.kind === 'merge' ? 'join the carriageway' : e.kind === 'diverge' ? 'take the slip road on the left' : e.kind === 'cross' ? 'go straight on at the junction' : e.dir === 'none' ? 'continue straight on' : `turn ${e.dir}`;
    const key = `${e.kind}${Math.round(at)}`;
    const called = this.satnav.called[key] || (this.satnav.called[key] = {});
    for (const [d, words] of [[300, 'In 300 yards'], [100, 'In 100 yards']]) {
      if (!called[d] && yards <= d && yards > d - 60 && this.moved) { called[d] = true; called[300] = true; this.say(`Sat nav: ${words}, ${what}${road ? `, onto ${road}` : ''}.${lanes && d === 300 ? ` ${lanes}.` : ''}`); }
    }
    this.satnav.shown = true;
    this.hooks.satnav?.({ arrow, exit: e.kind === 'rb' ? e.exit : null, yards: Math.round(yards / 10) * 10, road, lanes, text: what });
  }

  counts() {
    const c = { minor: 0, serious: 0, dangerous: 0 };
    for (const f of this.faults) c[f.sev]++;
    return c;
  }

  finish(end, car) {
    if (!end.marked) {
      end.marked = true;
      if (end.kind === 'baypark') {
        const inBay = this.kent ? this.inKentBay(car, end.bay)
          : BAYS.some((b) => Math.abs(car.pos.x - b.x) < 0.55 && Math.abs(car.pos.z - b.z) < 0.9) && Math.abs(Math.cos(car.heading)) > 0.96;
        if (!inBay) this.fault('serious', 'Manoeuvres: bay park accuracy (not inside the bay)');
        if (this.dirChanges > 2) this.fault('minor', 'Manoeuvres: control (too many shunts)');
      } else {
        if (!signalled(this.sig, 'left', end.s - 110)) this.fault('minor', 'Signals: necessary (pulling up)');
        if (!this.mirror.some((m) => m.s >= end.s - 120)) this.fault('minor', 'Mirrors: signalling (pulling up)');
        if (this.lat < -0.4) this.fault('minor', 'Positioning: too far from the kerb');
      }
    }
    this.report(car, false);
  }

  /** A test ends the moment you commit a dangerous fault — the examiner stops you for safety and
   * hands over the full report there and then (real tests run on, but Richard asked for this). */
  isTest() { return !!(this.def.mock || this.def.generated); }
  endOnDanger(car) {
    this.say('That is a dangerous fault, so I am going to stop the test here for safety. Pull up on the left when it is safe, and I will give you your report.');
    this.report(car, 'danger');
  }

  /** The player asked to stop now, from the "Stop and get my report" button: faults so far only,
   * no pass (you can't pass a test or lesson you chose to end early). */
  quit(car) {
    this.say("No problem - let's stop there. Here's my report on what you've done so far.");
    this.report(car, 'player');
  }

  /** Build the DL25 sheet + debrief and hand it to the result screen. `terminated` is false for a
   * natural finish, 'danger' when a dangerous fault stopped the test, 'player' when they asked to
   * stop early themselves - either way you only get credited faults for what you actually drove. */
  report(car, terminated) {
    this.done = true;
    this.dispose();
    // the DL25: one marking for the pass/fail, the sheet and the debrief (dl25.js); repetition only counts on tests
    const man = this.spec?.manoeuvre || (this.spec?.pullRight ? 'pullright' : this.spec?.end === 'baypark' ? 'baypark' : null);
    const sheet = scoreSheet(this.faults, { test: !!this.def.mock, man });
    const c = { minor: sheet.total, serious: sheet.serious, dangerous: sheet.dangerous };
    const passed = terminated === 'player' ? false : sheet.passed;
    const brief = debrief(sheet, { where: (f) => this.where(f), mock: !!this.def.mock, trans: this.trans || car.trans, lessonTitle: (id) => LESSONS.find((l) => l.id === id)?.title || id });
    const groups = {};
    for (const f of this.faults) {
      const k = `${f.sev}|${f.cat}`;
      groups[k] = (groups[k] || 0) + 1;
    }
    const lines = Object.entries(groups).map(([k, n]) => { const [sev, cat] = k.split('|'); return { sev, cat, n }; })
      .sort((a, b) => ['dangerous', 'serious', 'minor'].indexOf(a.sev) - ['dangerous', 'serious', 'minor'].indexOf(b.sev));
    if (!terminated) this.say(this.def.mock ? `Please switch off the engine and give me a moment to complete my test report. ${brief.spoken}` : brief.verdict);
    const map = this.kent || this.route.pts.length ? { pts: this.route.pts.filter((q, i) => i % 6 === 0).map((q) => [+q.x.toFixed(1), +q.z.toFixed(1)]), faults: this.faults.filter((f) => f.at).map((f) => ({ x: f.at.x, z: f.at.z, sev: f.sev })) } : null;
    this.hooks.result({ id: this.def.id, title: this.def.title, mock: !!this.def.mock, real: !!this.def.real, practice: !!this.def.practice, passed, counts: c, lines, time: this.t, tasks: this.tasks, trans: this.trans || car.trans,
      sheet, brief, map, generated: this.def.generated || null, signs: this.def.signs || null, terminated: terminated || false });
  }

  /** where a fault happened, for the debrief: the roundabout or junction near it, else the road */
  where(f) {
    const s = f.s ?? 0, net = this.world.net;
    const e = this.events.find((q) => (q.kind === 'rb' && s > q.entryS - 60 && s < q.exitS + 30) || (['emerge', 'turn', 'cross', 'mini', 'lights', 'zebra'].includes(q.kind) && Math.abs((q.lineS ?? q.s) - s) < 35));
    if (e && net) {
      if (e.kind === 'rb') { const rb = net.roundabouts.get(e.rb); const nm = rb?.name && !rb.name.includes('?') ? rb.name.replace(/ Roundabout$/i, '') : null; return nm ? `${nm} roundabout` : 'the roundabout'; }
      const node = e.node ? net.nodes.get(e.node) : null;
      if (node) { const names = [...new Set(node.ways.map((r) => r.way.name || r.way.ref).filter(Boolean))]; if (names.length >= 2) return `the ${e.kind === 'lights' ? 'lights' : e.kind === 'zebra' ? 'zebra crossing' : 'junction'} of ${names.slice(0, 2).join(' and ')}`; }
    }
    const p = this.route.pts[Math.max(0, idxAtS(this.route.pts, s))], w = p && net?.ways.get(p.way);
    return w ? [w.ref, w.name].filter(Boolean).join(' ') || 'a side road' : '';
  }
  /** DT1 wording after a pull-up on a test: the independent driving briefing, the emergency stop briefing */
  testStopText(e) {
    const firstStop = this.events.find((q) => q.kind === 'stop');
    if (this.def.indepSpec && e === firstStop) return this.indepMode === 'signs'
      ? `Now I would like you to drive independently following the traffic signs for ${this.signsTarget}. Continue to follow the signs until I tell you otherwise. Drive on when you are ready.`
      : "Now I would like you to drive independently, following the directions from the sat nav until I tell you otherwise. Please don't rely on the speeds shown on the sat nav, as they may not be accurate. Drive on when you are ready.";
    const nextStop = this.events.find((q) => q.kind === 'stop' && q.s > e.s);
    if (this.def.spec && this.estop?.state === 'armed' && this.estop.s > e.s && (!nextStop || nextStop.s > this.estop.s)) {
      this.estop.briefed = true;
      return "Shortly I shall ask you to carry out an emergency stop. When I give the signal, 'Stop!', I'd like you to stop as quickly and as safely as possible. Before giving the signal I shall look round to make sure it is safe, but please wait for my signal. Drive on when you are ready.";
    }
    return 'Thank you. Drive on when you are ready, please.';
  }

  cancel(why) {
    if (this.done) return;
    this.done = true;
    this.dispose();
    this.hooks.cancelled(why);
  }

  dispose() {
    if (this.guide) { this.world.scene.remove(this.guide); this.guide.geometry.dispose(); }
    for (const e of this.events || []) if (e.parkedH) { this.hooks.removeParked?.(e.parkedH); e.parkedH = null; }
    if (this.kent) this.hooks.satnav?.(null);
  }

  /** route as a few points for the minimap */
  path(step = 6) {
    const out = [];
    for (let i = this.idx; i < this.route.pts.length; i += step) out.push(this.route.pts[i]);
    return out;
  }
}

function signalled(sig, dir, s0) { return sig.some((x) => x.dir === dir && x.s >= s0); }

// event kinds by what the monitor does with them (Whitmore's lists are as they always were)
const NEAR_WM = ['turn', 'emerge', 'bend', 'rb'];
const NEAR_KENT = ['turn', 'emerge', 'bend', 'rb', 'cross', 'mini', 'merge'];
const MARK_WM = ['turn', 'emerge', 'rb'];
const MARK_KENT = ['turn', 'emerge', 'rb', 'mini'];
const WAIT_WM = ['lights', 'zebra', 'emerge', 'rb'];
const WAIT_KENT = ['lights', 'zebra', 'emerge', 'rb', 'cross', 'mini', 'merge', 'stop', 'pullright', 'turn'];
const MANOEUVRES = ['turn', 'emerge', 'cross', 'mini', 'rb', 'merge', 'diverge', 'laneChange', 'stop', 'pullright'];
const TALK_ANYWAY = ['stop', 'pullright', 'baypark', 'pullup']; // the examiner still asks for these during independent driving
const SATNAV = ['turn', 'emerge', 'cross', 'mini', 'rb', 'merge', 'diverge'];
/** a person touching the car's body (its box, with a hand's width to spare) */
function touching(car, p) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), dx = p.x - car.pos.x, dz = p.z - car.pos.z;
  return Math.abs(dx * fx + dz * fz) < car.model.length / 2 + 0.15 && Math.abs(dx * fz - dz * fx) < car.model.width / 2 + 0.15;
}
/** where a manoeuvre's own signalling is over (moving off after a stop signals for another 15-20 m) */
const endOf = (e) => (e.kind === 'rb' ? e.exitS + 8 : e.kind === 'diverge' ? e.s + 110 : e.kind === 'stop' ? e.s + 30 : e.kind === 'pullright' ? e.stopS + 40 : (e.lineS ?? e.s) + 12);
const FRONT = 2; // m from the middle of the car to its front bumper (a Polo is 4.07 m long)
/**
 * Directions in DVSA's words (DT1 section 14 test wordings): "At the end of the road turn left,
 * please", "Take the next road on the right, please", "At the roundabout turn left please (it is the
 * first exit)", "... follow the road ahead (it is the second exit)", "Pull up on the left at a safe
 * place, please", the angled start and the reverse right. Lane advice stays on the end.
 */
function dt1Text(e, test) {
  const lane = (e.text || '').match(/ Use the [a-z-]+ lane\./)?.[0] || '';
  switch (e.kind) {
    case 'turn': return e.dir === 'none' ? e.text : `Take the next road on the ${e.dir}, please.`;
    case 'emerge': return e.dir === 'none' ? 'At the end of the road, go straight ahead, please.' : `At the end of the road turn ${e.dir}, please.`;
    case 'rb': { const ord = ORDW[e.exit - 1] || `${e.exit}th`; return `At the roundabout ${e.dir === 'left' ? 'turn left please' : e.dir === 'right' ? 'turn right please' : 'follow the road ahead'} (it is the ${ord} exit).${lane}`; }
    case 'stop': return test ? (e.angled ? 'Pull up on the left just before you get to the next parked car, please.' : 'Pull up on the left at a safe place, please.') : e.text;
    case 'pullright': return test ? 'Pull up on the right when it is safe to do so, please.' : e.text;
    case 'baypark': return test ? 'At the end of the road turn left into the test centre car park, please. I would like you to drive forward into a convenient parking bay, either to the left or the right. Finish within one of the bays.' : e.text;
    case 'pullup': return test ? 'Pull up on the left at a safe place, please.' : e.text;
  }
  return e.text;
}
const ORDW = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

/** where each via point falls along a Kent route (arc length), for rerouting from the ones not reached */
function viaPositions(route) {
  return (route.viaXZ || []).map((P) => {
    let best = 0, bd = Infinity;
    for (const q of route.pts) { const d = (q.x - P.x) ** 2 + (q.z - P.z) ** 2; if (d < bd) { bd = d; best = q.s; } }
    return best;
  });
}

/** A soft blue line on the road along the lesson route. */
function guideLine(pts, heightAt = null) {
  const pos = [], idx = [];
  let prevY = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // lie on the road: the ground under this point (and a flyover deck, via prevY), not a fixed height
    const y = (heightAt ? (prevY = heightAt(pts[i].x, pts[i].z, prevY)) : 0) + 0.045;
    pos.push(pts[i].x + dz * 0.18, y, pts[i].z - dx * 0.18, pts[i].x - dz * 0.18, y, pts[i].z + dx * 0.18);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35aee2).multiplyScalar(1.4), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 2;
  return m;
}

// ---------- dev: a careful driver, to prove a clean drive scores zero faults ----------
/**
 * Returns { input, indicator, mirror } for one frame. state is a scratch object kept by the caller.
 * Drives the lane, signals and checks mirrors before every event, stops for red, the zebra,
 * give-way lines and roundabout traffic, and pulls up at the end.
 */
export function carefulDriver(run, car, st, bad = null) {
  const o = run.kent ? carefulKent(run, car, st, bad || {}) : careful(run, car, st, bad || {});
  if (bad?.noSignals) o.indicator = null;
  if (bad?.noMirrors) o.mirror = false;
  // the learner car has a real gearbox: turn "go this fast" into clutch, gears, pedals and the handbrake (pedals.js)
  if (car.drive) o.input = (car.drive.kind === 'manual' ? pedalsManual : pedalsAuto)(run, car, st, o, bad || {});
  return o;
}
function careful(run, car, st, bad) {
  const pts = run.route.pts, s = run.s, v = car.vF, mph = Math.abs(v) * MPH;
  st.t = (st.t || 0) + 1 / 60;
  const out = { input: { up: false, down: false, brake: false, steer: 0, run: false, fastSteer: true }, indicator: null, mirror: false, want: 0 };
  if (!st.ready) {
    // mirrors, signal right, wait a moment, go
    st.ready = st.t > 1.5;
    if (st.t > 0.2 && !st.mirrored) { st.mirrored = true; out.mirror = true; }
    out.indicator = 'right';
    return out;
  }
  const limit = run.world.speedLimitAt(car.pos.x, car.pos.z);
  let want = ((limit - 3) * (bad.speed || 1)) / MPH;
  if (s < 25) out.indicator = 'right';
  for (const e of run.events) {
    const ref = e.kind === 'rb' ? e.entryS : e.s;
    const ahead = ref - s;
    if (['turn', 'emerge', 'rb', 'pullup'].includes(e.kind)) {
      if (ahead < 95 && ahead > 0 && !e.botMirror) { e.botMirror = true; out.mirror = true; }
      const dir = e.kind === 'pullup' ? 'left' : e.dir;
      if (dir && dir !== 'none' && ahead < 70 && ahead > (e.kind === 'pullup' ? -60 : -6)) out.indicator = dir;
    }
    if (['turn', 'emerge', 'bend'].includes(e.kind) && ahead < 30 && ahead > -10) want = Math.min(want, 11 / MPH);
    if (e.kind === 'rb' && ahead < 35 && s < e.entryS + 40) want = Math.min(want, 13 / MPH);
    if (e.kind === 'emerge' && !bad.noStops) {
      const toLine = e.lineS - s;
      if (toLine < 25 && toLine > 0 && !e.botStopped) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
      if (toLine < 3 && mph < 0.5) e.botStopped = true;
      if (e.botStopped && s < e.s + 6) want = Math.min(want, 7 / MPH);
    }
    if (e.kind === 'rb') {
      const toLine = e.entryS + 1.7 - s;
      if (toLine > -0.5 && toLine < 12 && run.rbConflict({ pos: posAtS(run, e.entryS + 1.7) }, 32, e.node)) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
    }
    if (!bad.runReds && ((e.kind === 'lights' && run.world.lights.state !== 'green') || (e.kind === 'zebra' && run.world.zebra.busy))) {
      const toLine = e.s - s;
      if (toLine > -0.5 && toLine < 35) want = Math.min(want, Math.max(0, toLine - 1.5) * 0.6);
    }
    if (e.kind === 'pullup') {
      const toEnd = e.s - 12 - s;
      if (toEnd < 40) want = Math.min(want, Math.max(0, toEnd) * 0.35);
    }
    if (e.kind === 'baypark') {
      const toEnd = e.s - 0.6 - s;
      if (toEnd < 30) want = Math.min(want, Math.max(0, toEnd) * 0.45);
    }
  }
  // keep a safe gap to traffic ahead in my lane
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  for (const c of run.world.traffic?.cars || []) {
    const dx = c.x - car.pos.x, dz = c.z - car.pos.z, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
    if (along > 0 && along < 60 && lat < 2.2) want = Math.min(want, Math.max(0, Math.min(c.v, (along - 10) * 0.5)));
  }
  // emergency stop: brake hard, then mirrors and away
  if (run.estop?.state === 'braking') { out.input.down = car.vF > 0.5; out.input.brake = car.vF <= 0.5; return out; }
  if (run.estop?.state === 'done' && !st.afterStop) { st.afterStop = st.t; }
  if (st.afterStop && st.t - st.afterStop < 1.5) { if (!st.estopMirror) { st.estopMirror = true; out.mirror = true; } out.input.brake = true; return out; }
  // steering: pure pursuit on the lane centre (slightly toward the kerb when pulling up)
  const look = Math.min(pts.length - 1, run.idx + 4 + Math.round(Math.abs(v) / 2.5));
  const p = pts[look];
  const want_h = Math.atan2(p.x - car.pos.x, p.z - car.pos.z);
  let d = want_h - car.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  out.input.steer = THREE.MathUtils.clamp(-d * 2.2, -1, 1);
  if (v < want - 0.4) out.input.up = true;
  else if (v > want + 0.6) out.input.down = true;
  if (want < 0.05 && v < 0.6) { out.input.up = false; out.input.down = false; out.input.brake = true; }
  out.want = want;
  return out;
}
// ---------- the careful driver on the Kent roads ----------
const A_LAT = 2.2;   // m/s2 sideways in bends: an unhurried driver
const BRAKE = 2.2;   // m/s2 to stop at a line
const PLAN = 1.6;    // m/s2 to slow for a bend or a lower limit ahead
/** the speed the careful driver plans for each point: the limit less 3 mph, slower for bends, rings, manoeuvres and the car park */
function speedPlan(run, bad) {
  const pts = run.route.pts, n = pts.length, v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i], lim = p.park ? 6 : p.road?.limit ?? 30;
    let w = ((lim - 3) * (bad.speed || 1)) / MPH;
    if (p.rb) w = Math.min(w, 20 / MPH);
    if (p.man) w = Math.min(w, 14 / MPH);
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(n - 1, i + 2)];
    if (i > 1 && i < n - 2) {
      const h1 = Math.atan2(p.x - a.x, p.z - a.z), h2 = Math.atan2(b.x - p.x, b.z - p.z);
      let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh;
      const k = dh / Math.max(0.5, b.s - a.s);
      if (k > 1e-4) w = Math.min(w, Math.max(2.2, Math.sqrt(A_LAT / k)));
    }
    v[i] = w;
  }
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * PLAN * Math.max(0, pts[i + 1].s - pts[i].s)));
  return v;
}
const stopIn = (d) => Math.sqrt(2 * BRAKE * Math.max(0, d)); // the speed that stops in d metres
/** the speed that keeps a safe gap g (m) behind something going lv m/s */
const followAt = (g, lv) => Math.max(0, Math.min(stopIn(g - 1), lv + Math.max(0, g - 4) * 0.35));

function carefulKent(run, car, st, bad) {
  const pts = run.route.pts, s = run.s, v = car.vF, mph = Math.abs(v) * MPH, dt = 1 / 60, w = run.world;
  const half = car.model.length / 2;
  st.t = (st.t || 0) + dt;
  const out = { input: { up: false, down: false, brake: false, steer: 0, run: false, fastSteer: true }, indicator: null, mirror: false, want: 0 };
  if (st.route !== run.route) { st.route = run.route; st.plan = speedPlan(run, bad); }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const traffic = w.traffic?.cars || [];

  // emergency stop: brake hard, then mirrors and away (as in Whitmore)
  if (run.estop?.state === 'braking') { out.input.down = car.vF > 0.5; out.input.brake = car.vF <= 0.5; return out; }
  // lost (off the route): stop and wait for the new route rather than cut across country to the old one
  if (run.dist > 14) { out.input.down = car.vF > 0.5; out.input.brake = car.vF <= 0.5; return out; }

  // moving off (the start, after a pull-up, an emergency stop or the manoeuvre): mirrors, signal, go
  if (!run.moved) {
    if (run.drill && run.drill !== 'creep') st.off = null; // a drill first: the mirrors and signal come after it
    if (!st.off) st.off = { t: st.t, mirrored: false, s: null };
    const since = st.t - st.off.t;
    if (since > 0.2 && !st.off.mirrored) { st.off.mirrored = true; out.mirror = true; }
    out.indicator = run.afterStop ? null : 'right';
    const behind = traffic.some((c) => { const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz; return al < 0 && al > -45 && Math.abs(dx * fz - dz * fx) < 3.5 && c.v > 2; })
      // pulling out round a parked car (or back across from the right) puts us in the other lane for a moment
      || (run.events.some((e) => (e.kind === 'stop' && e.angled && e.done && Math.abs(e.s - s) < 25) || (e.kind === 'pullright' && e.phase === 'done' && Math.abs(e.stopS - s) < 30))
        && since < 8 // an oncoming car that has stopped to let us out: go
        && traffic.some((c) => { const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz; return al > -5 && al < 70 && c.fx * fx + c.fz * fz < -0.5 && c.v > 3; }));
    if (since < 1.5 || (behind && st.off.s == null)) { out.input.brake = true; steerKent(run, car, out, bad, 0); if (st.debug) st.dbg = { plan: 0, events: since, traffic: behind ? 1 : 0 }; return out; }
    if (st.off.s == null) { st.off.s = s; out.mirror = true; } // one last look as we go
  } else if (st.off) { if (st.off.s == null || s > st.off.s + 15) st.off = null; else out.indicator = run.afterStop ? null : 'right'; }

  const plan = st.plan;
  let want = plan[Math.min(pts.length - 1, run.idx + 1)];
  if (bad.speed) want = Math.max(want, plan[run.idx]); // the over-speeder doesn't plan ahead either
  let reverse = false;

  for (const e of run.events) {
    const ref = e.kind === 'rb' ? e.entryS : e.lineS ?? e.s;
    const ahead = ref - s;
    if (ahead > 260) break;
    // mirrors before every manoeuvre, once
    if (MIRROR_BEFORE.includes(e.kind) && ahead < (e.kind === 'laneChange' ? 15 : e.kind === 'diverge' ? 60 : 95) && ahead > -5 && !e.botMirror) { e.botMirror = true; out.mirror = true; }
    if (e.kind === 'laneChange' && ahead < 1 && ahead > -6 && !e.botMirror2) { e.botMirror2 = true; out.mirror = true; } // and again as the car starts across
    // signals: the window each manoeuvre wants
    const sig = signalFor(e, s);
    if (sig && !out.indicator) out.indicator = sig;
    switch (e.kind) {
      case 'emerge': case 'cross': {
        // creep to the line slow enough to look properly, then wait for a gap
        const toLine = e.lineS - s - half;
        if (e.botStop == null) e.botStop = !!w.net.nodes.get(e.node)?.stop; // a STOP line: always stop
        if (e.botStop && !e.botStopped && toLine < 30 && toLine > -2) { want = Math.min(want, stopIn(toLine - 0.4)); if (toLine < 1.8 && Math.abs(v) < 0.2) e.botStopped = true; if (!e.botStopped) { e.botGo = false; break; } }
        if (toLine < 30 && toLine > -2 && !e.botGo) {
          want = Math.min(want, Math.max(4 / MPH, stopIn(toLine - 0.5) * 0.9), toLine < 12 ? 5 / MPH : Infinity);
          // wait for a gap, and for room on the far side: never stop with the nose out in the main road
          const room = boxClear(run, car, e.lineS, e.lineS + 22);
          if (!bad.noStops && toLine < 14 && (run.majorBusy(e, car, 6, 50) || !room)) want = Math.min(want, stopIn(toLine - 1.2)); // the front a car's nose short of the line
          if (toLine < 1.6 && room && !run.majorBusy(e, car, 6, 50)) e.botGo = true;
          if (bad.noStops) e.botGo = toLine < 0.8;
        }
        if (bad.noStops && toLine < 30 && toLine > -2) want = Math.max(want, 16 / MPH);
        break;
      }
      case 'mini': {
        if (ahead < 25 && ahead > -3) want = Math.min(want, 9 / MPH);
        if (ahead < 12 && ahead > 0 && run.majorBusy(e, car, 4, 30)) want = Math.min(want, stopIn(ahead - half - 1));
        break;
      }
      case 'turn': {
        // turning right across the oncoming lane: wait for a gap before the turn
        if (e.dir === 'right' && ahead < 40 && ahead > -2 && !e.botGo) {
          const busy = oncoming(run, car, e, 6);
          if (busy) want = Math.min(want, stopIn(ahead - 6 - half));
          else if (ahead < 8) e.botGo = true;
        }
        break;
      }
      case 'rb': {
        const toLine = e.entryS - s - half;
        if (toLine < 40 && s < e.entryS + 5) want = Math.min(want, 13 / MPH);
        if (!e.botGo && toLine < 25) {
          // keep looking right until the front is over the line
          const p = posAtS(run, e.entryS + 1.7);
          if (run.rbConflict({ pos: p }, 32, e.rb) || ringEntering(run, e, car)) want = Math.min(want, stopIn(toLine - 2.5)); // the front well short of the ring lane (the approach comes in at a slant)
          else if (toLine < -1) e.botGo = true;
        }
        if (e.exit >= 2 && s > e.signalLeftS - 10 && s < e.exitS && !e.botExitMirror) { e.botExitMirror = true; out.mirror = true; }
        break;
      }
      case 'lights': {
        if (bad.runReds || e.botGo) break;
        const toLine = e.lineS - s - half;
        if (toLine > -0.5 && toLine < 60) {
          if (w.signals.isStop(e.group, car.heading, toLine, Math.max(0, v))) want = Math.min(want, stopIn(toLine - 0.5));
          else if (w.signals.stateFor(e.group, car.heading) !== 'green') e.botGo = true; // amber and too close to stop: keep going
          // and only into the junction if there's room to come out the other side (don't block the box)
          if (!e.crossing && toLine < 25 && !boxClear(run, car, e.lineS, e.lineS + 30)) want = Math.min(want, stopIn(toLine - 0.5));
        }
        break;
      }
      case 'zebra': {
        if (bad.runReds) break;
        const toLine = e.lineS - s - half;
        if (toLine > -0.5 && toLine < 40 && w.trafficSystem.crossingBusy(e.key)) want = Math.min(want, stopIn(toLine - 0.5));
        break;
      }
      case 'merge': {
        // find a gap: if a car on the main road would be alongside where we join, ease off and slot in behind it
        if (ahead < 120 && ahead > -10) want = Math.min(want, mergeGap(run, car, e, want));
        break;
      }
      case 'laneChange': {
        if (ahead < 40 && ahead > -15) want = Math.min(want, laneGap(run, car, e, want));
        break;
      }
      case 'stop': {
        if (!e.done && ahead < 90 && ahead > -20) want = Math.min(want, stopIn(e.s - s));
        break;
      }
      case 'pullright': {
        if (!e.phase && ahead < 90) {
          if (ahead > 0 && ahead < 30 && oncoming(run, car, e, 7, 90)) want = Math.min(want, stopIn(ahead - 2));
          want = Math.min(want, stopIn(e.stopS - s));
        }
        if (e.phase === 'stopped' || e.phase === 'reversing') {
          // look round, then reverse about two car lengths and stop
          if (!e.botRevMirror) { e.botRevMirror = true; out.mirror = true; e.botRevT = st.t; }
          if (!e.botRevDone && s <= e.at - e.reverse + 0.6) e.botRevDone = true;
          if (!e.botRevDone && st.t - e.botRevT > 0.8) reverse = true;
          else want = 0;
        }
        break;
      }
      case 'pullup': if (ahead < 45) want = Math.min(want, Math.max(0, ahead - 12) * 0.35); break;
      case 'baypark': if (e.s - s < 30) want = Math.min(want, stopIn(e.s - 0.25 - s)); break;
    }
  }
  if (reverse) return reverseKent(run, car, out);
  // nose to nose with someone who can't back off (another car behind them): reverse a few metres
  if (st.backOff) {
    if (run.s > st.backOff.to && st.t - st.backOff.t < 4) return reverseKent(run, car, out);
    if (st.t - st.backOff.t < 10) { out.input.brake = true; steerKent(run, car, out, bad, 0); return out; }
    st.backOff = null;
  }
  // traffic and people on my path ahead
  const free = want;
  want = Math.min(want, pathClear(run, car, want));
  st.blockedT = want < 0.3 && Math.abs(v) < 0.3 && free > 2 ? (st.blockedT || 0) + dt : 0;
  if (st.blockedT > 6 && headOn(run, car) && clearBehind(run, car, 8)) { st.blockedT = 0; st.backOff = { to: run.s - 4, t: st.t }; out.mirror = true; }
  // touching a car that can't move (every bump stops it again): back off a car's nose-length if there's room
  else if (car.drive && st.blockedT > 6 && touchingCar(run, car) && clearBehind(run, car, 2.5)) { st.blockedT = 0; st.backOff = { to: run.s - 1.8, t: st.t }; out.mirror = true; }
  if (st.debug) st.dbg = { plan: plan[run.idx], events: free, traffic: want };
  // creeping or moving off: never with a car right across or on my nose (one turning in past the front of me)
  // (the gearbox car only, like the walker look-ahead: the arcade car's runs stay exactly as they were)
  if (car.drive && Math.abs(v) < 1.5 && traffic.some((c) => { const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz; return al > 0 && al < 5.5 && Math.abs(dx * fz - dz * fx) < 2.6; })) want = Math.min(want, 0);
  if (bad.speed && !run.estop) want = Math.max(want, 0);
  steerKent(run, car, out, bad, want);
  if (v < want - 0.4) out.input.up = true;
  else if (v > want + 0.6) out.input.down = true;
  if (want < 0.05 && v < 0.6) { out.input.up = false; out.input.down = false; out.input.brake = true; }
  out.want = want;
  return out;
}
const MIRROR_BEFORE = ['turn', 'emerge', 'cross', 'mini', 'rb', 'merge', 'diverge', 'laneChange', 'stop', 'pullright', 'pullup', 'baypark'];
/** which indicator a manoeuvre wants at arc length s, if any */
function signalFor(e, s) {
  const at = (a, b) => s > a && s < b;
  switch (e.kind) {
    case 'turn': case 'emerge': case 'mini': return e.dir !== 'none' && at(e.s - 70, e.s + 4) ? e.dir : null;
    case 'rb': // Highway Code 186: left for a left turn; right for a right, then left after the exit before yours
      if (e.dir === 'left') return at(e.entryS - 70, e.exitS + 3) ? 'left' : null;
      if (e.dir === 'right' && at(e.entryS - 70, e.signalLeftS)) return 'right';
      return e.exit >= 2 && at(e.signalLeftS + 1, e.exitS + 3) ? 'left' : null;
    case 'merge': return at(e.s - 110, e.s + 15) ? 'right' : null;
    case 'diverge': return at(e.s - 30, e.s + 106) ? 'left' : null;
    case 'laneChange': return at(e.s - 45, e.s + 22) ? e.dir : null;
    case 'stop': return !e.done && at(e.s - 70, e.s + 20) ? 'left' : null;
    case 'pullright': return !e.phase && at(e.s - 60, e.stopS + 20) ? 'right' : null;
    case 'pullup': return at(e.s - 70, e.s + 1) ? 'left' : null;
    case 'baypark': return at(e.entryS - 60, e.entryS + 10) ? 'left' : null;
  }
  return null;
}
/** pure pursuit on the lane path; the wrong-lane driver stays in lane 1 when the path wants another */
function steerKent(run, car, out, bad, want) {
  const pts = run.route.pts, v = Math.abs(car.vF);
  const Ld = 2.6 + 0.32 * Math.max(v, want * 0.5);
  const i = idxAtS(pts, run.s + Ld), p = pts[Math.min(pts.length - 1, Math.max(run.idx + 1, i))];
  let tx = p.x, tz = p.z;
  if (bad.wrongLane && (p.lane || 1) > 1) {
    const q = pts[Math.min(pts.length - 1, Math.max(run.idx + 1, i) + 1)], o = pts[Math.max(0, Math.max(run.idx + 1, i) - 1)];
    if (p.rb) { const rb = run.world.net.roundabouts.get(p.rb), R = Math.hypot(p.x - rb.x, p.z - rb.z), k = (R + (p.lane - 1) * rb.laneW) / R; tx = rb.x + (p.x - rb.x) * k; tz = rb.z + (p.z - rb.z) * k; }
    else { const h = Math.atan2(q.x - o.x, q.z - o.z), lw = run.laneW(p); tx += Math.cos(h) * lw * (p.lane - 1); tz -= Math.sin(h) * lw * (p.lane - 1); }
  }
  const wantH = Math.atan2(tx - car.pos.x, tz - car.pos.z);
  let d = wantH - car.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
  const dist = Math.max(1, Math.hypot(tx - car.pos.x, tz - car.pos.z));
  // curvature to reach the point, as a steering angle, as a fraction of the lock the car has at this speed
  const delta = Math.atan((2 * car.wheelbase * Math.sin(d)) / dist);
  const lock = car.spec.steer * (1 - 0.6 * Math.min(1, v / 70));
  out.input.steer = THREE.MathUtils.clamp(-delta / lock, -1, 1);
}
/** reversing along the path (the pull up on the right): slowly, aiming the back of the car at a point behind */
function reverseKent(run, car, out) {
  const pts = run.route.pts, i = idxAtS(pts, run.s - 4.5), p = pts[Math.max(0, i)];
  const wantH = Math.atan2(car.pos.x - p.x, car.pos.z - p.z); // heading whose back points at p
  let d = wantH - car.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
  out.input.steer = THREE.MathUtils.clamp(d * 2.0, -1, 1);
  if (car.vF > -1.1) out.input.down = true;
  out.reverse = true; out.want = 1.1; // for the learner gearbox: back at about 2.5 mph in R
  return out;
}
/** oncoming traffic (heading towards me) within `secs` s or `r` m of the junction or point */
function oncoming(run, car, e, secs, r = 60) {
  const node = e.node ? run.world.net.nodes.get(e.node) : null, P = node || posAtS(run, e.s);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return (run.world.traffic?.cars || []).some((c) => {
    if (c.fx * fx + c.fz * fz > -0.5 || c.v < 0.5) return false;
    const d = Math.hypot(c.x - P.x, c.z - P.z), toward = (P.x - c.x) * c.fx + (P.z - c.z) * c.fz;
    return toward > -3 && (d < 25 || (d < r + 40 && d / Math.max(c.v, 1) < secs));
  });
}
/** a car about to come onto the ring from the arm before mine (it shouldn't, but it might) */
function ringEntering(run, e, car) {
  const rb = run.world.net.roundabouts.get(e.rb), p = posAtS(run, e.entryS);
  return (run.world.traffic?.cars || []).some((c) => c.v > 1 && !c.lane?.rb && Math.hypot(c.x - p.x, c.z - p.z) < 14 && Math.hypot(c.x - rb.x, c.z - rb.z) < rb.r + 10 && Math.hypot(c.x - car.pos.x, c.z - car.pos.z) > 4);
}
/** joining from a slip road: the speed that has us arrive in a gap, not alongside someone */
function mergeGap(run, car, e, want) {
  const node = run.world.net.nodes.get(e.node); if (!node) return want;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), myT = Math.max(0, e.s - run.s) / Math.max(want, 3);
  let w = want;
  for (const c of run.world.traffic?.cars || []) {
    if (c.fx * fx + c.fz * fz < 0.6 || Math.hypot(c.x - car.pos.x, c.z - car.pos.z) < 2) continue;
    const toNode = (node.x - c.x) * c.fx + (node.z - c.z) * c.fz; if (toNode < -40 || toNode > 180) continue;
    if (Math.hypot(c.x - node.x, c.z - node.z) > 200) continue;
    const t = toNode / Math.max(c.v, 1);
    if (Math.abs(t - myT) < 2.2) w = Math.min(w, Math.max(5, c.v * 0.85)); // let it go by, slot in behind
  }
  return w;
}
/** a lane change: hold back if someone is alongside in the lane we're moving into */
function laneGap(run, car, e, want) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), side = e.dir === 'right' ? -1 : 1;
  for (const c of run.world.traffic?.cars || []) {
    const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (c.fx * fx + c.fz * fz < 0.7) continue;
    if (lat * side > 1.5 && lat * side < 5.5 && al > -20 && al < 8) return Math.min(want, Math.max(3, c.v - 2));
  }
  return want;
}
/** a stopped car facing me close ahead, in my way */
function headOn(run, car) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return (run.world.traffic?.cars || []).some((c) => {
    const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz;
    return al > 0 && al < 10 && Math.abs(dx * fz - dz * fx) < 3 && c.v < 0.3 && c.fx * fx + c.fz * fz < -0.3;
  });
}
/** a traffic car right on my nose (our bodies touching or nearly) */
function touchingCar(run, car) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return (run.world.traffic?.cars || []).some((c) => { const dx = c.x - car.pos.x, dz = c.z - car.pos.z; return dx * fx + dz * fz > 0 && Math.hypot(dx, dz) < (c.L || 4.6) / 2 + car.model.length / 2 + 0.4; });
}
function clearBehind(run, car, d) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return !(run.world.traffic?.cars || []).some((c) => { const dx = c.x - car.pos.x, dz = c.z - car.pos.z, al = dx * fx + dz * fz; return al < 0 && al > -d - 4.5 && Math.abs(dx * fz - dz * fx) < 2.5; });
}
/** no car standing on my path between s0 and s1 going my way (a queue on the far side of a junction I'd be stuck behind) */
function boxClear(run, car, s0, s1) {
  const pts = run.route.pts, i0 = idxAtS(pts, s0), i1 = Math.min(pts.length - 2, idxAtS(pts, s1));
  for (const c of run.world.traffic?.cars || []) {
    if (c.v > 2 || c.held || Math.abs(c.x - car.pos.x) > 70 || Math.abs(c.z - car.pos.z) > 70) continue; // someone waiting at their own line isn't a queue on my exit
    for (let i = i0; i <= i1; i += 2) {
      const p = pts[i], q = pts[i + 1], tl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 2.2 && ((q.x - p.x) * c.fx + (q.z - p.z) * c.fz) / tl > 0.5) return false;
    }
  }
  return true;
}
/**
 * Anything on my path ahead: a car in my lane (follow it), a car or a person across it (stop short).
 * A car counts when its body (its box) comes within half my width and a little of a point on my path,
 * so one waiting at its own give-way line with its nose short of my lane doesn't stop me.
 */
function pathClear(run, car, want) {
  const pts = run.route.pts, s = run.s, n = pts.length, half = car.model.length / 2, myW = car.model.width / 2 + 0.35;
  const look = Math.min(90, 12 + (car.vF * car.vF) / (2 * BRAKE) + 10);
  const i0 = run.idx, i1 = idxAtS(pts, s + look);
  let w = want;
  const test = (x, z, hx, hz, L, W, lv, kind) => {
    for (let i = i0 + 1; i <= i1 && i < n - 1; i++) {
      const p = pts[i], dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > (L / 2 + W / 2 + myW + 0.5) ** 2) continue;
      // distance from the path point to the box (people are a 0.6 m box with no heading)
      const al = Math.max(0, Math.abs(dx * hx + dz * hz) - L / 2), la = Math.max(0, Math.abs(dx * hz - dz * hx) - W / 2);
      const tx = pts[i + 1].x - p.x, tz = pts[i + 1].z - p.z, tl = Math.hypot(tx, tz) || 1, dot = (tx * hx + tz * hz) / tl;
      // oncoming cars are passed with less to spare (a squeeze on a narrow road or a bend), ones ahead with more
      if (Math.hypot(al, la) > myW + (kind === 'ped' ? 0.6 : kind === 'car' && dot < -0.5 ? -0.15 : 0)) continue;
      const same = kind === 'car' && dot > 0.6;
      const g = p.s - s - half - 0.5;
      w = Math.min(w, same ? followAt(g, lv) : stopIn(g - 1.5));
      return;
    }
  };
  for (const c of run.world.traffic?.cars || []) {
    if (Math.abs(c.x - car.pos.x) > look + 5 || Math.abs(c.z - car.pos.z) > look + 5) continue;
    test(c.x, c.z, c.fx, c.fz, c.L || 4.6, c.W || 1.9, c.v, 'car');
  }
  for (const p of run.world.traffic?.peds || []) {
    // anyone crossing, and people walking across the mouth of a side road (they have priority there);
    // not someone standing at the kerb waiting for the lights or a gap
    if (Math.abs(p.x - car.pos.x) > 40 || Math.abs(p.z - car.pos.z) > 40) continue;
    if (p.state === 'wait' && !p.inRoad) continue;
    test(p.x, p.z, 1, 0, 0.6, 0.6, 0, 'ped');
    // and where someone walking will be in a moment (a pavement walker turning across the mouth of a side road)
    // (the learner gearbox only: the arcade car's runs are kept exactly as they were)
    if (car.drive && p.speed > 0.3 && p.heading != null) for (const t of [0.7, 1.4]) test(p.x + Math.sin(p.heading) * p.speed * t, p.z + Math.cos(p.heading) * p.speed * t, 1, 0, 0.6, 0.6, 0, 'ped');
  }
  return w;
}
function posAtS(run, s) {
  const p = run.route.pts.find((q) => q.s >= s) || run.route.pts[run.route.pts.length - 1];
  return { x: p.x, z: p.z };
}
export { LANE };
