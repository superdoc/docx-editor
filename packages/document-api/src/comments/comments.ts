import type { Receipt, ReceiptFailureResult, ReceiptSuccess, StoryLocator } from '../types/index.js';
import type {
  CommentInfo,
  CommentCreateAttributionInput,
  CommentTarget,
  CommentsListQuery,
  CommentsListResult,
  TextSearchCommentTarget,
  TrackedChangeCommentTarget,
  TrackedChangeCommentTargetSide,
} from './comments.types.js';
import type { RevisionGuardOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isTextAddress, isTextTarget, assertNoUnknownFields } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { normalizeCommentCreateAttribution } from './comment-create-attribution.js';

export type { TextSearchCommentTarget, TrackedChangeCommentTarget, TrackedChangeCommentTargetSide };
export type { CommentCreateAttributionInput, CommentMetadata, CommentMetadataValue } from './comments.types.js';

function isTrackedChangeCommentTarget(value: unknown): value is TrackedChangeCommentTarget {
  // Accept both the canonical `{ kind: 'trackedChange', trackedChangeId }`
  // shape and the Labs compatibility shape `{ trackedChangeId }` with no
  // explicit `kind`. Either way the downstream
  // `validateTrackedChangeCommentTarget` enforces non-empty trackedChangeId,
  // side enum, and no unknown fields. Targets that look like a TextAddress
  // (kind === 'text') are routed to the text validator instead.
  if (!isRecord(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'trackedChange') return true;
  if (kind !== undefined) return false;
  return typeof (value as { trackedChangeId?: unknown }).trackedChangeId === 'string';
}

/**
 * Input for adding a comment to a text range.
 *
 * `target` accepts either a single-block {@link TextAddress} or a multi-
 * segment {@link TextTarget}. A multi-segment target anchors the comment
 * across contiguous blocks: use it directly from `editor.doc.selection.current().target`
 * without picking a single segment.
 */
export interface AddCommentInput extends CommentCreateAttributionInput {
  /**
   * The text range to attach the comment to.
   *
   * Pass a {@link TextAddress} for single-block ranges (e.g. from `find`'s
   * `textRanges[0]`), a {@link TextTarget} with multi-segment for
   * selections that span multiple blocks, or a
   * {@link TrackedChangeCommentTarget} that names a logical tracked-change
   * id as a convenience anchor (the adapter normalizes it to the actual
   * content range on the relevant revision side).
   */
  target?: CommentTarget;
  /** The comment body text. */
  text: string;
  expectedText?: string;
}

export interface EditCommentInput {
  commentId: string;
  text: string;
}

export interface ReplyToCommentInput extends CommentCreateAttributionInput {
  parentCommentId: string;
  text: string;
}

export interface MoveCommentInput {
  commentId: string;
  /**
   * New root-thread anchor target. Existing descendant anchors move with the root.
   * Accepts a plain {@link TextAddress}, a
   * {@link SelectionTarget}, or a {@link TrackedChangeCommentTarget} that
   * names a logical tracked-change id as a convenience re-anchor target.
   */
  target: CommentTarget;
}

export interface ResolveCommentInput {
  commentId: string;
}

/**
 * Input for reopening a previously-resolved comment. Accepted as the
 * `status: 'active'` branch of `comments.patch`.
 */
export interface ReopenCommentInput {
  commentId: string;
}

export interface RemoveCommentInput {
  commentId: string;
}

export interface SetCommentInternalInput {
  commentId: string;
  isInternal: boolean;
}

export interface SetCommentActiveInput {
  commentId: string | null;
}

export interface GoToCommentInput {
  commentId: string;
}

export interface GetCommentInput {
  commentId: string;
}

// ---------------------------------------------------------------------------
// Canonical consolidated inputs
// ---------------------------------------------------------------------------

/**
 * Input for `comments.create`: creates a new comment thread or a reply.
 *
 * When `parentCommentId` is provided, creates a reply on an existing thread.
 * Otherwise, creates a new root comment anchored to the given text range.
 */
export interface CommentsCreateInput extends CommentCreateAttributionInput {
  /** The comment body text. */
  text: string;
  /**
   * Compatibility alias for {@link CommentCreateAttributionInput.externalId},
   * matching the caller-supplied `commentId` accepted by the v1 editor.
   *
   * V2 still mints a separate Word-compatible id for the document. Pass
   * either `commentId` or `externalId`; when both are present they must agree.
   */
  commentId?: string;
  /**
   * The text range to attach the comment to (root comments only).
   *
   * Accepts either a single-block {@link TextAddress}, a multi-segment
   * {@link TextTarget}, or a {@link TrackedChangeCommentTarget} that
   * names a logical tracked-change id as a convenience anchor. Prefer
   * passing `editor.doc.selection.current().target` directly for
   * selections that may span multiple blocks.
   */
  target?: CommentTarget;
  /**
   * Compatibility shorthand for {@link TrackedChangeCommentTarget}. When
   * `target` is omitted, execute normalizes this to
   * `target: { trackedChangeId, side, story }` before validation.
   */
  trackedChangeId?: string;
  /** Optional side for the `trackedChangeId` shorthand. */
  side?: TrackedChangeCommentTargetSide;
  /** Optional story for the `trackedChangeId` shorthand. */
  story?: StoryLocator;
  /** Parent comment ID: when provided, creates a reply instead of a root comment. */
  parentCommentId?: string;
  /**
   * Public contract alias for {@link parentCommentId}. Pass either key, or
   * both when they contain the same value.
   */
  parentId?: string;
  expectedText?: string;
}

/**
 * Input for `comments.patch`: field-level patch on an existing comment.
 *
 * Exactly one mutation field (`text`, `target`, `status`, `isInternal`)
 * must be provided per call. Providing zero or multiple fields throws
 * `INVALID_INPUT`.
 */
export interface CommentsPatchInput {
  /** The ID of the comment to patch. */
  commentId: string;
  /** New body text (routes to edit). */
  text?: string;
  /**
   * New anchor range (routes to move). Accepts a plain
   * {@link TextAddress} or {@link SelectionTarget} for direct anchor replacement, or a
   * {@link TrackedChangeCommentTarget} that names a logical
   * tracked-change id as a convenience re-anchor target.
   */
  target?: CommentTarget;
  /**
   * Lifecycle transition. `'resolved'` routes to resolve, `'active'`
   * routes to reopen: symmetric inverse that removes the resolve
   * anchors and restores the live comment mark.
   */
  status?: 'resolved' | 'active';
  /** Set the internal/private flag (routes to setInternal). */
  isInternal?: boolean;
}

/**
 * Input for `comments.delete`: removes a comment by ID.
 */
export interface CommentsDeleteInput {
  /** The ID of the comment to delete. */
  commentId: string;
}

export type CommentsCreateReceiptSuccess = ReceiptSuccess & {
  /** Convenience alias for the created comment id. */
  id: string;
};

export type CommentsCreateReceipt = CommentsCreateReceiptSuccess | ReceiptFailureResult;

/**
 * Engine-specific adapter that the comments API delegates to.
 */
export interface CommentsAdapter {
  /** Add a comment at the specified text range. */
  add(input: AddCommentInput, options?: RevisionGuardOptions): CommentsCreateReceipt;
  /** Edit the body text of an existing comment. */
  edit(input: EditCommentInput, options?: RevisionGuardOptions): Receipt;
  /** Reply to an existing comment thread. */
  reply(input: ReplyToCommentInput, options?: RevisionGuardOptions): CommentsCreateReceipt;
  /** Move a comment to a different text range. */
  move(input: MoveCommentInput, options?: RevisionGuardOptions): Receipt;
  /** Resolve an open comment. */
  resolve(input: ResolveCommentInput, options?: RevisionGuardOptions): Receipt;
  /**
   * Reopen a previously-resolved comment. Symmetric inverse of
   * {@link CommentsAdapter.resolve}: removes the
   * `commentRangeStart` / `commentRangeEnd` anchor nodes inserted at
   * resolve time and restores the live `comment` mark across the
   * original range so subsequent operations see the comment as active.
   */
  reopen(input: ReopenCommentInput, options?: RevisionGuardOptions): Receipt;
  /** Remove a comment from the document. */
  remove(input: RemoveCommentInput, options?: RevisionGuardOptions): Receipt;
  /** Set the internal/private flag on a comment. */
  setInternal(input: SetCommentInternalInput, options?: RevisionGuardOptions): Receipt;
  /** Set which comment is currently active/focused. Pass `null` to clear. */
  setActive(input: SetCommentActiveInput, options?: RevisionGuardOptions): Receipt;
  /** Scroll to and focus a comment in the document. */
  goTo(input: GoToCommentInput): Receipt;
  /** Retrieve full information for a single comment. */
  get(input: GetCommentInput): CommentInfo;
  /** List comments matching the given query. */
  list(query?: CommentsListQuery): CommentsListResult;
}

/**
 * Public comments API surface exposed on `editor.doc.comments`.
 *
 * Canonical operations: `create`, `patch`, `delete`, `get`, `list`.
 *
 * Excludes UI-state operations (`setActive`, `goTo`) that live on
 * {@link CommentsAdapter} for internal editor use but are not part
 * of the document-api contract.
 */
export interface CommentsApi {
  create(input: CommentsCreateInput, options?: RevisionGuardOptions): CommentsCreateReceipt;
  patch(input: CommentsPatchInput, options?: RevisionGuardOptions): Receipt;
  delete(input: CommentsDeleteInput, options?: RevisionGuardOptions): Receipt;
  get(input: GetCommentInput): CommentInfo;
  list(query?: CommentsListQuery): CommentsListResult;
}

const CREATE_COMMENT_ALLOWED_KEYS = new Set([
  'target',
  'text',
  'parentCommentId',
  'parentId',
  'trackedChangeId',
  'side',
  'story',
  'commentId',
  'externalId',
  'author',
  'authorId',
  'authorEmail',
  'authorImage',
  'metadata',
  'expectedText',
]);

/**
 * Validates CommentsCreateInput for root comments (non-reply) and throws DocumentApiValidationError on violations.
 */
function normalizeCreateCommentInput(input: unknown): CommentsCreateInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'comments.create input must be a non-null object.');
  }

  assertNoUnknownFields(input, CREATE_COMMENT_ALLOWED_KEYS, 'comments.create');

  const callerCommentId = input.commentId;
  const externalId = input.externalId;
  if (callerCommentId !== undefined && externalId !== undefined && callerCommentId !== externalId) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'commentId and externalId disagree; pass one value or make them identical.',
      {
        field: 'commentId',
        value: callerCommentId,
      },
    );
  }

  // Keep the standard V2 path allocation-free. The compatibility path is
  // normalized once at the public boundary so adapters only ever receive the
  // canonical externalId spelling.
  let normalizedRecord = input;
  if (Object.prototype.hasOwnProperty.call(input, 'commentId')) {
    const { commentId: _commentId, ...rest } = input;
    normalizedRecord =
      callerCommentId !== undefined && externalId === undefined ? { ...rest, externalId: callerCommentId } : rest;
  }

  const parentId = normalizedRecord.parentId;
  const parentCommentId = normalizedRecord.parentCommentId;
  if (parentId !== undefined && parentCommentId !== undefined && parentId !== parentCommentId) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'parentId and parentCommentId disagree; pass one.', {
      field: 'parentId',
      value: parentId,
    });
  }

  let normalizedInput: CommentsCreateInput =
    parentId === undefined
      ? (normalizedRecord as unknown as CommentsCreateInput)
      : (() => {
          const { parentId: _parentId, ...rest } = normalizedRecord;
          return { ...rest, parentCommentId: parentId } as CommentsCreateInput;
        })();

  const attribution = normalizeCommentCreateAttribution(normalizedInput);
  if (attribution) normalizedInput = { ...normalizedInput, ...attribution };

  const { target, text, parentCommentId: normalizedParentCommentId, trackedChangeId, expectedText } = normalizedInput;
  const hasTarget = target !== undefined;
  const isReply = normalizedParentCommentId !== undefined;

  if (typeof text !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `text must be a string, got ${typeof text}.`, {
      field: 'text',
      value: text,
    });
  }

  if (expectedText !== undefined && (typeof expectedText !== 'string' || isReply)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'expectedText requires a string and an explicit single-paragraph text target.',
      { field: 'expectedText' },
    );
  }

  // Replies only need parentCommentId + text: skip target validation
  if (isReply) {
    if (typeof normalizedParentCommentId !== 'string' || normalizedParentCommentId.length === 0) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'parentCommentId must be a non-empty string.', {
        field: 'parentCommentId',
        value: normalizedParentCommentId,
      });
    }
    if (hasTarget) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'Cannot combine parentCommentId with target. Replies do not take a target.',
        { fields: ['parentCommentId', 'target'] },
      );
    }
    if (trackedChangeId !== undefined) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'Cannot combine parentCommentId with trackedChangeId. Replies do not take a target.',
        { fields: ['parentCommentId', 'trackedChangeId'] },
      );
    }
    return normalizedInput;
  }

  if (!hasTarget && trackedChangeId === undefined) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'comments.create requires a target for root comments.', {
      field: 'target',
    });
  }

  const effectiveTarget = hasTarget ? target : buildTrackedChangeTargetFromCreateShorthand(normalizedInput);

  if (expectedText !== undefined && !isSingleParagraphTextTarget(effectiveTarget)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'expectedText requires a string and an explicit single-paragraph text target.',
      { field: 'expectedText' },
    );
  }

  if (isTrackedChangeCommentTarget(effectiveTarget)) {
    validateTrackedChangeCommentTarget(effectiveTarget, 'comments.create');
    return normalizedInput;
  }

  if (isTextSearchCommentTarget(effectiveTarget)) {
    validateTextSearchCommentTarget(effectiveTarget, 'comments.create');
    return normalizedInput;
  }

  if (!isTextAddress(effectiveTarget) && !isTextTarget(effectiveTarget) && !isSelectionTarget(effectiveTarget)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'target must be a TextAddress, TextTarget, SelectionTarget, TrackedChangeCommentTarget, or TextSearchCommentTarget object.',
      {
        field: 'target',
        value: effectiveTarget,
      },
    );
  }

  return normalizedInput;
}

function isSingleParagraphTextTarget(target: unknown): boolean {
  if (isTextAddress(target)) return true;
  if (isTextTarget(target)) return target.segments.length === 1 && target.coordinateSpace !== 'tracked';
  return (
    isSelectionTarget(target) &&
    target.start.kind === 'text' &&
    target.end.kind === 'text' &&
    target.start.blockId === target.end.blockId
  );
}

function buildTrackedChangeTargetFromCreateShorthand(
  input: CommentsCreateInput,
): TrackedChangeCommentTarget | undefined {
  if (input.trackedChangeId === undefined) return undefined;
  return {
    trackedChangeId: input.trackedChangeId,
    ...(input.side ? { side: input.side } : {}),
    ...(input.story ? { story: input.story } : {}),
  };
}

const TRACKED_CHANGE_COMMENT_TARGET_ALLOWED_KEYS = new Set(['kind', 'trackedChangeId', 'side', 'story']);
const TEXT_SEARCH_COMMENT_TARGET_ALLOWED_KEYS = new Set(['text', 'story']);

function isTextSearchCommentTarget(value: unknown): value is TextSearchCommentTarget {
  if (!isRecord(value)) return false;
  if ((value as { kind?: unknown }).kind !== undefined) return false;
  return typeof (value as { text?: unknown }).text === 'string';
}

function validateTextSearchCommentTarget(target: TextSearchCommentTarget, operationName: string): void {
  assertNoUnknownFields(
    target as unknown as Record<string, unknown>,
    TEXT_SEARCH_COMMENT_TARGET_ALLOWED_KEYS,
    `${operationName} target`,
  );
  if (target.text.trim().length === 0) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} target.text must be non-empty.`, {
      field: 'target.text',
      value: target.text,
    });
  }
  validateStoryLocator(target.story, 'target.story');
}

function validateTrackedChangeCommentTarget(target: TrackedChangeCommentTarget, operationName: string): void {
  assertNoUnknownFields(
    target as unknown as Record<string, unknown>,
    TRACKED_CHANGE_COMMENT_TARGET_ALLOWED_KEYS,
    `${operationName} target`,
  );
  const trackedChangeId = (target as { trackedChangeId?: unknown }).trackedChangeId;
  if (typeof trackedChangeId !== 'string' || trackedChangeId.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target.trackedChangeId must be a non-empty string.`,
      {
        field: 'target.trackedChangeId',
        value: trackedChangeId,
      },
    );
  }
  const side = (target as { side?: unknown }).side;
  if (side !== undefined && side !== 'inserted' && side !== 'deleted' && side !== 'source' && side !== 'destination') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target.side must be "inserted", "deleted", "source", or "destination" when provided.`,
      {
        field: 'target.side',
        value: side,
      },
    );
  }
  validateStoryLocator((target as { story?: unknown }).story, 'target.story');
}

const PATCH_COMMENT_ALLOWED_KEYS = new Set(['commentId', 'target', 'text', 'status', 'isInternal']);

/**
 * Validates CommentsPatchInput target fields and throws DocumentApiValidationError on violations.
 * Only validates target-related fields when a target is being patched.
 */
function validatePatchCommentInput(input: unknown): asserts input is CommentsPatchInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'comments.patch input must be a non-null object.');
  }

  assertNoUnknownFields(input, PATCH_COMMENT_ALLOWED_KEYS, 'comments.patch');

  const { commentId, target } = input;
  const hasTarget = target !== undefined;

  if (typeof commentId !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `commentId must be a string, got ${typeof commentId}.`, {
      field: 'commentId',
      value: commentId,
    });
  }

  // Enforce exactly one mutation field per call to guarantee atomicity.
  const mutationFields = ['text', 'target', 'status', 'isInternal'] as const;
  const providedFields = mutationFields.filter((f) => input[f] !== undefined);
  if (providedFields.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'comments.patch requires exactly one mutation field (text, target, status, or isInternal).',
      { allowedFields: [...mutationFields] },
    );
  }
  if (providedFields.length > 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `comments.patch accepts exactly one mutation field per call, got ${providedFields.length}: ${providedFields.join(', ')}.`,
      { providedFields: [...providedFields] },
    );
  }

  const { text, status, isInternal } = input;

  if (text !== undefined && typeof text !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `text must be a string, got ${typeof text}.`, {
      field: 'text',
      value: text,
    });
  }

  if (status !== undefined && status !== 'resolved' && status !== 'active') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `status must be "resolved" or "active", got "${String(status)}".`,
      {
        field: 'status',
        value: status,
      },
    );
  }

  if (isInternal !== undefined && typeof isInternal !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', `isInternal must be a boolean, got ${typeof isInternal}.`, {
      field: 'isInternal',
      value: isInternal,
    });
  }

  if (hasTarget) {
    if (isTrackedChangeCommentTarget(target)) {
      validateTrackedChangeCommentTarget(target, 'comments.patch');
    } else if (isTextSearchCommentTarget(target)) {
      validateTextSearchCommentTarget(target, 'comments.patch');
    } else if (!isTextAddress(target) && !isTextTarget(target) && !isSelectionTarget(target)) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'target must be a TextAddress, TextTarget, SelectionTarget, TrackedChangeCommentTarget, or TextSearchCommentTarget object.',
        {
          field: 'target',
          value: target,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Execute wrappers: canonical interception point for input normalization
// and validation. These route to the fine-grained adapter methods.
// ---------------------------------------------------------------------------

/**
 * Execute `comments.create`: routes to `adapter.add` or `adapter.reply`
 * depending on whether `parentCommentId` is provided.
 *
 * Accepts {@link RevisionGuardOptions} instead of `MutationOptions` because
 * comments route to specialized adapter methods (add/edit/reply/move/resolve/remove)
 * outside the plan engine, so changeMode and dryRun are not applicable.
 */
export function executeCommentsCreate(
  adapter: CommentsAdapter,
  input: CommentsCreateInput,
  options?: RevisionGuardOptions,
): CommentsCreateReceipt {
  // Normalize the public parentId alias before dispatch so adapters only see
  // the internal parentCommentId spelling.
  const normalizedInput = normalizeCreateCommentInput(input);
  const creation = projectCommentCreationInput(normalizedInput);

  if (normalizedInput.parentCommentId !== undefined) {
    return adapter.reply({ parentCommentId: normalizedInput.parentCommentId, ...creation }, options);
  }
  if (normalizedInput.target === undefined && normalizedInput.trackedChangeId !== undefined) {
    const { trackedChangeId, side, story } = normalizedInput;
    return adapter.add(
      {
        ...creation,
        target: {
          trackedChangeId,
          ...(side ? { side } : {}),
          ...(story ? { story } : {}),
        },
      },
      options,
    );
  }
  // Preserve the allocation-free default root path: normalizedInput itself is
  // already a valid AddCommentInput when no reply/shorthand projection is needed.
  return adapter.add(normalizedInput, options);
}

function projectCommentCreationInput(input: CommentsCreateInput): Omit<AddCommentInput, 'target'> {
  return {
    text: input.text,
    ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
    ...(input.author !== undefined ? { author: input.author } : {}),
    ...(input.authorId !== undefined ? { authorId: input.authorId } : {}),
    ...(input.authorEmail !== undefined ? { authorEmail: input.authorEmail } : {}),
    ...(input.authorImage !== undefined ? { authorImage: input.authorImage } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

/**
 * Execute `comments.patch`: routes to exactly one adapter method based on
 * the single mutation field provided. Validation enforces one-field-per-call.
 *
 * Accepts {@link RevisionGuardOptions} instead of `MutationOptions` because
 * comments route to specialized adapter methods (add/edit/reply/move/resolve/remove)
 * outside the plan engine, so changeMode and dryRun are not applicable.
 */
export function executeCommentsPatch(
  adapter: CommentsAdapter,
  input: CommentsPatchInput,
  options?: RevisionGuardOptions,
): Receipt {
  validatePatchCommentInput(input);

  if (input.text !== undefined) {
    return adapter.edit({ commentId: input.commentId, text: input.text }, options);
  }
  if (input.target !== undefined) {
    return adapter.move({ commentId: input.commentId, target: input.target }, options);
  }
  if (input.status === 'resolved') {
    return adapter.resolve({ commentId: input.commentId }, options);
  }
  if (input.status === 'active') {
    return adapter.reopen({ commentId: input.commentId }, options);
  }
  if (input.isInternal !== undefined) {
    return adapter.setInternal({ commentId: input.commentId, isInternal: input.isInternal }, options);
  }

  // Unreachable after validation: throw if we somehow get here.
  throw new DocumentApiValidationError(
    'INTERNAL_ERROR',
    'comments.patch: no mutation field matched after validation. This is a bug.',
  );
}

function validateCommentIdInput(input: unknown, operationName: string): asserts input is { commentId: string } {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} input must be a non-null object.`);
  }
  if (typeof input.commentId !== 'string' || input.commentId.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} commentId must be a non-empty string.`, {
      field: 'commentId',
      value: input.commentId,
    });
  }
}

/**
 * Execute `comments.delete`: routes to `adapter.remove`.
 */
export function executeCommentsDelete(
  adapter: CommentsAdapter,
  input: CommentsDeleteInput,
  options?: RevisionGuardOptions,
): Receipt {
  validateCommentIdInput(input, 'comments.delete');
  return adapter.remove({ commentId: input.commentId }, options);
}

export function executeGetComment(adapter: CommentsAdapter, input: GetCommentInput): CommentInfo {
  validateCommentIdInput(input, 'comments.get');
  return adapter.get(input);
}

export function executeListComments(adapter: CommentsAdapter, query?: CommentsListQuery): CommentsListResult {
  if (query !== undefined && !isRecord(query)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'comments.list query must be an object if provided.');
  }
  return adapter.list(query);
}
