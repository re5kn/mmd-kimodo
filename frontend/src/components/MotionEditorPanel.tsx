import { clipEnd, clipLength, type MotionClip } from '../mmd/clips';

interface Props {
  clip: MotionClip;
  frame: number;
  onClose: () => void;
}

/**
 * The left panel while a motion is being edited. The model / motion loading
 * buttons are hidden while it is shown.
 * Changing positions and rotations is not implemented yet.
 */
export function MotionEditorPanel({ clip, frame, onClose }: Props) {
  const local = frame - clip.start;
  const inside = frame >= clip.start && frame <= clipEnd(clip);
  const mo = clip.motion;

  return (
    <aside className="sidebar editor" aria-label="モーション編集">
      <h1 className="app-title">
        モーション編集 <span className="badge editor-badge">編集中</span>
      </h1>

      <section>
        <h2>対象</h2>
        <dl className="info">
          <dt>名前</dt><dd>{clip.name}</dd>
          <dt>開始</dt><dd>{clip.start}</dd>
          <dt>範囲</dt><dd>{clip.start} – {clipEnd(clip)}（{clipLength(clip)} フレーム）</dd>
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
          編集を終了
        </button>
      </div>
    </aside>
  );
}
