import { describe, expect, test } from 'vitest';
import type { ModelDto, MotionDto } from '../../api/types';
import { buildRows } from '../Timeline';

const model = {
  bones: [{ name: 'センター' }, { name: '右足' }, { name: '左足' }],
  morphs: [{ name: 'あ' }, { name: 'まばたき' }],
} as unknown as ModelDto;

const motion: MotionDto = {
  fileName: '',
  modelName: 'm',
  maxFrame: 10,
  boneFrameCount: 3,
  morphFrameCount: 1,
  ik: [],
  bones: [
    { name: '右足', frames: [{ f: 0, p: [0, 0, 0], r: [0, 0, 0, 1], i: [] }, { f: 10, p: [0, 0, 0], r: [0, 0, 0, 1], i: [] }] },
    { name: '謎ボーン', frames: [{ f: 5, p: [0, 0, 0], r: [0, 0, 0, 1], i: [] }] },
  ],
  morphs: [{ name: 'あ', frames: [{ f: 3, w: 1 }] }],
};

describe('buildRows', () => {
  test('only keyed tracks by default', () => {
    const rows = buildRows(model, motion);
    expect(rows.map((r) => r.label)).toEqual(['全体', '右足', '謎ボーン', 'あ']);
    expect(rows[0].frames).toEqual([0, 3, 5, 10]);
    expect(rows[2].kind).toBe('unmatched');
  });

  test('offset shifts frames to timeline positions', () => {
    const rows = buildRows(model, motion, { offset: 100 });
    expect(rows[0].frames).toEqual([100, 103, 105, 110]);
    expect(rows[1].frames).toEqual([100, 110]);
  });

  test('includeEmpty lists every model bone and morph', () => {
    const rows = buildRows(model, motion, { includeEmpty: true });
    expect(rows.map((r) => r.label)).toEqual(['全体', 'センター', '右足', '左足', '謎ボーン', 'あ', 'まばたき']);
    expect(rows[1].frames).toEqual([]);
    expect(rows[5].frames).toEqual([3]);
  });
});
