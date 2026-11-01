import { describe, expect, it, vi } from 'vite-plus/test';
import useComment from './use-comment.js';

const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+KD0aVQAAAABJRU5ErkJggg==';

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

  it('serializes the current tracked-change thread after reconciliation moves it', () => {
    const comment = useComment({
      commentId: 'comment-moved-between-changes',
      trackedChangeThreadParentId: 'tc-old',
    });

    comment.trackedChangeThreadParentId = 'tc-new';

    expect(comment.getValues().trackedChangeThreadParentId).toBe('tc-new');
  });

  it('preserves the tracked-change side used to route shared move conversations', () => {
    const comment = useComment({
      commentId: 'move-comment',
      trackedChangeThreadParentId: 'tc-move',
      trackedChangeSide: 'source',
    });

    expect(comment.trackedChangeSide).toBe('source');
    expect(comment.getValues().trackedChangeSide).toBe('source');

    comment.trackedChangeSide = 'destination';
    expect(comment.getValues().trackedChangeSide).toBe('destination');
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

  it('returns tracked-change image preview metadata from getValues()', () => {
    const comment = useComment({
      commentId: 'tc-image',
      trackedChange: true,
      trackedChangeImagePreview: {
        src: ONE_BY_ONE_PNG,
        contentType: 'image/png',
        role: 'deleted',
        width: 96,
        height: 96,
        alt: 'Deleted preview',
      },
    });

    expect(comment.getValues().trackedChangeImagePreview).toEqual({
      src: ONE_BY_ONE_PNG,
      contentType: 'image/png',
      role: 'deleted',
      width: 96,
      height: 96,
      alt: 'Deleted preview',
    });
  });

  it('preserves tracked-change position aliases in the reactive model and serialized values', () => {
    const comment = useComment({
      commentId: 'tc-canonical-delete',
      trackedChange: true,
      trackedChangePositionAliases: ['00000029'],
    });

    expect(comment.trackedChangePositionAliases).toEqual(['00000029']);
    expect(comment.getValues().trackedChangePositionAliases).toEqual(['00000029']);

    comment.trackedChangePositionAliases = ['00000030'];
    expect(comment.getValues().trackedChangePositionAliases).toEqual(['00000030']);
  });

  it('returns custom tracked-change attributes from getValues()', () => {
    const customAttributes = [
      {
        name: 'ext:rationale',
        namespaceUri: 'https://example.test/ns/edit',
        localName: 'rationale',
        value: 'customer-request',
      },
    ];
    const comment = useComment({
      commentId: 'tc-custom',
      trackedChange: true,
      customAttributes,
    });

    expect(comment.getValues().customAttributes).toEqual(customAttributes);
  });
});
