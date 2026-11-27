import type { MaterialDto, MaterialMorphOffsetDto, ModelDto } from '../api/types';

export const MORPH_GROUP = 0;
export const MORPH_MATERIAL = 8;

/**
 * Per morph weights with group morphs expanded into their children
 * (weight × ratio, nested groups up to 8 deep). Group entries themselves
 * end up 0.
 */
export function expandMorphWeights(model: ModelDto, weights: ArrayLike<number>, out: Float32Array): Float32Array {
  out.fill(0);
  const add = (index: number, weight: number, depth: number) => {
    const m = model.morphs[index];
    if (!m || depth > 8) return;
    if (m.type === MORPH_GROUP && m.group) {
      for (const g of m.group) add(g.morph, weight * g.ratio, depth + 1);
    } else {
      out[index] += weight;
    }
  };
  for (let i = 0; i < weights.length; i++) if (weights[i] !== 0) add(i, weights[i], 0);
  return out;
}

/**
 * A material's values after its material morphs. Colors are sRGB 0-1 like
 * PMX. The texture / sphere / toon factors tint those images:
 * image × mul + add (RGBA).
 */
export interface MaterialMorphState {
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  specularity: number;
  ambient: [number, number, number];
  edgeColor: [number, number, number, number];
  edgeSize: number;
  textureMul: [number, number, number, number];
  textureAdd: [number, number, number, number];
  sphereMul: [number, number, number, number];
  sphereAdd: [number, number, number, number];
  toonMul: [number, number, number, number];
  toonAdd: [number, number, number, number];
}

export function baseMaterialState(m: MaterialDto): MaterialMorphState {
  return {
    diffuse: [...m.diffuse],
    specular: [...m.specular],
    specularity: m.specularity,
    ambient: [...m.ambient],
    edgeColor: [...m.edgeColor],
    edgeSize: m.edgeSize,
    textureMul: [1, 1, 1, 1],
    textureAdd: [0, 0, 0, 0],
    sphereMul: [1, 1, 1, 1],
    sphereAdd: [0, 0, 0, 0],
    toonMul: [1, 1, 1, 1],
    toonAdd: [0, 0, 0, 0],
  };
}

/** Applies one material morph entry at a weight, as MMD does (multiply: lerp from 1; add: + value × weight). */
export function applyMaterialMorph(s: MaterialMorphState, o: MaterialMorphOffsetDto, w: number): void {
  if (o.op === 0) {
    const mul = (dst: number[], src: readonly number[]) => {
      for (let i = 0; i < dst.length; i++) dst[i] *= 1 + (src[i] - 1) * w;
    };
    mul(s.diffuse, o.diffuse);
    mul(s.specular, o.specular);
    s.specularity *= 1 + (o.specularity - 1) * w;
    mul(s.ambient, o.ambient);
    mul(s.edgeColor, o.edgeColor);
    s.edgeSize *= 1 + (o.edgeSize - 1) * w;
    mul(s.textureMul, o.textureFactor);
    mul(s.sphereMul, o.sphereFactor);
    mul(s.toonMul, o.toonFactor);
  } else {
    const add = (dst: number[], src: readonly number[]) => {
      for (let i = 0; i < dst.length; i++) dst[i] += src[i] * w;
    };
    add(s.diffuse, o.diffuse);
    add(s.specular, o.specular);
    s.specularity += o.specularity * w;
    add(s.ambient, o.ambient);
    add(s.edgeColor, o.edgeColor);
    s.edgeSize += o.edgeSize * w;
    add(s.textureAdd, o.textureFactor);
    add(s.sphereAdd, o.sphereFactor);
    add(s.toonAdd, o.toonFactor);
  }
}

/**
 * Evaluates material morphs (blush, hidden highlights, tears…) per frame.
 * Only materials some material morph touches are tracked.
 */
export class MaterialMorphEvaluator {
  /** Indices of materials that any material morph can change. */
  readonly affected: number[];
  private readonly morphs: { index: number; offsets: MaterialMorphOffsetDto[] }[];
  private readonly expanded: Float32Array;
  private lastKey = '';

  constructor(private readonly model: ModelDto) {
    this.morphs = model.morphs
      .map((m, index) => ({ index, offsets: m.type === MORPH_MATERIAL ? m.material ?? [] : [] }))
      .filter((m) => m.offsets.length > 0);
    const set = new Set<number>();
    for (const m of this.morphs) {
      for (const o of m.offsets) {
        if (o.material < 0) model.materials.forEach((_, i) => set.add(i));
        else if (o.material < model.materials.length) set.add(o.material);
      }
    }
    this.affected = [...set].sort((a, b) => a - b);
    this.expanded = new Float32Array(model.morphs.length);
  }

  get hasMorphs(): boolean {
    return this.affected.length > 0;
  }

  /**
   * States of the affected materials (index → state), or null when the
   * material morph weights are the same as the last call.
   */
  evaluate(weights: ArrayLike<number>, force = false): Map<number, MaterialMorphState> | null {
    if (!this.hasMorphs) return null;
    const eff = expandMorphWeights(this.model, weights, this.expanded);
    const key = this.morphs.map((m) => eff[m.index]).join(',');
    if (!force && key === this.lastKey) return null;
    this.lastKey = key;
    const states = new Map<number, MaterialMorphState>();
    for (const i of this.affected) states.set(i, baseMaterialState(this.model.materials[i]));
    // In morph order: multiply and add do not commute.
    for (const m of this.morphs) {
      const w = eff[m.index];
      if (w === 0) continue;
      for (const o of m.offsets) {
        if (o.material < 0) states.forEach((s) => applyMaterialMorph(s, o, w));
        else {
          const s = states.get(o.material);
          if (s) applyMaterialMorph(s, o, w);
        }
      }
    }
    return states;
  }
}

