import * as THREE from 'three';
import type { MaterialMorphState } from '../mmd/materialMorph';
import { outlineParameters, type DisplayPreset, type PresetMaterialSource } from './displayPresets';

const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
/** PMX colors are sRGB; material colors are linear. */
const linear = (v: number) => new THREE.Color().setRGB(v, v, v, THREE.SRGBColorSpace).r;

/**
 * Shows a material's material-morph state on a preset material.
 *
 * - Every preset: opacity (diffuse alpha) and the edge (color, alpha, size).
 * - MMD 風: diffuse / ambient / specular / shininess and the texture,
 *   sphere and toon factors go into the MMD shader, as in MMD.
 * - Other presets (except 粘土, which stays gray) have no MMD color terms, so the diffuse change is applied
 *   to their base color as a ratio (or an offset where the PMX value is 0)
 *   and the texture factor multiplies it; the texture factor's alpha scales
 *   the opacity. Specular, ambient, sphere and toon factors do not apply.
 */
export function applyMaterialMorphState(
  preset: DisplayPreset,
  mat: THREE.Material,
  src: PresetMaterialSource,
  s: MaterialMorphState,
): void {
  const edgeOn = src.outline.enabled ?? src.outline.visible;
  mat.userData.outlineParameters = outlineParameters(preset, {
    thickness: Math.max(s.edgeSize, 0) / 300,
    color: [s.edgeColor[0], s.edgeColor[1], s.edgeColor[2]],
    alpha: clamp01(s.edgeColor[3]),
    visible: edgeOn && s.edgeSize > 0 && s.edgeColor[3] > 0 && s.diffuse[3] > 0,
  });

  const u = mat.userData.mmdUniforms as Record<string, { value: THREE.Vector3 | THREE.Vector4 | number }> | undefined;
  if (preset === 'mmd' && u) {
    mat.opacity = clamp01(s.diffuse[3]);
    (u.mmdDiffuse.value as THREE.Vector3).set(s.diffuse[0], s.diffuse[1], s.diffuse[2]);
    (u.mmdAmbient.value as THREE.Vector3).set(...s.ambient);
    (u.mmdSpecular.value as THREE.Vector3).set(...s.specular);
    u.mmdShininess.value = s.specularity;
    (u.mmdTexMul.value as THREE.Vector4).set(...s.textureMul);
    (u.mmdTexAdd.value as THREE.Vector4).set(...s.textureAdd);
    (u.mmdSphereMul.value as THREE.Vector4).set(...s.sphereMul);
    (u.mmdSphereAdd.value as THREE.Vector4).set(...s.sphereAdd);
    (u.mmdToonMul.value as THREE.Vector4).set(...s.toonMul);
    (u.mmdToonAdd.value as THREE.Vector4).set(...s.toonAdd);
    return;
  }

  mat.opacity = clamp01(s.diffuse[3] * s.textureMul[3] + s.textureAdd[3]);
  const colored = mat as THREE.Material & { color?: THREE.Color };
  // Clay is one gray on purpose: only visibility changes there.
  if (!colored.color || preset === 'clay') return;
  const base: THREE.Color = (mat.userData.morphBaseColor ??= colored.color.clone());
  const c = colored.color;
  const channel = (i: 0 | 1 | 2) => {
    const from = linear(src.diffuse[i]);
    const to = linear(clamp01(s.diffuse[i]));
    const b = [base.r, base.g, base.b][i];
    const diffused = from > 1e-4 ? (b * to) / from : b + to;
    return diffused * Math.max(s.textureMul[i], 0) + linear(clamp01(s.textureAdd[i]));
  };
  c.setRGB(channel(0), channel(1), channel(2));
}
