import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import type { MaterialDto } from '../../api/types';
import { baseMaterialState } from '../../mmd/materialMorph';
import { createPresetMaterial, type PresetMaterialSource } from '../displayPresets';
import { applyMaterialMorphState } from '../materialMorphApply';

const pmx = { diffuse: [0.8, 0.6, 0.4, 0], specular: [0, 0, 0], specularity: 5, ambient: [0.4, 0.3, 0.2], edgeColor: [0, 0, 0, 1], edgeSize: 1 } as unknown as MaterialDto;
const source = (): PresetMaterialSource => ({
  name: '照れ',
  diffuse: [0.8, 0.6, 0.4, 0],
  ambient: [0.4, 0.3, 0.2],
  specularity: 5,
  doubleSided: false,
  map: null,
  // Starts hidden (alpha 0), so the edge is off until a morph shows it.
  outline: { thickness: 1 / 300, color: [0, 0, 0], alpha: 1, visible: false, enabled: true },
});

describe('applyMaterialMorphState', () => {
  test('MMD preset: shows a hidden material and tints it in the shader', () => {
    const mat = createPresetMaterial('mmd', source(), {});
    const s = baseMaterialState(pmx);
    s.diffuse = [0.8, 0.3, 0.2, 1];
    s.textureMul = [1, 0.5, 0.5, 1];
    applyMaterialMorphState('mmd', mat, source(), s);
    expect(mat.opacity).toBe(1);
    const u = mat.userData.mmdUniforms;
    expect(u.mmdDiffuse.value.toArray()).toEqual([0.8, 0.3, 0.2]);
    expect(u.mmdTexMul.value.toArray()).toEqual([1, 0.5, 0.5, 1]);
    expect(mat.userData.outlineParameters.visible).toBe(true);
  });

  test('other presets scale their own color by the diffuse change', () => {
    const mat = createPresetMaterial('pbr', source(), {}) as THREE.MeshStandardMaterial;
    const before = mat.color.clone();
    const s = baseMaterialState(pmx);
    s.diffuse = [0.8, 0.6, 0.4, 0.5];
    applyMaterialMorphState('pbr', mat, source(), s);
    expect(mat.opacity).toBe(0.5);
    expect(mat.color.r).toBeCloseTo(before.r);
    s.diffuse = [0.8, 0, 0.4, 0.5];
    applyMaterialMorphState('pbr', mat, source(), s);
    expect(mat.color.g).toBeCloseTo(0);
    expect(mat.color.r).toBeCloseTo(before.r);
    // Back to the PMX values: back to the preset's own color.
    applyMaterialMorphState('pbr', mat, source(), baseMaterialState(pmx));
    expect(mat.color.g).toBeCloseTo(before.g);
  });

  test('figure keeps its edges off; clay keeps its gray', () => {
    const s = baseMaterialState(pmx);
    s.diffuse = [1, 0, 0, 1];
    const fig = createPresetMaterial('figure', source(), {});
    applyMaterialMorphState('figure', fig, source(), s);
    expect(fig.userData.outlineParameters.visible).toBe(false);
    const clay = createPresetMaterial('clay', source(), {}) as THREE.MeshStandardMaterial;
    const gray = clay.color.getHex();
    applyMaterialMorphState('clay', clay, source(), s);
    expect(clay.color.getHex()).toBe(gray);
    expect(clay.opacity).toBe(1);
  });
});
