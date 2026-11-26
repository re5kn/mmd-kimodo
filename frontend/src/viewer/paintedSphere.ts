import * as THREE from 'three';
import { SphereMode } from './mmdShading';

export const PAINTED_SPHERE_ANCHOR = '#include <opaque_fragment>';

/**
 * Adds a PMX additive sphere map on top of a lit material, as MMD does.
 *
 * Jewels are often drawn this way: the base texture is a dark disc and the
 * stone (its color, sparkle and engraving) lives in the sphere map. Without
 * it a physically lit brooch renders black. The sphere is looked up with the
 * view-space normal like MMD, and added to the outgoing light so it shows
 * regardless of the scene lights. Multiply and sub-texture spheres are left
 * out: they tint shading that the lit material already provides.
 *
 * Composes with earlier onBeforeCompile patches.
 */
export function usePaintedSphere(
  mat: THREE.Material,
  sphere: { map: THREE.Texture; mode: number } | null | undefined,
): boolean {
  if (!sphere || sphere.mode !== SphereMode.Add) return false;
  const previous = mat.onBeforeCompile.bind(mat);
  const previousKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.paintedSphere = { value: sphere.map };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D paintedSphere;')
      .replace(
        PAINTED_SPHERE_ANCHOR,
        /* glsl */ `outgoingLight += texture2D( paintedSphere, vec2( normal.x * 0.5 + 0.5, normal.y * -0.5 + 0.5 ) ).rgb;
${PAINTED_SPHERE_ANCHOR}`,
      );
  };
  mat.customProgramCacheKey = () => `${previousKey()}-painted-sphere`;
  return true;
}
