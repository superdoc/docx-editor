import { describe, expect, it } from 'vite-plus/test';
import { collectTrackedChangeThread } from '../../components/CommentsLayer/collect-tracked-change-thread.js';
import { buildTrackedChangeDecisionLinkIndex, buildTrackedChangeThreadIndex } from './tracked-change-thread-index.js';

const sortedLegacyThread = (parent, comments) =>
  collectTrackedChangeThread(parent, comments).sort((left, right) => {
    if (left === parent) return -1;
    if (right === parent) return 1;
    return left.createdTime - right.createdTime;
  });

describe('buildTrackedChangeThreadIndex', () => {
  it('preserves tracked roots, direct/threading parents, BFS, and bi-parent exclusion', () => {
    const first = { commentId: 'tc-1', trackedChange: true, createdTime: 1 };
    const second = { commentId: 'tc-2', trackedChange: true, createdTime: 2 };
    const root = { commentId: 'root', trackedChangeThreadParentId: 'tc-1', createdTime: 3 };
    const reply = { commentId: 'reply', parentCommentId: 'root', trackedChangeParentId: 'tc-1', createdTime: 4 };
    const v2Reply = {
      commentId: 'v2-reply',
      parentCommentId: 'hidden-sidecar',
      threadingParentCommentId: 'tc-1',
      trackedChangeParentId: 'tc-1',
      createdTime: 5,
    };
    const foreignParent = { commentId: 'foreign-parent', createdTime: 6 };
    const biParented = {
      commentId: 'bi-parented',
      parentCommentId: 'foreign-parent',
      trackedChangeParentId: 'tc-1',
      createdTime: 7,
    };
    const secondRoot = { commentId: 'second-root', trackedChangeThreadParentId: 'tc-2', createdTime: 8 };
    const comments = [first, second, root, reply, v2Reply, foreignParent, biParented, secondRoot];
    const index = buildTrackedChangeThreadIndex(comments);

    expect(index.get('tc-1')).toEqual(sortedLegacyThread(first, comments));
    expect(index.get('tc-2')).toEqual(sortedLegacyThread(second, comments));
    expect(index.get('tc-1')?.map((comment) => comment.commentId)).not.toContain('bi-parented');
  });

  it('matches legacy mixed-id strictness and stable equal-time source ordering', () => {
    const numeric = { commentId: 7, trackedChange: true, createdTime: 0 };
    const textual = { commentId: '7', trackedChange: true, createdTime: 0 };
    const numericAnchor = { commentId: 'numeric-anchor', trackedChangeThreadParentId: 7, createdTime: 5 };
    const normalizedDirect = { commentId: 'normalized-direct', parentCommentId: 7, createdTime: 5 };
    const equalTimeReply = { commentId: 'equal-time-reply', parentCommentId: 'numeric-anchor', createdTime: 5 };
    const missingTime = { commentId: 'missing-time', threadingParentCommentId: '7' };
    const comments = [numeric, numericAnchor, equalTimeReply, textual, normalizedDirect, missingTime];
    const index = buildTrackedChangeThreadIndex(comments);

    expect(index.get(7)).toEqual(sortedLegacyThread(numeric, comments));
    expect(index.get('7')).toEqual(sortedLegacyThread(textual, comments));
    expect(index.get(7)?.map((comment) => comment.commentId)).toEqual([7]);
    expect(index.get('7')?.map((comment) => comment.commentId)).toEqual([
      '7',
      'numeric-anchor',
      'equal-time-reply',
      'normalized-direct',
      'missing-time',
    ]);
  });

  it('structurally shares surviving threads after one review row is pruned', () => {
    const comments = Array.from({ length: 561 }, (_, index) => ({
      commentId: `tc-${index}`,
      trackedChange: true,
      createdTime: index,
    }));
    const before = buildTrackedChangeThreadIndex(comments);
    const after = buildTrackedChangeThreadIndex(
      comments.filter((comment) => comment.commentId !== 'tc-280'),
      before,
    );

    expect(after.size).toBe(560);
    expect(after.has('tc-280')).toBe(false);
    for (const [id, thread] of after) expect(thread, id).toBe(before.get(id));
  });

  it('replaces per-card full-list scans with one bounded graph pass', () => {
    let legacyReads = 0;
    let indexedReads = 0;
    const makeRows = (recordRead) =>
      Array.from(
        { length: 561 },
        (_, index) =>
          new Proxy(
            { commentId: `tc-${index}`, trackedChange: true, createdTime: index },
            {
              get(target, property, receiver) {
                recordRead();
                return Reflect.get(target, property, receiver);
              },
            },
          ),
      );

    const legacyRows = makeRows(() => {
      legacyReads += 1;
    });
    for (const parent of legacyRows) collectTrackedChangeThread(parent, legacyRows);
    const indexedRows = makeRows(() => {
      indexedReads += 1;
    });
    expect(buildTrackedChangeThreadIndex(indexedRows).size).toBe(561);
    expect(legacyReads).toBeGreaterThan(1_000_000);
    expect(indexedReads).toBeLessThan(20_000);
    expect(indexedReads * 50).toBeLessThan(legacyReads);
  });

  it('keeps v2 synthetic move-side rows as separate visible review roots', () => {
    const moveFrom = {
      commentId: 'tc|main:/word/document.xml|move|1%7C101::move-from',
      trackedChange: true,
      trackedChangeCanonicalId: 'tc|main:/word/document.xml|move|1%7C101',
      trackedChangeAnchorKey: 'tc::body::tc|main:/word/document.xml|move|1%7C101::move-from',
      trackedChangeParentId: 'tc|main:/word/document.xml|move|1%7C101',
      trackedChangeText: '',
      deletedText: 'moved text',
      semanticColorKey: 'move-from',
      createdTime: 1,
    };
    const moveTo = {
      commentId: 'tc|main:/word/document.xml|move|1%7C101::move-to',
      trackedChange: true,
      trackedChangeCanonicalId: 'tc|main:/word/document.xml|move|1%7C101',
      trackedChangeAnchorKey: 'tc::body::tc|main:/word/document.xml|move|1%7C101::move-to',
      trackedChangeParentId: moveFrom.commentId,
      trackedChangeText: 'moved text',
      trackedChangeLabel: 'Moved (insertion)',
      semanticColorKey: 'move-to',
      createdTime: 2,
    };
    const sharedCanonicalRoot = {
      commentId: 'move-comment-root',
      trackedChangeThreadParentId: moveFrom.trackedChangeCanonicalId,
      createdTime: 3,
    };
    const comments = [moveFrom, moveTo, sharedCanonicalRoot];
    const index = buildTrackedChangeThreadIndex(comments);

    expect(index.get(moveFrom.commentId)).toEqual([moveFrom]);
    expect(index.get(moveTo.commentId)).toEqual([moveTo]);
    expect(buildTrackedChangeDecisionLinkIndex(comments).get(moveFrom.commentId)).toEqual([moveTo]);
  });

  it('routes explicit move comments to the visible source or destination card', () => {
    const canonicalId = 'tc|main:/word/document.xml|move|1%7C101';
    const moveFrom = {
      commentId: `${canonicalId}::move-from`,
      trackedChange: true,
      trackedChangeCanonicalId: canonicalId,
      semanticColorKey: 'move-from',
      createdTime: 1,
    };
    const moveTo = {
      commentId: `${canonicalId}::move-to`,
      trackedChange: true,
      trackedChangeCanonicalId: canonicalId,
      semanticColorKey: 'move-to',
      createdTime: 2,
    };
    const sourceRoot = {
      commentId: 'source-root',
      trackedChangeThreadParentId: canonicalId,
      trackedChangeSide: 'source',
      createdTime: 3,
    };
    const sourceReply = { commentId: 'source-reply', parentCommentId: 'source-root', createdTime: 4 };
    const destinationRoot = {
      commentId: 'destination-root',
      trackedChangeThreadParentId: canonicalId,
      trackedChangeSide: 'destination',
      createdTime: 5,
    };
    const destinationReply = { commentId: 'destination-reply', parentCommentId: 'destination-root', createdTime: 6 };
    const index = buildTrackedChangeThreadIndex([
      moveFrom,
      moveTo,
      sourceRoot,
      sourceReply,
      destinationRoot,
      destinationReply,
    ]);

    expect(index.get(moveFrom.commentId)?.map((comment) => comment.commentId)).toEqual([
      moveFrom.commentId,
      'source-root',
      'source-reply',
    ]);
    expect(index.get(moveTo.commentId)?.map((comment) => comment.commentId)).toEqual([
      moveTo.commentId,
      'destination-root',
      'destination-reply',
    ]);
  });

  it('threads a canonical-id comment under its unique visible tracked-change row', () => {
    const canonicalId = 'tc|main:/word/document.xml|del|coalesced|2|4';
    const tracked = {
      commentId: 'tc|main:/word/document.xml|del|source%7CwId%3A4',
      importedId: '4',
      trackedChange: true,
      trackedChangeCanonicalId: canonicalId,
      createdTime: 1,
    };
    const root = { commentId: '0', trackedChangeThreadParentId: canonicalId, createdTime: 2 };
    const reply = { commentId: '1', parentCommentId: '0', createdTime: 3 };

    expect(buildTrackedChangeThreadIndex([tracked, root, reply]).get(tracked.commentId)).toEqual([
      tracked,
      root,
      reply,
    ]);
  });
});

describe('buildTrackedChangeDecisionLinkIndex', () => {
  it('indexes spatial associations without adding them to visible conversations', () => {
    const tracked = { commentId: 'tc-1', trackedChange: true, createdTime: 1 };
    const spatial = {
      commentId: 'comment-1',
      trackedChangeParentId: 'tc-1',
      trackedChangeSide: 'inserted',
      createdTime: 2,
    };
    const comments = [tracked, spatial];

    expect(buildTrackedChangeThreadIndex(comments).get('tc-1')).toEqual([tracked]);
    expect(buildTrackedChangeDecisionLinkIndex(comments).get('tc-1')).toEqual([spatial]);
  });
});
