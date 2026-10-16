// Dev only (never in the production build): drive lessons with the careful autopilot.
// Kent lessons (moveoff ... mock, mock-canterbury) start at their test centre; the Whitmore practice
// ones are wm-moveoff ... wm-mock. tools/lesson-check.mjs runs the same thing headless in node.
const g = window.__game;
window.runLesson = async (id, maxSec = 2400, { bad = null } = {}) => { // a Kent test is 20-25 minutes of driving
  document.getElementById('res-ok').click();
  g.autoQuiz = true;
  await g.startLesson(id);
  g.autoDrive = true;
  g.badDriver = bad; // e.g. { noSignals: true, speed: 1.4, runReds: true, wrongLane: true }
  let res = null;
  const L0 = g.lesson;
  for (let f = 0; f < maxSec * 60; f++) {
    if (g.mode === 'quiz' || f % 600 === 0) await new Promise((ok) => setTimeout(ok, 0)); // let modals answer
    // Kent streams its world in tiles round the player: keep them filling as fast as we drive
    if (g.world.tiles && g.car) g.world.tiles.update(g.car.pos.x, g.car.pos.z, 1 / 60);
    g.advance(1 / 60);
    if (g.mode === 'result') {
      res = { estop: L0.estop?.state || 'none', faults: L0.faults.filter((f) => f.sev !== 'minor'), medal: document.getElementById('res-medal').innerText, minors: document.getElementById('res-time').innerText, sub: document.getElementById('res-sub').innerText };
      break;
    }
    if (!g.lesson) break;
  }
  g.autoDrive = false;
  g.badDriver = null;
  const L = g.lesson || L0;
  return res || { stuck: true, s: L.s.toFixed(0), len: L.route.length.toFixed(0), dist: L.dist.toFixed(1), faults: L.faults.map((f) => `${f.sev}:${f.cat}`),
    pos: [g.car.pos.x.toFixed(1), g.car.pos.z.toFixed(1)], kmh: g.car.speedKmh.toFixed(1), text: L.text, lights: g.world.lights?.state };
};
window.ready = () => new Promise((r) => {
  const t = setInterval(() => { if (!document.getElementById('start').disabled) { clearInterval(t); if (g.mode === 'menu') document.getElementById('start').click(); g.advance(0.2); r('ready'); } }, 200);
});
// run several lessons in the background; read window.__results while it works
window.runAll = (list) => {
  window.__results = [];
  (async () => {
    for (const [id, opts] of list) {
      const r = await window.runLesson(id, 2400, opts || {});
      window.__results.push({ id, bad: !!opts?.bad, ...r });
      await new Promise((ok) => setTimeout(ok, 0));
    }
    window.__results.push('done');
  })();
  return 'started';
};
