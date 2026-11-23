import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadModelFromUpload, uploadModel, uploadMotion, type UploadFile } from './api/client';
import type { ModelDto, MotionDto } from './api/types';
import { MotionEditorPanel } from './components/MotionEditorPanel';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { Viewport } from './components/Viewport';
import { filesFromDrop, filesFromInput, isMotionFile } from './files';
import { clipAt, clipContains, clipEnd, emptyMotion, newClipId, timelineEnd, type MotionClip } from './mmd/clips';
import { bindMotion, type BoundMotion } from './mmd/motion';
import { spliceMotion } from './mmd/splice';
import type { MmdViewer, ViewerOptions } from './viewer/MmdViewer';

const FPS = 30;
const NEW_MOTION_NAME = '新規モーション';

/** Clip name for a generated motion: the prompt, shortened. */
function clipNameFromPrompt(prompt: string): string {
  const p = prompt.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  return p.length > 40 ? `${p.slice(0, 39)}…` : p;
}

/** normal: model / motion loading etc. edit / create: the left panel is dedicated to the motion editor. */
type Mode = { kind: 'normal' } | { kind: 'edit'; clipId: string } | { kind: 'create'; draft: MotionClip };

export default function App() {
  const viewerRef = useRef<MmdViewer | null>(null);
  const [model, setModel] = useState<ModelDto | null>(null);
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  const [clips, setClips] = useState<MotionClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [options, setOptions] = useState<ViewerOptions>({
    showGrid: true, showBones: false, showOutline: true, enableIk: true,
    enablePhysics: true, physicsEngine: 'ammo', showRigidBodies: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each clip is matched to the model by bone / morph names.
  const bounds = useMemo(() => {
    const m = new Map<string, BoundMotion>();
    if (model) for (const c of clips) m.set(c.id, bindMotion(model, c.motion));
    return m;
  }, [model, clips]);
  // The motion being created is not on the layer yet but plays like a clip once it has keys (e.g. generated).
  const draft = mode.kind === 'create' ? mode.draft : null;
  const draftBound = useMemo(() => (model && draft ? bindMotion(model, draft.motion) : null), [model, draft]);
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const activeClip = mode.kind === 'edit' ? clips.find((c) => c.id === mode.clipId) ?? null : mode.kind === 'create' ? mode.draft : null;
  const maxFrame = Math.max(timelineEnd(clips), draft ? clipEnd(draft) : 0);

  // The clip under the current frame drives the pose (overlaps: the last added wins; blending comes later).
  const draftPlaying = draft && draftBound && draft.motion.boneFrameCount + draft.motion.morphFrameCount > 0 && clipContains(draft, frame);
  const playingClip = draftPlaying ? draft : clipAt(clips, frame);
  const playingBound = draftPlaying ? draftBound : playingClip ? bounds.get(playingClip.id) ?? null : null;
  const localFrame = playingClip ? frame - playingClip.start : 0;
  const createBlockedReason = !model
    ? 'モデルを読み込んでください'
    : playingClip
      ? `フレーム ${frame} には既にモーションがあります`
      : null;

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

  const startEdit = () => {
    if (!selectedClip) return;
    setPlaying(false);
    setMode({ kind: 'edit', clipId: selectedClip.id });
  };

  const startCreate = () => {
    if (createBlockedReason || !model) return;
    setPlaying(false);
    setSelectedClipId(null);
    setMode({ kind: 'create', draft: { id: newClipId(), name: NEW_MOTION_NAME, start: frame, motion: emptyMotion(model.name) } });
  };

  // A Kimodo motion was generated in the editor: put it into the clip at motion frame `at`.
  const onGenerated = (generated: MotionDto, prompt: string, at: number) => {
    setPlaying(false);
    if (mode.kind === 'create') {
      const d = mode.draft;
      const name = d.name === NEW_MOTION_NAME ? clipNameFromPrompt(prompt) : d.name;
      setMode({ kind: 'create', draft: { ...d, name, motion: spliceMotion(d.motion, generated, at) } });
    } else if (mode.kind === 'edit') {
      const id = mode.clipId;
      setClips((cs) => cs.map((c) => (c.id === id ? { ...c, motion: spliceMotion(c.motion, generated, at) } : c)));
    }
  };

  const closeEditor = () => {
    if (mode.kind === 'create') {
      const d = mode.draft;
      // Only keep the new motion once it has key frames (e.g. generated with Kimodo).
      if (d.motion.boneFrameCount + d.motion.morphFrameCount > 0) {
        setClips((cs) => [...cs, d]);
        setSelectedClipId(d.id);
      }
    }
    setMode({ kind: 'normal' });
  };

  const deleteSelectedClip = () => {
    if (!selectedClipId) return;
    setPlaying(false);
    setClips((cs) => cs.filter((c) => c.id !== selectedClipId));
    setSelectedClipId(null);
  };

  const onDropFiles = async (dt: DataTransfer) => {
    const files = await filesFromDrop(dt);
    if (mode.kind !== 'normal') return;
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
      } else if (e.key === 'Escape' && mode.kind !== 'normal') closeEditor();
      else if (e.key === 'Delete' && mode.kind === 'normal' && selectedClipId) deleteSelectedClip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app">
      {mode.kind !== 'normal' && activeClip && model ? (
        <MotionEditorPanel
          kind={mode.kind}
          clip={activeClip}
          frame={frame}
          model={model}
          onGenerated={onGenerated}
          onClose={closeEditor}
        />
      ) : (
        <Sidebar
          model={model}
          missingTextures={missingTextures}
          clipCount={clips.length}
          selectedClip={selectedClip}
          selectedBound={selectedClip ? bounds.get(selectedClip.id) ?? null : null}
          createBlockedReason={createBlockedReason}
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
          onEditClip={startEdit}
          onCreateMotion={startCreate}
          onOptions={(o) => setOptions((prev) => ({ ...prev, ...o }))}
          onResetCamera={() => viewerRef.current?.resetCamera()}
        />
      )}
      <main className="main">
        <Viewport onReady={onReady} onDropFiles={onDropFiles} empty={!model} />
        <Timeline
          model={model}
          clips={clips}
          selectedClipId={selectedClipId}
          mode={mode.kind}
          activeClip={activeClip}
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
