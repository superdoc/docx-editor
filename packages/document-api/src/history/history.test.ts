import { describe, expect, it, mock } from 'bun:test';
import type { HistoryAdapter } from './history.js';
import { executeHistoryBeginGroup, executeHistoryEndGroup } from './history.js';
import type { HistoryActionResult, HistoryState } from './history.types.js';

function makeHistoryAdapter(): HistoryAdapter {
  const state: HistoryState = {
    undoDepth: 0,
    redoDepth: 0,
    canUndo: false,
    canRedo: false,
    historyUnsafeOperations: [],
  };
  const result: HistoryActionResult = { noop: true, revision: { before: '0', after: '0' } };
  return { get: () => state, undo: () => result, redo: () => result };
}

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
