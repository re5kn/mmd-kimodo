import type { BoneTrackDto, IkFrameDto, MotionDto } from '../api/types';

/**
 * Puts a generated motion into `base`, starting at motion frame `at`.
 *
 * For every bone the generated motion animates, the keys of `base` in
 * at..at+generated.maxFrame are replaced by the generated keys. Bones the
 * generated motion does not touch (eyes, hair, extra bones) and morphs are kept
 * as they are. IK on/off frames are replaced in the same range when the
 * generated motion has any.
 */
export function spliceMotion(base: MotionDto, generated: MotionDto, at: number): MotionDto {
  const start = Math.max(0, Math.round(at));
  const end = start + Math.max(0, generated.maxFrame);
  const inRange = (f: number) => f >= start && f <= end;

  const tracks = new Map<string, BoneTrackDto>();
  for (const t of base.bones) tracks.set(t.name, { name: t.name, frames: [...t.frames] });
  for (const g of generated.bones) {
    const shifted = g.frames.map((k) => ({ ...k, f: k.f + start }));
    const kept = tracks.get(g.name)?.frames.filter((k) => !inRange(k.f)) ?? [];
    tracks.set(g.name, { name: g.name, frames: [...kept, ...shifted].sort((a, b) => a.f - b.f) });
  }
  const bones = [...tracks.values()].filter((t) => t.frames.length > 0);

  let ik: IkFrameDto[] = base.ik;
  if (generated.ik.length > 0) {
    ik = [...base.ik.filter((k) => !inRange(k.f)), ...generated.ik.map((k) => ({ ...k, f: k.f + start }))].sort((a, b) => a.f - b.f);
  }

  const boneFrameCount = bones.reduce((n, t) => n + t.frames.length, 0);
  let maxFrame = 0;
  for (const t of bones) maxFrame = Math.max(maxFrame, t.frames[t.frames.length - 1].f);
  for (const t of base.morphs) if (t.frames.length > 0) maxFrame = Math.max(maxFrame, t.frames[t.frames.length - 1].f);
  for (const k of ik) maxFrame = Math.max(maxFrame, k.f);

  return { ...base, bones, ik, boneFrameCount, maxFrame };
}
