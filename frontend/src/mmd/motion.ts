import { Quaternion, Vector3 } from 'three';
import type { BoneKeyDto, BoneTrackDto, ModelDto, MotionDto, MorphTrackDto } from '../api/types';
import { bezierEase } from './interpolation';

/** Index of the last key with key.f <= frame, or -1. */
export function findKey<T extends { f: number }>(keys: readonly T[], frame: number): number {
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].f <= frame) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const _qa = new Quaternion();
const _qb = new Quaternion();

/**
 * Samples a bone track. The interpolation curve of the segment (k, k+1)
 * is stored on key k+1 (VMD convention).
 */
export function sampleBoneTrack(keys: readonly BoneKeyDto[], frame: number, outPos: Vector3, outRot: Quaternion): void {
  if (keys.length === 0) {
    outPos.set(0, 0, 0);
    outRot.identity();
    return;
  }
  const k = findKey(keys, frame);
  if (k < 0) {
    setKey(keys[0], outPos, outRot);
    return;
  }
  if (k >= keys.length - 1 || keys[k].f === frame) {
    setKey(keys[k], outPos, outRot);
    return;
  }
  const a = keys[k], b = keys[k + 1];
  const x = (frame - a.f) / (b.f - a.f);
  const i = b.i;
  const tx = bezierEase(x, i[0], i[1], i[2], i[3]);
  const ty = bezierEase(x, i[4], i[5], i[6], i[7]);
  const tz = bezierEase(x, i[8], i[9], i[10], i[11]);
  const tr = bezierEase(x, i[12], i[13], i[14], i[15]);
  outPos.set(
    a.p[0] + (b.p[0] - a.p[0]) * tx,
    a.p[1] + (b.p[1] - a.p[1]) * ty,
    a.p[2] + (b.p[2] - a.p[2]) * tz,
  );
  _qa.set(a.r[0], a.r[1], a.r[2], a.r[3]).normalize();
  _qb.set(b.r[0], b.r[1], b.r[2], b.r[3]).normalize();
  outRot.slerpQuaternions(_qa, _qb, tr);
}

function setKey(key: BoneKeyDto, outPos: Vector3, outRot: Quaternion) {
  outPos.set(key.p[0], key.p[1], key.p[2]);
  outRot.set(key.r[0], key.r[1], key.r[2], key.r[3]).normalize();
}

export function sampleMorphTrack(track: MorphTrackDto, frame: number): number {
  const keys = track.frames;
  if (keys.length === 0) return 0;
  const k = findKey(keys, frame);
  if (k < 0) return keys[0].w;
  if (k >= keys.length - 1) return keys[k].w;
  const a = keys[k], b = keys[k + 1];
  const x = (frame - a.f) / (b.f - a.f);
  return a.w + (b.w - a.w) * x;
}

/** A motion matched to a model by bone / morph names. */
export interface BoundMotion {
  motion: MotionDto;
  /** Per model bone: track or null. */
  boneTracks: (BoneTrackDto | null)[];
  /** Per model morph: track or null. */
  morphTracks: (MorphTrackDto | null)[];
  unmatchedBones: string[];
  unmatchedMorphs: string[];
  matchedBoneCount: number;
  matchedMorphCount: number;
}

export function bindMotion(model: ModelDto, motion: MotionDto): BoundMotion {
  const boneIndex = new Map<string, number>();
  model.bones.forEach((b, i) => {
    if (!boneIndex.has(b.name)) boneIndex.set(b.name, i);
  });
  const morphIndex = new Map<string, number>();
  model.morphs.forEach((m, i) => {
    if (!morphIndex.has(m.name)) morphIndex.set(m.name, i);
  });

  const boneTracks: (BoneTrackDto | null)[] = model.bones.map(() => null);
  const unmatchedBones: string[] = [];
  for (const t of motion.bones) {
    const i = boneIndex.get(t.name);
    if (i === undefined) unmatchedBones.push(t.name);
    else boneTracks[i] = t;
  }
  const morphTracks: (MorphTrackDto | null)[] = model.morphs.map(() => null);
  const unmatchedMorphs: string[] = [];
  for (const t of motion.morphs) {
    const i = morphIndex.get(t.name);
    if (i === undefined) unmatchedMorphs.push(t.name);
    else morphTracks[i] = t;
  }
  return {
    motion,
    boneTracks,
    morphTracks,
    unmatchedBones,
    unmatchedMorphs,
    matchedBoneCount: motion.bones.length - unmatchedBones.length,
    matchedMorphCount: motion.morphs.length - unmatchedMorphs.length,
  };
}

/** IK on/off state for an IK bone at a frame (step function, default on). */
export function sampleIkEnabled(motion: MotionDto, boneName: string, frame: number): boolean {
  const k = findKey(motion.ik, frame);
  if (k < 0) return true;
  const state = motion.ik[k].states.find((s) => s.name === boneName);
  return state ? state.enabled : true;
}
