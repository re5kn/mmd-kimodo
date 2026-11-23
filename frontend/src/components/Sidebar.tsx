import { useRef } from 'react';
import type { ModelDto } from '../api/types';
import type { BoundMotion } from '../mmd/motion';
import type { ViewerOptions } from '../viewer/MmdViewer';
import { PhysicsSection } from './PhysicsSection';

interface Props {
  model: ModelDto | null;
  missingTextures: string[];
  motion: BoundMotion | null;
  motionLoaded: { fileName: string; modelName: string; maxFrame: number; boneFrameCount: number; morphFrameCount: number } | null;
  options: ViewerOptions;
  busy: string | null;
  error: string | null;
  onModelFiles: (files: FileList | null) => void;
  onModelFolder: (files: FileList | null) => void;
  onMotionFile: (file: File | null) => void;
  onSelectPmx: (path: string) => void;
  onClearMotion: () => void;
  onOptions: (opts: Partial<ViewerOptions>) => void;
  onResetCamera: () => void;
}

export function Sidebar(p: Props) {
  const modelInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const motionInput = useRef<HTMLInputElement>(null);
  const m = p.model;

  return (
    <aside className="sidebar">
      <h1 className="app-title">MMD Kimodo <span className="badge">prototype</span></h1>

      <section>
        <h2>モデル</h2>
        <button className="primary" onClick={() => modelInput.current?.click()} disabled={!!p.busy}>
          モデル読込（PMX / ZIP）
        </button>
        <button onClick={() => folderInput.current?.click()} disabled={!!p.busy}>
          フォルダから読込
        </button>
        <input
          ref={modelInput}
          type="file"
          accept=".pmx,.zip,.png,.jpg,.jpeg,.bmp,.tga,.gif,.spa,.sph,.dds"
          multiple
          hidden
          onChange={(e) => {
            p.onModelFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          // @ts-expect-error non-standard attribute for folder selection
          webkitdirectory=""
          onChange={(e) => {
            p.onModelFolder(e.target.files);
            e.target.value = '';
          }}
        />
        {m && m.pmxCandidates.length > 1 && (
          <label className="field">
            PMX を選択
            <select value={m.pmxPath} onChange={(e) => p.onSelectPmx(e.target.value)} disabled={!!p.busy}>
              {m.pmxCandidates.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        {m && (
          <dl className="info">
            <dt>名前</dt><dd title={m.comment}>{m.name || '(無名)'}</dd>
            <dt>ファイル</dt><dd>{m.pmxPath}</dd>
            <dt>頂点 / 面</dt><dd>{m.vertexCount.toLocaleString()} / {m.faceCount.toLocaleString()}</dd>
            <dt>材質</dt><dd>{m.materials.length}</dd>
            <dt>ボーン</dt><dd>{m.bones.length}（IK {m.bones.filter((b) => b.ik).length}）</dd>
            <dt>モーフ</dt><dd>{m.morphs.length}</dd>
            <dt>テクスチャ</dt>
            <dd>
              {m.textures.length - p.missingTextures.length} / {m.textures.length}
              {p.missingTextures.length > 0 && (
                <details>
                  <summary>見つからない {p.missingTextures.length} 件</summary>
                  <ul>{p.missingTextures.map((t) => <li key={t}>{t}</li>)}</ul>
                </details>
              )}
            </dd>
          </dl>
        )}
      </section>

      <section>
        <h2>モーション</h2>
        <button className="primary" onClick={() => motionInput.current?.click()} disabled={!!p.busy}>
          モーション読込（VMD）
        </button>
        <input
          ref={motionInput}
          type="file"
          accept=".vmd"
          hidden
          onChange={(e) => {
            p.onMotionFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        {p.motionLoaded && (
          <>
            <dl className="info">
              <dt>ファイル</dt><dd>{p.motionLoaded.fileName}</dd>
              <dt>対象モデル</dt><dd>{p.motionLoaded.modelName || '-'}</dd>
              <dt>最終フレーム</dt><dd>{p.motionLoaded.maxFrame}</dd>
              <dt>キー数</dt><dd>ボーン {p.motionLoaded.boneFrameCount.toLocaleString()} / モーフ {p.motionLoaded.morphFrameCount.toLocaleString()}</dd>
              {p.motion && (
                <>
                  <dt>適用ボーン</dt>
                  <dd>
                    {p.motion.matchedBoneCount} / {p.motion.motion.bones.length}
                    {p.motion.unmatchedBones.length > 0 && (
                      <details>
                        <summary>未対応 {p.motion.unmatchedBones.length} 件</summary>
                        <ul>{p.motion.unmatchedBones.map((b) => <li key={b}>{b}</li>)}</ul>
                      </details>
                    )}
                  </dd>
                  <dt>適用モーフ</dt>
                  <dd>
                    {p.motion.matchedMorphCount} / {p.motion.motion.morphs.length}
                    {p.motion.unmatchedMorphs.length > 0 && (
                      <details>
                        <summary>未対応 {p.motion.unmatchedMorphs.length} 件</summary>
                        <ul>{p.motion.unmatchedMorphs.map((b) => <li key={b}>{b}</li>)}</ul>
                      </details>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <button onClick={p.onClearMotion} disabled={!!p.busy}>モーションを外す</button>
          </>
        )}
      </section>

      <section>
        <h2>表示</h2>
        <label className="check">
          <input type="checkbox" checked={p.options.showGrid} onChange={(e) => p.onOptions({ showGrid: e.target.checked })} /> グリッド
        </label>
        <label className="check">
          <input type="checkbox" checked={p.options.showBones} onChange={(e) => p.onOptions({ showBones: e.target.checked })} /> ボーン
        </label>
        <label className="check">
          <input type="checkbox" checked={p.options.showOutline} onChange={(e) => p.onOptions({ showOutline: e.target.checked })} /> 輪郭線
        </label>
        <label className="check">
          <input type="checkbox" checked={p.options.enableIk} onChange={(e) => p.onOptions({ enableIk: e.target.checked })} /> IK
        </label>
        <button onClick={p.onResetCamera}>カメラリセット</button>
      </section>

      <PhysicsSection model={m} options={p.options} onOptions={p.onOptions} />

      <div className="status" role="status">
        {p.busy && <div className="busy">{p.busy}</div>}
        {p.error && <div className="error">{p.error}</div>}
      </div>

      <footer className="sidebar-footer">
        材質モーフ・カメラモーションは未対応
      </footer>
    </aside>
  );
}
