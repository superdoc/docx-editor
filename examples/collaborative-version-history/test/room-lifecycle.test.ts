import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Doc } from 'yjs';
import { createVersionServer } from '../src/server/create-server.ts';

const ROOM = 'contract-room';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('expected a TCP address');
  return address.port;
}

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connect(url: string) {
  const document = new Doc();
  let synced = false;
  const provider = new HocuspocusProvider({ url, name: ROOM, document, onSynced: () => (synced = true) });
  const text = () => document.getText('body').toString();
  return { provider, document, text, synced: () => until(() => synced, 'provider sync') };
}

test('a rejoin during an old room\'s pending save keeps one shared room', async (t) => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'room-lifecycle-'));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  let holdNextWrite = false;
  let writeStarted = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const port = await freePort();
  const server = createVersionServer({
    port,
    host: '127.0.0.1',
    dataDirectory,
    sourceDocx: path.join(dataDirectory, 'unused.docx'),
    checkpoints: { idleMs: null, maxIntervalMs: null, whenLastEditorLeaves: false },
    debounceMs: 0,
    roomFileSystem: {
      async writeFile(file, bytes) {
        if (holdNextWrite) {
          holdNextWrite = false;
          writeStarted = true;
          await held;
        }
        await writeFile(file, bytes);
      },
    },
  });
  await server.listen();
  const providers: HocuspocusProvider[] = [];
  t.after(async () => {
    release();
    for (const provider of providers) provider.destroy();
    await server.stop();
  });

  const first = connect(server.url);
  providers.push(first.provider);
  await first.synced();
  first.document.getText('body').insert(0, 'old draft');
  await until(() => server.hocuspocus.documents.get(ROOM)?.getText('body').toString() === 'old draft', 'old draft on server');
  await new Promise((resolve) => setTimeout(resolve, 100));

  holdNextWrite = true;
  first.document.getText('body').insert(0, 'final edit ');
  await until(() => writeStarted, 'the final save to start');
  first.provider.destroy();
  await until(() => !server.hocuspocus.documents.has(ROOM), 'the old room to unload');

  const rejoined = connect(server.url);
  providers.push(rejoined.provider);
  await until(() => server.hocuspocus.documents.has(ROOM), 'the replacement room to register');
  const replacement = server.hocuspocus.documents.get(ROOM);

  release();
  await rejoined.synced();
  await until(() => rejoined.text() === 'final edit old draft', 'the rejoiner to load the final save');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.hocuspocus.documents.get(ROOM), replacement);

  const third = connect(server.url);
  providers.push(third.provider);
  await third.synced();
  rejoined.document.getText('body').insert(0, 'second-only ');
  await until(() => third.text() === 'second-only final edit old draft', 'the third peer to receive the rejoiner\'s edit');
});
