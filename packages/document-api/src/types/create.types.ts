import type { TextAddress } from './address.js';
import type { BlockNodeAddress } from './base.js';
import type { ResolvedHandle } from './discovery.js';
import type { ReceiptFailure, ReceiptInsert } from './receipt.js';
import type { StoryLocator } from './story.types.js';

export type ParagraphCreateLocation =
  | { kind: 'documentStart' }
  | { kind: 'documentEnd' }
  | { kind: 'before'; target: BlockNodeAddress }
  | { kind: 'after'; target: BlockNodeAddress };

export interface CreateParagraphInput {
  /** Target story for the new paragraph. Omit for body (backward compatible). */
  in?: StoryLocator;
  at?: ParagraphCreateLocation;
  text?: string;
  /**
   * Explicit paragraph style id (e.g. `'BodyText'`) to apply instead of the
   * document's default paragraph style. Neighboring styles and direct
   * formatting are not inherited. An unknown style id fails
   * with `INVALID_INPUT` and does not mutate the document.
   */
  styleId?: string;
}

export interface CreateParagraphSuccessResult {
  success: true;
  paragraph: BlockNodeAddress;
  insertionPoint: TextAddress;
  trackedChangeRefs?: ReceiptInsert[];
  /**
   * Mutation-ready handle for the created paragraph. `handle.ref` is an
   * opaque, self-contained ref (the same shape `ranges.resolve` produces) —
   * pass it directly to `format.apply`'s `ref` without needing to also pass
   * `in`/story context, even for a header/footer paragraph. It is pinned to
   * `evaluatedRevision` (`refStability: 'ephemeral'`), so it is valid for
   * the immediate next mutation call only; chaining a second one after that
   * needs a fresh ref from a discovery read (e.g. `blocks.list`,
   * `query.match`). `paragraph.nodeId` remains stable across revisions for
   * non-ref addressing (e.g. `{ target: { kind: 'block', nodeType, nodeId } }`).
   *
   * With `options.dryRun: true`, nothing was committed, so there is no real
   * block to reference: `handle.ref` is the literal placeholder `'(dry-run)'`
   * and `paragraph.nodeId`/`insertionPoint.blockId` are too. Do not pass a
   * dry-run `handle.ref` to `format.apply` or any other mutation — it does
   * not resolve and the call fails with `INVALID_TARGET`.
   *
   * With no `text` (an empty paragraph), `handle.ref` spans a zero-length
   * range. This is not specific to create — `format.apply`'s "inline" action
   * cannot format zero-length text in general (there are no characters to
   * carry run properties), so chaining `handle.ref` into it fails with
   * `INVALID_TARGET` for an empty create the same way it would for any other
   * zero-length selection. Use paragraph-level actions with `paragraph` (its
   * `nodeId`) instead, e.g. `styles.paragraph.setStyle` or
   * `format.paragraph.setIndentation`, which target the whole block and do
   * not need a non-empty text range.
   */
  handle: ResolvedHandle;
  /**
   * Document revision immediately after this create committed. Pass as
   * `expectedRevision` on the immediate next mutation call to chain without
   * a `REVISION_MISMATCH` (SD-4886).
   */
  evaluatedRevision: string;
  /**
   * @deprecated Use `handle.ref` instead. Kept as an alias of `handle.ref`
   * for backward compatibility with existing callers of this field.
   */
  ref?: string;
}

export interface CreateParagraphFailureResult {
  success: false;
  failure: ReceiptFailure;
}

export type CreateParagraphResult = CreateParagraphSuccessResult | CreateParagraphFailureResult;

export type HeadingCreateLocation = ParagraphCreateLocation;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface CreateHeadingInput {
  /** Target story for the new heading. Omit for body (backward compatible). */
  in?: StoryLocator;
  level: HeadingLevel;
  at?: HeadingCreateLocation;
  text?: string;
  /**
   * Explicit paragraph style id to apply instead of the `Heading{level}`
   * style normally derived from `level`. `level` still controls numbering
   * suppression regardless of this override. An unknown style id fails with
   * `INVALID_INPUT` and does not mutate the document.
   */
  styleId?: string;
}

export interface CreateHeadingSuccessResult {
  success: true;
  heading: BlockNodeAddress;
  insertionPoint: TextAddress;
  trackedChangeRefs?: ReceiptInsert[];
  /**
   * Mutation-ready handle for the created heading. `handle.ref` is an
   * opaque, self-contained ref (the same shape `ranges.resolve` produces) —
   * pass it directly to `format.apply`'s `ref` without needing to also pass
   * `in`/story context, even for a header/footer heading. It is pinned to
   * `evaluatedRevision` (`refStability: 'ephemeral'`), so it is valid for
   * the immediate next mutation call only; chaining a second one after that
   * needs a fresh ref from a discovery read (e.g. `blocks.list`,
   * `query.match`). `heading.nodeId` remains stable across revisions for
   * non-ref addressing (e.g. `{ target: { kind: 'block', nodeType, nodeId } }`).
   *
   * With `options.dryRun: true`, nothing was committed, so there is no real
   * block to reference: `handle.ref` is the literal placeholder `'(dry-run)'`
   * and `heading.nodeId`/`insertionPoint.blockId` are too. Do not pass a
   * dry-run `handle.ref` to `format.apply` or any other mutation — it does
   * not resolve and the call fails with `INVALID_TARGET`.
   *
   * With no `text` (an empty heading), `handle.ref` spans a zero-length
   * range. This is not specific to create — `format.apply`'s "inline" action
   * cannot format zero-length text in general (there are no characters to
   * carry run properties), so chaining `handle.ref` into it fails with
   * `INVALID_TARGET` for an empty create the same way it would for any other
   * zero-length selection. Use paragraph-level actions with `heading` (its
   * `nodeId`) instead, e.g. `styles.paragraph.setStyle` or
   * `format.paragraph.setIndentation`, which target the whole block and do
   * not need a non-empty text range.
   */
  handle: ResolvedHandle;
  /**
   * Document revision immediately after this create committed. Pass as
   * `expectedRevision` on the immediate next mutation call to chain without
   * a `REVISION_MISMATCH` (SD-4886).
   */
  evaluatedRevision: string;
  /**
   * @deprecated Use `handle.ref` instead. Kept as an alias of `handle.ref`
   * for backward compatibility with existing callers of this field.
   */
  ref?: string;
}

export interface CreateHeadingFailureResult {
  success: false;
  failure: ReceiptFailure;
}

export type CreateHeadingResult = CreateHeadingSuccessResult | CreateHeadingFailureResult;
