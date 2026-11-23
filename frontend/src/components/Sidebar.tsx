import { useRef } from 'react';
import type { ModelDto } from '../api/types';
import { clipEnd, clipLength, type MotionClip } from '../mmd/clips';
import type { BoundMotion } from '../mmd/motion';
import type { ViewerOptions } from '../viewer/MmdViewer';

interface Props {
  model: ModelDto | null;
  missingTextures: string[];
  clipCount: number;
  /** Clip selected on the timeline's motion layer. */
  selectedClip: MotionClip | null;
  selectedBound: BoundMotion | null;
  /** Why "モーション作成" is unavailable, or null when it can be used. */
  createBlockedReason: string | null;
  options: ViewerOptions;
  busy: string | null;
  error: string | null;
  onModelFiles: (files: FileList | null) => void;
  onModelFolder: (files: FileList | null) => void;
  onMotionFile: (file: File | null) => void;
  onSelectPmx: (path: string) => void;
  onDeleteClip: () => void;
  onEditClip: () => void;
  onCreateMotion: () => void;
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
        <button onClick={p.onEditClip} disabled={!!p.busy || !p.selectedClip} title="タイムラインで選択中のモーションを編集">
          モーション編集
        </button>
        <button
          onClick={p.onCreateMotion}
          disabled={!!p.busy || !!p.createBlockedReason}
          title={p.createBlockedReason ?? '現在のフレームから新しいモーションを作成'}
        >
          モーション作成
        </button>
        {p.createBlockedReason && <p className="hint">作成: {p.createBlockedReason}</p>}
        {!p.selectedClip && (
          <p className="hint">
            {p.clipCount === 0
              ? 'VMD は現在のフレーム位置からモーションレイヤーに追加されます'
              : `モーションレイヤーに ${p.clipCount} 件。タイムラインでクリックして選択`}
          </p>
        )}
        {p.selectedClip && (
          <>
            <ClipInfo clip={p.selectedClip} bound={p.selectedBound} />
            <button onClick={p.onDeleteClip} disabled={!!p.busy} title="選択中のモーションをタイムラインから外す (Delete)">
              選択中のモーションを外す
            </button>
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

      <div className="status" role="status">
        {p.busy && <div className="busy">{p.busy}</div>}
        {p.error && <div className="error">{p.error}</div>}
      </div>

      <footer className="sidebar-footer">
        物理演算・材質モーフ・カメラモーションは未対応
      </footer>
    </aside>
  );
}

function ClipInfo({ clip, bound }: { clip: MotionClip; bound: BoundMotion | null }) {
  const mo = clip.motion;
  return (
    <dl className="info">
      <dt>名前</dt><dd>{clip.name}</dd>
      {mo.fileName && (<><dt>ファイル</dt><dd>{mo.fileName}</dd></>)}
      <dt>対象モデル</dt><dd>{mo.modelName || '-'}</dd>
      <dt>範囲</dt><dd>{clip.start} – {clipEnd(clip)}（{clipLength(clip)} フレーム）</dd>
      <dt>キー数</dt><dd>ボーン {mo.boneFrameCount.toLocaleString()} / モーフ {mo.morphFrameCount.toLocaleString()}</dd>
      {bound && (
        <>
          <dt>適用ボーン</dt>
          <dd>
            {bound.matchedBoneCount} / {mo.bones.length}
            {bound.unmatchedBones.length > 0 && (
              <details>
                <summary>未対応 {bound.unmatchedBones.length} 件</summary>
                <ul>{bound.unmatchedBones.map((b) => <li key={b}>{b}</li>)}</ul>
              </details>
            )}
          </dd>
          <dt>適用モーフ</dt>
          <dd>
            {bound.matchedMorphCount} / {mo.morphs.length}
            {bound.unmatchedMorphs.length > 0 && (
              <details>
                <summary>未対応 {bound.unmatchedMorphs.length} 件</summary>
                <ul>{bound.unmatchedMorphs.map((b) => <li key={b}>{b}</li>)}</ul>
              </details>
            )}
          </dd>
        </>
      )}
    </dl>
  );
}
