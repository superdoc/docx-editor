import type { Doc as YDoc } from 'yjs';
import {
  classifyUpdate as validateUpdate,
  isComment as validateComment,
  isSuggestion as validateSuggestion,
  isEdit as validateEdit,
} from '@superdoc/docx-engine/document-runtime';

export interface CollaborationUpdateInput {
  readonly accepted: YDoc;
  readonly update: Uint8Array;
  readonly roomName: string;
  readonly encoding?: 'yjs-v1';
}

export type CollaborationUpdateDecision =
  | { kind: 'comment'; reason: 'anchored-comment-created' }
  | { kind: 'suggestion'; reason: 'tracked-text-inserted' }
  | { kind: 'edit'; reason: 'direct-text-inserted' | 'mixed-operations' }
  | { kind: 'attribution'; reason: 'story-attribution-refreshed' }
  | { kind: 'noop'; reason: 'no-new-effects' }
  | { kind: 'invalid'; reason: 'malformed-update' | 'malformed-structure' }
  | {
      kind: 'unverifiable';
      reason:
        | 'baseline-has-pending'
        | 'pending-structs'
        | 'pending-deletions'
        | 'overlapping-structs'
        | 'unsupported-baseline'
        | 'room-mismatch';
    }
  | {
      kind: 'unsupported';
      reason: 'unknown-schema' | 'unsupported-encoding' | 'unknown-root' | 'room-initialization' | 'unexpected-effect';
    };

export const classifyUpdate: (input: CollaborationUpdateInput) => CollaborationUpdateDecision = validateUpdate;
export const isComment: (input: CollaborationUpdateInput) => boolean = validateComment;
export const isSuggestion: (input: CollaborationUpdateInput) => boolean = validateSuggestion;
export const isEdit: (input: CollaborationUpdateInput) => boolean = validateEdit;
