import * as THREE from 'three';

// JesusInTech brand graphics for the 3D world — billboards, the arena LED show and
// world signage all draw from one system so the look is consistent everywhere.
// Brand: ink #050607, white, cyan #35AEE2, with a warm gold #e8c77a as the lux accent.
// Everything is drawn to a canvas (crisp, no image files, no network), so it stays
// sharp at any billboard size and matches the game's procedural-texture approach.

export const BRAND = {
  ink: '#050607', ink2: '#0b1620', inkEdge: '#0e1c26',
  cyan: '#35aee2', cyanDeep: '#1f93c6', cyanSoft: 'rgba(53,174,226,0.16)',
  white: '#ffffff', mute: 'rgba(255,255,255,0.74)', muteInk: 'rgba(8,16,26,0.66)',
  gold: '#e8c77a', paper: '#f4f1e9',
};
const FACE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ---------- canvas text helpers ---------- */
function setTracking(ctx, px) { try { ctx.letterSpacing = `${px}px`; } catch { /* older canvas */ } }
function fitFont(ctx, text, maxW, start, weight = '800', min = 44) {
  let size = start;
  ctx.font = `${weight} ${size}px ${FACE}`;
  while (size > min && ctx.measureText(text).width > maxW) { size -= 4; ctx.font = `${weight} ${size}px ${FACE}`; }
  return size;
}
// Greedy wrap into at most `maxLines`, shrinking first so the whole headline fits.
function layoutTitle(ctx, text, maxW, start, maxLines = 2, weight = '800') {
  let size = start;
  const wrap = (s) => {
    ctx.font = `${weight} ${size}px ${FACE}`;
    const words = text.split(' ');
    const lines = []; let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  let lines = wrap(size);
  while ((lines.length > maxLines || lines.some((l) => { ctx.font = `${weight} ${size}px ${FACE}`; return ctx.measureText(l).width > maxW; })) && size > 46) {
    size -= 4; lines = wrap(size);
  }
  return { lines, size };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// The JesusInTech "J" monogram tile, used small as a logo and huge as a ghost device.
function monogram(ctx, x, y, s, { bg = BRAND.cyan, fg = BRAND.ink, radius = 0.22 } = {}) {
  ctx.save();
  roundRect(ctx, x, y, s, s, s * radius);
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  setTracking(ctx, 0);
  ctx.font = `900 ${s * 0.68}px ${FACE}`;
  ctx.fillText('J', x + s / 2, y + s * 0.74);
  ctx.restore();
}

/* ---------- the poster ---------- */
// One premium ad/poster, drawn in three distinct families so a wall of billboards
// has variety, not a colour-swapped template:
//   ink   — dark board, white headline, cyan rule (the default, most legible at distance)
//   cyan  — cyan field, ink headline, giant white ghost "J"
//   light — warm paper, ink headline on a cyan underline
export function drawPoster(ctx, w, h, spec = {}) {
  const { kicker = '', title = '', sub = '', url = '', theme = 'ink', tag = 'JESUSINTECH' } = spec;
  const pad = Math.round(w * 0.075);
  const maxW = w - pad * 2;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';

  let head = BRAND.white, body = BRAND.mute, kick = BRAND.cyan, rule = BRAND.cyan;
  if (theme === 'ink') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, BRAND.ink); g.addColorStop(0.62, BRAND.ink2); g.addColorStop(1, BRAND.inkEdge);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = 0.5;
    const glow = ctx.createRadialGradient(w * 0.86, h * -0.12, 0, w * 0.86, h * -0.12, w * 0.7);
    glow.addColorStop(0, BRAND.cyanSoft); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h); ctx.restore();
    monogram(ctx, w - pad - w * 0.28, h * 0.055, w * 0.28, { bg: 'rgba(53,174,226,0.09)', fg: 'rgba(53,174,226,0.15)', radius: 0.24 });
  } else if (theme === 'cyan') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, BRAND.cyan); g.addColorStop(1, BRAND.cyanDeep);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    monogram(ctx, w - pad - w * 0.30, h * 0.06, w * 0.30, { bg: 'rgba(255,255,255,0.12)', fg: 'rgba(255,255,255,0.2)', radius: 0.22 });
    head = BRAND.ink; body = BRAND.muteInk; kick = 'rgba(6,19,28,0.82)'; rule = BRAND.ink;
  } else { // light / paper
    ctx.fillStyle = BRAND.paper; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,16,26,0.04)'; ctx.fillRect(0, h - h * 0.14, w, h * 0.14);
    head = BRAND.ink; body = BRAND.muteInk; kick = BRAND.cyanDeep; rule = BRAND.cyan;
  }

  // Fixed footer band at the bottom; everything else fits in the space above it.
  const ms = Math.round(h * 0.082);            // monogram / footer height
  const footTop = h - pad - ms - Math.round(h * 0.03);

  // kicker + accent rule (top-left eyebrow)
  const kickY = Math.round(h * 0.225);
  ctx.fillStyle = rule; ctx.fillRect(pad, kickY - Math.round(h * 0.08), Math.round(w * 0.095), Math.max(6, Math.round(h * 0.012)));
  if (kicker) {
    setTracking(ctx, Math.round(w * 0.006));
    ctx.font = `700 ${Math.round(h * 0.038)}px ${FACE}`;
    ctx.fillStyle = kick; ctx.textAlign = 'left';
    ctx.fillText(kicker.toUpperCase(), pad, kickY);
  }

  // headline fits inside a safe band between the kicker and the footer (≤2 lines)
  setTracking(ctx, -1);
  const bandTop = Math.round(h * 0.31);
  const reserveSub = sub ? Math.round(h * 0.09) : 0;
  const bandBot = footTop - Math.round(h * 0.03) - reserveSub;
  let { lines, size } = layoutTitle(ctx, title, maxW, Math.round(h * 0.155), 2);
  let lh = size * 1.03;
  while (lines.length * lh > (bandBot - bandTop) && size > 48) { size -= 4; const r = layoutTitle(ctx, title, maxW, size, 2); lines = r.lines; lh = size * 1.03; }
  ctx.fillStyle = head; ctx.textAlign = 'left';
  ctx.font = `800 ${size}px ${FACE}`;
  let ty = bandTop + size;
  for (const line of lines) { ctx.fillText(line, pad, ty); ty += lh; }
  const headBottom = ty - lh + size * 0.16;
  if (theme === 'light') {
    ctx.fillStyle = BRAND.cyan;
    ctx.fillRect(pad, headBottom + size * 0.14, Math.min(maxW, size * 3.6), Math.max(6, Math.round(h * 0.018)));
  }

  // sub line, only when it clears the footer
  if (sub) {
    const subY = headBottom + Math.round(h * 0.085);
    if (subY < footTop) {
      setTracking(ctx, 0);
      ctx.font = `500 ${Math.round(h * 0.05)}px ${FACE}`;
      ctx.fillStyle = body;
      ctx.fillText(sub, pad, subY);
    }
  }

  // footer: wordmark (with mark) left, url right
  const fy = h - pad;
  monogram(ctx, pad, fy - ms, ms, theme === 'cyan'
    ? { bg: BRAND.ink, fg: BRAND.cyan } : { bg: BRAND.cyan, fg: BRAND.ink });
  setTracking(ctx, Math.round(w * 0.004));
  ctx.font = `800 ${Math.round(h * 0.046)}px ${FACE}`;
  ctx.fillStyle = theme === 'ink' ? 'rgba(255,255,255,0.9)' : head;
  ctx.textAlign = 'left';
  ctx.fillText(tag, pad + ms + Math.round(w * 0.02), fy - ms * 0.26);
  if (url) {
    setTracking(ctx, 0);
    ctx.font = `600 ${Math.round(h * 0.044)}px ${FACE}`;
    ctx.fillStyle = theme === 'cyan' ? 'rgba(6,19,28,0.8)' : BRAND.cyan;
    ctx.textAlign = 'right';
    ctx.fillText(url, w - pad, fy - ms * 0.26);
  }
  ctx.restore();
}

export function posterTexture(spec, w = 1536, h = 1024) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawPoster(c.getContext('2d'), w, h, spec);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- the campaign (real JesusInTech offers only) ---------- */
export const BILLBOARDS = [
  { kicker: 'AIOS', title: 'The system behind your next move.', sub: 'Your AI life operating system.', url: 'aios.jesusintech.com', theme: 'ink' },
  { kicker: 'JesusInTech', title: 'Use AI to create opportunity.', sub: 'Build with purpose.', url: 'jesusintech.com', theme: 'cyan' },
  { kicker: 'SPath', title: 'One workflow. Whole job search.', sub: 'Find it, apply, follow up.', url: 'jesusintech.com/spath', theme: 'light' },
  { kicker: 'New book', title: 'The Survival Mandate.', sub: 'A new book — Richard Ogundele.', url: 'jesusintech.com', theme: 'ink' },
  { kicker: 'JesusInTech Agents', title: 'AI agents that do the work.', sub: 'Human approval built in.', url: 'agents.jesusintech.com', theme: 'cyan' },
  { kicker: 'Remember this', title: 'Faith doesn’t remove the work.', sub: 'Opportunity. Protection. Character.', url: 'jesusintech.com', theme: 'light' },
];

/* ---------- the billboard object ---------- */
// A lit roadside billboard: the poster reads like an illuminated panel (unlit material,
// so colours stay true day or night), in a dark frame, on twin pylons by default.
export function buildBillboard({ width = 14, ratio = 1.5, spec, legs = true, height } = {}) {
  const g = new THREE.Group();
  const w = width, h = width / ratio;
  const tex = posterTexture(spec, 1536, Math.round(1536 / ratio));
  const panelY = (height ?? (legs ? h / 2 + 7 : h / 2));

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.7, h + 0.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.7, roughness: 0.5 }),
  );
  frame.position.set(0, panelY, 0);
  frame.castShadow = true;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
  );
  panel.position.set(0, panelY, 0.28);
  // back face so the board isn't see-through from behind
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.8 }));
  back.position.set(0, panelY, -0.26); back.rotation.y = Math.PI;
  g.add(frame, panel, back);

  // slim cyan lightbar along the bottom edge, so it glows at night
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.18, 0.12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(BRAND.cyan).multiplyScalar(2.2), toneMapped: false }),
  );
  bar.position.set(0, panelY - h / 2 - 0.2, 0.34);
  g.add(bar);

  if (legs) {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, metalness: 0.8, roughness: 0.5 });
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, panelY - h / 2 + 0.3, 12), legMat);
      leg.position.set(sx * w * 0.3, (panelY - h / 2) / 2, 0);
      leg.castShadow = true;
      g.add(leg);
    }
  }
  g.userData.panel = panel;
  return g;
}
