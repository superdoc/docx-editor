import type { ParagraphBlock, Run } from './index.js';

export const INLINE_OBJECT_REPLACEMENT_CHARACTER = '\uFFFC';

export type ParagraphVisibleRunSlice = {
  runIndex: number;
  fromChar: number;
  toChar: number;
};

const isTextRun = (run: Run): run is Extract<Run, { kind?: 'text' }> =>
  (run.kind === undefined || run.kind === 'text') && 'text' in run;

export const runVisibleLength = (run: Run): number => (isTextRun(run) ? run.text.length : 1);

export const splitsSurrogatePair = (text: string, offset: number): boolean => {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
};

/**
 * Flattens a paragraph into Document API visible-text coordinates.
 *
 * Text is preserved verbatim in UTF-16. Every non-text run contributes one
 * U+FFFC object-replacement character, regardless of its rendered label.
 */
export const flattenParagraphVisibleText = (block: ParagraphBlock): string =>
  block.runs.map((run) => (isTextRun(run) ? run.text : INLINE_OBJECT_REPLACEMENT_CHARACTER)).join('');

/**
 * Maps a validated visible-text range to slices in the paragraph's run space.
 * Returns null for non-integer, reversed, negative, or out-of-bounds ranges.
 */
export const mapVisibleRangeToRunSlices = (
  block: ParagraphBlock,
  from: number,
  to: number,
): ParagraphVisibleRunSlice[] | null => {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return null;
  const visibleText = flattenParagraphVisibleText(block);
  if (to > visibleText.length || splitsSurrogatePair(visibleText, from) || splitsSurrogatePair(visibleText, to)) {
    return null;
  }

  const slices: ParagraphVisibleRunSlice[] = [];
  let visibleOffset = 0;
  for (let runIndex = 0; runIndex < block.runs.length; runIndex += 1) {
    const length = runVisibleLength(block.runs[runIndex]!);
    const runStart = visibleOffset;
    const runEnd = runStart + length;
    visibleOffset = runEnd;

    const sliceStart = Math.max(from, runStart);
    const sliceEnd = Math.min(to, runEnd);
    if (sliceStart < sliceEnd) {
      slices.push({ runIndex, fromChar: sliceStart - runStart, toChar: sliceEnd - runStart });
    }
  }

  return slices;
};
