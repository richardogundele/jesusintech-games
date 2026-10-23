// The phone (P or Tab): today's goals, logging real wins, the dealer, the hangar, giving, your profile.
import { state, formatMoney, lifeScore } from './state.js';
import { CARS, JETS, WINS, GIVING, fameLevel, talkFee, flightTime, fuelStop, RADIO_STATION } from './catalog.js';
import * as P from './progress.js';
import { fmtTime } from './trials.js';
import { LESSONS, lessonsFor } from './lessons.js';
import { DL25_ROWS } from './dl25.js';
import { LOOKS, CIVILIANS } from './character.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['today', 'Today'], ['wins', 'Log a win'], ['lessons', 'Driving lessons'], ['dealer', 'Dealer'], ['hangar', 'Hangar'], ['giving', 'Giving'], ['music', 'Music'], ['wardrobe', 'Wardrobe'], ['me', 'Profile']];
const TRIAL_NAMES = { 'monaco-loop': 'Monte Carlo Grand Loop', 'dubai-szr': 'Sheikh Zayed Sprint', 'ring-road': 'Ring Road Lap' };

export class Phone {
  /** hooks: { homeId(), crowdSize(), onCarBought(id, home), onJetBought(id), sfx(kind) } */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = $('phone');
    this.body = $('phone-body');
    this.tab = 'today';
    $('phone-tabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) { this.tab = b.dataset.tab; this.render(); }
      if (b.dataset.close !== undefined) this.hooks.close();
      const act = b.dataset.act, id = b.dataset.id;
      if (act === 'win' && P.logWin(id)) this.hooks.sfx('cash');
      if (act === 'car') {
        const home = this.hooks.homeId();
        if (P.buyCar(id, home)) { this.hooks.sfx('spend'); this.hooks.onCarBought(id, home); }
        this.render();
      }
      if (act === 'repair') { if (P.repairCar(id)) { this.hooks.sfx('spend'); this.hooks.onCarRepaired?.(id); } this.render(); }
      if (act === 'jet' && P.buyJet(id)) { this.hooks.sfx('spend'); this.hooks.onJetBought(id); }
      if (act === 'give' && P.give(id)) this.hooks.sfx('level');
      // these leave the phone: close it first so the game mode is restored before travelling
      if (act === 'lesson') { this.hooks.close(); this.hooks.startLesson(id); return; }
      // the driving school: the gearbox you learn in, a 15-minute test, retrying a test's route
      if (act === 'trans') { this.hooks.setTrans(id); this.render(); return; }
      if (act === 'lessoncar') { this.hooks.setLessonCar(id); this.render(); return; }
      if (act === 'test15') { this.hooks.close(); this.hooks.startTest(id); return; }
      if (act === 'signs') { this.hooks.signDrill(); return; }
      if (act === 'retest') { const [c, sd] = id.split(':'); this.hooks.close(); this.hooks.startTest(c, +sd); return; }
      if (act === 'gouk') { this.hooks.close(); this.hooks.goUK(); return; }
      if (act === 'practice') { this.practiceOpen = !this.practiceOpen; this.render(); return; }
      if (act === 'gohome') { this.hooks.close(); this.hooks.goHome(); return; }
      if (act === 'look') { state.look[b.dataset.part] = id; this.hooks.setLook(state.look); }
      if (act?.startsWith('song-')) { this.song(act.slice(5), id, b); return; }
      if (act) this.render();
    });
    // your own music: a hidden file picker (opened from the Music tab) and the volume slider
    this.file = document.createElement('input');
    this.file.type = 'file'; this.file.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus'; this.file.multiple = true; this.file.hidden = true;
    this.el.appendChild(this.file);
    this.file.addEventListener('change', async () => {
      const n = await this.hooks.songs.add(this.file.files);
      this.file.value = '';
      this.hooks.toast?.(n ? `${n} song${n === 1 ? '' : 's'} added` : 'No audio files in that selection', 2200);
      if (n && !this.hooks.songs.playing) this.hooks.songs.start();
      this.render();
    });
    this.el.addEventListener('input', (e) => {
      if (e.target.dataset.vol !== undefined) { this.hooks.songs.setVolume(+e.target.value); }
    });
    this.el.addEventListener('change', (e) => { if (e.target.dataset.vol !== undefined) this.hooks.save?.(); });
  }

  /** Music tab actions */
  song(what, id, btn) {
    const S = this.hooks.songs;
    if (what === 'add') { this.file.click(); return; }
    if (what === 'play') S.play(+id);
    if (what === 'toggle') S.toggle();
    if (what === 'next') S.next();
    if (what === 'prev') S.prev();
    if (what === 'shuffle') { S.settings.shuffle = !S.settings.shuffle; this.hooks.save?.(); }
    if (what === 'remove') S.remove(+id);
    if (what === 'clear' && confirm('Remove all your songs from the game?')) S.clear();
    const Y = this.hooks.ytradio;
    if (what === 'yt') { if (Y.on) Y.stop(); else { if (S.playing) S.toggle(); Y.start(); } }
    if (what === 'ytnext') Y.next();
    if (what === 'ytprev') Y.prev();
    if (what === 'ytshuffle') Y.setShuffle(!Y.shuffle);
    this.render();
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

  today() {
    const goals = P.dailyGoals();
    const mult = P.streakMultiplier();
    const fame = fameLevel(state.reached);
    const score = lifeScore({ ownedCars: P.boughtCarsIn('kent').length + P.boughtCarsIn('london').length + P.boughtCarsIn('birmingham').length + P.boughtCarsIn('manchester').length, ownedJets: P.ownedJetIds().length - 2 /* starter jets */, lessonsTotal: LESSONS.length });
    const scoreRows = score.parts.map((p) => `
      <div class="row"><div class="grow"><div class="t">${p.k} <span class="s">${p.hint}</span></div><div class="bar"><i style="width:${Math.round((p.v / p.max) * 100)}%"></i></div></div>
        <div class="amt">${p.v}<small>/ ${p.max}</small></div></div>`).join('');
    const goalRows = goals.map((g, i) => `
      <div class="row ${g.done ? 'done' : ''}">
        <div class="tick">${g.done ? '✓' : i + 1}</div>
        <div class="grow"><div class="t">${g.text}</div>${g.shown ? `<div class="s">${g.shown}</div>` : ''}</div>
        <div class="amt">${P.shortMoney(Math.round(P.GOAL_REWARD * mult))}</div>
      </div>`).join('');
    return `
      <div class="hero">
        <div class="big">${score.total}<span>Life Score · ${score.grade}</span></div>
        <div class="s">${score.title} · ${state.streak.count}-day streak · rewards ×${mult.toFixed(1)}</div>
      </div>
      <h3>What's scoring you</h3>${scoreRows}
      <h3>Today's goals</h3>${goalRows}
      <h3>On stage</h3>
      <div class="row"><div class="grow"><div class="t">${fame.title}</div>
        <div class="s">${state.reached.toLocaleString('en-GB')} people reached${fame.next ? ` · ${(fame.next.at - state.reached).toLocaleString('en-GB')} more to ${fame.next.title}` : ''}</div>
        ${fame.next ? `<div class="bar"><i style="width:${Math.min(100, ((state.reached - fame.at) / (fame.next.at - fame.at)) * 100)}%"></i></div>` : ''}</div>
        <div class="amt">${P.shortMoney(talkFee(state.reached, this.hooks.crowdSize()))}<small>next fee</small></div></div>
      <p class="note">Log your real wins in <b>Log a win</b>. Daily goals reset at midnight; miss a day and the streak starts again.</p>`;
  }

  wins() {
    const counts = P.winsToday();
    return `<p class="note">Honour system. Did it happen today in real life? Log it and get paid in here. Up to ${P.WIN_CAP} of each per day.</p>` +
      WINS.map((w) => {
        const n = counts[w.id] || 0;
        return `<div class="row"><div class="grow"><div class="t">${w.label}</div><div class="s">${n} / ${P.WIN_CAP} today</div></div>
          <button class="buy" data-act="win" data-id="${w.id}" ${n >= P.WIN_CAP ? 'disabled' : ''}>+${P.shortMoney(w.amount)}</button></div>`;
      }).join('');
  }

  lessons() {
    const uk = state.uk, trans = uk.trans;
    const inUK = this.hooks.inUK();
    const row = (l, n) => {
      const r = uk.lessons[l.id];
      const status = r?.passed ? `<div class="badge">Passed · best ${r.best} driving fault${r.best === 1 ? '' : 's'}</div>` : r ? `<div class="s">Tried ${r.tries}× · not passed yet</div>` : '';
      return `<div class="row"><div class="tick">${r?.passed ? '✓' : l.mock ? 'T' : n}</div>
        <div class="grow"><div class="t">${l.title}${l.trans ? ` <span class="badge">${l.trans === 'manual' ? 'Manual' : 'Automatic'}</span>` : ''}</div><div class="s">${l.blurb}</div>${status}</div>
        <button class="buy" data-act="lesson" data-id="${l.id}">${r?.passed ? 'Again' : 'Start'}</button></div>`;
    };
    // One full test is the main event. The old per-skill lessons and fixed mocks fold into a
    // collapsible "Practise a skill" section, so the headline is a single comprehensive drive.
    const mine = lessonsFor(trans);
    const kent = mine.filter((l) => l.world === 'kent');
    const skills = kent.filter((l) => !l.mock);                    // moving off, junctions, roundabouts, crossings, dual, manoeuvres…
    const mocks = kent.filter((l) => l.mock);                      // the fixed full-length mock routes
    const town = mine.filter((l) => l.world !== 'kent');           // Whitmore practice town
    const open = this.practiceOpen;
    const practiceBlock = !open ? '' : `
      <p class="note">Practise one part of the test on its own. Not needed to take the test — the full test covers all of it.</p>
      ${skills.map((l, i) => row(l, i + 1)).join('')}
      <h4>Full-length mock routes</h4>${mocks.map((l) => row(l, 'T')).join('')}
      <h4>Whitmore practice town</h4>
      <p class="note">The made-up town the lessons started in: quiet roads to practise on. No pay, no licence.</p>
      ${town.map((l, i) => row(l, l.mock ? 'T' : i + 1)).join('')}`;
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
      ${inUK ? '<button class="buy wide" data-act="gohome">Fly home</button>' : ''}
      <h3>The driving test</h3>
      <p class="note">One full test. A new route every time from the centre you pick — it rolls everything into one drive: roundabouts, traffic lights and crossings, junctions, a dual carriageway or 40 road, independent driving (sat nav, or following the signs about one test in five), a manoeuvre, pull-ups and sometimes an emergency stop. I'll direct you the whole way and bring you back on if you miss a turn. Marked on the DVSA DL25: 15 driving faults or fewer and no serious faults to pass. A pass pays €5m and gets you your licence.</p>
      <div class="seg" style="flex-wrap:wrap"><button data-act="test15" data-id="herne">Herne Bay</button><button data-act="test15" data-id="canterbury">Canterbury</button><button data-act="test15" data-id="london">Mill Hill</button><button data-act="test15" data-id="birmingham">Kings Heath</button><button data-act="test15" data-id="manchester">West Didsbury</button><button data-act="test15" data-id="any">Surprise me</button></div>
      <p class="note">Kent's routes were written by hand; the city ones are planned off the real map around the centre the moment you press the button.</p>
      ${this.testHistory()}
      <h3>Study</h3><div class="row"><div class="grow"><div class="t">Road signs</div><div class="s">Name ten Highway Code signs. Not marked: just practice.</div></div><button class="buy" data-act="signs">Start</button></div>
      <h3>Practise a skill</h3>
      <div class="row"><div class="grow"><div class="t">Individual lessons</div><div class="s">Moving off, junctions, roundabouts, crossings and lights, dual carriageways, manoeuvres — one at a time. Optional.</div></div>
        <button class="buy" data-act="practice">${open ? 'Hide' : 'Show'}</button></div>
      ${practiceBlock}`;
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
    const trend = recent.length >= 4 ? (avg(b) < avg(a) - 0.5 ? 'Fewer driving faults lately: keep it up.' : avg(b) > avg(a) + 0.5 ? 'More driving faults lately: book a lesson on your weak spot.' : 'Steady.') : '';
    const rows = last.map((t) => {
      const d = new Date(t.at), when = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<div class="row"><div class="tick">${t.passed ? '✓' : '✕'}</div>
        <div class="grow"><div class="t">${t.centreName || (t.centre === 'canterbury' ? 'Canterbury' : 'Herne Bay')} · ${t.kind === 'test15' ? '15 min' : 'full mock'} · ${t.trans === 'auto' ? 'automatic' : 'manual'}</div>
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

  giving() {
    return `<div class="hero"><div class="big">${state.stats.impact.toLocaleString('en-GB')}<span>lives impacted</span></div></div>` +
      GIVING.map((g) => `<div class="row"><div class="grow"><div class="t">${g.label}</div><div class="s">${g.impact.toLocaleString('en-GB')} lives</div></div>
        <button class="buy" data-act="give" data-id="${g.id}" ${state.balance < g.price ? 'disabled' : ''}>${P.shortMoney(g.price)}</button></div>`).join('');
  }

  music() {
    const S = this.hooks.songs, cur = S.current, on = S.playing;
    const mb = (what, label, cls = '') => `<button class="pb ${cls}" data-act="song-${what}" title="${label}">${label}</button>`;
    const rows = S.list.map((s) => `
      <div class="row ${cur?.id === s.id ? 'now' : ''}">
        <button class="pb small" data-act="song-play" data-id="${s.id}" title="Play">${cur?.id === s.id && on ? '❚❚' : '▶'}</button>
        <div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${(s.size / 1e6).toFixed(1)} MB</div></div>
        <button class="pb small ghost" data-act="song-remove" data-id="${s.id}" title="Remove">✕</button></div>`).join('');
    const Y = this.hooks.ytradio;
    const radio = `
      <div class="hero player radio">
        <div class="m">${Y.on ? 'On air' : 'Radio'} · ${RADIO_STATION.name}</div>
        <div class="np">${Y.on ? esc(Y.title || 'Tuning in…') : RADIO_STATION.note}</div>
        <div class="pbs">${mb('ytprev', '⏮')}${mb('yt', Y.on ? '■' : '▶', 'main')}${mb('ytnext', '⏭')}${mb('ytshuffle', 'Shuffle', Y.shuffle ? 'on' : 'ghost')}</div>
        <p class="note">The whole <a href="${RADIO_STATION.url}" target="_blank" rel="noopener">Tribe Fuego</a> channel through YouTube's own player, shuffled. Needs internet; the small player stays on screen while it plays.</p>
      </div>`;
    return radio + `
      <div class="hero player">
        <div class="m">${cur ? (on ? 'Now playing' : 'Paused') : 'Your music'}</div>
        <div class="np">${cur ? esc(cur.title) : (S.list.length ? 'Press play to start your playlist' : 'Add songs from your computer')}</div>
        <div class="pbs">${mb('prev', '⏮')}${mb('toggle', on ? '❚❚' : '▶', 'main')}${mb('next', '⏭')}${mb('shuffle', 'Shuffle', S.settings.shuffle ? 'on' : 'ghost')}</div>
        <label class="vol">Volume <input type="range" min="0" max="1" step="0.02" value="${S.settings.volume ?? 0.8}" data-vol></label>
      </div>
      <div class="row"><div class="grow"><div class="t">Add songs</div><div class="s">MP3, M4A, WAV, FLAC or OGG files. They stay in this browser on this computer; nothing is uploaded.</div></div>
        <button class="buy" data-act="song-add">Choose files</button></div>
      <h3>Playlist (${S.list.length})</h3>${rows || '<p class="note">No songs yet.</p>'}
      ${S.list.length ? '<p class="note"><b>N</b> skips to the next song while you play. Your songs replace the game\'s radio while they play; press <b>F</b> in a car for Dream Life FM instead.</p><button class="buy ghost wide" data-act="song-clear">Remove all songs</button>' : ''}`;
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
    const fame = fameLevel(state.reached);
    const cars = Object.keys(CARS).filter(P.ownsCar).length, jets = P.ownedJetIds().length;
    const line = (k, v) => `<div class="row"><div class="grow"><div class="t">${k}</div></div><div class="amt">${v}</div></div>`;
    return `<div class="hero"><div class="big">${P.shortMoney(P.netWorth())}<span>net worth</span></div><div class="s">${fame.title}</div></div>` +
      line('People reached on stage', state.reached.toLocaleString('en-GB')) +
      line('Talks given', s.talks) +
      line('Lives impacted', s.impact.toLocaleString('en-GB')) +
      line('Cars', `${cars} / ${Object.keys(CARS).length}`) +
      line('Jets', `${jets} / ${Object.keys(JETS).length}`) +
      line('Distance driven', `${s.km.toFixed(1)} km`) +
      line('Top speed', `${s.topKmh} km/h`) +
      line('Flights', s.flights) +
      line('UK driving licence', state.uk.licence === 'full' ? 'Full (manual)' : state.uk.licence === 'auto' ? 'Automatic only' : 'Provisional') +
      line('Learning in', state.uk.trans === 'auto' ? 'Automatic' : 'Manual') +
      line('Driving tests', `${(state.uk.history || []).filter((t) => t.passed).length} passed of ${(state.uk.history || []).length}`) +
      Object.entries(TRIAL_NAMES).map(([id, n]) => line(n, state.best[id] ? fmtTime(state.best[id]) : 'Not set')).join('');
  }
}
