import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { RigidBodyShape } from '../../api/types';
import { PoseSolver } from '../../mmd/pose';
import {
  DEFAULT_SWAY_PARAMS,
  defaultSwayEnd,
  penetration,
  pushOut,
  resolveSwayChain,
  swayEndCandidates,
  SwaySystem,
  type SwayChainSettings,
} from '../sway';
import { body, bone } from './fixtures';

// root - head - hair1 - hair2 - hair3 (sticking out forward, -Z), plus a ribbon off the head.
const bones = [
  bone('root', [0, 0, 0], -1),
  bone('head', [0, 10, 0], 0),
  bone('hair1', [0, 10, -1], 1),
  bone('hair2', [0, 10, -2], 2),
  bone('hair3', [0, 10, -3], 3),
  bone('ribbon', [1, 11, 0], 1),
];

function chain(extra: Partial<SwayChainSettings> = {}): SwayChainSettings {
  return { id: 'c', enabled: true, startBone: 'hair1', endBone: 'hair3', blend: 'with', ...DEFAULT_SWAY_PARAMS, ...extra };
}

function run(system: SwaySystem, solver: PoseSolver, seconds: number, before?: (t: number) => void) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    before?.(t);
    solver.solve();
    system.update(solver, dt);
  }
}

const tip = (solver: PoseSolver) => solver.worldPosition(4);

describe('chain lookup', () => {
  test('resolves the parent path from start to end', () => {
    expect(resolveSwayChain(bones, 'hair1', 'hair3')).toEqual([2, 3, 4]);
    expect(resolveSwayChain(bones, 'head', 'hair2')).toEqual([1, 2, 3]);
    expect(resolveSwayChain(bones, 'hair3', 'hair1')).toBeNull();
    expect(resolveSwayChain(bones, 'hair1', 'ribbon')).toBeNull();
    expect(resolveSwayChain(bones, 'nope', 'hair3')).toBeNull();
  });

  test('end candidates are the descendants; the default end follows single children', () => {
    expect(swayEndCandidates(bones, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(defaultSwayEnd(bones, 2)).toBe(4);
    expect(defaultSwayEnd(bones, 1)).toBe(1); // two children: stop
  });
});

describe('SwaySystem', () => {
  test('a stiff chain without gravity stays where the animation puts it', () => {
    const solver = new PoseSolver(bones);
    solver.solve();
    const system = new SwaySystem(bones, [], [chain({ gravity: 0, stiffness: 1 })]);
    system.reset(solver);
    run(system, solver, 1);
    expect(tip(solver).distanceTo(new Vector3(0, 10, -3))).toBeLessThan(1e-4);
  });

  test('gravity bends the chain down, keeps the bone lengths and settles', () => {
    const solver = new PoseSolver(bones);
    solver.solve();
    const system = new SwaySystem(bones, [], [chain({ gravity: 1, stiffness: 0.5 })]);
    system.reset(solver);
    run(system, solver, 3);
    const p = tip(solver);
    expect(p.y).toBeLessThan(9.5);
    expect(solver.worldPosition(3).distanceTo(solver.worldPosition(2))).toBeCloseTo(1, 5);
    expect(p.distanceTo(solver.worldPosition(3))).toBeCloseTo(1, 5);
    // Settled: another second changes almost nothing.
    const before = p.clone();
    run(system, solver, 1);
    expect(tip(solver).distanceTo(before)).toBeLessThan(0.01);
  });

  test('the chain lags behind a moving head and swings back', () => {
    const solver = new PoseSolver(bones);
    solver.solve();
    const system = new SwaySystem(bones, [], [chain({ gravity: 0 })]);
    system.reset(solver);
    // Move the whole model to +X for 0.2 s.
    run(system, solver, 0.2, (t) => solver.motionT[0].set(t * 20, 0, 0));
    const lag = tip(solver).x - solver.worldPosition(2).x;
    expect(lag).toBeLessThan(-0.1);
    run(system, solver, 3);
    expect(Math.abs(tip(solver).x - solver.worldPosition(2).x)).toBeLessThan(0.01);
  });

  test('tails stay out of bone-following bodies', () => {
    const solver = new PoseSolver(bones);
    solver.solve();
    // A ball under the middle of the strand, following the root.
    const ball = body('ball', 0, [0, 8.6, -2.5], 0, { size: [1, 0, 0] });
    const system = new SwaySystem(bones, [ball], [chain({ gravity: 1, stiffness: 0.1, radius: 0.1 })]);
    expect(system.info()[0].colliderCount).toBe(1);
    system.reset(solver);
    run(system, solver, 3);
    for (const b of [3, 4]) {
      expect(solver.worldPosition(b).distanceTo(new Vector3(0, 8.6, -2.5))).toBeGreaterThan(1.1 - 1e-3);
    }
    // Without collisions the tip falls through the ball's place.
    const free = new PoseSolver(bones);
    free.solve();
    const noHit = new SwaySystem(bones, [ball], [chain({ gravity: 1, stiffness: 0.1, radius: 0.1, collide: false })]);
    noHit.reset(free);
    run(noHit, free, 3);
    expect(tip(free).y).toBeLessThan(tip(solver).y);
  });

  test('bodies that hold the chain at rest are not used as colliders', () => {
    const head = body('head', 1, [0, 10, 0], 0, { size: [1.5, 0, 0] });
    const system = new SwaySystem(bones, [head], [chain()]);
    expect(system.info()[0].colliderCount).toBe(0);
  });

  test('disabled or broken chains are skipped', () => {
    const system = new SwaySystem(bones, [], [chain({ enabled: false }), chain({ endBone: 'ribbon' })]);
    expect(system.active).toBe(false);
  });
});

describe('shapes', () => {
  test('box: pushes out through the nearest face or corner', () => {
    const size = [1, 2, 3];
    const p = new Vector3(0.8, 0, 0);
    expect(penetration(RigidBodyShape.Box, size, p, 0.1)).toBeCloseTo(0.3, 6);
    expect(pushOut(RigidBodyShape.Box, size, p, 0.1)).toBe(true);
    expect(p.x).toBeCloseTo(1.1, 6);
    const corner = new Vector3(1.05, 2.05, 0);
    pushOut(RigidBodyShape.Box, size, corner, 0.1);
    expect(corner.distanceTo(new Vector3(1, 2, 0))).toBeCloseTo(0.1, 6);
    expect(pushOut(RigidBodyShape.Box, size, new Vector3(2, 0, 0), 0.1)).toBe(false);
  });

  test('capsule: the axis is local Y with the given cylinder height', () => {
    const size = [0.5, 2, 0];
    const p = new Vector3(0.3, 0.9, 0);
    pushOut(RigidBodyShape.Capsule, size, p, 0.1);
    expect(p.x).toBeCloseTo(0.6, 6);
    expect(p.y).toBeCloseTo(0.9, 6);
    const end = new Vector3(0, 1.3, 0);
    pushOut(RigidBodyShape.Capsule, size, end, 0.1);
    expect(end.y).toBeCloseTo(1.6, 6);
  });
});
