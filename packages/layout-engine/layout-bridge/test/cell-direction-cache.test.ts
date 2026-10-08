import { describe, expect, it } from 'vite-plus/test';
import type { TableBlock } from '@superdoc/contracts';
import { MeasureCache } from '../src/cache.js';

function table(direction?: 'btLr' | 'tbRl', legacy = false): TableBlock {
  return {
    kind: 'table',
    id: 'direction-table',
    rows: [
      {
        id: 'row',
        cells: [
          {
            id: 'cell',
            attrs: legacy ? { tableCellProperties: { textDirection: direction } } : { textDirection: direction },
            blocks: [{ kind: 'paragraph', id: 'p', runs: [{ text: 'NORTH EAST', fontFamily: 'Arial', fontSize: 12 }] }],
          },
        ],
      },
    ],
  };
}

describe('cell direction measurement cache identity', () => {
  for (const legacy of [false, true])
    it(`invalidates an unchanged text cell when only its rotation changes, legacy=${legacy}`, () => {
      const cache = new MeasureCache();
      cache.set(table('btLr', legacy), 400, 500, { totalHeight: 50 });
      expect(cache.get(table('btLr', legacy), 400, 500)).toEqual({ totalHeight: 50 });
      expect(cache.get(table('tbRl', legacy), 400, 500)).toBeUndefined();
      expect(cache.get(table(undefined, legacy), 400, 500)).toBeUndefined();
    });
});
