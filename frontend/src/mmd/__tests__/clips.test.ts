import { describe, expect, test } from 'vitest';
import type { MotionDto } from '../../api/types';
import { clipAt, clipBoundaries, clipEnd, clipLength, nextIn, prevIn, timelineEnd, type MotionClip } from '../clips';

const clip = (id: string, start: number, maxFrame: number): MotionClip => ({
  id,
  name: id,
  start,
  motion: { fileName: '', modelName: '', maxFrame, boneFrameCount: 0, morphFrameCount: 0, bones: [], morphs: [], ik: [] } satisfies MotionDto,
});

describe('clips', () => {
  const a = clip('a', 0, 29); // 0..29
  const b = clip('b', 40, 10); // 40..50
  const c = clip('c', 20, 30); // 20..50, overlaps a and b

  test('length and end', () => {
    expect(clipLength(a)).toBe(30);
    expect(clipEnd(a)).toBe(29);
    expect(clipLength(clip('x', 5, 0))).toBe(1);
    expect(clipEnd(clip('x', 5, 0))).toBe(5);
  });

  test('clipAt finds the covering clip, last added wins', () => {
    expect(clipAt([a, b], 0)?.id).toBe('a');
    expect(clipAt([a, b], 29)?.id).toBe('a');
    expect(clipAt([a, b], 30)).toBeNull();
    expect(clipAt([a, b], 45)?.id).toBe('b');
    expect(clipAt([a, b, c], 25)?.id).toBe('c');
    expect(clipAt([c, a], 25)?.id).toBe('a');
    expect(clipAt([], 0)).toBeNull();
  });

  test('timelineEnd', () => {
    expect(timelineEnd([])).toBe(0);
    expect(timelineEnd([a, b])).toBe(50);
  });

  test('boundaries and jumps', () => {
    const bs = clipBoundaries([b, a]);
    expect(bs).toEqual([0, 29, 40, 50]);
    expect(prevIn(bs, 35)).toBe(29);
    expect(prevIn(bs, 0)).toBe(0);
    expect(nextIn(bs, 35)).toBe(40);
    expect(nextIn(bs, 50)).toBe(50);
  });
});
