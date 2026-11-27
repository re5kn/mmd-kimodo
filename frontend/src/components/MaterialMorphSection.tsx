import { useMemo, useSyncExternalStore } from 'react';
import type { ModelDto } from '../api/types';
import { materialMorphIndices } from '../mmd/materialMorph';
import { morphControlStore } from '../viewer/morphControl';

interface Props {
  model: ModelDto | null;
}

/**
 * Sidebar section: sliders for the morphs that change materials (blush,
 * hidden highlights…). A slider that was moved overrides the motion's weight.
 */
export function MaterialMorphSection({ model }: Props) {
  const overrides = useSyncExternalStore(morphControlStore.subscribe, morphControlStore.get);
  const indices = useMemo(() => (model ? materialMorphIndices(model) : []), [model]);
  if (!model || indices.length === 0) return null;

  return (
    <section>
      <h2>材質モーフ</h2>
      <p className="hint">動かしたモーフはモーションの値より優先されます</p>
      {indices.map((i) => {
        const m = model.morphs[i];
        const w = overrides.get(i);
        return (
          <label className="field" key={i}>
            {m.name}（{w === undefined ? 'モーション' : w.toFixed(2)}）
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={w ?? 0}
              onChange={(e) => morphControlStore.set(i, Number(e.target.value))}
            />
          </label>
        );
      })}
      <button onClick={() => morphControlStore.reset()} disabled={overrides.size === 0}>
        モーションの値に戻す
      </button>
    </section>
  );
}
