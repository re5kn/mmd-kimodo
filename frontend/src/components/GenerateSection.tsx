import { useCallback, useEffect, useRef, useState } from 'react';
import { generateMotion, getKimodoStatus, translatePrompt, type KeyReduce } from '../api/client';
import type { KimodoStatusDto, ModelDto, MotionDto } from '../api/types';

// Kimodo demo defaults (kimodo/demo/config.py).
export const DEFAULT_PROMPT = 'A person walks forward.';
export const DEFAULT_DURATION = 6.0;
const FPS = 30;

const REDUCE_OPTIONS: { value: KeyReduce; label: string }[] = [
  { value: 'none', label: 'なし（毎フレーム）' },
  { value: 'low', label: '弱（0.5° / 0.02）' },
  { value: 'normal', label: '標準（1° / 0.05）' },
  { value: 'high', label: '強（2° / 0.1）' },
];

interface Props {
  model: ModelDto;
  /** Motion frame the generated motion starts at, or null when generation is not possible here. */
  at: number | null;
  /** Why generation is unavailable at the current frame. */
  blockedReason: string | null;
  replacing: boolean;
  onGenerated: (motion: MotionDto, prompt: string, at: number) => void;
}

const STATUS_LABEL: Record<string, string> = {
  ready: '準備完了',
  loading: 'モデル読み込み中',
  error: 'エラー',
  unreachable: '接続できません',
  unconfigured: '未設定',
};

/** "Kimodo で生成" section of the motion editor: prompt + length -> generated motion at the current frame. */
export function GenerateSection({ model, at, blockedReason, replacing, onGenerated }: Props) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [reduce, setReduce] = useState<KeyReduce>('normal');
  const [japanese, setJapanese] = useState('');
  const [translating, setTranslating] = useState(false);
  const [status, setStatus] = useState<KimodoStatusDto | null>(null);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const min = status?.minDuration ?? 2;
  const max = status?.maxDuration ?? 10;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await getKimodoStatus(signal));
    } catch (e) {
      if (!signal?.aborted) setStatus({ status: 'unreachable', model: null, error: e instanceof Error ? e.message : String(e), ready: false, translation: false, minDuration: 2, maxDuration: 10 });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  // Poll while the model is loading.
  useEffect(() => {
    if (status?.status !== 'loading') return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [status?.status, refresh]);

  // Cancel a running request when the editor closes.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!generating) return;
    const t0 = performance.now();
    const t = setInterval(() => setElapsed((performance.now() - t0) / 1000), 250);
    return () => clearInterval(t);
  }, [generating]);

  const trimmed = prompt.trim();
  const durationOk = Number.isFinite(duration) && duration >= min && duration <= max;
  const disabledReason = generating
    ? null
    : !status?.ready
      ? 'Kimodo サーバーの準備ができていません'
      : blockedReason
        ? blockedReason
        : !trimmed
          ? 'プロンプトを入力してください'
          : !durationOk
            ? `長さは ${min}〜${max} 秒です`
            : null;

  const generate = async () => {
    if (disabledReason || at === null) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setGenerating(true);
    setElapsed(0);
    setError(null);
    try {
      const mo = await generateMotion({ uploadId: model.uploadId, pmxPath: model.pmxPath, prompt: trimmed, duration, reduce }, ac.signal);
      if (mountedRef.current && !ac.signal.aborted) onGenerated(mo, trimmed, at);
    } catch (e) {
      if (mountedRef.current) {
        setError(ac.signal.aborted ? '生成をキャンセルしました' : e instanceof Error ? e.message : String(e));
        if (!ac.signal.aborted) void refresh();
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      if (mountedRef.current) setGenerating(false);
    }
  };

  const translate = async () => {
    const text = japanese.trim();
    if (!text || translating) return;
    setTranslating(true);
    setError(null);
    try {
      const r = await translatePrompt(text);
      if (mountedRef.current) setPrompt(r.prompt);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setTranslating(false);
    }
  };

  const frames = Math.round((durationOk ? duration : DEFAULT_DURATION) * FPS);

  return (
    <section aria-label="Kimodo で生成">
      <h2>KIMODO で生成</h2>
      <div className="kimodo-status">
        <span className={`kimodo-dot ${status?.status ?? 'unknown'}`} aria-hidden />
        <span>{status ? STATUS_LABEL[status.status] ?? status.status : '確認中…'}</span>
        {status?.model && <span className="muted">{status.model}</span>}
        <button className="link" onClick={() => void refresh()} disabled={generating} title="状態を再確認">
          更新
        </button>
      </div>
      {status && !status.ready && status.error && <p className="hint">{status.error}</p>}

      {status?.translation && (
        <label className="field">
          日本語で入力（任意）
          <textarea
            className="prompt-input"
            rows={2}
            value={japanese}
            maxLength={1000}
            disabled={generating || translating}
            placeholder="例: 右手を振りながら前に歩く"
            onChange={(e) => setJapanese(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void translate();
              }
            }}
          />
          <button onClick={() => void translate()} disabled={generating || translating || !japanese.trim()} title="Ctrl+Enter">
            {translating ? '翻訳中…' : '英語に翻訳 ↓'}
          </button>
        </label>
      )}

      <label className="field">
        プロンプト（英語）
        <textarea
          className="prompt-input"
          rows={3}
          value={prompt}
          maxLength={1000}
          disabled={generating || translating}
          placeholder={DEFAULT_PROMPT}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void generate();
            }
          }}
        />
      </label>
      <label className="field">
        長さ（秒）
        <span className="duration-row">
          <input
            type="number"
            className="duration-input"
            min={min}
            max={max}
            step={0.5}
            value={Number.isFinite(duration) ? duration : ''}
            disabled={generating}
            onChange={(e) => setDuration(e.target.valueAsNumber)}
          />
          <span className="muted">{frames} フレーム（{min}〜{max} 秒）</span>
        </span>
      </label>

      <label className="field" title="線形補間で再現できるキーを除きます（回転の誤差 / 移動の誤差）">
        キーフレームの間引き
        <select value={reduce} disabled={generating} onChange={(e) => setReduce(e.target.value as KeyReduce)}>
          {REDUCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <button className="primary" onClick={() => void generate()} disabled={generating || translating || !!disabledReason} title="Ctrl+Enter">
        {generating ? `生成中… ${elapsed.toFixed(0)} 秒` : '生成'}
      </button>
      {generating ? (
        <button onClick={() => abortRef.current?.abort()}>キャンセル</button>
      ) : disabledReason ? (
        <p className="hint">{disabledReason}</p>
      ) : (
        <p className="hint">
          {replacing
            ? `モーション内フレーム ${at} から ${frames} フレームを生成結果で置き換えます（生成したボーンのみ）。`
            : `モーション内フレーム ${at} から ${frames} フレームを生成します。`}
          その他の設定は Kimodo デモの既定値です。
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
