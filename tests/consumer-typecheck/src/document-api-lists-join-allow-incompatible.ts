import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const target = { kind: 'block', nodeType: 'listItem', nodeId: 'item-1' } as const;
const input: Parameters<DocumentApi['lists']['join']>[0] = {
  target,
  direction: 'withPrevious',
  allowIncompatible: true,
};
const joined: ReturnType<DocumentApi['lists']['join']> = doc.lists.join(input);
if (joined.success) {
  const listId: string = joined.listId;
  void listId;
}
const strict: ReturnType<DocumentApi['lists']['join']> = doc.lists.join({ target, direction: 'withNext' });
void strict;
