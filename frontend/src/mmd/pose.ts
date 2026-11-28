import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { BoneFlags, type BoneDto } from '../api/types';

/**
 * MMD bone evaluation in native PMX coordinates (left-handed). Quaternion and
 * matrix algebra does not depend on handedness, so standard math applies; the
 * viewer converts the resulting local transforms to three.js space.
 *
 * Rest pose: every bone has identity orientation, so a bone's local frame is
 * world-aligned and its rest offset is position - parent.position.
 *
 * Per bone, in deform order (after-physics flag, transform layer, index):
 *   local translation = restOffset + motionT (+ appendT)
 *   local rotation    = motionR (* appendR), then overwritten by IK for links
 * IK is solved with CCD as soon as the IK bone is reached in the order.
 *
 * With physics, a frame is evaluated in three steps:
 *   solve(ik, 'beforePhysics') -> physics engine -> applyPhysics() -> solve(ik, 'afterPhysics')
 * Without physics, solve() runs both phases in one go.
 */
export type SolvePhase = 'all' | 'beforePhysics' | 'afterPhysics';

/** How a bone is driven by physics (see {@link PoseSolver.applyPhysics}). */
export const PhysicsBoneMode = {
  None: 0,
  /** Position and rotation come from the rigid body. */
  Full: 1,
  /** Rotation comes from the rigid body; the bone keeps its animated local translation. */
  RotationOnly: 2,
} as const;

export class PoseSolver {
  readonly count: number;
  readonly order: number[];
  /** Deform order split at the "physics after deform" flag. */
  readonly orderBeforePhysics: number[];
  readonly orderAfterPhysics: number[];
  /** Parents before children. */
  readonly hierarchyOrder: number[];
  readonly children: number[][];
  readonly restOffset: Vector3[];

  /** Inputs (set by the caller each frame). */
  readonly motionT: Vector3[];
  readonly motionR: Quaternion[];
  /** Per bone; only meaningful for IK bones. */
  readonly ikEnabled: boolean[];

  /** Outputs. */
  readonly localT: Vector3[];
  readonly localR: Quaternion[];
  readonly world: Matrix4[];

  /** Append (付与) translation applied this frame, used by chained append bones. */
  private readonly appendT: Vector3[];

  constructor(private readonly bones: readonly BoneDto[]) {
    const n = bones.length;
    this.count = n;
    this.children = bones.map(() => []);
    bones.forEach((b, i) => {
      if (b.parent >= 0 && b.parent < n && b.parent !== i) this.children[b.parent].push(i);
    });
    this.restOffset = bones.map((b) => {
      const p = new Vector3(...b.position);
      if (b.parent >= 0 && b.parent < n) p.sub(new Vector3(...bones[b.parent].position));
      return p;
    });
    this.order = bones
      .map((_, i) => i)
      .sort((a, b) => {
        const pa = bones[a].flags & BoneFlags.PhysicsAfterDeform ? 1 : 0;
        const pb = bones[b].flags & BoneFlags.PhysicsAfterDeform ? 1 : 0;
        return pa - pb || bones[a].layer - bones[b].layer || a - b;
      });
    const afterPhysics = (i: number) => (bones[i].flags & BoneFlags.PhysicsAfterDeform) !== 0;
    this.orderBeforePhysics = this.order.filter((i) => !afterPhysics(i));
    this.orderAfterPhysics = this.order.filter(afterPhysics);
    this.hierarchyOrder = [];
    const visited = new Uint8Array(n);
    const visit = (i: number) => {
      if (visited[i]) return;
      visited[i] = 1;
      const p = bones[i].parent;
      if (p >= 0 && p < n && p !== i) visit(p);
      this.hierarchyOrder.push(i);
    };
    for (let i = 0; i < n; i++) visit(i);
    this.motionT = bones.map(() => new Vector3());
    this.motionR = bones.map(() => new Quaternion());
    this.ikEnabled = bones.map(() => true);
    this.localT = bones.map(() => new Vector3());
    this.localR = bones.map(() => new Quaternion());
    this.world = bones.map(() => new Matrix4());
    this.appendT = bones.map(() => new Vector3());
  }

  resetInputs(): void {
    for (let i = 0; i < this.count; i++) {
      this.motionT[i].set(0, 0, 0);
      this.motionR[i].identity();
      this.ikEnabled[i] = true;
    }
  }

  /** World position of a bone after {@link solve}. */
  worldPosition(i: number, out = new Vector3()): Vector3 {
    return out.setFromMatrixPosition(this.world[i]);
  }

  solve(enableIk = true, phase: SolvePhase = 'all'): void {
    const { bones } = this;
    const order = phase === 'all' ? this.order : phase === 'beforePhysics' ? this.orderBeforePhysics : this.orderAfterPhysics;
    if (enableIk) this.prepareIkTargets(order);
    for (const i of order) {
      const b = bones[i];
      const t = this.localT[i].copy(this.restOffset[i]).add(this.motionT[i]);
      const r = this.localR[i].copy(this.motionR[i]);
      this.appendT[i].set(0, 0, 0);

      const ap = b.appendParent;
      if (ap >= 0 && ap < this.count && ap !== i) {
        if (b.flags & BoneFlags.AppendRotate) {
          // Source rotation: the parent's full local rotation (motion + its own append + IK).
          const src = b.flags & BoneFlags.LocalAppend ? this.motionR[ap] : this.localR[ap];
          _q.identity().slerp(src, b.appendRatio);
          r.multiply(_q);
        }
        if (b.flags & BoneFlags.AppendTranslate) {
          const src = _v.copy(this.motionT[ap]);
          if (!(b.flags & BoneFlags.LocalAppend)) src.add(this.appendT[ap]);
          this.appendT[i].copy(src).multiplyScalar(b.appendRatio);
          t.add(this.appendT[i]);
        }
      }
      this.updateWorld(i);

      if (b.ik && enableIk && this.ikEnabled[i]) {
        this.solveIk(i);
      }
    }
  }

  /**
   * Overwrites bones driven by rigid bodies. `target` holds the bone world
   * matrices computed from the bodies (only read where `modes[i] !== None`).
   * Local transforms of driven bones are derived from them, and every other
   * bone's world matrix is refreshed so children follow.
   */
  applyPhysics(modes: ArrayLike<number>, target: readonly Matrix4[]): void {
    for (const i of this.hierarchyOrder) {
      const mode = modes[i];
      if (mode !== PhysicsBoneMode.None) {
        const p = this.bones[i].parent;
        const hasParent = p >= 0 && p < this.count && p !== i;
        _m.copy(target[i]);
        if (hasParent) _m.premultiply(_mInv.copy(this.world[p]).invert());
        _m.decompose(_v, _q, _s);
        if (mode === PhysicsBoneMode.Full) this.localT[i].copy(_v);
        this.localR[i].copy(_q).normalize();
      }
      this.updateWorld(i);
    }
  }

  /**
   * Gives every bone of this phase its motion-only local transform before the
   * deform-order pass. An IK bone can be sorted before its target (e.g. 足ＩＫ
   * with a smaller index than 足首); without this the target would still hold
   * the previous frame's transform when the IK measures the effector. The main
   * pass recomputes these bones with append and IK afterwards.
   */
  private prepareIkTargets(order: readonly number[]): void {
    for (const i of order) {
      this.localT[i].copy(this.restOffset[i]).add(this.motionT[i]);
      this.localR[i].copy(this.motionR[i]);
    }
  }

  /**
   * Recomputes bone `i`'s world matrix from its local transform and its
   * parent's world matrix (and, with `recursive`, those of its descendants).
   * For callers that change {@link localR} directly, like the sway chains.
   */
  refreshWorld(i: number, recursive = false): void {
    if (recursive) this.updateWorldRecursive(i);
    else this.updateWorld(i);
  }

  /** Recomputes the world matrices from the root down to bone `i`. */
  private updateWorldPath(i: number): void {
    const path: number[] = [];
    for (let b = i, guard = 0; b >= 0 && b < this.count && guard < this.count; guard++) {
      path.push(b);
      const p = this.bones[b].parent;
      if (p === b) break;
      b = p;
    }
    for (let k = path.length - 1; k >= 0; k--) this.updateWorld(path[k]);
  }

  private updateWorld(i: number): void {
    const p = this.bones[i].parent;
    this.world[i].compose(this.localT[i], this.localR[i], ONE);
    if (p >= 0 && p < this.count && p !== i) this.world[i].premultiply(this.world[p]);
  }

  private updateWorldRecursive(i: number): void {
    this.updateWorld(i);
    for (const c of this.children[i]) this.updateWorldRecursive(c);
  }

  private solveIk(ikIndex: number): void {
    const ik = this.bones[ikIndex].ik!;
    const target = ik.target;
    if (target < 0 || target >= this.count || ik.links.length === 0) return;
    const links = ik.links.filter((l) => l.bone >= 0 && l.bone < this.count);
    if (links.length === 0) return;

    // The effector must reflect this frame before the first CCD step.
    this.updateWorldPath(target);
    const goal = this.worldPosition(ikIndex, new Vector3());
    const effector = new Vector3();
    const inv = new Matrix4();
    const eLocal = new Vector3();
    const gLocal = new Vector3();
    const axis = new Vector3();
    const stepQ = new Quaternion();
    const euler = new Euler();
    const limitAngle = ik.limitAngle > 0 ? ik.limitAngle : Math.PI;

    // Hinge links (only X limited, e.g. knees) keep an explicit angle.
    const hingeAngle = links.map((l) => {
      if (!isXHinge(l.min, l.max, l.hasLimit)) return NaN;
      euler.setFromQuaternion(this.localR[l.bone], 'XYZ');
      return euler.x;
    });

    const loops = Math.max(1, Math.min(ik.loopCount, 256));
    for (let it = 0; it < loops; it++) {
      for (let li = 0; li < links.length; li++) {
        const link = links[li];
        const bi = link.bone;
        this.worldPosition(target, effector);
        if (effector.distanceToSquared(goal) < 1e-10) return;

        inv.copy(this.world[bi]).invert();
        eLocal.copy(effector).applyMatrix4(inv);
        gLocal.copy(goal).applyMatrix4(inv);

        if (!Number.isNaN(hingeAngle[li])) {
          // Rotate only about the local X axis.
          eLocal.x = 0;
          gLocal.x = 0;
          if (eLocal.lengthSq() < 1e-12 || gLocal.lengthSq() < 1e-12) continue;
          eLocal.normalize();
          gLocal.normalize();
          let delta = Math.atan2(eLocal.y * gLocal.z - eLocal.z * gLocal.y, eLocal.dot(gLocal));
          delta = clamp(delta, -limitAngle, limitAngle);
          const lo = Math.min(link.min![0], link.max![0]);
          const hi = Math.max(link.min![0], link.max![0]);
          let angle = hingeAngle[li] + delta;
          if (it === 0 && (angle < lo || angle > hi)) {
            // A straight chain makes CCD pick the hyper-extended branch; mirror
            // the first step into the allowed range (same trick as MMD / saba).
            if (-angle >= lo && -angle <= hi) angle = -angle;
            else {
              const mid = (lo + hi) / 2;
              if (Math.abs(mid - angle) > Math.abs(mid + angle)) angle = -angle;
            }
          }
          angle = clamp(angle, lo, hi);
          hingeAngle[li] = angle;
          this.localR[bi].setFromAxisAngle(X_AXIS, angle);
        } else {
          if (eLocal.lengthSq() < 1e-12 || gLocal.lengthSq() < 1e-12) continue;
          eLocal.normalize();
          gLocal.normalize();
          const dot = clamp(eLocal.dot(gLocal), -1, 1);
          let angle = Math.acos(dot);
          if (angle < 1e-6) continue;
          angle = Math.min(angle, limitAngle);
          axis.crossVectors(eLocal, gLocal);
          if (axis.lengthSq() < 1e-12) continue;
          axis.normalize();
          stepQ.setFromAxisAngle(axis, angle);
          this.localR[bi].multiply(stepQ).normalize();

          if (link.hasLimit && link.min && link.max) {
            euler.setFromQuaternion(this.localR[bi], 'XYZ');
            euler.set(
              clamp(euler.x, link.min[0], link.max[0]),
              clamp(euler.y, link.min[1], link.max[1]),
              clamp(euler.z, link.min[2], link.max[2]),
              'XYZ',
            );
            this.localR[bi].setFromEuler(euler);
          }
        }
        this.updateWorldRecursive(bi);
      }
    }
  }
}

const ONE = new Vector3(1, 1, 1);
const X_AXIS = new Vector3(1, 0, 0);
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
const _mInv = new Matrix4();

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) [lo, hi] = [hi, lo];
  return Math.min(hi, Math.max(lo, v));
}

function isXHinge(min: number[] | null, max: number[] | null, hasLimit: boolean): boolean {
  if (!hasLimit || !min || !max) return false;
  const eps = 1e-6;
  return (
    Math.abs(min[1]) < eps && Math.abs(max[1]) < eps &&
    Math.abs(min[2]) < eps && Math.abs(max[2]) < eps &&
    Math.abs(max[0] - min[0]) > eps
  );
}
