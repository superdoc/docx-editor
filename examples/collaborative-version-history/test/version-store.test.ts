import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StaleHeadError, createFileVersionStore } from '../src/server/version-store.ts';

const docx = (text: string) => new TextEncoder().encode(text);

async function tempStore(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'version-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createFileVersionStore(directory, () => new Date('2026-11-04T12:00:00Z')) };
}

test('versions get server-assigned ids and keep their exact bytes', async (t) => {
  const { store } = await tempStore(t);
  const first = await store.append('contract', { docx: docx('one'), label: 'First', trigger: 'named', createdBy: 'Ann' }, null);
  const second = await store.append('contract', { docx: docx('two'), label: 'Second', trigger: 'idle', createdBy: 'Autosave' }, 'v1');

  assert.equal(first.id, 'v1');
  assert.equal(second.id, 'v2');
  assert.equal(second.createdAt, '2026-11-04T12:00:00.000Z');
  assert.deepEqual(await store.read('contract', 'v1'), docx('one'));
  assert.deepEqual(await store.read('contract', 'v2'), docx('two'));
  assert.equal(await store.read('contract', 'v3'), null);
  assert.deepEqual(await store.list('other'), []);
});

test('an append based on an old head is refused and changes nothing', async (t) => {
  const { store } = await tempStore(t);
  await store.append('contract', { docx: docx('one'), label: 'First', trigger: 'named', createdBy: 'Ann' }, null);
  await store.append('contract', { docx: docx('two'), label: 'Second', trigger: 'named', createdBy: 'Ben' }, 'v1');

  await assert.rejects(
    store.append('contract', { docx: docx('late'), label: 'Late', trigger: 'named', createdBy: 'Ann' }, 'v1'),
    (error: unknown) => error instanceof StaleHeadError && error.actualHead === 'v2',
  );
  await assert.rejects(
    store.append('contract', { docx: docx('late'), label: 'Late', trigger: 'named', createdBy: 'Ann' }, null),
    StaleHeadError,
  );
  assert.deepEqual((await store.list('contract')).map((version) => version.id), ['v1', 'v2']);
});

test('versions survive a new store instance on the same directory', async (t) => {
  const { directory, store } = await tempStore(t);
  const saved = await store.append('contract', { docx: docx('kept'), label: 'Kept', trigger: 'named', createdBy: 'Ann' }, null);

  const reopened = createFileVersionStore(directory);
  assert.deepEqual(await reopened.list('contract'), [saved]);
  assert.deepEqual(await reopened.read('contract', 'v1'), docx('kept'));
});
