import { DEFAULT_SWAY_PARAMS, type SwayBlend, type SwayChainSettings } from '../physics/sway';

/**
 * Sway chains of the current model (Issue #31), shared by the sidebar and the
 * viewer. Saved per model (by model name) in localStorage, with bones stored
 * by name.
 */
const STORAGE_PREFIX = 'mmd-kimodo.sway.';

let modelKey: string | null = null;
let chains: readonly SwayChainSettings[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Checks one saved chain; returns null when it is unusable. */
export function parseSwayChain(raw: unknown): SwayChainSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.startBone !== 'string' || typeof c.endBone !== 'string') return null;
  const blend: SwayBlend = c.blend === 'replace' ? 'replace' : 'with';
  const d = DEFAULT_SWAY_PARAMS;
  return {
    id: typeof c.id === 'string' && c.id ? c.id : newSwayId(),
    enabled: c.enabled !== false,
    startBone: c.startBone,
    endBone: c.endBone,
    blend,
    stiffness: num(c.stiffness, 0, 1, d.stiffness),
    gravity: num(c.gravity, 0, 2, d.gravity),
    drag: num(c.drag, 0, 1, d.drag),
    radius: num(c.radius, 0, 5, d.radius),
    collide: typeof c.collide === 'boolean' ? c.collide : d.collide,
    linkGroup: typeof c.linkGroup === 'string' ? c.linkGroup.trim().slice(0, 40) : d.linkGroup,
    linkStiffness: num(c.linkStiffness, 0, 1, d.linkStiffness),
    linkLoop: typeof c.linkLoop === 'boolean' ? c.linkLoop : d.linkLoop,
  };
}

function readSaved(key: string): SwayChainSettings[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(parseSwayChain).filter((c): c is SwayChainSettings => c !== null) : [];
  } catch {
    return [];
  }
}

function writeSaved(key: string, list: readonly SwayChainSettings[]): void {
  try {
    if (list.length === 0) globalThis.localStorage?.removeItem(STORAGE_PREFIX + key);
    else globalThis.localStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode); the chains then last for this session.
  }
}

let idCounter = 0;
export function newSwayId(): string {
  idCounter++;
  return `sway-${Date.now().toString(36)}-${idCounter}`;
}

export const swaySettingsStore = {
  get: (): readonly SwayChainSettings[] => chains,
  /** Switches to a model's saved chains (null: no model, none, not saved). */
  load(key: string | null): void {
    modelKey = key;
    chains = key === null ? [] : readSaved(key);
    emit();
  },
  add(chain: Omit<SwayChainSettings, 'id'>): string {
    const id = newSwayId();
    swaySettingsStore.set([...chains, { ...chain, id }]);
    return id;
  },
  update(id: string, patch: Partial<Omit<SwayChainSettings, 'id'>>): void {
    swaySettingsStore.set(chains.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  },
  remove(id: string): void {
    swaySettingsStore.set(chains.filter((c) => c.id !== id));
  },
  set(next: readonly SwayChainSettings[]): void {
    chains = next;
    if (modelKey !== null) writeSaved(modelKey, chains);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
