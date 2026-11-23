import AmmoInit from 'ammojs-typed/wasm';
import wasmUrl from 'ammojs-typed/ammo.wasm.wasm?url';

export type AmmoModule = typeof AmmoInit;

let loading: Promise<AmmoModule> | null = null;

/** Loads the Ammo.js (Bullet) WebAssembly build once and caches it. */
export function loadAmmo(): Promise<AmmoModule> {
  if (!loading) {
    // The Emscripten wrapper assigns to `this.Ammo`, which is undefined in an
    // ES module, so give it an object to write to.
    const init = AmmoInit.call({}, { locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file) });
    loading = (init as Promise<AmmoModule>).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}
