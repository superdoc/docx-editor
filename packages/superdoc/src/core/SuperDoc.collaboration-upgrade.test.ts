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
    const editor = { editorVersion: 2, options: { documentId: 'upgrade-doc' }, upgradeToCollaboration };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };
    instance.activeEditor = editor as never;

    const outcome = await instance.upgradeToCollaboration({
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
    expect(outcome).toEqual({ roomId: 'slow-room', documentId: 'upgrade-doc' });
    expect(configDoc).toMatchObject({
      v2Collaboration: expect.objectContaining({ roomMode: 'join', syncTimeoutMs: 45_000 }),
    });
  });

  it('refuses a pending upgrade with different provider credentials, including nested params', async () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
    instances.push(instance);
    const source = new Blob([new Uint8Array([1, 2, 3])]);
    let finishUpgrade!: () => void;
    const upgradeToCollaboration = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishUpgrade = resolve;
        }),
    );
    const editor = { editorVersion: 2, options: { documentId: 'upgrade-doc' }, upgradeToCollaboration };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };
    instance.activeEditor = editor as never;

    const options = (token: string, roomMode?: 'join' | 'create') => ({
      collaboration: {
        providerType: 'hocuspocus',
        documentId: 'room',
        serverUrl: 'wss://example.test',
        params: { token },
        ...(roomMode ? { roomMode } : {}),
      },
    });
    const first = instance.upgradeToCollaboration(options('first') as never);
    const same = instance.upgradeToCollaboration(options('first') as never);
    await expect(instance.upgradeToCollaboration(options('second', 'create') as never)).rejects.toMatchObject({
      code: 'collaboration-upgrade-target-conflict',
    });
    await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));
    finishUpgrade();
    expect(await first).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
    expect(await same).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
  });

  it('coalesces omitted, explicit join, and explicit create modes for the same effective create operation', async () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
    instances.push(instance);
    const source = new Blob([new Uint8Array([1, 2, 3])]);
    let finishUpgrade!: () => void;
    const upgradeToCollaboration = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishUpgrade = resolve;
        }),
    );
    const editor = { editorVersion: 2, options: { documentId: 'upgrade-doc' }, upgradeToCollaboration };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };
    instance.activeEditor = editor as never;

    const options = (roomMode?: 'join' | 'create') => ({
      collaboration: {
        providerType: 'hocuspocus',
        documentId: 'room',
        serverUrl: 'wss://example.test',
        ...(roomMode ? { roomMode } : {}),
      },
    });
    const first = instance.upgradeToCollaboration(options() as never);
    const explicitCreate = instance.upgradeToCollaboration(options('create') as never);
    const explicitJoin = instance.upgradeToCollaboration(options('join') as never);
    const outcomes = Promise.allSettled([first, explicitCreate, explicitJoin]);
    await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));
    finishUpgrade();
    const expected = { roomId: 'room', documentId: 'upgrade-doc' };
    expect(await outcomes).toEqual(Array(3).fill({ status: 'fulfilled', value: expected }));
    expect(upgradeToCollaboration).toHaveBeenCalledWith(source, expect.objectContaining({ roomMode: 'create' }));
  });

  it('does not coalesce extension targets with different structured-clone options', async () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
    instances.push(instance);
    const source = new Blob([new Uint8Array([1, 2, 3])]);
    let finishUpgrade!: () => void;
    const upgradeToCollaboration = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishUpgrade = resolve;
        }),
    );
    const editor = { editorVersion: 2, options: { documentId: 'upgrade-doc' }, upgradeToCollaboration };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };
    instance.activeEditor = editor as never;

    const options = (tenant: string) => ({
      collaboration: {
        providerType: 'extension',
        adapterId: 'test-adapter',
        documentId: 'room',
        providerOptions: new Map([['tenant', tenant]]),
      },
    });
    const first = instance.upgradeToCollaboration(options('first') as never);
    const same = instance.upgradeToCollaboration(options('first') as never);
    await expect(instance.upgradeToCollaboration(options('second') as never)).rejects.toMatchObject({
      code: 'collaboration-upgrade-target-conflict',
    });
    await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));
    finishUpgrade();
    expect(await first).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
    expect(await same).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
  });
});
