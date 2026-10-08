import { completeRenderWork, resolveRenderWork, type RenderWork } from '../render-work.js';
import type {
  DropCapDescriptor,
  Line,
  MarkerTrackedChange,
  ParagraphBlock,
  ParagraphMeasure,
  ResolvedParagraphContent,
  Run,
  SdtMetadata,
  SourceAnchor,
} from '@superdoc/contracts';
import {
  effectiveTableCellSpacing,
  expandRunsForInlineNewlines,
  getParagraphInlineDirection,
  isEmptySdtPlaceholderRun,
  shouldApplyJustify,
  sliceRunsForLine,
  usesPositionedTextGeometry,
} from '@superdoc/contracts';
import { resolveMarkerIndent, type MinimalWordLayout } from '@superdoc/common/list-marker-utils';
import { resolvePhysicalFamily, type ResolvePhysicalFamily } from '@superdoc/font-system';
import {
  applySdtContainerChrome,
  getSdtContainerMetadata,
  isStructuredContentMetadata,
  shouldRenderSdtContainerChrome,
  type SdtAncestorOptions,
  type SdtBoundaryOptions,
} from '../sdt/container.js';
import { createParagraphDecorationLayers, stampBetweenBorderDataset, type BetweenBorderInfo } from './borders/index.js';
import { resolveTextAlign } from '../features/inline-direction/index.js';
import {
  applyParagraphLineIndentation,
  hasExplicitSegmentPositioning,
  resolveAvailableWidthForLine,
} from './indentation.js';
import { renderLegacyListMarker, renderResolvedListMarker, resolvePainterListTextStartPx } from './list-marker.js';
import { applyParagraphBlockStyles, clearParagraphFrameIndentStyles } from './styles.js';
import {
  TRACK_CHANGE_BASE_CLASS,
  TRACK_CHANGE_MODIFIER_CLASS,
  applySemanticTrackedChangeMetadata,
  applyTrackedChangeColorVariables,
  resolveTrackedChangesConfig,
} from '../runs/tracked-changes.js';

const INLINE_SDT_CHROME_EXTRA_WIDTH_PX = 4;
const SECTION_BREAK_TRACKED_CHANGE_MARKER_CLASS = 'superdoc-section-break-review-marker';
const PARAGRAPH_MARK_TRACKED_CHANGE_CLASS = 'superdoc-tracked-paragraph-mark';
const PARAGRAPH_PROPERTY_TRACKED_CHANGE_MARKER_CLASS = 'superdoc-paragraph-property-review-marker';

type ParagraphTrackedChangeAnchorKind = 'paragraph-mark' | 'paragraph-property';

const trackedChangeGroupedIds = (trackedChange: MarkerTrackedChange): string[] =>
  Array.isArray(trackedChange.groupedIds) && trackedChange.groupedIds.length > 0
    ? trackedChange.groupedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [trackedChange.id];

const mergeTrackChangeIds = (existing: string | undefined, next: readonly string[]): string[] => {
  const ids = new Set<string>();
  for (const id of (existing ?? '').split(',')) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  for (const id of next) {
    if (id) ids.add(id);
  }
  return [...ids];
};

const applyParagraphTrackedChangeAnchor = (
  element: HTMLElement,
  trackedChange: MarkerTrackedChange,
  anchorKind: ParagraphTrackedChangeAnchorKind,
): void => {
  if (!trackedChange?.id) return;
  const ids = trackedChangeGroupedIds(trackedChange);
  element.dataset.trackChangeId = trackedChange.id;
  element.dataset.trackChangeIds = mergeTrackChangeIds(element.dataset.trackChangeIds, ids).join(',');
  element.dataset.trackChangeKind = trackedChange.kind;
  element.dataset.trackChangeAnchor = anchorKind;
  if (anchorKind === 'paragraph-mark') {
    element.dataset.trackChangeStructural = 'paragraph-mark';
    element.dataset.trackChangeMarker = 'paragraph';
  } else {
    delete element.dataset.trackChangeStructural;
    delete element.dataset.trackChangeMarker;
  }
  // No 'body' default for a missing story key: an unknown owning story must not
  // masquerade as body (IT-1250; see runs/tracked-changes.ts).
  if (trackedChange.storyKey) {
    element.dataset.storyKey = trackedChange.storyKey;
  }
  if (trackedChange.type) element.dataset.trackChangeType = trackedChange.type;
  if (trackedChange.subtype) element.dataset.trackChangeSubtype = trackedChange.subtype;
  if (trackedChange.targetKind) element.dataset.trackChangeTargetKind = trackedChange.targetKind;
  if (trackedChange.semanticColorKey) {
    element.dataset.trackChangeSemanticColorKey = trackedChange.semanticColorKey;
  }
  if (trackedChange.semanticColor) {
    element.dataset.trackChangeSemanticColor = trackedChange.semanticColor;
  }
  if (trackedChange.semanticAnchorScope) {
    element.dataset.trackChangeSemanticAnchorScope = trackedChange.semanticAnchorScope;
  }
  if (trackedChange.author) element.dataset.trackChangeAuthor = trackedChange.author;
  if (trackedChange.authorEmail) element.dataset.trackChangeAuthorEmail = trackedChange.authorEmail;
  if (trackedChange.color) element.dataset.trackChangeAuthorColor = trackedChange.color;
  if (trackedChange.date) element.dataset.trackChangeDate = trackedChange.date;
};

const applyParagraphMarkTrackedChangeAnchor = (element: HTMLElement, trackedChange: MarkerTrackedChange): void => {
  applyParagraphTrackedChangeAnchor(element, trackedChange, 'paragraph-mark');
};

const applyParagraphPropertyTrackedChangeAnchor = (element: HTMLElement, trackedChange: MarkerTrackedChange): void => {
  applyParagraphTrackedChangeAnchor(element, trackedChange, 'paragraph-property');
  applyTrackedChangeColorVariables(element, trackedChange);
  applySemanticTrackedChangeMetadata(element, trackedChange);
};

const shouldRenderParagraphPropertyTrackedChangeMarker = (block: ParagraphBlock): boolean => {
  const trackedChange = block.attrs?.paragraphPropertyTrackedChange;
  if (!trackedChange?.id) return false;
  const config = resolveTrackedChangesConfig(block);
  if (!config.enabled || config.mode === 'off') return false;
  return TRACK_CHANGE_MODIFIER_CLASS[trackedChange.kind]?.[config.mode] === 'highlighted';
};

const renderParagraphPropertyTrackedChangeMarker = (
  doc: Document,
  frameEl: HTMLElement,
  block: ParagraphBlock,
): void => {
  const trackedChange = block.attrs?.paragraphPropertyTrackedChange;
  if (!trackedChange?.id) return;
  if (!shouldRenderParagraphPropertyTrackedChangeMarker(block)) return;
  const config = resolveTrackedChangesConfig(block);
  const modifier = TRACK_CHANGE_MODIFIER_CLASS[trackedChange.kind]?.[config.mode];
  if (!modifier) return;

  const markerEl = doc.createElement('span');
  markerEl.classList.add(PARAGRAPH_PROPERTY_TRACKED_CHANGE_MARKER_CLASS);

  const baseClass = TRACK_CHANGE_BASE_CLASS[trackedChange.kind];
  if (baseClass) markerEl.classList.add(baseClass);
  markerEl.classList.add(modifier);
  applyTrackedChangeColorVariables(markerEl, trackedChange);
  applySemanticTrackedChangeMetadata(markerEl, trackedChange);
  applyParagraphPropertyTrackedChangeAnchor(markerEl, trackedChange);

  frameEl.dataset.trackChangeMarkerVisible = 'true';
  frameEl.appendChild(markerEl);
};

const parseCssPx = (value: string): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveParagraphPropertyMarkerLineLeft = (params: {
  block: ParagraphBlock;
  line: Line;
  lineEl: HTMLElement;
  fragmentWidth: number;
  availableWidth?: number;
  contentWidth?: number;
}): number => {
  const { block, line, lineEl, fragmentWidth, availableWidth, contentWidth } = params;
  const paddingLeft = parseCssPx(lineEl.style.paddingLeft);
  const textIndent = parseCssPx(lineEl.style.textIndent);
  const explicitPositioningOffset =
    hasExplicitSegmentPositioning(line) && typeof line.segments?.[0]?.x === 'number' ? line.segments[0].x : 0;
  const textStartOffset = Math.max(0, paddingLeft + textIndent + explicitPositioningOffset);
  const lineContentWidth = Math.max(0, contentWidth ?? line.naturalWidth ?? line.width ?? 0);
  const effectiveAvailableWidth = Math.max(0, availableWidth ?? line.maxWidth ?? fragmentWidth - textStartOffset);
  const alignmentSlack = Math.max(0, effectiveAvailableWidth - lineContentWidth);
  const alignment = resolveTextAlign(block.attrs?.alignment, getParagraphInlineDirection(block.attrs) === 'rtl');
  const alignmentOffset = alignment === 'center' ? alignmentSlack / 2 : alignment === 'right' ? alignmentSlack : 0;
  return Math.max(0, textStartOffset + alignmentOffset);
};

const placeParagraphPropertyTrackedChangeMarker = (params: {
  block: ParagraphBlock;
  frameEl: HTMLElement;
  lineEl: HTMLElement;
  line: Line;
  fragmentWidth: number;
  availableWidth?: number;
  contentWidth?: number;
}): void => {
  if (!shouldRenderParagraphPropertyTrackedChangeMarker(params.block)) return;
  const markerLeft = resolveParagraphPropertyMarkerLineLeft(params);
  params.frameEl.style.setProperty(
    '--sd-tracked-changes-paragraph-property-marker-left',
    `${Math.round(markerLeft - 10)}px`,
  );
};

const isSectionBreakTrackedChange = (trackedChange: MarkerTrackedChange | undefined): boolean =>
  trackedChange?.targetKind === 'section-break' ||
  trackedChange?.subtype === 'section-break-insertion' ||
  trackedChange?.subtype === 'section-break-deletion';

const applySectionBreakTrackedChangeMarker = (
  markerEl: HTMLElement,
  trackedChange: MarkerTrackedChange,
  block: ParagraphBlock,
): void => {
  const config = resolveTrackedChangesConfig(block);
  if (!config.enabled || config.mode === 'off') return;

  const baseClass = TRACK_CHANGE_BASE_CLASS[trackedChange.kind];
  if (baseClass) markerEl.classList.add(baseClass);
  const modifier = TRACK_CHANGE_MODIFIER_CLASS[trackedChange.kind]?.[config.mode];
  if (modifier) markerEl.classList.add(modifier);
  applyTrackedChangeColorVariables(markerEl, trackedChange);
  applySemanticTrackedChangeMetadata(markerEl, trackedChange);

  const ids =
    Array.isArray(trackedChange.groupedIds) && trackedChange.groupedIds.length > 0
      ? trackedChange.groupedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [trackedChange.id];
  markerEl.dataset.trackChangeId = trackedChange.id;
  markerEl.dataset.trackChangeIds = ids.join(',');
  markerEl.dataset.trackChangeKind = trackedChange.kind;
  markerEl.dataset.trackChangeAnchor = 'section-break';
  markerEl.dataset.trackChangeStructural = 'section-break';
  markerEl.dataset.trackChangeMarker = 'section-break';
  if (trackedChange.storyKey) markerEl.dataset.storyKey = trackedChange.storyKey;
  if (trackedChange.author) markerEl.dataset.trackChangeAuthor = trackedChange.author;
  if (trackedChange.authorEmail) markerEl.dataset.trackChangeAuthorEmail = trackedChange.authorEmail;
  if (trackedChange.color) markerEl.dataset.trackChangeAuthorColor = trackedChange.color;
  if (trackedChange.date) markerEl.dataset.trackChangeDate = trackedChange.date;
};

const applyParagraphMarkGlyphTrackedChange = (
  lineEl: HTMLElement,
  trackedChange: MarkerTrackedChange | undefined,
  block: ParagraphBlock,
): void => {
  if (!trackedChange?.id || isSectionBreakTrackedChange(trackedChange)) return;

  const config = resolveTrackedChangesConfig(block);
  if (!config.enabled || config.mode === 'off') return;

  const markEl = lineEl.querySelector<HTMLElement>('.superdoc-formatting-paragraph-mark');
  if (!markEl) return;

  const baseClass = TRACK_CHANGE_BASE_CLASS[trackedChange.kind];
  if (baseClass) markEl.classList.add(baseClass);
  markEl.classList.add(PARAGRAPH_MARK_TRACKED_CHANGE_CLASS);
  const modifier = TRACK_CHANGE_MODIFIER_CLASS[trackedChange.kind]?.[config.mode];
  if (modifier) markEl.classList.add(modifier);

  applyTrackedChangeColorVariables(markEl, trackedChange);
  applySemanticTrackedChangeMetadata(markEl, trackedChange);

  const ids =
    Array.isArray(trackedChange.groupedIds) && trackedChange.groupedIds.length > 0
      ? trackedChange.groupedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [trackedChange.id];
  markEl.dataset.trackChangeId = trackedChange.id;
  markEl.dataset.trackChangeIds = ids.join(',');
  markEl.dataset.trackChangeKind = trackedChange.kind;
  markEl.dataset.trackChangeAnchor = 'paragraph-mark';
  markEl.dataset.trackChangeStructural = 'paragraph-mark';
  markEl.dataset.trackChangeMarker = 'paragraph';
  if (trackedChange.storyKey) markEl.dataset.storyKey = trackedChange.storyKey;
  if (trackedChange.author) markEl.dataset.trackChangeAuthor = trackedChange.author;
  if (trackedChange.authorEmail) markEl.dataset.trackChangeAuthorEmail = trackedChange.authorEmail;
  if (trackedChange.color) markEl.dataset.trackChangeAuthorColor = trackedChange.color;
  if (trackedChange.date) markEl.dataset.trackChangeDate = trackedChange.date;

  if (modifier === 'highlighted') {
    markEl.style.display = 'inline';
    markEl.style.textDecorationColor = 'currentColor';
    markEl.style.textDecorationLine = trackedChange.kind === 'delete' ? 'line-through' : 'underline';
  }
};

const renderSectionBreakTrackedChangeMarker = (doc: Document, frameEl: HTMLElement, block: ParagraphBlock): void => {
  if (block.attrs?.sectPrMarker !== true) return;
  const trackedChange = block.attrs.paragraphMarkTrackedChange;
  if (!trackedChange || !isSectionBreakTrackedChange(trackedChange)) return;
  const config = resolveTrackedChangesConfig(block);
  if (!config.enabled || config.mode === 'off') return;

  const markerEl = doc.createElement('span');
  markerEl.classList.add(SECTION_BREAK_TRACKED_CHANGE_MARKER_CLASS);
  markerEl.textContent = 'Section Break';
  markerEl.dataset.trackChangeAnchor = 'section-break';
  markerEl.dataset.trackChangeStructural = 'section-break';
  markerEl.dataset.trackChangeMarker = 'section-break';
  markerEl.setAttribute('aria-label', 'Section Break tracked change');
  applySectionBreakTrackedChangeMarker(markerEl, trackedChange, block);
  frameEl.appendChild(markerEl);
};

export type RenderedParagraphLineInfo = {
  el: HTMLElement;
  top: number;
  height: number;
};

export type ParagraphRenderLineInput = {
  block: ParagraphBlock;
  line: Line;
  lineIndex: number;
  isLastLine: boolean;
  availableWidth?: number;
  skipJustify?: boolean;
  preExpandedRuns?: Run[];
  resolvedListTextStartPx?: number;
  indentOffsetOverride?: number;
  paragraphMarkLeftOffsetOverride?: number;
};

export type ParagraphRenderLine = (input: ParagraphRenderLineInput) => HTMLElement | RenderWork<HTMLElement>;

export type ParagraphRenderDropCap = (
  descriptor: DropCapDescriptor,
  measure?: { width: number; height: number; lines: number; mode: 'drop' | 'margin' },
) => HTMLElement;

export type ParagraphContainerKind = 'body-fragment' | 'table-cell';

type ParagraphSpacingPolicy = {
  isFirstBlock: boolean;
  isLastBlock: boolean;
  paddingTop: number;
};

export type RenderParagraphContentParams = {
  doc: Document;
  frameEl: HTMLElement;
  block: ParagraphBlock;
  measure: ParagraphMeasure;
  containerKind: ParagraphContainerKind;
  width: number;
  localStartLine: number;
  localEndLine: number;
  linesOverride?: Line[];
  lineIndexOffset?: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
  markerWidth?: number;
  markerTextWidth?: number;
  wordLayout?: MinimalWordLayout;
  resolvedContent?: ResolvedParagraphContent;
  betweenInfo?: BetweenBorderInfo;
  sdtBoundary?: SdtBoundaryOptions;
  spacingPolicy?: ParagraphSpacingPolicy;
  ancestorContainerKey?: string | null;
  ancestorContainerSdt?: SdtMetadata | null;
  ancestorContainerKeys?: SdtAncestorOptions['ancestorContainerKeys'];
  ancestorContainerSdts?: SdtAncestorOptions['ancestorContainerSdts'];
  onSdtContainerChrome?: () => void;
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  applyContainerSdtDataset?: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  renderLine: ParagraphRenderLine;
  renderDropCap?: ParagraphRenderDropCap;
  /**
   * Per-document logical->physical font resolver for list markers. Threaded from the renderer's
   * per-document resolver so a marker paints the same physical family it was measured in. Undefined
   * (or omitted) falls back to the global resolver, matching text runs and field annotations.
   */
  resolvePhysical?: ResolvePhysicalFamily;
  captureLineSnapshot?: (
    lineEl: HTMLElement,
    options?: { inTableParagraph?: boolean; wrapperEl?: HTMLElement; sourceAnchor?: SourceAnchor },
  ) => void;
  convertFinalParagraphMark?: boolean;
  lineTopOffset?: number;
  sourceAnchor?: SourceAnchor;
  contentControlsChrome?: 'default' | 'none';
};

export type RenderParagraphContentResult = {
  renderedHeight: number;
  totalHeight: number;
  renderedLines: RenderedParagraphLineInfo[];
};

export function* renderParagraphContentWork(
  params: RenderParagraphContentParams,
): RenderWork<RenderParagraphContentResult> {
  const {
    doc,
    frameEl,
    block,
    measure,
    linesOverride,
    width,
    localStartLine,
    localEndLine,
    lineIndexOffset = 0,
    continuesFromPrev,
    continuesOnNext,
    resolvedContent,
    betweenInfo,
    sdtBoundary,
    spacingPolicy,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
    applySdtDataset,
    applyContainerSdtDataset,
    contentControlsChrome,
    renderDropCap,
    lineTopOffset = 0,
  } = params;

  applyParagraphBlockStyles(frameEl, block.attrs);
  const { shadingLayer, borderLayer } = createParagraphDecorationLayers(doc, width, block.attrs, betweenInfo);
  if (shadingLayer) frameEl.appendChild(shadingLayer);
  if (borderLayer) frameEl.appendChild(borderLayer);
  stampBetweenBorderDataset(frameEl, betweenInfo);

  if (block.attrs?.styleId) {
    frameEl.dataset.styleId = block.attrs.styleId;
    frameEl.setAttribute('styleid', block.attrs.styleId);
  }
  if (block.attrs?.paragraphMarkTrackedChange) {
    applyParagraphMarkTrackedChangeAnchor(frameEl, block.attrs.paragraphMarkTrackedChange);
  }
  if (block.attrs?.paragraphPropertyTrackedChange) {
    applyParagraphPropertyTrackedChangeAnchor(frameEl, block.attrs.paragraphPropertyTrackedChange);
  }
  renderSectionBreakTrackedChangeMarker(doc, frameEl, block);
  applySdtDataset(frameEl, block.attrs?.sdt);
  applyContainerSdtDataset?.(frameEl, block.attrs?.containerSdt);

  const applySdtChrome = shouldRenderSdtContainerChrome(block.attrs?.sdt, block.attrs?.containerSdt, {
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
  });
  if (applySdtChrome) {
    if (
      applySdtContainerChrome(
        doc,
        frameEl,
        block.attrs?.sdt,
        block.attrs?.containerSdt,
        sdtBoundary,
        undefined,
        contentControlsChrome,
      )
    ) {
      onSdtContainerChrome?.();
    }
  }

  renderParagraphDropCap({
    frameEl,
    block,
    measure,
    resolvedContent,
    continuesFromPrev,
    renderDropCap,
  });

  clearParagraphFrameIndentStyles(frameEl);

  const spacingBefore = block.attrs?.spacing?.before;
  let beforeHeight = 0;
  if (spacingPolicy && localStartLine === 0) {
    beforeHeight = effectiveTableCellSpacing(spacingBefore, spacingPolicy.isFirstBlock, spacingPolicy.paddingTop);
    if (beforeHeight > 0) {
      frameEl.style.marginTop = `${beforeHeight}px`;
    }
  }

  const renderResult = yield* resolvedContent != null
    ? renderResolvedLines({
        ...params,
        resolvedContent,
        lineTopOffset: lineTopOffset + beforeHeight,
      })
    : renderMeasuredLines({
        ...params,
        lineTopOffset: lineTopOffset + beforeHeight,
      });
  if (applySdtChrome) {
    applyBlockSdtChromeBounds(
      frameEl,
      block,
      measure,
      getRenderedContentLines(params),
      width,
      lineIndexOffset + localStartLine,
      continuesFromPrev,
      continuesOnNext,
      sdtBoundary,
      resolvedContent,
    );
  }

  let renderedHeight = renderResult.renderedHeight;
  const originalLineCount = measure.lines?.length ?? linesOverride?.length ?? 0;
  const renderedStartLine = lineIndexOffset + localStartLine;
  const renderedEndLine = lineIndexOffset + localEndLine;
  const renderedEntireBlock =
    !continuesFromPrev && !continuesOnNext && renderedStartLine === 0 && renderedEndLine >= originalLineCount;
  if (renderedEntireBlock && measure.totalHeight && measure.totalHeight > renderedHeight) {
    renderedHeight = measure.totalHeight;
  }

  let afterHeight = 0;
  if (spacingPolicy && renderedEntireBlock && !spacingPolicy.isLastBlock) {
    const spacingAfter = block.attrs?.spacing?.after;
    if (typeof spacingAfter === 'number' && spacingAfter > 0) {
      frameEl.style.marginBottom = `${spacingAfter}px`;
      afterHeight = spacingAfter;
    }
  }

  if (renderedHeight > 0) {
    frameEl.style.height = `${renderedHeight}px`;
  }
  renderParagraphPropertyTrackedChangeMarker(doc, frameEl, block);

  return {
    renderedHeight,
    totalHeight: beforeHeight + renderedHeight + afterHeight,
    renderedLines: renderResult.renderedLines,
  };
}

const getRenderedContentLines = (params: RenderParagraphContentParams): Line[] => {
  if (params.resolvedContent) {
    return params.resolvedContent.lines.map((line) => line.line);
  }

  const lines = params.linesOverride ?? params.measure.lines ?? [];
  return lines.slice(params.localStartLine, Math.min(params.localEndLine, lines.length));
};

const applyBlockSdtChromeBounds = (
  element: HTMLElement,
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  lines: Line[],
  fragmentWidth: number,
  lineIndexBase: number,
  fragmentContinuesFromPrev: boolean | undefined,
  fragmentContinuesOnNext: boolean | undefined,
  sdtBoundary: SdtBoundaryOptions | undefined,
  content?: ResolvedParagraphContent,
): void => {
  const sdt = getSdtContainerMetadata(block.attrs?.sdt, block.attrs?.containerSdt);
  if (!isStructuredContentMetadata(sdt) || sdt.scope !== 'block') return;
  if (fragmentContinuesFromPrev || fragmentContinuesOnNext) return;
  if (sdtBoundary && ((sdtBoundary.isStart ?? true) === false || (sdtBoundary.isEnd ?? true) === false)) return;

  const sourceLineCount = Math.max(measure.lines?.length ?? 0, content?.lines.length ?? 0, lines.length);
  if (sourceLineCount > 1) return;

  const expandedBlock = { ...block, runs: expandRunsForInlineNewlines(block.runs) };
  let contentLeft = Number.POSITIVE_INFINITY;
  let contentRight = Number.NEGATIVE_INFINITY;

  for (const [index, line] of lines.entries()) {
    const runsForLine = sliceRunsForLine(expandedBlock, line);
    if (runsForLine.length === 0) continue;

    let hasVisibleContent = false;
    for (const run of runsForLine) {
      if (run.kind === 'lineBreak' || run.kind === 'break') continue;
      if (isEmptySdtPlaceholderRun(run)) {
        hasVisibleContent = true;
        break;
      }
      if ((run.kind === 'text' || run.kind === undefined) && 'text' in run) {
        if ((run.text ?? '').trim().length === 0) continue;
      }
      hasVisibleContent = true;
      break;
    }

    if (!hasVisibleContent) continue;

    const lineWidth = Math.max(0, line.naturalWidth ?? line.width ?? 0);
    if (lineWidth <= 0) continue;
    const inlineSdtChromeWidth = hasExplicitSegmentPositioning(line) ? 0 : getInlineSdtChromeExtraWidth(runsForLine);

    const resolvedLine = content?.lines[index];
    const lineIndex = resolvedLine?.lineIndex ?? lineIndexBase + index;
    const lineOffset = resolveBlockSdtChromeLineOffset(block, line, resolvedLine, lineIndex);
    const availableWidth = resolveBlockSdtChromeAvailableWidth(block, line, fragmentWidth, lineOffset, resolvedLine);
    const paintedLineWidth = resolveBlockSdtChromePaintedLineWidth(
      block,
      line,
      lineWidth,
      availableWidth,
      index,
      lines.length,
      fragmentContinuesOnNext,
      resolvedLine,
      content,
    );
    const paintedLineWidthWithChrome = paintedLineWidth + inlineSdtChromeWidth;
    const alignmentSlack = Math.max(0, availableWidth - paintedLineWidthWithChrome);
    const alignment = resolveTextAlign(block.attrs?.alignment, getParagraphInlineDirection(block.attrs) === 'rtl');
    const lineLeft =
      lineOffset + (alignment === 'center' ? alignmentSlack / 2 : alignment === 'right' ? alignmentSlack : 0);
    contentLeft = Math.min(contentLeft, lineLeft);
    contentRight = Math.max(contentRight, lineLeft + paintedLineWidthWithChrome);
  }

  if (!Number.isFinite(contentLeft) || !Number.isFinite(contentRight)) return;

  const chromeLeft = Math.max(0, contentLeft);
  const chromeWidth = Math.max(0, Math.min(fragmentWidth, contentRight) - chromeLeft);
  if (chromeWidth <= 0 || chromeWidth >= fragmentWidth) return;

  element.style.setProperty('--sd-sdt-chrome-left', `${chromeLeft}px`);
  element.style.setProperty('--sd-sdt-chrome-width', `${chromeWidth}px`);
};

const getInlineSdtChromeExtraWidth = (runs: Run[]): number => {
  let wrapperCount = 0;
  let currentSdtId: string | null = null;

  for (const run of runs) {
    const sdt = 'sdt' in run ? run.sdt : undefined;
    const sdtId =
      sdt?.type === 'structuredContent' && sdt.scope === 'inline' && sdt.id && sdt.appearance !== 'hidden'
        ? String(sdt.id)
        : null;

    if (sdtId !== currentSdtId) {
      if (sdtId) wrapperCount += 1;
      currentSdtId = sdtId;
    }
  }

  return wrapperCount * INLINE_SDT_CHROME_EXTRA_WIDTH_PX;
};

const resolveBlockSdtChromeLineOffset = (
  block: ParagraphBlock,
  line: Line,
  resolvedLine: ResolvedParagraphContent['lines'][number] | undefined,
  lineIndex: number,
): number => {
  if (resolvedLine) {
    if (resolvedLine.isListFirstLine) {
      return resolvedLine.resolvedListTextStartPx ?? resolvedLine.indentOffset;
    }
    if (resolvedLine.hasExplicitSegmentPositioning) {
      return resolvedLine.indentOffset;
    }
    return Math.max(0, resolvedLine.paddingLeftPx + resolvedLine.textIndentPx);
  }

  const paraIndent = block.attrs?.indent;
  const indentLeft = paraIndent?.left ?? 0;
  const firstLine = paraIndent?.firstLine ?? 0;
  const hanging = paraIndent?.hanging ?? 0;
  const suppressFirstLineIndent = block.attrs?.suppressFirstLineIndent === true;
  const firstLineOffset = suppressFirstLineIndent ? 0 : firstLine - hanging;
  const isFirstLine = lineIndex === 0;
  const lineHasExplicitSegmentPositioning = line.segments?.some((segment) => segment.x !== undefined) === true;

  if (lineHasExplicitSegmentPositioning) {
    const effectiveLeftIndent = indentLeft < 0 ? 0 : indentLeft;
    return Math.max(0, effectiveLeftIndent + (isFirstLine ? firstLineOffset : 0));
  }

  if (isFirstLine) {
    return Math.max(0, indentLeft + firstLineOffset);
  }
  if (indentLeft > 0) {
    return indentLeft;
  }
  if (hanging > 0 && indentLeft >= 0) {
    return hanging;
  }
  return 0;
};

const resolveBlockSdtChromeAvailableWidth = (
  block: ParagraphBlock,
  line: Line,
  fragmentWidth: number,
  lineOffset: number,
  resolvedLine: ResolvedParagraphContent['lines'][number] | undefined,
): number => {
  if (resolvedLine) {
    return Math.max(0, resolvedLine.availableWidth);
  }

  const rightIndent = Math.max(0, block.attrs?.indent?.right ?? 0);
  const fallbackAvailableWidth = Math.max(0, fragmentWidth - lineOffset - rightIndent);
  if (line.maxWidth != null) {
    return Math.min(line.maxWidth, fallbackAvailableWidth);
  }
  return fallbackAvailableWidth;
};

const resolveBlockSdtChromePaintedLineWidth = (
  block: ParagraphBlock,
  line: Line,
  lineWidth: number,
  availableWidth: number,
  fragmentLineIndex: number,
  fragmentLineCount: number,
  fragmentContinuesOnNext: boolean | undefined,
  resolvedLine: ResolvedParagraphContent['lines'][number] | undefined,
  content: ResolvedParagraphContent | undefined,
): number => {
  const explicitPositionedSegmentCount = line.segments?.filter((segment) => segment.x !== undefined).length ?? 0;
  const hasMultipleExplicitPositionedSegments = explicitPositionedSegmentCount > 1;
  const paragraphEndsWithLineBreak =
    content?.paragraphEndsWithLineBreak === true || block.runs[block.runs.length - 1]?.kind === 'lineBreak';
  const isLastLineOfParagraph =
    resolvedLine != null
      ? resolvedLine.skipJustify
      : fragmentLineIndex === fragmentLineCount - 1 && !fragmentContinuesOnNext;
  const justifyShouldApply = shouldApplyJustify({
    alignment: block.attrs?.alignment,
    hasExplicitPositioning: line.segments?.some((segment) => segment.x !== undefined) === true,
    hasExplicitTabStops: line.hasExplicitTabStops === true,
    justifyAfterHangingTab: line.justifyAfterHangingTab === true,
    isLastLineOfParagraph,
    paragraphEndsWithLineBreak,
    skipJustifyOverride: (resolvedLine?.skipJustify ?? false) || hasMultipleExplicitPositionedSegments,
  });

  return justifyShouldApply ? Math.max(lineWidth, availableWidth) : lineWidth;
};

function* renderResolvedLines(
  params: RenderParagraphContentParams & { resolvedContent: ResolvedParagraphContent },
): RenderWork<{ renderedHeight: number; renderedLines: RenderedParagraphLineInfo[] }> {
  const {
    frameEl,
    block,
    resolvedContent: content,
    markerTextWidth,
    renderLine,
    captureLineSnapshot,
    convertFinalParagraphMark,
    lineTopOffset = 0,
    sourceAnchor,
    resolvePhysical = (css) => resolvePhysicalFamily(css),
  } = params;
  const renderedLines: RenderedParagraphLineInfo[] = [];
  const resolvedMarker = content.marker;
  const expandedRunsForBlock = expandRunsForInlineNewlines(block.runs);
  const isRtl = getParagraphInlineDirection(block.attrs) === 'rtl';
  const trackedChangesConfig = resolveTrackedChangesConfig(block);
  let renderedHeight = 0;

  for (const [index, resolvedLine] of content.lines.entries()) {
    yield;
    const paragraphMarkLeftOffset = resolveResolvedListParagraphMarkOffset(
      resolvedLine.isListFirstLine ? resolvedMarker : undefined,
      markerTextWidth,
      resolvedLine.indentOffset,
      resolvedLine.resolvedListTextStartPx,
    );
    const lineEl = yield* resolveRenderWork(
      renderLine({
        block,
        line: resolvedLine.line,
        lineIndex: resolvedLine.lineIndex,
        isLastLine: index === content.lines.length - 1 && !content.continuesOnNext,
        availableWidth: resolvedLine.availableWidth,
        skipJustify: resolvedLine.skipJustify,
        preExpandedRuns: expandedRunsForBlock,
        resolvedListTextStartPx: resolvedLine.resolvedListTextStartPx,
        indentOffsetOverride: resolvedLine.indentOffset,
        paragraphMarkLeftOffsetOverride: paragraphMarkLeftOffset,
      }),
    );

    if (!resolvedLine.isListFirstLine) {
      applyResolvedLineIndentation(lineEl, block, content, resolvedLine);
    }
    if (resolvedLine.paddingRightPx > 0) {
      lineEl.style.paddingRight = `${resolvedLine.paddingRightPx}px`;
    }
    if (index === 0 && !content.continuesFromPrev) {
      placeParagraphPropertyTrackedChangeMarker({
        block,
        frameEl,
        lineEl,
        line: resolvedLine.line,
        fragmentWidth: params.width,
        availableWidth: resolvedLine.availableWidth,
        contentWidth: resolvedLine.line.naturalWidth ?? resolvedLine.line.width,
      });
    }
    if (resolvedLine.isListFirstLine && resolvedMarker) {
      renderResolvedListMarker({
        doc: params.doc,
        lineEl,
        marker: resolvedMarker,
        isRtl,
        sourceAnchor,
        resolvePhysical,
        trackedChangesConfig,
      });
    }
    if (convertFinalParagraphMark && index === content.lines.length - 1 && !content.continuesOnNext) {
      convertParagraphMarkToCellMark(lineEl);
    }
    if (index === content.lines.length - 1 && !content.continuesOnNext) {
      applyParagraphMarkGlyphTrackedChange(lineEl, block.attrs?.paragraphMarkTrackedChange, block);
    }
    captureLineSnapshot?.(lineEl, {
      inTableParagraph: params.containerKind === 'table-cell',
      wrapperEl: frameEl,
      sourceAnchor,
    });
    frameEl.appendChild(lineEl);
    const height = resolvedLine.line.lineHeight;
    renderedLines.push({ el: lineEl, top: lineTopOffset + renderedHeight, height });
    renderedHeight += height;
  }

  return { renderedHeight, renderedLines };
}

function* renderMeasuredLines(
  params: RenderParagraphContentParams,
): RenderWork<{ renderedHeight: number; renderedLines: RenderedParagraphLineInfo[] }> {
  const {
    doc,
    frameEl,
    block,
    measure,
    containerKind,
    width,
    localStartLine,
    localEndLine,
    linesOverride,
    lineIndexOffset = 0,
    continuesFromPrev,
    continuesOnNext,
    markerWidth,
    markerTextWidth,
    wordLayout,
    renderLine,
    captureLineSnapshot,
    convertFinalParagraphMark,
    lineTopOffset = 0,
    sourceAnchor,
    resolvePhysical = (css) => resolvePhysicalFamily(css),
  } = params;
  const lines = linesOverride ?? measure.lines ?? [];
  const paraIndent = block.attrs?.indent;
  const paraIndentLeft = paraIndent?.left ?? 0;
  const paraIndentRight = paraIndent?.right ?? 0;
  const isRtl = getParagraphInlineDirection(block.attrs) === 'rtl';
  const {
    anchorIndentPx: paraMarkerAnchorIndent,
    firstLinePx: markerFirstLine,
    hangingPx: markerHanging,
  } = resolveMarkerIndent(paraIndent, isRtl);
  const wordLayoutIndentLeft = (wordLayout as { indentLeftPx?: number } | undefined)?.indentLeftPx;
  const tableMarkerIndentLeft =
    measure.marker?.indentLeft ?? wordLayoutIndentLeft ?? (typeof paraIndent?.left === 'number' ? paraIndent.left : 0);
  const suppressFirstLineIndent = block.attrs?.suppressFirstLineIndent === true;
  const firstLineOffset = suppressFirstLineIndent ? 0 : (paraIndent?.firstLine ?? 0) - (paraIndent?.hanging ?? 0);
  const expandedRunsForBlock = containerKind === 'body-fragment' ? expandRunsForInlineNewlines(block.runs) : undefined;
  const runsForTextGeometry = expandedRunsForBlock ?? expandRunsForInlineNewlines(block.runs);
  const lastRun = block.runs.length > 0 ? block.runs[block.runs.length - 1] : null;
  const paragraphEndsWithLineBreak = lastRun?.kind === 'lineBreak';
  const markerLayout = wordLayout?.marker;
  const markerMeasure = measure.marker;
  const trackedChangesConfig = resolveTrackedChangesConfig(block);

  const legacyMarkerWidth = markerWidth ?? markerMeasure?.markerWidth;
  const legacyMarkerTextWidth = markerTextWidth ?? markerMeasure?.markerTextWidth;
  const listFirstLineTextStartPx =
    !continuesFromPrev && legacyMarkerWidth && markerLayout && markerMeasure
      ? resolvePainterListTextStartPx({
          wordLayout,
          indentLeftPx: containerKind === 'table-cell' ? tableMarkerIndentLeft : paraMarkerAnchorIndent,
          hangingIndentPx: markerHanging,
          firstLineIndentPx: markerFirstLine,
          markerTextWidthPx: legacyMarkerTextWidth,
        })
      : undefined;

  let renderedHeight = 0;
  const renderedLines: RenderedParagraphLineInfo[] = [];
  const renderedLocalEndLine = Math.min(localEndLine, lines.length);

  for (let lineIdx = localStartLine; lineIdx < localEndLine && lineIdx < lines.length; lineIdx++) {
    yield;
    const line = lines[lineIdx];
    const explicitSegmentPositioning = hasExplicitSegmentPositioning(line);
    const lineRuns = sliceRunsForLine({ ...block, runs: runsForTextGeometry }, line);
    const positionedTextGeometry = usesPositionedTextGeometry(line, lineRuns, isRtl);
    const isFirstLine = lineIdx === 0 && !continuesFromPrev;
    const isListFirstLine = Boolean(lineIdx === 0 && !continuesFromPrev && legacyMarkerWidth && markerLayout);
    const shouldUseResolvedListTextStart =
      isListFirstLine && explicitSegmentPositioning && listFirstLineTextStartPx != null;
    const globalLineIndex = lineIndexOffset + lineIdx;
    const isLastLineOfParagraph =
      (linesOverride
        ? lineIdx === renderedLocalEndLine - 1
        : globalLineIndex === (measure.lines?.length ?? lines.length) - 1) && !continuesOnNext;
    const shouldSkipJustifyForLastLine = isLastLineOfParagraph && !paragraphEndsWithLineBreak;
    const availableWidth =
      containerKind === 'body-fragment'
        ? resolveAvailableWidthForLine({
            containerWidth: width,
            line,
            indentLeftPx: paraIndentLeft,
            indentRightPx: paraIndentRight,
            firstLineOffset,
            isFirstLine,
            isListFirstLine,
            resolvedListTextStartPx: shouldUseResolvedListTextStart ? listFirstLineTextStartPx : undefined,
          })
        : undefined;
    const lineEl = yield* resolveRenderWork(
      renderLine({
        block,
        line,
        lineIndex: globalLineIndex,
        isLastLine: isLastLineOfParagraph,
        availableWidth,
        skipJustify: shouldSkipJustifyForLastLine,
        preExpandedRuns: expandedRunsForBlock,
        resolvedListTextStartPx: shouldUseResolvedListTextStart ? listFirstLineTextStartPx : undefined,
      }),
    );
    lineEl.style.paddingLeft = '';
    lineEl.style.paddingRight = '';
    lineEl.style.textIndent = '';

    if (convertFinalParagraphMark && isLastLineOfParagraph) {
      convertParagraphMarkToCellMark(lineEl);
    }
    if (isLastLineOfParagraph) {
      applyParagraphMarkGlyphTrackedChange(lineEl, block.attrs?.paragraphMarkTrackedChange, block);
    }

    if (isListFirstLine && markerLayout && markerMeasure) {
      if (paraIndentRight > 0) {
        lineEl.style.paddingRight = `${paraIndentRight}px`;
      }
      renderLegacyListMarker({
        doc,
        lineEl,
        wordLayout,
        markerLayout,
        markerMeasure,
        markerTextWidthPx: legacyMarkerTextWidth,
        indentLeftPx: containerKind === 'table-cell' ? tableMarkerIndentLeft : paraMarkerAnchorIndent,
        hangingIndentPx: markerHanging,
        firstLineIndentPx: markerFirstLine,
        isRtl,
        sourceAnchor,
        resolvePhysical,
        trackedChangesConfig,
      });
    } else {
      applyParagraphLineIndentation({
        lineEl,
        line,
        indent: paraIndent,
        indentLeftPx: containerKind === 'table-cell' ? tableMarkerIndentLeft : paraMarkerAnchorIndent,
        hasListMarkerLayout: Boolean(markerLayout),
        lineIndex: lineIdx,
        localStartLine,
        continuesFromPrev,
        suppressFirstLineIndent,
        resetContinuationTextIndent: containerKind === 'body-fragment',
        positionedTextGeometry,
      });
    }

    if (lineIdx === localStartLine && !continuesFromPrev) {
      placeParagraphPropertyTrackedChangeMarker({
        block,
        frameEl,
        lineEl,
        line,
        fragmentWidth: width,
        availableWidth,
        contentWidth: line.naturalWidth ?? line.width,
      });
    }

    captureLineSnapshot?.(lineEl, {
      inTableParagraph: containerKind === 'table-cell',
      wrapperEl: frameEl,
      sourceAnchor,
    });
    frameEl.appendChild(lineEl);
    const height = line.lineHeight;
    renderedLines.push({ el: lineEl, top: lineTopOffset + renderedHeight, height });
    renderedHeight += height;
  }

  return { renderedHeight, renderedLines };
}

const renderParagraphDropCap = (params: {
  frameEl: HTMLElement;
  block: ParagraphBlock;
  measure: ParagraphMeasure;
  resolvedContent?: ResolvedParagraphContent;
  continuesFromPrev?: boolean;
  renderDropCap?: ParagraphRenderDropCap;
}): void => {
  const { frameEl, block, measure, resolvedContent, continuesFromPrev, renderDropCap } = params;
  if (!renderDropCap) return;
  if (resolvedContent?.dropCap) {
    const dc = resolvedContent.dropCap;
    const dropCapEl = renderDropCap(
      {
        mode: dc.mode,
        run: {
          text: dc.text,
          fontFamily: dc.fontFamily,
          fontSize: dc.fontSize,
          bold: dc.bold,
          italic: dc.italic,
          color: dc.color,
          position: dc.position,
        },
        lines: 0,
      },
      dc.width != null && dc.height != null
        ? { width: dc.width, height: dc.height, lines: 0, mode: dc.mode }
        : undefined,
    );
    frameEl.appendChild(dropCapEl);
    return;
  }
  const dropCapDescriptor = block.attrs?.dropCapDescriptor;
  const dropCapMeasure = measure.dropCap;
  if (dropCapDescriptor && dropCapMeasure && !continuesFromPrev) {
    frameEl.appendChild(renderDropCap(dropCapDescriptor, dropCapMeasure));
  }
};

const applyResolvedLineIndentation = (
  lineEl: HTMLElement,
  block: ParagraphBlock,
  content: ResolvedParagraphContent,
  resolvedLine: ResolvedParagraphContent['lines'][number],
): void => {
  if (resolvedLine.paddingLeftPx > 0) {
    lineEl.style.paddingLeft = `${resolvedLine.paddingLeftPx}px`;
  }
  if (resolvedLine.textIndentPx !== 0) {
    lineEl.style.textIndent = `${resolvedLine.textIndentPx}px`;
  } else if (resolvedLine.lineIndex > 0 || content.continuesFromPrev) {
    const paraIndent = block.attrs?.indent;
    const suppressFirstLineIndent = block.attrs?.suppressFirstLineIndent === true;
    const firstLineOffset = suppressFirstLineIndent ? 0 : (paraIndent?.firstLine ?? 0) - (paraIndent?.hanging ?? 0);
    if (firstLineOffset && !resolvedLine.isListFirstLine) {
      lineEl.style.textIndent = '0px';
    }
  }
};

const resolveResolvedListParagraphMarkOffset = (
  marker: ResolvedParagraphContent['marker'] | undefined,
  markerTextWidth: number | undefined,
  indentOffset: number,
  resolvedListTextStartPx: number | undefined,
): number | undefined => {
  if (!marker) return undefined;
  if (typeof resolvedListTextStartPx === 'number' && Number.isFinite(resolvedListTextStartPx)) {
    return resolvedListTextStartPx;
  }
  if (typeof indentOffset === 'number' && Number.isFinite(indentOffset) && indentOffset > 0) {
    return indentOffset;
  }
  if (marker.vanish) {
    return indentOffset;
  }

  const paddingLeft = Number.isFinite(marker.firstLinePaddingLeftPx) ? marker.firstLinePaddingLeftPx : 0;
  const suffixWidth = marker.suffix !== 'nothing' && Number.isFinite(marker.suffixWidthPx) ? marker.suffixWidthPx : 0;

  if (marker.justification === 'left') {
    const markerWidth =
      typeof markerTextWidth === 'number' && Number.isFinite(markerTextWidth) && markerTextWidth > 0
        ? markerTextWidth
        : 0;
    return paddingLeft + markerWidth + suffixWidth;
  }

  const centerPadding =
    marker.justification === 'center' && Number.isFinite(marker.centerPaddingAdjustPx)
      ? (marker.centerPaddingAdjustPx ?? 0)
      : 0;
  return paddingLeft + centerPadding + suffixWidth;
};

const convertParagraphMarkToCellMark = (lineEl: HTMLElement): void => {
  const mark = lineEl.querySelector<HTMLElement>('.superdoc-formatting-paragraph-mark');
  if (!mark) return;

  mark.classList.add('superdoc-formatting-cell-mark');
  mark.textContent = '¤';
};

export const renderParagraphContent = (params: RenderParagraphContentParams): RenderParagraphContentResult =>
  completeRenderWork(renderParagraphContentWork(params));
