import {
  SuperDoc,
  type Config,
  type SuperDocCollaborationConnectionChangePayload,
  type SuperDocCollaborationConnectionKind,
  type SuperDocCollaborationConnectionState,
} from 'superdoc';

// SD-4997: v2 collaboration transport loss and recovery are observable.
const config = {
  selector: '#editor',
  document: {
    url: '/agreement.docx',
    collaboration: { providerType: 'hocuspocus', documentId: 'agreement', serverUrl: 'wss://collab.example.com' },
  },
  onCollaborationConnectionChange(payload) {
    const change: SuperDocCollaborationConnectionChangePayload = payload;
    const documentId: string = change.documentId;
    const state: SuperDocCollaborationConnectionState = change.state;
    const previousState: SuperDocCollaborationConnectionState | null = change.previousState;
    const kind: SuperDocCollaborationConnectionKind = change.kind;
    const detail: string | null = change.detail;
    const owner: SuperDoc = change.superdoc;
    if (kind === 'lost' || kind === 'reconnecting') void owner;
    // @ts-expect-error `disconnected` is internal; clients see `degraded`.
    const internal: SuperDocCollaborationConnectionState = 'disconnected';
    void [documentId, state, previousState, detail, internal];
  },
} satisfies Config;

const superdoc = new SuperDoc(config);
superdoc.on('collaboration-connection-change', (payload) => {
  const recovered: boolean = payload.kind === 'recovered';
  void recovered;
});

type CurrentConnection = ReturnType<SuperDoc['getCollaborationConnectionState']>;
const current: CurrentConnection = superdoc.getCollaborationConnectionState();
const expected: SuperDocCollaborationConnectionChangePayload | null = current;
// @ts-expect-error The getter can return null before any v2 room reports state.
const nonNull: SuperDocCollaborationConnectionChangePayload = current;

const allKinds: SuperDocCollaborationConnectionKind[] = ['initial', 'lost', 'reconnecting', 'recovered', 'failed'];

void [expected, nonNull, allKinds];
