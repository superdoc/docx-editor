import { describe, expect, it } from 'bun:test';
import type { BlocksAdapter } from './blocks.js';
import { executeBlocksFindText } from './find-text.js';
import type { BlocksFindTextInput } from '../types/blocks.types.js';

function fixtureAdapter(count: number) {
  const calls: unknown[] = [];
  const adapter = {
    list(input) {
      calls.push(input);
      const offset = input?.offset ?? 0;
      return {
        total: count,
        revision: '7',
        reviewMode: 'final',
        blocks: Array.from({ length: Math.min(input?.limit ?? count, count - offset) }, (_, index) => ({
          ordinal: offset + index,
          nodeId: `p${offset + index}`,
          nodeType: 'paragraph' as const,
          text: 'Token token ' + 'x'.repeat(120),
          textPreview: null,
          isEmpty: false,
        })),
      };
    },
  } satisfies Pick<BlocksAdapter, 'list'>;
  return { adapter: adapter as BlocksAdapter, calls };
}

describe('blocks.findText', () => {
  it('keeps counts independent of the result limit and projects bounded previews', () => {
    const { adapter, calls } = fixtureAdapter(2005);
    const result = executeBlocksFindText(adapter, { text: 'tOkEn', limit: 1 });
    expect(result).toMatchObject({
      total: 2005,
      scannedBlocks: 2005,
      truncated: false,
      revision: '7',
      firstMatchOrdinal: 0,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      ordinal: 0,
      nodeId: 'p0',
      nodeType: 'paragraph',
      preview: ('Token token ' + 'x'.repeat(120)).slice(0, 100),
    });
    expect(calls).toEqual([
      { offset: 0, limit: 2000, includeText: true },
      { offset: 2000, limit: 2000, includeText: true },
    ]);
  });

  it('preserves the 20,000-block boundary, including exact-cap completion', () => {
    for (const count of [0, 20000, 20001]) {
      const { adapter, calls } = fixtureAdapter(count);
      const result = executeBlocksFindText(adapter, { text: 'Token', limit: 0 });
      expect(result).toMatchObject({
        total: Math.min(count, 20000),
        scannedBlocks: Math.min(count, 20000),
        truncated: count > 20000,
        matches: [],
      });
      expect(calls.length).toBeLessThanOrEqual(10);
      expect(result.firstMatchOrdinal).toBe(count ? 0 : undefined);
    }
  });

  it('defaults to eight matches and treats input text literally', () => {
    const { adapter } = fixtureAdapter(12);
    expect(executeBlocksFindText(adapter, { text: 'Token' }).matches).toHaveLength(8);
    for (const text of ['Token  token', 'Token.*token', 'absent']) {
      expect(executeBlocksFindText(adapter, { text })).toMatchObject({ total: 0, matches: [], scannedBlocks: 12 });
    }
  });

  it('rejects malformed inputs before any adapter read', () => {
    const { adapter, calls } = fixtureAdapter(1);
    for (const input of [
      undefined,
      null,
      [],
      {},
      { text: '' },
      { text: ' \n ' },
      { text: 4 },
      { text: 'x', extra: true },
      ...[-1, 0.5, NaN, Infinity, null, '1'].map((limit) => ({ text: 'x', limit })),
    ]) {
      expect(() => executeBlocksFindText(adapter, input as BlocksFindTextInput)).toThrow();
    }
    expect(calls).toEqual([]);
  });

  it('reports first-page read failures without claiming a complete search', () => {
    const adapter = {
      list() {
        throw new Error('read unavailable');
      },
    } as unknown as BlocksAdapter;
    expect(executeBlocksFindText(adapter, { text: 'x' })).toEqual({
      total: 0,
      matches: [],
      scannedBlocks: 0,
      truncated: false,
      revision: 'unknown',
      scanError: { message: 'read unavailable' },
    });
  });

  it('retains successful page counts, matches, and location when a later read fails', () => {
    const { adapter } = fixtureAdapter(2005);
    const list = adapter.list;
    adapter.list = (input) => {
      if (input?.offset) throw new Error('second page unavailable');
      return list(input);
    };
    expect(executeBlocksFindText(adapter, { text: 'Token', limit: 1 })).toMatchObject({
      total: 2000,
      scannedBlocks: 2000,
      firstMatchOrdinal: 0,
      revision: '7',
      truncated: false,
      matches: [{ ordinal: 0, nodeId: 'p0' }],
      scanError: { message: 'second page unavailable' },
    });
  });
});
