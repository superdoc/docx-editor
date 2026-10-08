import { completeRenderWork, type RenderWork } from '../render-work.js';
import type {
  DropCapDescriptor,
  ParaFragment,
  ParagraphBlock,
  ParagraphMeasure,
  ResolvedFragmentItem,
  SdtMetadata,
} from '@superdoc/contracts';
import { isMinimalWordLayout as isMinimalWordLayoutShared } from '@superdoc/common/list-marker-utils';
import type { MinimalWordLayout } from '@superdoc/common/list-marker-utils';
import { resolvePhysicalFamily, type ResolvePhysicalFamily } from '@superdoc/font-system';
import { DOM_CLASS_NAMES } from '@superdoc/dom-contract';
import { CLASS_NAMES, fragmentStyles } from '../styles.js';
import { shouldRenderSdtContainerChrome, type SdtBoundaryOptions } from '../sdt/container.js';
import { allowFontSynthesis } from '../runs/font-synthesis.js';
import type { BetweenBorderInfo } from './borders/index.js';
import { renderParagraphContentWork, type ParagraphRenderLineInput } from './renderParagraphContent.js';

type ApplyStyles = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => void;

type RenderParagraphFragmentParams = {
  doc: Document | null;
  fragment: ParaFragment;
  sdtBoundary?: SdtBoundaryOptions;
  betweenInfo?: BetweenBorderInfo;
  resolvedItem?: ResolvedFragmentItem;
  applyStyles: ApplyStyles;
  applyResolvedFragmentFrame: (el: HTMLElement, item: ResolvedFragmentItem, fragment: ParaFragment) => void;
  applyFragmentFrame: (el: HTMLElement, fragment: ParaFragment) => void;
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  applyContainerSdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  renderLine: (input: ParagraphRenderLineInput) => HTMLElement | RenderWork<HTMLElement>;
  captureLineSnapshot: (
    lineEl: HTMLElement,
    options?: { sourceAnchor?: ResolvedFragmentItem['sourceAnchor']; wrapperEl?: HTMLElement },
  ) => void;
  createErrorPlaceholder: (blockId: string, error: unknown) => HTMLElement;
  contentControlsChrome?: 'default' | 'none';
  /**
   * Per-document logical->physical font resolver for the drop cap and list markers. Threaded from
   * the renderer's per-document resolver so they paint the same physical family they were measured
   * in. Undefined falls back to the global resolver, matching text runs and field annotations.
   */
  resolvePhysical?: ResolvePhysicalFamily;
};

const isMinimalWordLayout = (value: unknown): value is MinimalWordLayout => isMinimalWordLayoutShared(value);

export function* renderParagraphFragmentWork(params: RenderParagraphFragmentParams): RenderWork<HTMLElement> {
  const {
    doc,
    fragment,
    sdtBoundary,
    betweenInfo,
    resolvedItem,
    applyStyles,
    applyResolvedFragmentFrame,
    applyFragmentFrame,
    applySdtDataset,
    applyContainerSdtDataset,
    renderLine,
    captureLineSnapshot,
    createErrorPlaceholder,
    contentControlsChrome,
    resolvePhysical = (css) => resolvePhysicalFamily(css),
  } = params;

  try {
    if (!doc) {
      throw new Error('DomPainter: document is not available');
    }

    if (resolvedItem?.block?.kind !== 'paragraph' || resolvedItem?.measure?.kind !== 'paragraph') {
      throw new Error(`DomPainter: missing resolved paragraph block/measure for fragment ${fragment.blockId}`);
    }
    const block = resolvedItem.block as ParagraphBlock;
    const measure = resolvedItem.measure as ParagraphMeasure;
    const wordLayout = isMinimalWordLayout(block.attrs?.wordLayout) ? block.attrs.wordLayout : undefined;
    const content = resolvedItem?.content;

    const paraContinuesFromPrev = resolvedItem?.continuesFromPrev;
    const paraContinuesOnNext = resolvedItem?.continuesOnNext;
    const paraMarkerWidth = resolvedItem?.markerWidth;

    const fragmentEl = doc.createElement('div');
    fragmentEl.classList.add(CLASS_NAMES.fragment);

    const isTocEntry = block.attrs?.isTocEntry;
    const hasMarker = !paraContinuesFromPrev && paraMarkerWidth && wordLayout?.marker;
    const hasSdtContainer = shouldRenderSdtContainerChrome(block.attrs?.sdt, block.attrs?.containerSdt);
    const paraIndentForOverflow = block.attrs?.indent;
    const hasNegativeIndent = (paraIndentForOverflow?.left ?? 0) < 0 || (paraIndentForOverflow?.right ?? 0) < 0;
    const styles = isTocEntry
      ? { ...fragmentStyles, whiteSpace: 'nowrap' }
      : hasMarker || hasSdtContainer || hasNegativeIndent
        ? { ...fragmentStyles, overflow: 'visible' }
        : fragmentStyles;
    applyStyles(fragmentEl, styles);
    if (resolvedItem) {
      applyResolvedFragmentFrame(fragmentEl, resolvedItem, fragment);
    } else {
      applyFragmentFrame(fragmentEl, fragment);
    }

    if (isTocEntry) {
      fragmentEl.classList.add(DOM_CLASS_NAMES.TOC_ENTRY);
      const tocId = block.attrs?.tocId;
      if (typeof tocId === 'string' && tocId.length > 0) {
        fragmentEl.dataset.tocId = tocId;
      }
    }

    if (paraContinuesFromPrev) {
      fragmentEl.dataset.continuesFromPrev = 'true';
    }
    if (paraContinuesOnNext) {
      fragmentEl.dataset.continuesOnNext = 'true';
    }

    const lines = fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine);
    yield* renderParagraphContentWork({
      doc,
      frameEl: fragmentEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: fragment.width,
      localStartLine: 0,
      localEndLine: lines.length,
      lineIndexOffset: fragment.fromLine,
      linesOverride: lines,
      continuesFromPrev: paraContinuesFromPrev,
      continuesOnNext: paraContinuesOnNext,
      markerWidth: paraMarkerWidth,
      markerTextWidth: fragment.markerTextWidth,
      wordLayout,
      resolvedContent: content,
      betweenInfo,
      sdtBoundary,
      applySdtDataset,
      applyContainerSdtDataset,
      resolvePhysical,
      renderDropCap: (descriptor, dropCapMeasure) => renderDropCap(doc, descriptor, dropCapMeasure, resolvePhysical),
      renderLine,
      captureLineSnapshot: (lineEl, options) => {
        captureLineSnapshot(lineEl, {
          sourceAnchor: options?.sourceAnchor,
          wrapperEl: fragmentEl,
        });
      },
      sourceAnchor: resolvedItem?.sourceAnchor,
      contentControlsChrome,
    });

    return fragmentEl;
  } catch (error) {
    return createErrorPlaceholder(fragment.blockId, error);
  }
}

const renderDropCap = (
  doc: Document,
  descriptor: DropCapDescriptor,
  measure: ParagraphMeasure['dropCap'],
  resolvePhysical: ResolvePhysicalFamily = (css) => resolvePhysicalFamily(css),
): HTMLElement => {
  const { run, mode } = descriptor;

  const dropCapEl = doc.createElement('span');
  dropCapEl.classList.add('superdoc-drop-cap');
  dropCapEl.textContent = run.text;

  // Paint the physical render family (a per-document fonts.map or the bundled substitute) - the
  // same family the drop cap was measured in, so its box matches the laid-out geometry. Resolve for
  // the drop cap's ACTUAL face so a single-face substitute is not mis-mapped. Defaults to the global
  // resolver when no per-document resolver is present (e.g. tests).
  dropCapEl.style.fontFamily = resolvePhysical(run.fontFamily, {
    weight: run.bold ? '700' : '400',
    style: run.italic ? 'italic' : 'normal',
  });
  dropCapEl.style.fontSize = `${run.fontSize}px`;
  allowFontSynthesis(dropCapEl);
  if (run.bold) {
    dropCapEl.style.fontWeight = 'bold';
  }
  if (run.italic) {
    dropCapEl.style.fontStyle = 'italic';
  }
  if (run.color) {
    dropCapEl.style.color = run.color;
  }

  if (mode === 'drop') {
    dropCapEl.style.float = 'left';
    dropCapEl.style.marginRight = '4px';
    dropCapEl.style.lineHeight = '1';
  } else if (mode === 'margin') {
    dropCapEl.style.position = 'absolute';
    dropCapEl.style.left = '0';
    dropCapEl.style.lineHeight = '1';
  }

  if (run.position && run.position !== 0) {
    dropCapEl.style.position = dropCapEl.style.position || 'relative';
    dropCapEl.style.top = `${run.position}px`;
  }

  if (measure) {
    dropCapEl.style.width = `${measure.width}px`;
    dropCapEl.style.height = `${measure.height}px`;
  }

  return dropCapEl;
};

export const renderParagraphFragment = (params: RenderParagraphFragmentParams): HTMLElement =>
  completeRenderWork(renderParagraphFragmentWork(params));
