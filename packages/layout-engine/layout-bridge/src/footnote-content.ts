import type { FlowBlock, Measure, ParagraphBlock } from '@superdoc/contracts';

export type FootnoteRange =
  | {
      kind: 'paragraph';
      blockId: string;
      fromLine: number;
      toLine: number;
      totalLines: number;
      height: number;
      spacingAfter: number;
    }
  | {
      kind: 'list-item';
      blockId: string;
      itemId: string;
      fromLine: number;
      toLine: number;
      totalLines: number;
      height: number;
      spacingAfter: number;
    }
  | {
      kind: 'table' | 'image' | 'drawing';
      blockId: string;
      height: number;
    };

export type FootnoteSlice = {
  id: string;
  pageIndex: number;
  columnIndex: number;
  isContinuation: boolean;
  ranges: FootnoteRange[];
  totalHeight: number;
};

const sumLineHeights = (
  lines: Array<{ lineHeight?: number }> | undefined,
  fromLine: number,
  toLine: number,
): number => {
  if (!lines || fromLine >= toLine) return 0;
  let total = 0;
  for (let i = fromLine; i < toLine; i += 1) {
    total += lines[i]?.lineHeight ?? 0;
  }
  return total;
};

export const getParagraphSpacingAfter = (block: ParagraphBlock): number => {
  const spacing = block.attrs?.spacing as Record<string, unknown> | undefined;
  const value = spacing?.after ?? spacing?.lineSpaceAfter;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
};

export const resolveSeparatorSpacingBefore = (
  rangesByFootnoteId: ReadonlyMap<string, readonly FootnoteRange[]>,
  measuresById: ReadonlyMap<string, Measure>,
  explicitValue: number | undefined,
  fallbackValue: number,
): number => {
  if (typeof explicitValue === 'number' && Number.isFinite(explicitValue)) {
    return Math.max(0, explicitValue);
  }

  for (const ranges of rangesByFootnoteId.values()) {
    for (const range of ranges) {
      if (range.kind === 'paragraph') {
        const measure = measuresById.get(range.blockId);
        if (measure?.kind !== 'paragraph') continue;
        const lineHeight = measure.lines?.[range.fromLine]?.lineHeight ?? measure.lines?.[0]?.lineHeight;
        if (typeof lineHeight === 'number' && Number.isFinite(lineHeight) && lineHeight > 0) {
          return lineHeight;
        }
      }

      if (range.kind === 'list-item') {
        const measure = measuresById.get(range.blockId);
        if (measure?.kind !== 'list') continue;
        const itemMeasure = measure.items.find((item) => item.itemId === range.itemId);
        const lineHeight =
          itemMeasure?.paragraph?.lines?.[range.fromLine]?.lineHeight ?? itemMeasure?.paragraph?.lines?.[0]?.lineHeight;
        if (typeof lineHeight === 'number' && Number.isFinite(lineHeight) && lineHeight > 0) {
          return lineHeight;
        }
      }
    }
  }

  return Math.max(0, fallbackValue);
};

export const getRangeRenderHeight = (range: FootnoteRange): number => {
  if (range.kind === 'paragraph' || range.kind === 'list-item') {
    const spacing = range.toLine >= range.totalLines ? range.spacingAfter : 0;
    return range.height + spacing;
  }
  return range.height;
};

export const buildFootnoteRanges = (
  blocks: readonly FlowBlock[],
  measuresById: ReadonlyMap<string, Measure>,
): FootnoteRange[] => {
  const ranges: FootnoteRange[] = [];

  blocks.forEach((block) => {
    const measure = measuresById.get(block.id);
    if (!measure) return;

    if (block.kind === 'paragraph') {
      if (measure.kind !== 'paragraph') return;
      const lineCount = measure.lines?.length ?? 0;
      if (lineCount === 0) return;
      ranges.push({
        kind: 'paragraph',
        blockId: block.id,
        fromLine: 0,
        toLine: lineCount,
        totalLines: lineCount,
        height: sumLineHeights(measure.lines, 0, lineCount),
        spacingAfter: getParagraphSpacingAfter(block as ParagraphBlock),
      });
      return;
    }

    if (block.kind === 'list') {
      if (measure.kind !== 'list') return;
      block.items.forEach((item) => {
        const itemMeasure = measure.items.find((entry) => entry.itemId === item.id);
        if (!itemMeasure) return;
        const lineCount = itemMeasure.paragraph.lines?.length ?? 0;
        if (lineCount === 0) return;
        ranges.push({
          kind: 'list-item',
          blockId: block.id,
          itemId: item.id,
          fromLine: 0,
          toLine: lineCount,
          totalLines: lineCount,
          height: sumLineHeights(itemMeasure.paragraph.lines, 0, lineCount),
          spacingAfter: getParagraphSpacingAfter(item.paragraph),
        });
      });
      return;
    }

    if (block.kind === 'table' && measure.kind === 'table') {
      const height = Math.max(0, measure.totalHeight ?? 0);
      if (height > 0) {
        ranges.push({ kind: 'table', blockId: block.id, height });
      }
      return;
    }

    if (block.kind === 'image' && measure.kind === 'image') {
      const height = Math.max(0, measure.height ?? 0);
      if (height > 0) {
        ranges.push({ kind: 'image', blockId: block.id, height });
      }
      return;
    }

    if (block.kind === 'drawing' && measure.kind === 'drawing') {
      const height = Math.max(0, measure.height ?? 0);
      if (height > 0) {
        ranges.push({ kind: 'drawing', blockId: block.id, height });
      }
    }
  });

  return ranges;
};

const splitRangeAtHeight = (
  range: FootnoteRange,
  availableHeight: number,
  measuresById: ReadonlyMap<string, Measure>,
): { fitted: FootnoteRange | null; remaining: FootnoteRange | null } => {
  if (availableHeight <= 0) return { fitted: null, remaining: range };
  if (range.kind !== 'paragraph') {
    return getRangeRenderHeight(range) <= availableHeight
      ? { fitted: range, remaining: null }
      : { fitted: null, remaining: range };
  }

  const measure = measuresById.get(range.blockId);
  if (!measure || measure.kind !== 'paragraph' || !measure.lines) {
    return getRangeRenderHeight(range) <= availableHeight
      ? { fitted: range, remaining: null }
      : { fitted: null, remaining: range };
  }

  let accumulatedHeight = 0;
  let splitLine = range.fromLine;

  for (let i = range.fromLine; i < range.toLine; i += 1) {
    const lineHeight = measure.lines[i]?.lineHeight ?? 0;
    if (accumulatedHeight + lineHeight > availableHeight) break;
    accumulatedHeight += lineHeight;
    splitLine = i + 1;
  }

  if (splitLine === range.fromLine) {
    return { fitted: null, remaining: range };
  }

  const fitted: FootnoteRange = {
    ...range,
    toLine: splitLine,
    height: sumLineHeights(measure.lines, range.fromLine, splitLine),
  };

  if (splitLine >= range.toLine) {
    // SD-2656: when all lines fit, return the fitted range regardless of
    // spacingAfter. spacingAfter is the gap to the *next* paragraph; for
    // the last item placed in a band slice it shouldn't be charged against
    // the available height. Without this, a single-fn band whose body lines
    // fit exactly but whose post-paragraph spacing pushes the total over
    // the limit gets force-split (1 line placed + 3 lines continuation),
    // which is what caused the reference fixture's last fn to drip across 2 pages.
    if (fitted.height <= availableHeight) {
      return { fitted, remaining: null };
    }
    return { fitted: null, remaining: range };
  }

  const remaining: FootnoteRange = {
    ...range,
    fromLine: splitLine,
    height: sumLineHeights(measure.lines, splitLine, range.toLine),
  };
  return { fitted, remaining };
};

const forceFitFirstRange = (
  range: FootnoteRange,
  measuresById: ReadonlyMap<string, Measure>,
): { fitted: FootnoteRange | null; remaining: FootnoteRange | null } => {
  if (range.kind !== 'paragraph') {
    return { fitted: range, remaining: null };
  }

  const measure = measuresById.get(range.blockId);
  if (!measure || measure.kind !== 'paragraph' || !measure.lines?.length) {
    return { fitted: range, remaining: null };
  }

  const nextLine = Math.min(range.fromLine + 1, range.toLine);
  const fitted: FootnoteRange = {
    ...range,
    toLine: nextLine,
    height: sumLineHeights(measure.lines, range.fromLine, nextLine),
  };

  if (nextLine >= range.toLine) {
    return { fitted, remaining: null };
  }

  const remaining: FootnoteRange = {
    ...range,
    fromLine: nextLine,
    height: sumLineHeights(measure.lines, nextLine, range.toLine),
  };

  return { fitted, remaining };
};

export const fitFootnoteContent = (
  id: string,
  inputRanges: readonly FootnoteRange[],
  availableHeight: number,
  pageIndex: number,
  columnIndex: number,
  isContinuation: boolean,
  measuresById: ReadonlyMap<string, Measure>,
  forceFirstRange: boolean,
): { slice: FootnoteSlice; remainingRanges: FootnoteRange[] } => {
  const fittedRanges: FootnoteRange[] = [];
  let remainingRanges: FootnoteRange[] = [];
  let usedHeight = 0;
  const maxHeight = Math.max(0, availableHeight);

  for (let index = 0; index < inputRanges.length; index += 1) {
    const range = inputRanges[index];
    const remainingSpace = maxHeight - usedHeight;
    const rangeHeight = getRangeRenderHeight(range);

    if (rangeHeight <= remainingSpace) {
      fittedRanges.push(range);
      usedHeight += rangeHeight;
      continue;
    }

    if (range.kind === 'paragraph') {
      const split = splitRangeAtHeight(range, remainingSpace, measuresById);
      if (split.fitted) {
        // SD-2656: charge only the fitted *body* height (no spacingAfter)
        // when the fitted range completes the input — it's the last item in
        // this band slice, so trailing paragraph spacing is wasted. This
        // matches the relaxed check inside splitRangeAtHeight above.
        const fittedBodyHeight = split.fitted.height;
        const fittedFullHeight = getRangeRenderHeight(split.fitted);
        const charged = !split.remaining ? fittedBodyHeight : fittedFullHeight;
        if (charged <= remainingSpace) {
          fittedRanges.push(split.fitted);
          usedHeight += charged;
        }
      }
      if (split.remaining) {
        remainingRanges = [split.remaining, ...inputRanges.slice(index + 1)];
      } else {
        remainingRanges = inputRanges.slice(index + 1);
      }
      break;
    }

    remainingRanges = [range, ...inputRanges.slice(index + 1)];
    break;
  }

  if (fittedRanges.length === 0 && forceFirstRange && inputRanges.length > 0) {
    const forced = forceFitFirstRange(inputRanges[0], measuresById);
    if (forced.fitted) {
      fittedRanges.push(forced.fitted);
      usedHeight = getRangeRenderHeight(forced.fitted);
      remainingRanges = [];
      if (forced.remaining) {
        remainingRanges.push(forced.remaining);
      }
      remainingRanges.push(...inputRanges.slice(1));
    }
  }

  return {
    slice: {
      id,
      pageIndex,
      columnIndex,
      isContinuation,
      ranges: fittedRanges,
      totalHeight: usedHeight,
    },
    remainingRanges,
  };
};
