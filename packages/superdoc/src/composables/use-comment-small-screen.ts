import { onBeforeUnmount, ref, type Ref } from 'vue';
import {
  DEFAULT_COMMENTS_LAYOUT,
  DEFAULT_COMMENTS_MIN_GUTTER_PX,
  DEFAULT_COMMENTS_SIDEBAR_LANE_PX,
  DEFAULT_DOCUMENT_VISIBLE_MIN_WIDTH_PX,
} from '../helpers/comment-small-screen.js';
import { isFiniteNumber } from '../helpers/is-finite-number.js';
import type { CommentsConfig } from '../core/types/index.js';

interface UseCommentSmallScreenOptions {
  commentsModuleConfig: Readonly<Ref<CommentsConfig | null | undefined>>;
  superdocRoot: Readonly<Ref<HTMLElement | null>>;
  layers: Readonly<Ref<HTMLElement | null>>;
}

const SUPERDOC_DOCUMENT_SELECTOR = '.superdoc__document';

const isValidCompactBreakpoint = (value: unknown): value is number => {
  return isFiniteNumber(value) && value >= 0;
};
const getRequiredSidebarWidth = (documentWidth: number): number => {
  return documentWidth + DEFAULT_COMMENTS_SIDEBAR_LANE_PX + DEFAULT_COMMENTS_MIN_GUTTER_PX;
};

export function useCommentSmallScreen({ commentsModuleConfig, superdocRoot, layers }: UseCommentSmallScreenOptions) {
  const superdocContainerWidth = ref(0);
  const isCompactCommentsMode = ref(false);

  let commentsContainerResizeObserver: ResizeObserver | null = null;
  let compactMeasurementTarget: HTMLElement | null = null;
  let documentWidthResizeObserver: ResizeObserver | null = null;
  let documentWidthTargets: HTMLElement[] = [];

  // A measurement target is valid only if it can provide a meaningful width.
  // `display: contents` is skipped because it has no own box to measure.
  const isValidMeasurementTarget = (element: unknown): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    const computed = typeof window !== 'undefined' ? window.getComputedStyle(element) : null;
    if (computed?.display === 'contents') return false;
    const clientWidth = Number(element.clientWidth ?? 0);
    const rectWidth = Number(element.getBoundingClientRect?.().width ?? 0);
    return (Number.isFinite(clientWidth) && clientWidth > 0) || (Number.isFinite(rectWidth) && rectWidth > 0);
  };

  // Resolve where "available width" should be read from:
  // explicit target -> nearest measurable ancestor -> superdoc root.
  const resolveCompactMeasurementTarget = (): HTMLElement | null => {
    const root: Element | null = superdocRoot.value;
    const target = commentsModuleConfig.value?.responsive?.target;
    if (isValidMeasurementTarget(target)) return target;
    if (typeof target === 'string' && target.trim().length > 0 && typeof document !== 'undefined') {
      let selected: Element | null = null;
      try {
        selected = document.querySelector(target.trim());
      } catch {
        selected = null;
      }
      if (isValidMeasurementTarget(selected)) return selected;
    }
    let ancestor: Element | null = root?.parentElement ?? null;
    while (ancestor) {
      if (isValidMeasurementTarget(ancestor)) return ancestor;
      ancestor = ancestor.parentElement;
    }
    if (isValidMeasurementTarget(root)) return root;
    if (root instanceof HTMLElement) return root;
    return null;
  };

  // Keep one ResizeObserver bound to the effective target. Rebind it when the
  // configured target or surrounding DOM changes.
  const ensureCompactMeasurementObserver = (): void => {
    const ResizeObserverClass = typeof window !== 'undefined' ? window.ResizeObserver : undefined;
    if (typeof ResizeObserverClass === 'undefined') return;
    const nextTarget = resolveCompactMeasurementTarget();
    if (nextTarget === compactMeasurementTarget) return;

    if (commentsContainerResizeObserver) {
      commentsContainerResizeObserver.disconnect();
      commentsContainerResizeObserver = null;
    }

    compactMeasurementTarget = nextTarget;
    if (!compactMeasurementTarget) return;

    commentsContainerResizeObserver = new ResizeObserverClass(() => {
      recalculateCompactCommentsMode();
    });
    commentsContainerResizeObserver.observe(compactMeasurementTarget);
  };

  const getAvailableCommentsContainerWidth = (): number => {
    ensureCompactMeasurementObserver();
    const clientWidth = Number(compactMeasurementTarget?.clientWidth ?? 0);
    if (Number.isFinite(clientWidth) && clientWidth > 0) {
      return clientWidth;
    }
    const rectWidth = Number(compactMeasurementTarget?.getBoundingClientRect?.().width ?? 0);
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
      return rectWidth;
    }
    return 0;
  };

  // `.superdoc__layers` sizes to its content by default, but while the v2
  // loading overlay is present it's forced to fill the container (see
  // V2DocumentLoadingOverlay.vue); `.superdoc__document` is 100% of it. That
  // forced width goes away once the overlay unmounts, which is a resize of a
  // descendant the container observer above never sees. Observe both
  // directly so the compact-mode decision re-evaluates once the real page
  // width settles, instead of only on an incidental container/window resize.
  const ensureDocumentWidthObserver = (): void => {
    const ResizeObserverClass = typeof window !== 'undefined' ? window.ResizeObserver : undefined;
    if (typeof ResizeObserverClass === 'undefined') return;

    const root = superdocRoot.value;
    const documentElement = root?.querySelector?.(SUPERDOC_DOCUMENT_SELECTOR) ?? null;
    const nextTargets = [layers.value, documentElement].filter(
      (el, index, all): el is HTMLElement => el instanceof HTMLElement && all.indexOf(el) === index,
    );

    const sameTargets =
      nextTargets.length === documentWidthTargets.length &&
      nextTargets.every((el, index) => el === documentWidthTargets[index]);
    if (sameTargets) return;

    if (documentWidthResizeObserver) {
      documentWidthResizeObserver.disconnect();
      documentWidthResizeObserver = null;
    }
    documentWidthTargets = nextTargets;
    if (!nextTargets.length) return;

    const observer = new ResizeObserverClass(() => {
      recalculateCompactCommentsMode();
    });
    documentWidthResizeObserver = observer;
    nextTargets.forEach((el) => observer.observe(el));
  };

  const getMeasuredDocumentWidth = (): number => {
    ensureDocumentWidthObserver();
    const root = superdocRoot.value;
    const documentElement = root?.querySelector?.(SUPERDOC_DOCUMENT_SELECTOR);
    const layersElement = layers.value;
    const measuredFromDocument = Number(
      documentElement?.clientWidth ?? documentElement?.getBoundingClientRect?.().width ?? 0,
    );
    if (Number.isFinite(measuredFromDocument) && measuredFromDocument > 0) {
      return measuredFromDocument;
    }
    const measuredFromLayers = Number(
      layersElement?.clientWidth ?? layersElement?.getBoundingClientRect?.().width ?? 0,
    );
    if (Number.isFinite(measuredFromLayers) && measuredFromLayers > 0) {
      return measuredFromLayers;
    }
    return DEFAULT_DOCUMENT_VISIBLE_MIN_WIDTH_PX;
  };

  // For `auto`, prefer an explicit breakpoint and otherwise derive one from
  // the measured document and sidebar widths.
  const recalculateCompactCommentsMode = (): void => {
    const width = getAvailableCommentsContainerWidth();

    const commentsConfig = commentsModuleConfig.value;
    const layout = commentsConfig?.layout ?? DEFAULT_COMMENTS_LAYOUT;
    if (layout === 'sidebar') {
      superdocContainerWidth.value = width;
      isCompactCommentsMode.value = false;
      return;
    }
    if (layout === 'inline') {
      superdocContainerWidth.value = width;
      isCompactCommentsMode.value = true;
      return;
    }
    if (!(Number.isFinite(width) && width > 0)) {
      return;
    }
    superdocContainerWidth.value = width;

    const configuredBreakpoint = commentsConfig?.responsive?.breakpoint;
    if (isValidCompactBreakpoint(configuredBreakpoint)) {
      isCompactCommentsMode.value = width < configuredBreakpoint;
      return;
    }

    const measuredDocumentWidth = getMeasuredDocumentWidth();
    const requiredWidth = getRequiredSidebarWidth(measuredDocumentWidth);
    isCompactCommentsMode.value = width < requiredWidth;
  };

  onBeforeUnmount(() => {
    if (commentsContainerResizeObserver) {
      commentsContainerResizeObserver.disconnect();
      commentsContainerResizeObserver = null;
    }
    compactMeasurementTarget = null;
    if (documentWidthResizeObserver) {
      documentWidthResizeObserver.disconnect();
      documentWidthResizeObserver = null;
    }
    documentWidthTargets = [];
  });

  return {
    superdocContainerWidth,
    isCompactCommentsMode,
    recalculateCompactCommentsMode,
    ensureCompactMeasurementObserver,
  };
}
