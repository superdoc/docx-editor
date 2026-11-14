import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { DocxAutosave } from '../src/docx/autosave.ts';
import type { Authorize } from '../src/auth/types.ts';
import { createFileRoomStore } from '../src/storage/file.ts';
import type { RoomStore } from '../src/storage/types.ts';
import { Doc } from 'yjs';
import { type Client, connect, open, startServer, waitFor } from './helpers.ts';

const ROOM = 'sd2/v2.1/reset-room';
const OTHER_ROOM = 'sd2/v2.1/other-room';

async function tempDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const text = (client: Client) => client.document.getText('body').toString();
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

async function storedRoom(t: TestContext, words: string) {
  const storageDirectory = await tempDirectory(t);
  const running = await startServer(t, { storageDirectory });
  const writer = await connect(running, ROOM);
  writer.document.getText('body').insert(0, words);
  writer.leave();
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  return { storageDirectory, running };
}

test('deleting a stored room removes it from storage, and the next client starts empty', async (t) => {
  const { storageDirectory, running } = await storedRoom(t, 'Old terms.');
  assert.equal((await readdir(storageDirectory)).length, 1);

  await running.server.deleteRoom(ROOM);

  assert.deepEqual(await readdir(storageDirectory), []);
  const next = await connect(running, ROOM);
  assert.equal(text(next), '');
});

test('deleting a live room closes its clients as refused, and their edits do not come back', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const running = await startServer(t, { storageDirectory });
  const alice = await connect(running, ROOM);
  const bob = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Draft that must go. ');
  await waitFor(() => text(bob) === 'Draft that must go. ', 'the edit to reach Bob');

  await running.server.deleteRoom(ROOM);

  assert.equal(alice.closeCode(), 4403);
  assert.equal(bob.closeCode(), 4403);
  assert.equal(running.server.getDocumentsCount(), 0);
  bob.document.getText('body').insert(0, 'Typed after the delete. ');
  await settle();
  assert.deepEqual(await readdir(storageDirectory), [], 'no write recreated the room');

  const fresh = await connect(running, ROOM);
  await settle();
  assert.equal(text(fresh), '');
});

test('a scheduled write that fires after the delete does not recreate the room', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const running = await startServer(t, { storageDirectory });
  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Unsaved edit.');
  await settle(10);

  await running.server.deleteRoom(ROOM);
  await settle();

  assert.deepEqual(await readdir(storageDirectory), []);
});

test('a delete waits for a running write, then removes what it wrote', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  let releaseWrite = () => {};
  const writeHeld = new Promise<void>((resolve) => (releaseWrite = resolve));
  let writes = 0;
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    delete: (roomName) => fileStore.delete(roomName),
    async store(roomName, state) {
      writes += 1;
      await writeHeld;
      await fileStore.store(roomName, state);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });
  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Being written.');
  await waitFor(() => writes === 1, 'the write to start');

  let deleted = false;
  const deletion = running.server.deleteRoom(ROOM).then(() => (deleted = true));
  await settle();
  assert.equal(deleted, false, 'the delete waits for the write');

  releaseWrite();
  await deletion;
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('clients that try to join while a room is being deleted are refused', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  let releaseDelete = () => {};
  const deleteHeld = new Promise<void>((resolve) => (releaseDelete = resolve));
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    store: (roomName, state) => fileStore.store(roomName, state),
    async delete(roomName) {
      await deleteHeld;
      await fileStore.delete(roomName);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });
  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Old terms.');

  const deletion = running.server.deleteRoom(ROOM);
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  const late = await open(running, ROOM);
  assert.equal(late.outcome, 'denied');
  const elsewhere = await connect(running, OTHER_ROOM);
  assert.equal(text(elsewhere), '', 'other rooms stay open');

  releaseDelete();
  await deletion;
  assert.equal(text(await connect(running, ROOM)), '');
});

test('deleting a room disconnects its direct connections instead of waiting for them', { timeout: 10_000 }, async (t) => {
  const storageDirectory = await tempDirectory(t);
  const running = await startServer(t, { storageDirectory });
  const direct = await running.server.openDirectConnection(ROOM);
  await direct.transact((document) => document.getText('body').insert(0, 'Server draft.'));

  await running.server.deleteRoom(ROOM);

  assert.equal(running.server.getDocumentsCount(), 0);
  assert.deepEqual(await readdir(storageDirectory), [], 'the direct connection did not store the room again');
  await assert.rejects(direct.transact(() => {}), /direct connection closed/);
  assert.equal(text(await connect(running, ROOM)), '');
});

test('direct connections are refused while a room is being deleted', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  let releaseDelete = () => {};
  const deleteHeld = new Promise<void>((resolve) => (releaseDelete = resolve));
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    store: (roomName, state) => fileStore.store(roomName, state),
    async delete(roomName) {
      await deleteHeld;
      await fileStore.delete(roomName);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });

  const deletion = running.server.deleteRoom(ROOM);
  await assert.rejects(running.server.openDirectConnection(ROOM), /Room is being deleted/);

  releaseDelete();
  await deletion;
  const after = await running.server.openDirectConnection(ROOM);
  await after.disconnect();
});

test('a client still being authorized when its room is deleted cannot bring the room back', async (t) => {
  const storageDirectory = await tempDirectory(t);
  let holdNextAuthorization = false;
  let authorizationHeld = false;
  let releaseAuthorization = () => {};
  const authorize: Authorize = async () => {
    if (holdNextAuthorization) {
      holdNextAuthorization = false;
      authorizationHeld = true;
      await new Promise<void>((resolve) => (releaseAuthorization = resolve));
    }
    return { userId: 'editor' };
  };
  const running = await startServer(t, { storageDirectory, authorize });
  const writer = await connect(running, ROOM, { token: 'token' });
  writer.document.getText('body').insert(0, 'Old terms.');
  await waitFor(() => writer.pendingChanges() === 0, 'the edit to reach the server');

  const offline = new Doc();
  offline.getText('body').insert(0, 'Stale copy. ');
  holdNextAuthorization = true;
  const stale = open(running, ROOM, { token: 'token', document: offline, waitMs: 10_000 });
  await waitFor(() => authorizationHeld, 'the late client to reach authorization');

  await running.server.deleteRoom(ROOM);
  assert.equal(running.server.getDocumentsCount(), 0);
  assert.deepEqual(await readdir(storageDirectory), []);

  releaseAuthorization();
  const late = await stale;
  assert.notEqual(late.outcome, 'synced', 'the stale client is refused');
  await settle();
  assert.equal(running.server.getDocumentsCount(), 0, 'no live room came back');
  assert.deepEqual(await readdir(storageDirectory), [], 'no stored room came back');
  assert.equal(text(await connect(running, ROOM, { token: 'token' })), '');
});

test('calling delete twice for the same room runs one deletion', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const fileStore = createFileRoomStore(storageDirectory);
  let deletes = 0;
  const roomStore: RoomStore = {
    load: (roomName) => fileStore.load(roomName),
    store: (roomName, state) => fileStore.store(roomName, state),
    async delete(roomName) {
      deletes += 1;
      await settle(50);
      await fileStore.delete(roomName);
    },
  };
  const running = await startServer(t, { storageDirectory, roomStore });

  await Promise.all([running.server.deleteRoom(ROOM), running.server.deleteRoom(ROOM)]);
  assert.equal(deletes, 1);
});

test('a deleted room stays deleted after a server restart, and can then be filled again', async (t) => {
  const { storageDirectory, running } = await storedRoom(t, 'Old terms.');
  await running.server.deleteRoom(ROOM);
  await running.server.destroy();

  const restarted = await startServer(t, { storageDirectory });
  const reseeder = await connect(restarted, ROOM);
  assert.equal(text(reseeder), '');
  reseeder.document.getText('body').insert(0, 'New terms.');
  reseeder.leave();
  await waitFor(() => restarted.server.getDocumentsCount() === 0, 'the room to unload');

  assert.equal(text(await connect(restarted, ROOM)), 'New terms.');
});

test('deleting a room cancels its pending DOCX autosave', async (t) => {
  const storageDirectory = await tempDirectory(t);
  const events = { changed: [] as string[], emptied: [] as string[], deleted: [] as string[] };
  const docxAutosave: DocxAutosave = {
    marker: { name: 'superdocAutosave', value: 'the-marker' },
    roomChanged: (room) => events.changed.push(room),
    roomEmptied: (room) => events.emptied.push(room),
    roomDeleted: (room) => events.deleted.push(room),
    flush: async () => {},
    stop: async () => {},
  };
  const running = await startServer(t, { storageDirectory, docxAutosave });
  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Draft.');
  await waitFor(() => events.changed.length > 0, 'the change report');

  await running.server.deleteRoom(ROOM);

  assert.deepEqual(events.deleted, [ROOM]);
  assert.deepEqual(events.emptied, [], 'a deleted room is not reported as emptied');
});
