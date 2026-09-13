import { beforeAll, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Line, Run } from '@superdoc/contracts';
import { resolvePhysicalFamily } from '@superdoc/font-system';
import { findCharacterAtX, measureCharacterX, charOffsetToPm, getRunFontString } from '../src/text-measurement.ts';

// Helper to count spaces (tests functionality indirectly through justify calculations)
const countSpaces = (text: string): number => {
  let spaces = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ' ' || text[i] === '\u00A0') {
      spaces += 1;
    }
  }
  return spaces;
};

// Helper to test justify adjustment by measuring with different available widths
const testJustifyAdjustment = (
  block: FlowBlock,
  line: Line,
  availableWidth: number,
): { extraPerSpace: number; totalSpaces: number } => {
  // Measure a position with normal width
  const normalWidth = measureCharacterX(block, line, 1, line.width);
  // Measure with increased available width (which should add justify spacing)
  const wideWidth = measureCharacterX(block, line, 1, availableWidth);

  // If justified, the difference reveals the extra spacing
  const diff = wideWidth - normalWidth;
  const spaceCount = countSpaces(
    line.segments ? '' : block.kind === 'paragraph' ? block.runs.map((r) => ('text' in r ? r.text : '')).join('') : '',
  );

  return {
    extraPerSpace: spaceCount > 0 ? diff / spaceCount : 0,
    totalSpaces: spaceCount,
  };
};

const CHAR_WIDTH = 10;

const ensureDocumentStub = (): void => {
  if (typeof document !== 'undefined') return;
  const ctx = {
    font: '',
    measureText(text: string) {
      const charWidth = this.font.includes('DocumentWide') ? CHAR_WIDTH * 2 : CHAR_WIDTH;
      const kerningAdjustment = this.font.includes('KerningProbe') ? (text.match(/AV/g)?.length ?? 0) * 2 : 0;
      return { width: text.length * charWidth - kerningAdjustment } as TextMetrics;
    },
  };
  (globalThis as any).document = {
    createElement() {
      return {
        getContext() {
          return ctx;
        },
      };
    },
  } as Document;
};

beforeAll(() => {
  ensureDocumentStub();
});

const createBlock = (runs: Run[]): FlowBlock => ({
  kind: 'paragraph',
  id: 'test-block',
  runs,
});

const baseLine = (overrides?: Partial<Line>): Line => ({
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: 0,
  width: 200,
  ascent: 12,
  descent: 4,
  lineHeight: 20,
  ...overrides,
});

describe('text measurement utility', () => {
  it('measures text with the shared physical font family', () => {
    expect(getRunFontString({ text: 'Editable', fontFamily: 'Calibri', fontSize: 16 })).toBe(
      `normal normal 16px ${resolvePhysicalFamily('Calibri')}`,
    );
    expect(
      getRunFontString({ text: 'Bold italic', fontFamily: 'Calibri', fontSize: 16, bold: true, italic: true }),
    ).toBe(`italic bold 16px ${resolvePhysicalFamily('Calibri')}`);
  });

  it('uses a supplied document font context for forward and inverse character geometry', () => {
    const documentFontContext = {
      fontSignature: 'document-wide-v1',
      resolvePhysical: () => 'DocumentWide',
    };
    const block = createBlock([{ text: 'ABCD', fontFamily: 'Calibri', fontSize: 16 }]);
    const line = baseLine({ fromRun: 0, toRun: 0, toChar: 4, width: 80 });

    expect(getRunFontString(block.runs[0]!, documentFontContext)).toBe('normal normal 16px DocumentWide');
    expect(measureCharacterX(block, line, 3)).toBe(30);
    expect(measureCharacterX(block, line, 3, undefined, undefined, documentFontContext)).toBe(60);
    expect(findCharacterAtX(block, line, 32, 0).charOffset).toBe(3);
    expect(findCharacterAtX(block, line, 32, 0, undefined, undefined, documentFontContext).charOffset).toBe(2);
  });

  it('places an interior caret at the fully shaped run boundary', () => {
    const kerningFontContext = {
      fontSignature: 'kerning-probe-v1',
      resolvePhysical: () => 'KerningProbe',
    };
    const block = createBlock([{ text: 'AV', fontFamily: 'KerningProbe', fontSize: 16 }]);
    const line = baseLine({ fromRun: 0, toRun: 0, toChar: 2, width: 18 });

    // The AV pair is 2px tighter than two isolated 10px glyphs. CSS shapes the
    // whole painted run, so the caret before V owns that pair adjustment and
    // sits at x=8, not at measureText('A')=10.
    expect(measureCharacterX(block, line, 1, undefined, undefined, kerningFontContext)).toBe(8);
    expect(measureCharacterX(block, line, 2, undefined, undefined, kerningFontContext)).toBe(18);
    expect(findCharacterAtX(block, line, 8, 0, undefined, undefined, kerningFontContext).charOffset).toBe(1);
  });

  it('uses the document font context for explicitly positioned line segments', () => {
    const documentFontContext = {
      fontSignature: 'document-wide-v1',
      resolvePhysical: () => 'DocumentWide',
    };
    const block = createBlock([{ text: 'ABCD', fontFamily: 'Calibri', fontSize: 16 }]);
    const line = baseLine({
      fromRun: 0,
      toRun: 0,
      toChar: 4,
      width: 80,
      segments: [{ runIndex: 0, fromChar: 0, toChar: 4, x: 0, width: 80 }],
    });

    expect(measureCharacterX(block, line, 3, undefined, undefined, documentFontContext)).toBe(60);
  });

  it('measures across multiple runs', () => {
    const block = createBlock([
      { text: 'Hello', fontFamily: 'Arial', fontSize: 16 },
      { text: 'World', fontFamily: 'Arial', fontSize: 16 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 1,
      toChar: 5,
    });

    expect(measureCharacterX(block, line, 5)).toBe(5 * CHAR_WIDTH);
    expect(measureCharacterX(block, line, 8)).toBe(8 * CHAR_WIDTH);
  });

  it('accounts for letter spacing when measuring', () => {
    const block = createBlock([{ text: 'AB', fontFamily: 'Arial', fontSize: 16, letterSpacing: 2 }]);
    const line = baseLine({
      fromRun: 0,
      toRun: 0,
      toChar: 2,
      width: CHAR_WIDTH * 2 + 2,
    });

    expect(measureCharacterX(block, line, 1)).toBe(CHAR_WIDTH + 2);
    expect(measureCharacterX(block, line, 2)).toBe(CHAR_WIDTH * 2 + 2);
  });

  it('maps X coordinates back to character offsets within runs', () => {
    const block = createBlock([
      { text: 'Hello', fontFamily: 'Arial', fontSize: 16 },
      { text: 'World', fontFamily: 'Arial', fontSize: 16 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 1,
      toChar: 5,
    });

    const result = findCharacterAtX(block, line, 73, 0);
    expect(result.charOffset).toBe(7);
    expect(result.pmPosition).toBe(7);
  });

  it('preserves PM gaps between runs when mapping X to positions', () => {
    const block = createBlock([
      { text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 2, pmEnd: 7 },
      { text: 'World', fontFamily: 'Arial', fontSize: 16, pmStart: 9, pmEnd: 14 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 1,
      toChar: 5,
      width: 10 * CHAR_WIDTH,
    });

    const result = findCharacterAtX(block, line, 7 * CHAR_WIDTH, 2);
    expect(result.charOffset).toBe(7);
    expect(result.pmPosition).toBe(11);
  });

  it('respects letter spacing when mapping X to characters', () => {
    const block = createBlock([{ text: 'AB', fontFamily: 'Arial', fontSize: 16, letterSpacing: 2 }]);
    const line = baseLine({
      fromRun: 0,
      toRun: 0,
      toChar: 2,
      width: CHAR_WIDTH * 2 + 2,
    });

    const midGap = findCharacterAtX(block, line, CHAR_WIDTH + 1, 100);
    expect(midGap.charOffset).toBe(1);
    expect(midGap.pmPosition).toBe(101);

    const beyondEnd = findCharacterAtX(block, line, 1000, 100);
    expect(beyondEnd.charOffset).toBe(2);
    expect(beyondEnd.pmPosition).toBe(102);
  });

  it('handles tab runs with fixed width', () => {
    const block = createBlock([
      { text: 'Before', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6 },
      { kind: 'tab', text: '\t', width: 48, pmStart: 6, pmEnd: 7 },
      { text: 'After', fontFamily: 'Arial', fontSize: 16, pmStart: 7, pmEnd: 12 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 2,
      toChar: 5,
      width: 6 * CHAR_WIDTH + 48 + 5 * CHAR_WIDTH,
    });

    // Measure character positions
    // Before tab: positions 0-6
    expect(measureCharacterX(block, line, 6)).toBe(6 * CHAR_WIDTH);
    // At tab start (position 6 -> 7 in PM)
    expect(measureCharacterX(block, line, 7)).toBe(6 * CHAR_WIDTH + 48);
    // After tab
    expect(measureCharacterX(block, line, 8)).toBe(6 * CHAR_WIDTH + 48 + CHAR_WIDTH);
  });

  it('maps clicks on tabs to correct PM positions', () => {
    const block = createBlock([
      { text: 'A', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
      { kind: 'tab', text: '\t', width: 48, pmStart: 1, pmEnd: 2 },
      { text: 'B', fontFamily: 'Arial', fontSize: 16, pmStart: 2, pmEnd: 3 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 2,
      toChar: 1,
      width: CHAR_WIDTH + 48 + CHAR_WIDTH,
    });

    // Click on left half of tab -> should return pmStart (before tab)
    const leftHalf = findCharacterAtX(block, line, CHAR_WIDTH + 20, 0);
    expect(leftHalf.pmPosition).toBe(1);

    // Click on right half of tab -> should return pmEnd (after tab)
    const rightHalf = findCharacterAtX(block, line, CHAR_WIDTH + 30, 0);
    expect(rightHalf.pmPosition).toBe(2);

    // Click after tab (in the 'B' character)
    const afterTab = findCharacterAtX(block, line, CHAR_WIDTH + 48 + 5, 0);
    expect(afterTab.pmPosition).toBeGreaterThanOrEqual(2);
    expect(afterTab.pmPosition).toBeLessThanOrEqual(3);
  });

  it('handles multiple consecutive tabs', () => {
    const block = createBlock([
      { text: 'A', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
      { kind: 'tab', text: '\t', width: 48, pmStart: 1, pmEnd: 2 },
      { kind: 'tab', text: '\t', width: 48, pmStart: 2, pmEnd: 3 },
      { text: 'B', fontFamily: 'Arial', fontSize: 16, pmStart: 3, pmEnd: 4 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 3,
      toChar: 1,
      width: CHAR_WIDTH + 48 + 48 + CHAR_WIDTH,
    });

    // Position after first tab
    expect(measureCharacterX(block, line, 2)).toBe(CHAR_WIDTH + 48);
    // Position after second tab
    expect(measureCharacterX(block, line, 3)).toBe(CHAR_WIDTH + 48 + 48);

    // Click on first tab
    const firstTab = findCharacterAtX(block, line, CHAR_WIDTH + 24, 0);
    expect(firstTab.pmPosition).toBeGreaterThanOrEqual(1);
    expect(firstTab.pmPosition).toBeLessThanOrEqual(2);

    // Click on second tab
    const secondTab = findCharacterAtX(block, line, CHAR_WIDTH + 48 + 24, 0);
    expect(secondTab.pmPosition).toBeGreaterThanOrEqual(2);
    expect(secondTab.pmPosition).toBeLessThanOrEqual(3);
  });

  it('maps clicks through leading visual-only marker runs to editable PM positions', () => {
    const block = createBlock([
      { text: '1', fontFamily: 'Arial', fontSize: 16, dataAttrs: { 'data-sd-footnote-number': 'true' } } as Run,
      { text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 1,
      toChar: 6,
      width: 6 * CHAR_WIDTH,
    });

    const markerHit = findCharacterAtX(block, line, CHAR_WIDTH / 2, 0);
    expect(markerHit.pmPosition).toBe(0);

    const textHit = findCharacterAtX(block, line, CHAR_WIDTH * 3.5, 0);
    expect(textHit.pmPosition).toBe(3);
  });

  it('keeps vanished runs addressable without displacing visible caret geometry', () => {
    const block = createBlock([
      { text: 'abcdef', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6, vanish: true },
      { text: 'X', fontFamily: 'Arial', fontSize: 16, pmStart: 6, pmEnd: 7 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 1,
      toChar: 1,
      width: CHAR_WIDTH,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 6, width: 0 },
        { runIndex: 1, fromChar: 0, toChar: 1, width: CHAR_WIDTH },
      ],
    });

    expect(measureCharacterX(block, line, 0)).toBe(0);
    expect(measureCharacterX(block, line, 3)).toBe(0);
    expect(measureCharacterX(block, line, 6)).toBe(0);
    expect(measureCharacterX(block, line, 7)).toBe(CHAR_WIDTH);

    const visibleHit = findCharacterAtX(block, line, CHAR_WIDTH / 2, 0);
    expect(visibleHit.charOffset).toBe(7);
    expect(visibleHit.pmPosition).toBe(7);
  });

  it('keeps vanished runs zero-width in explicitly positioned segment geometry', () => {
    const block = createBlock([
      { text: 'abcdef', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6, vanish: true },
      { kind: 'tab', text: '\t', width: 48, pmStart: 6, pmEnd: 7 },
      { text: 'X', fontFamily: 'Arial', fontSize: 16, pmStart: 7, pmEnd: 8 },
    ]);
    const line = baseLine({
      fromRun: 0,
      toRun: 2,
      toChar: 1,
      width: 58,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 6, width: 0 },
        { runIndex: 1, fromChar: 0, toChar: 1, x: 0, width: 48 },
        { runIndex: 2, fromChar: 0, toChar: 1, width: CHAR_WIDTH },
      ],
    });

    expect(measureCharacterX(block, line, 3)).toBe(0);
    expect(measureCharacterX(block, line, 6)).toBe(0);
    expect(measureCharacterX(block, line, 7)).toBe(48);
    expect(measureCharacterX(block, line, 8)).toBe(48 + CHAR_WIDTH);
  });

  describe('charOffsetToPm edge cases', () => {
    it('clamps character offset beyond line bounds to end position', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
      });

      // Character offset beyond line length should clamp to last valid PM position
      const result = charOffsetToPm(block, line, 100, 0);
      expect(result).toBe(5); // Should return pmEnd
    });

    it('clamps negative character offset to start position', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 10, pmEnd: 15 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
      });

      // Negative offset should clamp to 0, which maps to pmStart
      const result = charOffsetToPm(block, line, -5, 10);
      expect(result).toBe(10); // Should return fallback/pmStart
    });

    it('handles runs with missing pmEnd gracefully', () => {
      const block = createBlock([
        { text: 'Test', fontFamily: 'Arial', fontSize: 16, pmStart: 5 } as any, // Missing pmEnd
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 4,
      });

      // Should infer pmEnd from pmStart + text length
      const result = charOffsetToPm(block, line, 2, 5);
      expect(result).toBe(7); // pmStart (5) + offset (2)
    });

    it('handles runs with missing pmStart gracefully', () => {
      const block = createBlock([
        { text: 'Test', fontFamily: 'Arial', fontSize: 16, pmEnd: 10 } as any, // Missing pmStart
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 4,
      });

      // When pmStart is missing, the function infers it from pmEnd - textLength
      // pmEnd = 10, textLength = 4, so inferred pmStart = 6
      // charOffset 2 maps to position 6 + 2 = 8
      const result = charOffsetToPm(block, line, 2, 100);
      expect(result).toBe(8); // inferred pmStart (6) + offset (2)
    });

    it('returns fallback position for non-paragraph blocks', () => {
      const block = {
        kind: 'table',
        id: 'test-block',
        rows: [],
      } as any;
      const line = baseLine();

      // Non-paragraph blocks should use fallback calculation
      const result = charOffsetToPm(block, line, 5, 50);
      expect(result).toBe(55); // fallback (50) + offset (5)
    });

    it('handles character offset at exact line boundary', () => {
      const block = createBlock([{ text: 'Exact', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
      });

      // Offset exactly at line end
      const result = charOffsetToPm(block, line, 5, 0);
      expect(result).toBe(5);
    });

    it('handles line with only tab runs', () => {
      const block = createBlock([
        { kind: 'tab', text: '\t', width: 48, pmStart: 0, pmEnd: 1 },
        { kind: 'tab', text: '\t', width: 48, pmStart: 1, pmEnd: 2 },
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 1,
        toChar: 1, // Each tab counts as 1 character
        width: 96,
      });

      // First tab
      const result1 = charOffsetToPm(block, line, 0, 0);
      expect(result1).toBe(0);

      // Second tab
      const result2 = charOffsetToPm(block, line, 1, 0);
      expect(result2).toBe(1);

      // After both tabs
      const result3 = charOffsetToPm(block, line, 2, 0);
      expect(result3).toBe(2);
    });

    it('handles empty runs in the middle of a line', () => {
      const block = createBlock([
        { text: 'Before', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6 },
        { text: '', fontFamily: 'Arial', fontSize: 16, pmStart: 6, pmEnd: 6 }, // Empty run
        { text: 'After', fontFamily: 'Arial', fontSize: 16, pmStart: 6, pmEnd: 11 },
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 2,
        toChar: 5,
      });

      // Character in first run
      const result1 = charOffsetToPm(block, line, 3, 0);
      expect(result1).toBe(3);

      // Character in last run (empty run shouldn't affect count)
      const result2 = charOffsetToPm(block, line, 8, 0);
      expect(result2).toBe(8);
    });

    it('handles runs with zero-length text correctly', () => {
      const block = createBlock([{ text: '', fontFamily: 'Arial', fontSize: 16, pmStart: 5, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 0,
      });

      const result = charOffsetToPm(block, line, 0, 5);
      expect(result).toBe(5);
    });

    it('does not advance PM positions through visual-only marker runs', () => {
      const block = createBlock([
        { text: '1', fontFamily: 'Arial', fontSize: 16, dataAttrs: { 'data-sd-footnote-number': 'true' } } as Run,
        { text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 },
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 1,
        toChar: 6,
      });

      expect(charOffsetToPm(block, line, 0, 0)).toBe(0);
      expect(charOffsetToPm(block, line, 1, 0)).toBe(0);
      expect(charOffsetToPm(block, line, 3, 0)).toBe(2);
    });

    it('clamps a multi-digit body note reference to its one-unit PM range', () => {
      const block = createBlock([
        {
          kind: 'text',
          text: '10',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 20,
          pmEnd: 21,
          dataAttrs: { 'data-v2-note-ref': 'footnote:10' },
        },
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 2,
      });

      expect(charOffsetToPm(block, line, 0, 20)).toBe(20);
      expect(charOffsetToPm(block, line, 1, 20)).toBe(21);
      expect(charOffsetToPm(block, line, 2, 20)).toBe(21);
    });
  });

  describe('countSpaces helper', () => {
    // These tests verify the countSpaces helper used above
    it('counts regular spaces correctly', () => {
      expect(countSpaces('Hello World')).toBe(1);
      expect(countSpaces('A B C D')).toBe(3);
      expect(countSpaces('   ')).toBe(3);
    });

    it('counts non-breaking spaces correctly', () => {
      expect(countSpaces('Hello\u00A0World')).toBe(1);
      expect(countSpaces('\u00A0\u00A0\u00A0')).toBe(3);
    });

    it('counts both regular and non-breaking spaces', () => {
      expect(countSpaces('A \u00A0B')).toBe(2);
      expect(countSpaces(' \u00A0 \u00A0 ')).toBe(5);
    });

    it('returns zero for text with no spaces', () => {
      expect(countSpaces('HelloWorld')).toBe(0);
      expect(countSpaces('no-spaces')).toBe(0);
      expect(countSpaces('')).toBe(0);
    });

    it('does not count other whitespace characters', () => {
      // Tab, newline, etc. are not counted
      expect(countSpaces('Hello\tWorld')).toBe(0);
      expect(countSpaces('Hello\nWorld')).toBe(0);
    });
  });

  describe('justify alignment integration', () => {
    // These tests verify that justify alignment works correctly through the public API
    it('applies justify spacing for justified text', () => {
      // Use two runs so the first line is NOT the last line (last lines skip justify)
      const block = createBlock([
        { text: 'A B', fontFamily: 'Arial', fontSize: 16 },
        { text: 'C D', fontFamily: 'Arial', fontSize: 16 },
      ]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0, // First line only covers first run
        toChar: 3,
        width: 30,
        maxWidth: 100,
      });
      (block as any).attrs = { alignment: 'justify' };

      // Measure position 2 (after the space 'A B') - this should show justify adjustment
      const x2Normal = measureCharacterX(block, line, 2, 30); // No slack
      const x2Justified = measureCharacterX(block, line, 2, 100); // With slack

      // Justified should be wider (extra space distributed after first space)
      expect(x2Justified).toBeGreaterThan(x2Normal);
    });

    it('keeps CJK caret and hit geometry aligned with measured character boundaries', () => {
      const block = createBlock([
        { text: '春天来到', fontFamily: 'Arial', fontSize: 16 },
        { text: '后续', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 4,
        width: 40,
        maxWidth: 70,
        justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3] },
      });

      expect([0, 1, 2, 3, 4].map((offset) => measureCharacterX(block, line, offset, 70))).toEqual([0, 20, 40, 60, 70]);
      expect(findCharacterAtX(block, line, 35, 0, 70).charOffset).toBe(2);
    });

    it.each(['春天，来到', '春天,来到'])('keeps punctuated CJK caret and hit geometry aligned: %s', (text) => {
      const block = createBlock([
        { text, fontFamily: 'Arial', fontSize: 16 },
        { text: '后续', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: text.length,
        width: 50,
        maxWidth: 90,
        justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3, 4] },
      });

      expect([0, 1, 2, 3, 4, 5].map((offset) => measureCharacterX(block, line, offset, 90))).toEqual([
        0, 20, 40, 60, 80, 90,
      ]);
      expect(findCharacterAtX(block, line, 51, 0, 90).charOffset).toBe(3);
    });

    it('applies CJK justify advance only after a complete grapheme', () => {
      const block = createBlock([
        { text: '한글', fontFamily: 'Arial', fontSize: 16 },
        { text: '후속', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 4,
        width: 40,
        maxWidth: 70,
        justificationPlan: { type: 'inter-character', boundaries: [3] },
      });

      const natural = [0, 1, 2, 3, 4].map((offset) => measureCharacterX(block, line, offset, 40));
      const justified = [0, 1, 2, 3, 4].map((offset) => measureCharacterX(block, line, offset, 70));

      expect(justified.slice(0, 3)).toEqual(natural.slice(0, 3));
      expect(justified[3] - natural[3]).toBe(30);
      expect(justified[4] - natural[4]).toBe(30);
    });

    it('does not apply justify spacing for non-justified text', () => {
      const block = createBlock([{ text: 'A B', fontFamily: 'Arial', fontSize: 16 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 3,
        width: 30,
        maxWidth: 100,
      });
      (block as any).attrs = { alignment: 'left' };

      // With left alignment, no extra spacing should be applied
      const x2 = measureCharacterX(block, line, 2, 100);
      const x2Base = measureCharacterX(block, line, 2, 30);

      // Should be the same since no justify
      expect(x2).toBe(x2Base);
    });

    it('skips justify spacing on the last line of a paragraph', () => {
      // Single-line paragraph: the line IS the last line, so justify should be skipped
      const block = createBlock([{ text: 'A B', fontFamily: 'Arial', fontSize: 16 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0, // Same as block.runs.length - 1, so this is the last line
        toChar: 3,
        width: 30,
        maxWidth: 100,
      });
      (block as any).attrs = { alignment: 'justify' };

      // Even with slack available, last line should NOT have extra justify spacing
      const x2Normal = measureCharacterX(block, line, 2, 30);
      const x2WithSlack = measureCharacterX(block, line, 2, 100);

      // Should be the same since last line skips justify
      expect(x2WithSlack).toBe(x2Normal);
    });

    it('applies justify spacing on last line when paragraph ends with lineBreak', () => {
      // Paragraph ending with lineBreak (soft break / Shift+Enter) SHOULD justify the last line
      const block = createBlock([{ text: 'A B', fontFamily: 'Arial', fontSize: 16 }, { kind: 'lineBreak' as const }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0, // This line doesn't include the lineBreak run
        toChar: 3,
        width: 30,
        maxWidth: 100,
      });
      (block as any).attrs = { alignment: 'justify' };

      // With soft break at end, even last line should be justified
      const x2Normal = measureCharacterX(block, line, 2, 30);
      const x2Justified = measureCharacterX(block, line, 2, 100);

      // Should be justified (wider) because paragraph ends with lineBreak
      expect(x2Justified).toBeGreaterThan(x2Normal);
    });

    it('handles empty runs array without crashing', () => {
      // Empty runs should not crash and should not apply justify
      const block = createBlock([]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 0,
        width: 0,
        maxWidth: 100,
      });
      (block as any).attrs = { alignment: 'justify' };

      // Should not crash and should return 0 for character position 0
      const x0 = measureCharacterX(block, line, 0, 100);
      expect(x0).toBe(0);

      // findCharacterAtX should also handle empty runs
      const result = findCharacterAtX(block, line, 50, 0, 100);
      expect(result.charOffset).toBe(0);
      expect(result.pmPosition).toBe(0);
    });

    it('auto-derives correct flags for multi-line paragraphs', () => {
      // Multi-line paragraph: middle lines should be justified, last line should not
      const block = createBlock([
        { text: 'First line with spaces', fontFamily: 'Arial', fontSize: 16 },
        { text: 'Second line also spaced', fontFamily: 'Arial', fontSize: 16 },
        { text: 'Last line here', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };

      // First line (not last) - should be justified
      const firstLine = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 22,
        width: 220,
        maxWidth: 300,
      });

      const firstX = measureCharacterX(block, firstLine, 10, 300);
      const firstXNormal = measureCharacterX(block, firstLine, 10, 220);
      // Middle lines should be justified
      expect(firstX).toBeGreaterThan(firstXNormal);

      // Middle line (not last) - should be justified
      const middleLine = baseLine({
        fromRun: 1,
        toRun: 1,
        toChar: 23,
        width: 230,
        maxWidth: 300,
      });

      const middleX = measureCharacterX(block, middleLine, 10, 300);
      const middleXNormal = measureCharacterX(block, middleLine, 10, 230);
      // Middle lines should be justified
      expect(middleX).toBeGreaterThan(middleXNormal);

      // Last line - should NOT be justified (auto-derived)
      const lastLine = baseLine({
        fromRun: 2,
        toRun: 2,
        toChar: 14,
        width: 140,
        maxWidth: 300,
      });

      const lastX = measureCharacterX(block, lastLine, 10, 300);
      const lastXNormal = measureCharacterX(block, lastLine, 10, 140);
      // Last line should NOT be justified (same width)
      expect(lastX).toBe(lastXNormal);
    });

    it('applies justify spacing to wrapped non-last lines within a single text run', () => {
      const block = createBlock([{ text: 'A B C D E F', fontFamily: 'Arial', fontSize: 16 }]);
      (block as any).attrs = { alignment: 'justify' };

      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        fromChar: 0,
        toChar: 9, // Wrapped line consumes only part of the single text run
        width: 90,
        maxWidth: 120,
      });

      const xWithNaturalWidth = measureCharacterX(block, line, 7, 90);
      const xWithSlack = measureCharacterX(block, line, 7, 120);

      expect(xWithSlack).toBeGreaterThan(xWithNaturalWidth);
    });

    it('applies justify spacing for manual default tabs without explicit segments', () => {
      const trailingText = 'Item body';
      const tabWidth = 48;
      const block = createBlock([
        { text: '1 ', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'tab', text: '\t', width: tabWidth },
        { text: trailingText, fontFamily: 'Arial', fontSize: 16 },
        { text: ' next line', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };
      const line = baseLine({
        fromRun: 0,
        toRun: 2,
        toChar: trailingText.length,
        width: (2 + trailingText.length) * CHAR_WIDTH + tabWidth,
        maxWidth: 300,
      });

      const targetCharOffset = 10;
      const baseX = measureCharacterX(block, line, targetCharOffset, line.width);
      const wideX = measureCharacterX(block, line, targetCharOffset, 300);
      expect(wideX).toBeGreaterThan(baseX);
    });

    it('still applies justify to lines without any tab runs', () => {
      // Two runs so the first line is not derived as the last line of the paragraph
      const block = createBlock([
        { text: 'hello world foo', fontFamily: 'Arial', fontSize: 16 },
        { text: 'bar baz qux', fontFamily: 'Arial', fontSize: 16 },
      ]);
      (block as any).attrs = { alignment: 'justify' };
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 15,
        width: 15 * CHAR_WIDTH,
        maxWidth: 300,
      });

      const targetCharOffset = 7;
      const baseX = measureCharacterX(block, line, targetCharOffset, line.width);
      const wideX = measureCharacterX(block, line, targetCharOffset, 300);
      // No tabs — justify should apply, so wider available width produces different position
      expect(wideX).not.toBe(baseX);
    });
  });

  describe('center and right alignment', () => {
    it('applies center alignment offset', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50, // 5 chars * 10px CHAR_WIDTH
      });
      (block as any).attrs = { alignment: 'center' };

      // With available width of 200 and line width of 50, center offset should be (200-50)/2 = 75
      const x0 = measureCharacterX(block, line, 0, 200);
      expect(x0).toBe(75); // Should start at center offset

      const x3 = measureCharacterX(block, line, 3, 200);
      expect(x3).toBe(75 + 3 * CHAR_WIDTH); // Center offset + 3 chars
    });

    it('applies right alignment offset', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50, // 5 chars * 10px CHAR_WIDTH
      });
      (block as any).attrs = { alignment: 'right' };

      // With available width of 200 and line width of 50, right offset should be 200-50 = 150
      const x0 = measureCharacterX(block, line, 0, 200);
      expect(x0).toBe(150); // Should start at right offset

      const x3 = measureCharacterX(block, line, 3, 200);
      expect(x3).toBe(150 + 3 * CHAR_WIDTH); // Right offset + 3 chars
    });

    it('findCharacterAtX accounts for center alignment', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50, // 5 chars * 10px CHAR_WIDTH
      });
      (block as any).attrs = { alignment: 'center' };

      // Center offset = (200-50)/2 = 75
      // Click at x=75 should be at char 0
      const result0 = findCharacterAtX(block, line, 75, 0, 200);
      expect(result0.charOffset).toBe(0);
      expect(result0.pmPosition).toBe(0);

      // Click at x=85 should be near char 1 (75 + 10 = 85)
      const result1 = findCharacterAtX(block, line, 85, 0, 200);
      expect(result1.charOffset).toBe(1);
      expect(result1.pmPosition).toBe(1);

      // Click at x=0 (before centered text) should clamp to start
      const resultBefore = findCharacterAtX(block, line, 0, 0, 200);
      expect(resultBefore.charOffset).toBe(0);
    });

    it('findCharacterAtX accounts for right alignment', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50, // 5 chars * 10px CHAR_WIDTH
      });
      (block as any).attrs = { alignment: 'right' };

      // Right offset = 200-50 = 150
      // Click at x=150 should be at char 0
      const result0 = findCharacterAtX(block, line, 150, 0, 200);
      expect(result0.charOffset).toBe(0);
      expect(result0.pmPosition).toBe(0);

      // Click at x=0 (before right-aligned text) should clamp to start
      const resultBefore = findCharacterAtX(block, line, 0, 0, 200);
      expect(resultBefore.charOffset).toBe(0);
    });

    it('does not apply alignment offset for left-aligned text', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50,
      });
      (block as any).attrs = { alignment: 'left' };

      // With left alignment, no offset should be applied regardless of available width
      const x0 = measureCharacterX(block, line, 0, 200);
      expect(x0).toBe(0); // No offset for left alignment

      const x3 = measureCharacterX(block, line, 3, 200);
      expect(x3).toBe(3 * CHAR_WIDTH); // Just character position
    });

    it.each([
      ['center', 32],
      ['right', 64],
    ])('keeps inline-box caret and hit geometry %s-aligned', (alignment, alignmentOffset) => {
      const block = createBlock([{ text: 'A B', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 3 }]);
      (block as any).attrs = { alignment };
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 3,
        width: 36,
        maxWidth: 100,
        segments: [
          { runIndex: 0, fromChar: 0, toChar: 1, width: 10 },
          { runIndex: 0, fromChar: 1, toChar: 3, width: 20 },
        ],
        inlineBoxes: [
          {
            id: 'citation',
            from: 1,
            to: 3,
            x: 10,
            width: 26,
            top: 0,
            height: 20,
            startsRange: true,
            endsRange: true,
            style: {
              paddingInlineStart: 2,
              paddingInlineEnd: 2,
              paddingBlockStart: 0,
              paddingBlockEnd: 0,
              gapBefore: 0,
              gapAfter: 0,
              borderWidth: 1,
            },
          },
        ],
      });

      expect(measureCharacterX(block, line, 0, 100)).toBe(alignmentOffset);
      expect(measureCharacterX(block, line, 1, 100)).toBe(alignmentOffset + 13);
      expect(findCharacterAtX(block, line, alignmentOffset + 13, 0, 100).charOffset).toBe(1);
      expect(findCharacterAtX(block, line, line.inlineBoxes![0]!.x + 1, 0, 100).charOffset).toBe(0);
    });
  });

  it('retains justified word spacing before and inside an inline box', () => {
    const block = createBlock([
      { text: 'A B C', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 },
      { text: 'next line', fontFamily: 'Arial', fontSize: 16, pmStart: 5, pmEnd: 14 },
    ]);
    (block as any).attrs = { alignment: 'justify' };
    const line = baseLine({
      fromRun: 0,
      toRun: 0,
      toChar: 5,
      width: 56,
      maxWidth: 100,
      spaceCount: 2,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 2, width: 20 },
        { runIndex: 0, fromChar: 2, toChar: 5, width: 30 },
      ],
      inlineBoxes: [
        {
          id: 'citation',
          from: 2,
          to: 5,
          x: 20,
          width: 36,
          top: 0,
          height: 20,
          startsRange: true,
          endsRange: true,
          style: {
            paddingInlineStart: 2,
            paddingInlineEnd: 2,
            paddingBlockStart: 0,
            paddingBlockEnd: 0,
            gapBefore: 0,
            gapAfter: 0,
            borderWidth: 1,
          },
        },
      ],
    });

    expect(measureCharacterX(block, line, 2, 100)).toBe(45);
    expect(measureCharacterX(block, line, 4, 100)).toBe(87);
    expect(findCharacterAtX(block, line, 45, 0, 100).charOffset).toBe(2);
    expect(findCharacterAtX(block, line, 87, 0, 100).charOffset).toBe(4);
  });

  describe('forward/inverse round-trip (caret placement oracle)', () => {
    // Correctness invariant, asserted without a browser or screenshots:
    // clicking the x of any caret offset must resolve back to that offset.
    // findCharacterAtX must be the exact inverse of measureCharacterX across
    // every alignment/positioning mode.
    const assertInverse = (
      block: FlowBlock,
      line: Line,
      length: number,
      availableWidth?: number,
      alignment?: string,
    ): void => {
      for (let offset = 0; offset <= length; offset += 1) {
        const x = measureCharacterX(block, line, offset, availableWidth, alignment);
        const resolved = findCharacterAtX(block, line, x, 0, availableWidth, alignment).charOffset;
        expect(resolved, `offset ${offset} at x=${x}`).toBe(offset);
      }
    };

    it('round-trips left-aligned multi-run text', () => {
      const block = createBlock([
        { text: 'Hello', fontFamily: 'Arial', fontSize: 16 },
        { text: 'World', fontFamily: 'Arial', fontSize: 16 },
      ]);
      assertInverse(block, baseLine({ fromRun: 0, toRun: 1, toChar: 5, width: 100 }), 10);
    });

    it('round-trips center-aligned text (alignment-offset path)', () => {
      const block = createBlock([{ text: 'Hello', fontFamily: 'Arial', fontSize: 16 }]);
      (block as any).attrs = { alignment: 'center' };
      assertInverse(block, baseLine({ fromRun: 0, toRun: 0, toChar: 5, width: 50 }), 5, 200, 'center');
    });

    it('round-trips a tab-aligned line', () => {
      const block = createBlock([
        { text: 'A', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'tab', text: '\t', width: 48 },
        { text: 'B', fontFamily: 'Arial', fontSize: 16 },
      ]);
      assertInverse(block, baseLine({ fromRun: 0, toRun: 2, toChar: 1, width: CHAR_WIDTH + 48 + CHAR_WIDTH }), 3);
    });

    // Regression for the centered-title bug (SD-3464): the title is laid out with
    // explicit per-segment x (a centering pad), NOT text-align:center. The inverse
    // (measureCharacterX) honors segment.x via the segment-based branch; the forward
    // must honor it too, or clicks near the start resolve to the line end.
    const centeredTitleLine = (): { block: FlowBlock; line: Line } => {
      const block = createBlock([{ text: 'ABCDE', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }]);
      const line = baseLine({
        fromRun: 0,
        toRun: 0,
        toChar: 5,
        width: 50,
        maxWidth: 200,
        segments: [{ runIndex: 0, fromChar: 0, toChar: 5, x: 75, width: 50 }],
      } as Partial<Line>);
      return { block, line };
    };

    it('round-trips a segment-positioned (explicitly centered) line', () => {
      const { block, line } = centeredTitleLine();
      assertInverse(block, line, 5, 200);
    });

    it('maps a click at the visual start of a centered title to the start, not the end', () => {
      const { block, line } = centeredTitleLine();
      // Painted text starts at x=75 (segment.x). A click at x=77 (the 'A') must land
      // near offset 0 — before the fix it resolved to the line end (offset ~5).
      const result = findCharacterAtX(block, line, 77, 0, 200);
      expect(result.charOffset).toBeLessThanOrEqual(1);
    });
  });
});
