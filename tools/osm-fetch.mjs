#!/usr/bin/env node
// Pulls the OpenStreetMap extract for a region (tools/regions.mjs) from the Overpass API and writes
// it in the shape tools/region-data.mjs (and kent-data.mjs) read:
//
//   node tools/osm-fetch.mjs <region> [--out scratch/osm/<region>] [--force]
//
// <out>/roads.json, roundabouts.json, features.json, raw/q4_buildings.json, raw/q5_landuse.json
// Every raw Overpass answer is cached in <out>/raw/, so a rerun only fetches what is missing.
// Public Overpass mirrors are busy and flaky: each query rotates through several with backoff.
// Built-ins only. Data © OpenStreetMap contributors, ODbL 1.0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, originOf, projector, bboxOf } from './regions.mjs';

const argv = process.argv.slice(2), opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; } else pos.push(a); }
const R = REGIONS[pos[0]];
if (!R) { console.error(`usage: node tools/osm-fetch.mjs <${Object.keys(REGIONS).join('|')}> [--out dir] [--force]`); process.exit(2); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(opt.out || path.join(REPO, 'scratch/osm', R.id));
const RAW = path.join(OUT, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const O = originOf(R), project = projector(O), BBOX = bboxOf(R);
const r1 = (v) => Math.round(v * 10) / 10;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'jesusintech-games/1.0 (driving-test game map bake; ogundelerichard27@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** run one Overpass query (cached by name); rotates mirrors with exponential backoff */
async function overpass(name, ql) {
  const file = path.join(RAW, `${name}.json`);
  if (!opt.force && fs.existsSync(file)) { const j = JSON.parse(fs.readFileSync(file, 'utf8')); console.log(`${name}: cached (${j.elements.length} elements)`); return j; }
  const data = `[out:json][timeout:240][maxsize:1073741824][bbox:${BBOX}];\n${ql}`;
  let wait = 3000;
  for (let attempt = 0; attempt < 18; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    const t0 = Date.now();
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 300000);
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(data), signal: ctl.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      const j = JSON.parse(text);
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
      fs.writeFileSync(file, text);
      console.log(`${name}: ${j.elements.length} elements from ${new URL(url).host} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${(text.length / 1e6).toFixed(1)} MB)`);
      return j;
    } catch (e) {
      console.log(`${name}: attempt ${attempt + 1} on ${new URL(url).host} failed after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${String(e.message || e).slice(0, 140)}; waiting ${wait / 1000} s`);
      await sleep(wait); wait = Math.min(wait * 1.6, 90000);
    }
  }
  throw new Error(`${name}: every Overpass attempt failed`);
}

const HW = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const roadsQ = `way["highway"~"^(${HW})$"]["area"!="yes"];\nout geom;`;
const featQ = `(\n  node["highway"~"^(traffic_signals|give_way|stop|mini_roundabout|crossing)$"];\n  node["railway"~"^(level_crossing|crossing)$"];\n  node["crossing"];\n);\nout body;`;
const landQ = `(\n  node["name"]["amenity"~"^(place_of_worship|school|college|university|hospital|pub|fuel|police|fire_station|library|townhall|cinema|theatre|bank|cafe|restaurant|fast_food|pharmacy|community_centre|post_office)$"];\n  way["name"]["amenity"~"^(place_of_worship|school|college|university|hospital|pub|fuel|police|fire_station|library|townhall|cinema|theatre|community_centre)$"];\n  nwr["name"]["shop"~"^(supermarket|department_store|mall)$"];\n  nwr["name"]["railway"~"^(station|halt)$"];\n  nwr["name"]["leisure"~"^(park|sports_centre|stadium|golf_course)$"];\n  nwr["name"]["tourism"~"^(attraction|museum|hotel)$"];\n  node["place"~"^(city|town|suburb|neighbourhood|quarter|village|borough)$"];\n);\nout center;`;
const buildQ = `way["building"];\nout geom;`;
const landuseQ = `(\n  way["landuse"];\n  way["leisure"~"^(park|pitch|garden|golf_course|playground|nature_reserve|common|recreation_ground)$"];\n  way["natural"~"^(water|wood|scrub|heath|grassland|beach)$"];\n);\nout geom;`;
const linesQ = `(\n  way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge)$"]["service"!~"."];\n  way["waterway"~"^(river|canal|stream)$"];\n);\nout geom;`;
// car parks to practise the manoeuvres in, plus the street furniture that earns a sign
const parkQ = `(\n  way["amenity"="parking"];\n  way["leisure"="park"]["name"];\n);\nout geom;`;
const furnitureQ = `(\n  node["highway"="bus_stop"];\n  node["amenity"="parking_entrance"];\n  node["highway"="street_lamp"]["ref"];\n);\nout body;`;

const roadsJ = await overpass('q1_roads', roadsQ);
const featJ = await overpass('q2_features', featQ);
const landJ = await overpass('q3_landmarks', landQ);
await overpass('q4_buildings', buildQ);
const luJ = await overpass('q5_landuse', landuseQ);
const linesJ = await overpass('q6_lines', linesQ); // region-data.mjs reads raw/q5_landuse.json as the landuse file
const parkJ = await overpass('q7_parking', parkQ);
const furnJ = await overpass('q8_furniture', furnitureQ);

// ---------- roads.json ----------
const mph = (s) => { if (!s) return null; const m = String(s).match(/([\d.]+)\s*(mph)?/i); if (!m) return null; const v = parseFloat(m[1]); return m[2] ? v : Math.round(v / 1.609344); };
const RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, living_street: 7, service: 8 };
const nodeWays = new Map(); // osm node id -> [way ids]
const ways = [];
for (const e of roadsJ.elements) {
  if (e.type !== 'way' || !e.geometry || !e.nodes || e.nodes.length < 2) continue;
  const t = e.tags || {}, cls = t.highway;
  if (cls === 'service' && !t.name) continue; // unnamed service: car parks, driveways
  if (t.access === 'private' && cls === 'service') continue;
  let pts = e.geometry.map((g) => project(g.lat, g.lon).map(r1)), nodes = e.nodes.slice();
  const rb = t.junction === 'roundabout' || t.junction === 'circular';
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1' || rb || cls === 'motorway' || cls === 'motorway_link';
  if (t.oneway === '-1') { pts.reverse(); nodes.reverse(); }
  const lanesTag = parseInt(t.lanes, 10) || 0, lf = parseInt(t['lanes:forward'], 10) || 0, lb = parseInt(t['lanes:backward'], 10) || 0;
  let lanes_fwd, lanes_bwd, lanes_src;
  if (oneway) { lanes_fwd = lanesTag || 1; lanes_bwd = 0; lanes_src = lanesTag ? 'tag' : 'oneway'; }
  else if (lf || lb) { lanes_fwd = lf || Math.max(1, lanesTag - lb); lanes_bwd = lb || Math.max(1, lanesTag - lf); lanes_src = 'tag'; }
  else if (lanesTag) { lanes_fwd = Math.max(1, Math.round(lanesTag / 2)); lanes_bwd = Math.max(1, lanesTag - lanes_fwd); lanes_src = 'half'; }
  else { lanes_fwd = 1; lanes_bwd = 1; lanes_src = 'derived'; }
  const ms = t.maxspeed, nsl = /national|none/i.test(ms || '') || /nsl/i.test(t['maxspeed:type'] || '');
  const maxspeed_mph = nsl ? null : mph(ms);
  const link = /_link$/.test(cls);
  const base = cls.replace(/_link$/, '');
  for (const n of nodes) { if (!nodeWays.has(n)) nodeWays.set(n, []); nodeWays.get(n).push(e.id); }
  ways.push({
    id: e.id, name: t.name || null, ref: t.ref || null, class: cls, pts, nodes, oneway, roundabout: rb,
    lanes_fwd, lanes_bwd, lanes_src, maxspeed_mph, maxspeed_src: maxspeed_mph != null ? 'tag' : null, nsl,
    sidewalk: t.sidewalk || null, lit: t.lit || null,
    turn_lanes: t['turn:lanes'] || t['turn:lanes:forward'] ? { all: t['turn:lanes'] || null, fwd: t['turn:lanes:forward'] || null } : null,
    dual: oneway && !rb && !link && ['trunk', 'primary', 'secondary'].includes(base) && t.oneway !== undefined, link,
    bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no', layer: parseInt(t.layer, 10) || 0,
    width_m: parseFloat(t.width) > 2 ? parseFloat(t.width) : null,
  });
}
fs.writeFileSync(path.join(OUT, 'roads.json'), JSON.stringify({ osm_base: roadsJ.osm3s?.timestamp_osm_base || null, bbox: BBOX, ways }));

// ---------- roundabouts.json: rings from junction=roundabout ways sharing nodes ----------
const sigSet = new Set(featJ.elements.filter((e) => e.tags?.highway === 'traffic_signals').map((e) => e.id));
const parent = new Map(); const find = (a) => { while (parent.has(a) && parent.get(a) !== a) a = parent.get(a); return a; }; const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
const rbWays = ways.filter((w) => w.roundabout);
const nodeRing = new Map();
for (const w of rbWays) { parent.set(w.id, parent.get(w.id) ?? w.id); for (const n of w.nodes) { if (nodeRing.has(n)) union(w.id, nodeRing.get(n)); else nodeRing.set(n, w.id); } }
const rings = new Map();
for (const w of rbWays) { const k = find(w.id); if (!rings.has(k)) rings.set(k, []); rings.get(k).push(w); }
const roundabouts = [];
for (const [k, list] of rings) {
  const pts = list.flatMap((w) => w.pts);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const radius = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
  const lanesTags = list.map((w) => (w.lanes_src === 'tag' ? w.lanes_fwd : 0)).filter(Boolean);
  const best = list.slice().sort((a, b) => (RANK[a.class.replace(/_link$/, '')] ?? 9) - (RANK[b.class.replace(/_link$/, '')] ?? 9))[0];
  roundabouts.push({ id: 'rb' + k, name: list.find((w) => w.name)?.name || `Roundabout ${roundabouts.length + 1}`, mini: false, ways: list.map((w) => w.id), radius_m: r1(radius), x: r1(cx), z: r1(cz),
    signals: list.some((w) => w.nodes.some((n) => sigSet.has(n))), lanes: lanesTags.length ? Math.max(...lanesTags) : null, lanes_src: lanesTags.length ? 'tag' : 'estimate', highest_class: best.class.replace(/_link$/, ''), arm_detail: [] });
}
fs.writeFileSync(path.join(OUT, 'roundabouts.json'), JSON.stringify({ roundabouts }));

// ---------- features.json ----------
const F = { signals: [], give_ways: [], stops: [], mini_roundabouts: [], level_crossings: [], crossings: [], railways: [], rivers: [], coastline: [], sea_polygon: [], landmarks: [], test_centres: [], places: [], parking: [], bus_stops: [] };
for (const e of featJ.elements) {
  if (e.type !== 'node') continue;
  const t = e.tags || {}, [x, z] = project(e.lat, e.lon).map(r1);
  if (t.highway === 'traffic_signals') F.signals.push({ id: e.id, x, z });
  else if (t.highway === 'give_way') F.give_ways.push({ id: e.id, x, z });
  else if (t.highway === 'stop') F.stops.push({ id: e.id, x, z });
  else if (t.highway === 'mini_roundabout') F.mini_roundabouts.push({ id: e.id, x, z, direction: t.direction || 'clockwise', name: t.name || null });
  else if (t.railway === 'level_crossing') F.level_crossings.push({ id: e.id, x, z, type: 'level_crossing', barrier: t['crossing:barrier'] || null });
  else if (t.highway === 'crossing' || t.crossing) {
    if (t.crossing === 'no') continue;
    F.crossings.push({ id: e.id, x, z, crossing: t.crossing || null, crossing_ref: t.crossing_ref || null, type: t.crossing || null, ways: nodeWays.get(e.id) || [] });
  }
}
const lineOut = (e) => ({ name: e.tags?.name || null, pts: e.geometry.map((g) => project(g.lat, g.lon).map(r1)) });
for (const e of linesJ.elements) { if (e.type !== 'way' || !e.geometry) continue; if (e.tags?.railway) F.railways.push(lineOut(e)); else if (e.tags?.waterway) F.rivers.push(lineOut(e)); }
const CAT = (t) => t.amenity === 'place_of_worship' ? 'church' : t.amenity === 'fuel' ? 'fuel' : t.shop ? 'supermarket' : t.railway ? 'station' : t.amenity || t.leisure || t.tourism || 'other';
const RANKP = { city: 1, town: 1, borough: 2, suburb: 2, village: 2, quarter: 3, neighbourhood: 3 };
for (const e of landJ.elements) {
  const t = e.tags || {}; if (!t.name) continue;
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (lat == null) continue;
  const [x, z] = project(lat, lon).map(r1);
  if (t.place) { F.places.push({ name: t.name, x, z, rank: RANKP[t.place] || 3, r: t.place === 'suburb' || t.place === 'town' ? 700 : 400 }); continue; }
  F.landmarks.push({ name: t.name, category: CAT(t), x, z, brand: t.brand || null, operator: t.operator || null });
}
{
  const tc = R.testCentre, [x, z] = project(tc.lat, tc.lon).map(r1);
  F.test_centres.push({ name: tc.name, x, z, address: tc.address });
}
// car parks: the polygon plus the tags that decide whether we can lay bays in it
for (const e of parkJ.elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
  const t = e.tags || {};
  if (t.amenity !== 'parking') continue;
  if (t.parking === 'multi-storey' || t.parking === 'underground') continue; // we only build surface lots
  if (t.access === 'private' || t.access === 'no') continue;
  let pts = e.geometry.map((gg) => project(gg.lat, gg.lon).map(r1));
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) continue;
  F.parking.push({ name: t.name || null, pts, surface: t.surface || null, capacity: parseInt(t.capacity, 10) || null, fee: t.fee === 'yes' });
}
for (const e of furnJ.elements) {
  if (e.type !== 'node') continue;
  const t = e.tags || {}, [x, z] = project(e.lat, e.lon).map(r1);
  if (t.highway === 'bus_stop') F.bus_stops.push({ id: e.id, x, z, name: t.name || null, shelter: t.shelter === 'yes' });
}
fs.writeFileSync(path.join(OUT, 'features.json'), JSON.stringify(F));
console.log(`\n${R.name}: ${ways.length} road ways, ${roundabouts.length} roundabouts, ${F.signals.length} signals, ${F.crossings.length} crossings, ${F.mini_roundabouts.length} minis, ${F.railways.length} railways, ${F.rivers.length} rivers, ${F.landmarks.length} landmarks, ${F.places.length} places, ${F.parking.length} car parks, ${F.bus_stops.length} bus stops, ${luJ.elements.length} landuse ways -> ${OUT}`);
