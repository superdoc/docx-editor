import type { Position } from '../types/base.js';
import type { TextTarget } from '../types/address.js';
import type { StoryLocator } from '../types/story.types.js';
import type { AdapterMutationFailure } from '../types/adapter-result.js';
import type { DiscoveryOutput } from '../types/discovery.js';

// ---------------------------------------------------------------------------
// Bookmark address
// ---------------------------------------------------------------------------

export interface BookmarkAddress {
  kind: 'entity';
  entityType: 'bookmark';
  name: string;
  /**
   * Story containing this bookmark. Omit for body (backward compatible).
   *
   * When omitted, bookmark operations resolve by `name` across the whole
   * document. If multiple stories contain the same bookmark name, omitted-story
   * lookup resolves to the first match returned by the implementation's
   * document-wide bookmark scan; callers must not rely on a specific cross-story
   * ordering rule. Prefer the `address` returned by bookmark read operations
   * (`bookmarks.list`, `bookmarks.get`) because those responses populate
   * `story` for non-body bookmarks.
   */
  story?: StoryLocator;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface BookmarkListInput {
  limit?: number;
  offset?: number;
  /** Restrict listing to a specific story. Omit to search document-wide. */
  in?: StoryLocator;
}

export interface BookmarkGetInput {
  target: BookmarkAddress;
}

export interface BookmarkInsertInput {
  /**
   * Bookmark creation name: starts with a Unicode letter or underscore, followed by
   * letters, nonspacing/spacing combining marks, decimal digits or underscores.
   * At most 40 UTF-16 code units; invalid names return INVALID_PAYLOAD without
   * mutation. Names are not normalized or truncated. Imported names are unaffected.
   */
  name: string;
  at: TextTarget;
  /**
   * For table-column bookmarks: restricts the bookmark to a column range
   * within a table row. (Amendment 8)
   */
  tableColumn?: {
    colFirst: number;
    colLast: number;
  };
}

export interface BookmarkRenameInput {
  target: BookmarkAddress;
  newName: string;
}

export interface BookmarkRemoveInput {
  target: BookmarkAddress;
}

// ---------------------------------------------------------------------------
// Info / domain
// ---------------------------------------------------------------------------

export interface BookmarkInfo {
  address: BookmarkAddress;
  name: string;
  bookmarkId: string;
  range: { from: Position; to: Position };
  tableColumn?: {
    colFirst: number;
    colLast: number;
  };
}

export interface BookmarkDomain {
  address: BookmarkAddress;
  name: string;
  bookmarkId: string;
  range: { from: Position; to: Position };
  tableColumn?: { colFirst: number; colLast: number };
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface BookmarkMutationSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  bookmark: BookmarkAddress;
}

export type BookmarkMutationResult = BookmarkMutationSuccess | AdapterMutationFailure;

// ---------------------------------------------------------------------------
// List result
// ---------------------------------------------------------------------------

export type BookmarksListResult = DiscoveryOutput<BookmarkDomain>;
