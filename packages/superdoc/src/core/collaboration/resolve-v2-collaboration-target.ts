import { DOCX } from '@superdoc/common';
import type { DocumentCollaborationConfig } from '../types/index.js';

/**
 * Centralized v2 collaboration target resolver.
 *
 * This is the single authority that decides whether a constructor-time
 * collaboration config or a late `upgradeToCollaboration(...)` call resolves to
 * a **supported** SuperDoc v2 collaboration room. SuperDoc v2 ships three
 * first-class single-doc provider families — y-websocket, Hocuspocus, and
 * Liveblocks — each bound to one `Y.Doc`, one provider session, and one
 * awareness channel (implemented inside the bundled v2 runtime) and surfaced
 * publicly through {@link DocumentCollaborationConfig} (`Document.collaboration`).
 *
 * The resolver never returns a "maybe collaborative" result: it either returns
 * a normalized, supported target or a stable, redacted diagnostic. Tokens, auth
 * keys, auth endpoints, and query strings are never echoed back in diagnostics.
 */

/** Provider families the shipped v2 single-doc runtime can drive. */
export type SupportedV2ProviderFamily = 'y-websocket' | 'hocuspocus' | 'liveblocks' | 'extension';

/**
 * Stable, machine-readable reasons a target cannot be treated as a supported v2
 * collaboration room. These strings are part of the diagnostic contract and are
 * safe to assert against in tests; they never carry caller-provided values.
 */
export type V2CollaborationUnsupportedReason =
  | 'missing-target'
  | 'invalid-document-id'
  | 'invalid-server-url'
  | 'invalid-room-mode'
  | 'invalid-auth-endpoint'
  | 'invalid-adapter-id'
  | 'invalid-provider-options'
  | 'missing-auth'
  | 'mixed-auth'
  | 'unsupported-document-type'
  | 'unsupported-multi-document'
  | 'unsupported-legacy-provider'
  | 'unsupported-provider-family';

/**
 * Normalized, supported v2 collaboration room target.
 *
 * The shape is flat with provider-specific optional fields. y-websocket and
 * Hocuspocus carry `serverUrl` (and Hocuspocus optionally `token`); Liveblocks
 * carries exactly one of `publicApiKey` or `authEndpoint`. Only the fields that
 * apply to the resolved family are present.
 */
export interface NormalizedV2CollaborationTarget {
  providerFamily: SupportedV2ProviderFamily;
  /** Stable shared document/room identity. */
  documentId: string;
  /** WebSocket server URL (y-websocket / Hocuspocus single-doc providers). */
  serverUrl?: string;
  /** Optional connection query params (e.g. auth token) forwarded verbatim. */
  params?: Record<string, string>;
  /** Hocuspocus auth-message token. */
  token?: string | (() => string | Promise<string>);
  /** Liveblocks anonymous public key auth mode. */
  publicApiKey?: string;
  /** Liveblocks server-side auth endpoint mode. */
  authEndpoint?: string;
  /** Adapter registration key for a customer collaboration Worker. */
  adapterId?: string;
  /** Structured-clone-safe options interpreted by the registered adapter. */
  providerOptions?: unknown;
  /** Explicit room operation; join is the default at the untrusted input boundary. */
  roomMode: 'join' | 'create';
}

export type V2CollaborationTargetResolution =
  | { ok: true; target: NormalizedV2CollaborationTarget }
  | {
      ok: false;
      reason: V2CollaborationUnsupportedReason;
      /** Human-readable, fully redacted diagnostic message. */
      message: string;
    };

/**
 * Loose input shape for a legacy `modules.collaboration` / upgrade option block.
 * Typed permissively because the resolver inspects arbitrary consumer input and
 * must classify it without trusting its shape.
 */
export interface LegacyCollaborationLike {
  ydoc?: unknown;
  provider?: unknown;
  providerType?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

export interface ResolveV2CollaborationTargetInput {
  /** Preferred connection settings. Explicit null or invalid input never falls back to the alias. */
  collaboration?: unknown;
  /** Compatibility spelling for document-level connection settings. */
  v2Collaboration?: unknown;
  /** Legacy provider-agnostic collaboration block (`modules.collaboration` / upgrade opts). */
  legacyCollaboration?: LegacyCollaborationLike | null;
  /** The single document's type. v2 collaboration supports DOCX only. */
  documentType?: string | null;
  /** Total number of mounted documents. v2 single-doc rooms support exactly one. */
  documentCount?: number;
  /**
   * Browser URL used only to resolve a relative Liveblocks auth endpoint.
   * Non-browser callers omit this so relative endpoints continue to fail
   * closed when there is no origin against which to resolve them.
   */
  authEndpointBaseUrl?: string;
}

/** Select the public spelling before validation; do not merge settings from different rooms. */
export function readCollaborationConfig(input: { collaboration?: unknown; v2Collaboration?: unknown }): unknown {
  return input.collaboration !== undefined ? input.collaboration : input.v2Collaboration;
}

/**
 * Redact a connection URL for safe inclusion in diagnostics and artifacts.
 *
 * Strips the query string, fragment, and any embedded credentials (userinfo)
 * because those commonly carry auth tokens. Falls back to a coarse string scrub
 * when the value is not a parseable absolute URL so a malformed value with an
 * inline `?token=...` still cannot leak.
 */
export function redactCollaborationUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return '<none>';
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    const redactedQuery = url.includes('?') ? '?<redacted>' : '';
    return `${parsed.toString().replace(/\?$/, '')}${redactedQuery}`;
  } catch {
    // Not an absolute URL — scrub everything from the first `?` or `#` onward
    // and drop any `user:pass@` segment so partial values can't leak secrets.
    const withoutCredentials = url.replace(/\/\/[^/@]+@/, '//');
    const cut = withoutCredentials.search(/[?#]/);
    if (cut === -1) return withoutCredentials;
    return `${withoutCredentials.slice(0, cut)}?<redacted>`;
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeWebsocketUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:' ? value : null;
  } catch {
    return null;
  }
}

function normalizeHttpUrl(value: unknown, baseUrl?: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? normalized : null;
  } catch {
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) return null;
    try {
      const parsed = new URL(normalized, baseUrl);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }
}

function normalizeParams(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') params[key] = raw;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function normalizeRoomMode(value: unknown): 'join' | 'create' | null {
  if (value === undefined) return 'join';
  return value === 'join' || value === 'create' ? value : null;
}

function invalidRoomMode(): V2CollaborationTargetResolution {
  return {
    ok: false,
    reason: 'invalid-room-mode',
    message: 'SuperDoc v2 collaboration roomMode must be either "join" or "create".',
  };
}

/** Provider-family token recognized on a v2Collaboration config object. */
function readProviderType(candidate: Record<string, unknown>): string | null {
  const raw = candidate.providerType;
  return typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : null;
}

/**
 * Detect whether a legacy collaboration block names a provider family that the
 * shipped single-doc v2 runtime cannot drive. Returns the offending family name
 * (for diagnostics) or `null` when the block carries no recognizable family.
 */
function detectUnsupportedLegacyFamily(legacy: LegacyCollaborationLike | null | undefined): string | null {
  if (!legacy || typeof legacy !== 'object') return null;
  const providerType = typeof legacy.providerType === 'string' ? legacy.providerType.toLowerCase() : '';
  if (providerType === 'hocuspocus') return 'hocuspocus';
  if (providerType === 'liveblocks') return 'liveblocks';
  if (providerType === 'superdoc') return 'superdoc';
  // An arbitrary external `{ ydoc, provider }` pair is not a supported v2
  // single-doc adapter target; it must be classified explicitly, never coerced.
  if (legacy.ydoc != null || legacy.provider != null) return 'external-ydoc-provider';
  return null;
}

/** Resolve a websocket-backed family (y-websocket / Hocuspocus). */
function resolveWebsocketFamily(
  family: 'y-websocket' | 'hocuspocus',
  candidate: Record<string, unknown>,
): V2CollaborationTargetResolution {
  const documentId = normalizeNonEmptyString(candidate.documentId);
  if (!documentId) {
    return {
      ok: false,
      reason: 'invalid-document-id',
      message: `SuperDoc v2 collaboration requires a non-empty collaboration.documentId for the "${family}" provider.`,
    };
  }
  // Accept either `url` or `serverUrl`; `url` wins when both are present.
  const rawUrl = candidate.url ?? candidate.serverUrl;
  const serverUrl = normalizeWebsocketUrl(rawUrl);
  if (!serverUrl) {
    return {
      ok: false,
      reason: 'invalid-server-url',
      message:
        `SuperDoc v2 collaboration requires a valid ws:// or wss:// URL for the "${family}" provider ` +
        `(received: ${redactCollaborationUrl(rawUrl)}).`,
    };
  }
  const params = normalizeParams(candidate.params);
  const token =
    family === 'hocuspocus' && typeof candidate.token === 'function'
      ? (candidate.token as () => string | Promise<string>)
      : family === 'hocuspocus'
        ? normalizeNonEmptyString(candidate.token)
        : null;
  const roomMode = normalizeRoomMode(candidate.roomMode);
  if (!roomMode) return invalidRoomMode();
  return {
    ok: true,
    target: {
      providerFamily: family,
      documentId,
      roomMode,
      serverUrl,
      ...(params ? { params } : {}),
      ...(token ? { token } : {}),
    },
  };
}

function resolveProviderExtension(candidate: Record<string, unknown>): V2CollaborationTargetResolution {
  const adapterId = normalizeNonEmptyString(candidate.adapterId);
  if (!adapterId) {
    return {
      ok: false,
      reason: 'invalid-adapter-id',
      message: 'SuperDoc v2 provider extensions require a non-empty v2Collaboration.adapterId.',
    };
  }
  const documentId = normalizeNonEmptyString(candidate.documentId);
  if (!documentId) {
    return {
      ok: false,
      reason: 'invalid-document-id',
      message: 'SuperDoc v2 provider extensions require a non-empty v2Collaboration.documentId.',
    };
  }
  const roomMode = normalizeRoomMode(candidate.roomMode);
  if (!roomMode) return invalidRoomMode();
  if (Object.prototype.hasOwnProperty.call(candidate, 'providerOptions')) {
    try {
      structuredClone(candidate.providerOptions);
    } catch {
      return {
        ok: false,
        reason: 'invalid-provider-options',
        message: 'SuperDoc v2 provider extension options must be structured-clone-safe.',
      };
    }
  }
  const token =
    typeof candidate.token === 'function'
      ? (candidate.token as () => string | Promise<string>)
      : normalizeNonEmptyString(candidate.token);
  return {
    ok: true,
    target: {
      providerFamily: 'extension',
      adapterId,
      documentId,
      roomMode,
      ...(Object.prototype.hasOwnProperty.call(candidate, 'providerOptions')
        ? { providerOptions: candidate.providerOptions }
        : {}),
      ...(token ? { token } : {}),
    },
  };
}

/** Resolve the Liveblocks family (exactly one of publicApiKey / authEndpoint). */
function resolveLiveblocksFamily(
  candidate: Record<string, unknown>,
  authEndpointBaseUrl?: string,
): V2CollaborationTargetResolution {
  // Liveblocks consumers may pass `roomId`; treat it as the room identity.
  const documentId = normalizeNonEmptyString(candidate.documentId ?? candidate.roomId);
  if (!documentId) {
    return {
      ok: false,
      reason: 'invalid-document-id',
      message:
        'SuperDoc v2 collaboration requires a non-empty collaboration.documentId (or roomId) for the "liveblocks" provider.',
    };
  }
  const publicApiKey = normalizeNonEmptyString(candidate.publicApiKey);
  const roomMode = normalizeRoomMode(candidate.roomMode);
  if (!roomMode) return invalidRoomMode();
  const authEndpointRaw = candidate.authEndpoint;
  const hasAuthEndpoint = typeof authEndpointRaw === 'string' && authEndpointRaw.length > 0;
  if (!publicApiKey && !hasAuthEndpoint) {
    return {
      ok: false,
      reason: 'missing-auth',
      message:
        'SuperDoc v2 Liveblocks collaboration requires exactly one auth mode: a publicApiKey or an authEndpoint. None was provided.',
    };
  }
  if (publicApiKey && hasAuthEndpoint) {
    return {
      ok: false,
      reason: 'mixed-auth',
      message:
        'SuperDoc v2 Liveblocks collaboration accepts exactly one auth mode; pass either publicApiKey or authEndpoint, not both.',
    };
  }
  if (publicApiKey) {
    return {
      ok: true,
      target: {
        providerFamily: 'liveblocks',
        documentId,
        roomMode,
        publicApiKey,
      },
    };
  }
  const authEndpoint = normalizeHttpUrl(authEndpointRaw, authEndpointBaseUrl);
  if (!authEndpoint) {
    return {
      ok: false,
      reason: 'invalid-auth-endpoint',
      message: 'SuperDoc v2 Liveblocks collaboration requires a valid http(s) authEndpoint URL (received: <redacted>).',
    };
  }
  return {
    ok: true,
    target: {
      providerFamily: 'liveblocks',
      documentId,
      roomMode,
      authEndpoint,
    },
  };
}

/**
 * Resolve a constructor-time or upgrade-time collaboration request into a
 * supported v2 room target, or a stable redacted diagnostic.
 */
export function resolveV2CollaborationTarget(
  input: ResolveV2CollaborationTargetInput,
): V2CollaborationTargetResolution {
  const { legacyCollaboration, documentType, documentCount, authEndpointBaseUrl } = input;
  const v2Collaboration = readCollaborationConfig(input);

  // Document-shape gates first: a supported v2 room is exactly one DOCX.
  if (typeof documentCount === 'number' && documentCount > 1) {
    return {
      ok: false,
      reason: 'unsupported-multi-document',
      message: `SuperDoc v2 collaboration supports exactly one document per room; received ${documentCount}.`,
    };
  }
  if (documentType != null && documentType !== DOCX) {
    return {
      ok: false,
      reason: 'unsupported-document-type',
      message: 'SuperDoc v2 collaboration supports DOCX documents only.',
    };
  }

  const hasV2Target = v2Collaboration != null && typeof v2Collaboration === 'object';

  if (!hasV2Target) {
    // No canonical v2 target. If a legacy provider-agnostic block was supplied,
    // fail closed with a named provider-family diagnostic so callers know the
    // legacy shape is not silently treated as v2-supported.
    const family = detectUnsupportedLegacyFamily(legacyCollaboration);
    if (family) {
      const reason: V2CollaborationUnsupportedReason =
        family === 'external-ydoc-provider' ? 'unsupported-legacy-provider' : 'unsupported-provider-family';
      const redactedUrl = redactCollaborationUrl((legacyCollaboration as LegacyCollaborationLike)?.url);
      return {
        ok: false,
        reason,
        message:
          family === 'external-ydoc-provider'
            ? 'SuperDoc v2 collaboration cannot use an external { ydoc, provider } pair. Provide a collaboration ' +
              'target (e.g. { providerType, documentId, url }) instead.'
            : `SuperDoc v2 collaboration does not accept "${family}" through the legacy modules.collaboration block ` +
              `(server: ${redactedUrl}). Configure it as a document.collaboration target ` +
              `({ providerType: "${family}", documentId, ... }) instead.`,
      };
    }
    return {
      ok: false,
      reason: 'missing-target',
      message:
        'SuperDoc v2 collaboration requires a collaboration target ({ documentId, serverUrl } or { providerType, ... }). None was provided.',
    };
  }

  const candidate = v2Collaboration as Partial<DocumentCollaborationConfig> & Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(candidate, 'createIfMissing')) {
    return {
      ok: false,
      reason: 'invalid-room-mode',
      message:
        'SuperDoc v2 collaboration createIfMissing has been removed. Use roomMode: "create" for creation or roomMode: "join" for normal opens.',
    };
  }

  // An external Yjs `{ ydoc, provider }` pair is never a supported v2 content
  // driver, even when nested on the v2Collaboration field. v2 owns its provider.
  if (candidate.ydoc != null || candidate.provider != null) {
    return {
      ok: false,
      reason: 'unsupported-legacy-provider',
      message:
        'SuperDoc v2 collaboration cannot use an external { ydoc, provider } pair. v2 owns its provider; pass a ' +
        'collaboration target ({ providerType, documentId, serverUrl | publicApiKey | authEndpoint }) instead.',
    };
  }

  const providerType = readProviderType(candidate);

  // No providerType → backward-compatible implicit y-websocket target.
  if (providerType === null || providerType === 'y-websocket') {
    return resolveWebsocketFamily('y-websocket', candidate);
  }
  if (providerType === 'hocuspocus') {
    return resolveWebsocketFamily('hocuspocus', candidate);
  }
  if (providerType === 'liveblocks') {
    return resolveLiveblocksFamily(candidate, authEndpointBaseUrl);
  }
  if (providerType === 'extension') {
    return resolveProviderExtension(candidate);
  }

  // Any other providerType (e.g. "memory", "superdoc", or an unknown family) is
  // not a shipped v2 single-doc provider.
  return {
    ok: false,
    reason: 'unsupported-provider-family',
    message:
      `SuperDoc v2 collaboration does not support the "${providerType}" provider family. ` +
      'Supported families are y-websocket, hocuspocus, liveblocks, and extension.',
  };
}
