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
  it('keeps a reused caller modules object unchanged across upgrades and remounts', async () => {
    const modules = Object.freeze({ comments: Object.freeze({ visible: false }) });
    for (const suffix of ['first', 'remount']) {
      const selector = document.createElement('div');
      document.body.append(selector);
      const instance = new SuperDoc({ selector, modules, telemetry: { enabled: false } } as never);
      instances.push(instance);
      const source = new Blob([new Uint8Array([1, 2, 3])]);
      const editor = {
        editorVersion: 2,
        options: { documentId: `doc-${suffix}` },
        upgradeToCollaboration: vi.fn().mockResolvedValue(undefined),
      };
      const configDoc = { id: `doc-${suffix}`, type: DOCX, data: source };
      const mutable = instance as unknown as {
        config: { documents: unknown[] };
        superdocStore: { documents: unknown[] };
      };
      mutable.config.documents = [configDoc];
      mutable.superdocStore = { documents: [{ ...configDoc, getEditor: () => editor, v2Collaboration: null }] };
      instance.activeEditor = editor as never;
      expect(
        await instance.upgradeToCollaboration({
          collaboration: {
            providerType: 'y-websocket',
            documentId: `room-${suffix}`,
            serverUrl: 'wss://example.test',
          },
        } as never),
      ).toEqual({ roomId: `room-${suffix}`, documentId: `doc-${suffix}` });
      instance.destroy();
      expect(modules).toEqual({ comments: { visible: false } });
      expect(Object.hasOwn(modules, 'collaboration')).toBe(false);
    }
  });

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

  describe('when the instance is destroyed during the upgrade', () => {
    const destroyedDuringUpgrade = 'SuperDoc: instance was destroyed during upgrade';

    const mountUpgrade = (engineUpgrade: () => Promise<void>, pendingSave?: () => Promise<Blob>) => {
      const selector = document.createElement('div');
      document.body.append(selector);
      const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
      instances.push(instance);
      const source = new Blob([new Uint8Array([1, 2, 3])]);
      const upgradeToCollaboration = vi.fn().mockImplementation(engineUpgrade);
      const save = vi.fn().mockImplementation(pendingSave ?? (async () => source));
      const editor = { editorVersion: 2, options: { documentId: 'upgrade-doc' }, upgradeToCollaboration, save };
      const configDoc = { id: 'upgrade-doc', type: DOCX, data: source };
      const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
      const mutable = instance as unknown as {
        config: { documents: unknown[] };
        superdocStore: { documents: unknown[] };
      };
      mutable.config.documents = [configDoc];
      mutable.superdocStore = { documents: [storeDoc] };
      instance.activeEditor = editor as never;
      const upgrade = instance.upgradeToCollaboration({
        collaboration: { providerType: 'y-websocket', documentId: 'room', serverUrl: 'wss://example.test' },
      } as never);
      const stateAtDestroy = () => ({
        configDoc: { ...configDoc },
        storeDoc: { ...storeDoc },
        keepsSourceData: configDoc.data === source && storeDoc.data === source,
        isCollaborative: instance.isCollaborative,
      });
      return { instance, upgrade, save, upgradeToCollaboration, stateAtDestroy };
    };

    const startUpgrade = async (engineUpgrade: () => Promise<void>, pendingSave?: () => Promise<Blob>) => {
      const { instance, upgrade, save, upgradeToCollaboration, stateAtDestroy } = mountUpgrade(
        engineUpgrade,
        pendingSave,
      );
      const blockedStep = pendingSave ? save : upgradeToCollaboration;
      await vi.waitFor(() => expect(blockedStep).toHaveBeenCalledTimes(1));
      instance.destroy();
      return { upgrade, upgradeToCollaboration, stateAtDestroy, expectedState: stateAtDestroy() };
    };

    const flushPendingWork = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('rejects the caller and does not finalize when the engine resolves afterwards', async () => {
      let finishUpgrade!: () => void;
      const { upgrade, stateAtDestroy, expectedState } = await startUpgrade(
        () =>
          new Promise<void>((resolve) => {
            finishUpgrade = resolve;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      finishUpgrade();
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    it('rejects the caller and does not finalize when destroy() runs after the engine attach resolves', async () => {
      let finishUpgrade!: () => void;
      const attached = new Promise<void>((resolve) => {
        finishUpgrade = resolve;
      });
      const { instance, upgrade, upgradeToCollaboration, stateAtDestroy } = mountUpgrade(() => attached);
      await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));
      const destroyedState = attached.then(() => {
        instance.destroy();
        return stateAtDestroy();
      });
      const outcome = Promise.allSettled([upgrade]);
      finishUpgrade();
      const expectedState = await destroyedState;
      expect(expectedState.configDoc.v2Collaboration).toMatchObject({ roomMode: 'create' });
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    it('rejects the caller and does not roll back when the engine rejects afterwards', async () => {
      let failUpgrade!: (error: Error) => void;
      const { upgrade, stateAtDestroy, expectedState } = await startUpgrade(
        () =>
          new Promise<void>((_resolve, reject) => {
            failUpgrade = reject;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      failUpgrade(new Error('engine failed'));
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    it('rejects the caller promptly when the engine never settles', async () => {
      const { upgrade, stateAtDestroy, expectedState } = await startUpgrade(() => new Promise<void>(() => {}));
      await expect(upgrade).rejects.toThrow(destroyedDuringUpgrade);
      await flushPendingWork();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    const attachRoom = () => Promise.resolve();
    const savedDocx = () => new Blob([new Uint8Array([4, 5, 6])]);

    it('rejects the caller and never attaches the room when the DOCX save resolves afterwards', async () => {
      let finishSave!: (saved: Blob) => void;
      const { upgrade, upgradeToCollaboration, stateAtDestroy, expectedState } = await startUpgrade(
        attachRoom,
        () =>
          new Promise<Blob>((resolve) => {
            finishSave = resolve;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      finishSave(savedDocx());
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(upgradeToCollaboration).not.toHaveBeenCalled();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    it('rejects the caller and never attaches the room when the DOCX save rejects afterwards', async () => {
      let failSave!: (error: Error) => void;
      const { upgrade, upgradeToCollaboration, stateAtDestroy, expectedState } = await startUpgrade(
        attachRoom,
        () =>
          new Promise<Blob>((_resolve, reject) => {
            failSave = reject;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      failSave(new Error('save failed'));
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(upgradeToCollaboration).not.toHaveBeenCalled();
      expect(stateAtDestroy()).toEqual(expectedState);
    });

    it('rejects the caller promptly and never attaches the room when the DOCX save never settles', async () => {
      const { upgrade, upgradeToCollaboration, stateAtDestroy, expectedState } = await startUpgrade(
        attachRoom,
        () => new Promise<Blob>(() => {}),
      );
      expect(await Promise.allSettled([upgrade])).toEqual([
        { status: 'rejected', reason: new Error(destroyedDuringUpgrade) },
      ]);
      await flushPendingWork();
      expect(upgradeToCollaboration).not.toHaveBeenCalled();
      expect(stateAtDestroy()).toEqual(expectedState);
    });
  });
});
