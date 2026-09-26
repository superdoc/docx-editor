import { describe, expect, it, mock } from 'bun:test';
import { executeWatermarksApply, type WatermarksAdapter, type WatermarksApplyInput } from './watermarks.js';

function makeAdapter() {
  const apply = mock(() => ({
    success: false as const,
    failure: { code: 'TARGET_NOT_FOUND' as const, message: 'test' },
  }));
  const unused = (): never => {
    throw new Error('Unexpected operation');
  };
  const adapter: WatermarksAdapter = { apply, list: unused, insert: unused, replace: unused, remove: unused };
  return { adapter, apply };
}

const slot = {
  kind: 'headerFooterSlot' as const,
  section: { kind: 'section' as const, sectionId: 'section-1' },
  headerFooterKind: 'header' as const,
  variant: 'default' as const,
};

describe('watermarks.apply contract', () => {
  it('forwards a retained picture and explicit selection without requiring source bytes', () => {
    const { adapter, apply } = makeAdapter();
    const input: WatermarksApplyInput = {
      action: 'replace',
      target: { kind: 'headerFooterSlots', slots: [slot] },
      watermarkIds: ['selected'],
      watermark: { kind: 'picture', source: { kind: 'existing', watermarkId: 'selected' }, opacity: 0.3 },
    };
    executeWatermarksApply(adapter, input, { expectedRevision: '4', dryRun: true });
    expect(apply).toHaveBeenCalledWith(input, expect.objectContaining({ expectedRevision: '4', dryRun: true }));
  });

  it.each([
    { action: 'remove', target: { kind: 'document' }, watermarkIds: [] },
    { action: 'remove', target: { kind: 'document' }, watermarkIds: ['duplicate', 'duplicate'] },
    { action: 'remove', target: { kind: 'headerFooterSlots', slots: [slot, slot] }, watermarkIds: ['selected'] },
    {
      action: 'remove',
      target: { kind: 'headerFooterSlots', slots: [{ ...slot, headerFooterKind: 'footer' }] },
      watermarkIds: ['selected'],
    },
    {
      action: 'replace',
      target: { kind: 'document' },
      watermarkIds: ['selected'],
      watermark: { kind: 'picture', src: 'new', source: { kind: 'existing', watermarkId: 'selected' } },
    },
    {
      action: 'insert',
      target: { kind: 'document' },
      watermark: { kind: 'picture', source: { kind: 'existing', watermarkId: 'selected' } },
    },
    { action: 'insert', target: { kind: 'document' }, watermark: { kind: 'text', text: 'INVALID', opacity: 2 } },
  ])('rejects ambiguous or invalid scope/source before invoking the adapter: %j', (input) => {
    const { adapter, apply } = makeAdapter();
    expect(() => executeWatermarksApply(adapter, input as WatermarksApplyInput)).toThrow();
    expect(apply).not.toHaveBeenCalled();
  });
});
