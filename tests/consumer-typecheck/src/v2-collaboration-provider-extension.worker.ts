// Collaboration worker module for a provider extension, as shown in
// apps/docs/content/docs/editor/collaboration/use-your-own-provider.mdx.
// The adapter opens a real Hocuspocus connection on the runtime-owned Y.Doc.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  bootstrapSuperDocCollaborationWorker,
  type SuperDocCollaborationProviderFactory,
  type SuperDocCollaborationProviderTransport,
} from 'superdoc/collaboration-worker';

interface AppProviderOptions {
  url: string;
  tenant: string;
}

const appHocuspocus: SuperDocCollaborationProviderFactory = ({ providerOptions, token }) => {
  const { url, tenant } = providerOptions as AppProviderOptions;

  return {
    providerFamily: 'hocuspocus',
    attach({ ydoc, providerRoomName, onSynced, onDegraded, onFailed, onStateless }) {
      let synced = false;
      const socket = new HocuspocusProviderWebsocket({ url });
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: providerRoomName,
        document: ydoc,
        token,
        parameters: { tenant },
        onSynced() {
          synced = true;
          onSynced();
        },
        onDisconnect() {
          if (synced) onDegraded();
        },
        onAuthenticationFailed() {
          onFailed({ reason: 'authentication_failed' });
        },
        onClose({ event }) {
          if (event.code === 4401 || event.code === 4403) onFailed({ code: event.code });
        },
        onStateless({ payload }) {
          onStateless(payload);
        },
      });

      const transport: SuperDocCollaborationProviderTransport = {
        awareness: provider.awareness,
        sendStateless: (message) => provider.sendStateless(message),
        disconnect: () => provider.disconnect(),
        destroy() {
          provider.destroy();
          socket.destroy();
        },
      };
      return transport;
    },
  };
};

bootstrapSuperDocCollaborationWorker({
  providerAdapters: { 'app-hocuspocus': appHocuspocus },
});
