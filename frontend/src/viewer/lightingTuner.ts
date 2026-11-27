import { presetLighting, type DisplayPreset, type PresetLighting } from './displayPresets';

/**
 * Temporary tuning aid: hand-adjusted overrides of each display preset's
 * lighting (presetLighting), kept until the values are copied back into
 * displayPresets.ts. Remove this file, LightingTunerSection.tsx and their
 * two call sites (MmdViewer, Sidebar) once tuning is done.
 */
export type TunableLighting = Omit<PresetLighting, 'lightFrom'>;
type Overrides = Partial<Record<DisplayPreset, Partial<TunableLighting>>>;

const STORAGE_KEY = 'mmd-kimodo.lightingTuner';
const COMPARE_KEY = 'mmd-kimodo.lightingTuner.compare';

function loadCompare(): boolean {
  try {
    return localStorage.getItem(COMPARE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function load(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
}

let overrides: Overrides = load();
/** Split the view: left as the preset defines it, right with the tuned values. */
let compare = loadCompare();
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (private window etc.): keep the values for this session only.
  }
}

export const lightingTunerStore = {
  get: (): Overrides => overrides,
  set(preset: DisplayPreset, patch: Partial<TunableLighting>): void {
    overrides = { ...overrides, [preset]: { ...overrides[preset], ...patch } };
    save();
    listeners.forEach((l) => l());
  },
  reset(preset: DisplayPreset): void {
    const { [preset]: _, ...rest } = overrides;
    overrides = rest;
    save();
    listeners.forEach((l) => l());
  },
  getCompare: (): boolean => compare,
  setCompare(on: boolean): void {
    compare = on;
    try {
      localStorage.setItem(COMPARE_KEY, String(on));
    } catch {
      // Storage unavailable: this session only.
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The preset's lighting with any hand-tuned values applied. */
export function tunedPresetLighting(preset: DisplayPreset): PresetLighting {
  return { ...presetLighting(preset), ...overrides[preset] };
}

const TONE_MAPPING_NAMES: Record<number, string> = {
  0: 'THREE.NoToneMapping',
  1: 'THREE.LinearToneMapping',
  2: 'THREE.ReinhardToneMapping',
  3: 'THREE.CineonToneMapping',
  4: 'THREE.ACESFilmicToneMapping',
  6: 'THREE.AgXToneMapping',
  7: 'THREE.NeutralToneMapping',
};

const hex = (v: number) => `0x${v.toString(16).padStart(6, '0')}`;
const num = (v: number) => String(Math.round(v * 100) / 100);

/** The values as the object literal presetLighting returns, ready to paste into displayPresets.ts. */
export function lightingSnippet(preset: DisplayPreset): string {
  const l = tunedPresetLighting(preset);
  return (
    `case '${preset}': return { hemisphere: ${num(l.hemisphere)}, skyColor: ${hex(l.skyColor)}, groundColor: ${hex(l.groundColor)}, ` +
    `directional: ${num(l.directional)}, environment: ${num(l.environment)}, toneMapping: ${TONE_MAPPING_NAMES[l.toneMapping] ?? l.toneMapping}, ` +
    `exposure: ${num(l.exposure)} }`
  );
}
