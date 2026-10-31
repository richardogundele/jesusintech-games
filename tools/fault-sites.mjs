#!/usr/bin/env node
// Which PLACES fail, not which seeds. A per-seed pass count can hold still while every underlying
// fault moves to a different spot, which is indistinguishable from "no effect" until you look at
// where the faults land -- the same trap as reading totals instead of trace hashes. Burgess Hill
// went 8/10 to 9/10 across a driver fix while the collision at the signalised four-arm junction
// (917.2,-633.2) simply moved from seed 3 to seed 8: the seed changed, the site did not.
//
//   node tools/fault-sites.mjs <region> [--seeds 1-10] [--radius 6]
//   node tools/fault-sites.mjs kent --pool both      (Kent's authored pools instead of autoPool)
//
// Prints each site once, with the faults seen there and the seeds that hit it, worst first. Compare
// two runs by site: a site that disappears is fixed, a site that appears is new, and a site that
// survives with a different seed attached is NOT fixed however the totals read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const region = args.find((a) => !a.startsWith('--'));
const val = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
if (!region) { console.error('usage: fault-sites.mjs <region> [--seeds 1-10] [--radius 6] [--pool both]'); process.exit(2); }

const seeds = val('seeds', '1-10');
const radius = Number(val('radius', 6));
const pool = val('pool', null);
const run = pool
  ? ['--gen', pool, '--gseeds', seeds]
  : ['--gen', 'auto', '--region', region, '--gseeds', seeds];

// --from re-reads a saved lesson-check run instead of driving again. Note city-report.sh passes
// --quiet, which omits the per-fault lines, so a report written by that script has nothing to index.
const from = val('from', null);
let text;
if (from) {
  text = fs.readFileSync(from, 'utf8');
} else {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools/lesson-check.mjs'), ...run], { encoding: 'utf8', maxBuffer: 64 << 20 });
  text = (r.stdout || '') + (r.stderr || '');
}

// lesson-check prints the per-run line first, then that run's faults indented beneath it.
// A stalled run is NOT a fault: it ends "did not finish (... at {x,z,text})" with its counts at
// 0 minor 0 serious 0 dangerous, and an indented STALL record carrying its own at:[x,z]. Indexing
// only the fault lines would hide the worst site on a gridlocked map entirely -- on Birmingham a
// third of the runs stall at one box junction and not one of them records a fault. They get their
// own severity above dangerous, because a run the learner could not finish is worse than one failed.
const runLine = /^(ok|FAIL)\s+(\S+)\s+.*?seed (\d+):/;
const faultLine = /^\s+([dsm]):(.+?)@(\d+)\s+\(([-\d.]+),([-\d.]+)\)/;
const dnfLine = /did not finish \(s (\d+) of \d+ m at (\{.*?\})\)/;
const stallLine = /^\s+STALL (\{.*\})$/;
let seed = null, fails = 0, runs = 0;
const sites = [];
const add = (x, z, hit) => {
  let site = sites.find((s) => Math.hypot(s.x - x, s.z - z) <= radius);
  if (!site) sites.push((site = { x, z, hits: [] }));
  site.hits.push(hit);
  return site;
};
for (const line of text.split('\n')) {
  const m = runLine.exec(line);
  if (m) {
    seed = Number(m[3]); runs++; if (m[1] === 'FAIL') fails++;
    const d = dnfLine.exec(line);
    if (d) { // the run never finished: record where it got stuck, unless a STALL record refines it
      try { const at = JSON.parse(d[2]); if (at && at.x != null) add(at.x, at.z, { seed, sev: 'x', what: `did not finish at ${d[1]} m${at.text ? ` ("${at.text}")` : ''}`, soft: true }); } catch {}
    }
    continue;
  }
  if (seed == null) continue;
  const st = stallLine.exec(line);
  if (st) {
    try {
      const s = JSON.parse(st[1]);
      if (Array.isArray(s.at)) {
        // drop the coarser did-not-finish marker for this seed: the stall record is the same event
        for (const site of sites) site.hits = site.hits.filter((h) => !(h.soft && h.seed === seed));
        add(s.at[0], s.at[1], { seed, sev: 'x', what: `stalled at ${s.s} m${s.chain ? ` (chain ${s.chain})` : ''}` });
      }
    } catch {}
    continue;
  }
  const f = faultLine.exec(line);
  if (!f) continue;
  const [, sev, what, , xs, zs] = f;
  add(Number(xs), Number(zs), { seed, sev, what: what.trim() });
}
for (let i = sites.length - 1; i >= 0; i--) if (!sites[i].hits.length) sites.splice(i, 1);

const SEV = { x: 'STALLED', d: 'dangerous', s: 'serious', m: 'minor' };
const rank = { x: 4, d: 3, s: 2, m: 1 };
const worst = (s) => Math.max(...s.hits.map((h) => rank[h.sev] || 0));
sites.sort((a, b) => worst(b) - worst(a) || b.hits.length - a.hits.length);

console.log(`${region}${pool ? ` (pool ${pool})` : ''}: ${runs} run(s), ${runs - fails} ok, ${sites.length} distinct fault site(s) within ${radius} m`);
for (const s of sites) {
  const kinds = [...new Set(s.hits.map((h) => `${SEV[h.sev] || h.sev}: ${h.what}`))];
  const seedList = [...new Set(s.hits.map((h) => h.seed))].sort((a, b) => a - b);
  console.log(`  (${s.x.toFixed(1)},${s.z.toFixed(1)})  seeds ${seedList.join(',')}  ${kinds.join(' | ')}`);
}
if (!sites.length) console.log('  no faults anywhere');
if (sites.some((s) => s.hits.some((h) => h.sev === 'x')))
  console.log('  note: a jam stops each car where it queued, so one blocked junction can smear into\n' +
    '        several STALLED sites along the approach. The honest unit is the junction being\n' +
    '        waited on, which is ahead of the furthest-along stall, not where the car stopped.');
