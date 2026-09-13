import type { FlowBlock, Line, ParagraphBlock, ParagraphMeasure } from './index.js';
import { isBodyNoteReferenceRun, isEmptySdtPlaceholderRun } from './run-helpers.js';

/**
 * Represents a ProseMirror position range for a line or fragment.
 */
export type LinePmRange = { pmStart?: number; pmEnd?: number };

/**
 * Type guard to check if a run kind represents an atomic (non-text) element.
 *
 * @param kind - The run kind to check
 * @returns True if the kind is an atomic run type (image, lineBreak, break, tab, fieldAnnotation)
 */
const isAtomicRunKind = (kind: unknown): kind is 'image' | 'lineBreak' | 'break' | 'tab' | 'fieldAnnotation' =>
  kind === 'image' || kind === 'lineBreak' || kind === 'break' || kind === 'tab' || kind === 'fieldAnnotation';

/**
 * Checks if a run represents an image-like element (has a src property).
 *
 * @param run - The run to check
 * @returns True if the run has a string src property
 */
const isImageLikeRun = (run: unknown): boolean => {
  if (!run || typeof run !== 'object') return false;
  const candidate = (run as { src?: unknown }).src;
  return typeof candidate === 'string';
};

/**
 * Safely extracts the text property from a run object.
 *
 * @param run - The run to extract text from
 * @returns The text string if present, empty string otherwise
 */
const coerceRunText = (run: unknown): string => {
  if (!run || typeof run !== 'object') return '';
  const candidate = (run as { text?: unknown }).text;
  return typeof candidate === 'string' ? candidate : '';
};

/**
 * Safely extracts the pmStart property from a run object.
 *
 * @param run - The run to extract pmStart from
 * @returns The pmStart number if present and valid, undefined otherwise
 */
const coercePmStart = (run: unknown): number | undefined => {
  if (!run || typeof run !== 'object') return undefined;
  const candidate = (run as { pmStart?: unknown }).pmStart;
  return typeof candidate === 'number' ? candidate : undefined;
};

/**
 * Safely extracts the pmEnd property from a run object.
 *
 * @param run - The run to extract pmEnd from
 * @returns The pmEnd number if present and valid, undefined otherwise
 */
const coercePmEnd = (run: unknown): number | undefined => {
  if (!run || typeof run !== 'object') return undefined;
  const candidate = (run as { pmEnd?: unknown }).pmEnd;
  return typeof candidate === 'number' ? candidate : undefined;
};

/**
 * Computes the ProseMirror position range covered by a single line.
 *
 * Iterates through the runs that comprise the line (from line.fromRun to line.toRun),
 * extracting PM positions and handling both text runs and atomic runs (images, breaks, etc.).
 * For text runs, accounts for partial line slices using fromChar and toChar offsets.
 *
 * @param block - The flow block containing the line (must be a paragraph block)
 * @param line - The line to compute the PM range for
 * @returns Object with pmStart and pmEnd properties, or empty object if block is not a paragraph
 *
 * @remarks
 * - Returns empty object {} if block.kind !== 'paragraph'
 * - Atomic runs are treated as single-position elements (pmEnd defaults to pmStart + 1)
 * - For text runs, uses character offsets to compute precise PM boundaries
 * - Handles first/last run slicing based on line.fromChar and line.toChar
 */
export function computeLinePmRange(block: FlowBlock, line: Line): LinePmRange {
  if (!line) return {};
  if (block.kind !== 'paragraph') return {};

  let pmStart: number | undefined;
  let pmEnd: number | undefined;

  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex];
    if (!run) continue;

    const runPmStart = coercePmStart(run);
    if (runPmStart == null) continue;

    if (isEmptySdtPlaceholderRun(run)) {
      const runPmEnd = coercePmEnd(run) ?? runPmStart;
      if (pmStart == null) {
        pmStart = runPmStart;
      }
      pmEnd = runPmEnd;
      continue;
    }

    if (isBodyNoteReferenceRun(run) || isAtomicRunKind((run as { kind?: unknown }).kind) || isImageLikeRun(run)) {
      const runPmEnd = coercePmEnd(run) ?? runPmStart + 1;
      if (pmStart == null) {
        pmStart = runPmStart;
      }
      pmEnd = runPmEnd;
      continue;
    }

    const text = coerceRunText(run);
    const runLength = text.length;

    const isFirstRun = runIndex === line.fromRun;
    const isLastRun = runIndex === line.toRun;
    const startOffset = isFirstRun ? line.fromChar : 0;
    const endOffset = isLastRun ? line.toChar : runLength;

    const sliceStart = runPmStart + startOffset;
    const sliceEnd = runPmStart + endOffset;

    if (pmStart == null) {
      pmStart = sliceStart;
    }
    pmEnd = sliceEnd;
  }

  return { pmStart, pmEnd };
}

/**
 * Computes the ProseMirror position range covered by a fragment (a range of lines).
 *
 * Iterates through lines from fromLine to toLine (exclusive), computing the PM range
 * for each line and merging them into a single continuous range.
 *
 * @param block - The paragraph block containing the lines
 * @param lines - Array of lines from the paragraph measure
 * @param fromLine - Starting line index (inclusive)
 * @param toLine - Ending line index (exclusive)
 * @returns Object with pmStart and pmEnd properties representing the entire fragment range
 *
 * @remarks
 * - The fragment spans lines [fromLine, toLine) (toLine is exclusive)
 * - pmStart is taken from the first line with a valid pmStart
 * - pmEnd is continuously updated to the last valid pmEnd encountered
 * - Returns empty pmStart/pmEnd if no lines have valid PM ranges
 */
export function computeFragmentPmRange(
  block: ParagraphBlock,
  lines: ParagraphMeasure['lines'],
  fromLine: number,
  toLine: number,
): LinePmRange {
  let pmStart: number | undefined;
  let pmEnd: number | undefined;

  for (let index = fromLine; index < toLine; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const range = computeLinePmRange(block, line);
    if (range.pmStart != null && pmStart == null) {
      pmStart = range.pmStart;
    }
    if (range.pmEnd != null) {
      pmEnd = range.pmEnd;
    }
  }

  return { pmStart, pmEnd };
}
