import type { Matrix4 } from 'three';
import type { BoneDto, JointDto, RigidBodyDto } from '../api/types';

/** Physics engines that can be selected in the settings. */
export type PhysicsEngineKind = 'ammo' | 'rapier';

/**
 * Simulation accuracy. 'high' solves joints more finely (finer steps and
 * softer limit correction in Ammo.js, more solver iterations in Rapier): hair
 * and skirts jitter less at rest and stretch less while moving, for about 2-4
 * times as much time per frame.
 */
export type PhysicsQuality = 'standard' | 'high';

/** Input for {@link PhysicsEngine.setup}: the parts of a PMX model physics needs. */
export interface PhysicsModel {
  bones: readonly BoneDto[];
  rigidBodies: readonly RigidBodyDto[];
  joints: readonly JointDto[];
}

/**
 * Common interface for MMD physics (rigid bodies + joints). The viewer only
 * talks to this, so engines can be swapped in the settings.
 *
 * All matrices are in native PMX space (left-handed, Y up), like the bone
 * solver. Per frame the viewer calls:
 *   setBoneTransforms(animated pose) -> step(dt) -> getBoneTransforms(out)
 * and calls reset() instead of step() after a seek or a model / motion change.
 */
export interface PhysicsEngine {
  readonly kind: PhysicsEngineKind;

  /** PMX の剛体とジョイントを登録する (replaces the previous model). */
  setup(model: PhysicsModel): void;

  /**
   * ボーンの姿勢を渡す: bone world matrices after animation and IK.
   * Bodies that follow bones are moved to match.
   */
  setBoneTransforms(boneWorld: readonly Matrix4[]): void;

  /** Moves every body to its place on the given pose and clears velocities. */
  reset(boneWorld: readonly Matrix4[]): void;

  /** Changes the accuracy; keeps the current state (no reset needed). */
  setQuality(quality: PhysicsQuality): void;

  /** 1ステップ進める (seconds of simulated time; split into fixed sub-steps). */
  step(dt: number): void;

  /**
   * 剛体の姿勢を受け取ってボーンに戻す: writes world matrices for the bones
   * driven by physics into `out` (see {@link boneModes} for which ones).
   */
  getBoneTransforms(out: Matrix4[]): void;

  /** Per bone: 0 not driven, 1 position + rotation, 2 rotation only (PhysicsBoneMode). */
  readonly boneModes: Uint8Array;

  /** Current world matrix of every rigid body (for the debug view). */
  getRigidBodyTransforms(out: Matrix4[]): void;

  dispose(): void;
}

export interface PhysicsEngineInfo {
  kind: PhysicsEngineKind;
  label: string;
  /** False while an engine is listed in the settings but not implemented yet. */
  available: boolean;
}
