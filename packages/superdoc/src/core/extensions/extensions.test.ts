import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { defineSuperDocExtension } from './define.js';
import type {
  SuperDocExtension,
  SuperDocExtensionContext,
  SuperDocMutationEvent,
  SuperDocReceiptSuccess,
} from './types.js';

describe('defineSuperDocExtension', () => {
  it('returns the extension object unchanged and preserves storage typing', () => {
    const activate = (_ctx: SuperDocExtensionContext<{ searchText: string }>) => {};
    const ext = defineSuperDocExtension({
      id: 'acme.highlights',
      storage: () => ({ searchText: 'ACME' }),
      activate,
    });
    expect(ext.id).toBe('acme.highlights');
    expect(ext.activate).toBe(activate);
    expect(ext.storage?.()).toEqual({ searchText: 'ACME' });
  });

  it('rejects a missing/empty id', () => {
    expect(() => defineSuperDocExtension({ id: '', activate() {} })).toThrow(/non-empty string `id`/);
  });

  it('rejects a missing activate function', () => {
    // @ts-expect-error activate is required
    expect(() => defineSuperDocExtension({ id: 'acme.x' })).toThrow(/`activate\(ctx\)` function/);
  });

  it('rejects a non-function storage field', () => {
    expect(() =>
      // @ts-expect-error storage must be a factory function
      defineSuperDocExtension({ id: 'acme.x', activate() {}, storage: { searchText: 'ACME' } }),
    ).toThrow(/`storage` must be a function/);
  });

  it('is assignable to the SuperDocExtension contract used by Config.extensions', () => {
    const ext = defineSuperDocExtension({
      id: 'acme.x',
      activate(ctx) {
        // Surface coverage: the context exposes the documented capabilities.
        void ctx.anchors;
        void ctx.commands;
        void ctx.decorations;
        void ctx.doc;
        void ctx.onMutation;
      },
    });
    expectTypeOf(ext).toExtend<SuperDocExtension>();
  });

  it('types common guarded Document API writes from extension commands', () => {
    const ext: SuperDocExtension = defineSuperDocExtension({
      id: 'acme.commands',
      activate(ctx) {
        ctx.commands.register({
          id: 'acme.replaceText',
          async execute({ doc }) {
            await doc.text.replace({ target: { kind: 'text', segments: [] }, text: 'ACME' });
            await doc.comments.create({ target: { kind: 'text', segments: [] }, text: 'Check this' });
            await doc.trackChanges.decide({ id: 'change-1', decision: 'accept' });
            await doc.history.undo();
          },
        });
      },
    });
    expect(ext.id).toBe('acme.commands');
  });

  it('exposes the advanced mutation receipt field on the public event type', () => {
    expectTypeOf<SuperDocMutationEvent>().toHaveProperty('receipt').toEqualTypeOf<SuperDocReceiptSuccess | undefined>();
  });
});
