import type { Config, DocumentCollaborationConfig } from 'superdoc';

type HocuspocusCollaboration = Extract<DocumentCollaborationConfig, { providerType: 'hocuspocus' }>;

const roomScoped = {
  providerType: 'hocuspocus',
  documentId: 'agreement',
  url: 'wss://collaboration.example.test',
  expectedRevisionScope: 'room',
} satisfies DocumentCollaborationConfig;

const config = {
  selector: '#editor',
  document: { url: '/agreement.docx', collaboration: roomScoped },
} satisfies Config;

const scope: HocuspocusCollaboration['expectedRevisionScope'] = roomScoped.expectedRevisionScope;

const unknownScope: DocumentCollaborationConfig = {
  providerType: 'hocuspocus',
  documentId: 'agreement',
  url: 'wss://collaboration.example.test',
  // @ts-expect-error expectedRevisionScope is "session" or "room".
  expectedRevisionScope: 'global',
};

const yWebsocketRoom: DocumentCollaborationConfig = {
  providerType: 'y-websocket',
  documentId: 'agreement',
  url: 'wss://collaboration.example.test',
  // @ts-expect-error a room-scoped expectedRevision needs the Hocuspocus write admission extension.
  expectedRevisionScope: 'room',
};

void [config, scope, unknownScope, yWebsocketRoom];
