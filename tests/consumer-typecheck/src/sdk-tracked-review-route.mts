import { runTrackedComparisonReview, type SuperDocDocument } from '../../../packages/sdk/langs/node/dist/index.js';

declare const client: { open: (input: { doc: string; runtime: string }) => Promise<SuperDocDocument> };
declare const baseBytes: Uint8Array;
declare const targetBytes: Uint8Array;

const result = await runTrackedComparisonReview({
  client,
  baseBytes,
  targetBytes,
  documentId: 'doc-1',
  actor: 'trusted-actor',
  currentReviewDocument: async (_documentId: string) => ({ version: 'v0:hash', bytes: baseBytes }),
  reviewSession: {
    boundVersion: 'v0:hash',
    documentId: 'doc-1',
    actor: 'trusted-actor',
    applyTarget: async (_bytes: Uint8Array, _mode: 'tracked') => ({ kind: 'prepared' as const, id: 'proposal' }),
  },
});

result.kind satisfies 'versioned-review';
result.diff?.applyEligibility?.tracked.status satisfies 'candidate' | 'blocked' | undefined;
result.comparisonError?.message satisfies string | undefined;
result.result.id satisfies string;
