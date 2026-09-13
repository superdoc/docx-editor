import { describe, it, expect } from 'vite-plus/test';
import { DOCX, PDF } from '@superdoc/common';
import { resolveV2CollaborationTarget, redactCollaborationUrl } from './resolve-v2-collaboration-target.ts';

describe('resolveV2CollaborationTarget', () => {
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
  it('resolves a valid v2Collaboration target to a y-websocket family', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://collab.example.com' },
      documentType: DOCX,
      documentCount: 1,
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'y-websocket',
        documentId: 'room-1',
        roomMode: 'join',
        serverUrl: 'wss://collab.example.com',
      },
    });
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

  it('defaults to join and preserves explicit create intent', () => {
    const defaultJoin = resolveV2CollaborationTarget({
      v2Collaboration: {
        documentId: 'room-1',
        serverUrl: 'wss://collab.example.com',
        roomMode: 'join',
      },
    });
    expect(defaultJoin).toEqual({
      ok: true,
      target: {
        providerFamily: 'y-websocket',
        documentId: 'room-1',
        roomMode: 'join',
        serverUrl: 'wss://collab.example.com',
      },
    });

    const explicitCreate = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        roomId: 'room-2',
        publicApiKey: 'pk_live_123',
        roomMode: 'create',
      },
    });
    expect(explicitCreate).toEqual({
      ok: true,
      target: {
        providerFamily: 'liveblocks',
        documentId: 'room-2',
        roomMode: 'create',
        publicApiKey: 'pk_live_123',
      },
    });
  });

  it('rejects unknown room modes instead of coercing them to join or create', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        documentId: 'room-1',
        serverUrl: 'wss://collab.example.com',
        roomMode: 'open-or-create',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-room-mode');
  });

  it('rejects a null room mode instead of treating it as the default join mode', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        documentId: 'room-1',
        serverUrl: 'wss://collab.example.com',
        roomMode: null,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-room-mode');
  });

  it('rejects the removed createIfMissing option instead of treating it as create', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        documentId: 'room-1',
        serverUrl: 'wss://collab.example.com',
        createIfMissing: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-room-mode');
      expect(result.message).toContain('roomMode');
    }
  });

  it('fails closed with missing-target when no v2 config or legacy block is supplied', () => {
    const result = resolveV2CollaborationTarget({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-target');
  });

  it('fails closed with invalid-document-id for an empty documentId', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: '', serverUrl: 'wss://x' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-document-id');
  });

  it('fails closed with invalid-server-url for a missing serverUrl', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-server-url');
  });

  it('fails closed with invalid-server-url for malformed or non-websocket URLs', () => {
    for (const serverUrl of ['not-a-url', 'https://collab.example.com']) {
      const result = resolveV2CollaborationTarget({
        v2Collaboration: { documentId: 'room-1', serverUrl },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-server-url');
    }
  });

  it('fails closed for an external { ydoc, provider } legacy pair', () => {
    const result = resolveV2CollaborationTarget({
      legacyCollaboration: { ydoc: {}, provider: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-legacy-provider');
      expect(result.message).not.toMatch(/token/i);
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

  it('fails closed for a non-DOCX document type', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x' },
      documentType: PDF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-document-type');
  });

  it('fails closed for multi-document instances', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x' },
      documentCount: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-multi-document');
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

  it('resolves an explicit y-websocket target with a url alias', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'y-websocket', documentId: 'room-1', url: 'wss://collab.example.com' },
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'y-websocket',
        documentId: 'room-1',
        roomMode: 'join',
        serverUrl: 'wss://collab.example.com',
      },
    });
  });

  it('resolves a Hocuspocus target with token and params', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: 'room-1',
        url: 'wss://hocus.example.com',
        token: 'secret-token',
        params: { tenant: 'acme' },
      },
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'hocuspocus',
        documentId: 'room-1',
        roomMode: 'join',
        serverUrl: 'wss://hocus.example.com',
        token: 'secret-token',
        params: { tenant: 'acme' },
      },
    });
  });

  it('resolves a Liveblocks target in public-key mode', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'liveblocks', roomId: 'room-1', publicApiKey: 'pk_live_123' },
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'liveblocks',
        documentId: 'room-1',
        roomMode: 'join',
        publicApiKey: 'pk_live_123',
      },
    });
  });

  it('resolves a Liveblocks target in auth-endpoint mode', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: 'https://auth.example.com/liveblocks',
      },
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'liveblocks',
        documentId: 'room-1',
        roomMode: 'join',
        authEndpoint: 'https://auth.example.com/liveblocks',
      },
    });
  });

  it('resolves a browser-relative Liveblocks auth endpoint against the supplied browser URL', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: '/api/liveblocks-auth',
      },
      authEndpointBaseUrl: 'https://app.example.com/documents/123',
    });
    expect(result).toEqual({
      ok: true,
      target: {
        providerFamily: 'liveblocks',
        documentId: 'room-1',
        roomMode: 'join',
        authEndpoint: 'https://app.example.com/api/liveblocks-auth',
      },
    });
  });

  it('keeps relative Liveblocks auth endpoints invalid when no browser URL is supplied', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: '/api/liveblocks-auth',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-auth-endpoint');
  });

  it('rejects a relative Liveblocks auth endpoint when the supplied base is not HTTP(S)', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        authEndpoint: '/api/liveblocks-auth',
      },
      authEndpointBaseUrl: 'file:///tmp/index.html',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-auth-endpoint');
  });

  it('fails closed with invalid-document-id for a Liveblocks target missing a room id', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'liveblocks', publicApiKey: 'pk_live_123' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-document-id');
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

  it('fails closed with missing-auth for a Liveblocks target with no auth mode', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'liveblocks', documentId: 'room-1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-auth');
  });

  it('fails closed with mixed-auth for a Liveblocks target with both auth modes', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: {
        providerType: 'liveblocks',
        documentId: 'room-1',
        publicApiKey: 'pk_live_123',
        authEndpoint: 'https://auth.example.com/liveblocks',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('mixed-auth');
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

  it('fails closed for an unsupported provider family on the v2 target', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { providerType: 'memory', documentId: 'room-1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-provider-family');
      expect(result.message).toContain('memory');
    }
  });

  it('fails closed for an external { ydoc, provider } pair nested on the v2 target', () => {
    const result = resolveV2CollaborationTarget({
      v2Collaboration: { documentId: 'room-1', serverUrl: 'wss://x', ydoc: {}, provider: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-legacy-provider');
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

  describe('provider extension contract', () => {
    it('preserves a Hocuspocus token resolver for the browser-to-worker callback bridge', () => {
      const resolveToken = async () => 'jwt-current';
      const result = resolveV2CollaborationTarget({
        v2Collaboration: {
          providerType: 'hocuspocus',
          documentId: 'fieldguide-report',
          serverUrl: 'wss://collaboration.example.test',
          token: resolveToken,
        },
      });

      expect(result).toEqual({
        ok: true,
        target: {
          providerFamily: 'hocuspocus',
          documentId: 'fieldguide-report',
          roomMode: 'join',
          serverUrl: 'wss://collaboration.example.test',
          token: resolveToken,
        },
      });
    });

    it('accepts a customer adapter id and structured-clone-safe provider options', () => {
      const result = resolveV2CollaborationTarget({
        v2Collaboration: {
          providerType: 'extension',
          adapterId: 'fieldguide-hocuspocus',
          documentId: 'fieldguide-report',
          providerOptions: { tenant: 'acme', reconnect: true },
        },
      });

      expect(result).toEqual({
        ok: true,
        target: {
          providerFamily: 'extension',
          adapterId: 'fieldguide-hocuspocus',
          documentId: 'fieldguide-report',
          providerOptions: { tenant: 'acme', reconnect: true },
          roomMode: 'join',
        },
      });
    });
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
