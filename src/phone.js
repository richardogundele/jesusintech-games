// The phone (P or Tab): today's goals, logging real wins, the dealer, the hangar, giving, your profile.
import { state, formatMoney } from './state.js';
import { CARS, JETS, flightTime, fuelStop } from './catalog.js';
import * as P from './progress.js';
import { DL25_ROWS } from './dl25.js';
import { LOOKS, CIVILIANS } from './character.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['lessons', 'Driving test'], ['dealer', 'Dealer'], ['hangar', 'Hangar'], ['wardrobe', 'Wardrobe'], ['me', 'Profile']];

export class Phone {
  /** hooks: { homeId(), crowdSize(), onCarBought(id, home), onJetBought(id), sfx(kind) } */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = $('phone');
    this.body = $('phone-body');
    this.tab = 'lessons';
    $('phone-tabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) { this.tab = b.dataset.tab; this.render(); }
      if (b.dataset.close !== undefined) this.hooks.close();
      const act = b.dataset.act, id = b.dataset.id;
      if (act === 'car') {
        const home = this.hooks.homeId();
        if (P.buyCar(id, home)) { this.hooks.sfx('spend'); this.hooks.onCarBought(id, home); }
        this.render();
      }
      if (act === 'repair') { if (P.repairCar(id)) { this.hooks.sfx('spend'); this.hooks.onCarRepaired?.(id); } this.render(); }
      if (act === 'jet' && P.buyJet(id)) { this.hooks.sfx('spend'); this.hooks.onJetBought(id); }
      // these leave the phone: close it first so the game mode is restored before travelling
      // the driving test: the gearbox you learn in, a mock or the real thing, retrying a route
      if (act === 'trans') { this.hooks.setTrans(id); this.render(); return; }
      if (act === 'lessoncar') { this.hooks.setLessonCar(id); this.render(); return; }
      if (act === 'mock') { this.hooks.close(); this.hooks.startTest(id, null, 'mock'); return; }
      if (act === 'real') { this.hooks.close(); this.hooks.startTest(id, null, 'real'); return; }
      if (act === 'signs') { this.hooks.signDrill(); return; }
      if (act === 'retest') { const [c, sd] = id.split(':'); this.hooks.close(); this.hooks.startTest(c, +sd, 'mock'); return; }
      if (act === 'gohome') { this.hooks.close(); this.hooks.goHome(); return; }
      if (act === 'look') { state.look[b.dataset.part] = id; this.hooks.setLook(state.look); }
      if (act) this.render();
    });
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
    this.body.innerHTML = this[this.tab]();
    this.body.scrollTop = 0;
  }

  lessons() {
    const uk = state.uk, trans = uk.trans;
    // As in real life: you drive, you take mocks, then you take the test. No lesson ladder.
    const h = uk.history || [];
    const mocks = h.filter((t) => t.kind !== 'real'), mocksPassed = mocks.filter((t) => t.passed).length;
    const reals = h.filter((t) => t.kind === 'real');
    const centres = (act) => `<div class="seg" style="flex-wrap:wrap"><button data-act="${act}" data-id="herne">Herne Bay</button><button data-act="${act}" data-id="canterbury">Canterbury</button><button data-act="${act}" data-id="london">Mill Hill</button><button data-act="${act}" data-id="birmingham">Kings Heath</button><button data-act="${act}" data-id="manchester">West Didsbury</button><button data-act="${act}" data-id="any">Surprise me</button></div>`;
    const lic = uk.licence === 'full' ? 'Full' : uk.licence === 'auto' ? 'Automatic' : 'Provisional';
    return `<div class="hero"><div class="big">${lic}<span>UK licence</span></div>
        <div class="s">${uk.licence === 'auto' ? 'Automatic cars only: pass a test in a manual for a full licence. ' : uk.licence === 'full' ? 'Manual and automatic. ' : ''}Real UK rules on real roads: drive on the left, mph limits, give way to the right at roundabouts. Z and X are the indicators, Q checks your mirrors.</div></div>
      <h3>Learning in</h3>
      <div class="seg"><button class="${trans === 'manual' ? 'on' : ''}" data-act="trans" data-id="manual">Manual</button><button class="${trans === 'auto' ? 'on' : ''}" data-act="trans" data-id="auto">Automatic</button></div>
      <p class="note">${trans === 'manual'
        ? 'Manual: <b>Shift</b> is the clutch (hold it, either Shift key), <b>1</b>-<b>5</b> the gears, <b>R</b> reverse, <b>0</b> neutral, <b>I</b> the engine, <b>Space</b> the handbrake. Pass in a manual and you can drive both.'
        : 'Automatic: <b>1</b> drive, <b>R</b> reverse, <b>0</b> neutral, <b>9</b> park, <b>I</b> the engine, <b>Space</b> the handbrake. It creeps in D: cover the brake. Pass in an automatic and your licence is for automatics only.'}</p>
      <h3>Lesson car</h3>
      <div class="seg" style="flex-wrap:wrap">${this.hooks.lessonCars().map((c) => `<button class="${c.sel ? 'on' : ''}" data-act="lessoncar" data-id="${c.id}">${c.name}</button>`).join('')}</div>
      <p class="note">Take your test in any car you own — it wears L plates and drives like a learner car. No more taxi.</p>
      <h3>Mock test</h3>
      <p class="note">The real format, marked the way the examiner marks it, but nothing rides on it: a new route from the centre you pick with roundabouts, lights and crossings, a dual carriageway or 40 road, independent driving, a manoeuvre and sometimes an emergency stop. Each fault is shown as it happens so you learn on the way round.${mocks.length ? ` You've taken ${mocks.length} mock${mocks.length === 1 ? '' : 's'} and passed ${mocksPassed}.` : ''}</p>
      ${centres('mock')}
      <h3>The driving test</h3>
      <p class="note">The one that counts. Same route maker, same DL25 marking: 15 driving faults or fewer and no serious faults to pass. The examiner says nothing about a fault until the debrief. A pass gets you your licence and pays €5m.${reals.length ? ` ${reals.length} attempt${reals.length === 1 ? '' : 's'} so far.` : mocksPassed ? '' : ' Take a mock first if you want to see how you are marked.'}</p>
      ${centres('real')}
      <p class="note">Kent's routes were written by hand; the city ones are planned off the real map around the centre the moment you press the button.</p>
      ${this.testHistory()}
      <h3>Study</h3><div class="row"><div class="grow"><div class="t">Road signs</div><div class="s">Name ten Highway Code signs. Not marked: just practice.</div></div><button class="buy" data-act="signs">Start</button></div>`;
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

  dealer() {
    const rows = Object.entries(CARS).map(([id, c]) => {
      const owned = P.ownsCar(id), off = P.isWrittenOff(id), cond = P.carCondition(id);
      const repairCost = Math.max(1, Math.round(c.price * ((100 - cond) / 100) * 0.4));
      let btn;
      if (owned) {
        btn = cond < 100
          ? `<button class="buy ghost" data-act="repair" data-id="${id}">Repair · ${P.shortMoney(repairCost)}</button>`
          : '<span class="owned">In your garage</span>';
      } else {
        btn = `<button class="buy" data-act="car" data-id="${id}" ${state.balance < c.price ? 'disabled' : ''}>${off ? 'Replace · ' : ''}${P.shortMoney(c.price)}</button>`;
      }
      const sub = off ? '<div class="s" style="color:#e2574c">Written off</div>'
        : owned && cond < 100 ? `<div class="s">Condition ${cond}%</div>` : `<div class="s">${c.topSpeed} km/h</div>`;
      return `<div class="row"><div class="swatch" style="background:#${c.color.toString(16).padStart(6, '0')}"></div>
        <div class="grow"><div class="m">${c.maker}</div><div class="t">${c.model}</div>${sub}</div>${btn}</div>`;
    }).join('');
    return `<p class="note">Crash a car and it takes real damage: a knock costs repairs, a hard hit writes it off. Buy or replace one here — it's delivered to you.</p>${rows}`;
  }

  hangar() {
    return `<p class="note">New jets are parked in the second row at your Kent jet park, and show up in the jet picker.</p>` +
      Object.entries(JETS).sort((a, b) => (a[1].price || 0) - (b[1].price || 0)).map(([id, j]) => {
        const owned = P.ownsJet(id);
        const btn = owned ? '<span class="owned">Yours</span>'
          : `<button class="buy" data-act="jet" data-id="${id}" ${state.balance < j.price ? 'disabled' : ''}>${P.shortMoney(j.price)}</button>`;
        return `<div class="row"><div class="grow"><div class="m">${j.maker}</div><div class="t">${j.model}</div>
          <div class="s">${j.range} · Mach ${j.mach} · Kent to Manchester ${flightTime(j, 'kent', 'manchester')}${fuelStop(j, 'kent', 'manchester') ? ' (fuel stop)' : ' nonstop'}${j.note ? ` · ${j.note}` : ''}</div></div>${btn}</div>`;
      }).join('');
  }

  wardrobe() {
    const row = (part, label) => `<h3>${label}</h3><div class="swatches">${Object.entries(LOOKS[part]).map(([name, hex]) =>
      `<button class="sw ${state.look[part] === name ? 'on' : ''}" data-act="look" data-part="${part}" data-id="${name}" title="${name}" style="background:#${hex.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
      <p class="note">${state.look[part]}</p>`;
    const o = state.look.outfit ?? 'Realistic soldier';
    const extra = o === 'Realistic soldier'
      ? '<p class="note">A realistic soldier in army digital camouflage (Microsoft Rocketbox avatar, MIT licence). Pick the beret uniform to choose your own camouflage and skin tone.</p>'
      : CIVILIANS.some((c) => c.name === o) ? '<p class="note">Everyday clothes on a Microsoft Rocketbox avatar (MIT licence), the same people you pass on the pavement.</p>'
      : (o === 'Military uniform' ? row('camo', 'Camouflage') : row('top', 'Sweatshirt') + row('jeans', 'Jeans')) + row('skin', 'Skin tone');
    return `<p class="note">What you're wearing around Kent, London, Birmingham and Manchester.</p>` + row('outfit', 'Outfit') + extra;
  }

  me() {
    const s = state.stats;
    const cars = Object.keys(CARS).filter(P.ownsCar).length, jets = P.ownedJetIds().length;
    const line = (k, v) => `<div class="row"><div class="grow"><div class="t">${k}</div></div><div class="amt">${v}</div></div>`;
    return `<div class="hero"><div class="big">${P.shortMoney(P.netWorth())}<span>net worth</span></div></div>` +
      line('Cars', `${cars} / ${Object.keys(CARS).length}`) +
      line('Jets', `${jets} / ${Object.keys(JETS).length}`) +
      line('Distance driven', `${s.km.toFixed(1)} km`) +
      line('Top speed', `${s.topKmh} km/h`) +
      line('Flights', s.flights) +
      line('UK driving licence', state.uk.licence === 'full' ? 'Full (manual)' : state.uk.licence === 'auto' ? 'Automatic only' : 'Provisional') +
      line('Learning in', state.uk.trans === 'auto' ? 'Automatic' : 'Manual') +
      line('Driving tests', `${(state.uk.history || []).filter((t) => t.passed).length} passed of ${(state.uk.history || []).length}`);
  }
}
