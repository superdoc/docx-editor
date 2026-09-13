import { DomPainter } from './renderer.js';
import type { PaintWorkSummary } from './page-content.js';
import type { PageStyles } from './styles.js';
import type { PaintKind, PositionValidationOptions, PositionValidationSummary } from './pm-position-validation.js';
import type { DomPainterInput, PageDecorationProvider, PaintSnapshot, PositionMapping, FlowMode } from './renderer.js';
import type { DomPainterPersistentPageInput } from './persistent-page-surface.js';

export { createWebFlowPainter, ensureWebFlowStyles, WEB_FLOW_CLASS_NAMES } from './web-flow/index.js';
export type {
  WebFlowAppliedPaint,
  WebFlowDomBinding,
  WebFlowPaintCommand,
  WebFlowPaintItem,
  WebFlowPaintSnapshot,
  WebFlowPaintTransaction,
  WebFlowPainterHandle,
  WebFlowPainterOptions,
  WebFlowPaintWorkSummary,
  WebFlowStableDomKey,
} from './web-flow/index.js';

// Re-export constants
export { DOM_CLASS_NAMES } from './constants.js';
export type { DomClassName } from './constants.js';

// Re-export the document-surface CSS injector so hosts can
// pre-stamp the page color/foreground isolation reset at mount time, before
// the first paint runs. The painter still calls this on every paint, but
// pre-injection guarantees the reset is present even if a host renders a
// custom shell before the first paint completes.
export { ensureDocumentSurfaceStyles } from './styles.js';

// The document-scoped style preflight contract shared by BOTH paint entries
// (persistent-page rendering preflight plan). Exported so parity oracles —
// painter unit tests and the performance pipeline's head-preflight check —
// assert against the ONE manifest instead of hand-copied marker lists.
export { SURFACE_STYLE_PREFLIGHT, ensureSurfaceStylePreflight } from './styles.js';
export type { SurfaceStylePreflightEntry } from './styles.js';

// Re-export ruler utilities
export {
  generateRulerDefinition,
  generateRulerDefinitionFromPx,
  createRulerElement,
  ensureRulerStyles,
  clampHandlePosition,
  calculateMarginFromHandle,
  RULER_CLASS_NAMES,
} from './ruler/index.js';
export type {
  RulerDefinition,
  RulerConfig,
  RulerConfigPx,
  RulerTick,
  CreateRulerElementOptions,
} from './ruler/index.js';
export type {
  PaintSnapshot,
  PaintSnapshotAnnotationEntity,
  PaintSnapshotStructuredContentBlockEntity,
  PaintSnapshotStructuredContentInlineEntity,
  PaintSnapshotImageEntity,
  PaintSnapshotEntities,
} from './renderer.js';
export type { DomPainterInput, PositionMapping } from './renderer.js';
// The persistent paginated reconcile contract (default persistent page
// geometry plan, Unit 1): generation-scoped scaffold + bounded content window.
export type {
  DomPainterPersistentPacketSource,
  DomPainterPersistentPageInput,
  DomPainterPersistentScaffold,
  DomPainterPersistentScaffoldPage,
} from './persistent-page-surface.js';
export type { DerivedRunTextPlane } from './derived-run-text-plane.js';
// Painter plan §4.6: dark observability for the persistent-page paint path.
export type { PaintWorkSummary } from './page-content.js';
export type { RenderedLineInfo } from './runs/index.js';

// Re-export utility functions for testing
export { sanitizeUrl, linkMetrics, applyRunDataAttributes } from './runs/index.js';

export { applySquareWrapExclusionsToLines } from './utils/anchor-helpers';
export { buildImagePmSelector, buildInlineImagePmSelector } from './images/image-selectors.js';

// Story-aware, content-free position-coverage validation (painter-scoped).
export { createPositionValidationCollector, PositionValidationCollector } from './pm-position-validation.js';
export type {
  PaintCoordinateModel,
  RunCoordinateRequirement,
  PositionValidationConsolePolicy,
  PaintKind,
  PaintRealm,
  PositionValidationSection,
  PositionRunKind,
  PositionValidationCode,
  PositionValidationStructuralKey,
  PositionValidationGroupRow,
  PositionValidationRequirementTally,
  PositionValidationSummary,
  PositionValidationOptions,
  RunPositionObservation,
} from './pm-position-validation.js';

/**
 * Painter plan P7: `'vertical'` is the only paginated arrangement (horizontal
 * and book modes deleted, product decision 2026-07-05). The presentation axis
 * is `FlowMode` (`'paginated' | 'semantic'`); this type remains for API-shape
 * compatibility.
 */
export type LayoutMode = 'vertical';
export type { FlowMode } from './renderer.js';
export type { PageDecorationPayload, PageDecorationProvider } from './renderer.js';

export type DomPainterOptions = {
  pageStyles?: PageStyles;
  layoutMode?: LayoutMode;
  flowMode?: FlowMode;
  /** Gap between pages in pixels (default: 24px) */
  pageGap?: number;
  headerProvider?: PageDecorationProvider;
  footerProvider?: PageDecorationProvider;
  /** Called with the paint snapshot after each paint cycle completes. */
  onPaintSnapshot?: (snapshot: PaintSnapshot) => void;
  /** Render nonprinting formatting marks such as spaces, tabs, and paragraph marks. */
  showFormattingMarks?: boolean;
  /** Built-in SDT chrome rendering mode. */
  contentControlsChrome?: 'default' | 'none';
  /**
   * Per-document logical->physical font resolver (a CSS-stack resolver). The painter paints each
   * run in the family this returns - e.g. Carlito for Calibri - the SAME family measurement used,
   * so glyph advances match the laid-out positions. Set per painter instance (per document) so two
   * editors can map one logical family differently. Defaults to the global bundled resolver.
   */
  resolvePhysical?: (cssFontFamily: string, face: { weight: '400' | '700'; style: 'normal' | 'italic' }) => string;
  /**
   * Painter plan P5 §4.6: populate `PaintWorkSummary`'s per-page index arrays
   * (which pages mounted/unmounted/rebuilt/untouched/remapped). Dark by
   * default — counters stay O(1) always, but the arrays grow per paint and
   * are only drained by `consumePaintWorkSummary()`, which product code never
   * calls; the perf harness enables this for its repaint oracle.
   */
  paintWorkAttribution?: boolean;
  /**
   * Story-aware position-coverage validation. Dark by default: when omitted or
   * `{ enabled: false }`, the painter records nothing and `record()` is a single
   * branch with no allocation. The performance harness enables it (with an
   * explicit `off | summary | verbose` console policy — never `NODE_ENV`) and
   * drains it via `consumePositionValidationSummary()`. Each painter instance
   * owns its collector, so the live persistent surface and the fresh-state
   * persistent-page oracle never mix counts.
   */
  positionValidation?: PositionValidationOptions;
};

export type DomPainterHandle = {
  /** Semantic flow only (painter plan P7); paginated documents use the persistent reconcile. */
  paint(input: DomPainterInput, mount: HTMLElement, mapping?: PositionMapping): void;
  /**
   * The persistent paginated reconcile (default persistent page geometry
   * plan): a generation-scoped scaffold publishes every page root atomically
   * and keeps it mounted for the whole layout generation; only content
   * descendants are virtualized. Paginated flow only.
   */
  paintPersistentPages(input: DomPainterPersistentPageInput, mount: HTMLElement): void;
  /** Live integrity probe used to prevent zero-work skips over a corrupted shell plane. */
  isPersistentPageSurfaceIntact(): boolean;
  /** Wake-up callback for foreign page-root DOM corruption. */
  setPersistentSurfaceInvalidationHandler(handler?: () => void): void;
  /** Ascending hydrated content page indices of the persistent surface. */
  getHydratedContentPageIndices(): number[];
  /**
   * Painter plan §4.6 (dark observability): persistent-page paint work since the
   * last consume. Fields the path cannot attribute yet are 0/null, never
   * invented (`domNodesCreated` stays null until node counting lands). Since
   * P5, `pagesPositionRemapped` counts uniform in-place pm shifts on reused
   * window DOM; the per-page index arrays are populated only when the painter
   * was created with `paintWorkAttribution: true`.
   */
  consumePaintWorkSummary(): PaintWorkSummary;
  /**
   * Story-aware position coverage since the last consume, drained and reset.
   * Content-free and bounded; empty (`checked: 0`) unless the painter was
   * created with `positionValidation.enabled`.
   */
  consumePositionValidationSummary(): PositionValidationSummary;
  setProviders(header?: PageDecorationProvider, footer?: PageDecorationProvider): void;
  getPersistentPageIndices(): number[];
  setShowFormattingMarks(showFormattingMarks: boolean): void;
  dispose(): void;
};

// Private integration seam for the v2 routed host. Deliberately not exported:
// DomPainterHandle's public typed/runtime-enumerable contract stays unchanged.
const PERSISTENT_PAGE_PAINTER_TRANSACTION = Symbol.for('superdoc.painter-dom.persistent-page-transaction.v1');

/**
 * Thin pass-through factory: instantiates DomPainter with the supplied options
 * and returns a stable handle that exposes only the rendering-stage API.
 *
 * The handle accepts only `DomPainterInput` (resolvedLayout-only).
 * Header/footer decoration providers must supply both `fragments` and `items`
 * on their `PageDecorationPayload`.
 *
 * Mode ownership: `paint()` serves semantic flow and rejects paginated flow;
 * paginated documents and fresh-state oracles both use the one persistent
 * page reconcile.
 *
 * v1 EOL (product decision 2026-07-06, P7 review): the v1 PresentationEditor
 * consumed the deleted surface (paginated `paint()`, `virtualization`/`ruler`
 * options, `setZoom`/`setVirtualizationPins`) and gets NO compatibility shim —
 * SuperDoc is v2-only. The staged super-editor dist is the last working v1
 * print build; rebuilding it against this painter fails BY DESIGN, and the
 * `mode-ownership.test.ts` battery pins the surface deleted.
 */
export const createDomPainter = (options: DomPainterOptions): DomPainterHandle => {
  const paintKind: PaintKind = (options.flowMode ?? 'paginated') === 'semantic' ? 'semantic' : 'persistent-page';
  return buildDomPainterHandle(new DomPainter(withPaintKindDefault(options, paintKind)));
};

/**
 * Default the validation `paintKind` per factory (only when validation is
 * enabled) so the live persistent surface and fresh-state oracle land in
 * separately labelled collectors. A caller-supplied `paintKind` still wins. No
 * effect when `positionValidation` is absent.
 */
const withPaintKindDefault = (options: DomPainterOptions, paintKind: PaintKind): DomPainterOptions =>
  options.positionValidation
    ? { ...options, positionValidation: { paintKind, ...options.positionValidation } }
    : options;

/**
 * The only handle body. Flow rejection is owned by `DomPainter`, so callers
 * cannot bypass it through another factory or wrapper.
 */
function buildDomPainterHandle(painter: DomPainter): DomPainterHandle {
  const handle: DomPainterHandle = {
    paint(input: DomPainterInput, mount: HTMLElement, mapping?: PositionMapping) {
      painter.paint(input, mount, mapping);
    },
    paintPersistentPages(input: DomPainterPersistentPageInput, mount: HTMLElement) {
      painter.paintPersistentPages(input, mount);
    },
    isPersistentPageSurfaceIntact() {
      return painter.isPersistentPageSurfaceIntact();
    },
    setPersistentSurfaceInvalidationHandler(handler) {
      painter.setPersistentSurfaceInvalidationHandler(handler);
    },
    getHydratedContentPageIndices() {
      return painter.getHydratedContentPageIndices();
    },
    consumePaintWorkSummary() {
      return painter.consumePaintWorkSummary();
    },
    consumePositionValidationSummary() {
      return painter.consumePositionValidationSummary();
    },
    setProviders(header?: PageDecorationProvider, footer?: PageDecorationProvider) {
      painter.setProviders(header, footer);
    },
    getPersistentPageIndices() {
      return painter.getPersistentPageIndices();
    },
    setShowFormattingMarks(showFormattingMarks: boolean) {
      painter.setShowFormattingMarks(showFormattingMarks);
    },
    dispose() {
      painter.dispose();
    },
  };
  Object.defineProperty(handle, PERSISTENT_PAGE_PAINTER_TRANSACTION, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => painter.beginPersistentPageTransaction(),
  });
  return handle;
}
