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
//
// A decked way fails on what the DECK does, not on the hill it sits on: its grade beyond the
// ground's own grade at the same step (a ramp may add at most 1-in-14 to a hill), a bridge deck that
// sags below the straight line between its banks (it followed the dip it should span), or a height
// step where decked ways meet at a node (walking each way on its own never crosses a joint, which is
// how a 6 m drop on the M60 slip road at Manchester went unseen).

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
const DECK_EXCESS = 0.07;   // what a ramp may add to the ground's own grade: 1-in-14, the UK design max
const SAG_LIMIT = 0.3;      // m a bridge deck may sit below the line between its banks

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
    let prevY = t0 + startDeck, prevG = t0, lastGrade = null, wg = 0, wk = 0, ws = 0, wsAt = null, wx = 0;
    for (let s = 0; s <= w.len; s += STEP) {
      const p = net.pointAt(w, s), y = heightAt(p[0], p[1], prevY), g = T.has ? T.heightAt(p[0], p[1]) : 0;
      if (prevY != null) {
        const dy = y - prevY, grade = dy / STEP;
        if (Math.abs(dy) > ws) { ws = Math.abs(dy); wsAt = [Math.round(p[0]), Math.round(p[1])]; }
        if (Math.abs(grade) > wg) wg = Math.abs(grade);
        if (lastGrade != null) { const k = Math.abs(grade - lastGrade); if (k > wk) wk = k; }
        lastGrade = grade;
        // how much steeper than the ground beneath it the road is here: the deck's own doing
        const x = (Math.abs(dy) - Math.abs(g - prevG)) / STEP;
        if (x > wx) wx = x;
      }
      prevY = y; prevG = g;
    }
    const name = w.name || w.ref || w.cls;
    if (wg > worstGrade.v) worstGrade = { v: wg, name, deck: w.hasDeck };
    if (wk > worstKink.v) worstKink = { v: wk, name, deck: w.hasDeck };
    if (ws > worstStep.v) worstStep = { v: ws, name, at: wsAt, deck: w.hasDeck };
    if (wg > GRADE_LIMIT || ws > STEP_LIMIT || (w.hasDeck && wx > DECK_EXCESS)) offenders.push({ name, cls: w.cls, grade: wg, step: ws, deck: w.hasDeck, excess: wx });
  }

  offenders.sort((a, b) => Math.max(b.grade / GRADE_LIMIT, b.step / STEP_LIMIT) - Math.max(a.grade / GRADE_LIMIT, a.step / STEP_LIMIT));
  // A deck is ours to keep smooth; the hill under it is the elevation data (Richard asked for real
  // hills). So a decked way fails only where the deck makes it steeper than its ground by more than
  // a ramp may; a steep way, decked or not, is otherwise reported as a hill and does not fail.
  const deckFaults = offenders.filter((o) => o.deck && o.excess > DECK_EXCESS);
  const hills = offenders.filter((o) => !(o.deck && o.excess > DECK_EXCESS));

  // bridge decks that sag below the straight line between their banks
  const sags = [];
  for (const w of net.ways.values()) {
    if (!w.deckH || !DRIVABLE.has(w.cls)) continue;
    const yAt = (s) => { const p = net.pointAt(w, s); return (T.has ? T.heightAt(p[0], p[1]) : 0) + net.deckAt(w, s); };
    const y0 = yAt(0), y1 = yAt(w.len);
    let worst = 0;
    for (let s = 0; s <= w.len; s += STEP) worst = Math.max(worst, y0 + ((y1 - y0) * s) / w.len - yAt(s));
    if (worst > SAG_LIMIT) sags.push({ name: w.name || w.ref || w.cls, sag: worst });
  }
  // height steps where decked ways meet: every way's own deck height at each node it shares
  const atNode = new Map();
  for (const w of net.ways.values()) {
    if (!DRIVABLE.has(w.cls)) continue;
    for (let i = 0; i < w.nodes.length; i++) {
      const n = w.nodes[i]; if (!n) continue;
      let a = atNode.get(n); if (!a) atNode.set(n, (a = []));
      a.push({ name: w.name || w.ref || w.cls, h: w.hasDeck ? net.deckAt(w, w.cum[i]) : 0, deck: w.hasDeck });
    }
  }
  const joints = [];
  for (const [n, a] of atNode) {
    if (a.length < 2 || !a.some((x) => x.deck)) continue;
    const hs = a.map((x) => x.h), d = Math.max(...hs) - Math.min(...hs);
    if (d > STEP_LIMIT) joints.push({ n, d, ways: a.map((x) => `${x.name} ${x.h.toFixed(1)}`).join(' / ') });
  }
  if (deckFaults.length || sags.length || joints.length) anyFail++;
  console.log(`\n== ${id}: ${ways} drivable ways (${decked} decked), terrain range ${T.has ? T.range.toFixed(1) : '0'} m`);
  console.log(`   max grade      ${(worstGrade.v * 100).toFixed(1)}%   (1-in-${(1 / worstGrade.v).toFixed(1)}) on ${worstGrade.name}${worstGrade.deck ? ' [deck]' : ''}`);
  console.log(`   max grade kink ${(worstKink.v * 100).toFixed(1)}%/step on ${worstKink.name}${worstKink.deck ? ' [deck]' : ''}`);
  console.log(`   worst step     ${worstStep.v.toFixed(2)} m on ${worstStep.name}${worstStep.deck ? ' [deck]' : ''}${worstStep.at ? ' @' + worstStep.at.join(',') : ''}`);
  console.log(`   ${deckFaults.length ? 'FAIL' : 'ok  '} ${deckFaults.length} DECK way(s) steeper than their ground by over ${DECK_EXCESS * 100}%; ${hills.length} steep hill(s) (real terrain, ok)`);
  for (const o of deckFaults.slice(0, 12)) console.log(`     deck ${o.cls.padEnd(14)} ${(o.grade * 100).toFixed(1).padStart(5)}%  +${(o.excess * 100).toFixed(1)}% over its ground  step ${o.step.toFixed(2)}m  ${o.name}`);
  console.log(`   ${sags.length ? 'FAIL' : 'ok  '} ${sags.length} bridge deck(s) sagging over ${SAG_LIMIT} m below their banks`);
  for (const o of sags.slice(0, 6)) console.log(`     sag ${o.sag.toFixed(2)} m  ${o.name}`);
  console.log(`   ${joints.length ? 'FAIL' : 'ok  '} ${joints.length} deck joint(s) with a step over ${STEP_LIMIT} m`);
  for (const o of joints.slice(0, 6)) console.log(`     node ${o.n}: ${o.d.toFixed(2)} m  ${o.ways}`);
  for (const o of hills.slice(0, 4)) console.log(`     hill ${o.cls.padEnd(14)} ${(o.grade * 100).toFixed(1).padStart(5)}%  step ${o.step.toFixed(2)}m  ${o.name}${o.deck ? ` [deck adds ${(o.excess * 100).toFixed(1)}%]` : ''}`);
}
console.log(anyFail ? `\n${anyFail} region(s) have rough DECKS` : '\nall decks smooth (steep spots are real hills)');
process.exit(anyFail ? 1 : 0);
