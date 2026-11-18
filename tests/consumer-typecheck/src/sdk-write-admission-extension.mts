import {
  SuperDocClient,
  createWriteAdmissionExtension,
  type SuperDocDocument,
  type WriteAdmissionExtension,
  type WriteAdmissionOptions,
} from '../../../packages/sdk/langs/node/dist/index.js';

const options = { leaseTimeoutMs: 10_000 } satisfies WriteAdmissionOptions;
const extension: WriteAdmissionExtension = createWriteAdmissionExtension(options);
const hooks: Array<(payload: never) => Promise<void>> = [
  extension.beforeHandleMessage,
  extension.onStateless,
  extension.onDisconnect,
];
// @ts-expect-error leaseTimeoutMs is a number of milliseconds.
createWriteAdmissionExtension({ leaseTimeoutMs: '10s' });

const client = new SuperDocClient({ env: { SUPERDOC_CLI_BIN: '/path/to/superdoc' } });
const document: Promise<SuperDocDocument> = client.open({
  collaboration: {
    providerType: 'hocuspocus',
    url: 'wss://collaboration.example.test',
    documentId: 'document-1',
    expectedRevisionScope: 'room',
  },
});

client.open({
  collaboration: {
    providerType: 'hocuspocus',
    url: 'wss://collaboration.example.test',
    documentId: 'document-1',
    // @ts-expect-error expectedRevisionScope is "session" or "room".
    expectedRevisionScope: 'global',
  },
});

void [hooks, document];
