/**
 * Morph weights set by hand in the sidebar, by model morph index. They
 * replace the motion's weight for that morph, so material morphs can be
 * checked without a motion. Cleared when another model is loaded.
 */
export type MorphOverrides = ReadonlyMap<number, number>;

let overrides: MorphOverrides = new Map();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const morphControlStore = {
  get: (): MorphOverrides => overrides,
  set(index: number, weight: number | null): void {
    const next = new Map(overrides);
    if (weight === null) next.delete(index);
    else next.set(index, weight);
    overrides = next;
    emit();
  },
  reset(): void {
    if (overrides.size === 0) return;
    overrides = new Map();
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
