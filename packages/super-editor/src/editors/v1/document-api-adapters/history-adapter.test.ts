import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Editor } from '../core/Editor.js';
import { createHistoryAdapter } from './history-adapter.js';

const { undoDepthMock, redoDepthMock, yGetStateMock } = vi.hoisted(() => ({
  undoDepthMock: vi.fn(() => 0),
  redoDepthMock: vi.fn(() => 0),
  yGetStateMock: vi.fn(() => undefined),
}));

const { listCommentAnchorsMock, reconcileCommentEntityStoreWithAnchorsMock } = vi.hoisted(() => ({
  listCommentAnchorsMock: vi.fn(() => []),
  reconcileCommentEntityStoreWithAnchorsMock: vi.fn(() => ({ restored: [], removed: [] })),
}));

vi.mock('prosemirror-history', () => ({
  undoDepth: undoDepthMock,
  redoDepth: redoDepthMock,
}));

vi.mock('y-prosemirror', () => ({
  yUndoPluginKey: {
    getState: yGetStateMock,
  },
}));

vi.mock('./helpers/comment-target-resolver.js', () => ({
  listCommentAnchors: listCommentAnchorsMock,
}));

vi.mock('./helpers/comment-entity-store.js', () => ({
  reconcileCommentEntityStoreWithAnchors: reconcileCommentEntityStoreWithAnchorsMock,
}));

function makeEditor(overrides: Partial<Editor> = {}): Editor {
  return {
    options: {},
    state: { tr: {} } as Editor['state'],
    emit: vi.fn(),
    commands: {
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
    } as unknown as Editor['commands'],
    ...overrides,
  } as unknown as Editor;
}

function makeRootPresentationOwner(
  editor: Editor,
  overrides: Partial<{
    undo: () => boolean;
    redo: () => boolean;
    getHistoryState: () => { undoDepth: number; redoDepth: number; canUndo: boolean; canRedo: boolean };
  }> = {},
) {
  return {
    editor,
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    getHistoryState: vi.fn(() => ({
      undoDepth: 0,
      redoDepth: 0,
      canUndo: false,
      canRedo: false,
    })),
    ...overrides,
  };
}

describe('createHistoryAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoDepthMock.mockReturnValue(0);
    redoDepthMock.mockReturnValue(0);
    yGetStateMock.mockReturnValue(undefined);
    listCommentAnchorsMock.mockReturnValue([]);
    reconcileCommentEntityStoreWithAnchorsMock.mockReturnValue({ restored: [], removed: [] });
  });

  it('reads undo/redo depth from PM history in non-collab mode', () => {
    undoDepthMock.mockReturnValue(2);
    redoDepthMock.mockReturnValue(1);

    const adapter = createHistoryAdapter(makeEditor());
    const result = adapter.get();

    expect(undoDepthMock).toHaveBeenCalledOnce();
    expect(redoDepthMock).toHaveBeenCalledOnce();
    expect(result.undoDepth).toBe(2);
    expect(result.redoDepth).toBe(1);
    expect(result.canUndo).toBe(true);
    expect(result.canRedo).toBe(true);
    expect(result.historyUnsafeOperations).toContain('styles.apply');
  });

  it('reads undo/redo depth from yUndoPlugin in collab mode', () => {
    yGetStateMock.mockReturnValue({
      undoManager: {
        undoStack: [1, 2, 3],
        redoStack: [1],
      },
    });

    const adapter = createHistoryAdapter(
      makeEditor({
        options: {
          collaborationProvider: {},
          ydoc: {},
        } as Editor['options'],
      }),
    );

    const result = adapter.get();

    expect(yGetStateMock).toHaveBeenCalledOnce();
    expect(result.undoDepth).toBe(3);
    expect(result.redoDepth).toBe(1);
    expect(result.canUndo).toBe(true);
    expect(result.canRedo).toBe(true);
  });

  it('throws CAPABILITY_UNAVAILABLE when undo command is missing', () => {
    undoDepthMock.mockReturnValue(1);
    const adapter = createHistoryAdapter(
      makeEditor({
        commands: {
          undo: undefined,
          redo: vi.fn(() => true),
        } as unknown as Editor['commands'],
      }),
    );

    try {
      adapter.undo();
      expect.fail('Expected undo to throw');
    } catch (error: unknown) {
      expect(error).toMatchObject({ name: 'DocumentApiAdapterError', code: 'CAPABILITY_UNAVAILABLE' });
    }
  });

  it('throws CAPABILITY_UNAVAILABLE when redo command is missing', () => {
    redoDepthMock.mockReturnValue(1);
    const adapter = createHistoryAdapter(
      makeEditor({
        commands: {
          undo: vi.fn(() => true),
          redo: undefined,
        } as unknown as Editor['commands'],
      }),
    );

    try {
      adapter.redo();
      expect.fail('Expected redo to throw');
    } catch (error: unknown) {
      expect(error).toMatchObject({ name: 'DocumentApiAdapterError', code: 'CAPABILITY_UNAVAILABLE' });
    }
  });

  it('returns noop=false when undo/redo commands succeed', () => {
    undoDepthMock.mockReturnValue(1);
    redoDepthMock.mockReturnValue(1);
    const adapter = createHistoryAdapter(makeEditor());

    const undoResult = adapter.undo();
    const redoResult = adapter.redo();

    expect(undoResult.noop).toBe(false);
    expect(undoResult.reason).toBeUndefined();
    expect(redoResult.noop).toBe(false);
    expect(redoResult.reason).toBeUndefined();
    expect(undoResult.revision.before).toBeDefined();
    expect(undoResult.revision.after).toBeDefined();
    expect(redoResult.revision.before).toBeDefined();
    expect(redoResult.revision.after).toBeDefined();
  });

  it('returns EMPTY_UNDO_STACK reason when undo stack is empty', () => {
    undoDepthMock.mockReturnValue(0);
    const adapter = createHistoryAdapter(makeEditor());

    const result = adapter.undo();

    expect(result.noop).toBe(true);
    expect(result.reason).toBe('EMPTY_UNDO_STACK');
  });

  it('returns EMPTY_REDO_STACK reason when redo stack is empty', () => {
    redoDepthMock.mockReturnValue(0);
    const adapter = createHistoryAdapter(makeEditor());

    const result = adapter.redo();

    expect(result.noop).toBe(true);
    expect(result.reason).toBe('EMPTY_REDO_STACK');
  });

  it('returns NO_EFFECT when command returns false with non-empty stack', () => {
    undoDepthMock.mockReturnValue(1);
    const adapter = createHistoryAdapter(
      makeEditor({
        commands: {
          undo: vi.fn(() => false),
          redo: vi.fn(() => true),
        } as unknown as Editor['commands'],
      }),
    );

    const result = adapter.undo();

    expect(result.noop).toBe(true);
    expect(result.reason).toBe('NO_EFFECT');
  });

  it('routes root editor history through PresentationEditor when available', () => {
    const rootEditor = makeEditor();
    const presentationOwner = makeRootPresentationOwner(rootEditor, {
      getHistoryState: vi.fn(() => ({
        undoDepth: 4,
        redoDepth: 2,
        canUndo: true,
        canRedo: true,
      })),
    });
    (rootEditor as Editor & { presentationEditor?: unknown }).presentationEditor = presentationOwner;

    const adapter = createHistoryAdapter(rootEditor);

    expect(adapter.get()).toMatchObject({
      undoDepth: 4,
      redoDepth: 2,
      canUndo: true,
      canRedo: true,
    });

    adapter.undo();
    adapter.redo();

    expect(presentationOwner.undo).toHaveBeenCalledOnce();
    expect(presentationOwner.redo).toHaveBeenCalledOnce();
    expect(rootEditor.commands.undo).not.toHaveBeenCalled();
    expect(rootEditor.commands.redo).not.toHaveBeenCalled();
  });

  it('emits deleted comment lifecycle events when undo prunes a just-created orphaned root comment', () => {
    undoDepthMock.mockReturnValue(1);
    reconcileCommentEntityStoreWithAnchorsMock.mockReturnValue({
      restored: [],
      removed: [{ commentId: 'c1', commentText: 'Root', documentId: 'doc-1' }],
    });
    const editor = makeEditor({ options: { documentId: 'doc-1' } as Editor['options'] });

    const adapter = createHistoryAdapter(editor);
    const result = adapter.undo();

    expect(result.noop).toBe(false);
    expect(listCommentAnchorsMock).toHaveBeenCalledWith(editor);
    expect(reconcileCommentEntityStoreWithAnchorsMock).toHaveBeenCalledWith(editor, expect.any(Set));
    expect(editor.emit as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('commentsUpdate', {
      type: 'deleted',
      comment: {
        commentId: 'c1',
        commentText: 'Root',
        text: 'Root',
        documentId: 'doc-1',
      },
    });
  });

  it('emits add comment lifecycle events when redo restores a stashed comment thread', () => {
    redoDepthMock.mockReturnValue(1);
    listCommentAnchorsMock.mockReturnValue([{ commentId: 'c1', importedId: 'imp-1' }]);
    reconcileCommentEntityStoreWithAnchorsMock.mockReturnValue({
      removed: [],
      restored: [
        {
          commentId: 'c1',
          importedId: 'imp-1',
          commentText: 'Restored root',
          createdTime: 123,
          creatorIdentity: { providerId: 'AD', userId: 'history-account' },
          wordAuthorName: 'Original label',
        },
      ],
    });
    const editor = makeEditor();

    const adapter = createHistoryAdapter(editor);
    const result = adapter.redo();

    expect(result.noop).toBe(false);
    expect(reconcileCommentEntityStoreWithAnchorsMock).toHaveBeenCalledWith(editor, expect.any(Set));
    const anchoredIds = reconcileCommentEntityStoreWithAnchorsMock.mock.calls[0]?.[1] as Set<string>;
    expect(Array.from(anchoredIds).sort()).toEqual(['c1', 'imp-1']);
    expect(editor.emit as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('commentsUpdate', {
      type: 'add',
      comment: {
        commentId: 'c1',
        importedId: 'imp-1',
        commentText: 'Restored root',
        creatorIdentity: { providerId: 'AD', userId: 'history-account' },
        wordAuthorName: 'Original label',
        text: 'Restored root',
        createdTime: 123,
      },
    });
  });

  it('keeps sub-editor adapters surface-scoped even when a PresentationEditor exists', () => {
    undoDepthMock.mockReturnValue(1);
    redoDepthMock.mockReturnValue(0);

    const rootEditor = makeEditor();
    const subEditor = makeEditor();
    const presentationOwner = makeRootPresentationOwner(rootEditor, {
      getHistoryState: vi.fn(() => ({
        undoDepth: 9,
        redoDepth: 9,
        canUndo: true,
        canRedo: true,
      })),
    });
    (subEditor as Editor & { presentationEditor?: unknown }).presentationEditor = presentationOwner;

    const adapter = createHistoryAdapter(subEditor);
    const result = adapter.get();

    expect(result.undoDepth).toBe(1);
    expect(result.redoDepth).toBe(0);

    adapter.undo();

    expect(subEditor.commands.undo).toHaveBeenCalledOnce();
    expect(presentationOwner.undo).not.toHaveBeenCalled();
  });
});
