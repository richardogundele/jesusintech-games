// The phone (P or Tab): today's goals, logging real wins, the dealer, the hangar, giving, your profile.
import { state, formatMoney } from './state.js';
import { CARS, JETS, WINS, GIVING, fameLevel, talkFee, flightTime, fuelStop } from './catalog.js';
import * as P from './progress.js';
import { fmtTime } from './trials.js';
import { LESSONS } from './lessons.js';
import { LOOKS } from './character.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['today', 'Today'], ['wins', 'Log a win'], ['lessons', 'Driving lessons'], ['dealer', 'Dealer'], ['hangar', 'Hangar'], ['giving', 'Giving'], ['music', 'Music'], ['wardrobe', 'Wardrobe'], ['me', 'Profile']];
const TRIAL_NAMES = { 'monaco-loop': 'Monte Carlo Grand Loop', 'dubai-szr': 'Sheikh Zayed Sprint' };

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
      }
      if (act === 'jet' && P.buyJet(id)) { this.hooks.sfx('spend'); this.hooks.onJetBought(id); }
      if (act === 'give' && P.give(id)) this.hooks.sfx('level');
      // these leave the phone: close it first so the game mode is restored before travelling
      if (act === 'lesson') { this.hooks.close(); this.hooks.startLesson(id); return; }
      if (act === 'gouk') { this.hooks.close(); this.hooks.goUK(); return; }
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
    this.render();
  }

  get open() { return !this.el.classList.contains('hidden'); }
  show(v) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  render() {
    for (const b of $('phone-tabs').children) b.classList.toggle('on', b.dataset.tab === this.tab);
    $('phone-balance').textContent = formatMoney(state.balance);
    this.body.innerHTML = this[this.tab]();
    this.body.scrollTop = 0;
  }

  today() {
    const goals = P.dailyGoals();
    const mult = P.streakMultiplier();
    const fame = fameLevel(state.reached);
    const goalRows = goals.map((g, i) => `
      <div class="row ${g.done ? 'done' : ''}">
        <div class="tick">${g.done ? '✓' : i + 1}</div>
        <div class="grow"><div class="t">${g.text}</div>${g.shown ? `<div class="s">${g.shown}</div>` : ''}</div>
        <div class="amt">${P.shortMoney(Math.round(P.GOAL_REWARD * mult))}</div>
      </div>`).join('');
    return `
      <div class="hero">
        <div class="big">${state.streak.count}<span>day streak</span></div>
        <div class="s">Rewards ×${mult.toFixed(1)} · finish all three for a ${P.shortMoney(Math.round(P.ALL_DONE_BONUS * mult))} bonus${state.daily.bonus ? ' (claimed)' : ''}</div>
      </div>
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
    const uk = state.uk;
    const inUK = this.hooks.inUK();
    const rows = LESSONS.map((l, i) => {
      const r = uk.lessons[l.id];
      const status = r?.passed ? `<div class="badge">${l.mock ? 'Passed' : 'Passed'} · best ${r.best} driving fault${r.best === 1 ? '' : 's'}</div>` : r ? `<div class="s">Tried ${r.tries}× · not passed yet</div>` : '';
      return `<div class="row"><div class="tick">${r?.passed ? '✓' : l.mock ? 'T' : i + 1}</div>
        <div class="grow"><div class="t">${l.title}</div><div class="s">${l.blurb}</div>${status}</div>
        <button class="buy" data-act="lesson" data-id="${l.id}">${r?.passed ? 'Again' : 'Start'}</button></div>`;
    }).join('');
    return `<div class="hero"><div class="big">${uk.licence ? 'Full' : 'Provisional'}<span>UK licence</span></div>
        <div class="s">Real UK rules: drive on the left, mph limits, give way to the right at roundabouts. Automatic gearbox. Z and X are the indicators, Q checks your mirrors.</div></div>
      ${inUK ? '<button class="buy wide" data-act="gohome">Fly home</button>' : '<button class="buy wide" data-act="gouk">Go to Whitmore, England</button>'}
      <h3>Lessons</h3>${rows}
      <p class="note">Marked like the real DVSA test: 15 or fewer driving faults and no serious or dangerous faults to pass. First pass of each lesson pays €250k; passing the mock test pays €5m.</p>`;
  }

  dealer() {
    const home = this.hooks.homeId();
    const rows = Object.entries(CARS).map(([id, c]) => {
      const owned = P.ownsCar(id);
      const btn = owned ? '<span class="owned">In your garage</span>'
        : `<button class="buy" data-act="car" data-id="${id}" ${state.balance < c.price ? 'disabled' : ''}>${P.shortMoney(c.price)}</button>`;
      return `<div class="row"><div class="swatch" style="background:#${c.color.toString(16).padStart(6, '0')}"></div>
        <div class="grow"><div class="m">${c.maker}</div><div class="t">${c.model}</div><div class="s">${c.topSpeed} km/h</div></div>${btn}</div>`;
    }).join('');
    return `<p class="note">Delivered to your ${home === 'monaco' ? 'Monaco villa' : 'Dubai Hills mansion'}.</p>${rows}`;
  }

  hangar() {
    return `<p class="note">New jets are parked in the second row at your Dubai jet park, and show up in the jet picker.</p>` +
      Object.entries(JETS).sort((a, b) => (a[1].price || 0) - (b[1].price || 0)).map(([id, j]) => {
        const owned = P.ownsJet(id);
        const btn = owned ? '<span class="owned">Yours</span>'
          : `<button class="buy" data-act="jet" data-id="${id}" ${state.balance < j.price ? 'disabled' : ''}>${P.shortMoney(j.price)}</button>`;
        return `<div class="row"><div class="grow"><div class="m">${j.maker}</div><div class="t">${j.model}</div>
          <div class="s">${j.range} · Mach ${j.mach} · Monaco to Singapore ${flightTime(j, 'monaco', 'singapore')}${fuelStop(j, 'monaco', 'singapore') ? ' (fuel stop)' : ' nonstop'}${j.note ? ` · ${j.note}` : ''}</div></div>${btn}</div>`;
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
    return `
      <div class="hero player">
        <div class="m">${cur ? (on ? 'Now playing' : 'Paused') : 'Your music'}</div>
        <div class="np">${cur ? esc(cur.title) : (S.list.length ? 'Press play to start your playlist' : 'Add songs from your computer')}</div>
        <div class="pbs">${mb('prev', '⏮')}${mb('toggle', on ? '❚❚' : '▶', 'main')}${mb('next', '⏭')}${mb('shuffle', 'Shuffle', S.settings.shuffle ? 'on' : 'ghost')}</div>
        <label class="vol">Volume <input type="range" min="0" max="1" step="0.02" value="${S.settings.volume ?? 0.8}" data-vol></label>
      </div>
      <div class="row"><div class="grow"><div class="t">Add songs</div><div class="s">MP3, M4A, WAV, FLAC or OGG files. They stay in this browser on this computer; nothing is uploaded.</div></div>
        <button class="buy" data-act="song-add">Choose files</button></div>
      <h3>Playlist (${S.list.length})</h3>${rows || '<p class="note">No songs yet.</p>'}
      ${S.list.length ? '<p class="note"><b>N</b> skips to the next song while you play. Your songs replace the game\'s radio while they play; press <b>R</b> in a car for Dream Life FM instead.</p><button class="buy ghost wide" data-act="song-clear">Remove all songs</button>' : ''}`;
  }

  wardrobe() {
    const row = (part, label) => `<h3>${label}</h3><div class="swatches">${Object.entries(LOOKS[part]).map(([name, hex]) =>
      `<button class="sw ${state.look[part] === name ? 'on' : ''}" data-act="look" data-part="${part}" data-id="${name}" title="${name}" style="background:#${hex.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
      <p class="note">${state.look[part]}</p>`;
    const o = state.look.outfit ?? 'Realistic soldier';
    const extra = o === 'Realistic soldier'
      ? '<p class="note">A realistic soldier in army digital camouflage (Microsoft Rocketbox avatar, MIT licence). Pick the beret uniform to choose your own camouflage and skin tone.</p>'
      : (o === 'Military uniform' ? row('camo', 'Camouflage') : row('top', 'Sweatshirt') + row('jeans', 'Jeans')) + row('skin', 'Skin tone');
    return `<p class="note">What you're wearing around Monaco, Dubai, Singapore and Whitmore.</p>` + row('outfit', 'Outfit') + extra;
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
      line('UK driving licence', state.uk.licence ? 'Full' : 'Provisional') +
      Object.entries(TRIAL_NAMES).map(([id, n]) => line(n, state.best[id] ? fmtTime(state.best[id]) : 'Not set')).join('');
  }
}
