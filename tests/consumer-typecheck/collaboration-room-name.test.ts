import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { resolveCollaborationRoomName } from 'superdoc/collaboration';

const require = createRequire(import.meta.url);
const commonjs: unknown = require('superdoc/collaboration');

test('browser-compatible ESM and server CommonJS resolve the same persisted keys without DOM globals', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof commonjs, 'object');
  if (commonjs === null || typeof commonjs !== 'object') throw new Error('CommonJS resolver export missing');
  const resolveCommonjs: unknown = Reflect.get(commonjs, 'resolveCollaborationRoomName');
  assert.equal(typeof resolveCommonjs, 'function');
  if (typeof resolveCommonjs !== 'function') throw new Error('CommonJS resolver export missing');
  for (const documentId of ['doc-42', 'tenant:other_doc@2.0']) {
    assert.equal(resolveCollaborationRoomName(documentId), `sd2/v2.1/${documentId}`);
    assert.equal(resolveCommonjs(documentId), resolveCollaborationRoomName(documentId));
  }
  for (const documentId of ['', 'x'.repeat(201), '/word/document.xml', 'https://example.test/doc', 'sd1/legacy']) {
    assert.throws(() => resolveCollaborationRoomName(documentId), { code: 'COLLAB_V2_ROOM_NAME_INVALID' });
    assert.throws(() => resolveCommonjs(documentId), { code: 'COLLAB_V2_ROOM_NAME_INVALID' });
  }
});
