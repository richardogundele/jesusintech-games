// Synthesised engine + wind, no audio files needed. Pitch follows a fake gearbox.
const PROFILES = {
  v12: { base: 52, range: 150, gears: 7, wave: 'sawtooth', cutoff: 1600 },
  v8: { base: 44, range: 130, gears: 7, wave: 'sawtooth', cutoff: 1300 },
  w16: { base: 36, range: 105, gears: 7, wave: 'sawtooth', cutoff: 1100 },
  v12soft: { base: 34, range: 70, gears: 8, wave: 'triangle', cutoff: 700 },
};

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.filter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // wind / tyre noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 600;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();
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
      return;
    }
    const p = PROFILES[car.spec.engine] || PROFILES.v8;
    const top = car.spec.topSpeed / 3.6;
    const v = Math.abs(car.vF);
    const gearSize = top / p.gears;
    const gear = Math.min(p.gears - 1, Math.floor(v / gearSize));
    const frac = (v - gear * gearSize) / gearSize;
    const rpm = 0.12 + frac * 0.88;
    const f = p.base + rpm * p.range + gear * 4;
    this.osc1.type = p.wave;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.filter.frequency.setTargetAtTime(p.cutoff * (0.45 + throttle * 0.75 + rpm * 0.4), t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + throttle * 0.16 + rpm * 0.05, t, 0.08);
    const wind = Math.min(1, v / top);
    this.noiseFilter.frequency.setTargetAtTime(400 + wind * 1400, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(wind * 0.1 + Math.min(1, (car.slip || 0) / 6) * 0.08, t, 0.1);
  }

  /** Arena crowd: band-passed noise with a slow swell, 0..2 */
  crowd(level) {
    if (!this.ctx) return;
    if (!this.crowdGain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise.buffer;
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
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.setTargetAtTime(70 + level * 40, t, 0.2);
    this.osc2.frequency.setTargetAtTime(35 + level * 20, t, 0.2);
    this.filter.frequency.setTargetAtTime(300 + level * 500, t, 0.2);
    this.engineGain.gain.setTargetAtTime(level * 0.12, t, 0.3);
    this.noiseFilter.frequency.setTargetAtTime(900 + level * 1600, t, 0.2);
    this.noiseGain.gain.setTargetAtTime(level * 0.28, t, 0.3);
  }
}
