import type { ModelDto } from '../api/types';
import { decodeFloat32, decodeUint32 } from './decode';
import { expandMorphWeights } from './materialMorph';

const MORPH_VERTEX = 1;

interface VertexMorph {
  indices: Uint32Array;
  /** Offsets already converted to three.js space. */
  offsets: Float32Array;
}

/**
 * CPU vertex morphs (sparse): base positions + sum(weight * offset).
 * Group morphs are expanded into their vertex morph children.
 */
export class MorphApplier {
  private readonly vertexMorphs: (VertexMorph | null)[];
  private readonly effective: Float32Array;
  private readonly touched = new Set<number>();

  constructor(
    private readonly model: ModelDto,
    private readonly base: Float32Array,
    private readonly target: Float32Array,
  ) {
    this.vertexMorphs = model.morphs.map((m) => {
      if (m.type !== MORPH_VERTEX || !m.vertexIndices || !m.vertexOffsets) return null;
      const offsets = decodeFloat32(m.vertexOffsets);
      for (let i = 2; i < offsets.length; i += 3) offsets[i] = -offsets[i];
      return { indices: decodeUint32(m.vertexIndices), offsets };
    });
    this.effective = new Float32Array(model.morphs.length);
  }

  get morphCount(): number {
    return this.model.morphs.length;
  }

  /**
   * @param weights per model morph (from the motion)
   * @returns true if the position buffer changed
   */
  apply(weights: ArrayLike<number>): boolean {
    const eff = expandMorphWeights(this.model, weights, this.effective);

    const { base, target, touched } = this;
    const hadTouched = touched.size > 0;
    // Restore vertices modified in the previous frame.
    for (const v of touched) {
      target[v * 3] = base[v * 3];
      target[v * 3 + 1] = base[v * 3 + 1];
      target[v * 3 + 2] = base[v * 3 + 2];
    }
    touched.clear();

    for (let m = 0; m < eff.length; m++) {
      const w = eff[m];
      const vm = this.vertexMorphs[m];
      if (w === 0 || !vm) continue;
      const { indices, offsets } = vm;
      for (let k = 0; k < indices.length; k++) {
        const v = indices[k];
        if (v * 3 + 2 >= target.length) continue;
        target[v * 3] += offsets[k * 3] * w;
        target[v * 3 + 1] += offsets[k * 3 + 1] * w;
        target[v * 3 + 2] += offsets[k * 3 + 2] * w;
        touched.add(v);
      }
    }
    return hadTouched || touched.size > 0;
  }
}
