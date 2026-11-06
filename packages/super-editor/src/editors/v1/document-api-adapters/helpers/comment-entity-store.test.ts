import { describe, expect, it } from 'vitest';
import type { Editor } from '../../core/Editor.js';
import type { TextTarget } from '@superdoc/document-api';
import {
  buildCommentJsonFromText,
  extractCommentText,
  findCommentEntity,
  getCommentEntityStore,
  isCommentResolved,
  reconcileCommentEntityStoreWithAnchors,
  removeCommentEntityTree,
  restoreStashedCommentEntityTree,
  stashRemovedCommentEntities,
  syncCommentEntitiesFromCollaboration,
  toCommentInfo,
  upsertCommentEntity,
  type CommentEntityRecord,
} from './comment-entity-store.js';

function makeEditorWithConverter(comments: CommentEntityRecord[] = []): Editor {
  return { converter: { comments } } as unknown as Editor;
}

function makeEditorWithoutConverter(): Editor {
  return {} as unknown as Editor;
}

describe('getCommentEntityStore', () => {
  it('returns converter.comments when converter exists', () => {
    const comments: CommentEntityRecord[] = [{ commentId: 'c1' }];
    const editor = makeEditorWithConverter(comments);
    expect(getCommentEntityStore(editor)).toBe(comments);
  });

  it('initializes converter.comments as empty array when undefined', () => {
    const editor = { converter: {} } as unknown as Editor;
    const store = getCommentEntityStore(editor);
    expect(store).toEqual([]);
    expect(Array.isArray(store)).toBe(true);
  });

  it('uses fallback storage when converter is missing', () => {
    const editor = makeEditorWithoutConverter();
    const store = getCommentEntityStore(editor);
    expect(store).toEqual([]);
    // Subsequent calls return the same array
    expect(getCommentEntityStore(editor)).toBe(store);
  });
});

describe('findCommentEntity', () => {
  it('finds by commentId', () => {
    const store: CommentEntityRecord[] = [{ commentId: 'c1', commentText: 'Hello' }];
    expect(findCommentEntity(store, 'c1')?.commentText).toBe('Hello');
  });

  it('finds by importedId', () => {
    const store: CommentEntityRecord[] = [{ commentId: 'c1', importedId: 'imp-1' }];
    expect(findCommentEntity(store, 'imp-1')?.commentId).toBe('c1');
  });

  it('returns undefined when not found', () => {
    const store: CommentEntityRecord[] = [{ commentId: 'c1' }];
    expect(findCommentEntity(store, 'missing')).toBeUndefined();
  });
});

describe('upsertCommentEntity', () => {
  it('creates a new entry when none exists', () => {
    const store: CommentEntityRecord[] = [];
    const result = upsertCommentEntity(store, 'c1', { commentText: 'New' });
    expect(result.commentId).toBe('c1');
    expect(result.commentText).toBe('New');
    expect(store).toHaveLength(1);
  });

  it('updates an existing entry preserving its commentId', () => {
    const store: CommentEntityRecord[] = [{ commentId: 'c1', commentText: 'Old' }];
    const result = upsertCommentEntity(store, 'c1', { commentText: 'Updated' });
    expect(result.commentText).toBe('Updated');
    expect(result.commentId).toBe('c1');
    expect(store).toHaveLength(1);
  });

  it('resolves to the provided commentId when existing entry has no commentId', () => {
    const store: CommentEntityRecord[] = [{ importedId: 'imp-1', commentText: 'Old' }];
    const result = upsertCommentEntity(store, 'imp-1', { commentText: 'Updated' });
    expect(result.commentId).toBe('imp-1');
  });
});

describe('removeCommentEntityTree', () => {
  it('removes a root comment and its children', () => {
    const store: CommentEntityRecord[] = [
      { commentId: 'c1', commentText: 'Root' },
      { commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply' },
      { commentId: 'c3', parentCommentId: 'c2', commentText: 'Nested reply' },
    ];

    const removed = removeCommentEntityTree(store, 'c1');
    expect(removed.map((r) => r.commentId).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(store).toHaveLength(0);
  });

  it('returns empty array when comment is not found', () => {
    const store: CommentEntityRecord[] = [{ commentId: 'c1' }];
    const removed = removeCommentEntityTree(store, 'missing');
    expect(removed).toEqual([]);
    expect(store).toHaveLength(1);
  });

  it('preserves unrelated comments', () => {
    const store: CommentEntityRecord[] = [
      { commentId: 'c1', commentText: 'Root' },
      { commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply' },
      { commentId: 'c3', commentText: 'Unrelated' },
    ];

    removeCommentEntityTree(store, 'c1');
    expect(store).toHaveLength(1);
    expect(store[0]?.commentId).toBe('c3');
  });

  it('returns empty array when root has empty commentId', () => {
    const store: CommentEntityRecord[] = [{ commentId: '', importedId: 'imp-1' }];
    const removed = removeCommentEntityTree(store, 'imp-1');
    expect(removed).toEqual([]);
  });
});

describe('stashRemovedCommentEntities / restoreStashedCommentEntityTree', () => {
  it('restores a removed root comment and its reply payloads', () => {
    const editor = makeEditorWithConverter([
      { commentId: 'c1', commentText: 'Root' },
      { commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply' },
    ]);
    const store = getCommentEntityStore(editor);

    const removed = removeCommentEntityTree(store, 'c1');
    expect(store).toEqual([]);

    stashRemovedCommentEntities(editor, removed);
    const restored = restoreStashedCommentEntityTree(editor, 'c1');

    expect(restored.map((entry) => entry.commentId).sort()).toEqual(['c1', 'c2']);
    expect(store).toHaveLength(2);
    expect(findCommentEntity(store, 'c1')?.commentText).toBe('Root');
    expect(findCommentEntity(store, 'c2')?.commentText).toBe('Reply');
  });

  it('returns empty when there is no stashed tree for the comment id', () => {
    const editor = makeEditorWithConverter();
    expect(restoreStashedCommentEntityTree(editor, 'missing')).toEqual([]);
  });
});

describe('reconcileCommentEntityStoreWithAnchors', () => {
  it('stashes a dangling open root thread when its anchor disappears and restores it when the anchor returns', () => {
    const editor = makeEditorWithConverter([
      { commentId: 'c1', commentText: 'Root' },
      { commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply' },
    ]);

    const firstPass = reconcileCommentEntityStoreWithAnchors(editor, []);
    expect(firstPass.restored).toEqual([]);
    expect(firstPass.removed.map((entry) => entry.commentId).sort()).toEqual(['c1', 'c2']);
    expect(getCommentEntityStore(editor)).toEqual([]);

    const secondPass = reconcileCommentEntityStoreWithAnchors(editor, ['c1']);
    expect(secondPass.removed).toEqual([]);
    expect(secondPass.restored.map((entry) => entry.commentId).sort()).toEqual(['c1', 'c2']);
    expect(findCommentEntity(getCommentEntityStore(editor), 'c1')?.commentText).toBe('Root');
    expect(findCommentEntity(getCommentEntityStore(editor), 'c2')?.commentText).toBe('Reply');
  });

  it('does not prune resolved or tracked-change-linked root comments when they are temporarily unanchored', () => {
    const editor = makeEditorWithConverter([
      { commentId: 'resolved-root', commentText: 'Resolved', isDone: true },
      { commentId: 'tracked-root', commentText: 'Tracked', trackedChangeParentId: 'tc-1' },
    ]);

    const result = reconcileCommentEntityStoreWithAnchors(editor, []);

    expect(result.removed).toEqual([]);
    expect(
      getCommentEntityStore(editor)
        .map((entry) => entry.commentId)
        .sort(),
    ).toEqual(['resolved-root', 'tracked-root']);
  });
});

describe('extractCommentText', () => {
  it('returns commentText when available', () => {
    expect(extractCommentText({ commentText: 'Hello' })).toBe('Hello');
  });

  it('extracts text from commentJSON structure', () => {
    const entry: CommentEntityRecord = {
      commentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'From JSON' }] }],
    };
    expect(extractCommentText(entry)).toBe('From JSON');
  });

  it('extracts text from elements structure', () => {
    const entry: CommentEntityRecord = {
      elements: [{ text: 'From elements' }],
    };
    expect(extractCommentText(entry)).toBe('From elements');
  });

  it('returns undefined when no text source exists', () => {
    expect(extractCommentText({})).toBeUndefined();
  });

  it('returns undefined for empty commentJSON', () => {
    expect(extractCommentText({ commentJSON: [] })).toBeUndefined();
  });
});

describe('buildCommentJsonFromText', () => {
  it('creates paragraph/run/text structure from plain text', () => {
    const result = buildCommentJsonFromText('Hello world');
    expect(result).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'run',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      },
    ]);
  });

  it('preserves literal markup-looking text as plain text', () => {
    const result = buildCommentJsonFromText('<b>Bold</b> text');
    expect(result[0]).toMatchObject({
      content: [{ content: [{ text: '<b>Bold</b> text' }] }],
    });
  });

  it('preserves paragraph boundaries from newline-delimited plain text', () => {
    const result = buildCommentJsonFromText('Hello\nworld');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      content: [{ content: [{ text: 'Hello' }] }],
    });
    expect(result[1]).toMatchObject({
      content: [{ content: [{ text: 'world' }] }],
    });
  });
});

describe('isCommentResolved', () => {
  it('returns true when isDone is true', () => {
    expect(isCommentResolved({ isDone: true })).toBe(true);
  });

  it('returns true when resolvedTime is set', () => {
    expect(isCommentResolved({ resolvedTime: Date.now() })).toBe(true);
  });

  it('returns false when neither isDone nor resolvedTime is set', () => {
    expect(isCommentResolved({})).toBe(false);
  });

  it('returns false when resolvedTime is null', () => {
    expect(isCommentResolved({ resolvedTime: null })).toBe(false);
  });
});

describe('toCommentInfo', () => {
  it('builds CommentInfo from a record', () => {
    const info = toCommentInfo({
      commentId: 'c1',
      importedId: 'imp-1',
      commentText: 'Hello',
      isInternal: true,
      createdTime: 1000,
      creatorName: 'Ada',
      creatorEmail: 'ada@example.com',
    });

    expect(info.commentId).toBe('c1');
    expect(info.importedId).toBe('imp-1');
    expect(info.text).toBe('Hello');
    expect(info.isInternal).toBe(true);
    expect(info.status).toBe('open');
    expect(info.createdTime).toBe(1000);
  });

  it('respects explicit status override', () => {
    const info = toCommentInfo({ commentId: 'c1' }, { status: 'resolved' });
    expect(info.status).toBe('resolved');
  });

  it('derives resolved status from isDone', () => {
    const info = toCommentInfo({ commentId: 'c1', isDone: true });
    expect(info.status).toBe('resolved');
  });

  it('falls back to importedId when commentId is missing', () => {
    const info = toCommentInfo({ importedId: 'imp-1' });
    expect(info.commentId).toBe('imp-1');
  });

  it('includes target when provided', () => {
    const target: TextTarget = { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 5 } }] };
    const info = toCommentInfo({ commentId: 'c1' }, { target });
    expect(info.target).toBe(target);
  });

  it('includes anchoredText when provided', () => {
    const info = toCommentInfo({ commentId: 'c1' }, { anchoredText: 'hello world' });
    expect(info.anchoredText).toBe('hello world');
  });

  it('omits anchoredText when not provided', () => {
    const info = toCommentInfo({ commentId: 'c1' });
    expect(info.anchoredText).toBeUndefined();
  });
});

describe('syncCommentEntitiesFromCollaboration (SD-3214)', () => {
  it('upserts a new browser-authored comment into an empty store', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [
      {
        commentId: 'c1',
        commentText: 'Please review this clause.',
        creatorName: 'Browser User',
        creatorEmail: 'browser@example.com',
        createdTime: 1700000000000,
        isInternal: false,
      },
    ]);

    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentId).toBe('c1');
    expect(store[0].commentText).toBe('Please review this clause.');
    expect(store[0].creatorName).toBe('Browser User');
    expect(store[0].creatorEmail).toBe('browser@example.com');
    expect(store[0].createdTime).toBe(1700000000000);
    expect(store[0].isInternal).toBe(false);
  });

  it('accepts `text` as a fallback for `commentText`', () => {
    // Some browser writers emit { text } instead of { commentText }; mirror
    // the alias logic the browser-side loader uses.
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'c1', text: 'short form' }]);
    const store = getCommentEntityStore(editor);
    expect(store[0].commentText).toBe('short form');
  });

  it('skips synthetic tracked-change projection entries without comment payload', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [
      { commentId: 'tc-1', trackedChange: true, trackedChangeText: 'inserted', creatorName: 'A' },
      { commentId: 'c-1', commentText: 'real comment', creatorName: 'B' },
    ]);
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentId).toBe('c-1');
  });

  it('syncs linked tracked-content comments when they include comment payload', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [
      {
        commentId: 'tc-user-1',
        trackedChange: true,
        trackedChangeParentId: 'tc-root-1',
        trackedChangeText: 'inserted text',
        commentText: 'user-authored tracked comment',
        creatorName: 'A',
      },
    ]);

    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      commentId: 'tc-user-1',
      trackedChange: true,
      trackedChangeParentId: 'tc-root-1',
      trackedChangeText: 'inserted text',
      commentText: 'user-authored tracked comment',
      creatorName: 'A',
    });

    const linkedInfo = toCommentInfo(store[0]);
    expect(linkedInfo.trackedChangeLink?.trackedChangeId).toBe('tc-root-1');
  });

  it('normalizes legacy collaboration tracked change types before storing them', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [
      {
        commentId: 'track-insert',
        commentText: 'insert comment',
        trackedChange: true,
        trackedChangeType: 'trackInsert',
      },
      {
        commentId: 'replacement',
        commentText: 'replacement comment',
        trackedChange: true,
        trackedChangeType: 'both',
      },
    ]);

    const store = getCommentEntityStore(editor);
    expect(findCommentEntity(store, 'track-insert')?.trackedChangeType).toBe('insert');
    expect(findCommentEntity(store, 'replacement')?.trackedChangeType).toBe('replacement');

    const insertInfo = toCommentInfo(findCommentEntity(store, 'track-insert')!);
    const replacementInfo = toCommentInfo(findCommentEntity(store, 'replacement')!);
    expect(insertInfo.trackedChangeType).toBe('insert');
    expect(insertInfo.trackedChangeLink?.trackedChangeId).toBe('track-insert');
    expect(insertInfo.trackedChangeLink?.trackedChangeType).toBe('insert');
    expect(replacementInfo.trackedChangeType).toBe('replacement');
    expect(replacementInfo.trackedChangeLink?.trackedChangeId).toBe('replacement');
    expect(replacementInfo.trackedChangeLink?.trackedChangeType).toBe('replacement');
  });

  it('skips entries without a commentId', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [{ creatorName: 'orphan' }, { commentId: 'c-ok', creatorName: 'X' }]);
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentId).toBe('c-ok');
  });

  it('falls back to importedId when commentId is missing', () => {
    const editor = makeEditorWithConverter();
    syncCommentEntitiesFromCollaboration(editor, [{ importedId: 'imp-1', creatorName: 'X' }]);
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentId).toBe('imp-1');
    expect(store[0].importedId).toBe('imp-1');
  });

  it('merges an updated entry without clobbering unchanged fields', () => {
    const editor = makeEditorWithConverter([
      {
        commentId: 'c1',
        commentText: 'v1',
        creatorName: 'Author',
        creatorEmail: 'author@example.com',
        createdTime: 1,
      },
    ]);
    // Remote update bumps commentText only.
    syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'c1', commentText: 'v2' }]);
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentText).toBe('v2');
    expect(store[0].creatorName).toBe('Author');
    expect(store[0].creatorEmail).toBe('author@example.com');
    expect(store[0].createdTime).toBe(1);
  });

  it('propagates resolution metadata', () => {
    const editor = makeEditorWithConverter([{ commentId: 'c1', commentText: 'hi' }]);
    syncCommentEntitiesFromCollaboration(editor, [
      {
        commentId: 'c1',
        commentText: 'hi',
        isDone: true,
        resolvedTime: 1700000005000,
        resolvedByEmail: 'resolver@example.com',
        resolvedByName: 'Resolver',
      },
    ]);
    const store = getCommentEntityStore(editor);
    expect(store[0].isDone).toBe(true);
    expect(store[0].resolvedTime).toBe(1700000005000);
    expect(store[0].resolvedByEmail).toBe('resolver@example.com');
    expect(store[0].resolvedByName).toBe('Resolver');
  });

  it('returns the set of synced comment ids (for caller-driven deletion sweep)', () => {
    const editor = makeEditorWithConverter();
    const seen = syncCommentEntitiesFromCollaboration(editor, [
      { commentId: 'c1' },
      { commentId: 'c2' },
      { trackedChange: true, commentId: 'tc-1' },
    ]);
    expect(seen).toEqual(new Set(['c1', 'c2']));
  });

  it('is a no-op for empty input', () => {
    const editor = makeEditorWithConverter([{ commentId: 'pre', commentText: 'kept' }]);
    syncCommentEntitiesFromCollaboration(editor, []);
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentText).toBe('kept');
  });

  // Remote-deletion handling: when a prior collab-synced id disappears from
  // the upstream Y.Array, the helper prunes the matching store entry.
  it('prunes a previously-synced entry that is no longer in upstream entries', () => {
    const editor = makeEditorWithConverter();
    const first = syncCommentEntitiesFromCollaboration(editor, [
      { commentId: 'a', commentText: 'a' },
      { commentId: 'b', commentText: 'b' },
    ]);
    expect(getCommentEntityStore(editor)).toHaveLength(2);
    expect(first).toEqual(new Set(['a', 'b']));

    // Remote drops 'a'.
    const second = syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'b', commentText: 'b' }], {
      previouslySynced: first,
    });
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(1);
    expect(store[0].commentId).toBe('b');
    expect(second).toEqual(new Set(['b']));
  });

  it('does not prune locally-authored entries that were never collab-synced', () => {
    // 'local' is in the store but never in `previouslySynced` — the helper
    // must leave it alone even though it isn't in the upstream entries.
    const editor = makeEditorWithConverter([{ commentId: 'local', commentText: 'cli-authored' }]);
    syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'remote', commentText: 'r' }], {
      previouslySynced: new Set<string>(),
    });
    const store = getCommentEntityStore(editor);
    expect(store).toHaveLength(2);
    expect(store.map((e) => e.commentId).sort()).toEqual(['local', 'remote']);
  });

  it('prunes thread replies along with the deleted parent', () => {
    // removeCommentEntityTree cascades to children — confirm via the helper.
    const editor = makeEditorWithConverter();
    const first = syncCommentEntitiesFromCollaboration(editor, [
      { commentId: 'root' },
      { commentId: 'reply-1', parentCommentId: 'root' },
      { commentId: 'reply-2', parentCommentId: 'root' },
      { commentId: 'unrelated' },
    ]);
    expect(getCommentEntityStore(editor)).toHaveLength(4);

    syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'unrelated' }], {
      previouslySynced: first,
    });
    const store = getCommentEntityStore(editor);
    expect(store.map((e) => e.commentId).sort()).toEqual(['unrelated']);
  });

  it('returns the new sync set unchanged when no removals occur', () => {
    const editor = makeEditorWithConverter();
    const first = syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'a' }, { commentId: 'b' }]);
    const second = syncCommentEntitiesFromCollaboration(
      editor,
      [{ commentId: 'a' }, { commentId: 'b' }, { commentId: 'c' }],
      { previouslySynced: first },
    );
    expect(second).toEqual(new Set(['a', 'b', 'c']));
    expect(getCommentEntityStore(editor)).toHaveLength(3);
  });

  // Codex P2 — "Keep deleted thread descendants out of the sync set":
  // packages/superdoc/.../collaboration-comments.js#deleteYComment removes
  // only the parent index from Y.Array. The browser UI drops replies
  // locally. If our helper iterates the upstream array AFTER the browser
  // delete, it would still see the reply entries and upsert them. Even
  // though removeCommentEntityTree cascades the parent's deletion through
  // the store, the returned `seen` set would still contain the reply id
  // because the reply was upserted in that same pass — so the next sync
  // would re-upsert the reply as an orphan with no parent.
  describe('orphaned-reply handling (Codex P2)', () => {
    it('does not upsert a reply whose parent disappeared from the upstream array', () => {
      const editor = makeEditorWithConverter();
      // Initial sync — parent and reply both upstream.
      const first = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'root', commentText: 'parent body' },
        { commentId: 'reply-1', parentCommentId: 'root', commentText: 'reply body' },
      ]);
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
      ).toEqual(['reply-1', 'root']);

      // Browser deletes parent only; reply still in upstream.
      const second = syncCommentEntitiesFromCollaboration(
        editor,
        [{ commentId: 'reply-1', parentCommentId: 'root', commentText: 'reply body' }],
        { previouslySynced: first },
      );
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
        'parent + reply must both be pruned after parent deletion',
      ).toEqual([]);
      // And the returned sync set must NOT include the orphan reply, otherwise
      // the next observer fire would re-upsert it as a parent-less orphan.
      expect(second.has('reply-1'), 'reply id must not survive in the next sync set').toBe(false);
    });

    it('does not resurrect a reply as an orphan on a subsequent sync over the same upstream', () => {
      // Same scenario as above, but we now run THREE syncs back-to-back, all
      // observing the same "parent missing, reply present" upstream. Without
      // the fix, the second and third syncs would re-upsert the reply each
      // time, leaving an orphan record in the store.
      const editor = makeEditorWithConverter();
      const first = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'root' },
        { commentId: 'reply-1', parentCommentId: 'root' },
      ]);

      const second = syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'reply-1', parentCommentId: 'root' }], {
        previouslySynced: first,
      });

      const third = syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'reply-1', parentCommentId: 'root' }], {
        previouslySynced: second,
      });

      expect(getCommentEntityStore(editor).map((e) => e.commentId)).toEqual([]);
      expect(third.has('reply-1'), 'orphan reply must not appear in the third sync set').toBe(false);
    });

    it('still upserts a reply when its parent is in the same upstream pass (preserves valid threads)', () => {
      // Sanity check that the orphan filter does NOT break the common case:
      // parent + reply both upstream → both upserted.
      const editor = makeEditorWithConverter();
      const seen = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'root' },
        { commentId: 'reply-1', parentCommentId: 'root' },
        { commentId: 'reply-2', parentCommentId: 'root' },
      ]);
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
      ).toEqual(['reply-1', 'reply-2', 'root']);
      expect(seen).toEqual(new Set(['root', 'reply-1', 'reply-2']));
    });

    it('treats importedId as a valid parent reference (legacy DOCX threads)', () => {
      // Imported comments may carry only `importedId`; a reply's
      // `parentCommentId` can point at the parent's importedId rather than
      // its canonical commentId.
      const editor = makeEditorWithConverter();
      const seen = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'canonical-root', importedId: '0' },
        { commentId: 'reply-1', parentCommentId: '0' },
      ]);
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
      ).toEqual(['canonical-root', 'reply-1']);
      expect(seen.has('reply-1'), 'reply pointing at parent.importedId must still be accepted').toBe(true);
    });

    // Codex follow-up: a one-shot orphan filter (build upstreamIds once,
    // skip entries whose direct parent is missing) handles A→B but breaks on
    // A→B→C. B is correctly skipped because A is gone, but C's parent B is
    // still present in `upstreamIds`, so C survives the upsert and dangles
    // as an orphan whose chain leads nowhere. Filter must be applied
    // transitively until the upstream set is stable.
    it('drops the entire orphan chain when an ancestor is missing upstream (A→B→C, A deleted)', () => {
      const editor = makeEditorWithConverter();
      const first = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'A' },
        { commentId: 'B', parentCommentId: 'A' },
        { commentId: 'C', parentCommentId: 'B' },
      ]);
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
      ).toEqual(['A', 'B', 'C']);

      // A is deleted upstream. B and C linger (browser only flushed A).
      const second = syncCommentEntitiesFromCollaboration(
        editor,
        [
          { commentId: 'B', parentCommentId: 'A' },
          { commentId: 'C', parentCommentId: 'B' },
        ],
        { previouslySynced: first },
      );
      expect(
        getCommentEntityStore(editor)
          .map((e) => e.commentId)
          .sort(),
        'A → B → C: with A gone, B and C must both be pruned',
      ).toEqual([]);
      expect(second.has('B'), 'B must not appear in the sync set').toBe(false);
      expect(second.has('C'), 'C must not appear in the sync set (or it would be re-upserted)').toBe(false);
    });

    it('does not resurrect a grandchild orphan on subsequent syncs over the same upstream (A→B→C)', () => {
      const editor = makeEditorWithConverter();
      const first = syncCommentEntitiesFromCollaboration(editor, [
        { commentId: 'A' },
        { commentId: 'B', parentCommentId: 'A' },
        { commentId: 'C', parentCommentId: 'B' },
      ]);

      const second = syncCommentEntitiesFromCollaboration(
        editor,
        [
          { commentId: 'B', parentCommentId: 'A' },
          { commentId: 'C', parentCommentId: 'B' },
        ],
        { previouslySynced: first },
      );

      const third = syncCommentEntitiesFromCollaboration(
        editor,
        [
          { commentId: 'B', parentCommentId: 'A' },
          { commentId: 'C', parentCommentId: 'B' },
        ],
        { previouslySynced: second },
      );

      expect(getCommentEntityStore(editor).map((e) => e.commentId)).toEqual([]);
      expect(third.has('B')).toBe(false);
      expect(third.has('C')).toBe(false);
    });
  });
});

it('hydrates identity snapshots from collaboration, keeps them on partial updates and allows null', () => {
  const editor = makeEditorWithConverter();
  const pair = { providerId: 'AD', userId: 'opaque' };
  syncCommentEntitiesFromCollaboration(editor, [
    { commentId: 'identity', creatorIdentity: pair, wordAuthorName: 'Alex' },
  ]);
  pair.userId = 'changed';
  syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'identity', commentText: 'Updated' }]);
  const store = getCommentEntityStore(editor);
  expect(store[0].creatorIdentity).toEqual({ providerId: 'AD', userId: 'opaque' });
  expect(store[0].wordAuthorName).toBe('Alex');
  const removed = removeCommentEntityTree(store, 'identity');
  stashRemovedCommentEntities(editor, removed);
  restoreStashedCommentEntityTree(editor, 'identity');
  expect(getCommentEntityStore(editor)[0].creatorIdentity).toEqual({ providerId: 'AD', userId: 'opaque' });
  syncCommentEntitiesFromCollaboration(editor, [{ commentId: 'identity', creatorIdentity: null }]);
  expect(getCommentEntityStore(editor)[0].creatorIdentity).toBeNull();
});
