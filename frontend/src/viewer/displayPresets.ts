import * as THREE from 'three';
import { CLOTH_TILE, HAIR_TILE } from './detailMaps';
import type { SurfaceKind } from './surfaceKind';

/**
 * Display presets (Issue #11 B1): the same model drawn with different
 * material sets, switched with one click.
 */
export type DisplayPreset = 'mmd' | 'flat' | 'pbr' | 'clay' | 'real';

export const DISPLAY_PRESETS: { kind: DisplayPreset; label: string; description: string }[] = [
  { kind: 'mmd', label: 'MMD 風', description: 'トゥーン陰影（PMX の材質色・テクスチャ・トゥーン。共有トゥーンは自作の代替）' },
  { kind: 'flat', label: 'フラット', description: '光なし。テクスチャ（なければ材質色）をそのまま表示' },
  { kind: 'pbr', label: 'PBR 風', description: '物理ベースの陰影と環境光（反射の強さから粗さを推定）' },
  { kind: 'clay', label: '粘土', description: 'グレー一色。形と陰影だけを確認' },
  {
    kind: 'real',
    label: 'リアル調',
    description: '材質名から髪・服・肌を見分け、布目や毛筋の細かい凹凸と光沢を加える（ray-mmd などのエフェクト風）',
  },
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
  /**
   * MMD toon ramp (lit at the top, shadow at the bottom; the model's own
   * image or a shared-toon stand-in). Null: the preset's generic ramp.
   */
  toon?: THREE.Texture | null;
  /** OutlineEffect parameters (shared by every preset). */
  outline: { thickness: number; color: number[]; alpha: number; visible: boolean };
  /** What the material represents (only used by surface-aware presets). Default: cloth. */
  kind?: SurfaceKind;
  /** Model units per UV unit, for tiling detail maps at a fixed size (0: unknown). */
  uvDensity?: number;
}

export interface PresetShared {
  /** Ramp used by the MMD toon shading when a material has no toon of its own. */
  gradientMap: THREE.Texture;
  /** Tileable detail normal maps for the 'real' preset. */
  detailMaps?: { cloth: THREE.Texture; hair: THREE.Texture };
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

export const TOON_RAMP_CHUNK = '#include <gradientmap_pars_fragment>';

/**
 * Reads the gradient map the way MMD reads toon textures: vertically
 * (top = lit, v = 0.5 - 0.5 * N·L) and in full color, so tinted toons such
 * as pink skin shadows keep their hue. three.js reads only the red channel
 * along U.
 */
function useMmdToonRamp(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(TOON_RAMP_CHUNK)) {
      console.warn('mmd toon: three.js toon shader changed; using its own ramp lookup');
      return;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      TOON_RAMP_CHUNK,
      `uniform sampler2D gradientMap;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float dotNL = dot( normal, lightDirection );
  return texture2D( gradientMap, vec2( 0.0, 0.5 - 0.5 * dotNL ) ).rgb;
}`,
    );
  };
  mat.customProgramCacheKey = () => 'mmd-toon-ramp';
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
        gradientMap: src.toon ?? shared.gradientMap,
        emissive: srgb(src.ambient[0] * 0.3, src.ambient[1] * 0.3, src.ambient[2] * 0.3),
      });
      if (src.toon) useMmdToonRamp(mat);
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
    case 'real':
      mat = createRealMaterial(src, shared);
      break;
  }
  // Effect stacks usually draw thinner lines than plain MMD.
  const outlineScale = preset === 'real' ? 0.5 : 1;
  mat.userData.outlineParameters = { ...src.outline, thickness: src.outline.thickness * outlineScale };
  return mat;
}

/** Skin tuning for the 'real' preset (see useSkinScatter). */
export const SKIN = {
  /** How far light wraps past the terminator (0: plain Lambert). */
  wrap: 0.6,
  /** Color of the light that scatters into the wrapped band. */
  scatter: [0.6, 0.22, 0.35] as [number, number, number],
  /** Emissive tint multiplied by the texture. */
  glow: [0.14, 0.06, 0.08] as [number, number, number],
  /**
   * Multiplied into the base color: offsets the cool sky and ACES, which
   * otherwise wash pale skin out to gray-white.
   */
  tint: [1, 0.86, 0.9] as [number, number, number],
};

export const SKIN_SCATTER_LINE = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );';

/**
 * Cheap subsurface scattering: light wraps past the terminator
 * (wrap = (N·L + w) / (1 + w)) and the extra band is tinted red, so the
 * light-to-shadow edge of skin turns warm instead of gray.
 */
function useSkinScatter(mat: THREE.Material): void {
  const scatter = new THREE.Color(...SKIN.scatter);
  mat.onBeforeCompile = (shader) => {
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (!chunk.includes(SKIN_SCATTER_LINE)) {
      console.warn('skin scatter: three.js lighting chunk changed; using plain diffuse');
      return;
    }
    shader.uniforms.skinScatter = { value: scatter };
    shader.uniforms.skinWrap = { value: SKIN.wrap };
    const patched = chunk.replace(
      SKIN_SCATTER_LINE,
      `{
    float skinNL = dot( geometryNormal, directLight.direction );
    float skinWrapNL = saturate( ( skinNL + skinWrap ) / ( 1.0 + skinWrap ) );
    vec3 skinBand = skinScatter * max( skinWrapNL - saturate( skinNL ), 0.0 ) * directLight.color;
    reflectedLight.directDiffuse += ( irradiance + skinBand ) * diffuseBRDF * ( 1.0 - F );
  }`,
    );
    shader.fragmentShader =
      'uniform vec3 skinScatter;\nuniform float skinWrap;\n' +
      shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', patched);
  };
  mat.customProgramCacheKey = () => 'skin-scatter';
}

/**
 * Tiles a shared detail map over one material: `across` × `along` model
 * units per tile, converted to UV repeats with the material's UV density.
 */
function tiledDetail(base: THREE.Texture, uvDensity: number, across: number, along: number): THREE.Texture | null {
  if (!(uvDensity > 0)) return null;
  const tex = base.clone();
  tex.repeat.set(uvDensity / across, uvDensity / along);
  tex.needsUpdate = true;
  return tex;
}

/**
 * 'real' preset: physically based surfaces chosen per material kind, in the
 * spirit of MMD effect stacks such as ray-mmd (fabric sheen and weave,
 * anisotropic hair highlights, soft skin).
 */
function createRealMaterial(src: PresetMaterialSource, shared: PresetShared): THREE.Material {
  const [r, g, b] = src.diffuse;
  const kind = src.kind ?? 'cloth';
  const color = srgb(r, g, b);
  if (kind === 'decal') {
    // Eyes and painted overlays stay exactly as drawn.
    return new THREE.MeshBasicMaterial({ ...common(src), color, map: src.map, toneMapped: false });
  }
  const mat = new THREE.MeshPhysicalMaterial({ ...common(src), color, map: src.map, metalness: 0 });
  let detail: THREE.Texture | null = null;
  switch (kind) {
    case 'cloth':
      mat.roughness = 0.9;
      mat.specularIntensity = 0.25;
      mat.sheen = 1;
      mat.sheenRoughness = 0.5;
      mat.sheenColor.setRGB(0.35, 0.35, 0.35);
      if (shared.detailMaps) detail = tiledDetail(shared.detailMaps.cloth, src.uvDensity ?? 0, CLOTH_TILE, CLOTH_TILE);
      mat.normalScale.set(0.6, 0.6);
      break;
    case 'hair':
      mat.roughness = 0.45;
      mat.specularIntensity = 0.5;
      mat.specularColor.setRGB(1, 0.92, 0.95);
      // Highlights stretch across the strands (U), like a band around the head.
      mat.anisotropy = 0.6;
      mat.anisotropyRotation = 0;
      // Soft lilac-white sheen lifts dark hair the way effect stacks do.
      mat.sheen = 0.6;
      mat.sheenRoughness = 0.55;
      mat.sheenColor.setRGB(0.85, 0.8, 0.95);
      if (shared.detailMaps) detail = tiledDetail(shared.detailMaps.hair, src.uvDensity ?? 0, HAIR_TILE.across, HAIR_TILE.along);
      mat.normalScale.set(0.15, 0.15);
      break;
    case 'skin':
      mat.roughness = 0.6;
      mat.specularIntensity = 0.2;
      // Self-lit warmth keeps shadowed skin from going gray.
      mat.emissiveMap = src.map;
      mat.emissive.setRGB(SKIN.glow[0], SKIN.glow[1], SKIN.glow[2]);
      mat.color.multiply(new THREE.Color(SKIN.tint[0], SKIN.tint[1], SKIN.tint[2]));
      useSkinScatter(mat);
      break;
    case 'metal':
      mat.metalness = 0.85;
      mat.roughness = 0.3;
      break;
  }
  if (detail) {
    mat.normalMap = detail;
    mat.addEventListener('dispose', () => detail.dispose());
  }
  return mat;
}

/** Scene lighting for a preset (flat ignores lights entirely). */
export interface PresetLighting {
  hemisphere: number;
  skyColor: number;
  groundColor: number;
  directional: number;
  /** Image-based lighting from a neutral room environment (0: none). */
  environment: number;
  toneMapping: THREE.ToneMapping;
  exposure: number;
}

export function presetLighting(preset: DisplayPreset): PresetLighting {
  switch (preset) {
    case 'pbr':
    case 'clay':
      return { hemisphere: 0.4, skyColor: 0xffffff, groundColor: 0x8899aa, directional: 2.2, environment: 0.6, toneMapping: THREE.NeutralToneMapping, exposure: 1 };
    case 'real':
      // Strong key light, cool sky fill and filmic tone mapping.
      return { hemisphere: 0.45, skyColor: 0xdde4ff, groundColor: 0x6e6964, directional: 2.6, environment: 0.35, toneMapping: THREE.ACESFilmicToneMapping, exposure: 1 };
    default:
      return { hemisphere: 1.6, skyColor: 0xffffff, groundColor: 0x8899aa, directional: 1.8, environment: 0, toneMapping: THREE.NoToneMapping, exposure: 1 };
  }
}
