// The instructor who teaches. A lesson used to be a guided drive: Sarah gave the directions and the
// fault monitor marked the drive, and the only teaching was a sentence at the start. A learner on the
// Roundabouts lesson was told "turn right, third exit" seven times and never how to do it.
//
// Now, in lessons only (never on a mock or a test, where the examiner stays quiet), for every event
// that is the lesson's skill:
// - a brief: as the direction is given, the routine for this one, step by step (mirrors, signal,
//   position, speed, look), in the words an instructor uses;
// - a live checklist under her words that ticks each step off as the learner does it;
// - a correction the moment something goes wrong, saying what and why (the fault monitor's own
//   marking, reworded for a learner), and a word of praise when one is done cleanly;
// - a debrief by skill at the end: how many were driven, how many cleanly, and step by step how often
//   each part was right, with where it went wrong.
// Events outside the lesson's skill still get the corrections, so a missed mirror check before a turn
// on the Roundabouts lesson is still pointed out, but no brief: the lesson stays on its subject.
import { rowOf, adviceFor } from './dl25.js';

const MPH = 2.23694;
// each lesson's subject: the event kinds that are the skill, and what the debrief calls them
export const SKILLS = {
  moveoff: { focus: ['stop', 'moveoff'], name: 'pull-ups and moving off' },
  clutch: { focus: ['stop', 'moveoff'], name: 'pull-ups and moving off' },
  autocontrols: { focus: ['stop', 'moveoff'], name: 'pull-ups and moving off' },
  gears: { focus: ['rb', 'turn', 'emerge'], name: 'junctions in the right gear' },
  junctions: { focus: ['turn', 'emerge', 'cross', 'mini'], name: 'junctions' },
  roundabouts: { focus: ['rb', 'mini'], name: 'roundabouts' },
  crossings: { focus: ['zebra', 'lights'], name: 'crossings and lights' },
  dual: { focus: ['merge', 'diverge', 'laneChange', 'rb'], name: 'dual carriageway skills' },
  manoeuvres: { focus: ['pullright', 'stop', 'moveoff'], name: 'manoeuvres' },
  park: { focus: [], name: 'parking' },
};

// the steps of each kind of event, in the order they are done
const STEPS = {
  rb: ['mirrors', 'signal', 'lane', 'speed', 'look', 'exit'],
  mini: ['mirrors', 'signal', 'speed', 'look'],
  turn: ['mirrors', 'signal', 'speed', 'position'],
  emerge: ['mirrors', 'signal', 'speed', 'look'],
  cross: ['mirrors', 'signal', 'speed', 'look'],
  zebra: ['speed', 'look'],
  lights: ['speed', 'look'],
  merge: ['mirrors', 'signal', 'speed'],
  diverge: ['lane', 'mirrors', 'signal'],
  laneChange: ['mirrors', 'signal'],
  stop: ['mirrors', 'signal', 'position'],
  pullright: ['mirrors', 'signal', 'look', 'position'],
  moveoff: ['mirrors', 'signal', 'look'],
};
const STEP_NAME = { mirrors: 'Mirrors', signal: 'Signal', lane: 'Lane', speed: 'Speed', look: 'Looking and giving way', exit: 'Signal for your exit', position: 'Position' };

/** which step a fault belongs to (null: not part of this event's routine) */
function stepOf(cat, kind) {
  const c = cat.toLowerCase();
  if (kind === 'rb' && /signal left for your exit|leaving the roundabout/.test(c)) return 'exit';
  if (c.startsWith('mirrors') || /look before you reverse|move off: safety/.test(c)) return 'mirrors';
  if (c.startsWith('signals')) return 'signal';
  if (/lane|wrong lane/.test(c)) return 'lane';
  if (/approach speed|^speed|emerged without slowing|joining too slowly|crossed the give-way line/.test(c)) return 'speed';
  if (/observation|give way|pulled out|pedestrian|traffic lights|stop line/.test(c)) return 'look';
  if (/positioning|kerb|cutting|pull up on the right|two car lengths/.test(c)) return 'position';
  return null;
}

// what to say the moment it goes wrong: what happened, then why (the DL25's own advice as the fallback)
const CORRECT = [
  [/signal left for your exit/i, 'You needed a left signal there, just after the exit before ours, so drivers waiting to come on know you are leaving.'],
  [/signals: necessary \(moving off\)/i, 'Signal right before you pull out, so anyone coming up behind knows you are moving off.'],
  [/signals: necessary \(pulling up\)/i, 'Signal left before you pull up, after a check of your mirrors.'],
  [/signals: necessary \(joining/i, 'Signal right on the slip road so the traffic on the main road can see you are joining.'],
  [/signals: necessary \(leaving/i, 'Signal left in good time before the slip road off.'],
  [/signals: necessary \(changing lanes/i, 'Signal before every lane change, after mirrors and a look over your shoulder.'],
  [/signals: necessary/i, 'You didn\'t signal there. Mirrors first, then signal, before you start to slow down.'],
  [/indicator left on/i, 'Your indicator was still on from the last turn. Cancel it once you are round, or it tells everyone the wrong thing.'],
  [/signals: correctly/i, 'That was the wrong signal for where we were going. Check the direction before you signal.'],
  [/move off: safety/i, 'Before you move off: mirrors, then a look over your right shoulder for the blind spot.'],
  [/mirrors: signalling|mirrors.*pulling up/i, 'Check your mirrors before you signal to pull up.'],
  [/mirrors/i, 'Check your mirrors before you signal or change direction. You need to know what is behind before you do anything.'],
  [/wrong lane for the roundabout/i, 'Wrong lane for that exit. Left lane for left and usually ahead, right lane for exits to the right: pick it early, after mirrors.'],
  [/lane discipline \(on the roundabout/i, 'Stay in your lane all the way round, and only cross into the left lane when you are leaving.'],
  [/lane discipline \(leaving/i, 'Leave the roundabout in the lane you came round in.'],
  [/lane discipline \(late for the slip/i, 'Move into the left lane well before the slip road, not at the last moment.'],
  [/lane discipline/i, 'Keep to the left lane unless you are overtaking.'],
  [/junctions: approach speed/i, 'Too fast on the way in. Brake early and arrive slowly enough to stop if you have to.'],
  [/did not give way to the right/i, 'You didn\'t give way to the car coming from your right. At a roundabout, traffic already on it or coming from the right goes first.'],
  [/emerged without slowing/i, 'You came out without slowing to look. Slow right down, or stop, at the line: look right, left, then right again.'],
  [/pulled out in front of traffic/i, 'You pulled out in front of a car. Wait at the line until there is a gap big enough that nobody has to slow down for you.'],
  [/did not stop at the stop line/i, 'A STOP sign means stop at the line, every time, even if it\'s clear.'],
  [/traffic lights/i, 'That light was red. Stop behind the white line on red, and on amber unless you are too close to stop safely.'],
  [/pedestrian crossings/i, 'Someone was waiting at the zebra. Stop and let people on or waiting at a zebra cross.'],
  [/pedestrian put at risk/i, 'That was far too close to someone on foot. Slow down early wherever people are near the road.'],
  [/speed \(well over/i, 'Much too fast for this road. Ease off now and watch for the speed limit signs.'],
  [/^speed/i, 'You\'re over the speed limit. Check your speedometer, and look for the signs.'],
  [/joining too slowly/i, 'Use the slip road to get up to the speed of the traffic, so you can slot into a gap.'],
  [/stopped on the slip road/i, 'Don\'t stop on the slip road unless you must. Match the speed of the traffic and find a gap.'],
  [/undue hesitation/i, 'It was safe to go there. Plan ahead so that when the gap comes you\'re ready to take it.'],
  [/too far from the kerb/i, 'Pull up closer to the kerb, about a drain\'s width away.'],
  [/hit the kerb|edge line|mounted the pavement|left the carriageway/i, 'You touched the kerb. Look well ahead to where you want to go and the steering follows.'],
  [/normal driving|wrong side/i, 'Keep left: about a metre in from the kerb in normal driving.'],
  [/clearance/i, 'Too close to the parked cars. Leave a door\'s width, and slow down if you can\'t.'],
  [/creep not controlled/i, 'There was traffic, so you needed to stop at the line. In an automatic, hold it on the footbrake: it creeps forward on its own.'],
  [/control: parking brake/i, 'Handbrake on whenever you stop for more than a moment, and off before you move.'],
  [/stalled/i, 'You stalled. Clutch down, neutral, restart, then a little more gas and a slower clutch.'],
  [/did not stop when asked/i, 'I asked you to pull up there. Mirrors, signal left, and stop close to the kerb.'],
  [/look before you reverse/i, 'Look all round before you reverse, and keep looking while you move.'],
  [/reverse about two car lengths/i, 'About two car lengths: use the car behind and the kerb to judge it.'],
  [/keep close to the kerb/i, 'Keep reasonably close to the kerb while you reverse: small steering movements, and slowly.'],
];
const AGAIN = {
  mirrors: ['Mirrors again, please: before every signal and every change of speed or direction.', 'Remember: mirrors first.', 'Mirrors! Make it a habit.'],
  signal: ['A signal there too, please.', 'Signal, please: tell everyone what you are about to do.'],
  lane: ['Watch your lane again there.', 'Wrong lane again: decide early, then hold it.'],
  speed: ['Ease off: watch your speed.', 'Too quick again. Check your speedometer.'],
  look: ['Look, and give way, before you go.'],
  position: ['Watch your position: keep left, about a metre from the kerb.', 'Watch the kerb: look ahead to where you are going.'],
};
const PRAISE = {
  rb: ['Good roundabout.', 'Nicely done: mirrors, signal and speed all right there.', 'Well judged. That is how to take a roundabout.'],
  mini: ['Good. Mini roundabouts work the same as big ones: give way to the right.'],
  turn: ['Good turn.', 'Nice: mirrors, signal, slow, then turn.', 'Well positioned for that turn.'],
  emerge: ['Good: slow at the line and a proper look.', 'Well judged gap.', 'Good emerging.'],
  cross: ['Good: a proper look before you crossed.'],
  zebra: ['Good: you were ready to stop for the crossing.', 'Well read crossing.'],
  lights: ['Good: lights read early.', 'Well handled lights.'],
  merge: ['Good join: up to speed and into a gap.'],
  diverge: ['Good: in the left lane in good time, and a signal off.'],
  laneChange: ['Good lane change: mirrors, shoulder, signal, then over.'],
  stop: ['Good stop: close to the kerb.', 'Nicely pulled up.'],
  pullright: ['Good: that is the pull-up on the right done.'],
  moveoff: ['Good: mirrors and a look before you moved off.'],
};

// once a learner has done one of these cleanly, the instructor fades to a prompt: the steps, no reasons
function prompt(e, want, rbInfo) {
  const sig = want === 'left' ? 'signal left' : want === 'right' ? 'signal right' : 'no signal';
  switch (e.kind) {
    case 'rb': return want === 'left' ? 'Mirrors, signal left, look right.'
      : want === 'right' ? `Mirrors, signal right${rbInfo?.lanes >= 2 ? ', right-hand lane' : ''}, look right, then signal left after the exit before ours.`
      : 'Mirrors, no signal, look right, then signal left after the exit before ours.';
    case 'mini': return `Mirrors, ${sig}, give way to the right.`;
    case 'turn': return `Mirrors, ${sig}, slow to a walking pace${want === 'right' ? ', wait for a gap' : ''}.`;
    case 'emerge': case 'cross': return `Mirrors, ${sig}, slow right down and look both ways.`;
    case 'zebra': return 'Crossing ahead: cover the brake.';
    case 'lights': return 'Lights ahead: be ready to stop.';
    case 'merge': return 'Up to speed, mirrors, shoulder, signal right, into a gap.';
    case 'diverge': return 'Left lane, mirrors, signal left.';
    case 'laneChange': return `Mirrors, shoulder, ${sig}.`;
    case 'stop': return 'Mirrors, signal left, close to the kerb.';
    case 'pullright': return 'Mirrors, signal right, wait for a gap.';
    default: return '';
  }
}

/** the routine for this event, said with the direction */
function brief(e, want, rbInfo) {
  const sig = (d) => (d === 'left' ? 'signal left' : d === 'right' ? 'signal right' : 'no signal on the way in');
  switch (e.kind) {
    case 'rb': {
      const multi = rbInfo?.lanes >= 2;
      if (want === 'left') return `Mirrors, then ${sig('left')}${multi ? ' and keep to the left-hand lane' : ''}. Slow down early and look right as you reach the line: give way to anything coming round from your right. Keep the left signal on as you go round and off.`;
      if (want === 'right') return `Mirrors, then ${sig('right')}${multi ? ' and move into the right-hand lane' : ''}. Slow down and look right at the line: give way to traffic from your right. Keep signalling right as you go round, then once you pass the exit before ours, check your left mirror and signal left.`;
      return `Mirrors, but ${sig('none')}${multi ? '. The left lane is usually right for straight ahead, unless the road markings say otherwise' : ''}. Slow down and look right at the line: give way to traffic from your right. Once you pass the exit before ours, check your left mirror and signal left.`;
    }
    case 'mini': return `A mini roundabout: mirrors, ${sig(want)}, slow right down and give way to anything coming from your right. Go round the painted circle, not over it.`;
    case 'turn': return want === 'right'
      ? 'Mirrors, signal right, then move to just left of the centre line. Brake gently down to a walking pace, and wait for oncoming traffic to clear before you turn. Don\'t cut the corner.'
      : 'Mirrors, signal left, keep about a metre from the kerb, and brake gently down to a walking pace before the turn. Watch for people crossing the side road.';
    case 'emerge': case 'cross': return `Mirrors, ${sig(want)}, then slow right down to the give-way line, or stop if you can't see. Look right, left and right again, and only go when there's a safe gap.`;
    case 'zebra': return 'A zebra crossing ahead. Check your mirrors and cover the brake. If anyone is on it or waiting by it, slow down and stop at the give-way line to let them cross.';
    case 'lights': return 'Traffic lights ahead. Check your mirrors and ease off so you can stop. On red, stop behind the white line; on amber, stop too unless you are so close that stopping would be unsafe.';
    case 'merge': return 'On the slip road: build up your speed to match the traffic. Mirrors, then a look over your right shoulder, signal right, and merge into a gap. Don\'t stop on the slip road unless you must.';
    case 'diverge': return 'Our exit is coming up. Be in the left lane in good time, mirrors, signal left at the countdown markers, and keep your speed up until you are on the slip road.';
    case 'laneChange': return `Mirrors, a quick look over your ${e.dir === 'left' ? 'left' : 'right'} shoulder, ${sig(e.dir)}, then move over smoothly.`;
    case 'stop': return 'Mirrors, signal left, then brake gently and pull up close to the kerb, about a drain\'s width away. Handbrake on once you have stopped.';
    case 'pullright': return 'Mirrors, signal right, and only cross over when there\'s nothing coming towards you. Pull up close to the right-hand kerb.';
    default: return '';
  }
}

export class Coach {
  /**
   * run: the LessonRun. A lesson gets the full teaching. A mock gets hints (`hints`): a short prompt
   * with each direction, the checklist, and a correction when something goes wrong, but no praise and
   * no skill debrief, since it has the examiner's own sheet. The real test never gets a coach.
   */
  constructor(run, { hints = false } = {}) {
    this.run = run;
    this.hints = hints;
    this.skill = hints ? { focus: Object.keys(STEPS), name: 'the test' } : SKILLS[run.def.id] || { focus: [], name: 'today\'s skill' };
    this.focus = new Set(this.skill.focus);
    this.open = [];     // events briefed and not yet finished: { e, want, steps, f0, s0 }
    this.log = [];      // finished focus events: { kind, place, failed: Set(step) }
    this.cool = {};
    this.lastSaid = -99;
    this.praiseN = 0;
  }
  isFocus(kind) { return this.focus.has(kind); }

  /** the direction is being given for e: the routine to go with it, or '' */
  brief(e, want) {
    const run = this.run;
    if (!STEPS[e.kind]) return '';
    const rb = e.kind === 'rb' ? run.world.net?.roundabouts.get(e.rb) : null;
    this.open.push({ e, want, steps: STEPS[e.kind], f0: run.faults.length, s0: run.s, focus: this.isFocus(e.kind) });
    if (!this.isFocus(e.kind)) return '';
    this.lastSaid = run.t;
    // the whole routine the first time, and again after one that went wrong; a prompt once it's going well
    const last = [...this.log].reverse().find((x) => x.kind === e.kind);
    const key = e.kind === 'rb' || e.kind === 'turn' || e.kind === 'emerge' ? `${e.kind}:${want}` : e.kind;
    const full = !this.hints && (!this.briefed?.has(key) || (last && last.failed.size));
    (this.briefed ||= new Set()).add(key);
    if (this.hints) { const p = prompt(e, want, rb); return p ? `Hint: ${p}` : ''; }
    return full ? brief(e, want, rb) : prompt(e, want, rb);
  }
  /** moving off after a stop is a skill of its own on the first lessons (called just before it is marked) */
  movingOff() {
    if (!this.isFocus('moveoff')) return;
    const run = this.run;
    this.open.push({ e: { kind: 'moveoff', s: run.s }, want: 'right', steps: STEPS.moveoff, f0: run.faults.length, s0: run.s, focus: true, tAt: run.t });
  }

  /** a fault was just marked: say what went wrong and why, once in a while for the same thing */
  onFault(f) {
    const run = this.run, key = rowOf(f.cat).row + (stepOf(f.cat, '') || '');
    if ((this.cool[key] ?? -99) > run.t) return;
    this.cool[key] = run.t + 8;
    // the reason the first time; after that a reminder (told the same paragraph five times, a learner stops listening)
    const step = stepOf(f.cat, '') || rowOf(f.cat).row;
    this.told = this.told || {};
    const n = (this.told[step] = (this.told[step] || 0) + 1);
    const hit = CORRECT.find(([re]) => re.test(f.cat));
    const line = n > 1 && AGAIN[step] ? AGAIN[step][(n - 2) % AGAIN[step].length]
      : hit ? hit[1] : (() => { const [why, tip] = adviceFor(f.cat); return [why, tip].filter(Boolean).join(' '); })();
    if (line) this.speak(line);
  }

  /** speak without losing a direction still to come: it stays on screen after the correction */
  speak(text) {
    const run = this.run;
    const pending = run.events.find((e) => e.said && !e.coachDone && run.s < (e.entryS ?? e.lineS ?? e.s) && e.text);
    run.say(text);
    if (pending) run.text = `${text} ${pending.text}`;
    this.lastSaid = run.t;
  }

  /** each frame, after the marking: close finished events, keep the checklist up to date */
  tick(car, mph) {
    const run = this.run, s = run.s;
    for (const o of [...this.open]) {
      const e = o.e, end = e.kind === 'rb' ? e.exitS + 12 : e.kind === 'diverge' ? e.s + 115 : e.kind === 'stop' ? (e.done ? s : Infinity)
        : e.kind === 'pullright' ? (e.phase === 'done' ? s : Infinity) : e.kind === 'moveoff' ? (o.tAt + 4 < run.t ? s : Infinity) : (e.lineS ?? e.s) + 14;
      if (s < end) continue;
      this.open.splice(this.open.indexOf(o), 1);
      e.coachDone = true;
      const failed = new Set(run.faults.slice(o.f0).filter((f) => f.s >= o.s0 - 5).map((f) => stepOf(f.cat, e.kind)).filter((k) => k && o.steps.includes(k)));
      if (!o.focus) continue;
      this.log.push({ kind: e.kind, steps: o.steps, failed, place: run.where({ s: e.entryS ?? e.lineS ?? e.s }) });
      // praise a clean one, when nothing has just been said and nothing is about to be
      const next = run.events.find((q) => !q.said && q.s > s);
      if (!this.hints && !failed.size && run.t - this.lastSaid > 3 && (!next || next.s - s > 90)) {
        const P = PRAISE[e.kind] || ['Good.'];
        this.speak(P[this.praiseN++ % P.length]);
      }
    }
    // the checklist for the focus event coming up (the gearbox tips under it take the line when they have one)
    if (run.coachText) return;
    const o = this.open.find((q) => q.focus && q.e.kind !== 'moveoff');
    if (!o) return;
    const e = o.e, from = Math.max(o.s0 - 5, e.prevEnd ?? -Infinity);
    const mirrors = run.mirror.some((m) => m.s >= from - 40);
    const signal = o.want && o.want !== 'none' ? run.sig.some((x) => x.dir === o.want && x.s >= from) : null;
    const line = e.lineS ?? e.entryS ?? e.s;
    const target = e.kind === 'rb' ? 15 : e.kind === 'turn' ? 12 : e.kind === 'zebra' || e.kind === 'lights' ? 20 : e.kind === 'merge' ? null : 7;
    const items = [];
    if (o.steps.includes('mirrors')) items.push(`${mirrors ? '✓' : '○'} Mirrors (Q)`);
    if (signal != null && o.steps.includes('signal')) items.push(`${signal ? '✓' : '○'} Signal ${o.want} (${o.want === 'left' ? 'Z' : 'X'})`);
    if (o.steps.includes('signal') && o.want === 'none' && e.kind === 'rb') items.push('✓ No signal yet');
    if (target != null && o.steps.includes('speed') && s < line) items.push(`${s > line - 40 && mph <= target ? '✓' : '○'} ${target <= 7 ? 'Slow right down at the line' : `Under ${target} mph`}`);
    if (o.steps.includes('look') && s < line + 2) items.push(`○ ${e.kind === 'rb' || e.kind === 'mini' ? 'Look right, give way' : e.kind === 'zebra' ? 'Anyone at the crossing?' : e.kind === 'lights' ? 'Ready to stop on red' : 'Look right, left, right'}`);
    if (e.kind === 'rb' && o.want !== 'left' && e.exit >= 2 && s > e.entryS) items.push(`${run.sig.some((x) => x.dir === 'left' && x.s >= e.signalLeftS - 6) ? '✓' : '○'} Signal left after the exit before ours`);
    run.coachText = items.join('   ');
  }

  /** the debrief by skill for the result screen: { name, done, clean, steps: [{ name, ok, of }], issues: [text] } */
  summary() {
    if (this.hints || !this.log.length) return null;
    const steps = {};
    for (const x of this.log) for (const k of x.steps) {
      steps[k] = steps[k] || { name: STEP_NAME[k] || k, ok: 0, of: 0 };
      steps[k].of++;
      if (!x.failed.has(k)) steps[k].ok++;
    }
    const issues = this.log.filter((x) => x.failed.size).map((x) => `${x.place || 'On the route'}: ${[...x.failed].map((k) => (STEP_NAME[k] || k).toLowerCase()).join(', ')}`).slice(0, 6);
    return { name: this.skill.name, done: this.log.length, clean: this.log.filter((x) => !x.failed.size).length, steps: Object.values(steps), issues };
  }
}
export const _test = { stepOf, CORRECT, brief, prompt };
export { MPH };
