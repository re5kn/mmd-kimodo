import { useMemo, useState, useSyncExternalStore } from 'react';
import { RigidBodyMode, type BoneDto, type ModelDto } from '../api/types';
import { removeReplacedBodies } from '../physics/replace';
import { DEFAULT_SWAY_PARAMS, defaultSwayEnd, resolveSwayChain, swayEndCandidates, type SwayBlend, type SwayChainSettings } from '../physics/sway';
import { swaySettingsStore } from '../viewer/swaySettings';

interface Props {
  model: ModelDto | null;
  physicsOn: boolean;
}

/** Bones that look like a strand to swing, for the first chain's default start. */
const SWAY_NAME = /髪|hair|ﾘﾎﾞﾝ|リボン|ribbon|尻尾|しっぽ|tail|ｱﾎ|アホ/i;

/**
 * Sidebar section (Issue #31): point-chain sway on any row of bones, used
 * with the PMX rigid bodies or in place of them. Saved per model.
 */
export function SwaySection({ model, physicsOn }: Props) {
  const chains = useSyncExternalStore(swaySettingsStore.subscribe, swaySettingsStore.get);
  /** Bones with a simulated PMX body. */
  const simulated = useMemo(() => {
    const set = new Set<number>();
    for (const rb of model?.rigidBodies ?? []) if (rb.mode !== RigidBodyMode.FollowBone && rb.bone >= 0) set.add(rb.bone);
    return set;
  }, [model]);
  if (!model || model.bones.length === 0) return null;
  const bones = model.bones;

  const add = () => {
    let start = bones.findIndex((b, i) => SWAY_NAME.test(b.name) && !simulated.has(i) && !chains.some((c) => c.startBone === b.name));
    if (start < 0) start = 0;
    swaySettingsStore.add({
      enabled: true,
      startBone: bones[start].name,
      endBone: bones[defaultSwayEnd(bones, start)].name,
      blend: 'with',
      ...DEFAULT_SWAY_PARAMS,
    });
  };

  return (
    <section>
      <h2>揺れ物（PMX外）</h2>
      <p className="hint">
        PMX の剛体とは別に、好きなボーンの列を「点の鎖」で揺らします。剛体のない髪やアクセサリーにも使えます。体の剛体（ボーン追従）に当たります。設定はモデルごとに保存します
      </p>
      {!physicsOn && chains.length > 0 && <p className="physics-note">物理演算がオフの間は揺れません</p>}
      {chains.map((c) => (
        <ChainEditor key={c.id} chain={c} model={model} simulated={simulated} />
      ))}
      <button onClick={add}>揺れ物を追加</button>
    </section>
  );
}

const boneLabel = (bones: readonly BoneDto[], i: number, simulated: ReadonlySet<number>) =>
  `${bones[i].name || `ボーン ${i}`}${simulated.has(i) ? '（剛体）' : ''}`;

function ChainEditor({ chain, model, simulated }: { chain: SwayChainSettings; model: ModelDto; simulated: ReadonlySet<number> }) {
  const [filter, setFilter] = useState('');
  const bones = model.bones;
  const set = (patch: Partial<Omit<SwayChainSettings, 'id'>>) => swaySettingsStore.update(chain.id, patch);
  const start = bones.findIndex((b) => b.name === chain.startBone);
  const path = resolveSwayChain(bones, chain.startBone, chain.endBone);
  const ends = start >= 0 ? swayEndCandidates(bones, start) : [];

  const starts = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = bones.map((_, i) => i);
    const hit = f ? all.filter((i) => bones[i].name.toLowerCase().includes(f) || bones[i].nameEn.toLowerCase().includes(f)) : all;
    return start >= 0 && !hit.includes(start) ? [start, ...hit] : hit;
  }, [bones, filter, start]);

  const pmx = useMemo(() => {
    if (!path) return { onChain: 0, removed: 0 };
    const onChain = (model.rigidBodies ?? []).filter((rb) => rb.mode !== RigidBodyMode.FollowBone && path.includes(rb.bone)).length;
    const removed = removeReplacedBodies({ bones, rigidBodies: model.rigidBodies ?? [], joints: model.joints ?? [] }, new Set(path)).removed.length;
    return { onChain, removed };
  }, [model, bones, path?.join(',')]);

  const slider = (key: 'stiffness' | 'gravity' | 'drag' | 'radius', label: string, max: number, title: string) => (
    <label className="field" title={title}>
      {label}（{chain[key].toFixed(2)}）
      <input type="range" min={0} max={max} step={0.01} value={chain[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );

  return (
    <details className="sway-chain" open>
      <summary>
        <input type="checkbox" checked={chain.enabled} onChange={(e) => set({ enabled: e.target.checked })} onClick={(e) => e.stopPropagation()} />{' '}
        {chain.startBone} → {chain.endBone}
        {path ? `（${path.length}本）` : '（ボーンが見つかりません）'}
      </summary>
      <label className="field">
        開始ボーン
        <input type="search" placeholder="名前で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select
          value={start}
          onChange={(e) => {
            const i = Number(e.target.value);
            set({ startBone: bones[i].name, endBone: bones[defaultSwayEnd(bones, i)].name });
          }}
        >
          {start < 0 && <option value={-1}>{chain.startBone}（なし）</option>}
          {starts.map((i) => (
            <option key={i} value={i}>
              {boneLabel(bones, i, simulated)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        終了ボーン
        <select value={chain.endBone} onChange={(e) => set({ endBone: e.target.value })}>
          {!path && <option value={chain.endBone}>{chain.endBone}（なし）</option>}
          {ends.map((i) => (
            <option key={i} value={bones[i].name}>
              {boneLabel(bones, i, simulated)}
            </option>
          ))}
        </select>
      </label>
      <label className="field" title="併用: PMX の剛体はそのまま動き、その結果の上でさらに揺らす。置き換え: この列のボーンについている PMX の剛体を外して、こちらだけで揺らす">
        PMX の剛体
        <select value={chain.blend} onChange={(e) => set({ blend: e.target.value as SwayBlend })}>
          <option value="with">併用する</option>
          <option value="replace">置き換える</option>
        </select>
      </label>
      {pmx.onChain > 0 && (
        <p className="hint">
          この列には PMX の剛体が {pmx.onChain} 個あります。
          {chain.blend === 'replace' ? `置き換えで ${pmx.removed} 個を外します（先につながる剛体も含む）` : '併用中は両方で揺れます'}
        </p>
      )}
      {slider('stiffness', '硬さ', 1, '元の向き（アニメーションの向き）に戻ろうとする強さ')}
      {slider('gravity', '重力', 2, 'MMD の重力に対する倍率')}
      {slider('drag', '減衰', 1, '揺れの収まりやすさ')}
      {slider('radius', '当たり半径', 1, '体の剛体に当たるときの太さ（1 = 10 cm）')}
      <label className="check">
        <input type="checkbox" checked={chain.collide} onChange={(e) => set({ collide: e.target.checked })} /> 体の剛体に当たる
      </label>
      <div className="sway-actions">
        <button
          onClick={() => set({ stiffness: DEFAULT_SWAY_PARAMS.stiffness, gravity: DEFAULT_SWAY_PARAMS.gravity, drag: DEFAULT_SWAY_PARAMS.drag, radius: DEFAULT_SWAY_PARAMS.radius })}
        >
          初期値
        </button>
        <button onClick={() => swaySettingsStore.remove(chain.id)}>削除</button>
      </div>
    </details>
  );
}
