import { vi, type Mock } from 'vite-plus/test';
import type {
  V2CommentsAdapter,
  V2ReviewAdapterDocumentId,
  V2TrackedChangesAdapter,
} from '../stores/helpers/v2-review-adapters.js';

type RequiredMethodMocks<Adapter> = {
  [Member in keyof Adapter as Member extends 'documentId'
    ? never
    : undefined extends Adapter[Member]
      ? never
      : Member]-?: Adapter[Member] extends (...args: never[]) => unknown ? Mock<Adapter[Member]> : never;
};

export type V2CommentsAdapterFake = { documentId: V2ReviewAdapterDocumentId } & RequiredMethodMocks<V2CommentsAdapter>;

export type V2TrackedChangesAdapterFake = {
  documentId: V2ReviewAdapterDocumentId;
} & RequiredMethodMocks<V2TrackedChangesAdapter>;

export function makeV2CommentsAdapter<Overrides extends object = Record<never, never>>(
  overrides?: Overrides & Partial<V2CommentsAdapter>,
): V2CommentsAdapterFake & Overrides {
  const defaults: V2CommentsAdapterFake = {
    documentId: 'doc-1',
    setActiveComment: vi.fn<V2CommentsAdapter['setActiveComment']>(async () => ({ ok: true })),
    commitPendingComment: vi.fn<V2CommentsAdapter['commitPendingComment']>(async () => ({ ok: true })),
    reply: vi.fn<V2CommentsAdapter['reply']>(async () => ({ ok: true })),
    edit: vi.fn<V2CommentsAdapter['edit']>(async () => ({ ok: true })),
    resolve: vi.fn<V2CommentsAdapter['resolve']>(async () => ({ ok: true })),
    reopen: vi.fn<V2CommentsAdapter['reopen']>(async () => ({ ok: true })),
    delete: vi.fn<V2CommentsAdapter['delete']>(async () => ({ ok: true })),
    mapV2CommentToUseCommentInput: vi.fn<V2CommentsAdapter['mapV2CommentToUseCommentInput']>(() => null),
  };
  return Object.assign(defaults, overrides);
}

export function makeV2TrackedChangesAdapter<Overrides extends object = Record<never, never>>(
  overrides?: Overrides & Partial<V2TrackedChangesAdapter>,
): V2TrackedChangesAdapterFake & Overrides {
  const defaults: V2TrackedChangesAdapterFake = {
    documentId: 'doc-1',
    accept: vi.fn<V2TrackedChangesAdapter['accept']>(async () => ({ ok: true })),
    reject: vi.fn<V2TrackedChangesAdapter['reject']>(async () => ({ ok: true })),
    mapV2TrackedChangeToCommentParams: vi.fn<V2TrackedChangesAdapter['mapV2TrackedChangeToCommentParams']>(() => null),
  };
  return Object.assign(defaults, overrides);
}
