import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { BoneFlags, type BoneDto, type IkDto } from '../../api/types';
import { PoseSolver } from '../pose';

const D = Math.PI / 180;

function bone(name: string, position: [number, number, number], parent: number, extra: Partial<BoneDto> = {}): BoneDto {
  return {
    name, nameEn: name, position, parent, layer: 0, flags: BoneFlags.Rotatable | BoneFlags.Visible,
    tailBone: -1, tailOffset: [0, 1, 0], appendParent: -1, appendRatio: 0, ik: null, ...extra,
  };
}

/** Leg: hip(10) - knee(5.5) - ankle(1) with a leg IK bone. */
function leg(kneeZ: number): BoneDto[] {
  const ik: IkDto = {
    target: 3, loopCount: 40, limitAngle: 2,
    links: [
      { bone: 2, hasLimit: true, min: [-180 * D, 0, 0], max: [-0.5 * D, 0, 0] },
      { bone: 1, hasLimit: false, min: null, max: null },
    ],
  };
  return [
    bone('root', [0, 0, 0], -1),
    bone('足', [1, 10, 0], 0),
    bone('ひざ', [1, 5.5, kneeZ], 1),
    bone('足首', [1, 1, 0], 2),
    bone('足ＩＫ', [1, 1, 0], 0, { flags: BoneFlags.Ik | BoneFlags.Movable, ik }),
  ];
}

describe('PoseSolver', () => {
  test('rest pose reproduces bone positions', () => {
    const s = new PoseSolver(leg(-0.05));
    s.solve();
    expect(s.worldPosition(3).distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-5);
  });

  test('FK: parent rotation moves children', () => {
    const s = new PoseSolver(leg(0));
    s.motionR[1].setFromAxisAngle(new Vector3(0, 0, 1), 90 * D);
    s.solve(false);
    // leg points along -Y (length 9); rotating +90deg about Z swings it to +X
    expect(s.worldPosition(3).x).toBeCloseTo(1 + 9, 3);
    expect(s.worldPosition(3).y).toBeCloseTo(10, 3);
  });

  test.each([-0.05, 0, 0.05])('IK brings the ankle to the target (knee z=%f)', (kneeZ) => {
    const s = new PoseSolver(leg(kneeZ));
    s.motionT[4].set(0, 2, -1.5); // lift the foot forward (-Z is the model front)
    s.solve();
    const goal = new Vector3(1, 3, -1.5);
    expect(s.worldPosition(3).distanceTo(goal)).toBeLessThan(0.05);
    // Knee bends forward and stays within its limit (negative X rotation).
    expect(s.worldPosition(2).z).toBeLessThan(-0.5);
    const kneeAngle = 2 * Math.atan2(s.localR[2].x, s.localR[2].w);
    expect(kneeAngle).toBeLessThan(0);
  });

  test('IK can be disabled', () => {
    const s = new PoseSolver(leg(-0.05));
    s.motionT[4].set(0, 2, -1.5);
    s.ikEnabled[4] = false;
    s.solve();
    expect(s.worldPosition(3).distanceTo(new Vector3(1, 1, 0))).toBeLessThan(1e-5);
  });

  test('append rotation copies a ratio of the parent rotation', () => {
    const bones = [
      bone('a', [0, 0, 0], -1),
      bone('b', [2, 0, 0], -1, { flags: BoneFlags.AppendRotate, appendParent: 0, appendRatio: 0.5 }),
    ];
    const s = new PoseSolver(bones);
    s.motionR[0].setFromAxisAngle(new Vector3(0, 1, 0), 60 * D);
    s.solve();
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 30 * D);
    expect(s.localR[1].angleTo(expected)).toBeLessThan(1e-5);
  });

  test('append translation', () => {
    const bones = [
      bone('a', [0, 0, 0], -1),
      bone('b', [2, 0, 0], -1, { flags: BoneFlags.AppendTranslate, appendParent: 0, appendRatio: -1 }),
    ];
    const s = new PoseSolver(bones);
    s.motionT[0].set(1, 2, 3);
    s.solve();
    expect(s.worldPosition(1).toArray()).toEqual([1, -2, -3]);
  });

  test('deform order follows layer', () => {
    const bones = [bone('late', [0, 0, 0], -1, { layer: 2 }), bone('early', [0, 0, 0], -1)];
    expect(new PoseSolver(bones).order).toEqual([1, 0]);
  });
});
