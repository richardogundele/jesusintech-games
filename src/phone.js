// The phone (Tab): Drive (lessons, parking practice, the mock and the test, your results), Settings
// (the gearbox you learn in and your plate) and your profile. (The dealer, hangar and wardrobe tabs
// were taken out, at Richard's word.)
import { state, formatMoney, save } from './state.js';
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
      if (act === 'name') { this.hooks.setName?.($('name-in')?.value); this.render(); return; }
      if (act === 'lessoncar') { this.hooks.setLessonCar(id); this.render(); return; }
      if (act === 'theme') { state.theme = id === 'dark' ? 'dark' : 'light'; save(); this.render(); return; }
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
    this.el.addEventListener('keydown', (e) => {
      if (e.target?.id === 'plate-in' && e.key === 'Enter') { this.hooks.setPlate(e.target.value); this.render(); }
      if (e.target?.id === 'name-in' && e.key === 'Enter') { this.hooks.setName?.(e.target.value); this.render(); }
    });
  }
  get open() { return !this.el.classList.contains('hidden'); }
  show(v) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  render() {
    if (!TABS.some(([id]) => id === this.tab)) this.tab = 'drive'; // a tab that has been taken out opens Drive
    this.el.dataset.theme = state.theme === 'dark' ? 'dark' : 'light';
    for (const b of $('phone-tabs').children) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    }
    $('phone-balance').textContent = formatMoney(state.balance);
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
    const lic = uk.licence === 'full' ? 'Full licence' : uk.licence === 'auto' ? 'Automatic licence' : 'Provisional licence';
    const passed = h.filter((t) => t.passed).length;
    return `<div class="hero"><div class="k">UK driving licence</div><div class="big">${lic}</div>
        <div class="s">${uk.licence === 'auto' ? 'Automatic cars only: pass a test in a manual for a full licence.' : uk.licence === 'full' ? 'Manual and automatic.' : 'Real UK rules on real roads: drive on the left, mph limits, give way to the right at roundabouts.'}</div>
        <div class="chips"><span class="chip">Learning in ${trans === 'auto' ? 'an automatic' : 'a manual'}</span><span class="chip">${mocks.length} mock${mocks.length === 1 ? '' : 's'} · ${mocksPassed} passed</span>${reals.length ? `<span class="chip">${reals.length} test${reals.length === 1 ? '' : 's'} · ${passed - mocksPassed} passed</span>` : ''}</div></div>
      <div class="tiles">
        <button class="tile" data-act="jump" data-id="ph-lessons">Lessons<small>One skill at a time</small></button>
        <button class="tile" data-act="jump" data-id="ph-mock">Mock test<small>Nothing riding on it</small></button>
        <button class="tile" data-act="jump" data-id="ph-test">Driving test<small>The one that counts</small></button>
      </div>
      <p class="note">Or just drive: close the phone (<b>Tab</b>), get in the car (<b>E</b>) and go. Manual or automatic is under <b>Settings</b>.</p>
      <div id="ph-lessons"></div>
      ${this.practice(trans)}
      <div id="ph-mock"></div>
      <h3>Mock test</h3>
      <p class="note">The real format, marked the way the examiner marks it, with a hint before each junction and every fault pointed out as it happens. The real test has none of that. A new route every time, from one of the city's test centres.</p>
      ${start('mock', 'any', 'Mock test', 'About a quarter of an hour: roundabouts, lights, crossings, a faster road, independent driving, a manoeuvre and sometimes an emergency stop.')}
      ${start('mock', 'whole', 'Long mock', 'About half an hour, from one test centre across the city to another. Marked the same way, with no bay park at the end.', true)}
      <div id="ph-test"></div>
      <h3>The driving test</h3>
      ${start('real', 'any', 'Driving test', `15 driving faults or fewer and no serious faults to pass. The examiner says nothing until the debrief. A pass gets you your licence.${!reals.length && !mocksPassed ? ' Take a mock first to see how you are marked.' : ''}`)}
      ${this.testHistory()}
      <h3>Study</h3>${start('signs', '', 'Road signs', 'Name ten Highway Code signs. Not marked: just practice.', true)}`;
  }

  /** the gearbox you learn in and your number plate (the lesson car and paint pickers were taken out, at Richard's word) */
  settings() {
    const trans = state.uk.trans, dark = state.theme === 'dark';
    const keys = (rows) => `<div class="keys">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>`;
    const manualKeys = [['C', 'Clutch (hold it down)'], ['B', 'Brake'], ['A', 'Accelerator'], ['← →', 'Steer'], ['1 – 5', 'Gears'], ['N', 'Neutral'], ['R', 'Reverse'], ['I', 'Engine on / off'], ['Space', 'Handbrake']];
    const autoKeys = [['B', 'Brake'], ['A', 'Accelerator'], ['← →', 'Steer'], ['D', 'Drive'], ['R', 'Reverse'], ['N', 'Neutral'], ['P', 'Park'], ['I', 'Engine on / off'], ['Space', 'Handbrake']];
    const common = [['Q', 'Check your mirrors'], ['Z / X', 'Signal left / right'], ['V', 'Change camera'], ['E', 'Get in or out'], ['Tab', 'This phone']];
    return `<h3>Your name</h3>
      <div class="group">
        <div class="plate-row name-row"><input id="name-in" maxlength="24" value="${esc(state.name || '')}" placeholder="What should Sarah call you?" spellcheck="false" autocomplete="given-name" aria-label="Your name" /><button class="buy" data-act="name">Save</button></div>
        <div class="s">Your instructor greets you by it. It stays on this device.</div>
      </div>
      <h3>Learning in</h3>
      <div class="group">
        <div class="seg" role="radiogroup" aria-label="Gearbox"><button class="${trans === 'auto' ? 'on' : ''}" data-act="trans" data-id="auto" aria-pressed="${trans === 'auto'}">Automatic</button><button class="${trans === 'manual' ? 'on' : ''}" data-act="trans" data-id="manual" aria-pressed="${trans === 'manual'}">Manual</button></div>
        <div class="s">${trans === 'manual' ? 'Pass in a manual and you can drive both.' : 'It creeps forward in D, so keep your foot over the brake. Pass in an automatic and your licence is for automatics only.'}</div>
      </div>
      <h3>Car for lessons and tests</h3>
      <div class="group">
        <div class="cars">${this.hooks.lessonCars().map((c) => `<button class="${c.sel ? 'on' : ''}" data-act="lessoncar" data-id="${c.id}" aria-pressed="${c.sel}">${esc(c.name)}</button>`).join('')}</div>
        <div class="s">Lessons, mocks and the test are in this car, with L plates and the calm handling of a learner car. Or get into any of your cars at home and start a lesson from it.</div>
      </div>
      <h3>Appearance</h3>
      <div class="group">
        <div class="seg" role="radiogroup" aria-label="Appearance"><button class="${dark ? '' : 'on'}" data-act="theme" data-id="light" aria-pressed="${!dark}">Light</button><button class="${dark ? 'on' : ''}" data-act="theme" data-id="dark" aria-pressed="${dark}">Dark</button></div>
      </div>
      <h3>Number plate</h3>
      <div class="group">
        <div class="plate-row"><input id="plate-in" maxlength="8" value="${esc(this.hooks.myPlate())}" spellcheck="false" autocomplete="off" aria-label="Your number plate" /><button class="buy" data-act="plate">Save</button></div>
        <div class="s">Front and back. Letters, numbers and a space, up to eight characters.</div>
      </div>
      <h3>Controls · ${trans === 'manual' ? 'manual' : 'automatic'}</h3>
      <div class="group">${keys(trans === 'manual' ? manualKeys : autoKeys)}</div>
      <div class="group">${keys(common)}</div>`;
  }

  /** one thing at a time before a mock: moving off, junctions, roundabouts... in the gearbox you picked above */
  practice(trans) {
    const lessons = LESSONS.filter((l) => l.world === 'kent' && !l.mock && (!l.trans || l.trans === trans) && (!l.park || PARKED_ON)); // (parking practice needs the parked cars)
    const rows = lessons.map((l, i) => `<div class="row"><div class="num">${i + 1}</div><div class="grow"><div class="t">${l.title}</div><div class="s">${l.blurb}</div></div>
      <button class="buy ghost" data-act="lesson" data-id="${l.id}">Start</button></div>`).join('');
    return `<h3>Lessons</h3><p class="note">One skill at a time, with an instructor beside you. Shown for the gearbox you're learning in.</p>${rows}`;
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
      return `<div class="row"><div class="tick${t.passed ? '' : ' fail'}">${t.passed ? '✓' : '✕'}</div>
        <div class="grow"><div class="t">${t.centreName || (t.centre === 'canterbury' ? 'Canterbury' : 'Herne Bay')} · ${t.kind === 'real' ? 'driving test' : 'mock'} · ${t.trans === 'auto' ? 'automatic' : 'manual'}</div>
        <div class="s">${when} · ${t.minor} driving · ${t.serious} serious · ${t.dangerous} dangerous${t.main ? ` · ${esc(t.main)}` : ''}</div></div>
        ${t.seed != null ? `<button class="buy ghost" data-act="retest" data-id="${t.centre}:${t.seed}">Retry route</button>` : ''}</div>`;
    }).join('');
    return `<h3>Your tests</h3><div class="trend">${bars}</div><p class="note">${trend}${top ? ` Most common: <b>${label[top[0]] || top[0]}</b>.` : ''}</p>${rows}`;
  }

  me() {
    const s = state.stats, h = state.uk.history || [];
    const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    return `<h3>Your driving</h3><div class="stats">` +
      stat('Licence', state.uk.licence === 'full' ? 'Full' : state.uk.licence === 'auto' ? 'Automatic' : 'Provisional') +
      stat('Learning in', state.uk.trans === 'auto' ? 'Automatic' : 'Manual') +
      stat('Tests passed', `${h.filter((t) => t.passed).length} of ${h.length}`) +
      stat('Number plate', esc(this.hooks.myPlate())) +
      stat('Distance driven', `${s.km.toFixed(1)} km`) +
      stat('Top speed', `${Math.round(s.topKmh * 0.621371)} mph`) +
      '</div>';
  }
}
