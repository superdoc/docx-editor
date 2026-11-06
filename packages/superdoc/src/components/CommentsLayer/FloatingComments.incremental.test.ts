import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, onBeforeUpdate, type Component } from 'vue';
import FloatingComments from './FloatingComments.vue';
import useComment from './use-comment.js';
import { useCommentsStore } from '../../stores/comments-store.js';
import { useSuperdocStore } from '../../stores/superdoc-store.js';
import type { ReviewInstance } from '../../stores/helpers/review-presentation.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const makeRect = (top: number, height = 110) => ({
  x: 0,
  y: top,
  top,
  left: 0,
  right: 300,
  bottom: top + height,
  width: 300,
  height,
  toJSON: () => ({}),
});

const readTranslateY = (element: HTMLElement | null) => {
  const match = element?.style?.transform?.match(/translateY\((-?[\d.]+)px\)/);
  return match ? Number(match[1]) : 0;
};

const makeTrackedChange = (id: string) =>
  useComment({
    commentId: id,
    fileId: 'doc-1',
    commentText: '',
    trackedChange: true,
    trackedChangeText: id,
    trackedChangeType: 'delete',
    trackedChangeDisplayType: 'delete',
    trackedChangeCanonicalId: id,
    trackedChangeAnchorKey: `tc::body::${id}`,
  });

const makeComment = (id: string) =>
  useComment({
    commentId: id,
    fileId: 'doc-1',
    commentText: id,
  });

const makePosition = (id: string, top: number) => ({
  key: id,
  threadId: id,
  kind: 'trackedChange',
  storyKey: 'body',
  bounds: { top, bottom: top + 20, left: 0, right: 100 },
  rects: [{ top, bottom: top + 20, left: 0, right: 100 }],
});

const settleLayout = async () => {
  await nextTick();
  await flushPromises();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await nextTick();
  await flushPromises();
};

describe('FloatingComments sidebar continuity', () => {
  let commentsStore: ReturnType<typeof useCommentsStore>;
  let superdocStore: ReturnType<typeof useSuperdocStore>;
  let parent: HTMLElement;
  let restoreRect: (() => void) | undefined;
  let outerScrollTop = 0;

  beforeEach(() => {
    setActivePinia(createPinia());
    commentsStore = useCommentsStore();
    superdocStore = useSuperdocStore();
    superdocStore.documents = [
      {
        id: 'doc-1',
        type: DOCX_TYPE,
        isReady: true,
        pageContainers: [],
        getEditor: () => null,
        getDocumentRuntime: () => null,
      },
    ];

    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
    parent = document.createElement('div');
    document.body.appendChild(parent);
    outerScrollTop = 0;

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === parent || this.classList?.contains('section-wrapper')) return makeRect(-outerScrollTop, 600);
        const placeholder = this.classList?.contains('comment-placeholder')
          ? this
          : this.closest<HTMLElement>('.comment-placeholder');
        if (placeholder) {
          const layoutTop = Number.parseFloat(placeholder.style.top) || 0;
          return makeRect(
            layoutTop + readTranslateY(placeholder.closest<HTMLElement>('.sidebar-container')) - outerScrollTop,
          );
        }
        return makeRect(0);
      });
    restoreRect = () => rectSpy.mockRestore();
  });

  afterEach(() => {
    restoreRect?.();
    parent?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mountSidebar = async (
    rows: { id: string; top: number }[],
    {
      tracked = true,
      commentDialogStub = true,
      attachTo = document.body,
    }: { tracked?: boolean; commentDialogStub?: boolean | Component; attachTo?: HTMLElement } = {},
  ) => {
    commentsStore.commentsList = rows.map(({ id }) => (tracked ? makeTrackedChange(id) : makeComment(id)));
    commentsStore.editorCommentPositions = Object.fromEntries(rows.map(({ id, top }) => [id, makePosition(id, top)]));

    const wrapper = mount(FloatingComments, {
      attachTo,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: commentDialogStub },
      },
    });
    await settleLayout();
    return wrapper;
  };

  it('keeps unchanged committed review cards on the same props across republished presentations', async () => {
    const seen: { id: unknown; entry: unknown }[] = [];
    const DialogProbe = defineComponent({
      props: [
        'comment',
        'floatingInstanceId',
        'floatingPageIndex',
        'floatingPositionEntry',
        'isFloatingInstanceActive',
        'parent',
      ],
      setup(props) {
        onBeforeUpdate(() => seen.push({ id: props.floatingInstanceId, entry: props.floatingPositionEntry }));
        return () => h('div', { class: 'comments-dialog' });
      },
    });
    const instance = (id: string, top: number, entryTop: number): ReviewInstance => ({
      id,
      rowId: id,
      threadId: id,
      pageIndex: 0,
      positionKey: id,
      positionEntry: makePosition(id, entryTop),
      anchorTop: entryTop,
      anchorBottom: entryTop + 20,
      top,
      height: 110,
      isPrimary: true,
      isOffscreenReviewCard: false,
      mount: true,
    });
    const publish = (version: number, instances: ReviewInstance[]) => {
      commentsStore.committedReviewPresentations = {
        'doc-1': {
          epoch: 'e',
          coordinate: { documentEpoch: 'e', mountId: 'm', commitSequence: 1, reviewVersion: version },
          version,
          baseVersion: version - 1,
          unchanged: false,
          rowVersions: { 'tc-a': 1, 'tc-b': 1 },
          groupOrder: { open: ['tc-a', 'tc-b'], resolved: [] },
          updateContext: () => {},
          instances,
        },
      };
    };
    publish(1, [instance('tc-a', 10, 10), instance('tc-b', 200, 200)]);
    const wrapper = await mountSidebar(
      [
        { id: 'tc-a', top: 10 },
        { id: 'tc-b', top: 200 },
      ],
      { commentDialogStub: DialogProbe },
    );
    try {
      seen.length = 0;
      publish(2, [instance('tc-a', 10, 10), instance('tc-b', 240, 240)]);
      await settleLayout();
      expect(seen.filter((entry) => entry.id === 'tc-a')).toEqual([]);
      expect(seen.filter((entry) => entry.id === 'tc-b').length).toBeGreaterThan(0);
      expect(wrapper.find('[data-comment-id="tc-b"]').attributes('style')).toContain('top: 240px');
    } finally {
      wrapper.unmount();
    }
  });
});
