import { describe, expect, it, mock } from 'bun:test';
import type { HistoryAdapter } from './history.js';
import {
  executeHistoryGet,
  executeHistoryUndo,
  executeHistoryRedo,
  executeHistoryBeginGroup,
  executeHistoryEndGroup,
} from './history.js';
import type { HistoryState, HistoryActionResult } from './history.types.js';

function makeHistoryAdapter(
  overrides?: Partial<{
    state: HistoryState;
    undoResult: HistoryActionResult;
    redoResult: HistoryActionResult;
  }>,
): HistoryAdapter {
  const state: HistoryState = overrides?.state ?? {
    undoDepth: 3,
    redoDepth: 1,
    canUndo: true,
    canRedo: true,
    historyUnsafeOperations: ['styles.apply'],
  };
  const undoResult: HistoryActionResult = overrides?.undoResult ?? {
    noop: false,
    revision: { before: '5', after: '6' },
  };
  const redoResult: HistoryActionResult = overrides?.redoResult ?? {
    noop: false,
    revision: { before: '6', after: '7' },
  };

  return {
    get: mock(() => state),
    undo: mock(() => undoResult),
    redo: mock(() => redoResult),
  };
}

describe('history execute functions', () => {
  describe('executeHistoryGet', () => {
    it('delegates to the adapter and returns HistoryState', () => {
      const adapter = makeHistoryAdapter();
      const result = executeHistoryGet(adapter);

      expect(adapter.get).toHaveBeenCalledOnce();
      expect(result).toEqual({
        undoDepth: 3,
        redoDepth: 1,
        canUndo: true,
        canRedo: true,
        historyUnsafeOperations: ['styles.apply'],
      });
    });

    it('returns empty state when adapter reports no history', () => {
      const adapter = makeHistoryAdapter({
        state: {
          undoDepth: 0,
          redoDepth: 0,
          canUndo: false,
          canRedo: false,
          historyUnsafeOperations: [],
        },
      });
      const result = executeHistoryGet(adapter);

      expect(result.canUndo).toBe(false);
      expect(result.canRedo).toBe(false);
      expect(result.undoDepth).toBe(0);
      expect(result.redoDepth).toBe(0);
    });
  });

  describe('executeHistoryUndo', () => {
    it('delegates to the adapter and returns HistoryActionResult', () => {
      const adapter = makeHistoryAdapter();
      const result = executeHistoryUndo(adapter);

      expect(adapter.undo).toHaveBeenCalledOnce();
      expect(result).toEqual({
        noop: false,
        revision: { before: '5', after: '6' },
      });
    });

    it('returns noop when undo stack is empty', () => {
      const adapter = makeHistoryAdapter({
        undoResult: { noop: true, revision: { before: '3', after: '3' } },
      });
      const result = executeHistoryUndo(adapter);

      expect(result.noop).toBe(true);
      expect(result.revision.before).toBe(result.revision.after);
    });
  });

  describe('executeHistoryRedo', () => {
    it('delegates to the adapter and returns HistoryActionResult', () => {
      const adapter = makeHistoryAdapter();
      const result = executeHistoryRedo(adapter);

      expect(adapter.redo).toHaveBeenCalledOnce();
      expect(result).toEqual({
        noop: false,
        revision: { before: '6', after: '7' },
      });
    });

    it('returns noop when redo stack is empty', () => {
      const adapter = makeHistoryAdapter({
        redoResult: { noop: true, revision: { before: '3', after: '3' } },
      });
      const result = executeHistoryRedo(adapter);

      expect(result.noop).toBe(true);
      expect(result.revision.before).toBe(result.revision.after);
    });
  });
});

it('delegates serializable history groups and validates before unsupported adapters', () => {
  const adapter = makeHistoryAdapter();
  expect(() => executeHistoryBeginGroup(adapter)).toThrow('History grouping is unavailable');
  expect(() => executeHistoryEndGroup(adapter, { groupId: '' })).toThrow('non-empty groupId');
  expect(() => executeHistoryEndGroup(adapter, { groupId: 'group' })).toThrow('History grouping is unavailable');
  const handle = { groupId: 'session:1' };
  const grouped = {
    ...adapter,
    beginGroup: mock(() => handle),
    endGroup: mock((input: { groupId: string }) => ({ ...input, closed: true })),
  };
  expect(executeHistoryBeginGroup(grouped)).toBe(handle);
  expect(executeHistoryEndGroup(grouped, handle)).toEqual({ ...handle, closed: true });
  expect(grouped.endGroup).toHaveBeenCalledWith(handle);
});
