import { describe, expect, test } from 'vitest';
import { removeReplacedBodies } from '../replace';
import { body, bone, joint } from './fixtures';

// head (follows) - hair1 - hair2 - hair3 (simulated strand), skirt (simulated, own anchor), loose (simulated, no joint).
const bones = [
  bone('head', [0, 10, 0], -1),
  bone('hair1', [0, 10, -1], 0),
  bone('hair2', [0, 10, -2], 1),
  bone('hair3', [0, 10, -3], 2),
  bone('waist', [0, 6, 0], -1),
  bone('skirt', [0, 5, 0], 4),
  bone('loose', [3, 3, 0], -1),
];
const rigidBodies = [
  body('head', 0, [0, 10, 0], 0),
  body('hair1', 1, [0, 10, -1.5], 1),
  body('hair2', 2, [0, 10, -2.5], 1),
  body('hair3', 3, [0, 10, -3.5], 2),
  body('waist', 4, [0, 6, 0], 0),
  body('skirt', 5, [0, 5, 0], 1),
  body('loose', 6, [3, 3, 0], 1),
];
const joints = [joint(0, 1, [0, 10, -1]), joint(1, 2, [0, 10, -2]), joint(2, 3, [0, 10, -3]), joint(4, 5, [0, 5.5, 0])];
const model = { bones, rigidBodies, joints };

describe('removeReplacedBodies', () => {
  test('no bones: the model is unchanged', () => {
    expect(removeReplacedBodies(model, new Set()).model).toBe(model);
  });

  test('removes bodies on the bones and the rest of their strand, remaps the joints', () => {
    const r = removeReplacedBodies(model, new Set([1]));
    expect(r.removed).toEqual([1, 2, 3]);
    expect(r.model.rigidBodies.map((b) => b.name)).toEqual(['head', 'waist', 'skirt', 'loose']);
    expect(r.model.joints.map((j) => [j.rigidBodyA, j.rigidBodyB])).toEqual([[1, 2]]);
  });

  test('keeps bone-following bodies and bodies that were never anchored', () => {
    const r = removeReplacedBodies(model, new Set([0, 3, 4]));
    expect(r.removed).toEqual([3]);
    expect(r.model.rigidBodies.map((b) => b.name)).toEqual(['head', 'hair1', 'hair2', 'waist', 'skirt', 'loose']);
    expect(r.model.joints).toHaveLength(3);
  });
});
