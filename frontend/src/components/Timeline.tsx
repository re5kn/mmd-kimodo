import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDto, MotionDto } from '../api/types';
import { clipAt, clipBoundaries, clipEnd, nextIn, prevIn, type MotionClip } from '../mmd/clips';

export interface TimelineRow {
  label: string;
  frames: number[];
  kind: 'all' | 'bone' | 'morph' | 'unmatched';
}

export interface BuildRowsOptions {
  /** Added to every key frame (the clip's start on the timeline). */
  offset?: number;
  /** Also list model bones / morphs that have no keys (for editing / creating). */
  includeEmpty?: boolean;
}

export function buildRows(model: ModelDto | null, motion: MotionDto | null, opts: BuildRowsOptions = {}): TimelineRow[] {
  if (!motion) return [];
  const off = opts.offset ?? 0;
  const keys = (frames: { f: number }[]) => frames.map((k) => k.f + off);
  const rows: TimelineRow[] = [];
  const all = new Set<number>();
  for (const t of motion.bones) for (const k of t.frames) all.add(k.f + off);
  for (const t of motion.morphs) for (const k of t.frames) all.add(k.f + off);
  rows.push({ label: '全体', frames: [...all].sort((a, b) => a - b), kind: 'all' });

  const boneTracks = new Map(motion.bones.map((t) => [t.name, t]));
  const used = new Set<string>();
  if (model) {
    for (const b of model.bones) {
      if (used.has(b.name)) continue;
      const t = boneTracks.get(b.name);
      if (t || opts.includeEmpty) {
        used.add(b.name);
        rows.push({ label: b.name, frames: t ? keys(t.frames) : [], kind: 'bone' });
      }
    }
  }
  for (const t of motion.bones) {
    if (!used.has(t.name)) rows.push({ label: t.name, frames: keys(t.frames), kind: model ? 'unmatched' : 'bone' });
  }
  const morphTracks = new Map(motion.morphs.map((t) => [t.name, t]));
  const usedMorphs = new Set<string>();
  if (model && opts.includeEmpty) {
    for (const m of model.morphs) {
      if (usedMorphs.has(m.name)) continue;
      usedMorphs.add(m.name);
      const t = morphTracks.get(m.name);
      rows.push({ label: m.name, frames: t ? keys(t.frames) : [], kind: 'morph' });
    }
  }
  const morphNames = new Set(model?.morphs.map((m) => m.name) ?? []);
  for (const t of motion.morphs) {
    if (usedMorphs.has(t.name)) continue;
    rows.push({
      label: t.name,
      frames: keys(t.frames),
      kind: model && !morphNames.has(t.name) ? 'unmatched' : 'morph',
    });
  }
  return rows;
}

export type TimelineMode = 'normal' | 'edit' | 'create';

interface Props {
  model: ModelDto | null;
  /** Clips on the motion layer. */
  clips: MotionClip[];
  selectedClipId: string | null;
  mode: TimelineMode;
  /** Clip being edited / draft being created; its key frames are listed below the motion layer. */
  activeClip: MotionClip | null;
  frame: number;
  maxFrame: number;
  playing: boolean;
  loop: boolean;
  onFrame: (frame: number) => void;
  onSelectClip: (id: string | null) => void;
  onTogglePlay: () => void;
  onLoopChange: (loop: boolean) => void;
}

const LABEL_W = 150;
const RULER_H = 22;
const LAYER_H = 28;
const ROW_H = 18;
const ROWS_Y = RULER_H + LAYER_H;

export function Timeline(p: Props) {
  const { model, clips, selectedClipId, mode, activeClip, frame, maxFrame, playing, loop, onFrame, onTogglePlay, onLoopChange } = p;
  const keyMode = mode !== 'normal' && activeClip !== null;
  const rows = useMemo(
    () => (keyMode ? buildRows(model, activeClip!.motion, { offset: activeClip!.start, includeEmpty: true }) : []),
    [keyMode, model, activeClip],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 150 });
  const [pxPerFrame, setPxPerFrame] = useState(8);
  const [scrollX, setScrollX] = useState(0); // in frames
  const [scrollY, setScrollY] = useState(0); // in rows
  const [frameText, setFrameText] = useState(String(frame));
  const dragging = useRef(false);

  useEffect(() => setFrameText(String(frame)), [frame]);
  useEffect(() => setScrollY(0), [mode, activeClip?.id]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleFrames = Math.max(1, Math.floor((size.w - LABEL_W) / pxPerFrame));
  const visibleRows = Math.max(1, Math.floor((size.h - ROWS_Y) / ROW_H));
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
    draw(ctx, {
      w: size.w,
      h: size.h,
      rows,
      clips,
      selectedClipId,
      mode,
      activeClip,
      frame,
      totalFrames,
      ppf: pxPerFrame,
      scrollX,
      scrollY,
    });
  }, [size, rows, clips, selectedClipId, mode, activeClip, frame, totalFrames, pxPerFrame, scrollX, scrollY]);

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

  // In normal mode the jump buttons move between clip boundaries, otherwise between key frames.
  const jumpKeys = keyMode ? rows[0]?.frames ?? [] : clipBoundaries(clips);
  const jumpLabel = keyMode ? 'キーフレーム' : 'モーションの端';

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button title="先頭へ (Home)" onClick={() => onFrame(0)}>⏮</button>
        <button title={`前の${jumpLabel}`} onClick={() => onFrame(prevIn(jumpKeys, frame))}>⇤</button>
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
        <button title={`次の${jumpLabel}`} onClick={() => onFrame(nextIn(jumpKeys, frame))}>⇥</button>
        <button title="末尾へ (End)" onClick={() => onFrame(maxFrame)}>⏭</button>
        <button className="play" title="再生 / 停止 (Space)" onClick={onTogglePlay} disabled={maxFrame <= 0}>
          {playing ? '⏸ 停止' : '▶ 再生'}
        </button>
        <label className="check">
          <input type="checkbox" checked={loop} onChange={(e) => onLoopChange(e.target.checked)} /> ループ
        </label>
        {mode !== 'normal' && <span className="mode-chip">{mode === 'edit' ? 'モーション編集中' : 'モーション作成中'}</span>}
        <span className="spacer" />
        <span className="muted">30 fps</span>
        <button title="縮小" onClick={() => setPxPerFrame((v) => Math.max(1, v / 1.5))}>－</button>
        <button title="拡大" onClick={() => setPxPerFrame((v) => Math.min(40, v * 1.5))}>＋</button>
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
            setPxPerFrame((v) => Math.min(40, Math.max(1, v * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
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
          data-testid="timeline-canvas"
          onPointerDown={(e) => {
            const rect = canvasRef.current!.getBoundingClientRect();
            if (e.clientX - rect.left < LABEL_W) return;
            const f = Math.max(0, frameAt(e.clientX));
            const y = e.clientY - rect.top;
            // Clicking the motion layer selects the clip under the pointer (or clears the selection).
            if (mode === 'normal' && y >= RULER_H && y < ROWS_Y) p.onSelectClip(clipAt(clips, f)?.id ?? null);
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            onFrame(f);
          }}
          onPointerMove={(e) => {
            if (dragging.current) onFrame(Math.max(0, frameAt(e.clientX)));
          }}
          onPointerUp={() => (dragging.current = false)}
        />
        {mode === 'normal' && clips.length === 0 && (
          <div className="timeline-empty">VMD を読み込むと、モーションレイヤーにモーションが追加されます</div>
        )}
        {mode === 'normal' && clips.length > 0 && (
          <div className="timeline-empty">モーションをクリックで選択し、左の「モーション編集」でキーフレームを表示します</div>
        )}
      </div>
    </div>
  );
}

interface DrawArgs {
  w: number;
  h: number;
  rows: TimelineRow[];
  clips: MotionClip[];
  selectedClipId: string | null;
  mode: TimelineMode;
  activeClip: MotionClip | null;
  frame: number;
  totalFrames: number;
  ppf: number;
  scrollX: number;
  scrollY: number;
}

function draw(ctx: CanvasRenderingContext2D, a: DrawArgs) {
  const { w, h, rows, clips, selectedClipId, mode, activeClip, frame, totalFrames, ppf, scrollX, scrollY } = a;
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
  const clipFill = c('--tl-clip', '#dbe6fd');
  const clipBorder = c('--tl-clip-border', '#2f6feb');
  const clipText = c('--tl-clip-text', '#1b3f8f');
  const clipSelFill = c('--tl-clip-selected', '#2f6feb');
  const clipSelText = c('--tl-clip-selected-text', '#ffffff');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const x0 = LABEL_W;
  const fx = (f: number) => x0 + (f - scrollX) * ppf + ppf / 2;
  const lastFrame = scrollX + (w - x0) / ppf;

  // Key frame rows (edit / create mode)
  const visible = Math.ceil((h - ROWS_Y) / ROW_H);
  for (let r = 0; r < visible; r++) {
    const ri = r + scrollY;
    const y = ROWS_Y + r * ROW_H;
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

  // Motion layer (always at the top, does not scroll vertically)
  ctx.fillStyle = bg;
  ctx.fillRect(0, RULER_H, w, LAYER_H);
  ctx.fillStyle = text;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('モーション', 6, RULER_H + LAYER_H / 2);
  ctx.font = '11px system-ui, sans-serif';

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, RULER_H, w - x0, LAYER_H);
  ctx.clip();
  const drawClip = (clip: MotionClip, style: 'normal' | 'selected' | 'dim' | 'draft') => {
    const left = fx(clip.start) - ppf / 2;
    const right = fx(clipEnd(clip)) + ppf / 2;
    if (right < x0 || left > w) return;
    const y = RULER_H + 3;
    const hh = LAYER_H - 6;
    ctx.globalAlpha = style === 'dim' ? 0.4 : 1;
    ctx.fillStyle = style === 'selected' ? clipSelFill : style === 'draft' ? bg : clipFill;
    roundRect(ctx, left + 0.5, y + 0.5, Math.max(right - left - 1, 2), hh - 1, 4);
    ctx.fill();
    ctx.strokeStyle = clipBorder;
    ctx.lineWidth = style === 'selected' ? 2 : 1;
    if (style === 'draft') ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.max(left, x0) + 4, y, Math.max(0, right - Math.max(left, x0) - 8), hh);
    ctx.clip();
    ctx.fillStyle = style === 'selected' ? clipSelText : clipText;
    ctx.fillText(clip.name, Math.max(left, x0) + 6, y + hh / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  };
  for (const clip of clips) {
    const isActive = activeClip?.id === clip.id;
    const style =
      mode === 'normal'
        ? clip.id === selectedClipId ? 'selected' : 'normal'
        : isActive ? 'selected' : 'dim';
    if (style !== 'selected') drawClip(clip, style);
  }
  // Draw the highlighted clip last so it stays on top of overlapping clips.
  const top = mode === 'normal' ? clips.find((cl) => cl.id === selectedClipId) : clips.find((cl) => cl.id === activeClip?.id);
  if (top) drawClip(top, 'selected');
  if (mode === 'create' && activeClip) drawClip(activeClip, 'draft');
  ctx.restore();

  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(0, ROWS_Y + 0.5);
  ctx.lineTo(w, ROWS_Y + 0.5);
  ctx.stroke();

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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
