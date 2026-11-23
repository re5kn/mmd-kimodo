import RAPIER from '@dimforge/rapier3d-compat';

export type RapierModule = typeof RAPIER;

let loading: Promise<RapierModule> | null = null;

/** Initializes Rapier's WebAssembly module (inlined in the -compat build) once. */
export function loadRapier(): Promise<RapierModule> {
  loading ??= RAPIER.init().then(
    () => RAPIER,
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}
