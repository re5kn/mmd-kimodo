import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LIGHTING,
  MMD_LIGHT_FROM,
  anglesFromDirection,
  directionFromAngles,
  lightingPreset,
  resolveLighting,
} from '../lighting';

const close = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-3);

describe('lighting', () => {
  test('angles and directions convert both ways', () => {
    for (const v of [new THREE.Vector3(1, 2, 3), new THREE.Vector3(-4, 1, -2), new THREE.Vector3(0, 1, 1)]) {
      const { azimuth, elevation } = anglesFromDirection(v);
      close(directionFromAngles(azimuth, elevation), v.clone().normalize());
    }
    close(directionFromAngles(0, 0), new THREE.Vector3(0, 0, 1));
    close(directionFromAngles(90, 0), new THREE.Vector3(1, 0, 0));
    close(directionFromAngles(0, 90), new THREE.Vector3(0, 1, 0));
  });

  test('the MMD preset is MMD default direction and 154 gray', () => {
    const s = lightingPreset('mmd', new THREE.Vector3(0, 1, 0));
    const r = resolveLighting(s, new THREE.Vector3(0, 1, 0));
    close(r.key.from, MMD_LIGHT_FROM.clone().normalize());
    expect(r.key.mmdColor.r).toBeCloseTo(154 / 255);
    expect(r.key.scale.r).toBeCloseTo(1);
    expect(r.extras).toHaveLength(0);
  });

  test('auto follows the display preset direction', () => {
    const from = new THREE.Vector3(-10, 30, 20);
    const r = resolveLighting(DEFAULT_LIGHTING, from);
    close(r.key.from, from.clone().normalize());
  });

  test('three-point adds a fill on the other side and a rim from behind', () => {
    const r = resolveLighting(lightingPreset('threePoint', new THREE.Vector3(0, 1, 0)), new THREE.Vector3());
    expect(r.extras).toHaveLength(2);
    const [fill, rim] = r.extras;
    expect(Math.sign(fill.from.x)).toBe(-Math.sign(r.key.from.x));
    expect(rim.from.z).toBeLessThan(0);
    expect(fill.strength).toBeLessThan(rim.strength);
  });

  test('a brighter, tinted color scales relative to 154 gray', () => {
    const r = resolveLighting({ ...DEFAULT_LIGHTING, preset: null, color: '#ff9a00' }, new THREE.Vector3());
    expect(r.key.scale.r).toBeCloseTo(255 / 154);
    expect(r.key.scale.g).toBeCloseTo(1);
    expect(r.key.scale.b).toBeCloseTo(0);
  });
});
