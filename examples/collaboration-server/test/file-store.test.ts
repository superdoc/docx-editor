import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createFileDocxStore } from '../src/storage/file-docx.ts';
import { createFileRoomStore } from '../src/storage/file.ts';

async function tempDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a room that was never stored loads as null', async (t) => {
  const store = createFileRoomStore(await tempDirectory(t));
  assert.equal(await store.load('sd2/v2.1/missing'), null);
});

test('stored state loads back unchanged, and a later store replaces it', async (t) => {
  const store = createFileRoomStore(await tempDirectory(t));
  await store.store('sd2/v2.1/contract-42', new Uint8Array([1, 2, 3]));
  assert.deepEqual(await store.load('sd2/v2.1/contract-42'), new Uint8Array([1, 2, 3]));

  await store.store('sd2/v2.1/contract-42', new Uint8Array([4, 5]));
  assert.deepEqual(await store.load('sd2/v2.1/contract-42'), new Uint8Array([4, 5]));
});

test('room names cannot escape the storage directory', async (t) => {
  const root = await tempDirectory(t);
  const directory = path.join(root, 'rooms');
  const store = createFileRoomStore(directory);
  await store.store('../../outside', new Uint8Array([9]));

  assert.deepEqual(await readdir(root), ['rooms']);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^[0-9a-f]{64}\.yjs$/);
  assert.deepEqual(await store.load('../../outside'), new Uint8Array([9]));
});

test('the storage directory is created on first store', async (t) => {
  const directory = path.join(await tempDirectory(t), 'not', 'yet', 'there');
  const store = createFileRoomStore(directory);
  await store.store('room', new Uint8Array([1]));
  assert.equal((await readdir(directory)).length, 1);
});

test('the DOCX store keeps the latest file per document under a readable, contained name', async (t) => {
  const root = await tempDirectory(t);
  const directory = path.join(root, 'docx');
  const store = createFileDocxStore(directory);
  await store.put('contract-42', new Uint8Array([1]));
  await store.put('contract-42', new Uint8Array([2]));
  await store.put('../team/contract 7', new Uint8Array([3]));

  assert.deepEqual(await readdir(root), ['docx']);
  assert.deepEqual((await readdir(directory)).sort(), ['..%2Fteam%2Fcontract%207.docx', 'contract-42.docx']);
  assert.deepEqual(new Uint8Array(await readFile(path.join(directory, 'contract-42.docx'))), new Uint8Array([2]));
});
