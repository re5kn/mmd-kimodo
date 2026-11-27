import { describe, expect, test } from 'vitest';
import type { MaterialDto, MaterialMorphOffsetDto, ModelDto, MorphDto } from '../../api/types';
import { MaterialMorphEvaluator, expandMorphWeights } from '../materialMorph';

const material = (diffuse: [number, number, number, number]): MaterialDto =>
  ({ name: 'm', nameEn: '', diffuse, specular: [0.5, 0.5, 0.5], specularity: 10, ambient: [0.4, 0.4, 0.4], edgeColor: [0, 0, 0, 1], edgeSize: 1 }) as MaterialDto;

const offset = (o: Partial<MaterialMorphOffsetDto> & Pick<MaterialMorphOffsetDto, 'material' | 'op'>): MaterialMorphOffsetDto => {
  const n = o.op === 0 ? 1 : 0;
  return {
    diffuse: [n, n, n, n], specular: [n, n, n], specularity: n, ambient: [n, n, n], edgeColor: [n, n, n, n], edgeSize: n,
    textureFactor: [n, n, n, n], sphereFactor: [n, n, n, n], toonFactor: [n, n, n, n],
    ...o,
  };
};

const morph = (name: string, type: number, extra: Partial<MorphDto> = {}): MorphDto =>
  ({ name, nameEn: '', panel: 4, type, vertexIndices: null, vertexOffsets: null, group: null, ...extra });

const model = (materials: MaterialDto[], morphs: MorphDto[]) => ({ materials, morphs }) as unknown as ModelDto;

describe('material morphs', () => {
  const m = model(
    [material([1, 1, 1, 1]), material([0.5, 0.5, 0.5, 0])],
    [
      morph('照れ', 8, { material: [offset({ material: 0, op: 0, diffuse: [1, 0.6, 0.6, 1] })] }),
      morph('表示', 8, { material: [offset({ material: 1, op: 1, diffuse: [0, 0, 0, 1] })] }),
      morph('全消し', 8, { material: [offset({ material: -1, op: 0, diffuse: [1, 1, 1, 0], edgeColor: [1, 1, 1, 0] })] }),
      morph('まとめ', 0, { group: [{ morph: 0, ratio: 0.5 }, { morph: 1, ratio: 1 }] }),
    ],
  );

  test('multiply lerps from 1 by the weight', () => {
    const s = new MaterialMorphEvaluator(m).evaluate([0.5, 0, 0, 0])!;
    expect(s.get(0)!.diffuse).toEqual([1, 0.8, 0.8, 1]);
    expect(s.get(1)!.diffuse).toEqual([0.5, 0.5, 0.5, 0]);
  });

  test('add shows a hidden material', () => {
    const s = new MaterialMorphEvaluator(m).evaluate([0, 1, 0, 0])!;
    expect(s.get(1)!.diffuse[3]).toBe(1);
  });

  test('material -1 targets every material', () => {
    const e = new MaterialMorphEvaluator(m);
    expect(e.affected).toEqual([0, 1]);
    const s = e.evaluate([0, 0, 1, 0])!;
    expect(s.get(0)!.diffuse[3]).toBe(0);
    expect(s.get(0)!.edgeColor[3]).toBe(0);
  });

  test('group morphs drive their children', () => {
    expect([...expandMorphWeights(m, [0, 0, 0, 1], new Float32Array(4))]).toEqual([0.5, 1, 0, 0]);
    const s = new MaterialMorphEvaluator(m).evaluate([0, 0, 0, 1])!;
    expect(s.get(0)!.diffuse[1]).toBeCloseTo(0.8);
    expect(s.get(1)!.diffuse[3]).toBe(1);
  });

  test('reports a change only when the weights change', () => {
    const e = new MaterialMorphEvaluator(m);
    expect(e.evaluate([0, 0, 0, 0])).not.toBeNull();
    expect(e.evaluate([0, 0, 0, 0])).toBeNull();
    expect(e.evaluate([0, 0, 0, 0], true)).not.toBeNull();
    expect(e.evaluate([1, 0, 0, 0])).not.toBeNull();
  });

  test('models without material morphs do nothing', () => {
    const e = new MaterialMorphEvaluator(model([material([1, 1, 1, 1])], [morph('あ', 1)]));
    expect(e.hasMorphs).toBe(false);
    expect(e.evaluate([1])).toBeNull();
  });
});
