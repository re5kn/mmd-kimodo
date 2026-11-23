import { clipEnd, clipLength, type MotionClip } from '../mmd/clips';

export type EditorKind = 'edit' | 'create';

interface Props {
  kind: EditorKind;
  clip: MotionClip;
  frame: number;
  onClose: () => void;
}

/**
 * The left panel while a motion is being edited or created. Both modes share
 * this layout; the model / motion loading buttons are hidden while it is shown.
 * Changing positions and rotations is not implemented yet.
 */
export function MotionEditorPanel({ kind, clip, frame, onClose }: Props) {
  const title = kind === 'edit' ? 'モーション編集' : 'モーション作成';
  const local = frame - clip.start;
  const inside = frame >= clip.start && (kind === 'create' || frame <= clipEnd(clip));
  const mo = clip.motion;

  return (
    <aside className="sidebar editor" aria-label={title}>
      <h1 className="app-title">
        {title} <span className="badge editor-badge">{kind === 'edit' ? '編集中' : '作成中'}</span>
      </h1>

      <section>
        <h2>対象</h2>
        <dl className="info">
          <dt>名前</dt><dd>{clip.name}</dd>
          <dt>開始</dt><dd>{clip.start}</dd>
          {kind === 'edit' && (<><dt>範囲</dt><dd>{clip.start} – {clipEnd(clip)}（{clipLength(clip)} フレーム）</dd></>)}
          <dt>キー数</dt><dd>ボーン {mo.boneFrameCount.toLocaleString()} / モーフ {mo.morphFrameCount.toLocaleString()}</dd>
          <dt>現在</dt>
          <dd>
            フレーム {frame}
            {inside ? `（モーション内 ${local}）` : '（モーション外）'}
          </dd>
        </dl>
      </section>

      <section>
        <h2>キーフレーム</h2>
        <p className="hint">位置・回転の変更は今後追加予定です。タイムラインでキーフレームを確認できます。</p>
      </section>

      <div className="editor-actions">
        <button className="primary" onClick={onClose} title="Esc">
          {kind === 'edit' ? '編集を終了' : '作成を終了'}
        </button>
        {kind === 'create' && mo.boneFrameCount + mo.morphFrameCount === 0 && (
          <p className="hint">キーフレームがないまま終了すると、作成中のモーションは破棄されます。</p>
        )}
      </div>
    </aside>
  );
}
