import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDto, MotionDto } from '../api/types';

export interface TimelineRow {
  label: string;
  frames: number[];
  kind: 'all' | 'bone' | 'morph' | 'unmatched';
}

export function buildRows(model: ModelDto | null, motion: MotionDto | null): TimelineRow[] {
  if (!motion) return [];
  const rows: TimelineRow[] = [];
  const all = new Set<number>();
  for (const t of motion.bones) for (const k of t.frames) all.add(k.f);
  for (const t of motion.morphs) for (const k of t.frames) all.add(k.f);
  rows.push({ label: '全体', frames: [...all].sort((a, b) => a - b), kind: 'all' });

  const boneTracks = new Map(motion.bones.map((t) => [t.name, t]));
  const used = new Set<string>();
  if (model) {
    for (const b of model.bones) {
      const t = boneTracks.get(b.name);
      if (t && !used.has(b.name)) {
        used.add(b.name);
        rows.push({ label: b.name, frames: t.frames.map((k) => k.f), kind: 'bone' });
      }
    }
  }
  for (const t of motion.bones) {
    if (!used.has(t.name)) rows.push({ label: t.name, frames: t.frames.map((k) => k.f), kind: model ? 'unmatched' : 'bone' });
  }
  const morphNames = new Set(model?.morphs.map((m) => m.name) ?? []);
  for (const t of motion.morphs) {
    rows.push({
      label: t.name,
      frames: t.frames.map((k) => k.f),
      kind: model && !morphNames.has(t.name) ? 'unmatched' : 'morph',
    });
  }
  return rows;
}

interface Props {
  model: ModelDto | null;
  motion: MotionDto | null;
  frame: number;
  maxFrame: number;
  playing: boolean;
  loop: boolean;
  onFrame: (frame: number) => void;
  onTogglePlay: () => void;
  onLoopChange: (loop: boolean) => void;
}

const LABEL_W = 150;
const RULER_H = 22;
const ROW_H = 18;

export function Timeline({ model, motion, frame, maxFrame, playing, loop, onFrame, onTogglePlay, onLoopChange }: Props) {
  const rows = useMemo(() => buildRows(model, motion), [model, motion]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 150 });
  const [pxPerFrame, setPxPerFrame] = useState(8);
  const [scrollX, setScrollX] = useState(0); // in frames
  const [scrollY, setScrollY] = useState(0); // in rows
  const [frameText, setFrameText] = useState(String(frame));
  const dragging = useRef(false);

  useEffect(() => setFrameText(String(frame)), [frame]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleFrames = Math.max(1, Math.floor((size.w - LABEL_W) / pxPerFrame));
  const visibleRows = Math.max(1, Math.floor((size.h - RULER_H) / ROW_H));
  const totalFrames = Math.max(maxFrame, 0) + 1;

  // Keep the current frame in view.
  useEffect(() => {
    if (frame < scrollX) setScrollX(Math.max(0, frame - 2));
    else if (frame >= scrollX + visibleFrames - 1) setScrollX(Math.max(0, frame - visibleFrames + 3));
  }, [frame, scrollX, visibleFrames]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, rows, frame, totalFrames, pxPerFrame, scrollX, scrollY);
  }, [size, rows, frame, totalFrames, pxPerFrame, scrollX, scrollY]);

  const frameAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_W;
    return Math.round(scrollX + x / pxPerFrame - 0.5);
  };

  const commitFrameText = () => {
    const v = parseInt(frameText, 10);
    if (Number.isFinite(v)) onFrame(Math.max(0, v));
    else setFrameText(String(frame));
  };

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button title="先頭へ (Home)" onClick={() => onFrame(0)}>⏮</button>
        <button title="前のキーフレーム" onClick={() => onFrame(prevKey(rows, frame))}>⇤</button>
        <button title="1フレーム戻る (←)" onClick={() => onFrame(Math.max(0, frame - 1))}>◀</button>
        <input
          className="frame-input"
          value={frameText}
          onChange={(e) => setFrameText(e.target.value)}
          onBlur={commitFrameText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitFrameText();
          }}
          aria-label="現在フレーム"
        />
        <span className="frame-total">/ {maxFrame}</span>
        <button title="1フレーム進む (→)" onClick={() => onFrame(frame + 1)}>▶</button>
        <button title="次のキーフレーム" onClick={() => onFrame(nextKey(rows, frame))}>⇥</button>
        <button title="末尾へ (End)" onClick={() => onFrame(maxFrame)}>⏭</button>
        <button className="play" title="再生 / 停止 (Space)" onClick={onTogglePlay} disabled={maxFrame <= 0}>
          {playing ? '⏸ 停止' : '▶ 再生'}
        </button>
        <label className="check">
          <input type="checkbox" checked={loop} onChange={(e) => onLoopChange(e.target.checked)} /> ループ
        </label>
        <span className="spacer" />
        <span className="muted">30 fps</span>
        <button title="縮小" onClick={() => setPxPerFrame((p) => Math.max(1, p / 1.5))}>－</button>
        <button title="拡大" onClick={() => setPxPerFrame((p) => Math.min(40, p * 1.5))}>＋</button>
      </div>
      <input
        className="frame-slider"
        type="range"
        min={0}
        max={Math.max(maxFrame, 0)}
        value={Math.min(frame, Math.max(maxFrame, 0))}
        onChange={(e) => onFrame(parseInt(e.target.value, 10))}
        aria-label="フレーム"
      />
      <div
        ref={wrapRef}
        className="timeline-canvas"
        onWheel={(e) => {
          if (e.ctrlKey) {
            setPxPerFrame((p) => Math.min(40, Math.max(1, p * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
          } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const d = (e.shiftKey ? e.deltaY : e.deltaX) / pxPerFrame;
            setScrollX((s) => Math.max(0, Math.min(totalFrames, s + d)));
          } else {
            const d = Math.sign(e.deltaY) * 2;
            setScrollY((s) => Math.max(0, Math.min(Math.max(0, rows.length - visibleRows), s + d)));
          }
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            const rect = canvasRef.current!.getBoundingClientRect();
            if (e.clientX - rect.left < LABEL_W) return;
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            onFrame(Math.max(0, frameAt(e.clientX)));
          }}
          onPointerMove={(e) => {
            if (dragging.current) onFrame(Math.max(0, frameAt(e.clientX)));
          }}
          onPointerUp={() => (dragging.current = false)}
        />
        {rows.length === 0 && <div className="timeline-empty">VMD を読み込むとキーフレームが表示されます</div>}
      </div>
    </div>
  );
}

function prevKey(rows: TimelineRow[], frame: number): number {
  const keys = rows[0]?.frames ?? [];
  let best = 0;
  for (const f of keys) if (f < frame) best = f;
  return best;
}

function nextKey(rows: TimelineRow[], frame: number): number {
  const keys = rows[0]?.frames ?? [];
  for (const f of keys) if (f > frame) return f;
  return frame;
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rows: TimelineRow[],
  frame: number,
  totalFrames: number,
  ppf: number,
  scrollX: number,
  scrollY: number,
) {
  const css = getComputedStyle(document.documentElement);
  const c = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = c('--tl-bg', '#ffffff');
  const alt = c('--tl-alt', '#f6f7f9');
  const line = c('--tl-line', '#e1e4e8');
  const text = c('--tl-text', '#24292f');
  const muted = c('--tl-muted', '#8c959f');
  const keyColor = c('--tl-key', '#2f6feb');
  const morphColor = c('--tl-morph', '#bf3989');
  const cursor = c('--tl-cursor', '#e5534b');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const x0 = LABEL_W;
  const fx = (f: number) => x0 + (f - scrollX) * ppf + ppf / 2;
  const lastFrame = scrollX + (w - x0) / ppf;

  // Rows
  const visible = Math.ceil((h - RULER_H) / ROW_H);
  for (let r = 0; r < visible; r++) {
    const ri = r + scrollY;
    const y = RULER_H + r * ROW_H;
    if (ri % 2 === 1) {
      ctx.fillStyle = alt;
      ctx.fillRect(0, y, w, ROW_H);
    }
    const row = rows[ri];
    if (!row) continue;
    ctx.fillStyle = row.kind === 'unmatched' ? muted : text;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, x0 - 6, ROW_H);
    ctx.clip();
    const prefix = row.kind === 'morph' ? '◇ ' : row.kind === 'all' ? '' : '  ';
    ctx.fillText(prefix + row.label + (row.kind === 'unmatched' ? '（未対応）' : ''), 6, y + ROW_H / 2);
    ctx.restore();

    ctx.fillStyle = row.kind === 'morph' ? morphColor : row.kind === 'unmatched' ? muted : keyColor;
    const s = Math.min(5, Math.max(2.5, ppf / 2.5));
    for (const f of row.frames) {
      if (f < scrollX - 1 || f > lastFrame + 1) continue;
      const x = fx(f);
      const cy = y + ROW_H / 2;
      ctx.beginPath();
      ctx.moveTo(x, cy - s);
      ctx.lineTo(x + s, cy);
      ctx.lineTo(x, cy + s);
      ctx.lineTo(x - s, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Ruler
  ctx.fillStyle = alt;
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + 0.5);
  ctx.lineTo(w, RULER_H + 0.5);
  ctx.moveTo(x0 - 0.5, 0);
  ctx.lineTo(x0 - 0.5, h);
  ctx.stroke();

  const step = ppf >= 12 ? 5 : ppf >= 4 ? 10 : ppf >= 2 ? 30 : 60;
  ctx.fillStyle = muted;
  for (let f = Math.floor(scrollX / step) * step; f <= lastFrame; f += step) {
    if (f < scrollX) continue;
    const x = fx(f);
    ctx.fillRect(Math.round(x), RULER_H - 6, 1, 6);
    ctx.fillText(String(f), x + 3, RULER_H / 2 - 1);
  }
  if (totalFrames > 0 && totalFrames - 1 <= lastFrame) {
    // end marker
    ctx.fillStyle = line;
    ctx.fillRect(Math.round(fx(totalFrames - 1) + ppf / 2), RULER_H, 1, h - RULER_H);
  }

  ctx.fillStyle = text;
  ctx.fillText('フレーム', 6, RULER_H / 2);

  // Cursor
  if (frame >= scrollX && frame <= lastFrame) {
    const x = Math.round(fx(frame));
    ctx.fillStyle = cursor;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x - ppf / 2, RULER_H, Math.max(ppf, 1), h - RULER_H);
    ctx.globalAlpha = 1;
    ctx.fillRect(x, 0, 1.5, h);
  }
}
