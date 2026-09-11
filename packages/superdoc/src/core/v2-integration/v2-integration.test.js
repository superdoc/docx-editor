import { describe, it, expect, vi } from 'vite-plus/test';
import {
  createDefaultV2Integration,
  loadDefaultV2Integration,
  resolveV2Integration,
  createStubV2Integration,
  hasRealV2Integration,
  isSyntheticTrackedChangeCommentLaneItem,
  isV2SyntheticTrackedChangeRow,
} from './v2-integration.js';

// The WebKit caret-rect workaround is wired in here and nowhere else, so the
// call is what the fix ships on. Mocked so the wiring itself is asserted rather
// than the workaround's own behaviour, which its module tests cover.
vi.mock('./webkit-collapsed-caret-rect.js', () => ({
  installWebKitCollapsedCaretRectFix: vi.fn(() => null),
}));

describe('WebKit caret-rect workaround wiring', () => {
  it('installs the workaround when the engine is loaded', async () => {
    const { installWebKitCollapsedCaretRectFix } = await import('./webkit-collapsed-caret-rect.js');
    installWebKitCollapsedCaretRectFix.mockClear();

    await loadDefaultV2Integration();

    expect(installWebKitCollapsedCaretRectFix).toHaveBeenCalledWith(window);
  });
});

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

  it('ignores any legacy customer config (no editorIntegration is consulted)', async () => {
    await loadDefaultV2Integration();
    const injected = { version: 99, EditorComponent: { name: 'CustomerInjected' } };
    const integration = resolveV2Integration({ editorIntegration: injected, editorVersion: 1 });
    // The DOCX Engine runtime is always used; customer-provided objects are never
    // wired in, and v1 can never be selected.
    expect(integration.version).toBe(3);
    expect(integration.EditorComponent).not.toBe(injected.EditorComponent);
    expect(hasRealV2Integration(integration)).toBe(true);
  });

  it('resolveV2Integration is a config-ignoring alias of createDefaultV2Integration', async () => {
    await loadDefaultV2Integration();
    const a = resolveV2Integration();
    const b = createDefaultV2Integration();
    expect(a.version).toBe(b.version);
    expect(hasRealV2Integration(a)).toBe(true);
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
