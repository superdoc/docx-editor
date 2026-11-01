import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import FloatingComments from './FloatingComments.vue';
import useComment from './use-comment.js';
import { useCommentsStore } from '../../stores/comments-store.js';
import { useSuperdocStore } from '../../stores/superdoc-store.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const makeRect = (top, height = 110) => ({
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

const readTranslateY = (element) => {
  const match = element?.style?.transform?.match(/translateY\((-?[\d.]+)px\)/);
  return match ? Number(match[1]) : 0;
};

const makeTrackedChange = (id) =>
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

const makeComment = (id) =>
  useComment({
    commentId: id,
    fileId: 'doc-1',
    commentText: id,
  });

const makePosition = (id, top) => ({
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
  let commentsStore;
  let superdocStore;
  let parent;
  let rectSpy;
  let outerScrollTop;

  beforeEach(() => {
    setActivePinia(createPinia());
    commentsStore = useCommentsStore();
    superdocStore = useSuperdocStore();
    superdocStore.documents = [{ id: 'doc-1', type: DOCX_TYPE }];

    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
    parent = document.createElement('div');
    document.body.appendChild(parent);
    outerScrollTop = 0;

    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === parent || this.classList?.contains('section-wrapper')) return makeRect(-outerScrollTop, 600);
      const placeholder = this.classList?.contains('comment-placeholder')
        ? this
        : this.closest?.('.comment-placeholder');
      if (placeholder) {
        const layoutTop = Number.parseFloat(placeholder.style.top) || 0;
        return makeRect(layoutTop + readTranslateY(placeholder.closest('.sidebar-container')) - outerScrollTop);
      }
      return makeRect(0);
    });
  });

  afterEach(() => {
    rectSpy?.mockRestore();
    parent?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mountSidebar = async (rows, { tracked = true, commentDialogStub = true, attachTo = document.body } = {}) => {
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

  it.each(['loadingdone', 'loadingerror', 'presentation'])(
    'remeasures a changed font generation on %s, including unchanged heights, and removes its listeners',
    async (notification) => {
      const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
      const fonts = new EventTarget();
      Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
      const remove = vi.spyOn(fonts, 'removeEventListener');
      let fontRevision = 1;
      const updateContext = vi.fn();
      commentsStore.committedReviewPresentations = {
        'doc-1': {
          version: 1,
          fontRevision: 1,
          rowVersions: { 'tc-a': 1 },
          threads: {},
          groupOrder: { open: ['tc-a'], resolved: [] },
          readPaintOrigin: () => ({ left: 0, top: 0 }),
          readFontRevision: () => fontRevision,
          updateContext,
          instances: [
            {
              id: 'tc-a',
              rowId: 'tc-a',
              threadId: 'tc-a',
              version: 1,
              pageIndex: 0,
              positionKey: 'tc-a',
              positionEntry: makePosition('tc-a', 10),
              anchorTop: 10,
              anchorBottom: 30,
              top: 10,
              height: 110,
              isPrimary: true,
              isOffscreenReviewCard: false,
              mount: true,
            },
          ],
        },
      };
      let wrapper;
      try {
        wrapper = await mountSidebar([{ id: 'tc-a', top: 10 }], {
          commentDialogStub: { template: '<div class="comments-dialog" />' },
        });
        window.dispatchEvent(new Event('resize'));
        await settleLayout();
        await settleLayout();
        expect(updateContext.mock.lastCall[0].measurements).toContainEqual({
          instanceId: 'tc-a',
          rowVersion: 1,
          height: 110,
          fontRevision: 1,
        });
        const dialog = wrapper.find('.comments-dialog').element;
        const measure = vi.fn(dialog.getBoundingClientRect.bind(dialog));
        dialog.getBoundingClientRect = measure;
        fontRevision = 2;
        if (notification === 'presentation') {
          commentsStore.committedReviewPresentations = {
            'doc-1': { ...commentsStore.committedReviewPresentations['doc-1'], version: 2, fontRevision: 2 },
          };
        } else fonts.dispatchEvent(new Event(notification));
        await settleLayout();
        expect(updateContext.mock.lastCall[0].measurements).toContainEqual({
          instanceId: 'tc-a',
          rowVersion: 1,
          height: 110,
          fontRevision: 2,
        });
        expect(measure).toHaveBeenCalled();
        const measurements = measure.mock.calls.length;
        commentsStore.committedReviewPresentations = {
          'doc-1': { ...commentsStore.committedReviewPresentations['doc-1'], version: 3 },
        };
        window.dispatchEvent(new Event('scroll'));
        await settleLayout();
        expect(measure).toHaveBeenCalledTimes(measurements);
        wrapper.unmount();
        wrapper = null;
        expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('loadingerror', expect.any(Function));
      } finally {
        wrapper?.unmount();
        if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
        else delete document.fonts;
      }
    },
  );

  it('uses the current document row when another document has the same Word comment ID', async () => {
    commentsStore.committedReviewPresentations = {
      'doc-1': {
        rowVersions: { 0: 1 },
        threads: {},
        groupOrder: { open: ['0'], resolved: [] },
        updateContext: vi.fn(),
        instances: [
          {
            id: 'own-instance',
            rowId: '0',
            threadId: '0',
            version: 1,
            pageIndex: 0,
            positionKey: '0',
            positionEntry: makePosition('0', 10),
            anchorTop: 10,
            anchorBottom: 30,
            top: 100,
            height: 100,
            isPrimary: true,
            mount: true,
          },
        ],
      },
    };
    const wrapper = await mountSidebar([{ id: '0', top: 10 }], { tracked: false });
    try {
      commentsStore.commentsList.push(useComment({ commentId: '0', fileId: 'doc-2', commentText: 'other document' }));
      await settleLayout();
      expect(wrapper.findComponent({ name: 'CommentDialog' }).props('comment').fileId).toBe('doc-1');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders source-owned instance placement and returns only measured browser context', async () => {
    const updateContext = vi.fn();
    commentsStore.committedReviewPresentations = {
      'doc-1': {
        rowVersions: { 'tc-a': 3 },
        threads: {},
        groupOrder: { open: ['tc-a'], resolved: [] },
        updateContext,
        instances: [
          {
            id: 'worker-instance',
            rowId: 'tc-a',
            threadId: 'tc-a',
            version: 1,
            pageIndex: 0,
            positionKey: 'tc-a',
            positionEntry: makePosition('tc-a', 10),
            anchorTop: 10,
            anchorBottom: 30,
            top: 333,
            height: 222,
            isPrimary: true,
            isOffscreenReviewCard: false,
            mount: true,
          },
        ],
      },
    };
    const wrapper = await mountSidebar([{ id: 'tc-a', top: 10 }]);
    try {
      expect(wrapper.find('[data-comment-id="worker-instance"]').attributes('style')).toContain('top: 333px');
      expect(updateContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: expect.objectContaining({ width: 300 }), activeThreadId: null }),
        expect.any(Function),
      );
      commentsStore.editorCommentPositions = { 'tc-a': makePosition('tc-a', 900) };
      await settleLayout();
      expect(wrapper.find('[data-comment-id="worker-instance"]').attributes('style')).toContain('top: 333px');
    } finally {
      wrapper.unmount();
    }
  });

  it('publishes a current committed decision anchor before the native action handler', async () => {
    const updateContext = vi.fn();
    const rows = ['a', 'b', 'c'];
    const presentation = {
      coordinate: { documentEpoch: 'document', mountId: 'mount', commitSequence: 10, reviewVersion: 7 },
      readPaintOrigin: () => ({ left: 0, top: 0 }),
      rowVersions: { a: 1, b: 2, c: 3 },
      threads: {},
      groupOrder: { open: rows, resolved: [] },
      updateContext,
      instances: rows.map((id, index) => ({
        id: `instance-${id}`,
        rowId: id,
        threadId: id,
        version: index + 1,
        pageIndex: 0,
        positionKey: id,
        positionEntry: makePosition(id, 100 + index * 100),
        anchorTop: 100 + index * 100,
        anchorBottom: 120 + index * 100,
        top: 100 + index * 100,
        height: 90,
        isPrimary: true,
        isOffscreenReviewCard: false,
        mount: true,
      })),
    };
    commentsStore.committedReviewPresentations = { 'doc-1': presentation };
    const wrapper = await mountSidebar(rows.map((id, index) => ({ id, top: 100 + index * 100 })));
    try {
      const action = document.createElement('button');
      action.dataset.commentAction = 'reject';
      wrapper.get('[data-comment-instance-id="instance-b"]').element.appendChild(action);
      let captured;
      action.addEventListener('click', () => {
        captured = updateContext.mock.lastCall?.[0]?.decisionContinuity;
      });
      action.click();
      expect(captured).toEqual({
        ...presentation.coordinate,
        removedInstanceId: 'instance-b',
        removedRowVersion: 2,
        targetInstanceId: 'instance-c',
        targetRowVersion: 3,
        top: 300,
      });
      expect(() => structuredClone(updateContext.mock.lastCall[0])).not.toThrow();
      expect(readTranslateY(wrapper.get('.sidebar-container').element)).toBe(0);
      commentsStore.committedReviewPresentations = {
        'doc-1': {
          ...presentation,
          coordinate: { ...presentation.coordinate, commitSequence: 11, reviewVersion: 8 },
          instances: presentation.instances.filter((instance) => instance.rowId !== 'b'),
        },
      };
      await settleLayout();
      expect(updateContext.mock.lastCall[0].decisionContinuity).toEqual(captured);
      commentsStore.committedReviewPresentations = {
        'doc-1': { ...presentation, coordinate: { ...presentation.coordinate, mountId: 'replacement' } },
      };
      await settleLayout();
      expect(updateContext.mock.lastCall[0].decisionContinuity).toBeNull();
      commentsStore.committedReviewPresentations = { 'doc-1': presentation };
      await settleLayout();
      expect(updateContext.mock.lastCall[0].decisionContinuity).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });

  it('reports the attached paint origin when the contained document scrolls independently of its layers', async () => {
    let paintTop = -500;
    const updateContext = vi.fn();
    commentsStore.committedReviewPresentations = {
      'doc-1': {
        rowVersions: { 'tc-a': 1 },
        threads: {},
        groupOrder: { open: ['tc-a'], resolved: [] },
        instances: [],
        readPaintOrigin: () => ({ left: 44, top: paintTop }),
        updateContext,
      },
    };
    const wrapper = await mountSidebar([{ id: 'tc-a', top: 10 }]);
    try {
      const readViewport = updateContext.mock.lastCall[1];
      expect(readViewport).toEqual(expect.any(Function));
      expect(updateContext).toHaveBeenLastCalledWith(
        expect.objectContaining({
          viewport: expect.objectContaining({ stageOffsetX: 44, stageOffsetY: -500 }),
        }),
        readViewport,
      );
      paintTop = -650;
      expect(readViewport()).toEqual(expect.objectContaining({ stageOffsetX: 44, stageOffsetY: -650 }));
      expect(updateContext.mock.lastCall[0].viewport.stageOffsetY).toBe(-500);
      parent.dispatchEvent(new Event('scroll'));
      await settleLayout();
      expect(updateContext).toHaveBeenLastCalledWith(
        expect.objectContaining({
          viewport: expect.objectContaining({ stageOffsetX: 44, stageOffsetY: -650 }),
        }),
        readViewport,
      );
    } finally {
      wrapper.unmount();
    }
  });

  it.each([null, { left: 0, top: Number.NaN }])(
    'does not submit feedback from an unavailable paint origin: %j',
    async (origin) => {
      const updateContext = vi.fn();
      commentsStore.committedReviewPresentations = {
        'doc-1': {
          rowVersions: { 'tc-a': 1 },
          threads: {},
          groupOrder: { open: ['tc-a'], resolved: [] },
          instances: [],
          readPaintOrigin: () => origin,
          updateContext,
        },
      };
      const wrapper = await mountSidebar([{ id: 'tc-a', top: 10 }]);
      try {
        expect(updateContext).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    },
  );

  const activateAt = async (id, targetClientY) => {
    commentsStore.requestInstantSidebarAlignment(targetClientY, id, id);
    commentsStore.activeFloatingCommentInstanceId = id;
    commentsStore.activeComment = id;
    await settleLayout();
  };

  it.each([-6, 6])(
    'keeps committed offscreen cards at their worker positions after a %ipx alignment request',
    async (offset) => {
      const instance = (id, top, anchorTop, isOffscreenReviewCard) => ({
        id,
        rowId: id,
        threadId: id,
        version: 1,
        pageIndex: 0,
        positionKey: id,
        positionEntry: makePosition(id, anchorTop),
        anchorTop,
        anchorBottom: anchorTop + 20,
        top,
        height: 110,
        isPrimary: true,
        isOffscreenReviewCard,
        mount: true,
      });
      commentsStore.committedReviewPresentations = {
        'doc-1': {
          rowVersions: { 'tc-a': 1, 'tc-b': 1 },
          threads: {},
          groupOrder: { open: ['tc-a', 'tc-b'], resolved: [] },
          updateContext: vi.fn(),
          instances: [instance('tc-a', 333, 333, false), instance('tc-b', -111, -30, true)],
        },
      };
      const wrapper = await mountSidebar([
        { id: 'tc-a', top: 333 },
        { id: 'tc-b', top: -30 },
      ]);
      try {
        await activateAt('tc-a', 333 + offset);
        expect(readTranslateY(wrapper.get('.sidebar-container').element)).toBe(0);
        expect(wrapper.get('[data-comment-id="tc-a"]').element.getBoundingClientRect().top).toBe(333);
        const offscreen = wrapper.get('[data-comment-id="tc-b"]').element;
        expect(Number.parseFloat(offscreen.style.top)).toBe(-111);
        expect(offscreen.getBoundingClientRect().bottom).toBe(-1);
      } finally {
        wrapper.unmount();
      }
    },
  );

  const decideActiveChange = async (decision) => {
    const activeRow = commentsStore.getComment('tc-b');
    const trackedChangesAdapter = {
      documentId: 'doc-1',
      accept: vi.fn(async () => ({ ok: true, receipt: { success: true }, decidedId: 'tc-b', documentId: 'doc-1' })),
      reject: vi.fn(async () => ({ ok: true, receipt: { success: true }, decidedId: 'tc-b', documentId: 'doc-1' })),
      listTrackedChanges: vi.fn(async () => ({ ok: false, reason: 'test-background-reconcile-held' })),
      mapV2TrackedChangeToCommentParams: vi.fn(() => null),
      clearActiveTrackedChangeTargetIfMatches: vi.fn(),
    };
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        documentId: 'doc-1',
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
    };
    commentsStore.setV2TrackedChangesAdapter(trackedChangesAdapter);

    const result = await commentsStore.decideTrackedChangeFromSidebar({ superdoc, comment: activeRow, decision });
    await settleLayout();
    return { result, trackedChangesAdapter };
  };

  it('keeps geometry-free tracked changes logical-only until one is activated', async () => {
    commentsStore.commentsList = Array.from({ length: 81 }, (_, index) => makeTrackedChange(`term-change-${index}`));
    commentsStore.editorCommentPositions = {};

    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    try {
      await settleLayout();

      expect(commentsStore.commentsList).toHaveLength(81);
      expect(wrapper.findAll('[data-comment-id]')).toHaveLength(0);
    } finally {
      wrapper.unmount();
    }
  });

  it('mounts the first tracked-deletion dialog from RSID-only paint geometry', async () => {
    commentsStore.commentsList = [
      useComment({
        commentId: 'tc-canonical-delete',
        importedId: '2',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
        trackedChangeText: 'this is text',
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeCanonicalId: 'tc-canonical-delete',
        trackedChangeAnchorKey: 'tc::body::tc-canonical-delete',
        trackedChangePositionAliases: ['00000029'],
      }),
    ];
    commentsStore.editorCommentPositions = {
      '00000029': makePosition('00000029', 100),
    };

    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    try {
      await settleLayout();

      expect(commentsStore.getFloatingCommentInstances).toHaveLength(1);
      expect(wrapper.findAll('[data-comment-id]')).toHaveLength(1);
      expect(wrapper.findAll('.floating-comment')).toHaveLength(1);
    } finally {
      wrapper.unmount();
    }
  });

  it('mounts distinct tracked-change placeholders when canonical rows share a story-scoped RSID', async () => {
    commentsStore.commentsList = ['tc-canonical-first', 'tc-canonical-second'].map((commentId) =>
      useComment({
        commentId,
        importedId: commentId,
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
        trackedChangeText: commentId,
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeAnchorKey: `tc::body::${commentId}`,
        trackedChangePositionAliases: ['00000029'],
      }),
    );
    commentsStore.editorCommentPositions = {
      '00000029': makePosition('00000029', 100),
      'tc::body::00000029': makePosition('tc::body::00000029', 100),
    };

    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    try {
      await settleLayout();

      expect(commentsStore.getFloatingCommentInstances.map((instance) => instance.id)).toEqual([
        'tc-canonical-first',
        'tc-canonical-second',
      ]);
      expect(
        wrapper.findAll('[data-comment-instance-id]').map((item) => item.attributes('data-comment-instance-id')),
      ).toEqual(['tc-canonical-first', 'tc-canonical-second']);
    } finally {
      wrapper.unmount();
    }
  });

  it('does not let the review-card collision stack extend the document scroll extent (SD-3852)', async () => {
    const documentExtent = 41_016;
    const rowCount = 1_316;
    Object.defineProperty(parent, 'scrollHeight', {
      configurable: true,
      get: () => documentExtent,
    });
    commentsStore.commentsList = Array.from({ length: rowCount }, (_, index) =>
      makeTrackedChange(`sd3852-tc-${index}`),
    );
    // Page-window rendering only exposes geometry for mounted pages. The
    // logical review rows remain complete, so almost every row is temporarily
    // geometry-free in the real failure.
    commentsStore.editorCommentPositions = {};
    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    await settleLayout();

    try {
      const wrapperMinHeight = Number.parseFloat(wrapper.get('.section-wrapper').element.style.minHeight);
      expect(wrapperMinHeight).toBe(documentExtent);
    } finally {
      wrapper.unmount();
    }
  }, 10_000);

  it('materializes only visible geometry plus one active logical row from 1,316 changes', async () => {
    const rowCount = 1_316;
    commentsStore.commentsList = Array.from({ length: rowCount }, (_, index) =>
      makeTrackedChange(`bounded-tc-${index}`),
    );
    commentsStore.editorCommentPositions = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const id = `bounded-tc-${index}`;
        return [id, makePosition(id, 40 + index * 70)];
      }),
    );
    commentsStore.activeComment = 'bounded-tc-700';
    commentsStore.activeFloatingCommentInstanceId = 'bounded-tc-700';

    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    await settleLayout();

    try {
      expect(commentsStore.commentsList).toHaveLength(rowCount);
      expect(wrapper.findAll('[data-comment-id]')).toHaveLength(7);
      expect(wrapper.findAll('.floating-comment')).toHaveLength(7);
    } finally {
      wrapper.unmount();
    }
  }, 10_000);

  it('hydrates a geometry-free header/footer move row without replacing its logical identity', async () => {
    const canonicalId = 'tc|move|1%7C101';
    const rowId = `${canonicalId}::move-to`;
    const positionKey = `tc::hf:part:rId-footer::${canonicalId}`;
    commentsStore.commentsList = [
      useComment({
        commentId: rowId,
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
        trackedChangeText: 'moved destination',
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeLabel: 'Moved (insertion)',
        trackedChangeCanonicalId: canonicalId,
        trackedChangeAnchorKey: positionKey,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
        trackedChangeStoryKind: 'headerFooterPart',
        semanticColorKey: 'move-to',
      }),
    ];
    commentsStore.editorCommentPositions = {
      [positionKey]: {
        key: positionKey,
        threadId: canonicalId,
        kind: 'trackedChange',
        storyKey: 'headerFooterPart:rId-footer',
        rects: undefined,
      },
    };

    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: { CommentDialog: true },
      },
    });
    try {
      await settleLayout();

      const [geometryFreeInstance] = commentsStore.getFloatingCommentInstances;
      expect(geometryFreeInstance).toMatchObject({
        id: rowId,
        threadId: rowId,
        pageIndex: null,
        isPrimary: true,
      });
      expect(wrapper.findAll('[data-comment-id]')).toHaveLength(0);

      commentsStore.activeComment = rowId;
      commentsStore.activeFloatingCommentInstanceId = rowId;
      commentsStore.editorCommentPositions = {
        [positionKey]: {
          key: positionKey,
          threadId: canonicalId,
          kind: 'trackedChange',
          storyKey: 'headerFooterPart:rId-footer',
          pageIndex: 1,
          rects: [
            { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
            { pageIndex: 1, top: 120, left: 8, right: 72, bottom: 142 },
          ],
        },
      };
      await settleLayout();

      const hydratedInstances = commentsStore.getFloatingCommentInstances;
      expect(hydratedInstances).toHaveLength(2);
      expect(hydratedInstances.filter((instance) => instance.isPrimary)).toEqual([
        expect.objectContaining({ id: rowId, threadId: rowId, pageIndex: 1 }),
      ]);
      expect(new Set(hydratedInstances.map((instance) => instance.threadId))).toEqual(new Set([rowId]));
      expect(wrapper.findAll('[data-comment-id]')).toHaveLength(2);
      expect(commentsStore.activeComment).toBe(rowId);
      expect(commentsStore.activeFloatingCommentInstanceId).toBe(rowId);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['accept', 'reject'])(
    'keeps the next card stable after %s and later list reconciliation',
    async (decision) => {
      const wrapper = await mountSidebar([
        { id: 'tc-a', top: 100 },
        { id: 'tc-b', top: 200 },
        { id: 'tc-c', top: 300 },
      ]);

      try {
        await activateAt('tc-b', 150);
        const rail = wrapper.get('.sidebar-container').element;
        const nextCard = () => wrapper.get('[data-comment-id="tc-c"]').element;
        const nextCardTopBeforeDecision = nextCard().getBoundingClientRect().top;
        expect(readTranslateY(rail)).not.toBe(0);

        const { result, trackedChangesAdapter } = await decideActiveChange(decision);

        expect(result).toMatchObject({ ok: true, success: true });
        expect(trackedChangesAdapter[decision]).toHaveBeenCalledTimes(1);
        expect(commentsStore.activeComment).toBeNull();
        expect(wrapper.find('[data-comment-id="tc-b"]').exists()).toBe(false);
        expect(nextCard().getBoundingClientRect().top).toBeCloseTo(nextCardTopBeforeDecision, 5);
        expect(readTranslateY(rail)).not.toBe(0);

        const insertedRow = makeTrackedChange('tc-inserted');
        commentsStore.editorCommentPositions = {
          ...commentsStore.editorCommentPositions,
          'tc-inserted': makePosition('tc-inserted', 180),
        };
        commentsStore.commentsList = [commentsStore.getComment('tc-a'), insertedRow, commentsStore.getComment('tc-c')];
        await settleLayout();

        expect(nextCard().getBoundingClientRect().top).toBeCloseTo(nextCardTopBeforeDecision, 5);

        await activateAt('tc-c', 140);
        expect(nextCard().getBoundingClientRect().top).toBeCloseTo(140, 5);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each(['accept', 'reject'])('keeps the next card stable after a direct inactive-card %s', async (decision) => {
    const wrapper = await mountSidebar([
      { id: 'tc-a', top: 100 },
      { id: 'tc-b', top: 200 },
      { id: 'tc-c', top: 300 },
    ]);

    try {
      const decidedCard = wrapper.get('[data-comment-id="tc-b"]');
      const nextCard = () => wrapper.get('[data-comment-id="tc-c"]').element;
      const nextCardTopBeforeDecision = nextCard().getBoundingClientRect().top;
      const action = document.createElement('button');
      action.dataset.commentAction = decision === 'accept' ? 'resolve' : 'reject';
      decidedCard.element.appendChild(action);

      expect(commentsStore.activeComment).toBeNull();
      action.click();
      const { result, trackedChangesAdapter } = await decideActiveChange(decision);

      expect(result).toMatchObject({ ok: true, success: true });
      expect(trackedChangesAdapter[decision]).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-comment-id="tc-b"]').exists()).toBe(false);
      expect(nextCard().getBoundingClientRect().top).toBeCloseTo(nextCardTopBeforeDecision, 5);

      const insertedRow = makeTrackedChange('tc-inserted');
      commentsStore.editorCommentPositions = {
        ...commentsStore.editorCommentPositions,
        'tc-inserted': makePosition('tc-inserted', 180),
      };
      commentsStore.commentsList = [commentsStore.getComment('tc-a'), insertedRow, commentsStore.getComment('tc-c')];
      await settleLayout();

      expect(nextCard().getBoundingClientRect().top).toBeCloseTo(nextCardTopBeforeDecision, 5);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['accept', 'reject'])(
    'releases direct-decision continuity when the document owner scrolls after %s',
    async (decision) => {
      const outerScrollOwner = document.createElement('div');
      outerScrollOwner.style.overflowY = 'auto';
      outerScrollOwner.getBoundingClientRect = () => makeRect(0, 600);
      document.body.appendChild(outerScrollOwner);
      const wrapper = await mountSidebar(
        [
          { id: 'tc-a', top: 100 },
          { id: 'tc-b', top: 200 },
          { id: 'tc-c', top: 300 },
        ],
        { attachTo: outerScrollOwner },
      );

      try {
        const decidedCard = wrapper.get('[data-comment-id="tc-b"]');
        const nextCard = () => wrapper.get('[data-comment-id="tc-c"]').element;
        const action = document.createElement('button');
        action.dataset.commentAction = decision === 'accept' ? 'resolve' : 'reject';
        decidedCard.element.appendChild(action);

        action.click();
        const { result } = await decideActiveChange(decision);

        expect(result).toMatchObject({ ok: true, success: true });
        const rail = wrapper.get('.sidebar-container').element;
        expect(readTranslateY(rail)).not.toBe(0);

        outerScrollTop = 120;
        outerScrollOwner.dispatchEvent(new Event('scroll'));
        await settleLayout();

        expect(readTranslateY(rail)).toBe(0);
        expect(nextCard().getBoundingClientRect().top).toBeCloseTo(
          Number.parseFloat(nextCard().style.top) - outerScrollTop,
          5,
        );
      } finally {
        wrapper.unmount();
        outerScrollOwner.remove();
      }
    },
  );

  it('resets the translated rail for an ordinary deselection while the active row still exists', async () => {
    const wrapper = await mountSidebar([
      { id: 'tc-a', top: 100 },
      { id: 'tc-b', top: 200 },
      { id: 'tc-c', top: 300 },
    ]);

    try {
      await activateAt('tc-b', 150);
      const rail = wrapper.get('.sidebar-container').element;
      expect(readTranslateY(rail)).not.toBe(0);

      commentsStore.activeComment = null;
      commentsStore.activeFloatingCommentInstanceId = null;
      await settleLayout();

      expect(readTranslateY(rail)).toBe(0);
    } finally {
      wrapper.unmount();
    }
  });

  it('does not let restored offscreen review rows displace the first visible card', async () => {
    const viewportTop = 6_200;
    const offscreenPredecessors = Array.from({ length: 33 }, (_, index) => ({
      id: `offscreen-predecessor-${index}`,
      top: viewportTop - 600 + index * 18,
    }));
    const firstVisibleRow = { id: 'first-visible-row', top: viewportTop };

    // Reproduce the real windowed-scroll shape: the 600px overscan retains a
    // dense set of fully offscreen review anchors immediately before the first
    // viewport anchor.
    outerScrollTop = viewportTop;
    const baselineWrapper = await mountSidebar([firstVisibleRow]);
    let baselineTop;
    try {
      baselineTop = Number.parseFloat(
        baselineWrapper.get(`[data-comment-id="${firstVisibleRow.id}"]`).element.style.top,
      );
      expect(baselineTop).toBe(firstVisibleRow.top);
    } finally {
      baselineWrapper.unmount();
    }

    const wrapper = await mountSidebar([...offscreenPredecessors, firstVisibleRow]);

    try {
      expect(wrapper.findAll('.comment-placeholder')).toHaveLength(offscreenPredecessors.length + 1);

      // The existing offscreen-coupling requirement remains intact: the last
      // predecessor is restored above the viewport after collision layout.
      const lastOffscreenCard = wrapper.get(`[data-comment-id="${offscreenPredecessors.at(-1).id}"]`).element;
      expect(lastOffscreenCard.getBoundingClientRect().bottom).toBeLessThan(0);

      // Fully offscreen rows must not leave collision pressure behind after
      // they are restored. With no visible predecessor, this row owns its
      // canonical anchor at the top of the viewport.
      const firstVisibleCard = wrapper.get(`[data-comment-id="${firstVisibleRow.id}"]`).element;
      expect(Number.parseFloat(firstVisibleCard.style.top)).toBe(baselineTop);
      expect(firstVisibleCard.getBoundingClientRect().top).toBe(0);
    } finally {
      wrapper.unmount();
    }
  });

  it('moves an active card offscreen when its document anchor leaves the viewport', async () => {
    const wrapper = await mountSidebar([{ id: 'tc-a', top: 200 }]);

    try {
      await activateAt('tc-a', 200);
      const card = () => wrapper.get('[data-comment-id="tc-a"]').element;
      expect(card().getBoundingClientRect().top).toBeCloseTo(200, 5);

      commentsStore.editorCommentPositions = {
        'tc-a': makePosition('tc-a', -300),
      };
      parent.dispatchEvent(new Event('scroll'));
      await settleLayout();

      // Collision-floor normalization must not clamp the active review card
      // into view after the canonical document anchor has left the viewport.
      expect(card().getBoundingClientRect().bottom).toBeLessThan(0);

      commentsStore.editorCommentPositions = {
        'tc-a': makePosition('tc-a', 200),
      };
      parent.dispatchEvent(new Event('scroll'));
      await settleLayout();

      expect(card().getBoundingClientRect().top).toBeCloseTo(200, 5);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps a geometry-free active dialog in the viewport inside a deeply scrolled outer owner', async () => {
    outerScrollTop = 10_064;
    const staleEarlyRows = Array.from({ length: 40 }, (_, index) => ({
      id: `stale-${index}`,
      top: index * 20,
    }));
    commentsStore.commentsList = [
      ...staleEarlyRows.map(({ id }) => makeTrackedChange(id)),
      makeTrackedChange('tc-active'),
    ];
    commentsStore.editorCommentPositions = Object.fromEntries(
      staleEarlyRows.map(({ id, top }) => [id, makePosition(id, top)]),
    );
    const wrapper = mount(FloatingComments, {
      attachTo: document.body,
      props: {
        currentDocument: { id: 'doc-1', type: DOCX_TYPE },
        parent,
      },
      global: {
        stubs: {
          CommentDialog: {
            template:
              '<div class="comments-dialog is-active"><button data-comment-action="resolve">Accept</button></div>',
          },
        },
      },
    });

    try {
      await settleLayout();
      commentsStore.clearInstantSidebarAlignment();
      commentsStore.activeFloatingCommentInstanceId = null;
      commentsStore.activeComment = 'tc-active';
      await settleLayout();

      const action = () => wrapper.get('[data-comment-action="resolve"]').element;
      const bounds = action().getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    } finally {
      wrapper.unmount();
    }
  });

  it('falls back to the previous card when the removed active row was last', async () => {
    const wrapper = await mountSidebar([
      { id: 'tc-a', top: 100 },
      { id: 'tc-b', top: 200 },
    ]);

    try {
      await activateAt('tc-b', 150);
      const previousCard = () => wrapper.get('[data-comment-id="tc-a"]').element;
      const previousTop = previousCard().getBoundingClientRect().top;

      await decideActiveChange('accept');

      expect(previousCard().getBoundingClientRect().top).toBeCloseTo(previousTop, 5);
    } finally {
      wrapper.unmount();
    }
  });

  it('resets safely when the removed active row has no surviving neighbor', async () => {
    const wrapper = await mountSidebar([{ id: 'tc-b', top: 200 }]);

    try {
      await activateAt('tc-b', 150);
      const rail = wrapper.get('.sidebar-container').element;
      expect(readTranslateY(rail)).not.toBe(0);

      await decideActiveChange('reject');

      expect(wrapper.findAll('.comment-placeholder')).toHaveLength(0);
      expect(readTranslateY(rail)).toBe(0);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps an active card fixed when windowed geometry drops an offscreen predecessor', async () => {
    const wrapper = await mountSidebar(
      [
        { id: 'far-before', top: -4738 },
        { id: 'near-before', top: -1154 },
        { id: 'active', top: 416 },
      ],
      { tracked: false },
    );

    try {
      const activeCard = () => wrapper.get('[data-comment-id="active"]').element;
      await activateAt('active', 416);
      const activeTopBeforeWindowChange = activeCard().getBoundingClientRect().top;

      commentsStore.commentsList = [commentsStore.getComment('near-before'), commentsStore.getComment('active')];
      commentsStore.editorCommentPositions = {
        'near-before': makePosition('near-before', -1154),
        active: makePosition('active', 416),
      };
      await settleLayout();

      expect(activeCard().getBoundingClientRect().top).toBeCloseTo(activeTopBeforeWindowChange, 5);
    } finally {
      wrapper.unmount();
    }
  });

  it('does not let restored offscreen review rows displace the first visible card', async () => {
    const viewportTop = 6_200;
    const offscreenPredecessors = Array.from({ length: 33 }, (_, index) => ({
      id: `offscreen-predecessor-${index}`,
      top: viewportTop - 600 + index * 18,
    }));
    const firstVisibleRow = { id: 'first-visible-row', top: viewportTop };

    // Reproduce the real windowed-scroll shape: the 600px overscan retains a
    // dense set of fully offscreen review anchors immediately before the first
    // viewport anchor.
    outerScrollTop = viewportTop;
    const baselineWrapper = await mountSidebar([firstVisibleRow]);
    let baselineTop;
    try {
      baselineTop = Number.parseFloat(
        baselineWrapper.get(`[data-comment-id="${firstVisibleRow.id}"]`).element.style.top,
      );
      expect(baselineTop).toBe(firstVisibleRow.top);
    } finally {
      baselineWrapper.unmount();
    }

    const wrapper = await mountSidebar([...offscreenPredecessors, firstVisibleRow]);

    try {
      expect(wrapper.findAll('.comment-placeholder')).toHaveLength(offscreenPredecessors.length + 1);

      // The existing offscreen-coupling requirement remains intact: the last
      // predecessor is restored above the viewport after collision layout.
      const lastOffscreenCard = wrapper.get(`[data-comment-id="${offscreenPredecessors.at(-1).id}"]`).element;
      expect(lastOffscreenCard.getBoundingClientRect().bottom).toBeLessThan(0);

      // Fully offscreen rows must not leave collision pressure behind after
      // they are restored. With no visible predecessor, this row owns its
      // canonical anchor at the top of the viewport.
      const firstVisibleCard = wrapper.get(`[data-comment-id="${firstVisibleRow.id}"]`).element;
      expect(Number.parseFloat(firstVisibleCard.style.top)).toBe(baselineTop);
      expect(firstVisibleCard.getBoundingClientRect().top).toBe(0);
    } finally {
      wrapper.unmount();
    }
  });
});
