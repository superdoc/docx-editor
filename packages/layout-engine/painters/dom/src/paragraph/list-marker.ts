import { DOM_CLASS_NAMES } from '@superdoc/dom-contract';
import { toCssFontFamily } from '@superdoc/font-utils';
import { resolvePhysicalFamily, type ResolvePhysicalFamily } from '@superdoc/font-system';
import type { ParagraphMeasure, ResolvedListMarkerItem, SourceAnchor } from '@superdoc/contracts';
import {
  computeTabWidth,
  resolveListMarkerGeometry,
  resolveListTextStartPx,
  type MinimalMarker,
  type MinimalWordLayout,
  type ResolvedListMarkerGeometry,
} from '@superdoc/common/list-marker-utils';
import { applySourceAnchorDataset } from '../utils/source-anchor.js';
import { allowFontSynthesis } from '../runs/font-synthesis.js';
import { applyMarkerTrackedChange, type MarkerTrackedChangeView } from './marker-tracked-change.js';
import type { TrackedChangesRenderConfig } from '../runs/types.js';

type PainterListTextStartParams = {
  wordLayout: MinimalWordLayout | undefined;
  indentLeftPx: number;
  hangingIndentPx: number;
  firstLineIndentPx: number;
  markerTextWidthPx?: number;
  markerOffsetX?: number;
};

const getFiniteNonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
};

const resolvePainterMarkerTextWidth = (
  markerTextWidthPx: number | undefined,
  marker: { glyphWidthPx?: number; markerBoxWidthPx?: number },
): number =>
  getFiniteNonNegativeNumber(markerTextWidthPx) ??
  getFiniteNonNegativeNumber(marker.glyphWidthPx) ??
  getFiniteNonNegativeNumber(marker.markerBoxWidthPx) ??
  0;

export const resolvePainterListMarkerGeometry = ({
  wordLayout,
  indentLeftPx,
  hangingIndentPx,
  firstLineIndentPx,
  markerTextWidthPx,
  markerOffsetX = 0,
}: PainterListTextStartParams): ResolvedListMarkerGeometry | undefined =>
  resolveListMarkerGeometry(
    wordLayout,
    indentLeftPx,
    firstLineIndentPx,
    hangingIndentPx,
    (_markerText: string, marker: MinimalMarker) => resolvePainterMarkerTextWidth(markerTextWidthPx, marker),
    markerOffsetX,
  );

export const resolvePainterListTextStartPx = ({
  wordLayout,
  indentLeftPx,
  hangingIndentPx,
  firstLineIndentPx,
  markerTextWidthPx,
}: PainterListTextStartParams): number | undefined =>
  resolveListTextStartPx(
    wordLayout,
    indentLeftPx,
    firstLineIndentPx,
    hangingIndentPx,
    (_markerText: string, marker: MinimalMarker) => resolvePainterMarkerTextWidth(markerTextWidthPx, marker),
  );

type MarkerRunStyle = {
  fontFamily?: string | null;
  fontSize?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  color?: string | null;
  letterSpacing?: number | null;
  vanish?: boolean | null;
  // SD-2656: caps marks from the level rPr. allCaps -> "FIRST" (uppercase);
  // smallCaps -> small-caps. Without these the legal list markers render as
  // plain "First" / "Second" / "Third" instead of Word's "FIRST" / "SECOND".
  allCaps?: boolean | null;
  smallCaps?: boolean | null;
};

const isMarkerSuffix = (suffix: unknown): suffix is 'tab' | 'space' | 'nothing' =>
  suffix === 'tab' || suffix === 'space' || suffix === 'nothing';

const applyNegativeInlineMarkerAnchor = (
  lineEl: HTMLElement,
  inlinePrefix: HTMLElement | undefined,
  anchor: number,
  isRtl?: boolean,
): void => {
  if (!(anchor < 0)) return;
  if (!inlinePrefix) {
    inlinePrefix = lineEl.ownerDocument.createElement('span');
    inlinePrefix.classList.add('superdoc-marker-suffix-nothing');
    inlinePrefix.style.display = 'inline-block';
    inlinePrefix.style.width = '0px';
    lineEl.prepend(inlinePrefix);
  }
  if (isRtl) {
    inlinePrefix.style.marginRight = `${anchor}px`;
  } else {
    inlinePrefix.style.marginLeft = `${anchor}px`;
  }
};

export const createListMarkerElement = (
  doc: Document,
  markerText: string,
  run: MarkerRunStyle,
  sourceAnchor?: SourceAnchor,
  resolvePhysical: ResolvePhysicalFamily = (css) => resolvePhysicalFamily(css),
  trackedChange?: MarkerTrackedChangeView,
  trackedChangesConfig?: TrackedChangesRenderConfig,
): HTMLElement => {
  const markerContainer = doc.createElement('span');
  markerContainer.classList.add(DOM_CLASS_NAMES.LIST_MARKER);
  markerContainer.style.display = 'inline-block';
  markerContainer.style.wordSpacing = '0px';

  const markerEl = doc.createElement('span');
  markerEl.classList.add('superdoc-paragraph-marker');
  markerEl.textContent = markerText;
  markerEl.style.pointerEvents = 'none';
  // Compose the Word fallback stack first, then let the resolver swap only the primary family.
  // This keeps Times New Roman -> Liberation Serif on a serif fallback instead of inventing sans-serif.
  const cssFontFamily = toCssFontFamily(run.fontFamily) ?? 'Arial, sans-serif';
  // Resolve for the marker's ACTUAL face so a single-face substitute is not mis-mapped
  // (e.g. a Bold marker on a Regular-only fallback) - matching how the marker text is measured.
  markerEl.style.fontFamily = resolvePhysical(cssFontFamily, {
    weight: run.bold ? '700' : '400',
    style: run.italic ? 'italic' : 'normal',
  });

  if (run.fontSize != null) {
    markerEl.style.fontSize = `${run.fontSize}px`;
  }
  allowFontSynthesis(markerEl);
  markerEl.style.fontWeight = run.bold ? 'bold' : '';
  markerEl.style.fontStyle = run.italic ? 'italic' : '';

  if (run.color) {
    markerEl.style.color = run.color;
  }
  if (run.letterSpacing != null) {
    markerEl.style.letterSpacing = `${run.letterSpacing}px`;
  }
  // SD-2656: caps marks on the level rPr — uppercase for w:caps,
  // small-caps for w:smallCaps. Without these legal/contract markers
  // ("FIRST:", "SECOND:") would render verbatim as "First", "Second".
  if (run.allCaps) {
    markerEl.style.textTransform = 'uppercase';
  } else if (run.smallCaps) {
    markerEl.style.fontVariant = 'small-caps';
  }

  markerContainer.appendChild(markerEl);
  if (sourceAnchor) {
    applySourceAnchorDataset(markerEl, sourceAnchor);
  }
  // Plan 5: stamp marker review metadata + Word-like glyph styling when the
  // marker is affected by a tracked change. Additive — no-op for normal markers.
  applyMarkerTrackedChange(markerEl, trackedChange, trackedChangesConfig);
  return markerContainer;
};

const renderMarkerAtParagraphTextStart = (params: {
  doc: Document;
  lineEl: HTMLElement;
  text: string;
  run: MarkerRunStyle;
  markerStartPx: number;
  textStartPx: number;
  isRtl?: boolean;
  sourceAnchor?: SourceAnchor;
  resolvePhysical?: ResolvePhysicalFamily;
  trackedChange?: MarkerTrackedChangeView;
  trackedChangesConfig?: TrackedChangesRenderConfig;
}): void => {
  const {
    doc,
    lineEl,
    text,
    run,
    markerStartPx,
    textStartPx,
    isRtl,
    sourceAnchor,
    resolvePhysical,
    trackedChange,
    trackedChangesConfig,
  } = params;
  lineEl.style[isRtl ? 'paddingRight' : 'paddingLeft'] = `${Math.max(textStartPx, 0)}px`;
  lineEl.style.textIndent = `${Math.min(textStartPx, 0)}px`;
  if (run.vanish) return;
  const element = createListMarkerElement(
    doc,
    text,
    run,
    sourceAnchor,
    resolvePhysical,
    trackedChange,
    trackedChangesConfig,
  );
  element.style.position = 'absolute';
  element.style.textIndent = '0px';
  element.style[isRtl ? 'right' : 'left'] = `${markerStartPx}px`;
  lineEl.prepend(element);
};

export const renderLegacyListMarker = (params: {
  doc: Document;
  lineEl: HTMLElement;
  wordLayout?: MinimalWordLayout;
  markerLayout: MinimalMarker;
  markerMeasure: ParagraphMeasure['marker'];
  markerTextWidthPx?: number;
  markerOffsetX?: number;
  indentLeftPx: number;
  hangingIndentPx: number;
  firstLineIndentPx: number;
  isRtl?: boolean;
  sourceAnchor?: SourceAnchor;
  resolvePhysical?: ResolvePhysicalFamily;
  trackedChangesConfig?: TrackedChangesRenderConfig;
}): void => {
  const {
    doc,
    lineEl,
    wordLayout,
    markerLayout,
    markerMeasure,
    markerTextWidthPx,
    markerOffsetX = 0,
    indentLeftPx,
    hangingIndentPx,
    firstLineIndentPx,
    isRtl,
    sourceAnchor,
    resolvePhysical = (css) => resolvePhysicalFamily(css),
    trackedChangesConfig,
  } = params;
  const markerTextWidth = markerTextWidthPx ?? markerMeasure?.markerTextWidth ?? 0;
  if (wordLayout?.textStartMode === 'paragraph') {
    const geometry = resolvePainterListMarkerGeometry({
      wordLayout,
      indentLeftPx,
      hangingIndentPx,
      firstLineIndentPx,
      markerTextWidthPx: markerTextWidth,
      markerOffsetX,
    });
    if (geometry) {
      renderMarkerAtParagraphTextStart({
        doc,
        lineEl,
        text: markerLayout.markerText ?? '',
        run: markerLayout.run ?? {},
        markerStartPx: geometry.markerStartPx,
        textStartPx: geometry.textStartPx,
        isRtl,
        sourceAnchor,
        resolvePhysical,
        trackedChange: markerLayout.trackedChange,
        trackedChangesConfig,
      });
      return;
    }
  }
  const shouldUseSharedInlinePrefixGeometry =
    markerLayout?.justification === 'left' &&
    wordLayout?.firstLineIndentMode !== true &&
    typeof markerTextWidth === 'number' &&
    Number.isFinite(markerTextWidth) &&
    markerTextWidth >= 0;
  const markerGeometry = shouldUseSharedInlinePrefixGeometry
    ? resolvePainterListMarkerGeometry({
        wordLayout,
        indentLeftPx,
        hangingIndentPx,
        firstLineIndentPx,
        markerTextWidthPx: markerTextWidth,
        markerOffsetX,
      })
    : undefined;

  const anchorPoint = indentLeftPx - hangingIndentPx + firstLineIndentPx + markerOffsetX;
  const markerJustification = markerLayout?.justification ?? 'left';
  let markerStartPos: number;
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

  const suffix = markerLayout?.suffix ?? 'tab';
  let suffixWidthPx = 0;
  if (markerGeometry && (suffix === 'tab' || suffix === 'space')) {
    suffixWidthPx = markerGeometry.suffixWidthPx;
  } else if (suffix === 'tab') {
    suffixWidthPx = computeTabWidth(
      currentPos,
      markerJustification,
      wordLayout?.tabsPx,
      hangingIndentPx,
      firstLineIndentPx,
      indentLeftPx,
    );
  } else if (suffix === 'space') {
    suffixWidthPx = 4;
  }

  if (isRtl) {
    lineEl.style.paddingRight = `${Math.max(anchorPoint, 0)}px`;
  } else {
    lineEl.style.paddingLeft = `${Math.max(anchorPoint, 0)}px`;
  }

  if ((markerLayout?.run as MarkerRunStyle | undefined)?.vanish) {
    return;
  }

  const markerContainer = createListMarkerElement(
    doc,
    markerLayout?.markerText ?? '',
    markerLayout?.run ?? {},
    sourceAnchor,
    resolvePhysical,
    markerLayout?.trackedChange,
    trackedChangesConfig,
  );
  markerContainer.style.position = 'relative';
  if (markerJustification === 'right') {
    markerContainer.style.position = 'absolute';
    if (isRtl) {
      markerContainer.style.right = `${markerStartPos}px`;
    } else {
      markerContainer.style.left = `${markerStartPos}px`;
    }
  } else if (markerJustification === 'center') {
    markerContainer.style.position = 'absolute';
    if (isRtl) {
      markerContainer.style.right = `${markerStartPos - markerTextWidth / 2}px`;
      lineEl.style.paddingRight = `${parseFloat(lineEl.style.paddingRight || '0') + markerTextWidth / 2}px`;
    } else {
      markerContainer.style.left = `${markerStartPos - markerTextWidth / 2}px`;
      lineEl.style.paddingLeft = `${parseFloat(lineEl.style.paddingLeft || '0') + markerTextWidth / 2}px`;
    }
  }

  const suffixEl = prependMarkerSuffix(
    doc,
    lineEl,
    isMarkerSuffix(suffix) ? suffix : undefined,
    suffixWidthPx,
    markerLayout?.run?.fontSize,
  );
  applyNegativeInlineMarkerAnchor(
    lineEl,
    markerJustification === 'left' ? markerContainer : suffixEl,
    anchorPoint,
    isRtl,
  );
  lineEl.prepend(markerContainer);
};

export const renderResolvedListMarker = (params: {
  doc: Document;
  lineEl: HTMLElement;
  marker: ResolvedListMarkerItem;
  isRtl?: boolean;
  sourceAnchor?: SourceAnchor;
  resolvePhysical?: ResolvePhysicalFamily;
  trackedChangesConfig?: TrackedChangesRenderConfig;
}): void => {
  const { doc, lineEl, marker, isRtl, sourceAnchor, resolvePhysical, trackedChangesConfig } = params;
  if (marker.textStartPx != null && Number.isFinite(marker.textStartPx)) {
    renderMarkerAtParagraphTextStart({
      doc,
      lineEl,
      text: marker.text,
      run: { ...marker.run, vanish: marker.vanish },
      markerStartPx: marker.markerStartPx,
      textStartPx: marker.textStartPx,
      isRtl,
      sourceAnchor: marker.sourceAnchor ?? sourceAnchor,
      resolvePhysical,
      trackedChange: marker.trackedChange,
      trackedChangesConfig,
    });
    return;
  }
  if (isRtl) {
    lineEl.style.paddingRight = `${Math.max(marker.firstLinePaddingLeftPx, 0)}px`;
  } else {
    lineEl.style.paddingLeft = `${Math.max(marker.firstLinePaddingLeftPx, 0)}px`;
  }

  if (marker.vanish) {
    return;
  }

  const markerContainer = createListMarkerElement(
    doc,
    marker.text,
    marker.run,
    marker.sourceAnchor ?? sourceAnchor,
    resolvePhysical,
    marker.trackedChange,
    trackedChangesConfig,
  );
  markerContainer.style.position = 'relative';
  if (marker.justification === 'right') {
    markerContainer.style.position = 'absolute';
    if (isRtl) {
      markerContainer.style.right = `${marker.markerStartPx}px`;
    } else {
      markerContainer.style.left = `${marker.markerStartPx}px`;
    }
  } else if (marker.justification === 'center') {
    markerContainer.style.position = 'absolute';
    const paddingAdjust = marker.centerPaddingAdjustPx ?? 0;
    if (isRtl) {
      markerContainer.style.right = `${marker.markerStartPx - paddingAdjust}px`;
      lineEl.style.paddingRight = `${parseFloat(lineEl.style.paddingRight || '0') + paddingAdjust}px`;
    } else {
      markerContainer.style.left = `${marker.markerStartPx - paddingAdjust}px`;
      lineEl.style.paddingLeft = `${parseFloat(lineEl.style.paddingLeft || '0') + paddingAdjust}px`;
    }
  }

  const suffixEl = prependMarkerSuffix(doc, lineEl, marker.suffix, marker.suffixWidthPx, marker.run.fontSize);
  applyNegativeInlineMarkerAnchor(
    lineEl,
    marker.justification === 'left' ? markerContainer : suffixEl,
    marker.firstLinePaddingLeftPx,
    isRtl,
  );
  lineEl.prepend(markerContainer);
};

const prependMarkerSuffix = (
  doc: Document,
  lineEl: HTMLElement,
  suffix: 'tab' | 'space' | 'nothing' | undefined,
  suffixWidthPx: number,
  fontSize?: number,
): HTMLElement | undefined => {
  if (suffix === 'tab') {
    const tabEl = doc.createElement('span');
    tabEl.classList.add('superdoc-tab', 'superdoc-marker-suffix-tab');
    tabEl.innerHTML = '&nbsp;';
    tabEl.style.display = 'inline-block';
    if (fontSize != null) {
      tabEl.style.fontSize = `${fontSize}px`;
    }
    tabEl.style.wordSpacing = '0px';
    tabEl.style.width = `${suffixWidthPx}px`;
    lineEl.prepend(tabEl);
    return tabEl;
  } else if (suffix === 'space') {
    const spaceEl = doc.createElement('span');
    spaceEl.classList.add('superdoc-marker-suffix-space');
    if (fontSize != null) {
      spaceEl.style.fontSize = `${fontSize}px`;
    }
    spaceEl.style.wordSpacing = '0px';
    spaceEl.textContent = '\u00A0';
    lineEl.prepend(spaceEl);
    return spaceEl;
  }
};
