/**
 * Unit tests for `EditorHistorySnapshotAdapter`.
 *
 * These cover the two backend-specific read paths:
 *   1. PM-backed editors — depth comes from prosemirror-history.
 *   2. Yjs-backed editors — depth comes from the y-prosemirror UndoManager.
 *
 * The Yjs cases double as the Phase 5 collaboration invariants: because the
 * adapter reads `undoStack.length` (not transaction counts), remote edits
 * that don't enter the local UndoManager cannot create global-history
 * entries downstream.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ------------------------------------------------------------------

const { mockUndoDepth, mockRedoDepth, mockRunEditorUndo, mockRunEditorRedo, mockGetPluginState } = vi.hoisted(() => ({
  mockUndoDepth: vi.fn(),
  mockRedoDepth: vi.fn(),
  mockRunEditorUndo: vi.fn(),
  mockRunEditorRedo: vi.fn(),
  mockGetPluginState: vi.fn(),
}));

vi.mock('prosemirror-history', () => ({
  undoDepth: mockUndoDepth,
  redoDepth: mockRedoDepth,
}));

vi.mock('y-prosemirror', () => ({
  yUndoPluginKey: {
    getState: mockGetPluginState,
  },
}));

vi.mock('../../../extensions/history/history.js', () => ({
  runEditorUndo: mockRunEditorUndo,
  runEditorRedo: mockRunEditorRedo,
}));

// Import AFTER the mocks are registered.
import { EditorHistorySnapshotAdapter } from './editor-history-snapshot-adapter.js';
import type { Editor } from '../../Editor.js';

type FakeEditor = Partial<Editor> & {
  state?: unknown;
  options: { collaborationProvider?: unknown; ydoc?: unknown };
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

const buildEditor = (overrides: Partial<FakeEditor> = {}): FakeEditor => ({
  state: { type: 'fake-state' } as unknown,
  options: {},
  on: vi.fn(),
  off: vi.fn(),
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EditorHistorySnapshotAdapter — PM-backed editors', () => {
  it('reads undo/redo depth from prosemirror-history', () => {
    mockUndoDepth.mockReturnValue(3);
    mockRedoDepth.mockReturnValue(1);

    const editor = buildEditor();
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 3, redoDepth: 1 });
  });

  it('returns zero depths when the editor has no state', () => {
    const editor = buildEditor({ state: undefined });
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 0, redoDepth: 0 });
    expect(mockUndoDepth).not.toHaveBeenCalled();
  });

  it('swallows prosemirror-history errors and reports zeros', () => {
    mockUndoDepth.mockImplementation(() => {
      throw new Error('boom');
    });
    const editor = buildEditor();
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 0, redoDepth: 0 });
  });

  it('subscribes to the editor transaction stream and returns an unsubscribe', () => {
    const on = vi.fn();
    const off = vi.fn();
    const editor = buildEditor({ on, off });
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);
    const listener = vi.fn();

    const unsubscribe = adapter.subscribe(listener);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe('transaction');

    const transactionHandler = on.mock.calls[0]?.[1];
    expect(transactionHandler).toEqual(expect.any(Function));

    transactionHandler?.({ transaction: { docChanged: true, getMeta: () => undefined } });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(off).toHaveBeenCalledWith('transaction', transactionHandler);
  });
});

describe('EditorHistorySnapshotAdapter — Yjs-backed editors', () => {
  const yjsEditor = (stacks: { undoStack: unknown[]; redoStack: unknown[] } | null): FakeEditor =>
    buildEditor({
      options: { collaborationProvider: {}, ydoc: {} },
    });

  it('reads depth from the y-prosemirror UndoManager stacks', () => {
    mockGetPluginState.mockReturnValue({
      undoManager: { undoStack: [1, 2], redoStack: [3] },
    });

    const adapter = new EditorHistorySnapshotAdapter(yjsEditor({ undoStack: [1, 2], redoStack: [3] }) as Editor);

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 2, redoDepth: 1 });
    // PM-history helpers must not be invoked on a Yjs-backed editor.
    expect(mockUndoDepth).not.toHaveBeenCalled();
    expect(mockRedoDepth).not.toHaveBeenCalled();
  });

  it('reports zero depths when the UndoManager plugin state is missing', () => {
    mockGetPluginState.mockReturnValue(undefined);

    const adapter = new EditorHistorySnapshotAdapter(yjsEditor(null) as Editor);

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 0, redoDepth: 0 });
  });

  it('is immune to "remote edit" transactions that do not touch the UndoManager', () => {
    // Simulate the y-prosemirror invariant: remote updates arrive as
    // transactions but never extend the local UndoManager stacks.
    const stacks = { undoStack: [] as unknown[], redoStack: [] as unknown[] };
    mockGetPluginState.mockReturnValue({ undoManager: stacks });

    const adapter = new EditorHistorySnapshotAdapter(yjsEditor(stacks) as Editor);
    const listener = vi.fn();
    let transactionHandler: (() => void) | undefined;
    const editor = buildEditor({
      options: { collaborationProvider: {}, ydoc: {} },
      on: (_event, handler) => {
        transactionHandler = handler;
      },
      off: vi.fn(),
    });
    const yjsAdapter = new EditorHistorySnapshotAdapter(editor as Editor);
    yjsAdapter.subscribe(listener);

    // Two remote-style transactions fire. The UndoManager stacks remain
    // empty, so a coordinator reading snapshots would observe no delta.
    transactionHandler?.();
    transactionHandler?.();

    expect(yjsAdapter.getSnapshot()).toEqual({ undoDepth: 0, redoDepth: 0 });
    expect(adapter.getSnapshot()).toEqual({ undoDepth: 0, redoDepth: 0 });
  });
});

describe('EditorHistorySnapshotAdapter — late collaboration upgrade', () => {
  it('switches to Yjs history after a local editor is upgraded in place', () => {
    mockUndoDepth.mockReturnValue(0);
    mockRedoDepth.mockReturnValue(0);
    mockGetPluginState.mockReturnValue({
      undoManager: { undoStack: [1], redoStack: [] },
    });

    const editor = buildEditor();
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);

    editor.options.collaborationProvider = {};
    editor.options.ydoc = {};

    expect(adapter.getSnapshot()).toEqual({ undoDepth: 1, redoDepth: 0 });
    expect(mockUndoDepth).not.toHaveBeenCalled();
    expect(mockRedoDepth).not.toHaveBeenCalled();
  });
});

describe('EditorHistorySnapshotAdapter — command delegation', () => {
  it('undo() / redo() delegate to the shared history helpers', () => {
    mockRunEditorUndo.mockReturnValue(true);
    mockRunEditorRedo.mockReturnValue(false);

    const editor = buildEditor();
    const adapter = new EditorHistorySnapshotAdapter(editor as Editor);

    expect(adapter.undo()).toBe(true);
    expect(mockRunEditorUndo).toHaveBeenCalledWith(editor);
    expect(adapter.redo()).toBe(false);
    expect(mockRunEditorRedo).toHaveBeenCalledWith(editor);
  });
});
