import * as THREE from 'three';
import type { SurfaceKind } from './surfaceKind';

/**
 * Skin light (Issue #29): skin materials are lit as if the lighting panel's
 * color were another one (e.g. 204 gray instead of MMD's 154), while the
 * rest of the model keeps the panel's light.
 *
 * It is applied in the materials rather than as a screen pass, so a skin
 * material looks exactly as it does with that color set on the panel:
 * - MMD-style shading uses the skin color in place of the panel color;
 * - lit three.js presets scale their directional lights by the ratio of the
 *   two colors (hemisphere and environment light stay as they are, as with
 *   the panel's color).
 *
 * Settings are saved per model (by model name), since only some models need it.
 */
export interface SkinLightSettings {
  enabled: boolean;
  /** Light color for skin, '#rrggbb' in MMD's 0-255 scale (MMD default 154 = '#9a9a9a'). */
  color: string;
  /** Hand-set "treat as skin" per material index; others follow the automatic classification. */
  overrides: ReadonlyMap<number, boolean>;
}

export const DEFAULT_SKIN_LIGHT_COLOR = '#cccccc';

export const DEFAULT_SKIN_LIGHT: SkinLightSettings = { enabled: false, color: DEFAULT_SKIN_LIGHT_COLOR, overrides: new Map() };

const STORAGE_PREFIX = 'mmd-kimodo.skinLight.';

interface Saved {
  enabled: boolean;
  color: string;
  overrides: [number, boolean][];
}

function readSaved(key: string): SkinLightSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + key);
    if (!raw) return DEFAULT_SKIN_LIGHT;
    const s = JSON.parse(raw) as Partial<Saved>;
    const color = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : DEFAULT_SKIN_LIGHT_COLOR;
    const overrides = new Map<number, boolean>();
    for (const e of Array.isArray(s.overrides) ? s.overrides : []) {
      if (Array.isArray(e) && Number.isInteger(e[0]) && typeof e[1] === 'boolean') overrides.set(e[0], e[1]);
    }
    return { enabled: s.enabled === true, color, overrides };
  } catch {
    return DEFAULT_SKIN_LIGHT;
  }
}

function writeSaved(key: string, s: SkinLightSettings): void {
  try {
    const saved: Saved = { enabled: s.enabled, color: s.color, overrides: [...s.overrides] };
    globalThis.localStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(saved));
  } catch {
    // Storage may be unavailable (private mode); the setting then lasts for this session.
  }
}

let modelKey: string | null = null;
let settings: SkinLightSettings = DEFAULT_SKIN_LIGHT;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const skinLightStore = {
  get: (): SkinLightSettings => settings,
  /** Switches to a model's saved settings (null: no model, defaults, not saved). */
  load(key: string | null): void {
    modelKey = key;
    settings = key === null ? DEFAULT_SKIN_LIGHT : readSaved(key);
    emit();
  },
  update(patch: Partial<Omit<SkinLightSettings, 'overrides'>>): void {
    skinLightStore.set({ ...settings, ...patch });
  },
  /** Sets whether a material counts as skin; null goes back to the automatic choice. */
  setOverride(index: number, skin: boolean | null): void {
    const overrides = new Map(settings.overrides);
    if (skin === null) overrides.delete(index);
    else overrides.set(index, skin);
    skinLightStore.set({ ...settings, overrides });
  },
  set(next: SkinLightSettings): void {
    settings = next;
    if (modelKey !== null) writeSaved(modelKey, settings);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Whether material `index` counts as skin: the hand-set choice, else the automatic classification. */
export function isSkinMaterial(index: number, kind: SurfaceKind | undefined, s: SkinLightSettings): boolean {
  return s.overrides.get(index) ?? kind === 'skin';
}

/** Uniforms shared by every material of a viewer; the per-material switch is separate (skinLightOn). */
export interface SkinLightUniforms {
  /** MMD-style light color for skin, sRGB 0-1. */
  skinLightColor: { value: THREE.Vector3 };
  /** Linear color ratio skin / panel, multiplied into three.js directional lights on skin. */
  skinLightRatio: { value: THREE.Vector3 };
}

export function createSkinLightUniforms(): SkinLightUniforms {
  return { skinLightColor: { value: new THREE.Vector3(154 / 255, 154 / 255, 154 / 255) }, skinLightRatio: { value: new THREE.Vector3(1, 1, 1) } };
}

/** Linear value three.js uses for an sRGB light color channel (values above 1 allowed). */
const toLinear = (c: number) => new THREE.Color().setRGB(c, 0, 0, THREE.SRGBColorSpace).r;

/**
 * Sets the shared uniforms for a skin color and the panel's MMD-style color
 * (both sRGB 0-1). The three.js presets light with color / (154 / 255) in
 * sRGB, so the ratio is taken after the same conversion to linear.
 */
export function updateSkinLightUniforms(u: SkinLightUniforms, skin: THREE.Color, panel: THREE.Color): void {
  u.skinLightColor.value.set(skin.r, skin.g, skin.b);
  const gray = 154 / 255;
  const ratio = (s: number, p: number) => {
    const lp = toLinear(p / gray);
    // A black panel light stays black on skin too (nothing to scale).
    return lp > 0 ? toLinear(s / gray) / lp : 0;
  };
  u.skinLightRatio.value.set(ratio(skin.r, panel.r), ratio(skin.g, panel.g), ratio(skin.b, panel.b));
}

/** Per-material switch: 1 = lit with the skin light. */
export type SkinLightSwitch = { value: number };

export function skinLightSwitch(mat: THREE.Material): SkinLightSwitch | undefined {
  return mat.userData.skinLightOn as SkinLightSwitch | undefined;
}

/** Line of three.js' light loop after which each directional light's color is known. */
export const SKIN_LIGHT_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';

/**
 * Lets a lit three.js material (standard / physical / toon / ...) scale its
 * directional lights by the skin ratio when its switch is on. Composes with
 * an existing onBeforeCompile.
 */
export function useSkinLight(mat: THREE.Material, shared: SkinLightUniforms): SkinLightSwitch {
  const on: SkinLightSwitch = { value: 0 };
  mat.userData.skinLightOn = on;
  const previous = mat.onBeforeCompile.bind(mat);
  const previousKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    if (!chunk.includes(SKIN_LIGHT_ANCHOR) || !shader.fragmentShader.includes('#include <lights_fragment_begin>')) {
      console.warn('skin light: three.js lighting chunk changed; skin uses the panel light');
      return;
    }
    shader.uniforms.skinLightRatio = shared.skinLightRatio;
    shader.uniforms.skinLightOn = on;
    shader.fragmentShader =
      'uniform vec3 skinLightRatio;\nuniform float skinLightOn;\n' +
      shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        chunk.replace(SKIN_LIGHT_ANCHOR, `${SKIN_LIGHT_ANCHOR}\n\t\tdirectLight.color *= mix( vec3( 1.0 ), skinLightRatio, skinLightOn );`),
      );
  };
  mat.customProgramCacheKey = () => `${previousKey()}-skin-light`;
  return on;
}
