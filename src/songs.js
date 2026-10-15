// Your own music. Songs you pick from your computer are kept in this browser (IndexedDB) and
// played with an <audio> element; nothing is uploaded anywhere. The playlist outranks the
// synthesised radio: while a song plays, the game's own music stays quiet.

const DB = 'dreamlife-songs', STORE = 'songs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
/** "01 - My Song.mp3" -> "My Song" */
const title = (name) => name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\s*\d{1,3}\s*[-._]\s*/, '').replace(/[_]+/g, ' ').trim() || name;

export class Songs {
  /** opts: { onTrack(song|null), onList(), settings: { shuffle, volume, on } } (settings is saved by the caller) */
  constructor(opts) {
    this.opts = opts;
    this.settings = opts.settings;
    this.list = [];            // [{ id, title, name, size, added }]
    this.current = null;       // song playing / paused, or null
    this.ready = false;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => { this.opts.onTrack?.(null, 'This file cannot be played'); this.next(); });
    this.history = [];
    this.load();
  }

  get playing() { return !!this.current && !this.el.paused; }
  get available() { return this.ready && this.list.length > 0; }

  async load() {
    try {
      const db = await openDb();
      const all = await tx(db, 'readonly', (s) => s.getAll());
      this.list = (all || []).map(({ id, name, size, added }) => ({ id, name, title: title(name), size, added }));
      db.close();
    } catch { this.list = []; }
    this.ready = true;
    this.opts.onList?.();
  }

  /** files: a FileList / File[] from an <input type=file>. Returns how many were added. */
  async add(files) {
    const ok = [...files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(f.name));
    if (!ok.length) return 0;
    const db = await openDb();
    await tx(db, 'readwrite', (s) => { for (const f of ok) s.add({ name: f.name, type: f.type, size: f.size, added: Date.now(), blob: f }); });
    db.close();
    await this.load();
    return ok.length;
  }

  async remove(id) {
    if (this.current?.id === id) this.stop();
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.delete(id));
    db.close();
    await this.load();
  }

  async clear() {
    this.stop();
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.clear());
    db.close();
    await this.load();
  }

  async play(id) {
    const song = this.list.find((s) => s.id === id);
    if (!song) return;
    try {
      const db = await openDb();
      const rec = await tx(db, 'readonly', (s) => s.get(id));
      db.close();
      if (!rec?.blob) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(rec.blob);
      this.el.src = this.url;
      this.el.volume = this.settings.volume ?? 0.8;
      this.current = song;
      if (this.history[this.history.length - 1] !== id) this.history.push(id);
      if (this.history.length > 50) this.history.shift();
      await this.el.play();
      this.settings.on = true;
      this.settings.last = id;
      this.opts.onTrack?.(song);
    } catch (e) {
      // autoplay policy (no gesture yet) or a bad file: say so, leave the song queued
      this.opts.onTrack?.(null, e?.name === 'NotAllowedError' ? 'Press play again' : 'This file cannot be played');
    }
  }

  /** Play/pause the current song, or start the playlist. */
  toggle() {
    if (!this.current) return this.start();
    if (this.el.paused) { this.el.play().catch(() => {}); this.settings.on = true; this.opts.onTrack?.(this.current); }
    else { this.el.pause(); this.settings.on = false; this.opts.onTrack?.(null); }
  }

  /** Start where you left off (last song), else the first / a random one. */
  start() {
    if (!this.list.length) return;
    const last = this.list.find((s) => s.id === this.settings.last);
    return this.play(last ? last.id : this.pick(null));
  }

  pick(afterId) {
    const n = this.list.length;
    if (this.settings.shuffle && n > 1) {
      const recent = new Set(this.history.slice(-Math.min(n - 1, 8)));
      const pool = this.list.filter((s) => !recent.has(s.id));
      return (pool.length ? pool : this.list)[Math.floor(Math.random() * (pool.length || n))].id;
    }
    const i = this.list.findIndex((s) => s.id === afterId);
    return this.list[(i + 1) % n].id;
  }

  next() { if (this.list.length) this.play(this.pick(this.current?.id)); }
  prev() {
    if (this.el.currentTime > 4 || this.history.length < 2) { this.el.currentTime = 0; return; }
    this.history.pop();
    this.play(this.history[this.history.length - 1]);
  }
  stop() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.current = null;
    this.settings.on = false;
    this.opts.onTrack?.(null);
  }
  setVolume(v) { this.settings.volume = v; this.el.volume = v; }
  setMuted(m) { this.el.muted = m; }
}
