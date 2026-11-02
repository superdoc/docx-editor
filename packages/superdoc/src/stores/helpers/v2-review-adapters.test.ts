import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import {
  COMMENTS_ADAPTER_METHODS,
  COMMENTS_ADAPTER_OPTIONAL_METHODS,
  TRACKED_CHANGES_ADAPTER_METHODS,
  TRACKED_CHANGES_ADAPTER_OPTIONAL_METHODS,
  isV2CommentsAdapter,
  isV2TrackedChangesAdapter,
  type OptionalMethodKeys,
  type RequiredMethodKeys,
  type V2CommentsAdapter,
  type V2TrackedChangesAdapter,
} from './v2-review-adapters.js';

const method = () => undefined;

const completeCommentsAdapter = () => ({
  documentId: 'doc-1',
  setActiveComment: method,
  commitPendingComment: method,
  reply: method,
  edit: method,
  resolve: method,
  reopen: method,
  delete: method,
  mapV2CommentToUseCommentInput: method,
});

const completeTrackedChangesAdapter = () => ({
  documentId: 'doc-1',
  accept: method,
  reject: method,
  mapV2TrackedChangeToCommentParams: method,
});

const without = (adapter: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(adapter).filter(([key]) => key !== member));

const notAdapters: unknown[] = [null, undefined, 0, 'adapter', true, Symbol('adapter'), method, []];

describe('isV2CommentsAdapter', () => {
  it('accepts a complete adapter', () => {
    expect(isV2CommentsAdapter(completeCommentsAdapter())).toBe(true);
  });

  it('accepts a complete adapter with optional methods and a numeric, null or missing documentId', () => {
    const optional = {
      getCapabilityState: method,
      captureCurrentSelection: method,
      isPendingCommentCreation: method,
      seedReviewCatalog: method,
      selectVisibleReviewComments: method,
    };
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), ...optional })).toBe(true);
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), documentId: 42 })).toBe(true);
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), documentId: null })).toBe(true);
    expect(isV2CommentsAdapter(without(completeCommentsAdapter(), 'documentId'))).toBe(true);
  });

  it.each([
    'setActiveComment',
    'commitPendingComment',
    'reply',
    'edit',
    'resolve',
    'reopen',
    'delete',
    'mapV2CommentToUseCommentInput',
  ])('rejects an adapter without %s', (member) => {
    expect(isV2CommentsAdapter(without(completeCommentsAdapter(), member))).toBe(false);
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), [member]: 'not a function' })).toBe(false);
  });

  it.each([
    'getCapabilityState',
    'captureCurrentSelection',
    'isPendingCommentCreation',
    'seedReviewCatalog',
    'selectVisibleReviewComments',
  ])('rejects an adapter whose optional %s is not a function', (member) => {
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), [member]: true })).toBe(false);
  });

  it('rejects a documentId that is not a string or number', () => {
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), documentId: {} })).toBe(false);
    expect(isV2CommentsAdapter({ ...completeCommentsAdapter(), documentId: true })).toBe(false);
  });

  it.each(notAdapters)('rejects %s', (value) => {
    expect(isV2CommentsAdapter(value)).toBe(false);
  });
});

describe('isV2TrackedChangesAdapter', () => {
  it('accepts a complete adapter', () => {
    expect(isV2TrackedChangesAdapter(completeTrackedChangesAdapter())).toBe(true);
  });

  it('accepts a complete adapter with its optional method and a numeric, null or missing documentId', () => {
    expect(
      isV2TrackedChangesAdapter({
        ...completeTrackedChangesAdapter(),
        clearActiveTrackedChangeTargetIfMatches: method,
      }),
    ).toBe(true);
    expect(isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), documentId: 42 })).toBe(true);
    expect(isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), documentId: null })).toBe(true);
    expect(isV2TrackedChangesAdapter(without(completeTrackedChangesAdapter(), 'documentId'))).toBe(true);
  });

  it.each(['accept', 'reject', 'mapV2TrackedChangeToCommentParams'])('rejects an adapter without %s', (member) => {
    expect(isV2TrackedChangesAdapter(without(completeTrackedChangesAdapter(), member))).toBe(false);
    expect(isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), [member]: {} })).toBe(false);
  });

  it('rejects an adapter whose optional clearActiveTrackedChangeTargetIfMatches is not a function', () => {
    expect(
      isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), clearActiveTrackedChangeTargetIfMatches: 1 }),
    ).toBe(false);
  });

  it('rejects a documentId that is not a string or number', () => {
    expect(isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), documentId: {} })).toBe(false);
    expect(isV2TrackedChangesAdapter({ ...completeTrackedChangesAdapter(), documentId: [] })).toBe(false);
  });

  it.each(notAdapters)('rejects %s', (value) => {
    expect(isV2TrackedChangesAdapter(value)).toBe(false);
  });
});

describe('adapter member lists', () => {
  it('name every method of their interface, so the guards and the interfaces cannot drift apart', () => {
    expectTypeOf<(typeof COMMENTS_ADAPTER_METHODS)[number]>().toEqualTypeOf<RequiredMethodKeys<V2CommentsAdapter>>();
    expectTypeOf<(typeof COMMENTS_ADAPTER_OPTIONAL_METHODS)[number]>().toEqualTypeOf<
      OptionalMethodKeys<V2CommentsAdapter>
    >();
    expectTypeOf<(typeof TRACKED_CHANGES_ADAPTER_METHODS)[number]>().toEqualTypeOf<
      RequiredMethodKeys<V2TrackedChangesAdapter>
    >();
    expectTypeOf<(typeof TRACKED_CHANGES_ADAPTER_OPTIONAL_METHODS)[number]>().toEqualTypeOf<
      OptionalMethodKeys<V2TrackedChangesAdapter>
    >();
  });
});
