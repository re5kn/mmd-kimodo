import { describe, expect, test } from 'vitest';
import type { BoneKeyDto, MotionDto } from '../../api/types';
import { emptyMotion } from '../clips';
import { spliceMotion } from '../splice';

const key = (f: number, x = 0): BoneKeyDto => ({ f, p: [x, 0, 0], r: [0, 0, 0, 1], i: [] });
const motion = (bones: Record<string, number[]>, extra: Partial<MotionDto> = {}): MotionDto => {
  const tracks = Object.entries(bones).map(([name, fs]) => ({ name, frames: fs.map((f) => key(f, f)) }));
  const count = tracks.reduce((n, t) => n + t.frames.length, 0);
  const max = Math.max(0, ...tracks.flatMap((t) => t.frames.map((k) => k.f)));
  return { fileName: '', modelName: 'm', maxFrame: max, boneFrameCount: count, morphFrameCount: 0, bones: tracks, morphs: [], ik: [], ...extra };
};
const frames = (m: MotionDto, name: string) => m.bones.find((t) => t.name === name)?.frames.map((k) => k.f);

describe('spliceMotion', () => {
  test('into an empty motion (create mode)', () => {
    const gen = motion({ センター: [0, 1, 2], 頭: [0, 2] });
    const out = spliceMotion(emptyMotion('m'), gen, 0);
    expect(frames(out, 'センター')).toEqual([0, 1, 2]);
    expect(out.boneFrameCount).toBe(5);
    expect(out.maxFrame).toBe(2);
    expect(out.modelName).toBe('m');
  });

  test('replaces keys of generated bones in range and shifts them', () => {
    const base = motion({ センター: [0, 10, 20, 30, 40], 右目: [0, 15, 40] });
    const gen = motion({ センター: [0, 5, 10] });
    const out = spliceMotion(base, gen, 12);
    // 12..22 replaced: 20 removed, 12/17/22 added
    expect(frames(out, 'センター')).toEqual([0, 10, 12, 17, 22, 30, 40]);
    // bones the generation does not animate are kept
    expect(frames(out, '右目')).toEqual([0, 15, 40]);
    expect(out.bones.find((t) => t.name === 'センター')!.frames.find((k) => k.f === 17)!.p[0]).toBe(5);
    expect(out.boneFrameCount).toBe(10);
    expect(out.maxFrame).toBe(40);
  });

  test('extends the motion past its end', () => {
    const out = spliceMotion(motion({ センター: [0, 10] }), motion({ センター: [0, 30] }), 8);
    expect(frames(out, 'センター')).toEqual([0, 8, 38]);
    expect(out.maxFrame).toBe(38);
  });

  test('keeps morphs and replaces IK frames only when generated has some', () => {
    const base = motion({ センター: [0] }, {
      morphs: [{ name: 'まばたき', frames: [{ f: 50, w: 1 }] }],
      morphFrameCount: 1,
      ik: [{ f: 5, visible: true, states: [] }],
    });
    const keep = spliceMotion(base, motion({ センター: [0, 10] }), 0);
    expect(keep.ik.map((k) => k.f)).toEqual([5]);
    expect(keep.morphs).toBe(base.morphs);
    expect(keep.morphFrameCount).toBe(1);
    expect(keep.maxFrame).toBe(50);

    const gen = motion({ センター: [0, 10] }, { ik: [{ f: 0, visible: true, states: [{ name: '左足ＩＫ', enabled: false }] }] });
    const replaced = spliceMotion(base, gen, 2);
    expect(replaced.ik.map((k) => k.f)).toEqual([2]);
  });
});
