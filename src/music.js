// Procedural music: a tiny step sequencer with synth drums, bass and chords. No audio files.
// Tracks: 'radio' (deep house for the car) and 'arena' (walk-on anthem).
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const TRACKS = {
  radio: {
    bpm: 122,
    // Am9 - Fmaj7 - Cmaj7 - G6 (two bars each)
    chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 55, 59, 64, 67], [55, 59, 62, 64, 69]],
    bass: [45, 41, 36, 43],
    kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], clap: [4, 12], stab: [3, 10],
    bassPat: [0, 3, 6, 10, 14], swing: 0.12, chordLen: 32,
    level: 0.5, cutoff: 1500,
  },
  arena: {
    bpm: 128,
    // F - G - Am - C, big and bright
    chords: [[53, 60, 65, 69, 72], [55, 62, 67, 71, 74], [57, 64, 69, 72, 76], [48, 60, 64, 67, 72]],
    bass: [41, 43, 45, 36],
    kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], clap: [4, 12], stab: [0, 3, 6, 8, 11, 14],
    bassPat: [2, 6, 10, 14], swing: 0, chordLen: 16,
    level: 0.55, cutoff: 3200, pad: true,
  },
};

export class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // gentle glue: a compressor so stacked hits don't clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.out.connect(comp).connect(dest);
    this.track = null;
    this.step = 0;
    this.next = 0;
    this.timer = null;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // short room reverb for chords
    this.verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3);
    }
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.verb.connect(wet).connect(this.out);
  }

  get playing() { return this.track; }

  /** Switch tracks (or null to fade out). level 0..1 scales the track's own mix level. */
  play(name, level = 1) {
    const t = this.ctx.currentTime;
    if (!name) {
      this.out.gain.setTargetAtTime(0, t, 0.6);
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => { if (!this.wanted) this.halt(); }, 3000);
      this.wanted = null;
      return;
    }
    this.wanted = name;
    const tr = TRACKS[name];
    this.out.gain.setTargetAtTime(tr.level * level, t, 0.5);
    if (this.track === name) return;
    this.track = name;
    this.tr = tr;
    this.step = 0;
    this.next = t + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  setLevel(level) {
    if (this.tr) this.out.gain.setTargetAtTime(this.tr.level * level, this.ctx.currentTime, 0.4);
  }

  halt() {
    clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  }

  schedule() {
    const tr = this.tr;
    if (!tr) return;
    const s16 = 60 / tr.bpm / 4;
    // if the tab was asleep, don't try to catch up on missed notes
    if (this.next < this.ctx.currentTime - 0.2) this.next = this.ctx.currentTime + 0.05;
    while (this.next < this.ctx.currentTime + 0.15) {
      const i = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const ci = Math.floor(this.step / tr.chordLen) % tr.chords.length;
      const t = this.next + (i % 2 ? tr.swing * s16 : 0);
      if (tr.kick.includes(i)) this.kick(t);
      if (tr.hat.includes(i)) this.hat(t, 0.11);
      else if (i % 2 === 1) this.hat(t, 0.035);
      if (tr.clap.includes(i) && bar % 8 !== 7) this.clap(t);
      if (tr.bassPat.includes(i)) this.bass(t, tr.bass[ci], s16 * 1.6);
      if (tr.stab.includes(i)) this.chord(t, tr.chords[ci], s16 * (tr.pad ? 2.6 : 1.4), tr.cutoff);
      if (tr.pad && i === 0 && this.step % tr.chordLen === 0) this.chord(t, tr.chords[ci].map((n) => n - 12), s16 * tr.chordLen * 0.95, 900, 0.05);
      this.next += s16;
      this.step++;
    }
  }

  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.9, 0.002, 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  noiseHit(t, type, freq, q, peak, decay) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(t, peak, 0.001, decay);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }
  hat(t, v) { this.noiseHit(t, 'highpass', 8000, 0.7, v, 0.05); }
  clap(t) {
    for (const k of [0, 0.011, 0.022]) this.noiseHit(t + k, 'bandpass', 1500, 1.2, 0.22, k ? 0.03 : 0.16);
  }

  bass(t, note, len) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = NOTE(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(160, t + len);
    f.Q.value = 6;
    const g = this.env(t, 0.32, 0.005, len);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  chord(t, notes, len, cutoff, peak = 0.07) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(cutoff * 0.35, t + len);
    f.Q.value = 2;
    const g = this.env(t, peak, len > 1 ? 0.4 : 0.006, len);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.verb);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 0.1);
      }
    }
  }
}
