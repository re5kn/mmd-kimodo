import * as THREE from 'three';
import { presetLighting } from '../viewer/displayPresets';
import { LIGHTING_PRESETS, lightingPreset, type LightingSettings } from '../viewer/lighting';
import type { ViewerOptions } from '../viewer/MmdViewer';

interface Props {
  options: ViewerOptions;
  onOptions: (opts: Partial<ViewerOptions>) => void;
}

/** Sidebar section (Issue #11 C1): light direction, color and presets. */
export function LightingSection({ options, onOptions }: Props) {
  const autoFrom = new THREE.Vector3(...presetLighting(options.displayPreset).lightFrom);
  const lighting = options.lighting;
  // 'auto' shows the display preset's own light, so sliders start from what is on screen.
  const shown = lighting.preset === 'auto' ? lightingPreset('auto', autoFrom) : lighting;
  const edit = (patch: Partial<LightingSettings>) => onOptions({ lighting: { ...shown, ...patch, preset: null } });
  const gray = Math.round(new THREE.Color().setStyle(shown.color, THREE.NoColorSpace).r * 255);
  const isGray = shown.color.slice(1, 3) === shown.color.slice(3, 5) && shown.color.slice(3, 5) === shown.color.slice(5, 7);

  return (
    <section>
      <h2>照明</h2>
      <div className="segmented" role="radiogroup" aria-label="照明プリセット">
        {LIGHTING_PRESETS.map((pr) => (
          <button
            key={pr.kind}
            role="radio"
            aria-checked={lighting.preset === pr.kind}
            className={lighting.preset === pr.kind ? 'active' : undefined}
            title={pr.description}
            onClick={() => onOptions({ lighting: pr.kind === 'auto' ? { ...lighting, preset: 'auto' } : lightingPreset(pr.kind, autoFrom) })}
          >
            {pr.label}
          </button>
        ))}
      </div>
      <label className="field">
        向き（{Math.round(shown.azimuth)}°、0 = 正面、+ = 画面右）
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={shown.azimuth}
          onChange={(e) => edit({ azimuth: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        高さ（{Math.round(shown.elevation)}°、90 = 真上）
        <input
          type="range"
          min={-10}
          max={90}
          step={1}
          value={shown.elevation}
          onChange={(e) => edit({ elevation: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        色（{isGray ? `${gray}、MMD 初期値は 154` : shown.color}）
        <input type="color" value={shown.color} onChange={(e) => edit({ color: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={shown.threePoint} onChange={(e) => edit({ threePoint: e.target.checked })} /> 補助光と輪郭光
      </label>
      {options.displayPreset === 'mmd' && shown.threePoint && <p className="hint">MMD 風は主光源だけで陰影を付けます（補助光は他の表示用）</p>}
    </section>
  );
}
