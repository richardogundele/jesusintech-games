#!/usr/bin/env node
// Checks the DL25 marking (src/dl25.js): every fault category LessonRun can record (grepped from
// src/lessons.js and src/main.js) lands in a DL25 row, the pass rule is the real one, and the
// repetition rule only bites on tests.   node tools/dl25-check.mjs   (exits 1 on a failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { rowOf, scoreSheet, debrief, DL25_ROWS } = await import(pathToFileURL(path.join(REPO, 'src/dl25.js')).href);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failed++; };

// every literal category passed to fault(...) / pre.push(...)
const cats = new Set();
for (const f of ['src/lessons.js', 'src/main.js']) {
  const src = fs.readFileSync(path.join(REPO, f), 'utf8');
  for (const m of src.matchAll(/fault\(\s*(?:'(?:minor|serious|dangerous)'|[^,()]+\?[^,()]+),\s*'([^']+)'/g)) cats.add(m[1]);
  for (const m of src.matchAll(/fault\(\s*[^,]+,\s*moveOff \? '([^']+)' : blocking \? '([^']+)' : '([^']+)'/g)) [m[1], m[2], m[3]].forEach((c) => cats.add(c));
  for (const m of src.matchAll(/pre\.push\('([^']+)'\)/g)) cats.add(m[1]);
}
// the stall categories are picked in a variable; make sure they are there
for (const c of ['Move off: control (stalled)', 'Control: clutch (stalled in a junction)', 'Control: clutch (stalled)']) cats.add(c);
const expectAwareness = new Set(['Pedestrian put at risk']);
const rows = new Set(DL25_ROWS.map(([k]) => k));
let n = 0;
for (const c of [...cats].sort()) {
  const { row, sub } = rowOf(c, 'pullright');
  n++;
  const ok = rows.has(row) && (row !== 'awareness' || expectAwareness.has(c));
  if (!ok || process.argv.includes('--list')) check(`maps "${c}"`, ok, `${row}${sub ? ' / ' + sub : ''}`);
}
check(`all ${n} fault categories map to a DL25 row`, failed === 0);

const F = (sev, cat) => ({ sev, cat, s: 0 });
const fifteen = Array.from({ length: 15 }, (_, i) => F('minor', i % 2 ? 'Signals: necessary' : 'Mirrors: change direction'));
check('15 driving faults (spread) pass a lesson', scoreSheet(fifteen).passed);
check('16 driving faults fail', !scoreSheet([...fifteen, F('minor', 'Speed')]).passed);
check('one serious fails', !scoreSheet([F('serious', 'Response to signals: traffic lights')]).passed);
const four = Array.from({ length: 4 }, () => F('minor', 'Mirrors: change direction'));
const t = scoreSheet(four, { test: true }), l = scoreSheet(four, { test: false });
check('4 of one kind: serious by repetition on a test, not in a lesson', !t.passed && t.habitual.length === 1 && l.passed, `test serious ${t.serious}, lesson serious ${l.serious}`);
const spread = scoreSheet([F('minor', 'Control: clutch (riding the clutch)'), F('minor', 'Control: gears (changed gear without the clutch)'), F('minor', 'Control: steering (hit the kerb)'), F('minor', 'Control: parking brake (moving with it on)')], { test: true });
check('4 spread across the Control boxes: not habitual', spread.passed && !spread.serious, `serious ${spread.serious}`);
const oneBox = scoreSheet(Array.from({ length: 4 }, () => F('minor', 'Control: clutch (stalled)')), { test: true });
check('4 in Control / clutch: habitual serious', !oneBox.passed && oneBox.habitual[0] === 'Control (clutch)', oneBox.habitual.join());
const three = scoreSheet(four.slice(1), { test: true });
check('3 of one kind on a test: still driving faults', three.passed && !three.serious);
const b = debrief(scoreSheet([F('serious', 'Junctions: observation (did not give way to the right)'), F('minor', 'Signals: necessary')], { test: true }), { where: () => 'Greenhill roundabout', mock: true });
check('debrief names the main issue and where', /sorry you haven't passed/.test(b.verdict) && /junctions/.test(b.spoken) && /Greenhill/.test(b.spoken) && b.improve[0].lesson === 'junctions', b.spoken);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks ok');
process.exit(failed ? 1 : 0);
