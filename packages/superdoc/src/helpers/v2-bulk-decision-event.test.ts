import { describe, expect, it } from 'vite-plus/test';

import { toV2BulkDecisionEvent } from './v2-bulk-decision-event.js';

describe('toV2BulkDecisionEvent', () => {
  it('maps a partial accept decision to public outcome counts', () => {
    expect(
      toV2BulkDecisionEvent('document-123', {
        schemaVersion: 1,
        decision: 'accept',
        requestedCount: 3,
        appliedCount: 2,
        deniedCount: 1,
      }),
    ).toEqual({
      documentId: 'document-123',
      decision: 'accept',
      requestedCount: 3,
      successfulCount: 2,
      permissionDeniedCount: 1,
    });
  });

  it('maps a partial reject decision to public outcome counts', () => {
    expect(
      toV2BulkDecisionEvent('document-123', {
        schemaVersion: 1,
        decision: 'reject',
        requestedCount: 4,
        appliedCount: 3,
        deniedCount: 1,
      }),
    ).toEqual({
      documentId: 'document-123',
      decision: 'reject',
      requestedCount: 4,
      successfulCount: 3,
      permissionDeniedCount: 1,
    });
  });

  it('returns null when the host fact is absent', () => {
    expect(toV2BulkDecisionEvent('document-123', undefined)).toBeNull();
  });
});
