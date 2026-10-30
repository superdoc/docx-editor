/**
 * The controller against a partial, duck-typed host.
 *
 * `SuperDocEditorLike` accepts a host that carries only the operations it
 * implements, which is what makes custom adapters and test stubs possible. That
 * permissiveness is only safe because every route the controller offers
 * resolves its document operation defensively and fails closed when it is
 * missing. These tests pin that, because the failure mode is silent: a route
 * that assumed an operation exists would throw out of a click handler instead
 * of reporting an unavailable command, and nothing else in the suite mounts a
 * host this sparse.
 *
 * The one surface that is NOT guarded is `ctx.doc`, the host's own object
 * passed straight through. That is why it is typed
 * `PartialBrowserDocumentApi`: it promises only what the host contract
 * guarantees, so a consumer reaching past the routed helpers has to guard.
 */
import { describe, expect, it } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';
import type { SuperDocUI } from './types.js';

/** A host that satisfies the contract while implementing no doc operation. */
function mountPartialHost(): SuperDocUI {
  return createSuperDocUI({ superdoc: { activeEditor: { editorVersion: 2, doc: {} } } as never });
}

describe('controller against a partial host', () => {
  it('reports built-in commands unsupported rather than throwing', () => {
    const ui = mountPartialHost();

    const state = ui.commands.get('bold').getState();

    expect(state).toMatchObject({ enabled: false, supported: false, reason: 'operation-unavailable' });
  });

  it('declines execution instead of calling a missing operation', async () => {
    const ui = mountPartialHost();

    expect(ui.commands.execute('bold')).toBe(false);
    await expect(ui.commands.executeAsync('bold')).resolves.toBe(false);
  });

  it('answers slice reads', () => {
    const ui = mountPartialHost();

    expect(() => ui.comments.getSnapshot()).not.toThrow();
    expect(ui.comments.getSnapshot().total).toBe(0);
  });

  it('attributes benchmark state computation by phase without changing the snapshot', () => {
    const timingGlobal = globalThis as typeof globalThis & {
      __superdocV2BenchPipelineTiming?: (event: Record<string, unknown>) => void;
    };
    const events: Record<string, unknown>[] = [];
    timingGlobal.__superdocV2BenchPipelineTiming = (event) => events.push(event);
    try {
      const ui = mountPartialHost();
      expect(ui.comments.getSnapshot().total).toBe(0);
      expect(events).toContainEqual(
        expect.objectContaining({
          stage: 'superdoc-ui-compute-state',
          reason: 'initial',
          phaseMs: expect.objectContaining({
            selection: expect.any(Number),
            toolbarCommands: expect.any(Number),
          }),
        }),
      );
    } finally {
      delete timingGlobal.__superdocV2BenchPipelineTiming;
    }
  });

  it('gives a custom command a failure receipt from insertText', async () => {
    const ui = mountPartialHost();
    let receipt: unknown;
    let docKeyCount = -1;

    const registration = ui.commands.register({
      id: 'partial-host-probe',
      getState: () => ({ enabled: true, disabled: false, active: false, supported: true }),
      execute: (context) => {
        // `doc` is the host's object verbatim, which is the reason its type
        // only promises what the host contract guarantees.
        docKeyCount = context.doc ? Object.keys(context.doc).length : -1;
        receipt = context.insertText('hello');
        return true as never;
      },
    });

    await registration.handle.executeAsync();

    expect(docKeyCount).toBe(0);
    expect(receipt).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });

  it('settles a runtime rejection as false, never as the raw rejected shape', async () => {
    const ui = mountPartialHost();
    const rejection = { status: 'rejected', reason: 'command-failed' };

    const registration = ui.commands.register({
      id: 'partial-host-rejection',
      getState: () => ({ enabled: true, disabled: false, active: false, supported: true }),
      execute: () => rejection as never,
    });

    expect(registration.handle.execute()).toBe(false);
    await expect(registration.handle.executeAsync()).resolves.toBe(false);
    await expect(ui.commands.executeAsync('partial-host-rejection')).resolves.toBe(false);
  });
});
