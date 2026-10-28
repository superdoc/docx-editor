import { describe, it, expect } from 'vite-plus/test';
import {
  createDefaultV2Integration,
  loadDefaultV2Integration,
  createStubV2Integration,
  hasRealV2Integration,
  isSyntheticTrackedChangeCommentLaneItem,
  isV2SyntheticTrackedChangeRow,
} from './v2-integration.js';

// V2 branch: the integration is the single DOCX Engine runtime. There is no
// customer-provided integration and no v1 fallback selection.
describe('createDefaultV2Integration', () => {
  it('returns the v2 integration after the async engine gate resolves', async () => {
    await loadDefaultV2Integration();
    const integration = createDefaultV2Integration();
    expect(integration.version).toBe(3);
    expect(integration.EditorComponent).toBeTruthy();
    expect(hasRealV2Integration(integration)).toBe(true);
    expect(typeof integration.createGeometryPublisher).toBe('function');
    expect(typeof integration.createReviewWindowController).toBe('function');
  });
});

describe('synthetic tracked-change predicates', () => {
  it('detects synthetic tracked-change comment-lane items', () => {
    expect(isSyntheticTrackedChangeCommentLaneItem({ id: 'tc-comment:abc' })).toBe(true);
    expect(isSyntheticTrackedChangeCommentLaneItem({ commentId: 'tc-comment:abc' })).toBe(true);
    expect(isSyntheticTrackedChangeCommentLaneItem({ id: 'real-comment' })).toBe(false);
    expect(isSyntheticTrackedChangeCommentLaneItem(null)).toBe(false);
  });

  it('detects synthesized V2 body tracked-change rows', () => {
    expect(isV2SyntheticTrackedChangeRow({ trackedChange: true, trackedChangeAnchorKey: 'tc::body::1' })).toBe(true);
    expect(isV2SyntheticTrackedChangeRow({ trackedChange: true, trackedChangeAnchorKey: 'other::1' })).toBe(false);
    expect(isV2SyntheticTrackedChangeRow({ trackedChange: false })).toBe(false);
  });
});

describe('createStubV2Integration', () => {
  it('produces a fail-closed fallback editor component', () => {
    const stub = createStubV2Integration();
    expect(stub.EditorComponent).toBeTruthy();
    expect(stub.RulerComponent).toBeNull();
    expect(hasRealV2Integration(stub)).toBe(false);
  });
});
