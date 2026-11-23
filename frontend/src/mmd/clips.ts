import type { MotionDto } from '../api/types';

/**
 * A motion placed on the timeline's motion layer. The motion's own frames
 * (0..motion.maxFrame) are mapped to timeline frames start..start+length-1.
 */
export interface MotionClip {
  id: string;
  name: string;
  /** First timeline frame of the clip. */
  start: number;
  motion: MotionDto;
}

/** Number of frames a clip occupies (a motion with keys only at 0 still takes one frame). */
export function clipLength(clip: MotionClip): number {
  return Math.max(0, clip.motion.maxFrame) + 1;
}

/** Last timeline frame covered by the clip (inclusive). */
export function clipEnd(clip: MotionClip): number {
  return clip.start + clipLength(clip) - 1;
}

export function clipContains(clip: MotionClip, frame: number): boolean {
  return frame >= clip.start && frame <= clipEnd(clip);
}

/**
 * The clip that drives the pose at a timeline frame. When clips overlap the
 * one added last wins (blending of overlapping motions is not implemented yet).
 */
export function clipAt(clips: readonly MotionClip[], frame: number): MotionClip | null {
  for (let i = clips.length - 1; i >= 0; i--) if (clipContains(clips[i], frame)) return clips[i];
  return null;
}

/** Last frame of the whole timeline (0 when there are no clips). */
export function timelineEnd(clips: readonly MotionClip[]): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, clipEnd(c));
  return end;
}

/** Sorted, unique start and end frames of all clips (for jumping between clips). */
export function clipBoundaries(clips: readonly MotionClip[]): number[] {
  const s = new Set<number>();
  for (const c of clips) {
    s.add(c.start);
    s.add(clipEnd(c));
  }
  return [...s].sort((a, b) => a - b);
}

let nextId = 1;
export function newClipId(): string {
  return `clip-${nextId++}`;
}

/** Largest key <= frame in a sorted list, or fallback. */
export function prevIn(sorted: readonly number[], frame: number, fallback = 0): number {
  let best = fallback;
  for (const f of sorted) if (f < frame) best = f;
  return best;
}

/** Smallest key > frame in a sorted list, or frame itself. */
export function nextIn(sorted: readonly number[], frame: number): number {
  for (const f of sorted) if (f > frame) return f;
  return frame;
}
