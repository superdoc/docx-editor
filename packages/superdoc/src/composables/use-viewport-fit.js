import { onBeforeUnmount, nextTick, watch } from 'vue';
import { DOCX, PDF } from '@superdoc/common';
import { PDF_TO_CSS_UNITS } from '@superdoc/core/pdf/helpers/constants.js';

const CSS_PX_PER_INCH = 96;
const SIDEBAR_SELECTOR = '.superdoc__right-sidebar';
const PDF_PAGE_SELECTOR = '.sd-pdf-viewer-page';

export const FIT_WIDTH_DEFAULTS = Object.freeze({
  min: 10,
  max: 100,
  padding: 0,
});

// Normalize `config.zoom.fitWidth` into a complete options object. The mode
// (`config.zoom.mode` / `setZoomMode`) decides whether the policy applies;
// these are only its bounds. Invalid field values fall back to defaults;
// min/max are reordered if swapped.
export const resolveFitWidthOptions = (rawFitConfig) => {
  const raw = rawFitConfig && typeof rawFitConfig === 'object' ? rawFitConfig : {};
  const positiveOr = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  const min = positiveOr(raw.min, FIT_WIDTH_DEFAULTS.min);
  const max = positiveOr(raw.max, FIT_WIDTH_DEFAULTS.max);
  const padding =
    typeof raw.padding === 'number' && Number.isFinite(raw.padding) && raw.padding >= 0
      ? raw.padding
      : FIT_WIDTH_DEFAULTS.padding;

  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
    padding,
  };
};

// Unclamped zoom percentage that fits `documentWidth` into `availableWidth`.
export const computeFitZoom = (availableWidth, documentWidth) => {
  if (!(availableWidth > 0) || !(documentWidth > 0)) return null;
  return Math.round((availableWidth / documentWidth) * 100);
};

// Applied zoom for the fit-width policy: padding reserved, then clamped.
// Floored at 1: fractional bounds (e.g. a factor-style min of 0.4) plus a
// degenerate container could otherwise round to 0, which the presentation
// engine rejects with a throw.
export const computeAppliedFitZoom = (availableWidth, documentWidth, options) => {
  const padded = computeFitZoom(availableWidth - options.padding, documentWidth);
  if (padded === null) return null;
  return Math.max(1, Math.round(Math.min(options.max, Math.max(options.min, padded))));
};

// One measured PDF page width back to CSS px at 100% zoom. PDF pages size
// via `calc(var(--scale-factor) * <pt>px)` where the scale factor is the
// viewer zoom times PDF_TO_CSS_UNITS (the same constant PdfViewerPage uses
// to write that variable), so dividing by the page's actual scale factor
// yields PDF points regardless of zoom-sync state, and multiplying by
// PDF_TO_CSS_UNITS converts back to CSS px at 100% zoom (verified live: a
// 612pt letter page renders 816 CSS px at 100%). Without a readable scale
// factor, fall back to dividing out the assumed zoom.
export const normalizePdfPageMeasurement = (measured, scaleFactor, zoomFactor) => {
  if (!(measured > 0)) return null;
  if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
    return (measured / scaleFactor) * PDF_TO_CSS_UNITS;
  }
  return zoomFactor > 0 ? measured / zoomFactor : measured;
};

// Page width in CSS px at 100% zoom for one DOCX editor. V2 publishes
// zoom-independent base geometry through pageMetrics. Other editor
// implementations expose the same geometry through laid-out pages or page styles.
// V2 publishes a new page-metrics snapshot per paint, and its `pages` array
// materializes entries lazily on read, so walking it on every
// `pagination-update` would materialize every retained page after each
// keystroke. The producer publishes `widestPageWidthPx` for exactly this
// reason; the walk stays only as a fallback for snapshots that predate it.
const resolveV2WidestPageWidth = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const published = snapshot.widestPageWidthPx;
  if (typeof published === 'number' && Number.isFinite(published)) return published;
  let widestPage = 0;
  const pages = snapshot.pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      const width = page?.base?.widthPx;
      if (typeof width === 'number' && Number.isFinite(width) && width > widestPage) {
        widestPage = width;
      }
    }
  }
  return widestPage;
};

export const resolveEditorPageWidth = (editor) => {
  if (!editor) return null;

  let widestPage = 0;
  try {
    widestPage = resolveV2WidestPageWidth(editor.pageMetrics?.getSnapshot?.());
  } catch {
    widestPage = 0;
  }
  if (widestPage > 0) return widestPage;

  try {
    const pages = editor.getPages?.();
    if (Array.isArray(pages)) {
      for (const page of pages) {
        const width = page?.size?.w;
        if (typeof width === 'number' && Number.isFinite(width) && width > widestPage) {
          widestPage = width;
        }
      }
    }
  } catch {
    widestPage = 0;
  }
  if (widestPage > 0) return widestPage;

  let pageStyles = null;
  try {
    pageStyles = editor.getPageStyles?.() ?? null;
  } catch {
    pageStyles = null;
  }
  const pageWidthInches = pageStyles?.pageSize?.width;
  if (typeof pageWidthInches === 'number' && Number.isFinite(pageWidthInches) && pageWidthInches > 0) {
    return pageWidthInches * CSS_PX_PER_INCH;
  }
  return null;
};

/**
 * Viewport fit tracking. Maintains pure viewport metrics (available width,
 * document base width, fit zoom), stores them for `getViewportMetrics()`,
 * emits `viewport-change` when the fit they imply changes, and applies the
 * `fit-width` policy while `zoomMode` is `'fit-width'`.
 *
 * Metrics are policy-free measurements: `availableWidth` is the container
 * width minus the comments sidebar when visible; `fitZoom` is the raw
 * available/document ratio. The fit policy (and only the policy) accounts
 * for `config.zoom.fitWidth` padding and clamping.
 *
 * The base page width is re-resolved on every evaluation (never latched):
 * DOCX uses the widest laid-out page with page-styles fallback, PDF uses
 * rendered pages normalized by their actual scale factor, and HTML reflows
 * so it contributes no fixed width. A zoom-normalized DOM measurement is
 * the last-resort fallback for a DOCX editor without page geometry.
 *
 * The fit application writes the zoom state directly instead of calling
 * `setZoom()`, which by contract switches the mode to `manual`.
 *
 * Must be called inside a component `setup()` (registers watchers and an
 * unmount hook).
 */
export function useViewportFit({
  getSuperdoc,
  superdocContainerWidth,
  isReady,
  activeZoom,
  zoomMode,
  viewportMetrics,
  showCommentsSidebar,
  rightSidebarRef,
  superdocRoot,
  documents,
}) {
  // Widest rendered PDF page in CSS px at 100% zoom. See
  // `normalizePdfPageMeasurement` for the unit handling. Skipped entirely
  // when no PDF document is loaded: the query plus per-page computed-style
  // reads would otherwise run on every repagination of DOCX-only docs.
  const resolvePdfPageWidth = () => {
    const docs = documents?.value ?? [];
    if (!docs.some((doc) => doc?.type === PDF)) return null;
    const root = superdocRoot.value;
    if (!root?.querySelectorAll) return null;
    let widest = 0;
    for (const page of root.querySelectorAll(PDF_PAGE_SELECTOR)) {
      const measured = Number(page.clientWidth) || Number(page.getBoundingClientRect?.().width) || 0;
      let scaleFactor = NaN;
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        scaleFactor = Number.parseFloat(window.getComputedStyle(page).getPropertyValue('--scale-factor'));
      }
      const zoomFactor = (activeZoom.value ?? 100) / 100;
      const normalized = normalizePdfPageMeasurement(measured, scaleFactor, zoomFactor);
      if (normalized !== null && normalized > widest) widest = normalized;
    }
    return widest > 0 ? widest : null;
  };

  // Widest measurable document width at 100% zoom across all loaded
  // documents. Zoom is global, so the fit must target the widest page:
  // otherwise one landscape or PDF document overflows while another fits.
  // HTML documents reflow to the container and contribute no fixed width.
  const resolveBaseDocumentWidth = () => {
    const superdoc = getSuperdoc();
    if (!superdoc) return null;
    const widths = [];

    const docs = documents?.value ?? [];
    for (const doc of docs) {
      if (doc?.type !== DOCX) continue;
      const width = resolveEditorPageWidth(doc.getEditor?.());
      if (width !== null) widths.push(width);
    }
    // Store shims in tests (and transitional states) may not expose
    // per-document editors; fall back to the active editor's page styles.
    if (widths.length === 0) {
      const width = resolveEditorPageWidth(superdoc.activeEditor);
      if (width !== null) widths.push(width);
    }

    const pdfWidth = resolvePdfPageWidth();
    if (pdfWidth !== null) widths.push(pdfWidth);

    if (widths.length > 0) return Math.max(...widths);

    // Last resort for a DOCX editor without page styles: the rendered
    // document element, normalized by zoom. Gated on an editor existing;
    // before editor mount the element is shell scaffolding whose width is
    // container-derived, which would produce a garbage base.
    if (superdoc.activeEditor) {
      const docEl = superdocRoot.value?.querySelector?.('.superdoc__document');
      const measured = Number(docEl?.clientWidth) || Number(docEl?.getBoundingClientRect?.().width) || 0;
      if (measured > 0) {
        const zoomFactor = (activeZoom.value ?? 100) / 100;
        return zoomFactor > 0 ? measured / zoomFactor : measured;
      }
    }

    return null;
  };

  // Width the comments sidebar takes from the container when visible.
  // Template ref first (owned by SuperDoc.vue, rename-proof); selector
  // only as a fallback for hosts that pass no ref.
  const resolveSidebarWidth = () => {
    if (!showCommentsSidebar?.value) return 0;
    const sidebarEl = rightSidebarRef?.value ?? superdocRoot.value?.querySelector?.(SIDEBAR_SELECTOR);
    const measured = Number(sidebarEl?.offsetWidth) || Number(sidebarEl?.getBoundingClientRect?.().width) || 0;
    return measured > 0 ? measured : 0;
  };

  const applyFitWidth = (superdoc, metrics) => {
    const options = resolveFitWidthOptions(superdoc.config?.zoom?.fitWidth);
    const target = computeAppliedFitZoom(metrics.availableWidth, metrics.documentWidth, options);
    if (target === null) return;
    // Same-value guard: applying the fit re-triggers viewport evaluation
    // through the render pipeline; skipping no-op zooms is what terminates
    // that cycle (the base width is zoom-independent, so the recomputed
    // target is stable).
    if (target === activeZoom.value) return;
    // Write the zoom state directly: setZoom() would flip the mode to
    // manual. The activeZoom watcher in SuperDoc.vue propagates the value
    // to all presentation surfaces exactly as setZoom() does.
    activeZoom.value = target;
    superdoc.emit('zoomChange', { zoom: target, mode: 'fit-width' });
  };

  const evaluateViewport = () => {
    const superdoc = getSuperdoc();
    if (!superdoc) return;

    const containerWidth = superdocContainerWidth.value;
    if (!(containerWidth > 0)) return;
    if (!isReady.value) return;

    const documentWidth = resolveBaseDocumentWidth();
    // No measurable document yet (editors still mounting): skip instead of
    // storing a guessed width; the editorCreate/pagination hooks re-run this.
    if (documentWidth === null) return;

    const availableWidth = containerWidth - resolveSidebarWidth();
    const fitZoom = computeFitZoom(availableWidth, documentWidth);
    if (fitZoom === null) return;

    // Frozen so the event payload, the stored metrics, and the
    // getViewportMetrics() return value (all the same object) cannot be
    // mutated by one consumer to corrupt the others.
    const metrics = Object.freeze({ availableWidth, documentWidth, fitZoom });

    // Two freshness tiers, deliberately distinct:
    // - Stored metrics (getViewportMetrics() / ui.zoom reads) are always
    //   latest: refreshed whenever any field changes, including px-level
    //   availableWidth movement.
    // - The viewport-change EVENT is deduped to fit-relevant changes
    //   (rounded fitZoom, rounded base width): px jitter during a window
    //   drag cannot change any fit decision and would only spam consumers.
    const previous = viewportMetrics.value;
    const fieldsChanged =
      !previous ||
      previous.availableWidth !== availableWidth ||
      previous.documentWidth !== documentWidth ||
      previous.fitZoom !== fitZoom;
    if (fieldsChanged) {
      viewportMetrics.value = metrics;
    }

    const fitChanged =
      !previous || previous.fitZoom !== fitZoom || Math.round(previous.documentWidth) !== Math.round(documentWidth);
    if (fitChanged) {
      superdoc.emit('viewport-change', metrics);
    }

    // The fit policy re-applies on every evaluation while in fit-width mode.
    // That is safe: leaving the mode requires setZoom()/setZoomMode(), and
    // the same-value guard makes repeat applications no-ops.
    if (zoomMode.value === 'fit-width') {
      applyFitWidth(superdoc, metrics);
    }
  };

  // Deferred a tick: the container width can change in the same flush that
  // flips compact-comments mode (the sidebar's v-if has not patched yet) or
  // mid render pass; evaluating post-flush sees the settled DOM and avoids
  // a one-frame fit bounce.
  watch(superdocContainerWidth, () => {
    nextTick(() => evaluateViewport());
  });
  watch(isReady, (ready) => {
    if (ready) evaluateViewport();
  });
  // Entering fit-width applies the fit immediately; the sidebar changes the
  // available width without resizing the observed container, so re-measure
  // after it mounts/unmounts.
  watch(zoomMode, (mode) => {
    if (mode === 'fit-width') evaluateViewport();
  });
  if (showCommentsSidebar) {
    watch(showCommentsSidebar, () => {
      nextTick(() => evaluateViewport());
    });
  }

  // Editors mount after store readiness, and page geometry can change
  // without a container resize (orientation, margins, document swap).
  // Re-evaluate on the editor lifecycle signals that change the base width.
  const handleEditorCreate = () => {
    nextTick(() => evaluateViewport());
  };
  const handlePaginationUpdate = () => {
    // paginationUpdate is emitted mid render pass; defer like the other
    // hooks so measurement never forces a layout flush against the
    // freshly mutated tree.
    nextTick(() => evaluateViewport());
  };
  const handlePdfDocumentReady = () => {
    nextTick(() => evaluateViewport());
  };

  const superdocAtSetup = getSuperdoc();
  superdocAtSetup?.on?.('editorCreate', handleEditorCreate);
  superdocAtSetup?.on?.('pagination-update', handlePaginationUpdate);
  superdocAtSetup?.on?.('pdf:document-ready', handlePdfDocumentReady);
  onBeforeUnmount(() => {
    superdocAtSetup?.off?.('editorCreate', handleEditorCreate);
    superdocAtSetup?.off?.('pagination-update', handlePaginationUpdate);
    superdocAtSetup?.off?.('pdf:document-ready', handlePdfDocumentReady);
  });

  return { evaluateViewport };
}
