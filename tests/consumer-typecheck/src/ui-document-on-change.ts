import type { SuperDoc } from 'superdoc';
import type { ScopedDocumentHandle, SuperDocDocumentChange } from 'superdoc/ui';

declare const superdoc: SuperDoc;

const { ui } = superdoc;
const stop: () => void = ui.document.onChange((change: SuperDocDocumentChange) => {
  const order: [string, number] = [change.documentEpoch, change.seq];
  const tag: string | null = change.changeTag;
  const txId: string | null = change.txId;
  if (change.cause === 'remote' && change.scope.kind === 'unknown') return;
  if (change.scope.kind === 'known') void change.scope.stories.length;
  void order;
  void tag;
  void txId;
});

const scope = ui.createScope();
const scopedDocument: ScopedDocumentHandle = scope.document;
scopedDocument.onChange(() => undefined);
scope.dispose();

// @ts-expect-error cause is a closed set.
const invalidCause: SuperDocDocumentChange['cause'] = 'collaborator';

void stop;
void invalidCause;
