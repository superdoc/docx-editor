/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DOCX } from '@superdoc/common';
import * as Y from 'yjs';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');

const instances: InstanceType<typeof SuperDoc>[] = [];

function createExternalResources() {
  const ydoc = new Y.Doc();
  const ydocDestroy = vi.spyOn(ydoc, 'destroy');
  const provider = { disconnect: vi.fn(), destroy: vi.fn() };
  return { ydoc, provider, ydocDestroy };
}

function createInstance(config: Record<string, unknown>) {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false }, ...config } as never);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ignored document collaboration object ownership', () => {
  it.each(['document', 'documents'])('does not destroy externally supplied %s objects', (source) => {
    const { ydoc, provider, ydocDestroy } = createExternalResources();
    const entry = {
      id: 'external',
      type: DOCX,
      data: new File(['docx'], 'example.docx', { type: DOCX }),
      ydoc,
      provider,
    };
    const instance = createInstance(source === 'document' ? { document: entry } : { documents: [entry] });

    expect(instance.config.documents[0]).toMatchObject({ ydoc, provider });
    instance.destroy();

    expect(provider.disconnect).not.toHaveBeenCalled();
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(ydocDestroy).not.toHaveBeenCalled();
  });

  it('does not destroy ignored objects when removing a document', async () => {
    const { ydoc, provider, ydocDestroy } = createExternalResources();
    const instance = createInstance({});
    const removedDocument = { id: 'external', type: DOCX, ydoc, provider };
    const remainingDocument = { id: 'remaining', type: DOCX };
    const store = {
      documents: [removedDocument, remainingDocument],
      removeDocument: vi.fn(() => {
        store.documents.splice(0, 1);
        return removedDocument;
      }),
    };
    (instance as unknown as { superdocStore: unknown }).superdocStore = store;

    await expect(instance.removeDocument('external')).resolves.toBe(true);
    expect(store.removeDocument).toHaveBeenCalledWith('external');
    expect(provider.disconnect).not.toHaveBeenCalled();
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(ydocDestroy).not.toHaveBeenCalled();
  });

  it('still destroys resources attached to the instance', () => {
    const { ydoc, provider, ydocDestroy } = createExternalResources();
    const instance = createInstance({});
    instance.ydoc = ydoc;
    instance.provider = provider as never;

    instance.destroy();

    expect(provider.disconnect).toHaveBeenCalledOnce();
    expect(provider.destroy).toHaveBeenCalledOnce();
    expect(ydocDestroy).toHaveBeenCalledOnce();
  });
});
