import { useMemo, useSyncExternalStore } from 'react';
import type { ModelDto } from '../api/types';
import { materialEditStore } from '../viewer/materialEdits';
import { SURFACE_KIND_LABELS, classifySurfaces } from '../viewer/surfaceKind';

interface Props {
  model: ModelDto | null;
}

const toHex = (rgb: readonly number[]) =>
  '#' + rgb.slice(0, 3).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/**
 * Sidebar section: every material with show / hide, diffuse color and
 * opacity, adjusted live. Nothing is saved to the model.
 */
export function MaterialSection({ model }: Props) {
  const edits = useSyncExternalStore(materialEditStore.subscribe, materialEditStore.get);
  const kinds = useMemo(() => {
    if (!model) return [];
    const path = (i: number) => (i >= 0 ? model.textures[i]?.path : undefined);
    return classifySurfaces(model.materials.map((m) => ({ name: m.name, texturePaths: [path(m.textureIndex), path(m.sphereTextureIndex)] })));
  }, [model]);
  if (!model || model.materials.length === 0) return null;
  const all = model.materials.map((_, i) => i);
  const hiddenCount = all.filter((i) => edits.get(i)?.hidden).length;

  return (
    <section>
      <h2>材質</h2>
      <p className="hint">表示・色・不透明度をその場で変えます（保存はしません）。色は材質の拡散色で、MMD と同じくテクスチャに掛け合わされます。不透明度は元の値に掛けます</p>
      <details className="material-list">
        <summary>材質一覧（{model.materials.length}{hiddenCount > 0 ? `、非表示 ${hiddenCount}` : ''}）</summary>
        <ul>
          {model.materials.map((m, i) => {
            const e = edits.get(i);
            const opacity = e?.opacity ?? 1;
            return (
              <li key={i} className={e?.hidden ? 'hidden' : undefined}>
                <label className="material-name" title={`${m.name}（${SURFACE_KIND_LABELS[kinds[i]]}）`}>
                  <input
                    type="checkbox"
                    checked={!e?.hidden}
                    onChange={(ev) => materialEditStore.update(i, { hidden: ev.target.checked ? undefined : true })}
                  />
                  <span>{m.name || `材質 ${i}`}</span>
                </label>
                <input
                  type="color"
                  aria-label={`${m.name} の色`}
                  value={toHex(e?.diffuse ?? m.diffuse)}
                  onChange={(ev) => materialEditStore.update(i, { diffuse: fromHex(ev.target.value) })}
                />
                <input
                  type="range"
                  aria-label={`${m.name} の不透明度`}
                  title={`不透明度 ×${opacity.toFixed(2)}`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={opacity}
                  onChange={(ev) => {
                    const v = Number(ev.target.value);
                    materialEditStore.update(i, { opacity: v === 1 ? undefined : v });
                  }}
                />
                {e && (
                  <button className="material-reset" title="この材質を元に戻す" onClick={() => materialEditStore.update(i, { hidden: undefined, diffuse: undefined, opacity: undefined })}>
                    ↺
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>
      <div className="segmented">
        <button onClick={() => materialEditStore.updateAll(all, { hidden: undefined })} disabled={hiddenCount === 0}>
          すべて表示
        </button>
        <button onClick={() => materialEditStore.reset()} disabled={edits.size === 0}>
          すべて元に戻す
        </button>
      </div>
    </section>
  );
}
