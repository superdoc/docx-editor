import { PAGE_BREAK_DELETION_ANCHOR_ATTR } from '@superdoc/contracts';

export const PAGE_BREAK_REVIEW_SELECTOR = `[${PAGE_BREAK_DELETION_ANCHOR_ATTR}="true"]`;

export function isVisiblePageBreakReviewMarker(marker: HTMLElement): boolean {
  return (
    marker.getAttribute(PAGE_BREAK_DELETION_ANCHOR_ATTR) === 'true' &&
    marker.style.position === 'absolute' &&
    !!marker.textContent
  );
}

export function copyReviewMarkerSourceAttrs(marker: HTMLElement, source: Element): void {
  for (const name of [
    'data-source-anchor',
    'data-source-node-id',
    'data-source-occurrence-id',
    'data-layout-block-ref',
    'data-layout-story',
  ]) {
    const value = source.getAttribute(name);
    if (value != null) marker.setAttribute(name, value);
  }
}
