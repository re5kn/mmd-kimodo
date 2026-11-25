import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import type { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

/**
 * Post-processing (Issue #11 C3): effects applied to the rendered image,
 * each switchable on its own.
 *
 *   scene (+ outlines) → depth of field → bloom → grading / tone mapping / sRGB → SMAA
 *
 * The scene is rendered into a linear HDR buffer, so bloom sees values above
 * 1 and tone mapping happens once, at the end. The background color is left
 * out (cleared to transparent) and laid under the image after tone mapping,
 * so it looks the same as without effects; bloom over it acts like a screen
 * blend. With every effect off the viewer renders straight to the screen
 * as before.
 */
export type ToneMappingChoice = 'auto' | 'none' | 'neutral' | 'aces' | 'agx';

/**
 * Color grading (Issue #11 C4), applied to the model in linear light before
 * tone mapping; the background keeps its color. Neutral values change nothing.
 */
export interface ColorGrade {
  /** 1 = as is, 0 = gray. */
  saturation: number;
  /** 1 = as is; pivots around middle gray (0.18 linear). */
  contrast: number;
  /** Exposure multiplier, 1 = as is. */
  brightness: number;
  /** −1 cool … 0 … +1 warm. */
  warmth: number;
  /** Darkening toward the corners of the whole image, 0-1. */
  vignette: number;
}

export const NEUTRAL_GRADE: ColorGrade = { saturation: 1, contrast: 1, brightness: 1, warmth: 0, vignette: 0 };

export function gradeActive(g: ColorGrade): boolean {
  return (Object.keys(NEUTRAL_GRADE) as (keyof ColorGrade)[]).some((k) => Math.abs(g[k] - NEUTRAL_GRADE[k]) > 1e-3);
}

/** Warmth as RGB gains (the shader's copy is in FINAL_FRAGMENT). */
export function warmthGain(warmth: number): [number, number, number] {
  return [1 + 0.12 * warmth, 1, 1 - 0.12 * warmth];
}

export interface EffectSettings {
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  /** Depth of field, focused on the orbit target (the model). */
  dof: { enabled: boolean; strength: number };
  smaa: boolean;
  grade: ColorGrade;
  /** 'auto' keeps the display preset's tone mapping. */
  toneMapping: ToneMappingChoice;
}

export const DEFAULT_EFFECTS: EffectSettings = {
  // Threshold just above the default light-gray background (linear ≈ 0.9),
  // so only bright highlights glow.
  bloom: { enabled: false, strength: 0.5, radius: 0.5, threshold: 0.95 },
  dof: { enabled: false, strength: 0.5 },
  smaa: false,
  grade: NEUTRAL_GRADE,
  toneMapping: 'auto',
};

export const TONE_MAPPINGS: { kind: ToneMappingChoice; label: string; value?: THREE.ToneMapping }[] = [
  { kind: 'auto', label: '表示に合わせる' },
  { kind: 'none', label: 'なし', value: THREE.NoToneMapping },
  { kind: 'neutral', label: 'Neutral', value: THREE.NeutralToneMapping },
  { kind: 'aces', label: 'ACES Filmic', value: THREE.ACESFilmicToneMapping },
  { kind: 'agx', label: 'AgX', value: THREE.AgXToneMapping },
];

/** The tone mapping to use: the user's choice, or the display preset's. */
export function resolveToneMapping(choice: ToneMappingChoice, presetDefault: THREE.ToneMapping): THREE.ToneMapping {
  return TONE_MAPPINGS.find((t) => t.kind === choice)?.value ?? presetDefault;
}

/** Whether any effect needs the post-processing chain. */
export function effectsActive(s: EffectSettings): boolean {
  return s.bloom.enabled || s.dof.enabled || s.smaa || gradeActive(s.grade);
}

/**
 * Bokeh aperture and blur cap for a 0-1 strength. Blur grows with aperture
 * × distance from the focus (MMD units, a model is about 20 tall), so a
 * body a few units deep stays sharp while the floor and far side blur.
 */
export const dofAperture = (strength: number) => 0.00005 + strength * 0.0006;
export const dofMaxBlur = (strength: number) => 0.004 + strength * 0.016;

/** Renders the scene into the composer's buffer, with OutlineEffect's outlines when asked. */
class ScenePass extends Pass {
  outline = true;
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly outlineEffect: OutlineEffect,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // Transparent background: alpha = coverage, for BackgroundShader.
    const background = this.scene.background;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    this.scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(readBuffer);
    renderer.clear();
    if (this.outline) this.outlineEffect.render(this.scene, this.camera);
    else renderer.render(this.scene, this.camera);
    this.scene.background = background;
    renderer.setClearColor(this.clearColor, clearAlpha);
  }
}

/** Keeps a copy of the image before bloom, so the final pass can tell the glow apart. */
class SceneCopyPass extends Pass {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly quad = new FullScreenQuad(new THREE.ShaderMaterial(CopyShader));

  constructor() {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const material = this.quad.material as THREE.ShaderMaterial;
    material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  dispose(): void {
    this.target.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Tone mapping, sRGB and the background, in one step (replaces OutputPass's
 * shader; OutputPass still picks the tone mapping defines).
 *
 * The image is premultiplied (alpha = coverage), and tone mapping is not
 * linear, so a half-covered pixel is tone mapped as its own color and then
 * blended over the background in display space, as when rendering straight
 * to the screen. Bloom's glow G (image minus the copy before bloom) is
 * light added on top: over the model it joins the model's color, over the
 * background it is added like a screen blend. Color grading (C4) applies
 * to the model's own color; the vignette darkens the finished image.
 */
export const FINAL_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tScene;
  uniform bool useScene;
  uniform vec3 background;
  uniform float saturation;
  uniform float contrast;
  uniform float brightness;
  uniform float warmth;
  uniform float vignette;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;

  vec3 toDisplay( vec3 c ) {
    #if defined( LINEAR_TONE_MAPPING )
      c = LinearToneMapping( c );
    #elif defined( REINHARD_TONE_MAPPING )
      c = ReinhardToneMapping( c );
    #elif defined( CINEON_TONE_MAPPING )
      c = CineonToneMapping( c );
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      c = ACESFilmicToneMapping( c );
    #elif defined( AGX_TONE_MAPPING )
      c = AgXToneMapping( c );
    #elif defined( NEUTRAL_TONE_MAPPING )
      c = NeutralToneMapping( c );
    #elif defined( CUSTOM_TONE_MAPPING )
      c = CustomToneMapping( c );
    #endif
    #ifdef SRGB_TRANSFER
      c = sRGBTransferOETF( vec4( c, 1.0 ) ).rgb;
    #endif
    return c;
  }

  vec3 grade( vec3 c ) {
    c *= brightness * vec3( 1.0 + 0.12 * warmth, 1.0, 1.0 - 0.12 * warmth );
    c = 0.18 * pow( max( c, 0.0 ) / 0.18, vec3( contrast ) );
    float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    return max( mix( vec3( l ), c, saturation ), 0.0 );
  }

  void main() {
    vec4 image = texture2D( tDiffuse, vUv );
    vec4 scene = useScene ? texture2D( tScene, vUv ) : image;
    vec3 glow = max( image.rgb - scene.rgb, 0.0 );
    float a = clamp( scene.a, 0.0, 1.0 );
    vec3 own = a > 0.0 ? toDisplay( grade( scene.rgb / a ) + glow ) : vec3( 0.0 );
    vec3 under = background + ( useScene ? toDisplay( glow ) : vec3( 0.0 ) );
    vec3 color = own * a + under * ( 1.0 - a );
    vec2 d = ( vUv - 0.5 ) * 1.4142;
    color *= 1.0 - vignette * smoothstep( 0.35, 1.0, dot( d, d ) );
    gl_FragColor = vec4( color, 1.0 );
  }`;

class FinalPass extends OutputPass {
  constructor() {
    super();
    Object.assign(this.uniforms, {
      tScene: { value: null },
      useScene: { value: false },
      background: { value: new THREE.Color() },
      saturation: { value: 1 },
      contrast: { value: 1 },
      brightness: { value: 1 },
      warmth: { value: 0 },
      vignette: { value: 0 },
    });
    this.material.fragmentShader = FINAL_FRAGMENT;
  }
}

export const BOKEH_OPAQUE_LINE = 'gl_FragColor.a = 1.0;';

export class PostEffects {
  private composer: EffectComposer | null = null;
  private scenePass!: ScenePass;
  private bokeh!: BokehPass;
  private bloom!: UnrealBloomPass;
  private smaa!: SMAAPass;
  private sceneCopy!: SceneCopyPass;
  private final!: FinalPass;
  private readonly size = new THREE.Vector2(1, 1);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly outline: OutlineEffect,
  ) {}

  /** The chain is built on first use, so viewers without effects pay nothing. */
  private build(): EffectComposer {
    const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    this.scenePass = new ScenePass(this.scene, this.camera, this.outline);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 10, aperture: dofAperture(0.5), maxblur: 0.01 });
    // Keep the blurred coverage (the background is laid under it later).
    const bokehMaterial = (this.bokeh as unknown as { materialBokeh: THREE.ShaderMaterial }).materialBokeh;
    if (!bokehMaterial.fragmentShader.includes(BOKEH_OPAQUE_LINE)) console.warn('post effects: three.js bokeh shader changed; the background may darken under depth of field');
    bokehMaterial.fragmentShader = bokehMaterial.fragmentShader.replace(BOKEH_OPAQUE_LINE, '');
    this.bloom = new UnrealBloomPass(this.size.clone(), 0.5, 0.5, 0.95);
    this.smaa = new SMAAPass();
    composer.addPass(this.scenePass);
    composer.addPass(this.bokeh);
    this.sceneCopy = new SceneCopyPass();
    composer.addPass(this.sceneCopy);
    composer.addPass(this.bloom);
    this.final = new FinalPass();
    composer.addPass(this.final);
    composer.addPass(this.smaa);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.size.x, this.size.y);
    this.composer = composer;
    return composer;
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
  }

  /**
   * Renders one frame through the chain. `focus` is the distance from the
   * camera to what should be sharp.
   */
  render(s: EffectSettings, opts: { outline: boolean; focus: number }): void {
    const composer = this.composer ?? this.build();
    this.scenePass.outline = opts.outline;
    this.bokeh.enabled = s.dof.enabled;
    const u = this.bokeh.uniforms as Record<string, THREE.IUniform<number>>;
    u.focus.value = opts.focus;
    u.aperture.value = dofAperture(s.dof.strength);
    u.maxblur.value = dofMaxBlur(s.dof.strength);
    this.bloom.enabled = s.bloom.enabled;
    this.bloom.strength = s.bloom.strength;
    this.bloom.radius = s.bloom.radius;
    this.bloom.threshold = s.bloom.threshold;
    this.smaa.enabled = s.smaa;
    this.sceneCopy.enabled = s.bloom.enabled;
    this.final.uniforms.useScene.value = s.bloom.enabled;
    this.final.uniforms.tScene.value = this.sceneCopy.target.texture;
    for (const k of Object.keys(NEUTRAL_GRADE) as (keyof ColorGrade)[]) this.final.uniforms[k].value = s.grade[k];
    const bg = this.scene.background instanceof THREE.Color ? this.scene.background : null;
    const bgUniform = this.final.uniforms.background.value as THREE.Color;
    if (bg) bg.getRGB(bgUniform, THREE.SRGBColorSpace);
    else bgUniform.setRGB(0, 0, 0);
    composer.render();
  }

  dispose(): void {
    this.composer?.dispose();
    this.bokeh?.dispose();
    this.bloom?.dispose();
    this.smaa?.dispose();
    this.sceneCopy?.dispose();
    this.final?.dispose();
  }
}
