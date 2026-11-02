import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import {
  isV2CommentsAdapter,
  isV2TrackedChangesAdapter,
  type V2CommentsAdapter,
  type V2TrackedChangesAdapter,
} from '../stores/helpers/v2-review-adapters.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from './v2-review-adapters.js';

describe('makeV2CommentsAdapter', () => {
  it('returns a complete comments adapter with neutral defaults', async () => {
    const adapter = makeV2CommentsAdapter();
    expectTypeOf(adapter).toExtend<V2CommentsAdapter>();
    expect(isV2CommentsAdapter(adapter)).toBe(true);
    expect(adapter.documentId).toBe('doc-1');
    expect(await adapter.resolve({ commentId: 'c1' })).toEqual({ ok: true });
    expect(adapter.mapV2CommentToUseCommentInput({}, { fileId: null, fileType: null })).toBeNull();
    expect(adapter.resolve).toHaveBeenCalledWith({ commentId: 'c1' });
  });

  it('keeps overrides, including members outside the store contract, and stays complete', () => {
    const refresh = vi.fn(async () => ({ ok: true, items: [] }));
    const resolve = vi.fn(async () => ({ ok: false, reason: 'blocked' }));
    const adapter = makeV2CommentsAdapter({ documentId: null, resolve, refresh });
    expectTypeOf(adapter).toExtend<V2CommentsAdapter>();
    expect(isV2CommentsAdapter(adapter)).toBe(true);
    expect(adapter.documentId).toBeNull();
    expect(adapter.resolve).toBe(resolve);
    expect(adapter.refresh).toBe(refresh);
  });
});

describe('makeV2TrackedChangesAdapter', () => {
  it('returns a complete tracked-changes adapter with neutral defaults', async () => {
    const adapter = makeV2TrackedChangesAdapter();
    expectTypeOf(adapter).toExtend<V2TrackedChangesAdapter>();
    expect(isV2TrackedChangesAdapter(adapter)).toBe(true);
    expect(adapter.documentId).toBe('doc-1');
    expect(await adapter.accept('tc-1')).toEqual({ ok: true });
    expect(adapter.mapV2TrackedChangeToCommentParams({})).toBeNull();
  });

  it('keeps overrides and stays complete', () => {
    const listTrackedChanges = vi.fn(async () => ({ ok: true, items: [] }));
    const mapV2TrackedChangeToCommentParams = vi.fn(() => ({ event: 'omit' }));
    const adapter = makeV2TrackedChangesAdapter({
      documentId: 'doc-2',
      listTrackedChanges,
      mapV2TrackedChangeToCommentParams,
    });
    expectTypeOf(adapter).toExtend<V2TrackedChangesAdapter>();
    expect(isV2TrackedChangesAdapter(adapter)).toBe(true);
    expect(adapter.documentId).toBe('doc-2');
    expect(adapter.listTrackedChanges).toBe(listTrackedChanges);
    expect(adapter.mapV2TrackedChangeToCommentParams).toBe(mapV2TrackedChangeToCommentParams);
  });
});
