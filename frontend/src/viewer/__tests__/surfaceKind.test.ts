import { describe, expect, test } from 'vitest';
import { classifySurface, classifySurfaces } from '../surfaceKind';

describe('classifySurface', () => {
  test.each([
    ['髪＿1', 'hair'],
    ['アホ毛', 'hair'],
    ['front hair', 'hair'],
    ['肌', 'skin'],
    ['顔＿線無し', 'skin'],
    ['耳', 'skin'],
    ['頭', 'skin'],
    ['髪_ヘアバンド白', 'cloth'],
    ['髪_ヘアバンド金', 'metal'],
    ['白目', 'decal'],
    ['まつげ', 'decal'],
    ['ハイライト＿まつげ', 'decal'],
    ['髪落影', 'decal'],
    ['髪彩度', 'decal'],
    ['照れ', 'decal'],
    ['金', 'metal'],
    ['ニーハイ', 'cloth'],
    ['スカート', 'cloth'],
    ['[WEAR]Brooch_Sphere', 'gem'],
    ['ブローチ', 'gem'],
    ['宝石', 'gem'],
  ])('%s → %s', (name, kind) => {
    expect(classifySurface(name)).toBe(kind);
  });

  test('falls back to texture and sphere map names', () => {
    expect(classifySurface('茶', ['tex/body.tga', 'S_服.bmp'])).toBe('cloth');
    expect(classifySurface('黄', ['body.tga', 'S_metal2.bmp'])).toBe('metal');
    expect(classifySurface('mat01', ['hair_diffuse.png'])).toBe('hair');
    // Expression overlays and head parts named after what they show.
    expect(classifySurface('腹黒', ['textures\\表情.png'])).toBe('decal');
    expect(classifySurface('mat02', ['textures\\肌.png'])).toBe('skin');
    // A shared body atlas does not make clothes skin.
    expect(classifySurface('緑', ['なとり＿体.tga'])).toBe('cloth');
  });

  test('unknown materials are treated as cloth', () => {
    expect(classifySurface('緑', ['なとり＿体.tga', 'S.bmp'])).toBe('cloth');
  });

  test('unnamed materials sharing an expression texture are expressions', () => {
    const kinds = classifySurfaces([
      { name: 'ぐるぐる目', texturePaths: ['その他.png'] },
      { name: '絶望', texturePaths: ['その他.png'] },
      { name: '緑', texturePaths: ['body.tga'] },
    ]);
    expect(kinds).toEqual(['decal', 'decal', 'cloth']);
  });
});
