import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { ref, reactive, nextTick } from 'vue';

vi.mock('./superdoc-store.js', () => {
  const documents = ref([]);
  const user = reactive({ name: 'Alice', email: 'alice@example.com' });
  const activeSelection = reactive({ documentId: 'doc-1', selectionBounds: {} });
  const selectionPosition = reactive({ source: null });
  const getDocument = (id) => documents.value.find((doc) => doc.id === id);

  const useMockStore = defineStore('superdoc', () => ({
    documents,
    user,
    activeSelection,
    selectionPosition,
    getDocument,
  }));

  return {
    useSuperdocStore: useMockStore,
    __mockSuperdoc: {
      documents,
      user,
      activeSelection,
      selectionPosition,
      emit: vi.fn(),
      config: {
        isInternal: false,
      },
    },
  };
});

vi.mock('@superdoc/components/CommentsLayer/use-comment', () => {
  const mock = vi.fn((params = {}) => {
    const selection = params.selection || { source: 'mock', selectionBounds: {} };
    return {
      ...params,
      commentId: params.commentId ?? 'mock-id',
      selection,
      isInternal: params.isInternal ?? true,
      getValues: () => ({ ...params, commentId: params.commentId ?? 'mock-id', selection }),
      setText: vi.fn(),
    };
  });

  return {
    default: mock,
  };
});

vi.mock('../core/collaboration/helpers.js', () => ({
  syncCommentsToClients: vi.fn(),
}));

vi.mock('../helpers/group-changes.js', () => ({
  groupChanges: vi.fn(() => []),
}));

vi.mock('@superdoc/super-editor', async () => {
  const actual = await vi.importActual('@superdoc/super-editor');
  const getTrackedChangeIndex = vi.fn(() => ({
    get: vi.fn(() => []),
    getAll: vi.fn(() => []),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  }));
  const makeTrackedChangeAnchorKey = vi.fn(({ storyKey, rawId }) => `tc::${storyKey}::${rawId}`);

  return {
    Editor: class {
      getJSON() {
        return { content: [{}] };
      }
      getHTML() {
        return '<p></p>';
      }
      get state() {
        return {};
      }
      get view() {
        return { state: { tr: { setMeta: vi.fn() } }, dispatch: vi.fn() };
      }
    },
    trackChangesHelpers: {
      getTrackChanges: vi.fn(() => []),
      enumerateStructuralRowChanges: vi.fn(() => []),
    },
    createOrUpdateTrackedChangeComment: vi.fn(({ event, marks, documentId }) => {
      const changeId = marks?.insertedMark?.attrs?.id ?? marks?.deletionMark?.attrs?.id ?? marks?.formatMark?.attrs?.id;
      if (changeId == null) return;
      return {
        event,
        changeId,
        trackedChangeText: `tracked-${changeId}`,
        trackedChangeType: 'insert',
        deletedText: null,
        authorEmail: 'alice@example.com',
        author: 'Alice',
        date: 123,
        importedAuthor: null,
        documentId,
        coords: {},
      };
    }),
    resolveTrackedChangeInStory: vi.fn(() => null),
    TrackChangesBasePluginKey: 'TrackChangesBasePluginKey',
    CommentsPluginKey: 'CommentsPluginKey',
    getRichTextExtensions: vi.fn(() => []),
    getTrackedChangeIndex,
    makeTrackedChangeAnchorKey,
    shallowEqual: actual.shallowEqual,
  };
});

import { useCommentsStore } from './comments-store.js';
import { __mockSuperdoc } from './superdoc-store.js';
import { comments_module_events } from '@superdoc/common';
import useComment from '@superdoc/components/CommentsLayer/use-comment';
import { syncCommentsToClients } from '../core/collaboration/helpers.js';
import { groupChanges } from '../helpers/group-changes.js';
import {
  trackChangesHelpers,
  createOrUpdateTrackedChangeComment,
  getTrackedChangeIndex,
  makeTrackedChangeAnchorKey,
  resolveTrackedChangeInStory,
} from '@superdoc/super-editor';

const useCommentMock = useComment;
const syncCommentsToClientsMock = syncCommentsToClients;
const getTrackChangesMock = trackChangesHelpers.getTrackChanges;
const groupChangesMock = groupChanges;
const trackChangesHelpersMock = trackChangesHelpers;
const createOrUpdateTrackedChangeCommentMock = createOrUpdateTrackedChangeComment;
const getTrackedChangeIndexMock = getTrackedChangeIndex;
const makeTrackedChangeAnchorKeyMock = makeTrackedChangeAnchorKey;
const resolveTrackedChangeInStoryMock = resolveTrackedChangeInStory;

describe('comments-store', () => {
  let store;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setActivePinia(createPinia());
    store = useCommentsStore();
    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
    Object.assign(__mockSuperdoc.activeSelection, {
      documentId: 'doc-1',
      source: 'super-editor',
      selectionBounds: {},
    });
    groupChangesMock.mockReturnValue([]);
    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    trackChangesHelpersMock.enumerateStructuralRowChanges?.mockReturnValue([]);
    createOrUpdateTrackedChangeCommentMock.mockImplementation(({ event, marks, documentId }) => {
      const changeId = marks?.insertedMark?.attrs?.id ?? marks?.deletionMark?.attrs?.id ?? marks?.formatMark?.attrs?.id;
      if (changeId == null) return;
      return {
        event,
        changeId,
        trackedChangeText: `tracked-${changeId}`,
        trackedChangeType: 'insert',
        deletedText: null,
        authorEmail: 'alice@example.com',
        author: 'Alice',
        date: 123,
        importedAuthor: null,
        documentId,
        coords: {},
      };
    });
    resolveTrackedChangeInStoryMock.mockReturnValue(null);
    getTrackedChangeIndexMock.mockReturnValue({
      get: vi.fn(() => []),
      getAll: vi.fn(() => []),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    makeTrackedChangeAnchorKeyMock.mockImplementation(({ storyKey, rawId }) => `tc::${storyKey}::${rawId}`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes config and maps initial comments', () => {
    const initialComment = { commentId: 'c-1', text: 'Hello' };

    store.init({
      readOnly: true,
      allowResolve: false,
      comments: [initialComment],
    });

    expect(store.getConfig.readOnly).toBe(true);
    expect(store.getConfig.allowResolve).toBe(false);
    expect(store.commentsList.length).toBe(1);
    expect(useCommentMock).toHaveBeenCalledWith(initialComment);
  });

  it('returns comments by id or imported id', () => {
    const comment = { commentId: 'c-2', importedId: 'import-2' };
    store.commentsList = [comment];

    expect(store.getComment('c-2')).toEqual(comment);
    expect(store.getComment('import-2')).toEqual(comment);
    expect(store.getComment(null)).toBeNull();
    expect(store.getComment(undefined)).toBeNull();
  });

  it('resolves rendered tracked-change aliases by equivalent position', () => {
    const canonicalAnchorKey = 'tc::hf:part:rId8::word:trackInsert:101';
    const renderedAnchorKey = 'tc::hf:part:rId8::rendered-uuid';
    const comment = {
      commentId: 'word:trackInsert:101',
      trackedChange: true,
      trackedChangeAnchorKey: canonicalAnchorKey,
    };
    store.commentsList = [comment];
    store.editorCommentPositions = {
      [canonicalAnchorKey]: {
        key: canonicalAnchorKey,
        threadId: 'word:trackInsert:101',
        kind: 'trackedChange',
        storyKey: 'hf:part:rId8',
        bounds: { top: 49, left: 199, bottom: 69, right: 267, width: 68, height: 20 },
      },
      [renderedAnchorKey]: {
        key: renderedAnchorKey,
        threadId: 'rendered-uuid',
        kind: 'trackedChange',
        storyKey: 'hf:part:rId8',
        bounds: { top: 47, left: 188, bottom: 69, right: 300, width: 112, height: 22 },
      },
    };

    expect(store.getComment('rendered-uuid')).toEqual(comment);
  });

  it('prefers tracked-change anchor keys for position lookup and alias resolution', () => {
    const comment = {
      commentId: 'tc-1',
      importedId: 'import-1',
      trackedChange: true,
      trackedChangeAnchorKey: 'tc::body::tc-1',
    };
    store.commentsList = [comment];
    store.editorCommentPositions = {
      'tc::body::tc-1': { start: 10, end: 12 },
    };

    expect(store.getCommentPositionKey('tc-1')).toBe('tc::body::tc-1');
    expect(store.getCommentPositionKey(comment)).toBe('tc::body::tc-1');
    expect(store.getCommentAliasIds('tc-1')).toEqual(expect.arrayContaining(['tc-1', 'import-1', 'tc::body::tc-1']));

    store.editorCommentPositions = {};
    expect(store.getCommentPositionKey('tc-1')).toBe('tc::body::tc-1');
    expect(store.getCommentPositionKey(comment)).toBe('tc::body::tc-1');
  });

  it('sets active comment and updates the editor', () => {
    const setActiveCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          setActiveComment: setActiveCommentSpy,
        },
      },
    };

    const comment = { commentId: 'comment-1' };
    store.commentsList = [comment];

    store.setActiveComment(superdoc, 'comment-1');
    expect(store.activeComment).toBe('comment-1');
    expect(setActiveCommentSpy).toHaveBeenCalledWith({ commentId: 'comment-1' });

    store.setActiveComment(superdoc, null);
    expect(store.activeComment).toBeNull();
    expect(setActiveCommentSpy).toHaveBeenCalledWith({ commentId: null });
  });

  describe('showAddComment pendingSelection (IT-1113)', () => {
    const makePendingSuperdoc = (
      selectionInfo,
      {
        activeSelection = { documentId: 'doc-1', source: 'super-editor', selectionBounds: {} },
        editorDocumentId = 'doc-1',
      } = {},
    ) => {
      const insertComment = vi.fn();
      const current = vi.fn(() => selectionInfo);
      Object.assign(__mockSuperdoc.activeSelection, activeSelection);
      return {
        superdoc: {
          emit: vi.fn(),
          config: { isInternal: false },
          activeEditor: {
            options: { documentId: editorDocumentId },
            doc: { selection: { current } },
            commands: { insertComment },
          },
        },
        insertComment,
        current,
      };
    };

    it('emits the pre-mutation Document API selection snapshot on the pending event', () => {
      const selectionInfo = {
        empty: false,
        target: { kind: 'text', segments: [{ blockId: 'b1', range: { start: 0, end: 5 } }] },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
      };
      const { superdoc, current } = makePendingSuperdoc(selectionInfo);

      store.showAddComment(superdoc);

      expect(current).toHaveBeenCalledWith();
      expect(superdoc.emit).toHaveBeenCalledWith('comments-update', {
        type: comments_module_events.PENDING,
        pendingSelection: selectionInfo,
      });
    });

    it('emits the pending event before inserting the pending mark', () => {
      const { superdoc, insertComment } = makePendingSuperdoc({
        empty: false,
        target: { kind: 'text', segments: [{ blockId: 'b1', range: { start: 0, end: 1 } }] },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
      });

      store.showAddComment(superdoc);

      // The snapshot is taken (and emitted) before the pending mark is
      // inserted — otherwise the captured target could shift.
      expect(insertComment).toHaveBeenCalled();
      expect(superdoc.emit.mock.invocationCallOrder[0]).toBeLessThan(insertComment.mock.invocationCallOrder[0]);
    });

    it('carries a null-target snapshot when the selection has no addressable target', () => {
      const selectionInfo = { empty: true, target: null, activeMarks: [], activeCommentIds: [], activeChangeIds: [] };
      const { superdoc } = makePendingSuperdoc(selectionInfo);

      store.showAddComment(superdoc);

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toEqual(selectionInfo);
      expect(payload.pendingSelection.target).toBeNull();
    });

    it('emits pendingSelection null for a PDF selection even when a DOCX editor is active', () => {
      const { superdoc, current } = makePendingSuperdoc(
        {
          empty: false,
          target: { kind: 'text', segments: [{ blockId: 'docx-block', range: { start: 0, end: 4 } }] },
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
        },
        { activeSelection: { documentId: 'pdf-1', source: 'pdf', selectionBounds: {} } },
      );

      store.showAddComment(superdoc);

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toBeNull();
      expect(current).not.toHaveBeenCalled();
    });

    it('emits pendingSelection null when the active editor belongs to a different document', () => {
      const { superdoc, current } = makePendingSuperdoc(
        {
          empty: false,
          target: { kind: 'text', segments: [{ blockId: 'doc-1-block', range: { start: 0, end: 4 } }] },
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
        },
        {
          activeSelection: { documentId: 'doc-2', source: 'super-editor', selectionBounds: {} },
          editorDocumentId: 'doc-1',
        },
      );

      store.showAddComment(superdoc);

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toBeNull();
      expect(current).not.toHaveBeenCalled();
    });

    it('emits pendingSelection null when the active editor has no document id', () => {
      const { superdoc, current } = makePendingSuperdoc(
        {
          empty: false,
          target: { kind: 'text', segments: [{ blockId: 'doc-1-block', range: { start: 0, end: 4 } }] },
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
        },
        { editorDocumentId: null },
      );

      store.showAddComment(superdoc);

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toBeNull();
      expect(current).not.toHaveBeenCalled();
    });

    it('emits pendingSelection null when the editor doc getter throws', () => {
      const insertComment = vi.fn();
      const superdoc = {
        emit: vi.fn(),
        config: { isInternal: false },
        activeEditor: {
          options: { documentId: 'doc-1' },
          commands: { insertComment },
          get doc() {
            throw new Error('not ready');
          },
        },
      };

      expect(() => store.showAddComment(superdoc)).not.toThrow();

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toBeNull();
      expect(insertComment).toHaveBeenCalled();
    });

    it('emits pendingSelection null when there is no active editor', () => {
      const superdoc = { emit: vi.fn(), config: { isInternal: false }, activeEditor: undefined };

      store.showAddComment(superdoc);

      const [, payload] = superdoc.emit.mock.calls[0];
      expect(payload.type).toBe(comments_module_events.PENDING);
      expect(payload.pendingSelection).toBeNull();
    });
  });

  it('preserves the active floating instance when it belongs to the activated thread', () => {
    const setActiveCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          setActiveComment: setActiveCommentSpy,
        },
      },
    };
    const anchorKey = 'tc::hf:part:rId-footer::change-repeat';

    store.commentsList = [
      {
        commentId: 'change-repeat',
        trackedChange: true,
        trackedChangeAnchorKey: anchorKey,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
        selection: { source: 'super-editor', selectionBounds: {} },
      },
    ];
    store.editorCommentPositions = {
      [anchorKey]: {
        pageIndex: 2,
        bounds: { top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 64, bottom: 44, width: 52, height: 24 },
          { pageIndex: 1, top: 140, left: 12, right: 64, bottom: 164, width: 52, height: 24 },
          { pageIndex: 2, top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        ],
      },
    };
    store.activeFloatingCommentInstanceId = `${anchorKey}::page:2`;

    store.setActiveComment(superdoc, 'change-repeat');

    expect(store.activeFloatingCommentInstanceId).toBe(`${anchorKey}::page:2`);
    expect(setActiveCommentSpy).toHaveBeenCalledWith({ commentId: 'change-repeat' });
  });

  it('clears stale floating instances when activating a different thread', () => {
    const setActiveCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          setActiveComment: setActiveCommentSpy,
        },
      },
    };
    const anchorKey = 'tc::hf:part:rId-footer::change-repeat';

    store.commentsList = [
      {
        commentId: 'change-repeat',
        trackedChange: true,
        trackedChangeAnchorKey: anchorKey,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
        selection: { source: 'super-editor', selectionBounds: {} },
      },
      {
        commentId: 'comment-2',
        trackedChange: false,
        selection: { source: 'pdf', selectionBounds: {} },
      },
    ];
    store.editorCommentPositions = {
      [anchorKey]: {
        pageIndex: 2,
        bounds: { top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 64, bottom: 44, width: 52, height: 24 },
          { pageIndex: 1, top: 140, left: 12, right: 64, bottom: 164, width: 52, height: 24 },
          { pageIndex: 2, top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        ],
      },
    };
    store.activeFloatingCommentInstanceId = `${anchorKey}::page:2`;

    store.setActiveComment(superdoc, 'comment-2');

    expect(store.activeFloatingCommentInstanceId).toBeNull();
    expect(setActiveCommentSpy).toHaveBeenCalledWith({ commentId: 'comment-2' });
  });

  it('tracks instant sidebar alignment by thread and instance id', () => {
    store.requestInstantSidebarAlignment(144, 'thread-1');
    expect(store.peekInstantSidebarAlignment()).toBe(144);
    expect(store.instantSidebarAlignmentThreadId).toBe('thread-1');
    expect(store.instantSidebarAlignmentInstanceId).toBe('thread-1');

    store.requestInstantSidebarAlignment(188, 'thread-1', 'thread-1::page:2');
    expect(store.peekInstantSidebarAlignment()).toBe(188);
    expect(store.instantSidebarAlignmentThreadId).toBe('thread-1');
    expect(store.instantSidebarAlignmentInstanceId).toBe('thread-1::page:2');

    store.requestInstantSidebarAlignment(null, 'thread-1', 'thread-1::page:2');
    expect(store.peekInstantSidebarAlignment()).toBeNull();
    expect(store.instantSidebarAlignmentThreadId).toBeNull();
    expect(store.instantSidebarAlignmentInstanceId).toBeNull();

    store.requestInstantSidebarAlignment(199, 'thread-2', 'thread-2::page:1');
    store.clearInstantSidebarAlignment();
    expect(store.peekInstantSidebarAlignment()).toBeNull();
    expect(store.instantSidebarAlignmentThreadId).toBeNull();
    expect(store.instantSidebarAlignmentInstanceId).toBeNull();
  });

  it('does not throw when superdoc is unavailable during active comment updates', () => {
    const comment = { commentId: 'comment-2' };
    store.commentsList = [comment];

    expect(() => store.setActiveComment(undefined, 'comment-2')).not.toThrow();
    expect(store.activeComment).toBe('comment-2');

    expect(() => store.setActiveComment(undefined, null)).not.toThrow();
    expect(store.activeComment).toBeNull();
  });

  it('keeps the current active thread when removePendingComment is used for edit cleanup', () => {
    const removeCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          removeComment: removeCommentSpy,
        },
      },
    };

    store.activeComment = 'comment-2';
    store.pendingComment = null;
    store.currentCommentText = '<p>Draft</p>';

    store.removePendingComment(superdoc);

    expect(store.activeComment).toBe('comment-2');
    expect(store.currentCommentText).toBe('');
    expect(removeCommentSpy).toHaveBeenCalledWith({ commentId: 'pending' });
  });

  it('clears the active thread when an actual pending comment is removed', () => {
    const removeCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          removeComment: removeCommentSpy,
        },
      },
    };

    store.activeComment = 'pending-thread';
    store.pendingComment = { commentId: 'pending' };

    store.removePendingComment(superdoc);

    expect(store.activeComment).toBeNull();
    expect(store.pendingComment).toBeNull();
    expect(removeCommentSpy).toHaveBeenCalledWith({ commentId: 'pending' });
  });

  it('still syncs editor active comment when store was pre-updated by caller', () => {
    const setActiveCommentSpy = vi.fn();
    const superdoc = {
      activeEditor: {
        commands: {
          setActiveComment: setActiveCommentSpy,
        },
      },
    };

    store.commentsList = [{ commentId: 'comment-3' }];

    // Simulate UI flow that pre-updates store state before syncing editor/plugin state.
    store.setActiveComment(undefined, 'comment-3');
    expect(store.activeComment).toBe('comment-3');

    store.setActiveComment(superdoc, 'comment-3');

    expect(setActiveCommentSpy).toHaveBeenCalledTimes(1);
    expect(setActiveCommentSpy).toHaveBeenCalledWith({ commentId: 'comment-3' });
  });

  it('keeps tracked-change identity lookup current after alias changes and list reordering', () => {
    store.commentsList = [
      { commentId: 'first', importedId: 'shared', trackedChange: true, fileId: 'doc-1', trackedChangeText: 'First' },
      { commentId: 'second', importedId: 'shared', trackedChange: true, fileId: 'doc-1', trackedChangeText: 'Second' },
    ];
    const update = (changeId, text) =>
      store.handleTrackedChangeUpdate({
        superdoc: {},
        broadcastChanges: false,
        params: {
          event: 'update',
          changeId,
          documentId: 'doc-1',
          trackedChangeText: text,
          trackedChangeStoryKind: 'body',
          trackedChangeAnchorKey: null,
        },
      });
    update('shared', 'First refreshed');
    expect(store.commentsList.map((c) => c.trackedChangeText)).toEqual(['First refreshed', 'Second']);
    store.commentsList.reverse();
    update('shared', 'Second refreshed');
    expect(store.commentsList.map((c) => c.trackedChangeText)).toEqual(['Second refreshed', 'First refreshed']);
    store.commentsList[0].importedId = 'new-alias';
    update('new-alias', 'Alias refreshed');
    update('shared', 'Remaining alias');
    expect(store.commentsList.map((c) => c.trackedChangeText)).toEqual(['Alias refreshed', 'Remaining alias']);
  });

  it('preserves first occurrence when the same comment object appears twice in an identity lookup', () => {
    const first = {
      commentId: 'first',
      importedId: 'shared',
      trackedChange: true,
      fileId: 'doc-1',
      trackedChangeText: 'First',
    };
    store.commentsList = [
      first,
      { commentId: 'second', importedId: 'shared', trackedChange: true, fileId: 'doc-1', trackedChangeText: 'Second' },
      first,
    ];
    store.handleTrackedChangeUpdate({
      superdoc: {},
      broadcastChanges: false,
      params: {
        event: 'update',
        changeId: 'shared',
        documentId: 'doc-1',
        trackedChangeText: 'Refreshed',
        trackedChangeStoryKind: 'body',
        trackedChangeAnchorKey: null,
      },
    });
    expect(store.commentsList.map((c) => c.trackedChangeText)).toEqual(['Refreshed', 'Second', 'Refreshed']);
  });

  it('updates tracked change comments and emits events', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-1',
      trackedChangeText: 'old',
      trackedChangeType: 'both',
      deletedText: 'removed earlier',
      getValues: vi.fn(() => ({ commentId: 'change-1' })),
    };

    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'change-1',
        trackedChangeText: 'new text',
        trackedChangeType: 'insert',
        deletedText: 'removed',
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.trackedChangeText).toBe('new text');
    expect(existingComment.trackedChangeType).toBe('insert');
    expect(existingComment.deletedText).toBe('removed');
    expect(syncCommentsToClientsMock).toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: { commentId: 'change-1' },
      }),
    );

    expect(superdoc.emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: { commentId: 'change-1' },
      }),
    );

    // SD-673: pin the exact key set of the comments-update payload.
    // SuperDocCommentsUpdatePayload declares { type, comment?, changes? };
    // the objectContaining assertion above would not catch a regression
    // to the older { data: ... } shape or an extra field leaking in.
    const [, payload] = superdoc.emit.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['comment', 'type']);
    expect(typeof payload.type).toBe('string');
    expect(payload.comment).toEqual({ commentId: 'change-1' });
  });

  it('reopens resolved tracked change comments on update events', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-reopen-update',
      trackedChangeText: 'old',
      trackedChangeType: 'both',
      deletedText: 'removed earlier',
      resolvedTime: 123,
      resolvedByEmail: 'old@example.com',
      resolvedByName: 'Old Reviewer',
      getValues: vi.fn(() => ({ commentId: 'change-reopen-update' })),
    };

    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'change-reopen-update',
        trackedChangeText: 'new text',
        trackedChangeType: 'insert',
        deletedText: null,
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.resolvedTime).toBeNull();
    expect(existingComment.resolvedByEmail).toBeNull();
    expect(existingComment.resolvedByName).toBeNull();
  });

  it('preserves hyperlink-specific tracked-change display metadata on updates', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-link-1',
      trackedChangeText: 'underline',
      trackedChangeType: 'trackFormat',
      trackedChangeDisplayType: null,
      deletedText: null,
      getValues: vi.fn(() => ({ commentId: 'change-link-1' })),
    };

    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'change-link-1',
        trackedChangeText: 'https://example.com',
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'hyperlinkAdded',
        deletedText: null,
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.trackedChangeText).toBe('https://example.com');
    expect(existingComment.trackedChangeType).toBe('trackFormat');
    expect(existingComment.trackedChangeDisplayType).toBe('hyperlinkAdded');
  });

  it('clears stale tracked-change metadata when an update removes one side of a replacement', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-clear-1',
      trackedChangeText: 'replacement',
      trackedChangeType: 'both',
      deletedText: 'original',
      getValues: vi.fn(() => ({ commentId: 'change-clear-1' })),
    };

    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'change-clear-1',
        trackedChangeText: 'remaining insert',
        trackedChangeType: 'insert',
        deletedText: null,
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.trackedChangeText).toBe('remaining insert');
    expect(existingComment.trackedChangeType).toBe('insert');
    expect(existingComment.deletedText).toBeNull();
  });

  it('resolves tracked change comments on resolve events', () => {
    const superdoc = {
      emit: vi.fn(),
      user: { id: 'reviewer-id', email: 'reviewer@example.com', name: 'Reviewer' },
    };

    const existingComment = {
      commentId: 'change-resolve-1',
      trackedChange: true,
      resolvedTime: null,
      resolvedByEmail: null,
      resolvedByName: null,
      getValues: vi.fn(() => ({ commentId: 'change-resolve-1', resolvedTime: Date.now() })),
      resolveComment: vi.fn(function ({ id, email, name }) {
        this.resolvedTime = Date.now();
        this.resolvedById = id;
        this.resolvedByEmail = email;
        this.resolvedByName = name;
        const emitData = { type: comments_module_events.RESOLVED, comment: this.getValues() };
        syncCommentsToClientsMock(superdoc, emitData);
        superdoc.emit('comments-update', emitData);
      }),
    };
    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'resolve',
        changeId: 'change-resolve-1',
      },
    });

    expect(existingComment.resolveComment).toHaveBeenCalledWith({
      id: 'reviewer-id',
      email: 'reviewer@example.com',
      name: 'Reviewer',
      decision: null,
      superdoc,
    });
    expect(existingComment.resolvedTime).not.toBeNull();
    expect(existingComment.resolvedByEmail).toBe('reviewer@example.com');
    expect(existingComment.resolvedByName).toBe('Reviewer');
    expect(syncCommentsToClientsMock).toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({ type: comments_module_events.RESOLVED }),
    );
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({ type: comments_module_events.RESOLVED }),
    );
  });

  it('restores standard comment resolved metadata when redo returns resolved anchor nodes', () => {
    const comment = {
      commentId: 'root-comment',
      importedId: 'imported-root',
      resolvedTime: 12345,
      resolvedById: 'reviewer-id',
      resolvedByEmail: 'reviewer@example.com',
      resolvedByName: 'Reviewer',
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [comment];

    const makeEditor = (nodes) => ({
      state: {
        doc: {
          descendants(callback) {
            nodes.forEach((node, index) => callback(node, index));
          },
        },
      },
      options: { documentId: 'doc-1' },
    });

    const liveMarkEditor = makeEditor([
      {
        type: { name: 'text' },
        marks: [{ type: { name: 'commentMark' }, attrs: { commentId: 'root-comment', importedId: 'imported-root' } }],
      },
    ]);
    store.syncResolvedCommentsWithDocument({ editor: liveMarkEditor });

    expect(comment.resolvedTime).toBeNull();
    expect(comment.resolvedById).toBeNull();
    expect(comment.resolvedByEmail).toBeNull();
    expect(comment.resolvedByName).toBeNull();

    const resolvedAnchorEditor = makeEditor([
      { type: { name: 'commentRangeStart' }, attrs: { 'w:id': 'root-comment' }, marks: [] },
      { type: { name: 'commentRangeEnd' }, attrs: { 'w:id': 'root-comment' }, marks: [] },
    ]);
    store.syncResolvedCommentsWithDocument({ editor: resolvedAnchorEditor });

    expect(comment.resolvedTime).toBe(12345);
    expect(comment.resolvedById).toBe('reviewer-id');
    expect(comment.resolvedByEmail).toBe('reviewer@example.com');
    expect(comment.resolvedByName).toBe('Reviewer');
  });

  it('does not blanket-cascade linked user comments on tracked-change resolve events', async () => {
    const superdoc = {
      emit: vi.fn(),
      user: { id: 'reviewer-id', email: 'reviewer@example.com', name: 'Reviewer' },
    };

    const trackedChangeComment = {
      commentId: 'tc-1',
      trackedChange: true,
      resolvedTime: null,
      getValues: vi.fn(() => ({ commentId: 'tc-1' })),
      resolveComment: vi.fn(function () {
        this.resolvedTime = Date.now();
      }),
    };

    const linkedUserComment = {
      commentId: 'user-comment-1',
      trackedChange: false,
      trackedChangeParentId: 'tc-1',
      resolvedTime: null,
      getValues: vi.fn(() => ({ commentId: 'user-comment-1' })),
      resolveComment: vi.fn(function () {
        this.resolvedTime = Date.now();
      }),
    };

    const unrelatedUserComment = {
      commentId: 'user-comment-2',
      trackedChange: false,
      trackedChangeParentId: 'tc-99',
      resolvedTime: null,
      getValues: vi.fn(() => ({ commentId: 'user-comment-2' })),
      resolveComment: vi.fn(),
    };

    store.commentsList = [trackedChangeComment, linkedUserComment, unrelatedUserComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: { event: 'resolve', changeId: 'tc-1' },
    });

    expect(trackedChangeComment.resolveComment).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(linkedUserComment.resolveComment).not.toHaveBeenCalled();
    expect(unrelatedUserComment.resolveComment).not.toHaveBeenCalled();
  });

  it('does not cascade linked comments even when tracked-change resolve carries a documentId', async () => {
    const superdoc = { emit: vi.fn(), user: { email: 'reviewer@example.com', name: 'Reviewer' } };
    __mockSuperdoc.documents.value = [
      { id: 'doc-A', type: 'docx' },
      { id: 'doc-B', type: 'docx' },
    ];

    const trackedChangeOnDocA = {
      commentId: 'tc-shared',
      trackedChange: true,
      resolvedTime: null,
      fileId: 'doc-A',
      trackedChangeAnchorKey: 'tc::body::tc-shared',
      getValues: vi.fn(() => ({ commentId: 'tc-shared' })),
      resolveComment: vi.fn(function () {
        this.resolvedTime = Date.now();
      }),
    };
    const linkedOnDocA = {
      commentId: 'user-on-A',
      trackedChange: false,
      trackedChangeParentId: 'tc-shared',
      resolvedTime: null,
      fileId: 'doc-A',
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(),
    };
    const linkedOnDocB = {
      commentId: 'user-on-B',
      trackedChange: false,
      trackedChangeParentId: 'tc-shared',
      resolvedTime: null,
      fileId: 'doc-B',
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(),
    };

    store.commentsList = [trackedChangeOnDocA, linkedOnDocA, linkedOnDocB];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: { event: 'resolve', changeId: 'tc-shared', documentId: 'doc-A' },
    });

    await Promise.resolve();
    expect(linkedOnDocA.resolveComment).not.toHaveBeenCalled();
    expect(linkedOnDocB.resolveComment).not.toHaveBeenCalled();
  });

  it('does not cascade linked comments in single-document resolve flows either', async () => {
    const superdoc = { emit: vi.fn(), user: { email: 'r@e', name: 'R' } };

    const trackedChangeComment = {
      commentId: 'tc-nodoc',
      trackedChange: true,
      resolvedTime: null,
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(function () {
        this.resolvedTime = Date.now();
      }),
    };
    const linkedNoFileId = {
      commentId: 'user-nodoc',
      trackedChange: false,
      trackedChangeParentId: 'tc-nodoc',
      resolvedTime: null,
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(),
    };

    store.commentsList = [trackedChangeComment, linkedNoFileId];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: { event: 'resolve', changeId: 'tc-nodoc' },
    });

    await Promise.resolve();
    expect(linkedNoFileId.resolveComment).not.toHaveBeenCalled();
  });

  it('does not re-resolve already-resolved linked user comments', async () => {
    const superdoc = { emit: vi.fn(), user: { email: 'a@a', name: 'A' } };

    const trackedChangeComment = {
      commentId: 'tc-2',
      trackedChange: true,
      resolvedTime: null,
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(function () {
        this.resolvedTime = Date.now();
      }),
    };

    const alreadyResolvedLinked = {
      commentId: 'user-2',
      trackedChange: false,
      trackedChangeParentId: 'tc-2',
      resolvedTime: 1234,
      getValues: vi.fn(() => ({})),
      resolveComment: vi.fn(),
    };

    store.commentsList = [trackedChangeComment, alreadyResolvedLinked];

    store.handleTrackedChangeUpdate({ superdoc, params: { event: 'resolve', changeId: 'tc-2' } });

    await Promise.resolve();
    expect(alreadyResolvedLinked.resolveComment).not.toHaveBeenCalled();
  });

  it('syncs and emits an update when add event dedupes an existing tracked change', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-1',
      trackedChangeText: 'old',
      deletedText: '',
      getValues: vi.fn(() => ({ commentId: 'change-1', trackedChangeText: 'new text', deletedText: 'removed' })),
    };

    store.commentsList = [existingComment];
    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'add',
        changeId: 'change-1',
        trackedChangeText: 'new text',
        trackedChangeType: 'insert',
        deletedText: 'removed',
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.trackedChangeText).toBe('new text');
    expect(existingComment.deletedText).toBe('removed');
    expect(syncCommentsToClientsMock).toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: { commentId: 'change-1', trackedChangeText: 'new text', deletedText: 'removed' },
      }),
    );

    expect(superdoc.emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: { commentId: 'change-1', trackedChangeText: 'new text', deletedText: 'removed' },
      }),
    );
  });

  it('reopens resolved tracked change comments when add event dedupes an existing thread', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'change-reopen-add',
      trackedChangeText: 'old',
      trackedChangeType: 'both',
      deletedText: 'removed earlier',
      resolvedTime: 456,
      resolvedByEmail: 'old@example.com',
      resolvedByName: 'Old Reviewer',
      getValues: vi.fn(() => ({ commentId: 'change-reopen-add' })),
    };

    store.commentsList = [existingComment];
    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'add',
        changeId: 'change-reopen-add',
        trackedChangeText: 'new text',
        trackedChangeType: 'insert',
        deletedText: null,
        authorEmail: 'user@example.com',
        author: 'User',
        date: 123,
        importedAuthor: null,
        documentId: 'doc-1',
        coords: {},
      },
    });

    expect(existingComment.resolvedTime).toBeNull();
    expect(existingComment.resolvedByEmail).toBeNull();
    expect(existingComment.resolvedByName).toBeNull();
  });

  it('creates tracked-change comments with super-editor source', () => {
    const superdoc = {
      emit: vi.fn(),
      config: { isInternal: false },
    };

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'add',
        changeId: 'change-add-1',
        trackedChangeText: 'Inserted text',
        trackedChangeType: 'trackInsert',
        trackedChangeDisplayType: 'hyperlinkAdded',
        authorEmail: 'user@example.com',
        author: 'User',
        date: Date.now(),
        importedAuthor: null,
        documentId: 'doc-1',
        coords: { top: 10, left: 10, right: 20, bottom: 20 },
      },
    });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].selection.source).toBe('super-editor');
    expect(store.commentsList[0].trackedChangeDisplayType).toBe('hyperlinkAdded');
  });

  it('applies story tracked-change metadata to created tracked-change comments', () => {
    const superdoc = {
      emit: vi.fn(),
      config: { isInternal: false },
    };

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'add',
        changeId: 'story-change-1',
        trackedChangeText: 'Inserted text',
        trackedChangeType: 'trackInsert',
        authorEmail: 'user@example.com',
        author: 'User',
        date: Date.now(),
        importedAuthor: null,
        documentId: 'doc-1',
        coords: { top: 10, left: 10, right: 20, bottom: 20 },
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId1' },
        trackedChangeStoryKind: 'headerFooter',
        trackedChangeStoryLabel: 'Header',
        trackedChangeAnchorKey: 'tc::hf:part:rId1::story-change-1',
      },
    });

    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'story-change-1',
        trackedChangeStoryKind: 'headerFooter',
        trackedChangeStoryLabel: 'Header',
        trackedChangeAnchorKey: 'tc::hf:part:rId1::story-change-1',
      }),
    ]);
    expect(store.getCommentAliasIds('story-change-1')).toEqual(
      expect.arrayContaining(['story-change-1', 'tc::hf:part:rId1::story-change-1']),
    );
  });

  it('applies story tracked-change label and anchor metadata when updating an existing thread', () => {
    const superdoc = {
      emit: vi.fn(),
    };

    const existingComment = {
      commentId: 'story-change-2',
      trackedChange: true,
      trackedChangeText: 'Old text',
      trackedChangeType: 'trackInsert',
      deletedText: null,
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'story-change-2' })),
    };

    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'story-change-2',
        trackedChangeText: 'Updated text',
        trackedChangeType: 'trackInsert',
        authorEmail: 'user@example.com',
        author: 'User',
        date: Date.now(),
        importedAuthor: null,
        documentId: 'doc-1',
        coords: { top: 10, left: 10, right: 20, bottom: 20 },
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId2' },
        trackedChangeStoryKind: 'headerFooter',
        trackedChangeStoryLabel: 'Footer',
        trackedChangeAnchorKey: 'tc::hf:part:rId2::story-change-2',
      },
    });

    expect(existingComment).toEqual(
      expect.objectContaining({
        trackedChangeText: 'Updated text',
        trackedChangeStoryKind: 'headerFooter',
        trackedChangeStoryLabel: 'Footer',
        trackedChangeAnchorKey: 'tc::hf:part:rId2::story-change-2',
      }),
    );
  });

  it('clears stale tracked-change positions when editor sends empty positions', async () => {
    const trackedComment = {
      commentId: 'change-1',
      fileId: 'doc-1',
      trackedChange: true,
      resolvedTime: null,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment];
    store.editorCommentPositions = {
      'change-1': { start: 1, end: 10, bounds: { top: 0, left: 0 } },
    };

    store.handleEditorLocationsUpdate({});
    await nextTick();

    expect(store.editorCommentPositions).toEqual({});
    expect(store.getFloatingComments).toEqual([]);
  });

  it('updates tracked-change positions with the latest editor payload', async () => {
    const trackedComment = {
      commentId: 'change-2',
      fileId: 'doc-1',
      trackedChange: true,
      resolvedTime: null,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment];
    store.editorCommentPositions = {
      'change-2': { start: 1, end: 3, bounds: { top: 0, left: 0 } },
    };

    const nextPositions = {
      'change-2': { start: 5, end: 8, bounds: { top: 12, left: 34 } },
    };

    store.handleEditorLocationsUpdate(nextPositions);
    await nextTick();

    expect(store.editorCommentPositions).toEqual(nextPositions);
    expect(store.getFloatingComments).toHaveLength(1);
  });

  it('keeps imported comments with both ids visible when the live anchor uses importedId', () => {
    store.commentsList = [
      {
        commentId: 'comment-2a',
        importedId: 'import-2a',
        fileId: 'doc-1',
        resolvedTime: null,
        selection: { source: 'super-editor', selectionBounds: {} },
      },
    ];
    store.editorCommentPositions = {
      'import-2a': { start: 5, end: 8, bounds: { top: 10, left: 20 } },
    };

    expect(store.getFloatingComments).toEqual([
      expect.objectContaining({ commentId: 'comment-2a', importedId: 'import-2a' }),
    ]);
  });

  it('fans repeated header/footer tracked changes into one floating bubble instance per page', () => {
    const anchorKey = 'tc::hf:part:rId-footer::change-repeat';
    store.commentsList = [
      {
        commentId: 'change-repeat',
        fileId: 'doc-1',
        trackedChange: true,
        trackedChangeAnchorKey: anchorKey,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
        resolvedTime: null,
        selection: { source: 'super-editor', selectionBounds: {} },
      },
    ];
    store.editorCommentPositions = {
      [anchorKey]: {
        key: anchorKey,
        threadId: 'change-repeat',
        storyKey: 'hf:part:rId-footer',
        kind: 'trackedChange',
        pageIndex: 2,
        bounds: { top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 64, bottom: 44, width: 52, height: 24 },
          { pageIndex: 1, top: 140, left: 12, right: 64, bottom: 164, width: 52, height: 24 },
          { pageIndex: 2, top: 300, left: 12, right: 64, bottom: 324, width: 52, height: 24 },
        ],
      },
    };

    expect(store.getFloatingComments).toHaveLength(1);
    expect(store.getFloatingCommentInstances).toEqual([
      expect.objectContaining({
        id: `${anchorKey}::page:0`,
        threadId: 'change-repeat',
        pageIndex: 0,
        isPrimary: false,
      }),
      expect.objectContaining({
        id: `${anchorKey}::page:1`,
        threadId: 'change-repeat',
        pageIndex: 1,
        isPrimary: false,
      }),
      expect.objectContaining({
        id: `${anchorKey}::page:2`,
        threadId: 'change-repeat',
        pageIndex: 2,
        isPrimary: true,
      }),
    ]);
  });

  it('removes stale tracked-change anchors when tracked marks no longer exist', () => {
    const trackedComment = {
      commentId: 'change-3',
      fileId: 'doc-1',
      trackedChange: true,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    const regularComment = {
      commentId: 'comment-1',
      fileId: 'doc-1',
      trackedChange: false,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment, regularComment];
    store.editorCommentPositions = {
      'change-3': { start: 1, end: 5 },
      'comment-1': { start: 10, end: 15 },
    };

    getTrackChangesMock.mockReturnValueOnce([]);
    const removedCount = store.syncTrackedChangePositionsWithDocument({
      documentId: 'doc-1',
      editor: { state: { doc: {} } },
    });

    expect(removedCount).toBe(1);
    expect(store.editorCommentPositions).toEqual({
      'comment-1': { start: 10, end: 15 },
    });
    expect(store.commentsList).toEqual([trackedComment, regularComment]);
  });

  it('clears active tracked-change thread when stale root uses importedId position key', () => {
    const trackedComment = {
      commentId: 'change-5',
      importedId: 'import-change-5',
      fileId: 'doc-1',
      trackedChange: true,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment];
    store.editorCommentPositions = {
      'import-change-5': { start: 1, end: 5 },
    };
    store.activeComment = 'change-5';

    getTrackChangesMock.mockReturnValueOnce([]);
    const removedCount = store.syncTrackedChangePositionsWithDocument({
      documentId: 'doc-1',
      editor: { state: { doc: {} } },
    });

    expect(removedCount).toBe(1);
    expect(store.editorCommentPositions).toEqual({});
    expect(store.activeComment).toBeNull();
  });

  it('removes stale tracked-change anchor when live position key is commentId', () => {
    const trackedComment = {
      commentId: 'change-5b',
      importedId: 'import-change-5b',
      fileId: 'doc-1',
      trackedChange: true,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment];
    store.editorCommentPositions = {
      'change-5b': { start: 1, end: 5 },
    };
    store.activeComment = 'change-5b';

    getTrackChangesMock.mockReturnValueOnce([]);
    const removedCount = store.syncTrackedChangePositionsWithDocument({
      documentId: 'doc-1',
      editor: { state: { doc: {} } },
    });

    expect(removedCount).toBe(1);
    expect(store.editorCommentPositions).toEqual({});
    expect(store.activeComment).toBeNull();
  });

  it('removes child anchors when stale importedId root is referenced by commentId', () => {
    const trackedComment = {
      commentId: 'change-6',
      importedId: 'import-change-6',
      fileId: 'doc-1',
      trackedChange: true,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    const replyComment = {
      commentId: 'reply-1',
      parentCommentId: 'change-6',
      fileId: 'doc-1',
      trackedChange: false,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment, replyComment];
    store.editorCommentPositions = {
      'import-change-6': { start: 1, end: 5 },
      'reply-1': { start: 6, end: 9 },
    };

    getTrackChangesMock.mockReturnValueOnce([]);
    const removedCount = store.syncTrackedChangePositionsWithDocument({
      documentId: 'doc-1',
      editor: { state: { doc: {} } },
    });

    expect(removedCount).toBe(2);
    expect(store.editorCommentPositions).toEqual({});
  });

  it('keeps tracked-change anchors when tracked marks still exist', () => {
    const trackedComment = {
      commentId: 'change-4',
      fileId: 'doc-1',
      trackedChange: true,
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    store.commentsList = [trackedComment];
    store.editorCommentPositions = {
      'change-4': { start: 5, end: 9 },
    };

    getTrackChangesMock.mockReturnValueOnce([
      {
        mark: { attrs: { id: 'change-4' } },
        from: 5,
        to: 9,
      },
    ]);
    const removedCount = store.syncTrackedChangePositionsWithDocument({
      documentId: 'doc-1',
      editor: { state: { doc: {} } },
    });

    expect(removedCount).toBe(0);
    expect(store.editorCommentPositions).toEqual({
      'change-4': { start: 5, end: 9 },
    });
  });

  it('prunes stale tracked-change comments and descendants during replay sync', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    groupChangesMock.mockReturnValue([]);

    store.commentsList = [
      { commentId: 'tc-stale', trackedChange: true, fileId: 'doc-1' },
      { commentId: 'tc-reply', parentCommentId: 'tc-stale', fileId: 'doc-1' },
      { commentId: 'tc-import-reply', trackedChangeParentId: 'tc-stale', fileId: 'doc-1' },
      { commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' },
    ];
    store.activeComment = 'tc-reply';

    store.syncTrackedChangeComments({ superdoc: {}, editor });

    expect(store.commentsList).toEqual([{ commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' }]);
    expect(store.activeComment).toBeNull();
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  describe('structural (whole-table) tracked-change bubbles', () => {
    const makeEditor = () => {
      const editorDispatch = vi.fn();
      const tr = { setMeta: vi.fn() };
      return {
        state: {},
        view: { state: { tr }, dispatch: editorDispatch },
        options: { documentId: 'doc-1' },
      };
    };

    it('creates a structural bubble entry with the public id and display type for a decidable whole-table insert', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
      groupChangesMock.mockReturnValue([]);
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'logical-uuid-1',
          revisionId: 'rev-1',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 10,
          tableTo: 40,
          tablePos: 10,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 11, to: 20, pos: 11, node: {} }],
          author: 'Alice',
          authorEmail: 'alice@example.com',
          authorImage: '',
          date: '2024-01-01',
          importedAuthor: '',
          sourceId: '7',
          revisionGroupId: 'rg-1',
        },
      ]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      const bubble = store.commentsList.find((c) => c.trackedChange && c.commentId === 'word:structural:7');
      expect(bubble).toBeTruthy();
      expect(bubble.commentId).toBe('word:structural:7');
      expect(bubble.trackedChangeDisplayType).toBe('tableInsert');
      expect(bubble.trackedChangeType).toBe('trackInsert');
      expect(bubble.trackedChangeAnchorKey).toBe('tc::body::word:structural:7');
      expect(bubble.trackedChangeStory).toEqual({ kind: 'story', storyType: 'body' });
    });

    it('uses table-delete display type and falls back to the logical id when there is no source id', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'logical-uuid-2',
          side: 'deletion',
          subtype: 'table-delete',
          tableFrom: 5,
          tableTo: 30,
          tablePos: 5,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 6, to: 15, pos: 6, node: {} }],
          author: 'Bob',
          authorEmail: 'bob@example.com',
          date: '2024-02-02',
          sourceId: '',
        },
      ]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      const bubble = store.commentsList.find((c) => c.trackedChange && c.commentId === 'logical-uuid-2');
      expect(bubble).toBeTruthy();
      expect(bubble.trackedChangeDisplayType).toBe('tableDelete');
      expect(bubble.trackedChangeType).toBe('trackDelete');
    });

    it('does not create a bubble for non-decidable (partial/mixed) structural changes', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'logical-uuid-3',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 1,
          tableTo: 20,
          tablePos: 1,
          wholeTable: false,
          decidable: false,
          undecidableReason: 'partial-rows',
          rows: [{ from: 2, to: 10, pos: 2, node: {} }],
          author: 'Carol',
          authorEmail: 'carol@example.com',
          date: '2024-03-03',
          sourceId: '9',
        },
      ]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      expect(store.commentsList.find((c) => c.trackedChange)).toBeUndefined();
    });

    it('routes accept/reject through trackChanges.decide with the structural public id', () => {
      const decide = vi.fn(() => ({ success: true }));
      const superdoc = {
        activeEditor: {
          doc: { trackChanges: { decide } },
        },
      };
      const comment = {
        trackedChange: true,
        commentId: 'word:structural:7',
        trackedChangeStory: { kind: 'story', storyType: 'body' },
        trackedChangeAnchorKey: 'tc::body::word:structural:7',
      };

      const result = store.decideTrackedChangeFromSidebar({ superdoc, comment, decision: 'accept' });

      expect(result.ok).toBe(true);
      expect(decide).toHaveBeenCalledWith({
        decision: 'accept',
        target: { id: 'word:structural:7', story: { kind: 'story', storyType: 'body' } },
      });
    });

    // The "Added table" structural bubble must appear on initial
    // import, not only after a later transaction triggers the full
    // syncTrackedChangeComments path. The bootstrap that runs after import
    // (bootstrapImportedTrackedChangeComments, fired via setTimeout(0)) must
    // create structural bubbles alongside the inline/story ones.
    it('creates the structural bubble during the initial import bootstrap so it shows on first render', async () => {
      const editorDispatch = vi.fn();
      const tr = { setMeta: vi.fn() };
      const editor = {
        state: {},
        view: { state: { tr }, dispatch: editorDispatch },
        options: { documentId: 'doc-1' },
      };

      // No inline tracked changes; only a decidable whole-table insert.
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
      groupChangesMock.mockReturnValue([]);
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'logical-uuid-init',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 10,
          tableTo: 40,
          tablePos: 10,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 11, to: 20, pos: 11, node: {} }],
          author: 'Alice',
          authorEmail: 'alice@example.com',
          date: '2024-01-01',
          sourceId: '7',
        },
      ]);

      // Initial layout emits the structural anchor position before/independent
      // of comment creation; the store stores it keyed by anchorKey.
      store.editorCommentPositions = {
        'word:structural:7': { start: 10, end: 40, bounds: { top: 0, left: 0 } },
      };

      store.processLoadedDocxComments({
        superdoc: __mockSuperdoc,
        editor,
        comments: [],
        documentId: 'doc-1',
      });

      // Flush the setTimeout(0) bootstrap that runs after import.
      vi.runAllTimers();
      await nextTick();

      const bubble = store.commentsList.find((c) => c.trackedChange && c.commentId === 'word:structural:7');
      expect(bubble, 'structural bubble created during initial import bootstrap').toBeTruthy();
      expect(bubble.trackedChangeDisplayType).toBe('tableInsert');

      // It must also survive the getFloatingComments filter (has a resolved
      // position) — i.e., it would actually render on first paint.
      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toContain('word:structural:7');
    });
  });

  // An inline tracked change whose document range is INSIDE a
  // decidable whole-table structural change must NOT become a separate review
  // item. Suppression happens at the SOURCE (createCommentForTrackChanges): no
  // comment object is created/kept, so there is no floating bubble AND no
  // active-on-click dialog (the active-comment path looks the comment up by id;
  // with no comment object there is nothing to activate). The underlying
  // trackInsert/trackDelete mark is left untouched. Accept/reject of the single
  // structural bubble cascades to the cell text via the decision engine
  // (range-containment in [tableFrom, tableTo]) — proven in super-editor's
  // structural-decisions.test.js for both imported and authored tables.
  describe('suppresses inline tracked-change review items inside a tracked whole-table change', () => {
    const makeEditor = () => {
      const editorDispatch = vi.fn();
      const tr = { setMeta: vi.fn() };
      const state = { doc: {} };
      const editor = {
        state,
        view: { state: { tr }, dispatch: editorDispatch },
        options: { documentId: 'doc-1' },
      };
      // Wire the mock document so the floating filter resolves the same state.
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editor }];
      return editor;
    };

    // Shape an inline tracked-change mark + its grouped projection.
    const inlineInsert = ({ id, from, to }) => {
      const mark = { type: { name: 'trackInsert' }, attrs: { id } };
      const raw = { mark, node: {}, from, to };
      return { raw, grouped: { from, to, insertedMark: raw } };
    };

    it('does not rediscover inline marks when no whole-table change can own the review item', () => {
      const editor = makeEditor();
      const superdoc = { activeEditor: editor, emit: vi.fn(), config: { isInternal: true } };
      store.handleTrackedChangeUpdate({
        superdoc,
        params: { event: 'add', changeId: 'inline-only', documentId: 'doc-1', trackedChangeText: 'Text' },
      });
      expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['inline-only']);
      expect(trackChangesHelpersMock.getTrackChanges).not.toHaveBeenCalled();
    });

    it('uses current table containment when a supplied inline snapshot belongs to an older state', () => {
      const editor = makeEditor();
      const superdoc = { activeEditor: editor, emit: vi.fn(), config: { isInternal: true } };
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'table-insert',
          decidable: true,
          wholeTable: true,
          tableFrom: 10,
          tableTo: 40,
          rows: [],
        },
      ]);
      const oldRange = inlineInsert({ id: 'moved-inline', from: 1, to: 2 }).raw;
      const currentRange = inlineInsert({ id: 'moved-inline', from: 20, to: 21 }).raw;
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([currentRange]);
      store.handleTrackedChangeUpdate({
        superdoc,
        params: { event: 'add', changeId: 'moved-inline', documentId: 'doc-1', trackedChangeText: 'Text' },
        trackedChangesForId: [oldRange],
        trackedChangeState: { doc: {} },
      });
      expect(store.commentsList).toHaveLength(0);
      expect(trackChangesHelpersMock.getTrackChanges).toHaveBeenCalledWith(editor.state, 'moved-inline');
    });

    it('reuses current inline ranges to suppress table-owned changes during a full refresh', () => {
      const editor = makeEditor();
      const superdoc = { activeEditor: editor, emit: vi.fn(), config: { isInternal: true } };
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'table-insert',
          decidable: true,
          wholeTable: true,
          tableFrom: 10,
          tableTo: 40,
          rows: [],
        },
      ]);
      store.handleTrackedChangeUpdate({
        superdoc,
        params: { event: 'add', changeId: 'inline-cell', documentId: 'doc-1', trackedChangeText: 'Text' },
        trackedChangesForId: [inlineInsert({ id: 'inline-cell', from: 20, to: 21 }).raw],
        trackedChangeState: editor.state,
      });
      expect(store.commentsList).toHaveLength(0);
      expect(trackChangesHelpersMock.getTrackChanges).not.toHaveBeenCalled();
    });

    it('creates ONLY the structural bubble — no separate item for cell text inside a tracked inserted table', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // Authored (native) table: NO sourceId → publicId falls back to table:pos:side.
      const structural = {
        id: 'table:10:insertion',
        side: 'insertion',
        subtype: 'table-insert',
        tableFrom: 10,
        tableTo: 40,
        tablePos: 10,
        wholeTable: true,
        decidable: true,
        rows: [{ from: 11, to: 38, pos: 11, node: {} }],
        author: 'Alice',
        authorEmail: 'alice@example.com',
        date: '2024-01-01',
        sourceId: '',
      };
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([structural]);

      // Inline typed char inside a cell, range [20, 21] ⊂ [10, 40].
      const cellChar = inlineInsert({ id: 'inline-cell-1', from: 20, to: 21 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([cellChar.raw]);
      groupChangesMock.mockReturnValue([cellChar.grouped]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      const trackedItems = store.commentsList.filter((c) => c.trackedChange);
      // Exactly ONE tracked-change review item: the structural table bubble.
      expect(trackedItems.map((c) => c.commentId)).toEqual(['table:10:insertion']);
      expect(trackedItems[0].trackedChangeDisplayType).toBe('tableInsert');
      // No separate item for the inline cell char (suppressed at the source).
      expect(store.commentsList.find((c) => c.commentId === 'inline-cell-1')).toBeUndefined();

      // The floating list (belt-and-suspenders) also shows only the structural one.
      store.editorCommentPositions = {
        'table:10:insertion': { start: 10, end: 40, bounds: { top: 0, left: 0 } },
      };
      expect(store.getFloatingComments.map((c) => c.commentId)).toEqual(['table:10:insertion']);
    });

    it('prunes an inline comment created on a prior sync once its table becomes/stays tracked (idempotent)', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // Seed an inline tracked-change comment as if a prior sync (before the
      // whole-table change existed) had created it.
      store.commentsList = [
        {
          commentId: 'inline-cell-1',
          fileId: 'doc-1',
          documentId: 'doc-1',
          trackedChange: true,
          trackedChangeStory: { kind: 'story', storyType: 'body' },
          trackedChangeAnchorKey: 'tc::body::inline-cell-1',
          resolvedTime: null,
          createdTime: 1,
          selection: { source: 'super-editor' },
        },
      ];

      const structural = {
        id: 'table:10:insertion',
        side: 'insertion',
        subtype: 'table-insert',
        tableFrom: 10,
        tableTo: 40,
        tablePos: 10,
        wholeTable: true,
        decidable: true,
        rows: [{ from: 11, to: 38, pos: 11, node: {} }],
        author: 'Alice',
        authorEmail: 'alice@example.com',
        date: '2024-01-01',
        sourceId: '',
      };
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([structural]);
      const cellChar = inlineInsert({ id: 'inline-cell-1', from: 20, to: 21 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([cellChar.raw]);
      groupChangesMock.mockReturnValue([cellChar.grouped]);

      store.syncTrackedChangeComments({ superdoc, editor });

      // Inline comment pruned; only the structural bubble remains.
      expect(store.commentsList.find((c) => c.commentId === 'inline-cell-1')).toBeUndefined();
      expect(store.commentsList.filter((c) => c.trackedChange).map((c) => c.commentId)).toEqual(['table:10:insertion']);

      // Re-running the sync is a no-op (idempotent) — still exactly one item.
      store.syncTrackedChangeComments({ superdoc, editor });
      expect(store.commentsList.filter((c) => c.trackedChange).map((c) => c.commentId)).toEqual(['table:10:insertion']);
    });

    it('clears the active comment if it pointed at a now-suppressed inline change', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      store.commentsList = [
        {
          commentId: 'inline-cell-1',
          fileId: 'doc-1',
          documentId: 'doc-1',
          trackedChange: true,
          trackedChangeStory: { kind: 'story', storyType: 'body' },
          trackedChangeAnchorKey: 'tc::body::inline-cell-1',
          resolvedTime: null,
          createdTime: 1,
          selection: { source: 'super-editor' },
        },
      ];
      store.activeComment = 'inline-cell-1';

      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'table:10:insertion',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 10,
          tableTo: 40,
          tablePos: 10,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 11, to: 38, pos: 11, node: {} }],
          author: 'Alice',
          authorEmail: 'alice@example.com',
          date: '2024-01-01',
          sourceId: '',
        },
      ]);
      const cellChar = inlineInsert({ id: 'inline-cell-1', from: 20, to: 21 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([cellChar.raw]);
      groupChangesMock.mockReturnValue([cellChar.grouped]);

      store.syncTrackedChangeComments({ superdoc, editor });

      expect(store.activeComment).toBeNull();
    });

    it('NEGATIVE: inline tracked change OUTSIDE any table still gets its own review item', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // A tracked inserted table at [10,40]; the inline change is at [50,55] (outside).
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'table:10:insertion',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 10,
          tableTo: 40,
          tablePos: 10,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 11, to: 38, pos: 11, node: {} }],
          author: 'Alice',
          authorEmail: 'alice@example.com',
          date: '2024-01-01',
          sourceId: '',
        },
      ]);
      const outside = inlineInsert({ id: 'inline-outside', from: 50, to: 55 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([outside.raw]);
      groupChangesMock.mockReturnValue([outside.grouped]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      expect(store.commentsList.find((c) => c.commentId === 'inline-outside')).toBeTruthy();
    });

    it('NEGATIVE: a tracked text edit inside a NON-tracked table still gets its own review item', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // The table is NOT tracked → no decidable whole-table change → no suppression.
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([]);
      const inCell = inlineInsert({ id: 'inline-plain-table', from: 20, to: 25 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([inCell.raw]);
      groupChangesMock.mockReturnValue([inCell.grouped]);

      store.commentsList = [];
      store.syncTrackedChangeComments({ superdoc, editor });

      expect(store.commentsList.find((c) => c.commentId === 'inline-plain-table')).toBeTruthy();
    });

    it('NEGATIVE: a real user comment inside a tracked table is NOT suppressed', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // Seed a real user comment whose range falls inside the tracked table.
      store.commentsList = [
        {
          commentId: 'user-comment-1',
          fileId: 'doc-1',
          documentId: 'doc-1',
          trackedChange: false,
          resolvedTime: null,
          createdTime: 1,
          selection: { source: 'super-editor' },
        },
      ];

      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        {
          id: 'table:10:insertion',
          side: 'insertion',
          subtype: 'table-insert',
          tableFrom: 10,
          tableTo: 40,
          tablePos: 10,
          wholeTable: true,
          decidable: true,
          rows: [{ from: 11, to: 38, pos: 11, node: {} }],
          author: 'Alice',
          authorEmail: 'alice@example.com',
          date: '2024-01-01',
          sourceId: '',
        },
      ]);
      // No inline tracked changes.
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
      groupChangesMock.mockReturnValue([]);

      store.syncTrackedChangeComments({ superdoc, editor });

      expect(store.commentsList.find((c) => c.commentId === 'user-comment-1')).toBeTruthy();
      store.editorCommentPositions = {
        'user-comment-1': { start: 20, end: 22, bounds: { top: 0, left: 0 } },
        'table:10:insertion': { start: 10, end: 40, bounds: { top: 0, left: 0 } },
      };
      // Real user comment still floats (only inline TRACKED changes are coalesced).
      expect(store.getFloatingComments.map((c) => c.commentId).sort()).toEqual([
        'table:10:insertion',
        'user-comment-1',
      ]);
    });

    it('fails closed when structural enumeration throws (bootstrap-safety): no crash, no structural bubble, inline change still surfaces', () => {
      const editor = makeEditor();
      const superdoc = { emit: vi.fn(), config: { isInternal: true } };

      // enumerateStructuralRowChanges throwing must be swallowed by BOTH the
      // structural sync and the table-summary suppression guard (the inline
      // change is routed through handleTrackedChangeUpdate, which consults the
      // summary). The store should degrade to "no structural data", not throw.
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockImplementation(() => {
        throw new Error('enumerate boom');
      });
      const cellChar = inlineInsert({ id: 'inline-when-enum-throws', from: 20, to: 21 });
      trackChangesHelpersMock.getTrackChanges.mockReturnValue([cellChar.raw]);
      groupChangesMock.mockReturnValue([cellChar.grouped]);

      store.commentsList = [];
      expect(() => store.syncTrackedChangeComments({ superdoc, editor })).not.toThrow();

      // No structural bubble (enumeration yielded nothing), and the inline change
      // is NOT suppressed (the summary failed closed to empty ranges/ids).
      expect(store.commentsList.find((c) => c.trackedChangeDisplayType === 'tableInsert')).toBeUndefined();
      expect(store.commentsList.find((c) => c.commentId === 'inline-when-enum-throws')).toBeTruthy();
    });
  });

  it('emits deleted events when replay sync prunes stale tracked-change comments', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      emit: vi.fn(),
      isCollaborative: true,
      config: {
        modules: { comments: true },
        user: { name: 'Alice', email: 'alice@example.com' },
      },
      ydoc: { getArray: vi.fn() },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    groupChangesMock.mockReturnValue([]);

    const trackedComment = {
      commentId: 'tc-stale',
      trackedChange: true,
      fileId: 'doc-1',
      getValues: vi.fn(() => ({
        commentId: 'tc-stale',
        trackedChange: true,
        fileId: 'doc-1',
      })),
    };

    store.commentsList = [trackedComment];

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(syncCommentsToClientsMock).toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({
        type: comments_module_events.DELETED,
        comment: expect.objectContaining({ commentId: 'tc-stale' }),
      }),
    );
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: comments_module_events.DELETED,
        comment: expect.objectContaining({ commentId: 'tc-stale' }),
      }),
    );

    // SD-673: pin the DELETED variant of SuperDocCommentsUpdatePayload.
    // This emit path produces the three-key shape { type, comment, changes }
    // (changes carries the [{ key: 'deleted', commentId, fileId }] tuple).
    // The objectContaining assertion above does not require `changes` to be
    // present, so a regression that dropped it would not be caught.
    const deletedCall = superdoc.emit.mock.calls.find(
      ([name, payload]) => name === 'comments-update' && payload?.type === comments_module_events.DELETED,
    );
    expect(deletedCall).toBeDefined();
    const [, deletedPayload] = deletedCall;
    expect(Object.keys(deletedPayload).sort()).toEqual(['changes', 'comment', 'type']);
    expect(Array.isArray(deletedPayload.changes)).toBe(true);
    expect(deletedPayload.changes[0]).toMatchObject({ key: 'deleted' });
  });

  it('keeps tracked-change comments whose IDs are still present in marks', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-live' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-live' } } } }]);

    store.commentsList = [
      { commentId: 'tc-live', trackedChange: true, trackedChangeText: 'Existing', fileId: 'doc-1' },
      { commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' },
    ];

    store.syncTrackedChangeComments({ superdoc: {}, editor });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'tc-live',
        trackedChange: true,
        trackedChangeText: 'tracked-tc-live',
        trackedChangeType: 'insert',
      }),
      expect.objectContaining({ commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' }),
    ]);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('refreshes tracked-change text from the document during replay sync', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const superdoc = { emit: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-live' } }, from: 0, to: 4 }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-live' } } } }]);

    const existingComment = {
      commentId: 'tc-live',
      trackedChange: true,
      trackedChangeText: 'Old text',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-live' })),
    };

    store.commentsList = [existingComment];

    store.syncTrackedChangeComments({ superdoc, editor });

    const createCall = createOrUpdateTrackedChangeCommentMock.mock.calls[0]?.[0];
    expect(createCall?.event).toBe('update');
    expect(existingComment.trackedChangeText).toBe('tracked-tc-live');
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('refreshes only requested tracked-change comments by id', () => {
    const superdoc = { emit: vi.fn() };
    const editor = { state: {}, options: { documentId: 'doc-1' } };
    const mark = (type, id) => ({ type: { name: type }, attrs: { id } });
    const trackedChangesById = {
      'tc-insert': [{ mark: mark('trackInsert', 'tc-insert'), from: 1, to: 4 }],
      'tc-replacement': [
        { mark: mark('trackInsert', 'tc-replacement'), from: 5, to: 8 },
        { mark: mark('trackDelete', 'tc-replacement'), from: 9, to: 12 },
      ],
      'tc-delete': [{ mark: mark('trackDelete', 'tc-delete'), from: 13, to: 16 }],
    };

    trackChangesHelpersMock.getTrackChanges.mockImplementation((state, id) => trackedChangesById[id] ?? []);

    createOrUpdateTrackedChangeCommentMock.mockImplementation(({ event, marks, trackedChangesForId }) => {
      const changeId = marks?.insertedMark?.attrs?.id ?? marks?.deletionMark?.attrs?.id ?? marks?.formatMark?.attrs?.id;
      return {
        event,
        changeId,
        trackedChangeText: `updated-${changeId}`,
        trackedChangeType: marks.insertedMark && marks.deletionMark ? 'both' : marks.deletionMark ? 'delete' : 'insert',
        deletedText: marks.deletionMark ? `deleted-${changeId}` : null,
        documentId: 'doc-1',
        trackedChangesForId,
      };
    });

    store.commentsList = Object.keys(trackedChangesById).map((commentId) => ({
      commentId,
      trackedChange: true,
      trackedChangeText: 'old',
      fileId: 'doc-1',
    }));

    store.refreshTrackedChangeCommentsByIds({
      superdoc,
      editor,
      changeIds: ['tc-insert', 'tc-replacement', 'tc-delete', 'missing'],
    });

    expect(createOrUpdateTrackedChangeCommentMock).toHaveBeenCalledTimes(3);
    expect(createOrUpdateTrackedChangeCommentMock.mock.calls.map(([call]) => call.marks)).toEqual([
      { insertedMark: trackedChangesById['tc-insert'][0].mark, deletionMark: null, formatMark: null },
      {
        insertedMark: trackedChangesById['tc-replacement'][0].mark,
        deletionMark: trackedChangesById['tc-replacement'][1].mark,
        formatMark: null,
      },
      { insertedMark: null, deletionMark: trackedChangesById['tc-delete'][0].mark, formatMark: null },
    ]);
    expect(store.getComment('tc-insert').trackedChangeText).toBe('updated-tc-insert');
    expect(store.getComment('tc-replacement').deletedText).toBe('deleted-tc-replacement');
    expect(store.getComment('tc-delete').trackedChangeType).toBe('delete');
  });

  it('does not emit tracked-change comment updates when refreshed fields are unchanged', () => {
    const superdoc = { emit: vi.fn() };
    const existingComment = {
      commentId: 'tc-live',
      trackedChange: true,
      trackedChangeText: 'tracked-tc-live',
      trackedChangeType: 'insert',
      trackedChangeDisplayType: null,
      deletedText: null,
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangeStoryKind: 'body',
      trackedChangeStoryLabel: '',
      trackedChangeAnchorKey: 'tc::body::tc-live',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-live' })),
    };
    store.commentsList = [existingComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'tc-live',
        trackedChangeText: 'tracked-tc-live',
        trackedChangeType: 'insert',
        trackedChangeDisplayType: null,
        deletedText: null,
        documentId: 'doc-1',
      },
    });

    expect(syncCommentsToClientsMock).not.toHaveBeenCalled();
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  it('creates the first live tracked-change comment from an add event', () => {
    const superdoc = {
      ...__mockSuperdoc,
      emit: vi.fn(),
      activeEditor: { commands: { removeComment: vi.fn(), setActiveComment: vi.fn() } },
    };

    store.commentsList = [];
    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'add',
        changeId: 'tc-live-insert',
        trackedChangeText: 'Tracked live insert',
        trackedChangeType: 'trackInsert',
        deletedText: null,
        authorEmail: 'alice@example.com',
        author: 'Alice',
        date: 123,
        documentId: 'doc-1',
      },
      broadcastChanges: false,
    });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0]).toEqual(
      expect.objectContaining({
        commentId: 'tc-live-insert',
        trackedChange: true,
        trackedChangeText: 'Tracked live insert',
        trackedChangeType: 'trackInsert',
        fileId: 'doc-1',
      }),
    );
  });

  it('does not create a missing tracked-change comment from an update-only refresh event', () => {
    const superdoc = { emit: vi.fn() };

    store.commentsList = [];
    store.handleTrackedChangeUpdate({
      superdoc,
      params: {
        event: 'update',
        changeId: 'tc-live-insert',
        trackedChangeText: 'Tracked live insert',
        trackedChangeType: 'trackInsert',
        deletedText: null,
        authorEmail: 'alice@example.com',
        author: 'Alice',
        date: 123,
        documentId: 'doc-1',
      },
    });

    expect(store.commentsList).toEqual([]);
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  it('keeps imported resolved tracked-change comments resolved during initial tracked-change rebuild', async () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      converter: { commentThreadingProfile: 'range-based' },
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-import-resolved' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-import-resolved' } } } }]);

    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor,
      comments: [
        {
          commentId: 'tc-import-resolved',
          creatorName: 'Imported Author',
          creatorEmail: 'imported@example.com',
          createdTime: 123,
          elements: [],
          trackedChange: true,
          trackedChangeText: 'Imported text',
          trackedChangeType: 'insert',
          isDone: true,
        },
      ],
      documentId: 'doc-1',
    });

    vi.runAllTimers();
    await nextTick();

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentId).toBe('tc-import-resolved');
    expect(store.commentsList[0].resolvedTime).not.toBeNull();
    expect(createOrUpdateTrackedChangeCommentMock).not.toHaveBeenCalled();
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('replaces stale document threads immediately when a new file is loaded into the same document id', async () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      converter: { commentThreadingProfile: 'range-based' },
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-new' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-new' } } } }]);

    store.commentsList = [
      {
        commentId: 'tc-old',
        trackedChange: true,
        trackedChangeText: 'Old tracked text',
        fileId: 'doc-1',
      },
      {
        commentId: 'tc-old-reply',
        parentCommentId: 'tc-old',
        fileId: 'doc-1',
      },
      {
        commentId: 'regular-old',
        commentText: 'Old regular comment',
        fileId: 'doc-1',
      },
    ];

    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor,
      comments: [
        {
          commentId: 'regular-new',
          creatorName: 'Imported Author',
          creatorEmail: 'imported@example.com',
          createdTime: 123,
          elements: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'run',
                  content: [
                    {
                      type: 'text',
                      text: 'Replacement comment',
                      attrs: {
                        type: 'element',
                        attributes: {},
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      documentId: 'doc-1',
      replacedFile: true,
    });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList.find((comment) => comment.commentId === 'tc-old')).toBeUndefined();
    expect(store.commentsList.find((comment) => comment.commentId === 'tc-old-reply')).toBeUndefined();
    expect(store.commentsList.find((comment) => comment.commentId === 'regular-old')).toBeUndefined();
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'regular-new',
        fileId: 'doc-1',
        docxCommentJSON: expect.any(Array),
      }),
      expect.objectContaining({
        commentId: 'tc-new',
        trackedChange: true,
        trackedChangeText: 'tracked-tc-new',
        fileId: 'doc-1',
      }),
    ]);
    expect(createOrUpdateTrackedChangeCommentMock).toHaveBeenCalledTimes(1);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('reopens resolved tracked-change comments when synced marks reappear', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const superdoc = { emit: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-reopen' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-reopen' } } } }]);

    const existingComment = {
      commentId: 'tc-reopen',
      trackedChange: true,
      trackedChangeText: 'Existing',
      resolvedTime: 123,
      resolvedByEmail: 'old@example.com',
      resolvedByName: 'Old Reviewer',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-reopen' })),
    };
    store.commentsList = [existingComment];

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toHaveLength(1);
    expect(existingComment.resolvedTime).toBeNull();
    expect(existingComment.resolvedByEmail).toBeNull();
    expect(existingComment.resolvedByName).toBeNull();
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('preserves tracked-change thread across accept undo redo undo history replay', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const superdoc = { emit: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    const rootComment = {
      commentId: 'tc-history-replay',
      trackedChange: true,
      trackedChangeText: 'Existing',
      resolvedTime: 123,
      resolvedByEmail: 'reviewer@example.com',
      resolvedByName: 'Reviewer',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-history-replay' })),
    };
    const replyComment = {
      commentId: 'tc-history-replay-reply',
      parentCommentId: 'tc-history-replay',
      fileId: 'doc-1',
    };
    store.commentsList = [rootComment, replyComment];

    // undo: accepted mark returns, thread reopens
    trackChangesHelpersMock.getTrackChanges.mockReturnValueOnce([{ mark: { attrs: { id: 'tc-history-replay' } } }]);
    groupChangesMock.mockReturnValueOnce([{ insertedMark: { mark: { attrs: { id: 'tc-history-replay' } } } }]);
    store.syncTrackedChangeComments({ superdoc, editor });

    expect(rootComment.resolvedTime).toBeNull();
    expect(store.commentsList).toHaveLength(2);

    // redo: accepted mark removed again, thread should not be deleted
    trackChangesHelpersMock.getTrackChanges.mockReturnValueOnce([]);
    groupChangesMock.mockReturnValueOnce([]);
    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList.find((comment) => comment.commentId === 'tc-history-replay')).toBeTruthy();
    expect(store.commentsList.find((comment) => comment.commentId === 'tc-history-replay-reply')).toBeTruthy();

    // next undo: same original thread reopens, no rematerialized replacement thread
    trackChangesHelpersMock.getTrackChanges.mockReturnValueOnce([{ mark: { attrs: { id: 'tc-history-replay' } } }]);
    groupChangesMock.mockReturnValueOnce([{ insertedMark: { mark: { attrs: { id: 'tc-history-replay' } } } }]);
    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList.filter((comment) => comment.commentId === 'tc-history-replay')).toHaveLength(1);
    expect(store.commentsList.filter((comment) => comment.commentId === 'tc-history-replay-reply')).toHaveLength(1);
  });

  it('keeps already-resolved tracked-change comments during empty replay sync', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const superdoc = { emit: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    groupChangesMock.mockReturnValue([]);

    const resolvedComment = {
      commentId: 'tc-already-resolved',
      trackedChange: true,
      trackedChangeText: 'Accepted text',
      resolvedTime: 999,
      resolvedByEmail: 'reviewer@example.com',
      resolvedByName: 'Reviewer',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-already-resolved', fileId: 'doc-1' })),
    };
    store.commentsList = [resolvedComment];

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toHaveLength(1);
    expect(resolvedComment.resolvedTime).toBe(999);
    expect(syncCommentsToClientsMock).not.toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({ type: comments_module_events.DELETED }),
    );
  });

  it('restores resolution snapshot instead of deleting when pruning a previously-reopened thread', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const superdoc = { emit: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    const existingComment = {
      commentId: 'tc-snapshot-restore',
      trackedChange: true,
      trackedChangeText: 'Existing',
      resolvedTime: 555,
      resolvedByEmail: 'reviewer@example.com',
      resolvedByName: 'Reviewer',
      fileId: 'doc-1',
      getValues: vi.fn(() => ({ commentId: 'tc-snapshot-restore' })),
    };
    store.commentsList = [existingComment];

    // Step 1: undo — mark reappears, thread reopens (snapshot saved, resolvedTime cleared)
    trackChangesHelpersMock.getTrackChanges.mockReturnValueOnce([{ mark: { attrs: { id: 'tc-snapshot-restore' } } }]);
    groupChangesMock.mockReturnValueOnce([{ insertedMark: { mark: { attrs: { id: 'tc-snapshot-restore' } } } }]);
    store.syncTrackedChangeComments({ superdoc, editor });

    expect(existingComment.resolvedTime).toBeNull();

    // Step 2: redo — mark gone, snapshot should restore resolvedTime instead of deleting
    trackChangesHelpersMock.getTrackChanges.mockReturnValueOnce([]);
    groupChangesMock.mockReturnValueOnce([]);
    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toHaveLength(1);
    expect(existingComment.resolvedTime).toBe(555);
    expect(existingComment.resolvedByEmail).toBe('reviewer@example.com');
    expect(existingComment.resolvedByName).toBe('Reviewer');

    // Should emit UPDATE so collaborators see the re-resolved state
    expect(syncCommentsToClientsMock).toHaveBeenCalledWith(
      superdoc,
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: expect.objectContaining({ commentId: 'tc-snapshot-restore' }),
      }),
    );
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: comments_module_events.UPDATE,
        comment: expect.objectContaining({ commentId: 'tc-snapshot-restore' }),
      }),
    );
  });

  it('keeps tracked-change comments when importedId is live even if commentId differs', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-live-imported' } } }]);
    groupChangesMock.mockReturnValue([]);

    store.commentsList = [
      {
        commentId: 'runtime-id-123',
        importedId: 'tc-live-imported',
        trackedChange: true,
        trackedChangeText: 'Existing',
        fileId: 'doc-1',
      },
      { commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' },
    ];

    store.syncTrackedChangeComments({ superdoc: {}, editor });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'runtime-id-123',
        importedId: 'tc-live-imported',
        trackedChangeText: 'Existing',
        trackedChange: true,
        fileId: 'doc-1',
      }),
      expect.objectContaining({ commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' }),
    ]);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('deduplicates tracked-change sync when grouped mark id matches existing importedId', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'tc-live-imported' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'tc-live-imported' } } } }]);

    store.commentsList = [
      {
        commentId: 'runtime-id-123',
        importedId: 'tc-live-imported',
        trackedChange: true,
        trackedChangeText: 'Existing',
        fileId: 'doc-1',
      },
      { commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' },
    ];

    store.syncTrackedChangeComments({ superdoc: {}, editor });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'runtime-id-123',
        importedId: 'tc-live-imported',
        trackedChange: true,
        trackedChangeText: 'tracked-tc-live-imported',
        fileId: 'doc-1',
      }),
      expect.objectContaining({ commentId: 'normal-1', commentText: 'Regular comment', fileId: 'doc-1' }),
    ]);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('reuses a peer tracked-change thread during single-document replay even when fileId differs', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'shared-id-1' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'shared-id-1' } } } }]);

    store.commentsList = [
      {
        commentId: 'shared-id-1',
        trackedChange: true,
        trackedChangeText: 'Existing peer text',
        fileId: 'peer-doc-id',
      },
    ];

    store.syncTrackedChangeComments({ superdoc, editor });

    const matchingComments = store.commentsList.filter((comment) => comment.commentId === 'shared-id-1');
    expect(matchingComments).toHaveLength(1);
    expect(matchingComments[0]).toEqual(
      expect.objectContaining({
        commentId: 'shared-id-1',
        trackedChange: true,
        trackedChangeText: 'tracked-shared-id-1',
        fileId: 'peer-doc-id',
      }),
    );
    expect(createOrUpdateTrackedChangeCommentMock).toHaveBeenCalledTimes(1);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('rebuilds peer replay tracked-change threads locally without rebroadcasting them', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'shared-id-1' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'shared-id-1' } } } }]);

    store.commentsList = [];

    store.syncTrackedChangeComments({ superdoc, editor, broadcastChanges: false });

    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'shared-id-1',
        trackedChange: true,
        trackedChangeText: 'tracked-shared-id-1',
        fileId: 'doc-1',
      }),
    ]);
    expect(syncCommentsToClientsMock).not.toHaveBeenCalled();
    expect(superdoc.emit).not.toHaveBeenCalled();
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('prunes peer tracked-change threads during single-document replay even when fileId differs', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      emit: vi.fn(),
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    groupChangesMock.mockReturnValue([]);

    store.commentsList = [
      { commentId: 'tc-peer', trackedChange: true, trackedChangeText: 'Peer text', fileId: 'peer-doc-id' },
      { commentId: 'tc-peer-reply', parentCommentId: 'tc-peer', fileId: 'peer-doc-id' },
    ];
    store.activeComment = 'tc-peer-reply';

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toEqual([]);
    expect(store.activeComment).toBeNull();
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('creates tracked-change comments for active document when another document has the same id', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };

    __mockSuperdoc.documents.value = [
      { id: 'doc-1', type: 'docx' },
      { id: 'doc-2', type: 'docx' },
    ];

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([{ mark: { attrs: { id: 'shared-id-1' } } }]);
    groupChangesMock.mockReturnValue([{ insertedMark: { mark: { attrs: { id: 'shared-id-1' } } } }]);

    store.commentsList = [
      {
        commentId: 'shared-id-1',
        trackedChange: true,
        trackedChangeText: 'Existing doc-2',
        fileId: 'doc-2',
      },
    ];

    store.syncTrackedChangeComments({ superdoc, editor });

    const matchingComments = store.commentsList.filter((comment) => comment.commentId === 'shared-id-1');
    expect(matchingComments).toHaveLength(2);
    expect(matchingComments.map((comment) => comment.fileId).sort()).toEqual(['doc-1', 'doc-2']);
    expect(matchingComments.find((comment) => comment.fileId === 'doc-2')?.trackedChangeText).toBe('Existing doc-2');
    expect(matchingComments.find((comment) => comment.fileId === 'doc-1')?.trackedChangeText).toBe(
      'tracked-shared-id-1',
    );
    expect(createOrUpdateTrackedChangeCommentMock).toHaveBeenCalledTimes(1);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('does not prune tracked-change comments from other documents during sync', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    __mockSuperdoc.documents.value = [
      { id: 'doc-1', type: 'docx' },
      { id: 'doc-2', type: 'docx' },
    ];

    trackChangesHelpersMock.getTrackChanges.mockReturnValue([]);
    groupChangesMock.mockReturnValue([]);

    store.commentsList = [
      { commentId: 'tc-stale-1', trackedChange: true, fileId: 'doc-1' },
      { commentId: 'tc-child-1', parentCommentId: 'tc-stale-1', fileId: 'doc-1' },
      { commentId: 'tc-stale-2', trackedChange: true, fileId: 'doc-2' },
      { commentId: 'tc-child-2', parentCommentId: 'tc-stale-2', fileId: 'doc-2' },
    ];
    store.activeComment = 'tc-child-2';

    store.syncTrackedChangeComments({ superdoc: {}, editor });

    expect(store.commentsList).toEqual([
      { commentId: 'tc-stale-2', trackedChange: true, fileId: 'doc-2' },
      { commentId: 'tc-child-2', parentCommentId: 'tc-stale-2', fileId: 'doc-2' },
    ]);
    expect(store.activeComment).toBe('tc-child-2');
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('builds story tracked-change replacements from the resolved story editor state', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const storyState = { doc: { type: 'story-doc' } };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };
    const snapshot = {
      type: 'insert',
      excerpt: 'footnotetest',
      anchorKey: 'tc::fn:1::raw-1',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'footnote', noteId: '1' },
      storyKind: 'footnote',
      storyLabel: 'Footnote 1',
      runtimeRef: { rawId: 'raw-1' },
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];

    trackChangesHelpersMock.getTrackChanges.mockImplementation((state, id) => {
      if (state === storyState && id === 'raw-1') {
        return [
          { mark: { type: { name: 'trackInsert' }, attrs: { id: 'raw-1' } } },
          { mark: { type: { name: 'trackDelete' }, attrs: { id: 'raw-1' } } },
        ];
      }
      return [];
    });
    groupChangesMock.mockReturnValue([]);
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    resolveTrackedChangeInStoryMock.mockReturnValue({
      editor: { state: storyState },
      story: snapshot.story,
      runtimeRef: { storyKey: 'fn:1', rawId: 'raw-1' },
      change: { rawId: 'raw-1' },
    });
    createOrUpdateTrackedChangeCommentMock.mockReturnValue({
      event: 'add',
      changeId: 'raw-1',
      trackedChangeType: 'both',
      trackedChangeDisplayType: 'insert',
      trackedChangeText: 'test',
      deletedText: 'footnote',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      documentId: 'doc-1',
      coords: {},
    });

    store.commentsList = [];

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(resolveTrackedChangeInStoryMock).toHaveBeenCalledWith(editor, {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'raw-1',
      story: snapshot.story,
    });
    expect(createOrUpdateTrackedChangeCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'add',
        newEditorState: storyState,
        documentId: 'doc-1',
      }),
    );
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'raw-1',
        trackedChange: true,
        trackedChangeType: 'both',
        trackedChangeText: 'test',
        deletedText: 'footnote',
        trackedChangeStoryKind: 'footnote',
        trackedChangeAnchorKey: 'tc::fn:1::raw-1',
      }),
    ]);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('falls back to snapshot story data when resolving a story tracked change throws', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };
    const snapshot = {
      type: 'delete',
      excerpt: 'header text',
      anchorKey: 'tc::hf:part:rId6::raw-fallback',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' },
      storyKind: 'headerFooter',
      storyLabel: 'Header',
      runtimeRef: { rawId: 'raw-fallback' },
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    resolveTrackedChangeInStoryMock.mockImplementation(() => {
      throw new Error('boom');
    });

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'raw-fallback',
        trackedChangeText: '',
        deletedText: 'header text',
        trackedChangeType: 'delete',
        trackedChangeStoryLabel: 'Header',
        trackedChangeAnchorKey: 'tc::hf:part:rId6::raw-fallback',
      }),
    ]);
  });

  it('falls back to snapshot story data when story mark lookup throws', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const storyState = { doc: { type: 'story-doc' } };
    const editor = {
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };
    const snapshot = {
      type: 'insert',
      excerpt: 'footnote text',
      anchorKey: 'tc::fn:1::raw-fallback-2',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'footnote', noteId: '1' },
      storyKind: 'footnote',
      storyLabel: 'Footnote 1',
      runtimeRef: { rawId: 'raw-fallback-2' },
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    resolveTrackedChangeInStoryMock.mockReturnValue({
      editor: { state: storyState },
      story: snapshot.story,
      runtimeRef: { storyKey: 'fn:1', rawId: 'raw-fallback-2' },
      change: { rawId: 'raw-fallback-2' },
    });
    trackChangesHelpersMock.getTrackChanges.mockImplementation((state, id) => {
      if (state === storyState && id === 'raw-fallback-2') {
        throw new Error('story lookup failed');
      }
      return [];
    });

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'raw-fallback-2',
        trackedChangeText: 'footnote text',
        deletedText: null,
        trackedChangeType: 'insert',
        trackedChangeStoryLabel: 'Footnote 1',
        trackedChangeAnchorKey: 'tc::fn:1::raw-fallback-2',
      }),
    ]);
  });

  it('updates an existing story tracked-change thread by anchor key', () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const superdoc = {
      config: { isInternal: false },
      emit: vi.fn(),
    };
    const snapshot = {
      type: 'insert',
      excerpt: 'new header text',
      anchorKey: 'tc::hf:part:rId6::raw-anchor',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' },
      storyKind: 'headerFooter',
      storyLabel: 'Header',
      runtimeRef: { rawId: 'raw-anchor' },
    };
    const existingComment = {
      commentId: 'different-runtime-id',
      trackedChange: true,
      trackedChangeText: 'old header text',
      trackedChangeType: 'trackInsert',
      trackedChangeStoryLabel: 'Old Header',
      trackedChangeAnchorKey: 'tc::hf:part:rId6::raw-anchor',
      getValues: vi.fn(() => ({ commentId: 'different-runtime-id' })),
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    store.commentsList = [existingComment];

    store.syncTrackedChangeComments({ superdoc, editor });

    expect(store.commentsList).toHaveLength(1);
    expect(existingComment).toEqual(
      expect.objectContaining({
        trackedChangeText: 'new header text',
        trackedChangeStoryLabel: 'Header',
        trackedChangeAnchorKey: 'tc::hf:part:rId6::raw-anchor',
      }),
    );
  });

  it('updates an existing story tracked-change thread by raw id when no anchor key exists', async () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      converter: { commentThreadingProfile: 'range-based' },
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const snapshot = {
      type: 'insert',
      excerpt: 'note text',
      anchorKey: null,
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'footnote', noteId: '1' },
      storyKind: 'footnote',
      storyLabel: 'Footnote 1',
      runtimeRef: { rawId: 'raw-no-anchor' },
    };
    const existingComment = {
      commentId: 'other-id',
      importedId: 'raw-no-anchor',
      trackedChange: true,
      trackedChangeText: 'old note text',
      trackedChangeType: 'trackInsert',
      getValues: vi.fn(() => ({ commentId: 'other-id' })),
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    store.commentsList = [existingComment];

    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor,
      comments: [],
      documentId: 'doc-1',
    });
    vi.runAllTimers();
    await nextTick();

    expect(store.commentsList).toHaveLength(1);
    expect(existingComment.trackedChangeText).toBe('note text');
  });

  it('ignores story tracked-change bootstrap when the index snapshot lookup throws during DOCX load', async () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      converter: { commentThreadingProfile: 'range-based' },
      state: {},
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };

    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => {
        throw new Error('index unavailable');
      }),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });

    expect(() =>
      store.processLoadedDocxComments({
        superdoc: __mockSuperdoc,
        editor,
        comments: [],
        documentId: 'doc-1',
      }),
    ).not.toThrow();

    expect(() => {
      vi.runAllTimers();
    }).not.toThrow();

    await nextTick();
  });

  describe('decideTrackedChangeFromSidebar', () => {
    it('returns { ok: false } when the comment, editor, or id is missing', () => {
      expect(store.decideTrackedChangeFromSidebar({ superdoc: {}, comment: null, decision: 'accept' })).toEqual({
        ok: false,
      });

      expect(
        store.decideTrackedChangeFromSidebar({
          superdoc: {},
          comment: { commentId: 'tc-1', trackedChange: true },
          decision: 'accept',
        }),
      ).toEqual({ ok: false });

      expect(
        store.decideTrackedChangeFromSidebar({
          superdoc: { activeEditor: {} },
          comment: { trackedChange: true },
          decision: 'accept',
        }),
      ).toEqual({ ok: false });
    });

    it('uses the document API for story tracked changes when available', () => {
      const story = { kind: 'story', storyType: 'footnote', noteId: '1' };
      const decide = vi.fn(() => ({ success: true }));

      const result = store.decideTrackedChangeFromSidebar({
        superdoc: {
          activeEditor: {
            doc: { trackChanges: { decide } },
          },
        },
        comment: {
          commentId: 'tc-story-1',
          trackedChange: true,
          trackedChangeStory: story,
        },
        decision: 'accept',
      });

      expect(decide).toHaveBeenCalledWith({
        decision: 'accept',
        target: { id: 'tc-story-1', story },
      });
      expect(result).toEqual({ ok: true, success: true });
    });

    it('returns the document API error for story tracked changes when decide throws', () => {
      const error = new Error('story decide failed');

      const result = store.decideTrackedChangeFromSidebar({
        superdoc: {
          activeEditor: {
            doc: {
              trackChanges: {
                decide: vi.fn(() => {
                  throw error;
                }),
              },
            },
          },
        },
        comment: {
          commentId: 'tc-story-2',
          trackedChange: true,
          trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' },
        },
        decision: 'reject',
      });

      expect(result).toEqual({ ok: false, error });
    });

    it('falls back to editor commands for body tracked changes when document-api decide is unavailable', () => {
      const rejectTrackedChangeById = vi.fn(() => true);

      const result = store.decideTrackedChangeFromSidebar({
        superdoc: {
          activeEditor: {
            doc: {
              trackChanges: {
                decide: vi.fn(() => {
                  throw new Error('body decide failed');
                }),
              },
            },
            commands: {
              rejectTrackedChangeById,
            },
          },
        },
        comment: {
          importedId: 'tc-body-1',
          trackedChange: true,
        },
        decision: 'reject',
      });

      expect(rejectTrackedChangeById).toHaveBeenCalledWith('tc-body-1');
      expect(result).toEqual({ ok: true, success: true });
    });
  });

  it('bootstraps story tracked-change comments during initial DOCX load', async () => {
    const editorDispatch = vi.fn();
    const tr = { setMeta: vi.fn() };
    const editor = {
      converter: { commentThreadingProfile: 'range-based' },
      state: { doc: { type: 'body-doc' } },
      view: { state: { tr }, dispatch: editorDispatch },
      options: { documentId: 'doc-1' },
    };
    const storyState = { doc: { type: 'header-doc' } };
    const snapshot = {
      type: 'insert',
      excerpt: 'header test',
      anchorKey: 'tc::hf:part:rId9::raw-hf-1',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorImage: null,
      date: 123,
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId9' },
      storyKind: 'headerFooter',
      storyLabel: 'Header',
      runtimeRef: { rawId: 'raw-hf-1' },
    };

    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];

    trackChangesHelpersMock.getTrackChanges.mockImplementation((state, id) => {
      if (state === storyState && id === 'raw-hf-1') {
        return [{ mark: { type: { name: 'trackInsert' }, attrs: { id: 'raw-hf-1' } } }];
      }
      return [];
    });
    groupChangesMock.mockReturnValue([]);
    getTrackedChangeIndexMock.mockReturnValue({
      getAll: vi.fn(() => [snapshot]),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });
    resolveTrackedChangeInStoryMock.mockReturnValue({
      editor: { state: storyState },
      story: snapshot.story,
      runtimeRef: { storyKey: 'hf:part:rId9', rawId: 'raw-hf-1' },
      change: { rawId: 'raw-hf-1' },
    });
    createOrUpdateTrackedChangeCommentMock.mockReturnValue({
      event: 'add',
      changeId: 'raw-hf-1',
      trackedChangeType: 'insert',
      trackedChangeDisplayType: 'insert',
      trackedChangeText: 'header test',
      deletedText: null,
      author: 'Alice',
      authorEmail: 'alice@example.com',
      documentId: 'doc-1',
      coords: {},
    });

    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor,
      comments: [],
      documentId: 'doc-1',
    });

    vi.runAllTimers();
    await nextTick();

    expect(resolveTrackedChangeInStoryMock).toHaveBeenCalledWith(editor, {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'raw-hf-1',
      story: snapshot.story,
    });
    expect(store.commentsList).toEqual([
      expect.objectContaining({
        commentId: 'raw-hf-1',
        trackedChange: true,
        trackedChangeText: 'header test',
        trackedChangeStoryKind: 'headerFooter',
        trackedChangeAnchorKey: 'tc::hf:part:rId9::raw-hf-1',
      }),
    ]);
    expect(tr.setMeta).toHaveBeenCalledWith('CommentsPluginKey', { type: 'force' });
    expect(editorDispatch).toHaveBeenCalledWith(tr);
  });

  it('should load comments with correct created time', () => {
    store.init({
      readOnly: true,
      allowResolve: false,
      comments: [],
    });

    const now = Date.now();
    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor: null,
      comments: [
        {
          commentId: 'c-1',
          createdTime: now,
          creatorName: 'Gabriel',
          elements: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'run',
                  content: [],
                  attrs: {
                    runProperties: [
                      {
                        xmlName: 'w:rStyle',
                        attributes: {
                          'w:val': 'CommentReference',
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'run',
                  content: [
                    {
                      type: 'text',
                      text: 'I am a comment~!',
                      attrs: {
                        type: 'element',
                        attributes: {},
                      },
                      marks: [
                        {
                          type: 'textStyle',
                          attrs: {
                            fontSize: '10pt',
                            fontSizeCs: '10pt',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      documentId: 'doc-1',
    });

    expect(store.commentsList[0].createdTime).toBe(now);
  });

  it('loads imported comments without creatorName metadata', () => {
    store.init({
      readOnly: true,
      allowResolve: false,
      comments: [],
    });

    expect(() =>
      store.processLoadedDocxComments({
        superdoc: __mockSuperdoc,
        editor: null,
        comments: [
          {
            commentId: 'c-missing-author',
            creatorEmail: 'imported@example.com',
            createdTime: 123,
            elements: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'run',
                    content: [
                      {
                        type: 'text',
                        text: 'Imported comment text',
                        attrs: {
                          type: 'element',
                          attributes: {},
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        documentId: 'doc-1',
      }),
    ).not.toThrow();

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentId).toBe('c-missing-author');
    expect(store.commentsList[0].importedAuthor).toEqual({
      email: 'imported@example.com',
    });
  });

  describe('clearEditorCommentPositions', () => {
    it('clears all editor comment positions', () => {
      // Setup editorCommentPositions with data
      store.editorCommentPositions = {
        'comment-1': { from: 10, to: 20 },
        'comment-2': { from: 30, to: 40 },
        'comment-3': { from: 50, to: 60 },
      };

      // Verify positions are set
      expect(Object.keys(store.editorCommentPositions).length).toBe(3);
      expect(store.editorCommentPositions['comment-1']).toEqual({ from: 10, to: 20 });
      expect(store.editorCommentPositions['comment-2']).toEqual({ from: 30, to: 40 });
      expect(store.editorCommentPositions['comment-3']).toEqual({ from: 50, to: 60 });

      // Clear all positions
      store.clearEditorCommentPositions();

      // Verify all positions are cleared (object should be empty)
      expect(Object.keys(store.editorCommentPositions).length).toBe(0);
      expect(store.editorCommentPositions).toEqual({});
    });

    it('handles already empty editorCommentPositions gracefully', () => {
      store.editorCommentPositions = {};

      // Should not throw
      expect(() => store.clearEditorCommentPositions()).not.toThrow();

      // Should still be empty
      expect(store.editorCommentPositions).toEqual({});
    });

    it('clears positions even with many entries', () => {
      // Setup many comment positions
      const positions = {};
      for (let i = 0; i < 100; i++) {
        positions[`comment-${i}`] = { from: i * 10, to: i * 10 + 5 };
      }
      store.editorCommentPositions = positions;

      // Verify we have 100 entries
      expect(Object.keys(store.editorCommentPositions).length).toBe(100);

      // Clear all
      store.clearEditorCommentPositions();

      // Verify all cleared
      expect(Object.keys(store.editorCommentPositions).length).toBe(0);
    });

    it('resets editorCommentPositions to empty object, not null', () => {
      store.editorCommentPositions = {
        'comment-1': { from: 10, to: 20 },
      };

      store.clearEditorCommentPositions();

      // Should be an empty object, not null or undefined
      expect(store.editorCommentPositions).toEqual({});
      expect(store.editorCommentPositions).not.toBeNull();
      expect(store.editorCommentPositions).not.toBeUndefined();
    });

    it('can be called multiple times safely', () => {
      store.editorCommentPositions = {
        'comment-1': { from: 10, to: 20 },
      };

      // Clear once
      store.clearEditorCommentPositions();
      expect(store.editorCommentPositions).toEqual({});

      // Clear again - should not throw
      expect(() => store.clearEditorCommentPositions()).not.toThrow();
      expect(store.editorCommentPositions).toEqual({});
    });
  });

  describe('handleEditorLocationsUpdate', () => {
    it('clears stale positions when editor emits an empty positions payload', () => {
      store.commentsList = [{ commentId: 'tc-1', trackedChange: true }];
      store.editorCommentPositions = {
        'tc-1': { from: 1, to: 5 },
      };

      store.handleEditorLocationsUpdate({});

      expect(store.editorCommentPositions).toEqual({});
    });

    it('ignores nullish payloads to avoid clobbering valid positions', () => {
      store.editorCommentPositions = {
        'tc-1': { from: 1, to: 5 },
      };

      store.handleEditorLocationsUpdate(undefined);
      store.handleEditorLocationsUpdate(null);

      expect(store.editorCommentPositions).toEqual({
        'tc-1': { from: 1, to: 5 },
      });
    });

    it('adds raw body tracked-change ids and canonical keys as lookup aliases', () => {
      const entry = {
        kind: 'trackedChange',
        storyKey: 'body',
        threadId: 'tc-raw-1',
        key: 'tc::body::tc-raw-1',
        start: 5,
        end: 8,
      };

      store.handleEditorLocationsUpdate({
        generated: entry,
      });

      expect(store.editorCommentPositions).toEqual({
        generated: entry,
        'tc-raw-1': entry,
        'tc::body::tc-raw-1': entry,
      });
    });
  });

  describe('viewing visibility filters', () => {
    it('hides tracked change threads when viewing mode hides tracked changes', () => {
      store.commentsList = [
        { commentId: 'tc-parent', trackedChange: true, createdTime: 1 },
        { commentId: 'tc-child', parentCommentId: 'tc-parent', createdTime: 2 },
      ];

      store.setViewingVisibility({
        documentMode: 'viewing',
        commentsVisible: true,
        trackChangesVisible: false,
      });

      expect(store.getGroupedComments.parentComments).toEqual([]);
      expect(store.getGroupedComments.resolvedComments).toEqual([]);
    });

    it('shows standard comment threads when viewing mode shows comments', () => {
      store.commentsList = [
        { commentId: 'c-parent', trackedChange: false, createdTime: 1 },
        { commentId: 'c-child', parentCommentId: 'c-parent', createdTime: 2 },
      ];

      store.setViewingVisibility({
        documentMode: 'viewing',
        commentsVisible: true,
        trackChangesVisible: false,
      });

      expect(store.getGroupedComments.parentComments).toHaveLength(1);
      expect(store.getGroupedComments.parentComments[0].commentId).toBe('c-parent');
    });

    it('hides tracked change threads when children reference importedId', () => {
      store.commentsList = [
        { commentId: 'tc-parent', importedId: 'imp-1', trackedChange: true, createdTime: 1 },
        { commentId: 'tc-child', parentCommentId: 'imp-1', createdTime: 2 },
      ];

      store.setViewingVisibility({
        documentMode: 'viewing',
        commentsVisible: true,
        trackChangesVisible: false,
      });

      expect(store.getGroupedComments.parentComments).toEqual([]);
    });
  });

  describe('getCommentsByPosition', () => {
    it('orders parent comments by document position when available', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 2 },
        { commentId: 'c-2', createdTime: 1 },
        { commentId: 'c-3', createdTime: 3 },
      ];

      store.editorCommentPositions = {
        'c-1': { start: 40, end: 50 },
        'c-2': { start: 10, end: 20 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-1', 'c-3']);
    });

    it('falls back to createdTime for comments without positions', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 3 },
        { commentId: 'c-2', createdTime: 1 },
        { commentId: 'c-3', createdTime: 2 },
      ];

      store.editorCommentPositions = {};

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-3', 'c-1']);
    });

    it('uses importedId when that is the available position key', () => {
      store.commentsList = [
        { commentId: 'uuid-1', importedId: 'imported-1', createdTime: 3 },
        { commentId: 'uuid-2', importedId: 'imported-2', createdTime: 1 },
        { commentId: 'uuid-3', createdTime: 2 },
      ];

      store.editorCommentPositions = {
        'imported-1': { start: 50, end: 60 },
        'imported-2': { start: 10, end: 20 },
        'uuid-3': { start: 30, end: 40 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['uuid-2', 'uuid-3', 'uuid-1']);
    });

    it('orders resolved comments by document position', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 1, resolvedTime: 100 },
        { commentId: 'c-2', createdTime: 2, resolvedTime: 200 },
        { commentId: 'c-3', createdTime: 3, resolvedTime: 300 },
      ];

      store.editorCommentPositions = {
        'c-1': { start: 50 },
        'c-2': { start: 10 },
        'c-3': { start: 30 },
      };

      const ordered = store.getCommentsByPosition.resolvedComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-3', 'c-1']);
    });

    it('supports pos property for position lookup', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 1 },
        { commentId: 'c-2', createdTime: 2 },
      ];

      store.editorCommentPositions = {
        'c-1': { pos: 50 },
        'c-2': { pos: 10 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-1']);
    });

    it('supports from property for position lookup', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 1 },
        { commentId: 'c-2', createdTime: 2 },
      ];

      store.editorCommentPositions = {
        'c-1': { from: 50, to: 60 },
        'c-2': { from: 10, to: 20 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-1']);
    });

    it('supports to property as fallback for position lookup', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 1 },
        { commentId: 'c-2', createdTime: 2 },
      ];

      store.editorCommentPositions = {
        'c-1': { to: 50 },
        'c-2': { to: 10 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-1']);
    });

    it('falls back to createdTime when positions are equal', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 3 },
        { commentId: 'c-2', createdTime: 1 },
        { commentId: 'c-3', createdTime: 2 },
      ];

      store.editorCommentPositions = {
        'c-1': { start: 10 },
        'c-2': { start: 10 },
        'c-3': { start: 10 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-3', 'c-1']);
    });

    it('handles comments with null or undefined ids gracefully', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 2 },
        { commentId: null, createdTime: 1 },
        { createdTime: 3 },
      ];

      store.editorCommentPositions = {
        'c-1': { start: 10 },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-1', null, undefined]);
    });

    it('uses page index and bounds top when range offsets are unavailable', () => {
      store.commentsList = [
        { commentId: 'c-1', createdTime: 2 },
        { commentId: 'c-2', createdTime: 1 },
      ];

      store.editorCommentPositions = {
        'c-1': { pageIndex: 1, bounds: { top: 10 } },
        'c-2': { pageIndex: 0, bounds: { top: 50 } },
      };

      const ordered = store.getCommentsByPosition.parentComments.map((c) => c.commentId);
      expect(ordered).toEqual(['c-2', 'c-1']);
    });
  });

  describe('comment anchor helpers', () => {
    it('returns comment position by id or comment object', () => {
      const comment = { commentId: 'c-1', fileId: 'doc-1' };
      store.commentsList = [comment];
      store.editorCommentPositions = {
        'c-1': { start: 12, end: 18 },
      };

      expect(store.getCommentPosition('c-1')).toEqual({ start: 12, end: 18 });
      expect(store.getCommentPosition(comment)).toEqual({ start: 12, end: 18 });
    });

    it('returns comment position using importedId fallback', () => {
      const comment = { importedId: 'imported-1', fileId: 'doc-1' };
      store.commentsList = [comment];
      store.editorCommentPositions = {
        'imported-1': { start: 20, end: 30 },
      };

      expect(store.getCommentPosition('imported-1')).toEqual({ start: 20, end: 30 });
      expect(store.getCommentPosition(comment)).toEqual({ start: 20, end: 30 });
    });

    it('returns comment position through imported aliases when the lookup uses commentId', () => {
      const comment = { commentId: 'uuid-1', importedId: 'imported-1', fileId: 'doc-1' };
      store.commentsList = [comment];
      store.editorCommentPositions = {
        'imported-1': { start: 20, end: 30 },
      };

      expect(store.getCommentPosition('uuid-1')).toEqual({ start: 20, end: 30 });
      expect(store.getCommentPosition(comment)).toEqual({ start: 20, end: 30 });
    });

    it('resolves imported-id lookups to commentId positions when only commentId is present', () => {
      const comment = { commentId: 'uuid-1', importedId: 'imported-1', fileId: 'doc-1' };
      store.commentsList = [comment];
      store.editorCommentPositions = {
        'uuid-1': { start: 22, end: 31 },
      };

      expect(store.getCommentPosition('imported-1')).toEqual({ start: 22, end: 31 });
      expect(store.getCommentPosition(comment)).toEqual({ start: 22, end: 31 });
    });

    it('returns anchored text when editor and positions are available', () => {
      const textBetween = vi.fn(() => 'Anchored text');
      const editorStub = { state: { doc: { textBetween } } };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editorStub }];

      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {
        'c-1': { start: 5, end: 12 },
      };

      expect(store.getCommentAnchoredText('c-1')).toBe('Anchored text');
      expect(textBetween).toHaveBeenCalledWith(5, 12, ' ', ' ');
    });

    it('returns anchored text with custom separator option', () => {
      const textBetween = vi.fn(() => 'Line1\nLine2');
      const editorStub = { state: { doc: { textBetween } } };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editorStub }];

      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {
        'c-1': { start: 0, end: 20 },
      };

      expect(store.getCommentAnchoredText('c-1', { separator: '\n' })).toBe('Line1\nLine2');
      expect(textBetween).toHaveBeenCalledWith(0, 20, '\n', '\n');
    });

    it('returns anchored text without trimming when trim is false', () => {
      const textBetween = vi.fn(() => '  spaced text  ');
      const editorStub = { state: { doc: { textBetween } } };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editorStub }];

      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {
        'c-1': { start: 0, end: 15 },
      };

      expect(store.getCommentAnchoredText('c-1', { trim: false })).toBe('  spaced text  ');
      expect(store.getCommentAnchoredText('c-1')).toBe('spaced text');
    });

    it('returns null when position or editor is missing', () => {
      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {};

      expect(store.getCommentAnchoredText('c-1')).toBeNull();
      expect(store.getCommentAnchorData('c-1')).toBeNull();
    });

    it('returns anchor data with position and text when available', () => {
      const textBetween = vi.fn(() => 'Selected text');
      const editorStub = { state: { doc: { textBetween } } };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editorStub }];

      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {
        'c-1': { start: 10, end: 25 },
      };

      const result = store.getCommentAnchorData('c-1');
      expect(result).toEqual({
        position: { start: 10, end: 25 },
        anchoredText: 'Selected text',
      });
    });

    it('handles empty anchored text', () => {
      const textBetween = vi.fn(() => '');
      const editorStub = { state: { doc: { textBetween } } };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => editorStub }];

      store.commentsList = [{ commentId: 'c-1', fileId: 'doc-1' }];
      store.editorCommentPositions = {
        'c-1': { start: 5, end: 5 },
      };

      expect(store.getCommentAnchoredText('c-1')).toBe('');
    });
  });

  describe('document-driven resolution state', () => {
    it('clears resolved metadata when document anchors reappear', async () => {
      const comment = {
        commentId: 'reopen-1',
        resolvedTime: 123,
        resolvedByEmail: 'user@example.com',
        resolvedByName: 'User',
      };

      store.commentsList = [comment];

      store.handleEditorLocationsUpdate({
        'reopen-1': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
      });
      await nextTick();

      expect(comment.resolvedTime).toBeNull();
      expect(comment.resolvedByEmail).toBeNull();
      expect(comment.resolvedByName).toBeNull();
    });

    it('preserves resolved metadata for non-editor comments', async () => {
      const comment = useCommentMock({
        commentId: 'pdf-1',
        fileType: 'pdf',
        selection: { source: 'pdf', selectionBounds: {} },
        resolvedTime: 555,
        resolvedByEmail: 'user@example.com',
        resolvedByName: 'User',
      });

      store.commentsList = [comment];

      store.handleEditorLocationsUpdate({
        'pdf-1': { start: 1, end: 2, bounds: { top: 0, left: 0 } },
      });
      await nextTick();

      expect(comment.resolvedTime).toBe(555);
      expect(comment.resolvedByEmail).toBe('user@example.com');
      expect(comment.resolvedByName).toBe('User');
    });

    it('preserves resolved metadata for tracked-change comments', async () => {
      const comment = {
        commentId: 'tc-1',
        trackedChange: true,
        resolvedTime: 999,
        resolvedByEmail: 'user@example.com',
        resolvedByName: 'User',
      };

      store.commentsList = [comment];

      store.handleEditorLocationsUpdate({
        'tc-1': { start: 3, end: 6, bounds: { top: 0, left: 0 } },
      });
      await nextTick();

      expect(comment.resolvedTime).toBe(999);
      expect(comment.resolvedByEmail).toBe('user@example.com');
      expect(comment.resolvedByName).toBe('User');
    });

    it('preserves resolved metadata for replies to tracked-change comments', async () => {
      const comment = {
        commentId: 'tc-reply-1',
        trackedChangeParentId: 'tc-parent',
        resolvedTime: 888,
        resolvedByEmail: 'user@example.com',
        resolvedByName: 'User',
      };

      store.commentsList = [comment];

      store.handleEditorLocationsUpdate({
        'tc-reply-1': { start: 10, end: 15, bounds: { top: 0, left: 0 } },
      });
      await nextTick();

      expect(comment.resolvedTime).toBe(888);
      expect(comment.resolvedByEmail).toBe('user@example.com');
      expect(comment.resolvedByName).toBe('User');
    });
  });

  describe('getFloatingComments filters resolved tracked changes', () => {
    it('includes editor comments when commentId has positions but importedId does not', () => {
      store.commentsList = [
        {
          commentId: 'uuid-1',
          importedId: 'imported-1',
          resolvedTime: null,
          createdTime: 1,
          selection: { source: 'super-editor' },
        },
      ];
      store.editorCommentPositions = {
        'uuid-1': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['uuid-1']);
    });

    it('includes unresolved tracked changes that have position keys', () => {
      store.commentsList = [
        { commentId: 'tc-1', trackedChange: true, resolvedTime: null, createdTime: 1 },
        { commentId: 'tc-2', trackedChange: true, resolvedTime: null, createdTime: 2 },
      ];
      store.editorCommentPositions = {
        'tc-1': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
        'tc-2': { start: 10, end: 15, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['tc-1', 'tc-2']);
    });

    it('excludes tracked changes once resolvedTime is set', () => {
      store.commentsList = [
        { commentId: 'tc-1', trackedChange: true, resolvedTime: Date.now(), createdTime: 1 },
        { commentId: 'tc-2', trackedChange: true, resolvedTime: null, createdTime: 2 },
      ];
      store.editorCommentPositions = {
        'tc-1': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
        'tc-2': { start: 10, end: 15, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['tc-2']);
    });

    it('excludes the last tracked change when resolved (regression: SD-2049)', () => {
      store.commentsList = [{ commentId: 'tc-only', trackedChange: true, resolvedTime: Date.now(), createdTime: 1 }];
      // Position key still present (editor doesn't fire update for last mark removal)
      store.editorCommentPositions = {
        'tc-only': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating).toEqual([]);
    });

    it('returns empty when all tracked changes are resolved', () => {
      store.commentsList = [
        { commentId: 'tc-1', trackedChange: true, resolvedTime: Date.now(), createdTime: 1 },
        { commentId: 'tc-2', trackedChange: true, resolvedTime: Date.now(), createdTime: 2 },
        { commentId: 'tc-3', trackedChange: true, resolvedTime: Date.now(), createdTime: 3 },
      ];
      store.editorCommentPositions = {
        'tc-1': { start: 1, end: 5, bounds: { top: 0, left: 0 } },
        'tc-2': { start: 10, end: 15, bounds: { top: 0, left: 0 } },
        'tc-3': { start: 20, end: 25, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating).toEqual([]);
    });

    it('excludes unresolved tracked change when positions are cleared (regression: SD-2071)', () => {
      store.commentsList = [
        { commentId: 'tc-1', trackedChange: true, resolvedTime: null, createdTime: 1, selection: {} },
      ];
      // Undo removed the mark — positions are now empty
      store.editorCommentPositions = {};

      const floating = store.getFloatingComments;
      expect(floating).toEqual([]);
    });

    it('keeps PDF comments visible when editor positions are empty (SD-2071)', () => {
      store.commentsList = [{ commentId: 'pdf-1', createdTime: 1, selection: { source: 'pdf', selectionBounds: {} } }];
      store.editorCommentPositions = {};

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['pdf-1']);
    });
  });

  describe('getFloatingComments coalesces a tracked whole-table change', () => {
    // Wire the mock document to expose an editor state so the store can
    // enumerate tracked-table ranges for its comments.
    const wireEditorWithTable = () => {
      const state = { doc: {} };
      __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx', getEditor: () => ({ state }) }];
      return state;
    };

    it('suppresses an inline tracked-change bubble inside a tracked inserted table (only the structural bubble remains)', () => {
      wireEditorWithTable();
      // Tracked whole-table insert covering [10, 30].
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        { decidable: true, wholeTable: true, tableFrom: 10, tableTo: 30, subtype: 'table-insert', side: 'insertion' },
      ]);

      store.commentsList = [
        // Structural "Added table" bubble — must stay.
        {
          commentId: 'word:structural:2',
          fileId: 'doc-1',
          trackedChange: true,
          trackedChangeDisplayType: 'tableInsert',
          resolvedTime: null,
          createdTime: 1,
        },
        // Inline TC bubble inside the table [15, 20] — must be suppressed.
        {
          commentId: 'inline-ins-1',
          fileId: 'doc-1',
          trackedChange: true,
          resolvedTime: null,
          createdTime: 2,
        },
      ];
      store.editorCommentPositions = {
        'word:structural:2': { start: 10, end: 30, bounds: { top: 0, left: 0 } },
        'inline-ins-1': { start: 15, end: 20, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['word:structural:2']);
    });

    it('keeps an inline tracked-change bubble inside a NON-tracked table (table itself not tracked)', () => {
      wireEditorWithTable();
      // No decidable whole-table change → no suppression ranges.
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([]);

      store.commentsList = [
        {
          commentId: 'inline-in-plain-table',
          fileId: 'doc-1',
          trackedChange: true,
          resolvedTime: null,
          createdTime: 1,
        },
      ];
      store.editorCommentPositions = {
        'inline-in-plain-table': { start: 15, end: 20, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId)).toEqual(['inline-in-plain-table']);
    });

    it('does not suppress real user comments inside a tracked table, nor inline TC outside it', () => {
      wireEditorWithTable();
      trackChangesHelpersMock.enumerateStructuralRowChanges.mockReturnValue([
        { decidable: true, wholeTable: true, tableFrom: 10, tableTo: 30, subtype: 'table-insert', side: 'insertion' },
      ]);

      store.commentsList = [
        // Real user comment inside the table range — must stay (not a TC).
        {
          commentId: 'user-comment',
          fileId: 'doc-1',
          trackedChange: false,
          resolvedTime: null,
          createdTime: 1,
          selection: { source: 'super-editor' },
        },
        // Inline TC OUTSIDE the table [40, 45] — must stay.
        {
          commentId: 'inline-outside',
          fileId: 'doc-1',
          trackedChange: true,
          resolvedTime: null,
          createdTime: 2,
        },
      ];
      store.editorCommentPositions = {
        'user-comment': { start: 16, end: 18, bounds: { top: 0, left: 0 } },
        'inline-outside': { start: 40, end: 45, bounds: { top: 0, left: 0 } },
      };

      const floating = store.getFloatingComments;
      expect(floating.map((c) => c.commentId).sort()).toEqual(['inline-outside', 'user-comment']);
    });
  });

  describe('translateCommentsForExport', () => {
    // Synthetic tracked-change projection rows (one per revision, for the
    // sidebar) must not reach the DOCX exporter: convertHtmlToSchema('') still
    // yields one empty paragraph, so a synthesized commentJSON reads as a
    // truthy body downstream and the row would export as an empty <w:comment>.
    it('skips synthetic tracked-change rows but keeps real comments, including imported comments-on-revisions', () => {
      const asModel = (values) => ({ ...values, getValues: () => values });
      store.commentsList = [
        // Synthetic sidebar row: identity IS the tracked change, no body.
        asModel({
          commentId: 'change-1',
          trackedChange: true,
          trackedChangeText: 'inserted text excerpt',
          commentText: '',
        }),
        // Genuine user comment.
        asModel({
          commentId: 'real-1',
          trackedChange: false,
          commentText: '<p>Looks good</p>',
        }),
        // Imported comment ANCHORED ON a revision: round-trips the
        // custom:trackedChange flag but carries a genuine DOCX body — must export.
        asModel({
          commentId: 'imported-on-revision',
          trackedChange: true,
          commentText: '',
          docxCommentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'imported body' }] }],
        }),
      ];

      const exported = store.translateCommentsForExport();

      expect(exported.map((c) => c.commentId).sort()).toEqual(['imported-on-revision', 'real-1']);
      // Every exported row carries a commentJSON body; the synthetic row is gone
      // rather than exported with a synthesized empty-paragraph body.
      exported.forEach((c) => expect(Array.isArray(c.commentJSON) && c.commentJSON.length > 0).toBe(true));
    });
  });
});
