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
//
// Headings are yaws in radians, the same as a head's `heading` and a car's: travel along
// (sin h, cos h), x east, z south. A head's heading is the travel direction of the traffic facing it.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const REDAMBER = 2, GREEN = 14, AMBER = 3, ALLRED = 2, SLOT = REDAMBER + GREEN + AMBER + ALLRED;
const WALK = 7; // all-red pedestrian stage at a one-phase junction
const PED_RED = 9, PED_MAX_RED = 30, MIN_GREEN = 12; // crossing timings (s)
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
      if (g.kind === 'crossing') { this.#stepCrossing(g, dt); continue; }
      g.t = (g.t + dt) % g.cycle;
      this.#phaseStates(g);
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
  /** the green man: traffic is on red and has been for less than `fresh` s (people don't start late) */
  pedGreen(id, fresh = 5) { const g = this.group(id); return !!g && g.kind === 'crossing' && g.state === 'red' && g.t < fresh; }
}
