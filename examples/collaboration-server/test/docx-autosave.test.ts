import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createDocxAutosave, type DocxAutosaveOptions } from '../src/docx/autosave.ts';
import type { SdkClient } from '../src/sdk.ts';
import { waitFor } from './helpers.ts';

const ROOM = 'sd2/v2.1/contract-42';
const OTHER = 'sd2/v2.1/contract-43';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeSdk({ failures = 0, saveMs = 0 } = {}) {
  const sdk = {
    clients: 0,
    disposed: 0,
    opens: [] as Array<Parameters<SdkClient['open']>>,
    closes: [] as Array<{ discard?: boolean } | undefined>,
    active: 0,
    maxActive: 0,
    failuresLeft: failures,
    saveMs,
  };
  const createClient = (): SdkClient => {
    sdk.clients += 1;
    return {
      async open(params, options) {
        sdk.opens.push([params, options]);
        if (sdk.failuresLeft > 0) {
          sdk.failuresLeft -= 1;
          throw new Error('room unavailable');
        }
        sdk.active += 1;
        sdk.maxActive = Math.max(sdk.maxActive, sdk.active);
        const saved = sdk.opens.length;
        return {
          async save({ out }) {
            await sleep(sdk.saveMs);
            await writeFile(out, `${params.collaboration.documentId} #${saved}`);
          },
          async close(closeParams) {
            sdk.closes.push(closeParams);
            sdk.active -= 1;
          },
        };
      },
      async dispose() {
        sdk.disposed += 1;
      },
    };
  };
  return { sdk, createClient };
}

function setup(options: Partial<DocxAutosaveOptions> & { sdk?: ReturnType<typeof fakeSdk> } = {}) {
  const { sdk, createClient } = options.sdk ?? fakeSdk();
  const saved: Array<{ documentId: string; text: string }> = [];
  const logs: string[] = [];
  const autosave = createDocxAutosave({
    serverUrl: 'ws://127.0.0.1:1234',
    docxStore: {
      async put(documentId, docx) {
        saved.push({ documentId, text: Buffer.from(docx).toString('utf8') });
      },
    },
    idleMs: 50,
    retryDelayMs: 1,
    createClient,
    log: (message) => logs.push(message),
    ...options,
  });
  return { autosave, sdk, saved, logs };
}

test('saves once after a room goes idle, as a joining client that discards its local changes', async () => {
  const { autosave, sdk, saved } = setup();
  autosave.roomChanged(ROOM);
  await sleep(20);
  autosave.roomChanged(ROOM);
  await sleep(20);
  autosave.roomChanged(ROOM);
  assert.equal(saved.length, 0, 'nothing is saved while edits continue');

  await waitFor(() => saved.length === 1, 'the save');
  await sleep(100);
  assert.deepEqual(saved, [{ documentId: 'contract-42', text: 'contract-42 #1' }]);

  const [params, options] = sdk.opens[0]!;
  assert.deepEqual(params.collaboration, {
    providerType: 'hocuspocus',
    url: 'ws://127.0.0.1:1234',
    documentId: 'contract-42',
    roomMode: 'join',
    params: { [autosave.marker.name]: autosave.marker.value },
  });
  assert.equal(options, undefined, 'no token without access checks');
  assert.deepEqual(sdk.closes, [{ discard: true }]);
  assert.match(autosave.marker.value, /^[0-9a-f]{48}$/);
});

test('saves right away when the last client leaves, but only with unsaved changes', async () => {
  const { autosave, saved } = setup({ idleMs: 60_000 });
  autosave.roomEmptied(ROOM);
  await sleep(50);
  assert.equal(saved.length, 0, 'a room without changes is not saved');

  autosave.roomChanged(ROOM);
  autosave.roomEmptied(ROOM);
  await waitFor(() => saved.length === 1, 'the save on leaving');

  autosave.roomEmptied(ROOM);
  await sleep(50);
  assert.equal(saved.length, 1, 'leaving again after the save does not save again');
  await autosave.stop();
});

test('runs one save at a time and saves changes made during a save afterwards', async () => {
  const { autosave, sdk, saved } = setup({ idleMs: 0, sdk: fakeSdk({ saveMs: 100 }) });
  autosave.roomChanged(ROOM);
  autosave.roomChanged(OTHER);
  await waitFor(() => sdk.active === 1, 'the first save to start');
  autosave.roomChanged(ROOM);

  await waitFor(() => saved.length === 3, 'all saves');
  assert.equal(sdk.maxActive, 1);
  assert.deepEqual(
    saved.map((s) => s.documentId),
    ['contract-42', 'contract-43', 'contract-42'],
  );
});

test('retries a failed save with a fresh engine', async () => {
  const { autosave, sdk, saved, logs } = setup({ idleMs: 0, sdk: fakeSdk({ failures: 1 }) });
  autosave.roomChanged(ROOM);
  await waitFor(() => saved.length === 1, 'the retried save');
  assert.equal(sdk.clients, 2, 'the failed engine was replaced');
  assert.equal(sdk.disposed, 1);
  assert.ok(logs.some((line) => line.includes('Retrying')));
});

test('after the last retry it keeps the room unsaved and tries again on the next trigger', async () => {
  const { autosave, sdk, saved, logs } = setup({ idleMs: 0, retries: 1, sdk: fakeSdk({ failures: 2 }) });
  autosave.roomChanged(ROOM);
  await waitFor(() => logs.some((line) => line.includes('will be saved after the next change')), 'the give-up');
  assert.equal(saved.length, 0);
  assert.equal(sdk.opens.length, 2);

  autosave.roomEmptied(ROOM);
  await waitFor(() => saved.length === 1, 'the save on the next trigger');
});

test('flush saves every room with unsaved changes; stop also shuts down the engine', async () => {
  const { autosave, sdk, saved } = setup({ idleMs: 60_000 });
  autosave.roomChanged(ROOM);
  autosave.roomChanged(OTHER);
  await autosave.flush();
  assert.deepEqual(saved.map((s) => s.documentId).sort(), ['contract-42', 'contract-43']);

  autosave.roomChanged(ROOM);
  await autosave.stop();
  assert.equal(saved.length, 3, 'stop saved the pending room first');
  assert.equal(sdk.disposed, 1);
});

for (const operation of ['flush', 'stop'] as const) {
  for (const changedRoom of [ROOM, OTHER]) {
    test(`${operation} saves edits to ${changedRoom} received while its first snapshot is being written`, async () => {
      let text = 'First edit.';
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let snapshots = 0;
      const { autosave, saved } = setup({
        idleMs: 60_000,
        createClient: () => ({
          async open() {
            const snapshot = text;
            const first = ++snapshots === 1;
            return {
              async save({ out }) {
                if (first) await held;
                await writeFile(out, snapshot);
              },
              async close() {},
            };
          },
          async dispose() {},
        }),
      });
      autosave.roomChanged(ROOM);
      const finishing = autosave[operation]();
      await waitFor(() => snapshots === 1, 'the first snapshot');
      text += ' Later accepted edit.';
      autosave.roomChanged(changedRoom);
      release();
      await finishing;
      assert.equal(saved.at(-1)?.text, text);
      assert.equal(snapshots, 2);
      await autosave.stop();
    });
  }
}

test('shutdown reports a failed room after bounded retries and disposes the SDK', async () => {
  const { autosave, sdk, logs } = setup({ idleMs: 60_000, retries: 1, sdk: fakeSdk({ failures: 100 }) });
  autosave.roomChanged(ROOM);
  await assert.rejects(autosave.stop(), /contract-42/);
  assert.equal(sdk.opens.length, 2);
  assert.equal(sdk.disposed, 2);
  assert.ok(logs.some((line) => line.includes('Could not save contract-42.docx')));
});

test('flush drains an edit queued between the last save and worker cleanup', async () => {
  const { autosave, saved } = setup({
    idleMs: 60_000,
    log(message) {
      if (message === 'Saved contract-42.docx') {
        queueMicrotask(() => queueMicrotask(() => autosave.roomChanged(OTHER)));
      }
    },
  });
  autosave.roomChanged(ROOM);
  await autosave.flush();
  assert.deepEqual(
    saved.map((entry) => entry.documentId),
    ['contract-42', 'contract-43'],
  );
  await autosave.stop();
});

test('sends the service token and skips rooms that are not SuperDoc rooms', async () => {
  const { autosave, sdk, saved, logs } = setup({ idleMs: 0, token: async () => 'service-token' });
  autosave.roomChanged('not-a-superdoc-room');
  autosave.roomChanged(ROOM);
  await waitFor(() => saved.length === 1, 'the save');
  assert.equal(sdk.opens.length, 1);
  assert.deepEqual(sdk.opens[0]![1], { collaborationAuth: { type: 'token', token: 'service-token' } });
  assert.ok(logs.some((line) => line.includes('Not a SuperDoc room')));
});

test('a room with an empty name does not stop the rooms queued behind it', async () => {
  const { autosave, saved } = setup();
  autosave.roomChanged('');
  autosave.roomChanged(ROOM);
  await autosave.flush();
  assert.deepEqual(
    saved.map((entry) => entry.documentId),
    ['contract-42'],
  );
});
