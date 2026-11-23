import * as THREE from 'three';

/**
 * Display presets (Issue #11 B1): the same model drawn with different
 * material sets, switched with one click.
 */
export type DisplayPreset = 'mmd' | 'flat' | 'pbr' | 'clay';

export const DISPLAY_PRESETS: { kind: DisplayPreset; label: string; description: string }[] = [
  { kind: 'mmd', label: 'MMD 風', description: 'トゥーン陰影（PMX の材質色・テクスチャ）' },
  { kind: 'flat', label: 'フラット', description: '光なし。テクスチャ（なければ材質色）をそのまま表示' },
  { kind: 'pbr', label: 'PBR 風', description: '物理ベースの陰影と環境光（反射の強さから粗さを推定）' },
  { kind: 'clay', label: '粘土', description: 'グレー一色。形と陰影だけを確認' },
];

/** What a preset needs to know about one PMX material. */
export interface PresetMaterialSource {
  name: string;
  /** Linear RGBA, as stored in PMX. */
  diffuse: [number, number, number, number];
  ambient: [number, number, number];
  /** Blinn-Phong exponent ("反射強度"). */
  specularity: number;
  doubleSided: boolean;
  map: THREE.Texture | null;
  /** OutlineEffect parameters (shared by every preset). */
  outline: { thickness: number; color: number[]; alpha: number; visible: boolean };
}

export interface PresetShared {
  /** Ramp used by the MMD toon shading. */
  gradientMap: THREE.Texture;
}

export const CLAY_COLOR = 0xb8b8b8;

/**
 * Approximates a Blinn-Phong exponent with a GGX roughness
 * (n = 2 / α² - 2, α = roughness²).
 */
export function specularityToRoughness(specularity: number): number {
  const n = Math.max(specularity, 0);
  const alpha = Math.sqrt(2 / (n + 2));
  return THREE.MathUtils.clamp(Math.sqrt(alpha), 0.2, 1);
}

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

/** Settings every preset shares: MMD draws all materials in order with alpha blending. */
function common(src: PresetMaterialSource) {
  return {
    name: src.name,
    opacity: src.diffuse[3],
    transparent: true,
    alphaTest: 0.001,
    depthWrite: true,
    side: src.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  };
}

/**
 * Makes `map` contribute only its alpha (cut-outs such as eyelashes and
 * hair cards keep their shape), so the material keeps a single color.
 */
function useMapAlphaOnly(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#ifdef USE_MAP\n  diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif',
    );
  };
  mat.customProgramCacheKey = () => 'map-alpha-only';
}

export function createPresetMaterial(preset: DisplayPreset, src: PresetMaterialSource, shared: PresetShared): THREE.Material {
  const [r, g, b] = src.diffuse;
  let mat: THREE.Material;
  switch (preset) {
    case 'mmd':
      mat = new THREE.MeshToonMaterial({
        ...common(src),
        color: srgb(r, g, b),
        map: src.map,
        gradientMap: shared.gradientMap,
        emissive: srgb(src.ambient[0] * 0.3, src.ambient[1] * 0.3, src.ambient[2] * 0.3),
      });
      break;
    case 'flat':
      mat = new THREE.MeshBasicMaterial({
        ...common(src),
        // Texture only; untextured materials fall back to their diffuse color.
        color: src.map ? 0xffffff : srgb(r, g, b),
        map: src.map,
      });
      break;
    case 'pbr':
      mat = new THREE.MeshStandardMaterial({
        ...common(src),
        color: srgb(r, g, b),
        map: src.map,
        roughness: specularityToRoughness(src.specularity),
        metalness: 0,
      });
      break;
    case 'clay':
      mat = new THREE.MeshStandardMaterial({
        ...common(src),
        color: CLAY_COLOR,
        map: src.map,
        roughness: 0.85,
        metalness: 0,
      });
      useMapAlphaOnly(mat);
      break;
  }
  mat.userData.outlineParameters = { ...src.outline };
  return mat;
}

/** Scene lighting for a preset (flat ignores lights entirely). */
export interface PresetLighting {
  hemisphere: number;
  directional: number;
  /** Image-based lighting from a neutral room environment. */
  environment: boolean;
  toneMapping: THREE.ToneMapping;
}

export function presetLighting(preset: DisplayPreset): PresetLighting {
  switch (preset) {
    case 'pbr':
    case 'clay':
      return { hemisphere: 0.4, directional: 2.2, environment: true, toneMapping: THREE.NeutralToneMapping };
    default:
      return { hemisphere: 1.6, directional: 1.8, environment: false, toneMapping: THREE.NoToneMapping };
  }
}
