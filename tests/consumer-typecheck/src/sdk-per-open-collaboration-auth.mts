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
    },
  },
  options,
);

void document;
