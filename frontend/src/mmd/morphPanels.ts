import type { ModelDto } from '../api/types';

/** MMD's expression panel groups, in its order. PMX panel 0 (system) goes with その他. */
export const MORPH_PANELS = [
  { label: '眉', panels: [1] },
  { label: '目', panels: [2] },
  { label: '口', panels: [3] },
  { label: 'その他', panels: [4, 0] },
] as const;

/** Model morph indices per panel group, in model order (empty groups left out). */
export function morphsByPanel(model: ModelDto): { label: string; indices: number[] }[] {
  return MORPH_PANELS.map(({ label, panels }) => ({
    label,
    indices: model.morphs.flatMap((m, i) => ((panels as readonly number[]).includes(m.panel) ? [i] : [])),
  })).filter((g) => g.indices.length > 0);
}
