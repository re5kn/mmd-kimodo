import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadModelFromUpload, uploadModel, uploadMotion, type UploadFile } from './api/client';
import type { ModelDto } from './api/types';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { Viewport } from './components/Viewport';
import { filesFromDrop, filesFromInput, isMotionFile } from './files';
import { clipAt, newClipId, timelineEnd, type MotionClip } from './mmd/clips';
import { bindMotion, type BoundMotion } from './mmd/motion';
import type { MmdViewer, ViewerOptions } from './viewer/MmdViewer';

const FPS = 30;

export default function App() {
  const viewerRef = useRef<MmdViewer | null>(null);
  const [model, setModel] = useState<ModelDto | null>(null);
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  const [clips, setClips] = useState<MotionClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [options, setOptions] = useState<ViewerOptions>({ showGrid: true, showBones: false, showOutline: true, enableIk: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each clip is matched to the model by bone / morph names.
  const bounds = useMemo(() => {
    const m = new Map<string, BoundMotion>();
    if (model) for (const c of clips) m.set(c.id, bindMotion(model, c.motion));
    return m;
  }, [model, clips]);
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const maxFrame = timelineEnd(clips);

  // The clip under the current frame drives the pose (overlaps: the last added wins; blending comes later).
  const playingClip = clipAt(clips, frame);
  const playingBound = playingClip ? bounds.get(playingClip.id) ?? null : null;
  const localFrame = playingClip ? frame - playingClip.start : 0;

  const onReady = useCallback((v: MmdViewer | null) => {
    viewerRef.current = v;
  }, []);

  // Push state into the viewer.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (model) setMissingTextures(v.setModel(model).missingTextures);
  }, [model]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.setFrame(localFrame);
    v.setMotion(playingBound);
  }, [playingBound, localFrame, model]);
  useEffect(() => viewerRef.current?.setOptions(options), [options]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const loadModelFiles = async (files: UploadFile[]) => {
    if (files.length === 0) return;
    const hasModel = files.some((f) => /\.(pmx|zip)$/i.test(f.file.name));
    if (!hasModel) {
      setError('PMX ファイル（または ZIP）が含まれていません');
      return;
    }
    const m = await run('モデルを読み込み中…', () => uploadModel(files));
    if (m) setModel(m);
  };

  const loadMotionFile = async (file: File | null) => {
    if (!file) return;
    const mo = await run('モーションを読み込み中…', () => uploadMotion(file));
    if (mo) {
      setPlaying(false);
      // The loaded motion becomes one block on the motion layer, starting at the current frame.
      const clip: MotionClip = { id: newClipId(), name: mo.fileName.replace(/\.vmd$/i, ''), start: frame, motion: mo };
      setClips((cs) => [...cs, clip]);
      setSelectedClipId(clip.id);
    }
  };

  const deleteSelectedClip = () => {
    if (!selectedClipId) return;
    setPlaying(false);
    setClips((cs) => cs.filter((c) => c.id !== selectedClipId));
    setSelectedClipId(null);
  };

  const onDropFiles = async (dt: DataTransfer) => {
    const files = await filesFromDrop(dt);
    const vmd = files.find(isMotionFile);
    const rest = files.filter((f) => !isMotionFile(f));
    if (rest.length > 0) await loadModelFiles(rest);
    if (vmd) await loadMotionFile(vmd.file);
  };

  const setFrameClamped = useCallback(
    (f: number) => setFrame(Math.max(0, Math.round(f))),
    [],
  );

  // Playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * FPS;
      last = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setFrame((f) => {
          const next = f + step;
          if (next > maxFrame) {
            if (loop) return 0;
            setPlaying(false);
            return maxFrame;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, maxFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'range') return;
      if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setFrame((f) => Math.max(0, f - (e.shiftKey ? 10 : 1)));
      else if (e.key === 'ArrowRight') setFrame((f) => f + (e.shiftKey ? 10 : 1));
      else if (e.key === 'Home') setFrame(0);
      else if (e.key === 'End') setFrame(maxFrame);
      else if (e.key === ' ') {
        if (maxFrame > 0) setPlaying((p) => !p);
      } else if (e.key === 'Delete' && selectedClipId) deleteSelectedClip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app">
      <Sidebar
        model={model}
        missingTextures={missingTextures}
        clipCount={clips.length}
        selectedClip={selectedClip}
        selectedBound={selectedClip ? bounds.get(selectedClip.id) ?? null : null}
        options={options}
        busy={busy}
        error={error}
        onModelFiles={(list) => loadModelFiles(filesFromInput(list))}
        onModelFolder={(list) => loadModelFiles(filesFromInput(list))}
        onMotionFile={loadMotionFile}
        onSelectPmx={async (path) => {
          if (!model) return;
          const m = await run('モデルを読み込み中…', () => loadModelFromUpload(model.uploadId, path));
          if (m) setModel(m);
        }}
        onDeleteClip={deleteSelectedClip}
        onOptions={(o) => setOptions((prev) => ({ ...prev, ...o }))}
        onResetCamera={() => viewerRef.current?.resetCamera()}
      />
      <main className="main">
        <Viewport onReady={onReady} onDropFiles={onDropFiles} empty={!model} />
        <Timeline
          clips={clips}
          selectedClipId={selectedClipId}
          frame={frame}
          maxFrame={maxFrame}
          playing={playing}
          loop={loop}
          onFrame={setFrameClamped}
          onSelectClip={setSelectedClipId}
          onTogglePlay={() => setPlaying((p) => !p)}
          onLoopChange={setLoop}
        />
      </main>
    </div>
  );
}
