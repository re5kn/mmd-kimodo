import type { PhysicsEngine, PhysicsEngineInfo, PhysicsEngineKind } from './types';

export type { PhysicsEngine, PhysicsEngineInfo, PhysicsEngineKind, PhysicsModel } from './types';

/** Engines shown in the settings. Rapier is planned (issue #3 Part 2). */
export const PHYSICS_ENGINES: readonly PhysicsEngineInfo[] = [
  { kind: 'ammo', label: 'Ammo.js (Bullet)', available: true },
  { kind: 'rapier', label: 'Rapier（未実装）', available: false },
];

/**
 * Creates an engine. The WebAssembly module is loaded on first use with a
 * dynamic import, so only the selected engine is downloaded.
 */
export async function createPhysicsEngine(kind: PhysicsEngineKind): Promise<PhysicsEngine> {
  switch (kind) {
    case 'ammo': {
      const { AmmoPhysics } = await import('./ammo/AmmoPhysics');
      return AmmoPhysics.create();
    }
    case 'rapier':
      throw new Error('Rapier はまだ実装されていません');
  }
}
