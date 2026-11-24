import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { ShadowRig, shadowBounds } from '../shadows';

const fakeRenderer = () => ({ shadowMap: { enabled: false, type: THREE.BasicShadowMap } }) as unknown as THREE.WebGLRenderer;

describe('shadows', () => {
  test('bounds cover every point with room for hair and clothes', () => {
    const pts = [new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 16, 1)];
    const s = shadowBounds(pts);
    for (const p of pts) expect(s.distanceToPoint(p)).toBeLessThan(-2);
    expect(s.center.y).toBeCloseTo(8);
  });

  test('falls back to a box around the origin without points', () => {
    const s = shadowBounds([]);
    expect(s.radius).toBeGreaterThan(0);
  });

  test('fits the shadow camera around the model and keeps the light direction', () => {
    const light = new THREE.DirectionalLight();
    light.position.set(0, 10, 10);
    const rig = new ShadowRig(fakeRenderer(), light, new THREE.Scene());
    rig.fit(new THREE.Sphere(new THREE.Vector3(5, 8, 0), 10));
    expect(light.target.position.toArray()).toEqual([5, 8, 0]);
    const dir = light.position.clone().sub(light.target.position).normalize();
    expect(dir.y).toBeCloseTo(Math.SQRT1_2);
    expect(dir.z).toBeCloseTo(Math.SQRT1_2);
    const cam = light.shadow.camera;
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-10, 10, 10, -10]);
    expect(cam.far).toBeGreaterThan(light.position.distanceTo(light.target.position) + 10);
  });

  test('turning shadows off disables the map, the light and the ground', () => {
    const renderer = fakeRenderer();
    const light = new THREE.DirectionalLight();
    const rig = new ShadowRig(renderer, light, new THREE.Scene());
    expect(renderer.shadowMap.enabled).toBe(true);
    rig.setEnabled(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(light.castShadow).toBe(false);
    expect(rig.ground.visible).toBe(false);
  });

  test('changing direction keeps the light aimed at the model', () => {
    const light = new THREE.DirectionalLight();
    const rig = new ShadowRig(fakeRenderer(), light, new THREE.Scene());
    rig.fit(new THREE.Sphere(new THREE.Vector3(0, 8, 0), 10));
    rig.setDirection(new THREE.Vector3(10, 0, 0));
    const dir = light.position.clone().sub(light.target.position).normalize();
    expect(dir.x).toBeCloseTo(1);
    expect(light.target.position.y).toBeCloseTo(8);
  });
});
