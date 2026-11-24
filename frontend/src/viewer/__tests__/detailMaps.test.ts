import { describe, expect, test } from 'vitest';
import { createClothDetailMap, createHairDetailMap, heightToNormalMap, uvDensity } from '../detailMaps';

describe('detail maps', () => {
  test('a flat height field gives straight-up normals', () => {
    const tex = heightToNormalMap(8, () => 0.5, 5);
    const d = tex.image.data as Uint8Array;
    expect([d[0], d[1], d[2]]).toEqual([128, 128, 255]);
  });

  test('generated maps tile without a seam', () => {
    for (const tex of [createClothDetailMap(), createHairDetailMap()]) {
      const { width, data } = tex.image as { width: number; data: Uint8Array };
      const px = (x: number, y: number) => data[(y * width + x) * 4];
      // Neighbours across the wrap differ about as much as neighbours inside.
      let wrap = 0;
      let inner = 0;
      for (let y = 0; y < width; y++) {
        wrap += Math.abs(px(width - 1, y) - px(0, y));
        inner += Math.abs(px(width / 2, y) - px(width / 2 + 1, y));
      }
      expect(wrap).toBeLessThan(inner * 2 + width);
    }
  });

  test('uvDensity is model units per UV unit', () => {
    // A 4×4 square mapped to a 0.5×0.5 UV square → 8 units per UV unit.
    const positions = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0];
    const uvs = [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5];
    const indices = [0, 1, 2, 0, 2, 3];
    expect(uvDensity(positions, uvs, indices, 0, 6)).toBeCloseTo(8);
    expect(uvDensity(positions, [0, 0, 0, 0, 0, 0, 0, 0], indices, 0, 6)).toBe(0);
  });
});
