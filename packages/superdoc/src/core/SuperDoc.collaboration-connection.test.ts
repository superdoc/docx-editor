/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('./v2-integration/v2-integration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./v2-integration/v2-integration.js')>()),
  loadDefaultV2IntegrationOrFallback: () => Promise.resolve(),
}));

const { SuperDoc } = await import('./SuperDoc.js');

type Snapshot = { state: 'connecting' | 'synced' | 'degraded' | 'failed'; detail: string | null };

const instances: InstanceType<typeof SuperDoc>[] = [];
const blankDocx = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../shared/common/data/blank.docx'),
);

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function createConnectionFacade(documentId: string, initial: Snapshot | null) {
  let snapshot = initial;
  const listeners = new Set<(next: Snapshot) => void>();
  return {
    facade: {
      documentId,
      getSnapshot: () => snapshot,
      subscribe(listener: (next: Snapshot) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push(next: Snapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}

async function createInstance(onCollaborationConnectionChange = vi.fn()) {
  const selector = document.createElement('div');
  document.body.append(selector);
  const docxFile = new File([blankDocx], 'blank.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const instance = new SuperDoc({
    selector,
    document: docxFile,
    telemetry: { enabled: false },
    onCollaborationConnectionChange,
  } as never);
  instances.push(instance);
  // Listeners attach after async init; the bridge is registered in the same pass.
  await vi.waitFor(() => expect(instance.listenerCount('collaboration-connection-change')).toBe(1));
  return { instance, onCollaborationConnectionChange };
}

describe('SuperDoc collaboration-connection-change (SD-4997)', () => {
  it('reports initial sync, post-sync loss, reconnect attempts, and recovery with the room id', async () => {
    const { instance, onCollaborationConnectionChange } = await createInstance();
    const connection = createConnectionFacade('room-1', { state: 'synced', detail: null });

    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: connection.facade } } as never);
    connection.push({ state: 'degraded', detail: null });
    connection.push({ state: 'degraded', detail: 'reconnecting' });
    connection.push({ state: 'degraded', detail: 'reconnecting' });
    connection.push({ state: 'synced', detail: null });

    const payloads = onCollaborationConnectionChange.mock.calls.map(([payload]) => payload);
    expect(
      payloads.map(({ kind, state, previousState, detail, documentId }) => ({
        kind,
        state,
        previousState,
        detail,
        documentId,
      })),
    ).toEqual([
      { kind: 'initial', state: 'synced', previousState: null, detail: null, documentId: 'room-1' },
      { kind: 'lost', state: 'degraded', previousState: 'synced', detail: null, documentId: 'room-1' },
      {
        kind: 'reconnecting',
        state: 'degraded',
        previousState: 'degraded',
        detail: 'reconnecting',
        documentId: 'room-1',
      },
      { kind: 'recovered', state: 'synced', previousState: 'degraded', detail: null, documentId: 'room-1' },
    ]);
    expect(payloads.every((payload) => payload.superdoc === instance)).toBe(true);
    expect(instance.getCollaborationConnectionState()).toMatchObject({ kind: 'recovered', state: 'synced' });
  });

  it('reports a terminal failure as failed', async () => {
    const { instance, onCollaborationConnectionChange } = await createInstance();
    const connection = createConnectionFacade('room-fail', { state: 'connecting', detail: null });

    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: connection.facade } } as never);
    connection.push({ state: 'failed', detail: null });

    expect(onCollaborationConnectionChange.mock.calls.map(([payload]) => payload.kind)).toEqual(['initial', 'failed']);
  });

  it('keeps room history across a remount so a replayed synced is not reported twice', async () => {
    const { instance, onCollaborationConnectionChange } = await createInstance();
    const first = createConnectionFacade('room-2', { state: 'synced', detail: null });
    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: first.facade } } as never);
    first.push({ state: 'degraded', detail: null });

    const second = createConnectionFacade('room-2', { state: 'synced', detail: null });
    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: second.facade } } as never);

    expect(first.listenerCount()).toBe(0);
    expect(onCollaborationConnectionChange.mock.calls.map(([payload]) => payload.kind)).toEqual([
      'initial',
      'lost',
      'recovered',
    ]);
  });

  it('starts fresh history for a different room and stops listening on destroy', async () => {
    const { instance, onCollaborationConnectionChange } = await createInstance();
    const first = createConnectionFacade('room-a', { state: 'synced', detail: null });
    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: first.facade } } as never);

    const second = createConnectionFacade('room-b', { state: 'synced', detail: null });
    instance.emit('collaboration-ready', { editor: { editorVersion: 2, connection: second.facade } } as never);
    expect(onCollaborationConnectionChange.mock.calls.at(-1)?.[0]).toMatchObject({
      documentId: 'room-b',
      kind: 'initial',
      previousState: null,
    });

    instance.destroy();
    instances.splice(instances.indexOf(instance), 1);
    expect(second.listenerCount()).toBe(0);
  });

  it('does nothing for editors without a connection facade', async () => {
    const { instance, onCollaborationConnectionChange } = await createInstance();
    instance.emit('collaboration-ready', { editor: { editorVersion: 2 } } as never);
    expect(onCollaborationConnectionChange).not.toHaveBeenCalled();
    expect(instance.getCollaborationConnectionState()).toBeNull();
  });
});
