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

  const savedDocx = () => new Blob([new Uint8Array([4, 5, 6])]);

  const attachRoom = () => Promise.resolve();

  const mountIdle = (
    engineUpgrade: () => Promise<void>,
    pendingSave?: () => Promise<Blob>,
    activeDocumentId = 'upgrade-doc',
    replaceFile?: () => Promise<unknown>,
  ) => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
    instances.push(instance);
    const originalDocx = new Blob([new Uint8Array([1, 2, 3])]);
    const upgradeToCollaboration = vi.fn().mockImplementation(engineUpgrade);
    const save = vi.fn().mockImplementation(pendingSave ?? (async () => savedDocx()));
    const editor = {
      editorVersion: 2,
      options: { documentId: activeDocumentId },
      upgradeToCollaboration,
      save,
      replaceFile,
    };
    const configDoc = { id: 'upgrade-doc', type: DOCX, data: originalDocx, v2Collaboration: null };
    const storeDoc = { ...configDoc, getEditor: () => editor, v2Collaboration: null };
    const mutable = instance as unknown as {
      config: { documents: unknown[] };
      superdocStore: { documents: unknown[] };
    };
    mutable.config.documents = [configDoc];
    mutable.superdocStore = { documents: [storeDoc] };
    instance.activeEditor = editor as never;
    const startUpgrade = () =>
      instance.upgradeToCollaboration({
        collaboration: { providerType: 'y-websocket', documentId: 'room', serverUrl: 'wss://example.test' },
      } as never);
    const snapshotState = () => ({
      configDoc: { ...configDoc },
      storeDoc: { ...storeDoc },
      keepsOriginalData: configDoc.data === originalDocx && storeDoc.data === originalDocx,
      isCollaborative: instance.isCollaborative,
    });
    return { instance, startUpgrade, save, upgradeToCollaboration, snapshotState };
  };

  const mountUpgrade = (...args: Parameters<typeof mountIdle>) => {
    const mounted = mountIdle(...args);
    return { ...mounted, upgrade: mounted.startUpgrade() };
  };

  it('restores the pre-upgrade state on a live instance when the attached room check fails', async () => {
    const saved = savedDocx();
    const { upgrade, save, upgradeToCollaboration, snapshotState } = mountUpgrade(
      attachRoom,
      async () => saved,
      'detached-doc',
    );
    const before = snapshotState();

    await expect(upgrade).rejects.toThrow(
      'SuperDoc: collaboration upgrade did not attach the expected room and document',
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(upgradeToCollaboration).toHaveBeenCalledWith(saved, expect.objectContaining({ roomMode: 'create' }));
    expect(saved).not.toBe(before.configDoc.data);
    const after = snapshotState();
    expect(after.configDoc.data).toBe(before.configDoc.data);
    expect(after.storeDoc.data).toBe(before.storeDoc.data);
    expect(after.configDoc.v2Collaboration).toBe(before.configDoc.v2Collaboration);
    expect(after.storeDoc.v2Collaboration).toBe(before.storeDoc.v2Collaboration);
    expect(after.isCollaborative).toBe(before.isCollaborative);
  });

  describe('when a document replace is requested during the upgrade', () => {
    const upgradeInProgress = 'SuperDoc: cannot replace the document while an upgrade is in progress';
    const savedBeforeReplace = () => new Blob([new Uint8Array([10, 11, 12])]);
    const replacementDocx = () => new Blob([new Uint8Array([20, 21, 22])]);

    const mountReplaceDuringUpgrade = (engineUpgrade: () => Promise<void>, pendingSave?: () => Promise<Blob>) => {
      const replaceFile = vi.fn().mockResolvedValue({ state: 'editing-ready' });
      return { ...mountUpgrade(engineUpgrade, pendingSave, 'upgrade-doc', replaceFile), replaceFile };
    };

    it.each(['replaceDocument', 'replaceFile'] as const)(
      '%s during the DOCX save is refused, and the room is seeded from the saved bytes',
      async (method) => {
        let finishSave!: (saved: Blob) => void;
        const saved = savedBeforeReplace();
        const { instance, upgrade, save, upgradeToCollaboration, replaceFile, snapshotState } =
          mountReplaceDuringUpgrade(
            attachRoom,
            () =>
              new Promise<Blob>((resolve) => {
                finishSave = resolve;
              }),
          );
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

        await expect(instance[method](replacementDocx())).rejects.toThrow(upgradeInProgress);
        finishSave(saved);

        expect(await upgrade).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
        expect(replaceFile).not.toHaveBeenCalled();
        expect(upgradeToCollaboration).toHaveBeenCalledWith(saved, expect.objectContaining({ roomMode: 'create' }));
        expect(snapshotState().configDoc.data).toBe(saved);
        expect(snapshotState().storeDoc.data).toBe(saved);
      },
    );

    it('refuses a replace made synchronously while the save starts', async () => {
      const saved = savedBeforeReplace();
      let replacing: Promise<unknown> = Promise.resolve();
      const { upgrade, upgradeToCollaboration, replaceFile, snapshotState } = mountReplaceDuringUpgrade(
        attachRoom,
        async () => {
          replacing = instances.at(-1)?.replaceDocument(replacementDocx()) ?? Promise.resolve();
          return saved;
        },
      );
      expect(await upgrade).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });

      await expect(replacing).rejects.toThrow(upgradeInProgress);
      expect(replaceFile).not.toHaveBeenCalled();
      expect(upgradeToCollaboration).toHaveBeenCalledWith(saved, expect.objectContaining({ roomMode: 'create' }));
      expect(snapshotState().configDoc.data).toBe(saved);
    });

    it('refuses a replace during the engine attach without touching the upgrade', async () => {
      let finishUpgrade!: () => void;
      const { instance, upgrade, upgradeToCollaboration, replaceFile, snapshotState } = mountReplaceDuringUpgrade(
        () =>
          new Promise<void>((resolve) => {
            finishUpgrade = resolve;
          }),
      );
      await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));

      await expect(instance.replaceDocument(replacementDocx())).rejects.toThrow(upgradeInProgress);
      finishUpgrade();

      expect(await upgrade).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
      expect(replaceFile).not.toHaveBeenCalled();
      expect(snapshotState().configDoc.data).toBe(upgradeToCollaboration.mock.calls[0]?.[0]);
    });

    it('accepts a replace once the upgrade has settled', async () => {
      const { instance, upgrade, replaceFile, snapshotState } = mountReplaceDuringUpgrade(attachRoom);
      await upgrade;
      const replacement = replacementDocx();

      expect(await instance.replaceDocument(replacement)).toEqual({ ok: true });
      expect(replaceFile).toHaveBeenCalledTimes(1);
      expect(snapshotState().configDoc.data).toBe(replacement);
    });
  });

  describe('when an upgrade is requested while a document replace waits on the host', () => {
    const replaceInProgress = 'SuperDoc: cannot upgrade while a document replace is in progress';
    const replacementDocx = () => new Blob([new Uint8Array([30, 31, 32])]);

    const mountReplaceFirst = () => {
      let confirmReplace: (result: unknown) => void = () => {};
      let failReplace: (error: Error) => void = () => {};
      const replaceFile = vi.fn(
        () =>
          new Promise<unknown>((resolve, reject) => {
            confirmReplace = resolve;
            failReplace = reject;
          }),
      );
      const saved = new Blob([new Uint8Array([40, 41, 42])]);
      const mounted = mountIdle(attachRoom, async () => saved, 'upgrade-doc', replaceFile);
      return {
        ...mounted,
        replaceFile,
        saved,
        confirmReplace: (result: unknown) => confirmReplace(result),
        failReplace: (error: Error) => failReplace(error),
      };
    };

    it.each(['replaceDocument', 'replaceFile'] as const)(
      'refuses the upgrade during %s, and the replacement stays',
      async (method) => {
        const { instance, startUpgrade, save, upgradeToCollaboration, replaceFile, confirmReplace, snapshotState } =
          mountReplaceFirst();
        const replacement = replacementDocx();

        const replacing = instance[method](replacement);
        await vi.waitFor(() => expect(replaceFile).toHaveBeenCalledTimes(1));
        await expect(startUpgrade()).rejects.toThrow(replaceInProgress);
        confirmReplace({ state: 'editing-ready' });
        await replacing;

        expect(save).not.toHaveBeenCalled();
        expect(upgradeToCollaboration).not.toHaveBeenCalled();
        expect(snapshotState().configDoc.data).toBe(replacement);
        expect(snapshotState().storeDoc.data).toBe(replacement);
        expect(snapshotState().isCollaborative).not.toBe(true);
      },
    );

    it('accepts the upgrade once the replace has failed', async () => {
      const { instance, startUpgrade, replaceFile, failReplace, saved, upgradeToCollaboration } = mountReplaceFirst();

      const replacing = instance.replaceDocument(replacementDocx());
      await vi.waitFor(() => expect(replaceFile).toHaveBeenCalledTimes(1));
      failReplace(new Error('host failed'));
      await expect(replacing).rejects.toThrow('host failed');

      expect(await startUpgrade()).toEqual({ roomId: 'room', documentId: 'upgrade-doc' });
      expect(upgradeToCollaboration).toHaveBeenCalledWith(saved, expect.objectContaining({ roomMode: 'create' }));
    });

    it('rejects the replace pending at destroy() and refuses an upgrade afterwards as destroyed', async () => {
      const { instance, startUpgrade, replaceFile, confirmReplace, snapshotState } = mountReplaceFirst();
      const before = snapshotState();

      const replacing = instance.replaceDocument(replacementDocx());
      await vi.waitFor(() => expect(replaceFile).toHaveBeenCalledTimes(1));
      instance.destroy();
      confirmReplace({ state: 'editing-ready' });

      await expect(replacing).rejects.toThrow('SuperDoc: instance was destroyed during replace');
      await expect(startUpgrade()).rejects.toThrow('SuperDoc: cannot upgrade a destroyed instance');
      expect(snapshotState().configDoc.data).toBe(before.configDoc.data);
    });
  });

  describe('when the instance is destroyed during the upgrade', () => {
    const destroyedDuringUpgrade = 'SuperDoc: instance was destroyed during upgrade';

    const startUpgrade = async (engineUpgrade: () => Promise<void>, pendingSave?: () => Promise<Blob>) => {
      const { instance, upgrade, save, upgradeToCollaboration, snapshotState } = mountUpgrade(
        engineUpgrade,
        pendingSave,
      );
      const blockedStep = pendingSave ? save : upgradeToCollaboration;
      await vi.waitFor(() => expect(blockedStep).toHaveBeenCalledTimes(1));
      instance.destroy();
      return { upgrade, upgradeToCollaboration, snapshotState, expectedState: snapshotState() };
    };

    const flushPendingWork = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('rejects the caller and does not finalize when the engine resolves afterwards', async () => {
      let finishUpgrade!: () => void;
      const { upgrade, snapshotState, expectedState } = await startUpgrade(
        () =>
          new Promise<void>((resolve) => {
            finishUpgrade = resolve;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      finishUpgrade();
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller and does not finalize when destroy() runs after the engine attach resolves', async () => {
      let finishUpgrade!: () => void;
      const attached = new Promise<void>((resolve) => {
        finishUpgrade = resolve;
      });
      const { instance, upgrade, upgradeToCollaboration, snapshotState } = mountUpgrade(() => attached);
      await vi.waitFor(() => expect(upgradeToCollaboration).toHaveBeenCalledTimes(1));
      const destroyedState = attached.then(() => {
        instance.destroy();
        return snapshotState();
      });
      const outcome = Promise.allSettled([upgrade]);
      finishUpgrade();
      const expectedState = await destroyedState;
      expect(expectedState.configDoc.v2Collaboration).toMatchObject({ roomMode: 'create' });
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller and does not roll back when the engine rejects afterwards', async () => {
      let failUpgrade!: (error: Error) => void;
      const { upgrade, snapshotState, expectedState } = await startUpgrade(
        () =>
          new Promise<void>((_resolve, reject) => {
            failUpgrade = reject;
          }),
      );
      const outcome = Promise.allSettled([upgrade]);
      failUpgrade(new Error('engine failed'));
      expect(await outcome).toEqual([{ status: 'rejected', reason: new Error(destroyedDuringUpgrade) }]);
      await flushPendingWork();
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller promptly when the engine never settles', async () => {
      const { upgrade, snapshotState, expectedState } = await startUpgrade(() => new Promise<void>(() => {}));
      await expect(upgrade).rejects.toThrow(destroyedDuringUpgrade);
      await flushPendingWork();
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller and never attaches the room when the DOCX save resolves afterwards', async () => {
      let finishSave!: (saved: Blob) => void;
      const { upgrade, upgradeToCollaboration, snapshotState, expectedState } = await startUpgrade(
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
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller and never attaches the room when the DOCX save rejects afterwards', async () => {
      let failSave!: (error: Error) => void;
      const { upgrade, upgradeToCollaboration, snapshotState, expectedState } = await startUpgrade(
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
      expect(snapshotState()).toEqual(expectedState);
    });

    it('rejects the caller promptly and never attaches the room when the DOCX save never settles', async () => {
      const { upgrade, upgradeToCollaboration, snapshotState, expectedState } = await startUpgrade(
        attachRoom,
        () => new Promise<Blob>(() => {}),
      );
      expect(await Promise.allSettled([upgrade])).toEqual([
        { status: 'rejected', reason: new Error(destroyedDuringUpgrade) },
      ]);
      await flushPendingWork();
      expect(upgradeToCollaboration).not.toHaveBeenCalled();
      expect(snapshotState()).toEqual(expectedState);
    });
  });
});
