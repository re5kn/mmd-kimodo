import { useMemo, useSyncExternalStore } from 'react';
import type { ModelDto } from '../api/types';
import { isSkinMaterial, skinLightStore } from '../viewer/skinLight';
import { classifySurfaces } from '../viewer/surfaceKind';

interface Props {
  model: ModelDto | null;
}

const isGrayHex = (c: string) => c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7);
const grayHex = (v: number) => '#' + Math.round(v).toString(16).padStart(2, '0').repeat(3);

/**
 * Sidebar section (Issue #29): lights only the skin materials with their own
 * light color, in every display preset. Saved per model.
 */
export function SkinLightSection({ model }: Props) {
  const s = useSyncExternalStore(skinLightStore.subscribe, skinLightStore.get);
  const kinds = useMemo(() => {
    if (!model) return [];
    const path = (i: number) => (i >= 0 ? model.textures[i]?.path : undefined);
    return classifySurfaces(model.materials.map((m) => ({ name: m.name, texturePaths: [path(m.textureIndex), path(m.sphereTextureIndex)] })));
  }, [model]);
  if (!model || model.materials.length === 0) return null;
  const gray = parseInt(s.color.slice(1, 3), 16);
  const skinCount = model.materials.filter((_, i) => isSkinMaterial(i, kinds[i], s)).length;

  return (
    <section>
      <h2>肌の照明</h2>
      <p className="hint">肌の材質だけ、照明パネルの色の代わりにこの色で照らします（どの表示にも効きます）。設定はモデルごとに保存します</p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => skinLightStore.update({ enabled: e.target.checked })} /> 肌の照明を使う
      </label>
      <label className="field">
        明るさ（{isGrayHex(s.color) ? `${gray}、MMD 初期値は 154` : s.color}）
        <input type="range" min={0} max={255} step={1} value={gray} disabled={!s.enabled} onChange={(e) => skinLightStore.update({ color: grayHex(Number(e.target.value)) })} />
      </label>
      <label className="field">
        色
        <input type="color" value={s.color} disabled={!s.enabled} onChange={(e) => skinLightStore.update({ color: e.target.value })} />
      </label>
      <details className="skin-material-list">
        <summary>肌として扱う材質（{skinCount}）</summary>
        <p className="hint">初期値は材質名・テクスチャ名からの自動判定です。* は手で変えたもの</p>
        <ul>
          {model.materials.map((m, i) => {
            const auto = kinds[i] === 'skin';
            const manual = s.overrides.has(i);
            return (
              <li key={i}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={isSkinMaterial(i, kinds[i], s)}
                    onChange={(e) => skinLightStore.setOverride(i, e.target.checked === auto ? null : e.target.checked)}
                  />
                  <span>
                    {m.name || `材質 ${i}`}
                    {manual ? ' *' : ''}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button type="button" disabled={s.overrides.size === 0} onClick={() => skinLightStore.set({ ...s, overrides: new Map() })}>
          自動判定に戻す
        </button>
      </details>
    </section>
  );
}
