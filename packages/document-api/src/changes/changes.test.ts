import { describe, expect, it, mock } from 'bun:test';
import type { ChangesAdapter } from './changes.js';
import {
  CHANGES_LIST_LIMIT_MAX,
  CHANGES_WAIT_MS_MAX,
  executeChangesActors,
  executeChangesGet,
  executeChangesList,
  executeChangesResolve,
  executeChangesSnapshot,
} from './changes.js';
import type { ChangesListResult } from './changes.types.js';

const EMPTY_LIST: ChangesListResult = {
  items: [],
  cursor: null,
  truncated: false,
  identity: 'missing',
  collaboration: false,
};

function makeAdapter(): ChangesAdapter {
  return {
    list: mock(async () => EMPTY_LIST),
    get: mock(async () => null),
    resolve: mock(async () => ({ blockId: 'p1', lineage: ['p1'], items: [] })),
    actors: mock(async () => ({ items: [] })),
    snapshot: mock(async () => ({ revision: '0', cursor: null, lastChangeId: null, stateVector: '', at: 'now' })),
  };
}

describe('changes.list validation', () => {
  it('accepts the full documented input at its bounds', async () => {
    const adapter = makeAdapter();
    const input = {
      after: '12',
      limit: CHANGES_LIST_LIMIT_MAX,
      story: { kind: 'story' as const, storyType: 'body' as const },
      blockId: 'p1',
      actorId: 'user-1',
      includeUpdate: true,
      waitMs: CHANGES_WAIT_MS_MAX,
    };
    expect(await executeChangesList(adapter, input)).toBe(EMPTY_LIST);
    expect(adapter.list).toHaveBeenCalledWith(input);
  });

  it('accepts the lower bounds of limit and waitMs', async () => {
    const adapter = makeAdapter();
    await executeChangesList(adapter, { limit: 1, waitMs: 0 });
    expect(adapter.list).toHaveBeenCalledWith({ limit: 1, waitMs: 0 });
  });

  it.each([
    ['limit below range', { limit: 0 }],
    ['limit above range', { limit: CHANGES_LIST_LIMIT_MAX + 1 }],
    ['fractional limit', { limit: 1.5 }],
    ['negative waitMs', { waitMs: -1 }],
    ['waitMs above range', { waitMs: CHANGES_WAIT_MS_MAX + 1 }],
    ['empty after cursor', { after: '' }],
    ['numeric after cursor', { after: 3 }],
    ['empty blockId', { blockId: '' }],
    ['empty actorId', { actorId: '' }],
    ['non-boolean includeUpdate', { includeUpdate: 'yes' }],
    ['invalid story', { story: { kind: 'body' } }],
    ['null story', { story: null }],
    ['unknown field', { since: '1' }],
  ])('rejects %s', async (_label, input) => {
    const adapter = makeAdapter();
    await expect(executeChangesList(adapter, input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.list).not.toHaveBeenCalled();
  });

  it('rejects a non-object input', async () => {
    await expect(executeChangesList(makeAdapter(), 'all' as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('changes.get validation', () => {
  it('delegates a non-empty id', async () => {
    const adapter = makeAdapter();
    expect(await executeChangesGet(adapter, { id: 'abc' })).toBeNull();
    expect(adapter.get).toHaveBeenCalledWith({ id: 'abc' });
  });

  it.each([
    ['an empty id', { id: '' }],
    ['a missing id', {}],
    ['a numeric id', { id: 1 }],
    ['a null input', null],
    ['an unknown field', { id: 'abc', extra: true }],
  ])('rejects %s', async (_label, input) => {
    const adapter = makeAdapter();
    await expect(executeChangesGet(adapter, input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.get).not.toHaveBeenCalled();
  });
});

describe('changes.resolve validation', () => {
  it('delegates a block id and limit', async () => {
    const adapter = makeAdapter();
    await executeChangesResolve(adapter, { blockId: 'p1', limit: 20 });
    expect(adapter.resolve).toHaveBeenCalledWith({ blockId: 'p1', limit: 20 });
  });

  it.each([
    ['an empty blockId', { blockId: '' }],
    ['a missing blockId', {}],
    ['a zero limit', { blockId: 'p1', limit: 0 }],
    ['a limit above range', { blockId: 'p1', limit: 1001 }],
  ])('rejects %s', async (_label, input) => {
    const adapter = makeAdapter();
    await expect(executeChangesResolve(adapter, input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.resolve).not.toHaveBeenCalled();
  });
});

describe('changes.actors and changes.snapshot', () => {
  it('delegates actors without input', async () => {
    const adapter = makeAdapter();
    expect(await executeChangesActors(adapter)).toEqual({ items: [] });
    expect(adapter.actors).toHaveBeenCalledTimes(1);
  });

  it('delegates snapshot with and without includeState', async () => {
    const adapter = makeAdapter();
    await executeChangesSnapshot(adapter);
    await executeChangesSnapshot(adapter, { includeState: true });
    expect(adapter.snapshot).toHaveBeenNthCalledWith(1, {});
    expect(adapter.snapshot).toHaveBeenNthCalledWith(2, { includeState: true });
  });

  it('rejects a non-boolean includeState', async () => {
    const adapter = makeAdapter();
    await expect(executeChangesSnapshot(adapter, { includeState: 1 } as never)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(adapter.snapshot).not.toHaveBeenCalled();
  });
});

describe('missing changes adapter', () => {
  it('rejects every operation with CAPABILITY_UNAVAILABLE after validating input', async () => {
    await expect(executeChangesList(undefined)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(executeChangesGet(undefined, { id: 'a' })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(executeChangesResolve(undefined, { blockId: 'p1' })).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    await expect(executeChangesActors(undefined)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(executeChangesSnapshot(undefined)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(executeChangesList(undefined, { limit: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
