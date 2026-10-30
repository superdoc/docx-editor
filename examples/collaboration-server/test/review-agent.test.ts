import assert from 'node:assert/strict';
import test from 'node:test';
import {
  joinAsAgent,
  REVIEW_AGENT,
  TextNotFoundError,
  type AgentClient,
  type AgentDocument,
  type AgentIdentity,
  type TrackedChangeItem,
} from '../src/agent/review-agent.ts';

type FakeRoom = {
  text: string;
  openChanges: TrackedChangeItem[];
  replaceRefs?: string[];
  flatReceipt?: boolean;
  failClose?: boolean;
  failOpen?: boolean;
  revision?: number;
  editsAfterMatch?: number;
  replaceFailure?: string;
};

function fakeAgentSdk(room: FakeRoom) {
  const calls: string[] = [];
  const identities: AgentIdentity[] = [];
  const opens: Array<{ roomMode: string; documentId: string; token?: string }> = [];
  const replaces: Array<Parameters<AgentDocument['replace']>[0]> = [];

  const document: AgentDocument = {
    async getText() {
      return room.text;
    },
    async info() {
      return { revision: String(room.revision ?? 1) };
    },
    query: {
      async match({ select }) {
        calls.push(`match:${select.pattern}`);
        if (!room.text.includes(select.pattern)) {
          throw Object.assign(new Error('selector matched zero ranges.'), { code: 'MATCH_NOT_FOUND' });
        }
        if (room.editsAfterMatch) {
          room.editsAfterMatch -= 1;
          room.revision = (room.revision ?? 1) + 1;
        }
        return { items: [{ matchKind: 'text', target: paragraphTarget }] };
      },
    },
    async replace(params) {
      replaces.push(params);
      if (params.expectedRevision !== String(room.revision ?? 1)) {
        return { receipt: { success: false, failure: { code: 'REVISION_MISMATCH' } } };
      }
      if (room.replaceFailure) return { receipt: { success: false, failure: { code: room.replaceFailure } } };
      const refs = room.replaceRefs ?? ['tc-insert', 'tc-replace'];
      if (refs.length > 0) room.openChanges.push({ id: 'tc-group', reviewGroup: { childChangeIds: refs } });
      if (room.flatReceipt) return { trackedChangeRefs: refs.map((entityId) => ({ entityId })), txId: 'tx-1' };
      const inserted = refs.map((entityId) => ({ kind: 'entity', entityType: 'trackedChange', entityId }));
      return { receipt: { inserted, txId: 'tx-1' } };
    },
    trackChanges: {
      async list({ offset, limit }) {
        return { items: room.openChanges.slice(offset, offset + limit) };
      },
    },
    async close(params) {
      calls.push(`close:${params?.discard}`);
      if (room.failClose) throw new Error('close failed');
    },
  };

  const createClient = (identity: AgentIdentity): AgentClient => {
    identities.push(identity);
    return {
      async open(params, options) {
        const { roomMode, documentId } = params.collaboration;
        opens.push({ roomMode, documentId, token: options?.collaborationAuth.token });
        if (room.failOpen) throw new Error('access denied');
        return document;
      },
      async dispose() {
        calls.push('dispose');
      },
    };
  };

  return { calls, identities, opens, replaces, createClient };
}

const paragraphTarget = { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } as const;

const join = { serverUrl: 'ws://127.0.0.1:1234', documentId: 'contract-42', token: 'agent-token' };

test('the agent joins an existing room under its own identity with its token', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  assert.deepEqual(sdk.identities, [REVIEW_AGENT]);
  assert.deepEqual(sdk.opens, [{ roomMode: 'join', documentId: 'contract-42', token: 'agent-token' }]);
  assert.equal(await agent.text(), 'Payment is due in thirty days.');
});

test('a refused join disposes the client and surfaces the error', async () => {
  const sdk = fakeAgentSdk({ text: '', openChanges: [], failOpen: true });
  await assert.rejects(joinAsAgent({ ...join, createClient: sdk.createClient }), /access denied/);
  assert.deepEqual(sdk.calls, ['dispose']);
});

test('a suggestion is a tracked replacement, and its receipt names the tracked change', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  assert.deepEqual(sdk.replaces, [
    { target: paragraphTarget, text: 'forty-five days', changeMode: 'tracked', expectedRevision: '1' },
  ]);
  assert.deepEqual(suggestion, {
    find: 'thirty days',
    replacement: 'forty-five days',
    trackedChangeIds: ['tc-insert', 'tc-replace'],
    txId: 'tx-1',
  });
});

test('text that is not in the document changes nothing', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('sixty days', 'ninety days'), TextNotFoundError);
  assert.deepEqual(sdk.replaces, []);
});

test('a replacement that makes no tracked change is reported, not treated as a suggestion', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [], replaceRefs: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('thirty days', 'forty-five days'), /no tracked change/);
});

test('an empty find or replacement is refused before anything is changed', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('thirty days', ''), /non-empty replacement/);
  await assert.rejects(agent.suggest('', 'forty-five days'), /non-empty replacement/);
  assert.deepEqual(sdk.replaces, []);
});

test('the agent learns that an editor decided on its suggestion', async () => {
  const room: FakeRoom = { text: 'Payment is due in thirty days.', openChanges: [] };
  const sdk = fakeAgentSdk(room);
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });
  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  setTimeout(() => {
    room.openChanges = [];
  }, 20);

  assert.equal(await agent.waitForDecision(suggestion, { pollMs: 5, timeoutMs: 1_000 }), 'resolved');
});

test('an undecided suggestion stays pending when the wait times out or is cancelled', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });
  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  assert.equal(await agent.waitForDecision(suggestion, { pollMs: 5, timeoutMs: 30 }), 'pending');

  const cancelled = new AbortController();
  setTimeout(() => cancelled.abort(), 20);
  assert.equal(
    await agent.waitForDecision(suggestion, { pollMs: 5, timeoutMs: 60_000, signal: cancelled.signal }),
    'pending',
  );
});

test('leaving closes the document without saving a local copy, then shuts down the engine, once', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await Promise.all([agent.leave(), agent.leave()]);
  await agent.leave();

  assert.deepEqual(sdk.calls, ['close:true', 'dispose']);
});

test('the engine shuts down even when closing the document fails', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [], failClose: true });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.leave(), /close failed/);
  assert.deepEqual(sdk.calls, ['close:true', 'dispose']);
});

test('a suggestion behind a full page of other tracked changes still counts as open', async () => {
  const others = Array.from({ length: 250 }, (_, index) => ({ id: `other-${index}` }));
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: others });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });
  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  assert.equal(await agent.waitForDecision(suggestion, { pollMs: 5, timeoutMs: 30 }), 'pending');
});

test('tracked change IDs are read from a flat receipt too', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [], flatReceipt: true });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  assert.deepEqual(suggestion.trackedChangeIds, ['tc-insert', 'tc-replace']);
  assert.equal(await agent.waitForDecision(suggestion, { pollMs: 5, timeoutMs: 30 }), 'pending');
});

test('text is matched case-sensitively, like the check before it', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [] });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('Thirty days', 'forty-five days'), TextNotFoundError);
  assert.deepEqual(sdk.calls, []);
});

test('an edit between the match and the replace makes the agent match again instead of using stale offsets', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [], editsAfterMatch: 1 });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  const suggestion = await agent.suggest('thirty days', 'forty-five days');

  assert.deepEqual(
    sdk.replaces.map((replace) => replace.expectedRevision),
    ['1', '2'],
  );
  assert.deepEqual(suggestion.trackedChangeIds, ['tc-insert', 'tc-replace']);
});

test('a document that keeps changing is reported, and no stale replacement is applied', async () => {
  const room: FakeRoom = { text: 'Payment is due in thirty days.', openChanges: [], editsAfterMatch: 10 };
  const sdk = fakeAgentSdk(room);
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('thirty days', 'forty-five days'), /kept changing/);
  assert.equal(sdk.replaces.length, 3);
  assert.deepEqual(room.openChanges, []);
});

test('a refused replacement surfaces its failure code', async () => {
  const sdk = fakeAgentSdk({ text: 'Payment is due in thirty days.', openChanges: [], replaceFailure: 'LOCK_VIOLATION' });
  const agent = await joinAsAgent({ ...join, createClient: sdk.createClient });

  await assert.rejects(agent.suggest('thirty days', 'forty-five days'), /LOCK_VIOLATION/);
});
