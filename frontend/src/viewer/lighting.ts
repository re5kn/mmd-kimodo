import * as THREE from 'three';

/**
 * Lighting panel settings (Issue #11 C1): where the main light comes from,
 * its color, and optional fill and rim lights.
 *
 * The color follows MMD's light panel: 0-255 per channel with gray 154 as
 * the default. MMD-style shading uses it as is; the other presets treat 154
 * gray as their own light at full strength, so brighter or tinted colors
 * scale and tint every preset alike.
 */
export type LightingPresetKind = 'auto' | 'mmd' | 'threePoint';

export interface LightingSettings {
  /** The preset the values came from; null once a value is edited by hand. */
  preset: LightingPresetKind | null;
  /** Where the light comes from, around the model: 0 = front, 90 = model's left (screen right), degrees. */
  azimuth: number;
  /** Height of the light above the horizon, degrees (90 = straight down). */
  elevation: number;
  /** MMD-style light color, '#rrggbb'. */
  color: string;
  /** Adds a fill light opposite the key and a rim light from behind. */
  threePoint: boolean;
}

/** MMD's default light color: 154 gray. */
export const MMD_LIGHT_GRAY = 154 / 255;
export const MMD_DEFAULT_LIGHT_COLOR = '#9a9a9a';

/** Fill and rim lights, relative to the key light's strength. */
export const FILL_LIGHT = { azimuthOffset: -110, elevation: 15, strength: 0.35 };
export const RIM_LIGHT = { azimuth: 180, elevation: 40, strength: 0.6 };

/** Azimuth / elevation (degrees) of a "light comes from" vector in three.js coordinates. */
export function anglesFromDirection(from: THREE.Vector3Like): { azimuth: number; elevation: number } {
  const v = new THREE.Vector3(from.x, from.y, from.z).normalize();
  return {
    azimuth: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)),
    elevation: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y, -1, 1))),
  };
}

/** Unit "light comes from" vector for azimuth / elevation in degrees. */
export function directionFromAngles(azimuth: number, elevation: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuth);
  const e = THREE.MathUtils.degToRad(elevation);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** MMD's default light: travels along (-0.5, -1, 0.5) in MMD coordinates, (-0.5, -1, -0.5) in three.js. */
export const MMD_LIGHT_FROM = new THREE.Vector3(0.5, 1, 0.5);

const round = (v: number) => Math.round(v * 10) / 10;

export const LIGHTING_PRESETS: { kind: LightingPresetKind; label: string; description: string }[] = [
  { kind: 'auto', label: '自動', description: '表示プリセットごとの既定の照明' },
  { kind: 'mmd', label: 'MMD 初期値', description: 'MMD の初期設定（向き (−0.5, −1, 0.5)、色 154）' },
  { kind: 'threePoint', label: '3 点照明', description: '斜め前の主光源に、反対側の補助光と後ろからの輪郭光を足す' },
];

/**
 * Settings for a lighting preset. `autoFrom` is the display preset's own
 * light direction, used by 'auto'.
 */
export function lightingPreset(kind: LightingPresetKind, autoFrom: THREE.Vector3Like): LightingSettings {
  switch (kind) {
    case 'mmd': {
      const { azimuth, elevation } = anglesFromDirection(MMD_LIGHT_FROM);
      return { preset: kind, azimuth: round(azimuth), elevation: round(elevation), color: MMD_DEFAULT_LIGHT_COLOR, threePoint: false };
    }
    case 'threePoint':
      return { preset: kind, azimuth: 40, elevation: 35, color: MMD_DEFAULT_LIGHT_COLOR, threePoint: true };
    case 'auto': {
      const { azimuth, elevation } = anglesFromDirection(autoFrom);
      return { preset: kind, azimuth: round(azimuth), elevation: round(elevation), color: MMD_DEFAULT_LIGHT_COLOR, threePoint: false };
    }
  }
}

export const DEFAULT_LIGHTING: LightingSettings = { preset: 'auto', azimuth: 0, elevation: 0, color: MMD_DEFAULT_LIGHT_COLOR, threePoint: false };

export interface ResolvedLight {
  /** Unit vector toward the light. */
  from: THREE.Vector3;
  /**
   * Color factor relative to MMD's default (154 gray = 1, 1, 1), in sRGB
   * values; multiply a preset's white light by it.
   */
  scale: THREE.Color;
  /** MMD-style light color, sRGB 0-1 (154 gray = 0.6). */
  mmdColor: THREE.Color;
}

export interface ResolvedLighting {
  key: ResolvedLight;
  /** Fill and rim lights (empty unless three-point). */
  extras: { from: THREE.Vector3; strength: number }[];
}

/** Turns panel settings into light directions and colors. 'auto' follows the display preset. */
export function resolveLighting(settings: LightingSettings, autoFrom: THREE.Vector3Like): ResolvedLighting {
  const s = settings.preset === 'auto' ? lightingPreset('auto', autoFrom) : settings;
  const mmdColor = new THREE.Color().setStyle(s.color, THREE.NoColorSpace);
  const scale = mmdColor.clone().multiplyScalar(1 / MMD_LIGHT_GRAY);
  const extras = s.threePoint
    ? [
        { from: directionFromAngles(s.azimuth + FILL_LIGHT.azimuthOffset, FILL_LIGHT.elevation), strength: FILL_LIGHT.strength },
        { from: directionFromAngles(RIM_LIGHT.azimuth + s.azimuth, RIM_LIGHT.elevation), strength: RIM_LIGHT.strength },
      ]
    : [];
  return { key: { from: directionFromAngles(s.azimuth, s.elevation), scale, mmdColor }, extras };
}
