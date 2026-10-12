import { formatMoney } from './state.js';

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
      this.set('speed', this.speed, String(Math.round(car.speedKmh)));
      this.set('car', this.carName, car.name);
    }
    const keys = mode === 'car'
      ? '<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>E</kbd> get out · <kbd>C</kbd> camera · <kbd>M</kbd> mute'
      : '<kbd>W</kbd><kbd>S</kbd> walk · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>Shift</kbd> run · <kbd>E</kbd> interact · <kbd>M</kbd> mute';
    this.set('keys', this.keys, keys, 'innerHTML');
  }

  toast(text, ms = 3200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  /** Heading-up minimap, 1px = 2m, centred on the player. */
  minimap(world, x, z, heading, cars) {
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
    for (const c of cars) {
      ctx.fillStyle = '#' + c.spec.color.toString(16).padStart(6, '0');
      ctx.fillRect(tx(c.pos.x, c.pos.z) - 3, ty(c.pos.x, c.pos.z) - 3, 6, 6);
    }
    for (const l of world.landmarks) {
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
