// Procedural UK road signs and road-marking decals for the Kent world.
// Everything is drawn on 2D canvases from the TSRGD 2016 geometry in signdata.js
// (mm on the working-drawing reference size), then handed to three.js as textures
// on cut-out faces. The Transport typeface is not freely licensed, so legends use a
// bold humanist sans from the CSS font stack with the cap height forced to
// 1.4 x-height, which keeps the spec's x-heights and tile layout exact.
// UK traffic sign designs are Crown copyright, reproduced under the OGL v3.0.
import * as THREE from 'three';
import { SIGNS, SIGN_LIST, PALETTE, BANDS, CROSS_SECTIONS, byDiagram } from './signdata.js';

export { SIGNS, SIGN_LIST, PALETTE, BANDS, CROSS_SECTIONS, byDiagram };

const DEG = Math.PI / 180;

// ---------- colours ----------
// `fill` names in the catalogue resolve through the DfT palette; 'border' / 'bg'
// resolve through the sign currently being drawn.
function colour(name, sign = {}) {
  if (!name) return PALETTE.black;
  if (name.startsWith('#')) return name;
  if (name === 'border' || name === 'border colour') return sign.border || PALETTE.white;
  if (name === 'bg') return sign.bg || PALETTE.white;
  return PALETTE[name] || name;
}

// background / border / legend / route-number colours for each route status
const STATUS = {
  primary: { bg: PALETTE.green, border: PALETTE.white, legend: PALETTE.white, route: PALETTE.yellow, font: 'medium' },
  nonprimary: { bg: PALETTE.white, border: PALETTE.black, legend: PALETTE.black, route: PALETTE.black, font: 'heavy' },
  motorway: { bg: PALETTE.blue, border: PALETTE.white, legend: PALETTE.white, route: PALETTE.white, font: 'medium' },
  tourist: { bg: PALETTE.brown, border: PALETTE.white, legend: PALETTE.white, route: PALETTE.white, font: 'medium' },
  local: { bg: PALETTE.white, border: PALETTE.black, legend: PALETTE.black, route: PALETTE.black, font: 'heavy' },
};
const statusOf = (s) => STATUS[s] || STATUS.nonprimary;
const isDark = (st) => st.bg !== PALETTE.white;

// ---------- fonts ----------
// Transport Medium is used white-on-dark, Transport Heavy black-on-white. The real faces
// are not bundled, so a bold humanist sans stands in; the Motorway alphabet (route
// numbers on blue signs) is narrower and taller, faked by squeezing the same face. If the
// OGL TrueType files from Roads.org.uk are ever declared with @font-face under these
// names, signsReady() switches to them.
const FALLBACK = '"Overpass", "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const FONTS = {
  // the fallback sans is narrower than Transport, so it is widened 6% (spec section 6, option 2)
  medium: { weight: 600, family: `"Transport Medium", ${FALLBACK}`, squeeze: 1.06, real: 'Transport Medium' },
  heavy: { weight: 800, family: `"Transport Heavy", ${FALLBACK}`, squeeze: 1.06, real: 'Transport Heavy' },
  motorway: { weight: 700, family: `"Motorway Permanent", ${FALLBACK}`, squeeze: 0.84, real: 'Motorway Permanent' },
};
function fontOf(name) {
  if (name === 'TransportHeavy') return FONTS.heavy;
  if (name === 'TransportMedium') return FONTS.medium;
  return FONTS[name] || FONTS.medium;
}
let measureCtx = null;
function mctx() {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}
const capCache = new Map();
// cap height / font size, measured once per face so cap height = 1.4 x-height holds for any fallback font
function capRatio(f) {
  const key = `${f.weight}|${f.family}`;
  if (!capCache.has(key)) {
    const m = mctx();
    m.font = `${f.weight} 200px ${f.family}`;
    const asc = m.measureText('H').actualBoundingBoxAscent;
    capCache.set(key, (asc > 50 ? asc : 144) / 200);
  }
  return capCache.get(key);
}
// font strings are in user-space units, and the canvas transform is in mm, so sizes here are mm
function setFont(ctx, f, capMm) {
  ctx.font = `${f.weight} ${(capMm / capRatio(f)).toFixed(2)}px ${f.family}`;
}
function textW(s, f, capMm) {
  const m = mctx();
  setFont(m, f, capMm);
  return m.measureText(s).width * f.squeeze;
}
/** Draw `s` with its baseline at (x, y). `flip` for y-up frames; `stretch` for elongated road legends. */
function drawText(ctx, s, x, y, { f = FONTS.medium, cap, fill = '#000', align = 'left', flip = false, stretch = 1 }) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(1, -1);
  ctx.scale(f.squeeze, stretch);
  setFont(ctx, f, cap);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fill;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

// ---------- canvases ----------
// Power-of-two canvases (mipmaps), uniform scale, the sign centred. ~0.85 px/mm puts a
// 600 mm roundel on 512 px, which is crisp at any distance the game shows it from.
// (The spec asks for 2 px/mm; that would quadruple texture memory for ~60 catalogue signs,
// so `detail` is the knob for close-range signs instead.)
const RES = 0.85;
const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
// direction signs are metres wide but read from 30-100 m: 1024 px is plenty (16 MB at 2048)
const dirMaxPx = (detail) => Math.min(2048, 1024 * detail);
function newCanvas(wMm, hMm, detail = 1, maxPx = 2048) {
  const W = Math.min(maxPx, pow2(wMm * RES * detail));
  const H = Math.min(maxPx, pow2(hMm * RES * detail));
  const k = Math.min(W / wMm, H / hMm);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const ox = (W - wMm * k) / 2, oy = (H - hMm * k) / 2;
  // UV rectangle of the sign's bounding box inside the canvas (v measured from the bottom)
  const box = { u0: ox / W, u1: (ox + wMm * k) / W, v0: 1 - (oy + hMm * k) / H, v1: 1 - oy / H };
  return { c, ctx, k, W, H, ox, oy, wMm, hMm, box };
}
function finish(cv, extra = {}) {
  const tex = new THREE.CanvasTexture(cv.c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData = { wMm: cv.wMm, hMm: cv.hMm, box: cv.box, ...extra };
  return tex;
}

// JSON with object keys sorted at every level, so `{ band, ...spec }` and `{ ...spec, band }`
// hit the same cache entry (the call sites build option objects in different orders)
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
/** Tiny cache so every id + opts combination is drawn once. */
export class TextureCache {
  constructor() { this.map = new Map(); }
  get(kind, id, opts, make) {
    const key = `${kind}|${id}|${canon(opts || {})}`;
    if (!this.map.has(key)) this.map.set(key, make());
    return this.map.get(key);
  }
  clear() { for (const t of this.map.values()) t.dispose?.(); this.map.clear(); }
}
const cache = new TextureCache();

// ---------- path helpers (mm, current transform) ----------
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
function rrectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function polyPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}
/** Closed polygon with a radius per vertex (number or array); starts mid-edge so every corner gets arcTo. */
function roundedPoly(ctx, pts, r) {
  const n = pts.length;
  const rad = (i) => (Array.isArray(r) ? r[i] || 0 : r);
  ctx.beginPath();
  ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], ri = rad(i);
    if (ri > 0) ctx.arcTo(p[0], p[1], q[0], q[1], ri); else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}
/**
 * Outline of a thick polyline with mitred corners, so a bend can have different outer and
 * inner corner radii (the working drawings give e.g. 60r outside, 20r inside).
 */
function barOutline(pts, w, rOuter = 0, rInner = 0) {
  const n = pts.length, dirs = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
    dirs.push([dx / l, dy / l]);
  }
  const L = [], R = [], rl = [], rr = [];
  for (let i = 0; i < n; i++) {
    const d1 = dirs[Math.max(0, i - 1)], d2 = dirs[Math.min(n - 2, i)];
    const n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const len = (w / 2) / Math.max(0.2, mx * n1[0] + my * n1[1]);
    L.push([pts[i][0] + mx * len, pts[i][1] + my * len]);
    R.push([pts[i][0] - mx * len, pts[i][1] - my * len]);
    const cr = i === 0 || i === n - 1 ? 0 : d1[0] * d2[1] - d1[1] * d2[0];
    rl.push(cr > 0 ? rInner : cr < 0 ? rOuter : 0);
    rr.push(cr > 0 ? rOuter : cr < 0 ? rInner : 0);
  }
  return { pts: [...L, ...R.reverse()], radii: [...rl, ...rr.reverse()] };
}
function fillBar(ctx, pts, w, rOuter, rInner, fill) {
  const o = barOutline(pts, w, rOuter, rInner);
  roundedPoly(ctx, o.pts, o.radii);
  ctx.fillStyle = fill;
  ctx.fill();
}
/** Straight arrow centred on (cx, cy): tail at -len/2, tip at +len/2 along `ang` (radians, canvas frame). */
function arrowPoly(cx, cy, ang, len, headW, headL, shaftW) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (a, b) => [cx + a * c - b * s, cy + a * s + b * c];
  const h = len / 2;
  return [P(h, 0), P(h - headL, headW / 2), P(h - headL, shaftW / 2), P(-h, shaftW / 2), P(-h, -shaftW / 2), P(h - headL, -shaftW / 2), P(h - headL, -headW / 2)];
}
// P500 warning triangle outline: base on y = 0, apex towards +y, corners rounded 0.075H
function triPath(ctx, H) {
  const L = 1.2417 * H, r = 0.075 * H;
  const A = [-L / 2, 0], B = [L / 2, 0], Cc = [0, (L * Math.sqrt(3)) / 2];
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arcTo(B[0], B[1], Cc[0], Cc[1], r);
  ctx.arcTo(Cc[0], Cc[1], A[0], A[1], r);
  ctx.arcTo(A[0], A[1], B[0], B[1], r);
  ctx.closePath();
}
function triInnerPath(ctx, H) {
  const S = 0.895 * H, b = 0.1 * H;
  polyPath(ctx, [[-S / 2, b], [S / 2, b], [0, b + (S * Math.sqrt(3)) / 2]]);
}
function octPath(ctx, D, inset = 0) {
  const Rc = (D / 2 - inset) / Math.cos(Math.PI / 8);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Rc * Math.cos(a), y = Rc * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// ---------- pictograms (y up, mm, feet on y = 0) ----------
// Limbs are round-capped strokes and bodies filled polygons: the same construction as
// the DfT silhouettes read at sign distance, without tracing the S-series drawings.
function limb(ctx, pts, w, fill) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = fill;
  ctx.stroke();
}
function dot(ctx, x, y, r, fill) { circle(ctx, x, y, r); ctx.fillStyle = fill; ctx.fill(); }
function fillPoly(ctx, pts, fill) { polyPath(ctx, pts); ctx.fillStyle = fill; ctx.fill(); }

// 545: two children running left to right, the taller girl leading (box 336 x 280, centre x = -20)
function pictChildren(ctx, ink) {
  // girl, leading
  dot(ctx, 72, 250, 26, ink);
  fillPoly(ctx, [[48, 218], [92, 214], [98, 162], [52, 166]], ink);
  fillPoly(ctx, [[50, 166], [100, 160], [116, 106], [34, 112]], ink); // skirt
  limb(ctx, [[90, 206], [122, 190], [142, 164]], 20, ink); // front arm
  limb(ctx, [[52, 206], [24, 172], [8, 152]], 20, ink); // back arm, to the boy's hand
  limb(ctx, [[96, 112], [128, 70], [120, 12]], 26, ink); // front leg
  limb(ctx, [[116, 10], [150, 10]], 16, ink);
  limb(ctx, [[50, 112], [20, 70], [0, 38]], 26, ink); // trailing leg, lifted
  limb(ctx, [[-2, 34], [-30, 42]], 16, ink);
  // boy, following
  dot(ctx, -84, 206, 24, ink);
  fillPoly(ctx, [[-106, 182], [-62, 176], [-54, 112], [-100, 114]], ink);
  limb(ctx, [[-62, 172], [-30, 160], [-4, 150]], 20, ink); // holding hands
  limb(ctx, [[-100, 172], [-126, 150], [-120, 120]], 20, ink);
  limb(ctx, [[-60, 114], [-30, 72], [-44, 12]], 24, ink);
  limb(ctx, [[-50, 10], [-18, 10]], 16, ink);
  limb(ctx, [[-98, 114], [-136, 76], [-150, 44]], 24, ink);
  limb(ctx, [[-152, 40], [-180, 54]], 16, ink);
}
// 544.1: adult and child hand in hand, facing the driver (box 234 x 364, 150 to the right of centre)
function pictPedestrians(ctx, ink) {
  dot(ctx, 85, 338, 26, ink);
  rrectPath(ctx, 48, 186, 74, 122, 22); ctx.fillStyle = ink; ctx.fill();
  limb(ctx, [[116, 296], [124, 202]], 22, ink);
  limb(ctx, [[54, 296], [32, 214]], 22, ink);
  limb(ctx, [[70, 196], [66, 18]], 28, ink);
  limb(ctx, [[100, 196], [104, 18]], 28, ink);
  limb(ctx, [[52, 10], [74, 10]], 16, ink);
  limb(ctx, [[96, 10], [120, 10]], 16, ink);
  // child in a dress, arm up to the adult's hand
  dot(ctx, -45, 206, 22, ink);
  fillPoly(ctx, [[-64, 186], [-26, 186], [-10, 94], [-80, 94]], ink);
  limb(ctx, [[-30, 180], [2, 204], [28, 212]], 18, ink);
  limb(ctx, [[-60, 180], [-74, 122]], 18, ink);
  limb(ctx, [[-54, 96], [-54, 18]], 20, ink);
  limb(ctx, [[-36, 96], [-36, 18]], 20, ink);
  limb(ctx, [[-66, 10], [-46, 10]], 14, ink);
  limb(ctx, [[-44, 10], [-24, 10]], 14, ink);
}
// 950: bicycle in side view, handlebars to the right (box 374 x 220, wheels 140 dia, ring 22).
// `bg` null means a transparent decal: holes are cut instead of painted.
function hole(ctx, bg, draw) {
  ctx.save();
  if (bg) ctx.fillStyle = bg; else ctx.globalCompositeOperation = 'destination-out';
  draw();
  ctx.fill();
  ctx.restore();
}
function pictBicycle(ctx, ink, bg) {
  for (const x of [-117, 117]) {
    circle(ctx, x, 70, 70); ctx.fillStyle = ink; ctx.fill();
    hole(ctx, bg, () => circle(ctx, x, 70, 48));
  }
  limb(ctx, [[-117, 70], [-40, 190]], 18, ink); // seat stay + seat tube line
  limb(ctx, [[-40, 190], [0, 70]], 18, ink); // seat tube to the bottom bracket
  limb(ctx, [[-117, 70], [0, 70]], 16, ink); // chain stay
  limb(ctx, [[-36, 184], [84, 184]], 18, ink); // top tube
  limb(ctx, [[84, 184], [0, 70]], 18, ink); // down tube
  limb(ctx, [[90, 196], [117, 70]], 18, ink); // fork
  limb(ctx, [[66, 206], [106, 190]], 16, ink); // handlebar
  limb(ctx, [[-64, 198], [-22, 198]], 14, ink); // saddle
  circle(ctx, 0, 70, 22); ctx.fillStyle = ink; ctx.fill();
  hole(ctx, bg, () => circle(ctx, 0, 70, 10));
  limb(ctx, [[0, 70], [20, 42]], 10, ink); limb(ctx, [[12, 40], [30, 40]], 12, ink); // pedals
  limb(ctx, [[0, 70], [-20, 98]], 10, ink); limb(ctx, [[-30, 100], [-12, 100]], 12, ink);
}
// 544: pedestrian striding right over the striped crossing
function pictZebraWalker(ctx, ink, bg) {
  for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? bg : ink; ctx.fillRect(-130 + i * 52, 0, 52, 30); }
  ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.strokeRect(-130, 0, 260, 30);
  dot(ctx, 6, 274, 26, ink);
  fillPoly(ctx, [[-22, 246], [30, 246], [36, 150], [-14, 150]], ink);
  limb(ctx, [[24, 238], [52, 202], [62, 170]], 20, ink);
  limb(ctx, [[-14, 238], [-40, 202], [-30, 176]], 20, ink);
  limb(ctx, [[24, 152], [62, 100], [70, 44]], 26, ink);
  limb(ctx, [[62, 38], [98, 38]], 16, ink);
  limb(ctx, [[-8, 152], [-42, 100], [-62, 50]], 26, ink);
  limb(ctx, [[-66, 46], [-94, 56]], 16, ink);
}
// 557: car seen from behind, skidding, over two crossing skid marks (box ~300 x 300)
function pictSkid(ctx, ink, bg) {
  ctx.save();
  ctx.translate(0, 205);
  ctx.rotate(-14 * DEG);
  rrectPath(ctx, -100, -50, 200, 100, 22); ctx.fillStyle = ink; ctx.fill();
  rrectPath(ctx, -70, 30, 140, 70, 18); ctx.fill(); // roof
  rrectPath(ctx, -56, 40, 112, 44, 8); ctx.fillStyle = bg; ctx.fill(); // rear window
  ctx.fillStyle = ink;
  ctx.fillRect(-92, -78, 40, 32); ctx.fillRect(52, -78, 40, 32); // wheels
  ctx.restore();
  ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.strokeStyle = ink;
  ctx.beginPath(); ctx.moveTo(-82, 118); ctx.bezierCurveTo(-60, 70, -10, 60, 20, 40); ctx.bezierCurveTo(50, 20, 60, 10, 70, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72, 118); ctx.bezierCurveTo(50, 80, 10, 70, -20, 46); ctx.bezierCurveTo(-50, 24, -62, 12, -76, 2); ctx.stroke();
}
// tourist symbols (white on brown), drawn in a unit box 0..1, y up; openings painted in `bg`
function pictCathedral(ctx, ink, bg) {
  ctx.fillStyle = ink;
  for (const x of [0.04, 0.72]) { // twin west towers with pinnacles
    ctx.fillRect(x, 0, 0.24, 0.7);
    fillPoly(ctx, [[x, 0.7], [x + 0.24, 0.7], [x + 0.12, 0.98]], ink);
    ctx.fillRect(x - 0.02, 0.68, 0.04, 0.16); ctx.fillRect(x + 0.22, 0.68, 0.04, 0.16);
  }
  fillPoly(ctx, [[0.28, 0], [0.72, 0], [0.72, 0.52], [0.5, 0.72], [0.28, 0.52]], ink); // nave gable
  ctx.fillStyle = bg;
  circle(ctx, 0.5, 0.52, 0.07); ctx.fill(); // rose window
  ctx.beginPath(); ctx.moveTo(0.42, 0); ctx.lineTo(0.42, 0.22); ctx.arc(0.5, 0.22, 0.08, Math.PI, 0, true); ctx.lineTo(0.58, 0); ctx.closePath(); ctx.fill(); // door
  for (const x of [0.1, 0.78]) { ctx.beginPath(); ctx.moveTo(x, 0.2); ctx.lineTo(x, 0.5); ctx.arc(x + 0.06, 0.5, 0.06, Math.PI, 0, true); ctx.lineTo(x + 0.12, 0.2); ctx.closePath(); ctx.fill(); }
}
function pictPier(ctx, ink) {
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0.5, 1, 0.08); // deck
  for (const x of [0.12, 0.36, 0.6, 0.84]) ctx.fillRect(x, 0.2, 0.05, 0.3); // piles
  rrectPath(ctx, 0.62, 0.58, 0.34, 0.2, 0.03); ctx.fill(); // pavilion at the sea end
  fillPoly(ctx, [[0.6, 0.78], [0.98, 0.78], [0.79, 0.96]], ink);
  ctx.lineWidth = 0.06; ctx.lineCap = 'round'; ctx.strokeStyle = ink;
  ctx.beginPath(); // waves
  for (let i = 0; i < 3; i++) { const x = i * 0.34; ctx.moveTo(x, 0.1); ctx.quadraticCurveTo(x + 0.085, 0.2, x + 0.17, 0.1); ctx.quadraticCurveTo(x + 0.255, 0, x + 0.34, 0.1); }
  ctx.stroke();
}
function pictogram(ctx, name, size, ink, bg) {
  ctx.save();
  ctx.scale(size, size);
  if (name === 'cathedral') pictCathedral(ctx, ink, bg); else pictPier(ctx, ink);
  ctx.restore();
}

// ---------- symbols ----------
// Three curved arrows chasing clockwise (510). Each segment is cut square on a radial at its
// trailing end and tapers to a point on the mid radius at its leading end, as on WD P510
// (tips on the 0/120/240 radials, the next cut 8 degrees further round).
function arcArrows510(ctx, cx, cy, R, r, cutsDeg, gapDeg, fill) {
  const mid = (R + r) / 2, tipLen = 23;
  // y-up frame: bearing b clockwise from the top is angle (90 - b)
  const P = (rad, b) => [cx + rad * Math.cos((90 - b) * DEG), cy + rad * Math.sin((90 - b) * DEG)];
  ctx.fillStyle = fill;
  for (let i = 0; i < cutsDeg.length; i++) {
    const a0 = cutsDeg[i];
    let a1 = cutsDeg[(i + 1) % cutsDeg.length];
    if (a1 <= a0) a1 += 360;
    const tip = a1 - gapDeg;
    const bo = tip - (tipLen / R) / DEG, bi = tip - (tipLen / r) / DEG;
    ctx.beginPath();
    ctx.arc(cx, cy, R, (90 - a0) * DEG, (90 - bo) * DEG, true);
    ctx.lineTo(...P(mid, tip));
    ctx.lineTo(...P(r, bi));
    ctx.arc(cx, cy, r, (90 - bi) * DEG, (90 - a0) * DEG, false);
    ctx.closePath();
    ctx.fill();
  }
}
// 611.1 mini-roundabout: three 40 mm shafts on r = 190 with 120 x 60 chevron heads, clockwise;
// each arrow spans 90 degrees from 15/135/255 with 30 degree gaps (WD P611.1)
function arcArrows611(ctx, p, fill) {
  const rc = 190, w = 40, span = p.segmentSpanDeg || 90, start = p.firstSegmentStartDeg ?? 15;
  const P = (rad, b) => [rad * Math.cos((90 - b) * DEG), rad * Math.sin((90 - b) * DEG)];
  for (let k = 0; k < 3; k++) {
    const tail = start + k * 120, tipB = tail + span;
    const headSpan = (120 / rc) / DEG; // the head is 120 mm deep along the shaft
    ctx.beginPath();
    ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.strokeStyle = fill;
    ctx.arc(0, 0, rc, (90 - tail) * DEG, (90 - (tipB - headSpan * 0.5)) * DEG, true);
    ctx.stroke();
    // head axis runs from the shaft's outer arc to the centreline arc (drawing note)
    const tip = P(rc, tipB), back = P(rc + 20, tipB - headSpan);
    const ax = tip[0] - back[0], ay = tip[1] - back[1], al = Math.hypot(ax, ay);
    const ux = ax / al, uy = ay / al, px = -uy, py = ux;
    const Q = (a, b) => [tip[0] - ux * a + px * b, tip[1] - uy * a + py * b];
    fillPoly(ctx, [tip, Q(60, 60), Q(120, 60), Q(60, 0), Q(120, -60), Q(60, -60)], fill);
  }
}
// S-jog bar for road narrows (516/517): straight, two-radius jog, straight
function jog(ctx, side, w, bottomInnerX, topInnerX, y0, bottomStraight, topStraight, total, fill) {
  const xb = bottomInnerX + side * (w / 2), xt = topInnerX + side * (w / 2);
  const y1 = y0 + bottomStraight, y2 = y0 + total - topStraight;
  ctx.beginPath();
  ctx.moveTo(xb, y0); ctx.lineTo(xb, y1);
  ctx.bezierCurveTo(xb, y1 + (y2 - y1) * 0.6, xt, y2 - (y2 - y1) * 0.6, xt, y2);
  ctx.lineTo(xt, y0 + total);
  ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.strokeStyle = fill;
  ctx.stroke();
}
// 512 bend: 65 mm bar, straight 125 at x = -102.5, then a bend about (0, 205) with inner radius 70
// (centreline 102.5) to a 20 degree heading, ending in a 90 degree chevron head (WD P512)
function bend(ctx, fill) {
  const xc = -102.5, R = 102.5, w = 65;
  ctx.beginPath();
  ctx.moveTo(xc, 80); ctx.lineTo(xc, 205);
  ctx.arc(xc + R, 205, R, Math.PI, 110 * DEG, true);
  ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.strokeStyle = fill;
  ctx.stroke();
  const E = [xc + R + R * Math.cos(110 * DEG), 205 + R * Math.sin(110 * DEG)];
  const d = [Math.cos(20 * DEG), Math.sin(20 * DEG)], p = [-d[1], d[0]];
  fillPoly(ctx, [[E[0] + d[0] * 52, E[1] + d[1] * 52], [E[0] + p[0] * 52.5, E[1] + p[1] * 52.5], [E[0] - p[0] * 52.5, E[1] - p[1] * 52.5]], fill);
}
// 614: inverted U, up the left leg (fletched tail) and down the right leg to a 90 degree point
function uTurn(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-130, 45); ctx.arc(0, 45, 130, Math.PI, 0, true); ctx.lineTo(50, 45); ctx.arc(0, 45, 50, 0, Math.PI, false); ctx.closePath();
  ctx.fill();
  fillPoly(ctx, [[-130, 45], [-50, 45], [-50, -180], [-90, -83], [-130, -180]], fill); // tail with 45 degree notch
  fillPoly(ctx, [[50, 45], [130, 45], [130, -140], [90, -180], [50, -140]], fill); // arrowhead
}
// text prim: cap height given directly or as an x-height; anchored by yMid, baseline or the sign bottom
function primText(ctx, p, sign, flip) {
  const cap = p.cap || 1.4 * p.xHeight;
  let base;
  if (p.baseline != null) base = p.baseline;
  else if (p.yBaseline != null) base = p.yBaseline;
  else if (p.yMid != null) base = flip ? p.yMid - cap / 2 : p.yMid + cap / 2;
  else if (p.baselineAboveBottom != null) base = -sign.ref / 2 + p.baselineAboveBottom;
  const x = p.xRight ?? p.x ?? 0;
  drawText(ctx, p.s, x, base, { f: fontOf(p.font), cap, fill: colour(p.fill, sign), align: p.align || (p.xRight != null ? 'right' : 'center'), flip });
}

// generic interpreter for the catalogue prims, plus the composite shapes it names
function drawPrims(ctx, prims, sign, flip) {
  for (const p of prims) {
    const fill = colour(p.fill, sign);
    switch (p.t) {
      case 'circle': circle(ctx, p.c[0], p.c[1], p.r); ctx.fillStyle = fill; ctx.fill(); sign.lastDisc = p; break;
      case 'rect': rrectPath(ctx, p.x, p.y, p.w, p.h, p.r || 0); ctx.fillStyle = fill; ctx.fill(); break;
      case 'poly': fillPoly(ctx, p.pts, fill); break;
      case 'polyline': fillBar(ctx, p.pts, p.w, p.outerRadius || 0, p.innerRadius || 0, fill); break;
      case 'bar': { // diagonal band, either by end points (roundel frames) or centre + angle (rect frames)
        ctx.save();
        if (p.clip === 'disc' && sign.lastDisc && p.c) { circle(ctx, sign.lastDisc.c[0], sign.lastDisc.c[1], sign.lastDisc.r); ctx.clip(); }
        else if (p.clip === 'disc') { circle(ctx, 0, 0, sign.ref / 2); ctx.clip(); }
        if (p.clip === 'innerDisc') { circle(ctx, 0, 0, sign.ref / 2 - sign.ring); ctx.clip(); }
        ctx.beginPath();
        if (p.c) { // rising left to right; rect frames are y-down so the right end goes up
          const dx = Math.cos(p.angle * DEG) * 1000, dy = (flip ? 1 : -1) * Math.sin(p.angle * DEG) * 1000;
          ctx.moveTo(p.c[0] - dx, p.c[1] - dy); ctx.lineTo(p.c[0] + dx, p.c[1] + dy);
        } else { ctx.moveTo(p.p0[0], p.p0[1]); ctx.lineTo(p.p1[0], p.p1[1]); }
        ctx.lineWidth = p.w; ctx.lineCap = 'butt'; ctx.strokeStyle = fill; ctx.stroke();
        ctx.restore();
        break;
      }
      case 'slantBars': { // cancellation stripes across the small "20" roundel on 675A/B
        if (!p.c) break;
        const dx = Math.cos(p.angle * DEG), dy = (flip ? 1 : -1) * Math.sin(p.angle * DEG), px = -dy, py = dx;
        const pitch = p.barW + p.gap, start = -((p.bars - 1) * pitch) / 2;
        ctx.lineWidth = p.barW; ctx.lineCap = 'butt'; ctx.strokeStyle = fill;
        for (let i = 0; i < p.bars; i++) {
          const o = start + i * pitch, cx = p.c[0] + px * o, cy = p.c[1] + py * o;
          ctx.beginPath(); ctx.moveTo(cx - dx * p.len / 2, cy - dy * p.len / 2); ctx.lineTo(cx + dx * p.len / 2, cy + dy * p.len / 2); ctx.stroke();
        }
        break;
      }
      case 'text': primText(ctx, p, sign, flip); break;
      case 'arrow': {
        const up = p.dir === 'up';
        const pts = arrowPoly(p.axisX, p.y0 + p.length / 2, up ? Math.PI / 2 : -Math.PI / 2, p.length, p.headWidth, p.headLength, p.shaftWidth);
        fillPoly(ctx, pts, fill);
        break;
      }
      case 'arrowUp': { // one-way sign arrow (rect frame, y down): 606-style chevron head, tip at tipY
        // WD P652: 90 degree tip, barbs run straight down from the head corners for barbDepth,
        // then 45 degrees back in to the shaft edges
        const hw = p.headWidth / 2, sw = p.shaftWidth / 2, yc = p.tipY + hw, yb = yc + (p.barbDepth ?? hw);
        const yIn = yb + (hw - sw), yEnd = p.tipY + p.length;
        fillPoly(ctx, [[p.cx, p.tipY], [p.cx + hw, yc], [p.cx + hw, yb], [p.cx + sw, yIn], [p.cx + sw, yEnd], [p.cx - sw, yEnd], [p.cx - sw, yIn], [p.cx - hw, yb], [p.cx - hw, yc]], fill);
        break;
      }
      case 'chevronHead': break; // drawn by bend()
      case 'jog': jog(ctx, p.side, p.w, p.bottomInnerX, p.topInnerX, p.y0, p.bottomStraight, p.topStraight, p.totalHeight, fill); break;
      case 'mergeY': // 520: the two legs and the merged bar are drawn as one rounded polygon;
        // the inner V apex is 40 above the leg tops (y = 260 on WD P520), fillets 60/40 out, 30/10 in
        roundedPoly(ctx, [[-90, 80], [-90, 220], [-35, 350], [-35, 430], [35, 430], [35, 350], [90, 220], [90, 80], [30, 80], [30, 220], [0, p.into?.[1] ?? 260], [-30, 220], [-30, 80]],
          [0, 60, 40, 0, 0, 40, 60, 0, 0, 30, 10, 30, 0]);
        ctx.fillStyle = fill; ctx.fill();
        break;
      case 'uTurn': uTurn(ctx, fill); break;
      case 'arcArrows':
        if (p.cutLinesDegClockwiseFromTop) arcArrows510(ctx, p.centre[0], p.centre[1], p.outerRadius, p.innerRadius, p.cutLinesDegClockwiseFromTop, p.gapDeg ?? 8, fill);
        else arcArrows611(ctx, p, fill);
        break;
      case 'arcCap': { // road hump: arc r 170 rising 85 above the band, filleted into it
        ctx.beginPath();
        ctx.moveTo(-180, 115); ctx.quadraticCurveTo(-128, 118, -105, 134);
        ctx.arc(0, 0, 170, Math.atan2(134, -105), Math.atan2(134, 105), true);
        ctx.quadraticCurveTo(128, 118, 180, 115); ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        break;
      }
      case 'stripes': break; // part of the zebra pictogram
      case 'pictogram': {
        ctx.save(); ctx.translate(p.base[0], p.base[1]);
        if (p.name.startsWith('two children')) pictChildren(ctx, fill);
        else if (p.name.startsWith('adult')) pictPedestrians(ctx, fill);
        else if (p.name.startsWith('bicycle')) pictBicycle(ctx, fill, sign.bg);
        else if (p.name.startsWith('pedestrian')) pictZebraWalker(ctx, fill, sign.bg);
        else pictSkid(ctx, fill, sign.bg);
        ctx.restore();
        break;
      }
      case 'triangleP500': { // 501: small inverted give-way triangle centred on p.c (the outer triangle is the frame)
        if (!p.c) break;
        // 190 tall centred 235 up: top edge at y = 330 where the white field is 225 wide, tip at 140.
        // (The spec's first pass asked for 300 at y = 250, which overflows the white field.)
        const H = p.heightMm || 190;
        ctx.save(); ctx.translate(p.c[0], p.c[1] + H / 2); ctx.scale(1, -1);
        triPath(ctx, H); ctx.fillStyle = PALETTE.red; ctx.fill();
        triInnerPath(ctx, H); ctx.fillStyle = PALETTE.white; ctx.fill();
        ctx.restore();
        break;
      }
      case 'roundel670': { // 20 zone: proportional copy of the speed roundel
        const d = p.d, k = d / 600;
        ctx.save(); ctx.translate(p.c[0], p.c[1]); ctx.scale(k, k);
        circle(ctx, 0, 0, 300); ctx.fillStyle = PALETTE.red; ctx.fill();
        circle(ctx, 0, 0, 240); ctx.fillStyle = PALETTE.white; ctx.fill();
        drawText(ctx, p.value, 0, 112, { f: FONTS.heavy, cap: 224, fill: PALETTE.black, align: 'center' });
        ctx.restore();
        break;
      }
      case 'regularPolygon': case 'regularPolygonOutline': break; // STOP is drawn by drawOctagon
      default: break;
    }
  }
}

// ---------- sign faces by shape ----------
const MIRRORED = { // handy aliases: same drawing, flipped
  no_left_turn: 'no_right_turn', bend_left: 'bend_right', keep_right: 'keep_left', turn_right_ahead: 'turn_left_ahead',
  road_narrows_left: 'road_narrows_right', side_road_left: 'side_road', staggered_junction_right: 'staggered_junction',
  double_bend_right: 'double_bend', t_junction_right: 't_junction',
};
function resolveId(id) {
  if (SIGNS[id]) return { id, mirror: false };
  if (MIRRORED[id]) return { id: MIRRORED[id], mirror: true };
  throw new Error(`signs: unknown sign id "${id}"`);
}
function mirrorIf(ctx, on) { if (on) ctx.scale(-1, 1); }

function drawRoundel(entry, opts, detail) {
  const ref = entry.symbol.ref || (entry.id === 'no_entry' ? 750 : 600);
  const cv = newCanvas(ref, ref, detail);
  const { ctx, k, ox, oy } = cv;
  let prims = entry.symbol.prims;
  let mirror = opts.mirror;
  if (entry.symbol.mirrorOf) { prims = SIGNS[entry.symbol.mirrorOf].symbol.prims; mirror = !mirror; }
  if (entry.id === 'speed_repeater') {
    const lim = opts.limit || '30';
    prims = SIGNS[lim === 'nsl' ? 'speed_nsl' : `speed_${lim}`].symbol.prims;
  }
  const edge = colour(prims[0].fill); // outermost disc colour bleeds past the cut-out edge
  ctx.fillStyle = edge; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, -k, ox + (ref / 2) * k, oy + (ref / 2) * k);
  const sign = { ref, ring: entry.bg === 'white' ? ref / 10 : ref / 50, bg: colour(entry.bg), border: edge };
  // background discs are never mirrored, symbols may be
  const discs = prims.filter((p) => p.t === 'circle'), rest = prims.filter((p) => p.t !== 'circle');
  drawPrims(ctx, discs, sign, true);
  ctx.save(); mirrorIf(ctx, mirror); drawPrims(ctx, rest, sign, true); ctx.restore();
  return finish(cv, { shape: 'circle', refMm: ref });
}

function drawTriangle(entry, opts, detail) {
  const H = 600, W = 1.1317 * H;
  const inverted = entry.shape === 'triangleDown';
  const cv = newCanvas(W, H, detail);
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = PALETTE.red; ctx.fillRect(0, 0, cv.W, cv.H);
  // upright: origin at the base middle, y up. Inverted (GIVE WAY): origin at the top edge middle, y down.
  if (inverted) ctx.setTransform(k, 0, 0, k, ox + (W / 2) * k, oy);
  else ctx.setTransform(k, 0, 0, -k, ox + (W / 2) * k, oy + H * k);
  triPath(ctx, H); ctx.fillStyle = PALETTE.red; ctx.fill();
  triInnerPath(ctx, H); ctx.fillStyle = PALETTE.white; ctx.fill();
  const sign = { ref: H, bg: PALETTE.white, border: PALETTE.red };
  const prims = entry.symbol.prims || [];
  if (entry.id === 'give_way_ahead' && opts.variant === 'stop') {
    ctx.save(); ctx.translate(0, 250);
    octPath(ctx, 250); ctx.fillStyle = PALETTE.red; ctx.fill();
    octPath(ctx, 250, 6); ctx.lineWidth = 10; ctx.strokeStyle = PALETTE.white; ctx.stroke();
    drawText(ctx, 'STOP', 0, -30, { f: FONTS.medium, cap: 60, fill: PALETTE.white, align: 'center', flip: true });
    ctx.restore();
  } else if (entry.id === 'bend_right') {
    ctx.save(); mirrorIf(ctx, opts.mirror); bend(ctx, PALETTE.black); ctx.restore();
  } else if (entry.id === 'double_bend') {
    ctx.save(); mirrorIf(ctx, opts.mirror);
    fillBar(ctx, [[105, 80], [105, 245], [-65, 165], [-65, 320]], 60, 50, 10, PALETTE.black);
    fillPoly(ctx, [[-95, 320], [-35, 320], [-65, 350]], PALETTE.black);
    ctx.restore();
  } else {
    ctx.save(); mirrorIf(ctx, opts.mirror); drawPrims(ctx, prims, sign, !inverted); ctx.restore();
  }
  return finish(cv, { shape: inverted ? 'triangleDown' : 'triangle', refMm: H });
}

function drawOctagon(entry, detail) {
  const D = 750;
  const cv = newCanvas(D, D, detail);
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = PALETTE.red; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, -k, ox + (D / 2) * k, oy + (D / 2) * k);
  octPath(ctx, D); ctx.fillStyle = PALETTE.red; ctx.fill();
  octPath(ctx, D, 12.5); ctx.lineWidth = 25; ctx.strokeStyle = PALETTE.white; ctx.stroke(); // 25 mm white edge
  // Transport Medium, cap 175; tile bottom 220 above the sign bottom puts the baseline at 282.5
  drawText(ctx, 'STOP', 0, -D / 2 + 282.5, { f: FONTS.medium, cap: 175, fill: PALETTE.white, align: 'center', flip: true });
  return finish(cv, { shape: 'octagon', refMm: D });
}

// rect-frame signs with fixed mm geometry: 20 zone, one way, countdown markers, chevron board
function drawRectPrims(entry, opts, detail) {
  let W, H, prims = entry.symbol.prims, sign = { bg: colour(entry.bg), border: PALETTE.black }, radius = 0;
  if (entry.symbol.overall) { [W, H] = entry.symbol.overall; radius = entry.border?.cornerRadius || 15; }
  else if (entry.id === 'zone_20') { W = 600; H = 780; radius = 30; }
  else if (entry.id === 'one_way') { W = 300; H = 450; radius = 12; sign.border = PALETTE.white; }
  else if (entry.id === 'countdown_markers') {
    W = 700; H = 1200; radius = 75;
    const st = statusOf(opts.status || 'primary');
    sign = { bg: st.bg, border: st.border };
  } else if (entry.id === 'chevron_board') {
    const h = opts.height || 400, m = { 400: 600, 600: 900, 800: 1200 }[h] || 600, n = opts.modules || 2;
    W = n * m; H = h; sign = { bg: PALETTE.black, border: PALETTE.black };
  }
  const cv = newCanvas(W, H, detail);
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = sign.border; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  const refMm = H; // these are sized by height in the catalogue
  let gap = null;
  if (entry.id.startsWith('zone_20_end')) { // 675A/B are two plates with a 15 mm gap (WD P675): leave it see-through
    gap = [600, 15];
    ctx.clearRect(0, 600, W, 15);
  }
  if (entry.id === 'countdown_markers') {
    rrectPath(ctx, 0, 0, W, H, 75); ctx.fillStyle = sign.border; ctx.fill();
    rrectPath(ctx, 25, 25, W - 50, H - 50, 50); ctx.fillStyle = sign.bg; ctx.fill();
    const bars = opts.bars ?? 3;
    const centres = [350, 600, 850].slice(0, bars);
    ctx.save();
    if (opts.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); } // central-reservation copy is mirrored
    for (const c of centres) {
      ctx.save(); ctx.translate(350, H - c); ctx.rotate(27 * DEG); // bars fall to the right
      ctx.fillStyle = sign.border; ctx.fillRect(-280, -50, 560, 100); ctx.restore();
    }
    ctx.restore();
  } else if (entry.id === 'chevron_board') {
    const s = H / 2; // 45 degree arms: each rises half the height over s
    ctx.fillStyle = PALETTE.black; ctx.fillRect(0, 0, W, H);
    const m = W / (opts.modules || 2), stroke = m / 3;
    ctx.save();
    if (opts.dir === 'right') { ctx.translate(W, 0); ctx.scale(-1, 1); }
    for (let i = 0; i < (opts.modules || 2); i++) {
      const a = i * m; // WD P515: the apex sits on the module boundary, arms reach the edges s in
      fillPoly(ctx, [[a, s], [a + s, 0], [a + s + stroke, 0], [a + stroke, s], [a + s + stroke, H], [a + s, H]], PALETTE.white);
    }
    ctx.restore();
  } else {
    drawPrims(ctx, prims, sign, false);
    if (gap) ctx.clearRect(0, gap[0], W, gap[1]); // prims paint the full plate; reopen the gap
  }
  return finish(cv, { shape: 'rect', radiusMm: radius, refMm, cutout: !!gap });
}

// ---------- legend boxes (frame "sw": tiles of 8 stroke widths) ----------
// lines: [{ text, xh (mm), font }] ; gaps: tile gaps in sw of the smallest x-height
function legendBox({ xh, lines, gaps = [], bg, border, pad = { top: 2.5, bottom: 1.5, sides: 2.5 }, radiusSw = 1.5, borderSw = 1.5, detail = 1, minWidth = 0, refMm = xh }) {
  const sw = xh / 4;
  const L = lines.map((l) => {
    const lxh = l.xh || xh, cap = 1.4 * lxh, f = fontOf(l.font || (isDark({ bg }) ? 'medium' : 'heavy'));
    return { ...l, cap, f, w: textW(l.text, f, cap), tile: 2 * lxh, base: 1.5 * lxh };
  });
  const inner = Math.max(minWidth, ...L.map((l) => l.w));
  const W = inner + 2 * (pad.sides + borderSw) * sw;
  const H = (pad.top + pad.bottom + 2 * borderSw) * sw + L.reduce((s, l) => s + l.tile, 0) + gaps.reduce((s, g) => s + g * sw, 0);
  const cv = newCanvas(W, H, detail, dirMaxPx(detail));
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = border; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  rrectPath(ctx, 0, 0, W, H, radiusSw * sw); ctx.fillStyle = border; ctx.fill();
  rrectPath(ctx, borderSw * sw, borderSw * sw, W - 2 * borderSw * sw, H - 2 * borderSw * sw, Math.max(0, (radiusSw - borderSw) * sw)); ctx.fillStyle = bg; ctx.fill();
  let y = (borderSw + pad.top) * sw;
  const ink = isDark({ bg }) ? PALETTE.white : PALETTE.black;
  L.forEach((l, i) => {
    drawText(ctx, l.text, W / 2, y + l.base, { f: l.f, cap: l.cap, fill: l.fill || ink, align: 'center' });
    y += l.tile + (gaps[i] || 0) * sw;
  });
  return finish(cv, { shape: 'rect', radiusMm: radiusSw * sw, xh, refMm });
}

// plates under a sign: distance, REDUCE SPEED NOW, Dual carriageway, School, or free text
function plateTexture(id, opts, detail) {
  const xh = opts.xh || 62.5;
  if (id === 'reduce_speed_now') {
    return legendBox({ xh, lines: ['REDUCE', 'SPEED', 'NOW'].map((t) => ({ text: t, font: 'medium' })), bg: PALETTE.red, border: PALETTE.white, pad: { top: 2.8, bottom: 1.2, sides: 2.5 }, detail });
  }
  let lines;
  if (id === 'dual_carriageway_plate') lines = ['Dual', 'carriageway'];
  else if (id === 'school_plate') lines = ['School'];
  else lines = opts.lines || [opts.text || '100 yds'];
  return legendBox({ xh, lines: lines.map((t) => ({ text: t, font: 'heavy' })), bg: PALETTE.white, border: PALETTE.black, detail });
}

function townEntryTexture(opts, detail) {
  const name = (opts.name || 'HERNE BAY').toUpperCase();
  const nameCap = opts.nameCap || 100, small = nameCap / 2; // smaller legends at half the place-name size
  const xh = small / 1.4; // layout unit: the small tile
  return legendBox({
    xh,
    lines: [{ text: 'Welcome to', xh }, { text: name, xh: nameCap / 1.4 }, { text: 'Please drive carefully', xh }],
    gaps: [4, 2], bg: PALETTE.white, border: PALETTE.black, pad: { top: 2.5, bottom: 1.5, sides: 2.5 }, detail, refMm: nameCap,
  });
}

function dualAheadTexture(opts, detail) {
  const xh = opts.xh || 100;
  // a mile or less reads 'mile' (¼ mile, 1 mile); more reads 'miles'
  const m = opts.miles || 2, n = typeof m === 'number' ? m : parseFloat(String(m).replace('¼', '.25').replace('½', '.5').replace('¾', '.75')) || 2;
  const lines = ['Dual', 'carriageway', `${m} ${n <= 1 ? 'mile' : 'miles'}`, 'ahead'];
  return legendBox({ xh, lines: lines.map((t) => ({ text: t, font: 'medium' })), bg: PALETTE.blue, border: PALETTE.white, pad: { top: 2.5, bottom: 1.5, sides: 2.5 }, detail });
}

/**
 * Texture for a catalogue sign. opts: { mirror, limit (repeater), bars/status/mirror
 * (countdown), modules/dir/height (chevron board), variant:'stop' (501), text/lines/xh
 * (plates), name/nameCap (town entry), miles/xh (818.1), detail }.
 */
export function signTexture(id, opts = {}) {
  const r = resolveId(id);
  const o = { ...opts, mirror: !!opts.mirror !== r.mirror };
  const entry = SIGNS[r.id];
  if (entry.category === 'direction' && !entry.symbol?.prims) {
    // no fixed legend: show the layout the entry stands for (cached by directionSignTexture itself)
    const spec = entry.shape === 'patch'
      ? { type: 'flag', status: 'primary', band: o.band || '30', dest: ['London'], route: 'A2', patch: { route: '(M2)', status: 'motorway' } }
      : demoDirection(r.id, o);
    if (o.detail) spec.detail = o.detail;
    return directionSignTexture(spec);
  }
  return cache.get('sign', r.id, o, () => {
    const detail = o.detail || 1;
    switch (entry.shape) {
      case 'circle': return drawRoundel(entry, o, detail);
      case 'triangle': case 'triangleDown': case 'triangle+plate': return drawTriangle(entry, o, detail);
      case 'octagon': return drawOctagon(entry, detail);
      case 'bollard': return drawRoundel(SIGNS.keep_left, o, detail);
      case 'rectPortrait': return drawRectPrims(entry, o, detail);
      default:
        if (entry.category === 'plate') return plateTexture(r.id, o, detail);
        if (r.id === 'town_entry') return townEntryTexture(o, detail);
        if (r.id === 'dual_carriageway_ahead') return dualAheadTexture(o, detail);
        return drawRectPrims(entry, o, detail);
    }
  });
}

// catalogue direction entries have no fixed legend; these show the layout each one stands for
function demoDirection(id, o) {
  const band = o.band || '30';
  switch (id) {
    case 'ads_map_roundabout_primary':
      return { type: 'map', status: 'primary', band, arms: [
        { bearing: 270, dest: ['Herne Bay'], route: '(A291)', routeStatus: 'nonprimary' },
        { bearing: 0, dest: ['Canterbury'], route: 'A28' },
        { bearing: 90, dest: ['Margate'], route: 'A28' }] };
    case 'ads_map_roundabout_nonprimary':
      return { type: 'map', status: 'nonprimary', band, arms: [
        { bearing: 270, dest: ['Whitstable'], patch: { route: '(A299)', status: 'primary' } },
        { bearing: 0, dest: ['Herne Bay'] },
        { bearing: 90, dest: ['Margate', 'Ramsgate'], route: 'A299', routeStatus: 'primary' }] };
    case 'ads_stack':
      return { type: 'stack', status: 'primary', band, arms: [
        { bearing: 270, dest: ['Whitstable'], route: 'A290', routeStatus: 'nonprimary' },
        { bearing: 0, dest: ['Canterbury'], route: 'A28' },
        { bearing: 90, dest: ['Herne Bay'], route: 'A291', routeStatus: 'nonprimary' }] };
    case 'ads_dedicated_lane':
      return { type: 'lanes', status: 'primary', band, lanes: [
        { arrows: ['left'], dest: ['Herne Bay'], route: '(A291)' },
        { arrows: ['ahead'], dest: ['Canterbury'], route: 'A28' },
        { arrows: ['ahead'], dest: ['Margate'], route: 'A28' }] };
    case 'flag_direction': return { type: 'flag', status: 'nonprimary', band, dest: ['Herne Bay'], route: 'A291', distance: '3' };
    case 'motorway_ads':
      return { type: 'stack', status: 'motorway', band: '70', junction: '7', arms: [
        { bearing: 45, dest: ['London', 'Rochester'], route: 'M2' },
        { bearing: 0, dest: ['Dover', 'Canterbury'], route: 'A2', routeStatus: 'primary' }] };
    case 'route_confirmatory': return { type: 'confirm', status: 'primary', band, route: 'A28', dest: [['Canterbury', '4'], ['Ashford', '18']] };
    case 'tourist_canterbury_cathedral': return { type: 'flag', status: 'tourist', band, dest: ['Canterbury Cathedral'], symbol: 'cathedral', distance: '1' };
    case 'tourist_herne_bay_pier': return { type: 'flag', status: 'tourist', band, dest: ['Herne Bay Pier'], symbol: 'pier' };
    default: return { type: 'flag', status: 'nonprimary', band, dest: [SIGNS[id]?.name || id] };
  }
}

// ---------- direction signs ----------
const XH_BY_BAND = { 20: 75, 30: 100, 40: 125, 50: 150, 60: 200, 70: 250, motorway: 300 };
// flag-type and route confirmatory signs are one size step below the ADS (TSM7 Appendix E)
const FLAG_XH_BY_BAND = { 20: 60, 30: 75, 40: 100, 50: 125, 60: 150, 70: 200, motorway: 300 };

// one legend line = runs of text; a run may sit in its own patch (route of another status)
function runWidth(run, sw) {
  return run.w + (run.patch ? 2 * sw : 0);
}
// `motorwaySign`: the sign itself is blue. Only then do route numbers use the Motorway alphabet;
// a blue (M2) patch or panel on a green or white sign is Transport Medium (TSM7 10.1.2).
function makeRun(text, kind, host, sw, patchStatus, motorwaySign = false) {
  const motorwayNo = kind === 'route' && motorwaySign && host.bg === PALETTE.blue;
  const f = motorwayNo ? FONTS.motorway : FONTS[host.font];
  const cap = motorwayNo ? 8 * sw : 5.6 * sw;
  const st = patchStatus ? statusOf(patchStatus) : null;
  const pf = st ? FONTS[st.font] : f, pcap = st ? 5.6 * sw : cap;
  return { text, kind, f: pf, cap: pcap, fill: st ? st.route : kind === 'route' ? host.route : host.legend, patch: st, w: textW(text, pf, pcap) };
}
/** Lines for a destination block: one destination per line, route (and distance) after the last. */
function blockLines(arm, host, sw, motorwaySign = false) {
  const dests = Array.isArray(arm.dest) ? arm.dest : arm.dest ? [arm.dest] : [];
  const lines = dests.map((d) => [makeRun(d, 'dest', host, sw, null, motorwaySign)]);
  if (!lines.length) lines.push([]);
  const last = lines[lines.length - 1];
  if (arm.route) last.push(makeRun(arm.route, 'route', host, sw, null, motorwaySign));
  if (arm.patch) last.push(makeRun(arm.patch.route, 'route', host, sw, arm.patch.status, motorwaySign));
  if (arm.distance) last.push(makeRun(String(arm.distance), 'dest', host, sw, null, motorwaySign));
  return lines;
}
function linesWidth(lines, sw) {
  return Math.max(0, ...lines.map((runs) => runs.reduce((s, r, i) => s + runWidth(r, sw) + (i ? 2.5 * sw : 0), 0)));
}
function drawLines(ctx, lines, x, y, sw, hostDark) {
  // tiles are 8 sw tall; capitals sit 0.4 sw below the tile top, so the baseline is 6 sw down
  lines.forEach((runs, li) => {
    let cx = x;
    const top = y + li * 8 * sw;
    for (const r of runs) {
      if (r.patch) {
        const pw = runWidth(r, sw);
        if (hostDark && isDark(r.patch)) { rrectPath(ctx, cx - 0.5 * sw, top - 0.5 * sw, pw + sw, 9 * sw, 1.5 * sw); ctx.fillStyle = PALETTE.white; ctx.fill(); }
        rrectPath(ctx, cx, top, pw, 8 * sw, sw); ctx.fillStyle = r.patch.bg; ctx.fill();
        cx += sw;
      }
      const base = r.f === FONTS.motorway ? top + 8 * sw : top + 6 * sw;
      drawText(ctx, r.text, cx, base, { f: r.f, cap: r.cap, fill: r.fill });
      cx += r.w + (r.patch ? sw : 0) + 2.5 * sw;
    }
  });
}
/** A destination block, optionally boxed in a panel of another route status. */
function makeBlock(arm, signStatus, sw) {
  const host = statusOf(signStatus);
  const panelStatus = arm.routeStatus && arm.routeStatus !== signStatus && arm.panel !== false ? arm.routeStatus : null;
  const inner = panelStatus ? statusOf(panelStatus) : host;
  const lines = blockLines(arm, inner, sw, signStatus === 'motorway');
  const tw = linesWidth(lines, sw), th = lines.length * 8 * sw;
  const pad = panelStatus ? 2.5 * sw : 0;
  const w = tw + 2 * pad, h = th + 2 * pad;
  return {
    w, h, lines,
    draw(ctx, x, y) {
      if (panelStatus) {
        if (isDark(host) && isDark(inner)) { rrectPath(ctx, x - 0.5 * sw, y - 0.5 * sw, w + sw, h + sw, 1.5 * sw); ctx.fillStyle = PALETTE.white; ctx.fill(); }
        rrectPath(ctx, x, y, w, h, sw); ctx.fillStyle = inner.bg; ctx.fill();
      }
      drawLines(ctx, lines, x + pad, y + pad, sw, isDark(inner));
    },
  };
}
function signCanvas(W, H, st, sw, detail, radiusSw = 1.5) {
  const cv = newCanvas(W, H, detail, dirMaxPx(detail));
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = st.border; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  rrectPath(ctx, 0, 0, W, H, radiusSw * sw); ctx.fillStyle = st.border; ctx.fill();
  rrectPath(ctx, 1.5 * sw, 1.5 * sw, W - 3 * sw, H - 3 * sw, 0.5 * sw); ctx.fillStyle = st.bg; ctx.fill();
  return cv;
}
// motorway junction number: black patch with a 0.5 sw white edge (TSM7 10.1.4), Motorway alphabet
function junctionPatch(ctx, sw, j) {
  const f = FONTS.motorway, cap = 8 * sw, w = textW(j, f, cap) + 2 * sw;
  rrectPath(ctx, 3.5 * sw, 3.5 * sw, w + sw, 11 * sw, 1.5 * sw); ctx.fillStyle = PALETTE.white; ctx.fill();
  rrectPath(ctx, 4 * sw, 4 * sw, w, 10 * sw, sw); ctx.fillStyle = PALETTE.black; ctx.fill();
  drawText(ctx, j, 5 * sw, 13 * sw, { f, cap, fill: PALETTE.white });
}
const bearingVec = (b) => [Math.sin(b * DEG), -Math.cos(b * DEG)];

function mapSign(spec, xh, detail) {
  const sw = xh / 4, st = statusOf(spec.status);
  const R = 12 * sw, r = 7 * sw, armLen = 12 * sw, approach = 10 * sw, gap = 2.5 * sw;
  const arms = (spec.arms || []).map((a) => {
    const d = bearingVec(a.bearing);
    const blk = makeBlock(a, spec.status, sw);
    const end = [d[0] * (R + armLen), d[1] * (R + armLen)];
    // block sits just beyond the arm end, its nearest edge/corner 2.5 sw clear
    const cx = end[0] + d[0] * gap + Math.sign(Math.round(d[0] * 100)) * (blk.w / 2);
    const cy = end[1] + d[1] * gap + Math.sign(Math.round(d[1] * 100)) * (blk.h / 2);
    // arm width by the status of the road it stands for: 6 sw primary/motorway, 4 numbered, 2.5 local
    const numbered = a.route || a.patch;
    const width = a.routeStatus === 'primary' || a.routeStatus === 'motorway' || (!a.routeStatus && (spec.status === 'primary' || spec.status === 'motorway') && numbered) ? 6 * sw : numbered ? 4 * sw : 2.5 * sw;
    return { ...a, d, blk, end, bx: cx - blk.w / 2, by: cy - blk.h / 2, width };
  });
  let x0 = -R, x1 = R, y0 = -R, y1 = R + approach;
  for (const a of arms) {
    x0 = Math.min(x0, a.bx, a.end[0]); x1 = Math.max(x1, a.bx + a.blk.w, a.end[0]);
    y0 = Math.min(y0, a.by, a.end[1]); y1 = Math.max(y1, a.by + a.blk.h, a.end[1]);
  }
  const m = 4 * sw; // legend to border 2.5 sw + border 1.5 sw
  const W = x1 - x0 + 2 * m, H = y1 - y0 + 2 * m;
  const cv = signCanvas(W, H, st, sw, detail);
  const ctx = cv.ctx;
  const C = [m - x0, m - y0];
  if (spec.junction) junctionPatch(ctx, sw, spec.junction);
  // route symbol: ring, then the cut-out wedge to the right of the approach shows clockwise flow
  const symCol = st.legend;
  circle(ctx, C[0], C[1], R); ctx.fillStyle = symCol; ctx.fill();
  circle(ctx, C[0], C[1], r); ctx.fillStyle = st.bg; ctx.fill();
  ctx.beginPath(); ctx.moveTo(C[0], C[1]);
  for (let b = 136; b <= 166; b += 3) { const d = bearingVec(b); ctx.lineTo(C[0] + d[0] * (R + sw), C[1] + d[1] * (R + sw)); }
  ctx.closePath(); ctx.fillStyle = st.bg; ctx.fill();
  circle(ctx, C[0], C[1], r); ctx.fillStyle = st.bg; ctx.fill();
  ctx.lineCap = 'butt'; ctx.strokeStyle = symCol;
  // approach stub (you are here): as wide as the road the sign stands on, 6 sw primary / 4 sw
  // numbered non-primary; its base ends 1.5 sw from the border (TSM7 5.7.2)
  ctx.lineWidth = isDark(st) ? 6 * sw : 4 * sw;
  ctx.beginPath(); ctx.moveTo(C[0], C[1] + r + sw); ctx.lineTo(C[0], C[1] + R + approach + sw); ctx.stroke();
  for (const a of arms) {
    ctx.lineWidth = a.width;
    ctx.beginPath(); ctx.moveTo(C[0] + a.d[0] * (r + sw), C[1] + a.d[1] * (r + sw)); ctx.lineTo(C[0] + a.end[0], C[1] + a.end[1]); ctx.stroke();
    a.blk.draw(ctx, C[0] + a.bx, C[1] + a.by);
  }
  return finish(cv, { shape: 'rect', radiusMm: 1.5 * sw, xh });
}

// S12-5-1 arrow: 16 sw long (14 on a single-line row), head 8 x 4, shaft 4, 90 degree tip
function drawStackArrow(ctx, cx, cy, bearing, len, sw, fill) {
  fillPoly(ctx, arrowPoly(cx, cy, (bearing - 90) * DEG, len, 8 * sw, 4 * sw, 4 * sw), fill);
}
function stackSign(spec, xh, detail) {
  const sw = xh / 4, st = statusOf(spec.status);
  const rows = (spec.arms || []).map((a) => {
    const panel = a.routeStatus && a.routeStatus !== spec.status ? statusOf(a.routeStatus) : null;
    const inner = panel || st;
    const lines = blockLines(a, inner, sw, spec.status === 'motorway');
    const len = lines.length > 1 ? 16 * sw : 14 * sw;
    const right = a.bearing > 0 && a.bearing < 180; // right turns carry the arrow on the right
    // 2.5 sw above; 1.5 sw below a tiled row, 2.5 sw below a panel (TSM7 §4). The rows are
    // full-width panels bounded by the 1.5 sw border-colour separators, so a dark panel on a
    // dark sign already has its white edge.
    const content = Math.max(16 * sw, lines.length * 8 * sw);
    const h = content + 2.5 * sw + (panel ? 2.5 : 1.5) * sw;
    return { a, panel, inner, lines, len, right, h, content, tw: linesWidth(lines, sw) };
  });
  const inner = Math.max(0, ...rows.map((r) => r.tw)) + 16 * sw + 2.5 * sw;
  const W = inner + 2 * 4 * sw;
  let H = 3 * sw + rows.reduce((s, r) => s + r.h, 0) + 1.5 * sw * (rows.length - 1);
  if (spec.junction) H += 12 * sw;
  const cv = signCanvas(W, H, st, sw, detail);
  const ctx = cv.ctx;
  let y = 1.5 * sw;
  if (spec.junction) { junctionPatch(ctx, sw, spec.junction); y += 12 * sw; }
  rows.forEach((r, i) => {
    if (i) { ctx.fillStyle = st.border; ctx.fillRect(1.5 * sw, y, W - 3 * sw, 1.5 * sw); y += 1.5 * sw; }
    if (r.panel) { ctx.fillStyle = r.panel.bg; ctx.fillRect(1.5 * sw, y, W - 3 * sw, r.h); }
    const ax = r.right ? W - 4 * sw - 8 * sw : 4 * sw + 8 * sw;
    drawStackArrow(ctx, ax, y + 2.5 * sw + r.content / 2, r.a.bearing, r.len, sw, r.inner.legend);
    const tx = r.right ? 4 * sw : 4 * sw + 16 * sw + 2.5 * sw;
    drawLines(ctx, r.lines, tx, y + 2.5 * sw + (r.content - r.lines.length * 8 * sw) / 2, sw, isDark(r.inner));
    y += r.h;
  });
  return finish(cv, { shape: 'rect', radiusMm: 1.5 * sw, xh });
}

// dedicated-lane sign: a column per lane, destinations above 18 sw arrows. Neighbouring lanes to
// the same destination share one block, have no lane line between them and are joined by a bar.
function laneArrow(ctx, x, y, kind, sw, fill) {
  // all arrow tops align at y; the straight arrow is 18 sw tall, turn arrows 14 sw wide on a 4 sw radius
  ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineCap = 'butt';
  if (kind === 'ahead') {
    fillPoly(ctx, arrowPoly(x, y + 9 * sw, -Math.PI / 2, 18 * sw, 8 * sw, 4 * sw, 4 * sw), fill);
    return;
  }
  const s = kind === 'left' ? -1 : 1, R = 4 * sw;
  ctx.lineWidth = 4 * sw;
  ctx.beginPath(); ctx.moveTo(x, y + 18 * sw); ctx.lineTo(x, y + 4 * sw + R);
  ctx.arc(x + s * R, y + 4 * sw + R, R, s < 0 ? 0 : Math.PI, -Math.PI / 2, s < 0);
  ctx.lineTo(x + s * 10 * sw, y + 4 * sw); ctx.stroke();
  fillPoly(ctx, [[x + s * 14 * sw, y + 4 * sw], [x + s * 10 * sw, y], [x + s * 10 * sw, y + 8 * sw]], fill);
}
function lanesSign(spec, xh, detail) {
  const sw = xh / 4, st = statusOf(spec.status);
  const sameDest = (a, b) => String(a.dest) === String(b.dest) && a.route === b.route && a.routeStatus === b.routeStatus;
  const groups = [];
  for (const l of spec.lanes || []) {
    const g = groups[groups.length - 1];
    if (g && sameDest(g.l, l)) g.lanes.push(l); else groups.push({ l, lanes: [l] });
  }
  // a straight arrow is 8 sw wide, a turn arrow 14 sw from tip to shaft centre plus the half shaft
  const arrowsW = (arrows) => arrows.reduce((s, a) => s + (a === 'ahead' ? 8 * sw : 16 * sw), 0) + (arrows.length - 1) * 2 * sw;
  for (const g of groups) {
    g.blk = makeBlock({ ...g.l, routeStatus: g.l.routeStatus, panel: g.l.panel }, spec.status, sw);
    g.cols = g.lanes.map((l) => { const arrows = l.arrows || ['ahead']; return { arrows, aw: arrowsW(arrows) }; });
    // lanes to one place are equal width, and together must hold the block with 2.5 sw each side
    const laneW = Math.max(...g.cols.map((c) => c.aw + 5 * sw), (g.blk.w + 5 * sw) / g.cols.length);
    g.cols.forEach((c) => { c.w = laneW; });
    g.w = laneW * g.cols.length;
  }
  const blkH = Math.max(0, ...groups.map((g) => g.blk.h));
  const W = 3 * sw + groups.reduce((s, g) => s + g.w, 0) + (groups.length - 1) * sw;
  const H = 3 * sw + 2.5 * sw + blkH + 2.5 * sw + 18 * sw + 2.5 * sw;
  const cv = signCanvas(W, H, st, sw, detail);
  const ctx = cv.ctx;
  let x = 1.5 * sw;
  const arrowTop = 1.5 * sw + 2.5 * sw + blkH + 2.5 * sw;
  groups.forEach((g, gi) => {
    if (gi) { // broken lane line, 1 sw wide, 12 sw module, from 1 sw above the arrow heads
      ctx.fillStyle = st.border;
      for (let y = arrowTop - sw; y < H - 1.5 * sw; y += 12 * sw) ctx.fillRect(x, y, sw, Math.min(8 * sw, H - 1.5 * sw - y));
      x += sw;
    }
    g.blk.draw(ctx, x + 2.5 * sw, 1.5 * sw + 2.5 * sw); // ranged left in the group
    const shafts = [];
    for (const c of g.cols) {
      let ax = x + (c.w - c.aw) / 2;
      for (const a of c.arrows) {
        const w = a === 'ahead' ? 8 * sw : 16 * sw;
        const cx = a === 'ahead' ? ax + w / 2 : a === 'left' ? ax + w - 2 * sw : ax + 2 * sw;
        laneArrow(ctx, cx, arrowTop, a, sw, st.legend);
        shafts.push(cx);
        ax += w + 2 * sw;
      }
      x += c.w;
    }
    // the joining bar runs shaft to shaft, so it stays well inside the lane lines either side
    if (g.cols.length > 1) { ctx.fillStyle = st.legend; ctx.fillRect(shafts[0], arrowTop + 15 * sw, shafts[shafts.length - 1] - shafts[0], 2 * sw); }
  });
  return finish(cv, { shape: 'rect', radiusMm: 1.5 * sw, xh });
}

// flag-type: rectangle with a 60 degree pointed end (bold border chevron), legend 2 sw clear of it
function flagSign(spec, xh, detail) {
  const sw = xh / 4, st = statusOf(spec.status), dir = spec.dir || 'right';
  const lines = blockLines(spec, st, sw, spec.status === 'motorway');
  const sym = spec.symbol ? 8 * sw : 0;
  const tw = linesWidth(lines, sw) + (sym ? sym + 2.5 * sw : 0);
  const H = lines.length * 8 * sw + 2 * 2.5 * sw + 2 * 1.5 * sw;
  const hsw = H / sw;
  const chev = (hsw < 19 ? 3 : hsw < 27 ? 4 : hsw < 35 ? 5 : hsw < 43 ? 6 : hsw < 51 ? 7 : 8) * sw;
  const tan60 = Math.tan(60 * DEG);
  // sloped edges at 60 degrees; the legend clears the inner slope by 2 sw along its whole height
  const textRight = 4 * sw + tw;
  const innerTipX = textRight + 2 * sw + (H / 2 - 4 * sw) / tan60;
  const W = innerTipX + chev / Math.sin(60 * DEG);
  const tip = (H / 2) / tan60; // how far the point protrudes beyond the rectangle
  const cv = newCanvas(W, H, detail, dirMaxPx(detail));
  const { ctx, k, ox, oy } = cv;
  ctx.fillStyle = st.border; ctx.fillRect(0, 0, cv.W, cv.H);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  const flip = dir === 'left';
  ctx.save();
  if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  const bx = W - tip; // x where the sloped edges leave the rectangle
  roundedPoly(ctx, [[0, 0], [bx, 0], [W, H / 2], [bx, H], [0, H]], [1.5 * sw, 0, 3 * sw, 0, 1.5 * sw]);
  ctx.fillStyle = st.border; ctx.fill();
  const ib = innerTipX - (H / 2 - 1.5 * sw) / tan60; // inner slope meets the inner top edge here
  roundedPoly(ctx, [[1.5 * sw, 1.5 * sw], [ib, 1.5 * sw], [innerTipX, H / 2], [ib, H - 1.5 * sw], [1.5 * sw, H - 1.5 * sw]], [0.5 * sw, 0, 1.5 * sw, 0, 0.5 * sw]);
  ctx.fillStyle = st.bg; ctx.fill();
  ctx.restore();
  let tx = flip ? W - textRight : 4 * sw;
  if (sym) { ctx.save(); ctx.translate(tx, 4 * sw + (lines.length * 8 * sw) / 2 + sym / 2); ctx.scale(1, -1); pictogram(ctx, spec.symbol, sym, st.legend, st.bg); ctx.restore(); tx += sym + 2.5 * sw; }
  drawLines(ctx, lines, tx, 4 * sw, sw, isDark(st));
  return finish(cv, { shape: 'flag', dir, tipMm: tip, radiusMm: 1.5 * sw, xh });
}

// route confirmatory: route number, then destinations with a right-aligned miles column
function confirmSign(spec, xh, detail) {
  const sw = xh / 4, st = statusOf(spec.status), mw0 = spec.status === 'motorway';
  const route = makeRun(spec.route || '', 'route', st, sw, null, mw0);
  const rows = (spec.dest || []).map(([d, mi]) => ({ d: makeRun(d, 'dest', st, sw, null, mw0), m: makeRun(String(mi ?? ''), 'dest', st, sw, null, mw0) }));
  const dw = Math.max(route.w, ...rows.map((r) => r.d.w)), mw = Math.max(...rows.map((r) => r.m.w), 0);
  const W = 8 * sw + dw + 2.5 * sw + mw, H = 7 * sw + (rows.length + 1) * 8 * sw;
  const cv = signCanvas(W, H, st, sw, detail);
  const ctx = cv.ctx;
  drawLines(ctx, [[route]], 4 * sw, 4 * sw, sw, isDark(st));
  rows.forEach((r, i) => {
    const top = 4 * sw + (i + 1) * 8 * sw;
    drawText(ctx, r.d.text, 4 * sw, top + 6 * sw, { f: r.d.f, cap: r.d.cap, fill: r.d.fill });
    drawText(ctx, r.m.text, W - 4 * sw, top + 6 * sw, { f: r.m.f, cap: r.m.cap, fill: r.m.fill, align: 'right' });
  });
  return finish(cv, { shape: 'rect', radiusMm: 1.5 * sw, xh });
}

/**
 * Direction sign texture. spec = { type:'map'|'stack'|'lanes'|'flag'|'confirm', status,
 * band | xHeight, arms:[{ bearing, dest:[], route, routeStatus, patch:{route,status}, distance }],
 * lanes:[{ arrows:['left','ahead'], dest, route }], dest/route/distance/symbol/dir (flag),
 * junction (motorway), detail }.
 */
export function directionSignTexture(spec) {
  return cache.get('dir', spec.type, spec, () => {
    const table = spec.type === 'flag' || spec.type === 'confirm' ? FLAG_XH_BY_BAND : XH_BY_BAND;
    const xh = spec.xHeight || table[spec.status === 'motorway' ? 'motorway' : spec.band || '30'] || 100;
    const detail = spec.detail || 1;
    switch (spec.type) {
      case 'map': return mapSign(spec, xh, detail);
      case 'stack': return stackSign(spec, xh, detail);
      case 'lanes': return lanesSign(spec, xh, detail);
      case 'confirm': return confirmSign(spec, xh, detail);
      default: return flagSign(spec, xh, detail);
    }
  });
}

// ---------- road markings (decals; transparent except the paint) ----------
const PAINT = PALETTE.markingWhite, PAINT_Y = PALETTE.markingYellow;
// Markings are drawn in mm with travel direction up the canvas (-y). Each gets a thin
// dark edge so thermoplastic reads against grey asphalt once the game's tone mapping flattens it.
function markingCanvas(wMm, hMm, detail = 1, maxPx = 1024) {
  const cv = newCanvas(wMm, hMm, detail * 0.35, maxPx);
  cv.ctx.clearRect(0, 0, cv.W, cv.H);
  cv.ctx.setTransform(cv.k, 0, 0, cv.k, cv.ox, cv.oy);
  return cv;
}
function paint(ctx, k, fill = PAINT) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5 / k; // ~2.5 px whatever the scale
  ctx.strokeStyle = 'rgba(15,15,15,0.55)';
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill();
}
/** 1038 arrow outlines (y down from the arrow top, x from the left of its bounding box). */
function laneArrowPath(ctx, kind, L) {
  const heads = SIGNS.lane_arrow_1038.symbol.headLengthMm;
  const headA = { 4000: heads['4000_ahead'], 6000: heads['6000_ahead'], 9000: 3600 }[L] || (1600 * L) / 4000;
  // turn heads are drawn at their 4 m size (1750 tall) and stretched along the lane: 2700 at 6 m (sheet 2)
  const splitH = { 4000: heads['4000_split'], 6000: heads['6000_split'], 9000: 1.5 * heads['6000_split'] }[L] || (1750 * L) / 4000;
  const vs = splitH / 1750;
  ctx.beginPath();
  const stem = (cx, yTop, wTop, yBot, wBot) => { // tapered stem, 300 at the tail
    ctx.moveTo(cx - wTop / 2, yTop); ctx.lineTo(cx + wTop / 2, yTop); ctx.lineTo(cx + wBot / 2, yBot); ctx.lineTo(cx - wBot / 2, yBot); ctx.closePath();
  };
  const ahead = (cx) => { ctx.moveTo(cx, 0); ctx.lineTo(cx + 250, headA); ctx.lineTo(cx - 250, headA); ctx.closePath(); stem(cx, headA, 120, L, 300); };
  // Side head (WD P1038): a thin chevron of barb depth D pointing `dir` (-1 left, +1 right) whose
  // back line is xb. Both barbs meet the stem through convex quarter-circle shoulders that start
  // on the back line: r2 reaches the near stem edge, r1 = r2 + stem width reaches the far edge,
  // so the stem centre is r2 + 60 behind the back line. Drawn at the 4 m size, stretched by vs.
  const sideHead = (xb, dir, yTop, D, hTip, hBot, a, b, r2, stemW) => {
    ctx.save(); ctx.translate(0, yTop); ctx.scale(1, vs); // path points take the transform as they are added
    const X = (x) => xb - dir * x; // x measured away from the tip
    const r1 = r2 + stemW, yLow = hBot - b;
    ctx.moveTo(X(-D), hTip);
    ctx.lineTo(X(0), 0);
    ctx.lineTo(X(0), a);
    ctx.arc(X(0), a + r1, r1, -Math.PI / 2, dir < 0 ? 0 : Math.PI, dir > 0); // upper shoulder to the far edge
    ctx.lineTo(X(r1), yLow + r2);
    ctx.lineTo(X(r2), yLow + r2);
    ctx.arc(X(0), yLow + r2, r2, dir < 0 ? 0 : Math.PI, -Math.PI / 2, dir < 0); // lower shoulder back to the back line
    ctx.lineTo(X(0), hBot);
    ctx.closePath();
    ctx.restore();
  };
  // every side-head tip is 600 from its stem centre: turn 750 overall, ahead+turn 850, left+right 1200
  switch (kind) {
    case 'ahead': ahead(250); break;
    case 'left': case 'right': { // barbs 300 deep, 1750 tall head (at 4 m), tip 1000 down; stem centre 300 behind the back line
      const dir = kind === 'left' ? -1 : 1;
      const xb = dir < 0 ? 300 : 450, cx = xb - dir * 300;
      sideHead(xb, dir, 0, 300, 1000, 1750, 800, 550, 240, 120);
      stem(cx, 1200 * vs, 120, L, 300);
      break;
    }
    case 'ahead_left': case 'ahead_right': { // ahead head plus a 1000 tall side head on the stem below it
      const dir = kind === 'ahead_left' ? -1 : 1;
      const cx = dir < 0 ? 600 : 250;
      ahead(cx);
      sideHead(cx + dir * 320, dir, headA - 200, 280, 575, 1000, 340, 314, 260, 120); // back line 260 + 60 off the stem centre
      break;
    }
    case 'left_right': { // two side heads on one stem, 1200 overall
      for (const dir of [-1, 1]) sideHead(600 + dir * 360, dir, 0, 240, 1000, 1750, 800, 550, 300, 120);
      stem(600, 1200 * vs, 120, L, 300);
      break;
    }
    default: ahead(250);
  }
}
const ARROW_W = { ahead: 500, left: 750, right: 750, ahead_left: 850, ahead_right: 850, left_right: 1200 };

// elongated Transport Medium capitals: drawn at cap 560 then stretched x2.857 (1600) or x5 (2800)
function wordMarking(lines, height, detail, opts = {}) {
  const stretch = height / 560, cap = 560, f = FONTS.medium;
  const gap = opts.gap ?? (height > 2000 ? 1750 : 1000);
  const w = Math.max(...lines.map((t) => textW(t, f, cap))) + 200;
  const h = lines.length * height + (lines.length - 1) * gap;
  const cv = markingCanvas(w, h, detail);
  const { ctx, k } = cv;
  // nearest line first: the first word is at the bottom of the decal (closest to the driver)
  lines.forEach((t, i) => {
    const base = h - i * (height + gap);
    ctx.save(); ctx.translate(w / 2, base); ctx.scale(f.squeeze, stretch); setFont(ctx, f, cap); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.5 / k / stretch; ctx.strokeStyle = 'rgba(15,15,15,0.55)'; ctx.strokeText(t, 0, 0);
    ctx.fillStyle = PAINT; ctx.fillText(t, 0, 0); ctx.restore();
  });
  return finish(cv, { decal: true });
}
// Tiles repeat along the road, so the mm box must fill the whole canvas: the scale is
// non-uniform and the caller sizes the mesh with texture.repeat (see makeMarking).
function tileCanvas(wMm, hMm, Wpx, Hpx) {
  const c = document.createElement('canvas');
  c.width = Wpx; c.height = Hpx;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, Wpx, Hpx);
  ctx.setTransform(Wpx / wMm, 0, 0, Hpx / hMm, 0, 0);
  return { c, ctx, k: Math.min(Wpx / wMm, Hpx / hMm), W: Wpx, H: Hpx, ox: 0, oy: 0, wMm, hMm, box: { u0: 0, u1: 1, v0: 0, v1: 1 } };
}
function tileTexture(cv) {
  const tex = finish(cv, { decal: true, tile: true });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// repeating dash tile along the travel direction (gap first, so the mark ends at the tile's far end)
function dashTile(widthMm, markMm, gapMm, colourHex = PAINT) {
  const cv = tileCanvas(widthMm, markMm + gapMm, 16, 256);
  cv.ctx.fillStyle = colourHex; cv.ctx.fillRect(0, gapMm, widthMm, markMm);
  return tileTexture(cv);
}
function solidTile(widthMm, colourHex = PAINT) {
  const cv = tileCanvas(widthMm, widthMm, 16, 16);
  cv.ctx.fillStyle = colourHex; cv.ctx.fillRect(0, 0, widthMm, widthMm);
  return tileTexture(cv);
}
function firstNumber(v, d) { if (typeof v === 'number') return v; if (Array.isArray(v)) return v[0]; if (v && typeof v === 'object') return firstNumber(v.default ?? Object.values(v)[0], d); return d; }

/**
 * Marking decal texture. opts by id: lane_arrow_1038 { kind, length }, worded legends { text, lines,
 * height }, lane_destination_1035 { text }, speed_roundel_1065 { limit, large }, box_junction_1043
 * { wMm, hMm }, mini_roundabout_1003_4 { discMm }, chevron_1042 { widthMm, spacingMm }, tiles { width }.
 * tex.userData.wMm/hMm give the decal size; tile textures repeat along the road.
 */
export function markingTexture(id, opts = {}) {
  const entry = SIGNS[id];
  if (!entry || entry.category !== 'marking') throw new Error(`signs: unknown marking "${id}"`);
  return cache.get('mark', id, opts, () => {
    const detail = opts.detail || 1, sym = entry.symbol || {};
    switch (id) {
      case 'deflection_arrow_1014': { // straight arrow; stem, head width and head length all grow with L
        const L = opts.length || 4500;
        const pick = (t, d) => t?.[L] ?? d * L / 4500; // 4.5 / 6 / 9 m from the table, scaled otherwise
        const stem = pick(sym.stemWidthMm, 150), hw = pick(sym.headWidthMm, 525), hl = pick(sym.headLengthMm, 1500);
        const cv = markingCanvas(hw, L, detail), { ctx, k } = cv;
        const c = hw / 2;
        polyPath(ctx, [[c, 0], [hw, hl], [c + stem / 2, hl], [c + stem / 2, L], [c - stem / 2, L], [c - stem / 2, hl], [0, hl]]);
        paint(ctx, k);
        return finish(cv, { decal: true });
      }
      case 'lane_arrow_1038': {
        const kind = opts.kind || 'ahead', L = opts.length || 4000;
        const cv = markingCanvas(ARROW_W[kind] || 500, L, detail), { ctx, k } = cv;
        laneArrowPath(ctx, kind, L);
        paint(ctx, k);
        return finish(cv, { decal: true });
      }
      case 'bifurcation_arrow_1039': { // Y: one stem, two heads 2.1 m apart
        const L = opts.length || 8000, cv = markingCanvas(2600, L, detail), { ctx, k } = cv;
        ctx.beginPath();
        for (const dir of [-1, 1]) {
          const cx = 1300 + dir * 1050;
          ctx.moveTo(cx, 0); ctx.lineTo(cx + 250, 1600); ctx.lineTo(cx + 100, 1600); ctx.lineTo(1300 + 100, L * 0.55); ctx.lineTo(1300 + 100, L); ctx.lineTo(1300 - 100, L); ctx.lineTo(1300 - 100, L * 0.55); ctx.lineTo(cx - 100, 1600); ctx.lineTo(cx - 250, 1600); ctx.closePath();
        }
        paint(ctx, k);
        return finish(cv, { decal: true });
      }
      case 'guidance_arrow_1038_1': case 'mini_roundabout_1003_4': {
        const disc = opts.discMm || 2000, ring = opts.circleMm || 5000, len = opts.arrowMm || 3025, S = ring + 1200;
        const cv = markingCanvas(S, S, detail), { ctx, k } = cv;
        const c = S / 2;
        if (id === 'mini_roundabout_1003_4') { circle(ctx, c, c, disc / 2); paint(ctx, k); }
        const rc = ring / 2, w = 300, span = (len - 700) / rc, headSpan = 700 / rc;
        for (let i = 0; i < (id === 'mini_roundabout_1003_4' ? 3 : 1); i++) {
          const a0 = -Math.PI / 2 + i * (2 * Math.PI) / 3; // clockwise on screen = increasing canvas angle
          ctx.beginPath(); ctx.arc(c, c, rc + w / 2, a0, a0 + span); ctx.arc(c, c, rc - w / 2, a0 + span, a0, true); ctx.closePath(); paint(ctx, k);
          const at = a0 + span, tip = a0 + span + headSpan;
          const P = (rad, a) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
          polyPath(ctx, [P(rc, tip), P(rc + 450, at), P(rc + 150, at + headSpan * 0.3), P(rc - 150, at + headSpan * 0.3), P(rc - 450, at)]); paint(ctx, k);
        }
        return finish(cv, { decal: true });
      }
      case 'give_way_triangle_1023A': {
        const cv = markingCanvas(1250, 3750, detail), { ctx, k } = cv;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(1250, 0); ctx.lineTo(625, 3750); ctx.closePath();
        ctx.moveTo(252, 600); ctx.lineTo(625, 2838); ctx.lineTo(998, 600); ctx.closePath(); // inner cut-out, reversed winding
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 2.5 / k; ctx.strokeStyle = 'rgba(15,15,15,0.55)'; ctx.stroke(); ctx.restore();
        ctx.fillStyle = PAINT; ctx.fill('evenodd');
        return finish(cv, { decal: true });
      }
      case 'stop_word_1022': return wordMarking(['STOP'], opts.height || 1600, detail);
      case 'slow_1024': return wordMarking(['SLOW'], opts.height || 1600, detail);
      case 'keep_clear_1026': return wordMarking(['KEEP', 'CLEAR'], opts.height || 1600, detail);
      case 'no_entry_1046': return wordMarking(['NO', 'ENTRY'], opts.height || 1600, detail);
      case 'bus_lane_1049A_1048': // { part:'line' } is the 1049A boundary (250, or 300), otherwise the 1048 words
        if (opts.part === 'line') return solidTile(opts.width || 250);
        return wordMarking(['BUS', 'LANE'], opts.height || 1600, detail);
      case 'lane_destination_1035': return wordMarking(opts.lines || [opts.text || 'A28'], opts.height || 1600, detail);
      case 'speed_roundel_1065': {
        const large = !!opts.large, len = large ? 7500 : 4300, stretch = len / 1500;
        const cv = markingCanvas(1500, len, detail), { ctx, k } = cv;
        ctx.save(); ctx.scale(1, stretch);
        ctx.beginPath(); ctx.arc(750, 750, 750, 0, Math.PI * 2); ctx.arc(750, 750, 600, 0, Math.PI * 2, true);
        ctx.lineWidth = 2.5 / k; ctx.strokeStyle = 'rgba(15,15,15,0.55)'; ctx.stroke(); ctx.fillStyle = PAINT; ctx.fill('evenodd');
        // Schedule 13 road-marking numerals are Transport Medium based, like every other road word
        drawText(ctx, opts.limit || '30', 750, 1030, { f: FONTS.medium, cap: 560, fill: PAINT, align: 'center' });
        ctx.restore();
        return finish(cv, { decal: true });
      }
      case 'cycle_lane_mandatory_1049B': // continuous 200 (or 250) boundary; use 1010 across junction mouths
        return solidTile(opts.width || 200);
      case 'cycle_symbol_1057': {
        const cv = markingCanvas(1100, 1600, detail), { ctx } = cv;
        ctx.save(); ctx.translate(550, 1500); ctx.scale(1100 / 374, -(1400 / 220)); // elongated along the lane
        pictBicycle(ctx, PAINT, null);
        ctx.restore();
        return finish(cv, { decal: true });
      }
      case 'zigzag_1001_4': case 'zigzag_1001_3_and_stop_1001': { // one zig and one zag, 2 m marks, ~150 mm amplitude
        if (opts.terminal) { // the 600 x 200 bar that closes each end of a zig-zag run, across the lane
          const cv = markingCanvas(600, 200, detail), { ctx, k } = cv;
          polyPath(ctx, [[0, 0], [600, 0], [600, 200], [0, 200]]); paint(ctx, k);
          return finish(cv, { decal: true });
        }
        const cv = tileCanvas(400, 4000, 64, 512), { ctx } = cv;
        ctx.beginPath(); ctx.moveTo(50, 0); ctx.lineTo(350, 2000); ctx.lineTo(50, 4000);
        ctx.lineWidth = 100; ctx.lineJoin = 'miter'; ctx.strokeStyle = PAINT; ctx.stroke();
        return tileTexture(cv);
      }
      case 'hatched_1040': case 'hatched_edge_1040_4': case 'lane_drop_hatch_1040_3': { // 45 degree diagonals, 150 wide, 3 m apart
        const sp = opts.spacingMm || 3000, lw = opts.widthMm || 150;
        const cv = tileCanvas(sp, sp, 256, 256), { ctx } = cv;
        ctx.lineWidth = lw; ctx.strokeStyle = PAINT; ctx.lineCap = 'butt';
        for (const o of [-sp, 0, sp]) { ctx.beginPath(); ctx.moveTo(o - sp * 0.2, -sp * 0.2); ctx.lineTo(o + sp * 1.2, sp * 1.2); ctx.stroke(); }
        if (id !== 'hatched_1040') { ctx.fillStyle = PAINT; ctx.fillRect(0, 0, id === 'lane_drop_hatch_1040_3' ? 200 : 150, sp); } // solid edge on the traffic side
        return tileTexture(cv);
      }
      case 'chevron_1042': { // 90 degree chevrons with the apex towards the driver, solid boundary lines
        const w = opts.widthMm || 3000, h = opts.spacingMm || 4000, st = w > 4000 ? 600 : 450, bw = w > 4000 ? 200 : 150;
        const cv = tileCanvas(w, h, 256, 512), { ctx } = cv;
        ctx.lineWidth = st; ctx.lineJoin = 'miter'; ctx.strokeStyle = PAINT;
        for (const o of [-h, 0, h]) { ctx.beginPath(); ctx.moveTo(0, o + h * 0.75 - w / 2); ctx.lineTo(w / 2, o + h * 0.75); ctx.lineTo(w, o + h * 0.75 - w / 2); ctx.stroke(); }
        ctx.fillStyle = PAINT; ctx.fillRect(0, 0, bw, h); ctx.fillRect(w - bw, 0, bw, h);
        return tileTexture(cv);
      }
      case 'box_junction_1043': {
        const w = opts.wMm || 6000, h = opts.hMm || 6000, sp = Math.min(w, h) < 9000 ? 2000 : 2500;
        const cv = markingCanvas(w, h, detail), { ctx } = cv;
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        ctx.lineWidth = 150; ctx.strokeStyle = PAINT_Y; ctx.lineCap = 'butt';
        for (let x = -h; x < w + h; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - h, h); ctx.stroke(); }
        ctx.restore();
        ctx.lineWidth = 200; ctx.strokeStyle = PAINT_Y; ctx.strokeRect(100, 100, w - 200, h - 200);
        return finish(cv, { decal: true });
      }
      case 'zebra_crossing': { // one white stripe + one gap across the road (u); the crossing depth along v
        const cv = tileCanvas(1200, 2400, 64, 16), { ctx } = cv;
        ctx.fillStyle = PAINT; ctx.fillRect(0, 0, 600, 2400);
        return tileTexture(cv);
      }
      case 'give_way_1003A': { // two 200 mm lines 300 apart, marks 600 / gaps 300 across the road
        const cv = tileCanvas(900, 700, 64, 64), { ctx } = cv;
        ctx.fillStyle = PAINT; ctx.fillRect(0, 0, 600, 200); ctx.fillRect(0, 500, 600, 200);
        return tileTexture(cv);
      }
      case 'roundabout_give_way_1003_1': case 'mini_roundabout_give_way_1003_3': { // single broken line across the road
        const mark = sym.markMm, gap = sym.gapMm, depth = sym.depthMm || firstNumber(sym.widthMm, 200);
        const cv = tileCanvas(mark + gap, depth, 64, 16), { ctx } = cv;
        ctx.fillStyle = PAINT; ctx.fillRect(0, 0, mark, depth);
        return tileTexture(cv);
      }
      case 'stop_line_1002_1': return solidTile(400);
      case 'edge_line_1012_1': return solidTile(opts.width || 150);
      case 'double_yellow_1018_1': case 'single_yellow_1017': {
        const lw = opts.width || 75, two = id === 'double_yellow_1018_1';
        if (opts.terminal) { // end bar square to the kerb: across both lines, at least 150 long
          const cv = markingCanvas(Math.max(sym.endBarLengthMm || 150, two ? 3 * lw : lw), lw, detail), { ctx, k } = cv;
          polyPath(ctx, [[0, 0], [cv.wMm, 0], [cv.wMm, lw], [0, lw]]); paint(ctx, k, PAINT_Y);
          return finish(cv, { decal: true });
        }
        if (!two) return solidTile(lw, PAINT_Y);
        const cv = tileCanvas(3 * lw, 1000, 16, 16), { ctx } = cv;
        ctx.fillStyle = PAINT_Y; ctx.fillRect(0, 0, lw, 1000); ctx.fillRect(2 * lw, 0, lw, 1000);
        return tileTexture(cv);
      }
      case 'spiral_roundabout': return markingTexture('hazard_warning_1004', opts);
      default:
        if (sym.pattern === 'dash' || sym.markMm) return dashTile(opts.width || firstNumber(sym.widthMm, 100), sym.markMm, sym.gapMm);
        if (sym.pattern === 'solid') return solidTile(opts.width || firstNumber(sym.widthMm, 100));
        throw new Error(`signs: no decal for marking "${id}"`);
    }
  });
}

/**
 * The parts a composite marking is built from, for the road builder to lay out. Only
 * spiral_roundabout is composite: its lane lines spiral outwards so each lane leaves at
 * its exit, which depends on the junction geometry, so the layout lives in the road
 * builder and this just names the decals and widths it should use.
 */
export function markingParts(id, band = '30') {
  if (id !== 'spiral_roundabout') return [{ id, role: 'single marking' }];
  const fast = Number(band) > 40;
  return [
    { id: fast ? 'hazard_warning_1004_1' : 'hazard_warning_1004', role: 'circulatory lane lines, stepped outwards (spiral) towards each exit', widthMm: fast ? 150 : 100 },
    { id: 'roundabout_give_way_1003_1', role: 'give way line across each entry', widthMm: firstNumber(SIGNS.roundabout_give_way_1003_1.symbol.widthMm, 200) },
    { id: 'lane_arrow_1038', role: 'lane arrows on each entry approach' },
    { id: 'lane_destination_1035', role: 'route numbers / destinations painted in the circulating lanes' },
    { id: 'hatched_edge_1040_4', role: 'hatched sliver against the central island' },
  ];
}
/** Carriageway cross-section in metres (TSM5), e.g. crossSection('xsec_dual_2lane').lanesM. */
export function crossSection(id) {
  const x = CROSS_SECTIONS[id];
  if (!x) throw new Error(`signs: unknown cross-section "${id}"`);
  return x;
}

// ---------- sizes and placement ----------
function bandPick(table, band) {
  if (!table) return undefined;
  if (table[band] != null) return table[band];
  const keys = Object.keys(table).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  let v;
  for (const k of keys) if (k <= Number(band)) v = table[k];
  return v ?? table[keys[0]];
}
// TSM3 Tables 8-1 / 8-2 keys for the `at` option of signSize
const SPEED_AT = { roundaboutApproach: 'approachToRoundabout', roundaboutExit: 'exitFromRoundabout', sideRoad: 'sideRoadApproachPriorityJunction', signals: 'signalJunctionOther' };
/**
 * Speed-limit roundel diameter. band is the road's limit ('nsl' = 60 single / 70 dual).
 * opts: { dual, wide (single >= 10 m), motorway, at: 'roundaboutApproach'|'roundaboutExit'|
 * 'sideRoad'|'signals', higherLimit (the sign showing the higher limit), endOf20, limit, lit }.
 */
function speedSize(entry, band, opts) {
  if (entry.id === 'speed_repeater') {
    const by = entry.sizes.byLimit, lim = String(opts.limit || band);
    if (lim === 'nsl') return opts.dual ? by.nsl_lit_dual : by.nsl_lit_single; // NSL repeaters only on lit roads
    return by[lim] ?? by[`${lim}_unlit`] ?? by[`${lim}_dual`] ?? 300;
  }
  const s = entry.sizes;
  if (opts.endOf20) return s.endOf20Limit;
  if (opts.higherLimit) return s.signShowingHigherLimit;
  const b = String(band) === 'nsl' ? (opts.dual || opts.motorway ? '70' : '60') : String(band);
  if (opts.at && SPEED_AT[opts.at]) return bandPick(s.atJunctions[SPEED_AT[opts.at]], b) || 600;
  const t = s.otherThanJunctions;
  const table = opts.motorway ? t.motorway : opts.dual ? t.dual : opts.wide ? t.wideSingle10m : t.singleOrOneWay;
  // below the first band a table lists (a 30 dual, say) the ordinary single-carriageway size applies
  const listed = Object.keys(table).some((k) => Number(k) <= Number(b));
  return (listed ? bandPick(table, b) : bandPick(t.singleOrOneWay, b)) || 600;
}
/** Face size (mm) for a catalogue sign at a speed band: diameter, triangle height, or the rect box. */
export function signSize(id, band = '30', opts = {}) {
  const entry = SIGNS[resolveId(id).id];
  const s = entry.sizes || {};
  if (entry.id.startsWith('speed_')) return speedSize(entry, band, opts);
  if (s.byBand) return bandPick(s.byBand, band);
  if (s.fixed) return s.fixed[1]; // one-size rectangles are measured by height
  if (entry.id === 'mini_roundabout') return bandPick({ 20: 600, 30: 600, 40: 750 }, band);
  if (entry.id === 'chevron_board') return bandPick(s.heightByBand, band);
  if (entry.id === 'zone_20') return 780;
  if (entry.id === 'countdown_markers') return 1200;
  if (entry.id === 'keep_left_bollard') return 300;
  if (entry.category === 'plate') return bandPick(entry.legend?.xHeightMmByBand || { 20: 62.5, 30: 62.5, 40: 75, 50: 100, 60: 125, 70: 125 }, band);
  if (entry.id === 'dual_carriageway_ahead') return bandPick(entry.legend?.xHeightMmByBand, band) || 100;
  if (entry.id === 'town_entry') return bandPick({ 20: 70, 30: 100, 40: 125, 50: 150 }, band);
  return 600;
}
/** Siting numbers for the road builder, straight from the spec. */
export function signPlacement(id, band = '30') {
  const entry = SIGNS[resolveId(id).id];
  const p = entry.placement || {}, m = entry.mount || {};
  let distanceBefore = 0;
  if (p.gameDefaultDistanceM) distanceBefore = bandPick(p.gameDefaultDistanceM, band);
  else if (p.distanceFromJunctionM) distanceBefore = firstNumber(bandPick(p.distanceFromJunctionM, band), 45);
  else if (p.distanceBeforeLineM) distanceBefore = firstNumber(bandPick(p.distanceBeforeLineM, band), 45);
  else if (p.distanceBeforeStopLineM != null) distanceBefore = p.distanceBeforeStopLineM;
  else if (p.distanceBeforeGiveWayLineM != null) distanceBefore = p.distanceBeforeGiveWayLineM;
  else if (p.distanceYards) distanceBefore = p.distanceYards[823] * 0.9144;
  const rep = p.repeaters?.[band] || p.repeaters?.[`${band}_unlit`] || p.repeaters?.[`${band}_dual`] || p[band];
  const lateral = m.lateral?.gameDefaultKerbToSignEdgeMm || { urban: 600, rural: 1500, dualCarriageway: 2000 };
  const lower = m.lowerEdgeAboveCarriagewayMm || [900, 1500];
  return {
    distanceBefore,
    repeaterSpacing: rep && typeof rep === 'object' ? rep.maxSpacingM : undefined,
    repeaterSize: rep && typeof rep === 'object' ? rep.sizeMm : undefined,
    heightMin: lower[0] / 1000,
    heightMax: lower[1] / 1000,
    lateralClearance: lateral.urban / 1000,
    lateral: { urban: lateral.urban / 1000, rural: lateral.rural / 1000, dual: lateral.dualCarriageway / 1000 },
    minClearVisibility: firstNumber(bandPick(p.minClearVisibilityM, band), undefined),
    pairOnDual: /dual/i.test(JSON.stringify(p)) || entry.id.startsWith('speed_'),
    requires: p.requires || [], // markings that must go with it (e.g. 611.1 needs 1003.4 + 1003.3)
    setBack: m.setBackFromIslandNoseMm != null ? m.setBackFromIslandNoseMm / 1000 : undefined, // bollards
    // 510 on 70 mph duals: 500 m (central reserve) / 450 m (left) before the roundabout, with 511
    highSpeedDual: p.highSpeedDual70 ? { centralM: p.highSpeedDual70.centralReservationM, leftM: p.highSpeedDual70.leftSideM } : undefined,
  };
}

// ---------- three.js ----------
const matCache = new Map();
const geoCache = new Map(); // sign outlines by texture + size, post / bollard cylinders by size
const owned = new Set(); // per-mesh marking geometry, materials and tile clones, freed by disposeSigns
function cachedGeo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function faceMaterial(tex) {
  if (!matCache.has(tex)) {
    // low roughness plus a touch of self-illumination fakes retroreflective sheeting at dusk;
    // faces with see-through gaps (675A/B: two plates on one face) cut them out with alphaTest
    matCache.set(tex, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12, alphaTest: tex.userData.cutout ? 0.5 : 0 }));
  }
  return matCache.get(tex);
}
// the back shares the front's geometry and rotation (so flag points line up) and shows from behind
const backMat = new THREE.MeshStandardMaterial({ color: PALETTE.signBackGrey, roughness: 0.75, metalness: 0.25, side: THREE.BackSide });
const postMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.45, metalness: 0.6 });
const bollardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xfff6dc, emissiveIntensity: 0.35 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

/** THREE.Shape for a sign outline in metres, centred on the origin. */
function faceShape(info, wM, hM) {
  const s = new THREE.Shape();
  const r = (info.radiusMm || 0) / 1000;
  switch (info.shape) {
    case 'circle': s.absarc(0, 0, wM / 2, 0, Math.PI * 2, false); break;
    case 'octagon': {
      const Rc = (wM / 2) / Math.cos(Math.PI / 8);
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; i ? s.lineTo(Rc * Math.cos(a), Rc * Math.sin(a)) : s.moveTo(Rc * Math.cos(a), Rc * Math.sin(a)); }
      s.closePath(); break;
    }
    case 'triangle': case 'triangleDown': {
      const H = hM, L = 1.2417 * H, rr = 0.075 * H, up = info.shape === 'triangle' ? 1 : -1;
      const y0 = -up * H / 2; // base edge
      const A = [-L / 2, y0], B = [L / 2, y0], C = [0, y0 + up * (L * Math.sqrt(3)) / 2];
      const corner = (V, Pprev, Pnext) => { // tangent points and arc for one rounded corner
        const d1 = [Pprev[0] - V[0], Pprev[1] - V[1]], d2 = [Pnext[0] - V[0], Pnext[1] - V[1]];
        const n = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
        const u1 = n(d1), u2 = n(d2), t = rr * Math.sqrt(3), bis = n([u1[0] + u2[0], u1[1] + u2[1]]);
        return { t1: [V[0] + u1[0] * t, V[1] + u1[1] * t], t2: [V[0] + u2[0] * t, V[1] + u2[1] * t], c: [V[0] + bis[0] * 2 * rr, V[1] + bis[1] * 2 * rr] };
      };
      const verts = up > 0 ? [A, B, C] : [A, C, B];
      let first = true;
      for (let i = 0; i < 3; i++) {
        const k = corner(verts[i], verts[(i + 2) % 3], verts[(i + 1) % 3]);
        first ? s.moveTo(k.t1[0], k.t1[1]) : s.lineTo(k.t1[0], k.t1[1]);
        first = false;
        const a0 = Math.atan2(k.t1[1] - k.c[1], k.t1[0] - k.c[0]), a1 = Math.atan2(k.t2[1] - k.c[1], k.t2[0] - k.c[0]);
        // both vertex orders above wind anticlockwise, so every corner sweeps anticlockwise
        // (sweeping clockwise on the inverted one went 240 degrees through the face)
        s.absarc(k.c[0], k.c[1], rr, a0, a1, false);
      }
      s.closePath(); break;
    }
    case 'flag': {
      const tip = info.tipMm / 1000, dir = info.dir === 'left' ? -1 : 1, w = wM, h = hM;
      const pts = [[-w / 2, -h / 2], [w / 2 - tip, -h / 2], [w / 2, 0], [w / 2 - tip, h / 2], [-w / 2, h / 2]].map((p) => [p[0] * dir, p[1]]);
      pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
      s.closePath(); break;
    }
    default: {
      const w = wM, h = hM, rr = Math.min(r, w / 2, h / 2);
      s.moveTo(-w / 2 + rr, -h / 2);
      s.lineTo(w / 2 - rr, -h / 2); s.absarc(w / 2 - rr, -h / 2 + rr, rr, -Math.PI / 2, 0, false);
      s.lineTo(w / 2, h / 2 - rr); s.absarc(w / 2 - rr, h / 2 - rr, rr, 0, Math.PI / 2, false);
      s.lineTo(-w / 2 + rr, h / 2); s.absarc(-w / 2 + rr, h / 2 - rr, rr, Math.PI / 2, Math.PI, false);
      s.lineTo(-w / 2, -h / 2 + rr); s.absarc(-w / 2 + rr, -h / 2 + rr, rr, Math.PI, Math.PI * 1.5, false);
      s.closePath();
    }
  }
  return s;
}
/**
 * A sign face: textured front (towards -z) and grey back, centred on the origin.
 * Size comes from the texture's reference size scaled by `sizeMm` (the measure the
 * catalogue sizes by: diameter, triangle height, plate x-height...).
 */
export function signFace(tex, sizeMm) {
  const ud = tex.userData;
  const scale = sizeMm && ud.refMm ? sizeMm / ud.refMm : 1;
  const wM = (ud.wMm / 1000) * scale, hM = (ud.hMm / 1000) * scale;
  const geo = cachedGeo(`face|${tex.uuid}|${sizeMm || 0}`, () => {
    const shape = faceShape({ ...ud, radiusMm: (ud.radiusMm || 0) * scale, tipMm: (ud.tipMm || 0) * scale }, wM, hM);
    const sg = new THREE.ShapeGeometry(shape, ud.shape === 'circle' ? 48 : 8);
    // map the bounding box onto the sign's UV window in the canvas
    const uv = sg.attributes.uv, pos = sg.attributes.position, b = ud.box;
    for (let i = 0; i < uv.count; i++) {
      const u = (pos.getX(i) + wM / 2) / wM, v = (pos.getY(i) + hM / 2) / hM;
      uv.setXY(i, b.u0 + u * (b.u1 - b.u0), b.v0 + v * (b.v1 - b.v0));
    }
    return sg;
  });
  const g = new THREE.Group();
  const front = new THREE.Mesh(geo, faceMaterial(tex));
  front.rotation.y = Math.PI; // ShapeGeometry faces +z; the game wants faces towards -z
  front.castShadow = true;
  const back = new THREE.Mesh(geo, backMat);
  back.rotation.y = Math.PI; // same transform as the front, else a flag's point is mirrored on the back
  back.position.z = 0.003;
  g.add(front, back);
  g.userData = { wM, hM };
  return g;
}

function post(h, x = 0, z = 0, d = 0.076) {
  // one unit-height cylinder per diameter, stretched to the post height
  const m = new THREE.Mesh(cachedGeo(`post|${d}`, () => new THREE.CylinderGeometry(d / 2, d / 2, 1, 10)), postMat);
  m.scale.y = h;
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  return m;
}

/**
 * A complete sign assembly. Origin at the base of the post on the ground, face towards -z.
 * opts: { id | direction:spec, band, side, mount:'post'|'twin'|'wall'|'bollard'|'overhead',
 *   plate: id | { text|lines }, back: id, lowerEdge (mm), footway, dual, mirror, ...textureOpts }
 */
export function makeSign(opts = {}) {
  const { id, direction, band = '30', plate, back } = opts;
  const mount = opts.mount || (id === 'keep_left_bollard' ? 'bollard' : 'post');
  const g = new THREE.Group();
  const texOpts = { ...opts };
  // siting / sizing options don't change the drawing, so keep them out of the texture cache key
  for (const k of ['id', 'direction', 'band', 'side', 'mount', 'plate', 'back', 'lowerEdge', 'footway', 'dual', 'wide', 'motorway', 'at', 'higherLimit', 'endOf20']) delete texOpts[k];
  let tex, sizeMm, entry = null;
  if (direction) {
    tex = directionSignTexture({ band, ...direction });
  } else {
    entry = SIGNS[resolveId(id).id];
    tex = signTexture(id, texOpts);
    sizeMm = signSize(id, band, opts);
  }
  const face = signFace(tex, sizeMm);
  const { wM, hM } = face.userData;
  let lowerEdge = (opts.lowerEdge ?? (opts.footway ? 2300 : 1500)) / 1000;
  if (mount === 'overhead') lowerEdge = (opts.lowerEdge ?? 5300) / 1000;
  if (mount === 'bollard') lowerEdge = 0.7 - hM / 2;

  // roundabout island: the 606 stands on a 515 chevron board pointing left, 100 mm above it
  let board = null, boardH = 0;
  if (id === 'roundabout_island_turn_left') {
    const bh = signSize('chevron_board', band);
    board = signFace(signTexture('chevron_board', { modules: 2, dir: 'left', height: bh }), bh);
    boardH = board.userData.hM + 0.1;
  }
  // supplementary plate under the sign, gap half an x-height
  let plateGroup = null, plateH = boardH;
  if (plate && mount !== 'bollard') {
    const pid = typeof plate === 'string' ? plate : plate.id || 'distance_plate';
    const pOpts = typeof plate === 'string' ? {} : plate;
    const pl = SIGNS[resolveId(pid).id].legend || {};
    const num = (v) => (v == null ? undefined : parseFloat(v)); // '125/150' (511 under a 1200) -> 125
    // the plate's own table first (511 is 200 under a 1500, 608 is 50 at 20 mph), then the parent's
    const xh = pOpts.xh || num(pl.xHeightMmByTriangle?.[sizeMm]) || num(pl.xHeightMmByBand?.[band])
      || num(entry?.sizes?.plateXHeightByTriangle?.[sizeMm]) || num(entry?.legend?.plateXHeight?.[sizeMm]) || signSize(pid, band);
    const ptex = signTexture(pid, { ...pOpts, xh: 62.5, text: pOpts.text, lines: pOpts.lines });
    plateGroup = signFace(ptex, xh);
    plateH += plateGroup.userData.hM + xh / 2000;
  }
  const faceY = lowerEdge + plateH + hM / 2;
  face.position.set(0, faceY, -0.04);
  g.add(face);
  if (plateGroup) { plateGroup.position.set(0, lowerEdge + boardH + plateGroup.userData.hM / 2, -0.04); g.add(plateGroup); }
  if (back && mount !== 'bollard') {
    const btex = signTexture(back, {});
    const bf = signFace(btex, signSize(back, band, opts));
    bf.rotation.y = Math.PI;
    bf.position.set(0, lowerEdge + plateH + bf.userData.hM / 2, 0.04);
    g.add(bf);
  }
  if (board) { board.position.set(0, lowerEdge + board.userData.hM / 2, -0.04); g.add(board); }
  const top = faceY + hM / 2, wide = Math.max(wM, board ? board.userData.wM : 0);
  if (mount === 'post') {
    if (wide > 1.2) { g.add(post(top - 0.02, -(wide / 2 - 0.25)), post(top - 0.02, wide / 2 - 0.25)); }
    else g.add(post(top - 0.02));
  } else if (mount === 'twin' || mount === 'overhead') {
    const off = Math.max(0.3, wM / 2 - 0.25);
    g.add(post(top - 0.02, -off, 0, mount === 'overhead' ? 0.14 : 0.076), post(top - 0.02, off, 0, mount === 'overhead' ? 0.14 : 0.076));
  } else if (mount === 'bollard') {
    const body = new THREE.Mesh(cachedGeo('bollard', () => new THREE.CylinderGeometry(0.16, 0.16, 1.0, 24)), bollardMat);
    body.position.y = 0.5; body.castShadow = true;
    const bandM = new THREE.Mesh(cachedGeo('bollardBand', () => new THREE.CylinderGeometry(0.162, 0.162, 0.1, 24)), bandMat);
    bandM.position.y = 0.05;
    face.position.set(0, 0.7, -0.165);
    face.children[1].visible = false; // no grey back on a bollard: the body is behind the face
    g.add(body, bandM);
  }
  g.userData = { id: id || `direction:${direction?.type}`, band, wM, hM, lowerEdgeM: lowerEdge, topM: top, sizeMm };
  return g;
}

/**
 * A marking decal lying on the ground: origin at the decal centre, travel direction along -z.
 * opts as markingTexture plus { lengthM, widthM } to size a tiling texture.
 */
export function makeMarking(id, opts = {}) {
  let tex = markingTexture(id, opts);
  const ud = tex.userData;
  let w = ud.wMm / 1000, h = ud.hMm / 1000;
  if (ud.tile) { // repeat count is per mesh, so tiles get their own texture object (the image is shared)
    w = opts.widthM || w; h = opts.lengthM || h;
    tex = tex.clone();
    tex.repeat.set(w / (ud.wMm / 1000), h / (ud.hMm / 1000));
  }
  const geo = new THREE.PlaneGeometry(w, h);
  if (!ud.tile) { // crop the plane's UVs to the decal's window in the canvas
    const uv = geo.attributes.uv, b = ud.box;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, b.u0 + uv.getX(i) * (b.u1 - b.u0), b.v0 + uv.getY(i) * (b.v1 - b.v0));
  }
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  owned.add(geo).add(mat);
  if (ud.tile) owned.add(tex); // the per-mesh clone; the shared image belongs to the cache
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  m.receiveShadow = true;
  m.userData = { id, wM: w, hM: h };
  return m;
}

/**
 * Wait for the legend fonts; call once before drawing many signs. If a real Transport face
 * is declared with @font-face it is used at its own weight (the TTFs are already heavy, so
 * asking for 800 would faux-bold them).
 */
export async function signsReady() {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(Object.values(FONTS).map((f) => document.fonts.load(`100px "${f.real}"`)));
    await document.fonts.ready;
    const loaded = new Set([...document.fonts].filter((ff) => ff.status === 'loaded').map((ff) => ff.family.replace(/["']/g, '')));
    let real = false;
    for (const f of Object.values(FONTS)) if (loaded.has(f.real)) { f.weight = 400; f.squeeze = 1; real = true; }
    // only a real Transport face changes how signs are drawn; then redraw from scratch
    if (real) disposeSigns();
  } catch { /* system fonts are fine */ }
  capCache.clear();
}

/**
 * Free every sign texture, material and geometry this module made (leaving the Kent world).
 * Meshes still holding them must be removed from the scene first; later makeSign() calls
 * simply redraw.
 */
export function disposeSigns() {
  cache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const o of owned) o.dispose();
  owned.clear();
  capCache.clear();
}
