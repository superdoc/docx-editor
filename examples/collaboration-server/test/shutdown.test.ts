import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDocxAutosave } from '../src/docx/autosave.ts';
import { connect, open, startServer, waitFor, type TestServer } from './helpers.ts';

const ROOM = 'sd2/v2.1/contract-42';

test('shutdown freezes editors, refuses pending and new joins, and saves before stopping the server', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-shutdown-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let releaseSave = () => {};
  const heldSave = new Promise<void>((resolve) => (releaseSave = resolve));
  t.after(releaseSave);
  let releaseAuthorization = () => {};
  const heldAuthorization = new Promise<void>((resolve) => (releaseAuthorization = resolve));
  t.after(releaseAuthorization);
  let authorizing = false;
  let saving = false;
  let disposed = 0;
  let running: TestServer;
  const saved: string[] = [];
  const autosave = createDocxAutosave({
    serverUrl: 'ws://127.0.0.1:1234',
    idleMs: 60_000,
    createClient: () => ({
      async open({ collaboration }) {
        const client = await connect(running, ROOM, { token: 'autosave', parameters: collaboration.params });
        const snapshot = client.document.getText('body').toString();
        return {
          async save({ out }) {
            saving = true;
            await heldSave;
            await writeFile(out, snapshot);
          },
          async close() {
            client.leave();
          },
        };
      },
      async dispose() {
        disposed += 1;
      },
    }),
    docxStore: {
      async put(_documentId, bytes) {
        saved.push(Buffer.from(bytes).toString());
      },
    },
    log() {},
  });
  running = await startServer(t, {
    storageDirectory: directory,
    docxAutosave: autosave,
    async authorize({ token }) {
      if (token === 'pending') {
        authorizing = true;
        await heldAuthorization;
      }
      return { userId: token };
    },
  });
  const writer = await connect(running, ROOM, { token: 'writer' });
  writer.document.getText('body').insert(0, 'Acknowledged before shutdown.');
  await waitFor(() => writer.pendingChanges() === 0, 'the edit acknowledgement');
  assert.equal(running.server.documents.get(ROOM)?.getText('body').toString(), 'Acknowledged before shutdown.');

  const pendingJoin = open(running, ROOM, { token: 'pending' });
  await waitFor(() => authorizing, 'pending authorization');
  const stopping = running.server.stop();
  assert.equal(running.server.stop(), stopping, 'repeated shutdown calls share one drain');
  await waitFor(() => saving, 'the internal autosave to join and start saving');

  releaseAuthorization();
  assert.equal((await pendingJoin).outcome, 'denied', 'authorization completing during shutdown is refused');
  assert.equal((await open(running, ROOM, { token: 'late' })).outcome, 'denied');
  assert.equal(
    (await open(running, ROOM, { token: 'late', parameters: { superdocAutosave: 'a-guess' } })).outcome,
    'denied',
  );
  writer.document.getText('body').insert(writer.document.getText('body').length, ' Too late.');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(running.server.documents.get(ROOM)?.getText('body').toString(), 'Acknowledged before shutdown.');
  assert.ok(writer.pendingChanges() > 0, 'the late edit is never acknowledged');
  assert.equal(disposed, 0, 'the server stays available to the saving client');

  releaseSave();
  await stopping;
  assert.deepEqual(saved, ['Acknowledged before shutdown.']);
  assert.equal(disposed, 1);
  assert.equal(running.server.getConnectionsCount(), 0);

  const restarted = await startServer(t, { storageDirectory: directory });
  const reloaded = await connect(restarted, ROOM);
  assert.equal(reloaded.document.getText('body').toString(), saved[0]);
});

test('a failed shutdown export still persists acknowledged room state and closes the server', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-shutdown-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let attempts = 0;
  const autosave = createDocxAutosave({
    serverUrl: 'ws://127.0.0.1:1234',
    idleMs: 60_000,
    retries: 1,
    retryDelayMs: 1,
    createClient: () => ({
      async open() {
        attempts += 1;
        throw new Error('Export unavailable.');
      },
      async dispose() {},
    }),
    docxStore: { async put() {} },
    log() {},
  });
  const running = await startServer(t, { storageDirectory: directory, docxAutosave: autosave });
  const writer = await connect(running, ROOM);
  writer.document.getText('body').insert(0, 'Retain this acknowledged edit.');
  await waitFor(() => writer.pendingChanges() === 0, 'the edit acknowledgement');
  await assert.rejects(running.server.stop(), /contract-42/);
  assert.equal(attempts, 2, 'failed exports have bounded retries');
  assert.equal(running.server.getConnectionsCount(), 0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(attempts, 2, 'disconnecting editors does not restart a stopped autosave');

  const restarted = await startServer(t, { storageDirectory: directory });
  const reloaded = await connect(restarted, ROOM);
  assert.equal(reloaded.document.getText('body').toString(), 'Retain this acknowledged edit.');
});
