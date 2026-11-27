import { useMemo, useSyncExternalStore } from 'react';
import type { ModelDto } from '../api/types';
import { morphsByPanel } from '../mmd/morphPanels';
import { morphControlStore } from '../viewer/morphControl';

interface Props {
  model: ModelDto | null;
}

/**
 * Sidebar section: a slider per morph, grouped like MMD's expression panel
 * (眉 / 目 / 口 / その他, each foldable). A slider that was moved overrides the motion's weight.
 */
export function MorphSection({ model }: Props) {
  const overrides = useSyncExternalStore(morphControlStore.subscribe, morphControlStore.get);
  const groups = useMemo(() => (model ? morphsByPanel(model) : []), [model]);
  if (!model || groups.length === 0) return null;

  return (
    <section>
      <h2>モーフ</h2>
      <p className="hint">動かしたモーフはモーションの値より優先されます</p>
      {groups.map((g) => (
        <details key={g.label} open className="morph-group">
          <summary>{g.label}（{g.indices.length}）</summary>
          {g.indices.map((i) => {
            const w = overrides.get(i);
            return (
              <label className="field" key={i}>
                {model.morphs[i].name}（{w === undefined ? 'モーション' : w.toFixed(2)}）
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
        </details>
      ))}
      <button onClick={() => morphControlStore.reset()} disabled={overrides.size === 0}>
        モーションの値に戻す
      </button>
    </section>
  );
}
