import { SuperDoc, type DocumentCollaborationConfig } from 'superdoc';
import 'superdoc/style.css';

const collaboration = {
  providerType: 'hocuspocus',
  documentId: 'contract-123',
  serverUrl: 'ws://127.0.0.1:1234',
  roomMode: 'join',
} satisfies DocumentCollaborationConfig;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: { url: '/contract.docx', collaboration },
  user: { id: 'alex', name: 'Alex', email: 'alex@example.com' },
  onReady: async ({ superdoc: ready }) => {
    const doc = ready.activeEditor?.doc;
    if (!doc) throw new Error('The Document API is not ready.');

    const { items, cursor, truncated, identity } = await doc.changes.list({ limit: 50 });
    console.log({ count: items.length, cursor, truncated, identity });

    const first = items[0];
    if (first) {
      const record = await doc.changes.get({ id: first.id });
      console.log(record?.actor?.id, record?.changes);
    }
  },
});

const stop = superdoc.ui.document.onChange((change) => {
  if (change.cause !== 'remote') return;
  for (const record of change.records ?? []) {
    console.log(
      record.actor?.id ?? 'unknown',
      record.changes.map((entry) => entry.kind),
    );
  }
});

export function stopListening(): void {
  stop();
}
