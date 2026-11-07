/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DOCX } from '@superdoc/common';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');

const instances: InstanceType<typeof SuperDoc>[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const createRoom = { providerType: 'y-websocket', documentId: 'room', roomMode: 'create' };

const mountReplace = () => {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
  instances.push(instance);
  let settleHost: (result: unknown) => void = () => {};
  const replaceFile = vi.fn(
    () =>
      new Promise((resolve) => {
        settleHost = resolve;
      }),
  );
  const editor = { editorVersion: 2, options: { documentId: 'replace-doc' }, replaceFile };
  const originalDocx = new Blob([new Uint8Array([1, 2, 3])]);
  const configDoc = { id: 'replace-doc', type: DOCX, data: originalDocx, v2Collaboration: createRoom };
  const storeDoc = { ...configDoc, getEditor: () => editor };
  const store = {
    documents: [storeDoc],
    reset() {
      store.documents = [];
    },
  };
  Reflect.set(instance.config, 'documents', [configDoc]);
  Reflect.set(instance, 'superdocStore', store);
  Reflect.set(instance, 'app', { unmount: vi.fn(), config: { globalProperties: {} } });
  Object.defineProperty(instance, 'activeEditor', { value: editor, configurable: true, writable: true });
  const snapshotState = () => ({ configDoc: { ...configDoc }, storeDoc: { ...storeDoc } });
  return { instance, replaceFile, settleHost: (result: unknown) => settleHost(result), snapshotState };
};

describe('SuperDoc.replaceDocument', () => {
  describe('when the instance is destroyed while the host replaces the file', () => {
    it.each([
      ['replaceDocument', { ok: true }],
      ['replaceFile', { state: 'editing-ready' }],
    ] as const)(
      '%s leaves the destroyed instance unchanged when the host confirms afterwards',
      async (method, result) => {
        const { instance, replaceFile, settleHost, snapshotState } = mountReplace();
        const emit = vi.spyOn(instance, 'emit');
        const replacement = new Blob([new Uint8Array([7, 8, 9])]);

        const pending = instance[method](replacement);
        await vi.waitFor(() => expect(replaceFile).toHaveBeenCalledTimes(1));
        instance.destroy();
        const expectedState = snapshotState();
        settleHost({ state: 'editing-ready' });

        expect(await pending).toEqual(result);
        expect(snapshotState()).toEqual(expectedState);
        expect(snapshotState().configDoc.data).not.toBe(replacement);
        expect(snapshotState().configDoc.v2Collaboration).toEqual(createRoom);
        expect(emit).not.toHaveBeenCalledWith('document-replaced', expect.anything());
      },
    );
  });
});
