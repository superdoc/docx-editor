/**
 * Tests for run visual mark hashing (measure cache + dirty diff alignment).
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vite-plus/test';
import { hashRunVisualMarks } from '../src/run-visual-marks';
import type { Run } from '@superdoc/contracts';

describe('hashRunVisualMarks', () => {
  it('is deterministic for the same run object', () => {
    const run = {
      text: 'Hello',
      fontFamily: 'Arial',
      fontSize: 12,
      bold: true,
      color: '#112233',
    } as Run;

    expect(hashRunVisualMarks(run)).toBe(hashRunVisualMarks(run));
  });

  it('returns only font metrics when no bold/italic/underline/strike/highlight/link', () => {
    const run = {
      text: 'Hello',
      fontFamily: 'Times New Roman',
      fontSize: 14,
    } as Run;

    expect(hashRunVisualMarks(run)).toBe('fs:14ff:Times New Roman');
  });

  it('encodes bold and italic', () => {
    expect(hashRunVisualMarks({ bold: true } as Run)).toBe('b');
    expect(hashRunVisualMarks({ italic: true } as Run)).toBe('i');
    expect(hashRunVisualMarks({ bold: true, italic: true } as Run)).toBe('bi');
  });

  it('encodes underline with JSON payload', () => {
    const underline = { style: 'single' as const, color: '#00FF00' };
    const run = { underline } as Run;

    expect(hashRunVisualMarks(run)).toBe(`u:${JSON.stringify(underline)}`);
  });

  it('encodes strike', () => {
    expect(hashRunVisualMarks({ strike: true } as Run)).toBe('s');
  });

  it('concatenates color without prefix', () => {
    expect(hashRunVisualMarks({ color: '#FF0000' } as Run)).toBe('#FF0000');
  });

  it('treats missing color like empty string segment', () => {
    const a = {} as Run;
    const b = { color: '' } as Run;
    expect(hashRunVisualMarks(a)).toBe('');
    expect(hashRunVisualMarks(b)).toBe('');
  });

  it('encodes fontSize and fontFamily with prefixes', () => {
    expect(hashRunVisualMarks({ fontSize: 11 } as Run)).toBe('fs:11');
    expect(hashRunVisualMarks({ fontFamily: 'Calibri' } as Run)).toBe('ff:Calibri');
  });

  it('encodes highlight', () => {
    expect(hashRunVisualMarks({ highlight: 'yellow' } as Run)).toBe('hl:yellow');
  });

  it('encodes link with JSON payload', () => {
    const link = { href: 'https://example.com', title: 'Example' };
    const run = { link } as Run;

    expect(hashRunVisualMarks(run)).toBe(`ln:${JSON.stringify(link)}`);
  });

  it('produces different hashes when any encoded field changes', () => {
    const base = {
      text: 'x',
      fontFamily: 'Arial',
      fontSize: 12,
      bold: false,
      italic: false,
      color: '#000000',
    } as Run;

    const h0 = hashRunVisualMarks(base);
    expect(hashRunVisualMarks({ ...base, bold: true } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, italic: true } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, underline: { style: 'single' as const } } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, strike: true } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, color: '#FFFFFF' } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, fontSize: 13 } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, fontFamily: 'Georgia' } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, highlight: 'cyan' } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, link: { href: 'https://a.test' } } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, textTransform: 'uppercase' } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, vanish: true } as Run)).not.toBe(h0);
    expect(hashRunVisualMarks({ ...base, horizontalScale: 0.9 } as Run)).not.toBe(h0);
  });

  it('ignores properties not read by the helper (e.g. letterSpacing)', () => {
    const a = { fontFamily: 'Arial', fontSize: 12, letterSpacing: 1 } as Run;
    const b = { fontFamily: 'Arial', fontSize: 12, letterSpacing: 2 } as Run;

    expect(hashRunVisualMarks(a)).toBe(hashRunVisualMarks(b));
  });

  // SD-3098: DomPainter applies dir="rtl" + RLM injection based on run.bidi.rtl,
  // so the dirty-run hash must change when bidi changes, otherwise an edit that
  // flips just <w:rtl/> reuses the stale measure/DOM.
  describe('bidi (SD-3098)', () => {
    const base = {
      text: '23.03.2026',
      fontFamily: 'David, sans-serif',
      fontSize: 16,
    } as Run;

    it('produces a different hash when bidi.rtl is set vs absent', () => {
      const hashPlain = hashRunVisualMarks(base);
      const hashRtl = hashRunVisualMarks({ ...base, bidi: { rtl: true } } as Run);
      expect(hashRtl).not.toBe(hashPlain);
    });

    it('produces a different hash for bidi.rtl=true vs bidi.rtl=false', () => {
      const hashTrue = hashRunVisualMarks({ ...base, bidi: { rtl: true } } as Run);
      const hashFalse = hashRunVisualMarks({ ...base, bidi: { rtl: false } } as Run);
      expect(hashTrue).not.toBe(hashFalse);
    });

    it('produces a different hash when only bidi.embedding changes', () => {
      const hashLtr = hashRunVisualMarks({ ...base, bidi: { rtl: false, embedding: 'ltr' } } as Run);
      const hashRtlEmbed = hashRunVisualMarks({ ...base, bidi: { rtl: false, embedding: 'rtl' } } as Run);
      expect(hashRtlEmbed).not.toBe(hashLtr);
    });

    it('is stable for identical bidi shapes', () => {
      const a = hashRunVisualMarks({ ...base, bidi: { rtl: true } } as Run);
      const b = hashRunVisualMarks({ ...base, bidi: { rtl: true } } as Run);
      expect(a).toBe(b);
    });
  });
  /**
   * This hash is what dirty-run detection compares, so a paint-only mark that
   * does not move it leaves the already-painted span on screen. For the Word
   * 97-2003 effects that is the exact symptom they were added to fix — the file
   * changes and the page does not — reappearing one layer up.
   */
  describe('Word 97-2003 effect flags', () => {
    const base = { text: 'Styled', fontFamily: 'Arial', fontSize: 12 } as Run;

    it('produces a different hash for each flag', () => {
      for (const mark of ['doubleStrike', 'outline', 'shadow', 'emboss', 'imprint'] as const) {
        expect(hashRunVisualMarks({ ...base, [mark]: true } as Run)).not.toBe(hashRunVisualMarks(base));
      }
    });

    it('distinguishes the flags from one another', () => {
      const hashes = (['doubleStrike', 'outline', 'shadow', 'emboss', 'imprint'] as const).map((mark) =>
        hashRunVisualMarks({ ...base, [mark]: true } as Run),
      );

      expect(new Set(hashes).size).toBe(hashes.length);
    });
  });
});
