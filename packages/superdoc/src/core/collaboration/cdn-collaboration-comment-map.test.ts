import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as Y from 'yjs';
import { createCollaborationCommentMap } from './cdn-collaboration-comment-map.js';

const runtimeKey = '__SUPERDOC_V2_BROWSER_RUNTIME__';

afterEach(() => Reflect.deleteProperty(globalThis, runtimeKey));

describe('CDN collaboration comment maps', () => {
  it('uses the engine Yjs constructor for shared array entries', () => {
    Reflect.set(globalThis, runtimeKey, { yjs: Y });
    const doc = new Y.Doc();
    try {
      const comments = doc.getArray('comments');
      const comment = createCollaborationCommentMap([
        ['commentId', 'c1'],
        ['text', 'first'],
      ]);
      expect(comment).toBeInstanceOf(Y.Map);
      comments.push([comment]);
      expect(comments.toJSON()).toEqual([{ commentId: 'c1', text: 'first' }]);
    } finally {
      doc.destroy();
    }
  });

  it('reports an unavailable runtime before constructing a comment', () => {
    expect(() => createCollaborationCommentMap([['commentId', 'c1']])).toThrow(
      'SuperDoc: the shared Yjs runtime is unavailable for collaboration comments.',
    );
  });
});
