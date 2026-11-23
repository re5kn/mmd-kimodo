import type { PhysicsEngineKind } from '../physics';

export type PhysicsState = 'off' | 'loading' | 'ready' | 'error';

export interface PhysicsStatus {
  state: PhysicsState;
  engine: PhysicsEngineKind | null;
  /** Rigid bodies / joints of the current model (0 when no model is loaded). */
  bodyCount: number;
  jointCount: number;
  message?: string;
}

/**
 * Small bridge between the viewer and the sidebar's physics section (the app
 * has a single viewer): the viewer publishes its status, read with
 * useSyncExternalStore, and listens for reset requests.
 */
let status: PhysicsStatus = { state: 'off', engine: null, bodyCount: 0, jointCount: 0 };
const listeners = new Set<() => void>();
const resetListeners = new Set<() => void>();

export const physicsStatusStore = {
  get: (): PhysicsStatus => status,
  set(next: PhysicsStatus): void {
    status = next;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Asks the viewer to restart the simulation from the current pose. */
  requestReset(): void {
    resetListeners.forEach((l) => l());
  },
  onResetRequest(listener: () => void): () => void {
    resetListeners.add(listener);
    return () => resetListeners.delete(listener);
  },
};
