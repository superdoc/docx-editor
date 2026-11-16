import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { assertTargetPresent } from '../validation-primitives.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type {
  BookmarkAddress,
  BookmarkGetInput,
  BookmarkInfo,
  BookmarkInsertInput,
  BookmarkRenameInput,
  BookmarkRemoveInput,
  BookmarkMutationResult,
  BookmarkListInput,
  BookmarksListResult,
} from './bookmarks.types.js';

// ---------------------------------------------------------------------------
// Adapter / API interface
// ---------------------------------------------------------------------------

export interface BookmarksApi {
  list(query?: BookmarkListInput): BookmarksListResult;
  get(input: BookmarkGetInput): BookmarkInfo;
  insert(input: BookmarkInsertInput, options?: MutationOptions): BookmarkMutationResult;
  rename(input: BookmarkRenameInput, options?: MutationOptions): BookmarkMutationResult;
  remove(input: BookmarkRemoveInput, options?: MutationOptions): BookmarkMutationResult;
}

export type BookmarksAdapter = BookmarksApi;

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

function validateBookmarkTarget(target: unknown, operationName: string): asserts target is BookmarkAddress {
  assertTargetPresent(target, operationName);

  const t = target as Record<string, unknown>;
  if (t.kind !== 'entity' || t.entityType !== 'bookmark' || typeof t.name !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target must be a BookmarkAddress with kind 'entity', entityType 'bookmark', and a string name.`,
      { target },
    );
  }
  if (t.story !== undefined) {
    validateStoryLocator(t.story, `${operationName}.target.story`);
  }
}

// ---------------------------------------------------------------------------
// Execute wrappers
// ---------------------------------------------------------------------------

export function executeBookmarksList(adapter: BookmarksAdapter, query?: BookmarkListInput): BookmarksListResult {
  if (query?.in !== undefined) {
    validateStoryLocator(query.in, 'bookmarks.list.in');
  }
  return adapter.list(query);
}

export function executeBookmarksGet(adapter: BookmarksAdapter, input: BookmarkGetInput): BookmarkInfo {
  validateBookmarkTarget(input.target, 'bookmarks.get');
  return adapter.get(input);
}

export function executeBookmarksInsert(
  adapter: BookmarksAdapter,
  input: BookmarkInsertInput,
  options?: MutationOptions,
): BookmarkMutationResult {
  if (!input.name || typeof input.name !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'bookmarks.insert requires a non-empty name string.');
  }
  if (input.name.length > 40 || !/^[\p{L}_]/u.test(input.name) || /[^\p{L}\p{Mn}\p{Mc}\p{Nd}_]/u.test(input.name)) {
    return {
      success: false,
      failure: {
        code: 'INVALID_PAYLOAD',
        message:
          'Bookmark names must start with a letter or underscore, contain only letters, combining marks, decimal digits or underscores, and be at most 40 UTF-16 code units long.',
      },
    };
  }
  return adapter.insert(input, normalizeMutationOptions(options));
}

export function executeBookmarksRename(
  adapter: BookmarksAdapter,
  input: BookmarkRenameInput,
  options?: MutationOptions,
): BookmarkMutationResult {
  validateBookmarkTarget(input.target, 'bookmarks.rename');
  if (!input.newName || typeof input.newName !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'bookmarks.rename requires a non-empty newName string.');
  }
  return adapter.rename(input, normalizeMutationOptions(options));
}

export function executeBookmarksRemove(
  adapter: BookmarksAdapter,
  input: BookmarkRemoveInput,
  options?: MutationOptions,
): BookmarkMutationResult {
  validateBookmarkTarget(input.target, 'bookmarks.remove');
  return adapter.remove(input, normalizeMutationOptions(options));
}
