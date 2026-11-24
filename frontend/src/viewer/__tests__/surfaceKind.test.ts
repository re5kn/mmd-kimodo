import { describe, expect, test } from 'vitest';
import { classifySurface } from '../surfaceKind';

describe('classifySurface', () => {
  test.each([
    ['髪＿1', 'hair'],
    ['アホ毛', 'hair'],
    ['front hair', 'hair'],
    ['肌', 'skin'],
    ['顔＿線無し', 'skin'],
    ['耳', 'skin'],
    ['白目', 'decal'],
    ['まつげ', 'decal'],
    ['ハイライト＿まつげ', 'decal'],
    ['髪落影', 'decal'],
    ['髪彩度', 'decal'],
    ['照れ', 'decal'],
    ['金', 'metal'],
    ['ニーハイ', 'cloth'],
    ['スカート', 'cloth'],
  ])('%s → %s', (name, kind) => {
    expect(classifySurface(name)).toBe(kind);
  });

  test('falls back to texture and sphere map names', () => {
    expect(classifySurface('茶', ['tex/body.tga', 'S_服.bmp'])).toBe('cloth');
    expect(classifySurface('黄', ['body.tga', 'S_metal2.bmp'])).toBe('metal');
    expect(classifySurface('mat01', ['hair_diffuse.png'])).toBe('hair');
  });

  test('unknown materials are treated as cloth', () => {
    expect(classifySurface('緑', ['なとり＿体.tga', 'S.bmp'])).toBe('cloth');
  });
});
