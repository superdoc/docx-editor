import type { CommentsLayout, CommentsResponsiveConfig } from '../core/types/index.js';
import { isPlainObject } from './object-guards.js';
import { isFiniteNumber } from './is-finite-number.ts';

export const COMPACT_ANCHOR_SELECTOR = '[data-track-change-id], .superdoc-comment-highlight, .sd-comment-anchor';

export const DEFAULT_COMMENTS_SIDEBAR_LANE_PX = 320;
export const DEFAULT_COMMENTS_MIN_GUTTER_PX = 24;
export const DEFAULT_DOCUMENT_VISIBLE_MIN_WIDTH_PX = 816;
export const RIGHT_CLICK_COMMENT_SUPPRESS_MS = 250;
export const DEFAULT_COMMENTS_LAYOUT = 'sidebar';
export const VALID_COMMENTS_LAYOUTS = new Set<string>(['auto', 'sidebar', 'inline']);

const isCommentsLayout = (value: unknown): value is CommentsLayout =>
  typeof value === 'string' && VALID_COMMENTS_LAYOUTS.has(value);

const firstDefined = (...values: unknown[]): unknown => values.find((value) => value !== undefined);

const normalizeResponsiveTarget = (value: unknown): string | HTMLElement | undefined => {
  if (typeof value === 'string') {
    const target = value.trim();
    return target || undefined;
  }
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return value;
  return undefined;
};

const canSearchAncestors = (target: EventTarget | null): target is EventTarget & Pick<Element, 'closest'> =>
  typeof target === 'object' && target !== null && 'closest' in target && typeof target.closest === 'function';

/**
 * Whether a context-menu event landed inside the tracked-change carrier that
 * is already visually active. The review visual owner maintains this marker,
 * so the right-click path can stay synchronous and avoid a catalog lookup or
 * document-wide DOM query.
 */
export function isActiveTrackedChangeContextMenuTarget(target: EventTarget | null): boolean {
  return canSearchAncestors(target) && target.closest('.track-change-focused') != null;
}

/**
 * Resolve canonical comments UI fields while preserving valid deprecated
 * fields for consumers that still read the normalized configuration.
 */
export function normalizeCommentsUiConfig(
  commentsConfig: false | Record<string, unknown> | undefined,
): false | Record<string, unknown> | undefined {
  if (!commentsConfig || typeof commentsConfig !== 'object') {
    return commentsConfig;
  }

  const normalized: Record<string, unknown> = { ...commentsConfig };
  const responsive = isPlainObject(commentsConfig.responsive) ? commentsConfig.responsive : {};
  const layout = firstDefined(commentsConfig.layout, commentsConfig.displayMode);
  const target = normalizeResponsiveTarget(firstDefined(responsive.target, commentsConfig.compactMeasurementSelector));
  const breakpoint = firstDefined(responsive.breakpoint, commentsConfig.compactBreakpointPx);

  const deprecatedDisplayMode = commentsConfig.displayMode;
  if (!isCommentsLayout(deprecatedDisplayMode)) delete normalized.displayMode;

  const deprecatedTarget = normalizeResponsiveTarget(commentsConfig.compactMeasurementSelector);
  if (deprecatedTarget === undefined) delete normalized.compactMeasurementSelector;
  else normalized.compactMeasurementSelector = deprecatedTarget;

  const deprecatedBreakpoint = commentsConfig.compactBreakpointPx;
  if (!(isFiniteNumber(deprecatedBreakpoint) && deprecatedBreakpoint >= 0)) {
    delete normalized.compactBreakpointPx;
  }

  delete normalized.layout;
  delete normalized.responsive;

  if (isCommentsLayout(layout)) normalized.layout = layout;

  const normalizedResponsive: CommentsResponsiveConfig = {};
  if (target !== undefined) normalizedResponsive.target = target;
  if (isFiniteNumber(breakpoint) && breakpoint >= 0) {
    normalizedResponsive.breakpoint = breakpoint;
  }
  if (Object.keys(normalizedResponsive).length > 0) normalized.responsive = normalizedResponsive;

  return normalized;
}
