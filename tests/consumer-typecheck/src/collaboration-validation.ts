import type { Doc } from 'yjs';
import {
  classifyUpdate,
  isComment,
  isEdit,
  isSuggestion,
  type CollaborationUpdateDecision,
  type CollaborationUpdateInput,
} from 'superdoc/collaboration-validation';

declare const accepted: Doc;
declare const update: Uint8Array;

const input = { accepted, update, roomName: 'sd2/v2.1/example', encoding: 'yjs-v1' } satisfies CollaborationUpdateInput;
const result: CollaborationUpdateDecision = classifyUpdate(input);

input satisfies Parameters<typeof classifyUpdate>[0];
isComment(input) satisfies boolean;
isSuggestion(input) satisfies boolean;
isEdit(input) satisfies boolean;

if (result.kind === 'comment') result.reason satisfies 'anchored-comment-created';
if (result.kind === 'suggestion') result.reason satisfies 'tracked-text-inserted';
if (result.kind === 'edit') result.reason satisfies 'mixed-operations' | 'direct-text-inserted';
if (result.kind === 'attribution') result.reason satisfies 'story-attribution-refreshed';
if (result.kind === 'noop') result.reason satisfies 'no-new-effects';
