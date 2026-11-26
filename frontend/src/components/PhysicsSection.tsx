import { useSyncExternalStore } from 'react';
import type { ModelDto } from '../api/types';
import { PHYSICS_ENGINES, type PhysicsEngineKind } from '../physics';
import type { ViewerOptions } from '../viewer/MmdViewer';
import { physicsStatusStore } from '../viewer/physicsStatus';

interface Props {
  model: ModelDto | null;
  options: ViewerOptions;
  onOptions: (opts: Partial<ViewerOptions>) => void;
}

/** Sidebar section: physics on/off, engine selection and status. */
export function PhysicsSection({ model, options, onOptions }: Props) {
  const status = useSyncExternalStore(physicsStatusStore.subscribe, physicsStatusStore.get);
  const bodies = model?.rigidBodies?.length ?? 0;
  const joints = model?.joints?.length ?? 0;

  let message: string | null = null;
  if (options.enablePhysics) {
    if (status.state === 'loading') message = '物理エンジンを読み込み中…';
    else if (status.state === 'error') message = `物理エンジンを使えません: ${status.message ?? ''}`;
    else if (model && bodies === 0) message = 'このモデルには剛体がありません';
  }

  return (
    <section>
      <h2>物理演算</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={options.enablePhysics}
          onChange={(e) => onOptions({ enablePhysics: e.target.checked })}
        />{' '}
        物理演算
      </label>
      <label className="field">
        エンジン
        <select
          value={options.physicsEngine}
          onChange={(e) => onOptions({ physicsEngine: e.target.value as PhysicsEngineKind })}
        >
          {PHYSICS_ENGINES.map((en) => (
            <option key={en.kind} value={en.kind} disabled={!en.available}>
              {en.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={options.showRigidBodies}
          onChange={(e) => onOptions({ showRigidBodies: e.target.checked })}
        />{' '}
        剛体を表示
      </label>
      <label className="check" title="モデルが動いていない間は物理演算を止めて、揺れ物の微動をなくす">
        <input
          type="checkbox"
          checked={options.freezePhysicsWhenStill}
          disabled={!options.enablePhysics}
          onChange={(e) => onOptions({ freezePhysicsWhenStill: e.target.checked })}
        />{' '}
        静止中は止める
      </label>
      <button onClick={physicsStatusStore.requestReset} title="現在の姿勢から物理演算をやり直す" disabled={!options.enablePhysics || bodies === 0}>
        物理リセット
      </button>
      {model && (
        <dl className="info">
          <dt>剛体 / ジョイント</dt>
          <dd>{bodies} / {joints}</dd>
          {options.enablePhysics && options.freezePhysicsWhenStill && (
            <>
              <dt>状態</dt>
              <dd>{status.frozen ? '静止中（停止）' : '計算中'}</dd>
            </>
          )}
        </dl>
      )}
      {message && <p className={status.state === 'error' ? 'physics-note error' : 'physics-note'}>{message}</p>}
    </section>
  );
}
