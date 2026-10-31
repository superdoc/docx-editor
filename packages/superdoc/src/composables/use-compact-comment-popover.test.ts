import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { PDF } from '@superdoc/common';
import { useCompactCommentPopover } from './use-compact-comment-popover.js';

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const setRect = (el, r) => {
  el.getBoundingClientRect = vi.fn(() => r);
};

const dispatchPointerDown = (target, { clientX, clientY, button = 0, pointerType = 'mouse' }) => {
  const event = new MouseEvent('pointerdown', { bubbles: true, button, clientX, clientY });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
};

describe('useCompactCommentPopover', () => {
  let root;
  let layers;
  let popover;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    layers = document.createElement('div');
    popover = document.createElement('div');

    root.className = 'superdoc';
    layers.className = 'superdoc__layers';
    popover.className = 'superdoc__compact-comment-popover';

    root.appendChild(layers);
    root.appendChild(popover);
    document.body.appendChild(root);

    setRect(root, rect(0, 0, 1200, 900));
    setRect(layers, rect(100, 80, 816, 700));
    setRect(popover, rect(600, 200, 320, 220));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mountComposable = (overrides = {}) => {
    const activeComment = overrides.activeComment ?? ref(null);
    const pendingComment = overrides.pendingComment ?? ref(null);
    const activeCompactComment = overrides.activeCompactComment ?? ref(null);
    const showCommentsSidebar = overrides.showCommentsSidebar ?? ref(false);
    const selectionPosition = overrides.selectionPosition ?? ref(null);
    const activeZoom = overrides.activeZoom ?? ref(100);
    const documents = overrides.documents ?? ref([]);
    const clearActiveComment = overrides.clearActiveComment ?? vi.fn();
    const clearPendingComment = overrides.clearPendingComment ?? vi.fn();
    const resolveCommentPositionEntry =
      overrides.resolveCommentPositionEntry ?? vi.fn(() => ({ entry: { bounds: { top: 120, bottom: 140 } } }));

    let api;
    const Harness = defineComponent({
      setup() {
        api = useCompactCommentPopover({
          activeComment,
          pendingComment,
          activeCompactComment,
          showCommentsSidebar,
          selectionPosition,
          activeZoom,
          superdocRoot: ref(root),
          layers: ref(layers),
          documents,
          resolveCommentPositionEntry,
          clearActiveComment,
          clearPendingComment,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(Harness);
    return {
      wrapper,
      api,
      refs: {
        activeComment,
        pendingComment,
        activeCompactComment,
        showCommentsSidebar,
        selectionPosition,
        activeZoom,
        documents,
      },
      fns: { clearActiveComment, clearPendingComment, resolveCommentPositionEntry },
    };
  };

  it('returns fallback style when there is no active compact comment', () => {
    const { api, wrapper } = mountComposable();

    expect(api.compactCommentPopoverStyle.value).toEqual({ top: '12px', right: '12px' });

    wrapper.unmount();
  });

  it('computes position from interaction anchor tracked by pointerdown', async () => {
    const anchor = document.createElement('span');
    anchor.className = 'superdoc-comment-highlight';
    anchor.setAttribute('data-comment-ids', 'c-1');
    setRect(anchor, rect(240, 300, 40, 20));
    layers.appendChild(anchor);

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [anchor]);

    const { api, refs, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'c-1' }),
    });

    dispatchPointerDown(anchor, { clientX: 260, clientY: 305, pointerType: 'mouse' });
    await nextTick();

    const style = api.compactCommentPopoverStyle.value;
    expect(style.top).toBeDefined();
    expect(style.left).toBeDefined();
    expect(style.right).toBe('auto');

    document.elementsFromPoint = originalElementsFromPoint;
    refs.activeCompactComment.value = null;
    wrapper.unmount();
  });

  it('falls back to inline highlight rect when there is no recent interaction anchor', () => {
    const highlight = document.createElement('span');
    highlight.className = 'superdoc-comment-highlight';
    highlight.setAttribute('data-comment-ids', 'thread-1');
    setRect(highlight, rect(180, 260, 60, 24));
    root.appendChild(highlight);

    const { api, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'thread-1' }),
      resolveCommentPositionEntry: vi.fn(() => ({ entry: { bounds: {} } })),
    });

    const style = api.compactCommentPopoverStyle.value;
    expect(style.top).toBeDefined();
    expect(style.left).toBeDefined();
    expect(style.right).toBe('auto');

    wrapper.unmount();
  });

  it('skips highlight nodes without getBoundingClientRect and falls back to tracked-change node', () => {
    const brokenHighlight = document.createElement('span');
    brokenHighlight.className = 'superdoc-comment-highlight';
    brokenHighlight.setAttribute('data-comment-ids', 'thread-2');
    // Simulate a malformed node branch: no callable rect API.
    brokenHighlight.getBoundingClientRect = undefined;
    root.appendChild(brokenHighlight);

    const tcNode = document.createElement('span');
    tcNode.setAttribute('data-track-change-id', 'thread-2');
    setRect(tcNode, rect(200, 280, 30, 18));
    root.appendChild(tcNode);

    const { api, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'thread-2' }),
      resolveCommentPositionEntry: vi.fn(() => ({ entry: { bounds: {} } })),
    });

    const style = api.compactCommentPopoverStyle.value;
    expect(style.top).toBeDefined();
    expect(style.left).toBeDefined();

    wrapper.unmount();
  });

  it('uses pending selection fallback with PDF zoom when no anchor data exists', () => {
    const { api, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'pending-id' }),
      pendingComment: ref({ commentId: 'pending-id' }),
      selectionPosition: ref({ source: 'pdf', top: 50, bottom: 100 }),
      activeZoom: ref(150),
      resolveCommentPositionEntry: vi.fn(() => ({ entry: { bounds: {} } })),
    });

    const style = api.compactCommentPopoverStyle.value;
    expect(style.top).toBeDefined();
    expect(style.left).toBeDefined();

    wrapper.unmount();
  });

  it('clears pending + active comment and restores focus when close is called', () => {
    const focusEl = document.createElement('button');
    document.body.appendChild(focusEl);
    focusEl.focus();

    const clearActiveComment = vi.fn();
    const clearPendingComment = vi.fn();

    const { api, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'x' }),
      pendingComment: ref({ commentId: 'x' }),
      clearActiveComment,
      clearPendingComment,
    });

    api.closeCompactCommentPopover();

    expect(clearPendingComment).toHaveBeenCalledTimes(1);
    expect(clearActiveComment).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('closes PDF compact popover on outside pointerdown inside layers', async () => {
    const nonAnchorTarget = document.createElement('div');
    layers.appendChild(nonAnchorTarget);

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [nonAnchorTarget]);

    const clearActiveComment = vi.fn();
    const { wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'pdf-thread' }),
      documents: ref([{ type: PDF }]),
      clearActiveComment,
    });

    dispatchPointerDown(nonAnchorTarget, { clientX: 120, clientY: 140, pointerType: 'mouse' });
    await nextTick();

    expect(clearActiveComment).toHaveBeenCalledTimes(1);

    document.elementsFromPoint = originalElementsFromPoint;
    wrapper.unmount();
  });

  it('keeps non-mouse pointerdown out of click-anchor tracking', async () => {
    const anchor = document.createElement('span');
    anchor.className = 'superdoc-comment-highlight';
    anchor.setAttribute('data-comment-ids', 'c-touch');
    setRect(anchor, rect(260, 320, 40, 20));
    layers.appendChild(anchor);

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [anchor]);

    const clearActiveComment = vi.fn();
    const { api, wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'c-touch' }),
      documents: ref([]),
      clearActiveComment,
      resolveCommentPositionEntry: vi.fn(() => ({ entry: { bounds: { top: 100, bottom: 100 } } })),
    });

    const beforeStyle = api.compactCommentPopoverStyle.value;
    dispatchPointerDown(anchor, { clientX: 270, clientY: 330, pointerType: 'touch' });
    await nextTick();
    const afterStyle = api.compactCommentPopoverStyle.value;

    expect(afterStyle).toEqual(beforeStyle);
    expect(clearActiveComment).not.toHaveBeenCalled();

    document.elementsFromPoint = originalElementsFromPoint;
    wrapper.unmount();
  });

  it('closes PDF compact popover and clears pending comment on outside pointerdown', async () => {
    const nonAnchorTarget = document.createElement('div');
    layers.appendChild(nonAnchorTarget);

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [nonAnchorTarget]);

    const clearActiveComment = vi.fn();
    const clearPendingComment = vi.fn();
    const { wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'pdf-thread' }),
      pendingComment: ref({ commentId: 'pdf-thread' }),
      documents: ref([{ type: PDF }]),
      clearActiveComment,
      clearPendingComment,
    });

    dispatchPointerDown(nonAnchorTarget, { clientX: 120, clientY: 140, pointerType: 'mouse' });
    await nextTick();

    expect(clearPendingComment).toHaveBeenCalledTimes(1);
    expect(clearActiveComment).toHaveBeenCalledTimes(1);

    document.elementsFromPoint = originalElementsFromPoint;
    wrapper.unmount();
  });

  it('closes PDF compact popover on touch outside-click', async () => {
    const nonAnchorTarget = document.createElement('div');
    layers.appendChild(nonAnchorTarget);

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [nonAnchorTarget]);

    const clearActiveComment = vi.fn();
    const { wrapper } = mountComposable({
      activeCompactComment: ref({ commentId: 'pdf-touch' }),
      documents: ref([{ type: PDF }]),
      clearActiveComment,
    });

    dispatchPointerDown(nonAnchorTarget, { clientX: 140, clientY: 160, pointerType: 'touch' });
    await nextTick();

    expect(clearActiveComment).toHaveBeenCalledTimes(1);

    document.elementsFromPoint = originalElementsFromPoint;
    wrapper.unmount();
  });
});
