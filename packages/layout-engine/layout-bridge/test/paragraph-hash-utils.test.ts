/**
 * Tests for paragraph hash utility functions
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vite-plus/test';
import {
  hashBorderSpec,
  hashTableBorderValue,
  hashTableBorders,
  hashCellBorders,
  hashParagraphBorders,
  hashParagraphAttrs,
} from '../src/paragraph-hash-utils';
import type { BorderSpec, TableBorders, CellBorders, ParagraphBorders, ParagraphAttrs } from '@superdoc/contracts';

describe('hashBorderSpec', () => {
  it('produces deterministic hash for same border properties', () => {
    const border: BorderSpec = {
      style: 'single',
      width: 4,
      color: '000000',
      space: 0,
    };

    const hash1 = hashBorderSpec(border);
    const hash2 = hashBorderSpec(border);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe('s:single,w:4,c:000000,sp:0');
  });

  it('produces different hashes for different styles', () => {
    const border1: BorderSpec = { style: 'single', width: 4, color: '000000' };
    const border2: BorderSpec = { style: 'double', width: 4, color: '000000' };

    const hash1 = hashBorderSpec(border1);
    const hash2 = hashBorderSpec(border2);

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different widths', () => {
    const border1: BorderSpec = { style: 'single', width: 4, color: '000000' };
    const border2: BorderSpec = { style: 'single', width: 8, color: '000000' };

    const hash1 = hashBorderSpec(border1);
    const hash2 = hashBorderSpec(border2);

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different colors', () => {
    const border1: BorderSpec = { style: 'single', width: 4, color: '000000' };
    const border2: BorderSpec = { style: 'single', width: 4, color: 'FF0000' };

    const hash1 = hashBorderSpec(border1);
    const hash2 = hashBorderSpec(border2);

    expect(hash1).not.toBe(hash2);
  });

  it('handles undefined properties correctly', () => {
    const border1: BorderSpec = { style: 'single' };
    const border2: BorderSpec = { style: 'single', width: 4 };

    const hash1 = hashBorderSpec(border1);
    const hash2 = hashBorderSpec(border2);

    expect(hash1).toBe('s:single');
    expect(hash2).toBe('s:single,w:4');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty border object', () => {
    const border: BorderSpec = {};

    const hash = hashBorderSpec(border);

    expect(hash).toBe('');
  });

  it('produces consistent order regardless of property order', () => {
    // TypeScript doesn't guarantee property order, but our hash should be deterministic
    const border1: BorderSpec = {
      color: '000000',
      width: 4,
      style: 'single',
      space: 0,
    };
    const border2: BorderSpec = {
      style: 'single',
      width: 4,
      color: '000000',
      space: 0,
    };

    const hash1 = hashBorderSpec(border1);
    const hash2 = hashBorderSpec(border2);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe('s:single,w:4,c:000000,sp:0');
  });
});

describe('hashTableBorderValue', () => {
  it('returns empty string for undefined', () => {
    const hash = hashTableBorderValue(undefined);
    expect(hash).toBe('');
  });

  it('returns "null" for null (inherit)', () => {
    const hash = hashTableBorderValue(null);
    expect(hash).toBe('null');
  });

  it('returns "none" for { none: true }', () => {
    const hash = hashTableBorderValue({ none: true });
    expect(hash).toBe('none');
  });

  it('returns hash for BorderSpec object', () => {
    const borderSpec: BorderSpec = {
      style: 'single',
      width: 4,
      color: '000000',
    };

    const hash = hashTableBorderValue(borderSpec);

    expect(hash).toBe('s:single,w:4,c:000000');
  });

  it('all three states produce distinct values (no collisions)', () => {
    const hash1 = hashTableBorderValue(undefined);
    const hash2 = hashTableBorderValue(null);
    const hash3 = hashTableBorderValue({ none: true });

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it('BorderSpec hash differs from special values', () => {
    const borderSpec: BorderSpec = { style: 'single', width: 4 };
    const hash = hashTableBorderValue(borderSpec);

    expect(hash).not.toBe('');
    expect(hash).not.toBe('null');
    expect(hash).not.toBe('none');
  });

  it('produces consistent hash for same BorderSpec', () => {
    const borderSpec: BorderSpec = {
      style: 'double',
      width: 8,
      color: 'FF0000',
      space: 2,
    };

    const hash1 = hashTableBorderValue(borderSpec);
    const hash2 = hashTableBorderValue(borderSpec);

    expect(hash1).toBe(hash2);
  });
});

describe('hashTableBorders', () => {
  it('handles undefined borders', () => {
    const hash = hashTableBorders(undefined);
    expect(hash).toBe('');
  });

  it('hashes all six border positions', () => {
    const borders: TableBorders = {
      top: { style: 'single', width: 4 },
      right: { style: 'single', width: 4 },
      bottom: { style: 'single', width: 4 },
      left: { style: 'single', width: 4 },
      insideH: { style: 'single', width: 2 },
      insideV: { style: 'single', width: 2 },
    };

    const hash = hashTableBorders(borders);

    expect(hash).toContain('t:[');
    expect(hash).toContain('r:[');
    expect(hash).toContain('b:[');
    expect(hash).toContain('l:[');
    expect(hash).toContain('ih:[');
    expect(hash).toContain('iv:[');
  });

  it('produces different hashes when any border changes', () => {
    const borders1: TableBorders = {
      top: { style: 'single', width: 4 },
      right: { style: 'single', width: 4 },
    };
    const borders2: TableBorders = {
      top: { style: 'double', width: 4 }, // Changed style
      right: { style: 'single', width: 4 },
    };

    const hash1 = hashTableBorders(borders1);
    const hash2 = hashTableBorders(borders2);

    expect(hash1).not.toBe(hash2);
  });

  it('handles partial border definitions', () => {
    const borders: TableBorders = {
      top: { style: 'single', width: 4 },
      // Only top border defined
    };

    const hash = hashTableBorders(borders);

    expect(hash).toContain('t:[');
    expect(hash).not.toContain('r:[');
    expect(hash).not.toContain('b:[');
  });

  it('handles null border values (inherit)', () => {
    const borders: TableBorders = {
      top: null, // Inherit
      right: { style: 'single', width: 4 },
    };

    const hash = hashTableBorders(borders);

    expect(hash).toContain('t:[null]');
    expect(hash).toContain('r:[s:single,w:4]');
  });

  it('handles none border values (explicit no border)', () => {
    const borders: TableBorders = {
      top: { none: true },
      right: { style: 'single', width: 4 },
    };

    const hash = hashTableBorders(borders);

    expect(hash).toContain('t:[none]');
    expect(hash).toContain('r:[s:single,w:4]');
  });

  it('produces consistent hash for same borders', () => {
    const borders: TableBorders = {
      top: { style: 'single', width: 4, color: '000000' },
      bottom: { style: 'double', width: 8 },
      insideH: null,
      insideV: { none: true },
    };

    const hash1 = hashTableBorders(borders);
    const hash2 = hashTableBorders(borders);

    expect(hash1).toBe(hash2);
  });

  it('uses consistent ordering of border positions', () => {
    const borders: TableBorders = {
      insideV: { style: 'single', width: 2 },
      top: { style: 'single', width: 4 },
      left: { style: 'single', width: 4 },
    };

    const hash = hashTableBorders(borders);

    // Should always be in order: top, right, bottom, left, insideH, insideV
    const topIndex = hash.indexOf('t:[');
    const leftIndex = hash.indexOf('l:[');
    const insideVIndex = hash.indexOf('iv:[');

    expect(topIndex).toBeLessThan(leftIndex);
    expect(leftIndex).toBeLessThan(insideVIndex);
  });
});

describe('hashCellBorders', () => {
  it('handles undefined borders', () => {
    const hash = hashCellBorders(undefined);
    expect(hash).toBe('');
  });

  it('hashes all four sides', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 4 },
      right: { style: 'single', width: 4 },
      bottom: { style: 'single', width: 4 },
      left: { style: 'single', width: 4 },
    };

    const hash = hashCellBorders(borders);

    expect(hash).toContain('t:[');
    expect(hash).toContain('r:[');
    expect(hash).toContain('b:[');
    expect(hash).toContain('l:[');
  });

  it('produces different hashes when any side changes', () => {
    const borders1: CellBorders = {
      top: { style: 'single', width: 4 },
      right: { style: 'single', width: 4 },
    };
    const borders2: CellBorders = {
      top: { style: 'single', width: 4 },
      right: { style: 'double', width: 4 }, // Changed style
    };

    const hash1 = hashCellBorders(borders1);
    const hash2 = hashCellBorders(borders2);

    expect(hash1).not.toBe(hash2);
  });

  it('invalidates layout when either diagonal changes', () => {
    const base: CellBorders = { tl2br: { style: 'single', width: 1, color: '#000080' } };
    expect(hashCellBorders(base)).not.toBe(hashCellBorders({ ...base, tl2br: { ...base.tl2br, width: 2 } }));
    expect(hashCellBorders(base)).not.toBe(hashCellBorders({ ...base, tr2bl: { style: 'single', width: 1 } }));
  });

  it('handles partial border definitions', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 4 },
      // Only top border defined
    };

    const hash = hashCellBorders(borders);

    expect(hash).toContain('t:[');
    expect(hash).not.toContain('r:[');
    expect(hash).not.toContain('b:[');
    expect(hash).not.toContain('l:[');
  });

  it('produces consistent hash for same borders', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 4, color: '000000' },
      bottom: { style: 'double', width: 8, color: 'FF0000', space: 2 },
    };

    const hash1 = hashCellBorders(borders);
    const hash2 = hashCellBorders(borders);

    expect(hash1).toBe(hash2);
  });

  it('uses consistent ordering of sides', () => {
    const borders: CellBorders = {
      bottom: { style: 'single', width: 4 },
      top: { style: 'single', width: 4 },
      right: { style: 'single', width: 4 },
    };

    const hash = hashCellBorders(borders);

    // Should always be in order: top, right, bottom, left
    const topIndex = hash.indexOf('t:[');
    const rightIndex = hash.indexOf('r:[');
    const bottomIndex = hash.indexOf('b:[');

    expect(topIndex).toBeLessThan(rightIndex);
    expect(rightIndex).toBeLessThan(bottomIndex);
  });

  it('handles empty border specs', () => {
    const borders: CellBorders = {
      top: {},
    };

    const hash = hashCellBorders(borders);

    expect(hash).toContain('t:[]');
  });

  it('handles complex border specs with all properties', () => {
    const borders: CellBorders = {
      top: {
        style: 'dashDotStroked',
        width: 12,
        color: 'FF0000',
        space: 4,
      },
      right: {
        style: 'triple',
        width: 8,
        color: '00FF00',
        space: 2,
      },
    };

    const hash = hashCellBorders(borders);

    expect(hash).toContain('s:dashDotStroked');
    expect(hash).toContain('w:12');
    expect(hash).toContain('c:FF0000');
    expect(hash).toContain('sp:4');
    expect(hash).toContain('s:triple');
    expect(hash).toContain('w:8');
    expect(hash).toContain('c:00FF00');
    expect(hash).toContain('sp:2');
  });
});

describe('hashParagraphBorders', () => {
  it('includes between border in hash with bw: prefix', () => {
    const borders: ParagraphBorders = {
      top: { style: 'solid', width: 1, color: '#000' },
      between: { style: 'solid', width: 2, color: '#FF0000' },
    };
    const hash = hashParagraphBorders(borders);
    expect(hash).toContain('t:[');
    expect(hash).toContain('bw:[');
    expect(hash).toContain('w:2');
  });

  it('produces different hashes with and without between', () => {
    const with_: ParagraphBorders = {
      top: { style: 'solid', width: 1 },
      between: { style: 'solid', width: 1 },
    };
    const without_: ParagraphBorders = {
      top: { style: 'solid', width: 1 },
    };
    expect(hashParagraphBorders(with_)).not.toBe(hashParagraphBorders(without_));
  });

  it('does not include bw: when between is undefined', () => {
    const borders: ParagraphBorders = {
      top: { style: 'solid', width: 1 },
      bottom: { style: 'solid', width: 1 },
    };
    expect(hashParagraphBorders(borders)).not.toContain('bw:');
  });

  it('places bw: after l: in hash output', () => {
    const borders: ParagraphBorders = {
      left: { style: 'solid', width: 1 },
      between: { style: 'solid', width: 1 },
    };
    const hash = hashParagraphBorders(borders);
    expect(hash.indexOf('l:[')).toBeLessThan(hash.indexOf('bw:['));
  });
});

describe('hashParagraphAttrs', () => {
  it('includes between border in attrs hash via borders', () => {
    const attrs: ParagraphAttrs = {
      borders: {
        top: { style: 'solid', width: 1 },
        between: { style: 'solid', width: 2, color: '#F00' },
      },
    };
    const hash = hashParagraphAttrs(attrs);
    expect(hash).toContain('br:');
    expect(hash).toContain('bw:[');
  });

  it('produces different hashes when between border changes', () => {
    const attrs1: ParagraphAttrs = {
      borders: {
        top: { style: 'solid', width: 1 },
        between: { style: 'solid', width: 1 },
      },
    };
    const attrs2: ParagraphAttrs = {
      borders: {
        top: { style: 'solid', width: 1 },
        between: { style: 'dashed', width: 2 },
      },
    };
    expect(hashParagraphAttrs(attrs1)).not.toBe(hashParagraphAttrs(attrs2));
  });

  it('produces different hashes when between border is added', () => {
    const withoutBetween: ParagraphAttrs = {
      borders: { top: { style: 'solid', width: 1 } },
    };
    const withBetween: ParagraphAttrs = {
      borders: {
        top: { style: 'solid', width: 1 },
        between: { style: 'solid', width: 1 },
      },
    };
    expect(hashParagraphAttrs(withoutBetween)).not.toBe(hashParagraphAttrs(withBetween));
  });
});
