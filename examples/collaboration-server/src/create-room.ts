import { createDefaultSdkClient, withToken, type SdkClient } from './sdk.ts';

export interface CreateRoomOptions {
  serverUrl: string;
  documentId: string;
  docxPath: string;
  token?: string;
  createClient?: () => SdkClient;
}

export class RoomExistsError extends Error {
  constructor(documentId: string) {
    super(`A room for "${documentId}" already exists. Open it with roomMode: 'join'.`);
    this.name = 'RoomExistsError';
  }
}

export async function createRoom(options: CreateRoomOptions): Promise<void> {
  const createClient = options.createClient ?? (() => createDefaultSdkClient('Room creator'));
  const auth = withToken(options.token);
  const collaboration = (roomMode: 'create' | 'join') => ({
    providerType: 'hocuspocus' as const,
    url: options.serverUrl,
    documentId: options.documentId,
    roomMode,
  });

  const creator = createClient();
  const checker = createClient();
  try {
    let created;
    try {
      created = await creator.open({ doc: options.docxPath, collaboration: collaboration('create') }, auth);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'COLLABORATION_ROOM_ALREADY_EXISTS') {
        throw new RoomExistsError(options.documentId);
      }
      throw error;
    }

    try {
      const check = await checker.open({ collaboration: collaboration('join') }, auth);
      await check.close({ discard: true });
    } finally {
      await created.close({ discard: true });
    }
  } finally {
    await Promise.allSettled([creator.dispose(), checker.dispose()]);
  }
}
