import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BoneKeyDto, ModelDto, MotionDto } from '../../api/types';
import { bindMotion, findKey, sampleBoneTrack, sampleIkEnabled, sampleMorphTrack } from '../motion';

const LIN = [20, 20, 107, 107, 20, 20, 107, 107, 20, 20, 107, 107, 20, 20, 107, 107];
const key = (f: number, p: [number, number, number], deg = 0): BoneKeyDto => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);
  return { f, p, r: [q.x, q.y, q.z, q.w], i: LIN };
};

describe('findKey', () => {
  const keys = [{ f: 0 }, { f: 10 }, { f: 20 }];
  test.each([
    [-1, -1],
    [0, 0],
    [5, 0],
    [10, 1],
    [19, 1],
    [25, 2],
  ])('frame %d -> %d', (frame, idx) => expect(findKey(keys, frame)).toBe(idx));
});

describe('sampleBoneTrack', () => {
  const keys = [key(0, [0, 0, 0], 0), key(10, [10, 0, -5], 90)];
  const p = new Vector3();
  const r = new Quaternion();

  test('interpolates between keys', () => {
    sampleBoneTrack(keys, 5, p, r);
    expect(p.x).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(-2.5);
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    expect(r.angleTo(expected)).toBeLessThan(1e-4);
  });

  test('holds the first / last key outside the range', () => {
    sampleBoneTrack(keys, 50, p, r);
    expect(p.x).toBeCloseTo(10);
    sampleBoneTrack([key(5, [1, 2, 3])], 0, p, r);
    expect(p.toArray()).toEqual([1, 2, 3]);
  });

  test('uses the interpolation curve stored on the later key', () => {
    const eased: BoneKeyDto = { ...keys[1], i: [127, 0, 127, 0, ...LIN.slice(4)] };
    sampleBoneTrack([keys[0], eased], 5, p, r);
    expect(p.x).toBeLessThan(2); // X channel strongly delayed
    expect(p.z).toBeCloseTo(-2.5); // Z channel still linear
  });
});

test('sampleMorphTrack is linear', () => {
  const t = { name: 'あ', frames: [{ f: 0, w: 0 }, { f: 10, w: 1 }] };
  expect(sampleMorphTrack(t, 3)).toBeCloseTo(0.3);
  expect(sampleMorphTrack(t, 30)).toBe(1);
});

describe('bindMotion', () => {
  const model = {
    bones: [{ name: 'センター' }, { name: '頭' }],
    morphs: [{ name: 'あ' }],
  } as unknown as ModelDto;
  const motion = {
    bones: [{ name: '頭', frames: [] }, { name: '尻尾', frames: [] }],
    morphs: [{ name: 'あ', frames: [] }, { name: 'ウィンク', frames: [] }],
    ik: [
      { f: 0, visible: true, states: [{ name: '左足ＩＫ', enabled: true }] },
      { f: 30, visible: true, states: [{ name: '左足ＩＫ', enabled: false }] },
    ],
  } as unknown as MotionDto;

  test('matches by name and reports the rest', () => {
    const b = bindMotion(model, motion);
    expect(b.boneTracks[0]).toBeNull();
    expect(b.boneTracks[1]?.name).toBe('頭');
    expect(b.unmatchedBones).toEqual(['尻尾']);
    expect(b.matchedMorphCount).toBe(1);
    expect(b.unmatchedMorphs).toEqual(['ウィンク']);
  });

  test('IK on/off is a step function', () => {
    expect(sampleIkEnabled(motion, '左足ＩＫ', 10)).toBe(true);
    expect(sampleIkEnabled(motion, '左足ＩＫ', 30)).toBe(false);
    expect(sampleIkEnabled(motion, '右足ＩＫ', 30)).toBe(true);
  });
});
