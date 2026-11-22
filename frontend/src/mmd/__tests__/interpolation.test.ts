import { describe, expect, test } from 'vitest';
import { bezierEase } from '../interpolation';

describe('bezierEase', () => {
  test('linear control points return x', () => {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(bezierEase(x, 20, 20, 107, 107)).toBeCloseTo(x, 5);
  });

  test('clamps outside [0,1]', () => {
    expect(bezierEase(-1, 64, 0, 64, 127)).toBe(0);
    expect(bezierEase(2, 64, 0, 64, 127)).toBe(1);
  });

  test('ease-in-out is symmetric and slow at the ends', () => {
    const y = (x: number) => bezierEase(x, 64, 0, 63, 127);
    expect(y(0.5)).toBeCloseTo(0.5, 4);
    expect(y(0.1)).toBeLessThan(0.1);
    expect(y(0.9)).toBeGreaterThan(0.9);
    expect(y(0.25) + y(0.75)).toBeCloseTo(1, 4);
  });
});
