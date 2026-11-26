import { Matrix4, Quaternion, Vector3 } from 'three';
import { RigidBodyMode } from '../api/types';
import type { PhysicsRig } from './rig';

export interface StillnessOptions {
  /** Inputs must stay unchanged this long (simulated seconds) before freezing. */
  settleSeconds: number;
  /** After this long without input changes, freeze even if bodies still move. */
  maxSettleSeconds: number;
  /** Largest matrix element change that still counts as "unchanged". */
  inputEpsilon: number;
  /** Freeze early once no driven bone rotates more than this per frame (degrees). */
  outputDegrees: number;
}

export const DEFAULT_STILLNESS: StillnessOptions = {
  settleSeconds: 1,
  maxSettleSeconds: 4,
  inputEpsilon: 1e-4,
  outputDegrees: 0.5,
};

/**
 * Freezes the simulation while the model holds still (Issue #25).
 *
 * The iterative solvers never fully settle hair and skirts: bodies resting on
 * a joint limit keep bouncing a little forever, even with no motion. Physics
 * only depends on the bones of the bone-following bodies, so once those have
 * not moved for a while the last result is held and stepping is skipped.
 * Any change of those bones resumes the simulation on the same frame.
 *
 * Per frame: {@link beforeStep} (skip the step when it returns true), then,
 * if stepped, {@link afterStep} with the bone matrices read from the engine.
 */
export class StillnessDetector {
  /** True while the result is held and the engine is not stepped. */
  frozen = false;
  private stillTime = 0;
  private readonly lastInput: Float64Array;
  private hasInput = false;
  private readonly lastOutput: Quaternion[];
  private hasOutput = false;
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    /** Bones whose world matrices drive the simulation. */
    private readonly inputBones: readonly number[],
    /** Bones written from rigid bodies (used to see when the swing has died down). */
    private readonly outputBones: readonly number[],
    private readonly options: StillnessOptions = DEFAULT_STILLNESS,
  ) {
    this.lastInput = new Float64Array(inputBones.length * 16);
    this.lastOutput = outputBones.map(() => new Quaternion());
  }

  /** The input / output bones of a rig. */
  static forRig(rig: PhysicsRig, options?: StillnessOptions): StillnessDetector {
    const input = new Set<number>();
    for (let i = 0; i < rig.bodyCount; i++) {
      const bone = rig.bodyBone[i];
      if (bone >= 0 && rig.body(i).mode === RigidBodyMode.FollowBone) input.add(bone);
    }
    const output: number[] = [];
    rig.drivingBody.forEach((body, bone) => {
      if (body >= 0) output.push(bone);
    });
    return new StillnessDetector([...input].sort((a, b) => a - b), output, options);
  }

  /** Forgets the history, e.g. after a physics reset. Unfreezes. */
  reset(): void {
    this.frozen = false;
    this.stillTime = 0;
    this.hasInput = false;
    this.hasOutput = false;
  }

  /**
   * Call before stepping with the bone world matrices of this frame.
   * Returns true when the step should be skipped (the result is frozen).
   */
  beforeStep(boneWorld: readonly Matrix4[], dt: number): boolean {
    if (this.inputChanged(boneWorld)) {
      this.frozen = false;
      this.stillTime = 0;
      return false;
    }
    if (this.frozen) return true;
    this.stillTime += Math.max(dt, 0);
    return false;
  }

  /** Call after a step with the bone matrices computed from the rigid bodies. */
  afterStep(target: readonly Matrix4[]): void {
    let maxDeg = Infinity;
    if (this.hasOutput) {
      maxDeg = 0;
      for (let k = 0; k < this.outputBones.length; k++) {
        target[this.outputBones[k]].decompose(this.p, this.q, this.s);
        const d = Math.min(1, Math.abs(this.q.dot(this.lastOutput[k])));
        maxDeg = Math.max(maxDeg, (2 * Math.acos(d) * 180) / Math.PI);
      }
    }
    for (let k = 0; k < this.outputBones.length; k++) {
      target[this.outputBones[k]].decompose(this.p, this.lastOutput[k], this.s);
    }
    this.hasOutput = true;

    const o = this.options;
    if (this.stillTime >= o.maxSettleSeconds || (this.stillTime >= o.settleSeconds && maxDeg <= o.outputDegrees)) {
      this.frozen = true;
    }
  }

  /** Compares with (and remembers) the input bones of the previous call. */
  private inputChanged(boneWorld: readonly Matrix4[]): boolean {
    const eps = this.options.inputEpsilon;
    let changed = !this.hasInput;
    for (let k = 0; k < this.inputBones.length; k++) {
      const e = boneWorld[this.inputBones[k]].elements;
      const base = k * 16;
      for (let j = 0; j < 16; j++) {
        if (Math.abs(e[j] - this.lastInput[base + j]) > eps) changed = true;
        this.lastInput[base + j] = e[j];
      }
    }
    this.hasInput = true;
    return changed;
  }
}
