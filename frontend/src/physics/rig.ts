import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { RigidBodyMode, type JointDto, type RigidBodyDto } from '../api/types';
import { PhysicsBoneMode } from '../mmd/pose';
import type { PhysicsModel } from './types';

/**
 * Engine-independent setup shared by every {@link PhysicsEngine}: rest
 * transforms of bodies and joints, the fixed offset between each body and its
 * bone, and which bones are driven by physics. All in PMX space.
 *
 * PMX stores rotations as Euler angles applied Y, X, Z (DirectX yaw-pitch-roll),
 * which is three.js order 'YXZ' (R = Ry * Rx * Rz).
 */
export class PhysicsRig {
  /** Body world matrix in the rest pose. */
  readonly bodyRest: Matrix4[];
  /** body = boneWorld * offset (bone world is the identity for bodies without a bone). */
  readonly offset: Matrix4[];
  readonly offsetInverse: Matrix4[];
  /** Bone index per body, -1 if none / out of range. */
  readonly bodyBone: Int32Array;
  readonly boneModes: Uint8Array;
  /** For each driven bone, the body that drives it. */
  readonly drivingBody: Int32Array;
  /** Joints that can be built (both bodies valid and different). */
  readonly joints: { joint: JointDto; a: number; b: number; frameA: Matrix4; frameB: Matrix4 }[];

  constructor(readonly model: PhysicsModel) {
    const { bones, rigidBodies } = model;
    const nb = bones.length;
    this.bodyRest = rigidBodies.map((rb) => composeEuler(rb.position, rb.rotation));
    this.bodyBone = Int32Array.from(rigidBodies, (rb) => (rb.bone >= 0 && rb.bone < nb ? rb.bone : -1));
    this.offset = rigidBodies.map((_, i) => {
      const bone = this.bodyBone[i];
      const m = this.bodyRest[i].clone();
      if (bone >= 0) {
        const p = bones[bone].position;
        m.premultiply(new Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
      }
      return m;
    });
    this.offsetInverse = this.offset.map((m) => m.clone().invert());

    this.boneModes = new Uint8Array(nb);
    this.drivingBody = new Int32Array(nb).fill(-1);
    rigidBodies.forEach((rb, i) => {
      const bone = this.bodyBone[i];
      if (bone < 0 || rb.mode === RigidBodyMode.FollowBone) return;
      // A bone with several simulated bodies is driven by the first one.
      if (this.drivingBody[bone] >= 0) return;
      this.drivingBody[bone] = i;
      this.boneModes[bone] = rb.mode === RigidBodyMode.PhysicsWithBone ? PhysicsBoneMode.RotationOnly : PhysicsBoneMode.Full;
    });

    const n = rigidBodies.length;
    this.joints = [];
    for (const joint of model.joints) {
      const a = joint.rigidBodyA, b = joint.rigidBodyB;
      if (a < 0 || b < 0 || a >= n || b >= n || a === b) continue;
      const jointRest = composeEuler(joint.position, joint.rotation);
      this.joints.push({
        joint, a, b,
        frameA: this.bodyRest[a].clone().invert().multiply(jointRest),
        frameB: this.bodyRest[b].clone().invert().multiply(jointRest),
      });
    }
  }

  get bodyCount(): number {
    return this.model.rigidBodies.length;
  }

  body(i: number): RigidBodyDto {
    return this.model.rigidBodies[i];
  }

  /** World matrix a body should have when its bone is at `boneWorld`. */
  bodyTarget(i: number, boneWorld: readonly Matrix4[], out: Matrix4): Matrix4 {
    const bone = this.bodyBone[i];
    return bone >= 0 ? out.multiplyMatrices(boneWorld[bone], this.offset[i]) : out.copy(this.offset[i]);
  }

  /** Bone world matrix implied by a body's world matrix. */
  boneFromBody(i: number, bodyWorld: Matrix4, out: Matrix4): Matrix4 {
    return out.multiplyMatrices(bodyWorld, this.offsetInverse[i]);
  }
}

const _e = new Euler();
const _q = new Quaternion();
const ONE = new Vector3(1, 1, 1);

export function composeEuler(position: readonly number[], rotation: readonly number[], out = new Matrix4()): Matrix4 {
  _e.set(rotation[0], rotation[1], rotation[2], 'YXZ');
  return out.compose(new Vector3(position[0], position[1], position[2]), _q.setFromEuler(_e), ONE);
}
