import type {
  ParaFragment,
  ParagraphBlock,
  ParagraphMeasure,
  ParagraphAttrs,
  Line,
  ResolvedParagraphContent,
  ResolvedTextLineItem,
  ResolvedDropCapItem,
  ResolvedListMarkerItem,
  MarkerTrackedChange,
} from '@superdoc/contracts';
import {
  adjustAvailableWidthForTextIndent,
  getParagraphInlineDirection,
  sliceRunsForLine,
  usesPositionedTextGeometry,
} from '@superdoc/contracts';
import {
  isMinimalWordLayout,
  resolveListMarkerGeometry,
  resolveListTextStartPx,
  computeTabWidth,
  resolveMarkerIndent,
  type MinimalMarker,
  type MinimalWordLayout,
} from '@superdoc/common/list-marker-utils';

/**
 * Resolves marker width using the already-measured glyph width from layout whenever possible.
 * Mirrors resolvePainterMarkerTextWidth from painters/dom/src/paragraph/list-marker.ts.
 */
function resolveMarkerTextWidth(
  markerTextWidthPx: number | undefined,
  marker: { glyphWidthPx?: number; markerBoxWidthPx?: number },
): number {
  const val = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  return val(markerTextWidthPx) ?? val(marker.glyphWidthPx) ?? val(marker.markerBoxWidthPx) ?? 0;
}

/**
 * Resolves list marker geometry using the shared canonical helper,
 * with the painter's strategy of preferring the pre-measured glyph width.
 */
function resolverListMarkerGeometry(
  wordLayout: MinimalWordLayout | undefined,
  indentLeftPx: number,
  hangingIndentPx: number,
  firstLineIndentPx: number,
  markerTextWidthPx: number | undefined,
) {
  return resolveListMarkerGeometry(
    wordLayout,
    indentLeftPx,
    firstLineIndentPx,
    hangingIndentPx,
    (_markerText: string, marker: MinimalMarker) => resolveMarkerTextWidth(markerTextWidthPx, marker),
  );
}

/**
 * Resolves the canonical text-start position for a list first line,
 * preferring the pre-measured glyph width.
 */
function resolverListTextStartPx(
  wordLayout: MinimalWordLayout | undefined,
  indentLeftPx: number,
  hangingIndentPx: number,
  firstLineIndentPx: number,
  markerTextWidthPx: number | undefined,
): number | undefined {
  return resolveListTextStartPx(
    wordLayout,
    indentLeftPx,
    firstLineIndentPx,
    hangingIndentPx,
    (_markerText: string, marker: MinimalMarker) => resolveMarkerTextWidth(markerTextWidthPx, marker),
  );
}

/**
 * Resolves paragraph content for a non-table paragraph fragment.
 *
 * This lifts all layout-dependent computation out of the painter:
 * - per-line CSS indent values (paddingLeft, paddingRight, textIndent)
 * - per-line available width for justify calculations
 * - per-line skip-justify flag
 * - per-line indentOffset for the segment positioning path
 * - list marker geometry and rendering data
 * - drop cap rendering data
 */
export function resolveParagraphContent(
  fragment: ParaFragment,
  block: ParagraphBlock,
  measure: ParagraphMeasure,
): ResolvedParagraphContent {
  const wordLayout = isMinimalWordLayout(block.attrs?.wordLayout) ? block.attrs!.wordLayout : undefined;
  const paraIndent = (block.attrs as ParagraphAttrs | undefined)?.indent;
  const paraIndentLeft = paraIndent?.left ?? 0;
  const paraIndentRight = paraIndent?.right ?? 0;
  const isRtl = getParagraphInlineDirection(block.attrs) === 'rtl';
  const {
    anchorIndentPx: paraMarkerAnchorIndent,
    firstLinePx: markerFirstLine,
    hangingPx: markerHanging,
  } = resolveMarkerIndent(paraIndent, isRtl);
  const suppressFirstLineIndent = (block.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
  const firstLineOffset = suppressFirstLineIndent ? 0 : (paraIndent?.firstLine ?? 0) - (paraIndent?.hanging ?? 0);

  // Check if the paragraph ends with a lineBreak run
  const lastRun = block.runs.length > 0 ? block.runs[block.runs.length - 1] : null;
  const paragraphEndsWithLineBreak = lastRun?.kind === 'lineBreak';
  // In Word, a tab immediately before Shift+Enter terminates the visible line
  // without expanding its spaces. This is a common authoring workaround for
  // suppressing justification on a soft-break line.
  const terminalTabRunIndex =
    paragraphEndsWithLineBreak && block.runs.length >= 2 && block.runs[block.runs.length - 2]?.kind === 'tab'
      ? block.runs.length - 2
      : -1;

  // Compute lines for this fragment
  const lines: Line[] = fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine);

  // --- List marker resolution ---
  const hasMarker = !fragment.continuesFromPrev && fragment.markerWidth && wordLayout?.marker;

  const listFirstLineTextStartPx = hasMarker
    ? resolverListTextStartPx(
        wordLayout,
        paraMarkerAnchorIndent,
        markerHanging,
        markerFirstLine,
        fragment.markerTextWidth,
      )
    : undefined;

  const shouldUseSharedInlinePrefixGeometry =
    !fragment.continuesFromPrev &&
    fragment.markerWidth &&
    wordLayout?.marker?.justification === 'left' &&
    wordLayout.firstLineIndentMode !== true &&
    typeof fragment.markerTextWidth === 'number' &&
    Number.isFinite(fragment.markerTextWidth) &&
    fragment.markerTextWidth >= 0;

  const listFirstLineMarkerGeometry = shouldUseSharedInlinePrefixGeometry
    ? resolverListMarkerGeometry(
        wordLayout,
        paraMarkerAnchorIndent,
        markerHanging,
        markerFirstLine,
        fragment.markerTextWidth,
      )
    : undefined;

  // Pre-calculate marker geometry
  let listTabWidth = 0;
  let markerStartPos = 0;
  if (hasMarker) {
    const markerTextWidth = fragment.markerTextWidth!;
    const anchorPoint = paraMarkerAnchorIndent - markerHanging + markerFirstLine;
    const markerJustification = wordLayout!.marker!.justification ?? 'left';
    let currentPos: number;
    if (markerJustification === 'left') {
      markerStartPos = anchorPoint;
      currentPos = markerStartPos + markerTextWidth;
    } else if (markerJustification === 'right') {
      markerStartPos = anchorPoint - markerTextWidth;
      currentPos = anchorPoint;
    } else {
      markerStartPos = anchorPoint - markerTextWidth / 2;
      currentPos = markerStartPos + markerTextWidth;
    }

    const suffix = wordLayout!.marker!.suffix ?? 'tab';
    if (listFirstLineMarkerGeometry && (suffix === 'tab' || suffix === 'space')) {
      listTabWidth = listFirstLineMarkerGeometry.suffixWidthPx;
    } else if (suffix === 'tab') {
      listTabWidth = computeTabWidth(
        currentPos,
        markerJustification,
        wordLayout!.tabsPx,
        markerHanging,
        markerFirstLine,
        paraMarkerAnchorIndent,
      );
    } else if (suffix === 'space') {
      listTabWidth = 4;
    }
  }

  // --- Build resolved marker ---
  let marker: ResolvedListMarkerItem | undefined;
  if (hasMarker) {
    const m = wordLayout!.marker!;
    const justification = (m.justification ?? 'left') as 'left' | 'right' | 'center';
    const firstLinePaddingLeftPx = paraMarkerAnchorIndent - markerHanging + markerFirstLine;

    let centerPaddingAdjustPx: number | undefined;
    if (justification === 'center') {
      centerPaddingAdjustPx = fragment.markerTextWidth! / 2;
    }

    marker = {
      text: m.markerText ?? '',
      justification,
      suffix: (m.suffix ?? 'tab') as 'tab' | 'space' | 'nothing',
      vanish: m.run?.vanish,
      markerStartPx: markerStartPos,
      suffixWidthPx: listTabWidth,
      firstLinePaddingLeftPx,
      centerPaddingAdjustPx,
      run: {
        fontFamily: m.run?.fontFamily ?? '',
        fontSize: m.run?.fontSize ?? 0,
        bold: m.run?.bold,
        italic: m.run?.italic,
        color: m.run?.color,
        letterSpacing: m.run?.letterSpacing,
        // SD-2656: preserve caps marks ( w:caps / w:smallCaps ) so the
        // painter can apply text-transform: uppercase or font-variant:
        // small-caps to the marker text. Word's legal/contract list styles
        // ("FIRST:", "SECOND:") rely on this — without it the marker renders
        // as "First", "Second" (verbatim from the ordinal-text numbering).
        allCaps: m.run?.allCaps,
        smallCaps: m.run?.smallCaps,
      },
      sourceAnchor: block.sourceAnchor,
      // Plan 5: carry marker tracked-change review metadata through resolve so
      // the painter can stamp/style the marker glyph. Absent for normal markers.
      // The `@superdoc/common` marker type mirrors the contracts shape; narrow
      // it to the canonical `MarkerTrackedChange` at this single boundary.
      ...(m.trackedChange ? { trackedChange: m.trackedChange as MarkerTrackedChange } : {}),
    };
  }

  // --- Build resolved drop cap ---
  let dropCap: ResolvedDropCapItem | undefined;
  const dropCapDescriptor = (block.attrs as ParagraphAttrs | undefined)?.dropCapDescriptor;
  const dropCapMeasure = measure.dropCap;
  if (dropCapDescriptor && dropCapMeasure && !fragment.continuesFromPrev) {
    dropCap = {
      text: dropCapDescriptor.run.text,
      mode: dropCapDescriptor.mode,
      fontFamily: dropCapDescriptor.run.fontFamily,
      fontSize: dropCapDescriptor.run.fontSize,
      bold: dropCapDescriptor.run.bold,
      italic: dropCapDescriptor.run.italic,
      color: dropCapDescriptor.run.color,
      position: dropCapDescriptor.run.position,
      width: dropCapMeasure.width,
      height: dropCapMeasure.height,
    };
  }

  // --- Resolve each line ---
  const resolvedLines: ResolvedTextLineItem[] = lines.map((line, index) => {
    const hasExplicitSegmentPositioning = line.segments?.some((segment) => segment.x !== undefined) === true;
    const hasPositionedTextGeometry = usesPositionedTextGeometry(line, sliceRunsForLine(block, line), isRtl);
    const hasListFirstLineMarker =
      index === 0 && !fragment.continuesFromPrev && fragment.markerWidth && wordLayout?.marker;
    const shouldUseResolvedListTextStart =
      hasListFirstLineMarker && hasExplicitSegmentPositioning && listFirstLineTextStartPx != null;

    // --- Available width ---
    const positiveIndentReduction = Math.max(0, paraIndentLeft) + Math.max(0, paraIndentRight);
    const fallbackAvailableWidth = Math.max(0, fragment.width - positiveIndentReduction);
    let availableWidth =
      line.maxWidth != null ? Math.min(line.maxWidth, fallbackAvailableWidth) : fallbackAvailableWidth;

    if (shouldUseResolvedListTextStart) {
      availableWidth = fragment.width - listFirstLineTextStartPx! - Math.max(0, paraIndentRight);
    }

    // --- Skip justify ---
    const isLastLineOfFragment = index === lines.length - 1;
    const isLastLineOfParagraph = isLastLineOfFragment && !fragment.continuesOnNext;
    const lineEndsWithTerminalTab = terminalTabRunIndex >= 0 && line.toRun === terminalTabRunIndex;
    const skipJustify = (isLastLineOfParagraph && !paragraphEndsWithLineBreak) || lineEndsWithTerminalTab;

    // --- Is list first line ---
    const isListFirstLine = Boolean(hasListFirstLineMarker && fragment.markerTextWidth);

    // --- Is first line ---
    const isFirstLine = index === 0 && !fragment.continuesFromPrev;

    // --- Per-line indent computation (mirrors renderer lines 3017-3090) ---
    let paddingLeftPx = 0;
    let paddingRightPx = 0;
    let textIndentPx = 0;

    if (!isListFirstLine) {
      if (hasPositionedTextGeometry) {
        if (isFirstLine && firstLineOffset !== 0) {
          const effectiveLeftIndent = paraIndentLeft < 0 ? 0 : paraIndentLeft;
          const adjustedPadding = effectiveLeftIndent + firstLineOffset;
          if (adjustedPadding > 0) {
            paddingLeftPx = adjustedPadding;
          }
        }
      } else if (paraIndentLeft && paraIndentLeft > 0) {
        paddingLeftPx = paraIndentLeft;
      } else if (
        !isFirstLine &&
        paraIndent?.hanging &&
        paraIndent.hanging > 0 &&
        !(paraIndentLeft != null && paraIndentLeft < 0)
      ) {
        paddingLeftPx = paraIndent.hanging;
      }
    }

    if (paraIndentRight && paraIndentRight > 0) {
      paddingRightPx = paraIndentRight;
    }

    // Text indent for first line of non-list paragraphs without explicit segment positioning
    if (!fragment.continuesFromPrev && index === 0 && firstLineOffset && !isListFirstLine) {
      if (!hasPositionedTextGeometry) {
        textIndentPx = firstLineOffset;
      }
    }

    // Adjust availableWidth for first-line text indent. Default/generated tabs
    // can still use segment positioning, but they should justify against the
    // same hanging-indent first-line width as ordinary inline text. A single
    // authored hanging-prefix tab uses that width too; other authored stops keep
    // their tab-controlled geometry.
    const availableWidthIndentOffset =
      isFirstLine && !isListFirstLine && (line.hasExplicitTabStops !== true || line.justifyAfterHangingTab === true)
        ? firstLineOffset
        : textIndentPx;
    availableWidth = adjustAvailableWidthForTextIndent(availableWidth, availableWidthIndentOffset, line.maxWidth);

    // --- indentOffset for segment positioning path (mirrors renderer lines 5635-5653) ---
    const indentLeft = paraIndent?.left ?? 0;
    const firstLine = paraIndent?.firstLine ?? 0;
    const hanging = paraIndent?.hanging ?? 0;
    const paragraphLineIndex = fragment.fromLine + index;
    const isFirstLineOfPara = paragraphLineIndex === 0;
    const firstLineOffsetForCumX = isFirstLineOfPara ? firstLine - hanging : 0;
    const isListParagraph = Boolean(wordLayout?.marker);
    const fallbackListTextStartPx =
      typeof wordLayout?.marker?.textStartX === 'number' && Number.isFinite(wordLayout.marker.textStartX)
        ? wordLayout.marker.textStartX
        : typeof wordLayout?.textStartPx === 'number' && Number.isFinite(wordLayout.textStartPx)
          ? wordLayout.textStartPx
          : undefined;
    const resolvedListTextStartForSegments =
      hasListFirstLineMarker && listFirstLineTextStartPx != null ? listFirstLineTextStartPx : undefined;
    const listIndentOffset = isFirstLineOfPara
      ? (resolvedListTextStartForSegments ?? fallbackListTextStartPx ?? indentLeft)
      : indentLeft;
    const indentOffset = isListParagraph ? listIndentOffset : indentLeft + firstLineOffsetForCumX;

    return {
      line,
      lineIndex: paragraphLineIndex,
      availableWidth,
      skipJustify,
      paddingLeftPx,
      paddingRightPx,
      textIndentPx,
      isListFirstLine,
      resolvedListTextStartPx: shouldUseResolvedListTextStart ? listFirstLineTextStartPx : undefined,
      hasExplicitSegmentPositioning,
      indentOffset,
    };
  });

  return {
    lines: resolvedLines,
    dropCap,
    marker,
    continuesFromPrev: fragment.continuesFromPrev,
    continuesOnNext: fragment.continuesOnNext,
    paragraphEndsWithLineBreak,
  };
}
