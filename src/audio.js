// All sound is synthesised: engines, wind, ambience, music and UI. No audio files needed.
import { Music } from './music.js';

// Engine pitch follows a fake gearbox.
const PROFILES = {
  v12: { base: 52, range: 150, gears: 7, wave: 'sawtooth', cutoff: 1600, grit: 0.5 },
  v8: { base: 44, range: 130, gears: 7, wave: 'sawtooth', cutoff: 1300, grit: 0.8 },
  w16: { base: 36, range: 105, gears: 7, wave: 'sawtooth', cutoff: 1100, grit: 0.6 },
  v12soft: { base: 34, range: 70, gears: 8, wave: 'triangle', cutoff: 700, grit: 0.1 },
};

function noiseBuffer(ctx, seconds, brown = false) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.gear = 0;
    this.lastThrottle = 0;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // ---- engine: fundamental + sub + 2nd harmonic, a little drive, then a resonant lowpass ----
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.shiftGain = ctx.createGain(); // dips on gear changes
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.drive = ctx.createWaveShaper();
    this.setGrit(0.5);
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc3 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc3.type = 'sawtooth';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const g3 = ctx.createGain();
    g3.gain.value = 0.12;
    this.osc1.connect(this.drive);
    this.osc2.connect(g2).connect(this.drive);
    this.osc3.connect(g3).connect(this.drive);
    this.drive.connect(this.filter).connect(this.shiftGain).connect(this.engineGain).connect(this.master);
    for (const o of [this.osc1, this.osc2, this.osc3]) o.start();

    // ---- wind / tyre noise ----
    this.noiseBuf = noiseBuffer(ctx, 2);
    this.noise = ctx.createBufferSource();
    this.noise.buffer = this.noiseBuf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 600;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    this.music = new Music(ctx, this.master);
    this.ambience = new Ambience(ctx, this.master, this.noiseBuf);
  }

  setGrit(amount) {
    if (this.gritNow === amount) return;
    this.gritNow = amount;
    const n = 256, curve = new Float32Array(n), k = amount * 6;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    this.drive.curve = curve;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** car = null when on foot / in a cutscene. */
  update(car, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!car) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.15);
      this.noiseGain.gain.setTargetAtTime(0, t, 0.2);
      this.gear = 0;
      return;
    }
    const p = PROFILES[car.spec.engine] || PROFILES.v8;
    this.setGrit(p.grit);
    const top = car.spec.topSpeed / 3.6;
    const v = Math.abs(car.vF);
    const gearSize = top / p.gears;
    const gear = Math.min(p.gears - 1, Math.floor(v / gearSize));
    const frac = (v - gear * gearSize) / gearSize;
    const rpm = 0.12 + frac * 0.88;
    const f = p.base + rpm * p.range + gear * 4;
    if (gear > this.gear && v > 3) this.shift(t);
    this.gear = gear;
    // lift off at high revs: exhaust crackle
    if (this.lastThrottle > 0.5 && throttle === 0 && rpm > 0.55 && v > 12 && p.grit > 0.3) this.crackle(t);
    this.lastThrottle = throttle;
    this.osc1.type = p.wave;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.osc3.frequency.setTargetAtTime(f * 2.01, t, 0.04);
    this.filter.frequency.setTargetAtTime(p.cutoff * (0.45 + throttle * 0.75 + rpm * 0.4), t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.09 + throttle * 0.15 + rpm * 0.05, t, 0.08);
    const wind = Math.min(1, v / top);
    this.noiseFilter.frequency.setTargetAtTime(400 + wind * 1400, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(wind * 0.1 + Math.min(1, (car.slip || 0) / 6) * 0.08, t, 0.1);
  }

  shift(t) {
    const g = this.shiftGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.35, t + 0.04);
    g.linearRampToValueAtTime(1, t + 0.2);
    this.pop(t + 0.03, 0.12);
  }

  crackle(t) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.pop(t + 0.08 + i * (0.06 + Math.random() * 0.1), 0.05 + Math.random() * 0.07);
  }

  pop(t, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300 + Math.random() * 500;
    f.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.07);
  }

  /** Arena crowd: band-passed noise with a slow swell, 0..2 */
  crowd(level) {
    if (!this.ctx) return;
    if (!this.crowdGain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 0.6;
      this.crowdGain = ctx.createGain();
      this.crowdGain.gain.value = 0;
      src.connect(bp).connect(this.crowdGain).connect(this.master);
      src.start();
    }
    this.crowdGain.gain.setTargetAtTime(Math.min(0.6, level * 0.22), this.ctx.currentTime, 0.4);
  }

  /** Jet roar for cutscenes, 0..1 */
  jet(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.setGrit(0);
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.setTargetAtTime(70 + level * 40, t, 0.2);
    this.osc2.frequency.setTargetAtTime(35 + level * 20, t, 0.2);
    this.osc3.frequency.setTargetAtTime(140 + level * 80, t, 0.2);
    this.filter.frequency.setTargetAtTime(300 + level * 500, t, 0.2);
    this.engineGain.gain.setTargetAtTime(level * 0.12, t, 0.3);
    this.noiseFilter.frequency.setTargetAtTime(900 + level * 1600, t, 0.2);
    this.noiseGain.gain.setTargetAtTime(level * 0.28, t, 0.3);
  }

  // ---------- UI sounds ----------
  tone(freq, t, len, peak = 0.12, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** kind: cash | spend | level | count | go | cp | medal */
  sfx(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const seq = {
      cash: [[1318.5, 0, 0.5], [1760, 0.09, 0.8], [2637, 0.09, 0.6, 0.04]],
      spend: [[880, 0, 0.25], [659.3, 0.08, 0.4]],
      level: [[523.3, 0, 0.5], [659.3, 0.12, 0.5], [784, 0.24, 0.5], [1046.5, 0.36, 1.2]],
      count: [[880, 0, 0.18, 0.1, 'triangle']],
      go: [[1760, 0, 0.5, 0.12, 'triangle']],
      cp: [[1046.5, 0, 0.12, 0.09, 'triangle'], [1568, 0.07, 0.2, 0.09, 'triangle']],
      medal: [[784, 0, 0.4], [988, 0.1, 0.4], [1175, 0.2, 0.4], [1568, 0.3, 1.4]],
    }[kind] || [];
    for (const [f, dt, len, peak, type] of seq) this.tone(f, t + dt, len, peak ?? 0.12, type);
  }
}

// ---------- ambience: a bed per place, plus occasional one-shots ----------
class Ambience {
  constructor(ctx, dest, white) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
    this.kind = null;
    const brown = noiseBuffer(ctx, 4, true);
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // sea: brown noise, lowpassed, swelling like waves on the breakwater
    this.sea = ctx.createGain();
    this.sea.gain.value = 0;
    const seaLP = ctx.createBiquadFilter();
    seaLP.type = 'lowpass';
    seaLP.frequency.value = 700;
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.45;
    lfo.connect(lfoAmt).connect(swell.gain);
    lfo.start();
    loop(brown).connect(seaLP).connect(swell).connect(this.sea).connect(this.out);

    // city: low rumble + mid-band traffic hiss
    this.city = ctx.createGain();
    this.city.gain.value = 0;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 180;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 900;
    hiss.Q.value = 0.5;
    const hissG = ctx.createGain();
    hissG.gain.value = 0.08;
    loop(brown).connect(rumble).connect(this.city);
    loop(white).connect(hiss).connect(hissG).connect(this.city);
    this.city.connect(this.out);

    // room tone for interiors
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    const roomLP = ctx.createBiquadFilter();
    roomLP.type = 'lowpass';
    roomLP.frequency.value = 120;
    loop(brown).connect(roomLP).connect(this.room).connect(this.out);

    this.next = 0;
    setInterval(() => this.oneShots(), 500);
  }

  /** kind: coast | city | indoor | none; muffled = in a car (engine on top) */
  set(kind, muffled = false) {
    const key = kind + muffled;
    if (key === this.key) return;
    this.key = key;
    this.kind = kind;
    const t = this.ctx.currentTime;
    const m = muffled ? 0.35 : 1;
    this.sea.gain.setTargetAtTime(kind === 'coast' ? 0.5 * m : 0, t, 1.2);
    this.city.gain.setTargetAtTime(kind === 'city' ? 0.32 * m : kind === 'coast' ? 0.08 * m : 0, t, 1.2);
    this.room.gain.setTargetAtTime(kind === 'indoor' ? 0.35 : 0, t, 0.8);
  }

  oneShots() {
    const t = this.ctx.currentTime;
    if (t < this.next || this.ctx.state !== 'running') return;
    if (this.kind === 'coast') { Math.random() < 0.6 ? this.gull(t) : this.birds(t); this.next = t + 4 + Math.random() * 9; }
    else if (this.kind === 'city') { this.horn(t); this.next = t + 9 + Math.random() * 16; }
    else this.next = t + 3;
  }

  gull(t) {
    const calls = 2 + Math.floor(Math.random() * 3), base = 1200 + Math.random() * 500, pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.out);
    for (let i = 0; i < calls; i++) {
      const s = t + i * 0.32;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base * 1.25, s);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, s + 0.22);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.025, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.3);
    }
  }

  birds(t) {
    for (let i = 0; i < 5; i++) {
      const s = t + i * 0.11 + Math.random() * 0.05, f = 3200 + Math.random() * 1600;
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * 1.3, s + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.012, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.07);
      o.connect(g).connect(this.out);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  horn(t) {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(pan).connect(this.out);
    const len = 0.18 + Math.random() * 0.3;
    for (const f of [392, 494]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * (0.9 + Math.random() * 0.2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012, t + 0.02);
      g.gain.setValueAtTime(0.012, t + len);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }
}
