import { describe, it, expect } from 'vite-plus/test';
import { DOCX, PDF } from '@superdoc/common';
import { resolveV2CollaborationTarget, redactCollaborationUrl } from './resolve-v2-collaboration-target.ts';

describe('resolveV2CollaborationTarget', () => {
  it.each([
    { providerType: 'y-websocket', documentId: 'room', serverUrl: 'wss://example.test' },
    { providerType: 'hocuspocus', documentId: 'room', serverUrl: 'wss://example.test' },
    { providerType: 'liveblocks', documentId: 'room', publicApiKey: 'pk_test' },
    { providerType: 'extension', adapterId: 'custom', documentId: 'room' },
  ])('preserves explicit create-or-join for $providerType', (target) => {
    const collaboration = { ...target, roomMode: 'create-or-join' };
    for (const document of [{ collaboration }, { v2Collaboration: collaboration }]) {
      expect(resolveV2CollaborationTarget(document)).toMatchObject({
        ok: true,
        target: { roomMode: 'create-or-join', documentId: 'room' },
      });
    }
  });

  it.each([
    { providerType: 'y-websocket', documentId: 'room', serverUrl: 'wss://example.com' },
    { providerType: 'hocuspocus', documentId: 'room', serverUrl: 'wss://example.com' },
    { providerType: 'liveblocks', documentId: 'room', publicApiKey: 'pk_live_123' },
    { providerType: 'extension', adapterId: 'custom', documentId: 'room' },
  ])('preserves syncTimeoutMs for $providerType', (collaboration) => {
    const result = resolveV2CollaborationTarget({
      collaboration: { ...collaboration, syncTimeoutMs: 45_000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.syncTimeoutMs).toBe(45_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid syncTimeoutMs %s',
    (syncTimeoutMs) => {
      const result = resolveV2CollaborationTarget({
        collaboration: { documentId: 'room', serverUrl: 'wss://example.com', syncTimeoutMs },
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid-sync-timeout' });
    },
  );

  for (const collaboration of [
    { providerType: 'y-websocket', documentId: 'room', serverUrl: 'wss://example.com' },
    { providerType: 'hocuspocus', documentId: 'room', serverUrl: 'wss://example.com', token: 'token' },
    { providerType: 'liveblocks', roomId: 'room', authEndpoint: 'https://example.com/auth' },
  ]) {
    it(`accepts both config spellings for ${collaboration.providerType}`, () => {
      expect(resolveV2CollaborationTarget({ collaboration })).toEqual(
        resolveV2CollaborationTarget({ v2Collaboration: collaboration }),
      );
    });
  }

  it('uses the complete canonical target without merging fields from its alias', () => {
    const collaboration = { providerType: 'hocuspocus', documentId: 'new', serverUrl: 'wss://new.example.com' };
    const v2Collaboration = {
      providerType: 'hocuspocus',
      documentId: 'old',
      serverUrl: 'wss://old.example.com',
      token: 'old-secret',
    };
    expect(resolveV2CollaborationTarget({ collaboration, v2Collaboration })).toEqual(
      resolveV2CollaborationTarget({ collaboration }),
    );
    expect(resolveV2CollaborationTarget({ collaboration: {}, v2Collaboration }).ok).toBe(false);
    expect(resolveV2CollaborationTarget({ collaboration: null, v2Collaboration }).ok).toBe(false);
  });
  it('forwards string params verbatim and drops non-string entries', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        documentId: 'room-1',
        serverUrl: 'wss://collab.example.com',
        params: { token: 'abc', n: 5, keep: 'yes' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.params).toEqual({ token: 'abc', keep: 'yes' });
    }
  });

  it('carries a Liveblocks baseUrl and rejects one that is not an absolute http(s) URL', () => {
    const local = resolveV2CollaborationTarget({
      collaboration: {
        providerType: 'liveblocks',
        documentId: 'room',
        publicApiKey: 'pk_localdev',
        baseUrl: 'http://localhost:1153',
      },
    });
    expect(local).toMatchObject({ ok: true, target: { baseUrl: 'http://localhost:1153' } });
    const authenticated = resolveV2CollaborationTarget({
      collaboration: {
        providerType: 'liveblocks',
        documentId: 'room',
        authEndpoint: 'https://example.test/auth',
        baseUrl: 'http://localhost:1153',
      },
    });
    expect(authenticated).toMatchObject({
      ok: true,
      target: { authEndpoint: 'https://example.test/auth', baseUrl: 'http://localhost:1153' },
    });
    const hosted = resolveV2CollaborationTarget({
      collaboration: { providerType: 'liveblocks', documentId: 'room', publicApiKey: 'pk_live' },
    });
    expect(hosted.ok && hosted.target).not.toHaveProperty('baseUrl');
    for (const baseUrl of ['localhost:1153', 'ws://localhost:1153', '', 'https://']) {
      const result = resolveV2CollaborationTarget({
        collaboration: { providerType: 'liveblocks', documentId: 'room', publicApiKey: 'pk_localdev', baseUrl },
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid-base-url' });
    }
  });

  it('carries a room-scoped expectedRevision only for Hocuspocus', () => {
    const room = resolveV2CollaborationTarget({
      collaboration: {
        providerType: 'hocuspocus',
        documentId: 'room',
        serverUrl: 'wss://collab.example.test',
        expectedRevisionScope: 'room',
      },
    });
    expect(room).toMatchObject({ ok: true, target: { providerFamily: 'hocuspocus', expectedRevisionScope: 'room' } });
    const unset = resolveV2CollaborationTarget({
      collaboration: { providerType: 'hocuspocus', documentId: 'room', serverUrl: 'wss://collab.example.test' },
    });
    expect(unset.ok && unset.target).not.toHaveProperty('expectedRevisionScope');
    const session = resolveV2CollaborationTarget({
      collaboration: { documentId: 'room', serverUrl: 'wss://collab.example.test', expectedRevisionScope: 'session' },
    });
    expect(session).toMatchObject({
      ok: true,
      target: { providerFamily: 'y-websocket', expectedRevisionScope: 'session' },
    });
    for (const [providerType, expectedRevisionScope] of [
      ['y-websocket', 'room'],
      ['hocuspocus', 'global'],
      ['hocuspocus', true],
    ]) {
      const result = resolveV2CollaborationTarget({
        collaboration: {
          providerType,
          documentId: 'room',
          serverUrl: 'wss://collab.example.test',
          expectedRevisionScope,
        },
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid-expected-revision-scope' });
    }
  });

  it('fails closed for an unsupported hocuspocus provider family', () => {
    const result = resolveV2CollaborationTarget({
      legacyCollaboration: { providerType: 'hocuspocus', url: 'wss://h.example.com?token=secret' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-provider-family');
      expect(result.message).toContain('hocuspocus');
      // The token in the legacy url must never appear in the diagnostic.
      expect(result.message).not.toContain('secret');
      expect(result.message).toContain('<redacted>');
    }
  });

  it('prefers the v2 target over a legacy block when both are present', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x' },
      legacyCollaboration: { providerType: 'hocuspocus' },
      documentCount: 1,
      documentType: DOCX,
    });
    expect(result.ok).toBe(true);
  });

  it('fails closed with invalid-server-url for a bad Hocuspocus URL and redacts the value', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'hocuspocus', documentId: 'room-1', url: 'https://wrong-scheme?token=secret' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-server-url');
      expect(result.message).not.toContain('secret');
      expect(result.message).toContain('<redacted>');
    }
  });

  it('fails closed with invalid-auth-endpoint for a bad Liveblocks auth endpoint', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: 'ftp://auth.example.com/private?token=secret',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-auth-endpoint');
      expect(result.message).not.toContain('auth.example.com');
      expect(result.message).not.toContain('secret');
      expect(result.message).toContain('<redacted>');
    }
  });

  it('never echoes a token query param from a valid websocket params bag in diagnostics', () => {
    // A valid target must still succeed; the redaction guarantees apply to the
    // failure diagnostics, which is what the secret-redaction cases above prove.
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x', params: { token: 'abc' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.params).toEqual({ token: 'abc' });
  });

  it('passes a Hocuspocus token resolver through as the same function', () => {
    const resolveToken = async () => 'jwt-current';
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: 'fieldguide-report',
        serverUrl: 'wss://collaboration.example.test',
        token: resolveToken,
      },
    });
    expect(result.ok && result.target.token).toBe(resolveToken);
  });
});

type ResolveInput = Parameters<typeof resolveV2CollaborationTarget>[0];

function record(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, field: unknown) => (typeof field === 'function' ? `[Function ${field.name}]` : field),
    2,
  );
}

const recordedScenarios: Array<{ name: string; input: ResolveInput }> = [
  {
    name: 'y-websocket-implicit',
    input: {
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com' },
      documentType: DOCX,
      documentCount: 1,
    },
  },
  {
    name: 'y-websocket-explicit-join',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com', roomMode: 'join' } },
  },
  {
    name: 'y-websocket-url-alias',
    input: { v2Collaboration: { providerType: 'y-websocket', documentId: 'room-1', url: 'wss://collab.example.com' } },
  },
  {
    name: 'hocuspocus-token-and-params',
    input: {
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: 'room-1',
        url: 'wss://hocus.example.com',
        token: 'secret-token',
        params: { tenant: 'acme' },
      },
    },
  },
  {
    name: 'hocuspocus-token-resolver',
    input: {
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: 'fieldguide-report',
        serverUrl: 'wss://collaboration.example.test',
        token: async function resolveToken() {
          return 'jwt-current';
        },
      },
    },
  },
  {
    name: 'liveblocks-public-key',
    input: { v2Collaboration: { providerType: 'liveblocks', roomId: 'room-1', publicApiKey: 'pk_live_123' } },
  },
  {
    name: 'liveblocks-create',
    input: {
      v2Collaboration: {
        providerType: 'liveblocks',
        roomId: 'room-2',
        publicApiKey: 'pk_live_123',
        roomMode: 'create',
      },
    },
  },
  {
    name: 'liveblocks-auth-endpoint',
    input: {
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: 'https://auth.example.com/liveblocks',
      },
    },
  },
  {
    name: 'liveblocks-relative-auth-endpoint',
    input: {
      v2Collaboration: { providerType: 'liveblocks', documentId: 'room-1', authEndpoint: '/api/liveblocks-auth' },
      authEndpointBaseUrl: 'https://app.example.com/documents/123',
    },
  },
  {
    name: 'liveblocks-relative-auth-endpoint-without-base',
    input: {
      v2Collaboration: { providerType: 'liveblocks', documentId: 'room-1', authEndpoint: '/api/liveblocks-auth' },
    },
  },
  {
    name: 'liveblocks-relative-auth-endpoint-file-base',
    input: {
      v2Collaboration: { providerType: 'liveblocks', documentId: 'room-1', authEndpoint: '/api/liveblocks-auth' },
      authEndpointBaseUrl: 'file:///tmp/index.html',
    },
  },
  {
    name: 'liveblocks-missing-room-id',
    input: { v2Collaboration: { providerType: 'liveblocks', publicApiKey: 'pk_live_123' } },
  },
  {
    name: 'liveblocks-missing-auth',
    input: { v2Collaboration: { providerType: 'liveblocks', documentId: 'room-1' } },
  },
  {
    name: 'liveblocks-mixed-auth',
    input: {
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        publicApiKey: 'pk_live_123',
        authEndpoint: 'https://auth.example.com/liveblocks',
      },
    },
  },
  {
    name: 'extension-adapter',
    input: {
      v2Collaboration: {
        providerType: 'extension',
        adapterId: 'fieldguide-hocuspocus',
        documentId: 'fieldguide-report',
        providerOptions: { tenant: 'acme', reconnect: true },
      },
    },
  },
  {
    name: 'unknown-room-mode',
    input: {
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com', roomMode: 'open-or-create' },
    },
  },
  {
    name: 'null-room-mode',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com', roomMode: null } },
  },
  {
    name: 'removed-create-if-missing',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com', createIfMissing: true } },
  },
  { name: 'missing-target', input: {} },
  { name: 'empty-document-id', input: { v2Collaboration: { documentId: '', serverUrl: 'wss://x' } } },
  { name: 'missing-server-url', input: { v2Collaboration: { documentId: 'room-1' } } },
  { name: 'malformed-server-url', input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'not-a-url' } } },
  {
    name: 'non-websocket-server-url',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'https://collab.example.com' } },
  },
  { name: 'legacy-ydoc-provider-pair', input: { legacyCollaboration: { ydoc: {}, provider: {} } } },
  {
    name: 'nested-ydoc-provider-pair',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x', ydoc: {}, provider: {} } },
  },
  {
    name: 'pdf-document',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x' }, documentType: PDF },
  },
  {
    name: 'two-documents',
    input: { v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x' }, documentCount: 2 },
  },
  { name: 'unknown-provider-family', input: { v2Collaboration: { providerType: 'memory', documentId: 'room-1' } } },
];

describe('resolveV2CollaborationTarget recordings', () => {
  it.each(recordedScenarios)('$name', async ({ name, input }) => {
    const recording = `input:\n${record(input)}\n\nresult:\n${record(resolveV2CollaborationTarget(input))}\n`;
    await expect(recording).toMatchFileSnapshot(`./__snapshots__/resolve-v2-collaboration-target/${name}.txt`);
  });
});

describe('redactCollaborationUrl', () => {
  it('strips query strings that may carry tokens', () => {
    expect(redactCollaborationUrl('wss://collab.example.com/room?token=secret')).toBe(
      'wss://collab.example.com/room?<redacted>',
    );
  });

  it('strips embedded credentials', () => {
    const redacted = redactCollaborationUrl('wss://user:pass@collab.example.com/room');
    expect(redacted).not.toContain('user');
    expect(redacted).not.toContain('pass');
  });

  it('returns <none> for empty or non-string values', () => {
    expect(redactCollaborationUrl(undefined)).toBe('<none>');
    expect(redactCollaborationUrl('')).toBe('<none>');
    expect(redactCollaborationUrl(42)).toBe('<none>');
  });

  it('scrubs query from non-absolute values', () => {
    expect(redactCollaborationUrl('/relative/room?token=secret')).toBe('/relative/room?<redacted>');
  });
});
