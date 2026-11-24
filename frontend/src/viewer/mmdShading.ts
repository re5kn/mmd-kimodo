import * as THREE from 'three';

/**
 * MMD's own shading (Issue #11 A1), as in MMD's default effect:
 *
 *   C = sat(D·Lc + A) · T · S · toon(N·L) + (N·H)^n · Sp · Lc
 *
 * D: diffuse, A: ambient, Sp: specular color, n: specularity (PMX
 * material), Lc: light color, T: texture, S: sphere map (multiplied, or
 * added in "add" mode), toon: the toon texture read vertically (white when
 * the material has none). MMD computes in sRGB values, so the shader
 * converts texels back to sRGB, applies the formula there and converts the
 * result to linear for three.js's output stage.
 *
 * Built on MeshToonMaterial so skinning, alpha test, outlines and texture
 * plumbing stay three.js's; only the final color is replaced.
 */

/** PMX sphere modes. */
export const SphereMode = { None: 0, Multiply: 1, Add: 2, SubTexture: 3 } as const;

/** MMD's default light color (154 / 255 gray). */
export const MMD_LIGHT_COLOR = 154 / 255;

/** MMD's default light direction (the way the light travels), in three.js coordinates. */
export const MMD_LIGHT_DIRECTION: [number, number, number] = [-0.5, -1, -0.5];

/** Vertex attribute holding PMX additional UV1 (xy), for sub-texture spheres. */
export const SUB_UV_ATTRIBUTE = 'mmdSubUv';

export interface MmdShadingSource {
  /** sRGB values as stored in PMX. */
  diffuse: [number, number, number, number];
  ambient: [number, number, number];
  specular: [number, number, number];
  specularity: number;
  map: THREE.Texture | null;
  /** Toon texture (lit at the top); null = none (white). */
  toon: THREE.Texture | null;
  sphere: { map: THREE.Texture; mode: number } | null;
}

export const MMD_FINAL_COLOR_LINE =
  'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 mmdDiffuse;
uniform vec3 mmdAmbient;
uniform vec3 mmdSpecular;
uniform float mmdShininess;
uniform float mmdLightColor;
#if MMD_SPHERE_MODE > 0
  uniform sampler2D mmdSphere;
#endif
#if MMD_SPHERE_MODE == 3
  varying vec2 vMmdSubUv;
#endif
`;

const FRAGMENT_MAIN = /* glsl */ `
  vec3 mmdLightDir = vec3( 0.0, 0.0, 1.0 );
  #if NUM_DIR_LIGHTS > 0
    mmdLightDir = directionalLights[ 0 ].direction;
  #endif
  // diffuseColor.rgb holds the (linear) texture color; MMD works in sRGB.
  vec3 mmdColor = clamp( mmdDiffuse * mmdLightColor + mmdAmbient, 0.0, 1.0 );
  mmdColor *= sRGBTransferOETF( vec4( diffuseColor.rgb, 1.0 ) ).rgb;
  #if MMD_SPHERE_MODE > 0
    #if MMD_SPHERE_MODE == 3
      vec2 mmdSphereUv = vMmdSubUv;
    #else
      vec2 mmdSphereUv = vec2( normal.x * 0.5 + 0.5, normal.y * -0.5 + 0.5 );
    #endif
    vec4 mmdSph = texture2D( mmdSphere, mmdSphereUv );
    vec3 mmdSphColor = sRGBTransferOETF( mmdSph ).rgb;
    #if MMD_SPHERE_MODE == 2
      mmdColor += mmdSphColor;
    #else
      mmdColor *= mmdSphColor;
    #endif
    diffuseColor.a *= mmdSph.a;
  #endif
  #ifdef USE_GRADIENTMAP
    float mmdNL = dot( normal, mmdLightDir );
    mmdColor *= sRGBTransferOETF( texture2D( gradientMap, vec2( 0.0, 0.5 - 0.5 * mmdNL ) ) ).rgb;
  #endif
  vec3 mmdHalf = normalize( mmdLightDir + geometryViewDir );
  float mmdNH = max( dot( normal, mmdHalf ), 1e-6 );
  mmdColor += pow( mmdNH, max( mmdShininess, 1e-4 ) ) * mmdSpecular * mmdLightColor;
  vec3 outgoingLight = sRGBTransferEOTF( vec4( clamp( mmdColor, 0.0, 1.0 ), 1.0 ) ).rgb;
`;

export function createMmdMaterial(src: MmdShadingSource, params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  const sphereMode = src.sphere ? src.sphere.mode : SphereMode.None;
  const mat = new THREE.MeshToonMaterial({
    ...params,
    // The texture alone goes through three.js; MMD's colors are applied below.
    color: 0xffffff,
    map: src.map,
    gradientMap: src.toon,
  });
  mat.defines = { MMD_SPHERE_MODE: sphereMode };
  const uniforms = {
    mmdDiffuse: { value: new THREE.Vector3(src.diffuse[0], src.diffuse[1], src.diffuse[2]) },
    mmdAmbient: { value: new THREE.Vector3(...src.ambient) },
    mmdSpecular: { value: new THREE.Vector3(...src.specular) },
    mmdShininess: { value: src.specularity },
    mmdLightColor: { value: MMD_LIGHT_COLOR },
    mmdSphere: { value: src.sphere?.map ?? null },
  };
  mat.userData.mmdUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(MMD_FINAL_COLOR_LINE)) {
      console.warn('mmd shading: three.js toon shader changed; using plain toon shading');
      return;
    }
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', `#include <gradientmap_pars_fragment>\n${FRAGMENT_PARS}`)
      .replace(MMD_FINAL_COLOR_LINE, FRAGMENT_MAIN);
    if (sphereMode === SphereMode.SubTexture) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec2 ${SUB_UV_ATTRIBUTE};\nvarying vec2 vMmdSubUv;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMmdSubUv = ${SUB_UV_ATTRIBUTE};`);
    }
  };
  mat.customProgramCacheKey = () => `mmd-shading-${sphereMode}`;
  return mat;
}
