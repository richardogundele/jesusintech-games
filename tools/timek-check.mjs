#!/usr/bin/env node
// Measure a region's `timeK` -- how long a route really takes against auto-pool's estimate -- the
// way tools/regions.mjs says it must be measured, over the COMPLETED runs of lesson-check. Without
// this there was no way to do it, so every city baked so far plans its tests at the default 1.0.
//
//   node tools/timek-check.mjs <region> [--seeds 1-30]
//   node tools/timek-check.mjs --from <saved lesson-check log>     (re-read a run instead of driving)
//
// Only a run driven to the END measures a route's duration. A run that stalled, or that a dangerous
// fault stopped (lessons.js:302 ends the test there), had its clock cut short with route left to
// drive: Leeds's seed 3 came in at 1.4 min against a 14.6 min estimate, which measures the collision
// and not the route. Those are dropped, and counted separately so you can see how much was dropped.
//
// It prints the multiplier to put in regions.mjs, and it REFUSES to recommend one it cannot stand
// behind: a handful of runs, or a wide spread, means the number would be noise. A long right tail
// is the specific case to watch -- a run that takes 22 minutes against a 15 minute estimate is a
// car stuck in traffic for 7 minutes, not an estimate that is 50% out, and raising timeK to cover
// it would make every normal route on that map too short.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const val = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const region = args.find((a) => !a.startsWith('--') && a !== val('seeds', null) && a !== val('from', null));
const from = val('from', null);
if (!region && !from) { console.error('usage: timek-check.mjs <region> [--seeds 1-30] | --from <log>'); process.exit(2); }

const seeds = val('seeds', '1-30');
let text;
if (from) text = fs.readFileSync(from, 'utf8');
else {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools/lesson-check.mjs'), '--gen', 'auto', '--region', region, '--gseeds', seeds], { encoding: 'utf8', maxBuffer: 64 << 20 });
  text = (r.stdout || '') + (r.stderr || '');
}

const routeRe = /^\s+route (.+?) seed (\d+): ([\d.]+) km, est ([\d.]+) min/;
const runRe = /^(?:ok|FAIL)\s+(\S+?)#\d+\s+\S+(?: \(arcade\))? seed (\d+): (.*)$/;
const est = new Map();
const kept = [], dropped = [];
let label = region;
for (const line of text.split('\n')) {
  const q = routeRe.exec(line);
  if (q) { est.set(Number(q[2]), { est: Number(q[4]), km: Number(q[3]) }); continue; }
  const m = runRe.exec(line);
  if (!m) continue;
  label = m[1];
  const seed = Number(m[2]), body = m[3], e = est.get(seed);
  if (!e) continue;
  const sim = /([\d.]+) sim min/.exec(body);
  if (!sim) continue;
  const why = /did not finish/.test(body) ? 'did not finish'
    : /STOPPED on the dangerous fault/.test(body) ? 'stopped on a dangerous fault'
      : /stopped early/.test(body) ? 'stopped early'
        : /[1-9]\d* dangerous/.test(body) ? 'stopped on a dangerous fault' : null;
  const row = { seed, est: e.est, km: e.km, act: Number(sim[1]) };
  if (why) dropped.push({ ...row, why }); else kept.push(row);
}

if (!kept.length) {
  console.log(`${label}: no completed run to measure. ${dropped.length} run(s) had the clock cut short.`);
  for (const d of dropped) console.log(`  seed ${String(d.seed).padStart(3)}  ${d.why}`);
  process.exit(1);
}
const ratios = kept.map((r) => r.act / r.est).sort((a, b) => a - b);
const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
const median = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
const sd = Math.sqrt(ratios.reduce((s, v) => s + (v - mean) * (v - mean), 0) / ratios.length);

console.log(`${label}: ${kept.length} completed run(s) measured, ${dropped.length} dropped (clock cut short)`);
for (const r of kept.sort((a, b) => a.seed - b.seed))
  console.log(`  seed ${String(r.seed).padStart(3)}  ${r.km.toFixed(2)} km  est ${r.est.toFixed(1)}  actual ${r.act.toFixed(1)}  x${(r.act / r.est).toFixed(3)}`);
for (const d of dropped.sort((a, b) => a.seed - b.seed))
  console.log(`  seed ${String(d.seed).padStart(3)}  -- ${d.why}, ${d.act.toFixed(1)} min of an est ${d.est.toFixed(1)}`);

// The median is what to use: with a right tail of traffic-delayed runs the mean chases the tail.
console.log(`\n  ratio actual/est: median ${median.toFixed(3)}, mean ${mean.toFixed(3)}, sd ${sd.toFixed(3)}, range ${ratios[0].toFixed(2)}..${ratios[ratios.length - 1].toFixed(2)}`);
const tail = kept.filter((r) => r.act / r.est > median + 0.25);
if (tail.length) console.log(`  ${tail.length} run(s) more than 0.25 over the median -- probably stuck in traffic, NOT an estimate to correct for: `
  + tail.map((r) => `seed ${r.seed} ${r.act.toFixed(1)} min vs ${r.est.toFixed(1)}`).join('; '));

const cur = Number(val('current', '1')) || 1;
const want = +(cur * median).toFixed(3);
if (kept.length < 8) console.log(`\n  NOT ENOUGH to set timeK: ${kept.length} completed run(s). Drive more seeds.`);
else if (sd > 0.15) console.log(`\n  TOO WIDE to set timeK: sd ${sd.toFixed(3)} over ${kept.length} runs. A single multiplier cannot\n  describe this spread -- find what is delaying the slow runs first.`);
else console.log(`\n  set timeK: ${want}   (regions.mjs, ${label}; from the median over ${kept.length} completed runs, sd ${sd.toFixed(3)})`);
