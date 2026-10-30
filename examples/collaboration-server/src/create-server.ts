import { Hocuspocus } from '@hocuspocus/server';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import type { Authorize } from './auth/types.ts';
import type { DocxAutosave } from './docx/autosave.ts';
import { documentIdFromRoomName } from './room-name.ts';
import type { RoomStore } from './storage/types.ts';

export interface CollaborationServerOptions {
  port: number;
  host: string;
  roomStore: RoomStore;
  authorize: Authorize | null;
  docxAutosave: DocxAutosave | null;
  debounceMs?: number;
  maxDebounceMs?: number;
}

export type CollaborationServer = Hocuspocus & { stop(): Promise<void> };

export function createCollaborationServer(options: CollaborationServerOptions): CollaborationServer {
  const { authorize, docxAutosave, roomStore } = options;
  const roomWrites = new Map<string, Promise<void>>();
  let shuttingDown = false;
  let shutdown: Promise<void> | undefined;

  const server = new Hocuspocus({
    port: options.port,
    address: options.host,
    quiet: true,
    stopOnSignals: false,
    extensions: [
      {
        async beforeUnloadDocument({ documentName }) {
          for (let write = roomWrites.get(documentName); write; write = roomWrites.get(documentName)) {
            await write.catch(() => {});
          }
        },
      },
    ],
    ...(options.debounceMs === undefined ? {} : { debounce: options.debounceMs }),
    ...(options.maxDebounceMs === undefined ? {} : { maxDebounce: options.maxDebounceMs }),

    async onConnect({ requestParameters }) {
      const isAutosave =
        docxAutosave !== null && requestParameters.get(docxAutosave.marker.name) === docxAutosave.marker.value;
      if (shuttingDown && !isAutosave) throw new Error('Server is shutting down.');
      return { isAutosave };
    },

    async beforeHandleMessage({ connection, context }) {
      if (shuttingDown && context?.isAutosave !== true) connection.readOnly = true;
    },

    ...(authorize && {
      async onAuthenticate({ token, documentName, connection, requestParameters }) {
        const access = await authorize({
          token,
          roomName: documentName,
          documentId: documentIdFromRoomName(documentName),
        });
        if (!access) throw new Error('Access denied.');
        if (
          shuttingDown &&
          (!docxAutosave || requestParameters.get(docxAutosave.marker.name) !== docxAutosave.marker.value)
        ) {
          throw new Error('Server is shutting down.');
        }
        if (access.readOnly) connection.readOnly = true;
        return { userId: access.userId };
      },
    }),

    async onLoadDocument({ documentName, document }) {
      const state = await roomStore.load(documentName);
      if (state) applyUpdate(document, state);
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      const state = encodeStateAsUpdate(document);
      const previous = roomWrites.get(documentName)?.catch(() => {}) ?? Promise.resolve();
      const write = previous.then(() => roomStore.store(documentName, state));
      roomWrites.set(documentName, write);
      try {
        await write;
      } finally {
        if (roomWrites.get(documentName) === write) roomWrites.delete(documentName);
      }
    },

    ...(docxAutosave && {
      async onChange({ documentName, context }) {
        if (context?.isAutosave !== true) docxAutosave.roomChanged(documentName);
      },
      async onDisconnect({ documentName, clientsCount }) {
        if (clientsCount === 0) docxAutosave.roomEmptied(documentName);
      },
    }),
  });

  return Object.assign(server, {
    stop() {
      if (!shutdown) {
        shuttingDown = true;
        for (const document of server.documents.values()) {
          for (const connection of document.getConnections()) {
            if (connection.context?.isAutosave !== true) connection.readOnly = true;
          }
        }
        shutdown = (async () => {
          try {
            await docxAutosave?.stop();
          } finally {
            await server.destroy();
          }
        })();
      }
      return shutdown;
    },
  });
}
