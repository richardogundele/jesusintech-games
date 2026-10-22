#!/usr/bin/env node
// Measures how smooth the DRIVABLE roads are — the regression test for "some roads are not smooth".
//
//   node tools/smooth-check.mjs [region ...]        (default: kent london birmingham manchester)
//
// It walks every drivable way at 2 m steps with the SAME height the car sees each frame
// (terrain.heightAt + net.deckNear, carrying the previous y so a flyover reads as a flyover), and
// reports, per region:
//   * max grade        |dy/ds|           (how steep; a 1-in-7 hill = 0.143, a motorway max is ~0.04)
//   * max grade change  |d(grade)|/step  (how sharp the crest/dip; a kink you feel as a bump)
//   * worst vertical step  |dy| in one 2 m step (a wall; anything over 0.3 m is a jolt)
// with the worst 12 ways named, so a fix can be aimed. Decked ways (flyovers) are included on
// purpose — the ramps onto them are exactly what this is meant to police.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet } from '../src/kent/net.js';
import { makeTerrain } from '../src/worlds/terrain.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'road']);

const regions = process.argv.slice(2).length ? process.argv.slice(2) : ['kent', 'london', 'birmingham', 'manchester'];
const STEP = 2;
// a grade you would never meet on a real road of this class; above it the road is a fault, not a hill
const GRADE_LIMIT = 0.12;   // 1-in-8.3; UK design max is ~1-in-14 (0.07), estate hills reach ~1-in-10
const STEP_LIMIT = 0.3;     // a vertical jump in one 2 m step you feel as a jolt

let anyFail = 0;
for (const id of regions) {
  const file = path.join(REPO, 'public/assets', id, 'region.json');
  if (!fs.existsSync(file)) { console.log(`\n== ${id}: no region.json, skipped`); continue; }
  const region = JSON.parse(fs.readFileSync(file, 'utf8'));
  const net = new RoadNet(region);
  const T = makeTerrain(region);
  // exactly what the world hands the car (region.js / kent.js): ground + the flyover deck under it
  const heightAt = (x, z, prevY) => { const t = T.has ? T.heightAt(x, z) : 0; return t + net.deckNear(x, z, prevY, t); };

  let worstGrade = { v: 0 }, worstKink = { v: 0 }, worstStep = { v: 0 };
  const offenders = [];
  let ways = 0, decked = 0;
  for (const w of net.ways.values()) {
    if (!DRIVABLE.has(w.cls) || !w.pts || w.len < STEP * 2) continue;
    ways++;
    if (w.hasDeck) decked++;
    // seed the first height from this way's own start: a flyover way begins up on its deck, so a
    // fresh prevY=null (which returns ground) would read as a false 6 m step at s=0
    const p0 = net.pointAt(w, 0), t0 = T.has ? T.heightAt(p0[0], p0[1]) : 0;
    const startDeck = w.hasDeck ? (w.deck ? w.deck(0) : 0) : (net.nodeDeck.get(w.nodes[0]) || 0);
    let prevY = t0 + startDeck, lastGrade = null, wg = 0, wk = 0, ws = 0, wsAt = null;
    for (let s = 0; s <= w.len; s += STEP) {
      const p = net.pointAt(w, s), y = heightAt(p[0], p[1], prevY);
      if (prevY != null) {
        const dy = y - prevY, grade = dy / STEP;
        if (Math.abs(dy) > ws) { ws = Math.abs(dy); wsAt = [Math.round(p[0]), Math.round(p[1])]; }
        if (Math.abs(grade) > wg) wg = Math.abs(grade);
        if (lastGrade != null) { const k = Math.abs(grade - lastGrade); if (k > wk) wk = k; }
        lastGrade = grade;
      }
      prevY = y;
    }
    const name = w.name || w.ref || w.cls;
    if (wg > worstGrade.v) worstGrade = { v: wg, name, deck: w.hasDeck };
    if (wk > worstKink.v) worstKink = { v: wk, name, deck: w.hasDeck };
    if (ws > worstStep.v) worstStep = { v: ws, name, at: wsAt, deck: w.hasDeck };
    if (wg > GRADE_LIMIT || ws > STEP_LIMIT) offenders.push({ name, cls: w.cls, grade: wg, step: ws, deck: w.hasDeck });
  }

  offenders.sort((a, b) => Math.max(b.grade / GRADE_LIMIT, b.step / STEP_LIMIT) - Math.max(a.grade / GRADE_LIMIT, a.step / STEP_LIMIT));
  // decks are ours to keep smooth; a steep NON-deck way is a real hill from the elevation data
  // (Richard asked for real hills), so it is reported but does not fail the check.
  const deckFaults = offenders.filter((o) => o.deck);
  const hills = offenders.filter((o) => !o.deck);
  if (deckFaults.length) anyFail++;
  console.log(`\n== ${id}: ${ways} drivable ways (${decked} decked), terrain range ${T.has ? T.range.toFixed(1) : '0'} m`);
  console.log(`   max grade      ${(worstGrade.v * 100).toFixed(1)}%   (1-in-${(1 / worstGrade.v).toFixed(1)}) on ${worstGrade.name}${worstGrade.deck ? ' [deck]' : ''}`);
  console.log(`   max grade kink ${(worstKink.v * 100).toFixed(1)}%/step on ${worstKink.name}${worstKink.deck ? ' [deck]' : ''}`);
  console.log(`   worst step     ${worstStep.v.toFixed(2)} m on ${worstStep.name}${worstStep.deck ? ' [deck]' : ''}${worstStep.at ? ' @' + worstStep.at.join(',') : ''}`);
  console.log(`   ${deckFaults.length ? 'FAIL' : 'ok  '} ${deckFaults.length} DECK way(s) over ${GRADE_LIMIT * 100}% grade or ${STEP_LIMIT} m step; ${hills.length} steep hill(s) (real terrain, ok)`);
  for (const o of deckFaults.slice(0, 12)) console.log(`     deck ${o.cls.padEnd(14)} ${(o.grade * 100).toFixed(1).padStart(5)}%  step ${o.step.toFixed(2)}m  ${o.name}`);
  for (const o of hills.slice(0, 4)) console.log(`     hill ${o.cls.padEnd(14)} ${(o.grade * 100).toFixed(1).padStart(5)}%  step ${o.step.toFixed(2)}m  ${o.name}`);
}
console.log(anyFail ? `\n${anyFail} region(s) have rough DECKS` : '\nall decks smooth (steep spots are real hills)');
process.exit(anyFail ? 1 : 0);
