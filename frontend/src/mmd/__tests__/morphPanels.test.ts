import { expect, test } from 'vitest';
import type { ModelDto } from '../../api/types';
import { morphsByPanel } from '../morphPanels';

test('groups morphs by expression panel, system morphs with その他', () => {
  const panels = [3, 1, 4, 3, 0];
  const model = { morphs: panels.map((panel, i) => ({ name: `m${i}`, panel })) } as unknown as ModelDto;
  expect(morphsByPanel(model)).toEqual([
    { label: '眉', indices: [1] },
    { label: '口', indices: [0, 3] },
    { label: 'その他', indices: [2, 4] },
  ]);
});
