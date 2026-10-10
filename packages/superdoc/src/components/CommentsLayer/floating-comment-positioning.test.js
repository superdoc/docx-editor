import { describe, expect, it } from 'vite-plus/test';
import {
  isAnchorOutsideFloatingViewport,
  normalizeFloatingAnchorTop,
  resolveRemovedReviewCardContinuityTarget,
  resolveOffscreenFloatingCardTop,
  shouldKeepFloatingCardAtAnchor,
  shouldMountFloatingCommentDialog,
} from './floating-comment-positioning.js';

describe('floating comment positioning', () => {
  it('keeps ordinary comments anchored at their document position', () => {
    expect(normalizeFloatingAnchorTop(-240, { commentId: 'c-1' })).toBe(-240);
    expect(normalizeFloatingAnchorTop(80, { commentId: 'c-1' })).toBe(80);
  });

  it('keeps tracked-change cards scroll-coupled to their document anchor', () => {
    expect(normalizeFloatingAnchorTop(-240, { commentId: 'tc-1', trackedChange: true })).toBe(-240);
    expect(normalizeFloatingAnchorTop(80, { commentId: 'tc-1', trackedChange: true })).toBe(80);
  });

  it('detects anchors outside the floating viewport', () => {
    expect(isAnchorOutsideFloatingViewport(-20, 0, 620, -1)).toBe(true);
    expect(isAnchorOutsideFloatingViewport(-20, 0, 620, 10)).toBe(false);
    expect(isAnchorOutsideFloatingViewport(621, 0, 620)).toBe(true);
    expect(isAnchorOutsideFloatingViewport(0, 0, 620)).toBe(false);
    expect(isAnchorOutsideFloatingViewport(620, 0, 620)).toBe(false);
    expect(isAnchorOutsideFloatingViewport(Number.NaN, 0, 620)).toBe(false);
  });

  it('keeps all review cards at offscreen anchors instead of collision-packing them into view', () => {
    expect(
      shouldKeepFloatingCardAtAnchor({
        comment: { commentId: 'tc-1', trackedChange: true },
        anchorTop: -24,
        anchorBottom: -4,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBe(true);
    expect(
      shouldKeepFloatingCardAtAnchor({
        comment: { commentId: 'tc-1', trackedChange: true },
        anchorTop: 120,
        anchorBottom: 140,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBe(false);
    expect(
      shouldKeepFloatingCardAtAnchor({
        comment: { commentId: 'c-1' },
        anchorTop: -24,
        anchorBottom: -4,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBe(true);
  });

  it('positions persistent review cards outside the viewport once their anchors are fully offscreen', () => {
    expect(
      resolveOffscreenFloatingCardTop({
        comment: { commentId: 'tc-1', trackedChange: true },
        anchorTop: -26,
        anchorBottom: -8,
        cardHeight: 92,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBe(-93);
    expect(
      resolveOffscreenFloatingCardTop({
        comment: { commentId: 'tc-1', trackedChange: true },
        anchorTop: 621,
        anchorBottom: 640,
        cardHeight: 92,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBe(621);
    expect(
      resolveOffscreenFloatingCardTop({
        comment: { commentId: 'tc-1', trackedChange: true },
        anchorTop: -10,
        anchorBottom: 8,
        cardHeight: 92,
        viewportTop: 0,
        viewportBottom: 620,
      }),
    ).toBeNull();
  });

  it('mounts ordinary dialogs only when pending, active, or near the viewport', () => {
    expect(
      shouldMountFloatingCommentDialog({
        id: 'c-1',
        visibleIds: new Set(),
        activeCommentInstanceId: null,
        comment: { commentId: 'c-1' },
      }),
    ).toBe(false);
    expect(
      shouldMountFloatingCommentDialog({
        id: 'c-1',
        visibleIds: new Set(['c-1']),
        activeCommentInstanceId: null,
        comment: { commentId: 'c-1' },
      }),
    ).toBe(true);
    expect(
      shouldMountFloatingCommentDialog({
        id: 'c-1',
        visibleIds: new Set(),
        activeCommentInstanceId: 'c-1',
        comment: { commentId: 'c-1' },
      }),
    ).toBe(true);
    expect(
      shouldMountFloatingCommentDialog({
        id: 'pending',
        visibleIds: new Set(),
        activeCommentInstanceId: null,
        comment: { commentId: 'pending' },
      }),
    ).toBe(true);
  });

  it('bounds mounted tracked-change dialogs to visible and active rows (SD-3852)', () => {
    const rowCount = 1_316;
    const visibleIds = new Set(Array.from({ length: 6 }, (_, index) => `tc-${index}`));
    const activeCommentInstanceId = 'tc-700';
    const mountedCount = Array.from({ length: rowCount }, (_, index) => `tc-${index}`).filter((id) =>
      shouldMountFloatingCommentDialog({
        id,
        visibleIds,
        activeCommentInstanceId,
        comment: { commentId: id, trackedChange: true },
      }),
    ).length;

    expect(mountedCount).toBe(visibleIds.size + 1);
  });

  it('preserves review continuity with the next surviving card', () => {
    expect(
      resolveRemovedReviewCardContinuityTarget({
        previousIds: ['tc-1', 'tc-2', 'tc-3', 'tc-4'],
        currentIds: new Set(['tc-1', 'tc-3', 'tc-4']),
        removedId: 'tc-2',
      }),
    ).toBe('tc-3');
  });

  it('skips additional removed cards when resolving the next continuity target', () => {
    expect(
      resolveRemovedReviewCardContinuityTarget({
        previousIds: ['tc-1', 'tc-2', 'tc-3', 'tc-4'],
        currentIds: new Set(['tc-1', 'tc-4']),
        removedId: 'tc-2',
      }),
    ).toBe('tc-4');
  });

  it('falls back to the previous surviving card when the removed card was last', () => {
    expect(
      resolveRemovedReviewCardContinuityTarget({
        previousIds: ['tc-1', 'tc-2', 'tc-3'],
        currentIds: new Set(['tc-1', 'tc-2']),
        removedId: 'tc-3',
      }),
    ).toBe('tc-2');
  });

  it('returns no continuity target when no review cards survive', () => {
    expect(
      resolveRemovedReviewCardContinuityTarget({
        previousIds: ['tc-1'],
        currentIds: new Set(),
        removedId: 'tc-1',
      }),
    ).toBeNull();
  });
});
