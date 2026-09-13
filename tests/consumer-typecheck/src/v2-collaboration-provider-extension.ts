import type { SuperDoc, V2CollaborationConfig } from 'superdoc';
import {
  bootstrapSuperDocCollaborationWorker,
  type SuperDocCollaborationProviderFactory,
} from 'superdoc/collaboration-worker';

const resolveToken = async (): Promise<string> => 'jwt-current';

const hocuspocusWithRotatingToken: V2CollaborationConfig = {
  providerType: 'hocuspocus',
  documentId: 'fieldguide-report',
  serverUrl: 'wss://collaboration.example.test',
  token: resolveToken,
};

const customerProviderAdapter: V2CollaborationConfig = {
  providerType: 'extension',
  adapterId: 'fieldguide-hocuspocus',
  documentId: 'fieldguide-report',
  providerOptions: {
    tenant: 'acme',
    reconnect: true,
  },
};

const fieldguideAdapter: SuperDocCollaborationProviderFactory = ({ documentId, providerOptions, token }) => ({
  providerFamily: 'hocuspocus',
  attach({ ydoc, providerRoomName, onSynced, onDegraded, onFailed, onStateless }) {
    void [documentId, providerOptions, token, ydoc, providerRoomName];
    void [onSynced, onDegraded, onFailed, onStateless];
    return {
      disconnect() {},
      destroy() {},
      sendStateless(message) {
        void message;
      },
    };
  },
});

bootstrapSuperDocCollaborationWorker({
  providerAdapters: {
    'fieldguide-hocuspocus': fieldguideAdapter,
  },
});

declare const superdoc: SuperDoc;
const tokenRefresh = JSON.stringify({ type: 'token-refresh', token: 'jwt-refreshed' });
const initializationAttribution = JSON.stringify({ type: 'financial-report-initialization' });
const contentChangeAttribution = JSON.stringify({ type: 'financial-report-content-changed' });

await superdoc.provider?.sendStateless?.(tokenRefresh);
await superdoc.provider?.sendStateless?.(initializationAttribution);
await superdoc.provider?.sendStateless?.(contentChangeAttribution);

void [hocuspocusWithRotatingToken, customerProviderAdapter];
