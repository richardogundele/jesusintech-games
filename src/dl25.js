// The examiner's marking sheet (DL25) for a lesson or test: every fault LessonRun records lands in one
// DL25 row, as driving faults (D, a tally stroke each), serious (S) or dangerous (X). Pass is the real
// rule: no serious or dangerous faults and 15 or fewer driving faults.
//
// DVSA's guide to assessment and marking (DT1 annex 6,
// https://www.gov.uk/guidance/guidance-for-driving-examiners-carrying-out-driving-tests-dt1/annex-6-guide-to-assessment-and-marking)
// says a serious fault is "potentially dangerous or entails a breach of the law", a dangerous fault
// involves actual danger, and that a driving fault can, "by constant repetition, be regarded as
// serious". Examiners use judgement there; we do it conservatively and only on tests: four or more
// driving faults in one box (a sub-box like Control / clutch, or a row with no sub-boxes) turn one of
// them into a serious fault (habitual), and the sheet says so. Faults spread across a row's boxes don't.

// rows in the order the DL25 prints them: [key, label, sub-boxes]
export const DL25_ROWS = [
  ['eyesight', 'Eyesight', []],
  ['showme', 'Show me / tell me', []],
  ['estop', 'Controlled stop', []],
  ['revright', 'Reverse / right', ['control', 'observation']],
  ['revpark', 'Reverse park (road / car park)', ['control', 'observation']],
  ['fwdpark', 'Forward park', ['control', 'observation']],
  ['precautions', 'Precautions', []],
  ['control', 'Control', ['accelerator', 'clutch', 'gears', 'footbrake', 'parking brake', 'steering']],
  ['moveoff', 'Move off', ['safety', 'control']],
  ['mirrors', 'Use of mirrors', ['signalling', 'change direction', 'change speed']],
  ['signals', 'Signals', ['necessary', 'correctly', 'timed']],
  ['clearance', 'Clearance / obstructions', []],
  ['response', 'Response to signs / signals', ['traffic signs', 'road markings', 'traffic lights', 'traffic controllers', 'other road users']],
  ['speed', 'Use of speed', []],
  ['following', 'Following distance', []],
  ['progress', 'Progress', ['appropriate speed', 'undue hesitation']],
  ['junctions', 'Junctions', ['approach speed', 'observation', 'turning right', 'turning left', 'cutting corners']],
  ['judgement', 'Judgement', ['overtaking', 'meeting', 'crossing']],
  ['positioning', 'Positioning', ['normal driving', 'lane discipline']],
  ['pedestrian', 'Pedestrian crossings', []],
  ['stops', 'Position / normal stops', []],
  ['awareness', 'Awareness / planning', []],
  ['ancillary', 'Ancillary controls', []],
];
const LABEL = Object.fromEntries(DL25_ROWS.map(([k, l]) => [k, l]));

/**
 * Which DL25 row (and sub-box) a fault category belongs to. `man` is the run's manoeuvre
 * ('pullright' | 'baypark'), for the "Manoeuvres: ..." faults. Returns { row, sub } (never null:
 * anything unknown goes to awareness / planning, and the unit test greps every category we emit).
 */
export function rowOf(cat, man = null) {
  const c = cat.toLowerCase();
  const r = (row, sub = null) => ({ row, sub });
  if (c.startsWith('eyesight')) return r('eyesight');
  if (c.startsWith('show me/tell me')) return r('showme');
  if (c.startsWith('control: emergency stop')) return r('estop');
  if (c.startsWith('manoeuvres')) {
    const row = /pull up on the right|two car lengths|close to the kerb/.test(c) || man === 'pullright' ? 'revright' : 'fwdpark';
    return r(row, /observation/.test(c) ? 'observation' : 'control');
  }
  if (c.startsWith('move off')) return r('moveoff', /safety/.test(c) ? 'safety' : 'control');
  if (c.startsWith('control: clutch')) return r('control', 'clutch');
  if (c.startsWith('control: gears')) return r('control', 'gears');
  if (c.startsWith('control: parking brake') || c.startsWith('control: rolled back')) return r('control', 'parking brake');
  if (c.startsWith('control: creep')) return r('control', 'footbrake');
  if (c.startsWith('control: steering')) return r('control', 'steering');
  if (c.startsWith('control: collision')) return r('clearance');
  if (c.startsWith('control: pulling up')) return r('stops');
  if (c.startsWith('mirrors')) return r('mirrors', /signalling|pulling up/.test(c) ? 'signalling' : /speed/.test(c) ? 'change speed' : 'change direction');
  if (c.startsWith('signals')) return r('signals', /correctly/.test(c) ? 'correctly' : /timed/.test(c) ? 'timed' : 'necessary');
  if (c.startsWith('response to signals: traffic lights')) return r('response', 'traffic lights');
  if (c.startsWith('response to signs and signals: road markings')) return r('response', 'road markings');
  if (c.startsWith('response to signs')) return r('response', 'traffic signs');
  if (c.startsWith('speed')) return r('speed');
  if (c.startsWith('progress')) return r('progress', /hesitation|stopped on/.test(c) ? 'undue hesitation' : 'appropriate speed');
  if (c.startsWith('junctions: approach speed')) return r('junctions', 'approach speed');
  if (c.startsWith('junctions: observation')) return r('junctions', 'observation');
  if (c.startsWith('junctions: positioning') || c.startsWith('junctions: late lane')) return r('positioning', 'lane discipline');
  if (c.startsWith('positioning: too far from the kerb')) return r('stops');
  if (c.startsWith('positioning: lane discipline')) return r('positioning', 'lane discipline');
  if (c.startsWith('positioning')) return r('positioning', 'normal driving');
  if (c.startsWith('pedestrian crossings')) return r('pedestrian');
  if (c.startsWith('pedestrian put at risk')) return r('awareness');
  return r('awareness');
}

const SEVS = ['minor', 'serious', 'dangerous'];
/**
 * The sheet: { rows: [{ key, label, d, s, x, subs: {sub: n} }], total, serious, dangerous, passed,
 * habitual: [row labels made serious by repetition] }. test = a driving test (repetition rule applies).
 */
export function scoreSheet(faults, { test = false, man = null } = {}) {
  const rows = new Map(DL25_ROWS.map(([key, label, subs]) => [key, { key, label, subBoxes: subs, d: 0, s: 0, x: 0, subs: {}, boxD: {}, faults: [] }]));
  for (const f of faults) {
    const { row, sub } = rowOf(f.cat, man), R = rows.get(row);
    R.faults.push(f);
    if (sub) R.subs[sub] = (R.subs[sub] || 0) + 1;
    if (f.sev === 'minor') { R.d++; R.boxD[sub || ''] = (R.boxD[sub || ''] || 0) + 1; } else if (f.sev === 'serious') R.s++; else R.x++;
  }
  const habitual = [];
  if (test) for (const R of rows.values()) {
    const box = Object.entries(R.boxD).find(([, n]) => n >= 4);
    if (box && !R.s && !R.x) { R.s = 1; R.habitual = true; habitual.push(box[0] ? `${R.label} (${box[0]})` : R.label); }
  }
  const list = [...rows.values()];
  const total = list.reduce((a, R) => a + R.d, 0), serious = list.reduce((a, R) => a + R.s, 0), dangerous = list.reduce((a, R) => a + R.x, 0);
  return { rows: list, total, serious, dangerous, passed: total <= 15 && !serious && !dangerous, habitual };
}

// why each row matters and how to practise it, with the lesson to book (lesson ids from lessons.js)
const ADVICE = {
  eyesight: ['You must be able to read a number plate from 20 metres.', 'Get your eyes tested; wear your glasses or lenses for every drive.', null],
  showme: ['Knowing your car keeps it safe to drive.', "Learn the official show me / tell me answers: it's an easy driving fault to avoid.", null],
  estop: ['Stopping quickly and under control can save a life.', 'Practise braking firmly and progressively on a quiet road, both hands on the wheel.', 'manoeuvres'],
  revright: ['Reversing on the wrong side of the road puts you against oncoming traffic.', 'Look all round before and while you reverse, keep it slow, and stay close to the kerb.', 'manoeuvres'],
  revpark: ['Parking needs slow control and all-round observation.', 'Slow it right down and look round before and during the manoeuvre.', 'manoeuvres'],
  fwdpark: ['Car parks are full of people walking between cars.', 'Creep in slowly, look all round, and finish straight inside the lines.', 'manoeuvres'],
  precautions: ['The car must be safe before you start the engine.', 'Handbrake on and neutral (or P) before you start up.', null],
  control: ['Smooth control of the pedals, gears and steering keeps the car where you want it.', 'Practise moving off and stopping on a quiet road until the clutch, gears and handbrake are automatic.', 'clutch'],
  moveoff: ['Pulling out without looking or under poor control is a common cause of crashes.', 'Mirrors, signal if it helps, a blind-spot look over your right shoulder, then move off smoothly.', 'moveoff'],
  mirrors: ['Others need you to know where they are before you signal, turn or slow down.', 'Mirrors in good time before every signal, change of direction and change of speed (MSPSL).', 'junctions'],
  signals: ['Signals tell other road users what you are going to do, in good time.', 'Signal for every turn, roundabout exit and lane change, and cancel it afterwards.', 'roundabouts'],
  clearance: ['Hitting something, or passing too close, is dangerous to everyone.', 'Leave at least a door\'s width when passing parked cars; slow down where it is tight.', 'junctions'],
  response: ['Signs and lights are the law: ignoring them is a serious fault.', 'Scan for signs and signals early and act on every one: limits, lights, STOP lines, no entry.', 'crossings'],
  speed: ['Speed limits are a maximum, and the law.', 'Watch the repeater signs and check your speedometer after every change of limit.', 'dual'],
  following: ['A two-second gap gives you time to stop.', 'Use the two-second rule; double it in the wet.', 'dual'],
  progress: ['Driving too slowly or hesitating holds others up and can cause risky overtakes.', 'Drive at a speed that suits the road and go when it is safe: plan ahead so you are ready.', 'dual'],
  junctions: ['Most crashes happen at junctions.', 'Approach slowly, look both ways (twice), and only go when there is a safe gap.', 'junctions'],
  judgement: ['Misjudging others when meeting or crossing them leads to conflict.', 'Hold back where the road narrows and wait for a safe gap before turning right.', 'junctions'],
  positioning: ['Your position on the road shows others what you will do.', 'Keep left in normal driving and pick the right lane early for roundabouts and turns.', 'roundabouts'],
  pedestrian: ['People on or waiting at a crossing have priority.', 'Look for people at zebras and lights well ahead, and stop for them.', 'crossings'],
  stops: ['A safe stop is close to the kerb and out of the way.', 'Pull up parallel and close to the kerb, never across a driveway or junction.', 'moveoff'],
  awareness: ['Planning ahead keeps you out of trouble with people and other traffic.', 'Look well ahead, read what others will do, and slow down early near people.', 'crossings'],
  ancillary: ['Lights, wipers and demisters must work when you need them.', 'Know where every switch is without looking down.', null],
};

/**
 * The examiner's debrief and "what to improve": { verdict, spoken, main, improve: [{ row, where, why,
 * tip, lesson }] }. where(f) names the place a fault happened ("Greenhill roundabout").
 */
export function debrief(sheet, { where = () => '', mock = true, trans = 'manual', lessonTitle = (id) => id } = {}) {
  const bad = sheet.rows.filter((R) => R.d || R.s || R.x).sort((a, b) => (b.x - a.x) || (b.s - a.s) || (b.d - a.d));
  const improve = bad.map((R) => {
    const [why, tip, lesson0] = ADVICE[R.key] || ['', '', null];
    const lesson = R.key === 'control' && trans === 'auto' ? 'autocontrols' : R.key === 'control' && R.subs.gears ? 'gears' : lesson0;
    const places = [...new Set(R.faults.map((f) => { const w = where(f); const what = f.cat.replace(/^[^:(]*: ?/, '').replace(/^\((.*)\)$/, '$1'); return `${w || 'on the route'}: ${what || f.cat}${f.sev !== 'minor' ? ` (${f.sev})` : ''}`; }))].slice(0, 4);
    return { row: R.label, key: R.key, d: R.d, s: R.s, x: R.x, habitual: !!R.habitual, where: places, why, tip, lesson, lessonTitle: lesson ? lessonTitle(lesson) : null };
  });
  const main = improve[0];
  const mainText = main ? `${main.row.toLowerCase()}${main.where[0] ? `, at ${main.where[0].split(':')[0]}` : ''}` : '';
  // DT1 section 14 test wordings for the result
  const verdict = mock
    ? (sheet.passed ? "That's the end of the test and I'm pleased to say you've passed." : "That's the end of the test and I'm sorry you haven't passed. To help you I'll explain why.")
    : (sheet.passed ? 'Lovely. That was a good drive.' : "That's the end of the lesson. We've got a few things to work on.");
  let spoken = verdict;
  if (mock && !sheet.passed) {
    const sx = improve.filter((i) => i.s || i.x);
    spoken += sx.length ? ` The main issue was ${sx[0].row.toLowerCase()}${sx[0].where[0] ? `, ${sx[0].where[0].split(':')[0]}` : ''}: that was marked as a ${sx[0].x ? 'dangerous' : 'serious'} fault.` : ` You had ${sheet.total} driving faults; the limit is 15.`;
  } else if (mock && sheet.passed && main) spoken += ` You had ${sheet.total} driving fault${sheet.total === 1 ? '' : 's'}. Now that you'll be driving on your own, I'd like you to be aware of ${main.row.toLowerCase()}.`;
  return { verdict, spoken, main: mainText, improve };
}
