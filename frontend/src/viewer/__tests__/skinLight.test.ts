import * as THREE from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_SKIN_LIGHT,
  SKIN_LIGHT_ANCHOR,
  createSkinLightUniforms,
  isSkinMaterial,
  skinLightStore,
  skinLightSwitch,
  updateSkinLightUniforms,
  useSkinLight,
} from '../skinLight';

const gray = (v: number) => new THREE.Color(v / 255, v / 255, v / 255);

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe('skin light', () => {
  afterEach(() => {
    skinLightStore.load(null);
    vi.unstubAllGlobals();
  });

  test('three.js light loop still has the line we patch', () => {
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain(SKIN_LIGHT_ANCHOR);
  });

  test('skin follows the classification unless set by hand', () => {
    const s = { ...DEFAULT_SKIN_LIGHT, overrides: new Map([[1, false], [2, true]]) };
    expect(isSkinMaterial(0, 'skin', s)).toBe(true);
    expect(isSkinMaterial(1, 'skin', s)).toBe(false);
    expect(isSkinMaterial(2, 'cloth', s)).toBe(true);
    expect(isSkinMaterial(3, undefined, s)).toBe(false);
  });

  test('MMD color is the skin color; three.js ratio matches the lights the panel would set', () => {
    const u = createSkinLightUniforms();
    updateSkinLightUniforms(u, gray(204), gray(154));
    expect(u.skinLightColor.value.x).toBeCloseTo(0.8, 5);
    // The panel turns 154 into 1.0 and 204 into 204/154 (sRGB), then to linear.
    const linear = (c: number) => new THREE.Color().setRGB(c, c, c, THREE.SRGBColorSpace).r;
    expect(u.skinLightRatio.value.x).toBeCloseTo(linear(204 / 154) / linear(1), 5);
    // Same color as the panel: no change.
    updateSkinLightUniforms(u, gray(180), gray(180));
    expect(u.skinLightRatio.value.toArray().map((v) => +v.toFixed(6))).toEqual([1, 1, 1]);
    // Black panel: nothing to scale.
    updateSkinLightUniforms(u, gray(204), gray(0));
    expect(u.skinLightRatio.value.x).toBe(0);
  });

  test('patches the directional light loop and keeps earlier patches', () => {
    const mat = new THREE.MeshStandardMaterial();
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '// earlier patch');
    };
    mat.customProgramCacheKey = () => 'earlier';
    const shared = createSkinLightUniforms();
    const on = useSkinLight(mat, shared);
    expect(skinLightSwitch(mat)).toBe(on);
    const shader = { vertexShader: '', fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('// earlier patch');
    expect(shader.fragmentShader).toContain('directLight.color *= mix( vec3( 1.0 ), skinLightRatio, skinLightOn );');
    expect(shader.fragmentShader).not.toContain('#include <lights_fragment_begin>');
    const u = shader.uniforms as Record<string, THREE.IUniform>;
    expect(u.skinLightRatio).toBe(shared.skinLightRatio);
    expect(u.skinLightOn).toBe(on);
    expect(mat.customProgramCacheKey()).toBe('earlier-skin-light');
  });

  test('settings are saved and restored per model', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const listener = vi.fn();
    const off = skinLightStore.subscribe(listener);
    skinLightStore.load('モデルA');
    expect(skinLightStore.get()).toEqual(DEFAULT_SKIN_LIGHT);
    skinLightStore.update({ enabled: true, color: '#d0d0d0' });
    skinLightStore.setOverride(3, true);
    skinLightStore.setOverride(4, false);
    skinLightStore.setOverride(4, null);
    skinLightStore.load('モデルB');
    expect(skinLightStore.get().enabled).toBe(false);
    skinLightStore.load('モデルA');
    const s = skinLightStore.get();
    expect(s.enabled).toBe(true);
    expect(s.color).toBe('#d0d0d0');
    expect([...s.overrides]).toEqual([[3, true]]);
    expect(listener).toHaveBeenCalled();
    off();
  });

  test('broken saved data falls back to defaults', () => {
    const storage = memoryStorage();
    storage.setItem('mmd-kimodo.skinLight.x', '{"enabled":true,"color":"red","overrides":[["a",true],[1,"yes"],[2,true]]}');
    vi.stubGlobal('localStorage', storage);
    skinLightStore.load('x');
    const s = skinLightStore.get();
    expect(s.enabled).toBe(true);
    expect(s.color).toBe('#cccccc');
    expect([...s.overrides]).toEqual([[2, true]]);
    storage.setItem('mmd-kimodo.skinLight.y', 'not json');
    skinLightStore.load('y');
    expect(skinLightStore.get()).toEqual(DEFAULT_SKIN_LIGHT);
  });
});
