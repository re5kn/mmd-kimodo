import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import {
  SHARED_TOON_SPECS,
  TOON_RAMP_ROWS,
  createSharedToonTextures,
  createToonRampTexture,
  sharedToonIndexFromPath,
  toonRampColor,
} from '../sharedToons';

const pixel = (tex: THREE.DataTexture, row: number) => Array.from((tex.image.data as Uint8Array).slice(row * 4, row * 4 + 3));

describe('shared toon stand-ins', () => {
  test('there is one ramp for each of toon01..toon10', () => {
    expect(SHARED_TOON_SPECS).toHaveLength(10);
    expect(createSharedToonTextures()).toHaveLength(10);
  });

  test('ramps run from the lit color at the top to the shadow color at the bottom', () => {
    const toon01 = createToonRampTexture(SHARED_TOON_SPECS[0]);
    expect(toon01.image.width).toBe(1);
    expect(toon01.image.height).toBe(TOON_RAMP_ROWS);
    expect(pixel(toon01, 0)).toEqual([255, 255, 255]);
    expect(pixel(toon01, TOON_RAMP_ROWS / 2 - 1)).toEqual([255, 255, 255]);
    expect(pixel(toon01, TOON_RAMP_ROWS / 2)).toEqual([0xcd, 0xcd, 0xcd]);
    expect(pixel(toon01, TOON_RAMP_ROWS - 1)).toEqual([0xcd, 0xcd, 0xcd]);
  });

  test('ramps are sampled smoothly and never wrap', () => {
    const tex = createToonRampTexture(SHARED_TOON_SPECS[4]);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  test('soft ramps blend gradually', () => {
    const spec = SHARED_TOON_SPECS[4];
    const mid = toonRampColor(spec, spec.edge + spec.softness / 2);
    const lit = toonRampColor(spec, 0);
    const shade = toonRampColor(spec, 1);
    expect(mid[2]).toBeLessThan(lit[2]);
    expect(mid[2]).toBeGreaterThan(shade[2]);
  });

  test('the gold toon keeps its color in light and adds a bright band', () => {
    const gold = SHARED_TOON_SPECS[5];
    expect(toonRampColor(gold, 0.05)).toEqual([0xff, 0xed, 0x61]);
    const band = toonRampColor(gold, gold.highlight!.at);
    expect(band[2]).toBeGreaterThan(0xd0);
    expect(toonRampColor(gold, 1)).toEqual([0xc3, 0xac, 0x03]);
  });

  test('toon07..toon10 are blank like the distributed ones', () => {
    for (const spec of SHARED_TOON_SPECS.slice(6)) for (const t of [0, 0.5, 1]) expect(toonRampColor(spec, t)).toEqual([255, 255, 255]);
  });

  test('recognizes MMD toon file names used as ordinary textures', () => {
    expect(sharedToonIndexFromPath('toon03.bmp')).toBe(2);
    expect(sharedToonIndexFromPath('Data\\TOON10.BMP')).toBe(9);
    expect(sharedToonIndexFromPath('tex/toon01.bmp')).toBe(0);
    expect(sharedToonIndexFromPath('mytoon01.bmp')).toBeNull();
    expect(sharedToonIndexFromPath('toon11.bmp')).toBeNull();
    expect(sharedToonIndexFromPath('toon00.bmp')).toBeNull();
    expect(sharedToonIndexFromPath(undefined)).toBeNull();
  });
});
