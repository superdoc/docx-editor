import type { CommentsLayout, CommentsLayoutState } from '../core/types/index.js';
import { DEFAULT_COMMENTS_LAYOUT } from '../helpers/comment-small-screen.js';

export function fixedCommentsLayout(requested: CommentsLayout = DEFAULT_COMMENTS_LAYOUT): {
  getCommentsLayout(): CommentsLayoutState;
} {
  const layout: CommentsLayoutState = Object.freeze({
    requested,
    effective: requested === 'inline' ? 'inline' : 'sidebar',
  });
  return { getCommentsLayout: () => layout };
}
