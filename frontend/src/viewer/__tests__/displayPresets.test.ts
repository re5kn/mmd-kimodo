import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import {
  CLAY_COLOR,
  DISPLAY_PRESETS,
  FIGURE_FINISH,
  SKIN,
  SKIN_SCATTER_LINE,
  createPresetMaterial,
  specularityToRoughness,
  type PresetMaterialSource,
} from '../displayPresets';

const source = (map: THREE.Texture | null = null): PresetMaterialSource => ({
  name: 'body',
  diffuse: [0.8, 0.4, 0.2, 0.5],
  ambient: [0.4, 0.2, 0.1],
  specularity: 20,
  doubleSided: true,
  map,
  outline: { thickness: 0.003, color: [0, 0, 0], alpha: 1, visible: true },
});
const shared = {};

describe('display presets', () => {
  test('every preset builds a material that keeps opacity, sidedness and outline', () => {
    const tex = new THREE.Texture();
    for (const { kind } of DISPLAY_PRESETS) {
      const mat = createPresetMaterial(kind, source(tex), shared);
      expect(mat.opacity).toBe(0.5);
      expect(mat.transparent).toBe(true);
      expect(mat.side).toBe(THREE.DoubleSide);
      expect(mat.userData.outlineParameters).toMatchObject({ visible: kind !== 'figure', alpha: 1 });
      expect((mat as THREE.MeshBasicMaterial).map).toBe(tex);
    }
  });

  test('each preset uses its own material type', () => {
    expect(createPresetMaterial('mmd', source(), shared)).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(createPresetMaterial('flat', source(), shared)).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(createPresetMaterial('pbr', source(), shared)).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(createPresetMaterial('clay', source(), shared)).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  test('flat shows the texture as-is, or the diffuse color without one', () => {
    const textured = createPresetMaterial('flat', source(new THREE.Texture()), shared) as THREE.MeshBasicMaterial;
    expect(textured.color.getHex()).toBe(0xffffff);
    const plain = createPresetMaterial('flat', source(), shared) as THREE.MeshBasicMaterial;
    expect(plain.color.getHex()).not.toBe(0xffffff);
  });

  test('clay is one gray color and uses the texture only for alpha', () => {
    const mat = createPresetMaterial('clay', source(new THREE.Texture()), shared) as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(CLAY_COLOR);
    const shader = { fragmentShader: 'a\n#include <map_fragment>\nb' } as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('diffuseColor.a *=');
  });

  test('higher specularity gives a smoother surface', () => {
    expect(specularityToRoughness(5)).toBeGreaterThan(specularityToRoughness(50));
    expect(specularityToRoughness(0)).toBe(1);
    expect(specularityToRoughness(100000)).toBe(0.2);
  });
});

describe('real preset', () => {
  const detailMaps = { cloth: new THREE.DataTexture(), hair: new THREE.DataTexture() };
  const real = (kind: PresetMaterialSource['kind'], uvDensity = 0) =>
    createPresetMaterial('real', { ...source(new THREE.Texture()), kind, uvDensity }, { ...shared, detailMaps });

  test('picks a surface per material kind', () => {
    expect(real('decal')).toBeInstanceOf(THREE.MeshBasicMaterial);
    const hair = real('hair') as THREE.MeshPhysicalMaterial;
    expect(hair.anisotropy).toBeGreaterThan(0);
    const cloth = real('cloth') as THREE.MeshPhysicalMaterial;
    expect(cloth.sheen).toBeGreaterThan(0);
    expect((real('metal') as THREE.MeshPhysicalMaterial).metalness).toBeGreaterThan(0.5);
  });

  test('tiles the detail map by the UV density', () => {
    const cloth = real('cloth', 12) as THREE.MeshPhysicalMaterial;
    expect(cloth.normalMap).not.toBeNull();
    expect(cloth.normalMap!.repeat.x).toBeCloseTo(12 / 0.6);
    expect(real('cloth', 0) as THREE.MeshPhysicalMaterial).toHaveProperty('normalMap', null);
  });

  test('skin wraps light past the terminator with a warm tint', () => {
    const skin = real('skin') as THREE.MeshPhysicalMaterial;
    const shader = {
      fragmentShader: 'void main() {}\n#include <lights_physical_pars_fragment>\n',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    skin.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(THREE.ShaderChunk.lights_physical_pars_fragment).toContain(SKIN_SCATTER_LINE);
    expect(shader.fragmentShader).not.toContain('#include <lights_physical_pars_fragment>');
    expect(shader.fragmentShader).toContain('skinWrapNL');
    expect(shader.uniforms.skinWrap.value).toBe(SKIN.wrap);
    // Tinted toward red so tone mapping does not wash it out.
    expect(skin.color.r).toBeGreaterThan(skin.color.b);
  });

  test('draws thinner outlines', () => {
    expect(real('cloth').userData.outlineParameters.thickness).toBeCloseTo(0.0015);
  });
});

describe('figure preset', () => {
  const figure = (kind: PresetMaterialSource['kind'], map: THREE.Texture | null = new THREE.Texture()) =>
    createPresetMaterial('figure', { ...source(map), kind }, shared) as THREE.MeshPhysicalMaterial;

  test('surfaces are smooth; hair, clothes and metal are lacquered and skin is matte', () => {
    for (const kind of ['hair', 'skin', 'cloth', 'metal'] as const) {
      const mat = figure(kind);
      expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(mat.normalMap).toBeNull();
      if (kind === 'skin') expect(mat.clearcoat).toBe(0);
      else expect(mat.clearcoat).toBeGreaterThan(0);
    }
    expect(FIGURE_FINISH.skin.roughness).toBeGreaterThan(FIGURE_FINISH.hair.roughness);
    expect(FIGURE_FINISH.hair.roughness).toBeLessThan(FIGURE_FINISH.cloth.roughness);
  });

  test('printed parts keep their drawn colors under the coat', () => {
    const tex = new THREE.Texture();
    const eye = figure('decal', tex);
    expect(eye.color.getHex()).toBe(0);
    expect(eye.emissiveMap).toBe(tex);
    expect(eye.emissive.getHex()).toBe(0xffffff);
    expect(eye.map).toBe(tex);
  });

  test('figures have no outlines', () => {
    expect(figure('cloth').userData.outlineParameters.visible).toBe(false);
  });
});
