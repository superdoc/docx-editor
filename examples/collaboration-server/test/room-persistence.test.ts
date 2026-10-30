import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createFileRoomStore } from '../src/storage/file.ts';
import type { RoomStore } from '../src/storage/types.ts';
import { type Client, connect, open, startServer, waitFor } from './helpers.ts';

const ROOM = 'sd2/v2.1/refresh-room';

async function tempDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a room survives its last client leaving', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const running = await startServer(t, { storageDirectory });

  const first = await connect(running, ROOM);
  first.document.getText('body').insert(0, 'Payment is due in 30 days.');
  await waitFor(() => running.server.getDocumentsCount() === 1, 'the room to load');

  first.leave();
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  assert.equal((await readdir(storageDirectory)).length, 1, 'the room was stored before it unloaded');

  const second = await connect(running, ROOM);
  assert.equal(second.document.getText('body').toString(), 'Payment is due in 30 days.');
});

test('a room survives a server restart', async (t) => {
  const storageDirectory = await tempDirectory(t);

  const before = await startServer(t, { storageDirectory });
  const first = await connect(before, ROOM);
  first.document.getText('body').insert(0, 'Signed by both parties.');
  await waitFor(() => before.server.getDocumentsCount() === 1, 'the room to load');
  first.leave();
  await waitFor(() => before.server.getDocumentsCount() === 0, 'the room to unload');
  await before.server.destroy();

  const after = await startServer(t, { storageDirectory });
  const second = await connect(after, ROOM);
  assert.equal(second.document.getText('body').toString(), 'Signed by both parties.');
});

test('clients that rejoin while the last write is still running share one room and keep their edits', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  let releaseFirstWrite = () => {};
  const firstWriteHeld = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
  let writes = 0;
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    async store(roomName, state) {
      writes += 1;
      if (writes === 1) await firstWriteHeld;
      await fileStore.store(roomName, state);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });
  const text = (client: Client) => client.document.getText('body').toString();

  const first = await connect(running, ROOM);
  first.document.getText('body').insert(0, 'Latest edit.');
  await waitFor(() => writes === 1, 'the write to start');
  first.leave();
  await waitFor(() => running.server.getConnectionsCount() === 0, 'the first client to leave');

  const joining = open(running, ROOM, { waitMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  releaseFirstWrite();
  const second = await joining;
  assert.equal(second.outcome, 'synced');
  assert.equal(text(second), 'Latest edit.');
  await firstWriteHeld;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(running.server.getDocumentsCount(), 1, 'the rejoined room stays mapped');

  const third = await connect(running, ROOM);
  second.document.getText('body').insert(0, 'Second client edit. ');
  await waitFor(() => text(third) === 'Second client edit. Latest edit.', 'the second edit to reach the third client');
  third.document.getText('body').insert(text(third).length, ' Third client edit.');
  const expected = 'Second client edit. Latest edit. Third client edit.';
  await waitFor(() => text(second) === expected, 'the third edit to reach the second client');
  assert.equal(running.server.getDocumentsCount(), 1);

  second.leave();
  third.leave();
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  const reloaded = await connect(running, ROOM);
  assert.equal(text(reloaded), expected);
});

test('a room stays mapped until writes queued while it was unloading have finished', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  const releases: Array<() => void> = [];
  let writes = 0;
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    async store(roomName, state) {
      writes += 1;
      if (writes <= 2) await new Promise<void>((resolve) => releases.push(resolve));
      await fileStore.store(roomName, state);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });
  const text = (client: Client) => client.document.getText('body').toString();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  const first = await connect(running, ROOM);
  first.document.getText('body').insert(0, 'First edit.');
  await waitFor(() => writes === 1, 'the first write to start');
  first.leave();
  await waitFor(() => running.server.getConnectionsCount() === 0, 'the first client to leave');

  const second = await connect(running, ROOM);
  assert.equal(text(second), 'First edit.');
  second.document.getText('body').insert(0, 'Second edit. ');
  await settle();
  second.leave();
  await waitFor(() => running.server.getConnectionsCount() === 0, 'the second client to leave');

  releases[0]();
  await waitFor(() => writes === 2, 'the second write to start');
  await settle();
  assert.equal(running.server.getDocumentsCount(), 1, 'the room stays mapped while the second write runs');

  const third = await connect(running, ROOM);
  assert.equal(text(third), 'Second edit. First edit.');

  releases[1]();
  await settle();
  assert.equal(running.server.getDocumentsCount(), 1, 'the second write does not evict the room');
  const fourth = await connect(running, ROOM);
  fourth.document.getText('body').insert(0, 'Fourth edit. ');
  const expected = 'Fourth edit. Second edit. First edit.';
  await waitFor(() => text(third) === expected, 'the fourth edit to reach the third client');

  third.leave();
  fourth.leave();
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  const reloaded = await connect(running, ROOM);
  assert.equal(text(reloaded), expected);
});

test('the server leaves SIGINT and SIGTERM to server.ts, so shutdown can save first', async (t) => {
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const before = signals.map((signal) => process.listenerCount(signal));
  await startServer(t, { storageDirectory: await tempDirectory(t) });
  assert.deepEqual(
    signals.map((signal) => process.listenerCount(signal)),
    before,
  );
});
