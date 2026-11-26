import * as THREE from 'three';
import { CLOTH_TILE, HAIR_TILE } from './detailMaps';
import type { SurfaceKind } from './surfaceKind';
import { MMD_LIGHT_DIRECTION, createMmdMaterial, type MmdLightUniform } from './mmdShading';

/**
 * Display presets (Issue #11 B1): the same model drawn with different
 * material sets, switched with one click.
 */
export type DisplayPreset = 'mmd' | 'flat' | 'pbr' | 'clay' | 'real' | 'figure';

export const DISPLAY_PRESETS: { kind: DisplayPreset; label: string; description: string }[] = [
  { kind: 'mmd', label: 'MMD 風', description: 'MMD 本体と同じ式（材質色・トゥーン・スフィア・反射）。共有トゥーンは自作の代替' },
  { kind: 'flat', label: 'フラット', description: '光なし。テクスチャ（なければ材質色）をそのまま表示' },
  { kind: 'pbr', label: 'PBR 風', description: '物理ベースの陰影と環境光（反射の強さから粗さを推定）' },
  { kind: 'clay', label: '粘土', description: 'グレー一色。形と陰影だけを確認' },
  {
    kind: 'real',
    label: 'リアル調',
    description: '材質名から髪・服・肌を見分け、布目や毛筋の細かい凹凸と光沢を加える（ray-mmd などのエフェクト風）',
  },
  {
    kind: 'figure',
    label: 'フィギュア',
    description: 'PVC フィギュアのような、つやのある塗装の質感（髪は光沢、肌はなめらか、輪郭線なし）',
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
  /** Specular color (sRGB, PMX). Default: black. */
  specular?: [number, number, number];
  /**
   * MMD toon texture (lit at the top, shadow at the bottom; the model's own
   * image or a shared-toon stand-in). Null: none (MMD's white toon0).
   */
  toon?: THREE.Texture | null;
  /** Sphere map and PMX sphere mode (see SphereMode). */
  sphere?: { map: THREE.Texture; mode: number } | null;
  /** OutlineEffect parameters (shared by every preset). */
  outline: { thickness: number; color: number[]; alpha: number; visible: boolean };
  /** What the material represents (only used by surface-aware presets). Default: cloth. */
  kind?: SurfaceKind;
  /** Model units per UV unit, for tiling detail maps at a fixed size (0: unknown). */
  uvDensity?: number;
}

export interface PresetShared {
  /** Light color of the MMD-style shading, shared so the lighting panel can change it live. */
  mmdLightColor?: MmdLightUniform;
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

export function createPresetMaterial(preset: DisplayPreset, src: PresetMaterialSource, shared: PresetShared): THREE.Material {
  const [r, g, b] = src.diffuse;
  let mat: THREE.Material;
  switch (preset) {
    case 'mmd':
      mat = createMmdMaterial(
        {
          diffuse: src.diffuse,
          ambient: src.ambient,
          specular: src.specular ?? [0, 0, 0],
          specularity: src.specularity,
          map: src.map,
          toon: src.toon ?? null,
          sphere: src.sphere ?? null,
        },
        common(src),
        shared.mmdLightColor,
      );
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
    case 'figure':
      mat = createFigureMaterial(src);
      break;
  }
  // Effect stacks usually draw thinner lines than plain MMD; figures have none.
  const outlineScale = preset === 'real' ? 0.5 : 1;
  mat.userData.outlineParameters = {
    ...src.outline,
    thickness: src.outline.thickness * outlineScale,
    visible: src.outline.visible && preset !== 'figure',
  };
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

/**
 * 'figure' preset finish per material kind: painted PVC under a clear coat.
 * Roughness / clear coat (amount, roughness) / specular strength.
 */
export const FIGURE_FINISH: Record<Exclude<SurfaceKind, 'decal'>, { roughness: number; clearcoat: number; clearcoatRoughness: number; specular: number }> = {
  // Hair: glossier than the rest, but a soft sheen rather than a wet shine.
  hair: { roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, specular: 0.25 },
  // Skin: smooth satin plastic, a soft sheen rather than a shine.
  skin: { roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.35, specular: 0.3 },
  // Clothes: semi-gloss paint.
  cloth: { roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.4, specular: 0.3 },
  metal: { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, specular: 1 },
};

/** Warm translucency of PVC skin: light that enters lifts the shadow side (multiplied by the texture). */
export const FIGURE_SKIN_GLOW: [number, number, number] = [0.2, 0.07, 0.06];

/**
 * 'figure' preset: the model as a painted PVC figure. Every surface is
 * smooth (no detail maps) and lacquered, glossier for hair than for skin;
 * printed parts such as eyes keep their drawn colors under a clear coat.
 */
function createFigureMaterial(src: PresetMaterialSource): THREE.Material {
  const [r, g, b] = src.diffuse;
  const kind = src.kind ?? 'cloth';
  const mat = new THREE.MeshPhysicalMaterial({ ...common(src), color: srgb(r, g, b), map: src.map, metalness: 0 });
  if (kind === 'decal') {
    // Printed eyes and marks: color as drawn (lit by itself), glossy coat on top.
    mat.color.setRGB(0, 0, 0);
    mat.emissive.set(src.map ? 0xffffff : srgb(r, g, b));
    mat.emissiveMap = src.map;
    mat.roughness = 1;
    mat.specularIntensity = 0;
    mat.clearcoat = 1;
    mat.clearcoatRoughness = 0.05;
    return mat;
  }
  const f = FIGURE_FINISH[kind];
  mat.roughness = f.roughness;
  mat.clearcoat = f.clearcoat;
  mat.clearcoatRoughness = f.clearcoatRoughness;
  mat.specularIntensity = f.specular;
  if (kind === 'metal') mat.metalness = 0.8;
  if (kind === 'skin') {
    mat.emissiveMap = src.map;
    mat.emissive.setRGB(...FIGURE_SKIN_GLOW);
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
  /** Where the directional light comes from (it shines toward the origin). */
  lightFrom: [number, number, number];
}

const DEFAULT_LIGHT_FROM: [number, number, number] = [-10, 30, 20];

export function presetLighting(preset: DisplayPreset): PresetLighting {
  switch (preset) {
    case 'pbr':
    case 'clay':
      return { hemisphere: 0.4, skyColor: 0xffffff, groundColor: 0x8899aa, directional: 2.2, environment: 0.6, toneMapping: THREE.NeutralToneMapping, exposure: 1, lightFrom: DEFAULT_LIGHT_FROM };
    case 'real':
      // Strong key light, cool sky fill and filmic tone mapping (hand-tuned: the
      // light is raised and exposure lowered so highlights keep their color).
      return { hemisphere: 0.6, skyColor: 0xdde4ff, groundColor: 0x6e6964, directional: 4.2, environment: 0.5, toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.5, lightFrom: DEFAULT_LIGHT_FROM };
    case 'figure':
      // Soft light-box look (hand-tuned): strong fill for a key:fill of about 3:1, and
      // lowered exposure so highlights stay below Neutral's roll-off and keep their color.
      return { hemisphere: 0.8, skyColor: 0xffffff, groundColor: 0x9a9690, directional: 2.5, environment: 0.5, toneMapping: THREE.NeutralToneMapping, exposure: 0.8, lightFrom: DEFAULT_LIGHT_FROM };
    case 'mmd': {
      // The MMD shading uses only the light's direction: MMD's default one.
      const [x, y, z] = MMD_LIGHT_DIRECTION;
      return { hemisphere: 1.6, skyColor: 0xffffff, groundColor: 0x8899aa, directional: 1.8, environment: 0, toneMapping: THREE.NoToneMapping, exposure: 1, lightFrom: [-x * 20, -y * 20, -z * 20] };
    }
    default:
      return { hemisphere: 1.6, skyColor: 0xffffff, groundColor: 0x8899aa, directional: 1.8, environment: 0, toneMapping: THREE.NoToneMapping, exposure: 1, lightFrom: DEFAULT_LIGHT_FROM };
  }
}
