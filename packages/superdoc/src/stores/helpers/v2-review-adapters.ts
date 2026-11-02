import type { CommentInputParams } from '../../components/CommentsLayer/comment-params.js';
import { isPlainObject } from '../../helpers/object-guards.js';
import type { StoryLocator } from '../../core/types/index.js';
import type { TrackedChangeDecisionOutcome } from './tracked-change-decision.js';

export type V2CommentMention = { id?: string | null; name?: string | null; email?: string | null };

export type V2CommentMutationOutcome = {
  ok: boolean;
  items?: unknown[];
  reason?: string;
  code?: string;
  detail?: unknown;
  committed?: boolean;
  complete?: boolean;
  visibleWindowSource?: string;
  threadLifecycle?: { commentId: string; status: 'open' | 'resolved' };
  removedCommentIds?: string[];
  createdCommentId?: string;
  mutationPath?: string;
};

export type V2CommentsCapabilityState = { canWrite?: boolean; reason?: string | null };

export type V2CommentSelectionCapture = { ok: boolean; target?: unknown; reason?: string; detail?: unknown };

export type V2ReviewCatalogSeedResult = { ok: boolean; reason?: string };

export type V2VisibleReviewComments = { ok: boolean; items?: unknown[]; unresolvedIds?: string[]; reason?: string };

export type V2ReviewAdapterDocumentId = string | number | null;

export type V2CommentInputOptions = { fileId: V2ReviewAdapterDocumentId; fileType: string | null };

export interface V2CommentsAdapter {
  documentId?: V2ReviewAdapterDocumentId;
  setActiveComment(commentId: string | null): Promise<V2CommentMutationOutcome>;
  commitPendingComment(input: {
    text: string;
    target?: unknown;
    mentions?: readonly V2CommentMention[];
  }): Promise<V2CommentMutationOutcome>;
  reply(input: {
    parentCommentId: string;
    text: string;
    mentions?: readonly V2CommentMention[];
  }): Promise<V2CommentMutationOutcome>;
  edit(input: { commentId: string; text: string }): Promise<V2CommentMutationOutcome>;
  resolve(input: { commentId: string }): Promise<V2CommentMutationOutcome>;
  reopen(input: { commentId: string }): Promise<V2CommentMutationOutcome>;
  delete(input: { commentId: string }): Promise<V2CommentMutationOutcome>;
  mapV2CommentToUseCommentInput(item: unknown, options: V2CommentInputOptions): CommentInputParams | null;
  getCapabilityState?(command?: string | null): V2CommentsCapabilityState | null | undefined;
  captureCurrentSelection?(options?: {
    beforeReady?: (snapshot: unknown) => void | Promise<void>;
  }): Promise<V2CommentSelectionCapture>;
  isPendingCommentCreation?(commentId: string | undefined): boolean;
  seedReviewCatalog?(
    items: unknown[],
    metadata?: { sourceCoverageRevision?: string; evaluatedRevision?: string },
  ): V2ReviewCatalogSeedResult;
  selectVisibleReviewComments?(): V2VisibleReviewComments | PromiseLike<V2VisibleReviewComments>;
}

export type V2TrackedChangeDecisionResult = TrackedChangeDecisionOutcome & {
  ok: boolean;
  reason?: string;
  detail?: unknown;
  documentId?: string | null;
};

export type V2TrackedChangeCommentParams = {
  event?: string | null;
  changeId?: string | number | null;
  documentId?: V2ReviewAdapterDocumentId;
  trackedChangeText?: string | null;
  trackedChangeType?: string | null;
  trackedChangeDisplayType?: string | null;
  semanticColorKey?: string | null;
  semanticColor?: string | null;
  deletedText?: string | null;
  trackedChangeLabel?: string | null;
  trackedChangeDetailLines?: unknown;
  trackedChangeImagePreview?: unknown;
  customAttributes?: unknown;
  authorId?: string | null;
  authorEmail?: string | null;
  authorImage?: string | null;
  author?: string | null;
  date?: number;
  importedAuthor?: CommentInputParams['importedAuthor'];
  importedId?: string | number | null;
  coords?: NonNullable<CommentInputParams['selection']>['selectionBounds'];
  trackedChangeStory?: StoryLocator | null;
  trackedChangeStoryKind?: string | null;
  trackedChangeStoryLabel?: string;
  trackedChangeAnchorKey?: string | null;
  trackedChangeCanonicalId?: string | null;
  trackedChangePositionAliases?: unknown;
  resolvedById?: string | null;
  resolvedByEmail?: string | null;
  resolvedByName?: string | null;
  decision?: 'accept' | 'reject' | null;
  reason?: string;
};

export interface V2TrackedChangesAdapter {
  documentId?: V2ReviewAdapterDocumentId;
  accept(target: unknown): Promise<V2TrackedChangeDecisionResult>;
  reject(target: unknown): Promise<V2TrackedChangeDecisionResult>;
  mapV2TrackedChangeToCommentParams(item: unknown): V2TrackedChangeCommentParams | null;
  clearActiveTrackedChangeTargetIfMatches?(decidedId: string): unknown;
}

type MethodKeys<Adapter> = Exclude<keyof Adapter, 'documentId'>;

export type RequiredMethodKeys<Adapter> = {
  [Member in MethodKeys<Adapter>]-?: undefined extends Adapter[Member] ? never : Member;
}[MethodKeys<Adapter>];

export type OptionalMethodKeys<Adapter> = Exclude<MethodKeys<Adapter>, RequiredMethodKeys<Adapter>>;

export const COMMENTS_ADAPTER_METHODS = [
  'setActiveComment',
  'commitPendingComment',
  'reply',
  'edit',
  'resolve',
  'reopen',
  'delete',
  'mapV2CommentToUseCommentInput',
] as const satisfies readonly RequiredMethodKeys<V2CommentsAdapter>[];

export const COMMENTS_ADAPTER_OPTIONAL_METHODS = [
  'getCapabilityState',
  'captureCurrentSelection',
  'isPendingCommentCreation',
  'seedReviewCatalog',
  'selectVisibleReviewComments',
] as const satisfies readonly OptionalMethodKeys<V2CommentsAdapter>[];

export const TRACKED_CHANGES_ADAPTER_METHODS = [
  'accept',
  'reject',
  'mapV2TrackedChangeToCommentParams',
] as const satisfies readonly RequiredMethodKeys<V2TrackedChangesAdapter>[];

export const TRACKED_CHANGES_ADAPTER_OPTIONAL_METHODS = [
  'clearActiveTrackedChangeTargetIfMatches',
] as const satisfies readonly OptionalMethodKeys<V2TrackedChangesAdapter>[];

const isAdapterDocumentId = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string' || typeof value === 'number';

const hasAdapterShape = (value: unknown, required: readonly string[], optional: readonly string[]): boolean =>
  isPlainObject(value) &&
  isAdapterDocumentId(value.documentId) &&
  required.every((member) => typeof value[member] === 'function') &&
  optional.every((member) => value[member] === undefined || typeof value[member] === 'function');

export function isV2CommentsAdapter(value: unknown): value is V2CommentsAdapter {
  return hasAdapterShape(value, COMMENTS_ADAPTER_METHODS, COMMENTS_ADAPTER_OPTIONAL_METHODS);
}

export function isV2TrackedChangesAdapter(value: unknown): value is V2TrackedChangesAdapter {
  return hasAdapterShape(value, TRACKED_CHANGES_ADAPTER_METHODS, TRACKED_CHANGES_ADAPTER_OPTIONAL_METHODS);
}
