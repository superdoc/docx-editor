import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

vi.mock('@superdoc/core/collaboration/helpers.js', () => ({
  syncCommentsToClients: vi.fn(),
}));

import useComment from './use-comment.js';
import { syncCommentsToClients } from '@superdoc/core/collaboration/helpers.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '@superdoc/helpers/selection-source';

const makeSuperdoc = () => ({ emit: vi.fn(), activeEditor: null });

describe('use-comment: extended coverage', () => {
  beforeEach(() => {
    syncCommentsToClients.mockClear();
  });

  it('rejects direct model mutations when the comments store is read-only', () => {
    const comment = useComment({ commentId: 'c-read-only', isInternal: true, commentText: 'Original' });
    const superdoc = makeSuperdoc();
    superdoc.commentsStore = { getConfig: { readOnly: true } };

    const outcomes = [
      comment.resolveComment({ id: 'user-1', email: 'user@example.com', name: 'User', superdoc }),
      comment.setIsInternal({ isInternal: false, superdoc }),
      comment.setText({ text: 'Changed', superdoc }),
    ];

    expect(outcomes).toEqual(outcomes.map(() => ({ ok: false, reason: 'read-only-document' })));
    expect(comment.resolvedTime).toBeNull();
    expect(comment.isInternal).toBe(true);
    expect(comment.commentText).toBe('Original');
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  it.each([false, undefined, {}, { readOnly: false }])('allows mutations when modules.comments is %j', (comments) => {
    const comment = useComment({ commentId: 'c-editable', isInternal: true, commentText: 'Original' });
    const superdoc = { ...makeSuperdoc(), config: { modules: { comments } } };

    const outcomes = [
      comment.setIsInternal({ isInternal: false, superdoc }),
      comment.setText({ text: 'Changed', superdoc }),
      comment.resolveComment({ id: 'user-1', email: 'user@example.com', name: 'User', superdoc }),
    ];

    expect(outcomes).toEqual([undefined, undefined, undefined]);
    expect(comment.isInternal).toBe(false);
    expect(comment.commentText).toBe('Changed');
    expect(comment.resolvedTime).not.toBeNull();
    expect(superdoc.emit).toHaveBeenCalledTimes(3);
  });

  it('rejects direct model mutations when modules.comments is read-only', () => {
    const comment = useComment({ commentId: 'c-module-read-only', isInternal: true, commentText: 'Original' });
    const superdoc = { ...makeSuperdoc(), config: { modules: { comments: { readOnly: true } } } };

    const outcomes = [
      comment.resolveComment({ id: 'user-1', email: 'user@example.com', name: 'User', superdoc }),
      comment.setIsInternal({ isInternal: false, superdoc }),
      comment.setText({ text: 'Changed', superdoc }),
    ];

    expect(outcomes).toEqual(outcomes.map(() => ({ ok: false, reason: 'read-only-document' })));
    expect(comment.resolvedTime).toBeNull();
    expect(comment.isInternal).toBe(true);
    expect(comment.commentText).toBe('Original');
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  describe('resolveComment', () => {
    it('sets resolved fields and emits a resolved event', () => {
      const c = useComment({ commentId: 'c-1', fileId: 'doc-1' });
      const superdoc = makeSuperdoc();
      c.resolveComment({ id: 'alice-id', email: 'a@b.com', name: 'Alice', superdoc });
      expect(c.resolvedById).toBe('alice-id');
      expect(c.resolvedByEmail).toBe('a@b.com');
      expect(c.resolvedByName).toBe('Alice');
      expect(typeof c.resolvedTime).toBe('number');
      expect(superdoc.emit).toHaveBeenCalledWith(
        'comments-update',
        expect.objectContaining({ type: expect.any(String) }),
      );
    });

    it('is a no-op when already resolved', () => {
      const c = useComment({ commentId: 'c-1', resolvedTime: 1234 });
      const superdoc = makeSuperdoc();
      c.resolveComment({ id: 'alice-id', email: 'a@b.com', name: 'Alice', superdoc });
      expect(c.resolvedById).toBeNull();
      expect(c.resolvedByEmail).toBeNull();
      expect(superdoc.emit).not.toHaveBeenCalled();
    });

    it('emits when tracked change is present (suggestion resolve path)', () => {
      const c = useComment({ commentId: 'c-1', trackedChange: { insert: {} } });
      const superdoc = makeSuperdoc();
      c.resolveComment({ id: 'alice-id', email: 'a@b.com', name: 'Alice', superdoc });
      expect(superdoc.emit).toHaveBeenCalled();
    });
  });

  describe('setIsInternal', () => {
    it('updates the flag and emits', () => {
      const c = useComment({ commentId: 'c-1', isInternal: true });
      const superdoc = makeSuperdoc();
      c.setIsInternal({ isInternal: false, superdoc });
      expect(c.isInternal).toBe(false);
      expect(superdoc.emit).toHaveBeenCalled();
    });

    it('short-circuits when value is unchanged', () => {
      const c = useComment({ commentId: 'c-1', isInternal: true });
      const superdoc = makeSuperdoc();
      c.setIsInternal({ isInternal: true, superdoc });
      expect(superdoc.emit).not.toHaveBeenCalled();
    });
  });

  describe('setText', () => {
    it('updates comment text and extracts mentions', () => {
      const c = useComment({ commentId: 'c-1' });
      const superdoc = makeSuperdoc();
      c.setText({
        text:
          'Hello <span data-type="mention" email="a@b.com" name="Alice"></span> and ' +
          '<span data-type="mention" email="c@d.com" name="Carol"></span>',
        superdoc,
      });
      expect(c.commentText).toContain('Hello');
      expect(c.mentions).toHaveLength(2);
      expect(c.mentions[0]).toMatchObject({ email: 'a@b.com', name: 'Alice' });
      expect(superdoc.emit).toHaveBeenCalled();
    });

    it('deduplicates repeated mentions by email + name', () => {
      const c = useComment({ commentId: 'c-1' });
      const superdoc = makeSuperdoc();
      c.setText({
        text:
          '<span data-type="mention" email="a@b.com" name="Alice"></span>' +
          '<span data-type="mention" email="a@b.com" name="Alice"></span>',
        superdoc,
      });
      expect(c.mentions).toHaveLength(1);
    });

    it('skips emit when suppressUpdate is true', () => {
      const c = useComment({ commentId: 'c-1' });
      const superdoc = makeSuperdoc();
      c.setText({ text: 'silent update', superdoc, suppressUpdate: true });
      expect(c.commentText).toBe('silent update');
      expect(superdoc.emit).not.toHaveBeenCalled();
    });
  });

  describe('updatePosition', () => {
    it('translates coords relative to the parent bounding rect', () => {
      const c = useComment({
        commentId: 'c-1',
        selection: { documentId: 'doc-1', selectionBounds: { top: 0, left: 0 } },
      });
      const parent = { getBoundingClientRect: () => ({ top: 50, left: 0 }) };
      c.updatePosition({ top: 100, left: 10, right: 20, bottom: 150 }, parent);
      expect(c.selection.selectionBounds).toEqual({
        top: 50,
        left: 10,
        right: 20,
        bottom: 100,
      });
      expect(c.selection.source).toBe(DOCUMENT_EDITOR_SELECTION_SOURCE);
    });
  });

  describe('getCommentUser', () => {
    it('returns imported author when present', () => {
      const c = useComment({
        commentId: 'c-1',
        importedAuthor: { name: 'Imported One', email: 'imp@x.com' },
      });
      expect(c.getCommentUser()).toEqual({ name: 'Imported One', email: 'imp@x.com' });
    });

    it('uses fallback "(Imported)" when importedAuthor.name is missing', () => {
      const c = useComment({
        commentId: 'c-1',
        importedAuthor: { email: 'imp@x.com' },
      });
      expect(c.getCommentUser()).toEqual({ name: '(Imported)', email: 'imp@x.com' });
    });

    it('returns creator info when no imported author', () => {
      const c = useComment({
        commentId: 'c-1',
        creatorName: 'Alice',
        creatorEmail: 'a@b.com',
        creatorImage: '/a.png',
      });
      expect(c.getCommentUser()).toEqual({
        id: null,
        name: 'Alice',
        email: 'a@b.com',
        image: '/a.png',
      });
    });
  });

  describe('getValues', () => {
    it('maps mentions to fall back to email when name is missing', () => {
      const c = useComment({ commentId: 'c-1' });
      const superdoc = makeSuperdoc();
      c.setText({
        text: '<span data-type="mention" email="x@y.com"></span>',
        superdoc,
        suppressUpdate: true,
      });
      const v = c.getValues();
      expect(v.mentions[0]).toEqual({ email: 'x@y.com', name: 'x@y.com' });
    });

    it('returns selection.getValues() when selection was provided', () => {
      const c = useComment({
        commentId: 'c-1',
        selection: { documentId: 'doc-1', page: 2, source: 'superdoc' },
      });
      const v = c.getValues();
      expect(v.selection.documentId).toBe('doc-1');
      expect(v.selection.page).toBe(2);
    });

    it('falls back to synthetic selection when none provided', () => {
      const c = useComment({ commentId: 'c-1', fileId: 'doc-1' });
      const v = c.getValues();
      expect(v.selection).toBeDefined();
      expect(v.selection.documentId).toBe('doc-1');
    });
  });
});
