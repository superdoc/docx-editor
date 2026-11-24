import { SuperDoc, type Config, type DocumentCollaborationConfig } from 'superdoc';

const configurations = [
  { documentId: 'agreement', serverUrl: 'wss://collaboration.example.test', roomMode: 'create-or-join' },
  {
    providerType: 'hocuspocus',
    documentId: 'agreement',
    serverUrl: 'wss://collaboration.example.test',
    roomMode: 'create-or-join',
  },
  { providerType: 'liveblocks', roomId: 'agreement', authEndpoint: '/auth', roomMode: 'create-or-join' },
  { providerType: 'extension', documentId: 'agreement', adapterId: 'application', roomMode: 'create-or-join' },
] satisfies DocumentCollaborationConfig[];

for (const collaboration of configurations) {
  const config = { selector: '#editor', document: { url: '/agreement.docx', collaboration } } satisfies Config;
  const parameters: ConstructorParameters<typeof SuperDoc> = [config];
  const result: InstanceType<typeof SuperDoc> = new SuperDoc(...parameters);
  const exported: ReturnType<SuperDoc['export']> = result.export({ exportType: ['docx'], triggerDownload: false });
  void exported;
}
