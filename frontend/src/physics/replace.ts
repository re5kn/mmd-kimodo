import { RigidBodyMode, type JointDto, type RigidBodyDto } from '../api/types';
import type { PhysicsModel } from './types';

export interface ReplacedPhysics {
  model: PhysicsModel;
  /** Indices (in the original model) of the bodies that were taken out. */
  removed: number[];
}

/**
 * For sway chains set to replace the PMX physics (Issue #31): takes out the
 * simulated rigid bodies on the given bones, and the joints that use them.
 *
 * Simulated bodies further down the same strand would then hang from nothing
 * and fall, so bodies that were connected (through joints) to a
 * bone-following body before and no longer are, are taken out as well.
 * Bone-following bodies always stay: they hold the rest and are colliders.
 */
export function removeReplacedBodies(model: PhysicsModel, bones: ReadonlySet<number>): ReplacedPhysics {
  const { rigidBodies, joints } = model;
  const n = rigidBodies.length;
  if (bones.size === 0 || n === 0) return { model, removed: [] };

  const keep = rigidBodies.map((rb) => rb.mode === RigidBodyMode.FollowBone || !bones.has(rb.bone));
  const anchoredBefore = anchored(rigidBodies, joints, rigidBodies.map(() => true));
  const anchoredAfter = anchored(rigidBodies, joints, keep);
  for (let i = 0; i < n; i++) if (keep[i] && anchoredBefore[i] && !anchoredAfter[i]) keep[i] = false;

  const removed = keep.flatMap((k, i) => (k ? [] : [i]));
  if (removed.length === 0) return { model, removed };
  const newIndex = new Int32Array(n).fill(-1);
  const kept: RigidBodyDto[] = [];
  rigidBodies.forEach((rb, i) => {
    if (!keep[i]) return;
    newIndex[i] = kept.length;
    kept.push(rb);
  });
  const valid = (i: number) => i >= 0 && i < n;
  const keptJoints: JointDto[] = [];
  for (const j of joints) {
    if (!valid(j.rigidBodyA) || !valid(j.rigidBodyB)) continue;
    const a = newIndex[j.rigidBodyA], b = newIndex[j.rigidBodyB];
    if (a < 0 || b < 0) continue;
    keptJoints.push({ ...j, rigidBodyA: a, rigidBodyB: b });
  }
  return { model: { bones: model.bones, rigidBodies: kept, joints: keptJoints }, removed };
}

/** Bodies reachable through joints (among `present` ones) from a bone-following body. */
function anchored(bodies: readonly RigidBodyDto[], joints: readonly JointDto[], present: readonly boolean[]): boolean[] {
  const n = bodies.length;
  const links: number[][] = bodies.map(() => []);
  for (const j of joints) {
    const a = j.rigidBodyA, b = j.rigidBodyB;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b || !present[a] || !present[b]) continue;
    links[a].push(b);
    links[b].push(a);
  }
  const seen = bodies.map(() => false);
  const stack: number[] = [];
  bodies.forEach((rb, i) => {
    if (present[i] && rb.mode === RigidBodyMode.FollowBone) {
      seen[i] = true;
      stack.push(i);
    }
  });
  while (stack.length > 0) {
    for (const k of links[stack.pop()!]) {
      if (!seen[k]) {
        seen[k] = true;
        stack.push(k);
      }
    }
  }
  return seen;
}
