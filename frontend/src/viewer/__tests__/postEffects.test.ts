import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { BokehShader } from 'three/addons/shaders/BokehShader.js';
import { BOKEH_OPAQUE_LINE, DEFAULT_EFFECTS, dofAperture, dofMaxBlur, effectsActive, resolveToneMapping } from '../postEffects';

describe('post effects', () => {
  test('nothing runs through the chain by default', () => {
    expect(effectsActive(DEFAULT_EFFECTS)).toBe(false);
  });

  test('each effect turns the chain on by itself', () => {
    expect(effectsActive({ ...DEFAULT_EFFECTS, bloom: { ...DEFAULT_EFFECTS.bloom, enabled: true } })).toBe(true);
    expect(effectsActive({ ...DEFAULT_EFFECTS, dof: { ...DEFAULT_EFFECTS.dof, enabled: true } })).toBe(true);
    expect(effectsActive({ ...DEFAULT_EFFECTS, smaa: true })).toBe(true);
  });

  test('tone mapping alone does not need the chain', () => {
    expect(effectsActive({ ...DEFAULT_EFFECTS, toneMapping: 'aces' })).toBe(false);
  });

  test('auto keeps the display preset tone mapping, other choices replace it', () => {
    expect(resolveToneMapping('auto', THREE.NeutralToneMapping)).toBe(THREE.NeutralToneMapping);
    expect(resolveToneMapping('none', THREE.ACESFilmicToneMapping)).toBe(THREE.NoToneMapping);
    expect(resolveToneMapping('agx', THREE.NoToneMapping)).toBe(THREE.AgXToneMapping);
  });

  test('the bloom threshold leaves the default background alone', () => {
    const bg = new THREE.Color(0xf4f5f7);
    expect(Math.max(bg.r, bg.g, bg.b)).toBeLessThan(DEFAULT_EFFECTS.bloom.threshold);
  });

  test('stronger depth of field opens the aperture', () => {
    expect(dofAperture(1)).toBeGreaterThan(dofAperture(0));
    expect(dofAperture(0)).toBeGreaterThan(0);
  });

  test('depth of field keeps the body sharp and blurs what is far from it', () => {
    const s = DEFAULT_EFFECTS.dof.strength;
    // A body a few units deep: about a pixel of blur on a 1000 px wide view.
    expect(dofAperture(s) * 3).toBeLessThan(0.0015);
    // The floor and background tens of units away reach the blur cap.
    expect(dofAperture(s) * 30).toBeGreaterThan(dofMaxBlur(s) * 0.5);
    expect(dofMaxBlur(1)).toBeGreaterThan(dofMaxBlur(0));
  });

  test("three.js's bokeh shader still has the line that drops coverage", () => {
    expect(BokehShader.fragmentShader).toContain(BOKEH_OPAQUE_LINE);
  });
});
