import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { PDF } from '@superdoc/common';
import { useCompactCommentPopover } from './use-compact-comment-popover.js';

type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height' | 'right' | 'bottom'>;

type RectStub = { getBoundingClientRect: () => RectLike };

const rect = (left: number, top: number, width: number, height: number): RectLike => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const pointerDown = ({ clientX, clientY }: { clientX: number; clientY: number }) => {
  const event = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
};

describe('useCompactCommentPopover pointerdown target', () => {
  let root: HTMLDivElement;
  let layers: HTMLDivElement;
  let popover: HTMLDivElement;
  let wrapper: VueWrapper | null;
  let originalElementsFromPoint: typeof document.elementsFromPoint;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    layers = document.createElement('div');
    popover = document.createElement('div');
    popover.className = 'superdoc__compact-comment-popover';
    root.append(layers, popover);
    document.body.appendChild(root);
    const rootRect: RectStub = root;
    const layersRect: RectStub = layers;
    rootRect.getBoundingClientRect = vi.fn(() => rect(0, 0, 1200, 900));
    layersRect.getBoundingClientRect = vi.fn(() => rect(100, 80, 816, 700));
    originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => []);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.elementsFromPoint = originalElementsFromPoint;
    document.body.innerHTML = '';
  });

  const mountComposable = ({ documents = [] }: { documents?: Array<{ type: string }> } = {}) => {
    const clearActiveComment = vi.fn();
    const clearPendingComment = vi.fn();
    let api: ReturnType<typeof useCompactCommentPopover> | undefined;
    const Harness = defineComponent({
      setup() {
        api = useCompactCommentPopover({
          activeComment: ref('c-1'),
          pendingComment: ref(null),
          activeCompactComment: ref({ commentId: 'c-1' }),
          showCommentsSidebar: ref(false),
          selectionPosition: ref(null),
          activeZoom: ref(100),
          superdocRoot: ref(root),
          layers: ref(layers),
          documents: ref(documents),
          resolveCommentPositionEntry: vi.fn(() => ({ entry: null })),
          clearActiveComment,
          clearPendingComment,
        });
        return () => h('div');
      },
    });
    wrapper = mount(Harness);
    return { api: api!, clearActiveComment, clearPendingComment };
  };

  it('finds the anchor from the event target when no element is reported at the point', async () => {
    const anchor = document.createElement('span');
    anchor.className = 'superdoc-comment-highlight';
    const inner = document.createElement('b');
    anchor.appendChild(inner);
    const anchorRect: RectStub = anchor;
    anchorRect.getBoundingClientRect = vi.fn(() => rect(240, 300, 40, 20));
    layers.appendChild(anchor);
    const { api } = mountComposable();

    inner.dispatchEvent(pointerDown({ clientX: 260, clientY: 305 }));
    await nextTick();

    expect(api.compactCommentPopoverStyle.value).toEqual({ top: '336px', left: '272px', right: 'auto' });
  });

  it('ignores a pointerdown whose target is not a DOM node', async () => {
    const { api, clearActiveComment, clearPendingComment } = mountComposable({ documents: [{ type: PDF }] });
    const event = pointerDown({ clientX: 260, clientY: 305 });
    Object.defineProperty(event, 'target', { value: new EventTarget() });

    document.dispatchEvent(event);
    await nextTick();

    expect(clearActiveComment).not.toHaveBeenCalled();
    expect(clearPendingComment).not.toHaveBeenCalled();
    expect(api.compactCommentPopoverStyle.value).toEqual({ top: '12px', right: '12px' });
  });
});
