export type DevCollaborationRoomMode = 'auto' | 'create' | 'join';
export type DevResolvedCollaborationRoomMode = Exclude<DevCollaborationRoomMode, 'auto'>;

export const DEFAULT_DEV_COLLABORATION_SERVER_URL = 'ws://localhost:8081/v2/collaboration';
export const DEFAULT_DEV_LIVEBLOCKS_URL = 'http://localhost:1153';
export const LIVEBLOCKS_DEV_PUBLIC_KEY = 'pk_localdev';

export type DevCollaborationProvider = 'y-websocket' | 'liveblocks';

export type DevV2CollaborationConfig =
  | {
      providerType: 'y-websocket';
      serverUrl: string;
      documentId: string;
      roomMode: DevResolvedCollaborationRoomMode;
      params?: Record<string, string>;
    }
  | {
      providerType: 'liveblocks';
      baseUrl: string;
      publicApiKey: string;
      documentId: string;
      roomMode: DevResolvedCollaborationRoomMode;
    };

type DevDocumentSource = Blob & {
  markdownContent?: string;
  htmlContent?: string;
};

export function resolveDevCollaborationRoomMode(rawMode: string | null): DevCollaborationRoomMode {
  if (rawMode == null || rawMode === '') return 'auto';
  if (rawMode === 'auto' || rawMode === 'create' || rawMode === 'join') return rawMode;
  throw new Error(`Invalid collabRoomMode "${rawMode}". Expected "auto", "create", or "join".`);
}

export function resolveDevCollaborationServerUrl(rawUrl: string | null): string {
  const candidate = rawUrl?.trim();
  return candidate || DEFAULT_DEV_COLLABORATION_SERVER_URL;
}

export function resolveDevCollaborationProvider(rawProvider: string | null): DevCollaborationProvider {
  if (rawProvider == null || rawProvider === '' || rawProvider === 'y-websocket') return 'y-websocket';
  if (rawProvider === 'liveblocks') return 'liveblocks';
  throw new Error(`Invalid collabProvider "${rawProvider}". Expected "y-websocket" or "liveblocks".`);
}

export function createDevCollaborationAutoUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.delete('collabRoomMode');
  return url.toString();
}

export function createDevV2CollaborationConfig({
  enabled,
  provider = 'y-websocket',
  serverUrl,
  liveblocksUrl = DEFAULT_DEV_LIVEBLOCKS_URL,
  documentId,
  roomMode,
  userId,
}: {
  enabled: boolean;
  provider?: DevCollaborationProvider;
  serverUrl: string;
  liveblocksUrl?: string;
  documentId: string;
  roomMode: DevResolvedCollaborationRoomMode | null;
  userId?: string | null;
}): DevV2CollaborationConfig | null {
  if (!enabled) return null;
  if (roomMode !== 'create' && roomMode !== 'join') {
    throw new Error('V2 collaboration requires an explicit create or join room mode.');
  }

  if (provider === 'liveblocks') {
    return {
      providerType: 'liveblocks',
      baseUrl: liveblocksUrl,
      publicApiKey: LIVEBLOCKS_DEV_PUBLIC_KEY,
      documentId,
      roomMode,
    };
  }

  return {
    providerType: 'y-websocket',
    serverUrl,
    documentId,
    roomMode,
    ...(userId ? { params: { userId } } : {}),
  };
}

export function createDevDocumentConfig({
  source,
  id,
  v2Collaboration,
}: {
  source: DevDocumentSource | null;
  id: string;
  v2Collaboration: DevV2CollaborationConfig | null;
}) {
  if (!source) return null;

  return {
    data: source,
    id,
    ...(source.markdownContent ? { markdown: source.markdownContent } : {}),
    ...(source.htmlContent ? { html: source.htmlContent } : {}),
    ...(v2Collaboration ? { v2Collaboration } : {}),
  };
}
