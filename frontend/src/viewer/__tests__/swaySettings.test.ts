import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SWAY_PARAMS } from '../../physics/sway';
import { parseSwayChain, swaySettingsStore } from '../swaySettings';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const chain = { enabled: true, startBone: '髪1', endBone: '髪3', blend: 'with' as const, ...DEFAULT_SWAY_PARAMS };

describe('sway settings', () => {
  afterEach(() => {
    swaySettingsStore.load(null);
    vi.unstubAllGlobals();
  });

  test('chains are saved per model', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    swaySettingsStore.load('モデルA');
    const id = swaySettingsStore.add(chain);
    swaySettingsStore.update(id, { stiffness: 0.8, blend: 'replace' });
    swaySettingsStore.load('モデルB');
    expect(swaySettingsStore.get()).toEqual([]);
    swaySettingsStore.load('モデルA');
    expect(swaySettingsStore.get()).toEqual([{ ...chain, id, stiffness: 0.8, blend: 'replace' }]);
    swaySettingsStore.remove(id);
    expect(storage.data.size).toBe(0);
  });

  test('saved values are checked and clamped', () => {
    expect(parseSwayChain({ startBone: 'a' })).toBeNull();
    const c = parseSwayChain({ id: 'x', startBone: 'a', endBone: 'b', blend: '?', stiffness: 3, gravity: 'lots', enabled: false });
    expect(c).toEqual({ ...DEFAULT_SWAY_PARAMS, id: 'x', startBone: 'a', endBone: 'b', blend: 'with', stiffness: 1, enabled: false });
  });

  test('group settings change every chain of the group', () => {
    swaySettingsStore.load('x');
    const a = swaySettingsStore.add({ ...chain, linkGroup: 'skirt' });
    const b = swaySettingsStore.add({ ...chain, linkGroup: ' skirt' });
    const c = swaySettingsStore.add({ ...chain, linkGroup: 'other' });
    swaySettingsStore.updateGroup('skirt', { linkStiffness: 0.9, linkLoop: false });
    const by = (id: string) => swaySettingsStore.get().find((x) => x.id === id)!;
    expect([by(a).linkStiffness, by(b).linkStiffness, by(c).linkStiffness]).toEqual([0.9, 0.9, DEFAULT_SWAY_PARAMS.linkStiffness]);
    expect(by(b).linkLoop).toBe(false);
  });

  test('broken storage falls back to no chains', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{oops', setItem: () => { throw new Error('full'); }, removeItem: () => {} });
    swaySettingsStore.load('x');
    expect(swaySettingsStore.get()).toEqual([]);
    swaySettingsStore.add(chain);
    expect(swaySettingsStore.get()).toHaveLength(1);
  });
});
