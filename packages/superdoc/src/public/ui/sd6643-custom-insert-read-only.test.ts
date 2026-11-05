import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

function mountWithConnection(state: string) {
  const insert = vi.fn(() => ({ success: true }));
  const doc = {
    insert,
    selection: { current: () => ({ target: { kind: 'text', blockId: 'p1', range: { start: 0, end: 0 } } }) },
  };
  const ui = createSuperDocUI({
    superdoc: {
      config: { documentMode: 'editing' },
      activeEditor: { editorVersion: 2, options: { documentMode: 'editing' }, doc },
      getCollaborationConnectionState: () => ({ state, detail: null }),
    } as never,
  });
  return { ui, insert };
}

async function runInsertText(state: string) {
  const { ui, insert } = mountWithConnection(state);
  let receipt: unknown;
  const registration = ui.commands.register({
    id: `sd6643-insert-${state}`,
    getState: () => ({ enabled: true, disabled: false, active: false, supported: true }),
    execute: (context) => {
      receipt = context.insertText('typed after failure');
      return true as never;
    },
  });
  await registration.handle.executeAsync();
  return { receipt: await receipt, insert };
}

describe('custom command insertText after a failed collaboration connection', () => {
  it('refuses with DOCUMENT_READONLY and never calls insert', async () => {
    const { receipt, insert } = await runInsertText('failed');

    expect(receipt).toMatchObject({ success: false, failure: { code: 'DOCUMENT_READONLY' } });
    expect(insert).not.toHaveBeenCalled();
  });

  it('still inserts while the connection is synced', async () => {
    const { receipt, insert } = await runInsertText('synced');

    expect(insert).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({ success: true });
  });
});
