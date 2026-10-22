import { formatMoney, shortMoney } from './state.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** show an element (fading in), optionally with new html; a change of content replays the fade */
function reveal(el, html) {
  if (html !== undefined && el._html !== html) {
    el.innerHTML = html;
    el._html = html;
    if (el._shown) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  }
  if (el._shown) return;
  el._shown = true;
  clearTimeout(el._fadeT);
  el.classList.remove('leaving', 'hidden');
}
/** hide an element with a short fade out */
function conceal(el) {
  if (!el._shown) return;
  el._shown = false;
  clearTimeout(el._fadeT);
  if (reduceMotion()) { el.classList.add('hidden'); return; }
  el.classList.add('leaving');
  el._fadeT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('leaving'); }, 160);
}

// ---------- contextual hints: what to press, only when it matters, fewer as you learn ----------
// max = how many times (ever) the hint is shown; counts live in localStorage
const HINTS = {
  foot: { max: 3, ms: 7000, html: `${k('W', 'A', 'S', 'D')} to walk · ${k('Shift')} to run · ${k('P')} for your phone` },
  drive: { max: 4, ms: 5000, html: `${k('W')} to drive · ${k('E')} to get out` },
  learner: { max: 3, ms: 5000, html: `${k('H')} for every control · ${k('E')} to get out` },
  engine: { max: 5, html: `${k('I')} starts the engine` },
  stalled: { max: 6, html: `Clutch down, ${k('0')}, then ${k('I')}` },
  pbrake: { max: 6, linger: 3000, html: `${k('Space')} releases the handbrake` },
  // the first time in a manual: the move-off, each step moved on by doing it...
  m0: { html: `Hold ${k('Shift')} for the clutch` },
  m1: { html: `Press ${k('1')} for first gear` },
  m2: { html: `Ease off ${k('Shift')} while pressing ${k('W')}` },
  // the first time in an automatic
  a0: { html: `Press ${k('1')} for Drive` },
  // ...then, once rolling, the two things nobody can guess and the one thing that explains the game.
  // Shared by both gearboxes. 'look' clears when you press Q, the others on a timer.
  look: { html: `${k('Q')} checks your mirrors — do it before you signal or slow down` },
  ind: { html: `${k('Z')} and ${k('X')} are your indicators · ${k('Q')} first, then signal` },
  exam: { html: `The <b>L</b> top-left is your examiner: every fault counts · ${k('E')} to get out for your report` },
};
const ROLLING = ['look', 'ind', 'exam']; // the post-move-off steps, in order
const CONDITIONS = ['stalled', 'engine', 'pbrake'];
const STORE = 'dreamlife.hud.v1';
const H_TIP_SESSIONS = 3;

// ---------- the controls card (H) ----------
const GROUPS = {
  foot: ['On foot', [[k('W', 'A', 'S', 'D'), 'Walk'], [k('Shift'), 'Run'], [k('E'), 'Get in a car · interact']]],
  drive: ['Driving', [[k('W'), 'Accelerate'], [k('S'), 'Brake · reverse'], [k('A', 'D'), 'Steer'], [k('Space'), 'Handbrake'], [k('C'), 'Camera'], [k('E'), 'Get out']]],
  manual: ['Gearbox <small>· manual</small>', [[k('Shift'), 'Clutch (hold)'], [`${k('1')}–${k('5')}`, 'Gears'], [k('R'), 'Reverse'], [k('0'), 'Neutral'], [k('I'), 'Engine on · off'], [k('Space'), 'Parking brake on · off']]],
  auto: ['Gearbox <small>· automatic</small>', [[k('1'), 'Drive'], [k('R'), 'Reverse'], [k('0'), 'Neutral'], [k('9'), 'Park'], [k('I'), 'Engine on · off'], [k('Space'), 'Parking brake on · off']]],
  lesson: ['Lessons', [[k('Z'), 'Left indicator'], [k('X'), 'Right indicator'], [k('Q'), 'Check your mirrors']]],
  game: ['Game', [[k('P'), 'Phone'], [k('M'), 'Sound on · off'], [k('N'), 'Next song'], [k('F'), 'Radio (in a car)'], [k('H'), 'These controls']]],
};

// sat nav arrows (stroked, currentColor)
const ARROWS = {
  ahead: '<svg viewBox="0 0 32 32"><path d="M16 27V6M8 13l8-8 8 8"/></svg>',
  left: '<svg viewBox="0 0 32 32"><path d="M21 27V15a4 4 0 0 0-4-4H7M12 5l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 32 32"><path d="M11 27V15a4 4 0 0 1 4-4h10M20 5l6 6-6 6"/></svg>',
  merge: '<svg viewBox="0 0 32 32"><path d="M10 27v-7l12-12M14 7h9v9"/></svg>',
  signs: '<svg viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="13" rx="2"/><path d="M16 18v9M10 11.5h9M16 8.5l3 3-3 3"/></svg>',
};
// warning icons
const ICON = {
  alert: '<svg viewBox="0 0 16 16"><path d="M8 2.2L14.6 13.6H1.4z"/><path d="M8 6.6v3.2M8 11.8v.1"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3.5 8.5L8 13l4.5-4.5"/></svg>',
  brake: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.6"/><path d="M2.4 3.8a7 7 0 0 0 0 8.4M13.6 3.8a7 7 0 0 1 0 8.4"/></svg>',
};

export class Hud {
  constructor() {
    this.el = $('hud');
    this.city = $('loc-city');
    this.place = $('loc-place');
    this.addr = $('loc-addr');
    this.money = $('money');
    this.prompt = $('prompt');
    this.hintEl = $('hint');
    this.toastEl = $('toast');
    this.speed = $('speed');
    this.carName = $('car-name');
    this.speedo = $('speedo');
    this.goalsEl = $('goals');
    this.trialEl = $('trial');
    this.rewardEl = $('reward');
    this.rewardQ = [];
    this.unitEl = $('speed-unit');
    this.limitEl = $('limit');
    this.lessonEl = $('lesson');
    this.satnavEl = $('satnav');
    this.indEl = $('indicators');
    this.mirrorEl = $('mirror');
    this.tipEl = $('ctl-tip');
    this.controlsEl = $('controls');
    this.controlsBody = $('controls-body');
    this.dockEl = $('controldock');
    this.dockKey = null;
    this.examEl = $('exam');
    this.dt = { el: $('dtrain'), badge: $('dt-badge'), pb: $('dt-pb'), gear: $('dt-gear'), revBox: $('dt-rev'), rev: $('dt-rev').firstElementChild, clutch: $('dt-clutch'), clutchBar: $('dt-clutch').querySelector('i'), warn: $('dt-warn') };
    this.mapCanvas = $('minimap');
    this.map = this.mapCanvas.getContext('2d');
    this.mapS = 0;
    window.addEventListener('resize', () => { this.mapS = 0; });
    this.last = {};
    this.toastTimer = null;
    this.mode = 'menu';
    this.inLesson = false;
    this.coachOn = false;
    // remembered across sessions: hint counts, onboarding steps, sessions played, whether H has been found
    this.ui = this.load();
    this.ui.n = this.ui.n || {};
    this.ui.onboard = this.ui.onboard || {};
    this.ui.sessions = this.ui.sessions || 0;
    this.sessionCounted = false;
    this.ep = {}; // condition hint episodes
    this.evt = null; // the current event hint { id, at, until }
    this.hintId = null;
    this.footShown = false;
    this.hCar = undefined;
    // hooks main.js sets
    this.onGoals = null;
    this.onControlsClose = null;
    this.goalsEl.addEventListener('click', () => { this.goalsEl.blur(); this.onGoals?.(); });
    $('controls-close').addEventListener('click', (e) => { e.currentTarget.blur(); this.onControlsClose?.(); });
    this.controlsEl.addEventListener('click', (e) => { if (e.target === this.controlsEl) this.onControlsClose?.(); });
  }

  load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } }
  persist() { try { localStorage.setItem(STORE, JSON.stringify(this.ui)); } catch { /* private mode: hints just repeat */ } }

  show(v) {
    this.el.classList.toggle('hidden', !v);
    if (v && !this.sessionCounted) { this.sessionCounted = true; this.ui.sessions += 1; this.persist(); }
  }

  set(key, el, value, prop = 'textContent') {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el[prop] = value;
  }
  /** toggle a class only when it changes (the state lives on the element) */
  flag(el, cls, on) {
    const id = `_c_${cls}`;
    if (el[id] === on) return;
    el[id] = on;
    el.classList.toggle(cls, on);
  }

  update({ world, x, z, car, balance, prompt, mode, gas = false, trans = 'manual', mirror = false }) {
    this.mode = mode;
    this.renderDock({ car, mode, trans });
    this.set('city', this.city, world.name);
    // the street, and under it the real postal address of the building you are beside, straight
    // from OpenStreetMap: "157 Colindeep Lane, NW9 6DB"
    this.set('place', this.place, world.place(x, z));
    const addr = world.addressAt ? world.addressAt(x, z) : null;
    this.set('addr', this.addr, addr && addr.text ? addr.text : '');
    this.flag(this.addr, 'hidden', !(addr && addr.text));
    this.set('money', this.money, formatMoney(balance));
    if (prompt) reveal(this.prompt, prompt); else conceal(this.prompt);
    this.flag(this.speedo, 'hidden', !car);
    if (car) {
      const mph = world.units === 'mph';
      this.set('speed', this.speed, String(Math.round(mph ? car.speedKmh / 1.609344 : car.speedKmh)));
      this.set('unit', this.unitEl, mph ? 'mph' : 'km/h');
      this.set('car', this.carName, car.drive ? '' : car.spec?.model || car.name); // the model alone fits the caption
    }
    this.hints({ mode, car, gas, mirror });
    // the H tip: bottom left, the first few sessions, until H has been used
    const tip = (mode === 'foot' || mode === 'car') && !this.ui.hUsed && this.ui.sessions <= H_TIP_SESSIONS;
    if (tip) reveal(this.tipEl); else conceal(this.tipEl);
  }

  // ---------- hints ----------
  /** spend one showing of a hint; false once it has been shown its max times */
  spend(id) {
    const max = HINTS[id].max;
    if (max == null) return true;
    const n = this.ui.n[id] || 0;
    if (n >= max) return false;
    this.ui.n[id] = n + 1;
    this.persist();
    return true;
  }
  event(id) { this.evt = { id, at: performance.now(), until: 0 }; }

  hints({ mode, car, gas, mirror = false }) {
    const now = performance.now();
    // getting in or out of a car, and the first walk of the session, queue an event hint
    if (car !== this.hCar) {
      this.hCar = car;
      this.evt = null;
      this.rollT = 0;
      if (car && mode === 'car') {
        const d = car.drive;
        if (!d) this.event('drive');
        else if ((this.ui.onboard[d.kind] || 0) >= (d.kind === 'manual' ? 3 : 1) && (this.ui.onboard.roll || 0) >= ROLLING.length) this.event('learner');
      }
    }
    if (mode === 'foot' && !car && !this.footShown) { this.footShown = true; this.event('foot'); }

    let want = null;
    const d = mode === 'car' ? car?.drive : null;
    const quietForCoach = this.coachOn; // in a lesson the instructor's coaching line says it already
    // situations in the learner car: stalled, engine off, trying to drive with the handbrake on
    const cond = {};
    if (d) {
      const manual = d.kind === 'manual';
      const inGear = manual ? d.gear !== 'N' : d.gear === 'D' || d.gear === 'R';
      cond.stalled = manual && d.stalled && !d.engineOn && d.crank <= 0;
      cond.engine = !d.engineOn && !d.stalled && d.crank <= 0;
      cond.pbrake = d.parkingBrake && d.engineOn && inGear && (gas || d.throttle > 0.2);
    }
    for (const id of CONDITIONS) {
      const e = this.ep[id] || (this.ep[id] = { on: false, live: false, off: -1e9, lastOn: -1e9 });
      const c = !!cond[id] && !quietForCoach; // quiet while the instructor coaches: no episode, no count
      if (c && !e.on) { e.on = true; e.live = now - e.off > 4000 ? this.spend(id) : e.live; } // a new episode counts once
      if (!c && e.on) { e.on = false; e.off = now; }
      if (c) e.lastOn = now;
      if (!want && e.live && d && (c || (!quietForCoach && now - e.lastOn < (HINTS[id].linger || 0)))) want = id;
    }
    // onboarding: the first time in each gearbox, moved on by doing each step (it advances in lessons too, but
    // only shows outside them: lessons have the instructor, tests should be quiet)
    if (d && d.engineOn && !d.stalled) {
      const ob = this.ui.onboard;
      let step = ob[d.kind] || 0;
      const before = step;
      if (d.kind === 'manual') {
        if (step === 0 && d.pedal >= 0.8) step = 1;
        if (step === 1 && d.gear === 1) step = 2;
        if (step === 2 && car.vF > 0.9) step = 3;
        if (car.vF > 3) step = 3; // already driving: they know
        if (!want && !this.inLesson && step < 3) want = `m${step}`;
      } else {
        if (step === 0 && (d.gear === 'D' || car.vF > 1)) step = 1;
        if (!want && !this.inLesson && step < 1) want = 'a0';
      }
      if (step !== before) { ob[d.kind] = step; this.persist(); }
      // the guided first drive continues once you are rolling: mirrors, indicators, the examiner.
      // Each shows for a while and moves on; the mirrors one also clears the moment you press Q.
      const movedOff = d.kind === 'manual' ? step >= 3 : step >= 1;
      let roll = ob.roll || 0;
      if (movedOff && roll < ROLLING.length && !this.inLesson && car.vF > 1.5) {
        this.rollT = (this.rollT || 0) + 1 / 60;
        const id = ROLLING[roll];
        const done = (id === 'look' && mirror) || this.rollT > (id === 'exam' ? 9 : 7);
        if (done) { roll++; ob.roll = roll; this.rollT = 0; this.persist(); }
        else if (!want) want = id;
      }
    }
    // event hints (getting in, the first walk): shown once for a few seconds if nothing more urgent
    const ev = this.evt;
    if (ev) {
      if (!ev.until && !want && !this.inLesson) { // never in a lesson or test ("E to get out" would end it)
        if (now - ev.at > 6000 || !this.spend(ev.id)) this.evt = null;
        else ev.until = now + HINTS[ev.id].ms;
      }
      if (this.evt && ev.until) { if (now > ev.until) this.evt = null; else if (!want) want = ev.id; }
    }
    if (mode !== 'foot' && mode !== 'car') want = null;
    if (want !== this.hintId) {
      this.hintId = want;
      if (want) reveal(this.hintEl, HINTS[want].html); else conceal(this.hintEl);
    }
  }

  // ---------- today's goals: a chip that opens the phone ----------
  goals(goals) {
    const n = goals.length, done = goals.filter((g) => g.done).length, all = n > 0 && done === n;
    const html = `<span class="ring" style="--p:${n ? done / n : 0}">${all ? '✓' : ''}</span>${all ? 'All goals done today' : `${done}/${n} goals today`}`;
    this.set('goals', this.goalsEl, html, 'innerHTML');
    this.flag(this.goalsEl, 'all', all);
  }

  /** UK speed-limit roundel (null hides it) */
  limit(n, nsl = false) {
    this.flag(this.limitEl, 'hidden', !n);
    this.flag(this.limitEl, 'nsl', !!nsl);
    if (n) this.set('limit', this.limitEl, nsl ? '' : String(n));
  }

  /** the instructor: { title, text, coach, faults: {minor, serious, dangerous}, mock } or null */
  lesson(info) {
    this.inLesson = !!info;
    this.coachOn = !!info?.coach;
    this.flag(this.goalsEl, 'hidden', !!info); // keep the screen clear while the instructor talks
    if (!info) { conceal(this.lessonEl); return; }
    const f = info.faults || {};
    const parts = [];
    if (!info.mock) { // tests are marked quietly
      if (f.minor) parts.push(`<span class="ok">${f.minor} minor${f.minor === 1 ? '' : 's'}</span>`);
      if (f.serious) parts.push(`<span class="bad">${f.serious} serious</span>`);
      if (f.dangerous) parts.push(`<span class="bad">${f.dangerous} dangerous</span>`);
    }
    this.set('l-title', this.lessonEl.querySelector('.l-title'), `${esc(info.title || '')}${parts.length ? ` · ${parts.join(' · ')}` : ''}`, 'innerHTML');
    this.set('l-text', this.lessonEl.querySelector('.l-text'), info.text || '');
    const coach = this.lessonEl.querySelector('.l-coach');
    this.set('l-coach', coach, info.coach || '');
    this.flag(coach, 'hidden', !info.coach);
    reveal(this.lessonEl);
  }

  /**
   * sat nav card for independent driving: { arrow: 'left'|'right'|'ahead'|'rb'|'merge'|'signs', exit, yards,
   * road, lanes, text } or null. A roundabout shows its exit number in a ring.
   */
  satnav(info) {
    const el = this.satnavEl; if (!el) return;
    if (!info) { this.last.satnav = null; conceal(el); return; }
    const arrow = info.arrow === 'rb' ? `<span class="rb">${info.exit ?? ''}</span>` : ARROWS[info.arrow] || ARROWS.ahead;
    const dist = info.yards == null ? 'Signs' : info.yards >= 1000 ? `${(info.yards / 1760).toFixed(1)} mi` : `${info.yards} yd`;
    const what = info.text ? info.text.charAt(0).toUpperCase() + info.text.slice(1) : '';
    const sub = info.yards == null ? what : info.road || what;
    const html = `<div class="sn-arrow">${arrow}</div><div class="sn-body"><div class="sn-dist">${dist}</div>${sub ? `<div class="sn-road">${esc(sub)}</div>` : ''}${info.lanes ? `<div class="sn-lane">${esc(info.lanes)}</div>` : ''}</div>`;
    if (this.last.satnav !== html) { this.last.satnav = html; el.innerHTML = html; }
    reveal(el);
  }

  /** indicators: dir = 'left' | 'right' | null, lit = blink phase; show = in a UK car. Only drawn while one blinks */
  indicators(show, dir, lit) {
    const key = `${show}${dir}${lit}`;
    if (this.last.ind === key) return;
    this.last.ind = key;
    const on = !!(show && dir);
    this.indEl.classList.toggle('hidden', !on);
    const [l, r] = this.indEl.children;
    l.classList.toggle('show', on && dir === 'left');
    r.classList.toggle('show', on && dir === 'right');
    l.classList.toggle('on', on && dir === 'left' && !!lit);
    r.classList.toggle('on', on && dir === 'right' && !!lit);
  }

  /** the learner car's dashboard (null hides it): gear, rev line, clutch, parking brake, one warning */
  drivetrain(car) {
    const D = this.dt, d = car?.drive;
    this.flag(this.speedo, 'learner', !!d);
    this.flag(D.el, 'hidden', !d);
    if (!d) {
      this.flag(D.revBox, 'hidden', true);
      this.flag(D.clutch, 'hidden', true);
      this.flag(D.pb, 'hidden', true);
      this.flag(this.speedo, 'eng-off', false);
      this.set('dt-badge', D.badge, '');
      this.warn(null);
      return;
    }
    const manual = d.kind === 'manual';
    // gear: one pill in a manual, P R N D in an automatic
    const gear = manual ? (d.gear === 'N' ? 'N' : String(d.gear))
      : ['P', 'R', 'N', 'D'].map((g) => `<i class="${d.gear === g ? 'on' : ''}">${g}</i>`).join('');
    this.set('dt-gear', D.gear, gear, 'innerHTML');
    this.flag(D.gear, 'auto', !manual);
    // a quick flash when the gear changes, so a shift feels tactile
    if (this.last.gear !== undefined && this.last.gear !== d.gear) { D.gear.classList.remove('shift'); void D.gear.offsetWidth; D.gear.classList.add('shift'); }
    this.last.gear = d.gear;
    // engine state lives in the caption under the speed
    const off = !d.engineOn;
    this.flag(this.speedo, 'eng-off', off);
    this.set('dt-badge', D.badge, d.crank > 0 ? 'Starting…' : off ? 'Engine off' : manual ? 'Manual' : 'Auto');
    this.flag(D.pb, 'hidden', !d.parkingBrake);
    // the rev line (manual only)
    this.flag(D.revBox, 'hidden', !manual);
    if (manual) {
      const w = `${Math.min(100, (d.rpm / 7000) * 100).toFixed(1)}%`;
      if (this.last.rev !== w) { this.last.rev = w; D.rev.style.width = w; }
      // the rev fill greens in the change-up band and reds at over-rev: a quiet shift cue for learners
      const ready = d.gear !== 'N' && d.gear !== 5 && d.rpm > 4300 && d.rpm <= 5800;
      this.flag(D.rev, 'red', d.rpm > 5800);
      this.flag(D.rev, 'ready', ready);
    }
    // the clutch, only while it isn't fully up
    const showClutch = manual && d.pedal > 0.02;
    this.flag(D.clutch, 'hidden', !showClutch);
    if (showClutch) {
      const w = `${(d.pedal * 100).toFixed(0)}%`;
      if (this.last.clutch !== w) { this.last.clutch = w; D.clutchBar.style.width = w; }
      this.flag(D.clutch, 'bite', d.pedal > 0.35 && d.pedal < 0.6);
    }
    // one warning at a time, by priority
    const inGear = manual ? d.gear !== 'N' : d.gear === 'D' || d.gear === 'R';
    const w = d.stalled && !d.engineOn ? ['red', ICON.alert, 'Stalled']
      : d.parkingBrake && d.engineOn && ((inGear && d.throttle > 0.2) || Math.abs(car.vF) > 0.5) ? ['red', ICON.brake, 'Handbrake on']
      : d.flags.overRev ? ['amber', ICON.up, 'Over-revving · change up']
      : d.flags.labouring ? ['amber', ICON.down, 'Labouring · change down']
      : null;
    this.warn(w);
  }
  warn(w) {
    const el = this.dt.warn, key = w ? w[2] : '';
    if (this.last.warn === key) return;
    this.last.warn = key;
    if (!w) { conceal(el); return; }
    el.classList.remove('red', 'amber');
    el.classList.add(w[0]);
    reveal(el, `${w[1]}<span>${w[2]}</span>`);
  }

  mirror(show, flash) {
    this.flag(this.mirrorEl, 'hidden', !show);
    this.flag(this.mirrorEl, 'flash', !!flash);
  }

  trial(html) {
    if (!html) { this.last.trial = null; this.trialEl.classList.add('hidden'); return; }
    this.trialEl.classList.remove('hidden');
    this.set('trial', this.trialEl, html, 'innerHTML');
  }

  // ---------- the free-drive examiner's live tally and your overall driver rating ----------
  exam(counts, show, rating = null) {
    this.flag(this.examEl, 'hidden', !show);
    // the strip along the foot of the radar, where GTA keeps health and armour: here it drains as
    // you collect driving faults, and goes red the moment a serious one ends the test
    const bar = this.faultBar || (this.faultBar = document.getElementById('faultbar'));
    if (bar) {
      this.flag(bar, 'hidden', !show);
      if (show) {
        const bad = counts.serious + counts.dangerous;
        const left = bad ? 0 : Math.max(0, 1 - counts.minor / 16); // 16 driving faults fails a test
        bar.firstElementChild.style.width = `${Math.round(left * 100)}%`;
        this.flag(bar, 'warn', !bad && left < 0.5);
        this.flag(bar, 'bad', bad > 0);
      }
    }
    if (!show) return;
    const bad = counts.serious + counts.dangerous;
    this.flag(this.examEl, 'bad', bad > 0);
    const r = rating && rating.score != null ? ` <span class="rating">· ${rating.score}/100 ${rating.grade}</span>` : '';
    this.examEl.innerHTML = `<b>L</b>On test · ${counts.minor} fault${counts.minor === 1 ? '' : 's'}${bad ? ` · ${bad} serious` : ''}${r}`;
  }

  // ---------- the controls dock (the bottom 10% of the screen, always on) ----------
  // Shows the same groups the H card would, for whatever you're doing now; only rebuilds on a change.
  renderDock({ car = null, mode = 'menu', trans = 'manual' } = {}) {
    const show = mode === 'foot' || mode === 'car';
    this.dockEl.classList.toggle('hidden', !show);
    if (!show) { this.dockKey = null; return; }
    const box = car?.drive ? car.drive.kind : trans;
    // show what you can actually use now, so the whole strip is visible at a glance
    const order = car?.drive ? [box, 'drive', 'lesson', 'game']
      : car ? ['drive', 'game']
      : ['foot', 'game'];
    const key = order.join(',');
    if (key === this.dockKey) return;
    this.dockKey = key;
    this.dockEl.innerHTML = order.map((id) => {
      const [title, rows] = GROUPS[id];
      return `<div class="dock-group"><span class="dock-title">${title}</span>${rows
        .map(([keys, label]) => `<span class="dock-item">${keys}<em>${label}</em></span>`).join('')}</div>`;
    }).join('');
  }

  // ---------- the controls card ----------
  get controlsOpen() { return !this.controlsEl.classList.contains('hidden'); }
  /** open or close the card; ctx { car, trans } puts what matters now first */
  controls(open, { car = null, trans = 'manual' } = {}) {
    if (!open) { this.controlsEl.classList.add('hidden'); return false; }
    if (!this.ui.hUsed) { this.ui.hUsed = true; this.persist(); }
    const box = car?.drive ? car.drive.kind : trans;
    // the gearbox keys (clutch / P R N D / ignition) only do anything in the learner car, so only a
    // learner car shows them in place; an ordinary car just drives, and on foot they preview the lessons
    const order = car?.drive ? [box, 'drive', 'lesson', 'game', 'foot']
      : car ? ['drive', 'game', 'foot']
      : ['foot', 'game', 'drive', box, 'lesson'];
    this.controlsBody.innerHTML = order.map((id) => {
      const [title, rows] = GROUPS[id];
      return `<section class="ctl-group"><h3>${title}</h3>${rows.map(([keys, label]) => `<div class="ctl-row"><span class="keys">${keys}</span><span>${label}</span></div>`).join('')}</section>`;
    }).join('');
    this.controlsEl.classList.remove('hidden');
    $('controls-close').focus({ preventScroll: true });
    return true;
  }

  /** Queue a reward pop under the map: { title, amount?, kind } */
  reward(r) {
    this.rewardQ.push(r);
    if (this.rewardQ.length === 1) this.nextReward();
  }
  nextReward() {
    const r = this.rewardQ[0];
    if (!r) return;
    const el = this.rewardEl;
    el.classList.remove('lvl', 'neg', 'leaving');
    if (r.kind === 'level') el.classList.add('lvl'); else if (r.amount < 0) el.classList.add('neg');
    el.querySelector('.r-title').textContent = r.title;
    el.querySelector('.r-amt').textContent = r.amount == null ? 'Level up' : `${r.amount < 0 ? '−' : '+'}${shortMoney(Math.abs(r.amount))}`;
    el._shown = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    reveal(el);
    setTimeout(() => { conceal(el); setTimeout(() => { this.rewardQ.shift(); this.nextReward(); }, 260); }, 3200);
  }

  toast(text, ms = 3200) {
    reveal(this.toastEl, esc(text));
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => conceal(this.toastEl), ms);
  }

  /** Heading-up radar centred on the player. GTA V's is a RECTANGLE (the round one was GTA IV),
   *  so this draws into a wide rounded rect: thin roads, a crisp arrow, labels only where they help. */
  minimap(world, x, z, heading, cars, marks = [], path = null) {
    const cv = this.mapCanvas, ctx = this.map;
    if (!this.mapS) {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.mapW = r.width; this.mapH = r.height;
      this.mapS = r.width; // kept: other code reads mapS to know the map is measured
      this.mapDpr = dpr;
      const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    }
    const W = this.mapW, H = this.mapH, cx = W / 2, cy = H / 2;
    const half = cy; // the arrow and the rim-clamping work off the short axis
    const S = W;
    const scale = 0.5 * (H / 200); // ~400 m top to bottom whatever the size
    ctx.setTransform(this.mapDpr, 0, 0, this.mapDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    const rr = 2;
    ctx.moveTo(rr, 0); ctx.lineTo(W - rr, 0); ctx.quadraticCurveTo(W, 0, W, rr);
    ctx.lineTo(W, H - rr); ctx.quadraticCurveTo(W, H, W - rr, H);
    ctx.lineTo(rr, H); ctx.quadraticCurveTo(0, H, 0, H - rr);
    ctx.lineTo(0, rr); ctx.quadraticCurveTo(0, 0, rr, 0);
    ctx.clip();
    ctx.fillStyle = 'rgba(16,18,24,0.5)';
    ctx.fillRect(0, 0, W, H);
    // heading-up map: forward is always up, the driver's right is screen right
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = -Math.cos(heading), rz = Math.sin(heading);
    const tx = (wx, wz) => cx + ((wx - x) * rx + (wz - z) * rz) * scale;
    const ty = (wx, wz) => cy - ((wx - x) * fx + (wz - z) * fz) * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of world.roads) {
      const pts = r.points;
      if (!pts.length) continue;
      ctx.lineWidth = Math.max(1.25, r.width * scale * 0.42);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(tx(p.x, p.z), ty(p.x, p.z)) : ctx.moveTo(tx(p.x, p.z), ty(p.x, p.z))));
      if (r.closed) ctx.closePath();
      ctx.stroke();
    }
    if (path?.length > 1) {
      ctx.strokeStyle = 'rgba(53,174,226,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(tx(p.x, p.z), ty(p.x, p.z)) : ctx.moveTo(tx(p.x, p.z), ty(p.x, p.z))));
      ctx.stroke();
    }
    for (const c of cars) {
      ctx.fillStyle = '#' + c.spec.color.toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(tx(c.pos.x, c.pos.z), ty(c.pos.x, c.pos.z), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // landmarks: dots pinned inside the rim; a label only on the nearest one and on targets
    let nearest = null, nd = Infinity;
    for (const l of world.landmarks) { const dd = (l.x - x) ** 2 + (l.z - z) ** 2; if (dd < nd) { nd = dd; nearest = l; } }
    ctx.font = `600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const l of [...world.landmarks, ...marks]) {
      // clamp the blip inside the rectangle's edges rather than a circle's rim
      let px = Math.max(9, Math.min(W - 9, tx(l.x, l.z)));
      let py = Math.max(9, Math.min(H - 9, ty(l.x, l.z)));
      ctx.fillStyle = l.color;
      ctx.strokeStyle = 'rgba(10,12,16,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (l !== nearest && !marks.includes(l)) continue;
      const w = ctx.measureText(l.name).width;
      const left = px + 6 + w > S - 6; // flip the label inside the disc near the right rim
      const lx = left ? px - 6 - w : px + 6;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,12,16,0.75)';
      ctx.strokeText(l.name, lx, py);
      ctx.fillStyle = 'rgba(245,245,247,0.95)';
      ctx.fillText(l.name, lx, py);
    }
    // the player: a crisp arrow
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(10,12,16,0.8)';
    ctx.stroke();
    ctx.fillStyle = '#e8c77a';
    ctx.fill();
    ctx.restore();
    // a hairline rim just inside the border
    ctx.beginPath();
    ctx.rect(0.5, 0.5, W - 1, H - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
