import * as THREE from 'three';

// Shared varyings for world-space effects (works with InstancedMesh).
function injectWorldVaryings(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 fwp = vec4(transformed, 1.0);
      vec3 fwn = objectNormal;
      #ifdef USE_INSTANCING
        fwp = instanceMatrix * fwp;
        fwn = mat3(instanceMatrix) * fwn;
      #endif
      vWPos = (modelMatrix * fwp).xyz;
      vWN = normalize(mat3(modelMatrix) * fwn);`
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;'
  );
}

/**
 * Building facade: window grid drawn procedurally in world space, so any box size
 * gets correctly spaced windows. Windows are glossy so they pick up the sky.
 */
export function facadeMaterial({ winSize = [2.6, 3.2], winColor = 0x1d2733, amount = 0.9, roughness = 0.85, metalness = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness });
  const uniforms = {
    uWinSize: { value: new THREE.Vector2(...winSize) },
    uWinColor: { value: new THREE.Color(winColor) },
    uWinAmount: { value: amount },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uWinSize;\nuniform vec3 uWinColor;\nuniform float uWinAmount;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fw = 0.0;
        if (abs(vWN.y) < 0.5) {
          float u = abs(vWN.x) > 0.5 ? vWPos.z : vWPos.x;
          float fu = fract(u / uWinSize.x);
          float fv = fract(vWPos.y / uWinSize.y);
          fw = step(0.18, fu) * step(fu, 0.82) * step(0.3, fv) * step(fv, 0.86) * step(2.4, vWPos.y);
        }
        fw *= uWinAmount;
        diffuseColor.rgb = mix(diffuseColor.rgb, uWinColor, fw);`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, fw);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.5, fw);');
  };
  mat.customProgramCacheKey = () => `facade-${winSize.join('-')}-${amount}`;
  return mat;
}

/** Sea with animated sparkle (normal perturbation) and sky reflections from the env map. */
export function waterMaterial(color = 0x0c4f6e) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.1 });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec2 wp = vWPos.xz;
        vec3 wn = vec3(
          sin(wp.x * 0.35 + uTime * 1.3) * 0.05 + sin(wp.y * 0.8 - uTime * 1.7 + wp.x * 0.3) * 0.035 + sin(wp.x * 2.1 + wp.y * 1.3 + uTime * 3.1) * 0.015,
          0.0,
          cos(wp.y * 0.4 + uTime * 1.1) * 0.05 + cos(wp.x * 0.9 + wp.y * 0.5 + uTime * 2.0) * 0.03 + cos(wp.y * 2.4 - uTime * 2.7) * 0.015
        );
        wn *= smoothstep(600.0, 60.0, distance(cameraPosition, vWPos)); // calm the far water, avoids shimmer
        normal = normalize(normal + (viewMatrix * vec4(wn, 0.0)).xyz);`
      );
  };
  mat.userData.tick = (t) => { uTime.value = t; };
  return mat;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function noise(ctx, w, h, base, spread, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(Math.random() * spread);
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

/** Asphalt with painted edge lines and lane dashes. u runs across the road, v along it. */
export function roadTexture(lanes = 2) {
  return canvasTex(256, 512, (ctx, w, h) => {
    noise(ctx, w, h, '#2b2d31', 255, 9000);
    ctx.fillStyle = 'rgba(240,240,235,0.9)';
    ctx.fillRect(w * 0.035, 0, w * 0.025, h);
    ctx.fillRect(w * 0.94, 0, w * 0.025, h);
    for (let i = 1; i < lanes; i++) {
      const x = w * (0.06 + (0.88 * i) / lanes);
      if (lanes > 2 && i === lanes / 2) {
        ctx.fillStyle = 'rgba(230,190,70,0.9)';
        ctx.fillRect(x - 4, 0, 3, h);
        ctx.fillRect(x + 2, 0, 3, h);
        ctx.fillStyle = 'rgba(240,240,235,0.9)';
      } else {
        ctx.fillRect(x - 2, 0, 4, h * 0.45);
      }
    }
  });
}

export function groundTexture(base, spread = 255, count = 16000) {
  return canvasTex(512, 512, (ctx, w, h) => noise(ctx, w, h, base, spread, count));
}

export function curbTexture() {
  return canvasTex(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#d42a2a'; ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, h / 2, w, h / 2);
  });
}

/** Floating landmark label. */
export function label(text, { size = 1, color = '#ffffff', sub = '' } = {}) {
  const tex = canvasTex(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.font = '800 92px Helvetica Neue, Helvetica, Arial, sans-serif';
    ctx.fillText(text, w / 2, sub ? 120 : 160);
    if (sub) {
      ctx.fillStyle = '#e8c77a';
      ctx.font = '600 46px Helvetica Neue, Helvetica, Arial, sans-serif';
      ctx.fillText(sub.toUpperCase(), w / 2, 200);
    }
  }, false);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
  sprite.scale.set(16 * size, 4 * size, 1);
  sprite.renderOrder = 5;
  return sprite;
}

export const M = {
  paintCache: new Map(),
  paint(color) {
    if (!this.paintCache.has(color)) {
      this.paintCache.set(color, new THREE.MeshPhysicalMaterial({
        color, metalness: 0.15, roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.08, envMapIntensity: 0.45,
      }));
    }
    return this.paintCache.get(color);
  },
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0f16, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.25 }),
  darkRim: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 1, roughness: 0.3 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 2.2 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.5 }),
  hull: new THREE.MeshPhysicalMaterial({ color: 0xfafafa, roughness: 0.25, metalness: 0.1, clearcoat: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.6 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.9 }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0xb5623e, roughness: 0.85 }),
  copper: new THREE.MeshStandardMaterial({ color: 0x5f9c86, roughness: 0.55, metalness: 0.4 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x5d8a3a, roughness: 1 }),
  palmTrunk: new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 1 }),
  palmLeaf: new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.8, side: THREE.DoubleSide }),
  pool: new THREE.MeshPhysicalMaterial({ color: 0x2ec4d6, roughness: 0.05, metalness: 0, clearcoat: 1, emissive: 0x0a3f48, emissiveIntensity: 0.4 }),
  villaGlass: new THREE.MeshPhysicalMaterial({ color: 0x1b2a33, roughness: 0.03, metalness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.7, roughness: 0.4 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.7 }),
  suit: new THREE.MeshStandardMaterial({ color: 0x14213d, roughness: 0.6 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.4 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa01818, roughness: 0.7 }),
};
