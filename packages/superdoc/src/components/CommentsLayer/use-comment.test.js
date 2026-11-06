import { describe, expect, it, vi } from 'vitest';
import useComment from './use-comment.js';
import * as Y from 'yjs';

describe('use-comment', () => {
  it('exposes threading metadata in getValues()', () => {
    const comment = useComment({
      commentId: 'comment-1',
      threadingParentCommentId: 'parent-1',
      origin: 'word',
      threadingMethod: 'commentsExtended',
      threadingStyleOverride: 'commentsExtended',
      originalXmlStructure: {
        hasCommentsExtended: true,
        hasCommentsExtensible: true,
        hasCommentsIds: true,
      },
    });

    const values = comment.getValues();
    expect(values.threadingParentCommentId).toBe('parent-1');
    expect(values.threadingMethod).toBe('commentsExtended');
    expect(values.threadingStyleOverride).toBe('commentsExtended');
    expect(values.origin).toBe('word');
    expect(values.originalXmlStructure).toEqual({
      hasCommentsExtended: true,
      hasCommentsExtensible: true,
      hasCommentsIds: true,
    });
  });

  it('returns the latest docxCommentJSON value from getValues()', () => {
    const comment = useComment({
      commentId: 'comment-2',
      docxCommentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }],
    });

    const updatedDocxCommentJSON = [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }];
    comment.docxCommentJSON = updatedDocxCommentJSON;

    const values = comment.getValues();
    expect(values.docxCommentJSON).toEqual(updatedDocxCommentJSON);
  });

  it('resolves thread descendants through comment and imported-id parent aliases', () => {
    const resolveCommentThread = vi.fn();
    const root = useComment({ commentId: 'root', importedId: 'imported-root' });
    const directReply = useComment({ commentId: 'reply-1', parentCommentId: 'imported-root' });
    const nestedReply = useComment({ commentId: 'reply-2', threadingParentCommentId: 'reply-1' });

    const superdoc = {
      activeEditor: { commands: { resolveCommentThread, resolveComment: vi.fn() } },
      commentsStore: { commentsList: [root, directReply, nestedReply] },
      config: { modules: { comments: false } },
      emit: vi.fn(),
      isCollaborative: false,
    };

    root.resolveComment({ id: 'user-1', email: 'user@example.com', name: 'User', superdoc });

    expect(resolveCommentThread).toHaveBeenCalledWith({
      comments: [
        { commentId: 'root', importedId: 'imported-root', preserveAnchor: true },
        { commentId: 'reply-1', importedId: undefined, preserveAnchor: false },
        { commentId: 'reply-2', importedId: undefined, preserveAnchor: false },
      ],
    });
  });
});

it('retains Word identity and author label through serialized collaboration and edits', () => {
  const pair = { providerId: 'AD', userId: 'S::synthetic@example.com::opaque' };
  const comment = useComment({ commentId: 'identity', creatorIdentity: pair, wordAuthorName: 'Alex [sd-1234]' });
  pair.userId = 'changed';
  const ydoc = new Y.Doc();
  ydoc.getArray('comments').push([new Y.Map(Object.entries(comment.getValues()))]);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(ydoc));
  const hydrated = useComment(restored.getArray('comments').toJSON()[0]);
  ydoc.destroy();
  restored.destroy();
  hydrated.setText({ text: 'Updated', suppressUpdate: true });
  expect(hydrated.getValues().creatorIdentity).toEqual({
    providerId: 'AD',
    userId: 'S::synthetic@example.com::opaque',
  });
  expect(hydrated.getValues().wordAuthorName).toBe('Alex [sd-1234]');
});
