import * as THREE from 'three';
import { mesh, planExtrude, palms } from '../models.js';
import { label } from '../materials.js';
import { pbr } from '../assets.js';

// Dubai Hills mega mansion, inspired by the Luxe List $83M tour:
// double-height great room (floating stair, crystal chandelier, white grand piano on a round stage),
// designer kitchen + dining, casino lounge, home cinema, private bar, floating primary suite,
// infinity pool with sunken fire pit, Bugatti in the motor court.
//
// Local coordinates: house footprint x -30..30, z -18..18. Front door faces +z (the motor court),
// glass back faces -z (terrace and pool).

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const marbleTex = () => canvasTexture(1024, 1024, (ctx, w, h) => {
  ctx.fillStyle = '#f1eee9';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = `rgba(${150 + Math.random() * 30},${150 + Math.random() * 30},${158 + Math.random() * 30},${0.06 + Math.random() * 0.1})`;
    ctx.lineWidth = 3 + Math.random() * 7;
    ctx.filter = 'blur(2px)';
    ctx.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      const nx = x + (Math.random() - 0.3) * 420, ny = y + (Math.random() - 0.5) * 300;
      ctx.bezierCurveTo(x + Math.random() * 120, y + Math.random() * 120, nx - Math.random() * 120, ny - Math.random() * 120, nx, ny);
      x = nx; y = ny;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,196,188,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h); // slab joints
}, [12, 7]);

const lawnTex = () => canvasTexture(256, 256, (ctx, w, h) => {
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#4f8a35' : '#5c9a3f';
    ctx.fillRect(0, (i * h) / 8, w, h / 8);
  }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(20,60,10,${Math.random() * 0.15})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}, [60, 50]);

const screenTex = () => canvasTexture(1024, 560, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1c2b4a'); g.addColorStop(0.55, '#e98a4a'); g.addColorStop(0.62, '#f7c46a'); g.addColorStop(1, '#0b2a3a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < 18; i++) {
    const bw = 30 + Math.random() * 50, bh = 60 + Math.random() * 200;
    ctx.fillRect(i * 58 + Math.random() * 10, h * 0.62 - bh, bw, bh);
  }
  ctx.fillRect(w * 0.47, h * 0.62 - 330, 18, 330);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '800 64px Helvetica Neue, Arial';
  ctx.fillText('THE DREAM LIFE', w / 2, h * 0.86);
  ctx.font = '500 22px Helvetica Neue, Arial';
  ctx.fillStyle = '#e8c77a';
  ctx.fillText('NOW SHOWING · PRIVATE SCREENING', w / 2, h * 0.93);
});

const textTex = (text, color, font = '700 120px Helvetica Neue, Arial') => canvasTexture(1024, 256, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.textAlign = 'center';
  ctx.font = font;
  ctx.fillText(text, w / 2, h * 0.68);
});

const artTex = () => canvasTexture(512, 640, (ctx, w, h) => {
  ctx.fillStyle = '#efe7da'; ctx.fillRect(0, 0, w, h);
  const cols = ['#c9a24a', '#1d2b3a', '#b5623e', '#0f5a52', '#e9c39b'];
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 30 + Math.random() * 140, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
});

export function buildMansion({ scene, colliders, tickers, origin }) {
  const O = origin;
  const g = new THREE.Group();
  g.position.set(O.x, 0, O.z);
  scene.add(g);

  const std = (color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const mat = {
    travertine: pbr('painted_plaster_wall', { repeat: [4, 2], color: 0xf6eedf }),
    white: std(0xf5f3ef, 0.55),
    marble: pbr('marble_01', { repeat: [12, 7], envMapIntensity: 0.7 }),
    walnut: pbr('dark_wood', { repeat: [1, 3] }),
    black: std(0x121316, 0.35, 0.3),
    gold: std(0xd0a94e, 0.22, 1),
    chrome: std(0xffffff, 0.06, 1),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xa9c3d1, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false }),
    tint: new THREE.MeshPhysicalMaterial({ color: 0x24323b, roughness: 0.03, metalness: 0.5, transparent: true, opacity: 0.55, depthWrite: false }),
    led: new THREE.MeshBasicMaterial({ color: 0xffdca8 }),
    felt: std(0x0e5b33, 1),
    leather: std(0x241612, 0.55),
    cream: std(0xeae0d0, 0.8),
    fabric: std(0x15161a, 0.95),
    pianoWhite: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1 }),
    granite: pbr('granite_tile', { repeat: [12, 9], color: 0x8a8a8c }),
    hedge: std(0x2e5a2a, 1),
    pool: new THREE.MeshPhysicalMaterial({ color: 0x2fc6da, roughness: 0.04, clearcoat: 1, emissive: 0x0c4f5a, emissiveIntensity: 0.5 }),
    onyx: new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
      gr.addColorStop(0, '#ffe2a8'); gr.addColorStop(1, '#b8743a');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) { ctx.strokeStyle = 'rgba(120,70,20,0.25)'; ctx.beginPath(); ctx.moveTo(0, Math.random() * h); ctx.bezierCurveTo(w * 0.3, Math.random() * h, w * 0.6, Math.random() * h, w, Math.random() * h); ctx.stroke(); }
    }) }),
    lawn: pbr('leafy_grass', { repeat: [120, 90], color: 0xa6c98f }),
  };

  // box with its BASE at y; optional world collider
  const B = (w, h, d, x, y, z, m, { collide = false, carOnly = false, cast = true } = {}) => {
    const b = mesh(new THREE.BoxGeometry(w, h, d), m, { cast: cast && !m.transparent, receive: true });
    b.position.set(x, y + h / 2, z);
    g.add(b);
    if (collide) colliders.box(O.x + x, O.z + z, w, d, 0, carOnly);
    return b;
  };
  const C = (rTop, rBot, h, x, y, z, m, seg = 24, opts = {}) => {
    const c = mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m, opts);
    c.position.set(x, y + h / 2, z);
    g.add(c);
    return c;
  };
  const plane = (w, d, x, y, z, m) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, y, z);
    p.receiveShadow = true;
    g.add(p);
    return p;
  };
  // walls with door gaps; lintel over each gap
  const segs = (a0, a1, gaps) => {
    const out = [];
    let cur = a0;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) { if (a > cur) out.push([cur, a]); cur = b; }
    if (a1 > cur) out.push([cur, a1]);
    return out;
  };
  const wallZ = (z, x0, x1, h, m, gaps = [], dh = 3.4, y0 = 0) => {
    for (const [a, b] of segs(x0, x1, gaps)) B(b - a, h, 0.4, (a + b) / 2, y0, z, m, { collide: true });
    for (const [a, b] of gaps) if (h > dh) B(b - a, h - dh, 0.4, (a + b) / 2, y0 + dh, z, m);
  };
  const wallX = (x, z0, z1, h, m, gaps = [], dh = 3.4, y0 = 0) => {
    for (const [a, b] of segs(z0, z1, gaps)) B(0.4, h, b - a, x, y0, (a + b) / 2, m, { collide: true });
    for (const [a, b] of gaps) if (h > dh) B(0.4, h - dh, b - a, x, y0 + dh, (a + b) / 2, m);
  };

  // ---------- grounds ----------
  plane(420, 320, 0, 0.012, -20, mat.lawn);
  const flag = C(0.04, 0.04, 2.4, 95, 0, -90, mat.white, 6);
  flag.castShadow = true;
  B(0.02, 0.5, 0.8, 95, 1.9, -89.6, std(0xc4111b, 0.8));
  // hedge boundary with a gate at the front
  wallZ(52, -40, 40, 2.2, mat.hedge, [[-7, 7]], 3);
  wallZ(-58, -40, 40, 2.2, mat.hedge);
  wallX(-40, -58, 52, 2.2, mat.hedge);
  wallX(40, -58, 52, 2.2, mat.hedge);
  for (const s of [-1, 1]) {
    B(1.4, 3.4, 1.4, s * 7.7, 0, 52, mat.travertine, { collide: true });
    const lamp = B(0.9, 0.3, 0.9, s * 7.7, 3.4, 52, mat.led);
    lamp.castShadow = false;
  }
  // motor court + drive to the road
  plane(48, 34, 0, 0.02, 35, mat.granite);
  plane(14, 22, 0, 0.02, 63, mat.granite);
  C(3.2, 3.4, 0.7, 0, 0, 30, mat.travertine, 32);
  C(2.8, 2.8, 0.05, 0, 0.66, 30, mat.pool, 32, { cast: false });
  C(0.18, 0.3, 1.1, 0, 0.7, 30, mat.gold, 16);
  colliders.box(O.x, O.z + 30, 6.8, 6.8);

  // ---------- house shell ----------
  plane(60, 36, 0, 0.022, 0, mat.marble);
  // front facade: travertine, double-height entrance, walnut fins
  wallZ(18, -10, 10, 12, mat.travertine, [[-3.5, 3.5]], 8);
  wallZ(18, -30, -10, 6, mat.travertine);
  wallZ(18, 10, 30, 6, mat.travertine);
  colliders.box(O.x, O.z + 18, 7, 0.8, 0, true); // cars can't drive into the house
  for (let x = -9.4; x <= 9.4; x += 1.1) {
    if (Math.abs(x) < 4.2) continue;
    B(0.18, 11.6, 0.5, x, 0.2, 18.45, mat.walnut);
  }
  const door = B(3.2, 7.9, 0.22, 0, 0, 0, mat.walnut); // pivot door, swung open
  door.position.set(-3.3, 3.95, 16.3);
  door.rotation.y = Math.PI / 2 - 0.25;
  B(0.06, 1.4, 0.12, -3.0, 3.2, 15.0, mat.gold);
  // sides
  wallX(-30, -18, 18, 6, mat.travertine);
  wallX(30, -18, 18, 6, mat.travertine);
  // glass back with sliding doors open to the terrace
  wallZ(-18, -30, 30, 6, mat.glass, [[-3, 3], [16, 22], [-24, -18]], 6);
  B(20, 6, 0.12, 0, 6, -18, mat.glass);
  for (let x = -30; x <= 30; x += 3) {
    if ([[-3, 3], [16, 22], [-24, -18]].some(([a, b2]) => x > a && x < b2)) continue;
    B(0.12, x > -10 && x < 10 ? 12 : 6, 0.25, x, 0, -18, mat.black);
  }
  // interior partitions with openings
  wallX(-10, -18, 18, 6, mat.white, [[9, 14], [-9, -4]]);
  wallX(10, -18, 18, 6, mat.white, [[3, 7], [-9, -4]]);
  B(0.4, 6, 36, -10, 6, 0, mat.white);
  B(0.4, 6, 36, 10, 6, 0, mat.white);
  wallZ(0, -30, -10, 6, mat.white, [[-22, -16]]);
  wallZ(0, 10, 30, 6, mat.fabric);

  // first floor slabs, the floating primary suite (cantilevered over the terrace), roofs
  B(20, 0.5, 36, -20, 6, 0, mat.white);
  B(20, 0.5, 44, 20, 6, -4, mat.white);
  B(19.6, 5, 35.6, -20, 6.5, 0, mat.tint);
  B(19.6, 5, 43.6, 20, 6.5, -4, mat.tint);
  B(24, 0.55, 40, -20, 11.5, 0, mat.white);
  B(24, 0.55, 48, 20, 11.5, -4, mat.white);
  B(20.8, 0.6, 37, 0, 12, 0, mat.white);
  // LED lines under every roof edge
  for (const [w, d, x, z] of [[24, 40, -20, 0], [24, 48, 20, -4]]) {
    B(w, 0.08, 0.12, x, 11.42, z + d / 2 - 0.1, mat.led, { cast: false });
    B(w, 0.08, 0.12, x, 11.42, z - d / 2 + 0.1, mat.led, { cast: false });
    B(w, 0.08, 0.12, x, 5.95, z - d / 2 + 2.1, mat.led, { cast: false });
  }
  // glass bridge across the great room
  B(20, 0.25, 3.2, 0, 6, 13, mat.glass);
  B(20, 1.1, 0.05, 0, 6.25, 11.4, mat.glass);
  B(20, 0.06, 0.08, 0, 7.35, 11.4, mat.gold);
  // upstairs furniture, seen through the glass
  B(3.2, 0.6, 3.8, 20, 6.5, -20, mat.cream);
  B(3.6, 1.6, 0.25, 20, 6.5, -22, mat.walnut);
  B(6, 0.7, 2.2, -20, 6.5, -8, mat.cream);
  B(3, 0.6, 3, 25, 6.5, -10, mat.cream);

  // ---------- Great Room ----------
  // floating curved staircase
  const steps = 26, cx = -6, cz = 9, rad = 3.4;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI * 0.55 + (i / steps) * Math.PI * 1.25;
    const tread = new THREE.Group();
    const t = mesh(new THREE.BoxGeometry(2.5, 0.12, 0.95), mat.walnut);
    const led = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 0.85), mat.led);
    led.position.y = -0.08;
    tread.add(t, led);
    tread.position.set(cx + Math.cos(a) * rad, 0.25 + (i / steps) * 5.9, cz + Math.sin(a) * rad);
    tread.rotation.y = -a;
    g.add(tread);
  }
  // gold handrail spiralling up with the treads
  const railPts = [];
  for (let i = 0; i <= 40; i++) {
    const k = i / 40;
    const a = -Math.PI * 0.55 + k * Math.PI * 1.25;
    railPts.push(new THREE.Vector3(cx + Math.cos(a) * (rad + 1.2), 1.25 + k * 5.9, cz + Math.sin(a) * (rad + 1.2)));
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 80, 0.045, 6), mat.gold));
  colliders.box(O.x + cx, O.z + cz, 9.6, 9.6);

  // crystal chandelier: a cloud of hanging rods
  const rods = 160;
  const rodGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  rodGeo.translate(0, -0.5, 0);
  const crystal = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.1 });
  const chand = new THREE.InstancedMesh(rodGeo, crystal, rods);
  const o = new THREE.Object3D();
  for (let i = 0; i < rods; i++) {
    const r = Math.sqrt(Math.random()) * 3;
    const a = Math.random() * Math.PI * 2;
    const len = 1.2 + (3 - r) * 0.9 + Math.random() * 0.6;
    o.position.set(Math.cos(a) * r, 12, -1 + Math.sin(a) * r);
    o.scale.set(1, len, 1);
    o.updateMatrix();
    chand.setMatrixAt(i, o.matrix);
  }
  g.add(chand);
  const canopy = C(3.3, 3.3, 0.15, 0, 11.85, -1, mat.gold, 40);
  canopy.castShadow = false;

  // white grand piano on a round stage
  const stage = C(3.8, 3.8, 0.28, 2.5, 0, -8, mat.marble, 48);
  stage.castShadow = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.82, 0.04, 6, 64), mat.led);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(2.5, 0.06, -8);
  g.add(ring);
  colliders.box(O.x + 2.5, O.z - 8, 6.2, 6.2);
  const piano = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(-0.75, 0); outline.lineTo(0.75, 0); outline.lineTo(0.75, 0.9);
  outline.bezierCurveTo(0.75, 1.5, 0.2, 1.5, 0.05, 2.0);
  outline.bezierCurveTo(-0.15, 2.5, -0.3, 2.75, -0.55, 2.75);
  outline.lineTo(-0.75, 2.6); outline.lineTo(-0.75, 0);
  const bodyGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.34, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
  bodyGeo.rotateX(Math.PI / 2); // lay flat: shape y -> +z, extrude goes down
  const body = mesh(bodyGeo, mat.pianoWhite);
  body.position.y = 1.0;
  piano.add(body);
  const lidGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.03, bevelEnabled: false });
  lidGeo.rotateX(Math.PI / 2);
  const hinge = new THREE.Group();
  hinge.position.set(-0.75, 1.02, 0);
  const lid = mesh(lidGeo, mat.pianoWhite);
  lid.position.x = 0.75;
  hinge.add(lid);
  hinge.rotation.z = 0.62;
  piano.add(hinge);
  const keys = mesh(new THREE.BoxGeometry(1.42, 0.08, 0.3), mat.pianoWhite);
  keys.position.set(0, 0.72, -0.15);
  const blackKeys = mesh(new THREE.BoxGeometry(1.38, 0.03, 0.14), mat.black);
  blackKeys.position.set(0, 0.77, -0.08);
  piano.add(keys, blackKeys);
  for (const [lx, lz] of [[-0.6, 0.15], [0.6, 0.15], [-0.45, 2.4]]) {
    const leg = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.66, 10), mat.pianoWhite);
    leg.position.set(lx, 0.33, lz);
    piano.add(leg);
  }
  const bench = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.38), mat.pianoWhite);
  bench.position.set(0, 0.25, -0.75);
  piano.add(bench);
  piano.position.set(2.5, 0.28, -8.6);
  piano.rotation.y = 0.5;
  g.add(piano);

  // sculptural sofa + rug, art, indoor palms
  const rug = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), std(0xcfc3ae, 1));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-3, 0.04, 2);
  g.add(rug);
  B(5, 0.75, 1.4, -3, 0, 4.2, mat.cream, { collide: true });
  B(5, 0.6, 0.35, -3, 0.75, 4.8, mat.cream);
  B(2.2, 0.4, 1.2, -3, 0, 1.6, mat.black, { collide: true });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.5), new THREE.MeshStandardMaterial({ map: artTex(), roughness: 0.8 }));
  art.position.set(9.78, 5.2, -12);
  art.rotation.y = -Math.PI / 2;
  g.add(art);
  B(0.08, 4.7, 3.8, 9.75, 2.85, -12, mat.gold, { cast: false });

  // ---------- Kitchen + dining (west, front) ----------
  B(8, 1.0, 2.2, -20, 0, 10, mat.marble, { collide: true });
  for (let i = 0; i < 4; i++) C(0.25, 0.22, 0.8, -23 + i * 2, 0, 11.6, mat.walnut, 12);
  B(18, 2.6, 0.8, -20, 0, 17.2, mat.walnut, { collide: true });
  B(18, 0.05, 0.6, -20, 2.6, 17.1, mat.led, { cast: false });
  B(2, 2.6, 0.82, -12.5, 0, 17.2, mat.black);
  for (let i = 0; i < 3; i++) {
    const pend = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat.led);
    pend.position.set(-22.5 + i * 2.5, 3.4, 10);
    g.add(pend);
  }
  B(6, 0.78, 2, -20, 0, 4, mat.black, { collide: true });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) B(0.6, 1.2, 0.6, -22.2 + i * 1.5, 0, 4 + s * 1.5, mat.cream);

  // ---------- Casino lounge (west, back) ----------
  plane(17, 15, -20, 0.035, -9, std(0x4a1418, 0.95));
  B(19.6, 0.06, 17.6, -20, 5.88, -9, mat.walnut, { cast: false });
  const poker = C(1, 1, 0.82, -21, 0, -9, mat.walnut, 32);
  poker.scale.set(2.3, 1, 1.25);
  const felt = C(0.92, 0.92, 0.04, -21, 0.82, -9, mat.felt, 32, { cast: false });
  felt.scale.set(2.3, 1, 1.25);
  colliders.box(O.x - 21, O.z - 9, 5, 2.8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    B(0.6, 1.1, 0.6, -21 + Math.cos(a) * 3.0, 0, -9 + Math.sin(a) * 1.9, mat.leather);
  }
  B(3.4, 0.85, 1.6, -14.5, 0, -13.5, mat.walnut, { collide: true });
  B(3.2, 0.03, 1.4, -14.5, 0.85, -13.5, mat.felt, { cast: false });
  C(0.5, 0.5, 0.18, -15.6, 0.86, -13.5, mat.gold, 24);
  C(0.38, 0.38, 0.2, -15.6, 0.88, -13.5, mat.black, 24);
  B(0.2, 3, 9, -29.7, 0.8, -9, mat.onyx, { cast: false });
  B(1, 1.1, 7, -27.4, 0, -9, mat.black, { collide: true });
  B(1.1, 0.05, 7.1, -27.4, 1.1, -9, mat.gold);
  const bottleColors = [0x3a5f2a, 0x7a3b12, 0xd8c08a, 0x1d3550, 0x5a1020];
  for (let i = 0; i < 24; i++) {
    const b = C(0.07, 0.08, 0.38, -29.4, 1.2 + Math.floor(i / 8) * 0.9, -12.5 + (i % 8) * 0.95, std(bottleColors[i % 5], 0.15, 0.1, { transparent: true, opacity: 0.85 }), 8);
    b.castShadow = false;
  }
  const casinoSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: textTex('CASINO', '#e8c77a'), transparent: true }));
  casinoSign.position.set(-29.55, 4.6, -9);
  casinoSign.rotation.y = Math.PI / 2;
  g.add(casinoSign);

  // ---------- Home cinema (east, front) ----------
  plane(19.6, 17.6, 20, 0.035, 9, mat.fabric);
  B(19.6, 0.06, 17.6, 20, 5.9, 9, mat.fabric, { cast: false });
  B(0.1, 5.9, 17.6, 29.75, 0, 9, mat.fabric);
  B(19.6, 5.9, 0.1, 20, 0, 17.75, mat.fabric);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 6), new THREE.MeshBasicMaterial({ map: screenTex() }));
  screen.position.set(29.65, 3.0, 9);
  screen.rotation.y = -Math.PI / 2;
  g.add(screen);
  const stars = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), 220);
  for (let i = 0; i < 220; i++) {
    o.position.set(10.5 + Math.random() * 19, 5.88, 0.5 + Math.random() * 17);
    o.scale.set(1, 1, 1);
    o.updateMatrix();
    stars.setMatrixAt(i, o.matrix);
  }
  g.add(stars);
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4; k++) {
      const x = 15 + row * 3.4, z = 4.5 + k * 3;
      B(1.1, 0.55, 1.0, x, 0, z, mat.leather);
      B(0.3, 1.1, 1.0, x - 0.55, 0, z, mat.leather);
      B(1.1, 0.75, 0.15, x, 0, z - 0.55, mat.leather);
      B(1.1, 0.75, 0.15, x, 0, z + 0.55, mat.leather);
    }
    colliders.box(O.x + 15 + row * 3.4, O.z + 9, 1.4, 11.4);
  }

  // ---------- Private bar lounge (east, back) ----------
  B(8, 0.75, 2.2, 21, 0, -7, mat.cream, { collide: true });
  B(8, 0.6, 0.4, 21, 0.75, -6.1, mat.cream);
  B(2.2, 0.75, 6, 25.9, 0, -10.9, mat.cream, { collide: true });
  B(2.6, 0.4, 1.6, 20, 0, -10.6, mat.black, { collide: true });
  B(6, 1.1, 1, 15, 0, -15, mat.black, { collide: true });
  B(6.1, 0.05, 1.1, 15, 1.1, -15, mat.gold);
  B(10, 3, 0.2, 21, 0.8, -0.35, mat.onyx, { cast: false });

  // ---------- Terrace, infinity pool, sunken fire pit ----------
  plane(68, 32, 2, 0.02, -34, mat.travertine);
  B(44, 0.25, 16, -4, -0.2, -34, mat.pool, { collide: true, cast: false });
  B(44.6, 0.3, 0.3, -4, 0, -25.85, mat.travertine);
  B(0.3, 0.3, 16.4, -26.15, 0, -34, mat.travertine);
  B(0.3, 0.3, 16.4, 18.15, 0, -34, mat.travertine);
  B(44.6, 0.06, 0.2, -4, 0.05, -42.2, mat.glass); // vanishing edge
  for (let i = 0; i < 6; i++) {
    B(0.9, 0.35, 2.1, -22 + i * 6.5, 0, -22.6, mat.white);
    B(0.9, 0.5, 0.5, -22 + i * 6.5, 0.2, -21.7, mat.white);
  }
  // fire pit: sunken lounge ring around a fire bowl
  const ringBench = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.55, 10, 40), mat.cream);
  ringBench.rotation.x = -Math.PI / 2;
  ringBench.position.set(27, 0.3, -36);
  ringBench.castShadow = true;
  g.add(ringBench);
  const pitFloor = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), mat.granite);
  pitFloor.rotation.x = -Math.PI / 2;
  pitFloor.position.set(27, 0.03, -36);
  g.add(pitFloor);
  C(1.1, 0.9, 0.5, 27, 0, -36, mat.black, 24);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 });
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1, 8), flameMat);
    const a = (i / 5) * Math.PI * 2;
    f.position.set(27 + Math.cos(a) * 0.45, 0.95, -36 + Math.sin(a) * 0.45);
    g.add(f);
    flames.push(f);
  }
  colliders.box(O.x + 27, O.z - 36, 8.6, 8.6);
  const fire = new THREE.PointLight(0xff8a3a, 30, 16, 1.6);
  fire.position.set(27, 1.6, -36);
  g.add(fire);
  tickers.push((t) => {
    flames.forEach((f, i) => { f.scale.set(1, 0.8 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.7, 1); });
    fire.intensity = 26 + Math.sin(t * 13) * 5 + Math.sin(t * 7.3) * 4;
  });

  // ---------- interior lights ----------
  const warm = (x, y, z, i, d) => { const l = new THREE.PointLight(0xffe0b0, i, d, 1.5); l.position.set(x, y, z); g.add(l); };
  warm(0, 9, -1, 55, 34);
  warm(-20, 4.5, 9, 28, 18);
  warm(-20, 4.5, -9, 30, 18);
  warm(21, 4.5, -9, 26, 18);
  const cinemaLight = new THREE.PointLight(0x6d7cff, 14, 14, 1.5);
  cinemaLight.position.set(18, 4.5, 9);
  g.add(cinemaLight);

  // ---------- planting ----------
  const pp = [];
  for (const [x, z] of [[-8, -15.5], [8, -15.5], [-34, -24], [-34, -46], [36, -24], [36, -48], [-20, 46], [20, 46], [-30, 40], [30, 40], [-14, -50], [10, -50]]) pp.push([O.x + x, O.z + z]);
  scene.add(palms(pp));

  const sign = label('Dubai Hills Mansion', { size: 2, sub: 'Home' });
  sign.position.set(O.x, 19, O.z);
  scene.add(sign);

  // ---------- api ----------
  const L = (x, z) => [x - O.x, z - O.z];
  return {
    indoors(x, z) {
      const [lx, lz] = L(x, z);
      return lx > -30 && lx < 30 && lz > -18 && lz < 18;
    },
    place(x, z) {
      const [lx, lz] = L(x, z);
      if (lx > -30 && lx < 30 && lz > -18 && lz < 18) {
        if (lx < -10) return lz > 0 ? 'Kitchen & Dining' : 'Casino Lounge';
        if (lx > 10) return lz > 0 ? 'Home Cinema' : 'Private Bar';
        return 'Great Room';
      }
      if (lx > -40 && lx < 40 && lz > -58 && lz < -18) return 'Infinity Pool';
      if (lx > -40 && lx < 40 && lz >= 18 && lz < 70) return 'Dubai Hills Mansion';
      if (Math.abs(lx) < 210 && lz > -180 && lz < 140) return 'Dubai Hills Estate';
      return null;
    },
    spawn: { x: O.x, z: O.z + 44, heading: Math.PI },
    garage: [
      { id: 'chiron', x: O.x - 10, z: O.z + 27, heading: 0 },
      { id: 'g63', x: O.x + 10, z: O.z + 27, heading: 0 },
    ],
    driveway: O.z + 70,
  };
}
