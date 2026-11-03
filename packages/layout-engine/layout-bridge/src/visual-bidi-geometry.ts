import bidiFactory from 'bidi-js';
import type { Line, NeutralLineGeometry, ParagraphBlock, TextRun } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import { getParagraphInlineDirection } from '@superdoc/contracts';
import { createLayoutMeasurementContext, getLayoutMeasurementFontGeneration } from './measurement-environment.js';
import { measureCharacterX } from './text-measurement.js';

const bidi = bidiFactory();
const paragraphLevels = new WeakMap<
  ParagraphBlock,
  { text: string; value: ReturnType<typeof bidi.getEmbeddingLevels> }
>();
const issued = new WeakMap<MeasuredVisualBidiLine, { current: () => boolean; fontContext: FontMeasureContext }>();

export interface MeasuredVisualBidiCell {
  readonly from: number;
  readonly to: number;
  readonly left: number;
  readonly right: number;
  readonly rtl: boolean;
}

/** Private measured data; source offsets stay in the line's logical UTF-16 space. */
export interface MeasuredVisualBidiLine {
  readonly geometry: NeutralLineGeometry;
  readonly cells: readonly MeasuredVisualBidiCell[];
  readonly length: number;
}

const runSignature = (block: ParagraphBlock): string =>
  JSON.stringify({
    anchor: block.sourceAnchor,
    attrs: block.attrs,
    run: block.runs[0],
  });

/** This certificate deliberately excludes shaping classes not covered by the native proof. */
export function canMeasureVisualBidi(block: ParagraphBlock): block is ParagraphBlock & { runs: [TextRun] } {
  if (getParagraphInlineDirection(block.attrs) !== 'rtl' || block.runs.length !== 1) return false;
  const run = block.runs[0]!;
  return (
    (run.kind == null || run.kind === 'text') &&
    typeof run.text === 'string' &&
    run.text.length > 0 &&
    run.text.length <= 16_384 &&
    /^[\u0020-\u0040\u005B-\u0060\u007B-\u007E\u00A0\u05D0-\u05EA\u05F0-\u05F4]+$/u.test(run.text) &&
    /[\u05D0-\u05EA\u05F0-\u05F4]/u.test(run.text) &&
    !run.trackedChange &&
    !run.trackedChanges?.length &&
    !run.vanish &&
    !(run as { specVanish?: boolean }).specVanish &&
    (!run.textTransform || run.textTransform === 'none') &&
    !(run as { allCaps?: boolean }).allCaps &&
    !run.bidi?.embedding &&
    !run.bidi?.override &&
    !run.sdt &&
    !run.visualPlaceholder &&
    !run.token &&
    !run.letterSpacing &&
    (run.horizontalScale == null || run.horizontalScale === 1) &&
    (!run.vertAlign || run.vertAlign === 'baseline') &&
    !run.baselineShift &&
    !!run.fontFamily &&
    Number.isFinite(run.fontSize) &&
    run.fontSize > 0 &&
    block.attrs?.directionContext?.writingMode !== 'vertical-rl' &&
    block.attrs?.directionContext?.writingMode !== 'vertical-lr'
  );
}

interface VisualBidiLineInput {
  block: ParagraphBlock;
  line: Line;
  geometry: NeutralLineGeometry;
  availableWidth: number;
  fontContext: FontMeasureContext;
  ownerCurrent?: () => boolean;
}

/** Same measured line, source paragraph and font generation as the captured neutral candidate. */
export function measureVisualBidiLine(input: VisualBidiLineInput): MeasuredVisualBidiLine | null {
  try {
    return measureSourceVisualBidiLine(input);
  } catch {
    return null;
  }
}

function measureSourceVisualBidiLine(input: VisualBidiLineInput): MeasuredVisualBidiLine | null {
  const { block, line, geometry, availableWidth, fontContext } = input;
  if (
    !canMeasureVisualBidi(block) ||
    line.fromRun !== 0 ||
    line.toRun !== 0 ||
    line.inlineBoxes?.length ||
    line.segments?.some((segment) => segment.runIndex !== 0 || segment.x != null) ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0
  )
    return null;
  try {
    if (!createLayoutMeasurementContext({ unavailable: 'require-native' })) return null;
  } catch {
    return null;
  }
  const text = block.runs[0]!.text!;
  const from = line.fromChar,
    to = line.toChar;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > text.length ||
    to - from > 512
  )
    return null;
  let paintedEnd = to;
  if (line.segments?.length) {
    let cursor = from;
    for (const segment of line.segments) {
      if (
        segment.fromChar !== cursor ||
        segment.toChar <= cursor ||
        segment.toChar > to ||
        !Number.isFinite(segment.width) ||
        segment.width < 0
      )
        return null;
      cursor = segment.toChar;
    }
    if (cursor < to && !/^ +$/.test(text.slice(cursor, to))) return null;
    paintedEnd = cursor;
  }
  // The consumed wrap space remains a source unit but has no painted glyph.
  // Measure the same retained run slice the painter receives, not that suffix.
  const paintedLine = paintedEnd === to ? line : { ...line, toChar: paintedEnd };
  const signature = runSignature(block),
    generation = getLayoutMeasurementFontGeneration();
  const lineSignature = JSON.stringify(line);
  const run = block.runs[0]!,
    face = {
      weight: run.bold ? ('700' as const) : ('400' as const),
      style: run.italic ? ('italic' as const) : ('normal' as const),
    };
  const physicalFont = fontContext.resolvePhysical(run.fontFamily ?? 'Arial', face);
  if (!physicalFont) return null;
  const fontSignature = fontContext.fontSignature;
  let paragraph = paragraphLevels.get(block);
  if (!paragraph || paragraph.text !== text) {
    paragraph = { text, value: bidi.getEmbeddingLevels(text, 'rtl') };
    paragraphLevels.set(block, paragraph);
  }
  // Slice resolved paragraph levels only after wrapping. Relative line indices
  // also keep bidi-js 1.0.3's trailing-whitespace reset within its local array.
  const lineText = text.slice(from, to);
  const levels = paragraph.value.levels.slice(from, to);
  for (let index = lineText.length - 1; index >= 0 && bidi.getBidiCharTypeName(lineText[index]!) === 'WS'; index--)
    levels[index] = 1;
  const lineEmbedding = { levels, paragraphs: [{ start: 0, end: lineText.length - 1, level: 1 }] };
  const order = Array.from({ length: lineText.length }, (_, index) => index);
  for (const [first, last] of bidi.getReorderSegments(lineText, lineEmbedding, 0, lineText.length - 1)) {
    for (let left = first, right = last; left < right; left++, right--)
      [order[left], order[right]] = [order[right]!, order[left]!];
  }
  const alignment = geometry.flags?.justified ? 'justify' : 'left';
  const advances = Array.from({ length: lineText.length + 1 }, (_, offset) =>
    measureCharacterX(block, paintedLine, Math.min(offset, paintedEnd - from), availableWidth, alignment, fontContext),
  );
  const widths = advances.slice(1).map((advance, index) => advance - advances[index]!);
  if (widths.some((width) => !Number.isFinite(width) || width < 0) || !advances.every(Number.isFinite)) return null;
  const paintedWidth = widths.reduce((sum, width) => sum + width, 0);
  if (paintedWidth <= 0 || paintedWidth > availableWidth + 1) return null;
  const effectiveAlignment = block.attrs?.alignment ?? 'right';
  const shift =
    effectiveAlignment === 'left'
      ? 0
      : effectiveAlignment === 'center'
        ? Math.max(0, (availableWidth - paintedWidth) / 2)
        : Math.max(0, availableWidth - paintedWidth);
  // The neutral producer supplies its unaligned content origin for this private route.
  let x = geometry.contentLeft + shift;
  const cells = order.map((offset) => {
    const left = x;
    x += widths[offset]!;
    return { from: offset, to: offset + 1, left, right: x, rtl: (levels[offset]! & 1) !== 0 };
  });
  const segments = cells.map((cell, segmentIndex) =>
    Object.freeze({
      segmentIndex,
      runIndex: 0,
      fromChar: from + cell.from,
      toChar: from + cell.to,
      x: cell.left,
      width: cell.right - cell.left,
    }),
  );
  Object.freeze(segments);
  const result: MeasuredVisualBidiLine = Object.freeze({
    geometry: Object.freeze({
      ...geometry,
      contentLeft: geometry.contentLeft + shift,
      contentWidth: paintedWidth,
      segments,
    }),
    cells: Object.freeze(cells.map((cell) => Object.freeze(cell))),
    length: lineText.length,
  });
  const current = () => {
    try {
      const matches = () =>
        generation === getLayoutMeasurementFontGeneration() &&
        signature === runSignature(block) &&
        lineSignature === JSON.stringify(line) &&
        fontContext.fontSignature === fontSignature;
      return (
        matches() &&
        fontContext.resolvePhysical(run.fontFamily ?? 'Arial', face) === physicalFont &&
        (input.ownerCurrent?.() ?? true) &&
        matches()
      );
    } catch {
      return false;
    }
  };
  issued.set(result, { current, fontContext });
  return current() ? result : null;
}

export function isMeasuredVisualBidiLineCurrent(
  line: MeasuredVisualBidiLine,
  fontContext?: FontMeasureContext,
): boolean {
  const owner = issued.get(line);
  return !!owner && (!fontContext || owner.fontContext === fontContext) && owner.current();
}

export function measuredVisualBidiCaretX(
  line: MeasuredVisualBidiLine,
  offset: number,
  affinity: 'before' | 'after' | 'inside' = 'inside',
): number | null {
  if (!isMeasuredVisualBidiLineCurrent(line) || !Number.isSafeInteger(offset) || offset < 0 || offset > line.length)
    return null;
  const next = line.cells.find((cell) => cell.from === offset),
    previous = line.cells.find((cell) => cell.to === offset);
  const nextX = next && (next.rtl ? next.right : next.left);
  const previousX = previous && (previous.rtl ? previous.left : previous.right);
  if (affinity === 'before') return nextX ?? previousX ?? null;
  if (affinity === 'after') return previousX ?? nextX ?? null;
  // Strong RTL caret at a bidi boundary; explicit affinity retains both visual sides.
  return next?.rtl ? nextX! : previous?.rtl ? previousX! : (nextX ?? previousX ?? null);
}

export function measuredVisualBidiOffsetAtX(line: MeasuredVisualBidiLine, x: number): number | null {
  if (!isMeasuredVisualBidiLineCurrent(line) || !Number.isFinite(x) || !line.cells.length) return null;
  const cell =
    line.cells.find((cell) => x >= cell.left && x <= cell.right) ??
    (x < line.cells[0]!.left ? line.cells[0]! : line.cells.at(-1)!);
  const left = x <= (cell.left + cell.right) / 2;
  return cell.rtl === left ? cell.to : cell.from;
}

export function measuredVisualBidiRangeBands(
  line: MeasuredVisualBidiLine,
  from: number,
  to: number,
): { left: number; right: number }[] {
  if (
    !isMeasuredVisualBidiLineCurrent(line) ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > line.length ||
    from >= to
  )
    return [];
  const bands: { left: number; right: number }[] = [];
  for (const cell of line.cells) {
    if (cell.from < from || cell.to > to || cell.right <= cell.left) continue;
    const previous = bands.at(-1);
    if (previous && Math.abs(previous.right - cell.left) < 0.000001) previous.right = cell.right;
    else bands.push({ left: cell.left, right: cell.right });
  }
  return bands;
}
