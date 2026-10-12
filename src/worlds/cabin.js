import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { setupSky, Colliders } from './common.js';
import { hdri, pbr } from '../assets.js';
import { mesh } from '../models.js';

// The cabin at cruise: sized from the jet's real fuselage, with real window openings so you
// see the sky and a cloud deck sliding past. Walk around; sit in your seat to start the descent.

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    for (const [dx, dy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) ctx.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function mapTexture(fromName, toName, jet, time) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 576);
  g.addColorStop(0, '#0b1a2a'); g.addColorStop(1, '#050b12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 576);
  ctx.strokeStyle = 'rgba(53,174,226,0.15)';
  for (let x = 0; x < 1024; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 576); ctx.stroke(); }
  for (let y = 0; y < 576; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
  const A = [220, 200], B = [800, 360];
  ctx.strokeStyle = '#35aee2'; ctx.lineWidth = 4; ctx.setLineDash([14, 10]);
  ctx.beginPath(); ctx.moveTo(...A); ctx.quadraticCurveTo(520, 120, ...B); ctx.stroke(); ctx.setLineDash([]);
  for (const [p, n] of [[A, fromName], [B, toName]]) {
    ctx.fillStyle = '#e8c77a'; ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 30px Helvetica Neue, Arial'; ctx.fillText(n.toUpperCase(), p[0] - 40, p[1] + 46);
  }
  ctx.save(); ctx.translate(470, 170); ctx.rotate(0.25); ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-18, -18); ctx.lineTo(-10, 0); ctx.lineTo(-18, 18); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 24px Helvetica Neue, Arial';
  ctx.fillText(`${jet.maker} ${jet.model}  ·  45,000 ft  ·  Mach ${jet.mach}  ·  ${time}`, 40, 540);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCabin(renderer, jet, { fromName, toName, time }) {
  const scene = new THREE.Scene();
  const env = setupSky(scene, renderer, { hdri: hdri('monaco'), sunAzimuth: 95, exposure: 1.05, envIntensity: 0.32, sunIntensity: 2.6, fogDensity: 0.00012 });
  const colliders = new Colliders();
  const tickers = [];

  // dimensions from the real fuselage
  const Ri = jet.R - 0.13;
  const cy = Ri * 0.38;                       // tube centre above the floor
  const half = Math.sqrt(Ri * Ri - cy * cy);  // floor half-width
  const Lc = Math.max(9, jet.L * 0.5);        // cabin length
  const zF = Lc / 2, zA = -Lc / 2;

  // ---- shell with real window holes ----
  const winY = 1.05;
  const thW = Math.asin(THREE.MathUtils.clamp((winY - cy) / Ri, -1, 1));
  const nWin = Math.max(5, Math.round(jet.win * 0.85));
  const winZ = [];
  for (let i = 0; i < nWin; i++) winZ.push(zF - 1.6 - (i * (Lc - 3.0)) / (nWin - 1));
  const ww = jet.winW * 0.95, wh = jet.winH * 0.95;
  const th0 = -Math.asin(cy / Ri), th1 = Math.PI - th0;
  const nz = Math.ceil(Lc / 0.05), nt = 140;
  const pos = [], col = [], idx = [];
  const cWall = new THREE.Color(0xd9ccb6), cCeil = new THREE.Color(0xeee7dc);
  for (let iz = 0; iz <= nz; iz++) {
    const z = zA + (iz / nz) * Lc;
    for (let it = 0; it <= nt; it++) {
      const th = th0 + (it / nt) * (th1 - th0);
      const x = Ri * Math.cos(th), y = cy + Ri * Math.sin(th);
      pos.push(x, y, z);
      const c = y > 1.55 ? cCeil : cWall;
      col.push(c.r, c.g, c.b);
    }
  }
  const inWindow = (z, th) => {
    for (const side of [thW, Math.PI - thW]) {
      const arc = (th - side) * Ri;
      for (const wz of winZ) {
        const dz = (z - wz) / (ww / 2), da = arc / (wh / 2);
        if (dz * dz + da * da < 1) return true;
      }
    }
    return false;
  };
  for (let iz = 0; iz < nz; iz++) {
    for (let it = 0; it < nt; it++) {
      const zc = zA + ((iz + 0.5) / nz) * Lc, tc = th0 + ((it + 0.5) / nt) * (th1 - th0);
      if (inWindow(zc, tc)) continue;
      const a = iz * (nt + 1) + it, b = a + 1, c = a + (nt + 1), d = c + 1;
      idx.push(a, c, b, b, c, d); // wound to face inward
    }
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  shellGeo.setIndex(idx);
  shellGeo.computeVertexNormals();
  const shell = mesh(shellGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), { receive: true });
  scene.add(shell);

  // window frames (soft oval rings) facing the cabin centre
  const frameGeo = new THREE.TorusGeometry(1, 0.035, 6, 32);
  const frames = new THREE.InstancedMesh(frameGeo, new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.5 }), winZ.length * 2);
  const o = new THREE.Object3D();
  let k = 0;
  for (const side of [thW, Math.PI - thW]) for (const wz of winZ) {
    o.position.set(Ri * Math.cos(side) * 0.985, cy + Ri * Math.sin(side) * 0.985, wz);
    o.lookAt(0, cy, wz);
    o.scale.set(ww / 2 * 1.04, wh / 2 * 1.04, 0.5);
    o.updateMatrix();
    frames.setMatrixAt(k++, o.matrix);
  }
  scene.add(frames);

  // ---- floor, ledges, bulkheads, lighting ----
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, Lc), new THREE.MeshStandardMaterial({ color: 0xb9ab95, roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.receiveShadow = true;
  scene.add(carpet);
  const veneer = pbr('dark_wood', { repeat: [1, 6], color: 0xb08a66 });
  for (const s of [-1, 1]) {
    const ledge = mesh(new THREE.BoxGeometry(0.28, 0.06, Lc - 1), veneer);
    ledge.position.set(s * (half - 0.16), 0.66, 0);
    scene.add(ledge);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, Lc - 0.6), new THREE.MeshBasicMaterial({ color: 0xb89a6c }));
    led.position.set(s * Ri * 0.55, cy + Ri * 0.83, 0);
    scene.add(led);
  }
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xffd9a8, 2.6, 6, 1.6);
    l.position.set(0, cy + Ri * 0.7, zA + Lc * (0.2 + i * 0.3));
    scene.add(l);
  }
  const bulk = (z, label) => {
    const g = new THREE.Group();
    const wall = mesh(new THREE.BoxGeometry(half * 2.2, Ri * 1.5, 0.08), new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 0.7 }));
    wall.position.y = Ri * 0.6;
    g.add(wall);
    const door = mesh(new THREE.BoxGeometry(0.7, 1.75, 0.1), veneer);
    door.position.set(0, 0.88, 0);
    g.add(door);
    g.position.z = z;
    scene.add(g);
    return g;
  };
  bulk(zF, 'cockpit');
  bulk(zA, 'stateroom');
  // flight map screen on the forward bulkhead
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.56), new THREE.MeshBasicMaterial({ map: mapTexture(fromName, toName, jet, time) }));
  screen.position.set(half * 0.6, 1.3, zF - 0.06);
  screen.rotation.y = Math.PI;
  scene.add(screen);

  // ---- furniture ----
  const leather = new THREE.MeshStandardMaterial({ color: 0xe6d9c2, roughness: 0.55 });
  const stitch = new THREE.MeshStandardMaterial({ color: 0x8b6a4a, roughness: 0.6 });
  const rb = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, r);
  const seatX = half - 0.62;
  const seat = (x, z, facing) => {
    const g = new THREE.Group();
    const base = mesh(rb(0.66, 0.42, 0.7), leather); base.position.y = 0.21; g.add(base);
    const cushion = mesh(rb(0.56, 0.1, 0.6, 0.04), leather); cushion.position.set(0, 0.46, 0.03); g.add(cushion);
    const back = mesh(rb(0.66, 0.72, 0.2), leather); back.position.set(0, 0.72, -0.3); back.rotation.x = -0.12; g.add(back);
    for (const s of [-1, 1]) { const arm = mesh(rb(0.12, 0.2, 0.6, 0.05), leather); arm.position.set(s * 0.3, 0.55, 0); g.add(arm); }
    const pipe = mesh(new THREE.BoxGeometry(0.67, 0.02, 0.02), stitch); pipe.position.set(0, 1.07, -0.34); g.add(pipe);
    g.position.set(x, 0, z);
    g.rotation.y = facing > 0 ? 0 : Math.PI;
    scene.add(g);
    colliders.box(x, z, 0.75, 0.8);
    return g;
  };
  const table = (x, z, w = 0.8, d = 0.62) => {
    const top = mesh(rb(w, 0.04, d, 0.02), veneer);
    top.position.set(x, 0.72, z);
    const leg = mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }));
    leg.position.set(x, 0.36, z);
    scene.add(top, leg);
    colliders.box(x, z, w, d);
  };

  const interactions = [];
  const my = { x: seatX, z: zF - 3.0 };
  // forward club four (your seat is the forward right one, facing forward)
  for (const s of [-1, 1]) { seat(s * seatX, zF - 3.0, 1); seat(s * seatX, zF - 4.6, -1); }
  for (const s of [-1, 1]) table(s * seatX, zF - 3.8, 0.55, 0.7);
  // dining four, mid cabin
  if (Lc > 12) {
    const zd = zF - 7.6;
    table(-seatX + 0.1, zd, 0.62, 1.3);
    seat(-seatX, zd + 0.95, -1); seat(-seatX, zd - 0.95, 1);
    const credenza = mesh(rb(0.45, 0.62, 2.0), veneer); credenza.position.set(seatX + 0.08, 0.31, zd); scene.add(credenza);
    colliders.box(seatX + 0.08, zd, 0.45, 2.0);
    const vase = mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.25, 12), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0, clearcoat: 1 }));
    vase.position.set(seatX + 0.08, 0.75, zd);
    scene.add(vase);
  }
  // divan (left) and two seats (right) aft
  const zv = zA + 2.4;
  const divan = mesh(rb(0.75, 0.45, Math.min(2.6, Lc * 0.22)), leather); divan.position.set(-half + 0.5, 0.23, zv); scene.add(divan);
  const divanBack = mesh(rb(0.22, 0.55, Math.min(2.6, Lc * 0.22)), leather); divanBack.position.set(-half + 0.2, 0.6, zv); scene.add(divanBack);
  colliders.box(-half + 0.45, zv, 0.85, Math.min(2.6, Lc * 0.22));
  seat(seatX, zv + 0.7, -1); seat(seatX, zv - 0.7, 1);
  // galley forward left: walnut cabinets, marble top, champagne on ice
  const galley = mesh(rb(0.6, 1.0, 1.4), veneer); galley.position.set(-half + 0.4, 0.5, zF - 1.0); scene.add(galley);
  const marble = mesh(new THREE.BoxGeometry(0.62, 0.04, 1.42), pbr('marble_01', { repeat: [1, 2] })); marble.position.set(-half + 0.4, 1.02, zF - 1.0); scene.add(marble);
  colliders.box(-half + 0.4, zF - 1.0, 0.65, 1.45);
  const bucket = mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15 }));
  bucket.position.set(-half + 0.4, 1.15, zF - 0.8); scene.add(bucket);
  const bottle = mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), new THREE.MeshStandardMaterial({ color: 0x1e3b22, roughness: 0.2 }));
  bottle.position.set(-half + 0.4, 1.28, zF - 0.8); bottle.rotation.z = 0.25; scene.add(bottle);
  for (let i = 0; i < 4; i++) {
    const glass = mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.2, 10), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.35 }), { cast: false });
    glass.position.set(-half + 0.35, 1.14, zF - 1.35 + i * 0.12); scene.add(glass);
  }

  // ---- clouds below, sliding aft ----
  const cloudTex = cloudTexture();
  cloudTex.repeat.set(10, 10);
  for (const [y, op, sp] of [[-900, 0.9, 0.01], [-1500, 0.7, 0.005]]) {
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), new THREE.MeshBasicMaterial({ map: cloudTex.clone(), transparent: true, opacity: op, depthWrite: false, fog: true }));
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = y;
    clouds.material.map.repeat.set(10, 10);
    scene.add(clouds);
    tickers.push((t) => { clouds.material.map.offset.y = t * sp; });
  }
  // gentle turbulence
  tickers.push((t) => { scene.rotation.z = Math.sin(t * 0.7) * 0.004; });

  return {
    id: 'cabin',
    name: `${jet.model.toUpperCase()}`,
    scene, env, colliders,
    roads: [], landmarks: [],
    bounds: { minX: -half + 0.35, maxX: half - 0.35, minZ: zA + 0.4, maxZ: zF - 0.35 },
    tick: (t) => tickers.forEach((f) => f(t)),
    spawn: { x: 0, z: zF - 1.9, heading: Math.PI },
    garage: [],
    life: {},
    interactions,
    mySeat: my,
    indoors: () => true,
    cameraRig: { dist: 1.6, height: Math.min(1.5, cy + Ri - 0.3), look: 1.25, fov: 76 },
    near: 0.05,
    place: () => `Cruising · 45,000 ft · ${fromName} → ${toName}`,
  };
}
