import type { Page } from '@superdoc/contracts';
import type { PageState } from './paginator';
import type { FootnoteAnchorRef } from './layout-paragraph';

/** Internal body/notes handshake. The bridge owns exact continuation ranges. */
export type FootnotePageFlow = {
  /** False for a bounded block horizon: its EOF is not the document's EOF. */
  completeDocument?: boolean;
  incomingDemand(pageIndex: number): { height: number; refs: number };
  completePage(input: {
    page: Page;
    pageIndex: number;
    bodyBottom: number;
    physicalBottom: number;
    anchors: readonly FootnoteAnchorRef[];
  }): void;
  hasPendingContinuation(): boolean;
};

/**
 * Both kept groups and individual lines use this budget. A numeric reserve
 * from an earlier pagination has no authority over this page's exact queue.
 */
export function coupledFootnoteBodyBottom(
  state: PageState,
  anchoredHeight: number,
  anchoredRefs: number,
  incoming: { height: number; refs: number },
  overhead: (refs: number) => number,
  minimumBodyHeight = 0,
): number {
  const physicalBottom = state.contentBottom + state.pageFootnoteReserve;
  const height = anchoredHeight + incoming.height;
  const reserve = height > 0 ? height + overhead(anchoredRefs + incoming.refs) + 1 : 0;
  const capacity = Math.max(0, physicalBottom - state.topMargin - minimumBodyHeight);
  return physicalBottom - Math.min(reserve, capacity);
}
