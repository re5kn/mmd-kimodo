import { describe, expect, test } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { RigidBodyShape } from '../../api/types';
import { PhysicsRig } from '../rig';
import { DEFAULT_STILLNESS, StillnessDetector } from '../stillness';
import type { PhysicsModel } from '../types';
import { body, bone, joint } from './fixtures';

const DT = 1 / 60;

/** Bone 0 drives the simulation, bone 1 is driven by it. */
function detector(options = DEFAULT_STILLNESS) {
  return new StillnessDetector([0], [1], options);
}

function pose(inputX = 0, outputAngle = 0): Matrix4[] {
  return [new Matrix4().makeTranslation(inputX, 10, 0), new Matrix4().makeRotationX(outputAngle)];
}

/** Steps like the viewer; returns the frames that were simulated. */
function run(d: StillnessDetector, frames: number, at: (k: number) => Matrix4[]): number {
  let stepped = 0;
  for (let k = 0; k < frames; k++) {
    const m = at(k);
    if (d.beforeStep(m, DT)) continue;
    stepped++;
    d.afterStep(m);
  }
  return stepped;
}

describe('StillnessDetector', () => {
  test('freezes once the input holds still and the output has settled', () => {
    const d = detector();
    // Still input, still output: frozen after settleSeconds (1 s = 60 frames).
    const stepped = run(d, 120, () => pose());
    expect(d.frozen).toBe(true);
    expect(stepped).toBeGreaterThanOrEqual(60);
    expect(stepped).toBeLessThanOrEqual(62);
  });

  test('waits while the output still swings, then freezes at the hard limit', () => {
    const d = detector();
    // Output jitters 2° per frame forever (like bodies resting on a joint limit).
    const stepped = run(d, 600, (k) => pose(0, (k % 2) * (2 * Math.PI) / 180));
    expect(d.frozen).toBe(true);
    // maxSettleSeconds = 4 s
    expect(stepped).toBeGreaterThanOrEqual(240);
    expect(stepped).toBeLessThanOrEqual(242);
  });

  test('any input change resumes on the same frame and restarts the wait', () => {
    const d = detector();
    run(d, 120, () => pose());
    expect(d.frozen).toBe(true);
    expect(d.beforeStep(pose(0.01), DT)).toBe(false);
    expect(d.frozen).toBe(false);
    d.afterStep(pose(0.01));
    // Holding the new pose: not frozen again before settleSeconds.
    expect(run(d, 30, () => pose(0.01))).toBe(30);
    expect(d.frozen).toBe(false);
  });

  test('changes below the epsilon count as still', () => {
    const d = detector();
    run(d, 120, (k) => pose((k % 2) * DEFAULT_STILLNESS.inputEpsilon * 0.5));
    expect(d.frozen).toBe(true);
  });

  test('reset unfreezes and needs a new wait', () => {
    const d = detector();
    run(d, 120, () => pose());
    d.reset();
    expect(d.frozen).toBe(false);
    expect(run(d, 30, () => pose())).toBe(30);
  });

  test('forRig watches bone-following bodies and the bones driven by physics', () => {
    const model: PhysicsModel = {
      bones: [bone('root', [0, 0, 0], -1), bone('head', [0, 10, 0], 0), bone('hair', [0, 10, 1], 1)],
      rigidBodies: [
        body('head', 1, [0, 10, 0], 0),
        body('hair', 2, [0, 9, 1], 1, { shape: RigidBodyShape.Capsule, size: [0.2, 1.4, 0] }),
      ],
      joints: [joint(0, 1, [0, 10, 1])],
    };
    const d = StillnessDetector.forRig(new PhysicsRig(model));
    const world = [new Matrix4(), new Matrix4().makeTranslation(0, 10, 0), new Matrix4()];
    d.beforeStep(world, DT);
    d.afterStep(world);
    // Moving the root alone (no body follows it) does not count as a change...
    world[0].makeTranslation(5, 0, 0);
    for (let k = 0; k < 70; k++) if (!d.beforeStep(world, DT)) d.afterStep(world);
    expect(d.frozen).toBe(true);
    // ...moving the head does.
    world[1].setPosition(new Vector3(0, 10.5, 0));
    expect(d.beforeStep(world, DT)).toBe(false);
  });
});
