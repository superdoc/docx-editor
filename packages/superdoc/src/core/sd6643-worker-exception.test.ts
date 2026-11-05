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

it('does not duplicate the existing worker failure exception and resets after sync', async () => {
  const selector = document.createElement('div');
  document.body.append(selector);
  const onException = vi.fn();
  const onCollaborationConnectionChange = vi.fn();
  const instance = new SuperDoc({
    selector,
    document: new File(['synthetic'], 'synthetic.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    telemetry: { enabled: false },
    onException,
    onCollaborationConnectionChange,
  });
  instances.push(instance);
  await vi.waitFor(() => expect(instance.listenerCount('collaboration-connection-change')).toBe(1));
  onException.mockClear();
  let snapshot: Snapshot = { state: 'synced', detail: null };
  const listeners = new Set<(value: Snapshot) => void>();
  const connection = {
    documentId: 'room-sd6643',
    getSnapshot: () => snapshot,
    subscribe(listener: (value: Snapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const push = (value: Snapshot) => {
    snapshot = value;
    for (const listener of [...listeners]) listener(value);
  };
  Reflect.apply(instance.emit, instance, ['collaboration-ready', { editor: { editorVersion: 2, connection } }]);
  push({ state: 'failed', detail: 'worker-transport-failed' });
  Reflect.apply(instance.emit, instance, [
    'exception',
    {
      error: new Error('Worker transport failed.'),
      code: 'worker-transport-failed',
      documentId: 'room-sd6643',
      editor: null,
    },
  ]);
  expect(onCollaborationConnectionChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: 'failed', detail: 'worker-transport-failed' }),
  );
  expect(onException).toHaveBeenCalledTimes(1);
  expect(onException).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'worker-transport-failed' }));
  push({ state: 'synced', detail: null });
  push({ state: 'failed', detail: null });
  expect(onException).toHaveBeenCalledTimes(2);
  expect(onException).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'collaboration-connection-failed' }));
});
