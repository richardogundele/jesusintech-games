import { TILE, tileKey, tileBounds } from './roads.js';

// Streams 500 m tiles of the Kent world around the player. Tiles inside the near ring get
// everything (lod 'near'), tiles inside the far ring get the cheap version ('far'), tiles past
// `dropAt` are disposed. Builders plug in as { name, build(tile, lod) -> part | null } where a
// part is { group, colliders?: [{ cx, cz, w, d, yaw, carOnly }], roads?: [...], dispose() }
// (roads.js, scenery.js, signs-place.js, traffic.js). Work is done nearest-first, one builder at a
// time, and stops for the frame once `budgetMs` has been spent so the game keeps its frame rate.

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TileManager {
  constructor({ net, scene, colliders = null, builders = [], near = 1750, far = 3500, dropAt = 4500, budgetMs = 4, size = TILE, hysteresis = 400 } = {}) {
    this.net = net;
    this.scene = scene;
    this.colliders = colliders;
    this.builders = builders;
    this.near = near;
    this.far = far;
    this.dropAt = dropAt;
    this.budgetMs = budgetMs;
    this.size = size;
    this.hysteresis = hysteresis;
    this.tiles = new Map();      // key -> tile
    this.player = { x: 0, z: 0 };
    this._lastScan = { x: Infinity, z: Infinity, t: -Infinity };
    this._roadsCache = { key: null, list: [] };
    this.lastBuild = null;       // { key, builder, ms, lod }
  }

  /** the tile record at a world point (created on demand, not built) */
  tileAt(x, z) {
    const tx = Math.floor(x / this.size), tz = Math.floor(z / this.size);
    return this._tile(tx, tz);
  }
  _tile(tx, tz) {
    const key = tileKey(tx, tz);
    let t = this.tiles.get(key);
    if (!t) {
      t = { ...tileBounds(tx, tz), key, lod: null, want: null, parts: new Map(), dist: Infinity, built: false };
      this.tiles.set(key, t);
    }
    return t;
  }
  /** distance from a point to the tile's nearest edge (0 inside) */
  _dist(t, x, z) {
    const dx = Math.max(t.x0 - x, 0, x - t.x1), dz = Math.max(t.z0 - z, 0, z - t.z1);
    return Math.hypot(dx, dz);
  }

  /** call once per frame with the player's position */
  update(px, pz, dt = 0) {
    this.player.x = px; this.player.z = pz;
    const t0 = now();
    const scan = this._lastScan;
    if (Math.hypot(px - scan.x, pz - scan.z) > 40 || t0 - scan.t > 1000) {
      this._scan(px, pz);
      scan.x = px; scan.z = pz; scan.t = t0;
    }
    // nearest tile that still needs work
    let job = null;
    for (const t of this.tiles.values()) {
      if (!t.want || this._complete(t)) continue;
      if (!job || t.dist < job.dist) job = t;
    }
    let guard = 0;
    while (job && now() - t0 < this.budgetMs && guard++ < 8) {
      this._step(job);
      if (this._complete(job)) {
        job.lod = job.want;
        job.built = true;
        job = null;
        for (const t of this.tiles.values()) {
          if (!t.want || this._complete(t)) continue;
          if (!job || t.dist < job.dist) job = t;
        }
      }
    }
    void dt;
  }

  /** decide what every tile in range should be; dispose what is out of range */
  _scan(px, pz) {
    const S = this.size, R = this.far;
    const x0 = Math.floor((px - R) / S), x1 = Math.floor((px + R) / S), z0 = Math.floor((pz - R) / S), z1 = Math.floor((pz + R) / S);
    const touched = new Set();
    for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) {
      const t = this._tile(tx, tz);
      t.dist = this._dist(t, px, pz);
      if (t.dist > this.far) continue;
      touched.add(t.key);
      // hysteresis: a near tile stays near a little past the ring so walking the line doesn't thrash
      const keepNear = t.lod === 'near' && t.dist <= this.near + this.hysteresis;
      t.want = t.dist <= this.near || keepNear ? 'near' : 'far';
    }
    for (const t of this.tiles.values()) {
      if (touched.has(t.key)) continue;
      t.dist = this._dist(t, px, pz);
      if (t.dist > this.dropAt || !t.parts.size) { this._dispose(t); this.tiles.delete(t.key); }
      else t.want = t.lod; // keep what is built until it is far enough away to drop
    }
    this._roadsCache.key = null;
  }

  _complete(t) {
    for (const b of this.builders) {
      const part = t.parts.get(b.name);
      if (!part || part.lod !== t.want) return false;
    }
    return true;
  }

  /** build the next missing builder part of a tile (one builder per call) */
  _step(t) {
    for (const b of this.builders) {
      const have = t.parts.get(b.name);
      if (have && have.lod === t.want) continue;
      if (have) this._disposePart(have);
      const t0 = now();
      let part = null;
      try { part = b.build(t, t.want) || null; } catch (e) { console.warn(`[tiles] ${b.name} failed on ${t.key}`, e); }
      const rec = { lod: t.want, part, handles: [] };
      if (part) {
        if (part.group) this.scene.add(part.group);
        if (this.colliders && part.colliders) for (const c of part.colliders) {
          const h = this.colliders.obb(c.cx, c.cz, c.w, c.d, c.yaw || 0, c.carOnly !== false);
          if (h) rec.handles.push(h);
        }
      }
      t.parts.set(b.name, rec);
      this.lastBuild = { key: t.key, builder: b.name, ms: now() - t0, lod: t.want, stats: part?.stats || null };
      this._roadsCache.key = null;
      return;
    }
  }

  _disposePart(rec) {
    if (!rec) return;
    const { part, handles } = rec;
    if (this.colliders) for (const h of handles) this.colliders.remove(h);
    if (part) {
      if (part.group) this.scene.remove(part.group);
      try { part.dispose?.(); } catch (e) { console.warn('[tiles] dispose failed', e); }
    }
  }
  _dispose(t) {
    for (const rec of t.parts.values()) this._disposePart(rec);
    t.parts.clear();
    t.lod = null;
    t.built = false;
  }

  /** built near tiles */
  forEachNear(cb) {
    for (const t of this.tiles.values()) if (t.lod === 'near' && t.built) cb(t);
  }
  /** built tiles of any lod */
  forEachBuilt(cb) {
    for (const t of this.tiles.values()) if (t.built) cb(t);
  }

  /** minimap polylines of the tiles within 500 m of the player: [{ points: Vector3[], width, closed }] */
  roadsNear(radius = 500) {
    const key = `${Math.floor(this.player.x / 50)},${Math.floor(this.player.z / 50)}`;
    if (this._roadsCache.key === key) return this._roadsCache.list;
    const list = [];
    for (const t of this.tiles.values()) {
      if (!t.parts.size || this._dist(t, this.player.x, this.player.z) > radius) continue;
      for (const rec of t.parts.values()) if (rec.part && rec.part.roads) list.push(...rec.part.roads);
    }
    this._roadsCache = { key, list };
    return list;
  }

  /** counts for a debug overlay */
  stats() {
    let near = 0, far = 0, pending = 0, tris = 0;
    for (const t of this.tiles.values()) {
      if (t.want && !this._complete(t)) pending++;
      if (!t.built) continue;
      if (t.lod === 'near') near++; else if (t.lod === 'far') far++;
      for (const rec of t.parts.values()) tris += rec.part?.stats?.tris || 0;
    }
    return { near, far, pending, tris, tiles: this.tiles.size, lastBuild: this.lastBuild };
  }

  dispose() {
    for (const t of this.tiles.values()) this._dispose(t);
    this.tiles.clear();
  }
}
