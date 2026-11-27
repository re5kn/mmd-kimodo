import { describe, expect, test, vi } from 'vitest';
import type { MaterialDto } from '../../api/types';
import { baseMaterialState } from '../../mmd/materialMorph';
import { applyMaterialEdit, combineMaterialStates, materialEditStore } from '../materialEdits';

const material = { diffuse: [0.8, 0.6, 0.4, 1], specular: [0, 0, 0], specularity: 5, ambient: [0.4, 0.3, 0.2], edgeColor: [0, 0, 0, 1], edgeSize: 1 } as unknown as MaterialDto;

describe('material edits', () => {
  test('hide, recolor and fade on top of the morph result', () => {
    const s = baseMaterialState(material);
    expect(applyMaterialEdit(s, { diffuse: [1, 0, 0] }).diffuse).toEqual([1, 0, 0, 1]);
    expect(applyMaterialEdit(s, { opacity: 0.5 }).diffuse[3]).toBe(0.5);
    expect(applyMaterialEdit(s, { hidden: true, opacity: 0.5 }).diffuse[3]).toBe(0);
    // The input state is left alone.
    expect(s.diffuse).toEqual([0.8, 0.6, 0.4, 1]);
  });

  test('combines morph states, edits and materials to restore', () => {
    const materials = [material, material, material];
    const morph = baseMaterialState(material);
    morph.diffuse[3] = 0.25;
    const out = combineMaterialStates(materials, new Map([[0, morph]]), new Map([[1, { hidden: true }]]), new Set([2]));
    expect([...out.keys()].sort()).toEqual([0, 1, 2]);
    expect(out.get(0)!.diffuse[3]).toBe(0.25);
    expect(out.get(1)!.diffuse[3]).toBe(0);
    // Edited before, not now: back to the PMX values.
    expect(out.get(2)!.diffuse).toEqual([0.8, 0.6, 0.4, 1]);
  });

  test('the store merges patches and drops empty edits', () => {
    const listener = vi.fn();
    const off = materialEditStore.subscribe(listener);
    materialEditStore.update(3, { hidden: true });
    materialEditStore.update(3, { opacity: 0.5 });
    expect(materialEditStore.get().get(3)).toEqual({ hidden: true, opacity: 0.5 });
    materialEditStore.update(3, { hidden: undefined, opacity: undefined });
    expect(materialEditStore.get().has(3)).toBe(false);
    materialEditStore.updateAll([1, 2], { hidden: true });
    expect(materialEditStore.get().size).toBe(2);
    materialEditStore.updateAll([1, 2], { hidden: undefined });
    expect(materialEditStore.get().size).toBe(0);
    materialEditStore.update(4, { opacity: 0.1 });
    materialEditStore.reset();
    expect(materialEditStore.get().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(7);
    off();
  });
});
