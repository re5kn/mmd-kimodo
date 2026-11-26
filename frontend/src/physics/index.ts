import type { PhysicsEngine, PhysicsEngineInfo, PhysicsEngineKind, PhysicsQuality } from './types';

export type { PhysicsEngine, PhysicsEngineInfo, PhysicsEngineKind, PhysicsModel, PhysicsQuality } from './types';

/** Accuracy choices shown in the settings. */
export const PHYSICS_QUALITIES: readonly { quality: PhysicsQuality; label: string }[] = [
  { quality: 'standard', label: '標準' },
  { quality: 'high', label: '高（重い）' },
];

/** Engines shown in the settings. */
export const PHYSICS_ENGINES: readonly PhysicsEngineInfo[] = [
  { kind: 'ammo', label: 'Ammo.js (Bullet)', available: true },
  { kind: 'rapier', label: 'Rapier', available: true },
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
    case 'rapier': {
      const { RapierPhysics } = await import('./rapier/RapierPhysics');
      return RapierPhysics.create();
    }
  }
}
