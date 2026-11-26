/**
 * Guesses what a PMX material represents from its name and texture file
 * names, so presets can give hair, cloth and skin different surfaces.
 * PMX has no such field; Japanese and English names are matched.
 */
export type SurfaceKind = 'hair' | 'cloth' | 'skin' | 'metal' | 'gem' | 'decal';

export const SURFACE_KIND_LABELS: Record<SurfaceKind, string> = {
  hair: '髪',
  cloth: '服',
  skin: '肌',
  metal: '金属',
  gem: '宝石',
  decal: '目・表情',
};

/**
 * Eyes, brows, lashes, expression overlays and painted shadows: kept
 * unlit so they stay as drawn.
 */
const DECAL = /目|瞳|眉|まつ|睫|ハイライト|涙|汗|照れ|頬|赤面|青ざめ|口内|歯|舌|影|彩度|表情|eye|iris|pupil|brow|lash|highlight|tear|sweat|blush|teeth|tongue|mouth|shadow/i;
/**
 * Jewels and brooches: their stone is often only a dark base texture with
 * the picture painted in an additive sphere map.
 */
const GEM = /宝石|ジュエル|ブローチ|ペンダント|gem|jewel|brooch|pendant/i;
const HAIR = /髪|アホ毛|もみあげ|おさげ|ツインテ|hair|bang|ahoge/i;
const SKIN = /肌|顔|頭|耳|首|手|足|腕|脚|体|身|skin|face|head|ear|neck|hand|arm|leg|foot|body/i;
/** Things worn in the hair are not hair (髪_ヘアバンド etc.). */
const HAIR_ACCESSORY = /ヘアバンド|ヘアピン|髪飾り|髪留め|カチューシャ|ヘアゴム|シュシュ|hairband|hairpin|headband/i;
const METAL = /金属|金|銀|メタル|鎖|ボタン|metal|gold|silver|chain|button/i;
const CLOTH = /服|布|衣|襟|袖|裾|スカート|ニーハイ|靴下|ソックス|タイツ|スパッツ|ぱんつ|パンツ|リボン|ネクタイ|上着|コート|ジャケット|シャツ|セーラー|手袋|帽|cloth|skirt|shirt|sock|tights|ribbon|tie|coat|jacket|glove|hat/i;

/**
 * Texture names are matched more narrowly: an atlas such as body.tga often
 * holds clothes too, and shadow / highlight words are rarely in file names.
 */
const DECAL_FILE = /表情|目|瞳|eye|expression/i;
const SKIN_FILE = /肌|顔|skin|face/i;

/** The kind the names point to, or null when nothing matched. */
function matchSurface(name: string, texturePaths: (string | null | undefined)[]): SurfaceKind | null {
  if (DECAL.test(name)) return 'decal';
  if (GEM.test(name)) return 'gem';
  if (HAIR_ACCESSORY.test(name)) return METAL.test(name) ? 'metal' : 'cloth';
  if (HAIR.test(name)) return 'hair';
  if (METAL.test(name)) return 'metal';
  if (CLOTH.test(name)) return 'cloth';
  if (SKIN.test(name)) return 'skin';
  // Names like 緑 / 白 say little; texture and sphere map names often do.
  for (const f of fileNames(texturePaths)) {
    if (DECAL_FILE.test(f)) return 'decal';
    if (SKIN_FILE.test(f)) return 'skin';
    if (GEM.test(f)) return 'gem';
    if (HAIR.test(f)) return 'hair';
    if (METAL.test(f)) return 'metal';
    if (CLOTH.test(f)) return 'cloth';
  }
  return null;
}

const fileNames = (paths: (string | null | undefined)[]) =>
  paths.filter((t): t is string => !!t).map((t) => t.split(/[\\/]/).pop() ?? t);

/** Clothes are the most common part of an MMD model, so they are the fallback. */
export function classifySurface(name: string, texturePaths: (string | null | undefined)[] = []): SurfaceKind {
  return matchSurface(name, texturePaths) ?? 'cloth';
}

export interface SurfaceInput {
  name: string;
  /** Main texture first, then the sphere map. */
  texturePaths: (string | null | undefined)[];
}

/**
 * Classifies every material of a model. A material whose names say nothing
 * (絶望, はぅ) but that shares its main texture with eyes or expressions
 * (ぐるぐる目) is an expression overlay too.
 */
export function classifySurfaces(materials: SurfaceInput[]): SurfaceKind[] {
  const kinds = materials.map((m) => matchSurface(m.name, m.texturePaths));
  const decalTextures = new Set<string>();
  materials.forEach((m, i) => {
    const main = m.texturePaths[0];
    if (kinds[i] === 'decal' && main) decalTextures.add(main);
  });
  return kinds.map((k, i) => {
    if (k) return k;
    const main = materials[i].texturePaths[0];
    return main && decalTextures.has(main) ? 'decal' : 'cloth';
  });
}
