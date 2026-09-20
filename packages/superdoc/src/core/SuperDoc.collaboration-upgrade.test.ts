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

describe('SuperDoc.upgradeToCollaboration', () => {
  it('preserves syncTimeoutMs while creating and then retaining the room as a join target', async () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
    instances.push(instance);

    const source = new Blob([new Uint8Array([1, 2, 3])]);
    const upgradeToCollaboration = vi.fn().mockResolvedValue(undefined);
    const editor = { editorVersion: 2, upgradeToCollaboration };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };

    await instance.upgradeToCollaboration({
      collaboration: {
        providerType: 'y-websocket',
        documentId: 'slow-room',
        serverUrl: 'wss://example.test',
        syncTimeoutMs: 45_000,
      },
    } as never);

    expect(upgradeToCollaboration).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ roomMode: 'create', syncTimeoutMs: 45_000 }),
    );
    expect(configDoc).toMatchObject({
      v2Collaboration: expect.objectContaining({ roomMode: 'join', syncTimeoutMs: 45_000 }),
    });
  });
});
