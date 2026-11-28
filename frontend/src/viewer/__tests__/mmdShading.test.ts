import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { MMD_FINAL_COLOR_LINE, MMD_LIGHT_COLOR, MMD_LIGHT_DIRECTION, SUB_UV_ATTRIBUTE, SphereMode, createMmdMaterial, type MmdShadingSource } from '../mmdShading';
import { createPresetMaterial, presetLighting } from '../displayPresets';

const source = (over: Partial<MmdShadingSource> = {}): MmdShadingSource => ({
  diffuse: [0.8, 0.6, 0.4, 0.5],
  ambient: [0.4, 0.3, 0.2],
  specular: [0.1, 0.1, 0.1],
  specularity: 12,
  map: null,
  toon: null,
  sphere: null,
  ...over,
});

const compile = (mat: THREE.Material) => {
  const shader = {
    vertexShader: new THREE.ShaderMaterial().vertexShader + '\n#include <common>\n#include <uv_vertex>\n',
    fragmentShader: THREE.ShaderLib.toon.fragmentShader,
    uniforms: {},
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe('MMD shading', () => {
  test('three.js toon shader still has the line we replace', () => {
    expect(THREE.ShaderLib.toon.fragmentShader).toContain(MMD_FINAL_COLOR_LINE);
  });

  test('replaces the final color with the MMD formula and keeps the material values as uniforms', () => {
    const mat = createMmdMaterial(source(), { opacity: 0.5, transparent: true });
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.opacity).toBe(0.5);
    const shader = compile(mat);
    expect(shader.fragmentShader).not.toContain(MMD_FINAL_COLOR_LINE);
    expect(shader.fragmentShader).toContain('mix( mmdLightColor, skinLightColor, skinLightOn )');
    expect(shader.fragmentShader).toContain('mmdDiffuse * mmdLight + mmdAmbient');
    const u = shader.uniforms as Record<string, THREE.IUniform>;
    expect(u.mmdDiffuse.value.toArray()).toEqual([0.8, 0.6, 0.4]);
    expect(u.mmdAmbient.value.toArray()).toEqual([0.4, 0.3, 0.2]);
    expect(u.mmdShininess.value).toBe(12);
    expect(u.mmdLightColor.value.x).toBeCloseTo(MMD_LIGHT_COLOR);
  });

  test('has a self-shadow path that darkens toward the toon bottom color', () => {
    const frag = compile(createMmdMaterial(source(), {})).fragmentShader;
    expect(frag).toContain('min( clamp( mmdNL * 3.0, 0.0, 1.0 ), mmdLit )');
    expect(frag).toContain('vec2( 0.0, 1.0 )');
    expect(frag).toContain('directionalShadowMap[ 0 ]');
  });

  test('materials can share one light color uniform', () => {
    const light = { value: new THREE.Vector3(1, 0.5, 0) };
    const a = compile(createMmdMaterial(source(), {}, light)).uniforms as Record<string, THREE.IUniform>;
    const b = compile(createMmdMaterial(source(), {}, light)).uniforms as Record<string, THREE.IUniform>;
    expect(a.mmdLightColor).toBe(light);
    expect(b.mmdLightColor).toBe(light);
  });

  test('uses the toon as its gradient map, or none (white) without one', () => {
    const toon = new THREE.DataTexture();
    expect(createMmdMaterial(source({ toon }), {}).gradientMap).toBe(toon);
    expect(createMmdMaterial(source(), {}).gradientMap).toBeNull();
  });

  test('sphere modes compile to separate programs', () => {
    const map = new THREE.Texture();
    const add = createMmdMaterial(source({ sphere: { map, mode: SphereMode.Add } }), {});
    const mul = createMmdMaterial(source({ sphere: { map, mode: SphereMode.Multiply } }), {});
    expect(add.defines).toEqual({ MMD_SPHERE_MODE: 2 });
    expect(mul.defines).toEqual({ MMD_SPHERE_MODE: 1 });
    expect(add.customProgramCacheKey()).not.toBe(mul.customProgramCacheKey());
    expect((compile(add).uniforms as Record<string, THREE.IUniform>).mmdSphere.value).toBe(map);
  });

  test('sub-texture spheres read the additional UV', () => {
    const mat = createMmdMaterial(source({ sphere: { map: new THREE.Texture(), mode: SphereMode.SubTexture } }), {});
    const shader = compile(mat);
    expect(shader.vertexShader).toContain(`vMmdSubUv = ${SUB_UV_ATTRIBUTE};`);
    expect(shader.fragmentShader).toContain('varying vec2 vMmdSubUv;');
  });

  test("the MMD-style preset lights from MMD's default direction", () => {
    const from = new THREE.Vector3(...presetLighting('mmd').lightFrom).normalize();
    const dir = new THREE.Vector3(...MMD_LIGHT_DIRECTION).normalize();
    expect(from.dot(dir)).toBeCloseTo(-1);
  });

  test('the MMD-style preset uses it', () => {
    const mat = createPresetMaterial(
      'mmd',
      {
        name: 'm',
        diffuse: [1, 1, 1, 1],
        ambient: [0.5, 0.5, 0.5],
        specularity: 5,
        doubleSided: false,
        map: null,
        outline: { thickness: 0, color: [0, 0, 0], alpha: 1, visible: false },
      },
      {},
    );
    expect(mat.userData.mmdUniforms).toBeDefined();
  });
});
