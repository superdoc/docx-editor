import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRoomFiles } from '../src/server/room-files.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

test('loading a room waits for a write that is still in progress', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'room-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let holdNextWrite = false;
  let release = () => {};
  let writeStarted = () => {};
  const started = new Promise<void>((resolve) => (writeStarted = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const rooms = createRoomFiles(directory, {
    async writeFile(file, bytes) {
      if (holdNextWrite) {
        writeStarted();
        await held;
      }
      await writeFile(file, bytes);
    },
  });

  await rooms.store('contract', encode('old draft'));
  holdNextWrite = true;
  const storing = rooms.store('contract', encode('final edit'));
  await started;
  let loaded: string | null | undefined;
  const loading = rooms.load('contract').then((bytes) => (loaded = decode(bytes)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(loaded, undefined);

  release();
  await Promise.all([storing, loading]);
  assert.equal(loaded, 'final edit');
});

test('a room that was never stored loads as empty', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'room-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await createRoomFiles(directory).load('contract'), null);
});
