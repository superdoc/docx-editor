import type {
  ChartDrawing,
  ColumnLayout,
  CustomGeometryData,
  DrawingBlock,
  DrawingFragment,
  DrawingGeometry,
  FlowBlock,
  FlowMode,
  Fragment,
  GradientFill,
  ImageBlock,
  ImageFragment,
  ImageHyperlink,
  Line,
  LineSegment,
  PageMargins,
  PageNumberChapterSeparator,
  PageNumberFormat,
  ParaFragment,
  ParagraphBlock,
  PositionedDrawingGeometry,
  Run,
  ShapeGroupChild,
  ShapeGroupDrawing,
  ShapeEffects,
  ShapeOuterShadowEffect,
  ShapeTextContent,
  SolidFillWithAlpha,
  SourceAnchor,
  TableBlock,
  TableFragment,
  TableMeasure,
  TextboxDrawing,
  VectorShapeDrawing,
  VectorShapeStyle,
  ResolvedLayout,
  ResolvedFragmentItem,
  ResolvedPage,
  ResolvedPaintItem,
  ResolvedTableItem,
  ResolvedImageItem,
  ResolvedDrawingItem,
  LayoutSourceIdentity,
  LayoutStoryLocator,
  ListBlock,
} from '@superdoc/contracts';
import {
  computeLinePmRange,
  LAYOUT_BOUNDARY_SCHEMA,
  buildLayoutSourceIdentityForFragment,
  expandRunsForInlineNewlines,
  formatPageNumber,
  formatSectionPageNumberText,
  getCellSpacingPx,
  getColumnGeometry,
  getColumnSeparatorPositions as getColumnSeparatorPositionsFromGeometry,
  getOuterShadowPaintExtent as getSharedOuterShadowPaintExtent,
  getOuterShadowStdDeviation,
  normalizeColumnLayout,
  normalizeZIndex,
  resolveColumnMode,
  resolveOuterShadowOffset,
} from '@superdoc/contracts';
import { DATASET_KEYS, decodeLayoutStoryDataset, encodeLayoutStoryDataset } from '@superdoc/dom-contract';
import { getPresetShapeSvg } from '@superdoc/preset-geometry';
import { DOM_CLASS_NAMES } from './constants.js';
import { createChartElement as renderChartToElement } from './features/chart/index.js';
import { createRulerElement, ensureRulerStyles, generateRulerDefinitionFromPx } from './ruler/index.js';
import {
  CLASS_NAMES,
  containerStyles,
  containerStylesHorizontal,
  ensureDocumentSurfaceStyles,
  ensureFieldAnnotationStyles,
  ensureFootnoteStyles,
  ensureFormattingMarksStyles,
  ensureImageSelectionStyles,
  ensureLinkStyles,
  ensureMathMencloseStyles,
  ensurePrintStyles,
  ensureSdtContainerStyles,
  ensureTrackChangeStyles,
  fragmentStyles,
  pageStyles,
  spreadStyles,
  type PageStyles,
} from './styles.js';
import { applyAlphaToSVG, applyGradientToSVG, validateHexColor } from './svg-utils.js';
import { renderTableFragment as renderTableFragmentElement } from './table/renderTableFragment.js';
import { computeSdtBoundaries } from './sdt/boundaries.js';
import { shouldRebuildForSdtBoundary, type SdtBoundaryOptions } from './sdt/container.js';
import { applyContainerSdtDataset, applySdtDataset } from './sdt/dataset.js';
import {
  createInlineSdtWrapper,
  expandSdtWrapperPmRange,
  resolveRunSdtId,
  syncInlineSdtWrapperTypography,
} from './sdt/inline.js';
import {
  collectSdtSnapshotEntitiesFromDomRoot,
  type PaintSnapshotStructuredContentBlockEntity,
  type PaintSnapshotStructuredContentInlineEntity,
} from './sdt/snapshot.js';
import { computeBetweenBorderFlags, type BetweenBorderInfo } from './paragraph/borders/index.js';
import { applyParagraphFragmentPmAttributes } from './paragraph/frame.js';
import { renderParagraphFragment as renderParagraphFragmentElement } from './paragraph/renderParagraphFragment.js';
import { renderLine as renderRunLine } from './runs/render-line.js';
import type { RunRenderContext } from './runs/types.js';
import {
  createDrawingImageElement,
  createShapeGroupImageElement,
  createShapeTextImageElement,
} from './images/drawing-image.js';
import { renderImageFragment as renderImageFragmentElement } from './images/image-fragment.js';
import { buildImageHyperlinkAnchor as buildSharedImageHyperlinkAnchor } from './images/hyperlink.js';
import { applyStyles } from './utils/apply-styles.js';
import { applyTrackedChangeDecorations, resolveTrackedChangesConfig } from './runs/tracked-changes.js';
import { applySourceAnchorDataset } from './utils/source-anchor.js';

export type {
  PaintSnapshotStructuredContentBlockEntity,
  PaintSnapshotStructuredContentInlineEntity,
} from './sdt/snapshot.js';

const ACTIVE_HEADER_FOOTER_WATERMARK_PREVIEW_OPACITY = '1';
const INACTIVE_HEADER_FOOTER_WATERMARK_PREVIEW_OPACITY = '0.5';

type LineEnd = {
  type?: string;
  width?: string;
  length?: string;
};

type LineEnds = {
  head?: LineEnd;
  tail?: LineEnd;
};

type EffectExtent = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const normalizeRotationDegrees = (rotation: number): number => ((rotation % 360) + 360) % 360;

type ShapeTextDrawingWithEffects = (VectorShapeDrawing | TextboxDrawing) & {
  lineEnds?: LineEnds;
  effectExtent?: EffectExtent;
};

/**
 * Layout mode for document rendering.
 * @typedef {('vertical'|'horizontal'|'book')} LayoutMode
 * - 'vertical': Standard page-by-page vertical layout (default)
 * - 'horizontal': Pages arranged horizontally side-by-side
 * - 'book': Book-style layout with facing pages
 */
export type LayoutMode = 'vertical' | 'horizontal' | 'book';
// FlowMode is re-exported from @superdoc/contracts
export type { FlowMode } from '@superdoc/contracts';

/**
 * Interface for position mapping from ProseMirror transactions.
 * Used to efficiently update DOM position attributes without full re-render.
 */
export interface PositionMapping {
  /** Transform a position from old to new document coordinates */
  map(pos: number, bias?: number): number;
  /** Array of step maps - length indicates transaction complexity */
  readonly maps: readonly unknown[];
}

export type RenderedLineInfo = {
  el: HTMLElement;
  top: number;
  height: number;
};

/**
 * Input to `DomPainter.paint()`.
 *
 * The painter consumes only `resolvedLayout`. All fragment, geometry, and
 * page-level metadata it needs is reachable from `ResolvedPaintItem.fragment`
 * back-pointers and `ResolvedPage` fields.
 */
export type DomPainterInput = {
  resolvedLayout: ResolvedLayout;
};

export type PageDecorationPayload = {
  fragments: Fragment[];
  /** Resolved items aligned 1:1 with `fragments`. Same length, same order. */
  items: ResolvedPaintItem[];
  /** Minimum Y coordinate from layout; negative when content extends above y=0. */
  minY?: number;
  height: number;
  /** Optional measured content height to aid bottom alignment in footers. */
  contentHeight?: number;
  /** Decoration band origin in page-local Y. Producer is the sole source of truth (SD-2957). */
  offset: number;
  marginLeft?: number;
  // Optional explicit content width (px) for the decoration container
  contentWidth?: number;
  headerFooterRefId?: string;
  sectionType?: string;
  /** True while this rendered header/footer story is the active editing surface. */
  isActiveHeaderFooter?: boolean;
  box?: { x: number; y: number; width: number; height: number };
  hitRegion?: { x: number; y: number; width: number; height: number };
};

/**
 * Provider function for page decorations (headers and footers).
 * Called for each page to generate header or footer content.
 *
 * @param {number} pageNumber - The page number (1-indexed)
 * @param {PageMargins} [pageMargins] - Page margin configuration
 * @param {ResolvedPage} [page] - Resolved page from the layout
 * @returns {PageDecorationPayload | null} Decoration payload containing fragments and layout info, or null if no decoration
 */
export type PageDecorationProvider = (
  pageNumber: number,
  pageMargins?: PageMargins,
  page?: ResolvedPage,
) => PageDecorationPayload | null;

/**
 * Ruler configuration options for per-page rulers.
 */
export type RulerOptions = {
  /** Whether to show rulers on pages (default: false) */
  enabled?: boolean;
  /** Whether rulers are interactive with drag handles (default: false for per-page) */
  interactive?: boolean;
  /** Callback when margin handle drag ends (only used if interactive) */
  onMarginChange?: (side: 'left' | 'right', marginInches: number) => void;
};

type PainterOptions = {
  pageStyles?: PageStyles;
  layoutMode?: LayoutMode;
  flowMode?: FlowMode;
  /** Gap between pages in pixels (default: 24px for vertical, 20px for horizontal) */
  pageGap?: number;
  headerProvider?: PageDecorationProvider;
  footerProvider?: PageDecorationProvider;
  virtualization?: {
    enabled?: boolean;
    window?: number;
    overscan?: number;
    /** Virtualization gap override (defaults to 72px; independent of pageGap). */
    gap?: number;
    paddingTop?: number;
  };
  /** Per-page ruler options */
  ruler?: RulerOptions;
  /** Called with the paint snapshot after each paint cycle completes. */
  onPaintSnapshot?: (snapshot: PaintSnapshot) => void;
  /** Render nonprinting formatting marks such as spaces, tabs, and paragraph marks. */
  showFormattingMarks?: boolean;
  /** Built-in SDT chrome rendering mode. */
  contentControlsChrome?: 'default' | 'none';
  /** Per-document logical->physical font resolver (face-aware); see DomPainterOptions.resolvePhysical. */
  resolvePhysical?: (cssFontFamily: string, face: { weight: '400' | '700'; style: 'normal' | 'italic' }) => string;
};

type FragmentDomState = {
  key: string;
  signature: string;
  fragment: Fragment;
  element: HTMLElement;
  context: FragmentRenderContext;
};

type PageDomState = {
  element: HTMLElement;
  fragments: FragmentDomState[];
};

function pageContextSignature(context: FragmentRenderContext): string {
  return [
    context.pageNumber,
    context.totalPages,
    context.sectionPageCount ?? '',
    context.pageNumberText ?? '',
    context.displayPageNumber ?? '',
    context.pageNumberFormat ?? '',
    context.pageNumberChapterText ?? '',
    context.pageNumberChapterSeparator ?? '',
  ].join('|');
}

function hasPageContextTokenInShapeText(textContent: ShapeTextContent | undefined): boolean {
  return (
    Array.isArray(textContent?.parts) &&
    textContent.parts.some(
      (part) => part.fieldType === 'PAGE' || part.fieldType === 'NUMPAGES' || part.fieldType === 'SECTIONPAGES',
    )
  );
}

function hasPageContextTokenInShapeGroup(shapes: readonly ShapeGroupChild[] | undefined): boolean {
  return (
    Array.isArray(shapes) &&
    shapes.some((shape) => {
      if (shape.shapeType !== 'vectorShape') {
        return false;
      }
      return hasPageContextTokenInShapeText(shape.attrs.textContent);
    })
  );
}

function hasPageContextTokenInBlock(block: FlowBlock | undefined): boolean {
  if (!block) return false;
  if (block.kind === 'paragraph') {
    for (const run of (block as ParagraphBlock).runs) {
      if (
        'token' in run &&
        (run.token === 'pageNumber' || run.token === 'totalPageCount' || run.token === 'sectionPageCount')
      ) {
        return true;
      }
    }
  } else if (block.kind === 'list') {
    const list = block as ListBlock;
    for (const item of list.items ?? []) {
      if (hasPageContextTokenInBlock(item.paragraph)) {
        return true;
      }
    }
  } else if (block.kind === 'table') {
    const table = block as TableBlock;
    for (const row of table.rows ?? []) {
      for (const cell of row.cells ?? []) {
        const cellBlocks: FlowBlock[] = cell.blocks
          ? (cell.blocks as FlowBlock[])
          : cell.paragraph
            ? [cell.paragraph]
            : [];
        if (cellBlocks.some(hasPageContextTokenInBlock)) {
          return true;
        }
      }
    }
  } else if (block.kind === 'drawing') {
    const drawing = block as DrawingBlock;
    if (drawing.drawingKind === 'vectorShape' || drawing.drawingKind === 'textboxShape') {
      return hasPageContextTokenInShapeText(drawing.textContent);
    }
    if (drawing.drawingKind === 'shapeGroup') {
      return hasPageContextTokenInShapeGroup(drawing.shapes);
    }
  }
  return false;
}

function needsRebuildForPageContext(
  currentContext: FragmentRenderContext,
  nextContext: FragmentRenderContext,
  resolvedItem: ResolvedPaintItem | undefined,
): boolean {
  const block = resolvedItem?.kind === 'fragment' && 'block' in resolvedItem ? resolvedItem.block : undefined;
  return (
    pageContextSignature(currentContext) !== pageContextSignature(nextContext) && hasPageContextTokenInBlock(block)
  );
}

/**
 * Rendering context passed to fragment renderers containing page metadata.
 * Provides information about the current page position and section for dynamic content like page numbers.
 *
 * @typedef {Object} FragmentRenderContext
 * @property {number} pageNumber - Current page number (1-indexed)
 * @property {number} totalPages - Total number of pages in the document
 * @property {'body'|'header'|'footer'} section - Document section being rendered
 * @property {string} [pageNumberText] - Optional formatted page number text (e.g., "Page 1 of 10")
 * @property {number} [displayPageNumber] - Section-aware numeric page value before formatting
 * @property {number} [sectionPageCount] - Physical page count in the current section
 */
export type FragmentRenderContext = {
  pageNumber: number;
  totalPages: number;
  section: 'body' | 'header' | 'footer';
  story?: LayoutStoryLocator;
  pageNumberText?: string;
  displayPageNumber?: number;
  pageNumberFormat?: PageNumberFormat;
  pageNumberChapterText?: string;
  pageNumberChapterSeparator?: PageNumberChapterSeparator;
  sectionPageCount?: number;
  pageIndex?: number;
};

function buildSectionPageCounts(pages: ResolvedPage[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const page of pages) {
    const sectionIndex = page.sectionIndex ?? 0;
    counts.set(sectionIndex, (counts.get(sectionIndex) ?? 0) + 1);
  }
  return counts;
}

export type PaintSnapshotLineStyle = {
  paddingLeftPx?: number;
  paddingRightPx?: number;
  textIndentPx?: number;
  marginLeftPx?: number;
  marginRightPx?: number;
  leftPx?: number;
  topPx?: number;
  widthPx?: number;
  heightPx?: number;
  display?: string;
  position?: string;
  textAlign?: string;
  justifyContent?: string;
};

export type PaintSnapshotMarkerStyle = {
  text?: string;
  leftPx?: number;
  widthPx?: number;
  paddingRightPx?: number;
  display?: string;
  position?: string;
  textAlign?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  sourceAnchor?: SourceAnchor;
};

export type PaintSnapshotTabStyle = {
  widthPx?: number;
  leftPx?: number;
  position?: string;
  borderBottom?: string;
};

export type PaintSnapshotAnnotationEntity = {
  element: HTMLElement;
  pageIndex: number;
  pmStart?: number;
  pmEnd?: number;
  fieldId?: string;
  fieldType?: string;
  type?: string;
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type PaintSnapshotImageEntity = {
  element: HTMLElement;
  pageIndex: number;
  kind: 'inline' | 'fragment';
  pmStart?: number;
  pmEnd?: number;
  blockId?: string;
  sourceAnchor?: SourceAnchor;
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type PaintSnapshotEntities = {
  annotations: PaintSnapshotAnnotationEntity[];
  structuredContentBlocks: PaintSnapshotStructuredContentBlockEntity[];
  structuredContentInlines: PaintSnapshotStructuredContentInlineEntity[];
  images: PaintSnapshotImageEntity[];
};

export type PaintSnapshotLine = {
  index: number;
  inTableFragment: boolean;
  inTableParagraph: boolean;
  style: PaintSnapshotLineStyle;
  markers?: PaintSnapshotMarkerStyle[];
  tabs?: PaintSnapshotTabStyle[];
  sourceAnchor?: SourceAnchor;
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type PaintSnapshotPage = {
  index: number;
  pageNumber?: number;
  lineCount: number;
  lines: PaintSnapshotLine[];
};

export type PaintSnapshot = {
  formatVersion: 1;
  pageCount: number;
  lineCount: number;
  markerCount: number;
  tabCount: number;
  pages: PaintSnapshotPage[];
  entities: PaintSnapshotEntities;
};

type PaintSnapshotPageBuilder = {
  index: number;
  pageNumber: number | null;
  lineCount: number;
  lines: PaintSnapshotLine[];
};

type PaintSnapshotBuilder = {
  formatVersion: 1;
  lineCount: number;
  markerCount: number;
  tabCount: number;
  pages: PaintSnapshotPageBuilder[];
};

type PaintSnapshotCaptureOptions = {
  inTableFragment?: boolean;
  inTableParagraph?: boolean;
  wrapperEl?: HTMLElement;
  sourceAnchor?: SourceAnchor;
};

function roundSnapshotMetric(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function readSnapshotPxMetric(styleValue: string | null | undefined): number | null {
  if (typeof styleValue !== 'string' || styleValue.length === 0) return null;
  const parsed = Number.parseFloat(styleValue);
  return Number.isFinite(parsed) ? roundSnapshotMetric(parsed) : null;
}

function readSnapshotStyleValue(styleValue: string | null | undefined): string | null {
  if (typeof styleValue !== 'string' || styleValue.length === 0) return null;
  return styleValue;
}

function createEmptyPaintSnapshotEntities(): PaintSnapshotEntities {
  return {
    annotations: [],
    structuredContentBlocks: [],
    structuredContentInlines: [],
    images: [],
  };
}

function readSnapshotDatasetNumber(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveSnapshotPageIndex(element: HTMLElement): number | null {
  const pageEl = element.closest(`.${DOM_CLASS_NAMES.PAGE}`) as HTMLElement | null;
  if (!pageEl) return null;
  return readSnapshotDatasetNumber(pageEl.dataset.pageIndex);
}

function compactSnapshotObject<T extends Record<string, unknown>>(input: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Stamp the editor-neutral layout-identity dataset (prep-001).
 *
 * Additive only — runs alongside the legacy `data-pm-*` / `data-block-id`
 * writes in `applyFragmentFrame` and `applyResolvedFragmentFrame`. v1
 * consumers still read PM-shaped datasets; future editor-neutral consumers
 * read `data-layout-fragment-id` / `data-layout-story` / `data-layout-block-ref`
 * here.
 */
export function applyLayoutIdentityDataset(element: HTMLElement, identity: LayoutSourceIdentity | undefined): void {
  if (!identity) {
    delete element.dataset[DATASET_KEYS.LAYOUT_FRAGMENT_ID];
    delete element.dataset[DATASET_KEYS.LAYOUT_BLOCK_REF];
    delete element.dataset[DATASET_KEYS.LAYOUT_STORY];
    return;
  }
  element.dataset[DATASET_KEYS.LAYOUT_FRAGMENT_ID] = identity.fragmentId;
  element.dataset[DATASET_KEYS.LAYOUT_BLOCK_REF] = identity.blockRef;
  element.dataset[DATASET_KEYS.LAYOUT_STORY] = encodeLayoutStoryDataset(identity.story);
}

const resolveOrBuildFragmentIdentity = (
  fragment: Fragment,
  story?: LayoutStoryLocator,
  existing?: LayoutSourceIdentity,
): LayoutSourceIdentity =>
  buildLayoutSourceIdentityForFragment(
    existing
      ? {
          ...fragment,
          layoutSourceIdentity: existing,
          sourceAnchor: fragment.sourceAnchor ?? existing.sourceAnchor,
        }
      : fragment,
    story,
  );

const resolveSectionStory = (section?: 'body' | 'header' | 'footer'): LayoutStoryLocator | undefined => {
  if (!section || section === 'body') return undefined;
  return { kind: section };
};

const resolveDecorationStory = (kind: 'header' | 'footer', data: PageDecorationPayload): LayoutStoryLocator => {
  const id = data.headerFooterRefId ?? data.sectionType;
  return typeof id === 'string' && id.length > 0 ? { kind, id } : { kind };
};

function readSourceAnchorDataset(element: HTMLElement | null | undefined): SourceAnchor | undefined {
  if (!element) return undefined;
  const encoded = element.dataset?.sourceAnchor;
  if (typeof encoded !== 'string' || encoded.length === 0) return undefined;

  try {
    const parsed = JSON.parse(encoded) as SourceAnchor;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readNearestSourceAnchor(element: HTMLElement | null | undefined): SourceAnchor | undefined {
  if (!element) return undefined;
  return (
    readSourceAnchorDataset(element) ??
    readSourceAnchorDataset(element.closest(`.${CLASS_NAMES.fragment}`) as HTMLElement | null)
  );
}

function readLayoutIdentityDataset(element: HTMLElement | null | undefined): LayoutSourceIdentity | undefined {
  if (!element) return undefined;
  const fragmentId = element.dataset?.[DATASET_KEYS.LAYOUT_FRAGMENT_ID];
  const blockRef = element.dataset?.[DATASET_KEYS.LAYOUT_BLOCK_REF];
  const story = decodeLayoutStoryDataset(element.dataset?.[DATASET_KEYS.LAYOUT_STORY]);
  if (!fragmentId || !blockRef || story.kind === 'unknown') return undefined;
  return compactSnapshotObject({
    schema: LAYOUT_BOUNDARY_SCHEMA,
    story,
    blockRef,
    fragmentId,
    sourceAnchor: readNearestSourceAnchor(element),
  }) as LayoutSourceIdentity;
}

function readNearestLayoutSourceIdentity(element: HTMLElement | null | undefined): LayoutSourceIdentity | undefined {
  if (!element) return undefined;
  return (
    readLayoutIdentityDataset(element) ??
    readLayoutIdentityDataset(element.closest(`.${CLASS_NAMES.fragment}`) as HTMLElement | null)
  );
}

function shouldIncludeInlineImageSnapshotElement(element: HTMLElement): boolean {
  if (element.classList.contains(DOM_CLASS_NAMES.INLINE_IMAGE_CLIP_WRAPPER)) {
    return true;
  }

  if (!element.classList.contains(DOM_CLASS_NAMES.INLINE_IMAGE)) {
    return false;
  }

  return !element.closest(`.${DOM_CLASS_NAMES.INLINE_IMAGE_CLIP_WRAPPER}`);
}

function resolvedPaintCacheSignature(resolvedItem: ResolvedPaintItem | undefined): string {
  if (!resolvedItem) return '';
  return (
    (resolvedItem as { paintCacheVersion?: string }).paintCacheVersion ??
    (resolvedItem as { version?: string }).version ??
    ''
  );
}

function collectPaintSnapshotEntitiesFromDomRoot(rootEl: HTMLElement): PaintSnapshotEntities {
  const entities = createEmptyPaintSnapshotEntities();

  const annotationElements = Array.from(
    rootEl.querySelectorAll<HTMLElement>(`.${DOM_CLASS_NAMES.ANNOTATION}[data-pm-start]`),
  );
  for (const element of annotationElements) {
    const pageIndex = resolveSnapshotPageIndex(element);
    if (pageIndex == null) continue;

    entities.annotations.push(
      compactSnapshotObject({
        element,
        pageIndex,
        pmStart: readSnapshotDatasetNumber(element.dataset.pmStart),
        pmEnd: readSnapshotDatasetNumber(element.dataset.pmEnd),
        fieldId: element.dataset.fieldId || null,
        fieldType: element.dataset.fieldType || null,
        type: element.dataset.type || null,
        layoutSourceIdentity: readNearestLayoutSourceIdentity(element),
      }) as PaintSnapshotAnnotationEntity,
    );
  }

  const sdtEntities = collectSdtSnapshotEntitiesFromDomRoot(rootEl, {
    resolvePageIndex: resolveSnapshotPageIndex,
    readDatasetNumber: readSnapshotDatasetNumber,
    readLayoutSourceIdentity: readNearestLayoutSourceIdentity,
    compactObject: compactSnapshotObject,
  });
  entities.structuredContentBlocks.push(...sdtEntities.structuredContentBlocks);
  entities.structuredContentInlines.push(...sdtEntities.structuredContentInlines);

  const inlineImageElements = Array.from(
    rootEl.querySelectorAll<HTMLElement>(
      `.${DOM_CLASS_NAMES.INLINE_IMAGE_CLIP_WRAPPER}[data-pm-start], .${DOM_CLASS_NAMES.INLINE_IMAGE}[data-pm-start]`,
    ),
  );
  for (const element of inlineImageElements) {
    if (!shouldIncludeInlineImageSnapshotElement(element)) continue;

    const pageIndex = resolveSnapshotPageIndex(element);
    if (pageIndex == null) continue;

    entities.images.push(
      compactSnapshotObject({
        element,
        pageIndex,
        kind: 'inline',
        pmStart: readSnapshotDatasetNumber(element.dataset.pmStart),
        pmEnd: readSnapshotDatasetNumber(element.dataset.pmEnd),
        sourceAnchor: readNearestSourceAnchor(element),
        layoutSourceIdentity: readNearestLayoutSourceIdentity(element),
      }) as PaintSnapshotImageEntity,
    );
  }

  const fragmentImageElements = Array.from(
    rootEl.querySelectorAll<HTMLElement>(`.${DOM_CLASS_NAMES.IMAGE_FRAGMENT}[data-pm-start]`),
  );
  for (const element of fragmentImageElements) {
    const pageIndex = resolveSnapshotPageIndex(element);
    if (pageIndex == null) continue;

    entities.images.push(
      compactSnapshotObject({
        element,
        pageIndex,
        kind: 'fragment',
        pmStart: readSnapshotDatasetNumber(element.dataset.pmStart),
        pmEnd: readSnapshotDatasetNumber(element.dataset.pmEnd),
        blockId: element.getAttribute('data-sd-block-id'),
        sourceAnchor: readNearestSourceAnchor(element),
        layoutSourceIdentity: readNearestLayoutSourceIdentity(element),
      }) as PaintSnapshotImageEntity,
    );
  }

  return entities;
}

function snapshotLineStyleFromElement(lineEl: HTMLElement): PaintSnapshotLineStyle {
  const style = lineEl?.style;
  if (!style) return {};
  return compactSnapshotObject({
    paddingLeftPx: readSnapshotPxMetric(style.paddingLeft),
    paddingRightPx: readSnapshotPxMetric(style.paddingRight),
    textIndentPx: readSnapshotPxMetric(style.textIndent),
    marginLeftPx: readSnapshotPxMetric(style.marginLeft),
    marginRightPx: readSnapshotPxMetric(style.marginRight),
    leftPx: readSnapshotPxMetric(style.left),
    topPx: readSnapshotPxMetric(style.top),
    widthPx: readSnapshotPxMetric(style.width),
    heightPx: readSnapshotPxMetric(style.height),
    display: readSnapshotStyleValue(style.display),
    position: readSnapshotStyleValue(style.position),
    textAlign: readSnapshotStyleValue(style.textAlign),
    justifyContent: readSnapshotStyleValue(style.justifyContent),
  }) as PaintSnapshotLineStyle;
}

function applyWrapperMarginsToSnapshotStyle(
  lineStyle: PaintSnapshotLineStyle,
  wrapperEl?: HTMLElement,
): PaintSnapshotLineStyle {
  if (!wrapperEl?.style) return lineStyle;

  return compactSnapshotObject({
    ...lineStyle,
    marginLeftPx: readSnapshotPxMetric(wrapperEl.style.marginLeft) ?? lineStyle.marginLeftPx,
    marginRightPx: readSnapshotPxMetric(wrapperEl.style.marginRight) ?? lineStyle.marginRightPx,
  }) as PaintSnapshotLineStyle;
}

function snapshotMarkerStyleFromElement(markerEl: HTMLElement): PaintSnapshotMarkerStyle {
  const style = markerEl?.style;
  if (!style) return {};
  return compactSnapshotObject({
    text: markerEl?.textContent ?? '',
    leftPx: readSnapshotPxMetric(style.left),
    widthPx: readSnapshotPxMetric(style.width),
    paddingRightPx: readSnapshotPxMetric(style.paddingRight),
    display: readSnapshotStyleValue(style.display),
    position: readSnapshotStyleValue(style.position),
    textAlign: readSnapshotStyleValue(style.textAlign),
    fontWeight: readSnapshotStyleValue(style.fontWeight),
    fontStyle: readSnapshotStyleValue(style.fontStyle),
    color: readSnapshotStyleValue(style.color),
    sourceAnchor: readNearestSourceAnchor(markerEl),
  }) as PaintSnapshotMarkerStyle;
}

function collectLineMarkersForSnapshot(lineEl: HTMLElement): PaintSnapshotMarkerStyle[] {
  const markers: PaintSnapshotMarkerStyle[] = [];
  const parent = lineEl?.parentElement;
  if (parent) {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.classList.contains('superdoc-paragraph-marker')) continue;
      markers.push(snapshotMarkerStyleFromElement(child));
    }
  }

  const inlineMarkers = lineEl?.querySelectorAll?.('.superdoc-paragraph-marker') ?? [];
  for (const markerEl of Array.from(inlineMarkers)) {
    if (!(markerEl instanceof HTMLElement)) continue;
    const markerStyle = snapshotMarkerStyleFromElement(markerEl);
    const markerText = markerEl.textContent ?? '';
    const markerLeft = readSnapshotPxMetric(markerEl.style.left);
    if (markers.some((existing) => existing.text === markerText && existing.leftPx === markerLeft)) {
      continue;
    }
    markers.push(markerStyle);
  }

  return markers;
}

function collectLineTabsForSnapshot(lineEl: HTMLElement): PaintSnapshotTabStyle[] {
  const tabs: PaintSnapshotTabStyle[] = [];
  const tabElements = lineEl?.querySelectorAll?.('.superdoc-tab') ?? [];
  for (const tabEl of Array.from(tabElements)) {
    if (!(tabEl instanceof HTMLElement)) continue;
    tabs.push(
      compactSnapshotObject({
        widthPx: readSnapshotPxMetric(tabEl.style.width),
        leftPx: readSnapshotPxMetric(tabEl.style.left),
        position: readSnapshotStyleValue(tabEl.style.position),
        borderBottom: readSnapshotStyleValue(tabEl.style.borderBottom),
      }) as PaintSnapshotTabStyle,
    );
  }
  return tabs;
}

/**
 * Default page height in pixels (11 inches at 96 DPI).
 * Used as a fallback when page size information is not available for ruler rendering.
 */
const DEFAULT_PAGE_HEIGHT_PX = 1056;
/** Default gap used when virtualization is enabled (kept in sync with PresentationEditor layout defaults). */
const DEFAULT_VIRTUALIZED_PAGE_GAP = 72;
// Keeps non-behindDoc header/footer wrapNone decorations above the behindDoc
// background tier while the whole page-background story still uses CSS z-index 0.
const PAGE_BACKGROUND_OVERLAY_Z_ORDER_OFFSET = 1_000_000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const WORDART_LINE_FILL_RATIO = 0.9;
// Comment highlight color tokens moved to CommentHighlightDecorator (super-editor).

/**
 * DOM-based document painter that renders layout fragments to HTML elements.
 * Manages page rendering, virtualization, headers/footers, and incremental updates.
 *
 * @class DomPainter
 *
 * @remarks
 * The DomPainter is responsible for:
 * - Rendering layout fragments (paragraphs, lists, images, tables, drawings) to DOM elements
 * - Managing page-level DOM structure and styling
 * - Providing virtualization for large documents (vertical mode only)
 * - Handling headers and footers via PageDecorationProvider
 * - Incremental re-rendering when only specific blocks change
 * - Hyperlink rendering with security sanitization and accessibility
 *
 * @example
 * ```typescript
 * const painter = new DomPainter(blocks, measures, {
 *   layoutMode: 'vertical',
 *   pageStyles: { width: '8.5in', height: '11in' }
 * });
 * painter.mount(document.getElementById('editor-container'));
 * painter.render(layout);
 * ```
 */
export class DomPainter {
  private readonly options: PainterOptions;
  private mount: HTMLElement | null = null;
  private doc: Document | null = null;
  private pageStates: PageDomState[] = [];
  private currentLayout: ResolvedLayout | null = null;
  private changedBlocks = new Set<string>();
  private readonly layoutMode: LayoutMode;
  private readonly isSemanticFlow: boolean;
  private headerProvider?: PageDecorationProvider;
  private footerProvider?: PageDecorationProvider;
  private totalPages = 0;
  private sectionPageCounts = new Map<number, number>();
  private linkIdCounter = 0; // Counter for generating unique link IDs
  private sdtLabelsRendered = new Set<string>(); // Tracks SDT labels rendered across pages

  /**
   * WeakMap storing tooltip data for hyperlink elements before DOM insertion.
   * Uses WeakMap to prevent memory leaks - entries are automatically garbage collected
   * when the corresponding element is removed from memory.
   * @private
   */
  private pendingTooltips = new WeakMap<HTMLElement, string>();
  // Page gap for normal (non-virtualized) rendering
  private pageGap = 24; // px, default for vertical mode
  // Virtualization state (vertical mode only)
  private virtualEnabled = false;
  private virtualWindow = 5;
  private virtualOverscan = 0;
  private virtualGap = DEFAULT_VIRTUALIZED_PAGE_GAP; // px, default for virtualized mode
  private virtualPaddingTop: number | null = null; // px; computed from mount if not provided
  private topSpacerEl: HTMLElement | null = null;
  private bottomSpacerEl: HTMLElement | null = null;
  private virtualPagesEl: HTMLElement | null = null;
  private virtualGapSpacers: HTMLElement[] = [];
  private virtualPinnedPages: number[] = [];
  private virtualMountedKey = '';
  private pageIndexToState: Map<number, PageDomState> = new Map();
  private virtualHeights: number[] = [];
  private virtualOffsets: number[] = [];
  private virtualStart = 0;
  private virtualEnd = -1;
  private layoutVersion = 0;
  private layoutEpoch = 0;
  private processedLayoutVersion = -1;
  /** Current transaction mapping for position updates (null if no mapping or complex transaction) */
  private currentMapping: PositionMapping | null = null;
  private onScrollHandler: ((e: Event) => void) | null = null;
  private onWindowScrollHandler: ((e: Event) => void) | null = null;
  private onResizeHandler: ((e: Event) => void) | null = null;
  /** CSS zoom/scale factor applied to the mount element via transform: scale(). Defaults to 1 (no zoom). */
  private zoomFactor = 1;
  /**
   * External scroll container (an ancestor element with overflow-y: auto/scroll).
   * When set, updateVirtualWindow() uses this element's position to compute scrollY
   * relative to the scroll container instead of relative to the browser viewport.
   * This fixes the scroll offset calculation when SuperDoc is mounted inside a
   * wrapper div that owns scrolling rather than the window.
   */
  private scrollContainer: HTMLElement | null = null;
  /**
   * Cached offset (in px) from the scroll container's content top to the mount's top.
   * Used for stable scrollY calculation that avoids feedback loops from spacer DOM mutations.
   * Invalidated when the mount, scroll container, or zoom changes.
   */
  private scrollContainerMountOffset: number | null = null;
  private paintSnapshotBuilder: PaintSnapshotBuilder | null = null;
  private lastPaintSnapshot: PaintSnapshot | null = null;
  private onPaintSnapshotCallback: ((snapshot: PaintSnapshot) => void) | null = null;
  private mountedPageIndices: number[] = [];
  /** Resolved layout for the next-gen paint pipeline. */
  private resolvedLayout: ResolvedLayout | null = null;
  private showFormattingMarks = false;
  private contentControlsChrome: 'default' | 'none' = 'default';

  constructor(options: PainterOptions = {}) {
    this.options = options;
    this.layoutMode = options.layoutMode ?? 'vertical';
    this.isSemanticFlow = (options.flowMode ?? 'paginated') === 'semantic';
    this.headerProvider = options.headerProvider;
    this.footerProvider = options.footerProvider;
    this.showFormattingMarks = options.showFormattingMarks === true;
    this.contentControlsChrome = options.contentControlsChrome ?? 'default';

    // Initialize page gap (defaults: 24px vertical, 20px horizontal)
    const defaultGap = this.layoutMode === 'horizontal' ? 20 : 24;
    this.pageGap =
      typeof options.pageGap === 'number' && Number.isFinite(options.pageGap)
        ? Math.max(0, options.pageGap)
        : defaultGap;

    // Initialize virtualization config (feature-flagged)
    if (!this.isSemanticFlow && this.layoutMode === 'vertical' && options.virtualization?.enabled) {
      this.virtualEnabled = true;
      this.virtualWindow = Math.max(1, options.virtualization.window ?? 5);
      this.virtualOverscan = Math.max(0, options.virtualization.overscan ?? 0);
      // Virtualization gap: use explicit virtualization.gap if provided,
      // otherwise default to legacy virtualized gap (72px).
      const maybeGap = options.virtualization.gap;
      if (typeof maybeGap === 'number' && Number.isFinite(maybeGap)) {
        this.virtualGap = Math.max(0, maybeGap);
      } else {
        this.virtualGap = DEFAULT_VIRTUALIZED_PAGE_GAP;
      }
      if (typeof options.virtualization.paddingTop === 'number' && Number.isFinite(options.virtualization.paddingTop)) {
        this.virtualPaddingTop = Math.max(0, options.virtualization.paddingTop);
      }
    }

    this.onPaintSnapshotCallback = options.onPaintSnapshot ?? null;
  }

  public setShowFormattingMarks(showFormattingMarks: boolean): void {
    const next = showFormattingMarks === true;
    if (this.showFormattingMarks === next) return;
    this.showFormattingMarks = next;
    this.applyFormattingMarksClass();
    this.invalidateRenderedContent();
  }

  public setProviders(header?: PageDecorationProvider, footer?: PageDecorationProvider): void {
    this.headerProvider = header;
    this.footerProvider = footer;
  }

  private applyFormattingMarksClass(mount: HTMLElement | null = this.mount): void {
    mount?.classList.toggle('superdoc-show-formatting-marks', this.showFormattingMarks);
    mount?.classList.toggle('superdoc-cc-chrome-none', this.contentControlsChrome === 'none');
  }

  private invalidateRenderedContent(): void {
    this.pageStates = [];
    this.currentLayout = null;
    this.pageIndexToState.clear();
    this.virtualMountedKey = '';
    this.clearGapSpacers();
    this.topSpacerEl = null;
    this.bottomSpacerEl = null;
    this.virtualPagesEl = null;
    this.processedLayoutVersion = -1;
    this.layoutVersion += 1;
  }

  /**
   * Pins specific page indices so they remain mounted when virtualization is enabled.
   *
   * Used by selection/drag logic to ensure endpoints can be resolved via DOM
   * even when they fall outside the current scroll window.
   */
  public setVirtualizationPins(pageIndices: number[] | null | undefined): void {
    const next = Array.from(new Set((pageIndices ?? []).filter((n) => Number.isInteger(n)))).sort((a, b) => a - b);
    this.virtualPinnedPages = next;
    if (this.virtualEnabled && this.mount) {
      this.updateVirtualWindow();
    }
  }

  /**
   * Sets the CSS zoom/scale factor applied to the mount element.
   *
   * When the mount element has `transform: scale(zoom)`, getBoundingClientRect()
   * returns screen-space coordinates (scaled), but internal layout offsets are in
   * unscaled layout space. This factor is used to convert between the two spaces
   * during virtualization window calculations.
   *
   * @param zoom - The zoom/scale factor (e.g., 0.75 for 75% zoom). Defaults to 1.
   */
  public setZoom(zoom: number): void {
    const next = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    if (next !== this.zoomFactor) {
      this.zoomFactor = next;
      this.scrollContainerMountOffset = null; // Invalidate on zoom change
      if (this.virtualEnabled && this.mount) {
        this.updateVirtualWindow();
      }
    }
  }

  /**
   * Sets the external scroll container element.
   *
   * When the scroll container is an ancestor element (e.g., a wrapper div with
   * overflow-y: auto), the default scrollY calculation using mount.getBoundingClientRect()
   * relative to the viewport produces an offset equal to the scroll container's distance
   * from the viewport top. This causes the virtualization window to be misaligned with the
   * actual visible area.
   *
   * Setting the scroll container allows updateVirtualWindow() to compute scrollY relative
   * to the scroll container instead, eliminating this offset.
   *
   * @param el - The scroll container element, or null to clear.
   */
  public setScrollContainer(el: HTMLElement | null): void {
    if (el !== this.scrollContainer) {
      this.scrollContainer = el;
      this.scrollContainerMountOffset = null; // Invalidate cached offset
      if (this.virtualEnabled && this.mount) {
        this.updateVirtualWindow();
      }
    }
  }

  /** Returns the resolved page for a given index, or null if resolved data is unavailable. */
  private getResolvedPage(pageIndex: number): ResolvedPage | null {
    return this.resolvedLayout?.pages[pageIndex] ?? null;
  }

  /**
   * Returns the latest painter snapshot captured during the last paint cycle.
   */
  public getPaintSnapshot(): PaintSnapshot | null {
    return this.lastPaintSnapshot;
  }

  /**
   * Returns the page indices that are currently mounted in the DOM.
   *
   * Unlike paint snapshots, this reflects virtualization remounts that happen
   * during scroll without waiting for a full paint cycle.
   */
  public getMountedPageIndices(): number[] {
    return [...this.mountedPageIndices];
  }

  private createAllPageIndices(pageCount: number): number[] {
    return Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
  }

  private setMountedPageIndices(pageIndices: number[]): void {
    this.mountedPageIndices = [...pageIndices];
  }

  private emitPaintSnapshot(snapshot: PaintSnapshot): void {
    this.lastPaintSnapshot = snapshot;
    this.onPaintSnapshotCallback?.(snapshot);
  }

  private beginPaintSnapshot(layout: ResolvedLayout): void {
    this.paintSnapshotBuilder = {
      formatVersion: 1,
      lineCount: 0,
      markerCount: 0,
      tabCount: 0,
      pages: layout.pages.map((page, index) => ({
        index,
        pageNumber: Number.isFinite(page.number) ? page.number : null,
        lineCount: 0,
        lines: [],
      })),
    };
  }

  private finalizePaintSnapshotFromBuilder(rootEl?: HTMLElement): void {
    const builder = this.paintSnapshotBuilder;
    if (!builder) {
      this.lastPaintSnapshot = null;
      return;
    }

    const pages = builder.pages.map((page) =>
      compactSnapshotObject({
        index: page.index,
        pageNumber: page.pageNumber,
        lineCount: page.lineCount,
        lines: page.lines,
      }),
    ) as PaintSnapshotPage[];

    this.emitPaintSnapshot({
      formatVersion: builder.formatVersion,
      pageCount: pages.length,
      lineCount: builder.lineCount,
      markerCount: builder.markerCount,
      tabCount: builder.tabCount,
      pages,
      entities: rootEl ? collectPaintSnapshotEntitiesFromDomRoot(rootEl) : createEmptyPaintSnapshotEntities(),
    });
    this.paintSnapshotBuilder = null;
  }

  private capturePaintSnapshotLine(
    lineEl: HTMLElement,
    context: FragmentRenderContext,
    options: PaintSnapshotCaptureOptions = {},
  ): void {
    const builder = this.paintSnapshotBuilder;
    if (!builder) return;
    const pageIndex = context.pageIndex;
    if (!Number.isInteger(pageIndex)) return;

    const page = builder.pages[pageIndex as number];
    if (!page) return;

    const markers = collectLineMarkersForSnapshot(lineEl);
    const tabs = collectLineTabsForSnapshot(lineEl);
    const lineIndex = page.lines.length;
    const style = applyWrapperMarginsToSnapshotStyle(snapshotLineStyleFromElement(lineEl), options.wrapperEl);

    page.lines.push(
      compactSnapshotObject({
        index: lineIndex,
        inTableFragment: options.inTableFragment === true,
        inTableParagraph: options.inTableParagraph === true,
        style,
        markers,
        tabs,
        sourceAnchor:
          readNearestSourceAnchor(lineEl) ?? readNearestSourceAnchor(options.wrapperEl) ?? options.sourceAnchor,
        layoutSourceIdentity:
          readNearestLayoutSourceIdentity(lineEl) ?? readNearestLayoutSourceIdentity(options.wrapperEl),
      }) as PaintSnapshotLine,
    );

    page.lineCount += 1;
    builder.lineCount += 1;
    builder.markerCount += markers.length;
    builder.tabCount += tabs.length;
  }

  private collectPaintSnapshotFromDomRoot(rootEl: HTMLElement): PaintSnapshot {
    const pageElements = Array.from(rootEl?.querySelectorAll?.('.superdoc-page') ?? []);
    const pages: PaintSnapshotPage[] = [];
    let lineCount = 0;
    let markerCount = 0;
    let tabCount = 0;

    for (let domPageIndex = 0; domPageIndex < pageElements.length; domPageIndex += 1) {
      const pageEl = pageElements[domPageIndex];
      if (!(pageEl instanceof HTMLElement)) continue;
      const pageIndexRaw = pageEl.dataset?.pageIndex;
      const pageIndexParsed = pageIndexRaw == null ? Number.NaN : Number(pageIndexRaw);
      const pageIndex = Number.isInteger(pageIndexParsed) ? pageIndexParsed : domPageIndex;

      const lineElements = Array.from(pageEl.querySelectorAll('.superdoc-line'));
      const lines: PaintSnapshotLine[] = [];
      for (let lineIndex = 0; lineIndex < lineElements.length; lineIndex += 1) {
        const lineEl = lineElements[lineIndex];
        if (!(lineEl instanceof HTMLElement)) continue;

        const markers = collectLineMarkersForSnapshot(lineEl);
        const tabs = collectLineTabsForSnapshot(lineEl);
        markerCount += markers.length;
        tabCount += tabs.length;
        lineCount += 1;

        lines.push(
          compactSnapshotObject({
            index: lineIndex,
            inTableFragment: Boolean(lineEl.closest('.superdoc-table-fragment')),
            inTableParagraph: Boolean(lineEl.closest('.superdoc-table-paragraph')),
            style: snapshotLineStyleFromElement(lineEl),
            markers,
            tabs,
            sourceAnchor: readNearestSourceAnchor(lineEl),
            layoutSourceIdentity: readNearestLayoutSourceIdentity(lineEl),
          }) as PaintSnapshotLine,
        );
      }

      const pageNumberRaw = pageEl.dataset?.pageNumber;
      const pageNumberParsed = pageNumberRaw == null ? Number.NaN : Number(pageNumberRaw);

      pages.push(
        compactSnapshotObject({
          index: pageIndex,
          pageNumber: Number.isFinite(pageNumberParsed) ? pageNumberParsed : null,
          lineCount: lines.length,
          lines,
        }) as PaintSnapshotPage,
      );
    }

    return {
      formatVersion: 1,
      pageCount: pages.length,
      lineCount,
      markerCount,
      tabCount,
      pages,
      entities: collectPaintSnapshotEntitiesFromDomRoot(rootEl),
    };
  }

  public paint(input: DomPainterInput, mount: HTMLElement, mapping?: PositionMapping): void {
    const resolvedLayout = input.resolvedLayout;
    this.resolvedLayout = resolvedLayout;
    this.changedBlocks.clear();

    if (!(mount instanceof HTMLElement)) {
      throw new Error('DomPainter.paint requires a valid HTMLElement mount');
    }

    const doc = mount.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      throw new Error('DomPainter.paint requires a DOM-like document');
    }
    this.doc = doc;
    this.sdtLabelsRendered.clear(); // Reset SDT label tracking for new render cycle

    // Simple transaction gate: only use position mapping optimization for single-step transactions.
    // Complex transactions (paste, multi-step replace, etc.) fall back to full rebuild.
    const isSimpleTransaction = mapping && mapping.maps.length === 1;
    if (mapping && !isSimpleTransaction) {
      // Complex transaction, force all body fragments to rebuild (safe fallback).
      for (const page of input.resolvedLayout.pages) {
        for (const item of page.items) {
          if ('blockId' in item) this.changedBlocks.add(item.blockId);
        }
      }
      this.currentMapping = null;
    } else {
      this.currentMapping = mapping ?? null;
    }

    ensurePrintStyles(doc);
    ensureDocumentSurfaceStyles(doc);
    ensureLinkStyles(doc);
    ensureTrackChangeStyles(doc);
    ensureFormattingMarksStyles(doc);
    ensureFieldAnnotationStyles(doc);
    ensureSdtContainerStyles(doc);
    ensureImageSelectionStyles(doc);
    ensureMathMencloseStyles(doc);
    ensureFootnoteStyles(doc);
    if (!this.isSemanticFlow && this.options.ruler?.enabled) {
      ensureRulerStyles(doc);
    }
    mount.classList.add(CLASS_NAMES.container);
    this.applyFormattingMarksClass(mount);

    if (this.mount && this.mount !== mount) {
      this.resetState();
      this.applyFormattingMarksClass(mount);
    }
    this.layoutVersion += 1;

    this.layoutEpoch = resolvedLayout.layoutEpoch ?? 0;
    this.mount = mount;
    this.beginPaintSnapshot(resolvedLayout);

    this.totalPages = resolvedLayout.pages.length;
    this.sectionPageCounts = buildSectionPageCounts(resolvedLayout.pages);
    const previousLayout = this.currentLayout;
    this.currentLayout = resolvedLayout;
    if (this.isSemanticFlow) {
      // Semantic mode always renders as a single continuous surface.
      applyStyles(mount, containerStyles);
      mount.style.gap = '0px';
      mount.style.alignItems = 'stretch';
      if (!previousLayout || this.pageStates.length === 0) {
        this.fullRender(resolvedLayout);
      } else {
        this.patchLayout(resolvedLayout);
      }
      this.setMountedPageIndices(this.createAllPageIndices(resolvedLayout.pages.length));
      this.changedBlocks.clear();
      this.currentMapping = null;
      return;
    }

    let useDomSnapshotFallback = false;
    const mode = this.layoutMode;
    if (mode === 'horizontal') {
      applyStyles(mount, containerStylesHorizontal);
      // Use configured page gap for horizontal rendering
      mount.style.gap = `${this.pageGap}px`;
      this.renderHorizontal(resolvedLayout, mount);
      this.finalizePaintSnapshotFromBuilder(mount);
      this.setMountedPageIndices(this.createAllPageIndices(resolvedLayout.pages.length));
      this.currentLayout = resolvedLayout;
      this.pageStates = [];
      this.changedBlocks.clear();
      this.currentMapping = null;
      return;
    }
    if (mode === 'book') {
      applyStyles(mount, containerStyles);
      this.renderBookMode(resolvedLayout, mount);
      this.finalizePaintSnapshotFromBuilder(mount);
      this.setMountedPageIndices(this.createAllPageIndices(resolvedLayout.pages.length));
      this.currentLayout = resolvedLayout;
      this.pageStates = [];
      this.changedBlocks.clear();
      this.currentMapping = null;
      return;
    }

    // Vertical mode
    applyStyles(mount, containerStyles);

    if (this.virtualEnabled) {
      // Keep container gap at 0 so spacer elements don't introduce extra offsets.
      mount.style.gap = '0px';
      this.renderVirtualized(resolvedLayout, mount);
      useDomSnapshotFallback = true;
      this.currentLayout = resolvedLayout;
      this.changedBlocks.clear();
      this.currentMapping = null;
    } else {
      // Use configured page gap for normal vertical rendering
      mount.style.gap = `${this.pageGap}px`;
      if (!previousLayout || this.pageStates.length === 0) {
        this.fullRender(resolvedLayout);
      } else {
        this.patchLayout(resolvedLayout);
        useDomSnapshotFallback = true;
      }
      this.setMountedPageIndices(this.createAllPageIndices(resolvedLayout.pages.length));
    }

    if (useDomSnapshotFallback) {
      this.emitPaintSnapshot(this.collectPaintSnapshotFromDomRoot(mount));
      this.paintSnapshotBuilder = null;
    } else {
      this.finalizePaintSnapshotFromBuilder(mount);
    }

    this.currentLayout = resolvedLayout;
    this.changedBlocks.clear();
    this.currentMapping = null;
  }

  // ----------------
  // Virtualized path
  // ----------------
  private renderVirtualized(layout: ResolvedLayout, mount: HTMLElement): void {
    if (!this.doc) return;
    // Always keep the latest layout reference for handlers
    this.currentLayout = layout;

    // First-time init, mount changed, or spacers were detached (e.g., by innerHTML='' on zero-page layout)
    const needsInit =
      !this.topSpacerEl ||
      !this.bottomSpacerEl ||
      !this.virtualPagesEl ||
      this.mount !== mount ||
      this.topSpacerEl.parentElement !== mount;
    if (needsInit) {
      this.ensureVirtualizationSetup(mount);
    }

    this.computeVirtualMetrics();
    this.updateVirtualWindow();
  }

  private ensureVirtualizationSetup(mount: HTMLElement): void {
    if (!this.doc) return;

    // Reset any prior non-virtual state
    mount.innerHTML = '';
    this.pageStates = [];
    this.pageIndexToState.clear();
    this.virtualGapSpacers = [];
    this.virtualMountedKey = '';

    // Create and configure spacer elements
    this.topSpacerEl = this.doc.createElement('div');
    this.bottomSpacerEl = this.doc.createElement('div');
    this.configureSpacerElement(this.topSpacerEl, 'top');
    this.configureSpacerElement(this.bottomSpacerEl, 'bottom');

    // Create and configure pages container (handles the inter-page gap).
    // Virtualized rendering uses its own gap setting independent from normal pageGap.
    this.virtualPagesEl = this.doc.createElement('div');
    this.virtualPagesEl.style.display = 'flex';
    this.virtualPagesEl.style.flexDirection = 'column';
    this.virtualPagesEl.style.alignItems = 'center';
    this.virtualPagesEl.style.width = '100%';
    this.virtualPagesEl.style.gap = `${this.virtualGap}px`;
    // Prevent the browser from using this container as a scroll anchor.
    // When the top spacer grows during virtual window shifts, this element
    // moves down. If the browser anchors on it, scroll anchoring adjusts
    // scrollTop to compensate, which fires a new scroll event with a higher
    // scrollY, triggering another window shift — a positive feedback loop.
    // With this set, the browser anchors on page elements (children) instead,
    // which stay at stable positions regardless of spacer changes.
    this.virtualPagesEl.style.overflowAnchor = 'none';

    mount.appendChild(this.topSpacerEl);
    mount.appendChild(this.virtualPagesEl);
    mount.appendChild(this.bottomSpacerEl);

    // Bind scroll and resize handlers
    this.bindVirtualizationHandlers(mount);
  }

  private configureSpacerElement(element: HTMLElement, type: 'top' | 'bottom' | 'gap'): void {
    element.style.width = '1px';
    element.style.height = '0px';
    element.style.flex = '0 0 auto';
    // Prevent Chrome's scroll anchoring from using spacers as anchor nodes.
    // When spacer heights change during virtual window shifts, scroll anchoring
    // could adjust scrollTop and trigger cascading scroll events.
    element.style.overflowAnchor = 'none';
    element.setAttribute('data-virtual-spacer', type);
  }

  private bindVirtualizationHandlers(mount: HTMLElement): void {
    // Bind scroll handler for container
    if (this.onScrollHandler) {
      mount.removeEventListener('scroll', this.onScrollHandler);
    }
    this.onScrollHandler = () => {
      this.updateVirtualWindow();
    };
    mount.addEventListener('scroll', this.onScrollHandler);

    // Bind window scroll/resize for cases where the page scrolls the window
    const win = this.doc?.defaultView;
    if (win) {
      if (this.onWindowScrollHandler) {
        win.removeEventListener('scroll', this.onWindowScrollHandler);
      }
      this.onWindowScrollHandler = () => {
        this.updateVirtualWindow();
      };
      // passive to avoid blocking scrolling
      win.addEventListener('scroll', this.onWindowScrollHandler, { passive: true });

      if (this.onResizeHandler) {
        win.removeEventListener('resize', this.onResizeHandler);
      }
      this.onResizeHandler = () => {
        this.scrollContainerMountOffset = null; // Recompute on resize
        this.updateVirtualWindow();
      };
      win.addEventListener('resize', this.onResizeHandler);
    }
  }

  private releaseVirtualizationHandlers(): void {
    if (this.mount && this.onScrollHandler) {
      try {
        this.mount.removeEventListener('scroll', this.onScrollHandler);
      } catch {}
    }
    const win = this.doc?.defaultView;
    if (win && this.onWindowScrollHandler) {
      try {
        win.removeEventListener('scroll', this.onWindowScrollHandler);
      } catch {}
    }
    if (win && this.onResizeHandler) {
      try {
        win.removeEventListener('resize', this.onResizeHandler);
      } catch {}
    }
    this.onScrollHandler = null;
    this.onWindowScrollHandler = null;
    this.onResizeHandler = null;
  }

  private computeVirtualMetrics(): void {
    if (!this.currentLayout) return;
    const N = this.currentLayout.pages.length;
    if (N !== this.virtualHeights.length) {
      this.virtualHeights = this.currentLayout.pages.map((p) => p.height);
    }
    // Build offsets where offsets[i] = sum_{k < i} (height[k] + gap).
    // Use virtualGap to match CSS gap on virtualPagesEl.
    const offsets: number[] = new Array(this.virtualHeights.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < this.virtualHeights.length; i += 1) {
      offsets[i + 1] = offsets[i] + this.virtualHeights[i] + this.virtualGap;
    }
    this.virtualOffsets = offsets;
  }

  private topOfIndex(i: number): number {
    // Offset to the top of page i (0 for first). Includes gaps before page i.
    if (i <= 0) return 0;
    return this.virtualOffsets[i];
  }

  private contentTotalHeight(): number {
    // Total content height without trailing gap after last page
    const n = this.virtualHeights.length;
    if (n <= 0) return 0;
    return this.virtualOffsets[n] - this.virtualGap;
  }

  private getMountPaddingTopPx(): number {
    if (this.virtualPaddingTop != null) return this.virtualPaddingTop;
    if (!this.mount || !this.doc) return 0;
    const win = this.doc.defaultView;
    if (!win) return 0;
    const style = win.getComputedStyle(this.mount);
    const pt = style?.paddingTop ?? '0';
    const val = Number.parseFloat(pt.replace('px', ''));
    if (Number.isFinite(val)) return Math.max(0, val);
    return 0;
  }

  /**
   * Public method to trigger virtualization window update on scroll.
   * Call this from external scroll handlers when the scroll container
   * is different from the painter's mount element.
   */
  public onScroll(): void {
    if (this.virtualEnabled) {
      this.updateVirtualWindow();
    }
  }

  private updateVirtualWindow(): void {
    if (!this.mount || !this.topSpacerEl || !this.bottomSpacerEl || !this.virtualPagesEl || !this.currentLayout) return;
    const layout = this.currentLayout;
    const N = layout.pages.length;

    if (N === 0) {
      this.mount.innerHTML = '';
      this.setMountedPageIndices([]);
      this.processedLayoutVersion = this.layoutVersion;
      return;
    }

    // Map scrollTop -> anchor page index via prefix sums.
    // virtualOffsets are in layout (unscaled) space, so scrollY must also be in layout space.
    // When the mount has transform: scale(zoom), getBoundingClientRect() returns
    // screen-space values that must be divided by zoom to get layout-space coordinates.
    const paddingTop = this.getMountPaddingTopPx();
    const zoom = this.zoomFactor;
    let scrollY: number;
    const isContainerScrollable = this.mount.scrollHeight > this.mount.clientHeight + 1;
    // Check if the external scroll container is actually scrollable (content overflows its
    // visible area). An element can have overflow:auto but still not scroll if it's in an
    // unconstrained flex layout where the parent has only min-height (no height). In that
    // case the element grows to fit content and scrollTop stays 0 — fall through to the
    // viewport-based calculation instead.
    const scrollCont = this.scrollContainer;
    const isScrollContainerActive = scrollCont != null && scrollCont.scrollHeight > scrollCont.clientHeight + 1;
    if (isContainerScrollable) {
      scrollY = Math.max(0, this.mount.scrollTop - paddingTop);
    } else if (isScrollContainerActive) {
      // Intermediate scroll ancestor (e.g., a wrapper div with overflow-y: auto).
      // Use scrollContainer.scrollTop with a cached mount offset instead of
      // getBoundingClientRect(). Rects are affected by spacer DOM mutations
      // which can cause cascading scroll events and runaway scrolling.
      //
      // mountOffset = distance from scroll container's content top to mount's top.
      // Computed once and cached; invalidated on mount/container/zoom change.
      if (this.scrollContainerMountOffset == null) {
        const mountRect = this.mount.getBoundingClientRect();
        const containerRect = scrollCont.getBoundingClientRect();
        this.scrollContainerMountOffset = mountRect.top - containerRect.top + scrollCont.scrollTop;
      }
      scrollY = Math.max(0, (scrollCont.scrollTop - this.scrollContainerMountOffset) / zoom - paddingTop);
    } else {
      const rect = this.mount.getBoundingClientRect();
      // rect.top is in screen space (affected by CSS transform: scale).
      // Divide by zoom to convert to layout space for comparison with virtualOffsets.
      scrollY = Math.max(0, -rect.top / zoom - paddingTop);
    }

    // Binary search for anchor index such that topOfIndex(i) <= scrollY < topOfIndex(i+1)
    let lo = 0;
    let hi = N; // exclusive
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.topOfIndex(mid) <= scrollY) lo = mid + 1;
      else hi = mid;
    }
    const anchor = Math.max(0, lo - 1);

    // Compute window centered around anchor (approximately), with overscan
    const baseWindow = this.virtualWindow;
    const overscan = this.virtualOverscan;
    let start = anchor - Math.floor(baseWindow / 2) - overscan;
    start = Math.max(0, Math.min(start, Math.max(0, N - baseWindow)));
    const end = Math.min(N - 1, start + baseWindow - 1 + overscan * 2);
    // Adjust start if we overshot end due to trailing clamp
    start = Math.max(0, Math.min(start, end - baseWindow + 1));

    const needed = new Set<number>();
    for (let i = start; i <= end; i += 1) needed.add(i);
    for (const pageIndex of this.virtualPinnedPages) {
      const idx = Math.max(0, Math.min(pageIndex, N - 1));
      needed.add(idx);
    }

    const mounted = Array.from(needed).sort((a, b) => a - b);
    const mountedKey = mounted.join(',');

    // No-op if mounted pages unchanged and nothing changed
    const alreadyProcessedLayout = this.processedLayoutVersion === this.layoutVersion;
    if (mountedKey === this.virtualMountedKey && this.changedBlocks.size === 0 && alreadyProcessedLayout) {
      this.virtualStart = start;
      this.virtualEnd = end;
      this.updateSpacersForMountedPages(mounted);
      return;
    }

    this.virtualMountedKey = mountedKey;
    this.virtualStart = start;
    this.virtualEnd = end;
    this.setMountedPageIndices(mounted);

    // Update spacers + rebuild gap spacers
    this.updateSpacersForMountedPages(mounted);
    this.clearGapSpacers();

    // Reset SDT label tracking so remounted start fragments get their labels back.
    this.sdtLabelsRendered.clear();

    // Remove pages that are no longer needed
    for (const [idx, state] of this.pageIndexToState.entries()) {
      if (!needed.has(idx)) {
        state.element.remove();
        this.pageIndexToState.delete(idx);
      }
    }

    // Insert or patch needed pages
    for (const i of mounted) {
      const page = layout.pages[i];
      const existing = this.pageIndexToState.get(i);
      if (!existing) {
        const newState = this.createPageState(page, i);
        newState.element.dataset.pageNumber = String(page.number);
        newState.element.dataset.pageIndex = String(i);
        // Ensure virtualization uses page margin 0
        applyStyles(newState.element, pageStyles(page.width, page.height, this.getEffectivePageStyles()));
        this.virtualPagesEl.appendChild(newState.element);
        this.pageIndexToState.set(i, newState);
      } else {
        // Patch in place
        this.patchPage(existing, page, i);
      }
    }

    // Ensure top spacer is first, pages container is in the middle, and bottom spacer is last.
    if (this.mount.firstChild !== this.topSpacerEl) {
      this.mount.insertBefore(this.topSpacerEl, this.mount.firstChild);
    }
    if (this.virtualPagesEl.parentElement !== this.mount) {
      this.mount.insertBefore(this.virtualPagesEl, this.bottomSpacerEl);
    }
    this.mount.appendChild(this.bottomSpacerEl);

    // Ensure mounted pages are ordered (with gap spacers).
    // Use cursor-based reconciliation to skip DOM moves for elements already in
    // the correct position. Moving an element via appendChild/insertBefore triggers
    // a browser blur event on any focused descendant, which breaks header/footer
    // in-place editing where a PM editor lives inside a page element (SD-1993).
    let prevIndex: number | null = null;
    let cursor: ChildNode | null = this.virtualPagesEl.firstChild;
    for (const idx of mounted) {
      if (prevIndex != null && idx > prevIndex + 1) {
        const gap = this.doc!.createElement('div');
        this.configureSpacerElement(gap, 'gap');
        gap.dataset.gapFrom = String(prevIndex);
        gap.dataset.gapTo = String(idx);
        const gapHeight =
          this.topOfIndex(idx) - this.topOfIndex(prevIndex) - this.virtualHeights[prevIndex] - this.virtualGap * 2;
        gap.style.height = `${Math.max(0, Math.floor(gapHeight))}px`;
        this.virtualGapSpacers.push(gap);
        // Insert gap before cursor. cursor is NOT advanced because it still
        // points at the next page element that needs to be reconciled.
        this.virtualPagesEl.insertBefore(gap, cursor);
      }
      const state = this.pageIndexToState.get(idx)!;
      if (state.element === cursor) {
        // Already in the correct position. Skip the DOM mutation.
        cursor = state.element.nextSibling;
      } else {
        // Out of order. Move to the correct position.
        this.virtualPagesEl.insertBefore(state.element, cursor);
      }
      prevIndex = idx;
    }

    // Clear changed blocks now that current visible pages are patched
    this.changedBlocks.clear();
    this.processedLayoutVersion = this.layoutVersion;
  }

  private updateSpacers(start: number, end: number): void {
    if (!this.topSpacerEl || !this.bottomSpacerEl) return;
    const top = this.topOfIndex(start);
    const bottom = this.contentTotalHeight() - this.topOfIndex(end + 1);
    this.topSpacerEl.style.height = `${Math.max(0, Math.floor(top))}px`;
    this.bottomSpacerEl.style.height = `${Math.max(0, Math.floor(bottom))}px`;
  }

  private updateSpacersForMountedPages(mountedPageIndices: number[]): void {
    if (!this.topSpacerEl || !this.bottomSpacerEl) return;
    if (mountedPageIndices.length === 0) {
      this.topSpacerEl.style.height = '0px';
      this.bottomSpacerEl.style.height = '0px';
      return;
    }

    const first = mountedPageIndices[0];
    const last = mountedPageIndices[mountedPageIndices.length - 1];
    const n = this.virtualHeights.length;
    const clampedFirst = Math.max(0, Math.min(first, Math.max(0, n - 1)));
    const clampedLast = Math.max(0, Math.min(last, Math.max(0, n - 1)));

    const top = this.topOfIndex(clampedFirst);
    const bottom = this.topOfIndex(n) - this.topOfIndex(clampedLast + 1) - this.virtualGap;
    this.topSpacerEl.style.height = `${Math.max(0, Math.floor(top))}px`;
    this.bottomSpacerEl.style.height = `${Math.max(0, Math.floor(bottom))}px`;
  }

  private clearGapSpacers(): void {
    for (const el of this.virtualGapSpacers) {
      el.remove();
    }
    this.virtualGapSpacers = [];
  }

  private renderHorizontal(layout: ResolvedLayout, mount: HTMLElement): void {
    if (!this.doc) return;
    mount.innerHTML = '';
    layout.pages.forEach((page, pageIndex) => {
      const pageEl = this.renderPage(page.width, page.height, page, pageIndex);
      mount.appendChild(pageEl);
    });
  }

  private renderBookMode(layout: ResolvedLayout, mount: HTMLElement): void {
    if (!this.doc) return;
    mount.innerHTML = '';
    const pages = layout.pages;
    if (pages.length === 0) return;

    const firstPage = pages[0];
    const firstPageEl = this.renderPage(firstPage.width, firstPage.height, firstPage, 0);
    mount.appendChild(firstPageEl);

    for (let i = 1; i < pages.length; i += 2) {
      const spreadEl = this.doc!.createElement('div');
      spreadEl.classList.add(CLASS_NAMES.spread);
      applyStyles(spreadEl, spreadStyles);

      const leftPage = pages[i];
      const leftPageEl = this.renderPage(leftPage.width, leftPage.height, leftPage, i);
      spreadEl.appendChild(leftPageEl);

      if (i + 1 < pages.length) {
        const rightPage = pages[i + 1];
        const rightPageEl = this.renderPage(rightPage.width, rightPage.height, rightPage, i + 1);
        spreadEl.appendChild(rightPageEl);
      }

      mount.appendChild(spreadEl);
    }
  }

  private renderPage(width: number, height: number, page: ResolvedPage, pageIndex: number): HTMLElement {
    if (!this.doc) {
      throw new Error('DomPainter: document is not available');
    }
    const el = this.doc.createElement('div');
    el.classList.add(CLASS_NAMES.page);
    applyStyles(el, pageStyles(width, height, this.getEffectivePageStyles()));
    this.applySemanticPageOverrides(el);
    el.dataset.layoutEpoch = String(this.layoutEpoch);
    el.dataset.pageNumber = String(page.number);
    el.dataset.pageIndex = String(pageIndex);
    // Editor-neutral layout boundary stamp (prep-001). Lets DOM observers
    // negotiate the additive identity contract version without reading
    // package metadata.
    el.dataset[DATASET_KEYS.LAYOUT_BOUNDARY_SCHEMA] = LAYOUT_BOUNDARY_SCHEMA;

    // Render per-page ruler if enabled (suppressed in semantic flow mode)
    if (!this.isSemanticFlow && this.options.ruler?.enabled) {
      const rulerEl = this.renderPageRuler(width, page);
      if (rulerEl) {
        el.appendChild(rulerEl);
      }
    }

    const contextBase: FragmentRenderContext = {
      pageNumber: page.number,
      totalPages: this.totalPages,
      section: 'body',
      pageNumberText: page.numberText,
      displayPageNumber: page.displayNumber,
      pageNumberFormat: page.pageNumberFormat,
      pageNumberChapterText: page.pageNumberChapterText,
      pageNumberChapterSeparator: page.pageNumberChapterSeparator,
      sectionPageCount: this.getSectionPageCount(page),
      pageIndex,
    };

    const resolvedItems = page.items;
    const sdtBoundaries = computeSdtBoundaries(resolvedItems, this.sdtLabelsRendered);
    const betweenBorderFlags = computeBetweenBorderFlags(resolvedItems);

    resolvedItems.forEach((resolvedItem, index) => {
      if (resolvedItem.kind !== 'fragment') return;
      const fragment = resolvedItem.fragment;
      const sdtBoundary = sdtBoundaries.get(index);
      el.appendChild(
        this.renderFragment(fragment, contextBase, sdtBoundary, betweenBorderFlags.get(index), resolvedItem),
      );
    });
    this.renderDecorationsForPage(el, page, pageIndex);
    this.renderColumnSeparators(el, page, width, height);
    return el;
  }

  /**
   * Render a ruler element for a page.
   *
   * Creates a horizontal ruler with tick marks and optional interactive margin handles.
   * The ruler is positioned at the top of the page and displays inch measurements.
   *
   * @param pageWidthPx - Page width in pixels
   * @param page - Page data containing margins and optional size information
   * @returns Ruler element, or null if this.doc is unavailable or page margins are missing
   *
   * Side effects:
   * - Creates DOM elements and applies inline styles
   * - May invoke the onMarginChange callback if interactive mode is enabled
   *
   * Fallback behavior:
   * - Uses DEFAULT_PAGE_HEIGHT_PX (1056px = 11 inches) if page.size.h is not available
   * - Defaults margins to 0 if not explicitly provided
   */
  private renderPageRuler(pageWidthPx: number, page: ResolvedPage): HTMLElement | null {
    if (!this.doc) {
      console.warn('[renderPageRuler] Cannot render ruler: document is not available.');
      return null;
    }

    const margins = page.margins;
    if (!margins) {
      console.warn(`[renderPageRuler] Cannot render ruler for page ${page.number}: margins not available.`);
      return null;
    }

    const leftMargin = margins.left ?? 0;
    const rightMargin = margins.right ?? 0;

    try {
      const rulerDefinition = generateRulerDefinitionFromPx({
        pageWidthPx,
        pageHeightPx: page.height ?? DEFAULT_PAGE_HEIGHT_PX,
        leftMarginPx: leftMargin,
        rightMarginPx: rightMargin,
      });

      const interactive = this.options.ruler?.interactive ?? false;
      const onMarginChange = this.options.ruler?.onMarginChange;

      const rulerEl = createRulerElement({
        definition: rulerDefinition,
        doc: this.doc,
        interactive,
        onDragEnd:
          interactive && onMarginChange
            ? (side, x) => {
                // Convert pixel position to inches for callback
                try {
                  const ppi = 96;
                  const marginInches = side === 'left' ? x / ppi : (pageWidthPx - x) / ppi;
                  onMarginChange(side, marginInches);
                } catch (error) {
                  console.error('[renderPageRuler] Error in onMarginChange callback:', error);
                }
              }
            : undefined,
      });

      // Position ruler at top of page (above content area)
      rulerEl.style.position = 'absolute';
      rulerEl.style.top = '0';
      rulerEl.style.left = '0';
      rulerEl.style.zIndex = '20';
      rulerEl.dataset.pageNumber = String(page.number);

      return rulerEl;
    } catch (error) {
      console.error(`[renderPageRuler] Failed to create ruler for page ${page.number}:`, error);
      return null;
    }
  }

  private renderColumnSeparators(pageEl: HTMLElement, page: ResolvedPage, pageWidth: number, pageHeight: number): void {
    if (!this.doc) return;
    pageEl.querySelectorAll('[data-superdoc-column-separator="true"]').forEach((separator) => separator.remove());

    const pageMargins = page.margins;
    if (!pageMargins) return;

    const leftMargin = pageMargins.left ?? 0;
    const rightMargin = pageMargins.right ?? 0;
    const topMargin = pageMargins.top ?? 0;
    const bottomMargin = pageMargins.bottom ?? 0;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    // Prefer columnRegions (per-region configs for pages with continuous
    // section breaks that change column layout mid-page). Fall back to a
    // single region derived from page.columns so pages without mid-page
    // changes keep working unchanged.
    const regions =
      page.columnRegions ??
      (page.columns
        ? [
            {
              yStart: topMargin,
              yEnd: pageHeight - bottomMargin,
              columns: page.columns,
            },
          ]
        : []);

    for (const region of regions) {
      const { columns, yStart, yEnd } = region;
      if (!columns.withSeparator) continue;
      if (columns.count <= 1) continue;

      const regionHeight = yEnd - yStart;
      if (regionHeight <= 0) continue;

      const separatorPositions = this.getColumnSeparatorPositions(columns, leftMargin, contentWidth);
      if (separatorPositions.length === 0) continue;

      // Word only renders the column separator between columns that both have
      // content. For a 2-col page where col 1 is empty (e.g. the last page of
      // a multi-column section that fits in col 0, or a `nextPage` section
      // where Word fills col 0 first without balancing), Word draws no line
      // even when the section's `w:cols` declared `w:sep="1"`. Gate each
      // separator on whether any fragment sits past it within the region.
      const fragmentsInRegion = page.items.filter((item) => item.y >= yStart - 0.5 && item.y < yEnd + 0.5);

      for (const separatorX of separatorPositions) {
        const hasContentPastSeparator = fragmentsInRegion.some((f) => f.x >= separatorX);
        if (!hasContentPastSeparator) continue;

        const separatorEl = this.doc.createElement('div');
        separatorEl.dataset.superdocColumnSeparator = 'true';

        separatorEl.style.position = 'absolute';
        separatorEl.style.left = `${separatorX}px`;
        separatorEl.style.top = `${yStart}px`;
        separatorEl.style.height = `${regionHeight}px`;
        separatorEl.style.width = '1px';
        separatorEl.style.backgroundColor = '#000000';
        separatorEl.style.pointerEvents = 'none';
        pageEl.appendChild(separatorEl);
      }
    }
  }

  private getColumnSeparatorPositions(columns: ColumnLayout, leftMargin: number, contentWidth: number): number[] {
    // SD-2629: separator positions come from the one resolved column geometry (the same source as
    // fill count and column widths), not a re-derivation here. The caller has already gated on
    // withSeparator and count > 1.
    const normalized = normalizeColumnLayout(columns, contentWidth);
    // Equal mode: skip when the evenly-divided column is too narrow for a 1px line. This must be
    // checked PRE-geometry because normalize floors fabricated widths at 1 (and falls back to the
    // full content width when the gap overflows the content area), so the geometry width alone would
    // not reveal the overflow. Keyed on resolveColumnMode (not the presence of a widths array) so a
    // raw equalWidth:true config carrying stray widths still takes the equal-mode guard. Legacy guard.
    if (resolveColumnMode(columns) === 'equal') {
      const equalWidth = (contentWidth - columns.gap * (normalized.count - 1)) / normalized.count;
      if (equalWidth <= 1) return [];
    }
    const geometry = getColumnGeometry(normalized);
    if (geometry.length <= 1) return [];
    if (geometry.some((column) => column.width <= 1)) return [];
    return getColumnSeparatorPositionsFromGeometry(geometry, leftMargin);
  }
  private renderDecorationsForPage(pageEl: HTMLElement, page: ResolvedPage, pageIndex: number): void {
    if (this.isSemanticFlow) return;
    this.renderDecorationSection(pageEl, page, pageIndex, 'header');
    this.renderDecorationSection(pageEl, page, pageIndex, 'footer');
  }

  /**
   * Check if an anchored fragment has vRelativeFrom === 'page'.
   * Used to determine special Y positioning for page-relative anchored media
   * in header/footer decoration sections.
   */
  private isPageRelativeAnchoredFragment(fragment: Fragment, resolvedItem: ResolvedPaintItem | undefined): boolean {
    if (fragment.kind !== 'image' && fragment.kind !== 'drawing') {
      return false;
    }
    const block = resolvedItem && 'block' in resolvedItem ? resolvedItem.block : undefined;
    if (!block || (block.kind !== 'image' && block.kind !== 'drawing')) {
      return false;
    }
    return block.anchor?.vRelativeFrom === 'page';
  }

  /**
   * Whether an anchored header/footer fragment is page-relative on the HORIZONTAL
   * axis (`hRelativeFrom === 'page'`). Page-horizontal anchors already carry
   * page-local x from the layout engine, so the renderer must not add the left
   * margin again; margin/column-relative anchors carry content-local x and do.
   * This is the horizontal counterpart to {@link isPageRelativeAnchoredFragment}:
   * the two axes are independent, so the left offset must key off hRelativeFrom,
   * not vRelativeFrom (which governs only the top offset).
   */
  private isHorizontallyPageRelativeAnchoredFragment(
    fragment: Fragment,
    resolvedItem: ResolvedPaintItem | undefined,
  ): boolean {
    if (fragment.kind !== 'image' && fragment.kind !== 'drawing') {
      return false;
    }
    const block = resolvedItem && 'block' in resolvedItem ? resolvedItem.block : undefined;
    if (!block || (block.kind !== 'image' && block.kind !== 'drawing')) {
      return false;
    }
    return block.anchor?.hRelativeFrom === 'page';
  }

  private isHeaderFooterAbsoluteOverlayFragment(
    fragment: Fragment,
    kind: 'header' | 'footer',
    resolvedItem: ResolvedPaintItem | undefined,
  ): boolean {
    if (kind !== 'header' && kind !== 'footer') return false;
    if (fragment.kind !== 'image' && fragment.kind !== 'drawing') return false;
    if (fragment.isAnchored !== true) return false;
    const block = resolvedItem && 'block' in resolvedItem ? resolvedItem.block : undefined;
    if (!block || (block.kind !== 'image' && block.kind !== 'drawing')) return false;
    if (block.anchor?.isAnchored !== true) return false;
    if (block.wrap?.type !== 'None') return false;
    if (fragment.behindDoc === true || block.anchor?.behindDoc === true) return false;

    return true;
  }

  private getPageBackgroundDecorationZOrder(fragment: Fragment, resolvedItem: ResolvedPaintItem | undefined): number {
    const block = resolvedItem && 'block' in resolvedItem ? resolvedItem.block : undefined;
    const isDrawingBlock = block?.kind === 'image' || block?.kind === 'drawing';
    const originalAttributes = isDrawingBlock
      ? (block.attrs as { originalAttributes?: unknown } | undefined)?.originalAttributes
      : undefined;
    const normalizedZIndex = normalizeZIndex(originalAttributes);
    const isBehindDoc =
      ((fragment.kind === 'image' || fragment.kind === 'drawing') && fragment.behindDoc === true) ||
      (isDrawingBlock && block.anchor?.behindDoc === true);

    if (isBehindDoc && normalizedZIndex != null) {
      return normalizedZIndex;
    }

    if ((fragment.kind === 'image' || fragment.kind === 'drawing') && typeof fragment.zIndex === 'number') {
      return isBehindDoc ? fragment.zIndex : PAGE_BACKGROUND_OVERLAY_Z_ORDER_OFFSET + Math.max(1, fragment.zIndex);
    }

    if (normalizedZIndex != null) {
      return PAGE_BACKGROUND_OVERLAY_Z_ORDER_OFFSET + Math.max(1, normalizedZIndex);
    }

    return 0;
  }

  private insertPageBackgroundDecoration(pageEl: HTMLElement, fragEl: HTMLElement, zOrder: number): void {
    fragEl.dataset.pageBackgroundZIndex = String(zOrder);
    let lastBackgroundDecoration: Element | null = null;
    let insertBefore: Element | null = null;
    // Patch renders can temporarily leave stale decoration nodes after body
    // fragments. Only the leading decoration run is the page background layer.
    for (const child of Array.from(pageEl.children)) {
      const el = child as HTMLElement;
      if (el.dataset.behindDocSection != null || el.dataset.headerFooterOverlaySection != null) {
        const existingZOrder = Number(el.dataset.pageBackgroundZIndex ?? 0);
        if (existingZOrder > zOrder) {
          insertBefore = el;
          break;
        }
        lastBackgroundDecoration = el;
        continue;
      }

      break;
    }

    pageEl.insertBefore(fragEl, insertBefore ?? lastBackgroundDecoration?.nextSibling ?? pageEl.firstChild);
  }

  /**
   * Header/footer layout emits normalized anchor Y coordinates:
   * - headers: local to the header container origin
   * - footers: local to the top of the footer band (pageHeight - bottomMargin)
   *
   * Footer containers can grow upward when content overflows the reserved footer
   * band, so their top edge is not always the same as the footer band origin.
   * This helper returns the page-space origin that normalized anchor Y values
   * are measured from.
   */
  private getDecorationAnchorPageOriginY(
    page: ResolvedPage,
    kind: 'header' | 'footer',
    effectiveOffset: number,
  ): number {
    if (kind === 'header') {
      return effectiveOffset;
    }

    if (!Number.isFinite(page.height) || page.height <= 0) {
      throw new Error(
        `DomPainter: invalid ResolvedPage.height (${page.height}) for page ${page.index}; resolve stage must produce a positive numeric height.`,
      );
    }

    const pageMargins = page.margins;
    const pageHeight = page.height;

    const footerDistance = pageMargins?.footer;
    if (typeof footerDistance === 'number' && Number.isFinite(footerDistance)) {
      return Math.max(0, pageHeight - Math.max(0, footerDistance));
    }

    const bottomMargin = pageMargins?.bottom;
    if (bottomMargin == null) {
      return effectiveOffset;
    }

    const footnoteReserve = page.footnoteReserved ?? 0;
    const adjustedBottomMargin = Math.max(0, bottomMargin - footnoteReserve);

    return Math.max(0, pageHeight - adjustedBottomMargin);
  }

  private renderDecorationSection(
    pageEl: HTMLElement,
    page: ResolvedPage,
    pageIndex: number,
    kind: 'header' | 'footer',
  ): void {
    if (!this.doc) return;
    const provider = kind === 'header' ? this.headerProvider : this.footerProvider;
    const className = kind === 'header' ? CLASS_NAMES.pageHeader : CLASS_NAMES.pageFooter;
    const existing = pageEl.querySelector(`.${className}`);
    const data = provider ? provider(page.number, page.margins, page) : null;
    const behindDocSelector = `[data-behind-doc-section="${kind}"]`;
    const overlaySelector = `[data-header-footer-overlay-section="${kind}"]`;

    if (!data || data.fragments.length === 0) {
      existing?.remove();
      pageEl.querySelectorAll(behindDocSelector).forEach((el) => el.remove());
      pageEl.querySelectorAll(overlaySelector).forEach((el) => el.remove());
      return;
    }

    const container = (existing as HTMLElement) ?? this.doc.createElement('div');
    container.className = className;
    container.innerHTML = '';
    // Stamp a stable header/footer STORY REF ID
    // (and resolved variant) on the decoration container so host-visible DOM
    // readback can associate the painted region with its header/footer story.
    // The payload already carries `headerFooterRefId` — no upstream import is
    // introduced and the painter boundary is preserved.
    if (typeof data.headerFooterRefId === 'string' && data.headerFooterRefId.length > 0) {
      container.setAttribute('data-sd-headerfooter-ref-id', data.headerFooterRefId);
    } else {
      container.removeAttribute('data-sd-headerfooter-ref-id');
    }
    if (typeof data.sectionType === 'string' && data.sectionType.length > 0) {
      container.setAttribute('data-sd-headerfooter-variant', data.sectionType);
    } else {
      container.removeAttribute('data-sd-headerfooter-variant');
    }
    container.setAttribute('data-sd-headerfooter-kind', kind);
    const baseOffset = data.offset;
    const marginLeft = data.marginLeft ?? 0;
    const pageMargins = page.margins;
    const marginRight = pageMargins?.right ?? 0;

    // For footers, if content is taller than reserved space, expand container upward
    // The container bottom stays anchored at footerMargin from page bottom
    let effectiveHeight = data.height;
    let effectiveOffset = baseOffset;
    if (
      kind === 'footer' &&
      typeof data.contentHeight === 'number' &&
      Number.isFinite(data.contentHeight) &&
      data.contentHeight > 0 &&
      data.contentHeight > data.height
    ) {
      effectiveHeight = data.contentHeight;
      // Move container up to accommodate taller content while keeping bottom edge in place
      effectiveOffset = baseOffset - (data.contentHeight - data.height);
    }

    container.style.position = 'absolute';
    container.style.left = `${marginLeft}px`;
    if (typeof data.contentWidth === 'number') {
      container.style.width = `${Math.max(0, data.contentWidth)}px`;
    } else {
      container.style.width = `calc(100% - ${marginLeft + marginRight}px)`;
    }
    container.style.pointerEvents = 'none';
    container.style.height = `${effectiveHeight}px`;
    container.style.top = `${Math.max(0, effectiveOffset)}px`;
    container.style.zIndex = '1';
    // Allow header/footer content to overflow its container bounds.
    // In OOXML, headers and footers can extend past their allocated margin space
    // into the body region, similar to how body content can have negative indents.
    container.style.overflow = 'visible';

    // Footer page-relative anchors carry normalized Y coordinates (band-local,
    // computed from real page geometry). Compute the page-space origin so the
    // painter can convert them back to absolute page / container-local positions.
    // Header page-relative anchors use raw inner-layout Y and are handled with
    // the simpler effectiveOffset subtraction (unchanged from the baseline).
    const footerAnchorPageOriginY =
      kind === 'footer' ? this.getDecorationAnchorPageOriginY(page, kind, effectiveOffset) : 0;
    const footerAnchorContainerOffsetY = kind === 'footer' ? footerAnchorPageOriginY - effectiveOffset : 0;

    // For footers, calculate offset to push content to bottom of container
    // Fragments are absolutely positioned, so we need to adjust their y values
    // Use effectiveHeight (which accounts for overflow) rather than reserved height
    let footerYOffset = 0;
    if (kind === 'footer' && data.fragments.length > 0) {
      const contentHeight =
        typeof data.contentHeight === 'number'
          ? data.contentHeight
          : data.fragments.reduce((max, f, fi) => {
              const resolvedItem = data.items?.[fi];
              const fragHeight =
                'height' in f && typeof f.height === 'number' ? f.height : this.estimateFragmentHeight(f, resolvedItem);
              return Math.max(max, f.y + Math.max(0, fragHeight));
            }, 0);
      // Offset to push content to bottom of container
      // When container has expanded (effectiveHeight >= contentHeight), offset is 0
      footerYOffset = Math.max(0, effectiveHeight - contentHeight);
    }

    const context: FragmentRenderContext = {
      pageNumber: page.number,
      totalPages: this.totalPages,
      section: kind,
      story: resolveDecorationStory(kind, data),
      pageNumberText: page.numberText,
      displayPageNumber: page.displayNumber,
      pageNumberFormat: page.pageNumberFormat,
      pageNumberChapterText: page.pageNumberChapterText,
      pageNumberChapterSeparator: page.pageNumberChapterSeparator,
      sectionPageCount: this.getSectionPageCount(page),
      pageIndex,
    };

    // Compute between-border flags for header/footer paragraph fragments
    const decorationItems = data.items ?? [];
    const betweenBorderFlags = computeBetweenBorderFlags(decorationItems);

    // Separate page-level behindDoc and foreground wrapNone overlay fragments
    // from normal header/footer container content.
    // Prefer explicit fragment.behindDoc when present. Keep zIndex===0 as a
    // compatibility fallback for older layouts that predate explicit metadata.
    // Track original index for between-border flag lookup.
    const behindDocFragments: { fragment: (typeof data.fragments)[number]; originalIndex: number }[] = [];
    const absoluteOverlayFragments: { fragment: (typeof data.fragments)[number]; originalIndex: number }[] = [];
    const normalFragments: { fragment: (typeof data.fragments)[number]; originalIndex: number }[] = [];

    for (let fi = 0; fi < data.fragments.length; fi += 1) {
      const fragment = data.fragments[fi];
      const resolvedItem = decorationItems[fi];
      let isBehindDoc = false;
      if (fragment.kind === 'image' || fragment.kind === 'drawing') {
        const resolvedMediaItem = resolvedItem as ResolvedImageItem | ResolvedDrawingItem | undefined;
        isBehindDoc =
          fragment.behindDoc === true ||
          (fragment.behindDoc == null && 'zIndex' in fragment && fragment.zIndex === 0) ||
          this.shouldRenderBehindPageContent(fragment, kind, resolvedMediaItem);
      }
      if (isBehindDoc) {
        behindDocFragments.push({ fragment, originalIndex: fi });
      } else if (this.isHeaderFooterAbsoluteOverlayFragment(fragment, kind, resolvedItem)) {
        absoluteOverlayFragments.push({ fragment, originalIndex: fi });
      } else {
        normalFragments.push({ fragment, originalIndex: fi });
      }
    }

    // Remove any previously rendered page-level decoration fragments for this
    // section before re-rendering. Unlike the header/footer container (which
    // uses innerHTML = '' to clear), these fragments are placed directly on
    // the page element and must be explicitly removed.
    pageEl.querySelectorAll(behindDocSelector).forEach((el) => el.remove());
    pageEl.querySelectorAll(overlaySelector).forEach((el) => el.remove());

    // Render behindDoc fragments directly on the page with z-index: 0
    // and insert them at the beginning of the page so they render behind body content.
    // We can't use z-index: -1 because that goes behind the page's white background.
    // By inserting at the beginning and using z-index: 0, they render below body content
    // which also has z-index values but comes later in DOM order.
    behindDocFragments.forEach(({ fragment, originalIndex }) => {
      const resolvedItem = data.items?.[originalIndex];
      const fragEl = this.renderFragment(
        fragment,
        context,
        undefined,
        betweenBorderFlags.get(originalIndex),
        resolvedItem,
      );
      this.applyHeaderFooterTextWatermarkPreviewOpacity(fragEl, data.isActiveHeaderFooter === true);
      const isPageRelative = this.isPageRelativeAnchoredFragment(fragment, resolvedItem);

      let pageY: number;
      if (isPageRelative && kind === 'footer') {
        // Footer page-relative: fragment.y is normalized to band-local coords
        pageY = footerAnchorPageOriginY + fragment.y;
      } else if (isPageRelative) {
        // Header page-relative: fragment.y is raw inner-layout absolute Y
        pageY = fragment.y;
      } else {
        pageY = effectiveOffset + fragment.y + (kind === 'footer' ? footerYOffset : 0);
      }

      const isHorizontallyPageRelative = this.isHorizontallyPageRelativeAnchoredFragment(fragment, resolvedItem);
      fragEl.style.top = `${pageY}px`;
      fragEl.style.left = `${isHorizontallyPageRelative ? fragment.x : marginLeft + fragment.x}px`;
      fragEl.style.zIndex = '0'; // Same level as page, but inserted first so renders behind
      fragEl.dataset.behindDocSection = kind; // Track for cleanup on re-render
      this.insertPageBackgroundDecoration(
        pageEl,
        fragEl,
        this.getPageBackgroundDecorationZOrder(fragment, resolvedItem),
      );
    });

    // Render normal fragments in the header/footer container
    normalFragments.forEach(({ fragment, originalIndex }) => {
      const resolvedItem = data.items?.[originalIndex];
      const fragEl = this.renderFragment(
        fragment,
        context,
        undefined,
        betweenBorderFlags.get(originalIndex),
        resolvedItem,
      );
      this.applyHeaderFooterTextWatermarkPreviewOpacity(fragEl, data.isActiveHeaderFooter === true);
      const isPageRelative = this.isPageRelativeAnchoredFragment(fragment, resolvedItem);

      if (isPageRelative && kind === 'footer') {
        // Footer page-relative: fragment.y is normalized to band-local coords
        fragEl.style.top = `${fragment.y + footerAnchorContainerOffsetY}px`;
      } else if (isPageRelative) {
        // Header page-relative: convert raw inner-layout Y to container-local
        fragEl.style.top = `${fragment.y - effectiveOffset}px`;
      } else if (footerYOffset > 0) {
        // Non-anchored footer content: push to bottom of container
        const currentTop = parseFloat(fragEl.style.top) || fragment.y;
        fragEl.style.top = `${currentTop + footerYOffset}px`;
      }

      container.appendChild(fragEl);
    });

    if (!existing) {
      pageEl.appendChild(container);
    }

    absoluteOverlayFragments.forEach(({ fragment, originalIndex }) => {
      const resolvedItem = data.items?.[originalIndex];
      const fragEl = this.renderFragment(
        fragment,
        context,
        undefined,
        betweenBorderFlags.get(originalIndex),
        resolvedItem,
      );
      const isPageRelative = this.isPageRelativeAnchoredFragment(fragment, resolvedItem);
      this.applyHeaderFooterTextWatermarkPreviewOpacity(fragEl, data.isActiveHeaderFooter === true);

      let pageY: number;
      if (isPageRelative && kind === 'footer') {
        pageY = footerAnchorPageOriginY + fragment.y;
      } else if (isPageRelative) {
        pageY = fragment.y;
      } else {
        pageY = effectiveOffset + fragment.y + (kind === 'footer' ? footerYOffset : 0);
      }

      const isHorizontallyPageRelative = this.isHorizontallyPageRelativeAnchoredFragment(fragment, resolvedItem);
      fragEl.style.top = `${pageY}px`;
      fragEl.style.left = `${isHorizontallyPageRelative ? fragment.x : marginLeft + fragment.x}px`;
      // Header/footer wrapNone shapes still belong to the page background story:
      // keep their authored z-order within that story, but do not let their high
      // OOXML z-index lift them above body content.
      fragEl.style.zIndex = '0';
      // Word parity: header/footer overlay content is inert while editing the
      // body, but becomes clickable once its header/footer session is active.
      if (data.isActiveHeaderFooter !== true) {
        fragEl.style.pointerEvents = 'none';
      }
      fragEl.dataset.headerFooterOverlaySection = kind;
      this.insertPageBackgroundDecoration(
        pageEl,
        fragEl,
        this.getPageBackgroundDecorationZOrder(fragment, resolvedItem),
      );
    });
  }

  private resetState(): void {
    if (this.mount) {
      this.releaseVirtualizationHandlers();
      this.mount.innerHTML = '';
    }
    this.pageStates = [];
    this.currentLayout = null;
    this.pageIndexToState.clear();
    this.topSpacerEl = null;
    this.bottomSpacerEl = null;
    this.virtualPagesEl = null;
    this.scrollContainerMountOffset = null;
    this.layoutVersion = 0;
    this.processedLayoutVersion = -1;
    this.paintSnapshotBuilder = null;
    this.lastPaintSnapshot = null;
    this.mountedPageIndices = [];
  }

  public dispose(): void {
    this.releaseVirtualizationHandlers();
    if (this.mount) {
      this.mount.innerHTML = '';
    }
    this.pageStates = [];
    this.currentLayout = null;
    this.changedBlocks.clear();
    this.sectionPageCounts.clear();
    this.sdtLabelsRendered.clear();
    this.clearGapSpacers();
    this.topSpacerEl = null;
    this.bottomSpacerEl = null;
    this.virtualPagesEl = null;
    this.virtualPinnedPages = [];
    this.virtualMountedKey = '';
    this.pageIndexToState.clear();
    this.virtualHeights = [];
    this.virtualOffsets = [];
    this.virtualStart = 0;
    this.virtualEnd = -1;
    this.scrollContainer = null;
    this.scrollContainerMountOffset = null;
    this.layoutVersion = 0;
    this.layoutEpoch = 0;
    this.processedLayoutVersion = -1;
    this.currentMapping = null;
    this.paintSnapshotBuilder = null;
    this.lastPaintSnapshot = null;
    this.mountedPageIndices = [];
    this.resolvedLayout = null;
    this.totalPages = 0;
    this.mount = null;
    this.doc = null;
  }

  private getSectionPageCount(page: ResolvedPage): number {
    return this.sectionPageCounts.get(page.sectionIndex ?? 0) ?? this.totalPages ?? 1;
  }

  private fullRender(layout: ResolvedLayout): void {
    if (!this.mount || !this.doc) return;
    this.mount.innerHTML = '';
    this.pageStates = [];

    layout.pages.forEach((page, pageIndex) => {
      const pageState = this.createPageState(page, pageIndex);
      pageState.element.dataset.pageNumber = String(page.number);
      pageState.element.dataset.pageIndex = String(pageIndex);
      this.mount!.appendChild(pageState.element);
      this.pageStates.push(pageState);
    });
  }

  private patchLayout(layout: ResolvedLayout): void {
    if (!this.mount || !this.doc) return;

    const nextStates: PageDomState[] = [];

    layout.pages.forEach((page, index) => {
      const prevState = this.pageStates[index];
      if (!prevState) {
        const newState = this.createPageState(page, index);
        newState.element.dataset.pageNumber = String(page.number);
        newState.element.dataset.pageIndex = String(index);
        this.mount!.insertBefore(newState.element, this.mount!.children[index] ?? null);
        nextStates.push(newState);
        return;
      }
      this.patchPage(prevState, page, index);
      nextStates.push(prevState);
    });

    if (this.pageStates.length > layout.pages.length) {
      for (let i = layout.pages.length; i < this.pageStates.length; i += 1) {
        this.pageStates[i]?.element.remove();
      }
    }

    this.pageStates = nextStates;
  }

  private patchPage(state: PageDomState, page: ResolvedPage, pageIndex: number): void {
    const pageEl = state.element;
    applyStyles(pageEl, pageStyles(page.width, page.height, this.getEffectivePageStyles()));
    this.applySemanticPageOverrides(pageEl);
    pageEl.dataset.pageNumber = String(page.number);
    pageEl.dataset.layoutEpoch = String(this.layoutEpoch);
    // pageIndex is already set during creation and doesn't change during patch

    const existing = new Map(state.fragments.map((frag) => [frag.key, frag]));
    const nextFragments: FragmentDomState[] = [];
    const resolvedItems = page.items;
    const sdtBoundaries = computeSdtBoundaries(resolvedItems, this.sdtLabelsRendered);
    const betweenBorderFlags = computeBetweenBorderFlags(resolvedItems);

    const contextBase: FragmentRenderContext = {
      pageNumber: page.number,
      totalPages: this.totalPages,
      section: 'body',
      pageNumberText: page.numberText,
      displayPageNumber: page.displayNumber,
      pageNumberFormat: page.pageNumberFormat,
      pageNumberChapterText: page.pageNumberChapterText,
      pageNumberChapterSeparator: page.pageNumberChapterSeparator,
      sectionPageCount: this.getSectionPageCount(page),
      pageIndex,
    };

    resolvedItems.forEach((resolvedItem, index) => {
      if (resolvedItem.kind !== 'fragment') return;
      const fragment = resolvedItem.fragment;
      const key = fragmentKey(fragment);
      const current = existing.get(key);
      const sdtBoundary = sdtBoundaries.get(index);
      const betweenInfo = betweenBorderFlags.get(index);
      const resolvedSig = resolvedPaintCacheSignature(resolvedItem);

      if (current) {
        existing.delete(key);
        const geometryChanged = hasFragmentGeometryChanged(current.fragment, fragment);
        const sdtBoundaryMismatch = shouldRebuildForSdtBoundary(current.element, sdtBoundary);
        // Detect mismatch in any between-border property
        const betweenBorderMismatch =
          (current.element.dataset.betweenBorder === 'true') !== (betweenInfo?.showBetweenBorder ?? false) ||
          (current.element.dataset.suppressTopBorder === 'true') !== (betweenInfo?.suppressTopBorder ?? false) ||
          (current.element.dataset.gapBelow ?? '') !== (betweenInfo?.gapBelow ? String(betweenInfo.gapBelow) : '');
        const pageContextChanged = needsRebuildForPageContext(current.context, contextBase, resolvedItem);
        // Verify the position mapping is reliable: if mapping the old pmStart doesn't produce
        // the expected new pmStart, the mapping is degenerate (e.g. full-document paste) and
        // we must rebuild to get correct span position attributes.
        const newPmStart = (fragment as { pmStart?: number }).pmStart;
        const mappingUnreliable =
          this.currentMapping != null &&
          newPmStart != null &&
          current.element.dataset.pmStart != null &&
          this.currentMapping.map(Number(current.element.dataset.pmStart)) !== newPmStart;
        const needsRebuild =
          geometryChanged ||
          this.changedBlocks.has(fragment.blockId) ||
          current.signature !== resolvedSig ||
          sdtBoundaryMismatch ||
          betweenBorderMismatch ||
          pageContextChanged ||
          mappingUnreliable;

        if (needsRebuild) {
          const replacement = this.renderFragment(fragment, contextBase, sdtBoundary, betweenInfo, resolvedItem);
          pageEl.replaceChild(replacement, current.element);
          current.element = replacement;
          current.signature = resolvedSig;
        } else if (isNonBodyStoryBlockId(fragment.blockId)) {
          // Story fragments (notes, headers/footers) use story-local positions:
          // the body transaction mapping does not apply, but the resolved item
          // carries FRESH story positions every paint. Shift the painted
          // attributes by the fresh-vs-painted delta so reused fragments never
          // serve stale positions (SD-3400: stale note ranges broke caret,
          // selection, and arrow navigation downstream).
          this.updateStoryPositionAttributes(current.element, resolvedItem);
        } else if (this.currentMapping) {
          // Fragment NOT rebuilt - update position attributes to reflect document changes
          this.updatePositionAttributes(current.element, this.currentMapping);
        }

        this.updateFragmentElement(current.element, fragment, contextBase.section, resolvedItem);
        if (sdtBoundary?.widthOverride != null) {
          current.element.style.width = `${sdtBoundary.widthOverride}px`;
        }
        current.fragment = fragment;
        current.key = key;
        current.context = contextBase;
        nextFragments.push(current);

        return;
      }

      const fresh = this.renderFragment(fragment, contextBase, sdtBoundary, betweenInfo, resolvedItem);
      pageEl.insertBefore(fresh, pageEl.children[index] ?? null);
      nextFragments.push({
        key,
        fragment,
        element: fresh,
        signature: resolvedSig,
        context: contextBase,
      });
    });

    existing.forEach((state) => state.element.remove());

    nextFragments.forEach((fragmentState, index) => {
      const desiredChild = pageEl.children[index];
      if (fragmentState.element !== desiredChild) {
        pageEl.insertBefore(fragmentState.element, desiredChild ?? null);
      }
    });

    state.fragments = nextFragments;
    this.renderDecorationsForPage(pageEl, page, pageIndex);
    this.renderColumnSeparators(pageEl, page, page.width, page.height);
  }

  /**
   * Updates data-pm-start/data-pm-end attributes on all elements within a fragment
   * using the transaction's mapping. Skips header/footer content (separate PM coordinate space).
   * Also skips fragments that end before the edit point (their positions don't change).
   */
  /**
   * Refreshes data-pm-start/data-pm-end on a REUSED story fragment from the
   * fresh resolved item. Story positions are local to their story document,
   * so the body transaction mapping cannot update them; instead the uniform
   * shift between the fresh first position and the painted one is applied.
   * Exact for unchanged blocks (positions inside one block shift uniformly).
   */
  private updateStoryPositionAttributes(fragmentEl: HTMLElement, resolvedItem: ResolvedPaintItem | undefined): void {
    if (!resolvedItem || resolvedItem.kind !== 'fragment') return;

    // Fragment-scoped fresh landmark: the pm start of THIS fragment's first
    // line (matches what render-line stamps as the first painted attribute,
    // including continuation fragments that start mid-block).
    let freshStart: number | undefined;
    const block = 'block' in resolvedItem ? resolvedItem.block : undefined;
    const firstLine = 'content' in resolvedItem ? resolvedItem.content?.lines?.[0]?.line : undefined;
    if (block && firstLine) {
      const range = computeLinePmRange(block, firstLine);
      if (typeof range.pmStart === 'number' && Number.isFinite(range.pmStart)) {
        freshStart = range.pmStart;
      }
    }
    if (freshStart == null && block) {
      const runs = (block as { runs?: Array<{ pmStart?: number | null }> }).runs;
      if (Array.isArray(runs)) {
        for (const run of runs) {
          if (typeof run?.pmStart === 'number' && Number.isFinite(run.pmStart)) {
            freshStart = run.pmStart;
            break;
          }
        }
      }
    }
    if (freshStart == null || !Number.isFinite(freshStart)) return;

    const elements = [
      fragmentEl,
      ...Array.from(fragmentEl.querySelectorAll<HTMLElement>('[data-pm-start], [data-pm-end]')),
    ];
    let paintedStart = Infinity;
    for (const el of elements) {
      const start = Number(el.dataset.pmStart);
      if (Number.isFinite(start)) paintedStart = Math.min(paintedStart, start);
    }
    if (!Number.isFinite(paintedStart)) return;

    const delta = freshStart - paintedStart;
    if (delta === 0) return;

    for (const el of elements) {
      const start = Number(el.dataset.pmStart);
      if (el.dataset.pmStart !== undefined && el.dataset.pmStart !== '' && Number.isFinite(start)) {
        el.dataset.pmStart = String(start + delta);
      }
      const end = Number(el.dataset.pmEnd);
      if (el.dataset.pmEnd !== undefined && el.dataset.pmEnd !== '' && Number.isFinite(end)) {
        el.dataset.pmEnd = String(end + delta);
      }
    }
  }

  private updatePositionAttributes(fragmentEl: HTMLElement, mapping: PositionMapping): void {
    // Skip header/footer elements (they use a separate PM coordinate space)
    if (fragmentEl.closest('.superdoc-page-header, .superdoc-page-footer')) {
      return;
    }
    // Notes use local story positions, so body mappings must not rewrite them.
    if (isNonBodyStoryBlockId(fragmentEl.dataset.blockId)) {
      return;
    }

    // Wrap mapping logic in try-catch to prevent corrupted mappings from crashing paint cycle
    try {
      // Quick check: if the fragment's end position doesn't change, nothing inside needs updating.
      // This happens for all content BEFORE the edit point.
      const fragEnd = fragmentEl.dataset.pmEnd;
      if (fragEnd !== undefined && fragEnd !== '') {
        const endNum = Number(fragEnd);
        if (Number.isFinite(endNum) && mapping.map(endNum, -1) === endNum) {
          // Fragment ends before edit point - no position changes needed
          return;
        }
      }

      // Get all elements with position attributes (including the fragment element itself)
      const elements = fragmentEl.querySelectorAll('[data-pm-start], [data-pm-end]');
      const allElements = [fragmentEl, ...Array.from(elements)] as HTMLElement[];

      for (const el of allElements) {
        const oldStart = el.dataset.pmStart;
        const oldEnd = el.dataset.pmEnd;

        if (oldStart !== undefined && oldStart !== '') {
          const num = Number(oldStart);
          if (Number.isFinite(num)) {
            el.dataset.pmStart = String(mapping.map(num));
          }
        }

        if (oldEnd !== undefined && oldEnd !== '') {
          const num = Number(oldEnd);
          if (Number.isFinite(num)) {
            // Use bias -1 for end positions to handle edge cases correctly
            el.dataset.pmEnd = String(mapping.map(num, -1));
          }
        }
      }
    } catch (error) {
      // Log the error but don't crash the paint cycle - corrupted mappings shouldn't break rendering
      console.error('Error updating position attributes with mapping:', error);
    }
  }

  private createPageState(page: ResolvedPage, pageIndex: number): PageDomState {
    if (!this.doc) {
      throw new Error('DomPainter.createPageState requires a document');
    }
    const el = this.doc.createElement('div');
    el.classList.add(CLASS_NAMES.page);
    applyStyles(el, pageStyles(page.width, page.height, this.getEffectivePageStyles()));
    this.applySemanticPageOverrides(el);
    el.dataset.layoutEpoch = String(this.layoutEpoch);
    // Editor-neutral layout boundary stamp (prep-001). See `renderPage` for
    // the spread/horizontal flow that stamps the same attribute.
    el.dataset[DATASET_KEYS.LAYOUT_BOUNDARY_SCHEMA] = LAYOUT_BOUNDARY_SCHEMA;

    const contextBase: FragmentRenderContext = {
      pageNumber: page.number,
      totalPages: this.totalPages,
      section: 'body',
      pageNumberText: page.numberText,
      displayPageNumber: page.displayNumber,
      pageNumberFormat: page.pageNumberFormat,
      pageNumberChapterText: page.pageNumberChapterText,
      pageNumberChapterSeparator: page.pageNumberChapterSeparator,
      sectionPageCount: this.getSectionPageCount(page),
      pageIndex,
    };

    const resolvedItems = page.items;
    const sdtBoundaries = computeSdtBoundaries(resolvedItems, this.sdtLabelsRendered);
    const betweenBorderFlags = computeBetweenBorderFlags(resolvedItems);
    const fragmentStates: FragmentDomState[] = resolvedItems.flatMap((resolvedItem, index) => {
      if (resolvedItem.kind !== 'fragment') return [];
      const fragment = resolvedItem.fragment;
      const sdtBoundary = sdtBoundaries.get(index);
      const fragmentEl = this.renderFragment(
        fragment,
        contextBase,
        sdtBoundary,
        betweenBorderFlags.get(index),
        resolvedItem,
      );
      el.appendChild(fragmentEl);
      const initSig = resolvedPaintCacheSignature(resolvedItem);
      return [
        {
          key: fragmentKey(fragment),
          signature: initSig,
          fragment,
          element: fragmentEl,
          context: contextBase,
        },
      ];
    });

    this.renderDecorationsForPage(el, page, pageIndex);
    this.renderColumnSeparators(el, page, page.width, page.height);
    return { element: el, fragments: fragmentStates };
  }

  private applySemanticPageOverrides(el: HTMLElement): void {
    if (this.isSemanticFlow) {
      el.style.overflow = 'visible';
      el.style.width = '100%';
      el.style.minWidth = '100%';
    }
  }

  private getEffectivePageStyles(): PageStyles | undefined {
    const documentBackgroundColor = this.currentLayout?.documentBackground?.color;
    const base = this.options.pageStyles ?? {};
    const baseWithDocumentBackground = documentBackgroundColor
      ? { ...base, background: documentBackgroundColor }
      : base;

    if (this.isSemanticFlow) {
      return {
        ...baseWithDocumentBackground,
        background: baseWithDocumentBackground.background ?? 'var(--sd-layout-page-bg, #fff)',
        boxShadow: 'none',
        border: 'none',
        margin: '0',
      };
    }
    if (this.virtualEnabled && this.layoutMode === 'vertical') {
      // Remove top/bottom margins to avoid double-counting with container gap during virtualization
      return { ...baseWithDocumentBackground, margin: '0 auto' };
    }
    return documentBackgroundColor ? baseWithDocumentBackground : this.options.pageStyles;
  }

  private renderFragment(
    fragment: Fragment,
    context: FragmentRenderContext,
    sdtBoundary?: SdtBoundaryOptions,
    betweenInfo?: BetweenBorderInfo,
    resolvedItem?: ResolvedPaintItem,
  ): HTMLElement {
    if (fragment.kind === 'para') {
      return this.renderParagraphFragment(
        fragment,
        context,
        sdtBoundary,
        betweenInfo,
        resolvedItem as ResolvedFragmentItem | undefined,
      );
    }
    if (fragment.kind === 'image') {
      return this.renderImageFragment(fragment, context, resolvedItem as ResolvedImageItem | undefined);
    }
    if (fragment.kind === 'drawing') {
      return this.renderDrawingFragment(fragment, context, resolvedItem as ResolvedDrawingItem | undefined);
    }
    if (fragment.kind === 'table') {
      return this.renderTableFragment(fragment, context, sdtBoundary, resolvedItem as ResolvedTableItem | undefined);
    }
    throw new Error(`DomPainter: unsupported fragment kind ${(fragment as Fragment).kind}`);
  }

  /**
   * Renders a paragraph fragment with defensive error handling.
   * Falls back to error placeholder on rendering errors to prevent full paint failure.
   *
   * @param fragment - The paragraph fragment to render
   * @param context - Rendering context with page and column information
   * @param sdtBoundary - Optional SDT boundary overrides for multi-fragment containers
   * @returns HTMLElement containing the rendered fragment or error placeholder
   */
  private renderParagraphFragment(
    fragment: ParaFragment,
    context: FragmentRenderContext,
    sdtBoundary?: SdtBoundaryOptions,
    betweenInfo?: BetweenBorderInfo,
    resolvedItem?: ResolvedFragmentItem,
  ): HTMLElement {
    return renderParagraphFragmentElement({
      doc: this.doc,
      fragment,
      sdtBoundary,
      betweenInfo,
      resolvedItem,
      applyStyles,
      applyResolvedFragmentFrame: (el, item, paraFragment) =>
        this.applyResolvedFragmentFrame(el, item, paraFragment, context.section, context.story),
      applyFragmentFrame: (el, paraFragment) =>
        this.applyFragmentFrame(el, paraFragment, context.section, context.story),
      applySdtDataset,
      applyContainerSdtDataset,
      // Per-document font resolver so list markers and drop caps paint the same physical family
      // they were measured in (undefined => the renderers fall back to the global default).
      resolvePhysical: this.options.resolvePhysical,
      renderLine: ({
        block,
        line,
        availableWidth,
        lineIndex,
        skipJustify,
        preExpandedRuns,
        resolvedListTextStartPx,
        indentOffsetOverride,
        paragraphMarkLeftOffsetOverride,
      }) =>
        this.renderLine(
          block,
          line,
          context,
          availableWidth,
          lineIndex,
          skipJustify,
          preExpandedRuns,
          resolvedListTextStartPx,
          indentOffsetOverride,
          paragraphMarkLeftOffsetOverride,
        ),
      captureLineSnapshot: (lineEl, options) => {
        this.capturePaintSnapshotLine(lineEl, context, {
          inTableFragment: false,
          inTableParagraph: false,
          wrapperEl: options?.wrapperEl,
          sourceAnchor: options?.sourceAnchor,
        });
      },
      contentControlsChrome: this.contentControlsChrome,
      createErrorPlaceholder: this.createErrorPlaceholder.bind(this),
    });
  }

  /**
   * Creates an error placeholder element for failed fragment renders.
   * Prevents entire paint operation from failing due to single fragment error.
   *
   * @param blockId - The block ID that failed to render
   * @param error - The error that occurred
   * @returns HTMLElement showing the error
   */
  private createErrorPlaceholder(blockId: string, error: unknown): HTMLElement {
    if (!this.doc) {
      // Fallback if doc is not available
      const el = document.createElement('div');
      el.className = 'render-error-placeholder';
      el.style.cssText = 'color: red; padding: 4px; border: 1px solid red; background: #fee;';
      el.textContent = `[Render Error: ${blockId}]`;
      return el;
    }

    const el = this.doc.createElement('div');
    el.className = 'render-error-placeholder';
    el.style.cssText = 'color: red; padding: 4px; border: 1px solid red; background: #fee;';
    el.textContent = `[Render Error: ${blockId}]`;
    if (error instanceof Error) {
      el.title = error.message;
    }
    return el;
  }

  private renderImageFragment(
    fragment: ImageFragment,
    context: FragmentRenderContext,
    resolvedItem?: ResolvedImageItem,
  ): HTMLElement {
    const fragmentEl = renderImageFragmentElement({
      doc: this.doc,
      fragment,
      context,
      resolvedItem,
      applyResolvedFragmentFrame: (el, item, imageFragment, section) =>
        this.applyResolvedFragmentFrame(el, item, imageFragment, section, context.story),
      applyFragmentFrame: (el, imageFragment, section) =>
        this.applyFragmentFrame(el, imageFragment, section, context.story),
      applyFragmentWrapperZIndex: this.applyFragmentWrapperZIndex.bind(this),
      applySdtDataset,
      applyContainerSdtDataset,
      buildImageHyperlinkAnchor: this.buildImageHyperlinkAnchor.bind(this),
      createErrorPlaceholder: this.createErrorPlaceholder.bind(this),
    });

    if (this.isVmlTextWatermarkImage(resolvedItem?.block)) {
      fragmentEl.dataset.vmlTextWatermark = 'true';
    }

    return fragmentEl;
  }

  /**
   * Optionally wrap an image element in an anchor for DrawingML hyperlinks (a:hlinkClick).
   *
   * When `hyperlink` is present and its URL passes sanitization, returns an
   * `<a class="superdoc-link">` wrapping `imageEl`. The existing EditorInputManager
   * click-delegation on `a.superdoc-link` handles both viewing-mode navigation and
   * editing-mode event dispatch automatically, with no extra wiring needed here.
   *
   * When `hyperlink` is absent or the URL fails sanitization the original element
   * is returned unchanged.
   *
   * @param imageEl   - The image element (img or span wrapper) to potentially wrap.
   * @param hyperlink - Hyperlink metadata from the ImageBlock/ImageRun, or undefined.
   * @param display   - CSS display value for the anchor: 'block' for fragment images,
   *                    'inline-block' for inline runs.
   */
  private buildImageHyperlinkAnchor(
    imageEl: HTMLElement,
    hyperlink: ImageHyperlink | undefined,
    display: 'block' | 'inline-block',
  ): HTMLElement {
    if (!this.doc) return imageEl;
    return buildSharedImageHyperlinkAnchor(this.doc, imageEl, hyperlink, display);
  }

  private renderDrawingFragment(
    fragment: DrawingFragment,
    context: FragmentRenderContext,
    resolvedItem?: ResolvedDrawingItem,
  ): HTMLElement {
    try {
      // Pre-extracted block from the resolved item.
      if (resolvedItem?.block?.kind !== 'drawing') {
        throw new Error(`DomPainter: missing resolved drawing block for fragment ${fragment.blockId}`);
      }
      const block = resolvedItem.block as DrawingBlock;
      if (!this.doc) {
        throw new Error('DomPainter: document is not available');
      }
      const fragmentEl = this.doc.createElement('div');
      fragmentEl.classList.add(CLASS_NAMES.fragment, 'superdoc-drawing-fragment');
      applyStyles(fragmentEl, fragmentStyles);
      if (resolvedItem) {
        this.applyResolvedFragmentFrame(fragmentEl, resolvedItem, fragment, context.section, context.story);
      } else {
        this.applyFragmentFrame(fragmentEl, fragment, context.section, context.story);
        fragmentEl.style.height = `${fragment.height}px`;
        this.applyFragmentWrapperZIndex(fragmentEl, fragment);
      }
      fragmentEl.style.position = 'absolute';
      fragmentEl.style.overflow = 'hidden';

      const innerWrapper = this.doc.createElement('div');
      innerWrapper.classList.add('superdoc-drawing-inner');
      innerWrapper.style.position = 'absolute';
      innerWrapper.style.left = '50%';
      innerWrapper.style.top = '50%';
      innerWrapper.style.width = `${fragment.geometry.width}px`;
      innerWrapper.style.height = `${fragment.geometry.height}px`;
      innerWrapper.style.transformOrigin = 'center';
      if (block.drawingKind === 'shapeGroup' && block.groupTransform) {
        const effectExtent = block.effectExtent ?? { left: 0, top: 0, right: 0, bottom: 0 };
        const groupWidth =
          block.groupTransform.width ?? Math.max(0, block.geometry.width - effectExtent.left - effectExtent.right);
        const groupHeight =
          block.groupTransform.height ?? Math.max(0, block.geometry.height - effectExtent.top - effectExtent.bottom);
        const originX = effectExtent.left + groupWidth / 2;
        const originY = effectExtent.top + groupHeight / 2;
        innerWrapper.style.transformOrigin = `${originX}px ${originY}px`;
      }

      const scale = fragment.scale ?? 1;
      const transforms: string[] = ['translate(-50%, -50%)'];
      transforms.push(`rotate(${fragment.geometry.rotation ?? 0}deg)`);
      transforms.push(`scaleX(${fragment.geometry.flipH ? -1 : 1})`);
      transforms.push(`scaleY(${fragment.geometry.flipV ? -1 : 1})`);
      transforms.push(`scale(${scale})`);
      innerWrapper.style.transform = transforms.join(' ');

      innerWrapper.appendChild(this.renderDrawingContent(block, fragment, context));
      fragmentEl.appendChild(innerWrapper);

      return fragmentEl;
    } catch (error) {
      console.error('[DomPainter] Drawing fragment rendering failed:', { fragment, error });
      return this.createErrorPlaceholder(fragment.blockId, error);
    }
  }

  private renderDrawingContent(
    block: DrawingBlock,
    fragment: DrawingFragment,
    context?: FragmentRenderContext,
  ): HTMLElement {
    if (!this.doc) {
      throw new Error('DomPainter: document is not available');
    }
    if (block.drawingKind === 'image') {
      return createDrawingImageElement(this.doc, block, this.buildImageHyperlinkAnchor.bind(this));
    }
    if (block.drawingKind === 'vectorShape' || block.drawingKind === 'textboxShape') {
      return this.createVectorShapeElement(block, fragment.geometry, false, 1, 1, context, fragment);
    }
    if (block.drawingKind === 'shapeGroup') {
      return this.createShapeGroupElement(block, context, fragment.geometry);
    }
    if (block.drawingKind === 'chart') {
      return this.createChartElement(block);
    }
    return this.createDrawingPlaceholder();
  }

  private createVectorShapeElement(
    block: ShapeTextDrawingWithEffects,
    geometry?: DrawingGeometry,
    applyTransforms = false,
    groupScaleX = 1,
    groupScaleY = 1,
    context?: FragmentRenderContext,
    fragment?: DrawingFragment,
  ): HTMLElement {
    const container = this.doc!.createElement('div');
    container.classList.add('superdoc-vector-shape');
    if (block.drawingKind === 'textboxShape') {
      container.classList.add('superdoc-textbox-shape');
    }
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    const { offsetX, offsetY, innerWidth, innerHeight } = this.getEffectExtentMetrics(block, geometry);
    const contentContainer = this.doc!.createElement('div');
    contentContainer.style.position = 'absolute';
    contentContainer.style.left = `${offsetX}px`;
    contentContainer.style.top = `${offsetY}px`;
    contentContainer.style.width = `${innerWidth}px`;
    contentContainer.style.height = `${innerHeight}px`;
    if (applyTransforms && geometry) {
      this.applyVectorShapeTransforms(contentContainer, geometry);
    }

    // Custom geometry takes priority — shapeKind may carry a schema default ('rect')
    // even when the source shape only had a:custGeom and no a:prstGeom.
    const customGeomSvg = block.customGeometry ? this.tryCreateCustomGeometrySvg(block, innerWidth, innerHeight) : null;
    const svgMarkup =
      !customGeomSvg && block.shapeKind ? this.tryCreatePresetSvg(block, innerWidth, innerHeight) : null;
    const resolvedSvgMarkup = customGeomSvg || svgMarkup;

    if (resolvedSvgMarkup) {
      const svgElement = this.parseSafeSvg(resolvedSvgMarkup);
      if (svgElement) {
        svgElement.setAttribute('width', '100%');
        svgElement.setAttribute('height', '100%');
        svgElement.style.display = 'block';
        svgElement.style.overflow = 'visible';

        // Apply gradient fill if present
        if (block.fillColor && typeof block.fillColor === 'object') {
          if ('type' in block.fillColor && block.fillColor.type === 'gradient') {
            applyGradientToSVG(svgElement, block.fillColor as GradientFill);
          } else if ('type' in block.fillColor && block.fillColor.type === 'solidWithAlpha') {
            applyAlphaToSVG(svgElement, block.fillColor as SolidFillWithAlpha);
          }
        }

        // Shadows paint inside the docx-provided effectExtent box. Do not derive extra visual room here;
        // files with missing or undersized effectExtent can still clip large outer shadows.
        this.applyShapeEffects(svgElement, block);
        this.applyLineEnds(svgElement, block);
        contentContainer.appendChild(svgElement);

        if (block.drawingKind === 'textboxShape' || this.hasShapeTextContent(block.textContent)) {
          const textElement =
            block.drawingKind === 'textboxShape'
              ? this.createTextboxContentElement(block, fragment, innerWidth, innerHeight, context)
              : this.createShapeTextElement(block, innerWidth, innerHeight, groupScaleX, groupScaleY, context);
          contentContainer.appendChild(textElement);
        }

        container.appendChild(contentContainer);
        return container;
      }
    }

    // Fallback rendering when no preset shape SVG is available
    this.applyFallbackShapeStyle(contentContainer, block);

    if (block.drawingKind === 'textboxShape' || this.hasShapeTextContent(block.textContent)) {
      const textElement =
        block.drawingKind === 'textboxShape'
          ? this.createTextboxContentElement(block, fragment, innerWidth, innerHeight, context)
          : this.createShapeTextElement(block, innerWidth, innerHeight, groupScaleX, groupScaleY, context);
      contentContainer.appendChild(textElement);
    }

    container.appendChild(contentContainer);
    return container;
  }

  /**
   * Apply fill and stroke styles to a fallback shape container
   */
  private applyFallbackShapeStyle(container: HTMLElement, block: ShapeTextDrawingWithEffects): void {
    // Handle fill color
    if (block.fillColor === null) {
      container.style.background = 'none';
    } else if (typeof block.fillColor === 'string') {
      container.style.background = block.fillColor;
    } else if (typeof block.fillColor === 'object' && 'type' in block.fillColor) {
      if (block.fillColor.type === 'solidWithAlpha') {
        const alpha = (block.fillColor as SolidFillWithAlpha).alpha;
        const color = (block.fillColor as SolidFillWithAlpha).color;
        container.style.background = color;
        container.style.opacity = alpha.toString();
      } else if (block.fillColor.type === 'gradient') {
        // For CSS gradients in fallback, we'd need to convert
        // For now, use a placeholder color
        container.style.background = 'rgba(15, 23, 42, 0.1)';
      }
    } else {
      container.style.background = 'rgba(15, 23, 42, 0.1)';
    }

    // Handle stroke color
    if (block.strokeColor === null) {
      container.style.border = 'none';
    } else if (typeof block.strokeColor === 'string') {
      const strokeWidth = block.strokeWidth ?? 1;
      container.style.border = `${strokeWidth}px solid ${block.strokeColor}`;
    } else {
      container.style.border = '1px solid rgba(15, 23, 42, 0.3)';
    }
  }

  private hasShapeTextContent(textContent?: ShapeTextContent): textContent is ShapeTextContent {
    return Array.isArray(textContent?.parts) && textContent.parts.length > 0;
  }

  private createShapeTextElement(
    block: VectorShapeDrawing | TextboxDrawing,
    width: number,
    height: number,
    groupScaleX = 1,
    groupScaleY = 1,
    context?: FragmentRenderContext,
  ): Element {
    const textContent = block.textContent;
    if (!this.hasShapeTextContent(textContent)) {
      return this.doc!.createElement('div');
    }

    if (this.shouldUseWordArtTextRenderer(block)) {
      return this.createWordArtTextElement(
        textContent,
        block.textAlign ?? 'center',
        block.textInsets,
        width,
        height,
        context,
      );
    }

    return this.createFallbackTextElement(
      textContent,
      block.textAlign ?? 'center',
      block.textVerticalAlign,
      block.textInsets,
      groupScaleX,
      groupScaleY,
      context,
    );
  }

  private createTextboxContentElement(
    block: TextboxDrawing,
    fragment: DrawingFragment | undefined,
    width: number,
    height: number,
    context?: FragmentRenderContext,
  ): Element {
    const contentMeasures = fragment?.contentMeasures ?? block.contentMeasures;
    if (!Array.isArray(contentMeasures) || contentMeasures.length === 0) {
      return this.hasShapeTextContent(block.textContent)
        ? this.createShapeTextElement(block, width, height, 1, 1, context)
        : this.doc!.createElement('div');
    }

    const contentRoot = this.doc!.createElement('div');
    contentRoot.style.position = 'absolute';
    contentRoot.style.top = '0';
    contentRoot.style.left = '0';
    contentRoot.style.width = '100%';
    contentRoot.style.height = '100%';
    contentRoot.style.display = 'flex';
    contentRoot.style.flexDirection = 'column';
    contentRoot.style.boxSizing = 'border-box';
    contentRoot.style.overflow = 'hidden';

    const insets = block.textInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    contentRoot.style.padding = `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`;

    const verticalAlign = block.textVerticalAlign ?? 'top';
    contentRoot.style.justifyContent =
      verticalAlign === 'bottom' ? 'flex-end' : verticalAlign === 'center' ? 'center' : 'flex-start';

    const linesHost = this.doc!.createElement('div');
    linesHost.style.display = 'flex';
    linesHost.style.flexDirection = 'column';
    linesHost.style.minWidth = '0';
    linesHost.style.width = '100%';

    const renderContext = context ?? this.defaultFragmentRenderContext();
    const availableWidth = Math.max(1, width - insets.left - insets.right);

    block.contentBlocks.forEach((paragraphBlock, paragraphIndex) => {
      const measure = contentMeasures[paragraphIndex];
      if (!measure?.lines) return;
      measure.lines.forEach((line, lineIndex) => {
        linesHost.appendChild(this.renderLine(paragraphBlock, line, renderContext, availableWidth, lineIndex));
      });
    });

    contentRoot.appendChild(linesHost);
    return contentRoot;
  }

  private shouldUseWordArtTextRenderer(block: VectorShapeDrawing | TextboxDrawing): boolean {
    return block.attrs?.isWordArt === true && this.hasShapeTextContent(block.textContent);
  }

  private createWordArtTextElement(
    textContent: ShapeTextContent,
    textAlign: string,
    textInsets: { top: number; right: number; bottom: number; left: number } | undefined,
    width: number,
    height: number,
    context?: FragmentRenderContext,
  ): SVGSVGElement {
    const svg = this.doc!.createElementNS(SVG_NS, 'svg');
    svg.classList.add('superdoc-wordart-text');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';

    const insets = textInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const availableWidth = Math.max(1, width - insets.left - insets.right);
    const availableHeight = Math.max(1, height - insets.top - insets.bottom);
    const lines = this.buildWordArtLines(textContent, context);
    const lineCount = Math.max(lines.length, 1);
    const lineHeight = availableHeight / lineCount;
    const fontSize = Math.max(1, lineHeight * WORDART_LINE_FILL_RATIO);
    const textAnchor = this.getWordArtTextAnchor(textAlign);
    const textX = this.getWordArtTextX(textAlign, insets.left, availableWidth);

    lines.forEach((parts, lineIndex) => {
      if (parts.length === 0) {
        return;
      }

      const textEl = this.doc!.createElementNS(SVG_NS, 'text');
      textEl.setAttribute('xml:space', 'preserve');
      textEl.setAttribute('x', String(textX));
      textEl.setAttribute('y', String(insets.top + lineHeight * (lineIndex + 0.5)));
      textEl.setAttribute('text-anchor', textAnchor);
      textEl.setAttribute('dominant-baseline', 'middle');
      textEl.setAttribute('font-size', String(fontSize));
      textEl.setAttribute('textLength', String(availableWidth));
      textEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');

      parts.forEach((part) => {
        const tspan = this.doc!.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('xml:space', 'preserve');
        tspan.textContent = part.text;
        this.applyWordArtTextFormatting(tspan, part.formatting);
        textEl.appendChild(tspan);
      });

      svg.appendChild(textEl);
    });

    return svg;
  }

  private buildWordArtLines(
    textContent: ShapeTextContent,
    context?: FragmentRenderContext,
  ): Array<Array<{ text: string; formatting?: ShapeTextContent['parts'][number]['formatting'] }>> {
    const lines: Array<Array<{ text: string; formatting?: ShapeTextContent['parts'][number]['formatting'] }>> = [[]];

    textContent.parts.forEach((part) => {
      if (part.isLineBreak) {
        lines.push([]);
        return;
      }

      const resolvedText = this.resolveShapeTextPartText(part, context);
      if (!resolvedText) {
        return;
      }

      lines[lines.length - 1].push({
        text: resolvedText,
        formatting: part.formatting,
      });
    });

    const nonEmptyLines = lines.filter((line) => line.length > 0);
    return nonEmptyLines.length > 0 ? nonEmptyLines : [[]];
  }

  private resolveShapeTextPartText(part: ShapeTextContent['parts'][number], context?: FragmentRenderContext): string {
    if (part.fieldType === 'PAGE') {
      if (part.pageNumberFormat || context?.pageNumberChapterText) {
        return formatSectionPageNumberText({
          displayNumber: context?.displayPageNumber ?? context?.pageNumber ?? 1,
          pageFormat: part.pageNumberFormat ?? context?.pageNumberFormat ?? 'decimal',
          chapterNumberText: context?.pageNumberChapterText,
          chapterSeparator: context?.pageNumberChapterSeparator,
        });
      }
      return context?.pageNumberText ?? String(context?.pageNumber ?? 1);
    }
    if (part.fieldType === 'NUMPAGES') {
      const totalPages = context?.totalPages ?? 1;
      return part.pageNumberFormat ? formatPageNumber(totalPages, part.pageNumberFormat) : String(totalPages);
    }
    if (part.fieldType === 'SECTIONPAGES') {
      if (context?.sectionPageCount == null) return part.text ?? '1';
      const sectionPageCount = context.sectionPageCount;
      return part.pageNumberFormat
        ? formatPageNumber(sectionPageCount, part.pageNumberFormat)
        : String(sectionPageCount);
    }
    return part.text;
  }

  private getWordArtTextAnchor(textAlign: string): 'start' | 'middle' | 'end' {
    if (textAlign === 'right' || textAlign === 'r') {
      return 'end';
    }
    if (textAlign === 'center') {
      return 'middle';
    }
    return 'start';
  }

  private getWordArtTextX(textAlign: string, leftInset: number, availableWidth: number): number {
    if (textAlign === 'right' || textAlign === 'r') {
      return leftInset + availableWidth;
    }
    if (textAlign === 'center') {
      return leftInset + availableWidth / 2;
    }
    return leftInset;
  }

  private applyWordArtTextFormatting(
    element: SVGTextElement | SVGTSpanElement,
    formatting?: ShapeTextContent['parts'][number]['formatting'],
  ): void {
    if (!formatting) {
      return;
    }
    if (formatting.bold) {
      element.setAttribute('font-weight', 'bold');
    }
    if (formatting.italic) {
      element.setAttribute('font-style', 'italic');
    }
    if (formatting.fontFamily) {
      element.setAttribute('font-family', formatting.fontFamily);
    }
    if (formatting.color) {
      const validatedColor = validateHexColor(formatting.color);
      if (validatedColor) {
        element.setAttribute('fill', validatedColor);
      }
    }
    if (formatting.letterSpacing != null) {
      element.setAttribute('letter-spacing', String(formatting.letterSpacing));
    }
  }

  /**
   * Create a fallback text element for shapes without SVG
   * @param textContent - Text content with formatting
   * @param textAlign - Horizontal text alignment
   * @param textVerticalAlign - Vertical text alignment (top, center, bottom)
   * @param textInsets - Text insets in pixels (top, right, bottom, left)
   * @param groupScaleX - Scale factor applied by parent group (for counter-scaling)
   * @param groupScaleY - Scale factor applied by parent group (for counter-scaling)
   */
  private createFallbackTextElement(
    textContent: ShapeTextContent,
    textAlign: string,
    textVerticalAlign?: 'top' | 'center' | 'bottom',
    textInsets?: { top: number; right: number; bottom: number; left: number },
    groupScaleX = 1,
    groupScaleY = 1,
    context?: FragmentRenderContext,
  ): HTMLElement {
    const textDiv = this.doc!.createElement('div');
    textDiv.style.position = 'absolute';
    textDiv.style.top = '0';
    textDiv.style.left = '0';
    textDiv.style.width = '100%';
    textDiv.style.height = '100%';
    textDiv.style.display = 'flex';
    textDiv.style.flexDirection = 'column';

    // Use extracted vertical alignment or default to top per OOXML spec
    // In flex-direction: column, justifyContent controls vertical (main axis)
    const verticalAlign = textVerticalAlign ?? 'top';
    if (verticalAlign === 'top') {
      textDiv.style.justifyContent = 'flex-start';
    } else if (verticalAlign === 'bottom') {
      textDiv.style.justifyContent = 'flex-end';
    } else {
      textDiv.style.justifyContent = 'center';
    }

    // Use extracted text insets or default to 10px all around
    if (textInsets) {
      textDiv.style.padding = `${textInsets.top}px ${textInsets.right}px ${textInsets.bottom}px ${textInsets.left}px`;
    } else {
      textDiv.style.padding = '10px';
    }

    textDiv.style.boxSizing = 'border-box';
    textDiv.style.wordWrap = 'break-word';
    textDiv.style.overflowWrap = 'break-word';
    textDiv.style.overflow = 'hidden';
    // min-width: 0 allows flex container to shrink below content size for text wrapping
    textDiv.style.minWidth = '0';
    // Set explicit base font-size to prevent CSS inheritance issues
    // Individual spans will override with their own sizes from textContent.parts
    textDiv.style.fontSize = '12px';
    textDiv.style.lineHeight = '1.2';

    // Horizontal text alignment uses CSS text-align property
    // Note: justifyContent is already set above for vertical alignment
    if (textAlign === 'center') {
      textDiv.style.textAlign = 'center';
    } else if (textAlign === 'right' || textAlign === 'r') {
      textDiv.style.textAlign = 'right';
    } else {
      textDiv.style.textAlign = 'left';
    }

    const paragraphSpacing = textContent.paragraphs;
    const spacingBefore = (index: number) => paragraphSpacing?.[index]?.spacing?.before;
    const spacingAfter = (index: number) => paragraphSpacing?.[index]?.spacing?.after;
    const createParagraphElement = () => {
      const paragraph = this.doc!.createElement('div');
      // Set width to 100% to enable text wrapping within the shape bounds
      paragraph.style.width = '100%';
      // min-width: 0 prevents flex item from overflowing (flexbox default is min-width: auto)
      paragraph.style.minWidth = '0';
      // Override inherited white-space: pre from parent fragment to allow text wrapping
      paragraph.style.whiteSpace = 'normal';
      paragraph.style.marginLeft = '0';
      paragraph.style.marginRight = '0';
      return paragraph;
    };

    // Create paragraphs by splitting on line breaks
    let logicalParagraphIndex = 0;
    let currentParagraph = createParagraphElement();
    const firstParagraphBefore = spacingBefore(logicalParagraphIndex);
    if (typeof firstParagraphBefore === 'number') {
      currentParagraph.style.marginTop = `${firstParagraphBefore}px`;
    }

    textContent.parts.forEach((part) => {
      if (part.isLineBreak) {
        if (part.isParagraphBoundary) {
          const currentParagraphAfter = spacingAfter(logicalParagraphIndex);
          if (typeof currentParagraphAfter === 'number') {
            currentParagraph.style.marginBottom = `${currentParagraphAfter}px`;
          }
        }

        // Finish current paragraph and start a new one
        textDiv.appendChild(currentParagraph);
        currentParagraph = createParagraphElement();
        // Empty paragraphs create extra spacing (blank line)
        if (part.isEmptyParagraph) {
          currentParagraph.style.minHeight = '1em';
        }

        if (part.isParagraphBoundary) {
          logicalParagraphIndex += 1;
          const nextParagraphBefore = spacingBefore(logicalParagraphIndex);
          if (typeof nextParagraphBefore === 'number') {
            currentParagraph.style.marginTop = `${nextParagraphBefore}px`;
          }
        }
      } else if (part.kind === 'image' && part.src) {
        currentParagraph.appendChild(createShapeTextImageElement(this.doc!, part));
      } else {
        const span = this.doc!.createElement('span');
        span.textContent = this.resolveShapeTextPartText(part, context);
        if (part.formatting) {
          if (part.formatting.bold) {
            span.style.fontWeight = 'bold';
          }
          if (part.formatting.italic) {
            span.style.fontStyle = 'italic';
          }
          if (part.formatting.fontFamily) {
            span.style.fontFamily = part.formatting.fontFamily;
          }
          if (part.formatting.color) {
            // Validate and normalize color format (handles both with and without # prefix)
            const validatedColor = validateHexColor(part.formatting.color);
            if (validatedColor) {
              span.style.color = validatedColor;
            }
          }
          if (part.formatting.fontSize) {
            span.style.fontSize = `${part.formatting.fontSize}px`;
          }
          if (part.formatting.letterSpacing != null) {
            span.style.letterSpacing = `${part.formatting.letterSpacing}px`;
          }
        }
        currentParagraph.appendChild(span);
      }
    });

    // Add the final paragraph
    const finalParagraphAfter = spacingAfter(logicalParagraphIndex);
    if (typeof finalParagraphAfter === 'number') {
      currentParagraph.style.marginBottom = `${finalParagraphAfter}px`;
    }
    textDiv.appendChild(currentParagraph);

    return textDiv;
  }

  private tryCreatePresetSvg(
    block: ShapeTextDrawingWithEffects,
    widthOverride?: number,
    heightOverride?: number,
  ): string | null {
    try {
      // For preset shapes, we need to pass string colors only
      // Gradients and alpha will be applied after SVG is created
      // null means explicitly "no fill" (from <a:noFill/> or fillRef idx="0"), so use 'none'
      // undefined means no explicit fill, so we let the preset library use its default
      let fillColor: string | undefined;
      if (block.fillColor === null) {
        fillColor = 'none';
      } else if (typeof block.fillColor === 'string') {
        fillColor = block.fillColor;
      }
      const strokeColor =
        block.strokeColor === null ? 'none' : typeof block.strokeColor === 'string' ? block.strokeColor : undefined;

      // Special case: handle line-like shapes directly since getPresetShapeSvg doesn't support them well
      if (block.shapeKind === 'line' || block.shapeKind === 'straightConnector1') {
        const width = widthOverride ?? block.geometry.width;
        const height = heightOverride ?? block.geometry.height;
        const stroke = strokeColor ?? '#000000';
        const strokeWidth = block.strokeWidth ?? 1;

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <line x1="0" y1="0" x2="${width}" y2="${height}" stroke="${stroke}" stroke-width="${strokeWidth}" />
</svg>`;
      }

      return getPresetShapeSvg({
        preset: block.shapeKind ?? '',
        styleOverrides: () => ({
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: block.strokeWidth ?? undefined,
        }),
        width: widthOverride ?? block.geometry.width,
        height: heightOverride ?? block.geometry.height,
      });
    } catch (error) {
      console.warn(`[DomPainter] Unable to render preset shape "${block.shapeKind}":`, error);
      return null;
    }
  }

  /**
   * Creates an SVG string from custom geometry path data (a:custGeom).
   * Each path in the custom geometry has its own coordinate space (w × h) which is
   * mapped to the shape's actual dimensions via the SVG viewBox.
   */
  private tryCreateCustomGeometrySvg(block: ShapeTextDrawingWithEffects, width: number, height: number): string | null {
    const custGeom = block.customGeometry;
    if (!custGeom?.paths?.length) return null;

    let fillColor: string;
    if (block.fillColor === null) {
      fillColor = 'none';
    } else if (typeof block.fillColor === 'string') {
      fillColor = block.fillColor;
    } else {
      // Gradient / solidWithAlpha: use a placeholder fill so that downstream
      // applyGradientToSVG / applyAlphaToSVG (which skip fill="none") can
      // target these elements and replace the fill.
      fillColor = '#000000';
    }
    const strokeColor =
      block.strokeColor === null ? 'none' : typeof block.strokeColor === 'string' ? block.strokeColor : 'none';
    const strokeWidth = block.strokeColor === null ? 0 : (block.strokeWidth ?? 0);

    // Build SVG paths. Each path has its own coordinate space (w × h).
    // Use the first path's coordinate space for the viewBox, and scale subsequent paths if needed.
    const firstPath = custGeom.paths[0];
    const viewW = firstPath.w || width;
    const viewH = firstPath.h || height;

    // Degenerate: zero-dimension viewBox is invalid SVG — skip rendering.
    if (viewW === 0 || viewH === 0) return null;

    const hasLargeCoordinateScale = viewW / width > 10 || viewH / height > 10;
    const explicitStrokeEffect = hasLargeCoordinateScale ? ' vector-effect="non-scaling-stroke"' : '';

    // When the SVG viewBox maps to a non-uniform aspect ratio (common with group transforms),
    // thin fill borders can become sub-pixel on one axis. Add a hairline stroke matching the
    // fill color with vector-effect="non-scaling-stroke" so edges remain at least 0.5px visible.
    const needsEdgeStroke = fillColor !== 'none' && strokeColor === 'none';
    const edgeStroke = needsEdgeStroke
      ? ` stroke="${fillColor}" stroke-width="0.5" vector-effect="non-scaling-stroke"`
      : '';

    const pathElements = custGeom.paths
      .map((p) => {
        // If this path has a different coordinate space, apply a transform to map it
        const pathW = p.w || viewW;
        const pathH = p.h || viewH;
        const needsTransform = pathW !== viewW || pathH !== viewH;
        const scaleX = viewW / pathW;
        const scaleY = viewH / pathH;
        const transform = needsTransform ? ` transform="scale(${scaleX}, ${scaleY})"` : '';
        const strokeAttr =
          strokeColor !== 'none'
            ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}"${explicitStrokeEffect}`
            : edgeStroke;
        return `<path d="${p.d}" fill="${fillColor}" fill-rule="evenodd"${strokeAttr}${transform} />`;
      })
      .join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="none">
  ${pathElements}
</svg>`;
  }

  private parseSafeSvg(markup: string): SVGElement | null {
    const DOMParserCtor = this.doc?.defaultView?.DOMParser ?? (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!DOMParserCtor) {
      return null;
    }
    const parser = new DOMParserCtor();
    const parsed = parser.parseFromString(markup, 'image/svg+xml');
    if (!parsed || parsed.getElementsByTagName('parsererror').length > 0) {
      return null;
    }
    // documentElement might be HTMLElement or Element, use type guard via unknown
    const svgElement = parsed.documentElement as unknown as SVGElement | null;
    if (!svgElement) return null;
    this.stripUnsafeSvgContent(svgElement);
    // Safe cast: importNode preserves the element type, and we've verified it's an SVGElement
    const imported = this.doc?.importNode(svgElement, true);
    return imported ? (imported as unknown as SVGElement) : null;
  }

  private stripUnsafeSvgContent(element: Element): void {
    element.querySelectorAll('script').forEach((script) => script.remove());
    const sanitize = (node: Element) => {
      Array.from(node.attributes).forEach((attr) => {
        if (attr.name.toLowerCase().startsWith('on')) {
          node.removeAttribute(attr.name);
        }
      });
      Array.from(node.children).forEach((child) => {
        sanitize(child as Element);
      });
    };
    sanitize(element);
  }

  private getEffectExtentMetrics(
    block: ShapeTextDrawingWithEffects,
    geometry?: DrawingGeometry,
  ): {
    offsetX: number;
    offsetY: number;
    innerWidth: number;
    innerHeight: number;
  } {
    const left = block.effectExtent?.left ?? 0;
    const top = block.effectExtent?.top ?? 0;
    const right = block.effectExtent?.right ?? 0;
    const bottom = block.effectExtent?.bottom ?? 0;
    const sourceGeometry = geometry ?? block.geometry;
    const width = sourceGeometry.width ?? 0;
    const height = sourceGeometry.height ?? 0;
    const innerWidth = Math.max(0, width - left - right);
    const innerHeight = Math.max(0, height - top - bottom);
    return { offsetX: left, offsetY: top, innerWidth, innerHeight };
  }

  private applyLineEnds(svgElement: SVGElement, block: ShapeTextDrawingWithEffects): void {
    const lineEnds = block.lineEnds;
    if (!lineEnds) return;
    if (block.strokeColor === null) return;
    const strokeColor = typeof block.strokeColor === 'string' ? block.strokeColor : '#000000';
    const strokeWidth = block.strokeWidth ?? 1;
    if (strokeWidth <= 0) return;

    const target = this.findLineEndTarget(svgElement);
    if (!target) return;

    const defs = this.ensureSvgDefs(svgElement);
    const baseId = this.sanitizeSvgId(`sd-line-${block.id}`);

    if (lineEnds.tail) {
      const id = `${baseId}-tail`;
      this.appendLineEndMarker(
        defs,
        id,
        lineEnds.tail,
        strokeColor,
        strokeWidth,
        true,
        block.effectExtent ?? undefined,
      );
      target.setAttribute('marker-start', `url(#${id})`);
    }

    if (lineEnds.head) {
      const id = `${baseId}-head`;
      this.appendLineEndMarker(
        defs,
        id,
        lineEnds.head,
        strokeColor,
        strokeWidth,
        false,
        block.effectExtent ?? undefined,
      );
      target.setAttribute('marker-end', `url(#${id})`);
    }
  }

  private applyShapeEffects(svgElement: SVGElement, block: ShapeTextDrawingWithEffects): void {
    const outerShadow = block.effects?.outerShadow;
    if (!outerShadow) return;
    this.applyOuterShadowEffect(svgElement, block.id, outerShadow);
  }

  private applyOuterShadowEffect(svgElement: SVGElement, blockId: string, shadow: ShapeOuterShadowEffect): void {
    const targets = this.findShapeEffectTargets(svgElement);
    if (!targets.length) return;

    const defs = this.ensureSvgDefs(svgElement);
    const filterId = this.sanitizeSvgId(`sd-shadow-${blockId}`);
    const outlineFilterId = this.sanitizeSvgId(`sd-shadow-outline-${blockId}`);
    if (!defs.querySelector(`#${filterId}`)) {
      const filter = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', filterId);
      filter.setAttribute('x', '-50%');
      filter.setAttribute('y', '-50%');
      filter.setAttribute('width', '200%');
      filter.setAttribute('height', '200%');

      const { dx, dy } = resolveOuterShadowOffset(shadow);
      const dropShadow = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
      dropShadow.setAttribute('dx', this.formatSvgNumber(dx));
      dropShadow.setAttribute('dy', this.formatSvgNumber(dy));
      dropShadow.setAttribute('stdDeviation', this.formatSvgNumber(getOuterShadowStdDeviation(shadow)));
      dropShadow.setAttribute('flood-color', shadow.color);
      dropShadow.setAttribute('flood-opacity', this.formatSvgNumber(shadow.opacity));

      filter.appendChild(dropShadow);
      defs.appendChild(filter);
    }

    targets.forEach((target) => {
      if (this.shouldRenderFilledShadowClone(target)) {
        this.appendFilledShadowClone(svgElement, defs, target, outlineFilterId, shadow);
        return;
      }
      target.setAttribute('filter', `url(#${filterId})`);
    });
  }

  private findShapeEffectTargets(svgElement: SVGElement): SVGElement[] {
    return Array.from(svgElement.querySelectorAll('path, line, polyline, polygon, rect, ellipse, circle')).filter(
      (target) => !target.closest('defs') && !target.hasAttribute('data-sd-shadow-clone'),
    ) as SVGElement[];
  }

  private shouldRenderFilledShadowClone(target: SVGElement): boolean {
    const fill = target.getAttribute('fill');
    if (fill !== 'none') return false;
    if (target.tagName.toLowerCase() === 'path') {
      return /z\s*$/i.test(target.getAttribute('d') ?? '');
    }
    return ['polygon', 'rect', 'ellipse', 'circle'].includes(target.tagName.toLowerCase());
  }

  private appendFilledShadowClone(
    svgElement: SVGElement,
    defs: SVGDefsElement,
    target: SVGElement,
    filterId: string,
    shadow: ShapeOuterShadowEffect,
  ): void {
    this.ensureOuterShadowOnlyFilter(defs, filterId, shadow);

    const clone = target.cloneNode(false) as SVGElement;
    clone.setAttribute('data-sd-shadow-clone', filterId);
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('fill', '#000000');
    clone.setAttribute('stroke', 'none');
    clone.setAttribute('filter', `url(#${filterId})`);
    target.parentNode?.insertBefore(clone, target);
  }

  private ensureOuterShadowOnlyFilter(defs: SVGDefsElement, filterId: string, shadow: ShapeOuterShadowEffect): void {
    if (defs.querySelector(`#${filterId}`)) return;

    const filter = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');

    const blur = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('in', 'SourceAlpha');
    blur.setAttribute('stdDeviation', this.formatSvgNumber(getOuterShadowStdDeviation(shadow)));
    blur.setAttribute('result', 'blur');

    const { dx, dy } = resolveOuterShadowOffset(shadow);
    const offset = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feOffset');
    offset.setAttribute('in', 'blur');
    offset.setAttribute('dx', this.formatSvgNumber(dx));
    offset.setAttribute('dy', this.formatSvgNumber(dy));
    offset.setAttribute('result', 'offsetBlur');

    const flood = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
    flood.setAttribute('flood-color', shadow.color);
    flood.setAttribute('flood-opacity', this.formatSvgNumber(shadow.opacity));
    flood.setAttribute('result', 'shadowColor');

    const composite = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    composite.setAttribute('in', 'shadowColor');
    composite.setAttribute('in2', 'offsetBlur');
    composite.setAttribute('operator', 'in');
    composite.setAttribute('result', 'shadow');

    const outsideOnly = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    outsideOnly.setAttribute('in', 'shadow');
    outsideOnly.setAttribute('in2', 'SourceAlpha');
    outsideOnly.setAttribute('operator', 'out');
    outsideOnly.setAttribute('result', 'outerShadow');

    filter.appendChild(blur);
    filter.appendChild(offset);
    filter.appendChild(flood);
    filter.appendChild(composite);
    filter.appendChild(outsideOnly);
    defs.appendChild(filter);
  }

  private formatSvgNumber(value: number): string {
    return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : '0';
  }

  private findLineEndTarget(svgElement: SVGElement): SVGElement | null {
    const line = svgElement.querySelector('line');
    if (line) return line as SVGElement;
    const path = svgElement.querySelector('path');
    if (path) return path as SVGElement;
    const polyline = svgElement.querySelector('polyline');
    return polyline as SVGElement | null;
  }

  private ensureSvgDefs(svgElement: SVGElement): SVGDefsElement {
    const existing = svgElement.querySelector('defs');
    if (existing) return existing as SVGDefsElement;
    const defs = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgElement.insertBefore(defs, svgElement.firstChild);
    return defs;
  }

  private appendLineEndMarker(
    defs: SVGDefsElement,
    id: string,
    lineEnd: LineEnd,
    strokeColor: string,
    _strokeWidth: number,
    isStart: boolean,
    effectExtent?: EffectExtent,
  ): void {
    if (defs.querySelector(`#${id}`)) return;

    const marker = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('orient', 'auto');

    const sizeScale = (value?: string): number => {
      if (value === 'sm') return 0.75;
      if (value === 'lg') return 1.25;
      return 1;
    };
    const effectMax = effectExtent
      ? Math.max(effectExtent.left ?? 0, effectExtent.right ?? 0, effectExtent.top ?? 0, effectExtent.bottom ?? 0)
      : 0;
    const useEffectExtent = Number.isFinite(effectMax) && effectMax > 0;
    const markerWidth = useEffectExtent ? effectMax * 2 : 4 * sizeScale(lineEnd.length);
    const markerHeight = useEffectExtent ? effectMax * 2 : 4 * sizeScale(lineEnd.width);
    marker.setAttribute('markerUnits', useEffectExtent ? 'userSpaceOnUse' : 'strokeWidth');
    marker.setAttribute('markerWidth', markerWidth.toString());
    marker.setAttribute('markerHeight', markerHeight.toString());
    marker.setAttribute('refX', isStart ? '0' : '10');
    marker.setAttribute('refY', '5');

    const shape = this.createLineEndShape(lineEnd.type ?? 'triangle', strokeColor, isStart);
    marker.appendChild(shape);
    defs.appendChild(marker);
  }

  private createLineEndShape(type: string, strokeColor: string, isStart: boolean): SVGElement {
    const normalized = type.toLowerCase();
    if (normalized === 'diamond') {
      const path = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 0 5 L 5 0 L 10 5 L 5 10 Z');
      path.setAttribute('fill', strokeColor);
      path.setAttribute('stroke', 'none');
      return path;
    }
    if (normalized === 'oval') {
      const circle = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '5');
      circle.setAttribute('cy', '5');
      circle.setAttribute('r', '5');
      circle.setAttribute('fill', strokeColor);
      circle.setAttribute('stroke', 'none');
      return circle;
    }

    const path = this.doc!.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = isStart ? 'M 10 0 L 0 5 L 10 10 Z' : 'M 0 0 L 10 5 L 0 10 Z';
    path.setAttribute('d', d);
    path.setAttribute('fill', strokeColor);
    path.setAttribute('stroke', 'none');
    return path;
  }

  private sanitizeSvgId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  private applyVectorShapeTransforms(target: HTMLElement | SVGElement, geometry: DrawingGeometry): void {
    const transforms: string[] = [];
    if (geometry.rotation) {
      transforms.push(`rotate(${geometry.rotation}deg)`);
    }
    if (geometry.flipH) {
      transforms.push('scaleX(-1)');
    }
    if (geometry.flipV) {
      transforms.push('scaleY(-1)');
    }
    if (transforms.length > 0) {
      target.style.transformOrigin = 'center';
      target.style.transform = transforms.join(' ');
    } else {
      target.style.removeProperty('transform');
      target.style.removeProperty('transform-origin');
    }
  }

  private createShapeGroupElement(
    block: ShapeGroupDrawing,
    context?: FragmentRenderContext,
    fragmentGeometry?: DrawingGeometry,
  ): HTMLElement {
    const groupEl = this.doc!.createElement('div');
    groupEl.classList.add('superdoc-shape-group');
    groupEl.style.position = 'relative';
    groupEl.style.width = '100%';
    groupEl.style.height = '100%';

    const groupTransform = block.groupTransform;
    let contentContainer: HTMLElement = groupEl;
    const groupEffectExtent = block.effectExtent ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const hasGroupEffectExtent =
      groupEffectExtent.left > 0 ||
      groupEffectExtent.top > 0 ||
      groupEffectExtent.right > 0 ||
      groupEffectExtent.bottom > 0;

    const visibleWidth =
      groupTransform?.width ??
      Math.max(0, (block.geometry.width ?? 0) - groupEffectExtent.left - groupEffectExtent.right);
    const visibleHeight =
      groupTransform?.height ??
      Math.max(0, (block.geometry.height ?? 0) - groupEffectExtent.top - groupEffectExtent.bottom);

    if (groupTransform || hasGroupEffectExtent) {
      const inner = this.doc!.createElement('div');
      inner.style.position = 'absolute';
      inner.style.left = `${groupEffectExtent.left}px`;
      inner.style.top = `${groupEffectExtent.top}px`;
      // Container at visible dimensions. Children use pre-scaled positions/sizes.
      inner.style.width = `${Math.max(1, visibleWidth)}px`;
      inner.style.height = `${Math.max(1, visibleHeight)}px`;
      const groupTransforms: string[] = [];
      const normalizedGroupRotation =
        typeof groupTransform?.rotation === 'number' ? normalizeRotationDegrees(groupTransform.rotation) : 0;
      const normalizedFragmentRotation =
        typeof fragmentGeometry?.rotation === 'number' ? normalizeRotationDegrees(fragmentGeometry.rotation) : 0;
      const groupRotation =
        normalizedGroupRotation && normalizedGroupRotation !== normalizedFragmentRotation
          ? (groupTransform?.rotation ?? 0)
          : 0;
      const groupFlipH = groupTransform?.flipH && groupTransform.flipH !== fragmentGeometry?.flipH;
      const groupFlipV = groupTransform?.flipV && groupTransform.flipV !== fragmentGeometry?.flipV;
      if (groupRotation) {
        groupTransforms.push(`rotate(${groupRotation}deg)`);
      }
      if (groupFlipH) {
        groupTransforms.push('scaleX(-1)');
      }
      if (groupFlipV) {
        groupTransforms.push('scaleY(-1)');
      }
      if (groupTransforms.length > 0) {
        inner.style.transformOrigin = 'center';
        inner.style.transform = groupTransforms.join(' ');
      }
      groupEl.appendChild(inner);
      contentContainer = inner;
    }

    block.shapes.forEach((child, childIndex) => {
      const attrs = (child as ShapeGroupChild).attrs ?? {};
      const paintExtent = this.getShapeGroupChildPaintExtent(child);
      const childContent = this.createGroupChildContent(child, 1, 1, context, paintExtent, block.id, childIndex);
      if (!childContent) return;
      const wrapper = this.doc!.createElement('div');
      wrapper.classList.add('superdoc-shape-group__child');
      wrapper.style.position = 'absolute';

      // Children use pre-scaled (visual-space) positions/sizes from import.
      wrapper.style.left = `${Number(attrs.x ?? 0) - paintExtent.left}px`;
      wrapper.style.top = `${Number(attrs.y ?? 0) - paintExtent.top}px`;

      const childW = typeof attrs.width === 'number' ? attrs.width : block.geometry.width;
      const childH = typeof attrs.height === 'number' ? attrs.height : block.geometry.height;
      wrapper.style.width = `${Math.max(1, childW + paintExtent.left + paintExtent.right)}px`;
      wrapper.style.height = `${Math.max(1, childH + paintExtent.top + paintExtent.bottom)}px`;

      wrapper.style.transformOrigin = 'center';
      const transforms: string[] = [];
      if (attrs.rotation) {
        transforms.push(`rotate(${attrs.rotation}deg)`);
      }
      if (attrs.flipH) {
        transforms.push('scaleX(-1)');
      }
      if (attrs.flipV) {
        transforms.push('scaleY(-1)');
      }
      if (transforms.length > 0) {
        wrapper.style.transform = transforms.join(' ');
      }
      childContent.style.width = '100%';
      childContent.style.height = '100%';
      wrapper.appendChild(childContent);
      contentContainer.appendChild(wrapper);
    });

    return groupEl;
  }

  private getShapeGroupChildPaintExtent(child: ShapeGroupChild): EffectExtent {
    if (child.shapeType !== 'vectorShape' || !('fillColor' in child.attrs)) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    const attrs = child.attrs as VectorShapeStyle;
    // Producers must include equivalent group-level effectExtent for edge children so the fragment can grow.
    // Line-end markers use effectExtent for marker sizing; do not overload it with stroke paint room.
    const shadowExtent = attrs.effects?.outerShadow
      ? getSharedOuterShadowPaintExtent(attrs.effects.outerShadow)
      : { left: 0, top: 0, right: 0, bottom: 0 };
    if (attrs.lineEnds) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    if (attrs.strokeColor === null) {
      return shadowExtent;
    }
    const rawStrokeWidth = (child.attrs as { strokeWidth?: unknown }).strokeWidth;
    const parsedStrokeWidth =
      typeof rawStrokeWidth === 'number'
        ? rawStrokeWidth
        : typeof rawStrokeWidth === 'string' && rawStrokeWidth.trim() !== ''
          ? Number(rawStrokeWidth)
          : undefined;
    const strokeWidth = parsedStrokeWidth != null && Number.isFinite(parsedStrokeWidth) ? parsedStrokeWidth : 1;
    if (strokeWidth <= 0) {
      return shadowExtent;
    }
    const extent = strokeWidth / 2;
    return {
      left: Math.max(extent, shadowExtent.left),
      top: Math.max(extent, shadowExtent.top),
      right: Math.max(extent, shadowExtent.right),
      bottom: Math.max(extent, shadowExtent.bottom),
    };
  }

  private createGroupChildContent(
    child: ShapeGroupChild,
    groupScaleX: number = 1,
    groupScaleY: number = 1,
    context?: FragmentRenderContext,
    paintExtent: EffectExtent = { left: 0, top: 0, right: 0, bottom: 0 },
    groupId?: string,
    childIndex?: number,
  ): HTMLElement | null {
    // Type narrowing with explicit checks to help TypeScript distinguish union members
    if (child.shapeType === 'vectorShape' && 'fillColor' in child.attrs) {
      // After this check, child should be ShapeGroupVectorChild
      const attrs = child.attrs as PositionedDrawingGeometry &
        VectorShapeStyle & {
          kind?: string;
          customGeometry?: CustomGeometryData;
          shapeId?: string;
          shapeName?: string;
          textContent?: ShapeTextContent;
          textAlign?: string;
          lineEnds?: LineEnds;
          effects?: ShapeEffects;
        };
      const childGeometry = {
        width: (attrs.width ?? 0) + paintExtent.left + paintExtent.right,
        height: (attrs.height ?? 0) + paintExtent.top + paintExtent.bottom,
        rotation: attrs.rotation ?? 0,
        flipH: attrs.flipH ?? false,
        flipV: attrs.flipV ?? false,
      };
      const hasPaintExtent =
        paintExtent.left > 0 || paintExtent.top > 0 || paintExtent.right > 0 || paintExtent.bottom > 0;
      const vectorChild: ShapeTextDrawingWithEffects = {
        drawingKind: 'vectorShape',
        kind: 'drawing',
        id:
          groupId != null
            ? `${groupId}-${childIndex ?? 0}-${attrs.shapeId ?? child.shapeType}`
            : `${attrs.shapeId ?? child.shapeType}`,
        geometry: childGeometry,
        padding: undefined,
        margin: undefined,
        anchor: undefined,
        wrap: undefined,
        attrs: child.attrs,
        drawingContentId: undefined,
        drawingContent: undefined,
        shapeKind: attrs.kind,
        customGeometry: attrs.customGeometry,
        fillColor: attrs.fillColor,
        strokeColor: attrs.strokeColor,
        strokeWidth: attrs.strokeWidth,
        lineEnds: attrs.lineEnds,
        effects: attrs.effects,
        textContent: attrs.textContent,
        textAlign: attrs.textAlign,
        textVerticalAlign: attrs.textVerticalAlign,
        textInsets: attrs.textInsets,
        effectExtent: hasPaintExtent ? paintExtent : undefined,
      };
      // Pass geometry and scale factors to ensure text overlay has correct dimensions
      return this.createVectorShapeElement(vectorChild, childGeometry, false, groupScaleX, groupScaleY, context);
    }
    if (child.shapeType === 'image' && 'src' in child.attrs) {
      return createShapeGroupImageElement(this.doc!, child);
    }
    return this.createDrawingPlaceholder();
  }

  private createDrawingPlaceholder(): HTMLElement {
    const placeholder = this.doc!.createElement('div');
    placeholder.classList.add('superdoc-drawing-placeholder');
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.background =
      'repeating-linear-gradient(45deg, rgba(15,23,42,0.1), rgba(15,23,42,0.1) 6px, rgba(15,23,42,0.2) 6px, rgba(15,23,42,0.2) 12px)';
    placeholder.style.border = '1px dashed rgba(15, 23, 42, 0.3)';
    return placeholder;
  }

  // ============================================================================
  // Chart Rendering
  // ============================================================================

  /**
   * Create an SVG chart element from a ChartDrawing block.
   * Delegates to the chart-renderer module for clean separation.
   */
  private createChartElement(block: ChartDrawing): HTMLElement {
    return renderChartToElement(this.doc!, block.chartData, block.geometry);
  }

  private resolveTableRenderData(
    fragment: TableFragment,
    resolvedItem?: ResolvedTableItem,
  ): {
    block: TableBlock;
    measure: TableMeasure;
    cellSpacingPx: number;
    effectiveColumnWidths: number[];
  } {
    if (!resolvedItem) {
      throw new Error(`DomPainter: missing resolved table item for fragment ${fragment.blockId}`);
    }
    return {
      block: resolvedItem.block,
      measure: resolvedItem.measure,
      cellSpacingPx: resolvedItem.cellSpacingPx,
      effectiveColumnWidths: resolvedItem.effectiveColumnWidths,
    };
  }

  private renderTableFragment(
    fragment: TableFragment,
    context: FragmentRenderContext,
    sdtBoundary?: SdtBoundaryOptions,
    resolvedItem?: ResolvedTableItem,
  ): HTMLElement {
    try {
      if (!this.doc) {
        throw new Error('DomPainter: document is not available');
      }

      // Wrap applyFragmentFrame to capture section from context.
      // Table cell inner fragments always stay on the legacy frame path for now.
      const applyFragmentFrameWithSection = (el: HTMLElement, frag: Fragment): void => {
        this.applyFragmentFrame(el, frag, context.section, context.story);
      };

      // Word justifies text inside table cells, but not the final line unless the
      // paragraph ends with an explicit line break.
      const tableCellExpandedRunsCache = new WeakMap<ParagraphBlock, Run[]>();
      const renderLineForTableCell = (
        block: ParagraphBlock,
        line: Line,
        ctx: FragmentRenderContext,
        lineIndex: number,
        isLastLine: boolean,
        resolvedListTextStartPx?: number,
      ): HTMLElement => {
        const lastRun = block.runs.length > 0 ? block.runs[block.runs.length - 1] : null;
        const paragraphEndsWithLineBreak = lastRun?.kind === 'lineBreak';
        const shouldSkipJustify = isLastLine && !paragraphEndsWithLineBreak;

        let expandedRuns = tableCellExpandedRunsCache.get(block);
        if (!expandedRuns) {
          expandedRuns = expandRunsForInlineNewlines(block.runs);
          tableCellExpandedRunsCache.set(block, expandedRuns);
        }

        return this.renderLine(
          block,
          line,
          ctx,
          undefined,
          lineIndex,
          shouldSkipJustify,
          expandedRuns,
          resolvedListTextStartPx,
        );
      };

      /**
       * Renders drawing content that lives inside a table cell.
       * Table-cell vector shapes intentionally skip outer geometry transforms.
       */
      const renderDrawingContentForTableCell = (block: DrawingBlock): HTMLElement => {
        if (block.drawingKind === 'image') {
          return createDrawingImageElement(this.doc!, block, this.buildImageHyperlinkAnchor.bind(this));
        }
        if (block.drawingKind === 'shapeGroup') {
          return this.createShapeGroupElement(block, context);
        }
        if (block.drawingKind === 'vectorShape' || block.drawingKind === 'textboxShape') {
          return this.createVectorShapeElement(block, block.geometry, false, 1, 1, context);
        }
        if (block.drawingKind === 'chart') {
          return this.createChartElement(block);
        }
        return this.createDrawingPlaceholder();
      };

      const tableRenderData = this.resolveTableRenderData(fragment, resolvedItem);

      const el = renderTableFragmentElement({
        doc: this.doc,
        fragment,
        context,
        block: tableRenderData.block,
        measure: tableRenderData.measure,
        cellSpacingPx: tableRenderData.cellSpacingPx,
        effectiveColumnWidths: tableRenderData.effectiveColumnWidths,
        chrome: this.contentControlsChrome,
        sdtBoundary,
        renderLine: renderLineForTableCell,
        captureLineSnapshot: (lineEl, lineContext, options) => {
          this.capturePaintSnapshotLine(lineEl, lineContext, {
            inTableFragment: true,
            inTableParagraph: options?.inTableParagraph ?? false,
            wrapperEl: options?.wrapperEl,
          });
        },
        renderDrawingContent: renderDrawingContentForTableCell,
        applyFragmentFrame: applyFragmentFrameWithSection,
        applySdtDataset,
        applyContainerSdtDataset,
        applyStyles,
        // Per-document font resolver so in-cell list markers and drop caps paint the same physical
        // family they were measured in (undefined => the renderers fall back to the global default).
        resolvePhysical: this.options.resolvePhysical,
      });

      // Override outer wrapper positioning with resolved data when available.
      // Inner cell fragments still use legacy applyFragmentFrame via deps closure.
      if (resolvedItem) {
        this.applyResolvedFragmentFrame(el, resolvedItem, fragment, context.section, context.story);
        // Re-apply the SDT group width override after the resolved frame, so block-SDT
        // containers can stretch table fragments to match sibling paragraph widths.
        if (sdtBoundary?.widthOverride != null) {
          el.style.width = `${sdtBoundary.widthOverride}px`;
        }
      }

      return el;
    } catch (error) {
      console.error('[DomPainter] Table fragment rendering failed:', { fragment, error });
      return this.createErrorPlaceholder(fragment.blockId, error);
    }
  }

  private renderLine(
    block: ParagraphBlock,
    line: Line,
    context: FragmentRenderContext,
    availableWidthOverride?: number,
    lineIndex?: number,
    skipJustify?: boolean,
    preExpandedRuns?: Run[],
    resolvedListTextStartPx?: number,
    indentOffsetOverride?: number,
    paragraphMarkLeftOffsetOverride?: number,
  ): HTMLElement {
    if (!this.doc) {
      throw new Error('DomPainter: document is not available');
    }

    return renderRunLine({
      block,
      line,
      context,
      availableWidthOverride,
      lineIndex,
      skipJustify,
      preExpandedRuns,
      resolvedListTextStartPx,
      indentOffsetOverride,
      paragraphMarkLeftOffsetOverride,
      runContext: this.createRunRenderContext(),
    });
  }

  private createRunRenderContext(): RunRenderContext {
    if (!this.doc) {
      throw new Error('DomPainter: document is not available');
    }

    const runContext: RunRenderContext = {
      doc: this.doc,
      layoutEpoch: this.layoutEpoch,
      showFormattingMarks: this.showFormattingMarks,
      contentControlsChrome: this.contentControlsChrome,
      // Per-document font resolver (undefined => applyRunStyles falls back to the global default).
      resolvePhysical: this.options.resolvePhysical,
      pendingTooltips: this.pendingTooltips,
      getNextLinkId: () => `superdoc-link-${++this.linkIdCounter}`,
      applySdtDataset,
      buildImageHyperlinkAnchor: this.buildImageHyperlinkAnchor.bind(
        this,
      ) as RunRenderContext['buildImageHyperlinkAnchor'],
      resolveTrackedChangesConfig,
      applyTrackedChangeDecorations,
      resolveRunSdtId,
      createInlineSdtWrapper: (sdt) => createInlineSdtWrapper(sdt, runContext),
      syncInlineSdtWrapperTypography,
      expandSdtWrapperPmRange,
    };
    return runContext;
  }

  private defaultFragmentRenderContext(): FragmentRenderContext {
    return {
      pageNumber: 1,
      totalPages: 1,
      section: 'body',
    };
  }

  /**
   * Updates an existing fragment element's position and dimensions in place.
   * Used during incremental updates to efficiently reposition fragments without full re-render.
   *
   * @param el - The HTMLElement representing the fragment to update
   * @param fragment - The fragment data containing updated position and dimensions
   * @param section - The document section ('body', 'header', 'footer') containing this fragment.
   *                  Affects PM position validation - only body sections validate PM positions.
   *                  If undefined, defaults to 'body' section behavior.
   */
  private updateFragmentElement(
    el: HTMLElement,
    fragment: Fragment,
    section?: 'body' | 'header' | 'footer',
    resolvedItem?: ResolvedPaintItem,
  ): void {
    // Narrow to fragment-kind resolved items (excludes ResolvedGroupItem)
    const fragmentItem = resolvedItem?.kind === 'fragment' ? resolvedItem : undefined;
    const story = resolveSectionStory(section);

    if (fragmentItem) {
      this.applyResolvedFragmentFrame(el, fragmentItem, fragment, section, story);
    } else {
      this.applyFragmentFrame(el, fragment, section, story);
      if (fragment.kind === 'image' || fragment.kind === 'drawing') {
        el.style.height = `${fragment.height}px`;
        this.applyFragmentWrapperZIndex(el, fragment);
      }
    }
  }

  /**
   * Applies fragment positioning, dimensions, and metadata to an HTML element.
   *
   * @param el - The HTMLElement to apply fragment properties to
   * @param fragment - The fragment data containing position, dimensions, and PM position information
   * @param section - The document section ('body', 'header', 'footer') containing this fragment.
   *                  Controls PM position validation behavior:
   *                  - 'body' or undefined: PM positions are validated and required for paragraph fragments
   *                  - 'header' or 'footer': PM position validation is skipped (these sections have separate PM coordinate spaces)
   *                  When undefined, defaults to 'body' section behavior (validation enabled).
   */
  private applyFragmentFrame(
    el: HTMLElement,
    fragment: Fragment,
    section?: 'body' | 'header' | 'footer',
    story?: LayoutStoryLocator,
  ): void {
    el.style.left = `${fragment.x}px`;
    el.style.top = `${fragment.y}px`;
    el.style.width = `${fragment.width}px`;
    el.dataset.blockId = fragment.blockId;
    el.dataset.layoutEpoch = String(this.layoutEpoch);
    applySourceAnchorDataset(el, fragment.sourceAnchor);
    applyLayoutIdentityDataset(el, resolveOrBuildFragmentIdentity(fragment, story ?? resolveSectionStory(section)));

    // Footnote content is read-only: prevent cursor placement and typing (blockId prefix from FootnotesBuilder)
    if (typeof fragment.blockId === 'string' && fragment.blockId.startsWith('footnote-')) {
      el.setAttribute('contenteditable', 'false');
    }

    if (fragment.kind === 'para') {
      applyParagraphFragmentPmAttributes(el, fragment, section);
    }
  }

  /**
   * Applies PM position data attributes from a legacy Fragment.
   * Extracted from applyFragmentFrame for use in the resolved wrapper path.
   * When a resolvedItem is provided, its fields take precedence over fragment fields.
   */
  private applyFragmentPmAttributes(
    el: HTMLElement,
    fragment: Fragment,
    section?: 'body' | 'header' | 'footer',
    resolvedItem?: ResolvedFragmentItem | ResolvedTableItem | ResolvedImageItem | ResolvedDrawingItem,
  ): void {
    // Footnote content is read-only: prevent cursor placement and typing
    if (typeof fragment.blockId === 'string' && fragment.blockId.startsWith('footnote-')) {
      el.setAttribute('contenteditable', 'false');
    }

    if (fragment.kind === 'para') {
      applyParagraphFragmentPmAttributes(el, fragment, section, resolvedItem as ResolvedFragmentItem | undefined);
    }
  }

  /**
   * Applies fragment wrapper positioning from a ResolvedFragmentItem.
   * Uses resolved data for spatial properties and delegates PM attributes to the legacy path.
   */
  private isAnchoredMediaFragment(fragment: Fragment): fragment is ImageFragment | DrawingFragment {
    return (fragment.kind === 'image' || fragment.kind === 'drawing') && fragment.isAnchored === true;
  }

  private shouldRenderBehindPageContent(
    fragment: ImageFragment | DrawingFragment,
    section: 'header' | 'footer',
    resolvedItem?: ResolvedImageItem | ResolvedDrawingItem,
  ): boolean {
    if (fragment.behindDoc === true || (fragment.behindDoc == null && 'zIndex' in fragment && fragment.zIndex === 0)) {
      return true;
    }

    if (section !== 'header') {
      return false;
    }

    if (fragment.kind === 'drawing') {
      return this.isHeaderWordArtWatermark(resolvedItem?.block);
    }

    return this.isVmlTextWatermarkImage(resolvedItem?.block);
  }

  private isHeaderWordArtWatermark(block: FlowBlock | undefined): block is DrawingBlock {
    if (!block || block.kind !== 'drawing' || block.drawingKind !== 'vectorShape') {
      return false;
    }

    const attrs = (block.attrs as Record<string, unknown> | undefined) ?? {};
    const hasTextContent = Array.isArray(block.textContent?.parts) && block.textContent.parts.length > 0;

    return (
      attrs.isWordArt === true &&
      attrs.isTextBox === true &&
      hasTextContent &&
      block.anchor?.isAnchored === true &&
      block.anchor.hRelativeFrom === 'page' &&
      block.anchor.alignH === 'center' &&
      block.anchor.vRelativeFrom === 'page' &&
      block.anchor.alignV === 'center' &&
      block.wrap?.type === 'None'
    );
  }

  private isVmlTextWatermarkImage(block: FlowBlock | undefined): block is ImageBlock {
    return block?.kind === 'image' && block.attrs?.vmlTextWatermark === true;
  }

  private applyHeaderFooterTextWatermarkPreviewOpacity(el: HTMLElement, isActiveHeaderFooter: boolean): void {
    if (el.dataset.vmlTextWatermark !== 'true') {
      return;
    }

    el.style.opacity = isActiveHeaderFooter
      ? ACTIVE_HEADER_FOOTER_WATERMARK_PREVIEW_OPACITY
      : INACTIVE_HEADER_FOOTER_WATERMARK_PREVIEW_OPACITY;
  }

  /**
   * Only anchored images and drawings participate in explicit wrapper stacking.
   * Inline media intentionally rely on DOM order to preserve legacy paint order.
   */
  private resolveFragmentWrapperZIndex(fragment: Fragment, resolvedZIndex?: number): string {
    if (!this.isAnchoredMediaFragment(fragment)) {
      return '';
    }

    const zIndex = resolvedZIndex;
    return zIndex != null ? String(zIndex) : '';
  }

  private applyFragmentWrapperZIndex(el: HTMLElement, fragment: Fragment, resolvedZIndex?: number): void {
    el.style.zIndex = this.resolveFragmentWrapperZIndex(fragment, resolvedZIndex);
  }

  private applyResolvedFragmentFrame(
    el: HTMLElement,
    item: ResolvedFragmentItem | ResolvedTableItem | ResolvedImageItem | ResolvedDrawingItem,
    fragment: Fragment,
    section?: 'body' | 'header' | 'footer',
    story?: LayoutStoryLocator,
  ): void {
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.width}px`;
    el.dataset.blockId = item.blockId;
    el.dataset.layoutEpoch = String(this.layoutEpoch);
    applySourceAnchorDataset(el, item.sourceAnchor);
    applyLayoutIdentityDataset(
      el,
      resolveOrBuildFragmentIdentity(
        fragment,
        story ?? resolveSectionStory(section),
        item.layoutSourceIdentity
          ? { ...item.layoutSourceIdentity, sourceAnchor: item.sourceAnchor ?? item.layoutSourceIdentity.sourceAnchor }
          : undefined,
      ),
    );
    this.applyFragmentWrapperZIndex(el, fragment, item.zIndex);

    if (item.fragmentKind === 'image' || item.fragmentKind === 'drawing' || item.fragmentKind === 'table') {
      el.style.height = `${item.height}px`;
    }

    this.applyFragmentPmAttributes(el, fragment, section, item);
  }

  /**
   * Estimates the height of a fragment when explicit height is not available.
   *
   * This method provides fallback height calculations for footer bottom-alignment
   * from resolved layout data, or using the fragment's height property for
   * tables, images, and drawings.
   *
   * @param fragment - The fragment to estimate height for
   * @returns Estimated height in pixels, or 0 if height cannot be determined
   */
  private estimateFragmentHeight(fragment: Fragment, resolvedItem?: ResolvedPaintItem): number {
    if (resolvedItem && 'height' in resolvedItem && typeof resolvedItem.height === 'number') {
      return resolvedItem.height;
    }
    // Atomic fragment kinds carry their own height on the fragment.
    if (fragment.kind === 'table' || fragment.kind === 'image' || fragment.kind === 'drawing') {
      return fragment.height;
    }
    return 0;
  }
}

const fragmentKey = (fragment: Fragment): string => {
  switch (fragment.kind) {
    case 'para':
      return `para:${fragment.blockId}:${fragment.fromLine}:${fragment.toLine}`;
    case 'list-item':
      throw new Error(`DomPainter: unsupported fragment kind ${fragment.kind}`);
    case 'image':
      return `image:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'drawing':
      return `drawing:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'table': {
      // Include row range and partial row info to uniquely identify table fragments
      // This is critical for mid-row splitting where multiple fragments can exist for the same table
      const partialKey = fragment.partialRow
        ? `:${fragment.partialRow.fromLineByCell.join(',')}-${fragment.partialRow.toLineByCell.join(',')}`
        : '';
      return `table:${fragment.blockId}:${fragment.fromRow}:${fragment.toRow}${partialKey}`;
    }
    default: {
      const _exhaustiveCheck: never = fragment;
      return _exhaustiveCheck;
    }
  }
};

const hasFragmentGeometryChanged = (previous: Fragment, next: Fragment): boolean =>
  previous.x !== next.x ||
  previous.y !== next.y ||
  previous.width !== next.width ||
  ('height' in previous &&
    'height' in next &&
    typeof previous.height === 'number' &&
    typeof next.height === 'number' &&
    previous.height !== next.height);

const isNonBodyStoryBlockId = (blockId: string | undefined): boolean =>
  typeof blockId === 'string' &&
  (blockId.startsWith('footnote-') ||
    blockId.startsWith('endnote-') ||
    blockId.startsWith('__sd_semantic_footnote-') ||
    blockId.startsWith('__sd_semantic_endnote-'));
