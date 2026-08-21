import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { ContextMenuPluginKey } from '@extensions/context-menu/context-menu.js';
import { CellSelection } from 'prosemirror-tables';
import { PresentationPostPaintPipeline } from './dom/PresentationPostPaintPipeline.js';
import { HoverGroupCoordinator } from './dom/HoverGroupCoordinator.js';
import { ProofingSessionManager } from './proofing/ProofingSessionManager.js';
import { PresentationPainterAdapter } from './rendering/PresentationPainterAdapter.js';
import { resolveLayout } from '@superdoc/layout-resolved';
import type { DomPainterInput, LayoutMode, PaintSnapshot } from '@superdoc/painter-dom';
import type { ProofingAnnotation, ProofingConfig } from './proofing/types.js';
import {
  computeWordSelectionRangeAt,
  computeParagraphSelectionRangeAt as computeParagraphSelectionRangeAtFromHelper,
  computeWordSelectionRangeAt as computeWordSelectionRangeAtFromHelper,
  getFirstTextPosition as getFirstTextPositionFromHelper,
  registerPointerClick as registerPointerClickFromHelper,
} from './input/ClickSelectionUtilities.js';
import {
  findStructuredContentBlockAtPos,
  findStructuredContentInlineAtPos,
} from './input/structured-content-resolution.js';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Mapping } from 'prosemirror-transform';
import { Editor } from '../Editor.js';
import { resolveEvenAndOddHeadersFromSettingsPart } from '../super-converter/v2/importer/docxImporter.js';
import { EventEmitter } from '../EventEmitter.js';
import type { ProseMirrorJSON } from '../types/EditorTypes.js';
import { EpochPositionMapper } from './layout/EpochPositionMapper.js';
import { DomPositionIndex } from '../../dom-observer/DomPositionIndex.js';
import { DomPositionIndexObserverManager } from '../../dom-observer/DomPositionIndexObserverManager.js';
import {
  computeDomCaretPageLocal as computeDomCaretPageLocalFromDom,
  computeSelectionRectsFromDom as computeSelectionRectsFromDomFromDom,
} from '../../dom-observer/DomSelectionGeometry.js';
import {
  readLayoutEpochFromDom as readLayoutEpochFromDomFromDom,
  resolvePositionWithinFragmentDom as resolvePositionWithinFragmentDomFromDom,
  resolveTextBoundaryWithinFragmentDom as resolveTextBoundaryWithinFragmentDomFromDom,
} from '../../dom-observer/index.js';
import {
  convertPageLocalToOverlayCoords as convertPageLocalToOverlayCoordsFromTransform,
  getPageOffsetX as getPageOffsetXFromTransform,
  getPageOffsetY as getPageOffsetYFromTransform,
} from './dom/CoordinateTransform.js';
import {
  normalizeClientPoint as normalizeClientPointFromPointer,
  denormalizeClientPoint as denormalizeClientPointFromPointer,
} from './dom/PointerNormalization.js';
import { getPageElementByIndex } from '../../dom-observer/PageDom.js';
import { inchesToPx, parseColumns } from './layout/LayoutOptionParsing.js';
import { createLayoutMetrics as createLayoutMetricsFromHelper } from './layout/PresentationLayoutMetrics.js';
import { buildFootnotesInput, type NoteRenderOverride } from './layout/FootnotesBuilder.js';
import { computeNoteNumbering, type SectionNoteConfig } from './layout/computeNoteNumbering.js';

/** Stable serialization of section-level note configs for the flow-block cache key. */
function serializeSectionConfigs(map: Map<number, SectionNoteConfig>): string {
  if (map.size === 0) return '';
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, c]) => `${i}:${c.numFmt ?? ''}/${c.numStart ?? ''}/${c.numRestart ?? ''}`)
    .join(';');
}

/**
 * Stable serialization of per-ref numbering / format maps for the flow-block
 * cache key. The set of ids appears in `order` already, but the *values*
 * (computed ordinals + per-id format overrides) must also vary the key —
 * otherwise toggling `customMarkFollows` on a middle ref, or moving a ref
 * across a section that changes its numFmt, leaves the cached reference
 * runs out of date with the live numbering.
 */
function serializePerIdNumbering(
  order: string[],
  numberById: Record<string, number>,
  formatById: Record<string, string> | undefined,
): string {
  if (order.length === 0) return '';
  const parts: string[] = [];
  for (const id of order) {
    const n = numberById[id];
    const f = formatById?.[id] ?? '';
    parts.push(`${id}:${n ?? ''}/${f}`);
  }
  return parts.join(';');
}

type PresentationNavigationOptions = {
  behavior?: ScrollBehavior;
  block?: 'start' | 'center' | 'end' | 'nearest';
  shouldContinue?: () => boolean;
};

function shouldContinueNavigation(options: PresentationNavigationOptions): boolean {
  return options.shouldContinue?.() !== false;
}

import { safeCleanup } from './utils/SafeCleanup.js';
import { createHiddenHost } from './dom/HiddenHost.js';
import {
  elementsToRangeRects,
  findRenderedCommentElements,
  findRenderedContentControlElements,
  findRenderedTrackedChangeElementsStrict,
} from './dom/EntityRectFinder.js';
import { RemoteCursorManager, type RenderDependencies } from './remote-cursors/RemoteCursorManager.js';
import { EditorInputManager } from './pointer-events/EditorInputManager.js';
import { SelectionSyncCoordinator } from './selection/SelectionSyncCoordinator.js';
import { PresentationInputBridge } from './input/PresentationInputBridge.js';
import { calculateExtendedSelection, stabilizeTextSelectionAcrossTableCells } from './selection/SelectionHelpers.js';
import { getAtomNodeTypes as getAtomNodeTypesFromSchema } from './utils/SchemaNodeTypes.js';
import { buildPositionMapFromPmDoc } from './utils/PositionMapFromPm.js';
import {
  computeA11ySelectionAnnouncement as computeA11ySelectionAnnouncementFromHelper,
  scheduleA11ySelectionAnnouncement as scheduleA11ySelectionAnnouncementFromHelper,
  syncHiddenEditorA11yAttributes as syncHiddenEditorA11yAttributesFromHelper,
} from './utils/A11ySupport.js';
import { computeSelectionVirtualizationPins } from './selection/SelectionVirtualizationPins.js';
import { debugLog, updateSelectionDebugHud, type SelectionDebugHudState } from './selection/SelectionDebug.js';
import { renderCellSelectionOverlay } from './selection/CellSelectionOverlay.js';
import {
  createCaretElement,
  renderCaretOverlay,
  renderSelectionRects,
} from './selection/LocalSelectionOverlayRendering.js';
import { computeCaretLayoutRectGeometry as computeCaretLayoutRectGeometryFromHelper } from './selection/CaretGeometry.js';
import { shouldUseNativeCaretFallback } from './selection/native-caret-fallback.js';
import {
  computeCaretRectFromPmPosition as computeCaretRectFromPmPositionFromHelper,
  computeCaretRectFromVisibleTextOffset as computeCaretRectFromVisibleTextOffsetFromHelper,
  computeSelectionRectsFromPmRange as computeSelectionRectsFromPmRangeFromHelper,
  computeSelectionRectsFromVisibleTextOffsets as computeSelectionRectsFromVisibleTextOffsetsFromHelper,
  measureVisibleTextOffset as measureVisibleTextOffsetFromHelper,
  measureVisibleTextOffsetInContainers as measureVisibleTextOffsetInContainersFromHelper,
  resolveVisibleTextBoundary as resolveVisibleTextBoundaryFromHelper,
} from './selection/VisibleTextOffsetGeometry.js';
import { collectCommentPositions as collectCommentPositionsFromHelper } from './utils/CommentPositionCollection.js';
import { getCurrentSectionPageStyles as getCurrentSectionPageStylesFromHelper } from './layout/SectionPageStyles.js';
import {
  computeAnchorMap as computeAnchorMapFromHelper,
  goToAnchor as goToAnchorFromHelper,
} from './utils/AnchorNavigation.js';
import {
  getCellPosFromTableHit as getCellPosFromTableHitFromHelper,
  getTablePosFromHit as getTablePosFromHitFromHelper,
  hitTestTable as hitTestTableFromHelper,
  shouldUseCellSelection as shouldUseCellSelectionFromHelper,
} from './tables/TableSelectionUtilities.js';
import { DragDropManager } from './input/DragDropManager.js';
import { processAndInsertImageFile } from '@extensions/image/imageHelpers/processAndInsertImageFile.js';
import { HeaderFooterSessionManager } from './header-footer/HeaderFooterSessionManager.js';
import type { HeaderFooterLayoutSnapshot } from '../header-footer/types.js';
import { StoryPresentationSessionManager } from './story-session/StoryPresentationSessionManager.js';
import type {
  StorySessionEditorFactoryInput,
  StorySessionEditorFactoryResult,
} from './story-session/StoryPresentationSessionManager.js';
import type { StoryPresentationSession } from './story-session/types.js';
import { resolveStoryRuntime } from '../../document-api-adapters/story-runtime/resolve-story-runtime.js';
import { parseRenderedNoteTarget, type RenderedNoteTarget } from './notes/note-target.js';
import { NoteSessionCoordinator } from './notes/NoteSessionCoordinator.js';
import { BODY_STORY_KEY, buildStoryKey, parseStoryKey } from '../../document-api-adapters/story-runtime/story-key.js';
import { createStoryEditor } from '../story-editor-factory.js';
import { buildEndnoteBlocks } from './layout/EndnotesBuilder.js';
import { toFlowBlocks, FlowBlockCache } from '@core/layout-adapter';
import type { ConverterContext } from '@core/layout-adapter/converter-context.js';
import {
  readSettingsRoot,
  readDefaultTableStyle,
  readFootnoteNumberFormat,
  readEndnoteNumberFormat,
  readFootnoteNumberStart,
  readEndnoteNumberStart,
  readFootnoteNumberRestart,
  readEndnoteNumberRestart,
  readFootnotePosition,
  readEndnotePosition,
  readSectionNoteConfigs,
} from '../../document-api-adapters/document-settings.js';
import {
  incrementalLayout,
  selectionToRects,
  getFragmentAtPosition,
  extractIdentifierFromConverter,
  buildMultiSectionIdentifier,
  layoutHeaderFooterWithCache as _layoutHeaderFooterWithCache,
  PageGeometryHelper,
  clickToPositionGeometry,
} from '@superdoc/layout-bridge';
import { resolvePointerPositionHit } from './input/PositionHitResolver.js';
import type {
  HeaderFooterIdentifier,
  HeaderFooterLayoutResult,
  HeaderFooterConstraints,
  HeaderFooterType,
  PositionHit,
  TableHitResult,
  FootnoteReserveSeed,
} from '@superdoc/layout-bridge';

import { measureBlock } from '@superdoc/measuring-dom';
import {
  createFontResolver,
  deriveBundledActivation,
  type FontResolutionRecord,
  type DocumentFontOption,
  type FontLoadSummary,
  type ResolvePhysicalFamily,
} from '@superdoc/font-system';
import { installBundledSubstitutes } from '@superdoc/font-system/bundled';
import { FontReadinessGate } from './fonts/FontReadinessGate';
import { DocumentFontController, type EmbeddedFontFace } from './fonts/DocumentFontController';
import { planFontFaces, type FontPlan } from './fonts/font-load-planner';
import type { FontsChangedPayload } from '../types/EditorEvents';
import type { FontFamilyConfig } from '../types/EditorConfig';
import type {
  ColumnLayout,
  FlowBlock,
  Layout,
  Measure,
  Page,
  ResolvedLayout,
  SectionMetadata,
  TrackedChangesMode,
  Fragment,
  DocumentBackground,
} from '@superdoc/contracts';
import { extractHeaderFooterSpace as _extractHeaderFooterSpace } from '@superdoc/contracts';
// TrackChangesBasePluginKey is used by #syncTrackedChangesPreferences and getTrackChangesPluginState.
import { TrackChangesBasePluginKey } from '@extensions/track-changes/plugins/index.js';
import { runEditorRedo, runEditorUndo } from '@extensions/history/history.js';
import {
  DocumentHistoryCoordinator,
  NoteEditorRegistry,
  createBodyParticipant,
  createHeaderFooterParticipant,
  createNoteParticipant,
  buildHeaderFooterParticipantKey,
  readEditorHistorySnapshot,
  type BatchHistoryRecord,
  type DocumentHistoryState,
  type DocumentHistorySurface,
  type NoteCommitHook,
  type UnifiedHistoryCueEvent,
} from './history/index.js';

// Collaboration cursor imports
import { ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import type { HeaderFooterDescriptor } from '../header-footer/HeaderFooterRegistry.js';
import { SOURCE_HEADER_FOOTER_LOCAL, isHeaderFooterPartId } from '../parts/adapters/header-footer-part-descriptor.js';
import type { PartChangedEvent } from '../parts/types.js';
import { isInRegisteredSurface } from './utils/uiSurfaceRegistry.js';
import { buildSemanticFootnoteBlocks } from './semantic-flow-footnotes.js';

type ThreadAnchorScrollPlan = {
  achievedClientY: number;
  applyScroll: (behavior: ScrollBehavior) => void;
};

type UnifiedHistoryDebugGlobal = typeof globalThis & {
  __SD_DEBUG_UNIFIED_HISTORY__?: boolean;
};

type NoteStorySession = StoryPresentationSession & {
  locator: Extract<StoryLocator, { kind: 'story'; storyType: 'footnote' | 'endnote' }>;
};

type BoundedCommentPositionEntry = {
  threadId: string;
  start?: number;
  end?: number;
  pos?: number;
  key?: string;
  storyKey?: string;
  kind?: 'trackedChange' | 'comment';
  bounds?: unknown;
  rects?: unknown;
  pageIndex?: number;
};

type NoteLayoutContext = {
  target: RenderedNoteTarget;
  blocks: FlowBlock[];
  measures: Measure[];
  firstPageIndex: number;
  hostWidthPx: number;
};

const INTERNAL_NOTE_COMMIT_SOURCES = new Set(['story-runtime:commit:footnote', 'story-runtime:commit:endnote']);

const isInternalNoteCommitSource = (event?: { source?: unknown } | null): boolean => {
  return typeof event?.source === 'string' && INTERNAL_NOTE_COMMIT_SOURCES.has(event.source);
};

type RenderedNoteFragmentHit = {
  fragmentElement: HTMLElement;
  pageIndex: number;
};

import { splitRunsAtDecorationBoundaries } from './layout/SplitRunsAtDecorationBoundaries.js';
import { DOM_CLASS_NAMES } from '@superdoc/dom-contract';
import {
  ensureEditorNativeSelectionStyles,
  ensureEditorFieldAnnotationInteractionStyles,
  ensureEditorMovableObjectInteractionStyles,
} from './dom/EditorStyleInjector.js';

import type {
  ResolveRangeOutput,
  DocumentApi,
  NavigableAddress,
  BlockNavigationAddress,
  BookmarkAddress,
  StoryLocator,
} from '@superdoc/document-api';
import { isStoryLocator } from '@superdoc/document-api';
import { getBlockIndex } from '../../document-api-adapters/helpers/index-cache.js';
import { findBlockByNodeIdOnly, findBlockById } from '../../document-api-adapters/helpers/node-address-resolver.js';
import {
  findAllBookmarksInDocument,
  resolveBookmarkTarget,
} from '../../document-api-adapters/helpers/bookmark-resolver.js';
import {
  resolveTrackedChange,
  resolveTrackedChangeInStory,
  resolveTrackedChangeNavigationSelection,
} from '../../document-api-adapters/helpers/tracked-change-resolver.js';
import { makeTrackedChangeAnchorKey } from '../../document-api-adapters/helpers/tracked-change-runtime-ref.js';
import { getTrackedChangeIndex } from '../../document-api-adapters/tracked-changes/tracked-change-index.js';
import { normalizeVariant } from './header-footer/header-footer-variant.js';
import type { SelectionHandle } from '../selection-state.js';

const DOCUMENT_RELS_PART_ID = 'word/_rels/document.xml.rels';

// Types
import type {
  PageSize,
  PageMargins,
  VirtualizationOptions,
  RemoteUserInfo,
  RemoteCursorState,
  PresenceOptions,
  LayoutEngineOptions,
  TrackedChangesOverrides,
  PresentationEditorOptions,
  RemoteCursorsRenderPayload,
  LayoutUpdatePayload,
  ImageSelectedEvent,
  ImageDeselectedEvent,
  TelemetryEvent,
  CellAnchorState,
  EditorWithConverter,
  LayoutState,
  FootnoteReference,
  FootnotesLayoutInput,
  LayoutMetrics,
  LayoutError,
  LayoutRect,
  RangeRect,
  HeaderFooterMode,
  HeaderFooterSession,
  HeaderFooterRegion,
  HeaderFooterLayoutContext,
  PendingMarginClick,
  EditorViewWithScrollFlag,
  PotentiallyMockedFunction,
  ResolvedLayoutOptions,
  AwarenessWithSetField,
} from './types.js';

// Re-export public types for backward compatibility
export type {
  PageSize,
  PageMargins,
  VirtualizationOptions,
  RemoteUserInfo,
  RemoteCursorState,
  PresenceOptions,
  LayoutEngineOptions,
  TrackedChangesOverrides,
  PresentationEditorOptions,
  RemoteCursorsRenderPayload,
  LayoutUpdatePayload,
  ImageSelectedEvent,
  ImageDeselectedEvent,
  TelemetryEvent,
} from './types.js';

/**
 * Bundles the active editing surface's editor, document API, surface label,
 * and resolved selection range into a single coherent object.
 *
 * Guarantees that `doc` and `range` refer to the same editing surface.
 * This is the canonical layout-mode command surface — use it whenever the
 * active context (body / header / footer) matters for the follow-up mutation.
 */
export type SelectionCommandContext = {
  editor: Editor;
  doc: DocumentApi;
  surface: 'body' | 'header' | 'footer';
  range: ResolveRangeOutput;
};

// Mark name constants
import { CommentMarkName } from '@extensions/comment/comments-constants.js';
import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName } from '@extensions/track-changes/constants.js';

const DEFAULT_PAGE_SIZE: PageSize = { w: 612, h: 792 }; // Letter @ 72dpi
const DEFAULT_MARGINS: PageMargins = { top: 72, right: 72, bottom: 72, left: 72 };
/** Default gap between pages (from containerStyles in styles.ts) */
const DEFAULT_PAGE_GAP = 24;
/** Default gap for horizontal layout mode */
const DEFAULT_HORIZONTAL_PAGE_GAP = 20;

// Constants for interaction timing and thresholds
/** Maximum time between clicks to register as multi-click (milliseconds) */
const MULTI_CLICK_TIME_THRESHOLD_MS = 400;
/** Maximum distance between clicks to register as multi-click (pixels) */
const MULTI_CLICK_DISTANCE_THRESHOLD_PX = 5;
/**
 * AIDEV-NOTE: Navigated caret repair uses three complementary paths: immediate selection render,
 * scroll-linked settle render, and fixed viewport-coordinate retries. Smooth scrolling plus
 * virtualization can skip any one signal, so keep the tuned values named and co-located.
 */
const NAVIGATED_CARET_REPAIR_DELAYS_MS = [120, 360, 900, 1300] as const;
const NAVIGATED_CARET_DRIFT_TOLERANCE_PX = 3;
const NAVIGATED_CARET_MAX_REPAIR_ATTEMPTS = 3;
const SELECTION_SCROLL_SETTLE_RENDER_DELAY_MS = 120;
const SELECTION_SCROLL_SETTLE_FINALIZE_DELAY_MS = 900;

/** Debug flag for performance logging - enable with SD_DEBUG_LAYOUT env variable */
const layoutDebugEnabled =
  typeof process !== 'undefined' && typeof process.env !== 'undefined' && Boolean(process.env.SD_DEBUG_LAYOUT);

/** Log performance metrics when debug is enabled */
const perfLog = (...args: unknown[]): void => {
  if (!layoutDebugEnabled) return;
  console.log(...args);
};
/** Budget for header/footer initialization before warning (milliseconds) */
const HEADER_FOOTER_INIT_BUDGET_MS = 200;
/** Maximum zoom level before warning */
const MAX_ZOOM_WARNING_THRESHOLD = 10;
/** Maximum number of selection rectangles per user (performance guardrail) */
const MAX_SELECTION_RECTS_PER_USER = 100;
/** Debounce delay for semantic-flow relayout after host resize (milliseconds). */
const SEMANTIC_RESIZE_DEBOUNCE_MS = 120;
/** Minimum semantic content width in pixels. */
const MIN_SEMANTIC_CONTENT_WIDTH_PX = 1;

const GLOBAL_PERFORMANCE: Performance | undefined = typeof performance !== 'undefined' ? performance : undefined;

/**
 * PresentationEditor bootstraps the classic Editor instance in a hidden container
 * while layout-engine handles the visible rendering pipeline.
 */
export class PresentationEditor extends EventEmitter {
  // Static registry for managing instances globally
  static #instances = new Map<string, PresentationEditor>();

  /**
   * Fallback color palette for remote cursors when user.color is not provided.
   * Colors are deterministically assigned based on clientId to maintain consistency.
   * @private
   */
  static readonly FALLBACK_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
  ];

  /**
   * Constants for remote cursor rendering styles.
   * Centralized styling values for consistent cursor/label rendering across all methods.
   * @private
   */
  static readonly CURSOR_STYLES = {
    CARET_WIDTH: 2,
    LABEL_FONT_SIZE: 13,
    LABEL_PADDING: '2px 6px',
    LABEL_OFFSET: '-1.05em',
    SELECTION_BORDER_RADIUS: '2px',
    MAX_LABEL_LENGTH: 30,
  } as const;

  /**
   * Get a PresentationEditor instance by document ID.
   */
  static getInstance(documentId: string): PresentationEditor | undefined {
    return PresentationEditor.#instances.get(documentId);
  }

  /**
   * Set zoom globally across all PresentationEditor instances.
   */
  static setGlobalZoom(zoom: number): void {
    PresentationEditor.#instances.forEach((instance) => {
      instance.setZoom(zoom);
    });
  }

  #options: PresentationEditorOptions;
  /** Key used to register this instance in the static registry. Separate from options.documentId to avoid mutating caller's object. */
  #registryKey: string | null = null;
  #editor: Editor;
  #visibleHost: HTMLElement;
  #viewportHost: HTMLElement;
  #painterHost: HTMLElement;
  #selectionOverlay: HTMLElement;
  #permissionOverlay: HTMLElement | null = null;
  /** SD-3400: highlight + smart-scroll + emptied-note commit for the open note session. */
  #noteSessionCoordinator: NoteSessionCoordinator | null = null;
  #hiddenHost: HTMLElement;
  /** Scroll-isolating wrapper around #hiddenHost. Append/remove this from the DOM. */
  #hiddenHostWrapper: HTMLElement;
  /**
   * Hidden-host elements owned by this instance (story-session hosts in
   * addition to #hiddenHost). Hidden hosts mount on document.body without an
   * instance marker, so the input bridge consults this set to tell our
   * editors apart from those of other SuperDoc instances on the page (SD-3249).
   */
  #ownedHiddenHosts = new WeakSet<HTMLElement>();
  #layoutOptions: LayoutEngineOptions;
  #configuredDocumentBackground: DocumentBackground | undefined;
  #layoutState: LayoutState = { blocks: [], measures: [], layout: null, bookmarks: new Map() };
  /**
   * The font-mapping signature `#layoutState.measures` were produced with. Travels with the
   * measures so the next render can tell incrementalLayout whether a mapping change since the
   * prior pass invalidates previous-measure reuse (that reuse fast path bypasses the cache key).
   */
  #layoutFontSignature = '';
  /**
   * SD-3432: the previous render's footnote reserve fixed point, used to
   * warm-start the next render's convergence loop (validated, never trusted
   * — see FootnoteReserveSeed). Private: deliberately NOT part of LayoutState
   * (that payload is emitted publicly via onLayoutUpdated).
   */
  #footnoteReserveSeed: FootnoteReserveSeed | null = null;
  #layoutLookupBlocks: FlowBlock[] = [];
  #layoutLookupMeasures: Measure[] = [];
  /** Cache for incremental toFlowBlocks conversion */
  #flowBlockCache: FlowBlockCache = new FlowBlockCache();
  #footnoteNumberSignature: string | null = null;
  #endnoteNumberSignature: string | null = null;
  // §17.11.19 eachPage requires a two-pass pagination handshake that the
  // layout pipeline does not yet implement; we coerce eachPage → continuous
  // and emit a single warning per kind per editor instance.
  #warnedUnsupportedRestart: { footnote: boolean; endnote: boolean } = {
    footnote: false,
    endnote: false,
  };
  #painterAdapter = new PresentationPainterAdapter();
  #pageGeometryHelper: PageGeometryHelper | null = null;
  #dragDropManager: DragDropManager | null = null;
  #layoutError: LayoutError | null = null;
  #layoutErrorState: 'healthy' | 'degraded' | 'failed' = 'healthy';
  #errorBanner: HTMLElement | null = null;
  #errorBannerMessage: HTMLElement | null = null;
  #renderScheduled = false;
  #pendingDocChange = false;
  #focusScrollRafId: number | null = null;
  #selectionScrollSettleCleanup: (() => void) | null = null;
  #selectionNavigationToken = 0;
  #activeSelectionNavigation: {
    token: number;
    targetPos: number;
    scrollSettled: boolean;
    repairAttempts: number;
  } | null = null;
  #pendingMapping: Mapping | null = null;
  #isRerendering = false;
  /** SD-2368: while true, #flushRerenderQueue defers visible repaints until composition ends. */
  #isComposing = false;
  #compositionDeferralCleanup: Array<() => void> = [];
  #compositionTargetCleanup: Array<() => void> = [];
  #compositionTargetDom: HTMLElement | null = null;
  #selectionSync = new SelectionSyncCoordinator();
  /** Load-before-measure gate: awaits required fonts before measurement, reflows on late load. */
  #fontGate: FontReadinessGate | null = null;
  /**
   * This document's logical->physical font resolver. Per-instance (per document) so two
   * editors can map the same logical family differently without leaking. Planner, gate, report,
   * MEASURE (body, footnotes, header/footer, per-rId header/footer, field-annotation pills, table
   * AutoFit column widths, and line-height metrics) and document-content PAINT (text, field
   * annotations, list markers, drop caps) resolve through THIS instance, FACE-aware (per weight/style)
   * so a single-face clone is never mapped onto a face it lacks. Rendered-layout identity - measure
   * caches and paint-reuse versions - is keyed on the stored render plan's `FontPlan.effectiveSignature`,
   * which captures the actual per-face resolutions (so a `fonts.add()` that changes a face for an
   * UNCHANGED family map still busts the cache); `resolver.signature` is used ONLY for map-change
   * detection in the document font controller, never as a cache key. Two documents with different
   * mappings do not share a measure or reuse each other's content paint. (Editor chrome such as
   * formatting marks is not document content and is out of scope.) `superdoc.fonts.map` mutates this
   * resolver at runtime through that controller (the only writer): the changed resolution re-measures
   * and repaints THIS document while others are left untouched. Seeded with bundled DocFonts fallbacks.
   */
  readonly #fontResolver = createFontResolver();
  /**
   * Source for the NEXT `fonts-changed` emit. The controller sets it to 'config-change' when a
   * runtime mapping change is applied, so the emit is not mislabelled 'late-load'. Consumed (and
   * cleared) by #emitFontsChangedIfChanged on the next emit.
   */
  #nextFontsChangedSource: 'config-change' | null = null;
  /**
   * The single writer for this document's font state (map/unmap/reset; add/preload follow). Config
   * and `superdoc.fonts.*` route through it so they share one path. It owns orchestration, not the
   * resolver: it mutates the injected #fontResolver and reflows via the gate's mapping path.
   */
  readonly #fontController = new DocumentFontController({
    resolver: this.#fontResolver,
    getGate: () => this.#fontGate,
    onDocumentFontConfigApplied: () => {
      this.#nextFontsChangedSource = 'config-change';
    },
  });
  /** Layout blocks for the current render, stashed so the gate's planner reads the live set. */
  #fontPlanBlocks: FlowBlock[] | null = null;
  /**
   * The current render font plan, rebuilt each render before the gate runs. The SINGLE source for
   * load (requiredFaces), diagnostics (usedFaces), and measure/paint cache identity (effectiveSignature).
   */
  #fontPlan: FontPlan | null = null;
  /**
   * Face-availability oracle for face-aware resolution: is a (family, weight, style) face REGISTERED
   * (bundled + `fonts.add()`) in THIS document's registry? False before the gate/registry exists.
   */
  #hasFace = (family: string, weight: '400' | '700', style: 'normal' | 'italic'): boolean =>
    this.#fontGate ? this.#fontGate.resolveRegistry().hasFace(family, weight, style) : false;
  /** Dedup key for `fonts-changed`: epoch + per-face load status. Null until the first emit. */
  #lastFontsChangedKey: string | null = null;
  /** Font-config epoch at the last emit, so a face-set delta (epoch unchanged) is distinguished from a
   *  late load (epoch bumped) when labelling the `fonts-changed` source. */
  #lastFontsChangedVersion = -1;
  /** Last emitted `fonts-changed` payload, so a late relay subscriber can replay it. */
  #lastFontsChangedPayload: FontsChangedPayload | null = null;
  /**
   * When true, the next selection render scrolls the caret/selection head into view.
   * Only set for user-initiated actions (keyboard/mouse selection, image click, zoom).
   * Not set on each `selectionUpdate` while a pointer drag is active — edge auto-scroll
   * owns the viewport then; `notifyDragSelectionEnded` restores one scroll after mouseup.
   * Passive re-renders (virtualization remounts, layout completions, DOM rebuilds) leave
   * this unset so they don't fight the user's scroll position.
   */
  #shouldScrollSelectionIntoView = false;
  /**
   * SD-3315: while a search-owned scrollToPosition({ suppressSelectionSyncScroll: true }) is in
   * flight (set before its sync scroll, cleared in its RAF re-assert), selection-sync must NOT
   * scroll the viewport. Find navigation owns the scroll for that window; the spurious
   * selectionUpdate fired by the find-input focus restore (which reverts the editor selection to
   * its pre-search caret) would otherwise yank the viewport to that stale caret, producing a
   * jump/flash on every navigation. The selection overlay still renders during the window; only
   * #scrollActiveEndIntoView is skipped.
   */
  #suppressSelectionScrollUntilRaf = false;
  /** PM position for transient drag/drop insertion preview, rendered even while editor focus is elsewhere. */
  #dragDropIndicatorPos: number | null = null;
  #epochMapper = new EpochPositionMapper();
  #layoutEpoch = 0;
  #htmlAnnotationHeights: Map<string, number> = new Map();
  #htmlAnnotationMeasureEpoch = -1;
  #htmlAnnotationMeasureAttempts = 0;
  #domPositionIndex = new DomPositionIndex();
  #domIndexObserverManager: DomPositionIndexObserverManager | null = null;
  /** Owns the remaining editor-side post-paint DOM mutation pipeline. */
  #postPaintPipeline = new PresentationPostPaintPipeline();
  /** Proofing session manager — handles provider lifecycle, scheduling, and store. */
  #proofingManager: ProofingSessionManager | null = null;
  /** RAF handle for coalesced decoration sync scheduling. */
  #decorationSyncRafHandle: number | null = null;
  #rafHandle: number | null = null;
  #semanticResizeObserver: ResizeObserver | null = null;
  #semanticResizeRaf: number | null = null;
  #semanticResizeDebounce: number | null = null;
  #lastSemanticContainerWidth: number | null = null;
  #editorListeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
  #scrollHandler: ((event?: Event) => void) | null = null;
  #handledScrollEvents = new WeakSet<Event>();
  #scrollContainer: Element | Window | null = null;
  #scrollContainerValidated = false;
  #sectionMetadata: SectionMetadata[] = [];
  #documentMode: 'editing' | 'viewing' | 'suggesting' = 'editing';
  #inputBridge: PresentationInputBridge | null = null;
  #trackedChangesMode: TrackedChangesMode = 'review';
  #trackedChangesEnabled = true;
  #trackedChangesOverrides: TrackedChangesOverrides | undefined;
  // Header/footer session management
  #headerFooterSession: HeaderFooterSessionManager | null = null;
  /**
   * Generic story-backed presentation-session manager.
   *
   * Story-backed parts (headers, footers, footnotes, endnotes) all use this
   * manager to keep ProseMirror off-screen while DomPainter remains the sole
   * visible renderer.
   */
  #storySessionManager: StoryPresentationSessionManager | null = null;
  #hoverOverlay: HTMLElement | null = null;
  #hoverTooltip: HTMLElement | null = null;
  #modeBanner: HTMLElement | null = null;
  #ariaLiveRegion: HTMLElement | null = null;
  #a11ySelectionAnnounceTimeout: number | null = null;
  #a11yLastAnnouncedSelectionKey: string | null = null;
  #headerFooterSelectionHandler: ((...args: unknown[]) => void) | null = null;
  #headerFooterEditor: Editor | null = null;
  #storySessionSelectionHandler: ((...args: unknown[]) => void) | null = null;
  #storySessionTransactionHandler: ((...args: unknown[]) => void) | null = null;
  #storySessionEditor: Editor | null = null;
  /**
   * Document-wide history coordinator. Enabled by default and disabled only
   * when callers explicitly set `experimental.unifiedHistory` to `false`.
   */
  #historyCoordinator: DocumentHistoryCoordinator | null = null;
  /**
   * Dormant registry for note/endnote editors that must outlive their
   * presentation-mode session so coordinator-driven undo/redo can still
   * reach their local history.
   */
  #noteEditorRegistry: NoteEditorRegistry | null = null;
  /** Unsubscribes collected while wiring the coordinator; called on destroy. */
  #historyCoordinatorCleanup: Array<() => void> = [];
  /** Guards note-registry disposal callbacks triggered by coordinator-driven purges. */
  #coordinatorDrivenNotePurges = new Set<string>();
  /** Last emitted active surface so toolbar/UI consumers only recompute when it changes. */
  #lastPublishedActiveSurface: DocumentHistorySurface | null = null;
  #activeSurfaceUiEventEditor: Editor | null = null;
  #activeSurfaceUiUpdateHandler: ((...args: unknown[]) => void) | null = null;
  #activeSurfaceUiContextMenuOpenHandler: ((...args: unknown[]) => void) | null = null;
  #activeSurfaceUiContextMenuCloseHandler: ((...args: unknown[]) => void) | null = null;
  #lastSelectedFieldAnnotation: {
    element: HTMLElement;
    pmStart: number;
  } | null = null;
  #lastSelectedStructuredContentBlock: {
    id: string | null;
    elements: HTMLElement[];
    wrapperElements: HTMLElement[];
    ancestorElements: HTMLElement[];
  } | null = null;
  #lastSelectedStructuredContentInline: {
    id: string | null;
    elements: HTMLElement[];
  } | null = null;
  /**
   * Group-hover coordinators. SDT and TOC entries each highlight every
   * fragment that shares an id, so they share the same "hover one, class the
   * whole group" mechanic. Wired in #initializeHoverCoordinators after
   * painterHost/painterAdapter exist.
   */
  #sdtHoverCoordinator: HoverGroupCoordinator | null = null;
  #tocHoverCoordinator: HoverGroupCoordinator | null = null;

  // Remote cursor/presence state management
  /** Manager for remote cursor rendering and awareness subscriptions */
  #remoteCursorManager: RemoteCursorManager | null = null;
  /** Debounce timer for local cursor awareness updates (avoids ~190ms Liveblocks overhead per keystroke) */
  #cursorUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** DOM element for rendering remote cursor overlays */
  #remoteCursorOverlay: HTMLElement | null = null;
  /** DOM element for rendering local selection/caret (dual-layer overlay architecture) */
  #localSelectionLayer: HTMLElement | null = null;

  // Editor input management
  /** Manager for pointer events, focus, drag selection, and click handling */
  #editorInputManager: EditorInputManager | null = null;

  constructor(options: PresentationEditorOptions) {
    super();

    if (!options?.element) {
      throw new Error('PresentationEditor requires an `element` to mount into.');
    }

    this.#options = options;
    this.#documentMode = options.documentMode ?? 'editing';
    this.#visibleHost = options.element;
    this.#visibleHost.innerHTML = '';
    this.#visibleHost.classList.add('presentation-editor');
    this.#syncDocumentModeClass();
    if (!this.#visibleHost.hasAttribute('tabindex')) {
      this.#visibleHost.tabIndex = 0;
    }
    const viewForPosition = this.#visibleHost.ownerDocument?.defaultView ?? window;
    if (viewForPosition.getComputedStyle(this.#visibleHost).position === 'static') {
      this.#visibleHost.style.position = 'relative';
    }
    const doc = this.#visibleHost.ownerDocument ?? document;

    // Validate and normalize presence options
    const rawPresence = options.layoutEngineOptions?.presence;
    const validatedPresence = rawPresence
      ? {
          ...rawPresence,
          // Clamp maxVisible to reasonable range [1, 100]
          maxVisible:
            rawPresence.maxVisible !== undefined
              ? Math.max(1, Math.min(rawPresence.maxVisible, 100))
              : rawPresence.maxVisible,
          // Clamp highlightOpacity to [0, 1]
          highlightOpacity:
            rawPresence.highlightOpacity !== undefined
              ? Math.max(0, Math.min(rawPresence.highlightOpacity, 1))
              : rawPresence.highlightOpacity,
        }
      : undefined;

    const requestedFlowMode = options.layoutEngineOptions?.flowMode === 'semantic' ? 'semantic' : 'paginated';
    const requestedLayoutMode = options.layoutEngineOptions?.layoutMode ?? 'vertical';
    this.#configuredDocumentBackground = this.#coerceDocumentBackground(
      options.layoutEngineOptions?.documentBackground,
    );
    this.#layoutOptions = {
      pageSize: options.layoutEngineOptions?.pageSize ?? DEFAULT_PAGE_SIZE,
      margins: options.layoutEngineOptions?.margins ?? DEFAULT_MARGINS,
      virtualization:
        requestedFlowMode === 'semantic'
          ? {
              ...(options.layoutEngineOptions?.virtualization ?? {}),
              enabled: false,
            }
          : options.layoutEngineOptions?.virtualization,
      zoom: options.layoutEngineOptions?.zoom ?? 1,
      ...(this.#configuredDocumentBackground ? { documentBackground: this.#configuredDocumentBackground } : {}),
      pageStyles: options.layoutEngineOptions?.pageStyles,
      debugLabel: options.layoutEngineOptions?.debugLabel,
      layoutMode: requestedFlowMode === 'semantic' ? 'vertical' : requestedLayoutMode,
      flowMode: requestedFlowMode,
      semanticOptions: options.layoutEngineOptions?.semanticOptions,
      trackedChanges: options.layoutEngineOptions?.trackedChanges,
      resolveTrackedChangeColor: options.layoutEngineOptions?.resolveTrackedChangeColor,
      emitCommentPositionsInViewing: options.layoutEngineOptions?.emitCommentPositionsInViewing,
      enableCommentsInViewing: options.layoutEngineOptions?.enableCommentsInViewing,
      presence: validatedPresence,
      showBookmarks: options.layoutEngineOptions?.showBookmarks ?? false,
      showFormattingMarks: options.layoutEngineOptions?.showFormattingMarks ?? false,
      contentControlsChrome: options.layoutEngineOptions?.contentControlsChrome,
    };
    this.#trackedChangesOverrides = options.layoutEngineOptions?.trackedChanges;

    this.#viewportHost = doc.createElement('div');
    this.#viewportHost.className = 'presentation-editor__viewport';
    // Hide the viewport from screen readers - it's a visual rendering layer, not semantic content.
    // The hidden ProseMirror editor (in #hiddenHost) provides the actual accessible document structure.
    // This prevents screen readers from encountering duplicate or non-semantic visual elements.
    this.#viewportHost.setAttribute('aria-hidden', 'true');
    this.#viewportHost.style.position = 'relative';
    this.#viewportHost.style.isolation = 'isolate';
    this.#viewportHost.style.width = '100%';
    // Set min-height to at least one page so the viewport is clickable before layout renders
    const pageHeight = this.#layoutOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h;
    this.#viewportHost.style.minHeight = `${pageHeight}px`;
    this.#visibleHost.appendChild(this.#viewportHost);

    this.#painterHost = doc.createElement('div');
    this.#painterHost.className = 'presentation-editor__pages';
    this.#painterHost.style.transformOrigin = 'top left';
    this.#viewportHost.appendChild(this.#painterHost);
    this.#postPaintPipeline.setContainer(this.#painterHost);

    // Inject editor-owned styles (idempotent, once per document)
    ensureEditorNativeSelectionStyles(doc);
    ensureEditorFieldAnnotationInteractionStyles(doc);
    ensureEditorMovableObjectInteractionStyles(doc);

    // Hover coordination — structured-content blocks and TOC entries each
    // group their fragments by id so the whole control greys out together.
    this.#initializeHoverCoordinators();
    this.#painterHost.addEventListener('mouseover', this.#sdtHoverCoordinator!.handleMouseEnter);
    this.#painterHost.addEventListener('mouseout', this.#sdtHoverCoordinator!.handleMouseLeave);
    this.#painterHost.addEventListener('mouseover', this.#tocHoverCoordinator!.handleMouseEnter);
    this.#painterHost.addEventListener('mouseout', this.#tocHoverCoordinator!.handleMouseLeave);

    const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
    this.#domIndexObserverManager = new DomPositionIndexObserverManager({
      windowRoot: win,
      getPainterHost: () => this.#painterHost,
      onRebuild: () => {
        this.#refreshEditorDomAugmentations();
        this.#selectionSync.requestRender({ immediate: true });
      },
    });
    this.#domIndexObserverManager.setup();
    this.#selectionSync.on('render', () => this.#updateSelection());
    this.#selectionSync.on('render', () => this.#updatePermissionOverlay());

    this.#permissionOverlay = doc.createElement('div');
    this.#permissionOverlay.className = 'presentation-editor__permission-overlay';
    Object.assign(this.#permissionOverlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
    });
    this.#viewportHost.appendChild(this.#permissionOverlay);

    // Create dual-layer overlay structure
    // Container holds both remote (below) and local (above) layers
    this.#selectionOverlay = doc.createElement('div');
    this.#selectionOverlay.className = 'presentation-editor__selection-overlay';
    this.#selectionOverlay.id = `presentation-overlay-${options.documentId || 'default'}`;
    this.#selectionOverlay.style.position = 'absolute';
    this.#selectionOverlay.style.inset = '0';
    this.#selectionOverlay.style.pointerEvents = 'none';
    this.#selectionOverlay.style.zIndex = '10';

    // Create remote layer (renders below local)
    this.#remoteCursorOverlay = doc.createElement('div');
    this.#remoteCursorOverlay.className = 'presentation-editor__selection-layer--remote';
    this.#remoteCursorOverlay.style.position = 'absolute';
    this.#remoteCursorOverlay.style.inset = '0';
    this.#remoteCursorOverlay.style.pointerEvents = 'none';

    // Create local layer (renders above remote)
    this.#localSelectionLayer = doc.createElement('div');
    this.#localSelectionLayer.className = 'presentation-editor__selection-layer--local';
    this.#localSelectionLayer.style.position = 'absolute';
    this.#localSelectionLayer.style.inset = '0';
    this.#localSelectionLayer.style.pointerEvents = 'none';

    // Append layers in correct z-index order (remote first, local second)
    this.#selectionOverlay.appendChild(this.#remoteCursorOverlay);
    this.#selectionOverlay.appendChild(this.#localSelectionLayer);
    this.#viewportHost.appendChild(this.#selectionOverlay);

    // Initialize remote cursor manager. The cast widens the shared
    // CollaborationProvider to the manager's internal CollaborationProviderLike
    // shape, which asserts `awareness.setLocalStateField` exists. Runtime
    // collaboration providers (HocuspocusProvider, y-websocket, etc.) expose
    // it; the assertion documents the requirement at the boundary.
    this.#remoteCursorManager = new RemoteCursorManager({
      visibleHost: this.#visibleHost,
      remoteCursorOverlay: this.#remoteCursorOverlay,
      presence: validatedPresence,
      collaborationProvider: options.collaborationProvider as
        | { awareness?: AwarenessWithSetField | null; disconnect?: () => void }
        | undefined,
      fallbackColors: PresentationEditor.FALLBACK_COLORS,
      cursorStyles: PresentationEditor.CURSOR_STYLES,
      maxSelectionRectsPerUser: MAX_SELECTION_RECTS_PER_USER,
      defaultPageHeight: DEFAULT_PAGE_SIZE.h,
    });

    // Wire up manager callbacks to use PresentationEditor methods
    this.#remoteCursorManager.setUpdateCallback(() => this.#updateRemoteCursors());

    this.#hoverOverlay = doc.createElement('div');
    this.#hoverOverlay.className = 'presentation-editor__hover-overlay';
    Object.assign(this.#hoverOverlay.style, {
      position: 'absolute',
      border: '1px dashed rgba(51, 102, 255, 0.8)',
      borderRadius: '2px',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '11',
    });
    this.#selectionOverlay.appendChild(this.#hoverOverlay);

    this.#hoverTooltip = doc.createElement('div');
    this.#hoverTooltip.className = 'presentation-editor__hover-tooltip';
    Object.assign(this.#hoverTooltip.style, {
      position: 'absolute',
      background: 'rgba(18, 22, 33, 0.85)',
      color: '#fff',
      padding: '2px 6px',
      fontSize: '12px',
      borderRadius: '2px',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '12',
      whiteSpace: 'nowrap',
    });
    this.#selectionOverlay.appendChild(this.#hoverTooltip);

    this.#modeBanner = doc.createElement('div');
    this.#modeBanner.className = 'presentation-editor__mode-banner';
    Object.assign(this.#modeBanner.style, {
      position: 'absolute',
      top: '0',
      left: '50%',
      transform: 'translate(-50%, -100%)',
      background: '#1b3fbf',
      color: '#fff',
      padding: '4px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      display: 'none',
      zIndex: '15',
    });
    this.#visibleHost.appendChild(this.#modeBanner);

    // Initialize header/footer session manager
    this.#headerFooterSession = new HeaderFooterSessionManager({
      painterHost: this.#painterHost,
      visibleHost: this.#visibleHost,
      selectionOverlay: this.#selectionOverlay,
      editor: null as unknown as Editor, // Set after editor is created
      isDebug: this.#options.isDebug,
      initBudgetMs: HEADER_FOOTER_INIT_BUDGET_MS,
      defaultPageSize: DEFAULT_PAGE_SIZE,
      defaultMargins: DEFAULT_MARGINS,
      getFontSignature: () => this.#layoutFontSignature,
    });
    this.#headerFooterSession.setHoverElements({
      hoverOverlay: this.#hoverOverlay,
      hoverTooltip: this.#hoverTooltip,
      modeBanner: this.#modeBanner,
    });
    this.#headerFooterSession.setDocumentMode(this.#documentMode);
    this.#headerFooterSession.setTrackedChangesRenderConfig({
      mode: this.#trackedChangesMode,
      enabled: this.#trackedChangesEnabled,
    });

    this.#ariaLiveRegion = doc.createElement('div');
    this.#ariaLiveRegion.className = 'presentation-editor__aria-live';
    this.#ariaLiveRegion.setAttribute('role', 'status');
    this.#ariaLiveRegion.setAttribute('aria-live', 'polite');
    this.#ariaLiveRegion.setAttribute('aria-atomic', 'true');
    Object.assign(this.#ariaLiveRegion.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(1px, 1px, 1px, 1px)',
    });
    this.#visibleHost.appendChild(this.#ariaLiveRegion);

    const { wrapper: hiddenHostWrapper, host: hiddenHost } = createHiddenHost(
      doc,
      this.#layoutOptions.pageSize?.w ?? DEFAULT_PAGE_SIZE.w,
    );
    this.#hiddenHostWrapper = hiddenHostWrapper;
    this.#hiddenHost = hiddenHost;
    this.#ownedHiddenHosts.add(hiddenHost);
    if (doc.body) {
      doc.body.appendChild(this.#hiddenHostWrapper);
    } else {
      this.#visibleHost.appendChild(this.#hiddenHostWrapper);
    }

    const { layoutEngineOptions: _layoutEngineOptions, element: _element, ...editorOptions } = options;
    const normalizedEditorProps = {
      ...(editorOptions.editorProps ?? {}),
      editable: () => {
        // Hidden editor respects documentMode for plugin compatibility,
        // but permission ranges may temporarily re-enable editing.
        return !this.#isViewLocked();
      },
    };
    try {
      this.#editor = new Editor({
        ...(editorOptions as ConstructorParameters<typeof Editor>[0]),
        element: this.#hiddenHost,
        editorProps: normalizedEditorProps,
        documentMode: this.#documentMode,
      });
      this.#wrapOffscreenEditorFocus(this.#editor);
      // Set bidirectional reference for renderer-neutral helpers
      // Type assertion is safe here as we control both Editor and PresentationEditor
      (this.#editor as Editor & { presentationEditor?: PresentationEditor | null }).presentationEditor = this;
      // Add reference back to PresentationEditor for event handler detection
      (this.#editor as Editor & { _presentationEditor?: PresentationEditor })._presentationEditor = this;
      this.#syncHiddenEditorA11yAttributes();
      this.#fontGate = new FontReadinessGate({
        getDocumentFonts: () => {
          const converter = (this.#editor as Editor & { converter?: { getDocumentFonts?: () => string[] } }).converter;
          return converter?.getDocumentFonts?.() ?? [];
        },
        // Reflow so unchanged blocks re-measure (see #requestFontReflow). The gate calls this for
        // a late font load AND for a document font config change from the controller.
        requestReflow: () => this.#requestFontReflow(),
        // Face-aware required set: the exact physical faces (family + weight + style) the
        // rendered document uses, from the planner walking the current layout blocks. The
        // gate awaits these - so bold/italic load before measure and declared-but-unused
        // fonts are not fetched. Reads the blocks stashed just before each gate await.
        // Consume the stored render plan (built each render just before this gate runs) so the gate
        // never recomputes independently: load awaits its requiredFaces, the report uses its usedFaces.
        getRequiredFaces: () => this.#fontPlan?.requiredFaces ?? [],
        getUsedFaces: () => this.#fontPlan?.usedFaces ?? [],
        // The document's resolver: the gate derives the family-path resolution from it and
        // resolves its report through it (load + diagnostics). The document's measure and
        // content-paint paths resolve through this same instance, so load, measure, paint, and
        // diagnostics stay consistent.
        fontResolver: this.#fontResolver,
        // Register the bundled fallback pack into the document's registry the first time it resolves -
        // but ONLY when the pack is actually configured (a base URL / resolver, or a page-global pack).
        // Baseline (no config) must NOT register substitute faces: that would map e.g. Calibri to a
        // now-nonexistent default `/fonts/` URL and, via first-config-wins on the shared per-document
        // registry, block a later configured instance on the same page from registering correctly.
        onRegistryResolved: (registry) => {
          if (!deriveBundledActivation(this.#options.fontAssets).packConfigured) return;
          installBundledSubstitutes(registry, {
            assetBaseUrl: this.#options.fontAssets?.assetBaseUrl,
            resolveAssetUrl: this.#options.fontAssets?.resolveAssetUrl,
          });
        },
        getFontEnvironment: () => {
          // Bind the registry and the watched font set to THIS editor's document, so an
          // editor inside an iframe awaits and listens on the same FontFaceSet.
          const ownerDoc = this.#visibleHost?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
          const view = ownerDoc?.defaultView ?? (typeof window !== 'undefined' ? window : null);
          const fontSet = ownerDoc?.fonts ?? null;
          const FontFaceCtor = view?.FontFace ?? (typeof FontFace !== 'undefined' ? FontFace : null);
          return fontSet && FontFaceCtor ? { fontSet, FontFaceCtor } : null;
        },
      });
      this.#fontController.applyInitialConfig(this.#options.fontAssets);
      this.#applyEmbeddedDocumentFonts();
      if (typeof this.#options.disableContextMenu === 'boolean') {
        this.setContextMenuDisabled(this.#options.disableContextMenu);
      }

      this.#setupHeaderFooterSession();
      this.#setupStorySessionManager();
      this.#setupUnifiedHistoryCoordinator();
      this.#applyZoom();
      this.#setupEditorListeners();
      this.#initializeEditorInputManager();
      this.#setupPointerHandlers();
      this.#setupDragHandlers();
      this.#setupInputBridge();
      this.#setupCompositionDeferral();
      this.#refreshCompositionDeferralTarget();
      this.#syncTrackedChangesPreferences();
      this.#syncHeaderFooterTrackedChangesRenderConfig();
      this.#setupSemanticResizeObserver();
      this.#initializeProofing();

      // Register this instance in the static registry.
      // Use a separate field to avoid mutating the caller's options object and to keep
      // the registry key consistent with the overlay ID set earlier (line ~453).
      this.#registryKey = options.documentId || `__anonymous_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      PresentationEditor.#instances.set(this.#registryKey, this);

      this.#pendingDocChange = true;
      this.#scheduleRerender();

      // Check if collaboration is already ready and setup cursors immediately
      // Handles race condition where collaborationReady fires before event listener is attached
      if (this.#options.collaborationProvider?.awareness) {
        const ystate = ySyncPluginKey.getState(this.#editor.state);
        if (ystate && this.#layoutOptions.presence?.enabled !== false) {
          this.#setupCollaborationCursors();
        }
      }
    } catch (error) {
      // Ensure cleanup on initialization failure
      this.destroy();
      throw error;
    }
  }

  /**
   * Wraps an off-screen editor's focus method to preserve selection and avoid scroll jumps.
   *
   * PresentationEditor keeps the body editor and hidden-host story-session editors
   * mounted off-screen. These editors must stay focusable for accessibility and
   * input routing, but a raw focus call can do two harmful things:
   *
   * 1. Scroll the page toward the off-screen contenteditable.
   * 2. Let the browser's stale DOM selection overwrite the ProseMirror selection
   *    before the active story has a chance to re-apply its real caret position.
   *
   * This wrapper installs the same focus contract on any off-screen editor we own:
   * focus without scrolling, suppress transient selectionchange drift, then let
   * ProseMirror re-synchronize its DOM selection.
   *
   * @remarks
   * **Why this exists:**
   * - Hidden editors provide semantic document structure for screen readers
   * - They must be focusable, but are positioned off-screen with `left: -9999px`
   * - Some browsers scroll to bring focused elements into view, breaking the user experience
   * - Story sessions can temporarily lose native focus to the body editor or a UI surface
   * - Restoring focus must preserve the active story selection, not restart at position 1
   *
   * **Focus strategies (in order):**
   * 1. Try `view.dom.focus({ preventScroll: true })` - the standard approach
   * 2. If that fails, try `view.dom.focus()` without options and restore scroll position
   * 3. Always run the original ProseMirror focus logic so `selectionToDOM()` replays
   * 4. Restore scroll position if any focus attempt changed it
   *
   * **Idempotency:**
   * - Safe to call multiple times - checks `__sdPreventScrollFocus` flag to avoid re-wrapping
   * - The flag is set on the view object after first successful wrap
   *
   * **Test awareness:**
   * - Skips wrapping if the focus function has a `mock` property (Vitest/Jest mocks)
   * - Prevents interference with test assertions and mock function tracking
   */
  #warnUnsupportedNumberingRestart(kind: 'footnote' | 'endnote'): void {
    if (this.#warnedUnsupportedRestart[kind]) return;
    this.#warnedUnsupportedRestart[kind] = true;
    console.warn(
      `[PresentationEditor] ${kind} numRestart="eachPage" is not yet supported (requires a two-pass pagination handshake). Falling back to "continuous". Tracked for follow-up.`,
    );
  }

  #wrapOffscreenEditorFocus(editor: Editor | null | undefined): void {
    const view = editor?.view;
    if (!view || !view.dom || typeof view.focus !== 'function') {
      return;
    }

    // Check if we've already wrapped this view's focus method (idempotency)
    const viewWithFlag = view as typeof view & EditorViewWithScrollFlag;
    if (viewWithFlag.__sdPreventScrollFocus) {
      return;
    }

    // Skip wrapping mocked functions in test environments
    const focusFn = view.focus as typeof view.focus & PotentiallyMockedFunction;
    if (focusFn.mock) {
      return;
    }

    // Mark this view as wrapped to prevent re-wrapping
    viewWithFlag.__sdPreventScrollFocus = true;

    // Save the original focus method
    const originalFocus = view.focus.bind(view);

    // Replace with our scroll-preventing wrapper
    view.focus = () => {
      // Get window context from the visible host's document
      // Do NOT fall back to global window - if there's no document context, we can't
      // reliably prevent scroll, so just call originalFocus and let it handle focus
      const win = this.#visibleHost.ownerDocument?.defaultView;
      if (!win) {
        originalFocus();
        return;
      }

      const beforeX = win.scrollX;
      const beforeY = win.scrollY;
      const alreadyFocused = view.hasFocus();

      if (!alreadyFocused) {
        // When focus jumps back into an off-screen editor, browsers can emit a
        // transient DOM selection at the document start before ProseMirror has
        // re-applied the current PM selection. Suppress that drift first.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (view as any).domObserver.suppressSelectionUpdates();
      }

      let domFocused = false;

      // Strategy 1: Try focus with preventScroll option (modern browsers)
      try {
        view.dom.focus({ preventScroll: true });
        domFocused = true;
      } catch (error) {
        debugLog('warn', 'Off-screen editor focus: preventScroll failed', {
          error: String(error),
          strategy: 'preventScroll',
        });
      }

      // Strategy 2: Fall back to focus without options
      if (!domFocused) {
        try {
          view.dom.focus();
          domFocused = true;
        } catch (error) {
          debugLog('warn', 'Off-screen editor focus: standard focus failed', {
            error: String(error),
            strategy: 'standard',
          });
        }
      }

      // Always let ProseMirror replay its own focus logic after the native DOM
      // focus step. This is what writes the current PM selection back into the
      // hidden contenteditable, which is critical for story-session carets.
      try {
        originalFocus();
      } catch (error) {
        if (!domFocused) {
          debugLog('error', 'Off-screen editor focus: all strategies failed', {
            error: String(error),
            strategy: 'original',
          });
        } else {
          debugLog('warn', 'Off-screen editor focus: ProseMirror selection sync failed', {
            error: String(error),
            strategy: 'original',
          });
        }
      }

      // Restore scroll position if any focus attempt changed it
      if (win.scrollX !== beforeX || win.scrollY !== beforeY) {
        win.scrollTo(beforeX, beforeY);
      }

      // Safety net: the browser may asynchronously scroll after ProseMirror's
      // selectionToDOM() modifies the DOM selection inside the hidden editor.
      // A single requestAnimationFrame catches this post-layout scroll.
      // The RAF ID is stored so scrollToPosition() can cancel it — otherwise
      // intentional scrolls (e.g. search navigation) would be undone.
      if (this.#focusScrollRafId != null) {
        win.cancelAnimationFrame(this.#focusScrollRafId);
      }
      this.#focusScrollRafId = win.requestAnimationFrame(() => {
        this.#focusScrollRafId = null;
        if (win.scrollX !== beforeX || win.scrollY !== beforeY) {
          win.scrollTo(beforeX, beforeY);
        }
      });
    };
  }

  /**
   * Accessor for the underlying Editor so SuperDoc can reuse existing APIs.
   */
  get editor(): Editor {
    return this.#editor;
  }

  /**
   * Late-attach collaboration to the presentation editor.
   *
   * Updates the provider reference on this instance and RemoteCursorManager,
   * then delegates to the backing Editor. The existing `collaborationReady`
   * listener (wired in #setupEditorListeners) triggers cursor setup
   * automatically when the backing editor emits the event.
   *
   * @param options.ydoc  The Y.Doc already seeded with this editor's state
   * @param options.collaborationProvider  The synced collaboration provider
   */
  attachCollaboration({
    ydoc,
    collaborationProvider,
  }: {
    ydoc: Y.Doc;
    collaborationProvider: NonNullable<PresentationEditorOptions['collaborationProvider']>;
  }): void {
    const prevProvider = this.#options.collaborationProvider;

    // 1. Update PresentationEditor options so the collaborationReady handler
    //    check passes (it reads this.#options.collaborationProvider?.awareness).
    this.#options.collaborationProvider = collaborationProvider;

    // 2. Update RemoteCursorManager's provider reference so setup() reads
    //    the correct provider when collaborationReady fires. The cast
    //    matches the boundary assertion in the constructor: collaboration
    //    providers expose `awareness.setLocalStateField` at runtime.
    this.#remoteCursorManager?.setCollaborationProvider(
      collaborationProvider as { awareness?: AwarenessWithSetField | null; disconnect?: () => void },
    );

    // 3. Delegate to the backing Editor — triggers plugin reconfigure + Y.js observers.
    //    The collaborationReady event fires asynchronously (setTimeout in initSyncListener).
    //    The existing listener at handleCollaborationReady calls
    //    #setupCollaborationCursors() → remoteCursorManager.setup(). No new wiring needed.
    try {
      this.#editor.attachCollaboration({ ydoc, collaborationProvider });
    } catch (err) {
      // Editor attach failed and rolled back its own state. Restore ours too.
      this.#options.collaborationProvider = prevProvider;
      this.#remoteCursorManager?.setCollaborationProvider(
        (prevProvider ?? null) as { awareness?: AwarenessWithSetField | null; disconnect?: () => void } | null,
      );
      throw err;
    }
  }

  /**
   * Expose the visible host element for renderer-agnostic consumers.
   */
  get element(): HTMLElement {
    return this.#visibleHost;
  }

  /** Access the proofing session manager (for context menu and action integration). */
  get proofingManager(): ProofingSessionManager | null {
    return this.#proofingManager;
  }

  /** Update proofing configuration at runtime. */
  updateProofingConfig(patch: Partial<ProofingConfig>): void {
    if (!this.#proofingManager) {
      // Initialize proofing if not yet created and patch enables it
      if (patch.enabled && patch.provider) {
        this.#proofingManager = new ProofingSessionManager({
          ...patch,
          enabled: true,
        } as ProofingConfig);
        this.#wireProofingManagerAdapters();
        if (this.#editor?.state?.doc) {
          this.#proofingManager.runInitialCheck(this.#editor.state.doc);
        }
      }
      return;
    }
    // updateConfig fires onResultsChanged internally for state changes
    // that need a repaint (disable, ignoredWords). For config changes that
    // don't fire onResultsChanged (e.g. UI flags), an explicit pass is safe.
    this.#proofingManager.updateConfig(patch, this.#editor?.state?.doc);
    this.#applyProofingPass();
  }

  /**
   * Get the commands interface for the currently active editor (header/footer-aware).
   *
   * This property dynamically routes command execution to the appropriate editor instance:
   * - In body mode, returns the main editor's commands
   * - In header/footer mode, returns the active header/footer editor's commands
   *
   * This ensures that formatting commands (bold, italic, etc.) and other operations
   * execute in the correct editing context.
   *
   * @returns The CommandService instance for the active editor
   *
   * @example
   * ```typescript
   * // This will bold text in the active editor (body or header/footer)
   * presentationEditor.commands.bold();
   * ```
   */
  get commands() {
    const activeEditor = this.getActiveEditor();
    return activeEditor.commands;
  }

  /**
   * Get the ProseMirror editor state for the currently active editor (header/footer-aware).
   *
   * This property dynamically returns the state from the appropriate editor instance:
   * - In body mode, returns the main editor's state
   * - In header/footer mode, returns the active header/footer editor's state
   *
   * This enables components like ContextMenu to access document
   * state, selection, and schema information in the correct editing context.
   *
   * @returns The EditorState for the active editor
   *
   * @example
   * ```typescript
   * const { selection, doc } = presentationEditor.state;
   * const selectedText = doc.textBetween(selection.from, selection.to);
   * ```
   */
  get state(): EditorState {
    return this.getActiveEditor().state;
  }

  /**
   * Check if the editor is currently editable (header/footer-aware).
   *
   * This property checks the editable state of the currently active editor:
   * - In body mode, returns whether the main editor is editable
   * - In header/footer mode, returns whether the header/footer editor is editable
   *
   * The editor may be non-editable due to:
   * - Document mode set to 'viewing'
   * - Explicit `editable: false` option
   * - Editor not fully initialized
   *
   * @returns true if the active editor accepts input, false otherwise
   *
   * @example
   * ```typescript
   * if (presentationEditor.isEditable) {
   *   presentationEditor.commands.insertText('Hello');
   * }
   * ```
   */
  get isEditable(): boolean {
    return this.getActiveEditor().isEditable;
  }

  /**
   * Get the editor options for the currently active editor (header/footer-aware).
   *
   * This property returns the options object from the appropriate editor instance,
   * providing access to configuration like document mode, AI settings, and custom
   * context menu configuration.
   *
   * @returns The options object for the active editor
   *
   * @example
   * ```typescript
   * const { documentMode, isAiEnabled } = presentationEditor.options;
   * ```
   */
  get options() {
    return this.getActiveEditor().options;
  }

  /**
   * Dispatch a ProseMirror transaction to the currently active editor (header/footer-aware).
   *
   * This method routes transactions to the appropriate editor instance:
   * - In body mode, dispatches to the main editor
   * - In header/footer mode, dispatches to the active header/footer editor
   *
   * Use this for direct state manipulation when commands are insufficient.
   * For most use cases, prefer using `commands` or `dispatchInActiveEditor`.
   *
   * @param tr - The ProseMirror transaction to dispatch
   *
   * @example
   * ```typescript
   * const { state } = presentationEditor;
   * const tr = state.tr.insertText('Hello', state.selection.from);
   * presentationEditor.dispatch(tr);
   * ```
   */
  dispatch(tr: Transaction): void {
    const activeEditor = this.getActiveEditor();
    activeEditor.view?.dispatch(tr);
  }

  /**
   * Focus the editor, routing focus to the appropriate editing surface.
   *
   * In PresentationEditor, the actual ProseMirror EditorView is hidden and input
   * is bridged from the visible layout surface. This method focuses the hidden
   * editor view to enable keyboard input while the visual focus remains on the
   * rendered presentation.
   *
   * @example
   * ```typescript
   * // After closing a modal, restore focus to the editor
   * presentationEditor.focus();
   * ```
   */
  focus(): void {
    const activeEditor = this.getActiveEditor();
    activeEditor.view?.focus();
  }

  /**
   * Returns the currently active editor (body or header/footer session).
   *
   * When editing headers or footers, this returns the header/footer editor instance.
   * Otherwise, returns the main document body editor.
   *
   * @returns The active Editor instance
   *
   * @example
   * ```typescript
   * const editor = presentation.getActiveEditor();
   * const selection = editor.state.selection;
   * ```
   */
  getActiveEditor(): Editor {
    // An active story session (header/footer in hidden-host mode, or a note
    // session) always owns the editable surface.
    const storySession = this.#storySessionManager?.getActiveSession();
    if (storySession) return storySession.editor;

    const session = this.#headerFooterSession?.session;
    const activeHfEditor = this.#headerFooterSession?.activeEditor;
    if (!session || session.mode === 'body' || !activeHfEditor) {
      return this.#editor;
    }
    return activeHfEditor;
  }

  #getActiveStorySession(): StoryPresentationSession | null {
    return this.#storySessionManager?.getActiveSession() ?? null;
  }

  #getActiveNoteStorySession(): NoteStorySession | null {
    const session = this.#getActiveStorySession();
    if (!session || session.kind !== 'note') {
      return null;
    }
    if (session.locator.storyType !== 'footnote' && session.locator.storyType !== 'endnote') {
      return null;
    }
    return session as NoteStorySession;
  }

  #buildActiveNoteRenderOverride(storyType: 'footnote' | 'endnote'): NoteRenderOverride | null {
    const session = this.#getActiveNoteStorySession();
    if (!session || session.locator.storyType !== storyType) {
      return null;
    }

    const storyEditor = session.editor as Editor & {
      getJSON?: () => ProseMirrorJSON;
      getUpdatedJson?: () => ProseMirrorJSON;
    };
    const docJson =
      typeof storyEditor.getUpdatedJson === 'function'
        ? storyEditor.getUpdatedJson()
        : typeof storyEditor.getJSON === 'function'
          ? storyEditor.getJSON()
          : null;

    if (!docJson || typeof docJson !== 'object') {
      return null;
    }

    return {
      noteId: session.locator.noteId,
      docJson,
    };
  }

  #getActiveTrackedChangeStorySurface(): { storyKey: string; editor: Editor } | null {
    const storySession = this.#getActiveStorySession();
    if (storySession) {
      return {
        storyKey: buildStoryKey(storySession.locator),
        editor: storySession.editor,
      };
    }

    const headerFooterSession = this.#headerFooterSession?.session;
    const activeHeaderFooterEditor = this.#headerFooterSession?.activeEditor;
    const headerFooterRefId =
      headerFooterSession && headerFooterSession.mode !== 'body' ? headerFooterSession.headerFooterRefId : null;

    if (!headerFooterRefId || !activeHeaderFooterEditor) {
      return null;
    }

    return {
      storyKey: buildStoryKey({
        kind: 'story',
        storyType: 'headerFooterPart',
        refId: headerFooterRefId,
      }),
      editor: activeHeaderFooterEditor,
    };
  }

  /**
   * Access the generic story-session manager.
   *
   * PresentationEditor uses one story-session model for all story-backed
   * surfaces. This getter exists so tests and other editor-internal helpers
   * can inspect the active session.
   */
  getStorySessionManager(): StoryPresentationSessionManager | null {
    return this.#storySessionManager;
  }

  /**
   * The {@link StoryLocator} for the currently routed editor, or `null`
   * when the body editor is active. Notes (footnote/endnote) flow
   * through the generic story-session manager; headers/footers flow
   * through the legacy header-footer session. Both are unified here so
   * external surfaces (selection / positionAt) can thread the locator
   * onto a {@link SelectionTarget} without reaching into private state.
   */
  getActiveStoryLocator(): StoryLocator | null {
    const storySession = this.#storySessionManager?.getActiveSession();
    if (storySession) return storySession.locator;

    const session = this.#headerFooterSession?.session;
    if (!session || session.mode === 'body' || !session.headerFooterRefId) return null;
    return {
      kind: 'story',
      storyType: 'headerFooterPart',
      refId: session.headerFooterRefId,
    };
  }

  /**
   * Exit any active non-body editing surface and restore the body editor.
   *
   * This gives tests and editor-integrated helpers a single public entry point
   * that does not need to know whether the current surface is managed by the
   * generic story-session bridge, the header/footer session manager, or both.
   */
  exitActiveStorySurface(): void {
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionMode !== 'body') {
      this.#exitHeaderFooterMode();
    }

    if (this.#getActiveStorySession()) {
      this.#exitActiveStorySession();
    }
  }

  // -------------------------------------------------------------------
  // Selection bridge — tracked handles + snapshot convenience
  // -------------------------------------------------------------------

  /**
   * Inspects the active session state to determine which editing surface is
   * in focus. Header/footer sessions win over note sessions when both are
   * somehow active (shouldn't happen in practice, but the priority keeps
   * the behavior deterministic).
   */
  #resolveActiveSurface(): DocumentHistorySurface {
    const mode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (mode === 'header') return 'header';
    if (mode === 'footer') return 'footer';

    const storySession = this.#storySessionManager?.getActiveSession();
    const locator = storySession?.locator;
    if (locator?.storyType === 'footnote') return 'note';
    if (locator?.storyType === 'endnote') return 'endnote';

    return 'body';
  }

  // --- Tracked handle API ---

  /**
   * Capture the live PM selection on the active editor as a tracked handle.
   *
   * The handle is bound to the specific editor that captured it (not just
   * the surface label), so it remains valid even if the active header/footer
   * session changes later.
   */
  captureCurrentSelectionHandle(): SelectionHandle {
    const surface = this.#resolveSelectionHandleSurface();
    return this.getActiveEditor().captureCurrentSelectionHandle(surface);
  }

  /**
   * Capture the "effective" selection on the active editor as a tracked handle.
   * Uses the same fallback chain: live non-collapsed → preserved → live.
   */
  captureEffectiveSelectionHandle(): SelectionHandle {
    const surface = this.#resolveSelectionHandleSurface();
    return this.getActiveEditor().captureEffectiveSelectionHandle(surface);
  }

  /**
   * Narrow the document-history surface to the triple `body | header | footer`
   * the selection handle API supports. Note/endnote sessions have their own
   * editor, so selection bookmarks captured while a note is active still
   * resolve correctly when surface is reported as 'body'.
   */
  #resolveSelectionHandleSurface(): 'body' | 'header' | 'footer' {
    const surface = this.#resolveActiveSurface();
    return surface === 'header' || surface === 'footer' ? surface : 'body';
  }

  /**
   * Resolve a previously captured handle into a `SelectionCommandContext`.
   *
   * The handle carries a reference to the editor that captured it, so
   * resolution always reads from the correct editor's plugin state —
   * even if the active header/footer session has changed since capture.
   *
   * Returns `null` when:
   * - the handle was released
   * - a previously non-empty selection collapsed (content was deleted)
   */
  resolveSelectionHandle(handle: SelectionHandle): SelectionCommandContext | null {
    // The handle's _owner is the Editor that captured it. We use it to
    // resolve the range, but we need the Editor type for the context.
    // Since _owner satisfies SelectionHandleOwner (which Editor implements),
    // and capture always passes `this` (an Editor), this cast is safe.
    const ownerEditor = handle._owner as Editor;
    const range = ownerEditor.resolveSelectionHandle(handle);
    if (!range) return null;
    return { editor: ownerEditor, doc: ownerEditor.doc, surface: handle.surface, range };
  }

  /**
   * Release a tracked selection handle.
   *
   * Routes to the owning editor regardless of the current active surface.
   */
  releaseSelectionHandle(handle: SelectionHandle): void {
    (handle._owner as Editor).releaseSelectionHandle(handle);
  }

  // --- Snapshot convenience API ---

  /**
   * Snapshot convenience: resolve the live PM selection on the active editor
   * into a canonical Document API range immediately.
   */
  getCurrentSelectionRange(): ResolveRangeOutput {
    return this.getActiveEditor().getCurrentSelectionRange();
  }

  /**
   * Snapshot convenience: resolve the "effective" selection on the active
   * editor into a canonical Document API range immediately.
   */
  getEffectiveSelectionRange(): ResolveRangeOutput {
    return this.getActiveEditor().getEffectiveSelectionRange();
  }

  /**
   * Snapshot convenience: returns the current live selection plus the active
   * editing context. Guarantees `doc` and `range` refer to the same surface.
   */
  getCurrentSelectionContext(): SelectionCommandContext {
    const activeEditor = this.getActiveEditor();
    return {
      editor: activeEditor,
      doc: activeEditor.doc,
      surface: this.#resolveSelectionHandleSurface(),
      range: activeEditor.getCurrentSelectionRange(),
    };
  }

  /**
   * Snapshot convenience: returns the effective selection plus the active
   * editing context. The canonical layout-mode command surface.
   *
   * @example
   * ```ts
   * const ctx = presentationEditor.getEffectiveSelectionContext();
   * ctx.doc.replace({
   *   target: ctx.range.target,
   *   text: 'New content',
   * });
   * ```
   */
  getEffectiveSelectionContext(): SelectionCommandContext {
    const activeEditor = this.getActiveEditor();
    return {
      editor: activeEditor,
      doc: activeEditor.doc,
      surface: this.#resolveSelectionHandleSurface(),
      range: activeEditor.getEffectiveSelectionRange(),
    };
  }

  /**
   * Returns true when the given editor reports a replayable undo/redo step
   * in its local history. Used by the legacy (non-coordinator) routing path
   * as the kill-switch fallback.
   */
  #canRunEditorHistoryCommand(editor: Editor | null, command: 'undo' | 'redo'): boolean {
    if (!editor) return false;
    try {
      return Boolean(
        command === 'undo'
          ? runEditorUndo(editor, { allowDispatch: false })
          : runEditorRedo(editor, { allowDispatch: false }),
      );
    } catch {
      return false;
    }
  }

  canUndo(): boolean {
    if (this.#historyCoordinator) return this.#historyCoordinator.canUndo();
    return this.#canRunEditorHistoryCommand(this.getActiveEditor(), 'undo');
  }

  canRedo(): boolean {
    if (this.#historyCoordinator) return this.#historyCoordinator.canRedo();
    return this.#canRunEditorHistoryCommand(this.getActiveEditor(), 'redo');
  }

  /**
   * Undo the last action.
   *
   * When unified history is enabled this undoes the most recent edit
   * anywhere in the document (body, header, footer, note, endnote).
   * When the kill-switch has disabled unified history the call falls back
   * to the active editor's own local history — cross-surface undo is
   * intentionally unavailable in that mode.
   */
  undo(): boolean {
    if (this.#historyCoordinator) {
      const result = this.#historyCoordinator.undo();
      this.#debugUnifiedHistory('undo()', {
        mode: 'coordinator',
        result,
        activeSurface: this.#resolveActiveSurface(),
        state: this.#historyCoordinator.getState(),
      });
      return result;
    }
    try {
      const result = Boolean(runEditorUndo(this.getActiveEditor()));
      this.#debugUnifiedHistory('undo()', {
        mode: 'legacy',
        result,
        activeSurface: this.#resolveActiveSurface(),
        state: readEditorHistorySnapshot(this.getActiveEditor()),
      });
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Redo the last undone action. See {@link undo} for routing rules.
   */
  redo(): boolean {
    if (this.#historyCoordinator) {
      const result = this.#historyCoordinator.redo();
      this.#debugUnifiedHistory('redo()', {
        mode: 'coordinator',
        result,
        activeSurface: this.#resolveActiveSurface(),
        state: this.#historyCoordinator.getState(),
      });
      return result;
    }
    try {
      const result = Boolean(runEditorRedo(this.getActiveEditor()));
      this.#debugUnifiedHistory('redo()', {
        mode: 'legacy',
        result,
        activeSurface: this.#resolveActiveSurface(),
        state: readEditorHistorySnapshot(this.getActiveEditor()),
      });
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Snapshot of the document-wide history state. When unified history is
   * disabled this derives state from the active editor so toolbar consumers
   * get a consistent shape regardless of the flag.
   */
  getHistoryState(): DocumentHistoryState {
    if (this.#historyCoordinator) {
      return this.#historyCoordinator.getState();
    }
    const activeEditorSnapshot = readEditorHistorySnapshot(this.getActiveEditor());
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoDepth: activeEditorSnapshot.undoDepth,
      redoDepth: activeEditorSnapshot.redoDepth,
    };
  }

  /**
   * Document-wide history coordinator when the flag is on, otherwise null.
   * Exposed primarily for advanced integrations (tests, document API). Most
   * consumers should use the public `undo`/`redo`/`getHistoryState` surface.
   */
  get historyCoordinator(): DocumentHistoryCoordinator | null {
    return this.#historyCoordinator;
  }

  /**
   * Record a coordinator-level batch step for a structural UI operation
   * that bypasses PM/Yjs history (e.g. blank header/footer slot
   * materialization, link-to-previous retargeting, or a parts-only note
   * mutation). The caller owns the `undo` / `redo` callbacks and must make
   * them safe to run multiple times.
   *
   * No-op when unified history is disabled.
   */
  recordHistoryBatch(batch: BatchHistoryRecord): void {
    this.#historyCoordinator?.withHistoryBatch(batch);
  }

  /**
   * Runs a callback against the active editor (body or header/footer session).
   *
   * Use this method when you need to run commands or access state in the currently
   * active editing context (which may be the body or a header/footer region).
   *
   * @param callback - Function that receives the active editor instance
   *
   * @example
   * ```typescript
   * presentation.dispatchInActiveEditor((editor) => {
   *   editor.commands.insertText('Hello world');
   * });
   * ```
   */
  dispatchInActiveEditor(callback: (editor: Editor) => void) {
    const editor = this.getActiveEditor();
    callback(editor);
  }

  /**
   * Alias for the visible host container so callers can attach listeners explicitly.
   *
   * The painted host element that contains the rendered pages. This is
   * NOT necessarily the scroll container — the scrollable element is
   * often an ancestor. Use {@link scrollContainer} to attach scroll
   * listeners or measure the scroll viewport; use the host to position
   * floating UI relative to the painted content.
   *
   * @returns The visible host HTMLElement
   *
   * @example
   * ```typescript
   * const host = presentation.visibleHost;
   * const rect = host.getBoundingClientRect();
   * ```
   */
  get visibleHost(): HTMLElement {
    return this.#visibleHost;
  }

  /**
   * The resolved scroll container: the nearest ancestor of the visible
   * host with `overflow: auto`/`scroll` (it may be the host itself). It
   * can change after the first layout if a closer scrollable ancestor is
   * detected. Returns `null` when the document/window scrolls instead of
   * a dedicated element — callers should fall back to `window` then.
   *
   * @returns The scroll container element, or `null` when the window scrolls
   */
  get scrollContainer(): HTMLElement | null {
    const container = this.#scrollContainer;
    if (!container || !('ownerDocument' in container)) return null;
    const HTMLElementCtor = container.ownerDocument?.defaultView?.HTMLElement;
    return HTMLElementCtor && container instanceof HTMLElementCtor ? (container as HTMLElement) : null;
  }

  /**
   * Selection overlay element used for caret + highlight rendering.
   *
   * This overlay is positioned absolutely over the rendered pages and contains
   * the visual selection indicators (caret, selection highlights, remote cursors).
   *
   * @returns The selection overlay element, or null if not yet initialized
   *
   * @example
   * ```typescript
   * const overlay = presentation.overlayElement;
   * if (overlay) {
   *   console.log('Overlay dimensions:', overlay.getBoundingClientRect());
   * }
   * ```
   */
  get overlayElement(): HTMLElement | null {
    return this.#selectionOverlay ?? null;
  }

  /**
   * Get the current zoom level.
   *
   * The zoom level is a multiplier that controls the visual scale of the document.
   * Zoom is applied via CSS transform: scale() on the content elements (#painterHost
   * and #selectionOverlay), with the viewport dimensions (#viewportHost) set to the
   * scaled size to ensure proper scroll behavior.
   *
   * Relationship to Centralized Zoom Architecture:
   * - PresentationEditor is the SINGLE SOURCE OF TRUTH for zoom state
   * - Zoom is applied internally via transform: scale() on #painterHost and #selectionOverlay
   * - The #viewportHost dimensions are set to scaled values for proper scroll container behavior
   * - External components (toolbar, UI controls) should use setZoom() to modify zoom
   * - The zoom value is used throughout the system for coordinate transformations
   *
   * Coordinate Space Implications:
   * - Layout coordinates: Unscaled logical pixels used by the layout engine
   * - Screen coordinates: Physical pixels affected by CSS transform: scale()
   * - Conversion: screenCoord = layoutCoord * zoom
   *
   * Zoom Scale:
   * - 1 = 100% (default, no scaling)
   * - 0.5 = 50% (zoomed out, content appears smaller)
   * - 2 = 200% (zoomed in, content appears larger)
   *
   * @returns The current zoom level multiplier (default: 1 if not configured)
   *
   * @example
   * ```typescript
   * const zoom = presentation.zoom;
   * // Convert layout coordinates to screen coordinates
   * const screenX = layoutX * zoom;
   * const screenY = layoutY * zoom;
   *
   * // Convert screen coordinates back to layout coordinates
   * const layoutX = screenX / zoom;
   * const layoutY = screenY / zoom;
   * ```
   */
  get zoom(): number {
    return this.#layoutOptions.zoom ?? 1;
  }

  /**
   * Set the document mode and update editor editability.
   *
   * This method updates both the PresentationEditor's internal mode state and the
   * underlying Editor's document mode. The hidden editor's editable state will
   * reflect the mode for plugin compatibility (editable in 'editing' and 'suggesting'
   * modes, non-editable in 'viewing' mode), while the presentation layer remains
   * visually inert (handled by hidden container CSS).
   *
   * @param mode - The document mode to set. Valid values:
   *   - 'editing': Full editing capabilities, no tracked changes
   *   - 'suggesting': Editing with tracked changes enabled
   *   - 'viewing': Read-only mode, shows original content without changes
   * @throws {TypeError} If mode is not a string or is not one of the valid modes
   *
   * @example
   * ```typescript
   * const presentation = PresentationEditor.getInstance('doc-123');
   * presentation.setDocumentMode('viewing'); // Switch to read-only
   * ```
   */
  setDocumentMode(mode: 'editing' | 'viewing' | 'suggesting') {
    if (typeof mode !== 'string') {
      throw new TypeError(`[PresentationEditor] setDocumentMode expects a string, received ${typeof mode}`);
    }
    const validModes: Array<'editing' | 'viewing' | 'suggesting'> = ['editing', 'viewing', 'suggesting'];
    if (!validModes.includes(mode)) {
      throw new TypeError(`[PresentationEditor] Invalid mode "${mode}". Must be one of: ${validModes.join(', ')}`);
    }
    const modeChanged = this.#documentMode !== mode;
    this.#documentMode = mode;
    this.#editor.setDocumentMode(mode);
    this.#headerFooterSession?.setDocumentMode(mode);
    this.#syncActiveStorySessionDocumentMode(this.#storySessionManager?.getActiveSession() ?? null);
    this.#syncDocumentModeClass();
    this.#syncHiddenEditorA11yAttributes();
    const trackedChangesChanged = this.#syncTrackedChangesPreferences();
    this.#syncHeaderFooterTrackedChangesRenderConfig();
    // Re-render if mode changed OR tracked changes preferences changed.
    // Mode change affects enableComments in toFlowBlocks even if tracked changes didn't change.
    if (modeChanged || trackedChangesChanged) {
      // Clear flow block cache since conversion-affecting settings changed
      this.#flowBlockCache.clear();
      this.#pendingDocChange = true;
      this.#scheduleRerender();
    }
    this.#updatePermissionOverlay();
    this.emit('documentModeChange', { editor: this.#editor, documentMode: mode });
  }

  #syncDocumentModeClass() {
    if (!this.#visibleHost) return;
    this.#visibleHost.classList.toggle('presentation-editor--viewing', this.#documentMode === 'viewing');
    this.#visibleHost.classList.toggle(
      'presentation-editor--allow-selection',
      this.#documentMode === 'viewing' && !!this.#options.allowSelectionInViewMode,
    );
  }

  /**
   * Override tracked-changes rendering preferences—for hosts without plugin state
   * or when forcing a specific viewing mode (e.g., PDF preview).
   *
   * @param overrides - Tracked changes overrides object with optional 'mode' and 'enabled' fields
   * @throws {TypeError} If overrides is provided but is not a plain object
   */
  setTrackedChangesOverrides(overrides?: TrackedChangesOverrides) {
    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides))) {
      throw new TypeError('[PresentationEditor] setTrackedChangesOverrides expects an object or undefined');
    }
    if (overrides !== undefined) {
      const validModes = ['review', 'original', 'final', 'off'];
      if (overrides.mode !== undefined && !validModes.includes(overrides.mode as string)) {
        throw new TypeError(
          `[PresentationEditor] Invalid tracked changes mode "${overrides.mode}". Must be one of: ${validModes.join(', ')}`,
        );
      }
      if (overrides.enabled !== undefined && typeof overrides.enabled !== 'boolean') {
        throw new TypeError('[PresentationEditor] tracked changes "enabled" must be a boolean');
      }
    }
    this.#trackedChangesOverrides = overrides;
    this.#layoutOptions.trackedChanges = overrides;
    const trackedChangesChanged = this.#syncTrackedChangesPreferences();
    this.#syncHeaderFooterTrackedChangesRenderConfig();
    if (trackedChangesChanged) {
      // Clear flow block cache since conversion-affecting settings changed
      this.#flowBlockCache.clear();
      this.#pendingDocChange = true;
      this.#scheduleRerender();
    }
  }

  /**
   * Update viewing-mode comment rendering behavior and re-render if needed.
   *
   * @param options - Viewing mode comment options.
   */
  setViewingCommentOptions(
    options: { emitCommentPositionsInViewing?: boolean; enableCommentsInViewing?: boolean } = {},
  ) {
    if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
      throw new TypeError('[PresentationEditor] setViewingCommentOptions expects an object or undefined');
    }

    let hasChanges = false;

    if (typeof options.emitCommentPositionsInViewing === 'boolean') {
      if (this.#layoutOptions.emitCommentPositionsInViewing !== options.emitCommentPositionsInViewing) {
        this.#layoutOptions.emitCommentPositionsInViewing = options.emitCommentPositionsInViewing;
        hasChanges = true;
      }
    }

    if (typeof options.enableCommentsInViewing === 'boolean') {
      if (this.#layoutOptions.enableCommentsInViewing !== options.enableCommentsInViewing) {
        this.#layoutOptions.enableCommentsInViewing = options.enableCommentsInViewing;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Clear flow block cache since comment settings affect block conversion
      this.#flowBlockCache.clear();
      this.#pendingDocChange = true;
      this.#scheduleRerender();
    }
  }

  /**
   * Toggle the custom context menu at runtime to respect host-level guardrails.
   */
  setContextMenuDisabled(disabled: boolean) {
    this.#editor.setOptions({ disableContextMenu: Boolean(disabled) });
  }

  /**
   * Subscribe to layout update events. Returns an unsubscribe function.
   */
  onLayoutUpdated(handler: (payload: LayoutState & { layout: Layout; metrics?: LayoutMetrics }) => void) {
    this.on('layoutUpdated', handler);
    return () => this.off('layoutUpdated', handler);
  }

  /**
   * Subscribe to layout error events. Returns an unsubscribe function.
   */
  onLayoutError(handler: (error: LayoutError) => void) {
    this.on('layoutError', handler);
    return () => this.off('layoutError', handler);
  }

  /**
   * Surface pages for pagination UI consumers.
   */
  getPages() {
    return this.#layoutState.layout?.pages ?? [];
  }

  /**
   * Surface the most recent layout error (if any).
   */
  getLayoutError(): LayoutError | null {
    return this.#layoutError;
  }

  /**
   * Returns the current health status of the layout engine.
   *
   * @returns Layout health status:
   *   - 'healthy': No errors, layout is functioning normally
   *   - 'degraded': Recovered from errors but may have stale state
   *   - 'failed': Critical error, layout cannot render
   *
   * @example
   * ```typescript
   * const editor = PresentationEditor.getInstance('doc-123');
   * if (!editor.isLayoutHealthy()) {
   *   console.error('Layout is unhealthy:', editor.getLayoutError());
   * }
   * ```
   */
  isLayoutHealthy(): boolean {
    return this.#layoutErrorState === 'healthy';
  }

  /**
   * Returns the detailed layout health state.
   *
   * @returns One of: 'healthy', 'degraded', 'failed'
   */
  getLayoutHealthState(): 'healthy' | 'degraded' | 'failed' {
    return this.#layoutErrorState;
  }

  /**
   * Return layout-relative rects for the current document selection.
   */
  getSelectionRects(relativeTo?: HTMLElement): RangeRect[] {
    const selection = this.getActiveEditor().state?.selection;
    if (!selection || selection.empty) return [];
    return this.getRangeRects(selection.from, selection.to, relativeTo);
  }

  #computeRangeRects(
    from: number,
    to: number,
    relativeTo?: HTMLElement,
    options: { forceBodySurface?: boolean } = {},
  ): RangeRect[] {
    if (!this.#selectionOverlay) return [];
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];

    const start = Math.min(from, to);
    const end = Math.max(from, to);
    // Use effective zoom from actual rendered dimensions, not internal state.
    // Zoom may be applied externally (e.g., by SuperDoc toolbar) without
    // updating PresentationEditor's internal zoom value.
    const zoom = this.#layoutOptions.zoom ?? 1;
    const relativeRect = relativeTo?.getBoundingClientRect() ?? null;
    const containerRect = this.#visibleHost.getBoundingClientRect();
    const scrollLeft = this.#visibleHost.scrollLeft ?? 0;
    const scrollTop = this.#visibleHost.scrollTop ?? 0;

    let usedDomRects = false;
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    const activeNoteSession = this.#getActiveNoteStorySession();
    const useHeaderFooterSurface = !options.forceBodySurface && sessionMode !== 'body';
    const useNoteSurface = !options.forceBodySurface && activeNoteSession != null;
    const layoutRectSource = () => {
      if (useHeaderFooterSurface) {
        return this.#computeHeaderFooterSelectionRects(start, end);
      }
      if (useNoteSurface) {
        return this.#computeNoteSelectionRects(start, end) ?? [];
      }
      const domRects = this.#computeSelectionRectsFromDom(start, end);
      if (domRects != null) {
        usedDomRects = true;
        return domRects;
      }
      if (!this.#layoutState.layout) return [];
      const rects =
        selectionToRects(
          this.#layoutState.layout,
          this.#layoutState.blocks,
          this.#layoutState.measures,
          start,
          end,
          this.#pageGeometryHelper ?? undefined,
        ) ?? [];
      return rects;
    };

    const rawRects = layoutRectSource();
    if (!rawRects.length) return [];

    let domCaretStart: { pageIndex: number; x: number; y: number } | null = null;
    let domCaretEnd: { pageIndex: number; x: number; y: number } | null = null;
    const pageDelta: Record<number, { dx: number; dy: number }> = {};
    if (!usedDomRects && !useNoteSurface) {
      // Geometry fallback path: apply a small DOM-based delta to reduce drift.
      try {
        domCaretStart = this.#computeDomCaretPageLocal(start);
        domCaretEnd = this.#computeDomCaretPageLocal(end);
      } catch (error) {
        // DOM operations can throw exceptions - fall back to geometry-only positioning
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] DOM caret computation failed in getRectsForRange:', error);
        }
      }
      const layoutCaretStart = this.#computeCaretLayoutRectGeometry(start, false);
      if (domCaretStart && layoutCaretStart && domCaretStart.pageIndex === layoutCaretStart.pageIndex) {
        pageDelta[domCaretStart.pageIndex] = {
          dx: domCaretStart.x - layoutCaretStart.x,
          dy: domCaretStart.y - layoutCaretStart.y,
        };
      }
    }

    const pageHeight = this.#getBodyPageHeight();
    const pageGap = useHeaderFooterSurface || !this.#layoutState.layout ? 0 : (this.#layoutState.layout.pageGap ?? 0);
    return rawRects
      .map((rect: LayoutRect, idx: number, allRects: LayoutRect[]) => {
        let adjustedX = rect.x;
        let adjustedY = rect.y;
        if (!usedDomRects) {
          const delta = pageDelta[rect.pageIndex];
          adjustedX = delta ? rect.x + delta.dx : rect.x;
          adjustedY = delta ? rect.y + delta.dy : rect.y;

          // If we have DOM caret positions, override start/end rect edges for tighter alignment
          const isFirstRect = idx === 0;
          const isLastRect = idx === allRects.length - 1;
          if (isFirstRect && domCaretStart && rect.pageIndex === domCaretStart.pageIndex) {
            adjustedX = domCaretStart.x;
          }
          if (isLastRect && domCaretEnd && rect.pageIndex === domCaretEnd.pageIndex) {
            const endX = domCaretEnd.x;
            const newWidth = Math.max(1, endX - adjustedX);
            // Temporarily stash width override by updating rect.width for downstream calculations
            rect = { ...rect, width: newWidth };
          }
        }

        const pageLocalY = adjustedY - rect.pageIndex * (pageHeight + pageGap);
        const coords = this.#convertPageLocalToOverlayCoords(rect.pageIndex, adjustedX, pageLocalY);
        if (!coords) return null;
        // coords are in layout space; convert to viewport coordinates using scroll + zoom
        const absLeft = coords.x * zoom - scrollLeft + containerRect.left;
        const absTop = coords.y * zoom - scrollTop + containerRect.top;
        const left = relativeRect ? absLeft - relativeRect.left : absLeft;
        const top = relativeRect ? absTop - relativeRect.top : absTop;
        const width = Math.max(1, rect.width * zoom);
        const height = Math.max(1, rect.height * zoom);
        return {
          pageIndex: rect.pageIndex,
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
        };
      })
      .filter((rect: RangeRect | null): rect is RangeRect => Boolean(rect));
  }

  /**
   * Convert an arbitrary document range into layout-based bounding rects.
   *
   * @param from - Start position in the ProseMirror document
   * @param to - End position in the ProseMirror document
   * @param relativeTo - Optional HTMLElement for coordinate reference. If provided, returns coordinates
   *                     relative to this element's bounding rect. If omitted, returns absolute viewport
   *                     coordinates relative to the selection overlay.
   * @returns Array of rects, each containing pageIndex and position data (left, top, right, bottom, width, height)
   */
  getRangeRects(from: number, to: number, relativeTo?: HTMLElement): RangeRect[] {
    return this.#computeRangeRects(from, to, relativeTo);
  }

  /**
   * Like {@link getRangeRects} but pins the body surface, ignoring any
   * active header/footer/note session. Used by `ui.viewport.getRect`'s
   * text-target path (SD-3329): a body-anchored target must return body
   * geometry even while the user is editing a header/footer, where
   * `getRangeRects` would otherwise route to the active non-body surface.
   *
   * @param from - Start position in the body ProseMirror document
   * @param to - End position in the body ProseMirror document
   * @param relativeTo - Optional element for coordinate reference (see {@link getRangeRects})
   * @returns Array of body-surface rects (pageIndex + position data)
   */
  getBodyRangeRects(from: number, to: number, relativeTo?: HTMLElement): RangeRect[] {
    return this.#computeRangeRects(from, to, relativeTo, { forceBodySurface: true });
  }

  /**
   * Get selection bounds for a document range with aggregated bounding box.
   * Returns null if layout is unavailable or the range is invalid.
   *
   * @param from - Start position in the ProseMirror document
   * @param to - End position in the ProseMirror document
   * @param relativeTo - Optional HTMLElement to use as coordinate reference. If provided, returns coordinates
   *                     relative to this element's bounding rect (client coordinates). If omitted, returns
   *                     absolute viewport coordinates (relative to the selection overlay).
   * @returns Object containing aggregated bounds, individual rects, and pageIndex, or null if unavailable
   */
  getSelectionBounds(
    from: number,
    to: number,
    relativeTo?: HTMLElement,
  ): {
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    rects: RangeRect[];
    pageIndex: number;
  } | null {
    if (!this.#layoutState.layout) return null;
    const rects = this.getRangeRects(from, to, relativeTo);
    if (!rects.length) return null;
    const bounds = this.#aggregateLayoutBounds(rects);
    if (!bounds) return null;
    return {
      rects,
      bounds,
      pageIndex: rects[0]?.pageIndex ?? 0,
    };
  }

  /**
   * Viewport-coords rect lookup for an entity (comment / tracked
   * change) painted in the editor surface. Drives the
   * `superdoc/ui` `ui.viewport.getRect` substrate so consumers can
   * pin sticky cards / floating toolbars next to inline highlights
   * without reaching into DOM, PM positions, or painter selectors.
   *
   * Returns plain value rects (not live `DOMRect`) in viewport
   * coordinates. An empty array means the entity isn't currently
   * painted — virtualized page, story not active, or id not present
   * in the document. Callers can choose to scroll first then retry,
   * or render the card detached.
   *
   * @param target - The entity to locate. `entityType` is one of
   *                 `'comment'` or `'trackedChange'`. `story` is
   *                 optional; when provided, results are filtered to
   *                 that story so an id that exists in body and a
   *                 footer doesn't return rects from both.
   */
  getEntityRects(target: { entityType?: unknown; entityId?: unknown; story?: unknown }): RangeRect[] {
    if (!target || typeof target !== 'object') return [];
    const entityType = target.entityType;
    const entityId = target.entityId;
    if (typeof entityType !== 'string' || typeof entityId !== 'string' || entityId.length === 0) {
      return [];
    }
    const host = this.#visibleHost;
    if (!host) return [];
    const storyKey = resolveStoryKeyFromAddress(target.story);
    let elements: HTMLElement[];
    if (entityType === 'trackedChange') {
      // Use a strict story filter for the viewport read path. The
      // navigation helper `#findRenderedTrackedChangeElements` falls
      // back to all same-id matches when no exact story match wins a
      // heuristic — that's correct for "scroll to this change", but
      // wrong here: a sticky card asked to anchor a header/footer
      // change must not silently anchor to a body copy of the same
      // id. Empty result when the requested story has no painted copy
      // is the correct signal — the UI controller maps it to
      // `not-mounted` so the consumer can pre-mount via
      // `viewport.scrollIntoView` and retry.
      elements = findRenderedTrackedChangeElementsStrict(host, entityId, escapeAttrValue, storyKey);
    } else if (entityType === 'comment') {
      elements = findRenderedCommentElements(host, entityId, storyKey);
    } else if (entityType === 'contentControl') {
      // SDT wrappers do not currently stamp `data-story-key`, so this
      // helper accepts `storyKey` for signature parity but returns all
      // painted occurrences regardless. v1 is body-only; an SDT in a
      // header / footer will still match. See JSDoc on
      // `findRenderedContentControlElements`.
      elements = findRenderedContentControlElements(host, entityId, escapeAttrValue, storyKey);
    } else {
      return [];
    }
    return elementsToRangeRects(elements);
  }

  #getThreadSelectionBounds(
    data: { storyKey?: unknown; start?: unknown; end?: unknown; pos?: unknown },
    relativeTo: HTMLElement | undefined,
  ): {
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    rects: RangeRect[];
    pageIndex: number;
  } | null {
    const start = Number.isFinite(data.start ?? data.pos) ? Number(data.start ?? data.pos) : undefined;
    const end = Number.isFinite(data.end) ? Number(data.end) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    const storyKey = typeof data.storyKey === 'string' ? data.storyKey : null;
    const rects =
      storyKey === BODY_STORY_KEY
        ? this.#computeRangeRects(start!, end!, relativeTo, { forceBodySurface: true })
        : this.getRangeRects(start!, end!, relativeTo);

    if (!rects.length) {
      return null;
    }

    const bounds = this.#aggregateLayoutBounds(rects);
    if (!bounds) {
      return null;
    }

    return {
      rects,
      bounds,
      pageIndex: rects[0]?.pageIndex ?? 0,
    };
  }

  /**
   * Remap comment positions to layout coordinates with bounds and rects.
   * Takes a positions object with threadIds as keys and position data as values.
   * Returns the same structure with added bounds, rects, and pageIndex for each comment.
   *
   * PERFORMANCE NOTE: This iterates all comment positions on every call. For documents with many comments
   * (>100), consider caching layout bounds per comment and invalidating on layout updates.
   *
   * @param positions - Map of threadId -> { start?, end?, pos?, ...otherFields }
   * @param relativeTo - Optional HTMLElement for coordinate reference
   * @returns Updated positions map with bounds, rects, and pageIndex added to each comment
   */
  getCommentBounds(
    positions: Record<string, { start?: number; end?: number; pos?: number; [key: string]: unknown }>,
    relativeTo?: HTMLElement,
  ): Record<
    string,
    {
      start?: number;
      end?: number;
      pos?: number;
      bounds?: unknown;
      rects?: unknown;
      pageIndex?: number;
      [key: string]: unknown;
    }
  > {
    if (!positions || typeof positions !== 'object') return positions;
    if (!this.#layoutState.layout) return positions;

    const entries = Object.entries(positions);
    if (!entries.length) return positions;

    let hasUpdates = false;
    const remapped: Record<
      string,
      {
        start?: number;
        end?: number;
        pos?: number;
        bounds?: unknown;
        rects?: unknown;
        pageIndex?: number;
        [key: string]: unknown;
      }
    > = {};

    entries.forEach(([threadId, data]) => {
      if (!data) {
        remapped[threadId] = data;
        return;
      }

      const storyTrackedBounds = this.#getStoryTrackedChangeBounds(data, relativeTo);
      if (storyTrackedBounds) {
        hasUpdates = true;
        remapped[threadId] = {
          ...data,
          bounds: storyTrackedBounds.bounds,
          rects: storyTrackedBounds.rects,
          pageIndex: storyTrackedBounds.pageIndex,
        };
        return;
      }

      const start = data.start ?? data.pos;
      const end = data.end ?? start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        remapped[threadId] = data;
        return;
      }

      const layoutRange = this.#getThreadSelectionBounds(data, relativeTo);
      if (!layoutRange) {
        remapped[threadId] = data;
        return;
      }

      hasUpdates = true;
      remapped[threadId] = {
        ...data,
        bounds: layoutRange.bounds,
        rects: layoutRange.rects,
        pageIndex: layoutRange.pageIndex,
      };
    });

    return hasUpdates ? remapped : positions;
  }

  #shouldEmitCommentPositions(): boolean {
    const allowViewingCommentPositions = this.#layoutOptions.emitCommentPositionsInViewing === true;
    return this.#documentMode !== 'viewing' || allowViewingCommentPositions;
  }

  #emitCommentPositions(relativeTo?: HTMLElement): void {
    if (!this.#shouldEmitCommentPositions()) {
      return;
    }

    const commentPositions = this.#collectCommentPositions();
    const positionsWithBounds =
      relativeTo != null ? this.getCommentBounds(commentPositions, relativeTo) : commentPositions;

    this.emit('commentPositions', { positions: positionsWithBounds });
  }

  /**
   * Collect all comment and tracked change positions from the PM document.
   *
   * This is the authoritative source for PM positions - called after every
   * layout update to ensure positions are always fresh from the current document.
   *
   * The returned positions contain PM offsets (start, end) which can be passed
   * to getCommentBounds() to compute visual layout coordinates.
   *
   * @returns Map of threadId -> { threadId, start, end }
   */
  #collectCommentPositions(): Record<
    string,
    {
      threadId: string;
      start?: number;
      end?: number;
      key?: string;
      storyKey?: string;
      kind?: 'trackedChange' | 'comment';
    }
  > {
    return {
      ...collectCommentPositionsFromHelper(this.#editor?.state?.doc ?? null, {
        commentMarkName: CommentMarkName,
        trackChangeMarkNames: [TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName],
        storyKey: BODY_STORY_KEY,
      }),
      ...this.#collectIndexedTrackedChangePositions(),
      ...this.#collectStructuralBodyTrackedChangePositions(),
      ...this.#collectRenderedTrackedChangePositions(),
    };
  }

  /**
   * Emit position entries for decidable whole-table structural tracked changes
   * living in the BODY story (table insert / table delete).
   *
   * Structural row revisions are whole-table changes that the right rail
   * surfaces as review bubbles (see comments-store
   * `syncStructuralTrackedChangeComments`). Unlike inline body tracked changes
   * (whose marks are measured downstream by mark span) and non-body story
   * changes (handled by `#collectIndexedTrackedChangePositions`, which skips the
   * body story), a body-story structural change has no inline mark to anchor on.
   *
   * We key each entry by the tracked-change index `anchorKey` (matching the
   * bubble's `trackedChangeAnchorKey`) and carry the table's PM range as
   * `start`/`end`. `getCommentBounds` falls through `#getStoryTrackedChangeBounds`
   * (null for the body story) into `#getThreadSelectionBounds`, which resolves
   * the range to layout rects via `#computeRangeRects(..., forceBodySurface)` —
   * the exact path body comments/inline TC use — so the bubble lines up with the
   * table in layout-engine viewing mode.
   */
  #collectStructuralBodyTrackedChangePositions(): Record<
    string,
    {
      threadId: string;
      key: string;
      storyKey: string;
      kind: 'trackedChange';
      structural: true;
      start?: number;
      end?: number;
    }
  > {
    const positions: Record<
      string,
      {
        threadId: string;
        key: string;
        storyKey: string;
        kind: 'trackedChange';
        structural: true;
        start?: number;
        end?: number;
      }
    > = {};

    let snapshots: ReadonlyArray<{
      anchorKey?: unknown;
      type?: unknown;
      runtimeRef?: { rawId?: unknown; storyKey?: unknown };
      range?: { from?: unknown; to?: unknown };
    }> = [];

    try {
      snapshots = getTrackedChangeIndex(this.#editor).getAll();
    } catch {
      return positions;
    }

    snapshots.forEach((snapshot) => {
      if (snapshot?.type !== 'structural') return;
      const storyKey =
        typeof snapshot?.runtimeRef?.storyKey === 'string' ? snapshot.runtimeRef.storyKey : BODY_STORY_KEY;
      // Body-story structural changes only — non-body structural would be
      // picked up by the rendered/indexed passes which key on their own story.
      if (storyKey !== BODY_STORY_KEY) return;

      const key = typeof snapshot?.anchorKey === 'string' ? snapshot.anchorKey : null;
      const rawId = snapshot?.runtimeRef?.rawId;
      const threadId = rawId == null ? null : String(rawId);
      if (!key || !threadId || positions[key]) return;

      const start = Number.isFinite(snapshot?.range?.from) ? Number(snapshot.range.from) : undefined;
      const end = Number.isFinite(snapshot?.range?.to) ? Number(snapshot.range.to) : undefined;

      positions[key] = {
        threadId,
        key,
        storyKey,
        kind: 'trackedChange',
        structural: true,
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
      };
    });

    return positions;
  }

  #collectIndexedTrackedChangePositions(): Record<
    string,
    {
      threadId: string;
      key: string;
      storyKey: string;
      kind: 'trackedChange';
      start?: number;
      end?: number;
    }
  > {
    const positions: Record<
      string,
      {
        threadId: string;
        key: string;
        storyKey: string;
        kind: 'trackedChange';
        start?: number;
        end?: number;
      }
    > = {};

    let snapshots: ReadonlyArray<{
      anchorKey?: unknown;
      runtimeRef?: { rawId?: unknown; storyKey?: unknown };
      range?: { from?: unknown; to?: unknown };
    }> = [];

    try {
      snapshots = getTrackedChangeIndex(this.#editor).getAll();
    } catch {
      return positions;
    }

    snapshots.forEach((snapshot) => {
      const key = typeof snapshot?.anchorKey === 'string' ? snapshot.anchorKey : null;
      const storyKey = typeof snapshot?.runtimeRef?.storyKey === 'string' ? snapshot.runtimeRef.storyKey : null;
      const rawId = snapshot?.runtimeRef?.rawId;
      const threadId = rawId == null ? null : String(rawId);

      if (!key || !storyKey || !threadId || storyKey === BODY_STORY_KEY || positions[key]) {
        return;
      }

      const start = Number.isFinite(snapshot?.range?.from) ? Number(snapshot.range.from) : undefined;
      const end = Number.isFinite(snapshot?.range?.to) ? Number(snapshot.range.to) : undefined;

      positions[key] = {
        threadId,
        key,
        storyKey,
        kind: 'trackedChange',
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
      };
    });

    return positions;
  }

  #collectRenderedTrackedChangePositions(): Record<
    string,
    {
      threadId: string;
      key: string;
      storyKey: string;
      kind: 'trackedChange';
    }
  > {
    const positions: Record<
      string,
      {
        threadId: string;
        key: string;
        storyKey: string;
        kind: 'trackedChange';
      }
    > = {};
    const host = this.#visibleHost;

    if (!host) {
      return positions;
    }

    const elements = host.querySelectorAll<HTMLElement>('[data-track-change-id][data-story-key]');
    elements.forEach((element) => {
      const storyKey = element.dataset.storyKey?.trim();
      const rawId = element.dataset.trackChangeId?.trim();
      if (!storyKey || !rawId || storyKey === BODY_STORY_KEY) {
        return;
      }

      const key = makeTrackedChangeAnchorKey({ storyKey, rawId });
      if (positions[key]) {
        return;
      }

      positions[key] = {
        threadId: rawId,
        key,
        storyKey,
        kind: 'trackedChange',
      };
    });

    return positions;
  }

  #getStoryTrackedChangeBounds(
    data: { threadId?: unknown; storyKey?: unknown; kind?: unknown; start?: unknown; end?: unknown },
    relativeTo?: HTMLElement,
  ): {
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    rects: RangeRect[];
    pageIndex: number;
  } | null {
    if (data?.kind !== 'trackedChange') {
      return null;
    }

    const storyKey = typeof data.storyKey === 'string' ? data.storyKey : null;
    if (!storyKey || storyKey === BODY_STORY_KEY) {
      return null;
    }

    const activeSurface = this.#getActiveTrackedChangeStorySurface();
    if (!activeSurface || activeSurface.storyKey !== storyKey) {
      return this.#getRenderedTrackedChangeBounds(data, relativeTo);
    }

    const start = Number.isFinite(data.start) ? Number(data.start) : undefined;
    const end = Number.isFinite(data.end) ? Number(data.end) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return this.#getRenderedTrackedChangeBounds(data, relativeTo);
    }

    const rects = this.getRangeRects(start!, end!, relativeTo);
    if (!rects.length) {
      return this.#getRenderedTrackedChangeBounds(data, relativeTo);
    }

    const bounds = this.#aggregateLayoutBounds(rects);
    if (!bounds) {
      return this.#getRenderedTrackedChangeBounds(data, relativeTo);
    }

    return {
      bounds,
      rects,
      pageIndex: rects[0]?.pageIndex ?? 0,
    };
  }

  #getRenderedTrackedChangeBounds(
    data: { threadId?: unknown; storyKey?: unknown; kind?: unknown },
    relativeTo?: HTMLElement,
  ): {
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    rects: RangeRect[];
    pageIndex: number;
  } | null {
    if (data?.kind !== 'trackedChange') {
      return null;
    }

    const storyKey = typeof data.storyKey === 'string' ? data.storyKey : null;
    const rawId = typeof data.threadId === 'string' ? data.threadId : null;
    if (!storyKey || !rawId || storyKey === BODY_STORY_KEY) {
      return null;
    }

    const elements = this.#findRenderedTrackedChangeElements(rawId, storyKey);
    if (!elements.length) {
      return null;
    }

    const relativeRect = relativeTo?.getBoundingClientRect?.();
    const rects = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (![rect.top, rect.left, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)) {
          return null;
        }

        const pageIndex = Number(element.closest<HTMLElement>('.superdoc-page')?.dataset?.pageIndex ?? 0);
        return {
          pageIndex: Number.isFinite(pageIndex) ? pageIndex : 0,
          left: rect.left - (relativeRect?.left ?? 0),
          top: rect.top - (relativeRect?.top ?? 0),
          right: rect.right - (relativeRect?.left ?? 0),
          bottom: rect.bottom - (relativeRect?.top ?? 0),
          width: rect.width,
          height: rect.height,
        } satisfies RangeRect;
      })
      .filter((rect): rect is RangeRect => Boolean(rect));

    if (!rects.length) {
      return null;
    }

    const groupedRects = this.#groupRangeRectsByPage(rects);
    const preferredPageIndex = this.#getPreferredRenderedTrackedChangePageIndex(storyKey, groupedRects, relativeTo);
    const anchorRects = groupedRects.get(preferredPageIndex) ?? rects;
    const bounds = this.#aggregateLayoutBounds(anchorRects);
    if (!bounds) {
      return null;
    }

    return {
      bounds,
      rects,
      pageIndex: preferredPageIndex,
    };
  }

  #findRenderedTrackedChangeElements(rawId: string, storyKey?: string): HTMLElement[] {
    const host = this.#visibleHost;
    if (!host) {
      return [];
    }

    const baseSelector = `[data-track-change-id="${escapeAttrValue(rawId)}"]`;
    if (!storyKey) {
      return Array.from(host.querySelectorAll<HTMLElement>(baseSelector));
    }

    const storySelector = `${baseSelector}[data-story-key="${escapeAttrValue(storyKey)}"]`;
    const exactMatches = Array.from(host.querySelectorAll<HTMLElement>(storySelector));
    const allMatches = Array.from(host.querySelectorAll<HTMLElement>(baseSelector));

    if (exactMatches.length > 1 || exactMatches.length === allMatches.length || allMatches.length === 0) {
      return exactMatches;
    }

    return allMatches;
  }

  #groupRangeRectsByPage(rects: RangeRect[]): Map<number, RangeRect[]> {
    const grouped = new Map<number, RangeRect[]>();

    rects.forEach((rect) => {
      const pageIndex = Number.isFinite(rect.pageIndex) ? rect.pageIndex : 0;
      const pageRects = grouped.get(pageIndex);
      if (pageRects) {
        pageRects.push(rect);
        return;
      }
      grouped.set(pageIndex, [rect]);
    });

    return grouped;
  }

  #getPreferredRenderedTrackedChangePageIndex(
    storyKey: string,
    groupedRects: Map<number, RangeRect[]>,
    relativeTo?: HTMLElement,
  ): number {
    const activeHeaderFooterSession = this.#headerFooterSession?.session;
    const activeHeaderFooterStoryKey =
      activeHeaderFooterSession?.mode !== 'body' && activeHeaderFooterSession?.headerFooterRefId
        ? buildStoryKey({
            kind: 'story',
            storyType: 'headerFooterPart',
            refId: activeHeaderFooterSession.headerFooterRefId,
          })
        : null;

    const activePageIndex =
      activeHeaderFooterStoryKey === storyKey && Number.isFinite(activeHeaderFooterSession?.pageIndex)
        ? Number(activeHeaderFooterSession?.pageIndex)
        : null;
    if (activePageIndex != null && groupedRects.has(activePageIndex)) {
      return activePageIndex;
    }

    const scrollViewport =
      this.#scrollContainer instanceof Window
        ? {
            top: 0,
            bottom: this.#scrollContainer.innerHeight,
          }
        : this.#scrollContainer instanceof Element
          ? this.#scrollContainer.getBoundingClientRect()
          : this.#visibleHost?.ownerDocument?.defaultView
            ? {
                top: 0,
                bottom: this.#visibleHost.ownerDocument.defaultView.innerHeight,
              }
            : this.#visibleHost?.getBoundingClientRect?.();
    const viewportRect = scrollViewport ?? null;
    if (viewportRect) {
      const relativeRect = relativeTo?.getBoundingClientRect?.();
      const visibleTop = viewportRect.top - (relativeRect?.top ?? 0);
      const visibleBottom = viewportRect.bottom - (relativeRect?.top ?? 0);
      const viewportCenter = visibleTop + (visibleBottom - visibleTop) / 2;

      let bestPageIndex: number | null = null;
      let bestIntersection = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      groupedRects.forEach((pageRects, pageIndex) => {
        const pageBounds = this.#aggregateLayoutBounds(pageRects);
        if (!pageBounds) {
          return;
        }

        const intersection = Math.max(
          0,
          Math.min(pageBounds.bottom, visibleBottom) - Math.max(pageBounds.top, visibleTop),
        );
        const pageCenter = pageBounds.top + pageBounds.height / 2;
        const distance = Math.abs(pageCenter - viewportCenter);

        if (
          intersection > bestIntersection ||
          (intersection === bestIntersection && distance < bestDistance) ||
          (intersection === bestIntersection &&
            distance === bestDistance &&
            (bestPageIndex == null || pageIndex < bestPageIndex))
        ) {
          bestPageIndex = pageIndex;
          bestIntersection = intersection;
          bestDistance = distance;
        }
      });

      if (bestPageIndex != null) {
        return bestPageIndex;
      }
    }

    return [...groupedRects.keys()].sort((left, right) => left - right)[0] ?? 0;
  }

  /**
   * Return a snapshot of the latest layout state.
   */
  getLayoutSnapshot(): {
    layout: Layout | null;
    blocks: FlowBlock[];
    measures: Measure[];
    sectionMetadata: SectionMetadata[];
  } {
    return {
      layout: this.#layoutState.layout,
      blocks: this.#layoutState.blocks,
      measures: this.#layoutState.measures,
      sectionMetadata: this.#sectionMetadata,
    };
  }

  /**
   * Return the live inputs that fed the most recent `resolveLayout` / paint pass.
   *
   * Unlike {@link getLayoutSnapshot}, whose `blocks` / `measures` are the
   * body-only set used for pagination, this exposes the lookup blocks/measures
   * the real paint path resolved against — including any extra blocks/measures
   * v1 injected (e.g. footnote bodies and separators). Consumers that re-resolve
   * the snapshot must use these so resolved geometry matches what was painted.
   *
   * Read-only: returns the last captured inputs and never triggers new layout
   * work. Falls back to the body set when no extra lookup blocks were injected.
   */
  getLayoutResolveSnapshot(): {
    layout: Layout | null;
    blocks: FlowBlock[];
    measures: Measure[];
    sectionMetadata: SectionMetadata[];
  } {
    const blocks = this.#layoutLookupBlocks.length > 0 ? this.#layoutLookupBlocks : this.#layoutState.blocks;
    const measures = this.#layoutLookupMeasures.length > 0 ? this.#layoutLookupMeasures : this.#layoutState.measures;
    return {
      layout: this.#layoutState.layout,
      blocks,
      measures,
      sectionMetadata: this.#sectionMetadata,
    };
  }

  /**
   * Return the read-only header/footer story-part layout snapshot.
   *
   * Pass-through to {@link HeaderFooterSessionManager.getHeaderFooterLayoutSnapshot}:
   * per-page header/footer bindings plus the raw and resolved layout for each
   * distinct story, as deterministic JSON-safe data. Available after a normal
   * layout pass even when the editor is not in header/footer edit mode. Returns a
   * well-formed but empty snapshot when no header/footer session exists yet or the
   * document has no headers/footers.
   */
  getHeaderFooterLayoutSnapshot(): HeaderFooterLayoutSnapshot {
    return (
      this.#headerFooterSession?.getHeaderFooterLayoutSnapshot() ?? {
        pageBindings: [],
        storyLayouts: { headers: [], footers: [] },
      }
    );
  }

  /**
   * Per-font resolution report for the current document: for each DECLARED (logical)
   * font, the physical family SuperDoc rendered, why, its load status, and the family
   * export preserves. The observable answer to "what font did SuperDoc actually use".
   *
   * Scope: this is a DOCUMENT-font report - it covers every family the document declares
   * (font table + theme + defaults via `converter.getDocumentFonts()`), not only fonts
   * currently visible on screen. A family declared but never painted still appears. A
   * separate rendered-fonts view (only what is on screen) may follow. Surfaced publicly
   * as `superdoc.fonts.getReport()`.
   */
  getFontReport(): FontResolutionRecord[] {
    return this.#fontGate?.getReport() ?? [];
  }

  /**
   * The document's own fonts for the toolbar's document-specific picker: one option per LOGICAL family
   * the document renders, each with the family to preview it in. DOCUMENT fonts only - the toolbar
   * composes them with its defaults. Surfaced publicly as `superdoc.fonts.getDocumentFontOptions()`.
   */
  getDocumentFontOptions(): DocumentFontOption[] {
    return this.#fontGate?.getDocumentFontOptions() ?? [];
  }

  /**
   * Declared families with no faithful render font loaded (substitution-aware): the
   * subset of {@link getFontReport} where `missing` is true - genuinely absent fonts
   * such as Aptos with no metric-compatible clone. The accurate replacement for the
   * legacy `fonts-resolved.unsupportedFonts` probe. Surfaced as
   * `superdoc.fonts.getMissingFonts()`.
   */
  getMissingFonts(): string[] {
    // Deduped by logical family: the report can now carry multiple FACE rows per family, but a
    // missing-font list is per family.
    return [
      ...new Set(
        this.getFontReport()
          .filter((record) => record.missing)
          .map((record) => record.logicalFamily),
      ),
    ];
  }

  /**
   * Map logical families to physical render families for THIS document (e.g.
   * `{ Georgia: 'Gelasio' }`), via the document font controller (the sole writer), which reflows
   * once iff the mapping actually changed. Per-document: other editors on the page are untouched.
   * Surfaced as `superdoc.fonts.map()`.
   */
  mapFonts(mappings: Record<string, string>): void {
    this.#fontController.map(mappings);
  }

  /**
   * Remove runtime font mappings for THIS document; each family reverts to its bundled default.
   * Via the document font controller. Surfaced as `superdoc.fonts.unmap()`.
   */
  unmapFonts(families: string | string[]): void {
    this.#fontController.unmap(families);
  }

  /**
   * Register custom physical font faces for THIS document via the document font controller, then
   * reflow so a newly-registered face the document already uses is awaited and applied. Surfaced
   * as `superdoc.fonts.add()`.
   */
  addFonts(families: FontFamilyConfig[]): void {
    this.#fontController.add(families);
  }

  /**
   * Proactively load the physical faces for the given logical families (resolved through this
   * document's resolver) so they are ready before use. Async. Surfaced as `superdoc.fonts.preload()`.
   */
  async preloadFonts(families: string[]): Promise<void> {
    await this.#fontController.preload(families);
  }

  /**
   * Register the current document's embedded fonts (from the converter) as document-owned registry
   * faces, so the resolver's `registered_face` rung renders the real embedded font instead of the
   * bundled substitute. Runs at config time - initial load and after a document swap - BEFORE the
   * first font plan; the controller skips non-embeddable faces and releases these on the next swap
   * (`reset`) / teardown (`dispose`). `getEmbeddedFontFaces` is not on the converter's typed surface,
   * so it is read through a narrow structural cast (same pattern as `getDocumentFonts`).
   */
  #applyEmbeddedDocumentFonts(): void {
    const converter = (this.#editor as Editor & { converter?: { getEmbeddedFontFaces?: () => EmbeddedFontFace[] } })
      .converter;
    this.#fontController.applyEmbeddedFaces(converter?.getEmbeddedFontFaces?.());
  }

  /**
   * Drop this editor's cached blocks + measures and schedule a full document re-layout. The
   * font-readiness gate calls this (via its requestReflow option) for both a late font load and a
   * document font config change: incremental layout reuses previousMeasures for unchanged blocks,
   * so clearing them is what forces the re-measure; the pending-change flag routes through the
   * document re-layout path (not the selection-only render).
   */
  #requestFontReflow(): void {
    this.#layoutState = { ...this.#layoutState, blocks: [], measures: [], layout: null };
    // SD-3432: font metrics changed; the footnote fixed point is stale (the
    // seed's fontSignature guard would reject it anyway).
    this.#footnoteReserveSeed = null;
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  /**
   * Emit `fonts-changed` on the hidden editor when the resolved/loaded font picture
   * actually changed since the last emit, so consumers see one event per real change
   * rather than one per render. The dedup key is the font epoch plus each required face's
   * load status (cheap; from the gate's last summary). The full report is built only when
   * we emit. First emit is `source: 'initial'`; an epoch bump (a late load) is
   * `'late-load'`. Never throws - font reporting must not break layout.
   */
  #emitFontsChangedIfChanged(summary: FontLoadSummary | null): void {
    const gate = this.#fontGate;
    if (!gate) return;
    const version = gate.fontConfigVersion;
    const statusKey = summary
      ? summary.results
          .map((result) => `${result.family}:${result.status}`)
          .sort()
          .join(',')
      : '';
    // Include the render plan's effectiveSignature so a face-set change (e.g. Regular -> add Bold, or
    // a fonts.add() that flips a face from fallback to substitute) emits even when the rolled-up
    // family status stays 'loaded'.
    const key = `${version}|${this.#fontPlan?.effectiveSignature ?? ''}|${statusKey}`;
    if (key === this.#lastFontsChangedKey) return;
    const isInitial = this.#lastFontsChangedKey === null;
    // The epoch (gate.fontConfigVersion) bumps on a late load and on a config mutation, but NOT on
    // ordinary editing - so an unchanged epoch with a changed key means the rendered face set changed
    // from editing (e.g. the first Bold of a family), not a font load.
    const epochBumped = !isInitial && version !== this.#lastFontsChangedVersion;
    this.#lastFontsChangedKey = key;
    this.#lastFontsChangedVersion = version;
    // Consume the pending source flag: a runtime mapping change (set by the font controller) is a
    // 'config-change'. The FIRST emit is always 'initial'. Otherwise an epoch bump is a font
    // 'late-load'; a key change with NO epoch bump is a 'render-change' (face-set delta from editing),
    // not a late load - consumers filtering on 'late-load' must not see spurious load signals on typing.
    const pendingSource = this.#nextFontsChangedSource;
    this.#nextFontsChangedSource = null;
    const source: FontsChangedPayload['source'] = isInitial
      ? 'initial'
      : (pendingSource ?? (epochBumped ? 'late-load' : 'render-change'));

    let resolutions: FontResolutionRecord[];
    try {
      resolutions = gate.getReport();
    } catch {
      return;
    }
    const payload: FontsChangedPayload = {
      documentFonts: [...new Set(resolutions.map((record) => record.logicalFamily))],
      resolutions,
      missingFonts: [...new Set(resolutions.filter((record) => record.missing).map((record) => record.logicalFamily))],
      loadSummary: summary ?? { loaded: 0, failed: 0, timedOut: 0, fallbackUsed: 0, results: [] },
      source,
      version,
    };
    this.#lastFontsChangedPayload = payload;
    try {
      this.#editor.emit('fonts-changed', payload);
    } catch {
      /* font reporting must never break layout */
    }
  }

  /**
   * The last `fonts-changed` payload this editor emitted, or null if none yet. Lets a
   * SuperDoc relay that subscribed after the emission replay the current report, so the
   * active document's authoritative report is always delivered even when the relay
   * attaches late (e.g. a document swap).
   */
  getLastFontsChangedPayload(): FontsChangedPayload | null {
    return this.#lastFontsChangedPayload;
  }

  /**
   * Clear per-document `fonts-changed` report state on a document swap (same editor, new document).
   * Without this the new document could inherit the prior document's pending config-change source,
   * replay its last payload to a late subscriber, or - if it happens to share the prior
   * version|statusKey - have its first report SKIPPED by the dedup. Cleared so the new document
   * re-emits from scratch (its first report is `initial`). Pairs with the gate + resolver resets
   * at this same lifecycle boundary.
   */
  #resetFontReportStateForDocumentChange(): void {
    this.#nextFontsChangedSource = null;
    this.#lastFontsChangedKey = null;
    this.#lastFontsChangedVersion = -1;
    this.#lastFontsChangedPayload = null;
    // Drop the prior document's render plan so getReport() cannot leak its used-face rows before the
    // next render rebuilds the plan.
    this.#fontPlan = null;
    this.#fontPlanBlocks = null;
  }

  /**
   * Expose the current layout engine options.
   */
  getLayoutOptions(): LayoutEngineOptions {
    return { ...this.#layoutOptions };
  }

  #isSemanticFlowMode(): boolean {
    return this.#layoutOptions.flowMode === 'semantic';
  }

  #resolveSemanticMargins(margins: PageMargins): { left: number; right: number; top: number; bottom: number } {
    const mode = this.#layoutOptions.semanticOptions?.marginsMode ?? 'firstSection';
    if (mode === 'none') {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }

    const clamp = (value: number | undefined, fallback: number): number => {
      const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      return v >= 0 ? v : fallback;
    };

    if (mode === 'custom') {
      const custom = this.#layoutOptions.semanticOptions?.customMargins;
      return {
        left: clamp(custom?.left, clamp(margins.left, DEFAULT_MARGINS.left!)),
        right: clamp(custom?.right, clamp(margins.right, DEFAULT_MARGINS.right!)),
        top: clamp(custom?.top, clamp(margins.top, DEFAULT_MARGINS.top!)),
        bottom: clamp(custom?.bottom, clamp(margins.bottom, DEFAULT_MARGINS.bottom!)),
      };
    }
    // mode === 'firstSection' — keep horizontal margins from the first DOCX section
    // but zero vertical margins so stacked pages form a seamless continuous surface.
    return {
      left: clamp(margins.left, DEFAULT_MARGINS.left!),
      right: clamp(margins.right, DEFAULT_MARGINS.right!),
      top: 0,
      bottom: 0,
    };
  }

  #resolveSemanticContainerInnerWidth(): number {
    const host = this.#visibleHost;
    if (!host) return DEFAULT_PAGE_SIZE.w;
    const win = host.ownerDocument?.defaultView ?? window;
    const style = win.getComputedStyle(host);
    const paddingLeft = Number.parseFloat(style.paddingLeft ?? '0');
    const paddingRight = Number.parseFloat(style.paddingRight ?? '0');
    const horizontalPadding =
      (Number.isFinite(paddingLeft) ? paddingLeft : 0) + (Number.isFinite(paddingRight) ? paddingRight : 0);
    const clientWidth = host.clientWidth;
    if (Number.isFinite(clientWidth) && clientWidth > 0) {
      return Math.max(1, clientWidth - horizontalPadding);
    }
    const rectWidth = host.getBoundingClientRect().width;
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
      return Math.max(1, rectWidth - horizontalPadding);
    }
    return Math.max(1, DEFAULT_PAGE_SIZE.w - horizontalPadding);
  }

  #setupSemanticResizeObserver(): void {
    if (!this.#isSemanticFlowMode()) return;
    const view = this.#visibleHost.ownerDocument?.defaultView ?? window;
    const ResizeObs = view.ResizeObserver;
    if (typeof ResizeObs !== 'function') return;

    this.#lastSemanticContainerWidth = this.#resolveSemanticContainerInnerWidth();
    this.#semanticResizeObserver = new ResizeObs(() => {
      this.#scheduleSemanticResizeRelayout();
    });
    this.#semanticResizeObserver.observe(this.#visibleHost);
  }

  #scheduleSemanticResizeRelayout(): void {
    if (!this.#isSemanticFlowMode()) return;
    const view = this.#visibleHost.ownerDocument?.defaultView ?? window;
    if (this.#semanticResizeRaf == null) {
      this.#semanticResizeRaf = view.requestAnimationFrame(() => {
        this.#semanticResizeRaf = null;
        this.#applySemanticResizeRelayout();
      });
    }
    if (this.#semanticResizeDebounce != null) {
      view.clearTimeout(this.#semanticResizeDebounce);
    }
    this.#semanticResizeDebounce = view.setTimeout(() => {
      this.#semanticResizeDebounce = null;
      this.#applySemanticResizeRelayout();
    }, SEMANTIC_RESIZE_DEBOUNCE_MS);
  }

  #applySemanticResizeRelayout(): void {
    if (!this.#isSemanticFlowMode()) return;
    const nextWidth = this.#resolveSemanticContainerInnerWidth();
    const prevWidth = this.#lastSemanticContainerWidth;
    if (prevWidth != null && Math.abs(nextWidth - prevWidth) < 1) {
      return;
    }
    this.#lastSemanticContainerWidth = nextWidth;
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  /**
   * Return a snapshot of painter output captured during the latest paint cycle.
   */
  getPaintSnapshot(): PaintSnapshot | null {
    return this.#painterAdapter.getPaintSnapshot();
  }

  /**
   * Get the page styles for the section containing the current caret position.
   *
   * In multi-section documents, different sections can have different page sizes,
   * margins, and orientations. This method returns the styles for the section
   * where the caret is currently located, enabling section-aware UI components
   * like rulers to display accurate information.
   *
   * @returns Object containing:
   *   - pageSize: { width, height } in inches
   *   - pageMargins: { left, right, top, bottom } in inches
   *   - sectionIndex: The current section index (0-based)
   *   - orientation: 'portrait' or 'landscape'
   *
   * Falls back to document-level defaults if section info is unavailable.
   *
   * @example
   * ```typescript
   * const sectionStyles = presentation.getCurrentSectionPageStyles();
   * console.log(`Section ${sectionStyles.sectionIndex}: ${sectionStyles.pageSize.width}" x ${sectionStyles.pageSize.height}"`);
   * ```
   */
  getCurrentSectionPageStyles(): {
    pageSize: { width: number; height: number };
    pageMargins: { left: number; right: number; top: number; bottom: number };
    sectionIndex: number;
    orientation: 'portrait' | 'landscape';
  } {
    return getCurrentSectionPageStylesFromHelper(
      this.#layoutState.layout,
      this.#getCurrentPageIndex(),
      this.#editor.converter?.pageStyles ?? null,
    );
  }

  /**
   * Get current remote cursor states (normalized to absolute PM positions).
   * Returns an array of cursor states for all remote collaborators, excluding the local user.
   *
   * Exposes normalized awareness states for host consumption.
   * Hosts can use this to build custom presence UI (e.g., presence pills, sidebar lists).
   *
   * @returns Array of remote cursor states with PM positions and user metadata
   *
   * @example
   * ```typescript
   * const presentation = PresentationEditor.getInstance('doc-123');
   * const cursors = presentation.getRemoteCursors();
   * cursors.forEach(cursor => {
   *   console.log(`${cursor.user.name} at position ${cursor.head}`);
   * });
   * ```
   */
  getRemoteCursors(): RemoteCursorState[] {
    return Array.from(this.#remoteCursorManager?.state.values() ?? []);
  }

  /**
   * Adjust layout mode (vertical/book/horizontal) and rerender.
   *
   * Changes how pages are arranged visually:
   * - 'vertical': Pages stacked vertically (default)
   * - 'book': Two-page spread side-by-side
   * - 'horizontal': Pages arranged horizontally
   *
   * Note: Virtualization is automatically disabled for non-vertical modes.
   *
   * @param mode - The layout mode to set
   *
   * @example
   * ```typescript
   * presentation.setLayoutMode('book'); // Two-page spread
   * presentation.setLayoutMode('vertical'); // Back to single column
   * ```
   */
  setLayoutMode(mode: LayoutMode) {
    if (this.#isSemanticFlowMode()) {
      return;
    }
    if (!mode || this.#layoutOptions.layoutMode === mode) {
      return;
    }
    this.#layoutOptions.layoutMode = mode;
    if (mode !== 'vertical' && this.#layoutOptions.virtualization?.enabled) {
      this.#layoutOptions.virtualization = {
        ...this.#layoutOptions.virtualization,
        enabled: false,
      };
    }
    this.#painterAdapter.reset();
    this.#pageGeometryHelper = null;
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  /**
   * Toggle the SD-2454 "Show bookmarks" bracket indicators at runtime.
   *
   * When enabled, the pm-adapter emits visible gray `[` / `]` marker runs at
   * bookmarkStart / bookmarkEnd positions (mirroring Word's opt-in behavior).
   * Because markers are real characters that participate in text measurement
   * and line breaking, toggling invalidates the flow-block cache and triggers
   * a full re-layout.
   */
  setShowBookmarks(showBookmarks: boolean): void {
    const next = !!showBookmarks;
    if (this.#layoutOptions.showBookmarks === next) return;
    this.#layoutOptions.showBookmarks = next;
    this.#flowBlockCache?.clear();
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  setShowFormattingMarks(showFormattingMarks: boolean): void {
    const next = !!showFormattingMarks;
    if (this.#layoutOptions.showFormattingMarks === next) return;
    this.#layoutOptions.showFormattingMarks = next;
    this.#painterAdapter.setShowFormattingMarks(next);
    if (!this.#repaintCurrentLayout()) {
      this.#pendingDocChange = true;
      this.#scheduleRerender();
    }
  }

  #repaintCurrentLayout(): boolean {
    const layout = this.#layoutState.layout;
    if (!layout) return false;

    const blocks = this.#layoutLookupBlocks.length > 0 ? this.#layoutLookupBlocks : this.#layoutState.blocks;
    const measures = this.#layoutLookupMeasures.length > 0 ? this.#layoutLookupMeasures : this.#layoutState.measures;
    if (blocks.length === 0 || blocks.length !== measures.length) return false;

    const resolvedLayout = resolveLayout({
      layout,
      flowMode: this.#layoutOptions.flowMode ?? 'paginated',
      blocks,
      measures,
      fontSignature: this.#layoutFontSignature,
      bookmarks: this.#layoutState.bookmarks,
    });

    const isSemanticFlow = this.#layoutOptions.flowMode === 'semantic';
    this.#ensurePainter();
    if (!isSemanticFlow) {
      this.#painterAdapter.setProviders(
        this.#headerFooterSession?.headerDecorationProvider,
        this.#headerFooterSession?.footerDecorationProvider,
      );
    }

    this.#domIndexObserverManager?.pause();
    try {
      this.#painterAdapter.paint({ resolvedLayout }, this.#painterHost);
      this.#refreshEditorDomAugmentations();
    } finally {
      this.#domIndexObserverManager?.resume();
    }
    this.#revalidateScrollContainer();
    this.#updatePermissionOverlay();
    this.#applyZoom();
    return true;
  }

  /**
   * Convert a viewport coordinate into a document hit using the current layout.
   */
  hitTest(clientX: number, clientY: number): PositionHit | null {
    const normalized = this.#normalizeClientPoint(clientX, clientY);
    if (!normalized) {
      return null;
    }

    const noteContext = this.#buildActiveNoteLayoutContext();
    if (noteContext) {
      const geometryHit = clickToPositionGeometry(
        this.#layoutState.layout,
        noteContext.blocks,
        noteContext.measures,
        normalized,
        {
          geometryHelper: this.#pageGeometryHelper ?? undefined,
        },
      );
      const domHit = this.#resolveNoteDomHit(noteContext, clientX, clientY);
      this.#recordNoteHitDebug({
        clientX,
        clientY,
        geometryPos: geometryHit?.pos ?? null,
        domPos: domHit?.pos ?? null,
      });
      // Active note sessions edit a separate hidden ProseMirror document. The
      // DOM bridge resolves the click against that live story editor, while the
      // geometry hit is still derived from the painted document surface. Once a
      // note has tracked inserts or other rendered-only runs, those coordinate
      // spaces can diverge. Prefer the hidden-editor DOM hit whenever it is
      // available and keep geometry as the fallback.
      const rawHit = domHit ?? geometryHit;
      if (!rawHit) {
        return null;
      }

      const doc = this.getActiveEditor().state?.doc;
      if (!doc) {
        return rawHit;
      }

      return {
        ...rawHit,
        pos: Math.max(0, Math.min(rawHit.pos, doc.content.size)),
      };
    }

    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionMode !== 'body') {
      const context = this.#getHeaderFooterContext();
      if (!context) {
        return null;
      }
      const pageGap = this.#layoutState.layout?.pageGap ?? this.#getEffectivePageGap();
      const bodyPageHeight = this.#getBodyPageHeight();
      const pageIndex = normalized.pageIndex ?? Math.max(0, Math.floor(normalized.y / (bodyPageHeight + pageGap)));
      if (pageIndex !== context.region.pageIndex) {
        return null;
      }
      const localX = normalized.x - context.region.localX;
      const pageLocalY = normalized.pageLocalY ?? normalized.y - context.region.pageIndex * (bodyPageHeight + pageGap);
      const localY = pageLocalY - context.region.localY;

      // Try DOM hit first — handles page-relative behindDoc fragments that are positioned
      // outside the H/F region's local coordinate band and would fail the bounds check.
      const domHit = this.#resolveHeaderFooterDomHit(context, clientX, clientY);
      if (domHit) {
        const doc = this.getActiveEditor().state?.doc;
        return {
          ...domHit,
          pos: doc ? Math.max(0, Math.min(domHit.pos, doc.content.size)) : domHit.pos,
        };
      }

      if (localX < 0 || localY < 0 || localX > context.region.width || localY > context.region.height) {
        return null;
      }
      const headerPoint = {
        x: localX,
        y: localY,
      };
      const geometryHit =
        clickToPositionGeometry(context.layout, context.blocks, context.measures, headerPoint) ?? null;
      const hit = geometryHit;
      if (!hit) {
        return null;
      }

      const doc = this.getActiveEditor().state?.doc;
      if (!doc) {
        return hit;
      }

      return {
        ...hit,
        pos: Math.max(0, Math.min(hit.pos, doc.content.size)),
      };
    }

    if (!this.#layoutState.layout) {
      return null;
    }
    const rawHit =
      resolvePointerPositionHit({
        layout: this.#layoutState.layout,
        blocks: this.#layoutState.blocks,
        measures: this.#layoutState.measures,
        containerPoint: normalized,
        domContainer: this.#viewportHost,
        clientX,
        clientY,
        geometryHelper: this.#pageGeometryHelper ?? undefined,
      }) ?? null;
    if (!rawHit) {
      return null;
    }

    const doc = this.#editor.state?.doc;
    if (!doc) {
      return rawHit;
    }

    const mapped = this.#epochMapper.mapPosFromLayoutToCurrentDetailed(rawHit.pos, rawHit.layoutEpoch, 1);
    if (!mapped.ok) {
      debugLog('warn', 'hitTest mapping failed', mapped);
      return null;
    }

    const clamped = Math.max(0, Math.min(mapped.pos, doc.content.size));
    return { ...rawHit, pos: clamped, layoutEpoch: mapped.toEpoch };
  }

  #updateSelectionDebugHud(): void {
    try {
      const activeEditor = this.getActiveEditor();
      const selection = activeEditor?.state?.selection
        ? { from: activeEditor.state.selection.from, to: activeEditor.state.selection.to }
        : null;
      updateSelectionDebugHud(this.#viewportHost, {
        docEpoch: this.#epochMapper.getCurrentEpoch(),
        layoutEpoch: this.#layoutEpoch,
        selection,
        lastPointer: this.#editorInputManager?.debugLastPointer ?? null,
        lastHit: this.#editorInputManager?.debugLastHit ?? null,
      });
    } catch {
      // Debug HUD should never break editor interaction paths
    }
  }

  #computePendingMarginClick(pointerId: number, x: number, y: number): PendingMarginClick | null {
    const layout = this.#layoutState.layout;
    const geometryHelper = this.#pageGeometryHelper;
    if (!layout || !geometryHelper) {
      return null;
    }

    const pageIndex = geometryHelper.getPageIndexAtY(y);
    if (pageIndex == null) {
      return null;
    }

    const page = layout.pages[pageIndex];
    if (!page) {
      return null;
    }

    const pageWidth = page.size?.w ?? layout.pageSize.w;
    if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
      return null;
    }
    if (!Number.isFinite(x) || x < 0 || x > pageWidth) {
      return null;
    }

    const margins = page.margins ?? this.#layoutOptions.margins ?? DEFAULT_MARGINS;
    const marginLeft = Number.isFinite(margins.left) ? (margins.left as number) : (DEFAULT_MARGINS.left ?? 0);
    const marginRight = Number.isFinite(margins.right) ? (margins.right as number) : (DEFAULT_MARGINS.right ?? 0);

    const isLeftMargin = marginLeft > 0 && x < marginLeft;
    const isRightMargin = marginRight > 0 && x > pageWidth - marginRight;

    const pageEl = getPageElementByIndex(this.#viewportHost, pageIndex);
    if (!pageEl) {
      return null;
    }

    const pageTop = geometryHelper.getPageTop(pageIndex);
    const localY = y - pageTop;
    if (!Number.isFinite(localY)) {
      return null;
    }

    const zoom = this.#layoutOptions.zoom ?? 1;
    const pageRect = pageEl.getBoundingClientRect();

    type LineCandidate = {
      pmStart: number;
      pmEnd: number;
      layoutEpoch: number;
      top: number;
      bottom: number;
    };

    const candidates: LineCandidate[] = [];
    const lineEls = Array.from(pageEl.querySelectorAll('.superdoc-line')) as HTMLElement[];
    for (const lineEl of lineEls) {
      if (lineEl.closest('.superdoc-page-header, .superdoc-page-footer')) {
        continue;
      }
      const pmStart = Number(lineEl.dataset.pmStart ?? 'NaN');
      const pmEnd = Number(lineEl.dataset.pmEnd ?? 'NaN');
      if (!Number.isFinite(pmStart) || !Number.isFinite(pmEnd)) {
        continue;
      }
      const rect = lineEl.getBoundingClientRect();
      const top = (rect.top - pageRect.top) / zoom;
      const bottom = (rect.bottom - pageRect.top) / zoom;
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
        continue;
      }
      const lineEpochRaw = lineEl.dataset.layoutEpoch;
      const pageEpochRaw = pageEl.dataset.layoutEpoch;
      const lineEpoch = lineEpochRaw != null ? Number(lineEpochRaw) : NaN;
      const pageEpoch = pageEpochRaw != null ? Number(pageEpochRaw) : NaN;
      const layoutEpoch =
        Number.isFinite(lineEpoch) && Number.isFinite(pageEpoch)
          ? Math.max(lineEpoch, pageEpoch)
          : Number.isFinite(lineEpoch)
            ? lineEpoch
            : Number.isFinite(pageEpoch)
              ? pageEpoch
              : 0;
      candidates.push({
        pmStart,
        pmEnd,
        layoutEpoch: Number.isFinite(layoutEpoch) ? layoutEpoch : 0,
        top,
        bottom,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    const firstBodyLineTop = Math.min(...candidates.map((c) => c.top));
    if (pageIndex === 0 && Number.isFinite(firstBodyLineTop) && localY < firstBodyLineTop) {
      return { pointerId, kind: 'aboveFirstLine' };
    }

    if (!isLeftMargin && !isRightMargin) {
      return null;
    }

    let best: LineCandidate | null = null;
    for (const c of candidates) {
      if (localY >= c.top && localY <= c.bottom) {
        best = c;
        break;
      }
    }
    if (!best) {
      let bestDistance = Infinity;
      for (const c of candidates) {
        const center = (c.top + c.bottom) / 2;
        const distance = Math.abs(localY - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
    }
    if (!best) {
      return null;
    }

    return {
      pointerId,
      kind: isLeftMargin ? 'left' : 'right',
      layoutEpoch: best.layoutEpoch,
      pmStart: best.pmStart,
      pmEnd: best.pmEnd,
    };
  }

  /**
   * Normalize viewport coordinates (clientX/clientY) into layout space while respecting zoom + scroll.
   */
  normalizeClientPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    return this.#normalizeClientPoint(clientX, clientY);
  }

  /**
   * Get viewport coordinates for a document position (header/footer-aware).
   *
   * This method provides coordinate mapping that respects the current editing mode:
   * - In body mode, uses the main document layout
   * - In header/footer mode, maps positions within the header/footer layout and transforms
   *   coordinates to viewport space
   *
   * @param pos - Document position in the active editor
   * @returns Coordinate rectangle with top, bottom, left, right, width, height in viewport pixels,
   *          or null if the position cannot be mapped
   *
   * @example
   * ```typescript
   * const coords = presentationEditor.coordsAtPos(42);
   * if (coords) {
   *   console.log(`Position 42 is at viewport coordinates (${coords.left}, ${coords.top})`);
   * }
   * ```
   */
  coordsAtPos(
    pos: number,
  ): { top: number; bottom: number; left: number; right: number; width: number; height: number } | null {
    if (!Number.isFinite(pos)) {
      console.warn('[PresentationEditor] coordsAtPos called with invalid position:', pos);
      return null;
    }

    // In header/footer mode, use header/footer layout coordinates
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionMode !== 'body') {
      const context = this.#getHeaderFooterContext();
      if (!context) {
        console.warn('[PresentationEditor] Header/footer context not available for coordsAtPos');
        return null;
      }

      // Get selection rects from the header/footer layout (already transformed to viewport)
      const rects = this.#computeHeaderFooterSelectionRects(pos, pos);
      let rect = rects?.[0] ?? null;
      if (!rect) {
        rect = this.#computeHeaderFooterCaretRect(pos);
      }
      if (!rect) {
        return null;
      }

      const zoom = this.#layoutOptions.zoom ?? 1;
      const containerRect = this.#visibleHost.getBoundingClientRect();
      const scrollLeft = this.#visibleHost.scrollLeft ?? 0;
      const scrollTop = this.#visibleHost.scrollTop ?? 0;
      const pageHeight = this.#getBodyPageHeight();
      const pageGap = this.#layoutState.layout?.pageGap ?? 0;
      const pageLocalY = rect.y - rect.pageIndex * (pageHeight + pageGap);
      const coords = this.#convertPageLocalToOverlayCoords(rect.pageIndex, rect.x, pageLocalY);
      if (!coords) return null;

      return {
        top: coords.y * zoom - scrollTop + containerRect.top,
        bottom: coords.y * zoom - scrollTop + containerRect.top + rect.height * zoom,
        left: coords.x * zoom - scrollLeft + containerRect.left,
        right: coords.x * zoom - scrollLeft + containerRect.left + rect.width * zoom,
        width: rect.width * zoom,
        height: rect.height * zoom,
      };
    }

    if (this.#getActiveNoteStorySession()) {
      const rects = this.#computeNoteSelectionRects(pos, pos) ?? [];
      let rect = rects?.[0] ?? null;
      if (!rect) {
        rect = this.#computeNoteCaretRect(pos);
      }
      if (!rect) {
        return null;
      }

      const zoom = this.#layoutOptions.zoom ?? 1;
      const containerRect = this.#visibleHost.getBoundingClientRect();
      const scrollLeft = this.#visibleHost.scrollLeft ?? 0;
      const scrollTop = this.#visibleHost.scrollTop ?? 0;
      const pageHeight = this.#getBodyPageHeight();
      const pageGap = this.#layoutState.layout?.pageGap ?? 0;
      const pageLocalY = rect.y - rect.pageIndex * (pageHeight + pageGap);
      const coords = this.#convertPageLocalToOverlayCoords(rect.pageIndex, rect.x, pageLocalY);
      if (!coords) return null;

      return {
        top: coords.y * zoom - scrollTop + containerRect.top,
        bottom: coords.y * zoom - scrollTop + containerRect.top + rect.height * zoom,
        left: coords.x * zoom - scrollLeft + containerRect.left,
        right: coords.x * zoom - scrollLeft + containerRect.left + Math.max(1, rect.width) * zoom,
        width: Math.max(1, rect.width) * zoom,
        height: rect.height * zoom,
      };
    }

    // In body mode, use main document layout
    const rects = this.getRangeRects(pos, pos);
    if (rects && rects.length > 0) {
      const rect = rects[0];
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    }

    // Fallback: getRangeRects returns empty for collapsed selections on empty
    // lines (no painted inline content to measure). Use caret geometry which
    // combines DOM position data with layout metrics for these cases.
    const caretRect = this.#computeCaretLayoutRect(pos);
    if (caretRect) {
      // caretRect is in page-local layout units; convert to viewport pixels.
      const viewport = this.denormalizeClientPoint(caretRect.x, caretRect.y, caretRect.pageIndex, caretRect.height);
      if (viewport) {
        const h = viewport.height ?? caretRect.height;
        return {
          top: viewport.y,
          bottom: viewport.y + h,
          left: viewport.x,
          right: viewport.x + 1, // caret is zero-width; use 1px so callers get a valid rect
          width: 1,
          height: h,
        };
      }
    }

    return null;
  }

  /**
   * Get the painted DOM element that contains a document position (body only).
   *
   * Uses the DomPositionIndex which maps data-pm-start/end attributes to rendered
   * elements. Returns null when the position is not currently mounted (virtualization)
   * or when in header/footer mode.
   *
   * @param pos - Document position in the active editor
   * @param options.forceRebuild - Rebuild the index before lookup
   * @param options.fallbackToCoords - Use elementFromPoint with layout rects if index lookup fails
   * @returns The nearest painted DOM element for the position, or null if unavailable
   */
  getElementAtPos(
    pos: number,
    options: { forceRebuild?: boolean; fallbackToCoords?: boolean } = {},
  ): HTMLElement | null {
    if (!Number.isFinite(pos)) return null;
    if (!this.#painterHost) return null;
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionMode !== 'body') return null;

    if (options.forceRebuild || this.#domPositionIndex.size === 0) {
      this.#rebuildDomPositionIndex();
    }

    const indexed = this.#domPositionIndex.findElementAtPosition(pos);
    if (indexed) return indexed;

    if (!options.fallbackToCoords) return null;
    const rects = this.getRangeRects(pos, pos);
    if (!rects.length) return null;

    const doc = this.#visibleHost.ownerDocument ?? document;
    for (const rect of rects) {
      const el = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (el instanceof HTMLElement && this.#painterHost.contains(el)) {
        return (el.closest('[data-pm-start][data-pm-end]') as HTMLElement | null) ?? el;
      }
    }

    return null;
  }

  /**
   * Whether an element is fully within the vertical bounds of the active scroll container.
   * Used by scrollToPosition's `ifNeeded` mode (SD-3315) to avoid moving the viewport for a
   * target that is already visible. Measures with getBoundingClientRect because inline match
   * spans report clientHeight 0. Vertical-only: search navigation is a block-axis concern.
   */
  #isElementFullyVisibleInScrollContainer(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    const viewport =
      this.#scrollContainer instanceof Window
        ? { top: 0, bottom: this.#scrollContainer.innerHeight }
        : this.#scrollContainer instanceof Element
          ? this.#scrollContainer.getBoundingClientRect()
          : this.#visibleHost?.ownerDocument?.defaultView
            ? { top: 0, bottom: this.#visibleHost.ownerDocument.defaultView.innerHeight }
            : null;
    if (!viewport) return false;
    return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
  }

  /**
   * Scroll the visible host so a given document position is brought into view.
   *
   * This is primarily used by commands like search navigation when running in
   * PresentationEditor mode, where ProseMirror's `scrollIntoView()` operates on the
   * hidden editor and does not affect the rendered viewport.
   *
   * @param pos - Document position in the active editor to scroll to
   * @param options - Scrolling options
   * @param options.block - Alignment within the viewport ('start' | 'center' | 'end' | 'nearest')
   * @param options.behavior - Scroll behavior ('auto' | 'smooth')
   * @param options.ifNeeded - When true, skip movement if the target is already fully visible
   *   (downgrades to 'nearest'); off-screen targets still use `block`. Used by search navigation.
   * @param options.suppressSelectionSyncScroll - When true, selection-sync auto-scroll is
   *   suppressed until this scroll's RAF re-assert runs, so it cannot fight this intentional
   *   scroll. Used by search navigation, whose find-input focus restore otherwise scrolls the
   *   viewport to a reverted/stale caret.
   * @returns True if the position could be mapped and scrolling was applied
   */
  scrollToPosition(
    pos: number,
    options: {
      block?: 'start' | 'center' | 'end' | 'nearest';
      behavior?: ScrollBehavior;
      ifNeeded?: boolean;
      suppressSelectionSyncScroll?: boolean;
    } = {},
  ): boolean {
    // Cancel any pending focus-scroll RAF so this intentional scroll is not undone
    // by the wrapOffscreenEditorFocus safety net (e.g. search navigation after focus).
    if (this.#focusScrollRafId != null) {
      const win = this.#visibleHost.ownerDocument?.defaultView;
      if (win) win.cancelAnimationFrame(this.#focusScrollRafId);
      this.#focusScrollRafId = null;
    }

    const activeEditor = this.getActiveEditor();
    const doc = activeEditor?.state?.doc;
    if (!doc) return false;
    if (!Number.isFinite(pos)) return false;

    const clampedPos = Math.max(0, Math.min(pos, doc.content.size));

    const behavior = options.behavior ?? 'auto';
    // SD-3315: the caller's requested landing. In ifNeeded mode an already-visible match
    // downgrades this to 'nearest' (computed per-target below) so it does not re-center.
    const requestedBlock = options.block ?? 'center';

    // Use a DOM marker + scrollIntoView so the browser finds the correct scroll container
    // (window, parent overflow container, etc.) without us guessing.
    const layout = this.#layoutState.layout;
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';

    if (layout && sessionMode === 'body') {
      let pageIndex: number | null = null;
      for (let idx = 0; idx < layout.pages.length; idx++) {
        const page = layout.pages[idx];
        for (const fragment of page.fragments) {
          const frag = fragment as { pmStart?: number; pmEnd?: number };
          if (frag.pmStart != null && frag.pmEnd != null && clampedPos >= frag.pmStart && clampedPos <= frag.pmEnd) {
            pageIndex = idx;
            break;
          }
        }
        if (pageIndex != null) break;
      }

      if (pageIndex != null) {
        const pageEl = getPageElementByIndex(this.#viewportHost, pageIndex);
        if (pageEl) {
          // Find the specific element containing this position for precise centering
          const targetEl = this.#findElementAtPosition(pageEl, clampedPos);
          const elToScroll = targetEl ?? pageEl;

          // SD-3315: "scroll only if needed" mode for search navigation. When the caller
          // opts in and we resolved the precise target element (the match span, not the
          // page-div fallback), and that element is already fully inside the scroll
          // container, downgrade the scroll to 'nearest' — a no-op for a fully-visible
          // element — so next/previous does not re-center an already-visible match (the
          // ~50px jump). We deliberately do NOT early-return: the scrollIntoView + RAF
          // re-assert below also override the hidden editor's selection-sync scroll
          // (dispatched .scrollIntoView()), which otherwise jumps the viewport to the
          // hidden editor's geometry. A null targetEl (page fallback) or an off-screen /
          // partially-clipped match keeps the requested block (center).
          const block =
            options.ifNeeded && targetEl && this.#isElementFullyVisibleInScrollContainer(targetEl)
              ? 'nearest'
              : requestedBlock;
          this.#startSelectionNavigation(clampedPos);
          elToScroll.scrollIntoView({ block, inline: 'nearest', behavior });
          // AIDEV-NOTE: SD-3045. Search nav (and any other caller of
          // scrollToPosition) places the viewport intentionally — usually
          // centring the match. The next #updateSelection that runs as part
          // of the dispatched setSelection transaction would otherwise call
          // #scrollActiveEndIntoView and re-scroll the caret to its minimal
          // visible position (often the top of the viewport), undoing our
          // centring. Consume the pending scroll-into-view request so that
          // selection sync renders the caret overlay without moving the
          // scroll back. Other selection updates (Shift+Arrow, typing) re-set
          // this flag themselves before they need scroll, so this consume is
          // safe.
          this.#shouldScrollSelectionIntoView = false;
          // Re-assert the scroll on the next animation frame. The flag we
          // cleared above defends against handleSelection that has already
          // run, but a *later* selectionUpdate (e.g. focus blur fired when
          // the user moves focus back to the find input) re-sets the flag to
          // true before the RAF-scheduled #updateSelection fires, and that
          // pass scrolls the caret to its minimal-visibility position —
          // visibly snapping the match out of view. Re-running scrollIntoView
          // on the same element a frame later overrides that snap; the no-op
          // case (no late scroll happened) just re-centres the same element
          // and is cheap.
          const win = this.#visibleHost.ownerDocument?.defaultView;
          if (win) {
            // SD-3315: own the scroll until the RAF re-assert. The find-input focus restore fires
            // a selectionUpdate that reverts the editor selection and would selection-sync-scroll
            // the viewport to that stale caret before this RAF runs. Suppress that here and
            // release after re-asserting, so normal selection scroll resumes next frame. Paired
            // with the RAF below (set inside `if (win)` so it is always cleared).
            if (options.suppressSelectionSyncScroll) this.#suppressSelectionScrollUntilRaf = true;
            win.requestAnimationFrame(() => {
              elToScroll.scrollIntoView({ block, inline: 'nearest', behavior });
              this.#shouldScrollSelectionIntoView = false;
              this.#suppressSelectionScrollUntilRaf = false;
              this.#scheduleSelectionUpdateAfterScrollSettles();
            });
          }
          return true;
        }
      }

      return false;
    } else {
      return false;
    }
  }

  /**
   * Return the viewport Y coordinate this thread anchor can actually reach after
   * scroll bounds clamp the requested target.
   *
   * @param threadId - Comment or tracked-change identifier
   * @param targetClientY - Desired top position in client/viewport coordinates
   * @returns The reachable client Y, or null when the thread cannot be resolved
   */
  getReachableThreadAnchorClientY(threadId: string, targetClientY: number): number | null {
    return this.#buildThreadAnchorScrollPlan(threadId, targetClientY)?.achievedClientY ?? null;
  }

  /**
   * Scroll a comment or tracked-change anchor so its top edge lands at the
   * requested viewport Y coordinate.
   *
   * @param threadId - Comment or tracked-change identifier
   * @param targetClientY - Desired top position in client/viewport coordinates
   * @param options - Scrolling options
   * @param options.behavior - Scroll behavior ('auto' | 'smooth')
   * @returns True when the thread could be resolved and scrolling was applied
   */
  scrollThreadAnchorToClientY(
    threadId: string,
    targetClientY: number,
    options: { behavior?: ScrollBehavior } = {},
  ): boolean {
    const scrollPlan = this.#buildThreadAnchorScrollPlan(threadId, targetClientY);
    if (!scrollPlan) return false;

    const behavior = options.behavior ?? 'auto';
    scrollPlan.applyScroll(behavior);
    return true;
  }

  #buildThreadAnchorScrollPlan(threadId: string, targetClientY: number): ThreadAnchorScrollPlan | null {
    if (!threadId || !Number.isFinite(targetClientY)) return null;

    const threadPosition = this.#resolveCommentPositionEntry(threadId);
    if (!threadPosition) return null;

    const boundedEntry = (this.getCommentBounds({ [threadId]: threadPosition })[threadId] ??
      threadPosition) as BoundedCommentPositionEntry;
    const currentTopValue =
      typeof boundedEntry.bounds === 'object' && boundedEntry.bounds != null
        ? (boundedEntry.bounds as { top?: unknown }).top
        : undefined;
    if (!Number.isFinite(currentTopValue)) return null;
    const currentTop = Number(currentTopValue);

    const requestedScrollDelta = currentTop - targetClientY;
    const scrollTarget = this.#scrollContainer ?? this.#visibleHost;

    if (scrollTarget instanceof Window) {
      return this.#buildWindowThreadAnchorScrollPlan(scrollTarget, currentTop, requestedScrollDelta);
    }

    if (scrollTarget instanceof HTMLElement) {
      return this.#buildElementThreadAnchorScrollPlan(scrollTarget, currentTop, requestedScrollDelta);
    }

    return null;
  }

  #resolveCommentPositionEntry(threadId: string): BoundedCommentPositionEntry | null {
    const positions = this.#collectCommentPositions();
    const directMatch = positions[threadId];
    if (directMatch) {
      return directMatch;
    }

    return Object.values(positions).find((entry) => entry?.key === threadId || entry?.threadId === threadId) ?? null;
  }

  #buildWindowThreadAnchorScrollPlan(
    scrollTarget: Window,
    currentTop: number,
    requestedScrollDelta: number,
  ): ThreadAnchorScrollPlan {
    const scrollRoot =
      scrollTarget.document.scrollingElement ??
      scrollTarget.document.documentElement ??
      scrollTarget.document.body ??
      null;
    const currentScrollTop = scrollTarget.scrollY ?? scrollTarget.pageYOffset ?? scrollRoot?.scrollTop ?? 0;
    const viewportHeight = scrollTarget.innerHeight ?? scrollRoot?.clientHeight ?? 0;
    const maxScrollTop = Math.max(0, (scrollRoot?.scrollHeight ?? 0) - viewportHeight);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, currentScrollTop + requestedScrollDelta));
    const appliedScrollDelta = nextScrollTop - currentScrollTop;

    return {
      achievedClientY: currentTop - appliedScrollDelta,
      applyScroll: (behavior) => {
        if (Math.abs(appliedScrollDelta) < 1) return;
        scrollTarget.scrollTo({ top: nextScrollTop, behavior });
      },
    };
  }

  #buildElementThreadAnchorScrollPlan(
    scrollTarget: HTMLElement,
    currentTop: number,
    requestedScrollDelta: number,
  ): ThreadAnchorScrollPlan {
    const currentScrollTop = scrollTarget.scrollTop;
    const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, currentScrollTop + requestedScrollDelta));
    const appliedScrollDelta = nextScrollTop - currentScrollTop;

    return {
      achievedClientY: currentTop - appliedScrollDelta,
      applyScroll: (behavior) => {
        if (Math.abs(appliedScrollDelta) < 1) return;
        scrollTarget.scrollTo({ top: nextScrollTop, behavior });
      },
    };
  }

  #startSelectionNavigation(targetPos: number): number {
    const token = ++this.#selectionNavigationToken;
    this.#activeSelectionNavigation = { token, targetPos, scrollSettled: false, repairAttempts: 0 };
    return token;
  }

  #markSelectionNavigationScrollSettled(): void {
    if (this.#activeSelectionNavigation) {
      this.#activeSelectionNavigation.scrollSettled = true;
    }
  }

  #finishSelectionNavigation(token?: number): void {
    if (token != null && this.#activeSelectionNavigation?.token !== token) return;
    this.#activeSelectionNavigation = null;
  }

  /**
   * Programmatic navigation currently scrolls browser-owned document content
   * while the caret/selection overlay is painted in a separate presentation
   * layer. That means scroll position and overlay geometry can briefly disagree,
   * especially while smooth scroll, page mounting, or layout refresh settles.
   *
   * This repair path keeps the navigated caret visually aligned with the
   * scrolled content. The cleaner long-term architecture is to paint the caret
   * in the same browser-scrolled layer as the document content, so scrolling
   * moves both together without post-scroll synchronization.
   */
  #scheduleNavigatedSelectionRender(targetPos: number): void {
    this.#startSelectionNavigation(targetPos);
    this.#scheduleSelectionUpdateAfterScrollSettles();
    this.#scheduleSelectionUpdate({ immediate: true });
    this.#scheduleNavigatedCaretViewportRepairs(targetPos);
  }

  #scheduleNavigatedCaretViewportRepairs(targetPos: number): void {
    const win = this.#visibleHost.ownerDocument?.defaultView;
    if (!win) return;

    for (const delay of NAVIGATED_CARET_REPAIR_DELAYS_MS) {
      win.setTimeout(() => {
        if (!this.#localSelectionLayer?.isConnected) return;
        const selection = this.getActiveEditor()?.state?.selection;
        if (!selection || selection.from !== targetPos || selection.to !== targetPos) return;
        this.#rebuildDomPositionIndex();
        this.#renderNavigatedCaretFromViewportCoords(targetPos);
      }, delay);
    }
  }

  #queueSelectionNavigationCaretRepair(
    caretPos: number,
    navigation: { token: number; repairAttempts: number },
  ): boolean {
    if (this.#activeSelectionNavigation?.token !== navigation.token) return false;

    const caretEl = this.#localSelectionLayer.querySelector('.presentation-editor__selection-caret');
    if (!(caretEl instanceof HTMLElement)) return false;

    const expected = this.coordsAtPos(caretPos);
    if (!expected) return false;

    const actual = caretEl.getBoundingClientRect();
    if (Math.abs(actual.top - expected.top) <= NAVIGATED_CARET_DRIFT_TOLERANCE_PX) return false;
    if (navigation.repairAttempts >= NAVIGATED_CARET_MAX_REPAIR_ATTEMPTS) return false;

    navigation.repairAttempts += 1;
    const win = this.#visibleHost.ownerDocument?.defaultView;
    const repair = () => {
      if (this.#activeSelectionNavigation?.token !== navigation.token) return;
      this.#rebuildDomPositionIndex();
      this.#scheduleSelectionUpdate({ immediate: true });
    };
    if (win) {
      win.requestAnimationFrame(repair);
    } else {
      repair();
    }
    return true;
  }

  #renderNavigatedCaretFromViewportCoords(caretPos: number): boolean {
    const coords = this.coordsAtPos(caretPos);
    if (!coords) return false;

    const zoom =
      Number.isFinite(this.#layoutOptions.zoom) && this.#layoutOptions.zoom > 0 ? this.#layoutOptions.zoom : 1;
    const layerRect = this.#localSelectionLayer.getBoundingClientRect();
    const caretEl = createCaretElement(this.#localSelectionLayer.ownerDocument, {
      left: (coords.left - layerRect.left) / zoom,
      top: (coords.top - layerRect.top) / zoom,
      height: coords.height / zoom,
    });
    if (!caretEl) return false;

    this.#localSelectionLayer.innerHTML = '';
    this.#localSelectionLayer.appendChild(caretEl);
    return true;
  }

  #scheduleSelectionUpdateAfterScrollSettles(): void {
    const win = this.#visibleHost.ownerDocument?.defaultView;
    if (!win) {
      this.#scheduleSelectionUpdate();
      return;
    }

    this.#selectionScrollSettleCleanup?.();

    const scrollTarget =
      this.#scrollContainer instanceof Window || this.#scrollContainer instanceof Element ? this.#scrollContainer : win;
    let timeoutId: number | null = null;
    let finalTimeoutId: number | null = null;
    let scrollRenderRafId: number | null = null;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      scrollTarget.removeEventListener('scroll', onScroll);
      scrollTarget.removeEventListener('scrollend', finalizeRender);
      if (timeoutId != null) {
        win.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (finalTimeoutId != null) {
        win.clearTimeout(finalTimeoutId);
        finalTimeoutId = null;
      }
      if (scrollRenderRafId != null) {
        win.cancelAnimationFrame(scrollRenderRafId);
        scrollRenderRafId = null;
      }
      if (this.#selectionScrollSettleCleanup === cleanup) {
        this.#selectionScrollSettleCleanup = null;
      }
    };

    const renderAfterPause = () => {
      timeoutId = null;
      this.#scheduleSelectionUpdate({ immediate: true });
    };

    const finalizeRender = () => {
      if (cleanedUp) return;
      this.#markSelectionNavigationScrollSettled();
      cleanup();
      this.#scheduleSelectionUpdate({ immediate: true });
    };

    const queueRender = () => {
      if (timeoutId != null) win.clearTimeout(timeoutId);
      timeoutId = win.setTimeout(renderAfterPause, SELECTION_SCROLL_SETTLE_RENDER_DELAY_MS);
    };

    const queueFinalize = () => {
      if (finalTimeoutId != null) win.clearTimeout(finalTimeoutId);
      finalTimeoutId = win.setTimeout(finalizeRender, SELECTION_SCROLL_SETTLE_FINALIZE_DELAY_MS);
    };

    const requestScrollRender = () => {
      if (scrollRenderRafId != null) return;
      scrollRenderRafId = win.requestAnimationFrame(() => {
        scrollRenderRafId = null;
        this.#scheduleSelectionUpdate({ immediate: true });
      });
    };

    const onScroll = () => {
      requestScrollRender();
      queueRender();
      queueFinalize();
    };

    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    scrollTarget.addEventListener('scrollend', finalizeRender, { passive: true });
    this.#selectionScrollSettleCleanup = cleanup;
    queueRender();
    queueFinalize();
  }

  /**
   * Find the DOM element containing a specific document position.
   * Returns the most specific (smallest range) matching element.
   */
  #findElementAtPosition(pageEl: HTMLElement, pos: number): HTMLElement | null {
    const elements = Array.from(pageEl.querySelectorAll('[data-pm-start][data-pm-end]'));
    let bestMatch: HTMLElement | null = null;
    let smallestRange = Infinity;

    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      // Skip header/footer fragments — their PM positions come from a separate
      // document and can overlap with body positions, causing incorrect matches.
      if (htmlEl.closest('.superdoc-page-header, .superdoc-page-footer')) continue;

      const start = Number(htmlEl.dataset.pmStart);
      const end = Number(htmlEl.dataset.pmEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      if (pos >= start && pos <= end) {
        const range = end - start;
        if (range < smallestRange) {
          smallestRange = range;
          bestMatch = htmlEl;
        }
      }
    }
    return bestMatch;
  }

  /**
   * Async version of scrollToPosition that handles virtualized pages.
   *
   * When pages are virtualized (not mounted in the DOM), this method will:
   * 1. Try the sync scroll first (fast path if page is already mounted)
   * 2. If that fails, trigger virtualization to render the target page
   * 3. Wait for the page to mount (up to 2000ms)
   * 4. Retry the scroll
   *
   * Use this method when navigating to positions that may be on virtualized pages.
   *
   * @param pos - Document position in the active editor to scroll to
   * @param options - Scrolling options
   * @param options.block - Alignment within the viewport ('start' | 'center' | 'end' | 'nearest')
   * @param options.behavior - Scroll behavior ('auto' | 'smooth')
   * @param options.ifNeeded - When true, skip movement if the target is already fully visible
   *   (downgrades to 'nearest'); off-screen targets still use `block`. Used by search navigation.
   * @param options.suppressSelectionSyncScroll - Forwarded to scrollToPosition; see there.
   * @returns Promise resolving to true if scrolling succeeded, false otherwise
   */
  async scrollToPositionAsync(
    pos: number,
    options: {
      block?: 'start' | 'center' | 'end' | 'nearest';
      behavior?: ScrollBehavior;
      ifNeeded?: boolean;
      suppressSelectionSyncScroll?: boolean;
      shouldContinue?: () => boolean;
    } = {},
  ): Promise<boolean> {
    if (!shouldContinueNavigation(options)) return false;

    // Fast path: try sync scroll first (works if page already mounted)
    if (this.scrollToPosition(pos, options)) {
      return true;
    }

    // Page not mounted - find which page contains this position
    const activeEditor = this.getActiveEditor();
    const doc = activeEditor?.state?.doc;
    if (!doc || !Number.isFinite(pos)) return false;

    const clampedPos = Math.max(0, Math.min(pos, doc.content.size));
    const layout = this.#layoutState.layout;
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (!layout || sessionMode !== 'body') return false;

    let pageIndex: number | null = null;
    for (let idx = 0; idx < layout.pages.length; idx++) {
      const page = layout.pages[idx];
      for (const fragment of page.fragments) {
        const frag = fragment as { pmStart?: number; pmEnd?: number };
        if (frag.pmStart != null && frag.pmEnd != null && clampedPos >= frag.pmStart && clampedPos <= frag.pmEnd) {
          pageIndex = idx;
          break;
        }
      }
      if (pageIndex != null) break;
    }
    if (pageIndex == null) return false;

    if (!shouldContinueNavigation(options)) return false;

    // Trigger virtualization to render the page
    this.#scrollPageIntoView(pageIndex);

    // Wait for page to mount in the DOM
    const mounted = await this.#waitForPageMount(pageIndex, {
      timeout: PresentationEditor.ANCHOR_NAV_TIMEOUT_MS,
    });
    if (!mounted) {
      console.warn(`[PresentationEditor] scrollToPositionAsync: Page ${pageIndex} failed to mount within timeout`);
      return false;
    }

    if (!shouldContinueNavigation(options)) return false;

    // Retry now that page is mounted. Reaching this path means the target was on an unmounted
    // (off-screen) page at call time, and #scrollPageIntoView above only scrolled the page into
    // view — not the specific match, which can now sit at a viewport edge. Force ifNeeded:false so
    // the match centers, instead of letting the now-edge-visible match downgrade to 'nearest' and
    // skip centering (SD-3315 review). suppressSelectionSyncScroll is preserved via the spread.
    return this.scrollToPosition(pos, { ...options, ifNeeded: false });
  }

  /**
   * Scroll a content control (SDT field/clause) into view by its id.
   *
   * Model-aware: the control's position is resolved from the document
   * model, not the painted DOM, so this works even when the control sits
   * on a not-yet-rendered (virtualized) page — `scrollToPositionAsync`
   * mounts the page first, then scrolls. This is why it cannot reuse the
   * paint-only `getEntityRects` rect path.
   *
   * Scroll-only: it does NOT move the selection or place the caret inside
   * the control. Focusing/activating a control is a separate concern.
   *
   * v1 is body-only: it searches the body editor, and `scrollToPositionAsync`
   * only scrolls in body mode, so a control inside a header/footer/note
   * story does not resolve and returns `false`.
   *
   * @returns `true` once scrolled; `false` when the id is empty/unknown,
   *   the control is in a non-body story, or no editor is available.
   */
  async scrollContentControlIntoView(
    entityId: string,
    options: { block?: 'start' | 'center' | 'end' | 'nearest'; behavior?: ScrollBehavior } = {},
  ): Promise<boolean> {
    const pos = this.#resolveContentControlCaretPos(entityId);
    if (pos == null) return false;
    return this.scrollToPositionAsync(pos, {
      behavior: options.behavior ?? 'smooth',
      block: options.block ?? 'center',
    });
  }

  /**
   * Resolve a caret position inside the content control with `entityId`, or
   * `null` when no such control exists in the body document.
   *
   * Prefers the first *text* position inside the control: only text positions
   * reliably map to a layout fragment; wrapper boundaries (block, paragraph,
   * run) sit between fragments. A deep `descendants` walk handles inline
   * (`run > text`) and block (`paragraph > run > text`) nesting uniformly
   * (`descendants` yields each child's position relative to the node's
   * content, so the absolute position is `found.pos + 1 + rel`). An empty
   * control with no text falls back to the first inside position.
   *
   * The id is normalized to a string before comparing: the id a consumer
   * passes comes from the list / painted `data-sdt-id` (always a string), but
   * the PM attr can be numeric, so a strict `===` would miss it.
   */
  #resolveContentControlCaretPos(entityId: string): number | null {
    const editor = this.#editor;
    if (!editor || typeof entityId !== 'string' || entityId.length === 0) return null;

    let found: { pos: number; node: ReturnType<typeof editor.state.doc.nodeAt> } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      const name = node.type?.name;
      if ((name === 'structuredContent' || name === 'structuredContentBlock') && String(node.attrs?.id) === entityId) {
        found = { pos, node };
        return false;
      }
      return true;
    });
    if (!found) return null;

    let contentPos = found.pos + 1;
    let textFound = false;
    found.node?.descendants((child, rel) => {
      if (textFound) return false;
      if (child.isText) {
        contentPos = found.pos + 1 + rel;
        textFound = true;
        return false;
      }
      return true;
    });
    return contentPos;
  }

  /**
   * Focus a content control (SDT field/clause) by its id: place the caret
   * inside it and scroll it into view — the "take me there and let me edit"
   * counterpart to the scroll-only {@link scrollContentControlIntoView}.
   *
   * Selection, not mutation: locks (`sdtLocked` / `contentLocked` / …) and
   * `viewing` mode do NOT block placing the caret — they still block the edits
   * the user then attempts, via the normal editing rules. So a custom UI can
   * focus a locked clause to let the user inspect it.
   *
   * Caret-inside (not a wrapper NodeSelection): both SDT node types are
   * `atom: false`, so a `TextSelection` inside is the meaningful selection.
   *
   * v1 is body-only: searches the body editor, so a control in a
   * header/footer/note story resolves to `not-found`.
   *
   * @returns `{ success: true }` once focused, or `{ success: false, reason }`
   *   for a real navigation problem: `not-ready` (no editor), `invalid-id`
   *   (empty id), `not-found` (unknown id / non-body), `not-reachable`
   *   (found but the page could not be scrolled into view).
   */
  async focusContentControl(
    entityId: string,
    options: { block?: 'start' | 'center' | 'end' | 'nearest'; behavior?: ScrollBehavior } = {},
  ): Promise<
    { success: true } | { success: false; reason: 'not-ready' | 'invalid-id' | 'not-found' | 'not-reachable' }
  > {
    const editor = this.#editor;
    if (!editor) return { success: false, reason: 'not-ready' };
    if (typeof entityId !== 'string' || entityId.length === 0) return { success: false, reason: 'invalid-id' };

    const pos = this.#resolveContentControlCaretPos(entityId);
    if (pos == null) return { success: false, reason: 'not-found' };

    // Without setTextSelection the editor can't place the caret, so focus
    // can't honor its "caret placed" contract — fail before scrolling.
    if (typeof editor.commands?.setTextSelection !== 'function') {
      return { success: false, reason: 'not-ready' };
    }

    // Scroll first and honor the result. A focus that can't bring the control
    // into view must not report success (it would leave a caret on a page that
    // never mounted) — matches #scrollToBlockCandidate. Model-aware: mounts a
    // virtualized page first.
    const scrolled = await this.scrollToPositionAsync(pos, {
      behavior: options.behavior ?? 'smooth',
      block: options.block ?? 'center',
    });
    if (!scrolled) return { success: false, reason: 'not-reachable' };

    // Place the caret inside the control and honor the result — report success
    // only if the selection was actually placed. setTextSelection clamps and
    // focuses the (hidden) editor view with preventScroll, so keyboard input
    // goes to the control without re-jumping the viewport.
    if (!editor.commands.setTextSelection({ from: pos, to: pos })) {
      return { success: false, reason: 'not-reachable' };
    }
    return { success: true };
  }

  /**
   * Scrolls a specific page into view.
   *
   * This method supports virtualized rendering: if the target page is not currently
   * mounted in the DOM, it will scroll to the computed y-position to trigger
   * virtualization, wait for the page to mount, then perform precise scrolling.
   *
   * @param pageNumber - One-based page number to scroll to (e.g., 1 for first page)
   * @param scrollBehavior - Scroll behavior ('auto' | 'smooth'). Defaults to 'smooth'.
   * @returns Promise resolving to true if the page was scrolled to, false if layout not available or invalid page
   *
   * @example
   * ```typescript
   * // Smooth scroll to first page
   * await presentationEditor.scrollToPage(1);
   *
   * // Instant scroll to page 5
   * await presentationEditor.scrollToPage(5, 'auto');
   * ```
   */
  async scrollToPage(pageNumber: number, scrollBehavior: ScrollBehavior = 'smooth'): Promise<boolean> {
    const layout = this.#layoutState.layout;
    if (!layout) return false;

    // Reject non-finite or non-integer input to fail fast instead of timing out
    if (!Number.isInteger(pageNumber)) return false;

    // Convert 1-based page number to 0-based index
    const pageIndex = pageNumber - 1;

    // Clamp to valid page range
    const maxPage = layout.pages.length - 1;
    if (pageIndex < 0 || pageIndex > maxPage) return false;

    // Check if page is already mounted
    let pageEl = getPageElementByIndex(this.#viewportHost, pageIndex);

    // If not mounted (virtualized), scroll to computed y-position to trigger mount
    if (!pageEl) {
      this.#scrollPageIntoView(pageIndex);
      const mounted = await this.#waitForPageMount(pageIndex, { timeout: 2000 });
      if (!mounted) return false;
      pageEl = getPageElementByIndex(this.#viewportHost, pageIndex);
    }

    if (pageEl) {
      pageEl.scrollIntoView({ block: 'start', inline: 'nearest', behavior: scrollBehavior });
      return true;
    }
    return false;
  }

  /**
   * Get document position from viewport coordinates (header/footer-aware).
   *
   * This method maps viewport coordinates to document positions while respecting
   * the current editing mode:
   * - In body mode, performs hit testing on the main document layout
   * - In header/footer mode, hit tests within the active header/footer region
   * - Returns null if coordinates are outside the editable area
   *
   * @param coords - Viewport coordinates (clientX/clientY)
   * @returns Position result with pos and inside properties, or null if no match
   *
   * @example
   * ```typescript
   * const result = presentationEditor.posAtCoords({ clientX: 100, clientY: 200 });
   * if (result) {
   *   console.log(`Clicked at document position ${result.pos}`);
   * }
   * ```
   */
  posAtCoords(coords: {
    clientX?: number;
    clientY?: number;
    left?: number;
    top?: number;
  }): { pos: number; inside: number } | null {
    // Accept multiple coordinate formats for compatibility
    const clientX = coords?.clientX ?? coords?.left ?? null;
    const clientY = coords?.clientY ?? coords?.top ?? null;

    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      console.warn('[PresentationEditor] posAtCoords called with invalid coordinates:', coords);
      return null;
    }

    // Use hitTest which already handles both body and header/footer modes
    const hit = this.hitTest(clientX!, clientY!);
    if (!hit) {
      return null;
    }

    // Return in ProseMirror-compatible format
    // Note: 'inside' indicates the depth of the node clicked (ProseMirror-specific).
    // We use -1 as a default to indicate we're not inside a specific node boundary,
    // which is the typical behavior for layout-based coordinate mapping.
    return {
      pos: hit.pos,
      inside: -1,
    };
  }

  /**
   * Aggregate an array of rects into a single bounding box.
   */
  #aggregateLayoutBounds(
    rects: RangeRect[],
  ): { top: number; left: number; bottom: number; right: number; width: number; height: number } | null {
    if (!rects.length) return null;
    const top = Math.min(...rects.map((rect) => rect.top));
    const left = Math.min(...rects.map((rect) => rect.left));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const right = Math.max(...rects.map((rect) => rect.right));
    if (!Number.isFinite(top) || !Number.isFinite(left) || !Number.isFinite(bottom) || !Number.isFinite(right)) {
      return null;
    }
    return {
      top,
      left,
      bottom,
      right,
      width: right - left,
      height: bottom - top,
    };
  }

  /**
   * Update zoom level and re-render.
   *
   * @param zoom - Zoom level multiplier (1.0 = 100%). Must be a positive finite number.
   * @throws {TypeError} If zoom is not a number
   * @throws {RangeError} If zoom is not finite, is <= 0, or is NaN
   *
   * @example
   * ```typescript
   * editor.setZoom(1.5); // 150% zoom
   * editor.setZoom(0.75); // 75% zoom
   * ```
   */
  setZoom(zoom: number) {
    if (typeof zoom !== 'number') {
      throw new TypeError(`[PresentationEditor] setZoom expects a number, received ${typeof zoom}`);
    }
    if (Number.isNaN(zoom)) {
      throw new RangeError('[PresentationEditor] setZoom expects a valid number (not NaN)');
    }
    if (!Number.isFinite(zoom)) {
      throw new RangeError('[PresentationEditor] setZoom expects a finite number');
    }
    if (zoom <= 0) {
      throw new RangeError('[PresentationEditor] setZoom expects a positive number greater than 0');
    }
    if (zoom > MAX_ZOOM_WARNING_THRESHOLD) {
      console.warn(
        `[PresentationEditor] Zoom level ${zoom} exceeds recommended maximum of ${MAX_ZOOM_WARNING_THRESHOLD}. Performance may degrade.`,
      );
    }
    this.#layoutOptions.zoom = zoom;
    this.#applyZoom();
    // Notify DomPainter so virtualization accounts for the CSS transform scale
    this.#painterAdapter.setZoom(zoom);
    this.emit('zoomChange', { zoom });
    this.#shouldScrollSelectionIntoView = true;
    this.#scheduleSelectionUpdate();
    // Trigger cursor updates on zoom changes
    if (this.#remoteCursorManager?.hasRemoteCursors()) {
      this.#remoteCursorManager.markDirty();
      this.#remoteCursorManager.scheduleUpdate();
    }
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  /**
   * Clean up editor + DOM nodes.
   * Safe to call during partial initialization.
   */
  destroy() {
    // Cancel pending layout RAF
    if (this.#rafHandle != null) {
      safeCleanup(() => {
        const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
        win.cancelAnimationFrame(this.#rafHandle!);
        this.#rafHandle = null;
      }, 'Layout RAF');
    }

    // Cancel pending focus-scroll safety net RAF
    if (this.#focusScrollRafId != null) {
      safeCleanup(() => {
        const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
        win.cancelAnimationFrame(this.#focusScrollRafId!);
        this.#focusScrollRafId = null;
      }, 'Focus scroll RAF');
    }

    if (this.#selectionScrollSettleCleanup) {
      safeCleanup(() => {
        this.#selectionScrollSettleCleanup?.();
      }, 'Selection scroll settle');
    }
    this.#finishSelectionNavigation();

    // Cancel pending decoration sync RAF
    if (this.#decorationSyncRafHandle != null) {
      safeCleanup(() => {
        const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
        win.cancelAnimationFrame(this.#decorationSyncRafHandle!);
        this.#decorationSyncRafHandle = null;
      }, 'Decoration sync RAF');
    }
    this.#postPaintPipeline.destroy();
    this.#proofingManager?.dispose();
    this.#proofingManager = null;
    this.#fontController.dispose();
    this.#fontGate?.dispose();
    this.#fontGate = null;

    // Cancel pending cursor awareness update
    if (this.#cursorUpdateTimer !== null) {
      clearTimeout(this.#cursorUpdateTimer);
      this.#cursorUpdateTimer = null;
    }

    if (this.#semanticResizeRaf != null) {
      safeCleanup(() => {
        const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
        win.cancelAnimationFrame(this.#semanticResizeRaf!);
        this.#semanticResizeRaf = null;
      }, 'Semantic resize RAF');
    }
    if (this.#semanticResizeDebounce != null) {
      safeCleanup(() => {
        const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
        win.clearTimeout(this.#semanticResizeDebounce!);
        this.#semanticResizeDebounce = null;
      }, 'Semantic resize debounce');
    }
    this.#semanticResizeObserver?.disconnect();
    this.#semanticResizeObserver = null;

    // Clean up remote cursor manager
    if (this.#remoteCursorManager) {
      safeCleanup(() => {
        this.#remoteCursorManager?.destroy();
        this.#remoteCursorManager = null;
      }, 'Remote cursor manager');
    }
    this.#remoteCursorOverlay = null;

    this.#selectionSync.destroy();

    this.#editorListeners.forEach(({ event, handler }) => this.#editor?.off(event, handler));
    this.#editorListeners = [];

    this.#domIndexObserverManager?.destroy();
    this.#domIndexObserverManager = null;

    // Clean up editor input manager (handles event listeners and drag/cell state)
    if (this.#editorInputManager) {
      safeCleanup(() => {
        this.#editorInputManager?.destroy();
        this.#editorInputManager = null;
      }, 'Editor input manager');
    }

    if (this.#scrollHandler) {
      if (this.#scrollContainer) {
        this.#scrollContainer.removeEventListener('scroll', this.#scrollHandler, { capture: true });
      }
      const win = this.#visibleHost?.ownerDocument?.defaultView;
      win?.removeEventListener('scroll', this.#scrollHandler, { capture: true });
      this.#scrollHandler = null;
      this.#handledScrollEvents = new WeakSet<Event>();
      this.#scrollContainer = null;
    }
    this.#inputBridge?.notifyTargetChanged();
    this.#inputBridge?.destroy();
    this.#inputBridge = null;
    this.#teardownCompositionDeferral();

    if (this.#a11ySelectionAnnounceTimeout != null) {
      clearTimeout(this.#a11ySelectionAnnounceTimeout);
      this.#a11ySelectionAnnounceTimeout = null;
    }

    this.#teardownStorySessionEventBridge();
    this.#teardownActiveSurfaceUiEventBridge();

    // Unregister from static registry
    if (this.#registryKey) {
      PresentationEditor.#instances.delete(this.#registryKey);
      this.#registryKey = null;
    }

    // Tear down the unified-history coordinator before its participant editors
    // are destroyed, so we don't fire purge events on already-disposed editors.
    safeCleanup(() => {
      this.#teardownUnifiedHistoryCoordinator();
    }, 'Unified history coordinator');

    // Clean up header/footer session manager
    safeCleanup(() => {
      this.#headerFooterSession?.destroy();
      this.#headerFooterSession = null;
    }, 'Header/footer session manager');

    // Clean up generic story-session manager (if the flag enabled it)
    safeCleanup(() => {
      this.#storySessionManager?.destroy();
      this.#storySessionManager = null;
    }, 'Story presentation session manager');

    // Clear flow block cache to free memory
    this.#flowBlockCache.clear();
    this.#layoutLookupBlocks = [];
    this.#layoutLookupMeasures = [];

    this.#painterAdapter.reset();
    this.#pageGeometryHelper = null;
    this.#dragDropManager?.destroy();
    this.#dragDropManager = null;
    this.#selectionOverlay?.remove();
    this.#painterHost?.remove();
    this.#hiddenHostWrapper?.remove();
    this.#hoverOverlay = null;
    this.#hoverTooltip = null;
    this.#modeBanner?.remove();
    this.#modeBanner = null;
    this.#ariaLiveRegion?.remove();
    this.#ariaLiveRegion = null;
    this.#errorBanner?.remove();
    if (this.#editor) {
      (this.#editor as Editor & { presentationEditor?: PresentationEditor | null }).presentationEditor = null;
      this.#editor.destroy();
    }
  }

  #rebuildDomPositionIndex(): void {
    if (!this.#painterHost) return;
    try {
      this.#domPositionIndex.rebuild(this.#painterHost);
    } catch (error) {
      debugLog('warn', 'DomPositionIndex rebuild failed', { error: String(error) });
    }
  }

  // ===========================================================================
  // Proofing Integration
  // ===========================================================================

  /** Initialize the proofing session manager from layout engine options. */
  #initializeProofing(): void {
    const proofingConfig = this.#options.layoutEngineOptions?.proofing;
    if (!proofingConfig) return;

    this.#proofingManager = new ProofingSessionManager(proofingConfig);
    this.#wireProofingManagerAdapters();

    // Schedule initial check after first paint
    if (proofingConfig.enabled && this.#editor?.state?.doc) {
      // Defer to allow first paint to complete
      setTimeout(() => {
        this.#proofingManager?.runInitialCheck(this.#editor!.state.doc);
      }, 0);
    }
  }

  /**
   * Build a page resolver that maps PM positions to page indices
   * using the current layout's fragment PM ranges. Returns a closure
   * that re-reads the layout on each call so it stays current.
   */
  #buildPageResolver(): (pmPos: number) => number | undefined {
    return (pmPos: number) => {
      const layout = this.#layoutState.layout;
      if (!layout?.pages) return undefined;
      for (let idx = 0; idx < layout.pages.length; idx++) {
        const page = layout.pages[idx];
        for (const fragment of page.fragments) {
          const frag = fragment as { pmStart?: number; pmEnd?: number };
          if (frag.pmStart != null && frag.pmEnd != null && pmPos >= frag.pmStart && pmPos <= frag.pmEnd) {
            return idx;
          }
        }
      }
      return undefined;
    };
  }

  /**
   * Wire all adapters (callbacks, visibility source, page resolver, composition
   * listeners) onto the current proofing manager. Called once from both
   * #initializeProofing and updateProofingConfig to avoid duplication.
   */
  #wireProofingManagerAdapters(): void {
    const mgr = this.#proofingManager;
    if (!mgr) return;

    mgr.setDocumentId(((this.#options as Record<string, unknown>).documentId as string | null) ?? null);

    mgr.onResultsChanged = () => this.#applyProofingPass();

    mgr.setVisibilitySource({
      getVisiblePageIndices: () => {
        const mountedPageIndices = this.#painterAdapter.getMountedPageIndices();
        return mountedPageIndices.length > 0 ? mountedPageIndices : null;
      },
    });

    mgr.setPageResolver(this.#buildPageResolver());

    // Composition hard-pause: direct DOM events are more reliable than
    // view.composing which may be stale by the time the end-transaction fires.
    const editorDom = this.#editor?.view?.dom;
    if (editorDom) {
      editorDom.addEventListener('compositionstart', () => mgr.setComposing(true));
      editorDom.addEventListener('compositionend', () => mgr.setComposing(false));
    }
  }

  #buildProofingAnnotations(): ProofingAnnotation[] | null {
    if (!this.#proofingManager?.isEnabled) {
      return null;
    }

    // Compute active word range for caret-token suppression:
    // suppress the underline on the word the user is currently typing.
    const editorState = this.#editor?.state;
    let activeWordRange: { from: number; to: number } | null = null;
    if (editorState?.selection.empty) {
      activeWordRange = computeWordSelectionRangeAt(editorState, editorState.selection.head);
    }

    const slices = this.#proofingManager.getPaintSlices(activeWordRange);
    return slices.map((s) => ({
      pmFrom: s.pmFrom,
      pmTo: s.pmTo,
      kind: s.kind,
    }));
  }

  /**
   * Apply the proofing decoration pass after paint or when results change.
   * Rebuilds DomPositionIndex if proofing split/un-split the rendered spans.
   */
  #applyProofingPass(): void {
    this.#postPaintPipeline.applyProofingAnnotations(this.#buildProofingAnnotations(), () =>
      this.#rebuildDomPositionIndex(),
    );
  }

  /**
   * Notify the proofing manager of a document change.
   * Extracts changed ranges from the transaction and forwards to the manager.
   */
  #notifyProofingOfDocChange(transaction: Transaction): void {
    if (!this.#proofingManager?.isEnabled) return;

    const doc = this.#editor?.state?.doc;
    if (!doc) return;

    // Extract changed ranges in final-document coordinates.
    // Each step map's ranges are in intermediate coordinates — they must be
    // mapped forward through all subsequent steps to reach the final doc space.
    const changedRanges: Array<{ from: number; to: number }> = [];
    const { mapping } = transaction;
    mapping.maps.forEach((map, stepIndex) => {
      const mapFrom = mapping.slice(stepIndex + 1);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        changedRanges.push({
          from: mapFrom.map(newStart, -1),
          to: mapFrom.map(newEnd, 1),
        });
      });
    });

    this.#proofingManager.onDocumentChanged(doc, changedRanges, transaction.mapping);
  }

  /**
   * Applies comment highlight styles (background color, box-shadow,
   * track-change-focused class) to all painter-rendered comment elements.
   * Called after paint and after observer rebuild.
   */
  #syncCommentHighlights(): void {
    this.#postPaintPipeline.applyCommentHighlights();
  }

  setActiveTrackChangeIds(ids: readonly string[]): boolean {
    const didChange = this.#postPaintPipeline.setActiveTrackChangeIds(ids);
    if (didChange) {
      this.#syncInlineStyleLayers();
    }
    return didChange;
  }

  /**
   * Applies every inline style layer that decorates painter-owned DOM elements.
   *
   * Comment highlights intentionally run before the decoration bridge because
   * bridged inline decorations may own the same CSS properties and must be
   * restored last.
   */
  #syncInlineStyleLayers(): void {
    const state = this.#editor?.view?.state;
    if (!state) {
      this.#syncCommentHighlights();
      return;
    }

    try {
      this.#postPaintPipeline.syncInlineStyleLayers(state, this.#domPositionIndex);
    } catch (error) {
      console.warn('[PresentationEditor] Inline style layer sync failed:', error);
    }
  }

  /**
   * Runs a full decoration sync: applies external plugin decoration classes
   * and styles to the painted DOM elements via DecorationBridge. Runs are
   * split at decoration boundaries during layout so only the selected portion
   * gets the background (like the highlight mark, without applying a mark).
   *
   * Called synchronously from post-paint and observer-rebuild paths where the
   * DOM index is guaranteed to be fresh.
   */
  #syncDecorations(): void {
    const state = this.#editor?.view?.state;
    if (!state) return;

    try {
      this.#postPaintPipeline.syncDecorations(state, this.#domPositionIndex);
    } catch (error) {
      // Sync can call findRangeByText and other doc-dependent logic; if it throws
      // (e.g. edge-case doc state), avoid breaking the RAF or observer sync loop.
      console.warn('[PresentationEditor] Decoration sync failed:', error);
    }
  }

  #shouldRestoreEmptyDecorationsAfterTransaction(transaction: Transaction | undefined, state: EditorState): boolean {
    if (transaction) {
      return transaction.docChanged === true;
    }

    return this.#postPaintPipeline.hasCurrentDecorationRanges(state);
  }

  /**
   * Schedules a decoration sync on the next animation frame, coalesced so
   * rapid transactions (cursor movement, selection changes) don't cause
   * redundant work.
   *
   * Skips scheduling when:
   * - A rerender is already pending (post-paint will sync).
   * - No DecorationSet references have actually changed (identity check).
   */
  #scheduleDecorationSync(): void {
    // If a full rerender is pending, the post-paint path will sync. Skip.
    if (this.#renderScheduled || this.#isRerendering) return;

    // Cheap identity check: bail if no DecorationSet references changed.
    const state = this.#editor?.view?.state;
    if (!state || !this.#postPaintPipeline.hasDecorationChanges(state)) return;

    // Already scheduled — RAF will handle it.
    if (this.#decorationSyncRafHandle != null) return;

    const win = this.#visibleHost?.ownerDocument?.defaultView ?? window;
    this.#decorationSyncRafHandle = win.requestAnimationFrame(() => {
      this.#decorationSyncRafHandle = null;
      // Re-check: a rerender may have been scheduled between when we queued
      // this RAF and when it fires. The post-paint path will sync instead.
      if (this.#renderScheduled || this.#isRerendering) return;
      this.#syncDecorations();
    });
  }

  #setupEditorListeners() {
    const handleUpdate = ({ transaction }: { transaction?: Transaction }) => {
      const trackedChangesChanged = this.#syncTrackedChangesPreferences();
      this.#syncHeaderFooterTrackedChangesRenderConfig();
      if (transaction) {
        this.#epochMapper.recordTransaction(transaction);
        this.#selectionSync.setDocEpoch(this.#epochMapper.getCurrentEpoch());

        const inputType = transaction.getMeta?.('inputType');
        // Detect Y.js-origin transactions (remote collaboration changes).
        // These bypass the blockNodePlugin's sdBlockRev increment to prevent
        // feedback loops, so the FlowBlockCache's fast revision comparison
        // cannot be trusted. History undo/redo can also restore tracked-mark-only
        // changes where visible text stays the same, so use the same JSON fallback.
        const ySyncMeta = transaction.getMeta?.(ySyncPluginKey);
        const shouldBypassFastRevision =
          transaction.docChanged &&
          (ySyncMeta?.isChangeOrigin || inputType === 'historyUndo' || inputType === 'historyRedo');
        if (shouldBypassFastRevision) {
          this.#flowBlockCache?.setHasExternalChanges?.(true);
        }
      }
      if (trackedChangesChanged || transaction?.docChanged) {
        this.#pendingDocChange = true;
        // Store the mapping from this transaction for position updates during paint.
        // Only stored for doc changes - other triggers don't have position shifts.
        if (transaction?.docChanged) {
          if (this.#pendingMapping !== null) {
            // Multiple rapid transactions before rerender - compose the mappings.
            // The painter's gate checks maps.length > 1 to trigger full rebuild,
            // which is the safe fallback for complex/batched edits.
            const combined = this.#pendingMapping.slice();
            combined.appendMapping(transaction.mapping);
            this.#pendingMapping = combined;
          } else {
            this.#pendingMapping = transaction.mapping;
          }
        }
        this.#selectionSync.onLayoutStart();
        this.#scheduleRerender();
      }
      // Update local cursor in awareness whenever document changes
      // This ensures cursor position is broadcast with each keystroke
      if (transaction?.docChanged) {
        this.#notifyProofingOfDocChange(transaction);
        this.#updateLocalAwarenessCursor();
        // Clear cell anchor on document changes to prevent stale references
        // (table structure may have changed, cell positions may be invalid)
        this.#editorInputManager?.clearCellAnchor();
      }
    };
    const handleSelection = ({ transaction }: { transaction?: Transaction } = {}) => {
      // User-initiated selection change — scroll caret/head into view once, except during
      // pointer drag: EditorInputManager edge auto-scroll must not fight #scrollActiveEndIntoView.
      if (!this.#editorInputManager?.isDragging) {
        this.#shouldScrollSelectionIntoView = true;
      }
      // Use immediate rendering for selection-only changes (clicks, arrow keys).
      // Without immediate, the render is RAF-deferred — leaving a window where
      // a remote collaborator's edit can cancel the pending render via
      // setDocEpoch → cancelScheduledRender. Immediate rendering is safe here:
      // if layout is updating (due to a concurrent doc change), flushNow()
      // is a no-op and the render will be picked up after layout completes.
      //
      // SD-3400: NOT safe for doc-changing transactions. 'selectionUpdate'
      // fires BEFORE 'update', so the epoch/layout gates are not armed yet
      // and an immediate flush renders the caret against the PRE-change
      // paint (visibly stale caret on every Enter/Backspace). Defer those to
      // the post-paint flush.
      this.#scheduleSelectionUpdate({ immediate: !transaction?.docChanged });
      // Update local cursor in awareness for collaboration
      // This bypasses y-prosemirror's focus check which may fail for hidden PM views
      this.#updateLocalAwarenessCursor();
      this.#scheduleA11ySelectionAnnouncement();
    };

    // The 'transaction' event fires for ALL transactions (doc changes,
    // selection changes, meta-only). The 'update' event only fires for
    // docChanged transactions, and 'selectionUpdate' only for selection
    // changes. A meta-only transaction (e.g., a custom command that sets
    // plugin state without editing text) fires neither.
    //
    // We listen on 'transaction' so the decoration bridge picks up changes
    // from any transaction type. The bridge's own identity check + RAF
    // coalescing prevent unnecessary work.
    // When decoration state changes without a doc change (e.g. setFocus), we must
    // still run a full rerender so runs are split at the new decoration boundaries;
    // otherwise the bridge applies the class to whole runs and highlights too much.
    const handleTransaction = (event?: { transaction?: Transaction }) => {
      const tr = event?.transaction;
      this.#postPaintPipeline.recordDecorationTransaction(tr);
      const state = this.#editor?.view?.state;
      const decorationChanged = state && this.#postPaintPipeline.hasDecorationChanges(state);
      // Sync immediately whenever decorations changed so e.g. clearFocus removes
      // highlight-selection in the same tick. Only restore when we had a doc change.
      if (decorationChanged) {
        const restoreEmpty = this.#shouldRestoreEmptyDecorationsAfterTransaction(tr, state!);
        this.#postPaintPipeline.syncDecorations(state!, this.#domPositionIndex, {
          restoreEmptyDecorations: restoreEmpty,
        });
      } else {
        // No immediate sync; schedule coalesced sync on next frame.
        this.#scheduleDecorationSync();
      }
      if (decorationChanged) {
        this.#pendingDocChange = true;
        this.#selectionSync.onLayoutStart();
        this.#scheduleRerender();
      }
    };

    this.#editor.on('update', handleUpdate);
    this.#editor.on('selectionUpdate', handleSelection);
    this.#editor.on('transaction', handleTransaction);
    this.#editorListeners.push({ event: 'update', handler: handleUpdate as (...args: unknown[]) => void });
    this.#editorListeners.push({ event: 'selectionUpdate', handler: handleSelection as (...args: unknown[]) => void });
    this.#editorListeners.push({ event: 'transaction', handler: handleTransaction as (...args: unknown[]) => void });

    // Listen for page style changes (e.g., margin adjustments via ruler).
    // These changes don't modify document content (docChanged === false),
    // so the 'update' event isn't emitted. The dedicated pageStyleUpdate event
    // provides clearer semantics and better debugging than checking transaction meta flags.
    const handlePageStyleUpdate = () => {
      this.#pendingDocChange = true;
      this.#selectionSync.onLayoutStart();
      this.#scheduleRerender();
    };
    this.#editor.on('pageStyleUpdate', handlePageStyleUpdate);
    this.#editorListeners.push({
      event: 'pageStyleUpdate',
      handler: handlePageStyleUpdate as (...args: unknown[]) => void,
    });

    // Listen for stylesheet default changes (e.g., styles.apply mutations to docDefaults).
    // These changes mutate translatedLinkedStyles directly and need a full re-render
    // so the style-engine picks up the updated default properties.
    const handleStylesDefaultsChanged = () => {
      // Stylesheet default mutations can change block conversion output even
      // when PM JSON is unchanged (e.g., default run color/font). Cached flow
      // blocks must be invalidated so toFlowBlocks recomputes with new defaults.
      this.#flowBlockCache.clear();
      this.#pendingDocChange = true;
      this.#selectionSync.onLayoutStart();
      this.#scheduleRerender();
    };
    this.#editor.on('stylesDefaultsChanged', handleStylesDefaultsChanged);
    this.#editorListeners.push({
      event: 'stylesDefaultsChanged',
      handler: handleStylesDefaultsChanged as (...args: unknown[]) => void,
    });
    this.#syncActiveSurfaceUiEventBridge(this.#editor);

    // Listen for footnote/endnote part mutations (e.g., insert via document API).
    // These modify the OOXML part and derived cache but don't change the PM document,
    // so the normal 'update' event won't trigger a layout refresh.
    const handleNotesPartChanged = (event?: { source?: unknown }) => {
      this.#flowBlockCache.setHasExternalChanges?.(true);
      this.#pendingDocChange = true;
      this.#selectionSync.onLayoutStart();
      this.#scheduleRerender();

      // Coordinator-driven note replay and normal note-session commit both
      // write through the same `notes-part-changed` event. Those writes are
      // authoritative updates from the note editor we already track, so they
      // must NOT invalidate the dormant editor or its reachable redo branch.
      if (!isInternalNoteCommitSource(event)) {
        this.#purgeAllNoteParticipantsOnExternalInvalidation();
      }
    };
    this.#editor.on('notes-part-changed', handleNotesPartChanged);
    this.#editorListeners.push({
      event: 'notes-part-changed',
      handler: handleNotesPartChanged as (...args: unknown[]) => void,
    });

    // Listen for header/footer part mutations that originate outside the
    // interactive header/footer UI, such as document-api writes. These updates
    // bypass normal body-document update events, so PresentationEditor must:
    // 1. Refresh the header/footer registry after relationship changes
    // 2. Invalidate cached header/footer FlowBlocks for changed refs
    // 3. Schedule a full rerender so the new content becomes visible
    const handlePartChanged = (event?: PartChangedEvent) => {
      if (!event?.parts?.length) {
        return;
      }

      const isInternalHeaderFooterSync = event.source === SOURCE_HEADER_FOOTER_LOCAL;

      const headerFooterStructureChanged = event.parts.some((part) => part.partId === DOCUMENT_RELS_PART_ID);
      const changedHeaderFooterRefIds = Array.from(
        new Set(
          event.parts
            .filter((part) => isHeaderFooterPartId(part.partId))
            .map((part) => part.sectionId)
            .filter((refId): refId is string => typeof refId === 'string' && refId.length > 0),
        ),
      );

      if (!headerFooterStructureChanged && changedHeaderFooterRefIds.length === 0) {
        return;
      }

      if (headerFooterStructureChanged) {
        this.#headerFooterSession?.refreshStructure();
      }

      if (changedHeaderFooterRefIds.length > 0) {
        this.#headerFooterSession?.invalidateLayoutForRefs(changedHeaderFooterRefIds);
        if (!isInternalHeaderFooterSync) {
          this.#purgeHeaderFooterParticipantsOnExternalInvalidation(changedHeaderFooterRefIds);
        }
      }

      this.#pendingDocChange = true;
      this.#selectionSync.onLayoutStart();
      this.#scheduleRerender();
    };
    this.#editor.on('partChanged', handlePartChanged);
    this.#editorListeners.push({
      event: 'partChanged',
      handler: handlePartChanged as (...args: unknown[]) => void,
    });

    const handleCollaborationReady = (payload: unknown) => {
      this.emit('collaborationReady', payload);
      // Collaboration bootstrap can hydrate header/footer parts on this client
      // without emitting partChanged. Force a header/footer refresh pass so the
      // importer tab sees the same headers/footers immediately.
      this.#refreshHeaderFooterStructureThenRerender();
      // Setup remote cursor rendering after collaboration is ready
      // Only setup if presence is enabled in layout options
      if (this.#options.collaborationProvider?.awareness && this.#layoutOptions.presence?.enabled !== false) {
        this.#setupCollaborationCursors();
      }
    };
    this.#editor.on('collaborationReady', handleCollaborationReady);
    this.#editorListeners.push({
      event: 'collaborationReady',
      handler: handleCollaborationReady as (...args: unknown[]) => void,
    });

    // `Editor.replaceFile()` swaps the converter and (in collaboration mode)
    // seeds parts straight into the Y.Doc, so no `partChanged` fires on the
    // importing client. Treat the signal like a structural rels change: rebuild
    // header/footer descriptors against the new converter and rerender so the
    // importer tab matches the collaborator tab without waiting for an edit.
    const handleDocumentReplaced = () => {
      // A new document reuses this gate AND this resolver, so drop the old document's pending
      // late-load reflow + required-face state and its runtime font mappings, then reapply the
      // instance-level fonts config before the rerender.
      this.#fontGate?.resetForDocumentChange();
      this.#fontController.reset();
      // Reset the layout signature too: the prior document's value must not gate the new document's
      // previous-measure reuse. Benign if left stale (it only over-invalidates reuse), but resetting
      // here states the intent and starts the swap from a clean signature.
      this.#layoutFontSignature = '';
      // SD-3432: the prior document's footnote fixed point is meaningless for
      // the new one (validation would discard it anyway; reset states intent).
      this.#footnoteReserveSeed = null;
      this.#fontController.applyInitialConfig(this.#options.fontAssets);
      // Register the NEW document's embedded fonts (the swap's `reset()` released the old ones), before
      // the rerender below runs the first font plan for this document.
      this.#applyEmbeddedDocumentFonts();
      this.#resetFontReportStateForDocumentChange();
      this.#refreshHeaderFooterStructureThenRerender({ purgeCachedEditors: true });
    };
    this.#editor.on('documentReplaced', handleDocumentReplaced);
    this.#editorListeners.push({
      event: 'documentReplaced',
      handler: handleDocumentReplaced as (...args: unknown[]) => void,
    });
    // Listen for comment selection changes and re-run the inline style layering
    // pipeline on the existing DOM. This avoids a full layout → paint cycle
    // while still restoring bridge-owned inline decoration styles afterward.
    const handleCommentsUpdate = (payload: { activeCommentId?: string | null }) => {
      // Only update active comment when the field is explicitly present in the payload.
      // This prevents unrelated events (like tracked change updates) from clearing
      // the active comment selection unexpectedly.
      if ('activeCommentId' in payload) {
        const activeId = payload.activeCommentId ?? null;
        const didChange = this.#postPaintPipeline.setActiveComment(activeId);
        if (didChange) {
          this.#syncInlineStyleLayers();
        }
      }
    };
    this.#editor.on('commentsUpdate', handleCommentsUpdate);
    this.#editorListeners.push({
      event: 'commentsUpdate',
      handler: handleCommentsUpdate as (...args: unknown[]) => void,
    });

    // Listen for protection state changes to refresh visual lock state and overlays
    const handleProtectionChanged = () => {
      this.#updatePermissionOverlay();
      this.#pendingDocChange = true;
      this.#scheduleRerender();
    };
    this.#editor.on('protectionChanged', handleProtectionChanged);
    this.#editorListeners.push({
      event: 'protectionChanged',
      handler: handleProtectionChanged as (...args: unknown[]) => void,
    });
  }

  /**
   * Setup awareness event subscriptions for remote cursor tracking.
   * Delegates to RemoteCursorManager.
   * @private
   */
  #setupCollaborationCursors() {
    this.#remoteCursorManager?.setup();
  }

  /**
   * Update local cursor position in awareness.
   * Delegates to RemoteCursorManager.
   * @private
   */
  #updateLocalAwarenessCursor(): void {
    // Debounce awareness cursor updates to avoid per-keystroke overhead.
    // Collaboration providers (e.g. Liveblocks) can spend ~190ms encoding and
    // syncing awareness state per setLocalStateField call. Batching rapid
    // cursor movements into a single update every 100ms keeps typing responsive
    // while maintaining real-time cursor sharing for other participants.
    if (this.#cursorUpdateTimer !== null) {
      clearTimeout(this.#cursorUpdateTimer);
    }
    this.#cursorUpdateTimer = setTimeout(() => {
      this.#cursorUpdateTimer = null;
      this.#remoteCursorManager?.updateLocalCursor(this.#editor?.state ?? null);
    }, 100);
  }

  /**
   * Get render dependencies for the RemoteCursorManager.
   * @private
   */
  #getRemoteCursorRenderDeps(): RenderDependencies {
    return {
      layout: this.#layoutState?.layout ?? null,
      blocks: this.#layoutState?.blocks ?? [],
      measures: this.#layoutState?.measures ?? [],
      pageGeometryHelper: this.#pageGeometryHelper,
      pageHeight: this.#layoutOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h,
      computeCaretLayoutRect: (pos) => this.#computeCaretLayoutRect(pos),
      convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
    };
  }

  /**
   * Update remote cursor state, render overlays, and emit event for host consumption.
   * Delegates to RemoteCursorManager.
   * @private
   */
  #updateRemoteCursors() {
    if (!this.#remoteCursorManager) return;

    this.#remoteCursorManager.update(this.#editor?.state ?? null, this.#getRemoteCursorRenderDeps());

    // Emit event for host consumption
    this.emit('remoteCursorsUpdate', {
      cursors: Array.from(this.#remoteCursorManager.state.values()),
    });
  }

  /**
   * Render remote cursors from existing state without normalization.
   * Delegates to RemoteCursorManager.
   * @private
   */
  #renderRemoteCursors() {
    this.#remoteCursorManager?.render(this.#getRemoteCursorRenderDeps());
  }

  /**
   * Initialize the EditorInputManager with dependencies and callbacks.
   * @private
   */
  #initializeEditorInputManager(): void {
    this.#editorInputManager = new EditorInputManager();

    // Set dependencies - getters that provide access to PresentationEditor state
    this.#editorInputManager.setDependencies({
      getActiveEditor: () => this.getActiveEditor(),
      getEditor: () => this.#editor,
      getLayoutState: () => this.#layoutState,
      getEpochMapper: () => this.#epochMapper,
      getViewportHost: () => this.#viewportHost,
      getVisibleHost: () => this.#visibleHost,
      getLayoutMode: () => this.#layoutOptions.layoutMode ?? 'vertical',
      getHeaderFooterSession: () => this.#headerFooterSession,
      getPageGeometryHelper: () => this.#pageGeometryHelper,
      getZoom: () => this.#layoutOptions.zoom ?? 1,
      isViewLocked: () => this.#isViewLocked(),
      getDocumentMode: () => this.#documentMode,
      getPageElement: (pageIndex: number) => this.#getPageElement(pageIndex),
      isSelectionAwareVirtualizationEnabled: () => this.#isSelectionAwareVirtualizationEnabled(),
      getActiveStorySession: () => this.#getActiveStorySession(),
    });

    // Set callbacks - functions that the manager calls to interact with PresentationEditor
    this.#editorInputManager.setCallbacks({
      scheduleSelectionUpdate: () => this.#scheduleSelectionUpdate(),
      scheduleRerender: () => this.#scheduleRerender(),
      setPendingDocChange: () => {
        this.#pendingDocChange = true;
      },
      updateSelectionVirtualizationPins: (options) => this.#updateSelectionVirtualizationPins(options),
      scheduleA11ySelectionAnnouncement: (options) => this.#scheduleA11ySelectionAnnouncement(options),
      goToAnchor: (href: string) => this.goToAnchor(href),
      emit: (event: string, payload: unknown) => this.emit(event, payload),
      normalizeClientPoint: (clientX: number, clientY: number) => this.#normalizeClientPoint(clientX, clientY),
      hitTestHeaderFooterRegion: (x: number, y: number, pageIndex?: number, pageLocalY?: number) =>
        this.#hitTestHeaderFooterRegion(x, y, pageIndex, pageLocalY),
      exitHeaderFooterMode: () => this.#exitHeaderFooterMode(),
      activateHeaderFooterRegion: (region, options) => this.#activateHeaderFooterRegion(region, options),
      emitHeaderFooterEditBlocked: (reason: string) => this.#emitHeaderFooterEditBlocked(reason),
      findRegionForPage: (kind, pageIndex) => this.#findRegionForPage(kind, pageIndex),
      getCurrentPageIndex: () => this.#getCurrentPageIndex(),
      resolveDescriptorForRegion: (region) => this.#resolveDescriptorForRegion(region),
      updateSelectionDebugHud: () => this.#updateSelectionDebugHud(),
      clearHoverRegion: () => this.#clearHoverRegion(),
      renderHoverRegion: (region) => this.#renderHoverRegion(region),
      hitTest: (clientX: number, clientY: number) => this.hitTest(clientX, clientY),
      focusEditorAfterImageSelection: () => this.#focusEditorAfterImageSelection(),
      resolveInlineImageElementByPmStart: (pmStart) => this.#painterAdapter.getInlineImageElementByPmStart(pmStart),
      resolveImageFragmentElementByPmStart: (pmStart) => this.#painterAdapter.getImageFragmentElementByPmStart(pmStart),
      resolveFieldAnnotationSelectionFromElement: (el) => this.#resolveFieldAnnotationSelectionFromElement(el),
      computePendingMarginClick: (pointerId, x, y) => this.#computePendingMarginClick(pointerId, x, y),
      selectWordAt: (pos: number) => this.#selectWordAt(pos),
      selectParagraphAt: (pos: number) => this.#selectParagraphAt(pos),
      finalizeDragSelectionWithDom: (pointer, dragAnchor, dragMode) =>
        this.#finalizeDragSelectionWithDom(pointer, dragAnchor, dragMode),
      notifyDragSelectionEnded: () => {
        this.#shouldScrollSelectionIntoView = true;
        this.#scheduleSelectionUpdate({ immediate: true });
      },
      hitTestTable: (x: number, y: number) => this.#hitTestTable(x, y),
      activateRenderedNoteSession: (target, options) => this.#activateRenderedNoteSession(target, options),
      exitActiveStorySession: () => this.#exitActiveStorySession(),
    });
  }

  #setupPointerHandlers() {
    // Delegate to EditorInputManager for pointer events
    this.#editorInputManager?.bind();

    // Scroll handler for virtualization - find the actual scroll container
    // by walking up the DOM tree to find the first scrollable ancestor
    this.#handledScrollEvents = new WeakSet<Event>();
    this.#scrollHandler = (event?: Event) => {
      if (event) {
        if (this.#handledScrollEvents.has(event)) return;
        this.#handledScrollEvents.add(event);
      }
      this.#painterAdapter.onScroll();
    };

    // Find the scrollable ancestor and attach listener there
    this.#scrollContainer = this.#findScrollableAncestor(this.#visibleHost);
    if (this.#scrollContainer) {
      this.#scrollContainer.addEventListener('scroll', this.#scrollHandler, { passive: true, capture: true });
    }

    // Also listen on window as fallback
    const win = this.#visibleHost.ownerDocument?.defaultView;
    if (win && this.#scrollContainer !== win) {
      win.addEventListener('scroll', this.#scrollHandler, { passive: true, capture: true });
    }
  }

  /**
   * Finds the first scrollable ancestor of an element.
   * Returns the element itself if it's scrollable, or walks up the tree.
   *
   * Note: We only check for overflow CSS property, not whether content currently
   * overflows. At setup time, content may not be laid out yet, but the element
   * with overflow:auto/scroll will become the scroll container once content grows.
   */
  #findScrollableAncestor(element: HTMLElement): Element | Window | null {
    const win = element.ownerDocument?.defaultView;
    if (!win) return null;

    let current: Element | null = element;
    while (current) {
      const style = win.getComputedStyle(current);
      const overflowY = style.overflowY;
      // Check for scrollable overflow property - don't require hasScroll since
      // content may not be laid out yet at setup time
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return current;
      }
      current = current.parentElement;
    }

    // If no scrollable ancestor found, return window
    return win;
  }

  /**
   * Re-validates the detected scroll container after the first layout completes.
   *
   * At setup time, #findScrollableAncestor picks the first ancestor with
   * overflow-y: auto|scroll — but it can't verify the element actually constrains
   * content height (content isn't laid out yet). A consumer may set overflow:auto
   * on the SuperDoc container without constraining its height, causing the element
   * to expand to fit all content instead of scrolling.
   *
   * After layout, we can check scrollHeight vs clientHeight. If the detected
   * container isn't actually scrollable AND it grew beyond the viewport (ruling
   * out properly constrained containers that simply don't have enough content
   * yet), we walk further up to find one that actually scrolls, or fall back
   * to window.
   */
  #revalidateScrollContainer(): void {
    if (this.#scrollContainerValidated) return;
    this.#scrollContainerValidated = true;

    if (!(this.#scrollContainer instanceof Element)) return;
    if (this.#scrollContainer.scrollHeight > this.#scrollContainer.clientHeight + 1) return;

    // A properly constrained container (e.g. height:600px; overflow:auto) may
    // not be overflowing yet if the document is short. Its clientHeight stays
    // within viewport bounds. Only switch when the container grew beyond the
    // viewport — a clear sign its height is unconstrained.
    const win = this.#scrollContainer.ownerDocument?.defaultView;
    const viewportHeight = win?.innerHeight ?? 0;
    if (this.#scrollContainer.clientHeight <= viewportHeight) return;

    let el: Element | null = this.#scrollContainer.parentElement;
    let next: Element | Window | null = win ?? null;

    while (el) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        next = el;
        break;
      }
      el = el.parentElement;
    }

    if (!next || next === this.#scrollContainer) return;

    const prev = this.#scrollContainer;
    prev.removeEventListener('scroll', this.#scrollHandler!, { capture: true });
    this.#scrollContainer = next;

    if (next instanceof Element) {
      next.addEventListener('scroll', this.#scrollHandler!, { passive: true, capture: true });
    }
    this.#painterAdapter.setScrollContainer(next instanceof HTMLElement ? next : null);
  }

  /**
   * Sets up drag and drop handlers for field annotations and image files.
   */
  #setupDragHandlers() {
    // Clean up any existing manager
    this.#dragDropManager?.destroy();

    this.#dragDropManager = new DragDropManager();
    this.#dragDropManager.setDependencies({
      getActiveEditor: () => this.getActiveEditor(),
      hitTest: (clientX, clientY) => this.hitTest(clientX, clientY),
      scheduleSelectionUpdate: () => this.#scheduleSelectionUpdate(),
      showDragDropIndicator: (pos) => this.#showDragDropIndicator(pos),
      clearDragDropIndicator: () => this.#clearDragDropIndicator(),
      getViewportHost: () => this.#viewportHost,
      getPainterHost: () => this.#painterHost,
      insertImageFile: (params) => processAndInsertImageFile(params),
    });
    this.#dragDropManager.bind();
  }

  #showDragDropIndicator(pos: number): void {
    const docSize = this.getActiveEditor()?.state?.doc?.content.size;
    if (!Number.isFinite(pos) || docSize == null) return;
    const clampedPos = Math.min(Math.max(pos, 1), docSize);
    if (this.#dragDropIndicatorPos === clampedPos) return;
    this.#dragDropIndicatorPos = clampedPos;
    this.#scheduleSelectionUpdate({ immediate: true });
  }

  #clearDragDropIndicator(): void {
    if (this.#dragDropIndicatorPos == null) return;
    this.#dragDropIndicatorPos = null;
    this.#scheduleSelectionUpdate({ immediate: true });
  }

  /**
   * Focus the editor after image selection and schedule selection update.
   * This method encapsulates the common focus and blur logic used when
   * selecting both inline and block images.
   * @private
   */
  #focusEditorAfterImageSelection(): void {
    this.#shouldScrollSelectionIntoView = true;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const editorDom = this.#editor.view?.dom as HTMLElement | undefined;
    if (editorDom) {
      editorDom.focus();
      this.#editor.view?.focus();
    }
    this.#scheduleSelectionUpdate({ immediate: true });
  }

  #resolveFieldAnnotationSelectionFromElement(
    annotationEl: HTMLElement,
  ): { node: ProseMirrorNode; pos: number } | null {
    const pmStartRaw = annotationEl.dataset?.pmStart;
    if (pmStartRaw == null) {
      return null;
    }

    const pmStart = Number(pmStartRaw);
    if (!Number.isFinite(pmStart)) {
      return null;
    }

    const doc = this.#editor.state?.doc;
    if (!doc) {
      return null;
    }

    const layoutEpochRaw = annotationEl.dataset?.layoutEpoch;
    const layoutEpoch = layoutEpochRaw != null ? Number(layoutEpochRaw) : NaN;
    const effectiveEpoch = Number.isFinite(layoutEpoch) ? layoutEpoch : this.#epochMapper.getCurrentEpoch();
    const mapped = this.#epochMapper.mapPosFromLayoutToCurrentDetailed(pmStart, effectiveEpoch, 1);
    if (!mapped.ok) {
      const fallbackPos = Math.max(0, Math.min(pmStart, doc.content.size));
      const fallbackNode = doc.nodeAt(fallbackPos);
      if (fallbackNode?.type?.name === 'fieldAnnotation') {
        return { node: fallbackNode, pos: fallbackPos };
      }

      this.#pendingDocChange = true;
      this.#scheduleRerender();
      return null;
    }

    const clampedPos = Math.max(0, Math.min(mapped.pos, doc.content.size));
    const node = doc.nodeAt(clampedPos);
    if (!node || node.type.name !== 'fieldAnnotation') {
      return null;
    }

    return { node, pos: clampedPos };
  }

  #setupInputBridge() {
    this.#inputBridge?.destroy();
    // Pass both window (for keyboard events that bubble) and visibleHost (for beforeinput events that don't)
    const win = this.#visibleHost.ownerDocument?.defaultView ?? window;
    this.#inputBridge = new PresentationInputBridge(
      win as Window,
      this.#visibleHost,
      () => this.#getActiveDomTarget(),
      () => !this.#isViewLocked(),
      () => {
        this.#refreshCompositionDeferralTarget();
        this.#editorInputManager?.notifyTargetChanged();
      },
      {
        useWindowFallback: true,
        getTargetEditor: () => this.getActiveEditor(),
        ownsEditorDom: (element) => this.#ownsEditorDom(element),
      },
    );
    this.#inputBridge.bind();
  }

  /**
   * Whether a hidden-editor DOM element belongs to this instance.
   *
   * Hidden hosts (body editor and story-session editors) are appended to
   * document.body, so containment in #visibleHost cannot identify them.
   * Without this check, the input bridge's window-fallback stale rerouting
   * would intercept keystrokes that belong to other SuperDoc instances on the
   * same page and re-dispatch them into this instance — with two instances
   * the bridges ping-pong each other's synthetics until the stack overflows
   * (SD-3249).
   */
  #ownsEditorDom(element: HTMLElement): boolean {
    if (this.#visibleHost?.contains(element)) {
      return true;
    }
    const hiddenHost = element.closest?.('.presentation-editor__hidden-host');
    return hiddenHost instanceof HTMLElement && this.#ownedHiddenHosts.has(hiddenHost);
  }

  /**
   * Set up the header/footer session manager with dependencies and callbacks.
   */
  #setupHeaderFooterSession() {
    if (!this.#headerFooterSession) return;

    // Update the editor reference (was set to null during construction)
    this.#headerFooterSession.setEditor(this.#editor);

    // Set up dependencies
    this.#headerFooterSession.setDependencies({
      getLayoutOptions: () => this.#layoutOptions,
      getPageElement: (pageIndex) => this.#getPageElement(pageIndex),
      scrollPageIntoView: (pageIndex) => this.#scrollPageIntoView(pageIndex),
      waitForPageMount: (pageIndex, options) => this.#waitForPageMount(pageIndex, options),
      convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
      isViewLocked: () => this.#isViewLocked(),
      getBodyPageHeight: () => this.#getBodyPageHeight(),
      notifyInputBridgeTargetChanged: () => this.#inputBridge?.notifyTargetChanged(),
      scheduleRerender: () => this.#scheduleRerender(),
      setPendingDocChange: () => {
        this.#pendingDocChange = true;
      },
      getBodyPageCount: () => this.#layoutState?.layout?.pages?.length ?? 1,
      getDocumentMode: () => this.#getEffectiveDocumentMode(),
      getStorySessionManager: () => this.#ensureStorySessionManager(),
    });

    // Set up callbacks
    this.#headerFooterSession.setCallbacks({
      onModeChanged: (session) => {
        this.emit('headerFooterModeChanged', {
          mode: session.mode,
          kind: session.kind,
          headerId: session.headerFooterRefId,
          sectionType: session.sectionType,
          pageIndex: session.pageIndex,
          pageNumber: session.pageNumber,
        });
        this.#refreshEditorDomAugmentations();
        this.#updateAwarenessSession();
      },
      onEditingContext: (data) => {
        this.emit('headerFooterEditingContext', data);

        // Clean up any previous header/footer selection listener
        if (this.#headerFooterEditor && this.#headerFooterSelectionHandler) {
          this.#headerFooterEditor.off?.('selectionUpdate', this.#headerFooterSelectionHandler);
          this.#headerFooterEditor = null;
          this.#headerFooterSelectionHandler = null;
        }

        if (data.kind === 'body') {
          this.#announce('Exited header/footer edit mode.');
          // Ensure the selection overlay is immediately resynced to the body
          // editor when leaving header/footer mode, so any stale header/footer
          // highlights are cleared.
          this.#scheduleSelectionUpdate({ immediate: true });
        } else {
          this.#announce(`Editing ${data.kind === 'header' ? 'Header' : 'Footer'} (${data.sectionType ?? 'default'})`);

          // Wire selection updates from the active header/footer editor into
          // the shared selection overlay + aria-live announcements.
          const headerFooterEditor = data.editor;
          const handler = () => {
            this.#scheduleSelectionUpdate();
            this.#scheduleA11ySelectionAnnouncement();
          };
          headerFooterEditor.on?.('selectionUpdate', handler);
          this.#headerFooterEditor = headerFooterEditor;
          this.#headerFooterSelectionHandler = handler;

          // Also trigger an initial selection sync immediately on entry so the
          // body selection overlay is cleared or updated to match the current
          // header/footer selection state, instead of leaving stale body
          // highlights until the first selectionUpdate event fires.
          this.#scheduleSelectionUpdate({ immediate: true });
          this.#scheduleA11ySelectionAnnouncement({ immediate: true });
        }

        this.#syncActiveSurfaceUiEventBridge();
        this.#publishActiveSurfaceChange();
      },
      onEditBlocked: (reason) => {
        this.emit('headerFooterEditBlocked', { reason });
      },
      onError: (data) => {
        this.emit('error', data);
      },
      onAnnounce: (message) => {
        this.#announce(message);
      },
      onUpdateAwarenessSession: () => {
        this.#updateAwarenessSession();
      },
      onSurfaceUpdate: ({ sourceEditor, surface, headerId, sectionType }) => {
        this.emit('headerFooterUpdate', {
          editor: this.#editor,
          sourceEditor,
          surface,
          headerId,
          sectionType,
        });
      },
      onSurfaceTransaction: ({ sourceEditor, surface, headerId, sectionType, transaction, duration }) => {
        const documentTransaction =
          transaction && typeof transaction === 'object' ? (transaction as { docChanged?: boolean }) : null;
        if (documentTransaction?.docChanged) {
          if (headerId) {
            this.#invalidateTrackedChangesForStory({
              kind: 'story',
              storyType: 'headerFooterPart',
              refId: headerId,
            });
            this.#headerFooterSession?.invalidateLayoutForRefs([headerId]);
          }
          this.#flowBlockCache.setHasExternalChanges?.(true);
          this.#pendingDocChange = true;
          this.#selectionSync.onLayoutStart();
          this.#scheduleRerender();
          this.#emitCommentPositions();
        }
        this.emit('headerFooterTransaction', {
          editor: this.#editor,
          sourceEditor,
          surface,
          headerId,
          sectionType,
          transaction,
          duration,
        });
      },
    });

    // Initialize the registry
    this.#headerFooterSession.initialize();
  }

  #teardownStorySessionEventBridge(): void {
    if (this.#storySessionEditor) {
      if (this.#storySessionSelectionHandler) {
        this.#storySessionEditor.off?.('selectionUpdate', this.#storySessionSelectionHandler);
      }
      if (this.#storySessionTransactionHandler) {
        this.#storySessionEditor.off?.('transaction', this.#storySessionTransactionHandler);
      }
    }
    this.#storySessionEditor = null;
    this.#storySessionSelectionHandler = null;
    this.#storySessionTransactionHandler = null;
  }

  #teardownActiveSurfaceUiEventBridge(): void {
    if (this.#activeSurfaceUiEventEditor) {
      if (this.#activeSurfaceUiUpdateHandler) {
        this.#activeSurfaceUiEventEditor.off?.('update', this.#activeSurfaceUiUpdateHandler);
      }
      if (this.#activeSurfaceUiContextMenuOpenHandler) {
        this.#activeSurfaceUiEventEditor.off?.('contextMenu:open', this.#activeSurfaceUiContextMenuOpenHandler);
      }
      if (this.#activeSurfaceUiContextMenuCloseHandler) {
        this.#activeSurfaceUiEventEditor.off?.('contextMenu:close', this.#activeSurfaceUiContextMenuCloseHandler);
      }
    }

    this.#activeSurfaceUiEventEditor = null;
    this.#activeSurfaceUiUpdateHandler = null;
    this.#activeSurfaceUiContextMenuOpenHandler = null;
    this.#activeSurfaceUiContextMenuCloseHandler = null;
  }

  #syncActiveSurfaceUiEventBridge(editor: Editor | null = this.getActiveEditor()): void {
    const nextEditor = editor ?? null;
    if (nextEditor === this.#activeSurfaceUiEventEditor) {
      return;
    }

    this.#teardownActiveSurfaceUiEventBridge();
    if (!nextEditor) {
      return;
    }

    const updateHandler = (event?: { transaction?: Transaction }) => {
      this.emit('update', {
        ...(event ?? {}),
        editor: this,
      });
    };
    const contextMenuOpenHandler = (event?: { menuPosition?: { left?: string; top?: string } }) => {
      this.emit('contextMenu:open', event ?? {});
    };
    const contextMenuCloseHandler = () => {
      this.emit('contextMenu:close');
    };

    nextEditor.on?.('update', updateHandler);
    nextEditor.on?.('contextMenu:open', contextMenuOpenHandler);
    nextEditor.on?.('contextMenu:close', contextMenuCloseHandler);
    this.#activeSurfaceUiEventEditor = nextEditor;
    this.#activeSurfaceUiUpdateHandler = updateHandler;
    this.#activeSurfaceUiContextMenuOpenHandler = contextMenuOpenHandler;
    this.#activeSurfaceUiContextMenuCloseHandler = contextMenuCloseHandler;
  }

  #syncStorySessionEventBridge(session: StoryPresentationSession | null): void {
    this.#teardownStorySessionEventBridge();

    if (!session) {
      this.#scheduleSelectionUpdate({ immediate: true });
      return;
    }

    const handler = () => {
      this.#scheduleSelectionUpdate();
      this.#scheduleA11ySelectionAnnouncement();
    };
    const transactionHandler = ({ transaction }: { transaction?: { docChanged?: boolean } }) => {
      if (!transaction?.docChanged) {
        return;
      }

      this.#syncActiveStorySessionHistoryTransaction(session);

      if (session.kind === 'note') {
        this.#invalidateTrackedChangesForStory(session.locator);
        this.#pendingDocChange = true;
        this.#selectionSync.onLayoutStart();
        this.#scheduleRerender();
      }
    };

    session.editor.on?.('selectionUpdate', handler);
    session.editor.on?.('transaction', transactionHandler);
    this.#storySessionEditor = session.editor;
    this.#storySessionSelectionHandler = handler;
    this.#storySessionTransactionHandler = transactionHandler;
    this.#scheduleSelectionUpdate({ immediate: true });
    this.#scheduleA11ySelectionAnnouncement({ immediate: true });
    this.#syncActiveSurfaceUiEventBridge();
  }

  #resolveStorySessionHistoryParticipantKey(session: StoryPresentationSession): string | null {
    const locator = session.locator;
    if (locator.kind !== 'story') {
      return null;
    }

    if (locator.storyType === 'headerFooterPart') {
      return buildHeaderFooterParticipantKey(locator.refId);
    }

    if (locator.storyType === 'footnote' || locator.storyType === 'endnote') {
      return buildStoryKey(locator);
    }

    return null;
  }

  #syncActiveStorySessionHistoryTransaction(session: StoryPresentationSession): void {
    const participantKey = this.#resolveStorySessionHistoryParticipantKey(session);
    if (!participantKey) {
      return;
    }

    this.#debugUnifiedHistory('Reconciling active story-session history transaction.', {
      participantKey,
      sessionKind: session.kind,
    });
    this.#historyCoordinator?.syncParticipant(participantKey);
  }

  #syncActiveStorySessionDocumentMode(session: StoryPresentationSession | null): void {
    if (!session) {
      return;
    }

    if (session.kind === 'headerFooter') {
      this.#headerFooterSession?.setDocumentMode(this.#documentMode);
      this.#headerFooterSession?.syncEditorDocumentMode(session.editor);
      return;
    }

    const editor = session.editor;
    const mode = this.#getStoryEditorParentDocumentMode(editor) ?? this.#getEffectiveDocumentMode();
    const isEditorHandledMode =
      !editor.options?.isHeaderOrFooter &&
      !editor.options?.isChildEditor &&
      typeof editor.setDocumentMode === 'function';

    if (isEditorHandledMode) {
      session.editor.setDocumentMode(mode);
      return;
    }

    this.#applyStorySessionDocumentMode(editor, mode);
  }

  #getEffectiveDocumentMode(): 'editing' | 'viewing' | 'suggesting' {
    const mode = this.#editor?.options?.documentMode;
    if (mode === 'editing' || mode === 'viewing' || mode === 'suggesting') {
      return mode;
    }
    return this.#documentMode;
  }

  #getActiveEditorDocumentMode(): 'editing' | 'viewing' | 'suggesting' | null {
    const mode = this.getActiveEditor()?.options?.documentMode;
    return mode === 'editing' || mode === 'viewing' || mode === 'suggesting' ? mode : null;
  }

  #getStoryEditorParentDocumentMode(editor: Editor): 'editing' | 'viewing' | 'suggesting' | null {
    const parent = (editor.options as { parentEditor?: Editor } | undefined)?.parentEditor;
    const mode = parent?.options?.documentMode;
    return mode === 'editing' || mode === 'viewing' || mode === 'suggesting' ? mode : null;
  }

  #applyStorySessionDocumentMode(editor: Editor, mode: 'editing' | 'viewing' | 'suggesting'): void {
    if (mode === 'viewing') {
      editor.commands?.enableTrackChangesShowOriginal?.();
      editor.setOptions?.({ documentMode: 'viewing' });
      editor.setEditable?.(false);
    } else if (mode === 'suggesting') {
      editor.commands?.disableTrackChangesShowOriginal?.();
      editor.commands?.enableTrackChanges?.();
      editor.setOptions?.({ documentMode: 'suggesting' });
      editor.setEditable?.(true);
    } else {
      editor.commands?.disableTrackChangesShowOriginal?.();
      editor.commands?.disableTrackChanges?.();
      editor.setOptions?.({ documentMode: 'editing' });
      editor.setEditable?.(true);
    }

    const pm = editor.view?.dom ?? null;
    if (pm instanceof HTMLElement) {
      pm.setAttribute('aria-readonly', mode === 'viewing' ? 'true' : 'false');
      pm.setAttribute('documentmode', mode);
      pm.classList.toggle('view-mode', mode === 'viewing');
    }
  }

  /**
   * Ensure unified history points at the concrete editor instance backing the
   * active story session.
   *
   * Header/footer sessions are intended to reuse the persistent registry
   * editor, but wiring can still legitimately rebind across lifecycle edges
   * (manager refreshes, hidden-host remounts, hot reload, etc.). Re-registering
   * the active session editor is safe because the coordinator preserves global
   * entries by participant key while swapping the underlying adapter.
   */
  #syncActiveStorySessionHistoryParticipant(session: StoryPresentationSession | null): void {
    const coordinator = this.#historyCoordinator;
    if (!coordinator || !session) {
      return;
    }

    const locator = session.locator;
    if (session.kind !== 'headerFooter' || locator.kind !== 'story' || locator.storyType !== 'headerFooterPart') {
      return;
    }

    const surfaceKind = session.editor.options.headerFooterType === 'footer' ? 'footer' : 'header';
    this.#debugUnifiedHistory('Syncing active header/footer session editor into coordinator.', {
      refId: locator.refId,
      surface: surfaceKind,
    });
    coordinator.register(
      createHeaderFooterParticipant(session.editor, {
        id: locator.refId,
        kind: surfaceKind,
      }),
    );
    this.#syncUnifiedHistoryParticipantPins();
  }

  #invalidateTrackedChangesForStory(locator: StoryLocator): void {
    try {
      getTrackedChangeIndex(this.#editor).invalidate(locator);
    } catch {
      // Tracked-change sync is best-effort while a live story session is typing.
    }
  }

  #ensureStorySessionManager(): StoryPresentationSessionManager {
    if (this.#storySessionManager) {
      return this.#storySessionManager;
    }

    this.#storySessionManager = new StoryPresentationSessionManager({
      resolveRuntime: (locator) => resolveStoryRuntime(this.#editor, locator, { intent: 'write' }),
      getMountContainer: () => {
        const doc = this.#visibleHost?.ownerDocument;
        return doc?.body ?? this.#visibleHost ?? null;
      },
      editorFactory: (input) => this.#createStorySessionEditor(input),
      onActiveSessionChanged: () => {
        const activeSession = this.#storySessionManager?.getActiveSession() ?? null;
        if (activeSession?.hostWrapper) {
          this.#wrapOffscreenEditorFocus(activeSession.editor);
        }
        this.#syncActiveStorySessionHistoryParticipant(activeSession);
        this.#syncActiveStorySessionDocumentMode(activeSession);
        this.#syncStorySessionEventBridge(activeSession);
        this.#syncActiveSurfaceUiEventBridge();
        this.#publishActiveSurfaceChange();
        this.#inputBridge?.notifyTargetChanged();
      },
    });

    return this.#storySessionManager;
  }

  /**
   * Factory used by the StoryPresentationSessionManager to obtain an editor
   * for a given story runtime. Routing rules:
   *
   *   1. Header/footer → reuse the persistent registry editor when possible.
   *   2. Note/endnote → when unified history is on, reuse the registry-
   *      backed editor so its local history outlives session exit. New
   *      editors are registered and own their hidden-host teardown.
   *   3. Anything else → create a fresh hidden-host editor and let the
   *      session's `dispose` destroy it on exit.
   */
  #createStorySessionEditor(input: StorySessionEditorFactoryInput): StorySessionEditorFactoryResult {
    const { runtime, hostElement, activationOptions } = input;
    const editorContext = activationOptions.editorContext ?? {};
    // Every story-session editor mounts into this host; record it so the
    // input bridge can recognize the editor as ours (SD-3249).
    this.#ownedHiddenHosts.add(hostElement);

    if (runtime.kind === 'headerFooter' && runtime.locator.storyType === 'headerFooterPart') {
      const descriptor = this.#headerFooterSession?.manager?.getDescriptorById(runtime.locator.refId) ?? null;
      const persisted = descriptor
        ? (this.#headerFooterSession?.manager?.ensureEditorSync(descriptor, {
            editorHost: hostElement,
            availableWidth: editorContext.availableWidth,
            availableHeight: editorContext.availableHeight,
            currentPageNumber: editorContext.currentPageNumber,
            currentPageNumberText: editorContext.currentPageNumberText,
            currentPageDisplayNumber: editorContext.currentPageDisplayNumber,
            currentPageChapterNumberText: editorContext.currentPageChapterNumberText,
            currentPageChapterSeparator: editorContext.currentPageChapterSeparator,
            totalPageCount: editorContext.totalPageCount,
            sectionPageCount: editorContext.sectionPageCount,
          }) ?? null)
        : null;

      if (persisted) {
        return { editor: persisted };
      }
    }

    if (runtime.kind === 'note' && this.#noteEditorRegistry) {
      return this.#createNoteSessionEditor(input);
    }

    return this.#createFreshStorySessionEditor(input);
  }

  /**
   * Create a fresh hidden-host story editor for a new session. The session
   * owns disposal via the returned callback.
   */
  #createFreshStorySessionEditor(input: StorySessionEditorFactoryInput): StorySessionEditorFactoryResult {
    const { runtime, hostElement, activationOptions } = input;
    const editorContext = activationOptions.editorContext ?? {};
    const pmJson = runtime.editor.getJSON() as unknown as Record<string, unknown>;
    const headerFooterRefId = runtime.locator.storyType === 'headerFooterPart' ? runtime.locator.refId : undefined;
    const fresh = createStoryEditor(this.#editor, pmJson, {
      documentId: runtime.storyKey,
      isHeaderOrFooter: runtime.kind === 'headerFooter',
      headless: false,
      element: hostElement,
      currentPageNumber: editorContext.currentPageNumber,
      currentPageNumberText: editorContext.currentPageNumberText,
      currentPageDisplayNumber: editorContext.currentPageDisplayNumber,
      currentPageChapterNumberText: editorContext.currentPageChapterNumberText,
      currentPageChapterSeparator: editorContext.currentPageChapterSeparator,
      totalPageCount: editorContext.totalPageCount,
      sectionPageCount: editorContext.sectionPageCount,
      editorOptions: headerFooterRefId ? { headerFooterRefId } : undefined,
    });

    return {
      editor: fresh,
      dispose: () => {
        try {
          fresh.destroy();
        } catch {
          // best-effort teardown
        }
      },
    };
  }

  /**
   * Reuse an existing registry-backed note editor when one is tracked;
   * otherwise create a fresh editor and register it so subsequent sessions
   * can reuse it and the coordinator can reach its local history.
   */
  #createNoteSessionEditor(input: StorySessionEditorFactoryInput): StorySessionEditorFactoryResult {
    const registry = this.#noteEditorRegistry;
    if (!registry) return this.#createFreshStorySessionEditor(input);

    const { runtime, hostElement } = input;
    const locator = runtime.locator;
    if (locator.storyType !== 'footnote' && locator.storyType !== 'endnote') {
      return this.#createFreshStorySessionEditor(input);
    }

    const commitHook = (runtime.commitEditor ?? null) as NoteCommitHook | null;
    const existing = registry.get(runtime.storyKey);
    if (existing) {
      if (commitHook) registry.setCommitHook(runtime.storyKey, commitHook);
      this.#remountStorySessionEditor(existing, hostElement);
      registry.touch(runtime.storyKey);
      return { editor: existing };
    }

    const fresh = this.#createFreshStorySessionEditor(input);
    registry.register({
      storyKey: runtime.storyKey,
      locator,
      editor: fresh.editor,
      commit: commitHook,
    });
    if (fresh.dispose) {
      registry.attachDisposer(runtime.storyKey, fresh.dispose);
    }
    // The session should NOT dispose the editor on exit — the registry owns it.
    return { editor: fresh.editor };
  }

  /**
   * Move a reused story editor into the session's newly-created hidden host.
   *
   * StoryPresentationSessionManager creates a fresh hidden wrapper on every
   * activation and removes the previous wrapper on exit. Reused note editors
   * therefore need a fresh ProseMirror view mounted into the new host; keeping
   * the old live view attached to a detached subtree leaves native focus/input
   * behavior tied to DOM that is no longer in the document.
   */
  #remountStorySessionEditor(editor: Editor, hostElement: HTMLElement): void {
    editor.setOptions({ element: hostElement });
    editor.unmount?.();
    editor.mount?.(hostElement);
  }

  /**
   * Set up the generic story-session manager.
   */
  #setupStorySessionManager() {
    this.#ensureStorySessionManager();
  }

  // ===========================================================================
  // Unified History Coordinator (enabled by default; explicit false disables)
  //
  // When the kill-switch is off, these helpers are no-ops so the legacy
  // active-editor-first routing stays intact.
  // ===========================================================================

  #isUnifiedHistoryEnabled(): boolean {
    return this.#options.experimental?.unifiedHistory !== false;
  }

  #isUnifiedHistoryDebugEnabled(): boolean {
    if (this.#options.isDebug) return true;
    const debugGlobal = globalThis as UnifiedHistoryDebugGlobal;
    return debugGlobal.__SD_DEBUG_UNIFIED_HISTORY__ === true;
  }

  #debugUnifiedHistory(message: string, detail?: Record<string, unknown>): void {
    if (!this.#isUnifiedHistoryDebugEnabled()) {
      return;
    }

    if (detail && Object.keys(detail).length > 0) {
      console.debug('[PresentationEditor][UnifiedHistory]', message, detail);
      return;
    }

    console.debug('[PresentationEditor][UnifiedHistory]', message);
  }

  #recordNoteHitDebug(entry: Record<string, unknown>): void {
    const debugGlobal = globalThis as Record<string, unknown>;
    if (debugGlobal.__SD_DEBUG_NOTE_HIT__ !== true) {
      return;
    }

    const existingLog = Array.isArray(debugGlobal.__SD_DEBUG_NOTE_HIT_LOG__)
      ? (debugGlobal.__SD_DEBUG_NOTE_HIT_LOG__ as Array<Record<string, unknown>>)
      : [];

    existingLog.push(entry);
    if (existingLog.length > 100) {
      existingLog.splice(0, existingLog.length - 100);
    }

    debugGlobal.__SD_DEBUG_NOTE_HIT_LOG__ = existingLog;
  }

  /**
   * Initialize the document-wide history coordinator when the kill-switch is
   * not disabled, register the body participant, and wire header/footer and
   * note/endnote participants to their respective lifecycle sources.
   */
  #setupUnifiedHistoryCoordinator(): void {
    if (!this.#isUnifiedHistoryEnabled()) {
      this.#debugUnifiedHistory('Coordinator disabled by configuration.', {
        documentId: this.#options.documentId ?? null,
      });
      return;
    }

    const coordinator = new DocumentHistoryCoordinator({
      onDiagnostic: (message, detail) => this.#debugUnifiedHistory(message, detail),
    });
    this.#historyCoordinator = coordinator;
    this.#debugUnifiedHistory('Coordinator enabled.', {
      documentId: this.#options.documentId ?? null,
    });

    const registry = new NoteEditorRegistry({
      onBeforeAutoDispose: (storyKey) => coordinator.purge(storyKey, 'capacity-eviction'),
    });
    this.#noteEditorRegistry = registry;

    coordinator.register(createBodyParticipant(this.#editor));

    const unbindChange = coordinator.onChange(() => {
      this.#syncUnifiedHistoryParticipantPins();
      this.#debugUnifiedHistory('Coordinator state changed.', {
        state: coordinator.getState(),
        reachableKeys: Array.from(coordinator.getReachableKeys()),
      });
      this.emit('historyStateChange', coordinator.getState());
    });
    const unbindPurge = coordinator.onPurge(() => {
      this.#syncUnifiedHistoryParticipantPins();
    });
    const unbindCue = coordinator.onCue((event: UnifiedHistoryCueEvent) => {
      this.#announce(this.#formatUnifiedHistoryCue(event));
      this.emit('unifiedHistoryCue', event);
    });
    this.#historyCoordinatorCleanup.push(unbindChange, unbindPurge, unbindCue);

    this.#bindHeaderFooterParticipants(coordinator);
    this.#bindNoteParticipants(coordinator, registry);
    this.#syncUnifiedHistoryParticipantPins();
    this.#publishActiveSurfaceChange(true);
  }

  /**
   * Wire the note-editor registry into the coordinator so each note/endnote
   * editor becomes a participant the moment it is registered. Pinning is
   * derived from reachable global history, not from mere editor existence.
   */
  #bindNoteParticipants(coordinator: DocumentHistoryCoordinator, registry: NoteEditorRegistry): void {
    const handleCreated = (payload: {
      storyKey: string;
      editor: Editor;
      locator: { storyType: 'footnote' | 'endnote' };
    }) => {
      this.#debugUnifiedHistory('Registering note participant.', {
        storyKey: payload.storyKey,
        storyType: payload.locator.storyType,
      });
      const participant = createNoteParticipant({
        storyKey: payload.storyKey,
        storyType: payload.locator.storyType,
        editor: payload.editor,
        flushAfterReplay: () => this.#flushNoteAfterReplay(payload.storyKey, payload.editor),
        onInvalidated: () => this.#purgeNoteRegistryEntry(registry, payload.storyKey),
      });
      coordinator.register(participant);
      this.#syncUnifiedHistoryParticipantPins();
    };

    const handleDisposed = (payload: { storyKey: string }) => {
      if (this.#coordinatorDrivenNotePurges.has(payload.storyKey)) {
        return;
      }
      this.#debugUnifiedHistory('Disposing note participant.', {
        storyKey: payload.storyKey,
      });
      if (coordinator.hasParticipant(payload.storyKey)) {
        coordinator.purge(payload.storyKey, 'destroyed');
      }
      this.#syncUnifiedHistoryParticipantPins();
    };

    registry.on('editorCreated', handleCreated);
    registry.on('editorDisposed', handleDisposed);

    this.#historyCoordinatorCleanup.push(
      () => registry.off('editorCreated', handleCreated),
      () => registry.off('editorDisposed', handleDisposed),
    );
  }

  /**
   * Commit the coordinator-driven note state back to the canonical OOXML
   * part and schedule a rerender. This is the difference that makes dormant
   * note replay render visibly — without it the DOM would still show the
   * pre-undo content.
   */
  #flushNoteAfterReplay(storyKey: string, noteEditor: Editor): void {
    const commitHook = this.#noteEditorRegistry?.getCommitHook(storyKey);
    if (commitHook) {
      try {
        commitHook(this.#editor, noteEditor);
      } catch (error) {
        console.warn('[PresentationEditor] Note commit after replay failed:', error);
      }
    }
    this.#pendingDocChange = true;
    this.#scheduleRerender();
  }

  /**
   * Wire the HeaderFooterEditorManager's lifecycle into the coordinator so
   * each persistent header/footer editor becomes a participant the moment it
   * is created. LRU pinning is reconciled from reachable global history.
   */
  #bindHeaderFooterParticipants(coordinator: DocumentHistoryCoordinator): void {
    const manager = this.#headerFooterSession?.manager;
    if (!manager) return;

    const handleCreated = (payload: { descriptor: { id: string; kind: 'header' | 'footer' }; editor: Editor }) => {
      this.#debugUnifiedHistory('Registering header/footer participant.', {
        refId: payload.descriptor.id,
        surface: payload.descriptor.kind,
      });
      const participant = createHeaderFooterParticipant(payload.editor, payload.descriptor);
      coordinator.register(participant);
      this.#syncUnifiedHistoryParticipantPins();
    };

    const handleDisposed = (payload: { descriptor: { id: string } }) => {
      const key = buildHeaderFooterParticipantKey(payload.descriptor.id);
      this.#debugUnifiedHistory('Disposing header/footer participant.', {
        refId: payload.descriptor.id,
        participantKey: key,
      });
      // The editor is gone — its reachable history cannot be replayed safely.
      coordinator.purge(key, 'destroyed');
      this.#syncUnifiedHistoryParticipantPins();
    };

    manager.on('editorCreated', handleCreated as (...args: unknown[]) => void);
    manager.on('editorDisposed', handleDisposed as (...args: unknown[]) => void);

    this.#historyCoordinatorCleanup.push(
      () => manager.off?.('editorCreated', handleCreated as (...args: unknown[]) => void),
      () => manager.off?.('editorDisposed', handleDisposed as (...args: unknown[]) => void),
    );
  }

  #purgeNoteRegistryEntry(registry: NoteEditorRegistry, storyKey: string): void {
    if (this.#coordinatorDrivenNotePurges.has(storyKey)) {
      return;
    }
    this.#coordinatorDrivenNotePurges.add(storyKey);
    try {
      registry.purge(storyKey, 'purge');
    } finally {
      this.#coordinatorDrivenNotePurges.delete(storyKey);
    }
  }

  #syncUnifiedHistoryParticipantPins(): void {
    const coordinator = this.#historyCoordinator;
    if (!coordinator) return;

    const reachableKeys = coordinator.getReachableKeys();
    const headerFooterManager = this.#headerFooterSession?.manager;
    const noteRegistry = this.#noteEditorRegistry;

    if (headerFooterManager && typeof headerFooterManager.getDescriptors === 'function') {
      headerFooterManager.getDescriptors().forEach((descriptor) => {
        const participantKey = buildHeaderFooterParticipantKey(descriptor.id);
        if (!coordinator.hasParticipant(participantKey)) {
          return;
        }

        const shouldPin = reachableKeys.has(participantKey);
        coordinator.setPinned(participantKey, shouldPin);
        if (shouldPin) {
          headerFooterManager.pin?.(descriptor.id);
          return;
        }
        headerFooterManager.unpin?.(descriptor.id);
      });
    }

    if (!noteRegistry) {
      return;
    }

    noteRegistry.keys().forEach((storyKey) => {
      if (!coordinator.hasParticipant(storyKey)) {
        return;
      }

      const shouldPin = reachableKeys.has(storyKey);
      coordinator.setPinned(storyKey, shouldPin);
      if (shouldPin) {
        noteRegistry.pin(storyKey);
        return;
      }
      noteRegistry.unpin(storyKey);
    });
  }

  #publishActiveSurfaceChange(force = false): void {
    const surface = this.#resolveActiveSurface();
    this.#historyCoordinator?.setActiveSurface(surface);
    if (!force && surface === this.#lastPublishedActiveSurface) {
      return;
    }
    this.#lastPublishedActiveSurface = surface;
    this.#debugUnifiedHistory('Active surface changed.', { surface });
    this.emit('activeSurfaceChange', { surface });
  }

  #formatUnifiedHistoryCue(event: UnifiedHistoryCueEvent): string {
    const action = event.action === 'undo' ? 'Undid' : 'Redid';
    switch (event.surface) {
      case 'header':
        return `${action} change in Header.`;
      case 'footer':
        return `${action} change in Footer.`;
      case 'note':
        return `${action} change in Footnote.`;
      case 'endnote':
        return `${action} change in Endnote.`;
      default:
        return `${action} change in Document.`;
    }
  }

  /**
   * Drop any coordinator entries whose header/footer editor's canonical
   * part just changed out from under us. Replaying stale history against
   * an externally-rewritten part would corrupt the document — purging is
   * the safe default.
   */
  #purgeHeaderFooterParticipantsOnExternalInvalidation(refIds: readonly string[]): void {
    const coordinator = this.#historyCoordinator;
    if (!coordinator) return;
    refIds.forEach((refId) => {
      coordinator.purge(buildHeaderFooterParticipantKey(refId), 'external-invalidation');
    });
  }

  /**
   * Drop all note/endnote participants because external notes-part mutations
   * (e.g. inserting or deleting a note via the document API) invalidate every
   * dormant note editor we hold. Future sessions will re-resolve from the
   * updated part.
   */
  #purgeAllNoteParticipantsOnExternalInvalidation(): void {
    const coordinator = this.#historyCoordinator;
    const registry = this.#noteEditorRegistry;
    if (!coordinator || !registry) return;
    registry.keys().forEach((storyKey) => {
      coordinator.purge(storyKey, 'external-invalidation');
    });
  }

  #teardownUnifiedHistoryCoordinator(): void {
    this.#historyCoordinatorCleanup.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.warn('[PresentationEditor] Unified history cleanup failed:', error);
      }
    });
    this.#historyCoordinatorCleanup.length = 0;
    this.#historyCoordinator?.destroy();
    this.#historyCoordinator = null;
    this.#noteEditorRegistry?.destroy();
    this.#noteEditorRegistry = null;
    this.#coordinatorDrivenNotePurges.clear();
    this.#lastPublishedActiveSurface = null;
  }

  /**
   * Attempts to perform a table hit test for the given normalized coordinates.
   *
   * @param normalizedX - X coordinate in layout space
   * @param normalizedY - Y coordinate in layout space
   * @returns TableHitResult if the point is inside a table cell, null otherwise
   * @private
   */
  #hitTestTable(normalizedX: number, normalizedY: number): TableHitResult | null {
    const configuredPageHeight = (this.#layoutOptions.pageSize ?? DEFAULT_PAGE_SIZE).h;
    return hitTestTableFromHelper(
      this.#layoutState.layout,
      this.#layoutState.blocks,
      this.#layoutState.measures,
      normalizedX,
      normalizedY,
      configuredPageHeight,
      this.#getEffectivePageGap(),
      this.#pageGeometryHelper,
    );
  }

  /**
   * Selects the word at the given document position.
   *
   * This method traverses up the document tree to find the nearest textblock ancestor,
   * then expands the selection to word boundaries using Unicode-aware word character
   * detection. This handles cases where the position is within nested structures like
   * list items or table cells.
   *
   * Algorithm:
   * 1. Traverse ancestors until a textblock is found (paragraphs, headings, list items)
   * 2. From the click position, expand backward while characters match word regex
   * 3. Expand forward while characters match word regex
   * 4. Create a text selection spanning the word boundaries
   *
   * @param pos - The absolute document position where the double-click occurred
   * @returns true if a word was selected successfully, false otherwise
   * @private
   */
  #selectWordAt(pos: number): boolean {
    const activeEditor = this.getActiveEditor();
    const state = activeEditor.state;
    if (!state?.doc) {
      return false;
    }

    const range = computeWordSelectionRangeAtFromHelper(state, pos);
    if (!range) {
      return false;
    }

    const tr = state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to));
    try {
      activeEditor.view?.dispatch(tr);
      return true;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to select word:', error);
      }
      return false;
    }
  }

  /**
   * Selects the entire paragraph (textblock) at the given document position.
   *
   * This method traverses up the document tree to find the nearest textblock ancestor,
   * then selects from its start to end position. This handles cases where the position
   * is within nested structures like list items or table cells.
   *
   * Algorithm:
   * 1. Traverse ancestors until a textblock is found (paragraphs, headings, list items)
   * 2. Select from textblock.start() to textblock.end()
   *
   * @param pos - The absolute document position where the triple-click occurred
   * @returns true if a paragraph was selected successfully, false otherwise
   * @private
   */
  #selectParagraphAt(pos: number): boolean {
    const activeEditor = this.getActiveEditor();
    const state = activeEditor.state;
    if (!state?.doc) {
      return false;
    }
    const range = computeParagraphSelectionRangeAtFromHelper(state, pos);
    if (!range) {
      return false;
    }
    const tr = state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to));
    try {
      activeEditor.view?.dispatch(tr);
      return true;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to select paragraph:', error);
      }
      return false;
    }
  }

  /**
   * Calculates extended selection boundaries based on the current extension mode.
   *
   * This helper method consolidates the logic for extending selections to word or paragraph
   * boundaries, used by both shift+click and drag selection handlers. It preserves selection
   * directionality by placing the head on the side where the user is clicking/dragging.
   *
   * @param anchor - The anchor position of the selection (fixed point)
   * @param head - The head position of the selection (moving point)
   * @param mode - The extension mode: 'char' (no extension), 'word', or 'para'
   * @returns Object with selAnchor and selHead positions after applying extension
   * @private
   */
  #calculateExtendedSelection(
    anchor: number,
    head: number,
    mode: 'char' | 'word' | 'para',
  ): { selAnchor: number; selHead: number } {
    return calculateExtendedSelection(this.#layoutState.blocks, anchor, head, mode);
  }

  /**
   * Refreshes header/footer descriptors from the converter, invalidates cached
   * layout input, and schedules a presentation rerender. Used when full-document
   * hydration bypasses normal `partChanged` wiring (`collaborationReady`,
   * `documentReplaced`).
   */
  #refreshHeaderFooterStructureThenRerender(options?: { purgeCachedEditors?: boolean }): void {
    this.#headerFooterSession?.refreshStructure(options);
    this.#flowBlockCache.setHasExternalChanges?.(true);
    this.#pendingDocChange = true;
    this.#selectionSync.onLayoutStart();
    this.#scheduleRerender();
  }

  #beginCompositionDeferral(): void {
    this.#isComposing = true;
  }

  #endCompositionDeferral(): void {
    if (!this.#isComposing) return;
    this.#isComposing = false;

    if (this.#pendingDocChange && !this.#renderScheduled && !this.#isRerendering) {
      this.#scheduleRerender();
    }
  }

  #resetCompositionDeferral(): void {
    this.#isComposing = false;
  }

  #handleNonComposingInputForCompositionDeferral = (event: Event): void => {
    if ('isComposing' in event && (event as InputEvent).isComposing === false) {
      this.#endCompositionDeferral();
    }
  };

  /**
   * SD-2368: defer visible layout repaints while an IME composition is active.
   * Visible-host listeners are permanent; the active hidden target's listeners
   * are swapped by #refreshCompositionDeferralTarget() on target changes.
   */
  #setupCompositionDeferral(): void {
    this.#teardownCompositionDeferral();

    const add = (target: EventTarget | null | undefined, type: string, handler: EventListener) => {
      if (!target) return;
      target.addEventListener(type, handler);
      this.#compositionDeferralCleanup.push(() => target.removeEventListener(type, handler));
    };

    const begin = () => this.#beginCompositionDeferral();
    const end = () => this.#endCompositionDeferral();

    add(this.#visibleHost, 'compositionstart', begin);
    add(this.#visibleHost, 'compositionend', end);
    add(this.#visibleHost, 'input', this.#handleNonComposingInputForCompositionDeferral);
    add(this.#visibleHost, 'beforeinput', this.#handleNonComposingInputForCompositionDeferral);
  }

  #teardownCompositionDeferral(): void {
    this.#compositionTargetCleanup.forEach((cleanup) => cleanup());
    this.#compositionTargetCleanup = [];
    this.#compositionTargetDom = null;
    this.#compositionDeferralCleanup.forEach((cleanup) => cleanup());
    this.#compositionDeferralCleanup = [];
    this.#resetCompositionDeferral();
  }

  /**
   * Re-points composition deferral listeners at the current active hidden editor
   * DOM (body, header/footer, or story session). The input bridge dispatches a
   * synthetic compositionend to the old target before this runs, so pending
   * deferred work resumes before listeners move.
   */
  #refreshCompositionDeferralTarget(): void {
    const nextTarget = this.#getActiveDomTarget();
    if (nextTarget === this.#compositionTargetDom) return;

    this.#compositionTargetCleanup.forEach((cleanup) => cleanup());
    this.#compositionTargetCleanup = [];
    this.#compositionTargetDom = nextTarget;

    if (!nextTarget) {
      this.#endCompositionDeferral();
      return;
    }

    const begin = () => this.#beginCompositionDeferral();
    const end = () => this.#endCompositionDeferral();

    nextTarget.addEventListener('compositionstart', begin);
    nextTarget.addEventListener('compositionend', end);
    nextTarget.addEventListener('blur', end);
    nextTarget.addEventListener('focusout', end);
    nextTarget.addEventListener('beforeinput', this.#handleNonComposingInputForCompositionDeferral);
    this.#compositionTargetCleanup.push(() => nextTarget.removeEventListener('compositionstart', begin));
    this.#compositionTargetCleanup.push(() => nextTarget.removeEventListener('compositionend', end));
    this.#compositionTargetCleanup.push(() => nextTarget.removeEventListener('blur', end));
    this.#compositionTargetCleanup.push(() => nextTarget.removeEventListener('focusout', end));
    this.#compositionTargetCleanup.push(() =>
      nextTarget.removeEventListener('beforeinput', this.#handleNonComposingInputForCompositionDeferral),
    );
  }

  #scheduleRerender() {
    if (this.#renderScheduled) {
      return;
    }
    this.#renderScheduled = true;
    const win = this.#visibleHost.ownerDocument?.defaultView ?? window;
    this.#rafHandle = win.requestAnimationFrame(() => {
      this.#renderScheduled = false;
      this.#flushRerenderQueue().catch((error) => {
        this.#handleLayoutError('render', error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async #flushRerenderQueue() {
    if (this.#isRerendering) {
      this.#pendingDocChange = true;
      return;
    }
    if (!this.#pendingDocChange) {
      return;
    }
    // SD-2368: keep #pendingDocChange/#pendingMapping intact while composing;
    // #endCompositionDeferral() schedules the post-composition rerender.
    if (this.#isComposing) {
      return;
    }
    this.#pendingDocChange = false;
    this.#isRerendering = true;

    // Capture H/F editor focus state before rerender so we can restore it if
    // a DOM mutation (e.g. page re-ordering in updateVirtualWindow) causes the
    // browser to blur the active header/footer editor (SD-1993).
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    const activeHfEditor = sessionMode !== 'body' ? this.#headerFooterSession?.activeEditor : null;
    const hadHfFocus = activeHfEditor?.view?.hasFocus?.() ?? false;

    try {
      await this.#rerender();
    } finally {
      this.#isRerendering = false;
      if (this.#pendingDocChange) {
        this.#scheduleRerender();
      }

      // Restore focus if the H/F editor lost it during rerender.
      // Guard: only restore if the session is still active with the same editor
      // (user may have exited H/F mode during the async rerender).
      if (hadHfFocus && activeHfEditor?.view && this.#headerFooterSession?.activeEditor === activeHfEditor) {
        const doc = this.#visibleHost.ownerDocument;
        const editorDom = activeHfEditor.view.dom;
        if (doc && !editorDom.contains(doc.activeElement)) {
          try {
            activeHfEditor.view.focus();
          } catch {
            // Ignore focus errors during recovery
          }
        }
      }
    }
  }

  async #rerender() {
    this.#selectionSync.onLayoutStart();
    let layoutCompleted = false;

    try {
      let docJson;
      const viewWindow = this.#visibleHost.ownerDocument?.defaultView ?? window;
      const perf = viewWindow?.performance ?? GLOBAL_PERFORMANCE;
      const perfNow = () => (perf?.now ? perf.now() : Date.now());
      const startMark = perf?.now?.();
      try {
        const getJsonStart = perfNow();
        docJson = this.#editor.getJSON();
        const getJsonEnd = perfNow();
        perfLog(`[Perf] getJSON: ${(getJsonEnd - getJsonStart).toFixed(2)}ms`);
      } catch (error) {
        this.#handleLayoutError('render', this.#decorateError(error, 'getJSON'));
        return;
      }
      const layoutEpoch = this.#epochMapper.getCurrentEpoch();

      const sectionMetadata: SectionMetadata[] = [];
      let blocks: FlowBlock[] | undefined;
      let bookmarks: Map<string, number> = new Map();
      // TODO(footnote): the block below (settings read → numbering → cache
      // signatures → converterContext) is OOXML-semantics work that doesn't
      // belong in PresentationEditor (see layout-engine CLAUDE.md). Extract
      // a `buildFootnoteConverterContext` helper alongside computeNoteNumbering
      // so the cache-signature dance lives in one place and is testable in
      // isolation. Deferred from PR SD-2656 review per reviewer's offer.
      let converterContext: ConverterContext | undefined = undefined;
      try {
        const converter = (this.#editor as Editor & { converter?: Record<string, unknown> }).converter;

        // §17.11.12 (document-wide) + §17.11.11 (section-level) — read both layers.
        let defaultTableStyleId: string | undefined;
        let footnoteNumberFormat: string | undefined;
        let endnoteNumberFormat: string | undefined;
        let footnoteNumberStart = 1;
        let endnoteNumberStart = 1;
        let footnoteNumberRestart: 'continuous' | 'eachPage' | 'eachSect' | undefined;
        let endnoteNumberRestart: 'continuous' | 'eachPage' | 'eachSect' | undefined;
        let footnotePosition: 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd' | undefined;
        let endnotePosition: 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd' | undefined;
        let footnoteSectionConfigs = new Map<number, SectionNoteConfig>();
        let endnoteSectionConfigs = new Map<number, SectionNoteConfig>();
        if (converter) {
          const settingsRoot = readSettingsRoot(converter);
          if (settingsRoot) {
            defaultTableStyleId = readDefaultTableStyle(settingsRoot) ?? undefined;
            footnoteNumberFormat = readFootnoteNumberFormat(settingsRoot) ?? undefined;
            endnoteNumberFormat = readEndnoteNumberFormat(settingsRoot) ?? undefined;
            footnoteNumberStart = readFootnoteNumberStart(settingsRoot) ?? 1;
            endnoteNumberStart = readEndnoteNumberStart(settingsRoot) ?? 1;
            footnoteNumberRestart = readFootnoteNumberRestart(settingsRoot) ?? undefined;
            endnoteNumberRestart = readEndnoteNumberRestart(settingsRoot) ?? undefined;
            // §17.11.21 — document-level only; section-level pos is ignored.
            footnotePosition = readFootnotePosition(settingsRoot) ?? undefined;
            endnotePosition = readEndnotePosition(settingsRoot) ?? undefined;
          }
          const documentPart = (converter.convertedXml as Record<string, unknown> | undefined)?.['word/document.xml'];
          if (documentPart) {
            footnoteSectionConfigs = readSectionNoteConfigs(documentPart as never, 'w:footnotePr');
            endnoteSectionConfigs = readSectionNoteConfigs(documentPart as never, 'w:endnotePr');
          }
        }

        // §17.11.19 numRestart=eachPage — requires a per-ref page-assignment
        // map from a prior layout pass. The numbering runs BEFORE pagination,
        // so refPageById is not available here. Coerce to `continuous` and
        // warn once so the doc renders deterministic ordinals instead of
        // silently rendering "continuous-looking but supposedly per-page"
        // numbers. Wiring a real eachPage pass requires a two-pass handshake
        // (number → layout → re-number → re-layout).
        if (footnoteNumberRestart === 'eachPage') {
          this.#warnUnsupportedNumberingRestart('footnote');
          footnoteNumberRestart = 'continuous';
        }
        if (endnoteNumberRestart === 'eachPage') {
          this.#warnUnsupportedNumberingRestart('endnote');
          endnoteNumberRestart = 'continuous';
        }
        // Section-level overrides may also request eachPage; coerce the same
        // way so the helper never sees a value it cannot honor.
        for (const [secIndex, cfg] of footnoteSectionConfigs) {
          if (cfg.numRestart === 'eachPage') {
            footnoteSectionConfigs.set(secIndex, { ...cfg, numRestart: 'continuous' });
            this.#warnUnsupportedNumberingRestart('footnote');
          }
        }
        for (const [secIndex, cfg] of endnoteSectionConfigs) {
          if (cfg.numRestart === 'eachPage') {
            endnoteSectionConfigs.set(secIndex, { ...cfg, numRestart: 'continuous' });
            this.#warnUnsupportedNumberingRestart('endnote');
          }
        }

        // §17.11.14 / §17.11.20 / §17.11.19 / §17.11.11.
        const footnoteNumbering = computeNoteNumbering(this.#editor?.state, 'footnoteReference', {
          startCounter: footnoteNumberStart,
          defaultNumFmt: footnoteNumberFormat,
          defaultRestart: footnoteNumberRestart,
          sectionConfigs: footnoteSectionConfigs,
        });
        const footnoteNumberById = footnoteNumbering.numberById;
        const footnoteFormatById = footnoteNumbering.formatById;
        const footnoteOrder = footnoteNumbering.order;
        // Cache key: anything baked into cached reference runs.
        const footnoteSignature = `${footnoteNumberStart}|${footnoteNumberFormat ?? ''}|${footnoteNumberRestart ?? ''}|${serializeSectionConfigs(footnoteSectionConfigs)}|${serializePerIdNumbering(footnoteOrder, footnoteNumberById, footnoteFormatById)}`;
        if (footnoteSignature !== this.#footnoteNumberSignature) {
          this.#flowBlockCache.clear();
          this.#footnoteNumberSignature = footnoteSignature;
        }
        const endnoteNumbering = computeNoteNumbering(this.#editor?.state, 'endnoteReference', {
          startCounter: endnoteNumberStart,
          defaultNumFmt: endnoteNumberFormat,
          defaultRestart: endnoteNumberRestart,
          sectionConfigs: endnoteSectionConfigs,
        });
        const endnoteNumberById = endnoteNumbering.numberById;
        const endnoteFormatById = endnoteNumbering.formatById;
        const endnoteOrder = endnoteNumbering.order;
        const endnoteSignature = `${endnoteNumberStart}|${endnoteNumberFormat ?? ''}|${endnoteNumberRestart ?? ''}|${serializeSectionConfigs(endnoteSectionConfigs)}|${serializePerIdNumbering(endnoteOrder, endnoteNumberById, endnoteFormatById)}`;
        if (endnoteSignature !== this.#endnoteNumberSignature) {
          this.#flowBlockCache.clear();
          this.#endnoteNumberSignature = endnoteSignature;
        }

        // Expose numbering to node views and layout adapter.
        try {
          if (converter && typeof converter === 'object') {
            converter['footnoteNumberById'] = footnoteNumberById;
            converter['endnoteNumberById'] = endnoteNumberById;
          }
        } catch {}

        // SD-3240: converter.convertedXml / translatedLinkedStyles /
        // translatedNumbering are typed on the public surface as
        // narrower (unknown-bearing) shapes than ConverterContext
        // requires. Cast at the boundary; the runtime values match
        // the shape ConverterContext expects.
        converterContext = converter
          ? ({
              docx: converter.convertedXml,
              ...(Object.keys(footnoteNumberById).length ? { footnoteNumberById } : {}),
              ...(Object.keys(endnoteNumberById).length ? { endnoteNumberById } : {}),
              ...(footnoteNumberFormat ? { footnoteNumberFormat } : {}),
              ...(endnoteNumberFormat ? { endnoteNumberFormat } : {}),
              ...(footnoteFormatById && Object.keys(footnoteFormatById).length ? { footnoteFormatById } : {}),
              ...(endnoteFormatById && Object.keys(endnoteFormatById).length ? { endnoteFormatById } : {}),
              ...(footnotePosition ? { footnotePosition } : {}),
              ...(endnotePosition ? { endnotePosition } : {}),
              translatedLinkedStyles: converter.translatedLinkedStyles,
              translatedNumbering: converter.translatedNumbering,
              ...(defaultTableStyleId ? { defaultTableStyleId } : {}),
            } as unknown as ConverterContext)
          : undefined;
        const atomNodeTypes = getAtomNodeTypesFromSchema(this.#editor?.schema ?? null);
        const positionMapStart = perfNow();
        const positionMap =
          this.#editor?.state?.doc && docJson ? buildPositionMapFromPmDoc(this.#editor.state.doc, docJson) : null;
        const positionMapEnd = perfNow();
        perfLog(`[Perf] buildPositionMapFromPmDoc: ${(positionMapEnd - positionMapStart).toFixed(2)}ms`);
        const commentsEnabled =
          this.#documentMode !== 'viewing' || this.#layoutOptions.enableCommentsInViewing === true;
        const toFlowBlocksStart = perfNow();
        const result = toFlowBlocks(docJson, {
          mediaFiles: (this.#editor?.storage?.image as { media?: Record<string, string> })?.media,
          emitSectionBreaks: true,
          sectionMetadata,
          trackedChangesMode: this.#trackedChangesMode,
          enableTrackedChanges: this.#trackedChangesEnabled,
          resolveTrackedChangeColor: this.#layoutOptions.resolveTrackedChangeColor,
          enableComments: commentsEnabled,
          enableRichHyperlinks: true,
          // SD-3240: converter.themeColors is `unknown` on the public
          // EditorConverterSurface; cast to the consumer-expected type
          // here. The runtime shape matches at call time.
          themeColors: (this.#editor?.converter?.themeColors ?? undefined) as Record<string, string> | undefined,
          converterContext,
          flowBlockCache: this.#flowBlockCache,
          showBookmarks: this.#layoutOptions.showBookmarks ?? false,
          ...(positionMap ? { positions: positionMap } : {}),
          ...(atomNodeTypes.length > 0 ? { atomNodeTypes } : {}),
        });
        const toFlowBlocksEnd = perfNow();
        perfLog(
          `[Perf] toFlowBlocks: ${(toFlowBlocksEnd - toFlowBlocksStart).toFixed(2)}ms (blocks=${result.blocks.length})`,
        );
        blocks = result.blocks;
        bookmarks = result.bookmarks ?? new Map();
      } catch (error) {
        this.#handleLayoutError('render', this.#decorateError(error, 'toFlowBlocks'));
        return;
      }

      if (!blocks) {
        this.#handleLayoutError('render', new Error('toFlowBlocks returned undefined blocks'));
        return;
      }

      // Split runs at decoration boundaries so bridge sync applies background only to the
      // selected portion (like highlight mark) without adding a document mark.
      const state = this.#editor?.view?.state;
      const decorationRanges = state ? this.#postPaintPipeline.collectDecorationRanges(state) : [];
      if (decorationRanges.length > 0) {
        blocks = splitRunsAtDecorationBoundaries(
          blocks,
          decorationRanges.map((r) => ({ from: r.from, to: r.to })),
        );
      }

      this.#applyHtmlAnnotationMeasurements(blocks);
      const isSemanticFlow = this.#isSemanticFlowMode();

      const baseLayoutOptions = this.#resolveLayoutOptions(blocks, sectionMetadata);
      const activeFootnoteOverride = this.#buildActiveNoteRenderOverride('footnote');
      const footnotesLayoutInput = buildFootnotesInput(
        this.#editor?.state,
        (this.#editor as EditorWithConverter)?.converter,
        converterContext,
        this.#editor?.converter?.themeColors ?? undefined,
        activeFootnoteOverride,
        this.#layoutOptions.resolveTrackedChangeColor,
      );
      const semanticFootnoteBlocks = isSemanticFlow
        ? buildSemanticFootnoteBlocks(footnotesLayoutInput, this.#layoutOptions.semanticOptions?.footnotesMode)
        : [];
      const activeEndnoteOverride = this.#buildActiveNoteRenderOverride('endnote');
      const endnoteBlocks = buildEndnoteBlocks(
        this.#editor?.state,
        (this.#editor as EditorWithConverter)?.converter,
        converterContext,
        this.#editor?.converter?.themeColors ?? undefined,
        activeEndnoteOverride,
        this.#layoutOptions.resolveTrackedChangeColor,
      );
      const blocksForLayout =
        semanticFootnoteBlocks.length > 0 || endnoteBlocks.length > 0
          ? [...blocks, ...semanticFootnoteBlocks, ...endnoteBlocks]
          : blocks;
      const layoutOptions =
        !isSemanticFlow && footnotesLayoutInput
          ? { ...baseLayoutOptions, footnotes: footnotesLayoutInput }
          : baseLayoutOptions;
      const previousBlocks = this.#layoutState.blocks;
      const previousLayout = this.#layoutState.layout;
      const previousMeasures = this.#layoutState.measures;
      // Per-document font context for this render: a FACE-aware resolver bound into the measure
      // callback (measurement uses THIS document's physical substitute per weight/style), and the
      // render plan's effectiveSignature (assigned below, after the plan is built) as the measure-cache
      // key. previousFontSignature is the signature the prior measures were produced with - if it
      // differs, incrementalLayout must not reuse them (the reuse fast path bypasses the cache key).
      const resolvePhysical: ResolvePhysicalFamily = (css, face) =>
        this.#fontResolver.resolvePhysicalFamilyForFace(css, face, this.#hasFace);
      // Cache identity is the render plan's effectiveSignature (face-aware), assigned once the plan is
      // built below - NOT resolver.signature (family map only), which would miss a fonts.add() that
      // changes a face's resolution without changing the map. The single context object (resolver +
      // signature) is built AFTER the plan so the measure callback and cache signature can never
      // drift - both come from `fontMeasureContext`.
      let fontSignature = '';
      const previousFontSignature = this.#layoutFontSignature;
      // Declared here (outer scope) so the incrementalLayout call below can see it; REBUILT after the
      // plan with the face-aware effectiveSignature. Initialized with '' so it is always defined even
      // if font planning throws (the readiness try/catch swallows errors and must not break layout).
      let fontMeasureContext = { resolvePhysical, fontSignature };

      let layout: Layout;
      let measures: Measure[];
      let resolvedLayout: ReturnType<typeof resolveLayout>;
      let bodyBlocksForPaint: FlowBlock[] = blocksForLayout;
      let bodyMeasuresForPaint: Measure[] = [];
      let headerLayouts: HeaderFooterLayoutResult[] | undefined;
      let footerLayouts: HeaderFooterLayoutResult[] | undefined;
      let extraBlocks: FlowBlock[] | undefined;
      let extraMeasures: Measure[] | undefined;
      let resolveBlocks: FlowBlock[] = blocksForLayout;
      let resolveMeasures: Measure[] = previousMeasures;
      // Build the header/footer layout input BEFORE the gate so its faces are planned too:
      // a font used only in a header/footer is still measured (via incrementalLayout below),
      // so it must load before measure or it reflows on late load. Reused unchanged for the
      // incrementalLayout call and the per-rId header/footer pass.
      const headerFooterInput = this.#buildHeaderFooterInput();
      // Load-before-measure gate (T3): wait for the fonts this document needs so the first
      // measurement pass uses real metrics instead of a fallback that would reflow on load.
      // Bounded by a per-font timeout; resolves to the cached summary once fonts are stable;
      // never throws, so font readiness can never block layout.
      try {
        // Stash every text source this render measures so the gate's planner awaits the exact
        // used faces: body + notes (blocksForLayout), header/footer blocks, and - in paginated
        // mode - footnote blocks (measured via layoutOptions.footnotes, NOT in blocksForLayout;
        // semantic mode already folds footnotes into blocksForLayout). One planner input;
        // planFontFaces dedups, so any overlap is harmless.
        this.#fontPlanBlocks = [
          ...blocksForLayout,
          ...(headerFooterInput ? this.#collectHeaderFooterFaceBlocks(headerFooterInput) : []),
          ...(!isSemanticFlow && footnotesLayoutInput?.blocksById
            ? [...footnotesLayoutInput.blocksById.values()].flat()
            : []),
        ];
        // ONE render font plan from this walk (the single source): the gate awaits its requiredFaces,
        // the report uses its usedFaces, and its effectiveSignature is the measure/paint cache identity.
        // Built before the gate runs so load, report, resolution, and cache identity all agree.
        this.#fontPlan = planFontFaces(this.#fontPlanBlocks, this.#fontResolver, this.#hasFace);
        fontSignature = this.#fontPlan.effectiveSignature;
        // Rebuild with the face-aware effectiveSignature now the plan exists, so the measure callback
        // and the cache signature can never drift: both the face-aware resolver and the fontSignature
        // passed to incrementalLayout come from this one object.
        fontMeasureContext = { resolvePhysical, fontSignature };
        const fontSummary = (await this.#fontGate?.ensureReadyForMeasure()) ?? null;
        // Now that the gate has settled, the font report reflects real load status. Emit
        // the authoritative `fonts-changed` once the picture first resolves and whenever it
        // changes (a late-load bumps the gate epoch and re-renders through here).
        this.#emitFontsChangedIfChanged(fontSummary);
      } catch {
        /* font readiness must never break layout */
      }

      try {
        const incrementalLayoutStart = perfNow();
        const result = await incrementalLayout(
          previousBlocks,
          previousLayout,
          blocksForLayout,
          layoutOptions,
          (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) =>
            measureBlock(block, constraints, fontMeasureContext),
          headerFooterInput ?? undefined,
          previousMeasures,
          // Same context object the measure callback uses, so the cache signature and the resolver
          // cannot drift (the two-channel split is retired here).
          { fontContext: fontMeasureContext, previousFontSignature },
          // SD-3432: warm-start the footnote convergence with the previous
          // render's fixed point; the layout run re-validates it in full.
          { footnoteReserveSeed: this.#footnoteReserveSeed },
        );
        this.#footnoteReserveSeed = result?.footnoteReserveSeed ?? null;
        const incrementalLayoutEnd = perfNow();
        perfLog(`[Perf] incrementalLayout: ${(incrementalLayoutEnd - incrementalLayoutStart).toFixed(2)}ms`);

        // Type guard: validate incrementalLayout return value
        if (!result || typeof result !== 'object') {
          this.#handleLayoutError('render', new Error('incrementalLayout returned invalid result'));
          return;
        }
        if (!result.layout || typeof result.layout !== 'object') {
          this.#handleLayoutError('render', new Error('incrementalLayout returned invalid layout'));
          return;
        }
        if (!Array.isArray(result.measures)) {
          this.#handleLayoutError('render', new Error('incrementalLayout returned invalid measures'));
          return;
        }

        ({ layout, measures } = result);
        extraBlocks = Array.isArray(result.extraBlocks) ? result.extraBlocks : undefined;
        extraMeasures = Array.isArray(result.extraMeasures) ? result.extraMeasures : undefined;
        // Add pageGap to layout for hit testing to account for gaps between rendered pages.
        // Gap depends on virtualization mode and must be non-negative.
        layout.pageGap = this.#getEffectivePageGap();
        (layout as Layout & { layoutEpoch?: number }).layoutEpoch = layoutEpoch;

        // Include footnote-injected blocks (separators, footnote paragraphs) so
        // resolveLayout, painter lookups, and note/story navigation all operate
        // on the same block/measure set.
        bodyBlocksForPaint = extraBlocks ? [...blocksForLayout, ...extraBlocks] : blocksForLayout;
        bodyMeasuresForPaint = extraMeasures ? [...measures, ...extraMeasures] : measures;
        resolveBlocks = bodyBlocksForPaint;
        resolveMeasures = bodyMeasuresForPaint;

        resolvedLayout = resolveLayout({
          layout,
          flowMode: this.#layoutOptions.flowMode ?? 'paginated',
          blocks: bodyBlocksForPaint,
          measures: bodyMeasuresForPaint,
          fontSignature,
          bookmarks,
        });

        headerLayouts = result.headers;
        footerLayouts = result.footers;
      } catch (error) {
        this.#handleLayoutError('render', this.#decorateError(error, 'incrementalLayout'));
        return;
      }

      this.#sectionMetadata = sectionMetadata;
      // Build multi-section identifier from section metadata for section-aware header/footer selection.
      // Derive odd/even mode from current settings.xml-aware resolution (not only converter.pageStyles),
      // because collaborator sessions can have stale converter.pageStyles during remote hydration.
      // Pass converter's headerIds/footerIds as fallbacks for dynamically created headers/footers.
      const converter = (this.#editor as EditorWithConverter).converter;
      const multiSectionId = buildMultiSectionIdentifier(
        sectionMetadata,
        { alternateHeaders: this.#resolveAlternateHeadersFlag() },
        {
          headerIds: converter?.headerIds,
          footerIds: converter?.footerIds,
        },
      );
      if (this.#headerFooterSession) {
        this.#headerFooterSession.multiSectionIdentifier = multiSectionId;
      }
      const anchorMap = computeAnchorMapFromHelper(bookmarks, layout, blocksForLayout);
      this.#layoutState = { blocks: blocksForLayout, measures, layout, bookmarks, anchorMap };
      // Record the signature these measures were produced with, so the next render can gate
      // previous-measure reuse on whether the mapping changed (see #layoutFontSignature).
      this.#layoutFontSignature = fontSignature;
      this.#layoutLookupBlocks = resolveBlocks;
      this.#layoutLookupMeasures = resolveMeasures;

      // Build blockId → pageNumber map for TOC page-number resolution.
      // Stored on editor.storage so the document-api adapter layer can read it
      // when toc.update({ mode: 'pageNumbers' }) is called.
      // pageMapDoc is the doc snapshot this map was derived from — the adapter
      // layer compares it against editor.state.doc to reject stale maps.
      const tocStorage = (
        this.#editor as unknown as { storage?: Record<string, { pageMap?: Map<string, number>; pageMapDoc?: unknown }> }
      ).storage?.tableOfContents;
      if (tocStorage) {
        const pageMap = new Map<string, number>();
        for (const page of layout.pages) {
          for (const fragment of page.fragments) {
            // First occurrence wins — use the page where the block first appears
            if (!pageMap.has(fragment.blockId)) {
              pageMap.set(fragment.blockId, page.number);
            }
          }
        }
        tocStorage.pageMap = pageMap;
        tocStorage.pageMapDoc = this.#editor.state.doc;
      }
      if (this.#headerFooterSession) {
        this.#headerFooterSession.headerLayoutResults = headerLayouts ?? null;
        this.#headerFooterSession.footerLayoutResults = footerLayouts ?? null;
      }

      // Initialize or update PageGeometryHelper when layout changes
      if (this.#layoutState.layout) {
        const pageGap = this.#layoutState.layout.pageGap ?? this.#getEffectivePageGap();
        if (!this.#pageGeometryHelper) {
          this.#pageGeometryHelper = new PageGeometryHelper({
            layout: this.#layoutState.layout,
            pageGap,
          });
        } else {
          this.#pageGeometryHelper.updateLayout(this.#layoutState.layout, pageGap);
        }
      }

      // Process per-rId header/footer content and decoration providers (paginated only)
      if (!isSemanticFlow) {
        await this.#layoutPerRIdHeaderFooters(headerFooterInput, layout, sectionMetadata);
        this.#updateDecorationProviders(resolvedLayout);
      }

      this.#ensurePainter();
      if (!isSemanticFlow) {
        this.#painterAdapter.setProviders(
          this.#headerFooterSession?.headerDecorationProvider,
          this.#headerFooterSession?.footerDecorationProvider,
        );
      }

      // Avoid MutationObserver overhead while repainting large DOM trees.
      this.#domIndexObserverManager?.pause();
      // Pass the transaction mapping for efficient position attribute updates.
      // Consumed here and cleared to prevent stale mappings on subsequent paints.
      const mapping = this.#pendingMapping;
      this.#pendingMapping = null;
      const painterPaintStart = perfNow();
      const paintInput: DomPainterInput = {
        resolvedLayout,
      };
      this.#painterAdapter.paint(paintInput, this.#painterHost, mapping ?? undefined);
      const painterPaintEnd = perfNow();
      perfLog(`[Perf] painter.paint: ${(painterPaintEnd - painterPaintStart).toFixed(2)}ms`);
      const painterPostStart = perfNow();
      this.#refreshEditorDomAugmentations();
      this.#domIndexObserverManager?.resume();
      const painterPostEnd = perfNow();
      perfLog(`[Perf] painter.postPaint: ${(painterPostEnd - painterPostStart).toFixed(2)}ms`);
      this.#layoutEpoch = layoutEpoch;
      if (this.#updateHtmlAnnotationMeasurements(layoutEpoch)) {
        this.#pendingDocChange = true;
        this.#scheduleRerender();
      }
      this.#epochMapper.onLayoutComplete(layoutEpoch);
      this.#selectionSync.onLayoutComplete(layoutEpoch);
      layoutCompleted = true;
      this.#revalidateScrollContainer();
      this.#updatePermissionOverlay();

      // Reset error state on successful layout
      this.#layoutError = null;
      this.#layoutErrorState = 'healthy';
      this.#dismissErrorBanner();

      // Update viewport dimensions after layout (page count may have changed)
      this.#applyZoom();

      const metrics = createLayoutMetricsFromHelper(perf, startMark, layout, blocksForLayout);
      const payload = { layout, blocks: blocksForLayout, measures, metrics };
      this.emit('layoutUpdated', payload);
      this.emit('paginationUpdate', payload);

      // SD-3400: fragments are rebuilt on every paint — re-apply the active
      // note highlight and complete any pending scroll-to-note.
      this.#noteSessionCoordinator?.onPaint();

      // Emit fresh comment positions after layout completes.
      // Always emit — even when empty — so the store can clear stale positions
      // (e.g. when undo removes the last tracked-change mark).
      this.#emitCommentPositions();

      this.#selectionSync.requestRender({ immediate: true });

      // Re-normalize remote cursor positions after layout completes.
      // Local document changes shift absolute positions, so Yjs relative positions
      // must be re-resolved against the updated editor state. Without this,
      // remote cursors appear offset by the number of characters the local user typed.
      if (this.#remoteCursorManager?.hasRemoteCursors()) {
        this.#remoteCursorManager.markDirty();
        this.#remoteCursorManager.scheduleUpdate();
      }
    } finally {
      if (!layoutCompleted) {
        this.#selectionSync.onLayoutAbort();
      }
    }
  }

  #ensurePainter(): void {
    if (this.#painterAdapter.hasPainter) {
      return;
    }

    // Ensure the virtualization gap matches the effective page gap so that
    // DomPainter's spacer/offset math stays consistent with #applyZoom() height calculations.
    const virtualization = this.#layoutOptions.virtualization;
    const effectiveGap = this.#getEffectivePageGap();
    const normalizedVirtualization = virtualization?.enabled
      ? { ...virtualization, gap: virtualization.gap ?? effectiveGap }
      : virtualization;

    this.#painterAdapter.ensurePainter({
      layoutMode: this.#layoutOptions.layoutMode ?? 'vertical',
      flowMode: this.#layoutOptions.flowMode ?? 'paginated',
      virtualization: normalizedVirtualization,
      pageStyles: this.#layoutOptions.pageStyles,
      headerProvider: this.#headerFooterSession?.headerDecorationProvider,
      footerProvider: this.#headerFooterSession?.footerDecorationProvider,
      ruler: this.#layoutOptions.ruler,
      pageGap: this.#layoutState.layout?.pageGap ?? effectiveGap,
      showFormattingMarks: this.#layoutOptions.showFormattingMarks ?? false,
      contentControlsChrome: this.#layoutOptions.contentControlsChrome ?? 'default',
      // Paint each run in THIS document's physical substitute - the same family measurement used -
      // so two editors that map a logical family differently never paint each other's font.
      resolvePhysical: (css: string, face: { weight: '400' | '700'; style: 'normal' | 'italic' }): string =>
        this.#fontResolver.resolvePhysicalFamilyForFace(css, face, this.#hasFace),
    });

    // Pass the current zoom so virtualization accounts for the CSS transform scale
    const currentZoom = this.#layoutOptions.zoom ?? 1;
    if (currentZoom !== 1) {
      this.#painterAdapter.setZoom(currentZoom);
    }
    // Pass the scroll container so virtualization computes scrollY relative to it,
    // not the browser viewport. This fixes offset errors when SuperDoc is mounted
    // inside a wrapper div with overflow-y: auto.
    if (this.#scrollContainer && this.#scrollContainer instanceof HTMLElement) {
      this.#painterAdapter.setScrollContainer(this.#scrollContainer);
    }
  }

  #applyHtmlAnnotationMeasurements(blocks: FlowBlock[]) {
    if (this.#htmlAnnotationHeights.size === 0) return;

    blocks.forEach((block) => {
      if (block.kind !== 'paragraph') return;

      block.runs.forEach((run) => {
        if (run.kind !== 'fieldAnnotation' || run.variant !== 'html') {
          return;
        }
        if (run.pmStart == null || run.pmEnd == null) {
          return;
        }

        const key = `${run.pmStart}-${run.pmEnd}`;
        const height = this.#htmlAnnotationHeights.get(key);
        if (!height || height <= 0) {
          return;
        }

        const currentSize = run.size ?? {};
        if (currentSize.height === height) {
          return;
        }

        run.size = { ...currentSize, height };
      });
    });
  }

  #updateHtmlAnnotationMeasurements(layoutEpoch: number): boolean {
    const nextHeights = new Map(this.#htmlAnnotationHeights);
    const threshold = 1;

    let changed = false;
    const annotations = this.#painterAdapter.getAnnotationEntitiesByType('html');
    annotations.forEach((annotation) => {
      const element = annotation.element;
      if (annotation.pmStart == null || annotation.pmEnd == null) {
        return;
      }
      const height = element.offsetHeight;
      if (height <= 0) {
        return;
      }
      const key = `${annotation.pmStart}-${annotation.pmEnd}`;
      const prev = nextHeights.get(key);
      if (prev != null && Math.abs(prev - height) <= threshold) {
        return;
      }
      nextHeights.set(key, height);
      changed = true;
    });

    if (layoutEpoch !== this.#htmlAnnotationMeasureEpoch) {
      this.#htmlAnnotationMeasureEpoch = layoutEpoch;
      this.#htmlAnnotationMeasureAttempts = 0;
    }

    this.#htmlAnnotationHeights = nextHeights;
    if (!changed) {
      return false;
    }

    if (this.#htmlAnnotationMeasureAttempts >= 2) {
      return false;
    }

    this.#htmlAnnotationMeasureAttempts += 1;
    return true;
  }

  /**
   * Requests a local selection overlay update.
   *
   * Selection rendering is coordinated by `SelectionSyncCoordinator` so we never
   * render against a layout that's mid-update (pagination/virtualization), and so
   * we only update when `layoutEpoch` has caught up to the current `docEpoch`.
   */
  #scheduleSelectionUpdate(options?: { immediate?: boolean }) {
    this.#selectionSync.requestRender(options);
  }

  #clearSelectedFieldAnnotationClass() {
    if (this.#lastSelectedFieldAnnotation?.element?.classList?.contains('ProseMirror-selectednode')) {
      this.#lastSelectedFieldAnnotation.element.classList.remove('ProseMirror-selectednode');
    }
    this.#lastSelectedFieldAnnotation = null;
  }

  #setSelectedFieldAnnotationClass(element: HTMLElement, pmStart: number) {
    if (this.#lastSelectedFieldAnnotation?.element && this.#lastSelectedFieldAnnotation.element !== element) {
      this.#lastSelectedFieldAnnotation.element.classList.remove('ProseMirror-selectednode');
    }
    element.classList.add('ProseMirror-selectednode');
    this.#lastSelectedFieldAnnotation = { element, pmStart };
  }

  #syncSelectedFieldAnnotationClass(selection: Selection | null | undefined) {
    if (!selection || !(selection instanceof NodeSelection)) {
      this.#clearSelectedFieldAnnotationClass();
      return;
    }

    const node = selection.node;
    if (!node || node.type?.name !== 'fieldAnnotation') {
      this.#clearSelectedFieldAnnotationClass();
      return;
    }

    if (!this.#painterHost) {
      this.#clearSelectedFieldAnnotationClass();
      return;
    }

    const pmStart = selection.from;
    if (this.#lastSelectedFieldAnnotation?.pmStart === pmStart && this.#lastSelectedFieldAnnotation.element) {
      return;
    }

    const element = this.#painterAdapter.getAnnotationElementByPmStart(pmStart);
    if (!element) {
      this.#clearSelectedFieldAnnotationClass();
      return;
    }

    this.#setSelectedFieldAnnotationClass(element, pmStart);
  }

  #clearSelectedStructuredContentBlockClass() {
    if (!this.#lastSelectedStructuredContentBlock) return;
    this.#lastSelectedStructuredContentBlock.elements.forEach((element) => {
      element.classList.remove('ProseMirror-selectednode');
    });
    this.#lastSelectedStructuredContentBlock.wrapperElements.forEach((element) => {
      element.classList.remove(DOM_CLASS_NAMES.SDT_CONTAINER_SELECTED);
    });
    this.#lastSelectedStructuredContentBlock.ancestorElements.forEach((element) => {
      element.classList.remove(DOM_CLASS_NAMES.SDT_ANCESTOR_SELECTED);
    });
    this.#lastSelectedStructuredContentBlock = null;
  }

  #setSelectedStructuredContentBlockClass(
    elements: HTMLElement[],
    wrapperElements: HTMLElement[],
    ancestorElements: HTMLElement[],
    id: string | null,
  ) {
    if (
      this.#lastSelectedStructuredContentBlock &&
      this.#lastSelectedStructuredContentBlock.id === id &&
      this.#lastSelectedStructuredContentBlock.elements.length === elements.length &&
      this.#lastSelectedStructuredContentBlock.elements.every((el) => elements.includes(el)) &&
      this.#lastSelectedStructuredContentBlock.wrapperElements.length === wrapperElements.length &&
      this.#lastSelectedStructuredContentBlock.wrapperElements.every((el) => wrapperElements.includes(el)) &&
      this.#lastSelectedStructuredContentBlock.ancestorElements.length === ancestorElements.length &&
      this.#lastSelectedStructuredContentBlock.ancestorElements.every((el) => ancestorElements.includes(el))
    ) {
      return;
    }

    this.#clearSelectedStructuredContentBlockClass();
    elements.forEach((element) => element.classList.add('ProseMirror-selectednode'));
    wrapperElements.forEach((element) => element.classList.add(DOM_CLASS_NAMES.SDT_CONTAINER_SELECTED));
    ancestorElements.forEach((element) => element.classList.add(DOM_CLASS_NAMES.SDT_ANCESTOR_SELECTED));
    this.#lastSelectedStructuredContentBlock = { id, elements, wrapperElements, ancestorElements };
  }

  #getStructuredContentBlockExactElementsById(id: string): HTMLElement[] {
    const indexed = this.#painterAdapter.getStructuredContentBlockElementsById(id);
    if (indexed.length > 0) return indexed;

    if (!this.#painterHost) return [];
    return Array.from(this.#painterHost.querySelectorAll<HTMLElement>(`.${DOM_CLASS_NAMES.BLOCK_SDT}`)).filter(
      (element) => element.dataset.sdtId === id,
    );
  }

  #getStructuredContentBlockWrapperElementsById(id: string): HTMLElement[] {
    if (!this.#painterHost) return [];
    return Array.from(this.#painterHost.querySelectorAll<HTMLElement>(`.${DOM_CLASS_NAMES.BLOCK_SDT}`)).filter(
      (element) => element.dataset.sdtId === id || element.dataset.sdtContainerId === id,
    );
  }

  #resolveSelectedStructuredContentBlockWrapperElements(id: string | null, elements: HTMLElement[]): HTMLElement[] {
    const wrapperElements = new Set<HTMLElement>();
    const visitedIds = new Set<string>();
    const pendingIds: string[] = [];

    const enqueueId = (candidate: string | null | undefined) => {
      if (!candidate || visitedIds.has(candidate)) return;
      visitedIds.add(candidate);
      pendingIds.push(candidate);
    };

    enqueueId(id);
    elements.forEach((element) => {
      wrapperElements.add(element);
      enqueueId(element.dataset.sdtId);
    });

    while (pendingIds.length > 0) {
      const currentId = pendingIds.shift();
      if (!currentId) continue;
      const currentElements = this.#getStructuredContentBlockWrapperElementsById(currentId);
      currentElements.forEach((element) => {
        wrapperElements.add(element);
        enqueueId(element.dataset.sdtId);
      });
    }

    return [...wrapperElements];
  }

  #resolveSelectedStructuredContentBlockAncestorElements(id: string | null, elements: HTMLElement[]): HTMLElement[] {
    const ancestorElements = new Set<HTMLElement>();
    const visitedIds = new Set<string>();
    const pendingIds: string[] = [];

    const enqueueId = (candidate: string | null | undefined) => {
      if (!candidate || candidate === id || visitedIds.has(candidate)) return;
      visitedIds.add(candidate);
      pendingIds.push(candidate);
    };

    elements.forEach((element) => enqueueId(element.dataset.sdtContainerId));

    while (pendingIds.length > 0) {
      const currentId = pendingIds.shift();
      if (!currentId) continue;
      const currentElements = this.#getStructuredContentBlockExactElementsById(currentId);
      currentElements.forEach((element) => {
        ancestorElements.add(element);
        enqueueId(element.dataset.sdtContainerId);
      });
    }

    return [...ancestorElements];
  }

  #syncSelectedStructuredContentBlockClass(selection: Selection | null | undefined) {
    if (!selection) {
      this.#clearSelectedStructuredContentBlockClass();
      return;
    }

    let node: ProseMirrorNode | null = null;
    let pos: number | null = null;
    let id: string | null = null;
    let fallbackPos: number | null = null;

    if (selection instanceof NodeSelection) {
      if (selection.node?.type?.name === 'structuredContentBlock') {
        node = selection.node;
        pos = selection.from;
      } else {
        fallbackPos = selection.from;
        const editorDoc = this.#editor?.view?.state?.doc;
        const resolved = editorDoc ? findStructuredContentBlockAtPos(editorDoc, selection.from) : null;
        if (!resolved) {
          this.#clearSelectedStructuredContentBlockClass();
          return;
        }
        node = resolved.node;
        pos = resolved.pos;
      }
    } else {
      const editorDoc = this.#editor?.view?.state?.doc;
      if (!editorDoc) {
        this.#clearSelectedStructuredContentBlockClass();
        return;
      }

      const resolved = findStructuredContentBlockAtPos(editorDoc, selection.from);
      if (!resolved) {
        this.#clearSelectedStructuredContentBlockClass();
        return;
      }

      node = resolved.node;
      pos = resolved.pos;
    }

    if (pos == null) {
      this.#clearSelectedStructuredContentBlockClass();
      return;
    }

    if (!this.#painterHost) {
      this.#clearSelectedStructuredContentBlockClass();
      return;
    }

    const rawId = (node.attrs as { id?: unknown } | null | undefined)?.id;
    id = rawId != null ? String(rawId) : null;
    let elements: HTMLElement[] = [];

    if (id) {
      elements = this.#painterAdapter.getStructuredContentBlockElementsById(id);
    }

    if (elements.length === 0) {
      const elementAtPos = this.getElementAtPos(pos, { fallbackToCoords: true });
      const container = elementAtPos?.closest?.(`.${DOM_CLASS_NAMES.BLOCK_SDT}`) as HTMLElement | null;
      if (container) {
        elements = [container];
      }
    }

    if (elements.length === 0 && fallbackPos != null && fallbackPos !== pos) {
      const elementAtFallbackPos = this.getElementAtPos(fallbackPos, { fallbackToCoords: true });
      const container = elementAtFallbackPos?.closest?.(`.${DOM_CLASS_NAMES.BLOCK_SDT}`) as HTMLElement | null;
      if (container) {
        elements = [container];
      }
    }

    if (elements.length === 0) {
      this.#clearSelectedStructuredContentBlockClass();
      return;
    }

    const wrapperElements = this.#resolveSelectedStructuredContentBlockWrapperElements(id, elements);
    const ancestorElements = this.#resolveSelectedStructuredContentBlockAncestorElements(id, elements);
    this.#setSelectedStructuredContentBlockClass(elements, wrapperElements, ancestorElements, id);
  }

  /**
   * Build the SDT and TOC hover coordinators. Called once after painterHost
   * and painterAdapter are ready. The two groups differ only in the entry
   * selector, id key, element lookup, and (for TOC) the gap-fill side effect
   * — everything else (mouseover/mouseout, cross-fragment retain, after-paint
   * reapply) lives in HoverGroupCoordinator.
   */
  #initializeHoverCoordinators(): void {
    if (this.#sdtHoverCoordinator || this.#tocHoverCoordinator) return;

    this.#sdtHoverCoordinator = new HoverGroupCoordinator({
      entrySelector: `.${DOM_CLASS_NAMES.BLOCK_SDT}`,
      getId: (entry) => entry.dataset.sdtId,
      queryGroup: (id) => this.#painterAdapter.getStructuredContentBlockElementsById(id),
      hoverClass: DOM_CLASS_NAMES.SDT_GROUP_HOVER,
      // PM-selected SDTs render with their selection style — leave it alone
      // so the hover greying doesn't mask the selection feedback.
      shouldApplyTo: (element) =>
        !element.classList.contains('ProseMirror-selectednode') &&
        !element.classList.contains(DOM_CLASS_NAMES.SDT_CONTAINER_SELECTED) &&
        !element.classList.contains(DOM_CLASS_NAMES.SDT_ANCESTOR_SELECTED),
    });

    this.#tocHoverCoordinator = new HoverGroupCoordinator({
      entrySelector: `.${DOM_CLASS_NAMES.TOC_ENTRY}`,
      getId: (entry) => entry.dataset.tocId,
      queryGroup: (id) => this.#queryTocEntryElementsById(id),
      hoverClass: DOM_CLASS_NAMES.TOC_GROUP_HOVER,
      onApply: (elements) => this.#applyTocGapFill(elements),
      onClear: (element) => element.style.removeProperty('--toc-gap-below'),
    });
  }

  /**
   * Each TOC entry is its own absolutely-positioned paragraph fragment, so
   * paragraph spacing leaves an unbacked strip between them. Write the gap to
   * `--toc-gap-below` and let the `::after` rule in styles.ts paint it.
   * Cross-page gaps are skipped so the strip doesn't draw over page breaks.
   */
  #applyTocGapFill(elements: HTMLElement[]): void {
    if (elements.length < 2) return;

    const measured = elements
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top);

    for (let i = 0; i < measured.length - 1; i++) {
      const current = measured[i];
      const next = measured[i + 1];

      const currentPage = current.element.closest('[data-page-index]');
      if (!currentPage || currentPage !== next.element.closest('[data-page-index]')) continue;

      // Divide by the painter's zoom transform so the strip matches the
      // fragment's untransformed CSS-pixel height. Pad by 1px to cover
      // sub-pixel rounding; the overlap falls on the next (also grey) entry.
      const rawGap = next.rect.top - current.rect.bottom;
      const scaleY =
        current.rect.height && current.element.offsetHeight ? current.rect.height / current.element.offsetHeight : 1;
      const gap = scaleY > 0 ? rawGap / scaleY : rawGap;
      if (gap > 0) {
        current.element.style.setProperty('--toc-gap-below', `${gap + 1}px`);
      }
    }
  }

  #queryTocEntryElementsById(id: string): HTMLElement[] {
    if (!this.#painterHost) return [];
    const escapedId = escapeAttrValue(id);
    return Array.from(
      this.#painterHost.querySelectorAll<HTMLElement>(`.${DOM_CLASS_NAMES.TOC_ENTRY}[data-toc-id="${escapedId}"]`),
    );
  }

  /**
   * Runs all editor-owned DOM augmentations after the painter has rendered.
   *
   * This is the single entry point for post-paint DOM modifications. Every
   * editor concern that needs to touch the painted DOM is called from here.
   *
   * Order is load-bearing:
   * 1. Field annotation interaction layer — adds caret-anchor spans with
   *    data-pm-start/end (must run before position index rebuild)
   * 2. DOM position index rebuild — indexes ALL elements with pm-position
   *    attributes, including caret-anchors added in step 1
   * 3. Inline style layers (comment highlights + decoration bridge)
   * 4. Proofing pass
   * 5. SDT hover reapplication — DOM elements rebuilt during repaint lose
   *    the hover class
   */
  #refreshEditorDomAugmentations(): void {
    this.#postPaintPipeline.refreshAfterPaint({
      layoutEpoch: this.#layoutEpoch,
      activeHeaderFooterMode: this.#headerFooterSession?.session?.mode ?? 'body',
      editorState: this.#editor?.view?.state,
      domPositionIndex: this.#domPositionIndex,
      proofingAnnotations: this.#buildProofingAnnotations(),
      rebuildDomPositionIndex: () => this.#rebuildDomPositionIndex(),
      reapplyStructuredContentHover: () => this.#sdtHoverCoordinator?.reapply(),
      reapplyTocGroupHover: () => this.#tocHoverCoordinator?.reapply(),
    });
  }

  #clearSelectedStructuredContentInlineClass() {
    if (!this.#lastSelectedStructuredContentInline) return;
    this.#lastSelectedStructuredContentInline.elements.forEach((element) => {
      element.classList.remove('ProseMirror-selectednode');
    });
    this.#lastSelectedStructuredContentInline = null;
  }

  #setSelectedStructuredContentInlineClass(elements: HTMLElement[], id: string | null) {
    if (
      this.#lastSelectedStructuredContentInline &&
      this.#lastSelectedStructuredContentInline.id === id &&
      this.#lastSelectedStructuredContentInline.elements.length === elements.length &&
      this.#lastSelectedStructuredContentInline.elements.every((el) => elements.includes(el))
    ) {
      return;
    }

    this.#clearSelectedStructuredContentInlineClass();
    elements.forEach((element) => element.classList.add('ProseMirror-selectednode'));
    this.#lastSelectedStructuredContentInline = { id, elements };
  }

  #syncSelectedStructuredContentInlineClass(selection: Selection | null | undefined) {
    if (!selection) {
      this.#clearSelectedStructuredContentInlineClass();
      return;
    }

    let node: ProseMirrorNode | null = null;
    let id: string | null = null;
    let pos: number | null = null;

    if (selection instanceof NodeSelection) {
      if (selection.node?.type?.name !== 'structuredContent') {
        this.#clearSelectedStructuredContentInlineClass();
        return;
      }
      node = selection.node;
      pos = selection.from;
    } else {
      const editorDoc = this.#editor?.view?.state?.doc;
      if (!editorDoc) {
        this.#clearSelectedStructuredContentInlineClass();
        return;
      }

      const resolved = findStructuredContentInlineAtPos(editorDoc, selection.from);
      if (!resolved) {
        this.#clearSelectedStructuredContentInlineClass();
        return;
      }

      node = resolved.node;
      pos = resolved.pos;
    }

    if (!this.#painterHost) {
      this.#clearSelectedStructuredContentInlineClass();
      return;
    }

    const rawId = (node.attrs as { id?: unknown } | null | undefined)?.id;
    id = rawId != null ? String(rawId) : null;
    let elements: HTMLElement[] = [];

    if (id) {
      elements = this.#painterAdapter.getStructuredContentInlineElementsById(id);
    }

    if (elements.length === 0) {
      const elementAtPos = this.getElementAtPos(pos, { fallbackToCoords: true });
      const container = elementAtPos?.closest?.(`.${DOM_CLASS_NAMES.INLINE_SDT_WRAPPER}`) as HTMLElement | null;
      if (container) {
        elements = [container];
      }
    }

    if (elements.length === 0) {
      this.#clearSelectedStructuredContentInlineClass();
      return;
    }

    this.#setSelectedStructuredContentInlineClass(elements, id);
  }

  /**
   * Updates the visual cursor/selection overlay to match the current editor selection.
   *
   * Handles several edge cases:
   * - Defers cursor clearing until new position is successfully computed
   * - Preserves existing cursor visibility when position cannot be computed
   * - Skips rendering in header/footer mode and viewing mode
   * - Skips rendering when the painted layout is stale (epoch mismatch)
   *
   * This method is called after layout completes to ensure cursor positioning
   * is based on stable layout data.
   *
   *
   * @remarks
   * Edge cases handled:
   * - Position lookup failure: When #computeCaretLayoutRect(from) returns null, keep the existing caret visible.
   * - Layout staleness: When #layoutEpoch doesn't match the current doc epoch, keep the last known-good overlay.
   *
   * Side effects:
   * - Mutates #localSelectionLayer.innerHTML (clears or sets cursor/selection HTML)
   * - Calls #renderCaretOverlay() or #renderSelectionRects() which mutate DOM
   * - DOM manipulation is wrapped in try/catch to prevent errors from breaking editor state
   *
   * @private
   */
  #updateSelection() {
    // Consume the scroll intent before any early returns. Passive re-renders
    // (virtualization remounts, layout completions) never set this flag, so
    // they won't scroll the viewport to the caret — only real user-initiated
    // selection changes (keyboard, mouse, image click, zoom) will.
    // Belt-and-suspenders: never scroll from this path while pointer-drag is active.
    const shouldScrollIntoView = this.#shouldScrollSelectionIntoView && !this.#editorInputManager?.isDragging;
    this.#shouldScrollSelectionIntoView = false;

    const activeStorySession = this.#getActiveStorySession();
    if (activeStorySession?.kind === 'headerFooter') {
      this.#updateHeaderFooterSelection(shouldScrollIntoView);
      return;
    }
    if (activeStorySession?.kind === 'note') {
      this.#updateNoteSelection(shouldScrollIntoView);
      return;
    }

    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionMode !== 'body') {
      this.#updateHeaderFooterSelection(shouldScrollIntoView);
      return;
    }

    // Only clear local layer, preserve remote cursor layer
    if (!this.#localSelectionLayer) {
      return;
    }

    // In viewing mode, don't render caret or selection highlights
    // (unless allowSelectionInViewMode is enabled for read-only selection)
    if (this.#isViewLocked() && !this.#options.allowSelectionInViewMode) {
      try {
        this.#clearSelectedFieldAnnotationClass();
        this.#localSelectionLayer.innerHTML = '';
      } catch (error) {
        // DOM manipulation can fail if element is detached or in invalid state
        // Log but don't throw to prevent breaking editor
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to clear selection layer in viewing mode:', error);
        }
      }
      return;
    }

    const activeEditor = this.getActiveEditor();
    const hasFocus = activeEditor?.view?.hasFocus?.() ?? false;
    // Keep selection visible when context menu is open.
    const contextMenuOpen = activeEditor?.state ? !!ContextMenuPluginKey.getState(activeEditor.state)?.open : false;

    // Keep selection visible when focus is on editor UI surfaces (toolbar, dropdowns, tooltips).
    // Dropdown/tooltip content is portaled under <body>, so it won't be inside
    // [data-editor-ui-surface]. Check both in-surface and portaled SD UI roots.
    const activeEl = document.activeElement;
    const isOnEditorUi = !!(activeEl as Element)?.closest?.(
      '[data-editor-ui-surface], .sd-toolbar-dropdown-menu, .toolbar-dropdown-menu',
    );
    const isDragDropIndicatorActive = this.#dragDropIndicatorPos != null;

    if (!hasFocus && !contextMenuOpen && !isOnEditorUi && !isDragDropIndicatorActive) {
      try {
        this.#clearSelectedFieldAnnotationClass();
        this.#localSelectionLayer.innerHTML = '';
      } catch {}
      return;
    }

    const layout = this.#layoutState.layout;
    const editorState = activeEditor.state;
    const selection = editorState?.selection;

    if (!selection) {
      try {
        this.#clearSelectedFieldAnnotationClass();
        this.#clearSelectedStructuredContentBlockClass();
        this.#clearSelectedStructuredContentInlineClass();
        this.#localSelectionLayer.innerHTML = '';
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to clear selection layer (no selection):', error);
        }
      }
      return;
    }

    if (!layout) {
      // No layout yet - keep existing cursor visible until layout is ready
      return;
    }

    const { from, to } = selection;
    const docEpoch = this.#epochMapper.getCurrentEpoch();
    if (this.#layoutEpoch < docEpoch) {
      // The visible layout DOM does not match the current document state.
      // Avoid rendering a "best effort" caret/selection that would drift.
      return;
    }

    this.#syncSelectedFieldAnnotationClass(selection);
    this.#syncSelectedStructuredContentBlockClass(selection);
    this.#syncSelectedStructuredContentInlineClass(selection);

    // Ensure selection endpoints remain mounted under virtualization so DOM-first
    // caret/selection rendering stays available during cross-page selection.
    this.#updateSelectionVirtualizationPins({ includeDragBuffer: this.#editorInputManager?.isDragging ?? false });

    // Handle CellSelection - render cell backgrounds for selected table cells
    if (selection instanceof CellSelection) {
      try {
        this.#localSelectionLayer.innerHTML = '';
        this.#renderCellSelectionOverlay(selection, layout);
      } catch (error) {
        console.warn('[PresentationEditor] Failed to render cell selection overlay:', error);
      }
      return;
    }

    if (from === to || isDragDropIndicatorActive) {
      const caretPos = this.#dragDropIndicatorPos ?? from;
      const activeNavigation = this.#activeSelectionNavigation;
      const isRenderingNavigatedCaret = activeNavigation?.targetPos === caretPos;
      if (isRenderingNavigatedCaret) {
        this.#rebuildDomPositionIndex();
      } else if (activeNavigation) {
        this.#finishSelectionNavigation(activeNavigation.token);
      }
      if (
        isRenderingNavigatedCaret &&
        activeNavigation?.scrollSettled &&
        this.#renderNavigatedCaretFromViewportCoords(caretPos)
      ) {
        this.#finishSelectionNavigation(activeNavigation.token);
        return;
      }
      const caretLayout = this.#computeCaretLayoutRect(caretPos);
      if (!caretLayout) {
        if (isRenderingNavigatedCaret) {
          this.#localSelectionLayer.innerHTML = '';
        }
        // Outside programmatic navigation, keep the existing cursor visible rather than clearing it.
        return;
      }
      // Only clear old cursor after successfully computing new position
      try {
        this.#localSelectionLayer.innerHTML = '';
        renderCaretOverlay({
          localSelectionLayer: this.#localSelectionLayer,
          caretLayout,
          convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
        });
        const queuedNavigationRepair =
          isRenderingNavigatedCaret && activeNavigation
            ? this.#queueSelectionNavigationCaretRepair(caretPos, activeNavigation)
            : false;
        if (isRenderingNavigatedCaret && activeNavigation?.scrollSettled && !queuedNavigationRepair) {
          this.#finishSelectionNavigation(activeNavigation?.token);
        }
      } catch (error) {
        // DOM manipulation can fail if element is detached or in invalid state
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to render caret overlay:', error);
        }
      }
      if (shouldScrollIntoView && !isDragDropIndicatorActive) {
        this.#scrollActiveEndIntoView(caretLayout.pageIndex);
      }
      return;
    }

    const activeNavigation = this.#activeSelectionNavigation;
    const selectionContainsNavigationTarget =
      activeNavigation != null && activeNavigation.targetPos >= from && activeNavigation.targetPos <= to;
    if (activeNavigation && !selectionContainsNavigationTarget) {
      this.#finishSelectionNavigation(activeNavigation.token);
    }
    if (selectionContainsNavigationTarget) {
      this.#rebuildDomPositionIndex();
    }

    const domRects = this.#computeSelectionRectsFromDom(from, to);
    if (domRects == null) {
      if (selectionContainsNavigationTarget) {
        this.#localSelectionLayer.innerHTML = '';
      }
      // DOM-derived selection failed; keep last known-good overlay instead of drifting.
      debugLog('warn', 'Local selection: DOM rect computation failed', { from, to });
      return;
    }

    // When dragging across mark boundaries, the selection can briefly land in the
    // 2-position structural gap between adjacent runs, producing zero DOM rects for
    // one frame. Preserve the last overlay only during active drag to prevent flicker.
    // Outside drag (scroll, programmatic changes), zero rects means the DOM is stale
    // or virtualized — clearing the overlay is the safer default.
    if (domRects.length === 0 && from !== to && this.#editorInputManager?.isDragging) {
      debugLog('warn', '[drawSelection] zero rects for non-collapsed selection — preserving last overlay', {
        from,
        to,
      });
      return;
    }

    try {
      this.#localSelectionLayer.innerHTML = '';
      const isFieldAnnotationSelection =
        selection instanceof NodeSelection && selection.node?.type?.name === 'fieldAnnotation';
      if (domRects.length > 0 && !isFieldAnnotationSelection) {
        renderSelectionRects({
          localSelectionLayer: this.#localSelectionLayer,
          rects: domRects,
          pageHeight: this.#getBodyPageHeight(),
          pageGap: this.#layoutState.layout?.pageGap ?? 0,
          convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
        });
        if (selectionContainsNavigationTarget && activeNavigation?.scrollSettled) {
          this.#finishSelectionNavigation(activeNavigation?.token);
        }
      }
    } catch (error) {
      // DOM manipulation can fail if element is detached or in invalid state
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to render selection rects:', error);
      }
    }

    // Scroll to keep the selection head visible (Shift+Arrow across page boundaries).
    // Use the head's layout rect to determine the target page.
    if (shouldScrollIntoView) {
      const head = activeEditor?.view?.state?.selection?.head ?? to;
      const headLayout = this.#computeCaretLayoutRect(head);
      if (headLayout) {
        this.#scrollActiveEndIntoView(headLayout.pageIndex);
      }
    }
  }

  /**
   * Scrolls the scroll container minimally so that a screen-space rect is visible,
   * keeping a small margin (20px) for comfortable viewing. No-ops when the rect
   * is already within the visible bounds.
   */
  #scrollScreenRectIntoView(screenTop: number, screenBottom: number): void {
    const scrollContainer = this.#scrollContainer;
    if (!scrollContainer) return;

    let containerTop: number;
    let containerBottom: number;

    if (scrollContainer instanceof Window) {
      containerTop = 0;
      containerBottom = scrollContainer.innerHeight;
    } else {
      const r = (scrollContainer as Element).getBoundingClientRect();
      containerTop = r.top;
      containerBottom = r.bottom;
    }

    const SCROLL_MARGIN = 20;

    if (screenBottom > containerBottom - SCROLL_MARGIN) {
      const delta = screenBottom - containerBottom + SCROLL_MARGIN;
      if (scrollContainer instanceof Window) {
        scrollContainer.scrollBy({ top: delta });
      } else {
        (scrollContainer as Element).scrollTop += delta;
      }
    } else if (screenTop < containerTop + SCROLL_MARGIN) {
      const delta = containerTop + SCROLL_MARGIN - screenTop;
      if (scrollContainer instanceof Window) {
        scrollContainer.scrollBy({ top: -delta });
      } else {
        (scrollContainer as Element).scrollTop -= delta;
      }
    }
  }

  /**
   * Scrolls the scroll container so the caret or selection head remains visible
   * after selection changes. Works for both collapsed (caret) and range selections.
   *
   * For collapsed selections, uses the rendered caret element's screen position.
   * For range selections, uses the rendered selection rect nearest to the head.
   *
   * If the target page isn't mounted (virtualized), falls back to scrolling the
   * page into view to trigger mount; the next selection update handles precise scroll.
   */
  #scrollActiveEndIntoView(pageIndex: number): void {
    // SD-3315: a search-owned scroll is in flight (find next/previous). Do not let selection-sync
    // scroll the viewport to the (reverted/stale) caret — the search scroll and its RAF re-assert
    // own positioning for this window. The selection overlay still renders in #updateSelection;
    // only this scroll is skipped. Cleared on the search scroll's RAF, so normal keyboard/pointer
    // selection scroll resumes the next frame.
    if (this.#suppressSelectionScrollUntilRaf) return;
    // Check if the target page is mounted before trusting rendered element positions.
    const pageIsMounted = !!this.#painterHost.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!pageIsMounted) {
      this.#scrollPageIntoView(pageIndex);
      return;
    }

    // Try caret element first (collapsed selection)
    const caretEl = this.#localSelectionLayer?.querySelector(
      '.presentation-editor__selection-caret',
    ) as HTMLElement | null;
    if (caretEl) {
      const r = caretEl.getBoundingClientRect();
      this.#scrollScreenRectIntoView(r.top, r.bottom);
      return;
    }

    // Range selection: pick the rendered rect nearest the selection head.
    // Rects are rendered in document order. head < anchor means the user is
    // extending backward (Shift+ArrowUp) → first child. head >= anchor means
    // extending forward (Shift+ArrowDown) → last child.
    const sel = this.getActiveEditor()?.view?.state?.selection;
    const headIsForward = !sel || sel.head >= sel.anchor;
    const headRect = (
      headIsForward ? this.#localSelectionLayer?.lastElementChild : this.#localSelectionLayer?.firstElementChild
    ) as HTMLElement | null;
    if (headRect) {
      const r = headRect.getBoundingClientRect();
      this.#scrollScreenRectIntoView(r.top, r.bottom);
    }
  }

  /**
   * Updates the permission overlay (w:permStart/w:permEnd) to match the current editor permission ranges.
   *
   * This method is called after layout completes to ensure permission overlay
   * is based on stable permission ranges data.
   */
  #updatePermissionOverlay() {
    const overlay = this.#permissionOverlay;
    if (!overlay) {
      return;
    }

    const sessionModeForPerm = this.#headerFooterSession?.session?.mode ?? 'body';
    if (sessionModeForPerm !== 'body') {
      overlay.innerHTML = '';
      return;
    }

    const permissionStorage = (this.#editor as Editor & { storage?: Record<string, any> })?.storage?.permissionRanges;
    const ranges: Array<{ from: number; to: number }> = permissionStorage?.ranges ?? [];
    const shouldRender = ranges.length > 0;

    if (!shouldRender) {
      overlay.innerHTML = '';
      return;
    }

    const layout = this.#layoutState.layout;
    if (!layout) {
      overlay.innerHTML = '';
      return;
    }

    const docEpoch = this.#epochMapper.getCurrentEpoch();
    // The visible layout DOM does not match the current document state.
    // Avoid rendering a "best effort" permission overlay that would drift.
    if (this.#layoutEpoch < docEpoch) {
      return;
    }

    const pageHeight = this.#getBodyPageHeight();
    const pageGap = layout.pageGap ?? this.#getEffectivePageGap();
    const fragment = overlay.ownerDocument?.createDocumentFragment();
    if (!fragment) {
      overlay.innerHTML = '';
      return;
    }

    ranges.forEach(({ from, to }) => {
      const rects = this.#computeSelectionRectsFromDom(from, to);
      if (!rects?.length) {
        return;
      }
      rects.forEach((rect) => {
        const pageLocalY = rect.y - rect.pageIndex * (pageHeight + pageGap);
        const coords = this.#convertPageLocalToOverlayCoords(rect.pageIndex, rect.x, pageLocalY);
        if (!coords) {
          return;
        }
        const highlight = overlay.ownerDocument?.createElement('div');
        if (!highlight) {
          return;
        }
        highlight.className = 'presentation-editor__permission-highlight';
        Object.assign(highlight.style, {
          position: 'absolute',
          left: `${coords.x}px`,
          top: `${coords.y}px`,
          width: `${Math.max(1, rect.width)}px`,
          height: `${Math.max(1, rect.height)}px`,
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 1,
        });
        fragment.appendChild(highlight);
      });
    });

    overlay.innerHTML = '';
    overlay.appendChild(fragment);
  }

  #resolveAlternateHeadersFlag(): boolean {
    const converter = (this.#editor as EditorWithConverter | undefined)?.converter;
    if (!converter) {
      return false;
    }

    const settingsPart = (converter as { convertedXml?: Record<string, unknown> }).convertedXml?.['word/settings.xml'];
    const fromSettings = resolveEvenAndOddHeadersFromSettingsPart(settingsPart);
    if (fromSettings !== null) {
      return fromSettings;
    }

    return converter.pageStyles?.alternateHeaders === true;
  }

  #resolveLayoutOptions(blocks: FlowBlock[] | undefined, sectionMetadata: SectionMetadata[]): ResolvedLayoutOptions {
    const defaults = this.#computeDefaultLayoutDefaults();
    const firstSection = blocks?.find(
      (block) =>
        block.kind === 'sectionBreak' &&
        (block as FlowBlock & { attrs?: { isFirstSection?: boolean } })?.attrs?.isFirstSection,
    ) as
      | (FlowBlock & {
          kind: 'sectionBreak';
          pageSize?: PageSize;
          columns?: ColumnLayout;
          margins?: { header?: number; footer?: number; top?: number; right?: number; bottom?: number; left?: number };
        })
      | undefined;

    const pageSize = firstSection?.pageSize ?? defaults.pageSize;
    const margins: PageMargins = {
      ...defaults.margins,
      ...(firstSection?.margins?.top != null ? { top: firstSection.margins.top } : {}),
      ...(firstSection?.margins?.right != null ? { right: firstSection.margins.right } : {}),
      ...(firstSection?.margins?.bottom != null ? { bottom: firstSection.margins.bottom } : {}),
      ...(firstSection?.margins?.left != null ? { left: firstSection.margins.left } : {}),
      ...(firstSection?.margins?.header != null ? { header: firstSection.margins.header } : {}),
      ...(firstSection?.margins?.footer != null ? { footer: firstSection.margins.footer } : {}),
    };
    // For the first emitted section break, absence of w:cols means OOXML single-column default.
    // Falling back to document defaults here is wrong because bodySectPr often reflects the
    // final section, which can leak a later multi-column configuration into the document start.
    const columns = firstSection ? (firstSection.columns ?? { count: 1, gap: 0 }) : defaults.columns;

    this.#layoutOptions.pageSize = pageSize;
    this.#layoutOptions.margins = margins;
    const flowMode = this.#layoutOptions.flowMode ?? 'paginated';
    const documentBackground = this.#resolveDocumentBackground();
    if (documentBackground) {
      this.#layoutOptions.documentBackground = documentBackground;
    } else {
      delete this.#layoutOptions.documentBackground;
    }

    const resolvedMargins = {
      top: margins.top!,
      right: margins.right!,
      bottom: margins.bottom!,
      left: margins.left!,
      ...(margins.header != null ? { header: margins.header } : {}),
      ...(margins.footer != null ? { footer: margins.footer } : {}),
    };

    if (flowMode === 'semantic') {
      const semanticMargins = this.#resolveSemanticMargins(margins);
      const containerWidth = this.#resolveSemanticContainerInnerWidth();
      const semanticContentWidth = Math.max(
        MIN_SEMANTIC_CONTENT_WIDTH_PX,
        containerWidth - semanticMargins.left - semanticMargins.right,
      );
      const semanticPageWidth = semanticContentWidth + semanticMargins.left + semanticMargins.right;
      this.#hiddenHost.style.width = `${semanticContentWidth}px`;
      this.#lastSemanticContainerWidth = containerWidth;
      return {
        flowMode: 'semantic',
        pageSize: { w: semanticPageWidth, h: pageSize.h },
        margins: {
          ...resolvedMargins,
          top: semanticMargins.top,
          right: semanticMargins.right,
          bottom: semanticMargins.bottom,
          left: semanticMargins.left,
        },
        columns: { count: 1, gap: 0 },
        semantic: {
          contentWidth: semanticContentWidth,
          marginLeft: semanticMargins.left,
          marginRight: semanticMargins.right,
          marginTop: semanticMargins.top,
          marginBottom: semanticMargins.bottom,
        },
        sectionMetadata,
        ...(documentBackground ? { documentBackground } : {}),
      };
    }

    this.#hiddenHost.style.width = `${pageSize.w}px`;

    const alternateHeaders = this.#resolveAlternateHeadersFlag();
    return {
      flowMode: 'paginated',
      pageSize,
      margins: resolvedMargins,
      ...(documentBackground ? { documentBackground } : {}),
      ...(columns ? { columns } : {}),
      sectionMetadata,
      alternateHeaders,
    };
  }

  /**
   * Flatten a header/footer layout input into the FlowBlocks it will measure, so the font
   * planner can include header/footer faces. getBatch variants and getBlocksByRId can cover
   * the same content; planFontFaces dedups by face, so the overlap is harmless.
   */
  #collectHeaderFooterFaceBlocks(input: {
    headerBlocks?: Partial<Record<string, FlowBlock[]>>;
    footerBlocks?: Partial<Record<string, FlowBlock[]>>;
    headerBlocksByRId?: Map<string, FlowBlock[]>;
    footerBlocksByRId?: Map<string, FlowBlock[]>;
  }): FlowBlock[] {
    const out: FlowBlock[] = [];
    for (const batch of [input.headerBlocks, input.footerBlocks]) {
      if (batch) for (const blocks of Object.values(batch)) if (blocks) out.push(...blocks);
    }
    for (const byRId of [input.headerBlocksByRId, input.footerBlocksByRId]) {
      if (byRId) for (const blocks of byRId.values()) out.push(...blocks);
    }
    return out;
  }

  #coerceDocumentBackground(candidate: unknown): DocumentBackground | undefined {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const color = (candidate as { color?: unknown }).color;
    return typeof color === 'string' && color.length > 0 ? { color } : undefined;
  }

  #resolveDocumentBackground(): DocumentBackground | undefined {
    return (
      this.#coerceDocumentBackground(this.#editor?.state?.doc?.attrs?.documentBackground) ??
      (this.#configuredDocumentBackground ? { ...this.#configuredDocumentBackground } : undefined)
    );
  }

  #buildHeaderFooterInput() {
    if (this.#isSemanticFlowMode()) {
      return null;
    }
    const adapter = this.#headerFooterSession?.adapter;
    if (!adapter) {
      return null;
    }
    const headerBlocks = adapter.getBatch('header');
    const footerBlocks = adapter.getBatch('footer');
    // Also get all blocks by rId for multi-section support
    const headerBlocksByRId = adapter.getBlocksByRId('header');
    const footerBlocksByRId = adapter.getBlocksByRId('footer');
    if (!headerBlocks && !footerBlocks && !headerBlocksByRId && !footerBlocksByRId) {
      return null;
    }
    const constraints = this.#computeHeaderFooterConstraints();
    if (!constraints) {
      return null;
    }
    return {
      headerBlocks,
      footerBlocks,
      headerBlocksByRId,
      footerBlocksByRId,
      constraints,
    };
  }

  /**
   * Computes layout constraints for header and footer content.
   *
   * This method calculates the available width and height for laying out header/footer
   * content, following Microsoft Word's layout model:
   * - Headers/footers use the same left/right margins as the body content
   * - Content renders at its natural height and can extend beyond the nominal space
   * - Body text boundaries are adjusted (effectiveTopMargin/effectiveBottomMargin) to prevent overlap
   *
   * The width is constrained to the body content width (page width minus left/right margins).
   * The height represents the maximum available vertical space between top and bottom margins,
   * allowing header/footer content to grow naturally and push body text as needed.
   *
   * @returns Constraint object containing width, height, pageWidth, and margins,
   *          or null if the constraints cannot be computed (e.g., invalid margins that
   *          exceed page dimensions or produce non-positive content width/height).
   */
  #computeHeaderFooterConstraints() {
    const pageSize = this.#layoutOptions.pageSize ?? DEFAULT_PAGE_SIZE;
    const margins = this.#layoutOptions.margins ?? DEFAULT_MARGINS;
    const marginLeft = margins.left ?? DEFAULT_MARGINS.left!;
    const marginRight = margins.right ?? DEFAULT_MARGINS.right!;
    const bodyContentWidth = pageSize.w - (marginLeft + marginRight);
    if (!Number.isFinite(bodyContentWidth) || bodyContentWidth <= 0) {
      return null;
    }

    // Use body content width for header/footer measurement.
    // Headers/footers should respect the same left/right margins as the body.
    // Note: Tables that need to span beyond margins should use negative indents
    // or be handled via table-specific overflow logic, not by expanding the
    // measurement width for all content.
    const measurementWidth = bodyContentWidth;

    // Header/footer content renders at its natural height.
    // In Word's model:
    // - Headers start at headerDistance from page top, footers at footerDistance from page bottom
    // - Content renders at natural height and can extend into the body area if needed
    // - Body text boundaries are adjusted (effectiveTopMargin/effectiveBottomMargin) to prevent overlap
    //
    // Use the full body height for measuring headers/footers so content can grow
    // naturally (Word-style) and push body text as needed.
    const marginTop = margins.top ?? DEFAULT_MARGINS.top!;
    const marginBottom = margins.bottom ?? DEFAULT_MARGINS.bottom!;

    // Validate that margins are finite numbers and don't exceed page height
    if (!Number.isFinite(marginTop) || !Number.isFinite(marginBottom)) {
      console.warn('[PresentationEditor] Invalid top or bottom margin: not a finite number');
      return null;
    }

    const totalVerticalMargins = marginTop + marginBottom;
    if (totalVerticalMargins >= pageSize.h) {
      console.warn(
        `[PresentationEditor] Invalid margins: top (${marginTop}) + bottom (${marginBottom}) = ${totalVerticalMargins} >= page height (${pageSize.h})`,
      );
      return null;
    }

    // Minimum height for header/footer content to prevent degenerate layouts
    const MIN_HEADER_FOOTER_HEIGHT = 1;
    const height = Math.max(MIN_HEADER_FOOTER_HEIGHT, pageSize.h - totalVerticalMargins);
    const headerMargin = margins.header ?? 0;
    const footerMargin = margins.footer ?? 0;
    const headerBand = Math.max(MIN_HEADER_FOOTER_HEIGHT, marginTop - headerMargin);
    const footerBand = Math.max(MIN_HEADER_FOOTER_HEIGHT, marginBottom - footerMargin);

    // overflowBaseHeight: Bounds behindDoc overflow handling in headers/footers.
    //
    // Purpose:
    // - Prevents decorative background assets (images/drawings with behindDoc=true and extreme
    //   offsets) from inflating header/footer layout height and driving excessive page margins.
    // - Without this bound, a decorative image positioned far outside the header/footer band
    //   (e.g., offsetV=5000) would incorrectly expand the header/footer height, pushing body
    //   content and creating unwanted whitespace.
    //
    // Calculation rationale:
    // - Uses the larger of headerBand or footerBand as the base height.
    // - headerBand = marginTop - headerMargin (space between page top and header start)
    // - footerBand = marginBottom - footerMargin (space between footer end and page bottom)
    // - Taking the max ensures consistent overflow handling regardless of whether we're
    //   measuring a header or footer, using the more permissive band size.
    // - This value is passed to layoutHeaderFooter, which allows behindDoc fragments to
    //   overflow by up to 4x this base (or 192pt, whichever is larger) before excluding
    //   them from height calculations.
    const overflowBaseHeight = Math.max(headerBand, footerBand);

    return {
      width: measurementWidth,
      height,
      pageWidth: pageSize.w,
      pageHeight: pageSize.h,
      margins: {
        left: marginLeft,
        right: marginRight,
        top: marginTop,
        bottom: marginBottom,
        header: headerMargin,
        // Only set footer when the source defines w:footer. Defaulting to 0 here
        // would defeat the bottom-margin fallback in computeFooterBandOrigin
        // (typeof 0 === 'number' passes the check, returning pageHeight - 0).
        ...(margins.footer != null ? { footer: footerMargin } : {}),
      },
      overflowBaseHeight,
    };
  }

  /**
   * Lays out per-rId header/footer content for multi-section documents.
   *
   * This method processes header/footer content for each unique rId, enabling
   * different sections to have different header/footer content. The layouts
   * are stored in #headerLayoutsByRId and #footerLayoutsByRId for use by
   * the decoration provider.
   */
  async #layoutPerRIdHeaderFooters(
    headerFooterInput: {
      headerBlocks?: unknown;
      footerBlocks?: unknown;
      headerBlocksByRId: Map<string, FlowBlock[]> | undefined;
      footerBlocksByRId: Map<string, FlowBlock[]> | undefined;
      constraints: HeaderFooterConstraints;
    } | null,
    layout: Layout,
    sectionMetadata: SectionMetadata[],
  ): Promise<void> {
    if (this.#headerFooterSession) {
      await this.#headerFooterSession.layoutPerRId(
        headerFooterInput,
        layout,
        sectionMetadata,
        this.#fontResolver,
        this.#hasFace,
        this.#fontPlan?.effectiveSignature ?? '',
      );
    }
  }

  /**
   * Update decoration providers for header/footer.
   * Delegates to HeaderFooterSessionManager which handles provider creation.
   */
  #updateDecorationProviders(resolvedLayout: ResolvedLayout) {
    this.#headerFooterSession?.updateDecorationProviders(resolvedLayout);
  }

  /**
   * Hit test for header/footer regions at a given point.
   * Delegates to HeaderFooterSessionManager which manages region tracking.
   */
  #hitTestHeaderFooterRegion(x: number, y: number, pageIndex?: number, pageLocalY?: number): HeaderFooterRegion | null {
    return this.#headerFooterSession?.hitTestRegion(x, y, this.#layoutState.layout, pageIndex, pageLocalY) ?? null;
  }

  #activateHeaderFooterRegion(
    region: HeaderFooterRegion,
    options?: { clientX: number; clientY: number; pageIndex?: number; source?: 'pointerDoubleClick' | 'programmatic' },
  ) {
    void this.#activateHeaderFooterRegionAtPoint(region, options);
  }

  async #activateHeaderFooterRegionAtPoint(
    region: HeaderFooterRegion,
    options?: { clientX: number; clientY: number; pageIndex?: number; source?: 'pointerDoubleClick' | 'programmatic' },
  ): Promise<void> {
    const editor =
      (await this.#headerFooterSession?.activateRegion(region, {
        initialSelection: options ? 'defer' : 'end',
        documentMode: this.#getActiveEditorDocumentMode() ?? this.#getEffectiveDocumentMode(),
      })) ?? null;

    if (!editor || !options) {
      return;
    }

    const doc = editor.state?.doc;
    const hit = this.hitTest(options.clientX, options.clientY);
    if (!doc || !hit) {
      return;
    }

    try {
      const selection = this.#createCollapsedSelectionNearInlineContent(doc, hit.pos);
      const tr = editor.state.tr.setSelection(selection);
      editor.view?.dispatch(tr);
      editor.view?.focus?.();
      this.#shouldScrollSelectionIntoView = true;
      this.#scheduleSelectionUpdate({ immediate: true });
    } catch {
      // Ignore stale activation hits during rerender races.
    }
  }

  #exitHeaderFooterMode() {
    // Delegate to session manager
    this.#headerFooterSession?.exitMode();
    this.#pendingDocChange = true;
    this.#scheduleRerender();

    this.#editor.view?.focus();
  }

  #buildNoteLayoutContext(target: RenderedNoteTarget | null | undefined): NoteLayoutContext | null {
    const layout = this.#layoutState.layout;
    if (!target || !layout) {
      return null;
    }

    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    const noteBlockIds = new Set<string>();

    this.#layoutLookupBlocks.forEach((block, index) => {
      const blockId = typeof block?.id === 'string' ? block.id : '';
      const parsed = parseRenderedNoteTarget(blockId);
      if (!parsed) {
        return;
      }
      if (parsed.storyType !== target.storyType || parsed.noteId !== target.noteId) {
        return;
      }
      blocks.push(block);
      measures.push(this.#layoutLookupMeasures[index]);
      noteBlockIds.add(blockId);
    });

    if (blocks.length === 0 || measures.length !== blocks.length) {
      return null;
    }

    let firstPageIndex = -1;
    let hostWidthPx = 0;

    layout.pages.forEach((page, pageIndex) => {
      page.fragments.forEach((fragment) => {
        if (!noteBlockIds.has(fragment.blockId)) {
          return;
        }
        if (firstPageIndex < 0) {
          firstPageIndex = pageIndex;
        }
        const fragmentWidth = typeof fragment.width === 'number' ? fragment.width : 0;
        hostWidthPx = Math.max(hostWidthPx, fragmentWidth);
      });
    });

    if (firstPageIndex < 0) {
      firstPageIndex = 0;
    }

    if (!(hostWidthPx > 0)) {
      const page = layout.pages[firstPageIndex];
      const pageWidth = page?.size?.w ?? layout.pageSize.w ?? DEFAULT_PAGE_SIZE.w;
      const margins = page?.margins ?? this.#layoutOptions.margins ?? DEFAULT_MARGINS;
      const marginLeft = margins.left ?? DEFAULT_MARGINS.left ?? 0;
      const marginRight = margins.right ?? DEFAULT_MARGINS.right ?? 0;
      hostWidthPx = Math.max(1, pageWidth - marginLeft - marginRight);
    }

    return {
      target,
      blocks,
      measures,
      firstPageIndex,
      hostWidthPx: Math.max(1, hostWidthPx),
    };
  }

  #buildActiveNoteLayoutContext(): NoteLayoutContext | null {
    const session = this.#getActiveNoteStorySession();
    if (!session) {
      return null;
    }
    return this.#buildNoteLayoutContext({
      storyType: session.locator.storyType,
      noteId: session.locator.noteId,
    });
  }

  #toStoryNoteVisibleTextOffset(_noteFragments: readonly HTMLElement[], renderedTextOffset: number): number {
    return Math.max(0, renderedTextOffset);
  }

  #toRenderedNoteVisibleTextOffset(_noteFragments: readonly HTMLElement[], storyTextOffset: number): number {
    return Math.max(0, storyTextOffset);
  }

  #collectNoteBlockIds(context: NoteLayoutContext): Set<string> {
    return new Set(
      context.blocks
        .map((block) => (typeof block?.id === 'string' ? block.id : null))
        .filter((blockId): blockId is string => !!blockId),
    );
  }

  #resolveRenderedPageIndexForElement(element: HTMLElement): number {
    const pageElement = element.closest<HTMLElement>('[data-page-index]');
    const pageIndex = Number(pageElement?.dataset.pageIndex ?? 'NaN');
    if (Number.isFinite(pageIndex) && pageIndex >= 0) {
      return pageIndex;
    }

    const blockId = element.getAttribute('data-block-id') ?? '';
    const layout = this.#layoutState.layout;
    if (!blockId || !layout) {
      return 0;
    }

    for (let index = 0; index < layout.pages.length; index += 1) {
      if (layout.pages[index]?.fragments?.some((fragment) => fragment.blockId === blockId)) {
        return index;
      }
    }

    return 0;
  }

  #getRenderedNoteFragmentElements(noteBlockIds: ReadonlySet<string>): HTMLElement[] {
    if (!this.#viewportHost || noteBlockIds.size === 0) {
      return [];
    }

    return Array.from(this.#viewportHost.querySelectorAll<HTMLElement>('[data-block-id]')).filter((element) =>
      noteBlockIds.has(element.getAttribute('data-block-id') ?? ''),
    );
  }

  #measureRenderedNoteVisibleTextOffset(context: NoteLayoutContext, clientX: number, clientY: number): number | null {
    const noteBlockIds = this.#collectNoteBlockIds(context);
    const noteFragments = this.#getRenderedNoteFragmentElements(noteBlockIds);
    if (!noteFragments.length) {
      return null;
    }

    const fragmentHit = this.#findRenderedNoteFragmentAtPoint(noteBlockIds, clientX, clientY);
    if (!fragmentHit) {
      return null;
    }

    const boundary = resolveTextBoundaryWithinFragmentDomFromDom(fragmentHit.fragmentElement, clientX, clientY);
    if (!boundary) {
      return null;
    }

    const renderedTextOffset = measureVisibleTextOffsetInContainersFromHelper(
      noteFragments,
      boundary.node,
      boundary.offset,
    );
    if (renderedTextOffset == null) {
      return null;
    }

    return this.#toStoryNoteVisibleTextOffset(noteFragments, renderedTextOffset);
  }

  #resolveActiveEditorPosFromVisibleTextOffset(textOffset: number): number | null {
    if (!Number.isFinite(textOffset)) {
      return null;
    }

    const activeEditor = this.getActiveEditor();
    const docSize = activeEditor?.state?.doc?.content.size;
    if (!Number.isFinite(docSize)) {
      return null;
    }

    const targetOffset = Math.max(0, textOffset);
    const visibleOffsetCache = new Map<number, number | null>();
    const readVisibleOffset = (pos: number): number | null => {
      if (!visibleOffsetCache.has(pos)) {
        visibleOffsetCache.set(pos, this.#measureActiveEditorVisibleTextOffset(pos));
      }
      return visibleOffsetCache.get(pos) ?? null;
    };

    const resolveLastPosAtOrBeforeOffset = (): number | null => {
      let low = 0;
      let high = docSize;
      let bestPos: number | null = null;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const visibleOffset = readVisibleOffset(mid);
        if (visibleOffset == null) {
          high = mid - 1;
          continue;
        }

        if (visibleOffset <= targetOffset) {
          bestPos = mid;
          low = mid + 1;
          continue;
        }

        high = mid - 1;
      }

      return bestPos;
    };

    const resolveFirstPosAtOrAfterOffset = (): number | null => {
      let low = 0;
      let high = docSize;
      let bestPos: number | null = null;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const visibleOffset = readVisibleOffset(mid);
        if (visibleOffset == null) {
          high = mid - 1;
          continue;
        }

        if (visibleOffset >= targetOffset) {
          bestPos = mid;
          high = mid - 1;
          continue;
        }

        low = mid + 1;
      }

      return bestPos;
    };

    // Visible offset 0 is special for note surfaces because the PM document can
    // contain non-rendered prefix structure before the first editable character.
    // For that case we want the rightmost zero-offset boundary. For all other
    // clicks, prefer the first PM position whose visible offset reaches the
    // requested character boundary.
    return targetOffset === 0 ? resolveLastPosAtOrBeforeOffset() : resolveFirstPosAtOrAfterOffset();
  }

  #findRenderedNoteFragmentAtPoint(
    noteBlockIds: ReadonlySet<string>,
    clientX: number,
    clientY: number,
  ): RenderedNoteFragmentHit | null {
    const doc = this.#viewportHost.ownerDocument ?? document;
    const elementsFromPoint = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint.bind(doc) : null;

    const toFragmentHit = (element: Element | null): RenderedNoteFragmentHit | null => {
      const fragmentElement = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-block-id]') : null;
      const blockId = fragmentElement?.getAttribute('data-block-id') ?? '';
      if (!fragmentElement || !noteBlockIds.has(blockId)) {
        return null;
      }

      return {
        fragmentElement,
        pageIndex: this.#resolveRenderedPageIndexForElement(fragmentElement),
      };
    };

    if (elementsFromPoint) {
      for (const element of elementsFromPoint(clientX, clientY)) {
        const fragmentHit = toFragmentHit(element);
        if (fragmentHit) {
          return fragmentHit;
        }
      }
    }

    for (const fragmentElement of this.#getRenderedNoteFragmentElements(noteBlockIds)) {
      const rect = fragmentElement.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }

      return {
        fragmentElement,
        pageIndex: this.#resolveRenderedPageIndexForElement(fragmentElement),
      };
    }

    return null;
  }

  #resolveNoteDomHit(context: NoteLayoutContext, clientX: number, clientY: number): PositionHit | null {
    const layout = this.#layoutState.layout;
    if (!layout) {
      return null;
    }

    const noteBlockIds = this.#collectNoteBlockIds(context);
    if (noteBlockIds.size === 0) {
      return null;
    }

    const fragmentHit = this.#findRenderedNoteFragmentAtPoint(noteBlockIds, clientX, clientY);
    if (!fragmentHit) {
      return null;
    }

    const bridgedTextOffset = this.#measureRenderedNoteVisibleTextOffset(context, clientX, clientY);
    const bridgedPos =
      bridgedTextOffset == null ? null : this.#resolveActiveEditorPosFromVisibleTextOffset(bridgedTextOffset);
    if (bridgedTextOffset != null && bridgedPos != null) {
      this.#recordNoteHitDebug({
        bridgedTextOffset,
        bridgedPos,
        bridgedVisibleOffsets: [bridgedPos - 2, bridgedPos - 1, bridgedPos, bridgedPos + 1, bridgedPos + 2]
          .filter((pos) => pos >= 0)
          .map((pos) => ({
            pos,
            visibleOffset: this.#measureActiveEditorVisibleTextOffset(pos),
          })),
      });
    }
    if (bridgedPos != null) {
      return {
        pos: bridgedPos,
        layoutEpoch:
          readLayoutEpochFromDomFromDom(fragmentHit.fragmentElement, clientX, clientY) ?? layout.layoutEpoch ?? 0,
        blockId: fragmentHit.fragmentElement.getAttribute('data-block-id') ?? '',
        pageIndex: fragmentHit.pageIndex,
        column: 0,
        lineIndex: -1,
      };
    }

    const pos = resolvePositionWithinFragmentDomFromDom(fragmentHit.fragmentElement, clientX, clientY);
    if (pos == null) {
      return null;
    }

    return {
      pos,
      layoutEpoch:
        readLayoutEpochFromDomFromDom(fragmentHit.fragmentElement, clientX, clientY) ?? layout.layoutEpoch ?? 0,
      blockId: fragmentHit.fragmentElement.getAttribute('data-block-id') ?? '',
      pageIndex: fragmentHit.pageIndex,
      column: 0,
      lineIndex: -1,
    };
  }

  #resolveHeaderFooterDomHit(context: HeaderFooterLayoutContext, clientX: number, clientY: number): PositionHit | null {
    const layout = this.#layoutState.layout;
    if (!layout) return null;

    const blockIds = new Set(
      context.blocks.map((block) => block.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    if (blockIds.size === 0) return null;

    const doc = this.#viewportHost.ownerDocument ?? document;
    const elementsFromPoint = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint.bind(doc) : null;

    const tryResolve = (element: Element | null, enforceKnownBlockIds = true): PositionHit | null => {
      const fragmentElement = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-block-id]') : null;
      const blockId = fragmentElement?.getAttribute('data-block-id') ?? '';
      if (!fragmentElement) return null;
      if (enforceKnownBlockIds && !blockIds.has(blockId)) return null;

      const pos = resolvePositionWithinFragmentDomFromDom(fragmentElement, clientX, clientY);
      if (pos == null) return null;

      return {
        pos,
        layoutEpoch: readLayoutEpochFromDomFromDom(fragmentElement, clientX, clientY) ?? layout.layoutEpoch ?? 0,
        blockId,
        pageIndex: this.#resolveRenderedPageIndexForElement(fragmentElement),
        column: 0,
        lineIndex: -1,
      };
    };

    if (elementsFromPoint) {
      for (const element of elementsFromPoint(clientX, clientY)) {
        const hit = tryResolve(element, true);
        if (hit) return hit;
      }

      // Fallback: when rendered block IDs differ from context block IDs (e.g. split/derived
      // header/footer fragments), still resolve from the visible fragment under pointer.
      // Scope to the header/footer surface to avoid matching body fragments at the same
      // viewport coordinates (header/footer has pointer-events: none, so elementsFromPoint
      // may return body elements that sit visually behind the header/footer area).
      for (const element of elementsFromPoint(clientX, clientY)) {
        if (!element.closest('.superdoc-page-header, .superdoc-page-footer')) continue;
        const hit = tryResolve(element, false);
        if (hit) return hit;
      }
    }

    // Header/footer surfaces are rendered with pointer-events: none on the container
    // in presentation mode. In that case elementsFromPoint may miss the intended
    // fragment chain, so fallback to a geometric fragment pick by bounding box.
    const surfaceSelector = context.region.kind === 'footer' ? '.superdoc-page-footer' : '.superdoc-page-header';
    const pageElement = getPageElementByIndex(this.#viewportHost, context.region.pageIndex);
    const surface = pageElement?.querySelector(surfaceSelector) ?? null;
    if (surface instanceof HTMLElement) {
      const fragments = Array.from(surface.querySelectorAll<HTMLElement>('.superdoc-fragment'));
      for (const fragment of fragments) {
        const rect = fragment.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
          continue;
        }
        const hit = tryResolve(fragment, false);
        if (hit) return hit;
      }
    }

    return null;
  }

  #createCollapsedSelectionNearInlineContent(doc: ProseMirrorNode, pos: number): Selection {
    const clampedPos = Math.max(0, Math.min(pos, doc.content.size));
    const directSelection = TextSelection.create(doc, clampedPos);
    if (directSelection.$from.parent.inlineContent) {
      return directSelection;
    }

    const bias = clampedPos >= doc.content.size ? -1 : 1;
    return Selection.near(doc.resolve(clampedPos), bias);
  }

  #activateRenderedNoteSession(
    target: RenderedNoteTarget,
    options: { clientX?: number; clientY?: number; pageIndex?: number },
  ): boolean {
    if ((this.#headerFooterSession?.session?.mode ?? 'body') !== 'body') {
      this.#headerFooterSession?.exitMode();
    }

    const storySessionManager = this.#ensureStorySessionManager();

    if (target.storyType !== 'footnote' && target.storyType !== 'endnote') {
      return false;
    }

    const targetContext = this.#buildNoteLayoutContext(target);
    const totalPageCount = this.#layoutState.layout?.pages?.length ?? 1;
    const pageNumber = Math.max(1, (options.pageIndex ?? targetContext?.firstPageIndex ?? 0) + 1);

    const session = storySessionManager.activate(
      {
        kind: 'story',
        storyType: target.storyType,
        noteId: target.noteId,
      },
      {
        // Render from the active note session locally while typing, then persist
        // the canonical notes part once when the session exits.
        commitPolicy: 'onExit',
        preferHiddenHost: true,
        hostWidthPx: targetContext?.hostWidthPx ?? this.#visibleHost.clientWidth ?? 1,
        editorContext: {
          currentPageNumber: pageNumber,
          totalPageCount: Math.max(1, totalPageCount),
          surfaceKind: target.storyType === 'endnote' ? 'endnote' : 'note',
        },
      },
    );

    const doc = session.editor.state?.doc;
    // SD-3400: pointer activation places the caret at the click position;
    // programmatic activation (no coords, e.g. insert-footnote focus) leaves the
    // caret at the note's default start so the user can type from the beginning.
    if (typeof options.clientX === 'number' && typeof options.clientY === 'number' && doc) {
      const hit = this.hitTest(options.clientX, options.clientY);
      if (hit) {
        try {
          const selection = this.#createCollapsedSelectionNearInlineContent(doc, hit.pos);
          const tr = session.editor.state.tr.setSelection(selection);
          session.editor.view?.dispatch(tr);
        } catch {
          // Ignore stale pointer hits during activation races.
        }
      }
    }

    session.editor.view?.focus();
    this.#shouldScrollSelectionIntoView = true;
    this.#scheduleSelectionUpdate({ immediate: true });

    // SD-3400: highlight the note, watch for the user emptying it, and bring
    // it into view (see NoteSessionCoordinator for the full UX contract).
    this.#ensureNoteSessionCoordinator().onActivated(target, session);
    return true;
  }

  #ensureNoteSessionCoordinator(): NoteSessionCoordinator {
    if (!this.#noteSessionCoordinator) {
      this.#noteSessionCoordinator = new NoteSessionCoordinator({
        getHost: () => this.#painterHost ?? this.#visibleHost,
        getScrollContainer: () => this.#scrollContainer,
        hasActiveSession: () => Boolean(this.#getActiveStorySession()),
        exitActiveSession: () => this.#exitActiveStorySession(),
      });
    }
    return this.#noteSessionCoordinator;
  }
  /**
   * SD-3400: programmatically open a footnote/endnote note session without a
   * pointer. Focuses the note and scrolls it into view with the caret at the
   * note's start. Used by insert-footnote (and any non-pointer navigation) so
   * the user can immediately type in the new note.
   */
  activateNoteSession(target: RenderedNoteTarget): boolean {
    return this.#activateRenderedNoteSession(target, {});
  }

  #exitActiveStorySession(): void {
    const session = this.#getActiveStorySession();
    if (!session) {
      return;
    }

    this.#noteSessionCoordinator?.onExit();

    this.#storySessionManager?.exit();
    this.#pendingDocChange = true;
    this.#scheduleRerender();
    this.#editor.view?.focus();
  }

  #getActiveDomTarget(): HTMLElement | null {
    // While a story session is active, forwarded input targets the session
    // editor's DOM rather than the body's hidden editor DOM.
    const storyTarget = this.#storySessionManager?.getActiveEditorDomTarget();
    if (storyTarget) return storyTarget;

    const session = this.#headerFooterSession?.session;
    if (session && session.mode !== 'body') {
      const activeEditor = this.#headerFooterSession?.activeEditor;
      return activeEditor?.view?.dom ?? this.#editor.view?.dom ?? null;
    }
    return this.#editor.view?.dom ?? null;
  }

  #updateAwarenessSession() {
    const provider = this.#options.collaborationProvider;
    const awareness = provider?.awareness;

    // Runtime validation: ensure setLocalStateField method exists
    if (!awareness || typeof awareness.setLocalStateField !== 'function') {
      return;
    }

    const session = this.#headerFooterSession?.session;
    if (!session || session.mode === 'body') {
      awareness.setLocalStateField('layoutSession', null);
      return;
    }
    awareness.setLocalStateField('layoutSession', {
      kind: session.kind,
      headerId: session.headerFooterRefId ?? null,
      pageNumber: session.pageNumber ?? null,
    });
  }

  #announce(message: string) {
    if (!this.#ariaLiveRegion) return;
    this.#ariaLiveRegion.textContent = message;
  }

  #syncHiddenEditorA11yAttributes(): void {
    // Keep the hidden ProseMirror surface focusable and well-described for assistive technology.
    syncHiddenEditorA11yAttributesFromHelper(this.#editor?.view?.dom as unknown, this.#documentMode);
  }

  #scheduleA11ySelectionAnnouncement(options?: { immediate?: boolean }) {
    const sessionMode = this.#headerFooterSession?.session?.mode ?? 'body';
    this.#a11ySelectionAnnounceTimeout = scheduleA11ySelectionAnnouncementFromHelper(
      {
        ariaLiveRegion: this.#ariaLiveRegion,
        sessionMode,
        isDragging: this.#editorInputManager?.isDragging ?? false,
        visibleHost: this.#visibleHost,
        currentTimeout: this.#a11ySelectionAnnounceTimeout,
        announceNow: () => {
          this.#a11ySelectionAnnounceTimeout = null;
          this.#announceSelectionNow();
        },
      },
      options,
    );
  }

  #announceSelectionNow(): void {
    if (!this.#ariaLiveRegion) return;
    const announcement = computeA11ySelectionAnnouncementFromHelper(this.getActiveEditor().state);
    if (!announcement) return;

    if (announcement.key === this.#a11yLastAnnouncedSelectionKey) {
      return;
    }
    this.#a11yLastAnnouncedSelectionKey = announcement.key;
    this.#announce(announcement.message);
  }

  #emitHeaderFooterEditBlocked(reason: string) {
    this.emit('headerFooterEditBlocked', { reason });
  }

  #resolveDescriptorForRegion(region: HeaderFooterRegion): HeaderFooterDescriptor | null {
    return this.#headerFooterSession?.resolveDescriptorForRegion(region) ?? null;
  }

  /**
   * Gets the DOM element for a specific page index.
   *
   * @param pageIndex - Zero-based page index
   * @returns The page element or null if not mounted
   */
  #getPageElement(pageIndex: number): HTMLElement | null {
    return getPageElementByIndex(this.#painterHost, pageIndex);
  }

  #isSelectionAwareVirtualizationEnabled(): boolean {
    return Boolean(this.#layoutOptions.virtualization?.enabled && this.#layoutOptions.layoutMode === 'vertical');
  }

  #updateSelectionVirtualizationPins(options?: { includeDragBuffer?: boolean; extraPages?: number[] }): void {
    if (!this.#isSelectionAwareVirtualizationEnabled()) {
      return;
    }
    if (!this.#painterAdapter.hasPainter) {
      return;
    }
    const layout = this.#layoutState.layout;
    if (!layout) {
      return;
    }

    const state = this.getActiveEditor().state;
    const selection = state?.selection ?? null;
    const docSize = state?.doc?.content.size ?? null;
    const pins = computeSelectionVirtualizationPins({
      layout,
      blocks: this.#layoutState.blocks,
      measures: this.#layoutState.measures,
      selection: selection
        ? {
            from: selection.from,
            to: selection.to,
            anchor: (selection as unknown as { anchor?: number }).anchor,
            head: (selection as unknown as { head?: number }).head,
          }
        : null,
      docSize,
      includeDragBuffer: Boolean(options?.includeDragBuffer),
      isDragging: this.#editorInputManager?.isDragging ?? false,
      dragAnchorPageIndex: this.#editorInputManager?.dragAnchorPageIndex ?? null,
      dragLastHitPageIndex: this.#editorInputManager?.dragLastHitPageIndex ?? null,
      extraPages: options?.extraPages,
    });

    this.#painterAdapter.setVirtualizationPins(pins);
  }

  #finalizeDragSelectionWithDom(
    pointer: { clientX: number; clientY: number },
    anchor: number,
    mode: 'char' | 'word' | 'para',
  ): void {
    const layout = this.#layoutState.layout;
    if (!layout) return;

    const selection = this.getActiveEditor().state?.selection;
    if (selection instanceof CellSelection) {
      return;
    }

    const normalized = this.#normalizeClientPoint(pointer.clientX, pointer.clientY);
    if (!normalized) return;

    // Ensure endpoint pages are pinned so DOM hit testing can resolve without scrolling.
    const dragLastRawHit = this.#editorInputManager?.dragLastRawHit;
    this.#updateSelectionVirtualizationPins({
      includeDragBuffer: false,
      extraPages: dragLastRawHit ? [dragLastRawHit.pageIndex] : undefined,
    });

    const refined = resolvePointerPositionHit({
      layout,
      blocks: this.#layoutState.blocks,
      measures: this.#layoutState.measures,
      containerPoint: { x: normalized.x, y: normalized.y },
      domContainer: this.#viewportHost,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      geometryHelper: this.#pageGeometryHelper ?? undefined,
    });
    if (!refined) return;

    if (this.#isSelectionAwareVirtualizationEnabled() && this.#getPageElement(refined.pageIndex) == null) {
      debugLog('warn', 'Drag finalize: endpoint page still not mounted', { pageIndex: refined.pageIndex });
      return;
    }

    const prior = dragLastRawHit;
    if (prior && (prior.pos !== refined.pos || prior.pageIndex !== refined.pageIndex)) {
      debugLog('info', 'Drag finalize refined hit', {
        fromPos: prior.pos,
        toPos: refined.pos,
        fromPageIndex: prior.pageIndex,
        toPageIndex: refined.pageIndex,
      });
    }

    const doc = this.#editor.state?.doc;
    if (!doc) return;

    const mappedHead = this.#epochMapper.mapPosFromLayoutToCurrentDetailed(refined.pos, refined.layoutEpoch, 1);
    if (!mappedHead.ok) {
      debugLog('warn', 'drag finalize mapping failed', mappedHead);
      return;
    }

    const head = Math.max(0, Math.min(mappedHead.pos, doc.content.size));
    const extended = this.#calculateExtendedSelection(anchor, head, mode);
    const stabilized = stabilizeTextSelectionAcrossTableCells(doc, extended.selAnchor, extended.selHead);
    if (!stabilized) {
      return;
    }

    const current = this.#editor.state.selection;
    const desiredFrom = Math.min(stabilized.selAnchor, stabilized.selHead);
    const desiredTo = Math.max(stabilized.selAnchor, stabilized.selHead);
    if (current.from === desiredFrom && current.to === desiredTo) {
      return;
    }

    try {
      const tr = this.#editor.state.tr.setSelection(
        TextSelection.create(this.#editor.state.doc, stabilized.selAnchor, stabilized.selHead),
      );
      this.#editor.view?.dispatch(tr);
      this.#scheduleSelectionUpdate();
    } catch {
      // Ignore invalid positions during re-layout
    }
  }

  /**
   * Scrolls a page into view, triggering virtualization to mount it if needed.
   *
   * @param pageIndex - Zero-based page index to scroll to
   */
  #scrollPageIntoView(pageIndex: number): void {
    const layout = this.#layoutState.layout;
    if (!layout) return;

    const defaultHeight = layout.pageSize?.h ?? DEFAULT_PAGE_SIZE.h;
    const virtualGap = this.#getEffectivePageGap();

    // Use cumulative per-page heights so mixed-size documents scroll to the
    // correct position. The renderer's virtualizer uses the same prefix-sum
    // approach, so the scroll position lands inside the correct window.
    let yPosition = 0;
    for (let i = 0; i < pageIndex; i++) {
      const pageHeight = layout.pages[i]?.size?.h ?? defaultHeight;
      yPosition += pageHeight + virtualGap;
    }

    // Scroll viewport to the calculated position.
    //
    // The authoritative scrollable ancestor is `#scrollContainer` — setting
    // scrollTop on the visible host alone is a no-op when the host is
    // `overflow: visible` (the standard layout). Without this, anchor
    // navigation (TOC clicks, cross-reference click-to-navigate under
    // SD-2495) silently does nothing whenever the target page is outside
    // the current viewport.
    //
    // We also write to `#visibleHost` for backwards compatibility: legacy
    // layouts may make the visible host itself scrollable, and tests mock
    // scrollTop on the host element.
    if (this.#scrollContainer instanceof Window) {
      this.#scrollContainer.scrollTo({ top: yPosition });
    } else if (this.#scrollContainer) {
      this.#scrollContainer.scrollTop = yPosition;
    }
    if (this.#visibleHost && this.#visibleHost !== this.#scrollContainer) {
      this.#visibleHost.scrollTop = yPosition;
    }
  }

  /**
   * Timeout duration for anchor navigation when waiting for page mount (in milliseconds).
   * This allows sufficient time for virtualized pages to render before giving up.
   */
  private static readonly ANCHOR_NAV_TIMEOUT_MS = 2000;

  /**
   * Scroll to any document element by its ID.
   *
   * Accepts any element ID — paragraph nodeId, comment entityId, or tracked
   * change entityId. Resolves the element type automatically:
   * 1. Tries block index lookup (paragraphs, headings, tables)
   * 2. Tries comment navigation (activates comment thread)
   * 3. Tries tracked change navigation (with raw ID fallback)
   *
   * @param elementId - The element's stable ID (nodeId, commentId, or trackedChangeId).
   * @returns Promise resolving to true if the element was found and scrolled to.
   */
  async scrollToElement(elementId: string): Promise<boolean> {
    if (!elementId) return false;

    // Try block first — O(1) index lookup, most common for RAG citations.
    if (await this.navigateTo({ kind: 'block', nodeId: elementId })) return true;

    // Try comment — setCursorById handles both comment and TC marks,
    // but we try comment first to get full thread activation.
    if (await this.navigateTo({ kind: 'entity', entityType: 'comment', entityId: elementId })) return true;

    // Try tracked change — has its own fallback chain (canonical → raw ID → scroll).
    if (await this.navigateTo({ kind: 'entity', entityType: 'trackedChange', entityId: elementId })) return true;

    return false;
  }

  /**
   * Navigate to a typed document element address.
   *
   * @param target - Typed address: block, bookmark, comment, or tracked change.
   * @param options - Scroll options forwarded to the underlying scroll path.
   *   `behavior` defaults to `'auto'` so existing internal callers keep their
   *   instant-scroll behavior; the `superdoc/ui` viewport surface opts into
   *   `'smooth'` at its own boundary. `block` defaults to `'center'`.
   * @returns Promise resolving to true if navigation succeeded.
   */
  async navigateTo(target: NavigableAddress, options: PresentationNavigationOptions = {}): Promise<boolean> {
    if (!target) return false;

    try {
      if (target.kind === 'block') {
        return await this.#navigateToBlock(target, options);
      }

      if (target.kind === 'entity') {
        if (target.entityType === 'bookmark') {
          return await this.#navigateToBookmark(target);
        }
        if (target.entityType === 'comment') {
          return await this.#navigateToComment(target.entityId, options);
        }
        if (target.entityType === 'trackedChange') {
          return await this.#navigateToTrackedChange(
            target.entityId,
            resolveStoryKeyFromAddress(target.story),
            target.pageIndex,
            options,
          );
        }
      }

      return false;
    } catch (error) {
      console.error('[PresentationEditor] navigateTo failed:', error);
      this.emit('error', { error, context: 'navigateTo' });
      return false;
    }
  }

  async #navigateToBlock(
    target: BlockNavigationAddress,
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    const editor = this.#editor;
    if (!editor) return false;

    const index = getBlockIndex(editor);

    let candidate;
    try {
      if (target.nodeType) {
        candidate = findBlockById(index, { kind: 'block', nodeType: target.nodeType, nodeId: target.nodeId });
      } else {
        candidate = findBlockByNodeIdOnly(index, target.nodeId);
      }
    } catch {
      return false;
    }

    if (!candidate) return false;
    return this.#scrollToBlockCandidate(editor, candidate, options);
  }

  /**
   * Scroll to a resolved block candidate and place the cursor inside it.
   *
   * Resolves the first text-content position inside the block — the layout
   * engine maps fragments to text content ranges, so block wrappers and
   * zero-width annotation nodes (bookmarkStart, commentRangeStart) don't
   * generate layout fragments. We walk the block's children to find the
   * first inline node with text content (typically a `run` node).
   */
  async #scrollToBlockCandidate(
    editor: Editor,
    candidate: { pos: number },
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    const blockNode = editor.state.doc.nodeAt(candidate.pos);
    let contentPos = candidate.pos + 1;
    if (blockNode) {
      blockNode.forEach((child, offset) => {
        if (contentPos !== candidate.pos + 1) return;
        if (child.textContent.length > 0) {
          contentPos = candidate.pos + 1 + offset + (child.isText ? 0 : 1);
        }
      });
    }

    const scrolled = await this.scrollToPositionAsync(contentPos, {
      behavior: options.behavior ?? 'auto',
      block: options.block ?? 'center',
      shouldContinue: options.shouldContinue,
    });
    if (!scrolled) return false;
    if (!shouldContinueNavigation(options)) return false;

    editor.commands?.setTextSelection?.({ from: contentPos, to: contentPos });
    editor.view?.focus?.();
    return true;
  }

  async #navigateToComment(entityId: string, options: PresentationNavigationOptions = {}): Promise<boolean> {
    const editor = this.#editor;
    if (!editor) return false;

    const setCursorById = editor.commands?.setCursorById;
    if (typeof setCursorById !== 'function') return false;

    if (!setCursorById(entityId, { preferredActiveThreadId: entityId, activeCommentId: entityId })) {
      return false;
    }

    // Scroll the viewport — setCursorById places the cursor but doesn't
    // scroll in presentation mode where DomPainter renders the output.
    await this.scrollToPositionAsync(editor.state.selection.from, {
      behavior: options.behavior ?? 'auto',
      block: options.block ?? 'center',
      shouldContinue: options.shouldContinue,
    });
    return shouldContinueNavigation(options);
  }

  async #navigateToBookmark(target: BookmarkAddress): Promise<boolean> {
    const editor = this.#editor;
    if (!editor) return false;

    let storyKey = resolveStoryKeyFromAddress(target.story);

    if (!storyKey) {
      const entry = findAllBookmarksInDocument(editor).find((bookmark) => bookmark.name === target.name);
      if (!entry) {
        return false;
      }
      storyKey = entry.storyKey;
    }

    if (!storyKey || storyKey === BODY_STORY_KEY) {
      this.exitActiveStorySurface();
      return await this.goToAnchor(target.name);
    }

    if (this.#navigateToActiveStoryBookmark(target.name, storyKey)) {
      return true;
    }

    const activatedStoryKey = await this.#activateBookmarkStorySurface(storyKey);
    if (activatedStoryKey) {
      return this.#navigateToActiveStoryBookmark(target.name, activatedStoryKey);
    }

    return false;
  }

  async #navigateToTrackedChange(
    entityId: string,
    storyKey?: string,
    preferredPageIndex?: number,
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    const editor = this.#editor;
    if (!editor) return false;

    const behavior = options.behavior ?? 'auto';
    const block = options.block ?? 'center';
    const navigationIds = this.#resolveTrackedChangeNavigationIds(entityId, storyKey);
    if (!shouldContinueNavigation(options)) return false;

    if (storyKey && storyKey !== BODY_STORY_KEY) {
      for (const id of navigationIds) {
        if (!shouldContinueNavigation(options)) return false;
        if (this.#navigateToActiveStoryTrackedChange(id, storyKey)) {
          return true;
        }
      }

      for (const id of navigationIds) {
        if (await this.#activateTrackedChangeStorySurface(id, storyKey, preferredPageIndex, options)) {
          if (!shouldContinueNavigation(options)) return false;
          for (const activeId of navigationIds) {
            if (!shouldContinueNavigation(options)) return false;
            if (this.#navigateToActiveStoryTrackedChange(activeId, storyKey)) {
              return true;
            }
          }
        }
      }

      for (const id of navigationIds) {
        if (!shouldContinueNavigation(options)) return false;
        if (
          await this.#scrollToRenderedTrackedChange(id, storyKey, preferredPageIndex, {
            behavior,
            block,
            shouldContinue: options.shouldContinue,
          })
        ) {
          return true;
        }
      }
      return false;
    }

    this.exitActiveStorySurface();

    const setCursorById = editor.commands?.setCursorById;

    for (const id of navigationIds) {
      if (!shouldContinueNavigation(options)) return false;
      const selection = resolveTrackedChangeNavigationSelection(editor, id);
      if (!selection) continue;
      const setTextSelection = editor.commands?.setTextSelection;
      const scrolled = await this.scrollToPositionAsync(selection.from, {
        behavior,
        block,
        shouldContinue: options.shouldContinue,
      });
      if (!scrolled || !shouldContinueNavigation(options)) return false;
      if (typeof setTextSelection !== 'function' || setTextSelection(selection) !== true) continue;
      editor.view?.focus?.();
      this.#scheduleNavigatedSelectionRender(selection.from);
      return true;
    }

    // Try direct cursor placement, then scroll to the new selection.
    if (typeof setCursorById === 'function') {
      for (const id of navigationIds) {
        if (!shouldContinueNavigation(options)) return false;
        if (setCursorById(id, { preferredActiveThreadId: id })) {
          const scrolled = await this.scrollToPositionAsync(editor.state.selection.from, {
            behavior,
            block,
            shouldContinue: options.shouldContinue,
          });
          if (!scrolled || !shouldContinueNavigation(options)) return false;
          editor.view?.focus?.();
          this.#scheduleNavigatedSelectionRender(editor.state.selection.from);
          return true;
        }
      }
    }

    // Fall back to resolving the tracked change position and scrolling.
    const resolved = navigationIds.map((id) => resolveTrackedChange(editor, id)).find(Boolean);
    if (!resolved) {
      for (const id of navigationIds) {
        if (
          await this.#scrollToRenderedTrackedChange(id, undefined, preferredPageIndex, {
            behavior,
            block,
            shouldContinue: options.shouldContinue,
          })
        ) {
          return true;
        }
      }
      return false;
    }

    // Try with the raw ID (tracked changes may use a different internal ID).
    if (typeof setCursorById === 'function' && resolved.rawId !== entityId) {
      if (!shouldContinueNavigation(options)) return false;
      if (setCursorById(resolved.rawId, { preferredActiveThreadId: resolved.rawId })) {
        const scrolled = await this.scrollToPositionAsync(editor.state.selection.from, {
          behavior,
          block,
          shouldContinue: options.shouldContinue,
        });
        if (!scrolled || !shouldContinueNavigation(options)) return false;
        editor.view?.focus?.();
        this.#scheduleNavigatedSelectionRender(editor.state.selection.from);
        return true;
      }
    }

    // Last resort: scroll to position directly.
    const scrolled = await this.scrollToPositionAsync(resolved.from, {
      behavior,
      block,
      shouldContinue: options.shouldContinue,
    });
    if (!scrolled || !shouldContinueNavigation(options)) return false;

    editor.commands?.setTextSelection?.({ from: resolved.from, to: resolved.from });
    editor.view?.focus?.();
    this.#scheduleNavigatedSelectionRender(resolved.from);
    return true;
  }

  #resolveTrackedChangeNavigationIds(entityId: string, storyKey?: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (value: unknown) => {
      if (value === undefined || value === null) return;
      const id = String(value).trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };

    add(entityId);

    let story: StoryLocator | undefined;
    if (storyKey && storyKey !== BODY_STORY_KEY) {
      try {
        story = parseStoryKey(storyKey);
      } catch {
        story = undefined;
      }
    }

    try {
      const resolved = resolveTrackedChangeInStory(this.#editor, {
        kind: 'entity',
        entityType: 'trackedChange',
        entityId,
        ...(story ? { story } : {}),
      });
      add(resolved?.change?.commandRawId);
      add(resolved?.change?.rawId);
      add(resolved?.change?.id);
    } catch {
      // Navigation still has direct-id and rendered-DOM fallbacks.
    }

    return ids;
  }

  async #activateTrackedChangeStorySurface(
    entityId: string,
    storyKey: string,
    preferredPageIndex?: number,
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    let locator: StoryLocator | null = null;
    try {
      locator = parseStoryKey(storyKey);
    } catch {
      return false;
    }

    if (!locator || locator.storyType === 'body') {
      return false;
    }
    if (!shouldContinueNavigation(options)) return false;

    const candidate = this.#findRenderedTrackedChangeElement(entityId, storyKey, preferredPageIndex);
    if (!candidate) {
      return false;
    }
    if (!shouldContinueNavigation(options)) return false;

    const rect = candidate.getBoundingClientRect();
    const clientX = rect.left + Math.max(rect.width / 2, 1);
    const clientY = rect.top + Math.max(rect.height / 2, 1);
    const pageIndex = this.#resolveRenderedPageIndexForElement(candidate);
    if (!shouldContinueNavigation(options)) return false;

    if (locator.storyType === 'footnote' || locator.storyType === 'endnote') {
      try {
        if (!shouldContinueNavigation(options)) return false;
        if (
          !this.#activateRenderedNoteSession(
            {
              storyType: locator.storyType,
              noteId: locator.noteId,
            },
            { clientX, clientY, pageIndex },
          )
        ) {
          return false;
        }
      } catch {
        return false;
      }

      return this.#waitForTrackedChangeStorySurface(storyKey, undefined, options);
    }

    if (locator.storyType !== 'headerFooterPart') {
      return false;
    }

    const pageElement = candidate.closest<HTMLElement>('.superdoc-page');
    const pageRect = pageElement?.getBoundingClientRect();
    const pageLocalY = pageRect ? clientY - pageRect.top : undefined;
    const region = this.#hitTestHeaderFooterRegion(clientX, clientY, pageIndex, pageLocalY);
    if (!region) {
      return false;
    }
    if (!shouldContinueNavigation(options)) return false;

    this.#activateHeaderFooterRegion(region, {
      clientX,
      clientY,
      pageIndex,
      source: 'programmatic',
    });
    return this.#waitForTrackedChangeStorySurface(storyKey, undefined, options);
  }

  async #waitForTrackedChangeStorySurface(
    storyKey: string,
    timeoutMs = 500,
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!shouldContinueNavigation(options)) {
        return false;
      }
      if (this.#getActiveTrackedChangeStorySurface()?.storyKey === storyKey) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }

    if (!shouldContinueNavigation(options)) {
      return false;
    }
    return this.#getActiveTrackedChangeStorySurface()?.storyKey === storyKey;
  }

  async #activateBookmarkStorySurface(storyKey: string): Promise<string | null> {
    let locator: StoryLocator | null = null;
    try {
      locator = parseStoryKey(storyKey);
    } catch {
      return null;
    }

    if (!locator || locator.storyType === 'body') {
      return null;
    }

    if (locator.storyType === 'footnote' || locator.storyType === 'endnote') {
      return this.#activateBookmarkNoteStorySurface(locator);
    }

    if (locator.storyType === 'headerFooterPart' || locator.storyType === 'headerFooterSlot') {
      return this.#activateBookmarkHeaderFooterSurface(locator);
    }

    return null;
  }

  async #activateBookmarkNoteStorySurface(
    locator: Extract<StoryLocator, { storyType: 'footnote' | 'endnote' }>,
  ): Promise<string | null> {
    const targetContext = this.#buildNoteLayoutContext({
      storyType: locator.storyType,
      noteId: locator.noteId,
    });

    if ((this.#headerFooterSession?.session?.mode ?? 'body') !== 'body') {
      this.#headerFooterSession?.exitMode();
    }

    const firstPageIndex = targetContext?.firstPageIndex ?? 0;
    const hostWidthPx = targetContext?.hostWidthPx ?? Math.max(1, this.#visibleHost?.clientWidth ?? 1);

    this.#scrollPageIntoView(firstPageIndex);

    const totalPageCount = this.#layoutState.layout?.pages?.length ?? 1;
    const pageNumber = Math.max(1, firstPageIndex + 1);

    this.#ensureStorySessionManager().activate(locator, {
      commitPolicy: 'onExit',
      preferHiddenHost: true,
      hostWidthPx,
      editorContext: {
        currentPageNumber: pageNumber,
        totalPageCount: Math.max(1, totalPageCount),
        surfaceKind: locator.storyType === 'endnote' ? 'endnote' : 'note',
      },
    });

    const storyKey = buildStoryKey(locator);
    return (await this.#waitForTrackedChangeStorySurface(storyKey)) ? storyKey : null;
  }

  async #activateBookmarkHeaderFooterSurface(
    locator: Extract<StoryLocator, { storyType: 'headerFooterPart' | 'headerFooterSlot' }>,
  ): Promise<string | null> {
    const region = this.#findHeaderFooterRegionForBookmarkLocator(locator);
    const expectedRefId =
      locator.storyType === 'headerFooterPart'
        ? locator.refId
        : region
          ? this.#resolveBookmarkHeaderFooterRefId(region, locator)
          : null;

    if (!region || !expectedRefId) {
      return null;
    }

    this.#scrollPageIntoView(region.pageIndex);
    await this.#waitForPageMount(region.pageIndex, { timeout: PresentationEditor.ANCHOR_NAV_TIMEOUT_MS });

    const activeEditor = await this.#headerFooterSession?.activateRegion(region, {
      initialSelection: 'defer',
      documentMode: this.#getActiveEditorDocumentMode() ?? this.#getEffectiveDocumentMode(),
    });
    if (!activeEditor) {
      return null;
    }

    return buildStoryKey({
      kind: 'story',
      storyType: 'headerFooterPart',
      refId: expectedRefId,
    });
  }

  #resolveBookmarkHeaderFooterRefId(
    region: HeaderFooterRegion,
    locator: Extract<StoryLocator, { storyType: 'headerFooterSlot' }>,
  ): string | null {
    if (region.headerFooterRefId) {
      return region.headerFooterRefId;
    }

    const page = this.#layoutState.layout?.pages?.[region.pageIndex];
    if (!page) {
      return null;
    }

    const refCollection =
      locator.headerFooterKind === 'header' ? page.sectionRefs?.headerRefs : page.sectionRefs?.footerRefs;
    if (!refCollection) {
      return null;
    }

    const normalizedRegionVariant = region.sectionType ? normalizeVariant(region.sectionType) : null;
    const candidates = [region.sectionType, normalizedRegionVariant, locator.variant].filter(
      (variant): variant is string => typeof variant === 'string' && variant.length > 0,
    );

    for (const variant of candidates) {
      const refId = refCollection[variant as keyof typeof refCollection];
      if (typeof refId === 'string' && refId.length > 0) {
        return refId;
      }
    }

    return null;
  }

  #findHeaderFooterRegionForBookmarkLocator(
    locator: Extract<StoryLocator, { storyType: 'headerFooterPart' | 'headerFooterSlot' }>,
  ): HeaderFooterRegion | null {
    const manager = this.#headerFooterSession;
    if (!manager) {
      return null;
    }

    const searchRegions =
      locator.storyType === 'headerFooterSlot'
        ? locator.headerFooterKind === 'header'
          ? manager.headerRegions
          : manager.footerRegions
        : new Map([...manager.headerRegions.entries(), ...manager.footerRegions.entries()]);

    for (const region of searchRegions.values()) {
      if (locator.storyType === 'headerFooterPart') {
        if (region.headerFooterRefId === locator.refId) {
          return region;
        }
        continue;
      }

      if (region.sectionId !== locator.section.sectionId) {
        continue;
      }

      if (region.sectionType && normalizeVariant(region.sectionType) !== locator.variant) {
        continue;
      }

      return region;
    }

    if (locator.storyType === 'headerFooterPart') {
      const layout = this.#layoutState.layout;
      if (!layout) {
        return null;
      }

      for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
        const page = layout.pages[pageIndex];
        const headerRefs = Object.values(page.sectionRefs?.headerRefs ?? {});
        if (headerRefs.includes(locator.refId)) {
          return manager.getRegionForPage('header', pageIndex) ?? manager.findRegionForPage('header', pageIndex);
        }

        const footerRefs = Object.values(page.sectionRefs?.footerRefs ?? {});
        if (footerRefs.includes(locator.refId)) {
          return manager.getRegionForPage('footer', pageIndex) ?? manager.findRegionForPage('footer', pageIndex);
        }
      }
    }

    return null;
  }

  #navigateToActiveStoryBookmark(name: string, storyKey: string): boolean {
    const activeSurface = this.#getActiveTrackedChangeStorySurface();
    if (!activeSurface || activeSurface.storyKey !== storyKey) {
      return false;
    }

    let resolved;
    try {
      resolved = resolveBookmarkTarget(activeSurface.editor.state.doc, {
        kind: 'entity',
        entityType: 'bookmark',
        name,
      });
    } catch {
      return false;
    }

    activeSurface.editor.commands?.setTextSelection?.({ from: resolved.pos, to: resolved.pos });
    this.#focusAndRevealActiveStorySelection(activeSurface.editor);
    return true;
  }

  #navigateToActiveStoryTrackedChange(entityId: string, storyKey: string): boolean {
    const activeSurface = this.#getActiveTrackedChangeStorySurface();
    if (!activeSurface || activeSurface.storyKey !== storyKey) {
      return false;
    }

    const sessionEditor = activeSurface.editor;
    const setCursorById = sessionEditor.commands?.setCursorById;
    const navigationSelection = resolveTrackedChangeNavigationSelection(sessionEditor, entityId);
    const setTextSelection = sessionEditor.commands?.setTextSelection;

    if (
      navigationSelection &&
      typeof setTextSelection === 'function' &&
      setTextSelection(navigationSelection) === true
    ) {
      this.#focusAndRevealActiveStorySelection(sessionEditor);
      return true;
    }

    if (typeof setCursorById === 'function' && setCursorById(entityId, { preferredActiveThreadId: entityId })) {
      this.#focusAndRevealActiveStorySelection(sessionEditor);
      return true;
    }

    const resolved = resolveTrackedChange(sessionEditor, entityId);
    if (!resolved) {
      return false;
    }

    if (typeof setCursorById === 'function' && resolved.rawId !== entityId) {
      if (setCursorById(resolved.rawId, { preferredActiveThreadId: resolved.rawId })) {
        this.#focusAndRevealActiveStorySelection(sessionEditor);
        return true;
      }
    }

    sessionEditor.commands?.setTextSelection?.({ from: resolved.from, to: resolved.from });
    this.#focusAndRevealActiveStorySelection(sessionEditor);
    return true;
  }

  #focusAndRevealActiveStorySelection(editor: Editor): void {
    editor.view?.focus?.();
    this.#shouldScrollSelectionIntoView = true;
    this.#scheduleSelectionUpdate({ immediate: true });
  }

  #findRenderedTrackedChangeElement(
    entityId: string,
    storyKey?: string,
    preferredPageIndex?: number,
  ): HTMLElement | null {
    const candidates = this.#findRenderedTrackedChangeElements(entityId, storyKey);
    if (!candidates.length) {
      return null;
    }

    if (!Number.isFinite(preferredPageIndex)) {
      return candidates[0] ?? null;
    }

    return (
      candidates.find((candidate) => this.#resolveRenderedPageIndexForElement(candidate) === preferredPageIndex) ??
      candidates[0] ??
      null
    );
  }

  async #scrollToRenderedTrackedChange(
    entityId: string,
    storyKey?: string,
    preferredPageIndex?: number,
    options: PresentationNavigationOptions = {},
  ): Promise<boolean> {
    const candidate = this.#findRenderedTrackedChangeElement(entityId, storyKey, preferredPageIndex);
    if (!candidate) {
      return false;
    }
    if (!shouldContinueNavigation(options)) {
      return false;
    }

    try {
      candidate.scrollIntoView({
        behavior: options.behavior ?? 'auto',
        block: options.block ?? 'center',
        inline: 'nearest',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to a bookmark/anchor in the current document (e.g., TOC links).
   *
   * This method performs asynchronous navigation to support virtualized page rendering:
   * 1. Normalizes the anchor by removing leading '#' if present
   * 2. Looks up the bookmark in the document's bookmark registry
   * 3. Determines which page contains the target position
   * 4. Scrolls the page into view (may be virtualized)
   * 5. Waits up to 2000ms for the page to mount in the DOM
   * 6. Moves the editor caret to the bookmark position
   *
   * @param anchor - Bookmark name or fragment identifier (with or without leading '#')
   * @returns Promise resolving to true if navigation succeeded, false otherwise
   *
   * @remarks
   * Navigation fails and returns false if:
   * - The anchor parameter is empty or becomes empty after normalization
   * - No layout has been computed yet
   * - The bookmark does not exist in the document
   * - The bookmark's page cannot be determined
   * - The page fails to mount within the timeout period (2000ms)
   *
   * Note: This method does not throw errors. All failures are logged and result in
   * a false return value. An 'error' event is emitted for unhandled exceptions.
   *
   * @throws Never throws directly - errors are caught, logged, and emitted as events
   */
  async goToAnchor(anchor: string): Promise<boolean> {
    try {
      return await goToAnchorFromHelper({
        anchor,
        layout: this.#layoutState.layout,
        blocks: this.#layoutState.blocks,
        measures: this.#layoutState.measures,
        bookmarks: this.#layoutState.bookmarks,
        resolveAnchorPosition: (name) => {
          try {
            return resolveBookmarkTarget(this.#editor.state.doc, {
              kind: 'entity',
              entityType: 'bookmark',
              name,
            }).pos;
          } catch {
            return null;
          }
        },
        pageGeometryHelper: this.#pageGeometryHelper ?? undefined,
        painterHost: this.#painterHost,
        scrollContainer: this.#scrollContainer ?? this.#visibleHost,
        zoom: this.zoom,
        scrollPageIntoView: (pageIndex) => this.#scrollPageIntoView(pageIndex),
        waitForPageMount: (pageIndex, timeoutMs) => this.#waitForPageMount(pageIndex, { timeout: timeoutMs }),
        getActiveEditor: () => this.getActiveEditor(),
        timeoutMs: PresentationEditor.ANCHOR_NAV_TIMEOUT_MS,
      });
    } catch (error) {
      console.error('[PresentationEditor] goToAnchor failed:', error);
      this.emit('error', {
        error,
        context: 'goToAnchor',
      });
      return false;
    }
  }

  /**
   * Waits for a page to be mounted in the DOM after scrolling.
   *
   * Polls for the page element using requestAnimationFrame until it appears
   * or the timeout is exceeded.
   *
   * @param pageIndex - Zero-based page index to wait for
   * @param options - Configuration options
   * @param options.timeout - Maximum time to wait in milliseconds (default: 2000)
   * @returns Promise that resolves to true if page was mounted, false if timeout
   */
  async #waitForPageMount(pageIndex: number, options: { timeout?: number } = {}): Promise<boolean> {
    const timeout = options.timeout ?? 2000;
    const startTime = performance.now();

    return new Promise((resolve) => {
      const checkPage = () => {
        const pageElement = this.#getPageElement(pageIndex);
        if (pageElement) {
          resolve(true);
          return;
        }

        const elapsed = performance.now() - startTime;
        if (elapsed >= timeout) {
          resolve(false);
          return;
        }

        requestAnimationFrame(checkPage);
      };

      checkPage();
    });
  }

  /**
   * Get effective page gap based on layout mode and virtualization settings.
   * Keeps painter, layout, and geometry in sync.
   * Uses DEFAULT_PAGE_GAP for both virtualized and non-virtualized modes for visual consistency.
   */
  #getEffectivePageGap(): number {
    if (this.#isSemanticFlowMode()) {
      return 0;
    }
    if (this.#layoutOptions.virtualization?.enabled) {
      // Use explicit gap if provided, otherwise use same default as non-virtualized for consistency
      return Math.max(0, this.#layoutOptions.virtualization.gap ?? DEFAULT_PAGE_GAP);
    }
    if (this.#layoutOptions.layoutMode === 'horizontal') {
      return DEFAULT_HORIZONTAL_PAGE_GAP;
    }
    return DEFAULT_PAGE_GAP;
  }

  #getBodyPageHeight() {
    return this.#layoutState.layout?.pageSize?.h ?? this.#layoutOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h;
  }

  /**
   * Get the page height for the current header/footer context.
   * Delegates to HeaderFooterSessionManager which handles context lookup and fallbacks.
   */
  #getHeaderFooterPageHeight(): number {
    return this.#headerFooterSession?.getPageHeight() ?? 1;
  }

  /**
   * Renders visual highlighting for CellSelection (multiple table cells selected).
   *
   * This method creates blue overlay rectangles for each selected cell in a table,
   * accounting for merged cells (colspan/rowspan), multi-page tables, and accurate
   * row/column positioning from layout measurements.
   *
   * Algorithm:
   * 1. Locate the table node by walking up the selection hierarchy
   * 2. Find the corresponding table block in layout state
   * 3. Collect all table fragments (tables can span multiple pages)
   * 4. Use TableMap to convert cell positions to row/column indices
   * 5. For each selected cell:
   *    - Find the fragment containing this cell's row
   *    - Look up column boundary information from fragment metadata
   *    - Calculate cell width (sum widths for colspan > 1)
   *    - Calculate cell height from row measurements (sum heights for rowspan > 1)
   *    - Convert page-local coordinates to overlay coordinates
   *    - Create and append highlight DOM element
   *
   * Edge cases handled:
   * - Tables spanning multiple pages (iterate all fragments)
   * - Merged cells (colspan and rowspan attributes)
   * - Missing measure data (fallback to estimated row heights)
   * - Invalid table structures (TableMap.get wrapped in try-catch)
   * - Cells outside fragment boundaries (skipped)
   *
   * @param selection - The CellSelection from ProseMirror tables plugin
   * @param layout - The current layout containing table fragments and measurements
   * @returns void - Renders directly to this.#localSelectionLayer
   * @private
   *
   * @throws Never throws - all errors are caught and logged, rendering gracefully degrades
   */
  #renderCellSelectionOverlay(selection: CellSelection, layout: Layout): void {
    const localSelectionLayer = this.#localSelectionLayer;
    if (!localSelectionLayer) return;
    renderCellSelectionOverlay({
      selection,
      layout,
      localSelectionLayer,
      blocks: this.#layoutState.blocks,
      measures: this.#layoutState.measures,
      cellAnchorTableBlockId: this.#editorInputManager?.cellAnchor?.tableBlockId ?? null,
      convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
    });
  }

  /**
   * Render header/footer hover highlight for a region.
   * Delegates to HeaderFooterSessionManager which manages the hover UI elements.
   */
  #renderHoverRegion(region: HeaderFooterRegion) {
    this.#headerFooterSession?.renderHover(region);
  }

  /**
   * Clear header/footer hover highlight.
   * Delegates to HeaderFooterSessionManager which manages the hover UI elements.
   */
  #clearHoverRegion() {
    this.#headerFooterSession?.clearHover();
  }

  #getHeaderFooterContext(): HeaderFooterLayoutContext | null {
    return this.#headerFooterSession?.getContext() ?? null;
  }

  /**
   * Compute selection rectangles in header/footer mode.
   * Delegates to HeaderFooterSessionManager which handles context lookup and coordinate transformation.
   */
  #computeHeaderFooterSelectionRects(from: number, to: number): LayoutRect[] {
    return this.#headerFooterSession?.computeSelectionRects(from, to) ?? [];
  }

  #computeHeaderFooterCaretRect(pos: number): LayoutRect | null {
    return this.#headerFooterSession?.computeCaretRect(pos) ?? null;
  }

  /**
   * Translate an active hidden-editor position into a visible-text offset.
   *
   * `domAtPos()` gives the correct DOM boundary inside the hidden note editor,
   * even when the PM position sits inside tracked-change wrapper structure. We
   * then measure that boundary as visible text so it can be projected onto the
   * painted note surface without relying on raw PM ranges.
   */
  #measureActiveEditorVisibleTextOffset(pos: number): number | null {
    if (!Number.isFinite(pos)) {
      return null;
    }

    const activeEditor = this.getActiveEditor();
    const view = activeEditor?.view;
    const root = view?.dom as HTMLElement | null;
    if (!view || !root) {
      return null;
    }

    try {
      const domPoint = view.domAtPos(pos);
      if (!domPoint?.node) {
        return null;
      }

      return measureVisibleTextOffsetFromHelper(root, domPoint.node, domPoint.offset);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to measure active editor visible text offset:', error);
      }
      return null;
    }
  }

  #computeNoteSelectionRectsFromDom(context: NoteLayoutContext, from: number, to: number): LayoutRect[] | null {
    const layout = this.#layoutState.layout;
    if (!layout) {
      return null;
    }

    const noteFragments = this.#getRenderedNoteFragmentElements(this.#collectNoteBlockIds(context));
    if (!noteFragments.length) {
      return null;
    }

    const geometryOptions = {
      containers: noteFragments,
      zoom: this.#layoutOptions.zoom ?? 1,
      pageHeight: this.#getBodyPageHeight(),
      pageGap: layout.pageGap ?? this.#getEffectivePageGap(),
    };

    // Same block-anchored pm-first strategy as #computeNoteDomCaretRect (SD-3400).
    const pmRects = computeSelectionRectsFromPmRangeFromHelper(geometryOptions, from, to, {
      from: this.#resolveNoteBlockAnchor(from),
      to: this.#resolveNoteBlockAnchor(to),
    });
    if (pmRects != null) {
      return pmRects;
    }

    // Same in-flight-rerender guard as #computeNoteDomCaretRect (SD-3400).
    if (this.#renderScheduled || this.#isRerendering || this.#pendingDocChange) {
      this.#scheduleSelectionUpdate({ immediate: false });
      return null;
    }

    const startOffset = this.#measureActiveEditorVisibleTextOffset(Math.min(from, to));
    const endOffset = this.#measureActiveEditorVisibleTextOffset(Math.max(from, to));
    if (startOffset == null || endOffset == null) {
      return null;
    }

    const renderedStartOffset = this.#toRenderedNoteVisibleTextOffset(noteFragments, startOffset);
    const renderedEndOffset = this.#toRenderedNoteVisibleTextOffset(noteFragments, endOffset);

    return computeSelectionRectsFromVisibleTextOffsetsFromHelper(
      geometryOptions,
      renderedStartOffset,
      renderedEndOffset,
    );
  }

  #computeNoteSelectionRects(from: number, to: number): LayoutRect[] | null {
    const context = this.#buildActiveNoteLayoutContext();
    const layout = this.#layoutState.layout;
    if (!context || !layout) {
      return null;
    }

    const domRects = this.#computeNoteSelectionRectsFromDom(context, from, to);
    if (domRects != null) {
      return domRects;
    }

    return selectionToRects(layout, context.blocks, context.measures, from, to, this.#pageGeometryHelper ?? undefined);
  }

  /**
   * Anchors a session position to its paragraph block for stale-tolerant
   * caret resolution (SD-3400): painted pm ranges of unchanged note
   * paragraphs drift after edits, but block identity (sdBlockId) plus the
   * block's current first-leaf position let the geometry helper translate
   * into the fragment's coordinate space.
   */
  #resolveNoteBlockAnchor(pos: number): { sdBlockId: string; currentStart: number } | null {
    const doc = this.getActiveEditor()?.state?.doc;
    if (!doc || !Number.isFinite(pos)) return null;
    try {
      const clamped = Math.max(0, Math.min(pos, doc.content.size));
      const $pos = doc.resolve(clamped);
      let blockDepth = 0;
      for (let depth = $pos.depth; depth >= 1; depth -= 1) {
        if ($pos.node(depth).isBlock) blockDepth = depth;
      }
      if (!blockDepth) return null;
      const blockNode = $pos.node(blockDepth);
      const sdBlockId = blockNode.attrs?.sdBlockId;
      if (typeof sdBlockId !== 'string' || !sdBlockId) return null;
      const blockPos = $pos.before(blockDepth);
      let currentStart: number | null = null;
      doc.nodesBetween(blockPos, blockPos + blockNode.nodeSize, (node, nodePos) => {
        if (currentStart != null) return false;
        if (node.isInline && (node.isLeaf || node.isText)) {
          currentStart = nodePos;
          return false;
        }
        return true;
      });
      // Empty paragraph: no inline leaf exists, its only caret position is
      // the block's content start. The painted placeholder line anchors there.
      if (currentStart == null) currentStart = blockPos + 1;
      return { sdBlockId, currentStart };
    } catch {
      return null;
    }
  }

  #computeNoteDomCaretRect(context: NoteLayoutContext, pos: number): LayoutRect | null {
    const layout = this.#layoutState.layout;
    if (!layout) {
      return null;
    }

    const noteBlockIds = this.#collectNoteBlockIds(context);
    if (noteBlockIds.size === 0) {
      return null;
    }

    const noteFragments = this.#getRenderedNoteFragmentElements(noteBlockIds);
    if (!noteFragments.length) {
      return null;
    }

    const geometryOptions = {
      containers: noteFragments,
      zoom: this.#layoutOptions.zoom ?? 1,
      pageHeight: this.#getBodyPageHeight(),
      pageGap: layout.pageGap ?? this.#getEffectivePageGap(),
    };

    // Resolve by block identity first (stale-tolerant), then by global pm
    // ranges. Painted pm ranges of unchanged note paragraphs drift after
    // edits, so absolute resolution alone picks wrong lines (SD-3400).
    const anchor = this.#resolveNoteBlockAnchor(pos);
    const anchoredRect = anchor ? computeCaretRectFromPmPositionFromHelper(geometryOptions, pos, anchor) : null;
    if (anchoredRect) {
      return anchoredRect;
    }
    const pmRect = computeCaretRectFromPmPositionFromHelper(geometryOptions, pos);
    if (pmRect) {
      return pmRect;
    }

    // Position not painted yet (fresh paragraph) while a rerender is in
    // flight: bridging now would measure STALE paint and the wrong caret
    // would stick until the next selection change. Defer to the post-paint
    // flush instead (SD-3400).
    if (this.#renderScheduled || this.#isRerendering || this.#pendingDocChange) {
      this.#scheduleSelectionUpdate({ immediate: false });
      return null;
    }

    const textOffset = this.#measureActiveEditorVisibleTextOffset(pos);
    if (textOffset == null) {
      return null;
    }

    const renderedTextOffset = this.#toRenderedNoteVisibleTextOffset(noteFragments, textOffset);

    return computeCaretRectFromVisibleTextOffsetFromHelper(geometryOptions, renderedTextOffset);
  }

  #computeNoteCaretRect(pos: number): LayoutRect | null {
    const context = this.#buildActiveNoteLayoutContext();
    const layout = this.#layoutState.layout;
    if (!context || !layout) {
      return null;
    }

    const domRect = this.#computeNoteDomCaretRect(context, pos);
    if (domRect) {
      return domRect;
    }

    const geometry = computeCaretLayoutRectGeometryFromHelper(
      {
        layout,
        blocks: context.blocks,
        measures: context.measures,
        painterHost: this.#painterHost,
        viewportHost: this.#viewportHost,
        visibleHost: this.#visibleHost,
        zoom: this.#layoutOptions.zoom ?? 1,
      },
      pos,
      false,
    );
    if (!geometry) {
      return null;
    }

    const pageStride = this.#getBodyPageHeight() + (layout.pageGap ?? 0);
    return {
      pageIndex: geometry.pageIndex,
      x: geometry.x,
      y: geometry.pageIndex * pageStride + geometry.y,
      width: 1,
      height: geometry.height,
    };
  }

  #syncTrackedChangesPreferences(): boolean {
    const mode = this.#deriveTrackedChangesMode();
    const enabled = this.#deriveTrackedChangesEnabled();
    const hasChanged = mode !== this.#trackedChangesMode || enabled !== this.#trackedChangesEnabled;
    if (hasChanged) {
      this.#trackedChangesMode = mode;
      this.#trackedChangesEnabled = enabled;
    }
    return hasChanged;
  }

  #syncHeaderFooterTrackedChangesRenderConfig(): void {
    this.#headerFooterSession?.setTrackedChangesRenderConfig({
      mode: this.#trackedChangesMode,
      enabled: this.#trackedChangesEnabled,
    });
  }

  #deriveTrackedChangesMode(): TrackedChangesMode {
    const overrideMode = this.#trackedChangesOverrides?.mode;
    if (overrideMode) {
      return overrideMode;
    }
    const pluginState = this.#getTrackChangesPluginState();
    if (pluginState?.onlyOriginalShown) {
      return 'original';
    }
    if (pluginState?.onlyModifiedShown) {
      return 'final';
    }
    if (this.#documentMode === 'viewing') {
      return 'final';
    }
    return 'review';
  }

  #deriveTrackedChangesEnabled(): boolean {
    if (typeof this.#trackedChangesOverrides?.enabled === 'boolean') {
      return this.#trackedChangesOverrides.enabled;
    }
    return true;
  }

  #getTrackChangesPluginState(): {
    isTrackChangesActive?: boolean;
    onlyOriginalShown?: boolean;
    onlyModifiedShown?: boolean;
  } | null {
    const state = this.#editor?.state;
    if (!state) return null;
    try {
      const pluginState = TrackChangesBasePluginKey.getState(state);
      return pluginState ?? null;
    } catch (error) {
      // Plugin may not be loaded or state may be invalid
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to get track changes plugin state:', error);
      }
      return null;
    }
  }

  #computeDefaultLayoutDefaults(): {
    pageSize: PageSize;
    margins: PageMargins;
    columns?: ColumnLayout;
  } {
    const converter = this.#editor?.converter;
    const pageStyles = converter?.pageStyles ?? {};
    const size = pageStyles.pageSize ?? {};
    const pageMargins = pageStyles.pageMargins ?? {};

    const pageSize: PageSize = {
      w: inchesToPx(size.width) ?? DEFAULT_PAGE_SIZE.w,
      h: inchesToPx(size.height) ?? DEFAULT_PAGE_SIZE.h,
    };

    const margins: PageMargins = {
      top: inchesToPx(pageMargins.top) ?? DEFAULT_MARGINS.top,
      right: inchesToPx(pageMargins.right) ?? DEFAULT_MARGINS.right,
      bottom: inchesToPx(pageMargins.bottom) ?? DEFAULT_MARGINS.bottom,
      left: inchesToPx(pageMargins.left) ?? DEFAULT_MARGINS.left,
      ...(inchesToPx(pageMargins.header) != null ? { header: inchesToPx(pageMargins.header) } : {}),
      ...(inchesToPx(pageMargins.footer) != null ? { footer: inchesToPx(pageMargins.footer) } : {}),
    };

    const columns = parseColumns(pageStyles.columns);
    return { pageSize, margins, columns };
  }

  /**
   * Applies zoom transformation to the document viewport and painter hosts.
   *
   * Handles documents with varying page sizes (multi-section docs with landscape pages)
   * by calculating actual dimensions from per-page sizes rather than assuming uniform pages.
   *
   * The implementation uses two key concepts:
   * - **maxWidth/maxHeight**: Maximum dimension across all pages (for viewport sizing)
   * - **totalWidth/totalHeight**: Sum of all page dimensions + gaps (for full document extent)
   *
   * Layout modes:
   * - Vertical: Uses maxWidth for viewport width, totalHeight for scroll height
   * - Horizontal: Uses totalWidth for viewport width, maxHeight for scroll height
   */
  #applyZoom() {
    if (this.#isSemanticFlowMode()) {
      const zoom = this.#layoutOptions.zoom ?? 1;

      // Semantic mode: fluid widths with optional zoom scaling.
      this.#viewportHost.style.minWidth = '';
      this.#viewportHost.style.minHeight = '';

      if (zoom === 1) {
        this.#viewportHost.style.width = '100%';
        this.#viewportHost.style.transform = '';

        this.#painterHost.style.width = '100%';
        this.#painterHost.style.minHeight = '';
        this.#painterHost.style.transformOrigin = '';
        this.#painterHost.style.transform = '';

        this.#selectionOverlay.style.width = '100%';
        this.#selectionOverlay.style.height = '100%';
        this.#selectionOverlay.style.transformOrigin = '';
        this.#selectionOverlay.style.transform = '';
      } else {
        // Scale content while keeping fluid layout: set unscaled width to
        // container/zoom so the reflowed content visually fills the container
        // after the CSS transform enlarges it.
        this.#viewportHost.style.width = `${100 / zoom}%`;
        this.#viewportHost.style.transform = '';

        this.#painterHost.style.width = '100%';
        this.#painterHost.style.minHeight = '';
        this.#painterHost.style.transformOrigin = 'top left';
        this.#painterHost.style.transform = `scale(${zoom})`;

        this.#selectionOverlay.style.width = '100%';
        this.#selectionOverlay.style.height = '100%';
        this.#selectionOverlay.style.transformOrigin = 'top left';
        this.#selectionOverlay.style.transform = `scale(${zoom})`;
      }
      return;
    }

    // Apply zoom by scaling the children (#painterHost and #selectionOverlay) and
    // setting the viewport dimensions to the scaled size.
    //
    // CSS transform: scale() only affects visual rendering, NOT layout box dimensions.
    // Previously, transform was applied to #viewportHost which caused the parent scroll
    // container to not see the scaled size, resulting in clipping at high zoom levels.
    //
    // The new approach:
    // 1. Apply transform: scale(zoom) to #painterHost and #selectionOverlay (visual scaling)
    // 2. Set #viewportHost width/height to scaled dimensions (layout box scaling)
    // This ensures both visual rendering AND scroll container dimensions are correct.
    const zoom = this.#layoutOptions.zoom ?? 1;

    const layoutMode = this.#layoutOptions.layoutMode ?? 'vertical';

    // Calculate actual document dimensions from per-page sizes.
    // Multi-section documents can have pages with different sizes (e.g., landscape pages).
    const pages = this.#layoutState.layout?.pages;
    // Always use current layout mode's gap - layout.pageGap may be stale if layoutMode changed
    const pageGap = this.#getEffectivePageGap();
    const defaultWidth = this.#layoutOptions.pageSize?.w ?? DEFAULT_PAGE_SIZE.w;
    const defaultHeight = this.#layoutOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h;

    let maxWidth = defaultWidth;
    let maxHeight = defaultHeight;
    let totalWidth = 0;
    let totalHeight = 0;

    if (Array.isArray(pages) && pages.length > 0) {
      pages.forEach((page, index) => {
        const pageWidth = page.size && typeof page.size.w === 'number' && page.size.w > 0 ? page.size.w : defaultWidth;
        const pageHeight =
          page.size && typeof page.size.h === 'number' && page.size.h > 0 ? page.size.h : defaultHeight;
        maxWidth = Math.max(maxWidth, pageWidth);
        maxHeight = Math.max(maxHeight, pageHeight);
        totalWidth += pageWidth;
        totalHeight += pageHeight;
        if (index < pages.length - 1) {
          totalWidth += pageGap;
          totalHeight += pageGap;
        }
      });
    } else {
      totalWidth = defaultWidth;
      totalHeight = defaultHeight;
    }

    // Horizontal layout stacks pages in a single row, so width grows with pageCount
    if (layoutMode === 'horizontal') {
      // For horizontal: sum widths, use max height
      const scaledWidth = totalWidth * zoom;
      const scaledHeight = maxHeight * zoom;

      this.#viewportHost.style.width = `${scaledWidth}px`;
      this.#viewportHost.style.minWidth = `${scaledWidth}px`;
      this.#viewportHost.style.minHeight = `${scaledHeight}px`;
      this.#viewportHost.style.height = '';
      this.#viewportHost.style.overflow = '';
      this.#viewportHost.style.transform = '';

      this.#painterHost.style.width = `${totalWidth}px`;
      this.#painterHost.style.minHeight = `${maxHeight}px`;
      // Negative margin compensates for the CSS box overflow from transform: scale().
      // At zoom < 1 the unscaled CSS box is larger than the visual; this pulls the
      // bottom edge up to match, without clipping overlays (e.g., cursor labels).
      this.#painterHost.style.marginBottom = zoom !== 1 ? `${maxHeight * zoom - maxHeight}px` : '';
      this.#painterHost.style.transformOrigin = 'top left';
      this.#painterHost.style.transform = zoom === 1 ? '' : `scale(${zoom})`;

      this.#selectionOverlay.style.width = `${totalWidth}px`;
      this.#selectionOverlay.style.height = `${maxHeight}px`;
      this.#selectionOverlay.style.transformOrigin = 'top left';
      this.#selectionOverlay.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
      return;
    }

    // Vertical layout: use max width, sum heights
    // Zoom implementation:
    // 1. #viewportHost has SCALED dimensions (maxWidth * zoom) for proper scroll container sizing
    // 2. #painterHost has UNSCALED dimensions with transform: scale(zoom) applied
    // 3. When scaled, #painterHost visually fills #viewportHost exactly
    //
    // This ensures the scroll container sees the correct scaled content size while
    // the transform provides visual scaling.
    //
    // CSS transform: scale() does NOT change the element's CSS box dimensions.
    // At zoom < 1, painterHost's CSS box stays at the full unscaled height while its
    // visual size is smaller. A negative margin-bottom on painterHost compensates for
    // the difference, so the scroll container sees the correct scaled size without
    // clipping overlays (e.g., collaboration cursor labels that extend above their caret).
    const scaledWidth = maxWidth * zoom;
    const scaledHeight = totalHeight * zoom;

    this.#viewportHost.style.width = `${scaledWidth}px`;
    this.#viewportHost.style.minWidth = `${scaledWidth}px`;
    this.#viewportHost.style.minHeight = `${scaledHeight}px`;
    this.#viewportHost.style.height = '';
    this.#viewportHost.style.overflow = '';
    this.#viewportHost.style.transform = '';

    // Set painterHost to UNSCALED dimensions and apply transform.
    // Negative margin compensates for the CSS box overflow from transform: scale().
    // At zoom < 1: totalHeight=74304 with scale(0.75) → visual 55728px but CSS box stays 74304px.
    // marginBottom = totalHeight * zoom - totalHeight = 74304 * 0.75 - 74304 = -18576px
    // This shrinks the layout contribution to match the visual size.
    this.#painterHost.style.width = `${maxWidth}px`;
    this.#painterHost.style.minHeight = `${totalHeight}px`;
    this.#painterHost.style.marginBottom = zoom !== 1 ? `${totalHeight * zoom - totalHeight}px` : '';
    this.#painterHost.style.transformOrigin = 'top left';
    this.#painterHost.style.transform = zoom === 1 ? '' : `scale(${zoom})`;

    // Selection overlay also scales - set to unscaled dimensions
    this.#selectionOverlay.style.width = `${maxWidth}px`;
    this.#selectionOverlay.style.height = `${totalHeight}px`;
    this.#selectionOverlay.style.transformOrigin = 'top left';
    this.#selectionOverlay.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
  }

  /**
   * Convert page-local coordinates to overlay-space coordinates.
   *
   * Transforms coordinates from page-local space (x, y relative to a specific page)
   * to overlay-space coordinates (absolute position within the stacked page layout).
   * The returned coordinates are in layout space (unscaled logical pixels), not screen
   * space - the CSS transform: scale() on #painterHost and #selectionOverlay handles zoom scaling.
   *
   * Pages are rendered vertically stacked at y = pageIndex * pageHeight, so the
   * conversion involves:
   * 1. X coordinate passes through unchanged (pages are horizontally aligned)
   * 2. Y coordinate is offset by (pageIndex * pageHeight) to account for stacking
   *
   * @param pageIndex - Zero-based page index (must be finite and non-negative)
   * @param pageLocalX - X coordinate relative to page origin (must be finite)
   * @param pageLocalY - Y coordinate relative to page origin (must be finite)
   * @returns Overlay coordinates {x, y} in layout space, or null if inputs are invalid
   *
   * @example
   * ```typescript
   * // Position at (50, 100) on page 2
   * const coords = this.#convertPageLocalToOverlayCoords(2, 50, 100);
   * // Returns: { x: 50, y: 2 * 792 + 100 } = { x: 50, y: 1684 }
   * ```
   *
   * @private
   */

  #getPageOffsetX(pageIndex: number): number | null {
    return getPageOffsetXFromTransform({
      painterHost: this.#painterHost,
      viewportHost: this.#viewportHost,
      zoom: this.#layoutOptions.zoom ?? 1,
      pageIndex,
    });
  }

  #getPageOffsetY(pageIndex: number): number | null {
    return getPageOffsetYFromTransform({
      painterHost: this.#painterHost,
      viewportHost: this.#viewportHost,
      zoom: this.#layoutOptions.zoom ?? 1,
      pageIndex,
    });
  }

  #convertPageLocalToOverlayCoords(
    pageIndex: number,
    pageLocalX: number,
    pageLocalY: number,
  ): { x: number; y: number } | null {
    const pageHeight = this.#layoutOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h;
    const pageGap = this.#layoutState.layout?.pageGap ?? 0;
    return convertPageLocalToOverlayCoordsFromTransform({
      painterHost: this.#painterHost,
      viewportHost: this.#viewportHost,
      zoom: this.#layoutOptions.zoom ?? 1,
      pageIndex,
      pageLocalX,
      pageLocalY,
      pageHeight,
      pageGap,
    });
  }

  /**
   * Computes DOM-derived selection rects for mounted pages using Range.getClientRects().
   *
   * This is the pixel-perfect path: it uses the browser's layout engine as the
   * source of truth for selection geometry when content is mounted.
   *
   * Returns null on failure so callers can keep the last known-good overlay rather
   * than rendering a potentially incorrect geometry-based fallback.
   */
  #computeSelectionRectsFromDom(from: number, to: number): LayoutRect[] | null {
    const layout = this.#layoutState.layout;
    if (!layout) return null;

    return computeSelectionRectsFromDomFromDom(
      {
        painterHost: this.#painterHost,
        layout,
        domPositionIndex: this.#domPositionIndex,
        rebuildDomPositionIndex: () => this.#rebuildDomPositionIndex(),
        zoom: this.#layoutOptions.zoom ?? 1,
        pageHeight: this.#getBodyPageHeight(),
        pageGap: layout.pageGap ?? this.#getEffectivePageGap(),
      },
      from,
      to,
    );
  }

  #computeDomCaretPageLocal(pos: number): { pageIndex: number; x: number; y: number } | null {
    return computeDomCaretPageLocalFromDom(
      {
        painterHost: this.#painterHost,
        domPositionIndex: this.#domPositionIndex,
        rebuildDomPositionIndex: () => this.#rebuildDomPositionIndex(),
        zoom: this.#layoutOptions.zoom ?? 1,
      },
      pos,
    );
  }

  #normalizeClientPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number; pageIndex?: number; pageLocalY?: number } | null {
    return normalizeClientPointFromPointer(
      {
        viewportHost: this.#viewportHost,
        visibleHost: this.#visibleHost,
        zoom: this.#layoutOptions.zoom ?? 1,
        getPageOffsetX: (pageIndex) => this.#getPageOffsetX(pageIndex),
        getPageOffsetY: (pageIndex) => this.#getPageOffsetY(pageIndex),
      },
      clientX,
      clientY,
    );
  }

  denormalizeClientPoint(
    layoutX: number,
    layoutY: number,
    pageIndex?: number,
    height?: number,
  ): { x: number; y: number; height?: number } | null {
    return denormalizeClientPointFromPointer(
      {
        viewportHost: this.#viewportHost,
        visibleHost: this.#visibleHost,
        zoom: this.#layoutOptions.zoom ?? 1,
        getPageOffsetX: (pageIndex) => this.#getPageOffsetX(pageIndex),
        getPageOffsetY: (pageIndex) => this.#getPageOffsetY(pageIndex),
      },
      layoutX,
      layoutY,
      pageIndex,
      height,
    );
  }

  /**
   * Computes caret layout rectangle using geometry-based calculations.
   *
   * This method calculates the caret position and height from layout engine data
   * (fragments, blocks, measures) without querying the DOM. It's used as a fallback
   * when DOM-based measurements are unavailable or as a primary source in non-interactive
   * scenarios (e.g., headless rendering, PDF export).
   *
   * The geometry-based calculation accounts for:
   * - List markers (offset caret by marker width)
   * - Paragraph indents (left, right, first-line, hanging)
   * - Justified text alignment (extra space distributed across spaces)
   * - Multi-column layouts
   * - Table cell content
   *
   * Algorithm:
   * 1. Find the fragment containing the PM position
   * 2. Handle table fragments separately (delegate to #computeTableCaretLayoutRect)
   * 3. For paragraph fragments:
   *    a. Find the line containing the position
   *    b. Convert PM position to character offset
   *    c. Measure X coordinate using Canvas-based text measurement
   *    d. Apply marker width and indent adjustments
   *    e. Calculate Y offset from line heights
   *    f. Return page-local coordinates with line height
   *
   * @param pos - ProseMirror position to compute caret for
   * @param includeDomFallback - Whether to compare with DOM measurements for debugging (default: true).
   *   When true, logs geometry vs DOM deltas for analysis. Has no effect on return value.
   * @returns Object with {pageIndex, x, y, height} in page-local coordinates, or null if position not found
   *
   * @example
   * ```typescript
   * const caretGeometry = this.#computeCaretLayoutRectGeometry(42, false);
   * if (caretGeometry) {
   *   // Render caret at caretGeometry.x, caretGeometry.y with height caretGeometry.height
   * }
   * ```
   */
  #computeCaretLayoutRectGeometry(
    pos: number,
    includeDomFallback = true,
  ): { pageIndex: number; x: number; y: number; height: number } | null {
    return computeCaretLayoutRectGeometryFromHelper(
      {
        layout: this.#layoutState.layout,
        blocks: this.#layoutState.blocks,
        measures: this.#layoutState.measures,
        painterHost: this.#painterHost,
        viewportHost: this.#viewportHost,
        visibleHost: this.#visibleHost,
        zoom: this.#layoutOptions.zoom ?? 1,
      },
      pos,
      includeDomFallback,
    );
  }

  /**
   * Compute caret position, preferring DOM when available, falling back to geometry.
   *
   * SD-3170: the native-selection refinement inside computeCaretLayoutRectGeometry
   * reads the browser's collapsed selection rect and prefers it over geometry.
   * That's only sound when the requested `pos` is the local user's actual caret.
   * Arbitrary-position queries (remote collaborator cursors, vertical-arrow
   * navigation binary search) must not get the local rect substituted in.
   */
  #computeCaretLayoutRect(pos: number): { pageIndex: number; x: number; y: number; height: number } | null {
    const useNativeFallback = shouldUseNativeCaretFallback(this.editor?.state?.selection, pos);
    const geometry = this.#computeCaretLayoutRectGeometry(pos, useNativeFallback);
    let dom: { pageIndex: number; x: number; y: number } | null = null;
    try {
      dom = this.#computeDomCaretPageLocal(pos);
    } catch (error) {
      // DOM operations can throw exceptions - fall back to geometry-only positioning
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] DOM caret computation failed in #computeCaretLayoutRect:', error);
      }
    }
    if (dom && geometry) {
      return {
        pageIndex: dom.pageIndex,
        x: dom.x,
        y: dom.y,
        height: geometry.height,
      };
    }
    return geometry;
  }

  computeCaretLayoutRect(pos: number): { pageIndex: number; x: number; y: number; height: number } | null {
    return this.#computeCaretLayoutRect(pos);
  }

  #getCurrentPageIndex(): number {
    const session = this.#headerFooterSession?.session;
    if (session && session.mode !== 'body') {
      return session.pageIndex ?? 0;
    }
    if (this.#getActiveNoteStorySession()) {
      const selection = this.getActiveEditor().state?.selection;
      if (!selection) {
        return this.#buildActiveNoteLayoutContext()?.firstPageIndex ?? 0;
      }
      const rects = this.#computeNoteSelectionRects(selection.from, selection.to) ?? [];
      if (rects.length > 0) {
        return rects[0]?.pageIndex ?? 0;
      }
      return (
        this.#computeNoteCaretRect(selection.from)?.pageIndex ??
        this.#buildActiveNoteLayoutContext()?.firstPageIndex ??
        0
      );
    }
    const layout = this.#layoutState.layout;
    const selection = this.#editor.state?.selection;
    if (!layout || !selection) {
      return 0;
    }

    // Try selectionToRects first
    const rects =
      selectionToRects(
        layout,
        this.#layoutState.blocks,
        this.#layoutState.measures,
        selection.from,
        selection.to,
        this.#pageGeometryHelper ?? undefined,
      ) ?? [];

    if (rects.length > 0) {
      return rects[0]?.pageIndex ?? 0;
    }

    // Fallback: scan pages to find which one contains this position via fragments
    // Note: pmStart/pmEnd are only present on some fragment types (ParaFragment, ImageFragment, DrawingFragment)
    const pos = selection.from;
    for (let pageIdx = 0; pageIdx < layout.pages.length; pageIdx++) {
      const page = layout.pages[pageIdx];
      for (const fragment of page.fragments) {
        const frag = fragment as { pmStart?: number; pmEnd?: number };
        if (frag.pmStart != null && frag.pmEnd != null) {
          if (pos >= frag.pmStart && pos <= frag.pmEnd) {
            return pageIdx;
          }
        }
      }
    }

    return 0;
  }

  #findRegionForPage(kind: 'header' | 'footer', pageIndex: number): HeaderFooterRegion | null {
    return this.#headerFooterSession?.findRegionForPage(kind, pageIndex) ?? null;
  }

  #handleLayoutError(phase: LayoutError['phase'], error: Error) {
    console.error('[PresentationEditor] Layout error', error);
    this.#layoutError = { phase, error, timestamp: Date.now() };
    // SD-3432: a failed render leaves no trustworthy footnote fixed point.
    this.#footnoteReserveSeed = null;

    // Update error state based on phase
    if (phase === 'initialization') {
      this.#layoutErrorState = 'failed'; // Fatal error during init
    } else {
      // Render errors may be recoverable
      this.#layoutErrorState = this.#layoutState.layout ? 'degraded' : 'failed';
    }

    this.emit('layoutError', this.#layoutError);
    this.#showLayoutErrorBanner(error);
  }

  #decorateError(error: unknown, stage: string): Error {
    if (error instanceof Error) {
      error.message = `[${stage}] ${error.message}`;
      return error;
    }
    return new Error(`[${stage}] ${String(error)}`);
  }

  #showLayoutErrorBanner(error: Error) {
    const doc = this.#visibleHost.ownerDocument ?? document;
    if (!this.#errorBanner) {
      const banner = doc.createElement('div');
      banner.className = 'presentation-editor__layout-error';
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.justifyContent = 'space-between';
      banner.style.gap = '8px';
      banner.style.padding = '8px 12px';
      banner.style.background = '#FFF6E5';
      banner.style.border = '1px solid #F5B971';
      banner.style.borderRadius = '6px';
      banner.style.marginBottom = '8px';

      const message = doc.createElement('span');
      banner.appendChild(message);

      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Reload layout';
      retry.style.border = 'none';
      retry.style.borderRadius = '4px';
      retry.style.background = '#F5B971';
      retry.style.color = '#3F2D00';
      retry.style.padding = '6px 10px';
      retry.style.cursor = 'pointer';
      retry.addEventListener('click', () => {
        this.#layoutError = null;
        this.#dismissErrorBanner();
        this.#pendingDocChange = true;
        this.#scheduleRerender();
      });

      banner.appendChild(retry);
      this.#visibleHost.prepend(banner);

      this.#errorBanner = banner;
      this.#errorBannerMessage = message;
    }

    if (this.#errorBannerMessage) {
      this.#errorBannerMessage.textContent =
        'Layout engine hit an error. Your document is safe — try reloading layout.';
      if (this.#layoutOptions.debugLabel) {
        this.#errorBannerMessage.textContent += ` (${this.#layoutOptions.debugLabel}: ${error.message})`;
      }
    }
  }

  /**
   * Updates the selection overlay while editing headers/footers.
   *
   * Uses header/footer layout data from HeaderFooterSessionManager to compute
   * selection rectangles in layout space, then renders them into the shared
   * selection overlay so selection behaves consistently with body content.
   *
   * In hidden-host mode this also renders the caret from the active story
   * editor's hidden DOM geometry.
   */
  #updateHeaderFooterSelection(shouldScrollIntoView = false) {
    this.#clearSelectedFieldAnnotationClass();

    if (!this.#localSelectionLayer) {
      return;
    }

    const activeEditor = this.getActiveEditor();
    const selection = activeEditor?.state?.selection;
    if (!selection) {
      try {
        this.#localSelectionLayer.innerHTML = '';
      } catch {}
      return;
    }

    const { from, to } = selection;

    if (from === to) {
      const caretRect = this.#computeHeaderFooterCaretRect(from);
      if (!caretRect) {
        try {
          this.#localSelectionLayer.innerHTML = '';
        } catch {}
        return;
      }

      try {
        this.#localSelectionLayer.innerHTML = '';
        renderCaretOverlay({
          localSelectionLayer: this.#localSelectionLayer,
          caretLayout: {
            pageIndex: caretRect.pageIndex,
            x: caretRect.x,
            y: caretRect.y - caretRect.pageIndex * this.#getBodyPageHeight(),
            height: caretRect.height,
          },
          convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
        });
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to render header/footer caret:', error);
        }
      }
      if (shouldScrollIntoView) {
        this.#scrollActiveEndIntoView(caretRect.pageIndex);
      }
      return;
    }

    const rects = this.#computeHeaderFooterSelectionRects(from, to);
    if (!rects.length) {
      return;
    }

    // Header/footer selection rects are already mapped into body-page
    // coordinates using the body page height and no page gap. To avoid
    // double-applying any gap or using the header/footer layout height, use
    // the body page height here and a zero page gap.
    const pageHeight = this.#getBodyPageHeight();
    const pageGap = 0;

    try {
      this.#localSelectionLayer.innerHTML = '';
      renderSelectionRects({
        localSelectionLayer: this.#localSelectionLayer,
        rects,
        pageHeight,
        pageGap,
        convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to render header/footer selection rects:', error);
      }
    }

    if (shouldScrollIntoView) {
      const selectionHead = activeEditor?.state?.selection?.head ?? to;
      const headCaretRect = this.#computeHeaderFooterCaretRect(selectionHead);
      const headPageIndex = headCaretRect?.pageIndex ?? rects.at(-1)?.pageIndex ?? rects[0]?.pageIndex;
      if (Number.isFinite(headPageIndex)) {
        this.#scrollActiveEndIntoView(headPageIndex!);
      }
    }
  }

  #updateNoteSelection(shouldScrollIntoView = false) {
    this.#clearSelectedFieldAnnotationClass();

    if (!this.#localSelectionLayer) {
      return;
    }

    const activeEditor = this.getActiveEditor();
    const selection = activeEditor?.state?.selection;
    if (!selection) {
      try {
        this.#localSelectionLayer.innerHTML = '';
      } catch {}
      return;
    }

    const { from, to } = selection;

    if (from === to) {
      const caretRect = this.#computeNoteCaretRect(from);
      if (!caretRect) {
        return;
      }

      try {
        this.#localSelectionLayer.innerHTML = '';
        renderCaretOverlay({
          localSelectionLayer: this.#localSelectionLayer,
          caretLayout: {
            pageIndex: caretRect.pageIndex,
            x: caretRect.x,
            y:
              caretRect.y -
              caretRect.pageIndex * (this.#getBodyPageHeight() + (this.#layoutState.layout?.pageGap ?? 0)),
            height: caretRect.height,
          },
          convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
        });
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to render note caret:', error);
        }
      }
      if (shouldScrollIntoView) {
        this.#scrollActiveEndIntoView(caretRect.pageIndex);
      }
      return;
    }

    const rects = this.#computeNoteSelectionRects(from, to);
    if (rects == null || !rects.length) {
      return;
    }

    try {
      this.#localSelectionLayer.innerHTML = '';
      renderSelectionRects({
        localSelectionLayer: this.#localSelectionLayer,
        rects,
        pageHeight: this.#getBodyPageHeight(),
        pageGap: this.#layoutState.layout?.pageGap ?? 0,
        convertPageLocalToOverlayCoords: (pageIndex, x, y) => this.#convertPageLocalToOverlayCoords(pageIndex, x, y),
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to render note selection rects:', error);
      }
    }

    if (shouldScrollIntoView) {
      const selectionHead = activeEditor?.state?.selection?.head ?? to;
      const headCaretRect = this.#computeNoteCaretRect(selectionHead);
      const headPageIndex = headCaretRect?.pageIndex ?? rects.at(-1)?.pageIndex ?? rects[0]?.pageIndex;
      if (Number.isFinite(headPageIndex)) {
        this.#scrollActiveEndIntoView(headPageIndex!);
      }
    }
  }

  #dismissErrorBanner() {
    this.#errorBanner?.remove();
    this.#errorBanner = null;
    this.#errorBannerMessage = null;
  }

  /**
   * Determines whether the current viewing mode should block edits.
   * When documentMode is viewing but the active editor has been toggled
   * back to editable (e.g. permission ranges), we treat the view as editable.
   *
   * Note: This method controls input blocking. For selection visuals,
   * check allowSelectionInViewMode separately.
   */
  #isViewLocked(): boolean {
    // Check if read-only protection is runtime-enforced (protection wins over documentMode)
    const protectionStorage = (this.#editor as Editor & { storage?: Record<string, any> })?.storage?.protection;
    const protectionEnforced =
      protectionStorage?.initialized === true && protectionStorage?.state?.editingRestriction?.runtimeEnforced === true;

    if (protectionEnforced) {
      // When protection is enforced, lock unless permission ranges allow editing
      const hasPermissionOverride = !!(this.#editor as Editor & { storage?: Record<string, any> })?.storage
        ?.permissionRanges?.hasAllowedRanges;
      return !hasPermissionOverride;
    }

    // Fall back to documentMode check for non-protected documents
    if (this.#documentMode !== 'viewing') return false;
    const hasPermissionOverride = !!(this.#editor as Editor & { storage?: Record<string, any> })?.storage
      ?.permissionRanges?.hasAllowedRanges;
    if (hasPermissionOverride) return false;
    return this.#documentMode === 'viewing';
  }
}

function escapeAttrValue(value: string): string {
  const cssApi =
    typeof globalThis === 'object' && globalThis && 'CSS' in globalThis
      ? (globalThis.CSS as { escape?: (input: string) => string } | undefined)
      : undefined;

  if (typeof cssApi?.escape === 'function') {
    return cssApi.escape(value);
  }

  return value.replace(/["\\]/g, (char) => `\\${char}`);
}

function resolveStoryKeyFromAddress(story: StoryLocator | unknown): string | undefined {
  if (!isStoryLocator(story)) {
    return undefined;
  }

  try {
    return buildStoryKey(story);
  } catch {
    return undefined;
  }
}
