import { Matrix4, Quaternion, Vector3 } from 'three';
import { RigidBodyMode, RigidBodyShape } from '../../api/types';
import { PhysicsRig } from '../rig';
import type { PhysicsEngine, PhysicsModel, PhysicsQuality } from '../types';
import { loadAmmo, type AmmoModule } from './loadAmmo';

type Ammo = AmmoModule;
type BtRigidBody = InstanceType<Ammo['btRigidBody']>;
type BtTransform = InstanceType<Ammo['btTransform']>;

/** MMD's gravity: 9.8 m/s² with 1 unit = 10 cm. */
const GRAVITY = -9.8 * 10;
/**
 * Per quality: fixed simulation step, the most sub-steps per call (at most
 * 1/15 s per frame) and the fraction of a joint limit violation corrected per
 * step (stop ERP).
 *
 * Standard keeps the 0.475 of three.js' former MMDPhysics: joints stay tight
 * while moving, but bodies resting on a limit overshoot and jitter (Issue #25).
 * High uses Bullet's default 0.2 with half the step, which both jitters less
 * and stretches less than standard.
 */
const STEPS: Record<PhysicsQuality, { fixedStep: number; maxSubSteps: number; limitErp: number }> = {
  standard: { fixedStep: 1 / 120, maxSubSteps: 8, limitErp: 0.475 },
  high: { fixedStep: 1 / 240, maxSubSteps: 16, limitErp: 0.2 },
};
/** Simulated time used to settle bodies after reset(). */
const WARMUP_STEPS = 30;
const WARMUP_DT = 1 / 60;

const CF_KINEMATIC_OBJECT = 2;
const DISABLE_DEACTIVATION = 4;
const BT_CONSTRAINT_STOP_ERP = 2;

interface Body {
  rb: BtRigidBody;
  kinematic: boolean;
}

/**
 * {@link PhysicsEngine} on Ammo.js, the WebAssembly port of Bullet, which is
 * the engine MMD itself uses. Joints are Bullet's 6DOF spring constraints.
 */
export class AmmoPhysics implements PhysicsEngine {
  readonly kind = 'ammo' as const;
  boneModes: Uint8Array = new Uint8Array(0);

  static async create(): Promise<AmmoPhysics> {
    return new AmmoPhysics(await loadAmmo());
  }

  /** For an already loaded module (tests load it without the browser URL). */
  static fromModule(ammo: Ammo): AmmoPhysics {
    return new AmmoPhysics(ammo);
  }

  private readonly config;
  private readonly dispatcher;
  private readonly broadphase;
  private readonly solver;
  private readonly world;
  private readonly tf: BtTransform;
  private readonly vec;
  private readonly quat;
  private readonly zero;

  private rig: PhysicsRig | null = null;
  private steps = STEPS.standard;
  private bodies: Body[] = [];
  private constraints: InstanceType<Ammo['btGeneric6DofSpringConstraint']>[] = [];
  /** Ammo objects owned by the current model, destroyed on teardown. */
  private owned: unknown[] = [];

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();

  private constructor(private readonly A: Ammo) {
    this.config = new A.btDefaultCollisionConfiguration();
    this.dispatcher = new A.btCollisionDispatcher(this.config);
    this.broadphase = new A.btDbvtBroadphase();
    this.solver = new A.btSequentialImpulseConstraintSolver();
    this.world = new A.btDiscreteDynamicsWorld(this.dispatcher, this.broadphase, this.solver, this.config);
    this.vec = new A.btVector3(0, GRAVITY, 0);
    this.world.setGravity(this.vec);
    this.tf = new A.btTransform();
    this.quat = new A.btQuaternion(0, 0, 0, 1);
    this.zero = new A.btVector3(0, 0, 0);
  }

  setup(model: PhysicsModel): void {
    this.teardown();
    const A = this.A;
    const rig = new PhysicsRig(model);
    this.rig = rig;
    this.boneModes = rig.boneModes;

    for (let i = 0; i < rig.bodyCount; i++) {
      const def = rig.body(i);
      const shape = this.createShape(def.shape, def.size);
      const kinematic = def.mode === RigidBodyMode.FollowBone;
      const mass = kinematic ? 0 : Math.max(def.mass, 0);
      const inertia = new A.btVector3(0, 0, 0);
      if (mass > 0) shape.calculateLocalInertia(mass, inertia);
      this.setTransform(this.tf, rig.bodyRest[i]);
      const motionState = new A.btDefaultMotionState(this.tf);
      const info = new A.btRigidBodyConstructionInfo(mass, motionState, shape, inertia);
      info.set_m_linearDamping(def.linearDamping);
      info.set_m_angularDamping(def.angularDamping);
      info.set_m_restitution(def.restitution);
      info.set_m_friction(def.friction);
      const rb = new A.btRigidBody(info);
      A.destroy(info);
      A.destroy(inertia);
      if (kinematic) rb.setCollisionFlags(rb.getCollisionFlags() | CF_KINEMATIC_OBJECT);
      rb.setActivationState(DISABLE_DEACTIVATION);
      rb.setSleepingThresholds(0, 0);
      this.world.addRigidBody(rb, 1 << (def.group & 15), def.collisionMask & 0xffff);
      this.bodies.push({ rb, kinematic });
      this.owned.push(shape, motionState);
    }

    for (const { joint, a, b, frameA, frameB } of rig.joints) {
      const fa = new A.btTransform();
      const fb = new A.btTransform();
      this.setTransform(fa, frameA);
      this.setTransform(fb, frameB);
      const c = new A.btGeneric6DofSpringConstraint(this.bodies[a].rb, this.bodies[b].rb, fa, fb, true);
      A.destroy(fa);
      A.destroy(fb);
      c.setLinearLowerLimit(this.v3(joint.linearLowerLimit));
      c.setLinearUpperLimit(this.v3(joint.linearUpperLimit));
      c.setAngularLowerLimit(this.v3(joint.angularLowerLimit));
      c.setAngularUpperLimit(this.v3(joint.angularUpperLimit));
      for (let k = 0; k < 3; k++) {
        if (joint.springLinear[k] !== 0) {
          c.enableSpring(k, true);
          c.setStiffness(k, joint.springLinear[k]);
        }
        if (joint.springAngular[k] !== 0) {
          c.enableSpring(k + 3, true);
          c.setStiffness(k + 3, joint.springAngular[k]);
        }
      }
      this.world.addConstraint(c, true);
      this.constraints.push(c);
    }
    this.applyLimitErp();
  }

  setBoneTransforms(boneWorld: readonly Matrix4[]): void {
    const rig = this.rig;
    if (!rig) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      if (body.kinematic) {
        rig.bodyTarget(i, boneWorld, this.m);
        this.setTransform(this.tf, this.m);
        body.rb.getMotionState().setWorldTransform(this.tf);
      }
    }
  }

  reset(boneWorld: readonly Matrix4[]): void {
    const rig = this.rig;
    if (!rig) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const { rb } = this.bodies[i];
      rig.bodyTarget(i, boneWorld, this.m);
      this.setTransform(this.tf, this.m);
      rb.setWorldTransform(this.tf);
      rb.setInterpolationWorldTransform(this.tf);
      rb.getMotionState().setWorldTransform(this.tf);
      rb.setLinearVelocity(this.zero);
      rb.setAngularVelocity(this.zero);
      rb.setInterpolationLinearVelocity(this.zero);
      rb.setInterpolationAngularVelocity(this.zero);
      rb.clearForces();
    }
    // Let hair and skirts settle under gravity before the first frame is shown.
    for (let k = 0; k < WARMUP_STEPS; k++) this.world.stepSimulation(WARMUP_DT, 1, WARMUP_DT);
  }

  setQuality(quality: PhysicsQuality): void {
    this.steps = STEPS[quality];
    this.applyLimitErp();
  }

  private applyLimitErp(): void {
    for (const c of this.constraints) {
      for (let k = 0; k < 6; k++) c.setParam(BT_CONSTRAINT_STOP_ERP, this.steps.limitErp, k);
    }
  }

  step(dt: number): void {
    if (!this.rig || dt <= 0) return;
    const { fixedStep, maxSubSteps } = this.steps;
    this.world.stepSimulation(Math.min(dt, maxSubSteps * fixedStep), maxSubSteps, fixedStep);
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
    const A = this.A;
    for (const o of [this.world, this.solver, this.broadphase, this.dispatcher, this.config, this.tf, this.vec, this.quat, this.zero]) {
      A.destroy(o);
    }
  }

  private readBody(i: number, out: Matrix4): void {
    const body = this.bodies[i];
    // Simulated bodies: the motion state holds the interpolated transform.
    body.rb.getMotionState().getWorldTransform(this.tf);
    const o = this.tf.getOrigin();
    const r = this.tf.getRotation();
    this.p.set(o.x(), o.y(), o.z());
    this.q.set(r.x(), r.y(), r.z(), r.w());
    out.compose(this.p, this.q, this.s.set(1, 1, 1));
  }

  private createShape(shape: number, size: readonly number[]) {
    const A = this.A;
    const e = 1e-3;
    switch (shape) {
      case RigidBodyShape.Box: {
        const half = new A.btVector3(Math.max(size[0], e), Math.max(size[1], e), Math.max(size[2], e));
        const s = new A.btBoxShape(half);
        A.destroy(half);
        return s;
      }
      case RigidBodyShape.Capsule:
        return new A.btCapsuleShape(Math.max(size[0], e), Math.max(size[1], 0));
      default:
        return new A.btSphereShape(Math.max(size[0], e));
    }
  }

  /** Sets a btTransform from a rigid PMX-space matrix. */
  private setTransform(t: BtTransform, m: Matrix4): void {
    m.decompose(this.p, this.q, this.s);
    this.vec.setValue(this.p.x, this.p.y, this.p.z);
    this.quat.setValue(this.q.x, this.q.y, this.q.z, this.q.w);
    t.setIdentity();
    t.setOrigin(this.vec);
    t.setRotation(this.quat);
  }

  private v3(v: readonly number[]) {
    this.vec.setValue(v[0], v[1], v[2]);
    return this.vec;
  }

  private teardown(): void {
    const A = this.A;
    for (const c of this.constraints) {
      this.world.removeConstraint(c);
      A.destroy(c);
    }
    for (const { rb } of this.bodies) {
      this.world.removeRigidBody(rb);
      A.destroy(rb);
    }
    for (const o of this.owned) A.destroy(o);
    this.constraints = [];
    this.bodies = [];
    this.owned = [];
    this.rig = null;
    this.boneModes = new Uint8Array(0);
  }
}
