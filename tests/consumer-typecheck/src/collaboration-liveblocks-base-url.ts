import type { Config, DocumentCollaborationConfig } from 'superdoc';

const localDevServer = {
  providerType: 'liveblocks',
  documentId: 'agreement',
  publicApiKey: 'pk_localdev',
  baseUrl: 'http://localhost:1153',
} satisfies DocumentCollaborationConfig;

const config = {
  selector: '#editor',
  document: { url: '/agreement.docx', collaboration: localDevServer },
} satisfies Config;

const baseUrl: string | undefined = localDevServer.baseUrl;

const wrongType: DocumentCollaborationConfig = {
  providerType: 'liveblocks',
  documentId: 'agreement',
  publicApiKey: 'pk_localdev',
  // @ts-expect-error baseUrl is a URL string.
  baseUrl: 1153,
};

void [config, baseUrl, wrongType];
