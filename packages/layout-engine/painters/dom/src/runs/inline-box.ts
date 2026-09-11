import type { Line, LineInlineBox, ParagraphBlock, Run, TextRun } from '@superdoc/contracts';

const TEXT_LEAF_SELECTOR = '.superdoc-text-run';
const INLINE_BOX_ID_ATTRIBUTE = 'data-superdoc-inline-box-id';
const INLINE_BOX_FROM_ATTRIBUTE = 'data-superdoc-inline-box-from';
const INLINE_BOX_TO_ATTRIBUTE = 'data-superdoc-inline-box-to';
const EXTENSION_DATA_PREFIX = 'data-superdoc-ext-';

type TextLeafRange = {
  element: HTMLElement;
  from: number;
  to: number;
};

const isTextRun = (run: Run): run is TextRun => (run.kind === 'text' || run.kind === undefined) && 'text' in run;

const paragraphRunVisibleStarts = (block: ParagraphBlock): number[] => {
  const starts: number[] = [];
  let offset = 0;
  for (const run of block.runs) {
    starts.push(offset);
    offset += isTextRun(run) ? run.text.length : 1;
  }
  return starts;
};

export const markInlineBoxRun = (run: TextRun, lineFrom: number, lineTo: number): TextRun => ({
  ...run,
  dataAttrs: {
    ...run.dataAttrs,
    [INLINE_BOX_FROM_ATTRIBUTE]: String(lineFrom),
    [INLINE_BOX_TO_ATTRIBUTE]: String(lineTo),
  },
});

const sliceTextRun = (run: TextRun, from: number, to: number, lineFrom: number, lineTo: number): TextRun =>
  markInlineBoxRun(
    {
      ...run,
      text: run.text.slice(from, to),
      pmStart:
        run.pmStart != null ? run.pmStart + from : run.pmEnd != null ? run.pmEnd - (run.text.length - from) : undefined,
      pmEnd:
        run.pmStart != null ? run.pmStart + to : run.pmEnd != null ? run.pmEnd - (run.text.length - to) : undefined,
    },
    lineFrom,
    lineTo,
  );

/** Splits text runs at the segment boundaries emitted for inline-box edges. */
export const splitInlineBoxRuns = (block: ParagraphBlock, line: Line): Run[] | null => {
  if (!line.inlineBoxes?.length || !line.segments?.length) return null;

  const runStarts = paragraphRunVisibleStarts(block);
  const lineStart = (runStarts[line.fromRun] ?? 0) + line.fromChar;
  const runs: Run[] = [];
  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex];
    if (!run) continue;
    if (!isTextRun(run)) {
      runs.push(run);
      continue;
    }

    const from = runIndex === line.fromRun ? line.fromChar : 0;
    const to = runIndex === line.toRun ? line.toChar : run.text.length;
    const boundaries = line.segments
      .filter((segment) => segment.runIndex === runIndex)
      .flatMap((segment) => [segment.fromChar, segment.toChar])
      .filter((boundary) => boundary >= from && boundary <= to);
    const offsets = [...new Set([from, ...boundaries, to])].sort((a, b) => a - b);
    for (let index = 0; index < offsets.length - 1; index += 1) {
      const sliceFrom = offsets[index]!;
      const sliceTo = offsets[index + 1]!;
      if (sliceTo <= sliceFrom) continue;
      runs.push(
        sliceTextRun(
          run,
          sliceFrom,
          sliceTo,
          (runStarts[runIndex] ?? 0) + sliceFrom - lineStart,
          (runStarts[runIndex] ?? 0) + sliceTo - lineStart,
        ),
      );
    }
  }
  return runs;
};

const collectTextLeafRanges = (lineElement: HTMLElement): TextLeafRange[] => {
  return Array.from(lineElement.querySelectorAll<HTMLElement>(TEXT_LEAF_SELECTOR)).map((element) => {
    const from = Number(element.getAttribute(INLINE_BOX_FROM_ATTRIBUTE));
    const to = Number(element.getAttribute(INLINE_BOX_TO_ATTRIBUTE));
    element.removeAttribute(INLINE_BOX_FROM_ATTRIBUTE);
    element.removeAttribute(INLINE_BOX_TO_ATTRIBUTE);
    return { element, from, to };
  });
};

/** Returns the resolved inline advance preceding an explicitly positioned text segment. */
export const inlineBoxAdvanceBeforeOffset = (boxes: readonly LineInlineBox[] | undefined, offset: number): number =>
  (boxes ?? []).reduce((advance, box) => {
    if (offset > box.from) {
      advance += box.style.paddingInlineStart + box.style.borderWidth + (box.startsRange ? box.style.gapBefore : 0);
    }
    if (offset >= box.to) {
      advance += box.style.paddingInlineEnd + box.style.borderWidth + (box.endsRange ? box.style.gapAfter : 0);
    }
    return advance;
  }, 0);

const applyInlineBoxStyle = (
  element: HTMLElement,
  box: LineInlineBox,
  isFirstLeaf: boolean,
  isLastLeaf: boolean,
): void => {
  const borderStyle = box.style.borderStyle ?? 'solid';
  const borderColor = box.style.borderColor ?? 'transparent';
  const border = `${box.style.borderWidth}px ${borderStyle} ${borderColor}`;
  const radius = box.style.borderRadius ?? 0;
  const verticalChrome = box.style.paddingBlockStart + box.style.paddingBlockEnd + box.style.borderWidth * 2;
  const contentLineHeight = Math.max(0, box.height - verticalChrome);

  element.setAttribute(INLINE_BOX_ID_ATTRIBUTE, box.id);
  if (box.className) element.classList.add(...box.className.split(' '));
  for (const [key, value] of Object.entries(box.data ?? {})) {
    element.setAttribute(`${EXTENSION_DATA_PREFIX}${key}`, value);
  }
  if (box.cursor) element.style.cursor = box.cursor;
  element.style.display = 'inline-block';
  element.style.boxSizing = 'border-box';
  element.style.height = `${box.height}px`;
  if (!element.style.lineHeight) element.style.lineHeight = `${contentLineHeight}px`;
  /*
   * Logical properties, not physical ones. `LineInlineBox.style` is already
   * expressed on the logical axes (`paddingInlineStart`, `gapBefore`), and
   * `isFirstLeaf`/`isLastLeaf` are logical too — they index the covered leaves in
   * document order. Writing `padding-left` for `paddingInlineStart` silently
   * assumes those two coincide, which holds only in LTR.
   *
   * The browser does the mapping: logical properties resolve against the
   * element's own computed direction, and the leaf inherits it from the line
   * element, which the renderer already marks (`el.dir`). So an RTL line puts
   * the inline start on the right with no direction arithmetic here.
   */
  element.style.paddingBlockStart = `${box.style.paddingBlockStart}px`;
  element.style.paddingBlockEnd = `${box.style.paddingBlockEnd}px`;
  element.style.paddingInlineStart = isFirstLeaf ? `${box.style.paddingInlineStart}px` : '0px';
  element.style.paddingInlineEnd = isLastLeaf ? `${box.style.paddingInlineEnd}px` : '0px';
  element.style.marginInlineStart = isFirstLeaf && box.startsRange ? `${box.style.gapBefore}px` : '0px';
  element.style.marginInlineEnd = isLastLeaf && box.endsRange ? `${box.style.gapAfter}px` : '0px';
  element.style.borderBlockStart = border;
  element.style.borderBlockEnd = border;
  element.style.borderInlineStart = isFirstLeaf ? border : '0px';
  element.style.borderInlineEnd = isLastLeaf ? border : '0px';
  if (box.style.backgroundColor != null) element.style.backgroundColor = box.style.backgroundColor;
  if (box.style.color != null) element.style.color = box.style.color;
  element.style.borderStartStartRadius = isFirstLeaf ? `${radius}px` : '0px';
  element.style.borderEndStartRadius = isFirstLeaf ? `${radius}px` : '0px';
  element.style.borderStartEndRadius = isLastLeaf ? `${radius}px` : '0px';
  element.style.borderEndEndRadius = isLastLeaf ? `${radius}px` : '0px';
};

/**
 * Paints measured inline-box slices on the canonical text leaves.
 *
 * Direction-agnostic: every edge is written on a logical axis, so the same call
 * is correct for an LTR and an RTL line.
 *
 * Known limitation, not a guarantee: nothing filters out a range that straddles
 * a direction change. Such a range maps to more than one visual segment, and
 * `isFirstLeaf`/`isLastLeaf` can only mark one start and one end, so the box
 * gets its edges on the wrong fragments. That predates the logical properties —
 * the Unicode Bidi Algorithm reorders a Hebrew phrase inside a Latin paragraph
 * whether or not anything declares `w:rtl`, and such a paragraph was never
 * gated. Fixing it means painting per visual segment, which is a change to
 * `Line.segments` rather than to this file.
 */
export const paintInlineBoxes = (boxes: readonly LineInlineBox[] | undefined, lineElement: HTMLElement): void => {
  if (!boxes?.length) return;

  const leafRanges = collectTextLeafRanges(lineElement);
  for (const box of boxes) {
    const coveredLeaves = leafRanges.filter(
      ({ from, to }) => Number.isFinite(from) && Number.isFinite(to) && from < box.to && to > box.from,
    );
    coveredLeaves.forEach(({ element }, index) => {
      applyInlineBoxStyle(element, box, index === 0, index === coveredLeaves.length - 1);
    });
  }
};
