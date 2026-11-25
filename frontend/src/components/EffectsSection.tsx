import { TONE_MAPPINGS, type EffectSettings, type ToneMappingChoice } from '../viewer/postEffects';
import type { ViewerOptions } from '../viewer/MmdViewer';

interface Props {
  options: ViewerOptions;
  onOptions: (opts: Partial<ViewerOptions>) => void;
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="field">
      {p.label}（{p.value.toFixed(2)}）
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Sidebar section (Issue #11 C3): post-processing effects, each on its own. */
export function EffectsSection({ options, onOptions }: Props) {
  const fx = options.effects;
  const set = (patch: Partial<EffectSettings>) => onOptions({ effects: { ...fx, ...patch } });
  const bloom = (patch: Partial<EffectSettings['bloom']>) => set({ bloom: { ...fx.bloom, ...patch } });
  const dof = (patch: Partial<EffectSettings['dof']>) => set({ dof: { ...fx.dof, ...patch } });

  return (
    <section>
      <h2>ポストエフェクト</h2>
      <label className="check">
        <input type="checkbox" checked={fx.bloom.enabled} onChange={(e) => bloom({ enabled: e.target.checked })} /> ブルーム（光のにじみ）
      </label>
      {fx.bloom.enabled && (
        <>
          <Slider label="強さ" value={fx.bloom.strength} min={0} max={2} step={0.05} onChange={(v) => bloom({ strength: v })} />
          <Slider label="広がり" value={fx.bloom.radius} min={0} max={1} step={0.05} onChange={(v) => bloom({ radius: v })} />
          <Slider label="しきい値" value={fx.bloom.threshold} min={0} max={1.5} step={0.01} onChange={(v) => bloom({ threshold: v })} />
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={fx.dof.enabled} onChange={(e) => dof({ enabled: e.target.checked })} /> 被写界深度（背景ぼかし）
      </label>
      {fx.dof.enabled && (
        <>
          <Slider label="ぼかし" value={fx.dof.strength} min={0} max={1} step={0.05} onChange={(v) => dof({ strength: v })} />
          <p className="hint">ピントは回転の中心（モデル）に合います</p>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={fx.smaa} onChange={(e) => set({ smaa: e.target.checked })} /> SMAA（輪郭のギザギザを軽減）
      </label>
      <label className="field">
        トーンマップ
        <select value={fx.toneMapping} onChange={(e) => set({ toneMapping: e.target.value as ToneMappingChoice })}>
          {TONE_MAPPINGS.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
