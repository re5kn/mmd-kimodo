import { DEFAULT_EFFECTS, NEUTRAL_GRADE, type EffectSettings } from './postEffects';

/**
 * Built-in looks (Issue #11 C4): sets of post effects in the spirit of
 * common MME effects, laid over whichever display preset is in use. Each
 * one only fills in the effect settings, so it can be adjusted afterwards.
 */
export type LookKind = 'none' | 'vivid' | 'soft' | 'cinema' | 'glow' | 'figurePhoto';

export const LOOKS: { kind: LookKind; label: string; description: string; effects: EffectSettings }[] = [
  { kind: 'none', label: 'なし', description: 'エフェクトなし', effects: DEFAULT_EFFECTS },
  {
    kind: 'vivid',
    label: '色鮮やか',
    description: '彩度とコントラストを上げて色をはっきり見せる',
    effects: { ...DEFAULT_EFFECTS, smaa: true, grade: { ...NEUTRAL_GRADE, saturation: 1.35, contrast: 1.12, brightness: 1.03 } },
  },
  {
    kind: 'soft',
    label: 'ソフト',
    description: '明るい部分をふんわりにじませる（Diffusion 系）',
    effects: {
      ...DEFAULT_EFFECTS,
      bloom: { enabled: true, strength: 0.25, radius: 0.9, threshold: 0.75 },
      smaa: true,
      grade: { ...NEUTRAL_GRADE, saturation: 1.05, contrast: 0.92, brightness: 1.04 },
    },
  },
  {
    kind: 'cinema',
    label: 'シネマ',
    description: '映画のような階調に、背景ぼかしと周辺減光（ACES）',
    effects: {
      ...DEFAULT_EFFECTS,
      dof: { enabled: true, strength: 0.5 },
      smaa: true,
      toneMapping: 'aces',
      grade: { ...NEUTRAL_GRADE, saturation: 0.95, contrast: 1.1, brightness: 1.1, warmth: 0.25, vignette: 0.55 },
    },
  },
  {
    kind: 'glow',
    label: '発光',
    description: '明るい部分を強く光らせる（AutoLuminous 系）',
    effects: {
      ...DEFAULT_EFFECTS,
      bloom: { enabled: true, strength: 0.6, radius: 0.3, threshold: 0.95 },
      smaa: true,
      grade: { ...NEUTRAL_GRADE, saturation: 1.15 },
    },
  },
  {
    kind: 'figurePhoto',
    label: 'フィギュア撮影',
    description: '接写のような強い背景ぼかしで、小さな模型を撮ったように見せる（表示「フィギュア」と合わせて）',
    effects: {
      ...DEFAULT_EFFECTS,
      dof: { enabled: true, strength: 0.8 },
      smaa: true,
      grade: { ...NEUTRAL_GRADE, saturation: 1.1, contrast: 1.05, vignette: 0.25 },
    },
  },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The look whose settings match exactly, if any (null once edited by hand). */
export function currentLook(s: EffectSettings): LookKind | null {
  return LOOKS.find((l) => same(l.effects, s))?.kind ?? null;
}
