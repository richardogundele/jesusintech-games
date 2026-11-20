// Large-scale variation over a tiled surface, in world space. A tiled grass or asphalt set repeats
// every few metres and the eye finds the repeat at once across a field or down a road; a slow
// value noise (two octaves, tens of metres) that darkens, lightens and warms the diffuse colour
// breaks it the way real ground varies -- damp patches, worn strips, a change of soil -- without
// another texture. Lives here, not in materials.js, because tools/lesson-check.mjs stubs that file
// out and the road builder has to bundle headless.

/** world-position varyings for a MeshStandardMaterial's shader (InstancedMesh-aware) */
function worldVaryings(shader) {
  if (shader.vertexShader.includes('varying vec3 vWPos;')) return;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fwp = vec4(transformed, 1.0);
      vec3 fwn = objectNormal;
      #ifdef USE_INSTANCING
        fwp = instanceMatrix * fwp;
        fwn = mat3(instanceMatrix) * fwn;
      #endif
      vWPos = (modelMatrix * fwp).xyz;
      vWN = normalize(mat3(modelMatrix) * fwn);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;');
}

/**
 * Composes with a material's own onBeforeCompile.
 *   scale: metres per noise cell (the first octave); amount: +-brightness at full swing;
 *   warm: how far the warm/cool drift goes (0 for none).
 */
export function macroVary(mat, { scale = 23, amount = 0.14, warm = 0.03 } = {}) {
  const prev = mat.onBeforeCompile;
  const uniforms = { uMacroScale: { value: scale }, uMacroAmt: { value: amount }, uMacroWarm: { value: warm } };
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform float uMacroScale, uMacroAmt, uMacroWarm;
      float macroHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float macroNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(macroHash(i), macroHash(i + vec2(1, 0)), f.x), mix(macroHash(i + vec2(0, 1)), macroHash(i + vec2(1, 1)), f.x), f.y);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 mp = vWPos.xz / uMacroScale;
        float mn = macroNoise(mp) * 0.65 + macroNoise(mp * 3.1 + 7.3) * 0.35 - 0.5;
        diffuseColor.rgb *= 1.0 + mn * 2.0 * uMacroAmt;
        diffuseColor.rgb *= vec3(1.0 + mn * uMacroWarm, 1.0, 1.0 - mn * uMacroWarm);
      }`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-macro-${scale}-${amount}-${warm}`;
  return mat;
}

/**
 * What is painted on to the land, and in what order (renderOrder): the land itself first, then the
 * landuse fields, the car park and drive surfaces, the railway's ballast, and the coat of tarmac
 * under a junction's mouth. Everything else in the scene is drawn after, at the usual 0.
 *
 * These lie on the land rather than stand on it, and none of them writes depth (underlayOf): whatever
 * is drawn after them -- the roads above all -- is compared with the land alone and always comes out
 * on top. Height could not keep them apart. A field lay 4 to 16 mm under the tarmac, the two laid on
 * the hills from different triangles, and wherever they disagreed by more than that the field came up
 * through the road in pale green patches (at 1.9% of the carriageway triangles in the Guildford
 * tiles sampled, 2.6% of Leeds's, 0.4% of Coventry's).
 * A world that adds its own land mesh gives it UNDERLAY.land.
 */
export const UNDERLAY = { land: -40, field: -30, lot: -28, ballast: -26, apron: -24 };

const UNDER = new WeakMap();
/** a material's painted-on twin: the same surface, but it writes no depth (see UNDERLAY). One per material, shared. */
export function underlayOf(mat) {
  let u = UNDER.get(mat);
  if (!u) {
    u = mat.clone();
    u.depthWrite = false;
    u.polygonOffset = false;
    // (clone() leaves these behind: the slow variation above is patched in through them)
    u.onBeforeCompile = mat.onBeforeCompile;
    u.customProgramCacheKey = mat.customProgramCacheKey;
    UNDER.set(mat, u);
  }
  return u;
}
