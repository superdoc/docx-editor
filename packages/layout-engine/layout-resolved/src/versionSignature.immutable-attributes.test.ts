/** @vitest-environment node */
import { Session } from 'node:inspector/promises';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vite-plus/test';
import type { TableBlock, TableFragment, TableMeasure } from '@superdoc/contracts';
import { deriveTableFragmentPaintVersion } from './versionSignature.js';

type CellAttrs = NonNullable<TableBlock['rows'][number]['cells'][number]['attrs']>;

function paintVersion(
  attrs: object,
  options: { pm?: number; colSpan?: number; id?: string; nested?: boolean } = {},
): string {
  const paragraph = {
    kind: 'paragraph' as const,
    id: 'paragraph',
    runs: [{ text: 'sample', pmStart: options.pm ?? 1, pmEnd: (options.pm ?? 1) + 6 }],
  };
  const block: TableBlock = {
    kind: 'table',
    id: options.id ?? 'table',
    columnWidths: [100],
    rows: [
      {
        id: 'row',
        cells: [
          {
            id: 'cell',
            colSpan: options.colSpan ?? 1,
            attrs: attrs as CellAttrs,
            blocks: options.nested
              ? [
                  {
                    kind: 'table',
                    id: 'nested',
                    rows: [
                      {
                        id: 'nested-row',
                        cells: [{ id: 'nested-cell', attrs: attrs as CellAttrs, blocks: [paragraph] }],
                      },
                    ],
                  },
                ]
              : [paragraph],
          },
        ],
      },
    ],
  };
  const measure: TableMeasure = {
    kind: 'table',
    columnWidths: [100],
    totalWidth: 100,
    totalHeight: 12,
    rows: [{ height: 12, cells: [{ width: 100, height: 12, colSpan: options.colSpan ?? 1 }] }],
  };
  const fragment: TableFragment = {
    kind: 'table',
    blockId: block.id,
    fromRow: 0,
    toRow: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 12,
  };
  return deriveTableFragmentPaintVersion(fragment, block, measure);
}

function frozenAttrs() {
  return Object.freeze({ background: '#ffffff', padding: Object.freeze({ top: 1, bottom: 2, left: 3, right: 4 }) });
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('immutable table attribute hash reuse', () => {
  it('does not serialize unchanged frozen attributes again after fresh PM wrappers', () => {
    let keyReads = 0;
    const attrs = new Proxy(frozenAttrs(), {
      ownKeys(target) {
        keyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const before = paintVersion(attrs);
    expect(keyReads).toBeGreaterThan(0);
    keyReads = 0;

    expect(paintVersion(attrs, { pm: 20 })).toBe(before);
    expect(keyReads).toBe(0);
    expect(paintVersion(copy(attrs), { pm: 20 })).toBe(before);
  });

  it('keeps the exact existing stamps for new incoming seeds, styles, merges, tracked changes and nested tables', () => {
    const variants = [
      frozenAttrs(),
      Object.freeze({ ...frozenAttrs(), background: '#123456' }),
      Object.freeze({
        ...frozenAttrs(),
        trackedChange: Object.freeze({
          id: 'change',
          type: 'insert',
          author: 'Author',
          date: '2026-01-01',
          color: '#123456',
        }),
      }),
    ];
    for (const attrs of variants) {
      for (const options of [{}, { pm: 80 }, { id: 'other-table' }, { colSpan: 2 }, { nested: true }, {}]) {
        expect(paintVersion(attrs, options)).toBe(paintVersion(copy(attrs), options));
      }
    }
    expect(paintVersion(variants[1]!)).not.toBe(paintVersion(variants[0]!));
    expect(paintVersion(variants[2]!)).not.toBe(paintVersion(variants[0]!));
    expect(paintVersion(variants[0]!, { colSpan: 2 })).not.toBe(paintVersion(variants[0]!));
  });

  it('does not cache a frozen parent with mutable descendants', () => {
    const padding = { top: 1 };
    const attrs = Object.freeze({ padding });
    const before = paintVersion(attrs);
    padding.top = 9;
    const after = paintVersion(attrs);
    expect(after).not.toBe(before);
    expect(after).toBe(paintVersion(copy(attrs)));
  });

  it('replaces the prior scalar seed entry instead of accumulating a seed history', () => {
    let keyReads = 0;
    const attrs = new Proxy(frozenAttrs(), {
      ownKeys(target) {
        keyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const original = paintVersion(attrs);
    keyReads = 0;
    expect(paintVersion(attrs)).toBe(original);
    expect(keyReads).toBe(0);
    paintVersion(attrs, { id: 'other-table' });
    expect(keyReads).toBeGreaterThan(0);
    keyReads = 0;
    expect(paintVersion(attrs)).toBe(original);
    expect(keyReads).toBeGreaterThan(0);
  });

  it.each(['mutable', 'frozen', 'prototype'] as const)('preserves accessor reads for %s attributes', (kind) => {
    let reads = 0;
    let value = 'first';
    const attrs = Object.create(kind === 'prototype' ? { inherited: true } : Object.prototype);
    Object.defineProperty(attrs, 'probe', {
      enumerable: true,
      get() {
        reads += 1;
        return value;
      },
    });
    if (kind !== 'mutable') Object.freeze(attrs);
    const before = paintVersion(attrs);
    expect(reads).toBe(2);
    reads = 0;
    value = 'second';
    const after = paintVersion(attrs);
    expect(reads).toBe(2);
    expect(after).not.toBe(before);
  });

  it('preserves cyclic data rejection', () => {
    const attrs: { cycle?: object } = {};
    attrs.cycle = attrs;
    Object.freeze(attrs);
    expect(() => paintVersion(attrs)).toThrow(RangeError);
  });

  it('preserves the single read of an array accessor', () => {
    let reads = 0;
    let value = 'first';
    const array: string[] = [];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        reads += 1;
        return value;
      },
    });
    const attrs = Object.freeze({ extra: Object.freeze(array) });
    const before = paintVersion(attrs);
    expect(reads).toBe(1);
    reads = 0;
    value = 'second';
    expect(paintVersion(attrs)).not.toBe(before);
    expect(reads).toBe(1);
  });

  it('preserves dynamic function string conversion without caching it', () => {
    let reads = 0;
    let value = 'first';
    const callback = () => undefined;
    callback.toString = () => {
      reads += 1;
      return value;
    };
    const attrs = Object.freeze({ extra: callback });
    const before = paintVersion(attrs);
    expect(reads).toBe(1);
    reads = 0;
    value = 'second';
    expect(paintVersion(attrs)).not.toBe(before);
    expect(reads).toBe(1);
  });

  it('does not retain discarded attribute owners', async () => {
    const reference = (() => {
      const attrs = frozenAttrs();
      paintVersion(attrs);
      paintVersion(attrs, { pm: 20 });
      return new WeakRef(attrs);
    })();
    const session = new Session();
    session.connect();
    try {
      for (let turn = 0; turn < 5; turn += 1) {
        await setImmediate();
        await session.post('HeapProfiler.collectGarbage');
      }
      expect(reference.deref()).toBeUndefined();
    } finally {
      session.disconnect();
    }
  });
});
