/**
 * Command type augmentations for comment operations.
 *
 * @module CommentCommands
 */

import type { User } from '../../core/types/EditorConfig.js';

/** Options for addComment command */
export type AddCommentOptions = {
  /** The comment content (text or HTML) */
  content?: string;
  /** Explicit comment ID (defaults to a new UUID) */
  commentId?: string;
  /** Author name (defaults to user from editor config) */
  author?: string;
  /** Stable actor id (defaults to user from editor config) */
  authorId?: string;
  /** Author email (defaults to user from editor config) */
  authorEmail?: string;
  /** Author image URL (defaults to user from editor config) */
  authorImage?: string;
  /** Explicit provider identity. Defaults to user.wordIdentity only without author/name/id/email overrides; null opts out. */
  authorIdentity?: User['wordIdentity'];
  /** Whether the comment is internal/private (default: false) */
  isInternal?: boolean;
};

/** Options for insertComment command (internal use) */
export type InsertCommentOptions = {
  /** Unique identifier for the comment */
  commentId?: string;
  /** Imported comment ID from external source */
  importedId?: string;
  /** Whether the comment is internal (not visible to external users) */
  isInternal?: boolean;
  /** Skip emitting the commentsUpdate event */
  skipEmit?: boolean;
  /** Comment body as HTML/text */
  text?: string;
  /** Explicit comment body (preferred over text when provided) */
  commentText?: string;
  /** Comment creator name */
  creatorName?: string;
  /** Comment creator actor id */
  creatorId?: string;
  /** Comment creator email */
  creatorEmail?: string;
  /** Comment creator image URL */
  creatorImage?: string;
  /** Comment creation timestamp (ms) */
  createdTime?: number;
  /** Document/file ID */
  fileId?: string;
  /** Document ID (alias of fileId) */
  documentId?: string;
  /** Allow extra metadata fields */
  [key: string]: unknown;
};

/** Options for removeComment command */
export type RemoveCommentOptions = {
  /** The comment ID to remove */
  commentId?: string;
  /** The imported comment ID to remove */
  importedId?: string;
};

/** Options for setActiveComment command */
export type SetActiveCommentOptions = {
  /** The comment ID to set as active */
  commentId: string | null;
  /** The imported comment ID */
  importedId?: string;
};

/** Options for setCommentInternal command */
export type SetCommentInternalOptions = {
  /** The comment ID to update */
  commentId: string;
  /** The imported comment ID */
  importedId?: string;
  /** Whether the comment should be internal */
  isInternal: boolean;
};

/** Options for resolveComment command */
export type ResolveCommentOptions = {
  /** The comment ID to resolve */
  commentId: string;
  /** The imported comment ID */
  importedId?: string;
};

/** Comment identity used by resolveCommentThread */
export type ResolveCommentThreadItem = {
  /** The comment ID to resolve */
  commentId: string;
  /** The imported comment ID */
  importedId?: string;
  /** Whether resolving should preserve document-story anchor markers for this comment */
  preserveAnchor?: boolean;
};

/** Options for resolveCommentThread command */
export type ResolveCommentThreadOptions = {
  /** The thread root and replies to resolve in one transaction */
  comments: ResolveCommentThreadItem[];
};

/**
 * Options for the `reopenComment` command — symmetric inverse of
 * `resolveComment`. Restores the live `comment` mark across the
 * range previously anchored by `commentRangeStart`/`commentRangeEnd`.
 */
export type ReopenCommentOptions = {
  /** The comment ID to reopen */
  commentId: string;
  /** The imported comment ID — matched against `w:id` for legacy DOCX */
  importedId?: string;
  /**
   * Override for the restored mark's `internal` flag. When omitted,
   * the helper falls back to the value stamped on the resolve-time
   * `commentRangeStart` anchor so import-resolved comments keep their
   * flag without needing the entity store.
   */
  internal?: boolean;
};

/** Options for editComment command */
export type EditCommentOptions = {
  /** The comment ID to edit */
  commentId: string;
  /** The imported comment ID */
  importedId?: string;
  /** Updated content (text or HTML) */
  content?: string;
  /** Updated content alias */
  text?: string;
};

/** Options for moveComment command */
export type MoveCommentOptions = {
  /** The comment ID to move */
  commentId: string;
  /** Absolute ProseMirror start position */
  from: number;
  /** Absolute ProseMirror end position */
  to: number;
};

/** Options for addCommentReply command */
export type AddCommentReplyOptions = {
  /** The ID of the parent comment or tracked change to reply to */
  parentId: string;
  /** Optional explicit comment ID for deterministic callers */
  commentId?: string;
  /** The reply content (text or HTML) */
  content?: string;
  /** Author name (defaults to user from editor config) */
  author?: string;
  /** Stable actor id (defaults to user from editor config) */
  authorId?: string;
  /** Author email (defaults to user from editor config) */
  authorEmail?: string;
  /** Author image URL (defaults to user from editor config) */
  authorImage?: string;
  /** Explicit provider identity. Defaults to user.wordIdentity only without author/name/id/email overrides; null opts out. */
  authorIdentity?: User['wordIdentity'];
};

export interface CommentCommands {
  /**
   * Add a comment to the current selection
   * @param contentOrOptions - Comment content as a string, or an options object
   * @returns True if the comment was added successfully, false otherwise
   * @example
   * // Simple usage with just content
   * editor.commands.addComment('This needs review')
   *
   * // With options
   * editor.commands.addComment({
   *   content: 'Please clarify this section',
   *   author: 'Jane Doe',
   *   isInternal: true
   * })
   *
   * // To get the comment ID, listen to the commentsUpdate event
   * editor.on('commentsUpdate', (event) => {
   *   if (event.type === 'add') {
   *     console.log('New comment ID:', event.activeCommentId)
   *   }
   * })
   */
  addComment: (contentOrOptions?: string | AddCommentOptions) => boolean;

  /**
   * @private
   * Internal command to insert a comment mark at the current selection.
   * Use `addComment` for the public API.
   * @param options - Comment creation options
   */
  insertComment: (options?: InsertCommentOptions) => boolean;

  /**
   * Remove a comment by its ID
   * @param options - Object containing commentId or importedId
   * @example
   * editor.commands.removeComment({ commentId: 'comment-123' })
   * editor.commands.removeComment({ importedId: 'imported-456' })
   */
  removeComment: (options: RemoveCommentOptions) => boolean;

  /**
   * Set the active comment (highlight and focus)
   * @param options - Object containing commentId
   * @example
   * editor.commands.setActiveComment({ commentId: 'comment-123' })
   */
  setActiveComment: (options: SetActiveCommentOptions) => boolean;

  /**
   * Set whether a comment is internal (not visible to external users)
   * @param options - Object containing commentId and isInternal flag
   * @example
   * editor.commands.setCommentInternal({ commentId: 'comment-123', isInternal: true })
   */
  setCommentInternal: (options: SetCommentInternalOptions) => boolean;

  /**
   * Resolve a comment
   * @param options - Object containing commentId
   * @example
   * editor.commands.resolveComment({ commentId: 'comment-123' })
   */
  resolveComment: (options: ResolveCommentOptions) => boolean;

  /**
   * Resolve multiple comments in a thread as one editor transaction.
   * @param options - Object containing thread comment identities
   */
  resolveCommentThread: (options: ResolveCommentThreadOptions) => boolean;

  /**
   * Reopen a previously-resolved comment — the symmetric inverse of
   * `resolveComment`. Removes the `commentRangeStart` /
   * `commentRangeEnd` anchor nodes inserted at resolve time and
   * restores the live `comment` mark across the same range so the
   * comment surfaces again on the editing surface and in
   * `comments.list()` / `selection.current().activeCommentIds`.
   *
   * Surfaced on the public Document API as
   * `editor.doc.comments.patch({ commentId, status: 'active' })`.
   *
   * @param options - Object containing commentId and optional importedId / internal override
   * @example
   * editor.commands.reopenComment({ commentId: 'comment-123' })
   */
  reopenComment: (options: ReopenCommentOptions) => boolean;

  /**
   * Edit an existing comment payload.
   * @param options - Object containing comment id and updated content
   */
  editComment: (options: EditCommentOptions) => boolean;

  /**
   * Move a comment anchor to a new document range.
   * @param options - Object containing comment id and absolute target positions
   */
  moveComment: (options: MoveCommentOptions) => boolean;

  /**
   * Set cursor position to a comment by ID
   * @param id - The comment ID to navigate to
   * @param options - Optional navigation settings
   * @param options.activeCommentId - Explicitly activate this thread in the same transaction
   * @param options.preferredActiveThreadId - Preserve this thread as active when overlapping marks exist
   * @example
   * editor.commands.setCursorById('comment-123')
   */
  setCursorById: (id: string, options?: { activeCommentId?: string; preferredActiveThreadId?: string }) => boolean;

  /**
   * Add a reply to an existing comment or tracked change
   * @param options - Reply options including parentId and content
   * @returns True if the reply was added successfully, false otherwise
   * @example
   * editor.commands.addCommentReply({
   *   parentId: 'comment-123',
   *   content: 'I agree with this suggestion'
   * })
   */
  addCommentReply: (options: AddCommentReplyOptions) => boolean;
}

declare module '../../core/types/ChainedCommands.js' {
  interface ExtensionCommandMap extends CommentCommands {}
}
