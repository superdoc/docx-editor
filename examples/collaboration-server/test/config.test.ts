import assert from 'node:assert/strict';
import test from 'node:test';
import { autosaveUrl, loadConfig, websocketUrl } from '../src/config.ts';

const SECRET = 'test-secret-that-is-at-least-32-characters';

test('defaults to loopback, local storage, token checks and DOCX autosave', () => {
  assert.deepEqual(loadConfig({ COLLABORATION_AUTH_SECRET: SECRET }), {
    port: 1234,
    host: '127.0.0.1',
    storageDirectory: './collaboration-data',
    auth: { mode: 'example-token', secret: SECRET },
    docx: { mode: 'autosave', directory: './collaboration-docx', idleMs: 10000 },
  });
});

test('DOCX autosave can be tuned or turned off', () => {
  const base = { COLLABORATION_AUTH: 'none' };
  assert.deepEqual(loadConfig({ ...base, COLLABORATION_DOCX: 'off' }).docx, { mode: 'off' });
  assert.deepEqual(loadConfig({ ...base, COLLABORATION_DOCX_DIR: '/data/docx', COLLABORATION_DOCX_IDLE_MS: '3000' }).docx, {
    mode: 'autosave',
    directory: '/data/docx',
    idleMs: 3000,
  });
  assert.throws(() => loadConfig({ ...base, COLLABORATION_DOCX: 'sometimes' }), /"autosave" or "off"/);
  assert.throws(() => loadConfig({ ...base, COLLABORATION_DOCX_IDLE_MS: 'soon' }), /COLLABORATION_DOCX_IDLE_MS/);
});

test('refuses to start with token checks but no usable secret', () => {
  assert.throws(() => loadConfig({}), /COLLABORATION_AUTH_SECRET/);
  assert.throws(() => loadConfig({ COLLABORATION_AUTH_SECRET: 'too-short' }), /at least 32 characters/);
});

test('access checks turn off only when asked explicitly', () => {
  assert.deepEqual(loadConfig({ COLLABORATION_AUTH: 'none' }).auth, { mode: 'none' });
  assert.throws(() => loadConfig({ COLLABORATION_AUTH: 'off' }), /"example-token" or "none"/);
});

test('rejects an invalid port', () => {
  assert.throws(() => loadConfig({ PORT: '0', COLLABORATION_AUTH: 'none' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: 'http', COLLABORATION_AUTH: 'none' }), /PORT/);
});

test('the autosave connects to loopback in the address family the server listens on', () => {
  assert.equal(autosaveUrl({ host: '127.0.0.1', port: 1234 }), 'ws://127.0.0.1:1234');
  assert.equal(autosaveUrl({ host: '0.0.0.0', port: 1234 }), 'ws://127.0.0.1:1234');
  assert.equal(autosaveUrl({ host: '::1', port: 1234 }), 'ws://[::1]:1234');
  assert.equal(autosaveUrl({ host: '::', port: 1234 }), 'ws://[::1]:1234');
  assert.equal(autosaveUrl({ host: 'collab.internal', port: 1234 }), 'ws://collab.internal:1234');
  assert.doesNotThrow(() => new URL(websocketUrl('::1', 1234)));
});
