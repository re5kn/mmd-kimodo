import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { PAINTED_SPHERE_ANCHOR, usePaintedSphere } from '../paintedSphere';
import { createPresetMaterial, type PresetMaterialSource } from '../displayPresets';
import { SphereMode } from '../mmdShading';

const compile = (mat: THREE.Material) => {
  const shader = {
    fragmentShader: `#include <common>\nvoid main() {\n${PAINTED_SPHERE_ANCHOR}\n}`,
    uniforms: {} as Record<string, THREE.IUniform>,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe('usePaintedSphere', () => {
  test('adds an additive sphere map to the outgoing light', () => {
    const map = new THREE.Texture();
    const mat = new THREE.MeshPhysicalMaterial();
    expect(usePaintedSphere(mat, { map, mode: SphereMode.Add })).toBe(true);
    const shader = compile(mat);
    expect(shader.uniforms.paintedSphere.value).toBe(map);
    expect(shader.fragmentShader).toMatch(/outgoingLight \+= texture2D\( paintedSphere[^\n]*\n#include <opaque_fragment>/);
    expect(mat.customProgramCacheKey()).toContain('painted-sphere');
  });

  test('leaves multiply and missing spheres alone', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    expect(usePaintedSphere(mat, { map: new THREE.Texture(), mode: SphereMode.Multiply })).toBe(false);
    expect(usePaintedSphere(mat, null)).toBe(false);
    expect(compile(mat).fragmentShader).not.toContain('paintedSphere');
  });

  test('real and figure gems show their sphere; cloth does not', () => {
    const src = (kind: PresetMaterialSource['kind']): PresetMaterialSource => ({
      name: 'brooch',
      diffuse: [1, 1, 1, 1],
      ambient: [0.4, 0.4, 0.4],
      specularity: 5,
      doubleSided: false,
      map: new THREE.Texture(),
      sphere: { map: new THREE.Texture(), mode: SphereMode.Add },
      kind,
      outline: { thickness: 0, color: [0, 0, 0], alpha: 1, visible: false },
    });
    for (const preset of ['real', 'figure'] as const) {
      expect(compile(createPresetMaterial(preset, src('gem'), {})).fragmentShader).toContain('paintedSphere');
      expect(compile(createPresetMaterial(preset, src('cloth'), {})).fragmentShader).not.toContain('paintedSphere');
    }
  });
});
