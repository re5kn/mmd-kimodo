import { useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { DISPLAY_PRESETS, presetLighting } from '../viewer/displayPresets';
import { lightingSnippet, lightingTunerStore, tunedPresetLighting, type TunableLighting } from '../viewer/lightingTuner';
import type { ViewerOptions } from '../viewer/MmdViewer';

/**
 * Temporary sidebar section: hand-tunes the current display preset's
 * lighting. Remove with lightingTuner.ts once the values are settled.
 */
const TONE_MAPPINGS: { value: THREE.ToneMapping; label: string }[] = [
  { value: THREE.NoToneMapping, label: 'なし' },
  { value: THREE.NeutralToneMapping, label: 'Neutral' },
  { value: THREE.ACESFilmicToneMapping, label: 'ACES Filmic' },
  { value: THREE.AgXToneMapping, label: 'AgX' },
  { value: THREE.ReinhardToneMapping, label: 'Reinhard' },
];

const SLIDERS: { key: 'hemisphere' | 'directional' | 'environment' | 'exposure'; label: string; max: number }[] = [
  { key: 'directional', label: '主光源（平行光）の強さ', max: 5 },
  { key: 'hemisphere', label: '半球光（空と地面の光）の強さ', max: 3 },
  { key: 'environment', label: '環境光（部屋の映り込み）の強さ', max: 2 },
  { key: 'exposure', label: '露出', max: 2 },
];

const toHex = (v: number) => `#${v.toString(16).padStart(6, '0')}`;

export function LightingTunerSection({ options }: { options: ViewerOptions }) {
  const overrides = useSyncExternalStore(lightingTunerStore.subscribe, lightingTunerStore.get);
  const compare = useSyncExternalStore(lightingTunerStore.subscribe, lightingTunerStore.getCompare);
  const [copied, setCopied] = useState(false);
  const preset = options.displayPreset;
  const label = DISPLAY_PRESETS.find((d) => d.kind === preset)?.label ?? preset;
  const l = tunedPresetLighting(preset);
  const base = presetLighting(preset);
  const edited = !!overrides[preset] && Object.keys(overrides[preset]!).length > 0;
  const set = (patch: Partial<TunableLighting>) => {
    setCopied(false);
    lightingTunerStore.set(preset, patch);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lightingSnippet(preset));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <h2>照明の調整（{label}）</h2>
      <p className="hint">調整用の一時的なパネルです。値はこのブラウザに保存されます</p>
      <label className="check">
        <input type="checkbox" checked={compare} onChange={(e) => lightingTunerStore.setCompare(e.target.checked)} />
        左右で比較（左: 補正なし、右: 補正あり。値を変えたときに表示）
      </label>
      {preset === 'flat' && <p className="hint">フラットは光の影響を受けません</p>}
      {preset === 'mmd' && <p className="hint">MMD 風は MMD の式で色を決めるため、主に影と床にだけ効きます</p>}
      {SLIDERS.map((s) => (
        <label key={s.key} className="field">
          {s.label}（{l[s.key].toFixed(2)}
          {l[s.key] !== base[s.key] && `、既定 ${base[s.key]}`}）
          <input type="range" min={0} max={s.max} step={0.05} value={l[s.key]} onChange={(e) => set({ [s.key]: Number(e.target.value) })} />
        </label>
      ))}
      <label className="field">
        空の色
        <input type="color" value={toHex(l.skyColor)} onChange={(e) => set({ skyColor: parseInt(e.target.value.slice(1), 16) })} />
      </label>
      <label className="field">
        地面の色
        <input type="color" value={toHex(l.groundColor)} onChange={(e) => set({ groundColor: parseInt(e.target.value.slice(1), 16) })} />
      </label>
      <label className="field">
        トーンマップ（ポストエフェクトで「表示に合わせる」のとき有効）
        <select value={l.toneMapping} onChange={(e) => set({ toneMapping: Number(e.target.value) as THREE.ToneMapping })}>
          {TONE_MAPPINGS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={copy}>
        {copied ? 'コピーしました' : '値をコピー'}
      </button>
      <button type="button" disabled={!edited} onClick={() => lightingTunerStore.reset(preset)}>
        既定に戻す
      </button>
      <textarea readOnly rows={5} value={lightingSnippet(preset)} aria-label="現在の値" style={{ width: '100%', boxSizing: 'border-box', font: '11px monospace' }} />
    </section>
  );
}
