import { describe, expect, it, mock } from 'bun:test';
import {
  executeCommentsCreate,
  executeCommentsPatch,
  executeCommentsDelete,
  executeGetComment,
  executeListComments,
} from './comments.js';

const stubAdapter = () =>
  ({
    add: mock(() => ({
      success: true,
      id: 'c1',
      inserted: [{ kind: 'entity', entityType: 'comment', entityId: 'c1' }],
    })),
    edit: mock(() => ({ success: true })),
    reply: mock(() => ({
      success: true,
      id: 'c2',
      inserted: [{ kind: 'entity', entityType: 'comment', entityId: 'c2' }],
    })),
    move: mock(() => ({ success: true })),
    resolve: mock(() => ({ success: true })),
    reopen: mock(() => ({ success: true })),
    remove: mock(() => ({ success: true })),
    setInternal: mock(() => ({ success: true })),
    setActive: mock(() => ({ success: true })),
    goTo: mock(() => ({ success: true })),
    get: mock(() => ({ commentId: 'c1', status: 'open' })),
    list: mock(() => ({ items: [], total: 0 })),
  }) as any;

describe('executeCommentsCreate parentId alias', () => {
  it('accepts the public parentId and threads the reply', () => {
    const adapter = stubAdapter();
    const receipt = executeCommentsCreate(adapter, { text: 'Reply body', parentId: 'c1' });

    expect(receipt.success).toBe(true);
    expect(adapter.reply).toHaveBeenCalledWith({ parentCommentId: 'c1', text: 'Reply body' }, undefined);
  });

  it('accepts both parent keys when they agree', () => {
    const adapter = stubAdapter();
    executeCommentsCreate(adapter, { text: 'Reply body', parentId: 'c1', parentCommentId: 'c1' });

    expect(adapter.reply).toHaveBeenCalledWith({ parentCommentId: 'c1', text: 'Reply body' }, undefined);
  });

  it('rejects conflicting parent keys before calling the adapter', () => {
    const adapter = stubAdapter();
    const invoke = () => executeCommentsCreate(adapter, { text: 'Reply body', parentId: 'c1', parentCommentId: 'c2' });

    expect(invoke).toThrow(/disagree/);
    try {
      invoke();
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(adapter.reply).not.toHaveBeenCalled();
    expect(adapter.add).not.toHaveBeenCalled();
  });
});

describe('executeCommentsCreate validation', () => {
  it('rejects null input with INVALID_INPUT', () => {
    expect(() => executeCommentsCreate(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects non-string text with INVALID_INPUT', () => {
    const target = { kind: 'text', blockId: 'b1', range: { start: 0, end: 5 } };
    expect(() => executeCommentsCreate(stubAdapter(), { text: 123, target } as any)).toThrow(/text must be a string/);
  });

  it('uses INVALID_INPUT code (not INVALID_TARGET) for input shape errors', () => {
    try {
      executeCommentsCreate(stubAdapter(), null as any);
    } catch (e: any) {
      expect(e.code).toBe('INVALID_INPUT');
    }
  });

  it('accepts a text SelectionTarget and forwards it to the adapter', () => {
    const adapter = stubAdapter();
    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'b1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'b1', offset: 5 },
    };
    executeCommentsCreate(adapter, { text: 'comment', target });
    expect(adapter.add).toHaveBeenCalledWith({ text: 'comment', target }, undefined);
  });

  it('returns the created comment id on success', () => {
    const adapter = stubAdapter();
    const target = { kind: 'text', blockId: 'b1', range: { start: 0, end: 5 } };
    const receipt = executeCommentsCreate(adapter, { text: 'hello', target });
    expect(receipt.success).toBe(true);
    expect(receipt.id).toBe('c1');
  });

  it('forwards durable external identity, V1-compatible authorship, and metadata for roots and replies', () => {
    const adapter = stubAdapter();
    const target = { kind: 'text' as const, blockId: 'b1', range: { start: 0, end: 5 } };
    const correlation = {
      externalId: 'external-comment-42',
      author: 'External Reviewer',
      authorId: 'external-user-7',
      authorEmail: 'reviewer@example.test',
      authorImage: 'https://example.test/reviewer.png',
      metadata: {
        verdict: 'verified',
        review: { id: 'review-9', statementIds: ['s-1', 's-2'] },
      },
    };

    executeCommentsCreate(adapter, { target, text: 'Root finding', ...correlation });
    executeCommentsCreate(adapter, {
      parentCommentId: 'c1',
      text: 'Reply finding',
      ...correlation,
      externalId: 'external-comment-43',
    });

    expect(adapter.add).toHaveBeenCalledWith({ target, text: 'Root finding', ...correlation }, undefined);
    expect(adapter.reply).toHaveBeenCalledWith(
      {
        parentCommentId: 'c1',
        text: 'Reply finding',
        ...correlation,
        externalId: 'external-comment-43',
      },
      undefined,
    );
  });

  it('normalizes the V1 caller-supplied commentId to externalId for roots and replies', () => {
    const adapter = stubAdapter();
    const target = { kind: 'text' as const, blockId: 'b1', range: { start: 0, end: 5 } };

    executeCommentsCreate(adapter, {
      target,
      text: 'Root finding',
      commentId: 'external-comment-42',
      author: 'External Reviewer',
    });
    executeCommentsCreate(adapter, {
      parentCommentId: 'external-comment-42',
      text: 'Reply finding',
      commentId: 'external-comment-43',
    });

    expect(adapter.add).toHaveBeenCalledWith(
      {
        target,
        text: 'Root finding',
        externalId: 'external-comment-42',
        author: 'External Reviewer',
      },
      undefined,
    );
    expect(adapter.reply).toHaveBeenCalledWith(
      {
        parentCommentId: 'external-comment-42',
        text: 'Reply finding',
        externalId: 'external-comment-43',
      },
      undefined,
    );
  });

  it('rejects conflicting caller-supplied commentId and externalId before dispatch', () => {
    const adapter = stubAdapter();
    const target = { kind: 'text' as const, blockId: 'b1', range: { start: 0, end: 5 } };

    expect(() =>
      executeCommentsCreate(adapter, {
        target,
        text: 'Finding',
        commentId: 'external-comment-42',
        externalId: 'different-comment-42',
      }),
    ).toThrow(/commentId and externalId disagree/);
    expect(adapter.add).not.toHaveBeenCalled();
    expect(adapter.reply).not.toHaveBeenCalled();
  });

  it('rejects invalid attribution and lossy metadata before dispatch', () => {
    const adapter = stubAdapter();
    const target = { kind: 'text' as const, blockId: 'b1', range: { start: 0, end: 5 } };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => executeCommentsCreate(adapter, { target, text: 'Finding', externalId: '   ' })).toThrow(
      /externalId must be a non-empty string/,
    );
    expect(() => executeCommentsCreate(adapter, { target, text: 'Finding', externalId: '🚀'.repeat(1_025) })).toThrow(
      /externalId must be at most 1024 characters/,
    );
    expect(() => executeCommentsCreate(adapter, { target, text: 'Finding', metadata: cyclic as any })).toThrow(
      /cyclic values are not supported/,
    );
    expect(() =>
      executeCommentsCreate(adapter, { target, text: 'Finding', metadata: { confidence: Number.NaN } }),
    ).toThrow(/numbers must be finite/);
    expect(adapter.add).not.toHaveBeenCalled();
  });
});

describe('executeCommentsCreate expectedText (SD-6055)', () => {
  const selection = {
    kind: 'selection' as const,
    start: { kind: 'text' as const, blockId: 'b1', offset: 6 },
    end: { kind: 'text' as const, blockId: 'b1', offset: 13 },
  };

  it.each([
    ['SelectionTarget', selection],
    ['TextAddress', { kind: 'text' as const, blockId: 'b1', range: { start: 6, end: 13 } }],
    ['one-segment TextTarget', { kind: 'text' as const, segments: [{ blockId: 'b1', range: { start: 6, end: 13 } }] }],
  ])('passes expectedText to the adapter for a %s', (_name, target) => {
    const adapter = stubAdapter();
    executeCommentsCreate(adapter, { text: 'comment', target, expectedText: 'Revenue' });
    expect(adapter.add).toHaveBeenCalledWith({ text: 'comment', target, expectedText: 'Revenue' }, undefined);
  });

  it.each([
    ['a non-string value', { target: selection, expectedText: 7 }],
    [
      'a cross-paragraph selection',
      { target: { ...selection, end: { ...selection.end, blockId: 'b2' } }, expectedText: 'x' },
    ],
    [
      'a multi-segment TextTarget',
      {
        target: {
          kind: 'text',
          segments: [
            { blockId: 'b1', range: { start: 6, end: 9 } },
            { blockId: 'b2', range: { start: 0, end: 2 } },
          ],
        },
        expectedText: 'x',
      },
    ],
    [
      'a tracked TextTarget',
      {
        target: {
          kind: 'text',
          coordinateSpace: 'tracked',
          segments: [{ blockId: 'b1', range: { start: 6, end: 13 } }],
        },
        expectedText: 'x',
      },
    ],
    ['a tracked-change target', { target: { trackedChangeId: 'tc-1' }, expectedText: 'x' }],
    ['the trackedChangeId shorthand', { trackedChangeId: 'tc-1', expectedText: 'x' }],
    ['a text-search target', { target: { text: 'Revenue' }, expectedText: 'Revenue' }],
    ['a reply', { parentCommentId: 'c1', expectedText: 'x' }],
  ])('rejects expectedText with %s before calling the adapter', (_name, input) => {
    const adapter = stubAdapter();
    expect(() => executeCommentsCreate(adapter, { text: 'comment', ...input } as any)).toThrow(
      /expectedText requires a string and an explicit single-paragraph text target/,
    );
    expect(adapter.add).not.toHaveBeenCalled();
    expect(adapter.reply).not.toHaveBeenCalled();
  });
});

describe('executeCommentsPatch validation', () => {
  it('rejects null input', () => {
    expect(() => executeCommentsPatch(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects non-string text', () => {
    expect(() => executeCommentsPatch(stubAdapter(), { commentId: 'c1', text: 123 } as any)).toThrow(
      /text must be a string/,
    );
  });

  it('rejects non-boolean isInternal', () => {
    expect(() => executeCommentsPatch(stubAdapter(), { commentId: 'c1', isInternal: 'yes' } as any)).toThrow(
      /isInternal must be a boolean/,
    );
  });

  it('rejects invalid status', () => {
    expect(() => executeCommentsPatch(stubAdapter(), { commentId: 'c1', status: 'open' } as any)).toThrow(
      /must be "resolved" or "active"/,
    );
  });

  it('accepts valid text patch', () => {
    const adapter = stubAdapter();
    executeCommentsPatch(adapter, { commentId: 'c1', text: 'updated' });
    expect(adapter.edit).toHaveBeenCalled();
  });

  it('accepts valid isInternal patch', () => {
    const adapter = stubAdapter();
    executeCommentsPatch(adapter, { commentId: 'c1', isInternal: true });
    expect(adapter.setInternal).toHaveBeenCalled();
  });

  it('routes status:"resolved" to adapter.resolve', () => {
    const adapter = stubAdapter();
    executeCommentsPatch(adapter, { commentId: 'c1', status: 'resolved' });
    expect(adapter.resolve).toHaveBeenCalledWith({ commentId: 'c1' }, undefined);
    expect(adapter.reopen).not.toHaveBeenCalled();
  });

  it('routes status:"active" to adapter.reopen (lifecycle inverse of resolve)', () => {
    const adapter = stubAdapter();
    executeCommentsPatch(adapter, { commentId: 'c1', status: 'active' });
    expect(adapter.reopen).toHaveBeenCalledWith({ commentId: 'c1' }, undefined);
    expect(adapter.resolve).not.toHaveBeenCalled();
  });
});

describe('executeCommentsDelete validation', () => {
  it('rejects null input', () => {
    expect(() => executeCommentsDelete(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects non-string commentId', () => {
    expect(() => executeCommentsDelete(stubAdapter(), { commentId: 42 } as any)).toThrow(/non-empty string/);
  });

  it('rejects empty commentId', () => {
    expect(() => executeCommentsDelete(stubAdapter(), { commentId: '' })).toThrow(/non-empty string/);
  });

  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeCommentsDelete(adapter, { commentId: 'c1' });
    expect(adapter.remove).toHaveBeenCalledWith({ commentId: 'c1' }, undefined);
  });
});

describe('executeGetComment validation', () => {
  it('rejects null input', () => {
    expect(() => executeGetComment(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects non-string commentId', () => {
    expect(() => executeGetComment(stubAdapter(), { commentId: 42 } as any)).toThrow(/non-empty string/);
  });

  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeGetComment(adapter, { commentId: 'c1' });
    expect(adapter.get).toHaveBeenCalled();
  });
});

describe('executeListComments validation', () => {
  it('accepts undefined query', () => {
    const adapter = stubAdapter();
    executeListComments(adapter);
    expect(adapter.list).toHaveBeenCalled();
  });

  it('rejects non-object query', () => {
    expect(() => executeListComments(stubAdapter(), 'bad' as any)).toThrow(/must be an object/);
  });

  it('accepts valid query', () => {
    const adapter = stubAdapter();
    executeListComments(adapter, { includeResolved: true });
    expect(adapter.list).toHaveBeenCalledWith({ includeResolved: true });
  });
});
