import type { DocumentApiSurface } from '../index.js';
import type { ReceiptFailureResult, ReceiptSuccess } from './receipt.js';
import type { PlainTextInsertInput } from '../insert/insert.js';
import type { ParagraphTextReplaceInput, ReplaceMutationOptions, TextReplaceInput } from '../replace/replace.js';
import type { MutationOptions, TrackedTextMutationOptions } from '../write/write.js';
import type { BodyStoryLocator } from './story.types.js';

type TemporaryCall<Name extends string, Method extends (...args: never[]) => unknown> = {
  operation: Name;
  input: Parameters<Method>[0];
  options?: Parameters<Method>[1];
};

type TemporaryText<Name extends 'insert' | 'replace', Input> =
  | { operation: Name; input: Input; options?: MutationOptions & { author?: never } }
  | { operation: Name; input: Exclude<Input, { target: BodyStoryLocator }>; options: TrackedTextMutationOptions };

export interface TemporaryOperationResultTarget {
  kind: 'operationResult';
  operationId: string;
}

type CommentsCreate = DocumentApiSurface['comments']['create'];
type TemporaryCommentInput = Omit<Parameters<CommentsCreate>[0], 'target'> & {
  target?: Parameters<CommentsCreate>[0]['target'] | TemporaryOperationResultTarget;
};

/** Operations run in order against the temporary document, as one atomic update. */
export type TemporaryMutationOperation = { id?: string } & (
  | TemporaryText<'insert', PlainTextInsertInput>
  | TemporaryText<'replace', TextReplaceInput>
  | { operation: 'replace'; input: ParagraphTextReplaceInput; options?: ReplaceMutationOptions }
  | TemporaryCall<'delete', DocumentApiSurface['delete']>
  | TemporaryCall<'blocks.delete', DocumentApiSurface['blocks']['delete']>
  | TemporaryCall<'trackChanges.decide', DocumentApiSurface['trackChanges']['decide']>
  | { operation: 'comments.create'; input: TemporaryCommentInput; options?: Parameters<CommentsCreate>[1] }
);

export interface TemporaryMutationInput {
  /** Host tag echoed on every temporary mutation and its rollback/commit receipt. */
  tag: string;
  onNativeEdit?: 'cancel' | 'preserve';
  expectedRevision?: string;
  operations: TemporaryMutationOperation[];
}
export interface TemporaryMutationHandleInput {
  previewId: string;
  expectedRevision?: string;
}
export interface TemporaryMutationCommitInput extends TemporaryMutationHandleInput {
  /** Run against the displayed document atomically before publishing its single Undo entry. */
  operations?: TemporaryMutationOperation[];
}
export type TemporaryMutationReplaceInput = TemporaryMutationInput & TemporaryMutationHandleInput;
/**
 * Exclusive and cancel-on-edit receipts use the original session baseline for semantic ref and
 * text-shift coordinates. On `replace`, restore the baseline anchor snapshot
 * before applying the new receipt; do not compose its shifts onto the prior
 * displayed choice. On `rollback`, restore the baseline snapshot. The revision
 * pair still describes the actual previously displayed and next document.
 * Preserve-on-edit receipts describe the current transition, including manual edits.
 */
export interface TemporaryMutationMetadata {
  id: string;
  phase: 'begin' | 'replace' | 'rollback' | 'commit';
  /** Present when native editor interaction canceled the preview. */
  cancelledBy?: 'native-edit';
  tag: string;
  onNativeEdit?: 'cancel' | 'preserve';
}
export type TemporaryMutationReceipt =
  | (ReceiptSuccess & {
      temporary: TemporaryMutationMetadata;
      revision: { before: string; after: string };
    })
  | ReceiptFailureResult;
