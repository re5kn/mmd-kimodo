import { describe, expect, test } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { PhysicsBoneMode, PoseSolver } from '../../mmd/pose';
import { composeEuler, PhysicsRig } from '../rig';
import { body, bone, joint } from './fixtures';

describe('composeEuler', () => {
  test('applies rotations in Y, X, Z order (R = Ry * Rx * Rz)', () => {
    const [x, y, z] = [0.3, -0.7, 1.1];
    const m = composeEuler([1, 2, 3], [x, y, z]);
    const expected = new Matrix4().makeRotationY(y).multiply(new Matrix4().makeRotationX(x)).multiply(new Matrix4().makeRotationZ(z));
    expected.setPosition(1, 2, 3);
    m.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 6));
  });
});

describe('PhysicsRig', () => {
  const bones = [bone('root', [0, 0, 0], -1), bone('head', [0, 10, 0], 0), bone('hair', [0, 11, 1], 1)];
  const bodies = [
    body('head', 1, [0, 10.5, 0], 0),
    body('hair', 2, [0, 10, 1.2], 1, { rotation: [0.2, 0, 0] }),
    body('free', -1, [5, 5, 5], 1),
  ];

  test('body offsets reproduce the rest pose and drive the right bones', () => {
    const rig = new PhysicsRig({ bones, rigidBodies: bodies, joints: [joint(0, 1, [0, 11, 1]), joint(1, 1, [0, 0, 0]), joint(0, 9, [0, 0, 0])] });
    const solver = new PoseSolver(bones);
    solver.solve();
    const m = new Matrix4();
    for (let i = 0; i < bodies.length; i++) {
      rig.bodyTarget(i, solver.world, m);
      m.elements.forEach((v, k) => expect(v).toBeCloseTo(rig.bodyRest[i].elements[k], 6));
      // ...and the bone recovered from the body is the bone's rest world matrix.
      if (rig.bodyBone[i] >= 0) {
        rig.boneFromBody(i, m, m);
        expect(new Vector3().setFromMatrixPosition(m).distanceTo(new Vector3(...bones[rig.bodyBone[i]].position))).toBeLessThan(1e-6);
      }
    }
    expect(Array.from(rig.boneModes)).toEqual([0, 0, PhysicsBoneMode.Full]);
    expect(rig.drivingBody[2]).toBe(1);
    // Invalid joints (same body, out of range) are dropped.
    expect(rig.joints).toHaveLength(1);
  });

  test('mode 2 bodies drive rotation only', () => {
    const rig = new PhysicsRig({ bones, rigidBodies: [body('hair', 2, [0, 10, 1], 2)], joints: [] });
    expect(rig.boneModes[2]).toBe(PhysicsBoneMode.RotationOnly);
  });
});

describe('PoseSolver.applyPhysics', () => {
  test('driven bones take the target, children follow', () => {
    const bones = [bone('root', [0, 0, 0], -1), bone('a', [0, 10, 0], 0), bone('b', [0, 8, 0], 1)];
    const solver = new PoseSolver(bones);
    solver.motionT[0].set(3, 0, 0);
    solver.solve(true, 'beforePhysics');
    // Bone a swings 90° about Z around its own position.
    const target = bones.map(() => new Matrix4());
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    target[1].compose(new Vector3(3, 10, 0), q, new Vector3(1, 1, 1));
    solver.applyPhysics([0, PhysicsBoneMode.Full, 0], target);
    expect(solver.worldPosition(1).distanceTo(new Vector3(3, 10, 0))).toBeLessThan(1e-6);
    // b hangs 2 below a in rest; rotated +90° about Z it ends up at +X... (-y rotated by 90° about z = +x)
    expect(solver.worldPosition(2).distanceTo(new Vector3(5, 10, 0))).toBeLessThan(1e-6);
    expect(solver.localR[1].angleTo(q)).toBeLessThan(1e-6);
  });

  test('rotation-only keeps the animated local translation', () => {
    const bones = [bone('root', [0, 0, 0], -1), bone('a', [0, 10, 0], 0)];
    const solver = new PoseSolver(bones);
    solver.motionT[1].set(0, 1, 0);
    solver.solve(true, 'beforePhysics');
    const target = [new Matrix4(), new Matrix4().makeRotationX(0.5).setPosition(100, 100, 100)];
    solver.applyPhysics([0, PhysicsBoneMode.RotationOnly], target);
    expect(solver.worldPosition(1).distanceTo(new Vector3(0, 11, 0))).toBeLessThan(1e-6);
    expect(solver.localR[1].angleTo(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5))).toBeLessThan(1e-6);
  });
});
