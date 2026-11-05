import { afterEach, expect, it, vi } from 'vite-plus/test';

vi.mock('./v2-integration/v2-integration.js', async (original) => ({
  ...(await original<typeof import('./v2-integration/v2-integration.js')>()),
  loadDefaultV2IntegrationOrFallback: () => Promise.resolve(),
}));

const { SuperDoc } = await import('./SuperDoc.js');

type Snapshot = { state: 'connecting' | 'synced' | 'degraded' | 'failed'; detail: string | null };
const instances: InstanceType<typeof SuperDoc>[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function connection(documentId: string, initial: Snapshot) {
  let snapshot = initial;
  const listeners = new Set<(value: Snapshot) => void>();
  return {
    facade: {
      documentId,
      getSnapshot: () => snapshot,
      subscribe(listener: (value: Snapshot) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push(value: Snapshot) {
      snapshot = value;
      for (const listener of [...listeners]) listener(value);
    },
  };
}

async function setup() {
  const selector = document.createElement('div');
  document.body.append(selector);
  const onException = vi.fn();
  const instance = new SuperDoc({
    selector,
    document: new File(['synthetic'], 'synthetic.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    telemetry: { enabled: false },
    onException,
    onCollaborationConnectionChange: vi.fn(),
  });
  instances.push(instance);
  await vi.waitFor(() => expect(instance.listenerCount('collaboration-connection-change')).toBe(1));
  onException.mockClear();
  return { instance, onException };
}

it('reports one transport exception per failure episode and resets after sync', async () => {
  const { instance, onException } = await setup();
  const room = connection('room-sd6643', { state: 'synced', detail: null });
  Reflect.apply(instance.emit, instance, [
    'collaboration-ready',
    { editor: { editorVersion: 2, connection: room.facade } },
  ]);
  room.push({ state: 'degraded', detail: null });
  room.push({ state: 'degraded', detail: 'reconnecting' });
  expect(onException).not.toHaveBeenCalled();
  room.push({ state: 'failed', detail: null });
  expect(onException).toHaveBeenCalledTimes(1);
  expect(onException).toHaveBeenLastCalledWith(
    expect.objectContaining({
      code: 'collaboration-connection-failed',
      collaborationReason: 'connection-failed',
      documentId: 'room-sd6643',
      error: expect.any(Error),
    }),
  );
  room.push({ state: 'failed', detail: 'same failure' });
  room.push({ state: 'degraded', detail: 'reconnecting' });
  room.push({ state: 'failed', detail: null });
  expect(onException).toHaveBeenCalledTimes(1);
  room.push({ state: 'synced', detail: null });
  room.push({ state: 'failed', detail: null });
  expect(onException).toHaveBeenCalledTimes(2);
});

it('deduplicates failed snapshots across remount and starts a new episode for another room', async () => {
  const { instance, onException } = await setup();
  const first = connection('room-a', { state: 'failed', detail: null });
  Reflect.apply(instance.emit, instance, [
    'collaboration-ready',
    { editor: { editorVersion: 2, connection: first.facade } },
  ]);
  expect(onException).toHaveBeenCalledTimes(1);
  const remount = connection('room-a', { state: 'failed', detail: 'same failure' });
  Reflect.apply(instance.emit, instance, [
    'collaboration-ready',
    { editor: { editorVersion: 2, connection: remount.facade } },
  ]);
  expect(onException).toHaveBeenCalledTimes(1);
  const other = connection('room-b', { state: 'failed', detail: null });
  Reflect.apply(instance.emit, instance, [
    'collaboration-ready',
    { editor: { editorVersion: 2, connection: other.facade } },
  ]);
  expect(onException).toHaveBeenCalledTimes(2);
  expect(onException).toHaveBeenLastCalledWith(expect.objectContaining({ documentId: 'room-b' }));
});
