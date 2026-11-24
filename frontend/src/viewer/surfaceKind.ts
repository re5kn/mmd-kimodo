/**
 * Guesses what a PMX material represents from its name and texture file
 * names, so presets can give hair, cloth and skin different surfaces.
 * PMX has no such field; Japanese and English names are matched.
 */
export type SurfaceKind = 'hair' | 'cloth' | 'skin' | 'metal' | 'decal';

export const SURFACE_KIND_LABELS: Record<SurfaceKind, string> = {
  hair: '髪',
  cloth: '服',
  skin: '肌',
  metal: '金属',
  decal: '目・表情',
};

/**
 * Eyes, brows, lashes, expression overlays and painted shadows: kept
 * unlit so they stay as drawn.
 */
const DECAL = /目|瞳|眉|まつ|睫|ハイライト|涙|汗|照れ|頬|赤面|青ざめ|口内|歯|舌|影|彩度|表情|eye|iris|pupil|brow|lash|highlight|tear|sweat|blush|teeth|tongue|mouth|shadow/i;
const HAIR = /髪|アホ毛|もみあげ|おさげ|ツインテ|hair|bang|ahoge/i;
const SKIN = /肌|顔|耳|首|手|足|腕|脚|体|身|skin|face|ear|neck|hand|arm|leg|foot|body/i;
const METAL = /金属|金|銀|メタル|鎖|ボタン|metal|gold|silver|chain|button/i;
const CLOTH = /服|布|衣|襟|袖|裾|スカート|ニーハイ|靴下|ソックス|タイツ|スパッツ|ぱんつ|パンツ|リボン|ネクタイ|上着|コート|ジャケット|シャツ|セーラー|手袋|帽|cloth|skirt|shirt|sock|tights|ribbon|tie|coat|jacket|glove|hat/i;

/** Clothes are the most common part of an MMD model, so they are the fallback. */
export function classifySurface(name: string, texturePaths: (string | null | undefined)[] = []): SurfaceKind {
  if (DECAL.test(name)) return 'decal';
  if (HAIR.test(name)) return 'hair';
  if (METAL.test(name)) return 'metal';
  if (CLOTH.test(name)) return 'cloth';
  if (SKIN.test(name)) return 'skin';
  // Names like 緑 / 白 say little; texture and sphere map names often do.
  const files = texturePaths.filter((t): t is string => !!t).map((t) => t.split(/[\\/]/).pop() ?? t);
  for (const f of files) {
    if (HAIR.test(f)) return 'hair';
    if (METAL.test(f)) return 'metal';
    if (CLOTH.test(f)) return 'cloth';
  }
  return 'cloth';
}
