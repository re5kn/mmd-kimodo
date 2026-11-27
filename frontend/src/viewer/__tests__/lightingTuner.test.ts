import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { presetLighting } from '../displayPresets';
import { lightingSnippet, lightingTunerStore, tunedPresetLighting } from '../lightingTuner';

describe('lighting tuner', () => {
  test('without overrides the preset lighting is unchanged', () => {
    lightingTunerStore.reset('figure');
    expect(tunedPresetLighting('figure')).toEqual(presetLighting('figure'));
  });

  test('overrides apply to one preset only and can be reset', () => {
    let calls = 0;
    const unsubscribe = lightingTunerStore.subscribe(() => calls++);
    lightingTunerStore.set('figure', { directional: 3.3 });
    expect(tunedPresetLighting('figure').directional).toBe(3.3);
    expect(tunedPresetLighting('real')).toEqual(presetLighting('real'));
    lightingTunerStore.reset('figure');
    expect(tunedPresetLighting('figure').directional).toBe(presetLighting('figure').directional);
    expect(calls).toBe(2);
    unsubscribe();
  });

  test('the snippet holds the tuned values in source form', () => {
    lightingTunerStore.set('real', { hemisphere: 0.123, skyColor: 0xabcdef, toneMapping: THREE.AgXToneMapping });
    const s = lightingSnippet('real');
    expect(s).toContain('hemisphere: 0.12');
    expect(s).toContain('skyColor: 0xabcdef');
    expect(s).toContain('THREE.AgXToneMapping');
    lightingTunerStore.reset('real');
  });
});

test('the left / right comparison can be turned off and on', () => {
  expect(lightingTunerStore.getCompare()).toBe(true);
  lightingTunerStore.setCompare(false);
  expect(lightingTunerStore.getCompare()).toBe(false);
  lightingTunerStore.setCompare(true);
  expect(lightingTunerStore.getCompare()).toBe(true);
});
