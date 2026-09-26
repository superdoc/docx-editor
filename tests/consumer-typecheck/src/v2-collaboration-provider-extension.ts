// Main-thread side of a provider extension. The adapter lives in
// v2-collaboration-provider-extension.worker.ts and is served as the
// collaboration worker through `workerUrls.collaboration`.
import { SuperDoc, type DocumentCollaborationConfig, type V2CollaborationConfig } from 'superdoc';

const getAccessToken = async (): Promise<string> => 'jwt-current';

const hocuspocusWithRotatingToken: V2CollaborationConfig = {
  providerType: 'hocuspocus',
  documentId: 'contract-42',
  serverUrl: 'wss://collab.example.test',
  token: getAccessToken,
};

const collaboration = {
  providerType: 'extension',
  adapterId: 'app-hocuspocus',
  documentId: 'contract-42',
  providerOptions: { url: 'wss://collab.example.test', tenant: 'acme' },
  token: () => getAccessToken(),
  roomMode: 'join',
} satisfies DocumentCollaborationConfig;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: { url: '/contract.docx', collaboration },
  workerUrls: { collaboration: new URL('./v2-collaboration-provider-extension.worker.js', import.meta.url) },
});

// In v2, `provider` is a send-only facade, not the provider instance.
const tokenRefresh = JSON.stringify({ type: 'token-refresh', token: 'jwt-refreshed' });
await superdoc.provider?.sendStateless?.(tokenRefresh);

void hocuspocusWithRotatingToken;
