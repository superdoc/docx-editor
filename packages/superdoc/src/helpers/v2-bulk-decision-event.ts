import type { SuperDocTrackedChangesBulkDecisionPayload } from '../core/types/index.js';

export type V2TrackedChangeBulkDecisionFact = {
  schemaVersion: number;
  decision: string;
  requestedCount: number;
  appliedCount: number;
  deniedCount: number;
};

export function toV2BulkDecisionEvent(
  documentId: string | null | undefined,
  fact: V2TrackedChangeBulkDecisionFact | null | undefined,
): SuperDocTrackedChangesBulkDecisionPayload | null {
  if (fact?.schemaVersion !== 1 || (fact.decision !== 'accept' && fact.decision !== 'reject')) {
    return null;
  }

  return {
    documentId: typeof documentId === 'string' ? documentId : null,
    decision: fact.decision,
    requestedCount: fact.requestedCount,
    successfulCount: fact.appliedCount,
    permissionDeniedCount: fact.deniedCount,
  };
}
