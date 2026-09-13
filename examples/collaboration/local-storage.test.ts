import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Doc } from 'yjs';
import { localStorage } from './local-storage';

test('stores binary state and restores it without treating room names as paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superdoc-storage-test-'));
  const original = new Doc();
  const restored = new Doc();
  try {
    const storage = localStorage(directory);
    const documentName = '../../outside/room';
    await storage.onLoadDocument({ document: original, documentName });
    assert.deepEqual(readdirSync(directory), []);
    original.getText('body').insert(0, 'Saved text');
    await storage.onStoreDocument({ document: original, documentName });
    assert.match(readdirSync(directory)[0], /^[a-f0-9]{64}\.yjs$/);
    await localStorage(directory).onLoadDocument({ document: restored, documentName });
    assert.equal(restored.getText('body').toString(), 'Saved text');
    const file = join(directory, readdirSync(directory)[0]);
    writeFileSync(file, new Uint8Array([255]));
    await assert.rejects(storage.onLoadDocument({ document: restored, documentName }));
    assert.equal(restored.getText('body').toString(), 'Saved text');
  } finally {
    original.destroy();
    restored.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});
