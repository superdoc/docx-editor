import {
  SuperDocClient,
  type CollaborationAuth,
  type DocOpenOptions,
  type SuperDocDocument,
} from '../../../packages/sdk/langs/node/dist/index.js';

const auth = {
  type: 'token',
  token: 'request-scoped-token',
} satisfies CollaborationAuth;

const options = {
  collaborationAuth: auth,
} satisfies DocOpenOptions;

const client = new SuperDocClient({ env: { SUPERDOC_CLI_BIN: '/path/to/superdoc' } });
const document: Promise<SuperDocDocument> = client.open(
  {
    doc: '/path/to/document.docx',
    collaboration: {
      providerType: 'hocuspocus',
      url: 'wss://collaboration.example.test',
      documentId: 'document-1',
      presence: { name: 'Bot', color: '#22AA66', userId: 'bot-1', followEdits: false },
    },
  },
  options,
);

void document;

async function placeAgentPresence(session: SuperDocDocument) {
  const placed = await session.presence.set({ blockId: 'paragraph-1', start: 0, end: 4 });
  const selection: { blockId?: string; start?: number; end?: number } | null = placed.presence.selection;
  await session.presence.set({ clear: true });
  return selection;
}

void placeAgentPresence;
