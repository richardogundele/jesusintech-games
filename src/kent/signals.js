// Traffic signals for the Kent world: every signal-controlled junction and pedestrian crossing in
// the region runs its own timing, the signal heads signs-place.js builds show it, and traffic and
// the driving lessons ask it what a driver approaching on a given heading sees. No three.js here.
//
// Junctions (groups 'j-<node>', or the group region.json gives a junction split over several OSM
// nodes): the approaches are clustered by heading, anything more than 45 degrees apart running in
// its own phase, and the phases take turns: red-amber 2 s, green 14 s, amber 3 s, all-red 2 s. A
// junction with a single approach gets a short all-red pedestrian stage instead of a second phase.
// Crossings (groups 'x-<node>', pelican / puffin / toucan / signals): green for traffic until a
// pedestrian presses the button or a 35-70 s timer runs out, then amber 3 s, red 9 s (held while
// anyone is still on the crossing, as a puffin does), red-amber 2 s and green again.
// A crossing within 40 m of a signal junction is not left to its own timer: it is run by the
// junction, as a pedestrian stage in the junction's cycle, the way an integrated crossing is in the
// UK. It goes amber with the junction's last amber, red through the all-red and a 9 s stage in which
// every arm of the junction is red (held while anyone is still on it), and green again with the
// first arm's red-amber. Left to its own timer it could go red at any moment -- including while a
// car that had crossed the junction's stop line on green was between the two, which then stood in
// the middle of the junction across the arms that had the green and locked the junction solid.
//
// Headings are yaws in radians, the same as a head's `heading` and a car's: travel along
// (sin h, cos h), x east, z south. A head's heading is the travel direction of the traffic facing it.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const REDAMBER = 2, GREEN = 14, AMBER = 3, ALLRED = 2, SLOT = REDAMBER + GREEN + AMBER + ALLRED;
const WALK = 7; // all-red pedestrian stage at a one-phase junction
const PED_RED = 9, PED_MAX_RED = 30, MIN_GREEN = 12; // crossing timings (s)
const LINK = 40; // m: a crossing this close to a signal junction's node is run by the junction
const SPLIT = 45 * DEG; // approaches further apart than this are different phases
const STOP_DECEL = 4.5; // m/s2: on amber, a driver who can stop within this stops
const SIGNAL_CROSSINGS = new Set(['pelican', 'puffin', 'toucan', 'signals']);

const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return Math.abs(d); };
const wrapYaw = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

export class SignalSystem {
  /** net: RoadNet; signsBuilder: the signs builder whose live `heads` array shows the states */
  constructor({ net, signsBuilder = null, rnd = Math.random } = {}) {
    this.net = net;
    this.rnd = rnd;
    this.heads = signsBuilder?.heads || [];
    this.groups = new Map(); // id -> group
    this.alias = new Map();  // a junction id that is really a crossing's -> the crossing's id
    this.list = [];
    this.#buildCrossings();
    this.#buildJunctions();
    this.#linkCrossings();
    this.list = [...this.groups.values()];
    this.headPhase = new WeakMap(); // head -> its phase (junction heads), so the per-frame pass skips the angle maths
    this.#applyHeads();
  }

  // ---------- construction ----------
  #buildCrossings() {
    for (const c of this.net.data.crossings || []) {
      if (!SIGNAL_CROSSINGS.has(c.type)) continue;
      const key = String(c.node || Math.round(c.x) + ':' + Math.round(c.z)); // the same name net.lanePath gives the event
      const id = `x-${key}`;
      if (this.groups.has(id)) continue;
      // start somewhere in the cycle so the region's crossings don't all change together
      this.groups.set(id, { id, kind: 'crossing', key, node: c.node || null, type: c.type, x: c.x, z: c.z, state: 'green', t: this.rnd() * 30, next: 35 + this.rnd() * 35, demand: false, held: 0 });
    }
  }
  #buildJunctions() {
    const net = this.net, byGroup = new Map();
    for (const node of net.nodes.values()) {
      if (!node.signals || node.rb) continue;
      const id = net.signalGroup.get(node.id) || `j-${node.id}`;
      // a signals node that is a signal-controlled crossing: lanePath still names a junction group
      // for it, but the only heads there are the crossing's, so both names mean the crossing
      if (this.groups.has(`x-${node.id}`) && id === `j-${node.id}`) { this.alias.set(id, `x-${node.id}`); continue; }
      let a = byGroup.get(id); if (!a) byGroup.set(id, (a = [])); a.push(node);
    }
    for (const [id, nodes] of byGroup) {
      const ids = new Set(nodes.map((n) => n.id));
      const phases = [];
      for (const node of nodes) for (const arm of node.arms()) {
        const w = arm.way;
        if (w.rb) continue;
        if (w.oneway && arm.dir !== -1) continue; // traffic can't come in along this arm
        // the short link between two nodes of one junction is inside the junction, not an approach
        let j = arm.idx; for (;;) { j += arm.dir; if (j < 0 || j >= w.nodes.length || w.nodes[j]) break; }
        if (j >= 0 && j < w.nodes.length && ids.has(w.nodes[j]) && Math.abs(w.cum[j] - w.cum[arm.idx]) < 80) continue;
        // arm bearings point away from the node (degrees, 0 = north, clockwise): coming in is the reverse
        const yaw = wrapYaw(-arm.bearing * DEG);
        const p = phases.find((q) => angDiff(q.yaw, yaw) <= SPLIT);
        if (p) p.n++; else phases.push({ yaw, n: 1, state: 'red' });
      }
      if (!phases.length) phases.push({ yaw: 0, n: 0, state: 'red' });
      phases.sort((a, b) => a.yaw - b.yaw); // clockwise round the junction
      const cycle = phases.length * SLOT + (phases.length === 1 ? WALK : 0);
      const g = { id, kind: 'junction', nodes: nodes.map((n) => n.id), x: nodes[0].x, z: nodes[0].z, phases, cycle, t: this.rnd() * cycle };
      this.#phaseStates(g);
      this.groups.set(id, g);
    }
  }

  /**
   * Hand each crossing near a signal junction to that junction (the nearest, within LINK of any of
   * its nodes) and give the junction's cycle a pedestrian stage after its last phase. j-321 in
   * Canterbury is the case this is for: seven crossings round one junction, x-2831 8 m from a node.
   */
  #linkCrossings() {
    const js = [...this.groups.values()].filter((g) => g.kind === 'junction');
    for (const c of this.groups.values()) {
      if (c.kind !== 'crossing') continue;
      let best = LINK, bj = null;
      for (const j of js) for (const nid of j.nodes) {
        const n = this.net.nodes.get(nid); if (!n) continue;
        const d = Math.hypot(n.x - c.x, n.z - c.z);
        if (d < best) { best = d; bj = j; }
      }
      if (!bj) continue;
      c.link = bj.id;
      (bj.crossings ||= []).push(c);
    }
    for (const g of js) {
      if (!g.crossings) continue;
      g.pedAt = g.phases.length * SLOT; // the stage follows the last phase's all-red
      g.pedLen = Math.max(PED_RED, g.phases.length === 1 ? WALK : 0); // replaces a one-phase junction's own walk stage
      g.cycle = g.pedAt + g.pedLen;
      g.t %= g.cycle; g.ext = 0;
      this.#phaseStates(g);
      for (const c of g.crossings) { c.state = null; this.#linkedState(c, g, 0); }
    }
  }
  /** a linked crossing's state, read off its junction's place in the cycle */
  #linkedState(c, g, dt) {
    const t = g.t, P0 = g.pedAt;
    const st = t >= P0 - ALLRED ? 'red' // the junction's last all-red, then the pedestrian stage
      : t >= P0 - ALLRED - AMBER ? 'amber' // with the last phase's amber
      : t < REDAMBER ? 'redamber' // with the first phase's red-amber
      : 'green';
    if (st !== c.state) { c.state = st; c.t = 0; } else c.t += dt;
    c.held = 0; c.demand = false; // the junction has read them; people on it say so again next frame
  }

  // ---------- running ----------
  /** the state of phase i at the group's time in its cycle */
  #phaseStates(g) {
    const k = Math.floor(g.t / SLOT), local = g.t - k * SLOT;
    for (let i = 0; i < g.phases.length; i++) {
      g.phases[i].state = i !== k ? 'red' : local < REDAMBER ? 'redamber' : local < REDAMBER + GREEN ? 'green' : local < REDAMBER + GREEN + AMBER ? 'amber' : 'red';
    }
  }
  #stepCrossing(g, dt) {
    g.t += dt;
    if (g.state === 'green') {
      if ((g.demand && g.t >= MIN_GREEN) || g.t >= g.next) { g.state = 'amber'; g.t = 0; }
    } else if (g.state === 'amber') {
      if (g.t >= AMBER) { g.state = 'red'; g.t = 0; g.demand = false; }
    } else if (g.state === 'red') {
      if (g.t >= PED_RED && (g.held === 0 || g.t >= PED_MAX_RED)) { g.state = 'redamber'; g.t = 0; }
    } else if (g.t >= REDAMBER) { g.state = 'green'; g.t = 0; g.next = 35 + this.rnd() * 35; }
    g.held = 0; // people on the crossing say so again every frame (occupy)
  }

  /** call once per frame (seconds) */
  update(dt) {
    if (dt > 0) for (const g of this.list) {
      if (g.kind === 'crossing') { if (!g.link) this.#stepCrossing(g, dt); continue; } // a linked one is set by its junction
      let step = dt;
      // the pedestrian stage holds, every arm still red, while anyone is on one of its crossings
      if (g.crossings && g.t >= g.pedAt && g.ext < PED_MAX_RED - g.pedLen && g.crossings.some((c) => c.held > 0)) { g.ext += dt; step = 0; }
      g.t = (g.t + step) % g.cycle;
      if (g.crossings && g.t < g.pedAt) g.ext = 0;
      this.#phaseStates(g);
      if (g.crossings) for (const c of g.crossings) this.#linkedState(c, g, dt);
    }
    this.#applyHeads();
  }
  /** push the states into the built heads (tiles add and remove heads, so walk the live list) */
  #applyHeads() {
    const heads = this.heads;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      let p = this.headPhase.get(h);
      if (p === undefined) { // a head we haven't seen: find its group and phase once
        const g = this.group(h.group);
        p = !g ? null : g.kind === 'crossing' ? g : this.#phaseFor(g, h.heading);
        this.headPhase.set(h, p);
      }
      h.setState(p ? p.state : 'green');
    }
  }
  #phaseFor(g, yaw) {
    let best = g.phases[0], bd = Infinity;
    for (const p of g.phases) { const d = angDiff(p.yaw, yaw); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // ---------- queries ----------
  /** the group record for an id (aliases followed), or undefined */
  group(id) { return this.groups.get(this.alias.get(id) ?? id); }
  has(id) { return !!this.group(id); }
  /** what a driver approaching on `yaw` sees: 'red' | 'amber' | 'green' | 'redamber' (unknown groups show green) */
  stateFor(id, yaw) {
    const g = this.group(id);
    if (!g) return 'green';
    return g.kind === 'crossing' ? g.state : this.#phaseFor(g, yaw).state;
  }
  /**
   * Must a driver approaching on `yaw` stop? Red and red-amber always; amber when they can still stop
   * comfortably before the line (dist m away at v m/s), as the Highway Code says (rule 175).
   */
  isStop(id, yaw, dist = Infinity, v = 0) {
    const st = this.stateFor(id, yaw);
    if (st === 'green') return false;
    if (st === 'amber') return (v * v) / (2 * STOP_DECEL) <= dist;
    return true;
  }
  /** a pedestrian presses the button at a crossing */
  press(id) { const g = this.group(id); if (g && g.kind === 'crossing') g.demand = true; }
  /** someone is on the crossing this frame (keeps a puffin on red) */
  occupy(id) { const g = this.group(id); if (g && g.kind === 'crossing') g.held++; }
  /**
   * How long someone waits at this crossing before giving up and walking on. A crossing run by its
   * junction gets its red once a cycle -- up to about 90 s at a four-arm junction -- so a pedestrian
   * there waits out a cycle, as people do at a junction crossing; 45 s would have them walking off
   * from half the stages they were waiting for.
   */
  patience(id) { const g = this.group(id); const j = g?.link ? this.group(g.link) : null; return j ? Math.max(45, j.cycle + 10) : 45; }
  /** the green man: traffic is on red and has been for less than `fresh` s (people don't start late) */
  pedGreen(id, fresh = 5) { const g = this.group(id); return !!g && g.kind === 'crossing' && g.state === 'red' && g.t < fresh; }
}
