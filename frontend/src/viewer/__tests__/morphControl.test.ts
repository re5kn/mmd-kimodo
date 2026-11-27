import { describe, expect, test, vi } from 'vitest';
import { morphControlStore } from '../morphControl';

describe('morphControlStore', () => {
  test('sets, clears and resets hand-set weights', () => {
    const listener = vi.fn();
    const off = morphControlStore.subscribe(listener);
    morphControlStore.set(3, 0.5);
    expect(morphControlStore.get().get(3)).toBe(0.5);
    morphControlStore.set(3, null);
    expect(morphControlStore.get().has(3)).toBe(false);
    morphControlStore.set(1, 1);
    morphControlStore.reset();
    expect(morphControlStore.get().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(4);
    // Nothing to reset: no change event.
    morphControlStore.reset();
    expect(listener).toHaveBeenCalledTimes(4);
    off();
  });
});
