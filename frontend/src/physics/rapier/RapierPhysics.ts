import { Matrix4, Quaternion, Vector3 } from 'three';
import type { ColliderDesc, ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import { RigidBodyMode, RigidBodyShape, type JointDto } from '../../api/types';
import { PhysicsRig } from '../rig';
import type { PhysicsEngine, PhysicsModel } from '../types';
import { loadRapier, type RapierModule } from './loadRapier';

/** Same settings as the Ammo.js engine, so the two are comparable. */
const GRAVITY = -9.8 * 10;
const FIXED_STEP = 1 / 120;
const MAX_SUB_STEPS = 8;
const WARMUP_STEPS = 60;

/** Joint limits with lower == upper lock the axis; lower > upper leaves it free (as in Bullet). */
const LOCK_EPSILON = 1e-6;

interface Body {
  rb: RigidBody;
  kinematic: boolean;
  pinPosition: boolean;
}

/**
 * {@link PhysicsEngine} on Rapier (Rust, WebAssembly).
 *
 * Rapier has no 6DOF spring constraint like Bullet, so an MMD joint becomes a
 * generic joint with both local frames set: axes whose limits are equal are
 * locked, ranges become per-axis limits, and springs become position motors
 * aiming at the rest pose. Damping is converted from Bullet's "fraction lost
 * per second" to Rapier's coefficient. Motion is similar to MMD but not equal.
 */
export class RapierPhysics implements PhysicsEngine {
  readonly kind = 'rapier' as const;
  boneModes: Uint8Array = new Uint8Array(0);

  static async create(): Promise<RapierPhysics> {
    return new RapierPhysics(await loadRapier());
  }

  /** For an already initialized module (tests). */
  static fromModule(rapier: RapierModule): RapierPhysics {
    return new RapierPhysics(rapier);
  }

  private world: World | null = null;
  private rig: PhysicsRig | null = null;
  private bodies: Body[] = [];
  private accumulator = 0;

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();

  private constructor(private readonly R: RapierModule) {}

  setup(model: PhysicsModel): void {
    this.teardown();
    const R = this.R;
    const rig = new PhysicsRig(model);
    const world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = FIXED_STEP;
    this.world = world;
    this.rig = rig;
    this.boneModes = rig.boneModes;

    for (let i = 0; i < rig.bodyCount; i++) {
      const def = rig.body(i);
      // A simulated body without mass cannot move in Bullet either; let it follow its bone.
      const kinematic = def.mode === RigidBodyMode.FollowBone || def.mass <= 0;
      rig.bodyRest[i].decompose(this.p, this.q, this.s);
      const desc = (kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(this.p.x, this.p.y, this.p.z)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
        .setLinearDamping(toRapierDamping(def.linearDamping))
        .setAngularDamping(toRapierDamping(def.angularDamping))
        .setCanSleep(false);
      const rb = world.createRigidBody(desc);
      const collider = this.createShape(def.shape, def.size)
        .setRestitution(def.restitution)
        .setFriction(def.friction)
        .setCollisionGroups(interactionGroups(def.group, def.collisionMask));
      if (!kinematic) collider.setMass(def.mass);
      world.createCollider(collider, rb);
      this.bodies.push({ rb, kinematic, pinPosition: def.mode === RigidBodyMode.PhysicsWithBone });
    }

    for (const { joint, a, b, frameA, frameB } of rig.joints) {
      this.createJoint(joint, this.bodies[a].rb, this.bodies[b].rb, frameA, frameB);
    }
  }

  setBoneTransforms(boneWorld: readonly Matrix4[]): void {
    const rig = this.rig;
    if (!rig) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      if (body.kinematic) {
        rig.bodyTarget(i, boneWorld, this.m).decompose(this.p, this.q, this.s);
        body.rb.setNextKinematicTranslation(this.p);
        body.rb.setNextKinematicRotation(this.q);
      } else if (body.pinPosition && rig.bodyBone[i] >= 0) {
        rig.bodyTarget(i, boneWorld, this.m);
        body.rb.setTranslation(this.p.setFromMatrixPosition(this.m), true);
      }
    }
  }

  reset(boneWorld: readonly Matrix4[]): void {
    const rig = this.rig;
    const world = this.world;
    if (!rig || !world) return;
    const zero = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.bodies.length; i++) {
      const { rb, kinematic } = this.bodies[i];
      rig.bodyTarget(i, boneWorld, this.m).decompose(this.p, this.q, this.s);
      rb.setTranslation(this.p, true);
      rb.setRotation(this.q, true);
      if (kinematic) {
        rb.setNextKinematicTranslation(this.p);
        rb.setNextKinematicRotation(this.q);
      } else {
        rb.setLinvel(zero, true);
        rb.setAngvel(zero, true);
      }
    }
    this.accumulator = 0;
    // Let hair and skirts settle before the first frame is shown (0.5 s).
    for (let k = 0; k < WARMUP_STEPS; k++) world.step();
  }

  step(dt: number): void {
    const world = this.world;
    if (!world || dt <= 0) return;
    this.accumulator = Math.min(this.accumulator + dt, MAX_SUB_STEPS * FIXED_STEP);
    while (this.accumulator >= FIXED_STEP) {
      world.step();
      this.accumulator -= FIXED_STEP;
    }
  }

  getBoneTransforms(out: Matrix4[]): void {
    const rig = this.rig;
    if (!rig) return;
    for (let bone = 0; bone < rig.drivingBody.length; bone++) {
      const i = rig.drivingBody[bone];
      if (i < 0) continue;
      this.readBody(i, this.m);
      rig.boneFromBody(i, this.m, out[bone]);
    }
  }

  getRigidBodyTransforms(out: Matrix4[]): void {
    for (let i = 0; i < this.bodies.length && i < out.length; i++) this.readBody(i, out[i]);
  }

  dispose(): void {
    this.teardown();
  }

  private readBody(i: number, out: Matrix4): void {
    const { rb } = this.bodies[i];
    const t = rb.translation();
    const r = rb.rotation();
    out.compose(this.p.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), this.s.set(1, 1, 1));
  }

  private createShape(shape: number, size: readonly number[]): ColliderDesc {
    const R = this.R;
    const e = 1e-3;
    switch (shape) {
      case RigidBodyShape.Box:
        return R.ColliderDesc.cuboid(Math.max(size[0], e), Math.max(size[1], e), Math.max(size[2], e));
      case RigidBodyShape.Capsule:
        // PMX height is the cylinder part; Rapier takes half of it.
        return R.ColliderDesc.capsule(Math.max(size[1], 0) / 2, Math.max(size[0], e));
      default:
        return R.ColliderDesc.ball(Math.max(size[0], e));
    }
  }

  private createJoint(joint: JointDto, a: RigidBody, b: RigidBody, frameA: Matrix4, frameB: Matrix4): ImpulseJoint {
    const R = this.R;
    const world = this.world!;
    const lower = [...joint.linearLowerLimit, ...joint.angularLowerLimit];
    const upper = [...joint.linearUpperLimit, ...joint.angularUpperLimit];
    const springs = [...joint.springLinear, ...joint.springAngular];
    let locked = 0;
    for (let k = 0; k < 6; k++) {
      if (Math.abs(upper[k] - lower[k]) < LOCK_EPSILON) locked |= 1 << k; // JointAxesMask bit order: LinX..AngZ
    }

    frameA.decompose(this.p, this.q, this.s);
    const anchorA = { x: this.p.x, y: this.p.y, z: this.p.z };
    const rotA = { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w };
    frameB.decompose(this.p, this.q, this.s);
    const anchorB = { x: this.p.x, y: this.p.y, z: this.p.z };
    const rotB = { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w };

    const data = R.JointData.generic(anchorA, anchorB, { x: 1, y: 0, z: 0 }, locked as number);
    const j = world.createImpulseJoint(data, a, b, true);
    // generic() only takes an X axis; set the full frames so the joint axes match PMX.
    j.setLocalFrame1(anchorA, rotA);
    j.setLocalFrame2(anchorB, rotB);
    j.setContactsEnabled(false);

    const raw = world.impulseJoints.raw;
    for (let k = 0; k < 6; k++) {
      if (locked & (1 << k)) continue;
      const axis = k as unknown as Parameters<typeof raw.jointSetLimits>[1];
      if (lower[k] < upper[k]) raw.jointSetLimits(j.handle, axis, lower[k], upper[k]);
      if (springs[k] !== 0) {
        raw.jointConfigureMotorModel(j.handle, axis, R.MotorModel.ForceBased as unknown as Parameters<typeof raw.jointConfigureMotorModel>[2]);
        raw.jointConfigureMotorPosition(j.handle, axis, 0, springs[k], 0);
      }
    }
    return j;
  }

  private teardown(): void {
    this.world?.free();
    this.world = null;
    this.rig = null;
    this.bodies = [];
    this.accumulator = 0;
    this.boneModes = new Uint8Array(0);
  }
}

/**
 * Bullet damps velocity by v *= (1 - d) per second; Rapier by v *= 1 / (1 + c dt).
 * For small steps the same decay needs c = -ln(1 - d).
 */
export function toRapierDamping(d: number): number {
  return -Math.log(1 - Math.min(Math.max(d, 0), 0.999));
}

/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
export function interactionGroups(group: number, mask: number): number {
  return (((1 << (group & 15)) << 16) | (mask & 0xffff)) >>> 0;
}
