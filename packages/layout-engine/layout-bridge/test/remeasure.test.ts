/**
 * Comprehensive unit tests for remeasureParagraph and its helper functions.
 *
 * Tests cover:
 * - Input validation (invalid maxWidth, NaN values, undefined blocks)
 * - Basic functionality (single/multiple runs, line breaking)
 * - Tab stop resolution (explicit stops, default intervals, TWIPS conversion)
 * - Indentation (left, right, firstLine, hanging, combined indents)
 * - Line breaking (whitespace breaks, forced breaks, narrow widths)
 * - Edge cases (empty runs, very narrow widths, whitespace-only content)
 */

import { beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import {
  EMPTY_SDT_PLACEHOLDER_TEXT,
  computeLinePmRange,
  type ParagraphBlock,
  type Run,
  type TabStop,
} from '@superdoc/contracts';
import { LIST_MARKER_GAP } from '@superdoc/common/layout-constants';
import { remeasureParagraph } from '../src/remeasure.ts';

describe('inline box fast remeasurement', () => {
  it('drops inline boxes with a named fail-closed diagnostic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'boxed-remeasure',
      runs: [{ text: 'boxed', fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [
        {
          id: 'citation',
          from: 0,
          to: 5,
          layout: {
            paddingInlineStart: 4,
            paddingInlineEnd: 4,
            paddingBlockStart: 2,
            paddingBlockEnd: 2,
            gapBefore: 0,
            gapAfter: 0,
            borderWidth: 1,
          },
          appearance: {},
        },
      ],
    };

    const measure = remeasureParagraph(block, 200);

    expect(measure.lines.every((line) => line.inlineBoxes === undefined)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('layout.inline-box-remeasure-unsupported'));
    warn.mockRestore();
  });
});

/**
 * Character width constant for consistent text measurement mocking.
 * All tests use 10px per character for predictable measurements.
 */
const CHAR_WIDTH = 10;

/**
 * TWIPS conversion constants matching the implementation.
 */
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const TWIPS_PER_PX = TWIPS_PER_INCH / PX_PER_INCH; // 15 twips per px
const DEFAULT_TAB_INTERVAL_TWIPS = 720; // 0.5 inch
const DEFAULT_TAB_INTERVAL_PX = DEFAULT_TAB_INTERVAL_TWIPS / TWIPS_PER_PX; // 48px

/**
 * Creates a mock canvas context for text measurement in Node.js test environment.
 * Simulates browser canvas.measureText() behavior with fixed character width.
 */
const ensureDocumentStub = (): void => {
  if (typeof document !== 'undefined') return;

  const ctx = {
    font: '',
    measureText(text: string) {
      // Simple proportional width: each character = CHAR_WIDTH pixels
      return { width: text.length * CHAR_WIDTH } as TextMetrics;
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

/**
 * Helper to create a paragraph block with specified runs and optional attributes.
 *
 * @param runs - Array of runs (text, tabs, etc.) for the paragraph.
 * @param attrs - Optional paragraph attributes (indent, tabs, etc.).
 * @returns ParagraphBlock suitable for testing.
 */
const createBlock = (runs: Run[], attrs?: ParagraphBlock['attrs']): ParagraphBlock => ({
  kind: 'paragraph',
  id: 'test-block',
  runs,
  attrs,
});

/**
 * Helper to create a text run with default Arial 16px formatting.
 *
 * @param text - The text content of the run.
 * @param overrides - Optional property overrides (fontSize, fontFamily, etc.).
 * @returns TextRun with specified text and formatting.
 */
const textRun = (text: string, overrides?: Partial<Run>): Run => ({
  text,
  fontFamily: 'Arial',
  fontSize: 16,
  ...overrides,
});

/**
 * Helper to create a tab run.
 *
 * @param overrides - Optional property overrides.
 * @returns Tab run.
 */
const tabRun = (overrides?: Partial<Run>): Run => ({
  kind: 'tab',
  text: '\t',
  ...overrides,
});

/**
 * Helper to convert pixels to TWIPS for tab stop positions.
 *
 * @param px - Position in pixels.
 * @returns Position in TWIPS.
 */
const pxToTwips = (px: number): number => Math.round(px * TWIPS_PER_PX);

beforeAll(() => {
  ensureDocumentStub();
});

describe('remeasureParagraph', () => {
  it('preserves punctuated CJK justification opportunities in fallback measurement', () => {
    const block = {
      kind: 'paragraph' as const,
      id: 'cjk-justify-fallback',
      attrs: { alignment: 'justify' as const },
      runs: [{ kind: 'text' as const, text: '春天，来到', fontFamily: 'Arial', fontSize: 16 }],
    };

    const measure = remeasureParagraph(block, 1_000);

    expect(measure.lines[0]?.justificationPlan).toEqual({
      type: 'inter-character',
      boundaries: [1, 2, 3, 4],
    });
  });

  describe('Input Validation', () => {
    it('throws error when maxWidth is zero', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, 0)).toThrow(
        'remeasureParagraph: maxWidth must be a positive number, got 0',
      );
    });

    it('throws error when maxWidth is negative', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, -100)).toThrow(
        'remeasureParagraph: maxWidth must be a positive number, got -100',
      );
    });

    it('throws error when maxWidth is NaN', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, NaN)).toThrow(
        'remeasureParagraph: maxWidth must be a positive number, got NaN',
      );
    });

    it('throws error when maxWidth is Infinity', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, Infinity)).toThrow(
        'remeasureParagraph: maxWidth must be a positive number, got Infinity',
      );
    });

    it('throws error when block is undefined', () => {
      expect(() => remeasureParagraph(undefined as any, 100)).toThrow('remeasureParagraph: block must be defined');
    });

    it('throws error when block.runs is not an array', () => {
      const block = { kind: 'paragraph', id: 'test', runs: 'not-an-array' } as any;
      expect(() => remeasureParagraph(block, 100)).toThrow(
        'remeasureParagraph: block.runs must be an array, got string',
      );
    });

    it('throws error when block.runs is null', () => {
      const block = { kind: 'paragraph', id: 'test', runs: null } as any;
      expect(() => remeasureParagraph(block, 100)).toThrow(
        'remeasureParagraph: block.runs must be an array, got object',
      );
    });

    it('throws error when firstLineIndent is NaN', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, 100, NaN)).toThrow(
        'remeasureParagraph: firstLineIndent must be a finite number, got NaN',
      );
    });

    it('throws error when firstLineIndent is Infinity', () => {
      const block = createBlock([textRun('Hello')]);
      expect(() => remeasureParagraph(block, 100, Infinity)).toThrow(
        'remeasureParagraph: firstLineIndent must be a finite number, got Infinity',
      );
    });
  });

  describe('Basic Functionality', () => {
    it('measures single run on one line when text fits', () => {
      const block = createBlock([textRun('Hello')]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.kind).toBe('paragraph');
      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[0].fromChar).toBe(0);
      expect(measure.lines[0].toChar).toBe(5);
      expect(measure.lines[0].width).toBe(5 * CHAR_WIDTH);
      expect(measure.lines[0].lineHeight).toBe(16 * 1.15);
      expect(measure.totalHeight).toBe(16 * 1.15);
    });

    it('applies horizontal glyph scaling to fast-path widths and wrapping', () => {
      const unscaled = createBlock([textRun('dated February 2025')]);
      const scaled = createBlock([textRun('dated February 2025', { horizontalScale: 0.9 })]);

      const unscaledNatural = remeasureParagraph(unscaled, 1000);
      const scaledNatural = remeasureParagraph(scaled, 1000);
      const widthBetween = unscaledNatural.lines[0].width * 0.95;

      expect(scaledNatural.lines[0].width).toBeCloseTo(unscaledNatural.lines[0].width * 0.9, 5);
      expect(remeasureParagraph(unscaled, widthBetween).lines.length).toBeGreaterThan(1);
      expect(remeasureParagraph(scaled, widthBetween).lines).toHaveLength(1);
    });

    it('measures multiple runs on one line when they fit', () => {
      const block = createBlock([textRun('Hello'), textRun('World')]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(1);
      expect(measure.lines[0].toChar).toBe(5); // End at char 5 of second run
      expect(measure.lines[0].width).toBe(10 * CHAR_WIDTH); // "Hello" + "World"
    });

    it('breaks multiple runs spanning multiple lines', () => {
      // "Hello" (5 chars) + "World" (5 chars) = 100px total
      // With maxWidth=60, should break into 2 lines
      const block = createBlock([textRun('Hello'), textRun('World')]);
      const measure = remeasureParagraph(block, 60);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.totalHeight).toBeGreaterThan(16 * 1.15); // Multiple lines
    });

    it('uses line-specific float widths and restores full width below the float', () => {
      const block = createBlock([textRun('one two three four five six seven eight nine ten')]);
      const measure = remeasureParagraph(block, 200, 0, [
        [{ offsetX: 0, width: 50 }],
        [{ offsetX: 0, width: 50 }],
        [{ offsetX: 0, width: 200 }],
      ]);

      expect(measure.lines.length).toBeGreaterThanOrEqual(3);
      expect(measure.lines[0].maxWidth).toBe(50);
      expect(measure.lines[1].maxWidth).toBe(50);
      expect(measure.lines[2].maxWidth).toBe(200);
    });

    it('positions a single available region without narrowing the paragraph fragment', () => {
      const block = createBlock([textRun('Hello')]);
      const measure = remeasureParagraph(block, 200, 0, [[{ offsetX: 80, width: 100 }]]);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].maxWidth).toBe(100);
      expect(measure.lines[0].segments?.[0]?.x).toBe(80);
    });

    it('composes both sides of a centered float on the same physical line', () => {
      const block = createBlock([textRun('AAAA BBBB CCCC DDDD')]);
      const measure = remeasureParagraph(block, 200, 0, [
        [
          { offsetX: 0, width: 50 },
          { offsetX: 150, width: 50 },
        ],
        [{ offsetX: 0, width: 200 }],
      ]);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].segments).toHaveLength(2);
      expect(measure.lines[0].segments?.[0]).toMatchObject({
        runIndex: 0,
        fromChar: 0,
        toChar: 5,
        x: 0,
      });
      expect(measure.lines[0].segments?.[1]).toMatchObject({
        runIndex: 0,
        fromChar: 5,
        toChar: 10,
        x: 150,
      });
      expect(measure.lines[1].fromChar).toBe(10);
    });

    it('skips a wrap-side sliver that would force-break the leading word', () => {
      const block = createBlock([textRun('Development continues')]);
      const measure = remeasureParagraph(block, 200, 0, [
        [
          { offsetX: 0, width: 9 },
          { offsetX: 80, width: 120 },
        ],
        [{ offsetX: 0, width: 200 }],
      ]);

      expect(measure.lines[0].segments).toHaveLength(1);
      expect(measure.lines[0].segments?.[0]).toMatchObject({
        runIndex: 0,
        fromChar: 0,
        toChar: 12,
        x: 80,
      });
    });

    it('accounts for a first-line indent without shifting the right-side region', () => {
      const block = createBlock([textRun('AAAA BBBB CCCC')], { indent: { firstLine: 20 } });
      const measure = remeasureParagraph(block, 220, 0, [
        [
          { offsetX: 0, width: 70 },
          { offsetX: 150, width: 50 },
        ],
        [{ offsetX: 0, width: 220 }],
      ]);

      expect(measure.lines[0].segments?.[0]).toMatchObject({ fromChar: 0, toChar: 5, x: 0 });
      expect(measure.lines[0].segments?.[1]).toMatchObject({ fromChar: 5, toChar: 10, x: 130 });
    });

    it.each([
      {
        label: 'right-to-left paragraph',
        attrs: { directionContext: { inlineDirection: 'rtl' as const, writingMode: 'horizontal-tb' as const } },
        runAttrs: {},
      },
      {
        label: 'run bidi context',
        attrs: {},
        runAttrs: { bidi: { rtl: true } },
      },
      {
        label: 'context-sensitive capitalization',
        attrs: {},
        runAttrs: { textTransform: 'capitalize' as const },
      },
    ])('falls back to one safe region for $label', ({ attrs, runAttrs }) => {
      const block = createBlock([textRun('AAAA BBBB CCCC DDDD', runAttrs)], attrs);
      const measure = remeasureParagraph(block, 200, 0, [
        [
          { offsetX: 0, width: 50 },
          { offsetX: 150, width: 50 },
        ],
      ]);

      expect(measure.lines[0].maxWidth).toBe(50);
      expect(measure.lines[0].toChar).toBe(5);
      expect(measure.lines[1].fromChar).toBe(5);
    });

    it('returns empty measure for empty runs array', () => {
      const block = createBlock([]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.kind).toBe('paragraph');
      expect(measure.lines).toHaveLength(0);
      expect(measure.totalHeight).toBe(0);
    });

    it('measures visible empty SDT placeholders using the placeholder prompt width', () => {
      const block = createBlock([
        textRun('', {
          kind: 'text',
          visualPlaceholder: 'emptyBlockSdt',
          sdt: { type: 'structuredContent', scope: 'block', id: 'empty-block-sdt' },
          pmStart: 12,
          pmEnd: 12,
        }),
      ]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(EMPTY_SDT_PLACEHOLDER_TEXT.length * CHAR_WIDTH);
      expect(computeLinePmRange(block, measure.lines[0])).toEqual({ pmStart: 12, pmEnd: 12 });
    });

    it('keeps a visible empty SDT placeholder atomic when it is wider than the line', () => {
      const block = createBlock([
        textRun('', {
          kind: 'text',
          visualPlaceholder: 'emptyBlockSdt',
          sdt: { type: 'structuredContent', scope: 'block', id: 'narrow-empty-block-sdt' },
        }),
      ]);
      const measure = remeasureParagraph(block, 60);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[0].width).toBe(EMPTY_SDT_PLACEHOLDER_TEXT.length * CHAR_WIDTH);
    });

    it('keeps hidden empty SDT placeholders zero-width during remeasurement', () => {
      const block = createBlock([
        textRun('', {
          kind: 'text',
          visualPlaceholder: 'emptyBlockSdt',
          sdt: { type: 'structuredContent', scope: 'block', id: 'hidden-block-sdt', appearance: 'hidden' },
        }),
      ]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(0);
    });

    it('handles single character per line when maxWidth is very narrow', () => {
      // With maxWidth=11 (barely fits 1 char at 10px + fudge), each char should be on its own line
      const block = createBlock([textRun('ABC')]);
      const measure = remeasureParagraph(block, 11);

      expect(measure.lines.length).toBeGreaterThan(1);
      // Each line should contain approximately 1 character
      measure.lines.forEach((line) => {
        const charCount = line.toChar - line.fromChar;
        expect(charCount).toBeLessThanOrEqual(2); // At most 1-2 chars per line
      });
    });

    it('forces at least one character per line even if it exceeds maxWidth', () => {
      // With maxWidth=1 (less than one char), should still output one char per line
      const block = createBlock([textRun('AB')]);
      const measure = remeasureParagraph(block, 1);

      expect(measure.lines.length).toBeGreaterThanOrEqual(2);
      // Each line should have at least 1 character
      measure.lines.forEach((line) => {
        const charCount = line.toChar - line.fromChar;
        expect(charCount).toBeGreaterThanOrEqual(1);
      });
    });

    it('calculates line height based on maximum font size in line', () => {
      const block = createBlock([textRun('Small', { fontSize: 12 }), textRun('Large', { fontSize: 24 })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Line height should be based on largest font (24px * 1.15 = 27.6px)
      expect(measure.lines[0].lineHeight).toBe(24 * 1.15);
    });

    it('applies explicit auto multiplier spacing to the natural single-line height', () => {
      const block = createBlock([textRun('Compact line', { fontSize: 16 })], {
        spacing: { line: 1.05, lineUnit: 'multiplier', lineRule: 'auto' },
      });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBeCloseTo(16 * 1.15 * 1.05, 6);
      expect(measure.totalHeight).toBeCloseTo(16 * 1.15 * 1.05, 6);
    });

    it('applies auto spacing to the Word-calibrated natural line height for Aptos', () => {
      const fontSize = 44 / 3;
      const lineMultiplier = 259 / 240;
      const block = createBlock([textRun('Contract “ACC”', { fontFamily: 'Aptos', fontSize })], {
        spacing: { line: lineMultiplier, lineUnit: 'multiplier', lineRule: 'auto' },
      });
      const measure = remeasureParagraph(block, 100.8);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0]?.lineHeight).toBeCloseTo(fontSize * 1.224 * lineMultiplier, 6);
      expect(measure.lines[1]?.lineHeight).toBeCloseTo(fontSize * 1.224 * lineMultiplier, 6);
    });

    it('uses the same loaded embedded-face pitch during fast remeasurement', () => {
      const fontSize = 12;
      const multiplier = 2581 / 2048;
      const block = createBlock([textRun('Embedded line', { fontFamily: 'Helvetica Neue', fontSize })]);
      const measure = remeasureParagraph(block, 200, 0, undefined, {
        fontSignature: 'embedded:1',
        resolvePhysical: (family) => family,
        resolveNaturalLineMultiplier: (_family, face, text) =>
          face.weight === '400' && text === 'Embedded line' ? multiplier : undefined,
      });

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBeCloseTo(fontSize * multiplier, 6);
    });

    it('uses the largest embedded-face pitch when equal-size runs share a line', () => {
      const fontSize = 12;
      const block = createBlock([
        textRun('Tall', { fontFamily: 'Tall Embedded', fontSize }),
        textRun('Short', { fontFamily: 'Short Embedded', fontSize }),
      ]);
      const measure = remeasureParagraph(block, 200, 0, undefined, {
        fontSignature: 'embedded:2',
        resolvePhysical: (family) => family,
        resolveNaturalLineMultiplier: (family) => (family === 'Tall Embedded' ? 1.4 : 1.2),
      });

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBeCloseTo(fontSize * 1.4, 6);
    });

    it('handles runs with different formatting on same line', () => {
      const block = createBlock([
        textRun('Bold', { bold: true }),
        textRun('Italic', { italic: true }),
        textRun('Normal'),
      ]);
      const measure = remeasureParagraph(block, 300);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(2);
    });
  });

  describe('Tab Stop Tests', () => {
    it('keeps a Word-authored tabbed suffix on the line when it is within the subpixel tolerance', () => {
      // Reduced from SD-4125's engineering-form columns. The paragraph has
      // 858 twips of column width, a 344-twip left indent, and an authored
      // start tab at 787 twips. Canvas leaves the final glyph inside the real
      // line edge but inside the historical 0.5px safety reservation.
      const block = createBlock([textRun('00'), tabRun(), textRun('0', { horizontalScale: 0.4672 })], {
        indent: { left: 344 / TWIPS_PER_PX },
        tabs: [{ pos: 787, val: 'start' }],
      });

      const measure = remeasureParagraph(block, 858 / TWIPS_PER_PX);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].hasExplicitTabStops).toBe(true);
      expect(measure.lines[0].width).toBeLessThanOrEqual(measure.lines[0].maxWidth);
    });

    it('advances cursor to correct position for tab at explicit stop', () => {
      // Tab at 48px (720 TWIPS = 0.5 inch)
      const tabStop: TabStop = { pos: 720, val: 'start' };
      const explicitTab = tabRun();
      const block = createBlock([textRun('A'), explicitTab, textRun('B')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "A" = 10px, tab advances to 48px, "B" starts at 48px
      const trailingText = measure.lines[0].segments?.find((segment) => segment.runIndex === 2);
      expect((explicitTab as { width?: number }).width).toBeCloseTo(38, 5);
      expect(trailingText?.x).toBeCloseTo(DEFAULT_TAB_INTERVAL_PX, 5);
      expect(measure.lines[0].width).toBeCloseTo(58, 5);
      expect(measure.lines[0].hasExplicitTabStops).toBe(true);
    });

    it('keeps explicit payment columns on the paragraph grid for hanging list markers', () => {
      const indentLeft = 1417 / TWIPS_PER_PX;
      const euroStop = 7943 / TWIPS_PER_PX;
      const atStop = 9026 / TWIPS_PER_PX;
      const block = createBlock([textRun('de huurprijs'), tabRun(), textRun('€'), tabRun(), textRun('@')], {
        alignment: 'justify',
        indent: { left: indentLeft, hanging: 347 / TWIPS_PER_PX },
        tabs: [
          { pos: 1417, val: 'start' },
          { pos: 7943, val: 'start' },
          { pos: 9026, val: 'start' },
        ],
        wordLayout: {
          indentLeftPx: indentLeft,
          hangingPx: 347 / TWIPS_PER_PX,
          tabsPx: [indentLeft, euroStop, atStop],
          textStartPx: indentLeft,
          marker: {
            markerText: '•',
            markerBoxWidthPx: 347 / TWIPS_PER_PX,
            markerX: (1417 - 347) / TWIPS_PER_PX,
            textStartX: indentLeft,
            gutterWidthPx: 8,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Symbol', fontSize: 14 },
          },
        },
      });

      const measure = remeasureParagraph(block, 800);
      const euroSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 2);
      const atSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 4);

      expect((euroSegment?.x ?? Number.NaN) + indentLeft).toBeCloseTo(euroStop, 5);
      expect((atSegment?.x ?? Number.NaN) + indentLeft).toBeCloseTo(atStop, 5);
    });

    it('advances cursor for multiple tabs in same line sequentially', () => {
      // Two explicit tab stops at 48px and 96px
      const tabStops: TabStop[] = [
        { pos: 720, val: 'start' }, // 48px
        { pos: 1440, val: 'start' }, // 96px
      ];
      const block = createBlock([textRun('A'), tabRun(), textRun('B'), tabRun(), textRun('C')], {
        tabs: tabStops,
      });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "A"=10px, tab1 advances to 48px, "B"=10px at 48px->58px, tab2 advances to 96px, "C" at 96px
      // Total width should be ~96px + 10px = 106px
      expect(measure.lines[0].width).toBeGreaterThan(96);
    });

    it('falls back to default tab interval when explicit tabs are exhausted', () => {
      const tabStop: TabStop = { pos: 720, val: 'start' }; // 48px
      const fallbackTab = tabRun();
      const block = createBlock(
        [
          textRun('A'), // 0-10px
          tabRun(), // advances to 48px (explicit)
          textRun('B'), // 48-58px
          fallbackTab, // advances to the 96px default grid position
          textRun('C'), // 96-106px
        ],
        { tabs: [tabStop], tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS },
      );
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      const trailingText = measure.lines[0].segments?.find((segment) => segment.runIndex === 4);
      expect((fallbackTab as { width?: number }).width).toBeCloseTo(DEFAULT_TAB_INTERVAL_PX - CHAR_WIDTH, 5);
      expect(trailingText?.x).toBeCloseTo(DEFAULT_TAB_INTERVAL_PX * 2, 5);
      expect(measure.lines[0].width).toBeCloseTo(DEFAULT_TAB_INTERVAL_PX * 2 + CHAR_WIDTH, 5);
    });

    it('uses default tab interval when no explicit tabs are defined', () => {
      // No explicit tabs, should use default 48px interval
      const block = createBlock(
        [
          textRun('A'), // 0-10px
          tabRun(), // advances to 48px
          textRun('B'), // 48-58px
        ],
        { tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS },
      );
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBeGreaterThan(48);
      expect(measure.lines[0].hasExplicitTabStops).toBeUndefined();
    });

    it('advances a leading tab to the left margin when hanging indent starts before it', () => {
      const hangingPx = 567 / TWIPS_PER_PX;
      const run = tabRun();
      const block = createBlock([run, textRun('Test doc')], {
        indent: { hanging: hangingPx },
        tabs: [{ pos: -1440, val: 'start' }],
        tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS,
      });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect((run as { width?: number }).width).toBeCloseTo(hangingPx, 1);
      expect(measure.lines[0].width).toBeCloseTo(hangingPx + 'Test doc'.length * CHAR_WIDTH, 1);
    });

    it('advances a leading tab to the left indent stop for negative left indent paragraphs', () => {
      const leftIndentPx = -567 / TWIPS_PER_PX;
      const expectedTabAdvance = Math.abs(leftIndentPx);
      const run = tabRun();
      const block = createBlock([run, textRun('Test doc')], {
        indent: { left: leftIndentPx },
        tabs: [{ pos: -1440, val: 'start' }],
        tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS,
      });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect((run as { width?: number }).width).toBeCloseTo(expectedTabAdvance, 1);
      expect(measure.lines[0].width).toBeCloseTo(expectedTabAdvance + 'Test doc'.length * CHAR_WIDTH, 1);

      const textSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 1);
      expect(textSegment?.x).toBeCloseTo(expectedTabAdvance * 2, 1);
      expect(textSegment?.precedingTabEndX).toBeCloseTo(expectedTabAdvance, 1);
      // Explicit segment x is pre-painter geometry. The DOM painter later adds the
      // negative paragraph indent, so the final fragment-local text position remains
      // one indent width from the negative-left fragment origin: 2*indent - indent.
      expect((textSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(expectedTabAdvance, 1);
    });

    it('compensates start tabs on wrapped body lines for negative-left paragraphs with hanging indents', () => {
      const leftIndentPx = -40;
      const run = tabRun();
      const block = createBlock([textRun('AAAAA AAAAA AAAAA'), run, textRun('Body')], {
        indent: { left: leftIndentPx, hanging: 20 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect((run as { width?: number }).width).toBeCloseTo(30, 1);

      const textSegment = measure.lines
        .slice(1)
        .flatMap((line) => line.segments ?? [])
        .find((segment) => segment.runIndex === 2);
      expect(textSegment?.x).toBeCloseTo(120, 1);
      expect(textSegment?.precedingTabEndX).toBeCloseTo(80, 1);
      expect((textSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(80, 1);
    });

    it('explicitly positions positive explicit start stops without negative-left compensation', () => {
      const leftIndentPx = -24;
      const runs: Run[] = [textRun('AAAA'), ...Array.from({ length: 7 }, () => tabRun()), textRun('Company')];
      const block = createBlock(runs, {
        indent: { left: leftIndentPx },
        tabs: [48, 96, 144, 192, 240, 288, 336].map((pos) => ({ pos: pxToTwips(pos), val: 'start' })),
      });

      const measure = remeasureParagraph(block, 600);
      const textSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 8);

      // Start-tab segments intentionally carry x in remeasure, matching measuring/dom.
      // Positive authored stops do not need the painter tab-span compensation signal.
      expect(textSegment?.x).toBeCloseTo(360, 1);
      expect(textSegment?.precedingTabEndX).toBeUndefined();
      expect((textSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(336, 1);
    });

    it('does not clamp tabs early when negative left indent expands content width', () => {
      const leftIndentPx = -40;
      const tabStopPx = 190;
      const run = tabRun();
      const block = createBlock([textRun('AAAAA'), run, textRun('X')], {
        indent: { left: leftIndentPx },
        tabs: [{ pos: pxToTwips(tabStopPx), val: 'start' }],
      });

      remeasureParagraph(block, 200);

      // The leading implicit zero stop is already behind the cursor:
      // absCurrentX = 50px text + -40px indent = 10px, target = 190px.
      // The old mixed model clamped at 160px and advanced only 150px.
      expect((run as { width?: number }).width).toBeCloseTo(180, 1);
    });

    it('keeps right-aligned tab groups on the same line', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'end' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('12')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].toRun).toBe(2);
      expect(measure.lines[0].width).toBeGreaterThanOrEqual(100);
    });

    it('keeps center-aligned tab groups on the same line', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'center' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('12')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].toRun).toBe(2);
    });

    it('keeps decimal-aligned tab groups on the same line', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'decimal' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('123.45')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].toRun).toBe(2);
    });

    it('handles decimal tab with comma separator', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'decimal' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('123,45')], {
        tabs: [tabStop],
        decimalSeparator: ',',
      });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].toRun).toBe(2);
    });

    it('handles tab with dot leader', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'end', leader: 'dot' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('12')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      // Leaders should be recorded on the line
      expect(measure.lines[0].leaders).toBeDefined();
      expect(measure.lines[0].leaders?.length).toBeGreaterThan(0);
      expect(measure.lines[0].leaders?.[0].style).toBe('dot');

      const leader = measure.lines[0].leaders?.[0];

      if (leader) {
        expect(leader.from).toBeGreaterThanOrEqual(0);
        expect(leader.to).toBeGreaterThan(leader.from);
      }
    });

    it.each([
      { label: 'without indent', indentLeft: 0 },
      { label: 'with indent', indentLeft: 36 },
    ])('leader from/to use absolute coordinates for right-aligned tab $label', ({ indentLeft }) => {
      const tabStop: TabStop = { pos: pxToTwips(300), val: 'end', leader: 'dot' };
      const block = createBlock([textRun('Chapter 1'), tabRun(), textRun('42')], {
        tabs: [tabStop],
        ...(indentLeft > 0 && { indent: { left: indentLeft } }),
      });
      const measure = remeasureParagraph(block, 1000);

      expect(measure.lines).toHaveLength(1);
      const leaders = measure.lines[0].leaders;
      expect(leaders).toHaveLength(1);
      const leader = leaders![0];

      const textWidth = 'Chapter 1'.length * CHAR_WIDTH;
      const pageNumWidth = '42'.length * CHAR_WIDTH;

      expect(leader.from).toBeCloseTo(textWidth + indentLeft, 0);
      expect(leader.to).toBeCloseTo(300 - pageNumWidth, 0);
    });

    it('keeps negative-left right-aligned tab segments in initial-measurement coordinates', () => {
      const indentLeft = -40;
      const tabStopPx = 190;
      const tabStop: TabStop = { pos: pxToTwips(tabStopPx), val: 'end', leader: 'dot' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('12')], {
        indent: { left: indentLeft },
        tabs: [tabStop],
      });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);

      const pageNumberSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 2);
      const leader = measure.lines[0].leaders?.[0];
      const pageNumberWidth = '12'.length * CHAR_WIDTH;
      const expectedPaintedX = tabStopPx - pageNumberWidth;

      expect(pageNumberSegment?.x).toBeCloseTo(expectedPaintedX - indentLeft, 1);
      expect((pageNumberSegment?.x ?? 0) + indentLeft).toBeCloseTo(expectedPaintedX, 1);
      expect(leader?.to).toBeCloseTo(expectedPaintedX, 1);
    });

    it('handles tab with hyphen leader', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'end', leader: 'hyphen' };
      const block = createBlock([textRun('Entry'), tabRun(), textRun('99')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].leaders?.[0].style).toBe('hyphen');
    });

    it('handles multiple aligned tabs on same line', () => {
      const tabStops: TabStop[] = [
        { pos: pxToTwips(50), val: 'center' },
        { pos: pxToTwips(100), val: 'end' },
      ];
      const block = createBlock([textRun('A'), tabRun(), textRun('B'), tabRun(), textRun('C')], {
        tabs: tabStops,
      });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].toRun).toBe(4);
    });

    it('creates segments for aligned tab content', () => {
      const tabStop: TabStop = { pos: pxToTwips(100), val: 'end' };
      const block = createBlock([textRun('AAA'), tabRun(), textRun('12')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines[0].segments).toBeDefined();
      expect(measure.lines[0].segments?.length).toBeGreaterThan(0);
    });

    it('aligns trailing TOC-style tab to explicit right stop with leader', () => {
      const rightStopPx = 300;
      const block = createBlock(
        [textRun('1.'), tabRun({ tabIndex: 0 }), textRun('Generalities'), tabRun({ tabIndex: 1 }), textRun('5')],
        {
          tabs: [{ pos: pxToTwips(rightStopPx), val: 'end', leader: 'dot' }],
          indent: { left: 30, hanging: 30 },
          tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS,
        },
      );

      const measure = remeasureParagraph(block, 800);
      expect(measure.lines).toHaveLength(1);
      const leaders = measure.lines[0].leaders;
      expect(leaders).toBeDefined();
      expect(leaders?.length).toBe(1);
      const leader = leaders![0];
      expect(leader.style).toBe('dot');
      expect(leader.to).toBeCloseTo(rightStopPx - CHAR_WIDTH, 0);
    });

    it('handles tab at various positions within text', () => {
      // Tab after some text should advance to next stop after current position
      const tabStop: TabStop = { pos: 720, val: 'start' }; // 48px
      const block = createBlock(
        [
          textRun('Hello'), // 0-50px (exceeds first tab stop)
          tabRun(), // should advance to next interval: 50 + 48 = 98px
          textRun('World'),
        ],
        { tabs: [tabStop], tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS },
      );
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Width should reflect tab advancing past the 48px stop to default interval
      expect(measure.lines[0].width).toBeGreaterThan(50 + DEFAULT_TAB_INTERVAL_PX);
    });

    it('handles multiple tabs with no text between them', () => {
      const tabStops: TabStop[] = [
        { pos: 720, val: 'start' }, // 48px
        { pos: 1440, val: 'start' }, // 96px
      ];
      const block = createBlock([tabRun(), tabRun(), textRun('A')], { tabs: tabStops });
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // First tab advances to 48px, second to 96px, text at 96px
      expect(measure.lines[0].width).toBeGreaterThan(96);
    });

    it('converts TWIPS to pixels correctly for tab stop positions', () => {
      // 1440 TWIPS = 1 inch = 96px at 96dpi
      const tabStop: TabStop = { pos: 1440, val: 'start' };
      const block = createBlock([textRun('A'), tabRun(), textRun('B')], { tabs: [tabStop] });
      const measure = remeasureParagraph(block, 200);
      expect(measure.lines).toHaveLength(1);
      // Tab should advance to 96px (1 inch)
      expect(measure.lines[0].width).toBeGreaterThan(96);
    });
  });

  describe('Indentation Tests', () => {
    it('reduces available width by left indent', () => {
      // Left indent of 20px reduces available width from 100px to 80px
      const block = createBlock([textRun('A'.repeat(10))], {
        // 10 chars = 100px
        indent: { left: 20 },
      });
      const measure = remeasureParagraph(block, 100);

      // With 80px available, 100px text should break into multiple lines
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('reduces available width by right indent', () => {
      // Right indent of 20px reduces available width from 100px to 80px
      const block = createBlock([textRun('A'.repeat(10))], {
        // 10 chars = 100px
        indent: { right: 20 },
      });
      const measure = remeasureParagraph(block, 100);

      // With 80px available, 100px text should break into multiple lines
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('applies first line indent only to first line', () => {
      // First line indent of 30px reduces first line width
      const block = createBlock([textRun('A'.repeat(20))], {
        // 20 chars = 200px
        indent: { firstLine: 30 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      // First line has width reduced by firstLine indent (100 - 30 = 70px)
      // Subsequent lines have full 100px available
      // First line should have fewer characters than subsequent lines
      const firstLineChars = measure.lines[0].toChar - measure.lines[0].fromChar;
      const secondLineChars = measure.lines[1] ? measure.lines[1].toChar - measure.lines[1].fromChar : firstLineChars;
      expect(firstLineChars).toBeLessThan(secondLineChars);
    });

    it('expands first line width for hanging indents without negative indents', () => {
      const maxWidth = 200;
      const indentLeft = 40;
      const hanging = 20;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: indentLeft, hanging },
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      const contentWidth = maxWidth - indentLeft;
      expect(measure.lines[0].maxWidth).toBe(contentWidth + hanging);
      expect(measure.lines[1].maxWidth).toBe(contentWidth);
    });

    it('increases subsequent line widths with hanging indent', () => {
      // Hanging indent means first line has REDUCED width (negative offset from hanging)
      // Subsequent lines have MORE width (hanging indent adds to available space)
      const block = createBlock([textRun('A'.repeat(20))], {
        // 20 chars = 200px
        indent: { hanging: 30 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      // Hanging indent reduces first line width, subsequent lines have more space
      // The implementation calculates: firstLineOffset = max(0, firstLineIndent - hanging)
      // With hanging=30, firstLine=0: offset = max(0, 0-30) = 0, so no change expected
      // This test verifies the hanging indent is processed without errors
      expect(measure.lines[0]).toBeDefined();
      expect(measure.lines[1]).toBeDefined();
    });

    it('calculates correct width with combined left and right indents', () => {
      // Left=20px + Right=30px reduces 100px width to 50px
      const block = createBlock([textRun('A'.repeat(10))], {
        // 10 chars = 100px
        indent: { left: 20, right: 30 },
      });
      const measure = remeasureParagraph(block, 100);

      // With 50px available, 100px text should break into multiple lines
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('handles combined firstLine and hanging indents correctly', () => {
      // FirstLine=20px and Hanging=10px: first line gets 20-10=10px offset, next lines get 10px offset
      const block = createBlock([textRun('A'.repeat(20))], {
        indent: { firstLine: 20, hanging: 10 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      // The interaction between firstLine and hanging is: effectiveFirstLineOffset = firstLine - hanging
      // This should be reflected in line breaking behavior
    });

    it('preserves negative left and right indents in available width calculations', () => {
      const block = createBlock([textRun('Hello')], {
        indent: { left: -50, right: -30, firstLine: -20, hanging: -10 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(5 * CHAR_WIDTH);
      expect(measure.lines[0].maxWidth).toBe(180);
    });

    it('uses expanded content width when negative indents are present with hanging', () => {
      const maxWidth = 200;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: -20, right: -30, hanging: 20 },
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].maxWidth).toBe(250);
      expect(measure.lines[1].maxWidth).toBe(250);
    });

    // SD-2415: the guard was relaxed from `hasNegativeIndent` to `hasNegativeLeftIndent`.
    // These tests pin the new behavior so a revert is caught.
    it('widens first line with hanging when only right indent is negative', () => {
      const maxWidth = 200;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: 0, right: -30, hanging: 20 },
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      // First line widens by hanging amount; body lines use content width expanded by negative right indent.
      expect(measure.lines[0].maxWidth).toBe(250);
      expect(measure.lines[1].maxWidth).toBe(230);
    });

    it('keeps SD-1401 negative-left hanging paragraphs from wrapping prematurely under expanded-width semantics', () => {
      const maxWidth = 200;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: -20, right: 0, hanging: 20 },
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      // SD-1401 originally guarded against premature body-line wrapping for
      // negative-left + hanging paragraphs. The correct current model preserves
      // the negative-left expanded content width, but does not add another
      // hanging-width expansion on top of it.
      expect(measure.lines[0].maxWidth).toBe(220);
      expect(measure.lines[1].maxWidth).toBe(220);
    });

    // SD-2415: remeasure must match the initial measurer on `suppressFirstLineIndent`.
    // Without this, remeasure (triggered by typing, resize, style change) produces a
    // different first-line offset than the initial measure and text jumps on redraw.
    it('honors suppressFirstLineIndent by not widening the first line', () => {
      const maxWidth = 200;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: 0, right: 0, hanging: 20 },
        suppressFirstLineIndent: true,
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      // With suppressFirstLineIndent=true, firstLineOffset is forced to 0,
      // so the first line uses the same width as body lines.
      expect(measure.lines[0].maxWidth).toBe(maxWidth);
      expect(measure.lines[1].maxWidth).toBe(maxWidth);
    });

    it('widens first line when suppressFirstLineIndent is false (default)', () => {
      const maxWidth = 200;
      const block = createBlock([textRun('A'.repeat(40))], {
        indent: { left: 0, right: 0, hanging: 20 },
      });
      const measure = remeasureParagraph(block, maxWidth);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].maxWidth).toBe(maxWidth + 20);
      expect(measure.lines[1].maxWidth).toBe(maxWidth);
    });

    it('respects firstLineIndent parameter for list markers', () => {
      // firstLineIndent parameter (different from attrs.indent.firstLine) is for in-flow list markers
      const block = createBlock([textRun('A'.repeat(15))]); // 15 chars = 150px
      const measure = remeasureParagraph(block, 100, 30); // 30px firstLineIndent

      expect(measure.lines.length).toBeGreaterThan(1);
      // First line has only 70px available (100 - 30), subsequent lines have 100px
      const firstLineChars = measure.lines[0].toChar - measure.lines[0].fromChar;
      const secondLineChars = measure.lines[1] ? measure.lines[1].toChar - measure.lines[1].fromChar : 0;
      expect(firstLineChars).toBeLessThan(secondLineChars);
    });
  });

  describe('Line Breaking Tests', () => {
    it('breaks at whitespace when exceeding maxWidth', () => {
      // "Hello World" should break at space when width is constrained
      const block = createBlock([textRun('Hello World')]);
      const measure = remeasureParagraph(block, 60); // Less than 11 chars (110px)

      expect(measure.lines.length).toBeGreaterThan(1);
      // Should break between "Hello" and "World"
    });

    it('uses width at the break point instead of overflow content', () => {
      // Ensure the stored line width matches the text that actually fits before the break.
      // Without rewinding to the break point, width would include overflow characters,
      // resulting in zero justify slack in columns.
      const block = createBlock([textRun('Hello world')]);
      const measure = remeasureParagraph(block, 85); // Forces wrap mid-second word

      expect(measure.lines.length).toBe(2);
      const firstLine = measure.lines[0];
      // Breaks after "Hello " (6 chars), but the consumed wrap space is not charged to line width.
      expect(firstLine.toChar - firstLine.fromChar).toBe(6);
      expect(firstLine.width).toBeCloseTo(5 * CHAR_WIDTH);
    });

    it('keeps a word when only the following wrap space overflows', () => {
      const block = createBlock([textRun('abcd ef')]);
      const measure = remeasureParagraph(block, 50);

      expect(measure.lines.length).toBe(2);
      expect(measure.lines[0].fromChar).toBe(0);
      expect(measure.lines[0].toChar).toBe(5);
      expect(measure.lines[0].width).toBeCloseTo(4 * CHAR_WIDTH);
      expect(measure.lines[1].fromChar).toBe(5);
    });

    it('includes run letter spacing in measured line width', () => {
      const block = createBlock([textRun('abc', { letterSpacing: 2 })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBeCloseTo(3 * CHAR_WIDTH + 2 * 2);
    });

    it('uses condensed run letter spacing for line-break decisions', () => {
      const block = createBlock([textRun('abcd ef', { letterSpacing: -2 })]);
      const measure = remeasureParagraph(block, 60);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBeCloseTo(7 * CHAR_WIDTH + 6 * -2);
    });

    it('breaks mid-word when no whitespace is available (forced break)', () => {
      // Long word with no spaces should break mid-word
      const block = createBlock([textRun('HelloWorld')]);
      const measure = remeasureParagraph(block, 60); // Less than 10 chars (100px)

      expect(measure.lines.length).toBeGreaterThan(1);
      // Should force break within "HelloWorld"
    });

    it('breaks at hyphen as a valid break point', () => {
      const block = createBlock([textRun('Hello-World')]);
      const measure = remeasureParagraph(block, 70);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      // Hyphen is a valid break point (included in break character check)
    });

    it('breaks at tab character as a valid break point', () => {
      // Implementation treats tab as a break opportunity
      const block = createBlock([textRun('Hello\tWorld')]);
      const measure = remeasureParagraph(block, 70);

      // Note: This test verifies tab handling in text content (not tabRun)
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves whitespace at break points', () => {
      const block = createBlock([textRun('Hello World')]);
      const measure = remeasureParagraph(block, 60);

      // After breaking at space, verify the break position includes the space
      const line1Chars = measure.lines[0].toChar - measure.lines[0].fromChar;
      expect(line1Chars).toBeGreaterThan(0);
    });

    it('handles very long words that exceed maxWidth significantly', () => {
      // 50 character word in 60px width (can fit ~6 chars per line)
      const block = createBlock([textRun('A'.repeat(50))]);
      const measure = remeasureParagraph(block, 60);

      expect(measure.lines.length).toBeGreaterThan(5);
      // Should break into multiple lines, each with ~6 chars
    });

    it('handles mixed spaces and hyphens in line breaking', () => {
      const block = createBlock([textRun('Hello-Beautiful World')]);
      const measure = remeasureParagraph(block, 100);

      // Should break at valid points (spaces and hyphens)
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('does not break before first character even if maxWidth is tiny', () => {
      // Ensures at least one character per line (forced break logic)
      const block = createBlock([textRun('AB')]);
      const measure = remeasureParagraph(block, 5); // Less than 1 char width

      expect(measure.lines.length).toBeGreaterThanOrEqual(2);
      measure.lines.forEach((line) => {
        const charCount = line.toChar - line.fromChar;
        expect(charCount).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles very narrow maxWidth (1px)', () => {
      const block = createBlock([textRun('ABC')]);
      const measure = remeasureParagraph(block, 1);

      // Should still produce lines with at least 1 character each
      expect(measure.lines.length).toBeGreaterThanOrEqual(3);
      measure.lines.forEach((line) => {
        const charCount = line.toChar - line.fromChar;
        expect(charCount).toBeGreaterThanOrEqual(1);
      });
    });

    it('handles empty text runs', () => {
      const block = createBlock([textRun(''), textRun('Hello'), textRun('')]);
      const measure = remeasureParagraph(block, 100);

      // Empty runs should not cause errors, measure should only reflect "Hello"
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles runs with only whitespace', () => {
      const block = createBlock([textRun('   ')]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      expect(measure.lines[0].width).toBeGreaterThan(0); // Whitespace has width
    });

    it('handles runs with mixed whitespace and text', () => {
      const block = createBlock([textRun('  Hello  World  ')]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles very long words with no break opportunities', () => {
      // 100 character word should force many line breaks
      const block = createBlock([textRun('A'.repeat(100))]);
      const measure = remeasureParagraph(block, 50);

      expect(measure.lines.length).toBeGreaterThan(10);
    });

    it('handles single character text', () => {
      const block = createBlock([textRun('A')]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromChar).toBe(0);
      expect(measure.lines[0].toChar).toBe(1);
      expect(measure.lines[0].width).toBe(CHAR_WIDTH);
    });

    it('handles runs with different font sizes affecting line breaking', () => {
      // Small font + large font combination
      const block = createBlock([
        textRun('Small', { fontSize: 10 }), // Narrower chars
        textRun('Large', { fontSize: 30 }), // Wider chars (in real measurement)
      ]);
      const measure = remeasureParagraph(block, 100);

      // Line height should be based on largest font
      expect(measure.lines[0].lineHeight).toBe(30 * 1.15);
    });

    it('handles paragraph with no attrs defined', () => {
      const block = createBlock([textRun('Hello World')]);
      // No attrs, should use defaults (no indent, default tab interval)
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles paragraph with partial attrs (only some indent values)', () => {
      const block = createBlock([textRun('Hello World')], {
        indent: { left: 10 }, // Only left indent, others undefined
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles text with unicode characters', () => {
      const block = createBlock([textRun('Hello\u00A0World')]); // Non-breaking space
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles runs with break kind (non-text runs)', () => {
      const block = createBlock([textRun('Hello'), { kind: 'break' } as Run, textRun('World')]);
      const measure = remeasureParagraph(block, 200);

      // Break runs should be handled gracefully (likely contribute no width)
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles runs with lineBreak kind', () => {
      const block = createBlock([textRun('Hello'), { kind: 'lineBreak' } as Run, textRun('World')]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[1].fromRun).toBe(2);
      expect(measure.lines[1].toRun).toBe(2);
    });

    it('creates an empty line for leading lineBreak at start of paragraph', () => {
      const block = createBlock([{ kind: 'lineBreak' } as Run, textRun('Text')]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[0].toChar).toBe(0);
      expect(measure.lines[1].fromRun).toBe(1);
      expect(measure.lines[1].toRun).toBe(1);
    });

    it('preserves multiple explicit lineBreak boundaries', () => {
      const block = createBlock([
        textRun('One'),
        { kind: 'lineBreak' } as Run,
        textRun('Two'),
        { kind: 'lineBreak' } as Run,
        textRun('Three'),
      ]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(3);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[1].fromRun).toBe(2);
      expect(measure.lines[1].toRun).toBe(2);
      expect(measure.lines[2].fromRun).toBe(4);
      expect(measure.lines[2].toRun).toBe(4);
    });

    it('preserves trailing explicit lineBreak as final empty line', () => {
      const block = createBlock([textRun('Hello'), { kind: 'lineBreak' } as Run]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      // Final empty line should be anchored to trailing break run.
      expect(measure.lines[1].fromRun).toBe(1);
      expect(measure.lines[1].toRun).toBe(1);
      expect(measure.lines[1].toChar).toBe(0);
    });

    it('handles a single explicit lineBreak run as the only paragraph content', () => {
      const block = createBlock([{ kind: 'lineBreak' } as Run]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[0].fromChar).toBe(0);
      expect(measure.lines[0].toChar).toBe(0);
    });

    it('uses previous text font size for trailing explicit lineBreak empty line height', () => {
      const block = createBlock([textRun('Heading', { fontSize: 24 }), { kind: 'lineBreak' } as Run]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].lineHeight).toBe(24 * 1.15);
      expect(measure.lines[1].fromRun).toBe(1);
      expect(measure.lines[1].toRun).toBe(1);
      expect(measure.lines[1].lineHeight).toBe(24 * 1.15);
    });

    it('preserves multiple trailing explicit lineBreak runs as multiple empty lines', () => {
      const block = createBlock([textRun('Hello'), { kind: 'lineBreak' } as Run, { kind: 'lineBreak' } as Run]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(3);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[1].fromRun).toBe(1);
      expect(measure.lines[1].toRun).toBe(1);
      expect(measure.lines[1].toChar).toBe(0);
      expect(measure.lines[2].fromRun).toBe(2);
      expect(measure.lines[2].toRun).toBe(2);
      expect(measure.lines[2].toChar).toBe(0);
    });

    it('matches measureParagraphBlock for text + break + break + text', () => {
      const block = createBlock([
        textRun('A'),
        { kind: 'lineBreak' } as Run,
        { kind: 'lineBreak' } as Run,
        textRun('B'),
      ]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(3);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(0);
      expect(measure.lines[1].fromRun).toBe(2);
      expect(measure.lines[1].toRun).toBe(2);
      expect(measure.lines[1].toChar).toBe(0);
      expect(measure.lines[2].fromRun).toBe(3);
      expect(measure.lines[2].toRun).toBe(3);
    });

    it('handles tabs followed immediately by line break', () => {
      const block = createBlock([textRun('A'), tabRun(), textRun('')]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles maxWidth exactly equal to text width', () => {
      const block = createBlock([textRun('Hello')]); // 5 chars = 50px
      const measure = remeasureParagraph(block, 50);

      // The line breaking algorithm checks: width + w > effectiveMaxWidth - WIDTH_FUDGE_PX
      // For character-by-character iteration, this can cause breaks at boundaries
      // Verify the text is measured without errors
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('handles maxWidth slightly less than text width (within fudge factor)', () => {
      const block = createBlock([textRun('Hello')]); // 5 chars = 50px
      const measure = remeasureParagraph(block, 49.7); // Within 0.5px fudge

      // Due to character-by-character measurement, this may still break
      // Verify the text is measured without errors
      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('does not split a borderline narrow list word during remeasure', () => {
      const ctx = document.createElement('canvas').getContext('2d');
      expect(ctx).not.toBeNull();
      const originalMeasureText = ctx!.measureText.bind(ctx);
      const widthMap = new Map<string, number>([
        ['Terms', 48.9],
        ['Term', 39.125],
        ['Ter', 30],
        ['Te', 20],
        ['T', 10],
        ['e', 8.5],
        ['r', 5.8],
        ['m', 14.825],
        ['s', 8.8984375],
        ['1.', 13.34375],
      ]);

      ctx!.measureText = ((text: string) => {
        const mappedWidth = widthMap.get(text);
        if (mappedWidth != null) {
          return { width: mappedWidth } as TextMetrics;
        }
        return originalMeasureText(text);
      }) as typeof ctx.measureText;

      const block = createBlock([textRun('Terms', { bold: true, fontFamily: 'Arial, sans-serif', fontSize: 16 })], {
        indent: { left: 24, hanging: 23.933333333333334 },
        wordLayout: {
          indentLeftPx: 24,
          hangingPx: 23.933333333333334,
          textStartPx: 24,
          marker: {
            markerText: '1.',
            markerBoxWidthPx: 23.933333333333334,
            textStartX: 24,
            gutterWidthPx: 8,
            suffix: 'tab',
            run: {
              fontFamily: 'Arial, sans-serif',
              fontSize: 16,
              bold: true,
            },
          },
        },
      } as ParagraphBlock['attrs']);

      try {
        const measure = remeasureParagraph(block, 72.26666666666667);
        expect(measure.lines).toHaveLength(1);
        expect(measure.lines[0]?.toChar).toBe(5);
      } finally {
        ctx!.measureText = originalMeasureText as typeof ctx.measureText;
      }
    });
  });

  describe('Complex Scenarios', () => {
    it('handles paragraph with all features combined (indents + tabs + breaks)', () => {
      const tabStops: TabStop[] = [{ pos: 720, val: 'start' }]; // 48px
      const block = createBlock(
        [textRun('Start'), tabRun(), textRun('After Tab'), textRun(' More text that will wrap to next line')],
        {
          indent: { left: 10, right: 10, firstLine: 20, hanging: 5 },
          tabs: tabStops,
          tabIntervalTwips: DEFAULT_TAB_INTERVAL_TWIPS,
        },
      );
      const measure = remeasureParagraph(block, 150);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('handles multiple font sizes across multiple lines', () => {
      const block = createBlock([
        textRun('Small', { fontSize: 12 }),
        textRun('Medium', { fontSize: 16 }),
        textRun('Large', { fontSize: 24 }),
        textRun('VeryLarge', { fontSize: 32 }),
      ]);
      const measure = remeasureParagraph(block, 100);

      // Each line should have lineHeight based on max font size in that line
      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('maintains line height consistency within each line', () => {
      const block = createBlock([
        textRun('A', { fontSize: 10 }),
        textRun('B', { fontSize: 20 }),
        textRun('C', { fontSize: 15 }),
      ]);
      const measure = remeasureParagraph(block, 200);

      // All runs on same line, lineHeight should be max (20 * 1.15 = 23)
      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBe(20 * 1.15);
    });

    it('handles alternating text and tab runs', () => {
      const tabStops: TabStop[] = [
        { pos: 720, val: 'start' }, // 48px
        { pos: 1440, val: 'start' }, // 96px
        { pos: 2160, val: 'start' }, // 144px
      ];
      const block = createBlock(
        [textRun('A'), tabRun(), textRun('B'), tabRun(), textRun('C'), tabRun(), textRun('D')],
        { tabs: tabStops },
      );
      const measure = remeasureParagraph(block, 300);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('handles wordLayout.textStartPx for numbered lists', () => {
      // wordLayout.textStartPx is used for list numbering to position first line
      const block = createBlock([textRun('A'.repeat(20))], {
        indent: { left: 0 },
        wordLayout: { textStartPx: 50 },
      });
      const measure = remeasureParagraph(block, 100);

      // First line should have reduced width (100 - 50 = 50px)
      // Subsequent lines should have full width (100px)
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('uses rendered first-line tab stop when wordLayout.textStartPx is missing', () => {
      const block = createBlock([textRun('A'.repeat(60))], {
        indent: { left: 10 },
        wordLayout: { firstLineIndentMode: true, marker: { textStartX: 50 } },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].maxWidth).toBe(52);
      expect(measure.lines[1].maxWidth).toBe(90);
    });

    it('uses rendered first-line tab stop over stale textStart targets when both exist', () => {
      const block = createBlock([textRun('A'.repeat(60))], {
        indent: { left: 10 },
        wordLayout: {
          firstLineIndentMode: true,
          textStartPx: 80,
          marker: { textStartX: 50 },
        },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].maxWidth).toBe(52);
      expect(measure.lines[1].maxWidth).toBe(90);
    });

    it('uses resolved list text start when an explicit suffix tab lands before indentLeft', () => {
      const block = createBlock([textRun('A'.repeat(60))], {
        indent: { left: 90, hanging: 66 },
        wordLayout: {
          indentLeftPx: 90,
          textStartPx: 90,
          tabsPx: [42],
          marker: {
            markerText: '•',
            glyphWidthPx: 6,
            markerBoxWidthPx: 66,
            gutterWidthPx: 8,
            justification: 'left',
            suffix: 'tab',
            run: {
              fontFamily: 'Arial',
              fontSize: 16,
            },
          },
        },
      } as ParagraphBlock['attrs']);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].maxWidth).toBe(158);
      expect(measure.lines[1].maxWidth).toBe(110);
    });

    it('remeasures SD-3426 first-line list tabs from the rendered tab stop', () => {
      const block = createBlock([textRun('A'.repeat(60))], {
        indent: { left: 0, firstLine: 48 },
        wordLayout: {
          firstLineIndentMode: true,
          marker: {
            markerX: 48,
            glyphWidthPx: 18.65625,
            textStartX: 66,
            gutterWidthPx: 8,
            justification: 'left',
            suffix: 'tab',
          },
        },
      });
      const measure = remeasureParagraph(block, 624);

      expect(measure.lines[0].maxWidth).toBeCloseTo(528, 5);
      expect(measure.marker?.markerTextWidth).toBeCloseTo(18.65625, 5);
    });

    it('preserves a list marker when the direct paragraph indent omits hanging', () => {
      const block = createBlock([textRun('A list paragraph')], {
        // Imported DOCX paragraphs can override w:ind without repeating the
        // numbering level's hanging value. wordLayout remains paint-ready.
        indent: { left: 38, right: 1, firstLine: 0 },
        wordLayout: {
          indentLeftPx: 38,
          hangingPx: 18,
          textStartPx: 38,
          marker: {
            markerText: '(a)',
            markerBoxWidthPx: 18,
            markerX: 20,
            glyphWidthPx: 13,
            textStartX: 38,
            gutterWidthPx: 8,
            justification: 'left',
            suffix: 'tab',
            run: {
              fontFamily: 'Arial, sans-serif',
              fontSize: 10.666666666666666,
            },
          },
        },
      } as ParagraphBlock['attrs']);

      const measure = remeasureParagraph(block, 358);

      expect(measure.marker?.markerTextWidth).toBe(13);
      expect(measure.marker?.markerWidth).toBe(13 + LIST_MARKER_GAP);
    });

    it('handles hanging indent with left indent for list formatting', () => {
      // Common list pattern: left indent with hanging indent
      const block = createBlock([textRun('A'.repeat(30))], {
        indent: { left: 20, hanging: 20 },
      });
      const measure = remeasureParagraph(block, 100);

      // First line starts at left edge (left - hanging = 0)
      // Subsequent lines start at left indent (20px)
      expect(measure.lines.length).toBeGreaterThan(1);
    });
  });

  describe('Line Metadata', () => {
    it('sets ascent and descent to 0 (not calculated in remeasure)', () => {
      const block = createBlock([textRun('Hello')]);
      const measure = remeasureParagraph(block, 100);

      // Implementation sets ascent/descent to 0 (full typography in measuring/dom)
      expect(measure.lines[0].ascent).toBe(0);
      expect(measure.lines[0].descent).toBe(0);
    });

    it('sets maxWidth on each line to effective width for that line', () => {
      const block = createBlock([textRun('A'.repeat(20))], {
        indent: { firstLine: 30 },
      });
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      // First line has reduced maxWidth
      expect(measure.lines[0].maxWidth).toBeLessThan(measure.lines[1].maxWidth);
    });

    it('correctly sets fromRun, toRun, fromChar, toChar boundaries', () => {
      const block = createBlock([textRun('Hello'), textRun('World')]);
      const measure = remeasureParagraph(block, 60); // Force break

      measure.lines.forEach((line, i) => {
        expect(line.fromRun).toBeGreaterThanOrEqual(0);
        expect(line.toRun).toBeLessThanOrEqual(block.runs.length);
        expect(line.fromChar).toBeGreaterThanOrEqual(0);
        // Each line should have content, but toChar can equal fromChar for empty runs or end boundaries
        expect(line.toChar).toBeGreaterThanOrEqual(line.fromChar);
      });
    });

    it('advances run and char correctly across line boundaries', () => {
      const block = createBlock([textRun('AAAAAAAAAA')]); // 10 chars
      const measure = remeasureParagraph(block, 50); // Force break at ~5 chars

      expect(measure.lines.length).toBeGreaterThan(1);
      // Second line should start where first line ended
      expect(measure.lines[1].fromRun).toBeGreaterThanOrEqual(measure.lines[0].toRun);
      if (measure.lines[1].fromRun === measure.lines[0].toRun) {
        expect(measure.lines[1].fromChar).toBeGreaterThanOrEqual(measure.lines[0].toChar);
      }
    });
  });

  describe('Total Height Calculation', () => {
    it('calculates totalHeight as sum of all line heights', () => {
      const block = createBlock([textRun('A'.repeat(30))]);
      const measure = remeasureParagraph(block, 50);

      const sumLineHeights = measure.lines.reduce((sum, line) => sum + line.lineHeight, 0);
      expect(measure.totalHeight).toBe(sumLineHeights);
    });

    it('returns zero total height for empty paragraph', () => {
      const block = createBlock([]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.totalHeight).toBe(0);
    });

    it('handles varying line heights across lines', () => {
      const block = createBlock([
        textRun('Small', { fontSize: 12 }), // First line: 12 * 1.15 = 13.8
        textRun(' '),
        textRun('Large'.repeat(10), { fontSize: 24 }), // Subsequent lines: 24 * 1.15 = 27.6
      ]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThan(1);
      // totalHeight should reflect sum of different line heights
      expect(measure.totalHeight).toBeGreaterThan(measure.lines[0].lineHeight);
    });
  });

  describe('Text Transformation', () => {
    it('applies uppercase transformation correctly', () => {
      const block = createBlock([textRun('hello world', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Transformed text "HELLO WORLD" should have same width as original (same char count)
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('applies lowercase transformation correctly', () => {
      const block = createBlock([textRun('HELLO WORLD', { textTransform: 'lowercase' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Transformed text "hello world" should have same width as original (same char count)
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('applies capitalize transformation to each word', () => {
      const block = createBlock([textRun('hello world', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Transformed text "Hello World" should have same width (same char count)
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('capitalizes first letter after non-word characters', () => {
      const block = createBlock([textRun('hello-beautiful world', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 300);

      expect(measure.lines).toHaveLength(1);
      // Transformed to "Hello-Beautiful World" - same char count
      expect(measure.lines[0].width).toBe(21 * CHAR_WIDTH);
    });

    it('handles capitalize with numbers', () => {
      const block = createBlock([textRun('123hello world456', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 300);

      expect(measure.lines).toHaveLength(1);
      // Numbers are word characters, so 'h' after 123 gets capitalized
      // Result: "123Hello World456"
      expect(measure.lines[0].width).toBe(17 * CHAR_WIDTH);
    });

    it('handles capitalize with apostrophes (contractions)', () => {
      const block = createBlock([textRun("don't stop", { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Apostrophe is a word character, so "don't" stays as one word: "Don't Stop"
      expect(measure.lines[0].width).toBe(10 * CHAR_WIDTH);
    });

    it('handles none transformation (no change)', () => {
      const block = createBlock([textRun('Hello World', { textTransform: 'none' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // No transformation applied
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('handles undefined textTransform (no change)', () => {
      const block = createBlock([textRun('Hello World')]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // No transformation when textTransform is undefined
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('applies transformation when text wraps across multiple lines', () => {
      const block = createBlock([textRun('hello beautiful world', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 100); // Force line breaks

      expect(measure.lines.length).toBeGreaterThan(1);
      // Total width across all lines should reflect uppercase transformation
      const totalWidth = measure.lines.reduce((sum, line) => sum + line.width, 0);
      expect(totalWidth).toBeGreaterThan(0);
    });

    it('applies capitalize correctly across line boundaries', () => {
      // "hello world" breaks into multiple lines, capitalize should apply to each word
      const block = createBlock([textRun('hello world test', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 70); // Force breaks

      expect(measure.lines.length).toBeGreaterThan(1);
      // Verify text was measured (transformation shouldn't break measurement)
      const totalWidth = measure.lines.reduce((sum, line) => sum + line.width, 0);
      expect(totalWidth).toBeGreaterThan(0);
    });

    it('handles empty text with transformation', () => {
      const block = createBlock([textRun('', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(0);
      // Empty text should produce minimal output
    });

    it('handles whitespace-only text with transformation', () => {
      const block = createBlock([textRun('   ', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 100);

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      // Whitespace transformed is still whitespace
      expect(measure.lines[0].width).toBe(3 * CHAR_WIDTH);
    });

    it('applies different transformations to different runs', () => {
      const block = createBlock([
        textRun('hello', { textTransform: 'uppercase' }),
        textRun(' '),
        textRun('world', { textTransform: 'capitalize' }),
      ]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "HELLO World" = 11 chars
      expect(measure.lines[0].width).toBe(11 * CHAR_WIDTH);
    });

    it('handles capitalize with multiple consecutive spaces', () => {
      const block = createBlock([textRun('hello  world', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "Hello  World" - spaces don't change
      expect(measure.lines[0].width).toBe(12 * CHAR_WIDTH);
    });

    it('handles capitalize with leading spaces', () => {
      const block = createBlock([textRun('  hello world', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "  Hello World" - leading spaces preserved
      expect(measure.lines[0].width).toBe(13 * CHAR_WIDTH);
    });

    it('handles capitalize with trailing spaces', () => {
      const block = createBlock([textRun('hello world  ', { textTransform: 'capitalize' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "Hello World  " - trailing spaces preserved
      expect(measure.lines[0].width).toBe(13 * CHAR_WIDTH);
    });

    it('handles special characters with transformations', () => {
      const block = createBlock([textRun('hello@world.com', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // "HELLO@WORLD.COM" - special chars unchanged
      expect(measure.lines[0].width).toBe(15 * CHAR_WIDTH);
    });

    it('handles unicode characters with transformations', () => {
      const block = createBlock([textRun('café résumé', { textTransform: 'uppercase' })]);
      const measure = remeasureParagraph(block, 200);

      expect(measure.lines).toHaveLength(1);
      // Unicode chars should be handled by JavaScript's toUpperCase
      expect(measure.lines[0].width).toBeGreaterThan(0);
    });
  });

  describe('vanished run remeasurement', () => {
    it('keeps vanished text out of fast remeasure width and line height', () => {
      const block = createBlock([textRun('abcdef', { fontSize: 72, vanish: true }), textRun('X', { fontSize: 12 })]);
      const measure = remeasureParagraph(block, 1000);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(1);
      expect(measure.lines[0].width).toBe(CHAR_WIDTH);
      expect(measure.lines[0].lineHeight).toBe(12 * 1.15);
    });

    it('does not advance visible text through a vanished tab run', () => {
      const block = createBlock([tabRun({ fontSize: 16, vanish: true }), textRun('X', { fontSize: 12 })]);
      const measure = remeasureParagraph(block, 1000);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBe(1);
      expect(measure.lines[0].width).toBe(CHAR_WIDTH);
      expect(measure.lines[0].lineHeight).toBe(12 * 1.15);
    });

    it('uses visible tab font size when vanished text precedes a tab run', () => {
      const visibleTabBlock = createBlock([tabRun({ fontSize: 12 })]);
      const hiddenBeforeTabBlock = createBlock([
        textRun('abcdef', { fontSize: 72, vanish: true }),
        tabRun({ fontSize: 12 }),
      ]);

      const visibleTabMeasure = remeasureParagraph(visibleTabBlock, 1000);
      const hiddenBeforeTabMeasure = remeasureParagraph(hiddenBeforeTabBlock, 1000);

      expect(visibleTabMeasure.lines[0].lineHeight).toBe(12 * 1.15);
      expect(hiddenBeforeTabMeasure.lines).toHaveLength(1);
      expect(hiddenBeforeTabMeasure.lines[0].width).toBe(visibleTabMeasure.lines[0].width);
      expect(hiddenBeforeTabMeasure.lines[0].lineHeight).toBe(visibleTabMeasure.lines[0].lineHeight);
    });
  });

  describe('inline image baseline alignment parity', () => {
    const imageRun = (overrides?: Partial<Run>): Run =>
      ({ kind: 'image', src: 'data:image/png;base64,AAAA', width: 11, height: 10, ...overrides }) as Run;

    it('emits baseline alignment for a small inline image + text after reflow', () => {
      const block = createBlock([textRun('1.'), imageRun({ pmStart: 2, pmEnd: 3 }), textRun(' Title')]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].inlineImageAlignments).toEqual([{ runIndex: 1, verticalAlign: 'baseline' }]);
      // Image width is preserved in the reflowed line width (no longer dropped).
      expect(measure.lines[0].width).toBeGreaterThan(0);
    });

    it('keeps a tall inline image top-aligned after reflow (no baseline entry)', () => {
      const block = createBlock([textRun('Before '), imageRun({ width: 40, height: 40, pmStart: 7, pmEnd: 8 })]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
      expect(measure.lines[0].lineHeight).toBe(40);
      expect(measure.totalHeight).toBe(40);
    });

    it('does not baseline an image with an explicit verticalAlign', () => {
      const block = createBlock([textRun('x'), imageRun({ verticalAlign: 'top', pmStart: 1, pmEnd: 2 })]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('does not baseline a zero-width image after reflow', () => {
      const block = createBlock([textRun('x'), imageRun({ width: 0, height: 10, pmStart: 1, pmEnd: 2 })]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('does not baseline an image-only line (no text metrics)', () => {
      const block = createBlock([imageRun({ pmStart: 0, pmEnd: 1 })]);
      const measure = remeasureParagraph(block, 500);

      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });
  });

  /**
   * This fallback wrapper is used for narrow columns, float-constrained
   * paragraphs, and textboxes. It must break CJK the same way the primary
   * measurer in `measuring/dom` does, or the same document wraps differently
   * depending on which path measured it.
   */
  describe('CJK Line Breaking', () => {
    const FORBIDDEN_LINE_START = '、。，．：；！？）］｝〉》」』】〕';
    const FORBIDDEN_LINE_END = '（［｛〈《「『【〔';

    const lineTexts = (text: string, maxWidth: number): string[] => {
      const block = createBlock([textRun(text)]);
      return remeasureParagraph(block, maxWidth).lines.map((line) => text.slice(line.fromChar, line.toChar));
    };

    it('never opens a line with a forbidden closer', () => {
      const clause = '第一条，第二条，第三条，第四条，第五条。';

      for (const maxWidth of [30, 40, 50, 60, 70, 80]) {
        const texts = lineTexts(clause, maxWidth);
        expect(texts.join('')).toBe(clause);
        for (const text of texts.slice(1)) {
          expect(FORBIDDEN_LINE_START.includes(text[0])).toBe(false);
        }
      }
    });

    it('never ends a line with a forbidden opener', () => {
      const clause = '适用（一）（二）（三）（四）（五）';

      for (const maxWidth of [30, 40, 50, 60, 70, 80]) {
        const texts = lineTexts(clause, maxWidth);
        expect(texts.join('')).toBe(clause);
        for (const text of texts.slice(0, -1)) {
          expect(FORBIDDEN_LINE_END.includes(text[text.length - 1])).toBe(false);
        }
      }
    });

    it('applies kinsoku when the overflowing glyph is Latin', () => {
      // `甲（` fits, `A` does not. The overflowing glyph is Latin, but the
      // boundary still lands after a forbidden opener.
      const text = '甲（A';
      const texts = lineTexts(text, 25);

      expect(texts.join('')).toBe(text);
      for (const line of texts.slice(0, -1)) {
        expect(FORBIDDEN_LINE_END.includes(line[line.length - 1])).toBe(false);
      }
    });

    it('prefers a passed ideograph boundary over an earlier space', () => {
      // The overflowing glyph is `A`, but `本合同` offered break opportunities
      // after the space. Rewinding to the space strands `甲方` on a short line.
      const text = '甲方 本合同ABC';
      const texts = lineTexts(text, 65);

      expect(texts.join('')).toBe(text);
      expect(texts[0].length).toBeGreaterThan('甲方 '.length);
    });

    it('breaks astral ideographs on code-point boundaries', () => {
      const text = '\u{20000}\u{20001}\u{20002}\u{20003}\u{20004}';
      const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/;

      for (const maxWidth of [25, 35, 45, 55, 65]) {
        const texts = lineTexts(text, maxWidth);
        expect(texts.join('')).toBe(text);
        for (const line of texts) expect(line).not.toMatch(lone);
      }
    });

    it('breaks between ideographs rather than rewinding to an earlier space', () => {
      // Every ideograph is a break opportunity, so the fitter must not rewind to
      // the space and strand `甲方` alone on the first line.
      const text = '甲方 本合同由甲乙双方签署并生效';
      const texts = lineTexts(text, 80);

      expect(texts.join('')).toBe(text);
      expect(texts[0].length).toBeGreaterThan('甲方 '.length);
    });
  });
});
