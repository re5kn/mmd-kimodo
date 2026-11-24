import { LOOKS, currentLook } from '../viewer/looks';
import { NEUTRAL_GRADE, TONE_MAPPINGS, type ColorGrade, type EffectSettings, type ToneMappingChoice } from '../viewer/postEffects';
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

/** Sidebar section (Issue #11 C3, C4): built-in looks, then each effect and color grading on its own. */
export function EffectsSection({ options, onOptions }: Props) {
  const fx = options.effects;
  const set = (patch: Partial<EffectSettings>) => onOptions({ effects: { ...fx, ...patch } });
  const bloom = (patch: Partial<EffectSettings['bloom']>) => set({ bloom: { ...fx.bloom, ...patch } });
  const dof = (patch: Partial<EffectSettings['dof']>) => set({ dof: { ...fx.dof, ...patch } });
  const grade = (patch: Partial<ColorGrade>) => set({ grade: { ...fx.grade, ...patch } });
  const look = currentLook(fx);

  return (
    <section>
      <h2>ポストエフェクト</h2>
      <div className="segmented" role="radiogroup" aria-label="エフェクトプリセット">
        {LOOKS.map((l) => (
          <button
            key={l.kind}
            role="radio"
            aria-checked={look === l.kind}
            className={look === l.kind ? 'active' : undefined}
            title={l.description}
            onClick={() => onOptions({ effects: l.effects })}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="hint">{look ? LOOKS.find((l) => l.kind === look)!.description : 'カスタム'}。どの表示にも重ねられます</p>
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
      <h3>色調補正</h3>
      <Slider label="彩度" value={fx.grade.saturation} min={0} max={2} step={0.05} onChange={(v) => grade({ saturation: v })} />
      <Slider label="コントラスト" value={fx.grade.contrast} min={0.5} max={1.5} step={0.02} onChange={(v) => grade({ contrast: v })} />
      <Slider label="明るさ" value={fx.grade.brightness} min={0.5} max={1.5} step={0.02} onChange={(v) => grade({ brightness: v })} />
      <Slider label="色温度（− 寒色 / + 暖色）" value={fx.grade.warmth} min={-1} max={1} step={0.05} onChange={(v) => grade({ warmth: v })} />
      <Slider label="周辺減光" value={fx.grade.vignette} min={0} max={1} step={0.05} onChange={(v) => grade({ vignette: v })} />
      <button type="button" onClick={() => grade(NEUTRAL_GRADE)}>
        色調を戻す
      </button>
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
