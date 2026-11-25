import { describe, expect, test } from 'vitest';
import { LOOKS, currentLook } from '../looks';
import { DEFAULT_EFFECTS, effectsActive } from '../postEffects';

describe('looks', () => {
  test('no look means no effects', () => {
    expect(currentLook(DEFAULT_EFFECTS)).toBe('none');
  });

  test('every other look runs the chain', () => {
    for (const l of LOOKS.filter((l) => l.kind !== 'none')) expect(effectsActive(l.effects)).toBe(true);
  });

  test('vivid raises saturation and contrast', () => {
    const vivid = LOOKS.find((l) => l.kind === 'vivid')!.effects.grade;
    expect(vivid.saturation).toBeGreaterThan(1.2);
    expect(vivid.contrast).toBeGreaterThan(1);
  });

  test('a look is recognized until a value is edited', () => {
    const vivid = LOOKS.find((l) => l.kind === 'vivid')!.effects;
    expect(currentLook(vivid)).toBe('vivid');
    expect(currentLook({ ...vivid, grade: { ...vivid.grade, saturation: 1.2 } })).toBeNull();
  });

  test('looks have distinct settings', () => {
    const keys = new Set(LOOKS.map((l) => JSON.stringify(l.effects)));
    expect(keys.size).toBe(LOOKS.length);
  });

  test('figure photo blurs strongly, like a close-up of a small model', () => {
    const fx = LOOKS.find((l) => l.kind === 'figurePhoto')!.effects;
    expect(fx.dof.enabled).toBe(true);
    expect(fx.dof.strength).toBeGreaterThan(LOOKS.find((l) => l.kind === 'cinema')!.effects.dof.strength);
  });
});
