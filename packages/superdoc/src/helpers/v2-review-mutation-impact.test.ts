import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';

import useComment from '../components/CommentsLayer/use-comment.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import {
  applyV2CommentInvalidationFromMutation,
  collectV2InvalidatedCommentIds,
  getV2TrackedChangeMutationImpact,
} from './v2-review-mutation-impact.js';

const trackedChange = (entityId) => ({ kind: 'entity', entityType: 'trackedChange', entityId });
const commentRef = (entityId) => ({ kind: 'entity', entityType: 'comment', entityId });

function makeTrackedChangeRow(overrides = {}) {
  const commentId = overrides.commentId ?? 'tc-old';
  return useComment({
    commentId,
    fileId: 'doc-1',
    trackedChange: true,
    trackedChangeText: 'old tracked change',
    trackedChangeType: 'insert',
    trackedChangeDisplayType: 'insert',
    trackedChangeAnchorKey: overrides.trackedChangeAnchorKey ?? `tc::body::${commentId}`,
    commentText: '',
    ...overrides,
  });
}

describe('v2 review mutation impact', () => {
  it('classifies inserted and updated identities for targeted refresh', () => {
    const impact = getV2TrackedChangeMutationImpact({
      type: 'mutation:committed',
      origin: 'command',
      receipt: { success: true, inserted: [trackedChange('new')], updated: [trackedChange('survivor')] },
    });

    expect([...impact.upsertIds]).toEqual(['new', 'survivor']);
    expect([...impact.removedIds]).toEqual([]);
    expect(impact.reconcileMode).toBe('targeted');
  });

  it('classifies tracked refs carried beside a structural block delta', () => {
    const impact = getV2TrackedChangeMutationImpact({
      type: 'mutation:committed',
      origin: 'command',
      receipt: {
        success: true,
        inserted: { kind: 'block', nodeType: 'paragraph', nodeId: 'tail' },
        trackedChangeRefs: [trackedChange('paragraph-mark-insertion')],
      },
    });

    expect([...impact.upsertIds]).toEqual(['paragraph-mark-insertion']);
    expect([...impact.removedIds]).toEqual([]);
  });

  it('classifies tracked identities from a mutation plan receipt', () => {
    const impact = getV2TrackedChangeMutationImpact({
      type: 'mutation:committed',
      origin: 'command',
      receipt: {
        success: true,
        trackedChanges: [trackedChange('plan-change')],
        steps: [{ trackedChangeIds: ['plan-change'] }],
      },
    });

    expect([...impact.upsertIds]).toEqual(['plan-change']);
    expect([...impact.removedIds]).toEqual([]);
  });

  it('classifies removals, invalidations, and remaps from history results', () => {
    const impact = getV2TrackedChangeMutationImpact({
      type: 'mutation:committed',
      origin: 'history',
      result: {
        removed: [trackedChange('removed')],
        invalidatedRefs: [trackedChange('invalidated')],
        remappedRefs: [{ from: trackedChange('old'), to: trackedChange('new') }],
      },
    });

    expect([...impact.upsertIds]).toEqual(['new']);
    expect([...impact.removedIds]).toEqual(['removed', 'invalidated', 'old']);
    expect(impact.remappedPairs).toEqual([{ from: 'old', to: 'new' }]);
    expect(impact.reconcileMode).toBe('targeted');
  });

  it('returns null when a mutation has no tracked-change receipt effects', () => {
    expect(
      getV2TrackedChangeMutationImpact({
        type: 'mutation:committed',
        origin: 'command',
        receipt: { success: true, updated: [{ kind: 'entity', entityType: 'comment', entityId: 'c1' }] },
      }),
    ).toBeNull();
  });

  it('retains a fully bound all-resolved fact for one-pass store clearing', () => {
    const fact = {
      schemaVersion: 1,
      targetKind: 'all',
      decision: 'accept',
      catalogRevision: '7',
      sourceCoverageRevision: 'coverage-7',
      logicalTargetCount: 1_300,
      physicalCarrierCount: 2_600,
      remainingLogicalCount: 0,
      txId: 'tx-bulk',
      documentEpoch: 'document-1',
      commitSequence: 9,
      packagePreviousRevision: 'package-7',
      packageNextRevision: 'package-8',
    };
    const impact = getV2TrackedChangeMutationImpact({
      type: 'mutation:committed',
      origin: 'command',
      receipt: { success: true, txId: 'tx-bulk' },
      trackedChangeAllResolved: fact,
    });

    expect(impact).toMatchObject({ allResolved: fact, reconcileMode: 'targeted' });
    expect(impact.upsertIds.size).toBe(0);
    expect(impact.removedIds.size).toBe(0);
  });
});

describe('v2 comment mutation invalidation', () => {
  let store;
  let superdoc;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
    superdoc = { emit: vi.fn() };
    store.commentsList = [
      useComment({ commentId: '0', fileId: 'doc-1', commentText: 'Source review comment' }),
      useComment({
        commentId: 'reply-0',
        fileId: 'doc-1',
        parentCommentId: '0',
        commentText: 'Reply',
      }),
      useComment({ commentId: 'history-id', fileId: 'doc-1', commentText: 'History comment' }),
      useComment({ commentId: 'decoy', fileId: 'doc-1', commentText: 'Must not drop from the other payload field' }),
      makeTrackedChangeRow({ commentId: '0' }),
    ];
  });

  it('reads command receipts and history results, drops replies, and ignores non-comment refs', () => {
    expect(
      collectV2InvalidatedCommentIds({
        type: 'mutation:committed',
        origin: 'command',
        receipt: { invalidatedRefs: [commentRef('0')] },
        result: { invalidatedRefs: [commentRef('decoy')] },
      }),
    ).toEqual(new Set(['0']));
    expect(
      collectV2InvalidatedCommentIds({
        type: 'mutation:committed',
        origin: 'history',
        receipt: { invalidatedRefs: [commentRef('decoy')] },
        result: { invalidatedRefs: [commentRef('history-id')] },
      }),
    ).toEqual(new Set(['history-id']));
    expect(
      collectV2InvalidatedCommentIds({
        type: 'mutation:committed',
        origin: 'command',
        receipt: { invalidatedRefs: [trackedChange('0'), { kind: 'block', nodeId: 'P1' }] },
      }),
    ).toEqual(new Set());

    applyV2CommentInvalidationFromMutation({
      event: {
        type: 'mutation:committed',
        origin: 'command',
        receipt: { invalidatedRefs: [commentRef('0')] },
        result: { invalidatedRefs: [commentRef('decoy')] },
      },
      commentsStore: store,
      superdoc,
      documentId: 'doc-1',
    });
    expect(store.commentsList.map((row) => row.commentId).sort()).toEqual(['0', 'decoy', 'history-id']);
    expect(store.commentsList.find((row) => row.commentId === '0')?.trackedChange).toBe(true);
    expect(superdoc.emit).toHaveBeenCalledWith('comments-update', expect.objectContaining({ type: 'deleted' }));

    superdoc.emit.mockClear();
    applyV2CommentInvalidationFromMutation({
      event: {
        type: 'mutation:committed',
        origin: 'history',
        receipt: { invalidatedRefs: [commentRef('decoy')] },
        result: { invalidatedRefs: [commentRef('history-id')] },
      },
      commentsStore: store,
      superdoc,
      documentId: 'doc-1',
    });
    expect(store.commentsList.map((row) => row.commentId).sort()).toEqual(['0', 'decoy']);
    expect(store.commentsList.find((row) => row.commentId === '0')?.trackedChange).toBe(true);
    expect(superdoc.emit).toHaveBeenCalledWith('comments-update', expect.objectContaining({ type: 'deleted' }));

    superdoc.emit.mockClear();
    applyV2CommentInvalidationFromMutation({
      event: {
        type: 'mutation:committed',
        origin: 'command',
        receipt: { invalidatedRefs: [trackedChange('0'), { kind: 'block', nodeId: 'P1' }] },
      },
      commentsStore: store,
      superdoc,
      documentId: 'doc-1',
    });
    expect(store.commentsList.map((row) => row.commentId).sort()).toEqual(['0', 'decoy']);
    expect(superdoc.emit).not.toHaveBeenCalled();
  });
});
