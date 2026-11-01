import { describe, expect, it } from 'vite-plus/test';
import { collectRemovedCommentIds } from './collect-removed-comment-ids.js';

describe('collectRemovedCommentIds', () => {
  it('removes explicit tracked-change descendants', () => {
    const comments = [
      { commentId: 'tc-1', trackedChange: true },
      { commentId: 'reply', trackedChangeThreadParentId: 'tc-1' },
    ];

    expect([...collectRemovedCommentIds(comments, ['tc-1'])].sort()).toEqual(['reply', 'tc-1']);
  });

  it('removes legacy tracked-change descendants during deletion replay', () => {
    const comments = [
      { commentId: 'tc-1', trackedChange: true },
      {
        commentId: 'legacy-reply',
        trackedChangeParentId: 'tc-1',
        trackedChangeType: 'insert',
      },
    ];

    expect([...collectRemovedCommentIds(comments, ['tc-1'])].sort()).toEqual(['legacy-reply', 'tc-1']);
  });
});
