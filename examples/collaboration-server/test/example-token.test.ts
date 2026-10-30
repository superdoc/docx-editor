import assert from 'node:assert/strict';
import test from 'node:test';
import { createExampleAuthorize, signExampleToken, verifyExampleToken } from '../src/auth/example-token.ts';
import { documentIdFromRoomName } from '../src/room-name.ts';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const inAMinute = () => Math.floor(Date.now() / 1000) + 60;

test('room names map to SuperDoc document IDs', () => {
  assert.equal(documentIdFromRoomName('sd2/v2.1/contract-42'), 'contract-42');
  assert.equal(documentIdFromRoomName('sd2/v3/contract-42'), 'contract-42', 'a later protocol version');
  assert.equal(documentIdFromRoomName('sd2/v2.1/team/contract-42'), 'team/contract-42');
  assert.equal(documentIdFromRoomName('contract-42'), null);
  assert.equal(documentIdFromRoomName('sd2/v2.1/'), null);
});

test('a signed token verifies back to its claims', () => {
  const claims = { sub: 'alice', documents: ['contract-42'], readOnly: false, exp: inAMinute() };
  assert.deepEqual(verifyExampleToken(SECRET, signExampleToken(SECRET, claims)), claims);
});

test('tampered, expired and malformed tokens do not verify', () => {
  const valid = signExampleToken(SECRET, { sub: 'alice', documents: ['contract-42'], exp: inAMinute() });
  const [header, , signature] = valid.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'alice', documents: '*', exp: inAMinute() })).toString('base64url');

  assert.equal(verifyExampleToken(SECRET, `${header}.${forgedBody}.${signature}`), null, 'changed claims');
  assert.equal(verifyExampleToken('another-secret-of-at-least-32-characters', valid), null, 'other secret');
  assert.equal(
    verifyExampleToken(SECRET, signExampleToken(SECRET, { sub: 'alice', documents: ['contract-42'], exp: 1 })),
    null,
    'expired',
  );
  assert.equal(verifyExampleToken(SECRET, 'not.a.token'), null, 'garbage');
  assert.equal(verifyExampleToken(SECRET, ''), null, 'empty');
});

test('the example check admits only listed documents', async () => {
  const authorize = createExampleAuthorize(SECRET);
  const request = (documents: string[] | '*', documentId: string | null, readOnly = false) => ({
    token: signExampleToken(SECRET, { sub: 'alice', documents, readOnly, exp: inAMinute() }),
    roomName: `sd2/v2.1/${documentId}`,
    documentId,
  });

  assert.deepEqual(await authorize(request(['contract-42'], 'contract-42')), { userId: 'alice', readOnly: false });
  assert.deepEqual(await authorize(request('*', 'anything', true)), { userId: 'alice', readOnly: true });
  assert.equal(await authorize(request(['contract-42'], 'contract-43')), null);
  assert.equal(await authorize(request('*', null)), null, 'not a SuperDoc room');
});
