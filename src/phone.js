// The phone (Tab): Drive (lessons, parking practice, the mock and the test, your results), Settings
// (the gearbox you learn in and your plate) and your profile. (The dealer, hangar and wardrobe tabs
// were taken out, at Richard's word.)
import { state, formatMoney } from './state.js';
import { DL25_ROWS } from './dl25.js';
import { LESSONS } from './lessons.js';
import { PARKED_ON } from './kent/parked.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Drive first: what a learner opens the phone for is to start something, so starting things is the
// first tab and the first thing on it. The settings it used to share a page with get their own tab.
const TABS = [['drive', 'Drive'], ['settings', 'Settings'], ['me', 'Profile']];

export class Phone {
  /** hooks: { homeId(), crowdSize(), onCarBought(id, home), onJetBought(id), sfx(kind) } */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = $('phone');
    this.body = $('phone-body');
    this.tab = 'drive';
    $('phone-tabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) { this.tab = b.dataset.tab; this.render(); }
      if (b.dataset.close !== undefined) this.hooks.close();
      const act = b.dataset.act, id = b.dataset.id;
      // these leave the phone: close it first so the game mode is restored before travelling
      // the driving test: the gearbox you learn in, a mock or the real thing, retrying a route
      if (act === 'trans') { this.hooks.setTrans(id); this.render(); return; }
      if (act === 'lesson') { this.hooks.close(); this.hooks.startLesson(id); return; }
      if (act === 'plate') { this.hooks.setPlate($('plate-in')?.value); this.render(); return; }
      if (act === 'mock') { this.hooks.close(); this.hooks.startTest(id, null, 'mock'); return; }
      if (act === 'real') { this.hooks.close(); this.hooks.startTest(id, null, 'real'); return; }
      if (act === 'signs') { this.hooks.signDrill(); return; }
      if (act === 'jump') { $(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; } // a quick-start button: down to its section
      if (act === 'retest') { const i = id.lastIndexOf(':'); this.hooks.close(); this.hooks.startTest(id.slice(0, i), +id.slice(i + 1), 'mock'); return; } // (the whole-city centre is whole:<from>:<to>, colons of its own)
      if (act === 'gohome') { this.hooks.close(); this.hooks.goHome(); return; }
      if (act) this.render();
    });
    // Enter in the plate box saves it, like the button
    this.el.addEventListener('keydown', (e) => { if (e.target?.id === 'plate-in' && e.key === 'Enter') { this.hooks.setPlate(e.target.value); this.render(); } });
  }
  get open() { return !this.el.classList.contains('hidden'); }
  show(v) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  render() {
    for (const b of $('phone-tabs').children) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      if (on) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); // keep the current tab in view in the scrolling row
    }
    $('phone-balance').textContent = formatMoney(state.balance);
    if (!TABS.some(([id]) => id === this.tab)) this.tab = 'drive'; // a tab that has been taken out opens Drive
    this.body.innerHTML = this[this.tab]();
    this.body.scrollTop = 0;
  }

  drive() {
    const uk = state.uk, trans = uk.trans;
    // As in real life: you drive, you take mocks, then you take the test. No lesson ladder.
    const h = uk.history || [];
    const mocks = h.filter((t) => t.kind !== 'real'), mocksPassed = mocks.filter((t) => t.passed).length;
    const reals = h.filter((t) => t.kind === 'real');
    // One city, so nothing to pick: a mock or a test starts from one of Driving City's test centres,
    // whichever the day gives you ('any', main.js startTest), as a candidate gets whichever route the
    // examiner has. (This was a row of thirteen town buttons, which Richard had never asked for: the
    // towns are the city's streets, not places to choose between.) The long mock is the drive across
    // the city, a mock only: the real test is the DVSA format, a quarter of an hour.
    const start = (act, id, title, text, ghost = false) => `<div class="row"><div class="grow"><div class="t">${title}</div><div class="s">${text}</div></div><button class="buy${ghost ? ' ghost' : ''}" data-act="${act}" data-id="${id}">Start</button></div>`;
    const lic = uk.licence === 'full' ? 'Full' : uk.licence === 'auto' ? 'Automatic' : 'Provisional';
    return `<div class="hero"><div class="big">${lic}<span>UK licence</span></div>
        <div class="s">${uk.licence === 'auto' ? 'Automatic cars only: pass a test in a manual for a full licence. ' : uk.licence === 'full' ? 'Manual and automatic. ' : ''}Real UK rules on real roads: drive on the left, mph limits, give way to the right at roundabouts. Z and X are the indicators, Q checks your mirrors.</div></div>
      <h3>Start here</h3>
      <p class="note">Pick one. Lessons are ten to twenty minutes with an instructor talking you through; a mock is the real test format with nothing riding on it; the test is the one that counts.</p>
      <div class="seg" style="flex-wrap:wrap"><button data-act="jump" data-id="ph-lessons">Lessons</button>${PARKED_ON ? '<button data-act="lesson" data-id="park">Parking practice</button>' : ''}<button data-act="jump" data-id="ph-mock">Mock test</button><button data-act="jump" data-id="ph-test">Driving test</button></div>
      <p class="note">Free driving needs no button: close the phone (Tab), get in the car (E) and go: A to accelerate, B to brake, the arrows to steer. Manual or automatic is under <b>Settings</b>.</p>
      <div id="ph-lessons"></div>
      ${this.practice(trans)}
      <div id="ph-mock"></div>
      <h3>Mock test</h3>
      <p class="note">The real format, marked the way the examiner marks it, but nothing rides on it: a new route every time, from one of the city's test centres, with roundabouts, lights and crossings, a dual carriageway or 40 road, independent driving, a manoeuvre and sometimes an emergency stop. Each fault is shown as it happens so you learn on the way round.${mocks.length ? ` You've taken ${mocks.length} mock${mocks.length === 1 ? '' : 's'} and passed ${mocksPassed}.` : ''}</p>
      ${start('mock', 'any', 'Mock test', 'About a quarter of an hour, from one of the test centres in Driving City.')}
      ${start('mock', 'whole', 'Long mock', 'About half an hour: from one test centre, out by the link road and across the city to another. Marked the same way. No bay park, because the car park is back where you started.', true)}
      <div id="ph-test"></div>
      <h3>The driving test</h3>
      <p class="note">The one that counts. Same route maker, same DL25 marking: 15 driving faults or fewer and no serious faults to pass. The examiner says nothing about a fault until the debrief. A pass gets you your licence and pays €5m.${reals.length ? ` ${reals.length} attempt${reals.length === 1 ? '' : 's'} so far.` : mocksPassed ? '' : ' Take a mock first if you want to see how you are marked.'}</p>
      ${start('real', 'any', 'Driving test', 'About a quarter of an hour, from one of the test centres in Driving City.')}
      <p class="note">Every route is planned off the city's real streets the moment you press Start. You don't choose where: the centre and the route are the luck of the day, as they are for any candidate.</p>
      ${this.testHistory()}
      <h3>Study</h3><div class="row"><div class="grow"><div class="t">Road signs</div><div class="s">Name ten Highway Code signs. Not marked: just practice.</div></div><button class="buy" data-act="signs">Start</button></div>`;
  }

  /** the gearbox you learn in and your number plate (the lesson car and paint pickers were taken out, at Richard's word) */
  settings() {
    const uk = state.uk, trans = uk.trans;
    return `<h3 style="margin-top:4px">Settings</h3>
      <p class="note">How you learn. Starting a lesson or a test is under <b>Drive</b>.</p>
      <h3>Learning in</h3>
      <div class="seg"><button class="${trans === 'manual' ? 'on' : ''}" data-act="trans" data-id="manual">Manual</button><button class="${trans === 'auto' ? 'on' : ''}" data-act="trans" data-id="auto">Automatic</button></div>
      <p class="note">${trans === 'manual'
        ? 'Manual: the pedals are <b>C</b> clutch (hold it), <b>B</b> brake and <b>A</b> accelerator, left to right as in the car; <b>←</b> <b>→</b> steer, <b>1</b>-<b>5</b> the gears, <b>N</b> neutral, <b>R</b> reverse, <b>I</b> the engine, <b>Space</b> the handbrake, <b>V</b> the camera. Pass in a manual and you can drive both.'
        : 'Automatic: <b>B</b> brake and <b>A</b> accelerator; <b>←</b> <b>→</b> steer, <b>D</b> drive, <b>R</b> reverse, <b>N</b> neutral, <b>P</b> park, <b>I</b> the engine, <b>Space</b> the handbrake, <b>V</b> the camera. It creeps in D: cover the brake. Pass in an automatic and your licence is for automatics only.'}</p>
      <h3>Number plate</h3>
      <div class="plate-row"><input id="plate-in" maxlength="8" value="${esc(this.hooks.myPlate())}" spellcheck="false" autocomplete="off" aria-label="Your number plate" /><button class="buy" data-act="plate">Set plate</button></div>
      <p class="note">Your registration, front and back. Letters, numbers and a space, up to eight characters.</p>
      `;
  }

  /** one thing at a time before a mock: moving off, junctions, roundabouts... in the gearbox you picked above */
  practice(trans) {
    const lessons = LESSONS.filter((l) => l.world === 'kent' && !l.mock && (!l.trans || l.trans === trans) && (!l.park || PARKED_ON)); // (parking practice needs the parked cars)
    const rows = lessons.map((l) => `<div class="row"><div class="grow"><div class="t">${l.title}</div><div class="s">${l.blurb}</div></div>
      <button class="buy ghost" data-act="lesson" data-id="${l.id}">Start</button></div>`).join('');
    return `<h3>Practice lessons</h3><p class="note">Work on one thing at a time before you take a mock, with an instructor talking you through it. Shown for the gearbox you're learning in.</p>${rows}`;
  }

  /** your tests: the last five, the trend in driving faults, the fault that keeps coming up, retry a route */
  testHistory() {
    const h = state.uk.history || [];
    if (!h.length) return '<p class="note">No tests yet. Your results, and how you are improving, will show here.</p>';
    const last = h.slice(-5).reverse();
    const label = Object.fromEntries(DL25_ROWS.map(([k, l]) => [k, l]));
    const count = {};
    for (const t of h.slice(-10)) for (const [k, v] of Object.entries(t.rows || {})) count[k] = (count[k] || 0) + v[0] + 3 * (v[1] + v[2]);
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    const recent = h.slice(-10), max = Math.max(6, ...recent.map((t) => t.minor));
    const bars = recent.map((t) => `<i class="${t.passed ? '' : 'fail'}" style="height:${Math.max(4, (t.minor / max) * 100)}%" title="${t.minor} driving faults"></i>`).join('');
    const a = recent.slice(0, Math.ceil(recent.length / 2)), b = recent.slice(Math.ceil(recent.length / 2));
    const avg = (x) => x.reduce((s, t) => s + t.minor, 0) / Math.max(1, x.length);
    const trend = recent.length >= 4 ? (avg(b) < avg(a) - 0.5 ? 'Fewer driving faults lately: keep it up.' : avg(b) > avg(a) + 0.5 ? 'More driving faults lately: run a mock on the roads that catch you out.' : 'Steady.') : '';
    const rows = last.map((t) => {
      const d = new Date(t.at), when = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<div class="row"><div class="tick">${t.passed ? '✓' : '✕'}</div>
        <div class="grow"><div class="t">${t.centreName || (t.centre === 'canterbury' ? 'Canterbury' : 'Herne Bay')} · ${t.kind === 'real' ? 'driving test' : 'mock'} · ${t.trans === 'auto' ? 'automatic' : 'manual'}</div>
        <div class="s">${when} · ${t.minor} driving · ${t.serious} serious · ${t.dangerous} dangerous${t.main ? ` · ${esc(t.main)}` : ''}</div></div>
        ${t.seed != null ? `<button class="buy ghost" data-act="retest" data-id="${t.centre}:${t.seed}">Retry route</button>` : ''}</div>`;
    }).join('');
    return `<h3>Your tests</h3><div class="trend">${bars}</div><p class="note">${trend}${top ? ` Most common: <b>${label[top[0]] || top[0]}</b>.` : ''}</p>${rows}`;
  }

  me() {
    const s = state.stats;
    const line = (k, v) => `<div class="row"><div class="grow"><div class="t">${k}</div></div><div class="amt">${v}</div></div>`;
    return line('Distance driven', `${s.km.toFixed(1)} km`) +
      line('Top speed', `${s.topKmh} km/h`) +
      line('UK driving licence', state.uk.licence === 'full' ? 'Full (manual)' : state.uk.licence === 'auto' ? 'Automatic only' : 'Provisional') +
      line('Learning in', state.uk.trans === 'auto' ? 'Automatic' : 'Manual') +
      line('Number plate', esc(this.hooks.myPlate())) +
      line('Driving tests', `${(state.uk.history || []).filter((t) => t.passed).length} passed of ${(state.uk.history || []).length}`);
  }
}
