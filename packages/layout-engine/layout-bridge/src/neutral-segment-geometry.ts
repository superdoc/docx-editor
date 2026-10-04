/**
 * Editor-neutral measured segment-geometry readback (Phase 1 / 001).
 *
 * Projects the per-line / per-segment geometry that the measure + layout
 * pipeline already produced onto the editor-neutral
 * {@link NeutralSegmentGeometryReadback} contract. The output lets a host
 * resolve caret x/baseline/height and line-relative selection rects without
 * block-level ratio math and without reading geometry back off the painted DOM.
 *
 * Design rules (mirrors `neutral-hit.ts`):
 *
 *  - Geometry is read from the layout fragments + block measures, never from
 *    paint-time DOM measurement. This module runs in pure `node` (no canvas):
 *    segment widths and line metrics were measured upstream with the real
 *    canvas and are consumed here as data.
 *  - The surface is story-aware. Body content is the default story; callers
 *    laying out a header/footer/footnote story pass its locator via `options`.
 *  - Simple horizontal RTL paragraph fragments (pure Hebrew/Arabic + neutral
 *    punctuation, no rendered list marker) resolve to mirrored per-line geometry
 *    with `direction: 'rtl'` (V2 RTL Plan 004). Cases the substrate cannot
 *    resolve safely — table cell text, standalone list-item fragments, vertical
 *    writing modes, and mixed-script RTL (complex bidi) — fail closed with a
 *    stable {@link NeutralGeometryDiagnostic}; they never emit a wrong rect.
 *
 * Positioning mirrors the canonical v1 selection/caret math
 * (`index.ts#selectionToRects`, `text-measurement.ts#measureCharacterX` /
 * `measureCharacterXSegmentBased`, `list-indent-utils.ts`) so neutral geometry
 * stays consistent with what the painter draws.
 */
import type {
  FlowBlock,
  Fragment,
  Layout,
  LayoutStoryLocator,
  Line,
  Measure,
  NeutralFragmentGeometry,
  NeutralGeometryDiagnostic,
  NeutralLineGeometry,
  NeutralLineGeometryFlags,
  NeutralSegmentGeometry,
  NeutralSegmentGeometryReadback,
  NeutralTextDirection,
  ParaFragment,
  ParagraphBlock,
  ParagraphMeasure,
} from '@superdoc/contracts';
import {
  LAYOUT_SEGMENT_GEOMETRY_SCHEMA,
  adjustAvailableWidthForTextIndent,
  bodyStoryLocator,
  buildLayoutSourceIdentityForFragment,
  getFirstLineIndentOffset,
  getParagraphInlineDirection,
  interCharacterJustifyAdvanceBeforeOffset,
  sliceRunsForLine,
} from '@superdoc/contracts';
import { calculatePageTopFallback, findBlockIndexByFragmentId } from './position-hit.js';
import { lineHasComplexBidiContent } from './rtl-text-geometry.js';
import { countSpaces, getJustifyAdjustment, type JustifyAdjustment } from './line-justify-adjustment.js';
import {
  calculateTextStartIndent,
  extractParagraphIndent,
  getWordLayoutConfig,
  isListItem,
} from './list-indent-utils.js';
import type { PageGeometryHelper } from './page-geometry-helper';

export type CollectSegmentGeometryOptions = {
  /**
   * Story locator for the layout being read. Defaults to body. Pass the
   * header/footer/footnote/endnote locator when collecting geometry for a
   * non-body story layout so identity stays story-correct.
   */
  story?: LayoutStoryLocator;
  /**
   * Optional `PageGeometryHelper` for page-top lookups. Strongly recommended so
   * vertical geometry matches selection rendering exactly. Falls back to
   * `calculatePageTopFallback` when omitted.
   */
  geometryHelper?: PageGeometryHelper;
  /** Exact page interval/window to read; omitted means every page. */
  pageIndices?: readonly number[];
  /** Bounded page-top lookup used with `pageIndices` without building a whole-document helper cache. */
  pageTopAt?: (pageIndex: number) => number;
};

const ATOMIC_KINDS = new Set(['image', 'drawing']);

/** Visual-line content width helper: prefer measured `line.maxWidth` for alignment math. */
const resolveAvailableWidth = (
  block: ParagraphBlock,
  line: Line,
  fragmentWidth: number,
  isFirstLine: boolean,
  isListItemFlag: boolean,
  markerTextWidth: number | undefined,
): number => {
  const indent = extractParagraphIndent(block.attrs?.indent);
  let effectiveLeft = indent.left;

  const wordLayout = getWordLayoutConfig(block);
  const isListParagraph = Boolean(block.attrs?.numberingProperties) || Boolean(wordLayout?.marker);
  if (isListParagraph) {
    const explicitTextStart =
      typeof wordLayout?.marker?.textStartX === 'number' && Number.isFinite(wordLayout.marker.textStartX)
        ? wordLayout.marker.textStartX
        : typeof wordLayout?.textStartPx === 'number' && Number.isFinite(wordLayout.textStartPx)
          ? wordLayout.textStartPx
          : undefined;
    if (typeof explicitTextStart === 'number' && explicitTextStart > indent.left) {
      effectiveLeft = explicitTextStart;
    }
  }

  let availableWidth = Math.max(0, fragmentWidth - (effectiveLeft + indent.right));

  // Mirror mapPmToX: on the first line, account for the first-line indent the
  // same way the painter does, unless a rendered list marker already consumed it.
  const hasRenderedMarkerText = isListItemFlag && (markerTextWidth ?? 0) > 0;
  if (isFirstLine && !hasRenderedMarkerText) {
    const suppressFLI = (block.attrs as Record<string, unknown> | undefined)?.suppressFirstLineIndent === true;
    const firstLineOffset = getFirstLineIndentOffset(block.attrs?.indent, suppressFLI);
    availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
  }

  return availableWidth;
};

/**
 * Alignment offset for a non-tab line, in line-content-relative px. Matches the
 * `alignmentOffset` branch of `measureCharacterX` (center / right only;
 * left & justify anchor at 0).
 */
const resolveAlignmentOffset = (alignment: string | undefined, availableWidth: number, lineWidth: number): number => {
  if (alignment === 'center') return Math.max(0, (availableWidth - lineWidth) / 2);
  if (alignment === 'right') return Math.max(0, availableWidth - lineWidth);
  return 0;
};

/** A justify adjustment that resolves to no-op (used for non-justified lines). */
const NO_JUSTIFY: JustifyAdjustment = {
  extraPerSpace: 0,
  totalSpaces: 0,
  interCharacterSpacing: 0,
  interCharacterBoundaries: [],
};

/**
 * Resolve per-segment geometry for one line, replicating
 * `measureCharacterXSegmentBased`'s base-x walk: an explicit `segment.x` (tab
 * alignment) resets the running cursor, otherwise the segment flows after the
 * previous one. `originX` is the absolute container-space x of the line content
 * start (fragment.x + indent), and `alignmentOffset` is folded into the running
 * cursor for non-tab lines.
 *
 * `justify` carries the shared, painter-consistent slack computed by
 * `getJustifyAdjustment` (see `line-justify-adjustment.ts`) — a no-op for
 * non-justified lines. `runningX`/`segment.width` stay the NATURAL (pre-slack)
 * cumulative walk, exactly like `text-measurement.ts#measureCharacterXWithoutInlineBoxes`;
 * the slack is folded in only when emitting each segment's absolute `x` and
 * `width`, via the cumulative justify advance at the segment's start and end
 * line-relative character offsets (`advanceAt`) — the same "advance so far"
 * quantity `text-measurement.ts` computes for a single point, applied at both
 * boundaries so `width = (advance at end) - (advance at start) + natural
 * width`. This covers BOTH justify modes uniformly: word-spacing
 * (`extraPerSpace`, keyed by a running space tally) and inter-character
 * distribution (`interCharacterSpacing`, keyed by boundary offsets — the CJK
 * no-space case). Computing width from the delta, rather than only
 * multiplying `extraPerSpace` by the segment's own space count, also covers a
 * segment straddling multiple inter-character boundaries internally: a caret
 * or click landing anywhere inside a stretched segment (not just at a
 * segment boundary) resolves to the correct stretched x.
 */
const resolveLineSegments = (
  block: ParagraphBlock,
  line: Line,
  originX: number,
  alignmentOffset: number,
  tabAligned: boolean,
  justify: JustifyAdjustment = NO_JUSTIFY,
): NeutralSegmentGeometry[] => {
  const segments = line.segments;
  if (!segments || segments.length === 0) return [];

  const advanceAt = (lineCharOffset: number, spacesBefore: number): number =>
    justify.extraPerSpace !== 0
      ? justify.extraPerSpace * spacesBefore
      : interCharacterJustifyAdvanceBeforeOffset(
          justify.interCharacterBoundaries,
          lineCharOffset,
          justify.interCharacterSpacing,
        );

  const out: NeutralSegmentGeometry[] = [];
  let runningX = tabAligned ? 0 : alignmentOffset;
  let spaceTally = 0;
  let lineCharOffset = 0;
  segments.forEach((segment, segmentIndex) => {
    const segStartX = segment.x !== undefined ? segment.x : runningX;
    const run = block.runs[segment.runIndex];
    const segmentText = run && 'text' in run && typeof run.text === 'string' ? run.text : undefined;
    const spacesInSegment =
      justify.extraPerSpace !== 0 && segmentText != null
        ? countSpaces(segmentText.slice(segment.fromChar, segment.toChar))
        : 0;
    const segmentCharLength = segment.toChar - segment.fromChar;
    const advanceBefore = advanceAt(lineCharOffset, spaceTally);
    const advanceAfter = advanceAt(lineCharOffset + segmentCharLength, spaceTally + spacesInSegment);
    runningX = segStartX + segment.width;
    out.push({
      segmentIndex,
      runIndex: segment.runIndex,
      fromChar: segment.fromChar,
      toChar: segment.toChar,
      x: originX + segStartX + advanceBefore,
      width: segment.width + (advanceAfter - advanceBefore),
    });
    spaceTally += spacesInSegment;
    lineCharOffset += segmentCharLength;
  });
  return out;
};

/**
 * Resolve per-segment geometry for a simple-RTL line in visual (left-to-right
 * paint) order. The producer's segments are in logical order; for a single bidi
 * level the visual order is their reverse and each segment's visual box is the
 * mirror of its logical advance about the content box `[contentLeft,
 * contentLeft + contentWidth]`. `segmentIndex` keeps the segment's logical index
 * within the line's segment list (per contract), while the array order is
 * visual. Tab-aligned RTL lines never reach here — the caller fails them closed.
 */
const resolveLineSegmentsRtl = (line: Line, contentLeft: number, contentWidth: number): NeutralSegmentGeometry[] => {
  const segments = line.segments;
  if (!segments || segments.length === 0) return [];

  let advance = 0;
  const mirrored: NeutralSegmentGeometry[] = segments.map((segment, segmentIndex) => {
    const logicalStart = advance;
    advance += segment.width;
    return {
      segmentIndex,
      runIndex: segment.runIndex,
      fromChar: segment.fromChar,
      toChar: segment.toChar,
      x: contentLeft + contentWidth - (logicalStart + segment.width),
      width: segment.width,
    };
  });
  mirrored.sort((left, right) => left.x - right.x);
  return mirrored;
};

const buildParagraphLineGeometry = (
  block: ParagraphBlock,
  fragment: ParaFragment,
  lines: Line[],
  startIdx: number,
  endIdx: number,
  reportIndexBase: number,
  fragmentTopAbsolute: number,
  markerWidth: number,
  markerTextWidth: number | undefined,
  isListItemFlag: boolean,
  direction: NeutralTextDirection,
): { lines: NeutralLineGeometry[]; height: number; justified: boolean } => {
  const out: NeutralLineGeometry[] = [];
  const alignment = block.attrs?.alignment;
  const isRtl = direction === 'rtl';
  // List paragraphs paint left-aligned in the DOM for non-justify alignments.
  const isJustified = alignment === 'justify';
  const alignmentOverride = !isRtl && isListItemFlag && !isJustified ? 'left' : undefined;
  // RTL paragraphs default to visual-right alignment (DomPainter `resolveTextAlign`
  // maps undefined/justify -> 'right' under dir="rtl"); LTR keeps its own default.
  const effectiveAlignment = isRtl ? (alignment ?? 'right') : (alignmentOverride ?? alignment);

  const indent = extractParagraphIndent(block.attrs?.indent);
  const wordLayout = getWordLayoutConfig(block);

  let cumulativeTop = 0;
  let justifiedSeen = false;

  for (let i = startIdx; i < endIdx; i += 1) {
    const line = lines[i];
    if (!line) continue;

    const reportLineIndex = reportIndexBase + (i - startIdx);
    const top = fragmentTopAbsolute + cumulativeTop;
    const halfLeading = Math.max(0, (line.lineHeight - line.ascent - line.descent) / 2);
    const baseline = top + halfLeading + line.ascent;

    const isFirstLine = reportLineIndex === fragment.fromLine && !fragment.continuesFromPrev;
    const tabAligned = Boolean(line.segments?.some((seg) => seg.x !== undefined));

    const availableWidth = resolveAvailableWidth(
      block,
      line,
      fragment.width,
      isFirstLine,
      isListItemFlag,
      markerTextWidth,
    );
    const indentAdjust = calculateTextStartIndent({
      isFirstLine,
      isListItem: isListItemFlag,
      markerWidth,
      markerTextWidth,
      paraIndentLeft: indent.left,
      firstLineIndent: indent.firstLine,
      hangingIndent: indent.hanging,
      wordLayout,
    });

    // Justify and tab positioning anchor at 0; center/right shift content.
    const alignmentOffset =
      tabAligned || isJustified ? 0 : resolveAlignmentOffset(effectiveAlignment, availableWidth, line.width);
    const originX = fragment.x + indentAdjust;
    const contentLeft = originX + alignmentOffset;

    // Shared, painter-consistent slack (word-spacing / inter-character
    // distribution) for this line. `getJustifyAdjustment` re-derives
    // `shouldApplyJustify` itself (tab stops, last-line-of-paragraph), so it is
    // safe to call unconditionally for every justified-alignment line — it
    // resolves to a no-op where justify does not actually apply (e.g. the
    // true last line, or a tab-aligned line). RTL never reaches here:
    // `classifyRtlSupport` fails RTL+justify closed before this function runs.
    const justify = isJustified
      ? getJustifyAdjustment({ block, line, availableWidthOverride: availableWidth })
      : NO_JUSTIFY;
    const lineIsStretched = justify.extraPerSpace !== 0 || justify.interCharacterSpacing !== 0;
    // A justified line that actually stretches (not the true last line, not
    // tab-aligned) is rendered by the painter at the full available width, not
    // its natural pre-slack width — mirrors `renderedLineWidth` in
    // `text-measurement.ts#measureCharacterXWithoutInlineBoxes`. Consumers
    // (host hit-test/caret) rely on `contentWidth` matching what is actually
    // painted, both as the coordinate-space bound for a click on the
    // stretched line and as the `availableWidthOverride` fed back into the
    // shared justify math, so it must track the rendered span here.
    const contentWidth = lineIsStretched ? availableWidth : line.width;

    const flags: NeutralLineGeometryFlags = {};
    if (isJustified) {
      flags.justified = true;
      justifiedSeen = true;
    }
    if (tabAligned) flags.tabAligned = true;

    out.push({
      lineIndex: reportLineIndex,
      top,
      baseline,
      ascent: line.ascent,
      descent: line.descent,
      lineHeight: line.lineHeight,
      contentLeft,
      contentWidth,
      direction,
      ...(Object.keys(flags).length > 0 ? { flags } : {}),
      segments: isRtl
        ? resolveLineSegmentsRtl(line, contentLeft, line.width)
        : resolveLineSegments(block, line, originX, alignmentOffset, tabAligned, justify),
    });

    cumulativeTop += line.lineHeight;
  }

  return { lines: out, height: cumulativeTop, justified: justifiedSeen };
};

/**
 * Read editor-neutral measured segment geometry for every paintable fragment in
 * a layout.
 *
 * Body paragraph fragments (including word-layout list paragraphs) resolve to
 * full per-line / per-segment geometry. Fragment kinds whose text geometry this
 * version does not model (tables, inline/anchored images and drawings, and
 * standalone list-item fragments), and lines the substrate cannot place safely
 * (RTL/bidi), are emitted with identity + bounds and a diagnostic, never with a
 * guessed rect.
 */
export function collectSegmentGeometry(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  options?: CollectSegmentGeometryOptions,
): NeutralSegmentGeometryReadback {
  const layoutRevision = layout.layoutEpoch ?? 0;
  const story = options?.story ?? bodyStoryLocator();
  const geometryHelper = options?.geometryHelper;
  const fragments: NeutralFragmentGeometry[] = [];

  const pageIndices = options?.pageIndices ?? layout.pages.map((_page, pageIndex) => pageIndex);
  for (const pageIndex of pageIndices) {
    const page = layout.pages[pageIndex];
    if (!page) continue;
    const pageTopY = options?.pageTopAt
      ? options.pageTopAt(pageIndex)
      : geometryHelper
        ? geometryHelper.getPageTop(pageIndex)
        : calculatePageTopFallback(layout, pageIndex);

    for (const fragment of page.fragments) {
      const identity = buildLayoutSourceIdentityForFragment(fragment, story);
      const base: Omit<NeutralFragmentGeometry, 'bounds' | 'lines'> = {
        schema: LAYOUT_SEGMENT_GEOMETRY_SCHEMA,
        identity,
        story: identity.story,
        blockRef: identity.blockRef,
        fragmentId: identity.fragmentId,
        sourceAnchor: identity.sourceAnchor,
        pageIndex,
        fragmentKind: fragment.kind,
      };

      if (fragment.kind === 'para') {
        fragments.push(buildParaFragmentGeometry(base, fragment, blocks, measures, pageTopY));
        continue;
      }

      // Unsupported-for-now fragment kinds: keep identity + bounds, fail closed.
      const diagnostics: NeutralGeometryDiagnostic[] = [
        { code: 'unsupported-fragment-kind', fragmentKind: fragment.kind },
      ];
      fragments.push({
        ...base,
        bounds: fragmentBounds(fragment, pageTopY),
        lines: [],
        diagnostics,
      });
    }
  }

  return {
    schema: LAYOUT_SEGMENT_GEOMETRY_SCHEMA,
    layoutRevision,
    fragments,
  };
}

const fragmentBounds = (fragment: Fragment, pageTopY: number) => {
  const width = 'width' in fragment ? fragment.width : 0;
  const height = 'height' in fragment ? fragment.height : 0;
  return { x: fragment.x, y: fragment.y + pageTopY, width, height };
};

/** Visible text of a single measured line, in logical (source) run order. */
const lineVisibleText = (block: ParagraphBlock, line: Line): string => {
  if (Array.isArray(line.segments) && line.segments.length > 0) {
    return line.segments
      .map((segment) => {
        const run = block.runs[segment.runIndex];
        return run && 'text' in run ? (run.text ?? '').slice(segment.fromChar, segment.toChar) : '';
      })
      .join('');
  }
  return sliceRunsForLine(block, line)
    .map((run) => ('text' in run ? (run.text ?? '') : ''))
    .join('');
};

/**
 * Decide whether an RTL paragraph fragment is a proven simple-RTL case, or
 * return the diagnostic to fail it closed with. The supported subset is a
 * deliberately narrow scope boundary (V2 RTL Plan 004):
 *
 *  - rendered list markers (`isListItemFlag`) are out of scope — RTL marker
 *    geometry is not mirrored yet (`unsupported-direction`);
 *  - tab-aligned RTL lines use LTR tab x from the engine that the painter
 *    re-flows under dir="rtl" (`unsupported-direction`);
 *  - justified RTL lines are not modeled (`unsupported-direction`);
 *  - lines mixing strong-LTR letters or digits into the RTL flow are complex
 *    bidi (`unsupported-complex-bidi`).
 *
 * Returns `null` when every in-range line is safe to mirror.
 */
const classifyRtlSupport = (
  block: ParagraphBlock,
  lines: Line[],
  startIdx: number,
  endIdx: number,
  isListItemFlag: boolean,
): NeutralGeometryDiagnostic | null => {
  if (isListItemFlag) {
    return { code: 'unsupported-direction', direction: 'rtl' satisfies NeutralTextDirection };
  }
  const alignment = block.attrs?.alignment;
  for (let i = startIdx; i < endIdx; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const tabAligned = Boolean(line.segments?.some((segment) => segment.x !== undefined));
    if (tabAligned || alignment === 'justify') {
      return { code: 'unsupported-direction', direction: 'rtl' satisfies NeutralTextDirection };
    }
    if (lineHasComplexBidiContent(lineVisibleText(block, line))) {
      return { code: 'unsupported-complex-bidi' };
    }
  }
  return null;
};

const buildParaFragmentGeometry = (
  base: Omit<NeutralFragmentGeometry, 'bounds' | 'lines'>,
  fragment: ParaFragment,
  blocks: FlowBlock[],
  measures: Measure[],
  pageTopY: number,
): NeutralFragmentGeometry => {
  const fragmentTopAbsolute = fragment.y + pageTopY;
  const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
  const block = blockIndex === -1 ? undefined : blocks[blockIndex];
  const measure = blockIndex === -1 ? undefined : measures[blockIndex];

  if (!block || block.kind !== 'paragraph' || !measure || measure.kind !== 'paragraph') {
    return {
      ...base,
      bounds: { x: fragment.x, y: fragmentTopAbsolute, width: fragment.width, height: 0 },
      lines: [],
      diagnostics: [{ code: 'missing-measure' }],
    };
  }

  const paragraphMeasure = measure as ParagraphMeasure;
  const diagnostics: NeutralGeometryDiagnostic[] = [];

  const failClosed = (diagnostic: NeutralGeometryDiagnostic): NeutralFragmentGeometry => ({
    ...base,
    bounds: { x: fragment.x, y: fragmentTopAbsolute, width: fragment.width, height: 0 },
    lines: [],
    diagnostics: [diagnostic],
  });

  // Vertical writing mode (w:textDirection tbRl/btLr) is a separate axis horizontal
  // text geometry cannot place carets in; fail closed before anything else.
  const writingMode = block.attrs?.directionContext?.writingMode;
  if (writingMode === 'vertical-rl' || writingMode === 'vertical-lr') {
    return failClosed({ code: 'unsupported-vertical-direction', writingMode });
  }

  const useRemeasured = Array.isArray(fragment.lines) && fragment.lines.length > 0;
  const lines = useRemeasured ? (fragment.lines as Line[]) : paragraphMeasure.lines;
  const startIdx = useRemeasured ? 0 : fragment.fromLine;
  const endIdx = useRemeasured ? lines.length : fragment.toLine;
  const reportIndexBase = fragment.fromLine;
  if (useRemeasured) diagnostics.push({ code: 'remeasured-lines' });

  const markerWidth = fragment.markerWidth ?? paragraphMeasure.marker?.markerWidth ?? 0;
  const markerTextWidth = fragment.markerTextWidth ?? paragraphMeasure.marker?.markerTextWidth ?? undefined;
  const isListItemFlag = isListItem(markerWidth, block);

  // Inline base direction (w:bidi). RTL is supported only for a narrow, proven
  // subset; anything else fails closed with a named diagnostic (V2 RTL Plan 004).
  const direction: NeutralTextDirection = getParagraphInlineDirection(block.attrs) === 'rtl' ? 'rtl' : 'ltr';
  if (direction === 'rtl') {
    const unsupported = classifyRtlSupport(block, lines, startIdx, endIdx, isListItemFlag);
    if (unsupported) return failClosed(unsupported);
  }

  const built = buildParagraphLineGeometry(
    block,
    fragment,
    lines,
    startIdx,
    endIdx,
    reportIndexBase,
    fragmentTopAbsolute,
    markerWidth,
    markerTextWidth,
    isListItemFlag,
    direction,
  );

  // `buildParagraphLineGeometry`'s LTR segment resolution now applies the same
  // shared word-spacing / inter-character justify math the painter uses
  // (`resolveLineSegments`, via `getJustifyAdjustment`), so a justified line's
  // segment positions are exact, not approximate. RTL+justify never reaches
  // this point — `classifyRtlSupport` fails it closed above with
  // `unsupported-direction` — so `approximate-justify` no longer has a
  // reachable case to describe. The diagnostic code stays defined in the
  // contract (schema stability) in case a future unresolved justify variant
  // needs it again.

  return {
    ...base,
    bounds: { x: fragment.x, y: fragmentTopAbsolute, width: fragment.width, height: built.height },
    lines: built.lines,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
};
