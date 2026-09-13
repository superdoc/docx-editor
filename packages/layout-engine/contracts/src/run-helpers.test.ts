import { describe, it, expect } from 'vite-plus/test';
import type { FlowBlock, Line, ParagraphBlock, Run, TabRun, TextRun, TrackedChangeMeta } from './index.js';
import {
  expandRunsForInlineNewlines,
  isEmptySdtPlaceholderRun,
  sliceRunsForLine,
  usesPositionedTextGeometry,
} from './run-helpers.js';

describe('expandRunsForInlineNewlines', () => {
  const makeRun = (text: string, pmStart = 0): TextRun => ({
    text,
    fontFamily: 'Arial',
    fontSize: 12,
    pmStart,
    pmEnd: pmStart + text.length,
  });

  it('returns runs without inline newlines unchanged', () => {
    const runs: Run[] = [makeRun('hello')];
    expect(expandRunsForInlineNewlines(runs)).toEqual(runs);
  });

  it('splits a text run at a single inline newline', () => {
    const result = expandRunsForInlineNewlines([makeRun('foo\nbar')]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ text: 'foo', pmStart: 0, pmEnd: 3 });
    expect(result[1]).toMatchObject({ kind: 'break', pmStart: 3, pmEnd: 4 });
    expect(result[2]).toMatchObject({ text: 'bar', pmStart: 4, pmEnd: 7 });
  });

  it('keeps the break and advances the cursor for a leading newline', () => {
    const result = expandRunsForInlineNewlines([makeRun('\nfoo')]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'break', pmStart: 0, pmEnd: 1 });
    expect(result[1]).toMatchObject({ text: 'foo', pmStart: 1, pmEnd: 4 });
  });

  it('keeps both breaks when a run contains consecutive inline newlines', () => {
    const result = expandRunsForInlineNewlines([makeRun('a\n\nb')]);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ text: 'a', pmStart: 0, pmEnd: 1 });
    expect(result[1]).toMatchObject({ kind: 'break', pmStart: 1, pmEnd: 2 });
    expect(result[2]).toMatchObject({ kind: 'break', pmStart: 2, pmEnd: 3 });
    expect(result[3]).toMatchObject({ text: 'b', pmStart: 3, pmEnd: 4 });
  });

  it('does not emit an empty trailing text run for a trailing newline', () => {
    const result = expandRunsForInlineNewlines([makeRun('foo\n')]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: 'foo', pmStart: 0, pmEnd: 3 });
    expect(result[1]).toMatchObject({ kind: 'break', pmStart: 3, pmEnd: 4 });
  });

  it('propagates trackedChange metadata onto emitted break runs', () => {
    const trackedChange: TrackedChangeMeta = {
      id: 'change-1',
      kind: 'insert',
      author: 'alice',
      date: '2024-01-01T00:00:00Z',
    };
    const run: TextRun = { ...makeRun('foo\nbar'), trackedChange };
    const result = expandRunsForInlineNewlines([run]);
    expect(result[1]).toMatchObject({ kind: 'break', trackedChange });
  });
});

describe('sliceRunsForLine', () => {
  const makeTextRun = (text: string, pmStart = 0): TextRun => ({
    text,
    fontFamily: 'Arial',
    fontSize: 12,
    pmStart,
    pmEnd: pmStart + text.length,
  });

  const makeParagraph = (runs: Run[]): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'p-1',
    runs,
  });

  const makeLine = (overrides: Partial<Line> = {}): Line => ({
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: 0,
    width: 0,
    ascent: 12,
    descent: 4,
    lineHeight: 16,
    ...overrides,
  });

  it('returns an empty array for non-paragraph blocks', () => {
    const block: FlowBlock = {
      kind: 'image',
      id: 'i-1',
      attrs: { src: 'about:blank', alt: '' },
    } as unknown as FlowBlock;
    expect(sliceRunsForLine(block, makeLine())).toEqual([]);
  });

  it('passes tab runs through unchanged', () => {
    const tab: TabRun = { kind: 'tab', text: '\t', pmStart: 0, pmEnd: 1 };
    const block = makeParagraph([tab]);
    const line = makeLine({ toRun: 0, fromChar: 0, toChar: 1 });
    expect(sliceRunsForLine(block, line)).toEqual([tab]);
  });

  it('passes line-break runs through unchanged', () => {
    const lineBreak: Run = { kind: 'lineBreak', pmStart: 0, pmEnd: 1 } as Run;
    const block = makeParagraph([lineBreak]);
    const line = makeLine({ toRun: 0, fromChar: 0, toChar: 1 });
    expect(sliceRunsForLine(block, line)).toEqual([lineBreak]);
  });

  it('slices text on the first/last run and adjusts pmStart/pmEnd', () => {
    const run = makeTextRun('hello world', 100);
    const block = makeParagraph([run]);
    const line = makeLine({ fromRun: 0, fromChar: 0, toRun: 0, toChar: 5 });
    const result = sliceRunsForLine(block, line);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ text: 'hello', pmStart: 100, pmEnd: 105 });
  });

  it('preserves a multi-digit body note reference as one coordinate unit', () => {
    const marker: TextRun = {
      kind: 'text',
      text: '10',
      fontFamily: 'Arial',
      fontSize: 12,
      pmStart: 100,
      pmEnd: 101,
      dataAttrs: { 'data-v2-note-ref': 'footnote:10' },
    };
    const block = makeParagraph([marker]);
    const line = makeLine({ fromRun: 0, fromChar: 0, toRun: 0, toChar: marker.text.length });

    expect(sliceRunsForLine(block, line)).toEqual([marker]);

    const partialLine = makeLine({ fromRun: 0, fromChar: 1, toRun: 0, toChar: 2 });
    expect(sliceRunsForLine(block, partialLine)).toEqual([{ ...marker, text: '0' }]);
  });

  it('passes middle text runs through unchanged when the line spans multiple runs', () => {
    const first = makeTextRun('foo', 0);
    const middle = makeTextRun('bar', 3);
    const last = makeTextRun('baz', 6);
    const block = makeParagraph([first, middle, last]);
    const line = makeLine({ fromRun: 0, fromChar: 0, toRun: 2, toChar: 3 });
    const result = sliceRunsForLine(block, line);
    expect(result).toHaveLength(3);
    expect(result[1]).toBe(middle);
  });

  it('drops empty slices when the requested range produces no characters', () => {
    const run = makeTextRun('abc', 0);
    const block = makeParagraph([run]);
    const line = makeLine({ fromRun: 0, fromChar: 2, toRun: 0, toChar: 2 });
    expect(sliceRunsForLine(block, line)).toEqual([]);
  });

  it('preserves empty inline SDT visual placeholders', () => {
    const run: TextRun = {
      kind: 'text',
      text: '',
      fontFamily: 'Arial',
      fontSize: 12,
      pmStart: 10,
      pmEnd: 10,
      visualPlaceholder: 'emptyInlineSdt',
      sdt: { type: 'structuredContent', scope: 'inline', id: 'sdt-1' },
    };
    const block = makeParagraph([run]);
    const line = makeLine({ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0 });

    expect(sliceRunsForLine(block, line)).toEqual([run]);
  });

  it('recognizes block SDT visual placeholders', () => {
    const run: TextRun = {
      kind: 'text',
      text: '',
      fontFamily: 'Arial',
      fontSize: 12,
      visualPlaceholder: 'emptyBlockSdt',
      sdt: { type: 'structuredContent', scope: 'block', id: 'sdt-block-1' },
    };

    expect(isEmptySdtPlaceholderRun(run)).toBe(true);
  });

  it('does not change text slicing or classify a boxed range as atomic', () => {
    const plain = makeParagraph([makeTextRun('Citation', 10)]);
    const boxed: ParagraphBlock = {
      ...plain,
      inlineBoxes: [
        {
          id: 'citation',
          from: 1,
          to: 7,
          layout: {
            paddingInlineStart: 4,
            paddingInlineEnd: 4,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
            gapBefore: 1,
            gapAfter: 1,
            borderWidth: 1,
          },
          appearance: { backgroundColor: '#eef2ff' },
        },
      ],
    };
    const line = makeLine({ fromRun: 0, fromChar: 1, toRun: 0, toChar: 7 });

    expect(sliceRunsForLine(boxed, line)).toEqual(sliceRunsForLine(plain, line));
    expect(sliceRunsForLine(boxed, line)).toMatchObject([{ text: 'itatio', pmStart: 11, pmEnd: 17 }]);
  });
});

describe('usesPositionedTextGeometry', () => {
  const makeLine = (overrides: Partial<Line> = {}): Line => ({
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: 4,
    width: 40,
    ascent: 12,
    descent: 4,
    lineHeight: 16,
    ...overrides,
  });

  const textRun = (horizontalScale?: number): TextRun => ({
    kind: 'text',
    text: 'text',
    fontFamily: 'Arial',
    fontSize: 12,
    pmStart: 0,
    pmEnd: 4,
    ...(horizontalScale === undefined ? {} : { horizontalScale }),
  });

  it('uses positioned geometry for explicit measured segment coordinates', () => {
    const line = makeLine({ segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40, x: 12 }] });
    expect(usesPositionedTextGeometry(line, [textRun()], false)).toBe(true);
  });

  it('uses positioned geometry when horizontal scaling needs measured advances', () => {
    const line = makeLine({ segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40 }] });
    expect(usesPositionedTextGeometry(line, [textRun(1.5)], false)).toBe(true);
  });

  it('keeps ordinary and RTL text in browser inline flow', () => {
    const line = makeLine({ segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40 }] });
    expect(usesPositionedTextGeometry(line, [textRun()], false)).toBe(false);
    expect(usesPositionedTextGeometry(line, [textRun(1.5)], true)).toBe(false);
  });
});
