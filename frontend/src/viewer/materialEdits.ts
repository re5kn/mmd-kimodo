import { baseMaterialState, type MaterialMorphState } from '../mmd/materialMorph';
import type { MaterialDto } from '../api/types';

/**
 * Hand edits from the material panel, by material index. They are not
 * saved: they last until reset or until another model is loaded.
 */
export interface MaterialEdit {
  /** Hidden (drawn nowhere, edge and shadow included). */
  hidden?: boolean;
  /** Replaces the diffuse color (sRGB 0-1, as in PMX). */
  diffuse?: [number, number, number];
  /** Multiplies the opacity (after material morphs). */
  opacity?: number;
}

export type MaterialEdits = ReadonlyMap<number, MaterialEdit>;

let edits: MaterialEdits = new Map();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const materialEditStore = {
  get: (): MaterialEdits => edits,
  /** Merges `patch` into a material's edit; fields set to undefined are cleared. */
  update(index: number, patch: MaterialEdit): void {
    materialEditStore.updateAll([index], patch);
  },
  /** Sets the same patch on many materials at once (e.g. show all). */
  updateAll(indices: number[], patch: MaterialEdit): void {
    const next = new Map(edits);
    for (const i of indices) {
      const merged: MaterialEdit = { ...next.get(i), ...patch };
      for (const k of Object.keys(merged) as (keyof MaterialEdit)[]) if (merged[k] === undefined) delete merged[k];
      if (Object.keys(merged).length === 0) next.delete(i);
      else next.set(i, merged);
    }
    edits = next;
    emit();
  },
  reset(): void {
    if (edits.size === 0) return;
    edits = new Map();
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** A material's state with its hand edit on top (the input is not changed). */
export function applyMaterialEdit(state: MaterialMorphState, edit: MaterialEdit | undefined): MaterialMorphState {
  if (!edit) return state;
  const s: MaterialMorphState = { ...state, diffuse: [...state.diffuse] };
  if (edit.diffuse) [s.diffuse[0], s.diffuse[1], s.diffuse[2]] = edit.diffuse;
  if (edit.opacity !== undefined) s.diffuse[3] *= edit.opacity;
  if (edit.hidden) s.diffuse[3] = 0;
  return s;
}

/**
 * Final per-material states to show: material morph results, then hand
 * edits. `previous` lists materials changed last time, so a material whose
 * edit was removed goes back to its PMX values.
 */
export function combineMaterialStates(
  materials: MaterialDto[],
  morphStates: ReadonlyMap<number, MaterialMorphState> | null,
  materialEdits: MaterialEdits,
  previous: ReadonlySet<number>,
): Map<number, MaterialMorphState> {
  const indices = new Set<number>([...previous, ...(morphStates?.keys() ?? []), ...materialEdits.keys()]);
  const out = new Map<number, MaterialMorphState>();
  for (const i of indices) {
    const m = materials[i];
    if (!m) continue;
    out.set(i, applyMaterialEdit(morphStates?.get(i) ?? baseMaterialState(m), materialEdits.get(i)));
  }
  return out;
}
