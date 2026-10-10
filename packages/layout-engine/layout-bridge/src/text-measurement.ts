import type { FlowBlock, Line, Run, TabRun } from '@superdoc/contracts';
import {
  interCharacterJustifyAdvanceBeforeOffset,
  isBodyNoteReferenceRun,
  sliceRunsForLine,
} from '@superdoc/contracts';
import { DEFAULT_FONT_MEASURE_CONTEXT, type FaceKey, type FontMeasureContext } from '@superdoc/font-system';
import { countSpaces, getJustifyAdjustment } from './line-justify-adjustment.js';

/**
 * Shared text measurement utility for accurate character positioning.
 * Uses a stateful Canvas context to avoid repeated allocation.
 *
 * This module provides the single source of truth for converting between:
 * - ProseMirror positions and X coordinates
 * - X coordinates and character offsets
 *
 * Used by both:
 * - Click-to-position mapping (layout-bridge)
 * - Caret rendering (demo-app selection-overlay)
 */

// Stateful canvas for text measurement
let measurementCanvas: HTMLCanvasElement | null = null;
let measurementCtx: CanvasRenderingContext2D | null = null;

const TAB_CHAR_LENGTH = 1;
const FOOTNOTE_MARKER_DATA_ATTR = 'data-sd-footnote-number';

const getRunDataAttrs = (run: Run | undefined): Record<string, string> | undefined => {
  if (!run || !('dataAttrs' in run)) {
    return undefined;
  }
  return run.dataAttrs;
};

const getRunCharacterLength = (run: Run | undefined): number => {
  if (!run) return 0;
  if (isTabRun(run)) return TAB_CHAR_LENGTH;
  if (
    'src' in run ||
    run.kind === 'lineBreak' ||
    run.kind === 'break' ||
    run.kind === 'fieldAnnotation' ||
    run.kind === 'math'
  ) {
    return 0;
  }
  return run.text?.length ?? 0;
};

const isVisualOnlyRun = (run: Run | undefined): boolean => {
  return getRunDataAttrs(run)?.[FOOTNOTE_MARKER_DATA_ATTR] === 'true';
};

const isVanishedRun = (run: Run | undefined): boolean => {
  return !!run && 'vanish' in run && run.vanish === true;
};

const isTabRun = (run: Run): run is TabRun => run?.kind === 'tab';

const faceOf = (run: { bold?: boolean; italic?: boolean }): FaceKey => ({
  weight: run.bold ? '700' : '400',
  style: run.italic ? 'italic' : 'normal',
});

const isWordChar = (char: string): boolean => {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === "'";
};

const capitalizeText = (text: string): string => {
  if (!text) return text;
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const prevChar = i > 0 ? text[i - 1] : '';
    const ch = text[i];
    result += isWordChar(ch) && !isWordChar(prevChar) ? ch.toUpperCase() : ch;
  }
  return result;
};

const applyTextTransform = (
  text: string,
  transform: 'uppercase' | 'lowercase' | 'capitalize' | 'none' | undefined,
): string => {
  if (!text || !transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return capitalizeText(text);
  return text;
};

/**
 * Get or create the measurement canvas context.
 * Lazy initialization to avoid creating canvas in non-browser environments.
 */
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementCtx) return measurementCtx;

  if (typeof document === 'undefined') {
    // Only warn in non-test environments - Canvas fallback is expected in tests
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[text-measurement] Canvas not available (non-browser environment)');
    }
    return null;
  }

  measurementCanvas = document.createElement('canvas');
  try {
    measurementCtx = measurementCanvas.getContext('2d');
  } catch {
    measurementCtx = null;
  }

  if (!measurementCtx && process.env.NODE_ENV !== 'test') {
    console.warn('[text-measurement] Failed to create 2D context');
  }

  return measurementCtx;
}

/**
 * Generates a CSS font string from a run's formatting properties.
 *
 * @param run - The text or tab run to generate font string for
 * @returns CSS font string (e.g., "italic bold 16px Arial")
 */
export function getRunFontString(run: Run, fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT): string {
  // TabRun, ImageRun, LineBreakRun, BreakRun, FieldAnnotationRun, and MathRun
  // don't have full styling properties, use defaults.
  if (
    run.kind === 'tab' ||
    run.kind === 'lineBreak' ||
    run.kind === 'break' ||
    run.kind === 'fieldAnnotation' ||
    run.kind === 'math' ||
    'src' in run
  ) {
    return 'normal normal 16px Arial';
  }

  const style = run.italic ? 'italic' : 'normal';
  const weight = run.bold ? 'bold' : 'normal';
  const fontSize = run.fontSize ?? 16;
  const fontFamily = fontContext.resolvePhysical(run.fontFamily ?? 'Arial', faceOf(run));
  return `${style} ${weight} ${fontSize}px ${fontFamily}`;
}

/**
 * Measure the X position for a specific character offset within a line.
 * Uses Canvas measureText for pixel-perfect accuracy.
 *
 * @param block - The paragraph block containing the line
 * @param line - The line to measure within
 * @param charOffset - Character offset from the start of the line (0-based)
 * @param availableWidthOverride - Optional override for available width
 * @param alignmentOverride - Optional override for text alignment (e.g., 'left' for list items
 *   which are always rendered left-aligned in the DOM regardless of paragraph alignment)
 * @returns The X coordinate (in pixels) from the start of the line
 */
function measureCharacterXWithoutInlineBoxes(
  block: FlowBlock,
  line: Line,
  charOffset: number,
  availableWidthOverride?: number,
  alignmentOverride?: string,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): number {
  const ctx = getMeasurementContext();
  const availableWidth =
    availableWidthOverride ??
    line.maxWidth ??
    // Fallback: if no maxWidth, approximate available width as line width (no slack)
    line.width;
  // Pass availableWidth to justify calculation to match painter's word-spacing
  const justify = getJustifyAdjustment({
    block,
    line,
    availableWidthOverride: availableWidth,
    alignmentOverride,
  });
  const alignment = alignmentOverride ?? (block.kind === 'paragraph' ? block.attrs?.alignment : undefined);
  // For justify alignment, the line is stretched to fill available width (slack distributed across spaces)
  // For center/right alignment, the line keeps its natural width and is positioned within the available space
  const renderedLineWidth =
    alignment === 'justify' && (justify.extraPerSpace !== 0 || justify.interCharacterSpacing !== 0)
      ? availableWidth
      : line.width;
  const hasExplicitPositioning = line.segments?.some((seg) => seg.x !== undefined);
  const alignmentOffset =
    !hasExplicitPositioning && alignment === 'center'
      ? Math.max(0, (availableWidth - renderedLineWidth) / 2)
      : !hasExplicitPositioning && alignment === 'right'
        ? Math.max(0, availableWidth - renderedLineWidth)
        : 0;

  // Check if line has segment-based positioning (used for tab-aligned text)
  // When segments have explicit X positions, we must use segment-based calculation
  // to match the actual DOM positioning
  if (hasExplicitPositioning && line.segments && ctx) {
    return measureCharacterXSegmentBased(block, line, charOffset, ctx, fontContext);
  }

  if (!ctx) {
    // Fallback to ratio-based calculation if Canvas unavailable
    const runs = sliceRunsForLine(block, line);
    const charsInLine = Math.max(
      1,
      runs.reduce((sum, run) => {
        if (isTabRun(run)) return sum + TAB_CHAR_LENGTH;
        if (
          'src' in run ||
          run.kind === 'lineBreak' ||
          run.kind === 'break' ||
          run.kind === 'fieldAnnotation' ||
          run.kind === 'math'
        )
          return sum;
        return sum + (run.text ?? '').length;
      }, 0),
    );
    return (charOffset / charsInLine) * renderedLineWidth;
  }

  const runs = sliceRunsForLine(block, line);
  let currentX = 0;
  let currentCharOffset = 0;
  let nextTabRunIndex = line.fromRun;

  for (const run of runs) {
    if (isTabRun(run)) {
      // AIDEV-NOTE: Tab slices retain source identity; empty boundary text
      // slices can disappear, so sliced-array offsets are not line width keys.
      const sourceRunIndex = block.kind === 'paragraph' ? block.runs.indexOf(run, nextTabRunIndex) : -1;
      nextTabRunIndex = sourceRunIndex + 1;
      const runLength = TAB_CHAR_LENGTH;
      const tabWidth = line.tabWidths?.[sourceRunIndex] ?? run.width ?? 0;
      if (currentCharOffset + runLength >= charOffset) {
        const offsetInRun = charOffset - currentCharOffset;
        return currentX + (offsetInRun <= 0 ? 0 : tabWidth);
      }
      currentX += tabWidth;
      currentCharOffset += runLength;
      continue;
    }

    const text =
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
        ? ''
        : (run.text ?? '');
    const runLength = text.length;
    if (isVanishedRun(run)) {
      if (currentCharOffset + runLength >= charOffset) {
        return alignmentOffset + currentX;
      }
      currentCharOffset += runLength;
      continue;
    }

    // Only TextRun and TabRun have textTransform (via RunMarks)
    const transform =
      isTabRun(run) ||
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
        ? undefined
        : run.textTransform;
    const displayText = applyTextTransform(text, transform);

    // If target character is within this run
    if (currentCharOffset + runLength >= charOffset) {
      const offsetInRun = charOffset - currentCharOffset;
      const runFont = getRunFontString(run, fontContext);
      ctx.font = runFont;

      // Measure the target boundary in the context of the whole painted run so
      // kerning/ligature shaping on the following glyph stays reflected in the
      // caret position.
      const measuredWidth = memoizedCaretWidth(ctx, runFont, displayText, offsetInRun);
      const spacingWidth = computeLetterSpacingWidth(run, offsetInRun, runLength);
      const horizontalScale = getHorizontalScale(run);
      // `currentX` already carries the FULL word-spacing stretch contributed
      // by every run measured so far (baked in below, in the "whole run"
      // branch). Only THIS run's own portion is still outstanding — adding a
      // running space tally on top here would double-count every completed
      // prior run's spaces once for their own advance and again for this
      // return, pushing caret/hit-test x to the right of the real painted
      // position on any multi-run justified line.
      const spacesInPortion = justify.extraPerSpace !== 0 ? countSpaces(text.slice(0, offsetInRun)) : 0;
      const lineOffset = currentCharOffset + offsetInRun;
      return (
        alignmentOffset +
        currentX +
        (measuredWidth + spacingWidth) * horizontalScale +
        justify.extraPerSpace * spacesInPortion +
        interCharacterJustifyAdvanceBeforeOffset(
          justify.interCharacterBoundaries,
          lineOffset,
          justify.interCharacterSpacing,
        )
      );
    }

    // Measure entire run and advance (memoized). The run's own word-spacing
    // stretch is folded into `currentX` right here, once — see the comment
    // above on why the target-run return above must NOT add it a second time.
    const wholeRunFont = getRunFontString(run, fontContext);
    ctx.font = wholeRunFont;
    const wholeRunWidth = memoizedCaretWidth(ctx, wholeRunFont, displayText, displayText.length);
    const runLetterSpacing = computeLetterSpacingWidth(run, runLength, runLength);
    const spacesInRun = justify.extraPerSpace !== 0 ? countSpaces(text) : 0;
    currentX += (wholeRunWidth + runLetterSpacing) * getHorizontalScale(run) + justify.extraPerSpace * spacesInRun;

    currentCharOffset += runLength;
  }

  // If we're past the end, return the total width
  return (
    alignmentOffset +
    currentX +
    interCharacterJustifyAdvanceBeforeOffset(
      justify.interCharacterBoundaries,
      currentCharOffset,
      justify.interCharacterSpacing,
    )
  );
}

const inlineBoxAdvanceAtOffset = (line: Line, charOffset: number): number =>
  (line.inlineBoxes ?? []).reduce((advance, box) => {
    if (charOffset >= box.from) {
      advance += box.style.paddingInlineStart + box.style.borderWidth + (box.startsRange ? box.style.gapBefore : 0);
    }
    if (charOffset >= box.to) {
      advance += box.style.paddingInlineEnd + box.style.borderWidth + (box.endsRange ? box.style.gapAfter : 0);
    }
    return advance;
  }, 0);

const inlineBoxTextX = (block: FlowBlock, line: Line, charOffset: number): number | undefined => {
  if (block.kind !== 'paragraph' || !line.inlineBoxes?.length || !line.segments?.length) return undefined;

  const runStarts: number[] = [];
  let paragraphOffset = 0;
  for (const run of block.runs) {
    runStarts.push(paragraphOffset);
    paragraphOffset += getRunCharacterLength(run);
  }

  const lineStart = (runStarts[line.fromRun] ?? 0) + line.fromChar;
  const target = lineStart + charOffset;
  let x = 0;
  for (const segment of line.segments) {
    const segmentX = segment.x ?? x;
    const segmentStart = (runStarts[segment.runIndex] ?? 0) + segment.fromChar;
    const segmentEnd = (runStarts[segment.runIndex] ?? 0) + segment.toChar;
    if (target >= segmentEnd) {
      x = segmentX + segment.width;
      continue;
    }
    if (target > segmentStart && segmentEnd > segmentStart) {
      x = segmentX + segment.width * ((target - segmentStart) / (segmentEnd - segmentStart));
    } else if (target === segmentStart) {
      x = segmentX;
    }
    break;
  }
  return x;
};

export function measureCharacterX(
  block: FlowBlock,
  line: Line,
  charOffset: number,
  availableWidthOverride?: number,
  alignmentOverride?: string,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): number {
  const measuredTextX = measureCharacterXWithoutInlineBoxes(
    block,
    line,
    charOffset,
    availableWidthOverride,
    alignmentOverride,
    fontContext,
  );
  const inlineTextX = inlineBoxTextX(block, line, charOffset);
  const textX =
    inlineTextX === undefined
      ? measuredTextX
      : inlineTextX +
        measuredTextX -
        measureCharacterXWithoutInlineBoxes(block, line, charOffset, line.width, 'left', fontContext);
  return textX + inlineBoxAdvanceAtOffset(line, charOffset);
}

/**
 * Measure character X position using segment-based calculation.
 * This is used when lines have tab-aligned segments with explicit X positions.
 * Must match the DOM positioning used in segment-based rendering.
 *
 * @param block - The paragraph block containing runs
 * @param line - The line with segments
 * @param charOffset - Character offset from start of line
 * @param ctx - Canvas rendering context for text measurement
 * @returns X coordinate for the character
 */
function measureCharacterXSegmentBased(
  block: FlowBlock,
  line: Line,
  charOffset: number,
  ctx: CanvasRenderingContext2D,
  fontContext: FontMeasureContext,
): number {
  if (block.kind !== 'paragraph' || !line.segments) return 0;

  // Build a map of cumulative character offsets per run
  // to translate line-relative charOffset to run-relative offsets
  let lineCharCount = 0;

  for (const segment of line.segments) {
    const run = block.runs[segment.runIndex];
    if (!run) continue;

    const segmentChars = segment.toChar - segment.fromChar;

    // Check if target character is within this segment
    if (lineCharCount + segmentChars >= charOffset) {
      const offsetInSegment = charOffset - lineCharCount;

      // Get the base X position for this segment
      // If segment has explicit X (tab-aligned), use it
      // Otherwise, we'd need to calculate cumulative width up to this point
      let segmentBaseX = segment.x;

      if (segmentBaseX === undefined) {
        // Calculate cumulative X by measuring previous segments
        segmentBaseX = 0;
        for (const prevSeg of line.segments) {
          if (prevSeg === segment) break;
          const prevRun = block.runs[prevSeg.runIndex];
          if (!prevRun) continue;

          if (prevSeg.x !== undefined) {
            // If previous segment has explicit X, use its X + width as base
            segmentBaseX = prevSeg.x + (prevSeg.width ?? 0);
          } else {
            segmentBaseX += prevSeg.width ?? 0;
          }
        }
      }

      // Handle tab runs
      if (isTabRun(run)) {
        // Tab counts as 1 character, position is at segment start or end
        return segmentBaseX + (offsetInSegment > 0 ? (segment.width ?? 0) : 0);
      }

      // Handle atomic inline objects (images, breaks, etc.) using the measured
      // segment width instead of text slicing.
      if (
        'src' in run ||
        run.kind === 'lineBreak' ||
        run.kind === 'break' ||
        run.kind === 'fieldAnnotation' ||
        run.kind === 'math'
      ) {
        return segmentBaseX + (offsetInSegment >= segmentChars ? (segment.width ?? 0) : 0);
      }

      // For text runs, measure up to the target character
      if (isVanishedRun(run)) {
        return segmentBaseX;
      }

      const text = run.text ?? '';
      // Only TextRun and TabRun have textTransform (via RunMarks)
      // At this point, we've already filtered out TabRun, ImageRun, etc., so run must be TextRun
      const transform = 'textTransform' in run ? run.textTransform : undefined;
      const displayText = applyTextTransform(text, transform);
      const displaySegmentText = displayText.slice(segment.fromChar, segment.toChar);

      const segmentFont = getRunFontString(run, fontContext);
      ctx.font = segmentFont;
      const segmentPrefixWidth = memoizedCaretWidth(ctx, segmentFont, displaySegmentText, offsetInSegment);
      const spacingWidth = computeLetterSpacingWidth(run, offsetInSegment, segmentChars);

      return segmentBaseX + (segmentPrefixWidth + spacingWidth) * getHorizontalScale(run);
    }

    lineCharCount += segmentChars;
  }

  // Past end of line, return total width
  return line.width;
}

/**
 * Convert a character offset within a line back to a ProseMirror position.
 *
 * This function is the inverse of finding a character offset from a PM position.
 * It accounts for PM position gaps that can occur between runs due to wrapper nodes
 * (e.g., inline formatting marks, link nodes) that don't correspond to visible characters.
 *
 * Algorithm:
 * 1. Iterate through runs in the line, tracking cumulative character offset
 * 2. For each run, determine its character length (accounting for tabs as 1 character)
 * 3. When the target charOffset falls within a run:
 *    - Calculate the offset within that run
 *    - Add to the run's pmStart to get the final PM position
 * 4. If charOffset exceeds all runs, return the last known PM position
 *
 * Edge Cases:
 * - **Character offset beyond line bounds**: Returns the last PM position in the line (clamped to end)
 * - **Negative character offset**: Clamped to 0, returns fallbackPmStart
 * - **Runs with missing PM data**: Falls back to fallbackPmStart + charOffset calculation
 * - **Non-paragraph blocks**: Returns fallbackPmStart + charOffset (simple arithmetic fallback)
 * - **Empty runs**: Skipped during iteration, don't contribute to character count
 * - **Tab runs**: Counted as 1 character regardless of visual width
 *
 * @param block - The paragraph block containing the line
 * @param line - The line to map within
 * @param charOffset - Character offset from start of line (0-based)
 * @param fallbackPmStart - PM position to use when run PM data is missing or invalid
 * @returns ProseMirror position corresponding to the character offset
 *
 * @example
 * ```typescript
 * // Line with runs: "Hello" (PM 0-5) + "World" (PM 7-12), gap at 5-7
 * const block = { kind: 'paragraph', runs: [...] };
 * const line = { fromRun: 0, toRun: 1, ... };
 *
 * // Character 3 maps to PM position 3 (within "Hello")
 * charOffsetToPm(block, line, 3, 0); // returns 3
 *
 * // Character 7 maps to PM position 9 (within "World", accounting for gap)
 * charOffsetToPm(block, line, 7, 0); // returns 9
 * ```
 */
export function charOffsetToPm(block: FlowBlock, line: Line, charOffset: number, fallbackPmStart: number): number {
  // Validate inputs
  if (!Number.isFinite(charOffset) || !Number.isFinite(fallbackPmStart)) {
    console.warn('[charOffsetToPm] Invalid input:', { charOffset, fallbackPmStart });
    return fallbackPmStart;
  }

  // Clamp charOffset to non-negative
  const safeCharOffset = Math.max(0, charOffset);

  if (block.kind !== 'paragraph') {
    return fallbackPmStart + safeCharOffset;
  }

  const runs = sliceRunsForLine(block, line);
  let cursor = 0;
  let lastPm = fallbackPmStart;

  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const runLength = getRunCharacterLength(run);
    const runPmStart = resolveRunPmStart(run, runLength);
    const runPmEnd = resolveRunPmEnd(run, runLength, runPmStart);

    if (runPmStart != null) {
      lastPm = runPmStart;
    }

    if (safeCharOffset <= cursor + runLength) {
      const offsetInRun = Math.max(0, safeCharOffset - cursor);
      if (runPmStart != null) {
        const coordinateLength = isBodyNoteReferenceRun(run)
          ? Math.max(0, (runPmEnd ?? runPmStart + 1) - runPmStart)
          : runLength;
        return runPmStart + Math.min(offsetInRun, coordinateLength);
      }

      if (isVisualOnlyRun(run)) {
        return resolveVisualOnlyRunBoundary(runs, runIndex, offsetInRun, runLength, lastPm);
      }

      return fallbackPmStart + safeCharOffset;
    }

    if (runPmEnd != null) {
      lastPm = runPmEnd;
    }

    cursor += runLength;
  }

  return lastPm;
}

const resolveRunPmStart = (run: Run | undefined, runLength: number): number | null => {
  if (!run) {
    return null;
  }

  if (typeof run.pmStart === 'number') {
    return run.pmStart;
  }

  if (typeof run.pmEnd === 'number') {
    return run.pmEnd - runLength;
  }

  return null;
};

const resolveRunPmEnd = (run: Run | undefined, runLength: number, runPmStart: number | null): number | null => {
  if (!run) {
    return null;
  }

  if (typeof run.pmEnd === 'number') {
    return run.pmEnd;
  }

  if (runPmStart != null) {
    return runPmStart + runLength;
  }

  return null;
};

const findNextPmBoundary = (runs: readonly Run[], startIndex: number, fallbackPm: number): number => {
  for (let runIndex = startIndex; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const runLength = getRunCharacterLength(run);
    const nextPmStart = resolveRunPmStart(run, runLength);
    if (nextPmStart != null) {
      return nextPmStart;
    }

    const nextPmEnd = resolveRunPmEnd(run, runLength, nextPmStart);
    if (nextPmEnd != null) {
      return nextPmEnd;
    }
  }

  return fallbackPm;
};

const resolveVisualOnlyRunBoundary = (
  runs: readonly Run[],
  runIndex: number,
  offsetInRun: number,
  runLength: number,
  previousPmBoundary: number,
): number => {
  const nextPmBoundary = findNextPmBoundary(runs, runIndex + 1, previousPmBoundary);
  if (runLength <= 0 || previousPmBoundary === nextPmBoundary) {
    return previousPmBoundary;
  }

  const midpoint = runLength / 2;
  return offsetInRun < midpoint ? previousPmBoundary : nextPmBoundary;
};

/**
 * Find the character offset and PM position at a given X coordinate within a line.
 * This is the inverse of measureCharacterX.
 *
 * @param block - The paragraph block containing the line
 * @param line - The line to search within
 * @param x - The X coordinate (in pixels) from the start of the line
 * @param pmStart - The ProseMirror position at the start of the line
 * @param availableWidthOverride - Optional override for available width
 * @param alignmentOverride - Optional override for text alignment (e.g., 'left' for list items)
 * @returns Object with charOffset (0-based from line start) and pmPosition
 */
/**
 * Memoized shaped caret-boundary measurement. Caret/hit resolution probes the SAME
 * (font, text, offset) triples many times per keystroke (binary-search
 * probes × several callers × repeated caret paints) — raw ctx.measureText
 * per probe was ~130ms/keystroke of canvas work on long lines. The boundary is
 * `width(full run) - width(suffix)`, not `width(prefix)`: CSS shapes the entire
 * painted run, so kerning across the boundary belongs to the prefix advance.
 * Each distinct boundary is measured exactly once; the outer map is size-capped
 * and cleared whole (fail-simple), and font changes key differently, so stale
 * widths cannot serve.
 */
// Scoped PER CANVAS CONTEXT: two contexts can share a font string but carry
// different transforms/scales, so a shared map would cross-contaminate
// widths (mis-mapping caret x -> offset, i.e. corrupting typed positions).
const caretWidthMemoByCtx = new WeakMap<CanvasRenderingContext2D, Map<string, Map<number, number>>>();
const CARET_WIDTH_MEMO_MAX_TEXTS = 512;

function memoizedCaretWidth(ctx: CanvasRenderingContext2D, fontKey: string, displayText: string, upTo: number): number {
  let caretWidthMemo = caretWidthMemoByCtx.get(ctx);
  if (!caretWidthMemo) {
    caretWidthMemo = new Map();
    caretWidthMemoByCtx.set(ctx, caretWidthMemo);
  }
  const key = `${fontKey}\u0000${displayText}`;
  let perOffset = caretWidthMemo.get(key);
  if (!perOffset) {
    if (caretWidthMemo.size >= CARET_WIDTH_MEMO_MAX_TEXTS) caretWidthMemo.clear();
    perOffset = new Map();
    caretWidthMemo.set(key, perOffset);
  }
  const hit = perOffset.get(upTo);
  if (hit != null) return hit;
  const boundary = Math.max(0, Math.min(upTo, displayText.length));
  let fullWidth = perOffset.get(displayText.length);
  if (fullWidth == null) {
    fullWidth = ctx.measureText(displayText).width;
    perOffset.set(displayText.length, fullWidth);
  }
  const width =
    boundary === displayText.length ? fullWidth : fullWidth - ctx.measureText(displayText.slice(boundary)).width;
  perOffset.set(upTo, width);
  return width;
}

export function findCharacterAtX(
  block: FlowBlock,
  line: Line,
  x: number,
  pmStart: number,
  availableWidthOverride?: number,
  alignmentOverride?: string,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): { charOffset: number; pmPosition: number } {
  for (const box of line.inlineBoxes ?? []) {
    const leadingEdge = box.style.paddingInlineStart + box.style.borderWidth;
    const leadingEnd = measureCharacterX(block, line, box.from, availableWidthOverride, alignmentOverride, fontContext);
    if (x >= leadingEnd - leadingEdge && x <= leadingEnd) {
      return { charOffset: box.from, pmPosition: charOffsetToPm(block, line, box.from, pmStart) };
    }
    const trailingEdge = box.style.paddingInlineEnd + box.style.borderWidth;
    const trailingEnd =
      measureCharacterX(block, line, box.to, availableWidthOverride, alignmentOverride, fontContext) -
      (box.endsRange ? box.style.gapAfter : 0);
    if (x >= trailingEnd - trailingEdge && x <= trailingEnd) {
      return { charOffset: box.to, pmPosition: charOffsetToPm(block, line, box.to, pmStart) };
    }
  }

  // Defined as the exact inverse of measureCharacterX: search the caret-boundary
  // x positions that measureCharacterX produces and return the nearest one.
  // measureCharacterX is the single source of truth for offset -> x, so every mode
  // (left, center, right, justify, tabs, and explicit per-segment x) is handled in
  // one place and the forward/inverse pair cannot drift apart.
  const maxOffset = lineCharLength(block, line);
  const xAtOffset = (offset: number): number =>
    measureCharacterX(block, line, offset, availableWidthOverride, alignmentOverride, fontContext);
  const charOffset = nearestOffsetToX(x, maxOffset, xAtOffset);
  return { charOffset, pmPosition: charOffsetToPm(block, line, charOffset, pmStart) };
}

/**
 * Number of addressable caret offsets on a line (its last caret offset). Mirrors
 * how measureCharacterX advances charOffset: tab runs count as one character,
 * atomic/break/field/math runs as zero, and text runs by their length.
 */
function lineCharLength(block: FlowBlock, line: Line): number {
  let length = 0;
  for (const run of sliceRunsForLine(block, line)) {
    if (isTabRun(run)) {
      length += TAB_CHAR_LENGTH;
      continue;
    }
    if (
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
    ) {
      continue;
    }
    length += (run.text ?? '').length;
  }
  return length;
}

/**
 * Nearest caret offset in [0, maxOffset] to `x`, given a non-decreasing
 * offset -> x map. Ties (equal distance to both neighboring boundaries) resolve
 * to the trailing offset, matching the historical char-by-char click behavior.
 */
function nearestOffsetToX(x: number, maxOffset: number, xAtOffset: (offset: number) => number): number {
  if (maxOffset <= 0 || x <= xAtOffset(0)) return 0;
  if (x >= xAtOffset(maxOffset)) return maxOffset;

  // Largest `lo` whose boundary is still <= x. Binary search relies on the map
  // being monotonic non-decreasing in the offset.
  let lo = 0;
  let hi = maxOffset;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xAtOffset(mid) <= x) lo = mid;
    else hi = mid - 1;
  }
  const upper = Math.min(lo + 1, maxOffset);
  return x - xAtOffset(lo) < xAtOffset(upper) - x ? lo : upper;
}

const computeLetterSpacingWidth = (run: Run, precedingChars: number, runLength: number): number => {
  // Only text runs support letter spacing (older data may omit kind on text runs).
  if (
    isTabRun(run) ||
    'src' in run ||
    run.kind === 'fieldAnnotation' ||
    !('letterSpacing' in run) ||
    !run.letterSpacing
  ) {
    return 0;
  }
  const maxGaps = Math.max(runLength - 1, 0);
  if (maxGaps === 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(precedingChars, 0), maxGaps);
  return clamped * run.letterSpacing;
};

const getHorizontalScale = (run: Run): number => {
  if (!('horizontalScale' in run)) return 1;
  const value = run.horizontalScale;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
};
