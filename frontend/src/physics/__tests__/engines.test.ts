import { beforeAll, describe, expect, test } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import AmmoInit from 'ammojs-typed/wasm';
import { RigidBodyShape } from '../../api/types';
import { PhysicsBoneMode, PoseSolver } from '../../mmd/pose';
import RAPIER from '@dimforge/rapier3d-compat';
import { AmmoPhysics } from '../ammo/AmmoPhysics';
import { interactionGroups, RapierPhysics, toRapierDamping } from '../rapier/RapierPhysics';
import type { PhysicsEngine, PhysicsModel } from '../types';
import { body, bone, joint } from './fixtures';

let ammo: Awaited<ReturnType<typeof AmmoInit>>;
beforeAll(async () => {
  ammo = await AmmoInit();
  await RAPIER.init();
});

/** Every engine must pass the same behaviour tests. */
const ENGINES: [string, () => PhysicsEngine][] = [
  ['AmmoPhysics', () => AmmoPhysics.fromModule(ammo)],
  ['RapierPhysics', () => RapierPhysics.fromModule(RAPIER)],
];

/** Head (follows bone) with a two-segment ponytail hanging behind it (+Z). */
function ponytail(): PhysicsModel {
  const bones = [
    bone('root', [0, 0, 0], -1),
    bone('head', [0, 10, 0], 0),
    bone('hair1', [0, 10, 1], 1),
    bone('hair2', [0, 8, 1], 2),
  ];
  const capsule = { shape: RigidBodyShape.Capsule, size: [0.2, 1.4, 0] as [number, number, number], group: 1, collisionMask: 0x0001 };
  return {
    bones,
    rigidBodies: [
      body('head', 1, [0, 10, 0], 0, { size: [0.8, 0, 0] }),
      body('hair1', 2, [0, 9, 1], 1, capsule),
      body('hair2', 3, [0, 7, 1], 1, capsule),
    ],
    joints: [joint(0, 1, [0, 10, 1]), joint(1, 2, [0, 8, 1])],
  };
}

function run(engine: PhysicsEngine, solver: PoseSolver, seconds: number, move?: (t: number) => void) {
  const target = Array.from({ length: solver.count }, () => new Matrix4());
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    solver.resetInputs();
    move?.(t);
    solver.solve(true, 'beforePhysics');
    engine.setBoneTransforms(solver.world);
    engine.step(dt);
    engine.getBoneTransforms(target);
    solver.applyPhysics(engine.boneModes, target);
    solver.solve(true, 'afterPhysics');
  }
}

describe.each(ENGINES)('%s', (_name, createEngine) => {
  test('hair hanging straight down stays in place and attached', () => {
    const model = ponytail();
    const engine = createEngine();
    engine.setup(model);
    const solver = new PoseSolver(model.bones);
    solver.solve();
    engine.reset(solver.world);
    expect(Array.from(engine.boneModes)).toEqual([0, 0, PhysicsBoneMode.Full, PhysicsBoneMode.Full]);
    run(engine, solver, 1);
    expect(solver.worldPosition(2).distanceTo(new Vector3(0, 10, 1))).toBeLessThan(0.05);
    expect(solver.worldPosition(3).distanceTo(new Vector3(0, 8, 1))).toBeLessThan(0.1);
    engine.dispose();
  });

  test('moving the head forward makes the hair trail behind', () => {
    const model = ponytail();
    const engine = createEngine();
    engine.setup(model);
    const solver = new PoseSolver(model.bones);
    solver.solve();
    engine.reset(solver.world);
    // Root moves toward -Z (the model's front) at 20 units/s.
    let rootZ = 0;
    let maxLag = 0;
    let maxAngle = 0;
    const head = new Vector3();
    const tip = new Vector3();
    run(engine, solver, 0.5, (t) => {
      // Lag of the previous step's pose (the callback runs before solving).
      solver.worldPosition(1, head);
      solver.worldPosition(3, tip);
      maxLag = Math.max(maxLag, tip.z - head.z);
      maxAngle = Math.max(maxAngle, 2 * Math.acos(Math.min(1, Math.abs(solver.localR[2].w))));
      rootZ = -20 * t;
      solver.motionT[0].set(0, 0, rootZ);
    });
    // The hair root stays on the head (joint has no linear freedom)...
    expect(solver.worldPosition(2).distanceTo(new Vector3(0, 10, 1 + rootZ))).toBeLessThan(0.3);
    // ...while the tip swings back (+Z relative to the head; 1 at rest).
    expect(maxLag).toBeGreaterThan(1.3);
    // The joint's ±1 rad angular limit holds (with some slack for the solver).
    expect(maxAngle).toBeGreaterThan(0.3);
    expect(maxAngle).toBeLessThan(1.15);
    engine.dispose();
  });

  test('swinging hair settles back under gravity, setup can be replaced', () => {
    const model = ponytail();
    const engine = createEngine();
    engine.setup(model);
    engine.setup(model); // replacing the model must not leak or crash
    const solver = new PoseSolver(model.bones);
    // Start with hair1 rotated 60° (bodies placed from this pose by reset).
    solver.motionR[2].setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3);
    solver.solve();
    engine.reset(solver.world);
    run(engine, solver, 4);
    expect(solver.worldPosition(3).distanceTo(new Vector3(0, 8, 1))).toBeLessThan(0.3);
    const out = model.rigidBodies.map(() => new Matrix4());
    engine.getRigidBodyTransforms(out);
    expect(new Vector3().setFromMatrixPosition(out[0]).distanceTo(new Vector3(0, 10, 0))).toBeLessThan(1e-4);
    engine.dispose();
  });
});

describe('Rapier parameter conversion', () => {
  test('damping keeps the same decay per second as Bullet', () => {
    expect(toRapierDamping(0)).toBeCloseTo(0, 12);
    // Bullet: v *= (1 - 0.5) each second. Rapier with c: v *= 1 / (1 + c dt) per step.
    const c = toRapierDamping(0.5);
    let v = 1;
    for (let i = 0; i < 120; i++) v /= 1 + c / 120;
    expect(v).toBeCloseTo(0.5, 2);
    expect(Number.isFinite(toRapierDamping(1))).toBe(true);
  });

  test('collision groups pack membership and filter', () => {
    expect(interactionGroups(0, 0xffff)).toBe(0x0001ffff);
    expect(interactionGroups(15, 0x0001)).toBe(0x80000001);
  });
});
