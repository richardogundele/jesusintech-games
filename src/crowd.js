import * as THREE from 'three';
import { gltf as loadGltf } from './assets.js';

// Real-looking crowds that stay fast:
//  - an impostor atlas: real 3D people (Michelle, Cesium Man) rendered once into a texture,
//    several outfits x dance frames x front/back views
//  - thousands of camera-facing cards that pick the right cell per person per frame
//  - a handful of fully 3D animated people for the rows the camera gets close to

const SKIN = [0x8d5524, 0xc68642, 0x5c3a1e, 0xe0ac69, 0x3b2414, 0xf1c27d, 0x704a2d, 0xffdbac];
const JACKET = [0x1d2a44, 0x232325, 0x5a5f66, 0xe6e0d2, 0x6b2b2b, 0x2e4a3a, 0x8a6f4d, 0x14213d, 0x35aee2, 0x7d6aa8];
const TROUSER = [0x18181a, 0x2b2f36, 0x3a3226, 0xd9d2c3, 0x1d2a44];
const pick = (a, i) => a[((i % a.length) + a.length) % a.length];

/** Dress Cesium Man by height band: shoes, trousers, jacket, skin (head/neck). */
function dressCesium(mesh, i) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3());
  const axis = size.z > size.y ? 'z' : 'y'; // the model is authored Z-up
  const min = bb.min[axis], range = size[axis];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const u = {
    uSkin: { value: new THREE.Color(pick(SKIN, i * 3 + 1)) },
    uJacket: { value: new THREE.Color(pick(JACKET, i * 7 + 2)) },
    uTrouser: { value: new THREE.Color(pick(TROUSER, i * 5)) },
    uShirt: { value: new THREE.Color(i % 3 ? 0xf2f2f0 : 0x9fb8d6) },
    uHair: { value: new THREE.Color(pick([0x0b0806, 0x1a120c, 0x2b1d12, 0x0b0806, 0x5a4632], i)) },
    uBack: { value: 0 },
  };
  mesh.userData.setBack = (b) => { u.uBack.value = b ? 1 : 0; };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying float vSide;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = (position.${axis} - ${min.toFixed(5)}) / ${range.toFixed(5)};
        vSide = abs(position.x);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying float vSide;\nuniform vec3 uSkin, uJacket, uTrouser, uShirt, uHair;\nuniform float uBack;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 c = uSkin;
        if (vH < 0.05) c = vec3(0.05);
        else if (vH < 0.47) c = uTrouser;
        else if (vH < 0.79) c = uJacket;
        else if (vH < 0.805) c = uShirt;                       // collar
        else if (vH > 0.93 || (uBack > 0.5 && vH > 0.85)) c = uHair; // hair (all of it from behind)
        if (vH < 0.5 && vH > 0.38 && vSide > 0.2) c = uSkin;   // hands
        diffuseColor.rgb = c;`);
  };
  mat.customProgramCacheKey = () => 'cesium-dress';
  mesh.material = mat;
}

/** A posed person, normalised to ~1.75 m, feet at y=0, facing +z. */
function person(kind, i) {
  const { scene, animations } = loadGltf(kind === 'michelle' ? 'michelle' : 'cesiumman');
  const holder = new THREE.Group();
  holder.add(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.castShadow = false;
    if (kind === 'cesium') dressCesium(o, i);
    else {
      const m = o.material.clone();
      const pants = new THREE.Color(pick([0x15161a, 0x2d4a7a, 0xece8df, 0x1d2a44, 0x4a5a3a, 0x6b2232, 0x9a8a6a, 0x3a3a40, 0xb8b0a0], i));
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uPants = { value: pants };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uPants;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            vec3 mc = diffuseColor.rgb;
            float yellow = smoothstep(0.12, 0.3, min(mc.r, mc.g) - mc.b) * step(mc.b * 1.6, mc.g);
            float lum = dot(mc, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(mc, uPants * (0.55 + lum * 1.4), yellow);
            float red = step(0.3, mc.r) * step(mc.g * 2.2, mc.r) * step(mc.b * 2.2, mc.r);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), red); // red shades/headphones -> black`);
      };
      m.customProgramCacheKey = () => 'michelle-pants';
      o.material = m;
    }
  });
  const mixer = new THREE.AnimationMixer(scene);
  const clip = animations.find((a) => /samba/i.test(a.name)) || animations[0];
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = (kind === 'michelle' ? 1.68 : 1.78) / Math.max(0.01, box.max.y - box.min.y);
  holder.scale.setScalar(s);
  holder.position.y = -box.min.y * s;
  // Cesium Man's head is cartoon-sized: shrink the head bone to human proportions
  const head = kind === 'cesium' ? scene.getObjectByName('Skeleton_neck_joint_2') : null;
  const fixHead = () => { if (head) head.scale.setScalar(0.7); };
  fixHead();
  return { holder, scene, mixer, clip, kind, fixHead };
}

/**
 * Render the atlas. Returns { texture, cols, rows, aspect, variants: [{base, frames}] }.
 */
export function buildCrowdAtlas(renderer, { michelle = 6, cesium = 8, frames = 6 } = {}) {
  const cellW = 150, cellH = 256, cols = 13, rows = 8;
  const W = cellW * cols, H = cellH * rows;
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 3.0));
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(1.5, 4, 5);
  const back = new THREE.DirectionalLight(0xdfe8ff, 2.6);
  back.position.set(-2, 3, -5);
  scene.add(key, back);
  const halfW = 0.66, top = 2.25;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, top, 0, 0.1, 50);

  const prev = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), tone: renderer.toneMapping };
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.autoClear = false;
  rt.scissorTest = true;

  const variants = [];
  let cell = 0;
  const draw = (p, t, view) => {
    p.scene.traverse((o) => o.userData.setBack?.(view === 'back'));
    p.mixer.setTime(t);
    p.fixHead();
    p.scene.updateMatrixWorld(true);
    cam.position.set(0, 0, view === 'front' ? 10 : -10);
    cam.lookAt(0, 0, 0);
    cam.position.y = 0; // ortho frustum already spans 0..top
    const cx = cell % cols, cy = Math.floor(cell / cols);
    rt.viewport.set(cx * cellW, cy * cellH, cellW, cellH);
    rt.scissor.set(cx * cellW, cy * cellH, cellW, cellH);
    renderer.setRenderTarget(rt);
    renderer.clearDepth();
    renderer.render(scene, cam);
    cell++;
  };
  const addVariant = (kind, i) => {
    const p = person(kind, i);
    scene.add(p.holder);
    const n = kind === 'michelle' ? frames : 2;
    const times = [];
    for (let f = 0; f < n; f++) times.push(kind === 'michelle' ? (f / n) * Math.min(p.clip.duration, 3.2) : f * 0.06);
    const base = cell;
    for (const view of ['front', 'back']) for (const t of times) draw(p, t, view);
    variants.push({ base, frames: n, kind });
    scene.remove(p.holder);
  };
  for (let i = 0; i < michelle; i++) addVariant('michelle', i);
  for (let i = 0; i < cesium; i++) addVariant('cesium', i);

  rt.scissorTest = false;
  rt.viewport.set(0, 0, W, H);
  rt.scissor.set(0, 0, W, H);
  renderer.setRenderTarget(prev.target);
  renderer.autoClear = prev.autoClear;
  renderer.setClearColor(prev.color, prev.alpha);
  return { texture: rt.texture, target: rt, cols, rows, aspect: (halfW * 2) / top, height: top, variants };
}

/** Thousands of camera-facing people. spots: [{x, y, z, face (rad, direction they look)}] */
export function crowdImpostors(atlas, spots, { light = 1.0 } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const n = spots.length;
  const iPos = new Float32Array(n * 3), iScale = new Float32Array(n), iBase = new Float32Array(n), iFrames = new Float32Array(n), iPhase = new Float32Array(n), iFace = new Float32Array(n), iTint = new Float32Array(n * 3);
  const byKind = (k) => atlas.variants.filter((v) => v.kind === k);
  spots.forEach((s, i) => {
    const pool = s.prefer ? byKind(s.prefer) : atlas.variants;
    const v = pool[(i * 7 + Math.floor(i / 13)) % pool.length];
    iPos.set([s.x, s.y, s.z], i * 3);
    iScale[i] = 0.93 + Math.random() * 0.14;
    iBase[i] = v.base;
    iFrames[i] = v.frames;
    iPhase[i] = Math.random();
    iFace[i] = s.face;
    const k = 0.82 + Math.random() * 0.3;
    iTint.set([k, k, k], i * 3);
  });
  const attr = (a, size) => new THREE.InstancedBufferAttribute(a, size);
  geo.setAttribute('iPos', attr(iPos, 3));
  geo.setAttribute('iScale', attr(iScale, 1));
  geo.setAttribute('iBase', attr(iBase, 1));
  geo.setAttribute('iFrames', attr(iFrames, 1));
  geo.setAttribute('iPhase', attr(iPhase, 1));
  geo.setAttribute('iFace', attr(iFace, 1));
  geo.setAttribute('iTint', attr(iTint, 3));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: atlas.texture }, uTime: { value: 0 }, uExcite: { value: 0.4 }, uLight: { value: light },
      uCols: { value: atlas.cols }, uRows: { value: atlas.rows }, uAspect: { value: atlas.aspect }, uHeight: { value: atlas.height },
    }]),
    fog: true,
    alphaToCoverage: true,
    vertexShader: `
      attribute vec3 iPos; attribute float iScale, iBase, iFrames, iPhase, iFace; attribute vec3 iTint;
      uniform float uTime, uExcite, uCols, uRows, uAspect, uHeight;
      varying vec2 vUv; varying vec3 vTint;
      #include <fog_pars_vertex>
      void main() {
        vec3 toCam = cameraPosition - iPos; toCam.y = 0.0;
        vec3 dir = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 right = vec3(dir.z, 0.0, -dir.x);
        float h = uHeight * iScale, w = h * uAspect;
        float bounce = abs(sin(uTime * (4.5 + iPhase * 2.5) + iPhase * 40.0)) * 0.06 * uExcite;
        vec3 p = iPos + right * position.x * w + vec3(0.0, position.y * h + bounce, 0.0);
        float dancing = step(1.0 - clamp(uExcite * 0.75, 0.0, 1.0), fract(iPhase * 7.31));
        float f = iFrames > 1.5 ? floor(mod(uTime * (6.0 + iPhase * 3.0) + iPhase * 50.0, iFrames)) * dancing : 0.0;
        vec2 face = vec2(sin(iFace), cos(iFace));
        float back = step(0.0, -dot(face, dir.xz));
        float cell = iBase + f + back * iFrames;
        float cx = mod(cell, uCols), cy = floor(cell / uCols);
        vUv = (vec2(cx, cy) + vec2(uv.x * 0.98 + 0.01, uv.y)) / vec2(uCols, uRows);
        vTint = iTint;
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float uLight;
      varying vec2 vUv; varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.35) discard;
        gl_FragColor = vec4(c.rgb * vTint * uLight, 1.0);
        #include <fog_fragment>
      }`,
  });
  // UniformsUtils.merge refuses to clone render-target textures (it nulls them), so set it afterwards
  mat.uniforms.map.value = atlas.texture;
  const meshC = new THREE.Mesh(geo, mat);
  meshC.frustumCulled = false;
  return meshC;
}

/** Fully 3D animated people for close-up rows. */
export function crowd3D(spots) {
  const group = new THREE.Group();
  const mixers = [];
  spots.forEach((s, i) => {
    const kind = 'michelle';
    const p = person(kind, i + 3);
    p.holder.position.x += s.x;
    p.holder.position.z += s.z;
    p.holder.position.y += s.y;
    p.holder.rotation.y = s.face;
    if (kind === 'cesium') p.mixer.timeScale = 0; // standing, listening
    p.mixer.setTime(Math.random() * 3);
    group.add(p.holder);
    mixers.push(p);
  });
  group.userData.update = (dt, excite) => {
    for (const p of mixers) {
      p.mixer.timeScale = p.kind === 'cesium' ? (excite > 1 ? 1.4 : 0) : 0.6 + excite * 0.6;
      p.mixer.update(dt);
    }
  };
  return group;
}
