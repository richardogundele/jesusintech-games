import { formatMoney, shortMoney } from './state.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = $('hud');
    this.city = $('loc-city');
    this.place = $('loc-place');
    this.money = $('money');
    this.prompt = $('prompt');
    this.toastEl = $('toast');
    this.speed = $('speed');
    this.carName = $('car-name');
    this.speedo = $('speedo');
    this.keys = $('keys');
    this.goalsEl = $('goals');
    this.fameEl = $('fame');
    this.trialEl = $('trial');
    this.rewardEl = $('reward');
    this.rewardQ = [];
    this.unitEl = $('speed-unit');
    this.limitEl = $('limit');
    this.lessonEl = $('lesson');
    this.satnavEl = $('satnav');
    this.indEl = $('indicators');
    this.mirrorEl = $('mirror');
    this.map = $('minimap').getContext('2d');
    this.last = {};
    this.toastTimer = null;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(key, el, value, prop = 'textContent') {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el[prop] = value;
  }

  update({ world, x, z, car, balance, prompt, mode }) {
    this.set('city', this.city, world.name);
    this.set('place', this.place, world.place(x, z));
    this.set('money', this.money, formatMoney(balance));
    this.set('prompt', this.prompt, prompt || '', 'innerHTML');
    this.prompt.classList.toggle('hidden', !prompt);
    this.speedo.classList.toggle('hidden', !car);
    if (car) {
      const mph = world.units === 'mph';
      this.set('speed', this.speed, String(Math.round(mph ? car.speedKmh / 1.609344 : car.speedKmh)));
      this.set('unit', this.unitEl, mph ? 'mph' : 'km/h');
      this.set('car', this.carName, car.name);
    }
    const keys = mode === 'phone' ? '' : mode === 'talk' ? '<kbd>←</kbd><kbd>→</kbd> slides · <kbd>E</kbd> finish · <kbd>M</kbd> mute'
      : mode === 'car' && world.units === 'mph'
      ? '<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Z</kbd><kbd>X</kbd> indicators · <kbd>Q</kbd> mirrors · <kbd>Space</kbd> handbrake · <kbd>E</kbd> get out · <kbd>P</kbd> phone'
      : mode === 'car'
      ? '<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>E</kbd> get out · <kbd>C</kbd> camera · <kbd>R</kbd> radio · <kbd>N</kbd> next song · <kbd>P</kbd> phone'
      : '<kbd>W</kbd><kbd>S</kbd> walk · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>Shift</kbd> run · <kbd>E</kbd> interact · <kbd>P</kbd> phone · <kbd>N</kbd> next song · <kbd>M</kbd> mute';
    this.set('keys', this.keys, keys, 'innerHTML');
  }

  goals(goals, streak) {
    const html = (streak ? `<div class="streak">${streak}-day streak</div>` : '<div class="streak">Today</div>') +
      goals.map((g) => `<div class="g ${g.done ? 'done' : ''}"><i>${g.done ? '✓' : ''}</i>${g.text}${g.shown && !g.done ? ` · ${g.shown}` : ''}</div>`).join('');
    this.set('goals', this.goalsEl, html, 'innerHTML');
  }

  fame(text) { this.set('fame', this.fameEl, text); }

  /** UK speed-limit roundel (null hides it) */
  limit(n, nsl = false) {
    this.limitEl.classList.toggle('hidden', !n);
    this.limitEl.classList.toggle('nsl', !!nsl);
    if (n) this.set('limit', this.limitEl, nsl ? '' : String(n));
  }

  /** instructor panel: { title, text, faults: {minor, serious, dangerous}, mock } or null */
  lesson(info) {
    this.lessonEl.classList.toggle('hidden', !info);
    this.goalsEl.classList.toggle('hidden', !!info); // keep the screen clear while the instructor talks
    if (!info) return;
    this.set('l-title', this.lessonEl.querySelector('.l-title'), info.title);
    this.set('l-text', this.lessonEl.querySelector('.l-text'), info.text);
    const f = info.faults;
    const html = info.mock ? 'Mock test · the examiner is marking quietly'
      : `Driving faults <b>${f.minor}</b> · <span class="${f.serious ? 'bad' : ''}">Serious <b>${f.serious}</b></span> · <span class="${f.dangerous ? 'bad' : ''}">Dangerous <b>${f.dangerous}</b></span>`;
    this.set('l-faults', this.lessonEl.querySelector('.l-faults'), html, 'innerHTML');
  }

  /**
   * sat nav card for independent driving: { arrow: 'left'|'right'|'ahead'|'rb'|'merge', exit, yards,
   * road, lanes, text } or null. The arrow is a character; a roundabout shows its exit number.
   */
  satnav(info) {
    const el = this.satnavEl; if (!el) return;
    el.classList.toggle('hidden', !info);
    if (!info) { this.last.satnav = null; return; }
    const arrow = info.arrow === 'rb' ? `<span class="rb">${info.exit}</span>` : { left: '↰', right: '↱', ahead: '↑', merge: '⤴' }[info.arrow] || '↑';
    const dist = info.yards >= 1000 ? `${(info.yards / 1760).toFixed(1)} mi` : `${info.yards} yd`;
    const html = `<div class="sn-arrow">${arrow}</div><div class="sn-body"><div class="sn-dist">${dist}</div><div class="sn-what">${info.text}</div>${info.road ? `<div class="sn-road">${info.road}</div>` : ''}${info.lanes ? `<div class="sn-lane">${info.lanes}</div>` : ''}</div>`;
    this.set('satnav', el, html, 'innerHTML');
  }

  /** indicators: dir = 'left' | 'right' | null, lit = blink phase; show = in a UK car */
  indicators(show, dir, lit) {
    this.indEl.classList.toggle('hidden', !show);
    const key = `${show}${dir}${lit}`;
    if (this.last.ind === key) return;
    this.last.ind = key;
    this.indEl.children[0].classList.toggle('on', dir === 'left' && lit);
    this.indEl.children[1].classList.toggle('on', dir === 'right' && lit);
  }

  mirror(show, flash) {
    this.mirrorEl.classList.toggle('hidden', !show);
    this.mirrorEl.classList.toggle('flash', !!flash);
  }

  trial(html) {
    this.trialEl.classList.toggle('hidden', !html);
    if (html) this.set('trial', this.trialEl, html, 'innerHTML');
  }

  /** Queue a reward pop on the right: { title, amount?, kind } */
  reward(r) {
    this.rewardQ.push(r);
    if (this.rewardQ.length === 1) this.nextReward();
  }
  nextReward() {
    const r = this.rewardQ[0];
    if (!r) return;
    const el = this.rewardEl;
    el.className = r.kind === 'level' ? 'lvl' : r.amount < 0 ? 'neg' : '';
    el.querySelector('.r-title').textContent = r.title;
    el.querySelector('.r-amt').textContent = r.amount == null ? 'Level up' : `${r.amount < 0 ? '−' : '+'}${shortMoney(Math.abs(r.amount))}`;
    void el.offsetWidth; // restart the pop animation
    setTimeout(() => { this.rewardQ.shift(); el.classList.add('hidden'); setTimeout(() => this.nextReward(), 250); }, 3200);
  }

  toast(text, ms = 3200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  /** Heading-up minimap, 1px = 2m, centred on the player. */
  minimap(world, x, z, heading, cars, marks = [], path = null) {
    const ctx = this.map;
    const S = 200, half = S / 2, scale = 0.5;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(12,16,22,0.55)';
    ctx.fillRect(0, 0, S, S);
    // heading-up map: forward is always up, the driver's right is screen right
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = -Math.cos(heading), rz = Math.sin(heading);
    const tx = (wx, wz) => half + ((wx - x) * rx + (wz - z) * rz) * scale;
    const ty = (wx, wz) => half - ((wx - x) * fx + (wz - z) * fz) * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineCap = 'round';
    for (const r of world.roads) {
      ctx.lineWidth = Math.max(2, r.width * scale * 0.7);
      ctx.beginPath();
      r.points.forEach((p, i) => (i ? ctx.lineTo(tx(p.x, p.z), ty(p.x, p.z)) : ctx.moveTo(tx(p.x, p.z), ty(p.x, p.z))));
      if (r.closed) ctx.closePath();
      ctx.stroke();
    }
    if (path?.length > 1) {
      ctx.strokeStyle = 'rgba(53,174,226,0.95)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(tx(p.x, p.z), ty(p.x, p.z)) : ctx.moveTo(tx(p.x, p.z), ty(p.x, p.z))));
      ctx.stroke();
    }
    for (const c of cars) {
      ctx.fillStyle = '#' + c.spec.color.toString(16).padStart(6, '0');
      ctx.fillRect(tx(c.pos.x, c.pos.z) - 3, ty(c.pos.x, c.pos.z) - 3, 6, 6);
    }
    for (const l of [...world.landmarks, ...marks]) {
      const px = Math.max(10, Math.min(S - 10, tx(l.x, l.z)));
      const py = Math.max(10, Math.min(S - 10, ty(l.x, l.z)));
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 10px Helvetica Neue, Arial';
      ctx.fillText(l.name, px + 7, py + 3);
    }
    // player arrow
    ctx.translate(half, half);
    ctx.fillStyle = '#e8c77a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
